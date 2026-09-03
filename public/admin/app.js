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
  // Solo un 401 real (clave incorrecta) cierra la sesion. Un 503 aqui no
  // siempre significa "clave invalida" -- Render tambien puede devolver
  // 503 desde su propio proxy cuando el servidor esta ocupado (ej.
  // comprimiendo fotos de un ZIP grande en Banco de Nexo), y cerrar la
  // sesion por eso pedia la clave de nuevo a medio uso sin motivo real.
  if (respuesta.status === 401) {
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
  if (target === "ingresos") cargarDescuentoFundadoresAdmin();
  if (target === "fotos") abrirVistaBancoImagenesAdmin();
  if (target === "ofertas-market") cargarBannersMarketAdmin();
  if (target === "catalogos") cargarCatalogosFabricante();
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
  const fantasmas = Number(resumen?.negocios?.fantasmas || 0);
  const iaUsos = Number(resumen?.ia?.usosNivel3Mes || 0);
  const iaCostoMin = Number(resumen?.ia?.costoEstimadoMxn?.min || 0);
  const iaCostoMax = Number(resumen?.ia?.costoEstimadoMxn?.max || 0);

  document.getElementById("metricMRR").textContent = formatoDineroAdmin.format(mrr);
  document.getElementById("metricMRRDetalle").textContent = `${activos} activos, ${pruebas} en prueba`;
  document.getElementById("metricClientes").textContent = total;
  document.getElementById("metricClientesDetalle").textContent = `${activos} activos`;
  document.getElementById("metricVencidas").textContent = vencidas + suspendidas;
  document.getElementById("metricSync").textContent = pendientes + errores;
  document.getElementById("metricSyncDetalle").textContent = `${pendientes} pendientes, ${errores} errores`;
  document.getElementById("metricFantasmas").textContent = fantasmas;
  document.getElementById("metricIAUsos").textContent = `${iaUsos} preguntas`;

  // Si la IA no esta respondiendo, eso manda sobre el costo: de nada
  // sirve saber cuanto llevas gastado si tus clientes no la pueden usar.
  const saludIA = resumen?.ia?.salud || {};
  const detalleIA = document.getElementById("metricIACosto");
  const tarjetaIA = detalleIA?.closest(".metric-card");

  if (saludIA.estado && saludIA.estado !== "ok") {
    detalleIA.textContent = saludIA.detalle || "La IA no esta respondiendo.";
    detalleIA.classList.add("metric-alerta");
    if (tarjetaIA) tarjetaIA.classList.add("warning");
  } else {
    detalleIA.textContent = `Costo estimado: ${formatoDineroAdmin.format(iaCostoMin)} - ${formatoDineroAdmin.format(iaCostoMax)} MXN (aproximado)`;
    detalleIA.classList.remove("metric-alerta");
    if (tarjetaIA) tarjetaIA.classList.remove("warning");
  }
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
  const ia = resumenAdmin?.ia || {};
  contenedor.innerHTML = [
    ["Negocios activos", negocios.activos || 0],
    ["Negocios en prueba", negocios.prueba || 0],
    ["Cuentas fantasma", negocios.fantasmas || 0],
    ["Licencias activas", licencias.activas || 0],
    ["Licencias vencidas", licencias.vencidas || 0],
    ["Equipos en linea", dispositivos.en_linea || 0],
    ["Sync con errores", dispositivos.sync_errores || 0],
    ["Preguntas de Nexo IA este mes", ia.usosNivel3Mes || 0]
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
    const matchEstado = !estado || (estado === "fantasma" ? Boolean(negocio.anomalia_fantasma) : searchable.includes(estado));
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
    const esFantasma = Boolean(negocio.anomalia_fantasma);
    return `
      <article class="client-card${esFantasma ? " client-card-fantasma" : ""}">
        <div class="client-main">
          <div>
            <span class="eyebrow">${escaparHTMLAdmin(negocio.giro || "cliente")}</span>
            <h3>${escaparHTMLAdmin(negocio.nombre || negocio.slug)}</h3>
            <small>${escaparHTMLAdmin(negocio.slug || "")}${negocio.dias_desde_creacion != null ? ` -- creado hace ${negocio.dias_desde_creacion} dia(s)` : ""}</small>
          </div>
          <div class="client-actions">
            <button type="button" onclick="abrirLicenciaAdmin(${Number(negocio.id)})">Editar licencia</button>
            <button type="button" class="danger" onclick="eliminarClienteAdmin(${Number(negocio.id)})">${esFantasma ? "Revisar y eliminar" : "Eliminar"}</button>
          </div>
        </div>
        <div class="client-pills">
          <em class="pill ${pillClaseAdmin(negocio.negocio_estado)}">${escaparHTMLAdmin(negocio.negocio_estado || "-")}</em>
          <em class="pill ${pillClaseAdmin(modo)}">${escaparHTMLAdmin(modo)}</em>
          <em class="pill ${updateClase}">${update}</em>
          ${esFantasma ? '<em class="pill danger">Cuenta fantasma</em>' : ""}
          ${negocio.anomalia_posible_duplicado ? '<em class="pill warning">Posible duplicado</em>' : ""}
          ${negocio.tuvo_auto_provision ? '<em class="pill warning">Creado por conexion no reconocida</em>' : ""}
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
  const filtroEstado = document.getElementById("filtroPlanesEstadoAdmin")?.value || "";
  const lista = filtroEstado
    ? negociosAdmin.filter(negocio => negocio.licencia_estado === filtroEstado)
    : negociosAdmin;
  const conteo = lista.reduce((acc, negocio) => {
    const plan = negocio.licencia_plan || negocio.negocio_plan || "demo";
    acc[plan] = (acc[plan] || 0) + 1;
    return acc;
  }, {});
  contenedor.innerHTML = Object.entries(conteo).length
    ? Object.entries(conteo).map(([plan, total]) => `<div><span>${escaparHTMLAdmin(plan)}</span><strong>${total}</strong></div>`).join("")
    : '<div><span>Sin planes</span><strong>0</strong></div>';
}

async function cargarDescuentoFundadoresAdmin() {
  const contenedor = document.getElementById("descuentoFundadorAdmin");
  if (!contenedor) return;

  try {
    const data = await apiAdmin("/admin/api/descuento-fundadores");
    pintarDescuentoFundadoresAdmin(data);
  } catch (error) {
    contenedor.innerHTML = `<p class="hint">${escaparHTMLAdmin(error.message || "No se pudo cargar el descuento de fundadores.")}</p>`;
  }
}

function pintarDescuentoFundadoresAdmin(data) {
  const contenedor = document.getElementById("descuentoFundadorAdmin");
  if (!contenedor) return;

  if (!data.existe) {
    contenedor.innerHTML = `
      <p class="hint">Los primeros clientes que contraten un plan se quedan con 40% de descuento de por vida. Crea el cupon una sola vez -- el cupo no se puede cambiar despues (usa el dashboard de Stripe para eso).</p>
      <label>Cupo de clientes fundadores
        <input type="number" id="descuentoFundadorCupo" min="1" max="1000" step="1" value="50">
      </label>
      <button type="button" onclick="crearDescuentoFundadoresAdmin()">Crear cupon 40% de por vida</button>
    `;
    return;
  }

  const restantes = data.restantes ?? "-";
  contenedor.innerHTML = `
    <div class="money-list">
      <div><span>Codigo</span><strong>${escaparHTMLAdmin(data.codigo)}</strong></div>
      <div><span>Descuento</span><strong>${escaparHTMLAdmin(data.porcentaje)}% de por vida</strong></div>
      <div><span>Usados / cupo</span><strong>${escaparHTMLAdmin(data.usados)} / ${escaparHTMLAdmin(data.cupo)}</strong></div>
      <div><span>Restantes</span><strong>${escaparHTMLAdmin(restantes)}</strong></div>
    </div>
    <p class="hint">Se aplica solo al primer pago de cada negocio -- ${data.activo ? "activo, sin que el cliente escriba nada en el checkout." : "cupon desactivado desde Stripe."}</p>
  `;
}

async function crearDescuentoFundadoresAdmin() {
  const cupo = Number(document.getElementById("descuentoFundadorCupo")?.value || 0);

  if (!Number.isInteger(cupo) || cupo < 1) {
    await alertaAdmin("Escribe un cupo valido (numero entero, minimo 1).", "Falta el cupo", "alerta");
    return;
  }

  try {
    const data = await apiAdmin("/admin/api/descuento-fundadores", {
      method: "POST",
      body: JSON.stringify({ cupo })
    });
    pintarDescuentoFundadoresAdmin(data);
    await alertaAdmin(`Cupon ${data.codigo} creado con cupo para ${data.cupo} clientes.`, "Descuento de fundadores", "exito");
  } catch (error) {
    await alertaAdmin(error.message || "No se pudo crear el cupon.", "Error", "peligro");
  }
}

// ==========================================================================
// Banco de imagenes global -- rediseno premium: tiles de proveedor,
// metricas, importacion masiva con cola en el navegador, grilla con
// panel de detalle, solicitudes de fotografia.
// ==========================================================================

let bancoImagenesPaginaActual = 1;
let bancoImagenesBuscarActual = "";
let bancoImagenesBuscarTimeout = null;
let bancoImagenesMarcaFiltro = "";
let bancoImagenesOrdenActual = "recientes";
let bancoImagenesCodigoSeleccionado = null;
let bancoImagenesTabDetalleActual = "info";
let bancoImagenesObserverThumbs = null;

const BANCO_IMAGENES_COLORES = {
  diprofer: "#2563eb", gafi: "#ea580c", truper: "#dc2626", volteck: "#7c3aed",
  urrea: "#0f766e", pretul: "#b45309", foy: "#be185d"
};
const BANCO_IMAGENES_PALETA_RESPALDO = ["#0d6efd", "#7c3aed", "#0f766e", "#b45309", "#be185d", "#0891b2", "#4338ca", "#15803d"];

function colorParaMarcaBanco(marca) {
  const clave = String(marca || "").trim().toLowerCase();
  if (!clave) return "#667085";
  if (BANCO_IMAGENES_COLORES[clave]) return BANCO_IMAGENES_COLORES[clave];
  let hash = 0;
  for (let i = 0; i < clave.length; i++) hash = (hash * 31 + clave.charCodeAt(i)) >>> 0;
  return BANCO_IMAGENES_PALETA_RESPALDO[hash % BANCO_IMAGENES_PALETA_RESPALDO.length];
}

function formatoBytesAdmin(bytes) {
  const n = Number(bytes) || 0;
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(2)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

// ---- Tiles de proveedor + franja de metricas ----

async function cargarResumenBancoImagenes() {
  try {
    const data = await apiAdmin("/admin/api/banco-imagenes/resumen");
    pintarTilesBancoImagenes(data);
    pintarMetricasBancoImagenes(data);
    pintarFiltroMarcaBancoImagenes(data.marcas || []);
  } catch (error) {
    const tiles = document.getElementById("tilesBancoImagenes");
    if (tiles) tiles.innerHTML = `<div class="empty">${escaparHTMLAdmin(error.message || "No se pudo cargar el resumen.")}</div>`;
  }
}

function pintarTilesBancoImagenes(data) {
  const contenedor = document.getElementById("tilesBancoImagenes");
  if (!contenedor) return;

  const marcas = data.marcas || [];

  if (!marcas.length) {
    contenedor.innerHTML = `<div class="empty">Sin proveedores todavia -- importa un .zip para empezar.</div>`;
    return;
  }

  const tileTodos = `
    <div class="banco-imagenes-tile${bancoImagenesMarcaFiltro === "" ? " activo" : ""}" style="--tile-color:#0d6efd" onclick="seleccionarTileBancoImagenes('')">
      <div class="banco-imagenes-tile-icono">∗</div>
      <div>
        <strong>Ver todos los proveedores</strong>
        <span>${data.totalCodigos} imagenes</span>
      </div>
    </div>
  `;

  const tilesMarca = marcas.map(m => {
    const color = colorParaMarcaBanco(m.marca);
    const activo = bancoImagenesMarcaFiltro === m.marca ? " activo" : "";
    const inicial = m.marca === "Sin marca" ? "?" : m.marca.trim().charAt(0).toUpperCase();
    return `
      <div class="banco-imagenes-tile${activo}" style="--tile-color:${color}" onclick="seleccionarTileBancoImagenes('${escaparHTMLAdmin(m.marca).replace(/'/g, "\\'")}')">
        <div class="banco-imagenes-tile-icono">${escaparHTMLAdmin(inicial)}</div>
        <div>
          <strong>${escaparHTMLAdmin(m.marca)}</strong>
          <span>${m.totalCodigos} imagenes</span>
        </div>
      </div>
    `;
  }).join("");

  contenedor.innerHTML = tileTodos + tilesMarca;
}

function seleccionarTileBancoImagenes(marca) {
  bancoImagenesMarcaFiltro = marca;
  const select = document.getElementById("filtroMarcaBancoImagenes");
  if (select) select.value = marca;
  cargarResumenBancoImagenes();
  cargarBancoImagenesAdmin(1);
}

function pintarFiltroMarcaBancoImagenes(marcas) {
  const select = document.getElementById("filtroMarcaBancoImagenes");
  if (!select) return;
  const actual = select.value;
  select.innerHTML = `<option value="">Todas las marcas</option>` + marcas.map(m =>
    `<option value="${escaparHTMLAdmin(m.marca)}">${escaparHTMLAdmin(m.marca)} (${m.totalCodigos})</option>`
  ).join("");
  select.value = actual || "";
}

function pintarMetricasBancoImagenes(data) {
  const contenedor = document.getElementById("metricasBancoImagenes");
  if (!contenedor) return;

  contenedor.innerHTML = `
    <article class="metric-card strong">
      <span>Imagenes totales</span>
      <strong>${data.totalCodigos}</strong>
      <small>Codigos con foto principal</small>
    </article>
    <article class="metric-card">
      <span>Fotos totales</span>
      <strong>${data.totalFotos}</strong>
      <small>Incluye galeria</small>
    </article>
    <article class="metric-card sync">
      <span>Marcas</span>
      <strong>${data.totalMarcas}</strong>
      <small>Proveedores distintos</small>
    </article>
    <article class="metric-card">
      <span>Almacenamiento</span>
      <strong>${formatoBytesAdmin(data.tamanoTotalBytes)}</strong>
      <small>Bytes reales en base de datos</small>
    </article>
    <article class="metric-card warning">
      <span>Ultima actualizacion</span>
      <strong style="font-size:16px;">${data.actualizadoRecienteAt ? fechaHoraCortaAdmin(data.actualizadoRecienteAt) : "-"}</strong>
      <small>Import mas reciente</small>
    </article>
  `;
}

// ---- Grilla + buscador + orden ----

async function cargarBancoImagenesAdmin(pagina = 1) {
  const contenedor = document.getElementById("grillaBancoImagenes");
  if (!contenedor) return;

  bancoImagenesPaginaActual = pagina;
  bancoImagenesOrdenActual = document.getElementById("ordenBancoImagenes")?.value || "recientes";
  const marcaSelect = document.getElementById("filtroMarcaBancoImagenes")?.value || "";
  if (marcaSelect !== bancoImagenesMarcaFiltro) bancoImagenesMarcaFiltro = marcaSelect;

  try {
    const params = new URLSearchParams({ pagina: String(pagina), orden: bancoImagenesOrdenActual });
    if (bancoImagenesBuscarActual) params.set("buscar", bancoImagenesBuscarActual);
    if (bancoImagenesMarcaFiltro) params.set("marca", bancoImagenesMarcaFiltro);
    const data = await apiAdmin(`/admin/api/banco-imagenes?${params.toString()}`);
    pintarGrillaBancoImagenesAdmin(data);
  } catch (error) {
    contenedor.innerHTML = `<div class="empty">${escaparHTMLAdmin(error.message || "No se pudo cargar el banco de imagenes.")}</div>`;
  }
}

function buscarBancoImagenesAdmin(texto) {
  clearTimeout(bancoImagenesBuscarTimeout);
  bancoImagenesBuscarTimeout = setTimeout(() => {
    bancoImagenesBuscarActual = String(texto || "").trim();
    cargarBancoImagenesAdmin(1);
  }, 250);
}

function pintarGrillaBancoImagenesAdmin(data) {
  const contenedor = document.getElementById("grillaBancoImagenes");
  const paginacion = document.getElementById("paginacionBancoImagenes");
  if (!contenedor) return;

  if (bancoImagenesObserverThumbs) {
    bancoImagenesObserverThumbs.disconnect();
    bancoImagenesObserverThumbs = null;
  }

  if (!data.items.length) {
    contenedor.innerHTML = `<div class="empty">Sin imagenes todavia -- sube un .zip arriba para empezar.</div>`;
    if (paginacion) paginacion.innerHTML = "";
    return;
  }

  contenedor.innerHTML = data.items.map(item => `
    <article class="banco-imagenes-item${bancoImagenesCodigoSeleccionado === item.codigo ? " seleccionado" : ""}" data-codigo="${escaparHTMLAdmin(item.codigo)}" onclick="abrirDetalleBancoImagenAdmin('${escaparHTMLAdmin(item.codigo).replace(/'/g, "\\'")}')">
      <div class="banco-imagenes-thumb" id="thumb-${escaparHTMLAdmin(item.codigo)}" data-codigo="${escaparHTMLAdmin(item.codigo)}">
        <span class="empty">···</span>
        <span class="banco-imagenes-punto" title="Disponible"></span>
        <span class="banco-imagenes-badge-fotos">${1 + item.totalGaleria} foto${item.totalGaleria === 0 ? "" : "s"}</span>
      </div>
      <div class="banco-imagenes-info">
        <strong>${escaparHTMLAdmin(item.codigo)}</strong>
        <span>${escaparHTMLAdmin(item.marca || "Sin marca")}${item.ancho && item.alto ? ` · ${item.ancho}×${item.alto}` : ""}</span>
        <small>${formatoBytesAdmin(item.tamanoBytes)} · ${fechaCortaAdmin(item.actualizadoAt)}</small>
      </div>
    </article>
  `).join("");

  // Miniaturas perezosas -- solo se piden cuando la tarjeta entra en
  // pantalla, en vez de disparar todas las peticiones de una vez.
  bancoImagenesObserverThumbs = new IntersectionObserver(entradas => {
    entradas.forEach(entrada => {
      if (!entrada.isIntersecting) return;
      const codigo = entrada.target.dataset.codigo;
      bancoImagenesObserverThumbs.unobserve(entrada.target);
      cargarThumbnailBancoImagenAdmin(codigo);
    });
  }, { rootMargin: "200px" });

  contenedor.querySelectorAll(".banco-imagenes-thumb").forEach(el => bancoImagenesObserverThumbs.observe(el));

  const totalPaginas = Math.max(1, Math.ceil(data.total / data.porPagina));
  if (paginacion) {
    paginacion.innerHTML = totalPaginas > 1
      ? `
        <button type="button" class="ghost" ${data.pagina <= 1 ? "disabled" : ""} onclick="cargarBancoImagenesAdmin(${data.pagina - 1})">Anterior</button>
        <span>Pagina ${data.pagina} de ${totalPaginas}</span>
        <button type="button" class="ghost" ${data.pagina >= totalPaginas ? "disabled" : ""} onclick="cargarBancoImagenesAdmin(${data.pagina + 1})">Siguiente</button>
      `
      : "";
  }
}

// <img src> no puede llevar el header x-admin-key -- se pide la imagen
// como blob autenticado y se convierte a un object URL, mismo recurso ya
// usado para exportar clientes a JSON (exportarClientesAdmin), aplicado
// aqui a bytes de imagen en vez de JSON.
async function cargarThumbnailBancoImagenAdmin(codigo) {
  const contenedor = document.getElementById(`thumb-${codigo}`);
  if (!contenedor) return;

  try {
    const respuesta = await fetch(`/admin/api/banco-imagenes/${encodeURIComponent(codigo)}/principal`, {
      headers: { "x-admin-key": adminKeyActual() }
    });
    if (!respuesta.ok) throw new Error("No se pudo cargar la miniatura");
    const blob = await respuesta.blob();
    const url = URL.createObjectURL(blob);
    const img = document.createElement("img");
    img.src = url;
    img.alt = codigo;
    contenedor.querySelector("span.empty")?.replaceWith(img);
  } catch (error) {
    const marcador = contenedor.querySelector("span.empty");
    if (marcador) marcador.textContent = "Sin imagen";
  }
}

async function eliminarBancoImagenAdmin(codigo) {
  const confirmar = await confirmarAdmin(`¿Eliminar la imagen del codigo ${codigo} del banco de Nexo? Esto no afecta las fichas de producto donde ya se haya usado.`, "Eliminar del banco", "alerta");
  if (!confirmar) return;

  try {
    await apiAdmin(`/admin/api/banco-imagenes/${encodeURIComponent(codigo)}`, { method: "DELETE" });
    if (bancoImagenesCodigoSeleccionado === codigo) {
      bancoImagenesCodigoSeleccionado = null;
      const panel = document.getElementById("panelDetalleBancoImagenes");
      if (panel) panel.innerHTML = `<div class="banco-imagenes-detalle-vacio">Selecciona una imagen para ver su detalle</div>`;
    }
    await Promise.all([cargarBancoImagenesAdmin(bancoImagenesPaginaActual), cargarResumenBancoImagenes()]);
  } catch (error) {
    await alertaAdmin(error.message || "No se pudo eliminar la imagen.", "Error", "peligro");
  }
}

async function descargarImagenBancoAdmin(codigo) {
  try {
    const respuesta = await fetch(`/admin/api/banco-imagenes/${encodeURIComponent(codigo)}/principal`, {
      headers: { "x-admin-key": adminKeyActual() }
    });
    if (!respuesta.ok) throw new Error("No se pudo descargar la imagen");
    const blob = await respuesta.blob();
    const url = URL.createObjectURL(blob);
    const enlace = document.createElement("a");
    enlace.href = url;
    enlace.download = `${codigo}.jpg`;
    document.body.appendChild(enlace);
    enlace.click();
    enlace.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  } catch (error) {
    await alertaAdmin(error.message || "No se pudo descargar la imagen.", "Error", "peligro");
  }
}

function reemplazarImagenBancoAdmin(codigo) {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = ".zip";
  input.onchange = async () => {
    const archivo = input.files?.[0];
    if (!archivo) return;
    try {
      // false a proposito -- "Reemplazar" es una accion explicita sobre
      // UN codigo ya conocido, quiere sobreescribirlo si o si, no
      // saltarlo por ya tener foto.
      await subirZipBancoImagenesAdmin(archivo, "", () => {}, false);
      await Promise.all([cargarBancoImagenesAdmin(bancoImagenesPaginaActual), cargarResumenBancoImagenes()]);
      await abrirDetalleBancoImagenAdmin(codigo);
      await alertaAdmin("Imagen reemplazada -- se importo el ZIP y se actualizo el codigo si venia incluido.", "Listo", "exito");
    } catch (error) {
      await alertaAdmin(error.message || "No se pudo reemplazar la imagen.", "Error", "peligro");
    }
  };
  input.click();
}

// ---- Panel de detalle (pestanas Informacion / Usos / Historial) ----

async function abrirDetalleBancoImagenAdmin(codigo) {
  bancoImagenesCodigoSeleccionado = codigo;
  bancoImagenesTabDetalleActual = "info";

  document.querySelectorAll(".banco-imagenes-item").forEach(el => {
    el.classList.toggle("seleccionado", el.dataset.codigo === codigo);
  });

  const panel = document.getElementById("panelDetalleBancoImagenes");
  if (!panel) return;
  panel.innerHTML = `<div class="banco-imagenes-detalle-vacio">Cargando...</div>`;

  try {
    const data = await apiAdmin(`/admin/api/banco-imagenes/${encodeURIComponent(codigo)}/detalle`);
    await pintarPanelDetalleBancoImagenes(data);
  } catch (error) {
    panel.innerHTML = `<div class="banco-imagenes-detalle-vacio">${escaparHTMLAdmin(error.message || "No se pudo cargar el detalle.")}</div>`;
  }
}

async function pintarPanelDetalleBancoImagenes(data) {
  const panel = document.getElementById("panelDetalleBancoImagenes");
  if (!panel) return;

  const codigo = data.codigo;

  panel.innerHTML = `
    <div class="banco-imagenes-detalle-preview" id="detallePreviewBanco"><span class="empty">Cargando...</span></div>
    <div class="banco-imagenes-detalle-tiras" id="detalleTirasBanco"></div>
    <div class="banco-imagenes-detalle-codigo">${escaparHTMLAdmin(codigo)}</div>
    <div class="banco-imagenes-detalle-tabs">
      <button type="button" class="activo" data-tab="info" onclick="cambiarTabDetalleBancoImagenes('info')">Informacion</button>
      <button type="button" data-tab="usos" onclick="cambiarTabDetalleBancoImagenes('usos')">Usos (${data.usos})</button>
      <button type="button" data-tab="historial" onclick="cambiarTabDetalleBancoImagenes('historial')">Historial</button>
    </div>
    <div class="banco-imagenes-detalle-tabpanel activo" data-tab-panel="info">
      <div class="banco-imagenes-detalle-campo"><span>Marca</span><span>${escaparHTMLAdmin(data.marca || "Sin marca")}</span></div>
      <div class="banco-imagenes-detalle-campo"><span>Resolucion</span><span>${data.principal.ancho && data.principal.alto ? `${data.principal.ancho}×${data.principal.alto} px` : "-"}</span></div>
      <div class="banco-imagenes-detalle-campo"><span>Tamano</span><span>${formatoBytesAdmin(data.principal.tamanoBytes)}</span></div>
      <div class="banco-imagenes-detalle-campo"><span>Fotos de galeria</span><span>${data.galeria.length}</span></div>
      <div class="banco-imagenes-detalle-campo"><span>Fuente (ZIP)</span><span>${escaparHTMLAdmin(data.origen || "-")}</span></div>
      <div class="banco-imagenes-detalle-campo"><span>Creado</span><span>${fechaHoraCortaAdmin(data.creadoAt)}</span></div>
      <div class="banco-imagenes-detalle-campo"><span>Actualizado</span><span>${fechaHoraCortaAdmin(data.actualizadoAt)}</span></div>
    </div>
    <div class="banco-imagenes-detalle-tabpanel" data-tab-panel="usos">
      <div class="banco-imagenes-detalle-campo"><span>Total de usos</span><span>${data.usos}</span></div>
      <p class="hint" style="font-size:12px;color:var(--muted);">Cuantas veces un negocio Pro copio esta foto (o una de su galeria) a su propia ficha de producto.</p>
    </div>
    <div class="banco-imagenes-detalle-tabpanel" data-tab-panel="historial">
      ${data.historial.length ? data.historial.map(fila => `
        <div class="banco-imagenes-detalle-historial-fila">
          <strong>${escaparHTMLAdmin(fila.negocioNombre)}</strong>
          <span>${fechaHoraCortaAdmin(fila.fecha)}${fila.fotoGaleria ? " · foto de galeria" : " · foto principal"}</span>
        </div>
      `).join("") : `<p class="hint" style="font-size:12px;color:var(--muted);">Sin usos todavia.</p>`}
    </div>
    <div class="banco-imagenes-detalle-acciones">
      <button type="button" class="secondary" onclick="descargarImagenBancoAdmin('${escaparHTMLAdmin(codigo).replace(/'/g, "\\'")}')">Descargar</button>
      <button type="button" class="secondary" onclick="reemplazarImagenBancoAdmin('${escaparHTMLAdmin(codigo).replace(/'/g, "\\'")}')">Reemplazar</button>
      <button type="button" class="danger" onclick="eliminarBancoImagenAdmin('${escaparHTMLAdmin(codigo).replace(/'/g, "\\'")}')">Eliminar</button>
    </div>
  `;

  // Vista previa grande + tira de miniaturas -- mismo patron de blob
  // autenticado que las miniaturas de la grilla.
  const todasLasFotos = [{ esPrincipal: true, url: `/admin/api/banco-imagenes/${encodeURIComponent(codigo)}/principal` }]
    .concat(data.galeria.map(g => ({ esPrincipal: false, id: g.id, url: `/admin/api/banco-imagenes/${encodeURIComponent(codigo)}/galeria/${g.id}` })));

  const previewEl = document.getElementById("detallePreviewBanco");
  const tirasEl = document.getElementById("detalleTirasBanco");

  const urlsBlob = await Promise.all(todasLasFotos.map(async foto => {
    try {
      const respuesta = await fetch(foto.url, { headers: { "x-admin-key": adminKeyActual() } });
      if (!respuesta.ok) return null;
      const blob = await respuesta.blob();
      return URL.createObjectURL(blob);
    } catch {
      return null;
    }
  }));

  if (previewEl) {
    previewEl.innerHTML = urlsBlob[0] ? `<img src="${urlsBlob[0]}" alt="${escaparHTMLAdmin(codigo)}">` : `<span class="empty">Sin imagen</span>`;
  }

  if (tirasEl && todasLasFotos.length > 1) {
    tirasEl.innerHTML = todasLasFotos.map((foto, i) =>
      `<button type="button" class="${i === 0 ? "activo" : ""}" data-indice="${i}" onclick="cambiarPreviewDetalleBancoImagenes(${i}, this)">${urlsBlob[i] ? `<img src="${urlsBlob[i]}">` : ""}</button>`
    ).join("");
    tirasEl.dataset.urls = JSON.stringify(urlsBlob);
  }
}

function cambiarPreviewDetalleBancoImagenes(indice, boton) {
  const tirasEl = document.getElementById("detalleTirasBanco");
  const previewEl = document.getElementById("detallePreviewBanco");
  if (!tirasEl || !previewEl) return;
  const urls = JSON.parse(tirasEl.dataset.urls || "[]");
  if (!urls[indice]) return;
  previewEl.innerHTML = `<img src="${urls[indice]}" alt="">`;
  tirasEl.querySelectorAll("button").forEach(b => b.classList.toggle("activo", b === boton));
}

function cambiarTabDetalleBancoImagenes(tab) {
  bancoImagenesTabDetalleActual = tab;
  const panel = document.getElementById("panelDetalleBancoImagenes");
  if (!panel) return;
  panel.querySelectorAll("[data-tab]").forEach(b => b.classList.toggle("activo", b.dataset.tab === tab));
  panel.querySelectorAll("[data-tab-panel]").forEach(p => p.classList.toggle("activo", p.dataset.tabPanel === tab));
}

// ---- Subida individual (compartida por la cola y por "Reemplazar") ----
// apiAdmin() fuerza content-type: application/json y no soporta
// FormData -- aqui hace falta XMLHttpRequest crudo (para poder mostrar
// avance real) con el header x-admin-key puesto a mano, mismo patron ya
// usado en supplier-catalog-view.js para el importador por-negocio.
function subirZipBancoImagenesAdmin(archivo, marca, alAvanzar, omitirExistentes = true) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();

    xhr.upload.addEventListener("progress", event => {
      if (event.lengthComputable) alAvanzar(event.loaded / event.total);
    });

    xhr.addEventListener("load", () => {
      try {
        const datos = JSON.parse(xhr.responseText);
        if (!datos.ok) {
          reject(new Error(datos.error || "No se pudo importar este archivo"));
          return;
        }
        // El servidor ya no comprime las fotos dentro de esta peticion
        // (zips grandes tardaban mas que el timeout del proxy de
        // produccion) -- solo confirma que el archivo se guardo y
        // encolo. Hay que consultar el trabajo aparte hasta que quede
        // listo o en error.
        esperarTrabajoImportacionBanco(datos.trabajoIds[0]).then(resolve, reject);
      } catch (error) {
        reject(new Error(`Respuesta invalida del servidor (status ${xhr.status}).`));
      }
    });

    xhr.addEventListener("error", () => reject(new Error("Error de conexion al subir el archivo.")));

    const formData = new FormData();
    formData.append("zips", archivo);
    if (marca) formData.append("marca", marca);
    formData.append("omitirExistentes", omitirExistentes ? "1" : "0");

    xhr.open("POST", "/admin/api/banco-imagenes/importar-lote");
    xhr.setRequestHeader("x-admin-key", adminKeyActual());
    xhr.send(formData);
  });
}

const INTERVALO_REVISION_TRABAJO_BANCO_MS = 3000;

function esperarTrabajoImportacionBanco(trabajoId) {
  return new Promise((resolve, reject) => {
    const revisar = async () => {
      try {
        const respuesta = await fetch(`/admin/api/banco-imagenes/importar-lote/trabajos?ids=${trabajoId}`, {
          headers: { "x-admin-key": adminKeyActual() }
        });
        const datos = await respuesta.json();
        const trabajo = datos?.trabajos?.[0];

        if (!datos.ok || !trabajo) {
          reject(new Error("No se pudo consultar el estado de la importacion"));
          return;
        }

        if (trabajo.estado === "listo") {
          resolve({
            zipsProcesados: 1,
            fotosGuardadas: trabajo.fotos_guardadas || 0,
            fotosOmitidas: trabajo.fotos_omitidas || 0,
            solicitudesResueltas: trabajo.solicitudes_resueltas || 0,
            codigosNuevos: trabajo.codigos_nuevos || [],
            codigosOmitidos: trabajo.codigos_omitidos || [],
            errores: trabajo.errores || []
          });
          return;
        }

        if (trabajo.estado === "error") {
          reject(new Error(trabajo.mensaje_error || "No se pudo importar este archivo"));
          return;
        }

        setTimeout(revisar, INTERVALO_REVISION_TRABAJO_BANCO_MS);
      } catch (error) {
        reject(error);
      }
    };

    revisar();
  });
}

// ---- Importacion masiva: cola secuencial en el navegador ----
// Render (plan starter) no tiene disco persistente ni un servicio worker
// separado, asi que en vez de una cola real del lado del servidor, el
// navegador sostiene los archivos seleccionados/arrastrados y los manda
// uno por uno via el mismo endpoint de siempre -- decision confirmada con
// el usuario. Cerrar la pestana a la mitad simplemente detiene ahi.

let bancoImagenesArchivosCola = [];
let colaImportacionBanco = null;
let bancoImagenesUltimoOmitidos = 0;

// Corre como maximo N hasheos de archivo a la vez -- un lote de 30 zips
// de hasta 300MB cada uno no debe intentar leerlos todos en memoria al
// mismo tiempo (el navegador podria quedarse sin RAM), pero tampoco vale
// la pena hacerlo uno por uno cuando la idea es que la verificacion sea
// rapida.
async function mapConLimiteBancoImagenes(items, limite, fn) {
  const resultados = new Array(items.length);
  let indice = 0;
  async function trabajador() {
    while (indice < items.length) {
      const miIndice = indice++;
      resultados[miIndice] = await fn(items[miIndice], miIndice);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limite, items.length) }, trabajador));
  return resultados;
}

async function calcularHashArchivoBancoImagenes(archivo) {
  const buffer = await archivo.arrayBuffer();
  const hashBuffer = await crypto.subtle.digest("SHA-256", buffer);
  return [...new Uint8Array(hashBuffer)].map(b => b.toString(16).padStart(2, "0")).join("");
}

async function agregarArchivosColaBancoImagenes(fileList) {
  const nuevos = [...(fileList || [])].filter(archivo => /\.zip$/i.test(archivo.name));
  const yaEstan = new Set(bancoImagenesArchivosCola.map(a => `${a.name}:${a.size}`));
  let omitidos = 0;
  const candidatos = [];

  nuevos.forEach(archivo => {
    const clave = `${archivo.name}:${archivo.size}`;
    if (yaEstan.has(clave)) return;
    candidatos.push(archivo);
    yaEstan.add(clave);
  });

  if (candidatos.length === 0) {
    bancoImagenesUltimoOmitidos = omitidos;
    pintarListaArchivosBancoImagenes();
    return;
  }

  const contenedor = document.getElementById("listaArchivosBancoImagenes");
  if (contenedor) {
    contenedor.innerHTML = `<div class="empty">Verificando cuales de estos ${candidatos.length} archivo(s) ya se subieron antes...</div>`;
  }

  // Verificacion real contra el servidor por hash (no solo nombre+tamano
  // en localStorage): detecta un ZIP ya importado aunque sea desde otro
  // navegador o equipo, o si se limpio el localStorage de este.
  const hashesPorArchivo = new Map();
  await mapConLimiteBancoImagenes(candidatos, 3, async archivo => {
    try {
      hashesPorArchivo.set(archivo, await calcularHashArchivoBancoImagenes(archivo));
    } catch (error) {
      // Si no se puede hashear (navegador viejo, etc.) simplemente no
      // se verifica ese archivo -- no bloquea que se agregue a la cola.
    }
  });

  let yaSubidosServidor = new Set();
  const hashesUnicos = [...new Set(hashesPorArchivo.values())];
  if (hashesUnicos.length > 0) {
    try {
      const datos = await apiAdmin("/admin/api/banco-imagenes/importar-lote/verificar-hashes", {
        method: "POST",
        body: JSON.stringify({ hashes: hashesUnicos })
      });
      yaSubidosServidor = new Set(
        (datos.encontrados || [])
          .filter(f => f.estado === "listo" || f.estado === "procesando" || f.estado === "pendiente")
          .map(f => f.hash)
      );
    } catch (error) {
      // Ayuda extra, no requisito -- si falla la verificacion se sigue
      // igual y el archivo se agrega a la cola sin marcar.
    }
  }

  candidatos.forEach(archivo => {
    const hash = hashesPorArchivo.get(archivo);
    if (hash && yaSubidosServidor.has(hash)) {
      omitidos += 1;
      return;
    }
    bancoImagenesArchivosCola.push(archivo);
  });

  bancoImagenesUltimoOmitidos = omitidos;
  pintarListaArchivosBancoImagenes();
}

function quitarArchivoColaBancoImagenes(indice) {
  bancoImagenesArchivosCola.splice(indice, 1);
  pintarListaArchivosBancoImagenes();
}

function limpiarColaArchivosBancoImagenes() {
  bancoImagenesArchivosCola = [];
  bancoImagenesUltimoOmitidos = 0;
  pintarListaArchivosBancoImagenes();
}

function pintarListaArchivosBancoImagenes() {
  const contenedor = document.getElementById("listaArchivosBancoImagenes");
  if (!contenedor) return;

  const avisoOmitidos = bancoImagenesUltimoOmitidos > 0
    ? `<div class="banco-imagenes-lista-omitidos">${bancoImagenesUltimoOmitidos} ZIP(s) omitidos -- ya se habian subido antes.</div>`
    : "";

  if (!bancoImagenesArchivosCola.length) {
    contenedor.innerHTML = avisoOmitidos;
    return;
  }

  const filas = bancoImagenesArchivosCola.map((archivo, i) => `
    <div class="banco-imagenes-lista-archivo">
      <span>${escaparHTMLAdmin(archivo.name)}</span>
      <small>${formatoBytesAdmin(archivo.size)}</small>
      <button type="button" class="ghost" style="min-height:26px;padding:0 8px;" onclick="quitarArchivoColaBancoImagenes(${i})">Quitar</button>
    </div>
  `).join("");

  contenedor.innerHTML = avisoOmitidos + filas + `
    <div class="banco-imagenes-lista-archivo" style="background:transparent;border:none;">
      <span><strong>${bancoImagenesArchivosCola.length} archivo(s) listo(s)</strong></span>
      <button type="button" class="ghost" onclick="limpiarColaArchivosBancoImagenes()">Limpiar todo</button>
      <button type="button" onclick="iniciarImportacionMasivaBanco()">Importar ${bancoImagenesArchivosCola.length} ZIP(s)</button>
    </div>
  `;
}

function estadoInicialColaImportacionBanco(archivos, omitirExistentes) {
  return {
    archivos,
    indice: 0,
    pausado: false,
    cancelado: false,
    omitirExistentes,
    resumen: {
      zipsProcesados: 0,
      fotosGuardadas: 0,
      fotosOmitidas: 0,
      solicitudesResueltas: 0,
      codigosNuevos: [],
      codigosOmitidos: [],
      errores: []
    }
  };
}

async function iniciarImportacionMasivaBanco() {
  if (!bancoImagenesArchivosCola.length) return;
  const marca = document.getElementById("marcaBancoImagenes")?.value.trim() || "";
  const omitirExistentes = document.getElementById("omitirExistentesBancoImagenes")?.checked !== false;

  colaImportacionBanco = estadoInicialColaImportacionBanco(bancoImagenesArchivosCola, omitirExistentes);
  bancoImagenesArchivosCola = [];
  bancoImagenesUltimoOmitidos = 0;
  pintarListaArchivosBancoImagenes();

  document.getElementById("importActivoBancoImagenes").style.display = "grid";
  pintarProgresoImportacionBanco("Subiendo", null);
  await procesarSiguienteZipBanco(marca);
}

async function procesarSiguienteZipBanco(marca) {
  const cola = colaImportacionBanco;
  if (!cola) return;

  if (cola.cancelado || cola.pausado) {
    pintarProgresoImportacionBanco(cola.pausado ? "Pausado" : "Cancelado", null);
    return;
  }

  if (cola.indice >= cola.archivos.length) {
    await mostrarResumenFinalImportacionBanco(cola.resumen);
    return;
  }

  const archivo = cola.archivos[cola.indice];
  pintarProgresoImportacionBanco("Subiendo", archivo.name, 0);

  try {
    const datos = await subirZipBancoImagenesAdmin(archivo, marca, fraccion => {
      pintarProgresoImportacionBanco("Subiendo", archivo.name, fraccion);
    }, cola.omitirExistentes);
    pintarProgresoImportacionBanco("Procesando en el servidor...", archivo.name, 1);
    cola.resumen.zipsProcesados += datos.zipsProcesados;
    cola.resumen.fotosGuardadas += datos.fotosGuardadas;
    cola.resumen.fotosOmitidas += datos.fotosOmitidas || 0;
    cola.resumen.solicitudesResueltas += datos.solicitudesResueltas || 0;
    if (datos.codigosNuevos?.length) cola.resumen.codigosNuevos.push(...datos.codigosNuevos);
    if (datos.codigosOmitidos?.length) cola.resumen.codigosOmitidos.push(...datos.codigosOmitidos);
    if (datos.errores?.length) {
      cola.resumen.errores.push(...datos.errores.map(e => `${archivo.name}: ${e}`));
    }
    // Ya no se marca nada en localStorage aqui -- el hash_zip que quedo
    // guardado del lado del servidor (ver verificar-hashes) es la unica
    // fuente de verdad de "ya subido", y a diferencia de este marcado
    // local SI distingue un exito real de un ZIP que fallo por completo.
  } catch (error) {
    // Un ZIP fallido no detiene el lote -- se agrega al reporte y sigue.
    cola.resumen.errores.push(`${archivo.name}: ${error.message || "No se pudo importar"}`);
  }

  cargarHistorialImportacionBanco();
  cola.indice += 1;
  await procesarSiguienteZipBanco(marca);
}

function pintarProgresoImportacionBanco(estado, nombreArchivo, fraccion) {
  const cola = colaImportacionBanco;
  const contenedor = document.getElementById("importActivoBancoImagenes");
  if (!contenedor || !cola) return;

  const total = cola.archivos.length;
  const hecho = cola.indice;
  const porcentaje = total ? Math.round((hecho / total) * 100) : 0;
  const pct = fraccion != null ? Math.round(fraccion * 100) : null;

  contenedor.innerHTML = `
    <div class="banco-imagenes-import-cabecera">
      <div>
        <strong>Importacion masiva ${cola.pausado ? "(pausada)" : cola.cancelado ? "(cancelada)" : "en progreso"}</strong>
        <span>ZIP ${Math.min(hecho + 1, total)} de ${total} -- ${escaparHTMLAdmin(estado)}${nombreArchivo ? `: ${escaparHTMLAdmin(nombreArchivo)}` : ""}${pct != null ? ` (${pct}%)` : ""}</span>
      </div>
      <div class="banco-imagenes-import-acciones">
        ${!cola.cancelado && !cola.pausado ? `<button type="button" class="secondary" onclick="pausarImportacionBanco()">Pausar</button>` : ""}
        ${cola.pausado ? `<button type="button" onclick="reanudarImportacionBanco()">Reanudar</button>` : ""}
        ${!cola.cancelado ? `<button type="button" class="danger" onclick="cancelarImportacionBanco()">Cancelar</button>` : ""}
      </div>
    </div>
    <div class="banco-imagenes-import-barra"><div class="banco-imagenes-import-barra-relleno" style="width:${porcentaje}%"></div></div>
    <div class="banco-imagenes-import-conteos">
      <div><span>Procesados</span><strong>${cola.resumen.zipsProcesados}</strong></div>
      <div><span>Imagenes nuevas</span><strong>${cola.resumen.fotosGuardadas}</strong></div>
      <div><span>Ya estaban (omitidas)</span><strong>${cola.resumen.fotosOmitidas}</strong></div>
      <div><span>Solicitudes resueltas</span><strong>${cola.resumen.solicitudesResueltas}</strong></div>
      <div class="errores"><span>Errores</span><strong>${cola.resumen.errores.length}</strong></div>
    </div>
  `;
}

function pausarImportacionBanco() {
  if (colaImportacionBanco) colaImportacionBanco.pausado = true;
  pintarProgresoImportacionBanco("Pausado", null);
}

async function reanudarImportacionBanco() {
  if (!colaImportacionBanco) return;
  colaImportacionBanco.pausado = false;
  const marca = document.getElementById("marcaBancoImagenes")?.value.trim() || "";
  await procesarSiguienteZipBanco(marca);
}

function cancelarImportacionBanco() {
  if (colaImportacionBanco) colaImportacionBanco.cancelado = true;
  pintarProgresoImportacionBanco("Cancelado", null);
}

async function mostrarResumenFinalImportacionBanco(resumen) {
  const contenedor = document.getElementById("importActivoBancoImagenes");
  if (contenedor) {
    const nuevos = resumen.codigosNuevos || [];
    const omitidos = resumen.codigosOmitidos || [];

    contenedor.innerHTML = `
      <div class="banco-imagenes-import-cabecera">
        <div>
          <strong>Importacion terminada</strong>
          <span>${resumen.zipsProcesados} ZIP(s) procesados -- ${resumen.fotosGuardadas} imagen(es) nuevas, ${resumen.fotosOmitidas} ya estaban en el banco</span>
        </div>
        <div class="banco-imagenes-import-acciones">
          ${resumen.errores.length ? `<button type="button" class="secondary" onclick="descargarReporteErroresBanco()">Descargar reporte de errores</button>` : ""}
          <button type="button" class="ghost" onclick="document.getElementById('importActivoBancoImagenes').style.display='none'">Cerrar</button>
        </div>
      </div>
      <div class="banco-imagenes-import-conteos">
        <div><span>Procesados</span><strong>${resumen.zipsProcesados}</strong></div>
        <div><span>Imagenes nuevas</span><strong>${resumen.fotosGuardadas}</strong></div>
        <div><span>Ya estaban (omitidas)</span><strong>${resumen.fotosOmitidas}</strong></div>
        <div><span>Solicitudes resueltas</span><strong>${resumen.solicitudesResueltas}</strong></div>
        <div class="errores"><span>Errores</span><strong>${resumen.errores.length}</strong></div>
      </div>
      ${nuevos.length || omitidos.length ? `
        <div class="banco-imagenes-import-listas">
          ${nuevos.length ? `<button type="button" class="ghost" onclick="descargarListaCodigosBanco('nuevos')">Ver/descargar ${nuevos.length} codigo(s) nuevo(s)</button>` : ""}
          ${omitidos.length ? `<button type="button" class="ghost" onclick="descargarListaCodigosBanco('omitidos')">Ver/descargar ${omitidos.length} codigo(s) que ya estaban</button>` : ""}
        </div>
      ` : ""}
      ${resumen.errores.length ? `<div class="banco-imagenes-import-errores-detalle">${resumen.errores.map(e => `<div>${escaparHTMLAdmin(e)}</div>`).join("")}</div>` : ""}
    `;
  }

  window.bancoImagenesUltimoResumenErrores = resumen.errores;
  window.bancoImagenesUltimoResumenCodigos = {
    nuevos: resumen.codigosNuevos || [],
    omitidos: resumen.codigosOmitidos || []
  };
  await Promise.all([cargarBancoImagenesAdmin(1), cargarResumenBancoImagenes(), cargarHistorialImportacionBanco()]);
}

function descargarReporteErroresBanco() {
  const errores = window.bancoImagenesUltimoResumenErrores || [];
  const contenido = errores.join("\n");
  const blob = new Blob([contenido], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const enlace = document.createElement("a");
  enlace.href = url;
  enlace.download = `banco-imagenes-errores-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(enlace);
  enlace.click();
  enlace.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

// tipo: "nuevos" o "omitidos" -- mismos codigos que ya trae el ultimo
// resumen de importacion (window.bancoImagenesUltimoResumenCodigos),
// exportados como .csv de una columna para revisarlos en Excel.
function descargarListaCodigosBanco(tipo) {
  const codigos = window.bancoImagenesUltimoResumenCodigos?.[tipo] || [];
  if (!codigos.length) return;
  const contenido = ["codigo", ...codigos].join("\n");
  const blob = new Blob([contenido], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const enlace = document.createElement("a");
  enlace.href = url;
  enlace.download = `banco-imagenes-codigos-${tipo}-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(enlace);
  enlace.click();
  enlace.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

function inicializarDropzoneBancoImagenes() {
  const zona = document.getElementById("dropzoneBancoImagenes");
  if (!zona || zona.dataset.listo === "1") return;
  zona.dataset.listo = "1";

  if ("webkitdirectory" in document.createElement("input")) {
    const labelCarpeta = document.getElementById("labelCarpetaBancoImagenes");
    if (labelCarpeta) labelCarpeta.style.display = "inline-flex";
  }

  zona.addEventListener("dragover", event => {
    event.preventDefault();
    zona.classList.add("arrastrando");
  });
  zona.addEventListener("dragleave", () => zona.classList.remove("arrastrando"));
  zona.addEventListener("drop", event => {
    event.preventDefault();
    zona.classList.remove("arrastrando");
    agregarArchivosColaBancoImagenes(event.dataTransfer?.files);
  });
}

// ---- Solicitudes de fotografia ----

let bancoImagenesSolicitudesPagina = 1;

async function cargarSolicitudesBancoImagenes(pagina = 1) {
  const contenedor = document.getElementById("tablaSolicitudesBancoImagenes");
  if (!contenedor) return;

  bancoImagenesSolicitudesPagina = pagina;
  const estado = document.getElementById("filtroEstadoSolicitudesBanco")?.value || "pendiente";

  try {
    const data = await apiAdmin(`/admin/api/banco-imagenes/solicitudes?estado=${estado}&pagina=${pagina}`);
    pintarTablaSolicitudesBancoImagenes(data, estado);
  } catch (error) {
    contenedor.innerHTML = `<div class="empty">${escaparHTMLAdmin(error.message || "No se pudo cargar solicitudes.")}</div>`;
  }
}

function pintarTablaSolicitudesBancoImagenes(data, estado) {
  const contenedor = document.getElementById("tablaSolicitudesBancoImagenes");
  const paginacion = document.getElementById("paginacionSolicitudesBancoImagenes");
  if (!contenedor) return;

  if (!data.items.length) {
    contenedor.innerHTML = `<div class="empty">Sin solicitudes ${estado === "pendiente" ? "pendientes" : "resueltas"}.</div>`;
    if (paginacion) paginacion.innerHTML = "";
    return;
  }

  contenedor.innerHTML = data.items.map(fila => `
    <div class="banco-imagenes-solicitud-fila">
      <strong>${escaparHTMLAdmin(fila.codigo)}</strong>
      <span>${escaparHTMLAdmin(fila.marca || "-")}</span>
      <span>${escaparHTMLAdmin(fila.negocioNombre)}</span>
      <span>${fechaHoraCortaAdmin(fila.createdAt)}</span>
      ${fila.estado === "pendiente" ? `<button type="button" class="ghost" onclick="descartarSolicitudBancoImagenes(${fila.id})">Descartar</button>` : `<span class="pill ok">Resuelta</span>`}
    </div>
  `).join("");

  const totalPaginas = Math.max(1, Math.ceil(data.total / data.porPagina));
  if (paginacion) {
    paginacion.innerHTML = totalPaginas > 1
      ? `
        <button type="button" class="ghost" ${data.pagina <= 1 ? "disabled" : ""} onclick="cargarSolicitudesBancoImagenes(${data.pagina - 1})">Anterior</button>
        <span>Pagina ${data.pagina} de ${totalPaginas}</span>
        <button type="button" class="ghost" ${data.pagina >= totalPaginas ? "disabled" : ""} onclick="cargarSolicitudesBancoImagenes(${data.pagina + 1})">Siguiente</button>
      `
      : "";
  }
}

async function descartarSolicitudBancoImagenes(id) {
  const confirmar = await confirmarAdmin("¿Descartar esta solicitud sin agregar foto? Util para productos descontinuados.", "Descartar solicitud", "alerta");
  if (!confirmar) return;

  try {
    await apiAdmin(`/admin/api/banco-imagenes/solicitudes/${id}/descartar`, { method: "PATCH" });
    await Promise.all([cargarSolicitudesBancoImagenes(bancoImagenesSolicitudesPagina), cargarConteoSolicitudesBancoImagenes()]);
  } catch (error) {
    await alertaAdmin(error.message || "No se pudo descartar la solicitud.", "Error", "peligro");
  }
}

async function cargarConteoSolicitudesBancoImagenes() {
  try {
    const data = await apiAdmin("/admin/api/banco-imagenes/solicitudes/conteo");
    pintarBadgeSolicitudesBancoImagenes(data.pendientes);
  } catch (error) {
    // Silencioso -- el badge simplemente no aparece si falla.
  }
}

function pintarBadgeSolicitudesBancoImagenes(pendientes) {
  const badge = document.getElementById("badgeBancoImagenesAdmin");
  const pill = document.getElementById("pillSolicitudesPendientesBanco");

  if (badge) {
    badge.textContent = pendientes > 99 ? "99+" : String(pendientes);
    badge.style.display = pendientes > 0 ? "inline-flex" : "none";
  }

  if (pill) {
    pill.textContent = `Solicitudes pendientes ${pendientes}`;
    pill.classList.toggle("visible", pendientes > 0);
  }
}

function abrirVistaBancoImagenesAdmin() {
  inicializarDropzoneBancoImagenes();
  cargarResumenBancoImagenes();
  cargarBancoImagenesAdmin(1);
  cargarSolicitudesBancoImagenes(1);
  cargarHistorialImportacionBanco();
}

const ETIQUETA_ESTADO_TRABAJO_BANCO = {
  pendiente: "En cola",
  procesando: "Procesando...",
  listo: "Subido",
  error: "Error"
};

// Lee directo de banco_imagenes_importacion_trabajos -- a diferencia de
// colaImportacionBanco (memoria del navegador, se pierde al refrescar),
// esto sobrevive a un refresh de pagina porque vive en la base de
// datos, y muestra el estado real de cada ZIP subido desde cualquier
// equipo, no solo el de la sesion actual.
//
// Se llama una vez por cada ZIP terminado durante un lote grande --
// justo el momento en que el servidor esta mas ocupado comprimiendo
// fotos. A proposito usa fetch crudo en vez de apiAdmin(): un hipo
// transitorio (502/503 del proxy) aqui nunca debe cerrar la sesion de
// administrador a medio import, mismo criterio ya usado por
// esperarTrabajoImportacionBanco. Si falla, el historial se queda como
// estaba y se reintenta solo con el siguiente ZIP.
async function cargarHistorialImportacionBanco() {
  const contenedor = document.getElementById("listaHistorialImportacionBanco");
  if (!contenedor) return;

  const sinDatosTodavia = !contenedor.querySelector(".banco-imagenes-historial-fila");

  try {
    const respuesta = await fetch("/admin/api/banco-imagenes/importar-lote/historial?limite=60", {
      headers: { "x-admin-key": adminKeyActual() }
    });
    const datos = await respuesta.json();
    if (!datos.ok) throw new Error(datos.error || "Error de admin");
    pintarHistorialImportacionBanco(datos.trabajos || []);
  } catch (error) {
    if (sinDatosTodavia) {
      contenedor.innerHTML = `<div class="empty">No se pudo cargar el historial: ${escaparHTMLAdmin(error.message)}</div>`;
    }
  }
}

function pintarHistorialImportacionBanco(trabajos) {
  const contenedor = document.getElementById("listaHistorialImportacionBanco");
  if (!contenedor) return;

  if (!trabajos.length) {
    contenedor.innerHTML = '<div class="empty">Todavia no se ha importado ningun ZIP.</div>';
    return;
  }

  contenedor.innerHTML = trabajos.map(trabajo => {
    const estado = trabajo.estado;
    const clase = estado === "listo" ? "ok" : estado === "error" ? "danger" : "warning";
    const totalErrores = Array.isArray(trabajo.errores) ? trabajo.errores.length : 0;
    const detalle = estado === "listo"
      ? `${trabajo.fotos_guardadas || 0} nueva(s), ${trabajo.fotos_omitidas || 0} ya estaban${totalErrores ? `, ${totalErrores} error(es) de match` : ""}`
      : estado === "error"
        ? (trabajo.mensaje_error || "No se pudo procesar")
        : "Esperando su turno...";

    return `
      <div class="banco-imagenes-historial-fila">
        <div>
          <strong>${escaparHTMLAdmin(trabajo.nombre_archivo)}</strong>
          <small>${fechaHoraCortaAdmin(trabajo.created_at)}${trabajo.marca ? ` -- ${escaparHTMLAdmin(trabajo.marca)}` : ""}</small>
        </div>
        <div class="banco-imagenes-historial-fila-derecha">
          <span>${escaparHTMLAdmin(detalle)}</span>
          <em class="pill ${clase}">${ETIQUETA_ESTADO_TRABAJO_BANCO[estado] || escaparHTMLAdmin(estado)}</em>
        </div>
      </div>
    `;
  }).join("");
}

function pintarSoporteAdmin() {
  const contenedor = document.getElementById("soporteAtencionAdmin");
  if (!contenedor) return;

  const pendientes = negociosAdmin
    .filter(negocio => negocio.anomalia_fantasma || ["gracia", "limitado"].includes(negocio.licencia_modo))
    .sort((a, b) => (a.anomalia_fantasma === b.anomalia_fantasma ? 0 : a.anomalia_fantasma ? -1 : 1));

  if (!pendientes.length) {
    contenedor.innerHTML = '<div class="empty">Sin clientes que necesiten atencion ahora mismo.</div>';
    return;
  }

  contenedor.innerHTML = pendientes.map(negocio => {
    if (negocio.anomalia_fantasma) {
      return `
        <div class="support-item high">
          <strong>${escaparHTMLAdmin(negocio.nombre || negocio.slug)}</strong>
          <span>Cuenta fantasma: sin telefono/correo/direccion y sin productos ni ventas. Revisar y probablemente eliminar.</span>
          <em>Alta</em>
        </div>
      `;
    }

    const motivo = negocio.licencia_modo === "gracia"
      ? "Licencia vencida, en periodo de gracia."
      : "Licencia en modo limitado -- el cliente ya no puede operar con normalidad.";

    return `
      <div class="support-item">
        <strong>${escaparHTMLAdmin(negocio.nombre || negocio.slug)}</strong>
        <span>${motivo} Vence: ${fechaCortaAdmin(negocio.fecha_vencimiento)}</span>
        <em>Normal</em>
      </div>
    `;
  }).join("");
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

async function actualizarDatosAdmin() {
  try {
    await cargarAdminNexo();
  } catch (error) {
    await alertaAdmin(error.message || "No se pudieron actualizar los datos.", "Error", "peligro");
  }
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
  pintarSoporteAdmin();
  pintarVersionesAdmin();
  cargarConteoSolicitudesBancoImagenes();
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
    await alertaAdmin("Escribe el nombre del cliente.", "Falta el nombre", "alerta");
    return;
  }

  try {
    const respuesta = await apiAdmin("/admin/api/negocios", {
      method: "POST",
      body: JSON.stringify({
        nombre,
        slug: slugManual || slugAdmin(nombre),
        telefono: document.getElementById("nuevoClienteTelefono")?.value.trim() || "",
        correo: document.getElementById("nuevoClienteCorreo")?.value.trim() || "",
        direccion: document.getElementById("nuevoClienteDireccion")?.value.trim() || "",
        giro: document.getElementById("nuevoClienteGiro")?.value || "ferreteria",
        plan: document.getElementById("nuevoClientePlan")?.value || "basico",
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
    await alertaAdmin(`Licencia: ${clave}\nAcceso POS inicial: admin / 1234`, "Cliente creado", "exito");
    mostrarVistaAdmin("clientes");
  } catch (error) {
    await alertaAdmin(error.message || "No se pudo crear el cliente.", "Error", "peligro");
  }
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

  try {
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
  } catch (error) {
    await alertaAdmin(error.message || "No se pudo guardar la licencia.", "Error", "peligro");
  }
}

async function regenerarClaveAdmin() {
  if (!negocioEditandoAdmin) return;

  const confirmar = await confirmarAdmin(
    "Esto invalida la clave actual -- el cliente necesitara la nueva clave para reactivar cualquier dispositivo nuevo. Los dispositivos ya activados no se ven afectados.",
    "Regenerar clave de licencia",
    "alerta"
  );

  if (!confirmar) return;

  try {
    const respuesta = await apiAdmin(`/admin/api/negocios/${negocioEditandoAdmin.id}/licencia/regenerar-clave`, {
      method: "POST"
    });

    const campoClave = document.getElementById("licClave");
    if (campoClave) campoClave.value = respuesta.licenseKey || "";

    await cargarAdminNexo();
    negocioEditandoAdmin = negociosAdmin.find(item => Number(item.id) === Number(negocioEditandoAdmin.id)) || negocioEditandoAdmin;

    await alertaAdmin(`Nueva clave: ${respuesta.licenseKey}`, "Clave regenerada", "exito");
  } catch (error) {
    await alertaAdmin(error.message || "No se pudo regenerar la clave.", "Error", "peligro");
  }
}

async function renovarLicenciaAdmin(dias) {
  if (!negocioEditandoAdmin) return;

  const campoVence = document.getElementById("licVence");
  const actual = campoVence?.value ? new Date(`${campoVence.value}T00:00:00`) : null;
  const base = actual && actual.getTime() > Date.now() ? actual : new Date();
  base.setDate(base.getDate() + Number(dias));
  const nuevaFecha = base.toISOString().slice(0, 10);

  if (campoVence) campoVence.value = nuevaFecha;

  try {
    await apiAdmin(`/admin/api/negocios/${negocioEditandoAdmin.id}/licencia`, {
      method: "PUT",
      body: JSON.stringify({
        negocioEstado: document.getElementById("licNegocioEstado").value,
        plan: document.getElementById("licPlan").value,
        licenciaEstado: document.getElementById("licEstado").value,
        montoMensual: Number(document.getElementById("licMonto").value || 0),
        fechaVencimiento: nuevaFecha,
        ultimoPagoAt: document.getElementById("licUltimoPago").value || null,
        graciaDias: Number(document.getElementById("licGracia").value || 15),
        notas: document.getElementById("licNotas").value.trim()
      })
    });

    await cargarAdminNexo();
    negocioEditandoAdmin = negociosAdmin.find(item => Number(item.id) === Number(negocioEditandoAdmin.id)) || negocioEditandoAdmin;
    await alertaAdmin(`Licencia renovada +${dias} dias. Nueva fecha: ${nuevaFecha}`, "Licencia renovada", "exito");
  } catch (error) {
    await alertaAdmin(error.message || "No se pudo renovar la licencia.", "Error", "peligro");
  }
}

async function eliminarClienteAdmin(id) {
  const negocio = negociosAdmin.find(item => Number(item.id) === Number(id));
  if (!negocio) return;

  const confirmar = await pedirTextoAdmin(
    `Esto eliminara el cliente y sus datos relacionados.\nPara confirmar escribe exactamente:\n${negocio.slug}`,
    "",
    "Eliminar cliente"
  );

  if (confirmar === null) return;

  if (confirmar !== negocio.slug) {
    await alertaAdmin("El texto no coincide con el codigo del cliente. No se elimino nada.", "Confirmacion invalida", "alerta");
    return;
  }

  try {
    await apiAdmin(`/admin/api/negocios/${Number(id)}`, {
      method: "DELETE",
      body: JSON.stringify({
        confirmarSlug: confirmar
      })
    });

    await cargarAdminNexo();
  } catch (error) {
    await alertaAdmin(error.message || "No se pudo eliminar el cliente.", "Error", "peligro");
  }
}

function exportarClientesAdmin() {
  const datos = negociosAdmin.map(({ license_key, ...resto }) => resto);
  const contenido = JSON.stringify(datos, null, 2);
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

// Ofertas destacadas de Nexo Market (Fase "Ofertas destacadas", ver
// plan): banners generales del marketplace, creados por el equipo de
// Nexo, nunca ligados a una tienda. editandoBannerMarketId != null
// mientras el formulario esta en modo edicion; el archivo elegido en
// el input de imagen (si lo hay) se sube tal cual con FormData -- el
// servidor la recorta con sharp, no se toca aqui.
let bannersMarketAdmin = [];
let editandoBannerMarketId = null;

async function cargarBannersMarketAdmin() {
  const lista = document.getElementById("listaBannersMarketAdmin");
  if (lista) lista.innerHTML = '<div class="empty">Cargando...</div>';
  try {
    const datos = await apiAdmin("/admin/api/banners-market");
    bannersMarketAdmin = datos.banners || [];
    pintarBannersMarketAdmin();
  } catch (error) {
    if (lista) lista.innerHTML = `<div class="empty">${error.message || "No se pudieron cargar los banners."}</div>`;
  }
}

function pintarBannersMarketAdmin() {
  const lista = document.getElementById("listaBannersMarketAdmin");
  if (!lista) return;

  if (bannersMarketAdmin.length === 0) {
    lista.innerHTML = '<div class="empty">Todavia no hay banners. Crea el primero arriba.</div>';
    return;
  }

  lista.innerHTML = bannersMarketAdmin.map(banner => `
    <div class="banner-market-item${banner.activo ? "" : " inactivo"}">
      <div class="banner-market-item-miniatura">
        ${banner.tieneImagen ? `<img src="/banners-market/${banner.id}/imagen" alt="">` : ""}
      </div>
      <div class="banner-market-item-info">
        <strong>${escaparAdmin(banner.titulo)}</strong>
        <span>${escaparAdmin(banner.subtitulo || "")}</span>
        <span class="banner-market-item-meta">Orden ${banner.orden} -- ${banner.activo ? "Activo" : "Inactivo"} -- Tema ${escaparAdmin(banner.temaColor)}${banner.quitarFondo ? " -- Fondo quitado" : ""}</span>
      </div>
      <div class="banner-market-item-acciones">
        <button type="button" class="secondary" onclick="editarBannerMarketAdmin(${banner.id})">Editar</button>
        <button type="button" class="secondary" onclick="eliminarBannerMarketAdmin(${banner.id})">Eliminar</button>
      </div>
    </div>
  `).join("");
}

function escaparAdmin(texto) {
  return String(texto == null ? "" : texto)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function editarBannerMarketAdmin(id) {
  const banner = bannersMarketAdmin.find(b => b.id === id);
  if (!banner) return;

  editandoBannerMarketId = id;
  document.getElementById("bannerMarketTitulo").value = banner.titulo || "";
  document.getElementById("bannerMarketSubtitulo").value = banner.subtitulo || "";
  document.getElementById("bannerMarketTextoBoton").value = banner.textoBoton || "";
  document.getElementById("bannerMarketEnlace").value = banner.enlace || "";
  document.getElementById("bannerMarketTemaColor").value = banner.temaColor || "azul";
  document.getElementById("bannerMarketOrden").value = banner.orden || 0;
  document.getElementById("bannerMarketActivo").checked = Boolean(banner.activo);
  document.getElementById("bannerMarketQuitarFondo").checked = Boolean(banner.quitarFondo);
  document.getElementById("bannerMarketImagenInput").value = "";
  document.getElementById("bannerMarketImagenPreview").innerHTML = banner.tieneImagen
    ? `<img src="/banners-market/${banner.id}/imagen" alt="" style="max-width:220px; border-radius:10px;">`
    : "";

  document.getElementById("formBannerMarketEyebrow").textContent = "Editar banner";
  document.getElementById("formBannerMarketTitulo").textContent = banner.titulo;
  document.getElementById("botonCancelarEdicionBannerMarket").style.display = "";
  document.getElementById("view-ofertas-market").scrollIntoView({ behavior: "smooth" });
}

function cancelarEdicionBannerMarketAdmin() {
  editandoBannerMarketId = null;
  document.getElementById("formBannerMarket").reset();
  document.getElementById("bannerMarketImagenPreview").innerHTML = "";
  document.getElementById("formBannerMarketEyebrow").textContent = "Nuevo banner";
  document.getElementById("formBannerMarketTitulo").textContent = "Crear banner";
  document.getElementById("botonCancelarEdicionBannerMarket").style.display = "none";
}

function previsualizarImagenBannerMarketAdmin(evento) {
  const archivo = evento.target.files?.[0];
  const preview = document.getElementById("bannerMarketImagenPreview");
  if (!archivo || !preview) return;

  const lector = new FileReader();
  lector.onload = e => {
    preview.innerHTML = `<img src="${e.target.result}" alt="" style="max-width:220px; border-radius:10px;">`;
  };
  lector.readAsDataURL(archivo);
}

async function guardarBannerMarketAdmin(evento) {
  evento.preventDefault();

  const formulario = new FormData();
  formulario.append("titulo", document.getElementById("bannerMarketTitulo").value.trim());
  formulario.append("subtitulo", document.getElementById("bannerMarketSubtitulo").value.trim());
  formulario.append("textoBoton", document.getElementById("bannerMarketTextoBoton").value.trim());
  formulario.append("enlace", document.getElementById("bannerMarketEnlace").value.trim());
  formulario.append("temaColor", document.getElementById("bannerMarketTemaColor").value);
  formulario.append("orden", document.getElementById("bannerMarketOrden").value || "0");
  formulario.append("activo", document.getElementById("bannerMarketActivo").checked ? "true" : "false");
  formulario.append("quitarFondo", document.getElementById("bannerMarketQuitarFondo").checked ? "true" : "false");

  const archivo = document.getElementById("bannerMarketImagenInput").files?.[0];
  if (archivo) formulario.append("imagen", archivo);

  const url = editandoBannerMarketId
    ? `/admin/api/banners-market/${editandoBannerMarketId}`
    : "/admin/api/banners-market";

  try {
    const respuesta = await fetch(url, {
      method: editandoBannerMarketId ? "PATCH" : "POST",
      headers: { "x-admin-key": adminKeyActual() },
      body: formulario
    });
    const datos = await respuesta.json();
    if (!datos.ok) throw new Error(datos.error || "No se pudo guardar el banner.");

    cancelarEdicionBannerMarketAdmin();
    await cargarBannersMarketAdmin();
  } catch (error) {
    alertaAdmin(error.message || "No se pudo guardar el banner.", "Ofertas Market", "alerta");
  }
}

async function eliminarBannerMarketAdmin(id) {
  const confirmado = await confirmarAdmin("¿Eliminar este banner? Esta accion no se puede deshacer.", "Eliminar banner");
  if (!confirmado) return;
  try {
    await apiAdmin(`/admin/api/banners-market/${id}`, { method: "DELETE" });
    await cargarBannersMarketAdmin();
  } catch (error) {
    alertaAdmin(error.message || "No se pudo eliminar el banner.", "Ofertas Market", "alerta");
  }
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
