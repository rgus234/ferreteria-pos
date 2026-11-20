// Cliente del servicio web de Taecel (recargas de tiempo aire y pago de servicios). Escrito contra "Integracion para el servicio web" (2026).
//
// REST, POST application/x-www-form-urlencoded. Toda llamada lleva key y nip (se mandan SOLO desde el servidor: nunca llegan a la pantalla ni a los logs).
//   /api/requestTXN  producto, referencia[, monto]   -> transID
//   /api/statusTXN   transID                         -> estado final de la transaccion
//   /api/getBalance  /api/getProducts  /api/getSales(fecha)
//
// Reglas que impone Taecel y que este cliente respeta:
//   * Una recarga exitosa genera cargo y NO se puede cancelar ni reversar. Por eso requestTXN jamas se reintenta a ciegas.
//   * Despues de requestTXN se consulta statusTXN: primera consulta ENSEGUIDA (sin esperar) y luego cada 3 s, hasta 60 s contados desde que se manda requestTXN.
//   * Tiempos por peticion: requestTXN hasta 30 s; statusTXN hasta 9 s (Taecel pide 5 a 10 s; si no responde, se corta y se vuelve a intentar).
//   * "En proceso" ya genero cargo: se sigue consultando; si se acaba el tiempo se DEJAN de mandar statusTXN y se consulta una vez getSales (ventas del dia).
//     Si getSales sigue en proceso queda PENDIENTE (nunca se da por fallida) y se vuelve a preguntar mas tarde, siempre por getSales.
//   * getProducts se consulta poco (una vez al dia basta).

const INTERVALO_CONSULTA_MS = 3000; // pausa entre una consulta de statusTXN y la siguiente
const TIEMPO_MAXIMO_MS = 60000; // desde que se manda requestTXN
const TIEMPO_REQUEST_MS = 30000; // limite de una peticion requestTXN
const TIEMPO_STATUS_MS = 9000; // limite de una peticion statusTXN (Taecel pide entre 5 y 10 s; 9 s deja margen para que nunca pase de 10)
const TIEMPO_LLAMADA_MS = 15000; // las demas (saldo, productos, ventas)

// Codigos del proveedor (1-9) y del servicio web (403, 405, 3129, 3133, 8888), tal como los describe la documentacion.
const MENSAJES = {
    1: "El número de teléfono no es válido.",
    2: "Destino no disponible: no se pudo abonar.",
    3: "El carrier no respondió. Intenta de nuevo.",
    4: "Ese teléfono no puede recibir abonos.",
    5: "El carrier no respondió. Intenta de nuevo.",
    6: "El carrier no respondió. Intenta de nuevo.",
    7: "Rechazo por tabla de transacción llena. Intenta de nuevo en un momento.",
    8: "Rechazo por tiempo de espera interno. Intenta de nuevo.",
    9: "El autorizador no está disponible. Intenta de nuevo.",
    403: "Sin permisos en Taecel (revisa el key y el nip).",
    405: "Los datos de la recarga no son correctos.",
    3129: "Tabla de transacción llena. Intenta de nuevo en un momento.",
    3133: "Ese producto no existe en Taecel.",
    8888: "Taecel no pudo procesar la solicitud. Intenta de nuevo."
};

function mensajeDeError(codigo, mensajeOriginal = "") {
    return MENSAJES[Number(codigo)] || mensajeOriginal || "No se pudo completar la recarga.";
}

// "$5,624.40" -> 5624.4
function montoDeTexto(texto) {
    if (texto == null || String(texto).trim() === "") return null;

    const numero = Number(String(texto ?? "").replace(/[^0-9.\-]/g, ""));
    return Number.isFinite(numero) ? numero : null;
}

const dormirReal = ms => new Promise(resolver => setTimeout(resolver, ms));

function normalizarBase(url) {
    return String(url || "").trim().replace(/\/+$/, "").replace(/\/api$/i, "");
}

function crearCliente({ url, key, nip, fetchImpl = fetch, tiempoLlamadaMs = null }) {
    const base = normalizarBase(url);
    const limites = { requestTXN: TIEMPO_REQUEST_MS, statusTXN: TIEMPO_STATUS_MS };
    const limiteDe = metodo => (tiempoLlamadaMs != null ? tiempoLlamadaMs : limites[metodo] || TIEMPO_LLAMADA_MS);

    if (!base || !key || !nip) throw new Error("Faltan los datos de conexion con Taecel (url, key y nip).");

    // Devuelve { ok, error, mensaje, data, bruto }. Nunca lanza por una respuesta de Taecel: solo por red / formato.
    async function llamar(metodo, parametros = {}) {
        const cuerpo = new URLSearchParams({ key, nip, ...parametros });
        const control = new AbortController();
        const temporizador = setTimeout(() => control.abort(), limiteDe(metodo));

        try {
            const respuesta = await fetchImpl(`${base}/api/${metodo}`, {
                method: "POST",
                headers: { "Content-Type": "application/x-www-form-urlencoded" },
                body: cuerpo.toString(),
                signal: control.signal
            });

            const texto = await respuesta.text();
            let json;

            try { json = JSON.parse(texto); } catch (error) { return { ok: false, error: 8888, mensaje: "Respuesta de Taecel no valida.", data: null, bruto: null, red: true }; }

            return { ok: json.success === true, error: Number(json.error) || 0, mensaje: json.message || "", data: json.data ?? null, bruto: json };
        } catch (error) {
            // Sin respuesta (red, tiempo agotado): NO se sabe si Taecel proceso o no. Quien llama decide.
            return { ok: false, error: 8888, mensaje: error.name === "AbortError" ? "Taecel tardó demasiado en responder." : "No se pudo conectar con Taecel.", data: null, bruto: null, red: true };
        } finally {
            clearTimeout(temporizador);
        }
    }

    return {
        requestTXN: ({ producto, referencia, monto }) => llamar("requestTXN", { producto, referencia, ...(monto != null ? { monto: String(monto) } : {}) }),
        statusTXN: transID => llamar("statusTXN", { transID: String(transID) }),
        getBalance: () => llamar("getBalance"),
        getProducts: () => llamar("getProducts"),
        getSales: fecha => llamar("getSales", { fecha })
    };
}

// Lee una respuesta de statusTXN y dice en que quedo la transaccion.
//   exitosa | fallida | proceso (ya se cobro, falta el resultado) | desconocido (no hubo respuesta util: se sigue consultando)
function interpretarEstado(respuesta) {
    const datos = respuesta && respuesta.data && !Array.isArray(respuesta.data) ? respuesta.data : null;
    const status = String(datos?.Status ?? datos?.status ?? "").toLowerCase();

    if (respuesta.ok && (status === "" || status.includes("exitosa"))) return { estado: "exitosa", datos };
    if (status.includes("proceso") || status.includes("pendiente")) return { estado: "proceso", datos };
    if (!respuesta.ok && datos && status) return { estado: "fallida", datos, error: respuesta.error, mensaje: mensajeDeError(respuesta.error, respuesta.mensaje) };
    if (!respuesta.ok && respuesta.error && respuesta.error !== 8888 && !respuesta.red) return { estado: "fallida", datos, error: respuesta.error, mensaje: mensajeDeError(respuesta.error, respuesta.mensaje) };

    return { estado: "desconocido", datos };
}

// Busca una transaccion en las ventas del dia (getSales). Es la consulta que se usa cuando ya se acabo el tiempo de statusTXN.
// La fecha es la de Taecel (YYYY-MM-DD). Solo se da por fallida si la venta dice claramente que fracaso; si no aparece, queda "desconocido".
async function consultarVenta(cliente, transID, fecha) {
    const r = await cliente.getSales(fecha);
    const lista = r && r.ok && Array.isArray(r.data) ? r.data : [];
    const fila = lista.find(x => String(x.TransID ?? x.transID ?? "") === String(transID));

    if (!fila) return { estado: "desconocido", datos: null };

    const status = String(fila.Status ?? fila.status ?? "").toLowerCase();

    if (status.includes("exitosa")) return { estado: "exitosa", datos: fila };
    if (status.includes("proceso") || status.includes("pendiente")) return { estado: "proceso", datos: fila };
    if (status.includes("fracas") || status.includes("fallid") || status.includes("rechaz")) return { estado: "fallida", datos: fila, error: 0, mensaje: fila.Nota || "La recarga no se completó." };

    return { estado: "desconocido", datos: fila };
}

// Consulta el resultado de una transaccion respetando los tiempos de Taecel. `ahora` y `dormir` se pueden cambiar en las pruebas.
// `desde` es el momento en que se mando requestTXN (el maximo se cuenta desde ahi). `fecha` (YYYY-MM-DD) es para la consulta por getSales al terminar el tiempo.
async function esperarResultado(cliente, transID, { intervaloMs = INTERVALO_CONSULTA_MS, maximoMs = TIEMPO_MAXIMO_MS, dormir = dormirReal, ahora = Date.now, desde = ahora(), fecha = null } = {}) {
    let ultimo = { estado: "desconocido", datos: null };

    for (;;) {
        const respuesta = await cliente.statusTXN(transID);
        ultimo = interpretarEstado(respuesta);

        if (ultimo.estado === "exitosa" || ultimo.estado === "fallida") return ultimo;
        if (ahora() - desde + intervaloMs > maximoMs) break;

        await dormir(intervaloMs);
    }

    // Se acabo el tiempo: ya NO se manda mas statusTXN. Una consulta a getSales; si sigue en proceso, queda pendiente (el cargo ya existe).
    if (fecha && typeof cliente.getSales === "function") {
        const venta = await consultarVenta(cliente, transID, fecha).catch(() => null);

        if (venta && (venta.estado === "exitosa" || venta.estado === "fallida")) return venta;
        if (venta && venta.estado === "proceso") return { estado: "pendiente", datos: venta.datos, enProceso: true };
    }

    return { estado: "pendiente", datos: ultimo.datos, enProceso: ultimo.estado === "proceso" };
}

module.exports = { crearCliente, esperarResultado, consultarVenta, interpretarEstado, mensajeDeError, montoDeTexto, MENSAJES, INTERVALO_CONSULTA_MS, TIEMPO_MAXIMO_MS, TIEMPO_REQUEST_MS, TIEMPO_STATUS_MS };
