// Sugerencia de configuracion al dar de alta: copia lo que mas productos parecidos del MISMO negocio ya tienen. Solo sugiere.
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { pool, crearNegocioPrueba, crearProductoPrueba, borrarNegocioPrueba } = require("./helpers/negocio-prueba");
const { iniciarServidorPrueba, detenerServidorPrueba, BASE_URL } = require("./helpers/servidor-prueba");
const { palabrasFamilia, proponerConfiguracion, resumen } = require("../sugerencia-alta-server");

let A, B;
const llamar = async (negocio, nombre) => (await fetch(`${BASE_URL}/sugerencia-alta?nombre=${encodeURIComponent(nombre)}`, { headers: { "x-dispositivo-token": negocio.token } })).json();

async function pija(negocio, nombre, cambios = {}) {
    const p = await crearProductoPrueba(negocio.negocioId, { nombre, precio: 85, stock: 10 });
    const c = { unidad_venta: "kilo", presentacion_compra: "BOLSA", factor_conversion: 100, permite_venta_pieza: true, bascula_digital: "si", categoria: "Tornilleria", ...cambios };
    await pool.query(
        `UPDATE public.productos SET unidad_venta = $2, presentacion_compra = $3, factor_conversion = $4, permite_venta_pieza = $5, bascula_digital = $6, categoria = $7 WHERE id = $1`,
        [p.id, c.unidad_venta, c.presentacion_compra, c.factor_conversion, c.permite_venta_pieza, c.bascula_digital, c.categoria]
    );
    return p;
}

before(async () => {
    await iniciarServidorPrueba();
    A = await crearNegocioPrueba("sugerencia-a");
    B = await crearNegocioPrueba("sugerencia-b");
    await pija(A, "Pija punta broca 1\"");
    await pija(A, "Pija punta broca 1 1/2\"");
    await pija(A, "Pija punta broca 2\"");
    await pija(A, "Pija punta fina 1\"", { unidad_venta: "pieza", presentacion_compra: "CAJA", factor_conversion: 50, permite_venta_pieza: false, bascula_digital: "no" });
    await crearProductoPrueba(A.negocioId, { nombre: "Martillo bola 16 oz", precio: 120, stock: 3 });
    await pija(B, "Pija punta broca 1\"", { unidad_venta: "pieza", presentacion_compra: "COSTAL", factor_conversion: 1000 });
});

after(async () => {
    for (const n of [A, B]) if (n) await borrarNegocioPrueba(n.negocioId);
    await detenerServidorPrueba();
    await pool.end();
});

test("la familia son las palabras del nombre sin medidas, numeros ni relleno", () => {
    assert.deepEqual(palabrasFamilia('Pija punta broca 3/4"'), ["pija", "punta", "broca"]);
    assert.deepEqual(palabrasFamilia("Tapón PVC 1 1/2\""), ["tapon", "pvc"]);
    assert.deepEqual(palabrasFamilia("1/2"), []);
});

test("propone la configuracion que mas productos parecidos comparten, con evidencia y confianza", () => {
    const filas = [
        { id: 3, nombre: "A", unidad_venta: "kilo", presentacion_compra: "BOLSA", factor_conversion: 100, permite_venta_pieza: true },
        { id: 2, nombre: "B", unidad_venta: "kilo", presentacion_compra: "BOLSA", factor_conversion: 100, permite_venta_pieza: true },
        { id: 1, nombre: "C", unidad_venta: "pieza", presentacion_compra: "CAJA", factor_conversion: 50, permite_venta_pieza: false }
    ];
    const s = proponerConfiguracion(filas);

    assert.equal(s.votos, 2);
    assert.equal(s.total, 3);
    assert.equal(s.confianza, 0.67);
    assert.equal(s.configuracion.presentacion_compra, "BOLSA");
    assert.deepEqual(s.evidencia.map(e => e.coincide), [true, true, false]);
    assert.match(s.resumen, /Se compra por bolsa \(100 piezas\) · se vende por kilo y por pieza suelta/);
    assert.equal(proponerConfiguracion([]), null);
    assert.equal(resumen({}), "Sin configuración especial");
});

test("para una pija nueva sugiere como se compran y venden las pijas de ESTE negocio", async () => {
    const r = await llamar(A, "Pija punta broca 3/4\"");

    assert.equal(r.ok, true);
    assert.equal(r.sugerencia.configuracion.presentacion_compra, "BOLSA");
    assert.equal(r.sugerencia.configuracion.factor_conversion, 100);
    assert.equal(r.sugerencia.configuracion.bascula_digital, "si");
    assert.equal(r.sugerencia.votos, 3);
    assert.ok(r.sugerencia.confianza >= 0.75);
    assert.match(r.sugerencia.resumen, /bolsa/i);
});

test("nunca devuelve precios, costos, codigos ni existencias; solo como se compra y se vende", async () => {
    const r = await llamar(A, "Pija punta broca 3/4\"");
    const texto = JSON.stringify(r.sugerencia.configuracion);

    assert.doesNotMatch(texto, /precio|costo|codigo|stock\b|nombre/i);
    assert.deepEqual(Object.keys(r.sugerencia.configuracion).sort(), ["bascula_digital", "categoria", "categoria_nexo_id", "factor_conversion", "permite_venta_pieza", "piezas_por_bolsa", "presentacion_compra", "proveedor_id", "stock_minimo", "subcategoria", "unidad_suelta", "unidad_venta"].sort());
});

test("sin parecidos no inventa nada, y un negocio no usa los productos de otro", async () => {
    assert.equal((await llamar(A, "Cable THW calibre 12")).sugerencia, null);
    assert.equal((await llamar(A, "")).sugerencia, null);

    const deB = await llamar(B, "Pija punta broca 3/4\"");
    assert.equal(deB.sugerencia.configuracion.presentacion_compra, "COSTAL", "B solo ve lo suyo");
    assert.equal(deB.sugerencia.total, 1);
});
