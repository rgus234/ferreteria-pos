// Service Worker de /dueno -- SOLO cachea el cascaron estatico de la
// pagina (HTML/CSS/JS/imagen del saludo) para que abra aunque el
// dueño llegue a un rancho sin señal con el navegador ya cerrado.
// Nunca intercepta llamadas a la API (/productos, /historial,
// /creditos, /cuenta/login, /dueno/cotizaciones*) -- esas siempre van
// a la red; los datos y la cola offline viven en IndexedDB
// (dueno-offline.js), no en este cache.

const CACHE_NAME = "nexo-dueno-shell-v2";

const ARCHIVOS_CASCARON = [
    "/dueno",
    "/dueno.css?v=dueno-ventas-20260720-01",
    "/dueno.js?v=dueno-ventas-20260720-01",
    "/dueno-offline.js?v=dueno-ventas-20260720-01",
    "/img/nexo-ia/feliz.jpg"
];

self.addEventListener("install", evento => {
    evento.waitUntil(
        caches.open(CACHE_NAME).then(cache => cache.addAll(ARCHIVOS_CASCARON))
    );
    self.skipWaiting();
});

self.addEventListener("activate", evento => {
    evento.waitUntil(
        caches.keys().then(nombres =>
            Promise.all(
                nombres
                    .filter(nombre => nombre !== CACHE_NAME)
                    .map(nombre => caches.delete(nombre))
            )
        )
    );
    self.clients.claim();
});

self.addEventListener("fetch", evento => {
    const url = new URL(evento.request.url);

    const esCascaron =
        evento.request.method === "GET" &&
        url.origin === self.location.origin &&
        ARCHIVOS_CASCARON.some(archivo => url.pathname === archivo.split("?")[0]);

    if (!esCascaron) return;

    evento.respondWith(
        caches.match(evento.request, { ignoreSearch: true }).then(respuestaCache =>
            respuestaCache ||
            fetch(evento.request).then(respuestaRed => {
                caches.open(CACHE_NAME).then(cache => cache.put(evento.request, respuestaRed.clone()));
                return respuestaRed;
            })
        )
    );
});
