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
let recepcionInteligenteRecepcionActual = null;
let recepcionInteligenteItemsActuales = [];
let recepcionInteligenteFacturasActuales = [];
let recepcionInteligenteFotosActuales = new Map();

// candidato.fuente (ver recepcion-inteligente-matching.js) distingue si
// Nexo encontro el parecido en TU inventario (solo hay que sumarle stock,
// va a "Relacionar") o en otro catalogo -- del proveedor, Catalogo
// Maestro o fabricante (Nexo ya conoce el nombre/precio de lista, pero
// el producto sigue sin existir en TU negocio, va a "Crear"). Antes
// "🟢 Identificado" no distinguia los dos casos y parecia que cualquier
// match fuerte ya estaba en inventario. Pedido real: poder ver de un
// vistazo cual concepto solo sube stock y cual hay que dar de alta.
function riEtiquetaSinDecidir(item) {
	if (!item.nivel) return "🟡 Sin identificar";

	const yaEnInventario = item.candidato?.fuente === "inventario";
	if (item.nivel === "fuerte") {
		return yaEnInventario ? "🟢 Ya en tu inventario" : "🔵 Reconocido, es nuevo";
	}
	return yaEnInventario ? "🟡 Revisar (posible ya existente)" : "🟡 Revisar (nuevo)";
}

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
					<input type="file" id="riArchivoRemisionFoto" accept="image/*" style="display:none" onchange="riSubirRemisionFotoSeleccionada(event)">
					<button type="button" class="btn-secundario" onclick="document.getElementById('riArchivoRemisionFoto').click()">📷 Subir remisión (foto)</button>
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

		if (accion === "revisar") riAbrirModalDecision(itemId);
		else if (accion === "ver-producto") riVerProductoModal(itemId);
	});

	await riCargarLista();
	await riCargarEstadoGmail();
	riEscucharRegresoDeGmail();
}

// "Conectar Gmail" abre el navegador normal del equipo en vez de esta
// misma ventana (ver riConectarGmail) -- la conexion se completa AHI,
// no aqui, asi que esta pantalla necesita enterarse sola cuando el
// dueno regresa a Nexo en vez de quedarse mostrando "no conectado".
// mainWindow.on("focus") en apps/desktop/main.js es esa señal. Se
// suscribe una sola vez por vida de la pagina (esta funcion se vuelve a
// llamar cada vez que se abre Recepcion Inteligente) para no apilar
// listeners duplicados que refresquen el estado varias veces de mas.
let riYaEscuchaRegresoDeGmail = false;
function riEscucharRegresoDeGmail() {
	if (riYaEscuchaRegresoDeGmail) return;
	if (!window.nexoDesktop || typeof window.nexoDesktop.onWindowFocused !== "function") return;

	riYaEscuchaRegresoDeGmail = true;
	window.nexoDesktop.onWindowFocused(() => { riCargarEstadoGmail(); });
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

	// En el POS de escritorio, la ventana principal NUNCA debe navegar a
	// un dominio externo: cualquier tropiezo de red durante los saltos de
	// redireccion de Google se veia como "la app se quedo sin internet" y
	// recargaba la ventana de vuelta a Nexo, tirando la conexion a medias
	// (bug real reportado por el dueno -- pantalla de "sin conexion" unos
	// segundos, la app regresaba sola a Recepcion Inteligente sin haber
	// conectado nada, y el siguiente intento le mostraba a Google un
	// generico "Error 401"). Se abre en el navegador normal del equipo,
	// igual que ya hace cualquier otro link externo de esta app; Recepcion
	// Inteligente se entera sola cuando el dueno regresa (riEscucharRegresoDeGmail).
	if (window.nexoDesktop && typeof window.nexoDesktop.openExternal === "function") {
		const resultado = await window.nexoDesktop.openExternal(datos.url);
		if (!resultado?.ok) {
			await alertaPOS("No se pudo abrir el navegador para conectar Gmail.", "Conectar Gmail", "peligro");
			return;
		}
		await alertaPOS("Completa la conexion en la ventana del navegador que se abrio, y regresa aqui.", "Conectar Gmail", "info");
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

// Fase 5: registrar una remision a partir de una foto -- para no frenar
// la mercancia mientras se espera el CFDI real (puede llegar dias
// despues). 1600px es de sobra para que la IA lea una tabla completa de
// renglones (el servidor la vuelve a comprimir de todos modos, ver
// extraerRemisionDeFoto) -- nunca se manda la foto original sin tocar.
async function riSubirRemisionFotoSeleccionada(event) {
	const archivo = event.target.files?.[0];
	event.target.value = "";
	if (!archivo) return;

	const aviso = document.getElementById("riSubiendoAviso");
	if (aviso) { aviso.textContent = "Leyendo remisión…"; aviso.style.display = "inline"; }

	try {
		const imagenBase64 = await redimensionarImagenCanvas(archivo, 1600);

		const respuesta = await fetch("/recepcion-inteligente/remision-foto", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ imagenBase64 })
		});
		const datos = await respuesta.json().catch(() => ({}));

		if (!respuesta.ok || !datos.ok) {
			await alertaPOS(datos.error || "No se pudo leer la remisión.", "Recepción Inteligente", "peligro");
			return;
		}

		if (!datos.disponible) {
			await alertaPOS("Nexo IA no esta disponible en tu plan por ahora.", "Sin IA", "alerta");
			return;
		}

		await alertaPOS(
			`Remisión leída${datos.proveedorDetectado ? ` de ${datos.proveedorDetectado}` : ""}: ${datos.totalConceptos} producto(s), ${datos.identificados} identificados automáticamente, ${datos.porRevisar} por revisar. Se aplicará a inventario como cualquier otra recepción, aunque todavía no llegue la factura.`,
			"Remisión detectada",
			"exito"
		);

		await riCargarLista();
		if (datos.recepcionId) await riVerDetalle(datos.recepcionId);
	} catch (error) {
		await alertaPOS("No se pudo leer el archivo. ¿Es una foto válida?", "Recepción Inteligente", "peligro");
	} finally {
		if (aviso) { aviso.style.display = "none"; aviso.textContent = "Leyendo factura…"; }
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
	recepcionInteligenteRecepcionActual = recepcion;
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
	const yaDecidido = item.accion === "relacionar" ? "Relacionado"
		: item.accion === "crear" ? "Producto nuevo"
		: item.accion === "omitir" ? "Omitido"
		: riEtiquetaSinDecidir(item);

	const puedeEditar = estadoRecepcion === "pendiente";
	// riPrecioSugerido (arriba) sale del precio de catalogo del candidato ya
	// identificado -- solo existe si hay match. item.precioSugerido lo manda
	// el servidor a partir del costo REAL de esta factura (con el tramo de
	// descuento de Fase 7 ya aplicado) mas el margen_general del proveedor --
	// util sobre todo cuando no hay candidato (producto nuevo), que es
	// justo cuando riPrecioSugerido no tiene nada que sugerir.
	//
	// Se muestra sin importar si el item ya tiene decision (antes se
	// apagaba al relacionar/crear): el dueño la quiere ver en toda la
	// factura de un vistazo, no solo mientras decide.
	const sugerido = riPrecioSugerido(item.candidato)
		|| (item.precioSugerido != null ? { valor: item.precioSugerido, etiqueta: "según margen" } : null);

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
			<td>${puedeEditar ? `<button type="button" class="btn-mini" data-ri-accion="revisar" data-item-id="${item.id}">${item.accion ? "Editar" : "Revisar"}</button>` : ""}</td>
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
			<div class="ri-modal-producto-foto" id="riModalProductoFoto">${fotoUrl ? `<img src="${fotoUrl}" alt="">` : `<span>📦</span>`}</div>
			<div class="ri-modal-producto-galeria" id="riModalProductoGaleria"></div>
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

	// Todas las fotos del producto, no solo la principal -- mismo criterio
	// que Ver detalles y Pantalla del cliente.
	if (codigoFoto && typeof explorarNexoResolverGaleria === "function") {
		explorarNexoResolverGaleria(codigoFoto).then(fotos => {
			if (modal.style.display === "none") return;

			const fotoPrincipal = document.getElementById("riModalProductoFoto");
			if (fotoPrincipal && !fotoUrl && fotos[0]) {
				fotoPrincipal.innerHTML = `<img src="${fotos[0]}" alt="">`;
			}

			const galeria = document.getElementById("riModalProductoGaleria");
			const extras = fotos.slice(1);
			if (!galeria || !extras.length) return;

			galeria.innerHTML = extras.map(url =>
				`<button type="button" class="ri-modal-producto-galeria-item" data-ri-foto="${escaparPOS(url)}"><img src="${url}" alt=""></button>`
			).join("");

			galeria.addEventListener("click", event => {
				const boton = event.target.closest("[data-ri-foto]");
				if (!boton) return;
				const principal = document.getElementById("riModalProductoFoto");
				if (principal) principal.innerHTML = `<img src="${boton.dataset.riFoto}" alt="">`;
			});
		});
	}
}

async function riOmitirItem(itemId) {
	const confirmado = await confirmarPOS("Este producto no se agregará al inventario ni se contará en la recepción. ¿Continuar?", "Omitir");
	if (!confirmado) return false;

	return riGuardarDecisionItem(itemId, { accion: "omitir" });
}

async function riGuardarDecisionItem(itemId, body) {
	if (!recepcionInteligenteActualId) return false;

	const respuesta = await fetch(`/recepcion-inteligente/facturas/${recepcionInteligenteActualId}/items/${itemId}`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(body)
	});
	const datos = await respuesta.json().catch(() => ({}));

	if (!respuesta.ok || !datos.ok) {
		await alertaPOS(datos.error || "No se pudo guardar.", "Recepción Inteligente", "peligro");
		return false;
	}

	await riVerDetalle(recepcionInteligenteActualId);
	return true;
}

async function riObtenerProducto(productoId) {
	const respuesta = await fetch(`/productos/${productoId}`);
	const datos = await respuesta.json().catch(() => null);
	return datos?.ok ? datos.producto : null;
}

const RI_UNIDADES_SUELTA = [
	{ valor: "", etiqueta: "No, solo el contenedor completo" },
	{ valor: "pieza", etiqueta: "Suelto por pieza" },
	{ valor: "kg", etiqueta: "Suelto por kilo" },
	{ valor: "gramo", etiqueta: "Suelto por gramo" },
	{ valor: "litro", etiqueta: "Suelto por litro" },
	{ valor: "metro", etiqueta: "Suelto por metro" }
];

// Estado del modal "Revisar concepto" mientras esta abierto -- controlado
// en JS (no se relee del DOM al guardar) para poder re-renderizar el
// modal completo en cada cambio (cambiar de pestaña, elegir un producto
// de la busqueda) sin perder lo que el usuario ya habia escrito.
let riDecision = null;

// Reemplaza los 3 botones sueltos (Relacionar/Crear/Omitir) y el boton
// "Cambiar" por un solo punto de entrada por concepto -- pedido real
// ("que a todos les salga este modal"): un modal mediano con las
// funciones de Agregar producto mejor acomodadas (precios de venta +
// venta suelta), en vez del formulario minimo de antes que ni dejaba
// ajustar el precio al relacionar con un producto ya existente.
async function riAbrirModalDecision(itemId) {
	const item = recepcionInteligenteItemsActuales.find(it => it.id === itemId);
	if (!item) return;

	// Pestaña inicial: "crear" si ya se habia decidido asi, o si el
	// candidato viene de otro catalogo (proveedor/Catalogo Maestro/
	// fabricante) -- ahi Nexo ya sabe el nombre, pero el producto sigue
	// sin existir en TU inventario. Sin esto, un concepto claramente
	// nuevo abria por default en "Ya lo tengo en inventario", obligando
	// a cambiar de pestaña a mano cada vez.
	const modoInicial = item.accion === "crear"
		|| (!item.accion && item.candidato && item.candidato.fuente !== "inventario")
		? "crear" : "relacionar";

	riDecision = {
		itemId,
		descripcion: item.descripcion,
		costo: item.costo,
		modo: modoInicial,
		productoSeleccionado: null,
		terminoBusqueda: item.descripcion,
		resultadosBusqueda: null,
		nombre: item.candidato?.nombre || item.descripcion,
		precioPublico: null,
		precioMedioMayoreo: null,
		unidadSuelta: "",
		precioPieza: ""
	};

	if (item.accion === "crear") {
		riDecision.nombre = item.nombreNuevoProducto || riDecision.nombre;
		riDecision.precioPublico = item.precioPublicoNuevoProducto ?? item.precioVentaNuevoProducto ?? null;
		riDecision.precioMedioMayoreo = item.precioMedioMayoreoNuevoProducto ?? item.precioVentaNuevoProducto ?? null;
		riDecision.unidadSuelta = item.unidadSueltaNuevoProducto || "";
		riDecision.precioPieza = item.precioPiezaNuevoProducto ?? "";
	} else {
		const sugerido = riPrecioSugerido(item.candidato) || (item.precioSugerido != null ? { valor: item.precioSugerido } : null);
		if (sugerido) {
			riDecision.precioPublico = sugerido.valor;
			riDecision.precioMedioMayoreo = sugerido.valor;
		}
	}

	// Producto a preseleccionar: el que ya se eligio ("Editar" sobre una
	// fila Relacionada), o el candidato que el motor de matching ya
	// encontro en TU inventario con buena confianza -- en ambos casos se
	// trae el producto real para prellenar sus precios actuales, nunca
	// los del candidato (pueden estar desactualizados).
	const productoAPreseleccionar = item.accion === "relacionar" ? item.productoId
		: (!item.accion && item.candidato?.fuente === "inventario" ? item.candidato.productoId : null);

	if (productoAPreseleccionar) {
		const producto = await riObtenerProducto(productoAPreseleccionar);
		if (producto) {
			riDecision.productoSeleccionado = producto;
			riDecision.precioPublico = item.precioPublicoActualizarProducto ?? numeroOrNull(producto.precio_publico) ?? riDecision.precioPublico;
			riDecision.precioMedioMayoreo = item.precioMedioMayoreoActualizarProducto ?? numeroOrNull(producto.precio_mayoreo) ?? riDecision.precioMedioMayoreo;
			riDecision.unidadSuelta = item.unidadSueltaActualizarProducto || (producto.permite_venta_pieza ? producto.unidad_suelta : "") || "";
			riDecision.precioPieza = item.precioPiezaActualizarProducto ?? (producto.permite_venta_pieza ? numeroOrNull(producto.precio_pieza) : "") ?? "";
		}
	} else if (riDecision.modo === "relacionar") {
		await riBuscarProductoDecision(riDecision.terminoBusqueda, false);
	}

	riRenderModalDecision();
}

function numeroOrNull(valor) {
	const numero = Number(valor);
	return Number.isFinite(numero) ? numero : null;
}

async function riBuscarProductoDecision(termino, renderizar = true) {
	riDecision.terminoBusqueda = termino;
	if (!termino || !termino.trim()) {
		riDecision.resultadosBusqueda = [];
	} else {
		const respuesta = await fetch(`/explorar-nexo/buscar?q=${encodeURIComponent(termino)}`);
		const resultado = await respuesta.json().catch(() => null);
		riDecision.resultadosBusqueda = resultado?.inventario || [];
	}
	if (renderizar) riRenderModalDecision();
}

function riRenderResultadosBusquedaDecision() {
	const resultados = riDecision.resultadosBusqueda;
	if (resultados == null) return "";
	if (!resultados.length) return `<p class="ri-modal-decision-sin-resultados">Sin resultados. Prueba con otro nombre, o usa "Es un producto nuevo".</p>`;

	return `<div class="ri-modal-decision-resultados">
		${resultados.map(r => `
			<button type="button" class="ri-modal-decision-resultado" data-producto-id="${r.productoId}">
				<strong>${escaparPOS(r.nombre)}</strong>
				<span>${escaparPOS(r.codigo || "sin código")}${r.precio != null ? " · $" + Number(r.precio).toFixed(2) : ""}</span>
			</button>
		`).join("")}
	</div>`;
}

function riRenderModalDecision() {
	let modal = document.getElementById("riModalDecision");
	if (!modal) {
		modal = document.createElement("div");
		modal.id = "riModalDecision";
		modal.className = "ri-modal-producto";
		document.body.appendChild(modal);
	}

	const d = riDecision;
	const esRelacionar = d.modo === "relacionar";
	const mostrarPrecios = !esRelacionar || d.productoSeleccionado;

	modal.innerHTML = `
		<div class="ri-modal-decision-card">
			<button type="button" class="ri-modal-producto-cerrar" id="riDecisionCerrar" aria-label="Cerrar">✕</button>
			<h3>Revisar concepto</h3>
			<p class="ri-modal-decision-subtitulo">${escaparPOS(d.descripcion)} · Costo de esta factura: $${d.costo.toFixed(2)}</p>

			<div class="ri-modal-decision-tabs">
				<button type="button" class="${esRelacionar ? "activo" : ""}" id="riDecisionTabRelacionar">Ya lo tengo en inventario</button>
				<button type="button" class="${!esRelacionar ? "activo" : ""}" id="riDecisionTabCrear">Es un producto nuevo</button>
			</div>

			${esRelacionar ? `
				<div class="ri-modal-decision-seccion">
					<label>Buscar en tu inventario
						<input type="search" id="riDecisionBuscador" placeholder="Nombre del producto..." value="${escaparPOS(d.terminoBusqueda || "")}">
					</label>
					<button type="button" class="btn-mini" id="riDecisionBuscarBtn">Buscar</button>
					${d.productoSeleccionado ? `
						<div class="ri-modal-decision-seleccionado">
							Vinculando con <strong>${escaparPOS(d.productoSeleccionado.nombre)}</strong> (${escaparPOS(d.productoSeleccionado.codigo || "sin código")})
							<button type="button" class="btn-mini" id="riDecisionQuitarSeleccion">Elegir otro</button>
						</div>
					` : riRenderResultadosBusquedaDecision()}
				</div>
			` : `
				<div class="ri-modal-decision-seccion">
					<label>Nombre del producto
						<input type="text" id="riDecisionNombre" value="${escaparPOS(d.nombre || "")}">
					</label>
				</div>
			`}

			${mostrarPrecios ? `
				<div class="ri-modal-decision-precios">
					<h4>Precios de venta</h4>
					<div class="ri-modal-decision-precios-grid">
						<label>Público
							<input type="number" step="0.01" min="0" id="riDecisionPrecioPublico" value="${d.precioPublico ?? ""}">
						</label>
						<label>Medio mayoreo
							<input type="number" step="0.01" min="0" id="riDecisionPrecioMedioMayoreo" value="${d.precioMedioMayoreo ?? ""}">
						</label>
					</div>

					<label class="ri-modal-decision-suelta-toggle">
						<input type="checkbox" id="riDecisionVentaSuelta" ${d.unidadSuelta ? "checked" : ""}>
						¿También se vende suelto? (ej. tornillos por pieza)
					</label>
					<div class="ri-modal-decision-suelta-campos" id="riDecisionSueltaCampos" style="${d.unidadSuelta ? "" : "display:none"}">
						<label>Se vende suelto por
							<select id="riDecisionUnidadSuelta">
								${RI_UNIDADES_SUELTA.filter(o => o.valor).map(o => `<option value="${o.valor}" ${d.unidadSuelta === o.valor ? "selected" : ""}>${o.etiqueta}</option>`).join("")}
							</select>
						</label>
						<label>Precio de venta suelta
							<input type="number" step="0.01" min="0" id="riDecisionPrecioPieza" value="${d.precioPieza ?? ""}">
						</label>
					</div>
				</div>
			` : ""}

			<div class="ri-modal-decision-acciones">
				<button type="button" class="ri-modal-decision-omitir" id="riDecisionOmitir">Omitir este producto</button>
				<div>
					<button type="button" class="btn-secundario" id="riDecisionCancelar">Cancelar</button>
					<button type="button" class="btn-agregar" id="riDecisionGuardar">Guardar</button>
				</div>
			</div>
		</div>
	`;

	modal.style.display = "flex";
	riWireModalDecisionEventos();
}

function riCerrarModalDecision() {
	const modal = document.getElementById("riModalDecision");
	if (modal) modal.style.display = "none";
	riDecision = null;
}

function riWireModalDecisionEventos() {
	const d = riDecision;

	document.getElementById("riDecisionCerrar").onclick = riCerrarModalDecision;
	document.getElementById("riDecisionCancelar").onclick = riCerrarModalDecision;

	const tabRelacionar = document.getElementById("riDecisionTabRelacionar");
	const tabCrear = document.getElementById("riDecisionTabCrear");
	if (tabRelacionar) tabRelacionar.onclick = () => { d.modo = "relacionar"; riRenderModalDecision(); };
	if (tabCrear) tabCrear.onclick = () => { d.modo = "crear"; riRenderModalDecision(); };

	const buscador = document.getElementById("riDecisionBuscador");
	const buscarBtn = document.getElementById("riDecisionBuscarBtn");
	if (buscarBtn) buscarBtn.onclick = () => riBuscarProductoDecision(buscador.value);
	if (buscador) buscador.onkeydown = event => {
		if (event.key === "Enter") { event.preventDefault(); riBuscarProductoDecision(buscador.value); }
	};

	const quitarSeleccion = document.getElementById("riDecisionQuitarSeleccion");
	if (quitarSeleccion) quitarSeleccion.onclick = () => { d.productoSeleccionado = null; riRenderModalDecision(); };

	const resultadosContenedor = document.querySelector("#riModalDecision .ri-modal-decision-resultados");
	if (resultadosContenedor) resultadosContenedor.addEventListener("click", async event => {
		const fila = event.target.closest("[data-producto-id]");
		if (!fila) return;
		const producto = await riObtenerProducto(Number(fila.dataset.productoId));
		if (!producto) return;
		d.productoSeleccionado = producto;
		d.precioPublico = numeroOrNull(producto.precio_publico) ?? d.precioPublico;
		d.precioMedioMayoreo = numeroOrNull(producto.precio_mayoreo) ?? d.precioMedioMayoreo;
		d.unidadSuelta = producto.permite_venta_pieza ? (producto.unidad_suelta || "pieza") : "";
		d.precioPieza = producto.permite_venta_pieza ? (numeroOrNull(producto.precio_pieza) ?? "") : "";
		riRenderModalDecision();
	});

	const nombreInput = document.getElementById("riDecisionNombre");
	if (nombreInput) nombreInput.oninput = () => { d.nombre = nombreInput.value; };

	const precioPublicoInput = document.getElementById("riDecisionPrecioPublico");
	if (precioPublicoInput) precioPublicoInput.oninput = () => { d.precioPublico = precioPublicoInput.value; };

	const precioMedioMayoreoInput = document.getElementById("riDecisionPrecioMedioMayoreo");
	if (precioMedioMayoreoInput) precioMedioMayoreoInput.oninput = () => { d.precioMedioMayoreo = precioMedioMayoreoInput.value; };

	const ventaSueltaCheck = document.getElementById("riDecisionVentaSuelta");
	if (ventaSueltaCheck) ventaSueltaCheck.onchange = () => {
		d.unidadSuelta = ventaSueltaCheck.checked ? (d.unidadSuelta || "pieza") : "";
		riRenderModalDecision();
	};

	const unidadSueltaSelect = document.getElementById("riDecisionUnidadSuelta");
	if (unidadSueltaSelect) unidadSueltaSelect.onchange = () => { d.unidadSuelta = unidadSueltaSelect.value; };

	const precioPiezaInput = document.getElementById("riDecisionPrecioPieza");
	if (precioPiezaInput) precioPiezaInput.oninput = () => { d.precioPieza = precioPiezaInput.value; };

	document.getElementById("riDecisionOmitir").onclick = async () => {
		if (await riOmitirItem(d.itemId)) riCerrarModalDecision();
	};

	document.getElementById("riDecisionGuardar").onclick = riGuardarModalDecision;
}

async function riGuardarModalDecision() {
	const d = riDecision;
	const precioPublicoNum = d.precioPublico !== "" && d.precioPublico != null ? Number(d.precioPublico) : null;
	const precioMedioMayoreoNum = d.precioMedioMayoreo !== "" && d.precioMedioMayoreo != null ? Number(d.precioMedioMayoreo) : null;
	const precioPiezaNum = d.unidadSuelta && d.precioPieza !== "" && d.precioPieza != null ? Number(d.precioPieza) : null;

	let guardado;
	if (d.modo === "relacionar") {
		if (!d.productoSeleccionado) {
			await alertaPOS("Busca y elige a cuál producto de tu inventario corresponde.", "Falta el producto", "info");
			return;
		}
		guardado = await riGuardarDecisionItem(d.itemId, {
			accion: "relacionar",
			productoId: d.productoSeleccionado.id,
			precioPublico: precioPublicoNum,
			precioMedioMayoreo: precioMedioMayoreoNum,
			unidadSuelta: d.unidadSuelta || null,
			precioPieza: precioPiezaNum
		});
	} else {
		if (!d.nombre || !d.nombre.trim()) {
			await alertaPOS("Escribe el nombre del producto.", "Falta el nombre", "info");
			return;
		}
		if (precioPublicoNum == null && precioMedioMayoreoNum == null) {
			await alertaPOS("Indica al menos un precio de venta.", "Falta el precio", "info");
			return;
		}
		guardado = await riGuardarDecisionItem(d.itemId, {
			accion: "crear",
			nombreNuevoProducto: d.nombre.trim(),
			precioPublico: precioPublicoNum,
			precioMedioMayoreo: precioMedioMayoreoNum,
			precioVenta: precioMedioMayoreoNum ?? precioPublicoNum,
			unidadSuelta: d.unidadSuelta || null,
			precioPieza: precioPiezaNum
		});
	}

	if (guardado) riCerrarModalDecision();
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

// Fase 5: antes de confirmar una factura real, se pregunta primero si hay
// una remision de este mismo proveedor que ya recibio stock y sigue
// esperando su factura -- si existe, se muestra la comparacion (modal de
// conciliacion) en vez de ir derecho a confirmar, para que el dueño decida
// si es la misma compra (evita duplicar el stock) o una compra distinta.
async function riConfirmar(id) {
	const respuesta = await fetch(`/recepcion-inteligente/facturas/${id}/posible-conciliacion`);
	const datos = await respuesta.json().catch(() => ({}));

	if (respuesta.ok && datos.ok && datos.remisionPendiente) {
		riModalConciliacion(id, datos.remisionPendiente);
		return;
	}

	await riConfirmarDefinitivo(id, {});
}

async function riConfirmarDefinitivo(id, extra) {
	const confirmado = await confirmarPOS("Esto aplicará el stock y el costo de todos los productos ya revisados. ¿Confirmar la recepción?", "Confirmar recepción");
	if (!confirmado) return;

	const respuesta = await fetch(`/recepcion-inteligente/facturas/${id}/confirmar`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(extra || {})
	});
	const datos = await respuesta.json().catch(() => ({}));

	if (!respuesta.ok || !datos.ok) {
		// Carrera rara pero posible: una remision aparecio entre el GET de
		// arriba y este POST. En vez del mensaje generico (que aqui seria
		// enganoso -- los conceptos si estan revisados), se muestra la
		// misma comparacion que se hubiera visto si hubiera llegado a
		// tiempo.
		if (datos.requiereConciliacion && datos.remisionPendiente) {
			riModalConciliacion(id, datos.remisionPendiente);
			return;
		}

		await alertaPOS(datos.error || "No se pudo confirmar. Revisa que todos los productos tengan una decisión.", "Recepción Inteligente", "peligro");
		return;
	}

	await alertaPOS(`Recepción confirmada. Se aplicó un total de $${datos.totalAplicado.toFixed(2)} a tu inventario.`, "Recepción confirmada", "exito");

	if (typeof cargarProductos === "function") cargarProductos();
	await riVerDetalle(id);
}

// Comparacion lado a lado: la remision que ya entro a inventario (columna
// izquierda) contra esta factura que se esta por confirmar (columna
// derecha). Nunca decide sola cual es "la correcta" -- solo dos botones
// que mandan exactamente lo que el dueño elija al mismo endpoint de
// siempre (conciliarConRecepcionMercanciaId o ignorarConciliacion).
function riModalConciliacion(id, remisionPendiente) {
	let modal = document.getElementById("riModalConciliacion");
	if (!modal) {
		modal = document.createElement("div");
		modal.id = "riModalConciliacion";
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

	const itemsFactura = recepcionInteligenteItemsActuales;
	const totalFactura = recepcionInteligenteRecepcionActual?.total ?? itemsFactura.reduce((suma, it) => suma + it.importe, 0);

	const filasTabla = (items, esFactura) => items.map(it => `
		<tr>
			<td>${escaparPOS(esFactura ? it.descripcion : it.nombre)}${it.codigo ? `<small>${escaparPOS(it.codigo)}</small>` : ""}</td>
			<td>${it.cantidad}</td>
			<td>$${Number(it.costo).toFixed(2)}</td>
		</tr>
	`).join("");

	modal.innerHTML = `
		<div class="ri-modal-producto-card ri-modal-conciliacion-card">
			<button type="button" class="ri-modal-producto-cerrar" aria-label="Cerrar">✕</button>
			<h3>¿Esta factura es la misma compra que ya recibiste?</h3>
			<p class="ri-modal-producto-marca">Encontramos una remisión de este proveedor que ya sumó su stock y sigue esperando su factura. Si es la misma compra, confirma esta factura como su conciliación para no duplicar el stock.</p>
			<div class="ri-conciliacion-comparacion">
				<div class="ri-conciliacion-columna">
					<h4>Remisión ya recibida${remisionPendiente.referencia ? ` — ${escaparPOS(remisionPendiente.referencia)}` : ""}</h4>
					<p class="ri-conciliacion-total">Total: $${remisionPendiente.total.toFixed(2)}</p>
					<table class="ri-conciliacion-tabla"><tbody>${filasTabla(remisionPendiente.items, false)}</tbody></table>
					${remisionPendiente.otrasPendientes ? `<p class="ri-modal-producto-sin-precio">Hay ${remisionPendiente.otrasPendientes} remisión(es) más de este proveedor pendientes de conciliar.</p>` : ""}
				</div>
				<div class="ri-conciliacion-columna">
					<h4>Esta factura${recepcionInteligenteRecepcionActual?.folio ? ` — Folio ${escaparPOS(recepcionInteligenteRecepcionActual.folio)}` : ""}</h4>
					<p class="ri-conciliacion-total">Total: $${totalFactura.toFixed(2)}</p>
					<table class="ri-conciliacion-tabla"><tbody>${filasTabla(itemsFactura, true)}</tbody></table>
				</div>
			</div>
			<div class="ri-acciones-footer">
				<button type="button" class="btn-secundario" data-ri-accion="distinta">No, es una compra distinta</button>
				<button type="button" class="btn-agregar" data-ri-accion="misma">Sí, es la misma compra</button>
			</div>
		</div>
	`;

	modal.style.display = "flex";
	modal.onclick = event => { if (event.target === modal) cerrar(); };
	modal.querySelector(".ri-modal-producto-cerrar").onclick = cerrar;
	modal.querySelector("[data-ri-accion='misma']").onclick = () => {
		cerrar();
		riConfirmarDefinitivo(id, { conciliarConRecepcionMercanciaId: remisionPendiente.recepcionMercanciaId });
	};
	modal.querySelector("[data-ri-accion='distinta']").onclick = () => {
		cerrar();
		riConfirmarDefinitivo(id, { ignorarConciliacion: true });
	};

	document.addEventListener("keydown", manejarTeclado, true);
}
