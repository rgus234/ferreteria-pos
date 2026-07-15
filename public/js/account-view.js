/* Pantalla "Cuenta": identidad del negocio, estado de la suscripcion y
   seguridad de la cuenta (correo, contrasena, sesiones/dispositivos).
   La parte de suscripcion sigue leyendo /licencia/estado (por slug,
   sin cambios). La parte de seguridad usa las rutas /cuenta/* nuevas,
   protegidas por el token de sesion que guarda iniciarSesionCuenta()
   -- si el negocio nunca inicio sesion con correo/contrasena (por
   ejemplo, negocios creados antes de este sistema) esa seccion
   invita a iniciar sesion en vez de fallar. */

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
    <button type="button" onclick="abrirContactoDesarrolladorPOS()">Contactar para renovar</button>
   </section>

   <section class="config-panel cuenta-tarjeta cuenta-tarjeta-ancha" id="cuentaSeguridadPanel">
    <h3>Seguridad</h3>
    ${
     tieneSesionCuenta
     ? `<p class="cuenta-subtitulo" style="margin:0 0 14px;">Cargando informacion de seguridad...</p>`
     : `
     <p class="cuenta-subtitulo" style="margin:0 0 14px;">Inicia sesion con el correo y la contrasena de tu cuenta para administrar tu contrasena y ver tus dispositivos con sesion iniciada.</p>
     <button type="button" class="btn-principal" onclick="abrirBuscarNegocioSetup()">Iniciar sesion</button>
     `
    }
   </section>
  </div>
 </div>
 `;

 if (tieneSesionCuenta) {
  cargarSeguridadCuenta();
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
 const panel =
 document.getElementById("cuentaSeguridadPanel");

 if (!panel) return;

 try {
  const [ultimoAccesoDatos, sesionesDatos] = await Promise.all([
   cuentaFetchAutenticado("/cuenta/ultimo-acceso"),
   cuentaFetchAutenticado("/cuenta/sesiones")
  ]);

  if (!sesionesDatos.ok) {
   throw new Error(sesionesDatos.error || "No se pudo cargar la seguridad de tu cuenta");
  }

  const ultimoTexto =
  ultimoAccesoDatos.ok && ultimoAccesoDatos.ultimoAcceso
  ? `${new Date(ultimoAccesoDatos.ultimoAcceso.fecha).toLocaleString("es-MX")} -- ${escaparPOS(ultimoAccesoDatos.ultimoAcceso.ip || "")}`
  : "Esta es la primera vez que inicias sesion.";

  const sesionesHtml =
  sesionesDatos.sesiones.map(sesion => `
   <div class="cuenta-sesion-fila">
    <div>
     <strong>${escaparPOS(sesion.dispositivo || "Dispositivo desconocido")}${sesion.actual ? " <span class=\"cuenta-sesion-actual\">Este dispositivo</span>" : ""}</strong>
     <span>${escaparPOS(sesion.ip || "")} -- ultima vez ${new Date(sesion.ultimoUsoAt).toLocaleString("es-MX")}</span>
    </div>
    ${
     sesion.actual
     ? ""
     : `<button type="button" class="cuenta-link-boton" onclick="cerrarSesionCuentaPOS(${sesion.id})">Cerrar</button>`
    }
   </div>
  `).join("") || `<p class="cuenta-subtitulo" style="margin:0;">No hay sesiones activas.</p>`;

  panel.innerHTML = `
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

   <h4 class="cuenta-subseccion-titulo">Dispositivos con sesion iniciada</h4>
   <div class="cuenta-sesiones-lista">${sesionesHtml}</div>
   <button type="button" class="cuenta-link-boton cuenta-link-peligro" onclick="cerrarTodasSesionesCuenta()">Cerrar sesion en todos los dispositivos</button>
  `;
 } catch (error) {
  panel.innerHTML = `
   <h3>Seguridad</h3>
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
