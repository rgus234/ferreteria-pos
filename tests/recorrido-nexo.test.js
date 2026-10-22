// Recorrido de bienvenida del negocio nuevo (bienvenida -> inicio de sesion ->
// perfil -> asistente -> listo), con la mascota como guia.
//
// Lo que se protege (son pruebas de estructura: el comportamiento visual se
// reviso en el navegador):
//  - lo primero que ve un equipo sin negocio es la bienvenida, no el formulario
//    viejo que solo guarda datos locales (ese queda escondido, no borrado);
//  - la bienvenida ofrece iniciar sesion y pedir invitacion, y es la etapa 1 de 4;
//  - todos los pasos del asistente tienen su gesto y su frase, y cada gesto
//    tiene imagen transparente;
//  - el boton "Iniciar sesion" de la pagina publica abre el acceso por correo
//    aunque el equipo ya este vinculado a otro negocio;
//  - los archivos nuevos se cargan (con version para que no se quede el cache).

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const publico = path.join(__dirname, "..", "public");
const leer = ruta => fs.readFileSync(path.join(publico, ruta), "utf8");

const indice = leer("index.html");
const recorrido = leer("js/recorrido-nexo.js");
const asistente = leer("js/asistente-inicio.js");
const configAuth = leer("js/config-auth.js");

test("un equipo sin negocio ve la bienvenida; el formulario viejo queda escondido, no borrado", () => {
    const bloque = indice.match(/<div id="configuracionInicial"[\s\S]*?<div class="setup-shell">/);
    assert.ok(bloque, "la bienvenida va dentro de #configuracionInicial, antes del formulario viejo");
    assert.match(bloque[0], /id="rnBienvenida"/);
    assert.match(bloque[0], /data-rn-etapas="1"/, "es la etapa 1 de 4");
    assert.match(bloque[0], /recorridoNexo\.iniciarSesion\(\)/);
    assert.match(bloque[0], /recorridoNexo\.quieroParticipar\(\)/);
    assert.match(bloque[0], /celebrando-transparente\.png/, "la mascota da la bienvenida");
    assert.match(bloque[0], /45 días sin costo/, "dice de entrada que la prueba no cuesta");

    // El formulario viejo sigue en el documento (sus ids los usa config-auth.js).
    assert.match(indice, /id="setupNombreNegocio"/);
    assert.match(leer("css/components/recorrido-nexo.css"), /#configuracionInicial:not\(\.rn-avanzado\) > \.setup-shell\s*\{\s*display: none/);
});

test("el perfil del administrador es la etapa 2 y la mascota lo acompana", () => {
    const perfil = indice.match(/<div id="loginCrearPerfilInicial"[\s\S]*?<h1 class="login-form-titulo">/);
    assert.ok(perfil);
    assert.match(perfil[0], /data-rn-etapas="2"/);
    assert.match(perfil[0], /rn-saludo-perfil/);
});

test("cada paso del asistente tiene su gesto y su frase, y cada gesto tiene su imagen", () => {
    const pasos = asistente.match(/const ASISTENTE_PASOS = \[([^\]]+)\]/)[1].match(/"(\w+)"/g).map(p => p.replace(/"/g, ""));
    assert.ok(pasos.length >= 6, `pasos: ${pasos}`);

    const escenas = recorrido.match(/const ESCENAS_ASISTENTE = \{[\s\S]*?\n {1}\};/)[0];

    for (const paso of pasos) {
        assert.match(escenas, new RegExp(`${paso}: \\{ gesto: "\\w+", frase: "[^"]{15,}"`), `falta la escena de "${paso}"`);
    }

    const gestos = new Set([...escenas.matchAll(/gesto: "(\w+)"/g)].map(m => m[1]));
    for (const gesto of gestos) {
        assert.ok(fs.existsSync(path.join(publico, "img", "nexo-ia", `${gesto}-transparente.png`)), `falta la imagen ${gesto}-transparente.png`);
    }
});

test("el asistente monta el panel de la mascota, las etapas y avisa al recorrido en cada paso", () => {
    assert.match(asistente, /id="asistenteMascotaGrande"/);
    assert.match(asistente, /id="asistenteBurbuja"/);
    assert.match(asistente, /id="asistenteEtapas"/);
    assert.match(asistente, /recorridoNexo\.actualizarEscenaAsistente\(paso\)/);
    // El paso final celebra con confeti y es la etapa 4.
    assert.match(recorrido, /paso === "listo" \? 4 : 3/);
    assert.match(recorrido, /if \(paso === "listo"\) confeti\(/);
});

test("las animaciones respetan a quien pidio menos movimiento", () => {
    const css = leer("css/components/recorrido-nexo.css");
    assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
    assert.match(recorrido, /prefers-reduced-motion: reduce/);
});

test("'Iniciar sesion' de la pagina publica abre el acceso por correo aunque el equipo ya este vinculado", () => {
    const sitio = fs.readFileSync(path.join(publico, "site", "index.html"), "utf8");
    assert.match(sitio, /app\.nexoposoficial\.com\/\?accion=iniciar-sesion/);

    // Rama del equipo ya vinculado (despues de mostrar la pantalla de entrada).
    assert.match(configAuth, /mostrarPantallaDeEntradaPOS\(\);[\s\S]{0,400}consumirAccionIniciarSesion\(\)[\s\S]{0,120}abrirBuscarNegocioSetup\(\)/);

    // Se usa UNA sola vez: se quita de la direccion, o tras iniciar sesion el cuadro volveria a salir.
    const consumir = configAuth.match(/function consumirAccionIniciarSesion\(\) \{[\s\S]*?\n\}/)[0];
    assert.match(consumir, /accion"\) !== "iniciar-sesion"\) return false/);
    assert.match(consumir, /parametros\.delete\("accion"\)/);
    assert.match(consumir, /history\.replaceState/);
    assert.equal((configAuth.match(/consumirAccionIniciarSesion\(\)/g) || []).length, 3, "definicion + las dos ramas");
});

test("los archivos nuevos se cargan, en orden y con version", () => {
    assert.match(indice, /css\/components\/recorrido-nexo\.css\?v=/);
    assert.match(indice, /js\/recorrido-nexo\.js\?v=/);
    assert.ok(indice.indexOf("js/recorrido-nexo.js") < indice.indexOf("js/config-auth.js"), "recorrido-nexo.js se carga antes que config-auth.js");
    assert.ok(indice.indexOf("asistente-inicio.css") < indice.indexOf("recorrido-nexo.css"), "el recorrido ajusta al asistente, no al reves");

    for (const archivo of ["js/recorrido-nexo.js", "css/components/recorrido-nexo.css"]) {
        assert.ok(fs.existsSync(path.join(publico, archivo)), archivo);
    }
});
