/* Pedidos en el celular (abarrotes): una sola puerta con tres tarjetas -- Crear pedido, Sugerir pedido y Pedidos hechos.
   - Crear pedido: la misma pantalla de marcas y productos de "Recibir por marca", en modo pedido (dueno-recibir-marca.js).
   - Sugerir pedido: el "Pedido" de Mi tienda (dueno-tienda.js).
   - Pedidos hechos: la lista de pedidos a proveedor guardados, con su detalle.
   Es una funcion nueva: el boton "Pedidos" solo aparece en Inventario si el dueño la enciende (funciones nuevas -> pedidos_unico). */

(function () {
    const esc = valor => (typeof escaparDueno === "function" ? escaparDueno(valor) : String(valor ?? ""));
    const dinero = n => "$" + Number(n || 0).toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const numero = n => Number(n || 0).toLocaleString("es-MX", { maximumFractionDigits: 3 });
    const ESTADOS = { borrador: "Sin enviar", enviado: "Enviado", parcial: "Recibido en parte", recibido: "Recibido", cancelado: "Cancelado" };

    function capa() {
        let c = document.getElementById("dpeCapa");
        if (!c) { c = document.createElement("div"); c.id = "dpeCapa"; c.className = "dpe-capa"; document.body.appendChild(c); }
        return c;
    }

    function cabeza(titulo, atras) {
        return `<header class="dpe-cabeza"><button type="button" class="dpe-atras" onclick="${atras}">‹ Atrás</button><h2>${esc(titulo)}</h2></header>`;
    }

    function tarjeta(accion, icono, titulo, texto, id) {
        return `<button type="button" class="dpe-tarjeta" onclick="${accion}"><span class="dpe-icono" aria-hidden="true">${icono}</span><span class="dpe-texto"><b>${esc(titulo)}</b><small${id ? ` id="${id}"` : ""}>${esc(texto)}</small></span></button>`;
    }

    async function listaPedidos() {
        try {
            const r = await fetchAutenticado("/pedidos-proveedor");
            return Array.isArray(r && r.pedidos) ? r.pedidos : [];
        } catch (error) { return []; }
    }

    function textoHechos(lista) {
        if (!lista.length) return "Aquí quedan los pedidos que guardes";
        const borradores = lista.filter(p => p.estado === "borrador").length;
        const porRecibir = lista.filter(p => p.estado === "enviado" || p.estado === "parcial").length;
        const partes = [];
        if (borradores) partes.push(`${borradores} sin enviar`);
        if (porRecibir) partes.push(`${porRecibir} por recibir`);
        return partes.length ? partes.join(" · ") : `${lista.length} guardado${lista.length === 1 ? "" : "s"}`;
    }

    async function encargosEsperando() {
        try {
            const r = await fetchAutenticado("/encargos-clientes");
            return ((r && r.encargos) || []).filter(e => e.estado === "pendiente" || e.estado === "resurtiendo").length;
        } catch (error) { return 0; }
    }

    window.verEncargosDesdePedidosDueno = function () {
        window.cerrarPedidosDueno();
        if (typeof abrirSubpantallaMasDueno === "function") abrirSubpantallaMasDueno("encargos-gestion");
    };

    window.abrirPedidosDueno = async function () {
        const c = capa();
        c.innerHTML = `${cabeza("Pedidos", "cerrarPedidosDueno()")}
            <div class="dpe-cuerpo"><p class="dpe-nota">Elige qué quieres hacer.</p>
            ${tarjeta("crearPedidoDueno()", "＋", "Crear pedido", "Elige la marca y anota cuánto quieres")}
            ${tarjeta("sugerirPedidoDueno()", "✦", "Sugerir pedido", "Pon mínimo y máximo y Nexo calcula lo que falta")}
            ${tarjeta("abrirPedidosHechosDueno()", "☰", "Pedidos hechos", "Cargando…", "dpeHechos")}
            <button type="button" class="dpe-enlace" onclick="calculoPorVentasDueno()">Ver el cálculo por ventas (Mi tienda)</button></div>`;
        c.classList.add("abierta");
        document.body.classList.add("dpe-abierta");

        encargosEsperando().then(n => {
            const cuerpo = document.querySelector("#dpeCapa .dpe-cuerpo");
            if (!n || !cuerpo || !document.getElementById("dpeHechos")) return;
            cuerpo.insertAdjacentHTML("beforeend", `<button type="button" class="dpe-aviso" onclick="verEncargosDesdePedidosDueno()">Tienes <b>${n} encargo${n === 1 ? "" : "s"}</b> de clientes esperando mercancía. Ver encargos ›</button>`);
        });

        const lista = await listaPedidos();
        const caja = document.getElementById("dpeHechos");
        if (caja) caja.textContent = textoHechos(lista);
    };

    window.cerrarPedidosDueno = function () {
        document.getElementById("dpeCapa")?.classList.remove("abierta");
        document.body.classList.remove("dpe-abierta");
    };

    window.crearPedidoDueno = function () {
        window.__drmModo = "pedido";
        if (typeof abrirRecibirMarcaDueno === "function") abrirRecibirMarcaDueno();
    };

    window.sugerirPedidoDueno = function () {
        window.__drmModo = "sugerir";
        if (typeof abrirRecibirMarcaDueno === "function") abrirRecibirMarcaDueno();
    };

    // El cálculo de siempre (con tus ventas y el día de visita de cada proveedor), en Mi tienda.
    window.calculoPorVentasDueno = function () {
        window.cerrarPedidosDueno();
        if (typeof abrirTienda === "function") abrirTienda("pedido");
    };

    window.abrirPedidosHechosDueno = async function () {
        const c = capa();
        c.innerHTML = `${cabeza("Pedidos hechos", "abrirPedidosDueno()")}<div class="dpe-cuerpo"><p class="dpe-nota">Cargando…</p></div>`;
        c.classList.add("abierta");
        document.body.classList.add("dpe-abierta");

        const lista = await listaPedidos();
        const cuerpo = c.querySelector(".dpe-cuerpo");
        if (!cuerpo) return;

        cuerpo.innerHTML = lista.length
            ? lista.map(p => {
                const fecha = new Date(p.created_at);
                const cuando = Number.isNaN(fecha.getTime()) ? "" : fecha.toLocaleDateString("es-MX", { day: "numeric", month: "short" });
                return `<button type="button" class="dpe-pedido" onclick="verPedidoDueno(${Number(p.id)})">
                    <span class="dpe-pedido-datos"><b>${esc(p.proveedor || "Sin proveedor")}</b><small>#${Number(p.id)} · ${esc(cuando)} · ${numero(p.piezas)} pieza${Number(p.piezas) === 1 ? "" : "s"}</small></span>
                    <span class="dpe-pedido-der"><em class="dpe-estado dpe-${esc(p.estado)}">${esc(ESTADOS[p.estado] || p.estado)}</em>${Number(p.total_estimado) > 0 ? `<strong>${dinero(p.total_estimado)}</strong>` : ""}</span>
                </button>`;
            }).join("")
            : `<p class="dpe-nota">Todavía no hay pedidos. Toca “Crear pedido” para hacer el primero.</p>`;
    };

    window.verPedidoDueno = async function (id) {
        const c = capa();
        c.innerHTML = `${cabeza("Pedido #" + Number(id), "abrirPedidosHechosDueno()")}<div class="dpe-cuerpo"><p class="dpe-nota">Cargando…</p></div>`;

        let datos = null;
        try { datos = await fetchAutenticado("/pedidos-proveedor/" + Number(id)); } catch (error) { datos = null; }
        const cuerpo = c.querySelector(".dpe-cuerpo");
        if (!cuerpo) return;

        if (!datos || !datos.pedido) { cuerpo.innerHTML = `<p class="dpe-nota">No se pudo abrir el pedido.</p>`; return; }

        const p = datos.pedido;
        const items = datos.items || [];
        cuerpo.innerHTML = `<div class="dpe-resumen"><b>${esc(p.proveedor || "Sin proveedor")}</b><em class="dpe-estado dpe-${esc(p.estado)}">${esc(ESTADOS[p.estado] || p.estado)}</em></div>
            <ul class="dpe-items">${items.map(i => `<li><span>${esc(i.nombre)}</span><b>${numero(i.cantidad)}${Number(i.recibido) > 0 ? ` <small>(llegaron ${numero(i.recibido)})</small>` : ""}</b></li>`).join("") || `<li>Sin productos.</li>`}</ul>
            ${Number(p.total_estimado) > 0 ? `<p class="dpe-total">Total estimado <strong>${dinero(p.total_estimado)}</strong></p>` : ""}
            <p class="dpe-nota">Para recibir este pedido o cambiarlo, ábrelo en la computadora.</p>`;
    };

    // Boton junto a "Recibir por marca" en Inventario (solo si la funcion esta encendida).
    async function ponerBoton() {
        const anterior = document.getElementById("drmBoton") || document.querySelector('#duenoInventario button[onclick="abrirRecepcionDueno()"]');
        if (!anterior || document.getElementById("dpeBoton")) return;

        let activa = false;
        try { activa = (await fetchAutenticado("/funciones-beta"))?.funciones?.pedidos_unico === true; } catch (error) { activa = false; }
        if (!activa || document.getElementById("dpeBoton")) return;

        const boton = document.createElement("button");
        boton.id = "dpeBoton";
        boton.type = "button";
        boton.className = anterior.className;
        boton.textContent = "Pedidos";
        boton.addEventListener("click", () => window.abrirPedidosDueno());
        anterior.insertAdjacentElement("afterend", boton);
    }

    ponerBoton();
})();
