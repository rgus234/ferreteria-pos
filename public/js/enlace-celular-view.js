// "App del dueño": enlazar el celular con un QR desde la computadora (rutas en enlace-celular-server.js).
// El QR y el codigo vencen a los 2 minutos y sirven una sola vez; la pantalla se entera sola cuando el celular se enlaza.
// Funcion nueva: se enciende en Nexo -> Funciones nuevas ("enlace_celular"); apagada, el boton abre la app en otra pestaña como siempre.
(function () {
    const CIRCUNFERENCIA = 2 * Math.PI * 26;
    const st = { enlace: null, estado: "cargando", segundos: 0, relojId: null, sondeoId: null, celulares: [], celular: "", error: "", reservado: false };

    const esc = valor => String(valor ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
    const pantalla = () => document.getElementById("pantallaEnlaceCelular");
    const aviso = (mensaje, tipo) => { if (typeof mostrarToastPOS === "function") mostrarToastPOS(mensaje, tipo ? { tipo } : undefined); };

    async function llamar(ruta, opciones = {}) {
        const respuesta = await fetch(ruta, { ...opciones, headers: { "Content-Type": "application/json", ...(opciones.headers || {}) } });
        const datos = await respuesta.json().catch(() => ({}));
        return { ok: respuesta.ok && datos.ok !== false, datos };
    }

    function hace(fecha) {
        if (!fecha) return "";
        const s = Math.max(0, Math.round((Date.now() - new Date(fecha).getTime()) / 1000));
        if (s < 60) return "hace un momento";
        if (s < 3600) return `hace ${Math.round(s / 60)} min`;
        if (s < 86400) return `hace ${Math.round(s / 3600)} h`;
        return `hace ${Math.round(s / 86400)} día${Math.round(s / 86400) === 1 ? "" : "s"}`;
    }

    // "Mozilla/5.0 (iPhone; ...) Safari" -> "iPhone · Safari" (lo que el dueño reconoce, no el texto tecnico del navegador)
    function nombreAmigable(texto) {
        const t = String(texto || "");
        const aparato = /iPad/.test(t) ? "iPad" : /iPhone|iPod/.test(t) ? "iPhone" : /Android/.test(t) ? (/Mobile/.test(t) ? "Celular Android" : "Tableta Android") : /Windows/.test(t) ? "Windows" : /Macintosh|Mac OS/.test(t) ? "Mac" : "Celular";
        const navegador = /EdgA?\//.test(t) ? "Edge" : /SamsungBrowser/.test(t) ? "Samsung Internet" : /Firefox|FxiOS/.test(t) ? "Firefox" : /CriOS|Chrome/.test(t) ? "Chrome" : /Safari/.test(t) ? "Safari" : "";
        return navegador ? `${aparato} · ${navegador}` : aparato;
    }

    const activoAhora = fecha => fecha && Date.now() - new Date(fecha).getTime() < 5 * 60 * 1000;

    const reloj = s => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

    function detener() {
        clearInterval(st.relojId);
        clearInterval(st.sondeoId);
        st.relojId = st.sondeoId = null;
    }

    window.mostrarEnlaceCelular = async function () {
        if (typeof ocultarPantallasPrincipales === "function") ocultarPantallasPrincipales();
        const p = pantalla();
        if (!p) return;
        p.style.display = "block";
        if (typeof actualizarTopbarContexto === "function") actualizarTopbarContexto("App del dueño", "Enlaza tu celular con un QR", "enlace-celular");

        st.estado = "cargando";
        st.error = "";
        pintar();
        await generar();
        cargarCelulares();
    };

    async function generar() {
        detener();
        st.estado = "cargando";
        pintar();

        const r = await llamar("/enlace-celular/crear", { method: "POST", body: "{}" });

        if (!r.ok) {
            st.estado = "error";
            st.error = r.datos.error || "No se pudo crear el código. Revisa tu conexión e intenta de nuevo.";
            pintar();
            return;
        }

        st.enlace = r.datos;
        st.reservado = false;
        st.estado = "esperando";
        st.segundos = r.datos.expiraEnSegundos;
        pintar();

        st.relojId = setInterval(() => {
            // Si el dueño cambio de pantalla, ya no hace falta seguir preguntando.
            const p = pantalla();
            if (!p || p.style.display === "none") { detener(); return; }
            if (st.estado !== "esperando") return;
            st.segundos = Math.max(0, st.segundos - 1);
            actualizarReloj();
            if (st.segundos === 0) { st.estado = "vencido"; detener(); pintar(); }
        }, 1000);

        st.sondeoId = setInterval(async () => {
            if (st.estado !== "esperando" || !st.enlace) return;
            const e = await llamar(`/enlace-celular/${st.enlace.id}/estado`);
            if (!e.ok || st.estado !== "esperando") return;

            if (e.datos.estado === "enlazado") {
                st.estado = "enlazado";
                st.celular = e.datos.celular || "Celular";
                detener();
                pintar();
                cargarCelulares();
            } else if (e.datos.estado === "vencido") {
                st.estado = "vencido";
                detener();
                pintar();
            } else if (e.datos.reservado) {
                // El celular esta instalando la app: el QR se cambio por un codigo de 10 minutos que se escribe en la app ya instalada.
                const primera = !st.reservado;
                st.reservado = true;
                st.segundos = e.datos.segundosRestantes;
                st.enlace.expiraEnSegundos = Math.max(st.enlace.expiraEnSegundos, st.segundos);
                if (primera) pintar();
            }
        }, 2000);
    }

    async function cargarCelulares() {
        const r = await llamar("/enlace-celular/celulares");
        st.celulares = r.ok ? r.datos.celulares || [] : [];
        const caja = document.getElementById("ecCelulares");
        if (caja) caja.innerHTML = htmlCelulares();
        const cuenta = document.querySelector(".ec-cuenta");
        if (cuenta) cuenta.textContent = String(st.celulares.length);
    }

    function actualizarReloj() {
        const texto = document.getElementById("ecRelojTexto");
        const anillo = document.getElementById("ecAnillo");
        if (texto) texto.textContent = reloj(st.segundos);
        if (anillo && st.enlace) anillo.style.strokeDashoffset = String(CIRCUNFERENCIA * (1 - st.segundos / st.enlace.expiraEnSegundos));
        const caja = document.getElementById("ecRelojCaja");
        if (caja) caja.classList.toggle("poco", st.segundos <= 20);
    }

    // ---------- pintado ----------

    function htmlTelefono() {
        return `<div class="ec-telefono" aria-hidden="true"><div class="ec-tel-marco"><i class="ec-tel-isla"></i>
            <div class="ec-tel-pantalla">
                <small>Ventas de hoy</small><b>$12,480</b><em>▲ 18% vs ayer</em>
                <div class="ec-tel-barras"><i style="--h:38%"></i><i style="--h:62%"></i><i style="--h:48%"></i><i style="--h:80%"></i><i style="--h:56%"></i><i style="--h:92%"></i><i style="--h:70%"></i></div>
                <div class="ec-tel-fila"><span></span><u></u></div><div class="ec-tel-fila"><span></span><u></u></div><div class="ec-tel-fila corta"><span></span><u></u></div>
            </div></div></div>`;
    }

    function htmlPasos() {
        const hecho = st.estado === "enlazado";
        const paso = (n, titulo, texto, activo, listo) => `<li class="${listo ? "listo" : activo ? "activo" : ""}"><span class="ec-num">${listo ? "✓" : n}</span><div><b>${titulo}</b><small>${texto}</small></div></li>`;
        return `<ol class="ec-pasos">${paso(1, "Abre la cámara", "En tu celular, la cámara normal.", st.estado === "esperando", hecho)}${paso(2, "Apunta al código", "Toca el aviso que aparece.", st.estado === "esperando", hecho)}${paso(3, "¡Listo!", "Entras directo, sin contraseña.", hecho, hecho)}</ol>`;
    }

    function htmlQr() {
        const base = `<div class="ec-qr-caja ${st.estado}"><i class="ec-esq a"></i><i class="ec-esq b"></i><i class="ec-esq c"></i><i class="ec-esq d"></i>`;

        if (st.estado === "cargando") return `${base}<div class="ec-qr ec-qr-carga"><span class="ec-spinner"></span><small>Creando tu código…</small></div></div>`;
        if (st.estado === "error") return `${base}<div class="ec-qr ec-qr-carga"><b>No se pudo crear</b><small>${esc(st.error)}</small><button type="button" class="ec-btn principal" onclick="ecGenerar()">Reintentar</button></div></div>`;

        const velo = st.estado === "enlazado"
            ? `<div class="ec-velo ok"><svg viewBox="0 0 52 52" class="ec-check"><circle cx="26" cy="26" r="24"/><path d="M14 27l8 8 16-17"/></svg><b>¡Celular enlazado!</b><small>${esc(st.celular)}</small></div>`
            : st.estado === "vencido"
                ? `<div class="ec-velo"><b>El código venció</b><small>Por seguridad dura 2 minutos.</small><button type="button" class="ec-btn principal" onclick="ecGenerar()">Generar código nuevo</button></div>`
                : `<i class="ec-escaneo"></i>`;

        return `${base}<div class="ec-qr">${st.enlace.qrSvg}</div>${velo}</div>`;
    }

    function htmlReloj() {
        if (st.estado !== "esperando") return "";
        const fraccion = st.segundos / st.enlace.expiraEnSegundos;
        return `<div class="ec-reloj ${st.segundos <= 20 ? "poco" : ""}" id="ecRelojCaja"><svg viewBox="0 0 60 60"><circle class="fondo" cx="30" cy="30" r="26"/><circle class="anillo" id="ecAnillo" cx="30" cy="30" r="26" style="stroke-dasharray:${CIRCUNFERENCIA};stroke-dashoffset:${CIRCUNFERENCIA * (1 - fraccion)}"/></svg><div><small>Vence en</small><b id="ecRelojTexto">${reloj(st.segundos)}</b></div></div>`;
    }

    function htmlCodigo() {
        if (!st.enlace || st.estado === "cargando" || st.estado === "error") return "";
        const letras = st.enlace.codigoCorto.split("").map(c => c === "-" ? `<i class="ec-guion"></i>` : `<span>${esc(c)}</span>`).join("");
        return `<div class="ec-codigo"><small>¿No puedes escanear? Escribe este código en el celular</small><div class="ec-letras ${st.estado === "esperando" ? "" : "apagado"}">${letras}</div>
            <button type="button" class="ec-enlace" onclick="ecCopiar()">Copiar código</button></div>`;
    }

    function htmlCelulares() {
        if (!st.celulares.length) return `<div class="ec-vacio"><b>Todavía no hay celulares enlazados</b><small>Cuando enlaces uno aparecerá aquí, y desde aquí mismo le puedes quitar el acceso.</small></div>`;
        return st.celulares.map(c => `<article class="ec-celular"><span class="ec-celular-icono">${/iPad|Tableta/.test(nombreAmigable(c.nombre)) ? "📲" : "📱"}</span><div><b>${esc(nombreAmigable(c.nombre))}${activoAhora(c.ultimoUso) ? `<span class="ec-activo"><i></i>Activo ahora</span>` : ""}</b><small>Enlazado ${esc(hace(c.enlazadoEn))}${c.ultimoUso ? ` · último uso ${esc(hace(c.ultimoUso))}` : ""}</small></div><button type="button" class="ec-btn peligro" onclick="ecQuitar(${Number(c.id)})">Quitar acceso</button></article>`).join("");
    }

    function pintar() {
        const p = pantalla();
        if (!p) return;

        p.innerHTML = `<div class="ec-shell">
            <section class="ec-hero">
                <div class="ec-hero-texto">
                    <span class="ec-pildora">App del dueño</span>
                    <h2>Tu negocio,<br>en tu bolsillo.</h2>
                    <p>Mira tus ventas en vivo, revisa el inventario y recibe avisos de lo que pasa en tu tienda. Se enlaza en 10 segundos y sin escribir contraseñas.</p>
                    <ul class="ec-beneficios"><li><i>📈</i>Ventas en tiempo real</li><li><i>📦</i>Inventario y alertas</li><li><i>🔔</i>Avisos de tus ventas</li></ul>
                </div>
                ${htmlTelefono()}
            </section>
            <section class="ec-panel">
                <header><h3>Enlaza tu celular</h3><p>Escanea con la cámara. El código sirve una sola vez.</p></header>
                ${htmlPasos()}
                <div class="ec-centro">${htmlQr()}${htmlReloj()}${st.reservado && st.estado === "esperando" ? `<p class="ec-instalando"><b>📲 Tu celular está instalando la app.</b> Cuando la abra, tocará “Tengo un código” y escribirá el que le mostró. Tiene hasta que termine el reloj.</p>` : ""}</div>
                ${htmlCodigo()}
                <div class="ec-acciones"><button type="button" class="ec-btn" onclick="ecGenerar()">${st.estado === "enlazado" ? "Enlazar otro celular" : "Generar código nuevo"}</button></div>
                <p class="ec-web">¿Prefieres usarla aquí? <button type="button" class="ec-enlace" onclick="window.open('/dueno', '_blank')">Abrir la app del dueño en internet ↗</button></p>
            </section>
            <section class="ec-lista"><header><h3>Dispositivos conectados <span class="ec-cuenta">${st.celulares.length}</span></h3><p>Los celulares enlazados con este QR. Si pierdes uno, quítale el acceso aquí.</p></header><div id="ecCelulares" class="ec-celulares">${htmlCelulares()}</div></section>
        </div>`;
    }

    // ---------- acciones ----------

    window.ecGenerar = generar;

    window.ecCopiar = async function () {
        if (!st.enlace) return;
        try { await navigator.clipboard.writeText(st.enlace.codigoCorto); aviso("Código copiado."); } catch (error) { aviso("No se pudo copiar. Escríbelo a mano.", "error"); }
    };

    window.ecQuitar = async function (id) {
        const ok = typeof confirmarPOS === "function" ? await confirmarPOS("Ese celular ya no podrá entrar a tu negocio hasta que lo vuelvas a enlazar. ¿Quitar el acceso?", "Quitar acceso", "alerta") : window.confirm("¿Quitar el acceso a este celular?");
        if (!ok) return;
        const r = await llamar(`/enlace-celular/celulares/${id}/quitar`, { method: "POST", body: "{}" });
        if (!r.ok) { aviso(r.datos.error || "No se pudo quitar el acceso.", "error"); return; }
        aviso("Acceso quitado.");
        cargarCelulares();
    };
})();
