// Fotos sugeridas: revisar, producto por producto, la foto que el Banco de Nexo
// sugiere para los productos que no tienen foto, y confirmar con un toque.
//
// Nada se aplica solo: la foto se copia al producto UNICAMENTE cuando la persona
// toca "Es este". El enlace automatico (que ya corrio) solo aplica lo seguro;
// esto cubre lo que antes se descartaba por dudoso (el codigo de barras casa pero
// el nombre difiere, nombres parecidos). Las diferencias de nombre se resaltan
// para decidir de un vistazo (50 vs 200 piezas, AA vs C, macho vs hembra...).

const fsEstado = {
    cola: [],
    siguienteDespuesDe: 0,
    terminado: false,
    cargando: false,
    permitido: true,
    pendientes: 0,
    aceptadas: 0,
    descartadas: 0,
    activa: false,
    ocupado: false,
    refrescoProductos: null
};

function fsEscapar(valor) {
    return typeof escaparPOS === "function"
        ? escaparPOS(valor)
        : String(valor ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function fsDinero(valor) {
    return "$" + Number(valor || 0).toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fsPalabra(token) {
    return String(token || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]/g, "");
}

// Resalta (en ambar) las palabras de "a" que no aparecen en "b".
function fsMarcarDiferencias(a, b) {
    const conocidas = new Set(String(b || "").split(/\s+/).map(fsPalabra).filter(Boolean));

    return String(a || "").split(/\s+/).map(token => {
        const limpio = fsPalabra(token);
        const html = fsEscapar(token);
        return limpio && !conocidas.has(limpio) ? `<mark class="fs-diferente">${html}</mark>` : html;
    }).join(" ");
}

async function fsLlamar(ruta, opciones = {}) {
    const respuesta = await fetch(ruta, {
        ...opciones,
        headers: { "Content-Type": "application/json", ...(opciones.headers || {}) }
    });
    const datos = await respuesta.json().catch(() => ({}));
    return { ok: respuesta.ok && datos.ok, status: respuesta.status, datos };
}

async function mostrarFotosSugeridas() {
    if (typeof ocultarPantallasPrincipales === "function") ocultarPantallasPrincipales();

    const pantalla = document.getElementById("pantallaFotosSugeridas");
    if (!pantalla) return;

    pantalla.style.display = "block";

    if (typeof actualizarTopbarContexto === "function") {
        actualizarTopbarContexto("Fotos sugeridas", "Confirma con un toque la foto de cada producto", "fotos-sugeridas");
    }

    Object.assign(fsEstado, {
        cola: [], siguienteDespuesDe: 0, terminado: false, cargando: false,
        permitido: true, pendientes: 0, aceptadas: 0, descartadas: 0, activa: true, ocupado: false
    });

    fsRender();
    await fsCargarMas();
}

async function fsCargarMas() {
    if (fsEstado.cargando || fsEstado.terminado) return;
    fsEstado.cargando = true;

    const { ok, datos } = await fsLlamar(`/fotos-sugeridas?limite=8&despuesDe=${fsEstado.siguienteDespuesDe}`);
    fsEstado.cargando = false;

    if (!ok) {
        fsEstado.terminado = true;
        alertaPOS(datos.error || "No se pudieron cargar las sugerencias.", "Fotos sugeridas", "peligro");
        fsRender();
        return;
    }

    fsEstado.permitido = datos.permitido !== false;
    fsEstado.pendientes = datos.pendientes;

    const yaEstan = new Set(fsEstado.cola.map(item => item.productoId));
    datos.items.forEach(item => { if (!yaEstan.has(item.productoId)) fsEstado.cola.push(item); });

    if (datos.siguienteDespuesDe === null || !fsEstado.permitido) {
        fsEstado.terminado = true;
    } else {
        fsEstado.siguienteDespuesDe = datos.siguienteDespuesDe;
    }

    fsRender();
}

function fsRender() {
    const pantalla = document.getElementById("pantallaFotosSugeridas");
    if (!pantalla) return;

    const item = fsEstado.cola[0];
    const revisadas = fsEstado.aceptadas + fsEstado.descartadas;

    let cuerpo;

    if (!fsEstado.permitido) {
        cuerpo = `<div class="fs-vacio-grande"><div class="fs-vacio-icono">🔒</div><h3>Disponible desde el plan Plus</h3><p>El Banco de Nexo trae miles de fotos de productos listas para usar.</p></div>`;
    } else if (item) {
        cuerpo = fsRenderTarjeta(item);
    } else if (!fsEstado.terminado) {
        cuerpo = `<div class="fs-vacio-grande"><div class="fs-vacio-icono">🔎</div><h3>Buscando sugerencias...</h3></div>`;
    } else {
        cuerpo = `
        <div class="fs-vacio-grande">
            <div class="fs-vacio-icono">${fsEstado.aceptadas > 0 ? "🎉" : "✅"}</div>
            <h3>${fsEstado.aceptadas > 0 ? "Listo, terminaste las sugerencias" : "No hay mas sugerencias por ahora"}</h3>
            <p>${fsEstado.aceptadas > 0 ? `Confirmaste ${fsEstado.aceptadas} foto${fsEstado.aceptadas === 1 ? "" : "s"}. ` : ""}Los productos que sigan sin foto puedes fotografiarlos con tu celular desde "Editar producto".</p>
        </div>`;
    }

    pantalla.innerHTML = `
    <div class="fs-shell">
        <div class="fs-header">
            <div>
                <h2>Fotos sugeridas</h2>
                <p>Compara tu producto con la foto del Banco de Nexo. Acepta <strong>solo si es exactamente el mismo</strong> (misma medida, cantidad y marca). Lo que cambia en el nombre aparece resaltado.</p>
            </div>
            <div class="fs-contador">
                <strong>${fsEstado.pendientes}</strong><span>sin foto</span>
                ${revisadas > 0 ? `<small>${fsEstado.aceptadas} aceptada${fsEstado.aceptadas === 1 ? "" : "s"} &middot; ${fsEstado.descartadas} descartada${fsEstado.descartadas === 1 ? "" : "s"}</small>` : ""}
            </div>
        </div>
        ${cuerpo}
    </div>`;
}

function fsRenderTarjeta(item) {
    const candidatas = item.candidatas.map((c, i) => `
        <div class="fs-cand">
            <div class="fs-foto"><img src="${fsEscapar(c.imagenUrl)}" alt="" loading="lazy" onerror="this.replaceWith(Object.assign(document.createElement('span'),{className:'fs-foto-rota',textContent:'Sin vista previa'}))"></div>
            <div class="fs-cand-info">
                <span class="fs-chip ${c.via === "ean" ? "fs-chip-ean" : ""}">${c.via === "ean" ? "Mismo código de barras" : `Nombre ${Math.round(c.similitud * 100)}% parecido`}</span>
                <p class="fs-nombre-oficial">${fsMarcarDiferencias(c.nombre, item.nombre)}</p>
                <button type="button" class="fs-btn fs-btn-ok" onclick="fsAceptar('${fsEscapar(c.codigoBanco)}')" ${fsEstado.ocupado ? "disabled" : ""}>Es este <kbd>${i + 1}</kbd></button>
            </div>
        </div>`).join("");

    return `
    <article class="fs-card">
        <section class="fs-producto">
            <span class="fs-etiqueta">Tu producto</span>
            <h3>${fsEscapar(item.nombre)}</h3>
            <div class="fs-meta">
                <span>Código ${fsEscapar(item.codigo)}</span>
                ${item.marca ? `<span>${fsEscapar(item.marca)}</span>` : ""}
                <span>${fsDinero(item.precio)}</span>
            </div>
        </section>
        <section class="fs-candidatas">${candidatas}</section>
        <footer class="fs-acciones">
            <button type="button" class="fs-btn fs-btn-suave" onclick="fsNinguna()" ${fsEstado.ocupado ? "disabled" : ""}>Ninguna es <kbd>N</kbd></button>
            <button type="button" class="fs-btn fs-btn-suave" onclick="fsSaltar()" ${fsEstado.ocupado ? "disabled" : ""}>Saltar por ahora <kbd>S</kbd></button>
        </footer>
    </article>`;
}

function fsSiguiente() {
    fsEstado.cola.shift();
    fsEstado.ocupado = false;
    fsRender();

    // Se pide la siguiente tanda con tiempo, antes de que se acabe la cola.
    if (fsEstado.cola.length <= 2) fsCargarMas();
}

function fsProgramarRefrescoDeProductos() {
    clearTimeout(fsEstado.refrescoProductos);
    fsEstado.refrescoProductos = setTimeout(() => {
        if (typeof cargarProductos === "function") cargarProductos().catch(() => {});
    }, 5000);
}

async function fsAceptar(codigoBanco) {
    const item = fsEstado.cola[0];
    if (!item || fsEstado.ocupado) return;

    fsEstado.ocupado = true;
    fsRender();

    const { ok, status, datos } = await fsLlamar("/fotos-sugeridas/aceptar", {
        method: "POST",
        body: JSON.stringify({ productoId: item.productoId, codigoBanco })
    });

    if (ok) {
        fsEstado.aceptadas++;
        fsEstado.pendientes = Math.max(0, fsEstado.pendientes - 1);
        fsProgramarRefrescoDeProductos();
        fsSiguiente();
        return;
    }

    if (status === 409) {
        // Alguien ya le puso foto mientras tanto: no hay nada que hacer aqui.
        fsEstado.pendientes = Math.max(0, fsEstado.pendientes - 1);
        alertaPOS(datos.error || "Este producto ya tiene foto.", "Fotos sugeridas", "info");
        fsSiguiente();
        return;
    }

    fsEstado.ocupado = false;
    fsRender();
    alertaPOS(datos.error || "No se pudo guardar la foto. Intenta de nuevo.", "Fotos sugeridas", "peligro");
}

async function fsNinguna() {
    const item = fsEstado.cola[0];
    if (!item || fsEstado.ocupado) return;

    fsEstado.ocupado = true;
    fsRender();

    const { ok, datos } = await fsLlamar("/fotos-sugeridas/descartar", {
        method: "POST",
        body: JSON.stringify({ productoId: item.productoId, codigosBanco: item.candidatas.map(c => c.codigoBanco) })
    });

    if (!ok) {
        fsEstado.ocupado = false;
        fsRender();
        alertaPOS(datos.error || "No se pudo guardar. Intenta de nuevo.", "Fotos sugeridas", "peligro");
        return;
    }

    fsEstado.descartadas++;
    fsSiguiente();
}

function fsSaltar() {
    if (fsEstado.cola.length === 0 || fsEstado.ocupado) return;

    // Pasa al final de lo cargado; no se recuerda nada (volvera a salir).
    fsEstado.cola.push(fsEstado.cola.shift());
    fsRender();
}

// Atajos de teclado: 1, 2, 3 aceptan esa foto; N = ninguna; S = saltar.
document.addEventListener("keydown", evento => {
    const pantalla = document.getElementById("pantallaFotosSugeridas");
    if (!fsEstado.activa || !pantalla || pantalla.style.display === "none") return;
    if (/^(INPUT|TEXTAREA|SELECT)$/.test(evento.target?.tagName || "") || evento.ctrlKey || evento.metaKey || evento.altKey) return;

    const item = fsEstado.cola[0];
    if (!item) return;

    if (["1", "2", "3"].includes(evento.key)) {
        const candidata = item.candidatas[Number(evento.key) - 1];
        if (candidata) fsAceptar(candidata.codigoBanco);
    } else if (evento.key === "n" || evento.key === "N") {
        fsNinguna();
    } else if (evento.key === "s" || evento.key === "S") {
        fsSaltar();
    }
});

window.mostrarFotosSugeridas = mostrarFotosSugeridas;
