// Fusiona los conflictos que dejo el backfill de Fase 2 (GAFI) despues
// de revisarlos uno por uno (nombre, marca, medidas, familia de
// productos) y confirmar que SI son el mismo producto fisico visto por
// dos catalogos: GAFI, que usa su propio codigo interno, y el catalogo
// oficial TRUPER/Diprofer que ya tenia el producto identificado por el
// codigo de fabricante real (GAFI tambien distribuye lineas TRUPER/
// Pretul/Volteck/Fiero/Expert). Esta revision NO la hace este script --
// ya se hizo a mano y quedo documentada en la conversacion; este script
// solo ejecuta las fusiones ya aprobadas, una por una, identificadas por
// su codigo GAFI.
//
// Por que hacia falta fusionar y no solo quitar la bandera: cada uno de
// estos productos quedo como una fila NUEVA y separada en
// catalogo_maestro_productos (creada por contribuirOEnlazarCatalogoMaestro
// con el codigo GAFI como codigo), en vez de enlazarse a la fila que ya
// existia con el codigo de fabricante real -- catalogo_maestro_productos.codigo
// es unico, y GAFI usa un numero distinto al de TRUPER para el mismo
// producto. Sin fusionar quedarian dos identidades globales para una
// sola cosa real.
//
// Por cada par (nuevoId el duplicado creado por GAFI -> existenteId el
// que ya existia y se queda):
//   1. Repunta cualquier identificador que hoy apunte a nuevoId hacia
//      existenteId -- asi el codigo GAFI (lo unico que de verdad aporta
//      esta fusion) sigue siendo buscable, ahora hacia el producto
//      correcto.
//   2. Repunta productos.catalogo_maestro_id de cualquier negocio que
//      haya quedado enlazado al duplicado (el backfill de Fase 2 dejo
//      307 productos reales de Ferreteria Olimpico asi).
//   3. Borra la fila duplicada de catalogo_maestro_productos.
// Nunca toca precio/costo/stock/ventas -- solo identidad.
//
// Todo en UNA transaccion: o se aplican todas las fusiones o ninguna.
//
//   node --env-file=.env scripts/fusionar-conflictos-catalogo-maestro.js            (simula)
//   node --env-file=.env scripts/fusionar-conflictos-catalogo-maestro.js --aplicar

const pool = require("../db");

// Excluido a proposito: codigo GAFI 3768 ("Lentes de seguridad
// deportivo gris LEDESN") quedo en confianza media al revisarlo --
// "deportivo" no aparece del lado del catalogo oficial. Se deja
// marcado para revision manual con el producto fisico en mano, no se
// fusiona todavia.
const EXCLUIR_CODIGO_GAFI = new Set(["3768"]);

async function fusionesPendientes() {
    const flagged = await pool.query(
        `SELECT id, codigo, revision_motivo
         FROM public.catalogo_maestro_productos
         WHERE necesita_revision = true AND origen = 'negocio'
         ORDER BY id`
    );

    const pares = [];
    for (const fila of flagged.rows) {
        if (EXCLUIR_CODIGO_GAFI.has(fila.codigo)) continue;
        const m = fila.revision_motivo.match(/identificador (\w+)="([^"]+)" ya esta asignado al producto maestro (\d+)/);
        if (!m) continue;
        pares.push({ nuevoId: fila.id, existenteId: Number(m[3]), tipo: m[1], valor: m[2], codigoGafi: fila.codigo });
    }
    return pares;
}

async function main() {
    const aplicar = process.argv.includes("--aplicar");
    const pares = await fusionesPendientes();

    console.log(`${pares.length} fusiones a aplicar (excluidos por revision manual pendiente: ${[...EXCLUIR_CODIGO_GAFI].join(", ")}).`);
    if (!aplicar) console.log("Modo SIMULACION. Para escribir de verdad: --aplicar\n");

    const client = await pool.connect();
    let identificadoresRepuntados = 0;
    let productosRepuntados = 0;
    let filasBorradas = 0;

    try {
        if (aplicar) await client.query("BEGIN");

        for (const { nuevoId, existenteId, tipo, valor, codigoGafi } of pares) {
            console.log(`  GAFI ${codigoGafi} (maestro ${nuevoId}) -> se fusiona en ${existenteId} (mismo ${tipo}="${valor}")`);

            if (!aplicar) continue;

            const identRepuntados = await client.query(
                `UPDATE public.catalogo_maestro_identificadores
                 SET producto_maestro_id = $1
                 WHERE producto_maestro_id = $2`,
                [existenteId, nuevoId]
            );
            identificadoresRepuntados += identRepuntados.rowCount;

            const prodRepuntados = await client.query(
                `UPDATE public.productos SET catalogo_maestro_id = $1 WHERE catalogo_maestro_id = $2`,
                [existenteId, nuevoId]
            );
            productosRepuntados += prodRepuntados.rowCount;

            await client.query(`DELETE FROM public.catalogo_maestro_productos WHERE id = $1`, [nuevoId]);
            filasBorradas++;
        }

        if (aplicar) await client.query("COMMIT");
    } catch (error) {
        if (aplicar) await client.query("ROLLBACK");
        throw error;
    } finally {
        client.release();
    }

    console.log("\n===============================================");
    console.log(aplicar ? "  APLICADO" : "  SIMULACION -- no se escribio ninguna fila");
    console.log("===============================================");
    console.log(`  pares fusionados:                          ${pares.length}`);
    if (aplicar) {
        console.log(`  identificadores repuntados:                ${identificadoresRepuntados}`);
        console.log(`  productos.catalogo_maestro_id repuntados:  ${productosRepuntados}`);
        console.log(`  filas duplicadas borradas:                 ${filasBorradas}`);
    }
    console.log("");
}

main()
    .catch(error => {
        console.error("Fallo la fusion:", error.message);
        process.exitCode = 1;
    })
    .finally(() => pool.end());
