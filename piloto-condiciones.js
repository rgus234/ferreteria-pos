// Condiciones de la prueba para negocios piloto: UN solo lugar para que el
// correo de invitacion, la pagina del enlace, la pagina publica y la cuenta del
// negocio digan (y usen) exactamente lo mismo.

const DIAS_PRUEBA_PILOTO = 45;
const CUOTA_MENSUAL_PILOTO = 100;
const DIAS_AVISO_FIN_PRUEBA = 7;

// Lo que cubre la cuota, tal cual se le explica a la persona.
const QUE_CUBRE_CUOTA =
    "el servidor y la base de datos donde se guardan tu inventario, tus ventas y tus créditos, " +
    "las preguntas a Nexo IA y el almacenamiento de las fotos de tus productos";

const ZONA = "America/Mexico_City";

function sumarDias(fecha, dias) {
    const resultado = new Date(fecha);
    resultado.setUTCDate(resultado.getUTCDate() + dias);
    return resultado;
}

function fechaLarga(fecha) {
    return new Date(fecha).toLocaleDateString("es-MX", { day: "numeric", month: "long", timeZone: ZONA });
}

// Fecha en que termina la prueba si empieza en `desde` y primer cobro si decide seguir.
function fechaFinPrueba(desde = new Date()) {
    return sumarDias(desde, DIAS_PRUEBA_PILOTO);
}

// Ejemplo fijo y facil de seguir (1 de marzo + 45 dias = 15 de abril).
function ejemploCondiciones() {
    return {
        inicio: "1 de marzo",
        fin: "15 de abril",
        diaCobro: "15"
    };
}

module.exports = {
    DIAS_PRUEBA_PILOTO,
    CUOTA_MENSUAL_PILOTO,
    DIAS_AVISO_FIN_PRUEBA,
    QUE_CUBRE_CUOTA,
    sumarDias,
    fechaLarga,
    fechaFinPrueba,
    ejemploCondiciones
};
