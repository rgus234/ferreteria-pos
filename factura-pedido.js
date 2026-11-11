// Factura <-> pedido (abarrotes): la cadena Pedido -> Recibir -> Factura -> Pagar.
//
//  - compararFacturaConPedido: cuando se abre una factura, busca el pedido al que corresponde (por los productos que comparten, porque el
//    pedido se guarda con el nombre de la marca y la factura con la razon social del emisor) y arma la comparacion pedido / llego / factura,
//    con las diferencias de cantidad y de precio.
//  - recepcionesDePedidoSinFactura: las recepciones hechas contra un pedido que siguen esperando su factura (para no sumar dos veces).
//  - cuentaPorFactura: del total real de la factura sale (o se ajusta) la cuenta por pagar de la Agenda de pagos.
// Nada de esto toca a las ferreterias: solo mira pedidos y recepciones ligadas a un pedido, y la cuenta por pagar solo con la Agenda encendida.

const { agendaActiva } = require("./pago-recepcion");

const DIAS_VENTANA_PEDIDO = 45;
const num = valor => Number(valor || 0);
const redondear = valor => Math.round(num(valor) * 100) / 100;

async function itemsDeFactura(db, negocioId, facturaId) {
    const filas = await db.query(
        `SELECT i.id, i.producto_id, i.descripcion, i.cantidad, i.costo_unitario, i.accion
         FROM public.recepciones_inteligentes_items i
         JOIN public.recepciones_inteligentes r ON r.id = i.recepcion_id
         WHERE i.recepcion_id = $1 AND r.negocio_id = $2 AND COALESCE(i.accion, '') <> 'omitir'`,
        [facturaId, negocioId]
    );

    return filas.rows;
}

// Los pedidos de los ultimos dias que comparten productos con la factura (el que mas comparte, primero).
async function pedidosCandidatos(db, negocioId, productosFactura) {
    if (!productosFactura.length) return [];

    const filas = await db.query(
        `SELECT p.id, p.proveedor, p.estado, p.created_at, p.total_estimado,
                COUNT(DISTINCT i.producto_id) AS partidas,
                COUNT(DISTINCT i.producto_id) FILTER (WHERE i.producto_id = ANY($2::int[])) AS coinciden
         FROM public.pedidos_proveedor p
         JOIN public.pedidos_proveedor_items i ON i.pedido_id = p.id AND i.negocio_id = p.negocio_id
         WHERE p.negocio_id = $1
           AND p.estado <> 'cancelado'
           AND p.created_at > NOW() - INTERVAL '${DIAS_VENTANA_PEDIDO} days'
           AND NOT EXISTS (
               SELECT 1 FROM public.recepciones_mercancia rm
               WHERE rm.pedido_id = p.id AND rm.negocio_id = p.negocio_id
                 AND (rm.tipo_documento = 'factura' OR rm.notas LIKE '%conciliada con factura%')
           )
         GROUP BY p.id
         HAVING COUNT(DISTINCT i.producto_id) FILTER (WHERE i.producto_id = ANY($2::int[])) > 0
         ORDER BY COUNT(DISTINCT i.producto_id) FILTER (WHERE i.producto_id = ANY($2::int[])) DESC, p.created_at DESC
         LIMIT 5`,
        [negocioId, productosFactura]
    );

    // Un pedido solo es "el de esta factura" si comparte al menos la mitad de sus productos (o 3 o mas).
    return filas.rows
        .map(f => ({ id: f.id, proveedor: f.proveedor, estado: f.estado, fecha: f.created_at, total: num(f.total_estimado), partidas: num(f.partidas), coinciden: num(f.coinciden) }))
        .filter(f => f.coinciden >= 3 || f.coinciden >= Math.ceil(f.partidas / 2));
}

async function compararFacturaConPedido(db, negocioId, facturaId, pedidoElegido) {
    const items = await itemsDeFactura(db, negocioId, facturaId);
    const productosFactura = [...new Set(items.map(i => Number(i.producto_id)).filter(id => id > 0))];
    const candidatos = await pedidosCandidatos(db, negocioId, productosFactura);
    const elegido = Number(pedidoElegido) > 0 ? candidatos.find(c => c.id === Number(pedidoElegido)) || null : candidatos[0] || null;

    if (!elegido) return { pedido: null, candidatos, filas: [], resumen: null };

    const delPedido = (await db.query(
        `SELECT producto_id, nombre, SUM(cantidad) AS pedido, SUM(recibido) AS llego
         FROM public.pedidos_proveedor_items WHERE pedido_id = $1 AND negocio_id = $2 GROUP BY producto_id, nombre`,
        [elegido.id, negocioId]
    )).rows;

    const ids = [...new Set([...delPedido.map(f => Number(f.producto_id)), ...productosFactura])].filter(id => id > 0);
    const productos = ids.length ? (await db.query(`SELECT id, nombre, costo FROM public.productos WHERE negocio_id = $1 AND id = ANY($2::int[])`, [negocioId, ids])).rows : [];
    const productoPorId = new Map(productos.map(p => [Number(p.id), p]));

    const porProducto = new Map();
    const fila = id => {
        if (!porProducto.has(id)) porProducto.set(id, { productoId: id, nombre: (productoPorId.get(id) || {}).nombre || "Producto", pedido: 0, llego: 0, factura: 0, costoFactura: null, costoAnterior: productoPorId.has(id) && num(productoPorId.get(id).costo) > 0 ? num(productoPorId.get(id).costo) : null });
        return porProducto.get(id);
    };

    delPedido.forEach(f => { const x = fila(Number(f.producto_id)); x.pedido += num(f.pedido); x.llego += num(f.llego); if (!productoPorId.has(Number(f.producto_id))) x.nombre = f.nombre; });
    items.forEach(i => {
        const id = Number(i.producto_id);
        if (!(id > 0)) return;
        const x = fila(id);
        x.factura += num(i.cantidad);
        if (num(i.costo_unitario) > 0) x.costoFactura = num(i.costo_unitario);
    });

    const filas = [...porProducto.values()].map(x => {
        const cambioPrecio = x.costoFactura !== null && x.costoAnterior !== null && Math.abs(x.costoFactura - x.costoAnterior) / x.costoAnterior > 0.01
            ? (x.costoFactura > x.costoAnterior ? "sube" : "baja")
            : null;
        const estado = x.pedido === 0 ? "no_pedido" : (x.factura === 0 ? "no_viene" : (x.factura < x.pedido ? "menos" : (x.factura > x.pedido ? "mas" : "igual")));

        return { ...x, estado, cambioPrecio };
    }).sort((a, b) => (a.estado === "igual" && !a.cambioPrecio ? 1 : 0) - (b.estado === "igual" && !b.cambioPrecio ? 1 : 0) || a.nombre.localeCompare(b.nombre));

    const resumen = {
        productos: filas.length,
        diferencias: filas.filter(f => f.estado !== "igual").length,
        faltan: filas.filter(f => f.estado === "menos" || f.estado === "no_viene").length,
        sobran: filas.filter(f => f.estado === "mas" || f.estado === "no_pedido").length,
        preciosSuben: filas.filter(f => f.cambioPrecio === "sube").length,
        preciosBajan: filas.filter(f => f.cambioPrecio === "baja").length
    };

    return { pedido: elegido, candidatos, filas, resumen };
}

// Recepciones hechas contra un pedido que siguen "sin factura" y comparten productos con esta factura.
async function recepcionesDePedidoSinFactura(db, negocioId, facturaId, dias) {
    const items = await itemsDeFactura(db, negocioId, facturaId);
    const productos = [...new Set(items.map(i => Number(i.producto_id)).filter(id => id > 0))];

    if (!productos.length) return [];

    const filas = await db.query(
        `SELECT rm.id, rm.referencia, rm.fecha_documento, rm.total, rm.created_at
         FROM public.recepciones_mercancia rm
         WHERE rm.negocio_id = $1
           AND rm.estado = 'recibido_sin_factura'
           AND rm.pedido_id IS NOT NULL
           AND rm.created_at > NOW() - INTERVAL '${Number(dias) || 30} days'
           AND EXISTS (SELECT 1 FROM public.recepciones_mercancia_items ri WHERE ri.recepcion_id = rm.id AND ri.producto_id = ANY($2::int[]))
         ORDER BY rm.created_at DESC`,
        [negocioId, productos]
    );

    return filas.rows;
}

function sumarDias(fechaISO, dias) {
    // pg entrega las columnas DATE como Date a medianoche local: se toma su dia local, no su texto.
    const dia = fechaISO instanceof Date ? `${fechaISO.getFullYear()}-${String(fechaISO.getMonth() + 1).padStart(2, "0")}-${String(fechaISO.getDate()).padStart(2, "0")}` : String(fechaISO || "").slice(0, 10);
    const base = dia ? new Date(`${dia}T12:00:00`) : new Date();
    const d = Number.isNaN(base.getTime()) ? new Date() : base;
    d.setDate(d.getDate() + dias);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// Del total real de la factura sale la cuenta por pagar (Agenda de pagos encendida):
//  - si la recepcion ya habia quedado "a deber", la cuenta se ajusta al total de la factura (lo ya abonado se respeta);
//  - si no hay ningun pago anotado y el proveedor tiene dias de credito, nace sola con su fecha limite (fecha de la factura + dias);
//  - si se pago de contado, o el proveedor no da credito, no se crea nada.
// Nunca tumba la confirmacion: va en SAVEPOINT. Regresa { accion: "creada" | "ajustada", monto, vencimiento, proveedor } o null.
async function cuentaPorFactura(client, { negocioId, recepcionId, proveedorId, proveedorNombre, total, folio, fechaDocumento, pagoEnviado, soloFactura }) {
    const monto = redondear(total);

    // Una remision por foto trae costos estimados por IA: nunca genera deuda.
    if (!(monto > 0) || !recepcionId || soloFactura === false) return null;

    await client.query("SAVEPOINT cuenta_por_factura");

    try {
        if (!(await agendaActiva(client, negocioId))) { await client.query("RELEASE SAVEPOINT cuenta_por_factura"); return null; }

        const existe = await client.query(`SELECT to_regclass('public.cuentas_pagar') AS tabla`);
        const hayTabla = Boolean(existe.rows[0] && existe.rows[0].tabla);
        let resultado = null;

        if (hayTabla) {
            const cuenta = (await client.query(
                `SELECT id, monto_total, saldo, vencimiento, proveedor FROM public.cuentas_pagar
                 WHERE negocio_id = $1 AND origen_tipo = 'recepcion' AND origen_id = $2 AND estado IN ('pendiente', 'parcial') ORDER BY id LIMIT 1`,
                [negocioId, recepcionId]
            )).rows[0];

            if (cuenta) {
                const pagado = Math.max(0, num(cuenta.monto_total) - num(cuenta.saldo));
                const saldo = Math.max(0, redondear(monto - pagado));

                await client.query(
                    `UPDATE public.cuentas_pagar SET monto_total = $1, saldo = $2, estado = $3, concepto = $4, updated_at = NOW() WHERE id = $5`,
                    [monto, saldo, saldo <= 0 ? "pagada" : (pagado > 0 ? "parcial" : "pendiente"), folio ? `Factura ${folio}` : `Recepción de mercancía #${recepcionId}`, cuenta.id]
                );
                resultado = { accion: "ajustada", monto, vencimiento: cuenta.vencimiento ? new Date(cuenta.vencimiento).toISOString().slice(0, 10) : null, proveedor: cuenta.proveedor };
            }
        }

        if (!resultado && !pagoEnviado) {
            const yaPagada = (await client.query(`SELECT pago_metodo FROM public.recepciones_mercancia WHERE id = $1 AND negocio_id = $2`, [recepcionId, negocioId])).rows[0];
            const proveedor = proveedorId ? (await client.query(`SELECT nombre, dias_credito FROM public.proveedores WHERE id = $1 AND negocio_id = $2`, [proveedorId, negocioId])).rows[0] : null;
            const dias = proveedor ? Number(proveedor.dias_credito) || 0 : 0;

            if (dias > 0 && !(yaPagada && yaPagada.pago_metodo)) {
                const { crearCuentaPorPagar } = require("./pago-recepcion");
                const vencimiento = sumarDias(fechaDocumento, dias);
                const creada = await crearCuentaPorPagar(client, { negocioId, recepcionId, limpio: { metodo: "a_deber", monto, vencimiento, nota: folio ? `Factura ${folio}` : "" } });
                if (creada) resultado = { accion: "creada", monto, vencimiento, proveedor: (proveedor && proveedor.nombre) || proveedorNombre || "" };
            }
        }

        await client.query("RELEASE SAVEPOINT cuenta_por_factura");
        return resultado;
    } catch (error) {
        await client.query("ROLLBACK TO SAVEPOINT cuenta_por_factura").catch(() => {});
        console.warn("[factura-pedido] No se pudo ajustar la cuenta por pagar:", error.message);
        return null;
    }
}

module.exports = { compararFacturaConPedido, recepcionesDePedidoSinFactura, cuentaPorFactura, pedidosCandidatos };
