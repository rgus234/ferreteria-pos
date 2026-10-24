// Condiciones de la prueba para negocios piloto: UN solo lugar para que el
// correo de invitacion, la pagina del enlace, la pagina publica y la cuenta del
// negocio digan (y usen) exactamente lo mismo.

const DIAS_PRUEBA_PILOTO = 45;
const CUOTA_MENSUAL_PILOTO = 200;
const DIAS_AVISO_FIN_PRUEBA = 7;

// Identifica el precio de la cuota en Stripe (se crea solo si no existe). Un precio de Stripe no se puede
// editar, asi que al subir la cuota se estrena una llave nueva; la anterior ($100) se sigue reconociendo
// para que las suscripciones que ya existen conserven su periodo y su precio.
const LLAVE_PRECIO_PILOTO = "nexo_piloto_mensual_200";
const LLAVE_PRECIO_PILOTO_100 = "nexo_piloto_mensual";
const LLAVES_PRECIO_PILOTO_RECONOCIDAS = [LLAVE_PRECIO_PILOTO, LLAVE_PRECIO_PILOTO_100];

// Negocios a los que se les respeta la cuota que se acordo desde el principio (negocio_id -> cuota).
// 1 = Ferreteria Olimpico: $100 al mes, no sube con la cuota nueva.
const CUOTAS_ACORDADAS = { 1: 100 };

// Personas (por correo) a quienes se les invito con $100 y se les respeta aunque su negocio aun no exista:
// Cuitlahuac, de Ferreteria El Profe.
const CORREOS_CUOTA_ACORDADA = ["cuevascuitlahuac430@gmail.com"];

// Cuota mensual y llave del precio de Stripe que le toca a un negocio (y/o a un correo de invitacion).
function cuotaDeNegocio(negocioId, correos = []) {
    const lista = [].concat(correos).map(c => String(c || "").trim().toLowerCase());
    const acordada = CUOTAS_ACORDADAS[Number(negocioId)] === 100 || lista.some(c => CORREOS_CUOTA_ACORDADA.includes(c));
    if (acordada) return { cuota: 100, llave: LLAVE_PRECIO_PILOTO_100 };
    return { cuota: CUOTA_MENSUAL_PILOTO, llave: LLAVE_PRECIO_PILOTO };
}

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
    LLAVE_PRECIO_PILOTO,
    LLAVES_PRECIO_PILOTO_RECONOCIDAS,
    cuotaDeNegocio,
    QUE_CUBRE_CUOTA,
    sumarDias,
    fechaLarga,
    fechaFinPrueba,
    ejemploCondiciones
};
