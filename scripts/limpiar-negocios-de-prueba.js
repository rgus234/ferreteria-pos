// Borra los negocios que las pruebas automatizadas dejaron en la base.
//
//   node --env-file=.env scripts/limpiar-negocios-de-prueba.js --simular
//   node --env-file=.env scripts/limpiar-negocios-de-prueba.js
//
// POR QUE HACE FALTA
//
// Las pruebas de este proyecto corren contra la base DE VERDAD, no contra
// una de mentiras. Cada una crea su negocio y lo borra al terminar, pero
// cuando una prueba se cae antes del after() -- o alguien corta la
// corrida con Ctrl+C -- el negocio se queda ahi para siempre.
//
// Se acumulan en silencio. Al buscar cuantos negocios afectaba el lio del
// nivel de precio salieron 16, y solo 7 eran reales: los otros 9 eran
// basura de corridas viejas. Nueve negocios fantasma es la diferencia
// entre "le cambie el precio a 13 clientes" y "a 7", y esa diferencia
// importa cuando estas midiendo un dano.
//
// SEGURIDAD
//
// Solo toca lo que casa con el patron que usan los helpers de prueba
// (slug 'test-auto-%' o nombre 'Prueba %'), y ANTES de borrar revisa que
// no tenga ventas: si alguna tiene, se salta y lo dice. Un negocio de
// prueba con ventas de verdad no es un negocio de prueba.
//
// El borrado reusa borrarNegocioPrueba() de los helpers en vez de repetir
// aqui el orden de las 30 tablas hijas. Ese orden ya fue doloroso una vez
// (acuerdos_credito y clientes_credito se apuntan en circulo) y tener dos
// copias garantiza que una se quede atras.

const pool = require("../db");
const { borrarNegocioPrueba } = require("../tests/helpers/negocio-prueba");

const SQL_DE_PRUEBA = `
    SELECT id, nombre, slug
      FROM public.negocios
     WHERE slug LIKE 'test-auto-%' OR nombre ILIKE 'Prueba %'
     ORDER BY id`;

async function main() {
    const simular = process.argv.includes("--simular");

    const { rows } = await pool.query(SQL_DE_PRUEBA);
    if (rows.length === 0) {
        console.log("No hay negocios de prueba. Nada que limpiar.");
        return;
    }

    console.log(`${rows.length} negocios de prueba encontrados.\n`);

    const aBorrar = [];
    for (const n of rows) {
        const v = await pool.query(
            "SELECT count(*)::int c FROM public.ventas WHERE negocio_id = $1", [n.id]);
        const ventas = v.rows[0].c;

        if (ventas > 0) {
            console.log(`  ${n.id} | ${n.nombre}  -> SE SALTA: tiene ${ventas} ventas`);
            continue;
        }
        console.log(`  ${n.id} | ${n.nombre}`);
        aBorrar.push(n);
    }

    if (aBorrar.length === 0) {
        console.log("\nNinguno se puede borrar sin riesgo.");
        return;
    }

    if (simular) {
        console.log(`\n--simular: se borrarian ${aBorrar.length}. No se toco nada.`);
        return;
    }

    let borrados = 0;
    for (const n of aBorrar) {
        try {
            await borrarNegocioPrueba(n.id);
            borrados++;
        } catch (error) {
            console.error(`  fallo al borrar ${n.id}: ${error.message}`);
        }
    }

    const quedan = await pool.query(SQL_DE_PRUEBA);
    console.log(`\nBorrados ${borrados} de ${aBorrar.length}. Quedan ${quedan.rows.length}.`);

    const reales = await pool.query(
        `SELECT count(*)::int c FROM public.negocios
          WHERE slug NOT LIKE 'test-auto-%' AND nombre NOT ILIKE 'Prueba %'`);
    console.log(`Negocios reales: ${reales.rows[0].c}`);
}

main()
    .catch(error => {
        console.error("\nFallo la limpieza:", error.message);
        process.exitCode = 1;
    })
    .finally(async () => { await pool.end(); });
