/* Asistente de inicio (primer uso, escritorio).

   Se abre justo despues de que un negocio NUEVO crea su perfil de
   administrador (crearPerfilAdministradorInicial, config-auth.js) y, si se
   deja a medias, un recordatorio flotante lo retoma.

   Una pregunta por pantalla:
     bienvenida -> giro -> correos -> datos del negocio -> como vende -> listo

   Todo se guarda en el servidor, por pasos (GET/PUT /negocio-actual/onboarding
   y las rutas de siempre: /giro, /nivel-precio, /marca), asi que se puede
   cerrar y retomar, y vale igual desde cualquier caja del negocio.

   Los negocios que ya existian NO lo ven (la migracion los marco terminados). */

const ASISTENTE_GIROS = [
 { id: "abarrotes", icono: "🛒", nombre: "Abarrotes", detalle: "Tienda de la esquina o minisuper" },
 { id: "ferreteria", icono: "🔧", nombre: "Ferreteria", detalle: "Herramientas y materiales" },
 { id: "papeleria", icono: "✏️", nombre: "Papeleria", detalle: "Utiles, copias y regalos" },
 { id: "vinateria", icono: "🍷", nombre: "Vinateria", detalle: "Vinos, licores y cerveza" },
 { id: "general", icono: "🧰", nombre: "Otro negocio", detalle: "Otro tipo de comercio" }
];

const ASISTENTE_ESLOGANES = {
 abarrotes: "Lo que necesitas, cerca de ti",
 ferreteria: "Todo para construir tus proyectos",
 papeleria: "Todo para tu escuela y tu oficina",
 vinateria: "Tu mejor brindis, a buen precio",
 general: "Aqui encuentras lo que buscas"
};

const ASISTENTE_COLORES = ["#0d6efd", "#16a34a", "#dc2626", "#ea580c", "#7c3aed", "#0f766e"];

// Lo que se sugiere segun el giro; la persona lo puede cambiar. Con varios
// giros activos, un "si" de cualquiera de ellos gana.
const ASISTENTE_SUGERENCIAS_GIRO = {
 abarrotes: { granel: "si", fiado: "si", caducidad: "si" },
 ferreteria: { granel: "no", fiado: "si", caducidad: "no" },
 papeleria: { granel: "no", fiado: "no", caducidad: "no" },
 vinateria: { granel: "no", fiado: "no", caducidad: "no" },
 general: { granel: "no", fiado: "no", caducidad: "no" }
};

const ASISTENTE_PASOS = ["bienvenida", "giro", "correos", "negocio", "vende", "equipo", "listo"];

const ASISTENTE_NIVELES_PRECIO = [
 { id: "publico", etiqueta: "Precio publico (lo normal)" },
 { id: "mayoreo", etiqueta: "Medio mayoreo" },
 { id: "distribuidor", etiqueta: "Mayoreo / distribuidor" }
];

let asistente = null;

function asistenteEsc(valor) {
 return typeof escaparPOS === "function"
  ? escaparPOS(valor)
  : String(valor ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

async function asistenteLlamar(url, opciones) {
 const respuesta = await fetch(url, opciones);
 const datos = await respuesta.json().catch(() => null);

 if (!respuesta.ok || !datos || datos.ok === false) {
  const error = new Error(datos?.error || "No se pudo guardar. Revisa tu conexion.");
  error.status = respuesta.status;
  throw error;
 }

 return datos;
}

function asistenteGuardarServidor(cuerpo) {
 return asistenteLlamar("/negocio-actual/onboarding", {
  method: "PUT",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(cuerpo)
 });
}

function asistenteSugerencia(giros, clave) {
 return (giros || []).some(giro => ASISTENTE_SUGERENCIAS_GIRO[giro]?.[clave] === "si") ? "si" : "no";
}

function asistenteEsloganSugerido() {
 const giro = (asistente?.giros || [])[0] || "general";
 return ASISTENTE_ESLOGANES[giro] || ASISTENTE_ESLOGANES.general;
}

// ---------------------------------------------------------------------
// Entrada
// ---------------------------------------------------------------------

/**
 * Abre el asistente si el negocio todavia no lo termino.
 * @returns {Promise<boolean>} true si se mostro (quien llama no debe mostrar
 *   la bienvenida de siempre), false si no hace falta o no se pudo.
 */
async function iniciarAsistenteInicio({ desdePaso = null } = {}) {
 try {
  const estado = await asistenteLlamar("/negocio-actual/onboarding");

  if (estado.completado) return false;

  asistente = {
   estado,
   paso: desdePaso ?? Math.min(Number(estado.respuestas?.paso) || 0, ASISTENTE_PASOS.length - 1),
   giros: [...estado.giros],
   datos: { ...estado.datos },
   respuestas: { ...estado.respuestas },
   // Lo que la persona ya contesto (o confirmo) no se vuelve a sugerir.
   contestadas: Object.fromEntries(Object.keys(estado.respuestas || {}).map(clave => [clave, true])),
   nivelPrecio: estado.nivelPrecio || "publico",
   logoNuevo: null,
   color: estado.datos.color || "#0d6efd",
   usarMismoCorreo: !estado.datos.correoNegocio,
   guardando: false
  };

  // Valores sugeridos solo para lo que todavia no se contesto.
  for (const clave of ["granel", "fiado", "caducidad"]) {
   if (!asistente.respuestas[clave]) asistente.respuestas[clave] = asistenteSugerencia(asistente.giros, clave);
  }
  // El nivel de un negocio recien registrado ya es "publico": se muestra tal cual.

  ocultarRecordatorioAsistente();
  asistenteMontar();
  asistentePintar();
  return true;
 } catch (error) {
  // 403 = no es administrador; sin red = ya habra otra oportunidad. Nunca
  // debe estorbar el arranque del sistema.
  return false;
 }
}

async function revisarAsistenteInicioPendiente(usuario) {
 if (document.getElementById("asistenteInicio")) return;
 if (!usuario || usuario.rol !== "Administrador") return;

 try {
  const estado = await asistenteLlamar("/negocio-actual/onboarding");
  if (estado.completado) {
   ocultarRecordatorioAsistente();
   return;
  }
  mostrarRecordatorioAsistente(Number(estado.respuestas?.paso) || 0);
 } catch (error) {
  // sin permiso o sin red: no se muestra nada
 }
}

function mostrarRecordatorioAsistente(paso) {
 ocultarRecordatorioAsistente();

 // Con el asistente abierto no hace falta recordarlo (la consulta de arranque
 // puede terminar despues de que se abrio).
 if (document.getElementById("asistenteInicio")) return;

 const barra = document.createElement("div");
 barra.id = "asistenteRecordatorio";
 barra.className = "asistente-pendiente";
 barra.innerHTML = `
  <span>Termina de configurar tu negocio</span>
  <button type="button" onclick="iniciarAsistenteInicio({ desdePaso: ${Number(paso) || 1} })">Continuar</button>
 `;
 document.body.appendChild(barra);
}

function ocultarRecordatorioAsistente() {
 document.getElementById("asistenteRecordatorio")?.remove();
}

// ---------------------------------------------------------------------
// Estructura
// ---------------------------------------------------------------------

function asistenteMontar() {
 document.getElementById("asistenteInicio")?.remove();

 const capa = document.createElement("div");
 capa.id = "asistenteInicio";
 capa.className = "asistente-overlay";
 capa.setAttribute("role", "dialog");
 capa.setAttribute("aria-modal", "true");
 capa.setAttribute("aria-label", "Configura tu negocio");
 capa.innerHTML = `
  <aside class="asistente-lado">
   <div class="rn-marca"><img src="nexo-pos-icon.jpg" alt="Nexo"><span>Nexo</span></div>
   <div class="rn-escena">
    <div class="rn-burbuja" id="asistenteBurbuja"></div>
    <img class="rn-mascota" id="asistenteMascotaGrande" src="img/nexo-ia/feliz-transparente.png" alt="Nexo, tu asistente">
   </div>
  </aside>
  <div class="asistente-card">
   <div id="asistenteEtapas" class="rn-etapas"></div>
   <div class="asistente-progreso"><span id="asistenteBarra" style="width:0%"></span></div>
   <div class="asistente-cabecera">
    <img class="asistente-mascota" src="img/nexo-ia/feliz-transparente.png" alt="Nexo">
    <div>
     <small id="asistenteEtapa"></small>
     <h2 id="asistenteTitulo"></h2>
    </div>
   </div>
   <div class="asistente-cuerpo" id="asistenteCuerpo"></div>
   <p class="asistente-error" id="asistenteError"></p>
   <div class="asistente-acciones" id="asistenteAcciones"></div>
  </div>
 `;
 document.body.appendChild(capa);
}

function asistenteError(mensaje) {
 const caja = document.getElementById("asistenteError");
 if (!caja) return;
 caja.textContent = mensaje || "";
 caja.style.display = mensaje ? "block" : "none";
}

function asistenteOcupado(ocupado) {
 asistente.guardando = ocupado;
 document.querySelectorAll("#asistenteAcciones button").forEach(boton => { boton.disabled = ocupado; });
}

function asistentePintar() {
 const paso = ASISTENTE_PASOS[asistente.paso];
 const total = ASISTENTE_PASOS.length - 1;

 document.getElementById("asistenteBarra").style.width = `${Math.round((asistente.paso / total) * 100)}%`;
 document.getElementById("asistenteEtapa").textContent =
  paso === "bienvenida" ? "Bienvenido" : paso === "listo" ? "Listo" : `Paso ${asistente.paso} de ${total - 1}`;

 asistenteError("");

 const pintores = {
  bienvenida: asistentePintarBienvenida,
  giro: asistentePintarGiro,
  correos: asistentePintarCorreos,
  negocio: asistentePintarNegocio,
  vende: asistentePintarVende,
  equipo: asistentePintarEquipo,
  listo: asistentePintarListo
 };

 pintores[paso]();

 if (window.recorridoNexo) recorridoNexo.actualizarEscenaAsistente(paso);
}

function asistenteAcciones({ atras = true, siguiente = "Siguiente", alSiguiente = "asistenteSiguiente()", mastarde = true } = {}) {
 document.getElementById("asistenteAcciones").innerHTML = `
  ${atras && asistente.paso > 0 ? `<button type="button" class="asistente-boton secundario" onclick="asistenteAtras()">Atras</button>` : ""}
  ${mastarde ? `<button type="button" class="asistente-enlace" onclick="asistenteDejarParaDespues()">Lo hago despues</button>` : ""}
  <span class="espacio"></span>
  <button type="button" class="asistente-boton" onclick="${alSiguiente}">${asistenteEsc(siguiente)}</button>
 `;
}

// ---------------------------------------------------------------------
// Pasos
// ---------------------------------------------------------------------

function asistentePintarBienvenida() {
 const nombre = asistente.nombreUsuario || (typeof usuarioActual !== "undefined" && usuarioActual?.nombre) || "";

 document.getElementById("asistenteTitulo").textContent = nombre ? `¡Bienvenido a Nexo, ${nombre}!` : "¡Bienvenido a Nexo!";
 document.getElementById("asistenteCuerpo").innerHTML = `
  <p>Tu negocio merece herramientas que trabajen a tu ritmo. Vamos a dejar tu punto de venta listo para que puedas vender, controlar tu inventario y administrar todo desde un solo lugar.</p>
  <p><strong>Son ${ASISTENTE_PASOS.length - 2} pasos rapidos, unos 5 minutos.</strong> Puedes dejarlo a medias y retomarlo cuando quieras.</p>
 `;
 asistenteAcciones({ atras: false, siguiente: "Configurar mi negocio" });
}

function asistentePintarGiro() {
 document.getElementById("asistenteTitulo").textContent = "¿Que tipo de negocio tienes?";
 document.getElementById("asistenteCuerpo").innerHTML = `
  <p>Con esto Nexo te muestra las categorias y los consejos de tu giro. Puedes elegir mas de uno.</p>
  <div class="asistente-grid">
   ${ASISTENTE_GIROS.map(giro => `
    <button type="button" class="asistente-tarjeta" data-giro="${giro.id}" aria-pressed="${asistente.giros.includes(giro.id)}" onclick="asistenteAlternarGiro('${giro.id}')">
     <span class="icono">${giro.icono}</span>
     <strong>${asistenteEsc(giro.nombre)}</strong>
     <span class="detalle">${asistenteEsc(giro.detalle)}</span>
    </button>
   `).join("")}
  </div>
 `;
 asistenteAcciones();
}

function asistenteAlternarGiro(id) {
 const activos = new Set(asistente.giros);
 if (activos.has(id)) activos.delete(id); else activos.add(id);
 asistente.giros = [...activos];

 document.querySelectorAll(".asistente-tarjeta[data-giro]").forEach(tarjeta => {
  tarjeta.setAttribute("aria-pressed", String(asistente.giros.includes(tarjeta.dataset.giro)));
 });
}

function asistentePintarCorreos() {
 const e = asistente.estado;

 document.getElementById("asistenteTitulo").textContent = "Tus correos";
 document.getElementById("asistenteCuerpo").innerHTML = `
  <p>Usamos dos: el tuyo, para entrar y recuperar tu cuenta, y el de tu negocio, para avisos y reportes.</p>
  <div class="asistente-fila-correo">
   <div>
    <strong>Tu correo de acceso</strong><br>
    <span>${asistenteEsc(e.correoAcceso || "Sin correo")}</span>
   </div>
   <span class="asistente-etiqueta ${e.correoVerificado ? "" : "advertencia"}">${e.correoVerificado ? "Verificado" : "Sin verificar"}</span>
  </div>
  <label class="asistente-campo">Correo del negocio
   <input type="email" id="asistenteCorreoNegocio" autocomplete="off" placeholder="ventas@minegocio.com" value="${asistenteEsc(asistente.datos.correoNegocio || "")}" ${asistente.usarMismoCorreo ? "disabled" : ""}>
  </label>
  <label class="asistente-casilla">
   <input type="checkbox" id="asistenteMismoCorreo" ${asistente.usarMismoCorreo ? "checked" : ""} onchange="asistenteAlternarMismoCorreo(this.checked)">
   Usar el mismo correo para los dos
  </label>
 `;
 asistenteAcciones();
}

function asistenteAlternarMismoCorreo(usarMismo) {
 asistente.usarMismoCorreo = usarMismo;
 const campo = document.getElementById("asistenteCorreoNegocio");
 if (!campo) return;
 campo.disabled = usarMismo;
 if (!usarMismo) campo.focus();
}

function asistentePintarNegocio() {
 const d = asistente.datos;

 document.getElementById("asistenteTitulo").textContent = "Cuentanos de tu negocio";
 document.getElementById("asistenteCuerpo").innerHTML = `
  <p>Esto aparece en tus tickets y en tu pantalla. Lo unico obligatorio es el nombre.</p>
  <label class="asistente-campo">Nombre del negocio
   <input type="text" id="asistenteNombre" autocomplete="off" value="${asistenteEsc(d.nombre || "")}">
  </label>
  <div class="asistente-dos-columnas">
   <label class="asistente-campo">Telefono
    <input type="tel" id="asistenteTelefono" autocomplete="off" value="${asistenteEsc(d.telefono || "")}">
   </label>
   <label class="asistente-campo">Direccion (opcional)
    <input type="text" id="asistenteDireccion" autocomplete="off" placeholder="Calle, numero, ciudad" value="${asistenteEsc(d.direccion || "")}">
   </label>
  </div>
  <label class="asistente-campo">Eslogan (opcional)
   <input type="text" id="asistenteSlogan" autocomplete="off" placeholder="Ej. ${asistenteEsc(asistenteEsloganSugerido())}" value="${asistenteEsc(d.slogan || "")}">
  </label>
  <div class="asistente-campo">Logo (opcional)
   <div class="asistente-logo">
    <div class="asistente-logo-vista" id="asistenteLogoVista">${asistente.logoNuevo ? `<img src="${asistente.logoNuevo}" alt="Logo">` : (d.tieneLogo ? "Logo" : "Sin logo")}</div>
    <input type="file" id="asistenteLogoArchivo" accept="image/*" onchange="asistenteElegirLogo(this.files[0])">
   </div>
   <span class="ayuda">No pasa nada si todavia no tienes uno: puedes ponerlo despues en Configuracion.</span>
  </div>
  <div class="asistente-campo">Color de tu marca
   <div class="asistente-colores">
    ${ASISTENTE_COLORES.map(color => `<button type="button" class="asistente-color" data-color="${color}" style="background:${color}" aria-label="Color ${color}" aria-pressed="${asistente.color.toLowerCase() === color}" onclick="asistenteElegirColor('${color}')"></button>`).join("")}
   </div>
  </div>
 `;
 asistenteAcciones();
}

function asistenteElegirColor(color) {
 asistente.color = color;
 document.querySelectorAll(".asistente-color").forEach(boton => {
  boton.setAttribute("aria-pressed", String(boton.dataset.color === color));
 });
}

// El logo se achica en el navegador antes de subirlo (el servidor rechaza
// imagenes de mas de 3 MB).
function asistenteElegirLogo(archivo) {
 if (!archivo) return;
 if (!/^image\//.test(archivo.type)) {
  asistenteError("Elige una imagen (JPG o PNG).");
  return;
 }

 const lector = new FileReader();
 lector.onerror = () => asistenteError("No se pudo leer la imagen.");
 lector.onload = () => {
  const imagen = new Image();
  imagen.onerror = () => asistenteError("Esa imagen no se pudo abrir. Prueba con otra.");
  imagen.onload = () => {
   const escala = Math.min(1, 512 / Math.max(imagen.width, imagen.height));
   const lienzo = document.createElement("canvas");
   lienzo.width = Math.round(imagen.width * escala);
   lienzo.height = Math.round(imagen.height * escala);
   lienzo.getContext("2d").drawImage(imagen, 0, 0, lienzo.width, lienzo.height);

   // PNG conserva la transparencia de un logo; el resto va como JPG.
   asistente.logoNuevo = archivo.type === "image/png"
    ? lienzo.toDataURL("image/png")
    : lienzo.toDataURL("image/jpeg", 0.88);

   asistenteError("");
   const vista = document.getElementById("asistenteLogoVista");
   if (vista) vista.innerHTML = `<img src="${asistente.logoNuevo}" alt="Logo">`;
  };
  imagen.src = lector.result;
 };
 lector.readAsDataURL(archivo);
}

function asistentePregunta(clave, titulo, opciones) {
 return `
  <div class="asistente-pregunta">
   <strong>${asistenteEsc(titulo)}</strong>
   <div class="asistente-opciones">
    ${opciones.map(op => `<button type="button" class="asistente-chip" data-clave="${clave}" data-valor="${op.valor}" aria-pressed="${asistente.respuestas[clave] === op.valor}" onclick="asistenteResponder('${clave}', '${op.valor}')">${asistenteEsc(op.etiqueta)}</button>`).join("")}
   </div>
  </div>
 `;
}

function asistentePintarVende() {
 const siNo = [{ valor: "si", etiqueta: "Si" }, { valor: "no", etiqueta: "No" }];

 document.getElementById("asistenteTitulo").textContent = "¿Como vendes?";
 document.getElementById("asistenteCuerpo").innerHTML = `
  <p>Ya te dejamos marcado lo mas comun para tu giro. Cambia lo que no aplique.</p>
  <div class="asistente-pregunta">
   <strong>¿A que precio vendes normalmente en el mostrador?</strong>
   <div class="asistente-opciones">
    ${ASISTENTE_NIVELES_PRECIO.map(n => `<button type="button" class="asistente-chip" data-nivel="${n.id}" aria-pressed="${asistente.nivelPrecio === n.id}" onclick="asistenteElegirNivel('${n.id}')">${asistenteEsc(n.etiqueta)}</button>`).join("")}
   </div>
  </div>
  ${asistentePregunta("granel", "¿Vendes por peso o a granel?", siNo)}
  ${asistentePregunta("fiado", "¿Das fiado (credito) a tus clientes?", siNo)}
  ${asistentePregunta("caducidad", "¿Controlas fechas de caducidad?", siNo)}
 `;
 asistenteAcciones();
}

function asistentePintarEquipo() {
 document.getElementById("asistenteTitulo").textContent = "¿Con que equipo cuentas?";
 document.getElementById("asistenteCuerpo").innerHTML = `
  <p>Asi Nexo se acomoda a tu mostrador: si no tienes algo, no te lo estorba. Puedes cambiarlo despues en Configuracion.</p>
  ${asistentePregunta("lector", "🏷️ ¿Tienes lector de codigo de barras?", [
   { valor: "si", etiqueta: "Si, tengo lector" },
   { valor: "no", etiqueta: "No, escribo o busco el producto" },
   { valor: "no_se", etiqueta: "Todavia no se" }
  ])}
  ${asistentePregunta("impresora", "🖨️ ¿Imprimes tickets?", [
   { valor: "si", etiqueta: "Si, tengo impresora" },
   { valor: "no", etiqueta: "No, prefiero ticket digital (QR)" },
   { valor: "no_se", etiqueta: "Todavia no se" }
  ])}
  ${asistentePregunta("cajon", "💵 ¿Tienes cajon de dinero conectado a la impresora?", [
   { valor: "si", etiqueta: "Si, tengo cajon" },
   { valor: "no", etiqueta: "No tengo" },
   { valor: "no_se", etiqueta: "Todavia no se" }
  ])}
 `;
 asistenteAcciones();
}

function asistenteResponder(clave, valor) {
 asistente.respuestas[clave] = valor;
 asistente.contestadas[clave] = true;
 document.querySelectorAll(`.asistente-chip[data-clave="${clave}"]`).forEach(chip => {
  chip.setAttribute("aria-pressed", String(chip.dataset.valor === valor));
 });
}

function asistenteElegirNivel(nivel) {
 asistente.nivelPrecio = nivel;
 document.querySelectorAll(".asistente-chip[data-nivel]").forEach(chip => {
  chip.setAttribute("aria-pressed", String(chip.dataset.nivel === nivel));
 });
}

function asistenteNombreGiros() {
 return asistente.giros
  .map(id => ASISTENTE_GIROS.find(g => g.id === id)?.nombre || id)
  .join(", ") || "Sin elegir";
}

function asistenteTextoSiNo(valor) {
 return valor === "si" ? "Si" : valor === "no" ? "No" : "Pendiente";
}

function asistentePintarListo() {
 const d = asistente.datos;
 const correoNegocio = asistente.usarMismoCorreo ? "El mismo de acceso" : (d.correoNegocio || "El mismo de acceso");
 const nivel = ASISTENTE_NIVELES_PRECIO.find(n => n.id === asistente.nivelPrecio)?.etiqueta || asistente.nivelPrecio;
 const textoEquipo = {
  lector: { si: "Lector", no: "Sin lector", no_se: "Lector por definir" },
  impresora: { si: "Impresora", no: "Ticket digital (QR)", no_se: "Impresora por definir" },
  cajon: { si: "Cajon", no: "Sin cajon", no_se: "Cajon por definir" }
 };
 const equipo = ["lector", "impresora", "cajon"].map(clave => textoEquipo[clave][asistente.respuestas[clave]] || textoEquipo[clave].no_se).join(" · ");
 const sinLector = asistente.respuestas.lector === "no";

 document.getElementById("asistenteTitulo").textContent = "¡Tu negocio esta listo para empezar!";
 document.getElementById("asistenteCuerpo").innerHTML = `
  <div class="asistente-resumen">
   <div><span>Negocio</span><span>${asistenteEsc(d.nombre || "Mi negocio")}</span></div>
   <div><span>Tipo de negocio</span><span>${asistenteEsc(asistenteNombreGiros())}</span></div>
   <div><span>Correo del negocio</span><span>${asistenteEsc(correoNegocio)}</span></div>
   <div><span>Vendes a</span><span>${asistenteEsc(nivel)}</span></div>
   <div><span>Granel / fiado / caducidades</span><span>${asistenteTextoSiNo(asistente.respuestas.granel)} / ${asistenteTextoSiNo(asistente.respuestas.fiado)} / ${asistenteTextoSiNo(asistente.respuestas.caducidad)}</span></div>
   <div><span>Equipo</span><span>${asistenteEsc(equipo)}</span></div>
   <div><span>Productos registrados</span><span>${Array.isArray(typeof todosProductos !== "undefined" ? todosProductos : null) ? todosProductos.length : 0}</span></div>
  </div>
  <p>${sinLector ? "Lo siguiente es cargar tus productos. Con la carga rapida los buscas por nombre y Nexo te llena el precio sugerido." : "Lo siguiente es cargar tus productos. Escanea el codigo de barras y Nexo reconoce muchos: te llena el nombre, la categoria y el precio sugerido."}</p>
 `;

 document.getElementById("asistenteAcciones").innerHTML = `
  <button type="button" class="asistente-boton secundario chico" onclick="asistenteAtras()">Atras</button>
  <span class="espacio"></span>
  <button type="button" class="asistente-boton secundario chico" onclick="asistenteTerminar('inicio')">Ir al inicio</button>
  <button type="button" class="asistente-boton secundario chico" onclick="asistenteTerminar('primera_venta')">Mi primera venta</button>
  <button type="button" class="asistente-boton chico" onclick="asistenteTerminar('agregar_productos')">Cargar mi inventario</button>
 `;
}

// ---------------------------------------------------------------------
// Navegacion y guardado
// ---------------------------------------------------------------------

function asistenteAtras() {
 if (asistente.guardando || asistente.paso === 0) return;
 asistente.paso -= 1;
 asistentePintar();
}

async function asistenteSiguiente() {
 if (asistente.guardando) return;

 asistenteError("");
 asistenteOcupado(true);

 try {
  await asistenteGuardarPasoActual();
  asistente.paso += 1;
  await asistenteGuardarServidorSilencioso({ paso: asistente.paso });
  asistentePintar();
 } catch (error) {
  asistenteError(error.message || "No se pudo guardar.");
 } finally {
  asistenteOcupado(false);
 }
}

// El avance del paso no debe bloquear a la persona si falla justo ahora.
async function asistenteGuardarServidorSilencioso(cuerpo) {
 try {
  await asistenteGuardarServidor(cuerpo);
 } catch (error) {
  // se reintenta con el siguiente guardado
 }
}

async function asistenteGuardarPasoActual() {
 const paso = ASISTENTE_PASOS[asistente.paso];

 if (paso === "giro") return asistenteGuardarGiros();
 if (paso === "correos") return asistenteGuardarCorreos();
 if (paso === "negocio") return asistenteGuardarNegocio();
 if (paso === "vende") return asistenteGuardarVende();
 if (paso === "equipo") return asistenteGuardarEquipo();
}

async function asistenteGuardarGiros() {
 if (asistente.giros.length === 0) throw new Error("Elige al menos un tipo de negocio.");

 const antes = new Set(asistente.estado.giros);
 const ahora = new Set(asistente.giros);

 // Primero se agregan y luego se quitan: el servidor no deja el negocio sin giro.
 for (const giro of ahora) {
  if (!antes.has(giro)) await asistenteLlamar("/negocio-actual/giro", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ giro, activo: true }) });
 }
 for (const giro of antes) {
  if (!ahora.has(giro)) await asistenteLlamar("/negocio-actual/giro", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ giro, activo: false }) });
 }

 asistente.estado.giros = [...asistente.giros];

 // Las sugerencias de "como vende" siguen al giro, salvo lo que ya se contesto a mano.
 for (const clave of ["granel", "fiado", "caducidad"]) {
  if (!asistente.contestadas?.[clave]) asistente.respuestas[clave] = asistenteSugerencia(asistente.giros, clave);
 }

 // Copia local del giro para que Configuracion lo muestre al instante.
 const actual = configuracionNegocio() || {};
 localStorage.setItem(CONFIG_NEGOCIO_KEY, JSON.stringify({ ...actual, giroNegocio: asistente.giros[0] }));
}

async function asistenteGuardarCorreos() {
 const campo = document.getElementById("asistenteCorreoNegocio");
 const correo = asistente.usarMismoCorreo ? "" : String(campo?.value || "").trim();

 if (!asistente.usarMismoCorreo && !correo) {
  throw new Error("Escribe el correo de tu negocio, o marca \"Usar el mismo correo\".");
 }

 const estado = await asistenteGuardarServidor({ datos: { correoNegocio: correo } });
 asistente.datos.correoNegocio = estado.datos.correoNegocio;
}

async function asistenteGuardarNegocio() {
 const nombre = String(document.getElementById("asistenteNombre")?.value || "").trim();

 if (nombre.length < 2) throw new Error("Escribe el nombre de tu negocio.");

 const datos = {
  nombre,
  telefono: String(document.getElementById("asistenteTelefono")?.value || "").trim(),
  direccion: String(document.getElementById("asistenteDireccion")?.value || "").trim(),
  slogan: String(document.getElementById("asistenteSlogan")?.value || "").trim()
 };

 const estado = await asistenteGuardarServidor({ datos });
 asistente.datos = { ...asistente.datos, ...estado.datos };

 // Logo y color van por /marca, que reemplaza AMBOS: si solo cambio el color,
 // hay que reenviar el logo que ya tenia o se borraria.
 const colorCambio = asistente.color && asistente.color.toLowerCase() !== String(estado.datos.color || "").toLowerCase();

 if (asistente.logoNuevo || colorCambio) {
  let logo = asistente.logoNuevo;

  if (!logo) {
   const actual = await asistenteLlamar("/negocio-actual");
   logo = actual.negocio?.logo || null;
  }

  await asistenteLlamar("/negocio-actual/marca", {
   method: "PUT",
   headers: { "Content-Type": "application/json" },
   body: JSON.stringify({ color: asistente.color, logo })
  });

  asistente.logoNuevo = null;
  asistente.datos.color = asistente.color;
  asistente.datos.tieneLogo = Boolean(logo);
 }

 await asistenteRefrescarConfiguracionLocal();
}

async function asistenteGuardarVende() {
 // Nivel de precio: ajuste del negocio (todas sus cajas), ruta de siempre.
 await asistenteLlamar("/negocio-actual/nivel-precio", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ nivel: asistente.nivelPrecio })
 });

 const respuestas = {};
 for (const clave of ["granel", "fiado", "caducidad"]) {
  if (asistente.respuestas[clave]) respuestas[clave] = asistente.respuestas[clave];
 }

 await asistenteGuardarServidor({ respuestas });

 const actual = configuracionNegocio() || {};
 localStorage.setItem(CONFIG_NEGOCIO_KEY, JSON.stringify({ ...actual, nivelPrecioPorDefecto: asistente.nivelPrecio }));
}

// El equipo es de ESTA computadora (no del negocio): lo que se contesta se
// aplica aqui. Sin impresora deja de abrirse el dialogo de impresion en cada
// venta (el QR del ticket digital sigue prendido); sin lector, el punto de
// venta pide buscar por nombre; con cajon, se abre al imprimir.
async function asistenteGuardarEquipo() {
 const respuestas = {};
 for (const clave of ["lector", "impresora", "cajon"]) {
  respuestas[clave] = asistente.respuestas[clave] || "no_se";
 }

 await asistenteGuardarServidor({ respuestas });
 Object.assign(asistente.respuestas, respuestas);

 const cambios = {};
 if (respuestas.impresora === "no") cambios.imprimirAutomatico = false;
 if (respuestas.impresora === "si") cambios.imprimirAutomatico = true;
 if (respuestas.cajon === "si") cambios.abrirCajonDespuesTicket = true;
 if (respuestas.cajon === "no") cambios.abrirCajonDespuesTicket = false;
 if (respuestas.lector === "si") cambios.usaLector = true;
 if (respuestas.lector === "no") cambios.usaLector = false;

 const actual = configuracionNegocio() || {};
 localStorage.setItem(CONFIG_NEGOCIO_KEY, JSON.stringify({ ...actual, ...cambios }));

 // Ya con el equipo elegido, el punto de venta se acomoda de inmediato.
 if (typeof actualizarCarrito === "function") { try { actualizarCarrito(); } catch (error) { /* aun no hay carrito */ } }
}

// Despues de guardar nombre/logo/color: la copia local (la que pinta la
// pantalla y los tickets) se vuelve a armar con lo que ya tiene el servidor.
async function asistenteRefrescarConfiguracionLocal() {
 try {
  const datos = await asistenteLlamar("/negocio-actual");
  if (typeof guardarConfiguracionNegocioDesdeServidor === "function") guardarConfiguracionNegocioDesdeServidor(datos.negocio);
  if (typeof aplicarConfiguracionNegocio === "function") aplicarConfiguracionNegocio(configuracionNegocio());
 } catch (error) {
  // la proxima reconexion la actualiza
 }
}

async function asistenteDejarParaDespues() {
 if (asistente.guardando) return;

 await asistenteGuardarServidorSilencioso({ paso: Math.max(asistente.paso, 1) });
 const pasoGuardado = Math.max(asistente.paso, 1);

 document.getElementById("asistenteInicio")?.remove();
 asistente = null;

 // La bienvenida de siempre queda para despues: este asistente la reemplaza.
 try { localStorage.setItem("nexoOnboardingBienvenidaVisto", "1"); } catch (error) { /* sin almacenamiento */ }

 mostrarRecordatorioAsistente(pasoGuardado);
}

async function asistenteTerminar(primerPaso) {
 if (asistente.guardando) return;

 asistenteOcupado(true);

 try {
  await asistenteGuardarServidor({ completado: true, respuestas: { primerPaso }, paso: ASISTENTE_PASOS.length - 1 });
 } catch (error) {
  asistenteError(error.message || "No se pudo terminar. Revisa tu conexion.");
  asistenteOcupado(false);
  return;
 }

 document.getElementById("asistenteInicio")?.remove();
 asistente = null;
 ocultarRecordatorioAsistente();

 if (primerPaso === "primera_venta" && typeof cerrarBienvenidaNexoOnboarding === "function") {
  // Reusa el recorrido guiado de la venta (tambien marca la bienvenida como vista).
  cerrarBienvenidaNexoOnboarding(true);
  return;
 }

 try { localStorage.setItem("nexoOnboardingBienvenidaVisto", "1"); } catch (error) { /* sin almacenamiento */ }

 if (primerPaso === "agregar_productos" && typeof mostrarCargaInventario === "function") {
  mostrarCargaInventario();
  return;
 }

 if (typeof mostrarInicio === "function") mostrarInicio();
}
