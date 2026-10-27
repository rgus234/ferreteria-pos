/* Inventario de tienda en el celular: indicadores, escaner de ubicaciones, mapa de pasillos/estantes/bodega con codigos
   legibles (P-01-E-03), ficha de cada producto, conteo por estante, Resurtir de bodega y "¿Donde esta?".
   Navegacion con pila: atras siempre regresa a la pantalla anterior (de un producto al estante, del estante al pasillo...).
   Usa /ubicaciones, /resurtir y /ubicaciones/* (ubicaciones-server.js, existencias-lugar-server.js). */

(function () {
    const TIPOS_TIENDA = [["pasillo", "Pasillo"], ["estante", "Estante"], ["nivel", "Nivel"]];
    const TIPOS_BODEGA = [["seccion", "Sección"], ["rack", "Rack"], ["nivel", "Nivel"]];

    const I = {
        atras: `<path d="m15 18-6-6 6-6"/>`,
        siguiente: `<path d="m9 18 6-6-6-6"/>`,
        mas: `<path d="M12 5v14M5 12h14"/>`,
        menos: `<path d="M5 12h14"/>`,
        buscar: `<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/>`,
        escanear: `<path d="M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2"/><path d="M7 12h10"/>`,
        contar: `<rect x="8" y="2" width="8" height="4" rx="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><path d="m9 14 2 2 4-4"/>`,
        resurtir: `<path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/>`,
        etiqueta: `<path d="M6 9V2h12v7"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/>`,
        pasillo: `<path d="M5 21 8 3M19 21 16 3M12 5v3M12 11v3M12 17v3"/>`,
        estante: `<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M3 15h18"/>`,
        seccion: `<path d="M3 21V8l9-5 9 5v13"/><path d="M8 21v-7h8v7"/>`,
        rack: `<path d="M4 4v17M20 4v17M4 9h16M4 15h16M4 21h16"/>`,
        nivel: `<path d="M3 8h18M3 16h18"/>`,
        caja: `<path d="m7.5 4.27 9 5.15"/><path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/><path d="m3.3 7 8.7 5 8.7-5"/><path d="M12 22V12"/>`,
        lugar: `<path d="M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/>`,
        editar: `<path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/>`,
        borrar: `<path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/>`,
        ok: `<path d="m5 12 5 5L20 7"/>`,
        aviso: `<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><path d="M12 9v4M12 17h.01"/>`
    };

    const icono = (nombre, tam = 22) => `<svg class="dm-i" width="${tam}" height="${tam}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${I[nombre] || ""}</svg>`;
    const esc = valor => (typeof escaparDueno === "function" ? escaparDueno(valor) : String(valor ?? ""));
    const dinero2 = valor => "$" + Number(valor || 0).toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const numero = valor => Number(valor || 0).toLocaleString("es-MX", { maximumFractionDigits: 3 });

    let lugares = [];
    let resumen = null;
    let capa = null;
    let pila = [];

    const actual = () => pila[pila.length - 1];
    const lugarPorId = id => lugares.find(l => l.id === id);

    async function llamar(ruta, opciones = {}) {
        try {
            const cuerpo = opciones.body ? { body: JSON.stringify(opciones.body), headers: { "Content-Type": "application/json" } } : {};
            return { ok: true, datos: await fetchAutenticado(ruta, { method: opciones.method || "GET", ...cuerpo }) || {} };
        } catch (error) {
            return { ok: false, estado: error.status, datos: error.datos || { error: error.message } };
        }
    }

    // ---- Avisos y dialogos propios (nada de alert/prompt del navegador) ----

    function aviso(texto, tipo = "ok") {
        const t = document.createElement("div");
        t.className = `dm-aviso dm-aviso-${tipo}`;
        t.innerHTML = `${icono(tipo === "ok" ? "ok" : "aviso", 18)}<span>${esc(texto)}</span>`;
        document.body.appendChild(t);
        setTimeout(() => t.classList.add("sale"), 2600);
        setTimeout(() => t.remove(), 3000);
    }

    function dialogo({ titulo, texto = "", campo = null, aceptar = "Aceptar", peligro = false }) {
        return new Promise(resolve => {
            const fondo = document.createElement("div");
            fondo.className = "dm-dialogo-fondo";
            fondo.innerHTML = `<div class="dm-dialogo" role="dialog"><h3>${esc(titulo)}</h3>${texto ? `<p>${esc(texto)}</p>` : ""}${campo ? `<input class="dm-input" type="${campo.tipo || "text"}" inputmode="${campo.tipo === "number" ? "decimal" : "text"}" value="${esc(campo.valor ?? "")}" placeholder="${esc(campo.ayuda || "")}" autocomplete="off">` : ""}<div class="dm-dialogo-botones"><button type="button" data-r="no">Cancelar</button><button type="button" data-r="si" class="${peligro ? "peligro" : "principal"}">${esc(aceptar)}</button></div></div>`;
            document.body.appendChild(fondo);
            const entrada = fondo.querySelector("input");
            const cerrar = ok => { const valor = entrada ? entrada.value : null; fondo.remove(); resolve({ ok, valor }); };
            fondo.addEventListener("click", e => { const r = e.target.dataset?.r; if (r) cerrar(r === "si"); else if (e.target === fondo) cerrar(false); });
            entrada?.addEventListener("keydown", e => { if (e.key === "Enter") cerrar(true); });
            setTimeout(() => entrada?.focus(), 80);
        });
    }

    // ---- Entrada en "Mas" ----

    function insertarEntrada() {
        const destino = document.getElementById("duenoMasStatusCard");
        if (!destino || document.getElementById("dmEntrada") || !(typeof haySesionActivaDueno === "function" && haySesionActivaDueno())) return;

        const boton = document.createElement("button");
        boton.type = "button";
        boton.id = "dmEntrada";
        boton.className = "dm-entrada";
        boton.innerHTML = `<span class="dm-entrada-icono">${icono("escanear", 26)}</span><b>Inventario de tienda</b><small>Escanear, contar, resurtir y saber dónde está cada producto</small>`;
        boton.addEventListener("click", abrir);
        destino.insertAdjacentElement("afterend", boton);
    }

    const original = window.cargarPanelMasDueno;

    if (typeof original === "function") {
        window.cargarPanelMasDueno = async function (...argumentos) {
            const resultado = await original.apply(this, argumentos);
            insertarEntrada();
            return resultado;
        };
    }

    // ---- Estructura de pantalla y navegacion ----

    function obtenerCapa() {
        if (!capa) {
            capa = document.createElement("div");
            capa.id = "dmCapa";
            capa.className = "dm-capa";
            document.body.appendChild(capa);
        }

        capa.classList.add("abierta");
        return capa;
    }

    function pantalla({ titulo, subtitulo = "", chip = "", cuerpo, pie = "" }) {
        return `<div class="dm-marco"><header class="dm-cabecera">
            <button type="button" class="dm-atras" onclick="dmAtras()" aria-label="Atrás">${icono("atras", 22)}</button>
            <div class="dm-titulo-caja"><h2>${esc(titulo)}</h2>${subtitulo ? `<small>${esc(subtitulo)}</small>` : ""}</div>
            ${chip ? `<span class="dm-chip-codigo">${esc(chip)}</span>` : `<span class="dm-atras dm-vacio"></span>`}
        </header><main class="dm-cuerpo">${cuerpo}</main>${pie ? `<footer class="dm-pie">${pie}</footer>` : ""}</div>`;
    }

    function pintar() {
        const c = obtenerCapa();
        const p = actual();
        const mapa = { inicio: pintarInicio, lugar: pintarLugar, producto: pintarProducto, conteo: pintarConteo, resurtir: pintarResurtir, buscar: pintarBusqueda, nuevo: pintarNuevo };

        c.innerHTML = (mapa[p.t] || pintarInicio)(p);
    }

    function ir(entrada) { pila.push(entrada); pintar(); capa.scrollTop = 0; }

    window.dmAtras = function () {
        pila.pop();

        if (!pila.length) { capa?.classList.remove("abierta"); return; }

        pintar();
        // Al volver a un estante o al inicio se refrescan los numeros por si algo cambio.
        const p = actual();
        if (p.t === "inicio") cargarGeneral(); else if (p.t === "lugar") cargarLugar(p);
    };

    async function abrir() {
        pila = [{ t: "inicio" }];
        pintar();
        await cargarGeneral();
    }

    async function cargarGeneral() {
        const [u, s] = await Promise.all([llamar("/ubicaciones"), llamar("/ubicaciones/resumen")]);

        if (u.ok) lugares = u.datos.ubicaciones || [];
        if (s.ok) resumen = s.datos;
        if (!u.ok && actual()?.t === "inicio") { capa.querySelector(".dm-cuerpo").innerHTML = `<p class="dm-nota">${esc(u.datos.error || "No se pudo cargar. Revisa tu internet.")}</p>`; return; }

        if (actual()?.t === "inicio") pintar();
    }

    // ---- Piezas visuales ----

    const hijosDe = id => lugares.filter(l => (l.padreId || null) === id);
    const descendientes = id => hijosDe(id).flatMap(h => [h, ...descendientes(h.id)]);
    const totalProductos = l => (l.productos || 0) + descendientes(l.id).reduce((s, d) => s + (d.productos || 0), 0);
    const nombreTipo = t => ({ pasillo: "Pasillo", estante: "Estante", nivel: "Nivel", seccion: "Sección", rack: "Rack" }[t] || t);

    function filaLugar(l) {
        const sub = hijosDe(l.id).length;
        const detalle = [sub ? `${sub} ${sub === 1 ? "lugar" : "lugares"}` : "", `${totalProductos(l)} productos`].filter(Boolean).join(" · ");

        return `<button type="button" class="dm-fila" onclick="dmIrLugar(${l.id})">
            <span class="dm-icono-caja dm-${l.zona}">${icono(I[l.tipo] ? l.tipo : "estante", 22)}</span>
            <span class="dm-fila-texto"><b>${esc(l.nombre)}</b><small>${esc(detalle)}</small></span>
            <span class="dm-chip-codigo dm-chico">${esc(l.codigo)}</span>${icono("siguiente", 18)}
        </button>`;
    }

    function miniatura(url, tam = 52) {
        return `<span class="dm-mini" style="width:${tam}px;height:${tam}px">${url ? `<img src="${esc(url)}" alt="" loading="lazy" onerror="this.remove()">` : ""}${icono("caja", Math.round(tam * 0.45))}</span>`;
    }

    // ---- Inicio ----

    function pintarInicio() {
        const dato = (valor, texto, clase = "") => `<div class="dm-dato ${clase}"><strong>${valor ?? "—"}</strong><span>${texto}</span></div>`;
        const zona = (z, titulo, icon, vacio) => {
            const raiz = lugares.filter(l => l.zona === z && !l.padreId);
            return `<section class="dm-seccion"><div class="dm-seccion-cab"><h3><span class="dm-icono-caja dm-${z} dm-chico">${icono(icon, 18)}</span>${titulo}</h3><button type="button" onclick="dmNuevo('${z}')">${icono("mas", 16)} Agregar</button></div>
            ${raiz.map(filaLugar).join("") || `<p class="dm-nota">${vacio}</p>`}</section>`;
        };

        return pantalla({
            titulo: "Inventario de tienda",
            subtitulo: "Tienda y bodega",
            cuerpo: `
            <div class="dm-datos">
                ${dato(resumen?.productosConLugar, "con lugar")}
                ${dato(resumen?.ubicaciones ?? lugares.length, "lugares")}
                ${dato(resumen?.productosSinLugar, "sin lugar", resumen?.productosSinLugar ? "aviso" : "")}
                ${dato(resumen?.porResurtir, "por resurtir", resumen?.agotados ? "alerta" : "")}
            </div>
            <button type="button" class="dm-escanear" onclick="dmEscanear()"><span class="dm-escanear-icono">${icono("escanear", 30)}</span><span><b>Escanear ubicación</b><small>Apunta al código QR del estante</small></span>${icono("siguiente", 20)}</button>
            <div class="dm-cuadricula">
                <button type="button" onclick="dmContarEscaneando()"><span class="dm-icono-caja dm-azul">${icono("contar", 24)}</span>Contar inventario</button>
                <button type="button" onclick="dmIrBuscar()"><span class="dm-icono-caja dm-verde">${icono("buscar", 24)}</span>¿Dónde está?</button>
                <button type="button" onclick="dmIrResurtir()"><span class="dm-icono-caja dm-ambar">${icono("resurtir", 24)}</span>Resurtir${resumen?.porResurtir ? `<em>${resumen.porResurtir}</em>` : ""}</button>
                <button type="button" onclick="dmImprimir()" ${lugares.length ? "" : "disabled"}><span class="dm-icono-caja dm-gris">${icono("etiqueta", 24)}</span>Etiquetas QR</button>
            </div>
            ${zona("tienda", "Tienda", "pasillo", "Aún no tienes pasillos ni estantes.")}
            ${zona("bodega", "Bodega", "seccion", "Aún no tienes secciones de bodega.")}`
        });
    }

    // ---- Lugar (pasillo, estante, nivel, seccion, rack) ----

    window.dmIrLugar = function (id) {
        const l = lugarPorId(id);
        if (!l) return;

        const entrada = { t: "lugar", id, productos: null, buscando: false };
        ir(entrada);
        cargarLugar(entrada);
    };

    async function cargarLugar(entrada) {
        const r = await llamar(`/ubicaciones/${entrada.id}/productos`);
        entrada.productos = r.ok ? r.datos.productos || [] : [];

        if (actual() === entrada) pintar();
    }

    function pintarLugar(e) {
        const l = lugarPorId(e.id);

        if (!l) return pintarInicio();

        const hijos = hijosDe(l.id);
        const productos = e.productos;

        return pantalla({
            titulo: l.nombre,
            subtitulo: `${l.zona === "bodega" ? "Bodega" : "Tienda"} · ${nombreTipo(l.tipo)}`,
            chip: l.codigo,
            cuerpo: `
            <div class="dm-ruta">${icono("lugar", 16)}<span>${esc(l.ruta.replace(/ › /g, "  ›  "))}</span></div>
            <div class="dm-acciones">
                <button type="button" class="dm-primario" onclick="dmContar(${l.id})">${icono("contar", 20)}<span>Contar</span></button>
                <button type="button" onclick="dmImprimir(${l.id})">${icono("etiqueta", 20)}<span>Etiqueta</span></button>
                <button type="button" onclick="dmNuevo('${l.zona}', ${l.id})">${icono("mas", 20)}<span>Dentro</span></button>
            </div>
            ${hijos.length ? `<section class="dm-seccion"><div class="dm-seccion-cab"><h3>Dentro de ${esc(l.nombre)}</h3></div>${hijos.map(filaLugar).join("")}</section>` : ""}
            <section class="dm-seccion">
                <div class="dm-seccion-cab"><h3>Productos${productos ? ` (${productos.length})` : ""}</h3><button type="button" onclick="dmAlternarBuscar()">${icono("mas", 16)} Poner producto</button></div>
                ${e.buscando ? `<input id="dmBuscarProd" class="dm-input" type="search" placeholder="Nombre o código del producto" oninput="dmBuscarProducto(this.value)" autocomplete="off"><div id="dmResultados" class="dm-lista"></div>` : ""}
                ${productos === null ? `<p class="dm-nota">Cargando…</p>` : productos.map(p => `<button type="button" class="dm-producto" onclick="dmIrProducto(${p.id})">${miniatura(p.imagenUrl)}<span class="dm-fila-texto"><b>${esc(p.nombre)}</b><small>${esc(p.codigo || "")} · ${p.exhibido ? "Exhibido" : "Bodega"}</small></span><span class="dm-cantidad">${numero(p.stock)}</span>${icono("siguiente", 18)}</button>`).join("") || `<p class="dm-nota">Todavía no hay productos aquí. Toca "Poner producto".</p>`}
            </section>
            <div class="dm-enlaces"><button type="button" onclick="dmRenombrar(${l.id})">${icono("editar", 16)} Cambiar nombre</button><button type="button" class="dm-rojo" onclick="dmBorrar(${l.id})">${icono("borrar", 16)} Borrar lugar</button></div>`
        });
    }

    window.dmAlternarBuscar = function () {
        const e = actual();
        e.buscando = !e.buscando;
        pintar();
        if (e.buscando) setTimeout(() => document.getElementById("dmBuscarProd")?.focus(), 60);
    };

    window.dmBuscarProducto = async function (texto) {
        const caja = document.getElementById("dmResultados");
        const hallados = typeof buscarEnCatalogoLocal === "function" && String(texto).trim().length >= 2 ? await buscarEnCatalogoLocal(texto) : [];

        caja.innerHTML = hallados.map(p => `<button type="button" class="dm-producto" onclick="dmPoner(${p.id})">${miniatura(p.imagenUrl, 44)}<span class="dm-fila-texto"><b>${esc(p.nombre)}</b><small>${esc(p.ubicacion || "Sin lugar")}</small></span><span class="dm-boton-chico">Poner aquí</span></button>`).join("");
    };

    window.dmPoner = async function (productoId) {
        const e = actual();
        const l = lugarPorId(e.id);
        const r = await llamar(`/ubicaciones/${e.id}/asignar`, { method: "POST", body: { productoIds: [productoId] } });

        if (!r.ok) { aviso(r.datos.error || "No se pudo poner el producto.", "error"); return; }

        if (l.zona === "bodega") {
            const d = await dialogo({ titulo: "¿Cuántas piezas hay aquí?", texto: "Cantidad de este producto en esta sección de bodega.", campo: { tipo: "number", valor: "0" }, aceptar: "Anotar" });

            if (d.ok && Number(d.valor) >= 0) {
                const g = await llamar(`/ubicaciones/${e.id}/bodega`, { method: "POST", body: { productoId, cantidad: Number(d.valor) } });
                if (!g.ok) aviso(g.datos.error || "No se pudo anotar la cantidad.", "error");
            }
        }

        if (typeof refrescarCatalogoLocalDueno === "function") refrescarCatalogoLocalDueno().catch(() => {});
        e.buscando = false;
        aviso("Producto puesto en " + l.nombre);
        await Promise.all([cargarLugar(e), cargarGeneral()]);
    };

    window.dmRenombrar = async function (id) {
        const l = lugarPorId(id);
        const d = await dialogo({ titulo: "Cambiar nombre", texto: "El código del lugar no cambia, así que su etiqueta sigue sirviendo.", campo: { valor: l.nombre }, aceptar: "Guardar" });

        if (!d.ok || !d.valor.trim() || d.valor.trim() === l.nombre) return;

        const r = await llamar(`/ubicaciones/${id}`, { method: "PATCH", body: { nombre: d.valor.trim() } });

        if (!r.ok) { aviso(r.datos.error || "No se pudo cambiar.", "error"); return; }

        await cargarGeneral();
        pintar();
    };

    window.dmBorrar = async function (id) {
        const l = lugarPorId(id);
        let r = await llamar(`/ubicaciones/${id}`, { method: "DELETE" });

        if (!r.ok && r.estado === 409) {
            const d = await dialogo({ titulo: `¿Borrar ${l.nombre}?`, texto: `${r.datos.error || "Este lugar tiene productos."} Los productos NO se borran, solo se quedan sin este lugar.`, aceptar: "Borrar", peligro: true });

            if (!d.ok) return;

            r = await llamar(`/ubicaciones/${id}?confirmar=1`, { method: "DELETE" });
        }

        if (!r.ok) { aviso(r.datos.error || "No se pudo borrar.", "error"); return; }

        await cargarGeneral();
        aviso("Lugar borrado");
        window.dmAtras();
    };

    // ---- Alta de un lugar ----

    window.dmNuevo = function (zona, padreId = null) { ir({ t: "nuevo", zona, tipo: zona === "bodega" ? (padreId ? "rack" : "seccion") : (padreId ? "estante" : "pasillo"), padreId }); };

    function pintarNuevo(e) {
        const tipos = e.zona === "bodega" ? TIPOS_BODEGA : TIPOS_TIENDA;
        const posibles = lugares.filter(l => l.zona === e.zona);

        return pantalla({
            titulo: e.zona === "bodega" ? "Nuevo lugar de bodega" : "Nuevo lugar de tienda",
            cuerpo: `
            <label class="dm-campo">Qué es<select id="dmTipo" class="dm-input" onchange="dmTipoElegido(this.value)">${tipos.map(([v, t]) => `<option value="${v}" ${e.tipo === v ? "selected" : ""}>${t}</option>`).join("")}</select></label>
            <label class="dm-campo">Nombre<input id="dmNombre" class="dm-input" type="text" maxlength="60" placeholder="Ej. Tornillos y pijas" autocomplete="off"></label>
            <label class="dm-campo">Dentro de<select id="dmPadre" class="dm-input"><option value="">Nada, va solo</option>${posibles.map(l => `<option value="${l.id}" ${e.padreId === l.id ? "selected" : ""}>${esc(l.codigo)} · ${esc(l.nombre)}</option>`).join("")}</select></label>
            <p class="dm-nota">El código se genera solo (por ejemplo P-01 o P-01-E-03) y es el que lleva la etiqueta.</p>
            <p id="dmError" class="dm-error"></p>`,
            pie: `<button type="button" class="dm-grande" onclick="dmGuardarNuevo()">Guardar lugar</button>`
        });
    }

    window.dmTipoElegido = function (tipo) { actual().tipo = tipo; };

    window.dmGuardarNuevo = async function () {
        const e = actual();
        const nombre = document.getElementById("dmNombre").value.trim();
        const error = document.getElementById("dmError");

        if (!nombre) { error.textContent = "Escribe un nombre."; return; }

        const padre = document.getElementById("dmPadre").value;
        const r = await llamar("/ubicaciones", { method: "POST", body: { nombre, zona: e.zona, tipo: e.tipo, padreId: padre ? Number(padre) : null } });

        if (!r.ok) { error.textContent = r.datos.error || "No se pudo guardar."; return; }

        await cargarGeneral();
        aviso(`${nombre} creado (${r.datos.ubicacion.codigo})`);
        window.dmAtras();
    };

    // ---- Ficha de producto ----

    window.dmIrProducto = function (id) {
        const entrada = { t: "producto", id, datos: null };
        ir(entrada);

        llamar(`/ubicaciones/producto/${id}`).then(r => {
            entrada.datos = r.ok ? r.datos.producto : false;
            if (actual() === entrada) pintar();
        });
    };

    function pintarProducto(e) {
        const p = e.datos;

        if (p === null) return pantalla({ titulo: "Producto", cuerpo: `<p class="dm-nota">Cargando…</p>` });
        if (!p) return pantalla({ titulo: "Producto", cuerpo: `<p class="dm-nota">No se pudo cargar este producto.</p>` });

        const fila = (nombre, valor) => valor || valor === 0 ? `<div class="dm-spec"><span>${nombre}</span><b>${esc(valor)}</b></div>` : "";
        const estado = p.total <= 0 ? ["Agotado", "rojo"] : p.exhibicion <= 0 && p.bodega > 0 ? ["Resurtir del estante", "ambar"] : p.stockMinimo && p.total <= p.stockMinimo ? ["Stock bajo", "ambar"] : ["En existencia", "verde"];
        const pct = p.total > 0 ? Math.round((p.exhibicion / p.total) * 100) : 0;

        return pantalla({
            titulo: p.nombre.length > 26 ? p.nombre.slice(0, 26) + "…" : p.nombre,
            subtitulo: p.marca || p.categoria,
            cuerpo: `
            <div class="dm-ficha-foto">${miniatura(p.imagenUrl, 120)}<div><b class="dm-ficha-nombre">${esc(p.nombre)}</b><span class="dm-etiqueta dm-${estado[1]}">${estado[0]}</span></div></div>
            <div class="dm-cifras">
                <div><strong>${numero(p.exhibicion)}</strong><span>En estante</span></div>
                <div><strong>${numero(p.bodega)}</strong><span>En bodega</span></div>
                <div class="dm-total"><strong>${numero(p.total)}</strong><span>Total</span></div>
            </div>
            <div class="dm-barra" title="Parte del total que está en el estante"><i style="width:${pct}%"></i></div>
            <section class="dm-seccion"><div class="dm-seccion-cab"><h3>Dónde está</h3></div>
                ${p.estante ? `<button type="button" class="dm-fila" onclick="dmIrLugar(${p.estante.id})"><span class="dm-icono-caja dm-tienda">${icono("estante", 20)}</span><span class="dm-fila-texto"><b>${esc(p.estante.ruta)}</b><small>Estante</small></span>${icono("siguiente", 18)}</button>` : ""}
                ${p.bodegas.map(b => `<button type="button" class="dm-fila" onclick="dmIrLugar(${b.id})"><span class="dm-icono-caja dm-bodega">${icono("seccion", 20)}</span><span class="dm-fila-texto"><b>${esc(b.ruta)}</b><small>Bodega · ${numero(b.cantidad)} piezas</small></span>${icono("siguiente", 18)}</button>`).join("")}
                ${!p.estante && !p.bodegas.length ? `<p class="dm-nota">Todavía no tiene lugar asignado.</p>` : ""}
            </section>
            <section class="dm-seccion"><div class="dm-seccion-cab"><h3>Especificaciones</h3></div><div class="dm-specs">
                ${fila("Código", p.codigo)}${fila("Marca", p.marca)}${fila("Categoría", [p.categoria, p.subcategoria].filter(Boolean).join(" › "))}
                ${fila("Se vende por", p.unidadVenta)}${fila("Se compra por", p.presentacionCompra ? p.presentacionCompra.toLowerCase() + (p.factorConversion ? ` de ${p.factorConversion}` : "") : "")}
                ${fila("Precio", dinero2(p.precio))}${p.precioMayoreo ? fila("Mayoreo", dinero2(p.precioMayoreo)) : ""}${fila("Stock mínimo", p.stockMinimo || "")}
                ${p.basculaDigital ? fila("Báscula", "Se pesa") : ""}
            </div></section>`
        });
    }

    // ---- Resurtir ----

    window.dmIrResurtir = async function () {
        const entrada = { t: "resurtir", lista: null };
        ir(entrada);

        const r = await llamar("/resurtir");
        entrada.lista = r.ok ? r.datos.productos || [] : [];
        if (actual() === entrada) pintar();
    };

    function pintarResurtir(e) {
        const lista = e.lista;

        return pantalla({
            titulo: "Resurtir de bodega",
            subtitulo: lista ? `${lista.length} por pasar al estante` : "",
            cuerpo: lista === null ? `<p class="dm-nota">Cargando…</p>` : lista.map(p => `<article class="dm-tarjeta dm-${p.estado}">
                <div class="dm-tarjeta-cab">${miniatura(p.imagenUrl)}<div><b>${esc(p.nombre)}</b><small>${p.estado === "agotado" ? "Se acabó en el estante" : "Queda poco en el estante"}${p.estante ? " · va en " + esc(p.estante.replace("Tienda › ", "")) : ""}</small></div></div>
                <div class="dm-cifras dm-chicas"><div><strong>${numero(p.exhibicion)}</strong><span>Estante</span></div><div><strong>${numero(p.bodega)}</strong><span>Bodega</span></div></div>
                ${p.lugaresBodega.map(l => `<div class="dm-pasar"><span>${esc(l.ruta)}<small>${numero(l.cantidad)} disponibles</small></span><input class="dm-input dm-num" type="number" inputmode="decimal" min="0" max="${l.cantidad}" value="${l.cantidad}" id="dmP${p.productoId}_${l.ubicacionId}"><button type="button" class="dm-boton-chico" onclick="dmPasar(${p.productoId}, ${l.ubicacionId})">Pasar</button></div>`).join("")}
            </article>`).join("") || `<div class="dm-vacio-grande">${icono("ok", 40)}<b>Todo al día</b><span>Lo que tienes en bodega todavía se ve en el estante.</span></div>`
        });
    }

    window.dmPasar = async function (productoId, desdeId) {
        const cantidad = Number(document.getElementById(`dmP${productoId}_${desdeId}`)?.value);

        if (!(cantidad > 0)) { aviso("Escribe cuántas piezas pasas al estante.", "error"); return; }

        const r = await llamar("/resurtir", { method: "POST", body: { productoId, desdeId, cantidad } });

        if (!r.ok) { aviso(r.datos.error || "No se pudo pasar.", "error"); return; }

        aviso(`${cantidad} pieza(s) pasadas al estante`);
        pila.pop();
        window.dmIrResurtir();
        cargarGeneral();
    };

    // ---- ¿Donde esta? ----

    window.dmIrBuscar = function () { ir({ t: "buscar", texto: "", productos: [] }); setTimeout(() => document.getElementById("dmQ")?.focus(), 80); };

    function listaDonde(e) {
        return e.productos.map(p => `<button type="button" class="dm-producto dm-grande-fila" onclick="dmIrProducto(${p.id})">${miniatura(p.imagenUrl, 56)}<span class="dm-fila-texto"><b>${esc(p.nombre)}</b><small class="dm-donde">${icono("lugar", 13)} ${esc(p.ubicacion || "Sin lugar asignado")}</small><small>Estante ${numero(p.exhibicion)} · Bodega ${numero(p.bodega)} · Total ${numero(p.total)}</small></span>${icono("siguiente", 18)}</button>`).join("")
            || (e.texto.length >= 2 ? `<p class="dm-nota">No encontré ese producto.</p>` : `<p class="dm-nota">Escribe el nombre o escanea el código para saber dónde está y cuánto hay.</p>`);
    }

    function pintarBusqueda(e) {
        return pantalla({
            titulo: "¿Dónde está?",
            cuerpo: `<div class="dm-buscador">${icono("buscar", 20)}<input id="dmQ" type="search" placeholder="Nombre o código del producto" oninput="dmBuscarDonde(this.value)" autocomplete="off" value="${esc(e.texto)}"><button type="button" onclick="dmBuscarEscaneando()" aria-label="Escanear">${icono("escanear", 22)}</button></div><div id="dmDonde" class="dm-lista">${listaDonde(e)}</div>`
        });
    }

    let temporizadorBusqueda = null;

    window.dmBuscarDonde = function (texto) {
        const e = actual();
        e.texto = texto.trim();
        clearTimeout(temporizadorBusqueda);
        temporizadorBusqueda = setTimeout(async () => {
            const r = e.texto.length >= 2 ? await llamar(`/ubicaciones/buscar?q=${encodeURIComponent(e.texto)}`) : { ok: true, datos: { productos: [] } };
            e.productos = r.ok ? r.datos.productos || [] : [];
            const caja = document.getElementById("dmDonde");
            if (caja && actual() === e) caja.innerHTML = listaDonde(e);
        }, 300);
    };

    window.dmBuscarEscaneando = function () {
        escanear({ titulo: "Escanea el producto", alCodigo: codigo => { const e = actual(); e.texto = String(codigo).trim(); pintar(); window.dmBuscarDonde(e.texto); } });
    };

    // ---- Escaner ----

    function escanear(opciones) {
        if (typeof abrirEscanerCodigoDueno !== "function") { aviso("El escáner no está disponible en este equipo.", "error"); return; }
        abrirEscanerCodigoDueno(opciones);
    }

    // Vibra al leer un codigo (donde el celular lo permite).
    const procesarOriginal = window.procesarCodigoEscaneadoDueno;

    if (typeof procesarOriginal === "function") {
        window.procesarCodigoEscaneadoDueno = function (...argumentos) {
            try { navigator.vibrate?.(45); } catch (error) { /* sin vibracion */ }
            return procesarOriginal.apply(this, argumentos);
        };
    }

    async function lugarDeCodigo(codigo) {
        const r = await llamar(`/ubicaciones/codigo/${encodeURIComponent(String(codigo).trim())}`);

        if (!r.ok) { aviso("Ese código no es de ningún lugar de tu tienda.", "error"); return null; }

        return r.datos.ubicacion;
    }

    window.dmEscanear = function () {
        escanear({
            titulo: "Escanea la etiqueta del lugar",
            alCodigo: async codigo => { const u = await lugarDeCodigo(codigo); if (u) { await cargarGeneral(); window.dmIrLugar(u.id); } }
        });
    };

    window.dmContarEscaneando = function () {
        escanear({
            titulo: "Escanea el lugar que vas a contar",
            alCodigo: async codigo => { const u = await lugarDeCodigo(codigo); if (u) { await cargarGeneral(); window.dmContar(u.id); } }
        });
    };

    // ---- Conteo de un estante o seccion ----

    window.dmContar = async function (lugarId) {
        const r = await llamar(`/ubicaciones/${lugarId}/productos`);
        const productos = r.ok ? r.datos.productos || [] : [];

        ir({ t: "conteo", lugarId, productos, valores: {}, resultado: null, noEscaneados: false });
    };

    function pintarConteo(e) {
        const l = lugarPorId(e.lugarId);

        if (e.resultado) {
            const r = e.resultado;

            return pantalla({
                titulo: "Resultado del conteo",
                subtitulo: l?.nombre,
                cuerpo: `
                <div class="dm-resultado"><div class="dm-falta"><strong>${numero(r.faltan)}</strong><span>faltan</span></div><div class="dm-sobra"><strong>${numero(r.sobran)}</strong><span>sobran</span></div></div>
                <div class="dm-lista">${r.lineas.map(x => { const p = e.productos.find(q => q.id === x.productoId); return `<div class="dm-producto">${miniatura(p?.imagenUrl, 44)}<span class="dm-fila-texto"><b>${esc(x.nombre)}</b><small>${x.noEscaneado && !e.noEscaneados ? "No lo contaste (no cambia)" : `Esperado ${numero(x.esperado)} · contaste ${numero(x.contado)}`}</small></span><em class="dm-dif ${x.diferencia < 0 ? "neg" : x.diferencia > 0 ? "pos" : ""}">${x.diferencia > 0 ? "+" : ""}${numero(x.diferencia)}</em></div>`; }).join("")}</div>
                <label class="dm-check"><input type="checkbox" ${e.noEscaneados ? "checked" : ""} onchange="dmConteoNoEscaneados(this.checked)"><span>Lo que no conté es que ya no hay (contarlo como 0)</span></label>`,
                pie: `<button type="button" class="dm-secundario" onclick="dmConteoSeguir()">Seguir contando</button><button type="button" class="dm-grande" onclick="dmConteoAplicar()">Aplicar ajuste</button>`
            });
        }

        const contados = Object.keys(e.valores).length;

        return pantalla({
            titulo: "Contar",
            subtitulo: l ? `${l.nombre} · ${contados} de ${e.productos.length} contados` : "",
            chip: l?.codigo,
            cuerpo: `
            <button type="button" class="dm-escanear dm-chico" onclick="dmConteoEscanear()"><span class="dm-escanear-icono">${icono("escanear", 24)}</span><span><b>Contar escaneando</b><small>Cada lectura suma una pieza</small></span></button>
            <div class="dm-lista">${e.productos.map(p => `<div class="dm-producto dm-conteo-fila ${e.valores[p.id] !== undefined ? "listo" : ""}">${miniatura(p.imagenUrl, 48)}<span class="dm-fila-texto"><b>${esc(p.nombre)}</b><small>${esc(p.codigo || "")}</small></span>
                <span class="dm-paso"><button type="button" onclick="dmConteoPaso(${p.id}, -1)" aria-label="Menos">${icono("menos", 18)}</button><input class="dm-cant" type="number" inputmode="decimal" min="0" data-id="${p.id}" value="${e.valores[p.id] ?? ""}" oninput="dmConteoValor(${p.id}, this.value)" placeholder="—"><button type="button" onclick="dmConteoPaso(${p.id}, 1)" aria-label="Más">${icono("mas", 18)}</button></span></div>`).join("") || `<p class="dm-nota">Este lugar no tiene productos. Agrégalos desde su pantalla.</p>`}</div>`,
            pie: `<button type="button" class="dm-grande" onclick="dmConteoVer()">Ver diferencias</button>`
        });
    }

    function marcarConteo(id) {
        const e = actual();
        const campo = document.querySelector(`.dm-cant[data-id="${id}"]`);

        if (campo) { campo.value = e.valores[id] ?? ""; campo.closest(".dm-conteo-fila")?.classList.toggle("listo", e.valores[id] !== undefined); }

        const l = lugarPorId(e.lugarId);
        const sub = document.querySelector(".dm-titulo-caja small");
        if (sub && l) sub.textContent = `${l.nombre} · ${Object.keys(e.valores).length} de ${e.productos.length} contados`;
    }

    window.dmConteoValor = function (id, valor) {
        const e = actual();
        if (valor === "") delete e.valores[id]; else e.valores[id] = Number(valor);
        marcarConteo(id);
    };

    window.dmConteoPaso = function (id, paso) {
        const e = actual();
        e.valores[id] = Math.max(0, (e.valores[id] || 0) + paso);
        marcarConteo(id);
    };

    // Cada escaneo suma una pieza al producto del lugar con ese codigo.
    window.dmConteoEscanear = function () {
        const e = actual();

        escanear({
            titulo: "Escanea cada pieza",
            continuo: true,
            alCodigo: codigo => {
                const p = e.productos.find(x => String(x.codigo) === String(codigo).trim());
                const estado = document.getElementById("duenoEscanerCodigoEstado");

                if (!p) { if (estado) estado.textContent = `✕ ${codigo}: no es de este lugar`; return; }

                e.valores[p.id] = (e.valores[p.id] || 0) + 1;
                if (estado) estado.textContent = `✓ ${p.nombre} · llevas ${e.valores[p.id]}`;
            }
        });

        // Al cerrar el escaner se repinta con lo contado.
        const cerrar = window.cerrarEscanerCodigoDueno;
        window.cerrarEscanerCodigoDueno = function (...a) { window.cerrarEscanerCodigoDueno = cerrar; const r = cerrar.apply(this, a); if (actual() === e) pintar(); return r; };
    };

    async function consultarConteo(aplicar) {
        const e = actual();
        const conteos = Object.entries(e.valores).map(([productoId, cantidad]) => ({ productoId: Number(productoId), cantidad }));

        return llamar(`/ubicaciones/${e.lugarId}/conteo`, { method: "POST", body: { conteos, aplicar, incluirNoEscaneados: e.noEscaneados } });
    }

    window.dmConteoVer = async function () {
        const e = actual();

        if (!Object.keys(e.valores).length) {
            const d = await dialogo({ titulo: "No contaste nada", texto: "¿Ver el resultado de todos modos?", aceptar: "Ver" });
            if (!d.ok) return;
        }

        const r = await consultarConteo(false);

        if (!r.ok) { aviso(r.datos.error || "No se pudo calcular.", "error"); return; }

        e.resultado = r.datos;
        pintar();
    };

    window.dmConteoNoEscaneados = async function (valor) { actual().noEscaneados = valor; await window.dmConteoVer(); };
    window.dmConteoSeguir = function () { actual().resultado = null; pintar(); };

    window.dmConteoAplicar = async function () {
        const d = await dialogo({ titulo: "¿Aplicar el ajuste?", texto: "Cambia las existencias de estos productos y queda registrado quién lo hizo.", aceptar: "Aplicar" });

        if (!d.ok) return;

        const r = await consultarConteo(true);

        if (!r.ok) { aviso(r.datos.error || "No se pudo aplicar.", "error"); return; }

        if (typeof refrescarCatalogoLocalDueno === "function") refrescarCatalogoLocalDueno().catch(() => {});
        aviso(`Listo: ${r.datos.ajustados} producto(s) ajustados`);
        await cargarGeneral();
        window.dmAtras();
    };

    // ---- Etiquetas con QR (PDF) ----

    window.dmImprimir = async function (id = null) {
        const r = await llamar("/ubicaciones/etiquetas", { method: "POST", body: id ? { ids: [id] } : {} });

        if (!r.ok) { aviso(r.datos.error || "No se pudo preparar la hoja.", "error"); return; }

        const bytes = Uint8Array.from(atob(r.datos.pdfBase64), ch => ch.charCodeAt(0));
        const url = URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));

        window.open(url, "_blank") || (location.href = url);
        setTimeout(() => URL.revokeObjectURL(url), 120000);
    };
})();
