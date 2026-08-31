// Facturacion electronica (CFDI 4.0 real, via Facturama). Este modulo
// solo cubre la identidad fiscal del negocio y la subida del CSD -- la
// pieza mas delicada, por eso va sola y solida antes de tocar nada de
// UI de "generar factura" encima (ver plan). Timbrar CFDIs de ventas
// especificas es un modulo/endpoint aparte, todavia no construido.
const crypto = require("crypto");
const multer = require("multer");
const { responderError } = require("./error-utils");
const { cargarCsd } = require("./facturama-client");
const { negocioIdDeRequest, requerirFuncionPlan, funcionDelPlan } = require("./plan-enforcement");

const PATRON_RFC = /\b([A-ZÑ&]{3,4}\d{6}[A-Z0-9]{3})\b/;
const PATRON_RFC_COMPLETO = /^[A-ZÑ&]{3,4}\d{6}[A-Z0-9]{3}$/;

function limpiarTexto(valor, max = 160) {
    return String(valor || "")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, max);
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
