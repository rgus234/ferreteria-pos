// Adaptador de TRUPER para el sincronizador de catalogos de fabricante.
//
// Todo lo que sabe de TRUPER vive aqui; el nucleo
// (catalogo-fabricante-sync.js) no conoce modulos, JPG ni endpoints.
// Para agregar URREA basta escribir otro archivo con esta misma interfaz:
//
//   nombre, variantes, urlImagen(), listarModulos(), codigosDeModulos(),
//   cabecerasModulo(), descargarModulo(), datosDeProducto()
//
// Como funciona el catalogo de TRUPER (verificado en vivo 2026-09-01):
//   - El sitio publica cada "modulo" del catalogo como un JPG con la
//     tabla de precios RASTERIZADA. No hay precios en texto en ninguna
//     parte del sitio.
//   - modulo = numero de pagina + indice de dos digitos (29901 = pag 299,
//     modulo 01).
//   - Dos variantes de la misma maqueta, ambas publicas y sin login:
//       mx-pub -> columnas Mayoreo | 1/2 Mayoreo | Publico
//       mx-dis -> columna  Distribuidor
//     (El sitio de mx-dis se titula "Catalogo Frontera" pero es un
//     remanente de plantilla: su <h1> dice "Catalogo Nacional", las
//     imagenes viven en la misma seccion catalogo-mx/ y no existe ninguna
//     carpeta de frontera. Son precios nacionales de distribuidor.)
//   - Los ETag de mx-pub y mx-dis son INDEPENDIENTES para el mismo
//     modulo, por eso el estado se lleva por (modulo, variante).
//   - TRUPER no publica EAN en ninguna fuente oficial.

const BASE_CATALOGO = "https://www.truper.com/CatVigente";
const BASE_IMAGENES = "https://www.truper.com/GestorCatalogos/img/sections/catalogo-mx";

// Se identifica en vez de disfrazarse de navegador: si a TRUPER le
// molesta el trafico, que sepan quien es y puedan contactar.
const USER_AGENT = "NexoPOS-CatalogoSync/1.0 (+https://nexoposoficial.com; contacto: nexoposoficial@gmail.com)";

// Pausa entre peticiones. El catalogo completo son ~600 paginas y ~6000
// imagenes; sin freno esto seria indistinguible de un ataque.
const PAUSA_MS = 350;
// Tope duro por si el encadenado de paginas nunca cierra el ciclo.
const MAX_PAGINAS = 900;

const VARIANTES = {
    pub: {
        carpeta: "mx-pub",
        // Orden real de las columnas en la maqueta. Solo se usa como
        // respaldo: el extractor prefiere leer el encabezado de verdad,
        // para no guardar precios cruzados si TRUPER reordena.
        columnas: ["precio_mayoreo", "precio_medio_mayoreo", "precio_publico"]
    },
    dis: {
        carpeta: "mx-dis",
        columnas: ["precio_distribuidor"]
    }
};

function pausa(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// Turnero global de salida hacia TRUPER.
//
// Cuando la lectura pasa a ser concurrente, el freno de PAUSA_MS deja de
// servir: cada tarea espera SU pausa, pero entre todas multiplican las
// peticiones por el numero de tareas. Este turnero espacia las peticiones
// de TODO el proceso, corran una o veinte tareas.
//
// La decision de fondo: la carga se acelera usando los nucleos que estan
// ociosos -- el OCR es el 78% del tiempo y es CPU -- NO golpeando mas
// fuerte a un servidor ajeno. TRUPER ya devolvio un 503 hoy con el ritmo
// de una sola tarea.
let turnoLibreEn = 0;

async function esperarTurno(separacionMs) {
    const ahora = Date.now();
    // Se aparta el turno ANTES del await: si dos tareas leyeran el reloj a
    // la vez, las dos creerian que les toca ya y saldrian juntas.
    const miTurno = Math.max(ahora, turnoLibreEn);
    turnoLibreEn = miTurno + separacionMs;

    const espera = miTurno - ahora;
    if (espera > 0) await pausa(espera);
}

// Estados que significan "ahorita no, vuelve a intentar": el servidor esta
// saturado, reiniciando, o pidiendo que bajemos el ritmo. No son un no
// definitivo como un 404.
const ESTADOS_REINTENTABLES = new Set([429, 500, 502, 503, 504]);

async function pedir(url, opciones = {}) {
    const intentos = opciones.intentos ?? 3;
    let ultimoError = null;

    for (let intento = 1; intento <= intentos; intento++) {
        try {
            await esperarTurno(opciones.separacionMs ?? PAUSA_MS);

            const respuesta = await fetch(url, {
                method: opciones.method || "GET",
                headers: {
                    "User-Agent": USER_AGENT,
                    ...(opciones.headers || {})
                },
                body: opciones.body,
                signal: AbortSignal.timeout(opciones.timeoutMs ?? 30000)
            });

            // fetch NO lanza con un 503: devuelve la respuesta y ya. Sin
            // esto el reintento solo cubria fallos de red, y un hipo de
            // medio segundo del servidor de TRUPER tumbaba la corrida
            // entera. Paso de verdad: "ficha/fichas respondio 503" mato
            // una carga de horas, y el mismo endpoint respondia 200 un
            // minuto despues.
            if (ESTADOS_REINTENTABLES.has(respuesta.status) && intento < intentos) {
                // Si el servidor dice cuanto esperar, se le hace caso: nos
                // esta pidiendo que bajemos el ritmo y es su catalogo.
                const pedido = Number(respuesta.headers.get("retry-after"));
                const espera = Number.isFinite(pedido) && pedido > 0
                    ? Math.min(pedido, 30) * 1000
                    : 1000 * intento;
                ultimoError = new Error(`respondio ${respuesta.status}`);
                await pausa(espera);
                continue;
            }

            return respuesta;
        } catch (error) {
            ultimoError = error;
            // Espera creciente: 1s, 2s, 3s. Un fallo de red no debe
            // tumbar una corrida de miles de modulos.
            if (intento < intentos) await pausa(1000 * intento);
        }
    }

    throw new Error(`no se pudo consultar ${url}: ${ultimoError?.message || "error desconocido"}`);
}

function urlImagen(modulo, variante) {
    const definicion = VARIANTES[variante];
    if (!definicion) throw new Error(`variante desconocida: ${variante}`);
    return `${BASE_IMAGENES}/${definicion.carpeta}/${modulo}.jpg`;
}

// ---------------------------------------------------------------------
// Enumeracion de modulos
//
// No existe indice ni sitemap del catalogo. La forma repetible de
// enumerarlo es seguir el encadenado de paginas: cada pagina trae
// <a class="nextSig" href="./siguiente.html"> y declara sus modulos en
// atributos data-modulo. Se recorre hasta volver al punto de partida.
// ---------------------------------------------------------------------

function extraerModulosDePagina(html) {
    const modulos = [...html.matchAll(/data-modulo="(\d+)"/g)].map(m => m[1]);
    return [...new Set(modulos)];
}

function extraerSiguiente(html) {
    const match = html.match(/<a[^>]+href="\.\/([^"]+\.html)"[^>]*class="[^"]*nextSig[^"]*"/i)
        || html.match(/<a[^>]+class="[^"]*nextSig[^"]*"[^>]*href="\.\/([^"]+\.html)"/i);
    return match ? match[1] : null;
}

// El numero de pagina va al final del slug: ...-truper-299.html
function paginaDeSlug(slug) {
    const match = String(slug).match(/-(\d+)\.html$/);
    return match ? Number(match[1]) : null;
}

/**
 * Recorre el catalogo completo y devuelve todos los modulos.
 * @param {object} [opciones]
 * @param {string} [opciones.inicio] slug de arranque
 * @param {function} [opciones.onProgreso] callback(paginasVistas, modulosHallados)
 * @returns {Promise<Array<{modulo: string, pagina: number|null, slug: string}>>}
 */
async function listarModulos(opciones = {}) {
    const inicio = opciones.inicio || "truper-truper-17.html";
    const vistos = new Set();
    const resultado = [];

    let slug = inicio;
    let paginas = 0;

    while (slug && !vistos.has(slug) && paginas < MAX_PAGINAS) {
        vistos.add(slug);
        paginas++;

        const respuesta = await pedir(`${BASE_CATALOGO}/${slug}`);
        if (!respuesta.ok) {
            throw new Error(`pagina ${slug} respondio ${respuesta.status}`);
        }
        const html = await respuesta.text();
        const pagina = paginaDeSlug(slug);

        for (const modulo of extraerModulosDePagina(html)) {
            resultado.push({ modulo, pagina, slug });
        }

        if (typeof opciones.onProgreso === "function") {
            opciones.onProgreso(paginas, resultado.length);
        }

        slug = extraerSiguiente(html);
    }

    if (paginas >= MAX_PAGINAS) {
        throw new Error(`el recorrido supero ${MAX_PAGINAS} paginas sin cerrar el ciclo`);
    }

    return resultado;
}

// ---------------------------------------------------------------------
// Fuente en TEXTO de los codigos de cada modulo
//
// Esta es la pieza que hace confiable todo lo demas: dice, sin OCR, que
// codigos y claves tiene cada modulo. El extractor rechaza el modulo si
// lo que leyo de la imagen no concuerda con esto.
// ---------------------------------------------------------------------

/**
 * @param {string[]} modulos
 * @returns {Promise<Map<string, Array<{codigo: string, clave: string}>>>}
 */
async function codigosDeModulos(modulos) {
    const cuerpo = new URLSearchParams();
    for (const modulo of modulos) cuerpo.append("modulos[]", modulo);

    const respuesta = await pedir(`${BASE_CATALOGO}/ficha/fichas`, {
        method: "POST",
        headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            "X-Requested-With": "XMLHttpRequest"
        },
        body: cuerpo.toString()
    });

    if (!respuesta.ok) {
        throw new Error(`ficha/fichas respondio ${respuesta.status}`);
    }

    const datos = await respuesta.json();
    const mapa = new Map();

    for (const [modulo, html] of Object.entries(datos || {})) {
        const codigos = [...String(html).matchAll(
            /class=\\?"code\\?">([^<\\]+)<[\s\S]*?class=\\?"sku\\?">([^<\\]+)</g
        )].map(m => ({ codigo: m[1].trim(), clave: m[2].trim() }));

        mapa.set(modulo, codigos);
    }

    return mapa;
}

// ---------------------------------------------------------------------
// Descarga de imagenes
// ---------------------------------------------------------------------

/**
 * HEAD barato para saber si el modulo cambio, sin bajar la imagen.
 * @returns {Promise<{existe: boolean, etag: string, lastModified: string}>}
 */
async function cabecerasModulo(modulo, variante) {
    const respuesta = await pedir(urlImagen(modulo, variante), { method: "HEAD" });

    if (!respuesta.ok) {
        return { existe: false, etag: "", lastModified: "" };
    }

    return {
        existe: true,
        etag: respuesta.headers.get("etag") || "",
        lastModified: respuesta.headers.get("last-modified") || ""
    };
}

async function descargarModulo(modulo, variante) {
    const respuesta = await pedir(urlImagen(modulo, variante));

    if (!respuesta.ok) {
        throw new Error(`imagen ${modulo}/${variante} respondio ${respuesta.status}`);
    }

    // Sin pausa aqui: el espaciado hacia TRUPER lo lleva esperarTurno()
    // dentro de pedir(), y cuenta para todo el proceso. Repetirlo frenaria
    // de mas sin proteger nada.
    const buffer = Buffer.from(await respuesta.arrayBuffer());
    return buffer;
}

// ---------------------------------------------------------------------
// Descripcion y marca (texto limpio, sin OCR)
//
// producto/searching devuelve la descripcion oficial ("pn") y la clave.
// Se consulta solo para productos NUEVOS -- en una corrida normal casi
// nadie pasa por aqui.
// ---------------------------------------------------------------------

// La marca va al final de la descripcion oficial en mayusculas
// ("... , TRUPER PRO", "... HERMEX"). Se reconocen solo las marcas reales
// del catalogo; si no aparece ninguna, el campo queda vacio en vez de
// inventado.
const MARCAS = ["TRUPER PRO", "TRUPER EXPERT", "TRUPER", "PRETUL", "VOLTECK", "FOSET", "FIERO", "HERMEX", "KLINTEK", "LAIT"];

function marcaDeDescripcion(descripcion) {
    const texto = String(descripcion || "").toUpperCase();
    // Se prueban primero las mas largas para que "TRUPER PRO" gane sobre "TRUPER".
    for (const marca of MARCAS) {
        if (texto.includes(marca)) return marca;
    }
    return "";
}

/**
 * Datos en texto de un producto por su codigo.
 * @returns {Promise<{codigo: string, clave: string, descripcion: string, marca: string, modulo: string, esNuevo: boolean, reemplazos: string[]}|null>}
 */
async function datosDeProducto(codigo) {
    const cuerpo = new URLSearchParams({ word: String(codigo) });

    const respuesta = await pedir(`${BASE_CATALOGO}/producto/searching`, {
        method: "POST",
        headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            "X-Requested-With": "XMLHttpRequest"
        },
        body: cuerpo.toString()
    });

    if (!respuesta.ok) return null;

    const datos = await respuesta.json().catch(() => null);
    const lista = datos?.data || [];
    // El buscador es difuso: se exige coincidencia EXACTA de codigo para
    // no quedarse con un producto parecido.
    const exacto = lista.find(item => String(item.codigo) === String(codigo));

    if (!exacto) return null;

    return {
        codigo: String(exacto.codigo),
        clave: String(exacto.clave || ""),
        descripcion: String(exacto.pn || ""),
        marca: marcaDeDescripcion(exacto.pn),
        modulo: String(exacto.modulo || ""),
        esNuevo: exacto.is_new === "1" || exacto.is_new === 1,
        reemplazos: Array.isArray(exacto.replace) ? exacto.replace : []
    };
}

// ---------------------------------------------------------------------
// Implementacion del contrato comun
//
// Todo lo especifico de TRUPER termina aqui: el crawl de paginas, las dos
// variantes de precio, el OCR de la imagen y el respaldo con vision. El
// nucleo de sincronizacion no sabe nada de esto -- recibe unidades con
// una firma y filas normalizadas, igual que las recibiria de un CSV.
// ---------------------------------------------------------------------

const { extraerTablaDeModulo } = require("../catalogo-fabricante-ocr");

// Tope duro de llamadas a vision por corrida. La vision es el respaldo de
// los modulos que el OCR no pudo leer; con un tope el costo queda acotado
// por diseno aunque el fabricante cambie toda su maqueta.
const MAX_LLAMADAS_VISION_POR_CORRIDA = 300;

// El crawl del catalogo completo es caro (~600 paginas). Se hace una sola
// vez por corrida y se reusa entre listarUniverso() y listarUnidades().
async function modulosDeLaCorrida(ctx) {
    if (!ctx._modulos) {
        // ctx.modulos permite acotar la corrida a un subconjunto sin tocar
        // el codigo: sirve para probar contra modulos concretos y para
        // reprocesar una parte del catalogo sin recorrer las ~600 paginas.
        ctx._modulos = Array.isArray(ctx.modulos) && ctx.modulos.length > 0
            ? ctx.modulos
            : await listarModulos({
                onProgreso: (paginas, hallados) =>
                    ctx.onProgreso?.({ etapa: "universo", paginas, modulos: hallados })
            });
    }
    return ctx._modulos;
}

async function codigosDeLaCorrida(ctx) {
    if (ctx._codigos) return ctx._codigos;

    const modulos = await modulosDeLaCorrida(ctx);
    const porModulo = new Map();
    const universo = new Map();
    const paginaDe = new Map(modulos.map(m => [m.modulo, m.pagina]));
    const lista = modulos.map(m => m.modulo);

    // ficha/fichas acepta varios modulos por peticion: 6000 modulos en
    // lotes de 50 son 120 peticiones en vez de 6000.
    for (let i = 0; i < lista.length; i += 50) {
        const mapa = await codigosDeModulos(lista.slice(i, i + 50));
        for (const [modulo, entradas] of mapa.entries()) {
            porModulo.set(modulo, entradas.map(e => e.codigo));
            for (const entrada of entradas) {
                if (!entrada.codigo) continue;
                universo.set(entrada.codigo, {
                    clave: entrada.clave || "",
                    unidadId: modulo,
                    referencia: paginaDe.get(modulo) ?? null
                });
            }
        }
    }

    ctx._codigos = { porModulo, universo };
    return ctx._codigos;
}

const adaptador = {
    nombre: "TRUPER",
    formato: "imagen",
    // TRUPER no publica EAN en ninguna fuente oficial, asi que la
    // identidad es su codigo de fabricante.
    claveIdentidad: "codigo",
    nivelesPrecio: ["precio_mayoreo", "precio_medio_mayoreo", "precio_publico", "precio_distribuidor"],

    async listarUniverso(ctx) {
        const { universo } = await codigosDeLaCorrida(ctx);
        return universo;
    },

    // Una unidad = un (modulo, variante). Las dos variantes del mismo
    // modulo tienen ETag INDEPENDIENTE, por eso son unidades separadas.
    async listarUnidades(ctx) {
        const modulos = await modulosDeLaCorrida(ctx);
        const { porModulo } = await codigosDeLaCorrida(ctx);
        const variantes = ctx.variantes || Object.keys(VARIANTES);
        const unidades = [];
        let revisadas = 0;

        for (const { modulo, pagina } of modulos) {
            for (const variante of variantes) {
                let cabeceras;
                try {
                    cabeceras = await cabecerasModulo(modulo, variante);
                } catch (error) {
                    // Un fallo de red al mirar la cabecera no debe marcar la
                    // unidad como cambiada ni como intacta: se reintenta en
                    // la proxima corrida.
                    continue;
                }
                revisadas++;
                ctx.onProgreso?.({ etapa: "unidades", hechas: revisadas });
                if (!cabeceras.existe) continue;

                unidades.push({
                    id: modulo,
                    parte: variante,
                    firma: cabeceras.etag,
                    lastModified: cabeceras.lastModified,
                    referencia: pagina,
                    productosEsperados: (porModulo.get(modulo) || []).length
                });
            }
        }

        return unidades;
    },

    async extraerUnidad(unidad, ctx) {
        const { porModulo } = await codigosDeLaCorrida(ctx);
        const codigosEsperados = porModulo.get(unidad.id) || [];
        const variante = unidad.parte;

        // La vision solo se ofrece mientras queden llamadas del tope.
        ctx._llamadasVision = ctx._llamadasVision || 0;
        const puedeUsarVision = Boolean(ctx.anthropic) && ctx._llamadasVision < MAX_LLAMADAS_VISION_POR_CORRIDA;
        if (puedeUsarVision) ctx._llamadasVision++;

        const imagen = await descargarModulo(unidad.id, variante);
        const r = await extraerTablaDeModulo(imagen, {
            codigosEsperados,
            columnasForzadas: VARIANTES[variante]?.columnas,
            anthropic: puedeUsarVision ? ctx.anthropic : null
        });

        return {
            filas: r.filas.map(f => ({
                codigo: f.codigo,
                clave: f.clave,
                precios: f.precios,
                completa: f.completa,
                motivo: f.motivo
            })),
            confiable: r.confiable,
            origen: r.origen,
            layout: r.layout,
            confianza: r.nivelConfianza,
            firmaContenido: r.hash,
            // Que precios de esta variante no venian publicados.
            preciosSinPublicar: r.origen === "sin_precios_publicados"
                ? (VARIANTES[variante]?.columnas || [])
                : [],
            validacion: r.validacion,
            detalle: r.validacion?.motivo || ""
        };
    },

    async datosDeProducto(codigo) {
        return datosDeProducto(codigo);
    }
};

module.exports = {
    ...adaptador,
    // Piezas internas, expuestas para pruebas y para reuso
    variantes: VARIANTES,
    urlImagen,
    listarModulos,
    codigosDeModulos,
    cabecerasModulo,
    descargarModulo,
    // Se exporta para poder probar el reintento contra estados como 503:
    // un hipo del servidor no puede tumbar una carga de horas.
    pedir,
    extraerModulosDePagina,
    extraerSiguiente,
    paginaDeSlug,
    marcaDeDescripcion,
    BASE_CATALOGO,
    BASE_IMAGENES,
    USER_AGENT,
    MAX_LLAMADAS_VISION_POR_CORRIDA
};
