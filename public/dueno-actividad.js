/* Actividad del equipo en el celular: "quien hizo que" para el dueno y "mi actividad" para cada empleado.
   Usa GET /actividad/equipo (permiso de reportes) o, si no lo tiene, GET /actividad/mia. Solo lee. */

(function () {
    let modoEquipo = true;
    let dias = "hoy";
    let personaFiltro = null;
    let capa = null;

    const esc = valor => (typeof escaparDueno === "function" ? escaparDueno(valor) : String(valor ?? ""));
    const dinero2 = valor => (typeof dinero === "function" ? dinero(valor) : "$" + Number(valor || 0).toFixed(2));

    async function llamar(ruta) {
        try {
            return { ok: true, datos: await fetchAutenticado(ruta) || {} };
        } catch (error) {
            return { ok: false, estado: error.status, datos: error.datos || { error: error.message } };
        }
    }

    function fechaLocal(desplazamiento = 0) {
        const f = new Date(new Date().toLocaleString("en-US", { timeZone: "America/Mexico_City" }));
        f.setDate(f.getDate() + desplazamiento);
        return `${f.getFullYear()}-${String(f.getMonth() + 1).padStart(2, "0")}-${String(f.getDate()).padStart(2, "0")}`;
    }

    function rangoDe(clave) {
        if (clave === "ayer") return { desde: fechaLocal(-1), hasta: fechaLocal(-1) };
        if (clave === "semana") return { desde: fechaLocal(-6), hasta: fechaLocal(0) };
        return { desde: fechaLocal(0), hasta: fechaLocal(0) };
    }

    // ---- Entrada en "Mas" ----

    async function insertarEntrada() {
        const destino = document.getElementById("duenoMasStatusCard");
        if (!destino || document.getElementById("daEntrada") || !(typeof haySesionActivaDueno === "function" && haySesionActivaDueno())) return;

        const boton = document.createElement("button");
        boton.type = "button";
        boton.id = "daEntrada";
        boton.className = "da-entrada";
        boton.innerHTML = `<span aria-hidden="true">🧾</span><b>Actividad del equipo</b><small>Quién hizo qué, ventas por persona y tiempo extra</small>`;
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

    // ---- Pantalla ----

    function obtenerCapa() {
        if (!capa) {
            capa = document.createElement("div");
            capa.id = "daCapa";
            capa.className = "da-capa";
            document.body.appendChild(capa);
        }

        capa.classList.add("abierta");
        return capa;
    }

    window.daCerrar = function () { capa?.classList.remove("abierta"); };
    window.daRango = function (clave) { dias = clave; cargar(); };
    window.daPersona = function (id) { personaFiltro = id; cargar(); };

    async function abrir() {
        modoEquipo = true;
        dias = "hoy";
        personaFiltro = null;
        cargar();
    }

    async function cargar() {
        const c = obtenerCapa();
        const { desde, hasta } = rangoDe(dias);
        c.innerHTML = encabezado(modoEquipo ? "Actividad del equipo" : "Mi actividad") + `<main class="da-cuerpo"><p class="da-nota">Cargando...</p></main>`;

        let r = modoEquipo
            ? await llamar(`/actividad/equipo?desde=${desde}&hasta=${hasta}${personaFiltro ? `&empleadoId=${personaFiltro}` : ""}`)
            : await llamar(`/actividad/mia?desde=${desde}&hasta=${hasta}`);

        // Sin permiso de reportes: se muestra solo su propia actividad.
        if (!r.ok && modoEquipo && (r.estado === 403 || r.datos?.requierePermiso)) {
            modoEquipo = false;
            r = await llamar(`/actividad/mia?desde=${desde}&hasta=${hasta}`);
        }

        const cuerpo = c.querySelector(".da-cuerpo");
        c.querySelector("h2").textContent = modoEquipo ? "Actividad del equipo" : "Mi actividad";

        if (!r.ok) { cuerpo.innerHTML = `<p class="da-nota">${esc(r.datos.error || "No se pudo cargar. Revisa tu internet.")}</p>`; return; }

        pintar(cuerpo, r.datos);
    }

    function encabezado(titulo) {
        return `<header class="da-cabecera"><button type="button" class="da-icono" onclick="daCerrar()" aria-label="Cerrar">&larr;</button><h2>${esc(titulo)}</h2><span class="da-icono da-vacio"></span></header>`;
    }

    function hora(valor) {
        return new Date(valor).toLocaleString("es-MX", { timeZone: "America/Mexico_City", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
    }

    function pintar(cuerpo, d) {
        const chips = [["hoy", "Hoy"], ["ayer", "Ayer"], ["semana", "7 días"]];
        const personas = d.personas || [];
        const total = personas.reduce((s, p) => s + p.total, 0);
        const ventas = personas.reduce((s, p) => s + p.ventas, 0);

        cuerpo.innerHTML = `
        <div class="da-chips">${chips.map(([clave, texto]) => `<button type="button" class="${dias === clave ? "activo" : ""}" onclick="daRango('${clave}')">${texto}</button>`).join("")}</div>
        ${modoEquipo && personas.length > 1 || personaFiltro ? `<div class="da-chips da-personas"><button type="button" class="${personaFiltro ? "" : "activo"}" onclick="daPersona(null)">Todos</button>${(window.__daTodos || personas).map(p => `<button type="button" class="${personaFiltro === p.empleadoId ? "activo" : ""}" onclick="daPersona(${p.empleadoId})">${esc(p.nombre)}</button>`).join("")}</div>` : ""}
        ${!personaFiltro && modoEquipo ? `<div class="da-resumen"><div><strong>${ventas}</strong><span>ventas</span></div><div><strong>${dinero2(total)}</strong><span>vendido</span></div></div>` : ""}
        ${personas.map(p => `
        <article class="da-persona">
            <div class="da-persona-cab"><span class="da-avatar" style="background:${esc(p.colorAvatar || "#1d5fd1")}">${esc(String(p.nombre).charAt(0).toUpperCase())}</span><b>${esc(p.nombre)}</b><small>${esc(p.rol || "")}</small></div>
            <div class="da-datos">
                <div><strong>${p.ventas}</strong><span>ventas</span></div>
                <div><strong>${dinero2(p.total)}</strong><span>vendido</span></div>
                <div class="${p.canceladas ? "alerta" : ""}"><strong>${p.canceladas}</strong><span>canceladas</span></div>
                <div><strong>${p.turnos}</strong><span>cajas abiertas</span></div>
                <div class="${p.horasExtra ? "extra" : ""}"><strong>${p.horasExtra} h</strong><span>tiempo extra</span></div>
            </div>
            ${p.acciones.length ? `<ul class="da-acciones">${p.acciones.map(a => `<li>${esc(a.texto)} <b>×${a.n}</b></li>`).join("")}</ul>` : ""}
        </article>`).join("") || `<p class="da-nota">Sin personas con PIN todavía.</p>`}
        ${d.sinAsignar?.length ? `<p class="da-nota">Ventas con un nombre que no es de ningún empleado: ${d.sinAsignar.map(s => `${esc(s.cajero)} (${s.ventas})`).join(", ")}.</p>` : ""}
        <h3 class="da-titulo">Qué hizo cada quien</h3>
        <ul class="da-detalle">${(d.detalle || []).map(x => `<li><span>${esc(hora(x.cuando))}</span><b>${esc(x.empleado)}</b> ${esc(x.texto)}</li>`).join("") || `<li class="da-nota">Nada registrado en estos días.</li>`}</ul>`;

        if (!window.__daTodos && modoEquipo && !personaFiltro) window.__daTodos = personas;
    }
})();
