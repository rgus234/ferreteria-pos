// Capa de lectura del catalogo de funciones y planes
// (migrations/20260716_catalogo_funciones_planes.sql).
//
// Nada en este archivo se llama todavia desde server.js -- es
// preparacion de arquitectura, no un cambio de comportamiento. Queda
// listo para cuando se decida construir el enforcement real de
// planes o un panel de administracion de planes.

const pool = require("./db");

async function listarPlanes() {
    const resultado = await pool.query(
        `SELECT id, clave, nombre, orden, descripcion FROM public.planes ORDER BY orden`
    );

    return resultado.rows;
}

async function listarCatalogoFunciones() {
    const resultado = await pool.query(
        `
        SELECT
            f.id, f.clave, f.nombre, f.descripcion, f.estado,
            c.clave AS categoria_clave, c.nombre AS categoria_nombre, c.orden AS categoria_orden
        FROM public.catalogo_funciones f
        JOIN public.categorias_funcion c ON c.id = f.categoria_id
        ORDER BY c.orden, f.clave
        `
    );

    return resultado.rows;
}

// Regresa las funciones incluidas (y su limite, si aplica) para un
// plan dado, por su clave ('basico' | 'plus' | 'pro').
async function funcionesDelPlan(clavePlan) {
    const resultado = await pool.query(
        `
        SELECT f.clave, f.nombre, pf.incluido, pf.limite_numerico
        FROM public.plan_funciones pf
        JOIN public.planes p ON p.id = pf.plan_id
        JOIN public.catalogo_funciones f ON f.id = pf.funcion_id
        WHERE p.clave = $1
        ORDER BY f.clave
        `,
        [clavePlan]
    );

    return resultado.rows;
}

module.exports = {
    listarPlanes,
    listarCatalogoFunciones,
    funcionesDelPlan
};
