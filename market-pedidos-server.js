// Maquina de estados de pedidos de Nexo Market (solo recoleccion en
// tienda por ahora, ver plan de rediseno de pedidos). Un pedido tiene
// UN estado en la base de datos (pedidos_market.estado) -- nunca un
// estado "del cliente" separado de un estado "del POS", la pagina de
// seguimiento y la pantalla del POS leen la misma columna.
//
// 7 valores admite el CHECK (pendiente/recibido/confirmado/preparando/
// listo/entregado/cancelado) pero el POS solo expone 5 acciones
// (aceptar/rechazar/marcar_listo/entregar/cancelar) -- "aceptar" mueve
// directo de pendiente a preparando (sella confirmado_at Y
// preparando_at a la vez: para una ferreteria aceptar un pedido implica
// empezar a prepararlo, no hay un paso intermedio real). "recibido"
// queda sin usar en v1 (mismo criterio que fulfillment='delivery': el
// CHECK ya lo admite para no tener que tocarlo despues).
//
// Cada transicion dispara su correo directo (sin bus de eventos, mismo
// patron que el PATCH de cotizaciones en public-site-server.js) -- los
// 5 correos ya existen en email.js.

const {
    enviarCorreoPedidoConfirmado,
    enviarCorreoPedidoListo,
    enviarCorreoPedidoEntregado,
    enviarCorreoPedidoCancelado,
    enviarCorreoPedidoCanceladoPorCliente
} = require("./email");
const { generarQrYBarcode } = require("./pedido-codigos");
const { ESTILOS_MARKET, marketHeaderHtml, marketFooterHtml, scriptMarketHeaderHtml, metaInstalableMarketHtml } = require("./market-server");
const { enviarPushAPersona } = require("./push-server");

// Mensaje corto por accion -- mismo texto que ya usan los correos de
// cada transicion, condensado para una notificacion push.
const TITULOS_PUSH_POR_ACCION = {
    aceptar: "Tu pedido fue confirmado",
    marcar_listo: "Tu pedido esta listo para recoger",
    entregar: "Tu pedido fue entregado",
    rechazar: "Tu pedido fue cancelado",
    cancelar: "Tu pedido fue cancelado"
};

const DOMINIO_PUBLICO = "https://nexoposoficial.com";

function escaparHtml(valor) {
    return String(valor == null ? "" : valor)
        .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

const TRANSICIONES = {
    aceptar: { desde: ["pendiente"], hasta: "preparando", fechas: ["confirmado_at", "preparando_at"] },
    rechazar: { desde: ["pendiente"], hasta: "cancelado", fechas: ["cancelado_at"] },
    marcar_listo: { desde: ["preparando"], hasta: "listo", fechas: ["listo_at"] },
    entregar: { desde: ["listo"], hasta: "entregado", fechas: ["entregado_at"] },
    cancelar: { desde: ["pendiente", "preparando", "listo"], hasta: "cancelado", fechas: ["cancelado_at"] }
};

async function negocioActualPedidosMarket(req, pool) {
    const negocioId = req.negocioDispositivo?.negocio_id ?? req.negocioAutenticado?.negocio_id;

    if (!negocioId) {
        const error = new Error("Este equipo no esta vinculado a ningun negocio");
        error.httpStatus = 401;
        throw error;
    }

    const resultado = await pool.query(
        `SELECT id, slug, nombre, direccion FROM public.negocios WHERE id = $1 LIMIT 1`,
        [negocioId]
    );

    if (resultado.rows.length === 0) {
        const error = new Error("Negocio no encontrado");
        error.httpStatus = 404;
        throw error;
    }

    return resultado.rows[0];
}

function urlSeguimientoPedido(codigoRecogida) {
    return `${DOMINIO_PUBLICO}/market/pedido/${encodeURIComponent(codigoRecogida)}`;
}

// slug + firmarTokenImagen son opcionales: si no llegan (llamador
// viejo), fotoUrl simplemente queda null y todo lo demas sigue
// funcionando -- mismo criterio "degrada, no truena" que el resto del
// modulo.
async function itemsDePedidos(pool, negocioId, pedidoIds, slug, firmarTokenImagen) {
    if (pedidoIds.length === 0) return new Map();

    const resultado = await pool.query(
        `
        SELECT pp.pedido_market_id, pp.producto_codigo, pp.producto_nombre, pp.cantidad,
               pr.stock AS existencia, pr.descripcion, pr.ubicacion, pr.marca, pr.categoria, pr.subcategoria,
               fp.actualizado_at AS foto_actualizado_at
        FROM public.pedidos_publicos pp
        LEFT JOIN public.productos pr ON pr.negocio_id = $1 AND pr.codigo = pp.producto_codigo
        LEFT JOIN public.fotos_producto fp ON fp.negocio_id = $1 AND fp.codigo = pp.producto_codigo
        WHERE pp.pedido_market_id = ANY($2)
        ORDER BY pp.id ASC
        `,
        [negocioId, pedidoIds]
    );

    const porPedido = new Map();
    for (const fila of resultado.rows) {
        const lista = porPedido.get(fila.pedido_market_id) || [];
        const fotoUrl = (fila.foto_actualizado_at && slug && typeof firmarTokenImagen === "function")
            ? `${DOMINIO_PUBLICO}/fotos-producto/${encodeURIComponent(fila.producto_codigo)}/principal?negocio=${encodeURIComponent(slug)}&v=${new Date(fila.foto_actualizado_at).getTime()}&token=${firmarTokenImagen(negocioId, fila.producto_codigo)}`
            : null;

        lista.push({
            codigo: fila.producto_codigo,
            nombre: fila.producto_nombre,
            cantidad: Number(fila.cantidad),
            existencia: fila.existencia !== null ? Number(fila.existencia) : null,
            descripcion: fila.descripcion || null,
            ubicacion: fila.ubicacion || null,
            marca: fila.marca || null,
            categoria: fila.categoria || null,
            subcategoria: fila.subcategoria || null,
            fotoUrl
        });
        porPedido.set(fila.pedido_market_id, lista);
    }
    return porPedido;
}

function mapearPedidoMarket(fila, items) {
    return {
        id: fila.id,
        grupoId: fila.grupo_id,
        clienteNombre: fila.cliente_nombre,
        clienteTelefono: fila.cliente_telefono,
        clienteCorreo: fila.cliente_correo,
        fulfillment: fila.fulfillment,
        estado: fila.estado,
        motivoCancelacion: fila.motivo_cancelacion,
        codigoRecogida: fila.codigo_recogida,
        total: Number(fila.total),
        pagado: fila.pagado,
        tiempoPrepMin: fila.tiempo_prep_min,
        tiempoPrepMax: fila.tiempo_prep_max,
        recogidaEstimadaDesde: fila.recogida_estimada_desde,
        recogidaEstimadaHasta: fila.recogida_estimada_hasta,
        createdAt: fila.created_at,
        confirmadoAt: fila.confirmado_at,
        preparandoAt: fila.preparando_at,
        listoAt: fila.listo_at,
        entregadoAt: fila.entregado_at,
        canceladoAt: fila.cancelado_at,
        items: items || []
    };
}

const GRUPOS_ESTADO = {
    nuevos: ["pendiente"],
    preparando: ["confirmado", "preparando"],
    listos: ["listo"],
    entregados: ["entregado"],
    cancelados: ["cancelado"]
};

module.exports = (app, pool, requerirAccesoNegocio, firmarTokenImagen) => {
    app.get("/negocio-actual/pedidos-market", requerirAccesoNegocio, async (req, res) => {
        try {
            const negocio = await negocioActualPedidosMarket(req, pool);
            const grupo = String(req.query.estado || "");
            const estados = GRUPOS_ESTADO[grupo] || null;

            const resultado = await pool.query(
                estados
                    ? `SELECT * FROM public.pedidos_market WHERE negocio_id = $1 AND estado = ANY($2) ORDER BY created_at DESC LIMIT 100`
                    : `SELECT * FROM public.pedidos_market WHERE negocio_id = $1 ORDER BY created_at DESC LIMIT 100`,
                estados ? [negocio.id, estados] : [negocio.id]
            );

            const itemsPorPedido = await itemsDePedidos(pool, negocio.id, resultado.rows.map(f => f.id), negocio.slug, firmarTokenImagen);

            res.json({
                ok: true,
                pedidos: resultado.rows.map(fila => mapearPedidoMarket(fila, itemsPorPedido.get(fila.id)))
            });
        } catch (error) {
            res.status(error.httpStatus || 500).json({ ok: false, error: error.message });
        }
    });

    app.patch("/negocio-actual/pedidos-market/:id", requerirAccesoNegocio, async (req, res) => {
        try {
            const negocio = await negocioActualPedidosMarket(req, pool);
            const accion = String(req.body?.accion || "");
            const transicion = TRANSICIONES[accion];

            if (!transicion) {
                res.status(400).json({ ok: false, error: "Accion invalida" });
                return;
            }

            const filaActual = await pool.query(
                `SELECT * FROM public.pedidos_market WHERE id = $1 AND negocio_id = $2`,
                [req.params.id, negocio.id]
            );

            if (filaActual.rows.length === 0) {
                res.status(404).json({ ok: false, error: "Pedido no encontrado" });
                return;
            }

            const pedido = filaActual.rows[0];

            if (!transicion.desde.includes(pedido.estado)) {
                res.status(400).json({ ok: false, error: `No se puede "${accion}" un pedido en estado "${pedido.estado}"` });
                return;
            }

            const motivo = accion === "rechazar" || accion === "cancelar"
                ? req.body?.motivo ? String(req.body.motivo).slice(0, 300) : null
                : null;

            const asignaciones = transicion.fechas.map((campo, i) => `${campo} = NOW()`).join(", ");
            const setMotivo = motivo !== null ? ", motivo_cancelacion = $3" : "";
            const valores = motivo !== null ? [transicion.hasta, req.params.id, motivo] : [transicion.hasta, req.params.id];

            const actualizado = await pool.query(
                `UPDATE public.pedidos_market SET estado = $1, ${asignaciones}${setMotivo} WHERE id = $2 RETURNING *`,
                valores
            );

            const pedidoActualizado = actualizado.rows[0];
            const itemsPorPedido = await itemsDePedidos(pool, negocio.id, [pedidoActualizado.id], negocio.slug, firmarTokenImagen);
            const items = itemsPorPedido.get(pedidoActualizado.id) || [];
            const urlSeguimiento = urlSeguimientoPedido(pedidoActualizado.codigo_recogida);

            if (pedidoActualizado.cliente_correo) {
                if (accion === "aceptar") {
                    enviarCorreoPedidoConfirmado(pedidoActualizado.cliente_correo, negocio.nombre, {
                        items,
                        urlSeguimiento,
                        recogidaDesde: pedidoActualizado.recogida_estimada_desde,
                        recogidaHasta: pedidoActualizado.recogida_estimada_hasta
                    }).catch(error => console.warn("No se pudo enviar el correo de pedido confirmado:", error.message));
                } else if (accion === "marcar_listo") {
                    generarQrYBarcode(pedidoActualizado.codigo_recogida)
                        .then(({ qrBuffer }) => enviarCorreoPedidoListo(pedidoActualizado.cliente_correo, negocio.nombre, {
                            items,
                            codigoRecogida: pedidoActualizado.codigo_recogida,
                            urlSeguimiento,
                            direccion: negocio.direccion,
                            qrBuffer
                        }))
                        .catch(error => console.warn("No se pudo enviar el correo de pedido listo:", error.message));
                } else if (accion === "entregar") {
                    enviarCorreoPedidoEntregado(pedidoActualizado.cliente_correo, negocio.nombre, {
                        items,
                        urlSeguimiento
                    }).catch(error => console.warn("No se pudo enviar el correo de pedido entregado:", error.message));
                } else if (accion === "rechazar" || accion === "cancelar") {
                    enviarCorreoPedidoCancelado(pedidoActualizado.cliente_correo, negocio.nombre, {
                        items,
                        motivo,
                        urlSeguimiento
                    }).catch(error => console.warn("No se pudo enviar el correo de pedido cancelado:", error.message));
                }
            }

            if (pedidoActualizado.persona_id && TITULOS_PUSH_POR_ACCION[accion]) {
                enviarPushAPersona(pool, pedidoActualizado.persona_id, {
                    titulo: TITULOS_PUSH_POR_ACCION[accion],
                    cuerpo: `Pedido ${pedidoActualizado.codigo_recogida} -- ${negocio.nombre}`,
                    url: urlSeguimiento
                }).catch(error => console.warn("No se pudo enviar el push de cambio de estado:", error.message));
            }

            res.json({ ok: true, pedido: mapearPedidoMarket(pedidoActualizado, items) });
        } catch (error) {
            res.status(error.httpStatus || 500).json({ ok: false, error: error.message });
        }
    });

    // Escanear solo verifica y regresa el pedido -- no cambia el
    // estado. El POS confirma con el empleado (pantalla de
    // verificacion) y solo entonces llama al PATCH con accion=entregar.
    // Si el codigo no existe o ya fue usado, mensaje generico -- nunca
    // se filtra si el codigo existio alguna vez.
    app.post("/negocio-actual/pedidos-market/escanear", requerirAccesoNegocio, async (req, res) => {
        try {
            const negocio = await negocioActualPedidosMarket(req, pool);
            const codigo = String(req.body?.codigo || "").trim();

            if (!codigo) {
                res.status(400).json({ ok: false, error: "Codigo requerido" });
                return;
            }

            const resultado = await pool.query(
                `SELECT * FROM public.pedidos_market WHERE negocio_id = $1 AND codigo_recogida = $2`,
                [negocio.id, codigo]
            );

            if (resultado.rows.length === 0) {
                res.status(404).json({ ok: false, error: "Codigo no encontrado" });
                return;
            }

            const pedido = resultado.rows[0];

            if (pedido.estado !== "listo") {
                res.json({
                    ok: false,
                    error: pedido.estado === "entregado"
                        ? "Este pedido ya fue entregado"
                        : `Este pedido todavia no esta listo (estado: ${pedido.estado})`
                });
                return;
            }

            const itemsPorPedido = await itemsDePedidos(pool, negocio.id, [pedido.id], negocio.slug, firmarTokenImagen);
            res.json({ ok: true, pedido: mapearPedidoMarket(pedido, itemsPorPedido.get(pedido.id)) });
        } catch (error) {
            res.status(error.httpStatus || 500).json({ ok: false, error: error.message });
        }
    });
};

// ---------------------------------------------------------------------
// Pagina publica de seguimiento (/market/pedido/:codigo) -- acceso por
// codigo, sin sesion (mismo criterio que portal_cliente_credito). Nunca
// filtra si un codigo existio alguna vez -- 404 generico si no hay
// match. El QR/barcode solo se muestran cuando estado === 'listo'
// (igual que el correo "Pedido listo").

async function pedidoPorCodigo(pool, codigo) {
    const resultado = await pool.query(
        `
        SELECT pm.*, n.nombre AS negocio_nombre, n.slug AS negocio_slug, n.direccion AS negocio_direccion, n.correo AS negocio_correo
        FROM public.pedidos_market pm
        JOIN public.negocios n ON n.id = pm.negocio_id
        WHERE pm.codigo_recogida = $1
        `,
        [codigo]
    );
    return resultado.rows[0] || null;
}

const ORDEN_ETAPA = { pendiente: 0, recibido: 0, confirmado: 1, preparando: 1, listo: 2, entregado: 3 };
const ETAPAS_SEGUIMIENTO = [
    { clave: "pendiente", etiqueta: "Pedido recibido" },
    { clave: "preparando", etiqueta: "Preparando tu pedido" },
    { clave: "listo", etiqueta: "Listo para recoger" },
    { clave: "entregado", etiqueta: "Entregado" }
];

function lineaProgresoHtml(estado) {
    if (estado === "cancelado") {
        return `<div class="market-pedido-cancelado">Este pedido fue cancelado.</div>`;
    }

    const pasoActual = ORDEN_ETAPA[estado] ?? 0;

    return `<div class="market-pedido-progreso">
        ${ETAPAS_SEGUIMIENTO.map((etapa, i) => `
            <div class="market-pedido-etapa ${i <= pasoActual ? "hecho" : ""} ${i === pasoActual ? "actual" : ""}">
                <span class="market-pedido-etapa-punto">${i <= pasoActual ? "✓" : ""}</span>
                <span class="market-pedido-etapa-texto">${escaparHtml(etapa.etiqueta)}</span>
            </div>
        `).join("")}
    </div>`;
}

function formatoHoraSeguimiento(fecha) {
    if (!fecha) return "";
    return new Date(fecha).toLocaleTimeString("es-MX", { hour: "numeric", minute: "2-digit" });
}

const ESTILOS_SEGUIMIENTO_PEDIDO = `
.market-pedido-scope{ max-width:640px; margin:0 auto; padding:32px clamp(18px,4vw,48px) 60px; }
.market-pedido-codigo{ font-size:13px; font-weight:800; letter-spacing:.06em; color:var(--muted); text-transform:uppercase; }
.market-pedido-titulo{ font-size:24px; margin:6px 0 22px; }
.market-pedido-progreso{ display:flex; flex-direction:column; gap:0; margin:0 0 24px; border:1px solid var(--line); border-radius:16px; overflow:hidden; background:var(--glass); }
.market-pedido-etapa{ display:flex; align-items:center; gap:12px; padding:14px 18px; border-top:1px solid var(--line); color:var(--muted); font-size:14px; font-weight:600; }
.market-pedido-etapa:first-child{ border-top:none; }
.market-pedido-etapa.hecho{ color:var(--ink); }
.market-pedido-etapa.actual{ color:var(--blue); font-weight:800; background:rgba(90,124,255,.06); }
.market-pedido-etapa-punto{ width:22px; height:22px; border-radius:999px; border:2px solid var(--line); display:flex; align-items:center; justify-content:center; font-size:12px; flex:0 0 auto; }
.market-pedido-etapa.hecho .market-pedido-etapa-punto{ border-color:var(--mint); background:var(--mint); color:#fff; }
.market-pedido-etapa.actual .market-pedido-etapa-punto{ border-color:var(--blue); }
.market-pedido-cancelado{ padding:16px 18px; border-radius:14px; background:rgba(217,83,79,.1); color:#b3261e; font-weight:700; margin:0 0 24px; }
.market-pedido-motivo{ margin:-14px 0 24px; color:var(--muted); font-size:13.5px; }
.market-pedido-card{ padding:20px 22px; border-radius:16px; background:#fff; border:1px solid var(--line); margin-bottom:18px; }
.market-pedido-card h3{ margin:0 0 12px; font-size:14.5px; }
.market-pedido-item{ display:flex; justify-content:space-between; padding:6px 0; font-size:13.5px; border-top:1px solid var(--line); }
.market-pedido-item:first-child{ border-top:none; }
.market-pedido-item-info{ display:flex; align-items:center; gap:10px; }
.market-pedido-item-foto{ width:36px; height:36px; border-radius:8px; object-fit:cover; flex:0 0 auto; background:var(--paper); border:1px solid var(--line); }
.market-pedido-item-foto-vacia{ display:inline-block; }
.market-pedido-recogida{ font-size:13.5px; color:var(--muted); }
.market-pedido-qr-card{ text-align:center; padding:26px; border-radius:18px; background:var(--paper); border:1px solid var(--line); margin-bottom:18px; }
.market-pedido-qr-card img{ display:block; margin:0 auto 14px; width:180px; height:180px; }
.market-pedido-qr-codigo{ font-size:20px; font-weight:900; letter-spacing:.05em; margin-bottom:14px; }
.market-pedido-barcode img{ display:block; margin:0 auto; max-width:100%; }
.market-pedido-cancelar-btn{ display:block; width:100%; padding:14px; border-radius:14px; border:1px solid rgba(217,83,79,.35); background:#fff; color:#b3261e; font-weight:800; font-size:14px; cursor:pointer; }
.market-pedido-cancelar-btn:hover{ background:rgba(217,83,79,.06); }
.market-pedido-cancelar-btn:disabled{ opacity:.6; cursor:default; }
.market-pedido-cancelar-aviso{ margin:10px 0 0; color:var(--muted); font-size:12.5px; text-align:center; }
`;

function paginaSeguimientoPedidoMarketHtml(pedido, items) {
    if (!pedido) {
        return `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><title>Pedido no encontrado -- Nexo Market</title>
<link rel="stylesheet" href="/site/styles.css"><style>${ESTILOS_MARKET}</style></head>
<body>${marketHeaderHtml({})}
<div class="market-pedido-scope" style="text-align:center;padding:80px 20px;">
<p style="color:var(--muted);font-size:15px;">No encontramos ningun pedido con ese codigo.</p>
</div>
${marketFooterHtml()}</body></html>`;
    }

    const totalTexto = `$${Number(pedido.total).toFixed(2)}`;
    const mostrarRecogida = pedido.estado !== "entregado" && pedido.estado !== "cancelado" && pedido.recogida_estimada_desde;

    return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Pedido ${escaparHtml(pedido.codigo_recogida)} -- Nexo Market</title>
<link rel="icon" href="/nexo-pos-icon.jpg">
${metaInstalableMarketHtml()}
<link rel="stylesheet" href="/site/styles.css">
<style>${ESTILOS_MARKET}</style>
<style>${ESTILOS_SEGUIMIENTO_PEDIDO}</style>
</head>
<body data-estado="${escaparHtml(pedido.estado)}">
${marketHeaderHtml({})}
<div class="market-pedido-scope">
<div class="market-pedido-codigo">Pedido ${escaparHtml(pedido.codigo_recogida)}</div>
<h1 class="market-pedido-titulo">${escaparHtml(pedido.negocio_nombre)}</h1>

${lineaProgresoHtml(pedido.estado)}
${pedido.estado === "cancelado" && pedido.motivo_cancelacion ? `<p class="market-pedido-motivo">Motivo: ${escaparHtml(pedido.motivo_cancelacion)}</p>` : ""}

${pedido.estado === "listo" ? `
<div class="market-pedido-qr-card">
    <img src="/market/pedido/${encodeURIComponent(pedido.codigo_recogida)}/qr.png" alt="Codigo QR de recogida">
    <div class="market-pedido-qr-codigo">${escaparHtml(pedido.codigo_recogida)}</div>
    <div class="market-pedido-barcode"><img src="/market/pedido/${encodeURIComponent(pedido.codigo_recogida)}/barcode.png" alt="Codigo de barras"></div>
    <p style="margin:14px 0 0;color:var(--muted);font-size:13px;">Muestra este codigo en ${escaparHtml(pedido.negocio_nombre)} para recoger tu pedido.</p>
</div>
` : ""}

<div class="market-pedido-card">
    <h3>Productos</h3>
    ${items.map(item => `<div class="market-pedido-item">
        <span class="market-pedido-item-info">
            ${item.fotoUrl ? `<img src="${escaparHtml(item.fotoUrl)}" alt="" class="market-pedido-item-foto">` : `<span class="market-pedido-item-foto market-pedido-item-foto-vacia"></span>`}
            ${escaparHtml(item.nombre)} &times; ${item.cantidad}
        </span>
    </div>`).join("")}
    <div class="market-pedido-item" style="font-weight:800;"><span>Total</span><span>${totalTexto}</span></div>
</div>

${mostrarRecogida ? `
<div class="market-pedido-card">
    <h3>Recogida estimada</h3>
    <p class="market-pedido-recogida">${formatoHoraSeguimiento(pedido.recogida_estimada_desde)} - ${formatoHoraSeguimiento(pedido.recogida_estimada_hasta)}</p>
    ${pedido.negocio_direccion ? `<p class="market-pedido-recogida">📍 ${escaparHtml(pedido.negocio_direccion)}</p>` : ""}
</div>
` : ""}

${pedido.estado === "pendiente" ? `
<button type="button" id="marketPedidoCancelarBtn" class="market-pedido-cancelar-btn">Cancelar pedido</button>
<p class="market-pedido-cancelar-aviso">Puedes cancelar mientras la tienda todavia no acepta tu pedido. Despues de eso, contacta directamente a ${escaparHtml(pedido.negocio_nombre)}.</p>
` : ""}
</div>
${marketFooterHtml()}
<script>${scriptMarketHeaderHtml({ navegarABusqueda: true })}</script>
<script>
(function(){
    var codigo = ${JSON.stringify(pedido.codigo_recogida)};
    var estadoInicial = document.body.getAttribute("data-estado");
    if (estadoInicial === "entregado" || estadoInicial === "cancelado") return;

    setInterval(function(){
        fetch("/market/pedido/" + encodeURIComponent(codigo) + "/estado")
            .then(function(r){ return r.json(); })
            .then(function(datos){
                if (datos.ok && datos.estado !== estadoInicial) {
                    window.location.reload();
                }
            })
            .catch(function(){});
    }, 7000);

    var btnCancelar = document.getElementById("marketPedidoCancelarBtn");
    if (btnCancelar) {
        btnCancelar.addEventListener("click", function(){
            if (!window.confirm("Seguro que quieres cancelar este pedido?")) return;
            btnCancelar.disabled = true;
            btnCancelar.textContent = "Cancelando...";
            fetch("/market/pedido/" + encodeURIComponent(codigo) + "/cancelar", { method: "POST" })
                .then(function(r){ return r.json().then(function(datos){ return { ok: r.ok, datos: datos }; }); })
                .then(function(resultado){
                    if (resultado.datos && resultado.datos.ok) {
                        window.location.reload();
                        return;
                    }
                    alert((resultado.datos && resultado.datos.error) || "No se pudo cancelar el pedido.");
                    btnCancelar.disabled = false;
                    btnCancelar.textContent = "Cancelar pedido";
                })
                .catch(function(){
                    alert("No se pudo cancelar el pedido. Intenta de nuevo.");
                    btnCancelar.disabled = false;
                    btnCancelar.textContent = "Cancelar pedido";
                });
        });
    }
})();
</script>
</body>
</html>`;
}

async function servirSeguimientoPedidoMarket(pool, req, res, firmarTokenImagen) {
    const codigo = String(req.params.codigo || "").trim();
    const pedido = await pedidoPorCodigo(pool, codigo);

    if (!pedido) {
        res.status(404).set("Content-Type", "text/html; charset=utf-8").send(paginaSeguimientoPedidoMarketHtml(null, []));
        return;
    }

    const itemsPorPedido = await itemsDePedidos(pool, pedido.negocio_id, [pedido.id], pedido.negocio_slug, firmarTokenImagen);
    res.set("Content-Type", "text/html; charset=utf-8").send(paginaSeguimientoPedidoMarketHtml(pedido, itemsPorPedido.get(pedido.id) || []));
}

// El cliente cancela su propio pedido por codigo, sin sesion (mismo
// criterio de acceso que el resto de esta pagina). Solo se permite
// mientras el pedido sigue "pendiente" -- en cuanto la ferreteria lo
// acepta (pasa a "preparando") ya empezo a moverse fisicamente, asi
// que de ahi en adelante el cliente tiene que hablar directo con la
// tienda (mismo limite de tiempo real que TRANSICIONES.cancelar del
// lado POS, solo que aqui restringido a un solo estado de origen).
async function cancelarPedidoMarketPorCliente(pool, req, res, firmarTokenImagen) {
    const codigo = String(req.params.codigo || "").trim();
    const pedido = await pedidoPorCodigo(pool, codigo);

    if (!pedido) {
        res.status(404).json({ ok: false, error: "Pedido no encontrado" });
        return;
    }

    if (pedido.estado !== "pendiente") {
        res.status(400).json({
            ok: false,
            error: "Este pedido ya no se puede cancelar en linea. Contacta directamente a la tienda."
        });
        return;
    }

    const actualizado = await pool.query(
        `UPDATE public.pedidos_market SET estado = 'cancelado', cancelado_at = NOW(), motivo_cancelacion = 'Cancelado por el cliente' WHERE id = $1 RETURNING *`,
        [pedido.id]
    );
    const pedidoActualizado = actualizado.rows[0];

    const itemsPorPedido = await itemsDePedidos(pool, pedido.negocio_id, [pedido.id], pedido.negocio_slug, firmarTokenImagen);
    const items = itemsPorPedido.get(pedido.id) || [];
    const urlSeguimiento = urlSeguimientoPedido(pedido.codigo_recogida);

    if (pedido.cliente_correo) {
        enviarCorreoPedidoCancelado(pedido.cliente_correo, pedido.negocio_nombre, {
            items,
            motivo: null,
            urlSeguimiento
        }).catch(error => console.warn("No se pudo enviar el correo de pedido cancelado (cliente):", error.message));
    }

    if (pedido.negocio_correo) {
        enviarCorreoPedidoCanceladoPorCliente(pedido.negocio_correo, {
            codigoRecogida: pedido.codigo_recogida,
            items,
            clienteNombre: pedido.cliente_nombre
        }).catch(error => console.warn("No se pudo enviar el aviso de cancelacion al negocio:", error.message));
    }

    res.json({ ok: true, pedido: mapearPedidoMarket(pedidoActualizado, items) });
}

async function estadoPedidoMarketJson(pool, req, res) {
    const codigo = String(req.params.codigo || "").trim();
    const pedido = await pedidoPorCodigo(pool, codigo);

    if (!pedido) {
        res.status(404).json({ ok: false, error: "Pedido no encontrado" });
        return;
    }

    res.json({
        ok: true,
        estado: pedido.estado,
        confirmadoAt: pedido.confirmado_at,
        preparandoAt: pedido.preparando_at,
        listoAt: pedido.listo_at,
        entregadoAt: pedido.entregado_at,
        canceladoAt: pedido.cancelado_at
    });
}

async function servirQrPedidoMarket(pool, req, res) {
    const codigo = String(req.params.codigo || "").trim();
    const pedido = await pedidoPorCodigo(pool, codigo);

    if (!pedido || pedido.estado !== "listo") {
        res.status(404).send("No encontrado");
        return;
    }

    const { qrBuffer } = await generarQrYBarcode(pedido.codigo_recogida);
    res.set("Content-Type", "image/png").send(qrBuffer);
}

async function servirBarcodePedidoMarket(pool, req, res) {
    const codigo = String(req.params.codigo || "").trim();
    const pedido = await pedidoPorCodigo(pool, codigo);

    if (!pedido || pedido.estado !== "listo") {
        res.status(404).send("No encontrado");
        return;
    }

    const { barcodeBuffer } = await generarQrYBarcode(pedido.codigo_recogida);
    res.set("Content-Type", "image/png").send(barcodeBuffer);
}

module.exports.servirSeguimientoPedidoMarket = servirSeguimientoPedidoMarket;
module.exports.cancelarPedidoMarketPorCliente = cancelarPedidoMarketPorCliente;
module.exports.estadoPedidoMarketJson = estadoPedidoMarketJson;
module.exports.servirQrPedidoMarket = servirQrPedidoMarket;
module.exports.servirBarcodePedidoMarket = servirBarcodePedidoMarket;
