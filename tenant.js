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
        RETURNING id, slug, nombre, giro, estado, plan, (xmax = 0) AS fue_creado_ahora
        `,
        [slug, nombre]
    );

    const negocio = resultado.rows[0];

    if (negocio.fue_creado_ahora) {
        console.warn(`Auto-provisioning: nuevo negocio creado por codigo no reconocido: ${slug}`);

        pool.query(
            `
            INSERT INTO public.tenant_auto_provision_log
                (negocio_id, slug_recibido, ip, user_agent, headers)
            VALUES
                ($1, $2, $3, $4, $5)
            `,
            [
                negocio.id,
                slug,
                req?.ip || null,
                req?.get?.("user-agent") || null,
                JSON.stringify(req?.headers || {})
            ]
        ).catch(error => console.warn("No se pudo registrar auto-provision log:", error.message));
    }

    delete negocio.fue_creado_ahora;

    return negocio;
}

module.exports = {
    DEFAULT_NEGOCIO_SLUG,
    DEFAULT_NEGOCIO_NOMBRE,
    normalizarSlug,
    obtenerSlugNegocio,
    asegurarNegocioActual
};
