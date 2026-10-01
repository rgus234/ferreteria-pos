const { config } = require("./config");
const { registrarYAlertarError } = require("./errores-sistema-server");

// En produccion el cliente recibe un mensaje generico -- el detalle
// real (que puede incluir nombres de columnas o restricciones de la
// base de datos) siempre se registra en el log del servidor. En
// desarrollo se sigue viendo el mensaje real para no perder velocidad
// de depuracion.
//
// Se llama en 276 lugares de 23 archivos -- cambiar su firma (ej.
// pedir req, volverla async) hubiera significado tocar los 276. En vez
// de eso, registrarYAlertarError() lee res.req (Express siempre lo
// deja puesto) y se dispara SIN esperar, DESPUES de que la respuesta
// real ya se mando -- nunca puede tumbarla ni retrasarla, ni aunque
// la base de datos o el correo esten caidos (catch propio abajo).
function responderError(res, error, mensajePublico = "Ocurrio un error. Intenta de nuevo en unos segundos.") {
    console.error(error);

    res.status(500).json({
        ok: false,
        error: config.isProduction ? mensajePublico : error.message
    });

    registrarYAlertarError(res, error).catch(err =>
        console.warn("No se pudo registrar/alertar el error:", err.message)
    );
}

module.exports = { responderError };
