/* QR grande del ticket digital (computadora).
   Para quien no tiene impresora de tickets: al terminar la venta se muestra un codigo QR grande y el cliente lo escanea con su
   celular para ver su ticket (el mismo recibo digital de siempre: nexoposoficial.com/ticket/<codigo>).
   Sale solo si la caja no imprime (Configuracion -> imprimir ticket apagado); tambien se puede abrir a mano con mostrarQrTicketPOS(). */
(function () {
    const DOMINIO = "https://nexoposoficial.com/ticket/";
    const esc = valor => String(valor ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
    const dinero = valor => "$" + Number(valor || 0).toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

    // Devuelve una promesa que se cumple cuando se cierra el cuadro (para no empezar otra venta encima).
    window.mostrarQrTicketPOS = function ({ codigoPublico, folio, total, cambio, ventaOffline } = {}) {
        if (!codigoPublico) return Promise.resolve();

        document.getElementById("ticketQrFondo")?.remove();
        const enlace = DOMINIO + encodeURIComponent(codigoPublico);

        return new Promise(resolver => {
            const fondo = document.createElement("div");
            fondo.id = "ticketQrFondo";
            fondo.className = "tqr-fondo";
            fondo.setAttribute("role", "dialog");
            fondo.setAttribute("aria-modal", "true");
            fondo.setAttribute("aria-label", "Codigo QR del ticket");
            fondo.innerHTML = `<div class="tqr-caja">
                <h2>Escanea para ver tu ticket</h2>
                <p class="tqr-sub">Abre la camara de tu celular y apunta al código</p>
                <div class="tqr-qr">
                    <img src="${DOMINIO}${encodeURIComponent(codigoPublico)}/qr.png" alt="Codigo QR del ticket" id="tqrImagen">
                    <p class="tqr-sin-imagen" id="tqrSinImagen" hidden>No se pudo cargar el código. Revisa el internet o usa este enlace:</p>
                </div>
                <p class="tqr-enlace">${esc(enlace.replace("https://", ""))}</p>
                <div class="tqr-datos">
                    ${folio ? `<span>Folio <b>${esc(folio)}</b></span>` : ""}
                    ${total != null ? `<span>Total <b>${dinero(total)}</b></span>` : ""}
                    ${Number(cambio) > 0 ? `<span>Cambio <b>${dinero(cambio)}</b></span>` : ""}
                </div>
                ${ventaOffline ? `<p class="tqr-aviso">Esta venta se hizo sin internet: el ticket se podrá ver cuando se sincronice.</p>` : ""}
                <button type="button" class="tqr-listo" id="tqrListo">Listo</button>
            </div>`;

            const cerrar = () => {
                document.removeEventListener("keydown", teclado, true);
                fondo.remove();
                resolver();
            };

            const teclado = evento => {
                if (evento.key === "Escape" || evento.key === "Enter") { evento.preventDefault(); evento.stopPropagation(); cerrar(); }
            };

            fondo.addEventListener("click", evento => { if (evento.target === fondo) cerrar(); });
            document.body.appendChild(fondo);
            document.addEventListener("keydown", teclado, true);

            const imagen = fondo.querySelector("#tqrImagen");
            imagen.addEventListener("error", () => { imagen.hidden = true; fondo.querySelector("#tqrSinImagen").hidden = false; });

            const boton = fondo.querySelector("#tqrListo");
            boton.addEventListener("click", cerrar);
            setTimeout(() => boton.focus(), 30);
        });
    };

    // La caja no imprime (impresora apagada en Configuracion) y hay ticket digital: se ensena el QR.
    window.debeMostrarQrTicketPOS = function (negocio) {
        return Boolean(negocio) && negocio.imprimirAutomatico === false;
    };
})();
