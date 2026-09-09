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

function normalizarRfc(rfc) {
    return String(rfc || "").trim().toUpperCase();
}

// Igual criterio que resolverOcrearProveedorId, pero por RFC del
// emisor de un CFDI en vez de por nombre -- para Recepcion
// Inteligente. El RFC es la identidad real (nunca se puede escribir de
// mil formas distintas como un nombre), asi que se busca primero por
// RFC; si el proveedor ya existe pero nunca se le guardo el RFC (dado
// de alta a mano antes de que esta columna existiera), se completa con
// el nombre de la factura como respaldo -- nunca al reves, un nombre
// nunca debe pisar un RFC ya distinto. Ambiguo (mas de un proveedor
// con el mismo RFC, solo posible si el dueno los duplico a mano) se
// deja sin resolver, mismo criterio de "nunca fusionar solo".
async function resolverProveedorPorRfc(pool, negocioId, rfcEmisor, nombreEmisor) {
    const rfc = normalizarRfc(rfcEmisor);
    if (!rfc) return await resolverOcrearProveedorId(pool, negocioId, nombreEmisor);

    const porRfc = await pool.query(
        `SELECT id FROM public.proveedores WHERE negocio_id = $1 AND rfc = $2`,
        [negocioId, rfc]
    );

    if (porRfc.rows.length === 1) {
        return porRfc.rows[0].id;
    }

    if (porRfc.rows.length > 1) {
        return null;
    }

    const porNombre = await resolverOcrearProveedorId(pool, negocioId, nombreEmisor);
    if (porNombre) {
        // Proveedor ya existia por nombre, sin RFC guardado todavia --
        // se completa con el de esta factura. No pisa nada: la
        // busqueda de arriba ya garantizo que ningun proveedor de este
        // negocio tiene ya este RFC.
        await pool.query(
            `UPDATE public.proveedores SET rfc = $1 WHERE id = $2 AND rfc = ''`,
            [rfc, porNombre]
        );
    }

    return porNombre;
}

module.exports = { normalizarNombreProveedor, resolverOcrearProveedorId, normalizarRfc, resolverProveedorPorRfc };
