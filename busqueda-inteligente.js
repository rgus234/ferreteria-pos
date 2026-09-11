// Motor de busqueda por intencion sobre pg_trgm -- construido primero
// para Explorar Nexo (busqueda del personal entre catalogos) y ahora
// compartido con Nexo Market (busqueda de clientes reales), un solo
// lugar para no repetir los mismos hallazgos calibrados con datos
// reales en dos archivos que divergen con el tiempo. Ver
// tests/explorar-nexo.test.js para el detalle de cada hallazgo.

// Acentos fuera + minusculas -- "sumergible" debe encontrar
// "SUMÉRGIBLE".
function normalizarBusqueda(texto) {
    return String(texto || "")
        .normalize("NFD")
        .replace(/[̀-ͯ]/g, "")
        .trim()
        .toLowerCase()
        .slice(0, 120);
}

// Umbrales centralizados y calibrables: un similarity() alto nunca se
// presenta como "coincidencia exacta" -- son medidas honestas de
// parecido de texto, calibradas contra busquedas reales (ver el
// historial de este archivo antes de mover estos numeros).
const UMBRAL_COINCIDENCIA_FUERTE = 0.55;
const UMBRAL_COINCIDENCIA_PROBABLE = 0.40;
const UMBRAL_PALABRA_UNICA = 0.55;
const UMBRAL_PALABRA_INDIVIDUAL = 0.30;
const LIMITE_POR_FUENTE = 10;

function umbralAdmisionPara(termino) {
    return termino.trim().includes(" ") ? UMBRAL_COINCIDENCIA_PROBABLE : UMBRAL_PALABRA_UNICA;
}

function nivelDeCoincidencia(similitud) {
    if (similitud >= UMBRAL_COINCIDENCIA_FUERTE) return "fuerte";
    if (similitud >= UMBRAL_COINCIDENCIA_PROBABLE) return "probable";
    return "relacionado";
}

// El operador <% (word_similarity_op) SI usa el indice GIN de trigramas
// ya existente en cada tabla -- una llamada suelta a word_similarity()
// nunca lo usa y fuerza un escaneo completo (encontrado con
// "rotomartillo" colgandose mas de 8s contra 14 mil filas). El operador
// compara contra la GUC de sesion pg_trgm.word_similarity_threshold en
// vez de un umbral fijo del codigo, por eso cada consulta con termino de
// busqueda abre su propio cliente, fija esa GUC nada mas para esta
// conexion, y la resetea antes de soltarla: nunca se filtra hacia otra
// query que comparta el pool.
async function consultarConUmbralPalabra(pool, umbral, sql, valores) {
    const client = await pool.connect();
    try {
        await client.query(`SET pg_trgm.word_similarity_threshold = ${umbral}`);
        return await client.query(sql, valores);
    } finally {
        await client.query("RESET pg_trgm.word_similarity_threshold").catch(() => {});
        client.release();
    }
}

// Ordenar primero por que tan bien la primera palabra de la busqueda
// coincide con la primera palabra del nombre -- antes del similitud
// general -- deja el producto correcto arriba sin excluir nada (ej.
// "Broca..." arriba de "Bolsa con pijas...punta de broca").
function ordenPorAfinidadInicial(columna, indiceTermino) {
    return `GREATEST(
        similarity(split_part(${columna}, ' ', 1), split_part($${indiceTermino}, ' ', 1)),
        word_similarity(split_part($${indiceTermino}, ' ', 1), split_part(${columna}, ' ', 1))
    )`;
}

const CONECTORES_ESPANOL = ["de", "del", "la", "el", "los", "las", "un", "una", "unos", "unas", "para", "con", "y", "en", "a", "al"];

// Palabras con contenido real de la busqueda (sin contar conectores
// como "de"/"para"/"con", que no distinguen nada).
function palabrasConContenido(termino) {
    return termino.trim().toLowerCase().split(/\s+/).filter(palabra => palabra && !CONECTORES_ESPANOL.includes(palabra));
}

// Exige que al menos N palabras con contenido de la busqueda encuentren
// alguna palabra parecida en el nombre (similarity() palabra-contra-
// palabra, no word_similarity contra la cadena completa) -- asi
// "candado" no admite "Dado cuadro..." y "llave de paso" no admite
// "Llave de cruz..." solo por compartir la primera palabra generica.
// Palabras de 4 letras o menos piden mas confianza (0.40 en vez de
// 0.30): son las mas propensas a chocar por casualidad ("cal" con
// "calibre", similarity 0.33, se queda afuera). 0.40 y no 0.45:
// encontrado portando este motor a Nexo Market contra el catalogo real
// de Ferreteria Olimpico -- "paso" (4 letras) contra "paso1/2" (el
// nombre real del producto, sin espacio antes de la medida) da 0.4444,
// quedaba justo abajo de 0.45 y "llave de paso" dejaba de encontrar el
// producto que de verdad es una llave de paso. 0.40 dejaba pasar ese
// caso real sin acercarse a "cal"/"calibre" (0.33).
function existeCoincidenciaPorPalabra(columna, indiceTermino, minimoCoincidencias) {
    return `(
        SELECT COUNT(DISTINCT palabra_busqueda)
        FROM unnest(string_to_array(lower($${indiceTermino}), ' ')) AS palabra_busqueda
        WHERE palabra_busqueda <> ALL(ARRAY[${CONECTORES_ESPANOL.map(c => `'${c}'`).join(",")}])
        AND EXISTS (
            SELECT 1 FROM unnest(string_to_array(lower(${columna}), ' ')) AS palabra_suelta
            WHERE similarity(palabra_busqueda, palabra_suelta) > (
                CASE WHEN length(palabra_busqueda) <= 4 THEN 0.40 ELSE ${UMBRAL_PALABRA_INDIVIDUAL} END
            )
        )
    ) >= ${minimoCoincidencias}`;
}

function minimoCoincidenciasPara(termino) {
    return Math.min(2, palabrasConContenido(termino).length) || 1;
}

module.exports = {
    normalizarBusqueda,
    UMBRAL_COINCIDENCIA_FUERTE,
    UMBRAL_COINCIDENCIA_PROBABLE,
    UMBRAL_PALABRA_UNICA,
    UMBRAL_PALABRA_INDIVIDUAL,
    LIMITE_POR_FUENTE,
    umbralAdmisionPara,
    nivelDeCoincidencia,
    consultarConUmbralPalabra,
    ordenPorAfinidadInicial,
    CONECTORES_ESPANOL,
    palabrasConContenido,
    existeCoincidenciaPorPalabra,
    minimoCoincidenciasPara
};
