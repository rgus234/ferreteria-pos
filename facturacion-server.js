// Facturacion electronica (CFDI 4.0 real, via Facturama): identidad
// fiscal del negocio, subida de CSD, y timbrado de una venta ya hecha.
//
// Limites honestos de v1 (documentados, no bugs silenciosos):
// - IVA 16% parejo sobre cada linea -- "productos" no tiene columna de
//   tasa de impuesto hoy, correcto para una ferreteria.
// - Solo ventas SIN descuento -- prorratear un descuento de venta entre
//   lineas para CFDI es una fuente real de errores de redondeo/legales:
//   mejor rechazar con un mensaje claro que facturar mal.
// - Solo ventas que NO son a credito -- una venta a credito es pago
//   diferido (PPD), que en CFDI 4.0 exige un Complemento de Pago
//   separado cuando se liquida. Eso es un modulo aparte, no construido
//   todavia; aqui solo se cubre PUE (pago en una sola exhibicion).
const crypto = require("crypto");
const multer = require("multer");
const { responderError } = require("./error-utils");
const { cargarCsd, crearCfdi, descargarXmlCfdi } = require("./facturama-client");
const { negocioIdDeRequest, requerirFuncionPlan, funcionDelPlan } = require("./plan-enforcement");

const PATRON_RFC = /\b([A-ZÑ&]{3,4}\d{6}[A-Z0-9]{3})\b/;
const PATRON_RFC_COMPLETO = /^[A-ZÑ&]{3,4}\d{6}[A-Z0-9]{3}$/;

const RFC_PUBLICO_GENERAL = "XAXX010101000";
const TASA_IVA = 0.16;

function limpiarTexto(valor, max = 160) {
    return String(valor || "")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, max);
}

function redondear(valor) {
    return Math.round((Number(valor) || 0) * 100) / 100;
}

// Divide un importe CON IVA (como se guarda todo en este sistema) en
// base + iva. El iva se define como el RESIDUO (importe - base), nunca
// se calcula por separado -- asi base+iva siempre reconstruye el
// importe original exacto al centavo, sin arrastrar error de
// redondeo entre lineas.
function partirImporteConIva(importeConIva) {
    const base = redondear(importeConIva / (1 + TASA_IVA));
    const iva = redondear(importeConIva - base);
    return { base, iva };
}

// c_FormaPago del SAT -- solo los valores que de verdad puede producir
// este POS (ver limite "solo PUE" arriba: nunca credito).
function formaPagoSat(metodoPago) {
    const mapa = { efectivo: "01", tarjeta: "04", transferencia: "03" };
    return mapa[String(metodoPago || "").toLowerCase()] || "99";
}

// Arma los Items[] que espera Facturama a partir de historial_ventas.productos.
// Devuelve null si la venta no se puede facturar en v1 (ver limites arriba).
function armarConceptosFactura(productos, claveProdServ, claveUnidad) {
    if (!Array.isArray(productos) || productos.length === 0) return null;

    return productos.map(p => {
        const cantidad = Number(p.cantidad) || 1;
        const importeConIva = Number(p.importe ?? (Number(p.precio || 0) * cantidad));
        const { base, iva } = partirImporteConIva(importeConIva);
        const valorUnitario = Math.round((base / cantidad) * 1e6) / 1e6;

        return {
            ProductCode: claveProdServ,
            Description: String(p.nombre || "Producto").slice(0, 1000),
            UnitCode: claveUnidad,
            Quantity: cantidad,
            UnitPrice: valorUnitario,
            Subtotal: base,
            TaxObject: "02",
            Taxes: [{ Total: iva, Name: "IVA", Base: base, Rate: TASA_IVA, IsRetention: false }],
            Total: redondear(base + iva)
        };
    });
}

// Receptor sugerido: si la venta tiene un cliente ligado y ese cliente
// ya tiene RFC capturado, se usan sus datos fiscales reales. Si no,
// "publico en general" -- el generico que el SAT reserva exactamente
// para este caso (venta al mostrador sin RFC del comprador).
async function resolverReceptorSugerido(pool, negocioId, venta, negocio) {
    if (venta.cliente_id) {
        const cliente = (await pool.query(
            `
            SELECT nombre, rfc, razon_social, regimen_fiscal, codigo_postal_fiscal,
                   uso_cfdi_preferido, correo_facturacion
            FROM public.clientes_credito
            WHERE id = $1 AND negocio_id = $2
            `,
            [venta.cliente_id, negocioId]
        )).rows[0];

        if (cliente?.rfc && PATRON_RFC_COMPLETO.test(cliente.rfc)) {
            return {
                rfc: cliente.rfc,
                nombre: cliente.razon_social || cliente.nombre,
                usoCfdi: cliente.uso_cfdi_preferido || "G03",
                regimenFiscal: cliente.regimen_fiscal || "",
                codigoPostal: cliente.codigo_postal_fiscal || negocio.codigo_postal_fiscal || "",
                correo: cliente.correo_facturacion || "",
                esGenerico: false
            };
        }
    }

    return {
        rfc: RFC_PUBLICO_GENERAL,
        nombre: "PUBLICO EN GENERAL",
        usoCfdi: "S01",
        regimenFiscal: "616",
        codigoPostal: negocio.codigo_postal_fiscal || "",
        correo: "",
        esGenerico: true
    };
}

// El .cer de un CSD es publico -- se puede leer sin la contrasena de la
// llave privada. Se valida AQUI, antes de gastar la llamada a Facturama,
// para dar un mensaje claro e inmediato en los 2 errores mas comunes al
// subir un CSD: subir uno vencido, o subir el de otro RFC (confundirlo
// con el de otro negocio o con la e.firma).
function validarCertificadoLocal(cerBuffer, rfcEsperado) {
    let cert;
    try {
        cert = new crypto.X509Certificate(cerBuffer);
    } catch (error) {
        return { ok: false, error: "El archivo .cer no es un certificado valido" };
    }

    const vigenciaDesde = new Date(cert.validFrom);
    const vigenciaHasta = new Date(cert.validTo);

    if (Number.isNaN(vigenciaHasta.getTime())) {
        return { ok: false, error: "No se pudo leer la vigencia del certificado" };
    }

    const ahora = new Date();

    if (ahora > vigenciaHasta) {
        return {
            ok: false,
            error: `Este certificado ya vencio (vigencia hasta ${vigenciaHasta.toLocaleDateString("es-MX")}). Descarga uno vigente desde el portal del SAT.`
        };
    }

    if (ahora < vigenciaDesde) {
        return { ok: false, error: "Este certificado todavia no entra en vigencia" };
    }

    const coincidenciaRfc = cert.subject.match(PATRON_RFC);
    const rfcCertificado = coincidenciaRfc ? coincidenciaRfc[1] : null;

    if (!rfcCertificado) {
        return { ok: false, error: "No se pudo leer el RFC dentro del certificado" };
    }

    if (rfcEsperado && rfcCertificado !== rfcEsperado.toUpperCase()) {
        return {
            ok: false,
            error: `Este certificado es del RFC ${rfcCertificado}, pero el negocio tiene capturado ${rfcEsperado}. Verifica que sea el CSD correcto.`
        };
    }

    let numeroSerie;
    try {
        numeroSerie = BigInt(`0x${cert.serialNumber}`).toString(10).padStart(20, "0");
    } catch (error) {
        numeroSerie = cert.serialNumber;
    }

    return { ok: true, rfc: rfcCertificado, numeroSerie, vigenciaDesde, vigenciaHasta };
}

const uploadCsd = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 2 * 1024 * 1024, files: 2 }
});

function manejarSubidaCsd(req, res, next) {
    uploadCsd.fields([{ name: "cer", maxCount: 1 }, { name: "key", maxCount: 1 }])(req, res, error => {
        if (error) {
            res.status(400).json({ ok: false, error: error.message || "No se pudo procesar el archivo subido" });
            return;
        }
        next();
    });
}

module.exports = (app, pool, requerirAccesoNegocio) => {
    app.get("/facturacion/estado", requerirAccesoNegocio, async (req, res) => {
        try {
            const negocioId = negocioIdDeRequest(req);

            if (!negocioId) {
                res.status(401).json({ ok: false, error: "Este equipo no esta vinculado a ningun negocio" });
                return;
            }

            const [negocio, { incluido }] = await Promise.all([
                pool.query(
                    `
                    SELECT rfc, razon_social, regimen_fiscal, codigo_postal_fiscal,
                           facturacion_activa, facturacion_certificado_numero,
                           facturacion_certificado_vigencia_hasta, facturacion_csd_subido_at
                    FROM public.negocios WHERE id = $1
                    `,
                    [negocioId]
                ).then(r => r.rows[0]),
                funcionDelPlan(negocioId, "facturacion.cfdi")
            ]);

            res.json({ ok: true, disponibleEnPlan: incluido, ...negocio });
        } catch (error) {
            responderError(res, error);
        }
    });

    app.get("/facturacion/facturas", requerirAccesoNegocio, async (req, res) => {
        try {
            const negocioId = negocioIdDeRequest(req);

            if (!negocioId) {
                res.status(401).json({ ok: false, error: "Este equipo no esta vinculado a ningun negocio" });
                return;
            }

            const resultado = await pool.query(
                `
                SELECT id, serie, folio, uuid, estado, receptor_nombre, total, created_at, timbrada_at
                FROM public.facturas_cfdi
                WHERE negocio_id = $1
                ORDER BY created_at DESC
                LIMIT 50
                `,
                [negocioId]
            );

            res.json({ ok: true, facturas: resultado.rows });
        } catch (error) {
            responderError(res, error);
        }
    });

    // Info para abrir el modal "Generar factura" desde el detalle de una
    // venta: si ya existe una factura para esta venta, y el receptor
    // sugerido para prellenar el formulario.
    app.get("/facturacion/venta/:historialVentaId", requerirAccesoNegocio, async (req, res) => {
        try {
            const negocioId = negocioIdDeRequest(req);
            const historialVentaId = Number(req.params.historialVentaId);

            if (!negocioId) {
                res.status(401).json({ ok: false, error: "Este equipo no esta vinculado a ningun negocio" });
                return;
            }
            if (!Number.isInteger(historialVentaId)) {
                res.status(400).json({ ok: false, error: "Venta invalida" });
                return;
            }

            const [negocio, venta, facturaExistente] = await Promise.all([
                pool.query(`SELECT codigo_postal_fiscal, facturacion_activa FROM public.negocios WHERE id = $1`, [negocioId]).then(r => r.rows[0]),
                pool.query(`SELECT id, cliente_id, total, descuento, metodo_pago, requiere_factura FROM public.historial_ventas WHERE id = $1 AND negocio_id = $2`, [historialVentaId, negocioId]).then(r => r.rows[0]),
                pool.query(`SELECT id, estado, uuid, serie, folio, total, created_at FROM public.facturas_cfdi WHERE historial_venta_id = $1 AND negocio_id = $2 ORDER BY created_at DESC LIMIT 1`, [historialVentaId, negocioId]).then(r => r.rows[0] || null)
            ]);

            if (!venta) {
                res.status(404).json({ ok: false, error: "Venta no encontrada" });
                return;
            }

            const receptorSugerido = await resolverReceptorSugerido(pool, negocioId, venta, negocio || {});

            const bloqueada =
                !negocio?.facturacion_activa ? "Primero activa facturacion electronica." :
                Number(venta.descuento) > 0 ? "Esta venta tiene un descuento aplicado -- facturar ventas con descuento no esta soportado todavia." :
                String(venta.metodo_pago).toLowerCase() === "credito" ? "Las ventas a credito se facturan hasta que se liquidan (funcion en desarrollo)." :
                null;

            res.json({ ok: true, factura: facturaExistente, receptorSugerido, bloqueada });
        } catch (error) {
            responderError(res, error);
        }
    });

    app.post(
        "/facturacion/generar/:historialVentaId",
        requerirAccesoNegocio,
        requerirFuncionPlan("facturacion.cfdi", "La facturacion electronica es un complemento de pago. Actívalo desde Cuenta."),
        async (req, res) => {
            try {
                const negocioId = negocioIdDeRequest(req);
                const historialVentaId = Number(req.params.historialVentaId);

                if (!negocioId) {
                    res.status(401).json({ ok: false, error: "Este equipo no esta vinculado a ningun negocio" });
                    return;
                }
                if (!Number.isInteger(historialVentaId)) {
                    res.status(400).json({ ok: false, error: "Venta invalida" });
                    return;
                }

                const negocio = (await pool.query(
                    `
                    SELECT rfc, razon_social, regimen_fiscal, codigo_postal_fiscal, facturacion_activa,
                           facturacion_clave_prod_serv_default, facturacion_clave_unidad_default
                    FROM public.negocios WHERE id = $1
                    `,
                    [negocioId]
                )).rows[0];

                if (!negocio?.facturacion_activa) {
                    res.status(400).json({ ok: false, error: "Primero activa facturacion electronica." });
                    return;
                }

                const venta = (await pool.query(
                    `SELECT id, cliente_id, total, subtotal, descuento, metodo_pago, folio, folio_numero, productos FROM public.historial_ventas WHERE id = $1 AND negocio_id = $2`,
                    [historialVentaId, negocioId]
                )).rows[0];

                if (!venta) {
                    res.status(404).json({ ok: false, error: "Venta no encontrada" });
                    return;
                }
                if (Number(venta.descuento) > 0) {
                    res.status(400).json({ ok: false, error: "Esta venta tiene un descuento aplicado -- facturar ventas con descuento no esta soportado todavia." });
                    return;
                }
                if (String(venta.metodo_pago).toLowerCase() === "credito") {
                    res.status(400).json({ ok: false, error: "Las ventas a credito se facturan hasta que se liquidan (funcion en desarrollo)." });
                    return;
                }

                const yaTimbrada = (await pool.query(
                    `SELECT id FROM public.facturas_cfdi WHERE historial_venta_id = $1 AND negocio_id = $2 AND estado = 'timbrada' LIMIT 1`,
                    [historialVentaId, negocioId]
                )).rows[0];

                if (yaTimbrada) {
                    res.status(400).json({ ok: false, error: "Esta venta ya tiene una factura timbrada." });
                    return;
                }

                const receptorSugerido = await resolverReceptorSugerido(pool, negocioId, venta, negocio);
                const receptor = {
                    rfc: limpiarTexto(req.body?.rfc, 13).toUpperCase() || receptorSugerido.rfc,
                    nombre: limpiarTexto(req.body?.nombre, 250) || receptorSugerido.nombre,
                    usoCfdi: limpiarTexto(req.body?.usoCfdi, 4) || receptorSugerido.usoCfdi,
                    regimenFiscal: limpiarTexto(req.body?.regimenFiscal, 4) || receptorSugerido.regimenFiscal,
                    codigoPostal: limpiarTexto(req.body?.codigoPostal, 5) || receptorSugerido.codigoPostal,
                    correo: limpiarTexto(req.body?.correo, 200) || receptorSugerido.correo
                };

                if (!PATRON_RFC_COMPLETO.test(receptor.rfc) && receptor.rfc !== RFC_PUBLICO_GENERAL) {
                    res.status(400).json({ ok: false, error: "El RFC del receptor no tiene un formato valido" });
                    return;
                }
                if (!receptor.regimenFiscal) {
                    res.status(400).json({ ok: false, error: "Falta el regimen fiscal del receptor" });
                    return;
                }
                if (!/^\d{5}$/.test(receptor.codigoPostal)) {
                    res.status(400).json({ ok: false, error: "El codigo postal del receptor debe tener 5 digitos" });
                    return;
                }

                const claveProdServ = negocio.facturacion_clave_prod_serv_default || "01010101";
                const claveUnidad = negocio.facturacion_clave_unidad_default || "H87";
                const items = armarConceptosFactura(venta.productos, claveProdServ, claveUnidad);

                if (!items) {
                    res.status(400).json({ ok: false, error: "Esta venta no tiene productos que facturar." });
                    return;
                }

                const comprobante = {
                    CfdiType: "I",
                    PaymentForm: formaPagoSat(venta.metodo_pago),
                    PaymentMethod: "PUE",
                    ExpeditionPlace: negocio.codigo_postal_fiscal,
                    Folio: String(venta.folio_numero || venta.id),
                    Issuer: {
                        FiscalRegime: negocio.regimen_fiscal,
                        Rfc: negocio.rfc,
                        Name: negocio.razon_social
                    },
                    Receiver: {
                        Rfc: receptor.rfc,
                        CfdiUse: receptor.usoCfdi,
                        Name: receptor.nombre,
                        FiscalRegime: receptor.regimenFiscal,
                        TaxZipCode: receptor.codigoPostal
                    },
                    Items: items
                };

                const totalFactura = redondear(items.reduce((acc, item) => acc + item.Total, 0));
                const subtotalFactura = redondear(items.reduce((acc, item) => acc + item.Subtotal, 0));
                const creadoPor = req.negocioAutenticado?.persona_nombre || req.negocioDispositivo?.nombre || null;

                const resultado = await crearCfdi(comprobante);

                if (!resultado.ok) {
                    await pool.query(
                        `
                        INSERT INTO public.facturas_cfdi
                            (negocio_id, historial_venta_id, cliente_id, receptor_rfc, receptor_nombre, receptor_uso_cfdi,
                             receptor_regimen_fiscal, receptor_codigo_postal, receptor_correo, estado, error_mensaje,
                             subtotal, total, creado_por)
                        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'error', $10, $11, $12, $13)
                        `,
                        [negocioId, historialVentaId, venta.cliente_id, receptor.rfc, receptor.nombre, receptor.usoCfdi,
                         receptor.regimenFiscal, receptor.codigoPostal, receptor.correo || null, resultado.error,
                         subtotalFactura, totalFactura, creadoPor]
                    );

                    res.status(400).json({ ok: false, error: resultado.error });
                    return;
                }

                const factura = resultado.factura;

                // El XML puede venir inline en la respuesta de crearCfdi, o
                // haber que pedirlo aparte -- si ninguna de las dos formas lo
                // trae, el CFDI de todos modos ya quedo timbrado ante el SAT
                // (ver nota en facturama-client.js); no guardar el XML no es
                // motivo para tratar esto como un error.
                let xmlCfdi = factura.xml || null;

                if (!xmlCfdi && factura.facturamaId) {
                    const descarga = await descargarXmlCfdi(factura.facturamaId);
                    if (descarga.ok) xmlCfdi = descarga.xml;
                }

                const filaFactura = (await pool.query(
                    `
                    INSERT INTO public.facturas_cfdi
                        (negocio_id, historial_venta_id, cliente_id, receptor_rfc, receptor_nombre, receptor_uso_cfdi,
                         receptor_regimen_fiscal, receptor_codigo_postal, receptor_correo, serie, folio, uuid, estado,
                         subtotal, total, xml_cfdi, facturama_id, creado_por, timbrada_at)
                    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 'timbrada', $13, $14, $15, $16, $17, NOW())
                    RETURNING id, serie, folio, uuid, estado, total, created_at, timbrada_at
                    `,
                    [negocioId, historialVentaId, venta.cliente_id, receptor.rfc, receptor.nombre, receptor.usoCfdi,
                     receptor.regimenFiscal, receptor.codigoPostal, receptor.correo || null,
                     factura.serie, factura.folio, factura.uuid, subtotalFactura, totalFactura,
                     xmlCfdi, factura.facturamaId ? String(factura.facturamaId) : null, creadoPor]
                )).rows[0];

                res.json({ ok: true, factura: filaFactura });
            } catch (error) {
                responderError(res, error);
            }
        }
    );

    app.get("/facturacion/:id/xml", requerirAccesoNegocio, async (req, res) => {
        try {
            const negocioId = negocioIdDeRequest(req);
            const facturaId = Number(req.params.id);

            if (!negocioId) {
                res.status(401).json({ ok: false, error: "Este equipo no esta vinculado a ningun negocio" });
                return;
            }

            const factura = (await pool.query(
                `SELECT folio, xml_cfdi FROM public.facturas_cfdi WHERE id = $1 AND negocio_id = $2`,
                [facturaId, negocioId]
            )).rows[0];

            if (!factura?.xml_cfdi) {
                res.status(404).json({ ok: false, error: "No hay XML guardado para esta factura." });
                return;
            }

            res.setHeader("Content-Type", "application/xml");
            res.setHeader("Content-Disposition", `attachment; filename="factura-${factura.folio || facturaId}.xml"`);
            res.send(factura.xml_cfdi);
        } catch (error) {
            responderError(res, error);
        }
    });

    app.post("/facturacion/datos-fiscales", requerirAccesoNegocio, async (req, res) => {
        try {
            const negocioId = negocioIdDeRequest(req);

            if (!negocioId) {
                res.status(401).json({ ok: false, error: "Este equipo no esta vinculado a ningun negocio" });
                return;
            }

            const rfc = limpiarTexto(req.body?.rfc, 13).toUpperCase();
            const razonSocial = limpiarTexto(req.body?.razonSocial, 250);
            const regimenFiscal = limpiarTexto(req.body?.regimenFiscal, 10);
            const codigoPostalFiscal = limpiarTexto(req.body?.codigoPostalFiscal, 5);

            if (!PATRON_RFC_COMPLETO.test(rfc)) {
                res.status(400).json({ ok: false, error: "El RFC no tiene un formato valido" });
                return;
            }
            if (!razonSocial) {
                res.status(400).json({ ok: false, error: "Falta la razon social (debe coincidir exacto con el padron del SAT)" });
                return;
            }
            if (!regimenFiscal) {
                res.status(400).json({ ok: false, error: "Falta el regimen fiscal" });
                return;
            }
            if (!/^\d{5}$/.test(codigoPostalFiscal)) {
                res.status(400).json({ ok: false, error: "El codigo postal fiscal debe tener 5 digitos" });
                return;
            }

            await pool.query(
                `
                UPDATE public.negocios
                SET rfc = $1, razon_social = $2, regimen_fiscal = $3, codigo_postal_fiscal = $4
                WHERE id = $5
                `,
                [rfc, razonSocial, regimenFiscal, codigoPostalFiscal, negocioId]
            );

            res.json({ ok: true });
        } catch (error) {
            responderError(res, error);
        }
    });

    app.post(
        "/facturacion/csd",
        requerirAccesoNegocio,
        requerirFuncionPlan("facturacion.cfdi", "La facturacion electronica es un complemento de pago. Actívalo desde Cuenta."),
        manejarSubidaCsd,
        async (req, res) => {
            try {
                const negocioId = negocioIdDeRequest(req);
                const archivoCer = req.files?.cer?.[0];
                const archivoKey = req.files?.key?.[0];
                const password = String(req.body?.password || "");

                if (!archivoCer || !archivoKey) {
                    res.status(400).json({ ok: false, error: "Sube tanto el archivo .cer como el .key" });
                    return;
                }
                if (!password) {
                    res.status(400).json({ ok: false, error: "Falta la contrasena de la llave privada" });
                    return;
                }

                const negocio = (await pool.query(
                    `SELECT id, rfc FROM public.negocios WHERE id = $1`,
                    [negocioId]
                )).rows[0];

                if (!negocio?.rfc) {
                    res.status(400).json({ ok: false, error: "Primero captura el RFC del negocio en sus datos fiscales" });
                    return;
                }

                const validacion = validarCertificadoLocal(archivoCer.buffer, negocio.rfc);

                if (!validacion.ok) {
                    res.status(400).json({ ok: false, error: validacion.error });
                    return;
                }

                const resultado = await cargarCsd({
                    rfc: negocio.rfc,
                    certificateBase64: archivoCer.buffer.toString("base64"),
                    privateKeyBase64: archivoKey.buffer.toString("base64"),
                    password
                });

                if (!resultado.ok) {
                    res.status(400).json({ ok: false, error: resultado.error });
                    return;
                }

                const subidoPor = req.negocioAutenticado?.persona_nombre || req.negocioDispositivo?.nombre || null;
                const csdId = resultado.datos?.Id || resultado.datos?.CsdId || null;

                await pool.query(
                    `
                    UPDATE public.negocios
                    SET facturacion_activa = true,
                        facturacion_csd_id = $1,
                        facturacion_certificado_numero = $2,
                        facturacion_certificado_vigencia_hasta = $3,
                        facturacion_csd_subido_at = NOW(),
                        facturacion_csd_subido_por = $4
                    WHERE id = $5
                    `,
                    [csdId ? String(csdId) : null, validacion.numeroSerie, validacion.vigenciaHasta, subidoPor, negocioId]
                );

                res.json({
                    ok: true,
                    numeroSerie: validacion.numeroSerie,
                    vigenciaHasta: validacion.vigenciaHasta
                });
            } catch (error) {
                responderError(res, error);
            }
        }
    );
};

module.exports.validarCertificadoLocal = validarCertificadoLocal;
module.exports.partirImporteConIva = partirImporteConIva;
module.exports.armarConceptosFactura = armarConceptosFactura;
module.exports.resolverReceptorSugerido = resolverReceptorSugerido;
module.exports.formaPagoSat = formaPagoSat;
