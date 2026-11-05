// Venta de bebidas alcoholicas (abarrotes): horario en que NO se vende, con el PIN de un administrador como salida.
//
// Cada negocio define su regla (en cada estado y municipio es distinta): Nexo no sabe ni afirma lo que dice la ley, solo ayuda a cumplir lo que el
// dueño configura. Si la venta lleva alcohol y la hora actual cae en el horario prohibido (o hoy esta marcado "ley seca"), el servidor
// no la cobra a menos que llegue el PIN de un administrador, y eso queda en la bitacora.
//
// Solo corre si el negocio tiene encendida la funcion "alcohol" (Funciones nuevas) y la configuracion activa. Cualquier falla al revisar
// deja pasar la venta: este control nunca debe tumbar el cobro. Las tablas se crean solas (migrations/20261120_alcohol.sql es lo mismo).

const { responderError } = require("./error-utils");
const { PERMISOS, requerirPermiso, resolverIdentidadNexo } = require("./rbac");

let tablasListas = false;

async function asegurarTablas(pool) {
    if (tablasListas) return;

    await pool.query(`
        CREATE TABLE IF NOT EXISTS public.alcohol_config (
            negocio_id INTEGER PRIMARY KEY REFERENCES public.negocios(id) ON DELETE CASCADE,
            activa BOOLEAN NOT NULL DEFAULT false,
            desde TEXT NOT NULL DEFAULT '22:00',
            hasta TEXT NOT NULL DEFAULT '10:00',
            ley_seca_fecha DATE,
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
    `);
    await pool.query(`
        CREATE TABLE IF NOT EXISTS public.producto_alcohol (
            negocio_id INTEGER NOT NULL REFERENCES public.negocios(id) ON DELETE CASCADE,
            producto_id INTEGER NOT NULL REFERENCES public.productos(id) ON DELETE CASCADE,
            es_alcohol BOOLEAN NOT NULL,
            PRIMARY KEY (negocio_id, producto_id)
        )
    `);
    tablasListas = true;
}

const HORA = /^([01]\d|2[0-3]):[0-5]\d$/;

// Fecha y hora de Mexico (mismo criterio que el horario laboral): { fecha: "2026-11-05", hora: "22:30" }
function ahoraMX(fecha = new Date()) {
    const partes = {};
    new Intl.DateTimeFormat("en-CA", { timeZone: "America/Mexico_City", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
        .formatToParts(fecha).forEach(p => { partes[p.type] = p.value; });

    return { fecha: `${partes.year}-${partes.month}-${partes.day}`, hora: `${partes.hour}:${partes.minute}` };
}

// true si "hora" cae dentro de [desde, hasta); la ventana puede cruzar la medianoche (22:00 a 10:00).
function enVentana(hora, desde, hasta) {
    if (!HORA.test(desde) || !HORA.test(hasta) || desde === hasta) return false;

    return desde < hasta ? (hora >= desde && hora < hasta) : (hora >= desde || hora < hasta);
}

// Por que hoy y ahora NO se puede vender alcohol (o null si se puede).
function motivoRestriccion(config, ahora) {
    if (!config || !config.activa) return null;

    const leySeca = config.ley_seca_fecha ? String(config.ley_seca_fecha).slice(0, 10) : "";

    if (leySeca && leySeca === ahora.fecha) return "Hoy esta marcado como dia sin venta de alcohol.";
    if (enVentana(ahora.hora, config.desde, config.hasta)) return `A esta hora no se vende alcohol (de ${config.desde} a ${config.hasta}).`;

    return null;
}

// Que productos del negocio son bebidas alcoholicas: lo que el dueño marco a mano manda; si no, la categoria.
const SQL_IDS_ALCOHOL = `
    SELECT p.id, p.nombre
    FROM public.productos p
    LEFT JOIN public.categorias_nexo c ON c.id = p.categoria_nexo_id
    LEFT JOIN public.producto_alcohol a ON a.negocio_id = p.negocio_id AND a.producto_id = p.id
    WHERE p.negocio_id = $1
    AND COALESCE(
        a.es_alcohol,
        c.nombre ILIKE '%alcohol%' OR COALESCE(p.categoria, '') ~* '(alcohol|cerveza|licor|vinos)'
    ) = true
`;

async function productosAlcohol(pool, negocioId) {
    return (await pool.query(SQL_IDS_ALCOHOL, [negocioId])).rows;
}

async function configDeNegocio(pool, negocioId) {
    const fila = (await pool.query(
        `SELECT c.activa, c.desde, c.hasta, c.ley_seca_fecha::text AS ley_seca_fecha
         FROM public.negocios n
         LEFT JOIN public.alcohol_config c ON c.negocio_id = n.id
         WHERE n.id = $1 AND COALESCE((n.funciones_beta->>'alcohol')::boolean, false)`,
        [negocioId]
    )).rows[0];

    return fila && fila.activa !== null ? fila : null;
}

// La usan /ventas y los cargos a credito. Regresa true si la venta puede seguir; false si ya respondio (400 con requierePinAdmin).
async function exigir({ pool, client, res, negocioId, productos, adminPin, empleadoId, validarPin, bitacora, ahora = ahoraMX() }) {
    let motivo = null;
    let alcoholEnVenta = [];

    try {
        await asegurarTablas(pool);
        const config = await configDeNegocio(pool, negocioId);
        motivo = motivoRestriccion(config, ahora);

        if (motivo) {
            const ids = new Set((productos || []).map(p => Number(p && p.id)).filter(id => id > 0));

            if (ids.size) alcoholEnVenta = (await productosAlcohol(pool, negocioId)).filter(f => ids.has(f.id));
        }
    } catch (error) {
        console.warn("[alcohol] no se pudo revisar el horario, la venta sigue:", error.message);
        return true;
    }

    if (!motivo || !alcoholEnVenta.length) return true;

    const admin = await validarPin(client, negocioId, adminPin);

    if (!admin) {
        res.status(400).json({
            ok: false,
            error: `${motivo} Esta venta lleva alcohol: pide el PIN de un administrador para autorizarla.`,
            requierePinAdmin: true,
            requiereAutorizarAlcohol: true
        });
        return false;
    }

    await bitacora(client, negocioId, empleadoId, "venta_alcohol_autorizada", {
        motivo,
        adminId: admin.id,
        adminNombre: admin.usuario,
        productos: alcoholEnVenta.map(f => f.nombre)
    });

    return true;
}

function instalar(app, pool, requerirAccesoNegocio) {
    const negocioId = req => {
        const id = req.negocioDispositivo?.negocio_id ?? req.negocioAutenticado?.negocio_id;

        if (!id) {
            const error = new Error("Este equipo no esta vinculado a ningun negocio");
            error.httpStatus = 401;
            throw error;
        }

        return id;
    };

    asegurarTablas(pool).catch(() => { /* se vuelve a intentar al primer uso */ });

    // Configuracion + que productos son alcohol (para el aviso de mayoria de edad y para bloquear en el carrito).
    app.get("/alcohol", requerirAccesoNegocio, async (req, res) => {
        try {
            await asegurarTablas(pool);
            const id = negocioId(req);
            const config = (await pool.query(`SELECT activa, desde, hasta, ley_seca_fecha::text AS ley_seca_fecha FROM public.alcohol_config WHERE negocio_id = $1`, [id])).rows[0];
            const ahora = ahoraMX();
            const productos = await productosAlcohol(pool, id);
            const manuales = {};
            (await pool.query(`SELECT producto_id, es_alcohol FROM public.producto_alcohol WHERE negocio_id = $1`, [id])).rows.forEach(f => { manuales[f.producto_id] = f.es_alcohol; });

            res.json({
                ok: true,
                config: {
                    activa: Boolean(config && config.activa),
                    desde: config ? config.desde : "22:00",
                    hasta: config ? config.hasta : "10:00",
                    leySecaHoy: Boolean(config && config.ley_seca_fecha && String(config.ley_seca_fecha).slice(0, 10) === ahora.fecha)
                },
                ids: productos.map(f => f.id),
                manuales
            });
        } catch (error) {
            res.json({ ok: true, config: { activa: false, desde: "22:00", hasta: "10:00", leySecaHoy: false }, ids: [], manuales: {} });
        }
    });

    // Solo el dueño cambia la regla.
    app.put("/alcohol/config", requerirAccesoNegocio, async (req, res) => {
        try {
            const identidad = await resolverIdentidadNexo(req);

            if (!(identidad.rol === "owner" || identidad.permisos === null)) {
                res.status(403).json({ ok: false, error: "Solo el dueño puede cambiar el horario de venta de alcohol." });
                return;
            }

            const desde = String(req.body?.desde || "22:00");
            const hasta = String(req.body?.hasta || "10:00");

            if (!HORA.test(desde) || !HORA.test(hasta)) {
                res.status(400).json({ ok: false, error: "Escribe las horas como 22:00." });
                return;
            }

            await asegurarTablas(pool);
            const hoy = ahoraMX().fecha;

            await pool.query(
                `INSERT INTO public.alcohol_config (negocio_id, activa, desde, hasta, ley_seca_fecha, updated_at)
                 VALUES ($1, $2, $3, $4, $5, NOW())
                 ON CONFLICT (negocio_id) DO UPDATE SET activa = EXCLUDED.activa, desde = EXCLUDED.desde, hasta = EXCLUDED.hasta,
                     ley_seca_fecha = EXCLUDED.ley_seca_fecha, updated_at = NOW()`,
                [negocioId(req), req.body?.activa === true, desde, hasta, req.body?.leySecaHoy === true ? hoy : null]
            );

            res.json({ ok: true });
        } catch (error) {
            responderError(res, error);
        }
    });

    // esAlcohol: true / false (a mano) o null (volver a lo que diga la categoria).
    app.put("/alcohol/producto/:productoId", requerirAccesoNegocio, requerirPermiso(PERMISOS.MODIFICAR_INVENTARIO), async (req, res) => {
        try {
            const idNegocio = negocioId(req);
            const productoId = Number(req.params.productoId);
            const valor = req.body?.esAlcohol;

            if (!Number.isInteger(productoId) || productoId <= 0 || !(valor === true || valor === false || valor === null)) {
                res.status(400).json({ ok: false, error: "Dato no valido." });
                return;
            }

            await asegurarTablas(pool);

            if (!(await pool.query(`SELECT 1 FROM public.productos WHERE id = $1 AND negocio_id = $2`, [productoId, idNegocio])).rows.length) {
                res.status(404).json({ ok: false, error: "No se encontro el producto." });
                return;
            }

            if (valor === null) await pool.query(`DELETE FROM public.producto_alcohol WHERE negocio_id = $1 AND producto_id = $2`, [idNegocio, productoId]);
            else {
                await pool.query(
                    `INSERT INTO public.producto_alcohol (negocio_id, producto_id, es_alcohol) VALUES ($1, $2, $3)
                     ON CONFLICT (negocio_id, producto_id) DO UPDATE SET es_alcohol = EXCLUDED.es_alcohol`,
                    [idNegocio, productoId, valor]
                );
            }

            res.json({ ok: true });
        } catch (error) {
            responderError(res, error);
        }
    });
}

module.exports = instalar;
module.exports.exigir = exigir;
module.exports.motivoRestriccion = motivoRestriccion;
module.exports.enVentana = enVentana;
module.exports.ahoraMX = ahoraMX;
