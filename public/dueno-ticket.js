/* Venta cobrada en el celular (rediseno) + IMPRIMIR el ticket, universal:
   - Con Bluetooth disponible (Chrome en Android o computadora) se conecta a una impresora termica de tickets (ESC/POS, 58 mm) y manda el ticket.
   - En todo lo demas (iPhone/Safari) abre el menu de imprimir del telefono (AirPrint, o la app de la impresora), con el ticket en formato angosto.
   El ticket se arma con lo que quedo en la venta (no depende de internet). WhatsApp, copiar enlace y ver ticket siguen igual. */

(function () {
    const ANCHO = 32; // caracteres en papel de 58 mm
    const SERVICIOS_IMPRESORA = [
        "000018f0-0000-1000-8000-00805f9b34fb", "0000ff00-0000-1000-8000-00805f9b34fb", "0000fff0-0000-1000-8000-00805f9b34fb",
        "0000ffe0-0000-1000-8000-00805f9b34fb", "0000fee7-0000-1000-8000-00805f9b34fb",
        "e7810a71-73ae-499d-8c15-faa9aef0c3f2", "49535343-fe7d-4ae5-8fa9-9fafd205e455"
    ];

    let ultimaVenta = null;   // snapshot de la venta recien cobrada
    let impresora = null;     // { dispositivo, caracteristica } de esta sesion

    const esc = valor => (typeof escaparDueno === "function" ? escaparDueno(valor) : String(valor ?? ""));
    const plata = valor => "$" + Number(valor || 0).toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const sinAcentos = texto => String(texto ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^\x20-\x7e]/g, "?");
    const NOMBRES_PAGO = { efectivo: "Efectivo", tarjeta: "Tarjeta", transferencia: "Transferencia", mixto: "Mixto", credito: "Credito" };

    const cantidadTexto = n => String(Math.round(Number(n) * 1000) / 1000);

    function derecha(izquierda, derechaTexto) {
        const der = sinAcentos(derechaTexto);
        const izq = sinAcentos(izquierda).slice(0, Math.max(1, ANCHO - der.length - 1));
        return izq + " ".repeat(Math.max(1, ANCHO - izq.length - der.length)) + der;
    }

    function centrado(texto) {
        const t = sinAcentos(texto).slice(0, ANCHO);
        return " ".repeat(Math.floor((ANCHO - t.length) / 2)) + t;
    }

    function envolver(texto, ancho) {
        const salida = [];
        let linea = "";

        sinAcentos(texto).split(/\s+/).forEach(palabra => {
            if (!linea) linea = palabra;
            else if ((linea + " " + palabra).length <= ancho) linea += " " + palabra;
            else { salida.push(linea); linea = palabra; }
        });

        if (linea) salida.push(linea);
        return salida.flatMap(l => (l.length > ancho ? l.match(new RegExp(`.{1,${ancho}}`, "g")) : [l]));
    }

    // Lineas del ticket (puro: se prueba sin pantalla).
    function lineasTicket(v) {
        const l = [];

        l.push(centrado(v.negocio || "Ticket"));
        l.push(centrado(`Folio ${v.folio}`));
        l.push(centrado(v.fecha));
        l.push("-".repeat(ANCHO));

        v.items.forEach(item => {
            envolver(`${cantidadTexto(item.cantidad)} x ${item.nombre}`, ANCHO).forEach(x => l.push(x));
            l.push(derecha(`  ${plata(item.precio)} c/u`, plata(item.precio * item.cantidad)));
        });

        l.push("-".repeat(ANCHO));
        if (v.descuento > 0) l.push(derecha("Descuento", "-" + plata(v.descuento)));
        l.push(derecha("TOTAL", plata(v.total)));
        l.push(derecha("Pago", NOMBRES_PAGO[v.metodo] || v.metodo || ""));
        if (v.recibido > 0 && v.metodo === "efectivo") { l.push(derecha("Recibido", plata(v.recibido))); l.push(derecha("Cambio", plata(Math.max(0, v.recibido - v.total)))); }
        if (v.cliente) l.push(sinAcentos("Cliente: " + v.cliente).slice(0, ANCHO));
        l.push("");
        l.push(centrado("Gracias por su compra"));
        if (v.enlace) envolver(v.enlace, ANCHO).forEach(x => l.push(x));

        return l;
    }

    // ESC/POS: inicializar, texto, avanzar papel y corte parcial (si la impresora no corta, lo ignora).
    function bytesTicket(v) {
        const cuerpo = new TextEncoder().encode(lineasTicket(v).join("\n") + "\n\n\n\n");
        return new Uint8Array([0x1b, 0x40, ...cuerpo, 0x1d, 0x56, 0x42, 0x00]);
    }

    async function conectarBluetooth() {
        if (impresora?.dispositivo?.gatt?.connected && impresora.caracteristica) return impresora.caracteristica;

        const dispositivo = impresora?.dispositivo || await navigator.bluetooth.requestDevice({ acceptAllDevices: true, optionalServices: SERVICIOS_IMPRESORA });
        const servidor = await dispositivo.gatt.connect();
        let caracteristica = null;

        for (const servicio of await servidor.getPrimaryServices()) {
            for (const c of await servicio.getCharacteristics()) {
                if (c.properties.write || c.properties.writeWithoutResponse) { caracteristica = c; break; }
            }
            if (caracteristica) break;
        }

        if (!caracteristica) throw new Error("Esa impresora no acepta tickets por Bluetooth.");

        impresora = { dispositivo, caracteristica };
        return caracteristica;
    }

    async function imprimirPorBluetooth(v) {
        const c = await conectarBluetooth();
        const datos = bytesTicket(v);

        for (let i = 0; i < datos.length; i += 100) {
            const trozo = datos.slice(i, i + 100);
            if (c.properties.writeWithoutResponse) await c.writeValueWithoutResponse(trozo); else await c.writeValue(trozo);
            await new Promise(r => setTimeout(r, 25));
        }
    }

    // Menu de imprimir del telefono: AirPrint en iPhone, o la app de la impresora / PDF en Android.
    function imprimirPorSistema(v) {
        const marco = document.createElement("iframe");
        marco.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0;";
        document.body.appendChild(marco);

        const html = `<!doctype html><html><head><meta charset="utf-8"><title>Ticket ${esc(v.folio)}</title><style>@page{size:58mm auto;margin:3mm}body{margin:0}pre{margin:0;font:12px/1.25 "Courier New",monospace;width:58mm;white-space:pre-wrap}</style></head><body><pre>${esc(lineasTicket(v).join("\n"))}</pre></body></html>`;

        marco.contentDocument.open();
        marco.contentDocument.write(html);
        marco.contentDocument.close();

        setTimeout(() => {
            try { marco.contentWindow.focus(); marco.contentWindow.print(); } catch (error) { if (typeof mostrarToastDueno === "function") mostrarToastDueno("No se pudo abrir el menu de imprimir."); }
            setTimeout(() => marco.remove(), 60000);
        }, 150);
    }

    window.imprimirTicketVentaDueno = async function () {
        if (!ultimaVenta) return;

        if (navigator.bluetooth) {
            try {
                await imprimirPorBluetooth(ultimaVenta);
                if (typeof mostrarToastDueno === "function") mostrarToastDueno("Ticket enviado a la impresora.");
                return;
            } catch (error) {
                // Cerrar la lista de impresoras no es un error: la persona cambio de idea.
                if (error && (error.name === "NotFoundError" || error.name === "AbortError")) return;
                impresora = null;
                if (typeof mostrarToastDueno === "function") mostrarToastDueno("No se pudo usar la impresora Bluetooth. Abriendo imprimir normal.");
            }
        }

        imprimirPorSistema(ultimaVenta);
    };

    window.olvidarImpresoraDueno = function () { impresora = null; if (typeof mostrarToastDueno === "function") mostrarToastDueno("Elige la impresora de nuevo al imprimir."); };
    window.lineasTicketVentaDueno = lineasTicket;
    window.bytesTicketVentaDueno = bytesTicket;

    const ICONOS = {
        imprimir: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9V3h12v6"/><rect x="6" y="14" width="12" height="7" rx="1"/><path d="M6 17H4a2 2 0 0 1-2-2v-4a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2h-2"/></svg>`,
        whatsapp: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 11.5a8.4 8.4 0 0 1-12.4 7.4L3 20.5l1.7-5.4A8.5 8.5 0 1 1 21 11.5z"/></svg>`,
        copiar: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/></svg>`,
        ver: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12z"/><circle cx="12" cy="12" r="3"/></svg>`
    };

    function pantallaCobrada(v, codigoPublico, telefono) {
        const cambio = v.metodo === "efectivo" && v.recibido > v.total ? v.recibido - v.total : 0;
        const enlace = codigoPublico ? (typeof URL_BASE_TICKET_PUBLICO_DUENO !== "undefined" ? URL_BASE_TICKET_PUBLICO_DUENO : "https://nexoposoficial.com/ticket/") + codigoPublico : "";
        const whats = codigoPublico && typeof enlaceWhatsAppTicketDueno === "function" ? enlaceWhatsAppTicketDueno({ folio: v.folio, codigoPublico, telefono }) : "";
        const modo = navigator.bluetooth ? "Impresora Bluetooth" : "Menú de imprimir";

        return `<div class="dtk-pantalla">
            <div class="dtk-check" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg></div>
            <h2 class="dtk-titulo">Venta cobrada</h2>
            <p class="dtk-folio">Folio ${esc(v.folio)}</p>
            <div class="dtk-total"><span>Total</span><strong>${plata(v.total)}</strong></div>
            ${cambio > 0 ? `<div class="dtk-cambio"><span>Cambio</span><strong>${plata(cambio)}</strong></div>` : ""}
            <div class="dtk-acciones">
                <button type="button" class="dtk-boton dtk-imprimir" onclick="imprimirTicketVentaDueno()">${ICONOS.imprimir}<b>Imprimir ticket</b><small>${modo}</small></button>
                ${whats ? `<a class="dtk-boton dtk-whats" href="${esc(whats)}" target="_blank" rel="noopener">${ICONOS.whatsapp}<b>WhatsApp</b><small>Enviar ticket</small></a>` : ""}
                ${enlace ? `<button type="button" class="dtk-boton" onclick="copiarEnlaceTicketDueno('${esc(codigoPublico)}')">${ICONOS.copiar}<b>Copiar enlace</b><small>Del ticket digital</small></button>
                <a class="dtk-boton" href="${esc(enlace)}" target="_blank" rel="noopener">${ICONOS.ver}<b>Ver ticket</b><small>Se abre aparte</small></a>` : ""}
            </div>
            <button type="button" class="dueno-boton-primario dtk-nueva" onclick="finalizarVentaVenderDueno()">Nueva venta</button>
        </div>`;
    }

    const original = window.mostrarVentaCobradaVenderDueno;

    if (typeof original === "function") {
        window.mostrarVentaCobradaVenderDueno = function (folio, total, codigoPublico) {
            try {
                const items = (typeof duenoVentaCarrito !== "undefined" ? duenoVentaCarrito : []).map(i => ({ nombre: i.nombre, cantidad: Number(i.cantidad) || 0, precio: Number(i.precio) || 0 }));
                const resumen = typeof resumenCarritoVenderDueno === "function" ? resumenCarritoVenderDueno() : { total, descuento: 0 };
                const recibido = Number(document.getElementById("duenoVenderRecibido")?.value || 0);

                ultimaVenta = {
                    negocio: document.getElementById("duenoNegocio")?.textContent?.trim() || "",
                    folio, total: Number(total) || resumen.total || 0, descuento: resumen.descuento || 0, items,
                    metodo: typeof duenoVentaMetodoPago !== "undefined" ? duenoVentaMetodoPago : "",
                    recibido, cliente: typeof duenoVentaClienteSeleccionado !== "undefined" && duenoVentaClienteSeleccionado ? duenoVentaClienteSeleccionado.nombre : "",
                    fecha: new Date().toLocaleString("es-MX", { dateStyle: "short", timeStyle: "short" }),
                    enlace: codigoPublico ? (typeof URL_BASE_TICKET_PUBLICO_DUENO !== "undefined" ? URL_BASE_TICKET_PUBLICO_DUENO : "https://nexoposoficial.com/ticket/") + codigoPublico : ""
                };
            } catch (error) { ultimaVenta = null; }

            const resultado = original.apply(this, arguments);

            const contenido = document.getElementById("duenoVenderCobroContenido");
            if (contenido && ultimaVenta) contenido.innerHTML = pantallaCobrada(ultimaVenta, codigoPublico, typeof duenoVentaClienteSeleccionado !== "undefined" ? duenoVentaClienteSeleccionado?.telefono : "");

            return resultado;
        };
    }
})();
