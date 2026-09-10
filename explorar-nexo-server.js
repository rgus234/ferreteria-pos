// Explorar Nexo (Fase 1, pasos 2-3 del plan aprobado): busqueda
// estructurada por intencion sobre las 4 capas de catalogo que ya
// existen en este codigo -- inventario propio, catalogo de proveedor
// propio, Catalogo Maestro Nexo y catalogo de fabricante. Ninguna IA
// todavia -- eso es una fase posterior, ver el diseno aprobado
// (Artifact "Explorar Nexo").
//
// Principio que gobierna este archivo: IA interpreta -> Base de datos
// verifica -> Nexo muestra. Aqui solo vive la parte de "Base de datos
// verifica": el texto que escribe el empleado se compara tal cual
// contra 4 fuentes reales via pg_trgm (mismo patron ya usado en
// catalog-server.js "CAT2", market-server.js y
// ia-server.js:buscarCandidatosPorTerminos) -- nunca se inventa un
// producto que ninguna fuente confirme.
const { responderError } = require("./error-utils");
const { identidadPorCodigo } = require("./catalogo-maestro-reconciliacion");

async function negocioActual(req, pool) {
    const negocioId = req.negocioDispositivo?.negocio_id ?? req.negocioAutenticado?.negocio_id;

    if (!negocioId) {
        const error = new Error("Este equipo no esta vinculado a ningun negocio");
        error.httpStatus = 401;
        throw error;
    }

    const resultado = await pool.query(`SELECT id, slug FROM public.negocios WHERE id = $1 LIMIT 1`, [negocioId]);

    if (resultado.rows.length === 0) {
        const error = new Error("Negocio no encontrado");
        error.httpStatus = 404;
        throw error;
    }

    return resultado.rows[0];
}

// Acentos fuera + minusculas -- "sumergible" debe encontrar
// "SUMÉRGIBLE". El buscador actual del POS (product-inventory.js) no
// hace esto hoy; Explorar Nexo si, desde el primer dia.
function normalizarBusqueda(texto) {
    return String(texto || "")
        .normalize("NFD")
        .replace(/[̀-ͯ]/g, "")
        .trim()
        .toLowerCase()
        .slice(0, 120);
}

// Umbrales centralizados y calibrables (decision del dueno, §06 del
// diseno aprobado): un similarity() alto nunca se presenta como
// "coincidencia exacta" -- son 3 niveles honestos sobre lo que en
// realidad es una medida de parecido de texto. Punto de partida para
// calibrar con busquedas reales, no una promesa de precision.
const UMBRAL_COINCIDENCIA_FUERTE = 0.55;
// Subio de 0.30 a 0.40 -- con 0.30, frases de varias palabras muy
// genericas ("broca para concreto", "manguera para jardin") admitian
// miles de filas debilmente relacionadas en las tablas globales
// (2091 de 15758 en catalogo_maestro_productos para "broca para
// concreto"), forzando a Postgres a revisarlas casi todas y tardando
// varios segundos. 0.40 deja pasar con margen el caso flagship de
// abajo (0.4516) y de paso reduce esas 2091 filas a 291 -- medido
// contra produccion, la busqueda bajo de 3-7s a menos de 1s.
const UMBRAL_COINCIDENCIA_PROBABLE = 0.40;
const LIMITE_POR_FUENTE = 10;

// Una busqueda de UNA sola palabra ("candado") es mucho mas propensa
// a un choque de trigramas sin relacion real que una frase de varias
// palabras -- encontrado con busquedas reales del dueno: "candado"
// hacia match con "Dado cuadro 1/2 de impacto..." (word_similarity
// 0.50) solo porque "dado" esta contenido en "candado", aunque sean
// productos distintos. Subir el umbral general a 0.55 quitaba ese
// ruido, pero de paso tumbaba el caso flagship que motivo agregar
// word_similarity: "pinza para cortar cable grueso" encuentra "Pinza
// cortacables de alta palanca 24 pulgadas" a un word_similarity de
// solo 0.4516 (una frase larga diluye el parecido aunque el producto
// SI sea el correcto -- ver tests/explorar-nexo.test.js). No hay un
// solo umbral que deje pasar 0.4516 y rechace 0.50: la solucion es
// exigir mas confianza SOLO cuando la busqueda es de una palabra
// (ahi es donde vive el choque de trigramas), y dejar la frase larga
// con el umbral original, mas permisivo.
const UMBRAL_PALABRA_UNICA = 0.55;

function umbralAdmisionPara(termino) {
    return termino.trim().includes(" ") ? UMBRAL_COINCIDENCIA_PROBABLE : UMBRAL_PALABRA_UNICA;
}

function nivelDeCoincidencia(similitud) {
    if (similitud >= UMBRAL_COINCIDENCIA_FUERTE) return "fuerte";
    if (similitud >= UMBRAL_COINCIDENCIA_PROBABLE) return "probable";
    return "relacionado";
}

function numeroONull(valor) {
    return valor === null || valor === undefined ? null : Number(valor);
}

// Las 4 fuentes filtran con "col % termino OR word_similarity(termino, col) > umbral"
// -- el problema real (encontrado con busquedas reales del dueno que
// se quedaban colgadas, ej. "rotomartillo"): el operador % SI usa el
// indice GIN de trigramas ya existente en cada tabla, pero
// word_similarity(...) como llamada de funcion suelta NUNCA lo usa --
// Postgres tiene que evaluarla fila por fila en TODA la tabla para
// resolver el OR. Con 14 mil filas en catalogo_fabricante_productos
// eso ya tardaba mas de 8 segundos.
//
// El mismo indice GIN si soporta el operador <% (word_similarity_op):
// cambiando la funcion suelta por el operador, Postgres resuelve el
// OR completo con un BitmapOr de dos escaneos de indice (~90ms en
// vez de +8s, medido contra produccion). El unico costo es que <%
// no compara contra un umbral fijo del codigo sino contra la GUC de
// sesion pg_trgm.word_similarity_threshold (default 0.6) -- por eso
// cada consulta se abre en su propio cliente, fija esa GUC (el umbral
// segun umbralAdmisionPara) nada mas para esta conexion, y la
// resetea antes de soltarla: nunca se filtra hacia otra query que
// comparta el pool.
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

// Hallazgo real buscando "broca de 1/2": el trigrama por si solo pone
// "Bolsa con 100 pijas...punta de broca 1/2'" (un tornillo, no una
// broca) por encima de "Broca SDS Max de 1/2 x 13, TRUPER" -- ambos
// comparten la palabra "broca" en algun lado del nombre, y similarity()
// no distingue si esa palabra es DE QUE ES EL PRODUCTO o solo describe
// una caracteristica secundaria. Pero en como Truper/Pretul/Fiero
// nombran sus productos, la primera palabra SI es casi siempre el
// producto en si ("Broca...", "Rotomartillo...", "Pinza..."). Ordenar
// primero por que tan bien la primera palabra de la busqueda coincide
// con la primera palabra del nombre -- antes del similitud general --
// deja los productos correctos arriba sin excluir nada (las "pijas"
// siguen apareciendo mas abajo, siguen siendo resultados validos por
// si alguien de verdad las buscaba).
function ordenPorAfinidadInicial(columna, indiceTermino) {
    return `GREATEST(
        similarity(split_part(${columna}, ' ', 1), split_part($${indiceTermino}, ' ', 1)),
        word_similarity(split_part($${indiceTermino}, ' ', 1), split_part(${columna}, ' ', 1))
    )`;
}

// Hallazgo real buscando "chupon": ademas del Chupon de PVC real,
// tambien admitia "Tornilleria con chumaceras para carretilla" -- ni
// remotamente el mismo producto. word_similarity("chupon", nombre
// completo) encuentra su mejor extension DENTRO de "chumaceras"
// (0.57, exactamente el mismo puntaje que el Chupon real) porque
// ambas palabras comparten letras, no porque el producto tenga
// relacion. No hay umbral de similitud de CADENA COMPLETA que separe
// esto: la solucion es exigir que la palabra principal de la busqueda
// (la primera) sea genuinamente parecida a ALGUNA palabra suelta del
// nombre -- similarity() palabra-contra-palabra (no word_similarity
// contra el nombre completo) SI distingue "chupon" de "chumaceras"
// (0.20) de "chupon" de "chupón" (0.40, tolera el acento) o de
// "candado" de "dado" (0.30, se queda justo en el limite y se
// excluye). Barato de evaluar: solo corre sobre las pocas filas que
// ya paso el filtro por indice de arriba, nunca la tabla completa.
const UMBRAL_PALABRA_INDIVIDUAL = 0.30;

function existeCoincidenciaPorPalabra(columna, indiceTermino) {
    return `EXISTS (
        SELECT 1 FROM unnest(string_to_array(lower(${columna}), ' ')) AS palabra_suelta
        WHERE similarity(split_part($${indiceTermino}, ' ', 1), palabra_suelta) > ${UMBRAL_PALABRA_INDIVIDUAL}
    )`;
}

// Fuente 1: inventario propio -- mismo patron exacto que
// ia-server.js:buscarCandidatosPorTerminos y CAT2.
async function buscarEnInventario(pool, negocioId, termino) {
    const resultado = await consultarConUmbralPalabra(pool, umbralAdmisionPara(termino),
        `SELECT id, codigo, nombre, marca, categoria, precio_publico, stock,
                GREATEST(similarity(nombre, $2), word_similarity($2, nombre)) AS similitud,
                ${ordenPorAfinidadInicial("nombre", 2)} AS afinidad_inicial
         FROM public.productos
         WHERE negocio_id = $1 AND (nombre % $2 OR $2 <% nombre) AND ${existeCoincidenciaPorPalabra("nombre", 2)}
         ORDER BY afinidad_inicial DESC, similitud DESC
         LIMIT ${LIMITE_POR_FUENTE}`,
        [negocioId, termino]
    );

    return resultado.rows.map(fila => ({
        fuente: "inventario",
        productoId: fila.id,
        codigo: fila.codigo,
        nombre: fila.nombre,
        marca: fila.marca,
        categoria: fila.categoria,
        precio: numeroONull(fila.precio_publico),
        stock: numeroONull(fila.stock),
        similitud: Number(fila.similitud),
        nivel: nivelDeCoincidencia(Number(fila.similitud))
    }));
}

// Fuente 2: catalogo de proveedor propio (ej. Diprofer) -- misma
// tabla y mismo indice de trigrama que ya usa CAT2 para vincular,
// aqui como consulta de lectura bajo demanda, no de vinculacion.
async function buscarEnCatalogoProveedor(pool, negocioId, termino) {
    const resultado = await consultarConUmbralPalabra(pool, umbralAdmisionPara(termino),
        `SELECT cp.id, cp.codigo_proveedor, cp.nombre_proveedor, cp.marca,
                cp.precio_distribuidor, cp.precio_medio_mayoreo, cp.precio_publico,
                cat.proveedor AS proveedor_nombre,
                GREATEST(similarity(cp.nombre_proveedor, $2), word_similarity($2, cp.nombre_proveedor)) AS similitud,
                ${ordenPorAfinidadInicial("cp.nombre_proveedor", 2)} AS afinidad_inicial
         FROM public.catalogo_productos cp
         JOIN public.catalogos_proveedor cat ON cat.id = cp.catalogo_id
         WHERE cp.negocio_id = $1 AND (cp.nombre_proveedor % $2 OR $2 <% cp.nombre_proveedor) AND ${existeCoincidenciaPorPalabra("cp.nombre_proveedor", 2)}
         ORDER BY afinidad_inicial DESC, similitud DESC
         LIMIT ${LIMITE_POR_FUENTE}`,
        [negocioId, termino]
    );

    return resultado.rows.map(fila => ({
        fuente: "proveedor",
        catalogoProductoId: fila.id,
        codigo: fila.codigo_proveedor,
        nombre: fila.nombre_proveedor,
        marca: fila.marca,
        proveedor: fila.proveedor_nombre,
        precioDistribuidor: numeroONull(fila.precio_distribuidor),
        precioMedioMayoreo: numeroONull(fila.precio_medio_mayoreo),
        precioPublico: numeroONull(fila.precio_publico),
        similitud: Number(fila.similitud),
        nivel: nivelDeCoincidencia(Number(fila.similitud))
    }));
}

// Fuente 3: Catalogo Maestro Nexo -- global, nunca precio propio.
// necesita_revision=false porque un conflicto sin resolver no se
// ofrece (mismo criterio que buscarEnCatalogoMaestro en
// catalog-server.js). El LEFT JOIN a precios de fabricante reusa
// exactamente el razonamiento ya documentado en identidadPorCodigo():
// el join va por codigo_fabricante, nunca por marca/fabricante.
async function buscarEnCatalogoMaestro(pool, termino) {
    const resultado = await consultarConUmbralPalabra(pool, umbralAdmisionPara(termino),
        `SELECT m.id, m.codigo, m.marca, m.nombre, m.descripcion, m.fabricante,
                m.codigo_fabricante, m.ean, m.clave,
                f.precio_mayoreo, f.precio_medio_mayoreo, f.precio_publico, f.precio_distribuidor,
                GREATEST(similarity(m.nombre, $1), word_similarity($1, m.nombre)) AS similitud,
                ${ordenPorAfinidadInicial("m.nombre", 1)} AS afinidad_inicial
         FROM public.catalogo_maestro_productos m
         LEFT JOIN public.catalogo_fabricante_productos f
                ON f.codigo = m.codigo_fabricante AND f.estado = 'activo'
         WHERE (m.nombre % $1 OR $1 <% m.nombre) AND m.necesita_revision = false AND ${existeCoincidenciaPorPalabra("m.nombre", 1)}
         ORDER BY afinidad_inicial DESC, similitud DESC
         LIMIT ${LIMITE_POR_FUENTE}`,
        [termino]
    );

    return resultado.rows.map(fila => ({
        fuente: "catalogo_maestro",
        catalogoMaestroId: fila.id,
        codigo: fila.codigo,
        nombre: fila.nombre,
        marca: fila.marca,
        descripcion: fila.descripcion,
        fabricante: fila.fabricante,
        ean: fila.ean || null,
        precioListaMayoreo: numeroONull(fila.precio_mayoreo),
        precioListaMedioMayoreo: numeroONull(fila.precio_medio_mayoreo),
        precioListaPublico: numeroONull(fila.precio_publico),
        precioListaDistribuidor: numeroONull(fila.precio_distribuidor),
        similitud: Number(fila.similitud),
        nivel: nivelDeCoincidencia(Number(fila.similitud))
    }));
}

// Fuente 4: catalogo de fabricante (TRUPER hoy) -- por descripcion,
// nunca por codigo (eso ya lo resuelve identidadPorCodigo). Aviso
// honesto: solo una parte de las filas trae descripcion todavia (el
// bootstrap de lectura no esta completo), asi que esta fuente crece
// conforme avance el sincronizador, no es una limitacion del diseno.
async function buscarEnCatalogoFabricante(pool, termino) {
    const resultado = await consultarConUmbralPalabra(pool, umbralAdmisionPara(termino),
        `SELECT id, fabricante, codigo, clave, ean, descripcion, marca,
                precio_mayoreo, precio_medio_mayoreo, precio_publico, precio_distribuidor,
                GREATEST(similarity(descripcion, $1), word_similarity($1, descripcion)) AS similitud,
                ${ordenPorAfinidadInicial("descripcion", 1)} AS afinidad_inicial
         FROM public.catalogo_fabricante_productos
         WHERE (descripcion % $1 OR $1 <% descripcion) AND estado = 'activo' AND ${existeCoincidenciaPorPalabra("descripcion", 1)}
         ORDER BY afinidad_inicial DESC, similitud DESC
         LIMIT ${LIMITE_POR_FUENTE}`,
        [termino]
    );

    return resultado.rows.map(fila => ({
        fuente: "fabricante",
        catalogoFabricanteId: fila.id,
        codigo: fila.codigo,
        nombre: fila.descripcion,
        marca: fila.marca,
        fabricante: fila.fabricante,
        ean: fila.ean || null,
        precioListaMayoreo: numeroONull(fila.precio_mayoreo),
        precioListaMedioMayoreo: numeroONull(fila.precio_medio_mayoreo),
        precioListaPublico: numeroONull(fila.precio_publico),
        precioListaDistribuidor: numeroONull(fila.precio_distribuidor),
        similitud: Number(fila.similitud),
        nivel: nivelDeCoincidencia(Number(fila.similitud))
    }));
}

// Orquestador: las 4 fuentes en paralelo, mas un intento de identidad
// exacta (por si el empleado escaneo o tecleo un codigo/EAN completo
// en vez de escribir una frase -- identidadPorCodigo() ya existe y
// hace un lookup indexado barato; sobre una frase de varias palabras
// simplemente no encuentra nada, sin costo real). Sin IA todavia.
async function buscarExplorarNexo(pool, negocioId, textoBusqueda) {
    const termino = normalizarBusqueda(textoBusqueda);

    if (!termino) {
        return { termino: "", inventario: [], proveedor: [], catalogoMaestro: [], fabricante: [], coincidenciaPorCodigo: null };
    }

    const [inventario, proveedor, catalogoMaestro, fabricante, coincidenciaPorCodigo] = await Promise.all([
        buscarEnInventario(pool, negocioId, termino),
        buscarEnCatalogoProveedor(pool, negocioId, termino),
        buscarEnCatalogoMaestro(pool, termino),
        buscarEnCatalogoFabricante(pool, termino),
        identidadPorCodigo(pool, termino).catch(() => null)
    ]);

    return { termino, inventario, proveedor, catalogoMaestro, fabricante, coincidenciaPorCodigo };
}

// Misma foto que ya usan el POS (Banco de Nexo) y la ficha publica de
// Nexo Market -- nunca una copia nueva. Primero la principal curada
// (banco_imagenes_producto, subida por el admin); si no hay, la que
// el propio fabricante publica (banco-fotos-fabricante.js -> TRUPER),
// resuelta bajo demanda y cacheada ahi 30 dias. A proposito SIN el
// candado de plan Pro que usa /banco-imagenes-existe/:codigo -- esa
// ruta es para las herramientas de curar el banco (accion del dueno);
// aqui es solo mostrar una foto que ya existe, mismo criterio que
// Market ya aplica en su ficha publica (tampoco gatea por plan).
async function resolverFotoPrincipal(pool, codigoCrudo) {
    const { normalizarCodigoFoto, firmarTokenBancoImagen } = require("./banco-imagenes-server");
    const codigo = normalizarCodigoFoto(codigoCrudo);
    if (!codigo) return null;

    try {
        const banco = await pool.query(
            `SELECT actualizado_at FROM public.banco_imagenes_producto WHERE codigo = $1`,
            [codigo]
        );
        if (banco.rows.length) {
            const version = new Date(banco.rows[0].actualizado_at).getTime();
            return `/banco-imagenes/${encodeURIComponent(codigo)}/principal?v=${version}&token=${firmarTokenBancoImagen(codigo)}`;
        }

        const { fotosDeProducto } = require("./banco-fotos-fabricante");
        const delFabricante = await fotosDeProducto(pool, codigoCrudo);
        return delFabricante.fotos[0]?.url || null;
    } catch (error) {
        // Una foto que no se pudo resolver (fabricante inalcanzable,
        // codigo raro) nunca debe tumbar la busqueda -- se queda sin
        // foto, no es un error.
        return null;
    }
}

module.exports = (app, pool, requerirAccesoNegocio) => {
    app.get("/explorar-nexo/foto/:codigo", requerirAccesoNegocio, async (req, res) => {
        const url = await resolverFotoPrincipal(pool, req.params.codigo);
        res.json({ ok: true, url });
    });

    // Todas las fotos de un producto (no solo la principal) -- Ver
    // detalles, Recepcion Inteligente y Pantalla del cliente la usan
    // para mostrar la galeria completa en vez de una sola foto.
    app.get("/explorar-nexo/galeria/:codigo", requerirAccesoNegocio, async (req, res) => {
        const { galeriaBancoOFabricante } = require("./producto-galeria");
        const fotos = await galeriaBancoOFabricante(pool, req.params.codigo);
        res.json({ ok: true, fotos });
    });

    app.get("/explorar-nexo/buscar", requerirAccesoNegocio, async (req, res) => {
        try {
            const negocio = await negocioActual(req, pool);
            const texto = String(req.query.q || "");

            if (!texto.trim()) {
                res.json({ ok: true, termino: "", inventario: [], proveedor: [], catalogoMaestro: [], fabricante: [], coincidenciaPorCodigo: null });
                return;
            }

            const resultado = await buscarExplorarNexo(pool, negocio.id, texto);
            res.json({ ok: true, ...resultado });
        } catch (error) {
            responderError(res, error);
        }
    });
};

// Exportado aparte para pruebas directas sin pasar por HTTP, mismo
// criterio que buscarCandidatosPorTerminos en ia-server.js. Las 4
// fuentes individuales tambien se exponen -- Recepcion Inteligente
// (recepcion-inteligente-matching.js) las reutiliza como sub-rutinas
// en vez de duplicar las consultas.
module.exports.buscarExplorarNexo = buscarExplorarNexo;
module.exports.normalizarBusqueda = normalizarBusqueda;
module.exports.nivelDeCoincidencia = nivelDeCoincidencia;
module.exports.resolverFotoPrincipal = resolverFotoPrincipal;
module.exports.buscarEnInventario = buscarEnInventario;
module.exports.buscarEnCatalogoProveedor = buscarEnCatalogoProveedor;
module.exports.buscarEnCatalogoMaestro = buscarEnCatalogoMaestro;
module.exports.buscarEnCatalogoFabricante = buscarEnCatalogoFabricante;
module.exports.numeroONull = numeroONull;
