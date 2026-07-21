// Service Worker de /dueno -- cachea el cascaron estatico de la
// pagina (HTML/CSS/JS/imagen del saludo) para que abra aunque el
// dueño llegue a un rancho sin señal con el navegador ya cerrado, y
// ademas cachea (red primero, cache de respaldo) las fotos de
// producto que ya se hayan visto mientras habia conexion -- para que
// sigan disponibles para ensenarselas al cliente aunque ya no haya
// señal. Nunca intercepta llamadas a la API de datos (/productos,
// /historial, /creditos, /cuenta/login, /dueno/cotizaciones*) -- esas
// siempre van a la red; los datos y la cola offline viven en
// IndexedDB (dueno-offline.js), no en este cache.

const CACHE_NAME = "nexo-dueno-shell-v9";
const CACHE_FOTOS = "nexo-dueno-fotos-v1";

const ARCHIVOS_CASCARON = [
    "/dueno",
    "/dueno.css?v=dueno-onboarding-20260721-01",
    "/dueno.js?v=dueno-onboarding-20260721-01",
    "/dueno-offline.js?v=dueno-onboarding-20260721-01",
    "/img/nexo-ia/feliz.jpg"
];

// Se borra el cache del cascaron ANTES de rellenarlo -- si solo se
// hiciera cache.open()+addAll(), las entradas viejas (con query
// strings de versiones anteriores) se quedaban ahi para siempre
// dentro del mismo CACHE_NAME, y como el fetch de abajo usa
// ignoreSearch:true para poder servir offline aunque cambie la
// version, terminaba sirviendo -- de forma impredecible -- una copia
// vieja de dueno.js en vez de la mas reciente. Bug real, encontrado
// al verificar la pestaña Más.
self.addEventListener("install", evento => {
    evento.waitUntil(
        caches.delete(CACHE_NAME)
            .then(() => caches.open(CACHE_NAME))
            .then(cache => cache.addAll(ARCHIVOS_CASCARON))
    );
    self.skipWaiting();
});

self.addEventListener("activate", evento => {
    evento.waitUntil(
        caches.keys().then(nombres =>
            Promise.all(
                nombres
                    .filter(nombre => nombre !== CACHE_NAME && nombre !== CACHE_FOTOS)
                    .map(nombre => caches.delete(nombre))
            )
        )
    );
    self.clients.claim();
});

self.addEventListener("fetch", evento => {
    const url = new URL(evento.request.url);

    if (evento.request.method !== "GET" || url.origin !== self.location.origin) return;

    const esCascaron =
        ARCHIVOS_CASCARON.some(archivo => url.pathname === archivo.split("?")[0]);

    if (esCascaron) {
        evento.respondWith(
            caches.match(evento.request, { ignoreSearch: true }).then(respuestaCache =>
                respuestaCache ||
                fetch(evento.request).then(respuestaRed => {
                    caches.open(CACHE_NAME).then(cache => cache.put(evento.request, respuestaRed.clone()));
                    return respuestaRed;
                })
            )
        );
        return;
    }

    const esFotoProducto =
        url.pathname.startsWith("/fotos-producto/") ||
        url.pathname.startsWith("/fotos-producto-galeria/");

    if (esFotoProducto) {
        evento.respondWith(
            fetch(evento.request)
                .then(respuestaRed => {
                    if (respuestaRed.ok) {
                        caches.open(CACHE_FOTOS).then(cache => cache.put(evento.request, respuestaRed.clone()));
                    }
                    return respuestaRed;
                })
                .catch(() => caches.match(evento.request))
        );
    }
});
