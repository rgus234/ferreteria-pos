/* Pantalla de configuracion de precios por proveedor: margen general (Fase 3),
   margenes por categoria/producto (Fase 4). Construida dinamicamente, mismo
   patron que asegurarPantallaRecepcion() en ferretero-flow.js. */

let estadoReglasPrecio = {
 proveedorSeleccionado: null,
 reglas: null
};

const MARGENES_RAPIDOS_PRECIO = [10, 15, 20, 25, 30, 40, 50];

const OPCIONES_REDONDEO_PRECIO = [
 { valor: "ninguno", etiqueta: "Sin redondeo" },
 { valor: "peso", etiqueta: "Al peso mas cercano" },
 { valor: "multiplo5", etiqueta: "Multiplos de $5" },
 { valor: "multiplo10", etiqueta: "Multiplos de $10" },
 { valor: "psicologico", etiqueta: "Precio psicologico" }
];

function asegurarPantallaReglasPrecios() {
 let pantalla =
 document.getElementById("pantallaReglasPrecios");

 if (pantalla) return pantalla;

 const main =
 document.querySelector("main.contenido") || document.getElementById("sistema");

 pantalla = document.createElement("section");
 pantalla.id = "pantallaReglasPrecios";
 pantalla.style.display = "none";

 pantalla.innerHTML = `
 <div class="reglas-precio-shell">
 <div class="reglas-precio-header">
 <div>
 <h2>Precios por proveedor</h2>
 <p>Configura el margen y el redondeo que se aplica al precio de lista de cada proveedor.</p>
 </div>
 <button type="button" onclick="mostrarProveedores()">Volver a Proveedores</button>
 </div>

 <div class="reglas-precio-selector">
 <label>
 Proveedor
 <select id="reglasPrecioProveedorSelect" onchange="seleccionarProveedorReglas(this.value)"></select>
 </label>
 </div>

 <div id="reglasPrecioContenido"></div>
 </div>
 `;

 main.appendChild(pantalla);
 return pantalla;
}

function listaNombresProveedoresDisponibles() {
 const vistos =
 new Map();

 const agregar = nombre => {
 const limpio =
 String(nombre || "").trim();

 if (!limpio) return;

 const clave =
 normalizarTexto(limpio);

 if (!vistos.has(clave)) vistos.set(clave, limpio);
 };

 (proveedores || []).forEach(p => agregar(p.nombre));

 if (typeof catalogosGuardados === "function") {
 catalogosGuardados().forEach(c => agregar(c.proveedor));
 }

 (todosProductos || []).forEach(p => agregar(p.proveedor));

 return [...vistos.values()].sort((a, b) => a.localeCompare(b, "es"));
}

async function mostrarReglasPrecios(proveedorInicial) {
 asegurarPantallaReglasPrecios();

 if (typeof ocultarPantallasPrincipales === "function") ocultarPantallasPrincipales();

 document.getElementById("pantallaReglasPrecios").style.display = "block";

 if (typeof actualizarModuloActivoPOS === "function") actualizarModuloActivoPOS("proveedores");

 if (typeof actualizarTopbarContexto === "function") {
 actualizarTopbarContexto(
 "Precios por proveedor",
 "Margen general, por categoria y por producto",
 "proveedores"
 );
 }

 if (!Array.isArray(proveedores) || !proveedores.length) {
 try {
 await cargarProveedores();
 } catch (error) {
 console.warn(error);
 }
 }

 const nombresProveedores =
 listaNombresProveedoresDisponibles();

 const select =
 document.getElementById("reglasPrecioProveedorSelect");

 select.innerHTML =
 nombresProveedores.map(nombre => `
 <option value="${escaparPOS(nombre)}">${escaparPOS(nombre)}</option>
 `).join("");

 const proveedorDecodificado =
 proveedorInicial
 ? decodeURIComponent(proveedorInicial)
 : (nombresProveedores[0] || "");

 select.value = proveedorDecodificado;

 await seleccionarProveedorReglas(proveedorDecodificado);
}

async function seleccionarProveedorReglas(proveedor) {
 if (!proveedor) return;

 estadoReglasPrecio.proveedorSeleccionado = proveedor;

 const guardadas =
 await obtenerReglasPrecioProveedor(proveedor, true);

 estadoReglasPrecio.reglas =
 guardadas || {
 proveedor,
 margenGeneral: null,
 redondeo: "ninguno",
 margenesCategoria: {},
 margenesProducto: {}
 };

 renderReglasPrecios();
}

function seleccionarMargenRapido(valor) {
 estadoReglasPrecio.reglas.margenGeneral = valor;
 renderReglasPrecios();
}

function actualizarMargenPersonalizado(valor) {
 estadoReglasPrecio.reglas.margenGeneral =
 valor === "" ? null : Number(valor);

 renderReglasPrecios();
}

function seleccionarRedondeoReglas(valor) {
 estadoReglasPrecio.reglas.redondeo = valor;
 renderReglasPrecios();
}

async function guardarReglasActuales() {
 try {
 await guardarReglasPrecioProveedor(estadoReglasPrecio.reglas);
 await alertaPOS("Reglas de precio guardadas.", "Precios por proveedor", "exito");
 } catch (error) {
 await alertaPOS("No se pudieron guardar las reglas de precio.", "Precios por proveedor", "peligro");
 }
}

function renderReglasPrecios() {
 const contenedor =
 document.getElementById("reglasPrecioContenido");

 if (!contenedor) return;

 const reglas =
 estadoReglasPrecio.reglas;

 if (!reglas) {
 contenedor.innerHTML = "";
 return;
 }

 contenedor.innerHTML = `
 <div class="reglas-precio-seccion">
 <h3>Margen general</h3>
 <div class="reglas-precio-margenes-rapidos">
 ${MARGENES_RAPIDOS_PRECIO.map(valor => `
 <button type="button" class="${Number(reglas.margenGeneral) === valor ? "activo" : ""}" onclick="seleccionarMargenRapido(${valor})">
 ${valor}%
 </button>
 `).join("")}
 </div>
 <label class="reglas-precio-personalizado">
 Margen personalizado (%)
 <input type="number" step="0.01" min="0" value="${reglas.margenGeneral ?? ""}" oninput="actualizarMargenPersonalizado(this.value)" placeholder="Ej. 37.5">
 </label>
 </div>

 <div class="reglas-precio-seccion">
 <h3>Redondeo</h3>
 <div class="reglas-precio-redondeo-opciones">
 ${OPCIONES_REDONDEO_PRECIO.map(opcion => `
 <button type="button" class="${reglas.redondeo === opcion.valor ? "activo" : ""}" onclick="seleccionarRedondeoReglas('${opcion.valor}')">
 ${opcion.etiqueta}
 </button>
 `).join("")}
 </div>
 </div>

 <div class="reglas-precio-seccion">
 <h3>Margenes por categoria</h3>
 <p class="reglas-precio-ayuda">Vacio = usa el margen general. Tiene prioridad sobre el margen general, pero no sobre un margen especifico de producto.</p>
 <div class="reglas-precio-categorias-tabla">
 ${categoriasInventarioGuardadas().map(categoria => {
 const clave = normalizarTexto(categoria.nombre);
 const valor = reglas.margenesCategoria?.[clave];
 return `
 <div class="reglas-precio-categoria-fila">
 <span>${escaparPOS(categoria.nombre)}</span>
 <input type="number" step="0.01" min="0" value="${valor ?? ""}" placeholder="General" onchange="actualizarMargenCategoria('${clave}', this.value)">
 </div>
 `;
 }).join("") || `<div class="reglas-precio-vacio">No hay categorias guardadas todavia.</div>`}
 </div>
 </div>

 <div class="reglas-precio-seccion">
 <h3>Margenes por producto</h3>
 <p class="reglas-precio-ayuda">Tiene la prioridad mas alta: ignora el margen de categoria y el general para ese producto.</p>
 <div class="reglas-precio-buscador-producto">
 <input type="text" id="buscarProductoMargenInput" placeholder="Buscar producto por nombre o codigo..." oninput="buscarProductoParaMargen(this.value)">
 <div id="resultadosBusquedaProductoMargen"></div>
 </div>
 <div class="reglas-precio-productos-tabla">
 ${filasMargenesProductoHTML(reglas)}
 </div>
 </div>

 <div class="reglas-precio-acciones">
 <button type="button" class="btn-guardar-reglas-precio" onclick="guardarReglasActuales()">
 Guardar reglas
 </button>
 </div>
 `;
}

function filasMargenesProductoHTML(reglas) {
 const entradas =
 Object.entries(reglas.margenesProducto || {});

 if (!entradas.length) {
 return `<div class="reglas-precio-vacio">Sin productos con margen personalizado.</div>`;
 }

 return entradas.map(([codigo, margen]) => {
 const producto =
 todosProductos.find(p => normalizarCodigo(p.codigo) === codigo);

 const nombre =
 producto?.nombre || codigo;

 return `
 <div class="reglas-precio-producto-fila">
 <span>${escaparPOS(nombre)} <small>${escaparPOS(codigo)}</small></span>
 <input type="number" step="0.01" min="0" value="${margen}" onchange="actualizarMargenProductoOverride('${codigo}', this.value)">
 <button type="button" onclick="quitarMargenProductoOverride('${codigo}')">Quitar</button>
 </div>
 `;
 }).join("");
}

function actualizarMargenCategoria(clave, valor) {
 if (!estadoReglasPrecio.reglas.margenesCategoria) estadoReglasPrecio.reglas.margenesCategoria = {};

 if (valor === "" || valor === null || valor === undefined) {
 delete estadoReglasPrecio.reglas.margenesCategoria[clave];
 } else {
 estadoReglasPrecio.reglas.margenesCategoria[clave] = Number(valor);
 }
}

function buscarProductoParaMargen(texto) {
 const contenedor =
 document.getElementById("resultadosBusquedaProductoMargen");

 if (!contenedor) return;

 const limpio =
 String(texto || "").trim();

 if (!limpio) {
 contenedor.innerHTML = "";
 return;
 }

 const textoNormalizado =
 normalizarTexto(limpio);

 const codigoNormalizado =
 normalizarCodigo(limpio);

 const resultados =
 (todosProductos || [])
 .filter(p =>
 normalizarTexto(p.nombre || "").includes(textoNormalizado) ||
 (codigoNormalizado && normalizarCodigo(p.codigo || "").includes(codigoNormalizado))
 )
 .slice(0, 8);

 if (!resultados.length) {
 contenedor.innerHTML = `<div class="reglas-precio-vacio">Sin resultados para "${escaparPOS(limpio)}"</div>`;
 return;
 }

 contenedor.innerHTML =
 resultados.map(p => `
 <div class="reglas-precio-producto-resultado">
 <span>${escaparPOS(p.nombre)} <small>${escaparPOS(p.codigo || "")}</small></span>
 <button type="button" onclick="agregarOverrideProducto('${normalizarCodigo(p.codigo || "")}')">
 Agregar
 </button>
 </div>
 `).join("");
}

function agregarOverrideProducto(codigo) {
 if (!codigo) return;

 if (!estadoReglasPrecio.reglas.margenesProducto) estadoReglasPrecio.reglas.margenesProducto = {};

 if (estadoReglasPrecio.reglas.margenesProducto[codigo] == null) {
 estadoReglasPrecio.reglas.margenesProducto[codigo] = 0;
 }

 const buscador =
 document.getElementById("buscarProductoMargenInput");

 if (buscador) buscador.value = "";

 document.getElementById("resultadosBusquedaProductoMargen").innerHTML = "";

 renderReglasPrecios();
}

function actualizarMargenProductoOverride(codigo, valor) {
 if (!estadoReglasPrecio.reglas.margenesProducto) estadoReglasPrecio.reglas.margenesProducto = {};

 estadoReglasPrecio.reglas.margenesProducto[codigo] =
 valor === "" ? 0 : Number(valor);
}

function quitarMargenProductoOverride(codigo) {
 if (estadoReglasPrecio.reglas.margenesProducto) {
 delete estadoReglasPrecio.reglas.margenesProducto[codigo];
 }

 renderReglasPrecios();
}
