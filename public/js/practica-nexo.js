/* Practica con Nexo (computadora): un tutorial DENTRO del mismo programa, con la mascota, que ensena haciendo.
   Se usa el punto de venta de verdad, pero con productos de ejemplo (solo viven en el navegador mientras dura la practica):
   las ventas de practica nunca llegan al servidor, ni al inventario, ni a los reportes del negocio real.

   Como funciona:
   - Datos de ejemplo: un conjunto para abarrotes y otro para ferreteria. /productos devuelve esos y las escrituras (POST/PUT/DELETE) se
     contestan "ok" sin salir del navegador. Al terminar se restaura todo.
   - Guia: la mascota da una instruccion corta, se oscurece la pantalla y se ilumina SOLO lo que toca; un clic fuera del recuadro no hace nada
     ("¡Espera! Primero..."). Cada paso se cumple haciendo la accion de verdad.
   - Capitulos: hoy "Cobrar tu primera venta". Los demas (resultados, agregar producto, recorrido, celular) se agregan a la lista CAPITULOS.
   Se ofrece al terminar el asistente de inicio de una cuenta nueva y se puede repetir desde Configuracion -> Practicar con Nexo. */
(function () {
    const LLAVE_VISTA = "nexoPracticaVista";
    const mascota = pose => `/img/nexo-ia/${pose}-hd.webp`;
    const esc = valor => String(valor ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
    const dinero = valor => "$" + Number(valor || 0).toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const pausa = ms => new Promise(r => setTimeout(r, ms));

    // ---------- productos de ejemplo ----------
    function imagen(emoji, c1, c2) {
        const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${c1}"/><stop offset="1" stop-color="${c2}"/></linearGradient></defs><rect width="120" height="120" rx="22" fill="url(#g)"/><text x="60" y="80" font-size="62" text-anchor="middle">${emoji}</text></svg>`;
        return "data:image/svg+xml;utf8," + encodeURIComponent(svg);
    }

    const base = (id, codigo, nombre, marca, precio, stock, emoji, c1, c2, categoria = "Ejemplo") => ({
        id, codigo, nombre, marca, categoria, precio, precio_publico: precio, precio_mayoreo: precio, precio_distribuidor: precio, costo: Math.round(precio * 0.7 * 100) / 100,
        stock, stock_minimo: 3, unidad_venta: "pieza", imagenUrl: imagen(emoji, c1, c2), activo: true, visible_pos: true, practica: true
    });

    const SETS = {
        abarrotes: {
            nombre: "Abarrotes La Esquina",
            productos: [
                base(9001, "7501000000011", "Doritos Nacho 58 g", "Sabritas", 18, 24, "🌮", "#fde68a", "#f97316", "Botanas"),
                base(9002, "7501000000028", "Coca-Cola 600 ml", "Coca-Cola", 20, 36, "🥤", "#fecaca", "#dc2626", "Bebidas"),
                base(9003, "7501000000035", "Sabritas Originales 45 g", "Sabritas", 17, 30, "🥔", "#fef08a", "#eab308", "Botanas"),
                base(9004, "7501000000042", "Galletas Marías 170 g", "Gamesa", 15, 18, "🍪", "#fde68a", "#d97706", "Galletas"),
                base(9005, "7501000000059", "Leche entera 1 L", "Lala", 28, 12, "🥛", "#dbeafe", "#3b82f6", "Lácteos")
            ],
            busquedas: [{ id: 9001, escribe: "dori", nombre: "Doritos" }, { id: 9002, escribe: "coca", nombre: "Coca-Cola" }]
        },
        ferreteria: {
            nombre: "Ferretería La Esquina",
            productos: [
                base(9001, "7501000000066", "Martillo de uña 16 oz", "Truper", 135, 14, "🔨", "#e2e8f0", "#64748b", "Herramientas manuales"),
                base(9002, "7501000000073", "Pinzas de presión 10\"", "Truper", 145, 10, "🔧", "#dbeafe", "#2563eb", "Herramientas manuales"),
                base(9003, "7501000000080", "Taladro percutor 800 W", "Truper", 1499, 4, "⚡", "#fde68a", "#f59e0b", "Herramientas eléctricas"),
                base(9004, "7501000000097", "Flexómetro 5 m", "Truper", 89, 22, "📏", "#fef08a", "#ca8a04", "Medición"),
                base(9005, "7501000000103", "Cinta de aislar negra", "Volteck", 28, 40, "🧵", "#e5e7eb", "#1f2937", "Electricidad")
            ],
            busquedas: [{ id: 9001, escribe: "marti", nombre: "Martillo" }, { id: 9002, escribe: "pinz", nombre: "Pinzas" }]
        }
    };

    // Ventas "de la mañana" para que los resultados no se vean vacios: son de ejemplo y se mezclan con la venta que haces tu
    // [minutos antes de ahora, metodo, [[producto, cantidad], ...]]
    const HORAS_SEMILLA = [[330, "efectivo", [[0, 2], [1, 1]]], [285, "efectivo", [[2, 1], [3, 2]]], [225, "tarjeta", [[4, 1], [1, 2]]], [170, "efectivo", [[0, 1]]], [125, "efectivo", [[1, 3], [3, 1]]], [80, "tarjeta", [[2, 2], [4, 1]]], [35, "efectivo", [[0, 3], [1, 1]]]];
    const AYER = { total: 280, transacciones: 6, ticket_promedio: 46, productos_vendidos: 15 };

    function ventasSemilla(productos) {
        const hoy = new Date();
        return HORAS_SEMILLA.map(([minutosAntes, metodo, lineas], i) => {
            const items = lineas.map(([k, cantidad]) => ({ id: productos[k].id, nombre: productos[k].nombre, categoria: productos[k].categoria, cantidad, precio: productos[k].precio, total: productos[k].precio * cantidad }));
            // nunca antes de la medianoche: sigue siendo "hoy"
            const inicioDia = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate(), 0, 5).getTime();
            const fecha = new Date(Math.max(inicioDia + i * 60000, hoy.getTime() - minutosAntes * 60000));
            return { id: 80001 + i, fecha: fecha.toISOString(), metodo, total: items.reduce((s, x) => s + x.total, 0), productos: items, semilla: true };
        });
    }

    function construirReporte() {
        const todas = [...estado.semillas, ...estado.ventas].sort((a, b) => new Date(b.fecha) - new Date(a.fecha));
        const suma = (lista, f) => lista.reduce((s, x) => s + f(x), 0);
        const total = suma(todas, v => v.total);
        const piezas = suma(todas, v => suma(v.productos, p => p.cantidad));
        const agrupar = (clave, valor) => { const m = new Map(); todas.forEach(v => v.productos.forEach(p => { const k = clave(v, p); const a = m.get(k) || { cantidad: 0, total: 0 }; a.cantidad += p.cantidad; a.total += valor(p); m.set(k, a); })); return m; };
        const porProducto = [...agrupar((v, p) => p.nombre, p => p.total)].map(([nombre, d]) => ({ nombre, cantidad: d.cantidad, total: d.total })).sort((a, b) => b.total - a.total);
        const porCategoria = [...agrupar((v, p) => p.categoria || "Otros", p => p.total)].map(([categoria, d]) => ({ categoria, total: d.total })).sort((a, b) => b.total - a.total);
        const porMetodo = new Map(); todas.forEach(v => porMetodo.set(v.metodo, (porMetodo.get(v.metodo) || 0) + v.total));
        const porHora = new Map(); todas.forEach(v => { const h = new Date(v.fecha).getHours(); const a = porHora.get(h) || { transacciones: 0, total: 0 }; a.transacciones++; a.total += v.total; porHora.set(h, a); });
        const hoyISO = new Intl.DateTimeFormat("en-CA").format(new Date());

        return {
            ok: true,
            resumen: { total, transacciones: todas.length, ticket_promedio: todas.length ? total / todas.length : 0, productos_vendidos: piezas },
            resumenAnterior: AYER,
            porDia: [{ dia: hoyISO, total }],
            ultimas: todas.map(v => ({ id: v.numero ? `PRÁCTICA-${v.numero}` : v.id, total: v.total, fecha: v.fecha })),
            metodosPago: [...porMetodo].map(([metodo_pago, t]) => ({ metodo_pago, total: t })),
            productosVendidos: porProducto,
            porHora: [...porHora].sort((a, b) => a[0] - b[0]).map(([h, d]) => ({ hora: `${String(h).padStart(2, "0")}:00`, transacciones: d.transacciones, total: d.total })),
            ventasPorCategoria: porCategoria
        };
    }

    const estado = {
        activa: false, cancelado: false, set: null, productos: [], ventas: [], semillas: [], guardado: null, alTerminar: null,
        paso: 0, totalPasos: 0, capitulo: "", fetchOriginal: null, esperando: null
    };

    const giro = () => (typeof perfilEsSimple === "function" && perfilEsSimple()) || (typeof perfilTieneAbarrotes === "function" && perfilTieneAbarrotes() && !(typeof perfilNegocioActual === "function" && perfilNegocioActual() === "ferreteria")) ? "abarrotes" : "ferreteria";

    // ---------- red de mentira: lo de practica no sale del navegador ----------
    function respuestaJson(datos, estadoHttp = 200) {
        return Promise.resolve(new Response(JSON.stringify(datos), { status: estadoHttp, headers: { "Content-Type": "application/json" } }));
    }

    function instalarRed() {
        estado.fetchOriginal = window.fetch;

        window.fetch = function (entrada, opciones) {
            if (!estado.activa) return estado.fetchOriginal.apply(this, arguments);

            const url = String(entrada && entrada.url ? entrada.url : entrada);
            const metodo = String((opciones && opciones.method) || (entrada && entrada.method) || "GET").toUpperCase();
            const ruta = url.replace(location.origin, "").split("?")[0];

            if (metodo === "GET") {
                if (ruta === "/productos") return respuestaJson(estado.productos);
                // los favoritos de la caja de abarrotes tambien son de ejemplo
                if (ruta === "/reportes/ventas") return respuestaJson(construirReporte());
                if (ruta === "/venta-rapida/favoritos") return respuestaJson({ ok: true, ids: estado.productos.map(p => p.id), sugeridos: [], maximo: 24 });
                return estado.fetchOriginal.apply(this, arguments);
            }

            if (ruta === "/ventas" && metodo === "POST") {
                let cuerpo = {};
                try { cuerpo = JSON.parse(opciones.body); } catch (error) { /* sin cuerpo */ }
                const numero = estado.ventas.length + 1;

                (cuerpo.productos || []).forEach(item => {
                    const p = estado.productos.find(x => Number(x.id) === Number(item.id || item.productoId));
                    if (p) p.stock = Math.max(0, Number(p.stock) - Number(item.cantidad || 0));
                });

                const lineas = (cuerpo.productos || []).map(item => {
                    const p = estado.productos.find(x => Number(x.id) === Number(item.id || item.productoId)) || {};
                    const cantidad = Number(item.cantidad || 0);
                    const precio = Number(item.precio ?? item.precioUnitario ?? p.precio ?? 0);
                    return { id: p.id, nombre: item.nombre || p.nombre || "Producto", categoria: p.categoria, cantidad, precio, total: Number(item.total ?? item.subtotal ?? precio * cantidad) };
                });
                estado.ventas.push({ numero, fecha: new Date().toISOString(), metodo: cuerpo.metodoPago || "efectivo", total: Number(cuerpo.total) || 0, productos: lineas });
                return respuestaJson({ success: true, ok: true, ventaId: 90000 + numero, historialId: 90000 + numero, folio: `PRÁCTICA-${numero}`, fecha: new Date().toISOString() });
            }

            if (ruta === "/agregar-producto" && metodo === "POST") {
                let c = {};
                try { c = JSON.parse(opciones.body); } catch (error) { /* sin cuerpo */ }
                const precio = Number(c.precioPublico ?? c.precio) || 0;
                const nuevo = { ...base(9100 + estado.productos.length, String(c.codigo || ""), String(c.nombre || "Producto nuevo"), String(c.marca || ""), precio, Number(c.stock) || 0, "🆕", "#dcfce7", "#16a34a", String(c.categoria || "Mis productos")), nuevoDePractica: true };
                estado.productos.unshift(nuevo);
                return respuestaJson({ ok: true, success: true, productoId: nuevo.id, producto: nuevo });
            }

            // cualquier otra escritura: "ok", sin tocar el servidor
            return respuestaJson({ ok: true, success: true, practica: true });
        };
    }

    function quitarRed() {
        if (estado.fetchOriginal) window.fetch = estado.fetchOriginal;
        estado.fetchOriginal = null;
    }

    // ---------- piezas visuales ----------
    function crear(clase, html) {
        const el = document.createElement("div");
        el.className = clase;
        if (html != null) el.innerHTML = html;
        return el;
    }

    const capa = () => document.getElementById("pxCapa");
    const hayMovimiento = () => !(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);

    function montarCapa() {
        document.getElementById("pxCapa")?.remove();
        const c = crear("px-capa");
        c.id = "pxCapa";
        c.innerHTML = `
            <div class="px-bloque" data-b="arriba"></div><div class="px-bloque" data-b="izq"></div><div class="px-bloque" data-b="der"></div><div class="px-bloque" data-b="abajo"></div>
            <div class="px-anillo" id="pxAnillo" hidden></div>
            <div class="px-escudo" id="pxEscudo" hidden></div>
            <div class="px-banda" id="pxBanda"></div>
            <div class="px-mascota" id="pxMascota">
                <img id="pxImagen" src="${mascota("feliz")}" alt="Nexo">
                <div class="px-burbuja" id="pxBurbuja"><div id="pxTexto"></div><div class="px-pie" id="pxPie"></div><button type="button" class="px-continuar" id="pxContinuar" hidden></button></div>
            </div>`;
        document.body.appendChild(c);

        c.querySelectorAll(".px-bloque, .px-escudo").forEach(b => b.addEventListener("click", evento => { evento.preventDefault(); evento.stopPropagation(); regañar(); }));
    }

    function pintarBanda() {
        const banda = document.getElementById("pxBanda");
        if (!banda) return;
        banda.innerHTML = `<i>MODO PRÁCTICA</i><span class="px-titulo">${esc(estado.capitulo)}</span>
            <span class="px-pasos">${Array.from({ length: estado.totalPasos }, (_, i) => `<s class="${i <= estado.paso ? "on" : ""}"></s>`).join("")}</span>
            <button type="button" id="pxSaltar">Saltar práctica</button>`;
        banda.querySelector("#pxSaltar").onclick = saltar;
    }

    function ponerPose(pose) {
        const img = document.getElementById("pxImagen");
        if (img && !img.src.endsWith(mascota(pose))) img.src = mascota(pose);
    }

    function hablar(texto, pie) {
        const t = document.getElementById("pxTexto");
        const p = document.getElementById("pxPie");
        if (t) t.innerHTML = texto;
        if (p) p.textContent = pie || "";
        const b = document.getElementById("pxBurbuja");
        if (b && hayMovimiento()) { b.classList.remove("px-nueva"); void b.offsetWidth; b.classList.add("px-nueva"); }
    }

    let temporizadorRegaño = null;

    function regañar() {
        const b = document.getElementById("pxBurbuja");
        if (!b) return;
        const texto = document.getElementById("pxTexto").innerHTML;
        ponerPose("alerta");
        b.classList.remove("px-sacude"); void b.offsetWidth; b.classList.add("px-sacude");
        clearTimeout(temporizadorRegaño);
        const aviso = document.getElementById("pxPie");
        if (aviso) aviso.textContent = estado.pieRegaño || "¡Espera! Primero terminemos este paso 😊";
        temporizadorRegaño = setTimeout(() => { if (estado.activa) { ponerPose(estado.poseActual || "neutral"); if (aviso) aviso.textContent = estado.pieActual || ""; } }, 1800);
    }

    // recuadro iluminado: deja pasar los clics solo adentro
    function posicionarHueco() {
        const c = capa();
        if (!c) return;
        const [arriba, izq, der, abajo] = ["arriba", "izq", "der", "abajo"].map(n => c.querySelector(`[data-b="${n}"]`));
        const anillo = document.getElementById("pxAnillo");
        const vw = window.innerWidth, vh = window.innerHeight;

        const objetivo = estado.objetivo ? (typeof estado.objetivo === "function" ? estado.objetivo() : document.querySelector(estado.objetivo)) : null;
        const r = objetivo && objetivo.getBoundingClientRect ? objetivo.getBoundingClientRect() : null;

        if (!r || r.width === 0 || r.height === 0) {
            Object.assign(arriba.style, { left: 0, top: 0, width: "100%", height: "100%" });
            [izq, der, abajo].forEach(b => Object.assign(b.style, { width: 0, height: 0 }));
            anillo.hidden = true;
            const esc0 = document.getElementById("pxEscudo"); if (esc0) esc0.hidden = true;
            estado.hueco = null;
            colocarMascota();
            return;
        }

        const m = 8;
        const x = Math.max(0, r.left - m), y = Math.max(0, r.top - m);
        const x2 = Math.min(vw, r.right + m), y2 = Math.min(vh, r.bottom + m);
        estado.hueco = { x, y, x2, y2 };

        Object.assign(arriba.style, { left: 0, top: 0, width: "100%", height: y + "px" });
        Object.assign(abajo.style, { left: 0, top: y2 + "px", width: "100%", height: Math.max(0, vh - y2) + "px" });
        Object.assign(izq.style, { left: 0, top: y + "px", width: x + "px", height: (y2 - y) + "px" });
        Object.assign(der.style, { left: x2 + "px", top: y + "px", width: Math.max(0, vw - x2) + "px", height: (y2 - y) + "px" });
        Object.assign(anillo.style, { left: x + "px", top: y + "px", width: (x2 - x) + "px", height: (y2 - y) + "px" });
        anillo.hidden = false;

        // pasos de "solo mirar": lo iluminado no se toca (para no abrir cosas por accidente)
        const escudo = document.getElementById("pxEscudo");
        if (escudo) { escudo.hidden = !estado.soloVer; Object.assign(escudo.style, { left: x + "px", top: y + "px", width: (x2 - x) + "px", height: (y2 - y) + "px" }); }
        colocarMascota();
    }

    // la mascota se pone donde no tapa lo iluminado: junto a su globo (izquierda o derecha) o, si no cabe, con el globo encima
    function colocarMascota() {
        const m = document.getElementById("pxMascota");
        if (!m) return;
        const vw = window.innerWidth, vh = window.innerHeight, h = estado.hueco;

        m.classList.remove("px-der", "px-apilada");
        m.style.left = "auto"; m.style.right = "auto";

        // sin objetivo: la mascota va al centro, como una tarjeta
        m.classList.toggle("px-centro", !h);
        if (!h) return;

        const libre = (x, y, w, alto) => x + w < h.x || x > h.x2 || y + alto < h.y || y > h.y2;
        const ANCHO = 520, ALTO = 250, PILA_ANCHO = 360, PILA_ALTO = 340;
        const opciones = [
            { clase: "", lado: "izq", ancho: ANCHO, alto: ALTO },
            { clase: "px-der", lado: "der", ancho: ANCHO, alto: ALTO },
            { clase: "px-apilada", lado: "der", ancho: PILA_ANCHO, alto: PILA_ALTO },
            { clase: "px-apilada", lado: "izq", ancho: PILA_ANCHO, alto: PILA_ALTO }
        ];

        const elegida = opciones.find(o => {
            const x = o.lado === "izq" ? 28 : vw - 28 - o.ancho;
            return libre(x, vh - 22 - o.alto, o.ancho, o.alto);
        }) || opciones[0];

        if (elegida.clase) m.classList.add(elegida.clase);
        if (elegida.lado === "izq") m.style.left = "28px"; else m.style.right = "28px";
    }

    // primer campo visible de una lista de ids; el recuadro abarca su etiqueta
    function campoVisible(...ids) {
        const el = ids.map(id => document.getElementById(id)).find(e => e && e.offsetParent !== null);
        return el || null;
    }
    const cajaDeCampo = (...ids) => () => { const el = campoVisible(...ids); return el ? (el.closest(".campo-ficha") || el) : null; };
    const valorDe = (...ids) => { const el = campoVisible(...ids); return el ? String(el.value || "").trim() : ""; };

    // un recuadro que abarca varios elementos (por ejemplo el titulo del carrito y su tabla)
    function unir(...selectores) {
        const cajas = selectores.map(s => document.querySelector(s)).filter(Boolean).map(e => e.getBoundingClientRect()).filter(r => r.width && r.height);
        if (!cajas.length) return null;
        const left = Math.min(...cajas.map(r => r.left)), top = Math.min(...cajas.map(r => r.top));
        const right = Math.max(...cajas.map(r => r.right)), bottom = Math.max(...cajas.map(r => r.bottom));
        return { getBoundingClientRect: () => ({ left, top, right, bottom, width: right - left, height: bottom - top }) };
    }

    // ---------- pasos ----------
    function pasosCobrar() {
        const [a, b] = estado.set.busquedas;
        const pa = estado.productos.find(p => p.id === a.id), pb = estado.productos.find(p => p.id === b.id);
        const total = pa.precio + pb.precio;
        const carritoTiene = id => typeof carrito !== "undefined" && Array.isArray(carrito) && carrito.some(p => Number(p.id) === id);
        const escrito = fragmento => { const c = document.getElementById("busqueda"); return Boolean(c) && String(c.value || "").toLowerCase().includes(fragmento); };

        return [
            { pose: "feliz", texto: `Esta es tu <b>caja</b>: aquí cobras a tus clientes. Vamos a hacer tu <b>primera venta</b> con productos de ejemplo.`, pie: "Nada de esto es de verdad: puedes probar sin miedo", boton: "Vamos" },
            { pose: "pensando", texto: `Primero hay que <b>encontrar el producto</b>. Escribe <b>“${esc(a.nombre)}”</b> en el buscador.`, pie: `Con escribir “${a.escribe}” basta`, objetivo: ".pos-search-wrap", antes: () => document.getElementById("busqueda")?.focus(), cuando: () => escrito(a.escribe) },
            { pose: "feliz", texto: `¡Ahí está! Toca <b>Agregar</b> (o usa las flechas y Enter) para meterlo al carrito.`, pie: "Así se agrega cualquier producto", objetivo: "#posSearchFlyout", cuando: () => carritoTiene(a.id) },
            { pose: "pensando", texto: `Tu cliente también quiere <b>${esc(b.nombre)}</b>. Búscalo igual: escribe <b>“${esc(b.escribe)}”</b>.`, pie: "Primero se borra solo el buscador", objetivo: ".pos-search-wrap", antes: () => document.getElementById("busqueda")?.focus(), cuando: () => escrito(b.escribe) },
            { pose: "feliz", texto: `Agrégalo también.`, objetivo: "#posSearchFlyout", cuando: () => carritoTiene(b.id) },
            { pose: "neutral", texto: `Aquí abajo ves <b>lo que lleva tu cliente</b>: cada producto, su cantidad y el total. Con <b>+</b> y <b>−</b> cambias cuántos lleva.`, pie: `Total de la venta: ${dinero(total)}`, objetivo: () => unir(".pos-cart-hero-heading", "#carritoTabla"), boton: "Entendido" },
            { pose: "pensando", texto: `Ahora <b>cóbralo</b>: toca <b>Cobrar</b> (o la tecla <b>F8</b>).`, pie: `Total a cobrar: ${dinero(total)}`, objetivo: "#resumenCobro .btn-cobrar, .resumen-cobro .btn-cobrar", cuando: () => Boolean(document.querySelector(".metodo-pago-card")) },
            { pose: "feliz", texto: `Aquí eliges <b>cómo paga</b> tu cliente. Deja <b>Efectivo</b>, escribe que te da <b>${dinero(Math.ceil(total / 50) * 50)}</b> y mira el <b>cambio</b>. Luego toca <b>Confirmar cobro</b>.`, pie: "Efectivo, tarjeta, transferencia, fiado o mixto", objetivo: ".metodo-pago-card", cuando: () => estado.ventas.length >= 1, esperaPost: 1200,
              retroceso: () => !document.querySelector(".metodo-pago-card") && estado.ventas.length === 0 },
            { pose: "celebrando", texto: `¡<b>Primera venta lista</b>! Cobraste ${dinero(total)}. Nexo ya <b>descontó el inventario</b> y la venta quedó registrada.`, pie: "Así de rápido es vender con Nexo", boton: "Seguir" }
        ];
    }

    function pasosResultados() {
        const panel = id => () => document.getElementById(id)?.closest(".reportes-panel");
        const mi = estado.ventas[0];

        return [
            { pose: "pensando", texto: `Ya vendiste. Ahora veamos <b>cómo le va a tu negocio</b>: Nexo junta todas tus ventas en un solo lugar, sin hacer cuentas.`, pie: "Tu venta de práctica se mezcla con unas ventas de ejemplo de la mañana", boton: "Ver mis resultados" },
            { pose: "feliz", texto: `Estos son los <b>4 números del día</b>: cuánto vendiste, cuántas ventas fueron, el ticket promedio y cuántas piezas salieron. Las flechitas comparan con ayer.`, objetivo: ".reportes-resumen", soloVer: true, boton: "Entendido" },
            { pose: "feliz", texto: `Aquí está <b>tu venta</b>: <b>${esc(mi ? "PRÁCTICA-" + mi.numero : "la que acabas de hacer")}</b>. Cada venta queda con su folio y su hora.`, objetivo: panel("reporteUltimasVentas"), soloVer: true, boton: "Entendido" },
            { pose: "neutral", texto: `Los <b>productos que más se venden</b>: así sabes qué pedir primero a tu proveedor.`, objetivo: panel("reporteProductosVendidosLista"), soloVer: true, boton: "Entendido" },
            { pose: "feliz", texto: `Y aquí, <b>cuánto entró</b> en efectivo, tarjeta o transferencia. Te sirve para tu corte de caja.`, objetivo: panel("reporteMetodosPagoLeyenda"), soloVer: true, boton: "Entendido" },
            { pose: "celebrando", texto: `¡Listo! Con solo cobrar, Nexo ya te dijo <b>cuánto vendes, qué se vende más y cómo te pagan</b>.`, pie: "Sin hojas, sin calculadora", boton: "Seguir" }
        ];
    }

    function pasosAgregarProducto() {
        const ejemplo = estado.set.nombre.startsWith("Ferre")
            ? { codigo: "7501000000999", nombre: "Llave Stillson 14\"", precio: "189", stock: "6" }
            : { codigo: "7501000000999", nombre: "Galletas Emperador", precio: "24", stock: "12" };
        const guardado = () => estado.productos.some(p => p.nuevoDePractica);

        return [
            { pose: "pensando", texto: `Ahora lo contrario: <b>agregar un producto nuevo</b> a tu inventario. Así lo vas llenando conforme vendes.`, pie: "Son 4 datos y listo", boton: "Vamos" },
            { pose: "feliz", texto: `Aquí está tu <b>inventario</b>. Para sumar algo nuevo toca <b>+ Agregar producto</b>.`, objetivo: "#pantallaInventario .btn-agregar", cuando: () => Boolean(document.getElementById("modalAgregar")?.offsetParent) },
            { pose: "neutral", texto: `Primero dile <b>cómo es</b>: con código de barras, sin código, por peso o un servicio. Déjalo en <b>Con código</b>.`, pie: "Con tu celular puedes escanear el código (te enseño más adelante)", objetivo: ".tipo-producto-selector", soloVer: true, boton: "Entendido" },
            { pose: "pensando", texto: `Pon el <b>código de barras</b> (con un lector o el celular se escanea solo). Para practicar escribe <b>${ejemplo.codigo}</b>.`, objetivo: cajaDeCampo("nuevoCodigo"), antes: () => document.getElementById("nuevoCodigo")?.focus(), cuando: () => valorDe("nuevoCodigo").length >= 8 },
            { pose: "feliz", texto: `Ahora el <b>nombre</b>, como lo ve tu cliente en el ticket. Escribe <b>${esc(ejemplo.nombre)}</b>.`, objetivo: cajaDeCampo("nuevoNombre"), antes: () => document.getElementById("nuevoNombre")?.focus(), cuando: () => valorDe("nuevoNombre").length >= 3 },
            { pose: "pensando", texto: `¿A cuánto lo vendes? Escribe <b>${ejemplo.precio}</b> en el precio.`, objetivo: cajaDeCampo("nuevoPrecio", "precioPublico"), antes: () => campoVisible("nuevoPrecio", "precioPublico")?.focus(), cuando: () => Number(valorDe("nuevoPrecio", "precioPublico")) > 0 },
            { pose: "feliz", texto: `¿Cuántos tienes ahorita? Escribe <b>${ejemplo.stock}</b>. Nexo los va descontando con cada venta.`, objetivo: cajaDeCampo("nuevoStock"), antes: () => document.getElementById("nuevoStock")?.focus(), cuando: () => Number(valorDe("nuevoStock")) > 0 },
            { pose: "alerta", texto: `Si caduca, dile <b>cuántos días dura</b> y Nexo te avisa antes de que se eche a perder.`, pie: "Solo para lo que caduca (galletas, lácteos, pan…)", objetivo: cajaDeCampo("nuevaVidaUtilDias"), omitir: () => !campoVisible("nuevaVidaUtilDias"), soloVer: true, boton: "Entendido" },
            { pose: "feliz", texto: `Listo. Toca <b>Guardar producto</b>. Después le puedes poner foto, marca, proveedor y más.`, objetivo: "#btnGuardarProducto", cuando: guardado, esperaPost: 1400 },
            { pose: "celebrando", texto: `¡Tu <b>primer producto</b> ya está en el inventario! Ya aparece en el buscador de la caja y se descuenta solo cuando lo vendes.`, pie: "Así vas armando tu tienda", boton: "Seguir" }
        ];
    }

    const CAPITULOS = [
        { id: "cobrar", titulo: "Cobrar tu primera venta", pasos: pasosCobrar, entrar: () => { if (typeof mostrarPuntoVenta === "function") mostrarPuntoVenta(); if (typeof cargarFavoritosPOS === "function") cargarFavoritosPOS(); } },
        { id: "resultados", titulo: "Ver tus resultados", pasos: pasosResultados, entrar: () => { if (typeof mostrarGraficas === "function") mostrarGraficas(); } },
        { id: "producto", titulo: "Agregar un producto", pasos: pasosAgregarProducto, entrar: () => { if (typeof mostrarInventario === "function") mostrarInventario(); } }
    ];

    async function esperarPaso(paso) {
        const boton = document.getElementById("pxContinuar");

        return new Promise(resolver => {
            estado.esperando = resolver;
            let terminado = false;
            const listo = valor => { if (!terminado) { terminado = true; clearInterval(reloj); resolver(valor); } };

            if (paso.boton) {
                boton.hidden = false;
                boton.textContent = paso.boton;
                boton.onclick = listo;
            } else {
                boton.hidden = true;
            }

            const reloj = setInterval(() => {
                if (estado.cancelado) return listo();
                // si cierra el cuadro de cobro sin cobrar, se vuelve al paso anterior en vez de quedarse sin recuadro
                if (paso.retroceso && paso.retroceso()) return listo("atras");
                posicionarHueco();
                if (paso.cuando) { try { if (paso.cuando()) listo(); } catch (error) { /* se sigue esperando */ } }
            }, 140);
        });
    }

    async function correr(capitulo) {
        if (capitulo.entrar) capitulo.entrar();
        await pausa(900);

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
            try {
                const destino = typeof paso.objetivo === "function" ? paso.objetivo() : (paso.objetivo ? document.querySelector(paso.objetivo) : null);
                if (destino && destino.nodeType === 1 && destino.scrollIntoView) destino.scrollIntoView({ block: "center", behavior: "smooth" });
            } catch (error) { /* sin desplazamiento */ }
            estado.pieRegaño = paso.soloVer ? "Por ahora solo mira 👀 · toca el botón para seguir" : "";
            estado.poseActual = paso.pose || "feliz";
            estado.pieActual = paso.pie || "";
            pintarBanda();
            ponerPose(estado.poseActual);
            hablar(paso.texto, paso.pie);
            if (paso.antes) { try { paso.antes(); } catch (error) { /* sigue */ } }
            posicionarHueco();
            if (i === 0 && typeof cerrarVentaCompletadaPOS === "function") { try { cerrarVentaCompletadaPOS(); } catch (error) { /* sin cuadro */ } }
        const resultado = await esperarPaso(paso);
            if (estado.cancelado) return false;
            if (resultado === "atras") { i = Math.max(-1, i - 2); continue; }

            if (paso.cuando && !paso.boton) {
                // acerto: se celebra un instante antes de seguir
                ponerPose("celebrando");
                await pausa(paso.esperaPost || 650);
            }
        }

        return true;
    }

    // ---------- pantallas completas ----------
    function pantallaCompleta(html, fondo) {
        document.getElementById("pxPantalla")?.remove();
        const p = crear("px-pantalla", html);
        p.id = "pxPantalla";
        p.style.background = fondo;
        document.body.appendChild(p);
        return p;
    }

    function bienvenida() {
        return new Promise(resolver => {
            const p = pantallaCompleta(`
                <div class="px-pantalla-int">
                    <img class="px-grande" src="${mascota("feliz")}" alt="Nexo">
                    <div class="px-etiqueta">TU NEGOCIO ESTÁ LISTO</div>
                    <h1>Vamos a practicar<br>antes de empezar</h1>
                    <p>Cobra una venta, mira tus resultados y agrega un producto, con productos de ejemplo. No hay riesgo y no se guarda nada en tu negocio.</p>
                    <button type="button" class="px-gigante" id="pxComenzar">Comenzar</button>
                    <button type="button" class="px-ligero" id="pxAhoraNo">Ahora no, entrar a mi negocio</button>
                </div>`, "radial-gradient(1100px 700px at 70% 20%, #3b6dff 0%, #1b2a6b 45%, #0b1236 100%)");
            p.querySelector("#pxComenzar").onclick = () => { p.classList.add("px-sale"); setTimeout(() => { p.remove(); resolver(true); }, 420); };
            p.querySelector("#pxAhoraNo").onclick = () => { p.classList.add("px-sale"); setTimeout(() => { p.remove(); resolver(false); }, 420); };
            setTimeout(() => p.querySelector("#pxComenzar")?.focus(), 80);
        });
    }

    function despedida(resumen) {
        return new Promise(resolver => {
            const p = pantallaCompleta(`
                <div class="px-pantalla-int">
                    <img class="px-grande" src="${mascota("celebrando")}" alt="Nexo">
                    <h1>¡Ya sabes lo básico!</h1>
                    <div class="px-logros">${resumen.map(([i, t]) => `<div><span>${i}</span>${esc(t)}</div>`).join("")}</div>
                    <p>Los productos de práctica ya se borraron. Tu negocio empieza limpio, con tu nombre y tus reglas.</p>
                    <button type="button" class="px-gigante" id="pxEntrar">Entrar a mi negocio</button>
                </div>`, "radial-gradient(1100px 700px at 30% 15%, #34d399 0%, #0f766e 40%, #0b2b4a 100%)");
            p.querySelector("#pxEntrar").onclick = () => { p.classList.add("px-zoom"); setTimeout(() => { p.remove(); resolver(); }, 650); };
            setTimeout(() => p.querySelector("#pxEntrar")?.focus(), 80);
        });
    }

    // ---------- inicio / fin ----------
    // llaves donde la caja guarda la "ultima venta" y las hojas de venta: la practica no debe dejar nada ahi
    const LLAVES_VENTA = ["hojasVentaFerreteriaPOS", "ultimaVentaPOS"];

    function guardarEstadoReal() {
        estado.guardado = {
            productos: typeof todosProductos !== "undefined" ? todosProductos : [],
            imprimir: window.imprimirTicketPOS,
            qr: window.debeMostrarQrTicketPOS,
            carrito: typeof carrito !== "undefined" ? carrito : [],
            tours: window.nexoIaTourAutoModulo,
            almacen: LLAVES_VENTA.map(k => [k, localStorage.getItem(k)])
        };
    }

    function instalarGuardas() {
        // sin papel ni ventanas de impresion durante la practica
        window.imprimirTicketPOS = async () => true;
        window.nexoIaTourAutoModulo = () => {};
        window.debeMostrarQrTicketPOS = () => false;
        try { todosProductos = estado.productos; } catch (error) { /* se vuelve a cargar */ }
        try { carrito = []; if (typeof actualizarCarrito === "function") actualizarCarrito(); } catch (error) { /* sin carrito */ }
    }

    async function restaurar() {
        document.body.classList.remove("practica-activa");
        quitarRed();
        if (estado.guardado) {
            if (estado.guardado.imprimir) window.imprimirTicketPOS = estado.guardado.imprimir;
            if (estado.guardado.qr) window.debeMostrarQrTicketPOS = estado.guardado.qr;
            if (estado.guardado.tours) window.nexoIaTourAutoModulo = estado.guardado.tours;
            try { (estado.guardado.almacen || []).forEach(([k, v]) => { if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); }); } catch (error) { /* sin almacenamiento */ }
        }
        try { if (typeof cerrarVentaCompletadaPOS === "function") cerrarVentaCompletadaPOS(); } catch (error) { /* sin cuadro */ }
        try { carrito = estado.guardado && Array.isArray(estado.guardado.carrito) ? estado.guardado.carrito : []; if (typeof actualizarCarrito === "function") actualizarCarrito(); } catch (error) { /* sin carrito */ }
        try { const campo = document.getElementById("busqueda"); if (campo) campo.value = ""; window.ocultarFlyoutBusquedaPOS && window.ocultarFlyoutBusquedaPOS(); } catch (error) { /* sin buscador */ }
        try { if (typeof cargarProductos === "function") await cargarProductos(); } catch (error) { /* se recarga solo */ }
        try { if (typeof cargarFavoritosPOS === "function") await cargarFavoritosPOS(); } catch (error) { /* se recarga solo */ }
    }

    function limpiarCapa() {
        document.getElementById("pxCapa")?.remove();
        document.getElementById("pxPantalla")?.remove();
        clearTimeout(temporizadorRegaño);
    }

    async function marcar(resultado) {
        try { localStorage.setItem(LLAVE_VISTA, resultado); } catch (error) { /* sin almacenamiento */ }
        try { await fetch("/negocio-actual/onboarding", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ respuestas: { practica: resultado } }) }); } catch (error) { /* se intenta otra vez luego */ }
    }

    function saltar() {
        if (!estado.activa) return;
        if (!confirm("¿Salir de la práctica? Podrás repetirla cuando quieras desde Configuración.")) return;
        estado.cancelado = true;
        if (estado.esperando) estado.esperando();
    }

    async function terminar(resultado) {
        const ventas = estado.ventas.length;
        const alTerminar = estado.alTerminar;

        limpiarCapa();

        if (resultado === "hecha") {
            estado.activa = false;
            await restaurar();
            await despedida([["🛒", ventas === 1 ? "Cobraste tu primera venta" : `Cobraste ${ventas} ventas`], ["📊", "Viste tus resultados"], ["➕", "Agregaste un producto"]]);
        } else {
            estado.activa = false;
            await restaurar();
        }

        estado.cancelado = false;
        estado.ventas = [];
        estado.alTerminar = null;
        await marcar(resultado);

        if (typeof alTerminar === "function") alTerminar(resultado);
        else if (typeof mostrarInicio === "function") mostrarInicio();
    }

    async function iniciar(opciones = {}) {
        if (estado.activa) return;

        estado.alTerminar = opciones.alTerminar || null;
        estado.cancelado = false;
        estado.set = SETS[giro()];
        estado.productos = JSON.parse(JSON.stringify(estado.set.productos));
        estado.ventas = [];
        estado.semillas = ventasSemilla(estado.productos);

        const empezar = opciones.saltarBienvenida ? true : await bienvenida();

        if (!empezar) {
            const alTerminar = estado.alTerminar;
            estado.alTerminar = null;
            await marcar("saltada");
            if (typeof alTerminar === "function") alTerminar("saltada"); else if (typeof mostrarInicio === "function") mostrarInicio();
            return;
        }

        guardarEstadoReal();
        estado.activa = true;
        document.body.classList.add("practica-activa");
        instalarRed();
        instalarGuardas();
        montarCapa();

        let completa = true;
        for (const capitulo of CAPITULOS) {
            completa = await correr(capitulo);
            if (!completa) break;
        }

        await terminar(completa ? "hecha" : "saltada");
    }

    function debeOfrecerse() {
        try { if (localStorage.getItem(LLAVE_VISTA)) return false; } catch (error) { /* sin almacenamiento */ }
        return !estado.activa;
    }

    window.practicaNexo = { iniciar, debeOfrecerse, activa: () => estado.activa, estado };
    window.addEventListener("resize", () => { if (estado.activa) posicionarHueco(); });
})();
