let negociosAdmin = [];
let negocioEditandoAdmin = null;
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
  return fecha.toLocaleDateString("es-MX", {
    day: "2-digit",
    month: "short",
    year: "numeric"
  });
}

function pillClaseAdmin(valor) {
  const texto = String(valor || "").toLowerCase();
  if (["activo", "activa", "normal"].includes(texto)) return "ok";
  if (["prueba", "gracia"].includes(texto)) return "trial";
  if (["suspendido", "suspendida", "vencida"].includes(texto)) return "warning";
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

function adminKeyActual() {
  let key = sessionStorage.getItem(ADMIN_KEY_STORAGE) || "";
  if (!key) {
    key = prompt("Clave de administrador Nexo POS") || "";
    if (key) sessionStorage.setItem(ADMIN_KEY_STORAGE, key);
  }
  return key;
}

async function apiAdmin(endpoint, options = {}) {
  const adminKey = adminKeyActual();
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
  }
  if (!respuesta.ok || data.ok === false) {
    throw new Error(data.error || "Error de admin");
  }
  return data;
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
  document.getElementById("metricVencidas").textContent = vencidas;
  document.getElementById("metricSync").textContent = pendientes + errores;
  document.getElementById("metricSyncDetalle").textContent = `${pendientes} pendientes, ${errores} errores`;
  document.getElementById("ingresoMRR").textContent = formatoDineroAdmin.format(mrr);
  document.getElementById("ingresoVencidas").textContent = vencidas;
  document.getElementById("ingresoSuspendidas").textContent = suspendidas;
}

function pintarNegociosAdmin() {
  const tabla = document.getElementById("tablaNegociosAdmin");
  if (!tabla) return;

  if (!negociosAdmin.length) {
    tabla.innerHTML = '<tr><td colspan="8">Todavia no hay negocios registrados.</td></tr>';
    return;
  }

  tabla.innerHTML = negociosAdmin.map(negocio => {
    const modo = negocio.licencia_modo || "sin licencia";
    const licencia = negocio.licencia_estado || "sin licencia";
    const ultimoUso = fechaCortaAdmin(negocio.ultimo_uso);
    const equipos = `${negocio.dispositivos_en_linea || 0}/${negocio.dispositivos || 0}`;
    const nombre = escaparHTMLAdmin(negocio.nombre || negocio.slug);
    const slug = escaparHTMLAdmin(negocio.slug);
    const giro = escaparHTMLAdmin(negocio.giro || "-");
    const estado = escaparHTMLAdmin(negocio.negocio_estado || "-");
    const plan = escaparHTMLAdmin(negocio.licencia_plan || negocio.negocio_plan || "demo");

    return `
      <tr>
        <td><strong>${nombre}</strong><span>${slug}</span></td>
        <td>${giro}</td>
        <td><em class="pill ${pillClaseAdmin(negocio.negocio_estado)}">${estado}</em></td>
        <td><strong>${plan}</strong><span>${formatoDineroAdmin.format(Number(negocio.monto_mensual || 0))}/mes</span></td>
        <td><em class="pill ${pillClaseAdmin(modo)}">${escaparHTMLAdmin(modo)}</em><span>${escaparHTMLAdmin(licencia)}</span></td>
        <td>${ultimoUso}</td>
        <td>${equipos}<span>${negocio.sync_pendientes || 0} pend. / ${negocio.sync_errores || 0} err.</span></td>
        <td><button type="button" onclick="abrirLicenciaAdmin(${negocio.id})">Editar</button></td>
      </tr>
    `;
  }).join("");
}

async function cargarAdminNexo() {
  const [resumen, negocios] = await Promise.all([
    apiAdmin("/admin/api/resumen"),
    apiAdmin("/admin/api/negocios")
  ]);

  negociosAdmin = negocios.negocios || [];
  pintarMetricasAdmin(resumen);
  pintarNegociosAdmin();
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

document.getElementById("formLicenciaAdmin")?.addEventListener("submit", guardarLicenciaAdmin);
document.addEventListener("DOMContentLoaded", () => {
  cargarAdminNexo().catch(error => {
    const tabla = document.getElementById("tablaNegociosAdmin");
    if (tabla) {
      tabla.innerHTML = `<tr><td colspan="8">No se pudo cargar admin: ${error.message}</td></tr>`;
    }
  });
});
