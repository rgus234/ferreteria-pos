/* Vender en el celular, pantalla de inicio rediseñada: encabezado limpio, buscador grande, tres accesos con nombre (Escanear, Foto,
   Articulo rapido) y "Lo que mas vendes" (productos con foto que se agregan con un toque). Todo se apoya en los ids y funciones de siempre;
   "mas vendes" cuenta, en este telefono, cuantas veces se cobro cada producto (si aun no hay historial muestra tus productos con foto). */

(function () {
    const LLAVE = "nexo-dueno-frecuentes-v1";
    const esc = valor => (typeof escaparDueno === "function" ? escaparDueno(valor) : String(valor ?? ""));
    const plata = valor => "$" + Number(valor || 0).toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

    function leer() { try { return JSON.parse(localStorage.getItem(LLAVE) || "{}") || {}; } catch (error) { return {}; } }
    function guardar(datos) { try { localStorage.setItem(LLAVE, JSON.stringify(datos)); } catch (error) { /* sin almacenamiento: no pasa nada */ } }

    // Se cuenta al COBRAR (no al agregar): un producto agregado por error y quitado no cuenta.
    function contarVenta() {
        if (typeof duenoVentaCarrito === "undefined") return;

        const datos = leer();
        duenoVentaCarrito.forEach(item => { if (Number(item.id) > 0) datos[item.id] = (datos[item.id] || 0) + 1; });
        guardar(datos);
    }

    const cobrada = window.mostrarVentaCobradaVenderDueno;

    if (typeof cobrada === "function") {
        window.mostrarVentaCobradaVenderDueno = function () {
            try { contarVenta(); } catch (error) { /* nunca estorba al cobro */ }
            return cobrada.apply(this, arguments);
        };
    }

    // ---- Estructura: etiquetas en los accesos y la seccion de frecuentes ----
    function armar() {
        const pantalla = document.getElementById("duenoVender");
        const fila = pantalla?.querySelector(".dueno-buscar-fila");
        const tarjeta = fila?.closest(".dueno-card");

        if (!pantalla || !fila || !tarjeta || pantalla.dataset.dvi) return;

        pantalla.dataset.dvi = "1";
        pantalla.classList.add("dvi-vender");
        tarjeta.classList.add("dvi-busqueda");

        const nombres = [["Escanear", "Escanear código de barras"], ["Foto", "Identificar por foto"], ["Rápido", "Artículo rápido (sin código)"]];
        [...fila.querySelectorAll("button.dueno-boton-agregar")].forEach((boton, i) => {
            const etiqueta = document.createElement("span");
            etiqueta.textContent = nombres[i]?.[0] || "";
            boton.appendChild(etiqueta);
            if (nombres[i]) boton.setAttribute("aria-label", nombres[i][1]);
        });

        const buscar = document.getElementById("duenoVenderBuscar");
        if (buscar) buscar.placeholder = "Buscar por nombre o código";

        const frecuentes = document.createElement("section");
        frecuentes.id = "dviFrecuentes";
        frecuentes.className = "dvi-frecuentes";
        tarjeta.insertAdjacentElement("afterend", frecuentes);

        buscar?.addEventListener("input", () => tarjeta.classList.toggle("dvi-con-texto", Boolean(buscar.value.trim())));
    }

    async function pintarFrecuentes() {
        const caja = document.getElementById("dviFrecuentes");
        if (!caja || typeof listarCatalogoLocalCompletoDueno !== "function") return;

        let catalogo = [];
        try { catalogo = await listarCatalogoLocalCompletoDueno(); } catch (error) { catalogo = []; }

        const conteos = leer();
        const porId = new Map(catalogo.map(p => [String(p.id), p]));
        const vendidos = Object.entries(conteos).sort((a, b) => b[1] - a[1]).map(([id]) => porId.get(String(id))).filter(Boolean);
        const hayHistorial = vendidos.length > 0;
        let lista = vendidos.slice(0, 9);

        // Sin historial (negocio nuevo): tus productos con foto, para que la pantalla no quede vacia.
        if (lista.length < 6) {
            const usados = new Set(lista.map(p => p.id));
            lista = lista.concat(catalogo.filter(p => p.imagenUrl && !usados.has(p.id)).slice(0, 9 - lista.length));
        }

        if (!lista.length) { caja.innerHTML = ""; return; }

        caja.innerHTML = `<h3>${hayHistorial ? "Lo que más vendes" : "Tus productos"}</h3>
            <div class="dvi-grid">${lista.map(p => `<button type="button" class="dvi-producto" onclick="agregarAlCarritoVenderDueno(${Number(p.id)})">
                <span class="dvi-foto">${p.imagenUrl ? `<img src="${esc(p.imagenUrl)}" alt="" loading="lazy">` : (typeof miniaturaVaciaDuenoHtml === "function" ? miniaturaVaciaDuenoHtml() : "")}</span>
                <b>${esc(p.nombre)}</b><small>${plata(p.precio)}</small></button>`).join("")}</div>`;
    }

    armar();
    pintarFrecuentes();

    // Se vuelve a pintar al entrar a Vender y despues de cada venta (cambian los mas vendidos).
    const cambiar = window.cambiarTabDueno;

    if (typeof cambiar === "function") {
        window.cambiarTabDueno = function (tab) {
            const resultado = cambiar.apply(this, arguments);
            if (tab === "vender") setTimeout(pintarFrecuentes, 120);
            return resultado;
        };
    }
})();
