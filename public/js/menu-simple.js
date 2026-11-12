/* Menu de Nexo (computadora): en lugar de ~40 entradas sueltas, un menu corto y, al elegir un grupo, una pantalla con tarjetas.
   Es EL menu de Nexo (ya no se enciende ni se apaga). Reglas: dos niveles (modulo -> opcion), pocas opciones por modulo con su frase
   de explicacion, lo demas en "Mas herramientas" (plegado) y el orden sigue el uso real.
   No quita ni mueve ninguna pantalla: cada tarjeta le da clic al boton de siempre del menu, asi que permisos, perfil de abarrotes y
   funciones beta se respetan solos (si el boton original no le corresponde al usuario, la tarjeta no aparece). */
(function () {

    // Cada tarjeta apunta al boton de siempre por su modulo (data-shell-module). "tam": g = grande, m = mediana, c = compacta.
    const HUBS = [
        { id: "inicio", etiqueta: "Inicio", icono: "home", directo: "inicio" },
        { id: "venta", etiqueta: "Vender", icono: "cart", directo: "venta" },
        { id: "recargas", etiqueta: "Recargas", icono: "phone", directo: "recargas" },
        {
            id: "productos", etiqueta: "Inventario", icono: "inventory", titulo: "Inventario", subtitulo: "Lo que vendes y lo que tienes",
            grupos: [
                { tam: "g", cards: [
                    { modulo: "inventario", icono: "inventory", titulo: "Mis productos", texto: "Buscar y editar: precio, foto, caducidad" },
                    { modulo: "agregar-producto", icono: "plus", titulo: "Agregar producto", texto: "Uno nuevo, por peso o servicio" },
                    { modulo: "frutas-y-verduras", icono: "leaf", titulo: "Frutas y verduras", texto: "Elige de la lista, con su foto" },
                    { modulo: "carga-inventario", icono: "file", titulo: "Cargar varios", texto: "Sube una lista y se agregan" }
                ] },
                { titulo: "Revisa", tam: "m", cards: [
                    { modulo: "inventario-bajo", icono: "alert", titulo: "Se está acabando", texto: "Lo que ya casi no tienes" },
                    { modulo: "por-vencer", icono: "clock", etiquetaOriginal: true, texto: "Lo que caduca pronto" },
                    { modulo: "minimos-ventas", icono: "clipboard", titulo: "Mínimos con tus ventas", texto: "Cuánto tener de cada cosa" },
                    { modulo: "pedido-sugerido", icono: "truck", titulo: "Qué pedir", texto: "Lo que conviene pedir a cada proveedor", ocultaSi: () => pedidosUnicos() }
                ] },
                { titulo: "Más herramientas", tam: "c", plegable: true, cards: [
                    { modulo: "categorias", icono: "layers", titulo: "Categorías", texto: "Ordena tus productos por tipo" },
                    { modulo: "ajustes", icono: "swap", titulo: "Ajustes de inventario", texto: "Corrige existencias y mermas" },
                    { modulo: "precios-lote", icono: "chart", titulo: "Actualizar precios", texto: "Sube o baja varios precios, con historial" },
                    { modulo: "listas-producto", icono: "clipboard", titulo: "Listas de productos", texto: "Grupos para vender o pedir" },
                    { modulo: "exhibidores", icono: "grid", titulo: "Exhibidores", texto: "Muebles y displays con su producto" },
                    { modulo: "armar-productos", icono: "inventory", titulo: "Armar productos", texto: "Del granel a bolsitas o porciones" },
                    { modulo: "mapa-tienda", icono: "building", titulo: "Mapa de la tienda", texto: "Dónde está cada producto" },
                    { modulo: "fotos-sugeridas", icono: "eye", titulo: "Fotos sugeridas", texto: "Ponle foto a lo que no tiene" },
                    { modulo: "codigos-barras", icono: "printer", titulo: "Códigos de barras", texto: "Crea e imprime etiquetas" },
                    { modulo: "explorar-nexo", icono: "search", titulo: "Explorar Nexo", texto: "Catálogo de productos conocidos" }
                ] }
            ]
        },
        {
            id: "compras", etiqueta: "Compras", icono: "truck", titulo: "Compras", subtitulo: "Lo que te llega",
            grupos: [
                { tam: "g", cards: [
                    { modulo: "recepcion-inteligente", icono: "truck", titulo: "Recibir mercancía", texto: "Con la factura de tu proveedor", ocultaSi: () => recepcionUnica() },
                    { modulo: "recibir-marca", icono: "arrowDownBox", titulo: () => (typeof perfilEsSimple === "function" && perfilEsSimple() ? "Recibir mercancía" : "Recibir sin factura"), texto: () => (typeof perfilEsSimple === "function" && perfilEsSimple() ? "Elige la marca y anota cuánto llegó" : "Escaneando lo que llegó") },
                    { modulo: "pedidos-unico", icono: "clipboard", titulo: "Pedidos", texto: "Crea un pedido o deja que Nexo te diga qué pedir" },
                    { modulo: "recepcion-inteligente", accion: "abrirHistorialRecepciones", icono: "receipt", titulo: "Recepciones anteriores", texto: "Lo que ya recibiste y cuándo", ocultaSi: () => recepcionUnica() }
                ] }
            ]
        },
        {
            id: "proveedores", etiqueta: "Proveedores", icono: "users", titulo: "Proveedores", subtitulo: "A quién le compras",
            grupos: [
                { tam: "g", cards: [
                    { modulo: "proveedores", icono: "users", titulo: "Mis proveedores", texto: "Datos y días de visita" },
                    { modulo: "catalogo", icono: "file", titulo: "Catálogo de proveedor", texto: "Sus productos y precios" },
                    { modulo: "agenda-pagos", icono: "receipt", titulo: "Agenda de pagos", texto: "Lo que debes y cuándo pagarlo" },
                    { modulo: "unir-proveedores", icono: "users", titulo: "Unir proveedores", texto: "Junta los que están repetidos" },
                    { modulo: "pedidos", icono: "clipboard", titulo: "Pedidos a proveedor", texto: "Los que armaste y enviaste", ocultaSi: () => pedidosUnicos() }
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
                    { modulo: "mi-equipo", icono: "users", titulo: "Mi equipo", texto: "Personas, tareas y avisos" },
                    { modulo: "configuracion", icono: "settings", titulo: "Mi negocio", texto: "Datos, ticket, precios y equipo" },
                    { modulo: "cuenta", icono: "wallet", titulo: "Mi cuenta", texto: "Plan, pagos y contraseña" },
                    { modulo: "correo-facturas", icono: "file", titulo: "Correo de facturas", texto: "Que tus facturas lleguen solas" },
                    { modulo: "dueno", icono: "cast", titulo: "App del dueño", texto: "Enlaza tu celular con un QR" }
                ] },
                { titulo: "Más herramientas", tam: "c", plegable: true, cards: [
                    { modulo: "practica", icono: "sparkle", titulo: "Practicar con Nexo", texto: "Aprende cobrando con productos de ejemplo" },
                    { modulo: "funciones-beta", icono: "zap", titulo: "Funciones nuevas", texto: "Pruébalas antes que nadie" }
                ] }
            ]
        }
    ];

    const estado = { hubActual: null, masAbierto: {} };
    let direccion = "adelante";

    const sinMovimiento = () => window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const contenedor = () => document.querySelector(".contenido");
    const esPantalla = el => el && el.nodeType === 1 && el.id && el.id !== "topbarPOS" && el.id !== "msVolver" && !/^nexo|^toast/i.test(el.id);
    const visibleEl = el => Boolean(el) && getComputedStyle(el).display !== "none" && !el.hidden;
    const pantallaVisible = () => [...(contenedor()?.children || [])].find(el => esPantalla(el) && visibleEl(el)) || null;

    // La pantalla actual se va (sube / se desliza) antes de abrir la siguiente
    function salidaAnimada(elemento, sentido) {
        if (!elemento || sinMovimiento() || !activo()) return Promise.resolve();
        const hub = elemento.querySelector?.(".ms-hub") || elemento;
        hub.classList.add(sentido === "atras" ? "nx-sale-atras" : "nx-sale");
        return new Promise(resolver => setTimeout(() => { hub.classList.remove("nx-sale", "nx-sale-atras"); resolver(); }, 170));
    }

    // Toda pantalla que aparece (menu, pantallas de cada modulo) entra con una animacion corta
    const visiblesAntes = new WeakMap();

    function vigilarPantallas() {
        const caja = contenedor();
        if (!caja || caja.dataset.msVigila === "1") return;
        caja.dataset.msVigila = "1";
        [...caja.children].forEach(el => visiblesAntes.set(el, visibleEl(el)));

        const observador = new MutationObserver(registros => {
            for (const r of registros) {
                const el = r.target;
                if (!esPantalla(el) || el.parentElement !== caja) continue;
                const ahora = visibleEl(el);
                const antes = visiblesAntes.get(el) === true;
                visiblesAntes.set(el, ahora);

                if (ahora && !antes && activo() && !sinMovimiento()) {
                    el.classList.remove("nx-entra", "nx-entra-adelante", "nx-entra-atras");
                    void el.offsetWidth;
                    el.classList.add("nx-entra", direccion === "atras" ? "nx-entra-atras" : "nx-entra-adelante");
                    setTimeout(() => el.classList.remove("nx-entra", "nx-entra-adelante", "nx-entra-atras"), 400);
                    direccion = "adelante";
                }
            }
        });

        // solo las pantallas (hijos directos), no cada elemento de adentro
        const observar = el => { if (esPantalla(el)) observador.observe(el, { attributes: true, attributeFilter: ["style", "hidden"] }); };
        [...caja.children].forEach(observar);
        new MutationObserver(registros => registros.forEach(r => r.addedNodes.forEach(n => { if (n.nodeType === 1) { visiblesAntes.set(n, visibleEl(n)); observar(n); } }))).observe(caja, { childList: true });
    }
    const esc = valor => String(valor ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
    const valorDe = x => (typeof x === "function" ? x() : x);
    const icono = nombre => (typeof iconoUISVG === "function" ? iconoUISVG(nombre) : "");
    const activo = () => document.body.classList.contains("menu-simple");

    function original(modulo) {
        // los encabezados de grupo (Inventario, Ventas y caja...) comparten modulo con su primera opcion pero solo despliegan el submenu
        return document.querySelector(`.sidebar [data-shell-module="${modulo}"]:not(.ms-item):not(.sidebar-grupo-toggle)`);
    }

    // El boton de siempre le corresponde a esta persona? (permiso, perfil de abarrotes, funcion nueva apagada)
    // Abarrotes con "Recibir por marca": una sola puerta "Recibir mercancia" (la factura y el historial quedan dentro de esa pantalla).
    // Abarrotes con "Pedidos": una sola puerta (Crear, Sugerir y Pedidos hechos); las entradas sueltas de antes se esconden.
    const pedidosUnicos = () => typeof perfilEsSimple === "function" && perfilEsSimple() && disponible(original("pedidos-unico"));
    const recepcionUnica = () => typeof perfilEsSimple === "function" && perfilEsSimple() && disponible(original("recibir-marca"));

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
            cards: g.cards.map(c => ({ ...c, boton: original(c.modulo) })).filter(c => disponible(c.boton) && !(typeof c.ocultaSi === "function" && c.ocultaSi()))
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

        if (nav.dataset.huella !== huella || nav.children.length !== visibles.length) {
            nav.dataset.huella = huella;
            nav.innerHTML = visibles.map(h => `<button type="button" class="ms-item" data-hub="${h.id}">${icono(h.icono)}<span>${esc(valorDe(h.etiqueta))}</span></button>`).join("");
        }

        marcarActivo(nav);
    }

    // Flecha para regresar: dentro de una pantalla que se abrio desde un grupo (Productos, Compras...) se vuelve a sus tarjetas
    function pintarVolver(hubId) {
        let barra = document.getElementById("msVolver");

        if (!hubId) { if (barra) barra.hidden = true; return; }

        if (!barra) {
            barra = document.createElement("div");
            barra.id = "msVolver";
            barra.className = "ms-volver";
            const tope = document.getElementById("topbarPOS");
            if (tope) tope.insertAdjacentElement("afterend", barra); else return;
            barra.addEventListener("click", async evento => {
                if (!evento.target.closest("button")) return;
                direccion = "atras";
                await salidaAnimada(pantallaVisible(), "atras");
                abrirHub(barra.dataset.hub);
            });
        }

        const hub = HUBS.find(h => h.id === hubId);
        barra.dataset.hub = hubId;
        barra.innerHTML = `<button type="button" aria-label="Regresar a ${esc(valorDe(hub.titulo))}"><span aria-hidden="true">‹</span> ${esc(valorDe(hub.titulo))}</button>`;
        barra.hidden = false;
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

        // dentro de una pantalla (no en las tarjetas) de un grupo con tarjetas: mostrar la flecha de regreso
        const hubVisible = pantallaHub && pantallaHub.style.display !== "none";
        const hubDePantalla = !hubVisible && actual ? HUBS.find(h => h.id === actual) : null;
        // un grupo con una sola tarjeta no tiene pantalla de tarjetas a la que regresar (abrirlo la vuelve a abrir sola): sin flecha
        const hayTarjetas = hubDePantalla && hubDePantalla.grupos && tarjetasDe(hubDePantalla).flatMap(g => g.cards).length > 1;
        pintarVolver(hayTarjetas ? hubDePantalla.id : null);
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
            ${grupos.map((g, gi) => {
                const abierto = !g.plegable || estado.masAbierto[hub.id] === true;
                const cabecera = g.plegable
                    ? `<button type="button" class="ms-mas" data-mas="${gi}" aria-expanded="${abierto}"><span>${esc(g.titulo)}</span><i aria-hidden="true">${abierto ? "▴" : "▾"}</i><em>${g.cards.length}</em></button>`
                    : (g.titulo ? `<h3>${esc(g.titulo)}</h3>` : "");
                return `<section class="ms-grupo${g.plegable ? " ms-plegable" : ""}">${cabecera}
                <div class="ms-tarjetas ms-${g.tam || "m"}"${abierto ? "" : " hidden"}>${g.cards.map((c, ci) => {
                    const nombre = c.etiquetaOriginal ? String(c.boton.textContent || "").replace(/\s+/g, " ").trim() : valorDe(c.titulo);
                    return `<button type="button" class="ms-tarjeta" data-g="${gi}" data-c="${ci}">
                        <span class="ms-icono">${icono(c.icono)}</span>
                        <span class="ms-texto"><b>${esc(nombre)}</b>${valorDe(c.texto) ? `<small>${esc(valorDe(c.texto))}</small>` : ""}</span>
                        <span class="ms-flecha" aria-hidden="true">›</span></button>`;
                }).join("")}</div></section>`;
            }).join("")}</div>`;

        pantalla.onclick = async evento => {
            const mas = evento.target.closest(".ms-mas");
            if (mas) {
                estado.masAbierto[hub.id] = !(estado.masAbierto[hub.id] === true);
                const posicion = pantalla.scrollTop;
                abrirHub(hub.id);
                pantalla.scrollTop = posicion;
                return;
            }

            const t = evento.target.closest(".ms-tarjeta");
            if (!t || pantalla.dataset.saliendo === "1") return;
            const c = grupos[Number(t.dataset.g)].cards[Number(t.dataset.c)];
            if (!c || !c.boton) return;

            // la tarjeta responde al toque, la pantalla se va y entonces se abre el destino
            pantalla.dataset.saliendo = "1";
            t.classList.add("ms-pulsada");
            direccion = "adelante";
            await salidaAnimada(pantalla);
            pantalla.dataset.saliendo = "";
            t.classList.remove("ms-pulsada");
            // algunas tarjetas abren directo una vista (ej. el historial) en lugar de la pantalla de su boton
            if (c.accion && typeof window[c.accion] === "function") window[c.accion](); else c.boton.click();
        };

        if (typeof actualizarTopbarContexto === "function") actualizarTopbarContexto(titulo, hub.subtitulo, "hub-" + hub.id);
        marcarActivo();
        pantalla.scrollTop = 0;
    }

    window.abrirMenuSimple = abrirHub;

    // ---------- encendido ----------

    let temporizador = null;
    function programar() { clearTimeout(temporizador); temporizador = setTimeout(pintarMenu, 90); }

    // Es el menu de Nexo: siempre activo.
    document.body.classList.add("menu-simple");

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
        pintarMenu();
        const pantalla = document.getElementById("pantallaHubMenu");
        if (pantalla && pantalla.style.display !== "none" && estado.hubActual) abrirHub(estado.hubActual);
    }).observe(document.body, { attributes: true, attributeFilter: ["class"] });

    document.addEventListener("nexo-funciones-beta", programar);
    document.addEventListener("DOMContentLoaded", () => { programar(); vigilarPantallas(); });
    setTimeout(vigilarPantallas, 0);
    window.addEventListener("load", programar);
})();
