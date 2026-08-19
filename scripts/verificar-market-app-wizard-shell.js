// Verificacion de la Fase 2 (login movil Nexo, ver plan
// stateless-doodling-tarjan.md): deteccion movil/escritorio en
// GET /market/mi-cuenta + esqueleto navegable de 12 pantallas.
// Requiere el servidor dev en localhost:3000. Crea/borra su propia
// persona sintetica (ya verificada) para probar la vista logueada.
const http = require("http");
const { crearPersonaPrueba, mintearSesionPruebaPersona, borrarPersonaPrueba } = require("../tests/helpers/persona-prueba");

const BASE_HOST = "localhost";
const BASE_PORT = 3000;
const UA_ANDROID = "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Mobile Safari/537.36";
const UA_DESKTOP = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";

let fallos = 0;
function log(etiqueta, ok, extra) {
    console.log(`${ok ? "OK  " : "FAIL"} ${etiqueta}${extra ? " -- " + extra : ""}`);
    if (!ok) fallos++;
}

function pedir(ruta, userAgent, token) {
    return new Promise((resolve, reject) => {
        const headers = { "User-Agent": userAgent };
        if (token) headers["x-persona-token"] = token;
        const req = http.request({ hostname: BASE_HOST, port: BASE_PORT, path: ruta, method: "GET", headers }, res => {
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
    let errorInesperado = false;
    try {
        // 1. Android real -> wizard movil (visitante, sin sesion)
        const movilVisitante = await pedir("/market/mi-cuenta", UA_ANDROID);
        log("Android real responde 200", movilVisitante.status === 200);
        log("Android real sirve el wizard movil (title Nexo)", movilVisitante.texto.includes("<title>Mi cuenta -- Nexo</title>"));
        log("Wizard movil trae wizard-shell", movilVisitante.texto.includes('class="wizard-shell"'));
        [
            "bienvenida", "que-es-market", "elegir-registro", "crear-cuenta", "verificacion",
            "cuenta-creada", "una-cuenta", "elegir-modo", "iniciar-sesion", "recuperar-password"
        ].forEach(pantalla => {
            log(`Wizard movil (visitante) trae data-screen="${pantalla}"`, movilVisitante.texto.includes(`data-screen="${pantalla}"`));
        });
        log("Wizard movil (visitante) NO trae home (aun no hay sesion)", !movilVisitante.texto.includes('data-screen="home"'));

        // 2. Desktop real -> formulario clasico sin cambios
        const escritorio = await pedir("/market/mi-cuenta", UA_DESKTOP);
        log("Escritorio real responde 200", escritorio.status === 200);
        log("Escritorio real sirve la pagina clasica (title Nexo Market)", escritorio.texto.includes("<title>Mi cuenta -- Nexo Market</title>"));
        log("Escritorio real NO trae wizard-shell", !escritorio.texto.includes('class="wizard-shell"'));
        log("Escritorio real trae el formulario de pestanas clasico", escritorio.texto.includes('id="cuentaMarketLoginForm"'));

        // 3. Overrides manuales ?vista=... (QA)
        const forzarEscritorio = await pedir("/market/mi-cuenta?vista=escritorio", UA_ANDROID);
        log("?vista=escritorio en Android fuerza la pagina clasica", forzarEscritorio.texto.includes("<title>Mi cuenta -- Nexo Market</title>"));

        const forzarApp = await pedir("/market/mi-cuenta?vista=app", UA_DESKTOP);
        log("?vista=app en desktop fuerza el wizard movil", forzarApp.texto.includes("<title>Mi cuenta -- Nexo</title>"));

        // 4. Persona logueada (movil) -> home + drawer, sin las 10 pantallas de auth
        const persona = await crearPersonaPrueba("wizard-shell");
        personaId = persona.id;
        const token = await mintearSesionPruebaPersona(persona.id);

        const movilLogueado = await pedir("/market/mi-cuenta", UA_ANDROID, token);
        log("Android logueado responde 200", movilLogueado.status === 200);
        log("Android logueado trae data-screen=\"home\"", movilLogueado.texto.includes('data-screen="home"'));
        log("Android logueado trae el drawer (wizardDrawerOverlay)", movilLogueado.texto.includes('id="wizardDrawerOverlay"'));
        log("Android logueado NO repite las pantallas de auth (bienvenida)", !movilLogueado.texto.includes('data-screen="bienvenida"'));
        log("Android logueado saluda con el nombre real de la persona", movilLogueado.texto.includes(persona.nombre));
    } catch (error) {
        console.error("Error inesperado durante la prueba:", error);
        errorInesperado = true;
    } finally {
        await borrarPersonaPrueba(personaId);
    }

    console.log(`\n${(fallos === 0 && !errorInesperado) ? "TODAS LAS PRUEBAS PASARON" : `${fallos} PRUEBA(S) FALLARON`}`);
    process.exit((fallos === 0 && !errorInesperado) ? 0 : 1);
})();
