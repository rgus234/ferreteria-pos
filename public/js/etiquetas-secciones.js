/* Secciones en la hoja de etiquetas (editor de codigos de barras).
   Separa la hoja en bloques con un titulo grande y un color por bloque (por medida, tipo, categoria, subcategoria o
   marca) para ubicar rapido el producto: "1 1/2"", "2"", "3"" ... Es logica pura, sin pantalla, para poder probarla. */

const AGRUPAR_ETIQUETAS_OPCIONES = [
    ["ninguno", "Sin secciones"],
    ["medida", "Medida (3/4\", 2\", 1 1/2\"...)"],
    ["primera", "Tipo (primera palabra del nombre)"],
    ["categoria", "Categoría"],
    ["subcategoria", "Subcategoría"],
    ["marca", "Marca"]
];

const COLORES_SECCION_ETIQUETA = ["#1d5fd1", "#16a34a", "#ea580c", "#7c3aed", "#db2777", "#0891b2", "#ca8a04", "#475569"];
const SECCION_ALTO_MM = 7;

// "Codo PVC 90° 1 1/2"" -> 1 1/2"   |   'Reducción PVC 2" a 1"' -> 2" (la medida mayor, que va primero).
function medidaDeNombreEtiqueta(nombre) {
    const limpio = String(nombre || "").replace(/¨|''|”|“|″/g, '"');
    const m = limpio.match(/(\d+(?:\s\d\/\d+|\/\d+|[.,]\d+)?)\s?(?:"|pulgadas?|pulg\b)/i);

    return m ? `${m[1].trim()}"` : "";
}

function primeraPalabraEtiqueta(nombre) {
    const palabra = String(nombre || "").trim().split(/\s+/)[0] || "";
    return palabra ? palabra.charAt(0).toUpperCase() + palabra.slice(1).toLowerCase() : "";
}

// Titulo de la seccion a la que pertenece un producto; "" si no se puede saber.
function claveSeccionEtiqueta(producto, por) {
    switch (por) {
        case "medida": return medidaDeNombreEtiqueta(producto.nombre);
        case "primera": return primeraPalabraEtiqueta(producto.nombre);
        case "categoria": return String(producto.categoria || "").trim();
        case "subcategoria": return String(producto.subcategoria || producto.categoria || "").trim();
        case "marca": return String(producto.marca || "").trim();
        default: return "";
    }
}

// Mete un titulo cada vez que cambia la seccion (en el orden en que vienen los productos) y les pone su color.
function insertarSeccionesEtiquetas(instancias, por) {
    if (!por || por === "ninguno") return instancias;

    const celdas = [];
    let anterior = null;
    let indice = -1;

    for (const producto of instancias) {
        const clave = claveSeccionEtiqueta(producto, por) || "Otros";

        if (clave !== anterior) {
            indice++;
            anterior = clave;
            celdas.push({ __titulo: true, texto: clave, color: COLORES_SECCION_ETIQUETA[indice % COLORES_SECCION_ETIQUETA.length] });
        }

        celdas.push({ ...producto, __color: COLORES_SECCION_ETIQUETA[indice % COLORES_SECCION_ETIQUETA.length] });
    }

    return celdas;
}

// Reparte celdas (titulos y etiquetas) en hojas. El titulo ocupa su propio renglon de ancho completo y nunca se
// queda solo al final de una hoja; con hojaNueva cada seccion empieza en hoja nueva. Rollo continuo: una sola pieza.
function paginarCeldasEtiquetas(celdas, diseno, papel, hojaNueva = false) {
    if (papel.altoMm == null) return celdas.length ? [celdas] : [];

    const util = Math.max(0, papel.altoMm - diseno.margenMm * 2);
    const fila = diseno.altoMm + diseno.espaciadoMm;
    const titulo = SECCION_ALTO_MM + diseno.espaciadoMm;
    const paginas = [];
    let pagina = [], y = 0, columna = 0;

    const nuevaPagina = () => {
        if (pagina.length) paginas.push(pagina);
        pagina = []; y = 0; columna = 0;
    };

    for (const celda of celdas) {
        if (celda.__titulo) {
            if (columna > 0) { y += fila; columna = 0; }
            if ((hojaNueva && pagina.length) || y + titulo + diseno.altoMm > util + 0.01) nuevaPagina();

            pagina.push(celda);
            y += titulo;
            continue;
        }

        if (columna === 0 && y + diseno.altoMm > util + 0.01) nuevaPagina();

        pagina.push(celda);
        columna++;

        if (columna >= diseno.columnas) { y += fila; columna = 0; }
    }

    if (pagina.length) paginas.push(pagina);
    return paginas;
}

if (typeof module !== "undefined") {
    module.exports = { medidaDeNombreEtiqueta, claveSeccionEtiqueta, insertarSeccionesEtiquetas, paginarCeldasEtiquetas, SECCION_ALTO_MM };
}
