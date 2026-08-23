/* Utilidades de producto y catalogo */
function normalizarCodigo(codigo) {
 return String(codigo || "")
 .replace(/[="'\s]/g, "")
 .trim();
}

// Compara texto de busqueda contra un producto incluyendo sus codigos
// alternos (codigo interno, clave de proveedor, etc. guardados en
// codigos_relacionados) -- antes las busquedas solo revisaban el codigo
// principal, asi que un producto sin codigo de barras real (ej. Gafi,
// que solo trae clave interna) nunca aparecia buscando por esa clave.
function productoCoincideConTexto(producto, texto) {
 if (!texto) return true;

 if (String(producto.nombre || "").toLowerCase().includes(texto)) return true;
 if (String(producto.codigo || "").toLowerCase().includes(texto)) return true;
 if (String(producto.categoria || "").toLowerCase().includes(texto)) return true;

 if (Array.isArray(producto.codigos_relacionados)) {
 return producto.codigos_relacionados.some(item =>
 String(item?.codigo || "").toLowerCase().includes(texto)
 );
 }

 return false;
}

// Busca en el inventario propio (no en el catalogo de referencia del
// proveedor) un producto que ya tenga el codigo dado, sea como codigo
// principal o como codigo alterno.
function buscarProductoPorCodigo(codigoNormalizado) {
 if (!codigoNormalizado) return null;

 return todosProductos.find(p => {
 const candidatos = [
 normalizarCodigo(p.codigo),
 ...(Array.isArray(p.codigos_relacionados)
 ? p.codigos_relacionados.map(item => normalizarCodigo(item.codigo))
 : [])
 ];

 return candidatos.includes(codigoNormalizado);
 });
}

// Recuerda el ultimo codigo que el usuario ya confirmo que quiere
// registrar de todos modos (aunque ya exista), para no repetirle la
// misma alerta dos veces por el mismo codigo.
let codigoDuplicadoConfirmado = null;

// Se dispara al salir del campo de codigo de barras o codigo interno,
// para avisar del duplicado desde el inicio en vez de hasta el final
// del formulario (antes el usuario llenaba todo y hasta darle Guardar
// se enteraba de que el producto ya existia).
async function verificarCodigoDuplicadoEnVivo(inputId) {
 if (productoEditandoId) return;

 const valor =
 normalizarCodigo(document.getElementById(inputId)?.value || "");

 if (!valor) {
 marcarImagenProductoEncontrada(false);
 codigoImagenExistenteActual = null;
 return;
 }

 // banco_imagenes_producto/fotos_producto se buscan por el codigo de
 // CATALOGO del proveedor, no por codigo de barras -- si el catalogo ya
 // autorelleno nuevoCodigoInterno (aplicarProductoCatalogoAlFormulario),
 // ese es el codigo correcto para el chequeo de fotos aunque este blur
 // haya sido sobre nuevoCodigo (el de barras). Mismo criterio que el
 // chequeo que corre justo despues de resolver el catalogo -- sin esto,
 // el blur del campo de barras podia sobreescribir con "no existe" el
 // resultado correcto que ya se habia mostrado.
 const codigoParaFotos =
 normalizarCodigo(
 document.getElementById("nuevoCodigoInterno")?.value ||
 document.getElementById("nuevoCodigo")?.value ||
 ""
 );

 verificarImagenExistenteParaCodigo(codigoParaFotos).then(() => verificarBancoImagenesParaCodigo(codigoParaFotos));

 if (valor === codigoDuplicadoConfirmado) return;

 const duplicado =
 buscarProductoPorCodigo(valor);

 if (!duplicado) return;

 const irAEditar =
 await dialogoPOS({
 tipo: "alerta",
 titulo: "Este producto ya existe",
 mensaje: `Ya tienes "${duplicado.nombre}" en tu inventario con este codigo (stock actual: ${duplicado.stock}). ¿Editas ese producto en vez de crear uno nuevo?`,
 mostrarCancelar: true,
 textoAceptar: "Editar ese producto",
 textoCancelar: "Continuar de todos modos"
 });

 if (irAEditar) {
 editarProducto(duplicado.id);
 } else {
 codigoDuplicadoConfirmado = valor;
 }
}

// Marca (o desmarca) un campo del formulario de producto como llenado
// automaticamente desde el catalogo del proveedor, con una etiqueta
// visual junto a su nombre.
function marcarCampoAutocompletado(id, autocompletado) {
 const campo =
 document.getElementById(id);

 const wrapper =
 campo?.closest(".campo-ficha");

 if (!wrapper) return;

 let insignia =
 wrapper.querySelector(".campo-ficha-badge-auto");

 if (!autocompletado) {
 insignia?.remove();
 return;
 }

 if (!insignia) {
 insignia = document.createElement("span");
 insignia.className = "campo-ficha-badge-auto";
 insignia.textContent = "Autocompletado";
 wrapper.appendChild(insignia);
 }
}

const PROVEEDORES_CATALOGO_PRODUCTO = [
 { id: "diprofer", nombre: "Diprofer", modoCapturaPreferido: "barras" },
 { id: "gafi", nombre: "Gafi", modoCapturaPreferido: "interno" },
 { id: "truper", nombre: "Truper", modoCapturaPreferido: "barras" },
 { id: "generico", nombre: "Otro proveedor", modoCapturaPreferido: "barras" }
];

let modoCapturaProductoActual = "barras";

// Se dispara al elegir un proveedor en "Proveedor del catalogo": llena el
// campo Proveedor, cambia el modo de captura preferido de ese proveedor
// (ej. Gafi no tiene codigo de barras real, asi que prioriza codigo
// interno) y muestra la regla de precio configurada para el, si existe.
async function seleccionarProveedorCatalogoProducto(id) {
 const info =
 PROVEEDORES_CATALOGO_PRODUCTO.find(p => p.id === id);

 if (!info) return;

 document.querySelectorAll("#proveedorCatalogoSeccion [data-proveedor-catalogo]").forEach(boton => {
 boton.classList.toggle("activo", boton.dataset.proveedorCatalogo === id);
 });

 const campoProveedor =
 document.getElementById("nuevoProveedor");

 if (campoProveedor) {
 campoProveedor.value =
 id === "generico" ? "" : info.nombre;
 }

 aplicarModoCapturaProducto(info.modoCapturaPreferido);

 await actualizarInfoProveedorCatalogoProducto(info);
}

// Recuerda la ultima regla de precio consultada y el precio de lista del
// producto que se acaba de encontrar en el catalogo, para que el campo de
// "margen a usar" pueda recalcular el precio sugerido al vuelo sin tener
// que ir a la pantalla de Precios por proveedor.
let ultimaReglaProveedorCatalogo = null;
let contextoPrecioListaCatalogoProducto = null;

async function actualizarInfoProveedorCatalogoProducto(info) {
 const panel =
 document.getElementById("proveedorCatalogoInfo");

 const nombreEl =
 document.getElementById("proveedorCatalogoInfoNombre");

 const reglaEl =
 document.getElementById("proveedorCatalogoInfoRegla");

 const margenSeccion =
 document.getElementById("margenManualProveedorSeccion");

 if (!panel || !nombreEl || !reglaEl) return;

 nombreEl.textContent = info.nombre;
 reglaEl.textContent = "Buscando regla de precio...";
 panel.style.display = "grid";

 ultimaReglaProveedorCatalogo = null;

 if (margenSeccion) margenSeccion.style.display = "none";

 if (info.id === "generico") {
 reglaEl.textContent = "Sin regla de precio configurada";
 return;
 }

 try {
 const reglas =
 typeof obtenerReglasPrecioProveedor === "function"
 ? await obtenerReglasPrecioProveedor(info.nombre, true)
 : null;

 ultimaReglaProveedorCatalogo = reglas;

 reglaEl.textContent =
 reglas && reglas.margenGeneral !== null && reglas.margenGeneral !== undefined
 ? `Regla de precio: +${reglas.margenGeneral}% editable`
 : "Sin regla de precio configurada para este proveedor";

 if (margenSeccion) margenSeccion.style.display = "flex";

 actualizarInputMargenManualProveedor();
 } catch (error) {
 reglaEl.textContent = "Sin regla de precio configurada para este proveedor";
 }
}

// Pre-llena el campo de margen manual con el margen que ya le tocaria a
// este producto (por producto > por categoria > general), para que el
// usuario vea de entrada el mismo numero que calcularia el sistema y
// solo lo cambie si de verdad quiere usar otro.
function actualizarInputMargenManualProveedor() {
 const input =
 document.getElementById("margenManualProveedorInput");

 if (!input || !ultimaReglaProveedorCatalogo) return;

 const resuelto =
 typeof resolverMargenProducto === "function"
 ? resolverMargenProducto(ultimaReglaProveedorCatalogo, {
 codigo: contextoPrecioListaCatalogoProducto?.codigo || "",
 categoria: contextoPrecioListaCatalogoProducto?.categoria || ""
 })
 : null;

 if (resuelto) input.value = resuelto.margen;
}

// Se dispara cuando el usuario cambia a mano el % de margen en el panel
// de proveedor: recalcula el precio sugerido con ese porcentaje (en vez
// del configurado) y actualiza el boton de "Usar precio sugerido" para
// que siga siendo un clic aplicarlo -- el precio sigue siendo editable
// despues, es un input normal.
function recalcularPrecioConMargenManualProveedor(valorMargen) {
 const boton =
 typeof asegurarBotonSugerenciaPrecio === "function"
 ? asegurarBotonSugerenciaPrecio()
 : null;

 if (!boton) return;

 const margen =
 Number(valorMargen);

 const precioLista =
 contextoPrecioListaCatalogoProducto?.precioLista || 0;

 if (!precioLista || isNaN(margen)) {
 boton.style.display = "none";
 return;
 }

 const redondeo =
 ultimaReglaProveedorCatalogo?.redondeo || "ninguno";

 const bruto =
 precioLista * (1 + margen / 100);

 const sugerido =
 typeof aplicarRedondeo === "function"
 ? aplicarRedondeo(bruto, redondeo)
 : Math.round(bruto * 100) / 100;

 boton.textContent = `Usar precio sugerido: $${sugerido.toFixed(2)} (margen ${margen}%)`;
 boton.style.display = "inline-flex";

 boton.onclick = () => {
 const campoPrecio =
 document.getElementById("nuevoPrecio");

 if (campoPrecio) campoPrecio.value = sugerido;
 };
}

// Cambia cual campo (codigo de barras o codigo interno) es el principal:
// lo pone primero, lo enfoca y ajusta las etiquetas para dejar claro cual
// es opcional. "manual" no reordena, solo deja de asumir que hay codigo
// de barras real.
function aplicarModoCapturaProducto(modo) {
 modoCapturaProductoActual = modo || "barras";

 document.querySelectorAll("#modoCapturaSeccion [data-modo-captura]").forEach(boton => {
 boton.classList.toggle("activo", boton.dataset.modoCaptura === modoCapturaProductoActual);
 });

 const campoCodigo =
 document.getElementById("nuevoCodigo");

 const campoCodigoInterno =
 document.getElementById("nuevoCodigoInterno");

 const wrapperCodigo =
 campoCodigo?.closest(".campo-ficha");

 const wrapperCodigoInterno =
 campoCodigoInterno?.closest(".campo-ficha");

 if (wrapperCodigo && wrapperCodigoInterno) {
 wrapperCodigo.style.order =
 modoCapturaProductoActual === "interno" ? "2" : "1";

 wrapperCodigoInterno.style.order =
 modoCapturaProductoActual === "interno" ? "1" : "2";
 }

 const etiquetaCodigo =
 wrapperCodigo?.querySelector("span");

 const etiquetaCodigoInterno =
 wrapperCodigoInterno?.querySelector("span");

 if (modoCapturaProductoActual === "interno") {
 if (etiquetaCodigo) etiquetaCodigo.textContent = "Codigo de barras (opcional, si no tiene)";
 if (etiquetaCodigoInterno) etiquetaCodigoInterno.textContent = "Codigo interno / clave proveedor (principal)";

 if (campoCodigoInterno) {
 campoCodigoInterno.placeholder = "Escanea o escribe la clave del proveedor";
 setTimeout(() => campoCodigoInterno.focus(), 80);
 }
 } else if (modoCapturaProductoActual === "manual") {
 if (etiquetaCodigo) etiquetaCodigo.textContent = "Codigo de barras (opcional)";
 if (etiquetaCodigoInterno) etiquetaCodigoInterno.textContent = "Codigo interno / clave proveedor (opcional)";
 } else {
 if (etiquetaCodigo) etiquetaCodigo.textContent = "Codigo de barras";
 if (etiquetaCodigoInterno) etiquetaCodigoInterno.textContent = "Codigo interno / clave proveedor";

 if (campoCodigo) setTimeout(() => campoCodigo.focus(), 80);
 }
}

// Avisa junto al campo de foto manual si el producto que se esta
// editando ya tiene una imagen guardada (importada por lote o subida
// antes) -- asi el usuario no tiene que adivinar ni abrir "Ver
// detalles" para saber si ya tiene foto antes de decidir subir otra.
function marcarImagenProductoEncontrada(tieneImagen) {
 const campo =
 document.getElementById("nuevaImagenProducto");

 const wrapper =
 campo?.closest(".campo-ficha");

 if (!wrapper) return;

 let insignia =
 wrapper.querySelector(".campo-ficha-badge-imagen");

 if (!tieneImagen) {
 insignia?.remove();
 return;
 }

 if (!insignia) {
 insignia = document.createElement("span");
 insignia.className = "campo-ficha-badge-imagen";
 insignia.textContent = "Imagen encontrada";
 wrapper.appendChild(insignia);
 }
}

// Tarjeta premium (no una simple insignia) para "hay una foto en el banco
// compartido de Nexo, pero todavia no es tuya" -- morada a proposito para
// no confundirse con la insignia verde "ya tienes esta foto". Se inserta
// como HERMANA del <label class="campo-ficha"> que envuelve
// #nuevaImagenProducto (creado dinamicamente por asegurarEtiquetasFichaProducto),
// NUNCA dentro -- ese label esta implicitamente asociado al input de
// archivo, y una <img> clicable ahi dentro dispararia el selector de
// archivos del sistema operativo por accidente.
function renderTarjetaBancoImagenes(datos) {
 const campo =
 document.getElementById("nuevaImagenProducto");

 const wrapperLabel =
 campo?.closest(".campo-ficha");

 if (!wrapperLabel) return;

 let tarjeta =
 document.getElementById("tarjetaBancoImagenesNexo");

 if (!datos) {
 tarjeta?.remove();
 return;
 }

 if (!tarjeta) {
 tarjeta = document.createElement("div");
 tarjeta.id = "tarjetaBancoImagenesNexo";
 tarjeta.className = "tarjeta-banco-imagenes";
 wrapperLabel.insertAdjacentElement("afterend", tarjeta);
 }

 const resolucion =
 datos.ancho && datos.alto ? `${datos.ancho}×${datos.alto} px` : null;

 const totalFotos =
 Number(datos.totalFotos) || 1;

 tarjeta.innerHTML = `
 <span class="tarjeta-banco-imagenes-kicker">Banco de Nexo</span>
 <div class="tarjeta-banco-imagenes-cuerpo">
 <img src="${datos.imagenUrl}" alt="Foto encontrada en el banco de Nexo">
 <div class="tarjeta-banco-imagenes-datos">
 ${resolucion ? `<span>${resolucion}</span>` : ""}
 ${datos.marca ? `<span>${escaparPOS(datos.marca)}</span>` : ""}
 <span>${totalFotos} foto${totalFotos === 1 ? "" : "s"} disponible${totalFotos === 1 ? "" : "s"}</span>
 </div>
 </div>
 <div class="tarjeta-banco-imagenes-acciones">
 <button type="button" class="tarjeta-banco-imagenes-usar" onclick="usarImagenBancoNexo()">Usar esta imagen</button>
 ${totalFotos > 1 ? `<button type="button" class="tarjeta-banco-imagenes-galeria" onclick="abrirGaleriaBancoImagenesPOS()">Ver galeria</button>` : ""}
 </div>
 `;
}

// Recuerda para que codigo se confirmo que ya existe una foto guardada,
// para poder preguntar "deseas reemplazarla" si el usuario elige otra
// manualmente para ese mismo codigo.
let codigoImagenExistenteActual = null;

// Consulta si ya hay una foto guardada para este codigo aunque el
// producto todavia no se haya dado de alta (las fotos importadas por
// lote se guardan por codigo, esperando a que exista el producto) --
// antes solo se detectaba al EDITAR un producto ya existente.
async function verificarImagenExistenteParaCodigo(codigo) {
 if (!codigo) {
 codigoImagenExistenteActual = null;
 marcarImagenProductoEncontrada(false);
 codigoImagenExistenteActual = null;
 return;
 }

 try {
 const respuesta =
 await fetch(`/fotos-producto-existe/${encodeURIComponent(codigo)}`);

 const datos =
 await respuesta.json();

 const existe =
 Boolean(datos.ok && datos.existe);

 codigoImagenExistenteActual = existe ? codigo : null;

 marcarImagenProductoEncontrada(existe);
 mostrarImagenPreviewProducto(existe ? datos.imagenUrl : "");
 } catch (error) {
 // Silencioso -- no interrumpe el formulario si falla la consulta.
 }
}

// Datos del banco compartido de Nexo para el codigo actual (codigo,
// imagenUrl, marca, ancho, alto, totalFotos) -- este negocio todavia no
// copio esa foto a su propia ficha.
let datosBancoImagenesActual = null;

// Banco de Nexo (Pro-only, ver banco-imagenes-server.js) -- solo tiene
// sentido avisar cuando el negocio NO tiene ya su propia foto para este
// codigo. El servidor decide si el plan alcanza (nunca se filtra plan
// del lado del cliente): un negocio sin Pro simplemente recibe
// existe:false, sin revelar si el banco tiene algo o no.
async function verificarBancoImagenesParaCodigo(codigo) {
 if (!codigo || codigoImagenExistenteActual === codigo) {
 renderTarjetaBancoImagenes(null);
 renderTarjetaSolicitarFotoBanco(null);
 datosBancoImagenesActual = null;
 return;
 }

 try {
 const respuesta =
 await fetch(`/banco-imagenes-existe/${encodeURIComponent(codigo)}`);

 const datos =
 await respuesta.json();

 const existe =
 Boolean(datos.ok && datos.existe);

 datosBancoImagenesActual = existe ? { codigo, ...datos } : null;

 if (existe) {
 renderTarjetaSolicitarFotoBanco(null);
 renderTarjetaBancoImagenes(datos);
 } else {
 renderTarjetaBancoImagenes(null);
 renderTarjetaSolicitarFotoBanco(codigo);
 }
 } catch (error) {
 // Silencioso -- no interrumpe el formulario si falla la consulta.
 }
}

// Estado vacio "no encontramos imagenes" -- solo tiene sentido cuando el
// negocio no tiene ya su propia foto NI hay match en el banco compartido.
// Mismo mecanismo de insercion segura que renderTarjetaBancoImagenes:
// hermana del <label class="campo-ficha">, nunca dentro.
function renderTarjetaSolicitarFotoBanco(codigo) {
 const campo =
 document.getElementById("nuevaImagenProducto");

 const wrapperLabel =
 campo?.closest(".campo-ficha");

 if (!wrapperLabel) return;

 let tarjeta =
 document.getElementById("tarjetaSolicitarFotoBanco");

 if (!codigo) {
 tarjeta?.remove();
 return;
 }

 if (!tarjeta) {
 tarjeta = document.createElement("div");
 tarjeta.id = "tarjetaSolicitarFotoBanco";
 tarjeta.className = "tarjeta-solicitar-foto-banco";
 wrapperLabel.insertAdjacentElement("afterend", tarjeta);
 }

 tarjeta.innerHTML = `
 <span>No encontramos imagenes para este producto.</span>
 <button type="button" onclick="solicitarFotoBancoNexo('${String(codigo).replace(/'/g, "\\'")}')">Solicitar fotografia</button>
 `;
}

// Registra la solicitud en el banco compartido -- el boton siempre se
// muestra sin importar el plan (el servidor decide, nunca el cliente,
// mismo criterio que el resto del Banco de Nexo). Se resuelve sola
// cuando el admin importe un ZIP con este codigo.
async function solicitarFotoBancoNexo(codigo) {
 const boton =
 document.querySelector("#tarjetaSolicitarFotoBanco button");

 if (boton) {
 boton.disabled = true;
 boton.textContent = "Solicitando...";
 }

 try {
 const marca =
 document.getElementById("nuevaMarca")?.value.trim() || "";

 const respuesta =
 await fetch(`/banco-imagenes/solicitar/${encodeURIComponent(codigo)}`, {
 method: "POST",
 headers: { "Content-Type": "application/json" },
 body: JSON.stringify(marca ? { marca } : {})
 });

 if (respuesta.status === 403) {
 // Plan sin acceso -- el servidor decide, no se revela nada del
 // lado del cliente, solo se deja el boton como estaba.
 if (boton) {
 boton.disabled = false;
 boton.textContent = "Solicitar fotografia";
 }
 return;
 }

 const datos =
 await respuesta.json();

 if (!datos.ok) {
 if (boton) {
 boton.disabled = false;
 boton.textContent = "Solicitar fotografia";
 }
 return;
 }

 if (boton) {
 boton.textContent = "Fotografia solicitada";
 }
 } catch (error) {
 if (boton) {
 boton.disabled = false;
 boton.textContent = "Solicitar fotografia";
 }
 }
}

// Copia la foto del banco compartido a la ficha propia del negocio.
// Sin dialogo de confirmacion extra -- es una accion de bajo riesgo y
// facil de repetir/reemplazar despues. galeriaId opcional: si se pasa
// (desde la galeria de seleccion), /usar promueve esa foto a principal
// en vez de copiar la principal actual tal cual. Regresa true/false para
// que quien llame (ej. la galeria) sepa si debe cerrarse.
async function usarImagenBancoNexo(galeriaId = null) {
 if (!datosBancoImagenesActual) return false;

 const codigo = datosBancoImagenesActual.codigo;

 try {
 const respuesta =
 await fetch(`/banco-imagenes/${encodeURIComponent(codigo)}/usar`, {
 method: "POST",
 headers: { "Content-Type": "application/json" },
 body: JSON.stringify(galeriaId ? { galeriaId } : {})
 });

 const datos =
 await respuesta.json();

 if (!datos.ok) {
 await alertaPOS(datos.error || "No se pudo copiar la imagen del banco.", "Error", "alerta");
 return false;
 }

 datosBancoImagenesActual = null;
 renderTarjetaBancoImagenes(null);
 await verificarImagenExistenteParaCodigo(codigo);
 return true;
 } catch (error) {
 await alertaPOS("No se pudo copiar la imagen del banco.", "Error", "alerta");
 return false;
 }
}

// Galeria del banco de Nexo para elegir cual foto se vuelve la principal --
// mismo esqueleto que pedirModoVentaPOS (pos-piece-sale-modal.js): modal
// creado/reusado por id, cerrar() con guardia de doble-cierre, Escape para
// cancelar. A diferencia de esos modales, cada miniatura ejecuta la accion
// de inmediato al hacer clic (mismo criterio de bajo riesgo ya usado para
// "Usar esta imagen": sin dialogo de confirmacion extra).
async function abrirGaleriaBancoImagenesPOS() {
 if (!datosBancoImagenesActual) return;

 const codigo = datosBancoImagenesActual.codigo;

 let datosGaleria;
 try {
 const respuesta =
 await fetch(`/banco-imagenes/${encodeURIComponent(codigo)}/galeria`);
 datosGaleria = await respuesta.json();
 } catch (error) {
 await alertaPOS("No se pudo cargar la galeria del banco.", "Error", "alerta");
 return;
 }

 if (!datosGaleria?.ok) {
 await alertaPOS(datosGaleria?.error || "No se pudo cargar la galeria del banco.", "Error", "alerta");
 return;
 }

 let modal =
 document.getElementById("modalGaleriaBancoImagenesPOS");

 if (!modal) {
 modal = document.createElement("div");
 modal.id = "modalGaleriaBancoImagenesPOS";
 modal.className = "modal-personalizado modal-galeria-banco-nexo";
 document.body.appendChild(modal);
 }

 let cerrado = false;

 const cerrar = () => {
 if (cerrado) return;
 cerrado = true;
 modal.style.display = "none";
 modal.innerHTML = "";
 document.removeEventListener("keydown", manejarTecladoGaleriaBancoNexo, true);
 };

 const elegir = async (galeriaId, boton) => {
 boton.disabled = true;
 boton.classList.add("galeria-banco-nexo-cargando");
 const ok = await usarImagenBancoNexo(galeriaId);
 if (ok) {
 cerrar();
 } else {
 boton.disabled = false;
 boton.classList.remove("galeria-banco-nexo-cargando");
 }
 };

 const todasLasFotos = [
 { esPrincipal: true, ...datosGaleria.principal },
 ...datosGaleria.galeria.map(item => ({ esPrincipal: false, ...item }))
 ];

 modal.innerHTML = `
 <div class="modal-card galeria-banco-nexo-card">
 <div class="modal-card-header">
 <div>
 <span>Banco de Nexo</span>
 <h3>Elige la foto principal</h3>
 </div>
 <button type="button" class="galeria-banco-nexo-cerrar" data-accion="cerrar">Cerrar</button>
 </div>
 <div class="galeria-banco-nexo-grid">
 ${todasLasFotos.map(foto => `
 <button type="button"
 class="galeria-banco-nexo-item${foto.esPrincipal ? " galeria-banco-nexo-item-actual" : ""}"
 ${foto.esPrincipal ? "disabled" : `data-galeria-id="${foto.id}"`}>
 <img src="${foto.url}" alt="">
 ${foto.esPrincipal ? `<span class="galeria-banco-nexo-tag">Principal actual</span>` : ""}
 ${foto.ancho && foto.alto ? `<small>${foto.ancho}×${foto.alto}</small>` : ""}
 </button>
 `).join("")}
 </div>
 </div>
 `;

 modal.style.display = "flex";

 modal.querySelector("[data-accion='cerrar']").onclick = () => cerrar();

 modal.querySelectorAll("[data-galeria-id]").forEach(boton => {
 boton.onclick = () => elegir(Number(boton.dataset.galeriaId), boton);
 });

 function manejarTecladoGaleriaBancoNexo(event) {
 if (event.key === "Escape") {
 event.preventDefault();
 cerrar();
 }
 }

 document.addEventListener("keydown", manejarTecladoGaleriaBancoNexo, true);
}

function limpiarTextoCatalogo(valor) {
 return String(valor || "")
 .replace(/^=+/, "")
 .replace(/^"+|"+$/g, "")
 .trim();
}

function separarFilaCatalogo(linea) {
 const partes = [];
 let actual = "";
 let enComillas = false;
 const textoLinea =
 String(linea || "");

 const contarSeparador = separador => {
 let total = 0;
 let dentroComillas = false;

 for (let i = 0; i < textoLinea.length; i++) {
 const caracter = textoLinea[i];
 const siguiente = textoLinea[i + 1];

 if (caracter === '"' && siguiente === '"') {
 i++;
 continue;
 }

 if (caracter === '"') {
 dentroComillas = !dentroComillas;
 continue;
 }

 if (caracter === separador && !dentroComillas) {
 total++;
 }
 }

 return total;
 };

 const separador =
 [
 ",",
 ";",
 "\t"
 ].sort((a, b) => contarSeparador(b) - contarSeparador(a))[0] || ",";

 for (let i = 0; i < textoLinea.length; i++) {
 const caracter = textoLinea[i];
 const siguiente = textoLinea[i + 1];

 if (caracter === '"' && siguiente === '"') {
 actual += '"';
 i++;
 continue;
 }

 if (caracter === '"') {
 enComillas = !enComillas;
 continue;
 }

 if (caracter === separador && !enComillas) {
 partes.push(actual);
 actual = "";
 continue;
 }

 actual += caracter;
 }

 partes.push(actual);
 return partes.map(limpiarTextoCatalogo);
}

function dividirLineasCatalogo(csv) {
 const texto =
 String(csv || "");

 const lineas = [];
 let actual = "";
 let enComillas = false;

 for (let i = 0; i < texto.length; i++) {
 const caracter = texto[i];

 if (caracter === '"') {
 enComillas = !enComillas;
 actual += caracter;
 continue;
 }

 if (caracter === "\r") continue;

 if (caracter === "\n" && !enComillas) {
 lineas.push(actual);
 actual = "";
 continue;
 }

 actual += caracter;
 }

 if (actual) lineas.push(actual);

 return lineas;
}

function normalizarEncabezadoCatalogo(valor) {
 return limpiarTextoCatalogo(valor)
 .toLowerCase()
 .normalize("NFD")
 .replace(/[\u0300-\u036f]/g, "")
 .replace(/[^a-z0-9]+/g, " ")
 .trim();
}

function numeroCatalogo(valor) {
 const limpio =
 limpiarTextoCatalogo(valor)
 .replace(/[^0-9.,-]/g, "")
 .replace(/,/g, "");

 const numero =
 Number(limpio);

 return Number.isFinite(numero) ? numero : "";
}

function detectarColumnasCatalogo(lineas) {
 const muestra =
 lineas.slice(0, 12);

 let mejor = {
 indice: -1,
 puntaje: 0,
 columnas: {}
 };

 const reglas = [
 {
 clave: "codigo",
 puntos: 5,
 prueba: texto => /\b(codigo|cod|clave|barcode|barra|barras|ean|upc)\b/.test(texto)
 },
 {
 clave: "nombre",
 puntos: 4,
 prueba: texto => /\b(producto|articulo|nombre|concepto|modelo)\b/.test(texto)
 },
 {
 clave: "descripcion",
 puntos: 5,
 prueba: texto => /\b(descripcion|desc|detalle|caracteristicas)\b/.test(texto)
 },
 {
 clave: "marca",
 puntos: 4,
 prueba: texto => /\b(marca|linea|fabricante)\b/.test(texto)
 },
 {
 clave: "codigoInterno",
 puntos: 4,
 prueba: texto => /\b(clave|sku|modelo|codigo interno|codigo proveedor|referencia|ref)\b/.test(texto)
 && !/\b(barra|barras|ean|upc)\b/.test(texto)
 },
 {
 clave: "categoria",
 puntos: 3,
 prueba: texto => /\b(categoria|familia|depto|departamento|grupo)\b/.test(texto)
 },
 {
 clave: "medioMayoreoIva",
 puntos: 8,
 prueba: texto =>
 /\b(mayoreo|may)\b/.test(texto) &&
 /(iva|impuesto|c iva|con iva)/.test(texto) &&
 !/\b(distribuidor|subdistribuidor|minimo|minima)\b/.test(texto)
 },
 {
 clave: "medioMayoreo",
 puntos: 6,
 prueba: texto =>
 /\b(mayoreo|may)\b/.test(texto) &&
 !/\b(distribuidor|subdistribuidor|minimo|minima|iva)\b/.test(texto)
 },
 {
 clave: "publico",
 puntos: 4,
 prueba: texto =>
 /\b(publico|pub|menudeo|lista)\b/.test(texto) &&
 !/\b(minimo|minima)\b/.test(texto)
 },
 {
 clave: "distribuidor",
 puntos: 4,
 prueba: texto =>
 /\b(distribuidor|costo|neto|proveedor)\b/.test(texto) &&
 !/\b(subdistribuidor)\b/.test(texto)
 },
 {
 clave: "stockMinimo",
 puntos: 3,
 prueba: texto => /stock/.test(texto) && /(minimo|min)/.test(texto)
 },
 {
 clave: "altaRotacion",
 puntos: 2,
 prueba: texto => /rotacion/.test(texto)
 }
 ];

 muestra.forEach((linea, indice) => {
 const datos =
 separarFilaCatalogo(linea);

 const columnas = {};
 let puntaje = 0;

 datos.forEach((dato, columna) => {
 const texto =
 normalizarEncabezadoCatalogo(dato);

 reglas.forEach(regla => {
 if (columnas[regla.clave] === undefined && regla.prueba(texto)) {
 columnas[regla.clave] = columna;
 puntaje += regla.puntos;
 }
 });
 });

 if (puntaje > mejor.puntaje) {
 mejor = {
 indice,
 puntaje,
 columnas
 };
 }
 });

 return mejor.puntaje >= 6
 ? mejor
 : {
 indice: -1,
 puntaje: 0,
 columnas: {}
 };
}

function valorColumnaCatalogo(datos, columnas, clave) {
 const indice =
 columnas[clave];

 return indice === undefined
 ? ""
 : limpiarTextoCatalogo(datos[indice]);
}

function valorMapeoCatalogo(datos, mapeo, clave) {
 const indice =
 mapeo?.[clave];

 return indice === "" || indice === undefined
 ? ""
 : limpiarTextoCatalogo(datos[indice]);
}

const CAMPOS_CATALOGO_COMPACTO = [
 "codigoBarras",
 "codigoInterno",
 "claveProveedor",
 "codigosAlternos",
 "nombre",
 "unidadVenta",
 "costo",
 "medioMayoreo",
 "publico",
 "marca",
 "categoria"
];

const MAPEO_CATALOGO_COMPACTO =
 CAMPOS_CATALOGO_COMPACTO.reduce((mapa, campo, indice) => {
 mapa[campo] = indice;
 return mapa;
 }, {});

function escaparCsvCatalogo(valor) {
 const texto =
 limpiarTextoCatalogo(valor);

 return /[",\n\r]/.test(texto)
 ? `"${texto.replace(/"/g, '""')}"`
 : texto;
}

function esCatalogoCompacto(csv) {
 const primeraLinea =
 dividirLineasCatalogo(csv)
 .find(linea => linea.trim()) || "";

 return primeraLinea.includes("__pos_codigoBarras");
}

function valorCatalogoParaCompactar(datos, columnas, mapeo, campo) {
 if (campo === "codigosAlternos") {
 const codigos =
 datos
 .map(normalizarCodigo)
 .filter(codigo =>
 codigo &&
 /^\d{4,14}$/.test(codigo)
 );

 return [...new Set(codigos)].join("|");
 }

 const desdeMapeo =
 valorMapeoCatalogo(datos, mapeo, campo);

 if (desdeMapeo) return desdeMapeo;

 const equivalencias = {
 codigoBarras: "codigo",
 codigoInterno: "codigoInterno",
 claveProveedor: "codigoInterno",
 nombre: "nombre",
 costo: "distribuidor",
 medioMayoreo: "medioMayoreoIva",
 publico: "publico",
 marca: "marca",
 categoria: "categoria"
 };

 return valorColumnaCatalogo(
 datos,
 columnas,
 equivalencias[campo] || campo
 );
}

function compactarCsvCatalogo(csv, mapeo = {}) {
 if (esCatalogoCompacto(csv)) {
 const lineasCompactas =
 dividirLineasCatalogo(csv)
 .map(linea => linea.trim())
 .filter(Boolean);

 return {
 csv,
 mapeo: { ...MAPEO_CATALOGO_COMPACTO },
 productos: Math.max(0, lineasCompactas.length - 1)
 };
 }

 const lineas =
 dividirLineasCatalogo(csv)
 .map(linea => linea.trim())
 .filter(Boolean);

 const mapaColumnas =
 detectarColumnasCatalogo(lineas);

 const encabezado =
 CAMPOS_CATALOGO_COMPACTO
 .map(campo => `__pos_${campo}`)
 .join(",");

 const filas =
 lineas
 .filter((linea, indice) => indice !== mapaColumnas.indice)
 .map(linea => {
 const datos =
 separarFilaCatalogo(linea);

 const columnas =
 mapaColumnas.columnas || {};

 const valores =
 CAMPOS_CATALOGO_COMPACTO.map(campo =>
 valorCatalogoParaCompactar(
 datos,
 columnas,
 mapeo,
 campo
 )
 );

 const tieneIdentidad =
 valores[0] || valores[1] || valores[2] || valores[3];

 return tieneIdentidad
 ? valores.map(escaparCsvCatalogo).join(",")
 : "";
 })
 .filter(Boolean);

 return {
 csv: [encabezado, ...filas].join("\n"),
 mapeo: { ...MAPEO_CATALOGO_COMPACTO },
 productos: filas.length
 };
}

function prepararCatalogoParaGuardar(catalogo) {
 const compacto =
 compactarCsvCatalogo(
 catalogo.csv || "",
 catalogo.mapeo || {}
 );

 return {
 ...catalogo,
 csv: compacto.csv,
 mapeo: compacto.mapeo,
 productos: compacto.productos || catalogo.productos || 0
 };
}

function esValorNumericoCatalogo(valor) {
 const limpio =
 limpiarTextoCatalogo(valor)
 .replace(/[$,\s]/g, "");

 return limpio !== "" && !Number.isNaN(Number(limpio));
}

function pareceCodigoCatalogo(valor) {
 const compacto =
 String(valor || "").replace(/[^0-9a-zA-Z]/g, "");

 if (!compacto) return false;

 const digitos =
 (compacto.match(/[0-9]/g) || []).length;

 return digitos >= 6 && digitos / compacto.length >= 0.8;
}

function codigoInternoDeProducto(producto) {
 const alternos =
 Array.isArray(producto?.codigos_relacionados)
 ? producto.codigos_relacionados
 : [];

 const claveInterna =
 alternos.find(item =>
 item.tipo === "alterno" &&
 /^[0-9]{4,7}$/.test(String(item.codigo || "").trim())
 );

 return claveInterna?.codigo || producto?.codigo || "";
}

function nombreProductoDesdeFilaCatalogo(datos, indiceCodigo) {
 const candidatos =
 datos
 .map(limpiarTextoCatalogo)
 .filter((valor, indice) =>
 indice !== indiceCodigo
 &&
 valor.length >= 5
 &&
 !esValorNumericoCatalogo(valor)
 &&
 !/^\d{6,}$/.test(normalizarCodigo(valor))
 &&
 !pareceCodigoCatalogo(valor)
 )
 .sort((a, b) => b.length - a.length);

 return candidatos[0] || "Producto sin nombre";
}

function detectarMarcaDesdeFilaCatalogo(datos) {
 const marcas =
 [
 "Truper",
 "Volteck",
 "Fiero",
 "Pretul",
 "Foset",
 "Hermex",
 "Klintek",
 "Expert",
 "Diprofer"
 ];

 const texto =
 datos
 .map(limpiarTextoCatalogo)
 .join(" ")
 .toLowerCase();

 return marcas.find(marca =>
 texto.includes(marca.toLowerCase())
 ) || "";
}

function inferirMarcaPorCodigo(codigo) {
 const limpio =
 normalizarCodigo(codigo);

 if (
 limpio.startsWith("75012066") ||
 limpio.startsWith("7506240")
 ) {
 return "Truper";
 }

 return "";
}

function codigoInternoDesdeFilaCatalogo(datos, codigoPrincipal) {
 const principal =
 normalizarCodigo(codigoPrincipal);

 const candidatos =
 datos
 .map(limpiarTextoCatalogo)
 .map(normalizarCodigo)
 .filter(codigo =>
 codigo &&
 codigo !== principal &&
 /^[a-zA-Z0-9]{3,10}$/.test(codigo) &&
 !/^\d{11,14}$/.test(codigo)
 )
 .sort((a, b) => a.length - b.length);

 return candidatos[0] || "";
}

function esCodigoBarras(texto) {
 const codigo =
 normalizarCodigo(texto);

 return /^\d{8,14}$/.test(codigo);
}

function codigosProducto(producto) {
 const codigos = [];

 if (producto?.codigo) codigos.push(producto.codigo);

 if (Array.isArray(producto?.codigos_relacionados)) {
 producto.codigos_relacionados.forEach(item => {
 if (item?.codigo) codigos.push(item.codigo);
 });
 }

 return codigos
 .map(normalizarCodigo)
 .filter(Boolean);
}

function buscarProductoLocalPorCodigo(codigo) {
 const limpio =
 normalizarCodigo(codigo);

 if (!limpio) return null;

 return todosProductos.find(producto =>
 normalizarCodigo(producto.id) === limpio ||
 codigosProducto(producto).includes(limpio)
 ) || null;
}

function precioVentaProducto(producto) {
 return Number(
 producto?.precio ||
 producto?.precio_mayoreo ||
 producto?.precio_publico ||
 producto?.precio_distribuidor ||
 0
 );
}

function unidadProducto(producto = {}) {
 return String(
 producto.unidad_venta ||
 producto.unidadVenta ||
 "pieza"
 ).toLowerCase();
}

function esUnidadDecimal(unidad) {
 return [
 "kg",
 "kilo",
 "gramo",
 "metro",
 "litro"
 ].includes(String(unidad || "").toLowerCase());
}

function pasoUnidad(unidad) {
 return esUnidadDecimal(unidad) ? 0.1 : 1;
}

// La venta "suelta" (permite_venta_pieza) ya no asume que lo suelto
// siempre es "pieza" -- unidad_suelta dice que es (pieza, kg, litro,
// metro, gramo). Este lookup da singular/plural/genero para armar
// frases naturales ("Bulto completo", "Vender por kilo", "2.5 kg
// sueltos") tanto en el formulario como en el modal del POS.
const ETIQUETAS_UNIDAD_VENTA_TEXTO = {
 pieza: { singular: "pieza", plural: "piezas", fem: true },
 metro: { singular: "metro", plural: "metros", fem: false },
 kg: { singular: "kilo", plural: "kilos", fem: false },
 kilo: { singular: "kilo", plural: "kilos", fem: false },
 litro: { singular: "litro", plural: "litros", fem: false },
 gramo: { singular: "gramo", plural: "gramos", fem: false },
 caja: { singular: "caja", plural: "cajas", fem: true },
 bolsa: { singular: "bolsa", plural: "bolsas", fem: true },
 paquete: { singular: "paquete", plural: "paquetes", fem: false },
 tramo: { singular: "tramo", plural: "tramos", fem: false },
 rollo: { singular: "rollo", plural: "rollos", fem: false },
 saco: { singular: "saco", plural: "sacos", fem: false },
 bulto: { singular: "bulto", plural: "bultos", fem: false },
 servicio: { singular: "servicio", plural: "servicios", fem: false }
};

function etiquetaUnidadVenta(unidad) {
 const clave = String(unidad || "pieza").toLowerCase();
 return ETIQUETAS_UNIDAD_VENTA_TEXTO[clave] || { singular: clave, plural: `${clave}s`, fem: false };
}

// "Bulto completo" / "Bolsa completa" segun el genero de la unidad.
function etiquetaContenedorCompleto(unidadVenta) {
 const etiqueta = etiquetaUnidadVenta(unidadVenta);
 const nombre = etiqueta.singular.charAt(0).toUpperCase() + etiqueta.singular.slice(1);
 return `${nombre} ${etiqueta.fem ? "completa" : "completo"}`;
}

function unidadSueltaDeProducto(producto = {}) {
 return String(producto.unidad_suelta || producto.unidadSuelta || "pieza").toLowerCase();
}

// Texto del boton de venta suelta en el modal del POS -- "Vender por
// kilo" para unidades decimales (kg/litro/metro/gramo, no tiene
// sentido contar "kilos sueltos" uno por uno) vs "Piezas sueltas" /
// "Cajas sueltas" para unidades enteras.
// Sufijo del nombre en el renglon del carrito -- "(pieza suelta)" para
// unidades enteras (compatibilidad con el texto original), "(por
// kilo)" para unidades decimales.
function sufijoNombreVentaSuelta(unidad) {
 const etiqueta = etiquetaUnidadVenta(unidad);

 if (esUnidadDecimal(unidad)) {
 return ` (por ${etiqueta.singular})`;
 }

 return ` (${etiqueta.singular} ${etiqueta.fem ? "suelta" : "suelto"})`;
}

function etiquetaBotonVentaSuelta(unidad) {
 const etiqueta = etiquetaUnidadVenta(unidad);

 if (esUnidadDecimal(unidad)) {
 return `Vender por ${etiqueta.singular}`;
 }

 const pluralCap = etiqueta.plural.charAt(0).toUpperCase() + etiqueta.plural.slice(1);
 return `${pluralCap} ${etiqueta.fem ? "sueltas" : "sueltos"}`;
}

function piezasSueltasInfoCelda(producto) {
 if (!producto?.permite_venta_pieza) return "";

 const piezas =
 Number(producto.piezas_sueltas_stock || 0);

 const etiqueta =
 etiquetaUnidadVenta(unidadSueltaDeProducto(producto));

 return `<br><small class="pieza-stock-info">+ ${piezas} ${etiqueta.plural} sueltos</small>`;
}

function formatearCantidad(cantidad, unidad = "pieza") {
 const numero =
 Number(cantidad || 0);

 const unidadLimpia =
 String(unidad || "pieza").toLowerCase();

 if (unidadLimpia === "metro" && numero > 0 && numero < 1) {
  return `${Number((numero * 100).toFixed(1))} cm`;
 }

 if ((unidadLimpia === "kg" || unidadLimpia === "kilo") && numero > 0 && numero < 1) {
  return `${Number((numero * 1000).toFixed(0))} g`;
 }

 if (unidadLimpia === "litro" && numero > 0 && numero < 1) {
  return `${Number((numero * 1000).toFixed(0))} ml`;
 }

 const decimales =
 esUnidadDecimal(unidad) ? 3 : 0;

 return `${Number(numero.toFixed(decimales))} ${unidad}`;
}

function generarCodigoInternoProducto(tipo = "manual", categoria = "") {
 const prefijoBase =
 tipo === "granel"
 ? "GR"
 : tipo === "servicio"
 ? "SRV"
 : "GEN";

 const categoriaLimpia =
 normalizarTexto(categoria)
 .replace(/[^a-z0-9]/g, "")
 .slice(0, 3)
 .toUpperCase();

 const prefijo =
 categoriaLimpia || prefijoBase;

 const consecutivo =
 String(Date.now()).slice(-6);

 return `${prefijo}-${consecutivo}`;
}

function esCodigoAutomaticoProducto(valor = "") {
 return /^(GEN|GR|[A-Z0-9]{1,3})-\d{6}$/.test(
 String(valor || "").trim().toUpperCase()
 );
}

function asignarCodigoAutomaticoProducto(tipoFinal) {
 const codigo =
 document.getElementById("nuevoCodigo");

 if (!codigo) return;

 const valorActual =
 codigo.value.trim();

 if (
 valorActual &&
 !codigo.dataset.codigoAutomatico &&
 !esCodigoAutomaticoProducto(valorActual)
 ) return;

 codigo.value =
 generarCodigoInternoProducto(
 tipoFinal,
 document.getElementById("nuevaCategoria")?.value || ""
 );

 codigo.dataset.codigoAutomatico =
 "1";
}

function seleccionarTipoProducto(tipo) {
 const tipoFinal =
 tipo || "catalogo";

 const campoTipo =
 document.getElementById("tipoProductoInventario");

 if (campoTipo) {
 campoTipo.value = tipoFinal;
 }

 document
 .querySelectorAll(".tipo-producto-card")
 .forEach(boton => {
 boton.classList.toggle(
 "activo",
 boton.dataset.tipoProducto === tipoFinal
 );
 });

 const seccionProveedor =
 document.getElementById("proveedorCatalogoSeccion");

 const seccionModoCaptura =
 document.getElementById("modoCapturaSeccion");

 if (seccionProveedor) {
 seccionProveedor.style.display =
 tipoFinal === "catalogo" ? "grid" : "none";
 }

 if (seccionModoCaptura) {
 seccionModoCaptura.style.display =
 tipoFinal === "catalogo" ? "block" : "none";
 }

 const codigo =
 document.getElementById("nuevoCodigo");

 const codigoInterno =
 document.getElementById("nuevoCodigoInterno");

 const unidad =
 document.getElementById("unidadVenta");

 const factor =
 document.getElementById("factorConversion");

 const bascula =
 document.getElementById("basculaDigital");

 if (tipoFinal === "manual") {
 if (codigo) {
 codigo.placeholder = "Codigo automatico o codigo opcional";
 asignarCodigoAutomaticoProducto("manual");
 }
 if (codigoInterno) codigoInterno.placeholder = "Clave proveedor / modelo opcional";
 if (unidad && !unidad.value) unidad.value = "pieza";
 }

 if (tipoFinal === "granel") {
 if (codigo) {
 codigo.placeholder = "Codigo automatico para granel";
 asignarCodigoAutomaticoProducto("granel");
 }
 if (codigoInterno) codigoInterno.placeholder = "Clave proveedor / referencia opcional";
 if (unidad) unidad.value = "kg";
 if (factor && !factor.value) factor.value = "1";
 if (bascula) bascula.value = "preparado";
 }

 if (tipoFinal === "servicio") {
 if (codigo) {
 codigo.placeholder = "Codigo automatico del servicio";
 asignarCodigoAutomaticoProducto("servicio");
 }
 if (codigoInterno) codigoInterno.placeholder = "Clave interna opcional";
 if (unidad) unidad.value = "servicio";
 if (factor && !factor.value) factor.value = "1";
 if (bascula) bascula.value = "no";

 const stock =
 document.getElementById("nuevoStock");

 const stockMinimo =
 document.getElementById("stockMinimo");

 if (stock && !stock.value) stock.value = "1";
 if (stockMinimo && !stockMinimo.value) stockMinimo.value = "0";
 }

 if (tipoFinal === "catalogo" && codigo) {
 codigo.placeholder = "Codigo de barras";

 if (codigo.dataset.codigoAutomatico || esCodigoAutomaticoProducto(codigo.value)) {
 codigo.value = "";
 delete codigo.dataset.codigoAutomatico;
 }

 if (codigoInterno) {
 codigoInterno.placeholder = "Codigo interno / clave proveedor";
 }
 }
}

function programarLecturaCodigoBarras(texto) {
 clearTimeout(temporizadorCodigoBarras);

 if (!esCodigoBarras(texto)) return;

 temporizadorCodigoBarras =
 setTimeout(() => {
 procesarCodigoBarrasPos(
 normalizarCodigo(texto)
 );
 }, 220);
}

function productoDesdeCatalogo(codigo) {
 const codigoNormalizado =
 normalizarCodigo(codigo);

 const catalogos =
 catalogosGuardados();

 const fuentes =
 catalogos.length > 0
 ? catalogos
 : [
 {
 proveedor: "",
 csv: localStorage.getItem(
 "catalogoProveedorCsv"
 ) || ""
 }
 ];

 for (const catalogoProveedor of fuentes) {
 const catalogoGuardado =
 catalogoProveedor.csv || "";

 const lineas =
 dividirLineasCatalogo(catalogoGuardado)
 .map(linea => linea.trim())
 .filter(linea => linea);

 const mapaColumnas =
 detectarColumnasCatalogo(lineas);

 const mapeoCatalogo =
 catalogoProveedor.mapeo || {};

 for (const linea of lineas) {
 const datos =
 separarFilaCatalogo(linea);

 const indicesCodigo =
 [
 mapeoCatalogo.codigoBarras,
 mapeoCatalogo.codigoInterno,
 mapeoCatalogo.claveProveedor,
 mapaColumnas.columnas.codigo,
 mapaColumnas.columnas.codigoInterno
 ]
 .filter(indice => indice !== "" && indice !== undefined);

 let indiceCodigo =
 indicesCodigo.find(indice =>
 normalizarCodigo(datos[indice]) === codigoNormalizado
 );

 const codigosAlternos =
 valorMapeoCatalogo(
 datos,
 mapeoCatalogo,
 "codigosAlternos"
 )
 .split("|")
 .map(normalizarCodigo)
 .filter(Boolean);

 const coincideCodigoAlterno =
 codigosAlternos.includes(codigoNormalizado);

 if (indiceCodigo === undefined) {
 indiceCodigo =
 datos.findIndex(
 dato =>
 normalizarCodigo(dato) ===
 codigoNormalizado
 );
 }

 if (indiceCodigo >= 0 || coincideCodigoAlterno) {
 const indiceCodigoProducto =
 indiceCodigo >= 0
 ? indiceCodigo
 : (
 mapeoCatalogo.codigoBarras ??
 mapeoCatalogo.codigoInterno ??
 mapeoCatalogo.claveProveedor ??
 0
 );

 const columnas =
 mapaColumnas.columnas || {};

 const parser =
 typeof parserCatalogoProveedor === "function"
 ? parserCatalogoProveedor(catalogoProveedor)
 : { extraerProducto: extraerProductoGenericoCatalogo };

 return parser.extraerProducto({
 datos,
 columnas,
 mapeoCatalogo,
 indiceCodigoProducto,
 codigoNormalizado,
 codigosAlternos,
 catalogoProveedor
 });
 }
 }
 }

 return null;
}

// Punto de entrada cuando se escanea un codigo durante una venta y no
// hay match en el inventario real, pero si en el catalogo del
// proveedor (ver pos-sales.js:procesarCodigoBarrasPos) -- delega todo
// el llenado de campos a aplicarProductoCatalogoAlFormulario (la misma
// funcion que usa el autocompletado dentro de Agregar producto) para
// no mantener dos copias de la misma logica; lo unico distinto en
// este flujo es que ya sabemos que se esta agregando 1 pieza.
async function llenarFormularioConProductoCatalogo(producto) {
 mostrarInventario();
 abrirFormularioAgregarProductoNuevo();

 await aplicarProductoCatalogoAlFormulario(producto, "barras");

 document.getElementById("nuevoStock").value = "1";
 document.getElementById("nuevoStock").setAttribute("autocomplete", "off");
}

function enfocarStockNuevoProducto() {
 [80, 250, 500, 900].forEach(tiempo => {
 setTimeout(() => {
 const codigo =
 document.getElementById("nuevoCodigo");

 const stock =
 document.getElementById("nuevoStock");

 codigo?.blur();
 stock?.focus();
 stock?.select();
 }, tiempo);
 });
}

// El boton vive como elemento estatico en index.html (seccion
// Precios) -- ya no se crea/inserta por JS, solo se busca. Se
// mantiene esta funcion (en vez de usar getElementById directo en
// cada sitio que la llama) porque varios lugares del archivo la
// invocan como "dame el boton, ya sea que exista o no".
function asegurarBotonSugerenciaPrecio() {
 return document.getElementById("sugerenciaPrecioProveedor");
}

async function mostrarSugerenciaPrecioProveedor(producto) {
 const boton =
 asegurarBotonSugerenciaPrecio();

 if (!boton) return;

 boton.style.display = "none";
 boton.onclick = null;

 if (!producto?.proveedor || typeof obtenerReglasPrecioProveedor !== "function") return;

 let reglas = null;

 try {
 reglas = await obtenerReglasPrecioProveedor(producto.proveedor);
 } catch (error) {
 console.warn(error);
 return;
 }

 if (!reglas) return;

 const calculo =
 calcularPrecioSugerido(reglas, {
 publico: producto.publico || producto.medioMayoreo || producto.distribuidor || "",
 categoria: producto.categoria || "",
 codigo: producto.codigo || ""
 });

 if (!calculo) return;

 boton.textContent =
 `Usar precio sugerido: $${calculo.precioSugerido.toFixed(2)} (margen ${calculo.margen}%)`;

 boton.style.display = "inline-flex";

 boton.onclick = () => {
 const campoPrecio =
 document.getElementById("nuevoPrecio");

 if (campoPrecio) campoPrecio.value = calculo.precioSugerido;
 };
}

function asegurarEtiquetasFichaProducto() {
 const etiquetas = {
 nuevoCodigo: "Codigo de barras",
 nuevoNombre: "Nombre para vender",
 nuevoCodigoInterno: "Codigo interno / clave proveedor",
 codigosRelacionados: "Codigos alternos",
 nuevaCategoria: "Categoria",
 nuevaMarca: "Marca",
 nuevaImagenProducto: "Foto del producto (opcional, se guarda al elegirla)",
 unidadVenta: "Unidad base de venta",
 presentacionCompra: "Presentacion de compra",
 factorConversion: "Equivalencia de compra",
 permiteVentaPieza: "Tambien se vende suelto (no solo el contenedor completo)",
 unidadSuelta: "Unidad en la que se vende suelto",
 piezasPorBolsa: "Cuanto trae el contenedor completo",
 precioPieza: "Precio por unidad suelta",
 nuevaTieneGarantia: "Tiene garantia",
 nuevoGarantiaDetalle: "Detalle de la garantia",
 nuevaNoAdmiteCambios: "No admite cambios (ej. cortado a la medida)",
 nuevoDestacado: "Destacado en el sitio web",
 nuevoPrecioOferta: "Precio de oferta para el sitio web (opcional)",
 precioDistribuidor: "Precio proveedor / costo",
 precioMayoreo: "Precio medio mayoreo",
 precioPublico: "Precio publico",
 nuevoPrecio: "Precio que usara el carrito",
 nuevoStock: "Stock actual",
 stockMinimo: "Stock minimo",
 nuevoStockMaximo: "Stock maximo",
 nuevoProveedor: "Proveedor principal",
 nuevaUbicacion: "Ubicacion",
 basculaDigital: "Bascula digital",
 nuevaDescripcion: "Descripcion / notas",
 altaRotacion: "Alta rotacion",
 nuevoPeso: "Peso",
 nuevoLargoCm: "Largo",
 nuevoAnchoCm: "Ancho",
 nuevoAltoCm: "Alto",
 nuevasNotasInternas: "Notas internas"
 };

 Object.entries(etiquetas).forEach(([id, texto]) => {
 const campo =
 document.getElementById(id);

 if (!campo || campo.closest(".campo-ficha")) return;

 const wrapper =
 document.createElement("label");

 wrapper.className =
 "campo-ficha";

 const etiqueta =
 document.createElement("span");

 etiqueta.textContent =
 texto;

 campo.parentNode.insertBefore(wrapper, campo);
 wrapper.appendChild(etiqueta);
 wrapper.appendChild(campo);
 });
}

// Subcategorias como "pastillas" -- el input real sigue siendo el mismo
// <input type="hidden" id="nuevaSubcategoria"> de siempre (texto separado
// por comas), asi que agregarProductoNuevo/editarProducto no cambian: solo
// se le agrega esta capa visual encima para escribir/quitar etiquetas.
function asegurarChipsSubcategoria() {
 const textoInput =
 document.getElementById("nuevaSubcategoriaTexto");

 if (!textoInput || textoInput.dataset.chipsListo === "1") return;

 textoInput.dataset.chipsListo = "1";

 textoInput.addEventListener("keydown", evento => {
 if (evento.key === "Enter" || evento.key === ",") {
 evento.preventDefault();
 agregarChipSubcategoria(textoInput.value);
 } else if (evento.key === "Backspace" && !textoInput.value) {
 quitarUltimoChipSubcategoria();
 }
 });

 textoInput.addEventListener("blur", () => {
 if (textoInput.value.trim()) agregarChipSubcategoria(textoInput.value);
 });
}

function chipsSubcategoriaActuales() {
 const oculto =
 document.getElementById("nuevaSubcategoria");

 return String(oculto?.value || "")
 .split(",")
 .map(texto => texto.trim())
 .filter(Boolean);
}

function renderChipsSubcategoria(chips) {
 const lista =
 document.getElementById("nuevaSubcategoriaChipLista");

 if (!lista) return;

 lista.innerHTML =
 chips.map((chip, indice) => `
 <span class="producto-chip">
 ${escaparPOS(chip)}
 <button type="button" onclick="quitarChipSubcategoria(${indice})" aria-label="Quitar ${escaparPOS(chip)}">×</button>
 </span>
 `).join("");
}

function guardarChipsSubcategoria(chips) {
 const oculto =
 document.getElementById("nuevaSubcategoria");

 if (oculto) oculto.value = chips.join(", ");

 renderChipsSubcategoria(chips);
}

function agregarChipSubcategoria(texto) {
 const limpio =
 String(texto || "").replace(/,/g, "").trim();

 const textoInput =
 document.getElementById("nuevaSubcategoriaTexto");

 if (textoInput) textoInput.value = "";

 if (!limpio) return;

 const chips =
 chipsSubcategoriaActuales();

 if (chips.some(chip => chip.toLowerCase() === limpio.toLowerCase())) return;

 chips.push(limpio);
 guardarChipsSubcategoria(chips);
}

function quitarChipSubcategoria(indice) {
 const chips =
 chipsSubcategoriaActuales();

 chips.splice(indice, 1);
 guardarChipsSubcategoria(chips);
}

function quitarUltimoChipSubcategoria() {
 const chips =
 chipsSubcategoriaActuales();

 chips.pop();
 guardarChipsSubcategoria(chips);
}

// Catalogo canonico de categorias de Nexo (ver categorias-nexo.js en el
// servidor) -- solo aplica al giro ferreteria; otros giros siguen
// usando el campo de texto libre de siempre (#nuevaCategoria visible +
// datalist). #nuevaCategoria sigue siendo el campo real que se manda al
// guardar -- los selects de departamento/subcategoria solo le asignan
// el valor, para no tocar el resto del formulario ni el envio.
let categoriasNexoArbol = null;
let categoriasNexoCargando = null;

function giroNegocioEsFerreteria() {
 const config =
 typeof configuracionNegocio === "function" ? configuracionNegocio() || {} : {};

 return (config.giroNegocio || "ferreteria") === "ferreteria";
}

async function cargarCategoriasNexo() {
 const campo = document.getElementById("categoriaNexoCampo");
 const campoLibre = document.getElementById("nuevaCategoria");

 if (!giroNegocioEsFerreteria()) {
  if (campo) campo.hidden = true;
  if (campoLibre) campoLibre.style.display = "";
  return;
 }

 if (campo) campo.hidden = false;
 if (campoLibre) campoLibre.style.display = "none";

 if (!categoriasNexoArbol) {
  if (!categoriasNexoCargando) {
   categoriasNexoCargando = fetch("/categorias-nexo")
    .then(respuesta => respuesta.json())
    .then(datos => (datos.ok ? datos.departamentos : []))
    .catch(() => []);
  }

  categoriasNexoArbol = await categoriasNexoCargando;

  const select =
   document.getElementById("categoriaNexoDepartamento");

  if (select) {
   select.innerHTML =
    '<option value="">Categoria (Nexo)...</option>' +
    categoriasNexoArbol
     .map(grupo => `<option value="${escaparPOS(grupo.departamento)}">${escaparPOS(grupo.departamento)}</option>`)
     .join("");
  }
 }

 verificarDisponibilidadIACategoriaNexo();
}

// Mismo criterio de deteccion ya usado para el boton de Nexo IA en
// otras pantallas (fetch a /ia/resumen-rapido, acceso.disponible) --
// si no hay cupo/plan, el boton simplemente no aparece, sin bloquear
// el selector manual.
async function verificarDisponibilidadIACategoriaNexo() {
 const boton =
  document.getElementById("detectarCategoriaIABtn");

 if (!boton) return;

 try {
  const respuesta = await fetch("/ia/resumen-rapido");
  const datos = await respuesta.json();
  boton.hidden = !(respuesta.ok && datos.ok && datos.acceso?.disponible !== false);
 } catch (error) {
  boton.hidden = true;
 }
}

function alCambiarDepartamentoCategoriaNexo() {
 const departamento =
  document.getElementById("categoriaNexoDepartamento")?.value || "";

 const selectSub =
  document.getElementById("categoriaNexoSubcategoria");

 if (!selectSub) return;

 const grupo =
  (categoriasNexoArbol || []).find(d => d.departamento === departamento);

 const subcategorias =
  grupo?.subcategorias || [];

 selectSub.innerHTML =
  '<option value="">Subcategoria...</option>' +
  subcategorias
   .map(s => `<option value="${s.id}">${escaparPOS(s.nombre)}</option>`)
   .join("");

 selectSub.disabled = subcategorias.length === 0;

 const campoLibre =
  document.getElementById("nuevaCategoria");

 if (campoLibre) campoLibre.value = departamento;

 const campoId =
  document.getElementById("categoriaNexoId");

 if (campoId) campoId.value = "";
}

function reiniciarCategoriaNexoCampo() {
 const selectDep =
  document.getElementById("categoriaNexoDepartamento");

 if (selectDep) selectDep.value = "";

 const selectSub =
  document.getElementById("categoriaNexoSubcategoria");

 if (selectSub) {
  selectSub.innerHTML = '<option value="">Subcategoria...</option>';
  selectSub.disabled = true;
 }

 const campoId =
  document.getElementById("categoriaNexoId");

 if (campoId) campoId.value = "";
}

function alElegirSubcategoriaCategoriaNexo() {
 const selectSub =
  document.getElementById("categoriaNexoSubcategoria");

 const opcion =
  selectSub?.selectedOptions?.[0];

 if (!opcion || !opcion.value) return;

 const campoId =
  document.getElementById("categoriaNexoId");

 if (campoId) campoId.value = opcion.value;

 agregarChipSubcategoria(opcion.textContent);
}

// Preselecciona los selects cuando se edita un producto que ya tiene
// categoria_nexo_id guardada (deteccion previa o eleccion manual
// anterior) -- productos viejos sin ese dato simplemente arrancan sin
// seleccion, conservando su texto libre tal cual.
async function preseleccionarCategoriaNexoProducto(producto) {
 if (!producto?.categoria_nexo_id) return;
 if (categoriasNexoCargando) await categoriasNexoCargando;

 const grupo =
  (categoriasNexoArbol || []).find(d =>
   d.subcategorias.some(s => Number(s.id) === Number(producto.categoria_nexo_id))
  );

 if (!grupo) return;

 const selectDep =
  document.getElementById("categoriaNexoDepartamento");

 if (selectDep) selectDep.value = grupo.departamento;

 alCambiarDepartamentoCategoriaNexo();

 const selectSub =
  document.getElementById("categoriaNexoSubcategoria");

 if (selectSub) selectSub.value = String(producto.categoria_nexo_id);

 alElegirSubcategoriaCategoriaNexo();
}

async function detectarCategoriaConIA() {
 const nombre =
  document.getElementById("nuevoNombre")?.value?.trim() || "";

 if (!nombre) {
  alertaPOS("Escribe primero el nombre del producto.", "Falta el nombre", "alerta");
  return;
 }

 const marca =
  document.getElementById("nuevaMarca")?.value?.trim() || "";

 const boton =
  document.getElementById("detectarCategoriaIABtn");

 if (boton) {
  boton.disabled = true;
  boton.textContent = "Detectando...";
 }

 try {
  const respuesta = await fetch("/ia/sugerir-categoria-nexo", {
   method: "POST",
   headers: { "Content-Type": "application/json" },
   body: JSON.stringify({ nombre, marca })
  });

  const datos = await respuesta.json();

  if (!respuesta.ok || !datos.ok || !datos.disponible) {
   alertaPOS("Nexo IA no esta disponible en tu plan por ahora.", "Sin IA", "alerta");
   return;
  }

  if (!datos.categoriaNexoId) {
   alertaPOS("No encontramos una categoria clara para ese nombre -- eligela a mano.", "Sin coincidencia", "info");
   return;
  }

  const selectDep =
   document.getElementById("categoriaNexoDepartamento");

  if (selectDep) selectDep.value = datos.departamento;

  alCambiarDepartamentoCategoriaNexo();

  const selectSub =
   document.getElementById("categoriaNexoSubcategoria");

  if (selectSub) selectSub.value = String(datos.categoriaNexoId);

  alElegirSubcategoriaCategoriaNexo();
 } catch (error) {
  alertaPOS("No se pudo consultar Nexo IA ahora mismo.", "Error", "alerta");
 } finally {
  if (boton) {
   boton.disabled = false;
   boton.textContent = "Detectar categoria con IA";
  }
 }
}

// Vista previa de la imagen del producto en el panel lateral -- se llama
// antes de subirImagenProductoManual() para mostrar de inmediato el
// archivo elegido, sin esperar a que termine de subirse.
function previsualizarImagenProductoFormulario(input) {
 const panel =
 document.getElementById("productoFormImagenPreview");

 const archivo =
 input?.files?.[0];

 if (!panel || !archivo) return;

 const lector =
 new FileReader();

 lector.onload = () => {
 panel.innerHTML = `<img src="${lector.result}" alt="Vista previa">`;
 };

 lector.readAsDataURL(archivo);
}

function mostrarImagenPreviewProducto(url) {
 const panel =
 document.getElementById("productoFormImagenPreview");

 if (!panel) return;

 panel.innerHTML =
 url
 ? `<img src="${url}" alt="Foto del producto">`
 : `<span>Sin foto</span>`;
}

function redimensionarImagenCanvas(archivo, anchoMax = 320) {
 return new Promise((resolve, reject) => {
 const lector =
 new FileReader();

 lector.onerror = () => reject(new Error("No se pudo leer el archivo"));

 lector.onload = () => {
 const img =
 new Image();

 img.onerror = () => reject(new Error("Archivo de imagen invalido"));

 img.onload = () => {
 const escala =
 Math.min(1, anchoMax / img.width);

 const canvas =
 document.createElement("canvas");

 canvas.width = Math.round(img.width * escala);
 canvas.height = Math.round(img.height * escala);

 const contexto =
 canvas.getContext("2d");

 contexto.drawImage(img, 0, 0, canvas.width, canvas.height);

 resolve(canvas.toDataURL("image/jpeg", 0.75));
 };

 img.src = lector.result;
 };

 lector.readAsDataURL(archivo);
 });
}

async function subirImagenProductoManual() {
 const input =
 document.getElementById("nuevaImagenProducto");

 const archivo =
 input?.files?.[0];

 if (!archivo) return;

 const codigo =
 normalizarCodigo(
 document.getElementById("nuevoCodigo")?.value ||
 document.getElementById("nuevoCodigoInterno")?.value ||
 ""
 );

 if (!codigo) {
 await alertaPOS(
 "Este producto todavia no tiene codigo. Escribe primero el codigo de barras o el codigo interno.",
 "Falta codigo",
 "alerta"
 );
 input.value = "";
 return;
 }

 if (codigoImagenExistenteActual === codigo) {
 const reemplazar =
 await confirmarPOS(
 "Este producto ya tiene una foto guardada. ¿Deseas reemplazarla por la que acabas de elegir?",
 "Ya existe una foto",
 "alerta"
 );

 if (!reemplazar) {
 input.value = "";
 return;
 }
 }

 try {
 const imagenBase64 =
 await redimensionarImagenCanvas(archivo, 320);

 const respuesta =
 await fetch(`/fotos-producto/${codigo}/principal`, {
 method: "POST",
 headers: { "Content-Type": "application/json" },
 body: JSON.stringify({ imagenBase64 })
 });

 const datos =
 await respuesta.json();

 if (!datos.ok) {
 throw new Error(datos.error || "No se pudo guardar la foto");
 }

 marcarImagenProductoEncontrada(true);

 await alertaPOS("Foto guardada correctamente.", "Listo", "exito");

 if (typeof cargarProductos === "function") await cargarProductos();
 } catch (error) {
 await alertaPOS(error.message || "No se pudo subir la foto.", "Error", "alerta");
 } finally {
 input.value = "";
 }
}

function togglePiezaCamposProducto() {
 const checkbox =
 document.getElementById("permiteVentaPieza");

 const activo =
 Boolean(checkbox?.checked);

 ["unidadSuelta", "piezasPorBolsa", "precioPieza"].forEach(id => {
 const campo =
 document.getElementById(id);

 const wrapper =
 campo?.closest(".campo-ficha") || campo;

 if (!wrapper) return;

 if (activo) {
 wrapper.style.removeProperty("display");
 } else {
 wrapper.style.setProperty("display", "none", "important");
 }
 });

 if (activo) actualizarEtiquetasPiezaCamposProducto();
}

// Los placeholders de "cuanto trae el contenedor" y "precio por unidad
// suelta" se adaptan a lo que el dueno ya eligio en unidadVenta (el
// contenedor: bulto, caja, bolsa...) y unidadSuelta (lo que se vende
// suelto: pieza, kg, litro...) -- para que un bulto de cemento diga
// "Cuantos kilos trae el bulto" en vez de "Piezas por bolsa/caja".
function actualizarEtiquetasPiezaCamposProducto() {
 const unidadVenta =
 document.getElementById("unidadVenta")?.value || "pieza";

 const unidadSuelta =
 document.getElementById("unidadSuelta")?.value || "pieza";

 const etiquetaContenedor =
 etiquetaUnidadVenta(unidadVenta);

 const etiquetaSuelta =
 etiquetaUnidadVenta(unidadSuelta);

 const campoCantidad =
 document.getElementById("piezasPorBolsa");

 const campoPrecio =
 document.getElementById("precioPieza");

 if (campoCantidad) {
 campoCantidad.placeholder = `Cuantos ${etiquetaSuelta.plural} trae el ${etiquetaContenedor.singular}`;
 }

 if (campoPrecio) {
 campoPrecio.placeholder = `Precio por ${etiquetaSuelta.singular}`;
 }
}

// Etiquetas/ejemplo para cada unidad decimal -- mismo criterio de
// esUnidadDecimal(unidad) (linea 1315), pero con texto legible para el
// dueno. Alimenta actualizarAyudaPrecioProducto() para dejar claro,
// SIN necesidad de bascula fisica, que el campo "Precio del carrito"
// se cobra por esta unidad y ya multiplica por lo que se capture a
// mano en el carrito (ver capturarPesoManual en pos-sales.js).
const ETIQUETAS_UNIDAD_DECIMAL_PRECIO = {
 kg: { singular: "kilogramo", plural: "kilogramos", abrev: "kg", ejemplo: 2.5 },
 kilo: { singular: "kilogramo", plural: "kilogramos", abrev: "kg", ejemplo: 2.5 },
 gramo: { singular: "gramo", plural: "gramos", abrev: "g", ejemplo: 500 },
 metro: { singular: "metro", plural: "metros", abrev: "m", ejemplo: 3 },
 litro: { singular: "litro", plural: "litros", abrev: "L", ejemplo: 2.5 }
};

function actualizarAyudaPrecioProducto() {
 const unidad =
 String(document.getElementById("unidadVenta")?.value || "pieza").toLowerCase();

 const campoPrecio =
 document.getElementById("nuevoPrecio");

 const ayuda =
 document.getElementById("precioCarritoAyuda");

 if (!campoPrecio || !ayuda) return;

 const etiqueta =
 ETIQUETAS_UNIDAD_DECIMAL_PRECIO[unidad];

 if (!etiqueta) {
 campoPrecio.placeholder = "Precio del carrito";
 ayuda.textContent = "";
 ayuda.style.display = "none";
 return;
 }

 campoPrecio.placeholder = `Precio por ${etiqueta.singular}`;

 const precio =
 Number(campoPrecio.value);

 ayuda.style.display = "";

 if (Number.isFinite(precio) && precio > 0) {
 const total =
 (precio * etiqueta.ejemplo).toFixed(2);

 ayuda.textContent =
 `Ej: ${etiqueta.ejemplo} ${etiqueta.abrev} = $${total}`;
 } else {
 ayuda.textContent =
 `Se cobrara por ${etiqueta.plural} capturados a mano en el carrito`;
 }
}

function toggleGarantiaCamposProducto() {
 const checkbox =
 document.getElementById("nuevaTieneGarantia");

 const activo =
 Boolean(checkbox?.checked);

 const campo =
 document.getElementById("nuevoGarantiaDetalle");

 const wrapper =
 campo?.closest(".campo-ficha") || campo;

 if (!wrapper) return;

 if (activo) {
  wrapper.style.removeProperty("display");
 } else {
  wrapper.style.setProperty("display", "none", "important");
 }
}

function mostrarPiezasSueltasStockInfo(valor, producto = {}) {
 const campo =
 document.getElementById("piezasPorBolsa");

 const wrapper =
 campo?.closest(".campo-ficha");

 if (!wrapper) return;

 let info =
 document.getElementById("piezasSueltasStockInfo");

 const cantidad =
 Number(valor || 0);

 if (!cantidad) {
 info?.remove();
 return;
 }

 if (!info) {
 info = document.createElement("small");
 info.id = "piezasSueltasStockInfo";
 info.className = "pieza-stock-info";
 wrapper.appendChild(info);
 }

 const etiqueta =
 etiquetaUnidadVenta(unidadSueltaDeProducto(producto));

 info.textContent =
 `${etiqueta.plural.charAt(0).toUpperCase() + etiqueta.plural.slice(1)} sueltos actuales: ${cantidad}`;
}

function enfocarCampoStockAhora() {
 const stock =
 document.getElementById("nuevoStock");

 stock?.focus();
 stock?.select();
}

function buscarCodigoEnter(event) {

 if (
 event.key !== "Enter"
 ) return;

 event.preventDefault();

 clearTimeout(temporizadorCodigoBarras);

 procesarCodigoBarrasPos();
 return;

 const input =
 document.getElementById(
 "busqueda"
 );

 const codigo =
 normalizarCodigo(input.value);

 // Si esta vacio:
 // pasar a dinero
 if (!codigo) {

 document
 .getElementById(
 "dinero"
 )
 ?.focus();

 return;
 }

 const producto =
 todosProductos.find(
 p =>

 normalizarCodigo(p.codigo) === codigo

 ||

 normalizarCodigo(p.id) === codigo
 );

 if (!producto) {
 const productoCatalogo =
 productoDesdeCatalogo(codigo);

 if (productoCatalogo) {
 llenarFormularioConProductoCatalogo(
 productoCatalogo
 );

 input.value = "";
 enfocarStockNuevoProducto();
 return;
 }

 alert(
 "Producto no encontrado en inventario ni catalogo"
 );

 return;
 }

 agregar(
 producto.id,
 producto.nombre,
 producto.precio
);

// limpiar buscador
input.value = "";

buscarProductos();

// regresar al buscador
setTimeout(() => {

 document
 .getElementById(
 "busqueda"
 )
 ?.focus();

}, 50);

return;
}

/* Alta, edicion y baja de producto */
async function agregarProductoNuevo(opciones = {}) {

 if (!(await validarOperacionLicenciaNexoPOS("guardar productos"))) return;

 const nombre =
 document.getElementById(
 "nuevoNombre"
 ).value;

 const precio =
 document.getElementById(
 "nuevoPrecio"
 ).value;

 const stock =
 document.getElementById(
 "nuevoStock"
 ).value;

 const codigo =
 document.getElementById(
 "nuevoCodigo"
 ).value;
const proveedor =
document.getElementById("nuevoProveedor").value;

const ubicacion =
document.getElementById("nuevaUbicacion").value;

const categoria =
document.getElementById("nuevaCategoria")?.value || "";

const subcategoria =
document.getElementById("nuevaSubcategoria")?.value || "";

const marca =
document.getElementById("nuevaMarca")?.value || "";

const descripcion =
document.getElementById("nuevaDescripcion")?.value || "";

const unidadVenta =
document.getElementById("unidadVenta")?.value || "pieza";

const precioDistribuidor =
document.getElementById("precioDistribuidor")?.value || "";

const precioMayoreo =
document.getElementById("precioMayoreo")?.value || "";

const precioPublico =
document.getElementById("precioPublico")?.value || "";

const stockMinimo =
document.getElementById("stockMinimo")?.value || 3;

const altaRotacion =
document.getElementById("altaRotacion")?.value || "";

const codigoInterno =
document.getElementById("nuevoCodigoInterno")?.value || "";

const tipoProducto =
document.getElementById("tipoProductoInventario")?.value || "catalogo";

const presentacionCompra =
document.getElementById("presentacionCompra")?.value || "";

const factorConversion =
document.getElementById("factorConversion")?.value || "";

const basculaDigital =
document.getElementById("basculaDigital")?.value || "no";

const permiteVentaPieza =
document.getElementById("permiteVentaPieza")?.checked || false;

const unidadSuelta =
document.getElementById("unidadSuelta")?.value || "pieza";

const piezasPorBolsa =
document.getElementById("piezasPorBolsa")?.value || "";

const precioPieza =
document.getElementById("precioPieza")?.value || "";

const tieneGarantia =
document.getElementById("nuevaTieneGarantia")?.checked || false;

const garantiaDetalle =
document.getElementById("nuevoGarantiaDetalle")?.value || "";

const codigosRelacionadosTexto =
document.getElementById("codigosRelacionados")?.value || "";

const stockMaximo =
document.getElementById("nuevoStockMaximo")?.value || "";

const peso =
document.getElementById("nuevoPeso")?.value || "";

const largoCm =
document.getElementById("nuevoLargoCm")?.value || "";

const anchoCm =
document.getElementById("nuevoAnchoCm")?.value || "";

const altoCm =
document.getElementById("nuevoAltoCm")?.value || "";

const notasInternas =
document.getElementById("nuevasNotasInternas")?.value || "";

const admiteCambios =
!(document.getElementById("nuevaNoAdmiteCambios")?.checked || false);

const destacado =
document.getElementById("nuevoDestacado")?.checked || false;

const precioOferta =
document.getElementById("nuevoPrecioOferta")?.value || "";

const codigoFinal =
normalizarCodigo(codigo) ||
(
 tipoProducto === "manual" ||
 tipoProducto === "granel" ||
 tipoProducto === "servicio"
 ? generarCodigoInternoProducto(tipoProducto, categoria)
 : normalizarCodigo(codigoInterno)
);

const codigosRelacionados =
[
 codigoInterno,
 ...codigosRelacionadosTexto.split(/[\n,; ]+/)
]
 .map(normalizarCodigo)
 .filter(Boolean);

if (codigoFinal && !normalizarCodigo(codigo)) {
 document.getElementById("nuevoCodigo").value =
 codigoFinal;
 document.getElementById("nuevoCodigo").dataset.codigoAutomatico =
 "1";
}
 if (!String(nombre || "").trim()) {
 await alertaPOS("Escribe el nombre del producto.", "Falta nombre", "alerta");
 document.getElementById("nuevoNombre")?.focus();
 return;
 }

 if (precio === "" || Number(precio) < 0) {
 await alertaPOS("Escribe un precio valido para vender.", "Falta precio", "alerta");
 document.getElementById("nuevoPrecio")?.focus();
 return;
 }

 if (stock === "" || Number(stock) < 0) {
 await alertaPOS("Escribe el stock actual. Puede ser 0 si no hay existencia.", "Falta stock", "alerta");
 document.getElementById("nuevoStock")?.focus();
 return;
 }

 if (permiteVentaPieza && (piezasPorBolsa === "" || Number(piezasPorBolsa) <= 0 || precioPieza === "" || Number(precioPieza) < 0)) {
 const etiquetaSuelta = etiquetaUnidadVenta(unidadSuelta);
 const etiquetaContenedor = etiquetaUnidadVenta(unidadVenta);
 await alertaPOS(`Para vender suelto, escribe cuantos ${etiquetaSuelta.plural} trae cada ${etiquetaContenedor.singular} y el precio por ${etiquetaSuelta.singular}.`, "Faltan datos de venta suelta", "alerta");
 document.getElementById("piezasPorBolsa")?.focus();
 return;
 }

 if (!productoEditandoId && codigoFinal !== codigoDuplicadoConfirmado) {
 const duplicado =
 buscarProductoPorCodigo(codigoFinal);

 if (duplicado) {
 const irAEditar =
 await dialogoPOS({
 tipo: "alerta",
 titulo: "Este producto ya existe",
 mensaje: `Ya tienes "${duplicado.nombre}" en tu inventario con este codigo (stock actual: ${duplicado.stock}). ¿Editas ese producto en vez de crear uno nuevo?`,
 mostrarCancelar: true,
 textoAceptar: "Editar ese producto",
 textoCancelar: "Crear uno nuevo de todos modos"
 });

 if (irAEditar) {
 editarProducto(duplicado.id);
 return;
 }

 codigoDuplicadoConfirmado = codigoFinal;
 }
 }

 const esEdicion =
 Boolean(productoEditandoId);

 const url =
 esEdicion
 ? `/editar-producto/${productoEditandoId}`
 : "/agregar-producto";

 const metodo =
 esEdicion
 ? "PUT"
 : "POST";

 const payloadProducto = {
 nombre,
 precio,
 stock,
 codigo: codigoFinal,
 proveedor,
 ubicacion,
 categoria,
 subcategoria,
 marca,
 descripcion,
 unidadVenta,
 precioDistribuidor,
 precioMayoreo,
 precioPublico,
 stockMinimo,
 altaRotacion,
 tipoProducto,
 presentacionCompra,
 factorConversion,
 basculaDigital,
 codigosRelacionados,
 permiteVentaPieza,
 unidadSuelta,
 piezasPorBolsa,
 precioPieza,
 tieneGarantia,
 garantiaDetalle,
 stockMaximo,
 peso,
 largoCm,
 anchoCm,
 altoCm,
 notasInternas,
 admiteCambios,
 destacado,
 precioOferta
 };

 let respuesta;
 let productoGuardado = null;
 let productoOffline = false;

 try {
 respuesta = await fetch(
 url,
 {
 method: metodo,

 headers: {
 "Content-Type":
 "application/json"
 },

 body: JSON.stringify(payloadProducto)
 }
 );
 } catch (error) {
 const idLocal =
 esEdicion
 ? productoEditandoId
 : -Date.now();

 const offline =
 await registrarCambioCatalogoOfflineDesktopPOS(
 esEdicion ? "producto_actualizado" : "producto_creado",
 "producto",
 esEdicion ? productoEditandoId : "",
 {
 ...payloadProducto,
 productoId: esEdicion ? productoEditandoId : null,
 localId: idLocal,
 errorConexion: error.message
 }
 );

 if (!offline.offlineDisponible || !offline.ok) {
 await alertaPOS("No se pudo conectar con el servidor para guardar el producto.", "Producto no guardado", "peligro");
 return;
 }

 productoGuardado = {
 ...payloadProducto,
 id: idLocal,
 precio_publico: precioPublico || precio || 0,
 precio_mayoreo: precioMayoreo || 0,
 precio_distribuidor: precioDistribuidor || 0,
 stock_minimo: stockMinimo || 3,
 unidad_venta: unidadVenta,
 tipo_producto: tipoProducto,
 codigos_relacionados: codigosRelacionados,
 pendienteSync: true
 };
 productoOffline = true;
 }

 if (!productoOffline && !respuesta.ok) {
 await alertaPOS("El servidor no pudo guardar el producto. Revisa que el codigo no este repetido y vuelve a intentar.", "Producto no guardado", "peligro");
 return;
 }

 if (!productoGuardado) {
 const datosGuardado =
 await respuesta.json().catch(() => ({}));

 productoGuardado =
 datosGuardado.producto || {
 ...payloadProducto,
 id: datosGuardado.productoId || productoEditandoId,
 precio_publico: precioPublico || precio || 0,
 precio_mayoreo: precioMayoreo || 0,
 precio_distribuidor: precioDistribuidor || 0,
 stock_minimo: stockMinimo || 3,
 unidad_venta: unidadVenta,
 tipo_producto: tipoProducto,
 codigos_relacionados: codigosRelacionados
 };
 }

 const continuarCaptura =
 Boolean(opciones?.continuar) && !esEdicion;

 if (!continuarCaptura) {
 cerrarFormularioAgregar();
 }

 if (productoOffline) {
 if (esEdicion) {
 todosProductos =
 todosProductos.map(producto =>
 Number(producto.id) === Number(productoEditandoId)
 ? {
 ...producto,
 ...productoGuardado
 }
 : producto
 );
 } else {
 todosProductos = [
 productoGuardado,
 ...todosProductos
 ];
 }

 actualizarDashboard();
 actualizarInventarioBajo();
 actualizarDatalistCategorias();
 await guardarCatalogosLocalesDesktopPOS();
 } else {
 await cargarProductos();
 }

 await alertaPOS(
 productoOffline
 ? "Producto guardado offline. Se sincronizara cuando vuelva el internet."
 : (esEdicion ? "Producto actualizado correctamente." : "Producto agregado correctamente."),
 productoOffline ? "Producto offline guardado" : (esEdicion ? "Producto actualizado" : "Producto agregado"),
 "exito"
 );

 if (continuarCaptura) {
  limpiarFormularioProductoParaSiguientePOS({
   categoria,
   subcategoria,
   proveedor,
   ubicacion,
   unidadVenta,
   tipoProducto
  });
 }
}

function limpiarFormularioProductoParaSiguientePOS(contexto = {}) {
 productoEditandoId = null;
 codigoDuplicadoConfirmado = null;
 reiniciarProveedorCatalogoProducto();
 marcarImagenProductoEncontrada(false);
 codigoImagenExistenteActual = null;

 const limpiar = [
  "nuevoCodigo",
  "nuevoNombre",
  "nuevoCodigoInterno",
  "codigosRelacionados",
  "nuevaMarca",
  "nuevaDescripcion",
  "precioDistribuidor",
  "precioMayoreo",
  "nuevoPrecio",
  "precioPublico",
  "nuevoStock",
  "nuevoStockMaximo",
  "nuevoPeso",
  "nuevoLargoCm",
  "nuevoAnchoCm",
  "nuevoAltoCm",
  "nuevasNotasInternas"
 ];

 limpiar.forEach(id => {
  const campo =
  document.getElementById(id);

  if (campo) {
   campo.value = "";
   delete campo.dataset.codigoAutomatico;
  }
 });

 mostrarImagenPreviewProducto("");

 const valoresConservados = {
  nuevaCategoria: contexto.categoria || "",
  nuevaSubcategoria: contexto.subcategoria || "",
  nuevoProveedor: contexto.proveedor || "",
  nuevaUbicacion: contexto.ubicacion || "",
  unidadVenta: contexto.unidadVenta || "pieza",
  tipoProductoInventario: contexto.tipoProducto || "catalogo"
 };

 Object.entries(valoresConservados).forEach(([id, valor]) => {
  const campo =
  document.getElementById(id);

  if (campo) campo.value = valor;
 });

 renderChipsSubcategoria(chipsSubcategoriaActuales());

 const stockMinimo =
 document.getElementById("stockMinimo");

 if (stockMinimo && !stockMinimo.value) {
  stockMinimo.value = "3";
 }

 const altaRotacion =
 document.getElementById("altaRotacion");

 if (altaRotacion) altaRotacion.value = "";

 const bascula =
 document.getElementById("basculaDigital");

 if (bascula) bascula.value = "no";

 const botonGuardar =
 document.getElementById("btnGuardarProducto");

 if (botonGuardar) botonGuardar.textContent = "Guardar producto";

 const tituloModal =
 document.getElementById("modalAgregarTitulo");

 if (tituloModal) tituloModal.textContent = "Agregar producto";

 const breadcrumbActual =
 document.getElementById("productoFormBreadcrumbActual");

 if (breadcrumbActual) breadcrumbActual.textContent = "Agregar producto";

 if (typeof seleccionarTipoProducto === "function") {
  seleccionarTipoProducto(contexto.tipoProducto || "catalogo");
 }

 setTimeout(() => {
  const codigo =
  document.getElementById("nuevoCodigo");

  if (codigo) {
   codigo.focus();
   codigo.select();
  }
 }, 80);
}

function editarProducto(
 id,
 nombre,
 precio,
 stock,
 codigo
) {
 const producto =
 todosProductos.find(
 p =>
 Number(p.id) === Number(id)
 );

 nombre =
 nombre ?? producto?.nombre ?? "";

 precio =
 precio ?? producto?.precio ?? "";

 stock =
 stock ?? producto?.stock ?? "";

 codigo =
 codigo ?? producto?.codigo ?? "";

 productoEditandoId = id;

 mostrarFormularioAgregar();

 marcarImagenProductoEncontrada(Boolean(producto?.imagenUrl));
 mostrarImagenPreviewProducto(producto?.imagenUrl || "");

 const tituloModal =
 document.getElementById("modalAgregarTitulo");

 const botonGuardar =
 document.getElementById("btnGuardarProducto");

 if (tituloModal) {
 tituloModal.textContent =
 "Editar producto";
 }

 if (botonGuardar) {
 botonGuardar.textContent =
 "Actualizar producto";
 }

 document.getElementById(
 "nuevoNombre"
 ).value =
 nombre;

 document.getElementById(
 "nuevoPrecio"
 ).value =
 precio;

 document.getElementById(
 "nuevoStock"
 ).value =
 stock;

 document.getElementById(
 "nuevoCodigo"
 ).value =
 codigo || "";

 document.getElementById("nuevoProveedor").value =
 producto?.proveedor || "";

 document.getElementById("nuevaUbicacion").value =
 producto?.ubicacion || "";

 document.getElementById("nuevaCategoria").value =
 producto?.categoria || "";

 document.getElementById("nuevaSubcategoria").value =
 producto?.subcategoria || "";

 renderChipsSubcategoria(chipsSubcategoriaActuales());

 preseleccionarCategoriaNexoProducto(producto);

 document.getElementById("nuevaMarca").value =
 producto?.marca || "";

 document.getElementById("nuevaDescripcion").value =
 producto?.descripcion || "";

 document.getElementById("unidadVenta").value =
 producto?.unidad_venta || "pieza";

 document.getElementById("tipoProductoInventario").value =
 producto?.tipo_producto || "catalogo";

 seleccionarTipoProducto(
 producto?.tipo_producto || "catalogo"
 );

 document.getElementById("presentacionCompra").value =
 producto?.presentacion_compra || "";

 document.getElementById("factorConversion").value =
 producto?.factor_conversion || "";

 document.getElementById("permiteVentaPieza").checked =
 Boolean(producto?.permite_venta_pieza);

 document.getElementById("unidadSuelta").value =
 producto?.unidad_suelta || "pieza";

 document.getElementById("piezasPorBolsa").value =
 producto?.piezas_por_bolsa || "";

 document.getElementById("precioPieza").value =
 producto?.precio_pieza || "";

 togglePiezaCamposProducto();
 mostrarPiezasSueltasStockInfo(producto?.piezas_sueltas_stock, producto);

 document.getElementById("nuevaTieneGarantia").checked =
 Boolean(producto?.tiene_garantia);

 document.getElementById("nuevoGarantiaDetalle").value =
 producto?.garantia_detalle || "";

 toggleGarantiaCamposProducto();

 document.getElementById("basculaDigital").value =
 producto?.bascula_digital || "no";

 document.getElementById("unidadVenta").value =
 producto?.unidad_venta || "pieza";

 actualizarAyudaPrecioProducto();

 document.getElementById("precioDistribuidor").value =
 producto?.precio_distribuidor || "";

 document.getElementById("precioMayoreo").value =
 producto?.precio_mayoreo || "";

 document.getElementById("precioPublico").value =
 producto?.precio_publico || "";

 document.getElementById("stockMinimo").value =
 producto?.stock_minimo || 3;

 document.getElementById("nuevoStockMaximo").value =
 producto?.stock_maximo || "";

 document.getElementById("nuevoPeso").value =
 producto?.peso || "";

 document.getElementById("nuevoLargoCm").value =
 producto?.largo_cm || "";

 document.getElementById("nuevoAnchoCm").value =
 producto?.ancho_cm || "";

 document.getElementById("nuevoAltoCm").value =
 producto?.alto_cm || "";

 document.getElementById("nuevasNotasInternas").value =
 producto?.notas_internas || "";

 document.getElementById("nuevaNoAdmiteCambios").checked =
 producto?.admite_cambios === false;

 document.getElementById("nuevoDestacado").checked =
 Boolean(producto?.destacado);

 document.getElementById("nuevoPrecioOferta").value =
 producto?.precio_oferta || "";

 document.getElementById("altaRotacion").value =
 producto?.alta_rotacion || "";

 document.getElementById("codigosRelacionados").value =
 codigosProducto(producto)
 .filter(item => item !== normalizarCodigo(codigo || producto?.codigo))
 .join(", ");
}

async function eliminarProducto(id) {

 const producto =
 todosProductos.find(p => Number(p.id) === Number(id));

 const confirmado =
 await confirmarPOS(
 producto
 ? `¿Seguro que deseas eliminar "${producto.nombre}" del inventario? Esta accion no se puede deshacer.`
 : "¿Seguro que deseas eliminar este producto del inventario? Esta accion no se puede deshacer.",
 "Eliminar producto",
 "peligro"
 );

 if (!confirmado) return;

 try {
 const respuesta =
 await fetch(
 `/eliminar-producto/${id}`,
 {
 method: "DELETE"
 }
 );

 if (!respuesta.ok) {
 await alertaPOS("No se pudo eliminar el producto.", "Producto no eliminado", "peligro");
 return;
 }

 await cargarProductos();
 return;
 } catch (error) {
 const offline =
 await registrarCambioCatalogoOfflineDesktopPOS(
 "producto_eliminado",
 "producto",
 id,
 {
 productoId: id,
 errorConexion: error.message
 }
 );

 if (!offline.offlineDisponible || !offline.ok) {
 await alertaPOS("No se pudo conectar con el servidor para eliminar el producto.", "Producto no eliminado", "peligro");
 return;
 }

 todosProductos =
 todosProductos.filter(producto => Number(producto.id) !== Number(id));

 actualizarDashboard();
 actualizarInventarioBajo();
 actualizarDatalistCategorias();
 await guardarCatalogosLocalesDesktopPOS();

 await alertaPOS(
 "Producto dado de baja offline. Se sincronizara cuando vuelva el internet.",
 "Producto offline",
 "exito"
 );
 }
}

/* Inventario, categorias y formulario */
function mostrarInventario() {
 ocultarPantallasPrincipales();

 document.getElementById(
 "pantallaInventario"
 ).style.display = "block";

 abrirSubmenuInventario();
 actualizarDatalistCategorias();
 poblarFiltroCategoriaInventario();
 cargarTablaInventario();

}

function categoriasInventarioGuardadas() {
 try {
 const guardadas =
 JSON.parse(localStorage.getItem("categoriasInventario") || "[]");

 if (Array.isArray(guardadas) && guardadas.length > 0) {
 return guardadas;
 }
 } catch (error) {
 console.warn("No se pudieron leer categorias", error);
 }

 const desdeProductos =
 todosProductos
 .map(producto => String(producto.categoria || "").trim())
 .filter(Boolean);

 return [...new Set([
 ...plantillaGiroActual().categorias,
 ...desdeProductos
 ])].map((nombre, indice) => ({
 id: `cat-${normalizarTexto(nombre).replace(/[^a-z0-9]/g, "-") || indice}`,
 nombre,
 color: ["#0d6efd", "#16a34a", "#be2f5f", "#f59e0b", "#7c3aed", "#0891b2"][indice % 6]
 }));
}

function guardarCategoriasInventario(categorias) {
 localStorage.setItem(
 "categoriasInventario",
 JSON.stringify(categorias)
 );

 actualizarDatalistCategorias();
}

function actualizarDatalistCategorias() {
 const lista =
 document.getElementById("listaCategoriasProducto");

 if (!lista) return;

 lista.innerHTML =
 categoriasInventarioGuardadas()
 .map(categoria => `<option value="${categoria.nombre}"></option>`)
 .join("");
}

function aplicarCategoriasDeGiro(giro = "ferreteria", reemplazar = false) {
 const plantilla =
 PLANTILLAS_GIRO_NEGOCIO[giro] || PLANTILLAS_GIRO_NEGOCIO.ferreteria;

 const existentes =
 reemplazar ? [] : categoriasInventarioGuardadas();

 const combinadas =
 [...existentes];

 plantilla.categorias.forEach((nombre, indice) => {
 const existe =
 combinadas.some(categoria =>
 normalizarTexto(categoria.nombre) === normalizarTexto(nombre)
 );

 if (!existe) {
 combinadas.push({
 id: `cat-${normalizarTexto(nombre).replace(/[^a-z0-9]/g, "-") || Date.now()}`,
 nombre,
 color: ["#0d6efd", "#16a34a", "#be2f5f", "#f59e0b", "#7c3aed", "#0891b2"][indice % 6]
 });
 }
 });

 guardarCategoriasInventario(combinadas);
 return combinadas;
}

async function aplicarPlantillaGiroConfiguracion() {
 const giro =
 document.getElementById("configGiroNegocio")?.value || "ferreteria";

 const plantilla =
 PLANTILLAS_GIRO_NEGOCIO[giro] || PLANTILLAS_GIRO_NEGOCIO.ferreteria;

 const confirmar =
 await confirmarPOS(
 `Se agregaran categorias sugeridas para ${plantilla.nombre}. No se borran productos ni categorias existentes.`,
 "Aplicar plantilla",
 "info"
 );

 if (!confirmar) return;

 aplicarCategoriasDeGiro(giro, false);

 alertaPOS(
 `Categorias de ${plantilla.nombre} listas para usar.`,
 "Plantilla aplicada",
 "exito"
 );
}

function abrirSubmenuInventario() {
 if (typeof abrirSubmenuSidebar === "function") abrirSubmenuSidebar("submenuInventario");
}

function toggleSubmenuInventario() {
 const submenu =
 document.getElementById("submenuInventario");

 if (!submenu) {
 mostrarInventario();
 return;
 }

 toggleSubmenuSidebar("submenuInventario");
}

function mostrarCategoriasInventario() {
 ocultarPantallasPrincipales();
 abrirSubmenuInventario();
 actualizarDatalistCategorias();

 document.getElementById("pantallaCategoriasInventario").style.display =
 "block";

 const categorias = categoriasInventarioGuardadas();

 if (!categoriaSeleccionadaId || !categorias.some(categoria => categoria.id === categoriaSeleccionadaId)) {
 categoriaSeleccionadaId = categorias[0]?.id || null;
 }

 tabCategoriaActual = "productos";
 paginaCategoriaProductos = 1;

 renderResumenCategorias();
 renderListaCategorias();
 renderDetalleCategoria();
}

function productosPorCategoria(nombreCategoria) {
 const normalizada =
 normalizarTexto(nombreCategoria);

 return todosProductos.filter(producto =>
 normalizarTexto(producto.categoria || "") === normalizada
 );
}

function categoriaIconoPOS(nombre) {
 const texto = normalizarTexto(nombre || "");

 if (texto.includes("electr")) return "zap";
 if (texto.includes("herramient")) return "wrench";
 if (texto.includes("ferreter")) return "toolbox";
 if (texto.includes("plomer") || texto.includes("agua")) return "drop";
 if (texto.includes("pintura")) return "roller";
 if (texto.includes("segur")) return "shield";
 if (texto.includes("jardin")) return "leaf";
 if (texto.includes("construc")) return "building";
 return "tag";
}

function renderResumenCategorias() {
 const contenedor = document.getElementById("resumenCategoriasInventario");
 if (!contenedor) return;

 const categorias = categoriasInventarioGuardadas();
 const conProductos = categorias.filter(categoria => productosPorCategoria(categoria.nombre).length > 0);
 const productosCategorizados = todosProductos.filter(producto => String(producto.categoria || "").trim());

 contenedor.innerHTML = `
 <article class="categoria-resumen-blue">
 <span>${iconoUISVG("grid")}</span>
 <div>
 <small>Total categorias</small>
 <strong>${categorias.length}</strong>
 </div>
 </article>
 <article class="categoria-resumen-green">
 <span>${iconoUISVG("inventory")}</span>
 <div>
 <small>Productos en categorias</small>
 <strong>${productosCategorizados.length.toLocaleString("es-MX")}</strong>
 <em>Asignados a categorias</em>
 </div>
 </article>
 <article class="categoria-resumen-orange">
 <span>${iconoUISVG("tag")}</span>
 <div>
 <small>Categorias activas</small>
 <strong>${conProductos.length}</strong>
 <em>Con productos asignados</em>
 </div>
 </article>
 <article class="categoria-resumen-red">
 <span>${iconoUISVG("alert")}</span>
 <div>
 <small>Categorias sin productos</small>
 <strong>${categorias.length - conProductos.length}</strong>
 <em class="categoria-resumen-alerta">Requieren atencion</em>
 </div>
 </article>
 `;
}

function buscarCategoriasInventario() {
 renderListaCategorias();
}

function renderListaCategorias() {
 const contenedor =
 document.getElementById("listaCategoriasInventario");

 if (!contenedor) return;

 const texto = normalizarTexto(document.getElementById("buscarCategorias")?.value || "");
 const categorias = categoriasInventarioGuardadas()
 .filter(categoria => !texto || normalizarTexto(categoria.nombre).includes(texto));

 if (!categorias.length) {
 contenedor.innerHTML = `<div class="categoria-producto-vacio">No se encontraron categorias.</div>`;
 return;
 }

 contenedor.innerHTML =
 categorias.map(categoria => {
 const productos = productosPorCategoria(categoria.nombre);
 const color = categoria.color || "#0d6efd";
 const activa = categoria.id === categoriaSeleccionadaId;

 return `
 <button
 type="button"
 class="categoria-card ${activa ? "activa" : ""}"
 style="--categoria-color:${color}"
 onclick="seleccionarCategoriaInventario('${categoria.id}')"
 >
 <span class="categoria-card-icono">${iconoUISVG(categoriaIconoPOS(categoria.nombre))}</span>
 <span class="categoria-card-texto">
 <strong>${escaparPOS(categoria.nombre)}</strong>
 <small>${productos.length} productos</small>
 </span>
 </button>
 `;
 }).join("");
}

function seleccionarCategoriaInventario(id) {
 categoriaSeleccionadaId = id;
 tabCategoriaActual = "productos";
 paginaCategoriaProductos = 1;

 renderListaCategorias();
 renderDetalleCategoria();
}

function mostrarTabCategoria(tab) {
 tabCategoriaActual = tab;
 paginaCategoriaProductos = 1;
 renderDetalleCategoria();
}

function categoriaSeleccionadaActual() {
 return categoriasInventarioGuardadas().find(categoria => categoria.id === categoriaSeleccionadaId) || null;
}

function estadisticasCategoria(productos) {
 const stockTotal = productos.reduce((suma, producto) => suma + Number(producto.stock || 0), 0);
 const valorTotal = productos.reduce((suma, producto) => suma + (Number(producto.stock || 0) * Number(producto.precio || 0)), 0);
 const precioPromedio = productos.length ? productos.reduce((suma, producto) => suma + Number(producto.precio || 0), 0) / productos.length : 0;
 const sinStock = productos.filter(producto => Number(producto.stock) <= 0).length;

 return { stockTotal, valorTotal, precioPromedio, sinStock };
}

function productosCategoriaOrdenados(productos) {
 const orden = document.getElementById("ordenCategoriaProductos")?.value || ordenCategoriaProductos;
 const copia = [...productos];

 switch (orden) {
 case "nombre-desc":
 return copia.sort((a, b) => String(b.nombre || "").localeCompare(String(a.nombre || "")));
 case "stock-desc":
 return copia.sort((a, b) => Number(b.stock || 0) - Number(a.stock || 0));
 case "stock-asc":
 return copia.sort((a, b) => Number(a.stock || 0) - Number(b.stock || 0));
 case "precio-desc":
 return copia.sort((a, b) => Number(b.precio || 0) - Number(a.precio || 0));
 case "precio-asc":
 return copia.sort((a, b) => Number(a.precio || 0) - Number(b.precio || 0));
 default:
 return copia.sort((a, b) => String(a.nombre || "").localeCompare(String(b.nombre || "")));
 }
}

function buscarProductosCategoria() {
 paginaCategoriaProductos = 1;
 renderProductosCategoriaTabla();
}

function cambiarOrdenCategoriaProductos(valor) {
 ordenCategoriaProductos = valor;
 paginaCategoriaProductos = 1;
 renderProductosCategoriaTabla();
}

function cambiarPaginaCategoriaProductos(pagina) {
 paginaCategoriaProductos = pagina;
 renderProductosCategoriaTabla();
}

function renderProductosCategoriaTabla() {
 const tabla = document.getElementById("tablaCategoriaProductos");
 if (!tabla) return;

 const categoria = categoriaSeleccionadaActual();
 if (!categoria) return;

 const texto = normalizarTexto(document.getElementById("buscarProductosCategoria")?.value || "");

 let productos = productosPorCategoria(categoria.nombre);

 if (texto) {
 productos = productos.filter(producto =>
 normalizarTexto(producto.nombre || "").includes(texto) ||
 normalizarTexto(producto.codigo || "").includes(texto)
 );
 }

 productos = productosCategoriaOrdenados(productos);

 const totalPaginas = Math.max(1, Math.ceil(productos.length / tamanoPaginaCategoriaProductos));
 paginaCategoriaProductos = Math.min(paginaCategoriaProductos, totalPaginas);

 const inicio = (paginaCategoriaProductos - 1) * tamanoPaginaCategoriaProductos;
 const productosPagina = productos.slice(inicio, inicio + tamanoPaginaCategoriaProductos);

 if (!productos.length) {
 tabla.innerHTML = `<tr><td colspan="6" class="inventario-vacio">No hay productos en esta categoria.</td></tr>`;
 } else {
 tabla.innerHTML = productosPagina.map(producto => {
 const unidad = unidadProducto(producto);
 const estado = estadoInventarioProducto(producto);

 return `
 <tr>
 <td>${producto.codigo || "-"}</td>
 <td>
 <div class="producto-inventario-celda">
 <span class="producto-inventario-icono">${miniaturaProducto(producto, "producto-inventario-icono-img")}</span>
 <div><strong>${escaparPOS(producto.nombre || "")}</strong></div>
 </div>
 </td>
 <td>$${Number(producto.precio).toFixed(2)}</td>
 <td>${producto.stock} ${unidad}${piezasSueltasInfoCelda(producto)}</td>
 <td><span class="estado-inventario ${estado.clase}">${estado.texto}</span></td>
 <td class="acciones-inventario">
 <button title="Ver detalles" onclick="verDetalleProducto(${producto.id})">${iconoUISVG("eye")}</button>
 <button title="Editar" onclick="editarProducto(${producto.id})">${iconoUISVG("edit")}</button>
 <button title="Eliminar" class="accion-peligro" onclick="eliminarProducto(${producto.id})">${iconoUISVG("trash")}</button>
 </td>
 </tr>
 `;
 }).join("");
 }

 renderPaginacion("paginacionCategoriaProductos", productos.length, paginaCategoriaProductos, tamanoPaginaCategoriaProductos, "cambiarPaginaCategoriaProductos");

 const textoPaginacion = document.getElementById("categoriaProductosPaginacionTexto");
 if (textoPaginacion) {
 textoPaginacion.textContent = productos.length === 0
 ? "Sin productos para mostrar"
 : `Mostrando ${inicio + 1} a ${Math.min(inicio + productosPagina.length, productos.length)} de ${productos.length} productos`;
 }
}

function renderDetalleCategoria() {
 const panel = document.getElementById("detalleCategoriaInventario");
 if (!panel) return;

 const categoria = categoriaSeleccionadaActual();

 if (!categoria) {
 panel.innerHTML = `<div class="categoria-producto-vacio">Crea o selecciona una categoria para ver su detalle.</div>`;
 return;
 }

 const productos = productosPorCategoria(categoria.nombre);
 const activa = productos.length > 0;
 const stats = estadisticasCategoria(productos);
 const color = categoria.color || "#0d6efd";

 const tabs = [
 { id: "productos", etiqueta: `Productos (${productos.length})` },
 { id: "info", etiqueta: "Informacion" },
 { id: "stats", etiqueta: "Estadisticas" }
 ];

 const cuerpoTab = tabCategoriaActual === "info"
 ? `
 <div class="categoria-info-grid">
 <div><span>Nombre</span><strong>${escaparPOS(categoria.nombre)}</strong></div>
 <div><span>Color</span><strong class="categoria-info-color"><i style="background:${color}"></i>${color}</strong></div>
 <div><span>Productos asignados</span><strong>${productos.length}</strong></div>
 <div><span>Identificador</span><strong>${escaparPOS(categoria.id)}</strong></div>
 </div>
 `
 : tabCategoriaActual === "stats"
 ? `
 <div class="categoria-stats-grid">
 <div><span>Stock total</span><strong>${stats.stockTotal.toLocaleString("es-MX")}</strong></div>
 <div><span>Valor en inventario</span><strong>${dinero(stats.valorTotal)}</strong></div>
 <div><span>Precio promedio</span><strong>${dinero(stats.precioPromedio)}</strong></div>
 <div><span>Sin stock</span><strong>${stats.sinStock}</strong></div>
 </div>
 `
 : `
 <div class="categoria-productos-toolbar">
 <div class="buscador-con-limpiar">
 <input id="buscarProductosCategoria" type="text" placeholder="Buscar en productos..." oninput="buscarProductosCategoria()">
 </div>
 <label class="inventario-filtro-campo">
 <span>Ordenar</span>
 <select id="ordenCategoriaProductos" onchange="cambiarOrdenCategoriaProductos(this.value)">
 <option value="nombre-asc">A-Z</option>
 <option value="nombre-desc">Z-A</option>
 <option value="stock-desc">Stock: mayor a menor</option>
 <option value="stock-asc">Stock: menor a mayor</option>
 <option value="precio-desc">Precio: mayor a menor</option>
 <option value="precio-asc">Precio: menor a mayor</option>
 </select>
 </label>
 </div>
 <table class="tabla-inventario">
 <thead>
 <tr>
 <th>Codigo</th>
 <th>Producto</th>
 <th>Precio</th>
 <th>Stock</th>
 <th>Estado</th>
 <th>Acciones</th>
 </tr>
 </thead>
 <tbody id="tablaCategoriaProductos"></tbody>
 </table>
 <div class="inventario-paginacion-footer">
 <span id="categoriaProductosPaginacionTexto"></span>
 <div id="paginacionCategoriaProductos" class="paginacion-tabla"></div>
 </div>
 `;

 panel.innerHTML = `
 <div class="categoria-detalle-header" style="--categoria-color:${color}">
 <span class="categoria-detalle-icono">${iconoUISVG(categoriaIconoPOS(categoria.nombre))}</span>
 <div class="categoria-detalle-titulo">
 <div class="categoria-detalle-nombre">
 <h3>${escaparPOS(categoria.nombre)}</h3>
 <span class="categoria-badge ${activa ? "activa" : "vacia"}">${activa ? "Activa" : "Sin productos"}</span>
 </div>
 <small>${productos.length} productos asignados</small>
 </div>
 <div class="categoria-detalle-acciones">
 <button type="button" class="btn-categoria-editar" onclick="editarCategoriaInventario('${categoria.id}')">${iconoUISVG("edit")}<span>Editar</span></button>
 <button type="button" class="btn-categoria-eliminar" onclick="eliminarCategoriaInventario('${categoria.id}')">${iconoUISVG("trash")}<span>Eliminar</span></button>
 </div>
 </div>
 <div class="categoria-tabs">
 ${tabs.map(tab => `
 <button type="button" class="${tabCategoriaActual === tab.id ? "activo" : ""}" onclick="mostrarTabCategoria('${tab.id}')">${tab.etiqueta}</button>
 `).join("")}
 </div>
 <div class="categoria-tab-cuerpo">
 ${cuerpoTab}
 </div>
 `;

 if (tabCategoriaActual === "productos") {
 renderProductosCategoriaTabla();
 }
}

async function abrirFormularioCategoria() {
 const nombre =
 await pedirTextoPOS(
 "Nombre de la categoria:",
 "",
 "Nueva categoria"
 );

 if (!nombre) return;

 const categorias =
 categoriasInventarioGuardadas();

 const existe =
 categorias.some(categoria =>
 normalizarTexto(categoria.nombre) === normalizarTexto(nombre)
 );

 if (existe) {
 alertaPOS("Esa categoria ya existe.", "Categorias", "info");
 return;
 }

 const nuevaCategoria = {
 id: `cat-${Date.now()}`,
 nombre: nombre.trim(),
 color: ["#0d6efd", "#16a34a", "#be2f5f", "#f59e0b", "#7c3aed", "#0891b2"][categorias.length % 6]
 };

 categorias.push(nuevaCategoria);

 guardarCategoriasInventario(categorias);
 categoriaSeleccionadaId = nuevaCategoria.id;
 renderResumenCategorias();
 renderListaCategorias();
 renderDetalleCategoria();
}

async function editarCategoriaInventario(id) {
 const categorias = categoriasInventarioGuardadas();
 const categoria = categorias.find(item => item.id === id);
 if (!categoria) return;

 const nombre = await pedirTextoPOS(
 "Nuevo nombre de la categoria:",
 categoria.nombre,
 "Editar categoria"
 );

 if (!nombre || normalizarTexto(nombre) === normalizarTexto(categoria.nombre)) return;

 const existe = categorias.some(item =>
 item.id !== id && normalizarTexto(item.nombre) === normalizarTexto(nombre)
 );

 if (existe) {
 alertaPOS("Ya existe una categoria con ese nombre.", "Categorias", "info");
 return;
 }

 const nombreNuevo = nombre.trim();
 let actualizados = 0;

 try {
 const respuesta = await fetch("/productos/categoria-masiva", {
 method: "PATCH",
 headers: { "Content-Type": "application/json" },
 body: JSON.stringify({ categoriaAnterior: categoria.nombre, categoriaNueva: nombreNuevo })
 });
 const datos = await respuesta.json();

 if (!datos.ok) {
 alertaPOS("No se pudo actualizar la categoria en tus productos.", "Categorias", "alerta");
 return;
 }

 actualizados = datos.actualizados || 0;
 } catch (error) {
 alertaPOS("No se pudo actualizar la categoria en tus productos.", "Categorias", "alerta");
 return;
 }

 categoria.nombre = nombreNuevo;
 guardarCategoriasInventario(categorias);

 if (actualizados > 0) {
 await cargarProductos();
 }

 renderResumenCategorias();
 renderListaCategorias();
 renderDetalleCategoria();

 if (actualizados > 0) {
 alertaPOS(`Se actualizaron ${actualizados} producto(s).`, "Categorias", "exito");
 }
}

async function eliminarCategoriaInventario(id) {
 const confirmar =
 await confirmarPOS(
 "Eliminar esta categoria? Los productos no se borran.",
 "Eliminar categoria",
 "alerta"
 );

 if (!confirmar) return;

 guardarCategoriasInventario(
 categoriasInventarioGuardadas()
 .filter(categoria => categoria.id !== id)
 );

 if (categoriaSeleccionadaId === id) {
 categoriaSeleccionadaId = categoriasInventarioGuardadas()[0]?.id || null;
 }

 renderResumenCategorias();
 renderListaCategorias();
 renderDetalleCategoria();
}

function filtrarInventarioPorCategoria(nombreCategoria) {
 mostrarInventario();

 const campo =
 document.getElementById("buscarInventario");

 if (campo) {
 campo.value = nombreCategoria;
 }

 buscarInventario();
}

function limpiarBusquedaInventario() {
 const campo =
 document.getElementById("buscarInventario");

 if (campo) {
 campo.value = "";
 campo.focus();
 }

 buscarInventario();
}

function limpiarBusquedaPos() {
 const campo =
 document.getElementById("busqueda");

 if (campo) {
 campo.value = "";
 campo.focus();
 }

 buscarProductos();
}

function enfocarBusquedaVentaRapida(limpiar = false) {
 const campo =
 document.getElementById("busqueda");

 if (!campo) return;

 if (limpiar) {
  campo.value = "";
  buscarProductos();
 }

 setTimeout(() => {
  campo.focus();
  campo.select();
 }, 120);
}

function mostrarPuntoVenta() {
 ocultarPantallasPrincipales();

 document.getElementById(
 "pantallaPuntoVenta"
 ).style.display = "block";

 actualizarClientePOS();
 enfocarBusquedaVentaRapida(false);
}

function estadoInventarioProducto(producto) {
 const stock = Number(producto.stock);

 if (stock <= 0) return { clase: "sin-stock", texto: "Sin stock" };
 if (stock <= 5) return { clase: "bajo", texto: "Bajo" };
 return { clase: "ok", texto: "En stock" };
}

function productosInventarioFiltrados() {
 const campo =
 document.getElementById("buscarInventario");

 const texto =
 (campo?.value || "")
 .toLowerCase()
 .trim();

 const categoriaFiltro =
 document.getElementById("filtroInventarioCategoria")?.value || "";

 const estadoFiltro =
 document.getElementById("filtroInventarioEstado")?.value || "";

 return todosProductos.filter(producto => {
 if (texto) {
  const coincide =
  productoCoincideConTexto(producto, texto) ||
  String(producto.precio || "").toLowerCase().includes(texto) ||
  String(producto.proveedor || "").toLowerCase().includes(texto);

  if (!coincide) return false;
 }

 if (categoriaFiltro && String(producto.categoria || "") !== categoriaFiltro) {
  return false;
 }

 if (estadoFiltro && estadoInventarioProducto(producto).clase !== estadoFiltro) {
  return false;
 }

 return true;
 });
}

function poblarFiltroCategoriaInventario() {
 const select =
 document.getElementById("filtroInventarioCategoria");

 if (!select) return;

 const valorActual = select.value;

 const nombres =
 [...new Set(categoriasInventarioGuardadas().map(categoria => categoria.nombre).filter(Boolean))]
 .sort((a, b) => a.localeCompare(b));

 select.innerHTML =
 '<option value="">Todas</option>' +
 nombres.map(nombre => `<option value="${escaparPOS(nombre)}">${escaparPOS(nombre)}</option>`).join("");

 if (nombres.includes(valorActual)) select.value = valorActual;
}

function filtrarInventario() {
 paginaInventario = 1;
 cargarTablaInventario();
}

function limpiarFiltrosInventario() {
 const categoria = document.getElementById("filtroInventarioCategoria");
 const estado = document.getElementById("filtroInventarioEstado");

 if (categoria) categoria.value = "";
 if (estado) estado.value = "";

 limpiarBusquedaInventario();
}

function cambiarTamanoPaginaInventario(valor) {
 tamanoPaginaInventarioActual = Number(valor) || TAMANO_PAGINA_INVENTARIO;
 paginaInventario = 1;
 cargarTablaInventario();
}

function renderResumenInventario() {
 const total = todosProductos.length;
 const stockTotal = todosProductos.reduce((suma, producto) => suma + Number(producto.stock || 0), 0);
 const valorInventario = todosProductos.reduce((suma, producto) => suma + (Number(producto.stock || 0) * Number(producto.precio || 0)), 0);
 const sinStock = todosProductos.filter(producto => Number(producto.stock) <= 0).length;

 const elementoTotal = document.getElementById("resumenInventarioTotal");
 const elementoStock = document.getElementById("resumenInventarioStock");
 const elementoValor = document.getElementById("resumenInventarioValor");
 const elementoSinStock = document.getElementById("resumenInventarioSinStock");

 if (elementoTotal) elementoTotal.textContent = total.toLocaleString("es-MX");
 if (elementoStock) elementoStock.textContent = stockTotal.toLocaleString("es-MX");
 if (elementoValor) elementoValor.textContent = dinero(valorInventario);
 if (elementoSinStock) elementoSinStock.textContent = sinStock.toLocaleString("es-MX");
}

function buscarInventario() {
 paginaInventario = 1;
 cargarTablaInventario();
}

function toggleVistaProductosPOS() {
 const listado =
 document.getElementById("productos");

 if (!listado) return;

 listado.classList.toggle("productos-lista-pos");
}

function enfocarFiltroPOS() {
 const buscador =
 document.getElementById("busqueda");

 if (!buscador) return;

 buscador.focus();
 buscador.select();
 buscador.closest(".buscador-con-limpiar")?.classList.add("filtro-activo-pos");
 setTimeout(() => {
  buscador.closest(".buscador-con-limpiar")?.classList.remove("filtro-activo-pos");
 }, 1400);
}

function paginasVisiblesPaginacion(paginaActual, totalPaginas) {
 const vecinos = new Set([1, totalPaginas, paginaActual - 1, paginaActual, paginaActual + 1]);

 return [...vecinos]
 .filter(pagina => pagina >= 1 && pagina <= totalPaginas)
 .sort((a, b) => a - b);
}

function renderPaginacion(contenedorId, totalItems, paginaActual, tamanoPagina, funcionCambio) {
 const contenedor =
 document.getElementById(contenedorId);

 if (!contenedor) return;

 const totalPaginas =
 Math.max(1, Math.ceil(totalItems / tamanoPagina));

 if (totalPaginas <= 1) {
 contenedor.innerHTML = "";
 return;
 }

 const visibles =
 paginasVisiblesPaginacion(paginaActual, totalPaginas);

 const botones = [];
 let anterior = 0;

 visibles.forEach(pagina => {
 if (anterior && pagina - anterior > 1) {
  botones.push(`<span class="paginacion-tabla-puntos">...</span>`);
 }

 botones.push(`
 <button
 class="${pagina === paginaActual ? "activo" : ""}"
 onclick="${funcionCambio}(${pagina})"
 >
 ${pagina}
 </button>
 `);

 anterior = pagina;
 });

 contenedor.innerHTML = `
 <button onclick="${funcionCambio}(${Math.max(1, paginaActual - 1)})">
 Anterior
 </button>
 ${botones.join("")}
 <button onclick="${funcionCambio}(${Math.min(totalPaginas, paginaActual + 1)})">
 Siguiente
 </button>
 `;
}

function cambiarPaginaInventario(pagina) {
 paginaInventario = pagina;
 cargarTablaInventario();
}

function cambiarPaginaInventarioBajo(pagina) {
 paginaInventarioBajo = pagina;
 renderInventarioBajo(false);
}

function cambiarPaginaReporteVentas(pagina) {
 paginaReporteVentas = pagina;
 cargarReportesVentas();
}

function actualizarTextoPaginacionInventario(total, inicio, fin) {
 const elemento =
 document.getElementById("inventarioPaginacionTexto");

 if (!elemento) return;

 elemento.textContent =
 total === 0
 ? "Sin productos para mostrar"
 : `Mostrando ${inicio + 1} a ${Math.min(fin, total)} de ${total} productos`;
}

function cargarTablaInventario() {
 const tabla =
 document.getElementById("tablaInventario");

 if (!tabla) return;

 tabla.innerHTML = "";

 const productos =
 productosInventarioFiltrados();

 const totalPaginas =
 Math.max(
 1,
 Math.ceil(productos.length / tamanoPaginaInventarioActual)
 );

 paginaInventario =
 Math.min(paginaInventario, totalPaginas);

 const inicio =
 (paginaInventario - 1) * tamanoPaginaInventarioActual;

 const productosPagina =
 productos.slice(
 inicio,
 inicio + tamanoPaginaInventarioActual
 );

 if (productos.length === 0) {
 tabla.innerHTML = `
 <tr>
 <td colspan="7" class="inventario-vacio">
 No se encontraron productos.
 </td>
 </tr>
 `;
 renderPaginacion(
 "paginacionInventario",
 0,
 1,
 tamanoPaginaInventarioActual,
 "cambiarPaginaInventario"
 );
 actualizarTextoPaginacionInventario(0, 0, 0);
 renderResumenInventario();
 return;
 }

 productosPagina.forEach((producto) => {
 const unidad =
 unidadProducto(producto);

 const estado =
 estadoInventarioProducto(producto);

 tabla.innerHTML += `
 <tr>
 <td>${producto.codigo || "-"}</td>
 <td>
 <div class="producto-inventario-celda">
 <span class="producto-inventario-icono">${miniaturaProducto(producto, "producto-inventario-icono-img")}</span>
 <div>
 <strong>${escaparPOS(producto.nombre || "")}</strong>
 ${producto.subcategoria ? `<small>${escaparPOS(producto.subcategoria)}</small>` : ""}
 </div>
 </div>
 </td>
 <td>${escaparPOS(producto.categoria || "-")}</td>
 <td>$${Number(producto.precio).toFixed(2)}</td>
 <td>${producto.stock} ${unidad}${piezasSueltasInfoCelda(producto)}</td>
 <td>
 <span class="estado-inventario ${estado.clase}">
 ${estado.texto}
 </span>
 </td>
 <td class="acciones-inventario">
 <button title="Ver detalles" onclick="verDetalleProducto(${producto.id})">${iconoUISVG("eye")}</button>
 <button title="Editar" onclick="editarProducto(${producto.id})">${iconoUISVG("edit")}</button>
 <button title="Eliminar" class="accion-peligro" onclick="eliminarProducto(${producto.id})">${iconoUISVG("trash")}</button>
 </td>
 </tr>
 `;
 });

 renderPaginacion(
 "paginacionInventario",
 productos.length,
 paginaInventario,
 tamanoPaginaInventarioActual,
 "cambiarPaginaInventario"
 );

 actualizarTextoPaginacionInventario(productos.length, inicio, inicio + productosPagina.length);
 renderResumenInventario();
}

function imprimirCodigosBarrasInventario() {
 const productos =
 productosInventarioFiltrados();

 if (!productos.length) {
 alertaPOS("No hay productos para imprimir con los filtros actuales.", "Imprimir codigos", "info");
 return;
 }

 if (typeof JsBarcode !== "function") {
 alertaPOS("No se pudo cargar el generador de codigos de barras. Revisa tu conexion a internet e intenta de nuevo.", "Imprimir codigos", "alerta");
 return;
 }

 const negocio =
 configuracionNegocio() || {};

 const etiquetas =
 productos.map(producto => {
 const codigo =
 String(producto.codigo || "").trim();

 if (!codigo) return "";

 const svg =
 document.createElementNS("http://www.w3.org/2000/svg", "svg");

 try {
 JsBarcode(svg, codigo, {
 format: "CODE128",
 width: 1.6,
 height: 42,
 fontSize: 12,
 margin: 6,
 displayValue: true
 });
 } catch (error) {
 console.warn("No se pudo generar codigo de barras para", codigo, error);
 return "";
 }

 return `
 <div class="etiqueta-producto">
 <strong>${escaparPOS(producto.nombre || "")}</strong>
 <div class="etiqueta-barcode">${svg.outerHTML}</div>
 <span>${dinero(producto.precio || 0)}</span>
 </div>
 `;
 }).filter(Boolean).join("");

 if (!etiquetas) {
 alertaPOS("Ninguno de los productos filtrados tiene codigo asignado todavia.", "Imprimir codigos", "info");
 return;
 }

 const ventana =
 window.open("", "_blank", "width=900,height=720");

 ventana.document.write(`
 <html>
 <head>
 <title>Codigos de barras - ${escaparPOS(negocio.nombre || "")}</title>
 <style>
 body{font-family:Arial,sans-serif;color:#111827;padding:20px;}
 h1{font-size:18px;margin:0 0 4px;}
 p{margin:0 0 18px;color:#475467;font-size:12px;}
 .hoja-etiquetas{display:grid;grid-template-columns:repeat(3,1fr);gap:14px;}
 .etiqueta-producto{border:1px solid #d0d5dd;border-radius:8px;padding:10px;text-align:center;page-break-inside:avoid;}
 .etiqueta-producto strong{display:block;font-size:12px;margin-bottom:6px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
 .etiqueta-barcode svg{max-width:100%;}
 .etiqueta-producto span{display:block;margin-top:4px;font-size:13px;font-weight:700;}
 @media print{
 .etiqueta-producto{break-inside:avoid;}
 }
 </style>
 </head>
 <body>
 <h1>${escaparPOS(negocio.nombre || "Codigos de barras")}</h1>
 <p>${new Date().toLocaleString("es-MX")} - ${productos.length} producto(s)</p>
 <div class="hoja-etiquetas">${etiquetas}</div>
 <script>window.print();</script>
 </body>
 </html>
 `);
 ventana.document.close();
}

// Abre el formulario para un producto NUEVO -- a diferencia de llamar
// mostrarFormularioAgregar() directo, esto garantiza que no quede un
// productoEditandoId de una edicion anterior sin confirmar. Bug real:
// abrir "Editar producto", navegar a otra pantalla sin darle
// Cancelar, y despues abrir "Agregar producto" de nuevo guardaba
// encima del producto que se estaba editando en vez de crear uno
// nuevo. Todo punto de entrada que significa "producto nuevo" debe
// pasar por aqui en vez de llamar mostrarFormularioAgregar() directo
// -- editarProducto() sigue llamando mostrarFormularioAgregar() sin
// pasar por esta funcion, ya que necesita que productoEditandoId siga
// puesto.
function abrirFormularioAgregarProductoNuevo() {
 productoEditandoId = null;
 mostrarFormularioAgregar();
}

function mostrarFormularioAgregar() {
 if (typeof ocultarPantallasPrincipales === "function") {
 ocultarPantallasPrincipales();
 }

 asegurarEtiquetasFichaProducto();
 asegurarChipsSubcategoria();
 cargarCategoriasNexo();
 inicializarCampoCodigoProducto();

 if (!productoEditandoId) {
 const botonSugerencia =
 asegurarBotonSugerenciaPrecio();

 if (botonSugerencia) botonSugerencia.style.display = "none";
 }

 document
 .getElementById("nuevoCodigo")
 ?.setAttribute("autocomplete", "off");

 document
 .getElementById("nuevoStock")
 ?.setAttribute("autocomplete", "off");

 if (!productoEditandoId) {
 seleccionarTipoProducto(
 document.getElementById("tipoProductoInventario")?.value ||
 "catalogo"
 );

 const tituloModal =
 document.getElementById("modalAgregarTitulo");

 const botonGuardar =
 document.getElementById("btnGuardarProducto");

 if (tituloModal) {
 tituloModal.textContent =
 "Agregar producto";
 }

 if (botonGuardar) {
 botonGuardar.textContent =
 "Guardar producto";
 }
 }

 const breadcrumbActual =
 document.getElementById("productoFormBreadcrumbActual");

 if (breadcrumbActual) {
 breadcrumbActual.textContent =
 productoEditandoId ? "Editar producto" : "Agregar producto";
 }

 document.getElementById(
 "modalAgregar"
 ).style.display = "block";

 if (typeof actualizarModuloActivoPOS === "function") {
 actualizarModuloActivoPOS("agregar-producto");
 }

 if (typeof actualizarTopbarContexto === "function") {
 actualizarTopbarContexto(
 productoEditandoId ? "Editar producto" : "Agregar producto",
 "Completa la informacion de tu producto",
 "agregar-producto"
 );
 }

 setTimeout(() => {
 const campoCodigo =
 document.getElementById("nuevoCodigo");

 campoCodigo?.focus();
 campoCodigo?.select();
 }, 80);
}

function inicializarCampoCodigoProducto() {
 inicializarBusquedaCatalogoCampo("nuevoCodigo", buscarEnCatalogo);
 inicializarBusquedaCatalogoCampo("nuevoCodigoInterno", buscarEnCatalogoPorCodigoInterno);
}

// Busca en el catalogo con una pequena pausa (en vez de en cada tecla) --
// sobre todo pensado para cuando se escanea el codigo con una pistola, que
// "teclea" muy rapido: sin la pausa, cada caracter del escaneo dispara una
// busqueda completa en el catalogo y se siente lento/trabado mientras
// escribe.
function inicializarBusquedaCatalogoCampo(id, buscarFn) {
 const campo =
 document.getElementById(id);

 if (!campo || campo.dataset.lectorListo === "1") return;

 campo.dataset.lectorListo = "1";

 const buscarConPausa = () => {
 clearTimeout(campo._temporizadorCatalogo);
 campo._temporizadorCatalogo =
 setTimeout(buscarFn, 80);
 };

 campo.addEventListener("input", buscarConPausa);
 campo.addEventListener("change", buscarFn);
 campo.addEventListener("paste", buscarConPausa);
 campo.addEventListener("keydown", event => {
 if (event.key === "Enter") {
 event.preventDefault();
 buscarFn();
 }
 });
}

// Regresa el selector de "Proveedor del catalogo" y el de "Modo de
// captura" a su estado inicial (sin proveedor elegido, codigo de barras
// como modo por defecto) al abrir o cerrar el formulario de producto.
function reiniciarProveedorCatalogoProducto() {
 document.querySelectorAll("#proveedorCatalogoSeccion [data-proveedor-catalogo]").forEach(boton => {
 boton.classList.remove("activo");
 });

 const panelInfo =
 document.getElementById("proveedorCatalogoInfo");

 if (panelInfo) panelInfo.style.display = "none";

 const margenSeccion =
 document.getElementById("margenManualProveedorSeccion");

 if (margenSeccion) margenSeccion.style.display = "none";

 ultimaReglaProveedorCatalogo = null;
 contextoPrecioListaCatalogoProducto = null;

 aplicarModoCapturaProducto("barras");

 ["nuevoNombre", "nuevoCodigoInterno", "nuevaMarca", "nuevoProveedor", "nuevoCodigo"]
 .forEach(id => marcarCampoAutocompletado(id, false));
}

function cerrarFormularioAgregar() {
 productoEditandoId = null;
 codigoDuplicadoConfirmado = null;
 reiniciarProveedorCatalogoProducto();
 marcarImagenProductoEncontrada(false);
 codigoImagenExistenteActual = null;

 document.getElementById("nuevoCodigo").value = "";
 delete document.getElementById("nuevoCodigo").dataset.codigoAutomatico;
 document.getElementById("nuevoNombre").value = "";
 document.getElementById("precioDistribuidor").value = "";
 document.getElementById("precioMayoreo").value = "";
 document.getElementById("nuevoPrecio").value = "";
 document.getElementById("nuevoStock").value = "";
 document.getElementById("stockMinimo").value = "3";
 document.getElementById("nuevoProveedor").value = "";
 document.getElementById("nuevaUbicacion").value = "";
 document.getElementById("altaRotacion").value = "";
 document.getElementById("nuevoCodigoInterno").value = "";
 document.getElementById("codigosRelacionados").value = "";
 document.getElementById("nuevaCategoria").value = "";
 reiniciarCategoriaNexoCampo();
 document.getElementById("nuevaSubcategoria").value = "";
 renderChipsSubcategoria([]);
 document.getElementById("nuevaMarca").value = "";
 document.getElementById("nuevaDescripcion").value = "";
 document.getElementById("unidadVenta").value = "pieza";
 document.getElementById("precioPublico").value = "";
 document.getElementById("tipoProductoInventario").value = "catalogo";
 document.getElementById("presentacionCompra").value = "";
 document.getElementById("factorConversion").value = "";
 document.getElementById("permiteVentaPieza").checked = false;
 document.getElementById("unidadSuelta").value = "pieza";
 document.getElementById("piezasPorBolsa").value = "";
 document.getElementById("precioPieza").value = "";
 togglePiezaCamposProducto();
 document.getElementById("nuevaTieneGarantia").checked = false;
 document.getElementById("nuevoGarantiaDetalle").value = "";
 toggleGarantiaCamposProducto();
 mostrarPiezasSueltasStockInfo(0);
 document.getElementById("basculaDigital").value = "no";
 actualizarAyudaPrecioProducto();
 document.getElementById("nuevoStockMaximo").value = "";
 document.getElementById("nuevoPeso").value = "";
 document.getElementById("nuevoLargoCm").value = "";
 document.getElementById("nuevoAnchoCm").value = "";
 document.getElementById("nuevoAltoCm").value = "";
 document.getElementById("nuevasNotasInternas").value = "";
 document.getElementById("nuevaNoAdmiteCambios").checked = false;
 mostrarImagenPreviewProducto("");
 seleccionarTipoProducto("catalogo");

 const tituloModal =
 document.getElementById("modalAgregarTitulo");

 const botonGuardar =
 document.getElementById("btnGuardarProducto");

 if (tituloModal) {
 tituloModal.textContent =
 "Agregar producto";
 }

 if (botonGuardar) {
 botonGuardar.textContent =
 "Guardar producto";
 }

 if (typeof mostrarInventario === "function") {
 mostrarInventario();
 } else {
 document.getElementById("modalAgregar").style.display = "none";
 }
}
function limpiarCamposCatalogoProducto() {
 document.getElementById("nuevoNombre").value = "";
 document.getElementById("precioDistribuidor").value = "";
 document.getElementById("precioMayoreo").value = "";
 document.getElementById("nuevoPrecio").value = "";
 document.getElementById("precioPublico").value = "";
 document.getElementById("nuevoProveedor").value = "";
 document.getElementById("nuevoCodigoInterno").value = "";
 document.getElementById("codigosRelacionados").value = "";
 document.getElementById("nuevaCategoria").value = "";
 reiniciarCategoriaNexoCampo();
 document.getElementById("nuevaMarca").value = "";
 document.getElementById("nuevaDescripcion").value = "";
 document.getElementById("stockMinimo").value = "3";
 document.getElementById("altaRotacion").value = "";
 document.getElementById("presentacionCompra").value = "";
 document.getElementById("factorConversion").value = "";
 document.getElementById("permiteVentaPieza").checked = false;
 document.getElementById("unidadSuelta").value = "pieza";
 document.getElementById("piezasPorBolsa").value = "";
 document.getElementById("precioPieza").value = "";
 togglePiezaCamposProducto();
 document.getElementById("nuevaTieneGarantia").checked = false;
 document.getElementById("nuevoGarantiaDetalle").value = "";
 toggleGarantiaCamposProducto();
 mostrarPiezasSueltasStockInfo(0);
 document.getElementById("basculaDigital").value = "no";
 actualizarAyudaPrecioProducto();
 ["nuevoNombre", "nuevoCodigoInterno", "nuevaMarca", "nuevoProveedor", "nuevoCodigo"]
 .forEach(id => marcarCampoAutocompletado(id, false));
}

// Aplica un producto encontrado en el catalogo del proveedor al formulario.
// origen indica que campo escribio el usuario (para no pisarle lo que acaba
// de teclear) -- "barras" cuando vino de nuevoCodigo, "interno" cuando vino
// de nuevoCodigoInterno (caso Gafi: catalogos sin codigo de barras real).
async function aplicarProductoCatalogoAlFormulario(producto, origen) {
 seleccionarTipoProducto("catalogo");

 document.getElementById("nuevoNombre").value =
 producto.nombre || "";

 marcarCampoAutocompletado("nuevoNombre", Boolean(producto.nombre));

 document.getElementById("precioDistribuidor").value =
 producto.distribuidor || "";

 document.getElementById("precioMayoreo").value =
 producto.medioMayoreo || "";

 document.getElementById("nuevoPrecio").value =
 producto.medioMayoreo ||
 producto.publico ||
 producto.distribuidor ||
 "";

 document.getElementById("precioPublico").value =
 producto.publico || "";

 document.getElementById("nuevoProveedor").value =
 producto.proveedor ||
 localStorage.getItem("ultimoProveedorCatalogo") ||
 ultimoProveedorCatalogo() ||
 "Diprofer";

 marcarCampoAutocompletado("nuevoProveedor", Boolean(producto.proveedor));

 if (origen !== "interno") {
 document.getElementById("nuevoCodigoInterno").value =
 producto.codigoInterno || "";

 marcarCampoAutocompletado("nuevoCodigoInterno", Boolean(producto.codigoInterno));
 } else if (origen !== "barras" && producto.codigoBarras) {
 document.getElementById("nuevoCodigo").value =
 producto.codigoBarras;

 marcarCampoAutocompletado("nuevoCodigo", true);
 }

 document.getElementById("codigosRelacionados").value =
 (producto.codigosRelacionados || [])
 .join(", ");

 document.getElementById("nuevaCategoria").value =
 producto.categoria || "";

 document.getElementById("nuevaMarca").value =
 producto.marca || "";

 marcarCampoAutocompletado("nuevaMarca", Boolean(producto.marca));

 document.getElementById("nuevaDescripcion").value =
 producto.descripcion || "";

 document.getElementById("unidadVenta").value =
 producto.unidadVenta || "pieza";

 document.getElementById(
 "stockMinimo"
 ).value =
 producto.stockMinimo || 3;

 document.getElementById(
 "altaRotacion"
 ).value =
 producto.altaRotacion || "";

 // Guarda el precio de lista y la categoria de este match para que el
 // campo de "margen a usar" del panel de proveedor (si esta visible)
 // pueda recalcular el precio sugerido si el usuario decide usar un
 // porcentaje distinto al configurado, sin tener que ir a la pantalla
 // de Precios por proveedor.
 contextoPrecioListaCatalogoProducto = {
 precioLista: Number(producto.publico || producto.medioMayoreo || producto.distribuidor || 0),
 categoria: producto.categoria || "",
 codigo: producto.codigo || ""
 };

 await mostrarSugerenciaPrecioProveedor(producto);

 actualizarInputMargenManualProveedor();

 // El match del catalogo llena los dos campos de codigo cuando viene
 // de un escaneo de codigo de barras (nuevoCodigo se queda con el
 // codigo de barras que se escaneo, nuevoCodigoInterno se autorrellena
 // con el codigo de catalogo del proveedor, arriba) -- banco_imagenes_
 // producto esta indexada por el codigo de CATALOGO, nunca por codigo
 // de barras, asi que nuevoCodigoInterno debe tener prioridad aqui.
 // Bug real: antes se prefería nuevoCodigo (por venir con valor
 // primero en el ||), asi que agregar un producto escaneando su codigo
 // de barras nunca encontraba la foto del banco aunque si existiera
 // para su codigo de catalogo -- solo funcionaba tecleando el codigo
 // de catalogo directo en nuevoCodigoInterno.
 const codigoParaFotos =
 normalizarCodigo(
 document.getElementById("nuevoCodigoInterno")?.value ||
 document.getElementById("nuevoCodigo")?.value ||
 ""
 );

 // Encadenado (no en paralelo): verificarBancoImagenesParaCodigo lee
 // codigoImagenExistenteActual para saber si ya hay foto propia y en
 // ese caso no ofrecer el banco -- si corrieran en paralelo, leeria el
 // valor viejo antes de que la primera consulta terminara.
 verificarImagenExistenteParaCodigo(codigoParaFotos)
 .then(() => verificarBancoImagenesParaCodigo(codigoParaFotos));

 enfocarStockNuevoProducto();
}

function buscarEnCatalogo() {
 const codigo =
 normalizarCodigo(
 document
 .getElementById("nuevoCodigo")
 .value
 );

 if (!codigo) {
 limpiarCamposCatalogoProducto();
 return;
 }

 const producto =
 productoDesdeCatalogo(codigo);

 if (!producto) return;

 aplicarProductoCatalogoAlFormulario(producto, "barras");
}

// Version del buscador de catalogo que lee del campo de codigo interno /
// clave de proveedor en vez del de codigo de barras -- para proveedores
// como Gafi, cuyos productos no traen codigo de barras real y solo se
// identifican por su clave interna.
function buscarEnCatalogoPorCodigoInterno() {
 const codigo =
 normalizarCodigo(
 document
 .getElementById("nuevoCodigoInterno")
 .value
 );

 if (!codigo) return;

 const producto =
 productoDesdeCatalogo(codigo);

 if (!producto) return;

 aplicarProductoCatalogoAlFormulario(producto, "interno");
}
