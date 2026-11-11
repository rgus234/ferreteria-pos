/* Actualizar precios en el celular: sube o baja los precios de varios productos a la vez (por marca o categoria), con vista previa antes de
   aplicar y "Deshacer" para un lote. Lo mismo que la pantalla de la computadora (mismas rutas /precios-lote). Es una funcion nueva: el renglon
   "Actualizar precios" en Mas solo aparece si el dueño la enciende (funciones nuevas -> precios_lote). */

(function () {
    const esc = valor => (typeof escaparDueno === "function" ? escaparDueno(valor) : String(valor ?? ""));
    const plano = texto => String(texto || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
    const dinero = n => "$" + Number(n || 0).toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const fechaHora = valor => { const d = new Date(valor); return isNaN(d) ? "" : d.toLocaleString("es-MX", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }); };
    const avisar = (mensaje, tipo) => { if (window.NexoMovil && NexoMovil.aviso) NexoMovil.aviso(mensaje, tipo); else alert(mensaje); };
    const TIPOS = { subir_pct: "Subir %", bajar_pct: "Bajar %", subir_monto: "Subir $", bajar_monto: "Bajar $" };
    const REDONDEOS = { ninguno: "Sin redondeo", peso: "Al peso", medio: "A 50 centavos", cinco: "Múltiplo de 5" };

    let est = null;

    function redondear(v, regla) {
        v = Number(v) || 0;
        if (regla === "peso") return Math.round(v);
        if (regla === "medio") return Math.round(v * 2) / 2;
        if (regla === "cinco") return Math.round(v / 5) * 5;
        return Math.round(v * 100) / 100;
    }

    function calcular(antes, cfg, conRedondeo) {
        const a = Number(antes);
        const v = Number(cfg.valor);
        const r = cfg.tipo === "subir_pct" ? a * (1 + v / 100) : (cfg.tipo === "bajar_pct" ? a * (1 - v / 100) : (cfg.tipo === "subir_monto" ? a + v : a - v));
        return Math.max(0, redondear(r, conRedondeo ? cfg.redondeo : "ninguno"));
    }

    const claveDe = p => est.alcance === "marca" ? String(p.marca || "").trim() : String(p.categoria || "").trim();
    const elegidosProductos = () => est.alcance === "todos" ? est.productos : est.productos.filter(p => est.elegidos.has(claveDe(p)));

    window.renderSubpantallaPreciosLote = async function () {
        if (typeof cargandoGestion === "function") cargandoGestion("Cargando tus productos...");
        let productos = [];
        try { productos = ((await fetchAutenticado("/productos")) || []).filter(p => Number(p.id) > 0); } catch (error) { productos = []; }
        est = { productos, alcance: "marca", elegidos: new Set(), cfg: { tipo: "subir_pct", valor: "", redondeo: "peso", ambos: false }, filas: null, motivo: "", vista: "nuevo", lotes: null };
        pintar();
    };

    function cont() { return typeof contenidoGestion === "function" ? contenidoGestion() : document.getElementById("duenoMasSubpantallaContenido"); }

    function pintar() {
        const c = cont();
        if (!c || !est) return;

        const pestanas = `<div class="dpl-pestanas"><button type="button" class="${est.vista === "nuevo" ? "activo" : ""}" onclick="plDuenoVista('nuevo')">Nuevo cambio</button><button type="button" class="${est.vista === "lotes" ? "activo" : ""}" onclick="plDuenoVista('lotes')">Anteriores</button></div>`;
        c.innerHTML = `<div class="dpl">${pestanas}<div id="dplCuerpo"></div></div>`;
        if (est.vista === "nuevo") pintarNuevo(); else pintarLotes();
    }

    window.plDuenoVista = function (v) { est.vista = v; pintar(); };

    function opciones() {
        const cuenta = new Map();
        est.productos.forEach(p => { const k = claveDe(p); if (k) cuenta.set(k, (cuenta.get(k) || 0) + 1); });
        return [...cuenta.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    }

    function pintarNuevo() {
        const c = document.getElementById("dplCuerpo");
        if (!c) return;
        const n = elegidosProductos().length;

        if (est.filas) { pintarPrevia(); return; }

        c.innerHTML = `<h3>1 · ¿Qué productos?</h3>
            <div class="dpl-chips">${[["marca", "Por marca"], ["categoria", "Por categoría"], ["todos", "Todos"]].map(([id, t]) => `<button type="button" class="${est.alcance === id ? "activo" : ""}" onclick="plDuenoAlcance('${id}')">${t}</button>`).join("")}</div>
            ${est.alcance === "todos" ? "" : `<div class="dpl-opciones">${opciones().map(([nombre, k]) => `<button type="button" class="${est.elegidos.has(nombre) ? "activo" : ""}" data-v="${esc(nombre)}" onclick="plDuenoAlternar(this)">${esc(nombre)}<small>${k}</small></button>`).join("") || `<p class="dpl-nota">No hay nada para elegir aquí.</p>`}</div>`}
            <p class="dpl-cuenta" id="dplCuenta">${n} producto${n === 1 ? "" : "s"} elegido${n === 1 ? "" : "s"}</p>
            <h3>2 · ¿Cuánto cambia?</h3>
            <div class="dpl-form">
                <label>Cómo<select onchange="plDuenoCfg('tipo', this.value)">${Object.entries(TIPOS).map(([k, t]) => `<option value="${k}" ${est.cfg.tipo === k ? "selected" : ""}>${t}</option>`).join("")}</select></label>
                <label>${est.cfg.tipo.endsWith("pct") ? "Porcentaje" : "Cantidad ($)"}<input type="number" inputmode="decimal" step="any" min="0" placeholder="0" value="${esc(est.cfg.valor)}" oninput="plDuenoCfg('valor', this.value)"></label>
                <label>Redondeo<select onchange="plDuenoCfg('redondeo', this.value)">${Object.entries(REDONDEOS).map(([k, t]) => `<option value="${k}" ${est.cfg.redondeo === k ? "selected" : ""}>${t}</option>`).join("")}</select></label>
            </div>
            <label class="dpl-check"><input type="checkbox" ${est.cfg.ambos ? "checked" : ""} onchange="plDuenoCfg('ambos', this.checked)"> Mover también el costo en la misma cantidad</label>
            <button type="button" class="dpl-principal" onclick="plDuenoPrevia()">Ver cómo quedaría</button>`;
    }

    window.plDuenoAlcance = function (id) { est.alcance = id; est.elegidos = new Set(); pintarNuevo(); };
    window.plDuenoAlternar = function (boton) {
        const v = boton.dataset.v;
        if (est.elegidos.has(v)) est.elegidos.delete(v); else est.elegidos.add(v);
        boton.classList.toggle("activo");
        const n = elegidosProductos().length;
        const cuenta = document.getElementById("dplCuenta");
        if (cuenta) cuenta.textContent = `${n} producto${n === 1 ? "" : "s"} elegido${n === 1 ? "" : "s"}`;
    };
    window.plDuenoCfg = function (campo, valor) { est.cfg[campo] = valor; if (campo === "tipo") pintarNuevo(); };

    window.plDuenoPrevia = function () {
        if (est.cfg.valor === "" || !(Number(est.cfg.valor) >= 0)) { avisar("Escribe cuánto va a cambiar."); return; }

        const filas = [];

        elegidosProductos().forEach(p => {
            const venta = p.precio_publico !== null && p.precio_publico !== undefined ? p.precio_publico : p.precio;
            const cambios = {};
            const nuevoVenta = Number(venta) > 0 ? calcular(venta, est.cfg, true) : null;

            if (nuevoVenta !== null && Math.abs(nuevoVenta - Number(venta)) >= 0.005) cambios.precio_publico = { antes: Math.round(Number(venta) * 100) / 100, despues: nuevoVenta };

            if (est.cfg.ambos && Number(p.costo) > 0) {
                const nuevoCosto = calcular(p.costo, est.cfg, false);
                if (Math.abs(nuevoCosto - Number(p.costo)) >= 0.005) cambios.costo = { antes: Math.round(Number(p.costo) * 100) / 100, despues: nuevoCosto };
            }

            if (Object.keys(cambios).length) filas.push({ p, cambios, incluido: true });
        });

        est.filas = filas;
        pintarNuevo();
    };

    function pintarPrevia() {
        const c = document.getElementById("dplCuerpo");
        if (!c) return;
        const incluidas = est.filas.filter(f => f.incluido);

        c.innerHTML = `<button type="button" class="dpl-atras" onclick="plDuenoVolver()">‹ Cambiar</button>
            <h3>3 · Así quedaría</h3>
            ${est.filas.length ? `<div class="dpl-lista">${est.filas.map((f, i) => {
                const v = f.cambios.precio_publico;
                const pct = v ? (v.despues - v.antes) / v.antes * 100 : 0;
                return `<div class="dpl-fila ${f.incluido ? "" : "fuera"}"><div><b>${esc(f.p.nombre)}</b><small>${v ? `${dinero(v.antes)} → <strong>${dinero(v.despues)}</strong> (${pct >= 0 ? "+" : ""}${pct.toFixed(1)}%)` : "Solo el costo"}${f.cambios.costo ? ` · costo ${dinero(f.cambios.costo.antes)} → ${dinero(f.cambios.costo.despues)}` : ""}</small></div><button type="button" onclick="plDuenoQuitar(${i})" aria-label="${f.incluido ? "Quitar" : "Poner"}">${f.incluido ? "✕" : "↺"}</button></div>`;
            }).join("")}</div>
            <label class="dpl-motivo">Motivo (opcional)<input type="text" maxlength="160" placeholder="Ej. Subió Sabritas 5%" value="${esc(est.motivo)}" oninput="plDuenoMotivo(this.value)"></label>
            <button type="button" class="dpl-principal" onclick="plDuenoAplicar()" ${incluidas.length ? "" : "disabled"}>Aplicar a ${incluidas.length} producto${incluidas.length === 1 ? "" : "s"}</button>` : `<p class="dpl-nota">Con ese cambio ningún precio se mueve.</p>`}`;
    }

    window.plDuenoVolver = function () { est.filas = null; pintarNuevo(); };
    window.plDuenoQuitar = function (i) { est.filas[i].incluido = !est.filas[i].incluido; pintarPrevia(); };
    window.plDuenoMotivo = function (t) { est.motivo = t; };

    window.plDuenoAplicar = async function () {
        const cambios = [];
        est.filas.filter(f => f.incluido).forEach(f => Object.entries(f.cambios).forEach(([campo, x]) => cambios.push({ productoId: f.p.id, campo, anterior: x.antes, nuevo: x.despues })));
        if (!cambios.length) return;

        const d = await window.NexoMovil.dialogo({ titulo: "¿Aplicar los cambios?", texto: `Se cambian ${cambios.length} precio${cambios.length === 1 ? "" : "s"}. Queda en el historial y puedes deshacerlo.`, aceptar: "Aplicar" });
        if (!d.ok) return;

        try {
            const r = await fetchAutenticado("/precios-lote/aplicar", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ cambios, motivo: est.motivo, usuario: (typeof duenoEmpleadoNombrePersona !== "undefined" && duenoEmpleadoNombrePersona) || "" }) });
            const omitidos = (r.omitidos || []).length;
            avisar(`Listo: ${r.aplicados} precio${r.aplicados === 1 ? "" : "s"} actualizado${r.aplicados === 1 ? "" : "s"}.${omitidos ? ` ${omitidos} se omitieron porque ya habían cambiado.` : ""}`);
            if (typeof refrescarCatalogoLocalDueno === "function") refrescarCatalogoLocalDueno().catch(() => {});
            est.productos = ((await fetchAutenticado("/productos")) || []).filter(p => Number(p.id) > 0);
            est.filas = null; est.elegidos = new Set(); est.cfg.valor = ""; est.motivo = ""; est.lotes = null; est.vista = "lotes";
            pintar();
        } catch (error) {
            avisar((error && error.message) || "No se pudo aplicar.");
        }
    };

    async function pintarLotes() {
        const c = document.getElementById("dplCuerpo");
        if (!c) return;
        if (!est.lotes) {
            c.innerHTML = `<p class="dpl-nota">Cargando…</p>`;
            try { est.lotes = (await fetchAutenticado("/precios-lote/lotes")).lotes || []; } catch (error) { est.lotes = []; }
            if (est.vista !== "lotes") return;
        }

        c.innerHTML = est.lotes.length ? est.lotes.map(l => `<div class="dpl-lote ${l.deshecho ? "fuera" : ""}"><div><b>${esc(l.motivo || "Cambio de precios")}</b><small>${esc(fechaHora(l.fecha))}${l.usuario ? " · " + esc(l.usuario) : ""} · ${l.productos} producto${l.productos === 1 ? "" : "s"}${l.promedioPct !== null ? ` · ${l.promedioPct >= 0 ? "+" : ""}${l.promedioPct}%` : ""}${l.deshecho ? " · Deshecho" : ""}</small></div>${l.deshecho ? "" : `<button type="button" onclick="plDuenoDeshacer('${esc(l.id)}')">Deshacer</button>`}</div>`).join("") : `<p class="dpl-nota">Todavía no has aplicado ningún lote de precios.</p>`;
    }

    window.plDuenoDeshacer = async function (id) {
        const d = await window.NexoMovil.dialogo({ titulo: "¿Deshacer este lote?", texto: "Los precios regresan a como estaban. Lo que alguien haya cambiado después no se toca.", aceptar: "Deshacer" });
        if (!d.ok) return;

        try {
            const r = await fetchAutenticado(`/precios-lote/${encodeURIComponent(id)}/deshacer`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
            const omitidos = (r.omitidos || []).length;
            avisar(`Se regresaron ${r.regresados} precio${r.regresados === 1 ? "" : "s"}.${omitidos ? ` ${omitidos} no se tocaron porque cambiaron después.` : ""}`);
            if (typeof refrescarCatalogoLocalDueno === "function") refrescarCatalogoLocalDueno().catch(() => {});
            est.productos = ((await fetchAutenticado("/productos")) || []).filter(p => Number(p.id) > 0);
            est.lotes = null;
            pintarLotes();
        } catch (error) {
            avisar((error && error.message) || "No se pudo deshacer.");
        }
    };

    // El renglon de Mas solo aparece si la funcion esta encendida.
    async function revisarFuncion() {
        if (typeof fetchAutenticado !== "function" || typeof tokenGuardado !== "function" || !tokenGuardado()) return;

        try {
            const datos = await fetchAutenticado("/funciones-beta");
            const encendida = datos && datos.funciones && datos.funciones.precios_lote === true;
            if (encendida !== Boolean(window.duenoPreciosLote)) { window.duenoPreciosLote = encendida; document.dispatchEvent(new CustomEvent("nexo-menu-simple-dueno")); }
        } catch (error) { /* sin conexion: se queda como estaba */ }
    }

    revisarFuncion();
})();
