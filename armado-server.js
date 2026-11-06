// Armar productos (abarrotes y cualquier negocio que reempaca): convierte producto a granel en porciones o bolsitas.
//
// Un "armado" dice cuanto granel lleva una unidad terminada: 0.1 kg de churros = 1 bolsita, con una merma opcional (lo que se
// pierde al preparar) y el costo del empaque. Al armar "20 bolsitas", el granel baja 20 x 0.1 kg (mas merma) y las bolsitas suben 20,
// todo en una sola operacion, con su registro de quien lo hizo; se puede deshacer en las siguientes 24 horas si las bolsitas aun estan.
// Usa el mismo inventario fraccionario que las ventas por peso (stock + stock_resto). Solo se usa con la funcion nueva "armado".

const { responderError } = require("./error-utils");
const { PERMISOS, requerirPermiso } = require("./rbac");
const lotes = require("./lotes-server");

const HORAS_PARA_DESHACER = 24;

let tablasListas = false;

async function asegurarTablas(pool) {
    if (tablasListas) return;

    await pool.query(`
        CREATE TABLE IF NOT EXISTS public.producto_armado (
            id SERIAL PRIMARY KEY,
            negocio_id INTEGER NOT NULL REFERENCES public.negocios(id) ON DELETE CASCADE,
            producto_origen_id INTEGER NOT NULL REFERENCES public.productos(id) ON DELETE CASCADE,
            producto_destino_id INTEGER NOT NULL REFERENCES public.productos(id) ON DELETE CASCADE,
            cantidad_origen NUMERIC(12, 3) NOT NULL CHECK (cantidad_origen > 0),
            merma_pct NUMERIC(5, 2) NOT NULL DEFAULT 0 CHECK (merma_pct >= 0 AND merma_pct < 100),
            costo_extra NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (costo_extra >= 0),
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            UNIQUE (negocio_id, producto_destino_id)
        )
    `);
    await pool.query(`
        CREATE TABLE IF NOT EXISTS public.armados_log (
            id SERIAL PRIMARY KEY,
            negocio_id INTEGER NOT NULL REFERENCES public.negocios(id) ON DELETE CASCADE,
            armado_id INTEGER,
            producto_origen_id INTEGER NOT NULL,
            producto_destino_id INTEGER NOT NULL,
            unidades NUMERIC(12, 3) NOT NULL,
            origen_usado NUMERIC(12, 3) NOT NULL,
            usuario_nombre TEXT,
            deshecho_at TIMESTAMPTZ,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
    `);
    tablasListas = true;
}

const redondear3 = valor => Math.round((Number(valor) + Number.EPSILON) * 1000) / 1000;
const redondear2 = valor => Math.round((Number(valor) + Number.EPSILON) * 100) / 100;
const numero = valor => Number(String(valor ?? "").replace(",", "."));

// Cuanto granel se gasta al armar `unidades`: unidades x cantidad por unidad, mas la merma.
function origenNecesario(unidades, cantidadOrigen, mermaPct) {
    return redondear3(Number(unidades) * Number(cantidadOrigen) * (1 + Number(mermaPct || 0) / 100));
}

// Costo de una unidad terminada: lo que cuesta su granel (con merma) mas el empaque.
function costoUnidad(costoOrigen, cantidadOrigen, mermaPct, costoExtra) {
    return redondear2(Number(costoOrigen || 0) * Number(cantidadOrigen) * (1 + Number(mermaPct || 0) / 100) + Number(costoExtra || 0));
}

// Mismo UPDATE atomico que usa la venta por peso (server.js moverStockDecimal): stock entero + stock_resto.
async function moverStock(client, negocioId, productoId, delta) {
    await client.query(
        `UPDATE public.productos
         SET stock = FLOOR(stock + stock_resto + $1::numeric)::int,
             stock_resto = (stock + stock_resto + $1::numeric) - FLOOR(stock + stock_resto + $1::numeric)
         WHERE id = $2 AND negocio_id = $3`,
        [delta, productoId, negocioId]
    );
}

const existencia = fila => Number(fila.stock) + Number(fila.stock_resto || 0);

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

    const filaArmado = f => ({
        id: f.id,
        origenId: f.producto_origen_id,
        origenNombre: f.origen_nombre,
        origenUnidad: f.origen_unidad,
        origenExistencia: redondear3(Number(f.origen_stock) + Number(f.origen_resto || 0)),
        destinoId: f.producto_destino_id,
        destinoNombre: f.destino_nombre,
        destinoExistencia: redondear3(Number(f.destino_stock) + Number(f.destino_resto || 0)),
        cantidadOrigen: Number(f.cantidad_origen),
        mermaPct: Number(f.merma_pct),
        costoExtra: Number(f.costo_extra),
        costoUnidad: costoUnidad(Number(f.origen_costo) || 0, f.cantidad_origen, f.merma_pct, f.costo_extra),
        // Cuantas unidades alcanzan con el granel que hay
        puedeArmar: Math.floor((Number(f.origen_stock) + Number(f.origen_resto || 0)) / origenNecesario(1, f.cantidad_origen, f.merma_pct) + 1e-9)
    });

    const SELECT_ARMADOS = `
        SELECT a.*, o.nombre AS origen_nombre, o.unidad_venta AS origen_unidad, o.stock AS origen_stock, o.stock_resto AS origen_resto,
               COALESCE(NULLIF(o.precio_distribuidor, 0), NULLIF(o.costo, 0), 0) AS origen_costo,
               d.nombre AS destino_nombre, d.stock AS destino_stock, d.stock_resto AS destino_resto
        FROM public.producto_armado a
        JOIN public.productos o ON o.id = a.producto_origen_id
        JOIN public.productos d ON d.id = a.producto_destino_id
        WHERE a.negocio_id = $1`;

    app.get("/armados", requerirAccesoNegocio, async (req, res) => {
        try {
            await asegurarTablas(pool);
            const filas = await pool.query(`${SELECT_ARMADOS} ORDER BY d.nombre`, [negocioId(req)]);

            res.json({ ok: true, armados: filas.rows.map(filaArmado) });
        } catch (error) {
            // Sin las tablas (o sin permiso de la base): no hay armados, nada se rompe.
            res.json({ ok: true, armados: [] });
        }
    });

    // Crea o cambia la receta de un producto terminado (uno por producto destino).
    app.put("/armados", requerirAccesoNegocio, requerirPermiso(PERMISOS.MODIFICAR_INVENTARIO), async (req, res) => {
        try {
            const idNegocio = negocioId(req);
            const origenId = Number(req.body?.origenId);
            const destinoId = Number(req.body?.destinoId);
            const cantidad = numero(req.body?.cantidadOrigen);
            const merma = req.body?.mermaPct === undefined || req.body?.mermaPct === "" ? 0 : numero(req.body.mermaPct);
            const extra = req.body?.costoExtra === undefined || req.body?.costoExtra === "" ? 0 : numero(req.body.costoExtra);

            if (!Number.isInteger(origenId) || !Number.isInteger(destinoId) || origenId <= 0 || destinoId <= 0) {
                res.status(400).json({ ok: false, error: "Elige el producto a granel y el producto que vas a armar." });
                return;
            }

            if (origenId === destinoId) {
                res.status(400).json({ ok: false, error: "El producto armado no puede ser el mismo que el granel." });
                return;
            }

            if (!(cantidad > 0) || cantidad > 100000) {
                res.status(400).json({ ok: false, error: "Escribe cuanto granel lleva cada unidad, por ejemplo 0.1 kg." });
                return;
            }

            if (!Number.isFinite(merma) || merma < 0 || merma >= 100) {
                res.status(400).json({ ok: false, error: "La merma es un porcentaje de 0 a 99." });
                return;
            }

            if (!Number.isFinite(extra) || extra < 0 || extra > 99999) {
                res.status(400).json({ ok: false, error: "El costo del empaque no es valido." });
                return;
            }

            await asegurarTablas(pool);

            const productos = await pool.query(`SELECT id FROM public.productos WHERE negocio_id = $1 AND id = ANY($2::int[])`, [idNegocio, [origenId, destinoId]]);

            if (productos.rows.length !== 2) {
                res.status(404).json({ ok: false, error: "No se encontro alguno de los productos." });
                return;
            }

            const guardado = await pool.query(
                `INSERT INTO public.producto_armado (negocio_id, producto_origen_id, producto_destino_id, cantidad_origen, merma_pct, costo_extra)
                 VALUES ($1, $2, $3, $4, $5, $6)
                 ON CONFLICT (negocio_id, producto_destino_id)
                 DO UPDATE SET producto_origen_id = EXCLUDED.producto_origen_id, cantidad_origen = EXCLUDED.cantidad_origen,
                               merma_pct = EXCLUDED.merma_pct, costo_extra = EXCLUDED.costo_extra
                 RETURNING id`,
                [idNegocio, origenId, destinoId, redondear3(cantidad), redondear2(merma), redondear2(extra)]
            );

            const fila = (await pool.query(`${SELECT_ARMADOS} AND a.id = $2`, [idNegocio, guardado.rows[0].id])).rows[0];

            res.json({ ok: true, armado: filaArmado(fila) });
        } catch (error) {
            responderError(res, error);
        }
    });

    app.delete("/armados/:id", requerirAccesoNegocio, requerirPermiso(PERMISOS.MODIFICAR_INVENTARIO), async (req, res) => {
        try {
            await asegurarTablas(pool);
            await pool.query(`DELETE FROM public.producto_armado WHERE id = $1 AND negocio_id = $2`, [Number(req.params.id), negocioId(req)]);

            res.json({ ok: true });
        } catch (error) {
            responderError(res, error);
        }
    });

    // Arma N unidades: baja el granel y sube lo armado, en una sola operacion.
    app.post("/armados/:id/armar", requerirAccesoNegocio, requerirPermiso(PERMISOS.MODIFICAR_INVENTARIO), async (req, res) => {
        const idNegocio = negocioId(req);
        const unidades = numero(req.body?.unidades);

        if (!(unidades > 0) || unidades > 100000 || redondear3(unidades) !== unidades) {
            res.status(400).json({ ok: false, error: "Escribe cuantas unidades armaste, por ejemplo 20." });
            return;
        }

        let cliente;

        try {
            await asegurarTablas(pool);
            cliente = await pool.connect();
            await cliente.query("BEGIN");

            const armado = (await cliente.query(`SELECT * FROM public.producto_armado WHERE id = $1 AND negocio_id = $2 FOR UPDATE`, [Number(req.params.id), idNegocio])).rows[0];

            if (!armado) {
                await cliente.query("ROLLBACK");
                res.status(404).json({ ok: false, error: "No se encontro ese armado." });
                return;
            }

            // Se bloquea el granel para que dos cajas no lo gasten a la vez.
            const origen = (await cliente.query(`SELECT id, nombre, stock, stock_resto FROM public.productos WHERE id = $1 AND negocio_id = $2 FOR UPDATE`, [armado.producto_origen_id, idNegocio])).rows[0];
            const necesario = origenNecesario(unidades, armado.cantidad_origen, armado.merma_pct);

            if (!origen || existencia(origen) + 1e-9 < necesario) {
                await cliente.query("ROLLBACK");
                res.status(409).json({
                    ok: false,
                    error: `No alcanza el granel: se necesitan ${necesario} y hay ${redondear3(origen ? existencia(origen) : 0)} de ${origen?.nombre || "granel"}.`,
                    necesario,
                    disponible: redondear3(origen ? existencia(origen) : 0)
                });
                return;
            }

            await moverStock(cliente, idNegocio, armado.producto_origen_id, -necesario);
            await moverStock(cliente, idNegocio, armado.producto_destino_id, unidades);

            const registro = (await cliente.query(
                `INSERT INTO public.armados_log (negocio_id, armado_id, producto_origen_id, producto_destino_id, unidades, origen_usado, usuario_nombre)
                 VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
                [idNegocio, armado.id, armado.producto_origen_id, armado.producto_destino_id, unidades, necesario, String(req.body?.usuarioNombre || "").slice(0, 80) || null]
            )).rows[0];

            await cliente.query(
                `INSERT INTO public.bitacora_acciones (negocio_id, empleado_id, accion, detalle) VALUES ($1, NULL, 'armar_producto', $2::jsonb)`,
                [idNegocio, JSON.stringify({ armadoId: armado.id, unidades, origenUsado: necesario, registroId: registro.id })]
            ).catch(() => {});

            await cliente.query("COMMIT");

            // Lo armado con caducidad (o con vida util del producto) abre su lote, igual que al recibir mercancia.
            let loteId = null;
            const caducidad = String(req.body?.caducidad || "").trim();

            if (caducidad) {
                try { loteId = await lotes.registrarAltaConLote(pool, { negocioId: idNegocio, productoId: armado.producto_destino_id, stock: unidades, fechaCaducidad: caducidad }); } catch (error) { /* el armado ya quedo: el lote es un extra */ }
            }

            const fila = (await pool.query(`${SELECT_ARMADOS} AND a.id = $2`, [idNegocio, armado.id])).rows[0];

            res.status(201).json({ ok: true, registroId: registro.id, origenUsado: necesario, loteId, armado: filaArmado(fila) });
        } catch (error) {
            if (cliente) await cliente.query("ROLLBACK").catch(() => {});
            responderError(res, error);
        } finally {
            if (cliente) cliente.release();
        }
    });

    app.get("/armados/historial", requerirAccesoNegocio, async (req, res) => {
        try {
            await asegurarTablas(pool);
            const filas = await pool.query(
                `SELECT l.id, l.unidades, l.origen_usado, l.usuario_nombre, l.deshecho_at, l.created_at,
                        o.nombre AS origen_nombre, d.nombre AS destino_nombre,
                        (l.deshecho_at IS NULL AND l.created_at > NOW() - ($2::text || ' hours')::interval) AS se_puede_deshacer
                 FROM public.armados_log l
                 LEFT JOIN public.productos o ON o.id = l.producto_origen_id
                 LEFT JOIN public.productos d ON d.id = l.producto_destino_id
                 WHERE l.negocio_id = $1 ORDER BY l.id DESC LIMIT 30`,
                [negocioId(req), String(HORAS_PARA_DESHACER)]
            );

            res.json({ ok: true, historial: filas.rows.map(f => ({ ...f, unidades: Number(f.unidades), origen_usado: Number(f.origen_usado) })) });
        } catch (error) {
            res.json({ ok: true, historial: [] });
        }
    });

    // Deshace un armado reciente: devuelve el granel y quita lo armado, si todavia estan las unidades.
    app.post("/armados/historial/:id/deshacer", requerirAccesoNegocio, requerirPermiso(PERMISOS.MODIFICAR_INVENTARIO), async (req, res) => {
        const idNegocio = negocioId(req);
        let cliente;

        try {
            await asegurarTablas(pool);
            cliente = await pool.connect();
            await cliente.query("BEGIN");

            const registro = (await cliente.query(`SELECT * FROM public.armados_log WHERE id = $1 AND negocio_id = $2 FOR UPDATE`, [Number(req.params.id), idNegocio])).rows[0];

            if (!registro || registro.deshecho_at) {
                await cliente.query("ROLLBACK");
                res.status(404).json({ ok: false, error: "No se encontro ese armado o ya se deshizo." });
                return;
            }

            if (Date.now() - new Date(registro.created_at).getTime() > HORAS_PARA_DESHACER * 3600 * 1000) {
                await cliente.query("ROLLBACK");
                res.status(409).json({ ok: false, error: `Solo se puede deshacer en las primeras ${HORAS_PARA_DESHACER} horas.` });
                return;
            }

            const destino = (await cliente.query(`SELECT id, nombre, stock, stock_resto FROM public.productos WHERE id = $1 AND negocio_id = $2 FOR UPDATE`, [registro.producto_destino_id, idNegocio])).rows[0];

            if (!destino || existencia(destino) + 1e-9 < Number(registro.unidades)) {
                await cliente.query("ROLLBACK");
                res.status(409).json({ ok: false, error: "Ya se vendio parte de lo que se armo, asi que no se puede deshacer completo." });
                return;
            }

            await moverStock(cliente, idNegocio, registro.producto_destino_id, -Number(registro.unidades));
            await moverStock(cliente, idNegocio, registro.producto_origen_id, Number(registro.origen_usado));
            await cliente.query(`UPDATE public.armados_log SET deshecho_at = NOW() WHERE id = $1`, [registro.id]);
            await cliente.query("COMMIT");

            res.json({ ok: true });
        } catch (error) {
            if (cliente) await cliente.query("ROLLBACK").catch(() => {});
            responderError(res, error);
        } finally {
            if (cliente) cliente.release();
        }
    });
}

module.exports = instalar;
module.exports.origenNecesario = origenNecesario;
module.exports.costoUnidad = costoUnidad;
