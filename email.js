// Correo transaccional (verificacion de cuenta, recuperacion de
// contrasena, activacion) via Resend. Si RESEND_API_KEY no esta
// configurada, las funciones de envio no truenan -- solo avisan en
// consola y regresan { ok: false } para que quien las llame decida
// que hacer (el registro/login no deben fallar por un correo que no
// se pudo mandar).

const { Resend } = require("resend");

const remitente =
    process.env.RESEND_FROM || "onboarding@resend.dev";

// Dominio publico fijo para las imagenes del correo -- un cliente de
// correo nunca puede cargar localhost, asi que aqui siempre se usa el
// dominio real sin importar en que entorno corre el servidor.
const DOMINIO_PUBLICO = "https://nexoposoficial.com";

let clienteResend = null;

function obtenerClienteResend() {
    if (!process.env.RESEND_API_KEY) return null;

    if (!clienteResend) {
        clienteResend = new Resend(process.env.RESEND_API_KEY);
    }

    return clienteResend;
}

function envolverPlantilla(etiqueta, tituloPrincipal, cuerpoHtml) {
    return `
    <!doctype html>
    <html lang="es">
    <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <meta name="color-scheme" content="light">
    </head>
    <body style="margin:0;padding:0;background:#eef2f7;font-family:'Segoe UI',Helvetica,Arial,sans-serif;">
        <div style="display:none;max-height:0;overflow:hidden;opacity:0;">${tituloPrincipal}</div>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#eef2f7;padding:36px 16px;">
            <tr>
                <td align="center">
                    <table role="presentation" width="520" cellpadding="0" cellspacing="0" style="max-width:520px;width:100%;background:#ffffff;border-radius:20px;overflow:hidden;box-shadow:0 18px 50px rgba(15,23,42,.10);">
                        <tr>
                            <td style="background:linear-gradient(135deg,#0d6efd 0%,#0b5ed7 60%,#083d99 100%);padding:32px 32px 28px;">
                                <table role="presentation" cellpadding="0" cellspacing="0">
                                    <tr>
                                        <td style="padding-right:12px;">
                                            <img src="${DOMINIO_PUBLICO}/nexo-pos-logo.jpg" width="40" height="40" alt="Nexo POS" style="display:block;border-radius:10px;background:#fff;">
                                        </td>
                                        <td>
                                            <div style="color:#ffffff;font-size:19px;font-weight:800;letter-spacing:.2px;">Nexo POS</div>
                                            <div style="color:rgba(255,255,255,.72);font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;margin-top:2px;">${etiqueta}</div>
                                        </td>
                                    </tr>
                                </table>
                            </td>
                        </tr>
                        <tr>
                            <td style="padding:32px;color:#101828;">
                                <h1 style="margin:0 0 18px;font-size:20px;line-height:1.3;color:#101828;">${tituloPrincipal}</h1>
                                ${cuerpoHtml}
                            </td>
                        </tr>
                        <tr>
                            <td style="padding:18px 32px;background:#f8fafc;border-top:1px solid #eef2f7;">
                                <p style="margin:0;color:#98a2b3;font-size:12px;line-height:1.5;">Nexo POS -- sistema de punto de venta para ferreterias y negocios.<br>Este es un correo automatico, no respondas a este mensaje.</p>
                            </td>
                        </tr>
                    </table>
                </td>
            </tr>
        </table>
    </body>
    </html>
    `;
}

function botonHtml(texto, enlace) {
    return `
    <table role="presentation" cellpadding="0" cellspacing="0" style="margin:22px 0;">
        <tr>
            <td style="border-radius:12px;background:linear-gradient(135deg,#0d6efd,#0b5ed7);">
                <a href="${enlace}" style="display:inline-block;padding:14px 28px;color:#ffffff;text-decoration:none;font-weight:800;font-size:15px;border-radius:12px;">${texto}</a>
            </td>
        </tr>
    </table>
    `;
}

function avisoHtml(texto) {
    return `<p style="margin:20px 0 0;color:#98a2b3;font-size:12.5px;line-height:1.5;">${texto}</p>`;
}

async function enviarCorreo({ correo, asunto, html }) {
    const cliente = obtenerClienteResend();

    if (!cliente) {
        console.warn(`[email] RESEND_API_KEY no configurada -- no se envio el correo a ${correo} (${asunto})`);
        return { ok: false, error: "RESEND_API_KEY no configurada" };
    }

    try {
        const resultado = await cliente.emails.send({
            from: `Nexo POS <${remitente}>`,
            to: correo,
            subject: asunto,
            html
        });

        if (resultado.error) {
            console.warn(`[email] Resend rechazo el envio a ${correo}:`, resultado.error);
            return { ok: false, error: resultado.error.message || "Error al enviar" };
        }

        return { ok: true, id: resultado.data?.id || null };
    } catch (error) {
        console.warn(`[email] No se pudo enviar el correo a ${correo}:`, error.message);
        return { ok: false, error: error.message };
    }
}

function enviarCorreoVerificacion(correo, nombreNegocio, enlace) {
    return enviarCorreo({
        correo,
        asunto: "Confirma tu correo en Nexo POS",
        html: envolverPlantilla(
            "Verificacion de cuenta",
            `Hola, ${nombreNegocio}`,
            `
            <p style="margin:0;color:#344054;font-size:15px;line-height:1.6;">Gracias por crear tu cuenta en Nexo POS. Confirma tu correo para activarla y empezar a usar el sistema.</p>
            ${botonHtml("Verificar mi correo", enlace)}
            ${avisoHtml("Este enlace vence en 24 horas. Si tu no creaste esta cuenta, puedes ignorar este correo con confianza.")}
            `
        )
    });
}

function enviarCorreoRecuperacion(correo, nombreNegocio, codigo) {
    return enviarCorreo({
        correo,
        asunto: "Tu codigo para recuperar tu contrasena",
        html: envolverPlantilla(
            "Recuperacion de contrasena",
            `Hola, ${nombreNegocio}`,
            `
            <p style="margin:0;color:#344054;font-size:15px;line-height:1.6;">Recibimos una solicitud para restablecer la contrasena de tu cuenta. Usa este codigo para continuar:</p>
            <table role="presentation" cellpadding="0" cellspacing="0" style="margin:22px 0;">
                <tr>
                    <td style="padding:18px 26px;border-radius:14px;background:#eef4ff;border:1px solid #dbe7ff;">
                        <span style="font-size:34px;font-weight:900;letter-spacing:8px;color:#0d6efd;font-family:'Courier New',monospace;">${codigo}</span>
                    </td>
                </tr>
            </table>
            ${avisoHtml("Este codigo vence en 15 minutos. Si tu no pediste este cambio, ignora este correo -- tu contrasena actual sigue siendo valida.")}
            `
        )
    });
}

function enviarCorreoActivacionCuenta(correo, nombreNegocio, enlace) {
    return enviarCorreo({
        correo,
        asunto: "Activa tu cuenta con correo y contrasena",
        html: envolverPlantilla(
            "Activacion de cuenta",
            `Hola, ${nombreNegocio}`,
            `
            <p style="margin:0;color:#344054;font-size:15px;line-height:1.6;">Nexo POS ahora usa tu correo y una contrasena para iniciar sesion, en vez del codigo del negocio. Crea tu contrasena para seguir entrando a tu cuenta con normalidad.</p>
            ${botonHtml("Crear mi contrasena", enlace)}
            ${avisoHtml("Este enlace vence en 24 horas. Si tienes dudas, contacta a soporte de Nexo POS.")}
            `
        )
    });
}

module.exports = {
    enviarCorreoVerificacion,
    enviarCorreoRecuperacion,
    enviarCorreoActivacionCuenta
};
