// Conteos de inventario con aprobacion (plan docs/plan-celular-inventario-y-venta.md, seccion de conteo por estante).
// Quien cuenta (cualquiera que vea el inventario) GUARDA el resultado como "pendiente": no cambia ninguna existencia.
// Un encargado con permiso de modificar inventario lo revisa y APRUEBA (se aplica la diferencia) o RECHAZA.
//
// Al aprobar se suma la DIFERENCIA guardada (contado - esperado al momento de contar) a la existencia de AHORA, no se pone el
// numero contado: asi las ventas que ocurrieron entre el conteo y la aprobacion no se pisan ni crean diferencias falsas.
const { responderError } = require("./error-utils");
const { PERMISOS, requerirPermiso, resolverIdentidadNexo, tienePermiso } = require("./rbac");
const { desglose, compararConteo } = require("./existencias-lugar-server");

const num = valor => Number(valor) || 0;
const redondear = valor => Math.round(num(valor) * 1000) / 1000;

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

    const fallo = (res, estado, mensaje) => res.status(estado).json({ ok: false, error: mensaje });

    async function quien(db, id, req) {
        const empleadoId = Number(req.headers["x-empleado-id"]) || null;
        const nombre = empleadoId ? (await db.query(`SELECT nombre FROM public.empleados WHERE id = $1 AND negocio_id = $2`, [empleadoId, id])).rows[0]?.nombre : "";
        return { empleadoId, nombre: nombre || "Dueño" };
    }

    async function rutaDe(db, negocio, ubicacionId) {
        const filas = (await db.query(`SELECT id, nombre, padre_id FROM public.ubicaciones WHERE negocio_id = $1`, [negocio])).rows;
        const porId = new Map(filas.map(f => [f.id, f]));
        const partes = [];

        for (let a = porId.get(ubicacionId), g = 0; a && g++ < 12; a = a.padre_id ? porId.get(a.padre_id) : null) partes.unshift(a.nombre);

        return partes.join(" › ");
    }

    async function bitacora(db, id, empleadoId, accion, detalle) {
        try {
            await db.query(`INSERT INTO public.bitacora_acciones (negocio_id, empleado_id, accion, detalle) VALUES ($1, $2, $3, $4::jsonb)`, [id, empleadoId, accion, JSON.stringify(detalle)]);
        } catch (error) {
            // La bitacora nunca debe tumbar la operacion real que registra.
        }
    }

    // ---- Guardar un conteo (queda pendiente) ----
    app.post("/ubicaciones/:id/conteo/guardar", requerirAccesoNegocio, requerirPermiso(PERMISOS.VER_INVENTARIO), async (req, res) => {
        const cliente = await pool.connect();

        try {
            const id = negocioId(req);
            const lugarId = Number(req.params.id);
            const conteos = (Array.isArray(req.body?.conteos) ? req.body.conteos : []).filter(c => Number(c.productoId) > 0 && num(c.cantidad) >= 0).slice(0, 1000);
            const lugar = (await cliente.query(`SELECT id, zona FROM public.ubicaciones WHERE id = $1 AND negocio_id = $2 AND activa = true`, [lugarId, id])).rows[0];

            if (!lugar) { fallo(res, 404, "Ese lugar no existe."); return; }
            if (!conteos.length) { fallo(res, 400, "No contaste nada todavia."); return; }

            const ids = [...new Set(conteos.map(c => Number(c.productoId)))];
            const productos = (await cliente.query(
                `SELECT p.id, p.nombre, p.codigo, p.stock,
                        (SELECT COALESCE(SUM(pu.cantidad), 0) FROM public.producto_ubicaciones pu JOIN public.ubicaciones ub ON ub.id = pu.ubicacion_id AND ub.zona = 'bodega' WHERE pu.producto_id = p.id) AS bodega_total,
                        (SELECT cantidad FROM public.producto_ubicaciones WHERE producto_id = p.id AND ubicacion_id = $2) AS cantidad_lugar
                 FROM public.productos p
                 WHERE p.negocio_id = $1 AND (p.id = ANY($3)
                    OR ($4::text = 'tienda' AND p.ubicacion_id = $2)
                    OR ($4::text = 'bodega' AND EXISTS (SELECT 1 FROM public.producto_ubicaciones x WHERE x.producto_id = p.id AND x.ubicacion_id = $2 AND x.cantidad > 0)))
                 ORDER BY p.nombre`,
                [id, lugarId, ids, lugar.zona]
            )).rows;

            const incluirNoEscaneados = req.body?.incluirNoEscaneados === true;
            const resultado = compararConteo(lugar, productos, conteos, incluirNoEscaneados);
            const porProducto = new Map(productos.map(p => [p.id, p]));
            const texto = await rutaDe(cliente, id, lugarId);
            const autor = await quien(cliente, id, req);

            await cliente.query("BEGIN");
            const conteo = (await cliente.query(
                `INSERT INTO public.conteos_inventario (negocio_id, ubicacion_id, ubicacion_texto, zona, faltan, sobran, nota, creado_por_empleado_id, creado_por_nombre)
                 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
                [id, lugarId, texto, lugar.zona, resultado.faltan, resultado.sobran, String(req.body?.nota || "").slice(0, 300), autor.empleadoId, autor.nombre]
            )).rows[0];

            for (const l of resultado.lineas) {
                await cliente.query(
                    `INSERT INTO public.conteo_lineas (conteo_id, producto_id, nombre, codigo, esperado, contado, diferencia, no_escaneado) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
                    [conteo.id, l.productoId, l.nombre, porProducto.get(l.productoId)?.codigo || "", l.esperado, l.contado, l.diferencia, l.noEscaneado]
                );
            }

            await bitacora(cliente, id, autor.empleadoId, "conteo_guardado", { conteoId: conteo.id, lugar: texto, faltan: resultado.faltan, sobran: resultado.sobran });
            await cliente.query("COMMIT");

            res.status(201).json({ ok: true, conteoId: conteo.id, faltan: resultado.faltan, sobran: resultado.sobran, lineas: resultado.lineas.length });
        } catch (error) {
            await cliente.query("ROLLBACK").catch(() => {});
            responderError(res, error);
        } finally {
            cliente.release();
        }
    });

    // ---- Lista y detalle ----
    app.get("/conteos", requerirAccesoNegocio, requerirPermiso(PERMISOS.VER_INVENTARIO), async (req, res) => {
        try {
            const id = negocioId(req);
            const identidad = await resolverIdentidadNexo(req);
            const puedeRevisar = tienePermiso(identidad, PERMISOS.MODIFICAR_INVENTARIO);
            const empleadoId = Number(req.headers["x-empleado-id"]) || null;
            const estado = ["pendiente", "aprobado", "rechazado"].includes(req.query.estado) ? req.query.estado : null;

            // Quien no puede revisar solo ve los conteos que hizo el mismo.
            const filas = (await pool.query(
                `SELECT id, ubicacion_id, ubicacion_texto, zona, estado, faltan, sobran, creado_por_nombre, creado_at, revisado_por_nombre, revisado_at,
                        (SELECT COUNT(*)::int FROM public.conteo_lineas l WHERE l.conteo_id = c.id) AS lineas
                 FROM public.conteos_inventario c
                 WHERE negocio_id = $1 AND ($2::text IS NULL OR estado = $2) AND ($3::boolean OR creado_por_empleado_id IS NOT DISTINCT FROM $4)
                 ORDER BY (estado = 'pendiente') DESC, creado_at DESC LIMIT 60`,
                [id, estado, puedeRevisar, empleadoId]
            )).rows;

            res.json({ ok: true, puedeRevisar, conteos: filas.map(f => ({ id: f.id, ubicacionId: f.ubicacion_id, lugar: f.ubicacion_texto, zona: f.zona, estado: f.estado, faltan: num(f.faltan), sobran: num(f.sobran), creadoPor: f.creado_por_nombre, creadoAt: f.creado_at, revisadoPor: f.revisado_por_nombre, revisadoAt: f.revisado_at, lineas: f.lineas })) });
        } catch (error) {
            responderError(res, error);
        }
    });

    app.get("/conteos/:id", requerirAccesoNegocio, requerirPermiso(PERMISOS.VER_INVENTARIO), async (req, res) => {
        try {
            const id = negocioId(req);
            const identidad = await resolverIdentidadNexo(req);
            const puedeRevisar = tienePermiso(identidad, PERMISOS.MODIFICAR_INVENTARIO);
            const c = (await pool.query(`SELECT * FROM public.conteos_inventario WHERE id = $1 AND negocio_id = $2`, [Number(req.params.id), id])).rows[0];

            if (!c) { fallo(res, 404, "Ese conteo no existe."); return; }

            const empleadoId = Number(req.headers["x-empleado-id"]) || null;
            if (!puedeRevisar && c.creado_por_empleado_id !== empleadoId) { fallo(res, 403, "Solo puedes ver los conteos que hiciste tu."); return; }

            const lineas = (await pool.query(`SELECT producto_id, nombre, codigo, esperado, contado, diferencia, no_escaneado, aplicada FROM public.conteo_lineas WHERE conteo_id = $1 ORDER BY ABS(diferencia) DESC, nombre`, [c.id])).rows;

            res.json({
                ok: true, puedeRevisar,
                conteo: { id: c.id, ubicacionId: c.ubicacion_id, lugar: c.ubicacion_texto, zona: c.zona, estado: c.estado, faltan: num(c.faltan), sobran: num(c.sobran), nota: c.nota, creadoPor: c.creado_por_nombre, creadoAt: c.creado_at, revisadoPor: c.revisado_por_nombre, revisadoAt: c.revisado_at, notaRevision: c.nota_revision },
                lineas: lineas.map(l => ({ productoId: l.producto_id, nombre: l.nombre, codigo: l.codigo, esperado: num(l.esperado), contado: l.contado === null ? null : num(l.contado), diferencia: num(l.diferencia), noEscaneado: l.no_escaneado, aplicada: l.aplicada }))
            });
        } catch (error) {
            responderError(res, error);
        }
    });

    // ---- Aprobar: aplica la diferencia guardada a las existencias de ahora ----
    app.post("/conteos/:id/aprobar", requerirAccesoNegocio, requerirPermiso(PERMISOS.MODIFICAR_INVENTARIO), async (req, res) => {
        const cliente = await pool.connect();

        try {
            const id = negocioId(req);
            const excluir = new Set((Array.isArray(req.body?.excluir) ? req.body.excluir : []).map(Number));
            const motivos = req.body?.motivos && typeof req.body.motivos === "object" ? req.body.motivos : {}; // { productoId: "caducado" | "danado" | "otro" }

            await cliente.query("BEGIN");
            const c = (await cliente.query(`SELECT * FROM public.conteos_inventario WHERE id = $1 AND negocio_id = $2 FOR UPDATE`, [Number(req.params.id), id])).rows[0];

            if (!c) { await cliente.query("ROLLBACK"); fallo(res, 404, "Ese conteo no existe."); return; }
            if (c.estado !== "pendiente") { await cliente.query("ROLLBACK"); fallo(res, 409, `Este conteo ya fue ${c.estado}.`); return; }

            const revisor = await quien(cliente, id, req);
            const lineas = (await cliente.query(`SELECT * FROM public.conteo_lineas WHERE conteo_id = $1 AND diferencia <> 0 AND producto_id IS NOT NULL ORDER BY producto_id`, [c.id])).rows;
            let aplicadas = 0;

            for (const l of lineas) {
                if (excluir.has(l.producto_id)) continue;

                const p = (await cliente.query(`SELECT id, nombre, codigo, stock, precio, precio_publico, precio_distribuidor, costo FROM public.productos WHERE id = $1 AND negocio_id = $2 FOR UPDATE`, [l.producto_id, id])).rows[0];
                if (!p) continue;

                const dif = num(l.diferencia);
                const nuevo = Math.max(0, redondear(num(p.stock) + dif));

                if (c.zona === "bodega" && c.ubicacion_id) {
                    await cliente.query(
                        `INSERT INTO public.producto_ubicaciones (negocio_id, producto_id, ubicacion_id, cantidad) VALUES ($1,$2,$3,GREATEST(0,$4))
                         ON CONFLICT (producto_id, ubicacion_id) DO UPDATE SET cantidad = GREATEST(0, public.producto_ubicaciones.cantidad + $5), updated_at = NOW()`,
                        [id, p.id, c.ubicacion_id, dif, dif]
                    );
                }

                await cliente.query(`UPDATE public.productos SET stock = $3 WHERE id = $1 AND negocio_id = $2`, [p.id, id, nuevo]);
                await cliente.query(
                    `INSERT INTO public.ajustes_inventario (negocio_id, producto_id, producto_nombre, codigo, tipo, cantidad, stock_anterior, stock_nuevo, motivo, referencia, usuario_nombre, fecha_ajuste)
                     VALUES ($1,$2,$3,$4,'conteo',$5,$6,$7,$8,$9,$10,CURRENT_DATE)`,
                    [id, p.id, p.nombre, p.codigo || "", Math.abs(dif), num(p.stock), nuevo, `Conteo aprobado (conto ${c.creado_por_nombre})`, `Conteo #${c.id} · ${c.ubicacion_texto}`, revisor.nombre]
                );
                // Lo que falto puede ser merma (se tiro): queda con su motivo y lo que costo, igual que "Tirar" en Por revisar. El stock baja una sola vez.
                const motivoMerma = motivos[l.producto_id];

                if (dif < 0 && ["caducado", "danado", "otro"].includes(motivoMerma)) {
                    await cliente.query(
                        `INSERT INTO public.mermas_producto (negocio_id, producto_id, producto_nombre, cantidad, motivo, costo_unitario, precio_unitario, usuario_nombre)
                         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
                        [id, p.id, p.nombre, Math.abs(dif), motivoMerma, num(p.precio_distribuidor) || num(p.costo), num(p.precio_publico) || num(p.precio), revisor.nombre]
                    );
                }

                await cliente.query(`UPDATE public.conteo_lineas SET aplicada = true WHERE id = $1`, [l.id]);
                aplicadas++;
            }

            await cliente.query(`UPDATE public.conteos_inventario SET estado = 'aprobado', revisado_por_empleado_id = $2, revisado_por_nombre = $3, revisado_at = NOW() WHERE id = $1`, [c.id, revisor.empleadoId, revisor.nombre]);
            await bitacora(cliente, id, revisor.empleadoId, "conteo_aprobado", { conteoId: c.id, lugar: c.ubicacion_texto, aplicadas, excluidos: excluir.size });
            await cliente.query("COMMIT");

            res.json({ ok: true, aplicadas });
        } catch (error) {
            await cliente.query("ROLLBACK").catch(() => {});
            responderError(res, error);
        } finally {
            cliente.release();
        }
    });

    // ---- Rechazar: no cambia ninguna existencia ----
    app.post("/conteos/:id/rechazar", requerirAccesoNegocio, requerirPermiso(PERMISOS.MODIFICAR_INVENTARIO), async (req, res) => {
        try {
            const id = negocioId(req);
            const revisor = await quien(pool, id, req);
            const r = await pool.query(
                `UPDATE public.conteos_inventario SET estado = 'rechazado', revisado_por_empleado_id = $3, revisado_por_nombre = $4, revisado_at = NOW(), nota_revision = $5
                 WHERE id = $1 AND negocio_id = $2 AND estado = 'pendiente' RETURNING id, ubicacion_texto`,
                [Number(req.params.id), id, revisor.empleadoId, revisor.nombre, String(req.body?.nota || "").slice(0, 300)]
            );

            if (!r.rowCount) { fallo(res, 409, "Ese conteo no existe o ya fue revisado."); return; }

            await bitacora(pool, id, revisor.empleadoId, "conteo_rechazado", { conteoId: r.rows[0].id, lugar: r.rows[0].ubicacion_texto });
            res.json({ ok: true });
        } catch (error) {
            responderError(res, error);
        }
    });
}

module.exports = instalar;
module.exports.desglose = desglose;
