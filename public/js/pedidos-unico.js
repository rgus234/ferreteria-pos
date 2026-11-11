// Pedidos (abarrotes): una sola puerta con tres tarjetas grandes -- Crear pedido, Sugerir pedido y Pedidos hechos.
//  - Crear pedido: la misma pantalla de marcas y productos de "Recibir mercancia", pero lo que anotas se guarda como pedido (recibir-marca-view.js, modo pedido).
//  - Sugerir pedido: lo que Nexo calcula con tus ventas (pedido-sugerido.js).
//  - Pedidos hechos: la lista de pedidos guardados, aqui mismo (sin salir de Pedidos), con su detalle y el boton Recibir.
// Es una funcion nueva: solo aparece si el dueño la enciende en Nexo -> Funciones nuevas (funcionBeta("pedidos_unico")).
(function () {
    const esc = valor => String(valor ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

    // Encargos de clientes que siguen esperando mercancia (pendientes o ya pedidos al proveedor).
    async function encargosEsperando() {
        try {
            const r = await fetch("/encargos-clientes");
            const datos = await r.json().catch(() => ({}));
            return (Array.isArray(datos.encargos) ? datos.encargos : []).filter(e => e.estado === "pendiente" || e.estado === "resurtiendo").length;
        } catch (error) {
            return 0;
        }
    }

    async function resumenPedidos() {
        try {
            const r = await fetch("/pedidos-proveedor");
            const datos = await r.json().catch(() => ({}));
            const lista = Array.isArray(datos.pedidos) ? datos.pedidos : [];
            return {
                borradores: lista.filter(p => p.estado === "borrador").length,
                porRecibir: lista.filter(p => p.estado === "enviado" || p.estado === "parcial").length,
                total: lista.length
            };
        } catch (error) {
            return null;
        }
    }

    function textoHechos(r) {
        if (!r || !r.total) return "Aquí quedan los pedidos que guardes";
        const partes = [];
        if (r.borradores) partes.push(`${r.borradores} sin enviar`);
        if (r.porRecibir) partes.push(`${r.porRecibir} por recibir`);
        return partes.length ? partes.join(" · ") : `${r.total} guardado${r.total === 1 ? "" : "s"}`;
    }

    function tarjeta(accion, icono, titulo, texto, id) {
        return `<button type="button" class="pu-tarjeta" onclick="${accion}">
            <span class="pu-icono" aria-hidden="true">${icono}</span>
            <b>${esc(titulo)}</b>
            <small${id ? ` id="${id}"` : ""}>${esc(texto)}</small>
        </button>`;
    }

    window.mostrarPedidosUnico = async function () {
        if (typeof ocultarPantallasPrincipales === "function") ocultarPantallasPrincipales();
        const pantalla = document.getElementById("pantallaPedidosUnico");
        if (!pantalla) return;
        pantalla.style.display = "block";
        if (typeof actualizarTopbarContexto === "function") actualizarTopbarContexto("Pedidos", "Lo que le pides a tus proveedores", "pedidos-unico");

        pantalla.innerHTML = `<div class="pu-shell">
            <header class="pu-cab"><h2>Pedidos</h2><p>Elige qué quieres hacer.</p></header>
            <div class="pu-tarjetas">
                ${tarjeta("mostrarCrearPedido()", "＋", "Crear pedido", "Elige la marca y anota cuánto quieres de cada producto")}
                ${tarjeta("mostrarSugerirPedido()", "✦", "Sugerir pedido", "Nexo te dice qué conviene pedir")}
                ${tarjeta("mostrarPedidosHechos()", "☰", "Pedidos hechos", "Cargando…", "puHechos")}
            </div>
            <p class="pu-aviso" id="puEncargos" hidden></p>
        </div>`;

        encargosEsperando().then(n => {
            const caja = document.getElementById("puEncargos");
            if (!caja || !n) return;
            caja.innerHTML = `Tienes <b>${n} encargo${n === 1 ? "" : "s"}</b> de clientes esperando mercancía. <button type="button" onclick="mostrarEncargos()">Ver encargos</button>`;
            caja.hidden = false;
        });

        const r = await resumenPedidos();
        const caja = document.getElementById("puHechos");
        if (caja) caja.textContent = textoHechos(r);
    };

    window.mostrarCrearPedido = function () {
        window.__rmModo = "pedido";
        if (typeof mostrarRecibirMarca === "function") mostrarRecibirMarca();
    };

    // Sugerir pedido: la pantalla de marcas y productos en modo "sugerir" (minimo y maximo por producto; Nexo calcula lo que falta).
    window.mostrarSugerirPedido = function () {
        window.__rmModo = "sugerir";
        if (typeof mostrarRecibirMarca === "function") mostrarRecibirMarca();
    };

    // ---------- Pedidos hechos: lista y detalle dentro de Pedidos (el "atras" siempre regresa a las tres tarjetas) ----------

    const ESTADOS = { borrador: "Sin enviar", enviado: "Enviado", parcial: "Parcial", recibido: "Recibido", cancelado: "Cancelado" };
    const dinero = valor => "$" + Number(valor || 0).toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const cant = valor => Number(valor || 0).toLocaleString("es-MX", { maximumFractionDigits: 3 });
    const fecha = valor => { const d = new Date(valor); return isNaN(d) ? "" : d.toLocaleDateString("es-MX", { day: "numeric", month: "short", year: "numeric" }); };
    const porRecibir = p => p.estado === "enviado" || p.estado === "parcial" || p.estado === "borrador";

    let hechos = { lista: [], filtro: "pendientes" };

    function pantallaPedidos(titulo, subtitulo) {
        if (typeof ocultarPantallasPrincipales === "function") ocultarPantallasPrincipales();
        const pantalla = document.getElementById("pantallaPedidosUnico");
        if (!pantalla) return null;
        pantalla.style.display = "block";
        if (typeof actualizarTopbarContexto === "function") actualizarTopbarContexto(titulo, subtitulo, "pedidos-unico");
        return pantalla;
    }

    window.mostrarPedidosHechos = async function () {
        const pantalla = pantallaPedidos("Pedidos hechos", "Lo que ya pediste a tus proveedores");
        if (!pantalla) return;
        pantalla.innerHTML = `<div class="pu-shell"><button type="button" class="pu-atras" onclick="mostrarPedidosUnico()">← Pedidos</button><p class="pu-vacio">Cargando…</p></div>`;

        try {
            const r = await fetch("/pedidos-proveedor");
            const datos = await r.json().catch(() => ({}));
            hechos.lista = r.ok && Array.isArray(datos.pedidos) ? datos.pedidos : [];
        } catch (error) {
            hechos.lista = [];
        }

        if (hechos.filtro === "pendientes" && !hechos.lista.some(porRecibir)) hechos.filtro = "todos";
        pintarHechos();
    };

    window.puFiltroHechos = function (filtro) { hechos.filtro = filtro; pintarHechos(); };

    function pintarHechos() {
        const pantalla = document.getElementById("pantallaPedidosUnico");
        if (!pantalla) return;

        const pendientes = hechos.lista.filter(porRecibir);
        const visibles = hechos.filtro === "pendientes" ? pendientes : hechos.lista;

        pantalla.innerHTML = `<div class="pu-shell">
            <button type="button" class="pu-atras" onclick="mostrarPedidosUnico()">← Pedidos</button>
            <header class="pu-cab"><h2>Pedidos hechos</h2><p>Toca un pedido para ver qué falta. Cuando llegue la mercancía, usa Recibir.</p></header>
            <div class="pu-filtros">
                <button type="button" class="${hechos.filtro === "pendientes" ? "activo" : ""}" onclick="puFiltroHechos('pendientes')">Por recibir (${pendientes.length})</button>
                <button type="button" class="${hechos.filtro === "todos" ? "activo" : ""}" onclick="puFiltroHechos('todos')">Todos (${hechos.lista.length})</button>
            </div>
            <div class="pu-lista">${visibles.length ? visibles.map(tarjetaPedido).join("") : `<p class="pu-vacio">${hechos.lista.length ? "No tienes pedidos por recibir." : "Todavía no hay pedidos. Crea uno desde Pedidos."}</p>`}</div>
        </div>`;
    }

    function tarjetaPedido(p) {
        const piezas = Number(p.piezas || 0);
        const recibido = Number(p.recibido || 0);
        const avance = piezas > 0 ? Math.min(100, Math.round(recibido / piezas * 100)) : 0;

        return `<article class="pu-pedido" onclick="puVerPedido(${Number(p.id)})">
            <div class="pu-pedido-datos">
                <b>#${Number(p.id)} · ${esc(p.proveedor || "Sin proveedor")}</b>
                <small>${esc(fecha(p.created_at))} · ${cant(p.partidas)} producto${Number(p.partidas) === 1 ? "" : "s"} · ${cant(piezas)} piezas · ${dinero(p.total_estimado)}</small>
                ${p.estado === "parcial" ? `<div class="pu-barra" title="${avance}% recibido"><i style="width:${avance}%"></i></div><small>Llegó ${cant(recibido)} de ${cant(piezas)} piezas</small>` : ""}
            </div>
            <div class="pu-pedido-acciones">
                <span class="pu-estado ${esc(p.estado)}">${esc(ESTADOS[p.estado] || p.estado)}</span>
                ${porRecibir(p) ? `<button type="button" class="pu-recibir" onclick="event.stopPropagation();puRecibirPedido(${Number(p.id)})">Recibir</button>` : ""}
            </div>
        </article>`;
    }

    window.puRecibirPedido = function (id) {
        window.__rmPedidoId = Number(id);
        window.__rmModo = null;
        if (typeof mostrarRecibirMarca === "function") mostrarRecibirMarca();
    };

    window.puVerPedido = async function (id) {
        const pantalla = pantallaPedidos("Pedido #" + Number(id), "Lo que pediste y lo que ya llegó");
        if (!pantalla) return;
        pantalla.innerHTML = `<div class="pu-shell"><button type="button" class="pu-atras" onclick="mostrarPedidosHechos()">← Pedidos hechos</button><p class="pu-vacio">Cargando…</p></div>`;

        let datos = {};

        try {
            const r = await fetch("/pedidos-proveedor/" + Number(id));
            datos = await r.json().catch(() => ({}));
            if (!r.ok) datos = {};
        } catch (error) {
            datos = {};
        }

        const p = datos.pedido;

        if (!p) {
            pantalla.innerHTML = `<div class="pu-shell"><button type="button" class="pu-atras" onclick="mostrarPedidosHechos()">← Pedidos hechos</button><p class="pu-vacio">No se pudo abrir el pedido.</p></div>`;
            return;
        }

        const items = datos.items || [];
        const filas = items.map(i => {
            const pedido = Number(i.cantidad || 0);
            const llego = Number(i.recibido || 0);
            const falta = Math.max(0, pedido - llego);
            return `<tr><td><b>${esc(i.nombre)}</b>${i.codigo ? `<small>${esc(i.codigo)}</small>` : ""}</td><td>${cant(pedido)}</td><td>${cant(llego)}</td><td class="${falta > 0 ? "pu-falta" : "pu-completo"}">${falta > 0 ? cant(falta) : "✓"}</td></tr>`;
        }).join("");

        pantalla.innerHTML = `<div class="pu-shell">
            <button type="button" class="pu-atras" onclick="mostrarPedidosHechos()">← Pedidos hechos</button>
            <header class="pu-cab pu-detalle-cab"><div><h2>Pedido #${Number(p.id)} · ${esc(p.proveedor || "Sin proveedor")}</h2><p>${esc(fecha(p.created_at))} · estimado ${dinero(p.total_estimado)}${p.notas ? " · " + esc(p.notas) : ""}</p></div><span class="pu-estado ${esc(p.estado)}">${esc(ESTADOS[p.estado] || p.estado)}</span></header>
            <table class="pu-tabla"><thead><tr><th>Producto</th><th>Pedido</th><th>Llegó</th><th>Falta</th></tr></thead><tbody>${filas}</tbody></table>
            ${porRecibir(p) ? `<div class="pu-pie"><button type="button" class="pu-recibir grande" onclick="puRecibirPedido(${Number(p.id)})">Recibir este pedido</button></div>` : ""}
        </div>`;
    };
})();
