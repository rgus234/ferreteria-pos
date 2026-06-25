const DEFAULT_NEGOCIO_SLUG =
    process.env.DEFAULT_NEGOCIO_SLUG || "ferreteria-olimpico";

const DEFAULT_NEGOCIO_NOMBRE =
    process.env.DEFAULT_NEGOCIO_NOMBRE || "Ferreteria Olimpico";

function normalizarSlug(valor) {
    return String(valor || DEFAULT_NEGOCIO_SLUG)
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 80) || DEFAULT_NEGOCIO_SLUG;
}

function obtenerSlugNegocio(req) {
    return normalizarSlug(
        req.headers["x-negocio-slug"] ||
        req.query.negocio ||
        req.body?.negocioSlug ||
        DEFAULT_NEGOCIO_SLUG
    );
}

async function asegurarNegocioActual(pool, req) {
    const slug = obtenerSlugNegocio(req);
    const nombre =
        slug === DEFAULT_NEGOCIO_SLUG
            ? DEFAULT_NEGOCIO_NOMBRE
            : slug.replace(/-/g, " ");

    const resultado = await pool.query(
        `
        INSERT INTO public.negocios
            (slug, nombre, giro, estado, plan)
        VALUES
            ($1, $2, 'ferreteria', 'activo', 'demo')
        ON CONFLICT (slug)
        DO UPDATE SET updated_at = NOW()
        RETURNING id, slug, nombre, giro, estado, plan
        `,
        [slug, nombre]
    );

    return resultado.rows[0];
}

module.exports = {
    DEFAULT_NEGOCIO_SLUG,
    DEFAULT_NEGOCIO_NOMBRE,
    normalizarSlug,
    obtenerSlugNegocio,
    asegurarNegocioActual
};
