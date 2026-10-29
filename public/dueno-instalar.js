/* Instalar Nexo como app, justo despues de escanear el QR de la computadora (App del dueño -> enlazar celular).
   - Android: boton "Instalar Nexo" (el aviso nativo del navegador) o, si el navegador no lo ofrece, los pasos del menu.
   - iPhone / iPad: Apple no deja instalar con un boton. Se explican los pasos (Compartir -> Añadir a pantalla de inicio) y, como la app anclada
     guarda su sesion APARTE de Safari, se cambia el QR por un codigo de 10 minutos que se escribe en la app ya instalada.
   - Todos pueden "Continuar en el navegador" sin instalar nada.
   dueno.js llama a mostrarInstalarAppDueno(token) solo si necesitaInstalarDueno() es verdadero (celular o tableta sin la app instalada). */
(function () {
    let avisoInstalacion = null;

    // Chrome/Edge en Android lanzan este evento cuando la app se puede instalar; hay que guardarlo para usarlo con el boton.
    window.addEventListener("beforeinstallprompt", evento => { evento.preventDefault(); avisoInstalacion = evento; });

    const agente = navigator.userAgent || "";
    const esIOS = /iPad|iPhone|iPod/.test(agente) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
    const esAndroid = /Android/i.test(agente);
    const instalada = () => (window.matchMedia && window.matchMedia("(display-mode: standalone)").matches) || navigator.standalone === true;
    const esc = valor => String(valor ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

    window.necesitaInstalarDueno = () => !instalada() && (esIOS || esAndroid);

    const ICONO_COMPARTIR = `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3v12"/><path d="M8 7l4-4 4 4"/><path d="M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7"/></svg>`;
    const ICONO_MAS = `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><rect x="4" y="4" width="16" height="16" rx="4"/><path d="M12 8v8M8 12h8"/></svg>`;
    const ICONO_MENU = `<svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor" aria-hidden="true"><circle cx="12" cy="5" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="12" cy="19" r="2"/></svg>`;

    function paso(n, icono, titulo, texto) {
        return `<li><span class="dui-num">${n}</span><span class="dui-icono">${icono}</span><div><b>${titulo}</b>${texto ? `<small>${texto}</small>` : ""}</div></li>`;
    }

    window.mostrarInstalarAppDueno = function (token) {
        return new Promise(resolver => {
            const capa = document.createElement("div");
            capa.className = "dui-capa";
            document.body.appendChild(capa);

            const cerrar = valor => { capa.classList.add("saliendo"); setTimeout(() => capa.remove(), 220); resolver(valor); };

            const cabeza = `<img src="img/nexo-ia/feliz.jpg" alt="" class="dui-nexo"><h2>Instala Nexo en tu celular</h2><p class="dui-sub">Ábrelo como una app, directo desde tu pantalla de inicio, sin buscar el enlace.</p>`;

            function pantallaPrincipal() {
                if (esIOS) {
                    capa.innerHTML = `<div class="dui-hoja">${cabeza}
                        <ol class="dui-pasos">${paso(1, ICONO_COMPARTIR, "Toca Compartir", "El botón de abajo (o arriba en iPad).")}${paso(2, ICONO_MAS, "Añadir a pantalla de inicio", "Desliza el menú hacia arriba si no la ves.")}${paso(3, "✓", "Toca “Añadir”", "Nexo aparece con su ícono junto a tus apps.")}</ol>
                        <button type="button" class="dui-principal" data-a="codigo">Ya la anclé: dame mi código</button>
                        <button type="button" class="dui-suave" data-a="seguir">Mejor continuar aquí, sin instalar</button>
                        <p class="dui-nota">La app anclada guarda su sesión aparte de Safari, por eso te daremos un código para entrar en ella.</p></div>`;
                    return;
                }

                if (avisoInstalacion) {
                    capa.innerHTML = `<div class="dui-hoja">${cabeza}
                        <ul class="dui-bonos"><li>⚡ Abre más rápido</li><li>📲 Con su propio ícono</li><li>🔔 Avisos de tus ventas</li></ul>
                        <button type="button" class="dui-principal" data-a="instalar">Instalar Nexo</button>
                        <button type="button" class="dui-suave" data-a="seguir">Continuar en el navegador</button></div>`;
                    return;
                }

                capa.innerHTML = `<div class="dui-hoja">${cabeza}
                    <ol class="dui-pasos">${paso(1, ICONO_MENU, "Abre el menú del navegador", "Los tres puntos, arriba a la derecha.")}${paso(2, ICONO_MAS, "“Instalar app” o “Agregar a pantalla de inicio”", "")}${paso(3, "✓", "Confirma y abre Nexo desde tu pantalla", "")}</ol>
                    <button type="button" class="dui-principal" data-a="seguir">Continuar en el navegador</button></div>`;
            }

            function pantallaCodigo(r) {
                const letras = r.codigoCorto.split("").map(c => c === "-" ? `<i></i>` : `<span>${esc(c)}</span>`).join("");
                capa.innerHTML = `<div class="dui-hoja"><img src="img/nexo-ia/feliz.jpg" alt="" class="dui-nexo"><h2>Tu código</h2><p class="dui-sub">Vale <b>10 minutos</b> y sirve una sola vez.</p>
                    <div class="dui-codigo">${letras}</div>
                    <ol class="dui-pasos">${paso(1, "📱", "Abre Nexo desde tu pantalla de inicio", "")}${paso(2, "🔑", "Toca “Tengo un código de la computadora”", "")}${paso(3, "⌨️", "Escribe el código de arriba", "")}</ol>
                    <button type="button" class="dui-suave" data-a="cerrar">Cerrar</button></div>`;
            }

            capa.addEventListener("click", async evento => {
                const boton = evento.target.closest("[data-a]");
                if (!boton) return;
                const accion = boton.dataset.a;

                if (accion === "seguir") { cerrar(true); return; }
                if (accion === "cerrar") { cerrar(false); return; }

                if (accion === "instalar") {
                    try { avisoInstalacion.prompt(); await avisoInstalacion.userChoice; } catch (error) { /* si lo cancela, igual entra en el navegador */ }
                    avisoInstalacion = null;
                    cerrar(true);
                    return;
                }

                if (accion === "codigo") {
                    boton.disabled = true;
                    boton.textContent = "Un momento…";

                    try {
                        const respuesta = await fetch("/enlace-celular/reservar", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token }) });
                        const datos = await respuesta.json().catch(() => ({}));
                        if (!respuesta.ok || !datos.ok) throw new Error(datos.error || "No se pudo crear el código.");
                        pantallaCodigo(datos);
                    } catch (error) {
                        boton.disabled = false;
                        boton.textContent = "Ya la anclé: dame mi código";
                        let nota = capa.querySelector(".dui-error");
                        if (!nota) { nota = document.createElement("p"); nota.className = "dui-error"; capa.querySelector(".dui-hoja").appendChild(nota); }
                        nota.textContent = error.message || "No se pudo crear el código. Pide uno nuevo en la computadora.";
                    }
                }
            });

            pantallaPrincipal();
        });
    };
})();
