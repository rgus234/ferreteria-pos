// Correo transaccional (verificacion de cuenta, recuperacion de
// contrasena, activacion, bienvenida, pagos) via Resend. Si
// RESEND_API_KEY no esta configurada, las funciones de envio no
// truenan -- solo avisan en consola y regresan { ok: false } para que
// quien las llame decida que hacer (el registro/login no deben fallar
// por un correo que no se pudo mandar).

const { Resend } = require("resend");

const remitente =
    process.env.RESEND_FROM || "onboarding@resend.dev";

// Dominio publico fijo para las imagenes del correo -- un cliente de
// correo nunca puede cargar localhost, asi que aqui siempre se usa el
// dominio real sin importar en que entorno corre el servidor.
const DOMINIO_PUBLICO = "https://nexoposoficial.com";

// Canales de soporte reales (mismos que ya usa el sitio publico) --
// nunca se inventa un "centro de ayuda" que no existe todavia.
const WHATSAPP_SOPORTE = "https://wa.me/524424950495?text=Hola%2C%20necesito%20ayuda%20con%20Nexo%20POS.";
const CORREO_SOPORTE = "nexoposoficial@gmail.com";

let clienteResend = null;

function obtenerClienteResend() {
    if (!process.env.RESEND_API_KEY) return null;

    if (!clienteResend) {
        clienteResend = new Resend(process.env.RESEND_API_KEY);
    }

    return clienteResend;
}

// Personaje de Nexo por contexto -- mismos JPG reales que ya usa la
// app (public/img/nexo-ia/*.jpg), nunca un icono generico.
function robotUrl(nombre) {
    return `${DOMINIO_PUBLICO}/img/nexo-ia/${nombre}.jpg`;
}

// Plantilla base compartida por todos los correos: header con logo
// real, bloque principal (titulo + saludo + cuerpo) a la izquierda y
// el personaje de Nexo a la derecha, una caja opcional debajo (pasos,
// detalle de pago, etc.) y un pie con los canales de soporte reales.
function envolverPlantilla({ etiqueta, titulo, saludo = "", cuerpoHtml, robot = "feliz", cajaHtml = "" }) {
    return `
    <!doctype html>
    <html lang="es">
    <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <meta name="color-scheme" content="light">
    </head>
    <body style="margin:0;padding:0;background:#eef2f7;font-family:'Segoe UI',Helvetica,Arial,sans-serif;">
        <div style="display:none;max-height:0;overflow:hidden;opacity:0;">${titulo}</div>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#eef2f7;padding:36px 16px;">
            <tr>
                <td align="center">
                    <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;background:#ffffff;border-radius:20px;overflow:hidden;box-shadow:0 18px 50px rgba(15,23,42,.10);">
                        <tr>
                            <td style="padding:28px 32px 0;">
                                <table role="presentation" cellpadding="0" cellspacing="0">
                                    <tr>
                                        <td style="padding-right:10px;">
                                            <img src="${DOMINIO_PUBLICO}/nexo-pos-logo.jpg" width="30" height="30" alt="Nexo" style="display:block;border-radius:8px;">
                                        </td>
                                        <td style="font-size:15px;font-weight:800;color:#0f172a;letter-spacing:.2px;">NEXO</td>
                                    </tr>
                                </table>
                            </td>
                        </tr>
                        <tr>
                            <td style="padding:16px 32px 0;">
                                <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                                    <tr>
                                        <td valign="top" style="width:64%;">
                                            <div style="font-size:11px;font-weight:800;color:#0d6efd;text-transform:uppercase;letter-spacing:.09em;margin-bottom:8px;">${etiqueta}</div>
                                            <h1 style="margin:0 0 10px;font-size:22px;line-height:1.28;color:#0f172a;">${titulo}</h1>
                                            ${saludo ? `<div style="font-size:15px;font-weight:700;color:#0d6efd;margin-bottom:12px;">${saludo}</div>` : ""}
                                        </td>
                                        <td valign="top" align="right" style="width:36%;padding-left:8px;">
                                            <img src="${robotUrl(robot)}" width="118" alt="Nexo" style="display:inline-block;max-width:118px;">
                                        </td>
                                    </tr>
                                </table>
                                ${cuerpoHtml}
                            </td>
                        </tr>
                        ${cajaHtml ? `<tr><td style="padding:4px 32px 28px;">${cajaHtml}</td></tr>` : `<tr><td style="padding:0 0 20px;"></td></tr>`}
                        <tr>
                            <td style="padding:20px 32px;background:#0b1220;">
                                <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                                    <tr>
                                        <td valign="top">
                                            <div style="color:#cbd5e1;font-size:12.5px;font-weight:700;margin-bottom:6px;">¿Necesitas ayuda?</div>
                                            <div style="color:#94a3b8;font-size:12.5px;line-height:1.9;">
                                                <a href="${WHATSAPP_SOPORTE}" style="color:#94a3b8;text-decoration:none;">💬 WhatsApp</a><br>
                                                <a href="mailto:${CORREO_SOPORTE}" style="color:#94a3b8;text-decoration:none;">✉️ ${CORREO_SOPORTE}</a>
                                            </div>
                                        </td>
                                        <td valign="top" align="right">
                                            <div style="color:#e2e8f0;font-size:13px;font-weight:800;">NEXO</div>
                                            <div style="color:#64748b;font-size:11.5px;margin-top:4px;">© 2026 Todos los derechos reservados.</div>
                                        </td>
                                    </tr>
                                </table>
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
    <table role="presentation" cellpadding="0" cellspacing="0" style="margin:18px 0 4px;">
        <tr>
            <td style="border-radius:12px;background:linear-gradient(135deg,#0d6efd,#0b5ed7);">
                <a href="${enlace}" style="display:inline-block;padding:14px 28px;color:#ffffff;text-decoration:none;font-weight:800;font-size:15px;border-radius:12px;">${texto}</a>
            </td>
        </tr>
    </table>
    `;
}

function avisoHtml(texto) {
    return `<p style="margin:16px 0 0;color:#98a2b3;font-size:12.5px;line-height:1.5;">${texto}</p>`;
}

// Caja de 4 caracteristicas (referencia visual del correo de
// bienvenida/verificacion) -- solo emoji, sin depender de ningun
// icono/asset nuevo.
function cajaCaracteristicasHtml() {
    const items = [
        ["🛒", "Vende mas rapido"],
        ["📦", "Controla tu inventario"],
        ["👥", "Administra clientes y creditos"],
        ["🤖", "Usa Nexo IA para ayudarte"]
    ];

    const celdas = items.map(([icono, texto]) => `
        <td width="25%" align="center" style="padding:14px 6px;">
            <div style="font-size:22px;">${icono}</div>
            <div style="margin-top:6px;color:#475467;font-size:11.5px;line-height:1.35;">${texto}</div>
        </td>
    `).join("");

    return `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f8fafc;border:1px solid #eef2f7;border-radius:14px;">
        <tr>${celdas}</tr>
    </table>
    `;
}

// Caja de pasos numerados (correo de bienvenida, referencia visual).
function cajaPasosHtml(pasos) {
    const filas = pasos.map((texto, indice) => `
        <tr>
            <td width="32" valign="top" style="padding:6px 10px 6px 0;">
                <div style="width:24px;height:24px;border-radius:50%;background:#0d6efd;color:#fff;font-size:12px;font-weight:800;text-align:center;line-height:24px;">${indice + 1}</div>
            </td>
            <td valign="top" style="padding:8px 0;color:#344054;font-size:14px;line-height:24px;">${texto}</td>
        </tr>
    `).join("");

    return `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f8fafc;border:1px solid #eef2f7;border-radius:14px;padding:16px 18px;">
        <tr><td colspan="2"><div style="font-size:12.5px;font-weight:800;color:#101828;margin-bottom:6px;">Empieza con estos pasos:</div></td></tr>
        ${filas}
    </table>
    `;
}

async function enviarCorreo({ correo, asunto, html, attachments = [] }) {
    const cliente = obtenerClienteResend();

    if (!cliente) {
        console.warn(`[email] RESEND_API_KEY no configurada -- no se envio el correo a ${correo} (${asunto})`);
        return { ok: false, error: "RESEND_API_KEY no configurada" };
    }

    try {
        const resultado = await cliente.emails.send({
            from: `Nexo <${remitente}>`,
            to: correo,
            subject: asunto,
            html,
            ...(attachments.length > 0 ? { attachments } : {})
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
        asunto: "Confirma tu correo en Nexo",
        html: envolverPlantilla({
            etiqueta: "Verificacion de cuenta",
            titulo: "Confirma tu correo para activar tu cuenta",
            saludo: `Hola, ${nombreNegocio} 👋`,
            robot: "feliz",
            cuerpoHtml: `
                <p style="margin:0;color:#344054;font-size:15px;line-height:1.6;">Gracias por crear tu cuenta en Nexo. Solo falta confirmar tu correo electronico para que puedas comenzar.</p>
                ${botonHtml("Confirmar mi correo", enlace)}
                ${avisoHtml("Este enlace vence en 24 horas.")}
            `,
            cajaHtml: cajaCaracteristicasHtml()
        })
    });
}

// Mismo patron que enviarCorreoVerificacion (negocios) pero para la
// cuenta de persona (Nexo Market / Nexo para negocios), disparado por
// personas-server.js, POST /personas/registro.
function enviarCorreoVerificacionPersona(correo, nombrePersona, enlace) {
    return enviarCorreo({
        correo,
        asunto: "Confirma tu correo en Nexo",
        html: envolverPlantilla({
            etiqueta: "Verificacion de cuenta",
            titulo: "Confirma tu correo para activar tu cuenta",
            saludo: `Hola, ${nombrePersona} 👋`,
            robot: "feliz",
            cuerpoHtml: `
                <p style="margin:0;color:#344054;font-size:15px;line-height:1.6;">Gracias por crear tu cuenta en Nexo. Solo falta confirmar tu correo electronico para que puedas comenzar.</p>
                ${botonHtml("Confirmar mi correo", enlace)}
                ${avisoHtml("Este enlace vence en 24 horas.")}
            `
        })
    });
}

// Se dispara justo despues de que el correo se confirma con exito
// (server.js, GET /verificar-correo/:token) -- es la primera vez que
// el negocio recibe algo de Nexo con la cuenta ya activa.
function enviarCorreoBienvenida(correo, nombreNegocio, enlace) {
    const enlaceDescarga = `${DOMINIO_PUBLICO}/descargar`;

    return enviarCorreo({
        correo,
        asunto: "¡Bienvenido a Nexo!",
        html: envolverPlantilla({
            etiqueta: "Cuenta activa",
            titulo: "¡Bienvenido a Nexo! 🎉",
            saludo: `Hola, ${nombreNegocio}`,
            robot: "celebrando",
            cuerpoHtml: `
                <p style="margin:0;color:#344054;font-size:15px;line-height:1.6;">Tu cuenta ya esta activa y lista para usarse. Estamos aqui para ayudarte a hacer crecer tu negocio.</p>
                ${botonHtml("Ir a mi cuenta", enlace)}
                ${avisoHtml(`¿Vas a usar Nexo en una computadora? <a href="${enlaceDescarga}" style="color:#0d6efd;font-weight:700;">Descarga el instalador aqui</a>. Windows puede mostrar una advertencia al abrirlo porque todavia no tenemos el certificado de Microsoft -- es normal, solo elige "Mas informacion" y despues "Ejecutar de todas formas".`)}
            `,
            cajaHtml: cajaPasosHtml([
                "Configura tu negocio en minutos",
                "Agrega tus productos facilmente",
                "Realiza tu primera venta",
                "Explora Nexo IA y sus herramientas"
            ])
        })
    });
}

function enviarCorreoRecuperacion(correo, nombreNegocio, codigo) {
    return enviarCorreo({
        correo,
        asunto: "Tu codigo para recuperar tu contrasena",
        html: envolverPlantilla({
            etiqueta: "Recuperacion de contrasena",
            titulo: "Recupera el acceso a tu cuenta",
            saludo: `Hola, ${nombreNegocio}`,
            robot: "alerta",
            cuerpoHtml: `
                <p style="margin:0;color:#344054;font-size:15px;line-height:1.6;">Recibimos una solicitud para restablecer la contrasena de tu cuenta. Escribe este codigo dentro de Nexo para continuar:</p>
                <table role="presentation" cellpadding="0" cellspacing="0" style="margin:18px 0 4px;">
                    <tr>
                        <td style="padding:16px 24px;border-radius:14px;background:#eef4ff;border:1px solid #dbe7ff;">
                            <span style="font-size:32px;font-weight:900;letter-spacing:8px;color:#0d6efd;font-family:'Courier New',monospace;">${codigo}</span>
                        </td>
                    </tr>
                </table>
                ${avisoHtml("Este codigo vence en 15 minutos. Si tu no pediste este cambio, ignora este correo -- tu contrasena actual sigue siendo valida.")}
            `
        })
    });
}

function enviarCorreoActivacionCuenta(correo, nombreNegocio, enlace) {
    return enviarCorreo({
        correo,
        asunto: "Activa tu cuenta con correo y contrasena",
        html: envolverPlantilla({
            etiqueta: "Activacion de cuenta",
            titulo: "Crea tu contrasena para seguir entrando",
            saludo: `Hola, ${nombreNegocio}`,
            robot: "feliz",
            cuerpoHtml: `
                <p style="margin:0;color:#344054;font-size:15px;line-height:1.6;">Nexo ahora usa tu correo y una contrasena para iniciar sesion, en vez del codigo del negocio. Crea tu contrasena para seguir entrando a tu cuenta con normalidad.</p>
                ${botonHtml("Crear mi contrasena", enlace)}
                ${avisoHtml("Este enlace vence en 24 horas. Si tienes dudas, contacta a soporte de Nexo.")}
            `
        })
    });
}

function enviarCorreoRespaldo(correo, { asunto, mensajeHtml, attachments = [] }) {
    return enviarCorreo({
        correo,
        asunto,
        html: envolverPlantilla({
            etiqueta: "Respaldo automatico",
            titulo: asunto,
            robot: "neutral",
            cuerpoHtml: mensajeHtml
        }),
        attachments
    });
}

function enviarCorreoPagoFallido(correo, nombreNegocio, { montoTexto, fechaReintento, enlacePago, graciaDias }) {
    return enviarCorreo({
        correo,
        asunto: "Hubo un problema con tu pago en Nexo",
        html: envolverPlantilla({
            etiqueta: "Pago fallido",
            titulo: "Hubo un problema con tu pago",
            saludo: `Hola, ${nombreNegocio}`,
            robot: "alerta",
            cuerpoHtml: `
                <p style="margin:0;color:#344054;font-size:15px;line-height:1.6;">
                    No pudimos procesar tu pago${montoTexto ? ` de ${montoTexto}` : ""} de la suscripcion a Nexo.
                </p>
                <p style="margin:12px 0 0;color:#344054;font-size:15px;line-height:1.6;">
                    ${fechaReintento
                        ? `Vamos a intentar cobrarlo de nuevo el ${fechaReintento}.`
                        : "Actualiza tu metodo de pago para seguir usando Nexo sin interrupciones."}
                </p>
                ${enlacePago ? botonHtml("Pagar ahora", enlacePago) : ""}
                ${avisoHtml(`Tu acceso sigue activo por ahora (tienes ${graciaDias || 15} dias de gracia antes de que se limiten funciones). Si ya corregiste tu metodo de pago, puedes ignorar este correo.`)}
            `
        })
    });
}

// Aviso de que la prueba gratuita esta por terminar -- antes de esto
// no existia ningun correo de este tipo, asi que un negocio nuevo
// podia pasar de "prueba" a periodo de gracia/limitado sin ningun
// aviso anticipado (encontrado en la auditoria de lanzamiento,
// 2026-08-26). Se dispara desde prueba-recordatorios-server.js.
function enviarCorreoPruebaPorTerminar(correo, nombreNegocio, { diasRestantes, enlaceSuscripcion }) {
    return enviarCorreo({
        correo,
        asunto: diasRestantes <= 1
            ? "Tu prueba gratuita de Nexo termina hoy o mañana"
            : `Tu prueba gratuita de Nexo termina en ${diasRestantes} dias`,
        html: envolverPlantilla({
            etiqueta: "Prueba gratuita",
            titulo: diasRestantes <= 1
                ? "Tu prueba termina muy pronto"
                : `Tu prueba termina en ${diasRestantes} dias`,
            saludo: `Hola, ${nombreNegocio}`,
            robot: "alerta",
            cuerpoHtml: `
                <p style="margin:0;color:#344054;font-size:15px;line-height:1.6;">
                    Llevas usando Nexo en tu negocio y tu periodo de prueba de 15 dias
                    esta por terminar. Elige un plan para no perder acceso a tu
                    inventario, tus ventas y tus creditos.
                </p>
                ${enlaceSuscripcion ? botonHtml("Elegir mi plan", enlaceSuscripcion) : ""}
                ${avisoHtml("Si no eliges un plan a tiempo, tu cuenta entra a un periodo de gracia y despues se limita -- tu informacion no se borra, solo se restringe el acceso hasta que actives un plan.")}
            `
        })
    });
}

// Se dispara desde el webhook invoice.paid de Stripe -- solo con
// datos que el propio evento trae (nunca se inventa el metodo de pago
// si Stripe no lo mando en el payload).
function enviarCorreoPagoConfirmado(correo, nombreNegocio, { planTexto, montoTexto, fechaTexto, metodoTexto }) {
    const filas = [
        ["Plan", planTexto],
        ["Monto", montoTexto],
        ["Fecha", fechaTexto],
        metodoTexto ? ["Metodo de pago", metodoTexto] : null
    ].filter(Boolean);

    const filasHtml = filas.map(([etiqueta, valor]) => `
        <tr>
            <td style="padding:8px 0;color:#667085;font-size:13.5px;">${etiqueta}</td>
            <td align="right" style="padding:8px 0;color:#101828;font-size:13.5px;font-weight:700;">${valor}</td>
        </tr>
    `).join("");

    return enviarCorreo({
        correo,
        asunto: "¡Pago confirmado! Gracias por tu suscripcion a Nexo",
        html: envolverPlantilla({
            etiqueta: "Pago confirmado",
            titulo: "¡Pago confirmado! ✅",
            saludo: `Hola, ${nombreNegocio}`,
            robot: "celebrando",
            cuerpoHtml: `
                <p style="margin:0;color:#344054;font-size:15px;line-height:1.6;">Hemos recibido tu pago correctamente. Gracias por confiar en Nexo.</p>
            `,
            cajaHtml: `
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f8fafc;border:1px solid #eef2f7;border-radius:14px;padding:6px 18px;">
                    <tr><td colspan="2" style="padding:8px 0 2px;color:#101828;font-size:12.5px;font-weight:800;">Detalles del pago</td></tr>
                    ${filasHtml}
                </table>
                <div style="margin-top:14px;padding:14px 16px;background:#eef4ff;border-radius:12px;color:#0d6efd;font-size:13px;font-weight:600;">💙 Con tu plan activo, ya puedes disfrutar de todas las funciones incluidas en el.</div>
            `
        })
    });
}

const CORREO_NOTIFICACIONES_LEADS = process.env.LEADS_NOTIFICATION_EMAIL || "nexoposoficial@gmail.com";

// El lead viene de un formulario publico sin autenticacion -- se
// escapa antes de interpolarlo en el HTML del correo para que nadie
// pueda inyectar un enlace/marcado falso en un correo que parece
// venir de Nexo.
function escaparHtmlCorreo(valor) {
    return String(valor || "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

function enviarCorreoLeadLanding({ nombre, negocio, telefono, correo, mensaje }) {
    const telefonoLimpio = String(telefono || "").replace(/\D/g, "");
    const nombreSeguro = escaparHtmlCorreo(nombre);

    return enviarCorreo({
        correo: CORREO_NOTIFICACIONES_LEADS,
        asunto: `Nuevo contacto desde el sitio -- ${nombreSeguro}`,
        html: envolverPlantilla({
            etiqueta: "Nuevo lead",
            titulo: "Nuevo contacto desde la web",
            saludo: "Alguien pidio informacion en tu sitio.",
            robot: "neutral",
            cuerpoHtml: `
                <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;margin:4px 0 6px;">
                    <tr><td style="padding:6px 0;color:#344054;font-size:15px;"><strong>Nombre:</strong> ${nombreSeguro || "-"}</td></tr>
                    <tr><td style="padding:6px 0;color:#344054;font-size:15px;"><strong>Negocio:</strong> ${escaparHtmlCorreo(negocio) || "-"}</td></tr>
                    <tr><td style="padding:6px 0;color:#344054;font-size:15px;"><strong>Telefono:</strong> ${escaparHtmlCorreo(telefono) || "-"}</td></tr>
                    <tr><td style="padding:6px 0;color:#344054;font-size:15px;"><strong>Correo:</strong> ${escaparHtmlCorreo(correo) || "-"}</td></tr>
                    <tr><td style="padding:6px 0;color:#344054;font-size:15px;"><strong>Mensaje:</strong> ${escaparHtmlCorreo(mensaje) || "(sin mensaje)"}</td></tr>
                </table>
                <table role="presentation" cellpadding="0" cellspacing="0" style="margin:6px 0 4px;">
                    <tr>
                        ${telefonoLimpio ? `
                        <td style="padding-right:10px;border-radius:12px;background:#16a34a;">
                            <a href="https://wa.me/52${telefonoLimpio}" style="display:inline-block;padding:12px 22px;color:#ffffff;text-decoration:none;font-weight:800;font-size:14px;border-radius:12px;">Responder por WhatsApp</a>
                        </td>` : ""}
                        ${correo ? `
                        <td style="border-radius:12px;background:linear-gradient(135deg,#0d6efd,#0b5ed7);">
                            <a href="mailto:${escaparHtmlCorreo(correo)}" style="display:inline-block;padding:12px 22px;color:#ffffff;text-decoration:none;font-weight:800;font-size:14px;border-radius:12px;">Responder por correo</a>
                        </td>` : ""}
                    </tr>
                </table>
                ${avisoHtml("Este lead tambien quedo guardado en la tabla contactos_landing.")}
            `
        })
    });
}

// El pedido viene del formulario publico del catalogo (sin sesion) --
// mismo criterio de escape que enviarCorreoLeadLanding. A diferencia
// de esa funcion, el destinatario es el correo del propio negocio
// (dinamico), no una constante fija de notificaciones internas.
function enviarCorreoPedidoPublico(correo, nombreNegocio, { productoNombre, cantidad, clienteNombre, clienteTelefono, clienteCorreo, mensaje, urlProducto }) {
    const telefonoLimpio = String(clienteTelefono || "").replace(/\D/g, "");
    const productoSeguro = escaparHtmlCorreo(productoNombre);
    const clienteSeguro = escaparHtmlCorreo(clienteNombre);

    return enviarCorreo({
        correo,
        asunto: `Nuevo pedido desde tu sitio web -- ${productoSeguro}`,
        html: envolverPlantilla({
            etiqueta: "Nuevo pedido",
            titulo: "Nuevo pedido desde tu sitio web",
            saludo: `Hola, ${nombreNegocio}`,
            robot: "celebrando",
            cuerpoHtml: `
                <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;margin:4px 0 6px;">
                    <tr><td style="padding:6px 0;color:#344054;font-size:15px;"><strong>Producto:</strong> ${productoSeguro}</td></tr>
                    <tr><td style="padding:6px 0;color:#344054;font-size:15px;"><strong>Cantidad:</strong> ${escaparHtmlCorreo(cantidad)}</td></tr>
                    <tr><td style="padding:6px 0;color:#344054;font-size:15px;"><strong>Cliente:</strong> ${clienteSeguro || "-"}</td></tr>
                    <tr><td style="padding:6px 0;color:#344054;font-size:15px;"><strong>Telefono:</strong> ${escaparHtmlCorreo(clienteTelefono) || "-"}</td></tr>
                    <tr><td style="padding:6px 0;color:#344054;font-size:15px;"><strong>Correo:</strong> ${escaparHtmlCorreo(clienteCorreo) || "-"}</td></tr>
                    <tr><td style="padding:6px 0;color:#344054;font-size:15px;"><strong>Mensaje:</strong> ${escaparHtmlCorreo(mensaje) || "(sin mensaje)"}</td></tr>
                </table>
                <table role="presentation" cellpadding="0" cellspacing="0" style="margin:6px 0 4px;">
                    <tr>
                        ${telefonoLimpio ? `
                        <td style="padding-right:10px;border-radius:12px;background:#16a34a;">
                            <a href="https://wa.me/52${telefonoLimpio}" style="display:inline-block;padding:12px 22px;color:#ffffff;text-decoration:none;font-weight:800;font-size:14px;border-radius:12px;">Responder por WhatsApp</a>
                        </td>` : ""}
                        ${clienteCorreo ? `
                        <td style="border-radius:12px;background:linear-gradient(135deg,#0d6efd,#0b5ed7);">
                            <a href="mailto:${escaparHtmlCorreo(clienteCorreo)}" style="display:inline-block;padding:12px 22px;color:#ffffff;text-decoration:none;font-weight:800;font-size:14px;border-radius:12px;">Responder por correo</a>
                        </td>` : ""}
                    </tr>
                </table>
                ${avisoHtml(`Este pedido tambien quedo guardado en tu sitio web. ${urlProducto ? `Ver producto: ${escaparHtmlCorreo(urlProducto)}` : ""}`)}
            `
        })
    });
}

// Carrito multi-producto (Fase 7) -- mismo molde que
// enviarCorreoPedidoPublico, pero lista cada item del grupo en vez de
// un solo producto, y se manda UNA vez por pedido agrupado (no una
// vez por item, para no llenar el correo del negocio).
function enviarCorreoPedidoCarritoPublico(correo, nombreNegocio, { items, clienteNombre, clienteTelefono, clienteCorreo, mensaje, urlCatalogo }) {
    const telefonoLimpio = String(clienteTelefono || "").replace(/\D/g, "");
    const clienteSeguro = escaparHtmlCorreo(clienteNombre);
    const filasItems = (items || [])
        .map(item => `<tr><td style="padding:4px 0;color:#344054;font-size:14px;">${escaparHtmlCorreo(item.nombre)} &times; ${escaparHtmlCorreo(item.cantidad)}</td></tr>`)
        .join("");

    return enviarCorreo({
        correo,
        asunto: `Nuevo pedido desde tu sitio web -- ${(items || []).length} producto(s)`,
        html: envolverPlantilla({
            etiqueta: "Nuevo pedido",
            titulo: "Nuevo pedido desde tu sitio web",
            saludo: `Hola, ${nombreNegocio}`,
            robot: "celebrando",
            cuerpoHtml: `
                <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;margin:4px 0 10px;">
                    ${filasItems}
                </table>
                <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;margin:4px 0 6px;">
                    <tr><td style="padding:6px 0;color:#344054;font-size:15px;"><strong>Cliente:</strong> ${clienteSeguro || "-"}</td></tr>
                    <tr><td style="padding:6px 0;color:#344054;font-size:15px;"><strong>Telefono:</strong> ${escaparHtmlCorreo(clienteTelefono) || "-"}</td></tr>
                    <tr><td style="padding:6px 0;color:#344054;font-size:15px;"><strong>Correo:</strong> ${escaparHtmlCorreo(clienteCorreo) || "-"}</td></tr>
                    <tr><td style="padding:6px 0;color:#344054;font-size:15px;"><strong>Mensaje:</strong> ${escaparHtmlCorreo(mensaje) || "(sin mensaje)"}</td></tr>
                </table>
                <table role="presentation" cellpadding="0" cellspacing="0" style="margin:6px 0 4px;">
                    <tr>
                        ${telefonoLimpio ? `
                        <td style="padding-right:10px;border-radius:12px;background:#16a34a;">
                            <a href="https://wa.me/52${telefonoLimpio}" style="display:inline-block;padding:12px 22px;color:#ffffff;text-decoration:none;font-weight:800;font-size:14px;border-radius:12px;">Responder por WhatsApp</a>
                        <\td>` : ""}
                        ${clienteCorreo ? `
                        <td style="border-radius:12px;background:linear-gradient(135deg,#0d6efd,#0b5ed7);">
                            <a href="mailto:${escaparHtmlCorreo(clienteCorreo)}" style="display:inline-block;padding:12px 22px;color:#ffffff;text-decoration:none;font-weight:800;font-size:14px;border-radius:12px;">Responder por correo</a>
                        <\td>` : ""}
                    </tr>
                </table>
                ${avisoHtml(`Este pedido tambien quedo guardado en tu sitio web. ${urlCatalogo ? `Ver catalogo: ${escaparHtmlCorreo(urlCatalogo)}` : ""}`)}
            `
        })
    });
}

// Primer correo del proyecto que va del negocio HACIA el cliente
// final (todos los demas van al dueno) -- se dispara cuando el
// negocio responde una solicitud de cotizacion publica con un precio
// (Fase 10 del sitio web por negocio). Mismo molde que
// enviarCorreoPedidoCarritoPublico, pero el boton final lleva al
// portal del cliente en vez de a "responder por WhatsApp/correo".
function enviarCorreoCotizacionRespondida(correo, nombreNegocio, { items, precioCotizado, nota, urlPortal }) {
    const nombreSeguro = escaparHtmlCorreo(nombreNegocio);
    const filasItems = (items || [])
        .map(item => `<tr><td style="padding:4px 0;color:#344054;font-size:14px;">${escaparHtmlCorreo(item.nombre)} &times; ${escaparHtmlCorreo(item.cantidad)}</td></tr>`)
        .join("");

    return enviarCorreo({
        correo,
        asunto: `${nombreSeguro} ya tiene un precio para tu cotizacion`,
        html: envolverPlantilla({
            etiqueta: "Cotizacion respondida",
            titulo: "Ya tienes un precio para tu cotizacion",
            saludo: `Hola`,
            robot: "celebrando",
            cuerpoHtml: `
                <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;margin:4px 0 10px;">
                    ${filasItems}
                </table>
                <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;margin:4px 0 6px;">
                    <tr><td style="padding:6px 0;color:#344054;font-size:22px;font-weight:800;">$${Number(precioCotizado).toFixed(2)}</td></tr>
                    ${nota ? `<tr><td style="padding:6px 0;color:#344054;font-size:14px;"><strong>Nota de ${nombreSeguro}:</strong> ${escaparHtmlCorreo(nota)}</td></tr>` : ""}
                </table>
                ${urlPortal ? botonHtml("Ver mi cotizacion", urlPortal) : ""}
                ${avisoHtml(`Este precio te lo dio ${nombreSeguro} directamente. Si tienes dudas, contactalos por telefono o WhatsApp.`)}
            `
        })
    });
}

// ---- Rediseno del flujo de pedidos de Nexo Market (Fase 3/5, ver plan
// "Nexo Market: rediseno del flujo de pedidos"): un correo por cada
// transicion de estado, disparado directamente por quien hace el UPDATE
// (mismo patron ya usado por enviarCorreoCotizacionRespondida) -- nunca
// hay IA de por medio, solo texto fijo segun el estado nuevo. ----

function filasItemsPedidoMarket(items) {
    return (items || [])
        .map(item => `<tr><td style="padding:6px 0;color:#344054;font-size:14px;">
            <table role="presentation" cellpadding="0" cellspacing="0"><tr>
                ${item.fotoUrl ? `<td style="padding-right:10px;width:40px;"><img src="${item.fotoUrl}" width="40" height="40" style="display:block;border-radius:8px;object-fit:cover;border:1px solid #eef2f7;" alt=""></td>` : ""}
                <td>${escaparHtmlCorreo(item.nombre)} &times; ${escaparHtmlCorreo(item.cantidad)}</td>
            </tr></table>
        </td></tr>`)
        .join("");
}

function rangoRecogidaHtml(recogidaDesde, recogidaHasta) {
    if (!recogidaDesde || !recogidaHasta) return "";
    const formato = fecha => new Date(fecha).toLocaleTimeString("es-MX", { hour: "numeric", minute: "2-digit" });
    return `<tr><td style="padding:6px 0;color:#344054;font-size:15px;"><strong>Recogida estimada:</strong> ${formato(recogidaDesde)} - ${formato(recogidaHasta)}</td></tr>`;
}

function enviarCorreoPedidoRecibido(correo, nombreNegocio, { items, codigoRecogida, urlSeguimiento }) {
    const nombreSeguro = escaparHtmlCorreo(nombreNegocio);

    return enviarCorreo({
        correo,
        asunto: `Pedido recibido -- ${nombreSeguro}`,
        html: envolverPlantilla({
            etiqueta: "Pedido realizado",
            titulo: "Recibimos tu pedido",
            saludo: `Pedido ${escaparHtmlCorreo(codigoRecogida)}`,
            robot: "feliz",
            cuerpoHtml: `
                <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;margin:4px 0 10px;">
                    ${filasItemsPedidoMarket(items)}
                </table>
                ${botonHtml("Ver mi pedido", urlSeguimiento)}
                ${avisoHtml(`Enviamos tu pedido a ${nombreSeguro} para que lo revisen. Te avisaremos por correo en cuanto lo confirmen.`)}
            `
        })
    });
}

function enviarCorreoPedidoConfirmado(correo, nombreNegocio, { items, urlSeguimiento, recogidaDesde, recogidaHasta }) {
    const nombreSeguro = escaparHtmlCorreo(nombreNegocio);

    return enviarCorreo({
        correo,
        asunto: `¡Tu pedido fue aceptado! -- ${nombreSeguro}`,
        html: envolverPlantilla({
            etiqueta: "Pedido aceptado",
            titulo: `${nombreSeguro} aceptó tu pedido`,
            saludo: "Ya lo empezarán a preparar",
            robot: "celebrando",
            cuerpoHtml: `
                <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;margin:4px 0 10px;">
                    ${filasItemsPedidoMarket(items)}
                </table>
                <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;margin:4px 0 6px;">
                    ${rangoRecogidaHtml(recogidaDesde, recogidaHasta)}
                </table>
                ${botonHtml("Ver mi pedido", urlSeguimiento)}
                ${avisoHtml("Te enviaremos otro correo en cuanto esté listo para recoger.")}
            `
        })
    });
}

// Unico correo del flujo con adjunto -- el QR va embebido inline con
// contentId (asi lo llama el SDK de Resend; el atributo <img> lo
// referencia con el prefijo estandar "cid:"), no como boton, para que
// el cliente lo pueda ensenar directo desde el correo sin dar clic a
// nada.
function enviarCorreoPedidoListo(correo, nombreNegocio, { items, codigoRecogida, urlSeguimiento, direccion, qrBuffer }) {
    const nombreSeguro = escaparHtmlCorreo(nombreNegocio);

    return enviarCorreo({
        correo,
        asunto: `🎉 Tu pedido ya está listo -- ${nombreSeguro}`,
        attachments: qrBuffer ? [{ filename: "codigo-recogida.png", content: qrBuffer, contentId: "qr-pedido" }] : [],
        html: envolverPlantilla({
            etiqueta: "Listo para recoger",
            titulo: "¡Tu pedido está listo!",
            saludo: "Ya puedes pasar a recogerlo",
            robot: "celebrando",
            cuerpoHtml: `
                <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;margin:4px 0 10px;">
                    ${filasItemsPedidoMarket(items)}
                </table>
                <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;margin:4px 0 6px;">
                    <tr><td style="padding:6px 0;color:#344054;font-size:15px;"><strong>${nombreSeguro}</strong></td></tr>
                    ${direccion ? `<tr><td style="padding:2px 0;color:#667085;font-size:13.5px;">📍 ${escaparHtmlCorreo(direccion)}</td></tr>` : ""}
                </table>
                ${qrBuffer ? `
                <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;margin:16px 0;background:#f8fafc;border:1px solid #eef2f7;border-radius:14px;">
                    <tr><td align="center" style="padding:20px;">
                        <div style="font-size:11px;font-weight:800;color:#667085;text-transform:uppercase;letter-spacing:.08em;margin-bottom:10px;">Código de recogida</div>
                        <img src="cid:qr-pedido" width="160" height="160" alt="Código QR" style="display:block;margin:0 auto 10px;">
                        <div style="font-size:18px;font-weight:800;color:#0f172a;letter-spacing:.05em;">${escaparHtmlCorreo(codigoRecogida)}</div>
                    </td></tr>
                </table>
                ` : ""}
                ${botonHtml("Ver mi pedido", urlSeguimiento)}
                ${avisoHtml("Muestra este código (o el correo completo) en la tienda para que te entreguen tu pedido.")}
            `
        })
    });
}

function enviarCorreoPedidoEntregado(correo, nombreNegocio, { items, urlSeguimiento }) {
    const nombreSeguro = escaparHtmlCorreo(nombreNegocio);

    return enviarCorreo({
        correo,
        asunto: `Pedido entregado -- gracias por comprar en Nexo`,
        html: envolverPlantilla({
            etiqueta: "Pedido entregado",
            titulo: "¡Pedido entregado!",
            saludo: `Gracias por comprar en ${nombreSeguro}`,
            robot: "celebrando",
            cuerpoHtml: `
                <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;margin:4px 0 10px;">
                    ${filasItemsPedidoMarket(items)}
                </table>
                ${urlSeguimiento ? botonHtml("Ver detalle del pedido", urlSeguimiento) : ""}
            `
        })
    });
}

function enviarCorreoPedidoCancelado(correo, nombreNegocio, { items, motivo, urlSeguimiento }) {
    const nombreSeguro = escaparHtmlCorreo(nombreNegocio);

    return enviarCorreo({
        correo,
        asunto: `Tu pedido fue cancelado -- ${nombreSeguro}`,
        html: envolverPlantilla({
            etiqueta: "Pedido cancelado",
            titulo: "Tu pedido fue cancelado",
            saludo: nombreSeguro,
            robot: "feliz",
            cuerpoHtml: `
                <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;margin:4px 0 10px;">
                    ${filasItemsPedidoMarket(items)}
                </table>
                ${motivo ? `<p style="margin:10px 0;color:#344054;font-size:14px;"><strong>Motivo:</strong> ${escaparHtmlCorreo(motivo)}</p>` : ""}
                ${urlSeguimiento ? botonHtml("Ver detalle del pedido", urlSeguimiento) : ""}
                ${avisoHtml("Si tienes dudas, contacta directamente a la tienda.")}
            `
        })
    });
}

// El cliente cancela su propio pedido (solo posible mientras sigue
// "pendiente", ver market-pedidos-server.js) -- este correo va al
// negocio, no al cliente, para que no lo empiecen a preparar.
function enviarCorreoPedidoCanceladoPorCliente(correo, { codigoRecogida, items, clienteNombre }) {
    return enviarCorreo({
        correo,
        asunto: `Pedido ${codigoRecogida} cancelado por el cliente`,
        html: envolverPlantilla({
            etiqueta: "Pedido cancelado",
            titulo: `El cliente canceló el pedido ${escaparHtmlCorreo(codigoRecogida)}`,
            saludo: escaparHtmlCorreo(clienteNombre),
            robot: "feliz",
            cuerpoHtml: `
                <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;margin:4px 0 10px;">
                    ${filasItemsPedidoMarket(items)}
                </table>
                ${avisoHtml("No es necesario prepararlo. Puedes verlo en la pantalla Pedidos de tu panel.")}
            `
        })
    });
}

// La solicitud viene del formulario publico de credito (sin sesion).
// A proposito NUNCA incluye las fotos de identificacion en el correo
// -- correo no es un canal seguro para documentos sensibles, se avisa
// que se revisen dentro del panel de Nexo.
function enviarCorreoSolicitudCreditoPublica(correo, nombreNegocio, { clienteNombre, clienteTelefono, clienteCorreo, direccion, montoSolicitado, comentario, tieneDocumentos }) {
    const telefonoLimpio = String(clienteTelefono || "").replace(/\D/g, "");
    const clienteSeguro = escaparHtmlCorreo(clienteNombre);
    const montoTexto = montoSolicitado ? `$${Number(montoSolicitado).toFixed(2)}` : "No especificado";

    return enviarCorreo({
        correo,
        asunto: `Nueva solicitud de credito -- ${clienteSeguro}`,
        html: envolverPlantilla({
            etiqueta: "Nueva solicitud de credito",
            titulo: "Nueva solicitud de credito desde tu sitio web",
            saludo: `Hola, ${nombreNegocio}`,
            robot: "neutral",
            cuerpoHtml: `
                <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;margin:4px 0 6px;">
                    <tr><td style="padding:6px 0;color:#344054;font-size:15px;"><strong>Nombre:</strong> ${clienteSeguro || "-"}</td></tr>
                    <tr><td style="padding:6px 0;color:#344054;font-size:15px;"><strong>Telefono:</strong> ${escaparHtmlCorreo(clienteTelefono) || "-"}</td></tr>
                    <tr><td style="padding:6px 0;color:#344054;font-size:15px;"><strong>Correo:</strong> ${escaparHtmlCorreo(clienteCorreo) || "-"}</td></tr>
                    <tr><td style="padding:6px 0;color:#344054;font-size:15px;"><strong>Direccion:</strong> ${escaparHtmlCorreo(direccion) || "-"}</td></tr>
                    <tr><td style="padding:6px 0;color:#344054;font-size:15px;"><strong>Monto solicitado:</strong> ${montoTexto}</td></tr>
                    <tr><td style="padding:6px 0;color:#344054;font-size:15px;"><strong>Comentario:</strong> ${escaparHtmlCorreo(comentario) || "(sin comentario)"}</td></tr>
                </table>
                <table role="presentation" cellpadding="0" cellspacing="0" style="margin:6px 0 4px;">
                    <tr>
                        ${telefonoLimpio ? `
                        <td style="padding-right:10px;border-radius:12px;background:#16a34a;">
                            <a href="https://wa.me/52${telefonoLimpio}" style="display:inline-block;padding:12px 22px;color:#ffffff;text-decoration:none;font-weight:800;font-size:14px;border-radius:12px;">Responder por WhatsApp</a>
                        </td>` : ""}
                        ${clienteCorreo ? `
                        <td style="border-radius:12px;background:linear-gradient(135deg,#0d6efd,#0b5ed7);">
                            <a href="mailto:${escaparHtmlCorreo(clienteCorreo)}" style="display:inline-block;padding:12px 22px;color:#ffffff;text-decoration:none;font-weight:800;font-size:14px;border-radius:12px;">Responder por correo</a>
                        </td>` : ""}
                    </tr>
                </table>
                ${avisoHtml(tieneDocumentos
                    ? "El cliente adjunto su identificacion oficial. Por seguridad, no se envia por correo -- revisala desde tu panel de Nexo, en Sitio web > Solicitudes de credito."
                    : "El cliente no adjunto identificacion. Puedes revisar el detalle completo desde tu panel de Nexo, en Sitio web > Solicitudes de credito.")}
            `
        })
    });
}

module.exports = {
    enviarCorreoVerificacion,
    enviarCorreoVerificacionPersona,
    enviarCorreoBienvenida,
    enviarCorreoRecuperacion,
    enviarCorreoActivacionCuenta,
    enviarCorreoRespaldo,
    enviarCorreoPagoFallido,
    enviarCorreoPagoConfirmado,
    enviarCorreoPruebaPorTerminar,
    enviarCorreoLeadLanding,
    enviarCorreoPedidoPublico,
    enviarCorreoPedidoCarritoPublico,
    enviarCorreoSolicitudCreditoPublica,
    enviarCorreoCotizacionRespondida,
    enviarCorreoPedidoRecibido,
    enviarCorreoPedidoConfirmado,
    enviarCorreoPedidoListo,
    enviarCorreoPedidoEntregado,
    enviarCorreoPedidoCancelado,
    enviarCorreoPedidoCanceladoPorCliente
};
