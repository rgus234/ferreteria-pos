// Aporta al Catalogo Maestro la IDENTIDAD de los productos que vienen del
// catalogo oficial de un fabricante.
//
// Hasta ahora el Maestro solo se llenaba cuando un negocio confirmaba un
// producto desde su catalogo de proveedor. Eso significa que un producto
// solo existia en el Maestro despues de que alguien lo capturara. Con
// esto, la identidad de fabrica (marca, nombre, presentacion) entra sola
// desde la fuente oficial y cualquier negocio que escanee ese codigo la
// encuentra ya escrita.
//
// DOS REGLAS QUE NO SE TOCAN:
//
// 1. NUNCA precio. El Maestro guarda que ES el producto, no cuanto
//    cuesta. El precio de venta pertenece a cada negocio y el precio de
//    lista del fabricante vive en catalogo_fabricante_productos. Este
//    archivo no escribe ni lee un solo campo de precio.
//
// 2. NUNCA se pisa lo que ya hay. Si un negocio ya aporto ese producto,
//    su informacion manda: solo se rellenan los huecos. Un dato de
//    fabrica no es automaticamente mejor que uno que alguien verifico
//    con el producto en la mano.
//
// Y una regla nueva, por un riesgo real: `codigo` es UNIQUE GLOBAL en el
// Maestro. El "103013" de TRUPER y un "103013" de URREA son productos
// distintos. Si el codigo ya lo tiene OTRO fabricante, no se enlaza ni se
// pisa: se deja constancia y ese producto no entra. Enlazarlos seria
// mezclar dos productos que no tienen nada que ver.

const { textoLimpio } = require("./catalogo-fabricante-contrato");

// Un producto sin nombre no aporta identidad: enviarlo al Maestro solo
// crearia una fila hueca que despues nadie sabe completar.
function tieneIdentidadUtil(producto) {
    return textoLimpio(producto.descripcion).length >= 3;
}

/**
 * Decide que hacer con un producto de fabricante frente a lo que ya
 * existe en el Maestro. Funcion pura: se puede probar sin base de datos.
 *
 * @returns {{accion: 'insertar'|'completar'|'enlazar'|'omitir', campos?: object, motivo?: string}}
 */
function decidirAporte(producto, existente) {
    if (!tieneIdentidadUtil(producto)) {
        return { accion: "omitir", motivo: "sin nombre de producto utilizable" };
    }

    if (!existente) {
        return { accion: "insertar" };
    }

    // El codigo ya lo tiene otro fabricante: son productos distintos que
    // comparten numero. Ni se enlaza ni se pisa.
    if (existente.fabricante && existente.fabricante !== producto.fabricante) {
        return {
            accion: "omitir",
            motivo: `el codigo ya pertenece a ${existente.fabricante} en el Catalogo Maestro`
        };
    }

    // Solo se rellenan huecos. Lo que ya tiene valor no se toca, venga de
    // un negocio o de una corrida anterior.
    const campos = {};
    for (const [campoMaestro, valor] of [
        ["nombre", producto.descripcion],
        ["marca", producto.marca],
        ["ean", producto.ean]
    ]) {
        if (!textoLimpio(valor)) continue;
        if (textoLimpio(existente[campoMaestro])) continue;
        campos[campoMaestro] = textoLimpio(valor);
    }

    // Dejar constancia del fabricante en una fila que aporto un negocio
    // es informacion nueva, no un pisotón.
    if (!existente.fabricante && producto.fabricante) {
        campos.fabricante = producto.fabricante;
        campos.codigo_fabricante = producto.codigo;
        campos.origen = "fabricante";
    }

    return Object.keys(campos).length > 0
        ? { accion: "completar", campos }
        : { accion: "enlazar" };
}

/**
 * Aporta al Maestro los productos de un fabricante que aun no estan
 * enlazados. Se corre despues de una sincronizacion.
 *
 * @param {object} pool
 * @param {string} fabricante
 * @param {object} [opciones]
 * @param {number} [opciones.limite] cuantos productos procesar por corrida
 * @param {string[]} [opciones.confianzas] que niveles de confianza aportar
 * @returns {Promise<{insertados,completados,enlazados,omitidos,detalles}>}
 */
async function aportarAlMaestro(pool, fabricante, opciones = {}) {
    const limite = Math.min(Number(opciones.limite) || 1000, 5000);
    // Por omision solo se aporta lo que se leyo con confianza. Un producto
    // cuya lectura quedo dudosa no deberia definir la identidad que van a
    // ver todos los negocios.
    const confianzas = opciones.confianzas || ["alta", "media"];

    const candidatos = await pool.query(
        `SELECT codigo, clave, ean, descripcion, marca, confianza
         FROM public.catalogo_fabricante_productos
         WHERE fabricante = $1
           AND estado = 'activo'
           AND catalogo_maestro_id IS NULL
           AND confianza = ANY($2)
         ORDER BY codigo
         LIMIT $3`,
        [fabricante, confianzas, limite]
    );

    const resumen = { insertados: 0, completados: 0, enlazados: 0, omitidos: 0, detalles: [] };

    for (const fila of candidatos.rows) {
        const producto = { ...fila, fabricante };

        // Se busca por codigo, que es la identidad del Maestro.
        const existentes = await pool.query(
            `SELECT id, nombre, marca, ean, fabricante
             FROM public.catalogo_maestro_productos WHERE codigo = $1`,
            [fila.codigo]
        );
        const existente = existentes.rows[0] || null;
        const decision = decidirAporte(producto, existente);

        if (decision.accion === "omitir") {
            resumen.omitidos++;
            resumen.detalles.push({ codigo: fila.codigo, motivo: decision.motivo });
            await pool.query(
                `UPDATE public.catalogo_fabricante_productos
                 SET maestro_detalle = $3
                 WHERE fabricante = $1 AND codigo = $2`,
                [fabricante, fila.codigo, decision.motivo]
            );
            continue;
        }

        let maestroId = existente?.id || null;

        if (decision.accion === "insertar") {
            const nuevo = await pool.query(
                `INSERT INTO public.catalogo_maestro_productos
                    (codigo, marca, nombre, ean, fabricante, codigo_fabricante, origen)
                 VALUES ($1, $2, $3, $4, $5, $6, 'fabricante')
                 ON CONFLICT (codigo) DO NOTHING
                 RETURNING id`,
                [
                    fila.codigo,
                    textoLimpio(fila.marca),
                    textoLimpio(fila.descripcion),
                    textoLimpio(fila.ean),
                    fabricante,
                    fila.codigo
                ]
            );

            if (nuevo.rows.length > 0) {
                maestroId = nuevo.rows[0].id;
                resumen.insertados++;
            } else {
                // Carrera: alguien lo inserto entre el SELECT y el INSERT.
                const reintento = await pool.query(
                    `SELECT id FROM public.catalogo_maestro_productos WHERE codigo = $1`,
                    [fila.codigo]
                );
                maestroId = reintento.rows[0]?.id || null;
                resumen.enlazados++;
            }
        } else if (decision.accion === "completar") {
            const sets = [];
            const valores = [];
            let n = 1;
            for (const [campo, valor] of Object.entries(decision.campos)) {
                sets.push(`${campo} = $${n++}`);
                valores.push(valor);
            }
            valores.push(existente.id);
            await pool.query(
                `UPDATE public.catalogo_maestro_productos
                 SET ${sets.join(", ")}, updated_at = NOW()
                 WHERE id = $${n}`,
                valores
            );
            resumen.completados++;
        } else {
            resumen.enlazados++;
        }

        if (maestroId) {
            await pool.query(
                `UPDATE public.catalogo_fabricante_productos
                 SET catalogo_maestro_id = $3, maestro_detalle = ''
                 WHERE fabricante = $1 AND codigo = $2`,
                [fabricante, fila.codigo, maestroId]
            );
        }
    }

    return resumen;
}

module.exports = {
    aportarAlMaestro,
    decidirAporte,
    tieneIdentidadUtil
};
