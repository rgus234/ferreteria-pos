/* Venta rapida con favoritos (abarrotes).

   Una franja de tarjetas grandes (foto, nombre, precio) arriba del carrito: un toque suma el producto.
   El tendero la arma una vez, de un toque con lo que mas vende o a mano, y se guarda en el negocio
   (GET/PUT /venta-rapida/favoritos, ver favoritos-server.js). Solo aparece en el perfil simple. */

let favoritosIds = [];
let favoritosSugeridos = [];
let favoritosMaximo = 24;
let favoritosEditando = false;
let favoritosCargados = false;
let favoritosBusqueda = "";
const FAVORITOS_OCULTA_KEY = "nexoFavoritosOculta";

function favLeerOculta() {
    try { return localStorage.getItem(FAVORITOS_OCULTA_KEY) === "1"; } catch (error) { return false; }
}

let favoritosOculta = favLeerOculta();

function favEscapar(valor) {
    return String(valor ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function favEsSimple() {
    return typeof perfilEsSimple === "function" && perfilEsSimple();
}

function favProducto(id) {
    return (typeof todosProductos !== "undefined" && Array.isArray(todosProductos)) ? todosProductos.find(p => Number(p.id) === Number(id)) : null;
}

function favNormalizar(texto) {
    return String(texto || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
}

function favCantidadEnCarrito(id) {
    if (typeof carrito === "undefined" || !Array.isArray(carrito)) return 0;
    return carrito.filter(p => Number(p.id) === Number(id)).reduce((s, p) => s + Number(p.cantidad || 0), 0);
}

function favFoto(producto) {
    if (producto.imagenUrl && typeof miniaturaProducto === "function") return miniaturaProducto(producto);
    return `<span class="fav-inicial" aria-hidden="true">${favEscapar(String(producto.nombre || "?").charAt(0).toUpperCase())}</span>`;
}

async function favLlamar(ruta, opciones = {}) {
    const respuesta = await fetch(ruta, { headers: { "Content-Type": "application/json" }, ...opciones });
    const datos = await respuesta.json().catch(() => ({}));
    return { ok: respuesta.ok, datos };
}

function favContenedor() {
    let franja = document.getElementById("favoritosPOS");
    if (franja) return franja;

    const referencia = document.querySelector(".pos-products-panel .pos-reference-toolbar");
    if (!referencia) return null;

    franja = document.createElement("section");
    franja.id = "favoritosPOS";
    franja.className = "fav-franja";
    referencia.insertAdjacentElement("afterend", franja);
    return franja;
}

async function cargarFavoritosPOS() {
    const franja = favContenedor();
    if (!franja) return;

    if (!favEsSimple()) {
        franja.innerHTML = "";
        franja.style.display = "none";
        return;
    }

    franja.style.display = "";
    const { ok, datos } = await favLlamar("/venta-rapida/favoritos");

    if (ok) {
        favoritosIds = datos.ids;
        favoritosSugeridos = datos.sugeridos;
        favoritosMaximo = datos.maximo || 24;
        favoritosCargados = true;
    }

    renderFavoritosPOS();
}

function favTarjeta(producto) {
    const precio = typeof precioVentaProducto === "function" ? precioVentaProducto(producto) : producto.precio;
    const agotado = Number(producto.stock) <= 0;
    const enCarrito = favCantidadEnCarrito(producto.id);
    const dinero = typeof window.dinero === "function" ? window.dinero(precio) : "$" + Number(precio || 0).toFixed(2);

    return `
    <button type="button" class="fav-tarjeta${agotado ? " fav-agotado" : ""}${favoritosEditando ? " fav-editando" : ""}" data-producto-id="${producto.id}"
        onclick="${favoritosEditando ? `favQuitar(${producto.id})` : `favAgregar(${producto.id})`}">
        ${favoritosEditando ? `<span class="fav-quitar" aria-label="Quitar de favoritos">&times;</span>` : (enCarrito > 0 ? `<span class="fav-cuenta">${Number(enCarrito.toFixed(3))}</span>` : "")}
        <span class="fav-foto">${favFoto(producto)}</span>
        <strong class="fav-nombre">${favEscapar(producto.nombre)}</strong>
        <span class="fav-precio">${favEscapar(dinero)}</span>
        ${agotado ? `<span class="fav-aviso">Agotado</span>` : ""}
    </button>`;
}

function favResultadosBusqueda() {
    const consulta = favNormalizar(favoritosBusqueda);
    if (consulta.length < 2) return [];

    const yaSon = new Set(favoritosIds.map(Number));

    return (typeof todosProductos !== "undefined" ? todosProductos : [])
        .filter(p => !yaSon.has(Number(p.id)) && favNormalizar(`${p.nombre} ${p.codigo || ""} ${p.marca || ""}`).includes(consulta))
        .slice(0, 6);
}

function renderFavoritosPOS() {
    const franja = favContenedor();
    if (!franja || !favEsSimple()) return;

    const productos = favoritosIds.map(favProducto).filter(Boolean);
    const sugeridos = favoritosSugeridos.filter(s => favProducto(s.productoId));

    let cuerpo;

    if (productos.length) {
        cuerpo = `<div class="fav-rejilla">${productos.map(favTarjeta).join("")}</div>`;
    } else {
        cuerpo = `
        <div class="fav-vacio">
            <p>Arma tus favoritos: los productos que más vendes, a un toque.</p>
            <div class="fav-vacio-acciones">
                ${sugeridos.length ? `<button type="button" class="fav-btn fav-btn-primario" onclick="favUsarMasVendidos()">Usar lo que más vendo (${sugeridos.length})</button>` : ""}
                <button type="button" class="fav-btn" onclick="favEditar(true)">Elegirlos a mano</button>
            </div>
        </div>`;
    }

    const resultados = favoritosEditando ? favResultadosBusqueda() : [];

    const editor = favoritosEditando ? `
        <div class="fav-agregar">
            <input id="favBuscar" type="search" autocomplete="off" placeholder="Buscar un producto para agregarlo..." value="${favEscapar(favoritosBusqueda)}" oninput="favBuscar(this.value)">
            ${resultados.length ? `<div class="fav-resultados">${resultados.map(p => `<button type="button" onclick="favAgregarALista(${p.id})">+ ${favEscapar(p.nombre)}</button>`).join("")}</div>` : ""}
            ${sugeridos.length && productos.length < favoritosMaximo ? `<div class="fav-sugeridos"><small>Lo que más vendes:</small>${sugeridos.slice(0, 6).map(s => `<button type="button" onclick="favAgregarALista(${s.productoId})">+ ${favEscapar(favProducto(s.productoId).nombre)}</button>`).join("")}</div>` : ""}
        </div>` : "";

    franja.classList.toggle("fav-oculta", favoritosOculta);

    franja.innerHTML = `
    <div class="fav-cabecera">
        <button type="button" class="fav-titulo" onclick="favAlternar()" aria-expanded="${favoritosOculta ? "false" : "true"}" aria-controls="favCuerpo" title="${favoritosOculta ? "Mostrar favoritos" : "Ocultar favoritos"}">
            <span class="fav-flecha" aria-hidden="true">▾</span>
            <h3>⭐ Favoritos</h3>
            <small class="fav-resumen">${favoritosOculta ? `${productos.length} producto${productos.length === 1 ? "" : "s"} a un toque` : ""}</small>
        </button>
        <div class="fav-cabecera-acciones">
            ${productos.length || favoritosEditando ? `<button type="button" class="fav-btn" onclick="favEditar(${favoritosEditando ? "false" : "true"})">${favoritosEditando ? "Listo" : "Editar"}</button>` : ""}
            <button type="button" class="fav-btn fav-btn-alternar" onclick="favAlternar()" aria-expanded="${favoritosOculta ? "false" : "true"}" aria-controls="favCuerpo">
                <span class="fav-btn-texto">${favoritosOculta ? "Mostrar" : "Ocultar"}</span>
                <span class="fav-btn-flecha" aria-hidden="true">▲</span>
            </button>
        </div>
    </div>
    <div class="fav-plegable" id="favCuerpo">
        <div class="fav-interior">
            ${editor}
            ${cuerpo}
        </div>
    </div>`;

    if (favoritosEditando && favoritosBusqueda) {
        const campo = document.getElementById("favBuscar");
        if (campo) { campo.focus(); campo.setSelectionRange(campo.value.length, campo.value.length); }
    }
}

// Un toque suma al carrito: solo cambia el contador de esa tarjeta (no se vuelve a dibujar la franja).
function favAgregar(id) {
    if (typeof agregarProductoPorId !== "function") return;

    agregarProductoPorId(id);
    favActualizarContadores();
}

function favActualizarContadores() {
    document.querySelectorAll("#favoritosPOS .fav-tarjeta").forEach(tarjeta => {
        if (favoritosEditando) return;

        const enCarrito = favCantidadEnCarrito(tarjeta.dataset.productoId);
        let chip = tarjeta.querySelector(".fav-cuenta");

        if (enCarrito > 0) {
            if (!chip) {
                chip = document.createElement("span");
                chip.className = "fav-cuenta";
                tarjeta.prepend(chip);
            }
            chip.textContent = Number(enCarrito.toFixed(3));
        } else if (chip) {
            chip.remove();
        }
    });
}

async function favGuardar(ids) {
    const { ok, datos } = await favLlamar("/venta-rapida/favoritos", { method: "PUT", body: JSON.stringify({ ids }) });

    if (!ok) {
        if (typeof alertaPOS === "function") alertaPOS(datos.error || "No se pudieron guardar los favoritos.", "Favoritos", "peligro");
        return false;
    }

    favoritosIds = datos.ids;
    favoritosSugeridos = favoritosSugeridos.filter(s => !favoritosIds.includes(s.productoId));
    return true;
}

async function favUsarMasVendidos() {
    const ids = favoritosSugeridos.map(s => s.productoId).slice(0, favoritosMaximo);
    if (ids.length && await favGuardar(ids)) renderFavoritosPOS();
}

// Oculta o muestra la franja con animacion: solo se cambia una clase, sin volver a dibujar las tarjetas.
function favAlternar() {
    favoritosOculta = !favoritosOculta;

    try { localStorage.setItem(FAVORITOS_OCULTA_KEY, favoritosOculta ? "1" : "0"); } catch (error) { /* sin almacenamiento */ }

    const franja = document.getElementById("favoritosPOS");
    if (!franja) return;

    franja.classList.toggle("fav-oculta", favoritosOculta);

    const titulo = franja.querySelector(".fav-titulo");
    const resumen = franja.querySelector(".fav-resumen");
    const alternar = franja.querySelector(".fav-btn-alternar");

    if (alternar) {
        alternar.setAttribute("aria-expanded", favoritosOculta ? "false" : "true");
        alternar.querySelector(".fav-btn-texto").textContent = favoritosOculta ? "Mostrar" : "Ocultar";
    }

    if (titulo) {
        titulo.setAttribute("aria-expanded", favoritosOculta ? "false" : "true");
        titulo.title = favoritosOculta ? "Mostrar favoritos" : "Ocultar favoritos";
    }

    if (resumen) {
        const n = favoritosIds.filter(favProducto).length;
        resumen.textContent = favoritosOculta ? `${n} producto${n === 1 ? "" : "s"} a un toque` : "";
    }
}

function favEditar(activar) {
    favoritosEditando = Boolean(activar);

    // Para editar la franja tiene que estar a la vista.
    if (favoritosEditando && favoritosOculta) {
        favoritosOculta = false;
        try { localStorage.setItem(FAVORITOS_OCULTA_KEY, "0"); } catch (error) { /* sin almacenamiento */ }
    }

    favoritosBusqueda = "";
    renderFavoritosPOS();
}

function favBuscar(texto) {
    favoritosBusqueda = texto;
    renderFavoritosPOS();
}

async function favAgregarALista(id) {
    if (favoritosIds.length >= favoritosMaximo) {
        if (typeof alertaPOS === "function") alertaPOS(`Puedes tener hasta ${favoritosMaximo} favoritos.`, "Favoritos", "alerta");
        return;
    }

    if (await favGuardar([...favoritosIds, Number(id)])) {
        favoritosBusqueda = "";
        renderFavoritosPOS();
    }
}

async function favQuitar(id) {
    if (await favGuardar(favoritosIds.filter(x => Number(x) !== Number(id)))) renderFavoritosPOS();
}

// ---------------------------------------------------------------------
// Enganche con el Punto de venta de siempre
// ---------------------------------------------------------------------

// Cuando se recargan los productos (precio, existencia, foto) la franja se pinta con lo nuevo.
const cargarProductosOriginalFav = window.cargarProductos;

if (typeof cargarProductosOriginalFav === "function") {
    window.cargarProductos = async function (...argumentos) {
        const resultado = await cargarProductosOriginalFav.apply(this, argumentos);

        if (favEsSimple()) {
            if (!favoritosCargados) cargarFavoritosPOS();
            else renderFavoritosPOS();
        }

        return resultado;
    };
}

// El carrito cambia desde muchos lados (buscador, listas, exhibidores): los contadores se ponen al dia.
const actualizarCarritoOriginalFav = window.actualizarCarrito;

if (typeof actualizarCarritoOriginalFav === "function") {
    window.actualizarCarrito = function (...argumentos) {
        const resultado = actualizarCarritoOriginalFav.apply(this, argumentos);
        favActualizarContadores();
        return resultado;
    };
}

document.addEventListener("DOMContentLoaded", () => setTimeout(() => { if (favEsSimple()) cargarFavoritosPOS(); }, 2500));
