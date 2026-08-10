// Geocodificacion gratis para el mapa de tiendas de Nexo Market (ver
// plan): usa Nominatim (OpenStreetMap) -- sin API key, sin tarjeta. Su
// politica de uso exige un User-Agent identificable; con un dueno
// guardando su direccion de vez en cuando desde "Sitio web", el limite
// de 1 solicitud/seg de Nominatim se cumple solo, sin necesitar cola.
async function geocodificarUnaVez(direccion) {
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

function esperar(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// Nominatim (OSM) suele no tener cobertura a nivel de calle/numero en
// zonas rurales de Mexico -- una direccion real como "Tenochtitlan 11
// colonia azteca Rio Grande Zacatecas" puede fallar completa pero si
// resolver a nivel de colonia/ciudad ("azteca rio grande zacatecas").
// En vez de rendirse con la direccion completa, se reintenta quitando
// palabras del inicio (numero/calle) hasta que Nominatim reconozca algo
// -- nunca se inventa una ubicacion, solo se prueban variantes mas
// generales del mismo texto que el dueno escribio, con la pausa de 1.1s
// que exige la politica de uso de Nominatim entre solicitudes.
async function geocodificarDireccion(direccion) {
    const texto = String(direccion || "").trim();
    if (!texto) return null;

    const resultadoCompleto = await geocodificarUnaVez(texto);
    if (resultadoCompleto) return resultadoCompleto;

    const palabras = texto.split(/\s+/);
    for (let quitar = 1; quitar <= palabras.length - 3 && quitar <= 5; quitar++) {
        await esperar(1100);
        const intento = palabras.slice(quitar).join(" ");
        const resultado = await geocodificarUnaVez(intento);
        if (resultado) return resultado;
    }

    return null;
}

module.exports = { geocodificarDireccion };
