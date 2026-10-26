/* Exhibidores en el celular (/dueno): lista de tus exhibidores y, al abrir uno, tarjetas con foto, precio y existencia.
   Un toque agrega la pieza al carrito de Vender; arriba ves cuantas llevas de cada una. Usa los mismos datos que la
   computadora (/exhibidores) y el carrito de siempre (duenoCarrito). Aparece en "Mas" solo si ya armaste exhibidores. */

let dxFotos = new Map();
let dxActual = null;

function dxEscapar(valor) {
    return String(valor ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function dxDinero(valor) {
    return "$" + Number(valor || 0).toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

async function dxLlamar(ruta) {
    try {
        return { ok: true, datos: await fetchAutenticado(ruta) || {} };
    } catch (error) {
        return { ok: false, datos: error.datos || { error: error.message } };
    }
}

// ---------------------------------------------------------------------
// Entrada en "Mas"
// ---------------------------------------------------------------------

async function dxInsertarEntrada() {
    if (document.getElementById("dxEntrada")) return;

    const { ok, datos } = await dxLlamar("/exhibidores");
    const hay = ok && (datos.exhibidores || []).some(x => x.activo && x.totalEspacios > 0);
    const destino = document.getElementById("duenoMasStatusCard");

    if (!hay || !destino || document.getElementById("dxEntrada")) return;

    const boton = document.createElement("button");
    boton.type = "button";
    boton.id = "dxEntrada";
    boton.className = "dx-entrada";
    boton.innerHTML = `<span aria-hidden="true">🗄️</span><b>Exhibidores</b><small>Vende tocando la foto: brocas, lijas, dulces...</small>`;
    boton.addEventListener("click", abrirExhibidoresDueno);
    destino.insertAdjacentElement("afterend", boton);
}

const cargarPanelMasOriginalExhibidores = window.cargarPanelMasDueno;

if (typeof cargarPanelMasOriginalExhibidores === "function") {
    window.cargarPanelMasDueno = async function (...argumentos) {
        const resultado = await cargarPanelMasOriginalExhibidores.apply(this, argumentos);
        dxInsertarEntrada();
        return resultado;
    };
}

// ---------------------------------------------------------------------
// Pantalla
// ---------------------------------------------------------------------

function dxCapa() {
    let capa = document.getElementById("dxCapa");

    if (!capa) {
        capa = document.createElement("div");
        capa.id = "dxCapa";
        capa.className = "dx-capa";
        document.body.appendChild(capa);
    }

    capa.classList.add("abierta");
    return capa;
}

function cerrarExhibidoresDueno() {
    document.getElementById("dxCapa")?.classList.remove("abierta");
    dxActual = null;
}

function dxCantidadEnCarrito(productoId) {
    return (typeof duenoCarrito !== "undefined" ? duenoCarrito : [])
        .filter(item => item.productoId === productoId)
        .reduce((suma, item) => suma + item.cantidad, 0);
}

async function abrirExhibidoresDueno() {
    dxActual = null;
    const capa = dxCapa();

    capa.innerHTML = `
    <header class="dx-cabecera">
        <button type="button" class="dx-icono" onclick="cerrarExhibidoresDueno()" aria-label="Cerrar">&larr;</button>
        <h2>Exhibidores</h2>
        <span class="dx-icono dx-vacio-icono"></span>
    </header>
    <main class="dx-cuerpo" id="dxCuerpo"><p class="dx-nota">Cargando...</p></main>`;

    const { ok, datos } = await dxLlamar("/exhibidores");
    const cuerpo = document.getElementById("dxCuerpo");
    const lista = ok ? (datos.exhibidores || []).filter(x => x.activo && x.totalEspacios > 0) : [];

    cuerpo.innerHTML = lista.length ? lista.map(x => `
        <button type="button" class="dx-tarjeta dx-color-${dxEscapar(x.color || "azul")}" onclick="abrirExhibidorDueno(${x.id})">
            <b>${dxEscapar(x.nombre)}</b>
            <span>${x.totalEspacios} producto${x.totalEspacios === 1 ? "" : "s"}${x.agotados ? ` · ${x.agotados} agotado${x.agotados === 1 ? "" : "s"}` : ""}</span>
        </button>`).join("") : `<p class="dx-nota">${ok ? "Todavía no tienes exhibidores con productos. Créalos en la computadora." : "No se pudieron cargar. Revisa tu internet."}</p>`;
}

async function abrirExhibidorDueno(id) {
    const cuerpo = document.getElementById("dxCuerpo");
    if (cuerpo) cuerpo.innerHTML = `<p class="dx-nota">Cargando...</p>`;

    const [exhibidor, productos] = await Promise.all([dxLlamar(`/exhibidores/${id}`), dxLlamar("/productos")]);

    if (!exhibidor.ok) {
        if (cuerpo) cuerpo.innerHTML = `<p class="dx-nota">${dxEscapar(exhibidor.datos.error || "No se pudo abrir el exhibidor.")}</p>`;
        return;
    }

    dxFotos = new Map((Array.isArray(productos.datos) ? productos.datos : []).map(p => [p.id, p.imagenUrl || null]));
    dxActual = exhibidor.datos.exhibidor;
    dxPintarExhibidor();
}

function dxPintarExhibidor() {
    const x = dxActual;
    const capa = dxCapa();
    const llevo = (typeof duenoCarrito !== "undefined" ? duenoCarrito : []).reduce((s, i) => s + i.cantidad, 0);
    const total = (typeof duenoCarrito !== "undefined" ? duenoCarrito : []).reduce((s, i) => s + i.precioUnitario * i.cantidad, 0);

    capa.innerHTML = `
    <header class="dx-cabecera dx-color-${dxEscapar(x.color || "azul")}">
        <button type="button" class="dx-icono" onclick="abrirExhibidoresDueno()" aria-label="Volver">&larr;</button>
        <h2>${dxEscapar(x.nombre)}</h2>
        <span class="dx-icono dx-vacio-icono"></span>
    </header>
    <main class="dx-cuerpo">
        <p class="dx-nota">Toca una tarjeta para agregarla al carrito.</p>
        <div class="dx-tiles">${x.espacios.map(e => {
            const foto = dxFotos.get(e.productoId);
            const enCarrito = dxCantidadEnCarrito(e.productoId);

            return `
            <button type="button" class="dx-tile${e.existencia <= 0 ? " dx-agotado" : ""}" data-producto-id="${e.productoId}" onclick="dxAgregar(${e.productoId})">
                <span class="dx-cuenta" ${enCarrito ? "" : "hidden"}>${enCarrito}</span>
                <span class="dx-foto">${foto ? `<img src="${foto}" alt="" loading="lazy">` : "<i aria-hidden=\"true\">📦</i>"}</span>
                ${e.etiqueta ? `<small class="dx-lugar">${dxEscapar(e.etiqueta)}</small>` : ""}
                <strong>${dxEscapar(e.nombre)}</strong>
                <span class="dx-precio">${dxDinero(e.precio)}</span>
                <span class="dx-stock ${e.existencia <= 0 ? "sin" : e.existencia <= 3 ? "poco" : "ok"}">${e.existencia <= 0 ? "Agotado" : `${Number(e.existencia.toFixed(3))} disp.`}</span>
            </button>`;
        }).join("")}</div>
    </main>
    <div class="dx-barra" id="dxBarra" ${llevo ? "" : "hidden"}>
        <span id="dxBarraTexto">${llevo} en el carrito · ${dxDinero(total)}</span>
        <button type="button" onclick="dxVerCarrito()">Ver carrito</button>
    </div>`;
}

function dxAgregar(productoId) {
    const e = dxActual?.espacios.find(item => item.productoId === productoId);
    if (!e || typeof duenoCarrito === "undefined") return;

    const existente = duenoCarrito.find(item => item.productoId === productoId);

    if (existente) {
        existente.cantidad += 1;
    } else {
        duenoCarrito.push({ productoId, codigo: e.codigo, nombre: e.nombre, precioUnitario: e.precio, cantidad: 1 });
    }

    if (typeof renderCarritoDueno === "function") renderCarritoDueno();

    // Solo cambian la cuenta de esa tarjeta y la barra de abajo (volver a dibujar todo parpadea las fotos).
    const tile = document.querySelector(`#dxCapa .dx-tile[data-producto-id="${productoId}"] .dx-cuenta`);
    if (tile) { tile.hidden = false; tile.textContent = dxCantidadEnCarrito(productoId); }

    const llevo = duenoCarrito.reduce((s, i) => s + i.cantidad, 0);
    const total = duenoCarrito.reduce((s, i) => s + i.precioUnitario * i.cantidad, 0);
    const barra = document.getElementById("dxBarra");
    if (barra) barra.hidden = false;
    const texto = document.getElementById("dxBarraTexto");
    if (texto) texto.textContent = `${llevo} en el carrito · ${dxDinero(total)}`;
}

function dxVerCarrito() {
    cerrarExhibidoresDueno();
    if (typeof cambiarTabDueno === "function") cambiarTabDueno("vender");
}
