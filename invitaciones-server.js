const crypto = require("crypto");
const { responderError } = require("./error-utils");
const { normalizarSlug, SUBDOMINIOS_RESERVADOS } = require("./tenant");
const { hashPassword } = require("./password-utils");
const { enviarCorreoInvitacionPiloto, enviarCorreoEnlaceInvitacion } = require("./email");
const {
    DIAS_PRUEBA_PILOTO,
    CUOTA_MENSUAL_PILOTO,
    QUE_CUBRE_CUOTA,
    ejemploCondiciones,
    fechaFinPrueba,
    fechaLarga
} = require("./piloto-condiciones");

// Invitaciones a negocios piloto.
//
//   1. El negocio llena "Quiero participar" en la pagina publica
//      (contactos_landing).
//   2. El admin acepta la solicitud (POST /admin/api/solicitudes-participacion/
//      :id/invitar): se genera una invitacion con un enlace personal y se manda
//      por correo.
//   3. El negocio abre /invitacion/:token, ve sus datos ya cargados, elige su
//      contrasena y configura su cuenta (POST /api/invitaciones/:token/
//      configurar). La cuenta nace con licencia de prueba SIN vencimiento
//      (todas las funciones; Nexo IA con su tope mensual de prueba).
//   4. Desde ese momento el mismo enlace solo muestra la descarga del
//      instalador: el estado vive en el servidor, asi que abrirlo en otro
//      dispositivo (por ejemplo, configurar en el celular y descargar en la PC)
//      NUNCA vuelve a pedir datos.
//
// El token solo existe en claro en el correo y en la respuesta del admin: en la
// base de datos se guarda su hash SHA-256.

const VIGENCIA_DIAS = 14;
const URL_SITIO = (process.env.PUBLIC_SITE_URL || "https://nexoposoficial.com").replace(/\/$/, "");
const REGEX_CORREO = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const REGEX_TOKEN = /^[A-Za-z0-9_-]{20,100}$/;

const { CONTENIDO: CONTENIDO_GIRO, normalizar: normalizarGiroSitio } = require("./public/site/giro-contenido.js");

const GIROS = [
    { valor: "ferreteria", etiqueta: "Ferreteria" },
    { valor: "abarrotes", etiqueta: "Abarrotes" },
    { valor: "ambos", etiqueta: "Ferreteria y abarrotes (ambos)" },
    { valor: "papeleria", etiqueta: "Papeleria" },
    { valor: "vinateria", etiqueta: "Vinateria" },
    { valor: "general", etiqueta: "Otro / general" }
];
const GIROS_VALIDOS = new Set(GIROS.map(g => g.valor));

function limpiar(valor, max = 160) {
    return String(valor ?? "")
        .replace(/[\u0000-\u001f\u007f]/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, max);
}

function escapar(valor) {
    return String(valor ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

function hashToken(token) {
    return crypto.createHash("sha256").update(String(token)).digest("hex");
}

function nuevoToken() {
    return crypto.randomBytes(32).toString("base64url");
}

function giroDesdeTexto(texto) {
    // Ferreteria + abarrotes ("ambos"): una sola cuenta con el programa completo y las dos categorias.
    if (normalizarGiroSitio(texto) === "ambos") return "ambos";

    const t = String(texto || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

    if (t.includes("ferret")) return "ferreteria";
    if (t.includes("abarrote")) return "abarrotes";
    if (t.includes("papeler")) return "papeleria";
    if (t.includes("vinater")) return "vinateria";
    return "general";
}

// El formulario publico manda giro, ciudad, sistema actual y problema dentro de
// "mensaje" como "Giro: X | Ciudad: Y | ..." (el backend de contactos solo tiene
// un campo de texto). Aqui se vuelven a separar.
function camposDelMensaje(mensaje) {
    const campos = {};

    for (const parte of String(mensaje || "").split(" | ")) {
        const indice = parte.indexOf(": ");
        if (indice > 0) campos[parte.slice(0, indice).trim().toLowerCase()] = parte.slice(indice + 2).trim();
    }

    return campos;
}

function crearLimitador(maximo, ventanaMs) {
    const registro = new Map();

    return {
        excedido(clave) {
            const ahora = Date.now();
            const recientes = (registro.get(clave) || []).filter(t => ahora - t < ventanaMs);
            registro.set(clave, recientes);
            return recientes.length >= maximo;
        },
        registrar(clave) {
            const lista = registro.get(clave) || [];
            lista.push(Date.now());
            registro.set(clave, lista);
        }
    };
}

function generarLicenciaKey() {
    return ["NXP", crypto.randomBytes(3).toString("hex"), crypto.randomBytes(3).toString("hex"), crypto.randomBytes(3).toString("hex")]
        .join("-").toUpperCase();
}

async function licenciaUnica(client) {
    for (let intento = 0; intento < 8; intento += 1) {
        const clave = generarLicenciaKey();
        const existe = await client.query("SELECT 1 FROM public.licencias WHERE license_key = $1 LIMIT 1", [clave]);
        if (existe.rows.length === 0) return clave;
    }

    throw new Error("No se pudo generar una licencia unica");
}

async function instaladorActual(pool) {
    const version = await pool.query(
        `SELECT version, url_descarga, archivo
         FROM public.app_versiones
         WHERE canal = 'stable' AND plataforma = 'windows' AND publicada = true
         ORDER BY created_at DESC, id DESC
         LIMIT 1`
    );

    const fila = version.rows[0];

    return {
        version: fila?.version || "",
        url: fila?.url_descarga || "/downloads/NexoPOS_Setup_1.0.0.exe",
        archivo: fila?.archivo || "NexoPOS_Setup_1.0.0.exe"
    };
}

// ---------------------------------------------------------------------
// Paginas
// ---------------------------------------------------------------------

function envoltura({ titulo, cuerpo, script = "", giro = "" }) {
    const giroSitio = normalizarGiroSitio(giro);
    const atributoGiro = giroSitio ? ` data-giro-forzado="${giroSitio}"` : "";

    return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<meta name="referrer" content="no-referrer">
<title>${escapar(titulo)} — Nexo</title>
<link rel="icon" href="/nexo-pos-icon.jpg">
<link rel="stylesheet" href="/site/styles.css">
<style>
.inv-main { max-width: 640px; margin: 0 auto; padding: clamp(24px, 5vw, 56px) 18px 64px; }
.inv-saludo { margin: 0 0 6px; color: var(--blue); font-weight: 900; letter-spacing: .08em; text-transform: uppercase; font-size: 12px; }
.inv-main h1 { font-size: clamp(30px, 6vw, 44px); line-height: 1.05; margin-bottom: 12px; }
.inv-lead { color: var(--muted); font-weight: 700; line-height: 1.55; margin-bottom: 20px; }
.inv-bloque { margin-top: 18px; padding: 18px; border: 1px solid var(--line); border-radius: 20px; background: var(--glass); }
.inv-bloque h2 { font-size: 19px; margin-bottom: 8px; }
.inv-bloque p { color: var(--muted); font-weight: 700; line-height: 1.5; margin-bottom: 10px; }
.inv-lista { margin: 0 0 12px; padding-left: 20px; color: var(--muted); font-weight: 700; line-height: 1.55; }
.inv-lista li { margin-bottom: 6px; }
.inv-acciones { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 8px; }
.inv-acciones .btn { cursor: pointer; border: 0; }
.inv-solo-lectura { background: rgba(20, 32, 51, .06) !important; }
.inv-ayuda { margin: 0; color: var(--muted); font-size: 12.5px; font-weight: 700; line-height: 1.5; }
.inv-recorrido { display: flex; align-items: center; gap: 16px; margin: 0 0 22px; padding: 14px 18px; border-radius: 22px; background: linear-gradient(160deg, #e9f2ff, #d4e6ff); }
.inv-mascota { width: 92px; height: auto; flex: none; filter: drop-shadow(0 12px 16px rgba(7, 63, 154, .25)); animation: invFlotar 4.5s ease-in-out infinite; }
.inv-burbuja { position: relative; padding: 12px 16px; border-radius: 16px; background: #fff; color: var(--ink); font-weight: 800; line-height: 1.4; box-shadow: 0 10px 24px rgba(7, 63, 154, .14); animation: invBurbuja .5s .2s cubic-bezier(.2, .9, .3, 1.2) both; }
.inv-etapas { display: flex; align-items: center; gap: 6px; margin: 0 0 22px; font-size: 12px; font-weight: 800; color: #94a3b8; }
.inv-etapa { display: inline-flex; align-items: center; gap: 6px; white-space: nowrap; }
.inv-etapa b { width: 24px; height: 24px; border-radius: 50%; display: grid; place-items: center; background: #e2e8f0; color: #64748b; font-size: 11px; }
.inv-etapa.actual { color: var(--ink); }
.inv-etapa.actual b { background: var(--blue); color: #fff; }
.inv-linea { flex: 1; min-width: 8px; height: 2px; background: #e2e8f0; border-radius: 2px; }
@keyframes invFlotar { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-8px); } }
@keyframes invBurbuja { 0% { opacity: 0; transform: translateY(8px) scale(.94); } 100% { opacity: 1; transform: none; } }
@media (max-width: 560px) { .inv-etapa span { display: none; } .inv-etapa.actual span { display: inline; } .inv-mascota { width: 72px; } }
@media (prefers-reduced-motion: reduce) { .inv-mascota, .inv-burbuja { animation: none; } }
</style>
</head>
<body${atributoGiro}>
<header class="site-header">
  <a class="brand" href="/" aria-label="Nexo"><img src="/nexo-pos-icon.jpg" alt="Nexo"><span>Nexo</span></a>
</header>
<main class="inv-main">
${cuerpo}
</main>
<script src="/site/giro-contenido.js?v=giro-20261030-01"></script>
<script src="/site/site-giro.js?v=giro-20261030-01"></script>
${script ? `<script>\n${script}\n</script>` : ""}
</body>
</html>`;
}

function paginaEnlaceInvalido(mensaje) {
    return envoltura({
        titulo: "Enlace no disponible",
        cuerpo: `
<p class="inv-saludo">Invitación a las pruebas</p>
<h1>Este enlace ya no está disponible</h1>
<p class="inv-lead">${escapar(mensaje)}</p>
<div class="inv-acciones"><a class="btn primary" href="/#participa">Ir a la página de Nexo</a></div>`
    });
}

// Encabezado del recorrido: mismo camino de 4 etapas que se ve dentro de Nexo
// (Tu cuenta -> Tu perfil -> Tu negocio -> A vender), con la mascota como guia.
function cabeceraRecorrido(frase) {
    const etapas = ["Tu cuenta", "Tu perfil", "Tu negocio", "¡A vender!"]
        .map((nombre, i) => `${i > 0 ? '<span class="inv-linea"></span>' : ""}<span class="inv-etapa${i === 0 ? " actual" : ""}"${i === 0 ? ' aria-current="step"' : ""}><b>${i + 1}</b><span>${nombre}</span></span>`)
        .join("");

    return `
<div class="inv-recorrido">
  <img class="inv-mascota" src="/img/nexo-ia/celebrando-transparente.png" alt="Nexo, tu asistente">
  <div class="inv-burbuja">${escapar(frase)}</div>
</div>
<div class="inv-etapas" aria-label="Tu recorrido">${etapas}</div>`;
}

// Condiciones de la prueba. Con `inicioReal` (cuenta ya configurada) muestra las
// fechas de esa persona; sin el, un ejemplo fijo y facil de seguir.
function bloqueCondiciones(inicioReal) {
    const ej = ejemploCondiciones();
    const ejemplo = inicioReal
        ? `Tu prueba sin costo termina el <strong>${escapar(fechaLarga(fechaFinPrueba(inicioReal)))}</strong>. Si decides seguir, tu primer cobro de $${CUOTA_MENSUAL_PILOTO} sería ese día y después el mismo día de cada mes.`
        : `<strong>Ejemplo:</strong> si configuras tu negocio el ${ej.inicio}, pruebas sin costo hasta el ${ej.fin}. Si decides seguir, tu primer cobro de $${CUOTA_MENSUAL_PILOTO} sería el ${ej.fin} y después el día ${ej.diaCobro} de cada mes.`;

    return `
<div class="inv-bloque" id="invCondiciones">
  <h2>Cómo funciona la prueba</h2>
  <ul class="inv-lista">
    <li>Son <strong>${DIAS_PRUEBA_PILOTO} días sin costo</strong>, contados desde que configuras tu negocio. No necesitas tarjeta para empezar.</li>
    <li>Unos días antes de que termine te avisamos por correo y te preguntamos cómo te fue.</li>
    <li>Si decides seguir, la cuota es de <strong>$${CUOTA_MENSUAL_PILOTO} al mes</strong>. Ese dinero cubre lo que cuesta mantener tu sistema: ${QUE_CUBRE_CUOTA}.</li>
    <li>Si no quieres seguir, no pagas nada.</li>
  </ul>
  <p class="inv-ayuda">${ejemplo}</p>
</div>`;
}

function paginaPendiente(inv, token) {
    const opcionesGiro = GIROS.map(g =>
        `<option value="${g.valor}"${g.valor === inv.giro ? " selected" : ""}>${g.etiqueta}</option>`
    ).join("");

    return envoltura({
        titulo: "Configura tu negocio",
        giro: inv.giro,
        cuerpo: `
${cabeceraRecorrido("¡Hola! Soy Nexo. En un minuto dejamos lista tu cuenta y te acompaño en lo que sigue.")}
<p class="inv-saludo">Invitación a las pruebas</p>
<h1>Hola ${escapar(inv.nombre)} 👋</h1>
<p class="inv-lead">Los desarrolladores de Nexo aceptaron tu participación en las pruebas. Configura tu negocio: tus datos ya vienen cargados, solo revísalos y elige tu contraseña.</p>
<div class="inv-bloque" id="invPerfil">
  <h2>Tu cuenta: <span data-giro-campo="nombre">según tu giro</span></h2>
  <p data-giro-campo="correo">Elige el giro de tu negocio en el formulario y adaptamos tu cuenta a él.</p>
</div>
${bloqueCondiciones()}

<form class="lead-form" id="invForm" data-token="${escapar(token)}">
  <label>Nombre del negocio<input id="invNegocio" type="text" value="${escapar(inv.negocio)}" maxlength="140" required></label>
  <label>Giro del negocio<select id="invGiro">${opcionesGiro}</select></label>
  <label>Tu nombre<input id="invNombre" type="text" value="${escapar(inv.nombre)}" maxlength="120" required></label>
  <label>Teléfono<input id="invTelefono" type="tel" value="${escapar(inv.telefono)}" maxlength="40" required></label>
  <label>Ciudad<input id="invCiudad" type="text" value="${escapar(inv.ciudad)}" maxlength="180"></label>
  <label>Correo (con él iniciarás sesión)<input id="invCorreo" type="email" class="inv-solo-lectura" value="${escapar(inv.correo)}" readonly></label>
  <label>Elige tu contraseña<input id="invPassword" type="password" placeholder="Mínimo 8 caracteres" minlength="8" autocomplete="new-password" required></label>
  <label>Repite tu contraseña<input id="invPassword2" type="password" placeholder="Repite tu contraseña" minlength="8" autocomplete="new-password" required></label>
  <label class="lead-consent">
    <input id="invTerminos" type="checkbox" required>
    <span>Acepto los <a href="/terminos" target="_blank" rel="noopener">Términos de Servicio</a> y el <a href="/privacidad" target="_blank" rel="noopener">Aviso de Privacidad</a> de Nexo.</span>
  </label>
  <button class="btn primary" type="submit" id="invEnviar">Configurar mi negocio</button>
  <div id="invResultado" class="lead-result" aria-live="polite"></div>
</form>

<div class="inv-bloque" id="invAvisoMovil" hidden>
  <h2>¿Estás en el celular?</h2>
  <p>Puedes configurar tu negocio desde aquí sin problema. Nexo se instala en una <strong>computadora con Windows</strong>: cuando termines te mostraremos cómo descargarlo después.</p>
</div>
<p class="inv-ayuda">Este enlace es personal y vence el ${escapar(inv.venceTexto)}.</p>`,
        script: `
(function () {
  var form = document.getElementById("invForm");
  var token = form.getAttribute("data-token");
  var boton = document.getElementById("invEnviar");
  var resultado = document.getElementById("invResultado");
  var ua = navigator.userAgent || "";
  var movil = /Android|iPhone|iPad|iPod|Mobile/i.test(ua);
  if (movil) document.getElementById("invAvisoMovil").hidden = false;

  var selectGiro = document.getElementById("invGiro");
  if (selectGiro && window.NEXO_GIRO && window.nexoGiro) {
    selectGiro.addEventListener("change", function () {
      var clave = window.NEXO_GIRO.normalizar(selectGiro.value);
      if (clave) window.nexoGiro.elegir(clave);
    });
  }

  function mostrar(mensaje, error) {
    resultado.classList.toggle("error", !!error);
    resultado.textContent = mensaje;
  }

  form.addEventListener("submit", async function (evento) {
    evento.preventDefault();

    var password = document.getElementById("invPassword").value;
    if (password !== document.getElementById("invPassword2").value) {
      mostrar("Las contraseñas no coinciden.", true);
      return;
    }

    boton.disabled = true;
    mostrar("Configurando tu negocio...", false);

    try {
      var respuesta = await fetch("/api/invitaciones/" + encodeURIComponent(token) + "/configurar", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          nombreNegocio: document.getElementById("invNegocio").value,
          giro: document.getElementById("invGiro").value,
          nombreContacto: document.getElementById("invNombre").value,
          telefono: document.getElementById("invTelefono").value,
          ciudad: document.getElementById("invCiudad").value,
          password: password,
          confirmarPassword: document.getElementById("invPassword2").value,
          aceptaTerminos: document.getElementById("invTerminos").checked
        })
      });
      var datos = await respuesta.json().catch(function () { return {}; });

      // Ya configurada (por ejemplo en otro dispositivo): se muestra la descarga.
      if (respuesta.ok || datos.codigo === "ya_configurada") {
        location.reload();
        return;
      }

      throw new Error(datos.error || "No se pudo configurar tu negocio. Intenta de nuevo.");
    } catch (error) {
      mostrar(error.message, true);
      boton.disabled = false;
    }
  });
})();`
    });
}

function paginaConfigurada(inv, token, instalador) {
    return envoltura({
        titulo: "Tu negocio está listo",
        giro: inv.giro,
        cuerpo: `
${cabeceraRecorrido("¡Listo! Ahora descarga Nexo en tu computadora e inicia sesión: desde ahí yo te guío paso a paso.")}
<p class="inv-saludo">Invitación a las pruebas</p>
<h1>Tu negocio ya está configurado ✓</h1>
<p class="inv-lead">Hola ${escapar(inv.nombre)}: solo falta instalar Nexo e iniciar sesión. No tienes que volver a escribir tus datos.</p>
${bloqueCondiciones(inv.configurada_at)}

<div class="inv-bloque" id="bloqueWindows">
  <h2>1. Descarga Nexo en tu computadora</h2>
  <p>Funciona en computadoras con Windows.</p>
  <div class="inv-acciones">
    <a class="btn primary registro-descarga-btn" href="${escapar(instalador.url)}" download>&#11015; Descargar Nexo para Windows</a>
  </div>
  <div class="registro-aviso-windows">
    <strong>&#9888; Windows puede mostrar una advertencia al abrir el instalador</strong>
    <p>Somos una empresa nueva y todavía no tenemos el certificado de Microsoft (cuesta miles de pesos al año): tu descarga es segura. Solo haz clic en <b>"Más información"</b> y después en <b>"Ejecutar de todas formas"</b>.</p>
  </div>
  <ol class="registro-pasos">
    <li>Abre el archivo que descargaste e instala Nexo.</li>
    <li>Abre Nexo e inicia sesión con tu correo <b>${escapar(inv.correo)}</b> y la contraseña que elegiste.</li>
    <li>Elige el nombre y el PIN de tu usuario administrador, ahí mismo, la primera vez. Después te guiamos para dejar tu negocio listo.</li>
  </ol>
</div>

<div class="inv-bloque" id="invPrimerosPasos">
  <h2>Después de instalar: tu primera semana</h2>
  <p data-giro-campo="sigue">Después de instalar, Nexo te ayuda a cargar tu inventario y a dejar tu negocio listo.</p>
  <ol class="registro-pasos" data-giro-pasos>
    <li>Carga tu inventario.</li>
    <li>Registra a tus clientes.</li>
    <li>Haz tu primera venta.</li>
  </ol>
</div>

<div class="inv-bloque" id="bloqueMovil" hidden>
  <h2>Estás en el celular</h2>
  <p>Nexo se instala en una <strong>computadora con Windows</strong>. Abre este mismo enlace desde tu computadora para descargarlo, o pide que te lo enviemos a tu correo.</p>
  <div class="inv-acciones">
    <button type="button" class="btn primary" id="invEnviarEnlace" data-token="${escapar(token)}">Enviarme el enlace por correo</button>
    <button type="button" class="btn secondary" id="invCopiar">Copiar enlace</button>
  </div>
  <div id="invEnlaceResultado" class="lead-result" aria-live="polite"></div>
</div>

<div class="inv-bloque" id="bloqueOtro" hidden>
  <h2>Este equipo no es Windows</h2>
  <p>Por ahora Nexo solo se instala en computadoras con Windows. Abre este enlace desde una computadora con Windows para descargarlo.</p>
</div>`,
        script: `
(function () {
  var ua = navigator.userAgent || "";
  var movil = /Android|iPhone|iPad|iPod|Mobile/i.test(ua);
  var windows = /Windows/i.test(ua);
  var bloqueWindows = document.getElementById("bloqueWindows");
  var bloqueMovil = document.getElementById("bloqueMovil");
  var bloqueOtro = document.getElementById("bloqueOtro");

  // Desde el celular (o un equipo que no es Windows) descargar el instalador no
  // sirve: se muestra solo lo que si puede hacer ahi.
  if (movil) {
    bloqueWindows.hidden = true;
    bloqueMovil.hidden = false;
  } else if (!windows) {
    bloqueWindows.hidden = true;
    bloqueOtro.hidden = false;
  }

  var enviar = document.getElementById("invEnviarEnlace");
  var resultado = document.getElementById("invEnlaceResultado");

  function mostrar(mensaje, error) {
    resultado.classList.toggle("error", !!error);
    resultado.textContent = mensaje;
  }

  if (enviar) {
    enviar.addEventListener("click", async function () {
      enviar.disabled = true;
      mostrar("Enviando...", false);

      try {
        var respuesta = await fetch("/api/invitaciones/" + encodeURIComponent(enviar.getAttribute("data-token")) + "/enviar-enlace", { method: "POST" });
        var datos = await respuesta.json().catch(function () { return {}; });

        // Solo se confirma si el servidor logro enviar el correo.
        if (!respuesta.ok || datos.ok === false) throw new Error(datos.error || "No se pudo enviar el correo.");

        mostrar("Listo: te enviamos el enlace a tu correo. Ábrelo desde tu computadora.", false);
      } catch (error) {
        mostrar(error.message, true);
      } finally {
        enviar.disabled = false;
      }
    });
  }

  var copiar = document.getElementById("invCopiar");
  if (copiar) {
    copiar.addEventListener("click", async function () {
      try {
        await navigator.clipboard.writeText(location.href);
        mostrar("Enlace copiado. Pégalo en el navegador de tu computadora.", false);
      } catch (error) {
        mostrar("No se pudo copiar automáticamente. Selecciona la dirección del navegador y cópiala.", true);
      }
    });
  }
})();`
    });
}

// ---------------------------------------------------------------------
// Rutas
// ---------------------------------------------------------------------

module.exports = (app, pool) => {
    const limitadorConfigurar = crearLimitador(15, 60 * 60 * 1000);
    const limitadorEnviarEnlace = crearLimitador(3, 60 * 60 * 1000);

    async function buscarInvitacion(token) {
        if (!REGEX_TOKEN.test(String(token || ""))) return null;

        const fila = await pool.query(
            `SELECT * FROM public.invitaciones_piloto WHERE token_hash = $1`,
            [hashToken(token)]
        );

        return fila.rows[0] || null;
    }

    function estaVencida(inv) {
        return inv.estado === "pendiente" && new Date(inv.expira_at).getTime() < Date.now();
    }

    function sinCache(res) {
        res.set({
            "Cache-Control": "no-store",
            "Referrer-Policy": "no-referrer",
            "X-Robots-Tag": "noindex, nofollow"
        });
    }

    // ----- Panel de administracion (protegido por /admin/api -> validarAdminKey)

    app.get("/admin/api/solicitudes-participacion", async (_req, res) => {
        try {
            const filas = await pool.query(
                `SELECT c.id, c.nombre, c.negocio, c.telefono, c.correo, c.mensaje, c.descartada, c.created_at,
                        i.estado AS invitacion_estado, i.expira_at, i.enviada_at, i.configurada_at, i.negocio_id
                 FROM public.contactos_landing c
                 LEFT JOIN LATERAL (
                     SELECT * FROM public.invitaciones_piloto WHERE contacto_id = c.id ORDER BY id DESC LIMIT 1
                 ) i ON true
                 ORDER BY c.created_at DESC
                 LIMIT 300`
            );

            res.json({
                ok: true,
                solicitudes: filas.rows.map(fila => {
                    const campos = camposDelMensaje(fila.mensaje);
                    const vencida = fila.invitacion_estado === "pendiente" && new Date(fila.expira_at).getTime() < Date.now();

                    return {
                        id: fila.id,
                        nombre: fila.nombre,
                        negocio: fila.negocio,
                        telefono: fila.telefono,
                        correo: fila.correo,
                        giro: campos.giro || "",
                        ciudad: campos.ciudad || "",
                        sistemaActual: campos["sistema actual"] || "",
                        problema: campos.problema || "",
                        mensaje: campos.mensaje || (Object.keys(campos).length ? "" : fila.mensaje),
                        descartada: fila.descartada,
                        creadaEn: fila.created_at,
                        estado: fila.descartada
                            ? "descartada"
                            : fila.invitacion_estado === "configurada"
                                ? "configurada"
                                : vencida
                                    ? "vencida"
                                    : fila.invitacion_estado === "pendiente"
                                        ? "invitada"
                                        : "nueva",
                        invitacion: fila.invitacion_estado
                            ? { estado: fila.invitacion_estado, venceEn: fila.expira_at, enviadaEn: fila.enviada_at, configuradaEn: fila.configurada_at, negocioId: fila.negocio_id }
                            : null
                    };
                })
            });
        } catch (error) {
            responderError(res, error);
        }
    });

    // Aceptar (o reenviar): siempre genera un enlace NUEVO y revoca el anterior
    // que siguiera pendiente. Responde el enlace completo para poder copiarlo y
    // mandarlo por WhatsApp si el correo no salio.
    app.post("/admin/api/solicitudes-participacion/:id/invitar", async (req, res) => {
        const id = Number(req.params.id);

        if (!Number.isInteger(id) || id <= 0) {
            res.status(404).json({ ok: false, error: "Solicitud no encontrada." });
            return;
        }

        const client = await pool.connect();
        let invitacion;
        let token;

        try {
            await client.query("BEGIN");

            const contacto = (await client.query(
                `SELECT * FROM public.contactos_landing WHERE id = $1 FOR UPDATE`,
                [id]
            )).rows[0];

            if (!contacto) {
                await client.query("ROLLBACK");
                res.status(404).json({ ok: false, error: "Solicitud no encontrada." });
                return;
            }

            // Corregir el correo (el que dejaron estaba mal escrito) o armar solo el enlace para WhatsApp.
            const sinCorreo = req.body?.sinCorreo === true;
            const correoCorregido = limpiar(req.body?.correo, 140).toLowerCase();
            const correo = correoCorregido || limpiar(contacto.correo, 140).toLowerCase();

            if (!correo || !REGEX_CORREO.test(correo)) {
                await client.query("ROLLBACK");
                res.status(400).json({ ok: false, error: "Esta solicitud no tiene un correo valido: escribe uno correcto para enviar la invitacion." });
                return;
            }

            if (correoCorregido && correoCorregido !== limpiar(contacto.correo, 140).toLowerCase()) {
                await client.query(`UPDATE public.contactos_landing SET correo = $1 WHERE id = $2`, [correoCorregido, id]);
            }

            const yaConfigurada = await client.query(
                `SELECT 1 FROM public.invitaciones_piloto WHERE contacto_id = $1 AND estado = 'configurada' LIMIT 1`,
                [id]
            );

            if (yaConfigurada.rows.length > 0) {
                await client.query("ROLLBACK");
                res.status(409).json({ ok: false, error: "Este negocio ya configuro su cuenta." });
                return;
            }

            const cuentaExistente = await client.query(
                `SELECT 1 FROM public.negocios WHERE LOWER(correo) = $1 LIMIT 1`,
                [correo]
            );

            if (cuentaExistente.rows.length > 0) {
                await client.query("ROLLBACK");
                res.status(409).json({ ok: false, error: "Ya existe una cuenta con ese correo." });
                return;
            }

            await client.query(
                `UPDATE public.invitaciones_piloto SET estado = 'revocada' WHERE contacto_id = $1 AND estado = 'pendiente'`,
                [id]
            );

            const campos = camposDelMensaje(contacto.mensaje);
            const giroInvitacion = giroDesdeTexto(campos.giro);
            token = nuevoToken();

            invitacion = (await client.query(
                `INSERT INTO public.invitaciones_piloto
                    (contacto_id, token_hash, nombre, negocio, correo, telefono, giro, ciudad, expira_at)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW() + ($9::int * INTERVAL '1 day'))
                 RETURNING id, expira_at`,
                [
                    id,
                    hashToken(token),
                    limpiar(contacto.nombre, 120) || "Hola",
                    limpiar(contacto.negocio, 140),
                    correo,
                    limpiar(contacto.telefono, 40),
                    giroInvitacion,
                    limpiar(campos.ciudad, 180),
                    VIGENCIA_DIAS
                ]
            )).rows[0];

            await client.query(
                `UPDATE public.contactos_landing SET atendido = true, descartada = false WHERE id = $1`,
                [id]
            );

            await client.query("COMMIT");

            const enlace = `${URL_SITIO}/invitacion/${token}`;
            let envio = { ok: false, error: "No se pudo enviar el correo." };

            if (sinCorreo) {
                await pool.query(`UPDATE public.invitaciones_piloto SET enviada_at = NOW() WHERE id = $1`, [invitacion.id]);
                res.json({ ok: true, enlace, correoEnviado: false, aviso: null, venceEn: invitacion.expira_at });
                return;
            }

            try {
                envio = await enviarCorreoInvitacionPiloto({
                    correo,
                    nombre: limpiar(contacto.nombre, 120),
                    negocio: limpiar(contacto.negocio, 140),
                    enlace,
                    vigenciaDias: VIGENCIA_DIAS,
                    giro: giroInvitacion
                });
            } catch (error) {
                envio = { ok: false, error: error.message };
            }

            if (envio.ok) {
                await pool.query(`UPDATE public.invitaciones_piloto SET enviada_at = NOW() WHERE id = $1`, [invitacion.id]);
            }

            res.json({
                ok: true,
                enlace,
                correoEnviado: Boolean(envio.ok),
                aviso: envio.ok ? null : "La invitacion se creo, pero el correo no salio. Copia el enlace y mandalo por WhatsApp.",
                venceEn: invitacion.expira_at
            });
        } catch (error) {
            await client.query("ROLLBACK").catch(() => {});
            responderError(res, error);
        } finally {
            client.release();
        }
    });

    app.post("/admin/api/solicitudes-participacion/:id/descartar", async (req, res) => {
        const id = Number(req.params.id);

        if (!Number.isInteger(id) || id <= 0) {
            res.status(404).json({ ok: false, error: "Solicitud no encontrada." });
            return;
        }

        try {
            const resultado = await pool.query(
                `UPDATE public.contactos_landing SET descartada = true, atendido = true WHERE id = $1 RETURNING id`,
                [id]
            );

            if (resultado.rows.length === 0) {
                res.status(404).json({ ok: false, error: "Solicitud no encontrada." });
                return;
            }

            await pool.query(
                `UPDATE public.invitaciones_piloto SET estado = 'revocada' WHERE contacto_id = $1 AND estado = 'pendiente'`,
                [id]
            );

            res.json({ ok: true });
        } catch (error) {
            responderError(res, error);
        }
    });

    // ----- Pagina publica de la invitacion

    app.get("/invitacion/:token", async (req, res) => {
        sinCache(res);

        try {
            const inv = await buscarInvitacion(req.params.token);

            if (!inv) {
                res.status(404).send(paginaEnlaceInvalido("No encontramos esa invitación. Revisa que hayas copiado el enlace completo del correo."));
                return;
            }

            pool.query(`UPDATE public.invitaciones_piloto SET ultimo_acceso_at = NOW() WHERE id = $1`, [inv.id]).catch(() => {});

            if (inv.estado === "configurada") {
                res.send(paginaConfigurada(inv, req.params.token, await instaladorActual(pool)));
                return;
            }

            if (inv.estado === "revocada") {
                res.status(410).send(paginaEnlaceInvalido("Esta invitación fue reemplazada por una más reciente. Revisa tu correo: ahí está el enlace vigente."));
                return;
            }

            if (estaVencida(inv)) {
                res.status(410).send(paginaEnlaceInvalido("Este enlace venció. Escríbenos y te enviamos uno nuevo."));
                return;
            }

            res.send(paginaPendiente({
                ...inv,
                venceTexto: new Date(inv.expira_at).toLocaleDateString("es-MX", { day: "numeric", month: "long", year: "numeric", timeZone: "America/Mexico_City" })
            }, req.params.token));
        } catch (error) {
            console.error("Error mostrando invitacion:", error);
            res.status(500).send(paginaEnlaceInvalido("Ocurrió un error. Intenta de nuevo en un momento."));
        }
    });

    // ----- Configurar la cuenta desde la invitacion

    app.post("/api/invitaciones/:token/configurar", async (req, res) => {
        sinCache(res);

        const clave = req.ip;

        if (limitadorConfigurar.excedido(clave)) {
            res.status(429).json({ ok: false, error: "Demasiados intentos. Intenta de nuevo mas tarde." });
            return;
        }

        limitadorConfigurar.registrar(clave);

        const nombreNegocio = limpiar(req.body?.nombreNegocio, 140);
        const nombreContacto = limpiar(req.body?.nombreContacto, 120);
        const telefono = limpiar(req.body?.telefono, 40);
        const ciudad = limpiar(req.body?.ciudad, 180);
        const giroPedido = limpiar(req.body?.giro, 80);
        const giroElegido = GIROS_VALIDOS.has(giroPedido) ? giroPedido : "general";
        // "Ambos": el tipo principal es ferreteria (el programa completo) y abarrotes queda activo como giro extra.
        const giro = giroElegido === "ambos" ? "ferreteria" : giroElegido;
        const girosActivos = giroElegido === "ambos" ? ["ferreteria", "abarrotes"] : [giro];
        const password = String(req.body?.password || "");
        const confirmarPassword = String(req.body?.confirmarPassword || "");

        if (!nombreNegocio || !telefono) {
            res.status(400).json({ ok: false, error: "Escribe el nombre de tu negocio y un telefono." });
            return;
        }

        if (password.length < 8) {
            res.status(400).json({ ok: false, error: "La contrasena debe tener al menos 8 caracteres." });
            return;
        }

        if (password !== confirmarPassword) {
            res.status(400).json({ ok: false, error: "Las contrasenas no coinciden." });
            return;
        }

        if (req.body?.aceptaTerminos !== true) {
            res.status(400).json({ ok: false, error: "Debes aceptar los Terminos de Servicio y el Aviso de Privacidad." });
            return;
        }

        if (!REGEX_TOKEN.test(String(req.params.token || ""))) {
            res.status(404).json({ ok: false, error: "Invitacion no encontrada." });
            return;
        }

        const client = await pool.connect();

        try {
            await client.query("BEGIN");

            // La fila se bloquea: dos envios a la vez (doble clic, dos
            // dispositivos) nunca crean dos negocios.
            const inv = (await client.query(
                `SELECT * FROM public.invitaciones_piloto WHERE token_hash = $1 FOR UPDATE`,
                [hashToken(req.params.token)]
            )).rows[0];

            if (!inv) {
                await client.query("ROLLBACK");
                res.status(404).json({ ok: false, error: "Invitacion no encontrada." });
                return;
            }

            if (inv.estado === "configurada") {
                await client.query("ROLLBACK");
                res.status(409).json({ ok: false, codigo: "ya_configurada", error: "Este negocio ya esta configurado." });
                return;
            }

            if (inv.estado === "revocada" || estaVencida(inv)) {
                await client.query("ROLLBACK");
                res.status(410).json({ ok: false, error: "Esta invitacion ya no esta vigente. Pide una nueva." });
                return;
            }

            // El correo SIEMPRE es el de la invitacion, nunca el que mande el cliente.
            const correo = String(inv.correo).toLowerCase();

            const cuentaExistente = await client.query(
                `SELECT 1 FROM public.negocios WHERE LOWER(correo) = $1 LIMIT 1`,
                [correo]
            );

            if (cuentaExistente.rows.length > 0) {
                await client.query("ROLLBACK");
                res.status(409).json({ ok: false, error: "Ya existe una cuenta con ese correo." });
                return;
            }

            const slugBase = normalizarSlug(nombreNegocio);
            let slug = slugBase;
            let slugDisponible = false;

            for (let intento = 2; intento <= 50; intento += 1) {
                const existe = await client.query(`SELECT 1 FROM public.negocios WHERE slug = $1 LIMIT 1`, [slug]);

                if (existe.rows.length === 0 && !SUBDOMINIOS_RESERVADOS.has(slug)) {
                    slugDisponible = true;
                    break;
                }

                slug = `${slugBase}-${intento}`;
            }

            if (!slugDisponible) throw new Error("No se pudo generar un codigo unico para el negocio");

            // Mismas reglas que el registro publico: un negocio nuevo arranca
            // vendiendo al PUBLICO, y el giro elegido queda en negocio_giros.
            // Diferencias a proposito: el correo ya viene verificado (llego por
            // el enlace que se envio a esa direccion) y la licencia no vence.
            const negocio = (await client.query(
                `INSERT INTO public.negocios
                    (slug, nombre, giro, estado, plan, telefono, correo, password_hash, direccion, nivel_precio_por_defecto, correo_verificado, updated_at)
                 VALUES ($1, $2, $3, 'prueba', 'prueba', $4, $5, $6, $7, 'publico', true, NOW())
                 RETURNING id, slug, nombre`,
                [slug, nombreNegocio, giro, telefono, correo, hashPassword(password), ciudad || null]
            )).rows[0];

            for (const activo of girosActivos) {
                await client.query(
                    `INSERT INTO public.negocio_giros (negocio_id, giro, activo) VALUES ($1, $2, true)`,
                    [negocio.id, activo]
                );
            }

            await client.query(
                `INSERT INTO public.licencias
                    (negocio_id, license_key, estado, plan, fecha_vencimiento, gracia_dias, monto_mensual, notas, piloto, updated_at)
                 VALUES ($1, $2, 'activa', 'prueba', NOW() + make_interval(days => $4::int), 15, 0, $3, true, NOW())`,
                [negocio.id, await licenciaUnica(client), `Piloto por invitacion. Contacto: ${nombreContacto || inv.nombre}`, DIAS_PRUEBA_PILOTO]
            );

            await client.query(
                `UPDATE public.invitaciones_piloto
                 SET estado = 'configurada', negocio_id = $2, configurada_at = NOW()
                 WHERE id = $1`,
                [inv.id, negocio.id]
            );

            await client.query("COMMIT");

            res.status(201).json({ ok: true, negocio: { id: negocio.id, slug: negocio.slug, nombre: negocio.nombre } });
        } catch (error) {
            await client.query("ROLLBACK").catch(() => {});
            responderError(res, error);
        } finally {
            client.release();
        }
    });

    // Para quien configuro desde el celular: se manda el MISMO enlace al correo de
    // la invitacion (nunca a uno que mande el cliente) para abrirlo en la PC.
    app.post("/api/invitaciones/:token/enviar-enlace", async (req, res) => {
        sinCache(res);

        try {
            const inv = await buscarInvitacion(req.params.token);

            if (!inv || inv.estado !== "configurada") {
                res.status(404).json({ ok: false, error: "Invitacion no encontrada." });
                return;
            }

            const clave = hashToken(req.params.token);

            if (limitadorEnviarEnlace.excedido(clave)) {
                res.status(429).json({ ok: false, error: "Ya te enviamos el enlace varias veces. Revisa tu correo (y la carpeta de spam)." });
                return;
            }

            limitadorEnviarEnlace.registrar(clave);

            const envio = await enviarCorreoEnlaceInvitacion({
                correo: inv.correo,
                nombre: inv.nombre,
                enlace: `${URL_SITIO}/invitacion/${req.params.token}`
            });

            if (!envio.ok) {
                res.status(502).json({ ok: false, error: "No pudimos enviar el correo en este momento. Intenta de nuevo en unos minutos." });
                return;
            }

            res.json({ ok: true });
        } catch (error) {
            responderError(res, error);
        }
    });
};

module.exports.camposDelMensaje = camposDelMensaje;
module.exports.giroDesdeTexto = giroDesdeTexto;
