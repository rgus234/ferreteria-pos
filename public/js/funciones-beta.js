// Funciones nuevas (beta) por negocio en la computadora. Todo nace apagado; el dueño las enciende en Nexo -> Funciones nuevas.
// Otros modulos preguntan con funcionBeta("mapa_tienda") y los botones marcados con data-beta="clave" se muestran solo si esta encendida.
(function () {
    let funciones = {};
    let nombres = {};
    let cargada = false;
    let intentos = 0;

    const DESCRIPCIONES = {
        mapa_tienda: "Pasillos, estantes y bodega: dónde está cada producto, resurtir de bodega y revisar los conteos que se hacen en el celular.",
        recibir_por_marca: "Recibir mercancía por marca, con la factura del correo a la vista y sin contarla dos veces.",
        inicio_pendientes: "En el Inicio: stock crítico, fiado y facturas por recibir como tarjetas que llevan directo a resolverlos.",
        diseno_nuevo: "Un diseño más limpio, con menos cajas y más aire. Se puede apagar en cualquier momento."
    };

    const esc = valor => String(valor ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

    window.funcionBeta = clave => funciones[clave] === true;

    function aplicar() {
        document.querySelectorAll("[data-beta]").forEach(el => { el.hidden = !window.funcionBeta(el.dataset.beta); });
        document.documentElement.classList.toggle("diseno-nuevo", window.funcionBeta("diseno_nuevo"));
        document.dispatchEvent(new CustomEvent("nexo-funciones-beta", { detail: { ...funciones } }));
    }

    async function cargar() {
        try {
            const respuesta = await fetch("/funciones-beta");
            if (!respuesta.ok) return false;
            const datos = await respuesta.json();
            if (!datos.ok) return false;
            funciones = datos.funciones || {};
            nombres = datos.nombres || {};
            cargada = true;
            aplicar();
            return true;
        } catch (error) {
            return false;
        }
    }

    // El equipo puede abrirse antes de iniciar sesion: se reintenta con calma hasta que haya sesion (y se detiene solo).
    async function intentar() {
        if (cargada || intentos++ > 60) return;
        if (!(await cargar())) setTimeout(intentar, 5000);
    }

    window.mostrarFuncionesBeta = async function () {
        if (typeof ocultarPantallasPrincipales === "function") ocultarPantallasPrincipales();
        const pantalla = document.getElementById("pantallaFuncionesBeta");
        if (!pantalla) return;
        pantalla.style.display = "block";
        if (typeof actualizarTopbarContexto === "function") actualizarTopbarContexto("Funciones nuevas", "Pruébalas aquí antes que nadie", "funciones-beta");

        await cargar();
        pintarPantalla(pantalla);
    };

    function pintarPantalla(pantalla) {
        pantalla.innerHTML = `<div class="fb-shell">
            <header class="fb-cab"><h2>Funciones nuevas</h2><p>Estas funciones están en prueba y empiezan <b>apagadas</b>. Enciende las que quieras probar en este negocio; puedes apagarlas cuando quieras y todo lo demás sigue igual.</p></header>
            <div class="fb-lista">${Object.keys(DESCRIPCIONES).map(clave => `<label class="fb-fila">
                <span class="fb-texto"><b>${esc(nombres[clave] || clave)}</b><small>${esc(DESCRIPCIONES[clave])}</small></span>
                <span class="fb-interruptor"><input type="checkbox" data-clave="${esc(clave)}" ${funciones[clave] ? "checked" : ""}><i></i></span>
            </label>`).join("")}</div>
            <p class="fb-nota" id="fbNota"></p>
        </div>`;

        pantalla.querySelectorAll("input[data-clave]").forEach(caja => caja.addEventListener("change", async () => {
            const nota = document.getElementById("fbNota");
            caja.disabled = true;

            try {
                const respuesta = await fetch("/funciones-beta", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ clave: caja.dataset.clave, activo: caja.checked }) });
                const datos = await respuesta.json().catch(() => ({}));
                if (!respuesta.ok || !datos.ok) throw new Error(datos.error || "No se pudo guardar.");
                funciones = datos.funciones || funciones;
                aplicar();
                if (nota) nota.textContent = caja.checked ? "Encendida. Ya aparece en el menú." : "Apagada.";
            } catch (error) {
                caja.checked = !caja.checked;
                if (nota) nota.textContent = error.message || "No se pudo guardar.";
            }

            caja.disabled = false;
        }));
    }

    document.addEventListener("DOMContentLoaded", intentar);
    if (document.readyState !== "loading") intentar();
})();
