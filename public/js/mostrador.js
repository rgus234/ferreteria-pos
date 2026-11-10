// Mostrador de precios: pantalla completa para un monitor junto a la caja. Se escanea un producto y sale su foto, nombre y precio en grande;
// con "+" se va armando una cuenta con su total. No cobra, no mueve inventario y no toca el punto de venta.
// Solo existe si el negocio tiene encendida la funcion "mostrador" (Nexo -> Funciones nuevas).
(function () {
    const CLAVE_MODO = "nexo_modo_mostrador";
    const CLAVE_AUTO = "nexo_mostrador_sumar_al_escanear";
    const REFRESCO_MS = 3 * 60 * 1000;

    let abierto = false;
    let productos = [];
    let porCodigo = new Map();
    let actual = null;
    let cuenta = [];
    let temporizador = null;
    let raiz = null;

    const esc = v => String(v ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
    const dinero = n => "$" + Number(n || 0).toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const codigoNorm = c => String(c || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
    const plano = t => String(t || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
    const guardado = (k, d) => { try { return localStorage.getItem(k) ?? d; } catch (e) { return d; } };
    const guardar = (k, v) => { try { localStorage.setItem(k, v); } catch (e) { /* sin almacenamiento */ } };

    const precioDe = p => Number(p.precio_publico ?? p.precio ?? 0);

    async function cargarProductos() {
        try {
            const r = await fetch("/productos");
            if (!r.ok) return;
            const lista = await r.json();
            if (!Array.isArray(lista)) return;
            productos = lista;
            porCodigo = new Map();
            lista.forEach(p => {
                [p.codigo, ...(Array.isArray(p.codigos_relacionados) ? p.codigos_relacionados.map(c => c.codigo) : [])].forEach(c => {
                    const k = codigoNorm(c);
                    if (k && !porCodigo.has(k)) porCodigo.set(k, p);
                });
            });
            const n = raiz?.querySelector("#mosTotalProductos");
            if (n) n.textContent = `${lista.length} productos`;
        } catch (e) { /* se queda con lo que ya tenia */ }
    }

    function construir() {
        raiz = document.createElement("div");
        raiz.id = "mostrador";
        raiz.hidden = true;
        raiz.innerHTML = `
            <div class="mos-barra">
                <input id="mosEntrada" type="text" inputmode="text" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="Escanea un producto o escribe su nombre">
                <label class="mos-auto"><input id="mosAuto" type="checkbox"> Sumar al escanear</label>
                <span id="mosTotalProductos" class="mos-chico"></span>
                <button type="button" id="mosSalir" class="mos-salir" title="Salir del mostrador">Salir</button>
            </div>
            <div id="mosSugerencias" class="mos-sugerencias" hidden></div>
            <div id="mosEscena" class="mos-escena"></div>
            <button type="button" id="mosCarrito" class="mos-carrito" title="Ver la cuenta (F2)">
                <span class="mos-carrito-icono" aria-hidden="true">🛒</span>
                <span id="mosCarritoCant">0</span>
                <strong id="mosCarritoTotal">$0.00</strong>
            </button>
            <aside id="mosPanel" class="mos-panel" hidden>
                <header><h2>Cuenta</h2><button type="button" id="mosCerrarPanel" aria-label="Cerrar">✕</button></header>
                <div id="mosLista" class="mos-lista"></div>
                <footer>
                    <div class="mos-total"><span>Total</span><strong id="mosPanelTotal">$0.00</strong></div>
                    <button type="button" id="mosNueva" class="mos-nueva">Nueva cuenta (F4)</button>
                </footer>
            </aside>`;
        document.body.appendChild(raiz);

        const entrada = raiz.querySelector("#mosEntrada");

        entrada.addEventListener("keydown", e => {
            e.stopPropagation();
            if (e.key === "Enter") { e.preventDefault(); procesarEntrada(entrada.value); entrada.value = ""; ocultarSugerencias(); }
            else if (e.key === "Escape") { e.preventDefault(); entrada.value = ""; ocultarSugerencias(); limpiarActual(); }
            else if (e.key === "+" || (e.key === "Add")) { e.preventDefault(); if (!entrada.value) sumarActual(); }
        });
        entrada.addEventListener("keypress", e => e.stopPropagation());
        entrada.addEventListener("keyup", e => e.stopPropagation());
        entrada.addEventListener("input", () => sugerir(entrada.value));
        entrada.addEventListener("blur", () => setTimeout(() => { if (abierto && !raiz.querySelector("#mosPanel").contains(document.activeElement)) entrada.focus(); }, 120));

        raiz.querySelector("#mosAuto").checked = guardado(CLAVE_AUTO, "0") === "1";
        raiz.querySelector("#mosAuto").addEventListener("change", e => { guardar(CLAVE_AUTO, e.target.checked ? "1" : "0"); entrada.focus(); });
        raiz.querySelector("#mosSalir").addEventListener("click", () => cerrar(true));
        raiz.querySelector("#mosCarrito").addEventListener("click", () => alternarPanel());
        raiz.querySelector("#mosCerrarPanel").addEventListener("click", () => alternarPanel(false));
        raiz.querySelector("#mosNueva").addEventListener("click", nuevaCuenta);
        raiz.querySelector("#mosEscena").addEventListener("click", e => { if (e.target.closest("#mosSumar")) sumarActual(); });
        raiz.querySelector("#mosLista").addEventListener("click", e => {
            const b = e.target.closest("button[data-acc]");
            if (!b) return;
            const i = Number(b.dataset.i);
            if (b.dataset.acc === "mas") cuenta[i].cant += 1;
            if (b.dataset.acc === "menos") cuenta[i].cant -= 1;
            if (b.dataset.acc === "quitar" || cuenta[i].cant <= 0) cuenta.splice(i, 1);
            pintarCuenta();
        });
        raiz.querySelector("#mosSugerencias").addEventListener("mousedown", e => {
            const b = e.target.closest("button[data-id]");
            if (!b) return;
            e.preventDefault();
            mostrar(productos.find(p => String(p.id) === b.dataset.id));
            entrada.value = "";
            ocultarSugerencias();
        });

        // Todo lo que se teclee aqui NO debe llegar al punto de venta que esta debajo.
        window.addEventListener("keydown", e => {
            if (!abierto) return;
            if (e.target !== entrada) {
                if (e.key === "F2") { e.preventDefault(); alternarPanel(); }
                else if (e.key === "F4") { e.preventDefault(); nuevaCuenta(); }
                else if (e.key === "+" || e.key === "Add") { e.preventDefault(); sumarActual(); }
                e.stopPropagation();
                if (e.key.length === 1) entrada.focus();
            } else if (e.key === "F2") { e.preventDefault(); alternarPanel(); }
            else if (e.key === "F4") { e.preventDefault(); nuevaCuenta(); }
        }, true);

        pintarEscena();
    }

    function procesarEntrada(texto) {
        const t = String(texto || "").trim();
        if (!t) return;
        const p = porCodigo.get(codigoNorm(t));

        if (p) {
            mostrar(p);
            if (raiz.querySelector("#mosAuto").checked) sumarActual();
            return;
        }

        if (/^\d{6,}$/.test(t)) { actual = { desconocido: t }; pintarEscena(); return; }

        const r = buscar(t);
        if (r.length) mostrar(r[0]); else { actual = { desconocido: t }; pintarEscena(); }
    }

    function buscar(texto) {
        const tokens = plano(texto).split(/\s+/).filter(Boolean);
        if (!tokens.length) return [];
        return productos.filter(p => { const base = plano(`${p.nombre} ${p.marca || ""}`); return tokens.every(t => base.includes(t)); }).slice(0, 6);
    }

    function sugerir(texto) {
        const caja = raiz.querySelector("#mosSugerencias");
        const t = String(texto || "").trim();
        if (t.length < 2 || /^\d+$/.test(t)) { ocultarSugerencias(); return; }
        const r = buscar(t);
        if (!r.length) { ocultarSugerencias(); return; }
        caja.innerHTML = r.map(p => `<button type="button" data-id="${esc(p.id)}"><span>${esc(p.nombre)}</span><strong>${dinero(precioDe(p))}</strong></button>`).join("");
        caja.hidden = false;
    }

    function ocultarSugerencias() { raiz.querySelector("#mosSugerencias").hidden = true; }

    function limpiarActual() { actual = null; pintarEscena(); }

    async function mostrar(p) {
        if (!p) return;
        actual = p;
        pintarEscena();
        if (!p.imagenUrl && p.codigo && !p.__fotoBuscada) {
            p.__fotoBuscada = true;
            try {
                const r = await fetch(`/explorar-nexo/foto/${encodeURIComponent(codigoNorm(p.codigo))}`);
                const d = r.ok ? await r.json() : null;
                if (d?.url) { p.imagenUrl = d.url; if (actual === p) pintarEscena(); }
            } catch (e) { /* sin foto */ }
        }
    }

    function pintarEscena() {
        const e = raiz.querySelector("#mosEscena");

        if (!actual) {
            e.innerHTML = `<div class="mos-vacio"><div class="mos-vacio-icono" aria-hidden="true">▮▯▮▮▯▮</div><h1>Pasa el producto por el lector</h1><p>Verás su foto y su precio aquí.</p></div>`;
            return;
        }

        if (actual.desconocido) {
            e.innerHTML = `<div class="mos-vacio mos-desconocido"><h1>Producto no registrado</h1><p>El código <strong>${esc(actual.desconocido)}</strong> no está en el inventario.</p><p>Avisa al encargado.</p></div>`;
            return;
        }

        const p = actual;
        const porKg = /kilo|kg|granel/i.test(String(p.unidad_venta || ""));
        const foto = p.imagenUrl ? `<img src="${esc(p.imagenUrl)}" alt="">` : `<div class="mos-sinfoto">${esc((p.nombre || "?").trim().charAt(0).toUpperCase())}</div>`;
        const dentro = cuenta.find(c => c.id === p.id);

        e.innerHTML = `
            <div class="mos-foto">${foto}</div>
            <div class="mos-datos">
                <div class="mos-nombre">${esc(p.nombre)}</div>
                ${p.marca || p.presentacion_compra ? `<div class="mos-sub">${esc([p.marca, p.presentacion_compra].filter(Boolean).join(" · "))}</div>` : ""}
                <div class="mos-precio">${dinero(precioDe(p))}${porKg ? `<small> / kg</small>` : ""}</div>
                <button type="button" id="mosSumar" class="mos-sumar">+ Sumar a la cuenta${dentro ? ` <span>(ya hay ${dentro.cant})</span>` : ""}</button>
            </div>`;
    }

    function sumarActual() {
        if (!actual || actual.desconocido) return;
        const ya = cuenta.find(c => c.id === actual.id);
        if (ya) ya.cant += 1; else cuenta.push({ id: actual.id, nombre: actual.nombre, precio: precioDe(actual), cant: 1 });
        pintarCuenta();
        pintarEscena();
        const b = raiz.querySelector("#mosCarrito");
        b.classList.remove("mos-pulso"); void b.offsetWidth; b.classList.add("mos-pulso");
    }

    function pintarCuenta() {
        const total = cuenta.reduce((s, c) => s + c.precio * c.cant, 0);
        const piezas = cuenta.reduce((s, c) => s + c.cant, 0);
        raiz.querySelector("#mosCarritoCant").textContent = piezas;
        raiz.querySelector("#mosCarritoTotal").textContent = dinero(total);
        raiz.querySelector("#mosPanelTotal").textContent = dinero(total);
        raiz.querySelector("#mosLista").innerHTML = cuenta.length
            ? cuenta.map((c, i) => `<div class="mos-fila"><div class="mos-fila-nombre">${esc(c.nombre)}<small>${dinero(c.precio)} c/u</small></div><div class="mos-fila-cant"><button type="button" data-acc="menos" data-i="${i}">−</button><b>${c.cant}</b><button type="button" data-acc="mas" data-i="${i}">+</button></div><div class="mos-fila-importe">${dinero(c.precio * c.cant)}</div><button type="button" class="mos-quitar" data-acc="quitar" data-i="${i}" aria-label="Quitar">✕</button></div>`).join("")
            : `<p class="mos-lista-vacia">Todavía no hay productos en la cuenta.</p>`;
    }

    function alternarPanel(forzar) {
        const p = raiz.querySelector("#mosPanel");
        p.hidden = typeof forzar === "boolean" ? !forzar : !p.hidden;
        raiz.querySelector("#mosEntrada").focus();
    }

    function nuevaCuenta() {
        cuenta = [];
        pintarCuenta();
        pintarEscena();
        raiz.querySelector("#mosEntrada").focus();
    }

    async function abrir() {
        if (abierto) return;
        if (!raiz) construir();
        abierto = true;
        guardar(CLAVE_MODO, "1");
        raiz.hidden = false;
        document.documentElement.classList.add("mostrador-abierto");
        pintarCuenta();
        await cargarProductos();
        temporizador = setInterval(cargarProductos, REFRESCO_MS);
        raiz.querySelector("#mosEntrada").focus();
        pintarChip();
    }

    function cerrar(salir) {
        if (!abierto) return;
        abierto = false;
        if (salir) guardar(CLAVE_MODO, "0");
        clearInterval(temporizador);
        raiz.hidden = true;
        document.documentElement.classList.remove("mostrador-abierto");
        pintarChip();
    }

    // Boton chico para entrar al modo (solo si la funcion esta encendida). Un equipo que ya quedo como mostrador abre solo al iniciar.
    function pintarChip() {
        let chip = document.getElementById("mosChip");
        const activa = typeof window.funcionBeta === "function" && window.funcionBeta("mostrador");

        if (!activa || abierto) { if (chip) chip.hidden = true; return; }

        if (!chip) {
            chip = document.createElement("button");
            chip.id = "mosChip";
            chip.type = "button";
            chip.className = "mos-chip";
            chip.textContent = "Mostrador de precios";
            chip.addEventListener("click", abrir);
            document.body.appendChild(chip);
        }

        chip.hidden = false;
    }

    function alCambiarFunciones() {
        pintarChip();
        if (typeof window.funcionBeta === "function" && window.funcionBeta("mostrador") && guardado(CLAVE_MODO, "0") === "1") abrir();
        else if (abierto && !window.funcionBeta?.("mostrador")) cerrar(true);
    }

    document.addEventListener("nexo-funciones-beta", alCambiarFunciones);
    document.addEventListener("keydown", e => { if (e.ctrlKey && e.altKey && (e.key === "m" || e.key === "M") && window.funcionBeta?.("mostrador")) { e.preventDefault(); abierto ? cerrar(true) : abrir(); } });
})();
