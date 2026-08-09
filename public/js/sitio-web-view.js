// Pantalla "Sitio web": activar y personalizar la pagina publica
// automatica del negocio ({slug}.nexoposoficial.com, ver
// public-site-server.js). Solo Plus/Pro -- el servidor es la fuente
// real de verdad (funcionDelPlan), esta pantalla solo refleja lo que
// el servidor ya decidio.

let sitioWebPortadaTemporal = undefined;
let sitioWebSlugActual = "";

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
 cargarPedidosPublicosSitioWeb();
 cargarSolicitudesCreditoSitioWeb();
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
 sitioWebSlugActual = datos.slug || "";
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

 <label class="sitio-web-toggle">
 <input type="checkbox" id="sitioWebMostrarPrecios" ${datos.mostrarPrecios ? "checked" : ""}>
 <span>Mostrar precios al publico</span>
 </label>

 <label class="sitio-web-toggle">
 <input type="checkbox" id="sitioWebMostrarExistencias" ${datos.mostrarExistencias ? "checked" : ""}>
 <span>Mostrar existencias al publico</span>
 </label>

 <label class="sitio-web-toggle">
 <input type="checkbox" id="sitioWebAceptarCredito" ${datos.aceptarSolicitudesCredito ? "checked" : ""}>
 <span>Aceptar solicitudes de credito (incluye fotos de identificacion)</span>
 </label>
 <p class="sitio-web-nota">Al activarlo, tus clientes podran pedirte credito desde tu sitio, incluyendo subir su identificacion oficial. Revisalas en "Solicitudes de credito" mas abajo.</p>

 <label class="sitio-web-toggle">
 <input type="checkbox" id="sitioWebPromocionActiva" ${datos.promocionActiva ? "checked" : ""}>
 <span>Promocion activa (aviso en la parte superior del sitio)</span>
 </label>

 <label>
 <span>Titulo de la promocion</span>
 <input type="text" id="sitioWebPromocionTitulo" maxlength="140" placeholder="Ej. Descuento de temporada" value="${datos.promocionTitulo || ""}">
 </label>

 <label>
 <span>Texto de la promocion</span>
 <textarea id="sitioWebPromocionTexto" rows="2" maxlength="500" placeholder="Ej. 10% de descuento en herramienta electrica esta semana.">${datos.promocionTexto || ""}</textarea>
 </label>

 <label>
 <span>Enlace (opcional)</span>
 <input type="text" id="sitioWebPromocionEnlace" maxlength="300" placeholder="Ej. https://tu-sitio.nexoposoficial.com/catalogo" value="${datos.promocionEnlace || ""}">
 </label>

 <label>
 <span>Imagen de la promocion (opcional)</span>
 <input type="file" id="sitioWebPromocionImagenInput" accept="image/*" onchange="subirPromocionImagenSitioWeb(event)">
 </label>
 <div id="sitioWebPromocionImagenPreview" class="sitio-web-portada-preview">
 ${datos.promocionTieneImagen ? `<img src="/sitio-web-promocion-imagen?negocio=${encodeURIComponent(datos.slug)}&v=${Date.now()}" alt="Imagen de la promocion">` : ""}
 </div>
 <p class="sitio-web-nota" id="sitioWebPromocionImagenEstado" style="display:none;"></p>

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

 <div class="sitio-web-panel">
 <h3 class="sitio-web-panel-titulo">Pedidos recibidos</h3>
 <div id="sitioWebPedidosLista"><p>Cargando...</p></div>
 </div>

 <div class="sitio-web-panel">
 <h3 class="sitio-web-panel-titulo">Solicitudes de credito</h3>
 <div id="sitioWebSolicitudesCreditoLista"><p>Cargando...</p></div>
 </div>
 </div>
 `;
}

async function cargarPedidosPublicosSitioWeb() {
 const contenedor =
 document.getElementById("sitioWebPedidosLista");

 if (!contenedor) return;

 try {
 const respuesta = await fetch("/negocio-actual/pedidos-publicos");
 const datos = await respuesta.json();

 if (!datos.ok) {
 contenedor.innerHTML = `<p>No se pudieron cargar los pedidos.</p>`;
 return;
 }

 renderListaPedidosPublicos(datos.pedidos || []);
 } catch (error) {
 contenedor.innerHTML = `<p>No se pudieron cargar los pedidos. Revisa tu conexion.</p>`;
 }
}

// Cotizaciones (Fase 10): un carrito puede llegar como varias filas
// de pedidos_publicos que comparten grupoId -- se agrupan aqui para
// pintar una sola tarjeta por solicitud, no una por producto.
// gruposPedidosPublicosActuales guarda {principal, items} por id
// representativo, para que mostrarFormularioCotizacion/
// abrirWhatsAppCotizacion no tengan que volver a pedir el listado.
let gruposPedidosPublicosActuales = {};

function normalizarTelefonoWhatsApp(telefono) {
 const digitos = String(telefono || "").replace(/\D/g, "");
 if (!digitos) return null;
 if (digitos.length === 10) return `52${digitos}`;
 return digitos.length >= 10 ? digitos : null;
}

function renderListaPedidosPublicos(pedidos) {
 const contenedor =
 document.getElementById("sitioWebPedidosLista");

 if (!contenedor) return;

 if (!pedidos.length) {
 contenedor.innerHTML = `<p>Todavia no has recibido pedidos.</p>`;
 return;
 }

 const escapar =
 typeof escaparPOS === "function" ? escaparPOS : texto => String(texto || "");

 const gruposMap = new Map();
 pedidos.forEach(pedido => {
 const clave = pedido.grupoId || `solo-${pedido.id}`;
 if (!gruposMap.has(clave)) gruposMap.set(clave, []);
 gruposMap.get(clave).push(pedido);
 });

 gruposPedidosPublicosActuales = {};

 contenedor.innerHTML = Array.from(gruposMap.values()).map(grupo => {
 const principal = grupo[0];
 const id = principal.id;
 gruposPedidosPublicosActuales[id] = { principal, items: grupo };

 const itemsTexto = grupo.map(p => `${escapar(p.productoNombre)} &times; ${p.cantidad}`).join(", ");
 const esCotizacion = principal.tipo === "cotizacion";

 return `
 <div class="sitio-web-pedido-item">
 <div class="sitio-web-pedido-cabecera">
 <strong>${itemsTexto}</strong>
 <span class="sitio-web-pedido-tipo ${esCotizacion ? "cotizacion" : "pedido"}">${esCotizacion ? "Cotizacion" : "Pedido"}</span>
 <span class="sitio-web-pedido-badge ${principal.estado}">${principal.estado}</span>
 ${principal.origen === "market" ? `<span class="sitio-web-pedido-origen market">Nexo Market</span>` : ""}
 </div>
 <div class="sitio-web-pedido-cliente">
 ${escapar(principal.clienteNombre)}
 ${principal.clienteTelefono ? ` &middot; ${escapar(principal.clienteTelefono)}` : ""}
 ${principal.clienteCorreo ? ` &middot; ${escapar(principal.clienteCorreo)}` : ""}
 </div>
 ${principal.mensaje ? `<div class="sitio-web-pedido-mensaje">${escapar(principal.mensaje)}</div>` : ""}
 ${principal.estado === "cotizado" ? `
 <div class="sitio-web-pedido-precio">Precio cotizado: $${Number(principal.precioCotizado).toFixed(2)}</div>
 ${principal.notaNegocio ? `<div class="sitio-web-pedido-mensaje">${escapar(principal.notaNegocio)}</div>` : ""}
 ` : ""}
 <div class="sitio-web-pedido-acciones" id="sitioWebPedidoAcciones${id}">
 ${accionesPedidoPublicoHtml(principal, id)}
 </div>
 </div>
 `;
 }).join("");
}

function accionesPedidoPublicoHtml(pedido, id) {
 if (pedido.tipo === "cotizacion") {
 if (pedido.estado === "cotizado") {
 return `<button type="button" class="btn-encargo-secundario" onclick="abrirWhatsAppCotizacion(${id})">Recordar por WhatsApp</button>`;
 }
 return `
 ${pedido.estado !== "atendido" ? `<button type="button" class="btn-encargo-secundario" onclick="actualizarEstadoPedidoPublico(${id}, 'atendido')">Marcar atendido</button>` : ""}
 ${pedido.estado !== "descartado" ? `<button type="button" class="btn-encargo-secundario" onclick="actualizarEstadoPedidoPublico(${id}, 'descartado')">Descartar</button>` : ""}
 <button type="button" class="btn-encargo-primario" onclick="mostrarFormularioCotizacion(${id})">Responder con precio</button>
 `;
 }

 return `
 ${pedido.estado !== "atendido" ? `<button type="button" class="btn-encargo-secundario" onclick="actualizarEstadoPedidoPublico(${id}, 'atendido')">Marcar atendido</button>` : ""}
 ${pedido.estado !== "descartado" ? `<button type="button" class="btn-encargo-secundario" onclick="actualizarEstadoPedidoPublico(${id}, 'descartado')">Descartar</button>` : ""}
 `;
}

function mostrarFormularioCotizacion(id) {
 const contenedor =
 document.getElementById(`sitioWebPedidoAcciones${id}`);

 if (!contenedor) return;

 contenedor.innerHTML = `
 <div class="sitio-web-cotizacion-form">
 <input type="number" id="sitioWebCotizacionPrecio${id}" min="0.01" step="0.01" placeholder="Precio">
 <input type="text" id="sitioWebCotizacionNota${id}" maxlength="500" placeholder="Nota (opcional)">
 <button type="button" class="btn-encargo-primario" onclick="guardarCotizacion(${id})">Guardar cotizacion</button>
 <button type="button" class="btn-encargo-secundario" onclick="cargarPedidosPublicosSitioWeb()">Cancelar</button>
 </div>
 `;
}

async function guardarCotizacion(id) {
 const precioInput = document.getElementById(`sitioWebCotizacionPrecio${id}`);
 const notaInput = document.getElementById(`sitioWebCotizacionNota${id}`);
 const precioCotizado = Number(precioInput ? precioInput.value : NaN);

 if (!Number.isFinite(precioCotizado) || precioCotizado <= 0) {
 if (typeof alertaPOS === "function") alertaPOS("Escribe un precio valido.", "Cotizacion", "alerta");
 return;
 }

 try {
 const respuesta = await fetch(`/negocio-actual/pedidos-publicos/${id}`, {
 method: "PATCH",
 headers: { "Content-Type": "application/json" },
 body: JSON.stringify({ estado: "cotizado", precioCotizado, nota: notaInput ? notaInput.value.trim() : "" })
 });

 const datos = await respuesta.json();

 if (!datos.ok) {
 if (typeof alertaPOS === "function") alertaPOS(datos.error || "No se pudo guardar la cotizacion.", "Cotizacion", "alerta");
 return;
 }

 cargarPedidosPublicosSitioWeb();
 } catch (error) {
 if (typeof alertaPOS === "function") alertaPOS("No se pudo guardar la cotizacion. Revisa tu conexion.", "Cotizacion", "alerta");
 }
}

function abrirWhatsAppCotizacion(id) {
 const grupo = gruposPedidosPublicosActuales[id];
 if (!grupo) return;

 const { principal, items } = grupo;
 const telefono = normalizarTelefonoWhatsApp(principal.clienteTelefono);

 if (!telefono) {
 if (typeof alertaPOS === "function") alertaPOS("Este cliente no dejo un telefono valido.", "Cotizacion", "alerta");
 return;
 }

 const listaProductos = items.map(item => `${item.productoNombre} x${item.cantidad}`).join(", ");
 const mensaje =
 `Hola ${principal.clienteNombre || ""}, tu cotizacion de ${listaProductos} quedo en $${Number(principal.precioCotizado).toFixed(2)}` +
 (principal.notaNegocio ? `. ${principal.notaNegocio}` : "") +
 `. Cualquier duda, contactanos.`;

 window.open(`https://wa.me/${telefono}?text=${encodeURIComponent(mensaje)}`, "_blank", "noopener");
}

async function actualizarEstadoPedidoPublico(id, estado) {
 try {
 const respuesta = await fetch(`/negocio-actual/pedidos-publicos/${id}`, {
 method: "PATCH",
 headers: { "Content-Type": "application/json" },
 body: JSON.stringify({ estado })
 });

 const datos = await respuesta.json();

 if (!datos.ok) {
 if (typeof alertaPOS === "function") alertaPOS(datos.error || "No se pudo actualizar el pedido.", "Sitio web", "alerta");
 return;
 }

 cargarPedidosPublicosSitioWeb();
 } catch (error) {
 if (typeof alertaPOS === "function") alertaPOS("No se pudo actualizar el pedido. Revisa tu conexion.", "Sitio web", "alerta");
 }
}

async function cargarSolicitudesCreditoSitioWeb() {
 const contenedor =
 document.getElementById("sitioWebSolicitudesCreditoLista");

 if (!contenedor) return;

 try {
 const respuesta = await fetch("/negocio-actual/solicitudes-credito");
 const datos = await respuesta.json();

 if (!datos.ok) {
 contenedor.innerHTML = `<p>No se pudieron cargar las solicitudes.</p>`;
 return;
 }

 renderListaSolicitudesCredito(datos.solicitudes || []);
 } catch (error) {
 contenedor.innerHTML = `<p>No se pudieron cargar las solicitudes. Revisa tu conexion.</p>`;
 }
}

function renderListaSolicitudesCredito(solicitudes) {
 const contenedor =
 document.getElementById("sitioWebSolicitudesCreditoLista");

 if (!contenedor) return;

 if (!solicitudes.length) {
 contenedor.innerHTML = `<p>Todavia no has recibido solicitudes.</p>`;
 return;
 }

 const escapar =
 typeof escaparPOS === "function" ? escaparPOS : texto => String(texto || "");

 contenedor.innerHTML = solicitudes.map(s => `
 <div class="sitio-web-pedido-item">
 <div class="sitio-web-pedido-cabecera">
 <strong>${escapar(s.nombre)}</strong>
 <span class="sitio-web-pedido-badge ${s.estado}">${s.estado}</span>
 </div>
 <div class="sitio-web-pedido-cliente">
 ${escapar(s.telefono)}
 ${s.correo ? ` &middot; ${escapar(s.correo)}` : ""}
 ${s.direccion ? ` &middot; ${escapar(s.direccion)}` : ""}
 </div>
 ${s.montoSolicitado !== null ? `<div class="sitio-web-pedido-mensaje">Monto solicitado: $${Number(s.montoSolicitado).toFixed(2)}</div>` : ""}
 ${s.comentario ? `<div class="sitio-web-pedido-mensaje">${escapar(s.comentario)}</div>` : ""}
 ${(s.tieneIneFrente || s.tieneIneReverso) ? `
 <div class="sitio-web-ine-fotos">
 ${s.tieneIneFrente ? `<img class="sitio-web-ine-thumb" id="ineFrenteImg${s.id}" alt="INE frente">` : ""}
 ${s.tieneIneReverso ? `<img class="sitio-web-ine-thumb" id="ineReversoImg${s.id}" alt="INE reverso">` : ""}
 </div>` : ""}
 <div class="sitio-web-pedido-acciones">
 ${s.estado !== "aprobado" ? `<button type="button" class="btn-encargo-secundario" onclick="actualizarEstadoSolicitudCredito(${s.id}, 'aprobado')">Aprobar</button>` : ""}
 ${s.estado !== "rechazado" ? `<button type="button" class="btn-encargo-secundario" onclick="actualizarEstadoSolicitudCredito(${s.id}, 'rechazado')">Rechazar</button>` : ""}
 <button type="button" class="btn-encargo-secundario" onclick="eliminarSolicitudCredito(${s.id})">Eliminar solicitud</button>
 </div>
 ${s.estado === "aprobado" ? `<div class="sitio-web-nota">Crea el cliente desde Creditos &rarr; Nuevo cliente.</div>` : ""}
 </div>
 `).join("");

 solicitudes.forEach(s => {
 if (s.tieneIneFrente) cargarMiniaturaIne(s.id, "ine-frente", `ineFrenteImg${s.id}`);
 if (s.tieneIneReverso) cargarMiniaturaIne(s.id, "ine-reverso", `ineReversoImg${s.id}`);
 });
}

// Las fotos de identificacion nunca se sirven por un <img src>
// directo a la ruta (esa ruta solo acepta sesion real, sin token en
// la URL) -- se piden por fetch (el interceptor global ya manda el
// header de auth), se convierten a blob, y esa URL local se asigna
// al <img>.
async function cargarMiniaturaIne(id, lado, idImagen) {
 try {
 const respuesta = await fetch(`/negocio-actual/solicitudes-credito/${id}/${lado}`);
 if (!respuesta.ok) return;

 const blob = await respuesta.blob();
 const url = URL.createObjectURL(blob);
 const img = document.getElementById(idImagen);

 if (img) img.src = url;
 } catch (error) { /* silencioso, mismo criterio que el resto de miniaturas */ }
}

async function actualizarEstadoSolicitudCredito(id, estado) {
 try {
 const respuesta = await fetch(`/negocio-actual/solicitudes-credito/${id}`, {
 method: "PATCH",
 headers: { "Content-Type": "application/json" },
 body: JSON.stringify({ estado })
 });

 const datos = await respuesta.json();

 if (!datos.ok) {
 if (typeof alertaPOS === "function") alertaPOS(datos.error || "No se pudo actualizar la solicitud.", "Sitio web", "alerta");
 return;
 }

 cargarSolicitudesCreditoSitioWeb();
 } catch (error) {
 if (typeof alertaPOS === "function") alertaPOS("No se pudo actualizar la solicitud. Revisa tu conexion.", "Sitio web", "alerta");
 }
}

async function eliminarSolicitudCredito(id) {
 if (typeof confirmarPOS === "function") {
 const confirmado = await confirmarPOS("Esto borra la solicitud y sus fotos de identificacion de forma permanente. ¿Continuar?", "Eliminar solicitud", "peligro");
 if (!confirmado) return;
 }

 try {
 const respuesta = await fetch(`/negocio-actual/solicitudes-credito/${id}`, { method: "DELETE" });
 const datos = await respuesta.json();

 if (!datos.ok) {
 if (typeof alertaPOS === "function") alertaPOS(datos.error || "No se pudo eliminar la solicitud.", "Sitio web", "alerta");
 return;
 }

 if (typeof alertaPOS === "function") alertaPOS("Solicitud eliminada.", "Sitio web", "exito");
 cargarSolicitudesCreditoSitioWeb();
 } catch (error) {
 if (typeof alertaPOS === "function") alertaPOS("No se pudo eliminar la solicitud. Revisa tu conexion.", "Sitio web", "alerta");
 }
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

// Imagen de la promocion (Fase "Ofertas destacadas", ver plan) -- a
// diferencia de la portada (que viaja como base64 dentro del mismo
// PUT de guardarSitioWeb), esta se sube aparte de inmediato via
// multipart/form-data: el servidor la recorta con sharp, no tiene
// sentido guardarla como base64 sin procesar.
async function subirPromocionImagenSitioWeb(evento) {
 const archivo =
 evento.target.files?.[0];

 if (!archivo) return;

 const estado =
 document.getElementById("sitioWebPromocionImagenEstado");

 if (estado) {
 estado.style.display = "";
 estado.textContent = "Subiendo imagen...";
 }

 try {
 const formulario = new FormData();
 formulario.append("imagen", archivo);

 const respuesta = await fetch("/negocio-actual/sitio-web/promocion-imagen", {
 method: "POST",
 body: formulario
 });

 const datos = await respuesta.json();

 if (!datos.ok) {
 if (estado) estado.textContent = datos.error || "No se pudo subir la imagen.";
 if (typeof alertaPOS === "function") alertaPOS(datos.error || "No se pudo subir la imagen.", "Sitio web", "alerta");
 return;
 }

 const preview =
 document.getElementById("sitioWebPromocionImagenPreview");

 if (preview) {
 preview.innerHTML = `<img src="/sitio-web-promocion-imagen?negocio=${encodeURIComponent(sitioWebSlugActual)}&v=${Date.now()}" alt="Imagen de la promocion">`;
 }

 if (estado) estado.style.display = "none";
 if (typeof alertaPOS === "function") alertaPOS("Imagen de la promocion actualizada.", "Sitio web", "exito");
 } catch (error) {
 if (estado) estado.textContent = "No se pudo subir la imagen. Revisa tu conexion.";
 }
}

async function guardarSitioWeb() {
 const payload = {
 activo: document.getElementById("sitioWebActivo")?.checked || false,
 mostrarPrecios: document.getElementById("sitioWebMostrarPrecios")?.checked || false,
 mostrarExistencias: document.getElementById("sitioWebMostrarExistencias")?.checked || false,
 aceptarSolicitudesCredito: document.getElementById("sitioWebAceptarCredito")?.checked || false,
 promocionActiva: document.getElementById("sitioWebPromocionActiva")?.checked || false,
 promocionTitulo: document.getElementById("sitioWebPromocionTitulo")?.value || "",
 promocionTexto: document.getElementById("sitioWebPromocionTexto")?.value || "",
 promocionEnlace: document.getElementById("sitioWebPromocionEnlace")?.value || "",
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
