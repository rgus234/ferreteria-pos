// Venta rapida con favoritos (abarrotes): la franja de tarjetas grandes arriba del carrito.
//
// El tendero arma la lista una vez (a mano o con "lo que mas vendo") y se guarda en el negocio,
// no en la computadora: la ven todas las cajas. La lista es ordenada (productos.favorito_orden).

const { responderError } = require("./error-utils");
const { PERMISOS, requerirPermiso } = require("./rbac");

const MAXIMO_FAVORITOS = 24;
const SUGERIDOS = 12;
const DIAS_VENTAS = 30;

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

    // Lista actual (en orden) y, para armarla de un toque, lo que mas se vende y todavia no es favorito.
    app.get("/venta-rapida/favoritos", requerirAccesoNegocio, async (req, res) => {
        try {
            const id = negocioId(req);

            const favoritos = await pool.query(
                `SELECT id FROM public.productos WHERE negocio_id = $1 AND favorito_orden IS NOT NULL ORDER BY favorito_orden ASC, id ASC`,
                [id]
            );

            const vendidos = await pool.query(
                `SELECT (item->>'id')::int AS producto_id, SUM((item->>'cantidad')::numeric) AS unidades
                 FROM public.historial_ventas h
                 CROSS JOIN LATERAL jsonb_array_elements(h.productos) AS item
                 WHERE h.negocio_id = $1 AND h.estado = 'completada' AND h.fecha >= NOW() - ($2 || ' days')::interval
                 AND item->>'id' ~ '^[0-9]+$'
                 GROUP BY 1 ORDER BY unidades DESC LIMIT 60`,
                [id, String(DIAS_VENTAS)]
            );

            const existentes = new Set((await pool.query(`SELECT id FROM public.productos WHERE negocio_id = $1`, [id])).rows.map(f => f.id));
            const yaSon = new Set(favoritos.rows.map(f => f.id));

            const sugeridos = vendidos.rows
                .filter(f => existentes.has(f.producto_id) && !yaSon.has(f.producto_id))
                .slice(0, SUGERIDOS)
                .map(f => ({ productoId: f.producto_id, unidades: Number(f.unidades) }));

            res.json({ ids: favoritos.rows.map(f => f.id), sugeridos, maximo: MAXIMO_FAVORITOS });
        } catch (error) {
            responderError(res, error);
        }
    });

    // Reemplaza la lista completa, en el orden que llega.
    app.put("/venta-rapida/favoritos", requerirAccesoNegocio, requerirPermiso(PERMISOS.MODIFICAR_INVENTARIO), async (req, res) => {
        const crudos = Array.isArray(req.body?.ids) ? req.body.ids : null;

        if (!crudos) {
            res.status(400).json({ error: "Manda la lista de productos favoritos" });
            return;
        }

        const ids = [...new Set(crudos.map(Number).filter(n => Number.isInteger(n) && n > 0))];

        if (ids.length > MAXIMO_FAVORITOS) {
            res.status(400).json({ error: `Puedes tener hasta ${MAXIMO_FAVORITOS} favoritos` });
            return;
        }

        const client = await pool.connect();

        try {
            const id = negocioId(req);
            await client.query("BEGIN");

            if (ids.length) {
                const propios = await client.query(`SELECT id FROM public.productos WHERE negocio_id = $1 AND id = ANY($2::int[])`, [id, ids]);

                if (propios.rows.length !== ids.length) {
                    await client.query("ROLLBACK");
                    res.status(404).json({ error: "Alguno de esos productos no existe" });
                    return;
                }
            }

            await client.query(`UPDATE public.productos SET favorito_orden = NULL WHERE negocio_id = $1 AND favorito_orden IS NOT NULL`, [id]);

            for (let i = 0; i < ids.length; i++) {
                await client.query(`UPDATE public.productos SET favorito_orden = $1 WHERE id = $2 AND negocio_id = $3`, [i + 1, ids[i], id]);
            }

            await client.query("COMMIT");
            res.json({ ok: true, ids });
        } catch (error) {
            await client.query("ROLLBACK").catch(() => {});
            responderError(res, error);
        } finally {
            client.release();
        }
    });
}

module.exports = instalar;
module.exports.MAXIMO_FAVORITOS = MAXIMO_FAVORITOS;
