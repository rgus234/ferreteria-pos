// Pantalla "Sitio web": activar y personalizar la pagina publica
// automatica del negocio ({slug}.nexoposoficial.com, ver
// public-site-server.js). Solo Plus/Pro -- el servidor es la fuente
// real de verdad (funcionDelPlan), esta pantalla solo refleja lo que
// el servidor ya decidio.

let sitioWebPortadaTemporal = undefined;

async function mostrarSitioWeb() {
 if (typeof ocultarPantallasPrincipales === "function") {
 ocultarPantallasPrincipales();
 }

 const pantalla =
 document.getElementById("pantallaSitioWeb");

 if (!pantalla) return;

 pantalla.style.display = "block";

 if (typeof actualizarTopbarContexto === "function") {
 actualizarTopbarContexto("Sitio web", "Activa y personaliza la pagina publica automatica de tu negocio", "sitio-web");
 }

 sitioWebPortadaTemporal = undefined;

 pantalla.innerHTML = `
 <div class="sitio-web-shell">
 <p>Cargando...</p>
 </div>
 `;

 try {
 const respuesta = await fetch("/negocio-actual/sitio-web");
 const datos = await respuesta.json();

 if (!datos.ok) {
 pantalla.innerHTML = `<div class="sitio-web-shell"><p>No se pudo cargar la configuracion del sitio.</p></div>`;
 return;
 }

 if (!datos.incluido) {
 renderSitioWebUpsell(pantalla);
 return;
 }

 renderSitioWebFormulario(pantalla, datos);
 } catch (error) {
 pantalla.innerHTML = `<div class="sitio-web-shell"><p>No se pudo cargar la configuracion del sitio. Revisa tu conexion.</p></div>`;
 }
}

function renderSitioWebUpsell(pantalla) {
 pantalla.innerHTML = `
 <div class="sitio-web-shell">
 <div class="sitio-web-upsell">
 <h2>Tu negocio con su propia pagina web</h2>
 <p>Con el plan Plus o Pro, tu negocio obtiene automaticamente una pagina publica en su propio subdominio -- con tu logo, descripcion, horario, WhatsApp y redes sociales -- sin disenar nada.</p>
 <button type="button" class="btn-encargo-primario" onclick="mostrarCuenta()">Ver planes</button>
 </div>
 </div>
 `;
}

function renderSitioWebFormulario(pantalla, datos) {
 pantalla.innerHTML = `
 <div class="sitio-web-shell">
 <div class="sitio-web-url-card">
 <div>
 <span>Tu sitio</span>
 <strong>${datos.urlPublica}</strong>
 </div>
 <div class="sitio-web-url-acciones">
 <button type="button" class="btn-encargo-secundario" onclick="copiarUrlSitioWeb('${datos.urlPublica}')">Copiar enlace</button>
 <button type="button" class="btn-encargo-secundario" onclick="window.open('${datos.urlPublica}', '_blank')">Ver mi sitio</button>
 </div>
 </div>

 <div class="sitio-web-panel">
 <label class="sitio-web-toggle">
 <input type="checkbox" id="sitioWebActivo" ${datos.activo ? "checked" : ""}>
 <span>Sitio activado (visible al publico)</span>
 </label>

 <label>
 <span>Descripcion</span>
 <textarea id="sitioWebDescripcion" rows="3" maxlength="2000" placeholder="Cuentale a tus clientes que vendes y que te hace diferente.">${datos.descripcion || ""}</textarea>
 </label>

 <label>
 <span>Portada</span>
 <input type="file" id="sitioWebPortadaInput" accept="image/*" onchange="cargarPortadaSitioWeb(event)">
 </label>
 <div id="sitioWebPortadaPreview" class="sitio-web-portada-preview">
 ${datos.portada ? `<img src="${datos.portada}" alt="Portada">` : ""}
 </div>

 <label>
 <span>Horario</span>
 <textarea id="sitioWebHorario" rows="2" maxlength="500" placeholder="Ej. Lun-Sab 8:00-19:00, Dom 9:00-14:00">${datos.horarioTexto || ""}</textarea>
 </label>

 <label>
 <span>WhatsApp</span>
 <input type="text" id="sitioWebWhatsapp" maxlength="40" placeholder="10 digitos" value="${datos.whatsapp || ""}">
 </label>

 <label>
 <span>Facebook</span>
 <input type="text" id="sitioWebFacebook" maxlength="300" placeholder="https://facebook.com/tu-negocio" value="${datos.facebook || ""}">
 </label>

 <label>
 <span>Instagram</span>
 <input type="text" id="sitioWebInstagram" maxlength="300" placeholder="https://instagram.com/tu-negocio" value="${datos.instagram || ""}">
 </label>

 <button type="button" class="btn-encargo-primario encargo-btn-full" onclick="guardarSitioWeb()">Guardar</button>
 </div>
 </div>
 `;
}

function copiarUrlSitioWeb(url) {
 navigator.clipboard?.writeText(url).then(() => {
 if (typeof alertaPOS === "function") alertaPOS("Enlace copiado.", "Sitio web", "exito");
 }).catch(() => {});
}

function cargarPortadaSitioWeb(evento) {
 const archivo =
 evento.target.files?.[0];

 if (!archivo) return;

 const lector =
 new FileReader();

 lector.onload = e => {
 sitioWebPortadaTemporal = e.target.result;

 const preview =
 document.getElementById("sitioWebPortadaPreview");

 if (preview) {
 preview.innerHTML = `<img src="${sitioWebPortadaTemporal}" alt="Portada">`;
 }
 };

 lector.readAsDataURL(archivo);
}

async function guardarSitioWeb() {
 const payload = {
 activo: document.getElementById("sitioWebActivo")?.checked || false,
 descripcion: document.getElementById("sitioWebDescripcion")?.value || "",
 horarioTexto: document.getElementById("sitioWebHorario")?.value || "",
 whatsapp: document.getElementById("sitioWebWhatsapp")?.value || "",
 facebook: document.getElementById("sitioWebFacebook")?.value || "",
 instagram: document.getElementById("sitioWebInstagram")?.value || ""
 };

 if (sitioWebPortadaTemporal !== undefined) {
 payload.portada = sitioWebPortadaTemporal;
 }

 try {
 const respuesta = await fetch("/negocio-actual/sitio-web", {
 method: "PUT",
 headers: { "Content-Type": "application/json" },
 body: JSON.stringify(payload)
 });

 const datos = await respuesta.json();

 if (!datos.ok) {
 if (typeof alertaPOS === "function") alertaPOS(datos.error || "No se pudo guardar.", "Sitio web", "alerta");
 return;
 }

 if (typeof alertaPOS === "function") alertaPOS("Sitio web actualizado.", "Sitio web", "exito");
 mostrarSitioWeb();
 } catch (error) {
 if (typeof alertaPOS === "function") alertaPOS("No se pudo guardar. Revisa tu conexion.", "Sitio web", "alerta");
 }
}
