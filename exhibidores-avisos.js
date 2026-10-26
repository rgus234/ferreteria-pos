// Aviso diario de exhibidores por surtir: "Tu despachador de brocas tiene 6 productos por surtir (2 agotados)".
// Una vez al dia (despues de las 9 am, hora de Mexico) y solo si hay algo que avisar. Un espacio cuenta como "por surtir" cuando
// su existencia es el 25 % de su capacidad o menos (la capacidad es la que se pone al armar el exhibidor; sin capacidad no se avisa).
const { enviarPushADuenoDelNegocio } = require("./push-server");

const HORA_AVISO = 9;
const PORCENTAJE_BAJO = 0.25;
const INTERVALO_REVISION_MS = 30 * 60 * 1000;
const ZONA = "America/Mexico_City";

function fechaLocal(ahora = new Date()) {
    return new Intl.DateTimeFormat("en-CA", { timeZone: ZONA }).format(ahora);
}

function horaLocal(ahora = new Date()) {
    return Number(new Intl.DateTimeFormat("en-GB", { timeZone: ZONA, hour: "2-digit", hour12: false }).format(ahora)) % 24;
}

// Exhibidores activos del negocio con espacios por surtir: [{ id, nombre, bajos, agotados }].
async function exhibidoresPorSurtir(pool, negocioId) {
    const filas = await pool.query(
        `SELECT x.id, x.nombre,
                COUNT(*) FILTER (WHERE (p.stock + p.stock_resto) <= e.capacidad * $2)::int AS bajos,
                COUNT(*) FILTER (WHERE (p.stock + p.stock_resto) <= 0)::int AS agotados
         FROM public.exhibidores x
         JOIN public.exhibidor_espacios e ON e.exhibidor_id = x.id AND e.capacidad > 0
         JOIN public.productos p ON p.id = e.producto_id
         WHERE x.negocio_id = $1 AND x.activo = true
         GROUP BY x.id, x.nombre
         HAVING COUNT(*) FILTER (WHERE (p.stock + p.stock_resto) <= e.capacidad * $2) > 0
         ORDER BY bajos DESC, x.nombre ASC`,
        [negocioId, PORCENTAJE_BAJO]
    );

    return filas.rows;
}

function textoAviso(lista) {
    const una = lista.length === 1;
    const plural = n => (n === 1 ? "producto" : "productos");

    if (una) {
        const x = lista[0];
        return {
            titulo: "Hay que surtir un exhibidor",
            cuerpo: `${x.nombre}: ${x.bajos} ${plural(x.bajos)} por surtir${x.agotados ? ` (${x.agotados} agotado${x.agotados === 1 ? "" : "s"})` : ""}.`
        };
    }

    const detalle = lista.slice(0, 3).map(x => `${x.nombre} (${x.bajos})`).join(", ");

    return { titulo: "Hay que surtir tus exhibidores", cuerpo: `${lista.length} exhibidores por surtir: ${detalle}${lista.length > 3 ? " y mas" : ""}.` };
}

// enviar se inyecta y soloNegocios acota a quien avisar: asi las pruebas no tocan a los negocios reales.
async function avisarExhibidores(pool, { ahora = new Date(), enviar = enviarPushADuenoDelNegocio, soloNegocios = null } = {}) {
    if (horaLocal(ahora) < HORA_AVISO) return 0;

    const hoy = fechaLocal(ahora);
    const negocios = await pool.query(
        `SELECT DISTINCT negocio_id AS id FROM public.exhibidores WHERE activo = true AND ($1::int[] IS NULL OR negocio_id = ANY($1::int[]))`,
        [soloNegocios]
    );
    let avisados = 0;

    for (const negocio of negocios.rows) {
        try {
            const lista = await exhibidoresPorSurtir(pool, negocio.id);
            if (!lista.length) continue;

            const reservado = await pool.query(
                `INSERT INTO public.avisos_exhibidores (negocio_id, fecha, cuantos) VALUES ($1, $2, $3)
                 ON CONFLICT (negocio_id, fecha) DO NOTHING RETURNING negocio_id`,
                [negocio.id, hoy, lista.length]
            );
            if (!reservado.rows.length) continue;

            const { titulo, cuerpo } = textoAviso(lista);
            await enviar(pool, negocio.id, { titulo, cuerpo, url: "/" });
            avisados++;
        } catch (error) {
            console.warn("[exhibidores] No se pudo avisar al negocio", negocio.id, error.message);
        }
    }

    return avisados;
}

function instalar(app, pool) {
    // El servidor de pruebas automaticas comparte la base de datos real: ahi nunca se mandan avisos de verdad.
    if (process.env.NEXO_PRUEBAS) return;

    async function revisarYCorrer() {
        try {
            await avisarExhibidores(pool);
        } catch (error) {
            console.log("[exhibidores] Error en el aviso diario:", error.message);
        }
    }

    setTimeout(revisarYCorrer, 45000);
    setInterval(revisarYCorrer, INTERVALO_REVISION_MS);
}

module.exports = instalar;
module.exports.exhibidoresPorSurtir = exhibidoresPorSurtir;
module.exports.avisarExhibidores = avisarExhibidores;
module.exports.textoAviso = textoAviso;
module.exports.horaLocal = horaLocal;
module.exports.fechaLocal = fechaLocal;
