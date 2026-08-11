// Siembra (o actualiza) el catalogo canonico de categorias de Nexo en la
// tabla categorias_nexo desde categorias-nexo.js. Idempotente -- correrlo
// de nuevo tras agregar filas a CATEGORIAS_NEXO es seguro (ON CONFLICT).
// Uso: node --env-file=.env scripts/sembrar-categorias-nexo.js
const pool = require("../db");
const { CATEGORIAS_NEXO } = require("../categorias-nexo");

(async () => {
    let insertadas = 0;
    for (let i = 0; i < CATEGORIAS_NEXO.length; i++) {
        const { departamento, nombre } = CATEGORIAS_NEXO[i];
        const resultado = await pool.query(
            `INSERT INTO public.categorias_nexo (departamento, nombre, orden)
             VALUES ($1, $2, $3)
             ON CONFLICT (departamento, nombre) DO NOTHING
             RETURNING id`,
            [departamento, nombre, i]
        );
        if (resultado.rows.length > 0) insertadas++;
    }
    const total = await pool.query("SELECT COUNT(*)::int AS total FROM public.categorias_nexo");
    console.log(`Insertadas ${insertadas} categorias nuevas. Total en la tabla: ${total.rows[0].total}.`);
    await pool.end();
})().catch((error) => {
    console.error("FALLO:", error);
    process.exit(1);
});
