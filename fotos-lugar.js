// Foto de cada producto para las pantallas del celular de estantes/bodega: misma URL firmada que usa GET /productos
// (fotos_producto por codigo normalizado), calculada solo para las filas que se van a mostrar.
function normalizarCodigoFoto(codigo) {
    return String(codigo || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

async function agregarFotos(pool, negocioId, filas, firmarTokenImagen) {
    if (!filas.length || typeof firmarTokenImagen !== "function") return filas.map(f => ({ ...f, imagenUrl: null }));

    const slug = (await pool.query(`SELECT slug FROM public.negocios WHERE id = $1`, [negocioId])).rows[0]?.slug;
    const fotos = new Map((await pool.query(`SELECT codigo, actualizado_at FROM public.fotos_producto WHERE negocio_id = $1`, [negocioId])).rows.map(f => [f.codigo, f.actualizado_at]));

    return filas.map(fila => {
        const codigo = normalizarCodigoFoto(fila.codigo);

        if (!slug || !codigo || !fotos.has(codigo)) return { ...fila, imagenUrl: null };

        const version = new Date(fotos.get(codigo)).getTime();
        return { ...fila, imagenUrl: `/fotos-producto/${codigo}/principal?negocio=${slug}&v=${version}&token=${firmarTokenImagen(negocioId, codigo)}` };
    });
}

module.exports = { agregarFotos, normalizarCodigoFoto };
