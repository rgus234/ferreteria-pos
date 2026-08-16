// Pantalla "Pedidos" del POS -- gestion de pedidos de Nexo Market
// (rediseno de pedidos, ver plan). Separada de "Pedidos recibidos"
// (sitio-web-view.js), que se queda tal cual para cotizaciones y
// pedidos del sitio propio del negocio. Un solo fetch trae TODOS los
// pedidos de Market (hasta 100) y las pestanas/contadores filtran en
// el cliente -- mismo criterio de "barato" que el resto del proyecto,
// sin pedir de nuevo al servidor por cada pestana.

let pedidosMarketCache = [];
let pedidosMarketTabActiva = "nuevos";

// Monitor en vivo de pedidos nuevos -- sondea cada 20s mientras la
// sesion esta abierta (sin importar que pantalla este viendo el
// empleado) y avisa con sonido + badge en el sidebar. null = todavia
// no se establece la base de comparacion (evita sonar en la primera
// carga con pedidos que ya estaban ahi).
let pmkMonitorTimer = null;
let pmkPedidosPendientesConocidosIds = null;
let pmkAudioCtx = null;

function pmkAsegurarAudioContext() {
    if (pmkAudioCtx) return pmkAudioCtx;
    try {
        pmkAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
    } catch (error) {
        pmkAudioCtx = null;
    }
    return pmkAudioCtx;
}

// Los navegadores bloquean audio sin una interaccion previa del
// usuario -- la primera vez que alguien haga clic o toque una tecla en
// el POS (siempre pasa al iniciar sesion) se desbloquea el contexto
// para el resto de la sesion.
document.addEventListener("click", () => { pmkAsegurarAudioContext()?.resume(); }, { once: true });
document.addEventListener("keydown", () => { pmkAsegurarAudioContext()?.resume(); }, { once: true });

// Dos tonos ascendentes cortos generados con Web Audio API -- sin
// archivo de sonido externo que descargar ni licencia que cuidar.
function pmkReproducirBeep() {
    const ctx = pmkAsegurarAudioContext();
    if (!ctx) return;

    const ahora = ctx.currentTime;
    [0, 0.16].forEach((retraso, i) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = "sine";
        osc.frequency.value = i === 0 ? 880 : 1108.73;
        gain.gain.setValueAtTime(0, ahora + retraso);
        gain.gain.linearRampToValueAtTime(0.22, ahora + retraso + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.001, ahora + retraso + 0.15);
        osc.connect(gain).connect(ctx.destination);
        osc.start(ahora + retraso);
        osc.stop(ahora + retraso + 0.16);
    });
}

function pmkActualizarBadgeSidebar(cantidad) {
    const boton = document.querySelector('[data-shell-module="pedidos-market"]');
    if (!boton) return;

    let badge = boton.querySelector(".pmk-sidebar-badge");
    if (cantidad > 0) {
        if (!badge) {
            badge = document.createElement("span");
            badge.className = "pmk-sidebar-badge";
            boton.appendChild(badge);
        }
        badge.textContent = cantidad > 9 ? "9+" : String(cantidad);
    } else if (badge) {
        badge.remove();
    }
}

async function pmkRevisarPedidosNuevos() {
    try {
        const respuesta = await fetch("/negocio-actual/pedidos-market?estado=nuevos");
        const datos = await respuesta.json();
        if (!datos.ok) return;

        const idsActuales = new Set(datos.pedidos.map(p => p.id));

        if (pmkPedidosPendientesConocidosIds === null) {
            pmkPedidosPendientesConocidosIds = idsActuales;
            pmkActualizarBadgeSidebar(idsActuales.size);
            return;
        }

        const hayNuevos = [...idsActuales].some(id => !pmkPedidosPendientesConocidosIds.has(id));
        pmkPedidosPendientesConocidosIds = idsActuales;
        pmkActualizarBadgeSidebar(idsActuales.size);

        if (hayNuevos) {
            pmkReproducirBeep();

            const pantalla = document.getElementById("pantallaPedidosMarket");
            if (pantalla && pantalla.style.display !== "none") {
                await cargarPedidosMarket();
            }
        }
    } catch (error) {
        // Silencioso -- un fallo de red puntual no debe interrumpir el POS.
    }
}

function iniciarMonitorPedidosMarket() {
    if (pmkMonitorTimer) return;
    pmkRevisarPedidosNuevos();
    pmkMonitorTimer = setInterval(pmkRevisarPedidosNuevos, 20000);
    pmkResuscribirPushSiYaHabiaPermiso();
}

// --- Notificaciones push reales (avisan aunque la pestana este en
// segundo plano o cerrada) -- complementan el sonido/badge de arriba,
// que solo funciona con la pestana abierta. ---

function pmkBase64UrlAUint8Array(base64Url) {
    const relleno = "=".repeat((4 - base64Url.length % 4) % 4);
    const base64 = (base64Url + relleno).replace(/-/g, "+").replace(/_/g, "/");
    const bruto = atob(base64);
    const salida = new Uint8Array(bruto.length);
    for (let i = 0; i < bruto.length; i++) salida[i] = bruto.charCodeAt(i);
    return salida;
}

function pmkActualizarEstadoBotonPush() {
    const boton = document.getElementById("pmkBotonPush");
    if (!boton) return;

    const activado = typeof Notification !== "undefined" &&
        Notification.permission === "granted" &&
        localStorage.getItem("nexoPosPushActivado") === "1";

    boton.textContent = activado ? "🔔 Notificaciones activadas" : "🔕 Activar notificaciones push";
    boton.disabled = activado;
}

async function pmkActivarNotificacionesPush() {
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
        alert("Este navegador no soporta notificaciones push.");
        return;
    }

    try {
        const permiso = await Notification.requestPermission();
        if (permiso !== "granted") {
            alert("No se activaron las notificaciones -- el permiso fue denegado.");
            return;
        }

        const respuestaClave = await fetch("/push/vapid-public-key").then(r => r.json());
        if (!respuestaClave.ok) {
            alert("Las notificaciones push no estan configuradas en el servidor todavia.");
            return;
        }

        const registro = await navigator.serviceWorker.register("/pos-push-sw.js");
        const suscripcion = await registro.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: pmkBase64UrlAUint8Array(respuestaClave.publicKey)
        });

        await fetch("/negocio-actual/push/suscribir", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(suscripcion.toJSON())
        });

        localStorage.setItem("nexoPosPushActivado", "1");
        pmkActualizarEstadoBotonPush();
    } catch (error) {
        console.warn("No se pudo activar notificaciones push:", error);
        alert("No se pudieron activar las notificaciones push en este dispositivo.");
    }
}

// Si el empleado ya habia dado permiso antes (misma sesion del
// navegador, otro dia), vuelve a registrar la suscripcion en silencio
// al iniciar sesion -- sin pedir el permiso otra vez.
async function pmkResuscribirPushSiYaHabiaPermiso() {
    if (typeof Notification === "undefined" || Notification.permission !== "granted") return;
    if (localStorage.getItem("nexoPosPushActivado") !== "1") return;
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) return;

    try {
        const registro = await navigator.serviceWorker.register("/pos-push-sw.js");
        const suscripcionExistente = await registro.pushManager.getSubscription();
        if (suscripcionExistente) {
            await fetch("/negocio-actual/push/suscribir", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(suscripcionExistente.toJSON())
            });
        }
    } catch (error) {
        // Silencioso -- no interrumpir el login por esto.
    }
}

const PMK_GRUPOS_ESTADO = {
    nuevos: ["pendiente"],
    preparando: ["confirmado", "preparando"],
    listos: ["listo"],
    entregados: ["entregado"],
    cancelados: ["cancelado"]
};

const PMK_ETIQUETAS_TAB = {
    nuevos: "Nuevos",
    preparando: "Preparando",
    listos: "Listos",
    entregados: "Entregados",
    cancelados: "Cancelados"
};

async function mostrarPedidosMarket() {
    if (typeof ocultarPantallasPrincipales === "function") {
        ocultarPantallasPrincipales();
    }

    const pantalla = document.getElementById("pantallaPedidosMarket");
    if (!pantalla) return;

    pantalla.style.display = "block";

    if (typeof actualizarTopbarContexto === "function") {
        actualizarTopbarContexto("Pedidos", "Pedidos de Nexo Market -- acepta, prepara y entrega", "pedidos-market");
    }

    pantalla.innerHTML = `
    <div class="caja pmk-shell">
        <div class="pmk-cabecera">
            <h2>Pedidos de Nexo Market</h2>
            <button type="button" class="pmk-btn-secundario" id="pmkBotonPush" onclick="pmkActivarNotificacionesPush()">🔕 Activar notificaciones push</button>
        </div>
        <div class="pmk-contadores" id="pmkContadores"></div>
        <div class="pmk-tabs" id="pmkTabs"></div>
        <div class="pmk-lista" id="pmkLista"><p class="pmk-vacio">Cargando...</p></div>
    </div>
    `;

    pmkActualizarEstadoBotonPush();
    await cargarPedidosMarket();
}

async function cargarPedidosMarket() {
    try {
        const respuesta = await fetch("/negocio-actual/pedidos-market");
        const datos = await respuesta.json();
        pedidosMarketCache = datos.ok ? datos.pedidos : [];
    } catch (error) {
        pedidosMarketCache = [];
    }

    renderPedidosMarket();
}

function pmkContarPorGrupo(grupo) {
    const estados = PMK_GRUPOS_ESTADO[grupo];
    return pedidosMarketCache.filter(p => estados.includes(p.estado)).length;
}

function renderPedidosMarket() {
    const contadores = document.getElementById("pmkContadores");
    const tabs = document.getElementById("pmkTabs");
    const lista = document.getElementById("pmkLista");
    if (!contadores || !tabs || !lista) return;

    contadores.innerHTML = `
        <div class="pmk-contador"><span>${pmkContarPorGrupo("nuevos")}</span>Nuevos</div>
        <div class="pmk-contador"><span>${pmkContarPorGrupo("preparando")}</span>Preparando</div>
        <div class="pmk-contador"><span>${pmkContarPorGrupo("listos")}</span>Listos</div>
    `;

    tabs.innerHTML = Object.keys(PMK_GRUPOS_ESTADO).map(grupo => `
        <button type="button" class="pmk-tab ${grupo === pedidosMarketTabActiva ? "activo" : ""}" data-grupo="${grupo}">
            ${PMK_ETIQUETAS_TAB[grupo]} (${pmkContarPorGrupo(grupo)})
        </button>
    `).join("");

    tabs.querySelectorAll("[data-grupo]").forEach(boton => {
        boton.onclick = () => {
            pedidosMarketTabActiva = boton.dataset.grupo;
            renderPedidosMarket();
        };
    });

    const estados = PMK_GRUPOS_ESTADO[pedidosMarketTabActiva];
    const pedidos = pedidosMarketCache.filter(p => estados.includes(p.estado));

    const botonEscanearHtml = pedidosMarketTabActiva === "listos"
        ? `<button type="button" class="pmk-btn-escanear" id="pmkBotonEscanear">📷 Escanear pedido</button>`
        : "";

    if (pedidos.length === 0) {
        lista.innerHTML = `${botonEscanearHtml}<p class="pmk-vacio">No hay pedidos en "${PMK_ETIQUETAS_TAB[pedidosMarketTabActiva]}".</p>`;
    } else {
        lista.innerHTML = botonEscanearHtml + pedidos.map(pmkTarjetaPedidoHtml).join("");
    }

    lista.querySelectorAll("[data-accion-pedido]").forEach(boton => {
        boton.onclick = () => pmkEjecutarAccion(Number(boton.dataset.pedidoId), boton.dataset.accionPedido);
    });

    lista.querySelectorAll("[data-ver-detalle-pedido]").forEach(boton => {
        boton.onclick = () => pmkVerDetallePedido(Number(boton.dataset.verDetallePedido));
    });

    lista.querySelectorAll("[data-contactar-pedido]").forEach(boton => {
        boton.onclick = () => pmkContactarCliente(Number(boton.dataset.contactarPedido));
    });

    document.getElementById("pmkBotonEscanear")?.addEventListener("click", pmkAbrirEscaneo);
}

function pmkFormatoHora(fecha) {
    if (!fecha) return "";
    return new Date(fecha).toLocaleTimeString("es-MX", { hour: "numeric", minute: "2-digit" });
}

function pmkFotoItemHtml(item) {
    return item.fotoUrl
        ? `<img src="${item.fotoUrl}" alt="" class="pmk-item-foto">`
        : `<span class="pmk-item-foto pmk-item-foto-vacia">${typeof iconoProducto === "function" ? iconoProducto(item.nombre) : ""}</span>`;
}

function pmkTarjetaPedidoHtml(pedido) {
    const itemsHtml = (pedido.items || []).map(item => {
        const faltante = item.existencia !== null && item.existencia !== undefined && item.existencia < item.cantidad;
        return `<div class="pmk-item ${faltante ? "pmk-item-faltante" : ""}">
            <span class="pmk-item-info">${pmkFotoItemHtml(item)}${escaparPOS(item.nombre)} &times; ${item.cantidad}</span>
            ${faltante ? `<span class="pmk-badge-faltante">Solo hay ${item.existencia}</span>` : ""}
        </div>`;
    }).join("");

    let accionesHtml = "";
    if (pedido.estado === "pendiente") {
        accionesHtml = `
            <button type="button" class="pmk-btn-primario" data-pedido-id="${pedido.id}" data-accion-pedido="aceptar">Aceptar</button>
            <button type="button" class="pmk-btn-secundario" data-pedido-id="${pedido.id}" data-accion-pedido="rechazar">Rechazar</button>
        `;
    } else if (pedido.estado === "confirmado" || pedido.estado === "preparando") {
        accionesHtml = `
            <button type="button" class="pmk-btn-primario" data-pedido-id="${pedido.id}" data-accion-pedido="marcar_listo">Marcar como listo</button>
            <button type="button" class="pmk-btn-secundario" data-pedido-id="${pedido.id}" data-accion-pedido="cancelar">Cancelar</button>
        `;
    } else if (pedido.estado === "listo") {
        accionesHtml = `
            <button type="button" class="pmk-btn-primario" data-pedido-id="${pedido.id}" data-accion-pedido="entregar">Confirmar entrega</button>
            <button type="button" class="pmk-btn-secundario" data-pedido-id="${pedido.id}" data-accion-pedido="cancelar">Cancelar</button>
        `;
    }

    const recogida = pedido.recogidaEstimadaDesde && pedido.recogidaEstimadaHasta
        ? `<div class="pmk-recogida">Recogida estimada: ${pmkFormatoHora(pedido.recogidaEstimadaDesde)} - ${pmkFormatoHora(pedido.recogidaEstimadaHasta)}</div>`
        : "";

    const motivo = pedido.estado === "cancelado" && pedido.motivoCancelacion
        ? `<div class="pmk-motivo">Motivo: ${escaparPOS(pedido.motivoCancelacion)}</div>`
        : "";

    return `
    <div class="pmk-tarjeta">
        <div class="pmk-tarjeta-cabecera">
            <div>
                <strong>${escaparPOS(pedido.clienteNombre)}</strong>
                <span class="pmk-codigo">${escaparPOS(pedido.codigoRecogida)}</span>
            </div>
            <div class="pmk-total">${dinero(pedido.total || 0)}</div>
        </div>
        <div class="pmk-tarjeta-contacto">${escaparPOS(pedido.clienteTelefono || "")}</div>
        <div class="pmk-items">${itemsHtml}</div>
        ${recogida}
        ${motivo}
        <div class="pmk-tarjeta-acciones">
            <button type="button" class="pmk-btn-secundario" data-ver-detalle-pedido="${pedido.id}">Ver detalles</button>
            ${pedido.clienteTelefono ? `<button type="button" class="pmk-btn-secundario" data-contactar-pedido="${pedido.id}">Contactar cliente</button>` : ""}
            ${accionesHtml}
        </div>
    </div>
    `;
}

function pmkContactarCliente(pedidoId) {
    const pedido = pedidosMarketCache.find(p => p.id === pedidoId);
    if (!pedido || !pedido.clienteTelefono) return;

    const telefono = String(pedido.clienteTelefono).replace(/\D/g, "");
    const mensaje = `Hola ${pedido.clienteNombre || ""}, te escribimos por tu pedido ${pedido.codigoRecogida}.`;
    window.open(`https://wa.me/${telefono}?text=${encodeURIComponent(mensaje)}`, "_blank", "noopener");
}

function pmkDatoDetalleHtml(etiqueta, valor) {
    if (!valor) return "";
    return `<div class="pmk-detalle-dato"><span class="pmk-detalle-dato-etiqueta">${etiqueta}</span><span>${escaparPOS(valor)}</span></div>`;
}

function pmkItemDetalleHtml(item) {
    const faltante = item.existencia !== null && item.existencia !== undefined && item.existencia < item.cantidad;
    return `
    <div class="pmk-detalle-item">
        <div class="pmk-detalle-item-foto">
            ${item.fotoUrl ? `<img src="${item.fotoUrl}" alt="">` : `<span class="pmk-detalle-item-foto-vacia">${typeof iconoProducto === "function" ? iconoProducto(item.nombre) : ""}</span>`}
        </div>
        <div class="pmk-detalle-item-info">
            <strong>${escaparPOS(item.nombre)}</strong>
            <div class="pmk-detalle-item-cantidad">Cantidad: ${item.cantidad}${faltante ? ` -- <span class="pmk-badge-faltante">Solo hay ${item.existencia}</span>` : ""}</div>
            <div class="pmk-detalle-grid">
                ${pmkDatoDetalleHtml("Código", item.codigo)}
                ${pmkDatoDetalleHtml("Marca", item.marca)}
                ${pmkDatoDetalleHtml("Categoría", item.categoria)}
                ${pmkDatoDetalleHtml("Subcategoría", item.subcategoria)}
                ${pmkDatoDetalleHtml("Ubicación", item.ubicacion)}
            </div>
            ${item.descripcion ? `<p class="pmk-detalle-item-descripcion">${escaparPOS(item.descripcion)}</p>` : ""}
        </div>
    </div>
    `;
}

function pmkVerDetallePedido(pedidoId) {
    const pedido = pedidosMarketCache.find(p => p.id === pedidoId);
    if (!pedido) return;

    let modal = document.getElementById("modalDetallePedidoMarket");
    if (!modal) {
        modal = document.createElement("div");
        modal.id = "modalDetallePedidoMarket";
        modal.className = "modal-personalizado pmk-modal-detalle";
        document.body.appendChild(modal);
    }

    function cerrar() {
        document.removeEventListener("keydown", alEscape, { capture: true });
        modal.style.display = "none";
        modal.innerHTML = "";
    }

    function alEscape(evento) {
        if (evento.key === "Escape") cerrar();
    }

    modal.innerHTML = `
        <div class="pmk-detalle-caja">
            <div class="pmk-detalle-cabecera">
                <div>
                    <h3>Pedido ${escaparPOS(pedido.codigoRecogida)}</h3>
                    <p class="pmk-detalle-cliente">${escaparPOS(pedido.clienteNombre)} -- ${escaparPOS(pedido.clienteTelefono || "")}${pedido.clienteCorreo ? ` -- ${escaparPOS(pedido.clienteCorreo)}` : ""}</p>
                </div>
                <button type="button" class="pmk-detalle-cerrar" id="pmkDetalleCerrarBoton">&times;</button>
            </div>
            <div class="pmk-detalle-items">${(pedido.items || []).map(pmkItemDetalleHtml).join("")}</div>
            <div class="pmk-detalle-total">Total: ${dinero(pedido.total || 0)}</div>
            <div class="pmk-tarjeta-acciones">
                ${pedido.clienteTelefono ? `<button type="button" class="pmk-btn-secundario" id="pmkDetalleContactarBoton">Contactar cliente</button>` : ""}
            </div>
        </div>
    `;

    modal.style.display = "flex";
    document.addEventListener("keydown", alEscape, { capture: true });
    modal.addEventListener("click", evento => { if (evento.target === modal) cerrar(); });
    document.getElementById("pmkDetalleCerrarBoton").onclick = cerrar;
    document.getElementById("pmkDetalleContactarBoton")?.addEventListener("click", () => pmkContactarCliente(pedidoId));
}

async function pmkEjecutarAccion(pedidoId, accion) {
    let motivo = null;

    if (accion === "rechazar" || accion === "cancelar") {
        motivo = await dialogoPOS({
            tipo: "alerta",
            titulo: accion === "rechazar" ? "Rechazar pedido" : "Cancelar pedido",
            mensaje: "Puedes escribir un motivo (opcional) para avisarle al cliente.",
            entrada: true,
            placeholder: "Motivo (opcional)",
            mostrarCancelar: true,
            textoAceptar: "Confirmar"
        });
        if (motivo === null) return;
    } else if (accion === "entregar") {
        const confirmado = await confirmarPOS("¿Confirmas que el cliente ya recogio este pedido?", "Confirmar entrega", "alerta");
        if (!confirmado) return;
    }

    try {
        const respuesta = await fetch(`/negocio-actual/pedidos-market/${pedidoId}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ accion, motivo: motivo || undefined })
        });
        const datos = await respuesta.json();

        if (!datos.ok) {
            await alertaPOS(datos.error || "No se pudo actualizar el pedido.", "Error", "peligro");
            return;
        }

        await cargarPedidosMarket();
    } catch (error) {
        await alertaPOS("No se pudo actualizar el pedido. Intenta de nuevo.", "Error", "peligro");
    }
}

// ---------------------------------------------------------------------
// Escaneo por camara (QR o codigo de barras) -- vendorizado localmente
// en public/js/vendor/zxing-browser.min.js (@zxing/browser, sin CDN)
// en vez de BarcodeDetector nativo: tambien funciona en Safari/iPhone,
// no solo Chrome/Android. Se carga solo cuando el cajero abre el
// escaneo (no en cada carga del POS) porque el bundle pesa ~400KB.
//
// El QR codifica la URL completa de seguimiento
// (https://nexoposoficial.com/market/pedido/{codigo}); el codigo de
// barras codifica solo el codigo corto. pmkExtraerCodigoEscaneado
// entiende ambos. Escanear solo VERIFICA el pedido -- la entrega real
// se confirma aparte, con el boton "Confirmar entrega" de la pantalla
// de verificacion (nunca se entrega automatico solo por leer el
// codigo).

let pmkZxingCargando = null;
let pmkLectorActivo = null;
let pmkControlesEscaneo = null;

function pmkCargarZxing() {
    if (window.ZXingBrowser) return Promise.resolve();
    if (pmkZxingCargando) return pmkZxingCargando;

    pmkZxingCargando = new Promise((resolve, reject) => {
        const script = document.createElement("script");
        script.src = "js/vendor/zxing-browser.min.js";
        script.onload = () => resolve();
        script.onerror = () => reject(new Error("No se pudo cargar el lector de codigos"));
        document.body.appendChild(script);
    });

    return pmkZxingCargando;
}

function pmkExtraerCodigoEscaneado(texto) {
    const limpio = String(texto || "").trim();
    if (!limpio) return "";

    try {
        const url = new URL(limpio);
        const segmentos = url.pathname.split("/").filter(Boolean);
        return decodeURIComponent(segmentos[segmentos.length - 1] || "");
    } catch (error) {
        return limpio;
    }
}

function pmkDetenerEscaneo() {
    if (pmkControlesEscaneo) {
        try { pmkControlesEscaneo.stop(); } catch (error) { /* nada que hacer */ }
        pmkControlesEscaneo = null;
    }
    pmkLectorActivo = null;
}

async function pmkAbrirEscaneo() {
    let modal = document.getElementById("modalEscaneoPedidoMarket");
    if (!modal) {
        modal = document.createElement("div");
        modal.id = "modalEscaneoPedidoMarket";
        modal.className = "modal-personalizado pmk-modal-escaneo";
        document.body.appendChild(modal);
    }

    function cerrar() {
        pmkDetenerEscaneo();
        document.removeEventListener("keydown", alEscape, { capture: true });
        modal.style.display = "none";
        modal.innerHTML = "";
    }

    function alEscape(evento) {
        if (evento.key === "Escape") cerrar();
    }

    modal.innerHTML = `
        <div class="pmk-escaneo-caja">
            <h3>Escanear pedido</h3>
            <p class="pmk-escaneo-ayuda">Apunta la camara al codigo QR o de barras del pedido.</p>
            <video id="pmkVideoEscaneo" class="pmk-escaneo-video" autoplay muted playsinline></video>
            <div id="pmkEscaneoEstado" class="pmk-escaneo-estado">Cargando lector...</div>
            <button type="button" class="pmk-btn-secundario" id="pmkCancelarEscaneo">Cancelar</button>
        </div>
    `;

    modal.style.display = "flex";
    document.addEventListener("keydown", alEscape, { capture: true });
    document.getElementById("pmkCancelarEscaneo").onclick = cerrar;

    const estado = document.getElementById("pmkEscaneoEstado");

    try {
        await pmkCargarZxing();
    } catch (error) {
        estado.textContent = "No se pudo cargar el lector de codigos. Intenta de nuevo.";
        return;
    }

    if (!modal.isConnected || modal.style.display === "none") return;

    estado.textContent = "Abriendo camara...";

    try {
        const video = document.getElementById("pmkVideoEscaneo");
        pmkLectorActivo = new window.ZXingBrowser.BrowserMultiFormatReader();

        pmkControlesEscaneo = await pmkLectorActivo.decodeFromVideoDevice(undefined, video, (resultado, error, controles) => {
            if (!resultado) return;

            const codigo = pmkExtraerCodigoEscaneado(resultado.getText());
            if (!codigo) return;

            controles.stop();
            pmkControlesEscaneo = null;
            cerrar();
            pmkVerificarCodigoEscaneado(codigo);
        });

        estado.textContent = "Buscando codigo...";
    } catch (error) {
        estado.textContent = "No se pudo abrir la camara. Revisa los permisos del navegador.";
    }
}

async function pmkVerificarCodigoEscaneado(codigo) {
    try {
        const respuesta = await fetch("/negocio-actual/pedidos-market/escanear", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ codigo })
        });
        const datos = await respuesta.json();

        if (!datos.ok) {
            await alertaPOS(datos.error || "No se pudo verificar el pedido.", "Codigo no valido", "peligro");
            return;
        }

        pmkMostrarVerificacionEntrega(datos.pedido);
    } catch (error) {
        await alertaPOS("No se pudo verificar el pedido. Intenta de nuevo.", "Error", "peligro");
    }
}

function pmkMostrarVerificacionEntrega(pedido) {
    let modal = document.getElementById("modalVerificacionEntregaMarket");
    if (!modal) {
        modal = document.createElement("div");
        modal.id = "modalVerificacionEntregaMarket";
        modal.className = "modal-personalizado pmk-modal-verificacion";
        document.body.appendChild(modal);
    }

    function cerrar() {
        document.removeEventListener("keydown", alEscape, { capture: true });
        modal.style.display = "none";
        modal.innerHTML = "";
    }

    function alEscape(evento) {
        if (evento.key === "Escape") cerrar();
    }

    const itemsHtml = (pedido.items || [])
        .map(item => `<div class="pmk-item"><span class="pmk-item-info">${pmkFotoItemHtml(item)}${escaparPOS(item.nombre)} &times; ${item.cantidad}</span></div>`)
        .join("");

    modal.innerHTML = `
        <div class="pmk-verificacion-caja">
            <h3>Verificar entrega</h3>
            <div class="pmk-codigo">${escaparPOS(pedido.codigoRecogida)}</div>
            <p class="pmk-verificacion-cliente"><strong>${escaparPOS(pedido.clienteNombre)}</strong> -- ${escaparPOS(pedido.clienteTelefono || "")}</p>
            <div class="pmk-items">${itemsHtml}</div>
            <div class="pmk-total">${dinero(pedido.total || 0)}</div>
            <p class="pmk-verificacion-pregunta">¿Confirmas que el cliente ya recogio este pedido?</p>
            <div class="pmk-tarjeta-acciones">
                <button type="button" class="pmk-btn-primario" id="pmkConfirmarEntregaBoton">Confirmar entrega</button>
                <button type="button" class="pmk-btn-secundario" id="pmkCancelarVerificacion">Cancelar</button>
            </div>
        </div>
    `;

    modal.style.display = "flex";
    document.addEventListener("keydown", alEscape, { capture: true });
    document.getElementById("pmkCancelarVerificacion").onclick = cerrar;
    document.getElementById("pmkConfirmarEntregaBoton").onclick = async () => {
        try {
            const respuesta = await fetch(`/negocio-actual/pedidos-market/${pedido.id}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ accion: "entregar" })
            });
            const datos = await respuesta.json();

            if (!datos.ok) {
                await alertaPOS(datos.error || "No se pudo confirmar la entrega.", "Error", "peligro");
                return;
            }

            cerrar();
            await alertaPOS("Pedido entregado correctamente.", "Listo", "exito");
            await cargarPedidosMarket();
        } catch (error) {
            await alertaPOS("No se pudo confirmar la entrega. Intenta de nuevo.", "Error", "peligro");
        }
    };
}
