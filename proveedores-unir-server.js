// Unir proveedores -- rutas. La logica esta en proveedores-unir.js.
//   GET  /proveedores/duplicados               proveedores activos con sus numeros + grupos sugeridos de repetidos
//   POST /proveedores/unir                     { destinoId, origenIds: [..], usuario? }
//   GET  /proveedores/uniones                  las ultimas uniones (para deshacer)
//   POST /proveedores/uniones/:lote/deshacer
const { responderError } = require("./error-utils");
const { PERMISOS, requerirPermiso } = require("./rbac");
const unir = require("./proveedores-unir");

module.exports = (app, pool, requerirAccesoNegocio) => {
    unir.asegurarTabla(pool).catch(error => console.warn("[proveedores-unir] No se pudo preparar la tabla:", error.message));

    const negocioId = req => req.negocioDispositivo?.negocio_id ?? req.negocioAutenticado?.negocio_id;
    // Los errores propios (datos invalidos, proveedor que no existe) salen con su codigo y su mensaje; el resto, como siempre.
    const fallo = (res, error) => (error instanceof unir.ErrorUnir ? res.status(error.httpStatus).json({ ok: false, error: error.message }) : responderError(res, error));
    const exigirNegocio = (req, res) => { const id = negocioId(req); if (!id) res.status(401).json({ ok: false, error: "Este equipo no esta vinculado a ningun negocio" }); return id; };

    app.get("/proveedores/duplicados", requerirAccesoNegocio, async (req, res) => {
        try {
            const id = exigirNegocio(req, res);
            if (!id) return;
            res.json({ ok: true, ...(await unir.duplicados(pool, id)) });
        } catch (error) {
            fallo(res, error);
        }
    });

    app.post("/proveedores/unir", requerirAccesoNegocio, requerirPermiso(PERMISOS.MODIFICAR_INVENTARIO), async (req, res) => {
        try {
            const id = exigirNegocio(req, res);
            if (!id) return;
            res.json({ ok: true, ...(await unir.unir(pool, id, req.body?.destinoId, req.body?.origenIds, req.body?.usuario)) });
        } catch (error) {
            fallo(res, error);
        }
    });

    app.get("/proveedores/uniones", requerirAccesoNegocio, async (req, res) => {
        try {
            const id = exigirNegocio(req, res);
            if (!id) return;
            res.json({ ok: true, uniones: await unir.uniones(pool, id) });
        } catch (error) {
            fallo(res, error);
        }
    });

    app.post("/proveedores/uniones/:lote/deshacer", requerirAccesoNegocio, requerirPermiso(PERMISOS.MODIFICAR_INVENTARIO), async (req, res) => {
        try {
            const id = exigirNegocio(req, res);
            if (!id) return;
            res.json({ ok: true, ...(await unir.deshacer(pool, id, req.params.lote)) });
        } catch (error) {
            fallo(res, error);
        }
    });
};
