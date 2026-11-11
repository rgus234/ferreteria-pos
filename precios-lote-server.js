// Actualizar precios por lote, con historial.
//   GET  /precios-lote/lotes                  los ultimos lotes aplicados (quien, cuando, cuantos productos, si ya se deshizo)
//   GET  /precios-lote/lote/:loteId           el detalle de un lote: producto, campo, antes y despues
//   POST /precios-lote/aplicar                aplica una lista de cambios { productoId, campo, anterior, nuevo } como UN lote
//   POST /precios-lote/:loteId/deshacer       regresa el lote (solo los productos cuyo precio sigue siendo el que puso el lote)
//   GET  /precios-lote/producto/:id           historial de precios de un producto (de donde venga el cambio)
// El historial se llena con un disparador en productos (migrations/20261113_historial_precios.sql), asi que tambien registra lo que se
// cambie por cualquier otro camino. Aqui solo se le avisa el origen, el lote y el motivo con set_config dentro de la transaccion.
// La pantalla calcula la vista previa; el servidor valida lo que recibe y NO pisa un precio que cambio despues de la vista previa.
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { responderError } = require("./error-utils");
const { PERMISOS, requerirPermiso } = require("./rbac");

const CAMPOS = new Set(["precio_publico", "precio_mayoreo", "precio_distribuidor", "costo"]);
const MAX_CAMBIOS = 3000;
const redondear = valor => Math.round(Number(valor) * 100) / 100;
const limpiarTexto = (valor, largo) => String(valor || "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, largo);

let listo = null;

// Crea la tabla y el disparador (el mismo SQL de la migracion; es repetible).
function asegurar(pool) {
    if (!listo) {
        listo = pool.query(fs.readFileSync(path.join(__dirname, "migrations", "20261113_historial_precios.sql"), "utf8")).catch(error => {
            listo = null;
            throw error;
        });
    }

    return listo;
}

function negocioIdDe(req) {
    const id = req.negocioDispositivo?.negocio_id ?? req.negocioAutenticado?.negocio_id;

    if (!id) {
        const error = new Error("Este equipo no esta vinculado a ningun negocio");
        error.httpStatus = 401;
        throw error;
    }

    return id;
}

// Ejecuta fn(client) en una transaccion con el origen del cambio ya avisado al disparador.
async function conOrigen(pool, { origen, lote, motivo, usuario }, fn) {
    const client = await pool.connect();

    try {
        await client.query("BEGIN");
        await client.query(`SELECT set_config('nexo.origen', $1, true), set_config('nexo.lote', $2, true), set_config('nexo.motivo', $3, true), set_config('nexo.usuario', $4, true)`, [origen, lote, motivo, usuario]);
        const resultado = await fn(client);
        await client.query("COMMIT");
        return resultado;
    } catch (error) {
        await client.query("ROLLBACK").catch(() => {});
        throw error;
    } finally {
        client.release();
    }
}

// Cambia un campo de un producto. Con precio_publico tambien mueve "precio" (el del carrito) si iba igualado, igual que la edicion rapida.
async function aplicarCampo(client, negocioId, productoId, campo, nuevo) {
    if (campo === "precio_publico") {
        await client.query(
            `UPDATE public.productos SET precio = CASE WHEN precio IS NOT DISTINCT FROM precio_publico THEN $1::numeric ELSE precio END, precio_publico = $1::numeric WHERE id = $2 AND negocio_id = $3`,
            [nuevo, productoId, negocioId]
        );
    } else {
        await client.query(`UPDATE public.productos SET ${campo} = $1::numeric WHERE id = $2 AND negocio_id = $3`, [nuevo, productoId, negocioId]);
    }
}

module.exports = (app, pool, requerirAccesoNegocio) => {
    asegurar(pool).catch(error => console.warn("[precios-lote] No se pudo preparar el historial de precios:", error.message));

    app.get("/precios-lote/lotes", requerirAccesoNegocio, async (req, res) => {
        try {
            await asegurar(pool);
            const negocioId = negocioIdDe(req);

            const filas = await pool.query(
                `SELECT lote_id, MIN(created_at) AS fecha, MAX(motivo) AS motivo, MAX(usuario) AS usuario,
                        COUNT(*)::int AS cambios, COUNT(DISTINCT producto_id)::int AS productos,
                        ARRAY_AGG(DISTINCT campo) AS campos,
                        AVG(CASE WHEN anterior > 0 THEN (nuevo - anterior) / anterior * 100 END)::float AS promedio_pct
                 FROM public.historial_precios
                 WHERE negocio_id = $1 AND origen = 'lote' AND lote_id IS NOT NULL
                 GROUP BY lote_id
                 ORDER BY MIN(created_at) DESC
                 LIMIT 30`,
                [negocioId]
            );

            const deshechos = filas.rows.length ? await pool.query(
                `SELECT DISTINCT SUBSTRING(lote_id FROM 5) AS lote FROM public.historial_precios WHERE negocio_id = $1 AND origen = 'deshacer' AND lote_id = ANY($2::text[])`,
                [negocioId, filas.rows.map(f => "des-" + f.lote_id)]
            ) : { rows: [] };
            const deshechosSet = new Set(deshechos.rows.map(f => f.lote));

            res.json({ ok: true, lotes: filas.rows.map(f => ({ id: f.lote_id, fecha: f.fecha, motivo: f.motivo, usuario: f.usuario, cambios: f.cambios, productos: f.productos, campos: f.campos, promedioPct: f.promedio_pct === null ? null : Math.round(f.promedio_pct * 10) / 10, deshecho: deshechosSet.has(f.lote_id) })) });
        } catch (error) {
            responderError(res, error);
        }
    });

    app.get("/precios-lote/lote/:loteId", requerirAccesoNegocio, async (req, res) => {
        try {
            await asegurar(pool);
            const filas = await pool.query(
                `SELECT producto_id, producto_nombre, campo, anterior::float AS anterior, nuevo::float AS nuevo
                 FROM public.historial_precios WHERE negocio_id = $1 AND lote_id = $2 AND origen = 'lote' ORDER BY producto_nombre, campo LIMIT 3000`,
                [negocioIdDe(req), limpiarTexto(req.params.loteId, 64)]
            );

            res.json({ ok: true, cambios: filas.rows });
        } catch (error) {
            responderError(res, error);
        }
    });

    app.get("/precios-lote/producto/:id", requerirAccesoNegocio, async (req, res) => {
        try {
            await asegurar(pool);
            const negocioId = negocioIdDe(req);
            const filas = await pool.query(
                `SELECT campo, anterior::float AS anterior, nuevo::float AS nuevo, origen, lote_id, motivo, usuario, created_at
                 FROM public.historial_precios WHERE negocio_id = $1 AND producto_id = $2 ORDER BY created_at DESC, id DESC LIMIT 100`,
                [negocioId, Number(req.params.id) || 0]
            );

            res.json({ ok: true, cambios: filas.rows });
        } catch (error) {
            responderError(res, error);
        }
    });

    app.post("/precios-lote/aplicar", requerirAccesoNegocio, requerirPermiso(PERMISOS.MODIFICAR_INVENTARIO), async (req, res) => {
        try {
            await asegurar(pool);
            const negocioId = negocioIdDe(req);
            const cambios = Array.isArray(req.body?.cambios) ? req.body.cambios : [];

            if (!cambios.length || cambios.length > MAX_CAMBIOS) {
                res.status(400).json({ ok: false, error: `Manda entre 1 y ${MAX_CAMBIOS} cambios.` });
                return;
            }

            const limpios = [];

            for (const c of cambios) {
                const productoId = Number(c?.productoId);
                const nuevo = redondear(c?.nuevo);
                const anterior = c?.anterior === null || c?.anterior === undefined || c?.anterior === "" ? null : redondear(c.anterior);

                if (!Number.isInteger(productoId) || productoId <= 0 || !CAMPOS.has(c?.campo) || !Number.isFinite(nuevo) || nuevo < 0 || nuevo > 99999999) {
                    res.status(400).json({ ok: false, error: "Hay un cambio con producto, campo o precio invalido." });
                    return;
                }

                limpios.push({ productoId, campo: c.campo, anterior, nuevo });
            }

            const lote = crypto.randomUUID();
            const origen = { origen: "lote", lote, motivo: limpiarTexto(req.body?.motivo, 160), usuario: limpiarTexto(req.body?.usuario, 80) };
            const omitidos = [];
            let aplicados = 0;

            await conOrigen(pool, origen, async client => {
                // Se bloquean en orden para no provocar interbloqueos con otra actualizacion a la vez.
                limpios.sort((a, b) => a.productoId - b.productoId);

                for (const c of limpios) {
                    const fila = (await client.query(`SELECT id, ${c.campo} AS valor FROM public.productos WHERE id = $1 AND negocio_id = $2 FOR UPDATE`, [c.productoId, negocioId])).rows[0];

                    if (!fila) { omitidos.push({ productoId: c.productoId, motivo: "ya no existe" }); continue; }

                    const actual = fila.valor === null ? null : redondear(fila.valor);

                    // Cambio despues de la vista previa: no se pisa.
                    if (c.anterior !== null && actual !== null && Math.abs(actual - c.anterior) > 0.005) { omitidos.push({ productoId: c.productoId, motivo: "cambio mientras tanto" }); continue; }
                    if (actual !== null && Math.abs(actual - c.nuevo) < 0.005) { omitidos.push({ productoId: c.productoId, motivo: "sin cambio" }); continue; }

                    await aplicarCampo(client, negocioId, c.productoId, c.campo, c.nuevo);
                    aplicados++;
                }
            });

            res.json({ ok: true, loteId: aplicados ? lote : null, aplicados, omitidos });
        } catch (error) {
            responderError(res, error);
        }
    });

    app.post("/precios-lote/:loteId/deshacer", requerirAccesoNegocio, requerirPermiso(PERMISOS.MODIFICAR_INVENTARIO), async (req, res) => {
        try {
            await asegurar(pool);
            const negocioId = negocioIdDe(req);
            const loteId = limpiarTexto(req.params.loteId, 64);

            const filas = (await pool.query(
                `SELECT producto_id, campo, anterior, nuevo FROM public.historial_precios WHERE negocio_id = $1 AND lote_id = $2 AND origen = 'lote' ORDER BY id`,
                [negocioId, loteId]
            )).rows;

            if (!filas.length) { res.status(404).json({ ok: false, error: "Ese lote no existe." }); return; }

            const ya = await pool.query(`SELECT 1 FROM public.historial_precios WHERE negocio_id = $1 AND lote_id = $2 AND origen = 'deshacer' LIMIT 1`, [negocioId, "des-" + loteId]);

            if (ya.rows.length) { res.status(400).json({ ok: false, error: "Ese lote ya se deshizo." }); return; }

            const omitidos = [];
            let regresados = 0;

            await conOrigen(pool, { origen: "deshacer", lote: "des-" + loteId, motivo: "Se deshizo un lote de precios", usuario: limpiarTexto(req.body?.usuario, 80) }, async client => {
                for (const f of filas.sort((a, b) => a.producto_id - b.producto_id)) {
                    const fila = (await client.query(`SELECT ${f.campo} AS valor FROM public.productos WHERE id = $1 AND negocio_id = $2 FOR UPDATE`, [f.producto_id, negocioId])).rows[0];

                    if (!fila) { omitidos.push({ productoId: f.producto_id, motivo: "ya no existe" }); continue; }

                    // Solo se regresa si nadie lo movio despues del lote.
                    if (fila.valor === null || Math.abs(redondear(fila.valor) - redondear(f.nuevo)) > 0.005) { omitidos.push({ productoId: f.producto_id, motivo: "cambio despues del lote" }); continue; }
                    if (f.anterior === null) { omitidos.push({ productoId: f.producto_id, motivo: "no tenia precio antes" }); continue; }

                    await aplicarCampo(client, negocioId, f.producto_id, f.campo, redondear(f.anterior));
                    regresados++;
                }
            });

            res.json({ ok: true, regresados, omitidos });
        } catch (error) {
            responderError(res, error);
        }
    });
};

module.exports.asegurar = asegurar;
