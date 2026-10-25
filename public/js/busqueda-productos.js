/* Busqueda de productos por palabras sueltas.
   Antes la busqueda exigia que lo escrito apareciera tal cual y seguido en el nombre: "codo 45" no encontraba
   "Codo pvc 45° 4"" porque entre "codo" y "45" hay otra palabra, y "codo 3/4" tampoco encontraba
   "Codo 90° de cobre 3/4'". Ahora cada palabra se busca por separado (todas deben aparecer, en cualquier orden),
   sin importar mayusculas, acentos ni las comillas de pulgadas (3/4' = 3/4" = 3/4). */

function normalizarBusquedaProducto(texto) {
    return String(texto ?? "")
        .toLowerCase()
        .normalize("NFD")
        .replace(/[̀-ͯ]/g, "")
        .replace(/[′″'"`´‘’“”]/g, "")
        .replace(/\s+/g, " ")
        .trim();
}

function palabrasDeBusqueda(texto) {
    return normalizarBusquedaProducto(texto).split(" ").filter(Boolean);
}

// Texto del producto (nombre, marca, categoria) y sus codigos, ya normalizados.
function camposBuscablesProducto(producto) {
    const codigos = [producto.codigo, ...(Array.isArray(producto.codigos_relacionados) ? producto.codigos_relacionados.map(item => item?.codigo) : [])]
        .map(normalizarBusquedaProducto)
        .filter(Boolean);

    return { texto: normalizarBusquedaProducto(`${producto.nombre || ""} ${producto.marca || ""} ${producto.categoria || ""}`), codigos };
}

// Una palabra corta ("45") solo cuenta en un codigo si es el codigo completo; asi "codo 45" no trae el codo de codigo 450.
function palabraCoincide(palabra, campos) {
    if (campos.texto.includes(palabra)) return true;

    return campos.codigos.some(codigo => palabra.length >= 4 ? codigo.includes(palabra) : codigo === palabra);
}

function productoCoincidePalabras(producto, texto) {
    const palabras = palabrasDeBusqueda(texto);
    if (!palabras.length) return true;

    const campos = camposBuscablesProducto(producto);
    return palabras.every(palabra => palabraCoincide(palabra, campos));
}

// Para ordenar resultados: primero los que empiezan con lo escrito, luego los que lo traen seguido, luego el resto.
function puntajeBusquedaProducto(producto, texto) {
    const nombre = normalizarBusquedaProducto(producto.nombre);
    const frase = normalizarBusquedaProducto(texto);
    if (!frase) return 0;
    if (nombre.startsWith(frase)) return 3;
    if (nombre.includes(frase)) return 2;
    if (nombre.startsWith(palabrasDeBusqueda(texto)[0])) return 1;
    return 0;
}

if (typeof module !== "undefined") {
    module.exports = { normalizarBusquedaProducto, palabrasDeBusqueda, productoCoincidePalabras, puntajeBusquedaProducto };
}
