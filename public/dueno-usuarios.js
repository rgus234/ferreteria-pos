/* Cambio rapido de usuario en el celular de la tienda (plan docs/plan-celular-inventario-y-venta.md, seccion S).
   Un empleado dejo la sesion abierta y llega otra persona (o el dueno): en vez de cerrar sesion, toca su avatar, elige quien es,
   pone SU PIN y sigue donde estaba (la venta en curso no se pierde). Cada accion queda a nombre de quien la hace porque el
   navegador manda x-empleado-id del usuario activo. Tambien aqui: "Sigo trabajando" (extender el turno con el PIN propio).
   Solo aparece en un celular vinculado a la tienda (modo dispositivo + PIN), el mismo modelo de confianza de siempre. */

(function () {
    const DIAS = ["domingo", "lunes", "martes", "miercoles", "jueves", "viernes", "sabado"];
    let chip = null;
    let hoja = null;
    let eligiendo = null;
    let modo = "cambiar"; // "cambiar" | "extender"

    const esc = valor => (typeof escaparDueno === "function" ? escaparDueno(valor) : String(valor ?? ""));
    const modoDispositivo = () => Boolean(typeof dispositivoTokenGuardado === "function" && dispositivoTokenGuardado() && typeof empleadoActivoGuardado === "function" && empleadoActivoGuardado());
    const inicial = nombre => String(nombre || "?").trim().charAt(0).toUpperCase() || "?";

    // "En turno ahora" segun el horario laboral del empleado (hora de Mexico).
    function enTurnoAhora(empleado) {
        const horario = empleado.horarioLaboral;
        if (!horario) return null;

        const ahora = new Date(new Date().toLocaleString("en-US", { timeZone: "America/Mexico_City" }));
        const hoy = horario[DIAS[ahora.getDay()]];
        if (!hoy || !hoy.inicio || !hoy.fin) return false;

        const hhmm = `${String(ahora.getHours()).padStart(2, "0")}:${String(ahora.getMinutes()).padStart(2, "0")}`;
        return hhmm >= hoy.inicio && hhmm < hoy.fin;
    }

    function pintarChip() {
        if (!chip) {
            chip = document.createElement("button");
            chip.type = "button";
            chip.id = "duChip";
            chip.className = "du-chip";
            chip.setAttribute("aria-label", "Cambiar de usuario");
            chip.addEventListener("click", abrirHoja);
            document.body.appendChild(chip);
        }

        const activo = modoDispositivo() ? empleadoActivoGuardado() : null;
        chip.style.display = activo ? "grid" : "none";

        if (activo) {
            chip.textContent = inicial(activo.nombre);
            chip.title = `Usando Nexo como ${activo.nombre}. Toca para cambiar.`;
            chip.style.background = activo.colorAvatar || "#1d5fd1";
        }
    }

    function cerrarHoja() {
        hoja?.classList.remove("abierta");
        eligiendo = null;
    }

    async function abrirHoja() {
        if (!modoDispositivo()) return;

        if (!hoja) {
            hoja = document.createElement("div");
            hoja.id = "duHoja";
            hoja.className = "du-hoja";
            hoja.addEventListener("click", evento => { if (evento.target === hoja) cerrarHoja(); });
            document.body.appendChild(hoja);
        }

        modo = "cambiar";
        eligiendo = null;
        hoja.classList.add("abierta");
        hoja.innerHTML = `<div class="du-panel"><h3>¿Quién usa Nexo?</h3><p class="du-nota">Cargando...</p></div>`;

        try {
            const respuesta = await fetch("/dispositivo/empleados", { headers: { "x-dispositivo-token": dispositivoTokenGuardado() || "" } });
            const datos = await respuesta.json();
            if (!respuesta.ok || !datos.ok) throw new Error();
            pintarLista(datos.empleados || []);
        } catch (error) {
            hoja.querySelector(".du-panel").innerHTML = `<h3>¿Quién usa Nexo?</h3><p class="du-nota du-error">No se pudo conectar. Revisa tu internet.</p><button type="button" class="du-boton" onclick="duCerrar()">Cerrar</button>`;
        }
    }

    function pintarLista(empleados) {
        const activo = empleadoActivoGuardado();
        const ordenados = empleados.slice().sort((a, b) => (enTurnoAhora(b) === true) - (enTurnoAhora(a) === true));

        hoja.querySelector(".du-panel").innerHTML = `
            <h3>¿Quién usa Nexo?</h3>
            <p class="du-nota">Elige quién eres y pon tu PIN. Lo que estabas haciendo se queda como está.</p>
            <div class="du-lista">${ordenados.map(e => {
                const turno = enTurnoAhora(e);
                return `<button type="button" class="du-persona${activo && Number(activo.id) === Number(e.id) ? " du-activa" : ""}" data-id="${e.id}">
                    <span class="du-avatar" style="background:${esc(e.colorAvatar || "#1d5fd1")}">${esc(inicial(e.nombre))}</span>
                    <span><b>${esc(e.nombre)}</b><small>${esc(e.rol || "")}${turno === true ? " · en turno" : ""}</small></span>
                    ${activo && Number(activo.id) === Number(e.id) ? `<em>Tú</em>` : ""}
                </button>`;
            }).join("") || `<p class="du-nota">Todavía no hay personas con PIN.</p>`}</div>
            <button type="button" class="du-enlace" onclick="duExtender()">Sigo trabajando: extender mi turno</button>
            <button type="button" class="du-boton du-secundario" onclick="duCerrar()">Cerrar</button>`;

        hoja.querySelectorAll(".du-persona").forEach(boton => {
            boton.addEventListener("click", () => {
                const e = ordenados.find(x => Number(x.id) === Number(boton.dataset.id));
                if (e) pedirPin(e, "cambiar");
            });
        });
    }

    function pedirPin(empleado, para) {
        eligiendo = empleado;
        modo = para;

        hoja.querySelector(".du-panel").innerHTML = `
            <h3>${para === "extender" ? "Extender mi turno" : `Hola, ${esc(empleado.nombre)}`}</h3>
            <p class="du-nota">${para === "extender" ? "Pon tu PIN: tu turno se extiende 2 horas y queda registrado como tiempo extra." : "Pon tu PIN para entrar."}</p>
            <input id="duPin" class="du-pin" type="password" inputmode="numeric" pattern="[0-9]*" maxlength="6" autocomplete="off" placeholder="••••">
            <p id="duError" class="du-nota du-error" style="display:none"></p>
            <button type="button" class="du-boton" id="duConfirmar">${para === "extender" ? "Extender 2 horas" : "Entrar"}</button>
            <button type="button" class="du-boton du-secundario" onclick="duCerrar()">Cancelar</button>`;

        const campo = document.getElementById("duPin");
        campo.focus();
        campo.addEventListener("keydown", evento => { if (evento.key === "Enter") confirmarPin(); });
        document.getElementById("duConfirmar").addEventListener("click", confirmarPin);
    }

    function mostrarError(texto) {
        const caja = document.getElementById("duError");
        if (caja) { caja.textContent = texto; caja.style.display = "block"; }
    }

    async function confirmarPin() {
        const pin = String(document.getElementById("duPin")?.value || "");
        if (!/^[0-9]{4,6}$/.test(pin)) { mostrarError("El PIN debe ser de 4 a 6 dígitos."); return; }

        const boton = document.getElementById("duConfirmar");
        if (boton) boton.disabled = true;

        try {
            if (modo === "extender") {
                const activo = empleadoActivoGuardado();
                const respuesta = await fetch("/turno/extender", {
                    method: "POST",
                    headers: { "Content-Type": "application/json", "x-dispositivo-token": dispositivoTokenGuardado() || "", "x-empleado-id": String(activo.id) },
                    body: JSON.stringify({ pin, horas: 2 })
                });
                const datos = await respuesta.json().catch(() => ({}));

                if (!respuesta.ok || !datos.ok) { mostrarError(datos.error || "No se pudo extender el turno."); if (boton) boton.disabled = false; return; }

                cerrarHoja();
                avisar(`Turno extendido hasta las ${new Date(datos.hasta).toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit" })}`);
                return;
            }

            const respuesta = await fetch("/dispositivo/empleados/verificar-pin", {
                method: "POST",
                headers: { "Content-Type": "application/json", "x-dispositivo-token": dispositivoTokenGuardado() || "" },
                body: JSON.stringify({ empleadoId: eligiendo.id, pin })
            });
            const datos = await respuesta.json().catch(() => ({}));

            if (!respuesta.ok || !datos.ok) { mostrarError(datos.error || "PIN incorrecto."); if (boton) boton.disabled = false; return; }

            guardarEmpleadoActivo(datos.empleado);
            if (typeof sincronizarRolSesionDueno === "function") await sincronizarRolSesionDueno();
            pintarChip();
            cerrarHoja();
            avisar(`Ahora usas Nexo como ${datos.empleado.nombre}`);

            // Si el rol nuevo no puede ver la pantalla donde estaba, se lleva a su primera pestaña permitida.
            const visible = document.querySelector(".dueno-tabs button.activo");
            const oculta = visible && getComputedStyle(visible).display === "none";
            if (oculta && typeof duenoPrimeraPestanaEmpleado === "function" && typeof cambiarTabDueno === "function") cambiarTabDueno(duenoPrimeraPestanaEmpleado());
        } catch (error) {
            mostrarError("No se pudo conectar. Revisa tu internet.");
            if (boton) boton.disabled = false;
        }
    }

    function avisar(texto) {
        const aviso = document.createElement("div");
        aviso.className = "du-aviso";
        aviso.textContent = texto;
        document.body.appendChild(aviso);
        setTimeout(() => aviso.remove(), 2600);
    }

    window.duCerrar = cerrarHoja;
    window.duExtender = function () {
        const activo = empleadoActivoGuardado();
        if (activo) pedirPin(activo, "extender");
    };

    // Se actualiza al entrar a la app, al cambiar de pestaña y al cerrar/abrir sesion.
    ["mostrarAppDueno", "cambiarTabDueno", "completarLoginDispositivoDueno", "cerrarSesionDuenoApp"].forEach(nombre => {
        const original = window[nombre];
        if (typeof original !== "function") return;

        window[nombre] = function (...argumentos) {
            const resultado = original.apply(this, argumentos);
            const despues = () => pintarChip();
            return resultado && typeof resultado.then === "function" ? resultado.then(valor => { despues(); return valor; }) : (despues(), resultado);
        };
    });

    document.addEventListener("DOMContentLoaded", pintarChip);
    if (document.readyState !== "loading") pintarChip();
})();
