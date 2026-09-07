// Rutas del Catalogo Nexo de fabricante (TRUPER y los que sigan).
//
// Dos superficies distintas a proposito:
//   /admin/api/catalogo-fabricante/*  -> sincronizar y ver reportes.
//        Va bajo /admin/api porque el catalogo es GLOBAL (un precio de
//        lista de TRUPER es el mismo para todos los negocios) y porque
//        una corrida cuesta miles de peticiones al fabricante. server.js
//        ya monta `app.use("/admin/api", validarAdminKey)` antes de
//        cargar este modulo, asi que estas rutas quedan protegidas.
//   /catalogo-fabricante/*            -> solo lectura para el POS.
//
// Este modulo NUNCA escribe en productos ni en catalogo_productos: el
// catalogo del fabricante es referencia comercial, no el costo de compra
// del negocio ni su precio de venta.

const { responderError } = require("./error-utils");
const { config } = require("./config");
const { sincronizar } = require("./catalogo-fabricante-sync");

// Registro de fuentes. Agregar un fabricante es agregar un renglon aqui
// y un archivo en fabricantes/: el nucleo no cambia. Los de catalogo web
// traen su propio modulo; los que reparten lista de precios en archivo se
// arman con el adaptador generico, declarando solo sus columnas.
const { crearAdaptadorArchivo } = require("./fabricantes/lista-precios-archivo");

const ADAPTADORES = {
    TRUPER: () => require("./fabricantes/truper")
};

// Fuentes de archivo configuradas por el dueno. Se guardan en la misma
// tabla y pasan por el mismo diff, respaldo y reporte que TRUPER.
// (El parametro se llama `definicion` y no `config` a proposito: `config`
// ya es el modulo de configuracion importado arriba.)
function registrarFuenteArchivo(nombre, definicion) {
    ADAPTADORES[String(nombre).toUpperCase()] = () => crearAdaptadorArchivo({ nombre, ...definicion });
}

function obtenerAdaptador(nombre) {
    const clave = String(nombre || "").toUpperCase();
    const cargar = ADAPTADORES[clave];
    if (!cargar) {
        const error = new Error(`Fabricante no soportado: ${nombre}`);
        error.httpStatus = 404;
        throw error;
    }
    return cargar();
}

// Una sola corrida a la vez en todo el proceso: son miles de peticiones
// al sitio del fabricante y dos corridas simultaneas lo martillarian.
let corridaEnCurso = null;

function lanzarCorrida(pool, adaptador, opciones) {
    if (corridaEnCurso) {
        const error = new Error("Ya hay una sincronizacion en curso");
        error.httpStatus = 409;
        throw error;
    }

    const estado = {
        fabricante: adaptador.nombre,
        etapa: "iniciando",
        detalle: {},
        iniciada: new Date().toISOString(),
        sincronizacionId: null
    };
    corridaEnCurso = estado;

    // El cliente de vision se pasa en el CONTEXTO, no lo crea el nucleo:
    // solo las fuentes que leen imagenes lo necesitan. Un adaptador de CSV
    // lo ignora por completo.
    const contexto = { ...(opciones.contexto || {}) };
    if (adaptador.formato === "imagen" && config.anthropicApiKey) {
        const Anthropic = require("@anthropic-ai/sdk");
        contexto.anthropic = new Anthropic({ apiKey: config.anthropicApiKey });
    }

    // No se espera: la corrida completa tarda horas. El progreso vive en
    // memoria y el resultado queda en la base.
    sincronizar(pool, adaptador, {
        ...opciones,
        contexto,
        onProgreso: info => {
            estado.etapa = info.etapa || estado.etapa;
            estado.detalle = info;
        }
    })
        .then(resultado => {
            estado.sincronizacionId = resultado.sincronizacionId;
            estado.etapa = resultado.estado;
            console.log(`[catalogo-fabricante] ${adaptador.nombre}: ${resultado.estado}`, resultado.contadores);
        })
        .catch(error => {
            estado.etapa = "error";
            estado.error = error.message;
            console.log(`[catalogo-fabricante] ${adaptador.nombre} fallo:`, error.message);
        })
        .finally(() => {
            corridaEnCurso = null;
        });

    return estado;
}

module.exports = (app, pool, requerirAccesoNegocio) => {
    // -----------------------------------------------------------------
    // Admin: sincronizacion y reportes
    // -----------------------------------------------------------------

    app.post("/admin/api/catalogo-fabricante/:fabricante/sincronizar", async (req, res) => {
        try {
            const adaptador = obtenerAdaptador(req.params.fabricante);
            const estado = lanzarCorrida(pool, adaptador, {
                confirmarRegeneracionMasiva: req.body?.confirmarRegeneracionMasiva === true,
                contexto: Array.isArray(req.body?.variantes) ? { variantes: req.body.variantes } : undefined
            });

            res.json({
                ok: true,
                mensaje: `Sincronizacion de ${adaptador.nombre} iniciada`,
                estado
            });
        } catch (error) {
            responderError(res, error, "No se pudo iniciar la sincronizacion");
        }
    });

    // Progreso en vivo de la corrida que esta corriendo ahora.
    app.get("/admin/api/catalogo-fabricante/en-curso", (_req, res) => {
        res.json({ ok: true, corrida: corridaEnCurso });
    });

    // Resumen de todas las fuentes para la pantalla principal. Una fila
    // por fabricante con lo que le importa al dueno: cuando se sincronizo,
    // cuantos productos hay y que necesita su atencion.
    app.get("/admin/api/catalogo-fabricante/resumen", async (_req, res) => {
        try {
            const fuentes = Object.keys(ADAPTADORES);
            const resumen = [];

            for (const clave of fuentes) {
                let adaptador;
                try {
                    adaptador = ADAPTADORES[clave]();
                } catch (error) {
                    continue;
                }
                const nombre = adaptador.nombre;

                const productos = await pool.query(
                    `SELECT COUNT(*) FILTER (WHERE estado = 'activo')::int AS activos,
                            COUNT(*) FILTER (WHERE estado = 'descontinuado')::int AS descontinuados,
                            COUNT(*) FILTER (WHERE estado = 'activo' AND confianza = 'baja')::int AS confianza_baja,
                            COUNT(*) FILTER (WHERE estado = 'activo' AND catalogo_maestro_id IS NOT NULL)::int AS en_maestro,
                            MAX(actualizado_en) AS ultimo_cambio
                     FROM public.catalogo_fabricante_productos WHERE fabricante = $1`,
                    [nombre]
                );

                const ultima = await pool.query(
                    `SELECT id, estado, iniciada_en, terminada_en, detalle,
                            productos_nuevos, productos_modificados, productos_descontinuados
                     FROM public.catalogo_fabricante_sincronizaciones
                     WHERE fabricante = $1 ORDER BY iniciada_en DESC LIMIT 1`,
                    [nombre]
                );

                const revision = await pool.query(
                    `SELECT COUNT(*)::int AS unidades,
                            COALESCE(SUM(productos_afectados), 0)::int AS productos
                     FROM public.catalogo_fabricante_modulos
                     WHERE fabricante = $1 AND estado <> 'ok'`,
                    [nombre]
                );

                resumen.push({
                    fabricante: nombre,
                    formato: adaptador.formato,
                    productos: productos.rows[0],
                    ultimaSincronizacion: ultima.rows[0] || null,
                    revision: revision.rows[0]
                });
            }

            res.json({ ok: true, fuentes: resumen, enCurso: corridaEnCurso });
        } catch (error) {
            responderError(res, error, "No se pudo leer el resumen de catalogos");
        }
    });

    app.get("/admin/api/catalogo-fabricante/:fabricante/sincronizaciones", async (req, res) => {
        try {
            const adaptador = obtenerAdaptador(req.params.fabricante);
            const resultado = await pool.query(
                `SELECT * FROM public.catalogo_fabricante_sincronizaciones
                 WHERE fabricante = $1 ORDER BY iniciada_en DESC LIMIT 50`,
                [adaptador.nombre]
            );
            res.json({ ok: true, sincronizaciones: resultado.rows });
        } catch (error) {
            responderError(res, error, "No se pudo leer el historial");
        }
    });

    // Reporte de cambios: lo que pidio el dueno -- nuevos, modificados,
    // descontinuados, sin coincidencia e incompletos, con el "de -> a" de
    // cada precio.
    app.get("/admin/api/catalogo-fabricante/sincronizaciones/:id/reporte", async (req, res) => {
        try {
            const id = Number(req.params.id);
            if (!Number.isInteger(id)) {
                return res.status(400).json({ ok: false, error: "id invalido" });
            }

            const corrida = await pool.query(
                `SELECT * FROM public.catalogo_fabricante_sincronizaciones WHERE id = $1`,
                [id]
            );
            if (corrida.rows.length === 0) {
                return res.status(404).json({ ok: false, error: "Sincronizacion no encontrada" });
            }

            // Se trae el nombre y la trazabilidad junto al cambio: quien
            // revisa necesita ver "Martillo 16 oz" y de donde salio ese
            // precio, no un codigo suelto.
            const cambios = await pool.query(
                `SELECT c.codigo, c.tipo, c.campo, c.valor_anterior, c.valor_nuevo, c.detalle,
                        p.descripcion, p.marca, p.clave,
                        p.origen_lectura, p.confianza, p.verificado_por_persona
                 FROM public.catalogo_fabricante_cambios c
                 LEFT JOIN public.catalogo_fabricante_productos p
                        ON p.fabricante = c.fabricante AND p.codigo = c.codigo
                 WHERE c.sincronizacion_id = $1
                 ORDER BY c.tipo, c.codigo`,
                [id]
            );

            // Agrupado por producto: un solo bloque por codigo con todos
            // sus precios cambiados, como el ejemplo que dio el dueno.
            const porProducto = new Map();
            for (const fila of cambios.rows) {
                if (!porProducto.has(fila.codigo)) {
                    porProducto.set(fila.codigo, {
                        codigo: fila.codigo,
                        tipo: fila.tipo,
                        nombre: fila.descripcion || "",
                        marca: fila.marca || "",
                        clave: fila.clave || "",
                        origenLectura: fila.origen_lectura || "",
                        confianza: fila.confianza || "",
                        verificado: Boolean(fila.verificado_por_persona),
                        campos: [],
                        detalle: fila.detalle
                    });
                }
                if (!fila.campo) continue;

                // La variacion se calcula aqui y no en el navegador: es el
                // dato con el que se decide si un cambio de precio es
                // normal o merece una mirada.
                const antes = Number(String(fila.valor_anterior).replace(/[$,]/g, ""));
                const ahora = Number(String(fila.valor_nuevo).replace(/[$,]/g, ""));
                const variacion = Number.isFinite(antes) && Number.isFinite(ahora) && antes > 0
                    ? Math.round(((ahora - antes) / antes) * 1000) / 10
                    : null;

                porProducto.get(fila.codigo).campos.push({
                    campo: fila.campo,
                    de: fila.valor_anterior,
                    a: fila.valor_nuevo,
                    variacion
                });
            }

            const productos = [...porProducto.values()];
            // Primero lo que mas subio: es lo que el dueno quiere ver.
            productos.sort((a, b) => {
                const maxA = Math.max(0, ...a.campos.map(c => Math.abs(c.variacion ?? 0)));
                const maxB = Math.max(0, ...b.campos.map(c => Math.abs(c.variacion ?? 0)));
                return maxB - maxA;
            });

            res.json({ ok: true, sincronizacion: corrida.rows[0], productos });
        } catch (error) {
            responderError(res, error, "No se pudo leer el reporte");
        }
    });

    // Reporte de confianza: de donde salio cada precio guardado. Es lo que
    // permite distinguir "procesado" de "verificado como correcto".
    app.get("/admin/api/catalogo-fabricante/:fabricante/confianza", async (req, res) => {
        try {
            const adaptador = obtenerAdaptador(req.params.fabricante);

            const resumen = await pool.query(
                `SELECT COALESCE(NULLIF(confianza, ''), 'sin_dato') AS confianza,
                        COALESCE(NULLIF(origen_lectura, ''), 'sin_dato') AS origen_lectura,
                        COALESCE(NULLIF(layout, ''), 'sin_dato') AS layout,
                        COUNT(*)::int AS productos,
                        COUNT(*) FILTER (WHERE verificado_por_persona)::int AS verificados
                 FROM public.catalogo_fabricante_productos
                 WHERE fabricante = $1 AND estado <> 'descontinuado'
                 GROUP BY 1, 2, 3
                 ORDER BY productos DESC`,
                [adaptador.nombre]
            );

            // Cuantos productos tienen cada precio vacio, separando el
            // "no publicado por el fabricante" del "no lo pudimos leer".
            const huecos = await pool.query(
                `SELECT
                    COUNT(*)::int AS total,
                    COUNT(*) FILTER (WHERE precio_mayoreo IS NULL)::int AS sin_mayoreo,
                    COUNT(*) FILTER (WHERE precio_medio_mayoreo IS NULL)::int AS sin_medio_mayoreo,
                    COUNT(*) FILTER (WHERE precio_publico IS NULL)::int AS sin_publico,
                    COUNT(*) FILTER (WHERE precio_distribuidor IS NULL)::int AS sin_distribuidor,
                    COUNT(*) FILTER (WHERE precios_sin_publicar <> '')::int AS con_precio_no_publicado
                 FROM public.catalogo_fabricante_productos
                 WHERE fabricante = $1 AND estado <> 'descontinuado'`,
                [adaptador.nombre]
            );

            res.json({ ok: true, porConfianza: resumen.rows, precios: huecos.rows[0] });
        } catch (error) {
            responderError(res, error, "No se pudo leer el reporte de confianza");
        }
    });

    // Detalle por producto, filtrable por confianza u origen: para poder
    // auditar exactamente que precios vinieron de donde.
    app.get("/admin/api/catalogo-fabricante/:fabricante/confianza/productos", async (req, res) => {
        try {
            const adaptador = obtenerAdaptador(req.params.fabricante);
            const filtros = ["fabricante = $1", "estado <> 'descontinuado'"];
            const valores = [adaptador.nombre];

            for (const campo of ["confianza", "origen_lectura", "layout"]) {
                if (!req.query[campo]) continue;
                valores.push(String(req.query[campo]));
                filtros.push(`${campo} = $${valores.length}`);
            }

            valores.push(Math.min(Number(req.query.limite) || 200, 1000));
            const resultado = await pool.query(
                `SELECT codigo, clave, descripcion, marca, modulo, pagina,
                        precio_mayoreo, precio_medio_mayoreo, precio_publico, precio_distribuidor,
                        precios_sin_publicar, origen_lectura, layout, confianza,
                        verificado_por_persona, actualizado_en
                 FROM public.catalogo_fabricante_productos
                 WHERE ${filtros.join(" AND ")}
                 ORDER BY confianza DESC, codigo
                 LIMIT $${valores.length}`,
                valores
            );
            res.json({ ok: true, productos: resultado.rows });
        } catch (error) {
            responderError(res, error, "No se pudo leer el detalle de confianza");
        }
    });

    // Cola de revision manual, agrupada por el tipo de problema -- que es
    // lo que cambia el trabajo de quien revisa: "estructura ambigua" pide
    // mirar la imagen; "precios incompletos" pide confirmar numeros.
    app.get("/admin/api/catalogo-fabricante/:fabricante/revision", async (req, res) => {
        try {
            const adaptador = obtenerAdaptador(req.params.fabricante);

            const resumen = await pool.query(
                `SELECT motivo_revision,
                        COUNT(*)::int AS modulos,
                        COALESCE(SUM(productos_afectados), 0)::int AS productos
                 FROM public.catalogo_fabricante_modulos
                 WHERE fabricante = $1 AND estado <> 'ok'
                 GROUP BY motivo_revision`,
                [adaptador.nombre]
            );

            const filtros = ["fabricante = $1", "estado <> 'ok'"];
            const valores = [adaptador.nombre];
            if (req.query.motivo) {
                valores.push(String(req.query.motivo));
                filtros.push(`motivo_revision = $${valores.length}`);
            }

            const modulos = await pool.query(
                `SELECT modulo, variante, estado, motivo_revision, layout, detalle,
                        productos_afectados, extraido_en
                 FROM public.catalogo_fabricante_modulos
                 WHERE ${filtros.join(" AND ")}
                 ORDER BY productos_afectados DESC, extraido_en DESC NULLS LAST
                 LIMIT 500`,
                valores
            );

            const porMotivo = Object.fromEntries(
                resumen.rows.map(f => [f.motivo_revision || "sin_clasificar", f])
            );

            res.json({
                ok: true,
                total: {
                    modulos: resumen.rows.reduce((n, f) => n + f.modulos, 0),
                    productos: resumen.rows.reduce((n, f) => n + f.productos, 0)
                },
                estructuraAmbigua: porMotivo.estructura_ambigua || { modulos: 0, productos: 0 },
                preciosIncompletos: porMotivo.precios_incompletos || { modulos: 0, productos: 0 },
                modulos: modulos.rows
            });
        } catch (error) {
            responderError(res, error, "No se pudo leer la lista de revision");
        }
    });

    // Estado del aporte al Catalogo Maestro: cuanta identidad de este
    // fabricante ya llego al catalogo global que ven todos los negocios.
    app.get("/admin/api/catalogo-fabricante/:fabricante/maestro", async (req, res) => {
        try {
            const adaptador = obtenerAdaptador(req.params.fabricante);

            const resumen = await pool.query(
                `SELECT COUNT(*)::int AS activos,
                        COUNT(*) FILTER (WHERE catalogo_maestro_id IS NOT NULL)::int AS en_maestro,
                        COUNT(*) FILTER (WHERE catalogo_maestro_id IS NULL AND maestro_detalle <> '')::int AS omitidos,
                        COUNT(*) FILTER (WHERE catalogo_maestro_id IS NULL AND maestro_detalle = '')::int AS pendientes
                 FROM public.catalogo_fabricante_productos
                 WHERE fabricante = $1 AND estado = 'activo'`,
                [adaptador.nombre]
            );

            // Los omitidos agrupados por motivo: casi siempre son productos
            // sin nombre, o codigos que ya pertenecen a otro fabricante.
            const motivos = await pool.query(
                `SELECT maestro_detalle AS motivo, COUNT(*)::int AS productos
                 FROM public.catalogo_fabricante_productos
                 WHERE fabricante = $1 AND estado = 'activo'
                   AND catalogo_maestro_id IS NULL AND maestro_detalle <> ''
                 GROUP BY maestro_detalle ORDER BY productos DESC LIMIT 20`,
                [adaptador.nombre]
            );

            res.json({ ok: true, resumen: resumen.rows[0], omitidosPorMotivo: motivos.rows });
        } catch (error) {
            responderError(res, error, "No se pudo leer el estado del Catalogo Maestro");
        }
    });

    // Aportar al Maestro sin volver a sincronizar precios: util despues de
    // corregir productos a mano o para procesar lo que quedo pendiente.
    app.post("/admin/api/catalogo-fabricante/:fabricante/maestro/aportar", async (req, res) => {
        try {
            const adaptador = obtenerAdaptador(req.params.fabricante);
            const { aportarAlMaestro } = require("./catalogo-maestro-fabricante");
            const resumen = await aportarAlMaestro(pool, adaptador.nombre, {
                limite: req.body?.limite,
                confianzas: Array.isArray(req.body?.confianzas) ? req.body.confianzas : undefined
            });
            res.json({ ok: true, resumen });
        } catch (error) {
            responderError(res, error, "No se pudo aportar al Catalogo Maestro");
        }
    });

    // Marcar un producto como verificado por una persona. A partir de ahi
    // la sincronizacion deja de tocar su confianza: la revision humana
    // manda sobre lo que diga el extractor.
    app.post("/admin/api/catalogo-fabricante/:fabricante/productos/:codigo/verificar", async (req, res) => {
        try {
            const adaptador = obtenerAdaptador(req.params.fabricante);
            const resultado = await pool.query(
                `UPDATE public.catalogo_fabricante_productos
                 SET verificado_por_persona = true,
                     verificado_en = NOW(),
                     confianza = 'alta',
                     origen_lectura = 'manual'
                 WHERE fabricante = $1 AND codigo = $2
                 RETURNING codigo`,
                [adaptador.nombre, String(req.params.codigo)]
            );

            if (resultado.rows.length === 0) {
                return res.status(404).json({ ok: false, error: "Producto no encontrado" });
            }
            res.json({ ok: true, codigo: resultado.rows[0].codigo });
        } catch (error) {
            responderError(res, error, "No se pudo marcar como verificado");
        }
    });

    // -----------------------------------------------------------------
    // POS: consulta del catalogo (solo lectura)
    // -----------------------------------------------------------------

    app.get("/catalogo-fabricante/:fabricante/productos", requerirAccesoNegocio, async (req, res) => {
        try {
            const adaptador = obtenerAdaptador(req.params.fabricante);
            const busqueda = String(req.query.q || "").trim();
            const limite = Math.min(Number(req.query.limite) || 50, 200);

            const filtros = ["fabricante = $1"];
            const valores = [adaptador.nombre];

            if (busqueda) {
                valores.push(`%${busqueda}%`, busqueda);
                filtros.push(`(codigo = $${valores.length} OR clave ILIKE $${valores.length - 1} OR descripcion ILIKE $${valores.length - 1} OR ean = $${valores.length})`);
            }
            if (req.query.estado) {
                valores.push(String(req.query.estado));
                filtros.push(`estado = $${valores.length}`);
            }

            valores.push(limite);
            const resultado = await pool.query(
                `SELECT codigo, clave, ean, descripcion, marca,
                        precio_mayoreo, precio_medio_mayoreo, precio_publico, precio_distribuidor,
                        estado, actualizado_en
                 FROM public.catalogo_fabricante_productos
                 WHERE ${filtros.join(" AND ")}
                 ORDER BY codigo LIMIT $${valores.length}`,
                valores
            );

            res.json({ ok: true, productos: resultado.rows });
        } catch (error) {
            responderError(res, error, "No se pudo consultar el catalogo");
        }
    });

    // Comparativa contra lo que el negocio ya tiene: muestra el precio de
    // lista del fabricante junto al precio de venta propio, SIN tocarlo.
    // Es exactamente la separacion que pidio el dueno: informar, no aplicar.
    app.get("/catalogo-fabricante/:fabricante/comparar", requerirAccesoNegocio, async (req, res) => {
        try {
            const adaptador = obtenerAdaptador(req.params.fabricante);
            const negocioId = req.negocioDispositivo?.negocio_id ?? req.negocioAutenticado?.negocio_id;

            if (!negocioId) {
                return res.status(401).json({ ok: false, error: "Este equipo no esta vinculado a ningun negocio" });
            }

            // Los precios del fabricante (lista) van al lado de los del
            // negocio (los suyos, que salen de su costo real). Se muestran
            // juntos para poder decidir; ninguna consulta de este archivo
            // escribe en productos.
            const resultado = await pool.query(
                `SELECT cf.codigo, cf.clave, cf.descripcion,
                        cf.precio_mayoreo       AS truper_mayoreo,
                        cf.precio_medio_mayoreo AS truper_medio_mayoreo,
                        cf.precio_publico       AS truper_publico,
                        cf.precio_distribuidor  AS truper_distribuidor,
                        cf.actualizado_en,
                        p.id     AS producto_id,
                        p.nombre AS producto_nombre,
                        p.precio AS mi_precio,
                        p.precio_mayoreo      AS mi_mayoreo,
                        p.precio_publico      AS mi_publico,
                        p.precio_distribuidor AS mi_distribuidor
                 FROM public.catalogo_fabricante_productos cf
                 JOIN public.productos p
                   ON p.negocio_id = $2
                  AND (p.codigo = cf.codigo OR (cf.ean <> '' AND p.codigo = cf.ean))
                 WHERE cf.fabricante = $1 AND cf.estado = 'activo'
                 ORDER BY cf.codigo LIMIT 500`,
                [adaptador.nombre, negocioId]
            );

            res.json({ ok: true, comparacion: resultado.rows });
        } catch (error) {
            responderError(res, error, "No se pudo comparar el catalogo");
        }
    });
};

// Se expone para dar de alta fuentes de archivo sin tocar este modulo.
module.exports.registrarFuenteArchivo = registrarFuenteArchivo;
module.exports.fuentesDisponibles = () => Object.keys(ADAPTADORES);
