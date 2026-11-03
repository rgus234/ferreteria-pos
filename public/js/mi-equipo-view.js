/* Mi equipo (computadora): las personas que trabajan en el negocio, sus tareas y los avisos, en una sola pantalla.
   Hoy · Programadas (tareas de una vez o repetitivas, varias por dia) · Avisos · Personas (quien es encargado de tareas).
   Crear a alguien nuevo (PIN, permisos, horario) sigue siendo Configuracion -> Usuarios: aqui hay un boton que lleva directo.
   Servidor: tareas-equipo-server.js (mismas rutas que usa el celular). */
(function () {
    const E = { tab: "hoy", hoy: null, programadas: [], avisos: [], personas: [], form: null };
    const DIAS = [["1", "Lun"], ["2", "Mar"], ["3", "Mié"], ["4", "Jue"], ["5", "Vie"], ["6", "Sáb"], ["7", "Dom"]];

    const esc = valor => String(valor ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
    const hoyISO = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Mexico_City" }).format(new Date());
    const aviso = (texto, tipo) => { if (typeof mostrarToastPOS === "function") mostrarToastPOS(texto, tipo ? { tipo } : undefined); };
    const pantalla = () => document.getElementById("pantallaMiEquipo");

    async function api(ruta, metodo = "GET", cuerpo) {
        const respuesta = await fetch(ruta, cuerpo === undefined ? { method: metodo } : { method: metodo, headers: { "Content-Type": "application/json" }, body: JSON.stringify(cuerpo) });
        const datos = await respuesta.json().catch(() => ({}));
        if (!respuesta.ok || datos.ok === false) throw new Error(datos.error || "No se pudo completar.");
        return datos;
    }

    function fechaCorta(iso) { return iso ? new Date(`${iso}T00:00:00`).toLocaleDateString("es-MX", { day: "numeric", month: "short" }) : ""; }
    function cuando(iso) { const f = new Date(iso); return f.toLocaleDateString("es-MX", { day: "numeric", month: "short" }) + " " + f.toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit" }); }

    window.mostrarMiEquipo = async function (tab) {
        if (typeof ocultarPantallasPrincipales === "function") ocultarPantallasPrincipales();
        const p = pantalla();
        if (!p) return;
        p.style.display = "block";
        if (typeof actualizarTopbarContexto === "function") actualizarTopbarContexto("Mi equipo", "Personas, tareas y avisos", "mi-equipo");

        E.tab = tab || E.tab || "hoy";
        E.form = null;
        p.innerHTML = `<div class="eq"><p class="eq-cargando">Cargando…</p></div>`;
        await cargar();
    };

    async function cargar() {
        try {
            E.hoy = await api("/tareas/hoy");
            E.avisos = (await api("/avisos")).avisos;
            E.personas = (await api("/equipo/personas")).personas;
            E.programadas = E.hoy.esGestor ? (await api("/tareas")).tareas : [];
        } catch (error) {
            pantalla().innerHTML = `<div class="eq"><p class="eq-vacio">${esc(error.message)}</p></div>`;
            return;
        }

        pintar();
    }

    function pintar() {
        const gestor = E.hoy.esGestor;
        const pestanas = [["hoy", "Hoy"], ...(gestor ? [["programadas", "Programadas"]] : []), ["avisos", "Avisos"], ["personas", "Personas"]];
        if (!pestanas.some(([c]) => c === E.tab)) E.tab = "hoy";

        pantalla().innerHTML = `<div class="eq">
            <header class="eq-cab"><div><h2>Mi equipo</h2><p>Las personas que trabajan contigo, lo que les toca hacer y lo que quieres avisarles.</p></div></header>
            <nav class="eq-pestanas" role="tablist">${pestanas.map(([c, n]) => `<button type="button" role="tab" class="${E.tab === c ? "activo" : ""}" onclick="eqPestana('${c}')">${n}${c === "hoy" && E.hoy.resumen.total ? ` <i>${E.hoy.resumen.hechas}/${E.hoy.resumen.total}</i>` : ""}</button>`).join("")}</nav>
            <section class="eq-cuerpo">${E.form ? htmlFormulario() : E.tab === "hoy" ? htmlHoy() : E.tab === "programadas" ? htmlProgramadas() : E.tab === "avisos" ? htmlAvisos() : htmlPersonas()}</section>
        </div>`;
    }

    window.eqPestana = c => { E.tab = c; E.form = null; pintar(); };

    // ---------- Hoy ----------
    function htmlHoy() {
        const { tareas, resumen } = E.hoy;
        if (!tareas.length) return `<p class="eq-vacio"><b>No hay tareas para hoy</b>${E.hoy.esGestor ? `Crea la primera en “Programadas”: una sola vez o que se repita.` : "Cuando te asignen una te aparece aquí."}</p>`;

        return `<div class="eq-progreso"><span><b>${resumen.hechas} de ${resumen.total}</b> hechas hoy</span><div class="eq-barra"><i style="width:${Math.round((resumen.hechas / resumen.total) * 100)}%"></i></div></div>
            <ul class="eq-lista">${tareas.map(t => `<li class="eq-fila${t.hecha ? " hecha" : ""}">
                <button type="button" class="eq-check" aria-pressed="${t.hecha}" aria-label="${t.hecha ? "Desmarcar" : "Marcar como hecha"}: ${esc(t.titulo)}" onclick="eqMarcar(${t.id}, ${!t.hecha})">${t.hecha ? "✓" : ""}</button>
                <div class="eq-texto"><b>${esc(t.titulo)}</b>${t.detalle ? `<span>${esc(t.detalle)}</span>` : ""}
                    <small>${t.hora ? `🕒 ${esc(t.hora)} · ` : ""}${esc(t.asignadoNombre)}${t.repite !== "no" ? ` · ${esc(t.repeticion)}` : ""}${t.hecha && t.hechaPor ? ` · hecha por ${esc(t.hechaPor)}` : ""}</small></div>
            </li>`).join("")}</ul>`;
    }

    window.eqMarcar = async function (id, hecha) {
        try { await api(`/tareas/${id}/hecha`, "POST", { hecha }); await cargar(); } catch (error) { aviso(error.message, "error"); }
    };

    // ---------- Programadas ----------
    function htmlProgramadas() {
        return `<div class="eq-barra-acciones"><button type="button" class="eq-primario" onclick="eqNueva()">+ Nueva tarea</button></div>
            ${E.programadas.length ? `<ul class="eq-lista">${E.programadas.map(t => `<li class="eq-fila${t.pasada ? " hecha" : ""}">
                <div class="eq-texto" style="flex:1"><b>${esc(t.titulo)}</b>
                    <small>${t.hora ? `🕒 ${esc(t.hora)} · ` : ""}${esc(t.asignadoNombre)} · ${esc(t.repeticion)}${t.repite === "no" ? ` · ${esc(fechaCorta(t.fecha))}` : ""}</small></div>
                <button type="button" class="eq-chico" onclick="eqEditar(${t.id})">Editar</button>
            </li>`).join("")}</ul>` : `<p class="eq-vacio"><b>Todavía no hay tareas</b>Crea una que se repita (“cada lunes revisar caducidades”) o una de una sola vez. Puedes poner varias el mismo día.</p>`}`;
    }

    window.eqNueva = () => { E.form = { id: null, titulo: "", detalle: "", asignadoA: "", repite: "no", diasSemana: ["1"], diaMes: String(new Date().getDate()), fecha: hoyISO(), hora: "" }; pintar(); };
    window.eqEditar = id => {
        const t = E.programadas.find(x => x.id === id);
        if (!t) return;
        E.form = { id, titulo: t.titulo, detalle: t.detalle || "", asignadoA: t.asignadoA ? String(t.asignadoA) : "", repite: t.repite, diasSemana: (t.diasSemana || []).map(String), diaMes: String(t.diaMes || new Date().getDate()), fecha: t.fecha, hora: t.hora || "" };
        pintar();
    };

    function htmlFormulario() {
        const f = E.form;
        return `<form class="eq-form" onsubmit="eqGuardar(event)">
            <h3>${f.id ? "Editar tarea" : "Nueva tarea"}</h3>
            <label>¿Qué hay que hacer?<input type="text" maxlength="120" value="${esc(f.titulo)}" placeholder="Ej. Revisar caducidades" oninput="eqCampo('titulo', this.value)" required></label>
            <label>Detalle (opcional)<input type="text" maxlength="500" value="${esc(f.detalle)}" placeholder="Ej. Lácteos y botanas" oninput="eqCampo('detalle', this.value)"></label>
            <label>¿Para quién?<select onchange="eqCampo('asignadoA', this.value)"><option value="">Todo el equipo</option>${E.personas.map(p => `<option value="${p.id}" ${String(p.id) === f.asignadoA ? "selected" : ""}>${esc(p.nombre)}</option>`).join("")}</select></label>
            <div class="eq-grupo">¿Cada cuándo?<div class="eq-opciones">${[["no", "Una vez"], ["diaria", "Todos los días"], ["semanal", "Ciertos días"], ["mensual", "Cada mes"]].map(([c, n]) => `<button type="button" class="${f.repite === c ? "activo" : ""}" onclick="eqRepite('${c}')">${n}</button>`).join("")}</div></div>
            ${f.repite === "semanal" ? `<div class="eq-grupo">Días<div class="eq-opciones">${DIAS.map(([n, nombre]) => `<button type="button" class="${f.diasSemana.includes(n) ? "activo" : ""}" onclick="eqDia('${n}')">${nombre}</button>`).join("")}</div></div>` : ""}
            ${f.repite === "mensual" ? `<label>Día del mes<input type="number" min="1" max="31" value="${esc(f.diaMes)}" oninput="eqCampo('diaMes', this.value)"></label>` : ""}
            <div class="eq-dos"><label>${f.repite === "no" ? "¿Qué día?" : "Desde el día"}<input type="date" value="${esc(f.fecha)}" onchange="eqCampo('fecha', this.value)"></label>
                <label>Hora (opcional)<input type="time" value="${esc(f.hora)}" onchange="eqCampo('hora', this.value)"></label></div>
            <p class="eq-error" id="eqError" hidden></p>
            <div class="eq-acciones"><button type="submit" class="eq-primario">${f.id ? "Guardar cambios" : "Crear tarea"}</button>
                <button type="button" class="eq-sec" onclick="eqCancelar()">Cancelar</button>
                ${f.id ? `<button type="button" class="eq-peligro" onclick="eqBorrar()">Quitar esta tarea</button>` : ""}</div>
        </form>`;
    }

    window.eqCampo = (campo, valor) => { E.form[campo] = valor; };
    window.eqRepite = c => { E.form.repite = c; pintar(); };
    window.eqDia = n => { const d = E.form.diasSemana; E.form.diasSemana = d.includes(n) ? d.filter(x => x !== n) : [...d, n]; pintar(); };
    window.eqCancelar = () => { E.form = null; pintar(); };

    function errorForm(texto) { const c = document.getElementById("eqError"); if (c) { c.textContent = texto; c.hidden = !texto; } }

    window.eqGuardar = async function (evento) {
        evento.preventDefault();
        const f = E.form;
        if (f.repite === "semanal" && !f.diasSemana.length) return errorForm("Elige al menos un día.");

        const cuerpo = { titulo: f.titulo, detalle: f.detalle, asignadoA: f.asignadoA ? Number(f.asignadoA) : null, repite: f.repite, diasSemana: f.diasSemana.map(Number), diaMes: Number(f.diaMes), fecha: f.fecha, hora: f.hora || null };

        try {
            await (f.id ? api(`/tareas/${f.id}`, "PUT", cuerpo) : api("/tareas", "POST", cuerpo));
            aviso(f.id ? "Tarea guardada." : "Tarea creada.");
            E.form = null;
            await cargar();
        } catch (error) { errorForm(error.message); }
    };

    window.eqBorrar = async function () {
        try { await api(`/tareas/${E.form.id}`, "DELETE"); aviso("Tarea quitada."); E.form = null; await cargar(); } catch (error) { errorForm(error.message); }
    };

    // ---------- Avisos ----------
    function htmlAvisos() {
        const gestor = E.hoy.esGestor;
        return `${gestor ? `<form class="eq-form eq-form-aviso" onsubmit="eqEnviarAviso(event)">
                <h3>Aviso nuevo</h3>
                <label>Mensaje<input type="text" id="eqAviso" maxlength="400" placeholder="Ej. Mañana abrimos a las 8" autocomplete="off" required></label>
                <label>¿Para quién?<select id="eqAvisoPara"><option value="">Todo el equipo</option>${E.personas.map(p => `<option value="${p.id}">${esc(p.nombre)}</option>`).join("")}</select></label>
                <div class="eq-acciones"><button type="submit" class="eq-primario">Enviar aviso</button></div>
            </form>` : ""}
            ${E.avisos.length ? `<ul class="eq-lista">${E.avisos.map(a => `<li class="eq-fila"><div class="eq-texto" style="flex:1"><b>${esc(a.mensaje)}</b><small>${esc(a.de)} · ${esc(a.paraNombre)} · ${esc(cuando(a.cuando))}</small></div>${gestor ? `<button type="button" class="eq-chico" onclick="eqQuitarAviso(${a.id})">Quitar</button>` : ""}</li>`).join("")}</ul>` : `<p class="eq-vacio"><b>No hay avisos</b>Los mensajes llegan al celular de tu equipo como notificación.</p>`}`;
    }

    window.eqEnviarAviso = async function (evento) {
        evento.preventDefault();
        try {
            await api("/avisos", "POST", { mensaje: document.getElementById("eqAviso").value, para: Number(document.getElementById("eqAvisoPara").value) || null });
            aviso("Aviso enviado.");
            await cargar();
        } catch (error) { aviso(error.message, "error"); }
    };

    window.eqQuitarAviso = async function (id) {
        try { await api(`/avisos/${id}`, "DELETE"); await cargar(); } catch (error) { aviso(error.message, "error"); }
    };

    // ---------- Personas ----------
    function htmlPersonas() {
        const gestor = E.hoy.esGestor;
        const ayuda = `<p class="eq-nota">Cada persona entra con su PIN y ve solo lo que le toca. Ahí le pones lo que puede hacer y su horario.</p>`;
        const agregar = `<button type="button" class="eq-primario" onclick="eqAgregarPersona()">+ Agregar a alguien del equipo</button>`;

        if (E.personas.length <= 1) {
            return `<div class="eq-bienvenida"><h3>¿Alguien más trabaja contigo?</h3>
                <p>Dales su propio perfil con PIN, elige qué pueden hacer y, desde aquí, mándales tareas y avisos. Lo puedes hacer cuando quieras.</p>
                ${agregar}</div>`;
        }

        return `<div class="eq-barra-acciones">${agregar}</div>${ayuda}
            <ul class="eq-lista">${E.personas.map(p => `<li class="eq-fila"><div class="eq-avatar" aria-hidden="true">${esc(String(p.nombre).slice(0, 1).toUpperCase())}</div>
                <div class="eq-texto" style="flex:1"><b>${esc(p.nombre)}</b><small>${esc(p.rol || "")}${p.gestorTareas && p.rol !== "Administrador" ? " · encargado de tareas" : ""}</small></div>
                ${gestor && p.rol !== "Administrador" ? `<button type="button" class="eq-chico" onclick="eqAlternarEncargado(${p.id}, ${!p.gestorTareas})">${p.gestorTareas ? "Quitar permiso de tareas" : "Puede crear tareas"}</button>` : ""}
            </li>`).join("")}</ul>`;
    }

    window.eqAgregarPersona = function () {
        if (typeof mostrarConfiguracion === "function") mostrarConfiguracion();
        if (typeof cambiarTabConfiguracion === "function") cambiarTabConfiguracion("usuarios");
    };

    window.eqAlternarEncargado = async function (id, permitido) {
        try {
            await api(`/equipo/${id}/gestor-tareas`, "PUT", { permitido });
            aviso(permitido ? "Ahora puede crear tareas y avisos." : "Ya no puede crear tareas.");
            await cargar();
        } catch (error) { aviso(error.message, "error"); }
    };
})();

// ---------- tarjeta en el Inicio ----------
// Sin equipo todavia: invita a crearlo. Con tareas hoy: el avance. Un negocio que ya tiene equipo y no usa tareas no ve nada.
(function () {
    const LLAVE_CERRADA = "nexoEquipoTarjetaCerrada";
    let ultima = null;
    let vigilante = null;

    async function pintarTarjetaInicio() {
        const inicio = document.getElementById("pantallaInicio");
        if (!inicio) return;

        let datos;
        try {
            const [hoy, personas] = await Promise.all([fetch("/tareas/hoy").then(r => r.json()), fetch("/equipo/personas").then(r => r.json())]);
            if (!hoy.ok || !personas.ok) return;
            datos = { hoy, personas: personas.personas };
        } catch (error) { return; }

        inicio.querySelector("#eqTarjetaInicio")?.remove();

        const total = datos.hoy.resumen.total;
        let cerrada = false;
        try { cerrada = localStorage.getItem(LLAVE_CERRADA) === "1"; } catch (error) { /* sin almacenamiento */ }

        let html = "";

        if (total > 0) {
            html = `<button type="button" class="eq-inicio-cuerpo" onclick="mostrarMiEquipo('hoy')"><span class="eq-inicio-icono">✓</span><span><b>Tareas del equipo hoy: ${datos.hoy.resumen.hechas} de ${total}</b><small>Toca para ver quién ya cumplió</small></span></button>`;
        } else if (datos.personas.length <= 1 && !cerrada) {
            html = `<button type="button" class="eq-inicio-cuerpo" onclick="mostrarMiEquipo('personas')"><span class="eq-inicio-icono">👥</span><span><b>¿Alguien más trabaja contigo?</b><small>Dales su perfil con PIN, elige qué pueden hacer y mándales tareas y avisos</small></span></button>
                <button type="button" class="eq-inicio-cerrar" aria-label="Ahora no" onclick="eqCerrarTarjetaInicio()">✕</button>`;
        }

        if (!html) { ultima = null; return; }
        const tarjeta = document.createElement("div");
        tarjeta.id = "eqTarjetaInicio";
        tarjeta.className = "eq-inicio";
        tarjeta.innerHTML = html;
        ultima = tarjeta;
        inicio.insertBefore(tarjeta, inicio.firstChild);

        // el Inicio de abarrotes se vuelve a dibujar solo: la tarjeta se vuelve a poner si se lleva
        if (!vigilante) {
            vigilante = new MutationObserver(() => { if (ultima && !inicio.contains(ultima)) inicio.insertBefore(ultima, inicio.firstChild); });
            vigilante.observe(inicio, { childList: true });
        }
    }

    window.eqCerrarTarjetaInicio = function () {
        try { localStorage.setItem(LLAVE_CERRADA, "1"); } catch (error) { /* sin almacenamiento */ }
        ultima = null;
        document.getElementById("eqTarjetaInicio")?.remove();
    };

    const original = window.mostrarInicio;
    if (typeof original === "function") {
        window.mostrarInicio = async function (...args) {
            const resultado = await original.apply(this, args);
            pintarTarjetaInicio();
            return resultado;
        };
    }
})();
