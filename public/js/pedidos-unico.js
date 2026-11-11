// Pedidos (abarrotes): una sola puerta con tres tarjetas grandes -- Crear pedido, Sugerir pedido y Pedidos hechos.
//  - Crear pedido: la misma pantalla de marcas y productos de "Recibir mercancia", pero lo que anotas se guarda como pedido (recibir-marca-view.js, modo pedido).
//  - Sugerir pedido: lo que Nexo calcula con tus ventas (pedido-sugerido.js).
//  - Pedidos hechos: la lista de pedidos guardados (fase4.js).
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

    // La lista de pedidos guardados (la pantalla de siempre de Pedidos a proveedor, sin su formulario de captura).
    window.mostrarPedidosHechos = async function () {
        if (typeof mostrarPedidosProveedor !== "function") return;
        await mostrarPedidosProveedor();
        document.getElementById("pantallaPedidosProveedor")?.classList.add("pu-solo-lista");
    };
})();
