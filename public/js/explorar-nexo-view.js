// Explorar Nexo (Fase 1, paso 5): pantalla de busqueda por intencion.
// Consume GET /explorar-nexo/buscar (explorar-nexo-server.js) -- todo
// el trabajo de comparar texto contra las 4 fuentes ya vive en el
// servidor; aqui solo se agrupa, se pinta, y se conectan las acciones
// que ya existen (agregarDesdeFlyoutPOS, verDetalleProducto). Sin IA
// todavia -- eso es la fase siguiente del diseno aprobado.

let explorarNexoUltimoResultado = null;
let explorarNexoFiltroActivo = "todos";
let explorarNexoSeleccionActual = null;
let explorarNexoDebounce = null;

const EXPLORAR_NEXO_ETIQUETA_NIVEL = {
	fuerte: "Coincidencia fuerte",
	probable: "Coincidencia probable",
	relacionado: "Producto relacionado"
};

function explorarNexoBadgeNivel(nivel) {
	const clase = nivel || "relacionado";
	const texto = EXPLORAR_NEXO_ETIQUETA_NIVEL[clase] || "Producto relacionado";
	return `<span class="explorar-nexo-nivel ${clase}">${texto}</span>`;
}

async function mostrarExplorarNexo(textoInicial) {
	if (typeof ocultarPantallasPrincipales === "function") {
		ocultarPantallasPrincipales();
	}

	const pantalla = document.getElementById("pantallaExplorarNexo");
	if (!pantalla) return;

	pantalla.style.display = "block";

	if (typeof actualizarTopbarContexto === "function") {
		actualizarTopbarContexto("Explorar Nexo", "Encuentra productos en tu inventario, en el catalogo de Nexo y en tus proveedores.", "explorar-nexo");
	}

	explorarNexoUltimoResultado = null;
	explorarNexoFiltroActivo = "todos";
	explorarNexoSeleccionActual = null;

	pantalla.innerHTML = `
		<div class="encargos-shell">
			<div class="encargos-header">
				<h2>Explorar Nexo</h2>
				<p>Encuentra productos en tu inventario, en el catalogo de Nexo y en tus proveedores.</p>
			</div>

			<div class="explorar-nexo-buscador-fila">
				<div class="buscador-con-limpiar">
					<input id="explorarNexoInput" type="text" placeholder="Ej. pinza para cortar cable grueso"
						oninput="explorarNexoOnInput()"
						onkeydown="if(event.key==='Enter'){event.preventDefault();buscarExplorarNexo();}">
				</div>
				<button type="button" class="btn-agregar" onclick="buscarExplorarNexo()">Buscar</button>
			</div>

			<div class="explorar-nexo-chips" id="explorarNexoChips"></div>

			<div class="explorar-nexo-grid">
				<div class="explorar-nexo-resultados" id="explorarNexoResultados">
					<p class="explorar-nexo-vacio">Escribe que producto buscas para empezar -- por ejemplo, "pinza para cortar cable grueso".</p>
				</div>
				<div class="encargos-panel explorar-nexo-ficha" id="explorarNexoFicha">
					<p class="explorar-nexo-ficha-vacio">Selecciona un resultado para ver los detalles.</p>
				</div>
			</div>
		</div>
	`;

	const campo = document.getElementById("explorarNexoInput");
	if (textoInicial && campo) {
		campo.value = textoInicial;
		buscarExplorarNexo();
	} else {
		campo?.focus();
	}
}

// Puente desde el buscador del Punto de Venta (§principio del diseno
// aprobado): ese buscador solo mira el inventario propio a proposito
// -- cuando no encuentra nada, este es el camino a las otras 3
// fuentes, conservando exactamente lo que el empleado ya escribio.
function buscarEnExplorarNexoDesdePOS() {
	const texto = document.getElementById("busqueda")?.value || "";

	if (typeof ocultarFlyoutBusquedaPOS === "function") ocultarFlyoutBusquedaPOS();

	mostrarExplorarNexo(texto);
}

function explorarNexoOnInput() {
	clearTimeout(explorarNexoDebounce);
	explorarNexoDebounce = setTimeout(() => buscarExplorarNexo(), 350);
}

async function buscarExplorarNexo() {
	const texto = document.getElementById("explorarNexoInput")?.value || "";
	const contenedor = document.getElementById("explorarNexoResultados");
	if (!contenedor) return;

	if (!texto.trim()) {
		explorarNexoUltimoResultado = null;
		contenedor.innerHTML = `<p class="explorar-nexo-vacio">Escribe que producto buscas para empezar -- por ejemplo, "pinza para cortar cable grueso".</p>`;
		document.getElementById("explorarNexoChips").innerHTML = "";
		return;
	}

	contenedor.innerHTML = `<p class="explorar-nexo-vacio">Buscando...</p>`;

	try {
		const respuesta = await fetch(`/explorar-nexo/buscar?q=${encodeURIComponent(texto)}`);
		const datos = await respuesta.json();

		if (!respuesta.ok || !datos.ok) {
			contenedor.innerHTML = `<p class="explorar-nexo-vacio">No se pudo buscar. Intenta de nuevo.</p>`;
			return;
		}

		// Catalogo Maestro y catalogo de fabricante se presentan como una
		// sola seccion "Catalogo Nexo" (mismo criterio del diseno
		// aprobado): si el mismo codigo aparece en ambos, se prefiere la
		// fila del Maestro (ya trae la identidad verificada + el precio
		// de fabricante enlazado), y el fabricante solo rellena huecos.
		const catalogoNexoPorCodigo = new Map();
		datos.catalogoMaestro.forEach(item => catalogoNexoPorCodigo.set(item.codigo, item));
		datos.fabricante.forEach(item => {
			if (!catalogoNexoPorCodigo.has(item.codigo)) catalogoNexoPorCodigo.set(item.codigo, item);
		});
		const catalogoNexo = Array.from(catalogoNexoPorCodigo.values()).sort((a, b) => b.similitud - a.similitud);

		explorarNexoUltimoResultado = {
			termino: datos.termino,
			inventario: datos.inventario,
			catalogoNexo,
			proveedor: datos.proveedor
		};
		explorarNexoSeleccionActual = null;

		explorarNexoRenderChips();
		explorarNexoRenderResultados();
		document.getElementById("explorarNexoFicha").innerHTML = `<p class="explorar-nexo-ficha-vacio">Selecciona un resultado para ver los detalles.</p>`;
	} catch (error) {
		contenedor.innerHTML = `<p class="explorar-nexo-vacio">Error de conexion, intenta de nuevo.</p>`;
	}
}

function explorarNexoRenderChips() {
	const contenedor = document.getElementById("explorarNexoChips");
	if (!contenedor || !explorarNexoUltimoResultado) return;

	const r = explorarNexoUltimoResultado;
	const total = r.inventario.length + r.catalogoNexo.length + r.proveedor.length;

	const chips = [
		{ id: "todos", etiqueta: "Todos", cuenta: total },
		{ id: "inventario", etiqueta: "En mi inventario", cuenta: r.inventario.length },
		{ id: "catalogo_nexo", etiqueta: "Catalogo Nexo", cuenta: r.catalogoNexo.length },
		{ id: "proveedor", etiqueta: "Con proveedores", cuenta: r.proveedor.length }
	];

	contenedor.innerHTML = chips.map(chip => `
		<button type="button" class="explorar-nexo-chip ${chip.id === explorarNexoFiltroActivo ? "activo" : ""}" onclick="explorarNexoCambiarFiltro('${chip.id}')">
			${escaparPOS(chip.etiqueta)} (${chip.cuenta})
		</button>
	`).join("");
}

function explorarNexoCambiarFiltro(filtro) {
	explorarNexoFiltroActivo = filtro;
	explorarNexoRenderChips();
	explorarNexoRenderResultados();
}

function explorarNexoGrupoHtml(titulo, icono, items, fuente) {
	if (!items.length) return "";

	return `
		<div>
			<h4 class="explorar-nexo-grupo-titulo">${icono} ${escaparPOS(titulo)} <span class="cuenta">(${items.length})</span></h4>
			<div class="explorar-nexo-grupo-lista">
				${items.map((item, indice) => explorarNexoTarjetaHtml(item, fuente, indice)).join("")}
			</div>
		</div>
	`;
}

function explorarNexoTarjetaHtml(item, fuente, indice) {
	const precio = fuente === "inventario" ? item.precio
		: fuente === "proveedor" ? item.precioPublico
		: item.precioListaPublico;
	const marcaOTexto = item.marca || item.fabricante || item.proveedor || "";
	const seleccionada = explorarNexoSeleccionActual && explorarNexoSeleccionActual.fuente === fuente && explorarNexoSeleccionActual.indice === indice;

	return `
		<button type="button" class="explorar-nexo-tarjeta ${seleccionada ? "seleccionada" : ""}" onclick="explorarNexoVerFicha('${fuente}', ${indice})">
			<span class="explorar-nexo-tarjeta-icono" id="explorarNexoIcono-${fuente}-${indice}" data-codigo="${escaparPOS(item.codigo || "")}">${fuente === "inventario" ? "\u{1F3EA}" : fuente === "proveedor" ? "\u{1F69A}" : "\u{1F310}"}</span>
			<span class="explorar-nexo-tarjeta-info">
				<span class="explorar-nexo-tarjeta-nombre">${escaparPOS(item.nombre)}</span>
				<span class="explorar-nexo-tarjeta-meta">${escaparPOS(marcaOTexto)}${item.codigo ? " &middot; " + escaparPOS(item.codigo) : ""}</span>
			</span>
			${precio != null ? `<span class="explorar-nexo-tarjeta-precio">${dinero(precio)}</span>` : ""}
			${explorarNexoBadgeNivel(item.nivel)}
		</button>
	`;
}

// Cache en memoria (codigo -> url o null) para no volver a preguntar
// por la misma foto dos veces en la misma sesion -- varias tarjetas
// (proveedor + Catalogo Nexo) suelen compartir el mismo codigo real.
const explorarNexoFotoCache = new Map();

async function explorarNexoResolverFoto(codigo) {
	if (explorarNexoFotoCache.has(codigo)) return explorarNexoFotoCache.get(codigo);

	try {
		const respuesta = await fetch(`/explorar-nexo/foto/${encodeURIComponent(codigo)}`);
		const datos = await respuesta.json();
		const url = respuesta.ok && datos.ok ? (datos.url || null) : null;
		explorarNexoFotoCache.set(codigo, url);
		return url;
	} catch (error) {
		return null;
	}
}

// Se llama despues de pintar resultados (lista) o la ficha -- busca
// cada codigo visible una sola vez (Set) y solo reemplaza el icono
// generico por la foto real si de verdad hay una. Nunca bloquea el
// render: los iconos aparecen de inmediato, las fotos van llegando.
function explorarNexoCargarFotosVisibles(contenedor) {
	if (!contenedor) return;

	const elementos = contenedor.querySelectorAll("[data-codigo]");
	const codigos = new Set();
	elementos.forEach(el => { if (el.dataset.codigo) codigos.add(el.dataset.codigo); });

	codigos.forEach(codigo => {
		explorarNexoResolverFoto(codigo).then(url => {
			if (!url) return;
			contenedor.querySelectorAll(`[data-codigo="${CSS.escape(codigo)}"]`).forEach(el => {
				if (el.querySelector("img")) return;

				// Solo se quita el placeholder (el texto/emoji suelto) --
				// nunca innerHTML completo, porque la ficha mete ademas un
				// boton "Proyectar" dentro de este mismo contenedor y eso
				// lo borraria de un jalon.
				el.childNodes.forEach(nodo => {
					if (nodo.nodeType === Node.TEXT_NODE) nodo.remove();
				});

				const img = document.createElement("img");
				img.src = url;
				img.alt = "";
				img.loading = "lazy";
				el.insertBefore(img, el.firstChild);
			});
		});
	});
}

function explorarNexoRenderResultados() {
	const contenedor = document.getElementById("explorarNexoResultados");
	if (!contenedor || !explorarNexoUltimoResultado) return;

	const r = explorarNexoUltimoResultado;
	const mostrarInventario = explorarNexoFiltroActivo === "todos" || explorarNexoFiltroActivo === "inventario";
	const mostrarCatalogoNexo = explorarNexoFiltroActivo === "todos" || explorarNexoFiltroActivo === "catalogo_nexo";
	const mostrarProveedor = explorarNexoFiltroActivo === "todos" || explorarNexoFiltroActivo === "proveedor";

	const bloques = [
		mostrarInventario ? explorarNexoGrupoHtml("En tu inventario", "\u{1F3EA}", r.inventario, "inventario") : "",
		mostrarCatalogoNexo ? explorarNexoGrupoHtml("En Catalogo Nexo", "\u{1F310}", r.catalogoNexo, "catalogo_nexo") : "",
		mostrarProveedor ? explorarNexoGrupoHtml("Con proveedores", "\u{1F69A}", r.proveedor, "proveedor") : ""
	].filter(Boolean);

	contenedor.innerHTML = bloques.length
		? bloques.join("")
		: `
			<p class="explorar-nexo-vacio">No encontramos una coincidencia con "${escaparPOS(r.termino)}". Prueba con otras palabras.</p>
			<button type="button" class="btn-agregar" style="margin:0 auto;display:block;" onclick="explorarNexoCrearEncargoSinResultado()">Crear encargo con este nombre</button>
		`;

	explorarNexoCargarFotosVisibles(contenedor);
}

function explorarNexoObtenerItem(fuente, indice) {
	if (!explorarNexoUltimoResultado) return null;
	if (fuente === "inventario") return explorarNexoUltimoResultado.inventario[indice];
	if (fuente === "catalogo_nexo") return explorarNexoUltimoResultado.catalogoNexo[indice];
	if (fuente === "proveedor") return explorarNexoUltimoResultado.proveedor[indice];
	return null;
}

function explorarNexoVerFicha(fuente, indice) {
	const item = explorarNexoObtenerItem(fuente, indice);
	if (!item) return;

	explorarNexoSeleccionActual = { fuente, indice };
	explorarNexoRenderResultados();

	const ficha = document.getElementById("explorarNexoFicha");
	if (!ficha) return;

	const etiquetaFuente = fuente === "inventario" ? "En tu inventario"
		: fuente === "proveedor" ? `Proveedor${item.proveedor ? ": " + item.proveedor : ""}`
		: `Catalogo Nexo${item.fabricante ? " (" + item.fabricante + ")" : ""}`;

	let datosHtml = `<dt>Marca</dt><dd>${escaparPOS(item.marca || "-")}</dd>`;
	if (item.codigo) datosHtml += `<dt>Codigo</dt><dd>${escaparPOS(item.codigo)}</dd>`;
	if (item.ean) datosHtml += `<dt>EAN</dt><dd>${escaparPOS(item.ean)}</dd>`;
	if (fuente === "inventario") {
		datosHtml += `<dt>Categoria</dt><dd>${escaparPOS(item.categoria || "-")}</dd>`;
		datosHtml += `<dt>Existencia</dt><dd>${item.stock != null ? item.stock : "-"}</dd>`;
	}
	if (item.descripcion) datosHtml += `<dt>Descripcion</dt><dd>${escaparPOS(item.descripcion)}</dd>`;

	let preciosHtml = "";
	if (fuente === "inventario" && item.precio != null) {
		preciosHtml = `
			<div class="explorar-nexo-ficha-precios">
				<div class="explorar-nexo-ficha-precio-caja"><span>Tu precio</span><strong>${dinero(item.precio)}</strong></div>
			</div>
		`;
	} else if (fuente === "proveedor") {
		preciosHtml = `
			<div class="explorar-nexo-ficha-precios">
				${item.precioDistribuidor != null ? `<div class="explorar-nexo-ficha-precio-caja"><span>Distribuidor</span><strong>${dinero(item.precioDistribuidor)}</strong></div>` : ""}
				${item.precioMedioMayoreo != null ? `<div class="explorar-nexo-ficha-precio-caja"><span>Medio mayoreo</span><strong>${dinero(item.precioMedioMayoreo)}</strong></div>` : ""}
				${item.precioPublico != null ? `<div class="explorar-nexo-ficha-precio-caja"><span>Publico</span><strong>${dinero(item.precioPublico)}</strong></div>` : ""}
			</div>
		`;
	} else if (fuente === "catalogo_nexo" && (item.precioListaPublico != null || item.precioListaDistribuidor != null || item.precioListaMayoreo != null || item.precioListaMedioMayoreo != null)) {
		preciosHtml = `
			<p class="explorar-nexo-ficha-nota" style="margin-top:0;">Precio de lista del fabricante -- no es lo que tu cobras, es una referencia.</p>
			<div class="explorar-nexo-ficha-precios">
				${item.precioListaMayoreo != null ? `<div class="explorar-nexo-ficha-precio-caja"><span>Mayoreo</span><strong>${dinero(item.precioListaMayoreo)}</strong></div>` : ""}
				${item.precioListaMedioMayoreo != null ? `<div class="explorar-nexo-ficha-precio-caja"><span>Medio mayoreo</span><strong>${dinero(item.precioListaMedioMayoreo)}</strong></div>` : ""}
				${item.precioListaPublico != null ? `<div class="explorar-nexo-ficha-precio-caja"><span>Publico</span><strong>${dinero(item.precioListaPublico)}</strong></div>` : ""}
				${item.precioListaDistribuidor != null ? `<div class="explorar-nexo-ficha-precio-caja"><span>Distribuidor</span><strong>${dinero(item.precioListaDistribuidor)}</strong></div>` : ""}
			</div>
		`;
	}

	let accionesHtml = "";
	if (fuente === "inventario") {
		accionesHtml = `
			<button type="button" class="btn-agregar" onclick="explorarNexoVerProductoInventario(${item.productoId})">Ver producto</button>
			<button type="button" class="btn-agregar btn-nuevo-credito" onclick="explorarNexoAgregarAVenta(${item.productoId})">Agregar a venta</button>
		`;
	} else {
		accionesHtml = `
			<p class="explorar-nexo-ficha-nota" style="margin-top:0;">Este producto todavia no esta en tu inventario.</p>
			<button type="button" class="btn-agregar" onclick="explorarNexoPedirAlProveedor('${fuente}', ${indice})">Pedir al proveedor</button>
			<button type="button" class="btn-agregar btn-nuevo-credito" onclick="explorarNexoCrearEncargo('${fuente}', ${indice})">Crear encargo para cliente</button>
		`;
	}

	ficha.innerHTML = `
		<div class="explorar-nexo-ficha-foto" id="explorarNexoFichaFoto" data-codigo="${escaparPOS(item.codigo || "")}">
			\u{1F4E6}
			<button type="button" class="explorar-nexo-foto-proyectar" onclick="pantallaClienteAbrirProyeccion(); event.stopPropagation();" title="Proyectar a otra pantalla">📽️</button>
		</div>
		<span class="explorar-nexo-ficha-fuente">${escaparPOS(etiquetaFuente)}</span>
		${explorarNexoBadgeNivel(item.nivel)}
		<h3>${escaparPOS(item.nombre)}</h3>
		<dl class="explorar-nexo-ficha-datos">${datosHtml}</dl>
		${preciosHtml}
		<div class="explorar-nexo-ficha-acciones">${accionesHtml}</div>
	`;

	explorarNexoCargarFotosVisibles(ficha);

	// Pantalla del cliente: mientras se confirma con el cliente que este
	// es el producto correcto, se manda a mostrar alla tambien.
	if (typeof pantallaClienteMostrar === "function") {
		const precioParaCliente = fuente === "inventario" ? item.precio
			: fuente === "proveedor" ? item.precioPublico
			: item.precioListaPublico;
		Promise.resolve(item.codigo ? explorarNexoResolverFoto(item.codigo) : null).then(foto => {
			pantallaClienteMostrar({ nombre: item.nombre, foto, precio: precioParaCliente, marca: item.marca, origen: "explorar-nexo" });
		});
	}
}

function explorarNexoVerProductoInventario(productoId) {
	if (typeof verDetalleProducto === "function") verDetalleProducto(productoId);
}

function explorarNexoAgregarAVenta(productoId) {
	if (typeof agregarDesdeFlyoutPOS === "function") agregarDesdeFlyoutPOS(productoId);
}

// Cuando ninguna de las 4 fuentes confirma el producto, la unica
// opcion honesta es dejar que el cliente lo espere -- sin
// codigo/marca/proveedor, solo el nombre que se busco.
async function explorarNexoCrearEncargoSinResultado() {
	const nombre = explorarNexoUltimoResultado?.termino;
	if (!nombre) return;

	if (typeof mostrarEncargos === "function") await mostrarEncargos();
	if (typeof itemsEncargoNuevo === "undefined") return;

	itemsEncargoNuevo.push({ productoId: null, codigo: "", nombre, proveedor: "", marca: "", cantidad: 1, precioEstimado: 0 });

	if (typeof renderTablaItemsEncargoNuevo === "function") renderTablaItemsEncargoNuevo();

	document.getElementById("encargoClienteNombre")?.focus();
}

// Puente hacia Encargos (paso 7 del diseno aprobado): la busqueda
// descubre el producto, Encargos se encarga del proceso posterior --
// se abre la pantalla real de Encargos y se le agrega este hallazgo
// como si el empleado lo hubiera escrito a mano, sin duplicar nada de
// esa logica. El empleado solo tiene que escribir el cliente y
// guardar.
async function explorarNexoCrearEncargo(fuente, indice) {
	const item = explorarNexoObtenerItem(fuente, indice);
	if (!item) return;

	const precioEstimado = fuente === "proveedor" ? item.precioPublico : item.precioListaPublico;

	if (typeof mostrarEncargos === "function") await mostrarEncargos();
	if (typeof itemsEncargoNuevo === "undefined") return;

	itemsEncargoNuevo.push({
		productoId: null,
		codigo: item.codigo || "",
		nombre: item.nombre,
		// item.proveedor solo existe de verdad para un resultado "con
		// proveedores" -- para uno de Catalogo Nexo no se rellena con el
		// fabricante: fabricante no es a quien se le compra, y mostrarlo
		// como proveedor confundiria a quien revise el encargo despues.
		proveedor: fuente === "proveedor" ? (item.proveedor || "") : "",
		marca: item.marca || "",
		cantidad: 1,
		precioEstimado: precioEstimado || 0
	});

	if (typeof renderTablaItemsEncargoNuevo === "function") renderTablaItemsEncargoNuevo();

	document.getElementById("encargoClienteNombre")?.focus();
}

// "Pedir al proveedor" (restocking, sin cliente de por medio) --
// reusa POST /pedidos-proveedor tal cual, la misma ruta que ya usa la
// pantalla de Compras -> Pedidos a proveedor (incluye su propio
// candado de plan Plus, respetado aqui sin duplicarlo). Un resultado
// de "Con proveedores" ya trae el proveedor; uno de "Catalogo Nexo"
// no tiene uno especifico todavia, se pregunta con el mismo
// formulario generico que ya usa Creditos.
async function explorarNexoPedirAlProveedor(fuente, indice) {
	const item = explorarNexoObtenerItem(fuente, indice);
	if (!item) return;

	let proveedorNombre = item.proveedor || "";

	if (!proveedorNombre) {
		const datos = typeof abrirFormularioCredito === "function"
			? await abrirFormularioCredito({
				titulo: "Pedir al proveedor",
				subtitulo: item.nombre,
				campos: [{ nombre: "proveedor", etiqueta: "Nombre del proveedor", placeholder: "Ej. Diprofer", requerido: true }]
			})
			: null;

		if (!datos) return;
		proveedorNombre = datos.proveedor;
	}

	const costo = fuente === "proveedor"
		? (item.precioDistribuidor ?? item.precioPublico ?? 0)
		: (item.precioListaDistribuidor ?? item.precioListaPublico ?? 0);

	try {
		const respuesta = await fetch("/pedidos-proveedor", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				proveedor: proveedorNombre,
				estado: "borrador",
				items: [{
					codigo: item.codigo || "",
					nombre: item.nombre,
					proveedor: proveedorNombre,
					cantidad: 1,
					costo: costo || 0,
					unidad: "pieza"
				}]
			})
		});
		const datosRespuesta = await respuesta.json().catch(() => ({}));

		if (!respuesta.ok) {
			await alertaPOS(datosRespuesta.error || "No se pudo crear el pedido.", "Pedir al proveedor", "peligro");
			return;
		}

		await alertaPOS(`Pedido creado con ${proveedorNombre}, en borrador. Revisalo y envialo desde Compras -> Pedidos a proveedor.`, "Pedido creado", "exito");
	} catch (error) {
		await alertaPOS("Error de conexion, intenta de nuevo.", "Pedir al proveedor", "peligro");
	}
}
