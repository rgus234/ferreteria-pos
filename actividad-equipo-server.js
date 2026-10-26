// "Quien hizo que" (plan docs/plan-celular-inventario-y-venta.md, seccion Z).
//  - GET /actividad/equipo?desde=&hasta=&empleadoId=   : todo el equipo (permiso de reportes).
//  - GET /actividad/mia?desde=&hasta=                   : solo lo que hizo la persona activa (x-empleado-id), cualquier empleado.
// Junta ventas (por cajero), cancelaciones, turnos de caja, tiempo extra y las acciones de la bitacora. Solo lee.
const { responderError } = require("./error-utils");
const { PERMISOS, requerirPermiso } = require("./rbac");

const ZONA = "America/Mexico_City";
const TEXTOS = {
    venta_cancelada: "Canceló una venta",
    descuento_autorizado: "Autorizó un descuento",
    limite_credito_autorizado: "Autorizó un límite de crédito",
    producto_eliminado: "Eliminó un producto",
    categoria_renombrada: "Renombró una categoría",
    compra_credito_editada: "Editó una compra a crédito",
    nota_venta_ajustada: "Ajustó una nota de venta",
    turno_vencido_autorizado: "Siguió vendiendo con PIN de administrador",
    turno_extendido: "Extendió su turno (tiempo extra)",
    recepcion_inteligente_detectada: "Revisó una factura de mercancía",
    acuerdo_credito_generado: "Generó un acuerdo de crédito",
    acuerdo_credito_aceptado: "Cliente aceptó un acuerdo de crédito"
};

function hoyLocal(ahora = new Date()) {
    return new Intl.DateTimeFormat("en-CA", { timeZone: ZONA }).format(ahora);
}

function fechaValida(texto, porDefecto) {
    return /^\d{4}-\d{2}-\d{2}$/.test(String(texto || "")) ? texto : porDefecto;
}

// Rango de dias locales (inclusive) como [inicio, fin) en hora de Mexico.
function rango(query) {
    const hoy = hoyLocal();
    const desde = fechaValida(query.desde, hoy);
    let hasta = fechaValida(query.hasta, desde);
    if (hasta < desde) hasta = desde;

    return { desde, hasta };
}

async function actividad(pool, negocioId, { desde, hasta }, soloEmpleadoId = null) {
    const empleados = (await pool.query(`SELECT id, nombre, rol, color_avatar FROM public.empleados WHERE negocio_id = $1 AND activo = true`, [negocioId])).rows;
    const filtrar = soloEmpleadoId ? empleados.filter(e => e.id === soloEmpleadoId) : empleados;
    const porNombre = new Map(empleados.map(e => [String(e.nombre).trim().toLowerCase(), e]));

    // historial_ventas.fecha es timestamp SIN zona y guarda la hora del servidor (UTC): se lee como UTC y se pasa a hora de Mexico para el dia.
    const ventas = (await pool.query(
        `SELECT COALESCE(NULLIF(TRIM(cajero_nombre), ''), NULLIF(TRIM(cajero_usuario), ''), 'Sin cajero') AS cajero,
                COUNT(*) FILTER (WHERE estado <> 'cancelada')::int AS ventas,
                COALESCE(SUM(total) FILTER (WHERE estado <> 'cancelada'), 0)::numeric AS total,
                COUNT(*) FILTER (WHERE estado = 'cancelada')::int AS canceladas
         FROM public.historial_ventas
         WHERE negocio_id = $1 AND ((fecha AT TIME ZONE 'UTC') AT TIME ZONE '${ZONA}')::date BETWEEN $2::date AND $3::date
         GROUP BY 1`,
        [negocioId, desde, hasta]
    )).rows;

    const bitacora = (await pool.query(
        `SELECT b.id, b.empleado_id, b.accion, b.detalle, b.created_at FROM public.bitacora_acciones b
         WHERE b.negocio_id = $1 AND (b.created_at AT TIME ZONE '${ZONA}')::date BETWEEN $2::date AND $3::date
         ORDER BY b.created_at DESC LIMIT 400`,
        [negocioId, desde, hasta]
    )).rows;

    const turnos = (await pool.query(
        `SELECT empleado_id, usuario, abierto_at, cerrado_at, estado FROM public.turnos_caja
         WHERE negocio_id = $1 AND (abierto_at AT TIME ZONE '${ZONA}')::date BETWEEN $2::date AND $3::date`,
        [negocioId, desde, hasta]
    )).rows;

    const personas = filtrar.map(e => {
        const clave = String(e.nombre).trim().toLowerCase();
        const v = ventas.find(x => String(x.cajero).trim().toLowerCase() === clave);
        const mias = bitacora.filter(b => b.empleado_id === e.id);
        const extension = mias.filter(b => b.accion === "turno_extendido");
        const conteo = {};
        mias.forEach(b => { conteo[b.accion] = (conteo[b.accion] || 0) + 1; });

        return {
            empleadoId: e.id, nombre: e.nombre, rol: e.rol, colorAvatar: e.color_avatar,
            ventas: v ? v.ventas : 0, total: v ? Number(v.total) : 0, canceladas: v ? v.canceladas : 0,
            turnos: turnos.filter(t => t.empleado_id === e.id).length,
            extensiones: extension.length,
            horasExtra: extension.reduce((s, b) => s + Number(b.detalle?.horas || 0), 0),
            acciones: Object.entries(conteo).map(([accion, n]) => ({ accion, texto: TEXTOS[accion] || accion, n }))
        };
    });

    const detalle = [];

    bitacora.filter(b => !soloEmpleadoId || b.empleado_id === soloEmpleadoId).forEach(b => {
        const e = empleados.find(x => x.id === b.empleado_id);
        detalle.push({ cuando: b.created_at, empleadoId: b.empleado_id, empleado: e ? e.nombre : "Sistema", texto: TEXTOS[b.accion] || b.accion, accion: b.accion });
    });

    turnos.filter(t => !soloEmpleadoId || t.empleado_id === soloEmpleadoId).forEach(t => {
        const e = empleados.find(x => x.id === t.empleado_id) || porNombre.get(String(t.usuario || "").trim().toLowerCase());
        detalle.push({ cuando: t.abierto_at, empleadoId: t.empleado_id, empleado: e ? e.nombre : (t.usuario || "Caja"), texto: "Abrió su caja", accion: "turno_abierto" });
        if (t.cerrado_at) detalle.push({ cuando: t.cerrado_at, empleadoId: t.empleado_id, empleado: e ? e.nombre : (t.usuario || "Caja"), texto: "Cerró su caja", accion: "turno_cerrado" });
    });

    detalle.sort((a, b) => new Date(b.cuando) - new Date(a.cuando));

    return { desde, hasta, personas, detalle: detalle.slice(0, 200), sinAsignar: soloEmpleadoId ? [] : ventas.filter(v => !porNombre.has(String(v.cajero).trim().toLowerCase())).map(v => ({ cajero: v.cajero, ventas: v.ventas, total: Number(v.total) })) };
}

function instalar(app, pool, requerirAccesoNegocio) {
    function negocioId(req) {
        const id = req.negocioDispositivo?.negocio_id ?? req.negocioAutenticado?.negocio_id;

        if (!id) {
            const error = new Error("Este equipo no esta vinculado a ningun negocio");
            error.httpStatus = 401;
            throw error;
        }

        return id;
    }

    app.get("/actividad/equipo", requerirAccesoNegocio, requerirPermiso(PERMISOS.VER_REPORTES), async (req, res) => {
        try {
            const solo = Number(req.query.empleadoId) || null;
            res.json({ ok: true, ...(await actividad(pool, negocioId(req), rango(req.query), solo)) });
        } catch (error) {
            responderError(res, error);
        }
    });

    app.get("/actividad/mia", requerirAccesoNegocio, async (req, res) => {
        try {
            const yo = Number(req.headers["x-empleado-id"]) || null;

            if (!yo) {
                res.status(400).json({ ok: false, error: "Elige quien eres para ver tu actividad." });
                return;
            }

            res.json({ ok: true, ...(await actividad(pool, negocioId(req), rango(req.query), yo)) });
        } catch (error) {
            responderError(res, error);
        }
    });
}

module.exports = instalar;
module.exports.actividad = actividad;
module.exports.rango = rango;
module.exports.hoyLocal = hoyLocal;
