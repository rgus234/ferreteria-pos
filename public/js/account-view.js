/* Pantalla "Cuenta": identidad del negocio y estado de la suscripcion.
   Lee /licencia/estado (ya existente) y permite editar el correo de
   contacto via PUT /negocio-actual/correo. */

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

 pantalla.innerHTML = `
 <div class="caja cuenta-shell">
  <h2>Cuenta</h2>
  <p class="cuenta-subtitulo">Datos de tu negocio y estado de tu suscripcion Nexo POS.</p>

  <div class="cuenta-tarjetas">
   <section class="config-panel cuenta-tarjeta">
    <h3>Tu cuenta</h3>
    <div class="cuenta-datos-grid">
     <div><span>Negocio</span><strong>${escaparPOS(negocio.nombre || "")}</strong></div>
     <div><span>Codigo del negocio</span><strong>${escaparPOS(negocio.slug || "")}</strong></div>
    </div>
    <label class="cuenta-correo-label">Correo de contacto
     <div class="cuenta-correo-fila">
      <input type="email" id="cuentaCorreoInput" value="${escaparPOS(negocio.correo || "")}" placeholder="correo@negocio.com">
      <button type="button" class="btn-principal" onclick="guardarCorreoCuenta()">Guardar</button>
     </div>
    </label>
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
  </div>
 </div>
 `;
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
  const respuesta =
  await fetch("/negocio-actual/correo", {
   method: "PUT",
   headers: { "Content-Type": "application/json" },
   body: JSON.stringify({ correo })
  });

  const datos =
  await respuesta.json();

  if (!datos.ok) {
   throw new Error(datos.error || "No se pudo guardar el correo");
  }

  await alertaPOS("Correo guardado correctamente.", "Cuenta actualizada", "exito");
 } catch (error) {
  await alertaPOS(error.message || "No se pudo guardar el correo.", "Error", "alerta");
 }
}
