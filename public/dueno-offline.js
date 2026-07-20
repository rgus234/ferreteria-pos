// Cache local (IndexedDB) para /dueno: catalogo de productos de solo
// lectura y una cola de cotizaciones armadas sin internet, para
// cuando el dueño visita un rancho sin señal. Vanilla, sin libreria
// -- misma convencion del resto del proyecto.

const DUENO_DB_NAME = "nexo-dueno-db";
const DUENO_DB_VERSION = 1;

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
                stock: Number(producto.stock || 0),
                imagenUrl: producto.imagenUrl || null,
                categoria: producto.categoria || "",
                marca: producto.marca || "",
                descripcion: producto.descripcion || "",
                unidadVenta: producto.unidad_venta || ""
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

        return todos
            .filter(producto =>
                producto.nombre.toLowerCase().includes(textoLimpio) ||
                producto.codigo.toLowerCase().includes(textoLimpio)
            )
            .slice(0, 20);
    } catch (error) {
        console.warn("No se pudo buscar en el catalogo local", error);
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
