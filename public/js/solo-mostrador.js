/* "Solo lo necesario" (funcion nueva solo_mostrador): para negocios chicos que no ocupan un punto de venta completo (p. ej. La Rinconada).

   - Pone la clase body.solo-mostrador: menu-simple.js deja en el menu SOLO Inicio, Mostrador de precios, Mi mercancia, Recargas, Proveedores
     y "Se esta acabando" (mas Mi negocio / Mi cuenta). Nada se borra: al apagar la funcion vuelve el menu completo.
   - Cambia el Inicio por uno sencillo: botones grandes y el siguiente paso a la vista. */
(function () {
    const activo = () => typeof window.funcionBeta === "function" && window.funcionBeta("solo_mostrador");
    const esc = valor => String(valor == null ? "" : valor).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
    let instalado = false;

    function aplicarClase() {
        document.body.classList.toggle("solo-mostrador", activo());
    }

    // Abre un modulo del menu de siempre, como si se hubiera tocado su boton (asi respeta permisos y funciones nuevas).
    function abrirModulo(modulo) {
        const boton = document.querySelector(`.sidebar [data-shell-module="${modulo}"]:not(.ms-item):not(.sidebar-grupo-toggle)`);
        if (boton) boton.click();
    }

    async function cargarNumeros() {
        try {
            const respuesta = await fetch("/productos");
            if (!respuesta.ok) return null;
            const lista = await respuesta.json();
            if (!Array.isArray(lista)) return null;

            return {
                total: lista.length,
                acabando: lista.filter(p => Number(p.stock || 0) <= Number(p.stock_minimo == null ? 3 : p.stock_minimo)).length
            };
        } catch (error) { return null; }
    }

    function nombreNegocio() {
        try { return (typeof configuracionNegocio === "function" && configuracionNegocio()?.nombre) || "tu negocio"; } catch (error) { return "tu negocio"; }
    }

    function pintar(raiz, numeros) {
        const sinProductos = numeros && numeros.total === 0;
        const hoy = window.nexoMiMercancia ? window.nexoMiMercancia.hoy() : 0;

        const tarjetas = [
            { icono: "🏷️", titulo: "Mostrador de precios", texto: "Escaneas un producto y ves su foto y su precio en grande, para enseñárselo al cliente.", accion: "mostrador" },
            { icono: "📦", titulo: "Meter mi mercancía", texto: "Escaneas cada producto y solo le pones el precio. Nexo ya conoce su nombre y su foto.", accion: "mercancia" },
            { icono: "📱", titulo: "Recargas y servicios", texto: "Tiempo aire, luz, teléfono y tarjetas de regalo.", accion: "recargas" },
            { icono: "🚚", titulo: "Mis proveedores", texto: "A quién le compras y cuándo viene.", accion: "proveedores" },
            { icono: "⚠️", titulo: "Se está acabando", texto: "Lo que ya casi no tienes y conviene pedir.", accion: "acabando", etiqueta: numeros && numeros.acabando ? `${numeros.acabando} por pedir` : "" }
        ];

        raiz.innerHTML = `<div class="si-shell">
            <section class="si-hero">
                <h2>Hola, ${esc(nombreNegocio())}</h2>
                <p>Aquí tienes lo que necesitas, sin complicaciones.</p>
                <div class="si-numeros">${numeros ? `<span>${numeros.total} productos</span>${hoy ? `<span>${hoy} metidos hoy</span>` : ""}` : ""}</div>
            </section>
            ${sinProductos ? `<section class="si-paso"><div><b>Empieza por aquí: mete tu mercancía</b><p>Pasa cada producto por el escáner y ponle su precio. Mientras más metas, más útil es el mostrador.</p></div><button type="button" data-accion="mercancia">Empezar ahora</button></section>` : ""}
            <section class="si-tarjetas">${tarjetas.map((t, i) => `<button type="button" class="si-tarjeta" data-accion="${t.accion}" style="--i:${i}"><span class="si-icono" aria-hidden="true">${t.icono}</span><b>${esc(t.titulo)}</b><span class="si-texto">${esc(t.texto)}</span>${t.etiqueta ? `<em>${esc(t.etiqueta)}</em>` : ""}</button>`).join("")}</section>
        </div>`;

        raiz.querySelectorAll("[data-accion]").forEach(boton => boton.addEventListener("click", () => {
            const accion = boton.dataset.accion;

            if (accion === "mostrador") { if (window.nexoMostrador) window.nexoMostrador.abrir(); return; }
            if (accion === "mercancia") { if (typeof window.mostrarMiMercancia === "function") window.mostrarMiMercancia(); return; }
            if (accion === "acabando") { abrirModulo("inventario-bajo"); return; }

            abrirModulo(accion);
        }));
    }

    window.mostrarSoloInicio = async function () {
        if (typeof ocultarPantallasPrincipales === "function") ocultarPantallasPrincipales();

        const raiz = document.getElementById("pantallaSoloInicio");
        if (!raiz) return;

        raiz.style.display = "block";
        if (typeof actualizarTopbarContexto === "function") actualizarTopbarContexto("Inicio", "Lo que necesitas, sin complicaciones", "inicio");

        pintar(raiz, null);
        pintar(raiz, await cargarNumeros());
    };

    // El Inicio de siempre se cambia por el sencillo, pero SOLO en un negocio con la funcion encendida. Se instala al terminar de cargar
    // para quedar por encima de las otras versiones del Inicio (abarrotes, pendientes).
    function instalar() {
        if (instalado) return;
        instalado = true;

        const anterior = window.mostrarInicio;

        window.mostrarInicio = function (...argumentos) {
            if (activo()) return window.mostrarSoloInicio();
            return typeof anterior === "function" ? anterior.apply(this, argumentos) : undefined;
        };
    }

    function alCambiarFunciones() {
        aplicarClase();

        // Si las funciones llegaron despues de que ya se mostro el Inicio de siempre, se cambia por el sencillo.
        if (activo()) {
            const inicio = document.getElementById("pantallaInicio");
            if (inicio && getComputedStyle(inicio).display !== "none") window.mostrarSoloInicio();
        }
    }

    document.addEventListener("nexo-funciones-beta", alCambiarFunciones);
    window.addEventListener("load", () => { setTimeout(instalar, 0); aplicarClase(); });
})();
