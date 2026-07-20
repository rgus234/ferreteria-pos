/* Pantalla "Cuenta": identidad del negocio, estado de la suscripcion y
   seguridad de la cuenta (correo, contrasena, sesiones/dispositivos).
   La parte de suscripcion sigue leyendo /licencia/estado (por slug,
   sin cambios). La parte de seguridad usa las rutas /cuenta/* nuevas,
   protegidas por el token de sesion que guarda iniciarSesionCuenta()
   -- si el negocio nunca inicio sesion con correo/contrasena (por
   ejemplo, negocios creados antes de este sistema) esa seccion
   invita a iniciar sesion en vez de fallar.

   Layout con pestanas (Resumen/Suscripcion/Seguridad/Dispositivos),
   mismo patron que .producto-tabs en ferretero-flow.js: los 4
   paneles se pintan de una sola vez en el DOM, cambiar de pestana
   solo alterna visibilidad -- sin refetch. */

function cuentaSesionToken() {
 return localStorage.getItem(CUENTA_SESION_TOKEN_KEY);
}

async function cuentaFetchAutenticado(url, opciones = {}) {
 const token = cuentaSesionToken();

 const respuesta = await fetch(url, {
  ...opciones,
  headers: {
   ...(opciones.headers || {}),
   Authorization: `Bearer ${token}`
  }
 });

 return respuesta.json();
}

window.cambiarTabCuentaPOS = function(tab) {
 document.querySelectorAll(".cuenta-tabs button").forEach(boton => {
  boton.classList.toggle("activo", boton.dataset.cuentaTab === tab);
 });
 document.querySelectorAll(".cuenta-tab-panel").forEach(panel => {
  panel.classList.toggle("activo", panel.dataset.cuentaPanel === tab);
 });
};

// Parser minimo de User-Agent (sin dependencia nueva) -- solo para
// mostrar "Windows - Chrome" en vez del string crudo. Nunca intenta
// sacar ubicacion geografica (no hay geoip en el proyecto).
function parsearUserAgentPOS(ua) {
 if (!ua) return "Dispositivo desconocido";

 const so =
 /windows/i.test(ua) ? "Windows" :
 /mac os/i.test(ua) ? "macOS" :
 /android/i.test(ua) ? "Android" :
 /iphone|ipad/i.test(ua) ? "iOS" :
 /linux/i.test(ua) ? "Linux" :
 "Otro sistema";

 const navegador =
 /edg\//i.test(ua) ? "Edge" :
 /chrome\//i.test(ua) ? "Chrome" :
 /firefox\//i.test(ua) ? "Firefox" :
 /safari\//i.test(ua) ? "Safari" :
 "Navegador";

 return `${so} - ${navegador}`;
}

function tiempoRelativoPOS(fechaIso) {
 if (!fechaIso) return "Sin registro";

 const minutos =
 Math.round((Date.now() - new Date(fechaIso).getTime()) / 60000);

 if (minutos < 2) return "Activo ahora";
 if (minutos < 60) return `Hace ${minutos} min`;

 const horas = Math.round(minutos / 60);
 if (horas < 24) return `Hace ${horas} h`;

 return `Hace ${Math.round(horas / 24)} dia(s)`;
}

async function mostrarCuenta() {
 if (typeof ocultarPantallasPrincipales === "function") {
  ocultarPantallasPrincipales();
 }

 const pantalla =
 document.getElementById("pantallaCuenta");

 if (!pantalla) return;

 pantalla.style.display = "block";

 if (typeof actualizarModuloActivoPOS === "function") {
  actualizarModuloActivoPOS("cuenta");
 }

 pantalla.innerHTML = `
 <div class="caja cuenta-shell">
  <h2>Cuenta</h2>
  <p class="cuenta-subtitulo">Cargando...</p>
 </div>
 `;

 try {
  const respuesta =
  await fetch("/licencia/estado");

  const datos =
  await respuesta.json();

  if (!datos.ok) {
   throw new Error(datos.error || "No se pudo cargar la cuenta");
  }

  renderCuentaPOS(datos.negocio, datos.licencia);
 } catch (error) {
  pantalla.innerHTML = `
  <div class="caja cuenta-shell">
   <h2>Cuenta</h2>
   <p class="cuenta-subtitulo">No se pudo cargar la informacion de la cuenta. Intenta de nuevo.</p>
  </div>
  `;
 }
}

function estadoLicenciaCuentaPOS(modo) {
 const mapa = {
  normal: ["Al corriente", "cuenta-pill-normal"],
  gracia: ["Periodo de gracia", "cuenta-pill-gracia"],
  limitado: ["Suscripcion vencida", "cuenta-pill-limitado"],
  bloqueado: ["Cuenta bloqueada", "cuenta-pill-limitado"]
 };

 return mapa[modo] || mapa.normal;
}

function renderCuentaPOS(negocio, licencia) {
 const pantalla =
 document.getElementById("pantallaCuenta");

 if (!pantalla) return;

 const [textoEstado, claseEstado] =
 estadoLicenciaCuentaPOS(licencia.modo);

 const vencimiento =
 licencia.fechaVencimiento ? new Date(licencia.fechaVencimiento) : null;

 const diasRestantes =
 vencimiento && !Number.isNaN(vencimiento.getTime())
 ? Math.ceil((vencimiento.getTime() - Date.now()) / 86400000)
 : null;

 const fechaTexto =
 vencimiento && !Number.isNaN(vencimiento.getTime())
 ? vencimiento.toLocaleDateString("es-MX", { day: "numeric", month: "long", year: "numeric" })
 : "Sin definir";

 const diasTexto =
 diasRestantes === null
 ? ""
 : diasRestantes >= 0
 ? `${diasRestantes} dia${diasRestantes === 1 ? "" : "s"} restantes`
 : `Vencio hace ${Math.abs(diasRestantes)} dia${Math.abs(diasRestantes) === 1 ? "" : "s"}`;

 const tieneSesionCuenta =
 Boolean(cuentaSesionToken());

 pantalla.innerHTML = `
 <div class="caja cuenta-shell">
  <h2>Cuenta</h2>
  <p class="cuenta-subtitulo">Datos de tu negocio, seguridad de tu cuenta y estado de tu suscripcion Nexo POS.</p>

  <div class="cuenta-tabs">
   <button type="button" class="activo" data-cuenta-tab="resumen" onclick="cambiarTabCuentaPOS('resumen')">Resumen</button>
   <button type="button" data-cuenta-tab="suscripcion" onclick="cambiarTabCuentaPOS('suscripcion')">Suscripcion</button>
   <button type="button" data-cuenta-tab="seguridad" onclick="cambiarTabCuentaPOS('seguridad')">Seguridad</button>
   <button type="button" data-cuenta-tab="dispositivos" onclick="cambiarTabCuentaPOS('dispositivos')">Dispositivos</button>
  </div>

  <div class="cuenta-tab-panel activo" data-cuenta-panel="resumen">
   <div class="cuenta-tarjetas">
    <section class="config-panel cuenta-tarjeta">
     <h3>Tu cuenta</h3>
     <div class="cuenta-datos-grid">
      <div><span>Negocio</span><strong>${escaparPOS(negocio.nombre || "")}</strong></div>
      <div><span>Codigo del negocio</span><strong>${escaparPOS(negocio.slug || "")}</strong></div>
     </div>
     <label class="cuenta-correo-label">Correo de la cuenta
      <span class="cuenta-correo-badge ${negocio.correoVerificado ? "cuenta-correo-badge-ok" : "cuenta-correo-badge-pendiente"}">
       ${negocio.correoVerificado ? "Verificado" : "No verificado"}
      </span>
      <div class="cuenta-correo-fila">
       <input type="email" id="cuentaCorreoInput" value="${escaparPOS(negocio.correo || "")}" placeholder="correo@negocio.com">
       <button type="button" class="btn-principal" onclick="guardarCorreoCuenta()">Guardar</button>
      </div>
     </label>
     ${
      negocio.correo && !negocio.correoVerificado
      ? `<button type="button" class="cuenta-link-boton" onclick="reenviarVerificacionCuenta('${escaparPOS(negocio.correo)}')">Reenviar correo de verificacion</button>`
      : ""
     }
    </section>

    <section class="config-panel cuenta-tarjeta">
     <h3>Suscripcion</h3>
     <div class="cuenta-estado-pill ${claseEstado}">${textoEstado}</div>
     <div class="cuenta-datos-grid">
      <div><span>Plan</span><strong>${escaparPOS(licencia.plan || "-")}</strong></div>
      <div><span>Vence</span><strong>${fechaTexto}</strong></div>
      <div><span>Dias de gracia</span><strong>${licencia.graciaDias ?? 0}</strong></div>
     </div>
     ${diasTexto ? `<p class="cuenta-dias-restantes">${diasTexto}</p>` : ""}
     <div class="cuenta-suscripcion-acciones">
      <button type="button" class="btn-principal" onclick="cambiarTabCuentaPOS('suscripcion')">${licencia.tieneStripe ? "Cambiar de plan" : "Ver planes"}</button>
      ${licencia.tieneStripe ? `<button type="button" onclick="abrirPortalSuscripcionCuenta()">Gestionar pago</button>` : ""}
     </div>
    </section>
   </div>
  </div>

  <div class="cuenta-tab-panel" data-cuenta-panel="suscripcion">
   <section class="config-panel cuenta-tarjeta cuenta-tarjeta-ancha">
    <h3>Elige tu plan</h3>
    <p class="cuenta-subtitulo">Cambia de plan en cualquier momento -- el cambio se refleja en tu proximo cobro.</p>
    <div class="cuenta-plan-grid" id="cuentaPlanGrid">
     <p class="cuenta-subtitulo" style="margin:0;">Cargando planes...</p>
    </div>
    <div class="cuenta-suscripcion-acciones">
     ${licencia.tieneStripe ? `<button type="button" onclick="abrirPortalSuscripcionCuenta()">Gestionar pago y facturas</button>` : ""}
     <button type="button" class="cuenta-link-boton" onclick="abrirContactoDesarrolladorPOS()">Contactar para renovar manualmente</button>
    </div>
   </section>
  </div>

  <div class="cuenta-tab-panel" data-cuenta-panel="seguridad">
   <section class="config-panel cuenta-tarjeta cuenta-tarjeta-ancha" id="cuentaPasswordPanel">
    ${
     tieneSesionCuenta
     ? `<h3>Seguridad</h3><p class="cuenta-subtitulo" style="margin:0 0 14px;">Cargando informacion de seguridad...</p>`
     : `
     <h3>Seguridad</h3>
     <p class="cuenta-subtitulo" style="margin:0 0 14px;">Inicia sesion con el correo y la contrasena de tu cuenta para administrar tu contrasena.</p>
     <button type="button" class="btn-principal" onclick="abrirBuscarNegocioSetup()">Iniciar sesion</button>
     `
    }
   </section>
  </div>

  <div class="cuenta-tab-panel" data-cuenta-panel="dispositivos">
   <section class="config-panel cuenta-tarjeta cuenta-tarjeta-ancha" id="cuentaDispositivosPanel">
    ${
     tieneSesionCuenta
     ? `<h3>Dispositivos</h3><p class="cuenta-subtitulo" style="margin:0 0 14px;">Cargando dispositivos...</p>`
     : `
     <h3>Dispositivos</h3>
     <p class="cuenta-subtitulo" style="margin:0 0 14px;">Inicia sesion con el correo y la contrasena de tu cuenta para ver tus dispositivos con sesion iniciada.</p>
     <button type="button" class="btn-principal" onclick="abrirBuscarNegocioSetup()">Iniciar sesion</button>
     `
    }
   </section>
  </div>

  <div class="cuenta-banners">
   <div class="cuenta-banner cuenta-banner-protegida">
    <strong>Tu cuenta esta protegida</strong>
    <span>Tu contrasena esta cifrada y puedes cerrar la sesion de cualquier dispositivo cuando quieras desde la pestana Dispositivos.</span>
   </div>
   <div class="cuenta-banner cuenta-banner-ayuda">
    <strong>Necesitas ayuda?</strong>
    <span>Escribenos si tienes dudas sobre tu cuenta, tu plan o tu facturacion.</span>
    <button type="button" class="cuenta-link-boton" onclick="abrirContactoDesarrolladorPOS()">Contactar</button>
   </div>
  </div>
 </div>
 `;

 if (tieneSesionCuenta) {
  cargarSeguridadCuenta();
 }

 cargarComparativaPlanes(licencia);
}

async function cargarComparativaPlanes(licencia) {
 const contenedor =
 document.getElementById("cuentaPlanGrid");

 if (!contenedor) return;

 const NEXO_IA_POR_PLAN = {
  basico: "Sin Nexo IA",
  plus: "Nexo IA -- 50 preguntas de analisis al mes",
  pro: "Nexo IA ilimitada"
 };

 try {
  const respuesta =
  await fetch("/suscripcion/planes");

  const datos =
  await respuesta.json();

  if (!datos.ok) {
   throw new Error(datos.error || "No se pudieron cargar los planes");
  }

  contenedor.innerHTML = datos.planes.map(plan => {
   const esActual = plan.clave === licencia.plan;
   const esPopular = plan.clave === "plus";

   const precioTexto =
   plan.precio
   ? `<span class="cuenta-plan-precio-monto">$${Math.round(plan.precio.montoCentavos / 100)}</span><span class="cuenta-plan-precio-periodo">/mes</span>`
   : `<span class="cuenta-plan-precio-monto">Bajo pedido</span>`;

   const featuresHtml =
   plan.funciones.map(funcion => {
    const texto =
    funcion.limite_numerico
    ? `${escaparPOS(funcion.nombre)} (hasta ${funcion.limite_numerico})`
    : escaparPOS(funcion.nombre);

    return `<li class="${funcion.incluido ? "cuenta-plan-feature-si" : "cuenta-plan-feature-no"}">${texto}</li>`;
   }).join("") +
   `<li class="cuenta-plan-feature-si">${escaparPOS(NEXO_IA_POR_PLAN[plan.clave] || "")}</li>`;

   return `
   <div class="cuenta-plan-card ${esPopular ? "cuenta-plan-card-popular" : ""}">
    ${esPopular ? `<span class="cuenta-plan-badge">Mas popular</span>` : ""}
    <h4>${escaparPOS(plan.nombre)}</h4>
    <div class="cuenta-plan-precio">${precioTexto}</div>
    <p class="cuenta-subtitulo" style="margin:0 0 12px;">${escaparPOS(plan.descripcion || "")}</p>
    <ul class="cuenta-plan-features">${featuresHtml}</ul>
    <button type="button" class="cuenta-plan-boton ${esActual ? "cuenta-plan-boton-actual" : "cuenta-plan-boton-elegir"}" ${esActual ? "disabled" : ""} onclick="iniciarSuscripcionCuenta('${plan.clave}')">${esActual ? "Plan actual" : "Elegir plan"}</button>
   </div>
   `;
  }).join("");
 } catch (error) {
  contenedor.innerHTML = `<p class="cuenta-subtitulo" style="margin:0;">No se pudieron cargar los planes. Intenta de nuevo.</p>`;
 }
}

async function guardarCorreoCuenta() {
 const input =
 document.getElementById("cuentaCorreoInput");

 const correo =
 (input?.value || "").trim();

 if (correo && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(correo)) {
  await alertaPOS("Escribe un correo valido.", "Correo invalido", "alerta");
  return;
 }

 try {
  const usarRutaProtegida =
  Boolean(cuentaSesionToken()) && correo;

  const datos =
  usarRutaProtegida
  ? await cuentaFetchAutenticado("/cuenta/correo", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ correo })
   })
  : await (await fetch("/negocio-actual/correo", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ correo })
   })).json();

  if (!datos.ok) {
   throw new Error(datos.error || "No se pudo guardar el correo");
  }

  if (usarRutaProtegida) {
   await alertaPOS("Correo guardado. Te mandamos un correo para verificarlo.", "Cuenta actualizada", "exito");
  } else {
   await alertaPOS("Correo guardado correctamente.", "Cuenta actualizada", "exito");
  }

  mostrarCuenta();
 } catch (error) {
  await alertaPOS(error.message || "No se pudo guardar el correo.", "Error", "alerta");
 }
}

async function iniciarSuscripcionCuenta(plan) {
 if (!cuentaSesionToken()) {
  await alertaPOS("Inicia sesion con tu correo y contrasena para administrar tu suscripcion.", "Sesion requerida", "alerta");
  return;
 }

 try {
  const datos = await cuentaFetchAutenticado("/suscripcion/checkout", {
   method: "POST",
   headers: { "Content-Type": "application/json" },
   body: JSON.stringify({ plan })
  });

  if (!datos.ok) {
   throw new Error(datos.error || "No se pudo iniciar el pago");
  }

  window.location.href = datos.url;
 } catch (error) {
  await alertaPOS(error.message || "No se pudo iniciar el pago.", "Error", "alerta");
 }
}

async function abrirPortalSuscripcionCuenta() {
 try {
  const datos = await cuentaFetchAutenticado("/suscripcion/portal", { method: "POST" });

  if (!datos.ok) {
   throw new Error(datos.error || "No se pudo abrir el portal de pago");
  }

  window.location.href = datos.url;
 } catch (error) {
  await alertaPOS(error.message || "No se pudo abrir el portal de pago.", "Error", "alerta");
 }
}

async function reenviarVerificacionCuenta(correo) {
 try {
  const respuesta =
  await fetch("/cuenta/reenviar-verificacion", {
   method: "POST",
   headers: { "Content-Type": "application/json" },
   body: JSON.stringify({ correo })
  });

  await respuesta.json();

  await alertaPOS("Si tu correo esta pendiente de verificar, te mandamos un nuevo correo.", "Listo", "exito");
 } catch (error) {
  await alertaPOS("No se pudo conectar. Revisa tu internet e intenta de nuevo.", "Sin conexion", "alerta");
 }
}

async function cargarSeguridadCuenta() {
 const panelPassword =
 document.getElementById("cuentaPasswordPanel");

 const panelDispositivos =
 document.getElementById("cuentaDispositivosPanel");

 if (!panelPassword || !panelDispositivos) return;

 try {
  const [ultimoAccesoDatos, sesionesDatos, dispositivosDatos] = await Promise.all([
   cuentaFetchAutenticado("/cuenta/ultimo-acceso"),
   cuentaFetchAutenticado("/cuenta/sesiones"),
   cuentaFetchAutenticado("/cuenta/dispositivos")
  ]);

  if (!sesionesDatos.ok) {
   throw new Error(sesionesDatos.error || "No se pudo cargar la seguridad de tu cuenta");
  }

  const ultimoTexto =
  ultimoAccesoDatos.ok && ultimoAccesoDatos.ultimoAcceso
  ? `${new Date(ultimoAccesoDatos.ultimoAcceso.fecha).toLocaleString("es-MX")} -- ${escaparPOS(ultimoAccesoDatos.ultimoAcceso.ip || "")}`
  : "Esta es la primera vez que inicias sesion.";

  panelPassword.innerHTML = `
   <h3>Seguridad</h3>
   <div class="cuenta-datos-grid">
    <div><span>Ultimo acceso</span><strong>${ultimoTexto}</strong></div>
   </div>

   <h4 class="cuenta-subseccion-titulo">Cambiar contrasena</h4>
   <div class="cuenta-cambiar-password">
    <input type="password" id="cuentaPasswordActual" placeholder="Contrasena actual" autocomplete="current-password">
    <input type="password" id="cuentaPasswordNueva" placeholder="Contrasena nueva" autocomplete="new-password">
    <input type="password" id="cuentaPasswordConfirmar" placeholder="Confirmar contrasena nueva" autocomplete="new-password">
    <button type="button" class="btn-principal" onclick="cambiarPasswordCuenta()">Cambiar contrasena</button>
   </div>
  `;

  const sesionesHtml =
  sesionesDatos.sesiones.map(sesion => `
   <div class="cuenta-sesion-fila">
    <div>
     <strong>${escaparPOS(parsearUserAgentPOS(sesion.dispositivo))}${sesion.actual ? " <span class=\"cuenta-sesion-actual\">Este dispositivo</span>" : ""}</strong>
     <span>${escaparPOS(sesion.ip || "")} -- ${tiempoRelativoPOS(sesion.ultimoUsoAt)}</span>
    </div>
    ${
     sesion.actual
     ? ""
     : `<button type="button" class="cuenta-link-boton" onclick="cerrarSesionCuentaPOS(${sesion.id})">Cerrar</button>`
    }
   </div>
  `).join("") || `<p class="cuenta-subtitulo" style="margin:0;">No hay sesiones activas.</p>`;

  const dispositivosHtml =
  (dispositivosDatos.ok ? dispositivosDatos.dispositivos : []).map(dispositivo => `
   <div class="cuenta-sesion-fila">
    <div>
     <strong>${escaparPOS(dispositivo.nombre || "Equipo sin nombre")}</strong>
     <span>Vinculado ${new Date(dispositivo.creadoAt).toLocaleDateString("es-MX")} -- ${tiempoRelativoPOS(dispositivo.ultimoUsoAt)}</span>
    </div>
    <button type="button" class="cuenta-link-boton" onclick="desvincularDispositivoCuentaPOS(${dispositivo.id})">Desvincular</button>
   </div>
  `).join("") || `<p class="cuenta-subtitulo" style="margin:0;">No hay equipos vinculados a este negocio.</p>`;

  panelDispositivos.innerHTML = `
   <h3>Dispositivos con sesion iniciada</h3>
   <div class="cuenta-sesiones-lista">${sesionesHtml}</div>
   <button type="button" class="cuenta-link-boton cuenta-link-peligro" onclick="cerrarTodasSesionesCuenta()">Cerrar sesion en todos los dispositivos</button>

   <h4 class="cuenta-subseccion-titulo">Equipos vinculados al negocio (cajas)</h4>
   <p class="cuenta-subtitulo" style="margin:0 0 10px;">Computadoras que ya no piden correo y contrasena para entrar, solo el PIN del empleado.</p>
   <div class="cuenta-sesiones-lista">${dispositivosHtml}</div>
  `;
 } catch (error) {
  panelPassword.innerHTML = `
   <h3>Seguridad</h3>
   <p class="cuenta-subtitulo" style="margin:0;">No se pudo cargar la seguridad de tu cuenta. Intenta de nuevo.</p>
  `;

  panelDispositivos.innerHTML = `
   <h3>Dispositivos</h3>
   <p class="cuenta-subtitulo" style="margin:0;">No se pudo cargar la seguridad de tu cuenta. Intenta de nuevo.</p>
  `;
 }
}

async function cambiarPasswordCuenta() {
 const passwordActual =
 document.getElementById("cuentaPasswordActual")?.value || "";

 const passwordNueva =
 document.getElementById("cuentaPasswordNueva")?.value || "";

 const passwordConfirmar =
 document.getElementById("cuentaPasswordConfirmar")?.value || "";

 if (!passwordActual || !passwordNueva) {
  await alertaPOS("Completa tu contrasena actual y la nueva.", "Faltan datos", "alerta");
  return;
 }

 if (passwordNueva !== passwordConfirmar) {
  await alertaPOS("Las contrasenas nuevas no coinciden.", "Revisa los datos", "alerta");
  return;
 }

 try {
  const datos =
  await cuentaFetchAutenticado("/cuenta/password", {
   method: "PUT",
   headers: { "Content-Type": "application/json" },
   body: JSON.stringify({ passwordActual, passwordNueva, confirmarPasswordNueva: passwordConfirmar })
  });

  if (!datos.ok) {
   throw new Error(datos.error || "No se pudo cambiar la contrasena");
  }

  await alertaPOS("Tu contrasena se cambio correctamente.", "Listo", "exito");

  cargarSeguridadCuenta();
 } catch (error) {
  await alertaPOS(error.message || "No se pudo cambiar la contrasena.", "Error", "alerta");
 }
}

async function cerrarSesionCuentaPOS(id) {
 const confirmado =
 await confirmarPOS("Se va a cerrar la sesion en ese dispositivo.", "Cerrar sesion");

 if (!confirmado) return;

 try {
  await cuentaFetchAutenticado(`/cuenta/sesiones/${id}/cerrar`, { method: "POST" });

  cargarSeguridadCuenta();
 } catch (error) {
  await alertaPOS("No se pudo conectar. Revisa tu internet e intenta de nuevo.", "Sin conexion", "alerta");
 }
}

async function desvincularDispositivoCuentaPOS(id) {
 const confirmado =
 await confirmarPOS(
 "Esa computadora va a dejar de tener acceso -- va a pedir correo y contrasena de nuevo la proxima vez que se use.",
 "Desvincular equipo",
 "peligro"
 );

 if (!confirmado) return;

 try {
  await cuentaFetchAutenticado(`/cuenta/dispositivos/${id}/revocar`, { method: "POST" });

  cargarSeguridadCuenta();
 } catch (error) {
  await alertaPOS("No se pudo conectar. Revisa tu internet e intenta de nuevo.", "Sin conexion", "alerta");
 }
}

async function cerrarTodasSesionesCuenta() {
 const confirmado =
 await confirmarPOS("Se va a cerrar la sesion en todos tus dispositivos, incluido este. Tendras que iniciar sesion de nuevo.", "Cerrar en todos los dispositivos");

 if (!confirmado) return;

 try {
  await cuentaFetchAutenticado("/cuenta/logout-todos", { method: "POST" });

  localStorage.removeItem(CUENTA_SESION_TOKEN_KEY);

  mostrarCuenta();
 } catch (error) {
  await alertaPOS("No se pudo conectar. Revisa tu internet e intenta de nuevo.", "Sin conexion", "alerta");
 }
}
