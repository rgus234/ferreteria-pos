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

// Modulos a los que Nexo AI puede navegar por conversacion (herramienta
// abrir_modulo). Es un subconjunto deliberado de AYUDA_MODULOS_POS
// (shell-topbar.js, frontend) -- solo los modulos que tienen una
// funcion mostrarX() clara y directa en el sidebar. El dispatcher
// real vive en el frontend (nexo-ia.js); aqui solo se valida que la
// clave exista, para no dejar que el modelo invente una.
const MODULOS_NAVEGABLES = {
    inicio: "Resumen operativo del negocio",
    venta: "Pantalla de venta / punto de venta",
    inventario: "Inventario y productos",
    categorias: "Categorias del inventario",
    "inventario-bajo": "Productos con existencia baja",
    reportes: "Reportes y graficas de ventas",
    clientes: "Clientes y creditos",
    proveedores: "Proveedores",
    catalogo: "Catalogo de proveedor / importacion de listas",
    configuracion: "Configuracion del negocio",
    cuenta: "Cuenta, plan y suscripcion"
};

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
    },
    {
        name: "top_productos_vendidos",
        description: "Lista los productos con mas ingresos en los ultimos N dias, ordenados de mayor a menor. Usala para preguntas sobre cuales son los productos mas vendidos.",
        input_schema: {
            type: "object",
            properties: {
                dias: { type: "integer", description: "Dias hacia atras a incluir. Por defecto 30." },
                limite: { type: "integer", description: "Cuantos productos regresar como maximo. Por defecto 5." }
            },
            required: []
        }
    },
    {
        name: "comparar_ventas_periodos",
        description: "Compara el total vendido y el numero de transacciones de los ultimos N dias contra los N dias inmediatamente anteriores. Usala para preguntas directas de comparacion entre dos periodos iguales.",
        input_schema: {
            type: "object",
            properties: {
                dias: { type: "integer", description: "Tamano de cada periodo a comparar, en dias. Por defecto 7." }
            },
            required: []
        }
    },
    {
        name: "abrir_modulo",
        description: "Navega la pantalla del usuario a otra seccion del sistema cuando pide ver o ir a algo (ej. \"muestrame ventas\", \"quiero agregar un producto\", \"llevame a reportes\"). Solo llamala cuando la intencion de navegar sea clara. No la uses para responder preguntas de datos -- para eso usa las otras herramientas.",
        input_schema: {
            type: "object",
            properties: {
                modulo: {
                    type: "string",
                    enum: Object.keys(MODULOS_NAVEGABLES),
                    description: "Clave exacta del modulo al que navegar."
                }
            },
            required: ["modulo"]
        }
    },
    {
        name: "preparar_creacion",
        description: "Cuando el usuario pide agregar/crear un cliente de credito, un proveedor o un producto, usa esta herramienta para estructurar los datos que menciono en la conversacion. Esta herramienta NUNCA crea el registro en la base de datos -- solo normaliza los datos para que el sistema abra el formulario correspondiente ya prellenado, y el usuario decide si guardarlo o corregirlo. Solo llena los campos que el usuario realmente menciono, no inventes datos que no dijo.",
        input_schema: {
            type: "object",
            properties: {
                tipo: { type: "string", enum: ["cliente_credito", "proveedor", "producto"], description: "Que tipo de registro se quiere crear." },
                nombre: { type: "string", description: "Nombre del cliente, proveedor o producto." },
                telefono: { type: "string" },
                correo: { type: "string" },
                contacto: { type: "string", description: "Nombre de la persona de contacto (solo proveedor)." },
                limiteCredito: { type: "number", description: "Limite de credito (solo cliente_credito)." },
                precio: { type: "number", description: "Precio de venta (solo producto)." },
                stock: { type: "number", description: "Existencia inicial (solo producto)." },
                codigo: { type: "string", description: "Codigo del producto (solo producto)." }
            },
            required: ["tipo", "nombre"]
        }
    },
    {
        name: "buscar_producto",
        description: "Busca uno o varios productos por nombre o codigo y regresa su precio, stock y stock minimo. Usala cuando pregunten por un producto especifico.",
        input_schema: {
            type: "object",
            properties: {
                termino: { type: "string", description: "Nombre o codigo (completo o parcial) del producto a buscar." }
            },
            required: ["termino"]
        }
    }
];

const MAX_ITERACIONES_HERRAMIENTAS = 6;
const MAX_HISTORIAL_ENTRADAS = 12;
const MAX_CARACTERES_MENSAJE = 2000;

// Clasificador de 3 niveles, solo para el primer mensaje de una
// conversacion (sin historial) -- las preguntas de seguimiento
// dependen de contexto que esto no puede evaluar bien, asi que
// siempre van completas a Nivel 3.
//
// Nivel 1 ($0, sin IA): la pregunta calza exacta con una sola
// plantilla fija, resuelta directo contra SQL.
// Nivel 2 (claude-haiku-4-5): no pide razonamiento pero tampoco calza
// en una plantilla exacta -- mismo tool-calling, modelo economico.
// Nivel 3 (claude-opus-4-8): pide razonamiento/analisis explicito.
function clasificarNivelPregunta(mensaje) {
    const texto = mensaje.toLowerCase();

    // Cualquier senal de que se quiere razonamiento/analisis manda
    // siempre al modelo capaz (Nivel 3), sin importar el tema.
    const pideAnalisis = /(por qu[eé]|recomend|compara|explica|qu[eé] opinas|c[oó]mo puedo|sugerenc|estrategia|mejorar|an[aá]lisis|pron[oó]stico|tendencia)/.test(texto);
    if (pideAnalisis) return { nivel: 3 };

    const patrones = [
        { herramienta: "resumen_ventas", regex: /(c[oó]mo van (mis )?ventas|ventas de hoy|cu[aá]nto (he )?vend|total de ventas|resumen de ventas)/ },
        { herramienta: "productos_stock_bajo", regex: /(stock bajo|productos? (por )?agot|se est[aá]n? agotando|inventario bajo|qu[eé] me falta)/ },
        { herramienta: "productos_sin_movimiento", regex: /(sin movimiento|no se venden|casi no se venden|producto.* estancad)/ },
        { herramienta: "resumen_creditos", regex: /(cr[eé]ditos? vencidos?|clientes? con adeudo|cu[aá]nto me deben|deudas? pendientes?)/ }
    ];

    const coincidencias = patrones.filter(p => p.regex.test(texto));

    // Coincidencia exacta con un solo tema -> Nivel 1. Pregunta
    // compuesta, sin coincidencia, o algo mas especifico (ej. un
    // producto en particular, un top de ventas) -> Nivel 2.
    if (coincidencias.length === 1) return { nivel: 1, herramienta: coincidencias[0].herramienta };

    return { nivel: 2 };
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

// Cache separado para la busqueda inteligente del POS (IA-6) -- mismo
// patron que CACHE_RESPUESTAS, Map aparte para no mezclar claves con
// el chat. Cubre el caso de dos cajeros escribiendo la misma
// descripcion informal en una ventana corta.
const CACHE_BUSQUEDA_IA = new Map();
const CACHE_BUSQUEDA_TTL_MS = 90 * 1000;

function limpiarCacheBusquedaExpirado() {
    const ahora = Date.now();
    for (const [clave, entrada] of CACHE_BUSQUEDA_IA) {
        if (entrada.expiraEn <= ahora) CACHE_BUSQUEDA_IA.delete(clave);
    }
}

const SYSTEM_PROMPT_BUSQUEDA = `Ayudas a encontrar productos de ferreteria a partir de descripciones informales de clientes mexicanos que no conocen el nombre tecnico de lo que buscan.

Responde UNICAMENTE con un JSON array de 2 a 5 palabras o frases cortas de busqueda en espanol (ej. ["codo pvc", "conexion tubo", "media pulgada"]). Nunca inventes nombres de productos especificos, marcas ni precios que el cliente no menciono -- solo sugiere terminos de busqueda razonables. No agregues texto fuera del JSON.`;

// Limites de Nexo IA Nivel 3 (el unico nivel con costo real) por
// plan. Basico usa limite 0 -- eso es lo que significa "sin acceso a
// Nexo IA" (ni Nivel 1/2 tampoco, ver iaDisponible). demo se trata
// igual que pro (Ferreteria Olimpico, el negocio real, sigue en
// "demo" porque nunca se suscribio por Stripe -- no se le puede
// cortar el acceso que ya usa).
const LIMITES_NIVEL3_POR_PLAN = { basico: 0, plus: 50, pro: 500, demo: 500 };

async function licenciaDelNegocio(pool, negocioId) {
    await pool.query(
        `
        INSERT INTO public.licencias (negocio_id, estado, plan, fecha_vencimiento, gracia_dias)
        VALUES ($1, 'activa', 'demo', NOW() + INTERVAL '30 days', 15)
        ON CONFLICT (negocio_id) DO NOTHING
        `,
        [negocioId]
    );

    const fila = await pool.query(
        `
        SELECT plan, ia_nivel3_usos, ia_nivel3_periodo, to_char(NOW(), 'YYYY-MM') AS periodo_actual
        FROM public.licencias
        WHERE negocio_id = $1
        `,
        [negocioId]
    );

    const licencia = fila.rows[0];
    const usosVigentes = licencia.ia_nivel3_periodo === licencia.periodo_actual ? licencia.ia_nivel3_usos : 0;
    const plan = (licencia.plan || "demo").toLowerCase();
    const limite = LIMITES_NIVEL3_POR_PLAN[plan] ?? LIMITES_NIVEL3_POR_PLAN.plus;

    return { plan, limite, usosVigentes, iaDisponible: limite > 0 };
}

async function registrarUsoNivel3(pool, negocioId) {
    await pool.query(
        `
        UPDATE public.licencias
        SET ia_nivel3_usos = CASE WHEN ia_nivel3_periodo = to_char(NOW(), 'YYYY-MM') THEN ia_nivel3_usos + 1 ELSE 1 END,
            ia_nivel3_periodo = to_char(NOW(), 'YYYY-MM')
        WHERE negocio_id = $1
        `,
        [negocioId]
    );
}

// Memoria minima (Nexo AI v2): registra que modulos se abrieron por
// conversacion y arma un resumen de una linea para el system prompt.
// Nunca crece sin limite -- solo se leen los 3 modulos con mas
// aperturas, nunca el objeto completo.
async function registrarAperturaModulo(pool, negocioId, modulo) {
    await pool.query(
        `
        UPDATE public.licencias
        SET ia_memoria = jsonb_set(
            ia_memoria,
            ARRAY['modulosAbiertos', $2],
            to_jsonb(COALESCE((ia_memoria #>> ARRAY['modulosAbiertos', $2])::int, 0) + 1)
        )
        WHERE negocio_id = $1
        `,
        [negocioId, modulo]
    );
}

async function resumenMemoriaNexo(pool, negocioId) {
    const fila = await pool.query(`SELECT ia_memoria FROM public.licencias WHERE negocio_id = $1`, [negocioId]);
    const modulosAbiertos = fila.rows[0]?.ia_memoria?.modulosAbiertos || {};
    const top = Object.entries(modulosAbiertos)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([modulo]) => modulo);

    if (top.length === 0) return "";

    return `Este negocio suele consultar seguido: ${top.join(", ")}. Puedes tenerlo en cuenta, pero no lo menciones explicitamente salvo que venga al caso.`;
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

        case "top_productos_vendidos": {
            const dias = Number.isFinite(Number(input?.dias)) && Number(input.dias) > 0 ? Number(input.dias) : 30;
            const limite = Number.isFinite(Number(input?.limite)) && Number(input.limite) > 0 ? Math.min(Number(input.limite), 20) : 5;
            const resultado = await pool.query(
                `
                SELECT
                    item->>'nombre' AS nombre,
                    COALESCE(SUM((item->>'cantidad')::numeric), 0) AS cantidad,
                    COALESCE(SUM((item->>'importe')::numeric), 0) AS total
                FROM public.historial_ventas,
                     LATERAL jsonb_array_elements(productos) AS item
                WHERE negocio_id = $1
                AND fecha >= NOW() - ($2 || ' days')::interval
                GROUP BY item->>'nombre'
                ORDER BY total DESC
                LIMIT $3
                `,
                [negocioId, dias, limite]
            );

            return {
                dias,
                productos: resultado.rows.map(fila => ({
                    nombre: fila.nombre,
                    cantidad: Number(fila.cantidad),
                    total: Number(fila.total)
                }))
            };
        }

        case "comparar_ventas_periodos": {
            const dias = Number.isFinite(Number(input?.dias)) && Number(input.dias) > 0 ? Number(input.dias) : 7;
            const resultado = await pool.query(
                `
                SELECT
                    COALESCE(SUM(total) FILTER (WHERE fecha >= NOW() - ($2 || ' days')::interval), 0) AS total_actual,
                    COUNT(*) FILTER (WHERE fecha >= NOW() - ($2 || ' days')::interval) AS transacciones_actual,
                    COALESCE(SUM(total) FILTER (
                        WHERE fecha < NOW() - ($2 || ' days')::interval
                        AND fecha >= NOW() - ($2 || ' days')::interval * 2
                    ), 0) AS total_anterior,
                    COUNT(*) FILTER (
                        WHERE fecha < NOW() - ($2 || ' days')::interval
                        AND fecha >= NOW() - ($2 || ' days')::interval * 2
                    ) AS transacciones_anterior
                FROM public.historial_ventas
                WHERE negocio_id = $1
                `,
                [negocioId, dias]
            );

            const fila = resultado.rows[0];

            return {
                dias,
                periodoActual: { total: Number(fila.total_actual), transacciones: Number(fila.transacciones_actual) },
                periodoAnterior: { total: Number(fila.total_anterior), transacciones: Number(fila.transacciones_anterior) }
            };
        }

        case "buscar_producto": {
            const termino = String(input?.termino || "").trim();
            if (!termino) return { productos: [] };

            const resultado = await pool.query(
                `
                SELECT nombre, codigo, precio, stock, stock_minimo
                FROM public.productos
                WHERE negocio_id = $1
                AND (nombre ILIKE $2 OR codigo ILIKE $2)
                ORDER BY nombre ASC
                LIMIT 10
                `,
                [negocioId, `%${termino}%`]
            );

            return { termino, productos: resultado.rows };
        }

        case "preparar_creacion": {
            const tipo = String(input?.tipo || "");

            if (!["cliente_credito", "proveedor", "producto"].includes(tipo)) {
                return { ok: false, error: "Ese tipo de registro no existe." };
            }

            const nombre = String(input?.nombre || "").trim();
            if (!nombre) return { ok: false, error: "Hace falta al menos un nombre." };

            const numero = valor => (Number.isFinite(Number(valor)) ? Number(valor) : 0);

            return {
                ok: true,
                tipo,
                datos: {
                    nombre,
                    telefono: String(input?.telefono || "").trim(),
                    correo: String(input?.correo || "").trim(),
                    contacto: String(input?.contacto || "").trim(),
                    limiteCredito: numero(input?.limiteCredito),
                    precio: numero(input?.precio),
                    stock: numero(input?.stock),
                    codigo: String(input?.codigo || "").trim()
                }
            };
        }

        case "abrir_modulo": {
            const modulo = String(input?.modulo || "");

            if (!MODULOS_NAVEGABLES[modulo]) {
                return { ok: false, error: "Ese modulo no existe o no se puede abrir asi." };
            }

            await registrarAperturaModulo(pool, negocioId, modulo).catch(() => {});

            return { ok: true, modulo };
        }

        default:
            return { error: `Herramienta desconocida: ${nombre}` };
    }
}

async function chatNexoIA(pool, negocioId, mensajes, modelo = "claude-opus-4-8", memoriaExtra = "") {
    const anthropic = obtenerAnthropic();
    let mensajesActuales = mensajes;
    let accion = null;
    let celebrar = false;
    const systemPrompt = memoriaExtra ? `${SYSTEM_PROMPT_NEXO}\n\n${memoriaExtra}` : SYSTEM_PROMPT_NEXO;

    for (let intento = 0; intento < MAX_ITERACIONES_HERRAMIENTAS; intento++) {
        const parametros = {
            model: modelo,
            max_tokens: 1024,
            system: systemPrompt,
            tools: HERRAMIENTAS_NEXO,
            messages: mensajesActuales
        };

        // claude-haiku-4-5 no soporta thinking adaptive -- lo rechaza
        // con un error 400 si se lo mandamos.
        if (modelo !== "claude-haiku-4-5") {
            parametros.thinking = { type: "adaptive" };
        }

        const respuesta = await anthropic.messages.create(parametros);

        if (respuesta.stop_reason !== "tool_use") {
            const texto = respuesta.content
                .filter(bloque => bloque.type === "text")
                .map(bloque => bloque.text)
                .join("\n")
                .trim();

            return { texto, accion, celebrar };
        }

        mensajesActuales = [...mensajesActuales, { role: "assistant", content: respuesta.content }];

        const bloquesHerramienta = respuesta.content.filter(bloque => bloque.type === "tool_use");
        const resultados = [];

        for (const bloque of bloquesHerramienta) {
            const resultado = await ejecutarHerramientaNexo(pool, negocioId, bloque.name, bloque.input);

            // La navegacion (y, mas adelante, preparar_creacion) es la
            // unica herramienta con un efecto visible en el frontend --
            // se guarda la ultima para regresarla junto con el texto.
            // Nunca se ejecuta nada por su cuenta aqui, solo se reporta.
            if (bloque.name === "abrir_modulo" && resultado?.ok) {
                accion = { tipo: "abrir_modulo", modulo: resultado.modulo };
            }

            if (bloque.name === "preparar_creacion" && resultado?.ok) {
                accion = { tipo: "preparar_creacion", datosCreacion: { tipo: resultado.tipo, datos: resultado.datos } };
            }

            // Wire del estado "celebrando" (IA-5 lo dejo construido sin
            // disparador): un periodo de ventas notablemente mejor que
            // el anterior es la senal mas honesta que ya se calcula sin
            // costo extra -- no se inventa una llamada nueva al modelo.
            if (bloque.name === "comparar_ventas_periodos" && resultado?.periodoAnterior?.total > 0) {
                const crecimiento = (resultado.periodoActual.total - resultado.periodoAnterior.total) / resultado.periodoAnterior.total;
                if (crecimiento >= 0.2) celebrar = true;
            }

            resultados.push({
                type: "tool_result",
                tool_use_id: bloque.id,
                content: JSON.stringify(resultado)
            });
        }

        mensajesActuales = [...mensajesActuales, { role: "user", content: resultados }];
    }

    return { texto: "Estoy tardando mas de lo normal analizando tu negocio. Intenta de nuevo en un momento.", accion: null, celebrar: false };
}

module.exports = (app, pool, requerirAccesoNegocio) => {
    // Resumen instantaneo para el popover de la burbuja -- mismas
    // herramientas de Nivel 1, sin pasar por el clasificador ni el
    // modelo. Costo $0, siempre en vivo (no necesita cache).
    app.get("/ia/resumen-rapido", requerirAccesoNegocio, async (req, res) => {
        try {
            const negocio = await negocioActual(req, pool);
            const acceso = await licenciaDelNegocio(pool, negocio.id);

            if (!acceso.iaDisponible) {
                res.json({ ok: true, acceso: { disponible: false } });
                return;
            }

            const [ventas, stockBajo, creditos] = await Promise.all([
                ejecutarHerramientaNexo(pool, negocio.id, "resumen_ventas", {}),
                ejecutarHerramientaNexo(pool, negocio.id, "productos_stock_bajo", {}),
                ejecutarHerramientaNexo(pool, negocio.id, "resumen_creditos", {})
            ]);

            res.json({
                ok: true,
                acceso: { disponible: true, plan: acceso.plan, usosVigentes: acceso.usosVigentes, limite: acceso.limite },
                ventas, stockBajo, creditos
            });
        } catch (error) {
            responderError(res, error);
        }
    });

    // Busqueda inteligente del POS (IA-6): el cliente ya intento
    // busqueda local (y catalogo local si tenia uno) y no encontro
    // nada -- aqui solo se piden palabras clave, nunca productos
    // inventados. Usa Haiku (mismo costo que Nivel 2, ya ilimitado
    // para Plus/Pro/demo segun IA-4) -- no consume el cupo de
    // Nivel 3. Solo se manda la descripcion del cliente al modelo,
    // nunca la lista de productos ni el catalogo.
    app.post("/ia/buscar-inteligente", requerirAccesoNegocio, async (req, res) => {
        const anthropic = obtenerAnthropic();

        if (!anthropic) {
            res.status(503).json({ ok: false, error: "Nexo IA todavia no esta configurado en este servidor" });
            return;
        }

        const descripcion = String(req.body?.descripcion || "").trim();

        if (!descripcion) {
            res.status(400).json({ ok: false, error: "Escribe una descripcion del producto" });
            return;
        }

        if (descripcion.length > 200) {
            res.status(400).json({ ok: false, error: "La descripcion es demasiado larga (maximo 200 caracteres)" });
            return;
        }

        try {
            const negocio = await negocioActual(req, pool);
            const acceso = await licenciaDelNegocio(pool, negocio.id);

            if (!acceso.iaDisponible) {
                res.json({ ok: true, disponible: false });
                return;
            }

            const clave = claveCache(negocio.id, descripcion);
            const enCache = CACHE_BUSQUEDA_IA.get(clave);

            if (enCache && enCache.expiraEn > Date.now()) {
                res.json({ ok: true, disponible: true, keywords: enCache.keywords });
                return;
            }

            const respuesta = await anthropic.messages.create({
                model: "claude-haiku-4-5",
                max_tokens: 150,
                system: SYSTEM_PROMPT_BUSQUEDA,
                messages: [{ role: "user", content: descripcion }]
            });

            const texto = respuesta.content
                .filter(bloque => bloque.type === "text")
                .map(bloque => bloque.text)
                .join("")
                .trim();

            // El modelo a veces envuelve el JSON en fences de markdown
            // (```json ... ```) a pesar de la instruccion de no
            // agregar texto extra -- se extrae el primer arreglo
            // [...] del texto en vez de asumir que el texto completo
            // ya es JSON valido.
            const coincidenciaArreglo = texto.match(/\[[\s\S]*\]/);
            let keywords;
            try {
                keywords = JSON.parse(coincidenciaArreglo ? coincidenciaArreglo[0] : texto);
            } catch (error) {
                keywords = texto
                    .replace(/```[a-z]*|```/gi, "")
                    .split(/[,\n]/)
                    .map(item => item.trim().replace(/^["'\[\]]+|["'\[\]]+$/g, ""))
                    .filter(Boolean);
            }
            keywords = (Array.isArray(keywords) ? keywords : []).slice(0, 5);

            limpiarCacheBusquedaExpirado();
            CACHE_BUSQUEDA_IA.set(clave, { keywords, expiraEn: Date.now() + CACHE_BUSQUEDA_TTL_MS });

            res.json({ ok: true, disponible: true, keywords });
        } catch (error) {
            responderError(res, error);
        }
    });

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
            const acceso = await licenciaDelNegocio(pool, negocio.id);

            if (!acceso.iaDisponible) {
                res.json({
                    ok: true,
                    respuesta: "Nexo IA esta disponible desde el plan Plus. Con tu plan actual todavia no tengo acceso a tus datos -- mejora tu plan desde Cuenta para empezar a usarme.",
                    nivel: "sin-acceso"
                });
                return;
            }

            const clasificacion = esPrimerMensaje ? clasificarNivelPregunta(mensaje) : { nivel: 3 };

            if (esPrimerMensaje) {
                if (clasificacion.nivel === 1) {
                    const datos = await ejecutarHerramientaNexo(pool, negocio.id, clasificacion.herramienta, {});
                    const respuesta = respuestaNivel1(clasificacion.herramienta, datos);

                    if (respuesta) {
                        res.json({ ok: true, respuesta, nivel: 1 });
                        return;
                    }
                }

                const clave = claveCache(negocio.id, mensaje);
                const enCache = CACHE_RESPUESTAS.get(clave);

                if (enCache && enCache.expiraEn > Date.now()) {
                    res.json({ ok: true, respuesta: enCache.respuesta, nivel: `${enCache.nivel}-cache` });
                    return;
                }
            }

            const mensajesIniciales = [
                ...historialRecortado
                    .filter(entrada => entrada && (entrada.rol === "user" || entrada.rol === "assistant") && entrada.contenido)
                    .map(entrada => ({ role: entrada.rol, content: String(entrada.contenido) })),
                { role: "user", content: mensaje }
            ];

            let nivelFinal = esPrimerMensaje && clasificacion.nivel === 2 ? 2 : 3;
            let modeloElegido = nivelFinal === 2 ? "claude-haiku-4-5" : "claude-opus-4-8";
            let notaLimite = "";

            // Nivel 3 es el unico que cuesta y el unico limitado por
            // plan. Si ya se agoto el cupo del mes, nunca se bloquea
            // el chat -- se degrada a Nivel 2 (Haiku) con un aviso.
            if (nivelFinal === 3 && acceso.usosVigentes >= acceso.limite) {
                nivelFinal = 2;
                modeloElegido = "claude-haiku-4-5";
                notaLimite = acceso.plan === "plus"
                    ? "\n\n(Ya usaste tus preguntas de analisis profundo de este mes. Te respondo con el modo rapido -- si quieres analisis ilimitado, mejora a Pro.)"
                    : "\n\n(Estas usando Nexo IA con mucha frecuencia este mes -- te respondo con el modo rapido por ahora.)";
            }

            const memoriaExtra = esPrimerMensaje ? await resumenMemoriaNexo(pool, negocio.id) : "";
            const { texto: respuesta, accion, celebrar } = await chatNexoIA(pool, negocio.id, mensajesIniciales, modeloElegido, memoriaExtra);

            if (nivelFinal === 3) {
                await registrarUsoNivel3(pool, negocio.id);
            }

            if (esPrimerMensaje) {
                limpiarCacheExpirado();
                CACHE_RESPUESTAS.set(claveCache(negocio.id, mensaje), { respuesta, nivel: nivelFinal, expiraEn: Date.now() + CACHE_TTL_MS });
            }

            res.json({ ok: true, respuesta: respuesta + notaLimite, nivel: nivelFinal, accion, celebrar });
        } catch (error) {
            responderError(res, error);
        }
    });
};
