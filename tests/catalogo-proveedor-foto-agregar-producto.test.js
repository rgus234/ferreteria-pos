// Bug real reportado por el dueño: en "Agregar producto", escribir a
// mano el codigo de un producto que ya vive en un catalogo de
// proveedor importado (ej. GAFI, ver catalog-pdf-server.js) nunca
// mostraba su foto -- ese formulario solo consultaba fotos_producto y
// el Banco de Nexo, nunca catalogo_productos (el staging del catalogo
// recien importado).
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { pool, crearNegocioPrueba, borrarNegocioPrueba } = require("./helpers/negocio-prueba");
const { iniciarServidorPrueba, detenerServidorPrueba, BASE_URL } = require("./helpers/servidor-prueba");

let negocio;

function headers() {
    return { "x-dispositivo-token": negocio.token };
}

before(async () => {
    await iniciarServidorPrueba();
    negocio = await crearNegocioPrueba("catalogo-foto-agregar");
});

after(async () => {
    if (negocio) await borrarNegocioPrueba(negocio.negocioId);
    await detenerServidorPrueba();
});

async function crearFilaCatalogoConImagen({ codigo, proveedor = "GAFI", imagen = Buffer.from("imagen-de-prueba") }) {
    const catalogo = await pool.query(
        `INSERT INTO public.catalogos_proveedor (negocio_id, proveedor) VALUES ($1, $2)
         ON CONFLICT (negocio_id, proveedor) DO UPDATE SET updated_at = NOW()
         RETURNING id`,
        [negocio.negocioId, proveedor]
    );
    await pool.query(
        `INSERT INTO public.catalogo_productos (negocio_id, catalogo_id, codigo_proveedor, nombre_proveedor, imagen, imagen_tipo)
         VALUES ($1, $2, $3, 'Producto de catalogo', $4, 'image/jpeg')`,
        [negocio.negocioId, catalogo.rows[0].id, codigo, imagen]
    );
}

test("sin ningun catalogo importado, no existe foto para ese codigo", async () => {
    const respuesta = await fetch(`${BASE_URL}/catalogo-proveedor-foto-existe/NO-EXISTE-123`, { headers: headers() });
    const datos = await respuesta.json();

    assert.equal(respuesta.status, 200);
    assert.equal(datos.existe, false);
});

test("codigo que existe en un catalogo importado: regresa proveedor y una URL de imagen firmada y funcional", async () => {
    await crearFilaCatalogoConImagen({ codigo: "GAFI-196593" });

    const existe = await fetch(`${BASE_URL}/catalogo-proveedor-foto-existe/GAFI-196593`, { headers: headers() });
    const datosExiste = await existe.json();

    assert.equal(datosExiste.existe, true);
    assert.equal(datosExiste.proveedor, "GAFI");
    assert.ok(datosExiste.imagenUrl.includes("/imagen-propuesta?token="));

    // La URL firmada debe servir la imagen real, sin necesitar headers de
    // sesion (un <img src> no puede mandar Authorization).
    const imagen = await fetch(`${BASE_URL}${datosExiste.imagenUrl}`);
    assert.equal(imagen.status, 200);
    assert.equal(imagen.headers.get("content-type"), "image/jpeg");
    const bytes = Buffer.from(await imagen.arrayBuffer());
    assert.ok(bytes.equals(Buffer.from("imagen-de-prueba")));
});

test("usar esta imagen la copia a fotos_producto (lo que de verdad usa el POS)", async () => {
    await crearFilaCatalogoConImagen({ codigo: "GAFI-USAR-1", imagen: Buffer.from("foto-real-gafi") });

    const usar = await fetch(`${BASE_URL}/catalogo-proveedor-foto/GAFI-USAR-1/usar`, { method: "POST", headers: headers() });
    const datosUsar = await usar.json();
    assert.equal(usar.status, 200, JSON.stringify(datosUsar));
    assert.equal(datosUsar.ok, true);

    const foto = await pool.query(
        `SELECT imagen_principal, imagen_principal_tipo FROM public.fotos_producto WHERE negocio_id = $1 AND codigo = 'GAFI-USAR-1'`,
        [negocio.negocioId]
    );
    assert.equal(foto.rows.length, 1);
    assert.ok(Buffer.from(foto.rows[0].imagen_principal).equals(Buffer.from("foto-real-gafi")));
});

test("usar esta imagen sin coincidencia real regresa 404, nunca inventa una foto", async () => {
    const respuesta = await fetch(`${BASE_URL}/catalogo-proveedor-foto/CODIGO-INEXISTENTE/usar`, { method: "POST", headers: headers() });
    assert.equal(respuesta.status, 404);
});

test("dos negocios distintos nunca ven la foto del catalogo del otro (aislado por negocio_id)", async () => {
    const otroNegocio = await crearNegocioPrueba("catalogo-foto-otro");
    try {
        const catalogoOtro = await pool.query(
            `INSERT INTO public.catalogos_proveedor (negocio_id, proveedor) VALUES ($1, 'GAFI') RETURNING id`,
            [otroNegocio.negocioId]
        );
        await pool.query(
            `INSERT INTO public.catalogo_productos (negocio_id, catalogo_id, codigo_proveedor, nombre_proveedor, imagen, imagen_tipo)
             VALUES ($1, $2, 'COMPARTIDO-999', 'Producto del otro negocio', $3, 'image/jpeg')`,
            [otroNegocio.negocioId, catalogoOtro.rows[0].id, Buffer.from("foto-del-otro-negocio")]
        );

        const respuesta = await fetch(`${BASE_URL}/catalogo-proveedor-foto-existe/COMPARTIDO-999`, { headers: headers() });
        const datos = await respuesta.json();
        assert.equal(datos.existe, false, "el mismo codigo en OTRO negocio no debe verse aqui");
    } finally {
        await borrarNegocioPrueba(otroNegocio.negocioId);
    }
});
