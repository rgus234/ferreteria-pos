const { responderError } = require("./error-utils");

// Codigos de barras -- generacion de codigo interno para productos sin
// codigo de fabrica, y plantillas de diseno guardables para el editor
// de etiquetas (seccion "Codigos de barras" del POS de escritorio). El
// armado de la lista de productos a imprimir reusa /listas-producto tal
// cual (ver public/js/barcode-labels.js) -- este modulo solo cubre las
// 2 piezas que si son nuevas.
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

    // Misma normalizacion que ya usa GET /producto-codigo/:codigo
    // (server.js) -- nunca la mas ligera normalizarCodigo() del
    // cliente, que solo quita ="' y espacios.
    function normalizarParaComparar(codigo) {
        return String(codigo || "").replace(/[^a-zA-Z0-9]/g, "").toLowerCase();
    }

    async function existeCodigoEnNegocio(negocioId, codigo) {
        const normalizado = normalizarParaComparar(codigo);

        const resultado = await pool.query(
            `SELECT 1
             FROM public.productos p
             LEFT JOIN public.producto_codigos pc ON pc.producto_id = p.id AND pc.negocio_id = p.negocio_id
             WHERE p.negocio_id = $2
             AND (
                 LOWER(regexp_replace(COALESCE(p.codigo, ''), '[^a-zA-Z0-9]', '', 'g')) = $1
                 OR LOWER(regexp_replace(COALESCE(pc.codigo, ''), '[^a-zA-Z0-9]', '', 'g')) = $1
             )
             LIMIT 1`,
            [normalizado, negocioId]
        );

        return resultado.rows.length > 0;
    }

    // El esquema es NX-{producto.id} -- productos.id es SERIAL global
    // (no por negocio), asi que es unico por construccion, sin
    // necesitar tabla de contador. El sufijo de abajo es puramente
    // defensivo (cubre el caso patologico de que un codigo ESCANEADO
    // real ya sea exactamente "NX-<id>"), no el mecanismo real de
    // unicidad -- a diferencia de pedido-codigos.js (NX{id}-{sufijo}
    // aleatorio para codigos de recogida), aqui no hace falta que sea
    // impredecible: un codigo de producto no es un token de acceso.
    app.post("/productos/:id/generar-codigo", requerirAccesoNegocio, async (req, res) => {
        try {
            const negocio = await negocioActual(req);

            const producto = await pool.query(
                `SELECT id, codigo FROM public.productos WHERE id = $1 AND negocio_id = $2`,
                [req.params.id, negocio.id]
            );

            if (producto.rows.length === 0) {
                res.status(404).json({ ok: false, error: "Producto no encontrado." });
                return;
            }

            if (String(producto.rows[0].codigo || "").trim()) {
                res.status(400).json({ ok: false, error: "Este producto ya tiene un codigo." });
                return;
            }

            let codigo = `NX-${producto.rows[0].id}`;
            let sufijo = 0;

            while (await existeCodigoEnNegocio(negocio.id, codigo)) {
                sufijo += 1;
                codigo = `NX-${producto.rows[0].id}-${sufijo}`;

                if (sufijo > 5) {
                    res.status(500).json({ ok: false, error: "No se pudo generar un codigo unico." });
                    return;
                }
            }

            await pool.query(
                `UPDATE public.productos SET codigo = $1, codigo_generado = true WHERE id = $2`,
                [codigo, req.params.id]
            );

            res.json({ ok: true, id: Number(req.params.id), codigo });
        } catch (error) {
            responderError(res, error);
        }
    });

    app.get("/etiquetas-plantillas", requerirAccesoNegocio, async (req, res) => {
        try {
            const negocio = await negocioActual(req);

            const plantillas = await pool.query(
                `SELECT * FROM public.etiquetas_plantillas WHERE negocio_id = $1 ORDER BY created_at DESC`,
                [negocio.id]
            );

            res.json({
                ok: true,
                plantillas: plantillas.rows.map(fila => ({
                    id: fila.id,
                    nombre: fila.nombre,
                    anchoMm: Number(fila.ancho_mm),
                    altoMm: Number(fila.alto_mm),
                    columnas: fila.columnas,
                    margenMm: Number(fila.margen_mm),
                    espaciadoMm: Number(fila.espaciado_mm),
                    mostrarNombre: fila.mostrar_nombre,
                    mostrarCodigoBarras: fila.mostrar_codigo_barras,
                    mostrarNumeroCodigo: fila.mostrar_numero_codigo,
                    mostrarPrecio: fila.mostrar_precio,
                    mostrarMarca: fila.mostrar_marca,
                    mostrarCategoria: fila.mostrar_categoria,
                    papelNombre: fila.papel_nombre,
                    papelAnchoMm: Number(fila.papel_ancho_mm),
                    papelAltoMm: fila.papel_alto_mm !== null ? Number(fila.papel_alto_mm) : null,
                    createdAt: fila.created_at
                }))
            });
        } catch (error) {
            responderError(res, error);
        }
    });

    app.post("/etiquetas-plantillas", requerirAccesoNegocio, async (req, res) => {
        const nombre = String(req.body?.nombre || "").trim().slice(0, 140);

        if (!nombre) {
            res.status(400).json({ ok: false, error: "Escribe el nombre de la plantilla." });
            return;
        }

        const diseno = req.body?.diseno || {};

        const numeroPositivo = (valor, porDefecto) => {
            const n = Number(valor);
            return Number.isFinite(n) && n > 0 ? n : porDefecto;
        };

        const enteroPositivo = (valor, porDefecto) => {
            const n = parseInt(valor, 10);
            return Number.isFinite(n) && n > 0 ? n : porDefecto;
        };

        // El nombre de papel "Rollo continuo" es la unica fuente de
        // verdad de si la plantilla tiene alto de pagina limitado -- el
        // servidor fuerza papel_alto_mm=null en ese caso sin importar lo
        // que mande el cliente, para que esa invariante nunca dependa de
        // que el cliente la respete.
        const papelNombre = String(diseno.papelNombre || "A4").trim().slice(0, 40) || "A4";
        const esRolloContinuo = papelNombre === "Rollo continuo";
        const papelAnchoMm = numeroPositivo(diseno.papelAnchoMm, 210);
        const papelAltoMm = esRolloContinuo ? null : numeroPositivo(diseno.papelAltoMm, 297);

        try {
            const negocio = await negocioActual(req);

            const resultado = await pool.query(
                `INSERT INTO public.etiquetas_plantillas
                    (negocio_id, nombre, ancho_mm, alto_mm, columnas, margen_mm, espaciado_mm,
                     mostrar_nombre, mostrar_codigo_barras, mostrar_numero_codigo, mostrar_precio, mostrar_marca, mostrar_categoria,
                     papel_nombre, papel_ancho_mm, papel_alto_mm)
                 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
                 RETURNING id`,
                [
                    negocio.id,
                    nombre,
                    numeroPositivo(diseno.anchoMm, 50),
                    numeroPositivo(diseno.altoMm, 25),
                    enteroPositivo(diseno.columnas, 3),
                    numeroPositivo(diseno.margenMm, 5),
                    numeroPositivo(diseno.espaciadoMm, 3),
                    Boolean(diseno.mostrarNombre),
                    Boolean(diseno.mostrarCodigoBarras),
                    Boolean(diseno.mostrarNumeroCodigo),
                    Boolean(diseno.mostrarPrecio),
                    Boolean(diseno.mostrarMarca),
                    Boolean(diseno.mostrarCategoria),
                    papelNombre,
                    papelAnchoMm,
                    papelAltoMm
                ]
            );

            res.json({ ok: true, id: resultado.rows[0].id });
        } catch (error) {
            responderError(res, error);
        }
    });

    app.delete("/etiquetas-plantillas/:id", requerirAccesoNegocio, async (req, res) => {
        try {
            const negocio = await negocioActual(req);

            const resultado = await pool.query(
                `DELETE FROM public.etiquetas_plantillas WHERE id = $1 AND negocio_id = $2 RETURNING id`,
                [req.params.id, negocio.id]
            );

            if (resultado.rows.length === 0) {
                res.status(404).json({ ok: false, error: "Plantilla no encontrada." });
                return;
            }

            res.json({ ok: true });
        } catch (error) {
            responderError(res, error);
        }
    });
};
