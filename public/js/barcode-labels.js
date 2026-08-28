// Editor de codigos de barras / etiquetas -- reemplaza a la vieja
// imprimirCodigosBarrasInventario() (bolteada a Inventario, sin lista
// propia, sin plantillas, productos sin codigo se saltaban en
// silencio). Reusa /listas-producto tal cual para armar/guardar la
// lista de productos a imprimir -- aqui solo vive lo genuinamente
// nuevo: el armador visual, la vista previa en vivo, las plantillas de
// diseno, y la generacion de codigo interno.

let itemsCodigosBarras = [];         // {productoId, nombre, codigo, precio, marca, categoria, cantidad}
let disenoActualEtiquetas = null;
let plantillasEtiquetasGuardadas = [];
let vistaCategoriaEtiquetas = null;  // null = departamentos; {departamento} = subcategorias; {departamento, subcategoria} = productos

const PLANTILLAS_ETIQUETAS_POR_DEFECTO = [
 { nombre: "Pequena", anchoMm: 40, altoMm: 20, columnas: 4, margenMm: 5, espaciadoMm: 2, mostrarNombre: true, mostrarCodigoBarras: true, mostrarNumeroCodigo: false, mostrarPrecio: false, mostrarMarca: false, mostrarCategoria: false },
 { nombre: "Precio + codigo", anchoMm: 50, altoMm: 25, columnas: 3, margenMm: 5, espaciadoMm: 3, mostrarNombre: true, mostrarCodigoBarras: true, mostrarNumeroCodigo: true, mostrarPrecio: true, mostrarMarca: false, mostrarCategoria: false },
 { nombre: "Grande", anchoMm: 70, altoMm: 40, columnas: 2, margenMm: 8, espaciadoMm: 4, mostrarNombre: true, mostrarCodigoBarras: true, mostrarNumeroCodigo: true, mostrarPrecio: true, mostrarMarca: true, mostrarCategoria: true },
 { nombre: "Solo codigo", anchoMm: 40, altoMm: 20, columnas: 4, margenMm: 5, espaciadoMm: 2, mostrarNombre: false, mostrarCodigoBarras: true, mostrarNumeroCodigo: true, mostrarPrecio: false, mostrarMarca: false, mostrarCategoria: false },
 { nombre: "Anaquel", anchoMm: 60, altoMm: 30, columnas: 3, margenMm: 5, espaciadoMm: 3, mostrarNombre: true, mostrarCodigoBarras: true, mostrarNumeroCodigo: true, mostrarPrecio: true, mostrarMarca: false, mostrarCategoria: false }
];

function mapearProductoAItemEtiqueta(producto, cantidad) {
 return {
 productoId: producto.id,
 nombre: producto.nombre,
 codigo: producto.codigo || "",
 precio: producto.precio || 0,
 marca: producto.marca || "",
 categoria: producto.categoria || "",
 cantidad: cantidad > 0 ? cantidad : 1
 };
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
 actualizarTopbarContexto("Codigos de barras", "Arma tu lista y disena la hoja de etiquetas", "codigos-barras");
 }

 itemsCodigosBarras = (opciones.productosIniciales || []).map(p => mapearProductoAItemEtiqueta(p, 1));
 disenoActualEtiquetas = { ...PLANTILLAS_ETIQUETAS_POR_DEFECTO[1] };
 vistaCategoriaEtiquetas = null;

 pantalla.innerHTML = `
 <div class="encargos-shell">
 <div class="encargos-header">
 <div>
 <h2>Codigos de barras</h2>
 <p>Arma una lista de productos buscando o por categoria, disena la hoja y imprime tus etiquetas.</p>
 </div>
 </div>

 <div class="encargos-grid">
 <section class="encargos-panel">
 <h3>Agregar productos</h3>

 <div class="encargo-add-row">
 <label>Producto
 <input id="etiquetaItemNombre" list="etiquetaItemLista" placeholder="Nombre del producto">
 <datalist id="etiquetaItemLista"></datalist>
 </label>
 <label>Cant.
 <input id="etiquetaItemCantidad" type="number" step="1" min="1" placeholder="1">
 </label>
 <button type="button" class="btn-encargo-agregar" onclick="agregarItemBusquedaEtiqueta()">Agregar</button>
 </div>

 <button type="button" class="btn-encargo-secundario encargo-btn-full" onclick="alternarCategoriasEtiquetas()">+ Agregar desde categoria</button>
 <div id="etiquetaCategoriasPanel" hidden></div>

 <div class="encargo-lista-cargar-fila">
 <label>Cargar desde una lista guardada
 <select id="etiquetaListaGuardadaSelect" onchange="cargarListaGuardadaEnEtiquetas(this.value)">
 <option value="">Elige una lista...</option>
 </select>
 </label>
 </div>

 <h4>Tu lista</h4>
 <div id="etiquetaTablaItems"></div>

 <div class="etiqueta-guardar-fila">
 <label>Nombre para guardar esta lista
 <input id="etiquetaGuardarListaNombre" placeholder="Opcional">
 </label>
 <button type="button" class="btn-encargo-secundario" onclick="guardarListaDesdeEtiquetas()">Guardar como lista</button>
 </div>
 </section>

 <section class="encargos-panel">
 <h3>Diseno</h3>
 <div id="etiquetaPanelDiseno"></div>

 <h4>Mis plantillas</h4>
 <div id="etiquetaListaPlantillas"></div>
 <div class="etiqueta-guardar-fila">
 <label>Guardar diseno actual como
 <input id="etiquetaGuardarPlantillaNombre" placeholder="Nombre de la plantilla">
 </label>
 <button type="button" class="btn-encargo-agregar" onclick="guardarPlantillaEtiquetaActual()">Guardar plantilla</button>
 </div>
 </section>
 </div>

 <section class="encargos-panel etiqueta-preview-panel">
 <div class="encargos-panel-titulo-fila">
 <h3>Vista previa</h3>
 <button type="button" class="btn-encargo-primario" onclick="imprimirEtiquetas()">Imprimir</button>
 </div>
 <div id="etiquetaVistaPrevia" class="etiqueta-preview-scroll"></div>
 </section>
 </div>
 `;

 llenarDatalistProductosCodigosBarras();
 renderTablaItemsCodigosBarras();
 renderPanelDisenoEtiquetas();
 renderVistaPreviaEtiquetas();
 renderCategoriasEtiquetas();
 await cargarListasGuardadasEnSelectEtiquetas();
 await cargarPlantillasEtiquetas();
}

// --- Buscar y agregar ---

function llenarDatalistProductosCodigosBarras() {
 const lista =
 document.getElementById("etiquetaItemLista");

 if (!lista) return;

 lista.innerHTML =
 (typeof todosProductos !== "undefined" ? todosProductos : [])
 .slice(0, 500)
 .map(producto => `<option value="${escaparPOS(producto.nombre)}"></option>`)
 .join("");
}

function agregarProductoATablaEtiquetas(producto, cantidad) {
 const existente =
 itemsCodigosBarras.find(item => Number(item.productoId) === Number(producto.id));

 if (existente) {
 existente.cantidad += cantidad > 0 ? cantidad : 1;
 } else {
 itemsCodigosBarras.push(mapearProductoAItemEtiqueta(producto, cantidad));
 }
}

function agregarItemBusquedaEtiqueta() {
 const nombreInput =
 document.getElementById("etiquetaItemNombre");

 const nombre =
 nombreInput?.value.trim();

 if (!nombre) {
 nombreInput?.focus();
 return;
 }

 const producto =
 (typeof todosProductos !== "undefined" ? todosProductos : [])
 .find(item => item.nombre?.trim().toLowerCase() === nombre.toLowerCase());

 if (!producto) {
 alertaPOS("Ese producto no esta en tu inventario. Escribe el nombre exacto o elige una de las sugerencias.", "Producto no encontrado", "alerta");
 return;
 }

 const cantidad =
 Number(document.getElementById("etiquetaItemCantidad")?.value || 1);

 agregarProductoATablaEtiquetas(producto, cantidad);

 nombreInput.value = "";
 document.getElementById("etiquetaItemCantidad").value = "";
 nombreInput.focus();

 renderTablaItemsCodigosBarras();
 renderVistaPreviaEtiquetas();
}

function quitarItemEtiqueta(indice) {
 itemsCodigosBarras.splice(indice, 1);
 renderTablaItemsCodigosBarras();
 renderVistaPreviaEtiquetas();
}

function cambiarCantidadItemEtiqueta(indice, valor) {
 const cantidad =
 Number(valor);

 itemsCodigosBarras[indice].cantidad =
 cantidad > 0 ? cantidad : 1;

 renderVistaPreviaEtiquetas();
}

async function generarCodigoProductoEtiqueta(indice) {
 const item =
 itemsCodigosBarras[indice];

 if (!item) return;

 try {
 const respuesta =
 await fetch(`/productos/${item.productoId}/generar-codigo`, { method: "POST" });

 const datos =
 await respuesta.json().catch(() => ({}));

 if (!respuesta.ok || !datos.ok) {
 alertaPOS(datos.error || "No se pudo generar el codigo.", "Error", "peligro");
 return;
 }

 item.codigo = datos.codigo;

 // El resto de la app (busqueda, escaneo en caja) usa el cache
 // global todosProductos -- sin esto, el codigo nuevo no se ve
 // hasta recargar la pagina.
 if (typeof todosProductos !== "undefined") {
 const productoCache =
 todosProductos.find(p => Number(p.id) === Number(item.productoId));

 if (productoCache) productoCache.codigo = datos.codigo;
 }

 renderTablaItemsCodigosBarras();
 renderVistaPreviaEtiquetas();
 } catch (error) {
 alertaPOS("No se pudo generar el codigo. Revisa tu conexion.", "Error", "peligro");
 }
}

function renderTablaItemsCodigosBarras() {
 const contenedor =
 document.getElementById("etiquetaTablaItems");

 if (!contenedor) return;

 if (itemsCodigosBarras.length === 0) {
 contenedor.innerHTML = `<p class="encargo-items-vacio">Todavia no agregas productos.</p>`;
 return;
 }

 contenedor.innerHTML = `
 <table class="encargo-tabla-items etiqueta-tabla-arrastrable">
 <thead>
 <tr><th></th><th>Producto</th><th>Codigo</th><th>Etiquetas</th><th></th></tr>
 </thead>
 <tbody>
 ${itemsCodigosBarras.map((item, indice) => `
 <tr draggable="true"
 ondragstart="onArrastrarInicioItemEtiqueta(event, ${indice})"
 ondragover="onArrastrarSobreItemEtiqueta(event)"
 ondrop="onSoltarItemEtiqueta(event, ${indice})">
 <td class="etiqueta-fila-agarradera" title="Arrastra para reordenar">&#9776;</td>
 <td>${escaparPOS(item.nombre)}</td>
 <td>${item.codigo
 ? escaparPOS(item.codigo)
 : `<button type="button" class="btn-encargo-secundario" onclick="generarCodigoProductoEtiqueta(${indice})">Generar codigo</button>`}</td>
 <td><input type="number" step="1" min="1" value="${item.cantidad}" class="lista-detalle-cantidad-input" onchange="cambiarCantidadItemEtiqueta(${indice}, this.value)"></td>
 <td><button type="button" class="btn-encargo-quitar" onclick="quitarItemEtiqueta(${indice})">Quitar</button></td>
 </tr>
 `).join("")}
 </tbody>
 </table>
 `;
}

// --- Reordenar arrastrando ---

let indiceArrastradoEtiqueta = null;

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

 renderTablaItemsCodigosBarras();
 renderVistaPreviaEtiquetas();
}

// --- Agregar por categoria ---

function alternarCategoriasEtiquetas() {
 const panel =
 document.getElementById("etiquetaCategoriasPanel");

 if (!panel) return;

 panel.hidden = !panel.hidden;

 if (!panel.hidden) {
 vistaCategoriaEtiquetas = null;
 renderCategoriasEtiquetas();
 }
}

async function renderCategoriasEtiquetas() {
 const panel =
 document.getElementById("etiquetaCategoriasPanel");

 if (!panel || panel.hidden) return;

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
 panel.innerHTML = `<p class="encargo-items-vacio">Este negocio todavia no tiene categorias con productos.</p>`;
 return;
 }

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

 panel.dataset.nodos = "1";
 panel._nodosCategoriasEtiquetas = nodos;
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

 panel.innerHTML = `
 <button type="button" class="btn-encargo-secundario" onclick="${subcategoria === departamento ? "volverDepartamentosEtiquetas()" : "abrirDepartamentoDeVueltaEtiquetas()"}">&larr; ${escaparPOS(subcategoria)}</button>
 ${productos.length === 0
 ? `<p class="encargo-items-vacio">No hay productos en esta categoria.</p>`
 : `
 <table class="encargo-tabla-items">
 <thead><tr><th></th><th>Producto</th><th>Cant.</th></tr></thead>
 <tbody>
 ${productos.map((p, i) => `
 <tr>
 <td><input type="checkbox" id="etiquetaCatChk${i}"></td>
 <td>${escaparPOS(p.nombre)}</td>
 <td><input type="number" step="1" min="1" value="1" id="etiquetaCatCant${i}" style="width:60px"></td>
 </tr>
 `).join("")}
 </tbody>
 </table>
 <button type="button" class="btn-encargo-primario encargo-btn-full" onclick="agregarSeleccionadosCategoriaEtiquetas()">Agregar seleccionados</button>
 `}
 `;

 panel._productosCategoriaEtiquetas = productos;
}

function abrirDepartamentoDeVueltaEtiquetas() {
 vistaCategoriaEtiquetas = {
 departamento: vistaCategoriaEtiquetas.departamento,
 subcategorias: (typeof nodosCategoriasInventario === "function" ? nodosCategoriasInventario() : [])
 .find(n => n.nombre === vistaCategoriaEtiquetas.departamento)?.subcategorias || []
 };

 renderCategoriasEtiquetas();
}

function agregarSeleccionadosCategoriaEtiquetas() {
 const panel =
 document.getElementById("etiquetaCategoriasPanel");

 const productos =
 panel?._productosCategoriaEtiquetas || [];

 let agregados = 0;

 productos.forEach((producto, i) => {
 const marcado =
 document.getElementById(`etiquetaCatChk${i}`)?.checked;

 if (!marcado) return;

 const cantidad =
 Number(document.getElementById(`etiquetaCatCant${i}`)?.value || 1);

 agregarProductoATablaEtiquetas(producto, cantidad);
 agregados++;
 });

 if (agregados === 0) {
 alertaPOS("Selecciona al menos un producto.", "Sin seleccion", "alerta");
 return;
 }

 renderTablaItemsCodigosBarras();
 renderVistaPreviaEtiquetas();
 alertaPOS(`Se agregaron ${agregados} producto(s) a tu lista.`, "Listo", "exito");
}

// --- Cargar / guardar como lista de productos (reusa /listas-producto) ---

async function cargarListasGuardadasEnSelectEtiquetas() {
 const select =
 document.getElementById("etiquetaListaGuardadaSelect");

 if (!select) return;

 try {
 const respuesta =
 await fetch("/listas-producto");

 const datos =
 await respuesta.json().catch(() => ({}));

 const listas =
 (respuesta.ok && datos.ok) ? datos.listas : [];

 select.innerHTML =
 '<option value="">Elige una lista...</option>' +
 listas.map(item => `<option value="${item.id}">${escaparPOS(item.nombre)} (${item.totalItems})</option>`).join("");
 } catch (error) {
 // silencioso -- el select simplemente se queda vacio
 }
}

async function cargarListaGuardadaEnEtiquetas(listaId) {
 if (!listaId) return;

 try {
 const respuesta =
 await fetch(`/listas-producto/${listaId}`);

 const datos =
 await respuesta.json().catch(() => ({}));

 if (!respuesta.ok || !datos.ok) {
 alertaPOS(datos.error || "No se pudo cargar la lista.", "Error", "peligro");
 return;
 }

 itemsCodigosBarras = datos.lista.items.map(item => ({
 productoId: item.productoId,
 nombre: item.nombre,
 codigo: item.codigo || "",
 precio: item.precio || 0,
 marca: "",
 categoria: "",
 cantidad: item.cantidad
 }));

 renderTablaItemsCodigosBarras();
 renderVistaPreviaEtiquetas();
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

 alertaPOS("Lista guardada. Ya la puedes reusar desde \"Listas de productos\" o desde aqui mismo.", "Listo", "exito");
 await cargarListasGuardadasEnSelectEtiquetas();
 } catch (error) {
 alertaPOS("No se pudo guardar la lista. Revisa tu conexion.", "Error", "peligro");
 }
}

// --- Diseno + plantillas ---

function renderPanelDisenoEtiquetas() {
 const panel =
 document.getElementById("etiquetaPanelDiseno");

 if (!panel || !disenoActualEtiquetas) return;

 const d = disenoActualEtiquetas;

 panel.innerHTML = `
 <div class="encargo-form-fila">
 <label>Ancho (mm)<input type="number" min="10" step="1" value="${d.anchoMm}" onchange="actualizarDisenoEtiqueta('anchoMm', this.value, true)"></label>
 <label>Alto (mm)<input type="number" min="10" step="1" value="${d.altoMm}" onchange="actualizarDisenoEtiqueta('altoMm', this.value, true)"></label>
 </div>
 <div class="encargo-form-fila">
 <label>Columnas<input type="number" min="1" max="8" step="1" value="${d.columnas}" onchange="actualizarDisenoEtiqueta('columnas', this.value, true)"></label>
 <label>Margen (mm)<input type="number" min="0" step="1" value="${d.margenMm}" onchange="actualizarDisenoEtiqueta('margenMm', this.value, true)"></label>
 <label>Espaciado (mm)<input type="number" min="0" step="1" value="${d.espaciadoMm}" onchange="actualizarDisenoEtiqueta('espaciadoMm', this.value, true)"></label>
 </div>
 <div class="etiqueta-diseno-checks">
 <label><input type="checkbox" ${d.mostrarNombre ? "checked" : ""} onchange="actualizarDisenoEtiqueta('mostrarNombre', this.checked)"> Nombre</label>
 <label><input type="checkbox" ${d.mostrarCodigoBarras ? "checked" : ""} onchange="actualizarDisenoEtiqueta('mostrarCodigoBarras', this.checked)"> Codigo de barras</label>
 <label><input type="checkbox" ${d.mostrarNumeroCodigo ? "checked" : ""} onchange="actualizarDisenoEtiqueta('mostrarNumeroCodigo', this.checked)"> Numero del codigo</label>
 <label><input type="checkbox" ${d.mostrarPrecio ? "checked" : ""} onchange="actualizarDisenoEtiqueta('mostrarPrecio', this.checked)"> Precio</label>
 <label><input type="checkbox" ${d.mostrarMarca ? "checked" : ""} onchange="actualizarDisenoEtiqueta('mostrarMarca', this.checked)"> Marca</label>
 <label><input type="checkbox" ${d.mostrarCategoria ? "checked" : ""} onchange="actualizarDisenoEtiqueta('mostrarCategoria', this.checked)"> Categoria</label>
 </div>
 `;
}

function actualizarDisenoEtiqueta(campo, valor, esNumero) {
 disenoActualEtiquetas[campo] =
 esNumero ? Math.max(1, Number(valor) || 1) : Boolean(valor);

 renderVistaPreviaEtiquetas();
}

async function cargarPlantillasEtiquetas() {
 const contenedor =
 document.getElementById("etiquetaListaPlantillas");

 if (!contenedor) return;

 try {
 const respuesta =
 await fetch("/etiquetas-plantillas");

 const datos =
 await respuesta.json().catch(() => ({}));

 plantillasEtiquetasGuardadas =
 (respuesta.ok && datos.ok && datos.plantillas.length > 0) ? datos.plantillas : PLANTILLAS_ETIQUETAS_POR_DEFECTO;

 renderListaPlantillasEtiquetas();
 } catch (error) {
 plantillasEtiquetasGuardadas = PLANTILLAS_ETIQUETAS_POR_DEFECTO;
 renderListaPlantillasEtiquetas();
 }
}

function renderListaPlantillasEtiquetas() {
 const contenedor =
 document.getElementById("etiquetaListaPlantillas");

 if (!contenedor) return;

 contenedor.innerHTML = plantillasEtiquetasGuardadas.map((plantilla, indice) => `
 <button type="button" class="btn-encargo-secundario" onclick="aplicarPlantillaEtiqueta(${indice})">${escaparPOS(plantilla.nombre)}</button>
 `).join("");
}

function aplicarPlantillaEtiqueta(indice) {
 const plantilla =
 plantillasEtiquetasGuardadas[indice];

 if (!plantilla) return;

 disenoActualEtiquetas = {
 anchoMm: plantilla.anchoMm, altoMm: plantilla.altoMm, columnas: plantilla.columnas,
 margenMm: plantilla.margenMm, espaciadoMm: plantilla.espaciadoMm,
 mostrarNombre: plantilla.mostrarNombre, mostrarCodigoBarras: plantilla.mostrarCodigoBarras,
 mostrarNumeroCodigo: plantilla.mostrarNumeroCodigo, mostrarPrecio: plantilla.mostrarPrecio,
 mostrarMarca: plantilla.mostrarMarca, mostrarCategoria: plantilla.mostrarCategoria
 };

 renderPanelDisenoEtiquetas();
 renderVistaPreviaEtiquetas();
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
 body: JSON.stringify({ nombre, diseno: disenoActualEtiquetas })
 });

 const datos =
 await respuesta.json().catch(() => ({}));

 if (!respuesta.ok || !datos.ok) {
 alertaPOS(datos.error || "No se pudo guardar la plantilla.", "Error", "peligro");
 return;
 }

 alertaPOS("Plantilla guardada.", "Listo", "exito");
 document.getElementById("etiquetaGuardarPlantillaNombre").value = "";
 await cargarPlantillasEtiquetas();
 } catch (error) {
 alertaPOS("No se pudo guardar la plantilla. Revisa tu conexion.", "Error", "peligro");
 }
}

// --- Render de etiquetas (vista previa + impresion, misma funcion) ---

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
 ${barcodeHtml ? `<div class="etiqueta-barcode">${barcodeHtml}</div>` : (diseno.mostrarCodigoBarras ? `<small style="font-size:9px;color:#b42318;">Sin codigo</small>` : "")}
 ${diseno.mostrarPrecio ? `<span style="font-size:12px;font-weight:700;">${typeof dinero === "function" ? dinero(item.precio || 0) : item.precio}</span>` : ""}
 </div>
 `;
}

function construirHtmlEtiquetasImpresion(items, diseno) {
 const etiquetas =
 items.flatMap(item =>
 Array.from({ length: Math.max(1, Math.floor(item.cantidad) || 1) }, () => construirUnaEtiquetaHtml(item, diseno))
 ).join("");

 return `<div class="hoja-etiquetas" style="display:grid;grid-template-columns:repeat(${diseno.columnas},1fr);gap:${diseno.espaciadoMm}mm;padding:${diseno.margenMm}mm;">${etiquetas}</div>`;
}

function renderVistaPreviaEtiquetas() {
 const contenedor =
 document.getElementById("etiquetaVistaPrevia");

 if (!contenedor || !disenoActualEtiquetas) return;

 if (itemsCodigosBarras.length === 0) {
 contenedor.innerHTML = `<p class="encargo-items-vacio">Agrega productos a tu lista para ver la vista previa.</p>`;
 return;
 }

 contenedor.innerHTML = construirHtmlEtiquetasImpresion(itemsCodigosBarras, disenoActualEtiquetas);
}

function imprimirEtiquetas() {
 if (itemsCodigosBarras.length === 0) {
 alertaPOS("Agrega al menos un producto a tu lista.", "Sin productos", "alerta");
 return;
 }

 const sinCodigo =
 itemsCodigosBarras.filter(item => !item.codigo).length;

 const negocio =
 (typeof configuracionNegocio === "function" ? configuracionNegocio() : {}) || {};

 const html =
 construirHtmlEtiquetasImpresion(itemsCodigosBarras, disenoActualEtiquetas);

 const ventana =
 window.open("", "_blank", "width=900,height=720");

 if (!ventana) {
 alertaPOS("Tu navegador bloqueo la ventana de impresion. Permite ventanas emergentes para Nexo POS e intenta de nuevo.", "Ventana bloqueada", "alerta");
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
 @media print{
 .encabezado-impresion{display:none;}
 .etiqueta-producto{break-inside:avoid;}
 }
 </style>
 </head>
 <body>
 <p class="encabezado-impresion">Imprime a escala 100% (sin "ajustar a pagina") para que el tamano real coincida con lo elegido.${sinCodigo ? ` ${sinCodigo} producto(s) sin codigo se imprimen sin barras.` : ""}</p>
 ${html}
 <script>window.print();</script>
 </body>
 </html>
 `);
 ventana.document.close();
}
