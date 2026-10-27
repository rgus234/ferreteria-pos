/* Barra inferior del panel del dueño: siempre 5 destinos = Inicio · Vender · 2 accesos a tu gusto · Más.
   Los 2 accesos se eligen en Más → Apariencia → "Barra inferior" (Inventario, Pedidos, Caja o Créditos). Sin elegir nada, queda como siempre
   (Pedidos y Caja), salvo en abarrotes, que arranca con Inventario y Caja. Es solo del celular donde se elige (localStorage).
   El empleado sigue viendo lo que sus permisos permiten; "Más" aparece solo si queda lugar. */

(function () {
    const OPCIONALES = ["inventario", "pedidos", "caja", "creditos"];
    const NOMBRES = { inventario: "Inventario", pedidos: "Pedidos", caja: "Caja", creditos: "Créditos" };
    const ICONOS = {
        inventario: `<path d="M21 8l-9-5-9 5 9 5 9-5z"/><path d="M3 8v8l9 5 9-5V8"/><path d="M12 13v8"/>`,
        pedidos: `<rect x="3" y="7" width="18" height="13" rx="2"/><path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>`,
        caja: `<rect x="2" y="6" width="20" height="13" rx="2"/><path d="M2 10h20"/>`,
        creditos: `<rect x="3" y="6" width="18" height="13" rx="2"/><path d="M3 10h18M7 15h4"/>`
    };
    const LLAVE = "nexoDuenoBarra";

    let porDefecto = ["pedidos", "caja"];

    function guardada() {
        try {
            const v = JSON.parse(localStorage.getItem(LLAVE) || "null");
            if (Array.isArray(v) && v.length === 2 && v.every(x => OPCIONALES.includes(x)) && v[0] !== v[1]) return v;
        } catch (error) { /* sin preferencia */ }

        return null;
    }

    const elegidos = () => guardada() || porDefecto;

    // En abarrotes, sin preferencia guardada, la barra arranca con Inventario y Caja (Pedidos queda en Más).
    async function detectarGiro() {
        if (guardada() || typeof fetchAutenticado !== "function") return;

        try {
            const datos = await fetchAutenticado("/negocio-actual");
            const n = datos.negocio || {};
            const abarrotes = String(n.giro || "").toLowerCase().includes("abarrote") || (n.girosActivos || []).some(g => String(g).toLowerCase().includes("abarrote"));

            if (abarrotes) { porDefecto = ["inventario", "caja"]; aplicar(); }
        } catch (error) { /* sin sesion todavia: se intenta de nuevo al entrar */ }
    }

    function aplicar() {
        const botones = [...document.querySelectorAll(".dueno-tabs button[data-tab]")];
        const mas = botones.find(b => b.dataset.tab === "mas");
        const esEmpleado = typeof duenoRolSesion !== "undefined" && duenoRolSesion === "employee";

        if (!esEmpleado) {
            const quedan = elegidos();
            botones.forEach(b => { if (OPCIONALES.includes(b.dataset.tab)) b.style.display = quedan.includes(b.dataset.tab) ? "" : "none"; });
            if (mas) mas.style.display = "";
            return;
        }

        // Empleado: sus pestañas por permisos (ya aplicadas); Más solo si caben 5.
        const visibles = botones.filter(b => b.dataset.tab !== "mas" && b.style.display !== "none").length;
        if (mas) mas.style.display = visibles <= 4 ? "" : "none";
    }

    const original = window.aplicarRolShellDueno;

    if (typeof original === "function") {
        window.aplicarRolShellDueno = function (...argumentos) {
            const resultado = original.apply(this, argumentos);
            aplicar();
            detectarGiro();
            return resultado;
        };
    }

    // ---- Pantalla de Apariencia: elegir los 2 accesos ----
    window.renderOpcionesBarraDueno = function () {
        const contenedor = document.getElementById("duenoMasSubpantallaContenido");

        if (!contenedor || document.getElementById("duenoBarraOpciones")) return;

        const actual = elegidos();
        const tarjeta = document.createElement("article");
        tarjeta.className = "dueno-card";
        tarjeta.innerHTML = `<div class="card-head"><div><span>Apariencia</span><h2>Barra inferior</h2></div></div>
            <p class="dueno-tema-nota" style="margin:0 0 10px;">Siempre están Inicio, Vender y Más. Elige 2 accesos más para tenerlos a un toque.</p>
            <div id="duenoBarraOpciones" class="dueno-tema-opciones dueno-barra-opciones">${OPCIONALES.map(clave => `<button type="button" class="dueno-tema-opcion${actual.includes(clave) ? " activa" : ""}" onclick="elegirAccesoBarraDueno('${clave}')">
                <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONOS[clave]}</svg>
                <strong>${NOMBRES[clave]}</strong></button>`).join("")}</div>`;
        contenedor.appendChild(tarjeta);
    };

    // Tocar uno apagado lo enciende y apaga el que llevaba más tiempo encendido (siempre quedan 2).
    window.elegirAccesoBarraDueno = function (clave) {
        const actual = elegidos();

        if (actual.includes(clave)) return;

        try { localStorage.setItem(LLAVE, JSON.stringify([actual[1], clave])); } catch (error) { /* sin almacenamiento */ }

        aplicar();
        document.getElementById("duenoBarraOpciones")?.closest(".dueno-card")?.remove();
        window.renderOpcionesBarraDueno();
    };

    document.addEventListener("DOMContentLoaded", () => { aplicar(); detectarGiro(); });
    aplicar();
})();
