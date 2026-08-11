// Prueba manual end-to-end de "Nexo Market en el celular": auto-deteccion
// admin/comprador en /market/mi-cuenta + manifest/service worker
// instalables. No es parte de la suite automatizada -- script de un solo
// uso contra negocios/personas sinteticos (nunca negocio_id = 1), datos
// borrados al terminar.
// Uso: node --env-file=.env scripts/verificar-market-app-movil.js
const http = require("http");
const { pool, crearNegocioPrueba, borrarNegocioPrueba } = require("../tests/helpers/negocio-prueba");
const { crearPersonaPrueba, mintearSesionPruebaPersona, borrarPersonaPrueba } = require("../tests/helpers/persona-prueba");
const { iniciarServidorPrueba, detenerServidorPrueba } = require("../tests/helpers/servidor-prueba");

let fallos = 0;
function log(etiqueta, ok, extra = "") {
    console.log(`${ok ? "OK  " : "FAIL"} ${etiqueta}${extra ? " -- " + JSON.stringify(extra) : ""}`);
    if (!ok) fallos++;
}

function llamar(metodo, ruta, body, headers = {}) {
    return new Promise((resolve, reject) => {
        const payload = body ? (typeof body === "string" ? body : JSON.stringify(body)) : null;
        const req = http.request(
            {
                hostname: "localhost",
                port: 3099,
                path: ruta,
                method: metodo,
                headers: {
                    "Host": "nexoposoficial.com",
                    ...(payload ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload) } : {}),
                    ...headers
                }
            },
            res => {
                let texto = "";
                res.on("data", chunk => { texto += chunk; });
                res.on("end", () => {
                    let datos = null;
                    try { datos = JSON.parse(texto); } catch (e) { /* HTML */ }
                    resolve({ status: res.statusCode, headers: res.headers, datos, texto });
                });
            }
        );
        req.on("error", reject);
        if (payload) req.write(payload);
        req.end();
    });
}

(async () => {
    await iniciarServidorPrueba();

    const negocioSolo = await crearNegocioPrueba("app-movil-solo");
    const negocioA = await crearNegocioPrueba("app-movil-a");
    const negocioB = await crearNegocioPrueba("app-movil-b");
    const negocioC = await crearNegocioPrueba("app-movil-c");
    const negocioD = await crearNegocioPrueba("app-movil-d");
    let personaAdminSolaId = null;
    let personaAdminDobleId = null;
    let personaCompradoraId = null;

    try {
        // --- 0) Estaticos instalables ---
        const manifest = await llamar("GET", "/manifest-market.json", null);
        log("GET /manifest-market.json responde 200", manifest.status === 200);
        log("manifest tiene name 'Nexo Market'", manifest.datos?.name === "Nexo Market", manifest.datos);
        log("manifest scope '/market/'", manifest.datos?.scope === "/market/");

        const sw = await llamar("GET", "/market-sw.js", null);
        log("GET /market-sw.js responde 200", sw.status === 200);
        log("service worker no cachea catalogo/carrito", !sw.texto.includes("/market/carrito") && !sw.texto.includes("buscar-json"));

        // --- 1) Persona que SOLO administra 1 negocio (0 senal compradora) -> auto-entra ---
        const personaAdminSola = await crearPersonaPrueba("app-movil-admin-sola");
        personaAdminSolaId = personaAdminSola.id;
        await pool.query(`UPDATE public.negocios SET persona_id = $1 WHERE id = $2`, [personaAdminSolaId, negocioSolo.negocioId]);
        const tokenAdminSola = await mintearSesionPruebaPersona(personaAdminSolaId);
        const authAdminSola = { "x-persona-token": tokenAdminSola };

        const respuestaAdminSola = await llamar("GET", "/market/mi-cuenta", null, authAdminSola);
        log("admin puro (1 negocio) -> 200", respuestaAdminSola.status === 200);
        log("nunca pinta el hub de comprador", !respuestaAdminSola.texto.includes('data-panel="resumen"'));
        log("nunca pinta la pantalla de elegir negocio", !respuestaAdminSola.texto.includes("Administras varios negocios"));
        log("muestra la pantalla de auto-entrada", respuestaAdminSola.texto.includes("Entrando a tu panel"));

        const matchToken = respuestaAdminSola.texto.match(/entrar=([0-9a-f]{64})/);
        log("la pagina incluye un token de sesion real (64 hex)", Boolean(matchToken), respuestaAdminSola.texto.slice(0, 200));

        if (matchToken) {
            const verificarToken = await llamar("GET", "/cuenta/ultimo-acceso", null, { Authorization: `Bearer ${matchToken[1]}` });
            log("el token minteado autentica una ruta real de negocio", verificarToken.status === 200, verificarToken.datos);
        }

        // --- 2) Persona que administra 2 negocios (0 senal compradora) -> pantalla de elegir ---
        const personaAdminDoble = await crearPersonaPrueba("app-movil-admin-doble");
        personaAdminDobleId = personaAdminDoble.id;
        await pool.query(`UPDATE public.negocios SET persona_id = $1 WHERE id = $2`, [personaAdminDobleId, negocioA.negocioId]);
        await pool.query(`UPDATE public.negocios SET persona_id = $1 WHERE id = $2`, [personaAdminDobleId, negocioB.negocioId]);
        const tokenAdminDoble = await mintearSesionPruebaPersona(personaAdminDobleId);
        const authAdminDoble = { "x-persona-token": tokenAdminDoble };

        const respuestaAdminDoble = await llamar("GET", "/market/mi-cuenta", null, authAdminDoble);
        log("admin puro (2 negocios) -> 200", respuestaAdminDoble.status === 200);
        log("muestra la pantalla de elegir negocio", respuestaAdminDoble.texto.includes("Administras varios negocios"));
        log("nunca pinta el hub de comprador", !respuestaAdminDoble.texto.includes('data-panel="resumen"'));
        log("nunca se auto-entra sin elegir", !respuestaAdminDoble.texto.includes("Entrando a tu panel"));
        log("lista los 2 negocios para elegir", respuestaAdminDoble.texto.includes("Prueba automatizada app-movil-a") && respuestaAdminDoble.texto.includes("Prueba automatizada app-movil-b"));

        // --- 3) Persona compradora real que TAMBIEN administra -> sigue viendo el hub de siempre ---
        const personaCompradora = await crearPersonaPrueba("app-movil-compradora");
        personaCompradoraId = personaCompradora.id;
        await pool.query(`UPDATE public.negocios SET persona_id = $1 WHERE id = $2`, [personaCompradoraId, negocioC.negocioId]);
        await pool.query(
            `INSERT INTO public.clientes_credito (nombre, telefono, limite_credito, activo, negocio_id, persona_id) VALUES ('Cliente movil', '4771119999', 2000, true, $1, $2)`,
            [negocioD.negocioId, personaCompradoraId]
        );
        const tokenCompradora = await mintearSesionPruebaPersona(personaCompradoraId);
        const authCompradora = { "x-persona-token": tokenCompradora };

        const respuestaCompradora = await llamar("GET", "/market/mi-cuenta", null, authCompradora);
        log("comprador que tambien administra -> 200", respuestaCompradora.status === 200);
        log("sigue viendo el hub de comprador de siempre", respuestaCompradora.texto.includes('data-panel="resumen"'));
        log("sigue viendo la tarjeta de administrador", respuestaCompradora.texto.includes("cuentaMarketAdminCard"));
        log("nunca se auto-entra (tiene senal compradora real)", !respuestaCompradora.texto.includes("Entrando a tu panel"));

        console.log(`\n${fallos === 0 ? "TODO OK" : fallos + " FALLO(S)"}`);
    } finally {
        await borrarNegocioPrueba(negocioSolo.negocioId);
        await borrarNegocioPrueba(negocioA.negocioId);
        await borrarNegocioPrueba(negocioB.negocioId);
        await borrarNegocioPrueba(negocioC.negocioId);
        await borrarNegocioPrueba(negocioD.negocioId);
        await borrarPersonaPrueba(personaAdminSolaId);
        await borrarPersonaPrueba(personaAdminDobleId);
        await borrarPersonaPrueba(personaCompradoraId);
        await detenerServidorPrueba();
        await pool.end();
    }

    process.exit(fallos === 0 ? 0 : 1);
})().catch(async error => {
    console.error("FALLO INESPERADO:", error);
    process.exit(1);
});
