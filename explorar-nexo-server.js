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
const UMBRAL_COINCIDENCIA_PROBABLE = 0.30;
const LIMITE_POR_FUENTE = 10;

function nivelDeCoincidencia(similitud) {
    if (similitud >= UMBRAL_COINCIDENCIA_FUERTE) return "fuerte";
    if (similitud >= UMBRAL_COINCIDENCIA_PROBABLE) return "probable";
    return "relacionado";
}

function numeroONull(valor) {
    return valor === null || valor === undefined ? null : Number(valor);
}

// Fuente 1: inventario propio -- mismo patron exacto que
// ia-server.js:buscarCandidatosPorTerminos y CAT2.
async function buscarEnInventario(pool, negocioId, termino) {
    const resultado = await pool.query(
        `SELECT id, codigo, nombre, marca, categoria, precio_publico, stock,
                similarity(nombre, $2) AS similitud
         FROM public.productos
         WHERE negocio_id = $1 AND nombre % $2
         ORDER BY similitud DESC
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
    const resultado = await pool.query(
        `SELECT cp.id, cp.codigo_proveedor, cp.nombre_proveedor, cp.marca,
                cp.precio_distribuidor, cp.precio_medio_mayoreo, cp.precio_publico,
                cat.proveedor AS proveedor_nombre,
                similarity(cp.nombre_proveedor, $2) AS similitud
         FROM public.catalogo_productos cp
         JOIN public.catalogos_proveedor cat ON cat.id = cp.catalogo_id
         WHERE cp.negocio_id = $1 AND cp.nombre_proveedor % $2
         ORDER BY similitud DESC
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
    const resultado = await pool.query(
        `SELECT m.id, m.codigo, m.marca, m.nombre, m.descripcion, m.fabricante,
                m.codigo_fabricante, m.ean, m.clave,
                f.precio_mayoreo, f.precio_medio_mayoreo, f.precio_publico, f.precio_distribuidor,
                similarity(m.nombre, $1) AS similitud
         FROM public.catalogo_maestro_productos m
         LEFT JOIN public.catalogo_fabricante_productos f
                ON f.codigo = m.codigo_fabricante AND f.estado = 'activo'
         WHERE m.nombre % $1 AND m.necesita_revision = false
         ORDER BY similitud DESC
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
    const resultado = await pool.query(
        `SELECT id, fabricante, codigo, clave, ean, descripcion, marca,
                precio_mayoreo, precio_medio_mayoreo, precio_publico, precio_distribuidor,
                similarity(descripcion, $1) AS similitud
         FROM public.catalogo_fabricante_productos
         WHERE descripcion % $1 AND estado = 'activo'
         ORDER BY similitud DESC
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

module.exports = (app, pool, requerirAccesoNegocio) => {
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
// criterio que buscarCandidatosPorTerminos en ia-server.js.
module.exports.buscarExplorarNexo = buscarExplorarNexo;
module.exports.normalizarBusqueda = normalizarBusqueda;
module.exports.nivelDeCoincidencia = nivelDeCoincidencia;
