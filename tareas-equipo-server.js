// Tareas y avisos del equipo.
//  - Tareas de una sola vez o que se repiten (cada dia, ciertos dias de la semana, un dia del mes); varias por dia, con hora opcional.
//  - Se asignan a una persona o a todo el equipo. Quien las hace las marca; queda quien y a que hora.
//  - Las crea el dueño o quien tenga el permiso "gestionar_tareas" (un encargado). Cualquiera marca las suyas.
//  - Avisos cortos para todo el equipo o para una persona.
//  GET  /tareas/hoy            lo que le toca hoy a la persona activa (x-empleado-id); sin persona (dueño) ve todo
//  POST /tareas/:id/hecha      marcar / desmarcar una tarea de hoy
//  GET  /tareas                las tareas programadas (permiso)       POST /tareas   PUT /tareas/:id   DELETE /tareas/:id
//  GET  /avisos   POST /avisos (permiso)   DELETE /avisos/:id (permiso)
//  PUT  /equipo/:id/gestor-tareas   el dueño (administrar_usuarios) da o quita el permiso a un empleado
// Las tablas se crean solas la primera vez (IF NOT EXISTS).
const { responderError } = require("./error-utils");
const { resolverIdentidadNexo, tienePermiso, PERMISOS, requerirPermiso } = require("./rbac");
const { ocurreEnFecha, textoRepeticion, normalizarTarea } = require("./tareas-calculo");

const ZONA = "America/Mexico_City";
const GESTIONAR_TAREAS = "gestionar_tareas";
const hoyLocal = (ahora = new Date()) => new Intl.DateTimeFormat("en-CA", { timeZone: ZONA }).format(ahora);

let tablasListas = false;

async function asegurarTablas(pool) {
    if (tablasListas) return;

    await pool.query(`
        CREATE TABLE IF NOT EXISTS public.tareas_equipo (
            id SERIAL PRIMARY KEY,
            negocio_id INTEGER NOT NULL,
            titulo TEXT NOT NULL,
            detalle TEXT NOT NULL DEFAULT '',
            asignado_a INTEGER,
            repite TEXT NOT NULL DEFAULT 'no',
            dias_semana SMALLINT[] NOT NULL DEFAULT '{}',
            dia_mes SMALLINT,
            fecha DATE NOT NULL,
            hora TEXT,
            creada_por INTEGER,
            creada_por_nombre TEXT NOT NULL DEFAULT '',
            activa BOOLEAN NOT NULL DEFAULT true,
            creada_en TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
        CREATE INDEX IF NOT EXISTS idx_tareas_equipo_negocio ON public.tareas_equipo (negocio_id, activa);
        CREATE TABLE IF NOT EXISTS public.tareas_cumplimientos (
            id SERIAL PRIMARY KEY,
            tarea_id INTEGER NOT NULL REFERENCES public.tareas_equipo(id) ON DELETE CASCADE,
            negocio_id INTEGER NOT NULL,
            fecha DATE NOT NULL,
            empleado_id INTEGER,
            empleado_nombre TEXT NOT NULL DEFAULT '',
            hecha_en TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            UNIQUE (tarea_id, fecha)
        );
        CREATE TABLE IF NOT EXISTS public.avisos_equipo (
            id SERIAL PRIMARY KEY,
            negocio_id INTEGER NOT NULL,
            mensaje TEXT NOT NULL,
            para INTEGER,
            creado_por INTEGER,
            creado_por_nombre TEXT NOT NULL DEFAULT '',
            creado_en TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
        CREATE INDEX IF NOT EXISTS idx_avisos_equipo_negocio ON public.avisos_equipo (negocio_id, creado_en DESC);
    `);

    tablasListas = true;
}

function fechaDe(valor) {
    if (!valor) return "";
    if (typeof valor === "string") return valor.slice(0, 10);
    return new Intl.DateTimeFormat("en-CA", { timeZone: "UTC" }).format(valor);
}

function filaATarea(f) {
    return {
        id: f.id, titulo: f.titulo, detalle: f.detalle, asignadoA: f.asignado_a, repite: f.repite,
        diasSemana: (f.dias_semana || []).map(Number), diaMes: f.dia_mes, fecha: fechaDe(f.fecha), hora: f.hora
    };
}

// Quien esta usando el equipo: la persona activa del celular (x-empleado-id) o, sin ella, el dueño.
async function quienEs(pool, req) {
    const negocioId = req.negocioDispositivo?.negocio_id ?? req.negocioAutenticado?.negocio_id;
    let empleadoId = Number(req.headers["x-empleado-id"]) || null;

    // sesion de cuenta de un empleado (entro con su propia cuenta Nexo): se busca su ficha por su persona
    if (!empleadoId && req.negocioAutenticado?.rol === "employee" && req.negocioAutenticado.persona_id) {
        const ficha = (await pool.query(`SELECT id FROM public.empleados WHERE persona_id = $1 AND negocio_id = $2 AND activo = true LIMIT 1`, [req.negocioAutenticado.persona_id, negocioId])).rows[0];
        if (ficha) empleadoId = ficha.id;
    }

    if (!negocioId) {
        const error = new Error("Este equipo no esta vinculado a ningun negocio");
        error.httpStatus = 401;
        throw error;
    }

    let nombre = "Dueño";
    if (empleadoId) {
        const fila = (await pool.query(`SELECT nombre FROM public.empleados WHERE id = $1 AND negocio_id = $2`, [empleadoId, negocioId])).rows[0];
        nombre = fila ? fila.nombre : "Equipo";
    }

    const identidad = await resolverIdentidadNexo(req);
    return { negocioId, empleadoId, nombre, identidad, esGestor: tienePermiso(identidad, GESTIONAR_TAREAS) || tienePermiso(identidad, PERMISOS.ADMINISTRAR_USUARIOS) };
}

function instalar(app, pool, requerirAccesoNegocio) {
    const exigirGestor = async (req, res, next) => {
        try {
            await asegurarTablas(pool);
            req.yo = await quienEs(pool, req);

            if (!req.yo.esGestor) {
                res.status(403).json({ ok: false, error: "Solo el dueño o un encargado puede crear tareas y avisos. Pídele el permiso al dueño.", requierePermiso: GESTIONAR_TAREAS });
                return;
            }

            next();
        } catch (error) {
            responderError(res, error);
        }
    };

    const conIdentidad = async (req, res, next) => {
        try {
            await asegurarTablas(pool);
            req.yo = await quienEs(pool, req);
            next();
        } catch (error) {
            responderError(res, error);
        }
    };

    async function nombresDeEmpleados(negocioId) {
        const filas = (await pool.query(`SELECT id, nombre FROM public.empleados WHERE negocio_id = $1`, [negocioId])).rows;
        return new Map(filas.map(f => [f.id, f.nombre]));
    }

    function avisarAlEquipo(negocioId, titulo, cuerpo) {
        try {
            const { enviarPushANegocio } = require("./push-server");
            enviarPushANegocio(pool, negocioId, { titulo, cuerpo: String(cuerpo).slice(0, 180), url: "/dueno", pantalla: "tareas" })
                .catch(error => console.warn("No se pudo enviar el push de tareas:", error.message));
        } catch (error) { /* sin push: la tarea queda igual */ }
    }

    // ---------- lo que toca hoy ----------
    app.get("/tareas/hoy", requerirAccesoNegocio, conIdentidad, async (req, res) => {
        try {
            const { negocioId, empleadoId, esGestor } = req.yo;
            const fecha = /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.fecha || "")) ? req.query.fecha : hoyLocal();

            const filas = (await pool.query(`SELECT * FROM public.tareas_equipo WHERE negocio_id = $1 AND activa = true`, [negocioId])).rows;
            const nombres = await nombresDeEmpleados(negocioId);

            const mias = filas.map(filaATarea)
                .filter(t => ocurreEnFecha(t, fecha))
                // una persona ve las suyas y las de todo el equipo; sin persona (dueño en la computadora) se ve todo
                .filter(t => !empleadoId || t.asignadoA === null || t.asignadoA === empleadoId);

            const hechas = mias.length
                ? (await pool.query(`SELECT tarea_id, empleado_nombre, hecha_en FROM public.tareas_cumplimientos WHERE negocio_id = $1 AND fecha = $2 AND tarea_id = ANY($3::int[])`, [negocioId, fecha, mias.map(t => t.id)])).rows
                : [];
            const porTarea = new Map(hechas.map(h => [h.tarea_id, h]));

            const tareas = mias.map(t => {
                const h = porTarea.get(t.id);
                return {
                    id: t.id, titulo: t.titulo, detalle: t.detalle, hora: t.hora, repite: t.repite, repeticion: textoRepeticion(t),
                    asignadoA: t.asignadoA, asignadoNombre: t.asignadoA ? (nombres.get(t.asignadoA) || "Equipo") : "Todo el equipo",
                    hecha: Boolean(h), hechaPor: h ? h.empleado_nombre : null, hechaEn: h ? h.hecha_en : null
                };
            }).sort((a, b) => Number(a.hecha) - Number(b.hecha) || String(a.hora || "99:99").localeCompare(String(b.hora || "99:99")) || a.id - b.id);

            res.json({ ok: true, fecha, esGestor, tareas, resumen: { total: tareas.length, hechas: tareas.filter(t => t.hecha).length } });
        } catch (error) {
            responderError(res, error);
        }
    });

    app.post("/tareas/:id/hecha", requerirAccesoNegocio, conIdentidad, async (req, res) => {
        try {
            const { negocioId, empleadoId, nombre } = req.yo;
            const id = Number(req.params.id);
            const fecha = /^\d{4}-\d{2}-\d{2}$/.test(String(req.body?.fecha || "")) ? req.body.fecha : hoyLocal();
            const hecha = req.body?.hecha !== false;

            const fila = (await pool.query(`SELECT * FROM public.tareas_equipo WHERE id = $1 AND negocio_id = $2 AND activa = true`, [id, negocioId])).rows[0];
            if (!fila) { res.status(404).json({ ok: false, error: "Esa tarea ya no existe." }); return; }

            const tarea = filaATarea(fila);
            if (!ocurreEnFecha(tarea, fecha)) { res.status(400).json({ ok: false, error: "Esa tarea no toca ese día." }); return; }
            if (empleadoId && tarea.asignadoA && tarea.asignadoA !== empleadoId) { res.status(403).json({ ok: false, error: "Esa tarea es de otra persona." }); return; }

            if (hecha) {
                await pool.query(
                    `INSERT INTO public.tareas_cumplimientos (tarea_id, negocio_id, fecha, empleado_id, empleado_nombre) VALUES ($1, $2, $3, $4, $5)
                     ON CONFLICT (tarea_id, fecha) DO NOTHING`,
                    [id, negocioId, fecha, empleadoId, nombre]
                );
            } else {
                await pool.query(`DELETE FROM public.tareas_cumplimientos WHERE tarea_id = $1 AND fecha = $2 AND negocio_id = $3`, [id, fecha, negocioId]);
            }

            res.json({ ok: true, hecha });
        } catch (error) {
            responderError(res, error);
        }
    });

    // ---------- las tareas programadas ----------
    app.get("/tareas", requerirAccesoNegocio, exigirGestor, async (req, res) => {
        try {
            const { negocioId } = req.yo;
            const nombres = await nombresDeEmpleados(negocioId);
            const filas = (await pool.query(`SELECT * FROM public.tareas_equipo WHERE negocio_id = $1 AND activa = true ORDER BY repite = 'no', fecha DESC, id DESC`, [negocioId])).rows;
            const hoy = hoyLocal();

            res.json({
                ok: true,
                tareas: filas.map(f => {
                    const t = filaATarea(f);
                    return { ...t, repeticion: textoRepeticion(t), asignadoNombre: t.asignadoA ? (nombres.get(t.asignadoA) || "Equipo") : "Todo el equipo", creadaPor: f.creada_por_nombre, pasada: t.repite === "no" && t.fecha < hoy };
                })
            });
        } catch (error) {
            responderError(res, error);
        }
    });

    app.post("/tareas", requerirAccesoNegocio, exigirGestor, async (req, res) => {
        try {
            const { negocioId, empleadoId, nombre } = req.yo;
            const { tarea, error } = normalizarTarea(req.body, hoyLocal());
            if (error) { res.status(400).json({ ok: false, error }); return; }

            if (tarea.asignadoA) {
                const existe = (await pool.query(`SELECT 1 FROM public.empleados WHERE id = $1 AND negocio_id = $2 AND activo = true`, [tarea.asignadoA, negocioId])).rows.length;
                if (!existe) { res.status(400).json({ ok: false, error: "Esa persona ya no está en tu equipo." }); return; }
            }

            const fila = (await pool.query(
                `INSERT INTO public.tareas_equipo (negocio_id, titulo, detalle, asignado_a, repite, dias_semana, dia_mes, fecha, hora, creada_por, creada_por_nombre)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING id`,
                [negocioId, tarea.titulo, tarea.detalle, tarea.asignadoA, tarea.repite, tarea.diasSemana, tarea.diaMes, tarea.fecha, tarea.hora, empleadoId, nombre]
            )).rows[0];

            avisarAlEquipo(negocioId, "Tienes una tarea nueva", tarea.titulo);
            res.status(201).json({ ok: true, id: fila.id });
        } catch (error) {
            responderError(res, error);
        }
    });

    app.put("/tareas/:id", requerirAccesoNegocio, exigirGestor, async (req, res) => {
        try {
            const { negocioId } = req.yo;
            const { tarea, error } = normalizarTarea(req.body, hoyLocal());
            if (error) { res.status(400).json({ ok: false, error }); return; }

            const r = await pool.query(
                `UPDATE public.tareas_equipo SET titulo = $3, detalle = $4, asignado_a = $5, repite = $6, dias_semana = $7, dia_mes = $8, fecha = $9, hora = $10
                 WHERE id = $1 AND negocio_id = $2 AND activa = true`,
                [Number(req.params.id), negocioId, tarea.titulo, tarea.detalle, tarea.asignadoA, tarea.repite, tarea.diasSemana, tarea.diaMes, tarea.fecha, tarea.hora]
            );

            if (!r.rowCount) { res.status(404).json({ ok: false, error: "Esa tarea ya no existe." }); return; }
            res.json({ ok: true });
        } catch (error) {
            responderError(res, error);
        }
    });

    // se "borra" apagandola: lo que ya se cumplio queda en el historial
    app.delete("/tareas/:id", requerirAccesoNegocio, exigirGestor, async (req, res) => {
        try {
            const r = await pool.query(`UPDATE public.tareas_equipo SET activa = false WHERE id = $1 AND negocio_id = $2 AND activa = true`, [Number(req.params.id), req.yo.negocioId]);
            if (!r.rowCount) { res.status(404).json({ ok: false, error: "Esa tarea ya no existe." }); return; }
            res.json({ ok: true });
        } catch (error) {
            responderError(res, error);
        }
    });

    // ---------- avisos ----------
    app.get("/avisos", requerirAccesoNegocio, conIdentidad, async (req, res) => {
        try {
            const { negocioId, empleadoId } = req.yo;
            const filas = (await pool.query(
                `SELECT id, mensaje, para, creado_por_nombre, creado_en FROM public.avisos_equipo
                 WHERE negocio_id = $1 AND creado_en > NOW() - INTERVAL '30 days' AND ($2::int IS NULL OR para IS NULL OR para = $2)
                 ORDER BY creado_en DESC LIMIT 50`,
                [negocioId, empleadoId]
            )).rows;
            const nombres = await nombresDeEmpleados(negocioId);

            res.json({ ok: true, avisos: filas.map(a => ({ id: a.id, mensaje: a.mensaje, de: a.creado_por_nombre, para: a.para, paraNombre: a.para ? (nombres.get(a.para) || "Equipo") : "Todo el equipo", cuando: a.creado_en })) });
        } catch (error) {
            responderError(res, error);
        }
    });

    app.post("/avisos", requerirAccesoNegocio, exigirGestor, async (req, res) => {
        try {
            const { negocioId, empleadoId, nombre } = req.yo;
            const mensaje = String(req.body?.mensaje || "").replace(/\s+/g, " ").trim().slice(0, 400);
            const para = Number(req.body?.para) > 0 ? Number(req.body.para) : null;

            if (!mensaje) { res.status(400).json({ ok: false, error: "Escribe el aviso." }); return; }

            const fila = (await pool.query(
                `INSERT INTO public.avisos_equipo (negocio_id, mensaje, para, creado_por, creado_por_nombre) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
                [negocioId, mensaje, para, empleadoId, nombre]
            )).rows[0];

            avisarAlEquipo(negocioId, `Aviso de ${nombre}`, mensaje);
            res.status(201).json({ ok: true, id: fila.id });
        } catch (error) {
            responderError(res, error);
        }
    });

    app.delete("/avisos/:id", requerirAccesoNegocio, exigirGestor, async (req, res) => {
        try {
            await pool.query(`DELETE FROM public.avisos_equipo WHERE id = $1 AND negocio_id = $2`, [Number(req.params.id), req.yo.negocioId]);
            res.json({ ok: true });
        } catch (error) {
            responderError(res, error);
        }
    });

    // ---------- personas del equipo (para elegir a quien se le asigna) ----------
    app.get("/equipo/personas", requerirAccesoNegocio, conIdentidad, async (req, res) => {
        try {
            const { negocioId, esGestor } = req.yo;
            const filas = (await pool.query(`SELECT id, nombre, rol, permisos FROM public.empleados WHERE negocio_id = $1 AND activo = true ORDER BY creado_at ASC`, [negocioId])).rows;
            res.json({
                ok: true,
                personas: filas.map(p => ({ id: p.id, nombre: p.nombre, rol: p.rol, ...(esGestor ? { gestorTareas: p.rol === "Administrador" || (p.permisos || {})[GESTIONAR_TAREAS] === true } : {}) }))
            });
        } catch (error) {
            responderError(res, error);
        }
    });

    // ---------- permiso de encargado ----------
    app.put("/equipo/:id/gestor-tareas", requerirAccesoNegocio, requerirPermiso(PERMISOS.ADMINISTRAR_USUARIOS), async (req, res) => {
        try {
            const negocioId = req.negocioDispositivo?.negocio_id ?? req.negocioAutenticado?.negocio_id;
            const permitido = req.body?.permitido === true;

            const r = await pool.query(
                `UPDATE public.empleados SET permisos = COALESCE(permisos, '{}'::jsonb) || jsonb_build_object($3::text, $4::boolean) WHERE id = $1 AND negocio_id = $2 AND activo = true`,
                [Number(req.params.id), negocioId, GESTIONAR_TAREAS, permitido]
            );

            if (!r.rowCount) { res.status(404).json({ ok: false, error: "Empleado no encontrado." }); return; }
            res.json({ ok: true, permitido });
        } catch (error) {
            responderError(res, error);
        }
    });

    asegurarTablas(pool).catch(error => console.warn("No se pudieron preparar las tablas de tareas:", error.message));
}

module.exports = instalar;
module.exports.GESTIONAR_TAREAS = GESTIONAR_TAREAS;
