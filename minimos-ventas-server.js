// Minimos y maximos con tus ventas. Con lo que de verdad se vendio, propone para cada producto cuanto conviene tener como minimo (cuando ya hay que pedir)
// y como maximo (hasta donde llenar). Solo propone: el dueño elige que aplicar y todo se puede deshacer sin pisar lo que cambio despues.
//   GET  /inventario/minimos-sugeridos?cobertura=14   propuesta (cobertura = dias de venta que debe alcanzar el minimo)
//   POST /inventario/minimos-aplicar                   { items: [{ id, minimo, maximo }], usuario? }
//   GET  /inventario/minimos-lotes                     los ultimos cambios (para deshacer)
//   POST /inventario/minimos-lotes/:lote/deshacer
const crypto = require("crypto");
const { responderError } = require("./error-utils");
const { PERMISOS, requerirPermiso } = require("./rbac");

const MINIMO_DE_FABRICA = 3; // el valor con el que nace todo producto: si sigue asi, nadie lo ha puesto a mano
const TICKETS_MINIMOS = 3; // con menos ventas distintas no hay de donde calcular
const VENTANA_MAXIMA_DIAS = 120;
const COBERTURAS = [7, 14, 30];

const SQL_TABLA = `
    CREATE TABLE IF NOT EXISTS public.minimos_aplicados (
        id SERIAL PRIMARY KEY,
        lote_id TEXT NOT NULL,
        negocio_id INTEGER NOT NULL REFERENCES public.negocios(id) ON DELETE CASCADE,
        producto_id INTEGER NOT NULL,
        minimo_antes NUMERIC,
        maximo_antes NUMERIC,
        minimo_nuevo NUMERIC NOT NULL,
        maximo_nuevo NUMERIC NOT NULL,
        usuario TEXT NOT NULL DEFAULT '',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        deshecho_at TIMESTAMPTZ
    )
`;

let tablaLista = null;
function asegurarTabla(db) {
    if (!tablaLista) tablaLista = db.query(SQL_TABLA).catch(error => { tablaLista = null; throw error; });
    return tablaLista;
}

class ErrorMinimos extends Error {
    constructor(mensaje, httpStatus = 400) { super(mensaje); this.httpStatus = httpStatus; }
}

const num = valor => { const n = Number(valor); return Number.isFinite(n) ? n : 0; };

// Puro: de lo vendido en la ventana sale el minimo y el maximo. Minimo = lo que se vende en `cobertura` dias; maximo = el doble. Nunca menos de 1 (ni max <= min).
function calcularLimites({ vendido, diasVentana, cobertura }) {
    const porDia = diasVentana > 0 ? Math.max(0, num(vendido)) / diasVentana : 0;
    const minimo = Math.max(1, Math.ceil(porDia * cobertura - 1e-9));
    const maximo = Math.max(minimo + 1, Math.ceil(porDia * cobertura * 2 - 1e-9));
    return { porDia: Number(porDia.toFixed(3)), minimo, maximo };
}

async function ventana(db, negocioId) {
    const fila = (await db.query(`SELECT MIN(fecha) AS primera FROM public.historial_ventas WHERE negocio_id = $1 AND estado = 'completada'`, [negocioId])).rows[0];
    if (!fila?.primera) return { dias: 0, hayVentas: false };
    const dias = Math.ceil((Date.now() - new Date(fila.primera).getTime()) / 86400000);
    return { dias: Math.min(VENTANA_MAXIMA_DIAS, Math.max(1, dias)), hayVentas: true };
}

async function sugeridos(db, negocioId, cobertura) {
    if (!COBERTURAS.includes(cobertura)) throw new ErrorMinimos("La cobertura debe ser 7, 14 o 30 dias");
    const v = await ventana(db, negocioId);
    if (!v.hayVentas) return { ventanaDias: 0, cobertura, productos: [], sinEvidencia: 0 };

    const filas = (await db.query(
        `WITH vendido AS (
            SELECT (item->>'id')::int AS id, SUM((item->>'cantidad')::numeric) AS cantidad, COUNT(DISTINCT h.id)::int AS tickets
              FROM public.historial_ventas h
             CROSS JOIN LATERAL jsonb_array_elements(h.productos) AS item
             WHERE h.negocio_id = $1 AND h.estado = 'completada' AND h.fecha >= NOW() - ($2 || ' days')::interval AND item->>'id' ~ '^[0-9]+$'
             GROUP BY 1)
         SELECT p.id, p.nombre, p.stock, p.stock_minimo, p.stock_maximo, v.cantidad, v.tickets
           FROM public.productos p JOIN vendido v ON v.id = p.id
          WHERE p.negocio_id = $1`,
        [negocioId, String(v.dias)]
    )).rows;

    const productos = [];
    let sinEvidencia = 0;

    for (const f of filas) {
        if (f.tickets < TICKETS_MINIMOS) { sinEvidencia += 1; continue; }

        const { porDia, minimo, maximo } = calcularLimites({ vendido: f.cantidad, diasVentana: v.dias, cobertura });
        const minimoActual = f.stock_minimo === null ? null : num(f.stock_minimo);
        const maximoActual = f.stock_maximo === null ? null : num(f.stock_maximo);
        // "Lo puso el dueño" si el minimo no es el de fabrica o ya hay un maximo: esos no se preseleccionan.
        const propio = (minimoActual !== null && minimoActual !== MINIMO_DE_FABRICA && minimoActual > 0) || (maximoActual !== null && maximoActual > 0);

        productos.push({
            id: f.id, nombre: f.nombre, stock: num(f.stock), vendido: num(f.cantidad), tickets: f.tickets, porSemana: Number((porDia * 7).toFixed(1)),
            minimoActual, maximoActual, minimo, maximo, propio, igual: minimoActual === minimo && maximoActual === maximo
        });
    }

    productos.sort((a, b) => b.vendido - a.vendido);
    return { ventanaDias: v.dias, cobertura, productos: productos.filter(p => !p.igual), sinEvidencia };
}

async function aplicar(db, negocioId, items, usuario) {
    if (!Array.isArray(items) || !items.length) throw new ErrorMinimos("No hay productos para aplicar");
    if (items.length > 2000) throw new ErrorMinimos("Son demasiados productos de una vez");

    const limpios = [];
    const vistos = new Set();
    for (const it of items) {
        const id = Number(it?.id), minimo = Number(it?.minimo), maximo = Number(it?.maximo);
        if (!Number.isInteger(id) || vistos.has(id)) continue;
        if (!(minimo >= 1) || !(maximo > minimo) || maximo > 100000) throw new ErrorMinimos("Los limites no son validos (el maximo debe ser mayor al minimo)");
        vistos.add(id);
        limpios.push({ id, minimo, maximo });
    }
    if (!limpios.length) throw new ErrorMinimos("No hay productos para aplicar");

    await asegurarTabla(db);
    const lote = crypto.randomUUID();
    const cliente = await db.connect();
    try {
        await cliente.query("BEGIN");
        const antes = (await cliente.query(`SELECT id, stock_minimo, stock_maximo FROM public.productos WHERE negocio_id = $1 AND id = ANY($2::int[]) FOR UPDATE`, [negocioId, limpios.map(l => l.id)])).rows;
        const dePropiedad = new Map(antes.map(f => [f.id, f]));
        const validos = limpios.filter(l => dePropiedad.has(l.id));
        if (!validos.length) throw new ErrorMinimos("Esos productos no son de este negocio", 404);

        await cliente.query(
            `INSERT INTO public.minimos_aplicados (lote_id, negocio_id, producto_id, minimo_antes, maximo_antes, minimo_nuevo, maximo_nuevo, usuario)
             SELECT $1, $2, x.id, p.stock_minimo, p.stock_maximo, x.minimo, x.maximo, $4
               FROM jsonb_to_recordset($3::jsonb) AS x(id int, minimo numeric, maximo numeric) JOIN public.productos p ON p.id = x.id`,
            [lote, negocioId, JSON.stringify(validos), String(usuario || "").slice(0, 80)]
        );
        await cliente.query(
            `UPDATE public.productos p SET stock_minimo = x.minimo, stock_maximo = x.maximo
               FROM jsonb_to_recordset($2::jsonb) AS x(id int, minimo numeric, maximo numeric) WHERE p.id = x.id AND p.negocio_id = $1`,
            [negocioId, JSON.stringify(validos)]
        );
        await cliente.query("COMMIT");
        return { lote, productos: validos.length };
    } catch (error) {
        await cliente.query("ROLLBACK").catch(() => {});
        throw error;
    } finally {
        cliente.release();
    }
}

async function lotes(db, negocioId) {
    await asegurarTabla(db);
    return (await db.query(
        `SELECT lote_id AS id, COUNT(*)::int AS productos, MAX(usuario) AS usuario, MIN(created_at) AS fecha, BOOL_AND(deshecho_at IS NOT NULL) AS deshecho
           FROM public.minimos_aplicados WHERE negocio_id = $1 GROUP BY lote_id ORDER BY MIN(created_at) DESC LIMIT 15`, [negocioId]
    )).rows;
}

// Regresa cada producto a lo que tenia, pero solo si sigue con lo que se le puso (si alguien lo cambio despues, se respeta).
async function deshacer(db, negocioId, loteId) {
    await asegurarTabla(db);
    const cliente = await db.connect();
    try {
        await cliente.query("BEGIN");
        const filas = (await cliente.query(`SELECT * FROM public.minimos_aplicados WHERE negocio_id = $1 AND lote_id = $2 FOR UPDATE`, [negocioId, String(loteId)])).rows;
        if (!filas.length) throw new ErrorMinimos("No encontre ese cambio", 404);
        if (filas.every(f => f.deshecho_at)) throw new ErrorMinimos("Ese cambio ya se deshizo");

        let regresados = 0;
        for (const f of filas.filter(x => !x.deshecho_at)) {
            const r = await cliente.query(
                `UPDATE public.productos SET stock_minimo = $3, stock_maximo = $4
                  WHERE id = $1 AND negocio_id = $2 AND stock_minimo = $5 AND stock_maximo IS NOT DISTINCT FROM $6`,
                [f.producto_id, negocioId, f.minimo_antes, f.maximo_antes, f.minimo_nuevo, f.maximo_nuevo]
            );
            regresados += r.rowCount;
        }
        await cliente.query(`UPDATE public.minimos_aplicados SET deshecho_at = NOW() WHERE negocio_id = $1 AND lote_id = $2 AND deshecho_at IS NULL`, [negocioId, String(loteId)]);
        await cliente.query("COMMIT");
        return { productos: regresados };
    } catch (error) {
        await cliente.query("ROLLBACK").catch(() => {});
        throw error;
    } finally {
        cliente.release();
    }
}

module.exports = (app, pool, requerirAccesoNegocio) => {
    asegurarTabla(pool).catch(error => console.warn("[minimos-ventas] No se pudo preparar la tabla:", error.message));

    const negocioId = req => req.negocioDispositivo?.negocio_id ?? req.negocioAutenticado?.negocio_id;
    const fallo = (res, error) => (error instanceof ErrorMinimos ? res.status(error.httpStatus).json({ ok: false, error: error.message }) : responderError(res, error));
    const exigir = (req, res) => { const id = negocioId(req); if (!id) res.status(401).json({ ok: false, error: "Este equipo no esta vinculado a ningun negocio" }); return id; };

    app.get("/inventario/minimos-sugeridos", requerirAccesoNegocio, async (req, res) => {
        try { const id = exigir(req, res); if (!id) return; res.json({ ok: true, ...(await sugeridos(pool, id, Number(req.query.cobertura) || 14)) }); } catch (e) { fallo(res, e); }
    });
    app.post("/inventario/minimos-aplicar", requerirAccesoNegocio, requerirPermiso(PERMISOS.MODIFICAR_INVENTARIO), async (req, res) => {
        try { const id = exigir(req, res); if (!id) return; res.json({ ok: true, ...(await aplicar(pool, id, req.body?.items, req.body?.usuario)) }); } catch (e) { fallo(res, e); }
    });
    app.get("/inventario/minimos-lotes", requerirAccesoNegocio, async (req, res) => {
        try { const id = exigir(req, res); if (!id) return; res.json({ ok: true, lotes: await lotes(pool, id) }); } catch (e) { fallo(res, e); }
    });
    app.post("/inventario/minimos-lotes/:lote/deshacer", requerirAccesoNegocio, requerirPermiso(PERMISOS.MODIFICAR_INVENTARIO), async (req, res) => {
        try { const id = exigir(req, res); if (!id) return; res.json({ ok: true, ...(await deshacer(pool, id, req.params.lote)) }); } catch (e) { fallo(res, e); }
    });
};

module.exports.calcularLimites = calcularLimites;
module.exports.COBERTURAS = COBERTURAS;
