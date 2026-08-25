// Resuelve productos.proveedor_id a partir de un nombre de texto --
// Fase 6 del plan "Catalogo Maestro Nexo". Mismo criterio en todos
// los puntos que crean productos con un nombre de proveedor de texto
// (backfill de productos existentes, creacion de producto desde
// catalogo): normalizar, buscar match exacto (nunca difuso -- universo
// chico, alto impacto en reportes), y si no hay ninguno, crear un
// proveedor nuevo marcado como automatico en vez de dejar el producto
// sin vinculo. Si el nombre ya empata con MAS de un proveedor real del
// negocio (duplicados que el dueño ya creo a mano, ej. "Diprofer" y
// "DIPROFER"), nunca se fusiona solo -- se deja sin resolver para
// revision manual.
function normalizarNombreProveedor(nombre) {
    return String(nombre || "").trim().replace(/\s+/g, " ").toLowerCase();
}

async function resolverOcrearProveedorId(pool, negocioId, nombreProveedor) {
    const clave = normalizarNombreProveedor(nombreProveedor);
    if (!clave) return null;

    const coincidencias = await pool.query(
        `SELECT id FROM public.proveedores WHERE negocio_id = $1 AND LOWER(TRIM(REGEXP_REPLACE(nombre, '\\s+', ' ', 'g'))) = $2`,
        [negocioId, clave]
    );

    if (coincidencias.rows.length === 1) {
        return coincidencias.rows[0].id;
    }

    if (coincidencias.rows.length > 1) {
        return null;
    }

    const nuevo = await pool.query(
        `INSERT INTO public.proveedores (negocio_id, nombre, activo, creado_automatico) VALUES ($1, $2, true, true) RETURNING id`,
        [negocioId, String(nombreProveedor || "").trim()]
    );
    return nuevo.rows[0].id;
}

module.exports = { normalizarNombreProveedor, resolverOcrearProveedorId };
