/* "Solo lo necesario" en el celular (/dueno): lo mismo que en la computadora (js/solo-mostrador.js + js/mi-mercancia.js) para un negocio
   chico como La Rinconada. Solo existe con la funcion beta "solo_mostrador": en cualquier otro negocio este archivo no hace nada.

   - Cambia la barra de abajo por una sencilla: Inicio, Mostrador, Mercancia, Recargas y Mas.
   - Mostrador de precios: se escanea con la camara (o se escribe) y sale la foto y el precio en grande.
   - Mi mercancia: escanear, ponerle precio y cuantas hay; lo que Nexo ya conoce trae nombre y foto.
   Usa las rutas de siempre (GET /productos, /explorar-nexo/buscar y /foto, POST /agregar-producto, PATCH /productos/:id/edicion-rapida,
   POST /ajustes-inventario). Las recargas son el modulo de siempre (dueno-recargas.js). */
(function () {
    const LLAVE_HOY = "nexoMiMercanciaHoy";
    const MAXIMO_FILAS = 40;

    let activo = false;
    let vista = "inicio";
    let productos = [];
    let porCodigo = new Map();
    let ficha = null; // { tipo: "existe" | "catalogo" | "nuevo", producto?, codigo, nombre, marca, catalogoMaestroId, foto }
    let guardando = false;
    let actual = null; // mostrador: producto mostrado o { desconocido }
    let camara = null;
    let audio = null;
    let nombreNegocio = "";

    const esc = valor => String(valor == null ? "" : valor).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
    const dinero = valor => "$" + Number(valor || 0).toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const codigoNorm = codigo => String(codigo || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
    const plano = texto => String(texto || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
    const precioDe = p => Number(p.precio_publico != null && Number(p.precio_publico) > 0 ? p.precio_publico : p.precio || 0);
    const el = id => document.getElementById(id);
    const hoyTexto = () => new Date().toISOString().slice(0, 10);

    const ICONOS = {
        inicio: '<path d="M3 11l9-7 9 7"/><path d="M5 10v10h14V10"/>',
        mostrador: '<path d="M3 12V4h8l10 10-8 8z"/><circle cx="7.5" cy="8.5" r="1.2"/>',
        mercancia: '<path d="M21 8 12 3 3 8v8l9 5 9-5z"/><path d="M3 8l9 5 9-5M12 13v8"/>',
        recargas: '<rect x="7" y="2" width="10" height="20" rx="2.5"/><path d="M11 18h2"/>',
        mas: '<circle cx="5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="19" cy="12" r="1.6"/>',
        acabando: '<path d="M12 3 2 20h20z"/><path d="M12 10v5M12 18h.01"/>',
        camara: '<path d="M4 8h3l1.5-2h7L17 8h3v11H4z"/><circle cx="12" cy="13.5" r="3.4"/>',
        carrito: '<path d="M2 3h3l2.6 12.4a1 1 0 0 0 1 .8h8.8a1 1 0 0 0 1-.8L20 7H6"/><circle cx="9.5" cy="20" r="1.4"/><circle cx="17" cy="20" r="1.4"/>'
    };
    const icono = nombre => `<svg viewBox="0 0 24 24" aria-hidden="true">${ICONOS[nombre]}</svg>`;

    // ---------------------------------------------------------------------
    // Utilidades
    // ---------------------------------------------------------------------
    function leerHoy() {
        try {
            const dato = JSON.parse(localStorage.getItem(LLAVE_HOY) || "null");
            return dato && dato.dia === hoyTexto() ? Number(dato.n) || 0 : 0;
        } catch (error) { return 0; }
    }

    function sumarHoy() {
        try { localStorage.setItem(LLAVE_HOY, JSON.stringify({ dia: hoyTexto(), n: leerHoy() + 1 })); } catch (error) { /* sin almacenamiento */ }
    }

    function pitar(bien) {
        try {
            audio = audio || new (window.AudioContext || window.webkitAudioContext)();
            const o = audio.createOscillator(), g = audio.createGain();
            o.frequency.value = bien ? 988 : 240;
            g.gain.value = 0.07;
            o.connect(g); g.connect(audio.destination);
            o.start(); o.stop(audio.currentTime + (bien ? 0.09 : 0.2));
        } catch (error) { /* sin audio */ }
    }

    function llamar(ruta, opciones = {}) {
        return fetchAutenticado(ruta, { headers: { "Content-Type": "application/json" }, ...opciones });
    }

    async function cargarProductos() {
        try {
            const lista = await llamar("/productos");
            if (!Array.isArray(lista)) return;

            productos = lista;
            porCodigo = new Map();
            lista.forEach(p => {
                [p.codigo, ...(Array.isArray(p.codigos_relacionados) ? p.codigos_relacionados.map(c => c.codigo) : [])].forEach(c => {
                    const clave = codigoNorm(c);
                    if (clave && !porCodigo.has(clave)) porCodigo.set(clave, p);
                });
            });
        } catch (error) { /* se queda con lo que ya tenia */ }
    }

    async function fotoDeCodigo(codigo) {
        try { const d = await llamar(`/explorar-nexo/foto/${encodeURIComponent(codigo)}`); return d && d.url ? d.url : ""; } catch (error) { return ""; }
    }

    function fotoHtml(url, nombre) {
        const letra = esc(String(nombre || "?").charAt(0).toUpperCase());
        return url ? `<img src="${esc(url)}" alt="" loading="lazy" onerror="this.replaceWith(Object.assign(document.createElement('b'),{textContent:'${letra}'}))">` : `<b>${letra}</b>`;
    }

    // ---------------------------------------------------------------------
    // Camara (la misma que usan Vender e Inventario)
    // ---------------------------------------------------------------------
    function detenerCamara() {
        if (camara) { try { camara.stop(); } catch (error) { /* ya estaba detenida */ } camara = null; }
        const caja = el("dsCamara");
        if (caja) caja.hidden = true;
    }

    async function alternarCamara(alCodigo) {
        const caja = el("dsCamara");
        if (!caja) return;

        if (camara) { detenerCamara(); return; }

        if (typeof window.iniciarLectorCodigosDueno !== "function") { aviso("Este celular no puede abrir la cámara aquí."); return; }

        caja.hidden = false;
        try {
            camara = await window.iniciarLectorCodigosDueno(el("dsVideo"), codigo => { alCodigo(codigo); });
        } catch (error) {
            caja.hidden = true;
            aviso("No pude abrir la cámara. Revisa el permiso del navegador o escribe el código.");
        }
    }

    function aviso(texto) {
        if (typeof mostrarToastDueno === "function") mostrarToastDueno(texto);
    }

    // ---------------------------------------------------------------------
    // Estructura: pantalla completa + barra de abajo
    // ---------------------------------------------------------------------
    function asegurarEstructura() {
        if (el("dsRaiz")) return;

        const raiz = document.createElement("div");
        raiz.id = "dsRaiz";
        raiz.className = "ds-raiz";
        raiz.hidden = true;
        raiz.innerHTML = `<div id="dsPantalla" class="ds-pantalla"></div>
            <nav id="dsNav" class="ds-nav" aria-label="Menú">
                ${[["inicio", "Inicio"], ["mostrador", "Mostrador"], ["mercancia", "Mercancía"], ["recargas", "Recargas"], ["mas", "Más"]].map(([id, texto]) => `<button type="button" data-ds="${id}">${icono(id)}<span>${texto}</span></button>`).join("")}
            </nav>`;
        document.body.appendChild(raiz);

        raiz.querySelector("#dsNav").addEventListener("click", evento => {
            const boton = evento.target.closest("button[data-ds]");
            if (boton) ir(boton.dataset.ds);
        });
    }

    function ir(destino) {
        detenerCamara();

        if (destino === "recargas") {
            if (typeof window.abrirRecargasDueno === "function") window.abrirRecargasDueno();
            return;
        }

        if (destino === "mas") {
            // Se deja ver lo de siempre (configuracion, cerrar sesion...) debajo de la barra sencilla.
            vista = "mas";
            el("dsPantalla").hidden = true;
            marcarNav();
            if (typeof cambiarTabDueno === "function") cambiarTabDueno("mas");
            return;
        }

        vista = destino;
        el("dsPantalla").hidden = false;
        marcarNav();

        if (destino === "inicio") pintarInicio();
        if (destino === "mostrador") pintarMostrador();
        if (destino === "mercancia") pintarMercancia();
    }

    function marcarNav() {
        document.querySelectorAll("#dsNav button").forEach(b => b.classList.toggle("activo", b.dataset.ds === vista));
    }

    // ---------------------------------------------------------------------
    // Inicio
    // ---------------------------------------------------------------------
    async function pintarInicio() {
        const pantalla = el("dsPantalla");
        const acabando = productos.filter(p => Number(p.stock || 0) <= Number(p.stock_minimo == null ? 3 : p.stock_minimo)).length;
        const sinProductos = productos.length === 0;
        const hoy = leerHoy();

        const tarjetas = [
            { id: "mostrador", titulo: "Mostrador de precios", texto: "Escaneas y ves el precio en grande." },
            { id: "mercancia", titulo: "Meter mi mercancía", texto: "Escaneas y solo le pones el precio." },
            { id: "recargas", titulo: "Recargas y servicios", texto: "Tiempo aire, luz y tarjetas de regalo." },
            { id: "acabando", titulo: "Se está acabando", texto: "Lo que conviene pedir.", etiqueta: acabando ? `${acabando} por pedir` : "" }
        ];

        pantalla.innerHTML = `<div class="ds-hero"><h2>Hola, ${esc(nombreNegocio || "tu negocio")}</h2><p>Aquí tienes lo que necesitas, sin complicaciones.</p>
                <div class="ds-numeros"><span>${productos.length} ${productos.length === 1 ? "producto" : "productos"}</span>${hoy ? `<span>${hoy} ${hoy === 1 ? "metido" : "metidos"} hoy</span>` : ""}</div></div>
            ${sinProductos ? `<button type="button" class="ds-paso" data-ir="mercancia"><b>Empieza por aquí: mete tu mercancía</b><span>Pasa cada producto por la cámara y ponle su precio.</span></button>` : ""}
            <div class="ds-tarjetas">${tarjetas.map(t => `<button type="button" class="ds-tarjeta" data-ir="${t.id}"><span class="ds-icono">${icono(t.id === "acabando" ? "acabando" : t.id)}</span><span class="ds-t-cuerpo"><b>${esc(t.titulo)}</b><small>${esc(t.texto)}</small></span>${t.etiqueta ? `<em>${esc(t.etiqueta)}</em>` : ""}</button>`).join("")}</div>`;

        pantalla.querySelectorAll("[data-ir]").forEach(b => b.addEventListener("click", () => {
            if (b.dataset.ir === "acabando") { filtroAcabando = true; ir("mercancia"); return; }
            ir(b.dataset.ir);
        }));
    }

    let filtroAcabando = false;

    // ---------------------------------------------------------------------
    // Mostrador de precios
    // ---------------------------------------------------------------------
    function cajaEscaner(placeholder, idEntrada) {
        return `<div class="ds-barra">
                <input id="${idEntrada}" type="text" inputmode="text" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="${esc(placeholder)}">
                <button type="button" id="dsBtnCamara" class="ds-btn-camara" aria-label="Escanear con la cámara">${icono("camara")}</button>
            </div>
            <div id="dsCamara" class="ds-camara" hidden><video id="dsVideo" playsinline muted></video><button type="button" id="dsCerrarCamara">Cerrar cámara</button></div>`;
    }

    function enlazarCamara(alCodigo) {
        el("dsBtnCamara").addEventListener("click", () => alternarCamara(alCodigo));
        el("dsCerrarCamara").addEventListener("click", detenerCamara);
    }

    async function pintarMostrador() {
        actual = null;
        el("dsPantalla").innerHTML = `<header class="ds-cab"><h2>Mostrador de precios</h2><p>Escanea un producto para ver su precio.</p></header>
            ${cajaEscaner("Escanea o escribe el nombre", "dsEntrada")}
            <div id="dsSugerencias" class="ds-sugerencias" hidden></div>
            <div id="dsEscena" class="ds-escena"></div>`;

        const entrada = el("dsEntrada");
        enlazarCamara(codigo => { entrada.value = ""; procesarMostrador(codigo); });
        entrada.addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); const t = entrada.value; entrada.value = ""; ocultarSugerencias(); procesarMostrador(t); } });
        entrada.addEventListener("input", () => sugerirMostrador(entrada.value));

        pintarEscena();
        if (!productos.length) await cargarProductos();
    }

    function procesarMostrador(texto) {
        const t = String(texto || "").trim();
        if (!t) return;

        const p = porCodigo.get(codigoNorm(t));
        if (p) { pitar(true); mostrarProducto(p); return; }

        if (/^\d{6,}$/.test(t)) { pitar(false); actual = { desconocido: t }; pintarEscena(); return; }

        const r = buscarPorNombre(t);
        if (r.length) { pitar(true); mostrarProducto(r[0]); } else { pitar(false); actual = { desconocido: t }; pintarEscena(); }
    }

    function buscarPorNombre(texto) {
        const tokens = plano(texto).split(/\s+/).filter(Boolean);
        if (!tokens.length) return [];
        return productos.filter(p => { const base = plano(`${p.nombre} ${p.marca || ""}`); return tokens.every(t => base.includes(t)); }).slice(0, 6);
    }

    function sugerirMostrador(texto) {
        const caja = el("dsSugerencias");
        const t = String(texto || "").trim();
        if (!caja) return;
        if (t.length < 2 || /^\d+$/.test(t)) { caja.hidden = true; return; }

        const r = buscarPorNombre(t);
        if (!r.length) { caja.hidden = true; return; }

        caja.innerHTML = r.map(p => `<button type="button" data-id="${esc(p.id)}"><span>${esc(p.nombre)}</span><strong>${dinero(precioDe(p))}</strong></button>`).join("");
        caja.hidden = false;
        caja.querySelectorAll("button").forEach(b => b.addEventListener("click", () => {
            const producto = productos.find(p => String(p.id) === b.dataset.id);
            el("dsEntrada").value = "";
            caja.hidden = true;
            if (producto) mostrarProducto(producto);
        }));
    }

    function ocultarSugerencias() { const c = el("dsSugerencias"); if (c) c.hidden = true; }

    async function mostrarProducto(p) {
        actual = p;
        pintarEscena();

        if (!p.imagenUrl && p.codigo && !p.__fotoBuscada) {
            p.__fotoBuscada = true;
            const url = await fotoDeCodigo(codigoNorm(p.codigo));
            if (url) { p.imagenUrl = url; if (actual === p) pintarEscena(); }
        }
    }

    function pintarEscena() {
        const e = el("dsEscena");
        if (!e) return;

        if (!actual) {
            e.innerHTML = `<div class="ds-vacio"><div class="ds-barras" aria-hidden="true"><svg viewBox="0 0 120 60"><g>${[[4, 3], [10, 1.5], [14, 5], [22, 2], [27, 1.5], [32, 4], [40, 1.5], [45, 3], [52, 1.5], [57, 5], [65, 2], [70, 1.5], [75, 4], [83, 2], [88, 1.5], [93, 5], [101, 2], [106, 3], [112, 1.5]].map(([x, w]) => `<rect x="${x}" y="4" width="${w}" height="52" rx=".6"/>`).join("")}</g><rect class="ds-laser" x="0" y="28" width="120" height="2.4" rx="1.2"/></svg></div><h3>Pasa el producto por la cámara</h3><p>Verás su foto y su precio aquí.</p></div>`;
            return;
        }

        if (actual.desconocido) {
            e.innerHTML = `<div class="ds-vacio ds-desconocido"><h3>No lo tengo registrado</h3><p>El código <b>${esc(actual.desconocido)}</b> no está en tu inventario.</p><button type="button" id="dsAgregar" class="ds-primario">Agregarlo ahora</button></div>`;
            el("dsAgregar").addEventListener("click", () => { const codigo = actual.desconocido; ir("mercancia"); alEscanear(codigo); });
            return;
        }

        const p = actual;
        const porKg = /kilo|kg|granel/i.test(String(p.unidad_venta || ""));
        e.innerHTML = `<div class="ds-producto"><div class="ds-foto">${fotoHtml(p.imagenUrl, p.nombre)}</div>
            <div class="ds-nombre">${esc(p.nombre)}</div>
            ${p.marca ? `<div class="ds-marca">${esc(p.marca)}</div>` : ""}
            <div class="ds-precio">${dinero(precioDe(p))}${porKg ? "<small> / kg</small>" : ""}</div></div>`;
    }

    // ---------------------------------------------------------------------
    // Mi mercancia
    // ---------------------------------------------------------------------
    async function pintarMercancia() {
        ficha = null;
        el("dsPantalla").innerHTML = `<header class="ds-cab"><h2>Mi mercancía</h2><p>Escanea cada producto. Si Nexo ya lo conoce, solo pones el precio.</p><div class="ds-numeros ds-claro" id="dsContadores"></div></header>
            ${cajaEscaner("Escanea o escribe el nombre", "dsEntrada")}
            <div id="dsSugerencias" class="ds-sugerencias" hidden></div>
            <section id="dsFicha"></section>
            <section class="ds-lista">
                <div class="ds-lista-cab"><h3>Lo que ya tienes <small id="dsTotal"></small></h3>
                    <input id="dsBuscar" type="search" autocomplete="off" placeholder="Buscar en mis productos" aria-label="Buscar en mis productos">
                    <div class="ds-filtros"><button type="button" data-f="todo">Todo</button><button type="button" data-f="acabando">Se está acabando</button></div></div>
                <div id="dsFilas" class="ds-filas"></div>
            </section>`;

        const entrada = el("dsEntrada");
        enlazarCamara(codigo => { entrada.value = ""; alEscanear(codigo); });
        entrada.addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); const t = entrada.value; entrada.value = ""; alEscanear(t); } });
        el("dsBuscar").addEventListener("input", pintarLista);
        document.querySelectorAll(".ds-filtros button").forEach(b => b.addEventListener("click", () => { filtroAcabando = b.dataset.f === "acabando"; pintarFiltros(); pintarLista(); }));

        pintarFiltros();
        pintarFicha();
        pintarLista();
        await cargarProductos();
        pintarContadores();
        pintarLista();
    }

    function pintarFiltros() {
        document.querySelectorAll(".ds-filtros button").forEach(b => b.classList.toggle("activo", (b.dataset.f === "acabando") === filtroAcabando));
    }

    function pintarContadores() {
        const c = el("dsContadores");
        if (c) c.innerHTML = `<span>${productos.length} ${productos.length === 1 ? "producto" : "productos"}</span><span>${leerHoy()} ${leerHoy() === 1 ? "metido" : "metidos"} hoy</span>`;
    }

    function pintarFicha() {
        const zona = el("dsFicha");
        if (!zona) return;

        if (!ficha) {
            zona.innerHTML = productos.length ? "" : `<div class="ds-vacio ds-inicial"><h3>Empecemos con tu primer producto</h3><p>Toma cualquier producto de tu tienda y pásalo por la cámara. Nexo busca su nombre y su foto; tú solo le pones el precio.</p></div>`;
            return;
        }

        const titulos = { existe: "Ya lo tienes", catalogo: "Nexo lo reconoce", nuevo: "Producto nuevo" };
        const p = ficha.producto;
        const precio = p ? precioDe(p) : "";
        const stock = p ? Number(p.stock || 0) : "";

        zona.innerHTML = `<div class="ds-ficha ds-ficha-${ficha.tipo}">
            <div class="ds-ficha-top"><div class="ds-mini ds-mini-grande">${fotoHtml(ficha.foto, ficha.nombre)}</div>
                <div><span class="ds-etiqueta ds-etiqueta-${ficha.tipo}">${titulos[ficha.tipo]}</span>
                <small class="ds-codigo">${esc([ficha.marca, ficha.codigo].filter(Boolean).join(" · ") || "Sin código: Nexo le pondrá uno")}</small></div></div>
            <label><span>Nombre</span><input id="dsNombre" value="${esc(ficha.nombre)}" placeholder="¿Cómo se llama?" autocomplete="off"></label>
            <div class="ds-campos">
                <label><span>Precio de venta</span><div class="ds-caja"><i>$</i><input id="dsPrecio" type="text" inputmode="decimal" autocomplete="off" placeholder="0.00" value="${precio === "" ? "" : esc(precio)}"></div></label>
                <label><span>Cuántas tienes</span><div class="ds-caja"><input id="dsStock" type="text" inputmode="numeric" autocomplete="off" placeholder="0" value="${stock === "" ? "" : esc(stock)}"></div></label>
            </div>
            <p class="ds-error" id="dsError" role="alert" hidden></p>
            <div class="ds-acciones"><button type="button" class="ds-primario" id="dsGuardar">${ficha.tipo === "existe" ? "Guardar cambios" : "Agregar a mi mercancía"}</button><button type="button" class="ds-secundario" id="dsCancelar">Cancelar</button></div>
        </div>`;

        el("dsGuardar").addEventListener("click", guardar);
        el("dsCancelar").addEventListener("click", cancelar);
        el("dsPrecio").addEventListener("input", e => { e.target.value = e.target.value.replace(/[^\d.]/g, "").replace(/(\..*)\./g, "$1"); });
        el("dsStock").addEventListener("input", e => { e.target.value = e.target.value.replace(/\D/g, ""); });
        ["dsNombre", "dsPrecio", "dsStock"].forEach(id => el(id).addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); guardar(); } }));

        zona.scrollIntoView({ block: "nearest", behavior: "smooth" });
        setTimeout(() => { const campo = !ficha.nombre ? el("dsNombre") : el("dsPrecio"); if (campo) { campo.focus(); campo.select(); } }, 60);
    }

    function pintarLista() {
        const filas = el("dsFilas");
        if (!filas) return;

        const q = plano(el("dsBuscar")?.value || "");
        let base = q ? productos.filter(p => plano(`${p.nombre} ${p.marca || ""} ${p.codigo || ""}`).includes(q)) : [...productos].sort((a, b) => Number(b.id) - Number(a.id));
        if (filtroAcabando) base = base.filter(p => Number(p.stock || 0) <= Number(p.stock_minimo == null ? 3 : p.stock_minimo));
        const lista = base.slice(0, MAXIMO_FILAS);

        const total = el("dsTotal");
        if (total) total.textContent = q || filtroAcabando ? `${base.length} encontrados` : `${productos.length}`;

        if (!lista.length) { filas.innerHTML = `<p class="ds-sin">${filtroAcabando ? "No se está acabando nada." : q ? "No encontré ese producto." : "Aquí irán apareciendo los productos que metas."}</p>`; return; }

        filas.innerHTML = lista.map(p => {
            const stock = Number(p.stock || 0);
            const bajo = stock <= Number(p.stock_minimo == null ? 3 : p.stock_minimo);
            return `<button type="button" class="ds-fila" data-id="${esc(p.id)}"><span class="ds-mini">${fotoHtml(p.imagenUrl, p.nombre)}</span>
                <span class="ds-fila-info"><b>${esc(p.nombre)}</b><small>${esc(p.codigo || "sin código")}</small></span>
                <span class="ds-fila-precio">${dinero(precioDe(p))}<small class="${bajo ? "ds-bajo" : ""}">${stock} pzas</small></span></button>`;
        }).join("") + (base.length > lista.length ? `<p class="ds-sin">Mostrando ${lista.length} de ${base.length}. Usa el buscador para encontrar otro.</p>` : "");

        filas.querySelectorAll(".ds-fila").forEach(b => b.addEventListener("click", () => {
            const producto = productos.find(p => String(p.id) === b.dataset.id);
            if (producto) abrirFichaExistente(producto);
        }));
    }

    function mostrarError(texto) { const c = el("dsError"); if (c) { c.textContent = texto || ""; c.hidden = !texto; } }

    function abrirFichaExistente(producto) {
        ficha = { tipo: "existe", producto, codigo: producto.codigo || "", nombre: producto.nombre || "", marca: producto.marca || "", catalogoMaestroId: producto.catalogo_maestro_id || null, foto: producto.imagenUrl || "" };
        const sug = el("dsSugerencias"); if (sug) sug.hidden = true;
        pintarFicha();
    }

    async function alEscanear(texto) {
        const valor = String(texto || "").trim();
        if (!valor) return;

        if (vista !== "mercancia") return;

        mostrarError("");
        const sug = el("dsSugerencias"); if (sug) sug.hidden = true;

        const propio = porCodigo.get(codigoNorm(valor));
        if (propio) { pitar(true); abrirFichaExistente(propio); return; }

        const pareceCodigo = !/\s/.test(valor) && /\d{5,}/.test(valor);
        if (!pareceCodigo) { sugerirPorNombre(valor); return; }

        const zona = el("dsFicha");
        if (zona) zona.innerHTML = `<div class="ds-vacio"><h3>Buscando…</h3><p>${esc(valor)}</p></div>`;

        let coincidencia = null;
        try {
            const datos = await llamar(`/explorar-nexo/buscar?q=${encodeURIComponent(valor)}`);
            coincidencia = datos && datos.coincidenciaPorCodigo && datos.coincidenciaPorCodigo.nombre ? datos.coincidenciaPorCodigo : null;
        } catch (error) { coincidencia = null; }

        if (coincidencia) {
            const codigo = coincidencia.ean || coincidencia.codigo || valor;
            ficha = { tipo: "catalogo", codigo, nombre: coincidencia.nombre, marca: coincidencia.marca || "", catalogoMaestroId: coincidencia.catalogoMaestroId || null, foto: "" };
            pitar(true);
            pintarFicha();
            fotoDeCodigo(codigo).then(url => { if (ficha && ficha.codigo === codigo && url) { ficha.foto = url; const foto = document.querySelector(".ds-mini-grande"); if (foto) foto.innerHTML = fotoHtml(url, ficha.nombre); } });
            return;
        }

        ficha = { tipo: "nuevo", codigo: valor, nombre: "", marca: "", catalogoMaestroId: null, foto: "" };
        pitar(false);
        pintarFicha();
    }

    function sugerirPorNombre(texto) {
        const encontrados = buscarPorNombre(texto);
        const caja = el("dsSugerencias");
        if (!caja) return;

        caja.innerHTML = `${encontrados.length ? "<small>Ya tienes estos. Toca uno para corregirlo:</small>" : ""}
            ${encontrados.map(p => `<button type="button" data-id="${esc(p.id)}"><span>${esc(p.nombre)}</span><strong>${dinero(precioDe(p))}</strong></button>`).join("")}
            <button type="button" data-nuevo="1" class="ds-sug-nuevo">+ Agregar “${esc(texto)}” como producto nuevo</button>`;
        caja.hidden = false;

        caja.querySelectorAll("button").forEach(b => b.addEventListener("click", () => {
            if (b.dataset.nuevo) { ficha = { tipo: "nuevo", codigo: "", nombre: texto, marca: "", catalogoMaestroId: null, foto: "" }; caja.hidden = true; pintarFicha(); return; }
            const producto = productos.find(p => String(p.id) === b.dataset.id);
            if (producto) abrirFichaExistente(producto);
        }));
    }

    function cancelar() { ficha = null; mostrarError(""); pintarFicha(); }

    async function guardar() {
        if (!ficha || guardando) return;

        const nombre = String(el("dsNombre")?.value || "").trim();
        const precio = Number(el("dsPrecio")?.value);
        const stockTexto = String(el("dsStock")?.value || "").trim();

        if (!nombre) { mostrarError("Escribe cómo se llama el producto."); el("dsNombre")?.focus(); return; }
        if (!(precio > 0)) { mostrarError("Escribe el precio de venta."); el("dsPrecio")?.focus(); return; }

        guardando = true;
        mostrarError("");
        const boton = el("dsGuardar");
        if (boton) { boton.disabled = true; boton.textContent = "Guardando…"; }

        try {
            if (ficha.tipo === "existe") {
                const p = ficha.producto;
                const cambios = {};
                if (nombre !== p.nombre) cambios.nombre = nombre;
                if (Math.abs(precio - precioDe(p)) > 0.0001) cambios.precioPublico = precio;
                if (Object.keys(cambios).length) await llamar(`/productos/${p.id}/edicion-rapida`, { method: "PATCH", body: JSON.stringify(cambios) });
                if (stockTexto !== "" && Number(stockTexto) !== Number(p.stock || 0)) {
                    await llamar("/ajustes-inventario", { method: "POST", body: JSON.stringify({ productoId: p.id, tipo: "conteo", cantidad: Number(stockTexto), motivo: "Conteo desde Mi mercancía" }) });
                }
            } else {
                const cuerpo = { nombre, precio, precioPublico: precio, stock: stockTexto === "" ? 0 : Number(stockTexto), stockMinimo: 3, codigo: ficha.codigo || "", unidadVenta: "pieza" };
                if (ficha.marca) cuerpo.marca = ficha.marca;
                if (ficha.catalogoMaestroId) cuerpo.catalogoMaestroId = ficha.catalogoMaestroId;

                const creado = await llamar("/agregar-producto", { method: "POST", body: JSON.stringify(cuerpo) });
                if (!ficha.codigo && creado && creado.productoId) {
                    try { await llamar(`/productos/${creado.productoId}/generar-codigo`, { method: "POST" }); } catch (error) { /* se puede generar despues */ }
                }
                sumarHoy();
            }

            pitar(true);
            aviso(ficha.tipo === "existe" ? "Cambios guardados" : `${nombre} agregado`);
            ficha = null;
            await cargarProductos();
            pintarContadores();
            pintarFicha();
            pintarLista();
        } catch (error) {
            mostrarError(error.message || "No se pudo guardar. Intenta otra vez.");
            const b2 = el("dsGuardar");
            if (b2) { b2.disabled = false; b2.textContent = ficha && ficha.tipo === "existe" ? "Guardar cambios" : "Agregar a mi mercancía"; }
        } finally {
            guardando = false;
        }
    }

    // ---------------------------------------------------------------------
    // Arranque: solo si hay sesion y el negocio tiene la funcion encendida
    // ---------------------------------------------------------------------
    async function revisarFuncion() {
        try {
            const r = await fetchAutenticado("/funciones-beta");
            return Boolean(r && r.funciones && r.funciones.solo_mostrador === true);
        } catch (error) { return false; }
    }

    async function nombreDelNegocio() {
        try {
            const r = await fetchAutenticado("/negocio-actual");
            return (r && (r.nombre || (r.negocio && r.negocio.nombre))) || "";
        } catch (error) { return ""; }
    }

    async function activar() {
        if (activo) return;
        activo = true;

        asegurarEstructura();
        document.documentElement.classList.add("dueno-solo");
        el("dsRaiz").hidden = false;

        nombreNegocio = await nombreDelNegocio();
        await cargarProductos();
        ir("inicio");
    }

    function desactivar() {
        if (!activo) return;
        activo = false;
        detenerCamara();
        document.documentElement.classList.remove("dueno-solo");
        const raiz = el("dsRaiz");
        if (raiz) raiz.hidden = true;
        productos = []; porCodigo = new Map(); ficha = null; actual = null;
    }

    let revisando = false;
    let ultimaSesion = false;

    async function vigilar() {
        if (revisando) return;
        revisando = true;

        try {
            const hay = typeof haySesionActivaDueno === "function" && haySesionActivaDueno();

            if (hay && !activo && (!ultimaSesion || !activo)) {
                if (await revisarFuncion()) await activar();
            } else if (!hay && activo) {
                desactivar();
            }

            ultimaSesion = hay;
        } finally { revisando = false; }
    }

    window.nexoDuenoSolo = { activo: () => activo, ir };

    // Se revisa cada pocos segundos (el login y el PIN no avisan): barato, y solo hace una consulta mientras no este activo.
    let intentos = 0;
    const reloj = setInterval(() => {
        intentos++;
        vigilar();
        // Si despues de ~2 minutos con sesion no hay funcion, se baja la frecuencia.
        if (intentos === 40) { clearInterval(reloj); setInterval(vigilar, 15000); }
    }, 3000);
    setTimeout(vigilar, 800);

    // Cuando se cambia de tab "normal" desde la pestana Mas, la barra de abajo sencilla se queda; Inicio de la barra vuelve a nuestro Inicio.
    document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") vigilar(); });
})();
