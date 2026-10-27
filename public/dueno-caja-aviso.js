/* Caja cerrada en el celular: avisa en Inicio y en Vender, y deja abrir el turno ahi mismo (antes solo decia "abre un turno de caja" sin ofrecer como).
   Usa /caja/turno-activo y /caja/abrir (las mismas rutas de la pantalla Caja). */

(function () {
    const hayCarrito = () => typeof duenoVentaCarrito !== "undefined" && duenoVentaCarrito.length > 0;

    function envolver(nombre, despues) {
        const original = window[nombre];
        if (typeof original !== "function") return;

        window[nombre] = function (...argumentos) {
            const resultado = original.apply(this, argumentos);
            return resultado && typeof resultado.then === "function" ? resultado.then(valor => { despues(argumentos, valor); return valor; }) : (despues(argumentos, resultado), resultado);
        };
    }

    // ---- Caja cerrada: avisar en Inicio y Vender, y dejar abrir el turno ahi mismo (antes solo decia "abre un turno" sin como) ----

    // Se ofrece abrir el turno dentro del cobro (cuando el servidor lo pide o se revisa antes de cobrar).
    function mostrarAbrirCajaEnCobro() {
        const overlay = document.getElementById("duenoVenderCobroOverlay");
        const contenido = document.getElementById("duenoVenderCobroContenido");
        const titulo = document.getElementById("duenoVenderCobroTitulo");

        if (!overlay || !contenido) return;

        if (titulo) titulo.textContent = "Abre tu caja";
        contenido.innerHTML = `<div class="dvm-caja">
            <p><b>Para cobrar hay que abrir el turno de caja.</b> Así las ventas del día entran al corte y el dinero cuadra.</p>
            <label class="dueno-campo">Fondo inicial (el dinero con el que empiezas)
                <input type="number" id="dvmFondoCaja" inputmode="decimal" min="0" step="0.01" placeholder="0.00">
            </label>
            <p id="dvmCajaError" class="dueno-estado" style="display:none;"></p>
            <button type="button" class="dueno-boton-primario" id="dvmBotonAbrirCaja" onclick="dvmAbrirCajaYCobrar()">Abrir caja y cobrar</button>
            <button type="button" class="dueno-link" onclick="dvmIrACaja()">Ir a la pantalla de Caja</button>
        </div>`;
        overlay.classList.add("abierta");
    }

    window.manejarFaltaDeTurnoDueno = function (error) {
        if (!(error && error.datos && error.datos.requiereAbrirTurno)) return false;

        mostrarAbrirCajaEnCobro();
        return true;
    };

    window.dvmAbrirCajaYCobrar = async function () {
        const boton = document.getElementById("dvmBotonAbrirCaja");
        const error = document.getElementById("dvmCajaError");
        const fondoInicial = Number(document.getElementById("dvmFondoCaja")?.value || 0);

        if (boton) boton.disabled = true;

        try {
            await fetchAutenticado("/caja/abrir", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ fondoInicial, notas: "" }) });

            if (typeof mostrarToastDueno === "function") mostrarToastDueno("Caja abierta");
            if (typeof renderCobroVenderDueno === "function") renderCobroVenderDueno(); else iniciarCobroVenderDueno();
            actualizarAvisosCaja();
        } catch (falla) {
            if (error) { error.textContent = falla.message || "No se pudo abrir la caja."; error.style.display = "block"; }
            if (boton) boton.disabled = false;
        }
    };

    window.dvmIrACaja = function () {
        document.getElementById("duenoVenderCobroOverlay")?.classList.remove("abierta");
        if (typeof cambiarTabDueno === "function") cambiarTabDueno("caja");
        setTimeout(() => { if (typeof mostrarAbrirTurnoDueno === "function") mostrarAbrirTurnoDueno(); }, 350);
    };

    // Antes de cobrar se revisa que haya turno abierto: si no, se ofrece abrirlo en vez de dejar que la venta falle.
    const cobroOriginal = window.iniciarCobroVenderDueno;

    if (typeof cobroOriginal === "function") {
        window.iniciarCobroVenderDueno = async function (...argumentos) {
            try {
                if (hayCarrito()) {
                    const datos = await fetchAutenticado("/caja/turno-activo");

                    if (datos && !datos.turno) { mostrarAbrirCajaEnCobro(); return; }
                }
            } catch (falla) { /* sin conexion: se cobra como siempre (se guarda en el telefono) */ }

            return cobroOriginal.apply(this, argumentos);
        };
    }

    // Aviso amarillo arriba de Inicio y de Vender cuando la caja esta cerrada.
    async function actualizarAvisosCaja() {
        const destinos = [["duenoApp", ".dueno-header"], ["duenoVender", ".dueno-header"]];
        let abierta = true;

        try {
            const puede = typeof duenoTienePermiso === "function" ? duenoTienePermiso("hacer_ventas") : true;

            if (!puede) abierta = true;
            else { const datos = await fetchAutenticado("/caja/turno-activo"); abierta = Boolean(datos && datos.turno); }
        } catch (falla) { abierta = true; }

        destinos.forEach(([id, ancla]) => {
            const pantalla = document.getElementById(id);
            const previo = pantalla?.querySelector(".dvm-aviso-caja");

            if (!pantalla) return;
            if (abierta) { previo?.remove(); return; }
            if (previo) return;

            const aviso = document.createElement("div");
            aviso.className = "dvm-aviso-caja";
            aviso.innerHTML = `<b>La caja está cerrada</b><p>Abre tu turno para poder cobrar ventas.</p><button type="button" onclick="dvmIrACaja()">Abrir caja</button>`;
            (pantalla.querySelector(ancla) || pantalla.firstElementChild)?.insertAdjacentElement("afterend", aviso);
        });
    }

    envolver("cargarPanelDueno", () => { actualizarAvisosCaja(); });
    envolver("cargarPanelVenderDueno", () => { actualizarAvisosCaja(); });
    envolver("cargarPanelCajaDueno", () => { actualizarAvisosCaja(); });
})();
