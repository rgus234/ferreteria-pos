// Mapa de la tienda en la computadora: los mismos pasillos, estantes y bodega que se usan en el celular (mismas rutas del servidor, mismos datos).
// Lugares (con sus productos), ¿Donde esta?, Resurtir de bodega y los Conteos que se hacen en el celular para aprobarlos o rechazarlos aqui.
// Es una funcion nueva: solo aparece en el menu si el dueño la enciende en Nexo -> Funciones nuevas (funcionBeta("mapa_tienda")).
(function () {
    const mt = { tab: "lugares", lugares: [], resumen: null, elegido: null, productosLugar: [], busqueda: [], resurtir: null, conteos: null, conteo: null, cargando: false };

    const esc = valor => String(valor ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
    const numero = valor => Number(valor || 0).toLocaleString("es-MX", { maximumFractionDigits: 3 });
    const pantalla = () => document.getElementById("pantallaMapaTienda");
    const aviso = (mensaje, tipo) => { if (typeof mostrarToastPOS === "function") mostrarToastPOS(mensaje, tipo ? { tipo } : undefined); };

    async function llamar(ruta, opciones = {}) {
        const respuesta = await fetch(ruta, { ...opciones, headers: { "Content-Type": "application/json", ...(opciones.headers || {}) } });
        const datos = await respuesta.json().catch(() => ({}));
        return { ok: respuesta.ok && datos.ok !== false, datos };
    }

    const hijosDe = id => mt.lugares.filter(l => (l.padreId || null) === id);
    const lugarPorId = id => mt.lugares.find(l => l.id === id) || null;
    const totalProductos = l => (l.productos || 0) + hijosDe(l.id).reduce((s, h) => s + totalProductos(h), 0);

    // ---------- carga ----------

    async function cargarGeneral() {
        const [u, r] = await Promise.all([llamar("/ubicaciones"), llamar("/ubicaciones/resumen")]);
        mt.lugares = u.ok ? u.datos.ubicaciones || [] : [];
        mt.resumen = r.ok ? r.datos : null;
        if (mt.elegido && !lugarPorId(mt.elegido)) mt.elegido = null;
    }

    async function cargarProductosLugar() {
        mt.productosLugar = [];
        if (!mt.elegido) return;
        const r = await llamar(`/ubicaciones/${mt.elegido}/productos`);
        mt.productosLugar = r.ok ? r.datos.productos || [] : [];
    }

    window.mostrarMapaTienda = async function () {
        if (typeof ocultarPantallasPrincipales === "function") ocultarPantallasPrincipales();
        const p = pantalla();
        if (!p) return;
        p.style.display = "block";
        if (typeof actualizarTopbarContexto === "function") actualizarTopbarContexto("Mapa de la tienda", "Pasillos, estantes y bodega", "mapa-tienda");

        p.innerHTML = `<div class="mt-shell"><div class="mt-vacio">Cargando el mapa…</div></div>`;
        await cargarGeneral();
        pintar();
    };

    // ---------- pintado ----------

    function kpi(valor, texto, alerta) { return `<div class="mt-kpi${alerta ? " alerta" : ""}"><strong>${numero(valor)}</strong><span>${esc(texto)}</span></div>`; }

    function pintar() {
        const p = pantalla();
        if (!p) return;
        const r = mt.resumen || {};
        const pestana = (clave, texto, n) => `<button type="button" class="mt-tab${mt.tab === clave ? " activa" : ""}" onclick="mtTab('${clave}')">${esc(texto)}${n ? `<em>${n}</em>` : ""}</button>`;

        p.innerHTML = `<div class="mt-shell">
            <header class="mt-cab"><div><h2>Mapa de la tienda</h2><p>Lo mismo que ves en el celular: dónde está cada producto, qué resurtir y los conteos por aprobar.</p></div></header>
            <div class="mt-kpis">${kpi(r.ubicaciones, "lugares")}${kpi(r.productosConLugar, "productos con lugar")}${kpi(r.productosSinLugar, "sin lugar", r.productosSinLugar > 0)}${kpi(r.porResurtir, "por resurtir", r.porResurtir > 0)}${kpi(r.conteosPendientes, "conteos por revisar", r.conteosPendientes > 0)}</div>
            <nav class="mt-tabs">${pestana("lugares", "Lugares")}${pestana("donde", "¿Dónde está?")}${pestana("resurtir", "Resurtir", r.porResurtir)}${pestana("conteos", "Conteos", r.conteosPendientes)}</nav>
            <div class="mt-cuerpo" id="mtCuerpo">${cuerpo()}</div>
        </div>`;
    }

    function cuerpo() {
        if (mt.tab === "donde") return htmlDonde();
        if (mt.tab === "resurtir") return htmlResurtir();
        if (mt.tab === "conteos") return htmlConteos();
        return htmlLugares();
    }

    function repintarCuerpo() { const c = document.getElementById("mtCuerpo"); if (c) c.innerHTML = cuerpo(); }

    window.mtTab = async function (clave) {
        mt.tab = clave;
        mt.conteo = null;
        pintar();

        if (clave === "resurtir" && mt.resurtir === null) { const r = await llamar("/resurtir"); mt.resurtir = r.ok ? r.datos.productos || [] : []; repintarCuerpo(); }
        if (clave === "conteos" && mt.conteos === null) { const r = await llamar("/conteos"); mt.conteos = r.ok ? r.datos.conteos || [] : []; repintarCuerpo(); }
        if (clave === "resurtir") { const r = await llamar("/resurtir"); mt.resurtir = r.ok ? r.datos.productos || [] : mt.resurtir; repintarCuerpo(); }
        if (clave === "conteos") { const r = await llamar("/conteos"); mt.conteos = r.ok ? r.datos.conteos || [] : mt.conteos; repintarCuerpo(); }
    };

    // ---------- Lugares ----------

    function arbol(zona) {
        const raices = hijosDe(null).filter(l => l.zona === zona);
        const fila = (l, nivel) => `<button type="button" class="mt-lugar${mt.elegido === l.id ? " activo" : ""}" style="--nivel:${nivel}" onclick="mtElegir(${l.id})">
                <span class="mt-lugar-nombre">${esc(l.nombre)}</span><span class="mt-lugar-cuenta">${numero(totalProductos(l))}</span></button>${hijosDe(l.id).map(h => fila(h, nivel + 1)).join("")}`;
        return raices.map(l => fila(l, 0)).join("") || `<p class="mt-nota">Sin lugares en esta zona.</p>`;
    }

    function htmlLugares() {
        if (!mt.lugares.length) {
            return `<div class="mt-vacio-grande"><h3>Todavía no tienes lugares</h3><p>Crea los pasillos y estantes de tu tienda de un toque con una plantilla (después los ajustas) o créalos uno por uno.</p>
                <div class="mt-acciones"><button type="button" class="mt-btn principal" onclick="mtPlantilla('ferreteria')">Plantilla ferretería</button><button type="button" class="mt-btn" onclick="mtPlantilla('abarrotes')">Plantilla abarrotes</button></div>
                ${formNuevo()}</div>`;
        }

        return `<div class="mt-dos">
            <aside class="mt-arbol"><h4>Tienda</h4>${arbol("tienda")}<h4>Bodega</h4>${arbol("bodega")}</aside>
            <section class="mt-detalle">${htmlDetalle()}</section>
        </div>`;
    }

    function formNuevo() {
        const padre = mt.elegido ? lugarPorId(mt.elegido) : null;
        return `<form class="mt-nuevo" onsubmit="return mtCrear(event)">
            <b>${padre ? `Nuevo lugar dentro de “${esc(padre.nombre)}”` : "Nuevo lugar"}</b>
            <input id="mtNombre" type="text" placeholder="Ej. Pasillo 1 o Estante 2" maxlength="80" required>
            <select id="mtTipo"><option value="estante">Estante</option><option value="pasillo">Pasillo</option><option value="nivel">Nivel</option><option value="seccion">Sección</option><option value="rack">Rack</option></select>
            ${padre ? "" : `<select id="mtZona"><option value="tienda">Tienda</option><option value="bodega">Bodega</option></select>`}
            <button type="submit" class="mt-btn principal">Crear</button></form>`;
    }

    function htmlDetalle() {
        const l = mt.elegido ? lugarPorId(mt.elegido) : null;
        if (!l) return `${formNuevo()}<p class="mt-nota">Elige un lugar de la izquierda para ver sus productos.</p>`;

        const filas = mt.productosLugar.map(p => `<tr><td><b>${esc(p.nombre)}</b><small>${esc(p.codigo || "")}</small></td><td>${esc(p.exhibido ? "Exhibición" : p.enBodega ? "Bodega" : "")}</td><td class="num">${numero(p.stock)}</td></tr>`).join("");

        return `<div class="mt-detalle-cab"><div><h3>${esc(l.nombre)}</h3><small>${esc(l.ruta || "")} · código ${esc(l.codigo || "")}</small></div>
                <div class="mt-acciones"><button type="button" class="mt-btn" onclick="mtRenombrar()">Renombrar</button><button type="button" class="mt-btn peligro" onclick="mtEliminar()">Eliminar</button></div></div>
            ${formNuevo()}
            <div class="mt-poner"><b>Poner productos aquí</b><input id="mtBuscarPoner" type="search" placeholder="Busca por nombre o código…" oninput="mtBuscarPoner(this.value)"><div id="mtResultadosPoner" class="mt-resultados"></div></div>
            <h4>Productos en este lugar (${mt.productosLugar.length})</h4>
            ${filas ? `<table class="mt-tabla"><thead><tr><th>Producto</th><th>Dónde</th><th class="num">Existencia</th></tr></thead><tbody>${filas}</tbody></table>` : `<p class="mt-nota">Todavía no hay productos aquí.</p>`}`;
    }

    window.mtElegir = async function (id) { mt.elegido = id; await cargarProductosLugar(); repintarCuerpo(); };

    window.mtPlantilla = async function (tipo) {
        const r = await llamar("/ubicaciones/plantilla", { method: "POST", body: JSON.stringify({ tipo }) });
        if (!r.ok) { aviso(r.datos.error || "No se pudo crear la plantilla.", "error"); return; }
        aviso("Lugares creados.");
        await cargarGeneral();
        pintar();
    };

    window.mtCrear = async function (evento) {
        evento.preventDefault();
        const padre = mt.elegido ? lugarPorId(mt.elegido) : null;
        const cuerpoPeticion = { nombre: document.getElementById("mtNombre").value, tipo: document.getElementById("mtTipo").value, zona: padre ? padre.zona : document.getElementById("mtZona")?.value || "tienda", padreId: padre ? padre.id : null };
        const r = await llamar("/ubicaciones", { method: "POST", body: JSON.stringify(cuerpoPeticion) });
        if (!r.ok) { aviso(r.datos.error || "No se pudo crear el lugar.", "error"); return false; }
        aviso("Lugar creado.");
        await cargarGeneral();
        pintar();
        return false;
    };

    window.mtRenombrar = async function () {
        const l = lugarPorId(mt.elegido);
        const nombre = l && window.prompt("Nuevo nombre del lugar", l.nombre);
        if (!nombre || !nombre.trim()) return;
        const r = await llamar(`/ubicaciones/${l.id}`, { method: "PATCH", body: JSON.stringify({ nombre: nombre.trim() }) });
        if (!r.ok) { aviso(r.datos.error || "No se pudo renombrar.", "error"); return; }
        await cargarGeneral();
        pintar();
    };

    window.mtEliminar = async function () {
        const l = lugarPorId(mt.elegido);
        if (!l || !window.confirm(`¿Eliminar “${l.nombre}”? Los productos que tenía quedan sin lugar (no se borran).`)) return;
        const r = await llamar(`/ubicaciones/${l.id}`, { method: "DELETE" });
        if (!r.ok) { aviso(r.datos.error || "No se pudo eliminar.", "error"); return; }
        mt.elegido = null;
        await cargarGeneral();
        pintar();
    };

    let temporizadorPoner = null;
    window.mtBuscarPoner = function (texto) {
        clearTimeout(temporizadorPoner);
        temporizadorPoner = setTimeout(async () => {
            const caja = document.getElementById("mtResultadosPoner");
            if (!caja) return;
            if (String(texto || "").trim().length < 2) { caja.innerHTML = ""; return; }
            const r = await llamar(`/ubicaciones/buscar?q=${encodeURIComponent(texto)}`);
            const lista = r.ok ? r.datos.productos || [] : [];
            caja.innerHTML = lista.map(p => `<div class="mt-resultado"><span><b>${esc(p.nombre)}</b><small>${esc(p.codigo || "")} · ${esc(p.ubicacion || "sin lugar")}</small></span><button type="button" class="mt-btn" onclick="mtPoner(${p.id})">Poner aquí</button></div>`).join("") || `<p class="mt-nota">No encontré nada.</p>`;
        }, 250);
    };

    window.mtPoner = async function (productoId) {
        const r = await llamar(`/ubicaciones/${mt.elegido}/asignar`, { method: "POST", body: JSON.stringify({ productoIds: [productoId] }) });
        if (!r.ok) { aviso(r.datos.error || "No se pudo poner el producto.", "error"); return; }
        aviso("Producto acomodado.");
        await cargarGeneral();
        await cargarProductosLugar();
        pintar();
    };

    // ---------- ¿Donde esta? ----------

    function htmlDonde() {
        const filas = mt.busqueda.map(p => `<tr><td><b>${esc(p.nombre)}</b><small>${esc(p.codigo || "")}</small></td><td>${esc(p.ubicacion || "Sin lugar")}</td><td class="num">${numero(p.exhibicion)}</td><td class="num">${numero(p.bodega)}</td><td class="num"><b>${numero(p.total)}</b></td></tr>`).join("");
        return `<input id="mtBuscarDonde" class="mt-buscador" type="search" placeholder="¿Qué producto buscas? Nombre o código…" oninput="mtBuscarDonde(this.value)" value="">
            ${filas ? `<table class="mt-tabla"><thead><tr><th>Producto</th><th>Lugar</th><th class="num">En estante</th><th class="num">En bodega</th><th class="num">Total</th></tr></thead><tbody>${filas}</tbody></table>` : `<p class="mt-nota">Escribe al menos 2 letras.</p>`}`;
    }

    let temporizadorDonde = null;
    window.mtBuscarDonde = function (texto) {
        clearTimeout(temporizadorDonde);
        temporizadorDonde = setTimeout(async () => {
            if (String(texto || "").trim().length < 2) { mt.busqueda = []; } else { const r = await llamar(`/ubicaciones/buscar?q=${encodeURIComponent(texto)}`); mt.busqueda = r.ok ? r.datos.productos || [] : []; }
            const cuerpoEl = document.getElementById("mtCuerpo");
            if (cuerpoEl) { cuerpoEl.innerHTML = htmlDonde(); const caja = document.getElementById("mtBuscarDonde"); if (caja) { caja.value = texto; caja.focus(); } }
        }, 250);
    };

    // ---------- Resurtir ----------

    function htmlResurtir() {
        if (mt.resurtir === null) return `<div class="mt-vacio">Cargando…</div>`;
        if (!mt.resurtir.length) return `<div class="mt-vacio-grande"><h3>Todo al día</h3><p>Lo que tienes en bodega todavía se ve en el estante.</p></div>`;

        return mt.resurtir.map(p => `<article class="mt-tarjeta ${esc(p.estado)}">
            <div class="mt-tarjeta-cab"><div><b>${esc(p.nombre)}</b><small>${p.estado === "agotado" ? "Se acabó en el estante" : "Queda poco en el estante"}${p.estante ? " · va en " + esc(p.estante) : ""}</small></div>
                <div class="mt-cifras"><span><strong>${numero(p.exhibicion)}</strong>Estante</span><span><strong>${numero(p.bodega)}</strong>Bodega</span></div></div>
            ${(p.lugaresBodega || []).map(l => `<div class="mt-pasar"><span>${esc(l.ruta)}<small>${numero(l.cantidad)} disponibles</small></span><input type="number" min="0" max="${l.cantidad}" step="any" id="mtP${p.productoId}_${l.ubicacionId}" placeholder="Cantidad"><button type="button" class="mt-btn principal" onclick="mtPasar(${p.productoId}, ${l.ubicacionId})">Pasar al estante</button></div>`).join("")}
        </article>`).join("");
    }

    window.mtPasar = async function (productoId, desdeId) {
        const cantidad = Number(document.getElementById(`mtP${productoId}_${desdeId}`)?.value);
        if (!(cantidad > 0)) { aviso("Escribe cuántas piezas pasas al estante.", "error"); return; }
        const r = await llamar("/resurtir", { method: "POST", body: JSON.stringify({ productoId, desdeId, cantidad }) });
        if (!r.ok) { aviso(r.datos.error || "No se pudo pasar.", "error"); return; }
        aviso(`${numero(cantidad)} pieza(s) pasadas al estante`);
        await cargarGeneral();
        const lista = await llamar("/resurtir");
        mt.resurtir = lista.ok ? lista.datos.productos || [] : mt.resurtir;
        pintar();
    };

    // ---------- Conteos por revisar ----------

    function htmlConteos() {
        if (mt.conteo) return htmlConteoDetalle();
        if (mt.conteos === null) return `<div class="mt-vacio">Cargando…</div>`;
        if (!mt.conteos.length) return `<div class="mt-vacio-grande"><h3>Sin conteos</h3><p>Cuando alguien cuente un estante desde el celular, aparece aquí para que lo apruebes.</p></div>`;

        return `<table class="mt-tabla mt-clic"><thead><tr><th>Lugar</th><th>Contó</th><th>Cuándo</th><th class="num">Faltan</th><th class="num">Sobran</th><th>Estado</th></tr></thead><tbody>${mt.conteos.map(c => `<tr onclick="mtAbrirConteo(${c.id})"><td><b>${esc(c.lugar || "—")}</b></td><td>${esc(c.creadoPor || "")}</td><td>${esc(c.creadoAt ? new Date(c.creadoAt).toLocaleString("es-MX", { dateStyle: "short", timeStyle: "short" }) : "")}</td><td class="num">${numero(c.faltan)}</td><td class="num">${numero(c.sobran)}</td><td><span class="mt-estado ${esc(c.estado)}">${esc(c.estado)}</span></td></tr>`).join("")}</tbody></table>`;
    }

    window.mtAbrirConteo = async function (id) {
        const r = await llamar(`/conteos/${id}`);
        if (!r.ok) { aviso(r.datos.error || "No se pudo abrir el conteo.", "error"); return; }
        mt.conteo = { ...r.datos.conteo, lineas: r.datos.lineas || [], puedeRevisar: r.datos.puedeRevisar };
        repintarCuerpo();
    };

    function htmlConteoDetalle() {
        const c = mt.conteo;
        const pendiente = c.estado === "pendiente" && c.puedeRevisar;
        const filas = c.lineas.map((l, i) => `<tr class="${l.diferencia < 0 ? "falta" : l.diferencia > 0 ? "sobra" : ""}">${pendiente ? `<td><input type="checkbox" class="mt-aplicar" data-id="${l.productoId}" ${l.diferencia !== 0 ? "checked" : ""}></td>` : ""}<td><b>${esc(l.nombre)}</b><small>${esc(l.codigo || "")}${l.noEscaneado ? " · no escaneado" : ""}</small></td><td class="num">${numero(l.esperado)}</td><td class="num">${l.contado === null ? "—" : numero(l.contado)}</td><td class="num"><b>${l.diferencia > 0 ? "+" : ""}${numero(l.diferencia)}</b></td></tr>`).join("");

        return `<button type="button" class="mt-enlace" onclick="mtCerrarConteo()">‹ Volver a los conteos</button>
            <div class="mt-detalle-cab"><div><h3>${esc(c.lugar || "Conteo")}</h3><small>Contó ${esc(c.creadoPor || "")} · ${numero(c.faltan)} faltan · ${numero(c.sobran)} sobran · <span class="mt-estado ${esc(c.estado)}">${esc(c.estado)}</span></small></div>
                ${pendiente ? `<div class="mt-acciones"><button type="button" class="mt-btn peligro" onclick="mtResolverConteo('rechazar')">Rechazar</button><button type="button" class="mt-btn principal" onclick="mtResolverConteo('aprobar')">Aprobar y aplicar</button></div>` : ""}</div>
            ${pendiente ? `<p class="mt-nota">Al aprobar, la diferencia se aplica a las existencias de hoy. Desmarca las líneas que NO quieras aplicar.</p>` : ""}
            <table class="mt-tabla"><thead><tr>${pendiente ? "<th>Aplicar</th>" : ""}<th>Producto</th><th class="num">Esperado</th><th class="num">Contado</th><th class="num">Diferencia</th></tr></thead><tbody>${filas}</tbody></table>`;
    }

    window.mtCerrarConteo = function () { mt.conteo = null; repintarCuerpo(); };

    window.mtResolverConteo = async function (accion) {
        const c = mt.conteo;
        if (!c) return;

        if (accion === "rechazar") {
            if (!window.confirm("¿Rechazar este conteo? No se cambia ninguna existencia.")) return;
        }

        const excluir = accion === "aprobar" ? [...document.querySelectorAll(".mt-aplicar")].filter(x => !x.checked).map(x => Number(x.dataset.id)) : [];
        const r = await llamar(`/conteos/${c.id}/${accion}`, { method: "POST", body: JSON.stringify(accion === "aprobar" ? { excluir } : {}) });
        if (!r.ok) { aviso(r.datos.error || "No se pudo completar.", "error"); return; }
        aviso(accion === "aprobar" ? "Conteo aprobado: existencias actualizadas." : "Conteo rechazado.");
        mt.conteo = null;
        const lista = await llamar("/conteos");
        mt.conteos = lista.ok ? lista.datos.conteos || [] : mt.conteos;
        await cargarGeneral();
        pintar();
    };
})();
