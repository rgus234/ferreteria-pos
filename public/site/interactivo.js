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

    // ---------- Pantallas de la computadora ----------
    var pantallas = document.querySelector("[data-pantallas]");

    if (pantallas) {
        var botones = Array.prototype.slice.call(pantallas.querySelectorAll("[data-pantalla]"));
        var imagen = document.getElementById("pcImagen");
        var titulo = document.getElementById("pcTitulo");
        var texto = document.getElementById("pcTexto");
        var actualPc = 0;
        var relojPc = null;
        var tocadoPc = false;
        var visiblePc = false;

        // las imagenes pesan poco, pero se precargan para que el cambio sea inmediato
        botones.forEach(function (b) { var pre = new Image(); pre.src = b.getAttribute("data-src"); });

        function verPantalla(i) {
            actualPc = (i + botones.length) % botones.length;

            botones.forEach(function (b, n) {
                var activo = n === actualPc;
                b.classList.toggle("activa", activo);
                b.setAttribute("aria-selected", String(activo));
                b.setAttribute("tabindex", activo ? "0" : "-1");
            });

            var b = botones[actualPc];
            imagen.classList.add("cambiando");

            setTimeout(function () {
                imagen.src = b.getAttribute("data-src");
                imagen.alt = b.getAttribute("data-alt");
                titulo.textContent = b.getAttribute("data-titulo");
                texto.textContent = b.getAttribute("data-texto");
                imagen.classList.remove("cambiando");
            }, 140);
        }

        function pararPc() { if (relojPc) { clearInterval(relojPc); relojPc = null; } }

        botones.forEach(function (b, i) {
            b.addEventListener("click", function () { tocadoPc = true; pararPc(); verPantalla(i); });
            b.addEventListener("keydown", function (e) {
                if (e.key === "ArrowRight" || e.key === "ArrowDown") { e.preventDefault(); tocadoPc = true; pararPc(); verPantalla(i + 1); botones[actualPc].focus(); }
                else if (e.key === "ArrowLeft" || e.key === "ArrowUp") { e.preventDefault(); tocadoPc = true; pararPc(); verPantalla(i - 1); botones[actualPc].focus(); }
            });
        });

        verPantalla(0);

        if ("IntersectionObserver" in window) {
            new IntersectionObserver(function (entradas) { visiblePc = entradas[0].isIntersecting; }, { threshold: 0.4 }).observe(pantallas);
        } else {
            visiblePc = true;
        }

        if (!reducido) {
            relojPc = setInterval(function () { if (visiblePc && !tocadoPc) verPantalla(actualPc + 1); }, 6000);
        }

        pantallas.addEventListener("pointerdown", function () { tocadoPc = true; pararPc(); });
    }
})();
