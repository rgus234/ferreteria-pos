// Reintenta SOLO los modulos de TRUPER que quedaron pendientes.
//
//   node --env-file=.env scripts/reintentar-pendientes-truper.js
//   NEXO_VISION_MAX=800 node --env-file=.env scripts/reintentar-pendientes-truper.js
//
// Por que existe: una corrida normal pasa lista a las ~7.940 unidades para
// saber cuales cambiaron -- unos 50 minutos -- antes de tocar nada. Eso
// esta bien cuando no sabes que cambio. Pero para reintentar lo que quedo
// en revision ya sabemos exactamente cuales son, y esos 50 minutos son
// preguntas cuya respuesta ya tenemos.
//
// Con 466 pendientes, esto baja el intento de ~70 minutos a ~10. Importa
// mas de lo que parece: en una laptop que cambia de red (la del dueno, en
// la universidad) una corrida de 70 minutos NUNCA llega al final, porque
// la conexion se corta antes. Una de 10 si cabe entre cortes.
//
// LO QUE ESTA CORRIDA NO HACE, Y ES A PROPOSITO:
// no da de alta ni de baja nada. Su "universo" es solo el trozo pedido,
// asi que la ausencia de un producto ahi no significa que el fabricante
// dejo de venderlo -- significa que no lo pedimos. Sacar conclusiones de
// eso descontinuaria el catalogo entero.

const pool = require("../db");
const truper = require("../fabricantes/truper");
const { sincronizar, cerrarCorridasHuerfanas } = require("../catalogo-fabricante-sync");
const { liberarWorkerOcr, reciclarWorkersOcr } = require("../catalogo-fabricante-ocr");
const { config } = require("../config");

const RECICLAR_CADA = 150;
const COSTO_USD_POR_LLAMADA_VISION = 0.0028;

function reloj(desde) {
    const s = Math.round((Date.now() - desde) / 1000);
    const m = Math.floor(s / 60);
    return m > 0 ? `${m}m ${s % 60}s` : `${s}s`;
}

async function main() {
    const inicio = Date.now();

    const huerfanas = await cerrarCorridasHuerfanas(pool, truper.nombre);
    if (huerfanas.length > 0) {
        console.log(`Se cerraron ${huerfanas.length} corrida(s) colgada(s): ${huerfanas.join(", ")}\n`);
    }

    // Los modulos que no quedaron en 'ok'. Se agrupan porque un modulo
    // puede tener sus dos variantes pendientes y solo hace falta pedirlo
    // una vez: listarUnidades vuelve a mirar las dos.
    const pendientes = await pool.query(
        `SELECT DISTINCT modulo, MAX(pagina) AS pagina
           FROM public.catalogo_fabricante_modulos m
           LEFT JOIN LATERAL (
               SELECT pagina FROM public.catalogo_fabricante_productos p
                WHERE p.fabricante = m.fabricante AND p.modulo = m.modulo
                LIMIT 1
           ) p ON true
          WHERE m.fabricante = $1 AND m.estado <> 'ok'
          GROUP BY modulo`,
        [truper.nombre]
    );

    if (pendientes.rows.length === 0) {
        console.log("No hay modulos pendientes. Nada que reintentar.");
        return;
    }

    const modulos = pendientes.rows.map(f => ({
        modulo: f.modulo,
        pagina: f.pagina ?? null,
        slug: ""
    }));

    console.log(`Reintentando ${modulos.length} modulos pendientes (de ~3.970 del catalogo).`);
    console.log("No se recorre el catalogo completo: ya sabemos cuales son.");
    console.log("Esta corrida NO da de alta ni de baja ningun producto.\n");

    const contexto = { modulos };
    if (config.anthropicApiKey) {
        const Anthropic = require("@anthropic-ai/sdk");
        contexto.anthropic = new Anthropic({ apiKey: config.anthropicApiKey });
        const tope = truper.MAX_LLAMADAS_VISION_POR_CORRIDA;
        console.log(`Vision disponible (tope: ${tope}, gasto maximo ~${(tope * COSTO_USD_POR_LLAMADA_VISION).toFixed(2)} USD).\n`);
    }

    let procesadas = 0;
    let ultimaEtapa = "";

    const resultado = await sincronizar(pool, truper, {
        contexto,
        alcanceParcial: true,
        onProgreso: info => {
            if (info.etapa !== ultimaEtapa) {
                ultimaEtapa = info.etapa;
                process.stdout.write(`\n[${reloj(inicio)}] ${info.etapa}${info.mensaje ? ": " + info.mensaje : ""}\n`);
            }
            if (info.etapa === "unidades" && info.hechas) {
                process.stdout.write(`\r  unidades revisadas: ${info.hechas}   `);
            }
            if (info.etapa === "extrayendo" && info.hechas) {
                process.stdout.write(`\r  leidas: ${info.hechas} / ${info.total || "?"}  (${reloj(inicio)})   `);
                if (info.hechas - procesadas >= RECICLAR_CADA) {
                    procesadas = info.hechas;
                    reciclarWorkersOcr();
                    if (global.gc) global.gc();
                }
            }
        }
    });

    console.log(`\n\n===== ${resultado.estado.toUpperCase()} en ${reloj(inicio)} =====`);
    for (const [clave, valor] of Object.entries(resultado.contadores)) {
        if (typeof valor === "object") continue;
        console.log("  " + clave.padEnd(24) + String(valor).padStart(8));
    }
    if (resultado.detalle) console.log("\n  " + resultado.detalle);

    const despues = await pool.query(
        `SELECT COUNT(*) FILTER (WHERE estado = 'ok')::int ok,
                COUNT(*) FILTER (WHERE estado = 'parcial')::int parcial,
                COUNT(*) FILTER (WHERE estado NOT IN ('ok','parcial'))::int pendientes
           FROM public.catalogo_fabricante_modulos WHERE fabricante = $1`,
        [truper.nombre]
    );
    const d = despues.rows[0];
    console.log(`\n  Modulos: ${d.ok} completos, ${d.parcial} a medias, ${d.pendientes} sin poder leer`);
}

main()
    .catch(error => {
        console.error("\nFallo el reintento:", error.message);
        process.exitCode = 1;
    })
    .finally(async () => {
        await liberarWorkerOcr().catch(() => {});
        await pool.end();
    });
