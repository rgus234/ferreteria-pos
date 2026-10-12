// Carga por LOTES de identidad en el Catalogo Maestro.
//
// El motor fila por fila (catalogo-maestro-reconciliacion.js) hace ~3
// consultas por producto. Contra una base remota eso son ~2.5 filas por
// segundo: unas 90 minutos para 14 mil productos. Aqui se hace lo mismo con
// 2 consultas por lote de cientos de filas.
//
// SOLO es seguro para fuentes cuyas filas ya vienen deduplicadas por EAN y ya
// filtradas contra lo que el Maestro conoce (como Open Food Facts), porque no
// evalua conflictos: un EAN que ya exista se OMITE (no se pisa, no se
// fusiona), igual que "duplicado evitado" en el motor. Mismas garantias:
//   - solo identidad (nunca precio, costo ni imagen);
//   - un EAN = un producto (indice unico de identificadores);
//   - la corrida queda registrada y se revierte con revertir() del motor.

const LOTE = 500;

/**
 * @param {object} pool
 * @param {object[]} filas {ean, nombre, marca, fabricante, presentacion,
 *        categoriaNexoId, fuente, fuenteFecha, origen}
 * @param {object} opciones {fuente}
 * @returns {Promise<{reconciliacionId:number, productosCreados:number, identificadoresCreados:number, duplicadosEvitados:number}>}
 */
async function cargarMasivo(pool, filas, opciones = {}) {
    const fuente = opciones.fuente || "desconocida";
    const alAvanzar = opciones.alAvanzar || (() => {});
    const client = await pool.connect();

    try {
        await client.query("BEGIN");

        const corrida = await client.query(
            `INSERT INTO public.catalogo_maestro_reconciliaciones (fuente, modo)
             VALUES ($1, 'aplicada') RETURNING id`,
            [fuente]
        );
        const reconciliacionId = corrida.rows[0].id;

        let productosCreados = 0;
        let identificadoresCreados = 0;

        for (let i = 0; i < filas.length; i += LOTE) {
            const lote = filas.slice(i, i + LOTE);
            const col = campo => lote.map(f => f[campo] ?? null);

            // `codigo` es la identidad historica del Maestro; sin codigo de
            // fabricante es el propio EAN.
            const productos = await client.query(
                `INSERT INTO public.catalogo_maestro_productos
                    (codigo, marca, nombre, presentacion, categoria_nexo_id, ean, fabricante,
                     origen, reconciliacion_id, fuente_identidad, fuente_fecha)
                 SELECT t.ean, COALESCE(t.marca, ''), t.nombre, COALESCE(t.presentacion, ''), t.categoria_nexo_id,
                        t.ean, COALESCE(t.fabricante, ''), t.origen, $1, $10::text, t.fuente_fecha
                 FROM unnest($2::text[], $3::text[], $4::text[], $5::text[], $6::int[], $7::text[], $8::text[], $9::timestamptz[])
                      AS t(ean, nombre, marca, presentacion, categoria_nexo_id, fabricante, origen, fuente_fecha)
                 ON CONFLICT (codigo) DO NOTHING
                 RETURNING id, codigo`,
                [
                    reconciliacionId,
                    col("ean"), col("nombre"), col("marca"), col("presentacion"),
                    col("categoriaNexoId"), col("fabricante"), col("origen"), col("fuenteFecha"),
                    fuente
                ]
            );

            productosCreados += productos.rowCount;

            if (productos.rowCount > 0) {
                const ids = productos.rows.map(p => p.id);
                const eans = productos.rows.map(p => p.codigo);

                const identificadores = await client.query(
                    `INSERT INTO public.catalogo_maestro_identificadores
                        (producto_maestro_id, tipo, valor, fuente, reconciliacion_id)
                     SELECT t.id, 'ean', t.ean, $3, $4
                     FROM unnest($1::int[], $2::text[]) AS t(id, ean)
                     ON CONFLICT (tipo, valor) DO NOTHING`,
                    [ids, eans, fuente, reconciliacionId]
                );
                identificadoresCreados += identificadores.rowCount;
            }

            alAvanzar(Math.min(i + LOTE, filas.length), filas.length);
        }

        const duplicadosEvitados = filas.length - productosCreados;

        await client.query(
            `UPDATE public.catalogo_maestro_reconciliaciones
             SET productos_creados = $2, identificadores_creados = $3, coincidencias_seguras = $2,
                 duplicados_evitados = $4, terminada_en = NOW()
             WHERE id = $1`,
            [reconciliacionId, productosCreados, identificadoresCreados, duplicadosEvitados]
        );

        await client.query("COMMIT");
        return { reconciliacionId, productosCreados, identificadoresCreados, duplicadosEvitados };
    } catch (error) {
        await client.query("ROLLBACK");
        throw error;
    } finally {
        client.release();
    }
}

module.exports = { cargarMasivo, LOTE };
