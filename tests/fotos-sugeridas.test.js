// Fotos sugeridas: el negocio revisa y confirma con un toque la foto que el
// Banco de Nexo sugiere para sus productos sin foto.
//
// Lo que se protege:
//  - solo se ofrecen candidatas con foto en el banco (por mismo codigo de barras
//    o por nombre parecido) y nada para lo que no tiene ninguna;
//  - NADA se escribe hasta que la persona acepta, y aceptar jamas pisa una foto
//    que el producto ya tenga (409);
//  - "ninguna es" se recuerda y no vuelve a ofrecer esa foto;
//  - un negocio no ve ni toca productos de otro, y el plan Basico no accede.
//
// Las tablas del banco y del Catalogo Maestro son GLOBALES: las filas de prueba
// llevan un codigo unico y se borran al terminar.

const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { pool, crearNegocioPrueba, crearProductoPrueba, establecerPlanPrueba, borrarNegocioPrueba } = require("./helpers/negocio-prueba");
const { iniciarServidorPrueba, detenerServidorPrueba, BASE_URL } = require("./helpers/servidor-prueba");

const SUFIJO = String(Date.now());
const BANCO_PINZA = `TESTFS1${SUFIJO}`;
const BANCO_CINCHOS_200 = `TESTFS2${SUFIJO}`;
const BANCO_CINCHOS_50 = `TESTFS3${SUFIJO}`;
const EAN_PINZA = `750${SUFIJO}`.slice(0, 13);
const IMAGEN = Buffer.from("imagen-falsa-del-banco");

let negocioA;
let negocioB;
let pinza;
let cinchos;
let rara;
let maestroCinchos50;

function llamar(negocio, ruta, opciones = {}) {
    return fetch(`${BASE_URL}${ruta}`, {
        ...opciones,
        headers: { "Content-Type": "application/json", "x-dispositivo-token": negocio.token }
    }).then(async respuesta => ({ status: respuesta.status, cuerpo: await respuesta.json() }));
}

async function filaBancoYMaestro({ codigoBanco, nombre, ean = "" }) {
    await pool.query(
        `INSERT INTO public.banco_imagenes_producto (codigo, marca, imagen_principal, imagen_principal_tipo) VALUES ($1, 'TRUPER', $2, 'image/jpeg')`,
        [codigoBanco, IMAGEN]
    );
    const maestro = await pool.query(
        `INSERT INTO public.catalogo_maestro_productos (codigo, nombre, marca, codigo_fabricante, ean, origen)
         VALUES ($1, $2, 'Truper', $3, $4, 'fabricante') RETURNING id`,
        [`M-${codigoBanco}`, nombre, codigoBanco, ean]
    );
    return maestro.rows[0].id;
}

before(async () => {
    await iniciarServidorPrueba();
    negocioA = await crearNegocioPrueba("fotos-sug-a");
    negocioB = await crearNegocioPrueba("fotos-sug-b");

    await filaBancoYMaestro({ codigoBanco: BANCO_PINZA, nombre: "Pinza de presion 10 pulgadas mordaza recta Truper", ean: EAN_PINZA });
    await filaBancoYMaestro({ codigoBanco: BANCO_CINCHOS_200, nombre: "Bolsa con 200 cinchos plasticos Truper" });
    maestroCinchos50 = await filaBancoYMaestro({ codigoBanco: BANCO_CINCHOS_50, nombre: "Bolsa con 50 cinchos plasticos Truper" });

    pinza = await crearProductoPrueba(negocioA.negocioId, { nombre: "Pinza de presion 10 mordaza recta", precio: 90, stock: 3, codigo: EAN_PINZA });
    cinchos = await crearProductoPrueba(negocioA.negocioId, { nombre: "Bolsa con 50 cinchos plasticos Truper", precio: 25, stock: 8, codigo: `CIN${SUFIJO}` });
    rara = await crearProductoPrueba(negocioA.negocioId, { nombre: "Cosa rarisima que no existe en ningun lado xyz", precio: 5, stock: 1, codigo: `RAR${SUFIJO}` });
    await pool.query(`UPDATE public.productos SET marca = 'Truper' WHERE id = ANY($1::int[])`, [[pinza.id, cinchos.id]]);
});

after(async () => {
    if (negocioA) {
        await pool.query(`UPDATE public.productos SET catalogo_maestro_id = NULL WHERE negocio_id = $1`, [negocioA.negocioId]);
        await pool.query(`DELETE FROM public.banco_imagenes_uso WHERE negocio_id = $1`, [negocioA.negocioId]);
        await borrarNegocioPrueba(negocioA.negocioId);
    }
    if (negocioB) {
        await pool.query(`DELETE FROM public.licencias WHERE negocio_id = $1`, [negocioB.negocioId]);
        await borrarNegocioPrueba(negocioB.negocioId);
    }
    await pool.query(`DELETE FROM public.catalogo_maestro_productos WHERE codigo_fabricante LIKE $1`, [`TESTFS%${SUFIJO}`]);
    await pool.query(`DELETE FROM public.banco_imagenes_producto WHERE codigo LIKE $1`, [`TESTFS%${SUFIJO}`]);
    await detenerServidorPrueba();
    await pool.end();
});

test("sugiere candidatas por codigo de barras y por nombre, y nada para lo que no tiene", async () => {
    const { status, cuerpo } = await llamar(negocioA, "/fotos-sugeridas?limite=10");

    assert.equal(status, 200);
    assert.equal(cuerpo.permitido, true);
    assert.equal(cuerpo.pendientes, 3, "los tres productos estan sin foto");

    const idsSugeridos = cuerpo.items.map(item => item.productoId);
    assert.ok(idsSugeridos.includes(pinza.id));
    assert.ok(idsSugeridos.includes(cinchos.id));
    assert.ok(!idsSugeridos.includes(rara.id), "sin candidata no se ofrece");

    const deLaPinza = cuerpo.items.find(item => item.productoId === pinza.id);
    assert.equal(deLaPinza.candidatas[0].codigoBanco, BANCO_PINZA);
    assert.equal(deLaPinza.candidatas[0].via, "ean");
    assert.match(deLaPinza.candidatas[0].imagenUrl, new RegExp(`^/banco-imagenes/${BANCO_PINZA}/principal\\?token=`));

    const deLosCinchos = cuerpo.items.find(item => item.productoId === cinchos.id);
    assert.equal(deLosCinchos.candidatas[0].codigoBanco, BANCO_CINCHOS_50, "la de nombre identico va primero");
    assert.equal(deLosCinchos.candidatas[0].similitud, 1);
    assert.ok(deLosCinchos.candidatas.some(c => c.codigoBanco === BANCO_CINCHOS_200), "la de 200 piezas tambien se muestra, para que la persona decida");
});

test("la foto del banco se sirve con el token firmado", async () => {
    const { cuerpo } = await llamar(negocioA, "/fotos-sugeridas?limite=10");
    const url = cuerpo.items.find(item => item.productoId === pinza.id).candidatas[0].imagenUrl;

    const imagen = await fetch(`${BASE_URL}${url}`);
    assert.equal(imagen.status, 200);
    assert.equal(Buffer.from(await imagen.arrayBuffer()).toString(), "imagen-falsa-del-banco");

    const sinToken = await fetch(`${BASE_URL}/banco-imagenes/${BANCO_PINZA}/principal`);
    assert.equal(sinToken.status, 401);
});

test("no se escribe nada hasta aceptar", async () => {
    await llamar(negocioA, "/fotos-sugeridas?limite=10");

    const fotos = await pool.query(`SELECT COUNT(*)::int n FROM public.fotos_producto WHERE negocio_id = $1`, [negocioA.negocioId]);
    assert.equal(fotos.rows[0].n, 0);
});

test("aceptar copia la foto, enlaza al Maestro y no se puede repetir (409)", async () => {
    const aceptar = await llamar(negocioA, "/fotos-sugeridas/aceptar", {
        method: "POST",
        body: JSON.stringify({ productoId: cinchos.id, codigoBanco: BANCO_CINCHOS_50 })
    });
    assert.equal(aceptar.status, 200);

    const foto = await pool.query(`SELECT imagen_principal FROM public.fotos_producto WHERE negocio_id = $1 AND codigo = $2`, [negocioA.negocioId, `CIN${SUFIJO}`]);
    assert.equal(foto.rows.length, 1);
    assert.equal(foto.rows[0].imagen_principal.toString(), "imagen-falsa-del-banco");

    const producto = await pool.query(`SELECT catalogo_maestro_id FROM public.productos WHERE id = $1`, [cinchos.id]);
    assert.equal(producto.rows[0].catalogo_maestro_id, maestroCinchos50, "queda enlazado al Maestro para la galeria de Market");

    const uso = await pool.query(`SELECT COUNT(*)::int n FROM public.banco_imagenes_uso WHERE negocio_id = $1`, [negocioA.negocioId]);
    assert.equal(uso.rows[0].n, 1);

    const repetido = await llamar(negocioA, "/fotos-sugeridas/aceptar", {
        method: "POST",
        body: JSON.stringify({ productoId: cinchos.id, codigoBanco: BANCO_CINCHOS_200 })
    });
    assert.equal(repetido.status, 409, "jamas pisa una foto existente");

    const intacta = await pool.query(`SELECT imagen_principal FROM public.fotos_producto WHERE negocio_id = $1 AND codigo = $2`, [negocioA.negocioId, `CIN${SUFIJO}`]);
    assert.equal(intacta.rows[0].imagen_principal.toString(), "imagen-falsa-del-banco");

    const lista = await llamar(negocioA, "/fotos-sugeridas?limite=10");
    assert.ok(!lista.cuerpo.items.some(item => item.productoId === cinchos.id), "ya no vuelve a salir");
    assert.equal(lista.cuerpo.pendientes, 2);
});

test("una foto propia del negocio nunca se pisa", async () => {
    await pool.query(
        `INSERT INTO public.fotos_producto (negocio_id, codigo, imagen_principal, imagen_principal_tipo) VALUES ($1, $2, $3, 'image/jpeg')`,
        [negocioA.negocioId, pinza.codigo || EAN_PINZA, Buffer.from("foto-propia-del-dueno")]
    );

    const aceptar = await llamar(negocioA, "/fotos-sugeridas/aceptar", {
        method: "POST",
        body: JSON.stringify({ productoId: pinza.id, codigoBanco: BANCO_PINZA })
    });
    assert.equal(aceptar.status, 409);

    const foto = await pool.query(`SELECT imagen_principal FROM public.fotos_producto WHERE negocio_id = $1 AND codigo = $2`, [negocioA.negocioId, EAN_PINZA]);
    assert.equal(foto.rows[0].imagen_principal.toString(), "foto-propia-del-dueno");

    await pool.query(`DELETE FROM public.fotos_producto WHERE negocio_id = $1 AND codigo = $2`, [negocioA.negocioId, EAN_PINZA]);
});

test("'ninguna es' se recuerda y no vuelve a ofrecer esa foto", async () => {
    const descartar = await llamar(negocioA, "/fotos-sugeridas/descartar", {
        method: "POST",
        body: JSON.stringify({ productoId: pinza.id, codigosBanco: [BANCO_PINZA] })
    });
    assert.equal(descartar.status, 200);

    const lista = await llamar(negocioA, "/fotos-sugeridas?limite=10");
    const deLaPinza = lista.cuerpo.items.find(item => item.productoId === pinza.id);
    assert.ok(!deLaPinza || !deLaPinza.candidatas.some(c => c.codigoBanco === BANCO_PINZA));
});

test("otro negocio no ve ni toca mis productos", async () => {
    const lista = await llamar(negocioB, "/fotos-sugeridas?limite=10");
    assert.ok(!lista.cuerpo.items.some(item => [pinza.id, cinchos.id, rara.id].includes(item.productoId)));

    const aceptar = await llamar(negocioB, "/fotos-sugeridas/aceptar", {
        method: "POST",
        body: JSON.stringify({ productoId: pinza.id, codigoBanco: BANCO_PINZA })
    });
    assert.equal(aceptar.status, 404);

    const descartar = await llamar(negocioB, "/fotos-sugeridas/descartar", {
        method: "POST",
        body: JSON.stringify({ productoId: pinza.id, codigosBanco: [BANCO_PINZA] })
    });
    assert.equal(descartar.status, 404);
});

test("el plan Basico no accede al banco", async () => {
    await establecerPlanPrueba(negocioB.negocioId, "basico");

    const lista = await llamar(negocioB, "/fotos-sugeridas?limite=10");
    assert.equal(lista.cuerpo.permitido, false);
    assert.deepEqual(lista.cuerpo.items, []);

    const producto = await crearProductoPrueba(negocioB.negocioId, { nombre: "Producto de B", precio: 10, stock: 1 });
    const aceptar = await llamar(negocioB, "/fotos-sugeridas/aceptar", {
        method: "POST",
        body: JSON.stringify({ productoId: producto.id, codigoBanco: BANCO_PINZA })
    });
    assert.equal(aceptar.status, 403);
});

test("datos invalidos se rechazan con 400", async () => {
    const sinProducto = await llamar(negocioA, "/fotos-sugeridas/aceptar", { method: "POST", body: JSON.stringify({ codigoBanco: BANCO_PINZA }) });
    assert.equal(sinProducto.status, 400);

    const sinCodigos = await llamar(negocioA, "/fotos-sugeridas/descartar", { method: "POST", body: JSON.stringify({ productoId: pinza.id, codigosBanco: [] }) });
    assert.equal(sinCodigos.status, 400);
});
