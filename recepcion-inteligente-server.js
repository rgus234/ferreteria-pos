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
const sharp = require("sharp");
const { responderError } = require("./error-utils");
const { PERMISOS, requerirPermiso } = require("./rbac");
const { parsearCfdi } = require("./cfdi-parser");
const { resolverConceptoFactura } = require("./recepcion-inteligente-matching");
const { resolverProveedorPorRfc, resolverOcrearProveedorId } = require("./proveedor-resolver");
const { obtenerAnthropic, licenciaDelNegocio } = require("./ia-server");
const { costoNetoConDescuento } = require("./descuento-proveedor");
const { aplicarRedondeo } = require("./public/js/pricing-rules");

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

// Resuelve y guarda los renglones de una recepcion -- compartido por
// las 3 formas de "llegar" una recepcion: CFDI a mano, CFDI por Gmail,
// y foto de remision (Fase 5). Un concepto/renglon de mercancia
// recibida siempre se resuelve contra el inventario/catalogos igual,
// sin importar si el texto vino de parsear un XML o de que la IA leyera
// una foto. Nunca duplicar esta logica.
async function insertarItemsRecepcionInteligente(pool, client, negocioId, recepcionId, conceptos) {
    let identificados = 0;

    for (const concepto of conceptos) {
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

    return identificados;
}

// Corazon del pipeline CFDI, compartido por las 2 formas de "llegar"
// una factura real: subida a mano (POST /facturas, este archivo) y
// Gmail (Fase 2, recepcion-inteligente-gmail.js). Nunca duplicar esta
// logica -- cualquier mejora al parseo/matching/deduplicacion debe
// beneficiar a las dos fuentes por igual. Tira un error con
// .httpStatus para que el llamador decida como responder (una request
// HTTP vs. un mensaje mas de un lote de Gmail que debe seguir con el
// siguiente).
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
        const identificados = await insertarItemsRecepcionInteligente(pool, client, negocioId, recepcionId, factura.conceptos);

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

// Fase 5: leer una remision impresa (o cualquier hoja que un proveedor
// entregue junto con la mercancia) desde una foto, en vez de esperar el
// CFDI que puede llegar dias despues -- asi el stock se puede aplicar
// en el momento sin frenar la recepcion de mercancia. Mismo patron que
// /negocio-actual/identificar-producto-foto (ia-server.js): Haiku,
// nunca se guarda la foto, la IA solo propone texto -- el candidato de
// cada renglon sigue saliendo de resolverConceptoFactura contra datos
// reales, nunca de lo que "cree" el modelo.
const SYSTEM_PROMPT_EXTRAER_REMISION = `Ayudas a un empleado de una ferreteria mexicana a registrar mercancia que acaba de recibir de un proveedor, a partir de una foto de la nota de remision (o documento similar) que trajo el repartidor junto con el pedido.

Responde UNICAMENTE con un JSON (sin texto extra, sin fences de markdown) con esta forma exacta:
{"proveedor": "..." o null, "folio": "..." o null, "fecha": "AAAA-MM-DD" o null, "items": [{"codigo": "..." o null, "descripcion": "...", "cantidad": numero, "costoUnitario": numero o null}]}

Reglas:
- "proveedor": el nombre del proveedor/distribuidor impreso en la hoja (ej. "GAFI"), null si no es legible.
- "folio": el numero de remision/nota/factura impreso, null si no es legible.
- "fecha": la fecha del documento en formato AAAA-MM-DD, null si no es legible o no aparece.
- "items": una fila por cada renglon real de la tabla de productos -- nunca inventes un renglon que no este impreso, nunca combines dos renglones en uno, nunca omitas uno por estar borroso (mejor con datos incompletos que faltante).
- "codigo": el codigo/clave de ESE renglon tal cual esta impreso, null si no es legible -- nunca lo inventes ni lo copies de otro renglon.
- "cantidad": siempre un numero; si no es legible, usa 0.
- "costoUnitario": el precio unitario de ESE renglon si es legible, null si no aparece o no se puede leer con certeza -- nunca lo calcules dividiendo el importe entre la cantidad si el precio unitario mismo no esta impreso.
- Si la foto no muestra una tabla de productos reconocible, responde con "items": [].`;

async function extraerRemisionDeFoto(imagenBase64) {
    const anthropic = obtenerAnthropic();
    if (!anthropic) {
        const error = new Error("Nexo IA todavia no esta configurado en este servidor");
        error.httpStatus = 503;
        throw error;
    }

    const coincidenciaDataUrl = String(imagenBase64 || "").match(/^data:image\/[a-zA-Z0-9.+-]+;base64,(.+)$/);
    if (!coincidenciaDataUrl) {
        const error = new Error("Falta la foto o el formato no es valido");
        error.httpStatus = 400;
        throw error;
    }

    // 1600px (mas que los 1024 de identificar-producto-foto): ahi se
    // busca leer una pieza sola de cerca, aqui hace falta que una tabla
    // completa de renglones siga siendo legible. Nunca se persiste,
    // solo vive en memoria durante esta llamada.
    const bufferOriginal = Buffer.from(coincidenciaDataUrl[1], "base64");
    const bufferParaIA = await sharp(bufferOriginal)
        .resize({ width: 1600, withoutEnlargement: true })
        .jpeg({ quality: 85 })
        .toBuffer();

    const respuesta = await anthropic.messages.create({
        model: "claude-haiku-4-5",
        max_tokens: 2000,
        system: SYSTEM_PROMPT_EXTRAER_REMISION,
        messages: [{
            role: "user",
            content: [
                { type: "image", source: { type: "base64", media_type: "image/jpeg", data: bufferParaIA.toString("base64") } },
                { type: "text", text: "Lee esta nota de remision y extrae sus renglones." }
            ]
        }]
    });

    const texto = respuesta.content
        .filter(bloque => bloque.type === "text")
        .map(bloque => bloque.text)
        .join("")
        .trim();

    const coincidenciaObjeto = texto.match(/\{[\s\S]*\}/);
    let salidaIA = {};
    try {
        salidaIA = JSON.parse(coincidenciaObjeto ? coincidenciaObjeto[0] : texto);
    } catch (error) {
        salidaIA = {};
    }

    const items = Array.isArray(salidaIA?.items)
        ? salidaIA.items
            .map(item => ({
                codigo: typeof item?.codigo === "string" ? item.codigo.trim().slice(0, 80) : "",
                descripcion: typeof item?.descripcion === "string" ? item.descripcion.trim().slice(0, 300) : "",
                cantidad: num(item?.cantidad),
                costoUnitario: Number.isFinite(Number(item?.costoUnitario)) ? Number(item.costoUnitario) : null
            }))
            .filter(item => item.descripcion)
        : [];

    return {
        proveedor: typeof salidaIA?.proveedor === "string" ? salidaIA.proveedor.trim().slice(0, 120) : "",
        folio: typeof salidaIA?.folio === "string" ? salidaIA.folio.trim().slice(0, 60) : "",
        fecha: /^\d{4}-\d{2}-\d{2}$/.test(salidaIA?.fecha || "") ? salidaIA.fecha : null,
        items
    };
}

// Guarda lo que la IA extrajo de la foto como una recepcion mas, con el
// mismo pipeline de revision/matching que ya usan las facturas CFDI --
// nunca aplica stock aqui: eso solo pasa al confirmar (mismo principio
// del archivo completo).
async function procesarRemisionFoto(pool, negocioId, extraido, { empleadoId = null } = {}) {
    const items = Array.isArray(extraido?.items) ? extraido.items : [];
    if (!items.length) {
        const error = new Error("No se reconocio ningun producto en la foto");
        error.httpStatus = 400;
        throw error;
    }

    const proveedorId = extraido.proveedor
        ? await resolverOcrearProveedorId(pool, negocioId, extraido.proveedor)
        : null;

    const conceptos = items.map(item => ({
        codigo: item.codigo || "",
        claveProdServ: "",
        descripcion: item.descripcion,
        cantidad: item.cantidad,
        unidad: "pieza",
        costo: item.costoUnitario || 0,
        importe: (Number(item.cantidad) || 0) * (Number(item.costoUnitario) || 0),
        descuento: 0
    }));

    const client = await pool.connect();
    try {
        await client.query("BEGIN");

        const recepcion = await client.query(
            `INSERT INTO public.recepciones_inteligentes
                (negocio_id, origen, proveedor_id, nombre_emisor, folio, fecha_documento, total)
             VALUES ($1,'remision_foto',$2,$3,$4,$5,$6)
             RETURNING id`,
            [
                negocioId, proveedorId, extraido.proveedor || "", extraido.folio || "", extraido.fecha,
                conceptos.reduce((suma, c) => suma + num(c.importe), 0)
            ]
        );
        const recepcionId = recepcion.rows[0].id;

        const identificados = await insertarItemsRecepcionInteligente(pool, client, negocioId, recepcionId, conceptos);

        await client.query("COMMIT");

        await registrarBitacora(pool, negocioId, empleadoId, "recepcion_inteligente_detectada", {
            recepcionId, proveedor: extraido.proveedor, folio: extraido.folio,
            conceptos: conceptos.length, identificados, origen: "remision_foto"
        });

        return {
            recepcionId,
            proveedorResuelto: Boolean(proveedorId),
            totalConceptos: conceptos.length,
            identificados,
            porRevisar: conceptos.length - identificados
        };
    } catch (error) {
        await client.query("ROLLBACK").catch(() => {});
        throw error;
    } finally {
        client.release();
    }
}

// Conciliacion remision <-> CFDI (Fase 5): antes de aplicar stock por
// una factura real, hay que saber si ese mismo pedido ya se recibio por
// una remision (stock ya aplicado entonces) para no duplicarlo. Solo
// mira el mismo proveedor con una recepcion de mercancia todavia sin
// factura, en una ventana de tiempo razonable -- nunca decide sola cual
// es "la correcta": regresa la mas reciente y, si hay mas de una
// posible, lo dice, para que una persona confirme o descarte.
const DIAS_VENTANA_CONCILIACION_REMISION = 20;

async function buscarRemisionPendienteConciliable(pool, negocioId, proveedorId) {
    if (!proveedorId) return null;

    // El camino real hoy (remision por foto, Fase 5) resuelve su propio
    // proveedor_id en recepciones_inteligentes y queda ligada a la
    // recepcion_mercancia que crea al confirmarse -- se busca por ahi.
    // Una remision futura registrada por otro medio (ej. a mano, sin
    // pasar por Recepcion Inteligente) no entra todavia a este
    // emparejamiento -- se puede sumar despues sin tocar esta funcion.
    const candidatas = await pool.query(
        `SELECT rm.id, rm.referencia, rm.fecha_documento, rm.total, rm.created_at
         FROM public.recepciones_mercancia rm
         JOIN public.recepciones_inteligentes ri ON ri.recepcion_mercancia_id = rm.id
         WHERE rm.negocio_id = $1
           AND rm.estado = 'recibido_sin_factura'
           AND ri.proveedor_id = $2
           AND rm.created_at > NOW() - INTERVAL '${DIAS_VENTANA_CONCILIACION_REMISION} days'
         ORDER BY rm.created_at DESC`,
        [negocioId, proveedorId]
    );

    if (!candidatas.rows.length) return null;

    const items = await pool.query(
        `SELECT codigo, nombre, cantidad, costo FROM public.recepciones_mercancia_items WHERE recepcion_id = $1 ORDER BY id`,
        [candidatas.rows[0].id]
    );

    return {
        recepcionMercanciaId: candidatas.rows[0].id,
        referencia: candidatas.rows[0].referencia,
        fechaDocumento: candidatas.rows[0].fecha_documento,
        total: num(candidatas.rows[0].total),
        items: items.rows.map(i => ({ codigo: i.codigo, nombre: i.nombre, cantidad: num(i.cantidad), costo: num(i.costo) })),
        otrasPendientes: candidatas.rows.length - 1
    };
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

    // Fase 5: registrar una remision a partir de una foto -- para no
    // frenar la mercancia mientras se espera el CFDI real (puede llegar
    // dias despues). Mismo candado de plan que ya usa
    // /negocio-actual/identificar-producto-foto: sin IA disponible en
    // este plan, se responde con claridad en vez de dejar la pantalla
    // colgada.
    app.post(
        "/recepcion-inteligente/remision-foto",
        requerirAccesoNegocio,
        requerirPermiso(PERMISOS.MODIFICAR_INVENTARIO),
        async (req, res) => {
            try {
                const negocio = await negocioActual(req, pool);
                const acceso = await licenciaDelNegocio(pool, negocio.id);

                if (!acceso.iaDisponible) {
                    res.json({ ok: true, disponible: false });
                    return;
                }

                const extraido = await extraerRemisionDeFoto(req.body?.imagenBase64);
                const resultado = await procesarRemisionFoto(pool, negocio.id, extraido, {
                    empleadoId: empleadoIdDeRequest(req)
                });

                res.json({ ok: true, disponible: true, proveedorDetectado: extraido.proveedor, folioDetectado: extraido.folio, ...resultado });
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
                    `SELECT r.id, r.nombre_emisor, r.folio, r.total, r.estado, r.origen, r.created_at, r.confirmada_en,
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
                        origen: fila.origen,
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

                // Precio de venta sugerido para conceptos que todavia no
                // tienen decision (van a "crear" un producto nuevo): costo
                // neto (con el tramo de descuento del proveedor si tiene
                // uno configurado, Fase 7) mas SU margen general (Precios
                // por proveedor) y redondeo. Por margen de categoria/
                // producto no se sugiere aqui todavia -- un renglon de
                // factura (CFDI o remision) no trae una categoria real
                // con la que cruzar (ClaveProdServ es una clasificacion
                // generica del SAT, nunca una categoria de Nexo), asi que
                // solo el margen general tiene una señal confiable. Nunca
                // se aplica solo: sigue siendo una SUGERENCIA que el
                // dueño ve y puede cambiar al decidir "crear".
                let reglaPrecioProveedor = null;
                if (fila.nombre_emisor) {
                    const reglaFila = await pool.query(
                        `SELECT margen_general, redondeo, tramos_descuento FROM public.reglas_precios_proveedor
                         WHERE negocio_id = $1 AND LOWER(TRIM(proveedor)) = LOWER(TRIM($2))`,
                        [negocio.id, fila.nombre_emisor]
                    );
                    reglaPrecioProveedor = reglaFila.rows[0] || null;
                }
                // El tramo de descuento (Fase 7) solo aplica sobre una
                // factura real -- una remision trae costos estimados por
                // IA, sin descuento de por medio todavia.
                const tramosParaSugerencia = fila.origen !== "remision_foto" ? (reglaPrecioProveedor?.tramos_descuento || []) : [];

                function precioSugeridoParaItem(costoUnitario) {
                    if (!reglaPrecioProveedor || reglaPrecioProveedor.margen_general == null || reglaPrecioProveedor.margen_general === "") {
                        return null;
                    }
                    const { costoNeto } = costoNetoConDescuento(costoUnitario, tramosParaSugerencia, fila.total);
                    const margen = Number(reglaPrecioProveedor.margen_general);
                    return aplicarRedondeo(costoNeto * (1 + margen / 100), reglaPrecioProveedor.redondeo || "ninguno");
                }
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
                        precioVentaNuevoProducto: item.precio_venta_nuevo_producto != null ? Number(item.precio_venta_nuevo_producto) : null,
                        precioSugerido: item.accion ? null : precioSugeridoParaItem(Number(item.costo_unitario))
                    }))
                });
            } catch (error) {
                responderError(res, error);
            }
        }
    );

    // Fase 5: antes de confirmar una factura real, la pantalla pregunta
    // aqui si hay una remision de este mismo proveedor que ya se recibio
    // y todavia espera factura -- para mostrar la comparacion ANTES de
    // que el dueño decida, no despues. Nunca decide sola cual es "la
    // correcta".
    app.get(
        "/recepcion-inteligente/facturas/:id/posible-conciliacion",
        requerirAccesoNegocio,
        requerirPermiso(PERMISOS.MODIFICAR_INVENTARIO),
        async (req, res) => {
            try {
                const negocio = await negocioActual(req, pool);

                const recepcion = await pool.query(
                    `SELECT proveedor_id, origen FROM public.recepciones_inteligentes WHERE id = $1 AND negocio_id = $2`,
                    [req.params.id, negocio.id]
                );
                if (!recepcion.rows.length) {
                    res.status(404).json({ ok: false, error: "Recepcion no encontrada" });
                    return;
                }

                // Una remision por foto no puede "conciliar" con otra
                // remision -- solo aplica cuando lo que se esta por
                // confirmar es una factura real.
                if (recepcion.rows[0].origen === "remision_foto") {
                    res.json({ ok: true, remisionPendiente: null });
                    return;
                }

                const remisionPendiente = await buscarRemisionPendienteConciliable(pool, negocio.id, recepcion.rows[0].proveedor_id);
                res.json({ ok: true, remisionPendiente });
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
                const { accion, productoId, nombreNuevoProducto, precioVenta, unidadSuelta, precioPieza } = req.body || {};

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

                // Venta suelta (tornillos/pijas/taquetes/alambre por kilo o
                // pieza, aparte del contenedor completo) es opcional: solo
                // se guarda unidad valida con precio > 0 -- unidadSuelta sin
                // precio (o al reves) no activa nada, igual que "Agregar
                // producto".
                const unidadesSueltaValidas = ["pieza", "kg", "gramo", "litro", "metro"];
                const unidadSueltaLimpia = unidadesSueltaValidas.includes(unidadSuelta) && Number(precioPieza) > 0
                    ? unidadSuelta
                    : null;
                const precioPiezaLimpio = unidadSueltaLimpia ? Number(precioPieza) : null;

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
                         precio_venta_nuevo_producto = CASE WHEN $1 = 'crear' THEN $4::numeric ELSE NULL END,
                         unidad_suelta_nuevo_producto = CASE WHEN $1 = 'crear' THEN $8::text ELSE NULL END,
                         precio_pieza_nuevo_producto = CASE WHEN $1 = 'crear' THEN $9::numeric ELSE NULL END
                     WHERE id = $5 AND recepcion_id = $6 AND negocio_id = $7
                     RETURNING id`,
                    [
                        accion, productoId || null, String(nombreNuevoProducto || "").trim(),
                        accion === "crear" ? Number(precioVenta) : null,
                        req.params.itemId, req.params.id, negocio.id,
                        unidadSueltaLimpia, precioPiezaLimpio
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

                // Fase 5: una factura real (nunca una remision por foto,
                // que no tiene con que conciliar) puede corresponder a
                // una remision de este mismo proveedor que ya se recibio
                // y ya aplico su stock. Sin este paso, confirmar el CFDI
                // volveria a sumar el mismo stock una segunda vez.
                //
                // Nunca se decide sola: si no viene body.conciliarConRecepcionMercanciaId
                // (la pantalla ya lo pidio explicitamente, tras mostrar
                // la comparacion via GET .../posible-conciliacion) ni
                // body.ignorarConciliacion (el dueño ya dijo "no, es
                // distinta"), y SI existe una remision pendiente, se
                // aborta con 409 para que la pantalla pregunte primero.
                const conciliarConId = Number(req.body?.conciliarConRecepcionMercanciaId) || null;
                let remisionAConciliar = null;

                if (recepcion.rows[0].origen !== "remision_foto" && !req.body?.ignorarConciliacion) {
                    if (conciliarConId) {
                        const fila = await client.query(
                            `SELECT id FROM public.recepciones_mercancia
                             WHERE id = $1 AND negocio_id = $2 AND estado = 'recibido_sin_factura' FOR UPDATE`,
                            [conciliarConId, negocio.id]
                        );
                        if (!fila.rows.length) {
                            await client.query("ROLLBACK");
                            res.status(400).json({ ok: false, error: "La remision indicada ya no esta pendiente de conciliar" });
                            return;
                        }
                        remisionAConciliar = fila.rows[0];
                    } else {
                        const posible = await buscarRemisionPendienteConciliable(pool, negocio.id, recepcion.rows[0].proveedor_id);
                        if (posible) {
                            await client.query("ROLLBACK");
                            res.status(409).json({ ok: false, requiereConciliacion: true, remisionPendiente: posible });
                            return;
                        }
                    }
                }

                // Fase 7: tramo de descuento por monto de factura -- SOLO
                // si este proveedor (por nombre, mismo criterio que ya usa
                // GET /reglas-precios/:proveedor) tiene tramos configurados
                // a proposito desde la pantalla de Precios por proveedor.
                // Un proveedor sin tramos (TRUPER, Diprofer, cualquiera que
                // el dueño no haya configurado) sigue exactamente igual que
                // antes de esta fase -- nunca se activa solo. Nunca aplica
                // sobre una remision (costos estimados por IA, todavia sin
                // documento fiscal real).
                let tramosDescuentoProveedor = [];
                if (recepcion.rows[0].origen !== "remision_foto" && recepcion.rows[0].nombre_emisor) {
                    const reglaPrecios = await pool.query(
                        `SELECT tramos_descuento FROM public.reglas_precios_proveedor
                         WHERE negocio_id = $1 AND LOWER(TRIM(proveedor)) = LOWER(TRIM($2))`,
                        [negocio.id, recepcion.rows[0].nombre_emisor]
                    );
                    tramosDescuentoProveedor = reglaPrecios.rows[0]?.tramos_descuento || [];
                }

                let tramoDescuentoAplicado = null;
                let totalAplicado = 0;
                const itemsAplicados = [];

                for (const item of items.rows) {
                    if (item.accion === "omitir") continue;

                    const cantidad = num(item.cantidad);
                    const costoLista = num(item.costo_unitario);
                    const { costoNeto, tramoAplicado } = costoNetoConDescuento(costoLista, tramosDescuentoProveedor, recepcion.rows[0].total);
                    if (tramoAplicado) tramoDescuentoAplicado = tramoAplicado;
                    const costo = costoNeto;
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

                        // Venta suelta (tornillos/pijas/taquetes/alambre que
                        // ademas del bulto se venden por kilo/pieza/metro a
                        // un precio propio, capturado en "Crear producto" --
                        // ver 20261008_recepcion_crear_producto_venta_pieza.sql).
                        // Sin esto quedaba pendiente ir a Inventario despues
                        // solo para activarla.
                        const unidadSuelta = item.unidad_suelta_nuevo_producto || null;
                        const precioPieza = item.precio_pieza_nuevo_producto != null ? num(item.precio_pieza_nuevo_producto) : null;

                        const nuevo = await client.query(
                            `INSERT INTO public.productos
                                (negocio_id, nombre, codigo, precio, precio_publico, precio_mayoreo, precio_distribuidor,
                                 stock, marca, proveedor_id, catalogo_maestro_id,
                                 permite_venta_pieza, unidad_suelta, precio_pieza, precio_pieza_publico)
                             VALUES ($1,$2,$3,$4,$4,$4,$5,0,$6,$7,$8,$9,$10,$11,$11)
                             RETURNING id`,
                            [
                                negocio.id, nombre, item.codigo_factura || "", precioVenta, costo,
                                candidato.marca || null, recepcion.rows[0].proveedor_id, catalogoMaestroId,
                                Boolean(unidadSuelta), unidadSuelta || "pieza", precioPieza
                            ]
                        );
                        productoId = nuevo.rows[0].id;

                        await client.query(
                            `UPDATE public.recepciones_inteligentes_items SET producto_id = $1 WHERE id = $2`,
                            [productoId, item.id]
                        );

                        // Fase 9 de identidad multi-proveedor (prioridad de
                        // fuente de imagen): si ese codigo ya tiene una foto
                        // en el catalogo de este proveedor (ej. extraida del
                        // PDF de GAFI), se copia sola al producto nuevo --
                        // antes se creaba siempre sin foto aunque el sistema
                        // ya la tuviera guardada. Nunca pisa una foto que el
                        // negocio ya haya subido a mano (esto es un INSERT
                        // hacia un codigo que hasta este momento no existia
                        // en fotos_producto, no una actualizacion).
                        if (item.codigo_factura) {
                            const fotoCatalogo = await client.query(
                                `SELECT imagen, imagen_tipo FROM public.catalogo_productos
                                 WHERE negocio_id = $1
                                   AND (codigo_proveedor = $2 OR NULLIF(codigo_interno, '') = $2 OR NULLIF(codigo_barras, '') = $2)
                                   AND imagen IS NOT NULL
                                 ORDER BY updated_at DESC LIMIT 1`,
                                [negocio.id, item.codigo_factura]
                            );
                            if (fotoCatalogo.rows.length) {
                                await client.query(
                                    `INSERT INTO public.fotos_producto (negocio_id, codigo, imagen_principal, imagen_principal_tipo, actualizado_at)
                                     VALUES ($1, $2, $3, $4, NOW())
                                     ON CONFLICT (negocio_id, codigo) DO UPDATE SET
                                         imagen_principal = EXCLUDED.imagen_principal, imagen_principal_tipo = EXCLUDED.imagen_principal_tipo, actualizado_at = NOW()`,
                                    [negocio.id, item.codigo_factura, fotoCatalogo.rows[0].imagen, fotoCatalogo.rows[0].imagen_tipo || "image/jpeg"]
                                );
                            }
                        }
                    } else if (item.accion === "relacionar") {
                        const candidato = item.candidato || {};
                        await client.query(
                            `UPDATE public.productos
                             SET catalogo_maestro_id = COALESCE(catalogo_maestro_id, $1)
                             WHERE id = $2 AND negocio_id = $3`,
                            [candidato.catalogoMaestroId || null, productoId, negocio.id]
                        );
                    }

                    if (remisionAConciliar) {
                        // El stock de este renglon ya se sumo cuando se
                        // recibio la remision -- aqui solo se corrige el
                        // costo si la factura real trae uno distinto,
                        // nunca se vuelve a sumar la cantidad.
                        // 0::numeric, nunca 0 a secas: con el literal sin
                        // tipo, Postgres decide que $1 es entero DENTRO del
                        // NULLIF (antes de que el COALESCE de afuera sepa
                        // que va a una columna numeric) -- un costo neto con
                        // descuento (Fase 7, ej. 114.4) tronaba "invalid
                        // input syntax for type integer" aunque la columna
                        // siempre fue numeric.
                        await client.query(
                            `UPDATE public.productos
                             SET precio_distribuidor = COALESCE(NULLIF($1, 0::numeric), precio_distribuidor)
                             WHERE id = $2 AND negocio_id = $3`,
                            [costo, productoId, negocio.id]
                        );
                    } else {
                        await client.query(
                            `UPDATE public.productos
                             SET stock = stock + $1,
                                 precio_distribuidor = COALESCE(NULLIF($2, 0::numeric), precio_distribuidor)
                             WHERE id = $3 AND negocio_id = $4`,
                            [cantidad, costo, productoId, negocio.id]
                        );
                    }

                    totalAplicado += cantidad * costo;
                    itemsAplicados.push({ productoId, codigo: item.codigo_factura, nombre: item.descripcion, cantidad, costo });
                }

                let recepcionMercanciaId;

                if (remisionAConciliar) {
                    recepcionMercanciaId = remisionAConciliar.id;

                    await client.query(
                        `UPDATE public.recepciones_mercancia
                         SET estado = 'conciliado', notas = notas || $2
                         WHERE id = $1`,
                        [recepcionMercanciaId, ` -- conciliada con factura ${recepcion.rows[0].folio || recepcion.rows[0].uuid_cfdi || "(sin folio)"}`]
                    );

                    for (const item of itemsAplicados) {
                        await client.query(
                            `UPDATE public.recepciones_mercancia_items SET costo = $1 WHERE recepcion_id = $2 AND producto_id = $3`,
                            [item.costo, recepcionMercanciaId, item.productoId]
                        );
                    }
                } else {
                    const tipoDocumento = recepcion.rows[0].origen === "remision_foto" ? "remision" : "factura";
                    const estadoMercancia = recepcion.rows[0].origen === "remision_foto" ? "recibido_sin_factura" : "conciliado";

                    const recepcionMercancia = await client.query(
                        `INSERT INTO public.recepciones_mercancia
                            (negocio_id, proveedor, referencia, notas, total, fecha_documento, tipo_documento, estado)
                         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
                         RETURNING id`,
                        [
                            negocio.id,
                            recepcion.rows[0].nombre_emisor || "",
                            recepcion.rows[0].folio || "",
                            "Recepcion Inteligente",
                            totalAplicado,
                            recepcion.rows[0].fecha_documento,
                            tipoDocumento,
                            estadoMercancia
                        ]
                    );
                    recepcionMercanciaId = recepcionMercancia.rows[0].id;

                    for (const item of itemsAplicados) {
                        await client.query(
                            `INSERT INTO public.recepciones_mercancia_items
                                (negocio_id, recepcion_id, producto_id, codigo, nombre, cantidad, costo)
                             VALUES ($1,$2,$3,$4,$5,$6,$7)`,
                            [negocio.id, recepcionMercanciaId, item.productoId, item.codigo, item.nombre, item.cantidad, item.costo]
                        );
                    }
                }

                await client.query(
                    `UPDATE public.recepciones_inteligentes
                     SET estado = 'confirmada', confirmada_en = NOW(),
                         revisado_por_empleado_id = $1, recepcion_mercancia_id = $2
                     WHERE id = $3`,
                    [empleadoIdDeRequest(req), recepcionMercanciaId, req.params.id]
                );

                await client.query("COMMIT");

                await registrarBitacora(pool, negocio.id, empleadoIdDeRequest(req),
                    remisionAConciliar ? "recepcion_inteligente_conciliada" : "recepcion_inteligente_confirmada",
                    {
                        recepcionId: Number(req.params.id), recepcionMercanciaId, totalAplicado,
                        itemsAplicados: itemsAplicados.length, itemsOmitidos: items.rows.length - itemsAplicados.length,
                        conciliadaConRemision: Boolean(remisionAConciliar),
                        tramoDescuentoAplicado
                    }
                );

                res.json({ ok: true, recepcionMercanciaId, totalAplicado, conciliada: Boolean(remisionAConciliar), tramoDescuentoAplicado });
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

// Expuestos para probar la Fase 5 (remision por foto + conciliacion)
// directo, sin depender de una respuesta real de Claude para cada
// prueba -- el parseo de la foto (extraerRemisionDeFoto) es la unica
// parte que de verdad necesita la API real.
module.exports.procesarRemisionFoto = procesarRemisionFoto;
module.exports.buscarRemisionPendienteConciliable = buscarRemisionPendienteConciliable;
