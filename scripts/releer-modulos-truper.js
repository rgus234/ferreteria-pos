// Relee modulos de TRUPER que YA estan en 'ok' pero cuyos precios no
// cuadran, y reporta que cambio.
//
//   node --env-file=.env scripts/releer-modulos-truper.js
//   node --env-file=.env scripts/releer-modulos-truper.js --modulos=19606,41309
//   NEXO_VISION_MAX=400 node --env-file=.env scripts/releer-modulos-truper.js
//
// POR QUE NO SIRVE reintentar-pendientes-truper.js PARA ESTO
//
// Aquel toma los modulos con estado <> 'ok'. Estos estan en 'ok': se
// leyeron sin quejarse, solo que mal. Un modulo que devuelve tres
// importes para tres columnas parece perfecto aunque el primero sea de
// otra columna.
//
// LOS DOS DEFECTOS QUE BUSCA
//
// 1. Columna de referencia leida como mayoreo. Las tablas de paquetes
//    traen "Ref. Precio Unit. May." con el precio por PIEZA entre
//    parentesis. Comprobado en el 19606: mayoreo real $160, guardado
//    $53.33 (=160/3, son 3 bandas de lija). Se detecta porque la razon
//    publico/mayoreo se dispara -- lo normal es 1.21.
//
// 2. Filas colapsadas: todo el modulo se quedo con el precio de la
//    primera fila. Comprobado en el 52109 (pichanchas: la de 2" cuesta
//    $600 y quedo en $105) y en el 53208 (flotadores).
//
//    OJO: precio igual en todo un modulo NO es prueba de nada. El 19606
//    tiene 5 granos de lija que cuestan lo mismo a proposito, y el 12703
//    se leyo perfecto con precios repetidos entre medidas chicas. Por eso
//    esto RELEE y compara, en vez de "corregir" a ciegas.
//
// NO da de alta ni de baja productos: alcanceParcial va en true. La
// ausencia de un producto en este trozo no significa que se descontinuo,
// significa que no lo pedimos.

const pool = require("../db");
const truper = require("../fabricantes/truper");
const { sincronizar, cerrarCorridasHuerfanas } = require("../catalogo-fabricante-sync");
const { liberarWorkerOcr, reciclarWorkersOcr } = require("../catalogo-fabricante-ocr");
const { config } = require("../config");

const RECICLAR_CADA = 150;
const COSTO_USD_POR_LLAMADA_VISION = 0.0028;

// Lo normal es 1.21 (mediana medida sobre 12.682 productos con los cuatro
// precios). 1.6 deja fuera el ruido y atrapa las divisiones entre 2 y 3.
const RAZON_SOSPECHOSA = 1.6;

function reloj(desde) {
    const s = Math.round((Date.now() - desde) / 1000);
    const m = Math.floor(s / 60);
    return m > 0 ? `${m}m ${s % 60}s` : `${s}s`;
}

const SQL_SOSPECHOSOS = `
    WITH colapso AS (
        SELECT modulo
          FROM public.catalogo_fabricante_productos
         WHERE fabricante = $1 AND estado = 'activo' AND precio_mayoreo IS NOT NULL
         GROUP BY modulo
        HAVING count(*) >= 3
           AND count(DISTINCT (precio_mayoreo, precio_medio_mayoreo, precio_publico)) = 1),
    referencia AS (
        SELECT DISTINCT modulo
          FROM public.catalogo_fabricante_productos
         WHERE fabricante = $1 AND estado = 'activo' AND precio_mayoreo > 0
           AND precio_publico / precio_mayoreo > $2)
    SELECT modulo FROM colapso
    UNION
    SELECT modulo FROM referencia`;

// Foto de los precios antes de tocar nada, para poder decir que cambio.
async function fotoDePrecios(modulos) {
    const r = await pool.query(
        `SELECT codigo, modulo, precio_mayoreo m, precio_medio_mayoreo mm,
                precio_publico p, precio_distribuidor d
           FROM public.catalogo_fabricante_productos
          WHERE fabricante = $1 AND estado = 'activo' AND modulo = ANY($2)`,
        [truper.nombre, modulos]
    );
    const mapa = new Map();
    for (const f of r.rows) mapa.set(f.codigo, f);
    return mapa;
}

function mismoPrecio(a, b) {
    const iguales = (x, y) => String(x ?? "") === String(y ?? "");
    return iguales(a.m, b.m) && iguales(a.mm, b.mm)
        && iguales(a.p, b.p) && iguales(a.d, b.d);
}

async function main() {
    const inicio = Date.now();

    const huerfanas = await cerrarCorridasHuerfanas(pool, truper.nombre);
    if (huerfanas.length > 0) {
        console.log(`Se cerraron ${huerfanas.length} corrida(s) colgada(s): ${huerfanas.join(", ")}\n`);
    }

    const conVision = process.argv.includes("--vision");
    const argModulos = process.argv.find(a => a.startsWith("--modulos="));
    let modulos;
    if (argModulos) {
        modulos = argModulos.split("=")[1].split(",").map(s => s.trim()).filter(Boolean);
        console.log(`Releyendo ${modulos.length} modulo(s) pedidos a mano.`);
    } else {
        const r = await pool.query(SQL_SOSPECHOSOS, [truper.nombre, RAZON_SOSPECHOSA]);
        modulos = r.rows.map(f => f.modulo);
        console.log(`Releyendo ${modulos.length} modulos con precios sospechosos.`);
    }

    if (modulos.length === 0) {
        console.log("No hay modulos sospechosos. Nada que releer.");
        return;
    }

    const antes = await fotoDePrecios(modulos);
    console.log(`Cubren ${antes.size} productos. Esta corrida NO da de alta ni de baja nada.\n`);

    const contexto = { modulos: modulos.map(m => ({ modulo: m, pagina: null, slug: "" })) };
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
        // Sin esto no se lee ni un pixel: estos modulos estan en 'ok' con
        // su etag intacto, asi que la deteccion de cambios los salta.
        forzarModulos: new Set(modulos.map(String)),
        // --vision: ir directo a la vision en vez de intentar el OCR
        // primero. Para los modulos donde el OCR no falla -- devuelve algo
        // -- pero lo que devuelve esta mal, asi que nunca escala solo.
        forzarVisionModulos: conVision ? new Set(modulos.map(String)) : null,
        onProgreso: info => {
            if (info.etapa !== ultimaEtapa) {
                ultimaEtapa = info.etapa;
                process.stdout.write(`\n[${reloj(inicio)}] ${info.etapa}${info.mensaje ? ": " + info.mensaje : ""}\n`);
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

    // Lo que de verdad importa: que cambio.
    const despues = await fotoDePrecios(modulos);
    const cambios = [];
    let ganaronPrecio = 0;
    let perdieronPrecio = 0;
    for (const [codigo, d] of despues) {
        const a = antes.get(codigo);
        if (!a || mismoPrecio(a, d)) continue;
        cambios.push({ codigo, modulo: d.modulo, a, d });
        const teniaA = a.m != null || a.mm != null || a.p != null;
        const teniaD = d.m != null || d.mm != null || d.p != null;
        if (!teniaA && teniaD) ganaronPrecio++;
        if (teniaA && !teniaD) perdieronPrecio++;
    }

    console.log(`\n  Productos con precio distinto: ${cambios.length} de ${antes.size}`);
    console.log(`    ganaron precio: ${ganaronPrecio}`);
    console.log(`    lo perdieron:   ${perdieronPrecio}  <- quedan para revision, no se cobran mal`);

    for (const c of cambios.slice(0, 40)) {
        console.log(`  ${c.codigo} mod=${c.modulo}`);
        console.log(`      antes:  may=${c.a.m} medio=${c.a.mm} pub=${c.a.p} dist=${c.a.d}`);
        console.log(`      ahora:  may=${c.d.m} medio=${c.d.mm} pub=${c.d.p} dist=${c.d.d}`);
    }
    if (cambios.length > 40) console.log(`  ... y ${cambios.length - 40} mas`);
}

main()
    .catch(error => {
        console.error("\nFallo la relectura:", error.message);
        process.exitCode = 1;
    })
    .finally(async () => {
        await liberarWorkerOcr().catch(() => {});
        await pool.end();
    });
