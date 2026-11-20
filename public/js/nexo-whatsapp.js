/* Mandar por WhatsApp -- una sola funcion para TODO el programa (escritorio, celular del dueño y panel de administracion).

   nexoWA.enviar({ telefono, texto })
     * Si ya hay un telefono valido, abre WhatsApp con el mensaje escrito (sin preguntar nada).
     * Si no hay telefono, pide el numero del cliente en una ventanita (o deja elegir el contacto dentro de WhatsApp) y listo.
     * En computadora intenta abrir la APP de WhatsApp directo (sin abrir una pestaña del navegador). Si no esta instalada, usa WhatsApp Web
       como antes. En celular usa el enlace de siempre, que ya abre la app.
     * Regresa "abierto", "bloqueado" (el navegador no dejo abrir la ventana) o "cancelado" (se cerro la ventanita del numero).

   Ademas, cualquier enlace <a href="https://wa.me/..."> dentro de la app pasa por aqui solo (con data-wa-directo se deja como enlace normal).
   WhatsApp siempre pide el ultimo paso (presionar enviar): enviar solo, sin abrir nada, requiere la API oficial de WhatsApp Business. */

(function () {
    if (window.nexoWA) return;

    const LLAVE_MODO = "nexoWaModo"; // "app" (ya se comprobo que la app abre) | "web" (usar WhatsApp Web)
    const LLAVE_FALLOS = "nexoWaFallos";
    const ESPERA_APP_MS = 2200;

    const leer = llave => { try { return window.localStorage.getItem(llave); } catch (error) { return null; } };
    const guardar = (llave, valor) => { try { window.localStorage.setItem(llave, valor); } catch (error) { /* sin almacenamiento */ } };
    const esMovil = () => /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && /Macintosh/i.test(navigator.userAgent));

    // Telefono de Mexico a 10 digitos -> 52 + numero. Acepta lo que se guarda en el programa ("(442) 123-4567", "442 123 4567", "+52 442...", "521442...").
    function normalizar(valor) {
        let digitos = String(valor == null ? "" : valor).replace(/\D/g, "");

        if (digitos.startsWith("00")) digitos = digitos.slice(2);
        if (digitos.length === 10) return `52${digitos}`;
        if (digitos.length === 13 && digitos.startsWith("521")) return `52${digitos.slice(3)}`;
        if (digitos.length === 12 && digitos.startsWith("52")) return digitos;
        if (digitos.length >= 11 && digitos.length <= 15) return digitos; // numeros de otros paises

        return "";
    }

    const urlWeb = (numero, texto) => `https://wa.me/${numero}${texto ? `?text=${encodeURIComponent(texto)}` : ""}`;
    const urlApp = (numero, texto) => `whatsapp://send?${numero ? `phone=${numero}&` : ""}text=${encodeURIComponent(texto || "")}`;

    function abrirWeb(numero, texto) {
        const ventana = window.open(urlWeb(numero, texto), "_blank");

        if (!ventana) return "bloqueado";

        try { ventana.opener = null; } catch (error) { /* mismo origen o ya cerrada */ }
        return "abierto";
    }

    // Abre la app de WhatsApp de la computadora. Si la app abre, la ventana del navegador pierde el foco; si no pasa nada, se asume que no esta instalada.
    function intentarApp(numero, texto) {
        return new Promise(resolver => {
            let salio = false;
            const marca = () => { salio = true; };

            window.addEventListener("blur", marca);
            document.addEventListener("visibilitychange", marca);

            const enlace = document.createElement("a");
            enlace.href = urlApp(numero, texto);
            enlace.style.display = "none";
            document.body.appendChild(enlace);
            enlace.click();

            setTimeout(() => {
                enlace.remove();
                window.removeEventListener("blur", marca);
                document.removeEventListener("visibilitychange", marca);
                resolver(salio);
            }, ESPERA_APP_MS);
        });
    }

    async function abrir(numero, texto) {
        // App de escritorio de Nexo (Electron): ella sabe si la app de WhatsApp esta instalada y la abre directo (ver apps/desktop/main.js).
        const escritorio = window.nexoDesktop;

        if (escritorio && typeof escritorio.abrirWhatsApp === "function") {
            try {
                const respuesta = await escritorio.abrirWhatsApp({ numero, texto });
                if (respuesta && respuesta.ok) return "abierto";
            } catch (error) { /* se usa el camino de siempre */ }

            return abrirWeb(numero, texto);
        }

        // Version anterior de la app de escritorio (sin lo de arriba): igual que antes. Nunca se navega la ventana principal a whatsapp://.
        if (/Electron/i.test(navigator.userAgent)) {
            window.open(urlWeb(numero, texto), "_blank"); // la app lo manda al navegador del equipo; window.open regresa null a proposito
            return "abierto";
        }

        const modo = leer(LLAVE_MODO);

        if (esMovil() || modo === "web") return abrirWeb(numero, texto);

        if (modo === "app") { // ya se comprobo que abre: no se abre tambien la web por si el aviso de foco no llega
            const enlace = document.createElement("a");
            enlace.href = urlApp(numero, texto);
            enlace.style.display = "none";
            document.body.appendChild(enlace);
            enlace.click();
            enlace.remove();
            return "abierto";
        }

        if (await intentarApp(numero, texto)) {
            guardar(LLAVE_MODO, "app");
            guardar(LLAVE_FALLOS, "0");
            return "abierto";
        }

        const fallos = Number(leer(LLAVE_FALLOS) || 0) + 1;
        guardar(LLAVE_FALLOS, String(fallos));
        if (fallos >= 2) guardar(LLAVE_MODO, "web"); // dos intentos sin app: ya no se espera, se abre WhatsApp Web directo

        return abrirWeb(numero, texto);
    }

    // ----- ventanita para pedir el numero -----
    function estilos() {
        if (document.getElementById("nwaEstilos")) return;

        const hoja = document.createElement("style");
        hoja.id = "nwaEstilos";
        hoja.textContent = `
.nwa-capa{position:fixed;inset:0;z-index:2147483000;display:grid;place-items:center;padding:20px;background:rgba(8,15,30,.6);-webkit-backdrop-filter:blur(5px);backdrop-filter:blur(5px);font-family:inherit}
.nwa-caja{box-sizing:border-box;display:grid;gap:12px;width:min(420px,100%);padding:22px 20px 18px;border-radius:22px;background:#fff;color:#0f172a;box-shadow:0 30px 70px -26px rgba(0,0,0,.7);animation:nwaEntra .25s cubic-bezier(.22,1,.36,1) both}
.nwa-caja *{box-sizing:border-box}
.nwa-caja h3{margin:0;font-size:19px;font-weight:800}
.nwa-caja p{margin:0;color:#64748b;font-size:13.5px;line-height:1.45}
.nwa-input{width:100%;min-height:54px;padding:0 16px;border:2px solid #cbd5e1;border-radius:14px;background:#f8fafc;color:inherit;font:inherit;font-size:22px;font-weight:800;letter-spacing:.5px;font-variant-numeric:tabular-nums}
.nwa-input:focus{outline:0;border-color:#16a34a;box-shadow:0 0 0 4px rgba(22,163,74,.18)}
.nwa-botones{display:grid;grid-template-columns:1fr 1.5fr;gap:10px}
.nwa-botones button,.nwa-elegir{min-height:48px;border-radius:13px;font:inherit;font-size:15px;font-weight:800;cursor:pointer}
.nwa-cancelar{border:2px solid #cbd5e1;background:#f8fafc;color:inherit}
.nwa-ok{border:0;background:#16a34a;color:#fff}
.nwa-ok:disabled{opacity:.4;cursor:not-allowed}
.nwa-elegir{border:0;background:transparent;color:#16a34a;min-height:38px;font-size:13.5px;text-decoration:underline}
@keyframes nwaEntra{from{opacity:0;transform:translateY(18px) scale(.96)}to{opacity:1;transform:none}}
body.oscuro .nwa-caja,:root.oscuro .nwa-caja,.oscuro .nwa-caja{background:#18222f;color:#f1f5f9}
body.oscuro .nwa-caja p,:root.oscuro .nwa-caja p,.oscuro .nwa-caja p{color:#94a3b8}
body.oscuro .nwa-input,:root.oscuro .nwa-input,.oscuro .nwa-input{background:#1e293b;border-color:rgba(148,163,184,.3)}
body.oscuro .nwa-cancelar,:root.oscuro .nwa-cancelar,.oscuro .nwa-cancelar{background:#243148;border-color:rgba(148,163,184,.3)}
@media (prefers-reduced-motion:reduce){.nwa-caja{animation:none}}`;
        document.head.appendChild(hoja);
    }

    const formato = d => (d.length <= 3 ? d : d.length <= 6 ? `(${d.slice(0, 3)}) ${d.slice(3)}` : `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6, 10)}`);

    // Resuelve { numero } o { elegir: true } (que WhatsApp deje elegir el chat), o null si se cancela.
    function pedirNumero() {
        estilos();

        return new Promise(resolver => {
            const capa = document.createElement("div");
            capa.className = "nwa-capa";
            capa.innerHTML = `<div class="nwa-caja" role="dialog" aria-modal="true" aria-labelledby="nwaTit">
                <h3 id="nwaTit">¿A qué número le mandamos el mensaje?</h3>
                <p>Escribe el celular del cliente (10 dígitos) y se abre WhatsApp con el mensaje ya escrito.</p>
                <input class="nwa-input" type="tel" inputmode="numeric" autocomplete="off" maxlength="14" placeholder="(442) 123-4567" aria-label="Celular del cliente">
                <div class="nwa-botones"><button type="button" class="nwa-cancelar">Cancelar</button><button type="button" class="nwa-ok" disabled>Abrir WhatsApp</button></div>
                <button type="button" class="nwa-elegir">Mejor elijo el contacto en WhatsApp</button>
            </div>`;
            document.body.appendChild(capa);

            const campo = capa.querySelector(".nwa-input");
            const ok = capa.querySelector(".nwa-ok");
            const cerrar = valor => { capa.remove(); document.removeEventListener("keydown", teclas, true); resolver(valor); };
            const digitos = () => campo.value.replace(/\D/g, "").slice(0, 10);
            const confirmar = () => { if (digitos().length === 10) cerrar({ numero: normalizar(digitos()) }); };
            const teclas = evento => { if (evento.key === "Escape") { evento.stopPropagation(); cerrar(null); } };

            campo.addEventListener("input", () => { const d = digitos(); campo.value = formato(d); ok.disabled = d.length !== 10; });
            campo.addEventListener("keydown", evento => { if (evento.key === "Enter") { evento.preventDefault(); confirmar(); } });
            ok.addEventListener("click", confirmar);
            capa.querySelector(".nwa-cancelar").addEventListener("click", () => cerrar(null));
            capa.querySelector(".nwa-elegir").addEventListener("click", () => cerrar({ elegir: true }));
            capa.addEventListener("click", evento => { if (evento.target === capa) cerrar(null); });
            document.addEventListener("keydown", teclas, true);
            campo.focus();
        });
    }

    async function enviar({ telefono = "", texto = "", pedirNumeroSiFalta = true } = {}) {
        let numero = normalizar(telefono);

        if (!numero && pedirNumeroSiFalta) {
            const respuesta = await pedirNumero();

            if (!respuesta) return "cancelado";
            numero = respuesta.numero || "";
        }

        return abrir(numero, String(texto || ""));
    }

    // Los enlaces <a href="https://wa.me/..."> de la app tambien pasan por aqui.
    document.addEventListener("click", evento => {
        if (evento.defaultPrevented || evento.button !== 0 || evento.ctrlKey || evento.metaKey || evento.shiftKey) return;

        const enlace = evento.target && evento.target.closest ? evento.target.closest("a[href]") : null;

        if (!enlace || enlace.hasAttribute("data-wa-directo")) return;

        let direccion;
        try { direccion = new URL(enlace.href, window.location.href); } catch (error) { return; }

        let telefono = "";

        if (direccion.hostname === "wa.me") telefono = direccion.pathname.replace(/\D/g, "");
        else if (direccion.hostname === "api.whatsapp.com" && direccion.pathname.startsWith("/send")) telefono = direccion.searchParams.get("phone") || "";
        else return;

        evento.preventDefault();
        enviar({ telefono, texto: direccion.searchParams.get("text") || "" });
    }, true);

    window.nexoWA = {
        enviar,
        normalizar,
        // Para soporte: nexoWA.modo("web") fuerza WhatsApp Web, nexoWA.modo("app") la app, nexoWA.modo("auto") vuelve a detectar.
        modo(valor) {
            if (valor === "auto") { guardar(LLAVE_MODO, ""); guardar(LLAVE_FALLOS, "0"); return "auto"; }
            if (valor === "app" || valor === "web") { guardar(LLAVE_MODO, valor); return valor; }
            return leer(LLAVE_MODO) || "auto";
        }
    };
})();
