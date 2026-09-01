/* =====================================================================
   Pantalla "Catalogos de fabricantes" del panel interno.
   ---------------------------------------------------------------------
   Esta pantalla esconde a proposito TODO lo que pasa por debajo: OCR,
   vision, recortes de imagen, layouts, ETags, unidades. Para quien la usa
   solo existe "Nexo encontro cambios en el catalogo". El metodo de
   lectura aparece unicamente como una etiqueta discreta al revisar un
   cambio concreto, porque ahi si ayuda a decidir cuanto confiar.

   Vive aparte de app.js (que ya son 80 KB) y usa su helper apiAdmin().
   ===================================================================== */

let catalogoFabricanteActual = null;
let temporizadorCorridaCatalogo = null;

const NOMBRE_PRECIO = {
  precio_mayoreo: "Mayoreo",
  precio_medio_mayoreo: "Medio mayoreo",
  precio_publico: "Publico",
  precio_distribuidor: "Distribuidor",
  estado: "Estado"
};

// Vocabulario de cara al usuario: nunca "OCR" ni "vision".
const ETIQUETA_ORIGEN = {
  ocr: "Lectura automatica",
  vision: "Lectura asistida",
  archivo: "Archivo del proveedor",
  api: "Conexion directa",
  sin_precios_publicados: "El fabricante no publica este precio",
  manual: "Revisado por ti"
};

function fechaCortaCatalogo(valor) {
  if (!valor) return "nunca";
  const fecha = new Date(valor);
  if (Number.isNaN(fecha.getTime())) return "nunca";
  const hora = fecha.toLocaleTimeString("es-MX", { hour: "numeric", minute: "2-digit" });
  if (fecha.toDateString() === new Date().toDateString()) return "hoy " + hora;
  return fecha.toLocaleDateString("es-MX", { day: "numeric", month: "short" }) + " " + hora;
}

function numeroCatalogo(valor) {
  return Number(valor || 0).toLocaleString("es-MX");
}

function escaparCatalogo(texto) {
  return String(texto == null ? "" : texto)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

async function cargarCatalogosFabricante() {
  const contenedor = document.getElementById("listaCatalogosFabricante");
  if (!contenedor) return;

  try {
    const data = await apiAdmin("/admin/api/catalogo-fabricante/resumen");
    pintarAvisoCorridaCatalogo(data.enCurso);
    pintarCatalogosFabricante(data.fuentes || []);
    actualizarBadgeCatalogos(data.fuentes || []);
  } catch (error) {
    contenedor.innerHTML = '<div class="empty">' + escaparCatalogo(error.message) + "</div>";
  }
}

// El badge del menu cuenta lo unico que le importa a una persona:
// productos esperando revision. No cuenta modulos ni unidades, que es
// vocabulario interno.
function actualizarBadgeCatalogos(fuentes) {
  const badge = document.getElementById("badgeCatalogosAdmin");
  if (!badge) return;
  const pendientes = fuentes.reduce(function (n, f) {
    return n + Number((f.revision && f.revision.productos) || 0);
  }, 0);
  badge.textContent = pendientes > 99 ? "99+" : String(pendientes);
  badge.style.display = pendientes > 0 ? "" : "none";
}

const ETAPAS_CORRIDA = {
  iniciando: "Preparando",
  universo: "Leyendo el catalogo del fabricante",
  unidades: "Viendo que cambio",
  revisando: "Viendo que cambio",
  extrayendo: "Leyendo los precios",
  enriqueciendo: "Completando descripciones",
  maestro: "Guardando en el Catalogo Nexo",
  esperando_confirmacion: "Esperando tu confirmacion"
};

function pintarAvisoCorridaCatalogo(corrida) {
  const aviso = document.getElementById("catalogosAvisoCorrida");
  if (!aviso) return;

  if (!corrida) {
    aviso.style.display = "none";
    if (temporizadorCorridaCatalogo) {
      clearTimeout(temporizadorCorridaCatalogo);
      temporizadorCorridaCatalogo = null;
    }
    return;
  }

  const texto = ETAPAS_CORRIDA[corrida.etapa] || "Trabajando";
  const detalle = corrida.detalle || {};
  const avance = detalle.hechas && detalle.total
    ? " (" + numeroCatalogo(detalle.hechas) + " de " + numeroCatalogo(detalle.total) + ")"
    : "";

  aviso.style.display = "";
  aviso.innerHTML = '<span class="catalogo-aviso-punto"></span><div><b>'
    + escaparCatalogo(corrida.fabricante) + ":</b> " + texto + avance + "</div>";

  // Mientras hay una corrida, la vista se refresca sola.
  if (temporizadorCorridaCatalogo) clearTimeout(temporizadorCorridaCatalogo);
  temporizadorCorridaCatalogo = setTimeout(cargarCatalogosFabricante, 5000);
}

function pintarCatalogosFabricante(fuentes) {
  const contenedor = document.getElementById("listaCatalogosFabricante");
  if (!contenedor) return;

  if (fuentes.length === 0) {
    contenedor.innerHTML = '<div class="empty">Todavia no hay ningun catalogo configurado.</div>';
    return;
  }

  contenedor.innerHTML = fuentes.map(function (fuente) {
    const p = fuente.productos || {};
    const u = fuente.ultimaSincronizacion;
    const rev = Number((fuente.revision && fuente.revision.productos) || 0);
    const nombre = escaparCatalogo(fuente.fabricante);

    // Solo se muestran los renglones que tienen algo que decir: un cero
    // en "descontinuados" es ruido.
    const renglones = [];
    renglones.push(["Productos", numeroCatalogo(p.activos), ""]);
    if (u && u.productos_modificados > 0) renglones.push(["Actualizados", numeroCatalogo(u.productos_modificados), ""]);
    if (u && u.productos_nuevos > 0) renglones.push(["Nuevos", numeroCatalogo(u.productos_nuevos), ""]);
    if (Number(p.descontinuados) > 0) renglones.push(["Descontinuados", numeroCatalogo(p.descontinuados), ""]);
    if (rev > 0) renglones.push(["Necesitan revision", numeroCatalogo(rev), "alerta"]);

    const esperando = u && u.estado === "esperando_confirmacion";

    return '<article class="catalogo-fuente">'
      + '<div class="catalogo-fuente-head"><div>'
      + "<h3>" + nombre + "</h3>"
      + '<span class="catalogo-fuente-sub">'
      + (u ? "Sincronizado: " + fechaCortaCatalogo(u.terminada_en || u.iniciada_en) : "Sin sincronizar todavia")
      + "</span></div>"
      + (rev > 0 ? '<span class="catalogo-chip alerta">' + numeroCatalogo(rev) + " por revisar</span>" : "")
      + "</div>"

      + '<dl class="catalogo-datos">'
      + renglones.map(function (r) {
        return '<div class="' + r[2] + '"><dt>' + r[0] + "</dt><dd>" + r[1] + "</dd></div>";
      }).join("")
      + "</dl>"

      + (esperando
        ? '<div class="catalogo-confirmacion"><p>' + escaparCatalogo(u.detalle || "La corrida quedo esperando tu confirmacion.")
          + '</p><button type="button" onclick="sincronizarCatalogo(\'' + nombre + '\', true)">Confirmar y continuar</button></div>'
        : "")

      + '<div class="catalogo-acciones">'
      + (u ? '<button type="button" class="secondary" onclick="verCambiosCatalogo(\'' + nombre + "', " + Number(u.id) + ')">Ver cambios</button>' : "")
      + (rev > 0 ? '<button type="button" class="secondary" onclick="verRevisionCatalogo(\'' + nombre + '\')">Revisar pendientes</button>' : "")
      + '<button type="button" onclick="sincronizarCatalogo(\'' + nombre + '\', false)">Sincronizar</button>'
      + "</div></article>";
  }).join("");
}

async function sincronizarCatalogo(fabricante, confirmar) {
  try {
    await apiAdmin("/admin/api/catalogo-fabricante/" + encodeURIComponent(fabricante) + "/sincronizar", {
      method: "POST",
      body: JSON.stringify({ confirmarRegeneracionMasiva: Boolean(confirmar) })
    });
    await cargarCatalogosFabricante();
  } catch (error) {
    alert("No se pudo sincronizar: " + error.message);
  }
}

/* --- Cambios de una corrida --- */

async function verCambiosCatalogo(fabricante, sincronizacionId) {
  catalogoFabricanteActual = fabricante;
  const panel = document.getElementById("panelCambiosCatalogo");
  const lista = document.getElementById("listaCambiosCatalogo");
  document.getElementById("panelRevisionCatalogo").style.display = "none";
  panel.style.display = "";
  lista.innerHTML = '<div class="empty">Cargando...</div>';
  document.getElementById("cambiosCatalogoEyebrow").textContent = fabricante;

  try {
    const data = await apiAdmin("/admin/api/catalogo-fabricante/sincronizaciones/" + sincronizacionId + "/reporte");
    pintarCambiosCatalogo(data);
    panel.scrollIntoView({ behavior: "smooth", block: "start" });
  } catch (error) {
    lista.innerHTML = '<div class="empty">' + escaparCatalogo(error.message) + "</div>";
  }
}

function cerrarCambiosCatalogo() {
  document.getElementById("panelCambiosCatalogo").style.display = "none";
}

function pintarCambiosCatalogo(data) {
  const lista = document.getElementById("listaCambiosCatalogo");
  const s = data.sincronizacion || {};
  const productos = data.productos || [];

  document.getElementById("cambiosCatalogoTitulo").textContent =
    "Cambios del " + fechaCortaCatalogo(s.terminada_en || s.iniciada_en);
  document.getElementById("cambiosCatalogoResumen").textContent =
    numeroCatalogo(s.productos_modificados) + " actualizados, "
    + numeroCatalogo(s.productos_nuevos) + " nuevos, "
    + numeroCatalogo(s.productos_descontinuados) + " descontinuados";

  const modificados = productos.filter(function (p) { return p.tipo === "modificado"; });
  if (modificados.length === 0) {
    lista.innerHTML = '<div class="empty">No hubo cambios de precio en esta sincronizacion.</div>';
    return;
  }

  lista.innerHTML = modificados.map(function (p) {
    const titulo = escaparCatalogo(p.nombre || (p.marca + " " + p.clave).trim() || ("Codigo " + p.codigo));

    const filas = p.campos.map(function (c) {
      const etiqueta = NOMBRE_PRECIO[c.campo] || c.campo;
      if (c.campo === "estado") {
        return '<div class="catalogo-cambio-linea"><span>' + etiqueta + "</span><b>"
          + escaparCatalogo(c.de) + " &rarr; " + escaparCatalogo(c.a) + "</b></div>";
      }
      // El color marca la direccion, no el tamano: una subida siempre se
      // ve, aunque sea chica.
      const clase = c.variacion === null || c.variacion === undefined ? "" : (c.variacion > 0 ? "sube" : "baja");
      const signo = (c.variacion === null || c.variacion === undefined)
        ? ""
        : '<span class="catalogo-variacion ' + clase + '">' + (c.variacion > 0 ? "+" : "") + c.variacion + "%</span>";
      return '<div class="catalogo-cambio-linea"><span>' + etiqueta + "</span><b>"
        + escaparCatalogo(c.de) + " &rarr; " + escaparCatalogo(c.a) + "</b> " + signo + "</div>";
    }).join("");

    const origen = ETIQUETA_ORIGEN[p.origenLectura] || "";
    const confianza = p.confianza
      ? '<span class="catalogo-chip ' + p.confianza + '">Confianza ' + p.confianza + "</span>"
      : "";

    return '<article class="catalogo-cambio">'
      + '<div class="catalogo-cambio-head"><div><h4>' + titulo + "</h4>"
      + '<span class="catalogo-cambio-sub">'
      + (p.marca ? escaparCatalogo(p.marca) + " &middot; " : "")
      + escaparCatalogo(p.clave || p.codigo) + "</span></div>"
      + (p.verificado ? '<span class="catalogo-chip alta">Revisado</span>' : confianza)
      + "</div>"
      + '<div class="catalogo-cambio-cuerpo">' + filas + "</div>"
      + '<div class="catalogo-cambio-pie"><span>' + origen + "</span>"
      + (p.verificado ? "" : '<button type="button" class="ghost" onclick="marcarProductoRevisado(\''
        + escaparCatalogo(catalogoFabricanteActual) + "', '" + escaparCatalogo(p.codigo)
        + '\', this)">Marcar revisado</button>')
      + "</div></article>";
  }).join("");
}

async function marcarProductoRevisado(fabricante, codigo, boton) {
  try {
    if (boton) { boton.disabled = true; boton.textContent = "Guardando..."; }
    await apiAdmin("/admin/api/catalogo-fabricante/" + encodeURIComponent(fabricante)
      + "/productos/" + encodeURIComponent(codigo) + "/verificar", {
      method: "POST",
      body: JSON.stringify({})
    });
    if (boton) {
      const pie = boton.parentElement;
      const tarjeta = pie.parentElement;
      boton.remove();
      const chip = tarjeta.querySelector(".catalogo-cambio-head .catalogo-chip");
      if (chip) {
        chip.className = "catalogo-chip alta";
        chip.textContent = "Revisado";
      }
    }
  } catch (error) {
    if (boton) { boton.disabled = false; boton.textContent = "Marcar revisado"; }
    alert("No se pudo guardar: " + error.message);
  }
}

/* --- Cola de revision --- */

async function verRevisionCatalogo(fabricante) {
  catalogoFabricanteActual = fabricante;
  const panel = document.getElementById("panelRevisionCatalogo");
  const lista = document.getElementById("listaRevisionCatalogo");
  document.getElementById("panelCambiosCatalogo").style.display = "none";
  panel.style.display = "";
  lista.innerHTML = '<div class="empty">Cargando...</div>';
  document.getElementById("revisionCatalogoTitulo").textContent = fabricante + ": necesitan revision";

  try {
    const data = await apiAdmin("/admin/api/catalogo-fabricante/" + encodeURIComponent(fabricante) + "/revision");
    pintarRevisionCatalogo(data);
    panel.scrollIntoView({ behavior: "smooth", block: "start" });
  } catch (error) {
    lista.innerHTML = '<div class="empty">' + escaparCatalogo(error.message) + "</div>";
  }
}

function cerrarRevisionCatalogo() {
  document.getElementById("panelRevisionCatalogo").style.display = "none";
}

function pintarRevisionCatalogo(data) {
  const lista = document.getElementById("listaRevisionCatalogo");
  const ambigua = data.estructuraAmbigua || { modulos: 0, productos: 0 };
  const incompletos = data.preciosIncompletos || { modulos: 0, productos: 0 };
  const total = data.total || { modulos: 0, productos: 0 };

  document.getElementById("revisionCatalogoResumen").textContent =
    numeroCatalogo(total.productos) + " productos en " + numeroCatalogo(total.modulos) + " paginas del catalogo";

  // Los dos grupos piden trabajos distintos, por eso se separan: uno pide
  // mirar la pagina del catalogo, el otro solo confirmar numeros.
  const grupos = '<div class="catalogo-revision-grupos">'
    + '<div class="catalogo-revision-grupo roja"><b>' + numeroCatalogo(ambigua.productos) + "</b>"
    + "<span>No se entendio la tabla</span><small>Hay que mirar la pagina del catalogo</small></div>"
    + '<div class="catalogo-revision-grupo amarilla"><b>' + numeroCatalogo(incompletos.productos) + "</b>"
    + "<span>Faltan precios</span><small>Se entendio la tabla, falto algun importe</small></div>"
    + "</div>";

  const modulos = data.modulos || [];
  if (modulos.length === 0) {
    lista.innerHTML = grupos + '<div class="empty">No hay nada pendiente.</div>';
    return;
  }

  const nombreLista = { dis: "Distribuidor", pub: "Publico" };

  lista.innerHTML = grupos
    + '<table class="admin-table"><thead><tr><th>Pagina</th><th>Lista</th><th>Productos</th><th>Que paso</th></tr></thead><tbody>'
    + modulos.map(function (m) {
      const esEstructura = m.motivo_revision === "estructura_ambigua";
      return "<tr><td>" + escaparCatalogo(m.modulo) + "</td>"
        + "<td>" + (nombreLista[m.variante] || escaparCatalogo(m.variante) || "-") + "</td>"
        + "<td>" + numeroCatalogo(m.productos_afectados) + "</td>"
        + '<td><span class="catalogo-chip ' + (esEstructura ? "roja" : "amarilla") + '">'
        + (esEstructura ? "Estructura" : "Precios") + "</span> <small>"
        + escaparCatalogo(m.detalle || "") + "</small></td></tr>";
    }).join("")
    + "</tbody></table>";
}
