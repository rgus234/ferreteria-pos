// Pantalla del cliente: idea real del dueno (un video de TikTok donde
// un empleado de ferreteria busca lo que el cliente describe con sus
// propias palabras y una segunda pantalla, viendo hacia el cliente,
// le muestra la foto del producto para que confirme "si, es ese" antes
// de que se lo cobren).
//
// Mecanismo deliberadamente simple: SIN websockets. Un dispositivo ya
// vinculado a este negocio (un tablet viejo, un celular, un segundo
// monitor -- el mismo mecanismo de vinculacion que ya usa cualquier
// caja) abre esta pantalla y hace polling corto (ver
// pantalla-cliente-view.js). Cualquier otra pantalla del mismo negocio
// (Explorar Nexo, Punto de venta, Inventario) manda aqui "esto es lo
// que se esta viendo ahorita" cada vez que alguien toca un resultado.
//
// Estado en memoria, no en base de datos a proposito: es lo que se
// esta mostrando EN ESTE INSTANTE, nunca algo que deba sobrevivir un
// reinicio del servidor ni consultarse desde otro lado. Un Map global
// del proceso (no por-negocio en la base) alcanza: Render corre un
// solo proceso Node para esta app, y el volumen de negocios activos a
// la vez es bajo.
const ESTADO_POR_NEGOCIO = new Map();

// No se queda pegado para siempre si nadie vuelve a tocar nada --
// pasados 10 minutos sin actualizarse se considera vencido y la
// pantalla del cliente vuelve sola a "esperando".
const VIGENCIA_MS = 10 * 60 * 1000;

function negocioIdDeRequest(req) {
    const negocioId = req.negocioDispositivo?.negocio_id ?? req.negocioAutenticado?.negocio_id;
    if (!negocioId) {
        const error = new Error("Este equipo no esta vinculado a ningun negocio");
        error.httpStatus = 401;
        throw error;
    }
    return negocioId;
}

module.exports = (app, pool, requerirAccesoNegocio) => {
    app.post("/pantalla-cliente/mostrar", requerirAccesoNegocio, (req, res) => {
        try {
            const negocioId = negocioIdDeRequest(req);
            const { nombre, foto, fotos, precio, marca, origen } = req.body || {};

            if (!nombre || typeof nombre !== "string") {
                res.status(400).json({ ok: false, error: "Falta el nombre del producto" });
                return;
            }

            // fotos: la galeria completa (Ver detalles / Recepcion
            // Inteligente ya la resuelven) -- se acota para que nadie
            // mande un arreglo gigante por error. foto se conserva
            // aparte por compatibilidad con quien todavia no manda
            // galeria; si falta, se toma la primera de fotos.
            const galeria = Array.isArray(fotos)
                ? fotos.filter(item => typeof item === "string" && item).slice(0, 12).map(item => item.slice(0, 500))
                : [];

            ESTADO_POR_NEGOCIO.set(negocioId, {
                nombre: nombre.slice(0, 200),
                foto: typeof foto === "string" && foto ? foto.slice(0, 500) : (galeria[0] || null),
                fotos: galeria,
                precio: Number.isFinite(Number(precio)) ? Number(precio) : null,
                marca: typeof marca === "string" && marca ? marca.slice(0, 100) : null,
                origen: typeof origen === "string" ? origen.slice(0, 40) : "",
                actualizadoEn: Date.now()
            });

            res.json({ ok: true });
        } catch (error) {
            if (error.httpStatus) { res.status(error.httpStatus).json({ ok: false, error: error.message }); return; }
            res.status(500).json({ ok: false, error: "No se pudo actualizar la pantalla del cliente" });
        }
    });

    app.get("/pantalla-cliente/actual", requerirAccesoNegocio, (req, res) => {
        try {
            const negocioId = negocioIdDeRequest(req);
            const estado = ESTADO_POR_NEGOCIO.get(negocioId) || null;

            if (estado && Date.now() - estado.actualizadoEn > VIGENCIA_MS) {
                ESTADO_POR_NEGOCIO.delete(negocioId);
                res.json({ ok: true, producto: null });
                return;
            }

            res.json({ ok: true, producto: estado });
        } catch (error) {
            if (error.httpStatus) { res.status(error.httpStatus).json({ ok: false, error: error.message }); return; }
            res.status(500).json({ ok: false, error: "No se pudo leer la pantalla del cliente" });
        }
    });

    app.post("/pantalla-cliente/limpiar", requerirAccesoNegocio, (req, res) => {
        try {
            const negocioId = negocioIdDeRequest(req);
            ESTADO_POR_NEGOCIO.delete(negocioId);
            res.json({ ok: true });
        } catch (error) {
            if (error.httpStatus) { res.status(error.httpStatus).json({ ok: false, error: error.message }); return; }
            res.status(500).json({ ok: false, error: "No se pudo limpiar la pantalla del cliente" });
        }
    });
};
