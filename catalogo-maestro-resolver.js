// Fase 7 del plan "Catalogo Maestro Nexo". Se llama en el momento en
// que un negocio confirma un producto desde su catalogo de proveedor
// (crear-producto / crear-productos-lote) -- ese "confirmar" ya es la
// accion afirmativa del dueño de traer el producto a su inventario;
// la informacion que se comparte aqui es solo identidad de producto
// (marca, nombre, presentacion, imagen, categoria sugerida), nunca
// datos de negocio (precio, costo, stock, proveedor real). Si el
// codigo ya existe en el Catalogo Maestro (otro negocio ya lo trajo
// antes), el producto nuevo simplemente se ENLAZA -- nunca pisa la
// info ya guardada, evita que un dato peor sobreescriba uno bueno.
async function contribuirOEnlazarCatalogoMaestro(pool, negocioId, datos) {
    const codigo = String(datos?.codigo || "").trim();
    if (!codigo) return null;

    const existente = await pool.query(
        `SELECT id FROM public.catalogo_maestro_productos WHERE codigo = $1`,
        [codigo]
    );

    if (existente.rows.length > 0) {
        return existente.rows[0].id;
    }

    const nombre = String(datos?.nombre || "").trim();
    if (!nombre) return null;

    const nuevo = await pool.query(
        `
        INSERT INTO public.catalogo_maestro_productos
            (codigo, marca, nombre, presentacion, categoria_nexo_id, descripcion, imagen, imagen_tipo, contribuido_por_negocio_id)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
        ON CONFLICT (codigo) DO NOTHING
        RETURNING id
        `,
        [
            codigo,
            String(datos?.marca || "").trim(),
            nombre,
            String(datos?.presentacion || "").trim(),
            datos?.categoriaNexoId || null,
            String(datos?.descripcion || "").trim(),
            datos?.imagen || null,
            datos?.imagenTipo || null,
            negocioId
        ]
    );

    if (nuevo.rows.length > 0) {
        return nuevo.rows[0].id;
    }

    // Carrera: otro negocio lo inserto entre el SELECT y el INSERT de
    // arriba -- el ON CONFLICT DO NOTHING no regresa fila, se busca
    // otra vez para enlazar al que ya quedo.
    const reintento = await pool.query(
        `SELECT id FROM public.catalogo_maestro_productos WHERE codigo = $1`,
        [codigo]
    );
    return reintento.rows[0]?.id || null;
}

module.exports = { contribuirOEnlazarCatalogoMaestro };
