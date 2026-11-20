/* Catalogo de productos en PDF: se eligen categorias de Nexo (departamento > subcategoria) y se descarga un catalogo con foto, nombre, descripcion,
   clave, precio y codigo de barras de cada producto, para mandarlo o imprimirlo. Solo lee: no cambia ningun producto.
   El dueño lo personaliza: logo y nombre de su negocio, color, tipografia, diseno, encabezado y portada (se recuerda para la proxima vez).
   Servidor: catalogo-productos-server.js. Es una funcion nueva (funcionBeta("catalogo_productos")). */
(function () {
    const esc = valor => String(valor ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
    const plano = texto => String(texto || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
    const aviso = (mensaje, tipo) => { if (typeof mostrarToastPOS === "function") mostrarToastPOS(mensaje, tipo ? { tipo } : undefined); };
    const nProd = n => `${n} producto${n === 1 ? "" : "s"}`;
    const LLAVE_ESTILO = "nexo_catalogo_estilo_v1";

    const COLORES = [["#1d4ed8", "Azul"], ["#dc2626", "Rojo"], ["#ea580c", "Naranja"], ["#ca8a04", "Dorado"], ["#15803d", "Verde"], ["#0f766e", "Turquesa"], ["#7c3aed", "Morado"], ["#be185d", "Rosa"], ["#111827", "Negro"]];
    const DISENOS = [["tarjetas", "Tarjetas", "3 por fila, con descripción"], ["compacto", "Compacto", "4 por fila, más productos por hoja"], ["lista", "Lista", "Una fila por producto"]];
    // La vista previa usa tipografias parecidas del navegador; el PDF usa las reales.
    const FAMILIA_VISTA = { moderna: "Helvetica, Arial, sans-serif", clasica: "Georgia, 'Times New Roman', serif", maquina: "'Courier New', Courier, monospace",
        montserrat: "'Montserrat Cat', sans-serif", poppins: "'Poppins Cat', sans-serif", oswald: "'Oswald Cat', sans-serif",
        "playfair-display": "'Playfair Display Cat', serif", "roboto-slab": "'Roboto Slab Cat', serif" };

    let est = null;
    let temporizador = null;

    async function llamar(ruta, opciones = {}) {
        const r = await fetch(ruta, { ...opciones, headers: { "Content-Type": "application/json", ...(opciones.headers || {}) } });
        const datos = await r.json().catch(() => ({}));
        return { ok: r.ok && datos.ok !== false, datos };
    }

    const todasLasSubs = () => est.opciones.departamentos.flatMap(d => d.subcategorias);

    // ---------- estilo recordado ----------

    function estiloGuardado() {
        try { return JSON.parse(localStorage.getItem(LLAVE_ESTILO) || "null") || {}; } catch (error) { return {}; }
    }

    function recordarEstilo() {
        try { localStorage.setItem(LLAVE_ESTILO, JSON.stringify(est.e)); } catch (error) { /* sin almacenamiento: se usa solo esta vez */ }
    }

    function estiloInicial(negocio) {
        const g = estiloGuardado();
        return {
            color: /^#[0-9a-f]{6}$/i.test(g.color || "") ? g.color : (negocio.color || "#1d4ed8"),
            tipografia: g.tipografia || "moderna",
            diseno: g.diseno || "tarjetas",
            encabezado: g.encabezado || "banda",
            esquinas: g.esquinas || "redondeadas",
            portada: g.portada === true,
            logo: g.logo || (negocio.logo ? "negocio" : "ninguno"),
            logoSubido: g.logoSubido || "",
            nombreNegocio: g.nombreNegocio || "",
            contacto: g.contacto || ""
        };
    }

    const cuerpo = () => {
        const e = est.e;
        return {
            subcategoriaIds: [...est.sel],
            incluirSinCategoria: est.sinCat,
            marcas: est.o.marca ? [est.o.marca] : [],
            soloConFoto: est.o.soloFoto,
            soloConExistencia: est.o.soloExistencia,
            nivelPrecio: est.o.nivel,
            mostrarPrecio: est.o.precio,
            mostrarCodigoBarras: est.o.barras,
            titulo: est.o.titulo,
            estilo: {
                color: e.color, tipografia: e.tipografia, diseno: e.diseno, encabezado: e.encabezado, esquinas: e.esquinas, portada: e.portada,
                logo: e.logo === "subido" ? (e.logoSubido || "ninguno") : e.logo,
                nombreNegocio: e.nombreNegocio, contacto: e.contacto
            }
        };
    };

    window.mostrarCatalogoProductos = async function () {
        if (typeof ocultarPantallasPrincipales === "function") ocultarPantallasPrincipales();
        const pantalla = document.getElementById("pantallaCatalogoProductos");
        if (!pantalla) return;
        pantalla.style.display = "block";
        if (typeof actualizarTopbarContexto === "function") actualizarTopbarContexto("Catálogo de productos", "Un PDF con foto, precio y código de barras", "catalogo-productos");
        pantalla.innerHTML = `<div class="ct-shell"><p class="ct-vacio">Preparando tus categorías…</p></div>`;

        const r = await llamar("/catalogo-productos/opciones");
        if (!r.ok) { pantalla.innerHTML = `<div class="ct-shell"><p class="ct-vacio">No se pudieron cargar las categorías. Intenta de nuevo.</p></div>`; return; }

        est = { opciones: r.datos, tab: "productos", sel: new Set(), sinCat: false, abiertos: new Set(), filtro: "", conteo: { total: 0, conFoto: 0, secciones: 0, pasaDelTope: false }, generando: false, prog: null,
            o: { titulo: "Catálogo de productos", nivel: "publico", precio: true, barras: true, soloFoto: false, soloExistencia: false, marca: "" },
            e: estiloInicial(r.datos.negocio || {}) };
        pintar();
    };

    // ---------- pintado ----------

    function pintar() {
        const pantalla = document.getElementById("pantallaCatalogoProductos");
        if (!pantalla || !est) return;

        pantalla.innerHTML = `<div class="ct-shell">
            <header class="ct-cab"><h2>Catálogo de productos</h2><p>Arma un PDF con la foto, el precio y el código de barras de tus productos, con tu logo y tus colores. Sirve para mandarlo a tus clientes o imprimirlo.</p></header>
            <div class="ct-tabs" role="tablist"><button type="button" role="tab" class="${est.tab === "productos" ? "activa" : ""}" onclick="ctTab('productos')"><b>1</b> Qué incluir</button><button type="button" role="tab" class="${est.tab === "estilo" ? "activa" : ""}" onclick="ctTab('estilo')"><b>2</b> Cómo se ve</button></div>
            <div class="ct-dos">
                <div id="ctPanel">${est.tab === "productos" ? htmlProductos() : htmlEstilo()}</div>
                <aside class="ct-lado">
                    ${est.tab === "estilo" ? htmlTarjetaVista() : `<div class="ct-tarjeta">
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
                    </div>`}
                    <div class="ct-tarjeta ct-resumen" id="ctResumen">${htmlResumen()}</div>
                </aside>
            </div>
        </div>`;
        if (est.tab === "productos") marcarParciales();
    }

    window.ctTab = function (tab) { est.tab = tab; pintar(); };

    // ----- pestana 1: categorias -----

    function htmlProductos() {
        return `<section class="ct-arbol" aria-label="Categorías">
            <div class="ct-barra"><input id="ctBuscar" type="search" placeholder="Buscar categoría…" value="${esc(est.filtro)}" oninput="ctFiltrar(this.value)" autocomplete="off">
                <button type="button" class="ct-chico" onclick="ctTodo(true)">Todas</button><button type="button" class="ct-chico" onclick="ctTodo(false)">Ninguna</button></div>
            <div id="ctLista">${htmlArbol()}</div>
        </section>`;
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

    // ----- pestana 2: estilo -----

    function htmlEstilo() {
        const e = est.e;
        const neg = est.opciones.negocio || {};
        const fuentes = est.opciones.fuentes || [];
        const miColor = neg.color && !COLORES.some(c => c[0] === neg.color) ? neg.color : "";
        const logoActual = e.logo === "negocio" ? neg.logo : (e.logo === "subido" ? e.logoSubido : "");

        return `<section class="ct-estilo">
            <div class="ct-grupo"><h3>Color</h3>
                <div class="ct-colores">${COLORES.map(([hex, nombre]) => `<button type="button" class="ct-color ${e.color === hex ? "elegido" : ""}" style="--c:${hex}" title="${nombre}" aria-label="${nombre}" onclick="ctEstilo('color', '${hex}')"></button>`).join("")}
                    ${miColor ? `<button type="button" class="ct-color ${e.color === miColor ? "elegido" : ""}" style="--c:${miColor}" title="El color de mi negocio" aria-label="El color de mi negocio" onclick="ctEstilo('color', '${miColor}')"></button>` : ""}
                    <label class="ct-color-libre" title="Elegir otro color"><input type="color" value="${esc(e.color)}" onchange="ctEstilo('color', this.value)"><span>Otro color</span></label></div></div>

            <div class="ct-grupo"><h3>Tipografía</h3>
                <div class="ct-fuentes">${fuentes.map(f => `<button type="button" class="ct-fuente ${e.tipografia === f.id ? "elegida" : ""}" style="font-family:${FAMILIA_VISTA[f.id] || FAMILIA_VISTA.moderna}" onclick="ctEstilo('tipografia', '${esc(f.id)}')"><b>Aa</b><span>${esc(f.nombre)}</span></button>`).join("")}</div></div>

            <div class="ct-grupo"><h3>Diseño de las hojas</h3>
                <div class="ct-disenos">${DISENOS.map(([id, nombre, texto]) => `<button type="button" class="ct-diseno ${e.diseno === id ? "elegido" : ""}" onclick="ctEstilo('diseno', '${id}')"><i class="ct-mini ct-mini-${id}" aria-hidden="true"><s></s><s></s><s></s><s></s><s></s><s></s></i><b>${nombre}</b><small>${texto}</small></button>`).join("")}</div></div>

            <div class="ct-grupo ct-fila-dos">
                <div><h3>Encabezado</h3><div class="ct-segmento">${[["banda", "Con banda de color"], ["linea", "Con línea"]].map(([id, t]) => `<button type="button" class="${e.encabezado === id ? "elegido" : ""}" onclick="ctEstilo('encabezado', '${id}')">${t}</button>`).join("")}</div></div>
                <div><h3>Esquinas</h3><div class="ct-segmento">${[["redondeadas", "Redondeadas"], ["rectas", "Rectas"]].map(([id, t]) => `<button type="button" class="${e.esquinas === id ? "elegido" : ""}" onclick="ctEstilo('esquinas', '${id}')">${t}</button>`).join("")}</div></div>
            </div>

            <div class="ct-grupo"><h3>Portada</h3><label class="ct-check"><input type="checkbox" ${e.portada ? "checked" : ""} onchange="ctEstilo('portada', this.checked)"> Agregar una portada con el logo, el nombre y tus datos de contacto</label></div>

            <div class="ct-grupo"><h3>Logo y datos del negocio</h3>
                <div class="ct-logo">
                    <div class="ct-logo-caja">${logoActual ? `<img src="${esc(logoActual)}" alt="Logo">` : `<span>Sin logo</span>`}</div>
                    <div class="ct-logo-botones">
                        ${neg.logo ? `<button type="button" class="ct-chico ${e.logo === "negocio" ? "elegido" : ""}" onclick="ctEstilo('logo', 'negocio')">Usar el logo de mi negocio</button>` : ""}
                        <button type="button" class="ct-chico" onclick="document.getElementById('ctArchivoLogo').click()">Subir otro logo…</button>
                        <button type="button" class="ct-chico ${e.logo === "ninguno" ? "elegido" : ""}" onclick="ctEstilo('logo', 'ninguno')">Sin logo</button>
                        <input id="ctArchivoLogo" type="file" accept="image/*" hidden onchange="ctSubirLogo(this.files[0]); this.value=''">
                    </div></div>
                <label>Título del catálogo<input type="text" maxlength="80" value="${esc(est.o.titulo)}" oninput="ctOpcion('titulo', this.value)"></label>
                <label>Nombre del negocio <small>(si lo dejas vacío se usa “${esc(neg.nombre || "el de tu negocio")}”)</small><input type="text" maxlength="60" value="${esc(e.nombreNegocio)}" placeholder="${esc(neg.nombre || "")}" oninput="ctEstilo('nombreNegocio', this.value, true)"></label>
                <label>Teléfono, WhatsApp o dirección <small>(sale en la portada y al pie de cada hoja)</small><input type="text" maxlength="140" value="${esc(e.contacto)}" placeholder="${esc(neg.contacto || "Tel. 492 000 0000 | Av. Hidalgo 123")}" oninput="ctEstilo('contacto', this.value, true)"></label>
            </div>
        </section>`;
    }

    // Vista previa al momento (no es el PDF: es una muestra de colores, letra, encabezado y diseño).
    function htmlVista() {
        const e = est.e;
        const neg = est.opciones.negocio || {};
        const logo = e.logo === "negocio" ? neg.logo : (e.logo === "subido" ? e.logoSubido : "");
        const nombre = e.nombreNegocio || neg.nombre || "Tu ferretería";
        const claro = colorClaro(e.color);
        const radio = e.esquinas === "redondeadas" ? "10px" : "0";
        const familia = FAMILIA_VISTA[e.tipografia] || FAMILIA_VISTA.moderna;
        const cabecera = e.encabezado === "banda"
            ? `<div class="ct-v-banda" style="background:${e.color};color:${claro ? "#0f172a" : "#fff"}">${logo ? `<i class="ct-v-logo" style="border-radius:${radio === "0" ? "0" : "6px"}"><img src="${esc(logo)}" alt=""></i>` : ""}<div><b>${esc(nombre)}</b><small>${esc(est.o.titulo)}</small></div></div>`
            : `<div class="ct-v-linea" style="border-color:${e.color}">${logo ? `<img src="${esc(logo)}" alt="">` : ""}<div><b style="color:${e.color}">${esc(nombre)}</b><small>${esc(est.o.titulo)}</small></div></div>`;
        const tarjeta = `<div class="ct-v-card" style="border-color:${e.color}55;border-radius:${radio}"><i style="background:${e.color}1f;color:${e.color}55;border-radius:${radio === "0" ? "0" : "6px"}">P</i><b>Producto de ejemplo</b>${est.o.precio ? `<span style="color:${e.color}">$125.00</span>` : ""}${est.o.barras ? "<em></em>" : ""}</div>`;
        const fila = `<div class="ct-v-fila" style="border-color:${e.color}55"><i style="background:${e.color}1f;color:${e.color}55;border-radius:${radio === "0" ? "0" : "4px"}">P</i><b>Producto de ejemplo</b>${est.o.precio ? `<span style="color:${e.color}">$125.00</span>` : ""}</div>`;
        const cuerpoVista = e.diseno === "lista" ? `<div class="ct-v-lista">${fila.repeat(3)}</div>` : `<div class="ct-v-grid ${e.diseno}">${tarjeta.repeat(e.diseno === "compacto" ? 8 : 6)}</div>`;

        return `<div class="ct-v-hoja" style="font-family:${familia}">${cabecera}<div class="ct-v-seccion" style="background:${e.color};color:${claro ? "#0f172a" : "#fff"};border-radius:${radio === "0" ? "0" : "5px"}">DEPARTAMENTO</div>${cuerpoVista}</div>`;
    }

    // Tarjeta fija a la derecha: la muestra siempre se ve mientras se cambian las opciones.
    function htmlTarjetaVista() {
        return `<div class="ct-tarjeta ct-prev-card"><h3>Así se verá</h3><div class="ct-vista" id="ctVista">${htmlVista()}</div><p class="ct-prev-nota">Es una muestra del estilo: el PDF lleva tus productos y sus fotos.</p></div>`;
    }

    function colorClaro(hex) {
        const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255);
        return 0.299 * r + 0.587 * g + 0.114 * b > 0.62;
    }

    window.ctEstilo = function (clave, valor, sinRepintar) {
        est.e[clave] = valor;
        recordarEstilo();
        const v = document.getElementById("ctVista");
        if (v) v.innerHTML = htmlVista();
        if (sinRepintar) return;
        const panel = document.getElementById("ctPanel");
        if (panel && est.tab === "estilo") panel.innerHTML = htmlEstilo();
    };

    // El logo se reduce aqui (max. 600 px, PNG para conservar fondos transparentes) para que suba rapido y se pueda recordar.
    window.ctSubirLogo = function (archivo) {
        if (!archivo) return;
        if (!String(archivo.type || "").startsWith("image/")) { aviso("Elige un archivo de imagen (JPG, PNG…).", "error"); return; }

        const lector = new FileReader();
        lector.onerror = () => aviso("No se pudo leer la imagen.", "error");
        lector.onload = () => {
            const img = new Image();
            img.onerror = () => aviso("Ese archivo no es una imagen válida.", "error");
            img.onload = () => {
                const escala = Math.min(1, 600 / Math.max(img.width, img.height));
                const lienzo = document.createElement("canvas");
                lienzo.width = Math.max(1, Math.round(img.width * escala));
                lienzo.height = Math.max(1, Math.round(img.height * escala));
                lienzo.getContext("2d").drawImage(img, 0, 0, lienzo.width, lienzo.height);
                est.e.logoSubido = lienzo.toDataURL("image/png");
                est.e.logo = "subido";
                recordarEstilo();
                pintar();
            };
            img.src = lector.result;
        };
        lector.readAsDataURL(archivo);
    };

    // ----- resumen y acciones -----

    const MB_POR_PRODUCTO = 0.0245; // con foto; sin foto casi no pesa

    function pesoAprox(c) {
        const mb = c.conFoto * MB_POR_PRODUCTO + (c.total - c.conFoto) * 0.0025;
        return mb < 1 ? "menos de 1 MB" : "unos " + Math.round(mb) + " MB";
    }

    function htmlProgreso() {
        const p = est.prog;
        if (!p) return "";
        return `<div class="ct-prog" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(p.pct)}">
            <div class="ct-prog-barra"><div class="ct-prog-relleno" id="ctProgRelleno" style="width:${p.pct}%"></div></div>
            <div class="ct-prog-linea"><span id="ctProgTexto">${esc(p.texto)}</span><b id="ctProgPct">${Math.round(p.pct)}%</b></div>
        </div>`;
    }

    function htmlResumen() {
        const c = est.conteo;
        const max = est.opciones.maximo || 1000;
        const maxSec = est.opciones.maximoSecciones || 5000;
        const eligio = est.sel.size > 0 || est.sinCat;
        const hay = eligio && c.total > 0;
        const grande = c.total > max;
        const pasaDeTodo = c.pasaDelTope || c.total > maxSec;
        const variasSecciones = c.secciones >= 2;
        const ocupado = est.generando ? "disabled" : "";
        const completo = (!hay || grande || est.generando) ? "disabled" : "";
        const porSecciones = (!hay || pasaDeTodo || !variasSecciones || est.generando) ? "disabled" : "";
        const sugerir = hay && !grande && variasSecciones && c.total > 400;

        return `<div class="ct-numero"><b>${eligio ? c.total : 0}</b><span>productos</span></div>
            <p class="ct-detalle">${!eligio ? "Elige una o más categorías para empezar." : (c.total ? `${c.conFoto} con foto${c.conFoto < c.total ? ` · ${c.total - c.conFoto} saldrán con una letra en lugar de foto` : ""}.` : "Con esos filtros no hay productos.")}</p>
            ${hay && c.total > 300 && !pasaDeTodo ? `<p class="ct-detalle">El PDF completo pesaría ${pesoAprox(c)}.</p>` : ""}
            ${pasaDeTodo ? `<p class="ct-aviso">Son más de ${maxSec} productos. Elige menos categorías o filtra por marca.</p>` : ""}
            ${grande && !pasaDeTodo ? `<p class="ct-aviso">Son más de ${max} productos: no caben en un solo PDF. Lo armamos por secciones, un PDF por departamento, todos juntos en un ZIP (${c.secciones} archivos).</p>` : ""}
            ${sugerir ? `<p class="ct-consejo">Te recomendamos hacerlo por secciones (${c.secciones} PDF en un ZIP): cada archivo es más ligero y fácil de mandar. Si lo quieres todo junto, también se puede.</p>` : ""}
            ${htmlProgreso()}
            ${grande && !pasaDeTodo ? `<button type="button" class="ct-principal" onclick="ctSecciones()" ${porSecciones}>${est.generando ? "Armando los PDF…" : "Descargar por secciones (ZIP)"}</button>` : `
            <button type="button" class="ct-principal" onclick="ctDescargar(false)" ${completo}>${est.generando ? "Armando el PDF…" : (variasSecciones ? "Descargar PDF completo" : "Descargar PDF")}</button>
            ${variasSecciones ? `<button type="button" class="ct-secundario" onclick="ctSecciones()" ${porSecciones}>Descargar por secciones (ZIP)</button>` : ""}
            <button type="button" class="ct-secundario" onclick="ctDescargar(true)" ${completo}>Ver para imprimir</button>
            ${typeof navigator.canShare === "function" ? `<button type="button" class="ct-secundario" onclick="ctCompartir()" ${completo}>Compartir…</button>` : ""}`}`;
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

    window.ctFiltrar = function (texto) { est.filtro = texto; const l = document.getElementById("ctLista"); if (l) { l.innerHTML = htmlArbol(); marcarParciales(); } };
    window.ctAbrir = function (i) { est.abiertos.has(i) ? est.abiertos.delete(i) : est.abiertos.add(i); const l = document.getElementById("ctLista"); if (l) { l.innerHTML = htmlArbol(); marcarParciales(); } };
    window.ctDepto = function (i, marcado) { est.opciones.departamentos[i].subcategorias.forEach(s => marcado ? est.sel.add(s.id) : est.sel.delete(s.id)); repintarArbol(); };
    window.ctSub = function (id, marcado) { marcado ? est.sel.add(id) : est.sel.delete(id); repintarArbol(); };
    window.ctSinCategoria = function (marcado) { est.sinCat = marcado; pedirConteo(); };
    window.ctTodo = function (marcado) { est.sel = new Set(marcado ? todasLasSubs().map(s => s.id) : []); est.sinCat = marcado && Boolean(est.opciones.sinCategoria && est.opciones.sinCategoria.total); repintarArbol(); };

    window.ctOpcion = function (clave, valor) {
        est.o[clave] = valor;
        if (["soloFoto", "soloExistencia", "marca"].includes(clave)) pedirConteo();
        if (["titulo", "precio", "barras"].includes(clave) && est.tab === "estilo") { const v = document.getElementById("ctVista"); if (v) v.innerHTML = htmlVista(); }
    };

    function pedirConteo() {
        clearTimeout(temporizador);
        temporizador = setTimeout(async () => {
            if (!est) return;
            if (!est.sel.size && !est.sinCat) { est.conteo = { total: 0, conFoto: 0, secciones: 0, pasaDelTope: false }; pintarResumen(); return; }
            const r = await llamar("/catalogo-productos/contar", { method: "POST", body: JSON.stringify(cuerpo()) });
            if (!est) return;
            est.conteo = r.ok ? { total: r.datos.total || 0, conFoto: r.datos.conFoto || 0, secciones: r.datos.secciones || 0, pasaDelTope: Boolean(r.datos.pasaDelTope) } : { total: 0, conFoto: 0, secciones: 0, pasaDelTope: false };
            pintarResumen();
        }, 300);
    }

    function pintarResumen() {
        const r = document.getElementById("ctResumen");
        if (r) r.innerHTML = htmlResumen();
    }

    // ----- barra de progreso -----
    // El servidor no avisa en que va, asi que la barra avanza por tiempo estimado (segun cuantos productos son),
    // se frena cerca del 92 % esperando la respuesta, y al llegar el archivo muestra la descarga real.

    function pintarProgreso() {
        const p = est && est.prog;
        if (!p) return;
        const r = document.getElementById("ctProgRelleno"), t = document.getElementById("ctProgTexto"), n = document.getElementById("ctProgPct");
        if (r) r.style.width = p.pct + "%";
        if (t) t.textContent = p.texto;
        if (n) n.textContent = Math.round(p.pct) + "%";
    }

    function empezarProgreso(porSecciones) {
        const total = est.conteo.total || 1;
        const estimado = (1.5 + total * 0.01) * (porSecciones ? 1.3 : 1) * 1000;
        const t0 = Date.now();
        est.prog = { pct: 2, texto: "Buscando los productos y sus fotos…", descargando: false };
        clearInterval(est.progTimer);
        est.progTimer = setInterval(() => {
            if (!est || !est.prog || est.prog.descargando) return;
            const pct = Math.max(est.prog.pct, Math.min(92, 92 * (1 - Math.exp(-(Date.now() - t0) / estimado))));
            est.prog.pct = pct;
            est.prog.texto = pct < 25 ? "Buscando los productos y sus fotos…" : pct < 75 ? (porSecciones ? "Armando los PDF por departamento…" : "Armando las páginas del catálogo…") : "Terminando el archivo…";
            pintarProgreso();
        }, 120);
    }

    function pararProgreso(listo) {
        if (!est) return;
        clearInterval(est.progTimer);
        if (listo && est.prog) { est.prog.pct = 100; est.prog.texto = "¡Listo!"; pintarProgreso(); }
        else est.prog = null;
    }

    async function generar(ruta = "/catalogo-productos/pdf") {
        empezarProgreso(ruta.endsWith("/secciones"));
        pintarResumen();

        const r = await fetch(ruta, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(cuerpo()) });

        if (!r.ok) {
            const datos = await r.json().catch(() => ({}));
            throw new Error(datos.error || "No se pudo armar el catálogo.");
        }

        const tipo = r.headers.get("Content-Type") || "";
        const largo = Number(r.headers.get("Content-Length")) || 0;

        if (!r.body || !r.body.getReader || !largo || !est) return r.blob();

        est.prog.descargando = true;
        est.prog.texto = "Descargando el archivo…";
        const lector = r.body.getReader();
        const trozos = [];
        let leidos = 0;

        for (;;) {
            const { done, value } = await lector.read();
            if (done) break;
            trozos.push(value);
            leidos += value.length;
            if (est && est.prog) { est.prog.pct = Math.max(est.prog.pct, 92 + 7 * (leidos / largo)); pintarProgreso(); }
        }

        return new Blob(trozos, { type: tipo });
    }

    function cerrarProgreso() {
        if (!est) return;
        const listo = est.prog && est.prog.pct >= 100;
        clearInterval(est.progTimer);
        if (!listo) { est.prog = null; pintarResumen(); return; }
        pintarResumen();
        setTimeout(() => { if (est && !est.generando) { est.prog = null; pintarResumen(); } }, 1400);
    }

    const nombreArchivo = () => (plano(est.o.titulo).replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "catalogo") + ".pdf";

    window.ctDescargar = async function (soloVer) {
        if (!est || est.generando) return;
        est.generando = true; pintarResumen();

        try {
            const blob = await generar();
            pararProgreso(true);
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
            if (est) { est.generando = false; cerrarProgreso(); }
        }
    };

    // Un PDF por departamento, todos en un ZIP.
    window.ctSecciones = async function () {
        if (!est || est.generando) return;
        est.generando = true;

        try {
            const blob = await generar("/catalogo-productos/secciones");
            pararProgreso(true);
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url; a.download = nombreArchivo().replace(/\.pdf$/, "") + "-por-secciones.zip";
            document.body.appendChild(a); a.click(); a.remove();
            aviso("Listo: " + est.conteo.secciones + " PDF en un ZIP (" + nProd(est.conteo.total) + ").");
            setTimeout(() => URL.revokeObjectURL(url), 120000);
        } catch (error) {
            aviso(error.message || "No se pudo armar el catálogo.", "error");
        } finally {
            if (est) { est.generando = false; cerrarProgreso(); }
        }
    };

    // Compartir con el menu del equipo (WhatsApp, correo...) donde el navegador lo permita.
    window.ctCompartir = async function () {
        if (!est || est.generando) return;
        est.generando = true; pintarResumen();

        try {
            const blob = await generar();
            pararProgreso(true);
            const archivo = new File([blob], nombreArchivo(), { type: "application/pdf" });

            if (navigator.canShare && navigator.canShare({ files: [archivo] })) await navigator.share({ files: [archivo], title: est.o.titulo });
            else aviso("Este equipo no permite compartir el archivo directo. Descárgalo y mándalo desde ahí.", "info");
        } catch (error) {
            if (error && error.name !== "AbortError") aviso(error.message || "No se pudo compartir el catálogo.", "error");
        } finally {
            if (est) { est.generando = false; cerrarProgreso(); }
        }
    };
})();
