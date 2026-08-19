// Verificacion de la Fase 5 (login movil Nexo, ver plan
// stateless-doodling-tarjan.md): el wizard movil espeja el auto-routing
// de administradores puros que ya existia en escritorio
// (servirCuentaMarket) -- una persona que solo administra negocios
// (sin ninguna señal de comprador) nunca ve el hub de comprador,
// tampoco en movil. Requiere el servidor dev en localhost:3000.
const http = require("http");
const { pool, crearNegocioPrueba, borrarNegocioPrueba } = require("../tests/helpers/negocio-prueba");
const { crearPersonaPrueba, mintearSesionPruebaPersona, borrarPersonaPrueba } = require("../tests/helpers/persona-prueba");

const UA_ANDROID = "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Mobile Safari/537.36";

let fallos = 0;
function log(etiqueta, ok, extra) {
    console.log(`${ok ? "OK  " : "FAIL"} ${etiqueta}${extra ? " -- " + extra : ""}`);
    if (!ok) fallos++;
}

function pedir(token) {
    return new Promise((resolve, reject) => {
        const req = http.request({ hostname: "localhost", port: 3000, path: "/market/mi-cuenta", method: "GET", headers: { "User-Agent": UA_ANDROID, "x-persona-token": token } }, res => {
            let texto = "";
            res.on("data", chunk => { texto += chunk; });
            res.on("end", () => resolve({ status: res.statusCode, texto }));
        });
        req.on("error", reject);
        req.end();
    });
}

(async () => {
    let personaId = null;
    const negocios = [];
    let errorInesperado = false;
    try {
        // 1. Persona que administra exactamente 1 negocio, sin señal compradora -> auto-entra (paginaEntrandoAdminMarketHtml)
        const persona = await crearPersonaPrueba("elegir-modo");
        personaId = persona.id;
        const token = await mintearSesionPruebaPersona(persona.id);

        const negocio1 = await crearNegocioPrueba("elegir-modo-uno");
        negocios.push(negocio1.negocioId);
        await pool.query(`UPDATE public.negocios SET persona_id = $1 WHERE id = $2`, [persona.id, negocio1.negocioId]);

        const conUnNegocio = await pedir(token);
        log("1 negocio administrado, sin señal compradora -> responde 200", conUnNegocio.status === 200);
        log("1 negocio administrado -> pagina 'Entrando a tu panel'", conUnNegocio.texto.includes("Entrando a tu panel"));
        log("1 negocio administrado -> NO muestra el wizard de comprador", !conUnNegocio.texto.includes('class="wizard-shell"'));

        // 2. Misma persona, ahora administra 2 negocios -> pantalla elegir negocio
        const negocio2 = await crearNegocioPrueba("elegir-modo-dos");
        negocios.push(negocio2.negocioId);
        await pool.query(`UPDATE public.negocios SET persona_id = $1 WHERE id = $2`, [persona.id, negocio2.negocioId]);

        const conDosNegocios = await pedir(token);
        log("2 negocios administrados -> responde 200", conDosNegocios.status === 200);
        log("2 negocios administrados -> pantalla 'Administras varios negocios'", conDosNegocios.texto.includes("Administras varios negocios"));
        log("2 negocios administrados -> NO muestra el wizard de comprador", !conDosNegocios.texto.includes('class="wizard-shell"'));

        // 3. Persona compradora pura (sin negocios) -> home normal del wizard
        const personaCompradora = await crearPersonaPrueba("elegir-modo-comprador");
        const tokenComprador = await mintearSesionPruebaPersona(personaCompradora.id);
        const comoComprador = await pedir(tokenComprador);
        log("Comprador puro -> responde 200", comoComprador.status === 200);
        log("Comprador puro -> ve el wizard con data-screen=\"home\"", comoComprador.texto.includes('class="wizard-shell"') && comoComprador.texto.includes('data-screen="home"'));
        await borrarPersonaPrueba(personaCompradora.id);
    } catch (error) {
        console.error("Error inesperado durante la prueba:", error);
        errorInesperado = true;
    } finally {
        // Los negocios referencian persona_id -- deben borrarse antes
        // que la persona (FK negocios_persona_id_fkey).
        for (const negocioId of negocios) await borrarNegocioPrueba(negocioId);
        await borrarPersonaPrueba(personaId);
        await pool.end();
    }

    console.log(`\n${(fallos === 0 && !errorInesperado) ? "TODAS LAS PRUEBAS PASARON" : `${fallos} PRUEBA(S) FALLARON`}`);
    process.exit((fallos === 0 && !errorInesperado) ? 0 : 1);
})();
