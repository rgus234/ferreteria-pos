/* Venta de alcohol (abarrotes) en la computadora.

   - Aviso de "solo mayores de 18 años" en la ventana de cobro cuando el carrito lleva bebidas alcoholicas.
   - Si el dueño configuro un horario en que no se vende (o marco "ley seca hoy"), al cobrar se pide el PIN de un administrador.
     La regla definitiva la aplica el servidor; esto solo evita un viaje de mas y explica por que se pide.
   - Casilla "Bebida alcoholica" en el producto, y la configuracion del horario en Funciones nuevas.
   Solo funciona con la funcion nueva "alcohol" encendida. Nexo no sabe que dice la ley de cada municipio: aplica lo que el dueño anote. */

(function () {
    let config = { activa: false, desde: "22:00", hasta: "10:00", leySecaHoy: false };
    let ids = new Set();
    let originalProducto = false;

    const funcionEncendida = () => typeof window.funcionBeta === "function" && window.funcionBeta("alcohol");
    const esc = valor => String(valor ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

    async function cargar() {
        if (!funcionEncendida()) { ids = new Set(); config = { ...config, activa: false }; return; }

        try {
            const respuesta = await fetch("/alcohol");
            const datos = await respuesta.json().catch(() => ({}));

            if (datos && datos.ok) {
                config = datos.config || config;
                ids = new Set((datos.ids || []).map(Number));
            }
        } catch (error) { /* sin conexion: se queda lo ultimo que se sabia */ }
    }

    window.alcoholEsProducto = id => funcionEncendida() && ids.has(Number(id));

    function alcoholEnCarrito() {
        return funcionEncendida() && typeof carrito !== "undefined" && Array.isArray(carrito) && carrito.some(item => ids.has(Number(item.id)));
    }

    function enVentana(hora, desde, hasta) {
        if (!desde || !hasta || desde === hasta) return false;
        return desde < hasta ? (hora >= desde && hora < hasta) : (hora >= desde || hora < hasta);
    }

    // Por que ahorita no se puede vender alcohol (texto) o null.
    function motivoAhora() {
        if (!config.activa) return null;
        if (config.leySecaHoy) return "Hoy esta marcado como dia sin venta de alcohol.";

        const ahora = new Date();
        const hora = `${String(ahora.getHours()).padStart(2, "0")}:${String(ahora.getMinutes()).padStart(2, "0")}`;

        return enVentana(hora, config.desde, config.hasta) ? `A esta hora no se vende alcohol (de ${config.desde} a ${config.hasta}).` : null;
    }

    // Se llama al cobrar: actualiza la regla (por si cambio en otra caja) y dice si hace falta el PIN de un administrador.
    window.alcoholMotivoCobroPOS = async function () {
        if (!funcionEncendida()) return null;

        await cargar();

        return alcoholEnCarrito() ? motivoAhora() : null;
    };

    window.pedirPinAlcoholPOS = async function (motivo) {
        if (typeof abrirFormularioCredito !== "function") return null;

        const datos = await abrirFormularioCredito({
            titulo: "Autorizacion requerida",
            subtitulo: `${motivo} Esta venta lleva alcohol: necesita el PIN de un administrador.`,
            campos: [{ nombre: "adminPin", etiqueta: "PIN de administrador", tipo: "password", requerido: true }]
        });

        return datos ? datos.adminPin : null;
    };

    // Aviso dentro de la ventana de cobro (pos-payment-modal.js).
    window.avisoAlcoholCobroHTML = function () {
        if (!alcoholEnCarrito()) return "";

        return `<div class="metodo-pago-nota alc-aviso" role="note"><strong>Bebidas alcohólicas en esta venta</strong><span>Recuerda que la venta de alcohol es solo para mayores de 18 años. Si tienes duda, pide una identificación.</span></div>`;
    };

    // Sin internet no se puede revisar el PIN: una venta con alcohol fuera de horario no se encola.
    function envolverCola(nombre) {
        const original = window[nombre];

        if (typeof original !== "function" || original.__alcohol) return;

        const envuelta = async function (payload) {
            const motivo = funcionEncendida() && Array.isArray(payload && payload.productos) && payload.productos.some(p => ids.has(Number(p.id))) ? motivoAhora() : null;

            if (motivo) {
                if (typeof alertaPOS === "function") await alertaPOS(`${motivo} Sin conexion no se puede autorizar con el PIN de un administrador; intenta de nuevo cuando vuelva el internet.`, "Venta de alcohol no autorizada", "peligro");
                return { ok: false, offlineDisponible: false };
            }

            return original.apply(this, arguments);
        };

        envuelta.__alcohol = true;
        window[nombre] = envuelta;
    }

    // ---- Casilla en el formulario del producto ----
    window.alcoholPonerCasillaProducto = function (productoId) {
        const caja = document.getElementById("nuevoEsAlcohol");
        if (!caja) return;

        originalProducto = Boolean(productoId) && ids.has(Number(productoId));
        caja.checked = originalProducto;
    };

    window.guardarAlcoholProductoPOS = async function (productoId) {
        const caja = document.getElementById("nuevoEsAlcohol");
        const id = Number(productoId);

        if (!caja || !funcionEncendida() || !(id > 0) || caja.checked === originalProducto) return;

        try {
            const respuesta = await fetch(`/alcohol/producto/${id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ esAlcohol: caja.checked }) });
            const datos = await respuesta.json().catch(() => ({}));

            if (!respuesta.ok || !datos.ok) throw new Error(datos.error || "No se pudo guardar.");

            if (caja.checked) ids.add(id); else ids.delete(id);
        } catch (error) {
            if (typeof alertaPOS === "function") await alertaPOS(`El producto se guardó, pero no se pudo marcar como bebida alcohólica: ${error.message}`, "Alcohol no guardado", "alerta");
        }
    };

    // ---- Configuracion del horario, en Funciones nuevas ----
    function pintarConfiguracion() {
        const cuerpo = document.querySelector("#pantallaFuncionesBeta .fb-shell");
        if (!cuerpo) return;

        const anterior = cuerpo.querySelector(".alc-config");
        if (anterior) anterior.remove();

        if (!funcionEncendida()) return;

        const seccion = document.createElement("section");
        seccion.className = "alc-config";
        seccion.innerHTML = `
            <h3>Venta de alcohol</h3>
            <p class="alc-nota">Cada estado y municipio tiene su propia regla. Nexo solo aplica el horario que anotes aquí, así que revisa el de tu municipio. Un administrador puede autorizar una venta con su PIN.</p>
            <label class="alc-fila"><input type="checkbox" id="alcActiva" ${config.activa ? "checked" : ""}> <span>No vender alcohol en este horario</span></label>
            <div class="alc-horas">
                <label>De <input type="time" id="alcDesde" value="${esc(config.desde)}"></label>
                <label>a <input type="time" id="alcHasta" value="${esc(config.hasta)}"></label>
            </div>
            <label class="alc-fila"><input type="checkbox" id="alcLeySeca" ${config.leySecaHoy ? "checked" : ""}> <span>Hoy es ley seca (no se vende alcohol en todo el día)</span></label>
            <button type="button" class="alc-guardar" id="alcGuardar">Guardar</button>
            <p class="alc-resultado" id="alcResultado" aria-live="polite"></p>`;
        cuerpo.appendChild(seccion);

        seccion.querySelector("#alcGuardar").onclick = async () => {
            const resultado = seccion.querySelector("#alcResultado");
            const cuerpoPut = {
                activa: seccion.querySelector("#alcActiva").checked,
                desde: seccion.querySelector("#alcDesde").value || "22:00",
                hasta: seccion.querySelector("#alcHasta").value || "10:00",
                leySecaHoy: seccion.querySelector("#alcLeySeca").checked
            };

            try {
                const respuesta = await fetch("/alcohol/config", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(cuerpoPut) });
                const datos = await respuesta.json().catch(() => ({}));

                if (!respuesta.ok || !datos.ok) throw new Error(datos.error || "No se pudo guardar.");

                config = { activa: cuerpoPut.activa, desde: cuerpoPut.desde, hasta: cuerpoPut.hasta, leySecaHoy: cuerpoPut.leySecaHoy };
                resultado.textContent = "Guardado.";
            } catch (error) {
                resultado.textContent = error.message || "No se pudo guardar.";
            }
        };
    }

    async function alCambiarFunciones() {
        await cargar();
        envolverCola("registrarVentaOfflineDesktopPOS");
        envolverCola("registrarCreditoOfflineDesktopPOS");
        pintarConfiguracion();
    }

    document.addEventListener("nexo-funciones-beta", alCambiarFunciones);
    document.addEventListener("nexo-funciones-beta-pantalla", pintarConfiguracion);
    if (funcionEncendida()) alCambiarFunciones();
})();
