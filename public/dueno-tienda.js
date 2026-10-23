/* Mi tienda (celular, abarrotes): tu día, lo que hay que revisar y el pedido sugerido por proveedor.
   Aparece en "Más" solo si el negocio tiene abarrotes (giro o giro extra). Usa los mismos datos que la
   computadora: /abarrotes/inicio, /lotes/por-revisar, /productos/:id/merma|entrada, /pedido-sugerido. */

let tiendaVista = "dia";
let tiendaPedido = null;

function tiEscapar(valor) {
    return String(valor ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function tiDinero(valor) {
    return "$" + Number(valor || 0).toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// fetchAutenticado devuelve los datos y lanza error con status/datos si el servidor rechaza.
async function tiLlamar(ruta, opciones = {}) {
    try {
        const datos = await fetchAutenticado(ruta, { ...opciones, headers: { "Content-Type": "application/json", ...(opciones.headers || {}) } });
        return { ok: true, datos: datos || {} };
    } catch (error) {
        return { ok: false, datos: error.datos || { error: error.message } };
    }
}

// ---------------------------------------------------------------------
// Entrada en "Más"
// ---------------------------------------------------------------------

async function tiendaInsertarEntrada() {
    if (document.getElementById("tiendaEntrada")) return;

    const { ok, datos } = await tiLlamar("/negocio-actual");
    const negocio = datos.negocio || {};
    const conAbarrotes = ok && (negocio.giro === "abarrotes" || (negocio.girosActivos || []).includes("abarrotes"));
    const destino = document.getElementById("duenoMasStatusCard");

    if (!conAbarrotes || !destino || document.getElementById("tiendaEntrada")) return;

    const boton = document.createElement("button");
    boton.type = "button";
    boton.id = "tiendaEntrada";
    boton.className = "tienda-entrada";
    boton.innerHTML = `<span aria-hidden="true">🛒</span><b>Mi tienda</b><small>Tu día, lo que revisar y el pedido a proveedores</small>`;
    boton.addEventListener("click", () => abrirTienda("dia"));
    destino.insertAdjacentElement("afterend", boton);
}

const cargarPanelMasOriginalTienda = window.cargarPanelMasDueno;

if (typeof cargarPanelMasOriginalTienda === "function") {
    window.cargarPanelMasDueno = async function (...argumentos) {
        const resultado = await cargarPanelMasOriginalTienda.apply(this, argumentos);
        tiendaInsertarEntrada();
        return resultado;
    };
}

// ---------------------------------------------------------------------
// Pantalla
// ---------------------------------------------------------------------

function tiendaCapa() {
    let capa = document.getElementById("tiendaCapa");

    if (!capa) {
        capa = document.createElement("div");
        capa.id = "tiendaCapa";
        capa.className = "tienda-capa";
        document.body.appendChild(capa);
    }

    capa.classList.add("abierta");
    return capa;
}

function cerrarTienda() {
    document.getElementById("tiendaCapa")?.classList.remove("abierta");
}

async function abrirTienda(vista = "dia") {
    tiendaVista = vista;
    tiendaPedido = null;

    const capa = tiendaCapa();

    capa.innerHTML = `
    <header class="tienda-cabecera">
        <button type="button" class="tienda-icono" onclick="cerrarTienda()" aria-label="Cerrar">&larr;</button>
        <h2>Mi tienda</h2>
        <button type="button" class="tienda-icono" onclick="abrirTienda(tiendaVista)" aria-label="Actualizar">↻</button>
    </header>
    <nav class="tienda-tabs">
        <button type="button" data-vista="dia" class="${vista === "dia" ? "activo" : ""}" onclick="abrirTienda('dia')">Mi día</button>
        <button type="button" data-vista="revisar" class="${vista === "revisar" ? "activo" : ""}" onclick="abrirTienda('revisar')">Por revisar</button>
        <button type="button" data-vista="pedido" class="${vista === "pedido" ? "activo" : ""}" onclick="abrirTienda('pedido')">Pedido</button>
    </nav>
    <main id="tiendaCuerpo" class="tienda-cuerpo"><p class="tienda-vacio">Cargando...</p></main>`;

    const cuerpo = document.getElementById("tiendaCuerpo");

    if (vista === "dia") await tiendaPintarDia(cuerpo);
    else if (vista === "revisar") await tiendaPintarRevisar(cuerpo);
    else await tiendaPintarPedidos(cuerpo);
}

// ---------------------------------------------------------------------
// Mi día
// ---------------------------------------------------------------------

async function tiendaPintarDia(cuerpo) {
    const { ok, datos: d } = await tiLlamar("/abarrotes/inicio");

    if (!ok) {
        cuerpo.innerHTML = `<p class="tienda-vacio">${tiEscapar(d.error || "No se pudo cargar tu día.")}</p>`;
        return;
    }

    const maximo = Math.max(1, ...d.semana.map(x => x.total));
    const dias = ["dom", "lun", "mar", "mié", "jue", "vie", "sáb"];
    const comparacion = d.hoy.ayerTotal ? `${d.hoy.total >= d.hoy.ayerTotal ? "▲" : "▼"} ${Math.abs(Math.round(((d.hoy.total - d.hoy.ayerTotal) / d.hoy.ayerTotal) * 100))}% que ayer` : "";

    cuerpo.innerHTML = `
    <section class="tienda-kpis">
        <article><span>Vendiste hoy</span><strong>${tiDinero(d.hoy.total)}</strong><small>${d.hoy.ventas} venta${d.hoy.ventas === 1 ? "" : "s"} ${comparacion}</small></article>
        <article class="verde"><span>Ganaste hoy</span><strong>${tiDinero(d.hoy.ganancia)}</strong><small>Vendido menos lo que te costó</small></article>
        <article class="ambar"><span>Fiado por cobrar</span><strong>${tiDinero(d.fiado.total)}</strong><small>${d.fiado.clientes} cliente${d.fiado.clientes === 1 ? "" : "s"}${d.fiado.vencido > 0 ? ` · ${tiDinero(d.fiado.vencido)} vencido` : ""}</small></article>
    </section>
    ${d.productosSinCosto > 0 ? `<p class="tienda-aviso">A ${d.productosSinCosto} producto(s) que vendiste les falta el costo: sin él no se calcula cuánto ganas con ellos.</p>` : ""}

    <section class="tienda-tarjeta"><h3>Últimos 7 días</h3>
        <div class="tienda-barras">${d.semana.map(s => `
            <div><i style="height:${Math.max(3, Math.round((s.total / maximo) * 100))}%"></i><span>${dias[new Date(`${s.dia}T12:00:00`).getDay()]}</span></div>`).join("")}</div>
    </section>

    <section class="tienda-tarjeta"><h3>Recargas y servicios hoy</h3>
        ${d.servicios.operaciones ? `<p><b>${tiDinero(d.servicios.importe)}</b> en ${d.servicios.operaciones} operación(es) · te quedaron <b class="verde">${tiDinero(d.servicios.comision)}</b></p>` : `<p class="tienda-vacio">Sin recargas hoy.</p>`}
    </section>

    <section class="tienda-tarjeta"><h3>Lo que más te deja</h3>
        ${d.masGanancia.length ? `<ol class="tienda-lista">${d.masGanancia.map(p => `<li><span>${tiEscapar(p.nombre)}</span><b>${tiDinero(p.ganancia)}</b></li>`).join("")}</ol>` : `<p class="tienda-vacio">Cuando vendas productos con costo lo verás aquí.</p>`}
    </section>

    <section class="tienda-tarjeta"><h3>Dejan poco o pierdes</h3>
        ${d.pierden.length ? `<ul class="tienda-lista">${d.pierden.map(p => `<li><span>${tiEscapar(p.nombre)}</span><b class="rojo">${p.ganancia <= 0 ? `-${tiDinero(Math.abs(p.ganancia))}` : `${p.margen}%`}</b></li>`).join("")}</ul>` : `<p class="tienda-vacio">Ninguno.</p>`}
    </section>
    <p class="tienda-nota">${d.inventario.productos} productos · ${d.inventario.bajos} por agotarse · ${d.inventario.sinStock} sin existencia</p>`;
}

// ---------------------------------------------------------------------
// Por revisar (caducidad): tirar y registrar mercancía que llegó
// ---------------------------------------------------------------------

function tiendaTextoDias(l) {
    return l.estado === "vencido" ? `Venció hace ${Math.abs(l.dias)} día${Math.abs(l.dias) === 1 ? "" : "s"}` : l.estado === "hoy" ? "Vence hoy" : l.estado === "manana" ? "Vence mañana" : `Vence en ${l.dias} días`;
}

async function tiendaPintarRevisar(cuerpo) {
    const { ok, datos } = await tiLlamar("/lotes/por-revisar?dias=7");

    if (!ok) {
        cuerpo.innerHTML = `<p class="tienda-vacio">${tiEscapar(datos.error || "No se pudo cargar.")}</p>`;
        return;
    }

    cuerpo.innerHTML = datos.lotes.length ? `
    <p class="tienda-nota">Lo que vence en los próximos 7 días. Costaría tirarlo: <b>${tiDinero(datos.resumen.valorCosto)}</b>.</p>
    <ul class="tienda-revisar">${datos.lotes.map(l => `
        <li class="${l.estado === "vencido" ? "mal" : ""}">
            <div><b>${tiEscapar(l.nombre)}</b><small>${tiendaTextoDias(l)} · ${l.cantidad} ${tiEscapar(l.unidad)}</small></div>
            <div class="tienda-acciones">
                <button type="button" onclick="tiendaTirar(${l.productoId}, ${l.cantidad}, ${JSON.stringify(l.nombre).replace(/"/g, "&quot;")})">Tirar</button>
                <button type="button" onclick="tiendaLlego(${l.productoId}, ${JSON.stringify(l.nombre).replace(/"/g, "&quot;")})">Llegó más</button>
            </div>
        </li>`).join("")}</ul>` : `<p class="tienda-vacio">Todo en orden: nada vence en los próximos 7 días.</p>`;
}

async function tiendaMover(ruta, pregunta, valorInicial, mensajeOk) {
    const texto = window.prompt(pregunta, valorInicial);
    if (texto === null) return;

    const cantidad = Number(String(texto).replace(",", "."));
    if (!(cantidad > 0)) { window.alert("Escribe una cantidad mayor a cero."); return; }

    const { ok, datos } = await tiLlamar(ruta, { method: "POST", body: JSON.stringify({ cantidad, motivo: "caducado" }) });
    if (!ok) { window.alert(datos.error || "No se pudo guardar."); return; }

    window.alert(mensajeOk(datos));
    abrirTienda("revisar");
}

function tiendaTirar(id, cantidad, nombre) {
    tiendaMover(`/productos/${id}/merma`, `¿Cuánto de "${nombre}" vas a tirar?`, String(cantidad), d => `Anotado. Perdiste ${tiDinero(d.perdidoCosto)} a costo.`);
}

function tiendaLlego(id, nombre) {
    tiendaMover(`/productos/${id}/entrada`, `¿Cuánto llegó de "${nombre}"?`, "", d => `Listo, ahora tienes ${d.stock}.${d.fechaCaducidad ? ` Caduca el ${d.fechaCaducidad}.` : ""}`);
}

// ---------------------------------------------------------------------
// Pedido sugerido
// ---------------------------------------------------------------------

const TIENDA_DIAS = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];

function tiendaCuando(p) {
    if (p.diasHastaVisita === null) return "Sin día de visita";
    if (p.diasHastaVisita === 0) return "Viene hoy";
    if (p.diasHastaVisita === 1) return "Viene mañana";
    return `Viene el ${TIENDA_DIAS[p.diaVisita].toLowerCase()} (en ${p.diasHastaVisita} días)`;
}

async function tiendaPintarPedidos(cuerpo) {
    const { ok, datos } = await tiLlamar("/pedido-sugerido");

    if (!ok) {
        cuerpo.innerHTML = `<p class="tienda-vacio">${tiEscapar(datos.error || "No se pudo cargar.")}</p>`;
        return;
    }

    cuerpo.innerHTML = datos.proveedores.length ? datos.proveedores.map(p => `
        <article class="tienda-tarjeta ${p.diasHastaVisita !== null && p.diasHastaVisita <= 2 ? "urgente" : ""}">
            <h3>${tiEscapar(p.proveedor)}</h3>
            <p class="tienda-cuando">${tiendaCuando(p)}</p>
            ${p.productosSugeridos ? `<p><b>${tiDinero(p.total)}</b> · ${p.productosSugeridos} producto(s) por pedir</p>` : `<p class="tienda-vacio">${p.diaVisita === null ? "Dile qué día viene." : "Nada que pedir por ahora."}</p>`}
            <div class="tienda-acciones">
                <select onchange="tiendaGuardarDia(${p.proveedorId}, this.value)" aria-label="Día que viene">
                    <option value="">Sin día</option>${TIENDA_DIAS.map((n, i) => `<option value="${i}" ${p.diaVisita === i ? "selected" : ""}>${n}</option>`).join("")}
                </select>
                <button type="button" ${p.productosSugeridos ? "" : "disabled"} onclick="tiendaAbrirPedido(${p.proveedorId})">Ver pedido</button>
            </div>
        </article>`).join("") : `<p class="tienda-vacio">Aún no tienes proveedores. Agrégalos en la computadora.</p>`;
}

async function tiendaGuardarDia(id, dia) {
    await tiLlamar(`/pedido-sugerido/${id}/visita`, { method: "PATCH", body: JSON.stringify({ diaVisita: dia === "" ? null : Number(dia) }) });
    abrirTienda("pedido");
}

async function tiendaAbrirPedido(id) {
    const { ok, datos } = await tiLlamar(`/pedido-sugerido/${id}`);
    if (!ok) { window.alert(datos.error || "No se pudo calcular."); return; }

    tiendaPedido = { ...datos, cantidades: Object.fromEntries(datos.items.map(i => [i.productoId, i.cantidad])) };
    tiendaPintarPedido();
}

function tiendaPintarPedido() {
    const p = tiendaPedido;
    const cuerpo = document.getElementById("tiendaCuerpo");

    cuerpo.innerHTML = `
    <button type="button" class="tienda-volver" onclick="abrirTienda('pedido')">&larr; Todos los proveedores</button>
    <h3 class="tienda-titulo">${tiEscapar(p.proveedor)}</h3>
    <p class="tienda-cuando">${tiendaCuando(p)} · ventas de los últimos ${p.diasDeVentas} días</p>
    <ul class="tienda-pedido">${p.items.map(i => `
        <li><div><b>${tiEscapar(i.nombre)}</b><small>Tienes ${Number(i.existencia.toFixed(3))}${i.porDia ? ` · vendes ${i.porDia}/día` : ""}</small></div>
            <input type="number" min="0" step="1" inputmode="numeric" value="${p.cantidades[i.productoId]}" oninput="tiendaCantidad(${i.productoId}, this.value)"></li>`).join("")}</ul>
    <p class="tienda-total">Total estimado <b id="tiendaTotal">${tiDinero(tiendaTotal())}</b></p>
    <div class="tienda-acciones">
        <button type="button" onclick="tiendaCompartir()">Enviar por WhatsApp</button>
        <button type="button" onclick="tiendaCopiar()">Copiar</button>
        <button type="button" class="primario" onclick="tiendaGuardarPedido()">Guardar pedido</button>
    </div>`;
}

function tiendaTotal() {
    return tiendaPedido.items.reduce((s, i) => s + (Number(tiendaPedido.cantidades[i.productoId]) || 0) * i.costo, 0);
}

function tiendaCantidad(id, valor) {
    tiendaPedido.cantidades[id] = Math.max(0, Math.round(Number(valor) || 0));
    document.getElementById("tiendaTotal").textContent = tiDinero(tiendaTotal());
}

function tiendaLineas() {
    return tiendaPedido.items.map(i => ({ ...i, pedir: Number(tiendaPedido.cantidades[i.productoId]) || 0 })).filter(i => i.pedir > 0);
}

function tiendaTexto() {
    return [`Pedido para ${tiendaPedido.proveedor}:`, ...tiendaLineas().map(i => `- ${i.pedir} x ${i.nombre}`)].join("\n");
}

// wa.me sin numero abre WhatsApp para elegir el contacto del proveedor con el texto ya escrito.
function tiendaCompartir() {
    if (!tiendaLineas().length) { window.alert("No hay nada que pedir."); return; }
    window.open(`https://wa.me/?text=${encodeURIComponent(tiendaTexto())}`, "_blank", "noopener");
}

async function tiendaCopiar() {
    if (!tiendaLineas().length) { window.alert("No hay nada que pedir."); return; }

    try {
        await navigator.clipboard.writeText(tiendaTexto());
        window.alert("Lista copiada.");
    } catch (error) {
        window.prompt("Copia la lista:", tiendaTexto());
    }
}

async function tiendaGuardarPedido() {
    const lineas = tiendaLineas();
    if (!lineas.length) { window.alert("No hay nada que pedir."); return; }

    const { ok, datos } = await tiLlamar("/pedidos-proveedor", {
        method: "POST",
        body: JSON.stringify({
            proveedor: tiendaPedido.proveedor, estado: "borrador", notas: "Pedido sugerido por Nexo",
            items: lineas.map(i => ({ productoId: i.productoId, codigo: i.codigo, nombre: i.nombre, cantidad: i.pedir, costo: i.costo, unidad: i.unidad }))
        })
    });

    window.alert(ok ? `Pedido guardado como borrador: ${lineas.length} producto(s), ${tiDinero(tiendaTotal())}.` : (datos.error || "No se pudo guardar el pedido."));
}
