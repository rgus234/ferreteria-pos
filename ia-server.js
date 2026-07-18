const { config } = require("./config");
const { responderError } = require("./error-utils");

// Cliente de Anthropic inicializado de forma perezosa -- si todavia
// no hay ANTHROPIC_API_KEY (caso normal mientras el usuario crea su
// cuenta), la ruta de abajo responde con un error claro en vez de
// tumbar el arranque del servidor.
let anthropicClient = null;

function obtenerAnthropic() {
    if (!config.anthropicApiKey) return null;
    if (!anthropicClient) {
        const Anthropic = require("@anthropic-ai/sdk");
        anthropicClient = new Anthropic({ apiKey: config.anthropicApiKey });
    }
    return anthropicClient;
}

async function negocioActual(req, pool) {
    const negocioId = req.negocioDispositivo?.negocio_id ?? req.negocioAutenticado?.negocio_id;

    if (!negocioId) {
        const error = new Error("Este equipo no esta vinculado a ningun negocio");
        error.httpStatus = 401;
        throw error;
    }

    const resultado = await pool.query(
        `SELECT id, slug, nombre, giro, estado, plan FROM public.negocios WHERE id = $1 LIMIT 1`,
        [negocioId]
    );

    if (resultado.rows.length === 0) {
        const error = new Error("Negocio no encontrado");
        error.httpStatus = 404;
        throw error;
    }

    return resultado.rows[0];
}

const SYSTEM_PROMPT_NEXO = `Eres Nexo, el asistente de inteligencia artificial de Nexo POS, un sistema de punto de venta para ferreterias en Mexico. Hablas con el dueno o un empleado del negocio.

Tu personalidad: amigable, profesional, cercano y motivador. Explicas las cosas de forma sencilla, sin tecnicismos. Cuando las ventas van bien, lo celebras con naturalidad; cuando van mal, animas sin exagerar.

Reglas estrictas:
- Nunca inventes numeros, nombres de productos ni cifras. Para cualquier dato concreto sobre el negocio (ventas, inventario, creditos), SIEMPRE llama primero a la herramienta correspondiente.
- Si una pregunta no se puede responder con las herramientas disponibles, dilo con honestidad en vez de adivinar.
- Responde en espanol de Mexico, en dos o tres parrafos cortos como maximo salvo que te pidan mas detalle.
- Responde siempre en texto plano, sin markdown (nada de asteriscos, guiones de lista ni encabezados) -- el chat donde apareces no interpreta formato.
- No das consejos legales, fiscales ni financieros formales -- solo observaciones practicas sobre el negocio.`;

const HERRAMIENTAS_NEXO = [
    {
        name: "resumen_ventas",
        description: "Devuelve el total vendido, numero de transacciones y ticket promedio de los ultimos N dias. Usala para responder preguntas sobre como van las ventas.",
        input_schema: {
            type: "object",
            properties: {
                dias: { type: "integer", description: "Dias hacia atras a incluir. Por defecto 7." }
            },
            required: []
        }
    },
    {
        name: "productos_stock_bajo",
        description: "Lista los productos cuyo stock actual esta en o por debajo de su stock minimo configurado. Usala para detectar productos por agotarse.",
        input_schema: { type: "object", properties: {}, required: [] }
    },
    {
        name: "productos_sin_movimiento",
        description: "Lista productos que no han tenido ninguna venta en los ultimos N dias. Util para detectar productos que casi no se venden.",
        input_schema: {
            type: "object",
            properties: {
                dias: { type: "integer", description: "Dias hacia atras a revisar. Por defecto 30." }
            },
            required: []
        }
    },
    {
        name: "resumen_creditos",
        description: "Devuelve cuantos clientes tienen saldo pendiente, cuantos estan vencidos y el monto total vencido en creditos del negocio.",
        input_schema: { type: "object", properties: {}, required: [] }
    }
];

const MAX_ITERACIONES_HERRAMIENTAS = 6;
const MAX_HISTORIAL_ENTRADAS = 12;
const MAX_CARACTERES_MENSAJE = 2000;

// Nivel 1: preguntas comunes resueltas directo contra SQL, sin tocar
// la API de Anthropic -- costo cero, respuesta instantanea. Solo se
// intenta en el primer mensaje de una conversacion (sin historial):
// las preguntas de seguimiento dependen de contexto que estas
// plantillas fijas no pueden manejar bien.
function clasificarIntencionNivel1(mensaje) {
    const texto = mensaje.toLowerCase();

    // Cualquier senal de que se quiere razonamiento/analisis manda
    // siempre al modelo (Nivel 3), sin importar el tema.
    const pideAnalisis = /(por qu[eé]|recomend|compara|explica|qu[eé] opinas|c[oó]mo puedo|sugerenc|estrategia|mejorar|an[aá]lisis|pron[oó]stico|tendencia)/.test(texto);
    if (pideAnalisis) return null;

    const patrones = [
        { herramienta: "resumen_ventas", regex: /(c[oó]mo van (mis )?ventas|ventas de hoy|cu[aá]nto (he )?vend|total de ventas|resumen de ventas)/ },
        { herramienta: "productos_stock_bajo", regex: /(stock bajo|productos? (por )?agot|se est[aá]n? agotando|inventario bajo|qu[eé] me falta)/ },
        { herramienta: "productos_sin_movimiento", regex: /(sin movimiento|no se venden|casi no se venden|producto.* estancad)/ },
        { herramienta: "resumen_creditos", regex: /(cr[eé]ditos? vencidos?|clientes? con adeudo|cu[aá]nto me deben|deudas? pendientes?)/ }
    ];

    const coincidencias = patrones.filter(p => p.regex.test(texto));

    // Pregunta compuesta (toca mas de un tema a la vez) -- mejor que
    // la sintetice el modelo en vez de una plantilla fija.
    if (coincidencias.length !== 1) return null;

    return coincidencias[0].herramienta;
}

function respuestaNivel1(herramienta, datos) {
    switch (herramienta) {
        case "resumen_ventas":
            return datos.transacciones === 0
                ? `En los ultimos ${datos.dias} dias no registraste ninguna venta.`
                : `En los ultimos ${datos.dias} dias llevas ${datos.transacciones} venta(s) por un total de $${datos.total.toFixed(2)}, con un ticket promedio de $${datos.ticketPromedio.toFixed(2)}.`;

        case "productos_stock_bajo": {
            if (datos.productos.length === 0) {
                return "Ahora mismo no tienes productos por debajo de su stock minimo. Todo bien por ese lado.";
            }
            const lista = datos.productos.slice(0, 5).map(p => `${p.nombre} (${p.stock} de ${p.stock_minimo})`).join(", ");
            const extra = datos.productos.length > 5 ? ` y ${datos.productos.length - 5} mas` : "";
            return `Tienes ${datos.productos.length} producto(s) con stock bajo: ${lista}${extra}.`;
        }

        case "productos_sin_movimiento": {
            if (datos.productos.length === 0) {
                return `No encontre productos sin ventas en los ultimos ${datos.dias} dias. Buena senal.`;
            }
            const lista = datos.productos.slice(0, 5).map(p => p.nombre).join(", ");
            const extra = datos.productos.length > 5 ? ` y ${datos.productos.length - 5} mas` : "";
            return `${datos.productos.length} producto(s) no han tenido ventas en los ultimos ${datos.dias} dias: ${lista}${extra}.`;
        }

        case "resumen_creditos":
            return datos.clientesConAdeudo === 0
                ? "No tienes clientes con credito pendiente ahora mismo."
                : `Tienes ${datos.clientesConAdeudo} cliente(s) con saldo pendiente, de los cuales ${datos.clientesVencidos} estan vencidos por un total de $${datos.totalVencido.toFixed(2)}.`;

        default:
            return null;
    }
}

// Cache corto para preguntas de Nivel 3 (las que si cuestan) que se
// repiten en una ventana corta -- ej. abrir el chat, preguntar, cerrar
// y volver a preguntar lo mismo 20 segundos despues. Solo aplica al
// primer mensaje de una conversacion, igual que el Nivel 1. En
// memoria del proceso -- suficiente mientras corra una sola instancia
// del servidor.
const CACHE_RESPUESTAS = new Map();
const CACHE_TTL_MS = 90 * 1000;

function claveCache(negocioId, mensaje) {
    return `${negocioId}::${mensaje.toLowerCase().trim().replace(/\s+/g, " ")}`;
}

function limpiarCacheExpirado() {
    const ahora = Date.now();
    for (const [clave, entrada] of CACHE_RESPUESTAS) {
        if (entrada.expiraEn <= ahora) CACHE_RESPUESTAS.delete(clave);
    }
}

async function ejecutarHerramientaNexo(pool, negocioId, nombre, input) {
    switch (nombre) {
        case "resumen_ventas": {
            const dias = Number.isFinite(Number(input?.dias)) && Number(input.dias) > 0 ? Number(input.dias) : 7;
            const resultado = await pool.query(
                `
                SELECT COUNT(*) AS transacciones,
                       COALESCE(SUM(total), 0) AS total,
                       COALESCE(AVG(total), 0) AS ticket_promedio
                FROM public.historial_ventas
                WHERE negocio_id = $1
                AND fecha >= NOW() - ($2 || ' days')::interval
                `,
                [negocioId, dias]
            );

            const fila = resultado.rows[0];

            return {
                dias,
                transacciones: Number(fila.transacciones),
                total: Number(fila.total),
                ticketPromedio: Number(fila.ticket_promedio)
            };
        }

        case "productos_stock_bajo": {
            const resultado = await pool.query(
                `
                SELECT nombre, codigo, stock, stock_minimo
                FROM public.productos
                WHERE negocio_id = $1
                AND stock <= stock_minimo
                ORDER BY stock ASC
                LIMIT 20
                `,
                [negocioId]
            );

            return { productos: resultado.rows };
        }

        case "productos_sin_movimiento": {
            const dias = Number.isFinite(Number(input?.dias)) && Number(input.dias) > 0 ? Number(input.dias) : 30;
            const resultado = await pool.query(
                `
                SELECT p.nombre, p.codigo, p.stock
                FROM public.productos p
                WHERE p.negocio_id = $1
                AND NOT EXISTS (
                    SELECT 1
                    FROM public.historial_ventas hv,
                         LATERAL jsonb_array_elements(hv.productos) AS item
                    WHERE hv.negocio_id = $1
                    AND hv.fecha >= NOW() - ($2 || ' days')::interval
                    AND (item->>'id')::int = p.id
                )
                ORDER BY p.stock DESC
                LIMIT 20
                `,
                [negocioId, dias]
            );

            return { dias, productos: resultado.rows };
        }

        case "resumen_creditos": {
            const resultado = await pool.query(
                `
                SELECT
                    COUNT(*) FILTER (WHERE saldo.monto > 0) AS clientes_con_adeudo,
                    COUNT(*) FILTER (WHERE saldo.monto > 0 AND c.fecha_vencimiento < CURRENT_DATE) AS clientes_vencidos,
                    COALESCE(SUM(saldo.monto) FILTER (WHERE saldo.monto > 0 AND c.fecha_vencimiento < CURRENT_DATE), 0) AS total_vencido
                FROM public.clientes_credito c
                LEFT JOIN LATERAL (
                    SELECT COALESCE(SUM(
                        CASE WHEN m.tipo = 'venta' THEN m.monto
                             WHEN m.tipo = 'abono' THEN -m.monto
                             ELSE 0 END
                    ), 0) AS monto
                    FROM public.movimientos_credito m
                    WHERE m.cliente_id = c.id AND m.negocio_id = c.negocio_id
                ) AS saldo ON true
                WHERE c.activo = true AND c.negocio_id = $1
                `,
                [negocioId]
            );

            const fila = resultado.rows[0];

            return {
                clientesConAdeudo: Number(fila.clientes_con_adeudo),
                clientesVencidos: Number(fila.clientes_vencidos),
                totalVencido: Number(fila.total_vencido)
            };
        }

        default:
            return { error: `Herramienta desconocida: ${nombre}` };
    }
}

async function chatNexoIA(pool, negocioId, mensajes) {
    const anthropic = obtenerAnthropic();
    let mensajesActuales = mensajes;

    for (let intento = 0; intento < MAX_ITERACIONES_HERRAMIENTAS; intento++) {
        const respuesta = await anthropic.messages.create({
            model: "claude-opus-4-8",
            max_tokens: 1024,
            thinking: { type: "adaptive" },
            system: SYSTEM_PROMPT_NEXO,
            tools: HERRAMIENTAS_NEXO,
            messages: mensajesActuales
        });

        if (respuesta.stop_reason !== "tool_use") {
            return respuesta.content
                .filter(bloque => bloque.type === "text")
                .map(bloque => bloque.text)
                .join("\n")
                .trim();
        }

        mensajesActuales = [...mensajesActuales, { role: "assistant", content: respuesta.content }];

        const bloquesHerramienta = respuesta.content.filter(bloque => bloque.type === "tool_use");
        const resultados = [];

        for (const bloque of bloquesHerramienta) {
            const resultado = await ejecutarHerramientaNexo(pool, negocioId, bloque.name, bloque.input);
            resultados.push({
                type: "tool_result",
                tool_use_id: bloque.id,
                content: JSON.stringify(resultado)
            });
        }

        mensajesActuales = [...mensajesActuales, { role: "user", content: resultados }];
    }

    return "Estoy tardando mas de lo normal analizando tu negocio. Intenta de nuevo en un momento.";
}

module.exports = (app, pool, requerirAccesoNegocio) => {
    app.post("/ia/chat", requerirAccesoNegocio, async (req, res) => {
        const anthropic = obtenerAnthropic();

        if (!anthropic) {
            res.status(503).json({ ok: false, error: "Nexo IA todavia no esta configurado en este servidor" });
            return;
        }

        const mensaje = String(req.body?.mensaje || "").trim();

        if (!mensaje) {
            res.status(400).json({ ok: false, error: "Escribe un mensaje para Nexo" });
            return;
        }

        if (mensaje.length > MAX_CARACTERES_MENSAJE) {
            res.status(400).json({ ok: false, error: `El mensaje es demasiado largo (maximo ${MAX_CARACTERES_MENSAJE} caracteres)` });
            return;
        }

        const historialCliente = Array.isArray(req.body?.historial) ? req.body.historial : [];
        const historialRecortado = historialCliente.slice(-MAX_HISTORIAL_ENTRADAS);
        const esPrimerMensaje = historialRecortado.length === 0;

        try {
            const negocio = await negocioActual(req, pool);

            if (esPrimerMensaje) {
                const herramientaNivel1 = clasificarIntencionNivel1(mensaje);

                if (herramientaNivel1) {
                    const datos = await ejecutarHerramientaNexo(pool, negocio.id, herramientaNivel1, {});
                    const respuesta = respuestaNivel1(herramientaNivel1, datos);

                    if (respuesta) {
                        res.json({ ok: true, respuesta, nivel: 1 });
                        return;
                    }
                }

                const clave = claveCache(negocio.id, mensaje);
                const enCache = CACHE_RESPUESTAS.get(clave);

                if (enCache && enCache.expiraEn > Date.now()) {
                    res.json({ ok: true, respuesta: enCache.respuesta, nivel: "3-cache" });
                    return;
                }
            }

            const mensajesIniciales = [
                ...historialRecortado
                    .filter(entrada => entrada && (entrada.rol === "user" || entrada.rol === "assistant") && entrada.contenido)
                    .map(entrada => ({ role: entrada.rol, content: String(entrada.contenido) })),
                { role: "user", content: mensaje }
            ];

            const respuesta = await chatNexoIA(pool, negocio.id, mensajesIniciales);

            if (esPrimerMensaje) {
                limpiarCacheExpirado();
                CACHE_RESPUESTAS.set(claveCache(negocio.id, mensaje), { respuesta, expiraEn: Date.now() + CACHE_TTL_MS });
            }

            res.json({ ok: true, respuesta, nivel: 3 });
        } catch (error) {
            responderError(res, error);
        }
    });
};
