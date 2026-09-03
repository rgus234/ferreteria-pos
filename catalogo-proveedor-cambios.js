// Que cambio cuando el proveedor manda un catalogo nuevo.
//
// El catalogo de un proveedor se actualiza una o dos veces al año, y lo
// que el dueno necesita saber es exactamente esto: que subio de precio,
// que bajo, que hay de nuevo y que dejaron de vender. Antes la
// importacion contaba dos cosas (nuevos y cambios de precio publico) y las
// mostraba en una linea que desaparecia al recargar.
//
// Modulo puro: recibe las filas del archivo y las de la base, y devuelve
// la lista de cambios. Sin Express y sin SQL, para poder probarlo con
// `node --test` sin base de datos.

// Los tres precios que importan, con el nombre que ve el dueno. El
// distribuidor va incluido: en el catalogo de Diprofer es el que coincide
// exactamente con el de TRUPER, asi que un cambio ahi es real.
const CAMPOS_PRECIO = [
    { columna: "precio_distribuidor", desde: "distribuidor", etiqueta: "Distribuidor" },
    { columna: "precio_medio_mayoreo", desde: "medioMayoreo", etiqueta: "Medio mayoreo" },
    { columna: "precio_publico", desde: "precioPublico", etiqueta: "Publico" }
];

// Los precios llegan de Postgres como string ("335.00") y del archivo como
// numero (335). Compararlos sin normalizar reportaria un cambio en cada
// producto de cada importacion.
function mismoPrecio(a, b) {
    if (a == null && b == null) return true;
    if (a == null || b == null) return false;
    return Math.abs(Number(a) - Number(b)) < 0.005;
}

function formatear(valor) {
    if (valor == null) return "";
    return `$${Number(valor).toFixed(2)}`;
}

/**
 * Compara el archivo nuevo contra lo que ya hay en la base.
 *
 * @param {Array} filas         filas normalizadas del archivo
 * @param {Array} existentes    filas de catalogo_productos de ese catalogo
 * @returns {{cambios: Array, resumen: object}}
 */
function compararCatalogo(filas, existentes) {
    const previos = new Map(
        (existentes || []).map(f => [String(f.codigo_proveedor), f])
    );
    const enElArchivo = new Set();
    const cambios = [];

    let nuevos = 0;
    let modificados = 0;
    let sinCambio = 0;

    for (const fila of filas || []) {
        const codigo = String(fila.codigoProveedor || "");
        if (!codigo) continue;
        enElArchivo.add(codigo);

        const previo = previos.get(codigo);

        if (!previo) {
            nuevos++;
            cambios.push({
                codigo,
                nombre: fila.nombre || "",
                tipo: "nuevo",
                campo: "",
                valorAnterior: "",
                // Se anota con que precio entro: es lo que uno quiere ver
                // de un producto nuevo, no solo que existe.
                valorNuevo: formatear(fila.precioPublico)
            });
            continue;
        }

        const delProducto = [];

        for (const precio of CAMPOS_PRECIO) {
            const antes = previo[precio.columna];
            const ahora = fila[precio.desde];
            if (mismoPrecio(antes, ahora)) continue;

            delProducto.push({
                codigo,
                nombre: fila.nombre || previo.nombre_proveedor || "",
                tipo: "modificado",
                campo: precio.etiqueta,
                valorAnterior: formatear(antes),
                valorNuevo: formatear(ahora)
            });
        }

        // El nombre tambien: un proveedor que renombra un producto suele
        // haber cambiado el producto, y conviene mirarlo.
        const nombreAntes = String(previo.nombre_proveedor || "").trim();
        const nombreAhora = String(fila.nombre || "").trim();
        if (nombreAhora && nombreAntes && nombreAhora !== nombreAntes) {
            delProducto.push({
                codigo, nombre: nombreAhora, tipo: "modificado",
                campo: "Nombre", valorAnterior: nombreAntes, valorNuevo: nombreAhora
            });
        }

        if (delProducto.length > 0) {
            modificados++;
            cambios.push(...delProducto);
        } else {
            sinCambio++;
        }
    }

    // Lo que el proveedor dejo de listar. NO se borra nada: se reporta,
    // porque un archivo incompleto no es lo mismo que un producto
    // descontinuado y solo el dueno sabe cual de las dos fue.
    let descontinuados = 0;
    for (const [codigo, previo] of previos.entries()) {
        if (enElArchivo.has(codigo)) continue;
        descontinuados++;
        cambios.push({
            codigo,
            nombre: previo.nombre_proveedor || "",
            tipo: "descontinuado",
            campo: "",
            valorAnterior: formatear(previo.precio_publico),
            valorNuevo: ""
        });
    }

    return {
        cambios,
        resumen: {
            filasRecibidas: (filas || []).length,
            nuevos,
            modificados,
            descontinuados,
            sinCambio
        }
    };
}

// ---------------------------------------------------------------------
// Persistencia
// ---------------------------------------------------------------------

/**
 * Guarda una importacion y sus cambios. Corre con el `ejecutor` que le
 * pasen (pool o client), para poder ir dentro de la transaccion de la
 * importacion: si esta se revierte, su reporte no debe quedar suelto.
 */
async function guardarImportacion(ejecutor, datos) {
    const { negocioId, catalogoId, proveedor, resumen, cambios } = datos;

    const fila = await ejecutor.query(
        `INSERT INTO public.catalogo_proveedor_importaciones
            (negocio_id, catalogo_id, proveedor, filas_recibidas, nuevos, modificados, descontinuados, sin_cambio)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
        [
            negocioId, catalogoId, proveedor || "",
            resumen.filasRecibidas, resumen.nuevos, resumen.modificados,
            resumen.descontinuados, resumen.sinCambio
        ]
    );
    const importacionId = fila.rows[0].id;

    // Por lotes: un catalogo de 15.000 productos puede traer miles de
    // cambios, y una consulta por cambio agotaria el tiempo de la
    // peticion HTTP.
    const TAMANO_LOTE = 500;
    for (let inicio = 0; inicio < cambios.length; inicio += TAMANO_LOTE) {
        const lote = cambios.slice(inicio, inicio + TAMANO_LOTE);
        const valores = [];
        const parametros = [];

        lote.forEach((cambio, indice) => {
            const base = indice * 6;
            valores.push(`($1,$2,$${base + 3},$${base + 4},$${base + 5},$${base + 6},$${base + 7},$${base + 8})`);
            parametros.push(
                cambio.codigo, cambio.nombre || "", cambio.tipo,
                cambio.campo || "", cambio.valorAnterior || "", cambio.valorNuevo || ""
            );
        });

        await ejecutor.query(
            `INSERT INTO public.catalogo_proveedor_cambios
                (importacion_id, negocio_id, codigo_proveedor, nombre, tipo, campo, valor_anterior, valor_nuevo)
             VALUES ${valores.join(",")}`,
            [importacionId, negocioId, ...parametros]
        );
    }

    return importacionId;
}

module.exports = { compararCatalogo, guardarImportacion, mismoPrecio, CAMPOS_PRECIO };
