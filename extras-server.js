// Extras rapidos (abarrotes): productos que casi siempre se agregan junto a otro. Ejemplo: a la bolsita de churros se le ofrece "+ Salsa $2".
//
// Cada extra es un producto normal del inventario (con su precio, su inventario y su renglon en el ticket); aqui solo se guarda
// "a este producto se le ofrecen estos extras". En la venta, al agregar el producto salen fichas con los extras y un toque los suma.
// Solo se usa con la funcion nueva "armado" encendida. La tabla se crea sola la primera vez (migrations/20261122_armado.sql).

const { responderError } = require("./error-utils");
const { PERMISOS, requerirPermiso } = require("./rbac");

const MAXIMO_EXTRAS = 8;

let tablaLista = false;

async function asegurarTabla(pool) {
    if (tablaLista) return;

    await pool.query(`
        CREATE TABLE IF NOT EXISTS public.producto_extras (
            negocio_id INTEGER NOT NULL REFERENCES public.negocios(id) ON DELETE CASCADE,
            producto_id INTEGER NOT NULL REFERENCES public.productos(id) ON DELETE CASCADE,
            extra_id INTEGER NOT NULL REFERENCES public.productos(id) ON DELETE CASCADE,
            orden INTEGER NOT NULL DEFAULT 0,
            PRIMARY KEY (negocio_id, producto_id, extra_id),
            CHECK (producto_id <> extra_id)
        )
    `);
    tablaLista = true;
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

    // { productoId: [{ id, nombre, precio }] } de todo el negocio (son pocos: solo lo que lleva extras).
    app.get("/extras", requerirAccesoNegocio, async (req, res) => {
        try {
            await asegurarTabla(pool);
            const filas = await pool.query(
                `SELECT e.producto_id, b.nombre AS base_nombre, p.id, p.nombre, p.precio
                 FROM public.producto_extras e
                 JOIN public.productos p ON p.id = e.extra_id AND p.negocio_id = e.negocio_id
                 JOIN public.productos b ON b.id = e.producto_id AND b.negocio_id = e.negocio_id
                 WHERE e.negocio_id = $1 ORDER BY e.producto_id, e.orden, p.nombre`,
                [negocioId(req)]
            );

            const extras = {};
            const bases = {};
            filas.rows.forEach(f => { (extras[f.producto_id] = extras[f.producto_id] || []).push({ id: f.id, nombre: f.nombre, precio: Number(f.precio) }); bases[f.producto_id] = f.base_nombre; });

            res.json({ ok: true, extras, bases });
        } catch (error) {
            // Sin la tabla (o sin permiso de la base): nadie tiene extras, la venta sigue igual.
            res.json({ ok: true, extras: {}, bases: {} });
        }
    });

    // Reemplaza la lista de extras de un producto. Lista vacia = ya no ofrece extras.
    app.put("/extras/:productoId", requerirAccesoNegocio, requerirPermiso(PERMISOS.MODIFICAR_INVENTARIO), async (req, res) => {
        let cliente;

        try {
            const idNegocio = negocioId(req);
            const productoId = Number(req.params.productoId);
            const crudos = Array.isArray(req.body?.extraIds) ? req.body.extraIds : [];
            const extraIds = [...new Set(crudos.map(Number))].filter(id => Number.isInteger(id) && id > 0 && id !== productoId);

            if (!Number.isInteger(productoId) || productoId <= 0) {
                res.status(400).json({ ok: false, error: "Producto no valido." });
                return;
            }

            if (extraIds.length > MAXIMO_EXTRAS) {
                res.status(400).json({ ok: false, error: `Maximo ${MAXIMO_EXTRAS} extras por producto.` });
                return;
            }

            await asegurarTabla(pool);

            const existentes = await pool.query(`SELECT id FROM public.productos WHERE negocio_id = $1 AND id = ANY($2::int[])`, [idNegocio, [productoId, ...extraIds]]);

            if (existentes.rows.length !== extraIds.length + 1) {
                res.status(404).json({ ok: false, error: "No se encontro alguno de los productos." });
                return;
            }

            cliente = await pool.connect();
            await cliente.query("BEGIN");
            await cliente.query(`DELETE FROM public.producto_extras WHERE negocio_id = $1 AND producto_id = $2`, [idNegocio, productoId]);

            for (let orden = 0; orden < extraIds.length; orden++) {
                await cliente.query(`INSERT INTO public.producto_extras (negocio_id, producto_id, extra_id, orden) VALUES ($1, $2, $3, $4)`, [idNegocio, productoId, extraIds[orden], orden]);
            }

            await cliente.query("COMMIT");

            res.json({ ok: true, productoId, extraIds });
        } catch (error) {
            if (cliente) await cliente.query("ROLLBACK").catch(() => {});
            responderError(res, error);
        } finally {
            if (cliente) cliente.release();
        }
    });
}

module.exports = instalar;
module.exports.MAXIMO_EXTRAS = MAXIMO_EXTRAS;
