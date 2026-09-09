// Motor de "candidato ganador" para Recepcion Inteligente.
//
// Las 4 fuentes de Explorar Nexo (explorar-nexo-server.js) devuelven
// listas separadas -- estan pensadas para que un empleado compare 4
// columnas en pantalla. Una factura no se revisa asi: cada concepto
// necesita UN candidato, o ninguno. Este archivo agrega esa capa,
// reutilizando las mismas 4 sub-rutinas tal cual (nunca las duplica).
//
// Mismo principio que ya gobierna Explorar Nexo: la busqueda solo
// compara contra datos reales, nunca inventa un producto. Bajo el
// umbral "probable" no se ofrece candidato -- en una factura, un falso
// positivo cuesta dinero e inventario real, no solo una busqueda
// incomoda, asi que el concepto se deja sin identificar para revision
// manual desde cero en vez de sugerir un parecido debil.
const { identidadPorCodigo } = require("./catalogo-maestro-reconciliacion");
const {
    buscarEnInventario,
    buscarEnCatalogoProveedor,
    buscarEnCatalogoMaestro,
    buscarEnCatalogoFabricante,
    normalizarBusqueda,
    numeroONull
} = require("./explorar-nexo-server");

// Codigo exacto primero -- nunca ClaveProdServ (ver cfdi-parser.js):
// es una clasificacion generica del SAT compartida por miles de
// productos, no un identificador. `codigo` aqui siempre debe venir de
// NoIdentificacion.
//
// Dos fuentes de codigo exacto, en orden: el catalogo de ESTE
// proveedor en ESTE negocio (mas especifico: ya sabe como Diprofer
// nombra sus propios productos), y el Catalogo Maestro global
// (identidadPorCodigo, EAN o codigo de fabricante) como respaldo.
async function buscarPorCodigoExacto(pool, negocioId, codigo) {
    const limpio = String(codigo || "").trim();
    if (!limpio) return null;

    const enProveedor = await pool.query(
        `SELECT cp.producto_id, cp.nombre_proveedor, cp.marca,
                cp.precio_distribuidor, cp.precio_medio_mayoreo, cp.precio_publico
         FROM public.catalogo_productos cp
         WHERE cp.negocio_id = $1
           AND (cp.codigo_proveedor = $2 OR NULLIF(cp.codigo_interno, '') = $2 OR NULLIF(cp.codigo_barras, '') = $2)
         LIMIT 1`,
        [negocioId, limpio]
    );

    if (enProveedor.rows.length) {
        const fila = enProveedor.rows[0];
        return {
            fuente: "catalogo_proveedor_codigo",
            productoId: fila.producto_id || null,
            nombre: fila.nombre_proveedor,
            marca: fila.marca,
            precioDistribuidor: numeroONull(fila.precio_distribuidor),
            precioMedioMayoreo: numeroONull(fila.precio_medio_mayoreo),
            precioPublico: numeroONull(fila.precio_publico),
            similitud: 1,
            nivel: "fuerte"
        };
    }

    const porMaestro = await identidadPorCodigo(pool, limpio).catch(() => null);
    if (porMaestro) {
        return {
            fuente: "catalogo_maestro_codigo",
            catalogoMaestroId: porMaestro.id,
            nombre: porMaestro.nombre,
            marca: porMaestro.marca,
            ean: porMaestro.ean || null,
            precioListaMayoreo: numeroONull(porMaestro.precio_mayoreo),
            precioListaMedioMayoreo: numeroONull(porMaestro.precio_medio_mayoreo),
            precioListaPublico: numeroONull(porMaestro.precio_publico),
            precioListaDistribuidor: numeroONull(porMaestro.precio_distribuidor),
            similitud: 1,
            nivel: "fuerte"
        };
    }

    return null;
}

// El inventario propio pesa mas que el catalogo de proveedor, que pesa
// mas que el Maestro, que pesa mas que el fabricante -- a igualdad de
// similitud, preferir lo que ya esta dado de alta en ESTE negocio
// antes que una identidad global.
const PESO_FUENTE = { inventario: 3, proveedor: 2, catalogo_maestro: 1, fabricante: 0 };

async function buscarPorDescripcion(pool, negocioId, descripcion) {
    const termino = normalizarBusqueda(descripcion);
    if (!termino) return null;

    const [inventario, proveedor, catalogoMaestro, fabricante] = await Promise.all([
        buscarEnInventario(pool, negocioId, termino),
        buscarEnCatalogoProveedor(pool, negocioId, termino),
        buscarEnCatalogoMaestro(pool, termino),
        buscarEnCatalogoFabricante(pool, termino)
    ]);

    const candidatos = [...inventario, ...proveedor, ...catalogoMaestro, ...fabricante]
        // "relacionado" (bajo el umbral probable) no cuenta como
        // candidato aqui -- ver principio arriba.
        .filter(candidato => candidato.nivel === "fuerte" || candidato.nivel === "probable");

    if (!candidatos.length) return null;

    candidatos.sort((a, b) =>
        (b.similitud - a.similitud) || (PESO_FUENTE[b.fuente] - PESO_FUENTE[a.fuente])
    );

    return candidatos[0];
}

// Un solo candidato por concepto de factura: codigo exacto primero,
// descripcion como respaldo. Nunca se fusionan dos aciertos -- el
// primero que cruza manda, para que el criterio de decision sea
// siempre trazable a una sola fuente.
async function resolverConceptoFactura(pool, negocioId, concepto) {
    const porCodigo = await buscarPorCodigoExacto(pool, negocioId, concepto.codigo);
    if (porCodigo) return porCodigo;

    return await buscarPorDescripcion(pool, negocioId, concepto.descripcion);
}

module.exports = { resolverConceptoFactura, buscarPorCodigoExacto, buscarPorDescripcion };
