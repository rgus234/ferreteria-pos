/* Escaner de la computadora desde el celular: la camara lee codigos y los manda a la computadora (como un lector USB).
   Se empareja con el codigo de 6 letras/numeros (o el QR) que muestra la computadora. Servidor: /escaner-remoto/* (escaner-remoto-server.js).

   - Tarjeta en el Inicio ("Escaner de la compu"): estado en vivo y un toque para escanear. Es una de las funciones especiales de Nexo.
   - Pantalla: estado, contador del dia y la lista de lo que escaneaste (con nombre, foto, precio y existencia; lo que no esta en el inventario
     sale marcado con un boton para agregarlo).
   - Se reconecta sola al abrir la app o volver a ella. */

(function () {
    const N = () => window.NexoMovil;
    const esc = valor => (N() ? N().esc(valor) : String(valor ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])));
    const icono = (nombre, tam) => (N() ? N().icono(nombre, tam) : "");
    const LLAVE = "nexoEscanerPc";
    const LLAVE_HISTORIAL = "nexoEscanerPcHistorial";
    const MAX_HISTORIAL = 80;

    let capa = null;
    let sesion = "";
    let pcConectada = false;
    let conectadoDesde = 0;
    let historial = []; // { codigo, ok, t }
    let latido = null;
    let escribiendo = "";
    const productos = new Map(); // codigo -> producto | null (ya se busco y no esta)
    let temporizadorLista = null;

    // ------------------------------------------------------------------
    // Historial del dia (se conserva aunque cierres la app)
    // ------------------------------------------------------------------

    const hoyTexto = () => new Date().toDateString();

    function cargarHistorial() {
        try { historial = (JSON.parse(localStorage.getItem(LLAVE_HISTORIAL) || "[]") || []).filter(h => h && h.codigo && h.t); } catch (error) { historial = []; }
    }

    function guardarHistorial() {
        try { localStorage.setItem(LLAVE_HISTORIAL, JSON.stringify(historial.slice(0, MAX_HISTORIAL))); } catch (error) { /* sin almacenamiento */ }
    }

    const delDia = () => historial.filter(h => new Date(h.t).toDateString() === hoyTexto());

    function hace(t) {
        const minutos = Math.floor((Date.now() - t) / 60000);

        if (minutos < 1) return "ahora";
        if (minutos < 60) return `hace ${minutos} min`;

        const horas = Math.floor(minutos / 60);
        return horas < 24 ? `hace ${horas} h` : "ayer";
    }

    function duracion(desde) {
        if (!desde) return "";

        const minutos = Math.floor((Date.now() - desde) / 60000);

        if (minutos < 1) return "menos de 1 min";
        if (minutos < 60) return `${minutos} min`;

        return `${Math.floor(minutos / 60)} h ${String(minutos % 60).padStart(2, "0")} min`;
    }

    // ------------------------------------------------------------------
    // Estado compartido (lo usa la tarjeta del Inicio)
    // ------------------------------------------------------------------

    function estado() {
        if (!sesion) return "off";
        return pcConectada ? "ok" : "espera";
    }

    window.dpEstadoEscaner = () => ({ estado: estado(), hoy: delDia().filter(h => h.ok).length, desde: conectadoDesde });

    function avisarEstado() {
        if (pcConectada && sesion) { if (!conectadoDesde) conectadoDesde = Date.now(); } else conectadoDesde = 0;
        document.dispatchEvent(new CustomEvent("nexo-escaner-estado"));
    }

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

    const capaAbierta = () => Boolean(capa?.classList.contains("abierta"));
    const escanerAbierto = () => Boolean(document.getElementById("duenoEscanerCodigoOverlay")?.classList.contains("abierta"));

    function cabecera(titulo, subtitulo = "Celular → computadora") {
        return `<header class="dm-cabecera"><button type="button" class="dm-atras" onclick="dpCerrar()" aria-label="Atrás">${icono("atras", 22)}</button><div class="dm-titulo-caja"><h2>${esc(titulo)}</h2><small>${esc(subtitulo)}</small></div><span class="dm-atras dm-vacio"></span></header>`;
    }

    function guardar() { try { localStorage.setItem(LLAVE, sesion); } catch (error) { /* sin almacenamiento */ } }
    function olvidar() { try { localStorage.removeItem(LLAVE); } catch (error) { /* sin almacenamiento */ } }

    // ------------------------------------------------------------------
    // Ilustracion: celular -> computadora
    // ------------------------------------------------------------------

    const ILUSTRACION = `<svg class="dpe-ilu" viewBox="0 0 132 56" fill="none" aria-hidden="true">
        <rect class="dpe-ilu-cel" x="3" y="6" width="22" height="44" rx="5" stroke="currentColor" stroke-width="2.4"/><path d="M11 44h6" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/><path class="dpe-ilu-haz" d="M7 22h14" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
        <path class="dpe-ilu-linea" d="M32 28h40" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-dasharray="2 7"/>
        <path d="M76 22l7 6-7 6" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>
        <rect x="94" y="9" width="35" height="26" rx="4" stroke="currentColor" stroke-width="2.4"/><path d="M104 46h15M111.5 35v11" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/><path class="dpe-ilu-check" d="M104 22l5 5 9-10" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>`;

    // ------------------------------------------------------------------
    // Tarjeta del Inicio
    // ------------------------------------------------------------------

    function textosTarjeta() {
        const e = estado();
        const hoy = window.dpEstadoEscaner().hoy;
        const resumenHoy = hoy ? `${hoy} escaneado${hoy === 1 ? "" : "s"} hoy` : "";

        if (e === "ok") return { sub: `Conectado con tu computadora${conectadoDesde ? ` · ${duracion(conectadoDesde)}` : ""}`, estado: "Conectado", boton: "Escanear ahora", resumen: resumenHoy || "Listo para escanear" };
        if (e === "espera") return { sub: "Buscando tu computadora… Revisa que Nexo esté abierto en ella.", estado: "Esperando", boton: "Ver conexión", resumen: resumenHoy || "Sin conexión por ahora" };

        return { sub: "Usa la cámara del celular como lector de tu computadora. Lo que escaneas aparece en su pantalla.", estado: "Sin conectar", boton: "Conectar mi computadora", resumen: resumenHoy || "Toma menos de un minuto" };
    }

    function pintarTarjeta() {
        const tarjeta = document.getElementById("dpeTarjeta");
        if (!tarjeta) return;

        const t = textosTarjeta();

        tarjeta.dataset.estado = estado();
        tarjeta.innerHTML = `
            <div class="dpe-brillo" aria-hidden="true"></div>
            <div class="dpe-cabeza">
                <span class="dpe-etiqueta">Función especial de Nexo</span>
                <span class="dpe-estado"><i></i>${esc(t.estado)}</span>
            </div>
            <div class="dpe-cuerpo">
                <div class="dpe-texto"><h2>Escáner de la compu</h2><p>${esc(t.sub)}</p></div>
                ${ILUSTRACION}
            </div>
            <div class="dpe-pie">
                <span class="dpe-resumen">${esc(t.resumen)}</span>
                <button type="button" class="dpe-boton" data-dpe="accion">${esc(t.boton)}${icono("siguiente", 18)}</button>
            </div>`;
    }

    function instalarTarjeta() {
        if (document.getElementById("dpeTarjeta")) return;

        const kpis = document.querySelector("#duenoApp .dueno-kpis");
        if (!kpis) return;

        const tarjeta = document.createElement("section");
        tarjeta.id = "dpeTarjeta";
        tarjeta.className = "dpe-tarjeta";
        tarjeta.setAttribute("aria-label", "Escáner de la compu");
        kpis.insertAdjacentElement("beforebegin", tarjeta);

        tarjeta.addEventListener("click", evento => {
            if (evento.target.closest('[data-dpe="accion"]') && estado() === "ok") { window.dpEscanear(); return; }
            window.dpAbrir();
        });

        pintarTarjeta();
    }

    document.addEventListener("nexo-escaner-estado", () => { pintarTarjeta(); if (capaAbierta() && !escanerAbierto()) pintar(); });
    // El "hace X min" se refresca solo.
    setInterval(() => { if (sesion) { pintarTarjeta(); if (capaAbierta() && !escanerAbierto()) pintar(); } }, 30000);

    // ------------------------------------------------------------------
    // Productos escaneados: nombre, foto, precio y existencia
    // ------------------------------------------------------------------

    async function resolver(codigo) {
        if (productos.has(codigo)) return productos.get(codigo);

        let producto = null;

        try { producto = typeof buscarProductoPorCodigoDueno === "function" ? await buscarProductoPorCodigoDueno(codigo) : null; } catch (error) { producto = null; }

        productos.set(codigo, producto || null);
        return productos.get(codigo);
    }

    async function resolverPendientes() {
        const pendientes = [...new Set(delDia().slice(0, 12).map(h => h.codigo))].filter(c => !productos.has(c));
        if (!pendientes.length) return;

        await Promise.all(pendientes.map(resolver));

        clearTimeout(temporizadorLista);
        temporizadorLista = setTimeout(() => { if (capaAbierta() && !escanerAbierto() && sesion) pintar(); }, 60);
    }

    const plata = valor => "$" + Number(valor || 0).toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

    function filaEscaneado(h) {
        const p = productos.get(h.codigo);
        const buscando = !productos.has(h.codigo);
        const foto = p?.imagenUrl || p?.imagen_url || "";
        const inicial = esc((p?.nombre || h.codigo || "?").trim().charAt(0).toUpperCase());
        const existencia = p && p.stock != null ? Number(p.stock) : null;
        const etiquetaStock = existencia == null ? "" : `<span class="dm-etiqueta ${existencia <= 0 ? "dm-rojo" : existencia <= 3 ? "dm-ambar" : "dm-verde"}">${existencia <= 0 ? "Agotado" : `${existencia} en stock`}</span>`;

        const avatar = foto ? `<span class="dpe-avatar"><img src="${esc(foto)}" alt="" loading="lazy"></span>` : `<span class="dpe-avatar dpe-letra ${p ? "" : "dpe-sin"}">${buscando ? "…" : p ? inicial : "?"}</span>`;
        const estadoEnvio = h.ok ? `<span class="dpe-envio dpe-envio-ok" title="Enviado a la computadora">✓</span>` : `<span class="dpe-envio dpe-envio-mal" title="No se pudo enviar">✕</span>`;

        if (!buscando && !p) {
            return `<article class="dpe-item dpe-item-nuevo">
                ${avatar}
                <div class="dpe-info"><b>No está en tu inventario</b><small class="dpe-codigo">${esc(h.codigo)} · ${hace(h.t)}</small></div>
                <button type="button" class="dpe-agregar" onclick="dpAgregarProducto('${esc(h.codigo)}')">Agregar</button>
            </article>`;
        }

        return `<article class="dpe-item">
            ${avatar}
            <div class="dpe-info"><b>${buscando ? "Buscando producto…" : esc(p.nombre || h.codigo)}</b><small class="dpe-codigo">${esc(h.codigo)} · ${hace(h.t)}</small>${!buscando ? `<div class="dpe-meta"><span class="dpe-precio">${plata(p.precio ?? p.precioPublico ?? 0)}</span>${etiquetaStock}</div>` : ""}</div>
            ${estadoEnvio}
        </article>`;
    }

    window.dpAgregarProducto = function (codigo) {
        if (typeof abrirFormularioProductoDueno !== "function") { N()?.aviso("No se pudo abrir el formulario.", "error"); return; }

        abrirFormularioProductoDueno(null, {
            codigo,
            alGuardar: () => { productos.delete(codigo); resolverPendientes(); if (capaAbierta()) pintar(); }
        });
    };

    // ------------------------------------------------------------------
    // Pantalla
    // ------------------------------------------------------------------

    function pintar() {
        const c = obtenerCapa();

        if (!sesion) {
            c.innerHTML = `<div class="dm-marco">${cabecera("Escáner de la compu")}<main class="dm-cuerpo dpe-pantalla">
                <section class="dpe-heroe" data-estado="off">
                    <div class="dpe-brillo" aria-hidden="true"></div>
                    <span class="dpe-etiqueta">Función especial de Nexo</span>
                    ${ILUSTRACION}
                    <h2>Usa la cámara de tu celular en tu computadora</h2>
                    <p>Escaneas un producto con el celular y aparece al instante en la pantalla de la computadora, como con un lector USB.</p>
                </section>
                <ol class="dpe-pasos">
                    <li><span>1</span><div><b>En la computadora</b><small>Toca el botón del celular, arriba junto al buscador, o el indicador de la barra.</small></div></li>
                    <li><span>2</span><div><b>Aquí en el celular</b><small>Escribe el código que aparece, o escanea su QR.</small></div></li>
                    <li><span>3</span><div><b>Escanea</b><small>Cada producto llega solo a la computadora.</small></div></li>
                </ol>
                <label class="dm-campo dpe-campo">Código de la computadora<input id="dpCodigo" class="dm-input dp-codigo" type="text" maxlength="6" autocapitalize="characters" autocomplete="off" placeholder="ABC123" value="${esc(escribiendo)}" oninput="dpEscribe(this.value)"></label>
                <p id="dpError" class="dm-error"></p>
                <button type="button" class="dm-grande" onclick="dpConectar()">Conectar</button>
                <button type="button" class="dm-secundario" onclick="dpEscanearQr()">Escanear el QR de la pantalla</button>
            </main></div>`;
            return;
        }

        const e = estado();
        const hoyLista = delDia();
        const enviadosHoy = hoyLista.filter(h => h.ok).length;
        const titulo = e === "ok" ? "Conectado con tu computadora" : "La computadora no responde";
        const detalle = e === "ok" ? `Conectado desde hace ${duracion(conectadoDesde) || "menos de 1 min"}. Lo que escanees llega a su pantalla.` : "Revisa que la ventana de Nexo esté abierta en la computadora.";

        c.innerHTML = `<div class="dm-marco">${cabecera("Escáner de la compu")}<main class="dm-cuerpo dpe-pantalla">
            <section class="dpe-heroe dpe-heroe-conexion" data-estado="${e}">
                <div class="dpe-brillo" aria-hidden="true"></div>
                <div class="dpe-fila-estado">
                    <div class="dpe-anillo"><i></i></div>
                    <div class="dpe-textos"><b>${esc(titulo)}</b><small>${esc(detalle)}</small></div>
                    <div class="dpe-contador"><strong>${enviadosHoy}</strong><span>hoy</span></div>
                </div>
                <button type="button" class="dpe-escanear" onclick="dpEscanear()"><span class="dpe-escanear-icono">${icono("escanear", 28)}</span><span><b>Empezar a escanear</b><small>Cada lectura se manda a la computadora</small></span>${icono("siguiente", 20)}</button>
            </section>

            <section class="dpe-lista">
                <div class="dpe-lista-cab"><h3>Escaneados hoy</h3>${hoyLista.length ? `<button type="button" class="dpe-limpiar" onclick="dpLimpiarLista()">Limpiar</button>` : ""}</div>
                ${hoyLista.length ? hoyLista.slice(0, 30).map(filaEscaneado).join("") : `<div class="dpe-vacio"><span aria-hidden="true">📦</span><b>Todavía no has escaneado nada hoy</b><small>Toca “Empezar a escanear” y apunta la cámara a un código de barras.</small></div>`}
            </section>

            <p class="dm-nota">Sesión ${esc(sesion)}. Si sales de la app y vuelves a abrirla, se reconecta sola. Se cierra sola si la computadora pasa 4 horas sin usarse.</p>
            <button type="button" class="dm-secundario" onclick="dpDesconectar()">Desconectar</button>
        </main></div>`;

        resolverPendientes();
    }

    window.dpLimpiarLista = function () {
        const hoy = hoyTexto();
        historial = historial.filter(h => new Date(h.t).toDateString() !== hoy);
        guardarHistorial();
        avisarEstado();
        pintar();
    };

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
            avisarEstado();
            pintar();
            const error = document.getElementById("dpError");
            if (error && mostrarError) error.textContent = r.estado === 404 ? "Ese código no existe o ya se cerró. Genera otro en la computadora." : (r.datos.error || "No se pudo conectar.");
            return false;
        }

        sesion = codigo;
        pcConectada = Boolean(r.datos.pcConectada);
        guardar();
        avisarEstado();
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

            if (!r.ok && r.estado === 404) { sesion = ""; olvidar(); clearInterval(latido); avisarEstado(); if (capaAbierta() && !escanerAbierto()) pintar(); return; }

            const antes = pcConectada;
            pcConectada = r.ok && Boolean(r.datos.pcConectada);

            if (antes !== pcConectada) { avisarEstado(); if (capaAbierta() && !escanerAbierto()) pintar(); }
        }, 15000);
    }

    window.dpDesconectar = async function () {
        const actual = sesion;

        clearInterval(latido);
        sesion = "";
        escribiendo = "";
        pcConectada = false;
        olvidar();
        if (actual) llamar("/escaner-remoto/cerrar", { sesion: actual });
        avisarEstado();
        pintar();
    };

    // ---- Escanear y mandar ----
    window.dpEscanear = function () {
        if (!sesion) { window.dpAbrir(); return; }

        if (typeof abrirEscanerCodigoDueno !== "function") { N()?.aviso("El escáner no está disponible en este equipo.", "error"); return; }

        abrirEscanerCodigoDueno({
            titulo: "Enviando a la computadora",
            continuo: true,
            alCodigo: async codigo => {
                const estadoEscaner = document.getElementById("duenoEscanerCodigoEstado");
                const r = await llamar("/escaner-remoto/codigo", { sesion, codigo });

                historial.unshift({ codigo, ok: r.ok, t: Date.now() });
                historial = historial.slice(0, MAX_HISTORIAL);
                guardarHistorial();
                if (r.ok) pcConectada = Boolean(r.datos.pcConectada);

                if (!r.ok && r.estado === 404) { sesion = ""; olvidar(); avisarEstado(); if (estadoEscaner) estadoEscaner.textContent = "✕ La sesión se cerró. Conéctate de nuevo."; return; }

                avisarEstado();
                if (estadoEscaner) estadoEscaner.textContent = r.ok ? (pcConectada ? `✓ ${codigo} enviado a la computadora` : `⚠ ${codigo} enviado, pero la computadora no responde`) : `✕ ${codigo}: ${r.datos.error || "no se pudo enviar"}`;
            }
        });

        // Al cerrar el escaner se muestra la lista actualizada.
        const cerrar = window.cerrarEscanerCodigoDueno;
        window.cerrarEscanerCodigoDueno = function (...a) { window.cerrarEscanerCodigoDueno = cerrar; const res = cerrar.apply(this, a); setTimeout(() => { obtenerCapa(); pintar(); }, 60); return res; };
    };

    // ---- Reconexion al abrir la app o volver a ella ----
    // Si ya habias conectado este celular, al abrir la app (o volver a ella) se reconecta sola y sin abrir nada. Si el codigo guardado ya no
    // existe (la compu se reinicio), busca la computadora de tu negocio que este conectada; solo se une si hay UNA.
    function adoptar(codigo, datos) {
        sesion = codigo;
        pcConectada = Boolean(datos.pcConectada);
        guardar();
        iniciarLatido();
        avisarEstado();
        if (capaAbierta() && !escanerAbierto()) pintar();
    }

    async function reconectarSilencioso() {
        let guardada = "";
        try { guardada = localStorage.getItem(LLAVE) || ""; } catch (error) { return; }

        if (!guardada && !sesion) return; // nunca se ha conectado: no se une a nada por su cuenta

        const codigo = sesion || guardada;
        const r = await llamar("/escaner-remoto/unir", { sesion: codigo });

        if (r.ok) { adoptar(codigo, r.datos); return; }
        if (r.estado !== 404) return; // sin internet: se vuelve a intentar al volver a la app

        sesion = "";
        olvidar();
        clearInterval(latido);

        const activa = await (async () => { try { return await fetchAutenticado("/escaner-remoto/activa"); } catch (error) { return null; } })();

        if (activa?.sesion) {
            const union = await llamar("/escaner-remoto/unir", { sesion: activa.sesion });
            if (union.ok) { adoptar(activa.sesion, union.datos); return; }
        }

        avisarEstado();
        if (capaAbierta() && !escanerAbierto()) pintar();
    }

    function iniciarReconexion() {
        let intentos = 0;
        const esperar = setInterval(() => {
            intentos++;

            if (typeof haySesionActivaDueno === "function" && haySesionActivaDueno()) { clearInterval(esperar); reconectarSilencioso(); }
            else if (intentos > 40) clearInterval(esperar);
        }, 1000);

        document.addEventListener("visibilitychange", () => {
            if (document.visibilityState === "visible" && typeof haySesionActivaDueno === "function" && haySesionActivaDueno()) reconectarSilencioso();
        });
    }

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

    cargarHistorial();

    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", instalarTarjeta); else instalarTarjeta();

    enlaceDirecto();
    iniciarReconexion();
})();
