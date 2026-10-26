// Pone el nombre oficial de Urrea a los productos de Urrea/Surtek/Foy de un catalogo de proveedor, cruzando por el codigo de Urrea
// (primer codigo de "clave_proveedor", p. ej. "966 / 17306" -> 966). El nombre abreviado del distribuidor NO se pierde: pasa al principio
// de la descripcion ("Nombre del distribuidor: ..."). Solo toca las filas con un unico cruce; las ambiguas se dejan como estan.
//   node --env-file=.env scripts/nombres-urrea-en-catalogo.js <negocio_id> <catalogo_id>               (simulacion)
//   node --env-file=.env scripts/nombres-urrea-en-catalogo.js <negocio_id> <catalogo_id> --aplicar
//   node --env-file=.env scripts/nombres-urrea-en-catalogo.js --deshacer tmp/urrea/respaldo-nombres-<catalogo>.json
const fs = require("fs");
const path = require("path");
const pool = require("../db");

const PREFIJO = "Nombre del distribuidor: ";

function codigosDeClave(clave) {
    return String(clave || "").split("/").map(s => s.trim().toUpperCase()).filter(Boolean);
}

async function deshacer(archivo) {
    const filas = JSON.parse(fs.readFileSync(archivo, "utf8")).filas;
    for (const f of filas) await pool.query("UPDATE public.catalogo_productos SET nombre_proveedor = $2, descripcion = $3, updated_at = NOW() WHERE id = $1", [f.id, f.nombre, f.descripcion]);
    console.log(`Restauradas ${filas.length} filas.`);
}

async function main(negocioId, catalogoId, aplicar) {
    const filas = (await pool.query(
        `SELECT id, clave_proveedor, nombre_proveedor, descripcion FROM public.catalogo_productos
         WHERE negocio_id = $1 AND catalogo_id = $2 AND (marca ILIKE '%urrea%' OR marca ILIKE '%surtek%' OR marca ILIKE '%foy%')`,
        [negocioId, catalogoId]
    )).rows;

    const maestro = (await pool.query("SELECT codigo_fabricante, nombre FROM public.catalogo_maestro_productos WHERE fuente_identidad = 'urrea.com'")).rows;
    const porSku = new Map(maestro.map(m => [m.codigo_fabricante.toUpperCase(), m.nombre]));
    const cambios = [];
    let ambiguas = 0, sinCruce = 0, yaOficial = 0;

    for (const f of filas) {
        const nombres = [...new Set(codigosDeClave(f.clave_proveedor).map(c => porSku.get(c)).filter(Boolean))];

        if (nombres.length === 0) { sinCruce++; continue; }
        if (nombres.length > 1) { ambiguas++; continue; }
        if (f.nombre_proveedor === nombres[0]) { yaOficial++; continue; }

        cambios.push({ id: f.id, nombre: f.nombre_proveedor, descripcion: f.descripcion || "", nuevo: nombres[0] });
    }

    console.log(`Filas Urrea/Surtek/Foy: ${filas.length} | a renombrar: ${cambios.length} | ya oficial: ${yaOficial} | ambiguas: ${ambiguas} | sin cruce: ${sinCruce}`);
    cambios.slice(0, 3).forEach(c => console.log(`  ${c.nombre}  ->  ${c.nuevo}`));

    if (!aplicar) { console.log("Simulacion: no se escribio nada. Usa --aplicar."); return; }

    const respaldo = path.join(__dirname, "..", "tmp", "urrea", `respaldo-nombres-${catalogoId}.json`);
    fs.mkdirSync(path.dirname(respaldo), { recursive: true });
    fs.writeFileSync(respaldo, JSON.stringify({ fecha: new Date().toISOString(), negocioId, catalogoId, filas: cambios.map(({ id, nombre, descripcion }) => ({ id, nombre, descripcion })) }));

    const client = await pool.connect();

    try {
        await client.query("BEGIN");

        for (let i = 0; i < cambios.length; i += 300) {
            const lote = cambios.slice(i, i + 300);
            await client.query(
                `UPDATE public.catalogo_productos cp SET nombre_proveedor = t.nuevo,
                        descripcion = $4 || t.nombre || CASE WHEN t.descripcion <> '' THEN E'\\n' || t.descripcion ELSE '' END, updated_at = NOW()
                 FROM unnest($1::int[], $2::text[], $3::text[], $5::text[]) AS t(id, nuevo, nombre, descripcion)
                 WHERE cp.id = t.id AND cp.negocio_id = $6 AND cp.catalogo_id = $7`,
                [lote.map(c => c.id), lote.map(c => c.nuevo), lote.map(c => c.nombre), PREFIJO, lote.map(c => c.descripcion), negocioId, catalogoId]
            );
        }

        await client.query("COMMIT");
        console.log(`Listo: ${cambios.length} nombres oficiales. Respaldo: ${respaldo}`);
    } catch (error) {
        await client.query("ROLLBACK").catch(() => {});
        throw error;
    } finally {
        client.release();
    }
}

if (require.main === module) {
    const args = process.argv.slice(2);
    const i = args.indexOf("--deshacer");

    (i >= 0 ? deshacer(args[i + 1]) : main(Number(args[0]), Number(args[1]), args.includes("--aplicar")))
        .catch(e => { console.error(e); process.exitCode = 1; })
        .finally(() => pool.end());
}

module.exports = { codigosDeClave };
