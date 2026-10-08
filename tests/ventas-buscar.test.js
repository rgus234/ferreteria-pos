// GET /ventas/buscar: la busqueda ligera que usa "Buscar venta" en /dueno.
// /historial devuelve todas las ventas del negocio sin paginar, no sirve
// para buscar desde un telefono. Lo delicado: que la ruta no la capture
// /ventas/:id (Express toma "buscar" como si fuera un id) y que nunca
// mezcle ventas de otro negocio.

const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { pool, crearNegocioPrueba, borrarNegocioPrueba } = require("./helpers/negocio-prueba");
const { iniciarServidorPrueba, detenerServidorPrueba, BASE_URL } = require("./helpers/servidor-prueba");

let negocio;
let otroNegocio;

function headers(negocioPrueba = negocio) {
    return { "Content-Type": "application/json", "x-dispositivo-token": negocioPrueba.token };
}

// idx_historial_ventas_codigo_publico es unico en TODA la base, no por
// negocio -- dos negocios de prueba con el mismo folio necesitan codigos distintos.
function codigoPublicoDePrueba(negocioId, folio) {
    return `T${negocioId}F${folio.replace(/\D/g, "")}`;
}

async function insertarVenta(negocioId, { folio, cliente, total, fecha, estado = "completada" }) {
    await pool.query(
        `INSERT INTO public.historial_ventas (negocio_id, folio, total, metodo_pago, estado, cliente_nombre, productos, fecha, codigo_publico)
         VALUES ($1, $2, $3, 'efectivo', $4, $5, '[]'::jsonb, $6, $7)`,
        [negocioId, folio, total, estado, cliente, fecha, codigoPublicoDePrueba(negocioId, folio)]
    );
}

before(async () => {
    await iniciarServidorPrueba();
    negocio = await crearNegocioPrueba("ventas-buscar");
    otroNegocio = await crearNegocioPrueba("ventas-buscar-otro");

    await insertarVenta(negocio.negocioId, { folio: "V-900001", cliente: "Maria Lopez", total: 120, fecha: "2026-09-01T15:00:00Z" });
    await insertarVenta(negocio.negocioId, { folio: "V-900002", cliente: "Pedro Ramos", total: 340, fecha: "2026-09-02T15:00:00Z" });
    await insertarVenta(negocio.negocioId, { folio: "V-900003", cliente: "Maria Lopez", total: 55, fecha: "2026-09-02T18:00:00Z", estado: "cancelada" });
    await insertarVenta(otroNegocio.negocioId, { folio: "V-900001", cliente: "Maria Lopez", total: 999, fecha: "2026-09-02T15:00:00Z" });
});

after(async () => {
    if (negocio) await borrarNegocioPrueba(negocio.negocioId);
    if (otroNegocio) await borrarNegocioPrueba(otroNegocio.negocioId);
    await detenerServidorPrueba();
    await pool.end();
});

async function buscar(parametros = "", negocioPrueba = negocio) {
    const respuesta = await fetch(`${BASE_URL}/ventas/buscar${parametros}`, { headers: headers(negocioPrueba) });
    return { status: respuesta.status, cuerpo: await respuesta.json() };
}

test("/ventas/buscar existe y no la captura /ventas/:id", async () => {
    const { status, cuerpo } = await buscar();
    assert.equal(status, 200);
    assert.equal(cuerpo.ok, true);
    assert.equal(cuerpo.ventas.length, 3, "sin filtros trae las ventas de este negocio, mas recientes primero");
    assert.equal(cuerpo.ventas[0].folio, "V-900003");
});

test("busca por folio, por cliente (sin importar mayusculas) y por dia", async () => {
    const porFolio = await buscar("?q=900002");
    assert.deepEqual(porFolio.cuerpo.ventas.map(v => v.folio), ["V-900002"]);

    const porCliente = await buscar("?q=maria");
    assert.deepEqual(porCliente.cuerpo.ventas.map(v => v.folio).sort(), ["V-900001", "V-900003"]);

    const porDia = await buscar("?dia=2026-09-02");
    assert.deepEqual(porDia.cuerpo.ventas.map(v => v.folio).sort(), ["V-900002", "V-900003"]);

    const combinado = await buscar("?q=maria&dia=2026-09-02");
    assert.deepEqual(combinado.cuerpo.ventas.map(v => v.folio), ["V-900003"]);
});

test("las ventas canceladas aparecen marcadas, y trae el codigo del ticket digital", async () => {
    const { cuerpo } = await buscar("?q=900003");
    assert.equal(cuerpo.ventas[0].estado, "cancelada");
    assert.equal(cuerpo.ventas[0].codigo_publico, codigoPublicoDePrueba(negocio.negocioId, "V-900003"));
});

test("nunca mezcla ventas de otro negocio, aunque compartan folio y cliente", async () => {
    const { cuerpo } = await buscar("?q=900001");
    assert.equal(cuerpo.ventas.length, 1);
    assert.equal(Number(cuerpo.ventas[0].total), 120, "es la venta de este negocio, no la de $999 del otro");

    const delOtro = await buscar("?q=900001", otroNegocio);
    assert.equal(Number(delOtro.cuerpo.ventas[0].total), 999);
});

test("un parametro de dia mal formado se ignora en vez de tronar, y el limite se respeta", async () => {
    const malDia = await buscar("?dia=ayer");
    assert.equal(malDia.status, 200);
    assert.equal(malDia.cuerpo.ventas.length, 3);

    const conLimite = await buscar("?limite=1");
    assert.equal(conLimite.cuerpo.ventas.length, 1);
});
