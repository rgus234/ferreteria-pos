// Limpieza de datos del bug real encontrado en Ferreteria Olimpico
// (negocio_id 1, ver fix en catalog-server.js/vincularCatalogoProductos):
// el paso de vinculacion por nombre (pg_trgm) no impedia que VARIAS
// filas de catalogo_productos quedaran "vinculadas" al MISMO producto --
// nombres de proveedor con un patron de texto muy repetitivo (ej.
// "Bolsa con 50 tornillos 3/8' x 2-1/4' tipo coche, FIERO" contra
// decenas de variantes de tornillos con la misma forma) pasaban el
// umbral de similitud contra el mismo producto una y otra vez.
//
// El codigo ya no deja que esto vuelva a pasar (una corrida nueva de
// vincularCatalogoProductos ya es exclusiva: un producto, una fila).
// Este script es la limpieza de lo que quedo mal de ANTES del fix: para
// cada producto con mas de una fila apuntandole, deja vinculada solo la
// de mayor porcentaje_coincidencia (match exacto por codigo, 100,
// siempre gana) y las demas las regresa a "sin_vincular" (producto_id
// NULL) -- NUNCA borra la fila del catalogo, solo su vinculacion
// incorrecta. Nunca toca productos.precio/precio_mayoreo/stock: la
// auditoria que motivo este script confirmo que esos no se corrompieron
// (el boton "Actualizar precios y datos" no se habia corrido con estos
// datos mal vinculados todavia).
//
// Por omision SIMULA (no escribe nada):
//   node --env-file=.env scripts/limpiar-vinculacion-multiple-catalogo.js
//   node --env-file=.env scripts/limpiar-vinculacion-multiple-catalogo.js --aplicar
//   node --env-file=.env scripts/limpiar-vinculacion-multiple-catalogo.js --aplicar --negocio-id=1

const pool = require("../db");

function argValor(nombre, porDefecto) {
    const prefijo = `--${nombre}=`;
    const arg = process.argv.find(a => a.startsWith(prefijo));
    return arg ? arg.slice(prefijo.length) : porDefecto;
}

const NEGOCIO_ID = Number(argValor("negocio-id", "1"));

async function main() {
    const aplicar = process.argv.includes("--aplicar");

    const grupos = await pool.query(
        `
        SELECT producto_id, array_agg(id ORDER BY porcentaje_coincidencia DESC NULLS LAST, id ASC) AS filas_id,
               array_agg(porcentaje_coincidencia ORDER BY porcentaje_coincidencia DESC NULLS LAST, id ASC) AS porcentajes
        FROM public.catalogo_productos
        WHERE negocio_id = $1 AND producto_id IS NOT NULL AND vinculado_manualmente = false
        GROUP BY producto_id
        HAVING COUNT(*) > 1
        `,
        [NEGOCIO_ID]
    );

    let filasADesvincular = 0;
    const ejemplos = [];

    for (const fila of grupos.rows) {
        const [, ...perdedores] = fila.filas_id;
        filasADesvincular += perdedores.length;

        if (ejemplos.length < 5) {
            ejemplos.push({
                productoId: fila.producto_id,
                seQueda: fila.filas_id[0],
                porcentajeGanador: fila.porcentajes[0],
                sePierden: perdedores.length
            });
        }

        if (aplicar) {
            await pool.query(
                `UPDATE public.catalogo_productos SET producto_id = NULL, estado = 'sin_vincular', porcentaje_coincidencia = NULL, updated_at = NOW() WHERE id = ANY($1::int[])`,
                [perdedores]
            );
        }
    }

    console.log("\n===============================================");
    console.log(aplicar ? "  APLICADO" : "  SIMULACION -- no se escribio ninguna fila");
    console.log("===============================================");
    console.log(`  negocio_id: ${NEGOCIO_ID}`);
    console.log(`  productos con vinculacion multiple: ${grupos.rows.length}`);
    console.log(`  filas que ${aplicar ? "se desvincularon" : "se desvincularian"}: ${filasADesvincular}`);
    if (ejemplos.length) {
        console.log("\n  ejemplos:");
        for (const ej of ejemplos) {
            console.log(`    producto ${ej.productoId}: se queda la fila ${ej.seQueda} (${ej.porcentajeGanador}%), se sueltan ${ej.sePierden}`);
        }
    }
    if (!aplicar) {
        console.log("\n  Para escribir de verdad: --aplicar");
    }
    console.log("");
}

main()
    .catch(error => {
        console.error("Fallo la limpieza:", error.message);
        process.exitCode = 1;
    })
    .finally(() => pool.end());
