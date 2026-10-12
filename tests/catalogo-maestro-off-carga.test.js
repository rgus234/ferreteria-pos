// La carga de identidad de abarrotes (Open Food Facts) usa el MISMO motor de
// reconciliacion que ferreteria. Estas pruebas verifican, contra la base real
// con EAN sinteticos, lo nuevo: que la fila nace con origen 'open_food_facts',
// presentacion y categoria; que un EAN ya conocido no se duplica ni se
// sobrescribe; que lo de ferreteria sigue entrando como 'fabricante'; y que la
// carga se puede revertir entera.

const { test, after } = require("node:test");
const assert = require("node:assert/strict");
const pool = require("../db");
const { reconciliar, revertir, eanValido } = require("../catalogo-maestro-reconciliacion");

const corridas = [];

after(async () => {
    for (const id of corridas) {
        await pool.query(`DELETE FROM public.catalogo_maestro_productos WHERE reconciliacion_id = $1`, [id]).catch(() => {});
        await pool.query(`DELETE FROM public.catalogo_maestro_conflictos WHERE reconciliacion_id = $1`, [id]).catch(() => {});
        await pool.query(`DELETE FROM public.catalogo_maestro_reconciliaciones WHERE id = $1`, [id]).catch(() => {});
    }
    await pool.end();
});

// EAN-13 sintetico con digito verificador correcto. Prefijo 99: no lo usa
// ningun fabricante real, asi que no choca con datos de verdad.
function eanSintetico() {
    const base = "99" + String(Math.floor(Math.random() * 1e10)).padStart(10, "0");
    const digitos = base.split("").map(Number).reverse();
    const suma = digitos.reduce((acc, n, i) => acc + n * (i % 2 === 0 ? 3 : 1), 0);
    const ean = base + ((10 - (suma % 10)) % 10);
    assert.ok(eanValido(ean));
    return ean;
}

async function idSubcategoria(nombre) {
    const r = await pool.query(`SELECT id FROM public.categorias_nexo WHERE giro = 'abarrotes' AND nombre = $1`, [nombre]);
    return r.rows[0].id;
}

function filaOff(ean, extra = {}) {
    return {
        ean, codigoFabricante: "", nombre: "Refresco de cola prueba", marca: "Marca Prueba", fabricante: "Marca Prueba",
        clave: "", unidad: "", presentacion: "600 ml", fuente: "Open Food Facts", fuenteFecha: new Date("2026-10-01"),
        origen: "open_food_facts", ...extra
    };
}

test("una fila de Open Food Facts nace con su origen, presentacion y categoria", async () => {
    const ean = eanSintetico();
    const categoria = await idSubcategoria("Refrescos");

    const reporte = await reconciliar(pool, [filaOff(ean, { categoriaNexoId: categoria })], { aplicar: true, fuente: "Open Food Facts" });
    corridas.push(reporte.reconciliacionId);

    assert.equal(reporte.productosCreados, 1);

    const m = (await pool.query(`SELECT * FROM public.catalogo_maestro_productos WHERE reconciliacion_id = $1`, [reporte.reconciliacionId])).rows[0];
    assert.equal(m.codigo, ean, "sin codigo de fabricante, la identidad es el EAN");
    assert.equal(m.origen, "open_food_facts");
    assert.equal(m.presentacion, "600 ml");
    assert.equal(m.categoria_nexo_id, categoria);
    assert.equal(m.fuente_identidad, "Open Food Facts");
    assert.equal(m.imagen, null, "no se guardan fotos de OFF");

    const ident = await pool.query(`SELECT tipo, valor FROM public.catalogo_maestro_identificadores WHERE producto_maestro_id = $1`, [m.id]);
    assert.deepEqual(ident.rows, [{ tipo: "ean", valor: ean }]);
});

test("un EAN que el Maestro ya conoce no se duplica ni se sobrescribe", async () => {
    const ean = eanSintetico();
    const primera = await reconciliar(pool, [filaOff(ean, { nombre: "Nombre original del producto" })], { aplicar: true, fuente: "Open Food Facts" });
    corridas.push(primera.reconciliacionId);

    const segunda = await reconciliar(pool, [filaOff(ean, { nombre: "Nombre original del producto", presentacion: "otra" })], { aplicar: true, fuente: "Open Food Facts" });
    corridas.push(segunda.reconciliacionId);

    assert.equal(segunda.productosCreados, 0);
    assert.equal(segunda.duplicadosEvitados, 1);

    const filas = await pool.query(`SELECT presentacion FROM public.catalogo_maestro_productos WHERE ean = $1 OR codigo = $1`, [ean]);
    assert.equal(filas.rows.length, 1);
    assert.equal(filas.rows[0].presentacion, "600 ml", "lo ya cargado no se pisa");
});

test("el mismo EAN con otra marca no se fusiona: queda como conflicto para revision", async () => {
    const ean = eanSintetico();
    const primera = await reconciliar(pool, [filaOff(ean, { marca: "Marca Uno" })], { aplicar: true, fuente: "Open Food Facts" });
    corridas.push(primera.reconciliacionId);

    const segunda = await reconciliar(pool, [filaOff(ean, { marca: "Marca Dos" })], { aplicar: true, fuente: "Open Food Facts" });
    corridas.push(segunda.reconciliacionId);

    assert.equal(segunda.conflictos, 1);
    const m = (await pool.query(`SELECT necesita_revision FROM public.catalogo_maestro_productos WHERE codigo = $1`, [ean])).rows[0];
    assert.equal(m.necesita_revision, true);
});

test("una fila de fabricante (ferreteria) sigue entrando como 'fabricante' y sin categoria inventada", async () => {
    const ean = eanSintetico();
    const reporte = await reconciliar(pool, [{
        ean, codigoFabricante: "", nombre: "Pinza de prueba", marca: "Truper", fuente: "Diprofer"
    }], { aplicar: true, fuente: "Diprofer" });
    corridas.push(reporte.reconciliacionId);

    const m = (await pool.query(`SELECT origen, presentacion, categoria_nexo_id FROM public.catalogo_maestro_productos WHERE codigo = $1`, [ean])).rows[0];
    assert.equal(m.origen, "fabricante");
    assert.equal(m.presentacion, "");
    assert.equal(m.categoria_nexo_id, null);
});

test("la carga completa se puede revertir", async () => {
    const eans = [eanSintetico(), eanSintetico(), eanSintetico()];
    const reporte = await reconciliar(pool, eans.map(e => filaOff(e)), { aplicar: true, fuente: "Open Food Facts" });
    corridas.push(reporte.reconciliacionId);
    assert.equal(reporte.productosCreados, 3);

    const r = await revertir(pool, reporte.reconciliacionId);
    assert.equal(r.productosBorrados, 3);

    const quedan = await pool.query(`SELECT COUNT(*)::int n FROM public.catalogo_maestro_productos WHERE reconciliacion_id = $1`, [reporte.reconciliacionId]);
    assert.equal(quedan.rows[0].n, 0);
    const ident = await pool.query(`SELECT COUNT(*)::int n FROM public.catalogo_maestro_identificadores WHERE valor = ANY($1::text[])`, [eans]);
    assert.equal(ident.rows[0].n, 0, "los identificadores caen con el producto");
});

// ---------------------------------------------------------------------
// Carga por lotes (la que usa el importador de Open Food Facts)
// ---------------------------------------------------------------------

const { cargarMasivo } = require("../catalogo-maestro-carga-masiva");

test("la carga por lotes crea los productos con su identidad y se revierte igual que la normal", async () => {
    const categoria = await idSubcategoria("Galletas");
    const eans = [eanSintetico(), eanSintetico(), eanSintetico()];
    const filas = eans.map((ean, i) => filaOff(ean, {
        nombre: `Galleta prueba ${i}`, presentacion: i === 0 ? "" : "170 g", categoriaNexoId: i === 2 ? null : categoria
    }));

    const r = await cargarMasivo(pool, filas, { fuente: "Open Food Facts" });
    corridas.push(r.reconciliacionId);

    assert.equal(r.productosCreados, 3);
    assert.equal(r.identificadoresCreados, 3);

    const m = (await pool.query(
        `SELECT codigo, ean, nombre, marca, presentacion, categoria_nexo_id, origen, fuente_identidad, imagen, reconciliacion_id
         FROM public.catalogo_maestro_productos WHERE reconciliacion_id = $1 ORDER BY nombre`, [r.reconciliacionId]
    )).rows;
    assert.equal(m.length, 3);
    assert.equal(m[0].codigo, eans[0]);
    assert.equal(m[0].ean, eans[0]);
    assert.equal(m[0].origen, "open_food_facts");
    assert.equal(m[0].fuente_identidad, "Open Food Facts");
    assert.equal(m[0].marca, "Marca Prueba");
    assert.equal(m[0].presentacion, "");
    assert.equal(m[1].presentacion, "170 g");
    assert.equal(m[1].categoria_nexo_id, categoria);
    assert.equal(m[2].categoria_nexo_id, null);
    assert.equal(m[0].imagen, null);

    const ident = await pool.query(`SELECT tipo FROM public.catalogo_maestro_identificadores WHERE valor = ANY($1::text[])`, [eans]);
    assert.equal(ident.rows.length, 3);
    assert.ok(ident.rows.every(f => f.tipo === "ean"));

    const reg = (await pool.query(`SELECT modo, productos_creados, terminada_en FROM public.catalogo_maestro_reconciliaciones WHERE id = $1`, [r.reconciliacionId])).rows[0];
    assert.equal(reg.modo, "aplicada");
    assert.equal(reg.productos_creados, 3);
    assert.ok(reg.terminada_en);

    const rev = await revertir(pool, r.reconciliacionId);
    assert.equal(rev.productosBorrados, 3);
    const quedan = await pool.query(`SELECT COUNT(*)::int n FROM public.catalogo_maestro_identificadores WHERE valor = ANY($1::text[])`, [eans]);
    assert.equal(quedan.rows[0].n, 0);
});

test("la carga por lotes omite un EAN que el Maestro ya tiene, sin pisarlo", async () => {
    const ean = eanSintetico();
    const primera = await reconciliar(pool, [filaOff(ean, { nombre: "Producto original", presentacion: "1 kg" })], { aplicar: true, fuente: "Diprofer" });
    corridas.push(primera.reconciliacionId);

    const r = await cargarMasivo(pool, [filaOff(ean, { nombre: "Otro nombre", presentacion: "otra" })], { fuente: "Open Food Facts" });
    corridas.push(r.reconciliacionId);

    assert.equal(r.productosCreados, 0);
    assert.equal(r.duplicadosEvitados, 1);
    const m = (await pool.query(`SELECT nombre, presentacion FROM public.catalogo_maestro_productos WHERE codigo = $1`, [ean])).rows;
    assert.equal(m.length, 1);
    assert.equal(m[0].nombre, "Producto original");
    assert.equal(m[0].presentacion, "1 kg");
});

test("la carga por lotes maneja mas de un lote y se deshace completa si algo falla", async () => {
    const { LOTE } = require("../catalogo-maestro-carga-masiva");
    const eans = Array.from({ length: LOTE + 25 }, () => eanSintetico());
    const filas = eans.map((ean, i) => filaOff(ean, { nombre: `Producto lote ${i}` }));

    const r = await cargarMasivo(pool, filas, { fuente: "Open Food Facts" });
    corridas.push(r.reconciliacionId);
    assert.equal(r.productosCreados, LOTE + 25);
    await revertir(pool, r.reconciliacionId);

    // Una fila rota (nombre nulo) hace fallar el lote: no debe quedar NADA a medias.
    const antes = (await pool.query(`SELECT COUNT(*)::int n FROM public.catalogo_maestro_reconciliaciones`)).rows[0].n;
    const buenas = [filaOff(eanSintetico(), { nombre: "Buena" }), filaOff(eanSintetico(), { nombre: null })];
    await assert.rejects(() => cargarMasivo(pool, buenas, { fuente: "Open Food Facts" }));
    const despues = (await pool.query(`SELECT COUNT(*)::int n FROM public.catalogo_maestro_reconciliaciones`)).rows[0].n;
    assert.equal(despues, antes, "ni siquiera la corrida queda registrada");
    const huerfanos = await pool.query(`SELECT COUNT(*)::int n FROM public.catalogo_maestro_productos WHERE nombre = 'Buena'`);
    assert.equal(huerfanos.rows[0].n, 0);
});
