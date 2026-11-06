/* Extras rapidos en la venta (abarrotes): al agregar un producto que tiene extras ("+ Salsa $2"), salen fichas encima del carrito y un
   toque suma el extra. Cada extra es un producto normal, asi que inventario, precio y ticket funcionan como siempre.
   Solo con la funcion nueva "armado" encendida; apagada, la venta no cambia en nada. */

(function () {
    let mapa = {};
    let cargado = false;
    let temporizador = null;
    let fichasIds = new Set(); // los extras que se estan mostrando: agregar uno de ellos no cambia las fichas

    const esc = valor => String(valor ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
    const encendida = () => typeof window.funcionBeta === "function" && window.funcionBeta("armado");

    window.extrasDeProducto = id => mapa[String(id)] || [];

    window.recargarExtrasPOS = async function () {
        if (!encendida()) { mapa = {}; return; }

        try {
            const respuesta = await fetch("/extras");
            const datos = await respuesta.json().catch(() => ({}));
            mapa = datos && datos.extras ? datos.extras : {};
            cargado = true;
        } catch (error) { /* sin conexion: se queda lo ultimo que se sabia */ }
    };

    function quitarFichas() {
        clearTimeout(temporizador);
        fichasIds = new Set();
        document.getElementById("extrasRapidosPOS")?.remove();
    }

    function mostrarFichas(productoId, nombreProducto) {
        quitarFichas();

        const extras = window.extrasDeProducto(productoId);
        // El carrito se vuelve a pintar entero cada vez que cambia (actualizarCarrito): las fichas van ANTES de su contenedor, no dentro.
        const contenedor = document.querySelector(".carrito-items")?.parentElement;

        if (!extras.length || !contenedor || !contenedor.parentElement) return;

        const franja = document.createElement("div");
        franja.id = "extrasRapidosPOS";
        franja.className = "extras-franja";
        franja.setAttribute("role", "group");
        franja.setAttribute("aria-label", `Extras de ${nombreProducto || "este producto"}`);
        franja.innerHTML = `<span class="extras-titulo">Extras</span>
            ${extras.map(e => `<button type="button" data-extra="${e.id}">+ ${esc(e.nombre)} <b>${Number(e.precio) > 0 ? `$${Number(e.precio).toFixed(2).replace(/\.00$/, "")}` : "gratis"}</b></button>`).join("")}
            <button type="button" class="extras-cerrar" aria-label="Quitar los extras">×</button>`;

        contenedor.parentElement.insertBefore(franja, contenedor);
        fichasIds = new Set(extras.map(e => Number(e.id)));

        franja.querySelectorAll("[data-extra]").forEach(boton => {
            boton.onclick = () => {
                if (typeof agregarProductoPorId === "function") agregarProductoPorId(Number(boton.dataset.extra));
                // Se quedan las fichas: "dos salsas" son dos toques.
                clearTimeout(temporizador);
                temporizador = setTimeout(quitarFichas, 15000);
            };
        });

        franja.querySelector(".extras-cerrar").onclick = quitarFichas;
        temporizador = setTimeout(quitarFichas, 15000);
    }

    // Se envuelve agregar(): primero hace lo de siempre y despues, si el producto tiene extras, ofrece las fichas.
    function enganchar() {
        if (typeof window.agregar !== "function" || window.agregar.__conExtras) return;

        const original = window.agregar;

        const conExtras = function (id) {
            const resultado = original.apply(this, arguments);

            try {
                if (encendida() && !(fichasIds.has(Number(id)) && document.getElementById("extrasRapidosPOS"))) {
                    if (!cargado) window.recargarExtrasPOS().then(() => mostrarFichas(id, arguments[1]));
                    else mostrarFichas(id, arguments[1]);
                }
            } catch (error) { /* las fichas son un extra: nunca deben estorbar a la venta */ }

            return resultado;
        };

        conExtras.__conExtras = true;
        window.agregar = conExtras;
    }

    document.addEventListener("DOMContentLoaded", () => {
        enganchar();
        document.addEventListener("nexo-funciones-beta", evento => { if (evento.detail && evento.detail.armado) window.recargarExtrasPOS(); else mapa = {}; });
    });

    if (document.readyState !== "loading") enganchar();
})();
