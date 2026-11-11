// Buscador de productos con foto: en lugar de la lista de texto del navegador, al escribir salen tarjetas con la foto, el nombre, la marca,
// cuanto hay y el precio. Se engancha a un campo de texto que ya existe (lpvAdjuntar) y deja en el campo el nombre exacto del producto elegido,
// asi lo que ya busca el producto por su nombre sigue funcionando igual.
(function () {
    const MAX_RESULTADOS = 30;
    const plano = t => String(t || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
    const esc = valor => (typeof escaparPOS === "function" ? escaparPOS(valor) : String(valor ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])));
    const dinero = n => "$" + Number(n || 0).toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const productos = () => (typeof todosProductos !== "undefined" && Array.isArray(todosProductos) ? todosProductos : []).filter(p => Number(p.id) > 0);
    const miniatura = (p, clase) => (typeof miniaturaProducto === "function" ? miniaturaProducto(p, clase) : "");

    function buscar(texto) {
        const palabras = plano(texto).split(/\s+/).filter(Boolean);
        const lista = productos();

        if (!palabras.length) return lista.slice(0, 8);

        return lista.filter(p => {
            const base = plano(`${p.nombre} ${p.marca || ""} ${p.codigo || ""}`);
            return palabras.every(w => base.includes(w));
        }).slice(0, MAX_RESULTADOS);
    }

    // Marca la parte que coincide con lo escrito (primera palabra).
    function resaltar(nombre, texto) {
        const primera = plano(texto).split(/\s+/).filter(Boolean)[0];
        if (!primera) return esc(nombre);
        const i = plano(nombre).indexOf(primera);
        if (i < 0) return esc(nombre);
        return `${esc(nombre.slice(0, i))}<mark>${esc(nombre.slice(i, i + primera.length))}</mark>${esc(nombre.slice(i + primera.length))}`;
    }

    window.lpvLimpiar = function (input) {
        if (!input) return;
        input.value = "";
        delete input.dataset.productoId;
        const envoltura = input.closest(".lpv");
        const mini = envoltura && envoltura.querySelector(".lpv-elegido");
        if (mini) { mini.innerHTML = ""; mini.hidden = true; }
        envoltura && envoltura.classList.remove("lpv-con-elegido");
    };

    window.lpvAdjuntar = function (inputId, opciones = {}) {
        const input = document.getElementById(inputId);
        if (!input || input.dataset.lpv === "1") return;

        input.dataset.lpv = "1";
        input.removeAttribute("list");
        input.setAttribute("autocomplete", "off");
        input.setAttribute("placeholder", opciones.placeholder || "Busca por nombre, marca o código…");

        const envoltura = document.createElement("div");
        envoltura.className = "lpv";
        input.parentNode.insertBefore(envoltura, input);
        envoltura.innerHTML = `<span class="lpv-elegido" hidden></span><span class="lpv-lupa" aria-hidden="true">⌕</span>`;
        envoltura.appendChild(input);

        const panel = document.createElement("div");
        panel.className = "lpv-panel";
        panel.hidden = true;
        envoltura.appendChild(panel);

        let resultados = [];
        let activo = -1;

        const cerrar = () => { panel.hidden = true; activo = -1; };

        function pintar() {
            resultados = buscar(input.value);

            if (!resultados.length) {
                panel.innerHTML = `<p class="lpv-vacio">No encontré productos con “${esc(input.value)}”.</p>`;
                panel.hidden = false;
                return;
            }

            panel.innerHTML = `${input.value.trim() ? "" : `<p class="lpv-titulo">Productos de tu inventario</p>`}` + resultados.map((p, i) => {
                const hay = Number(p.stock) || 0;
                const sub = [p.marca, p.categoria].filter(Boolean)[0] || "";
                return `<div class="lpv-fila${i === activo ? " lpv-activo" : ""}" data-i="${i}" role="option">
                    <span class="lpv-foto">${miniatura(p, "lpv-img")}</span>
                    <span class="lpv-texto"><b>${resaltar(String(p.nombre || ""), input.value)}</b><small>${esc(sub)}${sub ? " · " : ""}<span class="${hay <= 0 ? "lpv-agotado" : ""}">${hay <= 0 ? "Agotado" : "Hay " + hay}</span></small></span>
                    <span class="lpv-precio">${dinero(p.precio_publico ?? p.precio)}</span>
                </div>`;
            }).join("");
            panel.hidden = false;
            const act = panel.querySelector(".lpv-activo");
            if (act) act.scrollIntoView({ block: "nearest" });
        }

        function elegir(i) {
            const p = resultados[i];
            if (!p) return;

            input.value = p.nombre;
            input.dataset.productoId = p.id;
            const mini = envoltura.querySelector(".lpv-elegido");
            mini.innerHTML = miniatura(p, "lpv-img");
            mini.hidden = false;
            envoltura.classList.add("lpv-con-elegido");
            cerrar();
            input.dispatchEvent(new Event("change", { bubbles: true }));
            if (typeof opciones.alElegir === "function") opciones.alElegir(p);

            const siguiente = opciones.siguiente && document.getElementById(opciones.siguiente);
            if (siguiente) siguiente.focus();
        }

        input.addEventListener("input", () => {
            delete input.dataset.productoId;
            const mini = envoltura.querySelector(".lpv-elegido");
            mini.hidden = true;
            envoltura.classList.remove("lpv-con-elegido");
            activo = -1;
            pintar();
        });
        input.addEventListener("focus", pintar);
        input.addEventListener("keydown", e => {
            if (panel.hidden && (e.key === "ArrowDown" || e.key === "ArrowUp")) { pintar(); }
            if (e.key === "ArrowDown") { e.preventDefault(); activo = Math.min(resultados.length - 1, activo + 1); pintar(); }
            else if (e.key === "ArrowUp") { e.preventDefault(); activo = Math.max(0, activo - 1); pintar(); }
            else if (e.key === "Enter" && !panel.hidden && resultados.length) { e.preventDefault(); elegir(activo >= 0 ? activo : 0); }
            else if (e.key === "Escape") { cerrar(); }
        });
        panel.addEventListener("mousedown", e => {
            const fila = e.target.closest(".lpv-fila");
            if (!fila) return;
            e.preventDefault();
            elegir(Number(fila.dataset.i));
        });
        document.addEventListener("click", e => { if (!envoltura.contains(e.target)) cerrar(); });
    };
})();
