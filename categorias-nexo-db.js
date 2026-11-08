// Lista de categorias de Nexo que ve un negocio (selector de producto y IA de clasificacion).
// Giro "ferreteria" usa el arbol nuevo de 3 niveles (giro "ferreteria_v2", ver categorias-ferreteria.js); las categorias
// del arbol anterior solo se siguen mostrando si el negocio ya tiene productos asignados a ellas, para que su seleccion
// no desaparezca. Si el arbol nuevo todavia no esta sembrado, se muestra el anterior completo (nada queda vacio).
const { GIRO_ARBOL } = require("./categorias-ferreteria");

const COLUMNAS = "id, giro, departamento, categoria, nombre";
const ORDEN = "ORDER BY orden, departamento, categoria, nombre";
const cacheBase = new Map();

async function categoriasNexoDelNegocio(pool, girosActivos, negocioId) {
    const giros = girosActivos.length ? girosActivos : ["ferreteria"];
    const conFerreteria = giros.includes("ferreteria");
    const clave = [...giros].sort().join(",");

    if (!cacheBase.has(clave)) {
        const base = await pool.query(
            `SELECT ${COLUMNAS} FROM public.categorias_nexo WHERE giro = ANY($1::text[]) AND giro <> 'ferreteria' ${ORDEN}`,
            [conFerreteria ? [...giros, GIRO_ARBOL] : giros]
        );
        cacheBase.set(clave, base.rows);
    }

    const filas = [...cacheBase.get(clave)];
    if (!conFerreteria) return filas;

    const hayArbolNuevo = filas.some(fila => fila.giro === GIRO_ARBOL);
    const anteriores = await pool.query(
        hayArbolNuevo
            ? `SELECT ${COLUMNAS} FROM public.categorias_nexo
               WHERE giro = 'ferreteria'
                 AND id IN (SELECT categoria_nexo_id FROM public.productos WHERE negocio_id = $1 AND categoria_nexo_id IS NOT NULL)
               ${ORDEN}`
            : `SELECT ${COLUMNAS} FROM public.categorias_nexo WHERE giro = 'ferreteria' ${ORDEN}`,
        hayArbolNuevo ? [negocioId] : []
    );

    return [...anteriores.rows, ...filas];
}

function olvidarCacheCategoriasNexo() {
    cacheBase.clear();
}

module.exports = { categoriasNexoDelNegocio, olvidarCacheCategoriasNexo };
