// Fase 1: convertir el catalogo de un proveedor en IDENTIDAD GLOBAL de
// producto, para que cualquier negocio reconozca lo que escanea sin haber
// cargado ningun catalogo.
//
// El proveedor se usa SOLO como fuente de reconciliacion. Lo unico que se
// toma de el es lo que permite unir EAN <-> codigo de fabricante <->
// producto, mas la identidad de fabrica (nombre, marca). NUNCA sus
// precios, que son su relacion comercial con el negocio que los cargo.
//
// Los precios de referencia NO se copian aqui: viven en
// catalogo_fabricante_productos, con su historial y su confianza, y se
// alcanzan desde el Maestro por el identificador de tipo 'fabricante'.
// Copiarlos crearia una segunda verdad que habria que mantener al dia.

const { textoLimpio } = require("./catalogo-fabricante-contrato");

// ---------------------------------------------------------------------
// Validacion de identidad
// ---------------------------------------------------------------------

/**
 * Digito verificador EAN-13 / EAN-8 / UPC-12. Es la prueba de que un
 * codigo de barras es real y no un numero cualquiera que alguien tecleo
 * en una celda. Sobre el catalogo de Diprofer lo pasan 15.758 de 15.758.
 */
function eanValido(codigo) {
    const s = String(codigo || "").trim();
    if (!/^[0-9]{8}$|^[0-9]{12,13}$/.test(s)) return false;

    const digitos = s.split("").map(Number);
    const verificador = digitos.pop();
    let suma = 0;
    // Se recorre de derecha a izquierda: el peso 3/1 alterna desde el
    // digito mas a la derecha, no desde el primero.
    digitos.reverse().forEach((n, i) => {
        suma += n * (i % 2 === 0 ? 3 : 1);
    });

    return ((10 - (suma % 10)) % 10) === verificador;
}

// El codigo de fabricante de TRUPER es numerico de 4 a 8 digitos. Un
// codigo con otra forma casi siempre es el codigo interno del proveedor,
// que no sirve como identidad global.
function pareceCodigoFabricante(codigo) {
    return /^[0-9]{4,8}$/.test(String(codigo || "").trim());
}

// Comparacion de textos tolerante a acentos, mayusculas y puntuacion:
// "Pinza multiuso 8'" y "PINZA MULTIUSO 8\"" son el mismo producto.
function normalizarTexto(texto) {
    return String(texto || "")
        .toLowerCase()
        .normalize("NFD")
        .replace(/[̀-ͯ]/g, "")
        .replace(/[^a-z0-9 ]/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}

function palabrasSignificativas(texto) {
    return new Set(normalizarTexto(texto).split(" ").filter(p => p.length > 3));
}

/**
 * Que tanto se parecen dos descripciones, de 0 a 1. Se usa para decidir
 * si dos filas con el mismo EAN son de verdad el mismo producto.
 */
function parecidoDescripcion(a, b) {
    const pa = palabrasSignificativas(a);
    const pb = palabrasSignificativas(b);
    if (pa.size === 0 || pb.size === 0) return 0;
    const comunes = [...pa].filter(p => pb.has(p)).length;
    return comunes / Math.min(pa.size, pb.size);
}

// Por debajo de esto, dos filas con el mismo EAN se consideran productos
// distintos y NO se fusionan.
const PARECIDO_MINIMO = 0.35;

// ---------------------------------------------------------------------
// Decision sobre una fila de catalogo
// ---------------------------------------------------------------------

/**
 * Decide que hacer con una fila de catalogo frente a lo ya reconciliado.
 * Funcion pura: no toca base de datos, se puede probar sola.
 *
 * @param {object} fila {ean, codigoFabricante, nombre, marca, fuente}
 * @param {object|null} existente producto maestro ya creado para ese EAN
 * @returns {{accion:'crear'|'enlazar'|'conflicto'|'descartar', tipo?:string, motivo?:string}}
 */
function decidirReconciliacion(fila, existente) {
    const ean = textoLimpio(fila.ean);
    const codigo = textoLimpio(fila.codigoFabricante);
    const nombre = textoLimpio(fila.nombre);

    if (!ean) {
        return { accion: "descartar", tipo: "sin_ean", motivo: "la fila no trae codigo de barras" };
    }
    if (!eanValido(ean)) {
        return { accion: "descartar", tipo: "ean_invalido", motivo: `el codigo de barras ${ean} no pasa el digito verificador` };
    }
    if (nombre.length < 3) {
        return { accion: "descartar", tipo: "sin_ean", motivo: "la fila no trae nombre de producto" };
    }

    if (!existente) {
        return { accion: "crear" };
    }

    // Mismo EAN ya reconciliado: hay que decidir si es el mismo producto.
    // El dueno pidio explicitamente NO fusionar ante conflicto.
    if (codigo && existente.codigo_fabricante && codigo !== existente.codigo_fabricante) {
        return {
            accion: "conflicto",
            tipo: "codigo_distinto",
            motivo: `el EAN ${ean} ya esta con el codigo de fabricante ${existente.codigo_fabricante} y esta fila trae ${codigo}`
        };
    }

    const marcaA = normalizarTexto(fila.marca);
    const marcaB = normalizarTexto(existente.marca);
    if (marcaA && marcaB && marcaA !== marcaB) {
        return {
            accion: "conflicto",
            tipo: "marca_distinta",
            motivo: `el EAN ${ean} figura como ${existente.marca} y esta fila dice ${fila.marca}`
        };
    }

    if (parecidoDescripcion(nombre, existente.nombre) < PARECIDO_MINIMO) {
        return {
            accion: "conflicto",
            tipo: "descripcion_distinta",
            motivo: `el EAN ${ean} figura como "${existente.nombre}" y esta fila dice "${nombre}"`
        };
    }

    // Mismo producto visto otra vez: no se duplica, solo se enlaza.
    return { accion: "enlazar" };
}

// ---------------------------------------------------------------------
// Corrida
// ---------------------------------------------------------------------

/**
 * Reconcilia las filas de catalogo dadas contra el Catalogo Maestro.
 *
 * @param {object} pool
 * @param {object[]} filas {ean, codigoFabricante, nombre, marca, fuente, fuenteFecha}
 * @param {object} opciones
 * @param {boolean} [opciones.aplicar=false] false = simulacion, no escribe nada
 * @param {string}  [opciones.fuente]
 * @returns {Promise<object>} reporte
 */
async function reconciliar(pool, filas, opciones = {}) {
    const aplicar = opciones.aplicar === true;
    const fuente = opciones.fuente || "desconocida";

    const reporte = {
        modo: aplicar ? "aplicada" : "simulacion",
        fuente,
        filasLeidas: filas.length,
        productosCreados: 0,
        identificadoresCreados: 0,
        coincidenciasSeguras: 0,
        conflictos: 0,
        sinEan: 0,
        eanInvalido: 0,
        duplicadosEvitados: 0,
        conCodigoFabricante: 0,
        sinCodigoFabricante: 0,
        ejemplosConflicto: [],
        reconciliacionId: null
    };

    // Estado en memoria de lo reconciliado en ESTA corrida, por EAN. En
    // simulacion es lo unico que hay; al aplicar se complementa con lo que
    // ya exista en la base.
    const porEan = new Map();

    let reconciliacionId = null;
    if (aplicar) {
        const r = await pool.query(
            `INSERT INTO public.catalogo_maestro_reconciliaciones (fuente, modo)
             VALUES ($1, 'aplicada') RETURNING id`,
            [fuente]
        );
        reconciliacionId = r.rows[0].id;
        reporte.reconciliacionId = reconciliacionId;
    }

    for (const fila of filas) {
        const ean = textoLimpio(fila.ean);
        const codigo = textoLimpio(fila.codigoFabricante);

        // Lo ya reconciliado para ese EAN: primero en esta corrida, y si
        // no, lo que ya viva en la base.
        let existente = porEan.get(ean) || null;
        if (!existente && aplicar && ean) {
            const previo = await pool.query(
                `SELECT m.id, m.nombre, m.marca,
                        (SELECT i2.valor FROM public.catalogo_maestro_identificadores i2
                          WHERE i2.producto_maestro_id = m.id AND i2.tipo = 'fabricante' LIMIT 1) AS codigo_fabricante
                 FROM public.catalogo_maestro_identificadores i
                 JOIN public.catalogo_maestro_productos m ON m.id = i.producto_maestro_id
                 WHERE i.tipo = 'ean' AND i.valor = $1 LIMIT 1`,
                [ean]
            );
            existente = previo.rows[0] || null;
        }

        const decision = decidirReconciliacion(fila, existente);

        if (decision.accion === "descartar") {
            if (decision.tipo === "ean_invalido") reporte.eanInvalido++;
            else reporte.sinEan++;
            if (aplicar) await guardarConflicto(pool, reconciliacionId, decision.tipo, fila, decision.motivo, null);
            continue;
        }

        if (decision.accion === "conflicto") {
            reporte.conflictos++;
            if (reporte.ejemplosConflicto.length < 15) {
                reporte.ejemplosConflicto.push({ ean, codigo, motivo: decision.motivo });
            }
            if (aplicar) {
                await guardarConflicto(pool, reconciliacionId, decision.tipo, fila, decision.motivo, existente?.id || null);
                // Marcar el producto ya existente para que una persona lo mire.
                if (existente?.id) {
                    await pool.query(
                        `UPDATE public.catalogo_maestro_productos
                         SET necesita_revision = true, revision_motivo = $2, updated_at = NOW()
                         WHERE id = $1`,
                        [existente.id, decision.motivo]
                    );
                }
            }
            continue;
        }

        if (decision.accion === "enlazar") {
            // Ya existe: no se crea otro producto. Esto es lo que impide
            // duplicar cuando dos catalogos traen el mismo articulo.
            reporte.duplicadosEvitados++;
            continue;
        }

        // --- crear ---
        reporte.productosCreados++;
        reporte.coincidenciasSeguras++;
        if (codigo && pareceCodigoFabricante(codigo)) reporte.conCodigoFabricante++;
        else reporte.sinCodigoFabricante++;

        let nuevoId = null;
        if (aplicar) {
            nuevoId = await crearProductoMaestro(pool, reconciliacionId, fila);
            if (!nuevoId) {
                // El producto ya existia con ese codigo -- normalmente
                // porque lo aporto antes el catalogo del fabricante, que
                // no conoce el EAN (TRUPER no lo publica).
                //
                // No se duplica, pero SI hay que darle los identificadores
                // que le faltan: sin el EAN ese producto no aparece al
                // escanear, que es justo para lo que existe todo esto.
                // (Bug real: la primera corrida dejo 16 productos del
                // catalogo TRUPER sin su codigo de barras.)
                reporte.productosCreados--;
                reporte.coincidenciasSeguras--;
                reporte.duplicadosEvitados++;

                const existentePorCodigo = await pool.query(
                    `SELECT id FROM public.catalogo_maestro_productos WHERE codigo = $1`,
                    [pareceCodigoFabricante(fila.codigoFabricante)
                        ? textoLimpio(fila.codigoFabricante)
                        : textoLimpio(fila.ean)]
                );
                const idExistente = existentePorCodigo.rows[0]?.id;

                if (idExistente) {
                    const agregados = await crearIdentificadores(pool, reconciliacionId, idExistente, fila);
                    reporte.identificadoresCreados += agregados;
                    if (agregados > 0) reporte.identificadoresCompletados = (reporte.identificadoresCompletados || 0) + 1;

                    // El EAN tambien se guarda en la fila, para poder verlo
                    // sin hacer join.
                    await pool.query(
                        `UPDATE public.catalogo_maestro_productos
                         SET ean = COALESCE(NULLIF(ean, ''), $2), updated_at = NOW()
                         WHERE id = $1`,
                        [idExistente, textoLimpio(fila.ean)]
                    );
                }
                continue;
            }
            reporte.identificadoresCreados += await crearIdentificadores(pool, reconciliacionId, nuevoId, fila);
        } else {
            // En simulacion se cuentan los identificadores que se crearian.
            reporte.identificadoresCreados += 1
                + (codigo && pareceCodigoFabricante(codigo) ? 1 : 0)
                + (textoLimpio(fila.clave) ? 1 : 0);
        }

        porEan.set(ean, {
            id: nuevoId,
            nombre: textoLimpio(fila.nombre),
            marca: textoLimpio(fila.marca),
            codigo_fabricante: pareceCodigoFabricante(codigo) ? codigo : ""
        });
    }

    if (aplicar) {
        await pool.query(
            `UPDATE public.catalogo_maestro_reconciliaciones
             SET productos_creados = $2, identificadores_creados = $3, coincidencias_seguras = $4,
                 conflictos = $5, sin_ean = $6, duplicados_evitados = $7, terminada_en = NOW()
             WHERE id = $1`,
            [
                reconciliacionId, reporte.productosCreados, reporte.identificadoresCreados,
                reporte.coincidenciasSeguras, reporte.conflictos,
                reporte.sinEan + reporte.eanInvalido, reporte.duplicadosEvitados
            ]
        );
    }

    return reporte;
}

async function guardarConflicto(pool, reconciliacionId, tipo, fila, detalle, productoId) {
    await pool.query(
        `INSERT INTO public.catalogo_maestro_conflictos
            (reconciliacion_id, tipo, ean, codigo_fabricante, fuente, detalle, producto_maestro_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [
            reconciliacionId, tipo, textoLimpio(fila.ean), textoLimpio(fila.codigoFabricante),
            textoLimpio(fila.fuente), detalle, productoId
        ]
    );
}

async function crearProductoMaestro(pool, reconciliacionId, fila) {
    // `codigo` sigue siendo la identidad historica del Maestro. Se usa el
    // codigo de fabricante cuando lo hay (es lo que comparten todos los
    // proveedores del mismo articulo) y el EAN si no.
    const codigoIdentidad = pareceCodigoFabricante(fila.codigoFabricante)
        ? textoLimpio(fila.codigoFabricante)
        : textoLimpio(fila.ean);

    const r = await pool.query(
        `INSERT INTO public.catalogo_maestro_productos
            (codigo, marca, nombre, clave, unidad, ean, fabricante, codigo_fabricante,
             origen, reconciliacion_id, fuente_identidad, fuente_fecha)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'fabricante',$9,$10,$11)
         ON CONFLICT (codigo) DO NOTHING
         RETURNING id`,
        [
            codigoIdentidad,
            textoLimpio(fila.marca),
            textoLimpio(fila.nombre),
            textoLimpio(fila.clave),
            textoLimpio(fila.unidad),
            textoLimpio(fila.ean),
            textoLimpio(fila.fabricante || fila.marca),
            textoLimpio(fila.codigoFabricante),
            reconciliacionId,
            textoLimpio(fila.fuente),
            fila.fuenteFecha || null
        ]
    );

    return r.rows[0]?.id || null;
}

async function crearIdentificadores(pool, reconciliacionId, productoId, fila) {
    const identificadores = [
        { tipo: "ean", valor: textoLimpio(fila.ean) },
        { tipo: "fabricante", valor: pareceCodigoFabricante(fila.codigoFabricante) ? textoLimpio(fila.codigoFabricante) : "" },
        { tipo: "clave", valor: textoLimpio(fila.clave) }
    ].filter(i => i.valor);

    let creados = 0;
    for (const identificador of identificadores) {
        // ON CONFLICT: si ese identificador ya apunta a otro producto, no
        // se toca. El indice unico es lo que garantiza "un EAN = un
        // producto maestro".
        const r = await pool.query(
            `INSERT INTO public.catalogo_maestro_identificadores
                (producto_maestro_id, tipo, valor, fuente, fuente_fecha, reconciliacion_id)
             VALUES ($1,$2,$3,$4,$5,$6)
             ON CONFLICT (tipo, valor) DO NOTHING
             RETURNING id`,
            [productoId, identificador.tipo, identificador.valor, textoLimpio(fila.fuente), fila.fuenteFecha || null, reconciliacionId]
        );
        if (r.rows.length > 0) creados++;
    }
    return creados;
}

// ---------------------------------------------------------------------
// Reversion
// ---------------------------------------------------------------------

/**
 * Deshace una corrida: borra lo que ESA corrida creo. Se niega si algun
 * negocio ya enlazo alguno de esos productos a su inventario -- borrarlos
 * dejaria productos apuntando a la nada.
 */
async function revertir(pool, reconciliacionId) {
    const enlazados = await pool.query(
        `SELECT COUNT(*)::int n FROM public.productos p
         JOIN public.catalogo_maestro_productos m ON m.id = p.catalogo_maestro_id
         WHERE m.reconciliacion_id = $1`,
        [reconciliacionId]
    );

    if (enlazados.rows[0].n > 0) {
        throw new Error(
            `no se puede revertir: ${enlazados.rows[0].n} productos de negocios ya estan enlazados a esta carga`
        );
    }

    const client = await pool.connect();
    try {
        await client.query("BEGIN");
        // Los identificadores caen solos por ON DELETE CASCADE.
        const borrados = await client.query(
            `DELETE FROM public.catalogo_maestro_productos WHERE reconciliacion_id = $1`,
            [reconciliacionId]
        );
        await client.query(
            `DELETE FROM public.catalogo_maestro_conflictos WHERE reconciliacion_id = $1`,
            [reconciliacionId]
        );
        await client.query(
            `UPDATE public.catalogo_maestro_reconciliaciones
             SET modo = 'revertida', revertida_en = NOW() WHERE id = $1`,
            [reconciliacionId]
        );
        await client.query("COMMIT");
        return { productosBorrados: borrados.rowCount };
    } catch (error) {
        await client.query("ROLLBACK");
        throw error;
    } finally {
        client.release();
    }
}

// ---------------------------------------------------------------------
// Consulta: identidad por codigo escaneado
//
// Es lo que hace posible que un negocio SIN catalogo propio reconozca lo
// que escanea. Busca por cualquier identificador, no solo por EAN.
// Los precios NO se copian: se leen del catalogo del fabricante por el
// identificador de tipo 'fabricante', de modo que siempre son los ultimos
// sincronizados.
// ---------------------------------------------------------------------
async function identidadPorCodigo(pool, codigo) {
    const limpio = textoLimpio(codigo);
    if (!limpio) return null;

    const r = await pool.query(
        `SELECT m.id, m.codigo, m.nombre, m.marca, m.clave, m.unidad, m.ean,
                m.fabricante, m.codigo_fabricante, m.necesita_revision,
                f.precio_mayoreo, f.precio_medio_mayoreo, f.precio_publico, f.precio_distribuidor,
                f.confianza AS confianza_precio, f.actualizado_en AS precio_actualizado_en
         FROM public.catalogo_maestro_identificadores i
         JOIN public.catalogo_maestro_productos m ON m.id = i.producto_maestro_id
         LEFT JOIN public.catalogo_fabricante_productos f
                ON f.codigo = m.codigo_fabricante
               AND f.fabricante = m.fabricante
               AND f.estado = 'activo'
         WHERE i.valor = $1
         LIMIT 1`,
        [limpio]
    );

    return r.rows[0] || null;
}

module.exports = {
    eanValido,
    pareceCodigoFabricante,
    parecidoDescripcion,
    normalizarTexto,
    decidirReconciliacion,
    reconciliar,
    revertir,
    identidadPorCodigo,
    PARECIDO_MINIMO
};
