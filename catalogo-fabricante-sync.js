// Nucleo de sincronizacion de catalogos. Es UNIVERSAL: no sabe de OCR,
// ni de imagenes, ni de "modulos", ni de TRUPER. Solo entiende el
// contrato de catalogo-fabricante-contrato.js:
//
//   listarUniverso()  -> que productos existen hoy
//   listarUnidades()  -> en que trozos viene la informacion y su firma
//   extraerUnidad()   -> filas normalizadas de un trozo
//
// Con eso hace siempre lo mismo, venga la fuente de un JPG rasterizado
// (TRUPER), de un CSV que manda el proveedor por correo, o de una API:
// detectar que cambio, respaldar, comparar, aplicar y reportar.
//
// Una version anterior importaba directamente el extractor de OCR y
// razonaba en modulos con ETag. Eso ataba el motor a la forma que tiene
// TRUPER de publicar; un proveedor con un Excel no tiene nada de eso.
//
// Reglas que pidio el dueno y que estan implementadas aqui:
//   - Nunca sobrescribir directo: se respalda la fila ANTES de tocarla.
//   - No modificar nada si la coincidencia no es segura.
//   - Actualizar solo lo que realmente cambio.
//   - Un cambio de precio del fabricante NO toca el costo del proveedor ni
//     el precio de venta: este modulo solo escribe en las tablas
//     catalogo_fabricante_* y jamas en productos ni catalogo_productos.

const {
    normalizarFila,
    identidadDeFila,
    validarAdaptador,
    revisarCoherenciaNiveles,
    NIVELES_PRECIO_ESTANDAR
} = require("./catalogo-fabricante-contrato");

// Si mas de esta fraccion de unidades ya conocidas cambia de firma de
// golpe, es una regeneracion masiva de la fuente (paso de verdad en
// TRUPER el 13-ago-2026: se regeneraron todos los JPG en 25 minutos).
// Reprocesar miles de unidades que probablemente traen los mismos precios
// cuesta tiempo y dinero, asi que la corrida se detiene y pregunta.
const UMBRAL_REGENERACION_MASIVA = 0.5;

// Si de una corrida a otra desaparece mas de esta fraccion de los
// productos activos, casi seguro fallo la lectura del universo y no es
// que el fabricante haya descontinuado media linea.
const UMBRAL_BAJA_MASIVA = 0.3;
// Por debajo de este numero de productos activos la fraccion no significa
// nada (con 3 productos, uno de baja ya es el 33%).
const MIN_ACTIVOS_PARA_SALVAGUARDA = 50;

// Tope de enriquecimientos por producto nuevo en una corrida. En el
// arranque puede haber miles y cada uno es una peticion; se reparten
// entre corridas en vez de bloquear la primera durante horas.
const MAX_ENRIQUECIMIENTOS_POR_CORRIDA = 500;

const CAMPOS_PRECIO = NIVELES_PRECIO_ESTANDAR;

// ---------------------------------------------------------------------
// Utilidades de comparacion
// ---------------------------------------------------------------------

// Los precios vienen de Postgres como string ("335.00") y del extractor
// como numero (335). Comparar sin normalizar reportaria cambios falsos en
// cada corrida.
function mismoPrecio(a, b) {
    if (a == null && b == null) return true;
    if (a == null || b == null) return false;
    return Math.abs(Number(a) - Number(b)) < 0.005;
}

function formatearPrecio(valor) {
    if (valor == null) return "";
    return `$${Number(valor).toFixed(2)}`;
}

// Un producto puede recibir datos de varias unidades leidas con distinta
// suerte (en TRUPER, la lista publica y la de distribuidor). Su confianza
// es la peor de todas: decir "alta" porque una salio limpia esconderia
// que la otra necesito ayuda.
const ORDEN_CONFIANZA = ["alta", "media", "baja"];
function peorConfianza(a, b) {
    const valores = [a, b].filter(Boolean);
    if (valores.length === 0) return "";
    return valores.sort((x, y) => ORDEN_CONFIANZA.indexOf(y) - ORDEN_CONFIANZA.indexOf(x))[0];
}

const ORDEN_ORIGEN = ["ocr", "archivo", "api", "sin_precios_publicados", "vision"];
function peorOrigen(a, b) {
    const valores = [a, b].filter(Boolean);
    if (valores.length === 0) return "";
    return valores.sort((x, y) => ORDEN_ORIGEN.indexOf(y) - ORDEN_ORIGEN.indexOf(x))[0];
}

function trocear(lista, tamano) {
    const trozos = [];
    for (let i = 0; i < lista.length; i += tamano) {
        trozos.push(lista.slice(i, i + tamano));
    }
    return trozos;
}

// ---------------------------------------------------------------------
// Registro de la corrida
// ---------------------------------------------------------------------

async function crearSincronizacion(pool, fabricante, confirmoRegeneracion = false) {
    try {
        const resultado = await pool.query(
            `INSERT INTO public.catalogo_fabricante_sincronizaciones
                (fabricante, estado, confirmo_regeneracion, latido_en)
             VALUES ($1, 'en_curso', $2, NOW()) RETURNING id`,
            [fabricante, confirmoRegeneracion]
        );
        return resultado.rows[0].id;
    } catch (error) {
        // Choque con el indice unico parcial: ya hay otra corrida viva de
        // este fabricante, posiblemente en otro proceso.
        if (error.code === "23505") {
            const conflicto = new Error(`ya hay una sincronizacion de ${fabricante} en curso`);
            conflicto.httpStatus = 409;
            throw conflicto;
        }
        throw error;
    }
}

// Marca de vida de la corrida. Sin esto no se puede distinguir una carga
// larga y sana de un proceso muerto, y cerrarCorridasHuerfanas mataria la
// primera. Es "dispara y olvida": un fallo al latir nunca debe tumbar la
// corrida, por eso el .catch vacio.
function crearLatido(pool, sincronizacionId, cadaMs = 30000) {
    let ultimo = 0;
    return () => {
        const ahora = Date.now();
        if (ahora - ultimo < cadaMs) return;
        ultimo = ahora;
        pool.query(
            `UPDATE public.catalogo_fabricante_sincronizaciones SET latido_en = NOW() WHERE id = $1`,
            [sincronizacionId]
        ).catch(() => {});
    };
}

// Un lote = todas las unidades cambiadas que comparten unidad.id. En
// TRUPER eso es "las dos variantes del mismo modulo" (publico y
// distribuidor), que es justo el par que el chequeo de coherencia entre
// niveles necesita cruzar: si cayeran en lotes distintos, un precio de
// distribuidor con un digito perdido dejaria de detectarse.
function agruparPorUnidad(cambiadas) {
    const lotes = new Map(); // Map preserva el orden de insercion
    for (const unidad of cambiadas) {
        if (!lotes.has(unidad.id)) lotes.set(unidad.id, []);
        lotes.get(unidad.id).push(unidad);
    }
    return [...lotes.values()];
}

// Cuantos lotes seguidos pueden fallar antes de rendirse. Un CHECK que
// revienta con una fila rara no debe bloquear a los 3.900 modulos que
// siguen; pero si fallan varios seguidos, la base o el esquema estan mal
// y seguir solo quema OCR.
const MAX_LOTES_FALLIDOS_SEGUIDOS = 3;

// Cuantos modulos se procesan a la vez.
//
// Con uno solo, una carga completa de TRUPER son ~28 horas: se midio en
// vivo a 4.5 unidades/minuto, cuando el trabajo puro de una unidad son
// 2.3 segundos. El proceso pasaba casi todo el tiempo esperando.
//
// El techo no lo pone este numero sino el turnero de salida del adaptador,
// que espacia las peticiones al fabricante igual que antes. O sea: se
// aprovechan los nucleos ociosos SIN pedirle mas al servidor ajeno.
const LOTES_EN_PARALELO = Math.max(1, Number(process.env.NEXO_LOTES_PARALELOS) || 4);

async function registrarCambio(pool, sincronizacionId, fabricante, cambio) {
    await pool.query(
        `INSERT INTO public.catalogo_fabricante_cambios
            (sincronizacion_id, fabricante, codigo, tipo, campo, valor_anterior, valor_nuevo, detalle)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
            sincronizacionId, fabricante, cambio.codigo, cambio.tipo,
            cambio.campo || "", cambio.valorAnterior || "", cambio.valorNuevo || "",
            cambio.detalle || ""
        ]
    );
}

async function cerrarSincronizacion(pool, id, estado, contadores, detalle = "") {
    await pool.query(
        `UPDATE public.catalogo_fabricante_sincronizaciones
         SET estado = $2, modulos_revisados = $3, modulos_cambiados = $4,
             productos_nuevos = $5, productos_modificados = $6, productos_descontinuados = $7,
             productos_sin_coincidencia = $8, productos_incompletos = $9,
             detalle = $10, terminada_en = NOW()
         WHERE id = $1`,
        [
            id, estado,
            contadores.unidadesRevisadas || 0, contadores.unidadesCambiadas || 0,
            contadores.nuevos || 0, contadores.modificados || 0, contadores.descontinuados || 0,
            contadores.sinCoincidencia || 0, contadores.incompletos || 0,
            detalle
        ]
    );
}

// ---------------------------------------------------------------------
// Deteccion de cambios por unidad
//
// Las tablas siguen llamando "modulo"/"variante" a las dos partes del
// identificador de unidad, por compatibilidad con lo ya guardado:
//   modulo   = unidad.id
//   variante = unidad.parte  (vacio cuando la fuente no se divide)
// ---------------------------------------------------------------------

async function leerEstadoUnidades(pool, fabricante) {
    const resultado = await pool.query(
        `SELECT modulo, variante, etag, hash_contenido, estado
         FROM public.catalogo_fabricante_modulos WHERE fabricante = $1`,
        [fabricante]
    );

    const mapa = new Map();
    for (const fila of resultado.rows) {
        mapa.set(`${fila.modulo}|${fila.variante}`, fila);
    }
    return mapa;
}

/**
 * Compara la firma de cada unidad contra la de la ultima corrida. No
 * descarga ni procesa contenido: solo decide que hay que reprocesar.
 */
async function detectarUnidadesCambiadas(pool, adaptador, unidades, onProgreso) {
    const estado = await leerEstadoUnidades(pool, adaptador.nombre);
    const cambiadas = [];
    let revisadas = 0;
    // Unidades que YA se habian leido antes. Solo estas pueden indicar una
    // regeneracion masiva: en la primera corrida todo es nuevo y sin esta
    // distincion el freno se disparaba siempre, dejando el arranque
    // permanentemente en espera de confirmacion.
    let conEstadoPrevio = 0;
    let cambiadasConEstadoPrevio = 0;

    for (const unidad of unidades) {
        const parte = unidad.parte || "";
        const previo = estado.get(`${unidad.id}|${parte}`);
        revisadas++;

        const teniaEstado = Boolean(previo && previo.etag);
        if (teniaEstado) conEstadoPrevio++;

        // Una unidad se salta solo si su ultima lectura SALIO BIEN y su
        // firma sigue siendo la misma. Mirar solo el etag daba por
        // procesada una unidad que quedo en revision y de la que nunca se
        // guardo un precio. Esta condicion tambien REPARA sola las filas
        // que el codigo anterior alcanzo a quemar: al no estar en 'ok',
        // vuelven a entrar como cambiadas y se releen.
        const sinCambio = teniaEstado
            && previo.estado === "ok"
            && previo.etag === String(unidad.firma || "");
        if (sinCambio) continue;

        if (teniaEstado) cambiadasConEstadoPrevio++;

        cambiadas.push({
            ...unidad,
            parte,
            firmaPrevia: previo?.etag || "",
            hashPrevio: previo?.hash_contenido || "",
            // El atajo por hash solo vale si la vez anterior se aplicaron
            // precios de verdad; si no, marcaria 'ok' una unidad que jamas
            // dio uno.
            estadoPrevio: previo?.estado || ""
        });

        if (typeof onProgreso === "function") onProgreso(revisadas, cambiadas.length);
    }

    return { revisadas, cambiadas, conEstadoPrevio, cambiadasConEstadoPrevio };
}

// ---------------------------------------------------------------------
// Extraccion
// ---------------------------------------------------------------------

// Separa los dos tipos de problema que necesitan atencion distinta:
//   estructura_ambigua  -> no se entendio la fuente. Hay que MIRARLA.
//   precios_incompletos -> se entendio, solo falto algun importe.
function clasificarRevision(resultado) {
    if (!resultado) return "estructura_ambigua";
    if (resultado.layout === "precio_por_bloque") return "estructura_ambigua";
    if (resultado.validacion && !resultado.validacion.ok) return "estructura_ambigua";
    if (resultado.filas && resultado.filas.length > 0) return "precios_incompletos";
    return "estructura_ambigua";
}

// `ejecutor` es el pool o el client de la transaccion. Importa cual:
// escribir el estado de la unidad FUERA de la transaccion tenia un bug
// real -- si la aplicacion fallaba y hacia ROLLBACK, la firma quedaba
// guardada como procesada y la siguiente corrida se saltaba esa unidad,
// asi que sus precios no se recuperaban hasta que la fuente cambiara
// sola. Paso de verdad al correr el primer adaptador de CSV: un CHECK
// reviento la transaccion y los productos quedaron sin precio.
async function guardarEstadoUnidad(ejecutor, fabricante, unidad, estado, detalle, resultado, faltantes) {
    // 'parcial' no es un fallo: se leyeron ALGUNOS productos del modulo y
    // sus precios si se aplicaron. No lleva motivo de revision estructural.
    const leyoBien = estado === "ok" || estado === "parcial";
    const motivo = leyoBien ? "" : clasificarRevision(resultado);

    // LA FIRMA SOLO SE GRABA SI LA LECTURA SIRVIO.
    //
    // Grabar el etag nuevo en una unidad que quedo en revision la QUEMA:
    // detectarUnidadesCambiadas decide solo por etag, asi que la corrida
    // siguiente la ve "sin cambio" y nadie la relee hasta que el fabricante
    // regenere la imagen. Esos precios se pierden.
    //
    // Y no es un caso raro: el tope de 300 llamadas a vision por corrida
    // deja en revision a todo modulo que el OCR no pueda leer una vez
    // agotado. En la primera carga masiva eso son cientos de modulos de un
    // golpe -- justo los que scripts/bootstrap-truper.js promete en su
    // encabezado que "los toma la siguiente corrida".
    //
    // Conservando la firma anterior, la unidad sigue viendose cambiada y se
    // relee. El resto de la fila (estado, motivo, productos_afectados) si se
    // actualiza: es lo que alimenta la pantalla de revision.
    // 'parcial' cuenta como lectura buena para la firma: sus precios SI se
    // aplicaron. Si no se guardara, esos modulos se releerian enteros en
    // cada corrida para volver a fallar exactamente en lo mismo.
    const firma = leyoBien ? String(unidad.firma || "") : String(unidad.firmaPrevia || "");
    const ultimaMod = leyoBien ? String(unidad.lastModified || "") : "";
    // El hash va por el mismo camino: uno de una lectura fallida haria que
    // la corrida siguiente tome el atajo "regenerada sin cambios de
    // contenido" y marque la unidad ok sin haber aplicado un solo precio.
    const hash = leyoBien ? (resultado?.firmaContenido || "") : String(unidad.hashPrevio || "");

    await ejecutor.query(
        `INSERT INTO public.catalogo_fabricante_modulos
            (fabricante, modulo, variante, etag, last_modified, hash_contenido, estado, detalle,
             filas_extraidas, layout, origen_lectura, motivo_revision, productos_afectados,
             codigos_faltantes, extraido_en)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,NOW())
         ON CONFLICT (fabricante, modulo, variante) DO UPDATE
         SET etag = EXCLUDED.etag, last_modified = EXCLUDED.last_modified,
             hash_contenido = EXCLUDED.hash_contenido, estado = EXCLUDED.estado,
             detalle = EXCLUDED.detalle, filas_extraidas = EXCLUDED.filas_extraidas,
             layout = EXCLUDED.layout, origen_lectura = EXCLUDED.origen_lectura,
             motivo_revision = EXCLUDED.motivo_revision,
             productos_afectados = EXCLUDED.productos_afectados,
             codigos_faltantes = EXCLUDED.codigos_faltantes, extraido_en = NOW()`,
        [
            fabricante, unidad.id, unidad.parte || "",
            firma, ultimaMod, hash,
            estado, detalle || "",
            resultado?.filas?.length || 0,
            resultado?.layout || "",
            resultado?.origen || "",
            motivo,
            // Cuantos productos quedan sin dato por culpa de esta unidad:
            // es lo que le importa a quien revisa, no cuantas unidades hay.
            // En un parcial son SOLO los que faltaron, no el modulo entero.
            estado === "ok" ? 0
                : estado === "parcial" ? (faltantes || []).length
                : (unidad.productosEsperados || resultado?.filas?.length || 0),
            (faltantes || []).join(",")
        ]
    );
}

/**
 * Procesa las unidades cambiadas y junta las filas por identidad de
 * producto. Todo lo especifico de la fuente ocurre dentro de
 * adaptador.extraerUnidad().
 */
async function extraerUnidades(pool, adaptador, cambiadas, contexto, onProgreso) {
    const porProducto = new Map();
    const enRevision = [];
    // Los estados de unidad NO se escriben aqui: se acumulan y los graba
    // el llamador dentro de la transaccion, para que un fallo al aplicar
    // no deje firmas marcadas como procesadas.
    const estadosUnidad = [];
    let procesadas = 0;
    let resueltosPorAyuda = 0;

    for (const unidad of cambiadas) {
        let resultado = null;
        let detalle = "";

        try {
            resultado = await adaptador.extraerUnidad(unidad, contexto);

            // La fuente se regenero pero el contenido es identico: se
            // refresca la firma y no se reprocesa nada mas. Exige que la
            // vez anterior haya salido bien -- si no, este atajo ascenderia
            // a 'ok' una unidad de la que nunca se guardo un precio.
            if (unidad.estadoPrevio === "ok" && unidad.hashPrevio
                && resultado?.firmaContenido && unidad.hashPrevio === resultado.firmaContenido) {
                estadosUnidad.push({ unidad, estado: "ok", detalle: "regenerada sin cambios de contenido", resultado });
                procesadas++;
                if (typeof onProgreso === "function") onProgreso(procesadas, cambiadas.length);
                continue;
            }
        } catch (error) {
            detalle = error.message;
        }

        if (!resultado || !resultado.confiable) {
            const motivo = detalle || resultado?.detalle || resultado?.validacion?.motivo || "la lectura no es confiable";
            estadosUnidad.push({ unidad, estado: "revision_manual", detalle: motivo, resultado });
            enRevision.push({ unidad: `${unidad.id}${unidad.parte ? "/" + unidad.parte : ""}`, motivo });
            procesadas++;
            if (typeof onProgreso === "function") onProgreso(procesadas, cambiadas.length);
            continue;
        }

        if (resultado.origen === "vision") resueltosPorAyuda++;

        for (const filaCruda of resultado.filas) {
            const fila = normalizarFila(filaCruda, { nivelesPrecio: adaptador.nivelesPrecio });
            const identidad = identidadDeFila(fila, adaptador.claveIdentidad);
            if (!identidad) continue;

            const previo = porProducto.get(identidad) || {};
            porProducto.set(identidad, {
                ...previo,
                ...fila.precios,
                codigo: previo.codigo || fila.codigo,
                clave: previo.clave || fila.clave,
                ean: previo.ean || fila.ean,
                descripcion: previo.descripcion || fila.descripcion,
                marca: previo.marca || fila.marca,
                referencia: unidad.referencia ?? previo.referencia ?? null,
                unidadId: unidad.id,
                origen_lectura: peorOrigen(previo.origen_lectura, resultado.origen),
                confianza: peorConfianza(previo.confianza, resultado.confianza),
                layout: previo.layout || resultado.layout || "",
                precios_sin_publicar: [...new Set([
                    ...(previo.precios_sin_publicar || []),
                    ...(resultado.preciosSinPublicar || [])
                ])]
            });
        }

        // Un modulo del que se leyeron ALGUNOS productos no es ni un exito
        // ni un fallo: los precios que trae son de fiar --cada codigo se
        // confirmo contra la fuente en texto de TRUPER-- pero faltaron
        // productos que alguien deberia mirar. Antes esto se descartaba
        // entero: 310 modulos perdidos, 113 de ellos por UN solo codigo.
        const parcial = Boolean(resultado.validacion?.parcial);
        estadosUnidad.push({
            unidad,
            estado: parcial ? "parcial" : "ok",
            detalle: parcial ? resultado.validacion.motivo : "",
            faltantes: parcial ? resultado.validacion.faltantes : [],
            resultado
        });
        procesadas++;
        if (typeof onProgreso === "function") onProgreso(procesadas, cambiadas.length);
    }

    // Coherencia entre niveles, ya con TODOS los precios del producto
    // juntos. Es el unico momento en que se pueden cruzar: cada unidad por
    // separado solo ve su propia lista (la de distribuidor no sabe cual es
    // el publico). Aqui es donde se atrapa el digito perdido -- un
    // distribuidor de $1 contra un publico de $115 -- que ninguna
    // validacion de estructura puede ver.
    // Con lo LEIDO no basta. Si de un modulo solo cambio la variante de
    // distribuidor, esta vez solo se leyo ese precio y no hay publico
    // contra el cual cruzarlo: la revision no ve nada y un distribuidor de
    // $1 se guarda encima del bueno. Se traen los precios ya guardados
    // -- solo para COMPARAR, jamas se escriben de vuelta-- para que la
    // revision cruce igual en una corrida incremental que en una completa.
    const guardados = await leerExistentesPorCodigo(pool, adaptador.nombre, [...porProducto.keys()])
        .catch(() => new Map());

    const incoherentes = [];
    for (const [identidad, datos] of porProducto.entries()) {
        const previo = guardados.get(identidad);
        const paraRevisar = { ...datos };
        if (previo) {
            for (const campo of CAMPOS_PRECIO) {
                if (paraRevisar[campo] === undefined && previo[campo] != null) {
                    paraRevisar[campo] = Number(previo[campo]);
                }
            }
        }

        const problemas = revisarCoherenciaNiveles(paraRevisar);
        if (problemas.length === 0) continue;

        // No se guarda un precio del que ya se sospecha: se retiran TODOS
        // los precios del producto y se manda a revision. Es preferible un
        // hueco a un precio equivocado que nadie va a notar.
        for (const campo of CAMPOS_PRECIO) delete datos[campo];
        datos.confianza = "baja";
        datos.incoherente = problemas.join("; ");
        incoherentes.push({ identidad, problemas: problemas.join("; ") });
    }

    return { porProducto, enRevision, resueltosPorAyuda, incoherentes, estadosUnidad };
}

// ---------------------------------------------------------------------
// Aplicacion
// ---------------------------------------------------------------------

/**
 * Pide una conexion y le pone escucha de errores.
 *
 * db.js ya tiene pool.on("error"), pero eso SOLO cubre a los clientes
 * ociosos del pool. Un cliente tomado con connect() emite sus errores en
 * si mismo, y si nadie escucha, Node tumba el proceso entero con
 * "Unhandled 'error' event".
 *
 * Paso de verdad: a las 2h30m de la carga de TRUPER, Postgres corto una
 * conexion ("Connection terminated unexpectedly") y se murio la corrida.
 * No se perdio nada gracias a los lotes -- 614 productos ya estaban
 * guardados -- pero se perdieron las horas que faltaban.
 *
 * El error se guarda para pasarselo a release(): asi el pool DESTRUYE esa
 * conexion en vez de devolverla rota a la fila.
 */
async function conexionVigilada(pool) {
    const client = await pool.connect();
    const estado = { roto: null };

    const alFallar = error => { estado.roto = error; };
    client.on("error", alFallar);

    estado.soltar = () => {
        client.removeListener("error", alFallar);
        // release(error) marca la conexion como inservible. Sin esto
        // volveria al pool y el siguiente lote la tomaria ya muerta.
        client.release(estado.roto || undefined);
    };

    return { client, estado };
}

// La imagen de la fila la produce Postgres, dentro de la misma transaccion
// y ANTES del UPDATE. Antes se guardaba el objeto `existente`, que es una
// proyeccion recortada: le faltaban precio_*_anterior, ean_origen,
// visto_en, actualizado_en, verificado_en y el id, asi que no alcanzaba
// para restaurar la fila -- que es para lo unico que existe un respaldo.
async function respaldarProducto(client, sincronizacionId, fabricante, codigo) {
    await client.query(
        `INSERT INTO public.catalogo_fabricante_respaldos (sincronizacion_id, fabricante, codigo, fila)
         SELECT $1, $2, $3, to_jsonb(p)
           FROM public.catalogo_fabricante_productos p
          WHERE p.fabricante = $2 AND p.codigo = $3`,
        [sincronizacionId, fabricante, codigo]
    );
}

// Cada lote lee lo suyo, fresco y DENTRO de su transaccion. Un snapshot
// unico tomado al principio se vuelve mentira en cuanto commitea el primer
// lote: un codigo dado de alta en el lote 1 seguiria pareciendo "no
// existe" para el lote 40, que intentaria otro INSERT y tumbaria el lote
// entero contra UNIQUE (fabricante, codigo).
async function leerExistentesPorCodigo(ejecutor, fabricante, codigos) {
    if (codigos.length === 0) return new Map();

    const r = await ejecutor.query(
        `SELECT codigo, clave, ean, descripcion, marca, modulo, pagina, estado,
                origen_lectura, layout, confianza, precios_sin_publicar, verificado_por_persona,
                precio_mayoreo, precio_medio_mayoreo, precio_publico, precio_distribuidor
           FROM public.catalogo_fabricante_productos
          WHERE fabricante = $1 AND codigo = ANY($2::text[])`,
        [fabricante, codigos]
    );
    return new Map(r.rows.map(f => [f.codigo, f]));
}

// Datos que se aplican a un producto, juntando lo que dice el universo, el
// enriquecimiento y lo leido de las unidades.
function componerDatos(info, extra, leidos) {
    return {
        clave: info.clave || extra?.clave || leidos?.clave || "",
        ean: extra?.ean || leidos?.ean || "",
        descripcion: extra?.descripcion || leidos?.descripcion || "",
        marca: extra?.marca || leidos?.marca || "",
        modulo: leidos?.unidadId || info.unidadId || "",
        pagina: leidos?.referencia ?? info.referencia ?? null,
        origen_lectura: leidos?.origen_lectura || "",
        layout: leidos?.layout || "",
        confianza: leidos?.confianza || "",
        precios_sin_publicar: leidos?.precios_sin_publicar || [],
        ...(leidos ? Object.fromEntries(
            CAMPOS_PRECIO
                .filter(campo => leidos[campo] !== undefined)
                .map(campo => [campo, leidos[campo]])
        ) : {})
    };
}

/**
 * Aplica UN lote (las unidades de un mismo modulo) en su propia
 * transaccion. Devuelve el delta de contadores solo si commiteo.
 *
 * La linea que sostiene todo el diseño esta al final: las firmas de las
 * unidades se graban en la MISMA transaccion que los productos que
 * salieron de ellas. Si el COMMIT no ocurre, no ocurre ninguna de las dos.
 */
async function aplicarLote(pool, sincronizacionId, fabricante, extraido, universo, extras) {
    const delta = {
        nuevos: 0, modificados: 0, incoherentes: 0,
        sinCoincidencia: 0, incompletos: 0
    };

    const leidas = [...extraido.porProducto.keys()];
    const identidades = universo ? leidas.filter(id => universo.has(id)) : leidas;

    // Segundo cinturon contra un universo mal leido. Si el lote leyo filas
    // y NINGUNA cae en el universo vigente, lo mas probable no es que el
    // modulo este desalineado sino que el universo llego mal (la fuente
    // respondio 200 con HTML que el parseo no reconoce). Firmar esas
    // unidades como "ok" las quemaria para siempre: el etag nuevo hace que
    // la proxima corrida las salte y nadie relee ese modulo hasta que el
    // fabricante regenere la imagen.
    const universoSospechoso = Boolean(universo) && leidas.length > 0 && identidades.length === 0;

    // connect() va DENTRO del try. Fuera, un fallo al pedir conexion --el
    // pool agotado, un corte de red de un segundo-- salia disparado de esta
    // funcion en vez de devolver {ok:false}, y como el bucle de lotes no
    // envuelve la llamada, tumbaba la corrida de 4 horas entera. Justo el
    // caso que el reintento existe para absorber.
    let client = null;
    let soltar = null;
    try {
        const conexion = await conexionVigilada(pool);
        client = conexion.client;
        soltar = conexion.estado.soltar;
        await client.query("BEGIN");

        const guardados = await leerExistentesPorCodigo(client, fabricante, identidades);

        for (const identidad of identidades) {
            const leidos = extraido.porProducto.get(identidad);
            const info = universo?.get(identidad) || {};
            const datos = componerDatos(info, extras.get(identidad), leidos);

            const cambios = await aplicarProducto(
                client, sincronizacionId, fabricante, identidad, datos, guardados.get(identidad)
            );

            // registrarCambio con el CLIENT, no con el pool: son conexiones
            // distintas, asi que por el pool los renglones sobrevivirian al
            // ROLLBACK y quedarian visibles antes del COMMIT.
            for (const cambio of cambios) {
                await registrarCambio(client, sincronizacionId, fabricante, cambio);
            }
            if (cambios.some(c => c.tipo === "nuevo")) delta.nuevos++;
            if (cambios.some(c => c.tipo === "modificado")) delta.modificados++;
        }

        for (const item of extraido.incoherentes || []) {
            await registrarCambio(client, sincronizacionId, fabricante, {
                codigo: item.identidad, tipo: "incompleto",
                detalle: `precios retirados por incoherencia: ${item.problemas}`
            });
        }
        delta.incoherentes = (extraido.incoherentes || []).length;

        for (const item of extraido.enRevision || []) {
            await registrarCambio(client, sincronizacionId, fabricante, {
                codigo: `unidad ${item.unidad}`, tipo: "sin_coincidencia", detalle: item.motivo
            });
        }
        delta.sinCoincidencia = (extraido.enRevision || []).length;

        for (const e of extraido.estadosUnidad) {
            const estado = universoSospechoso ? "revision_manual" : e.estado;
            const detalle = universoSospechoso
                ? "ninguno de sus codigos aparece en el universo vigente: lectura del universo sospechosa"
                : e.detalle;
            await guardarEstadoUnidad(client, fabricante, e.unidad, estado, detalle, e.resultado, e.faltantes);
        }

        await client.query("COMMIT");
        return { ok: true, delta };
    } catch (error) {
        // Si el fallo fue AL pedir la conexion no hay client que revertir
        // ni que liberar; sin estas guardas el catch reventaba con
        // TypeError y tapaba el error de verdad.
        if (client) await client.query("ROLLBACK").catch(() => {});
        // El delta se DESCARTA: contar altas que se deshicieron dejaria el
        // reporte inflado.
        return { ok: false, error, delta: null };
    } finally {
        if (soltar) soltar();
    }
}

/**
 * Alta o actualizacion de un producto: solo se escribe lo que cambio.
 * Corre dentro de la transaccion que abre el llamador.
 */
async function aplicarProducto(client, sincronizacionId, fabricante, codigo, datos, existente) {
    const cambios = [];

    if (!existente) {
        await client.query(
            `INSERT INTO public.catalogo_fabricante_productos
                (fabricante, codigo, clave, ean, descripcion, marca, modulo, pagina,
                 precio_mayoreo, precio_medio_mayoreo, precio_publico, precio_distribuidor,
                 origen_lectura, layout, confianza, precios_sin_publicar,
                 estado, visto_en, actualizado_en)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,'activo',NOW(),NOW())`,
            [
                fabricante, codigo, datos.clave || "", datos.ean || "",
                datos.descripcion || "", datos.marca || "",
                datos.modulo || "", datos.pagina ?? null,
                datos.precio_mayoreo ?? null, datos.precio_medio_mayoreo ?? null,
                datos.precio_publico ?? null, datos.precio_distribuidor ?? null,
                datos.origen_lectura || "", datos.layout || "", datos.confianza || "",
                (datos.precios_sin_publicar || []).join(",")
            ]
        );
        return [{ codigo, tipo: "nuevo" }];
    }

    const sets = [];
    const valores = [];
    let n = 1;

    for (const campo of CAMPOS_PRECIO) {
        const nuevo = datos[campo];
        if (nuevo === undefined) continue; // esta unidad no aporta este precio
        const anterior = existente[campo];
        if (mismoPrecio(anterior, nuevo)) continue;

        sets.push(`${campo} = $${n++}`, `${campo}_anterior = $${n++}`);
        valores.push(nuevo, anterior);
        cambios.push({
            codigo, tipo: "modificado", campo,
            valorAnterior: formatearPrecio(anterior),
            valorNuevo: formatearPrecio(nuevo)
        });
    }

    // Identidad: solo se rellena si estaba vacia. Nunca se pisa una
    // descripcion o clave ya guardada por una lectura peor.
    for (const campo of ["clave", "ean", "descripcion", "marca"]) {
        const nuevo = datos[campo];
        if (!nuevo) continue;
        if (existente[campo]) continue;
        sets.push(`${campo} = $${n++}`);
        valores.push(nuevo);
    }

    // modulo y pagina NO son identidad, son trazabilidad: dicen de donde
    // salieron los precios que tiene el producto ahora. Rellenarlos solo si
    // estaban vacios dejaba la referencia congelada en la primera lectura,
    // asi que un producto que el fabricante movio de pagina terminaba con
    // precios de un modulo y con la pagina de otro -- justo lo que uno mira
    // cuando quiere verificar un precio contra el catalogo impreso.
    if (datos.modulo && datos.modulo !== existente.modulo) {
        sets.push(`modulo = $${n++}`);
        valores.push(datos.modulo);
    }
    if (datos.pagina != null && String(datos.pagina) !== String(existente.pagina ?? "")) {
        sets.push(`pagina = $${n++}`);
        valores.push(datos.pagina);
    }

    // Trazabilidad de la lectura: refleja como se leyo ESTA vez, salvo
    // que una persona ya lo haya verificado -- ahi su revision manda.
    if (datos.origen_lectura && !existente.verificado_por_persona) {
        for (const [campo, valor] of [
            ["origen_lectura", datos.origen_lectura],
            ["layout", datos.layout || ""],
            ["confianza", datos.confianza || ""],
            ["precios_sin_publicar", (datos.precios_sin_publicar || []).join(",")]
        ]) {
            if (String(existente[campo] ?? "") === String(valor)) continue;
            sets.push(`${campo} = $${n++}`);
            valores.push(valor);
        }
    }

    if (existente.estado === "descontinuado") {
        sets.push(`estado = 'activo'`);
        cambios.push({ codigo, tipo: "modificado", campo: "estado", valorAnterior: "descontinuado", valorNuevo: "activo" });
    }

    if (sets.length === 0) {
        await client.query(
            `UPDATE public.catalogo_fabricante_productos SET visto_en = NOW()
             WHERE fabricante = $1 AND codigo = $2`,
            [fabricante, codigo]
        );
        return [];
    }

    // actualizado_en es la "Fecha de actualizacion" que ve el dueno: debe
    // moverse solo cuando cambio un DATO del catalogo, no cuando lo unico
    // distinto es como lo leimos esta vez.
    const camposFecha = cambios.length > 0 ? ", actualizado_en = NOW()" : "";

    // Respaldo ANTES de escribir, y solo si de verdad se va a escribir algo.
    // Respaldarlo al entrar generaba una fila de respaldo por cada producto
    // de cada corrida -- ~40.000 por vuelta, casi todas de filas que no
    // cambiaron -- y para lo unico que sirve un respaldo es para restaurar
    // lo que se piso.
    await respaldarProducto(client, sincronizacionId, fabricante, codigo);

    valores.push(fabricante, codigo);
    await client.query(
        `UPDATE public.catalogo_fabricante_productos
         SET ${sets.join(", ")}, visto_en = NOW()${camposFecha}
         WHERE fabricante = $${n++} AND codigo = $${n}`,
        valores
    );

    return cambios;
}

// ---------------------------------------------------------------------
// Orquestacion
// ---------------------------------------------------------------------

/**
 * Corre una sincronizacion completa de cualquier fuente que cumpla el
 * contrato.
 *
 * ORDEN DE FASES -- el orden importa y es la mitad del diseño:
 *   0. cerrar corridas huerfanas, abrir la propia, empezar a latir
 *   1. leer universo y unidades (todavia no se escribe ningun dato)
 *   2. LOS DOS FRENOS, antes de gastar un solo OCR
 *   3. enriquecer productos nuevos (con tope)
 *   4. bucle de lotes  <-- aqui viven las horas, y cada lote se confirma solo
 *   5. cierre de universo: vigencia, altas sin precio, descontinuados
 *   6. aportar identidad al Catalogo Maestro
 *   7. cerrar la corrida
 *
 * @param {object} pool
 * @param {object} adaptador  ver catalogo-fabricante-contrato.js
 * @param {object} [opciones]
 * @param {boolean} [opciones.confirmarRegeneracionMasiva]
 * @param {boolean} [opciones.confirmarBajaMasiva]
 * @param {object}  [opciones.contexto] se pasa tal cual al adaptador
 * @param {function}[opciones.onProgreso]
 */
async function sincronizar(pool, adaptador, opciones = {}) {
    const problemas = validarAdaptador(adaptador);
    if (problemas.length > 0) {
        throw new Error(`el adaptador no cumple el contrato: ${problemas.join("; ")}`);
    }

    const fabricante = adaptador.nombre;
    const progreso = opciones.onProgreso || (() => {});

    // FASE 0 -----------------------------------------------------------
    // Corridas que quedaron vivas de procesos que ya no existen. Sin esto
    // el indice unico impediria arrancar despues de un apagon.
    await cerrarCorridasHuerfanas(pool, fabricante).catch(() => {});

    const sincronizacionId = await crearSincronizacion(
        pool, fabricante, opciones.confirmarRegeneracionMasiva === true
    );
    const latido = crearLatido(pool, sincronizacionId);

    // El latido cuelga del MISMO callback que ya emite el adaptador, no de
    // llamadas sueltas entre fases. Con latidos solo entre fases habia una
    // ventana muerta de ~35 minutos -- listarUniverso recorre ~600 paginas
    // y listarUnidades pide la firma de 7.932 unidades -- durante la cual
    // una corrida sana parecia un proceso muerto y la siguiente la habria
    // cerrado por huerfana a los 30. Enganchado aqui, cualquier fase que
    // reporte avance mantiene viva la corrida, incluidas las de los
    // adaptadores que todavia no existen.
    const contexto = {
        ...(opciones.contexto || {}),
        onProgreso: info => { latido(); progreso(info); }
    };

    const contadores = {
        unidadesRevisadas: 0, unidadesCambiadas: 0,
        nuevos: 0, modificados: 0, descontinuados: 0,
        sinCoincidencia: 0, incompletos: 0,
        incoherentes: 0, lotesFallidos: 0
    };

    try {
        // FASE 1 -------------------------------------------------------
        progreso({ etapa: "universo", mensaje: "leyendo que productos publica hoy la fuente" });
        const universo = await adaptador.listarUniverso(contexto);
        latido();

        progreso({ etapa: "unidades", mensaje: "listando de donde viene la informacion" });
        const unidades = await adaptador.listarUnidades(contexto);
        if (!Array.isArray(unidades) || unidades.length === 0) {
            throw new Error("la fuente no devolvio ninguna unidad de informacion");
        }
        latido();

        progreso({ etapa: "revisando", mensaje: "viendo que cambio desde la ultima vez" });
        const { revisadas, cambiadas, conEstadoPrevio, cambiadasConEstadoPrevio } =
            await detectarUnidadesCambiadas(pool, adaptador, unidades,
                (hechas, cambios) => { latido(); progreso({ etapa: "revisando", hechas, cambios }); });

        contadores.unidadesRevisadas = revisadas;
        contadores.unidadesCambiadas = cambiadas.length;

        // FASE 2 -- LOS FRENOS, ANTES DE GASTAR UN SOLO OCR -------------
        //
        // Antes vivian repartidos: el de regeneracion aqui y el de baja
        // masiva dentro de la transaccion final. Ese segundo dependia de
        // que un ROLLBACK deshiciera todo, y con lotes ya no hay una
        // transaccion que cubra las 4 horas. Corriendolos aqui, el mensaje
        // "no se aplico nada" es literalmente cierto, y un universo mal
        // leido se atrapa en segundos en vez de a las 4 horas.

        // ALCANCE PARCIAL: la corrida viene por un subconjunto de la
        // fuente, no por el catalogo entero.
        //
        // Cambia una cosa fundamental: el "universo" ya NO es la lista de
        // todo lo vigente, es solo lo que cabe en ese subconjunto. Sacar
        // conclusiones de ausencia con esa lista seria catastrofico --
        // pedir 296 modulos de 3.970 y concluir que el fabricante
        // descontinuo 38.000 productos.
        //
        // Se resuelve ANTES que los dos frenos porque cambia como se leen
        // los dos.
        const alcanceParcial = opciones.alcanceParcial === true;

        // Una confirmacion de regeneracion es del operador sobre un evento
        // de la fuente, no de un proceso: si la corrida que la traia murio,
        // la siguiente la hereda. Sin esto, reanudar una regeneracion ya
        // confirmada volveria a pedir confirmacion en cada corte.
        const anterior = await pool.query(
            `SELECT confirmo_regeneracion
               FROM public.catalogo_fabricante_sincronizaciones
              WHERE fabricante = $1 AND id <> $2 AND estado IN ('en_curso', 'error')
                AND iniciada_en > NOW() - interval '48 hours'
              ORDER BY id DESC LIMIT 1`,
            [fabricante, sincronizacionId]
        );
        // La de BAJA masiva nunca se hereda: es la unica proteccion dura
        // contra descontinuar media tienda por una lectura incompleta.
        const heredada = Boolean(anterior.rows[0]?.confirmo_regeneracion);
        const confirmadaRegeneracion = opciones.confirmarRegeneracionMasiva === true || heredada;

        // Y se PERSISTE en la corrida propia. Sin esto la confirmacion
        // sobrevivia a un solo corte: la corrida heredera la usaba pero
        // dejaba su columna en false, asi que la siguiente ya no encontraba
        // de donde heredarla y volvia a preguntar. En una carga de 4 horas
        // que se corta dos veces, eso deja el catalogo trabado.
        if (heredada) {
            await pool.query(
                `UPDATE public.catalogo_fabricante_sincronizaciones
                    SET confirmo_regeneracion = true WHERE id = $1`,
                [sincronizacionId]
            ).catch(() => {});
        }

        // El freno de regeneracion masiva no aplica a una corrida parcial.
        //
        // Existe para no reprocesar miles de unidades cuando el fabricante
        // regenera todas sus imagenes sin cambiar un precio. Pero en una
        // corrida parcial las unidades se eligieron A PROPOSITO --son las
        // que quedaron pendientes-- asi que que el 100% "haya cambiado" es
        // lo esperado, no una señal de nada. Dejarlo activo hace que la
        // corrida se detenga siempre a pedir permiso para hacer justo lo
        // que se le pidio.
        const fraccion = (alcanceParcial || conEstadoPrevio === 0)
            ? 0
            : cambiadasConEstadoPrevio / conEstadoPrevio;

        if (fraccion > UMBRAL_REGENERACION_MASIVA && !confirmadaRegeneracion) {
            const detalle = `la fuente regenero ${cambiadasConEstadoPrevio} de ${conEstadoPrevio} unidades `
                + `ya conocidas (${Math.round(fraccion * 100)}%). Puede ser una regeneracion masiva sin cambios `
                + `reales de precio. Confirma para procesarlas.`;
            await cerrarSincronizacion(pool, sincronizacionId, "esperando_confirmacion", contadores, detalle);
            return { sincronizacionId, estado: "esperando_confirmacion", contadores, detalle };
        }

        // ALCANCE PARCIAL: la corrida viene por un subconjunto de la
        // fuente, no por el catalogo entero.
        //
        // Cambia una cosa fundamental: el "universo" ya NO es la lista de
        // todo lo vigente, es solo lo que cabe en ese subconjunto. Sacar
        // conclusiones de ausencia con esa lista seria catastrofico --
        // pedir 296 modulos de 3.970 y concluir que el fabricante
        // descontinuo 38.000 productos. Por eso una corrida parcial NUNCA
        // da de baja ni da de alta por ausencia: solo actualiza lo que
        // pidio. La salvaguarda de baja masiva lo atraparia igual, pero no
        // se deja como unica linea de defensa algo que depende de un
        // umbral.

        // Snapshot ligero: solo los codigos. Traer las 17 columnas de
        // 40.000 filas era el pico de memoria de toda la corrida.
        const activos = alcanceParcial
            ? { rows: [] }
            : await pool.query(
                `SELECT codigo FROM public.catalogo_fabricante_productos
                  WHERE fabricante = $1 AND estado = 'activo'`,
                [fabricante]
            );
        const totalActivos = activos.rows.length;
        const paraDescontinuar = universo
            ? activos.rows.map(f => f.codigo).filter(c => !universo.has(c))
            : [];
        const fraccionBaja = totalActivos > 0 ? paraDescontinuar.length / totalActivos : 0;

        if (totalActivos >= MIN_ACTIVOS_PARA_SALVAGUARDA
            && fraccionBaja > UMBRAL_BAJA_MASIVA
            && !opciones.confirmarBajaMasiva) {
            throw new Error(
                `la fuente dejo de listar ${paraDescontinuar.length} de ${totalActivos} productos activos `
                + `(${Math.round(fraccionBaja * 100)}%). Parece una lectura incompleta, no un cambio real de `
                + `catalogo: no se aplico nada.`
            );
        }

        // FASE 3 -- enriquecimiento -----------------------------------
        //
        // El criterio es "le FALTA la descripcion", no "es nuevo". Con
        // "nuevo" el tope de 500 por corrida se gastaba una sola vez: en la
        // primera carga los 15.758 productos se dan de alta, y a partir de
        // ahi ninguno vuelve a ser nuevo, asi que los 15.258 restantes se
        // quedaban sin descripcion para siempre. Asi cada corrida se lleva
        // otros 500 y el hueco se cierra solo.
        const identidadesUniverso = universo ? [...universo.keys()] : [];
        const conDescripcion = new Set(
            (await pool.query(
                `SELECT codigo FROM public.catalogo_fabricante_productos
                  WHERE fabricante = $1 AND COALESCE(descripcion, '') <> ''`,
                [fabricante]
            )).rows.map(f => f.codigo)
        );
        const porEnriquecer = identidadesUniverso.filter(id => !conDescripcion.has(id));
        const extras = new Map();

        if (typeof adaptador.datosDeProducto === "function") {
            let pedidas = 0;
            for (const identidad of porEnriquecer) {
                if (pedidas >= MAX_ENRIQUECIMIENTOS_POR_CORRIDA) break;
                try {
                    const datos = await adaptador.datosDeProducto(identidad, contexto);
                    if (datos) extras.set(identidad, datos);
                } catch (error) {
                    // Sin enriquecer, el producto igual se da de alta.
                }
                pedidas++;
                latido();
                progreso({
                    etapa: "enriqueciendo", hechas: pedidas,
                    total: Math.min(porEnriquecer.length, MAX_ENRIQUECIMIENTOS_POR_CORRIDA),
                    pendientes: porEnriquecer.length
                });
            }
        }

        // FASE 4 -- bucle de lotes ------------------------------------
        //
        // Cada lote es un modulo, se lee y se aplica en su propia
        // transaccion. Si el proceso muere, lo confirmado queda y la
        // proxima corrida sigue: las unidades de los lotes commiteados ya
        // tienen su firma, asi que detectarUnidadesCambiadas las salta.
        const lotes = agruparPorUnidad(cambiadas);
        let lotesSeguidosFallidos = 0;
        let unidadesHechas = 0;

        progreso({
            etapa: "extrayendo",
            mensaje: `procesando ${cambiadas.length} unidades en ${lotes.length} modulos`
        });

        // Varios lotes a la vez. Cada uno es un modulo distinto, con sus
        // propios productos y su propia transaccion, asi que no se pisan.
        // Los invariantes se conservan intactos: las firmas se siguen
        // grabando con los productos de su lote, y el chequeo de
        // coherencia sigue viendo las dos variantes juntas porque un lote
        // es un modulo entero.
        //
        // Si dos lotes intentan dar de alta el mismo codigo a la vez, uno
        // choca contra el UNIQUE y falla; el reintento que ya existia lo
        // encuentra creado y hace UPDATE. No hace falta nada mas.
        let abortar = null;

        async function correrLote(lote) {
            if (abortar) return;

            const extraido = await extraerUnidades(pool, adaptador, lote, contexto, () => latido());

            let resultado = await aplicarLote(pool, sincronizacionId, fabricante, extraido, universo, extras);
            if (!resultado.ok) {
                // Un reintento del mismo lote: un fallo transitorio de red
                // o un deadlock no deberian costar la relectura del modulo.
                await new Promise(r => setTimeout(r, 1000));
                resultado = await aplicarLote(pool, sincronizacionId, fabricante, extraido, universo, extras);
            }

            if (resultado.ok) {
                contadores.nuevos += resultado.delta.nuevos;
                contadores.modificados += resultado.delta.modificados;
                contadores.incoherentes += resultado.delta.incoherentes;
                contadores.sinCoincidencia += resultado.delta.sinCoincidencia;
                lotesSeguidosFallidos = 0;
            } else {
                // No se escribio NADA de este lote, ni sus firmas: eso es
                // justo lo que hace que la corrida siguiente lo relea.
                contadores.lotesFallidos++;
                lotesSeguidosFallidos++;
                console.log(`[catalogo-fabricante] el modulo ${lote[0].id} fallo al aplicarse: ${resultado.error.message}`);
                if (lotesSeguidosFallidos >= MAX_LOTES_FALLIDOS_SEGUIDOS) abortar = resultado.error;
            }

            unidadesHechas += lote.length;
            latido();
            progreso({ etapa: "extrayendo", hechas: unidadesHechas, total: cambiadas.length });
        }

        // Los trabajadores se reparten la fila: cada uno toma el siguiente
        // lote pendiente al terminar el suyo. Asi un modulo lento no frena
        // a los demas, que es lo que pasaria repartiendo por bloques.
        let siguienteLote = 0;
        const trabajadores = Array.from(
            { length: Math.min(LOTES_EN_PARALELO, lotes.length) },
            async () => {
                while (!abortar) {
                    const indice = siguienteLote++;
                    if (indice >= lotes.length) return;
                    await correrLote(lotes[indice]);
                }
            }
        );

        await Promise.all(trabajadores);
        if (abortar) throw abortar;

        // FASE 5 -- cierre de universo --------------------------------
        // Se deriva solo del universo y de la base, asi que es idempotente:
        // si la corrida anterior murio antes de llegar aqui, la siguiente
        // la corre completa.
        //
        // Se salta ENTERA en una corrida parcial: todos sus pasos --altas
        // por ausencia, bajas, reactivaciones-- concluyen cosas a partir de
        // "esto no esta en el universo", y en una corrida parcial el
        // universo es solo el trozo que se pidio. Ahi la ausencia no
        // significa nada.
        if (universo && !alcanceParcial) {
            await cerrarUniverso(pool, {
                fabricante, sincronizacionId, universo, extras,
                paraDescontinuar, contadores, latido, progreso
            });
        } else if (alcanceParcial) {
            progreso({ etapa: "cerrando", mensaje: "corrida parcial: no se tocan altas ni bajas" });
        }

        // FASE 6 -- identidad al Catalogo Maestro ---------------------
        // Va aparte y en su propio try: si esto falla, la sincronizacion
        // de precios sigue siendo valida. Son dos cosas distintas y una no
        // debe tumbar a la otra. NUNCA se aporta precio, solo identidad.
        if (opciones.aportarAlMaestro !== false) {
            try {
                const { aportarAlMaestro } = require("./catalogo-maestro-fabricante");
                contadores.maestro = await aportarAlMaestro(pool, fabricante, opciones.maestro);
                progreso({ etapa: "maestro", ...contadores.maestro });
            } catch (error) {
                contadores.maestroError = error.message;
            }
        }

        // FASE 7 ------------------------------------------------------
        const detalleFinal = [
            contadores.incoherentes ? `${contadores.incoherentes} con precios retirados por incoherencia` : "",
            contadores.lotesFallidos ? `${contadores.lotesFallidos} modulos no se pudieron aplicar` : "",
            contadores.reactivados ? `${contadores.reactivados} volvieron a activarse` : "",
            // Que el cierre haya fallado no puede quedarse solo en la
            // consola: "completada" sin mencionar que las bajas no se
            // aplicaron es un reporte que miente.
            (contadores.fallosAlCerrar || []).length
                ? `fallos al cerrar -- ${contadores.fallosAlCerrar.join(" | ")}` : ""
        ].filter(Boolean).join("; ");

        await cerrarSincronizacion(pool, sincronizacionId, "completada", contadores, detalleFinal);
        // El detalle se DEVUELVE, no solo se guarda: scripts/bootstrap-truper.js
        // lo imprime al terminar, y hasta ahora siempre le llegaba vacio --
        // asi que avisos como "las bajas no se aplicaron" quedaban unicamente
        // en la base, donde nadie los mira.
        return { sincronizacionId, estado: "completada", contadores, detalle: detalleFinal };
    } catch (error) {
        // Dejar constancia del fallo es deseable, pero NO a costa de
        // perder el error original. Si la corrida murio porque se cayo la
        // red, la base tampoco es alcanzable y este UPDATE falla tambien:
        // sin este try/catch, el error de cierre tapaba al de verdad y el
        // proceso quedaba colgado con la corrida marcada "en_curso" para
        // siempre. Paso de verdad al cortarse el internet a media carga.
        try {
            await cerrarSincronizacion(pool, sincronizacionId, "error", contadores, error.message);
        } catch (errorAlCerrar) {
            console.log(
                `[catalogo-fabricante] no se pudo registrar el fallo de la corrida ${sincronizacionId}: ${errorAlCerrar.message}`
            );
        }
        throw error;
    }
}

/**
 * FASE 5: lo que se deduce del universo entero y no de un lote --
 * vigencia, altas de productos que ninguna unidad trajo, y bajas.
 *
 * `paraDescontinuar` viene calculado y ya validado en la fase 2. No se
 * recalcula: los lotes solo tocan identidades que ESTAN en el universo, y
 * las bajas son justo las que NO estan, asi que los dos conjuntos son
 * disjuntos y ningun lote pudo cambiar esa lista.
 */
async function cerrarUniverso(pool, ctx) {
    const { fabricante, sincronizacionId, universo, extras, paraDescontinuar, contadores, latido, progreso } = ctx;

    progreso({ etapa: "cerrando", mensaje: "actualizando vigencia y bajas" });

    // Cada paso de esta fase avisa que avanza.
    //
    // Antes solo se anunciaba al entrar, y luego se pasaba media hora
    // callada haciendo miles de UPDATEs. Quien vigila la corrida --
    // scripts/bootstrap-truper.js se rinde a los 15 minutos sin senal --
    // no puede distinguir eso de un proceso trabado, y mataba una carga
    // que estaba trabajando bien. Paso de verdad: la extraccion termino
    // completa (3.625 de 3.625) y la corrida murio en el cierre.
    let vistos = 0;

    // 1. Vigencia: "lo segui viendo". Antes eran ~40.000 UPDATE de una
    //    fila; aqui uno por cada 2.000 codigos.
    for (const trozo of trocear([...universo.keys()], 2000)) {
        await pool.query(
            `UPDATE public.catalogo_fabricante_productos SET visto_en = NOW()
              WHERE fabricante = $1 AND codigo = ANY($2::text[])`,
            [fabricante, trozo]
        );
        latido();
        vistos += trozo.length;
        progreso({ etapa: "cerrando", paso: "vigencia", hechas: vistos, total: universo.size });
    }

    // 1.b REACTIVACION. El universo vuelve a listar algo que una corrida
    //     anterior dio de baja -- tipicamente porque aquella leyo el
    //     universo incompleto y la baja no llego al 30% que dispara el
    //     freno, asi que paso callada.
    //
    //     La otra reactivacion vive en aplicarProducto, y a esa solo se
    //     llega si el modulo del producto cambio de firma. Si el fabricante
    //     no ha regenerado ese JPG, no hay lote, no hay reactivacion: el
    //     producto se queda 'descontinuado' para siempre y las pantallas
    //     del negocio lo filtran. Aqui se apoya solo en la base y el
    //     universo, asi que es idempotente como el resto de la fase, y no
    //     inventa ningun precio -- el producto conserva los que tenia.
    const revividos = (await pool.query(
        `SELECT codigo FROM public.catalogo_fabricante_productos
          WHERE fabricante = $1 AND estado = 'descontinuado'`,
        [fabricante]
    )).rows.map(f => f.codigo).filter(c => universo.has(c));

    for (const trozo of trocear(revividos, 500)) {
        const hechos = await enTransaccion(pool, async client => {
            for (const codigo of trozo) {
                await respaldarProducto(client, sincronizacionId, fabricante, codigo);
                await client.query(
                    `UPDATE public.catalogo_fabricante_productos
                        SET estado = 'activo', actualizado_en = NOW(), visto_en = NOW()
                      WHERE fabricante = $1 AND codigo = $2`,
                    [fabricante, codigo]
                );
                await registrarCambio(client, sincronizacionId, fabricante, {
                    codigo, tipo: "modificado", campo: "estado",
                    valorAnterior: "descontinuado", valorNuevo: "activo",
                    detalle: "la fuente volvio a listarlo"
                });
            }
            return trozo.length;
        });

        // Los contadores se mueven DESPUES del COMMIT. Sumarlos dentro del
        // bucle contaba como hechas cosas que el ROLLBACK deshizo.
        if (hechos.ok) contadores.reactivados = (contadores.reactivados || 0) + hechos.valor;
        else anotarFalloDeCierre(contadores, "reactivaciones", hechos.error);
        latido();
        progreso({ etapa: "cerrando", paso: "reactivaciones" });
    }

    // 2. Altas de productos que el universo lista pero ninguna unidad
    //    trajo. El "que ya existe" se relee FRESCO: los lotes de la fase 4
    //    insertaron filas y cualquier snapshot anterior esta obsoleto.
    const hay = new Set(
        (await pool.query(
            `SELECT codigo FROM public.catalogo_fabricante_productos WHERE fabricante = $1`,
            [fabricante]
        )).rows.map(f => f.codigo)
    );
    const faltantes = [...universo.keys()].filter(c => !hay.has(c));

    for (const trozo of trocear(faltantes, 500)) {
        const hechos = await enTransaccion(pool, async client => {
            for (const codigo of trozo) {
                const datos = componerDatos(universo.get(codigo) || {}, extras.get(codigo), null);
                const cambios = await aplicarProducto(client, sincronizacionId, fabricante, codigo, datos, null);
                for (const cambio of cambios) {
                    await registrarCambio(client, sincronizacionId, fabricante, cambio);
                }
                await registrarCambio(client, sincronizacionId, fabricante, {
                    codigo, tipo: "incompleto",
                    detalle: "alta sin precios: su unidad no cambio o no se pudo leer"
                });
            }
            return trozo.length;
        });

        if (hechos.ok) {
            contadores.nuevos += hechos.valor;
            contadores.incompletos += hechos.valor;
        } else {
            anotarFalloDeCierre(contadores, "altas sin precios", hechos.error);
        }
        latido();
        progreso({ etapa: "cerrando", paso: "altas", hechas: contadores.nuevos });
    }

    // 3. Bajas, por trozos. Se marcan, nunca se borran.
    for (const trozo of trocear(paraDescontinuar, 500)) {
        const hechos = await enTransaccion(pool, async client => {
            for (const codigo of trozo) {
                await respaldarProducto(client, sincronizacionId, fabricante, codigo);
                await client.query(
                    `UPDATE public.catalogo_fabricante_productos
                        SET estado = 'descontinuado', actualizado_en = NOW()
                      WHERE fabricante = $1 AND codigo = $2`,
                    [fabricante, codigo]
                );
                await registrarCambio(client, sincronizacionId, fabricante, {
                    codigo, tipo: "descontinuado", detalle: "la fuente dejo de listarlo"
                });
            }
            return trozo.length;
        });

        if (hechos.ok) contadores.descontinuados += hechos.valor;
        else anotarFalloDeCierre(contadores, "bajas", hechos.error);
        latido();
        progreso({ etapa: "cerrando", paso: "bajas", hechas: contadores.descontinuados });
    }
}

// Un fallo al cerrar el universo no debe tumbar una corrida cuyos precios
// ya estan guardados, pero TAMPOCO puede desaparecer en la consola: antes
// la corrida se cerraba como "completada" sin rastro de que las bajas no
// se aplicaron. Queda en los contadores y sale en el detalle del reporte.
function anotarFalloDeCierre(contadores, paso, error) {
    contadores.fallosAlCerrar = contadores.fallosAlCerrar || [];
    contadores.fallosAlCerrar.push(`${paso}: ${error.message}`);
    console.log(`[catalogo-fabricante] fallo el paso de ${paso} al cerrar: ${error.message}`);
}

// BEGIN/COMMIT/ROLLBACK con la conexion siempre liberada y el connect()
// dentro del try -- si falla al pedirla no hay client que revertir. Devuelve
// {ok, valor} para que el llamador sume contadores SOLO si commiteo.
async function enTransaccion(pool, trabajo) {
    let client = null;
    let soltar = null;
    try {
        const conexion = await conexionVigilada(pool);
        client = conexion.client;
        soltar = conexion.estado.soltar;
        await client.query("BEGIN");
        const valor = await trabajo(client);
        await client.query("COMMIT");
        return { ok: true, valor };
    } catch (error) {
        if (client) await client.query("ROLLBACK").catch(() => {});
        return { ok: false, error };
    } finally {
        if (soltar) soltar();
    }
}

/**
 * Cierra las corridas que quedaron "en_curso" sin proceso detras: pasa
 * cuando el equipo se apaga o se cae la red a media carga. Se corre al
 * arrancar una corrida nueva para que el historial no acumule fantasmas.
 */
// 5 minutos, no 30: el latido entra cada 30 segundos, asi que un proceso
// muerto se nota en dos minutos. Con 30 minutos, reanudar tras un corte
// quedaba bloqueado media hora -- la corrida difunta seguia contando como
// viva y el indice unico rechazaba la nueva. Paso de verdad al detener una
// carga a proposito: hubo que cerrar la fila a mano.
async function cerrarCorridasHuerfanas(pool, fabricante, minutosSinAvance = 5) {
    const r = await pool.query(
        `UPDATE public.catalogo_fabricante_sincronizaciones
         SET estado = 'error',
             detalle = 'la corrida quedo sin avanzar (equipo apagado o sin conexion)',
             terminada_en = NOW()
         WHERE fabricante = $1
           AND estado = 'en_curso'
           -- Por el LATIDO, no por la hora de arranque: una carga sana de
           -- TRUPER dura 4 horas, asi que mirar iniciada_en daba por muerta
           -- una corrida que estaba trabajando. COALESCE cubre las corridas
           -- viejas, anteriores a que existiera la columna.
           AND COALESCE(latido_en, iniciada_en) < NOW() - ($2 || ' minutes')::interval
         RETURNING id`,
        [fabricante, String(minutosSinAvance)]
    );
    return r.rows.map(f => f.id);
}

module.exports = {
    sincronizar,
    cerrarCorridasHuerfanas,
    detectarUnidadesCambiadas,
    extraerUnidades,
    aplicarProducto,
    aplicarLote,
    agruparPorUnidad,
    componerDatos,
    crearSincronizacion,
    MAX_LOTES_FALLIDOS_SEGUIDOS,
    LOTES_EN_PARALELO,
    clasificarRevision,
    mismoPrecio,
    formatearPrecio,
    peorConfianza,
    peorOrigen,
    trocear,
    UMBRAL_REGENERACION_MASIVA,
    UMBRAL_BAJA_MASIVA,
    MIN_ACTIVOS_PARA_SALVAGUARDA,
    MAX_ENRIQUECIMIENTOS_POR_CORRIDA,
    CAMPOS_PRECIO
};
