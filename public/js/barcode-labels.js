// Editor de codigos de barras / etiquetas -- asistente guiado de 4
// etapas (Seleccionar productos / Disenar etiquetas / Vista previa /
// Imprimir). Reusa /listas-producto tal cual para guardar/cargar la
// lista de productos a imprimir, y /etiquetas-plantillas para guardar
// disenos reutilizables.
//
// Decision de arquitectura: itemsCodigosBarras solo guarda
// {productoId, cantidad} -- nunca nombre/marca/categoria/codigo/precio.
// Todo campo de presentacion se resuelve SIEMPRE contra el cache
// global todosProductos al momento de renderizar (productoParaEtiqueta).
// Esto evita que una lista cargada muestre datos viejos o vacios, y
// evita tener que mutar los items cuando algo cambia en el producto
// (ej. al generar su codigo interno).

let itemsCodigosBarras = [];
let disenoActualEtiquetas = null;
let tamanoPapelActual = null;
let plantillasEtiquetasGuardadas = [];
let listasGuardadasEtiquetasCache = [];
let vistaCategoriaEtiquetas = null;
let indiceArrastradoEtiqueta = null;

let etapaActualEtiquetas = 0;
let etapaMaximaAlcanzadaEtiquetas = 0;
let modoCatalogoEtiquetas = "vacio"; // "vacio" | "busqueda" | "categoria"
let busquedaEtiquetaTextoActual = "";
let etiquetaBusquedaTimeout = null;

let vistaPreviaEtiquetasPaginas = [];
let paginaVistaPreviaActual = 0;
let zoomVistaPreviaEtiquetas = 1;

const PLANTILLAS_ETIQUETAS_POR_DEFECTO = [
 { nombre: "Pequeña", anchoMm: 40, altoMm: 20, columnas: 4, margenMm: 5, espaciadoMm: 2, mostrarNombre: true, mostrarCodigoBarras: true, mostrarNumeroCodigo: false, mostrarPrecio: false, mostrarMarca: false, mostrarCategoria: false },
 { nombre: "Precio + código", anchoMm: 50, altoMm: 25, columnas: 3, margenMm: 5, espaciadoMm: 3, mostrarNombre: true, mostrarCodigoBarras: true, mostrarNumeroCodigo: true, mostrarPrecio: true, mostrarMarca: false, mostrarCategoria: false },
 { nombre: "Grande", anchoMm: 70, altoMm: 40, columnas: 2, margenMm: 8, espaciadoMm: 4, mostrarNombre: true, mostrarCodigoBarras: true, mostrarNumeroCodigo: true, mostrarPrecio: true, mostrarMarca: true, mostrarCategoria: true },
 { nombre: "Solo código", anchoMm: 40, altoMm: 20, columnas: 4, margenMm: 5, espaciadoMm: 2, mostrarNombre: false, mostrarCodigoBarras: true, mostrarNumeroCodigo: true, mostrarPrecio: false, mostrarMarca: false, mostrarCategoria: false },
 { nombre: "Anaquel", anchoMm: 60, altoMm: 30, columnas: 3, margenMm: 5, espaciadoMm: 3, mostrarNombre: true, mostrarCodigoBarras: true, mostrarNumeroCodigo: true, mostrarPrecio: true, mostrarMarca: false, mostrarCategoria: false }
];

const TAMANOS_PAPEL_ETIQUETAS = [
 { nombre: "A4", anchoMm: 210, altoMm: 297 },
 { nombre: "Carta", anchoMm: 216, altoMm: 279 },
 { nombre: "Rollo continuo", anchoMm: 58, altoMm: null }
];

const ETAPAS_ETIQUETAS = [
 { titulo: "Seleccionar" },
 { titulo: "Diseñar" },
 { titulo: "Vista previa" },
 { titulo: "Imprimir" }
];

const ETIQUETAS_TEXTO_SIGUIENTE = [
 "Continuar → Diseñar etiquetas",
 "Continuar → Vista previa",
 "Continuar → Imprimir"
];

// Campos "de aspecto" de una plantilla -- deliberadamente sin .nombre,
// para que comparar contra los presets no dependa de como se llame el
// diseno actual (ver renderPlantillasPredisenoEtiquetas).
const CAMPOS_DISENO_ETIQUETA = [
 "anchoMm", "altoMm", "columnas", "margenMm", "espaciadoMm",
 "mostrarNombre", "mostrarCodigoBarras", "mostrarNumeroCodigo",
 "mostrarPrecio", "mostrarMarca", "mostrarCategoria"
];

const ITEM_EJEMPLO_PLANTILLA_ETIQUETA = {
 nombre: "Producto de ejemplo", codigo: "7501234567890", precio: 99.5, marca: "Marca", categoria: "Categoría"
};

// 1mm = 96/25.4 px (conversion estandar del navegador para unidades CSS
// en mm). La mini-preview de cada plantilla debe caber en el mismo
// recuadro sin importar su tamano real -- Grande (70x40mm) y Pequeña
// (40x20mm) no pueden compartir una sola escala fija sin que la mas
// grande se desborde de su tarjeta.
const MM_A_PX_MINIATURA = 96 / 25.4;

function estiloMiniaturaEtiqueta(plantilla, anchoObjetivoPx = 92, altoObjetivoPx = 50) {
 const anchoRealPx = plantilla.anchoMm * MM_A_PX_MINIATURA;
 const altoRealPx = plantilla.altoMm * MM_A_PX_MINIATURA;
 const escala = Math.min(anchoObjetivoPx / anchoRealPx, altoObjetivoPx / altoRealPx, 1);

 return `transform:scale(${escala.toFixed(3)});`;
}

// --- Entrada ---

function crearItemEtiqueta(productoId, cantidad) {
 return { productoId: Number(productoId), cantidad: cantidad > 0 ? cantidad : 1 };
}

function productoParaEtiqueta(productoId) {
 return (typeof todosProductos !== "undefined" ? todosProductos : [])
 .find(producto => Number(producto.id) === Number(productoId)) || null;
}

function totalEtiquetasEnLista() {
 return itemsCodigosBarras.reduce((total, item) => total + (item.cantidad || 0), 0);
}

// Se llama despues de cualquier cambio a itemsCodigosBarras hecho desde
// la Etapa 1 -- refresca solo los sub-contenedores relevantes, nunca
// toda la etapa (perderia el foco del buscador mientras se escribe).
function refrescarSeleccionEtiquetas() {
 renderMiListaEtiquetas();
 renderCatalogoAreaEtiquetas();
}

async function mostrarCodigosBarras(opciones = {}) {
 if (typeof ocultarPantallasPrincipales === "function") {
 ocultarPantallasPrincipales();
 }

 const pantalla =
 document.getElementById("pantallaCodigosBarras");

 if (!pantalla) return;

 pantalla.style.display = "block";

 if (typeof actualizarTopbarContexto === "function") {
 actualizarTopbarContexto("Códigos de barras", "Arma tu lista y diseña la hoja de etiquetas", "codigos-barras");
 }

 itemsCodigosBarras = (opciones.productosIniciales || [])
 .filter(producto => producto && producto.id != null)
 .map(producto => crearItemEtiqueta(producto.id, 1));

 disenoActualEtiquetas = { ...PLANTILLAS_ETIQUETAS_POR_DEFECTO[1] };
 tamanoPapelActual = { ...TAMANOS_PAPEL_ETIQUETAS[0] };
 vistaCategoriaEtiquetas = null;
 modoCatalogoEtiquetas = "vacio";
 busquedaEtiquetaTextoActual = "";
 etapaActualEtiquetas = 0;
 etapaMaximaAlcanzadaEtiquetas = 0;
 plantillasEtiquetasGuardadas = [];
 listasGuardadasEtiquetasCache = [];
 vistaPreviaEtiquetasPaginas = [];
 paginaVistaPreviaActual = 0;
 zoomVistaPreviaEtiquetas = 1;

 pantalla.innerHTML = plantillaHtmlEsqueletoWizardEtiquetas();

 cargarListasGuardadasEtiquetas();
 cargarPlantillasEtiquetas();

 cambiarEtapaEtiquetas(0);
}

// --- Esqueleto del wizard ---

function plantillaHtmlEsqueletoWizardEtiquetas() {
 return `
 <div class="etiqueta-wizard-shell">
 <div class="etiqueta-wizard-header">
 <div>
 <h2>Códigos de barras</h2>
 <p>Arma tu lista, diseña tus etiquetas e imprime en minutos.</p>
 </div>
 <div class="etiqueta-wizard-dots">
 ${ETAPAS_ETIQUETAS.map((etapa, indice) => `
 <button type="button" class="etiqueta-dot" data-etiqueta-dot="${indice}" onclick="irEtapaEtiquetasSiValida(${indice})">
 <span class="etiqueta-dot-num">${indice + 1}</span>
 <span class="etiqueta-dot-label">${escaparPOS(etapa.titulo)}</span>
 </button>
 `).join("")}
 </div>
 </div>

 <section data-etiqueta-etapa="0" class="etiqueta-etapa"></section>
 <section data-etiqueta-etapa="1" class="etiqueta-etapa" hidden></section>
 <section data-etiqueta-etapa="2" class="etiqueta-etapa" hidden></section>
 <section data-etiqueta-etapa="3" class="etiqueta-etapa" hidden></section>

 <div class="etiqueta-wizard-nav">
 <button type="button" id="etiquetaNavAtras" class="btn-encargo-secundario" onclick="retrocederEtapaEtiquetas()">&larr; Atrás</button>
 <button type="button" id="etiquetaNavSiguiente" class="btn-encargo-primario" onclick="avanzarEtapaEtiquetas()">Continuar</button>
 </div>
 </div>
 `;
}

function cambiarEtapaEtiquetas(etapa) {
 const secciones =
 Array.from(document.querySelectorAll('#pantallaCodigosBarras [data-etiqueta-etapa]'));

 if (!secciones.length) return;

 etapaActualEtiquetas = Math.max(0, Math.min(etapa, secciones.length - 1));
 etapaMaximaAlcanzadaEtiquetas = Math.max(etapaMaximaAlcanzadaEtiquetas, etapaActualEtiquetas);

 secciones.forEach(seccion => {
 seccion.hidden = Number(seccion.dataset.etiquetaEtapa) !== etapaActualEtiquetas;
 });

 document.querySelectorAll('#pantallaCodigosBarras [data-etiqueta-dot]').forEach(boton => {
 const indice = Number(boton.dataset.etiquetaDot);
 boton.classList.toggle("activa", indice === etapaActualEtiquetas);
 boton.classList.toggle("completada", indice < etapaActualEtiquetas);
 });

 const botonAtras = document.getElementById("etiquetaNavAtras");
 const botonSiguiente = document.getElementById("etiquetaNavSiguiente");

 if (botonAtras) botonAtras.style.visibility = etapaActualEtiquetas === 0 ? "hidden" : "visible";

 if (botonSiguiente) {
 const esUltimaEtapa = etapaActualEtiquetas === secciones.length - 1;
 botonSiguiente.style.display = esUltimaEtapa ? "none" : "inline-flex";
 botonSiguiente.textContent = ETIQUETAS_TEXTO_SIGUIENTE[etapaActualEtiquetas] || "Continuar";
 }

 if (etapaActualEtiquetas === 0) renderEtapaSeleccionProductos();
 else if (etapaActualEtiquetas === 1) renderEtapaDisenoEtiquetas();
 else if (etapaActualEtiquetas === 2) renderEtapaVistaPreviaEtiquetas();
 else if (etapaActualEtiquetas === 3) renderEtapaImprimirEtiquetas();
}

function validarAvanceEtiquetas(etapaOrigen) {
 if (etapaOrigen === 0 && itemsCodigosBarras.length === 0) {
 alertaPOS("Agrega al menos un producto a tu lista antes de continuar.", "Lista vacía", "alerta");
 return false;
 }

 return true;
}

function avanzarEtapaEtiquetas() {
 if (!validarAvanceEtiquetas(etapaActualEtiquetas)) return;
 cambiarEtapaEtiquetas(etapaActualEtiquetas + 1);
}

function retrocederEtapaEtiquetas() {
 cambiarEtapaEtiquetas(etapaActualEtiquetas - 1);
}

function irEtapaEtiquetasSiValida(etapaDestino) {
 if (etapaDestino <= etapaMaximaAlcanzadaEtiquetas) {
 cambiarEtapaEtiquetas(etapaDestino);
 return;
 }

 if (etapaDestino === etapaActualEtiquetas + 1) {
 avanzarEtapaEtiquetas();
 }
}

// =====================================================================
// ETAPA 1 -- Seleccionar productos
// =====================================================================

function renderEtapaSeleccionProductos() {
 const seccion =
 document.querySelector('#pantallaCodigosBarras [data-etiqueta-etapa="0"]');

 if (!seccion) return;

 seccion.innerHTML = `
 <div class="etiqueta-selector-grid">
 <div class="etiqueta-selector-catalogo">
 <div class="etiqueta-buscador-hero">
 <span class="etiqueta-buscador-icono">${iconoUISVG("search")}</span>
 <input type="text" id="etiquetaBuscadorInput" placeholder="Busca por nombre, código, SKU o marca..." oninput="programarBusquedaEtiqueta(this.value)">
 <button type="button" class="etiqueta-explorar-toggle" onclick="alternarCategoriasEtiquetas()">${iconoUISVG("grid")} Explorar por categoría</button>
 </div>
 <div id="etiquetaCatalogoArea" class="etiqueta-catalogo-area"></div>
 </div>

 <aside class="etiqueta-mi-lista-panel">
 <div class="etiqueta-mi-lista-header">
 <h3>Mi lista de impresión</h3>
 <p id="etiquetaMiListaResumen"></p>
 </div>
 <div id="etiquetaMiListaItems" class="etiqueta-mi-lista-items"></div>
 <div class="etiqueta-mi-lista-acciones">
 <button type="button" class="btn-encargo-secundario" onclick="document.getElementById('etiquetaBuscadorInput')?.focus()">+ Agregar más</button>
 <button type="button" class="etiqueta-btn-vaciar" onclick="vaciarListaEtiquetas()">Vaciar lista</button>
 </div>
 <div class="etiqueta-guardar-fila">
 <label>Guardar esta selección como lista
 <input id="etiquetaGuardarListaNombre" placeholder="Nombre (opcional)">
 </label>
 <button type="button" class="btn-encargo-secundario" onclick="guardarListaDesdeEtiquetas()">Guardar</button>
 </div>
 <div class="etiqueta-mis-listas-bloque">
 <h4>Mis listas</h4>
 <div id="etiquetaMisListasChips" class="etiqueta-mis-listas-chips">
 <p class="encargo-items-vacio">Cargando...</p>
 </div>
 </div>
 </aside>
 </div>
 `;

 renderCatalogoAreaEtiquetas();
 renderMiListaEtiquetas();
 renderChipsListasGuardadasEtiquetas();
}

// --- Buscador ---

function programarBusquedaEtiqueta(texto) {
 clearTimeout(etiquetaBusquedaTimeout);
 etiquetaBusquedaTimeout = setTimeout(() => ejecutarBusquedaEtiqueta(texto), 280);
}

function ejecutarBusquedaEtiqueta(texto) {
 busquedaEtiquetaTextoActual = String(texto || "").trim();
 modoCatalogoEtiquetas = busquedaEtiquetaTextoActual ? "busqueda" : "vacio";
 renderCatalogoAreaEtiquetas();
}

function productoCoincideConBusquedaEtiqueta(producto, texto) {
 if (!texto) return true;

 const buscado = texto.toLowerCase();

 if (String(producto.nombre || "").toLowerCase().includes(buscado)) return true;
 if (String(producto.codigo || "").toLowerCase().includes(buscado)) return true;
 if (String(producto.categoria || "").toLowerCase().includes(buscado)) return true;
 if (String(producto.marca || "").toLowerCase().includes(buscado)) return true;

 if (Array.isArray(producto.codigos_relacionados)) {
 return producto.codigos_relacionados.some(item =>
 String(item?.codigo || "").toLowerCase().includes(buscado)
 );
 }

 return false;
}

async function renderCatalogoAreaEtiquetas() {
 const area =
 document.getElementById("etiquetaCatalogoArea");

 if (!area) return;

 const botonExplorar =
 document.querySelector(".etiqueta-explorar-toggle");

 if (botonExplorar) botonExplorar.classList.toggle("activo", modoCatalogoEtiquetas === "categoria");

 if (modoCatalogoEtiquetas === "categoria") {
 area.innerHTML = `<div id="etiquetaCategoriasPanel"></div>`;
 await renderCategoriasEtiquetas();
 return;
 }

 if (modoCatalogoEtiquetas === "busqueda") {
 const resultados =
 (typeof todosProductos !== "undefined" ? todosProductos : [])
 .filter(producto => productoCoincideConBusquedaEtiqueta(producto, busquedaEtiquetaTextoActual))
 .slice(0, 60);

 area.innerHTML = resultados.length
 ? `<div class="etiqueta-productos-grid">${resultados.map(producto => tarjetaProductoEtiquetaHtml(producto, { ampliable: true })).join("")}</div>`
 : `<p class="encargo-items-vacio">No encontramos productos que coincidan con "${escaparPOS(busquedaEtiquetaTextoActual)}".</p>`;
 return;
 }

 area.innerHTML = `
 <div class="etiqueta-catalogo-vacio">
 <span class="etiqueta-catalogo-vacio-icono">${iconoUISVG("search")}</span>
 <p>Busca un producto arriba o explora por categoría para empezar a armar tu lista.</p>
 </div>
 `;
}

function tarjetaProductoEtiquetaHtml(producto, opciones = {}) {
 const item =
 itemsCodigosBarras.find(i => Number(i.productoId) === Number(producto.id));

 const cantidadEnLista =
 item?.cantidad || 0;

 const metaTexto =
 [producto.marca, producto.categoria].filter(Boolean).map(escaparPOS).join(" &middot; ");

 return `
 <div class="etiqueta-producto-card ${cantidadEnLista ? "en-lista" : ""}">
 <div class="etiqueta-producto-card-img">${miniaturaProducto(producto, "etiqueta-producto-card-img-el", { ampliable: Boolean(opciones.ampliable) })}</div>
 <div class="etiqueta-producto-card-cuerpo">
 <strong class="etiqueta-producto-card-nombre">${escaparPOS(producto.nombre || "")}</strong>
 ${metaTexto ? `<span class="etiqueta-producto-card-meta">${metaTexto}</span>` : ""}
 <span class="etiqueta-producto-card-codigo">${producto.codigo ? escaparPOS(producto.codigo) : "Sin código"}</span>
 <span class="etiqueta-producto-card-precio">${typeof dinero === "function" ? dinero(producto.precio || 0) : producto.precio}</span>
 </div>
 <div class="etiqueta-producto-card-accion">
 ${cantidadEnLista
 ? `<div class="etiqueta-stepper">
 <button type="button" onclick="restarCantidadProductoEtiqueta(${producto.id})">&minus;</button>
 <span>${cantidadEnLista}</span>
 <button type="button" onclick="sumarCantidadProductoEtiqueta(${producto.id})">+</button>
 </div>`
 : `<button type="button" class="btn-encargo-agregar etiqueta-btn-agregar-card" onclick="sumarCantidadProductoEtiqueta(${producto.id})">+ Agregar</button>`}
 </div>
 </div>
 `;
}

function sumarCantidadProductoEtiqueta(productoId) {
 const item =
 itemsCodigosBarras.find(i => Number(i.productoId) === Number(productoId));

 if (item) item.cantidad += 1;
 else itemsCodigosBarras.push(crearItemEtiqueta(productoId, 1));

 refrescarSeleccionEtiquetas();
}

function restarCantidadProductoEtiqueta(productoId) {
 const indice =
 itemsCodigosBarras.findIndex(i => Number(i.productoId) === Number(productoId));

 if (indice === -1) return;

 if (itemsCodigosBarras[indice].cantidad <= 1) {
 itemsCodigosBarras.splice(indice, 1);
 } else {
 itemsCodigosBarras[indice].cantidad -= 1;
 }

 refrescarSeleccionEtiquetas();
}

// --- Explorar por categoria (departamentos -> subcategorias -> productos) ---

function alternarCategoriasEtiquetas() {
 modoCatalogoEtiquetas =
 modoCatalogoEtiquetas === "categoria"
 ? (busquedaEtiquetaTextoActual ? "busqueda" : "vacio")
 : "categoria";

 if (modoCatalogoEtiquetas === "categoria") vistaCategoriaEtiquetas = null;

 renderCatalogoAreaEtiquetas();
}

async function renderCategoriasEtiquetas() {
 const panel =
 document.getElementById("etiquetaCategoriasPanel");

 if (!panel) return;

 if (typeof cargarGirosYCategoriasNexo === "function") {
 await cargarGirosYCategoriasNexo();
 }

 if (!vistaCategoriaEtiquetas) {
 renderCategoriasEtiquetasDepartamentos(panel);
 } else if (!vistaCategoriaEtiquetas.subcategoria) {
 renderCategoriasEtiquetasSubcategorias(panel);
 } else {
 renderCategoriasEtiquetasProductos(panel);
 }
}

function renderCategoriasEtiquetasDepartamentos(panel) {
 const nodos =
 typeof nodosCategoriasInventario === "function" ? nodosCategoriasInventario() : [];

 if (nodos.length === 0) {
 panel.innerHTML = `<p class="encargo-items-vacio">Este negocio todavía no tiene categorías con productos.</p>`;
 return;
 }

 panel._nodosCategoriasEtiquetas = nodos;

 panel.innerHTML = `
 <div class="etiqueta-categorias-grid">
 ${nodos.map((nodo, indice) => `
 <button type="button" class="categoria-card" onclick="abrirDepartamentoEtiquetas(${indice})">
 <span class="categoria-card-icono">${typeof iconoUISVG === "function" ? iconoUISVG(nodo.tipo === "departamento" ? "toolbox" : "tag") : ""}</span>
 <span class="categoria-card-texto"><strong>${escaparPOS(nodo.nombre)}</strong></span>
 </button>
 `).join("")}
 </div>
 `;
}

function abrirDepartamentoEtiquetas(indice) {
 const panel =
 document.getElementById("etiquetaCategoriasPanel");

 const nodo =
 panel?._nodosCategoriasEtiquetas?.[indice];

 if (!nodo) return;

 if (nodo.tipo === "departamento" && (nodo.subcategorias || []).length > 0) {
 vistaCategoriaEtiquetas = { departamento: nodo.nombre, subcategorias: nodo.subcategorias };
 } else {
 vistaCategoriaEtiquetas = { departamento: nodo.nombre, subcategoria: nodo.nombre };
 }

 renderCategoriasEtiquetas();
}

function renderCategoriasEtiquetasSubcategorias(panel) {
 const { departamento, subcategorias } = vistaCategoriaEtiquetas;

 panel.innerHTML = `
 <button type="button" class="btn-encargo-secundario" onclick="volverDepartamentosEtiquetas()">&larr; ${escaparPOS(departamento)}</button>
 <div class="etiqueta-categorias-grid">
 ${subcategorias.map(sub => `
 <button type="button" class="categoria-card" onclick="abrirSubcategoriaEtiquetas('${String(sub.nombre).replace(/'/g, "\\'")}')">
 <span class="categoria-card-texto"><strong>${escaparPOS(sub.nombre)}</strong></span>
 </button>
 `).join("")}
 </div>
 `;
}

function abrirSubcategoriaEtiquetas(nombreSubcategoria) {
 vistaCategoriaEtiquetas = {
 departamento: vistaCategoriaEtiquetas.departamento,
 subcategoria: nombreSubcategoria
 };

 renderCategoriasEtiquetas();
}

function volverDepartamentosEtiquetas() {
 vistaCategoriaEtiquetas = null;
 renderCategoriasEtiquetas();
}

function abrirDepartamentoDeVueltaEtiquetas() {
 vistaCategoriaEtiquetas = {
 departamento: vistaCategoriaEtiquetas.departamento,
 subcategorias: (typeof nodosCategoriasInventario === "function" ? nodosCategoriasInventario() : [])
 .find(n => n.nombre === vistaCategoriaEtiquetas.departamento)?.subcategorias || []
 };

 renderCategoriasEtiquetas();
}

function productosPorSubcategoriaNexo(nombreSubcategoria) {
 const normalizada =
 normalizarTexto(nombreSubcategoria);

 return (typeof todosProductos !== "undefined" ? todosProductos : [])
 .filter(p => normalizarTexto(p.subcategoria || "") === normalizada);
}

function renderCategoriasEtiquetasProductos(panel) {
 const { departamento, subcategoria } = vistaCategoriaEtiquetas;

 const productos =
 subcategoria === departamento
 ? (typeof productosPorCategoria === "function" ? productosPorCategoria(departamento) : [])
 : productosPorSubcategoriaNexo(subcategoria);

 panel._productosCategoriaEtiquetas = productos;

 panel.innerHTML = `
 <button type="button" class="btn-encargo-secundario" onclick="${subcategoria === departamento ? "volverDepartamentosEtiquetas()" : "abrirDepartamentoDeVueltaEtiquetas()"}">&larr; ${escaparPOS(subcategoria)}</button>
 ${productos.length === 0
 ? `<p class="encargo-items-vacio">No hay productos en esta categoría.</p>`
 : `
 <button type="button" class="btn-encargo-primario encargo-btn-full" onclick="agregarTodosCategoriaEtiquetas()">+ Agregar los ${productos.length} de esta categoría</button>
 <div class="etiqueta-productos-grid">${productos.map(producto => tarjetaProductoEtiquetaHtml(producto, { ampliable: false })).join("")}</div>
 `}
 `;
}

function agregarTodosCategoriaEtiquetas() {
 const panel =
 document.getElementById("etiquetaCategoriasPanel");

 const productos =
 panel?._productosCategoriaEtiquetas || [];

 productos.forEach(producto => {
 const item =
 itemsCodigosBarras.find(i => Number(i.productoId) === Number(producto.id));

 if (item) item.cantidad += 1;
 else itemsCodigosBarras.push(crearItemEtiqueta(producto.id, 1));
 });

 refrescarSeleccionEtiquetas();
 alertaPOS(`Se agregaron ${productos.length} producto(s) a tu lista.`, "Listo", "exito");
}

// --- Mi lista de impresion ---

function renderMiListaEtiquetas() {
 const resumen =
 document.getElementById("etiquetaMiListaResumen");

 const contenedor =
 document.getElementById("etiquetaMiListaItems");

 if (!resumen || !contenedor) return;

 resumen.textContent = itemsCodigosBarras.length
 ? `${itemsCodigosBarras.length} producto(s) · ${totalEtiquetasEnLista()} etiqueta(s) a imprimir`
 : "Todavía no agregas productos.";

 if (itemsCodigosBarras.length === 0) {
 contenedor.innerHTML = `<p class="encargo-items-vacio">Busca productos o explora por categoría para empezar.</p>`;
 return;
 }

 contenedor.innerHTML = itemsCodigosBarras.map((item, indice) => {
 const producto = productoParaEtiqueta(item.productoId);
 const arrastre = `draggable="true" ondragstart="onArrastrarInicioItemEtiqueta(event, ${indice})" ondragover="onArrastrarSobreItemEtiqueta(event)" ondrop="onSoltarItemEtiqueta(event, ${indice})"`;

 if (!producto) {
 return `
 <div class="etiqueta-mi-lista-fila etiqueta-mi-lista-fila-rota" ${arrastre}>
 <span class="etiqueta-fila-agarradera" title="Arrastra para reordenar">&#9776;</span>
 <span class="etiqueta-mi-lista-datos"><strong>Producto ya no disponible</strong></span>
 <button type="button" class="btn-encargo-quitar" onclick="quitarItemEtiqueta(${indice})">Quitar</button>
 </div>
 `;
 }

 return `
 <div class="etiqueta-mi-lista-fila" ${arrastre}>
 <span class="etiqueta-fila-agarradera" title="Arrastra para reordenar">&#9776;</span>
 <span class="etiqueta-mi-lista-img">${miniaturaProducto(producto, "etiqueta-mi-lista-img-el")}</span>
 <span class="etiqueta-mi-lista-datos">
 <strong>${escaparPOS(producto.nombre)}</strong>
 <small>${producto.codigo ? escaparPOS(producto.codigo) : `<a href="#" onclick="event.preventDefault();generarCodigoProductoEtiqueta(${item.productoId})">Generar código</a>`}</small>
 </span>
 <span class="etiqueta-stepper etiqueta-stepper-compacto">
 <button type="button" onclick="restarCantidadProductoEtiqueta(${item.productoId})">&minus;</button>
 <input type="number" step="1" min="1" value="${item.cantidad}" onchange="cambiarCantidadItemEtiqueta(${indice}, this.value)">
 <button type="button" onclick="sumarCantidadProductoEtiqueta(${item.productoId})">+</button>
 </span>
 <button type="button" class="btn-encargo-quitar" onclick="quitarItemEtiqueta(${indice})">Quitar</button>
 </div>
 `;
 }).join("");
}

function cambiarCantidadItemEtiqueta(indice, valor) {
 const cantidad = Number(valor);
 itemsCodigosBarras[indice].cantidad = cantidad > 0 ? cantidad : 1;
 refrescarSeleccionEtiquetas();
}

function quitarItemEtiqueta(indice) {
 itemsCodigosBarras.splice(indice, 1);
 refrescarSeleccionEtiquetas();
}

function vaciarListaEtiquetas() {
 if (itemsCodigosBarras.length === 0) return;

 confirmarPOS("Esto va a quitar todos los productos de tu lista de impresión. ¿Continuar?", "Vaciar lista", "alerta")
 .then(confirmado => {
 if (!confirmado) return;
 itemsCodigosBarras = [];
 refrescarSeleccionEtiquetas();
 });
}

async function generarCodigoProductoEtiqueta(productoId) {
 try {
 const respuesta =
 await fetch(`/productos/${productoId}/generar-codigo`, { method: "POST" });

 const datos =
 await respuesta.json().catch(() => ({}));

 if (!respuesta.ok || !datos.ok) {
 alertaPOS(datos.error || "No se pudo generar el código.", "Error", "peligro");
 return;
 }

 if (typeof todosProductos !== "undefined") {
 const productoCache =
 todosProductos.find(p => Number(p.id) === Number(productoId));

 if (productoCache) productoCache.codigo = datos.codigo;
 }

 refrescarSeleccionEtiquetas();
 } catch (error) {
 alertaPOS("No se pudo generar el código. Revisa tu conexión.", "Error", "peligro");
 }
}

// --- Reordenar arrastrando (unico patron de drag&drop del repo) ---

function onArrastrarInicioItemEtiqueta(evento, indice) {
 indiceArrastradoEtiqueta = indice;
 evento.dataTransfer.setData("text/plain", String(indice));
}

function onArrastrarSobreItemEtiqueta(evento) {
 evento.preventDefault();
}

function onSoltarItemEtiqueta(evento, indiceDestino) {
 evento.preventDefault();

 const indiceOrigen =
 indiceArrastradoEtiqueta !== null ? indiceArrastradoEtiqueta : Number(evento.dataTransfer.getData("text/plain"));

 indiceArrastradoEtiqueta = null;

 if (!Number.isInteger(indiceOrigen) || indiceOrigen === indiceDestino) return;

 const [item] = itemsCodigosBarras.splice(indiceOrigen, 1);
 itemsCodigosBarras.splice(indiceDestino, 0, item);

 refrescarSeleccionEtiquetas();
}

// --- Cargar / guardar como lista (reusa /listas-producto) ---

async function cargarListasGuardadasEtiquetas() {
 try {
 const respuesta =
 await fetch("/listas-producto");

 const datos =
 await respuesta.json().catch(() => ({}));

 listasGuardadasEtiquetasCache = (respuesta.ok && datos.ok) ? datos.listas : [];
 } catch (error) {
 listasGuardadasEtiquetasCache = [];
 }

 renderChipsListasGuardadasEtiquetas();
}

function renderChipsListasGuardadasEtiquetas() {
 const contenedor =
 document.getElementById("etiquetaMisListasChips");

 if (!contenedor) return;

 if (listasGuardadasEtiquetasCache.length === 0) {
 contenedor.innerHTML = `<p class="encargo-items-vacio">Todavía no tienes listas guardadas.</p>`;
 return;
 }

 contenedor.innerHTML = listasGuardadasEtiquetasCache.map(lista => `
 <button type="button" class="btn-encargo-secundario etiqueta-chip-lista" onclick="cargarListaGuardadaEnEtiquetas(${lista.id})">
 ${escaparPOS(lista.nombre)} <span class="etiqueta-chip-lista-conteo">${lista.totalItems}</span>
 </button>
 `).join("");
}

async function cargarListaGuardadaEnEtiquetas(listaId) {
 if (itemsCodigosBarras.length > 0) {
 const confirmado = await confirmarPOS("Esto va a reemplazar tu lista actual. ¿Continuar?", "Cargar lista", "alerta");
 if (!confirmado) return;
 }

 try {
 const respuesta =
 await fetch(`/listas-producto/${listaId}`);

 const datos =
 await respuesta.json().catch(() => ({}));

 if (!respuesta.ok || !datos.ok) {
 alertaPOS(datos.error || "No se pudo cargar la lista.", "Error", "peligro");
 return;
 }

 itemsCodigosBarras = datos.lista.items.map(item => crearItemEtiqueta(item.productoId, item.cantidad));

 refrescarSeleccionEtiquetas();
 } catch (error) {
 alertaPOS("No se pudo cargar la lista.", "Error", "peligro");
 }
}

async function guardarListaDesdeEtiquetas() {
 if (itemsCodigosBarras.length === 0) {
 alertaPOS("Agrega al menos un producto a la lista.", "Sin productos", "alerta");
 return;
 }

 const nombre =
 document.getElementById("etiquetaGuardarListaNombre")?.value.trim()
 || `Lista de etiquetas ${new Date().toLocaleDateString("es-MX")}`;

 try {
 const respuesta =
 await fetch("/listas-producto", {
 method: "POST",
 headers: { "Content-Type": "application/json" },
 body: JSON.stringify({
 nombre,
 items: itemsCodigosBarras.map(item => ({ productoId: item.productoId, cantidad: item.cantidad }))
 })
 });

 const datos =
 await respuesta.json().catch(() => ({}));

 if (!respuesta.ok || !datos.ok) {
 alertaPOS(datos.error || "No se pudo guardar la lista.", "Error", "peligro");
 return;
 }

 alertaPOS("Lista guardada. Ya la puedes reusar desde \"Mis listas\".", "Listo", "exito");

 const campoNombre = document.getElementById("etiquetaGuardarListaNombre");
 if (campoNombre) campoNombre.value = "";

 cargarListasGuardadasEtiquetas();
 } catch (error) {
 alertaPOS("No se pudo guardar la lista. Revisa tu conexión.", "Error", "peligro");
 }
}

// =====================================================================
// ETAPA 2 -- Disenar etiquetas
// =====================================================================

function renderEtapaDisenoEtiquetas() {
 const seccion =
 document.querySelector('#pantallaCodigosBarras [data-etiqueta-etapa="1"]');

 if (!seccion) return;

 seccion.innerHTML = `
 <div class="etiqueta-etapa2-layout">
 <div class="etiqueta-plantillas-bloque">
 <h3>Plantillas</h3>
 <div id="etiquetaPlantillasPredisenoGrid" class="etiqueta-plantillas-grid"></div>

 <div class="etiqueta-mis-plantillas-bloque">
 <h4>Mis plantillas guardadas</h4>
 <div id="etiquetaMisPlantillasGrid" class="etiqueta-plantillas-grid">
 <p class="encargo-items-vacio">Cargando...</p>
 </div>
 <div class="etiqueta-guardar-fila">
 <label>Guardar diseño actual como
 <input id="etiquetaGuardarPlantillaNombre" placeholder="Nombre de la plantilla">
 </label>
 <button type="button" class="btn-encargo-agregar" onclick="guardarPlantillaEtiquetaActual()">Guardar plantilla</button>
 </div>
 </div>
 </div>

 <div class="etiqueta-acordeon-grupo">
 <section class="etiqueta-seccion-colapsable" data-colapsado="1">
 <button type="button" class="etiqueta-seccion-header" onclick="alternarSeccionColapsableEtiqueta(this)">
 <span>Información de la etiqueta</span>
 <span class="etiqueta-seccion-chevron">&rsaquo;</span>
 </button>
 <div class="etiqueta-seccion-contenido" hidden>
 <div id="etiquetaPanelInformacion"></div>
 </div>
 </section>

 <section class="etiqueta-seccion-colapsable" data-colapsado="1">
 <button type="button" class="etiqueta-seccion-header" onclick="alternarSeccionColapsableEtiqueta(this)">
 <span>Formato</span>
 <span class="etiqueta-seccion-chevron">&rsaquo;</span>
 </button>
 <div class="etiqueta-seccion-contenido" hidden>
 <div id="etiquetaPanelFormato"></div>
 </div>
 </section>
 </div>
 </div>
 `;

 renderPlantillasPredisenoEtiquetas();
 renderPanelInformacionEtiqueta();
 renderPanelFormatoEtiqueta();
 cargarPlantillasEtiquetas();
}

function alternarSeccionColapsableEtiqueta(boton) {
 const seccion = boton.closest(".etiqueta-seccion-colapsable");
 const grupo = boton.closest(".etiqueta-acordeon-grupo");
 const contenido = seccion?.querySelector(".etiqueta-seccion-contenido");

 if (!seccion || !contenido) return;

 const vaAExpandirse = contenido.hidden;

 if (grupo) {
 grupo.querySelectorAll(".etiqueta-seccion-colapsable").forEach(otra => {
 otra.dataset.colapsado = "1";
 const otroContenido = otra.querySelector(".etiqueta-seccion-contenido");
 if (otroContenido) otroContenido.hidden = true;
 });
 }

 contenido.hidden = !vaAExpandirse;
 seccion.dataset.colapsado = vaAExpandirse ? "0" : "1";
}

// --- Plantillas prediseñadas (con mini-preview real) ---

function renderPlantillasPredisenoEtiquetas() {
 const grid =
 document.getElementById("etiquetaPlantillasPredisenoGrid");

 if (!grid || !disenoActualEtiquetas) return;

 const coincideConPreset =
 preset => CAMPOS_DISENO_ETIQUETA.every(campo => disenoActualEtiquetas[campo] === preset[campo]);

 const esPersonalizada =
 !PLANTILLAS_ETIQUETAS_POR_DEFECTO.some(coincideConPreset);

 grid.innerHTML = PLANTILLAS_ETIQUETAS_POR_DEFECTO.map((preset, indice) => `
 <button type="button" class="etiqueta-plantilla-card ${coincideConPreset(preset) ? "activa" : ""}" onclick="aplicarPlantillaPredisenoEtiqueta(${indice})">
 <span class="etiqueta-plantilla-card-preview" style="${estiloMiniaturaEtiqueta(preset)}">${construirUnaEtiquetaHtml(ITEM_EJEMPLO_PLANTILLA_ETIQUETA, preset)}</span>
 <strong>${escaparPOS(preset.nombre)}</strong>
 </button>
 `).join("") + `
 <button type="button" class="etiqueta-plantilla-card etiqueta-plantilla-card-personalizada ${esPersonalizada ? "activa" : ""}" onclick="document.querySelector('.etiqueta-seccion-colapsable .etiqueta-seccion-header')?.click()">
 <span class="etiqueta-plantilla-card-preview etiqueta-plantilla-card-preview-personalizada">${iconoUISVG("edit")}</span>
 <strong>Personalizada</strong>
 </button>
 `;
}

function aplicarPlantillaPredisenoEtiqueta(indice) {
 const preset = PLANTILLAS_ETIQUETAS_POR_DEFECTO[indice];
 if (!preset) return;

 disenoActualEtiquetas = { ...preset };
 // No toca tamanoPapelActual -- plantilla y papel son ejes
 // independientes cuando se trata de un preset predisenado.

 renderPlantillasPredisenoEtiquetas();
 renderPanelInformacionEtiqueta();
 renderPanelFormatoEtiqueta();
}

function aplicarPlantillaGuardadaEtiqueta(id) {
 const plantilla = plantillasEtiquetasGuardadas.find(p => p.id === id);
 if (!plantilla) return;

 disenoActualEtiquetas = {
 nombre: plantilla.nombre,
 anchoMm: plantilla.anchoMm, altoMm: plantilla.altoMm, columnas: plantilla.columnas,
 margenMm: plantilla.margenMm, espaciadoMm: plantilla.espaciadoMm,
 mostrarNombre: plantilla.mostrarNombre, mostrarCodigoBarras: plantilla.mostrarCodigoBarras,
 mostrarNumeroCodigo: plantilla.mostrarNumeroCodigo, mostrarPrecio: plantilla.mostrarPrecio,
 mostrarMarca: plantilla.mostrarMarca, mostrarCategoria: plantilla.mostrarCategoria
 };

 // A diferencia de un preset predisenado, una plantilla guardada por
 // el usuario SI trae su propio tamano de papel -- lo que guardo es lo
 // que se vuelve a aplicar.
 tamanoPapelActual = { nombre: plantilla.papelNombre, anchoMm: plantilla.papelAnchoMm, altoMm: plantilla.papelAltoMm };

 renderPlantillasPredisenoEtiquetas();
 renderPanelInformacionEtiqueta();
 renderPanelFormatoEtiqueta();
}

async function cargarPlantillasEtiquetas() {
 try {
 const respuesta =
 await fetch("/etiquetas-plantillas");

 const datos =
 await respuesta.json().catch(() => ({}));

 plantillasEtiquetasGuardadas = (respuesta.ok && datos.ok) ? datos.plantillas : [];
 } catch (error) {
 plantillasEtiquetasGuardadas = [];
 }

 renderMisPlantillasGuardadas();
}

function renderMisPlantillasGuardadas() {
 const grid =
 document.getElementById("etiquetaMisPlantillasGrid");

 if (!grid) return;

 if (plantillasEtiquetasGuardadas.length === 0) {
 grid.innerHTML = `<p class="encargo-items-vacio">Aún no guardas ninguna plantilla propia.</p>`;
 return;
 }

 grid.innerHTML = plantillasEtiquetasGuardadas.map(plantilla => `
 <div class="etiqueta-plantilla-card etiqueta-plantilla-card-guardada">
 <button type="button" class="etiqueta-plantilla-card-quitar" onclick="borrarPlantillaGuardadaEtiqueta(${plantilla.id})" title="Borrar plantilla">&times;</button>
 <button type="button" class="etiqueta-plantilla-card-cuerpo" onclick="aplicarPlantillaGuardadaEtiqueta(${plantilla.id})">
 <span class="etiqueta-plantilla-card-preview" style="${estiloMiniaturaEtiqueta(plantilla)}">${construirUnaEtiquetaHtml(ITEM_EJEMPLO_PLANTILLA_ETIQUETA, plantilla)}</span>
 <strong>${escaparPOS(plantilla.nombre)}</strong>
 <small>${escaparPOS(plantilla.papelNombre || "A4")}</small>
 </button>
 </div>
 `).join("");
}

async function borrarPlantillaGuardadaEtiqueta(id) {
 const confirmado = await confirmarPOS("Esta plantilla se va a borrar. ¿Continuar?", "Borrar plantilla", "peligro");
 if (!confirmado) return;

 try {
 const respuesta =
 await fetch(`/etiquetas-plantillas/${id}`, { method: "DELETE" });

 const datos =
 await respuesta.json().catch(() => ({}));

 if (!respuesta.ok || !datos.ok) {
 alertaPOS(datos.error || "No se pudo borrar la plantilla.", "Error", "peligro");
 return;
 }

 cargarPlantillasEtiquetas();
 } catch (error) {
 alertaPOS("No se pudo borrar la plantilla. Revisa tu conexión.", "Error", "peligro");
 }
}

async function guardarPlantillaEtiquetaActual() {
 const nombre =
 document.getElementById("etiquetaGuardarPlantillaNombre")?.value.trim();

 if (!nombre) {
 alertaPOS("Escribe el nombre de la plantilla.", "Falta el nombre", "alerta");
 return;
 }

 try {
 const respuesta =
 await fetch("/etiquetas-plantillas", {
 method: "POST",
 headers: { "Content-Type": "application/json" },
 body: JSON.stringify({
 nombre,
 diseno: {
 ...disenoActualEtiquetas,
 papelNombre: tamanoPapelActual.nombre,
 papelAnchoMm: tamanoPapelActual.anchoMm,
 papelAltoMm: tamanoPapelActual.altoMm
 }
 })
 });

 const datos =
 await respuesta.json().catch(() => ({}));

 if (!respuesta.ok || !datos.ok) {
 alertaPOS(datos.error || "No se pudo guardar la plantilla.", "Error", "peligro");
 return;
 }

 alertaPOS("Plantilla guardada.", "Listo", "exito");

 const campoNombre = document.getElementById("etiquetaGuardarPlantillaNombre");
 if (campoNombre) campoNombre.value = "";

 cargarPlantillasEtiquetas();
 } catch (error) {
 alertaPOS("No se pudo guardar la plantilla. Revisa tu conexión.", "Error", "peligro");
 }
}

// --- Informacion de la etiqueta / Formato ---

function renderPanelInformacionEtiqueta() {
 const panel =
 document.getElementById("etiquetaPanelInformacion");

 if (!panel || !disenoActualEtiquetas) return;

 const d = disenoActualEtiquetas;

 panel.innerHTML = `
 <div class="etiqueta-diseno-checks">
 <label><input type="checkbox" ${d.mostrarNombre ? "checked" : ""} onchange="actualizarDisenoEtiqueta('mostrarNombre', this.checked)"> Nombre del producto</label>
 <label><input type="checkbox" ${d.mostrarCodigoBarras ? "checked" : ""} onchange="actualizarDisenoEtiqueta('mostrarCodigoBarras', this.checked)"> Código de barras</label>
 <label><input type="checkbox" ${d.mostrarNumeroCodigo ? "checked" : ""} onchange="actualizarDisenoEtiqueta('mostrarNumeroCodigo', this.checked)"> Número del código</label>
 <label><input type="checkbox" ${d.mostrarPrecio ? "checked" : ""} onchange="actualizarDisenoEtiqueta('mostrarPrecio', this.checked)"> Precio</label>
 <label><input type="checkbox" ${d.mostrarMarca ? "checked" : ""} onchange="actualizarDisenoEtiqueta('mostrarMarca', this.checked)"> Marca</label>
 <label><input type="checkbox" ${d.mostrarCategoria ? "checked" : ""} onchange="actualizarDisenoEtiqueta('mostrarCategoria', this.checked)"> Categoría</label>
 </div>
 `;
}

// Fuente unica de verdad de cuantas filas caben en una pagina --
// compartida con la Etapa 3 (paginacion real de la vista previa).
function filasPorPaginaEtiqueta(diseno, papel) {
 if (papel.altoMm == null) return Infinity; // Rollo continuo

 const altoUtil = Math.max(0, papel.altoMm - diseno.margenMm * 2);
 const filas = Math.floor((altoUtil + diseno.espaciadoMm) / (diseno.altoMm + diseno.espaciadoMm));

 return Math.max(1, filas);
}

function renderPanelFormatoEtiqueta() {
 const panel =
 document.getElementById("etiquetaPanelFormato");

 if (!panel || !disenoActualEtiquetas || !tamanoPapelActual) return;

 const d = disenoActualEtiquetas;
 const papel = tamanoPapelActual;
 const filas = filasPorPaginaEtiqueta(d, papel);
 const esRollo = filas === Infinity;
 const porPagina = esRollo ? d.columnas : filas * d.columnas;

 panel.innerHTML = `
 <div class="encargo-form-fila">
 <label>Ancho de etiqueta (mm)<input type="number" min="10" step="1" value="${d.anchoMm}" onchange="actualizarDisenoEtiqueta('anchoMm', this.value, true)"></label>
 <label>Alto de etiqueta (mm)<input type="number" min="10" step="1" value="${d.altoMm}" onchange="actualizarDisenoEtiqueta('altoMm', this.value, true)"></label>
 </div>
 <div class="encargo-form-fila">
 <label>Columnas<input type="number" min="1" max="8" step="1" value="${d.columnas}" onchange="actualizarDisenoEtiqueta('columnas', this.value, true)"></label>
 <label>Margen (mm)<input type="number" min="0" step="1" value="${d.margenMm}" onchange="actualizarDisenoEtiqueta('margenMm', this.value, true)"></label>
 <label>Espaciado (mm)<input type="number" min="0" step="1" value="${d.espaciadoMm}" onchange="actualizarDisenoEtiqueta('espaciadoMm', this.value, true)"></label>
 </div>

 <h4>Papel</h4>
 <div class="etiqueta-papel-opciones">
 ${TAMANOS_PAPEL_ETIQUETAS.map(opcion => `
 <button type="button" class="etiqueta-papel-boton ${papel.nombre === opcion.nombre ? "activo" : ""}" onclick="actualizarPapelEtiqueta('${opcion.nombre}')">${escaparPOS(opcion.nombre)}</button>
 `).join("")}
 </div>
 ${esRollo ? `
 <div class="encargo-form-fila">
 <label>Ancho del rollo (mm)<input type="number" min="20" step="1" value="${papel.anchoMm}" onchange="actualizarPapelPersonalizadoEtiqueta('anchoMm', this.value)"></label>
 </div>
 ` : ""}

 <p class="etiqueta-filas-indicador">
 ${esRollo
 ? `Rollo continuo — ${d.columnas} columna(s), sin límite de largo.`
 : `≈ ${filas} fila(s) × ${d.columnas} columna(s) = ${porPagina} etiquetas por hoja ${escaparPOS(papel.nombre)}.`}
 </p>
 `;
}

function actualizarDisenoEtiqueta(campo, valor, esNumero) {
 disenoActualEtiquetas[campo] = esNumero ? Math.max(1, Number(valor) || 1) : Boolean(valor);
 disenoActualEtiquetas.nombre = "Personalizada";

 renderPlantillasPredisenoEtiquetas();
 renderPanelFormatoEtiqueta();
}

function actualizarPapelEtiqueta(nombrePapel) {
 const preset = TAMANOS_PAPEL_ETIQUETAS.find(p => p.nombre === nombrePapel);
 if (!preset) return;

 tamanoPapelActual = { ...preset };
 renderPanelFormatoEtiqueta();
}

function actualizarPapelPersonalizadoEtiqueta(campo, valor) {
 tamanoPapelActual[campo] = Math.max(1, Number(valor) || 1);
 renderPanelFormatoEtiqueta();
}

// =====================================================================
// ETAPA 3 -- Vista previa (paginada, con zoom)
// =====================================================================

function instanciasEtiquetasAImprimir() {
 const instancias = [];

 itemsCodigosBarras.forEach(item => {
 const producto = productoParaEtiqueta(item.productoId);
 if (!producto) return; // producto borrado desde que se guardo la lista -- se omite, no truena

 for (let copia = 0; copia < (item.cantidad || 0); copia++) {
 instancias.push(producto);
 }
 });

 return instancias;
}

function construirPaginasVistaPreviaEtiquetas() {
 const instancias = instanciasEtiquetasAImprimir();
 const diseno = disenoActualEtiquetas;
 const papel = tamanoPapelActual;
 const filas = filasPorPaginaEtiqueta(diseno, papel);

 if (filas === Infinity) {
 return instancias.length ? [instancias] : [];
 }

 const porPagina = Math.max(1, filas * diseno.columnas);
 const paginas = [];

 for (let inicio = 0; inicio < instancias.length; inicio += porPagina) {
 paginas.push(instancias.slice(inicio, inicio + porPagina));
 }

 return paginas;
}

function renderEtapaVistaPreviaEtiquetas() {
 const seccion =
 document.querySelector('#pantallaCodigosBarras [data-etiqueta-etapa="2"]');

 if (!seccion) return;

 vistaPreviaEtiquetasPaginas = construirPaginasVistaPreviaEtiquetas();
 paginaVistaPreviaActual = 0;

 seccion.innerHTML = `
 <div class="etiqueta-preview-toolbar">
 <div class="etiqueta-preview-paginacion">
 <button type="button" id="etiquetaPreviaAnterior" onclick="irPaginaAnteriorEtiquetas()">${iconoUISVG("chevronLeft")}</button>
 <span id="etiquetaPreviaPaginaTexto"></span>
 <button type="button" id="etiquetaPreviaSiguiente" onclick="irPaginaSiguienteEtiquetas()">${iconoUISVG("chevronRight")}</button>
 </div>
 <div class="etiqueta-preview-zoom">
 <button type="button" onclick="cambiarZoomVistaPreviaEtiquetas(-0.1)">${iconoUISVG("zoomOut")}</button>
 <input type="range" id="etiquetaZoomSlider" min="0.5" max="2" step="0.1" value="${zoomVistaPreviaEtiquetas}" oninput="actualizarZoomVistaPreviaEtiquetas(this.value)">
 <button type="button" onclick="cambiarZoomVistaPreviaEtiquetas(0.1)">${iconoUISVG("zoomIn")}</button>
 <span id="etiquetaZoomTexto"></span>
 </div>
 <span class="etiqueta-preview-papel-badge">${escaparPOS(tamanoPapelActual.nombre)}</span>
 </div>
 <div class="etiqueta-preview-scroll">
 <div id="etiquetaPreviaHojaContenedor"></div>
 </div>
 `;

 renderPaginaVistaPreviaEtiquetas();
}

function renderPaginaVistaPreviaEtiquetas() {
 const contenedor = document.getElementById("etiquetaPreviaHojaContenedor");
 const textoPagina = document.getElementById("etiquetaPreviaPaginaTexto");
 const textoZoom = document.getElementById("etiquetaZoomTexto");
 const botonAnterior = document.getElementById("etiquetaPreviaAnterior");
 const botonSiguiente = document.getElementById("etiquetaPreviaSiguiente");

 if (!contenedor) return;

 const totalPaginas = vistaPreviaEtiquetasPaginas.length;

 if (textoPagina) textoPagina.textContent = totalPaginas ? `Página ${paginaVistaPreviaActual + 1} de ${totalPaginas}` : "Sin etiquetas";
 if (textoZoom) textoZoom.textContent = `${Math.round(zoomVistaPreviaEtiquetas * 100)}%`;
 if (botonAnterior) botonAnterior.disabled = paginaVistaPreviaActual === 0;
 if (botonSiguiente) botonSiguiente.disabled = paginaVistaPreviaActual >= totalPaginas - 1;

 if (totalPaginas === 0) {
 contenedor.innerHTML = `<p class="encargo-items-vacio">Agrega productos en la Etapa 1 para ver la vista previa.</p>`;
 return;
 }

 const papel = tamanoPapelActual;
 const pagina = vistaPreviaEtiquetasPaginas[paginaVistaPreviaActual];
 const esRollo = papel.altoMm == null;

 contenedor.innerHTML = `
 <div class="etiqueta-preview-hoja" style="width:${papel.anchoMm}mm;${esRollo ? "" : `height:${papel.altoMm}mm;`}transform:scale(${zoomVistaPreviaEtiquetas});">
 ${construirHtmlGridEtiquetas(pagina, disenoActualEtiquetas)}
 </div>
 `;
}

function irPaginaAnteriorEtiquetas() {
 if (paginaVistaPreviaActual <= 0) return;
 paginaVistaPreviaActual -= 1;
 renderPaginaVistaPreviaEtiquetas();
}

function irPaginaSiguienteEtiquetas() {
 if (paginaVistaPreviaActual >= vistaPreviaEtiquetasPaginas.length - 1) return;
 paginaVistaPreviaActual += 1;
 renderPaginaVistaPreviaEtiquetas();
}

function cambiarZoomVistaPreviaEtiquetas(delta) {
 actualizarZoomVistaPreviaEtiquetas(zoomVistaPreviaEtiquetas + delta);
}

function actualizarZoomVistaPreviaEtiquetas(valor) {
 zoomVistaPreviaEtiquetas = Math.max(0.5, Math.min(2, Number(valor) || 1));

 const slider = document.getElementById("etiquetaZoomSlider");
 if (slider) slider.value = zoomVistaPreviaEtiquetas;

 renderPaginaVistaPreviaEtiquetas();
}

// =====================================================================
// ETAPA 4 -- Imprimir
// =====================================================================

function renderEtapaImprimirEtiquetas() {
 const seccion =
 document.querySelector('#pantallaCodigosBarras [data-etiqueta-etapa="3"]');

 if (!seccion) return;

 const totalEtiquetas = totalEtiquetasEnLista();
 const totalProductos = itemsCodigosBarras.length;

 const sinCodigo = itemsCodigosBarras.filter(item => {
 const producto = productoParaEtiqueta(item.productoId);
 return producto && !producto.codigo;
 }).length;

 seccion.innerHTML = `
 <div class="etiqueta-resumen-final">
 <h3>Todo listo para imprimir</h3>
 <div class="etiqueta-resumen-tarjetas">
 <div class="etiqueta-resumen-tarjeta"><strong>${totalEtiquetas}</strong><span>etiqueta(s)</span></div>
 <div class="etiqueta-resumen-tarjeta"><strong>${totalProductos}</strong><span>producto(s)</span></div>
 <div class="etiqueta-resumen-tarjeta"><strong>${escaparPOS(disenoActualEtiquetas.nombre || "Personalizada")}</strong><span>plantilla</span></div>
 <div class="etiqueta-resumen-tarjeta"><strong>${escaparPOS(tamanoPapelActual.nombre)}</strong><span>papel</span></div>
 </div>
 ${sinCodigo > 0 ? `<p class="etiqueta-resumen-aviso">${sinCodigo} producto(s) sin código se van a imprimir sin barras.</p>` : ""}
 <button type="button" class="etiqueta-btn-imprimir-final" onclick="imprimirEtiquetas()">${iconoUISVG("printer")} Imprimir etiquetas</button>
 </div>
 `;
}

// =====================================================================
// Render de etiqueta individual -- compartido por Etapa 2 (miniaturas),
// Etapa 3 (vista previa) y la impresion final. Siempre estilos inline
// (nunca clases CSS): la ventana de impresion no carga el stylesheet
// de la app.
// =====================================================================

function construirUnaEtiquetaHtml(item, diseno) {
 let barcodeHtml = "";

 if (diseno.mostrarCodigoBarras && item.codigo && typeof JsBarcode === "function") {
 const svg =
 document.createElementNS("http://www.w3.org/2000/svg", "svg");

 try {
 JsBarcode(svg, item.codigo, {
 format: "CODE128",
 width: 1.4,
 height: Math.max(20, diseno.altoMm * 1.2),
 fontSize: 10,
 margin: 2,
 displayValue: diseno.mostrarNumeroCodigo
 });

 barcodeHtml = svg.outerHTML;
 } catch (error) {
 console.warn("No se pudo generar codigo de barras para", item.codigo, error);
 }
 }

 return `
 <div class="etiqueta-producto" style="width:${diseno.anchoMm}mm;height:${diseno.altoMm}mm;border:1px solid #d0d5dd;border-radius:6px;padding:4px;text-align:center;overflow:hidden;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px;">
 ${diseno.mostrarNombre ? `<strong style="font-size:11px;line-height:1.15;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:100%;">${escaparPOS(item.nombre)}</strong>` : ""}
 ${diseno.mostrarMarca && item.marca ? `<small style="font-size:9px;color:#475467;">${escaparPOS(item.marca)}</small>` : ""}
 ${diseno.mostrarCategoria && item.categoria ? `<small style="font-size:9px;color:#475467;">${escaparPOS(item.categoria)}</small>` : ""}
 ${barcodeHtml ? `<div class="etiqueta-barcode">${barcodeHtml}</div>` : (diseno.mostrarCodigoBarras ? `<small style="font-size:9px;color:#b42318;">Sin código</small>` : "")}
 ${diseno.mostrarPrecio ? `<span style="font-size:12px;font-weight:700;">${typeof dinero === "function" ? dinero(item.precio || 0) : item.precio}</span>` : ""}
 </div>
 `;
}

function construirHtmlGridEtiquetas(productos, diseno) {
 const etiquetas =
 productos.map(producto => construirUnaEtiquetaHtml(producto, diseno)).join("");

 return `<div class="hoja-etiquetas" style="display:grid;grid-template-columns:repeat(${diseno.columnas},1fr);gap:${diseno.espaciadoMm}mm;padding:${diseno.margenMm}mm;">${etiquetas}</div>`;
}

function imprimirEtiquetas() {
 if (itemsCodigosBarras.length === 0) {
 alertaPOS("Agrega al menos un producto a tu lista.", "Sin productos", "alerta");
 return;
 }

 const paginas = construirPaginasVistaPreviaEtiquetas();

 if (paginas.length === 0) {
 alertaPOS("No hay etiquetas para imprimir.", "Sin productos", "alerta");
 return;
 }

 const sinCodigo = itemsCodigosBarras.filter(item => {
 const producto = productoParaEtiqueta(item.productoId);
 return producto && !producto.codigo;
 }).length;

 const negocio =
 (typeof configuracionNegocio === "function" ? configuracionNegocio() : {}) || {};

 const papel = tamanoPapelActual;

 const paginasHtml =
 paginas.map(pagina => `<div class="hoja-etiquetas-pagina">${construirHtmlGridEtiquetas(pagina, disenoActualEtiquetas)}</div>`).join("");

 const ventana =
 window.open("", "_blank", "width=900,height=720");

 if (!ventana) {
 alertaPOS("Tu navegador bloqueó la ventana de impresión. Permite ventanas emergentes para Nexo POS e intenta de nuevo.", "Ventana bloqueada", "alerta");
 return;
 }

 ventana.document.write(`
 <html>
 <head>
 <title>Etiquetas - ${escaparPOS(negocio.nombre || "")}</title>
 <style>
 body{font-family:Arial,sans-serif;color:#111827;padding:0;margin:0;}
 .encabezado-impresion{padding:14px 20px 0;font-size:11px;color:#475467;}
 .etiqueta-producto{page-break-inside:avoid;}
 .hoja-etiquetas-pagina{page-break-after:always;}
 .hoja-etiquetas-pagina:last-child{page-break-after:auto;}
 @page{size:${papel.anchoMm}mm${papel.altoMm != null ? ` ${papel.altoMm}mm` : ""};margin:0;}
 @media print{
 .encabezado-impresion{display:none;}
 .etiqueta-producto{break-inside:avoid;}
 }
 </style>
 </head>
 <body>
 <p class="encabezado-impresion">Imprime a escala 100% (sin "ajustar a página") para que el tamaño real coincida con lo elegido.${sinCodigo ? ` ${sinCodigo} producto(s) sin código se imprimen sin barras.` : ""}</p>
 ${paginasHtml}
 <script>window.print();</script>
 </body>
 </html>
 `);
 ventana.document.close();
}
