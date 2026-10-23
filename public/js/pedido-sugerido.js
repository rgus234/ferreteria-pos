/* Pedido sugerido por proveedor (abarrotes).

   Cada proveedor guarda el dia que viene; con las ventas reales Nexo calcula que
   conviene pedir de sus productos y cuanto dinero es. El dueño ajusta las
   cantidades y guarda el pedido como borrador (POST /pedidos-proveedor) o copia
   la lista. Servidor: pedido-sugerido-server.js. */

const PEDIDO_SUG_DIAS = ["Domingo", "Lunes", "Martes", "Miercoles", "Jueves", "Viernes", "Sabado"];
const PEDIDO_SUG_FRECUENCIAS = [[3, "Cada 3 dias"], [7, "Cada semana"], [14, "Cada 2 semanas"], [30, "Cada mes"]];

let pedidoSugerido = null;

function pedSugEscapar(valor) {
    return String(valor ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function pedSugDinero(valor) {
    return "$" + Number(valor || 0).toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

async function pedSugLlamar(ruta, opciones = {}) {
    const respuesta = await fetch(ruta, { headers: { "Content-Type": "application/json" }, ...opciones });
    const datos = await respuesta.json().catch(() => ({}));
    return { ok: respuesta.ok, estado: respuesta.status, datos };
}

function pedSugCuando(proveedor) {
    if (proveedor.diasHastaVisita === null) return "Sin dia de visita";
    if (proveedor.diasHastaVisita === 0) return "Viene hoy";
    if (proveedor.diasHastaVisita === 1) return "Viene manana";
    return `Viene el ${PEDIDO_SUG_DIAS[proveedor.diaVisita].toLowerCase()} (en ${proveedor.diasHastaVisita} dias)`;
}

async function mostrarPedidoSugerido() {
    if (typeof ocultarPantallasPrincipales === "function") ocultarPantallasPrincipales();

    const pantalla = document.getElementById("pantallaPedidoSugerido");
    if (!pantalla) return;

    pantalla.style.display = "block";

    if (typeof actualizarTopbarContexto === "function") {
        actualizarTopbarContexto("Pedido sugerido", "Que pedirle a cada proveedor segun lo que vendes", "pedido-sugerido");
    }

    pantalla.innerHTML = `<div class="pedsug-shell"><div class="pedsug-vacio">Calculando...</div></div>`;

    const { ok, datos } = await pedSugLlamar("/pedido-sugerido");

    if (!ok) {
        pantalla.innerHTML = `<div class="pedsug-shell"><div class="pedsug-vacio">${pedSugEscapar(datos.error || "No se pudo calcular el pedido.")}</div></div>`;
        return;
    }

    renderPedidoSugeridoLista(datos.proveedores);
}

function pedSugSelectorDia(proveedor) {
    return `
    <select onchange="pedSugGuardarVisita(${proveedor.proveedorId}, { diaVisita: this.value })" aria-label="Dia que viene">
        <option value="" ${proveedor.diaVisita === null ? "selected" : ""}>Sin dia</option>
        ${PEDIDO_SUG_DIAS.map((nombre, i) => `<option value="${i}" ${proveedor.diaVisita === i ? "selected" : ""}>${nombre}</option>`).join("")}
    </select>`;
}

function pedSugSelectorFrecuencia(proveedor) {
    const opciones = PEDIDO_SUG_FRECUENCIAS.some(([dias]) => dias === proveedor.frecuenciaDias)
        ? PEDIDO_SUG_FRECUENCIAS
        : [...PEDIDO_SUG_FRECUENCIAS, [proveedor.frecuenciaDias, `Cada ${proveedor.frecuenciaDias} dias`]];

    return `
    <select onchange="pedSugGuardarVisita(${proveedor.proveedorId}, { frecuenciaDias: this.value })" aria-label="Cada cuanto viene">
        ${opciones.map(([dias, texto]) => `<option value="${dias}" ${proveedor.frecuenciaDias === dias ? "selected" : ""}>${texto}</option>`).join("")}
    </select>`;
}

function renderPedidoSugeridoLista(proveedores) {
    const pantalla = document.getElementById("pantallaPedidoSugerido");
    if (!pantalla) return;

    const tarjetas = proveedores.map(p => {
        const urgente = p.diasHastaVisita !== null && p.diasHastaVisita <= 2;

        return `
        <article class="pedsug-card${urgente ? " pedsug-card-urgente" : ""}">
            <div class="pedsug-card-cabecera">
                <strong>${pedSugEscapar(p.proveedor)}</strong>
                <span class="pedsug-cuando">${pedSugCuando(p)}</span>
            </div>
            <div class="pedsug-card-cuerpo">
                ${p.productosDelProveedor === 0
                    ? `<span class="pedsug-nota">Todavia no tiene productos. Asignale su proveedor al dar de alta cada producto.</span>`
                    : p.diaVisita === null
                        ? `<span class="pedsug-nota">Dile que dia viene para calcular el pedido y recibir el aviso.</span>`
                        : `<strong class="pedsug-monto">${pedSugDinero(p.total)}</strong>
                           <span>${p.productosSugeridos} producto${p.productosSugeridos === 1 ? "" : "s"} por pedir</span>`}
            </div>
            <div class="pedsug-card-visita">
                ${pedSugSelectorDia(p)}
                ${pedSugSelectorFrecuencia(p)}
            </div>
            <button type="button" class="pedsug-btn pedsug-btn-primario" onclick="abrirPedidoSugerido(${p.proveedorId})" ${p.productosSugeridos ? "" : "disabled"}>Ver pedido</button>
        </article>`;
    }).join("");

    pantalla.innerHTML = `
    <div class="pedsug-shell">
        <div class="pedsug-header">
            <h2>Pedido sugerido</h2>
            <p>Dile a Nexo que dia viene cada proveedor. Con lo que vendes, te dice que pedirle y cuanto dinero es, y te avisa unos dias antes de que llegue.</p>
        </div>
        ${proveedores.length === 0
            ? `<div class="pedsug-vacio">Aun no tienes proveedores. Agrega uno en Proveedores y asignaselo a tus productos.</div>`
            : `<div class="pedsug-grid">${tarjetas}</div>`}
    </div>`;
}

async function pedSugGuardarVisita(proveedorId, cambios) {
    const { ok, datos } = await pedSugLlamar(`/pedido-sugerido/${proveedorId}/visita`, { method: "PATCH", body: JSON.stringify(cambios) });

    if (!ok) {
        alertaPOS(datos.error || "No se pudo guardar.", "Pedido sugerido", "peligro");
    }

    mostrarPedidoSugerido();
}

async function abrirPedidoSugerido(proveedorId) {
    const pantalla = document.getElementById("pantallaPedidoSugerido");
    if (!pantalla) return;

    pantalla.innerHTML = `<div class="pedsug-shell"><div class="pedsug-vacio">Calculando...</div></div>`;

    const { ok, datos } = await pedSugLlamar(`/pedido-sugerido/${proveedorId}`);

    if (!ok) {
        alertaPOS(datos.error || "No se pudo calcular el pedido.", "Pedido sugerido", "peligro");
        mostrarPedidoSugerido();
        return;
    }

    pedidoSugerido = { ...datos, cantidades: Object.fromEntries(datos.items.map(i => [i.productoId, i.cantidad])) };
    renderPedidoSugerido();
}

function pedSugTotal() {
    return pedidoSugerido.items.reduce((suma, i) => suma + (Number(pedidoSugerido.cantidades[i.productoId]) || 0) * i.costo, 0);
}

function renderPedidoSugerido() {
    const pantalla = document.getElementById("pantallaPedidoSugerido");
    const p = pedidoSugerido;
    if (!pantalla || !p) return;

    const filas = p.items.map(i => `
        <tr>
            <td><strong>${pedSugEscapar(i.nombre)}</strong><span>${i.motivo === "minimo" ? "Por debajo de tu minimo" : (i.porDia ? `Vendes ${i.porDia} al dia` : "")}</span></td>
            <td>${Number(i.existencia.toFixed(3))}</td>
            <td>${i.diasAlcanza === null ? "-" : `${i.diasAlcanza} dias`}</td>
            <td><input type="number" min="0" step="1" value="${p.cantidades[i.productoId]}" onchange="pedSugCambiarCantidad(${i.productoId}, this.value)"></td>
            <td>${pedSugDinero(i.costo)}</td>
            <td class="pedsug-subtotal" id="pedsugSub${i.productoId}">${pedSugDinero((Number(p.cantidades[i.productoId]) || 0) * i.costo)}</td>
        </tr>`).join("");

    pantalla.innerHTML = `
    <div class="pedsug-shell">
        <div class="pedsug-header">
            <div>
                <h2>Pedido para ${pedSugEscapar(p.proveedor)}</h2>
                <p>${pedSugCuando(p)} &middot; calculado con tus ventas de los ultimos ${p.diasDeVentas} dias${p.hayVentas ? "" : " (todavia no hay ventas: solo se toman en cuenta tus minimos)"}.</p>
            </div>
            <button type="button" class="pedsug-btn" onclick="mostrarPedidoSugerido()">Volver</button>
        </div>
        <table class="pedsug-tabla">
            <thead><tr><th>Producto</th><th>Tienes</th><th>Te dura</th><th>Pedir</th><th>Costo</th><th>Subtotal</th></tr></thead>
            <tbody>${filas}</tbody>
        </table>
        <div class="pedsug-pie">
            <div class="pedsug-total">Total estimado <strong id="pedsugTotal">${pedSugDinero(pedSugTotal())}</strong></div>
            <div class="pedsug-acciones">
                <button type="button" class="pedsug-btn" onclick="pedSugCopiar()">Copiar lista</button>
                <button type="button" class="pedsug-btn pedsug-btn-primario" onclick="pedSugGuardarBorrador()">Guardar pedido</button>
            </div>
        </div>
    </div>`;
}

function pedSugCambiarCantidad(productoId, valor) {
    const cantidad = Math.max(0, Math.round(Number(valor) || 0));
    pedidoSugerido.cantidades[productoId] = cantidad;

    const item = pedidoSugerido.items.find(i => i.productoId === productoId);
    const subtotal = document.getElementById(`pedsugSub${productoId}`);
    if (subtotal && item) subtotal.textContent = pedSugDinero(cantidad * item.costo);

    const total = document.getElementById("pedsugTotal");
    if (total) total.textContent = pedSugDinero(pedSugTotal());
}

function pedSugLineas() {
    return pedidoSugerido.items
        .map(i => ({ ...i, pedir: Number(pedidoSugerido.cantidades[i.productoId]) || 0 }))
        .filter(i => i.pedir > 0);
}

async function pedSugCopiar() {
    const lineas = pedSugLineas();

    if (!lineas.length) {
        alertaPOS("No hay nada que pedir.", "Pedido sugerido", "alerta");
        return;
    }

    const texto = [`Pedido para ${pedidoSugerido.proveedor}:`, ...lineas.map(i => `- ${i.pedir} x ${i.nombre}`)].join("\n");

    try {
        await navigator.clipboard.writeText(texto);
        alertaPOS("Lista copiada. Pegala en WhatsApp o donde quieras.", "Pedido sugerido", "info");
    } catch (error) {
        await pedirTextoPOS("Copia la lista:", texto, "Pedido sugerido");
    }
}

async function pedSugGuardarBorrador() {
    const lineas = pedSugLineas();

    if (!lineas.length) {
        alertaPOS("No hay nada que pedir.", "Pedido sugerido", "alerta");
        return;
    }

    const { ok, datos } = await pedSugLlamar("/pedidos-proveedor", {
        method: "POST",
        body: JSON.stringify({
            proveedor: pedidoSugerido.proveedor,
            estado: "borrador",
            notas: "Pedido sugerido por Nexo",
            items: lineas.map(i => ({ productoId: i.productoId, codigo: i.codigo, nombre: i.nombre, cantidad: i.pedir, costo: i.costo, unidad: i.unidad }))
        })
    });

    if (!ok) {
        alertaPOS(datos.error || "No se pudo guardar el pedido.", "Pedido sugerido", "peligro");
        return;
    }

    alertaPOS(`Pedido guardado como borrador: ${lineas.length} producto${lineas.length === 1 ? "" : "s"}, ${pedSugDinero(pedSugTotal())}.`, "Pedido sugerido", "info");
}
