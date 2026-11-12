// Proveedor por marca (abarrotes) -- rutas. La logica esta en proveedores-marca.js.
//   GET  /proveedores/sugerido?nombre=   el proveedor que le tocaria a un producto por su marca (sin crear nada)
//   POST /productos/proveedores-por-marca   a los productos sin proveedor les pone el de su marca (crea los que falten)
const { responderError } = require("./error-utils");
const { PERMISOS, requerirPermiso } = require("./rbac");
const { sugerirProveedor, acomodarPorMarca, asegurarTabla } = require("./proveedores-marca");
const { esNegocioDeAbarrotes } = require("./marcas-catalogo");

module.exports = (app, pool, requerirAccesoNegocio) => {
    asegurarTabla(pool).catch(error => console.warn("[proveedores-marca] No se pudo preparar la tabla:", error.message));

    const negocioId = req => req.negocioDispositivo?.negocio_id ?? req.negocioAutenticado?.negocio_id;

    app.get("/proveedores/sugerido", requerirAccesoNegocio, async (req, res) => {
        try {
            const id = negocioId(req);
            if (!id) { res.status(401).json({ ok: false, error: "Este equipo no esta vinculado a ningun negocio" }); return; }

            const nombre = String(req.query.nombre || "").trim().slice(0, 200);
            const sugerido = nombre ? await sugerirProveedor(pool, id, nombre) : null;

            res.json({ ok: true, sugerido });
        } catch (error) {
            responderError(res, error);
        }
    });

    app.post("/productos/proveedores-por-marca", requerirAccesoNegocio, requerirPermiso(PERMISOS.MODIFICAR_INVENTARIO), async (req, res) => {
        try {
            const id = negocioId(req);
            if (!id) { res.status(401).json({ ok: false, error: "Este equipo no esta vinculado a ningun negocio" }); return; }

            if (!(await esNegocioDeAbarrotes(pool, id))) { res.status(400).json({ ok: false, error: "Esto es para negocios de abarrotes." }); return; }

            res.json({ ok: true, ...(await acomodarPorMarca(pool, id)) });
        } catch (error) {
            responderError(res, error);
        }
    });
};
