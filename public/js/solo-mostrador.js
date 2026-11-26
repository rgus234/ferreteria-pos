/* "Solo lo necesario" (funcion nueva solo_mostrador): para negocios chicos que no ocupan un punto de venta completo (p. ej. La Rinconada).

   - Pone la clase body.solo-mostrador: menu-simple.js deja en el menu SOLO Inicio, Mostrador de precios, Mi mercancia, Recargas, Proveedores
     y "Se esta acabando" (mas Mi negocio / Mi cuenta). Nada se borra: al apagar la funcion vuelve el menu completo.
   - Cambia el Inicio por uno sencillo: botones grandes y el siguiente paso a la vista. */
(function () {
    const activo = () => typeof window.funcionBeta === "function" && window.funcionBeta("solo_mostrador");
    // "Vender en Market": el mismo Inicio sencillo, pero con los pasos para publicar la tienda en Market.
    const vendedor = () => typeof window.funcionBeta === "function" && window.funcionBeta("vendedor_market");
    const modoSencillo = () => activo() || vendedor();
    const esc = valor => String(valor == null ? "" : valor).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
    let instalado = false;
    // Iconos de linea (en vez de emojis, que se ven genericos). Son fijos: no llevan datos del usuario.
    const ICONOS = {"mostrador":"<svg viewBox=\"0 0 24 24\" aria-hidden=\"true\"><path d=\"M3 12V4h8l10 10-8 8z\"/><circle cx=\"7.5\" cy=\"8.5\" r=\"1.2\"/></svg>","mercancia":"<svg viewBox=\"0 0 24 24\" aria-hidden=\"true\"><path d=\"M21 8 12 3 3 8v8l9 5 9-5z\"/><path d=\"M3 8l9 5 9-5M12 13v8\"/></svg>","recargas":"<svg viewBox=\"0 0 24 24\" aria-hidden=\"true\"><rect x=\"7\" y=\"2\" width=\"10\" height=\"20\" rx=\"2.5\"/><path d=\"M11 18h2\"/></svg>","proveedores":"<svg viewBox=\"0 0 24 24\" aria-hidden=\"true\"><path d=\"M2 6h12v10H2zM14 10h4l3 3v3h-7\"/><circle cx=\"6.5\" cy=\"17.5\" r=\"1.8\"/><circle cx=\"17.5\" cy=\"17.5\" r=\"1.8\"/></svg>","acabando":"<svg viewBox=\"0 0 24 24\" aria-hidden=\"true\"><path d=\"M12 3 2 20h20z\"/><path d=\"M12 10v5M12 18h.01\"/></svg>"};

    function aplicarClase() {
        document.body.classList.toggle("solo-mostrador", activo());
        document.body.classList.toggle("vendedor-market", vendedor());
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
            { icono: ICONOS.mostrador, titulo: "Mostrador de precios", texto: "Escaneas un producto y ves su foto y su precio en grande, para enseñárselo al cliente.", accion: "mostrador" },
            { icono: ICONOS.mercancia, titulo: "Meter mi mercancía", texto: "Escaneas cada producto y solo le pones el precio. Nexo ya conoce su nombre y su foto.", accion: "mercancia" },
            { icono: ICONOS.recargas, titulo: "Recargas y servicios", texto: "Tiempo aire, luz, teléfono y tarjetas de regalo.", accion: "recargas" },
            { icono: ICONOS.proveedores, titulo: "Mis proveedores", texto: "A quién le compras y cuándo viene.", accion: "proveedores" },
            { icono: ICONOS.acabando, titulo: "Se está acabando", texto: "Lo que ya casi no tienes y conviene pedir.", accion: "acabando", etiqueta: numeros && numeros.acabando ? `${numeros.acabando} por pedir` : "" }
        ];

        raiz.innerHTML = `<div class="si-shell">
            <section class="si-hero">
                <h2>Hola, ${esc(nombreNegocio())}</h2>
                <p>Aquí tienes lo que necesitas, sin complicaciones.</p>
                <div class="si-numeros">${numeros ? `<span>${numeros.total} ${numeros.total === 1 ? "producto" : "productos"}</span>${hoy ? `<span>${hoy} ${hoy === 1 ? "metido" : "metidos"} hoy</span>` : ""}` : ""}</div>
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

    // ---- Vender en Market: Inicio con los pasos para publicar la tienda ----
    async function pedirJson(ruta) {
        try { const r = await fetch(ruta); return r.ok ? await r.json() : null; } catch (error) { return null; }
    }

    async function cargarPasosVendedor() {
        // Los requisitos los calcula el servidor (los mismos que revisa al pedir la publicacion).
        const [publicacion, cobros] = await Promise.all([pedirJson("/negocio-actual/market-publicacion"), pedirJson("/negocio-actual/cobros/estado")]);
        const r = (publicacion && publicacion.requisitos) || { datos: false, productos: false, totalProductos: 0, minimoProductos: 5, tienda: false };
        const total = Number(r.totalProductos) || 0;

        return {
            publicacion,
            pasos: [
                { id: "datos", titulo: "Datos de tu tienda", texto: "Nombre, teléfono y dirección: es lo que ve quien te compra.", hecho: Boolean(r.datos), accion: "configuracion", boton: "Completar datos" },
                { id: "productos", titulo: "Sube tus productos", texto: total ? `Llevas ${total} ${total === 1 ? "producto" : "productos"} con precio. Necesitas al menos ${r.minimoProductos || 5}.` : "Escanea cada producto y ponle su precio.", hecho: Boolean(r.productos), accion: "mercancia", boton: "Meter mercancía" },
                { id: "tienda", titulo: "Prende tu tienda en línea", texto: "Elige cómo entregas (recoges en tienda o llevas a domicilio) y prende tu página.", hecho: Boolean(r.tienda), accion: "sitio-web", boton: "Configurar mi tienda" },
                { id: "cobros", titulo: "Activa el cobro en línea", texto: "Opcional: con esto tus clientes pagan con tarjeta y el dinero llega directo a tu cuenta. Nexo cobra 6 % por venta.", hecho: Boolean(cobros && cobros.chargesEnabled), opcional: true, accion: "sitio-web", boton: "Activar cobros" }
            ]
        };
    }

    // Ultimo paso: pedir la publicacion y ver en que va.
    function htmlPublicacion(p) {
        if (!p || !p.aplica) return "";

        if (p.estado === "en_revision") return `<section class="si-publicar en-revision"><b>Tu tienda está en revisión</b><span>Nexo la revisa y te avisa por correo. Normalmente toma poco tiempo.</span></section>`;
        if (p.estado === "aprobado") return `<section class="si-publicar aprobada"><b>¡Tu tienda ya está en Market!</b><span>Los clientes ya pueden encontrarla y hacerte pedidos.</span><a class="si-paso-boton" href="/market/tienda/${encodeURIComponent(p.slug || "")}" target="_blank" rel="noopener">Ver mi tienda en Market</a></section>`;

        return `<section class="si-publicar">
            <b>Publica tu tienda en Market</b>
            ${p.estado === "rechazado" ? `<span class="si-publicar-nota">Nexo la revisó y falta esto: ${esc(p.nota || "revisa tus productos y tus datos")}</span>` : `<span>Cuando termines los pasos de arriba, Nexo revisa tu tienda una sola vez y la publica.</span>`}
            <button type="button" class="si-paso-boton" data-publicar="1" ${p.puedeSolicitar ? "" : "disabled"}>Pedir que publiquen mi tienda</button>
            <small class="si-publicar-error" hidden></small>
        </section>`;
    }

    async function pintarVendedor(raiz) {
        raiz.innerHTML = `<div class="si-shell"><section class="si-hero"><h2>Hola, ${esc(nombreNegocio())}</h2><p>Estos son los pasos para vender en Nexo Market.</p></section><p class="si-cargando">Revisando tu tienda…</p></div>`;

        const { publicacion, pasos } = await cargarPasosVendedor();
        const obligatorios = pasos.filter(p => !p.opcional);
        const listos = obligatorios.filter(p => p.hecho).length;

        raiz.innerHTML = `<div class="si-shell">
            <section class="si-hero">
                <h2>Hola, ${esc(nombreNegocio())}</h2>
                <p>Estos son los pasos para vender en Nexo Market.</p>
                <div class="si-numeros"><span>${listos} de ${obligatorios.length} pasos listos</span></div>
            </section>
            <section class="si-pasos">${pasos.map((p, i) => `<div class="si-paso-fila ${p.hecho ? "hecho" : ""}">
                <span class="si-paso-marca" aria-hidden="true">${p.hecho ? "✓" : i + 1}</span>
                <div class="si-paso-cuerpo"><b>${esc(p.titulo)}${p.opcional ? " <em>(opcional)</em>" : ""}</b><small>${esc(p.texto)}</small></div>
                <button type="button" class="si-paso-boton ${p.hecho ? "secundario" : ""}" data-accion="${p.accion}">${p.hecho ? "Revisar" : esc(p.boton)}</button>
            </div>`).join("")}</section>
            ${htmlPublicacion(publicacion)}
            <section class="si-tarjetas">
                <button type="button" class="si-tarjeta" data-accion="pedidos-market" style="--i:0"><span class="si-icono" aria-hidden="true">${ICONOS.recargas}</span><b>Pedidos de Market</b><span class="si-texto">Lo que te piden por internet, para prepararlo y entregarlo.</span></button>
                <button type="button" class="si-tarjeta" data-accion="mercancia" style="--i:1"><span class="si-icono" aria-hidden="true">${ICONOS.mercancia}</span><b>Mi mercancía</b><span class="si-texto">Tus productos, con su precio y existencias.</span></button>
            </section>
        </div>`;

        raiz.querySelectorAll("[data-accion]").forEach(boton => boton.addEventListener("click", () => {
            const accion = boton.dataset.accion;
            if (accion === "mercancia") { if (typeof window.mostrarMiMercancia === "function") window.mostrarMiMercancia(); return; }
            abrirModulo(accion);
        }));

        const publicar = raiz.querySelector("[data-publicar]");
        if (publicar) publicar.addEventListener("click", async () => {
            publicar.disabled = true;
            const aviso = raiz.querySelector(".si-publicar-error");
            try {
                const r = await fetch("/negocio-actual/market-publicacion/solicitar", { method: "POST", headers: { "Content-Type": "application/json" } });
                const d = await r.json().catch(() => ({}));
                if (!r.ok) throw new Error(d.error || "No se pudo pedir la publicación.");
                await pintarVendedor(raiz);
            } catch (error) {
                if (aviso) { aviso.textContent = error.message; aviso.hidden = false; }
                publicar.disabled = false;
            }
        });
    }

    window.mostrarSoloInicio = async function () {
        if (typeof ocultarPantallasPrincipales === "function") ocultarPantallasPrincipales();

        const raiz = document.getElementById("pantallaSoloInicio");
        if (!raiz) return;

        raiz.style.display = "block";

        if (vendedor() && !activo()) {
            if (typeof actualizarTopbarContexto === "function") actualizarTopbarContexto("Inicio", "Tus pasos para vender en Market", "inicio");
            await pintarVendedor(raiz);
            return;
        }

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
            if (modoSencillo()) return window.mostrarSoloInicio();
            return typeof anterior === "function" ? anterior.apply(this, argumentos) : undefined;
        };
    }

    function alCambiarFunciones() {
        aplicarClase();

        // Si las funciones llegaron despues de que ya se mostro el Inicio de siempre, se cambia por el sencillo.
        if (modoSencillo()) {
            const inicio = document.getElementById("pantallaInicio");
            if (inicio && getComputedStyle(inicio).display !== "none") window.mostrarSoloInicio();
        }
    }

    document.addEventListener("nexo-funciones-beta", alCambiarFunciones);
    window.addEventListener("load", () => { setTimeout(instalar, 0); aplicarClase(); });
})();
