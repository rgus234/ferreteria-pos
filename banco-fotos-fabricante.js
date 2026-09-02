// Galeria de producto por REFERENCIA a las fotos que el fabricante ya
// publica, en vez de copiarlas a la base.
//
// Por que: la galeria guardada pesaba 1.2 GB (el 74% de toda la base) por
// 75.794 fotos de 480x480, para una funcion que acumula 61 usos. El
// fabricante publica 6-8 fotos por producto a 1800x1800, con
// Cache-Control de un ano y sin bloqueo de hotlinking. Guardar que fotos
// existen cuesta ~200 bytes por producto en vez de ~16 KB por imagen.
//
// La foto PRINCIPAL se sigue guardando en el banco: es la que el POS
// muestra todo el tiempo, y tenerla en casa la hace instantanea y protege
// de que el fabricante cambie sus rutas. Lo que se deja de copiar son las
// secundarias.

const { textoLimpio } = require("./catalogo-fabricante-contrato");

const BASE_IMAGENES_TRUPER = "https://www.truper.com/media/import/imagenes";

// Se identifica en vez de disfrazarse de navegador.
const USER_AGENT = "NexoPOS-Fotos/1.0 (+https://nexoposoficial.com)";

// Sufijos observados en el catalogo. El primero (vacio) es la foto
// principal; el resto son contexto, especificacion, empaque y detalle.
const SUFIJOS_CONOCIDOS = ["", "+FC1", "+FC2", "+FC3", "+E1", "+E2", "+EI1", "+EIND1", "+EM1", "+EA1", "+D1"];

// Cada cuanto se vuelve a mirar si el fabricante agrego fotos.
const DIAS_REVALIDAR = 30;

/**
 * Nombre del archivo en el servidor del fabricante.
 * La barra de la clave se reemplaza por guion: CM-1/2T -> CM-1-2T.jpg
 * (sin esta regla se pierde el 13% de las fotos).
 */
function nombreArchivo(clave, sufijo = "") {
    return String(clave).split("/").join("-") + sufijo;
}

function urlFoto(clave, sufijo = "") {
    return `${BASE_IMAGENES_TRUPER}/${encodeURIComponent(nombreArchivo(clave, sufijo))}.jpg`;
}

/**
 * Averigua que fotos existen de verdad para una clave. Una peticion HEAD
 * por sufijo: no descarga la imagen, solo pregunta si esta.
 */
async function descubrirFotos(clave, opciones = {}) {
    const sufijos = opciones.sufijos || SUFIJOS_CONOCIDOS;

    // En paralelo, no en fila. Son 11 peticiones HEAD que no dependen unas
    // de otras; hacerlas en serie tardaba entre 15 y 27 segundos, que es
    // inaceptable para una peticion que alguien esta esperando.
    const resultados = await Promise.all(sufijos.map(async sufijo => {
        try {
            const respuesta = await fetch(urlFoto(clave, sufijo), {
                method: "HEAD",
                headers: { "User-Agent": USER_AGENT },
                signal: AbortSignal.timeout(opciones.timeoutMs ?? 12000)
            });
            return respuesta.ok ? sufijo : null;
        } catch (error) {
            // Un fallo de red no significa que la foto no exista: se
            // omite este sufijo y se reintentara en la proxima revision.
            return null;
        }
    }));

    // Se conserva el orden de SUFIJOS_CONOCIDOS: la principal primero.
    return resultados.filter(s => s !== null);
}

/**
 * Clave/SKU de un producto segun el Catalogo Maestro. Es lo que da el
 * nombre del archivo de sus fotos.
 */
async function claveDeProducto(pool, codigo) {
    const limpio = textoLimpio(codigo);
    if (!limpio) return null;

    const r = await pool.query(
        `SELECT m.clave, m.fabricante, m.codigo_fabricante
         FROM public.catalogo_maestro_identificadores i
         JOIN public.catalogo_maestro_productos m ON m.id = i.producto_maestro_id
         WHERE i.valor = $1 AND COALESCE(m.clave, '') <> ''
         LIMIT 1`,
        [limpio]
    );

    if (r.rows[0]) return r.rows[0];

    // El Catalogo Maestro solo tiene la clave de los productos que ya
    // cruzaron con el catalogo oficial del fabricante. Para el resto se
    // pregunta al fabricante y, si contesta, se guarda: asi el Maestro se
    // va completando solo con el uso, sin esperar al catalogo entero.
    return await claveDesdeFabricante(pool, limpio);
}

// Ultimo recurso: el buscador del fabricante. Devuelve la clave de un
// producto por su codigo. Solo entrega 5 resultados con coincidencia
// difusa, asi que se exige codigo exacto -- nunca se toma un producto
// parecido.
async function claveDesdeFabricante(pool, codigo) {
    // Solo tiene sentido para el codigo del fabricante, no para un EAN.
    const producto = await pool.query(
        `SELECT m.id, m.codigo_fabricante, m.fabricante
         FROM public.catalogo_maestro_identificadores i
         JOIN public.catalogo_maestro_productos m ON m.id = i.producto_maestro_id
         WHERE i.valor = $1 AND COALESCE(m.codigo_fabricante, '') <> ''
         LIMIT 1`,
        [codigo]
    );

    const fila = producto.rows[0];
    if (!fila) return null;

    try {
        const truper = require("./fabricantes/truper");
        const datos = await truper.datosDeProducto(fila.codigo_fabricante);
        if (!datos || !datos.clave) return null;

        // Se guarda en el Maestro para no volver a preguntar.
        await pool.query(
            `UPDATE public.catalogo_maestro_productos
             SET clave = $2, updated_at = NOW()
             WHERE id = $1 AND COALESCE(clave, '') = ''`,
            [fila.id, datos.clave]
        );

        return { clave: datos.clave, fabricante: fila.fabricante, codigo_fabricante: fila.codigo_fabricante };
    } catch (error) {
        return null;
    }
}

/**
 * Fotos de un producto, resolviendo desde cache y averiguando solo si
 * hace falta.
 *
 * @returns {Promise<{clave, fotos:[{sufijo,url}], origen:'cache'|'descubierto'|'sin_clave'}>}
 */
async function fotosDeProducto(pool, codigo, opciones = {}) {
    const limpio = textoLimpio(codigo);
    if (!limpio) return { clave: "", fotos: [], origen: "sin_clave" };

    const cache = await pool.query(
        `SELECT clave, sufijos, verificado_en FROM public.banco_imagenes_fabricante WHERE codigo = $1`,
        [limpio]
    );

    const guardado = cache.rows[0];
    const vencido = guardado
        && (Date.now() - new Date(guardado.verificado_en).getTime()) > DIAS_REVALIDAR * 86400000;

    if (guardado && !vencido && !opciones.forzar) {
        return {
            clave: guardado.clave,
            fotos: (guardado.sufijos || []).map(s => ({ sufijo: s, url: urlFoto(guardado.clave, s) })),
            origen: "cache"
        };
    }

    // No esta en cache (o vencio): hay que averiguarlo.
    const producto = await claveDeProducto(pool, limpio);
    if (!producto || !producto.clave) {
        // Se recuerda que este codigo no tiene clave, para no repetir la
        // busqueda cada vez que alguien abra su ficha.
        await pool.query(
            `INSERT INTO public.banco_imagenes_fabricante (codigo, clave, sufijos, verificado_en)
             VALUES ($1, '', '[]'::jsonb, NOW())
             ON CONFLICT (codigo) DO UPDATE SET verificado_en = NOW()`,
            [limpio]
        );
        return { clave: "", fotos: [], origen: "sin_clave" };
    }

    const sufijos = await descubrirFotos(producto.clave, opciones);

    await pool.query(
        `INSERT INTO public.banco_imagenes_fabricante (codigo, clave, fabricante, sufijos, verificado_en)
         VALUES ($1, $2, $3, $4::jsonb, NOW())
         ON CONFLICT (codigo) DO UPDATE
         SET clave = EXCLUDED.clave, fabricante = EXCLUDED.fabricante,
             sufijos = EXCLUDED.sufijos, verificado_en = NOW()`,
        [limpio, producto.clave, producto.fabricante || "", JSON.stringify(sufijos)]
    );

    return {
        clave: producto.clave,
        fotos: sufijos.map(s => ({ sufijo: s, url: urlFoto(producto.clave, s) })),
        origen: "descubierto"
    };
}

module.exports = {
    fotosDeProducto,
    descubrirFotos,
    claveDeProducto,
    claveDesdeFabricante,
    urlFoto,
    nombreArchivo,
    SUFIJOS_CONOCIDOS,
    BASE_IMAGENES_TRUPER,
    DIAS_REVALIDAR
};
