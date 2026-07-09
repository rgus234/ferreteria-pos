/* Vista previa de precios calculados para un catalogo guardado: recorre el
   catalogo completo con el parser correcto, calcula el precio sugerido segun
   las reglas del proveedor, y lo cruza contra el inventario real por codigo.
   Fase 6: precio nuevo editable, omitir por fila, aplicar todos (actualiza
   productos existentes por codigo y crea los que no existen todavia). */

let estadoAplicarPrecios = {
 catalogoIndice: null,
 reglas: null,
 filas: [],
 filtroTexto: "",
 filtroCategoria: "",
 pagina: 1
};

const TAMANO_PAGINA_APLICAR_PRECIOS = 20;

function asegurarPantallaAplicarPrecios() {
 let pantalla =
 document.getElementById("pantallaAplicarPrecios");

 if (pantalla) return pantalla;

 const main =
 document.querySelector("main.contenido") || document.getElementById("sistema");

 pantalla = document.createElement("section");
 pantalla.id = "pantallaAplicarPrecios";
 pantalla.style.display = "none";

 pantalla.innerHTML = `
 <div class="aplicar-precios-shell">
 <div class="aplicar-precios-header">
 <div>
 <h2>Aplicar precios calculados</h2>
 <p>Precio sugerido = precio de lista del catalogo mas el margen configurado para el proveedor.</p>
 </div>
 <div class="aplicar-precios-header-acciones">
 <select id="aplicarPreciosCatalogoSelect" onchange="seleccionarCatalogoAplicarPrecios(this.value)"></select>
 <button type="button" onclick="mostrarCatalogo()">Volver a Catalogo proveedor</button>
 </div>
 </div>

 <div id="aplicarPreciosResumen" class="aplicar-precios-resumen"></div>

 <div class="aplicar-precios-toolbar">
 <input type="text" id="aplicarPreciosBuscador" placeholder="Buscar por nombre o codigo..." oninput="filtrarAplicarPreciosTexto(this.value)">
 <select id="aplicarPreciosFiltroCategoria" onchange="filtrarAplicarPreciosCategoria(this.value)">
 <option value="">Todas las categorias</option>
 </select>
 <button type="button" class="aplicar-precios-btn-aplicar" onclick="aplicarPreciosSeleccionados()">
 Aplicar todos
 </button>
 </div>

 <div class="aplicar-precios-tabla-wrap">
 <table class="aplicar-precios-tabla">
 <thead>
 <tr>
 <th>Producto</th>
 <th>Codigo</th>
 <th>Precio lista</th>
 <th>Margen aplicado</th>
 <th>Precio sugerido</th>
 <th>Precio actual</th>
 <th>Precio nuevo</th>
 <th>Incluir</th>
 </tr>
 </thead>
 <tbody id="tablaAplicarPrecios"></tbody>
 </table>
 </div>

 <div class="aplicar-precios-paginacion">
 <span id="aplicarPreciosPaginacionTexto"></span>
 <div id="paginacionAplicarPrecios"></div>
 </div>
 </div>
 `;

 main.appendChild(pantalla);
 return pantalla;
}

async function mostrarAplicarPrecios(indiceInicial) {
 asegurarPantallaAplicarPrecios();

 if (typeof ocultarPantallasPrincipales === "function") ocultarPantallasPrincipales();

 document.getElementById("pantallaAplicarPrecios").style.display = "block";

 if (typeof actualizarModuloActivoPOS === "function") actualizarModuloActivoPOS("catalogo");

 if (typeof actualizarTopbarContexto === "function") {
 actualizarTopbarContexto(
 "Aplicar precios calculados",
 "Vista previa antes de actualizar el inventario",
 "catalogo"
 );
 }

 if (!Array.isArray(todosProductos) || !todosProductos.length) {
 try {
 await cargarProductos();
 } catch (error) {
 console.warn(error);
 }
 }

 const catalogos =
 catalogosGuardados();

 const select =
 document.getElementById("aplicarPreciosCatalogoSelect");

 if (!catalogos.length) {
 select.innerHTML = `<option value="">Sin catalogos guardados</option>`;
 document.getElementById("aplicarPreciosResumen").innerHTML = `
 <div class="reglas-precio-vacio">Sube un catalogo primero en "Catalogo proveedor".</div>
 `;
 document.getElementById("tablaAplicarPrecios").innerHTML = "";
 return;
 }

 select.innerHTML =
 catalogos.map((catalogo, indice) => `
 <option value="${indice}">${escaparPOS(catalogo.proveedor)} -- ${escaparPOS(catalogo.archivo)}</option>
 `).join("");

 const indice =
 indiceInicial !== undefined && indiceInicial !== null
 ? Number(indiceInicial)
 : 0;

 select.value = String(indice);

 await seleccionarCatalogoAplicarPrecios(indice);
}

function indiceCodigoProductoCatalogo(mapeoCatalogo, columnas) {
 if (mapeoCatalogo.codigoBarras !== undefined && mapeoCatalogo.codigoBarras !== "") return mapeoCatalogo.codigoBarras;
 if (mapeoCatalogo.codigoInterno !== undefined && mapeoCatalogo.codigoInterno !== "") return mapeoCatalogo.codigoInterno;
 if (mapeoCatalogo.claveProveedor !== undefined && mapeoCatalogo.claveProveedor !== "") return mapeoCatalogo.claveProveedor;
 if (columnas.codigo !== undefined && columnas.codigo !== "") return columnas.codigo;
 return 0;
}

function filasDesdeCatalogoCompleto(catalogo) {
 const lineas =
 dividirLineasCatalogo(catalogo.csv || "")
 .map(linea => linea.trim())
 .filter(Boolean);

 const mapaColumnas =
 detectarColumnasCatalogo(lineas);

 const columnas =
 mapaColumnas.columnas || {};

 const mapeoCatalogo =
 catalogo.mapeo || {};

 const parser =
 typeof parserCatalogoProveedor === "function"
 ? parserCatalogoProveedor(catalogo)
 : null;

 const indiceCodigoProducto =
 indiceCodigoProductoCatalogo(mapeoCatalogo, columnas);

 const resultados = [];

 lineas.forEach((linea, indiceLinea) => {
 if (indiceLinea === mapaColumnas.indice) return;

 const datos =
 separarFilaCatalogo(linea);

 const codigoNormalizado =
 normalizarCodigo(datos[indiceCodigoProducto]);

 if (!codigoNormalizado) return;

 const codigosAlternos =
 valorMapeoCatalogo(datos, mapeoCatalogo, "codigosAlternos")
 .split("|")
 .map(normalizarCodigo)
 .filter(Boolean);

 const producto =
 parser
 ? parser.extraerProducto({
 datos,
 columnas,
 mapeoCatalogo,
 indiceCodigoProducto,
 codigoNormalizado,
 codigosAlternos,
 catalogoProveedor: catalogo
 })
 : null;

 if (producto) resultados.push(producto);
 });

 return resultados;
}

async function seleccionarCatalogoAplicarPrecios(indice) {
 const catalogos =
 catalogosGuardados();

 const catalogo =
 catalogos[Number(indice)];

 if (!catalogo) return;

 estadoAplicarPrecios.catalogoIndice = Number(indice);
 estadoAplicarPrecios.filtroTexto = "";
 estadoAplicarPrecios.filtroCategoria = "";
 estadoAplicarPrecios.pagina = 1;

 const buscador =
 document.getElementById("aplicarPreciosBuscador");

 if (buscador) buscador.value = "";

 const reglas =
 (await obtenerReglasPrecioProveedor(catalogo.proveedor, true)) || {
 proveedor: catalogo.proveedor,
 margenGeneral: null,
 redondeo: "ninguno",
 margenesCategoria: {},
 margenesProducto: {}
 };

 estadoAplicarPrecios.reglas = reglas;

 const filasCatalogo =
 filasDesdeCatalogoCompleto(catalogo);

 estadoAplicarPrecios.filas =
 filasCatalogo.map((producto, indice) => {
 const codigoNorm =
 normalizarCodigo(producto.codigo);

 const existente =
 (todosProductos || []).find(p => normalizarCodigo(p.codigo) === codigoNorm);

 const calculo =
 calcularPrecioSugerido(reglas, producto);

 return {
 id: indice,
 producto,
 existente: existente || null,
 calculo,
 precioNuevo: calculo?.precioSugerido ?? null,
 omitido: false
 };
 });

 const categorias =
 [...new Set(estadoAplicarPrecios.filas.map(f => f.producto.categoria).filter(Boolean))].sort((a, b) => a.localeCompare(b, "es"));

 const filtroCategoria =
 document.getElementById("aplicarPreciosFiltroCategoria");

 if (filtroCategoria) {
 filtroCategoria.innerHTML =
 `<option value="">Todas las categorias</option>` +
 categorias.map(c => `<option value="${escaparPOS(c)}">${escaparPOS(c)}</option>`).join("");
 }

 const sinMargen =
 !reglas.margenGeneral && Object.keys(reglas.margenesCategoria || {}).length === 0 && Object.keys(reglas.margenesProducto || {}).length === 0;

 document.getElementById("aplicarPreciosResumen").innerHTML = `
 <div><span>Proveedor</span><strong>${escaparPOS(catalogo.proveedor)}</strong></div>
 <div><span>Productos en catalogo</span><strong>${estadoAplicarPrecios.filas.length}</strong></div>
 <div><span>Coinciden con inventario</span><strong>${estadoAplicarPrecios.filas.filter(f => f.existente).length}</strong></div>
 ${sinMargen ? `<div class="aplicar-precios-alerta">Este proveedor no tiene margen configurado todavia. <a href="#" onclick="mostrarReglasPrecios('${encodeURIComponent(catalogo.proveedor)}'); return false;">Configurar precios</a></div>` : ""}
 `;

 renderAplicarPrecios();
}

function filasAplicarPreciosFiltradas() {
 const texto =
 normalizarTexto(estadoAplicarPrecios.filtroTexto);

 const codigoTexto =
 normalizarCodigo(estadoAplicarPrecios.filtroTexto);

 const categoria =
 normalizarTexto(estadoAplicarPrecios.filtroCategoria);

 return estadoAplicarPrecios.filas.filter(fila => {
 if (texto) {
 const coincideNombre =
 normalizarTexto(fila.producto.nombre || "").includes(texto);

 const coincideCodigo =
 codigoTexto && normalizarCodigo(fila.producto.codigo || "").includes(codigoTexto);

 if (!coincideNombre && !coincideCodigo) return false;
 }

 if (categoria && normalizarTexto(fila.producto.categoria || "") !== categoria) return false;

 return true;
 });
}

function filtrarAplicarPreciosTexto(valor) {
 estadoAplicarPrecios.filtroTexto = valor;
 estadoAplicarPrecios.pagina = 1;
 renderAplicarPrecios();
}

function filtrarAplicarPreciosCategoria(valor) {
 estadoAplicarPrecios.filtroCategoria = valor;
 estadoAplicarPrecios.pagina = 1;
 renderAplicarPrecios();
}

function cambiarPaginaAplicarPrecios(pagina) {
 estadoAplicarPrecios.pagina = pagina;
 renderAplicarPrecios();
}

function renderAplicarPrecios() {
 const tabla =
 document.getElementById("tablaAplicarPrecios");

 if (!tabla) return;

 const filtradas =
 filasAplicarPreciosFiltradas();

 const totalPaginas =
 Math.max(1, Math.ceil(filtradas.length / TAMANO_PAGINA_APLICAR_PRECIOS));

 estadoAplicarPrecios.pagina =
 Math.min(estadoAplicarPrecios.pagina, totalPaginas);

 const inicio =
 (estadoAplicarPrecios.pagina - 1) * TAMANO_PAGINA_APLICAR_PRECIOS;

 const pagina =
 filtradas.slice(inicio, inicio + TAMANO_PAGINA_APLICAR_PRECIOS);

 if (!pagina.length) {
 tabla.innerHTML = `
 <tr><td colspan="8" class="reglas-precio-vacio">Sin productos para mostrar.</td></tr>
 `;
 } else {
 tabla.innerHTML =
 pagina.map(fila => {
 const p =
 fila.producto;

 return `
 <tr class="${fila.omitido ? "aplicar-precios-fila-omitida" : ""}">
 <td>${escaparPOS(p.nombre)}</td>
 <td>${escaparPOS(p.codigo || "-")}</td>
 <td>$${Number(p.publico || 0).toFixed(2)}</td>
 <td>${fila.calculo ? `${fila.calculo.margen}% <small>(${fila.calculo.origenMargen})</small>` : "Sin margen"}</td>
 <td>${fila.calculo ? "$" + fila.calculo.precioSugerido.toFixed(2) : "-"}</td>
 <td>${fila.existente ? "$" + Number(fila.existente.precio_publico || fila.existente.precio || 0).toFixed(2) : "<em>Nuevo</em>"}</td>
 <td><input type="number" step="0.01" min="0" class="aplicar-precios-input-nuevo" value="${fila.precioNuevo ?? ""}" onchange="actualizarPrecioNuevoFila(${fila.id}, this.value)"></td>
 <td><button type="button" class="aplicar-precios-omitir ${fila.omitido ? "activo" : ""}" onclick="alternarOmitirFila(${fila.id})">${fila.omitido ? "Omitido" : "Incluir"}</button></td>
 </tr>
 `;
 }).join("");
 }

 document.getElementById("aplicarPreciosPaginacionTexto").textContent =
 filtradas.length
 ? `Mostrando ${inicio + 1} a ${Math.min(inicio + TAMANO_PAGINA_APLICAR_PRECIOS, filtradas.length)} de ${filtradas.length}`
 : "";

 renderPaginacion("paginacionAplicarPrecios", filtradas.length, estadoAplicarPrecios.pagina, TAMANO_PAGINA_APLICAR_PRECIOS, "cambiarPaginaAplicarPrecios");
}

function actualizarPrecioNuevoFila(id, valor) {
 const fila =
 estadoAplicarPrecios.filas.find(f => f.id === id);

 if (!fila) return;

 fila.precioNuevo =
 valor === "" ? null : Number(valor);
}

function alternarOmitirFila(id) {
 const fila =
 estadoAplicarPrecios.filas.find(f => f.id === id);

 if (!fila) return;

 fila.omitido = !fila.omitido;

 renderAplicarPrecios();
}

async function aplicarPreciosSeleccionados() {
 const filas =
 filasAplicarPreciosFiltradas()
 .filter(f => !f.omitido && f.precioNuevo != null && f.precioNuevo > 0);

 if (!filas.length) {
 await alertaPOS("No hay productos incluidos con un precio nuevo valido para aplicar. Usa el buscador o el filtro de categoria para elegir cuales aplicar.", "Aplicar precios", "alerta");
 return;
 }

 const actualizaciones =
 filas.filter(f => f.existente).length;

 const creaciones =
 filas.length - actualizaciones;

 const confirmar =
 await dialogoPOS({
 tipo: "alerta",
 titulo: "Aplicar precios calculados",
 mensaje: `Se van a actualizar ${actualizaciones} producto(s) que ya existen en tu inventario y crear ${creaciones} producto(s) nuevo(s) (con stock 0). Esta accion escribe directo en tu inventario real. ¿Deseas continuar?`,
 mostrarCancelar: true,
 textoAceptar: "Si, aplicar",
 textoCancelar: "Cancelar"
 });

 if (!confirmar) return;

 let exitos = 0;
 let errores = 0;

 for (const fila of filas) {
 try {
 if (fila.existente) {
 await actualizarProductoConPrecioNuevo(fila);
 } else {
 await crearProductoDesdeCatalogo(fila);
 }

 exitos++;
 } catch (error) {
 console.warn(error);
 errores++;
 }
 }

 try {
 await cargarProductos();
 } catch (error) {
 console.warn(error);
 }

 await seleccionarCatalogoAplicarPrecios(estadoAplicarPrecios.catalogoIndice);

 await alertaPOS(
 `Precios aplicados: ${exitos} correcto(s)${errores ? `, ${errores} con error` : ""}.`,
 "Aplicar precios",
 errores ? "alerta" : "exito"
 );
}

async function actualizarProductoConPrecioNuevo(fila) {
 const e =
 fila.existente;

 const payload = {
 nombre: e.nombre,
 precio: fila.precioNuevo,
 stock: e.stock,
 codigo: e.codigo,
 proveedor: e.proveedor || "",
 ubicacion: e.ubicacion || "",
 categoria: e.categoria || "",
 subcategoria: e.subcategoria || "",
 marca: e.marca || "",
 descripcion: e.descripcion || "",
 unidadVenta: e.unidad_venta || "pieza",
 precioDistribuidor: e.precio_distribuidor || "",
 precioMayoreo: e.precio_mayoreo || "",
 precioPublico: fila.precioNuevo,
 stockMinimo: e.stock_minimo || 3,
 altaRotacion: e.alta_rotacion || "",
 tipoProducto: e.tipo_producto || "catalogo",
 presentacionCompra: e.presentacion_compra || "",
 factorConversion: e.factor_conversion || "",
 basculaDigital: e.bascula_digital || "no",
 codigosRelacionados:
 (e.codigos_relacionados || [])
 .map(c => (typeof c === "string" ? c : c.codigo))
 .filter(Boolean)
 };

 const respuesta =
 await fetch(`/editar-producto/${e.id}`, {
 method: "PUT",
 headers: { "Content-Type": "application/json" },
 body: JSON.stringify(payload)
 });

 if (!respuesta.ok) throw new Error("No se pudo actualizar el producto " + e.id);
}

async function crearProductoDesdeCatalogo(fila) {
 const p =
 fila.producto;

 const payload = {
 nombre: p.nombre,
 precio: fila.precioNuevo,
 stock: 0,
 codigo: p.codigo,
 proveedor: p.proveedor || estadoAplicarPrecios.reglas?.proveedor || "",
 ubicacion: "",
 categoria: p.categoria || "",
 subcategoria: "",
 marca: p.marca || "",
 descripcion: p.descripcion || p.nombre,
 unidadVenta: p.unidadVenta || "pieza",
 precioDistribuidor: "",
 precioMayoreo: "",
 precioPublico: fila.precioNuevo,
 stockMinimo: p.stockMinimo || 3,
 altaRotacion: p.altaRotacion || "",
 tipoProducto: "catalogo",
 presentacionCompra: "",
 factorConversion: "",
 basculaDigital: "no",
 codigosRelacionados: p.codigosRelacionados || []
 };

 const respuesta =
 await fetch("/agregar-producto", {
 method: "POST",
 headers: { "Content-Type": "application/json" },
 body: JSON.stringify(payload)
 });

 if (!respuesta.ok) throw new Error("No se pudo crear el producto " + p.codigo);
}
