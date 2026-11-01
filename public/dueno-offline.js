// Cache local (IndexedDB) para /dueno: catalogo de productos de solo
// lectura y una cola de cotizaciones armadas sin internet, para
// cuando el dueño visita un rancho sin señal. Vanilla, sin libreria
// -- misma convencion del resto del proyecto.

const DUENO_DB_NAME = "nexo-dueno-db";
// v2: almacen "ventasPendientes" (ventas cobradas sin internet, ver
// dueno-ventas-offline.js).
const DUENO_DB_VERSION = 2;

function abrirDuenoDB() {
    return new Promise((resolve, reject) => {
        const solicitud = indexedDB.open(DUENO_DB_NAME, DUENO_DB_VERSION);

        solicitud.onupgradeneeded = () => {
            const db = solicitud.result;

            if (!db.objectStoreNames.contains("catalogo")) {
                db.createObjectStore("catalogo", { keyPath: "id" });
            }

            if (!db.objectStoreNames.contains("cotizacionesLocales")) {
                db.createObjectStore("cotizacionesLocales", { keyPath: "eventId" });
            }

            if (!db.objectStoreNames.contains("ventasPendientes")) {
                db.createObjectStore("ventasPendientes", { keyPath: "eventId" });
            }
        };

        solicitud.onsuccess = () => resolve(solicitud.result);
        solicitud.onerror = () => reject(solicitud.error);
    });
}

function promesaSolicitud(solicitud) {
    return new Promise((resolve, reject) => {
        solicitud.onsuccess = () => resolve(solicitud.result);
        solicitud.onerror = () => reject(solicitud.error);
    });
}

function promesaTransaccion(transaccion) {
    return new Promise((resolve, reject) => {
        transaccion.oncomplete = () => resolve(true);
        transaccion.onerror = () => reject(transaccion.error);
    });
}

// Las listas piden la foto chica (160 px) en vez de la completa: la pantalla carga mucho mas rapido y gasta menos datos.
function fotoMiniDueno(url, ancho = 160) {
    const texto = String(url || "");
    if (!texto.includes("/fotos-producto/") || /[?&]w=/.test(texto)) return texto;
    return texto + (texto.includes("?") ? "&" : "?") + "w=" + ancho;
}

// Nivel de precio con el que cobra el negocio. Es el MISMO que usa la computadora (Configuracion -> nivel de precio por defecto):
// asi un producto cuesta lo mismo en el celular y en el mostrador. Un abarrotes vende siempre al publico. Se guarda para arrancar sin internet.
const NIVELES_PRECIO_DUENO = ["publico", "mayoreo", "distribuidor"];

function nivelPrecioDueno() {
    if (NIVELES_PRECIO_DUENO.includes(window.duenoNivelPrecio)) return window.duenoNivelPrecio;

    try {
        const guardado = localStorage.getItem("nexoDuenoNivelPrecio");
        if (NIVELES_PRECIO_DUENO.includes(guardado)) return guardado;
    } catch (error) { /* sin almacenamiento */ }

    return "publico";
}

// Misma regla que aplicarNivelPrecioAItem del POS de escritorio: el precio de ese nivel y, si no tiene, el publico.
function precioSegunNivelDueno(producto) {
    const publico = Number(producto.precioPublico ?? producto.precio) || 0;
    const nivel = nivelPrecioDueno();
    const candidato = nivel === "mayoreo" ? producto.precioMayoreo : nivel === "distribuidor" ? producto.precioDistribuidor : producto.precioPublico;
    return Number(candidato) > 0 ? Number(candidato) : publico;
}

function conNivelPrecioDueno(lista) {
    return (lista || []).map(producto => ({ ...producto, precio: precioSegunNivelDueno(producto) }));
}

async function guardarCatalogoLocal(productos) {
    try {
        const db = await abrirDuenoDB();
        const transaccion = db.transaction("catalogo", "readwrite");
        const tienda = transaccion.objectStore("catalogo");

        tienda.clear();

        (productos || []).forEach(producto => {
            tienda.put({
                id: producto.id,
                nombre: producto.nombre || "",
                codigo: producto.codigo || "",
                precio: Number(producto.precio_publico ?? producto.precio ?? 0),
                precioPublico: Number(producto.precio_publico ?? producto.precio ?? 0),
                precioMayoreo: producto.precio_mayoreo != null ? Number(producto.precio_mayoreo) : null,
                stock: Number(producto.stock || 0),
                imagenUrl: producto.imagenUrl || null,
                categoria: producto.categoria || "",
                marca: producto.marca || "",
                descripcion: producto.descripcion || "",
                unidadVenta: producto.unidad_venta || "",
                stockMinimo: producto.stock_minimo != null ? Number(producto.stock_minimo) : null,
                ubicacion: producto.ubicacion || "",
                precioDistribuidor: producto.precio_distribuidor != null ? Number(producto.precio_distribuidor) : null,
                fechaCaducidad: producto.fecha_caducidad || null
            });
        });

        await promesaTransaccion(transaccion);
    } catch (error) {
        console.warn("No se pudo guardar el catalogo local", error);
    }
}

async function buscarEnCatalogoLocal(texto) {
    const textoLimpio = String(texto || "").trim().toLowerCase();

    if (!textoLimpio) return [];

    try {
        const db = await abrirDuenoDB();
        const transaccion = db.transaction("catalogo", "readonly");
        const tienda = transaccion.objectStore("catalogo");
        const todos = await promesaSolicitud(tienda.getAll());

        return conNivelPrecioDueno(todos
            .filter(producto =>
                producto.nombre.toLowerCase().includes(textoLimpio) ||
                producto.codigo.toLowerCase().includes(textoLimpio)
            )
            .slice(0, 20));
    } catch (error) {
        console.warn("No se pudo buscar en el catalogo local", error);
        return [];
    }
}

// Mismo umbral y calculo que expiring-products.js (escritorio, "Por
// vencer") -- se repite aqui en vez de compartir archivo porque ese
// modulo depende de globals del POS de escritorio (todosProductos,
// ocultarPantallasPrincipales) que no existen en /dueno.
const DUENO_DIAS_ALERTA_CADUCIDAD = 30;

function diasParaCaducarDueno(producto) {
    if (!producto.fechaCaducidad) return null;

    const hoy = new Date();
    hoy.setHours(0, 0, 0, 0);

    const fecha =
    new Date(String(producto.fechaCaducidad).slice(0, 10) + "T00:00:00");

    return Math.round((fecha - hoy) / 86400000);
}

async function listarCatalogoLocal({ texto = "", categoria = "", porVencer = false } = {}) {
    try {
        const db = await abrirDuenoDB();
        const transaccion = db.transaction("catalogo", "readonly");
        const tienda = transaccion.objectStore("catalogo");
        const todos = await promesaSolicitud(tienda.getAll());

        const textoLimpio = String(texto || "").trim().toLowerCase();

        const filtrados = todos.filter(producto =>
            (!textoLimpio ||
                producto.nombre.toLowerCase().includes(textoLimpio) ||
                producto.codigo.toLowerCase().includes(textoLimpio)) &&
            (!categoria || producto.categoria === categoria) &&
            (!porVencer || diasParaCaducarDueno(producto) !== null && diasParaCaducarDueno(producto) <= DUENO_DIAS_ALERTA_CADUCIDAD)
        );

        if (porVencer) {
            return conNivelPrecioDueno(filtrados
                .sort((a, b) => diasParaCaducarDueno(a) - diasParaCaducarDueno(b))
                .slice(0, 60));
        }

        return conNivelPrecioDueno(filtrados
            .sort((a, b) => a.nombre.localeCompare(b.nombre, "es"))
            .slice(0, 60));
    } catch (error) {
        console.warn("No se pudo listar el catalogo local", error);
        return [];
    }
}

async function listarCategoriasCatalogoLocal() {
    try {
        const db = await abrirDuenoDB();
        const transaccion = db.transaction("catalogo", "readonly");
        const tienda = transaccion.objectStore("catalogo");
        const todos = await promesaSolicitud(tienda.getAll());

        const categorias = new Set(
            todos.map(producto => producto.categoria).filter(Boolean)
        );

        return Array.from(categorias).sort((a, b) => a.localeCompare(b, "es"));
    } catch (error) {
        console.warn("No se pudieron listar las categorias del catalogo local", error);
        return [];
    }
}

async function guardarCotizacionLocal(cotizacion) {
    const db = await abrirDuenoDB();
    const transaccion = db.transaction("cotizacionesLocales", "readwrite");

    transaccion.objectStore("cotizacionesLocales").put(cotizacion);

    await promesaTransaccion(transaccion);
}

async function listarCotizacionesLocales() {
    try {
        const db = await abrirDuenoDB();
        const transaccion = db.transaction("cotizacionesLocales", "readonly");
        const tienda = transaccion.objectStore("cotizacionesLocales");
        const todas = await promesaSolicitud(tienda.getAll());

        return todas.sort((a, b) => new Date(b.creadoEn) - new Date(a.creadoEn));
    } catch (error) {
        console.warn("No se pudo leer la cola de cotizaciones local", error);
        return [];
    }
}

async function borrarCotizacionLocal(eventId) {
    const db = await abrirDuenoDB();
    const transaccion = db.transaction("cotizacionesLocales", "readwrite");

    transaccion.objectStore("cotizacionesLocales").delete(eventId);

    await promesaTransaccion(transaccion);
}

// La llave debe coincidir con DUENO_TOKEN_KEY en dueno.js -- se repite
// aqui en vez de compartir una constante para que este archivo no
// dependa del orden de carga de dueno.js.
async function sincronizarCotizacionesPendientes() {
    const pendientes = await listarCotizacionesLocales();
    let sincronizadas = 0;

    for (const cotizacion of pendientes) {
        try {
            const respuesta = await fetch("/dueno/cotizaciones", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${localStorage.getItem("nexoCuentaSesionToken")}`
                },
                body: JSON.stringify(cotizacion)
            });

            const datos = await respuesta.json();

            if (datos.ok) {
                await borrarCotizacionLocal(cotizacion.eventId);
                sincronizadas += 1;
            } else {
                cotizacion.ultimoError = datos.error || "No se pudo sincronizar";
                await guardarCotizacionLocal(cotizacion);
            }
        } catch (error) {
            // Sin conexion todavia -- se deja en la cola, se reintenta despues.
            break;
        }
    }

    return sincronizadas;
}
