/* Nexo IA (IA-2b): la burbuja flotante ya no es el chat -- es un
   acceso rapido (resumen + recomendaciones + preguntas rapidas). El
   chat completo vive en el modulo de pantalla completa
   (#pantallaNexoIA), igual que Ventas, Inventario o Reportes.
   Sin persistencia: el historial vive solo en esta variable JS y se
   pierde al recargar -- aceptado para esta version. El interceptor
   global de fetch (app.js) ya agrega el header de auth correcto a
   las rutas de /ia/*, no hace falta nada especial aqui. */

let historialNexoIA = [];
let nexoIaEnviando = false;

/* Nexo AI v2 -- navegacion por conversacion: mapa deliberadamente
   acotado a los modulos con una funcion mostrarX() clara y directa
   en el sidebar (mismo subconjunto que MODULOS_NAVEGABLES en
   ia-server.js -- si el backend regresa una clave que no esta aqui,
   no se navega y no truena, se queda solo en la respuesta de texto). */
const NEXO_ACCIONES_MODULO = {
 inicio: () => mostrarInicio(),
 venta: () => mostrarPuntoVenta(),
 inventario: () => mostrarInventario(),
 categorias: () => mostrarCategoriasInventario(),
 "inventario-bajo": () => mostrarInventarioBajo(),
 reportes: () => mostrarGraficas(),
 clientes: () => mostrarClientes(),
 proveedores: () => mostrarProveedores(),
 catalogo: () => mostrarCatalogo(),
 configuracion: () => mostrarConfiguracion(),
 cuenta: () => mostrarCuenta()
};

function ejecutarAccionNexoIA(accion) {
 if (!accion) return;

 try {
  if (accion.tipo === "abrir_modulo") {
   const abrir = NEXO_ACCIONES_MODULO[accion.modulo];
   if (typeof abrir === "function") abrir();
   return;
  }

  if (accion.tipo === "preparar_creacion") {
   ejecutarPreparacionCreacionNexoIA(accion.datosCreacion);
  }
 } catch (error) {
  console.error("Nexo AI: no se pudo ejecutar la accion", accion, error);
 }
}

/* Nexo AI v2 -- "preparar creacion": la IA nunca escribe en la base de
   datos, solo estructura los datos que el usuario menciono. Aqui se
   reusan las funciones que YA abren el formulario/guardan el registro
   (abrirNuevoClienteCredito, abrirNuevoProveedor -- ambas extendidas
   para aceptar un prellenado opcional) -- el usuario siempre ve el
   formulario antes de que se guarde nada. */
function ejecutarPreparacionCreacionNexoIA(datosCreacion) {
 if (!datosCreacion) return;
 const { tipo, datos } = datosCreacion;

 if (tipo === "cliente_credito") {
  mostrarClientes();
  setTimeout(() => abrirNuevoClienteCredito(datos), 150);
  return;
 }

 if (tipo === "proveedor") {
  mostrarProveedores();
  setTimeout(() => abrirNuevoProveedor(datos), 150);
  return;
 }

 if (tipo === "producto") {
  mostrarInventario();
  setTimeout(() => abrirProductoPrellenadoNexoIA(datos), 150);
 }
}

/* Producto no tiene una funcion "abrir con prellenado" propia --
   mostrarFormularioAgregar() abre el modal de siempre (el mismo que
   usa Inventario), aqui solo se le ponen valores encima antes de que
   el usuario lo vea. Nunca llama a agregarProductoNuevo() -- eso solo
   pasa si el usuario le da clic a Guardar el mismo. */
function abrirProductoPrellenadoNexoIA(datos) {
 mostrarFormularioAgregar();

 setTimeout(() => {
  const valores = {
   nuevoNombre: datos.nombre || "",
   nuevoCodigo: datos.codigo || "",
   nuevoPrecio: datos.precio ? String(datos.precio) : "",
   nuevoStock: datos.stock ? String(datos.stock) : ""
  };

  for (const [id, valor] of Object.entries(valores)) {
   const campo = document.getElementById(id);
   if (campo) campo.value = valor;
  }

  document.getElementById("nuevoNombre")?.focus();
 }, 120);
}

/* Personaje de Nexo (IA-5): ilustracion real (no SVG dibujado a mano)
   recortada de las imagenes que el usuario genero y guardo en
   public/img/nexo-ia/. Cada estado es una foto/render distinto, no
   una variante de color -- por eso aqui solo se elige el archivo, sin
   logica de dibujo. "analizando" no tiene pose propia en la hoja
   original (la referencia combina pensando/analizando en una sola
   imagen) -- reusa pensando.jpg. */
const NEXO_IMG_POR_ESTADO = {
 feliz: "feliz.jpg",
 pensando: "pensando.jpg",
 analizando: "pensando.jpg",
 alerta: "alerta.jpg",
 celebrando: "celebrando.jpg"
};

function nexoIaMarcaSVG(estado) {
 const archivo = NEXO_IMG_POR_ESTADO[estado] || NEXO_IMG_POR_ESTADO.feliz;
 return `<img class="nexo-ia-marca" src="img/nexo-ia/${archivo}" alt="Nexo" />`;
}

/* La burbuja flotante usa feliz.jpg (recorte ajustado, sin margen) en
   vez de icono-flotante.jpg -- ese archivo trae su propio circulo de
   fondo azul marino horneado en la imagen, lo que dejaba al personaje
   chico y con un aro azul de mas encima del degradado del boton. Sin
   ese circulo, el personaje llena el boton circular directamente. No
   tiene una version de "alerta" propia; el aviso de alerta en la
   burbuja se sigue mostrando solo con el punto rojo (.con-alerta). */
function nexoIaMarcaBurbujaSVG() {
 return `<img class="nexo-ia-marca" src="img/nexo-ia/feliz.jpg" alt="Nexo" />`;
}

async function nexoIaDatosProactivos() {
 try {
  const respuesta = await fetch("/ia/resumen-rapido");
  const datos = await respuesta.json();
  if (!respuesta.ok || !datos.ok || datos.acceso?.disponible === false) return null;
  return datos;
 } catch (error) {
  return null;
 }
}

/* Nexo AI v2 -- proactividad barata: mismo dato que ya trae el
   punto rojo (.con-alerta), solo se le arma una frase corta de
   plantilla fija (sin IA, $0) para que se pueda leer sin abrir el
   popover ni el chat -- va en el title/tooltip de la burbuja. */
function resumenProactivoNexoIA(datos) {
 if (!datos) return { hayAlerta: false, texto: "" };

 const stockBajo = datos.stockBajo.productos.length;
 const vencidos = datos.creditos.clientesVencidos;
 const hayAlerta = stockBajo > 0 || vencidos > 0;

 if (!hayAlerta) return { hayAlerta: false, texto: "" };

 const partes = [];
 if (stockBajo > 0) partes.push(`${stockBajo} producto(s) por agotarse`);
 if (vencidos > 0) partes.push(`${vencidos} credito(s) vencido(s)`);

 return { hayAlerta: true, texto: `Nexo IA: ${partes.join(" y ")}` };
}

const PREGUNTAS_RAPIDAS_NEXO_IA = [
 "Como van mis ventas?",
 "Que productos se estan agotando?",
 "Tengo creditos vencidos?"
];

function nexoIaEquipoVinculado() {
 const tokenDispositivo = localStorage.getItem("nexoDispositivoToken");
 const tokenCuenta = localStorage.getItem("nexoCuentaSesionToken");
 return Boolean(tokenDispositivo || tokenCuenta);
}

function crearNexoIaUI() {
 if (document.getElementById("nexoIaBurbuja")) return;

 const burbuja = document.createElement("button");
 burbuja.id = "nexoIaBurbuja";
 burbuja.type = "button";
 burbuja.title = "Nexo IA";
 burbuja.innerHTML = nexoIaMarcaBurbujaSVG();
 burbuja.addEventListener("click", alternarPopoverNexoIA);

 const popover = document.createElement("div");
 popover.id = "nexoIaPopover";

 document.body.appendChild(burbuja);
 document.body.appendChild(popover);
}

function alternarPopoverNexoIA() {
 const popover = document.getElementById("nexoIaPopover");
 if (!popover) return;

 const abriendo = !popover.classList.contains("abierto");
 popover.classList.toggle("abierto", abriendo);

 if (abriendo) cargarResumenRapidoNexoIA();
}

function cerrarPopoverNexoIA() {
 document.getElementById("nexoIaPopover")?.classList.remove("abierto");
}

async function cargarResumenRapidoNexoIA() {
 const popover = document.getElementById("nexoIaPopover");
 if (!popover) return;

 popover.innerHTML = `
  <div class="nexo-ia-popover-cabecera">
   ${nexoIaMarcaSVG("feliz")}
   <div class="nexo-ia-popover-titulo">Nexo IA</div>
  </div>
  <p class="nexo-ia-popover-cargando">Revisando tu negocio...</p>
 `;

 try {
  const respuesta = await fetch("/ia/resumen-rapido");
  const datos = await respuesta.json();

  if (!respuesta.ok || !datos.ok) {
   popover.querySelector(".nexo-ia-popover-cargando").textContent = "No se pudo cargar el resumen ahora mismo.";
   renderAccesosPopoverNexoIA(popover);
   return;
  }

  if (datos.acceso?.disponible === false) {
   popover.querySelector(".nexo-ia-popover-cargando").remove();
   renderUpsellPopoverNexoIA(popover);
   return;
  }

  const hayAlerta = datos.stockBajo.productos.length > 0 || datos.creditos.clientesVencidos > 0;
  const marca = popover.querySelector(".nexo-ia-popover-cabecera");
  if (marca) marca.innerHTML = nexoIaMarcaSVG(hayAlerta ? "alerta" : "feliz") + '<div class="nexo-ia-popover-titulo">Nexo IA</div>';

  const filas = [
   `Ventas (7 dias): ${datos.ventas.transacciones} venta(s), $${Number(datos.ventas.total).toFixed(2)}`,
   datos.stockBajo.productos.length === 0
    ? "Inventario: sin productos en stock bajo"
    : `Inventario: ${datos.stockBajo.productos.length} producto(s) con stock bajo`,
   datos.creditos.clientesVencidos === 0
    ? "Creditos: sin creditos vencidos"
    : `Creditos: ${datos.creditos.clientesVencidos} vencido(s) por $${Number(datos.creditos.totalVencido).toFixed(2)}`
  ];

  popover.querySelector(".nexo-ia-popover-cargando").remove();

  const resumen = document.createElement("div");
  resumen.className = "nexo-ia-popover-resumen";
  resumen.innerHTML = filas.map(fila => `<p>${fila}</p>`).join("");
  popover.appendChild(resumen);

  renderAccesosPopoverNexoIA(popover);
 } catch (error) {
  popover.querySelector(".nexo-ia-popover-cargando").textContent = "No se pudo conectar con Nexo ahora mismo.";
  renderAccesosPopoverNexoIA(popover);
 }
}

function renderAccesosPopoverNexoIA(popover) {
 const preguntas = document.createElement("div");
 preguntas.className = "nexo-ia-popover-preguntas";
 preguntas.innerHTML = PREGUNTAS_RAPIDAS_NEXO_IA.map(
  (pregunta, indice) => `<button type="button" data-pregunta-rapida="${indice}">${pregunta}</button>`
 ).join("");
 popover.appendChild(preguntas);

 preguntas.querySelectorAll("[data-pregunta-rapida]").forEach(boton => {
  boton.addEventListener("click", () => {
   const pregunta = PREGUNTAS_RAPIDAS_NEXO_IA[Number(boton.dataset.preguntaRapida)];
   cerrarPopoverNexoIA();
   abrirNexoIAConPregunta(pregunta);
  });
 });

 const abrir = document.createElement("button");
 abrir.type = "button";
 abrir.className = "nexo-ia-popover-abrir";
 abrir.textContent = "Abrir Nexo IA";
 abrir.addEventListener("click", () => {
  cerrarPopoverNexoIA();
  mostrarNexoIA();
 });
 popover.appendChild(abrir);
}

/* Nexo AI v2 -- panel de ayuda ligero para planes sin IA (Basico):
   en vez de solo un aviso de upsell, se le da algo util de una vez
   (tour guiado de la seccion actual, sin IA, gratis para todos los
   planes) y el upsell queda como una linea discreta, no el bloque
   principal. */
function renderUpsellPopoverNexoIA(popover) {
 const ayuda = document.createElement("div");
 ayuda.className = "nexo-ia-popover-resumen";
 ayuda.innerHTML = "<p>Nexo puede guiarte por esta seccion aunque tu plan no incluya IA.</p>";
 popover.appendChild(ayuda);

 const verTour = document.createElement("button");
 verTour.type = "button";
 verTour.className = "nexo-ia-popover-abrir";
 verTour.textContent = "Ver tour de esta seccion";
 verTour.addEventListener("click", () => {
  cerrarPopoverNexoIA();
  if (typeof nexoIaTourManual === "function") nexoIaTourManual();
 });
 popover.appendChild(verTour);

 const aviso = document.createElement("div");
 aviso.className = "nexo-ia-popover-resumen";
 aviso.innerHTML = "<p>Nexo IA (con inteligencia artificial) esta disponible desde el plan Plus.</p>";
 popover.appendChild(aviso);

 const irACuenta = document.createElement("button");
 irACuenta.type = "button";
 irACuenta.className = "nexo-ia-popover-abrir";
 irACuenta.textContent = "Ver planes";
 irACuenta.addEventListener("click", () => {
  cerrarPopoverNexoIA();
  if (typeof mostrarCuenta === "function") mostrarCuenta();
 });
 popover.appendChild(irACuenta);
}

function abrirNexoIAConPregunta(pregunta) {
 mostrarNexoIA();
 const input = document.getElementById("nexoIaInput");
 if (input) input.value = pregunta;
 enviarMensajeNexoIA();
}

async function mostrarNexoIA() {
 if (typeof ocultarPantallasPrincipales === "function") {
  ocultarPantallasPrincipales();
 }

 const pantalla = document.getElementById("pantallaNexoIA");
 if (!pantalla) return;

 pantalla.style.display = "block";

 if (typeof actualizarModuloActivoPOS === "function") {
  actualizarModuloActivoPOS("nexo-ia");
 }

 if (typeof actualizarTopbarContexto === "function") {
  actualizarTopbarContexto("Nexo IA", "Tu asistente para ventas, inventario y creditos", "nexo-ia");
 }

 let disponible = true;
 try {
  const respuesta = await fetch("/ia/resumen-rapido");
  const datos = await respuesta.json();
  disponible = !(respuesta.ok && datos.ok && datos.acceso?.disponible === false);
 } catch (error) {
  disponible = true; // si falla la verificacion, se deja intentar -- el backend igual bloquea /ia/chat
 }

 if (!disponible) {
  pantalla.innerHTML = `
   <div class="caja nexo-ia-vista">
    <div class="nexo-ia-vista-cabecera">
     ${nexoIaMarcaSVG("feliz")}
     <div>
      <h2>Nexo IA</h2>
      <p class="nexo-ia-vista-subtitulo">Disponible desde el plan Plus</p>
     </div>
    </div>
    <div class="nexo-ia-mensajes">
     <p>Con tu plan actual todavia no tienes acceso a Nexo IA. Mejora tu plan desde Cuenta para empezar a usarme.</p>
    </div>
    <div class="nexo-ia-entrada">
     <button type="button" id="nexoIaIrACuenta">Ver planes</button>
    </div>
   </div>
  `;
  document.getElementById("nexoIaIrACuenta")?.addEventListener("click", () => {
   if (typeof mostrarCuenta === "function") mostrarCuenta();
  });
  return;
 }

 pantalla.innerHTML = `
  <div class="caja nexo-ia-vista">
   <div class="nexo-ia-vista-cabecera" id="nexoIaVistaCabecera">
    ${nexoIaMarcaSVG("feliz")}
    <div>
     <h2>Nexo IA</h2>
     <p class="nexo-ia-vista-subtitulo">Pregunta lo que quieras saber de tu negocio</p>
    </div>
   </div>
   <div class="nexo-ia-mensajes" id="nexoIaMensajes"></div>
   <div class="nexo-ia-entrada">
    <textarea id="nexoIaInput" placeholder="Escribe tu pregunta..." maxlength="2000"></textarea>
    <button type="button" id="nexoIaEnviar">Enviar</button>
   </div>
  </div>
 `;

 document.getElementById("nexoIaEnviar").addEventListener("click", enviarMensajeNexoIA);
 document.getElementById("nexoIaInput").addEventListener("keydown", evento => {
  if (evento.key === "Enter" && !evento.shiftKey) {
   evento.preventDefault();
   enviarMensajeNexoIA();
  }
 });

 if (historialNexoIA.length === 0) {
  agregarMensajeNexoIA("Hola, soy Nexo. Preguntame como van tus ventas, tu inventario o tus creditos.", "asistente");
 } else {
  historialNexoIA.forEach(entrada => {
   agregarMensajeNexoIA(entrada.contenido, entrada.rol === "user" ? "usuario" : "asistente");
  });
 }
}

function actualizarMarcaCabeceraNexoIA(estado) {
 const actual = document.querySelector("#nexoIaVistaCabecera .nexo-ia-marca");
 if (actual) actual.outerHTML = nexoIaMarcaSVG(estado);
}

function agregarMensajeNexoIA(texto, clase) {
 const lista = document.getElementById("nexoIaMensajes");
 if (!lista) return null;
 const burbuja = document.createElement("div");
 burbuja.className = `nexo-ia-mensaje ${clase}`;
 burbuja.textContent = texto;
 lista.appendChild(burbuja);
 lista.scrollTop = lista.scrollHeight;
 return burbuja;
}

async function enviarMensajeNexoIA() {
 if (nexoIaEnviando) return;

 const input = document.getElementById("nexoIaInput");
 const mensaje = (input?.value || "").trim();
 if (!mensaje) return;

 input.value = "";
 agregarMensajeNexoIA(mensaje, "usuario");
 const indicador = agregarMensajeNexoIA("Nexo esta pensando...", "pensando");
 actualizarMarcaCabeceraNexoIA("pensando");

 nexoIaEnviando = true;
 const botonEnviar = document.getElementById("nexoIaEnviar");
 if (botonEnviar) botonEnviar.disabled = true;

 try {
  const respuesta = await fetch("/ia/chat", {
   method: "POST",
   headers: { "Content-Type": "application/json" },
   body: JSON.stringify({ mensaje, historial: historialNexoIA })
  });

  const datos = await respuesta.json();
  indicador?.remove();

  if (!respuesta.ok || !datos.ok) {
   agregarMensajeNexoIA(datos.error || "Nexo no pudo responder. Intenta de nuevo.", "error");
   return;
  }

  agregarMensajeNexoIA(datos.respuesta, "asistente");
  historialNexoIA.push({ rol: "user", contenido: mensaje });
  historialNexoIA.push({ rol: "assistant", contenido: datos.respuesta });
  historialNexoIA = historialNexoIA.slice(-12);

  // Se navega DESPUES de mostrar el texto, para que el usuario vea
  // primero que Nexo entendio antes de que la pantalla cambie.
  if (datos.accion) setTimeout(() => ejecutarAccionNexoIA(datos.accion), 400);

  // El "finally" de abajo siempre deja la marca en "feliz" -- esto
  // corre despues y la reemplaza brevemente por "celebrando".
  if (datos.celebrar) {
   setTimeout(() => actualizarMarcaCabeceraNexoIA("celebrando"), 50);
   setTimeout(() => actualizarMarcaCabeceraNexoIA("feliz"), 2200);
  }
 } catch (error) {
  indicador?.remove();
  agregarMensajeNexoIA("No se pudo conectar con Nexo. Revisa tu conexion.", "error");
 } finally {
  nexoIaEnviando = false;
  const boton = document.getElementById("nexoIaEnviar");
  if (boton) boton.disabled = false;
  actualizarMarcaCabeceraNexoIA("feliz");
 }
}

async function actualizarVisibilidadNexoIA() {
 const burbuja = document.getElementById("nexoIaBurbuja");
 if (!burbuja) return;

 const vinculado = nexoIaEquipoVinculado();
 burbuja.classList.toggle("visible", vinculado);
 if (!vinculado) return;

 const datos = await nexoIaDatosProactivos();
 const { hayAlerta, texto } = resumenProactivoNexoIA(datos);
 burbuja.classList.toggle("con-alerta", hayAlerta);
 burbuja.title = hayAlerta ? texto : "Nexo IA";
}

document.addEventListener("DOMContentLoaded", () => {
 crearNexoIaUI();
 actualizarVisibilidadNexoIA();
});
