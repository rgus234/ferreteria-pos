// Mantiene viva la carga del catalogo TRUPER hasta que termine.
//
//   NEXO_VISION_MAX=4000 node --env-file=.env scripts/supervisar-carga-truper.js
//
// Por que existe: el 2026-09-02 la carga se cayo CINCO veces en un dia, y
// cada vez por una causa distinta -- una conexion de Postgres cortada, un
// 503 pasajero de TRUPER, un interbloqueo del pool de OCR, el vigilante
// matando una fase que no avisaba que avanzaba. Todas quedaron
// arregladas, pero una tarea de horas contra un servidor ajeno y una base
// en la nube se va a seguir cayendo por razones nuevas.
//
// Como la carga es reanudable de verdad (cada lote se confirma en su
// propia transaccion, probado contra las cinco caidas), relanzarla es
// seguro: retoma donde quedo y no repite trabajo.
//
// LO QUE ESTE SUPERVISOR NO HACE, A PROPOSITO:
//   - No sube el tope de vision. El gasto lo decide quien lo lanza.
//   - No reintenta para siempre: si algo falla una y otra vez, se rinde y
//     lo deja escrito. Un supervisor terco quema saldo toda la noche.

const { spawn } = require("child_process");
const path = require("path");
const pool = require("../db");

const RAIZ = path.join(__dirname, "..");
const MAX_RELANZAMIENTOS = 8;

// Si una corrida muere antes de esto, algo esta roto de verdad y
// relanzarla solo repite el fallo mas rapido.
const MINIMO_PARA_CONTAR_COMO_AVANCE_MS = 3 * 60 * 1000;

function ahora() {
    return new Date().toISOString().replace("T", " ").slice(0, 19);
}

function anotar(mensaje) {
    console.log(`[${ahora()}] ${mensaje}`);
}

function correrCarga() {
    return new Promise(resolve => {
        const hijo = spawn(
            process.execPath,
            ["--env-file=.env", "--expose-gc", "scripts/bootstrap-truper.js"],
            { cwd: RAIZ, env: process.env, stdio: ["ignore", "inherit", "inherit"] }
        );
        hijo.on("exit", codigo => resolve(codigo ?? 1));
        hijo.on("error", () => resolve(1));
    });
}

async function estado() {
    const m = await pool.query(
        `SELECT COUNT(*) FILTER (WHERE estado = 'ok')::int ok,
                COUNT(*) FILTER (WHERE estado <> 'ok')::int pendientes
           FROM public.catalogo_fabricante_modulos WHERE fabricante = 'TRUPER'`
    );
    const p = await pool.query(
        `SELECT COUNT(*)::int total,
                COUNT(*) FILTER (WHERE precio_mayoreo IS NOT NULL
                             AND precio_medio_mayoreo IS NOT NULL
                             AND precio_publico IS NOT NULL)::int los_tres
           FROM public.catalogo_fabricante_productos WHERE fabricante = 'TRUPER'`
    );
    return { ...m.rows[0], ...p.rows[0] };
}

// Una corrida que murio deja su fila en 'en_curso' con el latido fresco,
// y el indice unico impide arrancar otra hasta que pasen 5 minutos. Aqui
// se sabe con certeza que el proceso murio -- se acaba de ver salir -- asi
// que se cierra de una vez en lugar de esperar.
async function cerrarCorridaMuerta() {
    const r = await pool.query(
        `UPDATE public.catalogo_fabricante_sincronizaciones
            SET estado = 'error', detalle = 'el proceso murio; el supervisor la relanza',
                terminada_en = NOW()
          WHERE fabricante = 'TRUPER' AND estado = 'en_curso'
        RETURNING id`
    );
    return r.rows.map(f => f.id);
}

async function main() {
    anotar("supervisor en marcha");
    const inicial = await estado();
    anotar(`estado inicial -- modulos ok: ${inicial.ok}, pendientes: ${inicial.pendientes}, productos con los 3 precios: ${inicial.los_tres}`);

    for (let intento = 1; intento <= MAX_RELANZAMIENTOS; intento++) {
        anotar(`--- corrida ${intento} de hasta ${MAX_RELANZAMIENTOS} ---`);

        const desde = Date.now();
        const codigo = await correrCarga();
        const duro = Date.now() - desde;
        const minutos = Math.round(duro / 60000);

        const despues = await estado();
        anotar(`corrida ${intento} termino con codigo ${codigo} tras ${minutos} min -- ` +
               `modulos ok: ${despues.ok}, pendientes: ${despues.pendientes}, con los 3 precios: ${despues.los_tres}`);

        if (codigo === 0) {
            anotar("la carga termino sola. Nada mas que hacer.");
            break;
        }

        const cerradas = await cerrarCorridaMuerta();
        if (cerradas.length > 0) anotar(`se cerro la corrida ${cerradas.join(", ")} que quedo colgada`);

        // Ya no queda nada pendiente: da igual como haya salido.
        if (despues.pendientes === 0) {
            anotar("no quedan modulos pendientes. Se termina.");
            break;
        }

        // Murio enseguida: relanzar solo repetiria el fallo mas rapido.
        if (duro < MINIMO_PARA_CONTAR_COMO_AVANCE_MS) {
            anotar(`murio en menos de ${MINIMO_PARA_CONTAR_COMO_AVANCE_MS / 60000} minutos: no es una caida pasajera. Se detiene para que alguien lo mire.`);
            break;
        }

        if (intento === MAX_RELANZAMIENTOS) {
            anotar("se agotaron los relanzamientos. Quedo trabajo pendiente para una corrida manual.");
        }
    }

    const fin = await estado();
    anotar("===== RESUMEN DE LA NOCHE =====");
    anotar(`  modulos leidos:        ${fin.ok}`);
    anotar(`  modulos pendientes:    ${fin.pendientes}`);
    anotar(`  productos:             ${fin.total}`);
    anotar(`  con los 3 precios:     ${fin.los_tres}   (empezo en ${inicial.los_tres})`);
}

main()
    .catch(error => {
        anotar(`el supervisor fallo: ${error.message}`);
        process.exitCode = 1;
    })
    .finally(() => pool.end());
