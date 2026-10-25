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
                ${item.foto ? `<img class="exh-card-foto" src="${item.foto}" alt="">` : ""}
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
            <div class="exh-header-botones">
                ${exhEsAbarrotes() ? "" : `<button type="button" class="exh-btn exh-btn-suave" onclick="abrirImportarTruper()" title="Trae el exhibidor surtido de Truper con todos sus productos">Importar de Truper</button>`}
                <button type="button" class="exh-btn exh-btn-primario" onclick="nuevoExhibidor()">+ Nuevo exhibidor</button>
            </div>
        </div>
        ${exhEsAbarrotes() ? "" : `
        <div class="exh-plantillas">
            <span>Empieza con una plantilla:</span>
            ${EXHIBIDORES_PLANTILLAS_FERRETERIA.map((p, i) => `<button type="button" class="exh-btn exh-btn-suave" onclick="nuevoExhibidor(EXHIBIDORES_PLANTILLAS_FERRETERIA[${i}].nombre, EXHIBIDORES_PLANTILLAS_FERRETERIA[${i}].buscar)">${exhEscapar(p.nombre)}</button>`).join("")}
        </div>`}
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

// Plantillas de ferreteria: nombre + lo que se busca en tu inventario para llenarlo de un golpe.
const EXHIBIDORES_PLANTILLAS_FERRETERIA = [
    { nombre: "Despachador de brocas", buscar: "broca" },
    { nombre: "Exhibidor de lijas", buscar: "lija" },
    { nombre: "Discos de corte y desbaste", buscar: "disco" },
    { nombre: "Focos y lámparas", buscar: "foco" },
    { nombre: "Pilas y baterías", buscar: "pila" },
    { nombre: "Cintas y adhesivos", buscar: "cinta" },
    { nombre: "Tornillos y pijas", buscar: "tornillo" },
    { nombre: "Candados y chapas", buscar: "candado" }
];

function exhEsAbarrotes() {
    return typeof perfilEsSimple === "function" && perfilEsSimple();
}

async function nuevoExhibidor(nombreSugerido, buscarInicial) {
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

    // Plantilla: ya busca en tu inventario lo que lleva ese exhibidor, listo para "Agregar todos".
    if (buscarInicial) {
        const campo = document.getElementById("exhBuscarProducto");
        if (campo) { campo.value = buscarInicial; buscarProductoParaExhibidor(buscarInicial); }
    }
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

function exhEstadoEspacio(e) {
    return e.existencia <= 0 ? "agotado" : (e.capacidad > 0 && e.existencia < e.capacidad / 2 ? "bajo" : "ok");
}

function exhTextoExistenciaEspacio(e) {
    return `${e.existencia <= 0 ? "Agotado" : `${Number(e.existencia.toFixed(3))} en existencia`}${e.faltan > 0 ? ` · faltan ${e.faltan}` : ""}`;
}

function exhEspacioHtml(e) {
    return `
        <div class="exh-espacio exh-${exhEstadoEspacio(e)}" data-espacio-id="${e.id}">
            <button type="button" class="exh-espacio-quitar" aria-label="Quitar del exhibidor" onclick="quitarEspacioExhibidor(${e.id})">&times;</button>
            <div class="exh-espacio-foto">${exhMiniatura(e.productoId, e.nombre)}</div>
            <strong class="exh-espacio-nombre">${exhEscapar(e.nombre)}</strong>
            <span class="exh-espacio-meta">${exhEscapar(e.codigo || "")} · ${exhDinero(e.precio)}</span>
            <span class="exh-espacio-existencia">${exhTextoExistenciaEspacio(e)}</span>
            <div class="exh-espacio-campos">
                <label>Lugar
                    <input type="text" value="${exhEscapar(e.etiqueta)}" maxlength="80" placeholder="Ej. Cajon 1" onchange="guardarEspacioExhibidor(${e.id}, { etiqueta: this.value })">
                </label>
                <label>Capacidad
                    <input type="number" min="0" step="1" value="${e.capacidad || ""}" placeholder="0" onchange="guardarEspacioExhibidor(${e.id}, { capacidad: this.value })">
                </label>
            </div>
        </div>`;
}

// Actualiza el editor con los datos nuevos cambiando SOLO lo que cambio: agrega, quita o actualiza la tarjeta
// tocada y deja el resto (fotos, buscador, lo que estas escribiendo) donde estaba. Antes cada cambio volvia a
// dibujar toda la pantalla y todas las fotos parpadeaban.
function exhEditorActualizar(nuevo) {
    exhibidorEditando = nuevo;

    const caja = document.getElementById("exhEspaciosCaja");
    if (!caja) {
        renderEditorExhibidor();
        return;
    }

    const x = nuevo;
    const enfocado = document.activeElement;

    // Cabecera y datos
    const titulo = document.getElementById("exhTituloEditor");
    if (titulo) titulo.textContent = x.nombre;

    const campoNombre = document.getElementById("exhNombre");
    if (campoNombre && campoNombre !== enfocado) campoNombre.value = x.nombre;

    const campoDescripcion = document.getElementById("exhDescripcion");
    if (campoDescripcion && campoDescripcion !== enfocado) campoDescripcion.value = x.descripcion || "";

    document.querySelectorAll("#pantallaExhibidores .exh-swatch").forEach(boton => {
        boton.classList.toggle("activo", boton.classList.contains(`exh-color-${x.color}`));
    });

    const vistaFoto = document.getElementById("exhFotoVista");
    if (vistaFoto) {
        if (x.foto) { vistaFoto.src = x.foto; vistaFoto.hidden = false; } else { vistaFoto.hidden = true; vistaFoto.removeAttribute("src"); }
    }
    const quitarFoto = document.getElementById("exhFotoQuitar");
    if (quitarFoto) quitarFoto.hidden = !x.foto;
    const etiquetaFoto = document.querySelector("#pantallaExhibidores .exh-foto-boton");
    if (etiquetaFoto && etiquetaFoto.firstChild) etiquetaFoto.firstChild.textContent = x.foto ? "Cambiar foto" : "Agregar foto";

    document.querySelectorAll("#pantallaExhibidores [data-requiere-espacios]").forEach(boton => {
        boton.disabled = x.espacios.length === 0;
    });

    const contador = document.getElementById("exhContadorEspacios");
    if (contador) contador.textContent = x.espacios.length;

    // Productos: sin ninguno, el aviso; con productos, la cuadricula se acomoda tarjeta por tarjeta.
    if (x.espacios.length === 0) {
        caja.innerHTML = '<div class="exh-vacio">Busca arriba y agrega los productos que lleva este exhibidor.</div>';
        return;
    }

    let cuadricula = caja.querySelector(".exh-espacios");

    if (!cuadricula) {
        caja.innerHTML = '<div class="exh-espacios"></div>';
        cuadricula = caja.querySelector(".exh-espacios");
    }

    const vigentes = new Set(x.espacios.map(e => String(e.id)));
    cuadricula.querySelectorAll(".exh-espacio").forEach(tarjeta => {
        if (!vigentes.has(tarjeta.dataset.espacioId)) tarjeta.remove();
    });

    x.espacios.forEach((e, indice) => {
        let tarjeta = cuadricula.querySelector(`.exh-espacio[data-espacio-id="${e.id}"]`);

        if (!tarjeta) {
            const molde = document.createElement("div");
            molde.innerHTML = exhEspacioHtml(e).trim();
            tarjeta = molde.firstElementChild;
        } else {
            tarjeta.className = `exh-espacio exh-${exhEstadoEspacio(e)}`;
            tarjeta.querySelector(".exh-espacio-existencia").textContent = exhTextoExistenciaEspacio(e);
            tarjeta.querySelector(".exh-espacio-meta").textContent = `${e.codigo || ""} · ${exhDinero(e.precio)}`;

            const [lugar, capacidad] = tarjeta.querySelectorAll(".exh-espacio-campos input");
            if (lugar && lugar !== enfocado) lugar.value = e.etiqueta || "";
            if (capacidad && capacidad !== enfocado) capacidad.value = e.capacidad || "";
        }

        if (cuadricula.children[indice] !== tarjeta) cuadricula.insertBefore(tarjeta, cuadricula.children[indice] || null);
    });
}

function renderEditorExhibidor() {
    const pantalla = document.getElementById("pantallaExhibidores");
    const x = exhibidorEditando;
    if (!pantalla || !x) return;

    const colores = EXHIBIDOR_COLORES.map(c =>
        `<button type="button" class="exh-swatch exh-color-${c}${c === x.color ? " activo" : ""}" aria-label="Color ${c}" onclick="cambiarColorExhibidor('${c}')"></button>`
    ).join("");

    const espacios = x.espacios.map(exhEspacioHtml).join("");

    pantalla.innerHTML = `
    <div class="exh-shell">
        <div class="exh-header">
            <div>
                <button type="button" class="exh-enlace" onclick="mostrarExhibidores()">&larr; Todos los exhibidores</button>
                <h2 id="exhTituloEditor">${exhEscapar(x.nombre)}</h2>
            </div>
            <div class="exh-header-acciones">
                <button type="button" class="exh-btn exh-btn-suave" data-requiere-espacios onclick="abrirRecibirExhibidor(${x.id})" ${x.espacios.length ? "" : "disabled"}>Recibir mercancia</button>
                <button type="button" class="exh-btn exh-btn-suave" data-requiere-espacios onclick="abrirSurtirExhibidor(${x.id})" ${x.espacios.length ? "" : "disabled"}>Surtir</button>
                <button type="button" class="exh-btn exh-btn-primario" data-requiere-espacios onclick="abrirExhibidorPOS(${x.id})" ${x.espacios.length ? "" : "disabled"}>Probar venta</button>
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
                <div class="exh-foto-editor">
                    <span>Foto del exhibidor</span>
                    <img id="exhFotoVista" class="exh-foto-vista" alt="" ${x.foto ? `src="${x.foto}"` : "hidden"}>
                    <label class="exh-btn exh-btn-suave exh-foto-boton">${x.foto ? "Cambiar foto" : "Agregar foto"}<input type="file" accept="image/*" hidden onchange="exhSubirFoto(this)"></label>
                    <button type="button" id="exhFotoQuitar" class="exh-btn exh-btn-suave" onclick="exhQuitarFoto()" ${x.foto ? "" : "hidden"}>Quitar</button>
                </div>
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
            <h3>Productos del exhibidor <span class="exh-contador" id="exhContadorEspacios">${x.espacios.length}</span></h3>
            <div id="exhEspaciosCaja">
            ${x.espacios.length === 0
                ? '<div class="exh-vacio">Busca arriba y agrega los productos que lleva este exhibidor.</div>'
                : `<div class="exh-espacios">${espacios}</div>`}
            </div>
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
        });

    exhBusquedaCatalogo.todosInventario = encontrados;

    // Inventario al instante; el catalogo de proveedor llega unos instantes
    // despues (la tanda mas reciente gana, asi una respuesta lenta de una
    // busqueda vieja nunca pisa a la actual).
    exhBusquedaCatalogo.inventario = encontrados.slice(0, 8);
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

const exhBusquedaCatalogo = { inventario: [], todosInventario: [], catalogo: null, consulta: "", tanda: 0, temporizador: null };
const EXH_MAXIMO_DE_UNA_VEZ = 60;

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
        ${filasInventario ? `<div class="exh-grupo-titulo">En tu inventario${exhBusquedaCatalogo.todosInventario.length > 1 ? `<button type="button" class="exh-agregar-todos" onclick="agregarTodosAExhibidor()">Agregar los ${Math.min(exhBusquedaCatalogo.todosInventario.length, EXH_MAXIMO_DE_UNA_VEZ)} de tu inventario</button>` : ""}</div>${filasInventario}` : ""}
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

// Agrega de una vez todo lo que salio de tu inventario en la busqueda (hasta 60), uno por uno con la ruta de siempre.
async function agregarTodosAExhibidor() {
    if (!exhibidorEditando) return;

    const yaEstan = new Set(exhibidorEditando.espacios.map(e => Number(e.productoId)));
    const ids = exhBusquedaCatalogo.todosInventario.map(p => Number(p.id)).filter(id => !yaEstan.has(id)).slice(0, EXH_MAXIMO_DE_UNA_VEZ);
    const boton = document.querySelector("#exhResultadosBusqueda .exh-agregar-todos");
    let ultimo = null;
    let agregados = 0;

    for (const productoId of ids) {
        if (boton) boton.textContent = `Agregando ${agregados + 1} de ${ids.length}...`;

        const { ok, datos } = await exhLlamar(`/exhibidores/${exhibidorEditando.id}/espacios`, { method: "POST", body: JSON.stringify({ productoId }) });
        if (ok) { ultimo = datos.exhibidor; agregados++; }
    }

    if (ultimo) exhEditorActualizar(ultimo);

    const buscador = document.getElementById("exhBuscarProducto");
    const resultados = document.getElementById("exhResultadosBusqueda");
    if (buscador) buscador.value = "";
    if (resultados) { resultados.hidden = true; resultados.innerHTML = ""; }

    alertaPOS(agregados ? `Se agregaron ${agregados} producto${agregados === 1 ? "" : "s"} al exhibidor. Ponles su capacidad para saber cuánto surtir.` : "No había nada nuevo que agregar.", "Exhibidor", "info");
}

// Foto del exhibidor: se reduce en el celular/computadora antes de subirla.
function exhReducirImagen(archivo, maximo = 640) {
    return new Promise((resolver, rechazar) => {
        const lector = new FileReader();
        lector.onerror = () => rechazar(new Error("No se pudo leer la foto"));
        lector.onload = () => {
            const imagen = new Image();
            imagen.onerror = () => rechazar(new Error("Esa foto no se puede abrir"));
            imagen.onload = () => {
                const escala = Math.min(1, maximo / Math.max(imagen.width, imagen.height));
                const lienzo = document.createElement("canvas");
                lienzo.width = Math.round(imagen.width * escala);
                lienzo.height = Math.round(imagen.height * escala);
                lienzo.getContext("2d").drawImage(imagen, 0, 0, lienzo.width, lienzo.height);
                resolver(lienzo.toDataURL("image/jpeg", 0.8));
            };
            imagen.src = lector.result;
        };
        lector.readAsDataURL(archivo);
    });
}

async function exhSubirFoto(entrada) {
    const archivo = entrada.files && entrada.files[0];
    if (!archivo || !exhibidorEditando) return;

    try {
        const imagenBase64 = await exhReducirImagen(archivo);
        const { ok, datos } = await exhLlamar(`/exhibidores/${exhibidorEditando.id}/foto`, { method: "PUT", body: JSON.stringify({ imagenBase64 }) });

        if (!ok) throw new Error(datos.error || "No se pudo guardar la foto.");
        exhEditorActualizar(datos.exhibidor);
    } catch (error) {
        alertaPOS(error.message, "Foto del exhibidor", "peligro");
    }

    entrada.value = "";
}

async function exhQuitarFoto() {
    if (!exhibidorEditando) return;

    const { ok, datos } = await exhLlamar(`/exhibidores/${exhibidorEditando.id}/foto`, { method: "DELETE" });
    if (ok) exhEditorActualizar(datos.exhibidor);
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

    exhEditorActualizar(datos.exhibidor);

    // Listo para buscar el siguiente: se limpia el buscador y se deja el cursor ahi.
    const buscador = document.getElementById("exhBuscarProducto");
    const resultados = document.getElementById("exhResultadosBusqueda");
    if (buscador) { buscador.value = ""; buscador.focus(); }
    if (resultados) { resultados.hidden = true; resultados.innerHTML = ""; }
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

    exhEditorActualizar(datos.exhibidor);
}

async function quitarEspacioExhibidor(espacioId) {
    if (!exhibidorEditando) return;

    const { ok, datos } = await exhLlamar(`/exhibidores/${exhibidorEditando.id}/espacios/${espacioId}`, { method: "DELETE" });

    if (!ok) {
        alertaPOS(datos.error || "No se pudo quitar el producto.", "Error", "peligro");
        return;
    }

    exhEditorActualizar(datos.exhibidor);
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

    exhEditorActualizar(datos.exhibidor);
}

async function cambiarColorExhibidor(color) {
    if (!exhibidorEditando) return;

    const { ok, datos } = await exhLlamar(`/exhibidores/${exhibidorEditando.id}`, {
        method: "PATCH",
        body: JSON.stringify({ color })
    });

    if (ok) exhEditorActualizar(datos.exhibidor);
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

// Quita una pieza de ese producto del carrito (para corregir "mejor dos y no cuatro" sin salir del exhibidor).
function exhQuitarUnoDelCarrito(productoId) {
    if (typeof carrito === "undefined" || !Array.isArray(carrito)) return;

    const indice = carrito.findIndex(item => Number(item.id) === Number(productoId));
    if (indice < 0) return;

    carrito[indice].cantidad = Math.max(0, Number(carrito[indice].cantidad) - 1);
    if (carrito[indice].cantidad <= 0) carrito.splice(indice, 1);

    if (typeof actualizarCarrito === "function") actualizarCarrito();
    exhActualizarTilePOS(productoId);
}

function exhCambiarPendiente(productoId, delta) {
    // Sin cantidad nueva elegida, "abajo" baja lo que ya esta en el carrito.
    if (delta < 0 && !exhPendientes[productoId] && exhCantidadEnCarrito(productoId) > 0) {
        exhUltimoEnter = null;
        exhQuitarUnoDelCarrito(productoId);
        return;
    }

    const nuevo = Math.max(0, (exhPendientes[productoId] || 0) + delta);

    if (nuevo > 0) exhPendientes[productoId] = nuevo;
    else delete exhPendientes[productoId];

    exhActualizarTilePOS(productoId);
}

// Enter agrega la cantidad elegida (1 si no elegiste otra). Un segundo Enter seguido, sobre la misma tarjeta y sin
// cantidad nueva, quiere decir "ya termine": cierra el exhibidor y deja a la vista el carrito.
let exhUltimoEnter = null;

function exhConfirmarTile(productoId) {
    if (exhUltimoEnter === productoId && !exhPendientes[productoId]) {
        exhUltimoEnter = null;
        cerrarExhibidorPOS();
        return;
    }

    const cantidad = exhPendientes[productoId] || 1;
    delete exhPendientes[productoId];
    exhUltimoEnter = productoId;

    for (let i = 0; i < cantidad; i++) agregarDesdeExhibidor(productoId);
}

// Tocar con el mouse o el dedo y moverte con el teclado usan la misma tarjeta marcada.
function exhTocarTile(productoId) {
    const indice = exhTilesPOS().findIndex(tile => Number(tile.dataset.productoId) === Number(productoId));
    if (indice >= 0) { exhTileActivo = indice; exhMarcarTileActivo(false); }

    exhUltimoEnter = null;
    document.activeElement?.blur?.();
    agregarDesdeExhibidor(productoId);
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
            case "ArrowRight": exhTileActivo++; exhUltimoEnter = null; exhMarcarTileActivo(); break;
            case "ArrowLeft": exhTileActivo--; exhUltimoEnter = null; exhMarcarTileActivo(); break;
            case "ArrowUp": if (id) exhCambiarPendiente(id, 1); break;
            case "ArrowDown": if (id) exhCambiarPendiente(id, -1); break;
            case "Backspace": abrirExhibidorPOS(); break;
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
    exhUltimoEnter = null;
    exhTodoAgregado = null;

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
    return `${n ? `${n} toque${n === 1 ? "" : "s"} agregado${n === 1 ? "" : "s"} al carrito` : "Toca una tarjeta para agregarla al carrito"} &middot; <b>&larr; &rarr;</b> moverte &middot; <b>&uarr; &darr;</b> cantidad (&darr; también quita del carrito) &middot; <b>Enter</b> al carrito &middot; <b>Enter</b> otra vez = listo &middot; <b>Retroceso</b> otro exhibidor`;
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
            <button type="button" class="exh-tile${agotado ? " exh-tile-agotado" : ""}" data-producto-id="${e.productoId}" tabindex="-1" onclick="exhTocarTile(${e.productoId})" ${local ? "" : "disabled"}>
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
                ${exhTodoAgregado
                    ? `<button type="button" class="exh-btn exh-btn-claro" onclick="exhDeshacerTodoPOS()" title="Quita del carrito lo que agregó Agregar todo">Deshacer agregar todo</button>`
                    : `<button type="button" class="exh-btn exh-btn-claro" onclick="exhAgregarTodoPOS()" title="Una pieza de cada producto con existencia">Agregar todo</button>`}
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

// Vende el exhibidor completo: una pieza de cada producto que tiene existencia.
function exhAgregarTodoPOS() {
    const x = exhibidorPOSActual;
    if (!x) return;

    const puestos = [];

    for (const e of x.espacios) {
        const local = exhProducto(e.productoId);
        if (local && Number(local.stock) > 0) {
            agregarProductoPorId(e.productoId);
            exhibidorPOSAgregados++;
            exhActualizarTilePOS(e.productoId);
            puestos.push(e.productoId);
        }
    }

    exhTodoAgregado = puestos.length ? puestos : null;
    renderExhibidorPOS(document.getElementById("exhFiltroPOS")?.value || "");

    const ayuda = document.querySelector("#modalExhibidorPOS .exh-modal-ayuda");
    if (ayuda && !puestos.length) ayuda.textContent = "Ningún producto de este exhibidor tiene existencia.";
}

// Por si se toco "Agregar todo" sin querer: quita del carrito la pieza de cada producto que puso.
let exhTodoAgregado = null;

function exhDeshacerTodoPOS() {
    const puestos = exhTodoAgregado;
    exhTodoAgregado = null;
    if (!puestos || typeof carrito === "undefined" || !Array.isArray(carrito)) return;

    for (const id of puestos) {
        const indice = carrito.findIndex(item => Number(item.id) === Number(id));
        if (indice < 0) continue;

        carrito[indice].cantidad = Number(carrito[indice].cantidad) - 1;
        if (carrito[indice].cantidad <= 0) carrito.splice(indice, 1);

        exhibidorPOSAgregados = Math.max(0, exhibidorPOSAgregados - 1);
    }

    if (typeof actualizarCarrito === "function") actualizarCarrito();
    renderExhibidorPOS(document.getElementById("exhFiltroPOS")?.value || "");
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


// ---------------------------------------------------------------------
// Importar un exhibidor surtido de Truper (despachador de brocas, exhibidor de brochas...)
//
// Lee la ficha oficial (POST /exhibidores/truper/ficha) y arma el exhibidor con TODOS sus productos y la capacidad en
// piezas. Lo que falta en el inventario se crea con las rutas de siempre (catalogo-proveedor/.../crear-producto, en 0
// existencias) y la foto se trae del Banco de Nexo (fotos-sugeridas/aceptar). Nada de lo que ya tienes se modifica.
// ---------------------------------------------------------------------

let exhTruper = null;

let exhTruperDestinos = [];

async function abrirImportarTruper() {
    exhTruper = null;

    // Para poder agregar el surtido a un exhibidor que ya armaste (por ejemplo tu "Brocas" a medias).
    const { ok, datos } = await exhLlamar("/exhibidores");
    exhTruperDestinos = ok ? (datos.exhibidores || []).filter(x => x.activo) : [];

    renderImportarTruper();
}

function exhTruperEtiqueta(clave) {
    return String(clave || "").replace(/^[A-Za-z]+-/, "").slice(0, 40);
}

function renderImportarTruper(mensaje = "") {
    const modal = exhModal("modalImportarTruper");
    const t = exhTruper;
    const lista = t ? t.productos : [];
    const crear = lista.filter(p => p.estado === "se_crea").length;
    const hay = lista.filter(p => p.estado === "en_inventario").length;
    const faltan = lista.filter(p => p.estado === "no_esta").length;
    const usables = crear + hay;
    const textoEstado = { en_inventario: "Ya lo tienes", se_crea: "Se creará", no_esta: "No está en tu catálogo" };
    const textoFoto = p => p.tieneFoto ? "Con foto" : p.fotoEnBanco ? "Foto del Banco" : "Sin foto";

    const filas = lista.map(p => `
        <div class="exh-truper-fila exh-truper-${p.estado}">
            <b class="exh-truper-piezas">${p.piezas}</b>
            <span class="exh-truper-nombre">${exhEscapar(p.nombre)}<small>${exhEscapar(p.codigo)} · ${exhEscapar(p.clave)}</small></span>
            <span class="exh-truper-chip exh-truper-chip-${p.estado}">${textoEstado[p.estado]}</span>
            <span class="exh-truper-foto ${p.tieneFoto || p.fotoEnBanco ? "" : "exh-truper-foto-falta"}">${textoFoto(p)}</span>
        </div>`).join("");

    modal.innerHTML = `
    <div class="exh-modal-card exh-truper-card">
        <div class="exh-modal-cabecera">
            <div><span>Exhibidores</span><h3>Importar de Truper</h3></div>
            <button type="button" class="exh-btn exh-btn-suave" onclick="cerrarExhModal('modalImportarTruper')">Cerrar</button>
        </div>
        <div class="exh-truper-cuerpo">
            <section class="exh-truper-paso">
                <h4><span>1</span> Código del exhibidor</h4>
                <div class="exh-truper-busqueda">
                    <input id="exhTruperCodigo" type="text" inputmode="numeric" placeholder="Ej. 55956" value="${exhEscapar(t ? t.exhibidor.codigo : "")}" onkeydown="if (event.key === 'Enter') truperLeerFicha()">
                    <button type="button" class="exh-btn exh-btn-primario" id="exhTruperLeer" onclick="truperLeerFicha()">Leer ficha</button>
                </div>
                <p class="exh-truper-ayuda">Usa el código del exhibidor ya surtido, el que trae sus productos. Con el <b>55956</b> sale el despachador de 29 medidas de brocas.</p>
                ${mensaje ? `<p class="exh-truper-mensaje">${exhEscapar(mensaje)}</p>` : ""}
            </section>
            ${t ? `
            <section class="exh-truper-paso">
                <h4><span>2</span> Qué trae</h4>
                <p class="exh-truper-titulo-ficha">${exhEscapar(t.exhibidor.nombre)}</p>
                <div class="exh-truper-stats">
                    <div><strong>${lista.length}</strong><span>productos</span></div>
                    <div class="ok"><strong>${hay}</strong><span>ya los tienes</span></div>
                    <div class="nuevo"><strong>${crear}</strong><span>se crean con 0 existencias</span></div>
                    ${faltan ? `<div class="aviso"><strong>${faltan}</strong><span>no están en tu catálogo (se omiten)</span></div>` : ""}
                </div>
                <div class="exh-truper-lista">
                    <div class="exh-truper-fila exh-truper-encabezado"><span>Piezas</span><span>Producto</span><span>Estado</span><span>Foto</span></div>
                    ${filas}
                </div>
            </section>
            <section class="exh-truper-paso">
                <h4><span>3</span> ¿Dónde lo pongo?</h4>
                <div class="exh-truper-destino">
                    <label>Destino
                        <select id="exhTruperDestino" onchange="document.getElementById('exhTruperNombreCaja').style.display = this.value === 'nuevo' ? '' : 'none'">
                            <option value="nuevo">Crear un exhibidor nuevo</option>
                            ${exhTruperDestinos.map(x => `<option value="${x.id}" ${String(t.destino) === String(x.id) ? "selected" : ""}>Agregar a "${exhEscapar(x.nombre)}" (${x.totalEspacios} productos)</option>`).join("")}
                        </select>
                    </label>
                    <label id="exhTruperNombreCaja" style="${t.destino && t.destino !== "nuevo" ? "display:none" : ""}">Nombre del exhibidor
                        <input id="exhTruperNombre" type="text" value="${exhEscapar(t.nombreElegido ?? t.exhibidor.nombre)}" maxlength="140">
                    </label>
                </div>
            </section>` : ""}
        </div>
        ${t ? `
        <div class="exh-truper-pie">
            <span>${usables} productos entran al exhibidor</span>
            <button type="button" class="exh-btn exh-btn-primario" id="exhTruperCrear" ${usables ? "" : "disabled"} onclick="truperCrearExhibidor()">Crear exhibidor</button>
        </div>` : ""}
    </div>`;
}

async function truperLeerFicha() {
    const campo = document.getElementById("exhTruperCodigo");
    const boton = document.getElementById("exhTruperLeer");
    const codigo = String(campo?.value || "").trim();

    if (boton) { boton.disabled = true; boton.textContent = "Leyendo..."; }

    const { ok, datos } = await exhLlamar("/exhibidores/truper/ficha", { method: "POST", body: JSON.stringify({ codigo }) });

    if (!ok) {
        exhTruper = null;
        renderImportarTruper(datos.error || "No se pudo leer la ficha.");
        return;
    }

    exhTruper = datos;
    renderImportarTruper();
}

async function truperCrearExhibidor() {
    const t = exhTruper;
    if (!t) return;

    const boton = document.getElementById("exhTruperCrear");
    const nombre = String(document.getElementById("exhTruperNombre")?.value || "").trim() || t.exhibidor.nombre || "Exhibidor Truper";
    const destino = document.getElementById("exhTruperDestino")?.value || "nuevo";
    t.nombreElegido = nombre;
    t.destino = destino;
    if (boton) boton.disabled = true;

    const pendientes = t.productos.filter(p => p.estado === "se_crea");
    let creados = 0, fotos = 0, fallidos = 0;

    for (let i = 0; i < pendientes.length; i++) {
        if (boton) boton.textContent = `Creando productos ${i + 1} de ${pendientes.length}...`;

        const p = pendientes[i];
        const { ok, datos } = await exhLlamar(`/catalogo-proveedor/${p.catalogoId}/productos/${p.catalogoProductoId}/crear-producto`, { method: "POST" });

        if (ok && datos.productoId) { p.productoId = datos.productoId; creados++; } else { fallidos++; }
    }

    // La foto se copia del Banco de Nexo a los productos que no tienen (si el plan no la incluye, se omite sin romper nada).
    const sinFoto = t.productos.filter(p => p.productoId && !p.tieneFoto && p.fotoEnBanco);

    for (let i = 0; i < sinFoto.length; i++) {
        if (boton) boton.textContent = `Poniendo fotos ${i + 1} de ${sinFoto.length}...`;

        const { ok } = await exhLlamar("/fotos-sugeridas/aceptar", { method: "POST", body: JSON.stringify({ productoId: sinFoto[i].productoId, codigoBanco: sinFoto[i].codigo }) });
        if (ok) fotos++;
    }

    const espacios = t.productos.filter(p => p.productoId).map(p => ({ productoId: p.productoId, etiqueta: exhTruperEtiqueta(p.clave), capacidad: p.piezas }));

    if (boton) boton.textContent = "Armando el exhibidor...";

    let nombreFinal = nombre;
    let yaEstaban = 0;

    if (destino === "nuevo") {
        const { ok, datos } = await exhLlamar("/exhibidores", { method: "POST", body: JSON.stringify({ nombre, descripcion: `Truper ${t.exhibidor.codigo}${t.exhibidor.clave ? " · " + t.exhibidor.clave : ""}`, espacios }) });

        if (typeof cargarProductos === "function") await cargarProductos();

        if (!ok) {
            renderImportarTruper(datos.error || "No se pudo crear el exhibidor.");
            return;
        }
    } else {
        // Exhibidor que ya existe: solo se suman los productos que todavia no tiene (los que ya estan, se quedan como estan).
        nombreFinal = (exhTruperDestinos.find(x => String(x.id) === String(destino)) || {}).nombre || "tu exhibidor";

        for (const espacio of espacios) {
            const { ok, status } = await exhLlamar(`/exhibidores/${destino}/espacios`, { method: "POST", body: JSON.stringify(espacio) });
            if (!ok && status === 409) yaEstaban++;
        }

        if (typeof cargarProductos === "function") await cargarProductos();
    }

    cerrarExhModal("modalImportarTruper");
    await mostrarExhibidores();

    if (typeof alertaPOS === "function") {
        const agregados = espacios.length - yaEstaban;
        alertaPOS(`Listo: "${nombreFinal}" ${destino === "nuevo" ? `con ${espacios.length} productos` : `ahora suma ${agregados} productos${yaEstaban ? ` (${yaEstaban} ya estaban)` : ""}`}. ${creados} productos nuevos (con 0 existencias), ${fotos} fotos del Banco${fallidos ? `, ${fallidos} no se pudieron crear` : ""}. Ahora usa Recibir para meter las piezas.`, "Exhibidor importado", "exito");
    }
}
