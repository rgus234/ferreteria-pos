// Service Worker de Nexo Market -- minimo y honesto. Solo existe para
// cumplir el requisito tecnico de "instalable" en Chrome/Android
// (agregar a pantalla de inicio con icono propio) y para que ese icono
// y la hoja de estilos compartida carguen rapido al abrir la app ya
// instalada. NUNCA cachea catalogo, precios, existencias ni el carrito
// -- esos siempre tienen que venir en vivo del servidor (mismo
// principio "nunca mostrar datos viejos como si fueran actuales" que
// sigue el resto del proyecto). A diferencia de /dueno, Market no
// intenta funcionar sin conexion: cada pagina es HTML armado por
// negocio en el momento, no un cascaron estatico con datos aparte.

const CACHE_NAME = "nexo-market-estaticos-v1";

const ARCHIVOS_ESTATICOS = [
    "/site/styles.css",
    "/manifest-market.json",
    "/icons/nexo-pos-icon-192.png",
    "/icons/nexo-pos-icon-512.png"
];

self.addEventListener("install", evento => {
    evento.waitUntil(
        caches.delete(CACHE_NAME)
            .then(() => caches.open(CACHE_NAME))
            .then(cache => cache.addAll(ARCHIVOS_ESTATICOS))
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

    if (evento.request.method !== "GET" || url.origin !== self.location.origin) return;

    const esEstatico = ARCHIVOS_ESTATICOS.some(archivo => url.pathname === archivo.split("?")[0]);
    if (!esEstatico) return;

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
