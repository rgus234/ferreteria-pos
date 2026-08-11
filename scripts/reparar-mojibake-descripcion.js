// Reparacion real (negocio_id=1, Ferreteria Olimpico): la investigacion
// previa (investigar-mojibake-descripcion.js) confirmo que en 35 de 36
// productos la columna descripcion es literalmente el mismo texto que
// nombre pero con los acentos reemplazados por el caracter de
// reemplazo U+FFFD ("�") -- nombre ya tiene la codificacion correcta
// (reparado en una limpieza anterior), asi que la reparacion segura es
// copiar nombre -> descripcion en esos casos (no se inventa texto, se
// usa el mismo dato del propio producto).
//
// El producto #232 (codigo 14928) es distinto: el propio nombre quedo
// corrupto ("semi-sint�tico"), no solo la descripcion -- se corrige a
// mano porque la palabra correcta es inequivoca ("sintetico").
const pool = require("../db");

(async () => {
    const copiados = await pool.query(
        `UPDATE public.productos
         SET descripcion = nombre
         WHERE negocio_id = 1 AND descripcion LIKE '%�%' AND nombre NOT LIKE '%�%'
         RETURNING id, codigo`
    );
    console.log(`descripcion copiada desde nombre en ${copiados.rows.length} productos:`);
    copiados.rows.forEach((f) => console.log(`  #${f.id} [${f.codigo}]`));

    const especial = await pool.query(
        `UPDATE public.productos
         SET nombre = 'Aceite semi-sintético, 4 tiempos, 400 ml (14 oz), TRUPER',
             descripcion = 'Aceite semi-sintético, 4 tiempos, 400 ml (14 oz), TRUPER'
         WHERE negocio_id = 1 AND id = 232
         RETURNING id, codigo, nombre`
    );
    console.log("Caso especial (nombre tambien corrupto):", especial.rows);

    const restantes = await pool.query(
        `SELECT COUNT(*)::int AS total FROM public.productos WHERE negocio_id = 1 AND (nombre LIKE '%�%' OR descripcion LIKE '%�%')`
    );
    console.log(`Productos que siguen con "�" en negocio_id=1: ${restantes.rows[0].total}`);

    await pool.end();
})().catch((error) => {
    console.error("FALLO:", error);
    process.exit(1);
});
