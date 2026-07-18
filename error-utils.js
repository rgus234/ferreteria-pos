const { config } = require("./config");

// En produccion el cliente recibe un mensaje generico -- el detalle
// real (que puede incluir nombres de columnas o restricciones de la
// base de datos) siempre se registra en el log del servidor. En
// desarrollo se sigue viendo el mensaje real para no perder velocidad
// de depuracion.
function responderError(res, error, mensajePublico = "Ocurrio un error. Intenta de nuevo en unos segundos.") {
    console.error(error);

    res.status(500).json({
        ok: false,
        error: config.isProduction ? mensajePublico : error.message
    });
}

module.exports = { responderError };
