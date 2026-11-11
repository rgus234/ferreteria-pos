// Encargos de abarrotes ("quiero 10 Gansitos y no hay"): se conectan con los pedidos y con lo que llega, y avisan al dueño.
//  - Cuando se guarda un pedido ENVIADO que trae un producto encargado, el encargo pasa a "en proceso de resurtido" (resurtiendo).
//  - Cuando llega mercancia (recepcion rapida, con factura o contra un pedido) y ya alcanza para TODO lo que lleva el encargo, pasa a "listo para entregar"
//    y se avisa al dueño. Un encargo con un producto escrito a mano (sin producto del inventario) nunca avanza solo: eso lo decide el dueño.
//  - Un aviso al dia (8 am, hora de Mexico): lo que vence hoy, lo de mañana y lo atrasado.
// Solo negocios de abarrotes: la ferreteria conserva sus encargos como estaban. Nada de esto bloquea una recepcion ni un pedido si falla.
const { enviarPushADuenoDelNegocio } = require("./push-server");
const { esNegocioDeAbarrotes } = require("./marcas-catalogo");

const HORA_AVISO = 8;
const INTERVALO_REVISION_MS = 30 * 60 * 1000;
const ZONA = "America/Mexico_City";
const ABIERTOS = ["pendiente", "resurtiendo", "listo"];

function fechaLocal(ahora = new Date()) {
    return new Intl.DateTimeFormat("en-CA", { timeZone: ZONA }).format(ahora);
}

function horaLocal(ahora = new Date()) {
    return Number(new Intl.DateTimeFormat("en-GB", { timeZone: ZONA, hour: "2-digit", hour12: false }).format(ahora)) % 24;
}

function sumarDias(fecha, dias) {
    const d = new Date(fecha + "T12:00:00Z");
    d.setUTCDate(d.getUTCDate() + dias);
    return d.toISOString().slice(0, 10);
}

const ids = lista => [...new Set((lista || []).map(Number).filter(n => Number.isInteger(n) && n > 0))];

// Un pedido enviado con un producto encargado: el encargo pasa a "en proceso de resurtido".
async function marcarResurtiendoPorPedido(pool, negocioId, productoIds) {
    const lista = ids(productoIds);
    if (!lista.length || !(await esNegocioDeAbarrotes(pool, negocioId))) return 0;

    const r = await pool.query(
        `UPDATE public.encargos_clientes e SET estado = 'resurtiendo', updated_at = NOW()
          WHERE e.negocio_id = $1 AND e.estado = 'pendiente'
            AND EXISTS (SELECT 1 FROM public.encargos_clientes_items i WHERE i.encargo_id = e.id AND i.producto_id = ANY($2::int[]))`,
        [negocioId, lista]
    );

    return r.rowCount;
}

function textoLlego(encargos) {
    if (encargos.length === 1) {
        const e = encargos[0];
        return { titulo: "Ya llegó un encargo", cuerpo: `Ya llegó lo que encargó ${e.cliente_nombre}${e.productos ? ` (${e.productos})` : ""}. Está listo para entregar.` };
    }

    const nombres = encargos.slice(0, 3).map(e => e.cliente_nombre).join(", ");
    return { titulo: "Ya llegaron encargos", cuerpo: `Ya llegó lo de ${encargos.length} encargos: ${nombres}${encargos.length > 3 ? " y más" : ""}. Están listos para entregar.` };
}

// Llego mercancia: los encargos que ya se pueden surtir completos pasan a "listo para entregar" y se avisa. enviar se inyecta para las pruebas.
async function avanzarPorRecepcion(pool, negocioId, productoIds, { enviar = enviarPushADuenoDelNegocio } = {}) {
    const lista = ids(productoIds);
    if (!lista.length || !(await esNegocioDeAbarrotes(pool, negocioId))) return [];

    const candidatos = await pool.query(
        `SELECT e.id, e.cliente_nombre,
                (SELECT string_agg(i.nombre, ', ' ORDER BY i.id) FROM public.encargos_clientes_items i WHERE i.encargo_id = e.id) AS productos
           FROM public.encargos_clientes e
          WHERE e.negocio_id = $1 AND e.estado IN ('pendiente', 'resurtiendo')
            AND EXISTS (SELECT 1 FROM public.encargos_clientes_items i WHERE i.encargo_id = e.id AND i.producto_id = ANY($2::int[]))
            AND NOT EXISTS (
                SELECT 1 FROM public.encargos_clientes_items i LEFT JOIN public.productos p ON p.id = i.producto_id
                 WHERE i.encargo_id = e.id AND (i.producto_id IS NULL OR p.id IS NULL OR (p.stock + COALESCE(p.stock_resto, 0)) < i.cantidad)
            )
          ORDER BY e.id`,
        [negocioId, lista]
    );

    if (!candidatos.rows.length) return [];

    await pool.query(
        `UPDATE public.encargos_clientes SET estado = 'listo', updated_at = NOW() WHERE negocio_id = $1 AND id = ANY($2::int[])`,
        [negocioId, candidatos.rows.map(e => e.id)]
    );

    const { titulo, cuerpo } = textoLlego(candidatos.rows);
    try { await enviar(pool, negocioId, { titulo, cuerpo, url: "/" }); } catch (error) { console.warn("[encargos] No se pudo avisar", error.message); }

    return candidatos.rows;
}

function textoDia({ hoy, manana, atrasados, listos, unico }) {
    if (unico) {
        const cuando = unico.cuando === "hoy" ? "vence hoy" : (unico.cuando === "manana" ? "es para mañana" : "está atrasado");
        return { titulo: "Tienes un encargo", cuerpo: `El encargo de ${unico.cliente}${unico.producto ? ` (${unico.producto})` : ""} ${cuando}.` };
    }

    const partes = [];
    if (hoy) partes.push(`${hoy} vence${hoy === 1 ? "" : "n"} hoy`);
    if (manana) partes.push(`${manana} para mañana`);
    if (atrasados) partes.push(`${atrasados} atrasado${atrasados === 1 ? "" : "s"}`);
    if (listos) partes.push(`${listos} listo${listos === 1 ? "" : "s"} esperando al cliente`);

    return { titulo: "Tus encargos", cuerpo: `${partes.join(", ")}.` };
}

// Aviso de las 8 am: una sola vez por dia y negocio, y solo si hay algo que avisar.
async function avisarEncargosDelDia(pool, { ahora = new Date(), enviar = enviarPushADuenoDelNegocio, soloNegocios = null } = {}) {
    if (horaLocal(ahora) < HORA_AVISO) return 0;

    const hoy = fechaLocal(ahora);
    const manana = sumarDias(hoy, 1);
    const negocios = await pool.query(
        `SELECT DISTINCT negocio_id AS id FROM public.encargos_clientes WHERE estado = ANY($1::text[]) AND ($2::int[] IS NULL OR negocio_id = ANY($2::int[]))`,
        [ABIERTOS, soloNegocios]
    );
    let avisados = 0;

    for (const negocio of negocios.rows) {
        try {
            if (!(await esNegocioDeAbarrotes(pool, negocio.id))) continue;

            const filas = (await pool.query(
                `SELECT e.id, e.cliente_nombre, e.estado, to_char(e.fecha_entrega_esperada, 'YYYY-MM-DD') AS fecha,
                        (SELECT i.nombre FROM public.encargos_clientes_items i WHERE i.encargo_id = e.id ORDER BY i.id LIMIT 1) AS producto
                   FROM public.encargos_clientes e WHERE e.negocio_id = $1 AND e.estado = ANY($2::text[])`,
                [negocio.id, ABIERTOS]
            )).rows;

            const conFecha = filas.filter(f => f.fecha && f.estado !== "listo");
            const de = cuando => conFecha.filter(f => (cuando === "hoy" ? f.fecha === hoy : cuando === "manana" ? f.fecha === manana : f.fecha < hoy));
            const cuenta = { hoy: de("hoy"), manana: de("manana"), atrasados: de("atrasados") };
            const total = cuenta.hoy.length + cuenta.manana.length + cuenta.atrasados.length;
            if (!total) continue;

            const reservado = await pool.query(
                `INSERT INTO public.avisos_encargos (negocio_id, fecha, cuantos) VALUES ($1, $2, $3) ON CONFLICT (negocio_id, fecha) DO NOTHING RETURNING negocio_id`,
                [negocio.id, hoy, total]
            );
            if (!reservado.rows.length) continue;

            const primero = cuenta.hoy[0] || cuenta.manana[0] || cuenta.atrasados[0];
            const unico = total === 1 ? { cliente: primero.cliente_nombre, producto: primero.producto, cuando: cuenta.hoy.length ? "hoy" : (cuenta.manana.length ? "manana" : "atrasado") } : null;
            const { titulo, cuerpo } = textoDia({ hoy: cuenta.hoy.length, manana: cuenta.manana.length, atrasados: cuenta.atrasados.length, listos: filas.filter(f => f.estado === "listo").length, unico });

            await enviar(pool, negocio.id, { titulo, cuerpo, url: "/" });
            avisados++;
        } catch (error) {
            console.warn("[encargos] No se pudo avisar al negocio", negocio.id, error.message);
        }
    }

    return avisados;
}

function instalar(app, pool) {
    // El servidor de pruebas automaticas comparte la base de datos real: ahi nunca se mandan avisos de verdad.
    if (process.env.NEXO_PRUEBAS) return;

    async function revisarYCorrer() {
        try { await avisarEncargosDelDia(pool); } catch (error) { console.log("[encargos] Error en el aviso diario:", error.message); }
    }

    setTimeout(revisarYCorrer, 60000);
    setInterval(revisarYCorrer, INTERVALO_REVISION_MS);
}

module.exports = instalar;
module.exports.marcarResurtiendoPorPedido = marcarResurtiendoPorPedido;
module.exports.avanzarPorRecepcion = avanzarPorRecepcion;
module.exports.avisarEncargosDelDia = avisarEncargosDelDia;
module.exports.textoDia = textoDia;
module.exports.textoLlego = textoLlego;
