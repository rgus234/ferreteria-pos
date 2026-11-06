// Gafi: codigos de barras y fotos, producto por producto.
//
// La lista de Gafi trae clave y precio pero NUNCA el codigo de barras ni la foto: eso solo lo da el empaque en la mano. Esta pantalla
// (solo para el administrador, detras de la funcion "gafi_captura") busca un producto de la lista, guarda el codigo de barras que se
// escanea y su foto. Con el codigo guardado, escanear ese empaque en Agregar producto ya lo reconoce (buscar-codigo ya mira codigo_barras).
//
// Reglas: un codigo de barras tiene que pasar su digito verificador y no puede ser de OTRO producto de la lista; jamas se pisa una
// foto que el producto ya tenga en inventario.

const { responderError } = require("./error-utils");
const { PERMISOS, requerirPermiso } = require("./rbac");
const { eanValido } = require("./catalogo-maestro-reconciliacion");

const PATRON_GAFI = "gafi|004be"; // igual que en catalog-server.js: la lista de Gafi de Olimpico se llama "004BE Durango..."
const LIMITE_FOTO_BYTES = 4 * 1024 * 1024;
const TIPOS_FOTO = { "image/jpeg": "image/jpeg", "image/png": "image/png", "image/webp": "image/webp" };

function instalar(app, pool, requerirAccesoNegocio) {
    function negocioId(req) {
        const id = req.negocioDispositivo?.negocio_id ?? req.negocioAutenticado?.negocio_id;

        if (!id) {
            const error = new Error("Este equipo no esta vinculado a ningun negocio");
            error.httpStatus = 401;
            throw error;
        }

        return id;
    }

    const soloAdministrador = requerirPermiso(PERMISOS.ADMINISTRAR_USUARIOS);

    const filaPublica = f => ({
        id: f.id,
        codigo: f.codigo_proveedor,
        clave: f.clave_proveedor || "",
        nombre: f.nombre_proveedor || "",
        marca: f.marca || "",
        codigoBarras: f.codigo_barras || "",
        tieneFoto: Boolean(f.tiene_foto),
        precio: f.precio_publico != null ? Number(f.precio_publico) : null
    });

    const SELECT = `SELECT cp.id, cp.codigo_proveedor, cp.clave_proveedor, cp.nombre_proveedor, cp.marca, cp.codigo_barras, cp.precio_publico, cp.producto_id,
                           (cp.imagen IS NOT NULL) AS tiene_foto
                    FROM public.catalogo_productos cp
                    JOIN public.catalogos_proveedor cat ON cat.id = cp.catalogo_id`;

    app.get("/gafi-captura/resumen", requerirAccesoNegocio, soloAdministrador, async (req, res) => {
        try {
            const r = await pool.query(
                `SELECT COUNT(*)::int AS total,
                        COUNT(*) FILTER (WHERE NULLIF(cp.codigo_barras, '') IS NOT NULL)::int AS con_barras,
                        COUNT(*) FILTER (WHERE cp.imagen IS NOT NULL)::int AS con_foto
                 FROM public.catalogo_productos cp JOIN public.catalogos_proveedor cat ON cat.id = cp.catalogo_id
                 WHERE cp.negocio_id = $1 AND cat.proveedor ~* $2`,
                [negocioId(req), PATRON_GAFI]
            );
            res.json({ ok: true, ...r.rows[0] });
        } catch (error) {
            responderError(res, error);
        }
    });

    // Busca por clave del fabricante, codigo de Gafi o palabras del nombre.
    app.get("/gafi-captura/buscar", requerirAccesoNegocio, soloAdministrador, async (req, res) => {
        try {
            const texto = String(req.query.q || "").trim();

            if (texto.length < 2) {
                res.json({ ok: true, productos: [] });
                return;
            }

            const palabras = texto.toLowerCase().split(/\s+/).filter(Boolean).slice(0, 6);
            const condiciones = palabras.map((_, i) => `(cp.nombre_proveedor ILIKE $${i + 3} OR cp.clave_proveedor ILIKE $${i + 3} OR cp.codigo_proveedor ILIKE $${i + 3} OR cp.marca ILIKE $${i + 3})`).join(" AND ");

            const filas = await pool.query(
                `${SELECT}
                 WHERE cp.negocio_id = $1 AND cat.proveedor ~* $2 AND ${condiciones}
                 ORDER BY (cp.codigo_proveedor = $${palabras.length + 3}) DESC, cp.nombre_proveedor
                 LIMIT 25`,
                [negocioId(req), PATRON_GAFI, ...palabras.map(p => `%${p}%`), texto]
            );

            res.json({ ok: true, productos: filas.rows.map(filaPublica) });
        } catch (error) {
            responderError(res, error);
        }
    });

    // Guarda el codigo de barras de un producto de la lista.
    app.post("/gafi-captura/:id/codigo-barras", requerirAccesoNegocio, soloAdministrador, async (req, res) => {
        try {
            const idNegocio = negocioId(req);
            const id = Number(req.params.id);
            const ean = String(req.body?.codigoBarras || "").replace(/\s+/g, "");

            if (!Number.isInteger(id) || id <= 0) {
                res.status(400).json({ ok: false, error: "Producto no valido." });
                return;
            }

            if (!eanValido(ean)) {
                res.status(400).json({ ok: false, error: "Ese numero no es un codigo de barras valido (no pasa el digito verificador). Escanealo otra vez." });
                return;
            }

            const producto = await pool.query(
                `${SELECT} WHERE cp.id = $1 AND cp.negocio_id = $2 AND cat.proveedor ~* $3`,
                [id, idNegocio, PATRON_GAFI]
            );

            if (producto.rows.length === 0) {
                res.status(404).json({ ok: false, error: "Ese producto no es de la lista de Gafi." });
                return;
            }

            const otro = await pool.query(
                `SELECT cp.id, cp.nombre_proveedor FROM public.catalogo_productos cp
                 WHERE cp.negocio_id = $1 AND cp.codigo_barras = $2 AND cp.id <> $3 LIMIT 1`,
                [idNegocio, ean, id]
            );

            if (otro.rows.length > 0) {
                res.status(409).json({ ok: false, error: `Ese codigo de barras ya es de otro producto: "${otro.rows[0].nombre_proveedor}".` });
                return;
            }

            await pool.query(`UPDATE public.catalogo_productos SET codigo_barras = $1, updated_at = NOW() WHERE id = $2 AND negocio_id = $3`, [ean, id, idNegocio]);

            res.json({ ok: true, producto: filaPublica({ ...producto.rows[0], codigo_barras: ean }) });
        } catch (error) {
            responderError(res, error);
        }
    });

    // Guarda la foto (data URL jpeg/png/webp). No pisa la foto del inventario si el producto ya esta dado de alta y ya tiene una.
    app.post("/gafi-captura/:id/foto", requerirAccesoNegocio, soloAdministrador, async (req, res) => {
        try {
            const idNegocio = negocioId(req);
            const id = Number(req.params.id);
            const coincidencia = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(String(req.body?.imagen || ""));

            if (!Number.isInteger(id) || id <= 0 || !coincidencia) {
                res.status(400).json({ ok: false, error: "La foto no es valida (JPG, PNG o WebP)." });
                return;
            }

            const bytes = Buffer.from(coincidencia[2], "base64");

            if (bytes.length === 0 || bytes.length > LIMITE_FOTO_BYTES) {
                res.status(400).json({ ok: false, error: "La foto es muy grande (maximo 4 MB)." });
                return;
            }

            const producto = await pool.query(
                `${SELECT} WHERE cp.id = $1 AND cp.negocio_id = $2 AND cat.proveedor ~* $3`,
                [id, idNegocio, PATRON_GAFI]
            );

            if (producto.rows.length === 0) {
                res.status(404).json({ ok: false, error: "Ese producto no es de la lista de Gafi." });
                return;
            }

            await pool.query(`UPDATE public.catalogo_productos SET imagen = $1, imagen_tipo = $2, updated_at = NOW() WHERE id = $3 AND negocio_id = $4`, [bytes, TIPOS_FOTO[coincidencia[1]], id, idNegocio]);

            // Si ese producto ya esta en inventario y NO tiene foto, se le pone la misma. Nunca se pisa una existente.
            const productoId = producto.rows[0].producto_id;

            if (productoId) {
                await pool.query(
                    `INSERT INTO public.fotos_producto (negocio_id, codigo, imagen_principal, imagen_principal_tipo, actualizado_at)
                     SELECT $1, p.codigo, $3, $4, NOW() FROM public.productos p WHERE p.id = $2 AND p.negocio_id = $1 AND COALESCE(p.codigo, '') <> ''
                     ON CONFLICT (negocio_id, codigo) DO NOTHING`,
                    [idNegocio, productoId, bytes, TIPOS_FOTO[coincidencia[1]]]
                );
            }

            res.json({ ok: true, producto: filaPublica({ ...producto.rows[0], tiene_foto: true }) });
        } catch (error) {
            responderError(res, error);
        }
    });

    app.get("/gafi-captura/:id/foto", requerirAccesoNegocio, soloAdministrador, async (req, res) => {
        try {
            const f = await pool.query(`SELECT imagen, imagen_tipo FROM public.catalogo_productos WHERE id = $1 AND negocio_id = $2 AND imagen IS NOT NULL`, [Number(req.params.id), negocioId(req)]);

            if (f.rows.length === 0) {
                res.status(404).end();
                return;
            }

            res.set("Content-Type", f.rows[0].imagen_tipo || "image/jpeg");
            res.set("Cache-Control", "private, max-age=60");
            res.send(f.rows[0].imagen);
        } catch (error) {
            responderError(res, error);
        }
    });
}

module.exports = instalar;
module.exports.PATRON_GAFI = PATRON_GAFI;
