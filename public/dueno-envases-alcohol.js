/* Envases retornables y venta de alcohol en Vender del celular (/dueno), abarrotes.
   Es lo mismo que ya existe en la computadora (envases-pos.js y alcohol-pos.js), con las mismas rutas del servidor:
   - Envase: si el producto lleva envase, la linea del carrito trae "Trae envase (-$8)". Se dice cuantos envases devuelve el cliente
     y se descuenta ese importe por pieza (al cobrar la linea se separa en "con envase" y "sin envase").
   - Alcohol: aviso de "solo mayores de 18 anos" al cobrar, y si el dueño configuro un horario sin venta (o ley seca hoy) se pide
     el PIN de un administrador. El servidor lo revisa de nuevo.
   Cada funcion nace apagada por negocio (Funciones nuevas en la computadora); con ella apagada aqui no aparece nada. */

(function () {
    const estado = { flags: { envases: false, alcohol: false }, envases: {}, alcohol: { config: { activa: false, desde: "22:00", hasta: "10:00", leySecaHoy: false }, ids: new Set() }, cargadoEn: 0, cargando: null };

    const esc = valor => String(valor ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
    const dinero0 = valor => "$" + (+Number(valor || 0).toFixed(2));

    async function llamar(ruta) {
        return typeof fetchAutenticado === "function" ? fetchAutenticado(ruta) : null;
    }

    // Trae las funciones del negocio y, solo de las encendidas, sus datos. Sin conexion se queda lo ultimo que se sabia.
    window.cargarEnvasesAlcoholDueno = function (forzar) {
        if (!forzar && estado.cargando) return estado.cargando;
        if (!forzar && Date.now() - estado.cargadoEn < 60000) return Promise.resolve();

        estado.cargando = (async () => {
            try {
                const datos = await llamar("/funciones-beta");
                const f = (datos && datos.funciones) || {};
                estado.flags = { envases: f.envases === true, alcohol: f.alcohol === true };

                if (estado.flags.envases) {
                    const r = await llamar("/envases");
                    estado.envases = (r && r.envases) || {};
                } else estado.envases = {};

                if (estado.flags.alcohol) {
                    const r = await llamar("/alcohol");
                    if (r && r.config) estado.alcohol = { config: r.config, ids: new Set((r.ids || []).map(Number)) };
                } else estado.alcohol = { config: { ...estado.alcohol.config, activa: false }, ids: new Set() };

                estado.cargadoEn = Date.now();
                completarCarrito();
            } catch (error) { /* sin conexion: se queda lo ultimo que se sabia */ }
            finally { estado.cargando = null; }
        })();

        return estado.cargando;
    };

    // Los productos que ya estaban en el carrito antes de que cargara la informacion tambien reciben su envase.
    function completarCarrito() {
        if (typeof duenoVentaCarrito === "undefined" || !Array.isArray(duenoVentaCarrito)) return;

        let cambio = false;
        duenoVentaCarrito.forEach(item => {
            if (item.envaseImporte === undefined) { item.envaseImporte = window.envaseImporteDeDueno(item.id); item.envaseDevueltos = 0; cambio = true; }
        });

        if (cambio && typeof renderCarritoVenderDueno === "function") renderCarritoVenderDueno();
    }

    window.envaseImporteDeDueno = id => (estado.flags.envases ? Number(estado.envases[String(id)]) || 0 : 0);

    // ---------------- envase ----------------

    window.envaseControlHtmlDueno = function (item) {
        const importe = Number(item.envaseImporte) || 0;
        if (!(importe > 0)) return "";

        const k = typeof envasesDevueltosDueno === "function" ? envasesDevueltosDueno(item) : 0;
        const texto = k > 0 ? `Envases devueltos: ${k} de ${item.cantidad} · &minus;${dinero0(k * importe)}` : `Trae envase (&minus;${dinero0(importe)})`;

        return `<button type="button" class="dueno-envase-boton${k > 0 ? " activo" : ""}" onclick="abrirEnvasesVenderDueno(${item.id})">${texto}</button>`;
    };

    window.cerrarEnvasesVenderDueno = function () {
        const hoja = document.getElementById("duenoEnvasesHoja");
        if (hoja) hoja.remove();
    };

    window.abrirEnvasesVenderDueno = function (id) {
        const item = duenoVentaCarrito.find(i => i.id === id);
        if (!item) return;

        const aplicar = k => {
            item.envaseDevueltos = Math.max(0, Math.min(Math.floor(Number(k) || 0), Math.floor(item.cantidad)));
            cerrarEnvasesVenderDueno();
            renderCarritoVenderDueno();
        };

        // Una sola pieza: un toque (trae / no trae)
        if (Math.floor(item.cantidad) <= 1) { aplicar(envasesDevueltosDueno(item) > 0 ? 0 : 1); return; }

        cerrarEnvasesVenderDueno();
        const n = Math.floor(item.cantidad);
        const hoja = document.createElement("div");
        hoja.id = "duenoEnvasesHoja";
        hoja.className = "dvm-cantidad-hoja";
        const rapidos = [0, ...[1, 2, 3, 6, 12].filter(x => x < n), n];

        hoja.innerHTML = `
            <div class="dvm-cantidad-fondo" onclick="cerrarEnvasesVenderDueno()"></div>
            <div class="dvm-cantidad-caja">
                <strong>${esc(item.nombre)}</strong>
                <span class="dueno-envase-ayuda">¿Cuántos envases trae? (de ${n}) &middot; cada uno descuenta ${dinero0(item.envaseImporte)}</span>
                <div class="dvm-cantidad-rapidos dueno-envase-rapidos">${rapidos.map(x => `<button type="button" data-n="${x}">${x === 0 ? "Ninguno" : (x === n ? `Todos (${n})` : x)}</button>`).join("")}</div>
                <input type="text" inputmode="numeric" id="duenoEnvasesInput" value="${envasesDevueltosDueno(item) || ""}" placeholder="O escribe cuántos" autocomplete="off">
                <button type="button" class="dueno-boton-primario" id="duenoEnvasesListo">Listo</button>
            </div>`;
        document.body.appendChild(hoja);

        const campo = hoja.querySelector("#duenoEnvasesInput");
        hoja.querySelectorAll(".dueno-envase-rapidos button").forEach(b => { b.onclick = () => aplicar(b.dataset.n); });
        hoja.querySelector("#duenoEnvasesListo").onclick = () => aplicar(campo.value);
        campo.addEventListener("keydown", evento => { if (evento.key === "Enter") { evento.preventDefault(); aplicar(campo.value); } });
    };

    // ---------------- alcohol ----------------

    const alcoholEnCarrito = () => estado.flags.alcohol && typeof duenoVentaCarrito !== "undefined" && duenoVentaCarrito.some(item => estado.alcohol.ids.has(Number(item.id)));

    function enVentana(hora, desde, hasta) {
        if (!desde || !hasta || desde === hasta) return false;
        return desde < hasta ? (hora >= desde && hora < hasta) : (hora >= desde || hora < hasta);
    }

    function motivoAhora() {
        const c = estado.alcohol.config;
        if (!c.activa) return null;
        if (c.leySecaHoy) return "Hoy esta marcado como dia sin venta de alcohol.";

        const ahora = new Date();
        const hora = `${String(ahora.getHours()).padStart(2, "0")}:${String(ahora.getMinutes()).padStart(2, "0")}`;

        return enVentana(hora, c.desde, c.hasta) ? `A esta hora no se vende alcohol (de ${c.desde} a ${c.hasta}).` : null;
    }

    // Al cobrar: se actualiza la regla (por si cambio) y se dice si hace falta el PIN de un administrador.
    window.motivoAlcoholDueno = async function () {
        if (!estado.flags.alcohol) return null;

        try {
            const r = await llamar("/alcohol");
            if (r && r.config) estado.alcohol = { config: r.config, ids: new Set((r.ids || []).map(Number)) };
        } catch (error) { /* se usa lo ultimo que se sabia */ }

        return alcoholEnCarrito() ? motivoAhora() : null;
    };

    window.pedirPinAdministradorParaAlcoholDueno = function (motivo) {
        const pin = prompt(`${motivo} Esta venta lleva alcohol: necesita el PIN de un administrador.`);
        return pin && pin.trim() ? pin.trim() : null;
    };

    window.avisoAlcoholCobroDueno = function () {
        if (!alcoholEnCarrito()) return "";

        return `<div class="dueno-alcohol-aviso" role="note"><strong>Bebidas alcohólicas en esta venta</strong><span>Recuerda que la venta de alcohol es solo para mayores de 18 años. Si tienes duda, pide una identificación.</span></div>`;
    };

    // Se carga al abrir Vender (y de vez en cuando); los demas tabs no la necesitan.
    const original = window.cambiarTabDueno;

    if (typeof original === "function" && !original.__envasesAlcohol) {
        const envuelta = function (tab) {
            const resultado = original.apply(this, arguments);
            if (tab === "vender") window.cargarEnvasesAlcoholDueno();
            return resultado;
        };

        envuelta.__envasesAlcohol = true;
        window.cambiarTabDueno = envuelta;
    }
})();
