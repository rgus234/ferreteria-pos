/* "Equipamiento para tu negocio": tarjetas, filtros y ficha de cada equipo.
   Todos los datos viven en /site/equipamiento.json (precios, especificaciones, fotos): se actualiza ahi, no aqui.
   Compatibilidad con Nexo: nunca se afirma sin verificar; se muestra "por confirmar". */

(function () {
    var raiz = document.getElementById("equipamiento");
    if (!raiz) return;

    var estado = { datos: null, categoria: "todos", conexion: "todas", texto: "", verTodasBasculas: false };
    var WHATSAPP = "https://wa.me/524424950495?text=";

    function esc(valor) {
        return String(valor == null ? "" : valor).replace(/[&<>"']/g, function (c) {
            return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
        });
    }

    function dinero(n) {
        return "$" + Number(n).toLocaleString("es-MX", { maximumFractionDigits: 0 });
    }

    // WhatsApp con el equipo ya cargado: modelo, clave, codigo y el precio de mayoreo que vio en la pagina.
    function enlaceWhatsapp(p) {
        var texto = "Hola, quiero información de este equipo: " + p.marca + " " + p.clave + " (" + p.nombre + "), código " + p.codigo +
            ". Vi un precio de referencia de " + dinero(p.precios.medioMayoreo) + ". ¿Me ayudas con precio, disponibilidad y envío?";
        return WHATSAPP + encodeURIComponent(texto);
    }

    function icono(nombre) {
        return '<svg class="ic" aria-hidden="true" focusable="false"><use href="/site/iconos.svg#i-' + nombre + '"/></svg>';
    }

    function norm(t) {
        return String(t || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
    }

    function foto(p, clase) {
        if (estado.datos.fotosAutorizadas && p.foto) {
            return '<img class="' + clase + '" src="' + esc(p.foto) + '" alt="' + esc(p.marca + " " + p.clave) + '" loading="lazy" width="320" height="320">';
        }

        return '<span class="' + clase + ' equipo-sin-foto" aria-hidden="true">' + icono(p.categoria === "impresoras" ? "impresora" : p.categoria === "basculas" ? "bascula" : "lector") + "</span>";
    }

    // Las basculas son 18 modelos: se muestran las que cubren casi todos los negocios y el resto queda a un toque.
    function ocultaPorEsencial(p) {
        return p.categoria === "basculas" && !p.esencial && !estado.verTodasBasculas;
    }

    function basculasOcultas() {
        if (estado.categoria !== "todos" && estado.categoria !== "basculas") return 0;
        return estado.datos.productos.filter(function (p) { return p.categoria === "basculas" && !p.esencial; }).length;
    }

    function visibles() {
        var buscado = norm(estado.texto).trim();

        return estado.datos.productos.filter(function (p) {
            if (estado.categoria !== "todos" && p.categoria !== estado.categoria) return false;
            if (ocultaPorEsencial(p) && !buscado) return false;
            if (estado.conexion !== "todas" && p.conexiones.indexOf(estado.conexion) === -1) return false;
            if (!buscado) return true;

            return norm([p.nombre, p.clave, p.codigo, p.marca, p.conexiones.join(" ")].join(" ")).indexOf(buscado) !== -1;
        });
    }

    function tarjeta(p) {
        return '<article class="equipo-tarjeta">' +
            foto(p, "equipo-foto") +
            '<div class="equipo-cuerpo">' +
            (p.esencial ? '<span class="equipo-esencial">' + icono("estrella") + " Esencial</span>" : "") +
            '<p class="equipo-marca">' + esc(p.marca) + " · " + esc(p.clave) + "</p>" +
            "<h3>" + esc(p.nombre) + "</h3>" +
            (p.uso ? '<p class="equipo-uso">' + esc(p.uso) + "</p>" : "") +
            '<ul class="equipo-resumen">' + p.resumen.map(function (r) { return "<li>" + esc(r) + "</li>"; }).join("") + "</ul>" +
            '<p class="equipo-precio"><span>Precio</span><strong>' + dinero(p.precios.medioMayoreo) + '</strong><small>Referencia · confirma vigencia</small></p>' +
            '<div class="equipo-acciones">' +
            '<button type="button" class="btn secondary" data-ficha="' + esc(p.id) + '">Ver ficha</button>' +
            '<a class="btn primary" target="_blank" rel="noopener" href="' + enlaceWhatsapp(p) + '">WhatsApp</a>' +
            "</div></div></article>";
    }

    function pintarLista() {
        var lista = visibles();
        var caja = document.getElementById("equipoLista");

        document.getElementById("equipoConteo").textContent = lista.length + " equipo" + (lista.length === 1 ? "" : "s");
        caja.innerHTML = lista.length ? lista.map(tarjeta).join("") : '<p class="equipo-vacio">Ningún equipo coincide. Prueba con otra búsqueda o escríbenos y te ayudamos a elegir.</p>';

        var mas = document.getElementById("equipoMas");
        var ocultas = basculasOcultas();

        if (mas) {
            mas.hidden = !ocultas || Boolean(norm(estado.texto).trim());
            mas.textContent = estado.verTodasBasculas
                ? "Mostrar solo las básculas esenciales"
                : "Ver las " + ocultas + " básculas restantes (más capacidades y modelos)";
        }
    }

    function pintarBase() {
        var d = estado.datos;
        var conexiones = [];

        d.productos.forEach(function (p) {
            p.conexiones.forEach(function (c) { if (conexiones.indexOf(c) === -1) conexiones.push(c); });
        });

        raiz.querySelector("[data-equipo-filtros]").innerHTML =
            '<div class="equipo-chips" role="group" aria-label="Categoría">' +
            '<button type="button" class="activo" data-categoria="todos">Todos</button>' +
            d.categorias.map(function (c) { return '<button type="button" data-categoria="' + esc(c.id) + '">' + esc(c.nombre) + "</button>"; }).join("") +
            "</div>" +
            '<div class="equipo-controles">' +
            '<input id="equipoBuscar" type="search" placeholder="Buscar modelo, clave o conexión" aria-label="Buscar equipo">' +
            '<select id="equipoConexion" aria-label="Tipo de conexión"><option value="todas">Cualquier conexión</option>' +
            conexiones.map(function (c) { return '<option value="' + esc(c) + '">' + esc(c) + "</option>"; }).join("") + "</select>" +
            '<span id="equipoConteo" class="equipo-conteo"></span></div>';

        raiz.querySelector("[data-equipo-aviso]").textContent = d.avisoPrecios;

        var c = d.compra;
        var cuadro = raiz.querySelector("[data-equipo-compra]");

        if (c && cuadro) {
            var lista = function (items) { return "<ul>" + items.map(function (i) { return "<li>" + esc(i) + "</li>"; }).join("") + "</ul>"; };

            cuadro.innerHTML = "<h3>" + esc(c.titulo) + "</h3>" +
                '<ol class="equipo-pasos">' + c.pasos.map(function (p) { return "<li>" + esc(p) + "</li>"; }).join("") + "</ol>" +
                '<div class="equipo-compra-cols"><div><h4>Entrega</h4>' + lista(c.entrega) + "</div><div><h4>Pago</h4>" + lista(c.pago) + "</div></div>";
        }
        pintarLista();
    }

    // ---------- Ficha ----------

    function cerrarFicha() {
        var capa = document.getElementById("equipoFicha");
        if (capa) capa.remove();
        document.documentElement.classList.remove("equipo-abierta");
    }

    function abrirFicha(id) {
        var p = estado.datos.productos.filter(function (x) { return x.id === id; })[0];
        if (!p) return;

        cerrarFicha();

        var capa = document.createElement("div");
        capa.id = "equipoFicha";
        capa.className = "equipo-ficha";
        capa.setAttribute("role", "dialog");
        capa.setAttribute("aria-modal", "true");
        capa.setAttribute("aria-label", "Ficha de " + p.clave);

        capa.innerHTML =
            '<div class="equipo-ficha-caja">' +
            '<button type="button" class="equipo-cerrar" data-cerrar aria-label="Cerrar">&times;</button>' +
            '<div class="equipo-ficha-cabecera">' + foto(p, "equipo-ficha-foto") +
            "<div><p class=\"equipo-marca\">" + esc(p.marca) + " (" + esc(p.fabricante) + ") · Clave " + esc(p.clave) + " · Código " + esc(p.codigo) + "</p>" +
            "<h3>" + esc(p.nombre) + "</h3>" +
            (p.garantia ? '<p class="equipo-garantia">Garantía: ' + esc(p.garantia) + "</p>" : '<p class="equipo-garantia">Garantía: por confirmar</p>') + "</div></div>" +

            '<div class="equipo-precios"><h4>Precio</h4><div class="equipo-precios-fila">' +
            '<div class="destacado"><span>Medio mayoreo</span><strong>' + dinero(p.precios.medioMayoreo) + "</strong></div></div>" +
            '<p class="equipo-nota">' + esc(estado.datos.avisoPrecios) + "</p></div>" +

            "<h4>Características</h4>" +
            '<table class="equipo-tabla"><tbody>' + p.especificaciones.map(function (e) { return "<tr><th>" + esc(e[0]) + "</th><td>" + esc(e[1]) + "</td></tr>"; }).join("") + "</tbody></table>" +

            (p.incluye.length ? "<h4>Incluye</h4><ul class=\"equipo-incluye\">" + p.incluye.map(function (i) { return "<li>" + esc(i) + "</li>"; }).join("") + "</ul>" : "") +

            "<h4>Compatibilidad</h4>" +
            (p.compatibilidad.sistemas.length ? '<p>Sistemas que indica el fabricante: <strong>' + esc(p.compatibilidad.sistemas.join(", ")) + "</strong>.</p>" : "<p>Sistemas compatibles: por confirmar con el fabricante.</p>") +
            '<p class="equipo-pendiente"><b>Con Nexo POS: por confirmar.</b> Todavía no hemos probado este modelo dentro de Nexo; te lo confirmamos antes de que compres.</p>' +

            '<div class="equipo-acciones equipo-ficha-acciones">' +
            '<a class="btn primary" target="_blank" rel="noopener" href="' + enlaceWhatsapp(p) + '">Preguntar por WhatsApp</a>' +
            "</div>" +

            '<form class="equipo-form" id="equipoForm" data-equipo="' + esc(p.id) + '">' +
            "<h4>O déjanos tus datos y te respondemos</h4>" +
            '<label>Tu nombre<input name="nombre" type="text" maxlength="140" required autocomplete="name"></label>' +
            '<label>Teléfono o WhatsApp<input name="telefono" type="tel" maxlength="40" autocomplete="tel" inputmode="tel"></label>' +
            '<label>Correo (opcional)<input name="correo" type="email" maxlength="140" autocomplete="email"></label>' +
            '<div class="equipo-form-fila"><label>Cantidad<input name="cantidad" type="number" min="1" max="999" value="1" inputmode="numeric"></label>' +
            '<label>Ciudad<input name="ciudad" type="text" maxlength="80" autocomplete="address-level2"></label></div>' +
            '<label>Comentario (opcional)<input name="mensaje" type="text" maxlength="300" placeholder="Ej. la necesito para una tienda de abarrotes"></label>' +
            '<input class="equipo-trampa" name="empresaWeb" type="text" tabindex="-1" autocomplete="off" aria-hidden="true">' +
            '<button class="btn primary" type="submit">Solicitar información</button>' +
            '<div class="equipo-resultado" aria-live="polite"></div></form>' +
            '<p class="equipo-fuente">' + esc(estado.datos.fuentes) + "</p>" +
            "</div>";

        capa.addEventListener("click", function (evento) {
            if (evento.target === capa || evento.target.closest("[data-cerrar]")) cerrarFicha();
        });

        document.documentElement.classList.add("equipo-abierta");
        document.body.appendChild(capa);
        capa.querySelector(".equipo-cerrar").focus();
    }

    // Solicitud propia del equipo (no es el formulario de pruebas de Nexo): se guarda y le llega un aviso al propietario.
    function enviarSolicitud(formulario) {
        var resultado = formulario.querySelector(".equipo-resultado");
        var boton = formulario.querySelector("button[type=submit]");
        var cuerpo = { equipoId: formulario.getAttribute("data-equipo") };

        new FormData(formulario).forEach(function (valor, clave) { cuerpo[clave] = valor; });

        if (!String(cuerpo.telefono || "").trim() && !String(cuerpo.correo || "").trim()) {
            resultado.className = "equipo-resultado error";
            resultado.textContent = "Déjanos un teléfono o un correo para responderte.";
            return;
        }

        boton.disabled = true;
        resultado.className = "equipo-resultado";
        resultado.textContent = "Enviando...";

        fetch("/api/solicitud-equipo", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(cuerpo) })
            .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, datos: d }; }); })
            .then(function (r) {
                if (!r.ok) throw new Error(r.datos.error || "No se pudo enviar. Intenta de nuevo o escríbenos por WhatsApp.");
                resultado.className = "equipo-resultado ok";
                resultado.textContent = "Listo, recibimos tu solicitud. Te respondemos pronto.";
                formulario.reset();
            })
            .catch(function (error) {
                resultado.className = "equipo-resultado error";
                resultado.textContent = error.message;
            })
            .then(function () { boton.disabled = false; });
    }

    // ---------- Eventos ----------

    raiz.addEventListener("click", function (evento) {
        var chip = evento.target.closest("[data-categoria]");
        var ficha = evento.target.closest("[data-ficha]");

        if (chip) {
            estado.categoria = chip.getAttribute("data-categoria");
            raiz.querySelectorAll("[data-categoria]").forEach(function (b) { b.classList.toggle("activo", b === chip); });
            pintarLista();
        } else if (ficha) {
            abrirFicha(ficha.getAttribute("data-ficha"));
        } else if (evento.target.closest("#equipoMas")) {
            estado.verTodasBasculas = !estado.verTodasBasculas;
            pintarLista();
        }
    });

    raiz.addEventListener("input", function (evento) {
        if (evento.target.id === "equipoBuscar") { estado.texto = evento.target.value; pintarLista(); }
    });

    raiz.addEventListener("change", function (evento) {
        if (evento.target.id === "equipoConexion") { estado.conexion = evento.target.value; pintarLista(); }
    });

    document.addEventListener("submit", function (evento) {
        if (evento.target.id !== "equipoForm") return;
        evento.preventDefault();
        enviarSolicitud(evento.target);
    });

    document.addEventListener("keydown", function (evento) {
        if (evento.key === "Escape") cerrarFicha();
    });

    fetch("/site/equipamiento.json", { cache: "no-cache" })
        .then(function (r) { if (!r.ok) throw new Error("sin catalogo"); return r.json(); })
        .then(function (datos) { estado.datos = datos; pintarBase(); })
        .catch(function () {
            raiz.querySelector("[data-equipo-filtros]").innerHTML = "";
            document.getElementById("equipoLista").innerHTML = '<p class="equipo-vacio">No pudimos cargar el catálogo en este momento. Escríbenos por WhatsApp y te ayudamos a elegir.</p>';
        });
})();
