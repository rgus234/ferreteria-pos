// Siembra (o actualiza) el catalogo canonico de categorias de Nexo en la
// tabla categorias_nexo desde categorias-nexo.js -- ahora un arbol por
// giro (Fase 2 del plan "Catalogo Maestro Nexo"). Idempotente -- correrlo
// de nuevo tras agregar filas a CATEGORIAS_POR_GIRO es seguro (ON CONFLICT).
// Uso: node --env-file=.env scripts/sembrar-categorias-nexo.js
const pool = require("../db");
const { CATEGORIAS_POR_GIRO } = require("../categorias-nexo");

(async () => {
    let insertadas = 0;
    for (const [giro, categorias] of Object.entries(CATEGORIAS_POR_GIRO)) {
        for (let i = 0; i < categorias.length; i++) {
            const { departamento, nombre } = categorias[i];
            const resultado = await pool.query(
                `INSERT INTO public.categorias_nexo (giro, departamento, nombre, orden)
                 VALUES ($1, $2, $3, $4)
                 ON CONFLICT (giro, departamento, nombre) DO NOTHING
                 RETURNING id`,
                [giro, departamento, nombre, i]
            );
            if (resultado.rows.length > 0) insertadas++;
        }
    }
    const total = await pool.query("SELECT giro, COUNT(*)::int AS total FROM public.categorias_nexo GROUP BY giro ORDER BY giro");
    console.log(`Insertadas ${insertadas} categorias nuevas.`);
    console.log("Total por giro:", total.rows);
    await pool.end();
})().catch((error) => {
    console.error("FALLO:", error);
    process.exit(1);
});
