/* Practica con Nexo (celular /dueno): el mismo tutorial con la mascota, dentro de la app de verdad.
   Se vende con productos de ejemplo que solo viven en el telefono mientras dura la practica: el catalogo guardado, las ventas y el servidor
   no se tocan (se cambian por unos de mentira y al terminar se restauran). Capitulos: cobrar una venta (buscar, agregar, cobrar, ticket) y
   conocer el escaner de la camara. Se abre desde Mas -> Practicar con Nexo o desde la invitacion en Inicio.
   (El motor es el mismo que el de la computadora, practica-nexo.js, adaptado a pantalla de celular.) */
(function () {
    const LLAVE_VISTA = "nexoDuenoPracticaVista";
    const mascota = pose => `/img/nexo-ia/${pose}-hd.webp`;
    const esc = valor => String(valor ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
    const dinero = valor => "$" + Number(valor || 0).toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const pausa = ms => new Promise(r => setTimeout(r, ms));

    // ---------- productos de ejemplo ----------
    function imagen(emoji, c1, c2) {
        const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${c1}"/><stop offset="1" stop-color="${c2}"/></linearGradient></defs><rect width="120" height="120" rx="22" fill="url(#g)"/><text x="60" y="80" font-size="62" text-anchor="middle">${emoji}</text></svg>`;
        return "data:image/svg+xml;utf8," + encodeURIComponent(svg);
    }

    function ean13(cuerpo12) {
        const d = String(cuerpo12).padStart(12, "0").slice(0, 12).split("").map(Number);
        const suma = d.reduce((s, n, i) => s + n * (i % 2 ? 3 : 1), 0);
        return d.join("") + ((10 - (suma % 10)) % 10);
    }

    const prod = (id, cuerpo, nombre, marca, precio, stock, emoji, c1, c2, categoria) => ({
        id, codigo: ean13(cuerpo), nombre, marca, categoria, precio, precioPublico: precio, precioMayoreo: precio, precioDistribuidor: precio, costo: Math.round(precio * 0.7 * 100) / 100,
        stock, stockMinimo: 3, unidadVenta: "pieza", imagenUrl: imagen(emoji, c1, c2), activo: true, practica: true
    });

    const SETS = {
        abarrotes: {
            productos: [
                prod(9001, "750100000001", "Doritos Nacho Rojos 58 g", "Sabritas", 18, 24, "🌮", "#fde68a", "#f97316", "Botanas"),
                prod(9002, "750100000002", "Coca-Cola 600 ml", "Coca-Cola", 20, 36, "🥤", "#fecaca", "#dc2626", "Bebidas"),
                prod(9003, "750100000003", "Sabritas Original 45 g", "Sabritas", 17, 30, "🥔", "#fef08a", "#eab308", "Botanas"),
                prod(9004, "750100000004", "Marías Gamesa 185 g", "Gamesa", 15, 18, "🍪", "#fde68a", "#d97706", "Galletas"),
                prod(9005, "750100000005", "Leche Lala entera 1 L", "Lala", 28, 12, "🥛", "#dbeafe", "#3b82f6", "Lácteos")
            ],
            busquedas: [{ id: 9001, escribe: "dori", nombre: "Doritos" }, { id: 9002, escribe: "coca", nombre: "Coca-Cola" }]
        },
        ferreteria: {
            productos: [
                prod(9001, "750100000006", "Martillo de uña 16 oz", "Truper", 135, 14, "🔨", "#e2e8f0", "#64748b", "Herramientas manuales"),
                prod(9002, "750100000007", "Pinzas de presión 10\"", "Truper", 145, 10, "🔧", "#dbeafe", "#2563eb", "Herramientas manuales"),
                prod(9003, "750100000008", "Taladro percutor 650 W", "Truper", 1499, 4, "⚡", "#fde68a", "#f59e0b", "Herramientas eléctricas"),
                prod(9004, "750100000009", "Flexómetro 5 m", "Truper", 89, 22, "📏", "#fef08a", "#ca8a04", "Medición"),
                prod(9005, "750100000010", "Cinta de aislar negra 18 m", "Pretul", 28, 40, "🧵", "#e5e7eb", "#1f2937", "Electricidad")
            ],
            busquedas: [{ id: 9001, escribe: "marti", nombre: "Martillo" }, { id: 9002, escribe: "pinz", nombre: "Pinzas" }]
        }
    };

    // Fotos reales de cada producto de ejemplo (public/img/practica), precargadas al empezar; si alguna falla se usa el dibujo con emoji
    const FOTOS = { abarrotes: ["doritos", "cocacola", "sabritas", "marias", "leche"], ferreteria: ["martillo", "pinzas", "taladro", "flexometro", "cinta"] };

    for (const [giroSet, slugs] of Object.entries(FOTOS)) {
        SETS[giroSet].productos.forEach((p, i) => { p.imagenRespaldo = p.imagenUrl; p.imagenUrl = `/img/practica/${slugs[i]}.webp`; });
    }

    function precargarFotos(productos) {
        const una = p => new Promise(resolver => {
            const img = new Image();
            img.onload = () => resolver();
            img.onerror = () => { p.imagenUrl = p.imagenRespaldo || p.imagenUrl; resolver(); };
            img.src = p.imagenUrl;
        });
        return Promise.race([Promise.all(productos.map(una)), pausa(4000)]);
    }

    const estado = { activa: false, cancelado: false, set: null, productos: [], ventas: [], guardado: null, objetivo: null, soloVer: false, esperando: null, paso: 0, totalPasos: 0, capitulo: "", alTerminar: null };
    const giro = () => (window.duenoGiro && window.duenoGiro.ferreteriaSolo) ? "ferreteria" : "abarrotes";
    const plano = t => String(t || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

    // ---------- catalogo y servidor de mentira ----------
    function instalarDatos() {
        estado.guardado = {
            fetchAutenticado: window.fetchAutenticado, buscar: window.buscarEnCatalogoLocal, listar: window.listarCatalogoLocal,
            guardarCatalogo: window.guardarCatalogoLocal, completo: window.listarCatalogoLocalCompletoDueno,
            carrito: typeof duenoVentaCarrito !== "undefined" ? duenoVentaCarrito : []
        };

        window.guardarCatalogoLocal = async () => {};
        window.buscarEnCatalogoLocal = async texto => {
            const palabras = plano(texto).split(/\s+/).filter(Boolean);
            if (!palabras.length) return [];
            return estado.productos.filter(p => palabras.every(w => plano(`${p.nombre} ${p.marca} ${p.codigo}`).includes(w)));
        };
        window.listarCatalogoLocal = async () => estado.productos.slice();
        window.listarCatalogoLocalCompletoDueno = async () => estado.productos.slice();

        window.fetchAutenticado = async function (url, opciones = {}) {
            const metodo = String(opciones.method || "GET").toUpperCase();
            const ruta = String(url).split("?")[0];

            if (metodo === "GET") {
                if (ruta === "/productos") return estado.productos.slice();
                return estado.guardado.fetchAutenticado.apply(this, arguments);
            }

            if (ruta === "/ventas" && metodo === "POST") {
                let cuerpo = {};
                try { cuerpo = JSON.parse(opciones.body); } catch (error) { /* sin cuerpo */ }
                (cuerpo.productos || []).forEach(item => { const p = estado.productos.find(x => x.id === item.id); if (p) p.stock = Math.max(0, p.stock - Number(item.cantidad || 0)); });
                const numero = estado.ventas.length + 1;
                estado.ventas.push({ numero, total: Number(cuerpo.total) || 0 });
                return { ok: true, success: true, folio: `PRÁCTICA-${numero}`, codigoPublico: cuerpo.codigoPublico || "PRACTICA", ventaId: 90000 + numero };
            }

            return { ok: true, success: true, practica: true };
        };

        try { duenoVentaCarrito = []; } catch (error) { /* sin carrito */ }
    }

    async function restaurarDatos() {
        const g = estado.guardado;
        if (!g) return;
        window.fetchAutenticado = g.fetchAutenticado;
        window.buscarEnCatalogoLocal = g.buscar;
        window.listarCatalogoLocal = g.listar;
        window.guardarCatalogoLocal = g.guardarCatalogo;
        window.listarCatalogoLocalCompletoDueno = g.completo;
        try { duenoVentaCarrito = Array.isArray(g.carrito) ? g.carrito : []; if (typeof renderCarritoVenderDueno === "function") renderCarritoVenderDueno(); } catch (error) { /* sin carrito */ }
        try { document.getElementById("duenoVenderBuscar") && (document.getElementById("duenoVenderBuscar").value = ""); } catch (error) { /* sin buscador */ }
        try { document.getElementById("duenoVenderCobroOverlay")?.classList.remove("abierta"); } catch (error) { /* sin cobro */ }
    }

    // ---------- piezas visuales ----------
    const crear = (clase, html) => { const e = document.createElement("div"); e.className = clase; if (html != null) e.innerHTML = html; return e; };
    const hayMovimiento = () => !(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);

    function montarCapa() {
        document.getElementById("dpxCapa")?.remove();
        const c = crear("dpx-capa");
        c.id = "dpxCapa";
        c.innerHTML = `
            <div class="dpx-bloque" data-b="arriba"></div><div class="dpx-bloque" data-b="izq"></div><div class="dpx-bloque" data-b="der"></div><div class="dpx-bloque" data-b="abajo"></div>
            <div class="dpx-anillo" id="dpxAnillo" hidden></div>
            <div class="dpx-escudo" id="dpxEscudo" hidden></div>
            <div class="dpx-banda" id="dpxBanda"></div>
            <div class="dpx-mascota" id="dpxMascota">
                <img id="dpxImagen" src="${mascota("feliz")}" alt="Nexo">
                <div class="dpx-burbuja" id="dpxBurbuja"><div id="dpxTexto"></div><div class="dpx-pie" id="dpxPie"></div><div class="dpx-botones"><button type="button" class="dpx-continuar" id="dpxContinuar" hidden></button><button type="button" class="dpx-secundario" id="dpxSecundario" hidden></button></div></div>
            </div>`;
        document.body.appendChild(c);
        c.querySelectorAll(".dpx-bloque, .dpx-escudo").forEach(b => b.addEventListener("click", evento => { evento.preventDefault(); evento.stopPropagation(); regañar(); }));
    }

    function pintarBanda() {
        const b = document.getElementById("dpxBanda");
        if (!b) return;
        b.innerHTML = `<i>PRÁCTICA</i><span class="dpx-pasos">${Array.from({ length: estado.totalPasos }, (_, i) => `<s class="${i <= estado.paso ? "on" : ""}"></s>`).join("")}</span><button type="button" id="dpxSaltar">Salir</button>`;
        b.querySelector("#dpxSaltar").onclick = saltar;
    }

    const ponerPose = pose => { const img = document.getElementById("dpxImagen"); if (img && !img.src.endsWith(mascota(pose))) img.src = mascota(pose); };

    function hablar(texto, pie) {
        document.getElementById("dpxTexto").innerHTML = texto;
        document.getElementById("dpxPie").textContent = pie || "";
        const b = document.getElementById("dpxBurbuja");
        if (hayMovimiento()) { b.classList.remove("dpx-nueva"); void b.offsetWidth; b.classList.add("dpx-nueva"); }
    }

    let tRegaño = null;
    function regañar() {
        const b = document.getElementById("dpxBurbuja");
        if (!b) return;
        ponerPose("alerta");
        b.classList.remove("dpx-sacude"); void b.offsetWidth; b.classList.add("dpx-sacude");
        const pie = document.getElementById("dpxPie");
        pie.textContent = estado.pieRegaño || "¡Espera! Primero terminemos este paso 😊";
        clearTimeout(tRegaño);
        tRegaño = setTimeout(() => { if (estado.activa) { ponerPose(estado.poseActual || "neutral"); pie.textContent = estado.pieActual || ""; } }, 1800);
    }

    function posicionarHueco() {
        const c = document.getElementById("dpxCapa");
        if (!c) return;
        const [arriba, izq, der, abajo] = ["arriba", "izq", "der", "abajo"].map(n => c.querySelector(`[data-b="${n}"]`));
        const anillo = document.getElementById("dpxAnillo"), escudo = document.getElementById("dpxEscudo");
        const vw = window.innerWidth, vh = window.innerHeight;
        const objetivo = estado.objetivo ? (typeof estado.objetivo === "function" ? estado.objetivo() : document.querySelector(estado.objetivo)) : null;
        const r = objetivo && objetivo.getBoundingClientRect ? objetivo.getBoundingClientRect() : null;

        if (!r || r.width === 0 || r.height === 0) {
            Object.assign(arriba.style, { left: 0, top: 0, width: "100%", height: "100%" });
            [izq, der, abajo].forEach(b => Object.assign(b.style, { width: 0, height: 0 }));
            anillo.hidden = true; escudo.hidden = true; estado.hueco = null;
            colocarMascota();
            return;
        }

        const m = 6, x = Math.max(0, r.left - m), y = Math.max(0, r.top - m), x2 = Math.min(vw, r.right + m), y2 = Math.min(vh, r.bottom + m);
        estado.hueco = { x, y, x2, y2 };
        Object.assign(arriba.style, { left: 0, top: 0, width: "100%", height: y + "px" });
        Object.assign(abajo.style, { left: 0, top: y2 + "px", width: "100%", height: Math.max(0, vh - y2) + "px" });
        Object.assign(izq.style, { left: 0, top: y + "px", width: x + "px", height: (y2 - y) + "px" });
        Object.assign(der.style, { left: x2 + "px", top: y + "px", width: Math.max(0, vw - x2) + "px", height: (y2 - y) + "px" });
        Object.assign(anillo.style, { left: x + "px", top: y + "px", width: (x2 - x) + "px", height: (y2 - y) + "px" });
        anillo.hidden = false;
        escudo.hidden = !estado.soloVer;
        Object.assign(escudo.style, { left: x + "px", top: y + "px", width: (x2 - x) + "px", height: (y2 - y) + "px" });
        colocarMascota();
    }

    // en el celular la mascota y su globo van abajo; si lo iluminado esta abajo, se van arriba
    function colocarMascota() {
        const m = document.getElementById("dpxMascota");
        if (!m) return;
        const h = estado.hueco, vh = window.innerHeight;
        m.classList.toggle("dpx-centro", !h);
        if (!h) { m.style.top = ""; m.style.bottom = ""; return; }
        const alto = 250;
        const abajoLibre = h.y2 < vh - alto - 8;
        m.classList.toggle("dpx-arriba", !abajoLibre);
        if (abajoLibre) { m.style.top = "auto"; m.style.bottom = "8px"; } else { m.style.bottom = "auto"; m.style.top = "58px"; }
    }

    // ---------- pasos ----------
    function pasosVender() {
        const [a, b] = estado.set.busquedas;
        const pa = estado.productos.find(p => p.id === a.id), pb = estado.productos.find(p => p.id === b.id);
        const total = pa.precio + pb.precio;
        const tiene = id => typeof duenoVentaCarrito !== "undefined" && duenoVentaCarrito.some(p => p.id === id);
        const escrito = f => String(document.getElementById("duenoVenderBuscar")?.value || "").toLowerCase().includes(f);

        return [
            { pose: "feliz", texto: `Esta es tu <b>caja en el celular</b>. Vamos a hacer tu <b>primera venta</b> con productos de ejemplo.`, pie: "Nada de esto es de verdad", boton: "Vamos" },
            { pose: "pensando", texto: `Escribe <b>“${esc(a.nombre)}”</b> para buscarlo.`, objetivo: ".dueno-buscar-fila", antes: () => document.getElementById("duenoVenderBuscar")?.focus(), cuando: () => escrito(a.escribe) },
            { pose: "feliz", texto: `Toca el <b>+</b> para meterlo al carrito.`, objetivo: "#duenoVenderResultados", cuando: () => tiene(a.id) },
            { pose: "pensando", texto: `También quiere <b>${esc(b.nombre)}</b>: escribe <b>“${esc(b.escribe)}”</b>.`, objetivo: ".dueno-buscar-fila", antes: () => { const c = document.getElementById("duenoVenderBuscar"); if (c) { c.value = ""; c.dispatchEvent(new Event("input")); c.focus(); } }, cuando: () => escrito(b.escribe) },
            { pose: "feliz", texto: `Agrégalo también con el <b>+</b>.`, objetivo: "#duenoVenderResultados", cuando: () => tiene(b.id) },
            { pose: "neutral", texto: `Aquí ves <b>lo que lleva tu cliente</b> y el <b>total</b>. Con los botones cambias cuántos lleva.`, pie: `Total: ${dinero(total)}`, objetivo: "#duenoVenderCarritoCard", soloVer: true, boton: "Entendido" },
            { pose: "pensando", texto: `Ahora <b>cóbralo</b>: toca <b>Cobrar</b>.`, objetivo: "#duenoVenderCarritoCard .dueno-boton-primario", cuando: () => Boolean(document.getElementById("duenoVenderCobroOverlay")?.classList.contains("abierta")) },
            { pose: "feliz", texto: `Para cobrar rápido toca <b>Efectivo justo</b>: el cliente paga exacto. Si te da más, elige <b>Efectivo</b> abajo y escribe cuánto.`, pie: "También hay tarjeta, transferencia, fiado y mixto", objetivo: () => { const b = [...document.querySelectorAll("#duenoVenderCobroContenido button")].find(x => /Efectivo justo/i.test(x.textContent)); return b ? b.parentElement : null; }, cuando: () => estado.ventas.length >= 1, esperaPost: 1200 },
            { pose: "celebrando", texto: `¡<b>Primera venta lista</b>! Aquí puedes <b>imprimir</b> el ticket, mandarlo por <b>WhatsApp</b> o mostrar su <b>QR</b> para que tu cliente lo escanee.`, objetivo: ".dtk-acciones, #duenoVenderCobroContenido", soloVer: true, boton: "Seguir" }
        ];
    }

    function pasosEscaner() {
        return [
            { pose: "pensando", texto: `Ahora lo mejor del celular: la <b>cámara como lector</b>. Aquí está.`, pie: "Apuntas al código de barras y el producto se agrega solo", objetivo: () => document.querySelector('#duenoVender .dueno-buscar-fila button[title^="Escanear"]'), soloVer: true, boton: "Entendido" },
            { pose: "feliz", texto: `Y si el producto no tiene código, <b>tómale una foto</b> y Nexo lo reconoce.`, objetivo: () => document.querySelector("#duenoVender .dueno-boton-camara"), soloVer: true, boton: "Entendido" },
            { pose: "celebrando", texto: `Con eso ya sabes <b>cobrar</b> desde tu celular. Falta un último recorrido por tu app.`, boton: "Seguir" }
        ];
    }

    // Recorrido por la app: la barra de abajo y lo que hay en Más
    const pestana = nombre => () => document.querySelector(`#duenoTabs button[data-tab="${nombre}"]`);
    const fila = texto => () => [...document.querySelectorAll("#duenoMasCategorias .dueno-categoria-row")].find(x => plano(x.textContent).includes(plano(texto)));

    function pasosRecorrido() {
        return [
            { pose: "feliz", texto: `Ahora un <b>recorrido por tu app</b>. Es corto: solo mira y toca <b>Entendido</b>.`, boton: "Vamos" },
            { pose: "neutral", texto: `<b>Inicio</b>: cómo va tu día. Ventas, caja y avisos de un vistazo.`, objetivo: pestana("inicio"), soloVer: true, boton: "Entendido", antes: () => cambiarTabDueno("inicio") },
            { pose: "neutral", texto: `<b>Vender</b>: tu caja. Ya la usaste 😉`, objetivo: pestana("vender"), soloVer: true, boton: "Entendido" },
            { pose: "neutral", texto: `<b>Caja</b>: abrir y cerrar el turno, y ver cuánto dinero hay.`, objetivo: pestana("caja"), soloVer: true, boton: "Entendido" },
            { pose: "pensando", texto: `<b>Más</b>: todo lo demás vive aquí. Vamos a verlo.`, objetivo: pestana("mas"), soloVer: true, boton: "Abrir Más", antes: () => { cambiarTabDueno("mas"); try { renderCategoriasMasDueno(); } catch (error) { /* sin lista */ } } },
            { pose: "neutral", texto: `<b>Reportes</b>: tus ventas del día, la semana y el mes.`, objetivo: fila("Reportes"), soloVer: true, boton: "Entendido", omitir: () => !fila("Reportes")() },
            { pose: "neutral", texto: `<b>Inventario</b>: tu catálogo completo para consultar precios y existencias.`, objetivo: fila("Inventario"), soloVer: true, boton: "Entendido", omitir: () => !fila("Inventario")() },
            { pose: "neutral", texto: `<b>Créditos</b>: quién te debe y cuánto. Aquí registras los abonos.`, objetivo: fila("Creditos"), soloVer: true, boton: "Entendido", omitir: () => !fila("Creditos")() },
            { pose: "neutral", texto: `<b>Tareas y avisos</b>: lo que toca hoy y los mensajes de tu equipo.`, objetivo: fila("Tareas y avisos"), soloVer: true, boton: "Entendido", omitir: () => !fila("Tareas y avisos")() },
            { pose: "neutral", texto: `<b>Empleados</b>: das de alta a tu gente con su PIN y decides qué puede hacer cada uno.`, objetivo: fila("Empleados"), soloVer: true, boton: "Entendido", omitir: () => !fila("Empleados")() },
            { pose: "celebrando", texto: `¡Listo! Ya conoces tu app. Si algo no lo encuentras, <b>pregúntale a Nexo IA</b> desde la computadora o vuelve a esta práctica desde <b>Más</b>.`, boton: "Terminar", antes: () => cambiarTabDueno("inicio") }
        ];
    }

    const CAPITULOS = [
        { id: "vender", titulo: "Cobrar una venta", pasos: pasosVender, entrar: () => { if (typeof cambiarTabDueno === "function") cambiarTabDueno("vender"); try { if (typeof renderCarritoVenderDueno === "function") renderCarritoVenderDueno(); } catch (error) { /* sin carrito */ } },
          salir: () => { try { if (typeof finalizarVentaVenderDueno === "function") finalizarVentaVenderDueno(); } catch (error) { /* sin cobro */ } document.getElementById("duenoVenderCobroOverlay")?.classList.remove("abierta"); } },
        { id: "escaner", titulo: "El escáner de la cámara", pasos: pasosEscaner, entrar: () => { if (typeof cambiarTabDueno === "function") cambiarTabDueno("vender"); const c = document.getElementById("duenoVenderBuscar"); if (c) { c.value = ""; c.dispatchEvent(new Event("input")); } } },
        { id: "recorrido", titulo: "Recorrido por tu app", pasos: pasosRecorrido, entrar: () => { if (typeof cambiarTabDueno === "function") cambiarTabDueno("inicio"); } }
    ];

    // ---------- motor ----------
    function esperarPaso(paso) {
        const boton = document.getElementById("dpxContinuar"), secundario = document.getElementById("dpxSecundario");

        return new Promise(resolver => {
            estado.esperando = resolver;
            let terminado = false;
            const listo = valor => { if (!terminado) { terminado = true; clearInterval(reloj); resolver(valor); } };

            boton.hidden = !paso.boton;
            if (paso.boton) { boton.textContent = paso.boton; boton.onclick = () => listo(); }
            secundario.hidden = !paso.secundario;
            if (paso.secundario) { secundario.textContent = paso.secundario.texto; secundario.onclick = () => listo(paso.secundario.valor || "omitirCapitulo"); }

            const reloj = setInterval(() => {
                if (estado.cancelado) return listo();
                posicionarHueco();
                if (paso.cuando) { try { if (paso.cuando()) listo(); } catch (error) { /* se sigue esperando */ } }
            }, 140);
        });
    }

    async function correr(capitulo) {
        if (capitulo.entrar) capitulo.entrar();
        await pausa(800);

        const pasos = capitulo.pasos();
        estado.capitulo = capitulo.titulo;
        estado.totalPasos = pasos.length;

        for (let i = 0; i < pasos.length; i++) {
            if (estado.cancelado) return false;
            const paso = pasos[i];
            if (paso.omitir && paso.omitir()) continue;
            estado.paso = i;
            estado.objetivo = paso.objetivo || null;
            estado.soloVer = Boolean(paso.soloVer);
            estado.poseActual = paso.pose || "feliz";
            estado.pieActual = paso.pie || "";
            estado.pieRegaño = paso.soloVer ? "Por ahora solo mira 👀 · toca el botón para seguir" : "";
            try {
                const destino = typeof paso.objetivo === "function" ? paso.objetivo() : (paso.objetivo ? document.querySelector(paso.objetivo) : null);
                if (destino && destino.nodeType === 1 && destino.scrollIntoView) destino.scrollIntoView({ block: "center", behavior: "smooth" });
            } catch (error) { /* sin desplazamiento */ }
            pintarBanda();
            ponerPose(estado.poseActual);
            hablar(paso.texto, paso.pie);
            if (paso.antes) { try { paso.antes(); } catch (error) { /* sigue */ } }
            posicionarHueco();
            const resultado = await esperarPaso(paso);
            if (estado.cancelado) return false;
            if (resultado === "omitirCapitulo") break;
            if (resultado === "omitirPaso") continue;
            if (paso.cuando && !paso.boton) { ponerPose("celebrando"); await pausa(paso.esperaPost || 600); }
        }

        if (capitulo.salir) { try { capitulo.salir(); } catch (error) { /* sin limpieza */ } }
        return true;
    }

    function pantallaCompleta(html, fondo) {
        document.getElementById("dpxPantalla")?.remove();
        const p = crear("dpx-pantalla", html);
        p.id = "dpxPantalla";
        p.style.background = fondo;
        document.body.appendChild(p);
        return p;
    }

    function bienvenida() {
        return new Promise(resolver => {
            const p = pantallaCompleta(`<div class="dpx-pantalla-int">
                    <img class="dpx-grande" src="${mascota("feliz")}" alt="Nexo">
                    <div class="dpx-etiqueta">PRACTICA CON NEXO</div>
                    <h1>Vamos a practicar<br>en tu celular</h1>
                    <p>Cobra una venta con productos de ejemplo. Es rápido y no se guarda nada en tu negocio.</p>
                    <button type="button" class="dpx-gigante" id="dpxComenzar">Comenzar</button>
                    <button type="button" class="dpx-ligero" id="dpxAhoraNo">Ahora no</button>
                </div>`, "radial-gradient(900px 600px at 70% 10%, #3b6dff 0%, #1b2a6b 50%, #0b1236 100%)");
            const salir = valor => { p.classList.add("dpx-sale"); setTimeout(() => { p.remove(); resolver(valor); }, 380); };
            p.querySelector("#dpxComenzar").onclick = () => salir(true);
            p.querySelector("#dpxAhoraNo").onclick = () => salir(false);
        });
    }

    function despedida(logros) {
        return new Promise(resolver => {
            const p = pantallaCompleta(`<div class="dpx-pantalla-int">
                    <img class="dpx-grande" src="${mascota("celebrando")}" alt="Nexo">
                    <h1>¡Ya sabes cobrar!</h1>
                    <div class="dpx-logros">${logros.map(([i, t]) => `<div><span>${i}</span>${esc(t)}</div>`).join("")}</div>
                    <p>Los productos de práctica ya se borraron. Tu negocio sigue limpio.</p>
                    <button type="button" class="dpx-gigante" id="dpxEntrar">Entrar a mi negocio</button>
                </div>`, "radial-gradient(900px 600px at 30% 10%, #34d399 0%, #0f766e 45%, #0b2b4a 100%)");
            p.querySelector("#dpxEntrar").onclick = () => { p.classList.add("dpx-zoom"); setTimeout(() => { p.remove(); resolver(); }, 600); };
        });
    }

    function marcar(resultado) { try { localStorage.setItem(LLAVE_VISTA, resultado); } catch (error) { /* sin almacenamiento */ } }

    function saltar() {
        if (!estado.activa) return;
        if (!confirm("¿Salir de la práctica? Puedes repetirla desde Más.")) return;
        estado.cancelado = true;
        if (estado.esperando) estado.esperando();
    }

    async function terminar(resultado) {
        const ventas = estado.ventas.length;
        document.getElementById("dpxCapa")?.remove();
        clearTimeout(tRegaño);
        estado.activa = false;
        document.body.classList.remove("dpx-activa");
        await restaurarDatos();
        if (resultado === "hecha") await despedida([["🛒", ventas === 1 ? "Cobraste tu primera venta" : `Cobraste ${ventas} ventas`], ["📷", "Conociste el escáner"]]);
        estado.cancelado = false; estado.ventas = [];
        marcar(resultado);
        document.getElementById("duenoEquipoPracticaInvitacion")?.remove();
        if (typeof cambiarTabDueno === "function") cambiarTabDueno("inicio");
        if (typeof estado.alTerminar === "function") estado.alTerminar(resultado);
        estado.alTerminar = null;
    }

    async function iniciar(opciones = {}) {
        if (estado.activa) return;
        estado.set = SETS[giro()];
        estado.productos = JSON.parse(JSON.stringify(estado.set.productos));
        estado.ventas = [];
        estado.cancelado = false;
        estado.alTerminar = opciones.alTerminar || null;
        await precargarFotos(estado.productos);

        const empezar = await bienvenida();
        if (!empezar) { marcar("saltada"); document.getElementById("duenoPracticaInvitacion")?.remove(); return; }

        estado.activa = true;
        document.body.classList.add("dpx-activa");
        instalarDatos();
        montarCapa();

        let completa = true;
        for (const capitulo of CAPITULOS) { completa = await correr(capitulo); if (!completa) break; }
        await terminar(completa ? "hecha" : "saltada");
    }

    // ---------- invitacion en Inicio (una vez, se puede cerrar) ----------
    function invitar() {
        try { if (localStorage.getItem(LLAVE_VISTA)) return; } catch (error) { /* sin almacenamiento */ }
        const tabs = document.getElementById("duenoTabs");
        const inicio = document.getElementById("duenoApp");
        if (!tabs || tabs.style.display === "none" || !inicio || document.getElementById("duenoPracticaInvitacion")) return;

        const grid = inicio.querySelector(".dueno-grid");
        const tarjeta = crear("dt-invitacion", `<button type="button" class="dt-invitacion-cuerpo" onclick="practicaCelular.iniciar()"><span aria-hidden="true">🎓</span><span><b>Practica con Nexo</b><small>Cobra una venta de ejemplo con la mascota. Tarda 3 minutos.</small></span></button><button type="button" class="dt-invitacion-cerrar" aria-label="Ahora no" onclick="practicaCelular.cerrarInvitacion()">✕</button>`);
        tarjeta.id = "duenoPracticaInvitacion";
        if (grid) grid.parentNode.insertBefore(tarjeta, grid); else inicio.appendChild(tarjeta);
    }

    window.practicaCelular = {
        iniciar, activa: () => estado.activa, estado,
        cerrarInvitacion: () => { marcar("saltada"); document.getElementById("duenoPracticaInvitacion")?.remove(); }
    };
    window.addEventListener("resize", () => { if (estado.activa) posicionarHueco(); });
    setTimeout(invitar, 4500);
    setTimeout(invitar, 12000);
})();
