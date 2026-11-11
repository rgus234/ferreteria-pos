// Actualizar precios (abarrotes): sube o baja precios de varios productos a la vez (por marca, categoria, proveedor o los que elijas),
// con vista previa antes de aplicar, historial de cada cambio y "Deshacer" para un lote completo.
// Es una funcion nueva: solo aparece si el dueño la enciende en Nexo -> Funciones nuevas (funcionBeta("precios_lote")).
(function () {
    const esc = valor => String(valor ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
    const plano = texto => String(texto || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
    const dinero = valor => (valor === null || valor === undefined || valor === "" ? "—" : "$" + Number(valor).toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
    const fechaHora = valor => { const d = new Date(valor); return isNaN(d) ? "" : d.toLocaleString("es-MX", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }); };
    const aviso = (mensaje, tipo) => { if (typeof mostrarToastPOS === "function") mostrarToastPOS(mensaje, tipo ? { tipo } : undefined); };
    const quien = () => (typeof usuarioActual !== "undefined" && usuarioActual && (usuarioActual.nombre || usuarioActual.usuario)) || "";

    const CAMPOS = { precio_publico: "Precio de venta", costo: "Costo" };
    const REDONDEOS = { ninguno: "Sin redondeo", peso: "Al peso", medio: "A 50 centavos", cinco: "Múltiplo de 5", diez: "Múltiplo de 10" };
    const TIPOS = { subir_pct: "Subir %", bajar_pct: "Bajar %", subir_monto: "Subir $", bajar_monto: "Bajar $", fijo: "Precio fijo" };
    const ORIGENES = { edicion: "Edición", alta: "Producto nuevo", lote: "Lote de precios", deshacer: "Se deshizo un lote" };

    let est = null;

    async function llamar(ruta, opciones = {}) {
        const r = await fetch(ruta, { ...opciones, headers: { "Content-Type": "application/json", ...(opciones.headers || {}) } });
        const datos = await r.json().catch(() => ({}));
        return { ok: r.ok && datos.ok !== false, datos };
    }

    function redondear(valor, regla) {
        const v = Number(valor) || 0;
        switch (regla) {
            case "peso": return Math.round(v);
            case "medio": return Math.round(v * 2) / 2;
            case "cinco": return Math.round(v / 5) * 5;
            case "diez": return Math.round(v / 10) * 10;
            default: return Math.round(v * 100) / 100;
        }
    }

    function calcular(antes, cfg, campo) {
        const a = Number(antes);
        const v = Number(cfg.valor);
        if (!Number.isFinite(v)) return null;
        let r;
        if (cfg.tipo === "subir_pct") r = a * (1 + v / 100);
        else if (cfg.tipo === "bajar_pct") r = a * (1 - v / 100);
        else if (cfg.tipo === "subir_monto") r = a + v;
        else if (cfg.tipo === "bajar_monto") r = a - v;
        else r = v;
        // El redondeo es del precio que se eligio mover; el costo acompañante conserva sus centavos.
        return Math.max(0, redondear(r, campo === cfg.campo ? cfg.redondeo : "ninguno"));
    }

    window.mostrarPreciosLote = async function () {
        if (typeof ocultarPantallasPrincipales === "function") ocultarPantallasPrincipales();
        const pantalla = document.getElementById("pantallaPreciosLote");
        if (!pantalla) return;
        pantalla.style.display = "block";
        if (typeof actualizarTopbarContexto === "function") actualizarTopbarContexto("Actualizar precios", "Sube o baja varios precios a la vez, con historial", "precios-lote");
        pantalla.innerHTML = `<div class="pl-shell"><p class="pl-vacio">Cargando tus productos…</p></div>`;

        if (!Array.isArray(todosProductos) || !todosProductos.length) { try { await cargarProductos(); } catch (error) { /* se avisa abajo */ } }

        const productos = (Array.isArray(todosProductos) ? todosProductos : []).filter(p => Number(p.id) > 0);
        let proveedores = [];
        try { proveedores = (await llamar("/proveedores")).datos.proveedores || []; } catch (error) { /* sin proveedores */ }

        est = { pestana: "nuevo", productos, proveedores: new Map(proveedores.map(p => [Number(p.id), p.nombre])), alcance: "marca", elegidos: new Set(), busqueda: "", cfg: { campo: "precio_publico", tipo: "subir_pct", valor: "", redondeo: "peso", ambos: false }, filas: null, motivo: "", lotes: null, abierto: null, hist: null };
        pintar();
    };

    function pintar() {
        const pantalla = document.getElementById("pantallaPreciosLote");
        if (!pantalla || !est) return;

        pantalla.innerHTML = `<div class="pl-shell">
            <header class="pl-cab"><h2>Actualizar precios</h2><p>Elige qué productos, cuánto cambian y revisa el antes y el después. Todo queda en el historial y un lote se puede deshacer.</p></header>
            <div class="pl-pestanas">${[["nuevo", "Nuevo cambio"], ["lotes", "Cambios anteriores"], ["producto", "Historial de un producto"]].map(([id, t]) => `<button type="button" class="${est.pestana === id ? "activo" : ""}" onclick="plPestana('${id}')">${t}</button>`).join("")}</div>
            <div id="plCuerpo"></div></div>`;

        if (est.pestana === "nuevo") pintarNuevo();
        else if (est.pestana === "lotes") pintarLotes();
        else pintarProducto();
    }

    window.plPestana = function (id) {
        est.pestana = id;
        pintar();
        if (id === "lotes" && !est.lotes) cargarLotes();
    };

    // ---------- Nuevo cambio ----------

    function opcionesDeAlcance() {
        const cuenta = new Map();
        const clave = p => est.alcance === "marca" ? String(p.marca || "").trim() : (est.alcance === "categoria" ? String(p.categoria || "").trim() : (est.proveedores.get(Number(p.proveedor_id)) || ""));
        est.productos.forEach(p => { const k = clave(p); if (k) cuenta.set(k, (cuenta.get(k) || 0) + 1); });
        return [...cuenta.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    }

    function productosDelAlcance() {
        if (est.alcance === "todos") return est.productos;
        if (est.alcance === "elegir") return est.productos.filter(p => est.elegidos.has("p" + p.id));
        const clave = p => est.alcance === "marca" ? String(p.marca || "").trim() : (est.alcance === "categoria" ? String(p.categoria || "").trim() : (est.proveedores.get(Number(p.proveedor_id)) || ""));
        return est.productos.filter(p => est.elegidos.has(clave(p)));
    }

    function pintarNuevo() {
        const c = document.getElementById("plCuerpo");
        if (!c) return;
        const seleccionados = productosDelAlcance();
        const q = plano(est.busqueda).trim();

        let lista = "";
        if (est.alcance === "elegir") {
            const encontrados = q ? est.productos.filter(p => q.split(/\s+/).every(w => plano(p.nombre).includes(w) || String(p.codigo || "").includes(w))).slice(0, 60) : est.productos.filter(p => est.elegidos.has("p" + p.id)).slice(0, 60);
            lista = `<input class="pl-buscar" type="search" placeholder="Busca productos por nombre o código…" value="${esc(est.busqueda)}" oninput="plBuscar(this.value)">
                <div class="pl-opciones">${encontrados.map(p => `<button type="button" class="${est.elegidos.has("p" + p.id) ? "activo" : ""}" onclick="plAlternar('p${p.id}')">${esc(p.nombre)}<small>${dinero(p.precio_publico || p.precio)}</small></button>`).join("") || `<p class="pl-vacio">${q ? "No encontré nada." : "Busca un producto para agregarlo."}</p>`}</div>`;
        } else if (est.alcance !== "todos") {
            const opciones = opcionesDeAlcance().filter(([nombre]) => !q || plano(nombre).includes(q));
            lista = `<input class="pl-buscar" type="search" placeholder="Filtrar…" value="${esc(est.busqueda)}" oninput="plBuscar(this.value)">
                <div class="pl-opciones">${opciones.map(([nombre, n]) => `<button type="button" class="${est.elegidos.has(nombre) ? "activo" : ""}" onclick="plAlternar(this.dataset.v)" data-v="${esc(nombre)}">${esc(nombre)}<small>${n} producto${n === 1 ? "" : "s"}</small></button>`).join("") || `<p class="pl-vacio">No hay nada para elegir aquí.</p>`}</div>`;
        }

        c.innerHTML = `<section class="pl-paso"><h3><span>1</span> ¿Qué productos?</h3>
                <div class="pl-chips">${[["marca", "Por marca"], ["categoria", "Por categoría"], ["proveedor", "Por proveedor"], ["elegir", "Los elijo yo"], ["todos", "Todos"]].map(([id, t]) => `<button type="button" class="${est.alcance === id ? "activo" : ""}" onclick="plAlcance('${id}')">${t}</button>`).join("")}</div>
                ${lista}
                <p class="pl-cuenta">${seleccionados.length} producto${seleccionados.length === 1 ? "" : "s"} elegido${seleccionados.length === 1 ? "" : "s"}</p></section>
            <section class="pl-paso"><h3><span>2</span> ¿Qué cambia?</h3>
                <div class="pl-form">
                    <label>Qué precio<select onchange="plCfg('campo', this.value)">${Object.entries(CAMPOS).map(([k, t]) => `<option value="${k}" ${est.cfg.campo === k ? "selected" : ""}>${t}</option>`).join("")}</select></label>
                    <label>Cómo<select onchange="plCfg('tipo', this.value)">${Object.entries(TIPOS).map(([k, t]) => `<option value="${k}" ${est.cfg.tipo === k ? "selected" : ""}>${t}</option>`).join("")}</select></label>
                    <label>${est.cfg.tipo.endsWith("pct") ? "Porcentaje" : "Cantidad ($)"}<input type="number" step="any" min="0" inputmode="decimal" placeholder="0" value="${esc(est.cfg.valor)}" oninput="plCfg('valor', this.value, true)"></label>
                    <label>Redondeo<select onchange="plCfg('redondeo', this.value)">${Object.entries(REDONDEOS).map(([k, t]) => `<option value="${k}" ${est.cfg.redondeo === k ? "selected" : ""}>${t}</option>`).join("")}</select></label>
                </div>
                ${est.cfg.tipo === "fijo" ? "" : `<label class="pl-check"><input type="checkbox" ${est.cfg.ambos ? "checked" : ""} onchange="plCfg('ambos', this.checked)"> Mover también ${est.cfg.campo === "costo" ? "el precio de venta" : "el costo"} en la misma cantidad</label>`}
                <button type="button" class="pl-principal" onclick="plVistaPrevia()" ${seleccionados.length ? "" : "disabled"}>Ver cómo quedaría</button></section>
            <section class="pl-paso" id="plPrevia"></section>`;

        if (est.filas) pintarPrevia();
    }

    window.plAlcance = function (id) { est.alcance = id; est.elegidos = new Set(); est.busqueda = ""; est.filas = null; pintarNuevo(); };
    window.plBuscar = function (texto) {
        est.busqueda = texto;
        const campo = document.querySelector("#plCuerpo .pl-buscar");
        pintarNuevo();
        const nuevo = document.querySelector("#plCuerpo .pl-buscar");
        if (nuevo && campo) { nuevo.focus(); nuevo.setSelectionRange(nuevo.value.length, nuevo.value.length); }
    };
    window.plAlternar = function (clave) { if (est.elegidos.has(clave)) est.elegidos.delete(clave); else est.elegidos.add(clave); est.filas = null; const busq = est.busqueda; pintarNuevo(); est.busqueda = busq; };
    window.plCfg = function (campo, valor, sinPintar) { est.cfg[campo] = valor; est.filas = null; if (!sinPintar) { pintarNuevo(); } else { document.getElementById("plPrevia").innerHTML = ""; } };

    window.plVistaPrevia = function () {
        const valor = Number(est.cfg.valor);
        if (!(valor >= 0) || est.cfg.valor === "") { if (typeof alertaPOS === "function") alertaPOS("Escribe cuánto va a cambiar.", "Falta la cantidad", "alerta"); return; }

        const acompaña = est.cfg.ambos && est.cfg.tipo !== "fijo";
        const campos = acompaña ? [est.cfg.campo, est.cfg.campo === "costo" ? "precio_publico" : "costo"] : [est.cfg.campo];
        const filas = [];

        productosDelAlcance().forEach(p => {
            const cambios = {};

            campos.forEach(campo => {
                const actual = campo === "precio_publico" ? (p.precio_publico !== null && p.precio_publico !== undefined ? p.precio_publico : p.precio) : p.costo;
                if (actual === null || actual === undefined || !(Number(actual) > 0)) return;
                const despues = calcular(actual, est.cfg, campo);
                if (despues === null || Math.abs(despues - Number(actual)) < 0.005) return;
                cambios[campo] = { antes: Math.round(Number(actual) * 100) / 100, despues };
            });

            if (Object.keys(cambios).length) filas.push({ p, cambios, incluido: true });
        });

        est.filas = filas;
        est.motivo = est.motivo || "";
        pintarPrevia();
        document.getElementById("plPrevia")?.scrollIntoView({ behavior: "smooth", block: "start" });
    };

    function pintarPrevia() {
        const caja = document.getElementById("plPrevia");
        if (!caja) return;

        if (!est.filas.length) { caja.innerHTML = `<h3><span>3</span> Vista previa</h3><p class="pl-vacio">Con ese cambio ningún precio se mueve (o los productos no tienen ese precio puesto).</p>`; return; }

        const campos = [...new Set(est.filas.flatMap(f => Object.keys(f.cambios)))];
        const incluidas = est.filas.filter(f => f.incluido);
        const pct = f => { const c = f.cambios.precio_publico || f.cambios.costo; return c ? ((c.despues - c.antes) / c.antes * 100) : 0; };
        const promedio = incluidas.length ? incluidas.reduce((s, f) => s + pct(f), 0) / incluidas.length : 0;

        caja.innerHTML = `<h3><span>3</span> Vista previa</h3>
            <div class="pl-tabla-caja"><table class="pl-tabla"><thead><tr><th></th><th>Producto</th>${campos.map(c => `<th>${CAMPOS[c]}</th>`).join("")}<th>Cambio</th></tr></thead><tbody>
            ${est.filas.map((f, i) => `<tr class="${f.incluido ? "" : "excluida"}"><td><input type="checkbox" ${f.incluido ? "checked" : ""} onchange="plIncluir(${i}, this.checked)" aria-label="Incluir"></td>
                <td><b>${esc(f.p.nombre)}</b>${f.p.marca ? `<small>${esc(f.p.marca)}</small>` : ""}</td>
                ${campos.map(c => f.cambios[c] ? `<td>${dinero(f.cambios[c].antes)} → <input class="pl-nuevo" type="number" step="0.01" min="0" value="${f.cambios[c].despues}" onchange="plEditar(${i}, '${c}', this.value)"></td>` : `<td>—</td>`).join("")}
                <td class="${pct(f) >= 0 ? "pl-sube" : "pl-baja"}">${pct(f) >= 0 ? "+" : ""}${pct(f).toFixed(1)}%</td></tr>`).join("")}
            </tbody></table></div>
            <label class="pl-motivo">Motivo (opcional, para recordarlo en el historial)<input type="text" maxlength="160" placeholder="Ej. Subió Sabritas 5%" value="${esc(est.motivo)}" oninput="est_motivo(this.value)"></label>
            <div class="pl-pie"><span>${incluidas.length} de ${est.filas.length} producto${est.filas.length === 1 ? "" : "s"} · cambio promedio ${promedio >= 0 ? "+" : ""}${promedio.toFixed(1)}%</span>
            <button type="button" class="pl-principal" onclick="plAplicar()" ${incluidas.length ? "" : "disabled"}>Aplicar a ${incluidas.length} producto${incluidas.length === 1 ? "" : "s"}</button></div>`;
    }

    window.est_motivo = function (texto) { est.motivo = texto; };
    window.plIncluir = function (i, valor) { est.filas[i].incluido = Boolean(valor); pintarPrevia(); };
    window.plEditar = function (i, campo, valor) {
        const n = Number(valor);
        if (Number.isFinite(n) && n >= 0) est.filas[i].cambios[campo].despues = Math.round(n * 100) / 100;
        pintarPrevia();
    };

    window.plAplicar = async function () {
        const cambios = [];

        est.filas.filter(f => f.incluido).forEach(f => Object.entries(f.cambios).forEach(([campo, c]) => cambios.push({ productoId: f.p.id, campo, anterior: c.antes, nuevo: c.despues })));

        if (!cambios.length) return;

        const ok = typeof confirmarPOS === "function" ? await confirmarPOS(`Se cambian ${cambios.length} precio${cambios.length === 1 ? "" : "s"}. Queda en el historial y puedes deshacerlo.`, "¿Aplicar los cambios?", "info") : true;
        if (!ok) return;

        const r = await llamar("/precios-lote/aplicar", { method: "POST", body: JSON.stringify({ cambios, motivo: est.motivo, usuario: quien() }) });

        if (!r.ok) { if (typeof alertaPOS === "function") alertaPOS(r.datos.error || "No se pudo aplicar.", "No se aplicó", "peligro"); return; }

        const omitidos = (r.datos.omitidos || []).length;
        aviso(`Listo: ${r.datos.aplicados} precio${r.datos.aplicados === 1 ? "" : "s"} actualizado${r.datos.aplicados === 1 ? "" : "s"}.${omitidos ? ` ${omitidos} se omitieron porque ya habían cambiado.` : ""}`);

        try { await cargarProductos(); est.productos = (Array.isArray(todosProductos) ? todosProductos : []).filter(p => Number(p.id) > 0); } catch (error) { /* se queda con lo anterior */ }
        est.filas = null; est.elegidos = new Set(); est.motivo = ""; est.cfg.valor = ""; est.lotes = null; est.pestana = "lotes";
        pintar();
        cargarLotes();
    };

    // ---------- Cambios anteriores ----------

    async function cargarLotes() {
        const r = await llamar("/precios-lote/lotes");
        est.lotes = r.ok ? r.datos.lotes : [];
        if (est.pestana === "lotes") pintarLotes();
    }

    function pintarLotes() {
        const c = document.getElementById("plCuerpo");
        if (!c) return;
        if (!est.lotes) { c.innerHTML = `<p class="pl-vacio">Cargando…</p>`; cargarLotes(); return; }

        c.innerHTML = est.lotes.length ? `<div class="pl-lotes">${est.lotes.map(l => `<article class="pl-lote ${l.deshecho ? "deshecho" : ""}">
                <div class="pl-lote-datos"><b>${esc(l.motivo || "Cambio de precios")}</b>
                <small>${esc(fechaHora(l.fecha))}${l.usuario ? " · " + esc(l.usuario) : ""} · ${l.productos} producto${l.productos === 1 ? "" : "s"}${l.promedioPct !== null ? ` · ${l.promedioPct >= 0 ? "+" : ""}${l.promedioPct}% en promedio` : ""}${l.deshecho ? " · Deshecho" : ""}</small></div>
                <div class="pl-lote-acciones"><button type="button" onclick="plVerLote('${esc(l.id)}')">${est.abierto === l.id ? "Ocultar" : "Ver detalle"}</button>${l.deshecho ? "" : `<button type="button" class="pl-peligro" onclick="plDeshacer('${esc(l.id)}')">Deshacer</button>`}</div>
                ${est.abierto === l.id ? `<div class="pl-detalle" id="plDetalle"><p class="pl-vacio">Cargando…</p></div>` : ""}</article>`).join("")}</div>` : `<p class="pl-vacio">Todavía no has aplicado ningún lote de precios.</p>`;

        if (est.abierto) cargarDetalle(est.abierto);
    }

    window.plVerLote = function (id) { est.abierto = est.abierto === id ? null : id; pintarLotes(); };

    async function cargarDetalle(id) {
        const r = await llamar("/precios-lote/lote/" + encodeURIComponent(id));
        const caja = document.getElementById("plDetalle");
        if (!caja) return;
        caja.innerHTML = r.ok && r.datos.cambios.length ? `<table class="pl-tabla"><tbody>${r.datos.cambios.map(x => `<tr><td>${esc(x.producto_nombre)}</td><td>${CAMPOS[x.campo] || esc(x.campo)}</td><td>${dinero(x.anterior)} → <b>${dinero(x.nuevo)}</b></td></tr>`).join("")}</tbody></table>` : `<p class="pl-vacio">Sin detalle.</p>`;
    }

    window.plDeshacer = async function (id) {
        const ok = typeof confirmarPOS === "function" ? await confirmarPOS("Los precios regresan a como estaban antes de este lote. Lo que alguien haya cambiado después no se toca.", "¿Deshacer este lote?", "alerta") : true;
        if (!ok) return;

        const r = await llamar(`/precios-lote/${encodeURIComponent(id)}/deshacer`, { method: "POST", body: JSON.stringify({ usuario: quien() }) });

        if (!r.ok) { if (typeof alertaPOS === "function") alertaPOS(r.datos.error || "No se pudo deshacer.", "No se deshizo", "peligro"); return; }

        const omitidos = (r.datos.omitidos || []).length;
        aviso(`Se regresaron ${r.datos.regresados} precio${r.datos.regresados === 1 ? "" : "s"}.${omitidos ? ` ${omitidos} no se tocaron porque cambiaron después.` : ""}`);
        try { await cargarProductos(); est.productos = (Array.isArray(todosProductos) ? todosProductos : []).filter(p => Number(p.id) > 0); } catch (error) { /* se queda con lo anterior */ }
        est.lotes = null;
        pintarLotes();
    };

    // ---------- Historial de un producto ----------

    function pintarProducto() {
        const c = document.getElementById("plCuerpo");
        if (!c) return;
        const q = plano(est.busqueda).trim();
        const encontrados = q ? est.productos.filter(p => q.split(/\s+/).every(w => plano(p.nombre).includes(w) || String(p.codigo || "").includes(w))).slice(0, 8) : [];

        c.innerHTML = `<section class="pl-paso"><input class="pl-buscar" type="search" placeholder="Busca un producto por nombre o código…" value="${esc(est.busqueda)}" oninput="plBuscarProducto(this.value)">
            ${encontrados.length ? `<div class="pl-opciones">${encontrados.map(p => `<button type="button" onclick="plHistorial(${p.id})">${esc(p.nombre)}<small>${dinero(p.precio_publico || p.precio)}</small></button>`).join("")}</div>` : ""}
            <div id="plHistorial">${est.hist ? historialHtml() : `<p class="pl-vacio">Busca un producto para ver cómo ha cambiado su precio.</p>`}</div></section>`;
    }

    window.plBuscarProducto = function (texto) {
        est.busqueda = texto;
        pintarProducto();
        const campo = document.querySelector("#plCuerpo .pl-buscar");
        if (campo) { campo.focus(); campo.setSelectionRange(campo.value.length, campo.value.length); }
    };

    window.plHistorial = async function (id) {
        const producto = est.productos.find(p => Number(p.id) === Number(id));
        const r = await llamar("/precios-lote/producto/" + Number(id));
        est.hist = { nombre: producto ? producto.nombre : "Producto", cambios: r.ok ? r.datos.cambios : [] };
        est.busqueda = "";
        pintarProducto();
    };

    function historialHtml() {
        const h = est.hist;
        if (!h.cambios.length) return `<h3>${esc(h.nombre)}</h3><p class="pl-vacio">Todavía no hay cambios registrados de este producto.</p>`;
        return `<h3>${esc(h.nombre)}</h3><table class="pl-tabla"><tbody>${h.cambios.map(x => `<tr><td>${esc(fechaHora(x.created_at))}</td><td>${CAMPOS[x.campo] || esc(x.campo.replace("precio_", "Precio "))}</td><td>${dinero(x.anterior)} → <b>${dinero(x.nuevo)}</b></td><td><small>${esc(ORIGENES[x.origen] || x.origen)}${x.motivo ? " · " + esc(x.motivo) : ""}${x.usuario ? " · " + esc(x.usuario) : ""}</small></td></tr>`).join("")}</tbody></table>`;
    }
})();
