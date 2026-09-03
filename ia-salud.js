// Semaforo de la API de IA.
//
// Por que existe: el 2026-09-02 la cuenta de Anthropic se quedo sin saldo
// y NADIE se entero. Nexo IA dejo de responder a todos los clientes, y la
// lectura asistida de catalogos se quedo sin respaldo. Cada llamada
// fallaba dentro de su propio try/catch, el cliente veia un mensaje
// generico ("no pude responder ahorita") y el dueno no veia nada. Se
// descubrio de casualidad, corriendo una prueba de otra cosa.
//
// La diferencia que importa: "el modelo tardo" es un problema pasajero
// que se resuelve solo; "la cuenta no tiene saldo" es un problema del
// DUENO y no se arregla hasta que el vaya a pagar. Mezclarlos en el mismo
// catch es lo que hizo que uno tapara al otro.

const CLASIFICACION = [
    {
        estado: "sin_saldo",
        // El mensaje exacto que devuelve la API cuando se acaba el credito.
        prueba: e => /credit balance is too low/i.test(e?.message || ""),
        // Lo lee el dueno en el panel, no un programador.
        aviso: "Tu cuenta de IA se quedo sin saldo. Nexo IA no puede responder y la lectura asistida de catalogos esta detenida hasta que recargues."
    },
    {
        estado: "llave_invalida",
        prueba: e => e?.status === 401 || /authentication|api key/i.test(e?.message || ""),
        aviso: "La llave de la API de IA no es valida. Nexo IA no puede responder."
    },
    {
        estado: "limite",
        prueba: e => e?.status === 429,
        aviso: "Se alcanzo el limite de peticiones a la IA. Suele resolverse solo en unos minutos."
    },
    {
        estado: "caida",
        prueba: e => e?.status >= 500,
        aviso: "El servicio de IA no esta respondiendo. Suele ser temporal."
    }
];

function clasificarFalloIA(error) {
    const encontrado = CLASIFICACION.find(c => c.prueba(error));
    if (encontrado) return { estado: encontrado.estado, aviso: encontrado.aviso };
    return null;
}

// Solo los fallos que significan algo para el dueno se guardan. Un
// timeout suelto o un error de parseo no son "la IA esta caida", y
// pintarlos en el panel enseñaria a ignorarlo.
async function registrarFalloIA(pool, error, origen) {
    const clasificado = clasificarFalloIA(error);
    if (!clasificado) return null;

    try {
        await pool.query(
            `UPDATE public.ia_salud
                SET estado = $1, detalle = $2, origen = $3,
                    fallos_seguidos = fallos_seguidos + 1,
                    ultimo_fallo_en = NOW(), actualizado_en = NOW()
              WHERE id = true`,
            [clasificado.estado, clasificado.aviso, origen || ""]
        );
    } catch (fallo) {
        // Registrar el problema NUNCA puede causar otro. Si la base no
        // esta, el error original sigue su camino intacto.
        console.log(`[ia-salud] no se pudo registrar el fallo: ${fallo.message}`);
    }

    return clasificado;
}

// Una llamada que sale bien apaga el semaforo: si el dueno recargo, el
// panel tiene que reflejarlo solo, sin que nadie toque nada.
async function registrarExitoIA(pool) {
    try {
        await pool.query(
            `UPDATE public.ia_salud
                SET estado = 'ok', detalle = '', origen = '',
                    fallos_seguidos = 0, ultimo_exito_en = NOW(), actualizado_en = NOW()
              WHERE id = true AND estado <> 'ok'`
        );
    } catch (fallo) {
        console.log(`[ia-salud] no se pudo registrar el exito: ${fallo.message}`);
    }
}

async function estadoIA(pool) {
    try {
        const r = await pool.query(
            `SELECT estado, detalle, origen, fallos_seguidos, ultimo_fallo_en, ultimo_exito_en
               FROM public.ia_salud WHERE id = true`
        );
        return r.rows[0] || { estado: "ok", detalle: "" };
    } catch (error) {
        return { estado: "ok", detalle: "" };
    }
}

module.exports = { clasificarFalloIA, registrarFalloIA, registrarExitoIA, estadoIA };
