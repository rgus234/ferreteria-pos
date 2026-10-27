// Mapa de la tienda: estantes y bodega con codigo propio; un producto exhibido y en bodega. Requiere la migracion 20261103_ubicaciones.sql.
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { pool, crearNegocioPrueba, crearProductoPrueba, borrarNegocioPrueba } = require("./helpers/negocio-prueba");
const { iniciarServidorPrueba, detenerServidorPrueba, BASE_URL } = require("./helpers/servidor-prueba");
const { nuevoCodigo, rutaDe, textoUbicacion } = require("../ubicaciones-server");

let A, B, pija, broca;
const llamar = async (negocio, ruta, opciones = {}) => {
    const r = await fetch(`${BASE_URL}${ruta}`, { ...opciones, headers: { "Content-Type": "application/json", "x-dispositivo-token": negocio.token } });
    return { status: r.status, cuerpo: await r.json() };
};
const crear = (negocio, datos) => llamar(negocio, "/ubicaciones", { method: "POST", body: JSON.stringify(datos) });

before(async () => {
    await iniciarServidorPrueba();
    A = await crearNegocioPrueba("ubicaciones-a");
    B = await crearNegocioPrueba("ubicaciones-b");
    pija = await crearProductoPrueba(A.negocioId, { nombre: "Pija punta broca 1", precio: 85, stock: 40 });
    broca = await crearProductoPrueba(A.negocioId, { nombre: "Broca 1/4", precio: 35, stock: 10 });
});

after(async () => {
    for (const n of [A, B]) if (n) { await pool.query(`UPDATE public.productos SET ubicacion_id = NULL, ubicacion_bodega_id = NULL WHERE negocio_id = $1`, [n.negocioId]); await borrarNegocioPrueba(n.negocioId); }
    await detenerServidorPrueba();
    await pool.end();
});

test("el codigo lleva prefijo propio, no se parece al de un producto y la ruta se arma de arriba hacia abajo", () => {
    assert.match(nuevoCodigo(), /^UB-[A-Z2-9]{6}$/);
    assert.notEqual(nuevoCodigo(), nuevoCodigo());

    const lista = [{ id: 1, nombre: "Pasillo 1", zona: "tienda", padre_id: null }, { id: 2, nombre: "Estante 2", zona: "tienda", padre_id: 1 }];
    const porId = new Map(lista.map(f => [f.id, f]));

    assert.equal(rutaDe(lista[1], porId), "Tienda › Pasillo 1 › Estante 2");
    assert.equal(textoUbicacion("Tienda › Pasillo 1 › Estante 2", "Bodega › Seccion A › Rack 3"), "Tienda › Pasillo 1 › Estante 2 · Bodega: Seccion A › Rack 3");
    assert.equal(textoUbicacion("", ""), "");
});

let pasillo, estante, seccion, rack;

test("crear pasillos y estantes en la tienda y secciones en la bodega, cada uno con su codigo", async () => {
    pasillo = (await crear(A, { nombre: "Pasillo 1", zona: "tienda", tipo: "pasillo" })).cuerpo.ubicacion;
    estante = (await crear(A, { nombre: "Estante 2", zona: "tienda", tipo: "estante", padreId: pasillo.id })).cuerpo.ubicacion;
    seccion = (await crear(A, { nombre: "Sección A", zona: "bodega", tipo: "seccion" })).cuerpo.ubicacion;
    rack = (await crear(A, { nombre: "Rack 3", zona: "bodega", tipo: "rack", padreId: seccion.id })).cuerpo.ubicacion;

    assert.equal(estante.ruta, "Tienda › Pasillo 1 › Estante 2");
    assert.equal(rack.ruta, "Bodega › Sección A › Rack 3");
    assert.equal(new Set([pasillo.codigo, estante.codigo, seccion.codigo, rack.codigo]).size, 4, "codigos distintos");

    const lista = (await llamar(A, "/ubicaciones")).cuerpo.ubicaciones;
    assert.equal(lista.length, 4);
});

test("validaciones: nombre obligatorio, tienda y bodega no se mezclan, y otro negocio no ve nada", async () => {
    assert.equal((await crear(A, { nombre: "  " })).status, 400);
    const mezcla = await crear(A, { nombre: "Estante raro", zona: "tienda", padreId: seccion.id });
    assert.equal(mezcla.status, 400, "un lugar de la tienda no cuelga de la bodega");

    assert.deepEqual((await llamar(B, "/ubicaciones")).cuerpo.ubicaciones, []);
    assert.equal((await llamar(B, `/ubicaciones/codigo/${estante.codigo}`)).status, 404, "el codigo de otro negocio no existe aqui");
    assert.equal((await crear(B, { nombre: "Colgado", padreId: pasillo.id })).status, 404);
});

test("escanear un codigo de estante devuelve el lugar (sin importar mayusculas)", async () => {
    const r = await llamar(A, `/ubicaciones/codigo/${estante.codigo.toLowerCase()}`);

    assert.equal(r.status, 200);
    assert.equal(r.cuerpo.ubicacion.id, estante.id);
    assert.equal((await llamar(A, "/ubicaciones/codigo/NO-EXISTE")).status, 404);
});

test("un producto exhibido y en bodega: se guardan los dos lugares y el texto de ubicacion se mantiene", async () => {
    const enTienda = await llamar(A, `/ubicaciones/${estante.id}/asignar`, { method: "POST", body: JSON.stringify({ productoIds: [pija.id, broca.id] }) });
    const enBodega = await llamar(A, `/ubicaciones/${rack.id}/asignar`, { method: "POST", body: JSON.stringify({ productoIds: [pija.id] }) });

    assert.equal(enTienda.cuerpo.asignados, 2);
    assert.equal(enBodega.cuerpo.asignados, 1);

    const fila = (await pool.query(`SELECT ubicacion, ubicacion_id, ubicacion_bodega_id, stock FROM public.productos WHERE id = $1`, [pija.id])).rows[0];
    assert.equal(fila.ubicacion_id, estante.id);
    assert.equal(fila.ubicacion_bodega_id, rack.id);
    assert.equal(fila.ubicacion, "Tienda › Pasillo 1 › Estante 2 · Bodega: Sección A › Rack 3");
    assert.equal(Number(fila.stock), 40, "el total para vender no cambia");

    const solo = (await pool.query(`SELECT ubicacion FROM public.productos WHERE id = $1`, [broca.id])).rows[0];
    assert.equal(solo.ubicacion, "Tienda › Pasillo 1 › Estante 2");

    const delEstante = (await llamar(A, `/ubicaciones/${estante.id}/productos`)).cuerpo.productos;
    assert.deepEqual(delEstante.map(p => p.nombre).sort(), ["Broca 1/4", "Pija punta broca 1"]);
    assert.ok(delEstante.every(p => p.exhibido && !p.enBodega));

    const conteo = (await llamar(A, "/ubicaciones")).cuerpo.ubicaciones.find(u => u.id === estante.id);
    assert.equal(conteo.productos, 2);
});

test("renombrar un estante actualiza el texto de sus productos; no se puede mover dentro de si mismo", async () => {
    assert.equal((await llamar(A, `/ubicaciones/${estante.id}`, { method: "PATCH", body: JSON.stringify({ nombre: "Estante 5" }) })).status, 200);
    assert.equal((await pool.query(`SELECT ubicacion FROM public.productos WHERE id = $1`, [broca.id])).rows[0].ubicacion, "Tienda › Pasillo 1 › Estante 5");

    const ciclo = await llamar(A, `/ubicaciones/${pasillo.id}`, { method: "PATCH", body: JSON.stringify({ padreId: estante.id }) });
    assert.equal(ciclo.status, 400, "no se puede meter un pasillo dentro de su propio estante");
});

test("borrar un lugar con productos pide confirmar y los productos se quedan sin lugar (no se borran)", async () => {
    const sinConfirmar = await llamar(A, `/ubicaciones/${pasillo.id}`, { method: "DELETE" });
    assert.equal(sinConfirmar.status, 409);
    assert.equal(sinConfirmar.cuerpo.productos, 2);

    const borrado = await llamar(A, `/ubicaciones/${pasillo.id}?confirmar=1`, { method: "DELETE" });
    assert.equal(borrado.status, 200);

    const fila = (await pool.query(`SELECT ubicacion, ubicacion_id, ubicacion_bodega_id, stock FROM public.productos WHERE id = $1`, [pija.id])).rows[0];
    assert.equal(fila.ubicacion_id, null, "ya no tiene estante");
    assert.equal(fila.ubicacion_bodega_id, rack.id, "su bodega sigue");
    assert.equal(fila.ubicacion, "Bodega: Sección A › Rack 3");
    assert.equal(Number(fila.stock), 40);
    assert.equal((await pool.query(`SELECT ubicacion FROM public.productos WHERE id = $1`, [broca.id])).rows[0].ubicacion, "", "sin ningun lugar se limpia el texto");
});

test("la hoja de etiquetas con QR sale como PDF valido, de todo el mapa o de un solo lugar", async () => {
    const todo = await llamar(A, "/ubicaciones/etiquetas", { method: "POST", body: JSON.stringify({}) });
    assert.equal(todo.status, 200);
    assert.equal(todo.cuerpo.total, 2, "quedan la seccion y el rack (el pasillo se llevo su estante)");
    assert.equal(Buffer.from(todo.cuerpo.pdfBase64, "base64").subarray(0, 4).toString(), "%PDF");

    const uno = await llamar(A, "/ubicaciones/etiquetas", { method: "POST", body: JSON.stringify({ ids: [rack.id] }) });
    assert.equal(uno.cuerpo.total, 1);

    const vacio = await llamar(B, "/ubicaciones/etiquetas", { method: "POST", body: JSON.stringify({}) });
    assert.equal(vacio.status, 400, "otro negocio sin lugares no recibe nada");
});
