// Correo de facturas (abarrotes): conectar el Gmail para que las facturas lleguen solas a "Recibir con factura".
// Se conecta una sola vez, por eso vive en Configuración; el estado también se ve (y se puede revisar) desde Recibir mercancía.
// Reusa las rutas y la conexión de siempre (/recepcion-inteligente/gmail/...) y riConectarGmail (recepcion-inteligente-view.js).
(function () {
    const esc = valor => String(valor ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
    const aviso = (mensaje, tipo) => { if (typeof mostrarToastPOS === "function") mostrarToastPOS(mensaje, tipo ? { tipo } : undefined); };

    async function llamar(ruta, metodo) {
        const r = await fetch(ruta, { method: metodo || "GET" });
        const datos = await r.json().catch(() => ({}));
        return { ok: r.ok && datos.ok !== false, datos };
    }

    // { configurado, conectado, correo } -- o null si no se pudo saber.
    window.estadoCorreoFacturas = async function () {
        try {
            const r = await llamar("/recepcion-inteligente/gmail/estado");
            return r.ok ? { configurado: Boolean(r.datos.configurado), conectado: Boolean(r.datos.conectado), correo: r.datos.correo || "" } : null;
        } catch (error) {
            return null;
        }
    };

    window.conectarCorreoFacturas = async function () {
        if (typeof riConectarGmail === "function") await riConectarGmail();
    };

    // Busca facturas nuevas en el correo. Regresa true si la consulta salio bien.
    window.revisarCorreoFacturas = async function () {
        const r = await llamar("/recepcion-inteligente/gmail/buscar", "POST");

        if (!r.ok) { aviso(r.datos.error || "No se pudo buscar en el correo.", "error"); return false; }

        const d = r.datos;
        const partes = [];
        if (d.nuevas) partes.push(`${d.nuevas} nueva${d.nuevas === 1 ? "" : "s"}`);
        if (d.repetidas) partes.push(`${d.repetidas} ya conocida${d.repetidas === 1 ? "" : "s"}`);
        if (d.fallidas) partes.push(`${d.fallidas} sin poder leer`);
        aviso(d.mensajesRevisados ? `Se revisaron ${d.mensajesRevisados} correo${d.mensajesRevisados === 1 ? "" : "s"}: ${partes.join(", ") || "nada nuevo"}.` : "No hay correos nuevos con factura adjunta.");
        return true;
    };

    window.desconectarCorreoFacturas = async function () {
        const ok = typeof confirmarPOS === "function" ? await confirmarPOS("Nexo dejará de buscar facturas en este correo hasta que lo vuelvas a conectar.", "¿Desconectar el correo?", "alerta") : true;
        if (!ok) return false;

        const r = await llamar("/recepcion-inteligente/gmail/desconectar", "POST");

        if (!r.ok) { aviso(r.datos.error || "No se pudo desconectar.", "error"); return false; }
        return true;
    };

    // ---------- Pantalla de Configuración ----------

    async function pintar() {
        const pantalla = document.getElementById("pantallaCorreoFacturas");
        if (!pantalla || pantalla.style.display === "none") return;
        const e = await window.estadoCorreoFacturas();

        let cuerpo;

        if (!e) cuerpo = `<p class="cf-nota">No se pudo consultar el correo ahora mismo. Revisa tu internet.</p>`;
        else if (!e.configurado) cuerpo = `<div class="cf-estado"><b>Todavía no está disponible</b><p>La conexión con el correo se activa pronto. Mientras tanto puedes subir tus facturas (XML) desde Compras → Recibir mercancía → Recibir con factura.</p></div>`;
        else if (!e.conectado) cuerpo = `<div class="cf-estado"><b>Sin correo conectado</b><p>Conecta el Gmail donde te llegan las facturas de tus proveedores y Nexo las trae solas a Recibir con factura.</p><button type="button" class="cf-principal" onclick="cfConectar()">Conectar Gmail</button></div>`;
        else cuerpo = `<div class="cf-estado cf-ok"><b>Conectado</b><p><strong>${esc(e.correo)}</strong><br>Nexo revisa este correo cada cierto tiempo y las facturas nuevas aparecen en Compras → Recibir mercancía → Recibir con factura.</p>
            <div class="cf-acciones"><button type="button" class="cf-principal" onclick="cfRevisar(this)">Revisar ahora</button><button type="button" class="cf-sec" onclick="cfDesconectar()">Desconectar</button></div></div>`;

        pantalla.innerHTML = `<div class="cf-shell"><header><h2>Correo de facturas</h2><p>Las facturas de tus proveedores llegan solas, sin subirlas a mano.</p></header>${cuerpo}</div>`;
    }

    window.mostrarCorreoFacturas = async function () {
        if (typeof ocultarPantallasPrincipales === "function") ocultarPantallasPrincipales();
        const pantalla = document.getElementById("pantallaCorreoFacturas");
        if (!pantalla) return;
        pantalla.style.display = "block";
        if (typeof actualizarTopbarContexto === "function") actualizarTopbarContexto("Correo de facturas", "Que tus facturas lleguen solas", "correo-facturas");
        pantalla.innerHTML = `<div class="cf-shell"><p class="cf-nota">Cargando…</p></div>`;
        await pintar();
    };

    window.cfConectar = async function () { await window.conectarCorreoFacturas(); };
    window.cfRevisar = async function (boton) { if (boton) { boton.disabled = true; boton.textContent = "Buscando…"; } await window.revisarCorreoFacturas(); await pintar(); };
    window.cfDesconectar = async function () { if (await window.desconectarCorreoFacturas()) await pintar(); };

    // Al volver de Google (la conexion se completa en el navegador), la pantalla se entera sola.
    if (window.nexoDesktop && typeof window.nexoDesktop.onWindowFocused === "function") window.nexoDesktop.onWindowFocused(() => { pintar(); });
})();
