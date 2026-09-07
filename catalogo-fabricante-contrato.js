// Contrato comun de importacion de catalogos. Es la pieza que faltaba:
// hasta ahora el nucleo de sincronizacion importaba directamente el
// extractor de OCR y razonaba en "modulos con ETag", que es la forma que
// tiene TRUPER de publicar y no la de nadie mas. Un proveedor que manda
// un CSV no tiene modulos, ni imagenes, ni ETag por pieza.
//
// Aqui viven: el formato de fila normalizada al que TODO adaptador debe
// traducir, y las utilidades para validarla. El nucleo solo entiende
// esto; cada adaptador se las arregla como pueda con su fuente.
//
//   Fabricante  ->  Adaptador   ->  Extractor        ->  Normalizador -> Catalogo
//   TRUPER          truper.js       OCR de imagen        (este archivo)
//   Diprofer        archivo.js      CSV / Excel
//   (futuro)        api.js          JSON de una API
//
// ---------------------------------------------------------------------
// CONTRATO DEL ADAPTADOR
//
//   nombre        string   Nombre del fabricante/proveedor.
//   formato       string   'imagen' | 'csv' | 'excel' | 'pdf' | 'api'
//   claveIdentidad 'codigo' | 'ean'
//                          Que campo identifica al producto en ESTA fuente.
//                          Ferreteria trabaja por codigo de fabricante;
//                          abarrotes (Bimbo, Coca-Cola, Sabritas) por EAN.
//   nivelesPrecio string[] Que precios publica esta fuente.
//
//   async listarUniverso(ctx)
//       -> Map<identidad, {clave, referencia}>
//       Todos los productos vigentes HOY. De aqui salen los nuevos y los
//       descontinuados, sin depender de que la extraccion haya salido bien.
//       Si la fuente no puede darlo barato, devuelve null y el nucleo se
//       abstiene de marcar descontinuados (nunca los inventa).
//
//   async listarUnidades(ctx)
//       -> [{ id, firma, referencia }]
//       Unidad = el trozo mas chico que se puede reprocesar por separado.
//       TRUPER: un (modulo, variante). CSV: el archivo. API: una pagina.
//       `firma` es cualquier cosa que cambie cuando el contenido cambia
//       (ETag, hash, fecha de modificacion). Si no cambia, no se reprocesa.
//
//   async extraerUnidad(unidad, ctx)
//       -> { filas, confiable, origen, layout, confianza, firmaContenido, detalle }
//       Traduce SU formato a filas normalizadas. Es el unico lugar donde
//       vive lo especifico de la fuente (OCR, parseo de CSV, llamada HTTP).
//
//   async datosDeProducto(identidad)   [opcional]
//       -> { descripcion, marca, ... } | null
//       Enriquecimiento por producto, para fuentes que lo ofrecen aparte.

const NIVELES_PRECIO_ESTANDAR = [
    "precio_mayoreo",
    "precio_medio_mayoreo",
    "precio_publico",
    "precio_distribuidor"
];

const CLAVES_IDENTIDAD = ["codigo", "ean"];

// ---------------------------------------------------------------------
// Fila normalizada
// ---------------------------------------------------------------------

function textoLimpio(valor) {
    return String(valor ?? "").trim();
}

function numeroONulo(valor) {
    if (valor === null || valor === undefined || valor === "") return null;
    const numero = Number(String(valor).replace(/[$,\s]/g, ""));
    if (!Number.isFinite(numero) || numero <= 0) return null;
    return numero;
}

/**
 * Lleva cualquier fila de adaptador al formato comun. No inventa nada: lo
 * que no venga, queda vacio o nulo.
 *
 * @returns {{codigo,clave,ean,descripcion,marca,categoria,precios,preciosExtra,completa,motivo}}
 */
function normalizarFila(fila, opciones = {}) {
    const niveles = opciones.nivelesPrecio || NIVELES_PRECIO_ESTANDAR;
    const precios = {};
    const preciosExtra = {};

    for (const [campo, valor] of Object.entries(fila?.precios || {})) {
        const numero = numeroONulo(valor);
        if (numero === null) continue;
        // Los cuatro niveles conocidos van a columnas; cualquier otro que
        // publique un fabricante (precio de lista, sugerido, promocional)
        // se conserva aparte en vez de perderse.
        if (NIVELES_PRECIO_ESTANDAR.includes(campo)) precios[campo] = numero;
        else preciosExtra[campo] = numero;
    }

    const faltantes = niveles.filter(
        campo => NIVELES_PRECIO_ESTANDAR.includes(campo) && precios[campo] == null
    );

    return {
        codigo: textoLimpio(fila?.codigo),
        clave: textoLimpio(fila?.clave),
        ean: textoLimpio(fila?.ean),
        descripcion: textoLimpio(fila?.descripcion),
        marca: textoLimpio(fila?.marca),
        categoria: textoLimpio(fila?.categoria),
        precios,
        preciosExtra,
        // `completa` la decide el adaptador si ya la trae (el extractor de
        // imagen sabe cosas que aqui no se ven, como que la columna venia
        // vacia); si no, se deduce de los niveles declarados.
        completa: fila?.completa !== undefined ? Boolean(fila.completa) : faltantes.length === 0,
        motivo: textoLimpio(fila?.motivo) || (faltantes.length ? `faltan: ${faltantes.join(", ")}` : "")
    };
}

/**
 * Identidad con la que el nucleo hace el upsert. Un adaptador de
 * ferreteria identifica por codigo de fabricante; uno de abarrotes, por
 * EAN. Sin identidad, la fila se descarta -- nunca se inventa una.
 */
function identidadDeFila(fila, claveIdentidad) {
    const clave = CLAVES_IDENTIDAD.includes(claveIdentidad) ? claveIdentidad : "codigo";
    const valor = textoLimpio(fila?.[clave]);
    return valor || "";
}

/**
 * Revisa que un adaptador cumpla el contrato ANTES de correrlo. Vale mas
 * fallar aqui con un mensaje claro que a mitad de una corrida de horas.
 */
function validarAdaptador(adaptador) {
    const problemas = [];
    if (!adaptador || typeof adaptador !== "object") {
        return ["el adaptador no es un objeto"];
    }

    if (!textoLimpio(adaptador.nombre)) problemas.push("falta `nombre`");
    if (!textoLimpio(adaptador.formato)) problemas.push("falta `formato`");

    if (!CLAVES_IDENTIDAD.includes(adaptador.claveIdentidad)) {
        problemas.push(`claveIdentidad debe ser ${CLAVES_IDENTIDAD.join(" o ")}`);
    }

    if (!Array.isArray(adaptador.nivelesPrecio) || adaptador.nivelesPrecio.length === 0) {
        problemas.push("falta `nivelesPrecio` (que precios publica esta fuente)");
    }

    for (const metodo of ["listarUniverso", "listarUnidades", "extraerUnidad"]) {
        if (typeof adaptador[metodo] !== "function") problemas.push(`falta el metodo ${metodo}()`);
    }

    return problemas;
}

// ---------------------------------------------------------------------
// Coherencia entre niveles de precio
//
// Un contraste de doble lectura sobre modulos reales dejo ver el fallo
// mas peligroso del OCR: no equivocarse del todo, sino TRUNCAR digitos.
// Casos medidos: leyo 1 donde decia 115, 15 donde decia 75, 5 donde
// decia 75. Un precio asi pasa todas las validaciones de estructura --
// el codigo coincide, la fila esta completa -- y se guardaria como bueno.
//
// La defensa no depende del OCR: son relaciones que TIENEN que cumplirse
// entre los niveles de un mismo producto, venga de donde venga el dato.
// Sirven igual para un CSV con una celda corrida.

// El precio de compra (distribuidor/mayoreo) nunca es un porcentaje
// ridiculo del publico. En datos reales de TRUPER la relacion
// distribuidor/publico va de 64% a 100%; se deja un margen amplio hacia
// abajo para no rechazar promociones agresivas, pero un 1% delata un
// digito perdido.
const RELACION_MINIMA_CONTRA_PUBLICO = 0.2;
// Y tampoco puede ser mucho MAS caro que el publico.
const RELACION_MAXIMA_CONTRA_PUBLICO = 1.05;

function revisarCoherenciaNiveles(precios) {
    const problemas = [];
    const may = precios?.precio_mayoreo;
    const medio = precios?.precio_medio_mayoreo;
    const pub = precios?.precio_publico;
    const dis = precios?.precio_distribuidor;

    // Orden esperado: mayoreo <= medio mayoreo <= publico.
    if (may != null && pub != null && may > pub) problemas.push("mayoreo mayor que publico");
    if (medio != null && pub != null && medio > pub) problemas.push("medio mayoreo mayor que publico");
    if (may != null && medio != null && may > medio) problemas.push("mayoreo mayor que medio mayoreo");

    // Proporciones contra el publico: lo que atrapa los digitos perdidos.
    for (const [nombre, valor] of [["distribuidor", dis], ["mayoreo", may], ["medio mayoreo", medio]]) {
        if (valor == null || pub == null || pub <= 0) continue;
        const relacion = valor / pub;
        if (relacion < RELACION_MINIMA_CONTRA_PUBLICO) {
            problemas.push(
                `${nombre} es ${Math.round(relacion * 100)}% del publico: parece un precio con digitos de menos`
            );
        } else if (relacion > RELACION_MAXIMA_CONTRA_PUBLICO) {
            problemas.push(`${nombre} es mas caro que el publico`);
        }
    }

    return problemas;
}

module.exports = {
    NIVELES_PRECIO_ESTANDAR,
    CLAVES_IDENTIDAD,
    normalizarFila,
    identidadDeFila,
    validarAdaptador,
    revisarCoherenciaNiveles,
    numeroONulo,
    textoLimpio,
    RELACION_MINIMA_CONTRA_PUBLICO,
    RELACION_MAXIMA_CONTRA_PUBLICO
};
