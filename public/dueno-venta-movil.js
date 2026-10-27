/* Vender en el celular: los 4 estorbos (Fase A del plan docs/plan-celular-inventario-y-venta.md).
   1. El teclado tapa lo que se vende  -> mini-carrito fijo ARRIBA (total + Cobrar) que sigue a la pantalla visible.
   2. Escanear no avisa                -> tarjeta con foto, nombre, precio y cantidad + pitido.
   3. El producto queda hasta abajo    -> el carrito se desplaza solo hasta lo agregado; en el escaner lo nuevo sale primero.
   4. Lineas solo de texto             -> en el escaner las lineas llevan foto, precio y botones de cantidad.
   No cambia ninguna regla de venta: solo envuelve las funciones de dueno.js (agregar, render, escanear) para mostrar mas. */

(function () {
    const carrito = () => (typeof duenoVentaCarrito !== "undefined" ? duenoVentaCarrito : []);
    const dinero2 = valor => (typeof dinero === "function" ? dinero(valor) : "$" + Number(valor || 0).toFixed(2));
    const esc = valor => (typeof escaparDueno === "function" ? escaparDueno(valor) : String(valor ?? ""));

    let barra = null;
    let tarjeta = null;
    let temporizadorTarjeta = null;
    let audio = null;
    let ultimoId = null; // lo ultimo que se agrego o subio de cantidad: en el escaner sale primero

    // ---- Sonido (iOS solo deja sonar despues de un toque: se desbloquea con el primero) ----

    function desbloquearAudio() {
        try {
            audio = audio || new (window.AudioContext || window.webkitAudioContext)();
            if (audio.state === "suspended") audio.resume();
        } catch (error) { /* sin audio: solo se pierde el pitido */ }
    }

    ["pointerdown", "touchstart", "keydown"].forEach(evento => window.addEventListener(evento, desbloquearAudio, { passive: true }));

    function pitido(bueno = true) {
        if (!audio) return;

        try {
            const oscilador = audio.createOscillator();
            const ganancia = audio.createGain();
            oscilador.type = "sine";
            oscilador.frequency.value = bueno ? 1040 : 220;
            ganancia.gain.setValueAtTime(0.18, audio.currentTime);
            ganancia.gain.exponentialRampToValueAtTime(0.001, audio.currentTime + (bueno ? 0.11 : 0.28));
            oscilador.connect(ganancia);
            ganancia.connect(audio.destination);
            oscilador.start();
            oscilador.stop(audio.currentTime + (bueno ? 0.12 : 0.3));
        } catch (error) { /* nada */ }
    }

    // ---- Mini-carrito fijo ----

    function crearBarra() {
        if (barra) return barra;

        barra = document.createElement("div");
        barra.id = "dvmBarra";
        barra.className = "dvm-barra";
        barra.innerHTML = `
            <button type="button" class="dvm-barra-resumen" onclick="dvmIrAlCarrito()" aria-label="Ver la venta">
                <span class="dvm-barra-icono" aria-hidden="true">🛒</span>
                <span><b id="dvmBarraPiezas">0</b> <small>en la venta</small></span>
                <strong id="dvmBarraTotal">$0.00</strong>
            </button>
            <button type="button" class="dvm-barra-cobrar" onclick="dvmCobrar()">Cobrar</button>`;
        document.body.appendChild(barra);

        tarjeta = document.createElement("div");
        tarjeta.id = "dvmTarjeta";
        tarjeta.className = "dvm-tarjeta";
        tarjeta.setAttribute("role", "status");
        tarjeta.setAttribute("aria-live", "polite");
        document.body.appendChild(tarjeta);

        // Con el teclado abierto, iOS desplaza la pantalla visible: la barra y la tarjeta la siguen.
        if (window.visualViewport) {
            const seguir = () => {
                const desplazamiento = `translateY(${Math.round(window.visualViewport.offsetTop)}px)`;
                barra.style.transform = desplazamiento;
                tarjeta.style.transform = desplazamiento;
            };

            window.visualViewport.addEventListener("resize", seguir);
            window.visualViewport.addEventListener("scroll", seguir);
        }

        return barra;
    }

    // Pantallas que cubren Vender (cobro, cliente, escaner): ahi la barra NO va, taparia su flecha de regreso y repetiria "Cobrar".
    const PANTALLAS_SOBRE_VENDER = ["duenoVenderCobroOverlay", "duenoVenderClienteOverlay", "duenoVenderEscanerOverlay", "duenoProductoFormOverlay"];
    const hayPantallaEncima = () => PANTALLAS_SOBRE_VENDER.some(id => { const el = document.getElementById(id); return Boolean(el && (el.classList.contains("abierta") || (id === "duenoProductoFormOverlay" && el.style.display === "flex"))); });

    function ventaVisible() {
        const pestana = document.getElementById("duenoVender");
        return Boolean(pestana && pestana.style.display !== "none") && !hayPantallaEncima();
    }

    // Si una de esas pantallas se abre o se cierra, la barra se acomoda sola.
    function vigilarPantallas() {
        const observador = new MutationObserver(() => actualizarBarra());

        PANTALLAS_SOBRE_VENDER.forEach(id => { const el = document.getElementById(id); if (el) observador.observe(el, { attributes: true, attributeFilter: ["class", "style"] }); });
    }

    function actualizarBarra() {
        const lineas = carrito();
        const visible = ventaVisible() && lineas.length > 0;

        crearBarra();
        barra.classList.toggle("visible", visible);
        document.body.classList.toggle("dvm-con-barra", visible);

        if (!visible) return;

        const piezas = lineas.reduce((suma, item) => suma + Number(item.cantidad || 0), 0);
        const total = typeof resumenCarritoVenderDueno === "function" ? resumenCarritoVenderDueno().total : lineas.reduce((s, i) => s + i.precio * i.cantidad, 0);

        document.getElementById("dvmBarraPiezas").textContent = Number(piezas.toFixed(3));
        document.getElementById("dvmBarraTotal").textContent = dinero2(total);
    }

    window.dvmIrAlCarrito = function () {
        if (typeof cerrarEscanerVenderDueno === "function") cerrarEscanerVenderDueno();

        const tarjetaCarrito = document.getElementById("duenoVenderCarritoCard");
        if (tarjetaCarrito) tarjetaCarrito.scrollIntoView({ behavior: "smooth", block: "start" });
    };

    window.dvmCobrar = function () {
        if (typeof cerrarEscanerVenderDueno === "function") cerrarEscanerVenderDueno();
        if (typeof iniciarCobroVenderDueno === "function") iniciarCobroVenderDueno();
    };

    // ---- Tarjeta de confirmacion ----

    function mostrarTarjeta({ foto, titulo, detalle, cantidad, error = false }) {
        crearBarra();

        tarjeta.className = "dvm-tarjeta visible" + (error ? " dvm-error" : "");
        tarjeta.innerHTML = `
            <span class="dvm-tarjeta-foto">${foto ? `<img src="${esc(foto)}" alt="">` : `<i aria-hidden="true">${error ? "⚠️" : "📦"}</i>`}</span>
            <span class="dvm-tarjeta-texto"><b>${esc(titulo)}</b><small>${esc(detalle)}</small></span>
            ${cantidad ? `<span class="dvm-tarjeta-cantidad">×${esc(cantidad)}</span>` : `<span class="dvm-tarjeta-marca" aria-hidden="true">${error ? "✕" : "✓"}</span>`}`;

        clearTimeout(temporizadorTarjeta);
        temporizadorTarjeta = setTimeout(() => tarjeta.classList.remove("visible"), 2600);
    }

    function avisarAgregado(item) {
        mostrarTarjeta({ foto: item.imagenUrl, titulo: item.nombre, detalle: `${dinero2(item.precio)} · en la venta: ${dinero2(item.precio * item.cantidad)}`, cantidad: item.cantidad });
        pitido(true);
    }

    // ---- Lista del escaner: lo nuevo primero, con foto y botones ----

    function escanerAbierto() {
        return Boolean(document.getElementById("duenoVenderEscanerOverlay")?.classList.contains("abierta"));
    }

    function pintarListaEscaner() {
        const contenedor = document.getElementById("duenoVenderEscaneoCarrito");
        if (!contenedor || typeof filaCarritoVenderDuenoHtml !== "function") return;

        const lineas = carrito().slice().reverse().sort((a, b) => (b.id === ultimoId) - (a.id === ultimoId));

        contenedor.innerHTML = lineas.length
            ? `<div class="dvm-escaner-total"><span>${lineas.length} producto${lineas.length === 1 ? "" : "s"}</span><button type="button" onclick="dvmCobrar()">Cobrar ${dinero2(typeof resumenCarritoVenderDueno === "function" ? resumenCarritoVenderDueno().total : 0)}</button></div>`
                + lineas.map((item, i) => `<div class="${i === 0 ? "dvm-nuevo" : ""}">${filaCarritoVenderDuenoHtml(item)}</div>`).join("")
            : "";
    }

    // ---- Enganche con dueno.js ----

    function envolver(nombre, despues) {
        const original = window[nombre];
        if (typeof original !== "function") return;

        window[nombre] = function (...argumentos) {
            const resultado = original.apply(this, argumentos);
            return resultado && typeof resultado.then === "function" ? resultado.then(valor => { despues(argumentos, valor); return valor; }) : (despues(argumentos, resultado), resultado);
        };
    }

    envolver("renderCarritoVenderDueno", () => { actualizarBarra(); if (escanerAbierto()) pintarListaEscaner(); });
    envolver("cambiarTabDueno", () => actualizarBarra());

    envolver("agregarAlCarritoVenderDueno", ([id]) => {
        const item = carrito().find(linea => linea.id === id);
        if (!item) return;

        ultimoId = item.id;
        avisarAgregado(item);

        if (!escanerAbierto()) {
            const tarjetaCarrito = document.getElementById("duenoVenderCarritoCard");
            if (tarjetaCarrito) {
                tarjetaCarrito.scrollIntoView({ behavior: "smooth", block: "center" });
                tarjetaCarrito.classList.remove("dvm-destello");
                void tarjetaCarrito.offsetWidth;
                tarjetaCarrito.classList.add("dvm-destello");
            }
        }
    });

    envolver("duenoVenderIntentarAgregarPorCodigo", ([codigo]) => {
        const estado = document.getElementById("duenoVenderEscaneoEstado");

        if (estado && /^Sin coincidencia/.test(estado.textContent || "")) {
            mostrarTarjeta({ titulo: "No lo encontré", detalle: `El código ${String(codigo).trim()} no está en tu inventario`, error: true });
            pitido(false);
            return;
        }

        pintarListaEscaner();
    });

    envolver("abrirEscanerVenderDueno", () => { desbloquearAudio(); pintarListaEscaner(); actualizarBarra(); });
    envolver("cerrarEscanerVenderDueno", () => actualizarBarra());

    vigilarPantallas();
    actualizarBarra();
})();

/* Foto ampliada: al tocar la foto de un producto en la busqueda de Vender o en la venta se abre grande, para ver si es el que buscas.
   El "+" y el resto de la fila siguen igual (solo la miniatura abre la foto). */
(function () {
    function cerrar() { document.getElementById("dvmFotoGrande")?.remove(); }

    function abrir(url, nombre) {
        cerrar();
        const capa = document.createElement("div");
        capa.id = "dvmFotoGrande";
        capa.className = "dvm-foto-grande";
        capa.innerHTML = `<figure><img alt=""><figcaption></figcaption><button type="button" aria-label="Cerrar">Cerrar</button></figure>`;
        capa.querySelector("img").src = url;
        capa.querySelector("figcaption").textContent = nombre || "";
        capa.addEventListener("click", cerrar);
        document.body.appendChild(capa);
    }

    document.addEventListener("click", evento => {
        const img = evento.target.closest && evento.target.closest("#duenoVenderResultados .dueno-miniatura img, #duenoVenderCarritoLista .dueno-miniatura img");
        if (!img || !img.src) return;

        evento.preventDefault();
        evento.stopPropagation();
        abrir(img.src, img.closest(".fila-dueno")?.querySelector("strong")?.textContent || "");
    }, true);
})();
