// Geocodificacion gratis para el mapa de tiendas de Nexo Market (ver
// plan): usa Nominatim (OpenStreetMap) -- sin API key, sin tarjeta. Su
// politica de uso exige un User-Agent identificable; con un dueno
// guardando su direccion de vez en cuando desde "Sitio web", el limite
// de 1 solicitud/seg de Nominatim se cumple solo, sin necesitar cola.
async function geocodificarDireccion(direccion) {
    try {
        const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(direccion)}`;
        const controlador = new AbortController();
        const timeout = setTimeout(() => controlador.abort(), 5000);

        const respuesta = await fetch(url, {
            headers: { "User-Agent": "NexoPOS/1.0 (contacto: nexoposoficial@gmail.com)" },
            signal: controlador.signal
        });
        clearTimeout(timeout);

        if (!respuesta.ok) return null;

        const datos = await respuesta.json();
        if (!Array.isArray(datos) || !datos[0]) return null;

        const lat = Number(datos[0].lat);
        const lng = Number(datos[0].lon);
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;

        return { lat, lng };
    } catch (error) {
        return null; // nunca truena el guardado de la direccion por esto
    }
}

module.exports = { geocodificarDireccion };
