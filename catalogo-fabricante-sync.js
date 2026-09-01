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

async function crearSincronizacion(pool, fabricante) {
    const resultado = await pool.query(
        `INSERT INTO public.catalogo_fabricante_sincronizaciones (fabricante, estado)
         VALUES ($1, 'en_curso') RETURNING id`,
        [fabricante]
    );
    return resultado.rows[0].id;
}

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
        `SELECT modulo, variante, etag, hash_contenido
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

        const sinCambio = teniaEstado && previo.etag === String(unidad.firma || "");
        if (sinCambio) continue;

        if (teniaEstado) cambiadasConEstadoPrevio++;

        cambiadas.push({
            ...unidad,
            parte,
            firmaPrevia: previo?.etag || "",
            hashPrevio: previo?.hash_contenido || ""
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
async function guardarEstadoUnidad(ejecutor, fabricante, unidad, estado, detalle, resultado) {
    const motivo = estado === "ok" ? "" : clasificarRevision(resultado);

    await ejecutor.query(
        `INSERT INTO public.catalogo_fabricante_modulos
            (fabricante, modulo, variante, etag, last_modified, hash_contenido, estado, detalle,
             filas_extraidas, layout, origen_lectura, motivo_revision, productos_afectados, extraido_en)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,NOW())
         ON CONFLICT (fabricante, modulo, variante) DO UPDATE
         SET etag = EXCLUDED.etag, last_modified = EXCLUDED.last_modified,
             hash_contenido = EXCLUDED.hash_contenido, estado = EXCLUDED.estado,
             detalle = EXCLUDED.detalle, filas_extraidas = EXCLUDED.filas_extraidas,
             layout = EXCLUDED.layout, origen_lectura = EXCLUDED.origen_lectura,
             motivo_revision = EXCLUDED.motivo_revision,
             productos_afectados = EXCLUDED.productos_afectados, extraido_en = NOW()`,
        [
            fabricante, unidad.id, unidad.parte || "",
            String(unidad.firma || ""), String(unidad.lastModified || ""),
            resultado?.firmaContenido || "",
            estado, detalle || "",
            resultado?.filas?.length || 0,
            resultado?.layout || "",
            resultado?.origen || "",
            motivo,
            // Cuantos productos quedan sin dato por culpa de esta unidad:
            // es lo que le importa a quien revisa, no cuantas unidades hay.
            estado === "ok" ? 0 : (unidad.productosEsperados || resultado?.filas?.length || 0)
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
            // refresca la firma y no se reprocesa nada mas.
            if (unidad.hashPrevio && resultado?.firmaContenido && unidad.hashPrevio === resultado.firmaContenido) {
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

        estadosUnidad.push({ unidad, estado: "ok", detalle: "", resultado });
        procesadas++;
        if (typeof onProgreso === "function") onProgreso(procesadas, cambiadas.length);
    }

    // Coherencia entre niveles, ya con TODOS los precios del producto
    // juntos. Es el unico momento en que se pueden cruzar: cada unidad por
    // separado solo ve su propia lista (la de distribuidor no sabe cual es
    // el publico). Aqui es donde se atrapa el digito perdido -- un
    // distribuidor de $1 contra un publico de $115 -- que ninguna
    // validacion de estructura puede ver.
    const incoherentes = [];
    for (const [identidad, datos] of porProducto.entries()) {
        const problemas = revisarCoherenciaNiveles(datos);
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

async function respaldarFila(client, sincronizacionId, fabricante, fila) {
    await client.query(
        `INSERT INTO public.catalogo_fabricante_respaldos (sincronizacion_id, fabricante, codigo, fila)
         VALUES ($1, $2, $3, $4)`,
        [sincronizacionId, fabricante, fila.codigo, JSON.stringify(fila)]
    );
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

    // Respaldo ANTES de cualquier escritura sobre una fila existente.
    await respaldarFila(client, sincronizacionId, fabricante, existente);

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
    for (const campo of ["clave", "ean", "descripcion", "marca", "modulo"]) {
        const nuevo = datos[campo];
        if (!nuevo) continue;
        if (existente[campo]) continue;
        sets.push(`${campo} = $${n++}`);
        valores.push(nuevo);
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
    const contexto = { ...(opciones.contexto || {}), onProgreso: progreso };
    const sincronizacionId = await crearSincronizacion(pool, fabricante);

    const contadores = {
        unidadesRevisadas: 0, unidadesCambiadas: 0,
        nuevos: 0, modificados: 0, descontinuados: 0,
        sinCoincidencia: 0, incompletos: 0
    };

    try {
        progreso({ etapa: "universo", mensaje: "leyendo que productos publica hoy la fuente" });
        const universo = await adaptador.listarUniverso(contexto);

        progreso({ etapa: "unidades", mensaje: "listando de donde viene la informacion" });
        const unidades = await adaptador.listarUnidades(contexto);
        if (!Array.isArray(unidades) || unidades.length === 0) {
            throw new Error("la fuente no devolvio ninguna unidad de informacion");
        }

        progreso({ etapa: "revisando", mensaje: "viendo que cambio desde la ultima vez" });
        const { revisadas, cambiadas, conEstadoPrevio, cambiadasConEstadoPrevio } =
            await detectarUnidadesCambiadas(pool, adaptador, unidades,
                (hechas, cambios) => progreso({ etapa: "revisando", hechas, cambios }));

        contadores.unidadesRevisadas = revisadas;
        contadores.unidadesCambiadas = cambiadas.length;

        const fraccion = conEstadoPrevio > 0 ? cambiadasConEstadoPrevio / conEstadoPrevio : 0;
        if (fraccion > UMBRAL_REGENERACION_MASIVA && !opciones.confirmarRegeneracionMasiva) {
            const detalle = `la fuente regenero ${cambiadasConEstadoPrevio} de ${conEstadoPrevio} unidades `
                + `ya conocidas (${Math.round(fraccion * 100)}%). Puede ser una regeneracion masiva sin cambios `
                + `reales de precio. Confirma para procesarlas.`;
            await cerrarSincronizacion(pool, sincronizacionId, "esperando_confirmacion", contadores, detalle);
            return { sincronizacionId, estado: "esperando_confirmacion", contadores, detalle };
        }

        progreso({ etapa: "extrayendo", mensaje: `procesando ${cambiadas.length} unidades` });
        const { porProducto, enRevision, resueltosPorAyuda, incoherentes, estadosUnidad } = await extraerUnidades(
            pool, adaptador, cambiadas, contexto,
            (hechas, total) => progreso({ etapa: "extrayendo", hechas, total })
        );

        contadores.sinCoincidencia = enRevision.length;
        contadores.incoherentes = (incoherentes || []).length;
        for (const item of incoherentes || []) {
            await registrarCambio(pool, sincronizacionId, fabricante, {
                codigo: item.identidad, tipo: "incompleto",
                detalle: `precios retirados por incoherencia: ${item.problemas}`
            });
        }
        contadores.resueltosPorAyuda = resueltosPorAyuda;
        for (const item of enRevision) {
            await registrarCambio(pool, sincronizacionId, fabricante, {
                codigo: `unidad ${item.unidad}`, tipo: "sin_coincidencia", detalle: item.motivo
            });
        }

        const existentesResultado = await pool.query(
            `SELECT codigo, clave, ean, descripcion, marca, modulo, pagina, estado,
                    origen_lectura, layout, confianza, precios_sin_publicar, verificado_por_persona,
                    precio_mayoreo, precio_medio_mayoreo, precio_publico, precio_distribuidor
             FROM public.catalogo_fabricante_productos WHERE fabricante = $1`,
            [fabricante]
        );
        const existentes = new Map(existentesResultado.rows.map(f => [f.codigo, f]));

        // Enriquecimiento opcional de productos nuevos (descripcion, marca).
        const identidades = universo ? [...universo.keys()] : [...porProducto.keys()];
        const nuevos = identidades.filter(id => !existentes.has(id));
        const extras = new Map();

        if (typeof adaptador.datosDeProducto === "function") {
            let pedidas = 0;
            for (const identidad of nuevos) {
                if (pedidas >= MAX_ENRIQUECIMIENTOS_POR_CORRIDA) break;
                try {
                    const datos = await adaptador.datosDeProducto(identidad, contexto);
                    if (datos) extras.set(identidad, datos);
                } catch (error) {
                    // Sin enriquecer, el producto igual se da de alta.
                }
                pedidas++;
                progreso({ etapa: "enriqueciendo", hechas: pedidas, total: Math.min(nuevos.length, MAX_ENRIQUECIMIENTOS_POR_CORRIDA) });
            }
        }

        // ---- Aplicacion en una sola transaccion ----
        const client = await pool.connect();
        try {
            await client.query("BEGIN");

            for (const identidad of identidades) {
                const leidos = porProducto.get(identidad);
                const extra = extras.get(identidad);
                const existente = existentes.get(identidad);
                const info = universo?.get(identidad) || {};

                // Producto conocido cuya unidad no cambio: nada que
                // escribir, solo dejar constancia de que sigue vigente.
                if (!leidos && existente) {
                    await client.query(
                        `UPDATE public.catalogo_fabricante_productos SET visto_en = NOW()
                         WHERE fabricante = $1 AND codigo = $2`,
                        [fabricante, identidad]
                    );
                    continue;
                }

                const datos = {
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

                const cambios = await aplicarProducto(client, sincronizacionId, fabricante, identidad, datos, existente);
                for (const cambio of cambios) {
                    await registrarCambio(pool, sincronizacionId, fabricante, cambio);
                }
                if (cambios.some(c => c.tipo === "nuevo")) contadores.nuevos++;
                if (cambios.some(c => c.tipo === "modificado")) contadores.modificados++;

                if (!existente && !leidos) {
                    contadores.incompletos++;
                    await registrarCambio(pool, sincronizacionId, fabricante, {
                        codigo: identidad, tipo: "incompleto",
                        detalle: "alta sin precios: su unidad no cambio o no se pudo leer"
                    });
                }
            }

            // Descontinuados: solo se pueden deducir si la fuente sabe
            // decir su universo vigente. Si no lo sabe (universo === null),
            // no se marca ninguno -- nunca se inventan bajas.
            if (universo) {
                const paraDescontinuar = [...existentes.values()]
                    .filter(f => f.estado === "activo" && !universo.has(f.codigo));

                const activosPrevios = [...existentes.values()].filter(f => f.estado === "activo").length;
                const fraccionBaja = activosPrevios > 0 ? paraDescontinuar.length / activosPrevios : 0;

                if (activosPrevios >= MIN_ACTIVOS_PARA_SALVAGUARDA && fraccionBaja > UMBRAL_BAJA_MASIVA
                    && !opciones.confirmarBajaMasiva) {
                    throw new Error(
                        `la fuente dejo de listar ${paraDescontinuar.length} de ${activosPrevios} productos activos `
                        + `(${Math.round(fraccionBaja * 100)}%). Parece una lectura incompleta, no un cambio real de `
                        + `catalogo: no se aplico nada.`
                    );
                }

                for (const fila of paraDescontinuar) {
                    await respaldarFila(client, sincronizacionId, fabricante, fila);
                    await client.query(
                        `UPDATE public.catalogo_fabricante_productos
                         SET estado = 'descontinuado', actualizado_en = NOW()
                         WHERE fabricante = $1 AND codigo = $2`,
                        [fabricante, fila.codigo]
                    );
                    contadores.descontinuados++;
                    await registrarCambio(pool, sincronizacionId, fabricante, {
                        codigo: fila.codigo, tipo: "descontinuado",
                        detalle: "la fuente dejo de listarlo"
                    });
                }
            }

            // Las firmas de unidad se graban con la MISMA transaccion que
            // los productos: si algo falla, no queda ninguna unidad marcada
            // como procesada sin que sus precios se hayan guardado.
            for (const e of estadosUnidad) {
                await guardarEstadoUnidad(client, fabricante, e.unidad, e.estado, e.detalle, e.resultado);
            }

            await client.query("COMMIT");
        } catch (error) {
            await client.query("ROLLBACK");
            throw error;
        } finally {
            client.release();
        }

        // Aportar la identidad al Catalogo Maestro, ya con la transaccion
        // cerrada. Va aparte a proposito: si esto falla, la sincronizacion
        // de precios sigue siendo valida -- son dos cosas distintas y una
        // no debe tumbar a la otra. NUNCA se aporta precio, solo identidad.
        if (opciones.aportarAlMaestro !== false) {
            try {
                const { aportarAlMaestro } = require("./catalogo-maestro-fabricante");
                contadores.maestro = await aportarAlMaestro(pool, fabricante, opciones.maestro);
                progreso({ etapa: "maestro", ...contadores.maestro });
            } catch (error) {
                contadores.maestroError = error.message;
            }
        }

        await cerrarSincronizacion(pool, sincronizacionId, "completada", contadores);
        return { sincronizacionId, estado: "completada", contadores };
    } catch (error) {
        await cerrarSincronizacion(pool, sincronizacionId, "error", contadores, error.message);
        throw error;
    }
}

module.exports = {
    sincronizar,
    detectarUnidadesCambiadas,
    extraerUnidades,
    aplicarProducto,
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
