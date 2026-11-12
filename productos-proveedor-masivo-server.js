// Asignar un proveedor a varios productos a la vez (lo usa "Sugerir pedido": los productos sin proveedor no se le pueden pedir a nadie).
//   POST /productos/asignar-proveedor   { productoIds: [..], proveedorId }   -> { ok, actualizados }
// Solo toca productos del negocio y un proveedor del mismo negocio; no cambia precios, existencias ni nada mas.
const { responderError } = require("./error-utils");
const { PERMISOS, requerirPermiso } = require("./rbac");

const MAXIMO = 2000;

module.exports = (app, pool, requerirAccesoNegocio) => {
    app.post("/productos/asignar-proveedor", requerirAccesoNegocio, requerirPermiso(PERMISOS.MODIFICAR_INVENTARIO), async (req, res) => {
        try {
            const negocioId = req.negocioDispositivo?.negocio_id ?? req.negocioAutenticado?.negocio_id;

            if (!negocioId) { res.status(401).json({ ok: false, error: "Este equipo no esta vinculado a ningun negocio" }); return; }

            const ids = [...new Set((Array.isArray(req.body?.productoIds) ? req.body.productoIds : []).map(Number).filter(id => Number.isInteger(id) && id > 0))];
            const proveedorId = Number(req.body?.proveedorId);

            if (!ids.length || ids.length > MAXIMO || !Number.isInteger(proveedorId) || proveedorId <= 0) {
                res.status(400).json({ ok: false, error: `Manda entre 1 y ${MAXIMO} productos y un proveedor.` });
                return;
            }

            const proveedor = (await pool.query(`SELECT id, nombre FROM public.proveedores WHERE id = $1 AND negocio_id = $2`, [proveedorId, negocioId])).rows[0];

            if (!proveedor) { res.status(404).json({ ok: false, error: "Ese proveedor no existe." }); return; }

            const r = await pool.query(
                `UPDATE public.productos SET proveedor_id = $1, proveedor = $2 WHERE negocio_id = $3 AND id = ANY($4::int[])`,
                [proveedor.id, proveedor.nombre, negocioId, ids]
            );

            // El negocio aprende quien le vende cada marca: los siguientes productos de esa marca van con este proveedor.
            const marcasAprendidas = await require("./proveedores-marca").aprenderMarcas(pool, negocioId, proveedor.id, ids);

            res.json({ ok: true, actualizados: r.rowCount, proveedor: proveedor.nombre, marcasAprendidas });
        } catch (error) {
            responderError(res, error);
        }
    });
};
