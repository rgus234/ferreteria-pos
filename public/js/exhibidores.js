// Exhibidores: muebles/displays de la tienda (despachador de brocas, exhibidor
// de lijas, rack de dulces...). Se arman una vez en Inventario -> Exhibidores
// (que productos van en cada espacio) y se venden desde el Punto de Venta con
// tarjetas visuales: elige el exhibidor, toca la tarjeta del producto y se
// agrega al carrito. NO tocan el inventario: los productos siguen siendo los
// mismos de siempre; el exhibidor solo los agrupa.

let exhibidoresLista = [];
let exhibidorEditando = null;
let exhibidorPOSActual = null;
let exhibidorPOSAgregados = 0;

const EXHIBIDOR_COLORES = ["azul", "naranja", "verde", "rojo", "morado", "negro"];

function exhEscapar(valor) {
    return typeof escaparPOS === "function"
        ? escaparPOS(valor)
        : String(valor ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function exhNormalizar(texto) {
    return String(texto || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
}

function exhProducto(id) {
    return (typeof todosProductos !== "undefined" ? todosProductos : []).find(p => Number(p.id) === Number(id)) || null;
}

function exhDinero(valor) {
    return "$" + Number(valor || 0).toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function exhMiniatura(productoId, nombre) {
    const producto = exhProducto(productoId);
    // Abarrotes: sin foto sale la inicial del producto, no el maletin de herramientas de ferreteria.
    const sinFotoAbarrotes = exhEsAbarrotes() && !(producto && producto.imagenUrl);

    if (producto && !sinFotoAbarrotes && typeof miniaturaProducto === "function") {
        return miniaturaProducto(producto);
    }
    return `<span class="exh-sin-foto" aria-hidden="true">${exhEscapar(String(nombre || producto?.nombre || "?").charAt(0).toUpperCase())}</span>`;
}

async function exhLlamar(ruta, opciones = {}) {
    const respuesta = await fetch(ruta, {
        ...opciones,
        headers: { "Content-Type": "application/json", ...(opciones.headers || {}) }
    });
    const datos = await respuesta.json().catch(() => ({}));
    return { ok: respuesta.ok && datos.ok, status: respuesta.status, datos };
}

// ---------------------------------------------------------------------
// Pantalla de administracion (Inventario -> Exhibidores)
// ---------------------------------------------------------------------

async function mostrarExhibidores() {
    if (typeof ocultarPantallasPrincipales === "function") ocultarPantallasPrincipales();

    const pantalla = document.getElementById("pantallaExhibidores");
    if (!pantalla) return;

    pantalla.style.display = "block";

    if (typeof actualizarTopbarContexto === "function") {
        actualizarTopbarContexto("Exhibidores", "Arma tus displays y vende con tarjetas visuales", "exhibidores");
    }

    exhibidorEditando = null;
    pantalla.innerHTML = `<div class="exh-shell"><div class="exh-vacio">Cargando exhibidores...</div></div>`;

    const { ok, datos } = await exhLlamar("/exhibidores");
    exhibidoresLista = ok ? datos.exhibidores : [];
    renderListaExhibidores();
}

function renderListaExhibidores() {
    const pantalla = document.getElementById("pantallaExhibidores");
    if (!pantalla) return;

    const tarjetas = exhibidoresLista.map(item => {
        const fotos = (item.vistaPrevia || []).map(id => `<span class="exh-mini">${exhMiniatura(id, "")}</span>`).join("");
        const estado = item.agotados > 0
            ? `<span class="exh-chip exh-chip-alerta">${item.agotados} agotado${item.agotados === 1 ? "" : "s"}</span>`
            : (item.totalEspacios > 0 ? `<span class="exh-chip exh-chip-ok">Surtido</span>` : "");

        return `
        <article class="exh-card exh-color-${exhEscapar(item.color)}${item.activo ? "" : " exh-inactivo"}">
            <div class="exh-card-banda">
                <strong>${exhEscapar(item.nombre)}</strong>
                <span>${item.totalEspacios} producto${item.totalEspacios === 1 ? "" : "s"}</span>
            </div>
            <div class="exh-card-fotos">${fotos || '<span class="exh-card-vacio">Sin productos todavia</span>'}</div>
            <div class="exh-card-pie">
                ${estado}
                <div class="exh-card-acciones">
                    <button type="button" class="exh-btn exh-btn-suave" onclick="abrirEditorExhibidor(${item.id})">Editar</button>
                    <button type="button" class="exh-btn exh-btn-suave" onclick="abrirRecibirExhibidor(${item.id})" ${item.totalEspacios ? "" : "disabled"}>Recibir</button>
                    <button type="button" class="exh-btn exh-btn-suave" onclick="abrirSurtirExhibidor(${item.id})" ${item.totalEspacios ? "" : "disabled"}>Surtir</button>
                    <button type="button" class="exh-btn exh-btn-primario" onclick="abrirExhibidorPOS(${item.id})" ${item.totalEspacios ? "" : "disabled"}>Vender</button>
                </div>
            </div>
        </article>`;
    }).join("");

    pantalla.innerHTML = `
    <div class="exh-shell">
        <div class="exh-header">
            <div>
                <h2>Exhibidores</h2>
                <p>${exhEsAbarrotes()
                    ? "Botanas, dulces, galletas, refrescos... Arma cada exhibidor una vez, surte lo que falta cuando pasa el proveedor y vende con tarjetas: tocas el producto y se agrega al carrito."
                    : "Despachador de brocas, exhibidor de lijas, rack de dulces... Arma el display una vez y vende con tarjetas: tocas el producto y se agrega al carrito."}</p>
            </div>
            <button type="button" class="exh-btn exh-btn-primario" onclick="nuevoExhibidor()">+ Nuevo exhibidor</button>
        </div>
        ${exhibidoresLista.length === 0 ? `
        <div class="exh-vacio-grande">
            <div class="exh-vacio-icono">🗄️</div>
            <h3>Aun no tienes exhibidores</h3>
            <p>Crea el primero: ponle nombre, elige su color y agrega los productos que lleva. Despues lo vendes desde el Punto de Venta con un toque por producto.</p>
            ${exhEsAbarrotes() ? `
            <p class="exh-sugeridos-titulo">Empieza con uno de estos:</p>
            <div class="exh-sugeridos">${EXHIBIDORES_SUGERIDOS_ABARROTES.map(nombre => `<button type="button" class="exh-btn exh-btn-suave" onclick="nuevoExhibidor('${nombre}')">${nombre}</button>`).join("")}</div>` : ""}
            <button type="button" class="exh-btn exh-btn-primario" onclick="nuevoExhibidor()">Crear mi primer exhibidor</button>
        </div>` :`<div class="exh-grid">${tarjetas}</div>`}
    </div>`;
}

// Abarrotes: los exhibidores son los de la tienda (botanas, dulces, refrescos...), no un despachador de brocas.
const EXHIBIDORES_SUGERIDOS_ABARROTES = ["Botanas", "Dulces", "Galletas", "Refrescos", "Pan", "Lácteos"];

function exhEsAbarrotes() {
    return typeof perfilEsSimple === "function" && perfilEsSimple();
}

async function nuevoExhibidor(nombreSugerido) {
    const nombre = typeof nombreSugerido === "string"
        ? nombreSugerido
        : typeof pedirTextoPOS === "function"
            ? await pedirTextoPOS(exhEsAbarrotes() ? "Nombre del exhibidor (ej. Botanas, Dulces del mostrador)" : "Nombre del exhibidor (ej. Despachador de brocas)", "", "Nuevo exhibidor")
            : prompt("Nombre del exhibidor");

    if (!nombre || !String(nombre).trim()) return;

    const { ok, datos } = await exhLlamar("/exhibidores", {
        method: "POST",
        body: JSON.stringify({ nombre: String(nombre).trim(), color: EXHIBIDOR_COLORES[exhibidoresLista.length % EXHIBIDOR_COLORES.length] })
    });

    if (!ok) {
        alertaPOS(datos.error || "No se pudo crear el exhibidor.", "Error", "peligro");
        return;
    }

    exhibidorEditando = datos.exhibidor;
    renderEditorExhibidor();
}

async function abrirEditorExhibidor(id) {
    const { ok, datos } = await exhLlamar(`/exhibidores/${id}`);

    if (!ok) {
        alertaPOS(datos.error || "No se pudo abrir el exhibidor.", "Error", "peligro");
        return;
    }

    exhibidorEditando = datos.exhibidor;
    renderEditorExhibidor();
}

function renderEditorExhibidor() {
    const pantalla = document.getElementById("pantallaExhibidores");
    const x = exhibidorEditando;
    if (!pantalla || !x) return;

    const colores = EXHIBIDOR_COLORES.map(c =>
        `<button type="button" class="exh-swatch exh-color-${c}${c === x.color ? " activo" : ""}" aria-label="Color ${c}" onclick="cambiarColorExhibidor('${c}')"></button>`
    ).join("");

    const espacios = x.espacios.map(e => {
        const estado = e.existencia <= 0 ? "agotado" : (e.capacidad > 0 && e.existencia < e.capacidad / 2 ? "bajo" : "ok");
        return `
        <div class="exh-espacio exh-${estado}">
            <button type="button" class="exh-espacio-quitar" aria-label="Quitar del exhibidor" onclick="quitarEspacioExhibidor(${e.id})">&times;</button>
            <div class="exh-espacio-foto">${exhMiniatura(e.productoId, e.nombre)}</div>
            <strong class="exh-espacio-nombre">${exhEscapar(e.nombre)}</strong>
            <span class="exh-espacio-meta">${exhEscapar(e.codigo || "")} · ${exhDinero(e.precio)}</span>
            <span class="exh-espacio-existencia">${e.existencia <= 0 ? "Agotado" : `${Number(e.existencia.toFixed(3))} en existencia`}${e.faltan > 0 ? ` · faltan ${e.faltan}` : ""}</span>
            <div class="exh-espacio-campos">
                <label>Lugar
                    <input type="text" value="${exhEscapar(e.etiqueta)}" maxlength="80" placeholder="Ej. Cajon 1" onchange="guardarEspacioExhibidor(${e.id}, { etiqueta: this.value })">
                </label>
                <label>Capacidad
                    <input type="number" min="0" step="1" value="${e.capacidad || ""}" placeholder="0" onchange="guardarEspacioExhibidor(${e.id}, { capacidad: this.value })">
                </label>
            </div>
        </div>`;
    }).join("");

    pantalla.innerHTML = `
    <div class="exh-shell">
        <div class="exh-header">
            <div>
                <button type="button" class="exh-enlace" onclick="mostrarExhibidores()">&larr; Todos los exhibidores</button>
                <h2>${exhEscapar(x.nombre)}</h2>
            </div>
            <div class="exh-header-acciones">
                <button type="button" class="exh-btn exh-btn-suave" onclick="abrirRecibirExhibidor(${x.id})" ${x.espacios.length ? "" : "disabled"}>Recibir mercancia</button>
                <button type="button" class="exh-btn exh-btn-suave" onclick="abrirSurtirExhibidor(${x.id})" ${x.espacios.length ? "" : "disabled"}>Surtir</button>
                <button type="button" class="exh-btn exh-btn-primario" onclick="abrirExhibidorPOS(${x.id})" ${x.espacios.length ? "" : "disabled"}>Probar venta</button>
                <button type="button" class="exh-btn exh-btn-peligro" onclick="eliminarExhibidor()">Eliminar</button>
            </div>
        </div>

        <section class="exh-panel">
            <div class="exh-datos">
                <label>Nombre
                    <input id="exhNombre" type="text" value="${exhEscapar(x.nombre)}" maxlength="140" onchange="guardarDatosExhibidor()">
                </label>
                <label>Descripcion
                    <input id="exhDescripcion" type="text" value="${exhEscapar(x.descripcion)}" maxlength="500" placeholder="Opcional" onchange="guardarDatosExhibidor()">
                </label>
                <div class="exh-colores"><span>Color</span>${colores}</div>
            </div>
        </section>

        <section class="exh-panel">
            <h3>Agregar productos al exhibidor</h3>
            <div class="exh-buscador">
                <input id="exhBuscarProducto" type="search" autocomplete="off" placeholder="Busca por nombre, codigo o marca..." oninput="buscarProductoParaExhibidor(this.value)">
                <div id="exhResultadosBusqueda" class="exh-resultados" hidden></div>
            </div>
        </section>

        <section class="exh-panel">
            <h3>Productos del exhibidor <span class="exh-contador">${x.espacios.length}</span></h3>
            ${x.espacios.length === 0
                ? '<div class="exh-vacio">Busca arriba y agrega los productos que lleva este exhibidor.</div>'
                : `<div class="exh-espacios">${espacios}</div>`}
        </section>
    </div>`;
}

function buscarProductoParaExhibidor(texto) {
    const contenedor = document.getElementById("exhResultadosBusqueda");
    if (!contenedor || !exhibidorEditando) return;

    const consulta = exhNormalizar(texto).trim();

    if (consulta.length < 2) {
        exhBusquedaCatalogo.tanda++;
        contenedor.hidden = true;
        contenedor.innerHTML = "";
        return;
    }

    const yaEstan = new Set(exhibidorEditando.espacios.map(e => Number(e.productoId)));
    const palabras = consulta.split(/\s+/);

    const encontrados = (typeof todosProductos !== "undefined" ? todosProductos : [])
        .filter(p => !yaEstan.has(Number(p.id)) && Number(p.id) > 0)
        .filter(p => {
            const base = exhNormalizar(`${p.nombre} ${p.codigo || ""} ${p.marca || ""}`);
            return palabras.every(palabra => base.includes(palabra));
        })
        .slice(0, 8);

    // Inventario al instante; el catalogo de proveedor llega unos instantes
    // despues (la tanda mas reciente gana, asi una respuesta lenta de una
    // busqueda vieja nunca pisa a la actual).
    exhBusquedaCatalogo.inventario = encontrados;
    exhBusquedaCatalogo.catalogo = null;
    exhBusquedaCatalogo.consulta = texto;
    exhBusquedaCatalogo.tanda++;
    pintarResultadosExhibidor();

    const tanda = exhBusquedaCatalogo.tanda;
    clearTimeout(exhBusquedaCatalogo.temporizador);
    exhBusquedaCatalogo.temporizador = setTimeout(async () => {
        const { ok, datos } = await exhLlamar(`/exhibidores/buscar-catalogo?q=${encodeURIComponent(texto.trim())}`);
        if (tanda !== exhBusquedaCatalogo.tanda) return;
        exhBusquedaCatalogo.catalogo = ok ? datos.resultados : [];
        pintarResultadosExhibidor();
    }, 300);
}

const exhBusquedaCatalogo = { inventario: [], catalogo: null, consulta: "", tanda: 0, temporizador: null };

function pintarResultadosExhibidor() {
    const contenedor = document.getElementById("exhResultadosBusqueda");
    if (!contenedor || !exhibidorEditando) return;

    const yaEstan = new Set(exhibidorEditando.espacios.map(e => Number(e.productoId)));
    const enInventario = new Set(exhBusquedaCatalogo.inventario.map(p => Number(p.id)));

    const filasInventario = exhBusquedaCatalogo.inventario.map(p => `
        <button type="button" class="exh-resultado" onclick="agregarProductoAExhibidor(${Number(p.id)})">
            <span class="exh-resultado-foto">${exhMiniatura(p.id, p.nombre)}</span>
            <span class="exh-resultado-texto"><strong>${exhEscapar(p.nombre)}</strong><small>${exhEscapar(p.codigo || "")} · ${exhDinero(typeof precioVentaProducto === "function" ? precioVentaProducto(p) : p.precio)}</small></span>
            <span class="exh-resultado-mas">+</span>
        </button>`).join("");

    // Del catalogo: se omite lo que ya salio arriba (mismo producto del inventario) o ya esta en el exhibidor.
    const delCatalogo = (exhBusquedaCatalogo.catalogo || []).filter(r =>
        !(r.productoId && (yaEstan.has(Number(r.productoId)) || enInventario.has(Number(r.productoId))))
    );

    const filasCatalogo = delCatalogo.map(r => `
        <button type="button" class="exh-resultado exh-resultado-catalogo" onclick="agregarDesdeCatalogoAExhibidor(${Number(r.catalogoId)}, ${Number(r.catalogoProductoId)}, ${Number(r.productoId) || 0})">
            <span class="exh-resultado-foto"><span class="exh-sin-foto" aria-hidden="true">${exhEscapar(String(r.nombre || "?").charAt(0).toUpperCase())}</span></span>
            <span class="exh-resultado-texto">
                <strong>${exhEscapar(r.nombre)}</strong>
                <small>${exhEscapar(r.codigo)} · ${exhDinero(r.precio)} · ${exhEscapar(r.proveedor || "catalogo")}</small>
            </span>
            <span class="exh-resultado-etiqueta">${r.productoId ? "Agregar" : "Agregar al inventario"}</span>
        </button>`).join("");

    const cargandoCatalogo = exhBusquedaCatalogo.catalogo === null;

    contenedor.hidden = false;
    contenedor.innerHTML = `
        ${filasInventario ? `<div class="exh-grupo-titulo">En tu inventario</div>${filasInventario}` : ""}
        ${filasCatalogo ? `<div class="exh-grupo-titulo">En el catalogo de tus proveedores</div>${filasCatalogo}` : ""}
        ${cargandoCatalogo ? '<div class="exh-resultado-vacio">Buscando en tus catalogos...</div>' : ""}
        ${!cargandoCatalogo && !filasInventario && !filasCatalogo ? '<div class="exh-resultado-vacio">No encontramos nada con eso (o ya esta en el exhibidor). Prueba con el codigo o parte del nombre.</div>' : ""}`;
}

// Producto que esta en el catalogo del proveedor pero aun no en el inventario:
// se crea con la ruta ya probada de catalogo-proveedor (existencia 0, precio del
// catalogo, vinculado al proveedor) y luego se mete al exhibidor.
async function agregarDesdeCatalogoAExhibidor(catalogoId, catalogoProductoId, productoId) {
    if (!exhibidorEditando) return;

    if (productoId) {
        await agregarProductoAExhibidor(productoId);
        return;
    }

    const creado = await exhLlamar(`/catalogo-proveedor/${catalogoId}/productos/${catalogoProductoId}/crear-producto`, { method: "POST" });

    if (!creado.ok || !creado.datos.productoId) {
        alertaPOS(creado.datos.error || "No se pudo agregar el producto al inventario.", "Error", "peligro");
        return;
    }

    // Refresca el inventario en memoria para que el nuevo producto traiga foto y precio.
    if (typeof cargarProductos === "function") {
        try { await cargarProductos(); } catch (error) { /* el exhibidor lo resuelve en vivo */ }
    }

    await agregarProductoAExhibidor(creado.datos.productoId);
    alertaPOS("Se agrego al inventario con existencia 0 y al exhibidor. Registra su compra para darle existencia.", "Producto agregado", "exito");
}

async function agregarProductoAExhibidor(productoId) {
    if (!exhibidorEditando) return;

    const { ok, datos } = await exhLlamar(`/exhibidores/${exhibidorEditando.id}/espacios`, {
        method: "POST",
        body: JSON.stringify({ productoId })
    });

    if (!ok) {
        alertaPOS(datos.error || "No se pudo agregar el producto.", "Error", "peligro");
        return;
    }

    exhibidorEditando = datos.exhibidor;
    renderEditorExhibidor();
    document.getElementById("exhBuscarProducto")?.focus();
}

async function guardarEspacioExhibidor(espacioId, cambios) {
    if (!exhibidorEditando) return;

    const { ok, datos } = await exhLlamar(`/exhibidores/${exhibidorEditando.id}/espacios/${espacioId}`, {
        method: "PATCH",
        body: JSON.stringify(cambios)
    });

    if (!ok) {
        alertaPOS(datos.error || "No se pudo guardar el cambio.", "Error", "peligro");
        return;
    }

    exhibidorEditando = datos.exhibidor;
    renderEditorExhibidor();
}

async function quitarEspacioExhibidor(espacioId) {
    if (!exhibidorEditando) return;

    const { ok, datos } = await exhLlamar(`/exhibidores/${exhibidorEditando.id}/espacios/${espacioId}`, { method: "DELETE" });

    if (!ok) {
        alertaPOS(datos.error || "No se pudo quitar el producto.", "Error", "peligro");
        return;
    }

    exhibidorEditando = datos.exhibidor;
    renderEditorExhibidor();
}

async function guardarDatosExhibidor() {
    if (!exhibidorEditando) return;

    const nombre = document.getElementById("exhNombre")?.value || "";
    const descripcion = document.getElementById("exhDescripcion")?.value || "";

    const { ok, datos } = await exhLlamar(`/exhibidores/${exhibidorEditando.id}`, {
        method: "PATCH",
        body: JSON.stringify({ nombre, descripcion })
    });

    if (!ok) {
        alertaPOS(datos.error || "No se pudo guardar.", "Error", "peligro");
        document.getElementById("exhNombre").value = exhibidorEditando.nombre;
        return;
    }

    exhibidorEditando = datos.exhibidor;
    renderEditorExhibidor();
}

async function cambiarColorExhibidor(color) {
    if (!exhibidorEditando) return;

    const { ok, datos } = await exhLlamar(`/exhibidores/${exhibidorEditando.id}`, {
        method: "PATCH",
        body: JSON.stringify({ color })
    });

    if (ok) {
        exhibidorEditando = datos.exhibidor;
        renderEditorExhibidor();
    }
}

async function eliminarExhibidor() {
    if (!exhibidorEditando) return;

    const confirmado = await confirmarPOS(
        `Se elimina el exhibidor "${exhibidorEditando.nombre}". Tus productos y su inventario NO se tocan.`,
        "Eliminar exhibidor",
        "alerta"
    );

    if (!confirmado) return;

    const { ok, datos } = await exhLlamar(`/exhibidores/${exhibidorEditando.id}`, { method: "DELETE" });

    if (!ok) {
        alertaPOS(datos.error || "No se pudo eliminar.", "Error", "peligro");
        return;
    }

    mostrarExhibidores();
}

// ---------------------------------------------------------------------
// Venta visual desde el Punto de Venta
// ---------------------------------------------------------------------

function exhModalPOS() {
    let modal = document.getElementById("modalExhibidorPOS");

    if (!modal) {
        modal = document.createElement("div");
        modal.id = "modalExhibidorPOS";
        modal.className = "exh-modal";
        document.body.appendChild(modal);
    }

    modal.style.display = "flex";
    exhInstalarTeclado();
    return modal;
}

// ---------------------------------------------------------------------
// Teclado en el exhibidor del Punto de Venta:
//   izquierda/derecha  te mueves entre tarjetas
//   arriba/abajo       sube o baja la cantidad que quieres de esa tarjeta
//   Enter              pone esa cantidad en el carrito (1 si no elegiste otra)
// ---------------------------------------------------------------------

let exhTecladoInstalado = false;
let exhTileActivo = 0;
let exhPendientes = {};

function exhTilesPOS() {
    return [...document.querySelectorAll("#modalExhibidorPOS .exh-tile")];
}

function exhMarcarTileActivo(desplazar = true) {
    const tiles = exhTilesPOS();
    if (!tiles.length) return;

    exhTileActivo = Math.min(Math.max(exhTileActivo, 0), tiles.length - 1);
    tiles.forEach((tile, i) => tile.classList.toggle("exh-tile-activa", i === exhTileActivo));

    if (desplazar) tiles[exhTileActivo].scrollIntoView({ block: "nearest", inline: "nearest" });
}

function exhIdTileActivo() {
    const tile = exhTilesPOS()[exhTileActivo];
    return tile ? Number(tile.dataset.productoId) : null;
}

function exhCambiarPendiente(productoId, delta) {
    const nuevo = Math.max(0, (exhPendientes[productoId] || 0) + delta);

    if (nuevo > 0) exhPendientes[productoId] = nuevo;
    else delete exhPendientes[productoId];

    exhActualizarTilePOS(productoId);
}

function exhConfirmarTile(productoId) {
    const cantidad = exhPendientes[productoId] || 1;
    delete exhPendientes[productoId];

    for (let i = 0; i < cantidad; i++) agregarDesdeExhibidor(productoId);
}

function exhInstalarTeclado() {
    if (exhTecladoInstalado) return;
    exhTecladoInstalado = true;

    document.addEventListener("keydown", evento => {
        const modal = document.getElementById("modalExhibidorPOS");
        if (!modal || modal.style.display === "none" || !exhibidorPOSActual) return;

        const escribiendo = evento.target.matches?.("input, textarea, select");

        // En el buscador las flechas son del cursor; abajo te lleva a las tarjetas.
        if (escribiendo) {
            if (evento.target.id === "exhFiltroPOS" && evento.key === "ArrowDown") {
                evento.preventDefault();
                evento.target.blur();
                exhMarcarTileActivo();
            }
            return;
        }

        const id = exhIdTileActivo();

        switch (evento.key) {
            case "ArrowRight": exhTileActivo++; exhMarcarTileActivo(); break;
            case "ArrowLeft": exhTileActivo--; exhMarcarTileActivo(); break;
            case "ArrowUp": if (id) exhCambiarPendiente(id, 1); break;
            case "ArrowDown": if (id) exhCambiarPendiente(id, -1); break;
            case "Enter": if (id) exhConfirmarTile(id); break;
            case "Escape": cerrarExhibidorPOS(); break;
            default: return;
        }

        evento.preventDefault();
    });
}

function cerrarExhibidorPOS() {
    const modal = document.getElementById("modalExhibidorPOS");
    if (modal) modal.style.display = "none";
    exhibidorPOSActual = null;
}

async function abrirExhibidorPOS(id) {
    const modal = exhModalPOS();
    exhibidorPOSAgregados = 0;
    exhPendientes = {};
    exhTileActivo = 0;

    modal.innerHTML = `<div class="exh-modal-card"><div class="exh-vacio">Cargando...</div></div>`;

    if (id) {
        const { ok, datos } = await exhLlamar(`/exhibidores/${id}`);

        if (!ok) {
            cerrarExhibidorPOS();
            alertaPOS(datos.error || "No se pudo abrir el exhibidor.", "Error", "peligro");
            return;
        }

        exhibidorPOSActual = datos.exhibidor;
        renderExhibidorPOS();
        return;
    }

    const { ok, datos } = await exhLlamar("/exhibidores");
    const lista = (ok ? datos.exhibidores : []).filter(item => item.activo && item.totalEspacios > 0);

    exhibidorPOSActual = null;

    modal.innerHTML = `
    <div class="exh-modal-card">
        <div class="exh-modal-cabecera">
            <div><span>Punto de venta</span><h3>Elige un exhibidor</h3></div>
            <button type="button" class="exh-btn exh-btn-suave" onclick="cerrarExhibidorPOS()">Cerrar</button>
        </div>
        ${lista.length === 0
            ? '<div class="exh-vacio">Todavia no tienes exhibidores con productos. Crealos en Inventario &rarr; Exhibidores.</div>'
            : `<div class="exh-grid exh-grid-selector">${lista.map(item => `
                <button type="button" class="exh-card exh-card-boton exh-color-${exhEscapar(item.color)}" onclick="abrirExhibidorPOS(${item.id})">
                    <div class="exh-card-banda"><strong>${exhEscapar(item.nombre)}</strong><span>${item.totalEspacios} producto${item.totalEspacios === 1 ? "" : "s"}</span></div>
                    <div class="exh-card-fotos">${(item.vistaPrevia || []).map(pid => `<span class="exh-mini">${exhMiniatura(pid, "")}</span>`).join("")}</div>
                </button>`).join("")}</div>`}
    </div>`;
}

function exhCantidadEnCarrito(productoId) {
    if (typeof carrito === "undefined" || !Array.isArray(carrito)) return 0;

    return carrito
        .filter(item => Number(item.id) === Number(productoId))
        .reduce((suma, item) => suma + Number(item.cantidad || 0), 0);
}

function exhTextoAyudaPOS() {
    const n = exhibidorPOSAgregados;
    return `${n ? `${n} toque${n === 1 ? "" : "s"} agregado${n === 1 ? "" : "s"} al carrito` : "Toca una tarjeta para agregarla al carrito"} &middot; <b>&larr; &rarr;</b> moverte &middot; <b>&uarr; &darr;</b> cantidad &middot; <b>Enter</b> al carrito`;
}

// Cambia SOLO la tarjeta tocada (contador del carrito y cantidad pendiente) en vez de volver a dibujar toda la
// ventana: redibujarla recargaba todas las fotos y se veia como un parpadeo en cada toque.
function exhActualizarTilePOS(productoId) {
    const tile = document.querySelector(`#modalExhibidorPOS .exh-tile[data-producto-id="${productoId}"]`);

    if (tile) {
        const enCarrito = exhCantidadEnCarrito(productoId);
        let cuenta = tile.querySelector(".exh-tile-cuenta");

        if (enCarrito > 0) {
            if (!cuenta) {
                cuenta = document.createElement("span");
                cuenta.className = "exh-tile-cuenta";
                tile.prepend(cuenta);
            }
            cuenta.textContent = Number(enCarrito.toFixed(3));
        } else if (cuenta) {
            cuenta.remove();
        }

        const pendiente = exhPendientes[productoId] || 0;
        let chip = tile.querySelector(".exh-tile-pend");

        if (pendiente > 0) {
            if (!chip) {
                chip = document.createElement("span");
                chip.className = "exh-tile-pend";
                chip.title = "Enter la pone en el carrito";
                tile.prepend(chip);
            }
            chip.innerHTML = `&times;${pendiente}`;
        } else if (chip) {
            chip.remove();
        }
    }

    const ayuda = document.querySelector("#modalExhibidorPOS .exh-modal-ayuda");
    if (ayuda) ayuda.innerHTML = exhTextoAyudaPOS();
}

function renderExhibidorPOS(filtro = "") {
    const modal = document.getElementById("modalExhibidorPOS");
    const x = exhibidorPOSActual;
    if (!modal || !x) return;

    const consulta = exhNormalizar(filtro).trim();

    const tarjetas = x.espacios
        .filter(e => !consulta || exhNormalizar(`${e.nombre} ${e.codigo} ${e.etiqueta}`).includes(consulta))
        .map(e => {
            const local = exhProducto(e.productoId);
            const precio = local && typeof precioVentaProducto === "function" ? precioVentaProducto(local) : e.precio;
            const stock = local ? Number(local.stock) : e.existencia;
            const agotado = stock <= 0;
            const enCarrito = exhCantidadEnCarrito(e.productoId);

            return `
            <button type="button" class="exh-tile${agotado ? " exh-tile-agotado" : ""}" data-producto-id="${e.productoId}" onclick="agregarDesdeExhibidor(${e.productoId})" ${local ? "" : "disabled"}>
                ${exhPendientes[e.productoId] ? `<span class="exh-tile-pend" title="Enter la pone en el carrito">&times;${exhPendientes[e.productoId]}</span>` : ""}
                ${enCarrito > 0 ? `<span class="exh-tile-cuenta">${Number(enCarrito.toFixed(3))}</span>` : ""}
                <span class="exh-tile-foto">${exhMiniatura(e.productoId, e.nombre)}</span>
                ${e.etiqueta ? `<span class="exh-tile-lugar">${exhEscapar(e.etiqueta)}</span>` : ""}
                <strong class="exh-tile-nombre">${exhEscapar(e.nombre)}</strong>
                <span class="exh-tile-precio">${exhDinero(precio)}</span>
                <span class="exh-tile-stock ${agotado ? "sin" : (stock <= 3 ? "poco" : "ok")}">${agotado ? "Agotado" : `${Number(stock.toFixed(3))} disp.`}</span>
            </button>`;
        }).join("");

    modal.innerHTML = `
    <div class="exh-modal-card exh-color-${exhEscapar(x.color)}">
        <div class="exh-modal-cabecera exh-modal-cabecera-color">
            <div><span>Punto de venta &middot; exhibidor</span><h3>${exhEscapar(x.nombre)}</h3></div>
            <div class="exh-modal-acciones">
                <button type="button" class="exh-btn exh-btn-claro" onclick="abrirExhibidorPOS()">Cambiar</button>
                <button type="button" class="exh-btn exh-btn-claro" onclick="cerrarExhibidorPOS()">${exhibidorPOSAgregados ? "Listo" : "Cerrar"}</button>
            </div>
        </div>
        <div class="exh-modal-busqueda">
            <input id="exhFiltroPOS" type="search" autocomplete="off" placeholder="Buscar en este exhibidor..." value="${exhEscapar(filtro)}" oninput="filtrarExhibidorPOS(this.value)">
            <span class="exh-modal-ayuda">${exhTextoAyudaPOS()}</span>
        </div>
        <div class="exh-tiles">${tarjetas || '<div class="exh-vacio">Nada coincide con esa busqueda.</div>'}</div>
    </div>`;

    exhMarcarTileActivo(false);
}

function filtrarExhibidorPOS(texto) {
    renderExhibidorPOS(texto);
    const input = document.getElementById("exhFiltroPOS");
    if (input) {
        input.focus();
        input.setSelectionRange(input.value.length, input.value.length);
    }
}

function agregarDesdeExhibidor(productoId) {
    if (typeof agregarProductoPorId !== "function") return;

    agregarProductoPorId(productoId);
    exhibidorPOSAgregados++;
    exhActualizarTilePOS(productoId);
}

// ---------------------------------------------------------------------
// Recibir mercancia por exhibidor y Surtir lo que falta
//
// Recibir NO tiene logica propia de inventario: arma las lineas y las manda a
// POST /recepciones-mercancia/rapida (la misma ruta de la recepcion rapida del
// celular), que suma el stock en una transaccion con la fila bloqueada, deja
// historial + ajuste de inventario y no se duplica si se manda dos veces.
// Surtir solo LEE: calcula lo que falta (capacidad - existencia) y, si se
// quiere, crea un pedido a proveedor en BORRADOR (nada se envia solo).
// ---------------------------------------------------------------------

let exhRecibo = null;

function exhModal(id) {
    let modal = document.getElementById(id);

    if (!modal) {
        modal = document.createElement("div");
        modal.id = id;
        modal.className = "exh-modal";
        document.body.appendChild(modal);
    }

    modal.style.display = "flex";
    return modal;
}

function cerrarExhModal(id) {
    const modal = document.getElementById(id);
    if (modal) modal.style.display = "none";
}

function exhLlaveUnica() {
    return (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : `exh-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function exhEntero(valor) {
    const numero = Math.floor(Number(valor));
    return Number.isFinite(numero) && numero > 0 ? Math.min(numero, 100000) : 0;
}

async function abrirRecibirExhibidor(id) {
    const modal = exhModal("modalExhibidorRecibir");
    modal.innerHTML = `<div class="exh-modal-card"><div class="exh-vacio">Cargando...</div></div>`;

    const { ok, datos } = await exhLlamar(`/exhibidores/${id}`);

    if (!ok) {
        cerrarExhModal("modalExhibidorRecibir");
        alertaPOS(datos.error || "No se pudo abrir el exhibidor.", "Error", "peligro");
        return;
    }

    exhRecibo = { exhibidor: datos.exhibidor, lineas: {}, referencia: "", llave: exhLlaveUnica(), enviando: false };
    renderRecibirExhibidor();
}

function exhTextoRecibirResumen(totalPiezas) {
    return totalPiezas > 0 ? `<strong>${totalPiezas}</strong> pieza${totalPiezas === 1 ? "" : "s"} por recibir` : "Aun no capturas cantidades";
}

// Actualiza cantidades, tarjetas marcadas y el total sin volver a dibujar la ventana (sin parpadeo de fotos).
function exhRecibirPintar() {
    const modal = document.getElementById("modalExhibidorRecibir");
    const r = exhRecibo;
    if (!modal || !r) return;

    modal.querySelectorAll(".exh-recibir-tile").forEach(tarjeta => {
        const linea = r.lineas[Number(tarjeta.dataset.productoId)] || { cantidad: 0 };
        const campo = tarjeta.querySelector(".exh-stepper input");

        if (campo && document.activeElement !== campo) campo.value = linea.cantidad || "";
        tarjeta.classList.toggle("exh-recibir-activa", linea.cantidad > 0);
    });

    const totalPiezas = Object.values(r.lineas).reduce((suma, linea) => suma + (linea.cantidad || 0), 0);
    const resumen = modal.querySelector(".exh-recibir-resumen");
    const boton = modal.querySelector(".exh-recibir-confirmar");

    if (resumen) resumen.innerHTML = exhTextoRecibirResumen(totalPiezas);
    if (boton) boton.disabled = !(totalPiezas > 0 && !r.enviando);
}

function renderRecibirExhibidor() {
    const modal = document.getElementById("modalExhibidorRecibir");
    const r = exhRecibo;
    if (!modal || !r) return;

    const x = r.exhibidor;
    const totalPiezas = Object.values(r.lineas).reduce((suma, linea) => suma + (linea.cantidad || 0), 0);

    const tarjetas = x.espacios.map(e => {
        const linea = r.lineas[e.productoId] || { cantidad: 0, costo: "" };

        return `
        <div class="exh-tile exh-recibir-tile${linea.cantidad > 0 ? " exh-recibir-activa" : ""}" data-producto-id="${e.productoId}">
            <span class="exh-tile-foto">${exhMiniatura(e.productoId, e.nombre)}</span>
            ${e.etiqueta ? `<span class="exh-tile-lugar">${exhEscapar(e.etiqueta)}</span>` : ""}
            <strong class="exh-tile-nombre">${exhEscapar(e.nombre)}</strong>
            <span class="exh-tile-stock ${e.existencia <= 0 ? "sin" : "ok"}">${e.existencia <= 0 ? "Agotado" : `${Number(e.existencia.toFixed(3))} en existencia`}${e.faltan > 0 ? ` · faltan ${e.faltan}` : ""}</span>
            <div class="exh-stepper">
                <button type="button" aria-label="Quitar uno" onclick="exhRecibirCambiar(${e.productoId}, -1)">&minus;</button>
                <input type="number" min="0" step="1" value="${linea.cantidad || ""}" placeholder="0" onchange="exhRecibirFijar(${e.productoId}, this.value)">
                <button type="button" aria-label="Agregar uno" onclick="exhRecibirCambiar(${e.productoId}, 1)">+</button>
            </div>
            <label class="exh-recibir-costo">Costo c/u (opcional)
                <input type="number" min="0" step="0.01" value="${linea.costo}" placeholder="0.00" onchange="exhRecibirCosto(${e.productoId}, this.value)">
            </label>
        </div>`;
    }).join("");

    modal.innerHTML = `
    <div class="exh-modal-card exh-color-${exhEscapar(x.color)}">
        <div class="exh-modal-cabecera exh-modal-cabecera-color">
            <div><span>Recibir mercancia &middot; exhibidor</span><h3>${exhEscapar(x.nombre)}</h3></div>
            <div class="exh-modal-acciones">
                <button type="button" class="exh-btn exh-btn-claro" onclick="exhRecibirLlenar()">Llenar lo que falta</button>
                <button type="button" class="exh-btn exh-btn-claro" onclick="cerrarExhModal('modalExhibidorRecibir')">Cerrar</button>
            </div>
        </div>
        <div class="exh-modal-busqueda">
            <input type="text" maxlength="120" placeholder="Factura o remision (opcional)" value="${exhEscapar(r.referencia)}" onchange="exhRecibo.referencia = this.value">
            <span class="exh-modal-ayuda">Pon cuantas piezas llegaron de cada producto. Se suman a tu inventario.</span>
        </div>
        <div class="exh-tiles">${tarjetas || '<div class="exh-vacio">Este exhibidor aun no tiene productos.</div>'}</div>
        <div class="exh-modal-pie">
            <span class="exh-recibir-resumen">${exhTextoRecibirResumen(totalPiezas)}</span>
            <button type="button" class="exh-btn exh-btn-primario exh-recibir-confirmar" onclick="confirmarRecibirExhibidor()" ${totalPiezas > 0 && !r.enviando ? "" : "disabled"}>${r.enviando ? "Recibiendo..." : "Recibir en inventario"}</button>
        </div>
    </div>`;
}

function exhRecibirCambiar(productoId, delta) {
    const linea = exhRecibo.lineas[productoId] || { cantidad: 0, costo: "" };
    linea.cantidad = Math.max(0, Math.min(100000, linea.cantidad + delta));
    exhRecibo.lineas[productoId] = linea;
    exhRecibirPintar();
}

function exhRecibirFijar(productoId, valor) {
    const linea = exhRecibo.lineas[productoId] || { cantidad: 0, costo: "" };
    linea.cantidad = exhEntero(valor);
    exhRecibo.lineas[productoId] = linea;
    exhRecibirPintar();
}

function exhRecibirCosto(productoId, valor) {
    const linea = exhRecibo.lineas[productoId] || { cantidad: 0, costo: "" };
    const costo = Number(valor);
    linea.costo = Number.isFinite(costo) && costo > 0 ? costo : "";
    exhRecibo.lineas[productoId] = linea;
}

function exhRecibirLlenar() {
    exhRecibo.exhibidor.espacios.forEach(e => {
        const linea = exhRecibo.lineas[e.productoId] || { cantidad: 0, costo: "" };
        linea.cantidad = e.faltan > 0 ? exhEntero(Math.ceil(e.faltan)) : 0;
        exhRecibo.lineas[e.productoId] = linea;
    });
    exhRecibirPintar();
}

async function confirmarRecibirExhibidor() {
    const r = exhRecibo;
    if (!r || r.enviando) return;

    const items = Object.entries(r.lineas)
        .filter(([, linea]) => linea.cantidad > 0)
        .map(([productoId, linea]) => ({ productoId: Number(productoId), cantidad: linea.cantidad, costo: linea.costo || 0 }));

    if (items.length === 0) return;

    const totalPiezas = items.reduce((suma, item) => suma + item.cantidad, 0);
    const confirmado = await confirmarPOS(
        `Se suman ${totalPiezas} pieza${totalPiezas === 1 ? "" : "s"} (${items.length} producto${items.length === 1 ? "" : "s"}) al inventario.`,
        "Recibir mercancia",
        "info"
    );

    if (!confirmado) return;

    r.enviando = true;
    renderRecibirExhibidor();

    const { ok, datos } = await exhLlamar("/recepciones-mercancia/rapida", {
        method: "POST",
        body: JSON.stringify({
            referencia: r.referencia,
            notas: `Recibido desde el exhibidor "${r.exhibidor.nombre}"`,
            usuarioNombre: (typeof usuarioActual !== "undefined" && usuarioActual?.nombre) || "",
            idempotencyKey: r.llave,
            items
        })
    });

    r.enviando = false;

    if (!ok) {
        renderRecibirExhibidor();
        alertaPOS(datos.error || "No se pudo registrar la recepcion. No se sumo nada al inventario.", "Error", "peligro");
        return;
    }

    if (typeof cargarProductos === "function") {
        try { await cargarProductos(); } catch (error) { /* el exhibidor lee en vivo del servidor */ }
    }

    cerrarExhModal("modalExhibidorRecibir");
    alertaPOS(`Se recibieron ${totalPiezas} pieza${totalPiezas === 1 ? "" : "s"} en "${r.exhibidor.nombre}".`, "Mercancia recibida", "exito");
    exhRecibo = null;

    if (exhibidorEditando && document.getElementById("pantallaExhibidores")?.style.display !== "none") {
        abrirEditorExhibidor(exhibidorEditando.id);
    }
}

// --- Surtir: lo que falta para llenar el exhibidor -----------------------

let exhSurtido = null;

async function abrirSurtirExhibidor(id) {
    const modal = exhModal("modalExhibidorSurtir");
    modal.innerHTML = `<div class="exh-modal-card"><div class="exh-vacio">Cargando...</div></div>`;

    const { ok, datos } = await exhLlamar(`/exhibidores/${id}`);

    if (!ok) {
        cerrarExhModal("modalExhibidorSurtir");
        alertaPOS(datos.error || "No se pudo abrir el exhibidor.", "Error", "peligro");
        return;
    }

    const filas = datos.exhibidor.espacios
        .filter(e => e.faltan > 0)
        .map(e => {
            const local = exhProducto(e.productoId) || {};
            return {
                productoId: e.productoId,
                nombre: e.nombre,
                codigo: e.codigo || "",
                etiqueta: e.etiqueta,
                existencia: e.existencia,
                capacidad: e.capacidad,
                cantidad: exhEntero(Math.ceil(e.faltan)),
                costo: Number(local.costo || local.precio_distribuidor || 0) || 0,
                proveedor: local.proveedor || ""
            };
        });

    exhSurtido = { exhibidor: datos.exhibidor, filas, sinCapacidad: datos.exhibidor.espacios.filter(e => !(e.capacidad > 0)).length };
    renderSurtirExhibidor();
}

function exhTextoSurtirResumen(totalPiezas) {
    const sinCapacidad = exhSurtido.sinCapacidad;
    return `<strong>${totalPiezas}</strong> pieza${totalPiezas === 1 ? "" : "s"} por pedir${sinCapacidad > 0 ? ` &middot; ${sinCapacidad} producto${sinCapacidad === 1 ? "" : "s"} sin capacidad definida` : ""}`;
}

function renderSurtirExhibidor() {
    const modal = document.getElementById("modalExhibidorSurtir");
    const s = exhSurtido;
    if (!modal || !s) return;

    const x = s.exhibidor;
    const totalPiezas = s.filas.reduce((suma, fila) => suma + fila.cantidad, 0);

    const filas = s.filas.map((fila, i) => `
        <div class="exh-surtir-fila">
            <span class="exh-surtir-foto">${exhMiniatura(fila.productoId, fila.nombre)}</span>
            <span class="exh-surtir-texto">
                <strong>${exhEscapar(fila.nombre)}</strong>
                <small>${exhEscapar(fila.codigo)}${fila.etiqueta ? ` · ${exhEscapar(fila.etiqueta)}` : ""} · tiene ${Number(fila.existencia.toFixed(3))} de ${fila.capacidad}</small>
            </span>
            <input type="number" min="0" step="1" value="${fila.cantidad}" aria-label="Piezas a pedir" onchange="exhSurtirCantidad(${i}, this.value)">
        </div>`).join("");

    const cuerpo = s.filas.length > 0
        ? `<div class="exh-surtir-lista">${filas}</div>`
        : `<div class="exh-vacio">${s.sinCapacidad === x.espacios.length && x.espacios.length > 0
            ? "Ningun producto tiene capacidad definida. Ponla en el editor del exhibidor (\"Capacidad\") para saber cuanto falta."
            : "Este exhibidor esta completo: no falta nada."}</div>`;

    modal.innerHTML = `
    <div class="exh-modal-card exh-color-${exhEscapar(x.color)}">
        <div class="exh-modal-cabecera exh-modal-cabecera-color">
            <div><span>Surtir &middot; exhibidor</span><h3>${exhEscapar(x.nombre)}</h3></div>
            <div class="exh-modal-acciones">
                <button type="button" class="exh-btn exh-btn-claro" onclick="cerrarExhModal('modalExhibidorSurtir')">Cerrar</button>
            </div>
        </div>
        ${cuerpo}
        ${s.filas.length > 0 ? `
        <div class="exh-modal-pie">
            <span class="exh-surtir-resumen">${exhTextoSurtirResumen(totalPiezas)}</span>
            <span class="exh-modal-acciones">
                <button type="button" class="exh-btn exh-btn-suave" onclick="exhSurtirCopiar()">Copiar lista</button>
                <button type="button" class="exh-btn exh-btn-primario exh-surtir-crear" onclick="exhSurtirCrearPedido()" ${totalPiezas > 0 ? "" : "disabled"}>Crear pedido (borrador)</button>
            </span>
        </div>` : ""}
    </div>`;
}

function exhSurtirCantidad(indice, valor) {
    exhSurtido.filas[indice].cantidad = exhEntero(valor);

    const modal = document.getElementById("modalExhibidorSurtir");
    const total = exhSurtido.filas.reduce((suma, fila) => suma + fila.cantidad, 0);
    const resumen = modal && modal.querySelector(".exh-surtir-resumen");
    const crear = modal && modal.querySelector(".exh-surtir-crear");

    if (resumen) resumen.innerHTML = exhTextoSurtirResumen(total);
    if (crear) crear.disabled = !(total > 0);
}

function exhSurtirLineas() {
    return exhSurtido.filas.filter(fila => fila.cantidad > 0);
}

async function exhSurtirCopiar() {
    const texto = `Surtir ${exhSurtido.exhibidor.nombre}:\n` +
        exhSurtirLineas().map(fila => `${fila.cantidad} x ${fila.nombre}${fila.codigo ? ` (${fila.codigo})` : ""}`).join("\n");

    try {
        await navigator.clipboard.writeText(texto);
        alertaPOS("Lista copiada. Pegala donde la necesites (WhatsApp, correo...).", "Lista copiada", "exito");
    } catch (error) {
        alertaPOS("No se pudo copiar automaticamente.", "Copiar lista", "alerta");
    }
}

async function exhSurtirCrearPedido() {
    const lineas = exhSurtirLineas();
    if (lineas.length === 0) return;

    const proveedores = [...new Set(lineas.map(fila => fila.proveedor).filter(Boolean))];

    const { ok, datos } = await exhLlamar("/pedidos-proveedor", {
        method: "POST",
        body: JSON.stringify({
            proveedor: proveedores.length === 1 ? proveedores[0] : "",
            estado: "borrador",
            notas: `Para surtir el exhibidor "${exhSurtido.exhibidor.nombre}"`,
            items: lineas.map(fila => ({
                productoId: fila.productoId,
                codigo: fila.codigo,
                nombre: fila.nombre,
                proveedor: fila.proveedor,
                cantidad: fila.cantidad,
                costo: fila.costo,
                unidad: "pieza"
            }))
        })
    });

    if (!ok && !datos.pedido) {
        alertaPOS(datos.error || "No se pudo crear el pedido.", "Surtir", "peligro");
        return;
    }

    cerrarExhModal("modalExhibidorSurtir");
    alertaPOS("Pedido creado en borrador. Revisalo y enviaselo a tu proveedor desde Compras -> Pedidos a proveedor.", "Pedido creado", "exito");
}

window.mostrarExhibidores = mostrarExhibidores;
window.abrirExhibidorPOS = abrirExhibidorPOS;
