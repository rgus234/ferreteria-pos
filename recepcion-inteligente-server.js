// Recepcion Inteligente, Fase 1: pipeline completo SIN Gmail todavia.
// La factura llega por ahora subida a mano (POST /facturas, un stand-in
// para "llego un correo") -- el resto del flujo es identico al que
// tendra la Fase 2 cuando el correo entre solo: parsear el CFDI,
// resolver proveedor por RFC, encontrar un candidato por concepto, y
// dejar todo como "Recepcion pendiente de revision".
//
// Principio que gobierna este archivo, el mismo del diseno aprobado:
// Nexo puede interpretar una factura, pero nunca debe modificar
// inventario automaticamente solo porque llego un documento. Ningun
// endpoint de este archivo toca productos.stock excepto
// POST /:id/confirmar, y solo para los conceptos que una persona ya
// decidio.
const { responderError } = require("./error-utils");
const { PERMISOS, requerirPermiso } = require("./rbac");
const { parsearCfdi } = require("./cfdi-parser");
const { resolverConceptoFactura } = require("./recepcion-inteligente-matching");
const { resolverProveedorPorRfc } = require("./proveedor-resolver");

async function negocioActual(req, pool) {
    const negocioId = req.negocioDispositivo?.negocio_id ?? req.negocioAutenticado?.negocio_id;

    if (!negocioId) {
        const error = new Error("Este equipo no esta vinculado a ningun negocio");
        error.httpStatus = 401;
        throw error;
    }

    const resultado = await pool.query(`SELECT id FROM public.negocios WHERE id = $1 LIMIT 1`, [negocioId]);

    if (resultado.rows.length === 0) {
        const error = new Error("Negocio no encontrado");
        error.httpStatus = 404;
        throw error;
    }

    return resultado.rows[0];
}

async function registrarBitacora(clientOPool, negocioId, empleadoId, accion, detalle = {}) {
    try {
        await clientOPool.query(
            `INSERT INTO public.bitacora_acciones (negocio_id, empleado_id, accion, detalle) VALUES ($1, $2, $3, $4::jsonb)`,
            [negocioId, empleadoId || null, accion, JSON.stringify(detalle)]
        );
    } catch (error) {
        // La bitacora nunca debe tumbar la operacion real que registra.
        console.warn("No se pudo registrar bitacora de recepcion inteligente:", error.message);
    }
}

function num(valor) {
    const n = Number(valor);
    return Number.isFinite(n) ? n : 0;
}

function empleadoIdDeRequest(req) {
    return Number(req.headers["x-empleado-id"]) || null;
}

async function buscarPorUuid(client, negocioId, uuid) {
    if (!uuid) return null;
    const fila = await client.query(
        `SELECT id, estado FROM public.recepciones_inteligentes WHERE negocio_id = $1 AND uuid_cfdi = $2`,
        [negocioId, uuid]
    );
    return fila.rows[0] || null;
}

// Nivel "fuerte" con un producto YA existente en este negocio se
// pre-marca como resuelto (el 🟢 del diseno aprobado) -- pero nunca se
// aplica a inventario aqui, solo se deja pre-seleccionado para que
// /confirmar lo aplique cuando una persona confirme la recepcion
// completa. Cualquier otro caso (nivel probable, o un candidato del
// Catalogo Maestro que aun no tiene producto propio) se deja sin
// decidir -- el 🟡 que exige un clic humano.
function decisionInicial(candidato) {
    if (candidato && candidato.nivel === "fuerte" && candidato.productoId) {
        return { accion: "relacionar", productoId: candidato.productoId };
    }
    return { accion: "", productoId: null };
}

// Corazon del pipeline, compartido por las 2 formas de "llegar" una
// factura: subida a mano (POST /facturas, este archivo) y Gmail (Fase
// 2, recepcion-inteligente-gmail.js). Nunca duplicar esta logica --
// cualquier mejora al parseo/matching/deduplicacion debe beneficiar a
// las dos fuentes por igual. Tira un error con .httpStatus para que el
// llamador decida como responder (una request HTTP vs. un mensaje mas
// de un lote de Gmail que debe seguir con el siguiente).
async function procesarFacturaXml(pool, negocioId, xml, { origen = "manual", empleadoId = null, pdfBase64 = null } = {}) {
    if (!xml || typeof xml !== "string" || !xml.trim()) {
        const error = new Error("Falta el XML de la factura");
        error.httpStatus = 400;
        throw error;
    }

    let factura;
    try {
        factura = parsearCfdi(xml);
    } catch (error) {
        error.httpStatus = 400;
        throw error;
    }

    if (!factura.conceptos.length) {
        const error = new Error("La factura no trae conceptos que registrar");
        error.httpStatus = 400;
        throw error;
    }

    const client = await pool.connect();
    try {
        await client.query("BEGIN");

        const existente = await buscarPorUuid(client, negocioId, factura.uuid);
        if (existente) {
            await client.query("ROLLBACK");
            return { recepcionId: existente.id, estado: existente.estado, repetida: true };
        }

        const proveedorId = await resolverProveedorPorRfc(pool, negocioId, factura.emisorRfc, factura.emisorNombre);

        await client.query("SAVEPOINT antes_insertar_recepcion");
        let recepcion;
        try {
            recepcion = await client.query(
                `INSERT INTO public.recepciones_inteligentes
                    (negocio_id, origen, uuid_cfdi, proveedor_id, rfc_emisor, nombre_emisor, rfc_receptor,
                     folio, serie, fecha_documento, subtotal, iva, total)
                 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
                 RETURNING id`,
                [
                    negocioId, origen, factura.uuid, proveedorId, factura.emisorRfc, factura.emisorNombre,
                    factura.receptorRfc, factura.folio, factura.serie, factura.fecha,
                    factura.subtotal, factura.iva, factura.total
                ]
            );
        } catch (error) {
            if (error.code === "23505" && factura.uuid) {
                // Carrera real: dos peticiones para el mismo UUID casi al
                // mismo tiempo (o Gmail devolviendo el mismo correo dos
                // veces en un mismo lote). El indice unico (negocio_id,
                // uuid_cfdi) es lo que en realidad evita el duplicado --
                // aqui solo se responde con gracia en vez de tronar.
                await client.query("ROLLBACK");
                const yaExiste = await buscarPorUuid(pool, negocioId, factura.uuid);
                return { recepcionId: yaExiste?.id, estado: yaExiste?.estado, repetida: true };
            }
            throw error;
        }

        const recepcionId = recepcion.rows[0].id;
        let identificados = 0;

        for (const concepto of factura.conceptos) {
            const candidato = await resolverConceptoFactura(pool, negocioId, concepto);
            const decision = decisionInicial(candidato);
            if (decision.accion) identificados++;

            await client.query(
                `INSERT INTO public.recepciones_inteligentes_items
                    (negocio_id, recepcion_id, codigo_factura, clave_prod_serv, descripcion, cantidad,
                     unidad, costo_unitario, importe, descuento, candidato, nivel, producto_id, accion)
                 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12,$13,$14)`,
                [
                    negocioId, recepcionId, concepto.codigo, concepto.claveProdServ, concepto.descripcion,
                    concepto.cantidad, concepto.unidad, concepto.costo, concepto.importe, concepto.descuento,
                    candidato ? JSON.stringify(candidato) : null,
                    candidato ? candidato.nivel : null,
                    decision.productoId, decision.accion
                ]
            );
        }

        if (pdfBase64) {
            await client.query(
                `UPDATE public.recepciones_inteligentes SET pdf_bytes = $1 WHERE id = $2`,
                [Buffer.from(pdfBase64, "base64"), recepcionId]
            );
        }
        await client.query(
            `UPDATE public.recepciones_inteligentes SET xml_bytes = $1 WHERE id = $2`,
            [Buffer.from(xml, "utf8"), recepcionId]
        );

        await client.query("COMMIT");

        await registrarBitacora(pool, negocioId, empleadoId, "recepcion_inteligente_detectada", {
            recepcionId, proveedor: factura.emisorNombre, folio: factura.folio, total: factura.total,
            conceptos: factura.conceptos.length, identificados, origen
        });

        return {
            recepcionId,
            proveedorResuelto: Boolean(proveedorId),
            totalConceptos: factura.conceptos.length,
            identificados,
            porRevisar: factura.conceptos.length - identificados,
            repetida: false
        };
    } catch (error) {
        await client.query("ROLLBACK").catch(() => {});
        throw error;
    } finally {
        client.release();
    }
}

module.exports = (app, pool, requerirAccesoNegocio) => {
    // Sube una factura a mano -- lo que en la Fase 2 hara el correo
    // solo. Body: { xml: "<texto del CFDI>", pdfBase64?: "..." }.
    app.post(
        "/recepcion-inteligente/facturas",
        requerirAccesoNegocio,
        requerirPermiso(PERMISOS.MODIFICAR_INVENTARIO),
        async (req, res) => {
            try {
                const negocio = await negocioActual(req, pool);
                const { xml, pdfBase64 } = req.body || {};

                const resultado = await procesarFacturaXml(pool, negocio.id, xml, {
                    origen: "manual",
                    empleadoId: empleadoIdDeRequest(req),
                    pdfBase64
                });

                res.json({ ok: true, ...resultado });
            } catch (error) {
                if (error.httpStatus) {
                    res.status(error.httpStatus).json({ ok: false, error: error.message });
                    return;
                }
                responderError(res, error);
            }
        }
    );

    app.get(
        "/recepcion-inteligente/facturas",
        requerirAccesoNegocio,
        requerirPermiso(PERMISOS.MODIFICAR_INVENTARIO),
        async (req, res) => {
            try {
                const negocio = await negocioActual(req, pool);

                const filas = await pool.query(
                    `SELECT r.id, r.nombre_emisor, r.folio, r.total, r.estado, r.created_at, r.confirmada_en,
                            p.nombre AS proveedor_nombre,
                            COUNT(i.id) AS total_items,
                            COUNT(i.id) FILTER (WHERE i.accion <> '') AS resueltos
                     FROM public.recepciones_inteligentes r
                     LEFT JOIN public.proveedores p ON p.id = r.proveedor_id
                     LEFT JOIN public.recepciones_inteligentes_items i ON i.recepcion_id = r.id
                     WHERE r.negocio_id = $1
                     GROUP BY r.id, p.nombre
                     ORDER BY r.created_at DESC
                     LIMIT 100`,
                    [negocio.id]
                );

                res.json({
                    ok: true,
                    facturas: filas.rows.map(fila => ({
                        id: fila.id,
                        proveedor: fila.proveedor_nombre || fila.nombre_emisor || "Proveedor sin identificar",
                        folio: fila.folio,
                        total: Number(fila.total),
                        estado: fila.estado,
                        totalItems: Number(fila.total_items),
                        resueltos: Number(fila.resueltos),
                        porRevisar: Number(fila.total_items) - Number(fila.resueltos),
                        creadaEn: fila.created_at,
                        confirmadaEn: fila.confirmada_en
                    }))
                });
            } catch (error) {
                responderError(res, error);
            }
        }
    );

    app.get(
        "/recepcion-inteligente/facturas/:id",
        requerirAccesoNegocio,
        requerirPermiso(PERMISOS.MODIFICAR_INVENTARIO),
        async (req, res) => {
            try {
                const negocio = await negocioActual(req, pool);

                const cabecera = await pool.query(
                    `SELECT r.*, p.nombre AS proveedor_nombre
                     FROM public.recepciones_inteligentes r
                     LEFT JOIN public.proveedores p ON p.id = r.proveedor_id
                     WHERE r.id = $1 AND r.negocio_id = $2`,
                    [req.params.id, negocio.id]
                );

                if (!cabecera.rows.length) {
                    res.status(404).json({ ok: false, error: "Recepcion no encontrada" });
                    return;
                }

                const items = await pool.query(
                    `SELECT id, codigo_factura, clave_prod_serv, descripcion, cantidad, unidad, costo_unitario,
                            importe, descuento, candidato, nivel, producto_id, accion, nombre_nuevo_producto
                     FROM public.recepciones_inteligentes_items
                     WHERE recepcion_id = $1
                     ORDER BY id ASC`,
                    [req.params.id]
                );

                const fila = cabecera.rows[0];
                res.json({
                    ok: true,
                    recepcion: {
                        id: fila.id,
                        estado: fila.estado,
                        origen: fila.origen,
                        proveedor: fila.proveedor_nombre || fila.nombre_emisor,
                        proveedorId: fila.proveedor_id,
                        rfcEmisor: fila.rfc_emisor,
                        nombreEmisor: fila.nombre_emisor,
                        folio: fila.folio,
                        serie: fila.serie,
                        fechaDocumento: fila.fecha_documento,
                        subtotal: Number(fila.subtotal),
                        iva: Number(fila.iva),
                        total: Number(fila.total),
                        creadaEn: fila.created_at,
                        confirmadaEn: fila.confirmada_en
                    },
                    items: items.rows.map(item => ({
                        id: item.id,
                        codigo: item.codigo_factura,
                        claveProdServ: item.clave_prod_serv,
                        descripcion: item.descripcion,
                        cantidad: Number(item.cantidad),
                        unidad: item.unidad,
                        costo: Number(item.costo_unitario),
                        importe: Number(item.importe),
                        descuento: Number(item.descuento),
                        candidato: item.candidato,
                        nivel: item.nivel,
                        productoId: item.producto_id,
                        accion: item.accion,
                        nombreNuevoProducto: item.nombre_nuevo_producto,
                        precioVentaNuevoProducto: item.precio_venta_nuevo_producto != null ? Number(item.precio_venta_nuevo_producto) : null
                    }))
                });
            } catch (error) {
                responderError(res, error);
            }
        }
    );

    // Decision manual de un concepto amarillo: relacionar con un
    // producto existente, crear uno nuevo, u omitirlo de la recepcion.
    app.post(
        "/recepcion-inteligente/facturas/:id/items/:itemId",
        requerirAccesoNegocio,
        requerirPermiso(PERMISOS.MODIFICAR_INVENTARIO),
        async (req, res) => {
            try {
                const negocio = await negocioActual(req, pool);
                const { accion, productoId, nombreNuevoProducto, precioVenta } = req.body || {};

                // "" resetea la decision (boton "Cambiar" en pantalla,
                // para volver a elegir sin dejar un rastro de la accion
                // anterior).
                if (!["", "relacionar", "crear", "omitir"].includes(accion)) {
                    res.status(400).json({ ok: false, error: "Accion invalida" });
                    return;
                }
                if (accion === "relacionar" && !(Number.isInteger(productoId) && productoId > 0)) {
                    res.status(400).json({ ok: false, error: "Falta el producto a relacionar" });
                    return;
                }
                if (accion === "crear" && !(Number.isFinite(Number(precioVenta)) && Number(precioVenta) >= 0)) {
                    res.status(400).json({ ok: false, error: "Falta el precio de venta" });
                    return;
                }

                const recepcion = await pool.query(
                    `SELECT estado FROM public.recepciones_inteligentes WHERE id = $1 AND negocio_id = $2`,
                    [req.params.id, negocio.id]
                );
                if (!recepcion.rows.length) {
                    res.status(404).json({ ok: false, error: "Recepcion no encontrada" });
                    return;
                }
                if (recepcion.rows[0].estado !== "pendiente") {
                    res.status(400).json({ ok: false, error: "Esta recepcion ya fue procesada" });
                    return;
                }

                const actualizado = await pool.query(
                    `UPDATE public.recepciones_inteligentes_items
                     SET accion = $1,
                         producto_id = CASE WHEN $1 = 'relacionar' THEN $2::integer ELSE NULL END,
                         nombre_nuevo_producto = CASE WHEN $1 = 'crear' THEN $3::text ELSE '' END,
                         precio_venta_nuevo_producto = CASE WHEN $1 = 'crear' THEN $4::numeric ELSE NULL END
                     WHERE id = $5 AND recepcion_id = $6 AND negocio_id = $7
                     RETURNING id`,
                    [
                        accion, productoId || null, String(nombreNuevoProducto || "").trim(),
                        accion === "crear" ? Number(precioVenta) : null,
                        req.params.itemId, req.params.id, negocio.id
                    ]
                );

                if (!actualizado.rows.length) {
                    res.status(404).json({ ok: false, error: "Concepto no encontrado" });
                    return;
                }

                res.json({ ok: true });
            } catch (error) {
                responderError(res, error);
            }
        }
    );

    app.post(
        "/recepcion-inteligente/facturas/:id/rechazar",
        requerirAccesoNegocio,
        requerirPermiso(PERMISOS.MODIFICAR_INVENTARIO),
        async (req, res) => {
            try {
                const negocio = await negocioActual(req, pool);

                const actualizado = await pool.query(
                    `UPDATE public.recepciones_inteligentes
                     SET estado = 'rechazada', revisado_por_empleado_id = $1
                     WHERE id = $2 AND negocio_id = $3 AND estado = 'pendiente'
                     RETURNING id`,
                    [empleadoIdDeRequest(req), req.params.id, negocio.id]
                );

                if (!actualizado.rows.length) {
                    res.status(400).json({ ok: false, error: "Esta recepcion no se puede rechazar" });
                    return;
                }

                await registrarBitacora(pool, negocio.id, empleadoIdDeRequest(req), "recepcion_inteligente_rechazada", {
                    recepcionId: Number(req.params.id)
                });

                res.json({ ok: true });
            } catch (error) {
                responderError(res, error);
            }
        }
    );

    // El unico punto de todo este archivo que toca inventario. Mismo
    // patron transaccional que ya usa fase4-server.js para
    // /pedidos-proveedor/:id/recepciones (BEGIN...COMMIT, stock y
    // precio_distribuidor en la misma transaccion) -- aqui ademas se
    // escribe en recepciones_mercancia para que esta recepcion aparezca
    // en el mismo Historial de recepcion de mercancia que ya existe,
    // en vez de construir una pantalla de historial aparte.
    app.post(
        "/recepcion-inteligente/facturas/:id/confirmar",
        requerirAccesoNegocio,
        requerirPermiso(PERMISOS.MODIFICAR_INVENTARIO),
        async (req, res) => {
            const client = await pool.connect();

            try {
                const negocio = await negocioActual(req, pool);
                await client.query("BEGIN");

                const recepcion = await client.query(
                    `SELECT * FROM public.recepciones_inteligentes WHERE id = $1 AND negocio_id = $2 FOR UPDATE`,
                    [req.params.id, negocio.id]
                );
                if (!recepcion.rows.length) {
                    await client.query("ROLLBACK");
                    res.status(404).json({ ok: false, error: "Recepcion no encontrada" });
                    return;
                }
                if (recepcion.rows[0].estado !== "pendiente") {
                    await client.query("ROLLBACK");
                    res.status(400).json({ ok: false, error: "Esta recepcion ya fue procesada" });
                    return;
                }

                const items = await client.query(
                    `SELECT * FROM public.recepciones_inteligentes_items WHERE recepcion_id = $1`,
                    [req.params.id]
                );

                const sinDecidir = items.rows.filter(item => !item.accion);
                if (sinDecidir.length) {
                    await client.query("ROLLBACK");
                    res.status(400).json({
                        ok: false,
                        error: `Aun hay ${sinDecidir.length} concepto(s) sin revisar`,
                        pendientes: sinDecidir.length
                    });
                    return;
                }

                let totalAplicado = 0;
                const itemsAplicados = [];

                for (const item of items.rows) {
                    if (item.accion === "omitir") continue;

                    const cantidad = num(item.cantidad);
                    const costo = num(item.costo_unitario);
                    let productoId = item.producto_id;

                    if (item.accion === "crear") {
                        const candidato = item.candidato || {};
                        const nombre = item.nombre_nuevo_producto || item.descripcion;
                        const catalogoMaestroId = candidato.catalogoMaestroId || null;
                        // Precio elegido al revisar (uno de los 3 precios de
                        // referencia del candidato, o capturado a mano si no
                        // habia ninguno) -- nunca el costo de la factura tal
                        // cual. Fallback a costo solo por si esta fila quedo
                        // decidida antes de que este campo existiera.
                        const precioVenta = item.precio_venta_nuevo_producto != null ? num(item.precio_venta_nuevo_producto) : costo;

                        const nuevo = await client.query(
                            `INSERT INTO public.productos
                                (negocio_id, nombre, codigo, precio, precio_publico, precio_mayoreo, precio_distribuidor,
                                 stock, marca, proveedor_id, catalogo_maestro_id)
                             VALUES ($1,$2,$3,$4,$4,$4,$5,0,$6,$7,$8)
                             RETURNING id`,
                            [
                                negocio.id, nombre, item.codigo_factura || "", precioVenta, costo,
                                candidato.marca || null, recepcion.rows[0].proveedor_id, catalogoMaestroId
                            ]
                        );
                        productoId = nuevo.rows[0].id;

                        await client.query(
                            `UPDATE public.recepciones_inteligentes_items SET producto_id = $1 WHERE id = $2`,
                            [productoId, item.id]
                        );
                    } else if (item.accion === "relacionar") {
                        const candidato = item.candidato || {};
                        await client.query(
                            `UPDATE public.productos
                             SET catalogo_maestro_id = COALESCE(catalogo_maestro_id, $1)
                             WHERE id = $2 AND negocio_id = $3`,
                            [candidato.catalogoMaestroId || null, productoId, negocio.id]
                        );
                    }

                    await client.query(
                        `UPDATE public.productos
                         SET stock = stock + $1,
                             precio_distribuidor = COALESCE(NULLIF($2, 0), precio_distribuidor)
                         WHERE id = $3 AND negocio_id = $4`,
                        [cantidad, costo, productoId, negocio.id]
                    );

                    totalAplicado += cantidad * costo;
                    itemsAplicados.push({ productoId, codigo: item.codigo_factura, nombre: item.descripcion, cantidad, costo });
                }

                const recepcionMercancia = await client.query(
                    `INSERT INTO public.recepciones_mercancia
                        (negocio_id, proveedor, referencia, notas, total, fecha_documento, tipo_documento)
                     VALUES ($1,$2,$3,$4,$5,$6,'factura')
                     RETURNING id`,
                    [
                        negocio.id,
                        recepcion.rows[0].nombre_emisor || "",
                        recepcion.rows[0].folio || "",
                        "Recepcion Inteligente",
                        totalAplicado,
                        recepcion.rows[0].fecha_documento
                    ]
                );
                const recepcionMercanciaId = recepcionMercancia.rows[0].id;

                for (const item of itemsAplicados) {
                    await client.query(
                        `INSERT INTO public.recepciones_mercancia_items
                            (negocio_id, recepcion_id, producto_id, codigo, nombre, cantidad, costo)
                         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
                        [negocio.id, recepcionMercanciaId, item.productoId, item.codigo, item.nombre, item.cantidad, item.costo]
                    );
                }

                await client.query(
                    `UPDATE public.recepciones_inteligentes
                     SET estado = 'confirmada', confirmada_en = NOW(),
                         revisado_por_empleado_id = $1, recepcion_mercancia_id = $2
                     WHERE id = $3`,
                    [empleadoIdDeRequest(req), recepcionMercanciaId, req.params.id]
                );

                await client.query("COMMIT");

                await registrarBitacora(pool, negocio.id, empleadoIdDeRequest(req), "recepcion_inteligente_confirmada", {
                    recepcionId: Number(req.params.id), recepcionMercanciaId, totalAplicado,
                    itemsAplicados: itemsAplicados.length, itemsOmitidos: items.rows.length - itemsAplicados.length
                });

                res.json({ ok: true, recepcionMercanciaId, totalAplicado });
            } catch (error) {
                await client.query("ROLLBACK").catch(() => {});
                responderError(res, error);
            } finally {
                client.release();
            }
        }
    );
};

// Reutilizado por recepcion-inteligente-gmail.js (Fase 2): mismo
// pipeline exacto, nunca duplicado.
module.exports.procesarFacturaXml = procesarFacturaXml;
