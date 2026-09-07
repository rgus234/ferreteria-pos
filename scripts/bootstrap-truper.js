// Carga completa del catalogo oficial de TRUPER: recorre las ~600 paginas,
// lee los ~6.000 modulos y llena los precios de lista que hoy le faltan a
// 15.699 productos del Catalogo Maestro.
//
//   node --env-file=.env scripts/bootstrap-truper.js
//   node --env-file=.env scripts/bootstrap-truper.js --confirmar   (tras una regeneracion masiva)
//
// Es REANUDABLE por diseno: cada unidad (modulo, variante) guarda su ETag,
// asi que una corrida interrumpida se retoma donde quedo -- lo ya leido no
// se vuelve a leer. Cortarlo con Ctrl+C no pierde el trabajo hecho.
//
// El tope de llamadas a vision por corrida (300 por defecto) acota el
// gasto: los modulos que no alcancen vision quedan en revision y los toma
// la corrida siguiente. Para una carga de arranque conviene subirlo --
// NEXO_VISION_MAX=4000 -- y resolverlos todos de una vez. El log dice al
// empezar cual es el tope efectivo y cuanto puede llegar a costar.

const pool = require("../db");
const truper = require("../fabricantes/truper");
const { sincronizar } = require("../catalogo-fabricante-sync");
const { liberarWorkerOcr, reciclarWorkersOcr } = require("../catalogo-fabricante-ocr");
const { config } = require("../config");

// El worker de tesseract acumula memoria; reciclarlo cada tanto evita que
// una corrida de horas muera por falta de RAM (paso de verdad al medir
// cobertura sobre 233 imagenes).
const RECICLAR_CADA = 150;

function reloj(desde) {
    const s = Math.round((Date.now() - desde) / 1000);
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    return h > 0 ? `${h}h ${m}m` : `${m}m ${s % 60}s`;
}

// Costo medido de una llamada de vision contra la API real: 1.590 tokens
// de entrada y 242 de salida con Haiku 4.5. Sirve para anunciar el gasto
// maximo de la corrida ANTES de empezarla.
const COSTO_USD_POR_LLAMADA_VISION = 0.0028;

// Si pasa este tiempo sin una sola señal de avance, la corrida se
// abandona. Sin esto, al cortarse la conexion el proceso se quedaba vivo
// y quieto durante horas: ni avanzaba ni fallaba, y habia que descubrirlo
// mirando la base. Vale mas rendirse claro que fingir que se trabaja.
const MINUTOS_SIN_AVANCE = 15;

function vigilar(alRendirse) {
    let ultimoAvance = Date.now();
    const temporizador = setInterval(() => {
        const quieto = (Date.now() - ultimoAvance) / 60000;
        if (quieto >= MINUTOS_SIN_AVANCE) {
            clearInterval(temporizador);
            alRendirse(quieto);
        }
    }, 30000);
    temporizador.unref();

    return {
        latido: () => { ultimoAvance = Date.now(); },
        detener: () => clearInterval(temporizador)
    };
}

async function main() {
    const inicio = Date.now();
    const confirmar = process.argv.includes("--confirmar");

    // Corridas que quedaron colgadas de intentos anteriores.
    const { cerrarCorridasHuerfanas } = require("../catalogo-fabricante-sync");
    const huerfanas = await cerrarCorridasHuerfanas(pool, truper.nombre);
    if (huerfanas.length > 0) {
        console.log(`Se cerraron ${huerfanas.length} corrida(s) que habian quedado colgadas: ${huerfanas.join(", ")}\n`);
    }

    const contexto = {};
    if (config.anthropicApiKey) {
        const Anthropic = require("@anthropic-ai/sdk");
        contexto.anthropic = new Anthropic({ apiKey: config.anthropicApiKey });
        // El tope se lee del adaptador, no se escribe a mano: con el
        // numero fijo, subirlo con NEXO_VISION_MAX seguia anunciando 300 y
        // no habia forma de confirmar desde el log que habia entrado.
        const tope = truper.MAX_LLAMADAS_VISION_POR_CORRIDA;
        const gastoMaximo = (tope * COSTO_USD_POR_LLAMADA_VISION).toFixed(2);
        console.log(`Vision disponible como respaldo del OCR (tope: ${tope}, gasto maximo ~${gastoMaximo} USD).`);
    } else {
        console.log("Sin ANTHROPIC_API_KEY: solo OCR. Los modulos que no se lean quedaran en revision.");
    }

    console.log("Arrancando la carga del catalogo TRUPER.");
    console.log("Es reanudable: si se corta, la siguiente corrida sigue donde quedo.\n");

    let procesadas = 0;
    let ultimaEtapa = "";

    const centinela = vigilar(quieto => {
        console.error(`\n\nSin avance en ${Math.round(quieto)} minutos: se abandona la corrida.`);
        console.error("Suele ser falta de conexion. Lo leido queda guardado: volver a correr retoma donde quedo.");
        process.exit(1);
    });

    const resultado = await sincronizar(pool, truper, {
        contexto,
        confirmarRegeneracionMasiva: confirmar,
        onProgreso: info => {
            centinela.latido();
            if (info.etapa !== ultimaEtapa) {
                ultimaEtapa = info.etapa;
                process.stdout.write(`\n[${reloj(inicio)}] ${info.etapa}${info.mensaje ? ": " + info.mensaje : ""}\n`);
            }

            if (info.etapa === "universo" && info.paginas) {
                process.stdout.write(`\r  paginas recorridas: ${info.paginas}  modulos: ${info.modulos || 0}   `);
            }
            if (info.etapa === "unidades" && info.hechas) {
                process.stdout.write(`\r  unidades revisadas: ${info.hechas}   `);
            }
            if (info.etapa === "revisando" && info.hechas) {
                process.stdout.write(`\r  revisadas: ${info.hechas}  cambiadas: ${info.cambios || 0}   `);
            }
            if (info.etapa === "extrayendo" && info.hechas) {
                process.stdout.write(`\r  leidas: ${info.hechas} / ${info.total || "?"}  (${reloj(inicio)})   `);

                // Reciclado del worker de OCR para no acumular memoria.
                if (info.hechas - procesadas >= RECICLAR_CADA) {
                    procesadas = info.hechas;
                    // RECICLAR, no liberar: liberar mataba a los workers que
                    // estaban leyendo y dejaba colgados a los que hacian fila.
                    reciclarWorkersOcr();
                    if (global.gc) global.gc();
                }
            }
            if (info.etapa === "enriqueciendo" && info.hechas) {
                process.stdout.write(`\r  descripciones: ${info.hechas} / ${info.total || "?"}   `);
            }
        }
    });

    centinela.detener();

    console.log(`\n\n===== CORRIDA ${resultado.estado.toUpperCase()} en ${reloj(inicio)} =====`);
    for (const [clave, valor] of Object.entries(resultado.contadores)) {
        if (typeof valor === "object") continue;
        console.log("  " + clave.padEnd(26) + String(valor).padStart(8));
    }
    if (resultado.detalle) console.log("\n  " + resultado.detalle);

    // Cuanto del Catalogo Maestro quedo con precio de referencia.
    const precios = await pool.query(
        `SELECT COUNT(*)::int total,
                COUNT(*) FILTER (WHERE f.codigo IS NOT NULL)::int con_precio
         FROM public.catalogo_maestro_productos m
         LEFT JOIN public.catalogo_fabricante_productos f
                ON f.codigo = m.codigo_fabricante AND f.estado = 'activo'
                   AND f.precio_publico IS NOT NULL
         WHERE m.origen = 'fabricante'`
    );
    const p = precios.rows[0];
    console.log(`\n  Catalogo Maestro con precio de referencia: ${p.con_precio} de ${p.total}`);
    if (p.con_precio < p.total) {
        console.log("  Volver a correr este script para seguir con lo que falta.");
    }
}

main()
    .catch(error => {
        console.error("\nFallo la carga:", error.message);
        process.exitCode = 1;
    })
    .finally(async () => {
        await liberarWorkerOcr().catch(() => {});
        await pool.end();
    });
