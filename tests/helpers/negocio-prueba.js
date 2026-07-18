// Nota importante: este proyecto no tiene una base de datos de
// pruebas separada -- pool apunta a la misma base real que usa
// Ferreteria Olimpico en produccion. Por eso todo este helper existe:
// aisla cada corrida de pruebas en su propio negocio sintetico (slug
// con prefijo "test-auto-"), nunca toca negocios existentes, y se
// borra por completo al terminar.

const crypto = require("crypto");
const pool = require("../../db");

function hashToken(tokenPlano) {
    return crypto.createHash("sha256").update(String(tokenPlano)).digest("hex");
}

async function crearNegocioPrueba(sufijo) {
    const slug = `test-auto-${sufijo}-${Date.now()}`;

    const negocio = await pool.query(
        `
        INSERT INTO public.negocios (slug, nombre, giro, estado, plan, correo, correo_verificado)
        VALUES ($1, $2, 'ferreteria', 'activo', 'demo', $3, true)
        RETURNING id, slug
        `,
        [slug, `Prueba automatizada ${sufijo}`, `${slug}@example.com`]
    );

    const negocioId = negocio.rows[0].id;
    const token = `token-prueba-${crypto.randomBytes(16).toString("hex")}`;

    await pool.query(
        `
        INSERT INTO public.dispositivos_vinculados (negocio_id, token_hash, nombre_dispositivo)
        VALUES ($1, $2, 'equipo-pruebas-automatizadas')
        `,
        [negocioId, hashToken(token)]
    );

    return { negocioId, slug, token };
}

async function crearProductoPrueba(negocioId, overrides = {}) {
    const codigo = overrides.codigo || `TEST-${crypto.randomBytes(4).toString("hex")}`;

    const producto = await pool.query(
        `
        INSERT INTO public.productos (negocio_id, nombre, codigo, precio, stock, precio_publico)
        VALUES ($1, $2, $3, $4, $5, $4)
        RETURNING id, stock
        `,
        [
            negocioId,
            overrides.nombre || "Producto de prueba automatizada",
            codigo,
            overrides.precio ?? 100,
            overrides.stock ?? 10
        ]
    );

    return producto.rows[0];
}

async function borrarNegocioPrueba(negocioId) {
    if (!negocioId) return;

    const tablasHijas = [
        "historial_ventas",
        "ventas",
        "movimientos_credito",
        "clientes_credito",
        "turnos_caja",
        "productos",
        "dispositivos_vinculados",
        "sesiones_cuenta",
        "licencias"
    ];

    for (const tabla of tablasHijas) {
        await pool.query(`DELETE FROM public.${tabla} WHERE negocio_id = $1`, [negocioId]);
    }

    await pool.query(`DELETE FROM public.negocios WHERE id = $1`, [negocioId]);
}

module.exports = {
    pool,
    crearNegocioPrueba,
    crearProductoPrueba,
    borrarNegocioPrueba
};
