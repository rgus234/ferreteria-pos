// Pantalla "Sitio web": activar y personalizar la pagina publica
// automatica del negocio ({slug}.nexoposoficial.com, ver
// public-site-server.js). Solo Plus/Pro -- el servidor es la fuente
// real de verdad (funcionDelPlan), esta pantalla solo refleja lo que
// el servidor ya decidio.
//
// Rediseno (ver plan "Rediseno Sitio web -- fusion con Nexo Market +
// editor de Promocion por plantillas"): pantallas separadas de "Sitio
// web" y "Nexo Market" se fusionaron en una sola con pestanas, mas un
// panel de vista previa en vivo a la derecha, mas un editor de
// Promocion basado en plantillas (en vez de un solo campo de imagen +
// texto encima). "Nexo Market" ya no es un boton propio del sidebar --
// su contenido (antes en market-admin-view.js, ahora borrado) vive
// aqui como una pestana mas.

let sitioWebPortadaTemporal = undefined;
let sitioWebSlugActual = "";
let sitioWebNombreActual = "";
let sitioWebDatosActuales = null;

const SITIO_WEB_PLANTILLAS_PROMOCION = [
    { id: "clasica", nombre: "Clasica", descripcion: "Foto chica a un lado, texto al otro." },
    { id: "imagen-fondo", nombre: "Foto de fondo", descripcion: "Tu foto a todo el ancho con el texto encima." },
    { id: "dividida", nombre: "Dividida", descripcion: "Panel de color con texto y tu foto al lado." },
    { id: "minimal", nombre: "Minimal", descripcion: "Solo texto, sin foto -- rapido y directo." }
];

const SITIO_WEB_COLORES_PRESET = ["#1067e8", "#e2434d", "#18b88f", "#f59e0b", "#7c3aed", "#0f172a"];

async function mostrarSitioWeb() {
 if (typeof ocultarPantallasPrincipales === "function") {
 ocultarPantallasPrincipales();
 }

 const pantalla =
 document.getElementById("pantallaSitioWeb");

 if (!pantalla) return;

 pantalla.style.display = "block";

 if (typeof actualizarTopbarContexto === "function") {
 actualizarTopbarContexto("Sitio web", "Activa y personaliza tu pagina y tu presencia en Nexo Market", "sitio-web");
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
 cargarMarketResumenSitioWeb();
 actualizarVistaPreviaPromocion();
 } catch (error) {
 pantalla.innerHTML = `<div class="sitio-web-shell"><p>No se pudo cargar la configuracion del sitio. Revisa tu conexion.</p></div>`;
 }
}

function renderSitioWebUpsell(pantalla) {
 pantalla.innerHTML = `
 <div class="sitio-web-shell">
 <div class="sitio-web-upsell">
 <h2>Tu negocio con su propia pagina web</h2>
 <p>Con el plan Plus o Pro, tu negocio obtiene automaticamente una pagina publica en su propio subdominio -- con tu logo, descripcion, horario, WhatsApp y redes sociales -- ademas de aparecer en Nexo Market, sin disenar nada.</p>
 <button type="button" class="btn-encargo-primario" onclick="mostrarCuenta()">Ver planes</button>
 </div>
 </div>
 `;
}

/* ---------- Shell de pestanas + vista previa ---------- */

const SITIO_WEB_PESTANAS = [
 { id: "informacion", nombre: "Informacion" },
 { id: "apariencia", nombre: "Apariencia" },
 { id: "promociones", nombre: "Promociones" },
 { id: "contacto", nombre: "Contacto y redes" },
 { id: "ubicacion", nombre: "Ubicacion y horario" },
 { id: "pedidos", nombre: "Pedidos" },
 { id: "market", nombre: "Nexo Market" }
];

function renderSitioWebFormulario(pantalla, datos) {
 sitioWebSlugActual = datos.slug || "";
 sitioWebNombreActual = datos.nombre || "";
 sitioWebDatosActuales = datos;

 pantalla.innerHTML = `
 <div class="sitio-web-shell sitio-web-shell-rediseno">

 <div class="sitio-web-url-card">
 <div>
 <span>Tu sitio</span>
 <strong>${datos.urlPublica}</strong>
 </div>
 <div class="sitio-web-url-acciones">
 <button type="button" class="btn-encargo-secundario" onclick="copiarUrlSitioWeb('${datos.urlPublica}')">Copiar enlace</button>
 <button type="button" class="btn-encargo-secundario" onclick="window.open('${datos.urlPublica}', '_blank')">Ver mi sitio</button>
 <button type="button" class="btn-encargo-primario" onclick="guardarSitioWeb()">Guardar cambios</button>
 </div>
 </div>

 <div class="sitio-web-layout">
 <div class="sitio-web-principal">

 <div class="sitio-web-tabs" role="tablist">
 ${SITIO_WEB_PESTANAS.map((p, i) => `
 <button type="button" class="sitio-web-tab${i === 0 ? " activo" : ""}" data-tab-boton="${p.id}" onclick="activarPestanaSitioWeb('${p.id}')">${p.nombre}</button>
 `).join("")}
 </div>

 <div class="sitio-web-tab-panel" data-tab-panel="informacion">
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
 <p class="sitio-web-nota">Al activarlo, tus clientes podran pedirte credito desde tu sitio, incluyendo subir su identificacion oficial. Revisalas en la pestana "Pedidos".</p>
 <label>
 <span>Descripcion</span>
 <textarea id="sitioWebDescripcion" rows="3" maxlength="2000" placeholder="Cuentale a tus clientes que vendes y que te hace diferente.">${datos.descripcion || ""}</textarea>
 </label>
 </div>
 </div>

 <div class="sitio-web-tab-panel" data-tab-panel="apariencia" hidden>
 <div class="sitio-web-panel">
 <label>
 <span>Portada</span>
 <input type="file" id="sitioWebPortadaInput" accept="image/*" onchange="cargarPortadaSitioWeb(event)">
 </label>
 <div id="sitioWebPortadaPreview" class="sitio-web-portada-preview">
 ${datos.portada ? `<img src="${datos.portada}" alt="Portada">` : ""}
 </div>
 </div>
 </div>

 <div class="sitio-web-tab-panel" data-tab-panel="promociones" hidden>
 ${sitioWebPromocionEditorHtml(datos)}
 </div>

 <div class="sitio-web-tab-panel" data-tab-panel="contacto" hidden>
 <div class="sitio-web-panel">
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
 </div>
 </div>

 <div class="sitio-web-tab-panel" data-tab-panel="ubicacion" hidden>
 <div class="sitio-web-panel">
 <label>
 <span>Horario</span>
 <textarea id="sitioWebHorario" rows="2" maxlength="500" placeholder="Ej. Lun-Sab 8:00-19:00, Dom 9:00-14:00">${datos.horarioTexto || ""}</textarea>
 </label>
 <label>
 <span>Direccion (aparece en el mapa de Nexo Market)</span>
 <input type="text" id="sitioWebDireccion" maxlength="180" placeholder="Calle, numero, colonia, ciudad" value="${datos.direccion || ""}">
 </label>
 <label>
 <span>Politica de envio</span>
 <select id="sitioWebEnvioModo" onchange="actualizarVisibilidadTarifaEnvioSitioWeb()">
 <option value="a_coordinar" ${!datos.envioModo || datos.envioModo === "a_coordinar" ? "selected" : ""}>Se coordina con cada cliente</option>
 <option value="solo_recoleccion" ${datos.envioModo === "solo_recoleccion" ? "selected" : ""}>Solo recoleccion en tienda</option>
 <option value="tarifa_fija" ${datos.envioModo === "tarifa_fija" ? "selected" : ""}>Entrego con costo fijo</option>
 </select>
 </label>
 <label id="sitioWebEnvioTarifaCampo" style="${datos.envioModo === "tarifa_fija" ? "" : "display:none;"}">
 <span>Costo de envio (pesos)</span>
 <input type="number" id="sitioWebEnvioTarifa" min="0" step="0.01" value="${datos.envioTarifa !== null && datos.envioTarifa !== undefined ? datos.envioTarifa : ""}">
 </label>
 <label>
 <span>Notas de envio (opcional)</span>
 <textarea id="sitioWebEnvioNotas" rows="2" maxlength="300" placeholder="Zona de entrega, tiempo estimado, minimo de compra...">${datos.envioNotas || ""}</textarea>
 </label>
 </div>
 </div>

 <div class="sitio-web-tab-panel" data-tab-panel="pedidos" hidden>
 <div class="sitio-web-panel">
 <h3 class="sitio-web-panel-titulo">Pedidos recibidos</h3>
 <div id="sitioWebPedidosLista"><p>Cargando...</p></div>
 </div>
 <div class="sitio-web-panel">
 <h3 class="sitio-web-panel-titulo">Solicitudes de credito</h3>
 <div id="sitioWebSolicitudesCreditoLista"><p>Cargando...</p></div>
 </div>
 </div>

 <div class="sitio-web-tab-panel" data-tab-panel="market" hidden>
 <div id="sitioWebMarketResumen"><p>Cargando...</p></div>
 </div>

 </div>

 <aside class="sitio-web-preview">
 <div class="sitio-web-preview-header">
 <span>Vista previa de tu sitio</span>
 <div class="sitio-web-preview-toggle">
 <button type="button" class="activo" data-preview-size="movil" onclick="cambiarTamanoVistaPreviaSitioWeb('movil')">Movil</button>
 <button type="button" data-preview-size="escritorio" onclick="cambiarTamanoVistaPreviaSitioWeb('escritorio')">Escritorio</button>
 </div>
 </div>
 <div class="sitio-web-preview-frame" id="sitioWebPreviewFrame">
 <div class="sitio-web-preview-card">
 <div class="sitio-web-preview-marca">
 <strong>${escaparSitioWeb(sitioWebNombreActual || "Tu negocio")}</strong>
 <span>${escaparSitioWeb(sitioWebSlugActual)}.nexoposoficial.com</span>
 </div>
 <div id="sitioWebPreviewPromo" class="sitio-web-preview-promo"><p class="sitio-web-nota">Activa la promocion para verla aqui.</p></div>
 </div>
 </div>
 </aside>
 </div>
 </div>
 `;

 actualizarVisibilidadTarifaEnvioSitioWeb();
}

function activarPestanaSitioWeb(id) {
 document.querySelectorAll(".sitio-web-tab").forEach(boton => {
 boton.classList.toggle("activo", boton.dataset.tabBoton === id);
 });
 document.querySelectorAll(".sitio-web-tab-panel").forEach(panel => {
 panel.hidden = panel.dataset.tabPanel !== id;
 });
}

function cambiarTamanoVistaPreviaSitioWeb(tamano) {
 const marco = document.getElementById("sitioWebPreviewFrame");
 if (marco) marco.classList.toggle("escritorio", tamano === "escritorio");
 document.querySelectorAll("[data-preview-size]").forEach(boton => {
 boton.classList.toggle("activo", boton.dataset.previewSize === tamano);
 });
}

function escaparSitioWeb(texto) {
 return typeof escaparPOS === "function" ? escaparPOS(texto) : String(texto || "");
}

/* ---------- Pedidos recibidos (sin cambios de fondo, Fase 5/10) ---------- */

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

 const escapar = escaparSitioWeb;

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

 const escapar = escaparSitioWeb;

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

/* ---------- Nexo Market (fusionado -- antes market-admin-view.js) ---------- */

async function cargarMarketResumenSitioWeb() {
 const contenedor =
 document.getElementById("sitioWebMarketResumen");

 if (!contenedor) return;

 try {
 const respuesta = await fetch("/negocio-actual/market-resumen");
 const datos = await respuesta.json();

 if (!datos.ok) {
 contenedor.innerHTML = `<p>No se pudo cargar tu presencia en Nexo Market.</p>`;
 return;
 }

 if (!datos.incluido) {
 contenedor.innerHTML = `
 <div class="sitio-web-upsell">
 <h2>Vende tambien en Nexo Market</h2>
 <p>Con el plan Plus o Pro, tu negocio aparece automaticamente en Nexo Market -- el buscador que junta el catalogo de varias ferreterias Nexo -- ademas de tu propia pagina.</p>
 <button type="button" class="btn-encargo-primario" onclick="mostrarCuenta()">Ver planes</button>
 </div>
 `;
 return;
 }

 renderMarketResumenSitioWeb(datos);
 cargarProductosDestacadosMarketSitioWeb();
 } catch (error) {
 contenedor.innerHTML = `<p>No se pudo cargar tu presencia en Nexo Market. Revisa tu conexion.</p>`;
 }
}

function renderMarketResumenSitioWeb(datos) {
 const contenedor =
 document.getElementById("sitioWebMarketResumen");

 if (!contenedor) return;

 contenedor.innerHTML = `
 <div class="market-admin-estado ${datos.visible ? "visible" : "oculto"}">
 <div>
 <strong>${datos.visible ? "Tu tienda esta visible en Nexo Market" : "Tu tienda esta oculta en Nexo Market"}</strong>
 <p>${datos.visible ? "Los compradores pueden encontrar tu catalogo al buscar en Nexo Market." : "Activa tu sitio (pestana Informacion) para que tu catalogo aparezca en Nexo Market."}</p>
 </div>
 <div class="market-admin-estado-acciones">
 <button type="button" class="btn-encargo-secundario" onclick="window.open('${datos.urlMarket}', '_blank')">Ver mi tienda en Market</button>
 </div>
 </div>

 <div class="market-admin-stats">
 <div class="market-admin-stat">
 <span>Destacados y ofertas</span>
 <strong>${datos.totalDestacadosOfertas}</strong>
 </div>
 <div class="market-admin-stat">
 <span>Pedidos de Market (30 dias)</span>
 <strong>${datos.pedidosMarket30Dias}</strong>
 </div>
 </div>

 <div class="sitio-web-panel">
 <h3 class="sitio-web-panel-titulo">Productos destacados y en oferta</h3>
 <p class="market-admin-nota">Se editan desde Inventario -- aqui solo se ven los que ya marcaste.</p>
 <div id="sitioWebMarketDestacadosLista"><p>Cargando...</p></div>
 </div>

 <div class="sitio-web-panel">
 <h3 class="sitio-web-panel-titulo">Pedidos de Nexo Market</h3>
 <p class="market-admin-nota">Se atienden desde la pestana "Pedidos" -- los de Market llevan la etiqueta "Nexo Market".</p>
 <button type="button" class="btn-encargo-secundario" onclick="activarPestanaSitioWeb('pedidos')">Ver todos mis pedidos</button>
 </div>
 `;
}

async function cargarProductosDestacadosMarketSitioWeb() {
 const contenedor =
 document.getElementById("sitioWebMarketDestacadosLista");

 if (!contenedor) return;

 try {
 const respuesta = await fetch("/negocio-actual/productos-destacados");
 const datos = await respuesta.json();

 if (!datos.ok) {
 contenedor.innerHTML = `<p>No se pudieron cargar tus productos destacados.</p>`;
 return;
 }

 renderListaDestacadosMarketSitioWeb(datos.productos || []);
 } catch (error) {
 contenedor.innerHTML = `<p>No se pudieron cargar tus productos destacados. Revisa tu conexion.</p>`;
 }
}

function renderListaDestacadosMarketSitioWeb(productos) {
 const contenedor =
 document.getElementById("sitioWebMarketDestacadosLista");

 if (!contenedor) return;

 if (!productos.length) {
 contenedor.innerHTML = `<p>Todavia no marcas productos como destacados ni les pones precio de oferta. Hazlo desde Inventario &rarr; Editar producto.</p>`;
 return;
 }

 const escapar = escaparSitioWeb;

 contenedor.innerHTML = productos.map(p => `
 <div class="sitio-web-pedido-item">
 <div class="sitio-web-pedido-cabecera">
 <strong>${escapar(p.nombre)}</strong>
 ${p.destacado ? `<span class="sitio-web-pedido-badge atendido">Destacado</span>` : ""}
 ${p.precioOferta !== null ? `<span class="sitio-web-pedido-tipo cotizacion">Oferta</span>` : ""}
 </div>
 <div class="sitio-web-pedido-cliente">
 $${Number(p.precio).toFixed(2)}${p.precioOferta !== null ? ` &rarr; $${Number(p.precioOferta).toFixed(2)}` : ""}
 </div>
 </div>
 `).join("");
}

/* ---------- Editor de Promocion por plantillas ---------- */

function sitioWebPromocionEditorHtml(datos) {
 const colorActual = datos.promocionColorAcento || "#1067e8";
 return `
 <div class="sitio-web-panel">
 <label class="sitio-web-toggle">
 <input type="checkbox" id="sitioWebPromocionActiva" ${datos.promocionActiva ? "checked" : ""} onchange="actualizarVistaPreviaPromocion()">
 <span>Promocion activa (aviso en la parte superior del sitio)</span>
 </label>

 <div>
 <span class="sitio-web-promocion-label">Plantilla</span>
 <div class="sitio-web-plantillas-grid" id="sitioWebPlantillasGrid">
 ${SITIO_WEB_PLANTILLAS_PROMOCION.map(p => sitioWebTarjetaPlantillaHtml(p, p.id === (datos.promocionPlantilla || "clasica"))).join("")}
 </div>
 </div>

 <label>
 <span>Titulo</span>
 <input type="text" id="sitioWebPromocionTitulo" maxlength="140" placeholder="Ej. Descuento de temporada" value="${datos.promocionTitulo || ""}" oninput="actualizarVistaPreviaPromocionDebounced()">
 </label>

 <label>
 <span>Texto</span>
 <textarea id="sitioWebPromocionTexto" rows="2" maxlength="500" placeholder="Ej. 10% de descuento en herramienta electrica esta semana." oninput="actualizarVistaPreviaPromocionDebounced()">${datos.promocionTexto || ""}</textarea>
 </label>

 <label>
 <span>Texto del boton</span>
 <input type="text" id="sitioWebPromocionTextoBoton" maxlength="40" placeholder="Ej. Ver ofertas" value="${datos.promocionTextoBoton || ""}" oninput="actualizarVistaPreviaPromocionDebounced()">
 </label>

 <label>
 <span>Enlace del boton (opcional)</span>
 <input type="text" id="sitioWebPromocionEnlace" maxlength="300" placeholder="Ej. https://tu-sitio.nexoposoficial.com/catalogo" value="${datos.promocionEnlace || ""}" oninput="actualizarVistaPreviaPromocionDebounced()">
 </label>

 <div>
 <span class="sitio-web-promocion-label">Color de acento</span>
 <div class="sitio-web-colores-fila">
 ${SITIO_WEB_COLORES_PRESET.map(c => `
 <button type="button" class="sitio-web-color-swatch${c.toLowerCase() === colorActual.toLowerCase() ? " activo" : ""}" style="background:${c}" data-color="${c}" onclick="elegirColorPromocion('${c}')"></button>
 `).join("")}
 <input type="color" id="sitioWebPromocionColorInput" value="${colorActual}" oninput="elegirColorPromocion(this.value)">
 </div>
 </div>

 <label>
 <span>Foto de la promocion (opcional)</span>
 <input type="file" id="sitioWebPromocionImagenInput" accept="image/*" onchange="iniciarRecorteImagenPromocion(event)">
 </label>
 <p class="sitio-web-nota">Al elegir una foto se abre un recorte con guias para encuadrarla -- se usa exactamente lo que recortes, la plantilla "Minimal" no necesita foto.</p>
 <div id="sitioWebPromocionImagenPreview" class="sitio-web-portada-preview">
 ${datos.promocionTieneImagen ? `<img src="/sitio-web-promocion-imagen?negocio=${encodeURIComponent(datos.slug)}&v=${Date.now()}" alt="Imagen de la promocion">` : ""}
 </div>
 <p class="sitio-web-nota" id="sitioWebPromocionImagenEstado" style="display:none;"></p>
 </div>
 `;
}

function sitioWebTarjetaPlantillaHtml(plantilla, activa) {
 return `
 <button type="button" class="sitio-web-plantilla-tarjeta${activa ? " activo" : ""}" data-plantilla="${plantilla.id}" onclick="elegirPlantillaPromocion('${plantilla.id}')">
 <span class="sitio-web-plantilla-miniatura sitio-web-plantilla-miniatura--${plantilla.id}"></span>
 <strong>${plantilla.nombre}</strong>
 <span>${plantilla.descripcion}</span>
 </button>
 `;
}

function elegirPlantillaPromocion(id) {
 document.querySelectorAll(".sitio-web-plantilla-tarjeta").forEach(tarjeta => {
 tarjeta.classList.toggle("activo", tarjeta.dataset.plantilla === id);
 });
 actualizarVistaPreviaPromocion();
}

function plantillaPromocionElegida() {
 const activa = document.querySelector(".sitio-web-plantilla-tarjeta.activo");
 return activa ? activa.dataset.plantilla : "clasica";
}

function elegirColorPromocion(color) {
 document.querySelectorAll(".sitio-web-color-swatch").forEach(boton => {
 boton.classList.toggle("activo", boton.dataset.color.toLowerCase() === color.toLowerCase());
 });
 const input = document.getElementById("sitioWebPromocionColorInput");
 if (input) input.value = color;
 actualizarVistaPreviaPromocionDebounced();
}

// Vista previa en vivo: manda los campos EN BORRADOR (todavia sin
// guardar) al servidor, que devuelve el HTML REAL de la plantilla
// elegida (mismo dispatcher que renderiza el sitio publico) -- nunca
// una maqueta aparte que se pueda desincronizar. Con debounce para no
// mandar un fetch por cada tecla.
let sitioWebPreviewPromoTimeout = null;
function actualizarVistaPreviaPromocionDebounced() {
 clearTimeout(sitioWebPreviewPromoTimeout);
 sitioWebPreviewPromoTimeout = setTimeout(actualizarVistaPreviaPromocion, 350);
}

async function actualizarVistaPreviaPromocion() {
 const contenedor =
 document.getElementById("sitioWebPreviewPromo");

 if (!contenedor) return;

 const activa = document.getElementById("sitioWebPromocionActiva")?.checked;
 const titulo = document.getElementById("sitioWebPromocionTitulo")?.value || "";
 const texto = document.getElementById("sitioWebPromocionTexto")?.value || "";

 if (!activa || !titulo || !texto) {
 contenedor.innerHTML = `<p class="sitio-web-nota">Activa la promocion y completa titulo/texto para verla aqui.</p>`;
 return;
 }

 try {
 const respuesta = await fetch("/negocio-actual/sitio-web/promocion-preview", {
 method: "POST",
 headers: { "Content-Type": "application/json" },
 body: JSON.stringify({
 promocionTitulo: titulo,
 promocionTexto: texto,
 promocionTextoBoton: document.getElementById("sitioWebPromocionTextoBoton")?.value || "",
 promocionEnlace: document.getElementById("sitioWebPromocionEnlace")?.value || "",
 promocionPlantilla: plantillaPromocionElegida(),
 promocionColorAcento: document.getElementById("sitioWebPromocionColorInput")?.value || ""
 })
 });

 const datos = await respuesta.json();
 if (!datos.ok) return;

 contenedor.innerHTML = datos.html || `<p class="sitio-web-nota">Activa la promocion y completa titulo/texto para verla aqui.</p>`;
 } catch (error) { /* la vista previa es informativa, un fallo no bloquea el editor */ }
}

/* ---------- Recorte de foto con guias ---------- */

const SITIO_WEB_RECORTE_ANCHO = 1200;
const SITIO_WEB_RECORTE_ALTO = 500;

let sitioWebRecorteArchivo = null;
let sitioWebRecorteNatural = { width: 0, height: 0 };
let sitioWebRecorteZoom = 1;
let sitioWebRecorteOffset = { x: 0, y: 0 };
let sitioWebRecorteArrastre = null;

function iniciarRecorteImagenPromocion(evento) {
 const archivo = evento.target.files?.[0];
 if (!archivo) return;
 sitioWebRecorteArchivo = archivo;

 const lector = new FileReader();
 lector.onload = e => abrirModalRecorteImagen(e.target.result);
 lector.readAsDataURL(archivo);
}

function abrirModalRecorteImagen(urlImagen) {
 cerrarModalRecorteImagen();

 const modal = document.createElement("div");
 modal.id = "sitioWebRecorteModal";
 modal.className = "sitio-web-recorte-overlay";
 modal.innerHTML = `
 <div class="sitio-web-recorte-caja">
 <h3>Encuadra tu foto</h3>
 <p class="sitio-web-nota">Arrastra para mover y usa el control para acercar. La zona visible es exactamente lo que se va a publicar.</p>
 <div class="sitio-web-recorte-marco" id="sitioWebRecorteMarco">
 <img id="sitioWebRecorteImg" src="${urlImagen}" alt="">
 <div class="sitio-web-recorte-guias">
 <div></div><div></div><div></div><div></div>
 </div>
 </div>
 <input type="range" id="sitioWebRecorteZoomInput" min="1" max="3" step="0.01" value="1">
 <div class="sitio-web-recorte-acciones">
 <button type="button" class="btn-encargo-secundario" onclick="cerrarModalRecorteImagen()">Cancelar</button>
 <button type="button" class="btn-encargo-primario" onclick="confirmarRecorteImagenPromocion()">Usar esta foto</button>
 </div>
 </div>
 `;
 document.body.appendChild(modal);

 const img = document.getElementById("sitioWebRecorteImg");
 img.onload = () => {
 sitioWebRecorteNatural = { width: img.naturalWidth, height: img.naturalHeight };
 sitioWebRecorteZoom = 1;
 sitioWebRecorteOffset = { x: 0, y: 0 };
 centrarRecorteImagen();
 aplicarEstiloRecorteImagen();
 };

 const marco = document.getElementById("sitioWebRecorteMarco");
 marco.addEventListener("pointerdown", iniciarArrastreRecorte);
 window.addEventListener("pointermove", moverArrastreRecorte);
 window.addEventListener("pointerup", terminarArrastreRecorte);

 document.getElementById("sitioWebRecorteZoomInput").addEventListener("input", evento => {
 sitioWebRecorteZoom = Number(evento.target.value) || 1;
 clampOffsetRecorteImagen();
 aplicarEstiloRecorteImagen();
 });
}

function cerrarModalRecorteImagen() {
 const modal = document.getElementById("sitioWebRecorteModal");
 if (modal) modal.remove();
 window.removeEventListener("pointermove", moverArrastreRecorte);
 window.removeEventListener("pointerup", terminarArrastreRecorte);
 sitioWebRecorteArrastre = null;
}

function dimensionesMarcoRecorte() {
 const marco = document.getElementById("sitioWebRecorteMarco");
 return marco ? { width: marco.clientWidth, height: marco.clientHeight } : { width: 480, height: 200 };
}

function escalaBaseRecorte() {
 const marco = dimensionesMarcoRecorte();
 if (!sitioWebRecorteNatural.width || !sitioWebRecorteNatural.height) return 1;
 return Math.max(marco.width / sitioWebRecorteNatural.width, marco.height / sitioWebRecorteNatural.height);
}

function centrarRecorteImagen() {
 const marco = dimensionesMarcoRecorte();
 const escala = escalaBaseRecorte() * sitioWebRecorteZoom;
 const dispW = sitioWebRecorteNatural.width * escala;
 const dispH = sitioWebRecorteNatural.height * escala;
 sitioWebRecorteOffset = { x: (marco.width - dispW) / 2, y: (marco.height - dispH) / 2 };
}

function clampOffsetRecorteImagen() {
 const marco = dimensionesMarcoRecorte();
 const escala = escalaBaseRecorte() * sitioWebRecorteZoom;
 const dispW = sitioWebRecorteNatural.width * escala;
 const dispH = sitioWebRecorteNatural.height * escala;
 sitioWebRecorteOffset.x = Math.min(0, Math.max(marco.width - dispW, sitioWebRecorteOffset.x));
 sitioWebRecorteOffset.y = Math.min(0, Math.max(marco.height - dispH, sitioWebRecorteOffset.y));
}

function aplicarEstiloRecorteImagen() {
 const img = document.getElementById("sitioWebRecorteImg");
 if (!img) return;
 const escala = escalaBaseRecorte() * sitioWebRecorteZoom;
 img.style.width = `${sitioWebRecorteNatural.width * escala}px`;
 img.style.height = `${sitioWebRecorteNatural.height * escala}px`;
 img.style.left = `${sitioWebRecorteOffset.x}px`;
 img.style.top = `${sitioWebRecorteOffset.y}px`;
}

function iniciarArrastreRecorte(evento) {
 sitioWebRecorteArrastre = { x: evento.clientX, y: evento.clientY, offset: { ...sitioWebRecorteOffset } };
}

function moverArrastreRecorte(evento) {
 if (!sitioWebRecorteArrastre) return;
 sitioWebRecorteOffset = {
 x: sitioWebRecorteArrastre.offset.x + (evento.clientX - sitioWebRecorteArrastre.x),
 y: sitioWebRecorteArrastre.offset.y + (evento.clientY - sitioWebRecorteArrastre.y)
 };
 clampOffsetRecorteImagen();
 aplicarEstiloRecorteImagen();
}

function terminarArrastreRecorte() {
 sitioWebRecorteArrastre = null;
}

async function confirmarRecorteImagenPromocion() {
 if (!sitioWebRecorteArchivo || !sitioWebRecorteNatural.width) return;

 const marco = dimensionesMarcoRecorte();
 const escala = escalaBaseRecorte() * sitioWebRecorteZoom;

 // El rectangulo visible del marco, convertido a coordenadas de
 // pixel de la imagen ORIGINAL (antes de escalar para mostrarla).
 const recorte = {
 left: -sitioWebRecorteOffset.x / escala,
 top: -sitioWebRecorteOffset.y / escala,
 width: marco.width / escala,
 height: marco.height / escala
 };

 cerrarModalRecorteImagen();
 await subirPromocionImagenSitioWeb(sitioWebRecorteArchivo, recorte);
 sitioWebRecorteArchivo = null;
}

// Imagen de la promocion (Fase "Ofertas destacadas", ver plan) -- a
// diferencia de la portada (que viaja como base64 dentro del mismo
// PUT de guardarSitioWeb), esta se sube aparte de inmediato via
// multipart/form-data junto con el rectangulo de recorte que el
// dueno encuadro (ver arriba) -- el servidor la recorta exactamente
// asi en vez de adivinar con un cover ciego.
async function subirPromocionImagenSitioWeb(archivo, recorte) {
 const estado =
 document.getElementById("sitioWebPromocionImagenEstado");

 if (estado) {
 estado.style.display = "";
 estado.textContent = "Subiendo imagen...";
 }

 try {
 const formulario = new FormData();
 formulario.append("imagen", archivo);
 if (recorte) formulario.append("recorte", JSON.stringify(recorte));

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
 actualizarVistaPreviaPromocion();
 } catch (error) {
 if (estado) estado.textContent = "No se pudo subir la imagen. Revisa tu conexion.";
 }
}

/* ---------- Envio / guardado general ---------- */

// Politica de envio por tienda (Fase 1, sin pagos -- ver plan): la
// tarifa solo aplica en el modo "tarifa_fija", el campo se muestra u
// oculta segun el select en vez de dejarlo siempre visible.
function actualizarVisibilidadTarifaEnvioSitioWeb() {
 const modo = document.getElementById("sitioWebEnvioModo")?.value;
 const campo = document.getElementById("sitioWebEnvioTarifaCampo");
 if (campo) campo.style.display = modo === "tarifa_fija" ? "" : "none";
}

async function guardarSitioWeb() {
 const envioModo = document.getElementById("sitioWebEnvioModo")?.value || "a_coordinar";
 const payload = {
 activo: document.getElementById("sitioWebActivo")?.checked || false,
 mostrarPrecios: document.getElementById("sitioWebMostrarPrecios")?.checked || false,
 mostrarExistencias: document.getElementById("sitioWebMostrarExistencias")?.checked || false,
 aceptarSolicitudesCredito: document.getElementById("sitioWebAceptarCredito")?.checked || false,
 promocionActiva: document.getElementById("sitioWebPromocionActiva")?.checked || false,
 promocionTitulo: document.getElementById("sitioWebPromocionTitulo")?.value || "",
 promocionTexto: document.getElementById("sitioWebPromocionTexto")?.value || "",
 promocionTextoBoton: document.getElementById("sitioWebPromocionTextoBoton")?.value || "",
 promocionEnlace: document.getElementById("sitioWebPromocionEnlace")?.value || "",
 promocionPlantilla: plantillaPromocionElegida(),
 promocionColorAcento: document.getElementById("sitioWebPromocionColorInput")?.value || "",
 envioModo: envioModo,
 envioTarifa: envioModo === "tarifa_fija" ? (parseFloat(document.getElementById("sitioWebEnvioTarifa")?.value) || 0) : null,
 envioNotas: document.getElementById("sitioWebEnvioNotas")?.value || "",
 descripcion: document.getElementById("sitioWebDescripcion")?.value || "",
 direccion: document.getElementById("sitioWebDireccion")?.value || "",
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

 if (datos.direccionUbicada === false) {
 if (typeof alertaPOS === "function") alertaPOS("Sitio web actualizado, pero no pudimos ubicar esa direccion en el mapa. Revisa que tenga calle, colonia y ciudad.", "Sitio web", "alerta");
 } else if (typeof alertaPOS === "function") {
 alertaPOS("Sitio web actualizado.", "Sitio web", "exito");
 }
 mostrarSitioWeb();
 } catch (error) {
 if (typeof alertaPOS === "function") alertaPOS("No se pudo guardar. Revisa tu conexion.", "Sitio web", "alerta");
 }
}
