// Unir proveedores: junta proveedores repetidos ("Diprofer" y "DIPROFER MX", "Gafi" y "Gagi") en uno. Nexo sugiere los grupos que parecen el mismo;
// tu decides cual se queda y cuales se unen. Los productos y las facturas pasan al que se queda, los demas quedan inactivos (no se borran) y se puede deshacer.
// Es una funcion nueva: solo aparece si el dueño la enciende en Nexo -> Funciones nuevas (funcionBeta("unir_proveedores")).
(function () {
    const esc = valor => String(valor ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
    const plano = texto => String(texto || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
    const aviso = (mensaje, tipo) => { if (typeof mostrarToastPOS === "function") mostrarToastPOS(mensaje, tipo ? { tipo } : undefined); };
    const quien = () => (typeof usuarioActual !== "undefined" && usuarioActual && (usuarioActual.nombre || usuarioActual.usuario)) || "";
    const fechaHora = valor => { const d = new Date(valor); return isNaN(d) ? "" : d.toLocaleString("es-MX", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }); };
    const nProd = n => `${n} producto${n === 1 ? "" : "s"}`;
    const nFact = n => `${n} factura${n === 1 ? "" : "s"}`;

    let est = null;

    async function llamar(ruta, opciones = {}) {
        const r = await fetch(ruta, { ...opciones, headers: { "Content-Type": "application/json", ...(opciones.headers || {}) } });
        const datos = await r.json().catch(() => ({}));
        return { ok: r.ok && datos.ok !== false, datos };
    }

    async function cargar() {
        const [d, u] = await Promise.all([llamar("/proveedores/duplicados"), llamar("/proveedores/uniones")]);
        est.proveedores = (d.ok && d.datos.proveedores) || [];
        est.grupos = (d.ok && d.datos.grupos) || [];
        est.uniones = (u.ok && u.datos.uniones) || [];
        // Por grupo: el que se queda (el sugerido) y los que se unen (todos los demas).
        est.sel = est.grupos.map(g => ({ destino: g[0].id, unir: new Set(g.slice(1).map(p => p.id)) }));
        est.manual = { destino: "", unir: new Set(), q: "" };
    }

    window.mostrarUnirProveedores = async function () {
        if (typeof ocultarPantallasPrincipales === "function") ocultarPantallasPrincipales();
        const pantalla = document.getElementById("pantallaUnirProveedores");
        if (!pantalla) return;
        pantalla.style.display = "block";
        if (typeof actualizarTopbarContexto === "function") actualizarTopbarContexto("Unir proveedores", "Junta los que están repetidos", "unir-proveedores");
        pantalla.innerHTML = `<div class="up-shell"><p class="up-vacio">Revisando tus proveedores…</p></div>`;
        est = { tab: "sugeridos", proveedores: [], grupos: [], uniones: [], sel: [], manual: null };
        await cargar();
        pintar();
    };

    function pintar() {
        const pantalla = document.getElementById("pantallaUnirProveedores");
        if (!pantalla || !est) return;

        pantalla.innerHTML = `<div class="up-shell">
            <button type="button" class="up-atras" onclick="mostrarProveedores()">← Proveedores</button>
            <header class="up-cab"><h2>Unir proveedores</h2><p>${est.proveedores.length} proveedores. Si uno está escrito de varias formas (Diprofer, DIPROFER MX), únelos para que sus productos y facturas queden juntos. No se borra nada y se puede deshacer.</p></header>
            <div class="up-tabs">${[["sugeridos", `Sugeridos (${est.grupos.length})`], ["manual", "Elegir yo"], ["uniones", `Uniones anteriores (${est.uniones.length})`]].map(([id, t]) => `<button type="button" class="${est.tab === id ? "activo" : ""}" onclick="upTab('${id}')">${t}</button>`).join("")}</div>
            <div id="upCuerpo">${est.tab === "sugeridos" ? htmlSugeridos() : (est.tab === "manual" ? htmlManual() : htmlUniones())}</div>
        </div>`;
    }

    window.upTab = function (id) { est.tab = id; pintar(); };

    // ---------- sugeridos ----------

    function htmlSugeridos() {
        if (!est.grupos.length) return `<div class="up-ok"><b>No encontré proveedores repetidos.</b><p>Si alguno sí lo está con un nombre muy distinto, úsalo en "Elegir yo".</p></div>`;

        return est.grupos.map((g, i) => {
            const s = est.sel[i];
            const aUnir = g.filter(p => s.unir.has(p.id));
            const destino = g.find(p => p.id === s.destino);
            const productos = aUnir.reduce((t, p) => t + p.productos, 0);
            const facturas = aUnir.reduce((t, p) => t + p.facturas, 0);

            return `<section class="up-grupo"><header><h3>Probablemente es el mismo proveedor</h3><small>${g.length} nombres</small></header>
                <div class="up-filas">${g.map(p => `<label class="up-fila ${p.id === s.destino ? "queda" : ""}">
                    <input type="radio" name="upDestino${i}" ${p.id === s.destino ? "checked" : ""} onchange="upDestino(${i}, ${p.id})" aria-label="Que se quede este">
                    <span class="up-nombre"><b>${esc(p.nombre)}</b><small>${nProd(p.productos)} · ${nFact(p.facturas)}${p.creado_automatico ? " · creado automáticamente" : ""}</small></span>
                    ${p.id === s.destino ? `<em class="up-tag">Se queda</em>` : `<span class="up-uno"><input type="checkbox" ${s.unir.has(p.id) ? "checked" : ""} onchange="upMarcar(${i}, ${p.id}, this.checked)" aria-label="Unir"> Unir</span>`}</label>`).join("")}</div>
                <div class="up-pie"><span>${aUnir.length ? `Se pasan ${nProd(productos)} y ${nFact(facturas)} a <b>${esc(destino.nombre)}</b>.` : "Marca al menos uno para unir."}</span>
                <button type="button" class="up-principal" onclick="upUnirGrupo(${i})" ${aUnir.length ? "" : "disabled"}>Unir ${aUnir.length ? aUnir.length + 1 : ""} en «${esc(destino.nombre)}»</button></div></section>`;
        }).join("");
    }

    window.upDestino = function (i, id) {
        const s = est.sel[i];
        s.destino = id;
        s.unir = new Set(est.grupos[i].filter(p => p.id !== id).map(p => p.id));
        pintar();
    };

    window.upMarcar = function (i, id, valor) { const s = est.sel[i]; if (valor) s.unir.add(id); else s.unir.delete(id); pintar(); };

    async function ejecutar(destinoId, origenIds, nombres, productos, facturas) {
        const ok = typeof confirmarPOS === "function" ? await confirmarPOS(`Se pasan ${nProd(productos)} y ${nFact(facturas)} a «${nombres.destino}». ${nombres.origenes.join(", ")} queda${nombres.origenes.length === 1 ? "" : "n"} guardado${nombres.origenes.length === 1 ? "" : "s"} como inactivo${nombres.origenes.length === 1 ? "" : "s"} y puedes deshacerlo cuando quieras.`, "¿Unir estos proveedores?", "info") : true;
        if (!ok) return;

        const r = await llamar("/proveedores/unir", { method: "POST", body: JSON.stringify({ destinoId, origenIds, usuario: quien() }) });

        if (!r.ok) { aviso(r.datos.error || "No se pudo unir.", "error"); return; }

        aviso(`Listo: ${r.datos.proveedores.length} proveedor${r.datos.proveedores.length === 1 ? "" : "es"} unido${r.datos.proveedores.length === 1 ? "" : "s"} en ${r.datos.destino} (${nProd(r.datos.productos)}, ${nFact(r.datos.facturas)}).`);
        if (typeof cargarProveedores === "function") { try { await cargarProveedores(); } catch (error) { /* se actualiza al volver */ } }
        await cargar();
        pintar();
    }

    window.upUnirGrupo = async function (i) {
        const g = est.grupos[i];
        const s = est.sel[i];
        const aUnir = g.filter(p => s.unir.has(p.id));
        if (!aUnir.length) return;
        await ejecutar(s.destino, aUnir.map(p => p.id), { destino: g.find(p => p.id === s.destino).nombre, origenes: aUnir.map(p => p.nombre) }, aUnir.reduce((t, p) => t + p.productos, 0), aUnir.reduce((t, p) => t + p.facturas, 0));
    };

    // ---------- elegir yo ----------

    function htmlManual() {
        const m = est.manual;
        const q = plano(m.q).trim();
        const lista = est.proveedores.filter(p => !q || plano(p.nombre).includes(q));
        const marcados = est.proveedores.filter(p => m.unir.has(p.id));
        const destino = est.proveedores.find(p => String(p.id) === String(m.destino));
        const aUnir = marcados.filter(p => destino && p.id !== destino.id);
        const productos = aUnir.reduce((t, p) => t + p.productos, 0);
        const facturas = aUnir.reduce((t, p) => t + p.facturas, 0);

        return `<section class="up-grupo">
            <input class="up-buscar" type="search" placeholder="Buscar proveedor…" value="${esc(m.q)}" oninput="upBuscar(this.value)">
            <p class="up-ayuda">Marca los que quieres juntar y elige abajo cuál se queda.</p>
            <div class="up-filas up-largo">${lista.map(p => `<label class="up-fila"><input type="checkbox" ${m.unir.has(p.id) ? "checked" : ""} onchange="upManual(${p.id}, this.checked)"><span class="up-nombre"><b>${esc(p.nombre)}</b><small>${nProd(p.productos)} · ${nFact(p.facturas)}</small></span></label>`).join("") || `<p class="up-vacio">Ninguno coincide.</p>`}</div>
            <div class="up-pie"><label class="up-destino">Se queda: <select onchange="upManualDestino(this.value)"><option value="">Elegir…</option>${marcados.map(p => `<option value="${p.id}" ${String(m.destino) === String(p.id) ? "selected" : ""}>${esc(p.nombre)}</option>`).join("")}</select></label>
                <span>${aUnir.length ? `Se pasan ${nProd(productos)} y ${nFact(facturas)}.` : (marcados.length < 2 ? "Marca al menos dos." : "Elige cuál se queda.")}</span>
                <button type="button" class="up-principal" onclick="upUnirManual()" ${aUnir.length ? "" : "disabled"}>Unir</button></div></section>`;
    }

    window.upBuscar = function (texto) {
        est.manual.q = texto;
        pintar();
        const c = document.querySelector(".up-buscar");
        if (c) { c.focus(); c.setSelectionRange(c.value.length, c.value.length); }
    };
    window.upManual = function (id, valor) { if (valor) est.manual.unir.add(id); else { est.manual.unir.delete(id); if (String(est.manual.destino) === String(id)) est.manual.destino = ""; } pintar(); };
    window.upManualDestino = function (valor) { est.manual.destino = valor; pintar(); };

    window.upUnirManual = async function () {
        const m = est.manual;
        const destino = est.proveedores.find(p => String(p.id) === String(m.destino));
        const aUnir = est.proveedores.filter(p => m.unir.has(p.id) && destino && p.id !== destino.id);
        if (!destino || !aUnir.length) return;
        await ejecutar(destino.id, aUnir.map(p => p.id), { destino: destino.nombre, origenes: aUnir.map(p => p.nombre) }, aUnir.reduce((t, p) => t + p.productos, 0), aUnir.reduce((t, p) => t + p.facturas, 0));
    };

    // ---------- uniones anteriores ----------

    function htmlUniones() {
        if (!est.uniones.length) return `<p class="up-vacio">Todavía no has unido proveedores.</p>`;

        return est.uniones.map(u => `<article class="up-union ${u.deshecho ? "deshecha" : ""}"><div><b>${esc(u.origenes.join(", "))} → ${esc(u.destino)}</b><small>${esc(fechaHora(u.fecha))}${u.usuario ? " · " + esc(u.usuario) : ""} · ${nProd(u.productos)}, ${nFact(u.facturas)}${u.deshecho ? " · Deshecha" : ""}</small></div>
            ${u.deshecho ? "" : `<button type="button" class="up-sec" onclick="upDeshacer('${esc(u.id)}')">Deshacer</button>`}</article>`).join("");
    }

    window.upDeshacer = async function (lote) {
        const ok = typeof confirmarPOS === "function" ? await confirmarPOS("Cada proveedor vuelve a estar activo con sus productos y facturas (solo los que siguen con el proveedor al que se unieron).", "¿Deshacer esta unión?", "alerta") : true;
        if (!ok) return;

        const r = await llamar(`/proveedores/uniones/${encodeURIComponent(lote)}/deshacer`, { method: "POST", body: "{}" });

        if (!r.ok) { aviso(r.datos.error || "No se pudo deshacer.", "error"); return; }

        aviso(`Se regresaron ${r.datos.proveedores.length} proveedor${r.datos.proveedores.length === 1 ? "" : "es"} (${nProd(r.datos.productos)}).`);
        if (typeof cargarProveedores === "function") { try { await cargarProveedores(); } catch (error) { /* se actualiza al volver */ } }
        await cargar();
        pintar();
    };
})();
