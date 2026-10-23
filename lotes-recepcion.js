// Recepcion de mercancia -> lotes de caducidad.
//
// Cuando llega mercancia de un producto con vida util (tortilla, pan, lacteos), la entrada abre su lote con
// su fecha de caducidad (hoy + vida util), igual que "Llego mercancia" en Por revisar. Productos sin vida util
// (todo lo de ferreteria, por ejemplo) no se tocan: no se crea ningun lote.
//
// Va DENTRO de la transaccion de la recepcion, pero nunca puede tumbarla: usa un SAVEPOINT, asi que si algo
// falla aqui (por ejemplo una base sin la migracion de lotes) solo se omite el lote y la recepcion sigue.

const { caducidadDeEntrada, hoyEnMexico } = require("./lotes-calculo");

async function registrarLoteDeRecepcion(client, { negocioId, productoId, cantidad }) {
    const piezas = Number(cantidad);
    const id = Number(productoId);

    if (!Number.isInteger(id) || id <= 0 || !(piezas > 0)) return null;

    await client.query("SAVEPOINT lote_recepcion");

    try {
        const producto = (await client.query(
            `SELECT vida_util_dias FROM public.productos WHERE id = $1 AND negocio_id = $2`,
            [id, negocioId]
        )).rows[0];

        const hoy = hoyEnMexico();
        const caducidad = caducidadDeEntrada({ vidaUtilDias: producto?.vida_util_dias, hoy });

        if (!caducidad) {
            await client.query("RELEASE SAVEPOINT lote_recepcion");
            return null;
        }

        const lote = await client.query(
            `INSERT INTO public.producto_lotes (negocio_id, producto_id, cantidad, fecha_entrada, fecha_caducidad, origen)
             VALUES ($1, $2, $3, $4, $5, 'recepcion') RETURNING id`,
            [negocioId, id, Number(piezas.toFixed(3)), hoy, caducidad]
        );

        await client.query("RELEASE SAVEPOINT lote_recepcion");
        return lote.rows[0].id;
    } catch (error) {
        await client.query("ROLLBACK TO SAVEPOINT lote_recepcion");
        console.warn("[lotes] No se pudo abrir el lote de la recepcion:", error.message);
        return null;
    }
}

module.exports = { registrarLoteDeRecepcion };
