// "Reportar un problema" del comprador (Nexo Market, solo tiendas con la funcion "Vender en Market").
// Un reporte por pedido: se guarda y se avisa a Nexo por correo, con los datos de la tienda y del comprador para mediar.
const { enviarCorreoReporteMarket } = require("./email");

const MOTIVOS_REPORTE = {
    no_entregado: "No me entregaron mi pedido",
    incompleto: "Llego incompleto o equivocado",
    mal_estado: "El producto esta en mal estado",
    cobro: "Problema con el cobro",
    otro: "Otro"
};

let tablaLista = false;
async function asegurarTabla(pool) {
    if (tablaLista) return;
    await pool.query(`CREATE TABLE IF NOT EXISTS public.market_reportes (
        id SERIAL PRIMARY KEY,
        pedido_market_id INTEGER NOT NULL UNIQUE,
        negocio_id INTEGER NOT NULL,
        motivo TEXT NOT NULL,
        detalle TEXT,
        creado_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
    tablaLista = true;
}

async function yaReportado(pool, pedidoId) {
    await asegurarTabla(pool);
    return (await pool.query("SELECT 1 FROM public.market_reportes WHERE pedido_market_id = $1", [pedidoId])).rows.length > 0;
}

// Devuelve { estado, cuerpo } para responder. `pedido` es la fila de pedidos_market con los datos de la tienda.
async function registrarReporte(pool, pedido, datos) {
    if (!pedido.es_vendedor) return { estado: 404, cuerpo: { ok: false, error: "Pedido no encontrado" } };

    const motivo = String(datos?.motivo || "");
    const detalle = String(datos?.detalle || "").trim().slice(0, 1000);
    if (!Object.prototype.hasOwnProperty.call(MOTIVOS_REPORTE, motivo)) return { estado: 400, cuerpo: { ok: false, error: "Elige que paso." } };
    if (detalle.length < 10) return { estado: 400, cuerpo: { ok: false, error: "Cuentanos un poco mas (minimo 10 letras)." } };

    await asegurarTabla(pool);
    const guardado = await pool.query(
        `INSERT INTO public.market_reportes (pedido_market_id, negocio_id, motivo, detalle) VALUES ($1, $2, $3, $4)
         ON CONFLICT (pedido_market_id) DO NOTHING RETURNING id`,
        [pedido.id, pedido.negocio_id, motivo, detalle]
    );
    if (!guardado.rows.length) return { estado: 200, cuerpo: { ok: true, repetido: true } };

    enviarCorreoReporteMarket({
        codigo: pedido.codigo_recogida, total: pedido.total, estadoPedido: pedido.estado,
        motivo: MOTIVOS_REPORTE[motivo], detalle,
        tienda: pedido.negocio_nombre, tiendaTelefono: pedido.negocio_telefono, tiendaCorreo: pedido.negocio_correo,
        cliente: pedido.cliente_nombre, clienteTelefono: pedido.cliente_telefono, clienteCorreo: pedido.cliente_correo
    }).catch(error => console.warn("No se pudo avisar el reporte de Market:", error.message));

    return { estado: 200, cuerpo: { ok: true } };
}

module.exports = { MOTIVOS_REPORTE, yaReportado, registrarReporte };
