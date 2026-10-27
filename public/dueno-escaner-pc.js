/* Escaner de la computadora desde el celular: la camara lee codigos y los manda a la computadora (como un lector USB).
   Se empareja con el codigo de 6 letras/numeros (o el QR) que muestra la computadora. Servidor: /escaner-remoto/* (escaner-remoto-server.js). */

(function () {
    const N = () => window.NexoMovil;
    const esc = valor => (N() ? N().esc(valor) : String(valor ?? ""));
    const icono = (nombre, tam) => (N() ? N().icono(nombre, tam) : "");
    const LLAVE = "nexoEscanerPc";

    let capa = null;
    let sesion = "";
    let pcConectada = false;
    let enviados = []; // { codigo, ok }
    let latido = null;
    let escribiendo = "";

    async function llamar(ruta, cuerpo) {
        try {
            return { ok: true, datos: await fetchAutenticado(ruta, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(cuerpo) }) || {} };
        } catch (error) {
            return { ok: false, estado: error.status, datos: error.datos || { error: error.message } };
        }
    }

    function obtenerCapa() {
        if (!capa) {
            capa = document.createElement("div");
            capa.id = "dpCapa";
            capa.className = "dm-capa dp-capa";
            document.body.appendChild(capa);
        }

        capa.classList.add("abierta");
        return capa;
    }

    function cabecera(titulo) {
        return `<header class="dm-cabecera"><button type="button" class="dm-atras" onclick="dpCerrar()" aria-label="Atrás">${icono("atras", 22)}</button><div class="dm-titulo-caja"><h2>${esc(titulo)}</h2><small>Celular → computadora</small></div><span class="dm-atras dm-vacio"></span></header>`;
    }

    function guardar() { try { localStorage.setItem(LLAVE, sesion); } catch (error) { /* sin almacenamiento */ } }
    function olvidar() { try { localStorage.removeItem(LLAVE); } catch (error) { /* sin almacenamiento */ } }

    function pintar() {
        const c = obtenerCapa();

        if (!sesion) {
            c.innerHTML = `<div class="dm-marco">${cabecera("Escáner de la compu")}<main class="dm-cuerpo">
                <div class="dm-ficha-foto dp-explica"><div class="dm-fila-texto"><b>Usa la cámara del celular en tu computadora</b><small>Los códigos que leas aquí se agregan en la computadora, como con un lector USB.</small></div></div>
                <ol class="dp-pasos"><li>En la computadora toca el botón del celular junto al buscador del punto de venta.</li><li>Escribe aquí el código que aparece, o escanea su QR.</li></ol>
                <label class="dm-campo">Código de la computadora<input id="dpCodigo" class="dm-input dp-codigo" type="text" maxlength="6" autocapitalize="characters" autocomplete="off" placeholder="ABC123" value="${esc(escribiendo)}" oninput="dpEscribe(this.value)"></label>
                <p id="dpError" class="dm-error"></p>
                <button type="button" class="dm-grande" onclick="dpConectar()">Conectar</button>
                <button type="button" class="dm-secundario" onclick="dpEscanearQr()">Escanear el QR de la pantalla</button>
            </main></div>`;
            return;
        }

        c.innerHTML = `<div class="dm-marco">${cabecera("Escáner de la compu")}<main class="dm-cuerpo">
            <div class="dp-estado ${pcConectada ? "dp-ok" : ""}"><i></i><span><b>${pcConectada ? "Conectado con tu computadora" : "La computadora no responde"}</b><small>${pcConectada ? "Lo que escanees llega a su pantalla." : "Revisa que la ventana de Nexo esté abierta en la computadora."}</small></span></div>
            <button type="button" class="dm-escanear" onclick="dpEscanear()"><span class="dm-escanear-icono">${icono("escanear", 30)}</span><span><b>Empezar a escanear</b><small>Cada lectura se manda a la computadora</small></span>${icono("siguiente", 20)}</button>
            <section class="dm-seccion"><div class="dm-seccion-cab"><h3>Enviados (${enviados.length})</h3></div>
                ${enviados.slice(0, 12).map(e => `<div class="dm-producto"><span class="dm-fila-texto"><b>${esc(e.codigo)}</b><small>${e.ok ? "Enviado a la computadora" : "No se pudo enviar"}</small></span><span class="dm-etiqueta dm-${e.ok ? "verde" : "rojo"}">${e.ok ? "✓" : "✕"}</span></div>`).join("") || `<p class="dm-nota">Todavía no has enviado ningún código.</p>`}
            </section>
            <p class="dm-nota">Sesión ${esc(sesion)}. Se cierra sola después de 4 horas sin usarse.</p>
            <button type="button" class="dm-secundario" onclick="dpDesconectar()">Desconectar</button>
        </main></div>`;
    }

    window.dpEscribe = function (valor) { escribiendo = String(valor || "").toUpperCase().replace(/[^A-Z0-9]/g, ""); const campo = document.getElementById("dpCodigo"); if (campo && campo.value !== escribiendo) campo.value = escribiendo; };

    window.dpAbrir = async function (codigoInicial = "") {
        pintar();

        const guardada = codigoInicial || (() => { try { return localStorage.getItem(LLAVE) || ""; } catch (error) { return ""; } })();

        if (guardada && !sesion) {
            escribiendo = guardada;
            await conectar(guardada, Boolean(codigoInicial));
        }
    };

    window.dpCerrar = function () { capa?.classList.remove("abierta"); };

    async function conectar(codigo, mostrarError = true) {
        const r = await llamar("/escaner-remoto/unir", { sesion: codigo });

        if (!r.ok) {
            olvidar();
            sesion = "";
            pintar();
            const error = document.getElementById("dpError");
            if (error && mostrarError) error.textContent = r.estado === 404 ? "Ese código no existe o ya se cerró. Genera otro en la computadora." : (r.datos.error || "No se pudo conectar.");
            return false;
        }

        sesion = codigo;
        pcConectada = Boolean(r.datos.pcConectada);
        guardar();
        pintar();
        iniciarLatido();
        return true;
    }

    window.dpConectar = async function () {
        const codigo = escribiendo.trim().toUpperCase();
        const error = document.getElementById("dpError");

        if (codigo.length !== 6) { if (error) error.textContent = "El código tiene 6 letras o números."; return; }

        const ok = await conectar(codigo);
        if (ok) N()?.aviso("Conectado con la computadora");
    };

    // El QR de la compu trae el enlace /dueno?escaner=CODIGO: se saca el codigo de ahi (o se acepta el codigo solo).
    window.dpEscanearQr = function () {
        if (typeof abrirEscanerCodigoDueno !== "function") return;

        abrirEscanerCodigoDueno({
            titulo: "Escanea el QR de la computadora",
            alCodigo: codigo => {
                const m = String(codigo).match(/escaner=([A-Za-z0-9]{6})/) || String(codigo).match(/^([A-Za-z0-9]{6})$/);

                if (!m) { N()?.aviso("Ese QR no es del escáner de Nexo.", "error"); return; }

                escribiendo = m[1].toUpperCase();
                conectar(escribiendo);
            }
        });
    };

    function iniciarLatido() {
        clearInterval(latido);
        latido = setInterval(async () => {
            if (!sesion) return;

            const r = await llamar("/escaner-remoto/unir", { sesion });

            if (!r.ok && r.estado === 404) { sesion = ""; olvidar(); clearInterval(latido); if (capa?.classList.contains("abierta")) pintar(); return; }

            const antes = pcConectada;
            pcConectada = r.ok && Boolean(r.datos.pcConectada);
            if (antes !== pcConectada && capa?.classList.contains("abierta") && !document.getElementById("duenoEscanerCodigoOverlay")?.classList.contains("abierta")) pintar();
        }, 15000);
    }

    window.dpDesconectar = async function () {
        const actual = sesion;

        clearInterval(latido);
        sesion = "";
        escribiendo = "";
        enviados = [];
        olvidar();
        if (actual) llamar("/escaner-remoto/cerrar", { sesion: actual });
        pintar();
    };

    // ---- Escanear y mandar ----
    window.dpEscanear = function () {
        if (typeof abrirEscanerCodigoDueno !== "function") { N()?.aviso("El escáner no está disponible en este equipo.", "error"); return; }

        abrirEscanerCodigoDueno({
            titulo: "Enviando a la computadora",
            continuo: true,
            alCodigo: async codigo => {
                const estado = document.getElementById("duenoEscanerCodigoEstado");
                const r = await llamar("/escaner-remoto/codigo", { sesion, codigo });

                enviados.unshift({ codigo, ok: r.ok });
                if (r.ok) pcConectada = Boolean(r.datos.pcConectada);

                if (!r.ok && r.estado === 404) { sesion = ""; olvidar(); if (estado) estado.textContent = "✕ La sesión se cerró. Conéctate de nuevo."; return; }
                if (estado) estado.textContent = r.ok ? (pcConectada ? `✓ ${codigo} enviado a la computadora` : `⚠ ${codigo} enviado, pero la computadora no responde`) : `✕ ${codigo}: ${r.datos.error || "no se pudo enviar"}`;
            }
        });

        // Al cerrar el escaner se muestra la lista actualizada.
        const cerrar = window.cerrarEscanerCodigoDueno;
        window.cerrarEscanerCodigoDueno = function (...a) { window.cerrarEscanerCodigoDueno = cerrar; const res = cerrar.apply(this, a); setTimeout(() => { if (capa?.classList.contains("abierta")) pintar(); }, 60); return res; };
    };

    // ---- Enlace directo: el QR de la compu abre /dueno?escaner=CODIGO ----
    function enlaceDirecto() {
        let codigo = "";

        try { codigo = (new URLSearchParams(location.search).get("escaner") || "").toUpperCase(); } catch (error) { return; }

        if (!/^[A-Z0-9]{6}$/.test(codigo)) return;

        let intentos = 0;
        const esperar = setInterval(() => {
            intentos++;

            if (typeof haySesionActivaDueno === "function" && haySesionActivaDueno() && window.NexoMovil) {
                clearInterval(esperar);
                try { history.replaceState(null, "", location.pathname); } catch (error) { /* nada */ }
                window.dpAbrir(codigo);
            } else if (intentos > 50) clearInterval(esperar);
        }, 800);
    }

    enlaceDirecto();
})();
