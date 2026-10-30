/* "¿Qué negocio tienes?": lo que el visitante elige define todo lo que ve, hasta la descarga.

   - En el sitio (body[data-giro-elegir]) pregunta al entrar: Ferreteria, Abarrotes o Ambos.
   - La eleccion se recuerda en este navegador y tambien viaja por enlace: nexoposoficial.com/?giro=abarrotes.
   - En la invitacion, el giro de la invitacion manda (body[data-giro-forzado]).
   - Adapta: textos marcados con data-giro-campo, bloques con data-solo="ferreteria ambos", la seccion
     "Hecho para tu negocio", los primeros pasos de la descarga y el giro del formulario.
   Contenido en giro-contenido.js (window.NEXO_GIRO). Sin JavaScript la pagina queda como la general de siempre. */

(function () {
    var LLAVE = "nexoSitioGiro";
    var datos = window.NEXO_GIRO;
    if (!datos) return;

    function leer() {
        try { return localStorage.getItem(LLAVE); } catch (error) { return null; }
    }

    function guardar(valor) {
        try { localStorage.setItem(LLAVE, valor); } catch (error) { /* sin almacenamiento */ }
    }

    function valido(valor) {
        return valor === "todos" || datos.CLAVES.indexOf(valor) !== -1;
    }

    var cuerpo = document.body;
    var forzado = datos.normalizar(cuerpo.getAttribute("data-giro-forzado"));
    var porEnlace = null;

    try { porEnlace = datos.normalizar(new URLSearchParams(location.search).get("giro")); } catch (error) { /* navegador viejo */ }

    var actual = forzado || porEnlace || (valido(leer()) ? leer() : null);
    if (forzado || porEnlace) guardar(actual);

    function contenidoActual() {
        return datos.CONTENIDO[actual] || null;
    }

    // ---------------- Aplicar la eleccion a la pagina ----------------

    function aplicar() {
        var c = contenidoActual();
        document.documentElement.setAttribute("data-giro", actual || "sin-elegir");

        // Textos: se guarda el original para poder volver al general.
        document.querySelectorAll("[data-giro-campo]").forEach(function (nodo) {
            if (nodo.dataset.giroOriginal === undefined) nodo.dataset.giroOriginal = nodo.textContent;
            var campo = nodo.getAttribute("data-giro-campo");
            nodo.textContent = c && c[campo] ? c[campo] : nodo.dataset.giroOriginal;
        });

        // Bloques que solo van para algunos giros ("todos" y sin elegir ven la version general).
        document.querySelectorAll("[data-solo]").forEach(function (nodo) {
            var lista = nodo.getAttribute("data-solo").split(/\s+/);
            var ver = c ? lista.indexOf(actual) !== -1 : lista.indexOf("general") !== -1;
            nodo.hidden = !ver;
        });

        pintarSeccion(c);
        pintarPasos(c);
        pintarFormulario();
        pintarChip(c);
    }

    function iconoSvg(nombre) {
        return '<svg class="ic" aria-hidden="true" focusable="false"><use href="/site/iconos.svg#i-' + escapar(nombre) + '"/></svg>';
    }

    function escapar(texto) {
        return String(texto == null ? "" : texto).replace(/[&<>"']/g, function (ch) {
            return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch];
        });
    }

    function pintarSeccion(c) {
        var caja = document.getElementById("giroSeccion");
        if (!caja) return;

        if (!c) {
            caja.hidden = true;
            caja.innerHTML = "";
            return;
        }

        caja.hidden = false;
        caja.innerHTML =
            '<div class="giro-seccion-interior">' +
            '<p class="eyebrow">' + iconoSvg(c.icono) + " " + escapar(c.eyebrow) + "</p>" +
            "<h2>" + escapar(c.seccionTitulo) + "</h2>" +
            "<p>" + escapar(c.seccionTexto) + "</p>" +
            '<div class="giro-funciones">' +
            c.funciones.map(function (f) {
                return '<article class="giro-funcion"><span class="giro-estado giro-estado-' + (f.estado === "Nuevo" ? "nuevo" : "ok") + '">' + (f.estado === "Nuevo" ? "Nuevo · en pruebas" : "Disponible") + "</span>" +
                    "<h3>" + escapar(f.titulo) + "</h3><p>" + escapar(f.texto) + "</p></article>";
            }).join("") +
            "</div>" +
            '<p class="giro-sigue">' + escapar(c.sigue) + "</p>" +
            '<a class="btn primary" href="#participa">Quiero probarlo en mi negocio</a>' +
            "</div>";
    }

    function pintarPasos(c) {
        document.querySelectorAll("[data-giro-pasos]").forEach(function (lista) {
            if (lista.dataset.giroOriginalHtml === undefined) lista.dataset.giroOriginalHtml = lista.innerHTML;
            lista.innerHTML = c ? c.primerosPasos.map(function (p) { return "<li>" + escapar(p) + "</li>"; }).join("") : lista.dataset.giroOriginalHtml;
        });
    }

    function pintarFormulario() {
        var select = document.getElementById("contactoGiro");
        if (!select || !actual || actual === "todos") return;

        var buscado = { ferreteria: "Ferretería", abarrotes: "Abarrotes", ambos: "Ferretería y abarrotes (ambos)" }[actual];
        for (var i = 0; i < select.options.length; i++) {
            if (select.options[i].value === buscado) { select.selectedIndex = i; break; }
        }

        var negocio = document.getElementById("contactoNegocio");
        var c = contenidoActual();
        if (negocio && c) negocio.placeholder = c.ejemploNegocio;
    }

    // ---------------- "Tu negocio: X · Cambiar" en el encabezado ----------------

    function pintarChip(c) {
        var viejo = document.getElementById("giroChip");
        if (viejo) viejo.remove();
        if (!cuerpo.hasAttribute("data-giro-elegir") || forzado) return;

        var destino = document.querySelector(".header-actions") || document.querySelector(".site-header");
        if (!destino) return;

        var chip = document.createElement("button");
        chip.type = "button";
        chip.id = "giroChip";
        chip.className = "giro-chip";
        chip.innerHTML = c ? "<span>" + iconoSvg(c.icono) + " Tu negocio: <b>" + escapar(c.nombre) + "</b></span><u>Cambiar</u>" : "<span>¿Qué negocio tienes?</span>";
        chip.addEventListener("click", abrirElegir);
        destino.prepend(chip);
    }

    // ---------------- Pregunta de bienvenida ----------------

    function cerrarElegir() {
        var capa = document.getElementById("giroElegir");
        if (capa) capa.remove();
        document.documentElement.classList.remove("giro-eligiendo");
    }

    function elegir(clave) {
        actual = clave;
        guardar(clave);
        cerrarElegir();
        aplicar();

        var inicio = document.getElementById("inicio");
        if (inicio && inicio.scrollIntoView) inicio.scrollIntoView({ behavior: "smooth", block: "start" });
    }

    function abrirElegir() {
        if (document.getElementById("giroElegir")) return;

        var capa = document.createElement("div");
        capa.id = "giroElegir";
        capa.className = "giro-elegir";
        capa.setAttribute("role", "dialog");
        capa.setAttribute("aria-modal", "true");
        capa.setAttribute("aria-labelledby", "giroElegirTitulo");

        capa.innerHTML =
            '<div class="giro-elegir-caja">' +
            '<img class="giro-elegir-mascota" src="/img/nexo-ia/feliz.jpg" alt="" aria-hidden="true">' +
            '<p class="eyebrow">Bienvenido a Nexo</p>' +
            '<h2 id="giroElegirTitulo">¿Qué negocio tienes?</h2>' +
            "<p>Con tu respuesta te mostramos lo que sí te sirve, y tu cuenta nace lista para tu tipo de negocio.</p>" +
            '<div class="giro-opciones">' +
            datos.CLAVES.map(function (clave) {
                var c = datos.CONTENIDO[clave];
                return '<button type="button" class="giro-opcion" data-giro="' + clave + '"><span class="giro-opcion-icono" aria-hidden="true">' + iconoSvg(c.icono) + "</span><strong>" + escapar(c.nombre) + "</strong><small>" + escapar(c.detalle) + "</small></button>";
            }).join("") +
            "</div>" +
            '<button type="button" class="giro-saltar" data-giro="todos">Solo quiero mirar</button>' +
            "</div>";

        capa.addEventListener("click", function (evento) {
            var boton = evento.target.closest("[data-giro]");
            if (boton) elegir(boton.getAttribute("data-giro"));
        });

        document.documentElement.classList.add("giro-eligiendo");
        document.body.appendChild(capa);

        var primero = capa.querySelector(".giro-opcion");
        if (primero) primero.focus();
    }

    // ---------------- Arranque ----------------

    aplicar();
    if (cuerpo.hasAttribute("data-giro-elegir") && !actual) abrirElegir();

    window.nexoGiro = { actual: function () { return actual; }, elegir: elegir, abrir: abrirElegir };
})();
