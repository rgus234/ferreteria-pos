/* Catalogo de productos en PDF: se eligen categorias de Nexo (departamento > subcategoria) y se descarga un catalogo con foto, nombre, descripcion,
   clave, precio y codigo de barras de cada producto, para mandarlo o imprimirlo. Solo lee: no cambia ningun producto.
   Servidor: catalogo-productos-server.js. Es una funcion nueva (funcionBeta("catalogo_productos")). */
(function () {
    const esc = valor => String(valor ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
    const plano = texto => String(texto || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
    const aviso = (mensaje, tipo) => { if (typeof mostrarToastPOS === "function") mostrarToastPOS(mensaje, tipo ? { tipo } : undefined); };
    const nProd = n => `${n} producto${n === 1 ? "" : "s"}`;

    let est = null;
    let temporizador = null;

    async function llamar(ruta, opciones = {}) {
        const r = await fetch(ruta, { ...opciones, headers: { "Content-Type": "application/json", ...(opciones.headers || {}) } });
        const datos = await r.json().catch(() => ({}));
        return { ok: r.ok && datos.ok !== false, datos };
    }

    const todasLasSubs = () => est.opciones.departamentos.flatMap(d => d.subcategorias);
    const cuerpo = () => ({
        subcategoriaIds: [...est.sel],
        incluirSinCategoria: est.sinCat,
        marcas: est.o.marca ? [est.o.marca] : [],
        soloConFoto: est.o.soloFoto,
        soloConExistencia: est.o.soloExistencia,
        nivelPrecio: est.o.nivel,
        mostrarPrecio: est.o.precio,
        mostrarCodigoBarras: est.o.barras,
        titulo: est.o.titulo
    });

    window.mostrarCatalogoProductos = async function () {
        if (typeof ocultarPantallasPrincipales === "function") ocultarPantallasPrincipales();
        const pantalla = document.getElementById("pantallaCatalogoProductos");
        if (!pantalla) return;
        pantalla.style.display = "block";
        if (typeof actualizarTopbarContexto === "function") actualizarTopbarContexto("Catálogo de productos", "Un PDF con foto, precio y código de barras", "catalogo-productos");
        pantalla.innerHTML = `<div class="ct-shell"><p class="ct-vacio">Preparando tus categorías…</p></div>`;

        const r = await llamar("/catalogo-productos/opciones");
        if (!r.ok) { pantalla.innerHTML = `<div class="ct-shell"><p class="ct-vacio">No se pudieron cargar las categorías. Intenta de nuevo.</p></div>`; return; }

        est = { opciones: r.datos, sel: new Set(), sinCat: false, abiertos: new Set(), filtro: "", conteo: { total: 0, conFoto: 0 }, generando: false,
            o: { titulo: "Catálogo de productos", nivel: "publico", precio: true, barras: true, soloFoto: false, soloExistencia: false, marca: "" } };
        pintar();
    };

    // ---------- pintado ----------

    function pintar() {
        const pantalla = document.getElementById("pantallaCatalogoProductos");
        if (!pantalla || !est) return;

        pantalla.innerHTML = `<div class="ct-shell">
            <header class="ct-cab"><h2>Catálogo de productos</h2><p>Elige las categorías y descarga un PDF con la foto, el precio y el código de barras de cada producto. Sirve para mandarlo a tus clientes o imprimirlo.</p></header>
            <div class="ct-dos">
                <section class="ct-arbol" aria-label="Categorías">
                    <div class="ct-barra"><input id="ctBuscar" type="search" placeholder="Buscar categoría…" value="${esc(est.filtro)}" oninput="ctFiltrar(this.value)" autocomplete="off">
                        <button type="button" class="ct-chico" onclick="ctTodo(true)">Todas</button><button type="button" class="ct-chico" onclick="ctTodo(false)">Ninguna</button></div>
                    <div id="ctLista">${htmlArbol()}</div>
                </section>
                <aside class="ct-lado">
                    <div class="ct-tarjeta">
                        <label>Título del catálogo<input id="ctTitulo" type="text" maxlength="80" value="${esc(est.o.titulo)}" oninput="ctOpcion('titulo', this.value)"></label>
                        <label>Precio que se muestra<select onchange="ctOpcion('nivel', this.value)">
                            <option value="publico" ${est.o.nivel === "publico" ? "selected" : ""}>Público</option>
                            <option value="mayoreo" ${est.o.nivel === "mayoreo" ? "selected" : ""}>Medio mayoreo</option>
                            <option value="distribuidor" ${est.o.nivel === "distribuidor" ? "selected" : ""}>Distribuidor</option></select></label>
                        <label>Marca <small>(opcional)</small><select onchange="ctOpcion('marca', this.value)"><option value="">Todas las marcas</option>${(est.opciones.marcas || []).map(m => `<option value="${esc(m.marca)}" ${est.o.marca === m.marca ? "selected" : ""}>${esc(m.marca)} (${m.total})</option>`).join("")}</select></label>
                        <label class="ct-check"><input type="checkbox" ${est.o.precio ? "checked" : ""} onchange="ctOpcion('precio', this.checked)"> Mostrar el precio</label>
                        <label class="ct-check"><input type="checkbox" ${est.o.barras ? "checked" : ""} onchange="ctOpcion('barras', this.checked)"> Mostrar el código de barras</label>
                        <label class="ct-check"><input type="checkbox" ${est.o.soloFoto ? "checked" : ""} onchange="ctOpcion('soloFoto', this.checked)"> Solo los que tienen foto</label>
                        <label class="ct-check"><input type="checkbox" ${est.o.soloExistencia ? "checked" : ""} onchange="ctOpcion('soloExistencia', this.checked)"> Solo los que hay en existencia</label>
                    </div>
                    <div class="ct-tarjeta ct-resumen" id="ctResumen">${htmlResumen()}</div>
                </aside>
            </div>
        </div>`;
    }

    function htmlArbol() {
        const q = plano(est.filtro);
        const filas = [];

        est.opciones.departamentos.forEach((d, i) => {
            const subs = q ? d.subcategorias.filter(s => plano(s.nombre).includes(q) || plano(d.departamento).includes(q)) : d.subcategorias;
            if (!subs.length) return;

            const marcadas = d.subcategorias.filter(s => est.sel.has(s.id)).length;
            const abierto = q ? true : est.abiertos.has(i);

            filas.push(`<div class="ct-depto">
                <div class="ct-fila-depto">
                    <input type="checkbox" id="ctD${i}" ${marcadas === d.subcategorias.length ? "checked" : ""} data-parcial="${marcadas > 0 && marcadas < d.subcategorias.length ? 1 : 0}" onchange="ctDepto(${i}, this.checked)" aria-label="Elegir todo ${esc(d.departamento)}">
                    <button type="button" class="ct-nombre" onclick="ctAbrir(${i})" aria-expanded="${abierto}"><b>${esc(d.departamento)}</b><small>${nProd(d.total)}${d.conFoto < d.total ? ` · ${d.conFoto} con foto` : ""}</small><i class="ct-flecha ${abierto ? "abierta" : ""}" aria-hidden="true">›</i></button>
                </div>
                ${abierto ? `<div class="ct-subs">${subs.map(s => `<label class="ct-sub"><input type="checkbox" ${est.sel.has(s.id) ? "checked" : ""} onchange="ctSub(${s.id}, this.checked)"><span>${esc(s.nombre)}</span><small>${s.total}${s.conFoto < s.total ? ` · ${s.conFoto} con foto` : ""}</small></label>`).join("")}</div>` : ""}
            </div>`);
        });

        const sin = est.opciones.sinCategoria;
        if (sin && sin.total && (!q || plano("sin categoria").includes(q))) {
            filas.push(`<div class="ct-depto"><label class="ct-fila-depto ct-sin"><input type="checkbox" ${est.sinCat ? "checked" : ""} onchange="ctSinCategoria(this.checked)"><span class="ct-nombre"><b>Sin categoría</b><small>${nProd(sin.total)}${sin.conFoto < sin.total ? ` · ${sin.conFoto} con foto` : ""}</small></span></label></div>`);
        }

        return filas.join("") || `<p class="ct-vacio">No encontré esa categoría.</p>`;
    }

    function htmlResumen() {
        const c = est.conteo;
        const max = est.opciones.maximo || 400;
        const eligio = est.sel.size > 0 || est.sinCat;
        const demasiados = c.total > max;

        return `<div class="ct-numero"><b>${eligio ? c.total : 0}</b><span>${eligio ? (c.total === 1 ? "producto" : "productos") : "productos"}</span></div>
            <p class="ct-detalle">${!eligio ? "Elige una o más categorías para empezar." : (c.total ? `${c.conFoto} con foto${c.conFoto < c.total ? ` · ${c.total - c.conFoto} saldrán con una letra en lugar de foto` : ""}.` : "Con esos filtros no hay productos.")}</p>
            ${demasiados ? `<p class="ct-aviso">Son más de ${max} productos para un solo catálogo. Elige menos categorías o filtra por marca.</p>` : ""}
            <button type="button" class="ct-principal" onclick="ctDescargar(false)" ${(!eligio || !c.total || demasiados || est.generando) ? "disabled" : ""}>${est.generando ? "Armando el PDF…" : "Descargar PDF"}</button>
            <button type="button" class="ct-secundario" onclick="ctDescargar(true)" ${(!eligio || !c.total || demasiados || est.generando) ? "disabled" : ""}>Ver para imprimir</button>
            ${typeof navigator.canShare === "function" ? `<button type="button" class="ct-secundario" onclick="ctCompartir()" ${(!eligio || !c.total || demasiados || est.generando) ? "disabled" : ""}>Compartir…</button>` : ""}`;
    }

    // Los departamentos con solo una parte marcada se ven "a medias" (estado indeterminado del checkbox).
    function marcarParciales() {
        document.querySelectorAll("#ctLista input[data-parcial='1']").forEach(c => { c.indeterminate = true; });
    }

    function repintarArbol() {
        const l = document.getElementById("ctLista");
        if (l) { l.innerHTML = htmlArbol(); marcarParciales(); }
        pedirConteo();
    }

    // ---------- acciones ----------

    window.ctFiltrar = function (texto) { est.filtro = texto; const l = document.getElementById("ctLista"); if (l) { l.innerHTML = htmlArbol(); marcarParciales(); } };
    window.ctAbrir = function (i) { est.abiertos.has(i) ? est.abiertos.delete(i) : est.abiertos.add(i); const l = document.getElementById("ctLista"); if (l) { l.innerHTML = htmlArbol(); marcarParciales(); } };
    window.ctDepto = function (i, marcado) { est.opciones.departamentos[i].subcategorias.forEach(s => marcado ? est.sel.add(s.id) : est.sel.delete(s.id)); repintarArbol(); };
    window.ctSub = function (id, marcado) { marcado ? est.sel.add(id) : est.sel.delete(id); repintarArbol(); };
    window.ctSinCategoria = function (marcado) { est.sinCat = marcado; pedirConteo(); };
    window.ctTodo = function (marcado) { est.sel = new Set(marcado ? todasLasSubs().map(s => s.id) : []); est.sinCat = marcado && Boolean(est.opciones.sinCategoria && est.opciones.sinCategoria.total); repintarArbol(); };

    window.ctOpcion = function (clave, valor) {
        est.o[clave] = valor;
        if (["soloFoto", "soloExistencia", "marca"].includes(clave)) pedirConteo();
    };

    function pedirConteo() {
        clearTimeout(temporizador);
        temporizador = setTimeout(async () => {
            if (!est) return;
            if (!est.sel.size && !est.sinCat) { est.conteo = { total: 0, conFoto: 0 }; pintarResumen(); return; }
            const r = await llamar("/catalogo-productos/contar", { method: "POST", body: JSON.stringify(cuerpo()) });
            if (!est) return;
            est.conteo = r.ok ? { total: r.datos.total || 0, conFoto: r.datos.conFoto || 0 } : { total: 0, conFoto: 0 };
            pintarResumen();
        }, 300);
    }

    function pintarResumen() {
        const r = document.getElementById("ctResumen");
        if (r) r.innerHTML = htmlResumen();
    }

    async function generar() {
        const r = await fetch("/catalogo-productos/pdf", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(cuerpo()) });

        if (!r.ok) {
            const datos = await r.json().catch(() => ({}));
            throw new Error(datos.error || "No se pudo armar el catálogo.");
        }

        return r.blob();
    }

    const nombreArchivo = () => (plano(est.o.titulo).replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "catalogo") + ".pdf";

    window.ctDescargar = async function (soloVer) {
        if (!est || est.generando) return;
        est.generando = true; pintarResumen();

        try {
            const blob = await generar();
            const url = URL.createObjectURL(blob);

            if (soloVer) {
                window.open(url, "_blank");
            } else {
                const a = document.createElement("a");
                a.href = url; a.download = nombreArchivo();
                document.body.appendChild(a); a.click(); a.remove();
                aviso("Catálogo listo: " + nProd(est.conteo.total) + ".");
            }

            setTimeout(() => URL.revokeObjectURL(url), 120000);
        } catch (error) {
            aviso(error.message || "No se pudo armar el catálogo.", "error");
        } finally {
            if (est) { est.generando = false; pintarResumen(); }
        }
    };

    // Compartir con el menu del equipo (WhatsApp, correo...) donde el navegador lo permita.
    window.ctCompartir = async function () {
        if (!est || est.generando) return;
        est.generando = true; pintarResumen();

        try {
            const blob = await generar();
            const archivo = new File([blob], nombreArchivo(), { type: "application/pdf" });

            if (navigator.canShare && navigator.canShare({ files: [archivo] })) await navigator.share({ files: [archivo], title: est.o.titulo });
            else aviso("Este equipo no permite compartir el archivo directo. Descárgalo y mándalo desde ahí.", "info");
        } catch (error) {
            if (error && error.name !== "AbortError") aviso(error.message || "No se pudo compartir el catálogo.", "error");
        } finally {
            if (est) { est.generando = false; pintarResumen(); }
        }
    };
})();
