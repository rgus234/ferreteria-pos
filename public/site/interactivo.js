/* Partes interactivas de la pagina publica: "Lo mejor de Nexo" (pestañas) y los filtros de funciones. */
(function () {
    var reducido = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    // ---------- Lo mejor de Nexo ----------
    var caja = document.querySelector("[data-destacados]");

    if (caja) {
        var tabs = Array.prototype.slice.call(caja.querySelectorAll("[data-tab]"));
        var paneles = Array.prototype.slice.call(caja.querySelectorAll("[data-panel]"));
        var actual = 0;
        var tocado = false;
        var visible = false;
        var reloj = null;

        function mostrar(indice, enfocar) {
            actual = (indice + tabs.length) % tabs.length;

            tabs.forEach(function (t, i) {
                var activa = i === actual;
                t.setAttribute("aria-selected", String(activa));
                t.setAttribute("tabindex", activa ? "0" : "-1");
                t.classList.toggle("activa", activa);
            });

            paneles.forEach(function (p, i) { p.hidden = i !== actual; });
            if (enfocar) tabs[actual].focus();
        }

        function parar() { if (reloj) { clearInterval(reloj); reloj = null; } }

        function arrancar() {
            if (reducido || tocado || reloj) return;
            reloj = setInterval(function () { if (visible && !tocado) mostrar(actual + 1); }, 7000);
        }

        tabs.forEach(function (t, i) {
            t.addEventListener("click", function () { tocado = true; parar(); mostrar(i); });
            t.addEventListener("keydown", function (e) {
                if (e.key === "ArrowRight" || e.key === "ArrowDown") { e.preventDefault(); tocado = true; parar(); mostrar(i + 1, true); }
                else if (e.key === "ArrowLeft" || e.key === "ArrowUp") { e.preventDefault(); tocado = true; parar(); mostrar(i - 1, true); }
            });
        });

        // si la persona toca o pasa el cursor sobre el panel, se deja de rotar solo
        caja.addEventListener("pointerdown", function () { tocado = true; parar(); });

        mostrar(0);

        if ("IntersectionObserver" in window) {
            new IntersectionObserver(function (entradas) { visible = entradas[0].isIntersecting; }, { threshold: 0.35 }).observe(caja);
        } else {
            visible = true;
        }

        arrancar();
    }

    // ---------- Filtros de funciones ----------
    var filtros = document.querySelector("[data-cap-filtros]");
    var grid = document.querySelector("[data-cap-grid]");

    if (filtros && grid) {
        filtros.addEventListener("click", function (e) {
            var boton = e.target.closest("[data-filtro]");
            if (!boton) return;

            var filtro = boton.getAttribute("data-filtro");

            filtros.querySelectorAll("[data-filtro]").forEach(function (b) {
                var activo = b === boton;
                b.classList.toggle("activo", activo);
                b.setAttribute("aria-pressed", String(activo));
            });

            grid.querySelectorAll("[data-cat]").forEach(function (tarjeta) {
                tarjeta.hidden = filtro !== "todo" && tarjeta.getAttribute("data-cat") !== filtro;
            });
        });
    }
})();
