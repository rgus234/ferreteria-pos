// Script puntual, no es una ruta publica -- se corre una sola vez a
// mano para migrar el negocio real de Ferreteria Olimpico (slug
// "ferreteria-olimpico") al login por correo/contrasena. Genera un
// enlace de activacion (mismo mecanismo que "olvide mi contrasena",
// tabla restablecimientos_password) y lo manda por correo via Resend.
//
// Uso:
//   node --env-file=.env scripts/activar-cuenta-ferreteria-olimpico.js correo@real.com
//
// Requiere RESEND_API_KEY configurada en .env -- si no esta, el
// correo no se manda pero el enlace se imprime en la consola para
// poder mandarlo a mano mientras tanto.

const pool = require("../db");
const crypto = require("crypto");
const { enviarCorreoActivacionCuenta } = require("../email");

const SLUG_FERRETERIA_OLIMPICO = "ferreteria-olimpico";

function hashTokenSeguro(tokenPlano) {
    return crypto.createHash("sha256").update(String(tokenPlano)).digest("hex");
}

async function main() {
    const correo = String(process.argv[2] || "").trim().toLowerCase();

    if (!correo || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(correo)) {
        console.error("Uso: node --env-file=.env scripts/activar-cuenta-ferreteria-olimpico.js correo@real.com");
        process.exit(1);
    }

    const negocio = await pool.query(
        "SELECT id, nombre, correo, password_hash FROM public.negocios WHERE slug = $1 LIMIT 1",
        [SLUG_FERRETERIA_OLIMPICO]
    );

    if (negocio.rows.length === 0) {
        console.error(`No existe un negocio con slug "${SLUG_FERRETERIA_OLIMPICO}"`);
        process.exit(1);
    }

    const fila = negocio.rows[0];

    if (fila.password_hash) {
        console.error("Este negocio ya tiene contrasena configurada. No se manda el correo de activacion de nuevo.");
        process.exit(1);
    }

    const correoExistente = await pool.query(
        "SELECT id FROM public.negocios WHERE LOWER(correo) = $1 AND id != $2 LIMIT 1",
        [correo, fila.id]
    );

    if (correoExistente.rows.length > 0) {
        console.error("Ya existe otro negocio usando ese correo.");
        process.exit(1);
    }

    await pool.query(
        `UPDATE public.negocios SET correo = $1, correo_verificado = true, updated_at = NOW() WHERE id = $2`,
        [correo, fila.id]
    );

    const tokenPlano = crypto.randomBytes(32).toString("hex");

    await pool.query(
        `INSERT INTO public.restablecimientos_password (negocio_id, codigo_hash, expira_at)
         VALUES ($1, $2, NOW() + INTERVAL '24 hours')`,
        [fila.id, hashTokenSeguro(tokenPlano)]
    );

    const base = process.env.APP_BASE_URL || "http://localhost:3000";
    const enlace = `${base}/activar-cuenta/${tokenPlano}`;

    console.log(`Enlace de activacion (valido 24 horas): ${enlace}`);

    const resultado = await enviarCorreoActivacionCuenta(correo, fila.nombre, enlace);

    if (resultado.ok) {
        console.log(`Correo de activacion enviado a ${correo}.`);
    } else {
        console.warn(`No se pudo enviar el correo (${resultado.error}). Manda el enlace de arriba a mano mientras tanto.`);
    }

    await pool.end();
}

main().catch(error => {
    console.error(error);
    process.exit(1);
});
