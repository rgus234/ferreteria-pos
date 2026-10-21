const { responderError } = require("./error-utils");
const { PERMISOS, requerirPermiso } = require("./rbac");
const { parecido } = require("./scripts/aplicar-fotos-banco-a-negocio");

// "Fotos sugeridas": para los productos de un negocio que no tienen foto, ofrece
// candidatas del Banco de Nexo y deja que EL DUENO confirme con un toque.
//
// Existe porque el enlace automatico (scripts/aplicar-fotos-banco-a-negocio.js)
// solo aplica lo que es seguro -- codigo exacto, EAN + nombre, nombre identico.
// Lo demas (el EAN casa pero el nombre difiere, nombres parecidos) NO se
// automatiza: una foto equivocada es peor que ninguna. Aqui una persona mira el
// producto junto a la foto y decide. Nada se escribe sin ese toque, y NUNCA se
// pisa una foto que el negocio ya tenga.
const banco = require("./banco-imagenes-server");

const SIMILITUD_MINIMA = 0.5;
const MAX_CANDIDATAS = 3;
const MAX_POR_PAGINA = 20;
const VIGENCIA_CACHE_MS = 10 * 60 * 1000;

let cacheOficiales = null;

// Productos del Catalogo Maestro que SI tienen foto en el Banco (unos 15 mil).
// Es global y casi no cambia, asi que se guarda en memoria unos minutos en vez
// de leerlo completo en cada pagina de sugerencias.
async function oficialesConFoto(pool) {
    if (cacheOficiales && Date.now() - cacheOficiales.cargadoEn < VIGENCIA_CACHE_MS) {
        return cacheOficiales;
    }

    const filas = (await pool.query(
        `SELECT cm.id AS maestro_id, cm.codigo_fabricante AS codigo_banco, cm.nombre,
                LOWER(COALESCE(cm.marca, '')) AS marca, cm.ean
         FROM public.catalogo_maestro_productos cm
         WHERE cm.nombre <> ''
           AND EXISTS (SELECT 1 FROM public.banco_imagenes_producto b WHERE b.codigo = cm.codigo_fabricante)`
    )).rows;

    const porEan = new Map();
    const porMarca = new Map();

    for (const fila of filas) {
        if (fila.ean) {
            const lista = porEan.get(fila.ean) || [];
            lista.push(fila);
            porEan.set(fila.ean, lista);
        }

        const lista = porMarca.get(fila.marca) || [];
        lista.push(fila);
        porMarca.set(fila.marca, lista);
    }

    cacheOficiales = { filas, porEan, porMarca, cargadoEn: Date.now() };
    return cacheOficiales;
}

function candidatasDelProducto(producto, oficiales, descartadas) {
    const encontradas = new Map();

    // 1) Mismo codigo de barras: el fabricante dice que es ese producto, aunque
    //    el nombre de la tienda sea otro. Se muestra con su similitud para que
    //    la persona juzgue.
    for (const oficial of oficiales.porEan.get(producto.codigo) || []) {
        encontradas.set(oficial.codigo_banco, {
            ...oficial,
            via: "ean",
            similitud: parecido(producto.nombre, oficial.nombre)
        });
    }

    // 2) Nombre parecido, dentro de la misma marca si el producto la tiene.
    const marca = String(producto.marca || "").toLowerCase();
    const universo = marca && oficiales.porMarca.has(marca) ? oficiales.porMarca.get(marca) : oficiales.filas;

    for (const oficial of universo) {
        if (encontradas.has(oficial.codigo_banco)) continue;

        const similitud = parecido(producto.nombre, oficial.nombre);
        if (similitud >= SIMILITUD_MINIMA) {
            encontradas.set(oficial.codigo_banco, { ...oficial, via: "nombre", similitud });
        }
    }

    return [...encontradas.values()]
        .filter(oficial => !descartadas.has(oficial.codigo_banco))
        // Las que traen el mismo codigo de barras van primero; luego por parecido.
        .sort((a, b) => (b.via === "ean") - (a.via === "ean") || b.similitud - a.similitud)
        .slice(0, MAX_CANDIDATAS);
}

module.exports = (app, pool, requerirAccesoNegocio) => {
    async function negocioActual(req) {
        const negocioId = req.negocioDispositivo?.negocio_id ?? req.negocioAutenticado?.negocio_id;

        if (!negocioId) {
            const error = new Error("Este equipo no esta vinculado a ningun negocio");
            error.httpStatus = 401;
            throw error;
        }

        return { id: negocioId };
    }

    const SIN_FOTO = `NOT EXISTS (SELECT 1 FROM public.fotos_producto f WHERE f.negocio_id = p.negocio_id AND f.codigo = p.codigo)`;

    app.get("/fotos-sugeridas", requerirAccesoNegocio, async (req, res) => {
        try {
            const negocio = await negocioActual(req);

            if (!(await banco.planPermiteBancoImagenes(pool, negocio.id))) {
                res.json({ ok: true, permitido: false, items: [], pendientes: 0, siguienteDespuesDe: null });
                return;
            }

            const limite = Math.min(Math.max(parseInt(req.query.limite, 10) || 8, 1), MAX_POR_PAGINA);
            let despuesDe = Math.max(parseInt(req.query.despuesDe, 10) || 0, 0);

            const pendientes = (await pool.query(
                `SELECT COUNT(*)::int AS n FROM public.productos p
                 WHERE p.negocio_id = $1 AND p.codigo <> '' AND ${SIN_FOTO}`,
                [negocio.id]
            )).rows[0].n;

            const oficiales = await oficialesConFoto(pool);
            const items = [];
            let agotado = false;

            // Se revisan lotes de productos sin foto hasta juntar los que SI
            // tienen alguna candidata (la mayoria de lo que queda no la tiene).
            while (items.length < limite && !agotado) {
                const lote = (await pool.query(
                    `SELECT p.id, p.codigo, p.nombre, COALESCE(p.marca, '') AS marca, p.precio
                     FROM public.productos p
                     WHERE p.negocio_id = $1 AND p.id > $2 AND p.codigo <> '' AND ${SIN_FOTO}
                     ORDER BY p.id
                     LIMIT 60`,
                    [negocio.id, despuesDe]
                )).rows;

                if (lote.length === 0) {
                    agotado = true;
                    break;
                }

                const descartes = (await pool.query(
                    `SELECT producto_id, codigo_banco FROM public.fotos_sugeridas_descartes
                     WHERE negocio_id = $1 AND producto_id = ANY($2::int[])`,
                    [negocio.id, lote.map(p => p.id)]
                )).rows;

                const descartesPorProducto = new Map();
                for (const descarte of descartes) {
                    const conjunto = descartesPorProducto.get(descarte.producto_id) || new Set();
                    conjunto.add(descarte.codigo_banco);
                    descartesPorProducto.set(descarte.producto_id, conjunto);
                }

                for (const producto of lote) {
                    despuesDe = producto.id;
                    const candidatas = candidatasDelProducto(producto, oficiales, descartesPorProducto.get(producto.id) || new Set());
                    if (candidatas.length === 0) continue;

                    items.push({
                        productoId: producto.id,
                        codigo: producto.codigo,
                        nombre: producto.nombre,
                        marca: producto.marca,
                        precio: Number(producto.precio) || 0,
                        candidatas: candidatas.map(c => ({
                            codigoBanco: c.codigo_banco,
                            nombre: c.nombre,
                            via: c.via,
                            similitud: Number(c.similitud.toFixed(2)),
                            imagenUrl: `/banco-imagenes/${c.codigo_banco}/principal?token=${banco.firmarTokenBancoImagen(c.codigo_banco)}`
                        }))
                    });

                    if (items.length >= limite) break;
                }

                if (lote.length < 60 && items.length < limite) agotado = true;
            }

            res.json({
                ok: true,
                permitido: true,
                pendientes,
                items,
                siguienteDespuesDe: agotado ? null : despuesDe
            });
        } catch (error) {
            responderError(res, error);
        }
    });

    // Confirmar: copia la foto del Banco a la ficha del producto. Igual que
    // "Usar esta imagen", se copian los BYTES (la foto pasa a ser del negocio).
    // Jamas pisa una foto existente: si el producto ya tiene una, 409.
    app.post("/fotos-sugeridas/aceptar", requerirAccesoNegocio, requerirPermiso(PERMISOS.MODIFICAR_INVENTARIO), async (req, res) => {
        const productoId = Number(req.body?.productoId);
        const codigoBanco = banco.normalizarCodigoFoto(req.body?.codigoBanco);

        if (!Number.isInteger(productoId) || productoId <= 0 || !codigoBanco) {
            res.status(400).json({ ok: false, error: "Falta el producto o la foto." });
            return;
        }

        const client = await pool.connect();

        try {
            const negocio = await negocioActual(req);

            if (!(await banco.planPermiteBancoImagenes(pool, negocio.id))) {
                res.status(403).json({ ok: false, error: "Esta funcion esta disponible desde el plan Plus." });
                return;
            }

            await client.query("BEGIN");

            const producto = await client.query(
                `SELECT id, codigo FROM public.productos WHERE id = $1 AND negocio_id = $2 FOR UPDATE`,
                [productoId, negocio.id]
            );

            if (producto.rows.length === 0 || !producto.rows[0].codigo) {
                await client.query("ROLLBACK");
                res.status(404).json({ ok: false, error: "Producto no encontrado." });
                return;
            }

            const fotoActual = await client.query(
                `SELECT 1 FROM public.fotos_producto WHERE negocio_id = $1 AND codigo = $2`,
                [negocio.id, producto.rows[0].codigo]
            );

            if (fotoActual.rows.length > 0) {
                await client.query("ROLLBACK");
                res.status(409).json({ ok: false, error: "Este producto ya tiene foto." });
                return;
            }

            const bancoFila = await client.query(
                `SELECT id FROM public.banco_imagenes_producto WHERE codigo = $1`,
                [codigoBanco]
            );

            if (bancoFila.rows.length === 0) {
                await client.query("ROLLBACK");
                res.status(404).json({ ok: false, error: "Esa foto ya no esta en el banco." });
                return;
            }

            await client.query(
                `INSERT INTO public.fotos_producto (negocio_id, codigo, imagen_principal, imagen_principal_tipo, actualizado_at)
                 SELECT $1, $2, b.imagen_principal, b.imagen_principal_tipo, NOW()
                 FROM public.banco_imagenes_producto b WHERE b.codigo = $3
                 ON CONFLICT (negocio_id, codigo) DO NOTHING`,
                [negocio.id, producto.rows[0].codigo, codigoBanco]
            );

            // Enlace al Catalogo Maestro (si el producto aun no lo tiene): asi
            // Market puede mostrar la galeria del fabricante, no solo la principal.
            await client.query(
                `UPDATE public.productos
                 SET catalogo_maestro_id = (
                     SELECT cm.id FROM public.catalogo_maestro_productos cm WHERE cm.codigo_fabricante = $3 LIMIT 1
                 )
                 WHERE id = $1 AND negocio_id = $2 AND catalogo_maestro_id IS NULL`,
                [productoId, negocio.id, codigoBanco]
            );

            await client.query(
                `INSERT INTO public.banco_imagenes_uso (banco_imagen_id, negocio_id, galeria_id) VALUES ($1, $2, NULL)`,
                [bancoFila.rows[0].id, negocio.id]
            );

            await client.query("COMMIT");
            res.json({ ok: true });
        } catch (error) {
            await client.query("ROLLBACK").catch(() => {});
            responderError(res, error);
        } finally {
            client.release();
        }
    });

    // "Ninguna es": se recuerdan las fotos que se mostraron para no volver a
    // ofrecerlas para ese producto. No cambia nada del producto.
    app.post("/fotos-sugeridas/descartar", requerirAccesoNegocio, async (req, res) => {
        const productoId = Number(req.body?.productoId);
        const codigos = (Array.isArray(req.body?.codigosBanco) ? req.body.codigosBanco : [])
            .map(banco.normalizarCodigoFoto).filter(Boolean).slice(0, 10);

        if (!Number.isInteger(productoId) || productoId <= 0 || codigos.length === 0) {
            res.status(400).json({ ok: false, error: "Falta el producto o las fotos." });
            return;
        }

        try {
            const negocio = await negocioActual(req);

            const producto = await pool.query(
                `SELECT id FROM public.productos WHERE id = $1 AND negocio_id = $2`,
                [productoId, negocio.id]
            );

            if (producto.rows.length === 0) {
                res.status(404).json({ ok: false, error: "Producto no encontrado." });
                return;
            }

            await pool.query(
                `INSERT INTO public.fotos_sugeridas_descartes (negocio_id, producto_id, codigo_banco)
                 SELECT $1, $2, UNNEST($3::text[])
                 ON CONFLICT (producto_id, codigo_banco) DO NOTHING`,
                [negocio.id, productoId, codigos]
            );

            res.json({ ok: true });
        } catch (error) {
            responderError(res, error);
        }
    });
};
