// Unir proveedores: el detector sugiere los repetidos (con los nombres reales de una ferreteria) y la union mueve productos y facturas,
// deja a los demas inactivos, no toca a otros negocios y se puede deshacer sin pisar lo que cambio despues.
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { grupoDeDuplicados, parecidos } = require("../proveedores-duplicados");
const { pool, crearNegocioPrueba, borrarNegocioPrueba, crearProductoPrueba } = require("./helpers/negocio-prueba");
const { iniciarServidorPrueba, detenerServidorPrueba, BASE_URL } = require("./helpers/servidor-prueba");

let negocio;
let otro;
const headers = n => ({ "Content-Type": "application/json", "x-dispositivo-token": n.token });
const api = async (n, ruta, cuerpo) => { const r = await fetch(`${BASE_URL}${ruta}`, { method: cuerpo ? "POST" : "GET", headers: headers(n), ...(cuerpo ? { body: JSON.stringify(cuerpo) } : {}) }); return { estado: r.status, datos: await r.json().catch(() => ({})) }; };
const prov = async (n, nombre) => (await pool.query(`INSERT INTO public.proveedores (negocio_id, nombre) VALUES ($1, $2) RETURNING id`, [n.negocioId, nombre])).rows[0].id;
const fila = async id => (await pool.query(`SELECT proveedor_id, proveedor FROM public.productos WHERE id = $1`, [id])).rows[0];
const activo = async id => (await pool.query(`SELECT activo FROM public.proveedores WHERE id = $1`, [id])).rows[0].activo;

test("el detector junta los nombres repetidos de una ferreteria real y deja aparte los que no lo son", () => {
    const nombres = ["Diprofer", "DIPROFER MX", "DTC", "DTC AGUASCALIENTES", "DTC AGUACALIENTES", "Gafi", "Gagi", "GAF", "GAI", "ESMA", "Esam", "ESMA FERRETERO", "TORNILLIN", "Tortillin", "Toenillin",
        "Mallas San Luis", "Malla  San Luis", "PROBEDOR SAN LUIS", "sanlus", "Foset", "MOCTEZUMA", "WESTON", "CEMOZAC", "004BE Durango   Lista de precio    01 Diciembre 2025"];
    const grupos = grupoDeDuplicados(nombres.map((nombre, i) => ({ id: i + 1, nombre, productos: 10 - (i % 3), facturas: 0 })));
    const nombresDe = g => g.map(p => p.nombre).sort();

    assert.equal(grupos.length, 6);
    assert.deepEqual(nombresDe(grupos.find(g => g.some(p => p.nombre === "Diprofer"))), ["DIPROFER MX", "Diprofer"]);
    assert.equal(grupos.find(g => g.some(p => p.nombre === "DTC")).length, 3);
    assert.equal(grupos.find(g => g.some(p => p.nombre === "Gafi")).length, 4);
    assert.equal(grupos.find(g => g.some(p => p.nombre === "ESMA")).length, 3);
    assert.equal(grupos.find(g => g.some(p => p.nombre === "TORNILLIN")).length, 3);
    assert.equal(grupos.find(g => g.some(p => p.nombre === "Mallas San Luis")).length, 4, "Mallas San Luis, Malla San Luis, PROBEDOR SAN LUIS y sanlus");

    const aparte = ["Foset", "MOCTEZUMA", "WESTON", "CEMOZAC"];
    aparte.forEach(n => assert.ok(!grupos.some(g => g.some(p => p.nombre === n)), `${n} no debe agruparse`));
});

test("proveedores distintos no se confunden", () => {
    assert.equal(parecidos("Truper", "Foset"), false);
    assert.equal(parecidos("Sabritas", "Sabritas Distribuidor SA de CV"), true);
    assert.equal(parecidos("DTC", "DTM"), false);
    assert.equal(parecidos("Bimbo", "Barcel"), false);
});

before(async () => {
    await iniciarServidorPrueba();
    negocio = await crearNegocioPrueba("unir-prov");
    otro = await crearNegocioPrueba("unir-prov-otro");
});

after(async () => {
    for (const n of [negocio, otro]) if (n) { await pool.query(`DELETE FROM public.proveedores_unidos WHERE negocio_id = $1`, [n.negocioId]).catch(() => {}); await borrarNegocioPrueba(n.negocioId); }
    await detenerServidorPrueba();
    await pool.end();
});

test("unir pasa los productos al que se queda, deja al otro inactivo y completa su contacto; no toca a otro negocio", async () => {
    const diprofer = await prov(negocio, "Diprofer");
    const mx = await prov(negocio, "DIPROFER MX");
    await pool.query(`UPDATE public.proveedores SET telefono = '4491234567' WHERE id = $1`, [mx]);
    const ajeno = await prov(otro, "DIPROFER MX");

    const a = await crearProductoPrueba(negocio.negocioId, { nombre: "Martillo uni", precio: 100, stock: 3 });
    const b = await crearProductoPrueba(negocio.negocioId, { nombre: "Pinza uni", precio: 80, stock: 4 });
    const c = await crearProductoPrueba(otro.negocioId, { nombre: "Producto ajeno uni", precio: 10, stock: 1 });
    await pool.query(`UPDATE public.productos SET proveedor_id = $1, proveedor = 'DIPROFER MX' WHERE id = ANY($2::int[])`, [mx, [a.id, b.id]]);
    await pool.query(`UPDATE public.productos SET proveedor_id = $1, proveedor = 'DIPROFER MX' WHERE id = $2`, [ajeno, c.id]);

    const sugeridos = await api(negocio, "/proveedores/duplicados");
    assert.equal(sugeridos.estado, 200, JSON.stringify(sugeridos.datos));
    assert.equal(sugeridos.datos.grupos.length, 1);
    assert.equal(sugeridos.datos.grupos[0].length, 2);

    const r = await api(negocio, "/proveedores/unir", { destinoId: diprofer, origenIds: [mx], usuario: "Prueba" });
    assert.equal(r.estado, 200, JSON.stringify(r.datos));
    assert.equal(r.datos.productos, 2);

    for (const p of [a, b]) { const f = await fila(p.id); assert.deepEqual([Number(f.proveedor_id), f.proveedor], [diprofer, "Diprofer"]); }
    assert.equal(await activo(mx), false, "el unido queda inactivo, no se borra");
    assert.equal(await activo(diprofer), true);
    assert.equal((await pool.query(`SELECT telefono FROM public.proveedores WHERE id = $1`, [diprofer])).rows[0].telefono, "4491234567", "se completa el telefono que le faltaba");
    assert.equal(Number((await fila(c.id)).proveedor_id), ajeno, "el otro negocio no cambio");
    assert.equal(await activo(ajeno), true);

    const hist = await api(negocio, "/proveedores/uniones");
    assert.equal(hist.datos.uniones.length, 1);
    assert.deepEqual([hist.datos.uniones[0].destino, hist.datos.uniones[0].productos, hist.datos.uniones[0].deshecho], ["Diprofer", 2, false]);
});

test("deshacer regresa cada proveedor con sus productos, pero no pisa lo que se movio despues", async () => {
    const hist = await api(negocio, "/proveedores/uniones");
    const lote = hist.datos.uniones[0].id;
    const mx = (await pool.query(`SELECT id FROM public.proveedores WHERE negocio_id = $1 AND nombre = 'DIPROFER MX'`, [negocio.negocioId])).rows[0].id;
    const productos = (await pool.query(`SELECT id FROM public.productos WHERE negocio_id = $1 AND nombre IN ('Martillo uni', 'Pinza uni') ORDER BY nombre`, [negocio.negocioId])).rows.map(r => r.id);
    const otroProv = await prov(negocio, "Gafi uni");

    // Despues de unir, alguien manda "Pinza" con otro proveedor.
    await pool.query(`UPDATE public.productos SET proveedor_id = $1, proveedor = 'Gafi uni' WHERE id = $2`, [otroProv, productos[1]]);

    const r = await api(negocio, `/proveedores/uniones/${lote}/deshacer`, {});
    assert.equal(r.estado, 200, JSON.stringify(r.datos));
    assert.equal(r.datos.productos, 1, "solo regresa el que seguia con el proveedor al que se unio");
    assert.equal(Number((await fila(productos[0])).proveedor_id), mx);
    assert.equal((await fila(productos[0])).proveedor, "DIPROFER MX");
    assert.equal(Number((await fila(productos[1])).proveedor_id), otroProv, "lo que se movio despues se respeta");
    assert.equal(await activo(mx), true);

    assert.equal((await api(negocio, `/proveedores/uniones/${lote}/deshacer`, {})).estado, 400, "una union solo se deshace una vez");
});

test("datos invalidos y proveedores ajenos se rechazan", async () => {
    const x = await prov(negocio, "Proveedor X uni");
    const ajeno = await prov(otro, "Proveedor Y uni");

    assert.equal((await api(negocio, "/proveedores/unir", { destinoId: x, origenIds: [] })).estado, 400);
    assert.equal((await api(negocio, "/proveedores/unir", { destinoId: x, origenIds: [x] })).estado, 400, "no se une consigo mismo");
    assert.equal((await api(negocio, "/proveedores/unir", { destinoId: x, origenIds: [ajeno] })).estado, 404, "un proveedor de otro negocio no se puede unir");
    assert.equal(await activo(ajeno), true);
});
