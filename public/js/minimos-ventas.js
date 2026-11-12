// Minimos y maximos con tus ventas: Nexo propone, para cada producto que ya se vende, cuanto conviene tener como minimo (cuando hay que pedir) y como maximo
// (hasta donde llenar). Tu eliges cuales aplicar y se puede deshacer. Es una funcion nueva: solo aparece si se enciende en Nexo -> Funciones nuevas (minimos_ventas).
(function () {
    const esc = valor => String(valor ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
    const plano = texto => String(texto || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
    const aviso = (mensaje, tipo) => { if (typeof mostrarToastPOS === "function") mostrarToastPOS(mensaje, tipo ? { tipo } : undefined); };
    const quien = () => (typeof usuarioActual !== "undefined" && usuarioActual && (usuarioActual.nombre || usuarioActual.usuario)) || "";
    const fechaHora = valor => { const d = new Date(valor); return isNaN(d) ? "" : d.toLocaleString("es-MX", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }); };
    const n = valor => (valor === null || valor === undefined ? "—" : String(Number(valor)));
    const nProd = k => `${k} producto${k === 1 ? "" : "s"}`;

    let est = null;

    async function llamar(ruta, opciones = {}) {
        const r = await fetch(ruta, { ...opciones, headers: { "Content-Type": "application/json", ...(opciones.headers || {}) } });
        const datos = await r.json().catch(() => ({}));
        return { ok: r.ok && datos.ok !== false, datos };
    }

    async function cargar() {
        const [s, l] = await Promise.all([llamar(`/inventario/minimos-sugeridos?cobertura=${est.cobertura}`), llamar("/inventario/minimos-lotes")]);
        est.error = s.ok ? "" : (s.datos.error || "No pude calcular los mínimos");
        est.productos = (s.ok && s.datos.productos) || [];
        est.ventanaDias = (s.ok && s.datos.ventanaDias) || 0;
        est.sinEvidencia = (s.ok && s.datos.sinEvidencia) || 0;
        est.lotes = (l.ok && l.datos.lotes) || [];
        est.sel = new Set(est.productos.filter(p => !p.propio).map(p => p.id));
    }

    window.mostrarMinimosVentas = async function () {
        if (typeof ocultarPantallasPrincipales === "function") ocultarPantallasPrincipales();
        const pantalla = document.getElementById("pantallaMinimosVentas");
        if (!pantalla) return;
        pantalla.style.display = "block";
        if (typeof actualizarTopbarContexto === "function") actualizarTopbarContexto("Mínimos con tus ventas", "Cuánto conviene tener de cada cosa", "minimos-ventas");
        pantalla.innerHTML = `<div class="mv-shell"><p class="mv-vacio">Calculando con tus ventas…</p></div>`;
        est = { tab: "propuesta", cobertura: 14, q: "", productos: [], lotes: [], sel: new Set(), ventanaDias: 0, sinEvidencia: 0, error: "" };
        await cargar();
        pintar();
    };

    function visibles() {
        const q = plano(est.q).trim();
        return q ? est.productos.filter(p => plano(p.nombre).includes(q)) : est.productos;
    }

    function pintar() {
        const pantalla = document.getElementById("pantallaMinimosVentas");
        if (!pantalla || !est) return;
        pantalla.innerHTML = `<div class="mv-shell">
            <header class="mv-cab"><h2>Mínimos con tus ventas</h2><p>Con lo que vendiste en los últimos ${est.ventanaDias || 0} días, Nexo propone cuándo pedir (mínimo) y hasta dónde llenar (máximo). Así “Qué pedir” y “Sugerir pedido” piden mejor. Tú eliges y se puede deshacer.</p></header>
            <div class="mv-tabs">${[["propuesta", `Propuesta (${est.productos.length})`], ["lotes", `Cambios anteriores (${est.lotes.length})`]].map(([id, t]) => `<button type="button" class="${est.tab === id ? "activo" : ""}" onclick="mvTab('${id}')">${t}</button>`).join("")}</div>
            <div id="mvCuerpo">${est.tab === "propuesta" ? htmlPropuesta() : htmlLotes()}</div>
        </div>`;
    }

    window.mvTab = id => { est.tab = id; pintar(); };

    function htmlPropuesta() {
        if (est.error) return `<div class="mv-ok"><b>${esc(est.error)}</b></div>`;
        const cob = [[7, "1 semana"], [14, "2 semanas"], [30, "1 mes"]];
        const controles = `<div class="mv-barra">
            <label>El mínimo debe alcanzar para <select onchange="mvCobertura(this.value)">${cob.map(([d, t]) => `<option value="${d}" ${d === est.cobertura ? "selected" : ""}>${t} de ventas</option>`).join("")}</select></label>
            <input type="search" class="mv-buscar" placeholder="Buscar producto" value="${esc(est.q)}" oninput="mvBuscar(this.value)">
        </div>`;
        if (!est.productos.length) return controles + `<div class="mv-ok"><b>No hay cambios que proponer.</b><p>Los productos con ventas ya tienen un mínimo parecido, o todavía se han vendido muy poco (${est.sinEvidencia} con menos de 3 ventas).</p></div>`;

        const lista = visibles();
        return controles + `<p class="mv-nota">${nProd(est.productos.length)} con ventas suficientes. Los marcados con “tú lo pusiste” ya tenían un límite tuyo y no vienen elegidos. ${est.sinEvidencia ? `Otros ${est.sinEvidencia} se han vendido muy poco para calcular.` : ""}</p>
            <div class="mv-acciones"><button type="button" class="mv-sec" onclick="mvTodos(true)">Elegir todos</button><button type="button" class="mv-sec" onclick="mvTodos(false)">Quitar todos</button></div>
            <div class="mv-tabla">
                <div class="mv-fila mv-enc"><span></span><span>Producto</span><span>Vende por semana</span><span>Tienes</span><span>Mínimo</span><span>Máximo</span></div>
                ${lista.map(p => `<label class="mv-fila ${est.sel.has(p.id) ? "elegido" : ""}">
                    <input type="checkbox" ${est.sel.has(p.id) ? "checked" : ""} onchange="mvElegir(${p.id}, this.checked)">
                    <span class="mv-nombre"><b>${esc(p.nombre)}</b>${p.propio ? `<small>tú lo pusiste</small>` : ""}</span>
                    <span>${p.porSemana}</span><span>${n(p.stock)}</span>
                    <span class="mv-cambio">${n(p.minimoActual)} → <b>${p.minimo}</b></span>
                    <span class="mv-cambio">${n(p.maximoActual)} → <b>${p.maximo}</b></span>
                </label>`).join("")}
            </div>
            <div class="mv-pie"><button type="button" class="mv-principal" ${est.sel.size ? "" : "disabled"} onclick="mvAplicar()">Aplicar a ${nProd(est.sel.size)}</button></div>`;
    }

    window.mvCobertura = async valor => { est.cobertura = Number(valor); await cargar(); pintar(); };
    window.mvBuscar = valor => {
        est.q = valor;
        const cuerpo = document.getElementById("mvCuerpo");
        if (!cuerpo) return;
        const foco = cuerpo.querySelector(".mv-buscar");
        const pos = foco ? foco.selectionStart : 0;
        cuerpo.innerHTML = htmlPropuesta();
        const nuevo = cuerpo.querySelector(".mv-buscar");
        if (nuevo) { nuevo.focus(); try { nuevo.setSelectionRange(pos, pos); } catch (e) { /* tipo search */ } }
    };
    window.mvElegir = (id, marcado) => { if (marcado) est.sel.add(id); else est.sel.delete(id); pintar(); };
    window.mvTodos = marcado => { est.sel = marcado ? new Set(visibles().map(p => p.id)) : new Set(); pintar(); };

    window.mvAplicar = async () => {
        const items = est.productos.filter(p => est.sel.has(p.id)).map(p => ({ id: p.id, minimo: p.minimo, maximo: p.maximo }));
        if (!items.length) return;
        if (!confirm(`Se cambiará el mínimo y el máximo de ${nProd(items.length)}. Después puedes deshacerlo en “Cambios anteriores”. ¿Aplicar?`)) return;
        const r = await llamar("/inventario/minimos-aplicar", { method: "POST", body: JSON.stringify({ items, usuario: quien() }) });
        if (!r.ok) return aviso(r.datos.error || "No se pudo aplicar", "error");
        aviso(`Listo: ${nProd(r.datos.productos)} con mínimo y máximo nuevos`);
        await cargar();
        est.tab = "lotes";
        pintar();
    };

    function htmlLotes() {
        if (!est.lotes.length) return `<div class="mv-ok"><b>Todavía no has aplicado cambios.</b></div>`;
        return `<div class="mv-lotes">${est.lotes.map(l => `<div class="mv-lote">
            <div><b>${nProd(l.productos)}</b><small>${fechaHora(l.fecha)}${l.usuario ? ` · ${esc(l.usuario)}` : ""}</small></div>
            ${l.deshecho ? `<span class="mv-hecho">Deshecho</span>` : `<button type="button" class="mv-sec" onclick="mvDeshacer('${esc(l.id)}')">Deshacer</button>`}
        </div>`).join("")}</div>`;
    }

    window.mvDeshacer = async id => {
        if (!confirm("Los productos regresan al mínimo y máximo que tenían (si alguien los cambió después, se respetan). ¿Deshacer?")) return;
        const r = await llamar(`/inventario/minimos-lotes/${encodeURIComponent(id)}/deshacer`, { method: "POST", body: "{}" });
        if (!r.ok) return aviso(r.datos.error || "No se pudo deshacer", "error");
        aviso(`Regresaron ${nProd(r.datos.productos)}`);
        await cargar();
        pintar();
    };
})();
