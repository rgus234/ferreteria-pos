// Backfill de Fase 6 del plan "Catalogo Maestro Nexo": resuelve
// productos.proveedor_id para todos los productos existentes que
// tienen texto en proveedor pero todavia no tienen el FK. Aditivo y
// re-corrible (idempotente) -- nunca borra ni pisa un proveedor_id ya
// resuelto, nunca fusiona proveedores duplicados automaticamente.
// Uso: node --env-file=.env scripts/backfill-proveedor-id.js
const pool = require("../db");
const { normalizarNombreProveedor, resolverOcrearProveedorId } = require("../proveedor-resolver");

(async () => {
    const negocios = await pool.query(
        `SELECT DISTINCT negocio_id FROM public.productos WHERE proveedor_id IS NULL AND COALESCE(proveedor, '') <> ''`
    );

    let productosActualizados = 0;
    let proveedoresCreados = 0;
    const conflictos = [];

    for (const { negocio_id } of negocios.rows) {
        const grupos = await pool.query(
            `SELECT proveedor, COUNT(*)::int AS total
             FROM public.productos
             WHERE negocio_id = $1 AND proveedor_id IS NULL AND COALESCE(proveedor, '') <> ''
             GROUP BY proveedor
             ORDER BY total DESC`,
            [negocio_id]
        );

        const porClave = new Map();
        for (const fila of grupos.rows) {
            const clave = normalizarNombreProveedor(fila.proveedor);
            if (!clave) continue;
            if (!porClave.has(clave)) porClave.set(clave, { variantes: [], total: 0 });
            const grupo = porClave.get(clave);
            grupo.variantes.push(fila.proveedor);
            grupo.total += fila.total;
        }

        for (const [clave, grupo] of porClave) {
            const coincidencias = await pool.query(
                `SELECT id, nombre FROM public.proveedores WHERE negocio_id = $1 AND LOWER(TRIM(REGEXP_REPLACE(nombre, '\\s+', ' ', 'g'))) = $2`,
                [negocio_id, clave]
            );

            if (coincidencias.rows.length > 1) {
                conflictos.push({
                    negocio_id,
                    clave,
                    proveedoresDuplicados: coincidencias.rows,
                    productosAfectados: grupo.total
                });
                continue;
            }

            const proveedorId = coincidencias.rows.length === 1
                ? coincidencias.rows[0].id
                : await resolverOcrearProveedorId(pool, negocio_id, grupo.variantes[0]);

            if (coincidencias.rows.length === 0) proveedoresCreados++;

            const actualizacion = await pool.query(
                `UPDATE public.productos SET proveedor_id = $1 WHERE negocio_id = $2 AND proveedor_id IS NULL AND proveedor = ANY($3::text[])`,
                [proveedorId, negocio_id, grupo.variantes]
            );
            productosActualizados += actualizacion.rowCount;
        }
    }

    console.log(`Backfill completo: ${productosActualizados} producto(s) actualizados, ${proveedoresCreados} proveedor(es) nuevo(s) creados.`);
    if (conflictos.length) {
        console.log(`\n${conflictos.length} grupo(s) en conflicto (proveedores duplicados a mano, revisar sin fusionar automatico):`);
        console.log(JSON.stringify(conflictos, null, 2));
    }

    await pool.end();
})().catch(error => {
    console.error("FALLO:", error);
    process.exit(1);
});
