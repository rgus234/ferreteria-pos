// Autofactura: el cliente factura su ticket con codigo + total. La logica se prueba con un Facturama de mentira
// (inyectado) para no timbrar nada de verdad ni mandar correos; corre contra la base real en un negocio sintetico.
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { pool, crearNegocioPrueba, borrarNegocioPrueba } = require("./helpers/negocio-prueba");
const autofactura = require("../autofactura");

let negocio;
const CODIGO = `AUTOFAC${Date.now()}`;
const RECEPTOR = { rfc: "XEXX010101AB1".replace("XEXX", "ABCD"), nombre: "Juan Perez Lopez", regimenFiscal: "612", codigoPostal: "34000", usoCfdi: "G03", correo: "cliente@example.com" };

async function crearVenta(overrides = {}) {
    const codigo = overrides.codigo || `${CODIGO}${Math.floor(Math.random() * 1e6)}`;
    const fila = await pool.query(
        `INSERT INTO public.historial_ventas (negocio_id, total, subtotal, descuento, metodo_pago, productos, estado, codigo_publico, folio, fecha)
         VALUES ($1, $2, $2, $3, $4, $5::jsonb, $6, $7, $7, $8) RETURNING id`,
        [negocio.negocioId, overrides.total ?? 116, overrides.descuento ?? 0, overrides.metodo || "efectivo",
         JSON.stringify([{ nombre: "Martillo", cantidad: 1, precio: overrides.total ?? 116, importe: overrides.total ?? 116 }]),
         overrides.estado || "completada", codigo, overrides.fecha || new Date()]
    );
    return { id: fila.rows[0].id, codigo };
}

const depsOk = () => {
    const llamadas = { cfdi: 0, correo: 0, ultimoCorreo: null };
    return {
        llamadas,
        crearCfdi: async () => { llamadas.cfdi += 1; return { ok: true, factura: { serie: "A", folio: String(llamadas.cfdi), uuid: `UUID-${Date.now()}-${llamadas.cfdi}`, xml: "<cfdi/>", facturamaId: "fx1" } }; },
        descargarXmlCfdi: async () => ({ ok: false }),
        enviarCorreoFacturaCfdi: async (correo, emisor, datos) => { llamadas.correo += 1; llamadas.ultimoCorreo = { correo, datos }; return { ok: true }; }
    };
};

before(async () => {
    negocio = await crearNegocioPrueba("autofactura");
    await pool.query(
        `UPDATE public.negocios SET rfc = 'AAA010101AAA', razon_social = 'NEGOCIO PRUEBA SA', regimen_fiscal = '601', codigo_postal_fiscal = '34000',
                facturacion_activa = true, funciones_beta = '{"autofactura": true}'::jsonb WHERE id = $1`, [negocio.negocioId]);
});

after(async () => {
    if (negocio) await borrarNegocioPrueba(negocio.negocioId);
    await pool.end();
});

test("consultar: codigo o total equivocado no revela nada", async () => {
    const v = await crearVenta();
    assert.equal((await autofactura.consultar(pool, { codigo: v.codigo, total: "999" })).ok, false);
    assert.equal((await autofactura.consultar(pool, { codigo: "NOEXISTE", total: "116" })).ok, false);
    const bien = await autofactura.consultar(pool, { codigo: v.codigo.toLowerCase(), total: "$116.00" });
    assert.equal(bien.ok, true);
    assert.equal(bien.estado, "disponible");
    assert.equal(bien.venta.total, 116);
});

test("consultar: no disponible si el negocio no la encendio, si hay descuento, credito, cancelada o fuera de plazo", async () => {
    const descuento = await crearVenta({ descuento: 10 });
    assert.equal((await autofactura.consultar(pool, { codigo: descuento.codigo, total: "116" })).estado, "no_disponible");
    const credito = await crearVenta({ metodo: "credito" });
    assert.match((await autofactura.consultar(pool, { codigo: credito.codigo, total: "116" })).motivo, /crédito/);
    const cancelada = await crearVenta({ estado: "cancelada" });
    assert.equal((await autofactura.consultar(pool, { codigo: cancelada.codigo, total: "116" })).estado, "no_disponible");
    const vieja = await crearVenta({ fecha: new Date(Date.now() - 45 * 86400000) });
    assert.match((await autofactura.consultar(pool, { codigo: vieja.codigo, total: "116" })).motivo, /plazo/);

    await pool.query(`UPDATE public.negocios SET funciones_beta = '{"_todas": true}'::jsonb WHERE id = $1`, [negocio.negocioId]);
    const apagada = await crearVenta();
    assert.equal((await autofactura.consultar(pool, { codigo: apagada.codigo, total: "116" })).estado, "no_disponible", "_todas no la enciende sola");
    await pool.query(`UPDATE public.negocios SET funciones_beta = '{"autofactura": true}'::jsonb WHERE id = $1`, [negocio.negocioId]);
});

test("emitir: valida al receptor antes de tocar al PAC", async () => {
    const v = await crearVenta();
    const deps = depsOk();
    for (const cambio of [{ rfc: "XAXX010101000" }, { rfc: "ABC" }, { nombre: "" }, { regimenFiscal: "" }, { codigoPostal: "12" }, { correo: "no-es-correo" }]) {
        const r = await autofactura.emitir(pool, deps, { codigo: v.codigo, total: "116", receptor: { ...RECEPTOR, ...cambio } });
        assert.equal(r.ok, false, JSON.stringify(cambio));
    }
    assert.equal(deps.llamadas.cfdi, 0);
});

test("emitir: timbra, guarda, manda PDF+XML al correo y una segunda vez ya no timbra", async () => {
    const v = await crearVenta();
    const deps = depsOk();
    const r = await autofactura.emitir(pool, deps, { codigo: v.codigo, total: "116", receptor: RECEPTOR });
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.equal(r.correoEnviado, true);
    assert.equal(deps.llamadas.cfdi, 1);
    assert.ok(Buffer.isBuffer(deps.llamadas.ultimoCorreo.datos.pdfContent) && deps.llamadas.ultimoCorreo.datos.pdfContent.slice(0, 4).toString() === "%PDF", "adjunta un PDF real");
    assert.equal(deps.llamadas.ultimoCorreo.datos.xmlContent, "<cfdi/>");

    const fila = (await pool.query(`SELECT estado, creado_por, receptor_rfc FROM public.facturas_cfdi WHERE historial_venta_id = $1`, [v.id])).rows[0];
    assert.equal(fila.estado, "timbrada");
    assert.equal(fila.creado_por, "Autofactura (cliente)");

    const otra = await autofactura.emitir(pool, deps, { codigo: v.codigo, total: "116", receptor: RECEPTOR });
    assert.equal(otra.ok, false);
    assert.equal(deps.llamadas.cfdi, 1, "no se vuelve a timbrar");

    const c = await autofactura.consultar(pool, { codigo: v.codigo, total: "116" });
    assert.equal(c.estado, "facturada");
    assert.ok(c.factura.correo.includes("•"), "el correo sale enmascarado");
    const archivo = await autofactura.facturaPorCodigo(pool, { codigo: v.codigo, total: "116" });
    assert.ok(archivo && archivo.xml_cfdi === "<cfdi/>");
});

test("emitir: dos clics al mismo tiempo timbran una sola vez", async () => {
    const v = await crearVenta();
    const deps = depsOk();
    const [a, b] = await Promise.all([
        autofactura.emitir(pool, deps, { codigo: v.codigo, total: "116", receptor: RECEPTOR }),
        autofactura.emitir(pool, deps, { codigo: v.codigo, total: "116", receptor: RECEPTOR })
    ]);
    assert.equal([a, b].filter(x => x.ok).length, 1);
    assert.equal(deps.llamadas.cfdi, 1);
});

test("emitir: si el PAC rechaza, queda el intento con su error y se puede reintentar", async () => {
    const v = await crearVenta();
    const malo = { crearCfdi: async () => ({ ok: false, error: "El RFC del receptor no existe" }), descargarXmlCfdi: async () => ({ ok: false }), enviarCorreoFacturaCfdi: async () => ({ ok: true }) };
    const r = await autofactura.emitir(pool, malo, { codigo: v.codigo, total: "116", receptor: RECEPTOR });
    assert.equal(r.ok, false);
    assert.match(r.error, /Constancia/);
    assert.equal((await pool.query(`SELECT estado FROM public.facturas_cfdi WHERE historial_venta_id = $1`, [v.id])).rows[0].estado, "error");
    const bien = await autofactura.emitir(pool, depsOk(), { codigo: v.codigo, total: "116", receptor: RECEPTOR });
    assert.equal(bien.ok, true);
});
