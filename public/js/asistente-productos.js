// Catalogo visual para elegir productos: un campo de busqueda grande y, debajo, tarjetas con foto, nombre, marca, precio y existencia.
// Se usa en los asistentes de dos pasos (Nuevo encargo, Nueva lista) y al agregar productos a un encargo o una lista que ya existen.
//   lpvCatalogo(contenedor, { placeholder, manual, cantidadDe(producto), alElegir(producto | null, nombreManual) }) -> { refrescar() }
//   lpwModal(id, ancha) -> el modal (fondo + tarjeta) listo para llenar.
(function () {
    const MOSTRAR_VACIO = 24;
    const MOSTRAR_BUSQUEDA = 60;
    const plano = t => String(t || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
    const esc = valor => (typeof escaparPOS === "function" ? escaparPOS(valor) : String(valor ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])));
    const dinero = n => "$" + Number(n || 0).toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const inventario = () => (typeof todosProductos !== "undefined" && Array.isArray(todosProductos) ? todosProductos : []).filter(p => Number(p.id) > 0);
    const miniatura = p => (typeof miniaturaProducto === "function" ? miniaturaProducto(p, "lpc-img") : "");

    window.lpwModal = function (id, ancha) {
        let fondo = document.getElementById(id);

        if (!fondo) {
            fondo = document.createElement("div");
            fondo.id = id;
            fondo.className = "lpw-fondo";
            document.body.appendChild(fondo);
        }

        fondo.classList.toggle("lpw-ancha", Boolean(ancha));
        fondo.style.display = "flex";
        return fondo;
    };

    window.lpvCatalogo = function (contenedor, opciones = {}) {
        if (!contenedor) return { refrescar() {} };

        contenedor.innerHTML = `<div class="lpc">
            <div class="lpc-buscar"><span class="lpc-lupa" aria-hidden="true">⌕</span><input type="search" class="lpc-campo" autocomplete="off" placeholder="${esc(opciones.placeholder || "Busca por nombre, marca o código…")}"><span class="lpc-contador"></span></div>
            <div class="lpc-manual-zona"></div>
            <div class="lpc-grid" role="list"></div>
        </div>`;

        const campo = contenedor.querySelector(".lpc-campo");
        const grid = contenedor.querySelector(".lpc-grid");
        const manualZona = contenedor.querySelector(".lpc-manual-zona");
        const contador = contenedor.querySelector(".lpc-contador");
        let resultados = [];
        let temporizador = null;

        function buscar(texto) {
            const palabras = plano(texto).split(/\s+/).filter(Boolean);
            const lista = inventario();

            if (!palabras.length) return { lista: lista.slice().sort((a, b) => String(a.nombre).localeCompare(String(b.nombre), "es")).slice(0, MOSTRAR_VACIO), total: lista.length };

            const todos = lista.filter(p => { const base = plano(`${p.nombre} ${p.marca || ""} ${p.codigo || ""}`); return palabras.every(w => base.includes(w)); });
            return { lista: todos.slice(0, MOSTRAR_BUSQUEDA), total: todos.length };
        }

        function pintar() {
            const texto = campo.value;
            const { lista, total } = buscar(texto);
            resultados = lista;

            contador.textContent = texto.trim() ? `${total} resultado${total === 1 ? "" : "s"}` : `${total} producto${total === 1 ? "" : "s"} en tu inventario`;

            manualZona.innerHTML = opciones.manual && texto.trim()
                ? `<button type="button" class="lpc-manual">＋ Agregar “${esc(texto.trim())}” a mano <small>(no está en mi inventario)</small></button>`
                : "";

            if (!lista.length) {
                grid.innerHTML = `<p class="lpc-vacio">${texto.trim() ? `No encontré productos con “${esc(texto)}”.${opciones.manual ? " Puedes agregarlo a mano con el botón de arriba." : ""}` : "Todavía no hay productos en tu inventario."}</p>`;
                return;
            }

            grid.innerHTML = lista.map((p, i) => {
                const hay = Number(p.stock) || 0;
                const sub = [p.marca, p.categoria].filter(Boolean)[0] || "";
                const llevo = typeof opciones.cantidadDe === "function" ? Number(opciones.cantidadDe(p)) || 0 : 0;
                return `<button type="button" class="lpc-card${llevo ? " lpc-ya" : ""}" data-i="${i}" role="listitem">
                    ${llevo ? `<span class="lpc-badge">× ${llevo}</span>` : ""}
                    <span class="lpc-foto">${miniatura(p)}</span>
                    <b>${esc(p.nombre)}</b>
                    <small>${esc(sub) || "&nbsp;"}</small>
                    <span class="lpc-pie"><strong>${dinero(p.precio_publico ?? p.precio)}</strong><em class="${hay <= 0 ? "lpc-agotado" : ""}">${hay <= 0 ? "Agotado" : "Hay " + hay}</em></span>
                </button>`;
            }).join("");
        }

        campo.addEventListener("input", () => { clearTimeout(temporizador); temporizador = setTimeout(pintar, 110); });
        campo.addEventListener("keydown", e => {
            if (e.key !== "Enter") return;
            e.preventDefault();
            if (resultados.length === 1) elegir(0);
            else if (!resultados.length && opciones.manual && campo.value.trim()) manual();
        });

        function elegir(i) {
            const p = resultados[i];
            if (!p || typeof opciones.alElegir !== "function") return;
            opciones.alElegir(p, null);
            pintarSinPerderPosicion();
        }

        function manual() {
            const nombre = campo.value.trim();
            if (!nombre || typeof opciones.alElegir !== "function") return;
            opciones.alElegir(null, nombre);
            campo.value = "";
            pintar();
            campo.focus();
        }

        function pintarSinPerderPosicion() {
            const y = grid.scrollTop;
            const yPagina = contenedor.scrollTop;
            pintar();
            grid.scrollTop = y;
            contenedor.scrollTop = yPagina;
        }

        grid.addEventListener("click", e => { const t = e.target.closest(".lpc-card"); if (t) elegir(Number(t.dataset.i)); });
        manualZona.addEventListener("click", e => { if (e.target.closest(".lpc-manual")) manual(); });

        pintar();
        setTimeout(() => campo.focus(), 60);

        return { refrescar: pintarSinPerderPosicion, enfocar: () => campo.focus() };
    };
})();
