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
    if (producto && typeof miniaturaProducto === "function") {
        return miniaturaProducto(producto);
    }
    return `<span class="exh-sin-foto" aria-hidden="true">${exhEscapar(String(nombre || "?").charAt(0).toUpperCase())}</span>`;
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
                <p>Despachador de brocas, exhibidor de lijas, rack de dulces... Arma el display una vez y vende con tarjetas: tocas el producto y se agrega al carrito.</p>
            </div>
            <button type="button" class="exh-btn exh-btn-primario" onclick="nuevoExhibidor()">+ Nuevo exhibidor</button>
        </div>
        ${exhibidoresLista.length === 0 ? `
        <div class="exh-vacio-grande">
            <div class="exh-vacio-icono">🗄️</div>
            <h3>Aun no tienes exhibidores</h3>
            <p>Crea el primero: ponle nombre, elige su color y agrega los productos que lleva. Despues lo vendes desde el Punto de Venta con un toque por producto.</p>
            <button type="button" class="exh-btn exh-btn-primario" onclick="nuevoExhibidor()">Crear mi primer exhibidor</button>
        </div>` : `<div class="exh-grid">${tarjetas}</div>`}
    </div>`;
}

async function nuevoExhibidor() {
    const nombre = typeof pedirTextoPOS === "function"
        ? await pedirTextoPOS("Nombre del exhibidor (ej. Despachador de brocas)", "", "Nuevo exhibidor")
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
    return modal;
}

function cerrarExhibidorPOS() {
    const modal = document.getElementById("modalExhibidorPOS");
    if (modal) modal.style.display = "none";
    exhibidorPOSActual = null;
}

async function abrirExhibidorPOS(id) {
    const modal = exhModalPOS();
    exhibidorPOSAgregados = 0;

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
            <button type="button" class="exh-tile${agotado ? " exh-tile-agotado" : ""}" onclick="agregarDesdeExhibidor(${e.productoId})" ${local ? "" : "disabled"}>
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
            <span class="exh-modal-ayuda">${exhibidorPOSAgregados ? `${exhibidorPOSAgregados} toque${exhibidorPOSAgregados === 1 ? "" : "s"} agregado${exhibidorPOSAgregados === 1 ? "" : "s"} al carrito` : "Toca una tarjeta para agregarla al carrito"}</span>
        </div>
        <div class="exh-tiles">${tarjetas || '<div class="exh-vacio">Nada coincide con esa busqueda.</div>'}</div>
    </div>`;
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

    const filtro = document.getElementById("exhFiltroPOS")?.value || "";
    renderExhibidorPOS(filtro);
}

window.mostrarExhibidores = mostrarExhibidores;
window.abrirExhibidorPOS = abrirExhibidorPOS;
