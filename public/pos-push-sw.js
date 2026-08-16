// Service Worker minimo del POS -- existe SOLO para poder recibir
// notificaciones push (pedido nuevo de Nexo Market) mientras la
// pestana esta en segundo plano o cerrada. El POS no tiene service
// worker propio (a diferencia de /dueno y Market, que si cachean su
// cascaron) porque siempre corre en linea contra datos en vivo -- este
// archivo no cachea nada, ni intercepta fetch.

self.addEventListener("push", evento => {
    let datos = { titulo: "Nexo Market", cuerpo: "Llego un pedido nuevo.", url: "/" };
    try { datos = Object.assign(datos, evento.data.json()); } catch (error) { /* payload no-JSON, usa el default */ }

    evento.waitUntil(
        self.registration.showNotification(datos.titulo, {
            body: datos.cuerpo,
            icon: "/icons/nexo-pos-icon-192.png",
            badge: "/icons/nexo-pos-icon-192.png",
            data: { url: datos.url }
        })
    );
});

self.addEventListener("notificationclick", evento => {
    evento.notification.close();
    const url = evento.notification.data?.url || "/";

    evento.waitUntil(
        self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(clientes => {
            if (clientes.length > 0) return clientes[0].focus();
            return self.clients.openWindow(url);
        })
    );
});
