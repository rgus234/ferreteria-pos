let negociosAdmin = [];
let negocioEditandoAdmin = null;
let versionesAdmin = [];
let resumenAdmin = null;
const ADMIN_KEY_STORAGE = "nexoAdminKey";

const formatoDineroAdmin = new Intl.NumberFormat("es-MX", {
  style: "currency",
  currency: "MXN",
  maximumFractionDigits: 0
});

function fechaInputAdmin(valor) {
  if (!valor) return "";
  const fecha = new Date(valor);
  if (Number.isNaN(fecha.getTime())) return "";
  return fecha.toISOString().slice(0, 10);
}

function fechaCortaAdmin(valor) {
  if (!valor) return "-";
  const fecha = new Date(valor);
  if (Number.isNaN(fecha.getTime())) return "-";
  return fecha.toLocaleDateString("es-MX", { day: "2-digit", month: "short", year: "numeric" });
}

function fechaHoraCortaAdmin(valor) {
  if (!valor) return "-";
  const fecha = new Date(valor);
  if (Number.isNaN(fecha.getTime())) return "-";
  return fecha.toLocaleString("es-MX", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

function pillClaseAdmin(valor) {
  const texto = String(valor || "").toLowerCase();
  if (["activo", "activa", "normal"].includes(texto)) return "ok";
  if (["prueba", "gracia"].includes(texto)) return "trial";
  if (["limitado", "vencida"].includes(texto)) return "warning";
  if (["bloqueado", "suspendido", "suspendida", "cancelada", "cancelado"].includes(texto)) return "danger";
  return "lead";
}

function escaparHTMLAdmin(valor) {
  return String(valor ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function slugAdmin(valor) {
  return String(valor || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function adminKeyActual() {
  return sessionStorage.getItem(ADMIN_KEY_STORAGE) || "";
}

function setAdminSesion(activa) {
  document.body.classList.toggle("admin-authenticated", Boolean(activa));
  const estado = document.getElementById("adminSesionEstado");
  if (estado) estado.textContent = activa ? "Sesion activa" : "Sin sesion";
}

async function apiAdmin(endpoint, options = {}) {
  const adminKey = adminKeyActual();
  if (!adminKey) {
    setAdminSesion(false);
    throw new Error("Captura la clave de administrador.");
  }

  const respuesta = await fetch(endpoint, {
    ...options,
    headers: {
      "content-type": "application/json",
      "x-admin-key": adminKey,
      ...(options.headers || {})
    }
  });
  const data = await respuesta.json().catch(() => ({}));
  if (respuesta.status === 401 || respuesta.status === 503) {
    sessionStorage.removeItem(ADMIN_KEY_STORAGE);
    setAdminSesion(false);
  }
  if (!respuesta.ok || data.ok === false) {
    throw new Error(data.error || "Error de admin");
  }
  setAdminSesion(true);
  return data;
}

function mostrarVistaAdmin(vista) {
  const target = vista || "resumen";
  document.querySelectorAll(".admin-view").forEach(section => {
    section.classList.toggle("active", section.id === `view-${target}`);
  });
  document.querySelectorAll(".admin-sidebar nav button").forEach(button => {
    button.classList.toggle("active", button.dataset.view === target);
  });
}

function pintarMetricasAdmin(resumen) {
  const mrr = Number(resumen?.licencias?.mrr || 0);
  const total = Number(resumen?.negocios?.total || 0);
  const activos = Number(resumen?.negocios?.activos || 0);
  const pruebas = Number(resumen?.negocios?.prueba || 0);
  const vencidas = Number(resumen?.licencias?.vencidas || 0);
  const suspendidas = Number(resumen?.licencias?.suspendidas || 0);
  const pendientes = Number(resumen?.dispositivos?.sync_pendientes || 0);
  const errores = Number(resumen?.dispositivos?.sync_errores || 0);

  document.getElementById("metricMRR").textContent = formatoDineroAdmin.format(mrr);
  document.getElementById("metricMRRDetalle").textContent = `${activos} activos, ${pruebas} en prueba`;
  document.getElementById("metricClientes").textContent = total;
  document.getElementById("metricClientesDetalle").textContent = `${activos} activos`;
  document.getElementById("metricVencidas").textContent = vencidas + suspendidas;
  document.getElementById("metricSync").textContent = pendientes + errores;
  document.getElementById("metricSyncDetalle").textContent = `${pendientes} pendientes, ${errores} errores`;
  document.getElementById("ingresoMRR").textContent = formatoDineroAdmin.format(mrr);
  document.getElementById("ingresoVencidas").textContent = vencidas;
  document.getElementById("ingresoSuspendidas").textContent = suspendidas;
}

function pintarResumenAdmin() {
  const contenedor = document.getElementById("listaEstadoGeneral");
  if (!contenedor) return;
  const negocios = resumenAdmin?.negocios || {};
  const licencias = resumenAdmin?.licencias || {};
  const dispositivos = resumenAdmin?.dispositivos || {};
  contenedor.innerHTML = [
    ["Negocios activos", negocios.activos || 0],
    ["Negocios en prueba", negocios.prueba || 0],
    ["Licencias activas", licencias.activas || 0],
    ["Licencias vencidas", licencias.vencidas || 0],
    ["Equipos en linea", dispositivos.en_linea || 0],
    ["Sync con errores", dispositivos.sync_errores || 0]
  ].map(([label, value]) => `<div><span>${label}</span><strong>${value}</strong></div>`).join("");
}

function negociosFiltradosAdmin() {
  const texto = String(document.getElementById("filtroClientesAdmin")?.value || "").toLowerCase();
  const estado = String(document.getElementById("filtroEstadoAdmin")?.value || "").toLowerCase();
  return negociosAdmin.filter(negocio => {
    const searchable = [
      negocio.nombre,
      negocio.slug,
      negocio.giro,
      negocio.negocio_estado,
      negocio.licencia_estado,
      negocio.licencia_modo,
      negocio.licencia_plan,
      negocio.license_key
    ].join(" ").toLowerCase();
    const matchTexto = !texto || searchable.includes(texto);
    const matchEstado = !estado || searchable.includes(estado);
    return matchTexto && matchEstado;
  });
}

function pintarNegociosAdmin() {
  const board = document.getElementById("clientesBoardAdmin");
  if (!board) return;
  const lista = negociosFiltradosAdmin();

  if (!lista.length) {
    board.innerHTML = '<div class="empty">No hay clientes con ese filtro.</div>';
    return;
  }

  board.innerHTML = lista.map(negocio => {
    const modo = negocio.licencia_modo || "sin licencia";
    const licencia = negocio.licencia_estado || "sin licencia";
    const plan = negocio.licencia_plan || negocio.negocio_plan || "demo";
    const monto = formatoDineroAdmin.format(Number(negocio.monto_mensual || 0));
    const equipos = `${negocio.dispositivos_en_linea || 0}/${negocio.dispositivos || 0}`;
    const sistema = [negocio.plataforma, negocio.os_version, negocio.arch].filter(Boolean).join(" ");
    const update = negocio.update_available ? "Actualizacion pendiente" : "Al dia";
    const updateClase = negocio.update_available ? "warning" : "ok";
    return `
      <article class="client-card">
        <div class="client-main">
          <div>
            <span class="eyebrow">${escaparHTMLAdmin(negocio.giro || "cliente")}</span>
            <h3>${escaparHTMLAdmin(negocio.nombre || negocio.slug)}</h3>
            <small>${escaparHTMLAdmin(negocio.slug || "")}</small>
          </div>
          <div class="client-actions">
            <button type="button" onclick="abrirLicenciaAdmin(${Number(negocio.id)})">Editar licencia</button>
            <button type="button" class="danger" onclick="eliminarClienteAdmin(${Number(negocio.id)})">Eliminar</button>
          </div>
        </div>
        <div class="client-pills">
          <em class="pill ${pillClaseAdmin(negocio.negocio_estado)}">${escaparHTMLAdmin(negocio.negocio_estado || "-")}</em>
          <em class="pill ${pillClaseAdmin(modo)}">${escaparHTMLAdmin(modo)}</em>
          <em class="pill ${updateClase}">${update}</em>
        </div>
        <div class="client-details">
          <div><span>Plan</span><strong>${escaparHTMLAdmin(plan)}</strong><small>${monto}/mes</small></div>
          <div><span>Licencia</span><strong>${escaparHTMLAdmin(negocio.license_key || "-")}</strong><small>${escaparHTMLAdmin(licencia)}</small></div>
          <div><span>Ultima conexion</span><strong>${fechaHoraCortaAdmin(negocio.ultimo_uso)}</strong><small>${equipos} equipos</small></div>
          <div><span>Ultima sync</span><strong>${fechaHoraCortaAdmin(negocio.ultima_sync)}</strong><small>${negocio.sync_pendientes || 0} pendientes / ${negocio.sync_errores || 0} errores</small></div>
          <div><span>Version</span><strong>${escaparHTMLAdmin(negocio.app_version || "-")}</strong><small>Latest ${escaparHTMLAdmin(negocio.latest_version || "-")}</small></div>
          <div><span>Sistema</span><strong>${escaparHTMLAdmin(sistema || "-")}</strong><small>Instalado ${fechaCortaAdmin(negocio.instalado_at || negocio.created_at)}</small></div>
        </div>
      </article>
    `;
  }).join("");
}

function pintarPlanesAdmin() {
  const contenedor = document.getElementById("planesAdmin");
  if (!contenedor) return;
  const conteo = negociosAdmin.reduce((acc, negocio) => {
    const plan = negocio.licencia_plan || negocio.negocio_plan || "demo";
    acc[plan] = (acc[plan] || 0) + 1;
    return acc;
  }, {});
  contenedor.innerHTML = Object.entries(conteo).length
    ? Object.entries(conteo).map(([plan, total]) => `<div><span>${escaparHTMLAdmin(plan)}</span><strong>${total}</strong></div>`).join("")
    : '<div><span>Sin planes</span><strong>0</strong></div>';
}

function pintarVersionesAdmin() {
  const lista = document.getElementById("listaVersionesAdmin");
  if (!lista) return;

  if (!versionesAdmin.length) {
    lista.innerHTML = "<li><strong>Sin versiones publicadas</strong><span>Cuando publiques un instalador, registralo en app_versiones.</span></li>";
    return;
  }

  lista.innerHTML = versionesAdmin.map(version => {
    const estado = version.publicada ? "Publicada" : "Borrador";
    const obligatoria = version.obligatoria ? " - obligatoria" : "";
    const canal = escaparHTMLAdmin(`${version.canal || "stable"} / ${version.plataforma || "windows"}`);
    return `
      <li>
        <strong>v${escaparHTMLAdmin(version.version)} <em class="pill ${version.publicada ? "ok" : "lead"}">${estado}</em></strong>
        <span>${canal}${obligatoria}</span>
        <span>${escaparHTMLAdmin(version.notas || version.url_descarga || "Sin notas")}</span>
      </li>
    `;
  }).join("");
}

async function cargarAdminNexo() {
  const [resumen, negocios, versiones] = await Promise.all([
    apiAdmin("/admin/api/resumen"),
    apiAdmin("/admin/api/negocios"),
    apiAdmin("/admin/api/versiones")
  ]);

  resumenAdmin = resumen;
  negociosAdmin = negocios.negocios || [];
  versionesAdmin = versiones.versiones || [];
  pintarMetricasAdmin(resumen);
  pintarResumenAdmin();
  pintarNegociosAdmin();
  pintarPlanesAdmin();
  pintarVersionesAdmin();
}

function abrirNuevoClienteAdmin() {
  const form = document.getElementById("formNuevoClienteAdmin");
  form?.reset();
  const vence = document.getElementById("nuevoClienteVence");
  if (vence) {
    const fecha = new Date();
    fecha.setDate(fecha.getDate() + 30);
    vence.value = fecha.toISOString().slice(0, 10);
  }
  document.getElementById("nuevoClienteGracia").value = 15;
  document.getElementById("modalNuevoClienteAdmin").hidden = false;
  setTimeout(() => document.getElementById("nuevoClienteNombre")?.focus(), 50);
}

function cerrarNuevoClienteAdmin() {
  document.getElementById("modalNuevoClienteAdmin").hidden = true;
}

async function crearClienteAdmin(event) {
  event.preventDefault();

  const nombre = document.getElementById("nuevoClienteNombre")?.value.trim() || "";
  const slugManual = document.getElementById("nuevoClienteSlug")?.value.trim() || "";

  if (!nombre) {
    alert("Escribe el nombre del cliente.");
    return;
  }

  const respuesta = await apiAdmin("/admin/api/negocios", {
    method: "POST",
    body: JSON.stringify({
      nombre,
      slug: slugManual || slugAdmin(nombre),
      telefono: document.getElementById("nuevoClienteTelefono")?.value.trim() || "",
      correo: document.getElementById("nuevoClienteCorreo")?.value.trim() || "",
      direccion: document.getElementById("nuevoClienteDireccion")?.value.trim() || "",
      giro: document.getElementById("nuevoClienteGiro")?.value || "ferreteria",
      plan: document.getElementById("nuevoClientePlan")?.value || "ferreteria-base",
      estado: document.getElementById("nuevoClienteEstado")?.value || "activo",
      licenciaEstado: document.getElementById("nuevoClienteLicEstado")?.value || "activa",
      montoMensual: Number(document.getElementById("nuevoClienteMonto")?.value || 0),
      fechaVencimiento: document.getElementById("nuevoClienteVence")?.value || null,
      graciaDias: Number(document.getElementById("nuevoClienteGracia")?.value || 15),
      notas: document.getElementById("nuevoClienteNotas")?.value.trim() || ""
    })
  });

  cerrarNuevoClienteAdmin();
  await cargarAdminNexo();

  const clave = respuesta?.licencia?.license_key || respuesta?.licencia?.licenseKey || "";
  alert(`Cliente creado. Licencia: ${clave}\\nAcceso POS inicial: admin / 1234`);
  mostrarVistaAdmin("clientes");
}

function abrirLicenciaAdmin(id) {
  const negocio = negociosAdmin.find(item => Number(item.id) === Number(id));
  if (!negocio) return;

  negocioEditandoAdmin = negocio;
  document.getElementById("licenciaTituloAdmin").textContent = negocio.nombre || negocio.slug;
  document.getElementById("licNegocioEstado").value = negocio.negocio_estado || "activo";
  document.getElementById("licPlan").value = negocio.licencia_plan || negocio.negocio_plan || "demo";
  document.getElementById("licEstado").value = negocio.licencia_estado || "activa";
  document.getElementById("licMonto").value = Number(negocio.monto_mensual || 0);
  document.getElementById("licVence").value = fechaInputAdmin(negocio.fecha_vencimiento);
  document.getElementById("licUltimoPago").value = fechaInputAdmin(negocio.ultimo_pago_at);
  document.getElementById("licGracia").value = Number(negocio.gracia_dias || 15);
  document.getElementById("licClave").value = negocio.license_key || "";
  document.getElementById("licNotas").value = negocio.notas || "";
  document.getElementById("modalLicenciaAdmin").hidden = false;
}

function cerrarLicenciaAdmin() {
  negocioEditandoAdmin = null;
  document.getElementById("modalLicenciaAdmin").hidden = true;
}

async function guardarLicenciaAdmin(event) {
  event.preventDefault();
  if (!negocioEditandoAdmin) return;

  await apiAdmin(`/admin/api/negocios/${negocioEditandoAdmin.id}/licencia`, {
    method: "PUT",
    body: JSON.stringify({
      negocioEstado: document.getElementById("licNegocioEstado").value,
      plan: document.getElementById("licPlan").value,
      licenciaEstado: document.getElementById("licEstado").value,
      montoMensual: Number(document.getElementById("licMonto").value || 0),
      fechaVencimiento: document.getElementById("licVence").value || null,
      ultimoPagoAt: document.getElementById("licUltimoPago").value || null,
      graciaDias: Number(document.getElementById("licGracia").value || 15),
      notas: document.getElementById("licNotas").value.trim()
    })
  });

  cerrarLicenciaAdmin();
  await cargarAdminNexo();
}

async function eliminarClienteAdmin(id) {
  const negocio = negociosAdmin.find(item => Number(item.id) === Number(id));
  if (!negocio) return;

  const confirmar = prompt(
    `Esto eliminara el cliente y sus datos relacionados.\\n\\nPara confirmar escribe exactamente:\\n${negocio.slug}`
  );

  if (confirmar === null) return;

  await apiAdmin(`/admin/api/negocios/${Number(id)}`, {
    method: "DELETE",
    body: JSON.stringify({
      confirmarSlug: confirmar
    })
  });

  await cargarAdminNexo();
}

function exportarClientesAdmin() {
  const contenido = JSON.stringify(negociosAdmin, null, 2);
  const blob = new Blob([contenido], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "nexo-pos-clientes.json";
  link.click();
  URL.revokeObjectURL(url);
}

function cerrarSesionAdmin() {
  sessionStorage.removeItem(ADMIN_KEY_STORAGE);
  setAdminSesion(false);
  document.getElementById("adminKeyInput")?.focus();
}

document.getElementById("nuevoClienteNombre")?.addEventListener("input", event => {
  const slugInput = document.getElementById("nuevoClienteSlug");
  if (!slugInput || slugInput.dataset.editado === "true") return;
  slugInput.value = slugAdmin(event.target.value);
});
document.getElementById("nuevoClienteSlug")?.addEventListener("input", event => {
  event.target.dataset.editado = "true";
  event.target.value = slugAdmin(event.target.value);
});
document.getElementById("formNuevoClienteAdmin")?.addEventListener("submit", crearClienteAdmin);
document.getElementById("formLicenciaAdmin")?.addEventListener("submit", guardarLicenciaAdmin);
document.getElementById("filtroClientesAdmin")?.addEventListener("input", pintarNegociosAdmin);
document.getElementById("filtroEstadoAdmin")?.addEventListener("change", pintarNegociosAdmin);
document.querySelectorAll(".admin-sidebar nav button").forEach(button => {
  button.addEventListener("click", () => mostrarVistaAdmin(button.dataset.view));
});
document.getElementById("adminLoginForm")?.addEventListener("submit", async event => {
  event.preventDefault();
  const input = document.getElementById("adminKeyInput");
  const error = document.getElementById("adminLoginError");
  const key = input?.value.trim() || "";
  if (!key) {
    error.textContent = "Escribe la clave de administrador.";
    return;
  }
  sessionStorage.setItem(ADMIN_KEY_STORAGE, key);
  error.textContent = "";
  try {
    await cargarAdminNexo();
    setAdminSesion(true);
  } catch (err) {
    sessionStorage.removeItem(ADMIN_KEY_STORAGE);
    setAdminSesion(false);
    error.textContent = err.message || "Clave incorrecta.";
  }
});

document.addEventListener("DOMContentLoaded", () => {
  setAdminSesion(Boolean(adminKeyActual()));
  if (adminKeyActual()) {
    cargarAdminNexo().catch(error => {
      setAdminSesion(false);
      const errorBox = document.getElementById("adminLoginError");
      if (errorBox) errorBox.textContent = error.message;
    });
  }
});
