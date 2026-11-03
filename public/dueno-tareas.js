/* Tareas y avisos del equipo (celular).
   - Todos: "Hoy" con lo que les toca (marcan hecha con un toque) y los avisos que les mandaron.
   - Dueño o encargado (permiso gestionar_tareas): ademas crean tareas de una vez o repetitivas, varias por dia, para una persona o para todos, y avisos.
   Un boton flotante "Tareas 2/5" lleva directo; tambien esta en Mas -> Tareas y avisos. Servidor: tareas-equipo-server.js. */
(function () {
    const E = { tab: "hoy", hoy: null, programadas: [], avisos: [], personas: [], form: null, cargando: false };
    const DIAS_CORTOS = [["1", "L"], ["2", "M"], ["3", "M"], ["4", "J"], ["5", "V"], ["6", "S"], ["7", "D"]];
    const DIAS_LARGOS = { 1: "Lunes", 2: "Martes", 3: "Miércoles", 4: "Jueves", 5: "Viernes", 6: "Sábado", 7: "Domingo" };

    const esc = valor => (typeof escaparDueno === "function" ? escaparDueno(valor) : String(valor ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])));
    const aviso = texto => { if (typeof mostrarToastDueno === "function") mostrarToastDueno(texto); };
    const hoyISO = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Mexico_City" }).format(new Date());

    function api(ruta, metodo = "GET", cuerpo) {
        return fetchAutenticado(ruta, cuerpo === undefined ? { method: metodo } : { method: metodo, headers: { "Content-Type": "application/json" }, body: JSON.stringify(cuerpo) });
    }

    function hayTabs() { const tabs = document.getElementById("duenoTabs"); return Boolean(tabs && tabs.style.display !== "none"); }

    // ---------- boton flotante + insignia ----------
    function asegurarPildora() {
        let pildora = document.getElementById("duenoTareasPildora");

        if (!pildora) {
            pildora = document.createElement("button");
            pildora.type = "button";
            pildora.id = "duenoTareasPildora";
            pildora.className = "dueno-tareas-pildora";
            pildora.hidden = true;
            pildora.onclick = () => window.abrirTareasDueno("hoy");
            document.body.appendChild(pildora);
        }

        return pildora;
    }

    function pintarPildora() {
        const pildora = asegurarPildora();
        const r = E.hoy?.resumen;
        const abierta = document.getElementById("duenoTareasOverlay")?.classList.contains("abierta");
        const pendientes = r ? r.total - r.hechas : 0;

        pildora.hidden = !(hayTabs() && r && r.total > 0 && !abierta);
        pildora.classList.toggle("lista", Boolean(r) && r.total > 0 && pendientes === 0);
        pildora.innerHTML = r ? `<span aria-hidden="true">${pendientes === 0 ? "✓" : "☑"}</span> Tareas <b>${r.hechas}/${r.total}</b>` : "";

        document.querySelectorAll(".dueno-tareas-insignia").forEach(el => { el.textContent = pendientes > 0 ? String(pendientes) : ""; el.style.display = pendientes > 0 ? "" : "none"; });
    }

    async function refrescarResumen() {
        if (!hayTabs() || E.cargando) return;
        try { E.hoy = await api("/tareas/hoy"); } catch (error) { return; }
        pintarPildora();
    }

    // ---------- pantalla ----------
    function asegurarOverlay() {
        let overlay = document.getElementById("duenoTareasOverlay");

        if (!overlay) {
            overlay = document.createElement("div");
            overlay.id = "duenoTareasOverlay";
            overlay.className = "dueno-mas-subpantalla";
            overlay.style.zIndex = "44";
            overlay.innerHTML = `<div class="dueno-subpantalla-inner" style="padding-bottom:110px;">
                <div class="dueno-subpantalla-header">
                    <button type="button" class="dueno-subpantalla-atras" onclick="cerrarTareasDueno()">&lsaquo; Atrás</button>
                    <h2>Tareas y avisos</h2>
                </div>
                <div id="duenoTareasContenido"></div>
            </div>`;
            document.body.appendChild(overlay);
        }

        return overlay;
    }

    const contenido = () => document.getElementById("duenoTareasContenido");

    window.abrirTareasDueno = async function (tab) {
        asegurarOverlay().classList.add("abierta");
        E.tab = tab || "hoy";
        E.form = null;
        pintarPildora();
        await cargarTodo();
    };

    window.cerrarTareasDueno = function () {
        document.getElementById("duenoTareasOverlay")?.classList.remove("abierta");
        refrescarResumen();
    };

    async function cargarTodo() {
        E.cargando = true;
        contenido().innerHTML = `<p class="dueno-estado">Cargando...</p>`;

        try {
            E.hoy = await api("/tareas/hoy");
            E.avisos = (await api("/avisos")).avisos;

            if (E.hoy.esGestor) {
                E.programadas = (await api("/tareas")).tareas;
                E.personas = (await api("/equipo/personas")).personas;
            }
        } catch (error) {
            contenido().innerHTML = `<div class="vacio">${esc(error.message || "No se pudo cargar.")}</div><button type="button" class="dueno-link" onclick="abrirTareasDueno()">Reintentar</button>`;
            E.cargando = false;
            return;
        }

        E.cargando = false;
        pintar();
        pintarPildora();
    }

    function pintar() {
        if (E.form) { pintarFormulario(); return; }

        const gestor = E.hoy?.esGestor;
        const pestanas = [["hoy", "Hoy"], ...(gestor ? [["programadas", "Programadas"]] : []), ["avisos", "Avisos"]];

        contenido().innerHTML = `
            <div class="dt-pestanas" role="tablist">${pestanas.map(([clave, nombre]) => `<button type="button" role="tab" class="${E.tab === clave ? "activo" : ""}" onclick="dtPestana('${clave}')">${nombre}</button>`).join("")}</div>
            ${E.tab === "hoy" ? htmlHoy() : E.tab === "programadas" ? htmlProgramadas() : htmlAvisos()}`;
    }

    window.dtPestana = function (clave) { E.tab = clave; pintar(); };

    // ---------- hoy ----------
    function htmlHoy() {
        const { tareas, resumen } = E.hoy;

        if (!tareas.length) {
            return `<div class="dt-vacio"><b>No tienes tareas hoy</b><p>${E.hoy.esGestor ? "Crea la primera en “Programadas”." : "Cuando te asignen una, te aparece aquí."}</p></div>`;
        }

        const porcentaje = Math.round((resumen.hechas / resumen.total) * 100);

        return `<div class="dt-progreso"><div><b>${resumen.hechas} de ${resumen.total}</b> hechas hoy</div><div class="dt-barra"><i style="width:${porcentaje}%"></i></div></div>
            <ul class="dt-lista">${tareas.map(t => `<li class="dt-tarea${t.hecha ? " hecha" : ""}">
                <button type="button" class="dt-check" aria-pressed="${t.hecha}" aria-label="${t.hecha ? "Desmarcar" : "Marcar como hecha"}: ${esc(t.titulo)}" onclick="dtMarcar(${t.id}, ${!t.hecha})">${t.hecha ? "✓" : ""}</button>
                <div class="dt-texto">
                    <b>${esc(t.titulo)}</b>
                    ${t.detalle ? `<span>${esc(t.detalle)}</span>` : ""}
                    <small>${t.hora ? `🕒 ${esc(t.hora)} · ` : ""}${esc(t.asignadoNombre)}${t.repite !== "no" ? ` · ${esc(t.repeticion)}` : ""}${t.hecha && t.hechaPor ? ` · hecha por ${esc(t.hechaPor)}` : ""}</small>
                </div>
            </li>`).join("")}</ul>`;
    }

    window.dtMarcar = async function (id, hecha) {
        const t = E.hoy.tareas.find(x => x.id === id);
        if (t) { t.hecha = hecha; E.hoy.resumen.hechas += hecha ? 1 : -1; pintar(); pintarPildora(); }

        try { await api(`/tareas/${id}/hecha`, "POST", { hecha }); }
        catch (error) { aviso(error.message || "No se pudo guardar."); await cargarTodo(); }
    };

    // ---------- programadas (solo dueño / encargado) ----------
    function htmlProgramadas() {
        const activas = E.programadas;

        return `<button type="button" class="dueno-boton-primario" onclick="dtNueva()">+ Nueva tarea</button>
            ${activas.length ? `<ul class="dt-lista">${activas.map(t => `<li class="dt-tarea${t.pasada ? " hecha" : ""}">
                <div class="dt-texto" style="flex:1">
                    <b>${esc(t.titulo)}</b>
                    <small>${t.hora ? `🕒 ${esc(t.hora)} · ` : ""}${esc(t.asignadoNombre)} · ${esc(t.repeticion)}${t.repite === "no" ? ` · ${esc(fechaCorta(t.fecha))}` : ""}</small>
                </div>
                <button type="button" class="dt-mini" onclick="dtEditar(${t.id})">Editar</button>
            </li>`).join("")}</ul>` : `<div class="dt-vacio"><b>Todavía no hay tareas</b><p>Crea una que se repita (“cada lunes revisar caducidades”) o de una sola vez.</p></div>`}`;
    }

    function fechaCorta(iso) { return iso ? new Date(`${iso}T00:00:00`).toLocaleDateString("es-MX", { day: "numeric", month: "short" }) : ""; }

    window.dtNueva = function () {
        E.form = { id: null, titulo: "", detalle: "", asignadoA: "", repite: "no", diasSemana: ["1"], diaMes: String(new Date().getDate()), fecha: hoyISO(), hora: "" };
        pintar();
    };

    window.dtEditar = function (id) {
        const t = E.programadas.find(x => x.id === id);
        if (!t) return;
        E.form = { id, titulo: t.titulo, detalle: t.detalle || "", asignadoA: t.asignadoA ? String(t.asignadoA) : "", repite: t.repite, diasSemana: (t.diasSemana || []).map(String), diaMes: String(t.diaMes || new Date().getDate()), fecha: t.fecha, hora: t.hora || "" };
        pintar();
    };

    function pintarFormulario() {
        const f = E.form;
        const opcionesRepite = [["no", "Una vez"], ["diaria", "Todos los días"], ["semanal", "Ciertos días"], ["mensual", "Cada mes"]];

        contenido().innerHTML = `
            <button type="button" class="dueno-link" style="margin-bottom:10px;" onclick="dtCancelar()">&lsaquo; Volver</button>
            <article class="dueno-card">
                <div class="card-head"><div><span>${f.id ? "Editar" : "Nueva"}</span><h2>Tarea</h2></div></div>
                <label class="dueno-campo">¿Qué hay que hacer?
                    <input type="text" id="dtTitulo" maxlength="120" value="${esc(f.titulo)}" placeholder="Ej. Revisar caducidades" oninput="dtCampo('titulo', this.value)">
                </label>
                <label class="dueno-campo">Detalle (opcional)
                    <input type="text" id="dtDetalle" maxlength="500" value="${esc(f.detalle)}" placeholder="Ej. Lácteos y botanas" oninput="dtCampo('detalle', this.value)">
                </label>
                <label class="dueno-campo">¿Para quién?
                    <select onchange="dtCampo('asignadoA', this.value)">
                        <option value="">Todo el equipo</option>
                        ${E.personas.map(p => `<option value="${p.id}" ${String(p.id) === f.asignadoA ? "selected" : ""}>${esc(p.nombre)}</option>`).join("")}
                    </select>
                </label>
                <div class="dueno-campo">¿Cada cuándo?
                    <div class="dt-opciones">${opcionesRepite.map(([clave, nombre]) => `<button type="button" class="${f.repite === clave ? "activo" : ""}" onclick="dtRepite('${clave}')">${nombre}</button>`).join("")}</div>
                </div>
                ${f.repite === "semanal" ? `<div class="dueno-campo">Días<div class="dt-dias">${DIAS_CORTOS.map(([n, letra]) => `<button type="button" class="${f.diasSemana.includes(n) ? "activo" : ""}" aria-label="${DIAS_LARGOS[n]}" onclick="dtDia('${n}')">${letra}</button>`).join("")}</div></div>` : ""}
                ${f.repite === "mensual" ? `<label class="dueno-campo">Día del mes<input type="number" min="1" max="31" inputmode="numeric" value="${esc(f.diaMes)}" oninput="dtCampo('diaMes', this.value)"></label>` : ""}
                <label class="dueno-campo">${f.repite === "no" ? "¿Qué día?" : "Desde el día"}
                    <input type="date" value="${esc(f.fecha)}" onchange="dtCampo('fecha', this.value)">
                </label>
                <label class="dueno-campo">Hora (opcional)
                    <input type="time" value="${esc(f.hora)}" onchange="dtCampo('hora', this.value)">
                </label>
                <p id="dtError" class="dueno-login-error" style="display:none;"></p>
                <button type="button" class="dueno-boton-primario" id="dtGuardar" onclick="dtGuardar()">${f.id ? "Guardar cambios" : "Crear tarea"}</button>
                ${f.id ? `<button type="button" class="dueno-boton-secundario" onclick="dtBorrar()">Quitar esta tarea</button>` : ""}
            </article>`;
    }

    window.dtCampo = (campo, valor) => { E.form[campo] = valor; };
    window.dtRepite = clave => { E.form.repite = clave; pintarFormulario(); };
    window.dtDia = n => { const d = E.form.diasSemana; E.form.diasSemana = d.includes(n) ? d.filter(x => x !== n) : [...d, n]; pintarFormulario(); };
    window.dtCancelar = () => { E.form = null; pintar(); };

    function errorForm(texto) { const caja = document.getElementById("dtError"); if (caja) { caja.textContent = texto || ""; caja.style.display = texto ? "block" : "none"; } }

    window.dtGuardar = async function () {
        const f = E.form;
        if (!f.titulo.trim()) return errorForm("Escribe qué hay que hacer.");
        if (f.repite === "semanal" && !f.diasSemana.length) return errorForm("Elige al menos un día.");

        const boton = document.getElementById("dtGuardar");
        boton.disabled = true;
        errorForm("");

        const cuerpo = { titulo: f.titulo, detalle: f.detalle, asignadoA: f.asignadoA ? Number(f.asignadoA) : null, repite: f.repite, diasSemana: f.diasSemana.map(Number), diaMes: Number(f.diaMes), fecha: f.fecha, hora: f.hora || null };

        try {
            await (f.id ? api(`/tareas/${f.id}`, "PUT", cuerpo) : api("/tareas", "POST", cuerpo));
            aviso(f.id ? "Tarea guardada." : "Tarea creada.");
            E.form = null;
            await cargarTodo();
        } catch (error) {
            boton.disabled = false;
            errorForm(error.message || "No se pudo guardar.");
        }
    };

    window.dtBorrar = async function () {
        if (!E.form?.id) return;
        try { await api(`/tareas/${E.form.id}`, "DELETE"); aviso("Tarea quitada."); E.form = null; await cargarTodo(); }
        catch (error) { errorForm(error.message || "No se pudo quitar."); }
    };

    // ---------- avisos ----------
    function htmlAvisos() {
        const gestor = E.hoy?.esGestor;

        return `${gestor ? `<article class="dueno-card">
                <div class="card-head"><div><span>Nuevo</span><h2>Aviso al equipo</h2></div></div>
                <label class="dueno-campo">Mensaje
                    <input type="text" id="dtAviso" maxlength="400" placeholder="Ej. Mañana abrimos a las 8" autocomplete="off">
                </label>
                <label class="dueno-campo">¿Para quién?
                    <select id="dtAvisoPara"><option value="">Todo el equipo</option>${E.personas.map(p => `<option value="${p.id}">${esc(p.nombre)}</option>`).join("")}</select>
                </label>
                <button type="button" class="dueno-boton-primario" onclick="dtEnviarAviso()">Enviar aviso</button>
            </article>` : ""}
            ${E.avisos.length ? `<ul class="dt-lista">${E.avisos.map(a => `<li class="dt-tarea">
                <div class="dt-texto" style="flex:1"><b>${esc(a.mensaje)}</b><small>${esc(a.de)} · ${esc(a.paraNombre)} · ${esc(cuando(a.cuando))}</small></div>
                ${gestor ? `<button type="button" class="dt-mini" onclick="dtQuitarAviso(${a.id})">Quitar</button>` : ""}
            </li>`).join("")}</ul>` : `<div class="dt-vacio"><b>No hay avisos</b><p>Los mensajes del dueño o del encargado salen aquí.</p></div>`}`;
    }

    function cuando(iso) {
        const f = new Date(iso);
        return f.toLocaleDateString("es-MX", { day: "numeric", month: "short" }) + " " + f.toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit" });
    }

    window.dtEnviarAviso = async function () {
        const mensaje = document.getElementById("dtAviso").value.trim();
        if (!mensaje) { aviso("Escribe el aviso."); return; }

        try {
            await api("/avisos", "POST", { mensaje, para: Number(document.getElementById("dtAvisoPara").value) || null });
            aviso("Aviso enviado.");
            await cargarTodo();
        } catch (error) { aviso(error.message || "No se pudo enviar."); }
    };

    window.dtQuitarAviso = async function (id) {
        try { await api(`/avisos/${id}`, "DELETE"); await cargarTodo(); } catch (error) { aviso(error.message || "No se pudo quitar."); }
    };

    // Mas -> Tareas y avisos (el menu lo abre como subpantalla de Mas; aqui se usa la propia)
    window.renderSubpantallaTareasDueno = function () {
        if (typeof cerrarSubpantallaMasDueno === "function") cerrarSubpantallaMasDueno();
        window.abrirTareasDueno("hoy");
    };

    window.duenoTareasRefrescar = refrescarResumen;

    // ---------- invitacion en Inicio: "¿Alguien mas trabaja contigo?" (solo quien puede administrar y todavia no tiene equipo) ----------
    const LLAVE_INVITACION = "nexoDuenoEquipoInvitacionCerrada";

    async function invitarAEquipo() {
        const inicio = document.getElementById("duenoApp");
        if (!inicio || document.getElementById("duenoEquipoInvitacion") || !hayTabs()) return;

        try { if (localStorage.getItem(LLAVE_INVITACION) === "1") return; } catch (error) { /* sin almacenamiento */ }
        if (typeof duenoTienePermiso === "function" && !duenoTienePermiso("administrar_usuarios")) return;

        let personas;
        try { personas = (await api("/equipo/personas")).personas; } catch (error) { return; }
        if (personas.length > 1) return;

        const tarjeta = document.createElement("div");
        tarjeta.id = "duenoEquipoInvitacion";
        tarjeta.className = "dt-invitacion";
        tarjeta.innerHTML = `<button type="button" class="dt-invitacion-cuerpo" onclick="dtIrAEmpleados()"><span aria-hidden="true">👥</span><span><b>¿Alguien más trabaja contigo?</b><small>Dales su perfil con PIN y elige qué pueden hacer. Luego les mandas tareas y avisos.</small></span></button><button type="button" class="dt-invitacion-cerrar" aria-label="Ahora no" onclick="dtCerrarInvitacion()">✕</button>`;
        const grid = inicio.querySelector(".dueno-grid");
        if (grid) grid.parentNode.insertBefore(tarjeta, grid); else inicio.appendChild(tarjeta);
    }

    window.dtCerrarInvitacion = function () {
        try { localStorage.setItem(LLAVE_INVITACION, "1"); } catch (error) { /* sin almacenamiento */ }
        document.getElementById("duenoEquipoInvitacion")?.remove();
    };

    window.dtIrAEmpleados = function () {
        if (typeof cambiarTabDueno === "function") cambiarTabDueno("mas");
        if (typeof abrirSubpantallaMasDueno === "function") abrirSubpantallaMasDueno("empleados-gestion");
    };

    setTimeout(invitarAEquipo, 3500);
    setTimeout(invitarAEquipo, 10000);

    // revisa de vez en cuando (y al volver a la app) si hay tareas nuevas
    setInterval(() => { if (!document.hidden) refrescarResumen(); }, 90000);
    document.addEventListener("visibilitychange", () => { if (!document.hidden) refrescarResumen(); });
    setTimeout(refrescarResumen, 2500);
    setTimeout(refrescarResumen, 9000);
})();
