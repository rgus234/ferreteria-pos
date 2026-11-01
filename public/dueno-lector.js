/* Lector de codigos de barras del celular, compartido por Vender, Inventario, Captura y Pedidos.
   Antes cada pantalla usaba la libreria con su configuracion por defecto: un intento cada 500 ms, todos los formatos a la vez
   (QR, Aztec, PDF417...), camara de resolucion baja y sin pedir enfoque. Ahora:
     - si el celular trae el lector nativo (BarcodeDetector, Chrome en Android) se usa ese: es el mas rapido;
     - si no (iPhone), ZXing solo con los formatos de producto, un intento cada ~80 ms, camara de 1280x720 y enfoque continuo;
     - boton de linterna si el celular la tiene; vibra al leer. */
(function () {
    const FORMATOS_ZXING = ["EAN_13", "EAN_8", "UPC_A", "UPC_E", "CODE_128", "CODE_39", "ITF"];
    const FORMATOS_NATIVOS = ["ean_13", "ean_8", "upc_a", "upc_e", "code_128", "code_39", "itf"];
    const PAUSA_NATIVA_MS = 60;
    const MISMO_CODIGO_MS = 2500;

    function restricciones() {
        return { audio: false, video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 }, advanced: [{ focusMode: "continuous" }] } };
    }

    function instalarEstilos() {
        if (document.getElementById("duenoLectorEstilos")) return;
        const estilo = document.createElement("style");
        estilo.id = "duenoLectorEstilos";
        estilo.textContent = ".dueno-linterna{position:absolute;top:10px;right:10px;z-index:3;padding:8px 14px;border:0;border-radius:999px;background:rgba(15,23,42,.72);color:#fff;font:700 13px system-ui,sans-serif;-webkit-backdrop-filter:blur(6px);backdrop-filter:blur(6px)}.dueno-linterna.encendida{background:#f59e0b;color:#1f1300}";
        document.head.appendChild(estilo);
    }

    function agregarLinterna(video, pista) {
        const capacidades = pista && pista.getCapabilities ? pista.getCapabilities() : {};
        if (!capacidades.torch || !video.parentElement) return null;

        instalarEstilos();
        const padre = video.parentElement;
        if (getComputedStyle(padre).position === "static") padre.style.position = "relative";

        const boton = document.createElement("button");
        boton.type = "button";
        boton.className = "dueno-linterna";
        boton.textContent = "Linterna";
        let encendida = false;

        boton.addEventListener("click", async () => {
            encendida = !encendida;
            try { await pista.applyConstraints({ advanced: [{ torch: encendida }] }); } catch (error) { encendida = false; }
            boton.classList.toggle("encendida", encendida);
        });

        padre.appendChild(boton);
        return boton;
    }

    function pedirEnfoque(pista) {
        try { if (pista && pista.applyConstraints) pista.applyConstraints({ advanced: [{ focusMode: "continuous" }] }).catch(() => {}); } catch (error) { /* sin control de enfoque */ }
    }

    // Lector nativo del celular. Devuelve null si no existe o no funciona, para caer en ZXing.
    async function iniciarNativo(video, enviar, conQr) {
        if (!("BarcodeDetector" in window)) return null;

        let formatos;
        try {
            const soportados = await window.BarcodeDetector.getSupportedFormats();
            formatos = FORMATOS_NATIVOS.concat(conQr ? ["qr_code"] : []).filter(f => soportados.includes(f));
        } catch (error) { return null; }

        if (!formatos.length) return null;

        const detector = new window.BarcodeDetector({ formats: formatos });
        const flujo = await navigator.mediaDevices.getUserMedia(restricciones());

        video.setAttribute("playsinline", "");
        video.muted = true;
        video.srcObject = flujo;

        try { await video.play(); } catch (error) { /* el navegador lo arranca solo con autoplay */ }

        // una lectura de prueba: si el lector nativo no sirve en este equipo, se libera la camara y se usa ZXing
        try { await detector.detect(video); } catch (error) { flujo.getTracks().forEach(t => t.stop()); video.srcObject = null; return null; }

        const pista = flujo.getVideoTracks()[0];
        pedirEnfoque(pista);
        const boton = agregarLinterna(video, pista);
        let detenido = false;
        let espera = null;

        const bucle = async () => {
            if (detenido) return;

            try {
                if (video.readyState >= 2) {
                    const hallados = await detector.detect(video);
                    if (hallados.length && hallados[0].rawValue) enviar(hallados[0].rawValue);
                }
            } catch (error) { /* un cuadro malo no detiene la lectura */ }

            if (!detenido) espera = setTimeout(bucle, PAUSA_NATIVA_MS);
        };

        bucle();

        return {
            stop() {
                detenido = true;
                clearTimeout(espera);
                flujo.getTracks().forEach(t => t.stop());
                if (video.srcObject === flujo) video.srcObject = null;
                if (boton) boton.remove();
            }
        };
    }

    async function iniciarZxing(video, enviar, conQr) {
        if (typeof duenoPedCargarZxing === "function") await duenoPedCargarZxing();

        const Z = window.ZXingBrowser;
        const formatos = FORMATOS_ZXING.map(f => Z.BarcodeFormat[f]).concat(conQr ? [Z.BarcodeFormat.QR_CODE] : []);
        // 2 = POSSIBLE_FORMATS, 3 = TRY_HARDER (mismos numeros que DecodeHintType de la libreria)
        const pistas = new Map([[2, formatos], [3, true]]);
        const opciones = { delayBetweenScanAttempts: 80, delayBetweenScanSuccess: 250 };
        const lector = conQr ? new Z.BrowserMultiFormatReader(pistas, opciones) : new Z.BrowserMultiFormatOneDReader(pistas, opciones);
        const controles = await lector.decodeFromConstraints(restricciones(), video, resultado => { if (resultado) enviar(resultado.getText()); });
        const pista = video.srcObject && video.srcObject.getVideoTracks ? video.srcObject.getVideoTracks()[0] : null;
        pedirEnfoque(pista);
        const boton = agregarLinterna(video, pista);

        return { stop() { try { controles.stop(); } catch (error) { /* ya estaba detenido */ } if (boton) boton.remove(); } };
    }

    // video: <video> donde se ve la camara. alCodigo(texto): se llama con cada codigo leido (sin repetir el mismo antes de 2.5 s).
    // opciones.qr: tambien lee codigos QR (solo para enlazar el celular). Devuelve { stop() }.
    window.iniciarLectorCodigosDueno = async function (video, alCodigo, opciones = {}) {
        const conQr = Boolean(opciones.qr);
        let ultimo = { codigo: "", t: 0 };

        const enviar = texto => {
            const codigo = String(texto || "").trim();
            if (!codigo) return;
            const ahora = Date.now();
            if (codigo === ultimo.codigo && ahora - ultimo.t < MISMO_CODIGO_MS) return;
            ultimo = { codigo, t: ahora };
            if (navigator.vibrate) navigator.vibrate(40);
            alCodigo(codigo);
        };

        let nativo = null;
        try { nativo = await iniciarNativo(video, enviar, conQr); } catch (error) {
            // sin permiso o sin camara no tiene caso intentar con la otra libreria: se avisa tal cual
            if (error && ["NotAllowedError", "NotFoundError", "SecurityError"].includes(error.name)) throw error;
            nativo = null;
        }
        if (nativo) return nativo;

        return iniciarZxing(video, enviar, conQr);
    };
})();
