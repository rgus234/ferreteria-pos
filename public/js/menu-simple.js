/* Menu simplificado (computadora): en lugar de ~40 entradas sueltas, un menu corto y, al elegir un grupo, una pantalla con tarjetas grandes.
   Es una funcion nueva: solo existe si el dueño la enciende en Nexo -> Funciones nuevas ("Menu simplificado"). Apagada no cambia nada.
   No quita ni mueve ninguna pantalla: cada tarjeta le da clic al boton de siempre del menu, asi que permisos, perfil de abarrotes y
   funciones beta se respetan solos (si el boton original no le corresponde al usuario, la tarjeta no aparece). */
(function () {
    const LLAVE_GUARDADA = "nexoMenuSimple";

    // Cada tarjeta apunta al boton de siempre por su modulo (data-shell-module). "tam": g = grande, m = mediana, c = compacta.
    const HUBS = [
        { id: "inicio", etiqueta: "Inicio", icono: "home", directo: "inicio" },
        { id: "venta", etiqueta: "Vender", icono: "cart", directo: "venta" },
        {
            id: "productos", etiqueta: "Productos", icono: "inventory", titulo: "Productos", subtitulo: "Todo lo que vendes",
            grupos: [
                { tam: "g", cards: [
                    { modulo: "inventario", icono: "inventory", titulo: "Mis productos", texto: "Ver, buscar y cambiar precios" },
                    { modulo: "agregar-producto", icono: "plus", titulo: "Agregar producto", texto: "Uno nuevo, por peso o servicio" },
                    { modulo: "carga-inventario", icono: "file", titulo: "Cargar varios", texto: "Sube una lista y se agregan" }
                ] },
                { titulo: "Revisa", tam: "m", cards: [
                    { modulo: "inventario-bajo", icono: "alert", titulo: "Se está acabando", texto: "Lo que ya casi no tienes" },
                    { modulo: "por-vencer", icono: "clock", etiquetaOriginal: true, texto: "Lo que caduca pronto" },
                    { modulo: "pedido-sugerido", icono: "truck", titulo: "Qué pedir", texto: "Lo que conviene pedir a cada proveedor" }
                ] },
                { titulo: "Orden y herramientas", tam: "c", cards: [
                    { modulo: "categorias", icono: "layers", titulo: "Categorías" },
                    { modulo: "listas-producto", icono: "clipboard", titulo: "Listas de productos" },
                    { modulo: "exhibidores", icono: "grid", titulo: "Exhibidores" },
                    { modulo: "mapa-tienda", icono: "building", titulo: "Mapa de la tienda" },
                    { modulo: "fotos-sugeridas", icono: "eye", titulo: "Fotos sugeridas" },
                    { modulo: "codigos-barras", icono: "printer", titulo: "Códigos de barras" },
                    { modulo: "explorar-nexo", icono: "search", titulo: "Explorar Nexo" }
                ] }
            ]
        },
        {
            id: "compras", etiqueta: "Compras", icono: "truck", titulo: "Compras", subtitulo: "Lo que te llega y a quién se lo compras",
            grupos: [
                { tam: "g", cards: [
                    { modulo: "recepcion-inteligente", icono: "truck", titulo: "Recibir mercancía", texto: "Con la factura de tu proveedor" },
                    { modulo: "recibir-marca", icono: "arrowDownBox", titulo: "Recibir sin factura", texto: "Escaneando lo que llegó" }
                ] },
                { titulo: "Proveedores", tam: "m", cards: [
                    { modulo: "proveedores", icono: "users", titulo: "Mis proveedores", texto: "Datos y días de visita" },
                    { modulo: "catalogo", icono: "file", titulo: "Catálogo de proveedor", texto: "Sus productos y precios" },
                    { modulo: "pedidos", icono: "clipboard", titulo: "Pedidos a proveedor", texto: "Los que armaste y enviaste" }
                ] },
                { titulo: "Historial", tam: "c", cards: [
                    { modulo: "recepcion", icono: "receipt", titulo: "Recepciones anteriores" },
                    { modulo: "ajustes", icono: "swap", titulo: "Ajustes de inventario" }
                ] }
            ]
        },
        {
            id: "clientes", etiqueta: () => (typeof perfilEsSimple === "function" && perfilEsSimple() ? "Clientes y fiado" : "Clientes y crédito"), icono: "users",
            titulo: () => (typeof perfilEsSimple === "function" && perfilEsSimple() ? "Clientes y fiado" : "Clientes y crédito"), subtitulo: "Quién te compra y quién te debe",
            grupos: [
                { tam: "g", cards: [
                    { modulo: "clientes", icono: "users", titulo: "Mis clientes", texto: "Sus datos y compras" },
                    { modulo: "creditos", icono: "credit", etiquetaOriginal: true, texto: "Saldos, abonos y cobros" },
                    { modulo: "encargos", icono: "clipboard", titulo: "Encargos", texto: "Lo que te piden y aún no tienes" }
                ] }
            ]
        },
        {
            id: "ventas", etiqueta: "Ventas", icono: "chart", titulo: "Ventas", subtitulo: "Cuánto vendes y cómo va tu negocio",
            grupos: [
                { tam: "g", cards: [
                    { modulo: "reportes", icono: "chart", titulo: "Reportes", texto: "Ventas del día, semana y mes" },
                    { modulo: "buscar-ticket", icono: "receipt", titulo: "Buscar un ticket", texto: "Por folio, cliente o día" },
                    { modulo: "facturacion", icono: "file", titulo: "Facturación", texto: "Facturas a tus clientes" }
                ] },
                { tam: "m", cards: [
                    { modulo: "caja", icono: "zap", titulo: "Caja", texto: "Aperturas y cortes" },
                    { modulo: "finanzas", icono: "wallet", titulo: "Finanzas", texto: "Ganancias y gastos" }
                ] }
            ]
        },
        {
            id: "enlinea", etiqueta: "En línea", icono: "globe", titulo: "En línea", subtitulo: "Tu negocio en internet",
            grupos: [
                { tam: "g", cards: [
                    { modulo: "pedidos-market", icono: "bag", titulo: "Pedidos de Market", texto: "Lo que te piden por internet" },
                    { modulo: "sitio-web", icono: "globe", titulo: "Mi sitio web", texto: "Tu página con tus productos" }
                ] }
            ]
        },
        { id: "nexo-ia", etiqueta: "Nexo IA", icono: "sparkle", directo: "nexo-ia" },
        {
            id: "config", etiqueta: "Configuración", icono: "settings", titulo: "Configuración", subtitulo: "Tu negocio, tu cuenta y tus equipos",
            grupos: [
                { tam: "g", cards: [
                    { modulo: "configuracion", icono: "settings", titulo: "Mi negocio", texto: "Datos, ticket, precios y equipo" },
                    { modulo: "cuenta", icono: "wallet", titulo: "Mi cuenta", texto: "Plan, pagos y contraseña" },
                    { modulo: "dueno", icono: "cast", titulo: "App del dueño", texto: "Enlaza tu celular con un QR" },
                    { modulo: "funciones-beta", icono: "zap", titulo: "Funciones nuevas", texto: "Pruébalas antes que nadie" }
                ] }
            ]
        }
    ];

    const estado = { hubActual: null };
    const esc = valor => String(valor ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
    const valorDe = x => (typeof x === "function" ? x() : x);
    const icono = nombre => (typeof iconoUISVG === "function" ? iconoUISVG(nombre) : "");
    const activo = () => document.body.classList.contains("menu-simple");

    function original(modulo) {
        return document.querySelector(`.sidebar [data-shell-module="${modulo}"]:not(.ms-item)`);
    }

    // El boton de siempre le corresponde a esta persona? (permiso, perfil de abarrotes, funcion nueva apagada)
    function disponible(boton) {
        if (!boton || boton.hidden) return false;
        if (boton.style.display === "none") return false;

        const cuerpo = document.body.classList;
        if (boton.dataset.perfilOculto === "1" && cuerpo.contains("perfil-simple") && !cuerpo.contains("perfil-ver-todo")) return false;
        if (boton.classList.contains("solo-perfil-simple") && !cuerpo.contains("perfil-simple") && !cuerpo.contains("perfil-con-abarrotes")) return false;
        return true;
    }

    function tarjetasDe(hub) {
        return (hub.grupos || []).map(g => ({
            ...g,
            cards: g.cards.map(c => ({ ...c, boton: original(c.modulo) })).filter(c => disponible(c.boton))
        })).filter(g => g.cards.length);
    }

    function totalTarjetas(hub) { return tarjetasDe(hub).reduce((s, g) => s + g.cards.length, 0); }
    function hubDelModulo(modulo) { return HUBS.find(h => h.directo === modulo || (h.grupos || []).some(g => g.cards.some(c => c.modulo === modulo))) || null; }

    // ---------- menu ----------

    function pintarMenu() {
        const lateral = document.querySelector(".sidebar");
        if (!lateral) return;

        let nav = lateral.querySelector(".ms-nav");
        if (!nav) {
            nav = document.createElement("nav");
            nav.className = "ms-nav";
            nav.setAttribute("aria-label", "Menú principal");
            const marca = lateral.querySelector("#marcaSidebar");
            if (marca) marca.insertAdjacentElement("afterend", nav); else lateral.prepend(nav);

            nav.addEventListener("click", evento => {
                const boton = evento.target.closest(".ms-item");
                if (boton) abrirHub(boton.dataset.hub);
            });
        }

        const visibles = HUBS.filter(h => h.directo ? disponible(original(h.directo)) : totalTarjetas(h) > 0);
        const huella = visibles.map(h => h.id + ":" + valorDe(h.etiqueta)).join("|");

        if (nav.dataset.huella !== huella) {
            nav.dataset.huella = huella;
            nav.innerHTML = visibles.map(h => `<button type="button" class="ms-item" data-hub="${h.id}">${icono(h.icono)}<span>${esc(valorDe(h.etiqueta))}</span></button>`).join("");
        }

        marcarActivo(nav);
    }

    function marcarActivo(nav) {
        nav = nav || document.querySelector(".ms-nav");
        if (!nav) return;

        const pantallaHub = document.getElementById("pantallaHubMenu");
        let actual = pantallaHub && pantallaHub.style.display !== "none" ? estado.hubActual : null;

        if (!actual) {
            const botonActivo = document.querySelector(".sidebar button.activo:not(.ms-item)");
            const modulo = botonActivo && botonActivo.dataset.shellModule;
            const hub = modulo ? hubDelModulo(modulo) : null;
            actual = hub ? hub.id : null;
        }

        nav.querySelectorAll(".ms-item").forEach(b => b.classList.toggle("activo", b.dataset.hub === actual));
    }

    // ---------- pantalla de tarjetas ----------

    function abrirHub(id) {
        const hub = HUBS.find(h => h.id === id);
        if (!hub) return;

        if (hub.directo) { const b = original(hub.directo); if (b) b.click(); estado.hubActual = null; return; }

        const grupos = tarjetasDe(hub);
        const todas = grupos.flatMap(g => g.cards);
        // un grupo con una sola cosa no necesita una pantalla de tarjetas: se va directo
        if (todas.length === 1) { estado.hubActual = hub.id; todas[0].boton.click(); return; }

        estado.hubActual = hub.id;

        if (typeof ocultarPantallasPrincipales === "function") ocultarPantallasPrincipales();

        let pantalla = document.getElementById("pantallaHubMenu");
        if (!pantalla) {
            pantalla = document.createElement("section");
            pantalla.id = "pantallaHubMenu";
            (document.querySelector(".contenido") || document.body).appendChild(pantalla);
        }

        const titulo = valorDe(hub.titulo);
        pantalla.style.display = "block";
        pantalla.innerHTML = `<div class="ms-hub">
            <header class="ms-hub-cab"><span class="ms-cab-icono">${icono(hub.icono)}</span><div><h2>${esc(titulo)}</h2><p>${esc(hub.subtitulo)}</p></div></header>
            ${grupos.map((g, gi) => `<section class="ms-grupo">${g.titulo ? `<h3>${esc(g.titulo)}</h3>` : ""}
                <div class="ms-tarjetas ms-${g.tam || "m"}">${g.cards.map((c, ci) => {
                    const nombre = c.etiquetaOriginal ? String(c.boton.textContent || "").replace(/\s+/g, " ").trim() : c.titulo;
                    return `<button type="button" class="ms-tarjeta" data-g="${gi}" data-c="${ci}">
                        <span class="ms-icono">${icono(c.icono)}</span>
                        <span class="ms-texto"><b>${esc(nombre)}</b>${c.texto ? `<small>${esc(c.texto)}</small>` : ""}</span>
                        <span class="ms-flecha" aria-hidden="true">›</span></button>`;
                }).join("")}</div></section>`).join("")}</div>`;

        pantalla.onclick = evento => {
            const t = evento.target.closest(".ms-tarjeta");
            if (!t) return;
            const c = grupos[Number(t.dataset.g)].cards[Number(t.dataset.c)];
            if (c && c.boton) c.boton.click();
        };

        if (typeof actualizarTopbarContexto === "function") actualizarTopbarContexto(titulo, hub.subtitulo, "hub-" + hub.id);
        marcarActivo();
        pantalla.scrollTop = 0;
    }

    window.abrirMenuSimple = abrirHub;

    // ---------- encendido ----------

    let temporizador = null;
    function programar() { clearTimeout(temporizador); temporizador = setTimeout(() => { if (activo()) pintarMenu(); }, 90); }

    function encender(si) {
        document.body.classList.toggle("menu-simple", si);
        try { localStorage.setItem(LLAVE_GUARDADA, si ? "1" : "0"); } catch (error) { /* sin almacenamiento */ }

        if (si) pintarMenu();
        else document.querySelector(".ms-nav")?.remove();
    }

    // Apenas abre la pagina se usa lo ultimo que se sabia (para que no parpadee el menu); luego manda lo que diga el servidor.
    try { if (localStorage.getItem(LLAVE_GUARDADA) === "1") document.body.classList.add("menu-simple"); } catch (error) { /* sin almacenamiento */ }

    document.addEventListener("nexo-funciones-beta", evento => encender(Boolean(evento.detail && evento.detail.menu_simplificado)));

    // el menu cambia solo (permisos al entrar, funciones nuevas, perfil de abarrotes, pantalla activa): se vuelve a pintar con calma
    const lateral = document.querySelector(".sidebar");
    if (lateral) new MutationObserver(registros => { if (registros.some(r => !r.target.closest || !r.target.closest(".ms-nav"))) programar(); })
        .observe(lateral, { subtree: true, childList: true, attributes: true, attributeFilter: ["class", "style", "hidden", "data-perfil-oculto"] });

    // "Más herramientas" (perfil de abarrotes) cambia lo que le toca ver: se repinta el menu y la pantalla abierta
    let verTodoAntes = document.body.classList.contains("perfil-ver-todo");
    new MutationObserver(() => {
        const ahora = document.body.classList.contains("perfil-ver-todo");
        if (ahora === verTodoAntes) return;
        verTodoAntes = ahora;
        if (!activo()) return;
        pintarMenu();
        const pantalla = document.getElementById("pantallaHubMenu");
        if (pantalla && pantalla.style.display !== "none" && estado.hubActual) abrirHub(estado.hubActual);
    }).observe(document.body, { attributes: true, attributeFilter: ["class"] });

    if (typeof window.funcionBeta === "function" && window.funcionBeta("menu_simplificado")) encender(true);

    document.addEventListener("DOMContentLoaded", programar);
    window.addEventListener("load", programar);
})();
