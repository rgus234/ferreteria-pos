// Recibo digital publico por venta -- ticket digital (ver plan
// stateless-doodling-tarjan.md): cada venta imprime un QR + link que
// abre este recibo de solo lectura, sin sesion, para "a todos" los
// compradores (no solo clientes de credito ya registrados). Mismo
// patron que /market/pedido/:codigo (market-pedidos-server.js): codigo
// corto en la URL, sin autenticacion, limitado por IP contra adivinar
// codigos. codigo_publico se genera en el cliente
// (public/js/offline-sync.js, crearCodigoPublicoTicketPOS) para que
// tambien funcione en una venta hecha offline.

const QRCode = require("qrcode");

const DOMINIO_PUBLICO_TICKET = "https://nexoposoficial.com";

// Mismo helper chico duplicado que ya usan personas-server.js,
// public-site-server.js y market-pedidos-server.js. Solo cuenta como
// intento fallido cuando el codigo NO existe -- revisar tu propio
// recibo varias veces nunca bloquea a nadie.
function crearLimitadorPorIp(maxIntentos, ventanaMs) {
    const registro = new Map();

    return {
        bloqueado(ip) {
            const entrada = registro.get(ip);
            return Boolean(entrada?.bloqueadoHasta && entrada.bloqueadoHasta > Date.now());
        },
        registrarFallo(ip) {
            const entrada = registro.get(ip) || { fallos: 0, bloqueadoHasta: 0 };
            entrada.fallos += 1;

            if (entrada.fallos >= maxIntentos) {
                entrada.bloqueadoHasta = Date.now() + ventanaMs;
            }

            registro.set(ip, entrada);
        }
    };
}

const limitadorTicketPorCodigo = crearLimitadorPorIp(30, 15 * 60 * 1000);

function escaparHtml(valor) {
    return String(valor || "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

function colorSeguro(color) {
    return /^#[0-9a-fA-F]{6}$/.test(color || "") ? color : "#1067e8";
}

function dinero(valor) {
    const numero = Number(valor) || 0;
    return "$" + numero.toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function normalizarCodigoTicket(valor) {
    return String(valor || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

async function ventaPorCodigoPublico(pool, codigo) {
    if (!codigo) return null;

    const resultado = await pool.query(
        `
        SELECT h.*, n.nombre AS negocio_nombre, n.logo AS negocio_logo, n.color AS negocio_color,
               n.direccion AS negocio_direccion, n.telefono AS negocio_telefono, n.slug AS negocio_slug
        FROM public.historial_ventas h
        JOIN public.negocios n ON n.id = h.negocio_id
        WHERE h.codigo_publico = $1
        `,
        [codigo]
    );

    return resultado.rows[0] || null;
}

async function generarQrTicketBuffer(codigo) {
    return QRCode.toBuffer(`${DOMINIO_PUBLICO_TICKET}/ticket/${encodeURIComponent(codigo)}`, { width: 320, margin: 1 });
}

function productosVenta(venta) {
    try {
        const lista = typeof venta.productos === "string" ? JSON.parse(venta.productos) : venta.productos;
        return Array.isArray(lista) ? lista : [];
    } catch (error) {
        return [];
    }
}

function filaProductoHtml(producto) {
    const nombre = escaparHtml(producto?.nombre || "Producto");
    const cantidad = Number(producto?.cantidad || 0);
    const unidad = escaparHtml(producto?.unidadVenta || "pza");
    const precio = Number(producto?.precio || 0);
    const importe = Number(producto?.importe ?? (precio * cantidad));

    return `
     <tr>
      <td>${nombre}</td>
      <td style="text-align:center;white-space:nowrap;">${cantidad} ${unidad}</td>
      <td style="text-align:right;white-space:nowrap;">${dinero(precio)}</td>
      <td style="text-align:right;white-space:nowrap;">${dinero(importe)}</td>
     </tr>`;
}

const NOMBRES_METODO_PAGO = {
    efectivo: "Efectivo",
    tarjeta: "Tarjeta",
    transferencia: "Transferencia",
    credito: "Venta a credito",
    mixto: "Pago mixto"
};

function seccionPagoHtml(venta) {
    const metodo = venta.metodo_pago || "efectivo";

    if (metodo === "credito") {
        return `<div class="ticket-publico-badge">Venta a credito</div>`;
    }

    const recibido = Number(venta.pago_recibido || 0);
    const cambio = Number(venta.cambio || 0);
    const filas = [`<div class="ticket-publico-fila"><span>Metodo de pago</span><span>${escaparHtml(NOMBRES_METODO_PAGO[metodo] || metodo)}</span></div>`];

    if (metodo === "efectivo" && recibido > 0) {
        filas.push(`<div class="ticket-publico-fila"><span>Recibido</span><span>${dinero(recibido)}</span></div>`);
        filas.push(`<div class="ticket-publico-fila"><span>Cambio</span><span>${dinero(cambio)}</span></div>`);
    }

    return filas.join("\n");
}

const ESTILOS_TICKET_PUBLICO = `
:root { color-scheme: light dark; }
* { box-sizing: border-box; }
body {
    margin: 0;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif;
    background: #f2f4f7;
    color: #1a2233;
    padding: 24px 12px;
}
@media (prefers-color-scheme: dark) {
    body { background: #14171f; color: #e8ebf1; }
}
.ticket-publico-envoltura { display: flex; justify-content: center; }
.ticket-publico-tarjeta {
    width: 100%;
    max-width: 420px;
    background: #fff;
    border-radius: 16px;
    box-shadow: 0 8px 24px rgba(15, 23, 42, .08);
    padding: 24px 20px;
}
@media (prefers-color-scheme: dark) {
    .ticket-publico-tarjeta { background: #1d212c; box-shadow: 0 8px 24px rgba(0,0,0,.4); }
}
.ticket-publico-encabezado { text-align: center; margin-bottom: 16px; }
.ticket-publico-logo { max-width: 72px; max-height: 72px; border-radius: 10px; margin-bottom: 8px; }
.ticket-publico-nombre-negocio { font-size: 18px; font-weight: 700; color: var(--acento); }
.ticket-publico-dato-negocio { font-size: 13px; opacity: .7; }
.ticket-publico-meta { margin: 14px 0; }
.ticket-publico-fila { display: flex; justify-content: space-between; gap: 12px; font-size: 14px; padding: 3px 0; }
.ticket-publico-fila span:first-child { opacity: .65; }
.ticket-publico-tabla { width: 100%; border-collapse: collapse; margin: 14px 0; font-size: 13px; }
.ticket-publico-tabla th { text-align: left; font-size: 11px; text-transform: uppercase; opacity: .55; padding: 4px 2px; border-bottom: 1px solid rgba(120,120,120,.25); }
.ticket-publico-tabla td { padding: 6px 2px; border-bottom: 1px solid rgba(120,120,120,.12); }
.ticket-publico-totales { margin: 14px 0; border-top: 1px dashed rgba(120,120,120,.35); padding-top: 10px; }
.ticket-publico-total { font-size: 17px; font-weight: 700; margin-top: 4px; }
.ticket-publico-total span:last-child { color: var(--acento); }
.ticket-publico-badge {
    display: inline-block;
    background: var(--acento);
    color: #fff;
    font-size: 12px;
    font-weight: 600;
    padding: 4px 10px;
    border-radius: 999px;
}
.ticket-publico-boton-imprimir {
    width: 100%;
    margin-top: 18px;
    padding: 11px;
    border: none;
    border-radius: 10px;
    background: var(--acento);
    color: #fff;
    font-size: 14px;
    font-weight: 600;
    cursor: pointer;
}
.ticket-publico-pie { text-align: center; font-size: 11px; opacity: .5; margin-top: 16px; }
.ticket-publico-no-encontrado { text-align: center; padding: 24px 0; opacity: .8; }
@media print {
    body { background: #fff; padding: 0; }
    .ticket-publico-tarjeta { box-shadow: none; }
    .ticket-publico-boton-imprimir { display: none; }
}
`;

function paginaTicketPublicoHtml(venta) {
    if (!venta) {
        return `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Recibo no encontrado -- Nexo</title>
<style>${ESTILOS_TICKET_PUBLICO}</style></head>
<body><div class="ticket-publico-envoltura"><div class="ticket-publico-tarjeta" style="--acento:#1067e8;">
<p class="ticket-publico-no-encontrado">No encontramos ningun recibo con ese codigo.</p>
</div></div></body></html>`;
    }

    const color = colorSeguro(venta.negocio_color);
    const productos = productosVenta(venta);
    const fecha = venta.fecha ? new Date(venta.fecha).toLocaleString("es-MX") : "";
    const cliente = venta.cliente_nombre || "Publico general";
    const subtotal = Number(venta.subtotal || venta.total || 0);
    const descuento = Number(venta.descuento || 0);
    const total = Number(venta.total || 0);

    return `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Recibo ${escaparHtml(venta.folio || "")} -- ${escaparHtml(venta.negocio_nombre || "Nexo")}</title>
<style>${ESTILOS_TICKET_PUBLICO}</style></head>
<body>
<div class="ticket-publico-envoltura">
 <div class="ticket-publico-tarjeta" style="--acento:${color};">
  <div class="ticket-publico-encabezado">
   ${venta.negocio_logo ? `<img src="${escaparHtml(venta.negocio_logo)}" alt="" class="ticket-publico-logo">` : ""}
   <div class="ticket-publico-nombre-negocio">${escaparHtml(venta.negocio_nombre || "Nexo")}</div>
   ${venta.negocio_direccion ? `<div class="ticket-publico-dato-negocio">${escaparHtml(venta.negocio_direccion)}</div>` : ""}
   ${venta.negocio_telefono ? `<div class="ticket-publico-dato-negocio">${escaparHtml(venta.negocio_telefono)}</div>` : ""}
  </div>

  <div class="ticket-publico-meta">
   <div class="ticket-publico-fila"><span>Folio</span><span>${escaparHtml(venta.folio || "")}</span></div>
   <div class="ticket-publico-fila"><span>Fecha</span><span>${escaparHtml(fecha)}</span></div>
   <div class="ticket-publico-fila"><span>Cliente</span><span>${escaparHtml(cliente)}</span></div>
  </div>

  <table class="ticket-publico-tabla">
   <thead><tr><th>Producto</th><th>Cant.</th><th>Precio</th><th>Importe</th></tr></thead>
   <tbody>${productos.map(filaProductoHtml).join("")}</tbody>
  </table>

  <div class="ticket-publico-totales">
   <div class="ticket-publico-fila"><span>Subtotal</span><span>${dinero(subtotal)}</span></div>
   ${descuento > 0 ? `<div class="ticket-publico-fila"><span>Descuento</span><span>-${dinero(descuento)}</span></div>` : ""}
   <div class="ticket-publico-fila ticket-publico-total"><span>Total</span><span>${dinero(total)}</span></div>
  </div>

  <div class="ticket-publico-meta">
   ${seccionPagoHtml(venta)}
  </div>

  <button type="button" class="ticket-publico-boton-imprimir" onclick="window.print()">Imprimir</button>

  <div class="ticket-publico-pie">Recibo digital -- con la tecnologia de Nexo</div>
 </div>
</div>
</body></html>`;
}

async function servirTicketPublico(pool, req, res) {
    if (limitadorTicketPorCodigo.bloqueado(req.ip)) {
        res.status(429).set("Content-Type", "text/html; charset=utf-8").send(paginaTicketPublicoHtml(null));
        return;
    }

    const codigo = normalizarCodigoTicket(req.params.codigo);
    const venta = await ventaPorCodigoPublico(pool, codigo);

    if (!venta) {
        limitadorTicketPorCodigo.registrarFallo(req.ip);
        res.status(404).set("Content-Type", "text/html; charset=utf-8").send(paginaTicketPublicoHtml(null));
        return;
    }

    res.set("Content-Type", "text/html; charset=utf-8").send(paginaTicketPublicoHtml(venta));
}

async function servirQrTicketPublico(pool, req, res) {
    if (limitadorTicketPorCodigo.bloqueado(req.ip)) {
        res.status(429).send("Demasiados intentos");
        return;
    }

    const codigo = normalizarCodigoTicket(req.params.codigo);
    const venta = await ventaPorCodigoPublico(pool, codigo);

    if (!venta) {
        limitadorTicketPorCodigo.registrarFallo(req.ip);
        res.status(404).send("No encontrado");
        return;
    }

    const buffer = await generarQrTicketBuffer(venta.codigo_publico);
    res.set("Content-Type", "image/png").send(buffer);
}

module.exports = { servirTicketPublico, servirQrTicketPublico };
