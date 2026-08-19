// Verificacion end-to-end de la Fase 1 (login movil Nexo): gate de
// verificacion de correo real para personas. Requiere el servidor
// dev corriendo en localhost:3000. Crea/borra sus propios datos.

const http = require("http");
const crypto = require("crypto");
const pool = require("../db");

function hashTokenSeguro(tokenPlano) {
    return crypto.createHash("sha256").update(String(tokenPlano)).digest("hex");
}

const BASE = "http://localhost:3000";

function req(metodo, ruta, body) {
    return new Promise((resolve, reject) => {
        const datos = body ? JSON.stringify(body) : null;
        const url = new URL(BASE + ruta);

        const opciones = {
            method: metodo,
            hostname: url.hostname,
            port: url.port,
            path: url.pathname + url.search,
            headers: { "Content-Type": "application/json" }
        };

        const r = http.request(opciones, res => {
            let data = "";
            res.on("data", chunk => { data += chunk; });
            res.on("end", () => {
                let json = null;
                try { json = JSON.parse(data); } catch (e) { json = data; }
                resolve({ status: res.statusCode, body: json });
            });
        });

        r.on("error", reject);
        if (datos) r.write(datos);
        r.end();
    });
}

function assert(cond, mensaje) {
    if (!cond) throw new Error("FALLO: " + mensaje);
    console.log("OK:", mensaje);
}

async function limpiar(correo) {
    await pool.query(`DELETE FROM public.sesiones_persona WHERE persona_id IN (SELECT id FROM public.personas WHERE correo = $1)`, [correo]);
    await pool.query(`DELETE FROM public.verificaciones_correo_persona WHERE correo = $1`, [correo]);
    await pool.query(`DELETE FROM public.personas WHERE correo = $1`, [correo]);
}

async function obtenerTokenVerificacionPendiente(correo) {
    const fila = await pool.query(
        `SELECT token_hash FROM public.verificaciones_correo_persona WHERE correo = $1 AND usado_at IS NULL ORDER BY id DESC LIMIT 1`,
        [correo]
    );
    return fila.rows[0]?.token_hash || null;
}

(async () => {
    const correoConVerificacion = `test-auto-login-${Date.now()}@example.com`;
    const telefonoPrueba = `555${Date.now()}`.slice(0, 10);

    try {
        // 1. Registro con correo -> requiereVerificacionCorreo:true, login bloqueado hasta verificar
        const registro = await req("POST", "/personas/registro", {
            nombre: "Persona Prueba Login",
            correo: correoConVerificacion,
            password: "password-de-prueba-123"
        });
        assert(registro.status === 200 && registro.body.ok, "registro con correo responde 200 ok");
        assert(registro.body.requiereVerificacionCorreo === true, "registro marca requiereVerificacionCorreo=true");
        assert(!!registro.body.token, "registro sigue minteando sesion (comportamiento existente intacto)");

        // 2. login bloqueado por correo sin verificar
        const loginBloqueado = await req("POST", "/personas/login", {
            identificador: correoConVerificacion,
            password: "password-de-prueba-123"
        });
        assert(loginBloqueado.status === 403 && loginBloqueado.body.correoSinVerificar === true, "login bloqueado con correoSinVerificar antes de verificar");

        // 3. GET /personas/verificar-correo/:token real -- insertamos
        //    nuestro propio token plano (mismo formato hasheado que usa
        //    crearVerificacionCorreoPersona) para poder llamar la ruta
        //    real de punta a punta.
        const personaFila = await pool.query(`SELECT id FROM public.personas WHERE correo = $1`, [correoConVerificacion]);
        const personaId = personaFila.rows[0].id;
        const tokenPlano = crypto.randomBytes(32).toString("hex");

        await pool.query(
            `INSERT INTO public.verificaciones_correo_persona (persona_id, correo, token_hash, expira_at) VALUES ($1, $2, $3, NOW() + INTERVAL '24 hours')`,
            [personaId, correoConVerificacion, hashTokenSeguro(tokenPlano)]
        );

        const verificacion = await req("GET", `/personas/verificar-correo/${tokenPlano}`);
        assert(verificacion.status === 200, "GET /personas/verificar-correo/:token responde 200");
        assert(String(verificacion.body).includes("Correo verificado"), "pagina de confirmacion dice Correo verificado");

        const personaTrasVerificar = await pool.query(`SELECT correo_verificado FROM public.personas WHERE id = $1`, [personaId]);
        assert(personaTrasVerificar.rows[0].correo_verificado === true, "correo_verificado quedo true en la base de datos");

        const loginDesbloqueado = await req("POST", "/personas/login", {
            identificador: correoConVerificacion,
            password: "password-de-prueba-123"
        });
        assert(loginDesbloqueado.status === 200 && loginDesbloqueado.body.ok, "login funciona tras verificar el correo por el enlace real");

        // 3b. token ya usado no debe volver a funcionar
        const reintento = await req("GET", `/personas/verificar-correo/${tokenPlano}`);
        assert(reintento.status === 400, "token ya usado responde 400 en un segundo intento");

        // 4. reenviar-verificacion es publico (sin sesion) y siempre responde ok
        await pool.query(`UPDATE public.personas SET correo_verificado = false WHERE correo = $1`, [correoConVerificacion]);
        const reenvio = await req("POST", "/personas/reenviar-verificacion", { correo: correoConVerificacion });
        assert(reenvio.status === 200 && reenvio.body.ok, "reenviar-verificacion publico responde ok");

        const tokenHashPendiente = await obtenerTokenVerificacionPendiente(correoConVerificacion);
        assert(!!tokenHashPendiente, "reenviar-verificacion creo una fila nueva en verificaciones_correo_persona");

        // 5. PATCH /personas/correo (con sesion) -- cambia correo y resetea correo_verificado
        const cambioCorreoNuevo = `${correoConVerificacion}-nuevo`;
        const patchSinSesion = await req("PATCH", "/personas/correo", { correo: cambioCorreoNuevo });
        assert(patchSinSesion.status === 401, "PATCH /personas/correo exige sesion (401 sin ella)");

        // 6. registro solo con telefono -- nunca requiere verificacion, login nunca se bloquea
        await pool.query(`DELETE FROM public.personas WHERE telefono = $1`, [telefonoPrueba]);
        const registroTelefono = await req("POST", "/personas/registro", {
            nombre: "Persona Prueba Solo Telefono",
            telefono: telefonoPrueba,
            password: "password-de-prueba-123"
        });
        assert(registroTelefono.status === 200 && registroTelefono.body.ok, "registro solo con telefono responde ok");
        assert(registroTelefono.body.requiereVerificacionCorreo === false, "registro solo con telefono NO requiere verificacion");

        const loginTelefono = await req("POST", "/personas/login", {
            identificador: telefonoPrueba,
            password: "password-de-prueba-123"
        });
        assert(loginTelefono.status === 200 && loginTelefono.body.ok, "login con cuenta solo-telefono nunca se bloquea por correo");

        await pool.query(`DELETE FROM public.sesiones_persona WHERE persona_id IN (SELECT id FROM public.personas WHERE telefono = $1)`, [telefonoPrueba]);
        await pool.query(`DELETE FROM public.personas WHERE telefono = $1`, [telefonoPrueba]);

        console.log("\nTodas las verificaciones de Fase 1 pasaron.\n");
    } finally {
        await limpiar(correoConVerificacion);
        await pool.end();
    }
})().catch(error => {
    console.error(error);
    process.exit(1);
});
