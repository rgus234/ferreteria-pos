// Mismo criterio que negocio-prueba.js -- sin base de datos de pruebas
// separada, este helper aisla cada persona sintetica (correo con
// prefijo test-auto-) y se borra por completo al terminar.

const crypto = require("crypto");
const pool = require("../../db");
const { hashPassword } = require("../../password-utils");

function hashToken(tokenPlano) {
    return crypto.createHash("sha256").update(String(tokenPlano)).digest("hex");
}

async function crearPersonaPrueba(sufijo, overrides = {}) {
    const correo = `test-auto-persona-${sufijo}-${Date.now()}@example.com`;

    const persona = await pool.query(
        `INSERT INTO public.personas (nombre, correo, password_hash, oficio, correo_verificado)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id, nombre, correo, oficio, correo_verificado`,
        [
            overrides.nombre || `Persona de prueba ${sufijo}`,
            correo,
            hashPassword("password-de-prueba-123"),
            overrides.oficio ?? null,
            overrides.correoVerificado !== false
        ]
    );

    return persona.rows[0];
}

async function mintearSesionPruebaPersona(personaId) {
    const tokenPlano = `token-persona-prueba-${crypto.randomBytes(16).toString("hex")}`;

    await pool.query(
        `INSERT INTO public.sesiones_persona (persona_id, token_hash, dispositivo, ip)
         VALUES ($1, $2, 'pruebas-automatizadas', '127.0.0.1')`,
        [personaId, hashToken(tokenPlano)]
    );

    return tokenPlano;
}

async function borrarPersonaPrueba(personaId) {
    if (!personaId) return;
    await pool.query(`DELETE FROM public.sesiones_persona WHERE persona_id = $1`, [personaId]);
    await pool.query(`DELETE FROM public.personas WHERE id = $1`, [personaId]);
}

module.exports = { pool, crearPersonaPrueba, mintearSesionPruebaPersona, borrarPersonaPrueba };
