// Recepcion Inteligente. Pipeline: subida manual (Fase 1) + Gmail
// conectado (Fase 2/3, ver recepcion-inteligente-gmail.js) alimentan el
// mismo backend -- esta vista solo cambia como se ve, nunca la logica
// de negocio.
//
// Diseno: mismo lenguaje visual minimalista que Creditos
// (pos-credit-modal.css) -- tarjetas planas, tokens --pos-*, lista y
// detalle a todo lo ancho navegando entre ellas (nunca side-by-side)
// para que la tabla de conceptos tenga espacio real.
//
// Principio del diseno aprobado (sin cambios): ningun boton de esta
// pantalla toca inventario excepto "Confirmar recepcion", y solo
// despues de que cada concepto amarillo ya tiene una decision humana.
let recepcionInteligenteActualId = null;
let recepcionInteligenteItemsActuales = [];
let recepcionInteligenteFacturasActuales = [];
let recepcionInteligenteFotosActuales = new Map();

const RI_NIVEL_ETIQUETA = { fuerte: "🟢 Identificado", probable: "🟡 Revisar" };

// El candidato trae precios de referencia con 2 nombres distintos segun
// de donde salio (ver recepcion-inteligente-matching.js): catalogo de
// proveedor/codigo usa precioPublico/precioMedioMayoreo/precioDistribuidor,
// Catalogo Maestro/fabricante usa el mismo trio con prefijo "Lista". Esto
// los normaliza a un solo trio, sin importar la fuente.
function riPreciosReferenciaCandidato(candidato) {
	if (!candidato) return null;

	const publico = candidato.precioPublico ?? candidato.precioListaPublico ?? candidato.precio ?? null;
	const medioMayoreo = candidato.precioMedioMayoreo ?? candidato.precioListaMedioMayoreo ?? null;
	const distribuidor = candidato.precioDistribuidor ?? candidato.precioListaDistribuidor ?? null;

	if (publico == null && medioMayoreo == null && distribuidor == null) return null;
	return { publico, medioMayoreo, distribuidor };
}

// Regla de negocio confirmada (Ferreteria Olimpico): el precio de venta
// por defecto es el medio mayoreo del proveedor/catalogo maestro, no el
// publico -- ver memoria "Catalogo proveedor: precio medio mayoreo".
// Publico/distribuidor quedan disponibles para el concepto puntual que
// no siga esa regla general.
function riPrecioSugerido(candidato) {
	const precios = riPreciosReferenciaCandidato(candidato);
	if (!precios) return null;

	if (precios.medioMayoreo != null) return { valor: precios.medioMayoreo, etiqueta: "medio mayoreo" };
	if (precios.publico != null) return { valor: precios.publico, etiqueta: "público" };
	return { valor: precios.distribuidor, etiqueta: "distribuidor" };
}

function riBadgeEstado(recepcion) {
	if (recepcion.porRevisar === 0) return `<span class="ri-badge ri-badge-ok">🟢 Todo identificado</span>`;
	return `<span class="ri-badge ri-badge-revisar">🟡 ${recepcion.porRevisar} por revisar</span>`;
}

// "gmail" (Nexo la encontro solo) vs "manual" (XML subido a mano) --
// distincion puramente informativa para que el dueño sepa de un
// vistazo cuales facturas detecto Nexo solo.
function riIconoOrigen(origen) {
	return origen === "gmail" ? "📧" : "📎";
}

function riBadgeGeneral(estado) {
	if (estado === "confirmada") return `<span class="ri-badge ri-badge-ok">Confirmada</span>`;
	if (estado === "rechazada") return `<span class="ri-badge ri-badge-rechazada">Rechazada</span>`;
	return `<span class="ri-badge ri-badge-pendiente">Pendiente de revisión</span>`;
}

async function mostrarRecepcionInteligente() {
	if (typeof ocultarPantallasPrincipales === "function") ocultarPantallasPrincipales();

	const pantalla = document.getElementById("pantallaRecepcionInteligente");
	if (!pantalla) return;

	pantalla.style.display = "block";

	if (typeof actualizarTopbarContexto === "function") {
		actualizarTopbarContexto("Recepción Inteligente", "Facturas de proveedor convertidas en recepción pendiente de revisión.", "recepcion-inteligente");
	}

	recepcionInteligenteActualId = null;

	pantalla.innerHTML = `
		<div class="ri-shell">
			<div class="ri-header">
				<h2>Recepción Inteligente</h2>
				<p>Sube una factura o conecta tu Gmail -- Nexo arma la recepción sola, tú solo confirmas.</p>
			</div>

			<div class="ri-stats" id="riStats"></div>

			<div class="ri-toolbar">
				<div class="ri-toolbar-izq">
					<input type="file" id="riArchivoXml" accept=".xml,text/xml" style="display:none" onchange="riSubirFacturaSeleccionada(event)">
					<button type="button" class="btn-agregar" onclick="document.getElementById('riArchivoXml').click()">📎 Subir factura</button>
					<span id="riSubiendoAviso" style="display:none">Leyendo factura…</span>
				</div>
				<div class="ri-gmail-estado" id="riGmailSeccion"></div>
			</div>

			<div class="ri-panel" id="riListaPanel">
				<div class="ri-lista-toolbar">
					<input type="search" id="riBuscador" placeholder="Buscar por proveedor o folio…" oninput="riFiltrarLista()">
				</div>
				<div style="overflow-x:auto">
					<table class="ri-tabla-facturas">
						<thead><tr><th>Proveedor</th><th>Total</th><th>Estado</th><th></th></tr></thead>
						<tbody id="riListaFacturasBody"><tr><td colspan="4" class="ri-vacio">Cargando…</td></tr></tbody>
					</table>
				</div>
			</div>

			<div class="ri-panel" id="riDetallePanel" style="display:none"></div>
		</div>
	`;

	// Delegado sobre el panel entero (nunca se reemplaza el elemento en
	// si, solo su innerHTML en cada riVerDetalle) -- evita el bug real
	// de onclick="fn('...')" con texto interpolado: un apostrofe en la
	// descripcion (comun en medidas, ej. 5' de manguera) rompia la
	// sintaxis del atributo despues de que el navegador decodificaba la
	// entidad HTML de escaparPOS, dejando "Relacionar"/"Crear" muertos
	// en silencio. Con data-* no hace falta escapar nada para JS, el
	// navegador ya decodifica el atributo al leer .dataset.
	document.getElementById("riDetallePanel").addEventListener("click", event => {
		const boton = event.target.closest("[data-ri-accion]");
		if (!boton) return;

		const itemId = Number(boton.dataset.itemId);
		const accion = boton.dataset.riAccion;

		if (accion === "relacionar") riRelacionarProducto(itemId, boton.dataset.descripcion);
		else if (accion === "crear") riCrearProducto(itemId, boton.dataset.nombre);
		else if (accion === "omitir") riOmitirItem(itemId);
		else if (accion === "cambiar") riCambiarDecisionItem(itemId);
		else if (accion === "ver-producto") riVerProductoModal(itemId);
	});

	await riCargarLista();
	await riCargarEstadoGmail();
}

// Fase 2/3: la factura llega sola por Gmail en vez de subirse a mano.
// Seccion auto-oculta si el servidor todavia no tiene Gmail configurado
// (faltan pasos manuales en Google Cloud Console) -- nada que confundir
// mientras tanto, aparece sola en cuanto esos pasos queden listos.
async function riCargarEstadoGmail() {
	const contenedor = document.getElementById("riGmailSeccion");
	if (!contenedor) return;

	try {
		const respuesta = await fetch("/recepcion-inteligente/gmail/estado");
		const datos = await respuesta.json();
		if (!datos.ok) { contenedor.innerHTML = ""; return; }

		if (!datos.conectado) {
			contenedor.innerHTML = datos.configurado
				? `<button type="button" class="btn-secundario" onclick="riConectarGmail()">📧 Conectar Gmail</button>`
				: "";
			return;
		}

		contenedor.innerHTML = `
			<span title="Nexo revisa este correo automáticamente cada cierto tiempo">📧 <strong>${escaparPOS(datos.correo)}</strong></span>
			<button type="button" class="btn-secundario" id="riGmailBuscarBoton" onclick="riBuscarFacturasGmail()">Revisar ahora</button>
			<button type="button" class="btn-mini" onclick="riDesconectarGmail()">Desconectar</button>
		`;
	} catch (error) {
		contenedor.innerHTML = "";
	}
}

async function riConectarGmail() {
	const respuesta = await fetch("/recepcion-inteligente/gmail/iniciar", { method: "POST" });
	const datos = await respuesta.json().catch(() => ({}));

	if (!respuesta.ok || !datos.ok) {
		await alertaPOS(datos.error || "No se pudo iniciar la conexion con Gmail.", "Conectar Gmail", "peligro");
		return;
	}

	// Navegacion normal de pagina completa (no fetch): Google necesita
	// mostrar su propia pantalla de consentimiento antes de regresar.
	window.location.href = datos.url;
}

async function riBuscarFacturasGmail() {
	const boton = document.getElementById("riGmailBuscarBoton");
	if (boton) { boton.disabled = true; boton.textContent = "Buscando…"; }

	try {
		const respuesta = await fetch("/recepcion-inteligente/gmail/buscar", { method: "POST" });
		const datos = await respuesta.json().catch(() => ({}));

		if (!respuesta.ok || !datos.ok) {
			await alertaPOS(datos.error || "No se pudo buscar en Gmail.", "Buscar facturas nuevas", "peligro");
			return;
		}

		const partes = [];
		if (datos.nuevas) partes.push(`${datos.nuevas} nueva(s)`);
		if (datos.repetidas) partes.push(`${datos.repetidas} ya conocida(s)`);
		if (datos.fallidas) partes.push(`${datos.fallidas} sin poder leer`);

		await alertaPOS(
			datos.mensajesRevisados
				? `Se revisaron ${datos.mensajesRevisados} correo(s): ${partes.join(", ") || "nada nuevo"}.`
				: "No hay correos nuevos con factura adjunta desde la ultima revision.",
			"Buscar facturas nuevas",
			"exito"
		);

		await riCargarLista();
		await riCargarEstadoGmail();
	} finally {
		if (boton) { boton.disabled = false; boton.textContent = "Revisar ahora"; }
	}
}

async function riDesconectarGmail() {
	const confirmado = await confirmarPOS("Nexo dejara de poder buscar facturas en este correo hasta que lo vuelvas a conectar.", "Desconectar Gmail");
	if (!confirmado) return;

	const respuesta = await fetch("/recepcion-inteligente/gmail/desconectar", { method: "POST" });
	const datos = await respuesta.json().catch(() => ({}));

	if (!respuesta.ok || !datos.ok) {
		await alertaPOS(datos.error || "No se pudo desconectar.", "Desconectar Gmail", "peligro");
		return;
	}

	await riCargarEstadoGmail();
}

async function riSubirFacturaSeleccionada(event) {
	const archivo = event.target.files?.[0];
	event.target.value = "";
	if (!archivo) return;

	const aviso = document.getElementById("riSubiendoAviso");
	if (aviso) aviso.style.display = "inline";

	try {
		const xml = await archivo.text();
		const respuesta = await fetch("/recepcion-inteligente/facturas", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ xml })
		});
		const datos = await respuesta.json().catch(() => ({}));

		if (!respuesta.ok || !datos.ok) {
			await alertaPOS(datos.error || "No se pudo leer la factura.", "Recepción Inteligente", "peligro");
			return;
		}

		if (datos.repetida) {
			await alertaPOS("Esta factura ya se había subido antes (mismo UUID). No se creó una recepción duplicada.", "Factura repetida", "info");
		} else {
			await alertaPOS(`Factura leída: ${datos.totalConceptos} producto(s), ${datos.identificados} identificados automáticamente, ${datos.porRevisar} por revisar.`, "Factura detectada", "exito");
		}

		await riCargarLista();
		if (datos.recepcionId) await riVerDetalle(datos.recepcionId);
	} catch (error) {
		await alertaPOS("No se pudo leer el archivo. ¿Es un XML de factura válido?", "Recepción Inteligente", "peligro");
	} finally {
		if (aviso) aviso.style.display = "none";
	}
}

// 3 numeros de un vistazo (calculados aqui mismo, del listado ya
// cargado -- no hace falta otro viaje al servidor): cuantas facturas
// esperan revision, cuantos conceptos sueltos quedan por decidir en
// total, y cuantas se confirmaron ya este mes.
function riRenderStats(facturas) {
	const contenedor = document.getElementById("riStats");
	if (!contenedor) return;

	const pendientes = facturas.filter(f => f.estado === "pendiente");
	const porRevisar = pendientes.reduce((total, f) => total + f.porRevisar, 0);

	const ahora = new Date();
	const confirmadasEsteMes = facturas.filter(f => {
		if (f.estado !== "confirmada" || !f.confirmadaEn) return false;
		const fecha = new Date(f.confirmadaEn);
		return fecha.getFullYear() === ahora.getFullYear() && fecha.getMonth() === ahora.getMonth();
	}).length;

	contenedor.innerHTML = `
		<div class="ri-stat ri-stat-orange">
			<span class="ri-stat-icono">🕓</span>
			<div><small>Pendientes</small><strong>${pendientes.length}</strong></div>
		</div>
		<div class="ri-stat ri-stat-blue">
			<span class="ri-stat-icono">📋</span>
			<div><small>Conceptos por revisar</small><strong>${porRevisar}</strong></div>
		</div>
		<div class="ri-stat ri-stat-green">
			<span class="ri-stat-icono">✅</span>
			<div><small>Confirmadas este mes</small><strong>${confirmadasEsteMes}</strong></div>
		</div>
	`;
}

function riRenderTablaFacturas(facturas) {
	const contenedor = document.getElementById("riListaFacturasBody");
	if (!contenedor) return;

	if (!facturas.length) {
		contenedor.innerHTML = `<tr><td colspan="4" class="ri-vacio">Todavía no has subido ninguna factura.</td></tr>`;
		return;
	}

	contenedor.innerHTML = facturas.map(f => `
		<tr class="ri-fila-factura" onclick="riVerDetalle(${f.id})">
			<td>
				<div class="ri-celda-proveedor">
					<span class="ri-avatar ${f.origen === "gmail" ? "" : "manual"}">${riIconoOrigen(f.origen)}</span>
					<div class="ri-proveedor-texto">
						<strong>${escaparPOS(f.proveedor)}</strong>
						<small>Folio ${escaparPOS(f.folio || "-")}</small>
					</div>
				</div>
			</td>
			<td>$${f.total.toFixed(2)}</td>
			<td>${riBadgeGeneral(f.estado)}</td>
			<td>${f.estado === "pendiente" ? riBadgeEstado(f) : ""}</td>
		</tr>
	`).join("");
}

function riFiltrarLista() {
	const termino = (document.getElementById("riBuscador")?.value || "").trim().toLowerCase();
	if (!termino) { riRenderTablaFacturas(recepcionInteligenteFacturasActuales); return; }

	const filtradas = recepcionInteligenteFacturasActuales.filter(f =>
		f.proveedor.toLowerCase().includes(termino) || (f.folio || "").toLowerCase().includes(termino)
	);
	riRenderTablaFacturas(filtradas);
}

async function riCargarLista() {
	try {
		const respuesta = await fetch("/recepcion-inteligente/facturas");
		const datos = await respuesta.json();
		recepcionInteligenteFacturasActuales = datos.facturas || [];

		riRenderStats(recepcionInteligenteFacturasActuales);
		riFiltrarLista();
	} catch (error) {
		const contenedor = document.getElementById("riListaFacturasBody");
		if (contenedor) contenedor.innerHTML = `<tr><td colspan="4" class="ri-vacio">No se pudo cargar la lista.</td></tr>`;
	}
}

// Mismo endpoint que ya usa Explorar Nexo para resolver la foto
// principal de un codigo (banco de imagenes propio, o si no hay, la
// del fabricante) -- nunca se duplica esa logica aqui. Un item sin
// candidato o sin foto resuelta simplemente no trae imagen (icono
// generico), nunca es un error.
async function riResolverFotos(items) {
	const codigos = [...new Set(items.map(it => it.candidato?.codigo || it.codigo).filter(Boolean))];

	const entradas = await Promise.all(codigos.map(async codigo => {
		try {
			const respuesta = await fetch(`/explorar-nexo/foto/${encodeURIComponent(codigo)}`);
			const datos = await respuesta.json();
			return [codigo, datos.url || null];
		} catch (error) {
			return [codigo, null];
		}
	}));

	return new Map(entradas);
}

// Lista y detalle nunca se muestran a la vez -- se navega de una a
// otra, cada una a todo lo ancho (mismo patron que Creditos), para que
// la tabla de conceptos tenga espacio real en vez de compartir la
// pantalla con la lista.
async function riVerDetalle(id) {
	recepcionInteligenteActualId = id;

	document.getElementById("riListaPanel").style.display = "none";
	const panel = document.getElementById("riDetallePanel");
	panel.style.display = "grid";
	panel.innerHTML = `<p class="ri-vacio">Cargando…</p>`;

	const respuesta = await fetch(`/recepcion-inteligente/facturas/${id}`);
	const datos = await respuesta.json();

	if (!datos.ok) {
		panel.innerHTML = `
			<p class="ri-vacio">No se pudo cargar esta factura.</p>
			<button type="button" class="btn-secundario" onclick="riVolverALista()" style="justify-self:center">← Volver</button>
		`;
		return;
	}

	const { recepcion, items } = datos;
	recepcionInteligenteItemsActuales = items;
	recepcionInteligenteFotosActuales = await riResolverFotos(items);
	const sinDecidir = items.filter(it => !it.accion).length;
	const esGmail = recepcion.origen === "gmail";

	panel.innerHTML = `
		<div class="ri-detalle-header">
			<button type="button" class="btn-regresar" onclick="riVolverALista()">←</button>
			<span class="ri-avatar-grande ${esGmail ? "" : "manual"}">${riIconoOrigen(recepcion.origen)}</span>
			<div class="ri-detalle-info">
				<h2>${escaparPOS(recepcion.proveedor)}</h2>
				<p>
					<span>Folio ${escaparPOS(recepcion.folio || "-")}</span>
					<span class="punto">&middot;</span>
					<span>${recepcion.fechaDocumento ? new Date(recepcion.fechaDocumento).toLocaleDateString("es-MX") : ""}</span>
					<span class="punto">&middot;</span>
					<span>${esGmail ? "Detectada en Gmail" : "Subida a mano"}</span>
					<span class="punto">&middot;</span>
					${riBadgeGeneral(recepcion.estado)}
				</p>
			</div>
		</div>

		<div class="ri-detalle-resumen">
			<div><span>Subtotal</span><strong>$${recepcion.subtotal.toFixed(2)}</strong></div>
			<div><span>IVA</span><strong>$${recepcion.iva.toFixed(2)}</strong></div>
			<div><span>Total</span><strong>$${recepcion.total.toFixed(2)}</strong></div>
		</div>

		<div class="ri-tabla-wrap">
			<table class="ri-tabla-items">
				<thead><tr><th>Producto</th><th>Código</th><th>Cant.</th><th>Costo</th><th>Estado</th><th></th></tr></thead>
				<tbody>
					${items.map(it => riFilaItem(it, recepcion.estado)).join("")}
				</tbody>
			</table>
		</div>

		${recepcion.estado === "pendiente" ? `
			<div class="ri-acciones-footer">
				<button type="button" class="btn-secundario" onclick="riRechazar(${recepcion.id})">Rechazar factura</button>
				<button type="button" class="btn-agregar" onclick="riConfirmar(${recepcion.id})">
					Confirmar recepción${sinDecidir ? ` (${sinDecidir} sin revisar)` : ""}
				</button>
			</div>
		` : ""}
	`;
}

function riVolverALista() {
	recepcionInteligenteActualId = null;
	document.getElementById("riDetallePanel").style.display = "none";
	document.getElementById("riListaPanel").style.display = "grid";
	riCargarLista();
}

function riFilaItem(item, estadoRecepcion) {
	const nivel = item.nivel ? RI_NIVEL_ETIQUETA[item.nivel] : "🟡 Sin identificar";
	const yaDecidido = item.accion === "relacionar" ? "Relacionado"
		: item.accion === "crear" ? "Producto nuevo"
		: item.accion === "omitir" ? "Omitido"
		: nivel;

	const puedeEditar = estadoRecepcion === "pendiente";
	const sugerido = !item.accion ? riPrecioSugerido(item.candidato) : null;

	const codigoFoto = item.candidato?.codigo || item.codigo || "";
	const fotoUrl = codigoFoto ? recepcionInteligenteFotosActuales.get(codigoFoto) : null;

	return `
		<tr>
			<td>
				<div class="ri-item-celda">
					<div class="ri-item-foto" data-ri-accion="ver-producto" data-item-id="${item.id}" title="Ver detalle">
						${fotoUrl ? `<img src="${fotoUrl}" alt="">` : `<span>📦</span>`}
					</div>
					<div class="ri-item-texto">
						${escaparPOS(item.descripcion)}${item.candidato?.nombre ? `<small>${escaparPOS(item.candidato.nombre)}</small>` : ""}
					</div>
				</div>
			</td>
			<td>${escaparPOS(item.codigo || "-")}</td>
			<td>${item.cantidad}</td>
			<td>$${item.costo.toFixed(2)}${sugerido ? `<small>Venta: $${sugerido.valor.toFixed(2)} (${sugerido.etiqueta})</small>` : ""}</td>
			<td>${yaDecidido}</td>
			<td>${puedeEditar && !item.accion ? `
				<button type="button" class="btn-mini" data-ri-accion="relacionar" data-item-id="${item.id}" data-descripcion="${escaparPOS(item.descripcion)}">Relacionar</button>
				<button type="button" class="btn-mini" data-ri-accion="crear" data-item-id="${item.id}" data-nombre="${escaparPOS(item.candidato?.nombre || item.descripcion)}">Crear</button>
				<button type="button" class="btn-mini" data-ri-accion="omitir" data-item-id="${item.id}">Omitir</button>
			` : (puedeEditar ? `<button type="button" class="btn-mini" data-ri-accion="cambiar" data-item-id="${item.id}">Cambiar</button>` : "")}</td>
		</tr>
	`;
}

// Foto ampliada + detalle del producto de un concepto -- mismo patron
// de modal que ampliarImagenProductoPOS (pos-image-zoom.js): id fijo,
// display flex/none, Escape y clic afuera cierran. Muestra lo que ya
// se sabe de este concepto (candidato, precios de referencia) aunque
// todavia no tenga una decision -- nunca inventa datos que no existan.
function riVerProductoModal(itemId) {
	const item = recepcionInteligenteItemsActuales.find(it => it.id === itemId);
	if (!item) return;

	const codigoFoto = item.candidato?.codigo || item.codigo || "";
	const fotoUrl = codigoFoto ? recepcionInteligenteFotosActuales.get(codigoFoto) : null;
	const precios = riPreciosReferenciaCandidato(item.candidato);
	const nombre = item.candidato?.nombre || item.descripcion;
	const marca = item.candidato?.marca || null;

	let modal = document.getElementById("riModalProducto");
	if (!modal) {
		modal = document.createElement("div");
		modal.id = "riModalProducto";
		modal.className = "ri-modal-producto";
		document.body.appendChild(modal);
	}

	const cerrar = () => {
		modal.style.display = "none";
		modal.innerHTML = "";
		document.removeEventListener("keydown", manejarTeclado, true);
	};

	const manejarTeclado = event => {
		if (modal.style.display === "none") return;
		if (event.key === "Escape") { event.preventDefault(); cerrar(); }
	};

	modal.innerHTML = `
		<div class="ri-modal-producto-card">
			<button type="button" class="ri-modal-producto-cerrar" aria-label="Cerrar">✕</button>
			<div class="ri-modal-producto-foto">${fotoUrl ? `<img src="${fotoUrl}" alt="">` : `<span>📦</span>`}</div>
			<h3>${escaparPOS(nombre)}</h3>
			${marca ? `<p class="ri-modal-producto-marca">${escaparPOS(marca)}</p>` : ""}
			<dl class="ri-modal-producto-datos">
				<dt>Código</dt><dd>${escaparPOS(item.codigo || "-")}</dd>
				<dt>Cantidad en factura</dt><dd>${item.cantidad}</dd>
				<dt>Costo</dt><dd>$${item.costo.toFixed(2)}</dd>
			</dl>
			${precios ? `
				<div class="ri-modal-producto-precios">
					${precios.publico != null ? `<div><span>Público</span><strong>$${precios.publico.toFixed(2)}</strong></div>` : ""}
					${precios.medioMayoreo != null ? `<div><span>Medio mayoreo</span><strong>$${precios.medioMayoreo.toFixed(2)}</strong></div>` : ""}
					${precios.distribuidor != null ? `<div><span>Distribuidor</span><strong>$${precios.distribuidor.toFixed(2)}</strong></div>` : ""}
				</div>
			` : `<p class="ri-modal-producto-sin-precio">Todavía no hay precios de referencia para este producto.</p>`}
		</div>
	`;

	modal.style.display = "flex";
	modal.onclick = event => { if (event.target === modal) cerrar(); };
	modal.querySelector(".ri-modal-producto-cerrar").onclick = cerrar;

	document.addEventListener("keydown", manejarTeclado, true);
}

async function riRelacionarProducto(itemId, descripcion) {
	const respuesta = await fetch(`/explorar-nexo/buscar?q=${encodeURIComponent(descripcion)}`);
	const resultado = await respuesta.json().catch(() => null);
	const candidatos = resultado?.inventario || [];

	if (!candidatos.length) {
		await alertaPOS("No encontramos ningún producto parecido en tu inventario. Puedes crear uno nuevo en su lugar.", "Relacionar producto", "info");
		return;
	}

	const datos = await abrirFormularioCredito({
		titulo: "Relacionar producto",
		subtitulo: descripcion,
		campos: [{
			nombre: "productoId",
			etiqueta: "Producto en tu inventario",
			tipo: "select",
			requerido: true,
			opciones: candidatos.map(c => ({ valor: c.productoId, etiqueta: `${c.nombre} (${c.codigo || "sin código"})` }))
		}]
	});
	if (!datos) return;

	await riGuardarDecisionItem(itemId, { accion: "relacionar", productoId: Number(datos.productoId) });
}

async function riCrearProducto(itemId, nombreSugerido) {
	const item = recepcionInteligenteItemsActuales.find(it => it.id === itemId);
	const precios = riPreciosReferenciaCandidato(item?.candidato);
	const costo = item?.costo ?? 0;

	// Con candidato: un solo select con las 3 opciones (publico/medio
	// mayoreo/distribuidor) que tenga precio real -- nunca 3 campos
	// sueltos, para que no se vea amontonado. Medio mayoreo va
	// preseleccionado (regla de esta ferreteria), pero cualquiera de los
	// tres queda a un clic si ese producto puntual no la sigue.
	// Sin candidato: un numero simple, editable, prellenado con el costo.
	const campoPrecio = precios
		? {
			nombre: "precioVenta",
			etiqueta: "Precio de venta",
			tipo: "select",
			requerido: true,
			valor: precios.medioMayoreo ?? precios.publico ?? precios.distribuidor,
			opciones: [
				precios.publico != null ? { valor: precios.publico, etiqueta: `Público — $${precios.publico.toFixed(2)}` } : null,
				precios.medioMayoreo != null ? { valor: precios.medioMayoreo, etiqueta: `Medio mayoreo — $${precios.medioMayoreo.toFixed(2)}` } : null,
				precios.distribuidor != null ? { valor: precios.distribuidor, etiqueta: `Distribuidor — $${precios.distribuidor.toFixed(2)}` } : null
			].filter(Boolean)
		}
		: { nombre: "precioVenta", etiqueta: "Precio de venta", tipo: "number", requerido: true, valor: costo, min: 0 };

	const datos = await abrirFormularioCredito({
		titulo: "Crear producto",
		subtitulo: `Costo de esta factura: $${costo.toFixed(2)}`,
		campos: [
			{ nombre: "nombre", etiqueta: "Nombre del producto", valor: nombreSugerido, requerido: true },
			campoPrecio
		]
	});
	if (!datos) return;

	await riGuardarDecisionItem(itemId, { accion: "crear", nombreNuevoProducto: datos.nombre, precioVenta: Number(datos.precioVenta) });
}

async function riCambiarDecisionItem(itemId) {
	await riGuardarDecisionItem(itemId, { accion: "" });
}

async function riOmitirItem(itemId) {
	const confirmado = await confirmarPOS("Este producto no se agregará al inventario ni se contará en la recepción. ¿Continuar?", "Omitir");
	if (!confirmado) return;

	await riGuardarDecisionItem(itemId, { accion: "omitir" });
}

async function riGuardarDecisionItem(itemId, body) {
	if (!recepcionInteligenteActualId) return;

	const respuesta = await fetch(`/recepcion-inteligente/facturas/${recepcionInteligenteActualId}/items/${itemId}`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(body)
	});
	const datos = await respuesta.json().catch(() => ({}));

	if (!respuesta.ok || !datos.ok) {
		await alertaPOS(datos.error || "No se pudo guardar.", "Recepción Inteligente", "peligro");
		return;
	}

	await riVerDetalle(recepcionInteligenteActualId);
}

async function riRechazar(id) {
	const confirmado = await confirmarPOS("Esta factura se marcará como rechazada. No se creará ninguna recepción.", "Rechazar factura");
	if (!confirmado) return;

	const respuesta = await fetch(`/recepcion-inteligente/facturas/${id}/rechazar`, { method: "POST" });
	const datos = await respuesta.json().catch(() => ({}));

	if (!respuesta.ok || !datos.ok) {
		await alertaPOS(datos.error || "No se pudo rechazar.", "Recepción Inteligente", "peligro");
		return;
	}

	await riVerDetalle(id);
}

async function riConfirmar(id) {
	const confirmado = await confirmarPOS("Esto aplicará el stock y el costo de todos los productos ya revisados. ¿Confirmar la recepción?", "Confirmar recepción");
	if (!confirmado) return;

	const respuesta = await fetch(`/recepcion-inteligente/facturas/${id}/confirmar`, { method: "POST" });
	const datos = await respuesta.json().catch(() => ({}));

	if (!respuesta.ok || !datos.ok) {
		await alertaPOS(datos.error || "No se pudo confirmar. Revisa que todos los productos tengan una decisión.", "Recepción Inteligente", "peligro");
		return;
	}

	await alertaPOS(`Recepción confirmada. Se aplicó un total de $${datos.totalAplicado.toFixed(2)} a tu inventario.`, "Recepción confirmada", "exito");

	if (typeof cargarProductos === "function") cargarProductos();
	await riVerDetalle(id);
}
