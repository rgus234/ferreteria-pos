// Importar de Truper, de punta a punta: leer la ficha -> cruzar con catalogo e inventario -> crear lo que falta ->
// foto del Banco -> armar el exhibidor (nuevo o sumando a uno que ya existe). Es la misma secuencia que hace la
// pantalla, contra el servidor real; la ficha sale de un PDF de prueba (TRUPER_FICHAS_LOCALES) para no depender de internet.

const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const PDFDocument = require("pdfkit");
const { pool, crearNegocioPrueba, crearProductoPrueba, borrarNegocioPrueba } = require("./helpers/negocio-prueba");
const { iniciarServidorPrueba, detenerServidorPrueba, BASE_URL } = require("./helpers/servidor-prueba");

let negocio, carpetaFichas, catalogoId;
const filasCatalogo = {};

const llamar = async (ruta, opciones = {}) => {
    const respuesta = await fetch(`${BASE_URL}${ruta}`, { ...opciones, headers: { "Content-Type": "application/json", "x-dispositivo-token": negocio.token } });
    return { status: respuesta.status, cuerpo: await respuesta.json() };
};

function fichaPdf(ruta) {
    return new Promise(resolver => {
        const doc = new PDFDocument();
        const salida = fs.createWriteStream(ruta);
        doc.pipe(salida);
        doc.fontSize(10).text(
            "D.R. © Truper S.A. de C.V. 2026 | Todos los derechos reservados. Exhibidor de prueba con 3 brocas CÓDIGO: 99001 CLAVE: PRUEBA-X CARACTERÍSTICAS • Para pruebas " +
            "ESPECIFICACIONES Base 31 cm INCLUYE 10 Piezas: 11110 (BAV-1/16) Broca HSS 1/16\" Trugold para metal, Truper Expert " +
            "20 Piezas: 11111 (BAV-1/8) Broca HSS 1/8\" Trugold para metal, Truper Expert " +
            "5 Piezas: 11112 (BAV-3/16) Broca HSS 3/16\" ya en el inventario " +
            "1 Pieza: 99998 (NOEXISTE) Broca que no esta en el catalogo del negocio"
        );
        doc.end();
        salida.on("finish", resolver);
    });
}

async function filaCatalogo(codigo, nombre, precio) {
    const r = await pool.query(
        `INSERT INTO public.catalogo_productos (negocio_id, catalogo_id, codigo_proveedor, codigo_interno, nombre_proveedor, marca, precio_medio_mayoreo, precio_publico)
         VALUES ($1, $2, $3, $3, $4, 'Truper', $5, $5) RETURNING id`,
        [negocio.negocioId, catalogoId, codigo, nombre, precio]
    );
    filasCatalogo[codigo] = r.rows[0].id;
}

before(async () => {
    carpetaFichas = fs.mkdtempSync(path.join(os.tmpdir(), "fichas-truper-"));
    await fichaPdf(path.join(carpetaFichas, "99001.pdf"));
    process.env.TRUPER_FICHAS_LOCALES = carpetaFichas;

    await iniciarServidorPrueba();
    negocio = await crearNegocioPrueba("exhibidores-truper");

    catalogoId = (await pool.query(`INSERT INTO public.catalogos_proveedor (negocio_id, proveedor, total_productos) VALUES ($1, 'Diprofer de prueba', 3) RETURNING id`, [negocio.negocioId])).rows[0].id;
    await filaCatalogo("11110", 'Broca HSS 1/16" Trugold para metal, Truper Expert', 18);
    await filaCatalogo("11111", 'Broca HSS 1/8" Trugold para metal, Truper Expert', 22);
    await filaCatalogo("11112", 'Broca HSS 3/16" Trugold para metal, Truper Expert', 26);

    // La 11112 ya la tiene en su inventario.
    await crearProductoPrueba(negocio.negocioId, { nombre: "Broca 3/16 que ya tenia", precio: 26, stock: 3, codigo: "11112" });
});

after(async () => {
    delete process.env.TRUPER_FICHAS_LOCALES;

    if (negocio) {
        await pool.query(`DELETE FROM public.banco_imagenes_uso WHERE negocio_id = $1`, [negocio.negocioId]);
        await pool.query(`DELETE FROM public.fotos_producto WHERE negocio_id = $1`, [negocio.negocioId]);
        await pool.query(`UPDATE public.productos SET catalogo_maestro_id = NULL WHERE negocio_id = $1`, [negocio.negocioId]);
        await pool.query(`DELETE FROM public.catalogo_maestro_productos WHERE contribuido_por_negocio_id = $1`, [negocio.negocioId]);
        await borrarNegocioPrueba(negocio.negocioId);
    }

    await detenerServidorPrueba();
    if (carpetaFichas) fs.rmSync(carpetaFichas, { recursive: true, force: true });
    await pool.end();
});

test("la ficha se cruza con el catalogo y el inventario: crear, ya lo tienes y no esta", async () => {
    const { status, cuerpo } = await llamar("/exhibidores/truper/ficha", { method: "POST", body: JSON.stringify({ codigo: "99001" }) });

    assert.equal(status, 200);
    assert.equal(cuerpo.exhibidor.codigo, "99001");
    assert.equal(cuerpo.exhibidor.clave, "PRUEBA-X");
    assert.deepEqual(cuerpo.productos.map(p => [p.codigo, p.piezas, p.estado]), [["11110", 10, "se_crea"], ["11111", 20, "se_crea"], ["11112", 5, "en_inventario"], ["99998", 1, "no_esta"]]);
    assert.ok(cuerpo.productos[2].productoId, "el que ya tiene trae su id");
    assert.ok(cuerpo.productos[0].catalogoProductoId && cuerpo.productos[0].catalogoId, "el que falta trae con que crearlo");
    assert.equal(cuerpo.productos[0].fotoEnBanco, true, "la 11110 tiene foto en el Banco de Nexo");
});

test("codigos invalidos o sin ficha dan un error claro", async () => {
    assert.equal((await llamar("/exhibidores/truper/ficha", { method: "POST", body: JSON.stringify({ codigo: "abc" }) })).status, 400);
    assert.equal((await llamar("/exhibidores/truper/ficha", { method: "POST", body: JSON.stringify({}) })).status, 400);
});

let ids = {};

test("crear lo que falta, ponerle foto del Banco y armar el exhibidor con las piezas de cada uno", async () => {
    const { cuerpo: ficha } = await llamar("/exhibidores/truper/ficha", { method: "POST", body: JSON.stringify({ codigo: "99001" }) });

    for (const p of ficha.productos.filter(x => x.estado === "se_crea")) {
        const creado = await llamar(`/catalogo-proveedor/${p.catalogoId}/productos/${p.catalogoProductoId}/crear-producto`, { method: "POST" });
        assert.equal(creado.status, 200, JSON.stringify(creado.cuerpo));
        ids[p.codigo] = creado.cuerpo.productoId;
    }

    const existente = ficha.productos.find(p => p.estado === "en_inventario");
    ids["11112"] = existente.productoId;

    const foto = await llamar("/fotos-sugeridas/aceptar", { method: "POST", body: JSON.stringify({ productoId: ids["11110"], codigoBanco: "11110" }) });
    assert.equal(foto.status, 200, JSON.stringify(foto.cuerpo));

    const espacios = ficha.productos.filter(p => ids[p.codigo]).map(p => ({ productoId: ids[p.codigo], etiqueta: p.clave.replace(/^[A-Za-z]+-/, ""), capacidad: p.piezas }));
    const exhibidor = await llamar("/exhibidores", { method: "POST", body: JSON.stringify({ nombre: ficha.exhibidor.nombre, espacios }) });

    assert.equal(exhibidor.status, 201);
    assert.deepEqual(exhibidor.cuerpo.exhibidor.espacios.map(e => [e.etiqueta, e.capacidad]), [["1/16", 10], ["1/8", 20], ["3/16", 5]]);
    assert.equal(exhibidor.cuerpo.exhibidor.espacios[0].existencia, 0, "lo nuevo entra con 0 existencias");
    assert.equal(exhibidor.cuerpo.exhibidor.espacios[2].existencia, 3, "lo que ya tenia conserva su existencia");

    const fotoGuardada = await pool.query(`SELECT 1 FROM public.fotos_producto f JOIN public.productos p ON p.codigo = f.codigo AND p.negocio_id = f.negocio_id WHERE p.id = $1`, [ids["11110"]]);
    assert.equal(fotoGuardada.rows.length, 1, "la foto del Banco quedo en el producto nuevo");
});

test("al leer otra vez la ficha ya no se vuelve a crear nada", async () => {
    const { cuerpo } = await llamar("/exhibidores/truper/ficha", { method: "POST", body: JSON.stringify({ codigo: "99001" }) });

    assert.deepEqual(cuerpo.productos.map(p => p.estado), ["en_inventario", "en_inventario", "en_inventario", "no_esta"]);
    assert.equal(cuerpo.productos[0].tieneFoto, true);
});

test("sumar el surtido a un exhibidor que ya existe: lo repetido no es error y no se duplica", async () => {
    const { cuerpo: lista } = await llamar("/exhibidores/truper/ficha", { method: "POST", body: JSON.stringify({ codigo: "99001" }) });
    const propio = await llamar("/exhibidores", { method: "POST", body: JSON.stringify({ nombre: "Mi despachador a medias", espacios: [{ productoId: ids["11110"], capacidad: 4 }] }) });
    const id = propio.cuerpo.exhibidor.id;

    const resultados = [];
    for (const p of lista.productos.filter(x => x.productoId)) {
        resultados.push((await llamar(`/exhibidores/${id}/espacios`, { method: "POST", body: JSON.stringify({ productoId: p.productoId, etiqueta: p.clave, capacidad: p.piezas }) })).status);
    }

    assert.deepEqual(resultados, [409, 200, 200], "el que ya estaba responde 409 (la pantalla lo cuenta como 'ya estaba'), los otros se suman");

    const final = await llamar(`/exhibidores/${id}`);
    assert.equal(final.cuerpo.exhibidor.espacios.length, 3);
    assert.equal(final.cuerpo.exhibidor.espacios.find(e => e.productoId === ids["11110"]).capacidad, 4, "la capacidad que ya tenia no se pisa");
});

test("un negocio no ve el catalogo ni el inventario de otro al importar", async () => {
    const otro = await crearNegocioPrueba("exhibidores-truper-otro");

    try {
        const respuesta = await fetch(`${BASE_URL}/exhibidores/truper/ficha`, { method: "POST", headers: { "Content-Type": "application/json", "x-dispositivo-token": otro.token }, body: JSON.stringify({ codigo: "99001" }) });
        const cuerpo = await respuesta.json();

        assert.deepEqual([...new Set(cuerpo.productos.map(p => p.estado))], ["no_esta"], "sin catalogo propio nada se puede crear ni enlazar");
    } finally {
        await borrarNegocioPrueba(otro.negocioId);
    }
});
