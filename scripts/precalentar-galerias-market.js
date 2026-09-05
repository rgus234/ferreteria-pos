// Descubre por adelantado que fotos publica el fabricante para los
// productos que se ven en Nexo Market.
//
//   node --env-file=.env scripts/precalentar-galerias-market.js
//   node --env-file=.env scripts/precalentar-galerias-market.js --todos
//
// Por que existe: la galeria de la ficha de producto NO se guarda en la
// base -- se arma con las fotos que el fabricante ya publica (ver
// banco-fotos-fabricante.js). Averiguar cuales existe cuesta 11
// peticiones HEAD por producto, y eso lo paga el PRIMER cliente que abra
// esa ficha: se midio entre 125 ms y 1.2 s de espera.
//
// El descubrimiento se cachea en banco_imagenes_fabricante y se revalida
// cada 30 dias, asi que basta con hacerlo una vez por adelantado para que
// nadie lo pague. Este script es justo eso.
//
// Por defecto solo toca lo que Market muestra de verdad (visible_market),
// que es donde se nota. Con --todos precalienta el Catalogo Maestro
// completo, que son muchas mas peticiones y rara vez hace falta.

const pool = require("../db");
const { fotosDeProducto } = require("../banco-fotos-fabricante");

// En paralelo, pero sin caerle encima al servidor de TRUPER. Cada
// producto ya dispara 11 HEAD por dentro.
const EN_PARALELO = 4;

function reloj(desde) {
    const s = Math.round((Date.now() - desde) / 1000);
    const m = Math.floor(s / 60);
    return m > 0 ? `${m}m ${s % 60}s` : `${s}s`;
}

async function main() {
    const inicio = Date.now();
    const todos = process.argv.includes("--todos");

    // Solo los que tienen foto en el banco: si el codigo del producto no
    // esta en el banco, la ficha ni siquiera entra al bloque de galeria.
    const sqlMarket =
        "SELECT DISTINCT p.codigo" +
        "  FROM public.productos p" +
        " WHERE p.visible_market = true" +
        "   AND EXISTS (SELECT 1 FROM public.banco_imagenes_producto b WHERE b.codigo = p.codigo)" +
        "   AND NOT EXISTS (SELECT 1 FROM public.banco_imagenes_fabricante f WHERE f.codigo = p.codigo)";

    const sqlTodos =
        "SELECT DISTINCT m.codigo_fabricante AS codigo" +
        "  FROM public.catalogo_maestro_productos m" +
        " WHERE m.codigo_fabricante IS NOT NULL AND m.codigo_fabricante <> ''" +
        "   AND EXISTS (SELECT 1 FROM public.banco_imagenes_producto b WHERE b.codigo = m.codigo_fabricante)" +
        "   AND NOT EXISTS (SELECT 1 FROM public.banco_imagenes_fabricante f WHERE f.codigo = m.codigo_fabricante)";

    const pendientes = (await pool.query(todos ? sqlTodos : sqlMarket)).rows;

    if (pendientes.length === 0) {
        console.log("Nada que precalentar: ya esta descubierto todo.");
        return;
    }

    console.log(pendientes.length + " productos por descubrir" +
        (todos ? " (Catalogo Maestro completo)." : " (visibles en Market)."));
    console.log("Cada uno son 11 peticiones HEAD al servidor del fabricante.\n");

    const contadores = { conFotos: 0, sinFotos: 0, error: 0 };
    let totalFotos = 0;
    let hechas = 0;

    async function trabajar(cola) {
        while (cola.length > 0) {
            const fila = cola.pop();
            try {
                const r = await fotosDeProducto(pool, fila.codigo);
                const cuantas = (r && r.fotos ? r.fotos.length : 0);
                if (cuantas > 0) { contadores.conFotos++; totalFotos += cuantas; }
                else contadores.sinFotos++;
            } catch (error) {
                contadores.error++;
            }

            hechas++;
            if (hechas % 10 === 0 || hechas === pendientes.length) {
                process.stdout.write(
                    "\r  " + hechas + " / " + pendientes.length +
                    "   con fotos " + contadores.conFotos +
                    "  sin fotos " + contadores.sinFotos +
                    "  errores " + contadores.error +
                    "  (" + reloj(inicio) + ")   "
                );
            }
        }
    }

    const cola = pendientes.slice();
    await Promise.all(Array.from({ length: EN_PARALELO }, () => trabajar(cola)));

    console.log("\n\n===== TERMINADO en " + reloj(inicio) + " =====");
    console.log("  con fotos          " + String(contadores.conFotos).padStart(8));
    console.log("  sin fotos          " + String(contadores.sinFotos).padStart(8));
    console.log("  errores            " + String(contadores.error).padStart(8));
    if (contadores.conFotos > 0) {
        console.log("  fotos por producto " + String((totalFotos / contadores.conFotos).toFixed(1)).padStart(8));
    }
}

main()
    .catch(error => {
        console.error("\nFallo el precalentado:", error.message);
        process.exitCode = 1;
    })
    .finally(async () => { await pool.end(); });
