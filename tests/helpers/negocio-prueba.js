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

// La mayoria de las pruebas de credito no estan probando el Acuerdo de
// Credito en si (eso lo cubre tests/acuerdo-credito.test.js) -- solo
// necesitan un cliente ya activo para poder cargarle una venta. Crea
// el cliente y su primer acuerdo ya "aceptado" directo por SQL, sin
// pasar por el enlace/QR real.
async function crearClienteCreditoActivo(negocioId, overrides = {}) {
    const cliente = await pool.query(
        `INSERT INTO public.clientes_credito (negocio_id, nombre, telefono, limite_credito, dias_credito, nivel_precio_preferido)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING *`,
        [
            negocioId,
            overrides.nombre || "Cliente de prueba",
            overrides.telefono ?? "5550000000",
            overrides.limiteCredito ?? 1000,
            overrides.diasCredito ?? 15,
            overrides.nivelPrecioPreferido || null
        ]
    );
    const clienteId = cliente.rows[0].id;

    const acuerdo = await pool.query(
        `INSERT INTO public.acuerdos_credito
            (negocio_id, cliente_credito_id, version, limite_credito, dias_credito, condiciones_texto, contenido_hash, origen, generado_por, estado)
         VALUES ($1, $2, 1, $3, $4, 'prueba automatizada', 'hash-prueba', 'alta_pos', '{}'::jsonb, 'aceptado')
         RETURNING id`,
        [negocioId, clienteId, cliente.rows[0].limite_credito, cliente.rows[0].dias_credito]
    );

    await pool.query(`UPDATE public.clientes_credito SET acuerdo_vigente_id = $1 WHERE id = $2`, [acuerdo.rows[0].id, clienteId]);

    return { ...cliente.rows[0], acuerdo_vigente_id: acuerdo.rows[0].id };
}

async function borrarNegocioPrueba(negocioId) {
    if (!negocioId) return;

    const tablasHijas = [
        "facturas_cfdi",
        "historial_ventas",
        "ventas",
        "movimientos_credito",
        "solicitudes_credito",
        "clientes_credito",
        "turnos_caja",
        "productos",
        "dispositivos_vinculados",
        "sesiones_cuenta",
        "licencias",
        "ia_conversaciones",
        "market_checkout_pendiente",
        "pedidos_publicos",
        "pedidos_market",
        "sitio_web_config",
        "recepciones_mercancia_items",
        "recepciones_mercancia",
        "pedidos_proveedor_items",
        "pedidos_proveedor",
        "ajustes_inventario",
        "bitacora_acciones",
        "catalogo_productos",
        "catalogos_proveedor",
        "proveedores",
        "negocio_giros",
        "listas_producto",
        "encargos_clientes_items",
        "encargos_clientes",
        "etiquetas_plantillas"
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
    crearClienteCreditoActivo,
    borrarNegocioPrueba
};
