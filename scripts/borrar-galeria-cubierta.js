// Borra SOLO las fotos de galeria del Banco de Nexo que se pueden
// recuperar desde el fabricante, dejando intactas las que no.
//
//   node --env-file=.env scripts/borrar-galeria-cubierta.js --respaldo <carpeta>
//   node --env-file=.env scripts/borrar-galeria-cubierta.js --respaldo <carpeta> --aplicar
//
// Por omision SIMULA. Escribir exige --aplicar a proposito.
//
// "Cubierta" = el codigo del producto esta en el Catalogo Maestro, asi que
// su galeria se puede resolver desde las fotos que publica el fabricante.
// La mitad del banco NO lo esta (codigos como SIL85BCT, CDU50P, que son de
// otras marcas): esas fotos son irremplazables y NO se tocan.
//
// Antes de borrar una foto se comprueba que este en el respaldo. Sin esa
// comprobacion, "tengo respaldo" seria una suposicion.

const fs = require("fs");
const path = require("path");
const pool = require("../db");

const LOTE = 500;

// Ids de galeria que se pueden borrar: su producto esta en el Maestro.
const SQL_CUBIERTAS = `
    SELECT g.id, LENGTH(g.imagen)::bigint bytes
    FROM public.banco_imagenes_producto_galeria g
    JOIN public.banco_imagenes_producto b ON b.id = g.banco_imagen_id
    WHERE EXISTS (
        SELECT 1 FROM public.catalogo_maestro_identificadores i WHERE i.valor = b.codigo
    )
`;

function cargarRespaldo(carpeta) {
    const ruta = path.join(carpeta, "indice.json");
    if (!fs.existsSync(ruta)) {
        throw new Error(`no existe el indice del respaldo: ${ruta}`);
    }
    const indice = JSON.parse(fs.readFileSync(ruta, "utf8"));
    return {
        carpeta,
        porId: new Map(indice.filas.map(f => [f.id, f]))
    };
}

async function main() {
    const args = process.argv.slice(2);
    const aplicar = args.includes("--aplicar");
    const i = args.indexOf("--respaldo");
    if (i === -1 || !args[i + 1]) {
        throw new Error("falta --respaldo <carpeta>: no se borra nada sin respaldo verificado");
    }

    const respaldo = cargarRespaldo(args[i + 1]);
    console.log(`Respaldo: ${respaldo.porId.size} imagenes en ${respaldo.carpeta}\n`);

    const cubiertas = await pool.query(SQL_CUBIERTAS);
    console.log(`Fotos de galeria cubiertas por el fabricante: ${cubiertas.rows.length}`);

    // Cada foto a borrar debe existir en el respaldo Y coincidir en tamano.
    const sinRespaldo = [];
    let bytes = 0;
    for (const fila of cubiertas.rows) {
        const guardada = respaldo.porId.get(fila.id);
        const archivo = guardada && path.join(respaldo.carpeta, guardada.archivo);
        if (!guardada || !fs.existsSync(archivo) || fs.statSync(archivo).size !== Number(fila.bytes)) {
            sinRespaldo.push(fila.id);
            continue;
        }
        bytes += Number(fila.bytes);
    }

    console.log(`  con respaldo verificado : ${cubiertas.rows.length - sinRespaldo.length}  (${Math.round(bytes / 1024 / 1024)} MB)`);
    console.log(`  SIN respaldo            : ${sinRespaldo.length}`);

    if (sinRespaldo.length > 0) {
        console.log("\n  No se borra nada: hay fotos sin respaldo verificado.");
        console.log("  Volver a correr scripts/respaldar-galeria-banco.js primero.");
        process.exitCode = 1;
        return;
    }

    const intactas = await pool.query(`
        SELECT COUNT(*)::int n, COALESCE(SUM(LENGTH(g.imagen)), 0)::bigint bytes
        FROM public.banco_imagenes_producto_galeria g
        JOIN public.banco_imagenes_producto b ON b.id = g.banco_imagen_id
        WHERE NOT EXISTS (
            SELECT 1 FROM public.catalogo_maestro_identificadores i WHERE i.valor = b.codigo
        )`);

    console.log(`\n  Quedan intactas (otras marcas, irremplazables): ${intactas.rows[0].n}  (${Math.round(Number(intactas.rows[0].bytes) / 1024 / 1024)} MB)`);

    if (!aplicar) {
        console.log("\nSIMULACION: no se borro nada. Para borrar de verdad: --aplicar");
        return;
    }

    // --- Borrado ---
    const ids = cubiertas.rows.map(f => f.id);
    let borradas = 0;

    for (let j = 0; j < ids.length; j += LOTE) {
        const lote = ids.slice(j, j + LOTE);
        const r = await pool.query(
            `DELETE FROM public.banco_imagenes_producto_galeria WHERE id = ANY($1)`,
            [lote]
        );
        borradas += r.rowCount;
        process.stdout.write(`\r  borradas ${borradas} / ${ids.length}   `);
    }

    console.log(`\n\n  ${borradas} fotos borradas.`);

    // En Postgres un DELETE no devuelve el espacio al disco: lo marca como
    // reutilizable. Para que la base ENCOJA de verdad hace falta VACUUM
    // FULL, que reescribe la tabla. Bloquea la tabla mientras corre.
    console.log("  Compactando la tabla (VACUUM FULL)... esto bloquea la galeria unos minutos.");
    await pool.query(`VACUUM FULL public.banco_imagenes_producto_galeria`);

    const despues = await pool.query(`
        SELECT pg_size_pretty(pg_total_relation_size('public.banco_imagenes_producto_galeria')) galeria,
               pg_size_pretty(pg_database_size(current_database())) base`);
    console.log(`\n  galeria ahora: ${despues.rows[0].galeria}`);
    console.log(`  base completa: ${despues.rows[0].base}`);
}

main()
    .catch(error => {
        console.error("\nFallo el borrado:", error.message);
        process.exitCode = 1;
    })
    .finally(() => pool.end());
