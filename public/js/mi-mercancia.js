/* Mi mercancia: la forma MAS SENCILLA de meter productos (negocios chicos, p. ej. La Rinconada). Solo existe con la funcion "solo_mostrador".

   Se pasa el escaner por un producto y pasa una de tres cosas:
     1. Ya lo tienes     -> sale su ficha con el precio y las existencias, para corregirlos.
     2. Nexo lo reconoce -> (catalogo de Nexo) ya trae nombre, marca y foto: solo se pone el precio.
     3. Es nuevo         -> se escribe como se llama y el precio.
   Enter guarda y vuelve a quedar listo para el siguiente. Debajo va la lista de lo que ya se metio, con buscador.

   Usa las rutas de siempre (nada nuevo en el servidor): GET /productos, GET /explorar-nexo/buscar y /foto, POST /agregar-producto,
   PATCH /productos/:id/edicion-rapida y POST /ajustes-inventario. */
(function () {
    const LLAVE_HOY = "nexoMiMercanciaHoy";
    const MAXIMO_FILAS = 60;

    let productos = [];
    let porCodigo = new Map();
    let ficha = null; // { tipo: "existe" | "catalogo" | "nuevo", producto?, codigo, nombre, marca, catalogoMaestroId, foto }
    let guardando = false;
    let audio = null;

    const esc = valor => String(valor == null ? "" : valor).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
    const dinero = valor => "$" + Number(valor || 0).toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const codigoNorm = codigo => String(codigo || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
    const plano = texto => String(texto || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
    const precioDe = p => Number(p.precio_publico != null && Number(p.precio_publico) > 0 ? p.precio_publico : p.precio || 0);
    const raiz = () => document.getElementById("pantallaMiMercancia");
    const el = id => document.getElementById(id);
    const hoyTexto = () => new Date().toISOString().slice(0, 10);

    function leerHoy() {
        try {
            const dato = JSON.parse(localStorage.getItem(LLAVE_HOY) || "null");
            return dato && dato.dia === hoyTexto() ? Number(dato.n) || 0 : 0;
        } catch (error) { return 0; }
    }

    function sumarHoy() {
        try { localStorage.setItem(LLAVE_HOY, JSON.stringify({ dia: hoyTexto(), n: leerHoy() + 1 })); } catch (error) { /* sin almacenamiento */ }
    }

    // Un pitido corto: confirma que se guardo (agudo) o que el codigo no se reconocio (grave). Sin sonido si el navegador no lo permite.
    function pitar(tipo) {
        try {
            audio = audio || new (window.AudioContext || window.webkitAudioContext)();
            const oscilador = audio.createOscillator();
            const volumen = audio.createGain();
            oscilador.frequency.value = tipo === "ok" ? 988 : 240;
            volumen.gain.value = 0.06;
            oscilador.connect(volumen);
            volumen.connect(audio.destination);
            oscilador.start();
            oscilador.stop(audio.currentTime + (tipo === "ok" ? 0.09 : 0.18));
        } catch (error) { /* sin audio */ }
    }

    async function cargarProductos() {
        try {
            const respuesta = await fetch("/productos");
            if (!respuesta.ok) return;
            const lista = await respuesta.json();
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

    async function llamar(ruta, opciones = {}) {
        const respuesta = await fetch(ruta, { headers: { "Content-Type": "application/json" }, ...opciones });
        let cuerpo = null;
        try { cuerpo = await respuesta.json(); } catch (error) { cuerpo = null; }
        if (!respuesta.ok) throw new Error((cuerpo && (cuerpo.error || cuerpo.mensaje)) || "No se pudo guardar. Intenta otra vez.");
        return cuerpo;
    }

    // ---------------------------------------------------------------------
    // Pantalla
    // ---------------------------------------------------------------------
    function pintar() {
        const contenedor = raiz();
        if (!contenedor) return;

        contenedor.innerHTML = `<div class="mm-shell">
            <header class="mm-cab">
                <div><h2>Mi mercancía</h2><p>Pasa el escáner por cada producto. Si Nexo ya lo conoce, solo pones el precio.</p></div>
                <div class="mm-contadores" id="mmContadores"></div>
            </header>
            <section class="mm-escaner">
                <label class="mm-scan"><span aria-hidden="true">▮▮▯▮</span>
                    <input id="mmScan" type="text" inputmode="text" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="Escanea un producto (o escribe su nombre) y presiona Enter" aria-label="Escanear producto">
                </label>
                <div id="mmSugerencias" class="mm-sugerencias" hidden></div>
            </section>
            <section id="mmFicha" class="mm-zona-ficha"></section>
            <section class="mm-lista">
                <div class="mm-lista-cab"><h3>Lo que ya tienes <small id="mmTotal"></small></h3><input id="mmBuscar" type="search" autocomplete="off" placeholder="Buscar en mis productos" aria-label="Buscar en mis productos"></div>
                <div id="mmFilas" class="mm-filas"></div>
            </section>
        </div>`;

        enlazar();
        pintarContadores();
        pintarFicha();
        pintarLista();
    }

    function pintarContadores() {
        const contenedor = el("mmContadores");
        if (!contenedor) return;
        contenedor.innerHTML = `<div class="mm-cont"><b>${productos.length}</b><span>productos</span></div><div class="mm-cont mm-cont-verde"><b>${leerHoy()}</b><span>metidos hoy</span></div>`;
    }

    function fotoHtml(url, nombre) {
        return url
            ? `<img src="${esc(url)}" alt="" loading="lazy" onerror="this.replaceWith(Object.assign(document.createElement('b'),{textContent:'${esc(String(nombre || '?').charAt(0).toUpperCase())}'}))">`
            : `<b>${esc(String(nombre || "?").charAt(0).toUpperCase())}</b>`;
    }

    function pintarFicha() {
        const zona = el("mmFicha");
        if (!zona) return;

        if (!ficha) {
            zona.innerHTML = productos.length
                ? `<div class="mm-vacio"><span aria-hidden="true">📦</span><div><b>Listo para el siguiente</b><p>Pasa el escáner por un producto. Si ya lo tienes puedes corregir su precio o sus existencias.</p></div></div>`
                : `<div class="mm-vacio mm-inicio"><span aria-hidden="true">👋</span><div><b>Empecemos con tu primer producto</b><p>Toma cualquier producto de tu tienda y pásalo por el escáner. Nexo busca su nombre y su foto; tú solo le pones el precio y cuántas tienes. Así, uno por uno, vas armando tu inventario.</p></div></div>`;
            return;
        }

        const titulos = { existe: "Ya lo tienes", catalogo: "Nexo lo reconoce", nuevo: "Producto nuevo" };
        const p = ficha.producto;
        const precio = p ? precioDe(p) : "";
        const stock = p ? Number(p.stock || 0) : "";

        zona.innerHTML = `<div class="mm-ficha mm-ficha-${ficha.tipo}">
            <div class="mm-foto">${fotoHtml(ficha.foto, ficha.nombre)}</div>
            <div class="mm-ficha-cuerpo">
                <span class="mm-etiqueta mm-etiqueta-${ficha.tipo}">${titulos[ficha.tipo]}</span>
                <input class="mm-nombre" id="mmNombre" value="${esc(ficha.nombre)}" placeholder="¿Cómo se llama?" aria-label="Nombre del producto" autocomplete="off">
                <small class="mm-codigo">${esc([ficha.marca, ficha.codigo].filter(Boolean).join(" · ") || "Sin código: Nexo le pondrá uno")}</small>
                <div class="mm-campos">
                    <label><span>Precio de venta</span><div class="mm-caja"><i>$</i><input id="mmPrecio" type="text" inputmode="decimal" autocomplete="off" placeholder="0.00" value="${precio === "" ? "" : esc(precio)}"></div></label>
                    <label><span>${ficha.tipo === "existe" ? "Cuántas tienes" : "¿Cuántas tienes? (si no sabes, déjalo vacío)"}</span><div class="mm-caja"><input id="mmStock" type="text" inputmode="numeric" autocomplete="off" placeholder="0" value="${stock === "" ? "" : esc(stock)}"></div></label>
                </div>
                <div class="mm-acciones">
                    <button type="button" class="mm-guardar" id="mmGuardar">${ficha.tipo === "existe" ? "Guardar cambios" : "Agregar a mi mercancía"}</button>
                    <button type="button" class="mm-cancelar" id="mmCancelar">Cancelar</button>
                    <span class="mm-ayuda">Enter guarda · Esc cancela</span>
                </div>
                <p class="mm-error" id="mmError" role="alert" hidden></p>
            </div>
        </div>`;

        el("mmGuardar").addEventListener("click", guardar);
        el("mmCancelar").addEventListener("click", cancelar);

        ["mmNombre", "mmPrecio", "mmStock"].forEach(id => {
            el(id).addEventListener("keydown", evento => {
                if (evento.key === "Enter") { evento.preventDefault(); guardar(); }
                if (evento.key === "Escape") { evento.preventDefault(); cancelar(); }
            });
        });

        el("mmPrecio").addEventListener("input", evento => { evento.target.value = evento.target.value.replace(/[^\d.]/g, "").replace(/(\..*)\./g, "$1"); });
        el("mmStock").addEventListener("input", evento => { evento.target.value = evento.target.value.replace(/\D/g, ""); });

        zona.scrollIntoView({ block: "nearest", behavior: "smooth" });
        // lo siguiente que se necesita: el precio (casi siempre) o el nombre (si es nuevo y no tiene)
        setTimeout(() => { const campo = ficha && !ficha.nombre ? el("mmNombre") : el("mmPrecio"); if (campo) { campo.focus(); campo.select(); } }, 30);
    }

    function pintarLista() {
        const filas = el("mmFilas");
        if (!filas) return;

        const q = plano(el("mmBuscar")?.value || "");
        const base = q ? productos.filter(p => plano(`${p.nombre} ${p.marca || ""} ${p.codigo || ""}`).includes(q)) : [...productos].sort((a, b) => Number(b.id) - Number(a.id));
        const lista = base.slice(0, MAXIMO_FILAS);

        const total = el("mmTotal");
        if (total) total.textContent = q ? `${base.length} encontrados` : `${productos.length}`;

        if (!lista.length) {
            filas.innerHTML = `<p class="mm-sin">${q ? "No encontré ese producto." : "Aquí irán apareciendo los productos que metas."}</p>`;
            return;
        }

        filas.innerHTML = lista.map(p => {
            const stock = Number(p.stock || 0);
            const bajo = stock <= Number(p.stock_minimo == null ? 3 : p.stock_minimo);

            return `<button type="button" class="mm-fila" data-id="${esc(p.id)}">
                <span class="mm-mini">${fotoHtml(p.imagenUrl, p.nombre)}</span>
                <span class="mm-fila-info"><b>${esc(p.nombre)}</b><small>${esc(p.codigo || "sin código")}</small></span>
                <span class="mm-fila-precio">${dinero(precioDe(p))}</span>
                <span class="mm-stock ${bajo ? "mm-stock-bajo" : ""}">${stock} pzas</span>
            </button>`;
        }).join("") + (base.length > lista.length ? `<p class="mm-sin">Mostrando ${lista.length} de ${base.length}. Escribe en el buscador para encontrar otro.</p>` : "");

        filas.querySelectorAll(".mm-fila").forEach(boton => boton.addEventListener("click", () => {
            const producto = productos.find(p => String(p.id) === boton.dataset.id);
            if (producto) abrirFichaExistente(producto);
        }));
    }

    function mostrarError(texto) {
        const caja = el("mmError");
        if (!caja) return;
        caja.textContent = texto || "";
        caja.hidden = !texto;
    }

    // ---------------------------------------------------------------------
    // Escaneo
    // ---------------------------------------------------------------------
    function abrirFichaExistente(producto) {
        ficha = { tipo: "existe", producto, codigo: producto.codigo || "", nombre: producto.nombre || "", marca: producto.marca || "", catalogoMaestroId: producto.catalogo_maestro_id || null, foto: producto.imagenUrl || "" };
        limpiarSugerencias();
        pintarFicha();
    }

    async function fotoDeCodigo(codigo) {
        try {
            const respuesta = await fetch(`/explorar-nexo/foto/${encodeURIComponent(codigo)}`);
            const datos = await respuesta.json();
            return datos && datos.url ? datos.url : "";
        } catch (error) { return ""; }
    }

    async function alEscanear(texto) {
        const valor = String(texto || "").trim();
        if (!valor) return;

        mostrarError("");
        limpiarSugerencias();

        const propio = porCodigo.get(codigoNorm(valor));

        if (propio) { pitar("ok"); abrirFichaExistente(propio); return; }

        // Un codigo de barras: sin espacios y con numeros. Cualquier otra cosa se busca como nombre.
        const pareceCodigo = !/\s/.test(valor) && /\d{5,}/.test(valor);

        if (!pareceCodigo) { buscarPorNombre(valor); return; }

        const zona = el("mmFicha");
        if (zona) zona.innerHTML = `<div class="mm-vacio"><span aria-hidden="true">🔎</span><div><b>Buscando…</b><p>${esc(valor)}</p></div></div>`;

        let coincidencia = null;

        try {
            const respuesta = await fetch(`/explorar-nexo/buscar?q=${encodeURIComponent(valor)}`);
            const datos = await respuesta.json();
            coincidencia = datos && datos.coincidenciaPorCodigo && datos.coincidenciaPorCodigo.nombre ? datos.coincidenciaPorCodigo : null;
        } catch (error) { coincidencia = null; }

        if (coincidencia) {
            const codigo = coincidencia.ean || coincidencia.codigo || valor;
            ficha = { tipo: "catalogo", codigo, nombre: coincidencia.nombre, marca: coincidencia.marca || "", catalogoMaestroId: coincidencia.catalogoMaestroId || null, foto: "" };
            pitar("ok");
            pintarFicha();
            fotoDeCodigo(codigo).then(url => { if (ficha && ficha.codigo === codigo && url) { ficha.foto = url; const foto = raiz()?.querySelector(".mm-foto"); if (foto) foto.innerHTML = fotoHtml(url, ficha.nombre); } });
            return;
        }

        ficha = { tipo: "nuevo", codigo: valor, nombre: "", marca: "", catalogoMaestroId: null, foto: "" };
        pitar("no");
        pintarFicha();
    }

    function limpiarSugerencias() {
        const caja = el("mmSugerencias");
        if (caja) { caja.hidden = true; caja.innerHTML = ""; }
    }

    function buscarPorNombre(texto) {
        const q = plano(texto);
        const encontrados = productos.filter(p => plano(`${p.nombre} ${p.marca || ""}`).includes(q)).slice(0, 6);
        const caja = el("mmSugerencias");
        if (!caja) return;

        caja.innerHTML = `${encontrados.length ? `<small>Ya tienes estos. Toca uno para corregirlo:</small>` : ""}
            ${encontrados.map(p => `<button type="button" class="mm-sug" data-id="${esc(p.id)}"><span class="mm-mini">${fotoHtml(p.imagenUrl, p.nombre)}</span><b>${esc(p.nombre)}</b><i>${dinero(precioDe(p))}</i></button>`).join("")}
            <button type="button" class="mm-sug mm-sug-nuevo" data-nuevo="1">+ Agregar “${esc(texto)}” como producto nuevo</button>`;
        caja.hidden = false;

        caja.querySelectorAll(".mm-sug").forEach(boton => boton.addEventListener("click", () => {
            if (boton.dataset.nuevo) {
                ficha = { tipo: "nuevo", codigo: "", nombre: texto, marca: "", catalogoMaestroId: null, foto: "" };
                limpiarSugerencias();
                el("mmScan").value = "";
                pintarFicha();
                return;
            }
            const producto = productos.find(p => String(p.id) === boton.dataset.id);
            if (producto) { el("mmScan").value = ""; abrirFichaExistente(producto); }
        }));
    }

    function cancelar() {
        ficha = null;
        mostrarError("");
        pintarFicha();
        enfocarEscaner();
    }

    function enfocarEscaner() {
        const campo = el("mmScan");
        if (campo) { campo.value = ""; campo.focus(); }
    }

    // ---------------------------------------------------------------------
    // Guardar
    // ---------------------------------------------------------------------
    async function guardar() {
        if (!ficha || guardando) return;

        const nombre = String(el("mmNombre")?.value || "").trim();
        const precio = Number(el("mmPrecio")?.value);
        const stockTexto = String(el("mmStock")?.value || "").trim();

        if (!nombre) { mostrarError("Escribe cómo se llama el producto."); el("mmNombre")?.focus(); return; }
        if (!(precio > 0)) { mostrarError("Escribe el precio de venta."); el("mmPrecio")?.focus(); return; }

        guardando = true;
        mostrarError("");
        const boton = el("mmGuardar");
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

                // Sin codigo no se puede escanear: se le crea uno interno (igual que el boton "Generar codigo").
                if (!ficha.codigo && creado && creado.productoId) {
                    try { await llamar(`/productos/${creado.productoId}/generar-codigo`, { method: "POST" }); } catch (error) { /* queda sin codigo; se puede generar despues */ }
                }

                sumarHoy();
            }

            pitar("ok");
            if (typeof window.mostrarToastPOS === "function") window.mostrarToastPOS(ficha.tipo === "existe" ? "Cambios guardados" : `${nombre} agregado`, { titulo: "Mi mercancía", tipo: "exito" });

            ficha = null;
            await cargarProductos();
            pintarContadores();
            pintarFicha();
            pintarLista();
            enfocarEscaner();
        } catch (error) {
            mostrarError(error.message || "No se pudo guardar.");
            const boton2 = el("mmGuardar");
            if (boton2) { boton2.disabled = false; boton2.textContent = ficha && ficha.tipo === "existe" ? "Guardar cambios" : "Agregar a mi mercancía"; }
        } finally {
            guardando = false;
        }
    }

    function enlazar() {
        const escaner = el("mmScan");

        escaner.addEventListener("keydown", evento => {
            if (evento.key === "Enter") { evento.preventDefault(); const texto = escaner.value; escaner.value = ""; alEscanear(texto); }
            if (evento.key === "Escape") { evento.preventDefault(); cancelar(); }
        });

        el("mmBuscar").addEventListener("input", pintarLista);
    }

    window.mostrarMiMercancia = async function () {
        if (typeof ocultarPantallasPrincipales === "function") ocultarPantallasPrincipales();

        const contenedor = raiz();
        if (!contenedor) return;

        contenedor.style.display = "block";
        if (typeof actualizarTopbarContexto === "function") actualizarTopbarContexto("Mi mercancía", "Escanea y pon el precio", "mi-mercancia");

        ficha = null;
        pintar();
        enfocarEscaner();

        await cargarProductos();
        pintarContadores();
        pintarFicha();
        pintarLista();
    };

    // El mostrador de precios manda aqui el codigo que no conoce: se abre Mi mercancia con ese codigo ya escaneado.
    async function abrirConCodigo(codigo) { await window.mostrarMiMercancia(); await alEscanear(String(codigo || "")); }

    window.nexoMiMercancia = { abrirConCodigo, productos: () => productos, recargar: cargarProductos, hoy: leerHoy };
})();
