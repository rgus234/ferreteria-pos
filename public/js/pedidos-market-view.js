// Pantalla "Pedidos" del POS -- gestion de pedidos de Nexo Market
// (rediseno de pedidos, ver plan). Separada de "Pedidos recibidos"
// (sitio-web-view.js), que se queda tal cual para cotizaciones y
// pedidos del sitio propio del negocio. Un solo fetch trae TODOS los
// pedidos de Market (hasta 100) y las pestanas/contadores filtran en
// el cliente -- mismo criterio de "barato" que el resto del proyecto,
// sin pedir de nuevo al servidor por cada pestana.

let pedidosMarketCache = [];
let pedidosMarketTabActiva = "nuevos";

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
        <h2>Pedidos de Nexo Market</h2>
        <div class="pmk-contadores" id="pmkContadores"></div>
        <div class="pmk-tabs" id="pmkTabs"></div>
        <div class="pmk-lista" id="pmkLista"><p class="pmk-vacio">Cargando...</p></div>
    </div>
    `;

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

    document.getElementById("pmkBotonEscanear")?.addEventListener("click", pmkAbrirEscaneo);
}

function pmkFormatoHora(fecha) {
    if (!fecha) return "";
    return new Date(fecha).toLocaleTimeString("es-MX", { hour: "numeric", minute: "2-digit" });
}

function pmkTarjetaPedidoHtml(pedido) {
    const itemsHtml = (pedido.items || []).map(item => {
        const faltante = item.existencia !== null && item.existencia !== undefined && item.existencia < item.cantidad;
        return `<div class="pmk-item ${faltante ? "pmk-item-faltante" : ""}">
            <span>${escaparPOS(item.nombre)} &times; ${item.cantidad}</span>
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
        <div class="pmk-tarjeta-acciones">${accionesHtml}</div>
    </div>
    `;
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
        .map(item => `<div class="pmk-item"><span>${escaparPOS(item.nombre)} &times; ${item.cantidad}</span></div>`)
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
