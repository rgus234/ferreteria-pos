// Borra los precios de TRUPER que no pueden ser ciertos, para que el POS
// muestre el hueco en vez de un numero equivocado.
//
//   node --env-file=.env scripts/limpiar-precios-sospechosos-truper.js --simular
//   node --env-file=.env scripts/limpiar-precios-sospechosos-truper.js
//
// POR QUE BORRAR Y NO CORREGIR
//
// Porque no sabemos el valor bueno. Se releyeron los 213 modulos con
// precios raros y estos no se recuperaron: sus filas salen tan
// destrozadas del OCR que el parser no las produce, asi que el valor
// viejo -- el malo -- se queda tal cual. Comprobado en el 19606: las
// filas 16167/16171/16172 se corrigieron a $160 el 7 de septiembre y las
// 16169/16155 siguen con fecha del 3 y su $53.33.
//
// Un precio ausente sale vacio en la pantalla y el vendedor lo pregunta.
// Un precio equivocado se cobra. No son el mismo riesgo.
//
// QUE SE CONSIDERA IMPOSIBLE
//
// La razon publico/mayoreo. Medida sobre los 12.682 productos que tienen
// los cuatro precios: mediana 1.21, p99 1.24. Un 1.6 no ocurre en un
// catalogo bien leido; lo que produce esos numeros es tomar la columna
// equivocada o leer un digito de mas.
//
// Comprobado contra la imagen del catalogo en 19606, 41309, 39804, 52109,
// 53208 y 19703: en todos, el flagged estaba mal y el no flagged bien.
// En el 19703 los siete productos de 4"x24" pasan la prueba y son
// correctos; los tres marcados eran los unicos malos de la pagina.
//
// Solo se tocan los tres niveles que vienen de la variante 'pub'. El
// distribuidor se lee de otra imagen y no entra en esta cuenta.
//
// Los modulos afectados quedan en revision para que la proxima corrida
// los vuelva a intentar con la vision.

const pool = require("../db");
const truper = require("../fabricantes/truper");

const RAZON_IMPOSIBLE = 1.6;

const SQL_SOSPECHOSOS = `
    SELECT codigo, modulo, precio_mayoreo, precio_medio_mayoreo, precio_publico,
           round(precio_publico / precio_mayoreo, 2) AS razon
      FROM public.catalogo_fabricante_productos
     WHERE fabricante = $1 AND estado = 'activo'
       AND precio_mayoreo > 0 AND precio_publico IS NOT NULL
       AND precio_publico / precio_mayoreo > $2
     ORDER BY razon DESC`;

async function main() {
    const simular = process.argv.includes("--simular");

    const { rows } = await pool.query(SQL_SOSPECHOSOS, [truper.nombre, RAZON_IMPOSIBLE]);
    if (rows.length === 0) {
        console.log("No hay precios imposibles. Nada que limpiar.");
        return;
    }

    console.log(`${rows.length} productos con razon publico/mayoreo > ${RAZON_IMPOSIBLE}:\n`);
    for (const f of rows) {
        console.log(`  ${f.codigo} mod=${f.modulo} razon=${f.razon}`
            + `  may=${f.precio_mayoreo} medio=${f.precio_medio_mayoreo} pub=${f.precio_publico}`);
    }

    const modulos = [...new Set(rows.map(f => f.modulo))];
    console.log(`\nEn ${modulos.length} modulos.`);

    if (simular) {
        console.log("\n--simular: no se toco nada.");
        return;
    }

    const codigos = rows.map(f => f.codigo);
    const client = await pool.connect();
    try {
        await client.query("BEGIN");

        const borrados = await client.query(
            `UPDATE public.catalogo_fabricante_productos
                SET precio_mayoreo = NULL,
                    precio_medio_mayoreo = NULL,
                    precio_publico = NULL,
                    actualizado_en = now()
              WHERE fabricante = $1 AND estado = 'activo' AND codigo = ANY($2)`,
            [truper.nombre, codigos]
        );

        // Para que la proxima corrida los reintente con la vision en vez
        // de darlos por buenos: es el mismo camino que ya usan los
        // precios retirados por incoherencia entre variantes.
        const marcados = await client.query(
            `UPDATE public.catalogo_fabricante_modulos
                SET estado = 'revision_manual',
                    motivo_revision = 'precios_incoherentes',
                    detalle = 'se borraron precios imposibles: razon publico/mayoreo fuera de rango'
              WHERE fabricante = $1 AND modulo = ANY($2)`,
            [truper.nombre, modulos]
        );

        await client.query("COMMIT");
        console.log(`\nBorrados los precios de ${borrados.rowCount} productos.`);
        console.log(`Marcadas ${marcados.rowCount} unidades de modulo para releer con vision.`);
    } catch (error) {
        await client.query("ROLLBACK");
        throw error;
    } finally {
        client.release();
    }
}

main()
    .catch(error => {
        console.error("\nFallo la limpieza:", error.message);
        process.exitCode = 1;
    })
    .finally(async () => { await pool.end(); });
