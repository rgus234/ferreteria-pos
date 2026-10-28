// Pagina publica de Nexo (public/site): presentacion de un producto en
// desarrollo, SIN precios ni planes, con el estado real de cada funcion.
//
// Lo que se protege:
//  - no vuelven a aparecer precios, promociones ni botones de contratacion;
//  - la gente que ya usa Nexo sigue pudiendo iniciar sesion;
//  - los formularios siguen apuntando a los endpoints que existen y el mensaje
//    armado nunca pasa del limite de 500 caracteres del backend;
//  - todos los enlaces internos (#...) llevan a una seccion que existe;
//  - cada etiqueta de estado trae TEXTO (no depende solo del color);
//  - el servidor entrega la pagina en el dominio comercial.

const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");
const { iniciarServidorPrueba, detenerServidorPrueba, BASE_URL } = require("./helpers/servidor-prueba");

const RAIZ = path.join(__dirname, "..", "public", "site");
const leer = nombre => fs.readFileSync(path.join(RAIZ, nombre), "utf8");

const inicio = leer("index.html");
const nexoIa = leer("nexo-ia.html");

// Quita <script>, <style> y comentarios: el texto que ve la persona.
function textoVisible(html) {
    return html
        .replace(/<script[\s\S]*?<\/script>/gi, " ")
        .replace(/<style[\s\S]*?<\/style>/gi, " ")
        .replace(/<!--[\s\S]*?-->/g, " ");
}

before(async () => { await iniciarServidorPrueba(); });
after(async () => { await detenerServidorPrueba(); });

test("la pagina publica no muestra precios, promociones ni planes", () => {
    for (const [nombre, html] of [["index.html", inicio], ["nexo-ia.html", nexoIa]]) {
        const visible = textoVisible(html);

        assert.doesNotMatch(visible, /\$\s?\d[\d,]*(\.\d\d)?\s*\/\s*mes/i, `${nombre}: precio mensual`);
        assert.doesNotMatch(visible, /precio fundador|40% de descuento|ahorras \$/i, `${nombre}: promocion`);
        assert.doesNotMatch(visible, /comenzar gratis|prueba gratis|solicitar licencia gratis/i, `${nombre}: llamado a contratar`);
        assert.doesNotMatch(visible, /\b(plan|planes)\s+(basico|plus|pro)\b/i, `${nombre}: menciona planes de pago`);
        assert.doesNotMatch(html, /class="plans"|pricing-tabla|plan-modal|plan-detalles-btn/, `${nombre}: marcado de planes`);
        assert.doesNotMatch(html, /\/api\/planes-publico|\/api\/fundador-publico/, `${nombre}: consulta de planes`);
    }
});

test("ya no hay testimonios atribuidos a clientes", () => {
    assert.doesNotMatch(inicio, /<blockquote|class="quotes"|class="testimonials"/);
});

test("el mensaje principal y los dos botones principales", () => {
    // El titular general se conserva: data-giro-campo solo lo cambia con JavaScript, cuando el visitante elige su giro.
    assert.match(inicio, /<h1[^>]*>Tu negocio\. Todo conectado\.<\/h1>/);
    assert.match(inicio, /En desarrollo activo &middot; Pruebas con negocios reales/);
    assert.match(inicio, /<a class="btn primary" href="#ecosistema">Conoce Nexo<\/a>/);
    assert.match(inicio, /<a class="btn secondary" href="#participa"[^>]*>Participa en las pruebas<\/a>/);
});

test("los usuarios existentes conservan el acceso para iniciar sesion", () => {
    for (const html of [inicio, nexoIa, leer("terminos.html"), leer("privacidad.html"), leer("reembolsos.html")]) {
        assert.match(html, /href="https:\/\/app\.nexoposoficial\.com\/\?accion=iniciar-sesion"[^>]*>Iniciar sesion<\/a>/);
    }
});

test("todos los enlaces internos (#...) llevan a una seccion que existe", () => {
    const ids = new Set([...inicio.matchAll(/\bid="([^"]+)"/g)].map(m => m[1]));
    const anclas = [...new Set([...inicio.matchAll(/href="#([^"]+)"/g)].map(m => m[1]))];

    assert.ok(anclas.length > 5);
    for (const ancla of anclas) {
        assert.ok(ids.has(ancla), `el enlace #${ancla} no tiene destino`);
    }
});

test("los enlaces de las otras paginas hacia la principal siguen funcionando", () => {
    const ids = new Set([...inicio.matchAll(/\bid="([^"]+)"/g)].map(m => m[1]));

    for (const html of [nexoIa, leer("terminos.html"), leer("privacidad.html"), leer("reembolsos.html")]) {
        for (const m of html.matchAll(/href="\/#([^"]+)"/g)) {
            assert.ok(ids.has(m[1]), `/#${m[1]} no existe en la pagina principal`);
        }
    }

    // Enlaces de otros modulos del sistema (Market, correos) que apuntan al sitio.
    for (const viejo of ["contacto", "planes"]) {
        assert.ok(ids.has(viejo), `se conserva el ancla #${viejo} para enlaces ya publicados`);
    }
});

test("cada etiqueta de estado trae texto, no solo color", () => {
    const etiquetas = [...inicio.matchAll(/<span class="estado (estado-[a-z]+)">([\s\S]*?)<\/span>/g)];
    assert.ok(etiquetas.length >= 20, "las funciones llevan su estado");

    for (const [, clase, contenido] of etiquetas) {
        const texto = contenido.replace(/<i[^>]*>[\s\S]*?<\/i>/g, "").replace(/&[a-z#0-9]+;/gi, "").trim();
        assert.ok(texto.length >= 4, `${clase} sin texto`);
    }

    for (const estado of ["Disponible", "Beta", "En desarrollo", "En planificación"]) {
        assert.ok(inicio.includes(estado), `falta la etiqueta ${estado}`);
    }
});

test("los estados reflejan lo verificado: factura y pagos de Market no se presentan como disponibles", () => {
    const seccionFactura = inicio.match(/<h3>Factura electrónica<\/h3>/);
    assert.ok(seccionFactura);

    const bloqueFactura = inicio.slice(inicio.lastIndexOf("<article>", seccionFactura.index), seccionFactura.index);
    assert.match(bloqueFactura, /estado-desarrollo/, "factura electronica: en desarrollo");

    assert.doesNotMatch(textoVisible(inicio), /comisi[oó]n|(?<![%A-Za-z0-9])[36]\s?%(?![0-9A-Fa-f])/i, "no se publican comisiones");
    assert.doesNotMatch(inicio, /nunca guardamos tu llave/i, "afirmacion no verificada");
    assert.doesNotMatch(textoVisible(inicio), /sin inventar n[uú]meros/i);

    const precio = inicio.match(/id="precio-inteligente"[\s\S]*?<\/section>/)[0];
    assert.match(precio, /estado-desarrollo/);
    assert.doesNotMatch(precio, /estado-beta|estado-disponible/);
});

test("el formulario de participacion usa el endpoint existente y respeta el limite de 500", () => {
    assert.match(inicio, /fetch\("\/api\/contacto-landing"/);
    assert.match(inicio, /id="contactoCorreo"[^>]*required/, "el correo es obligatorio: ahi llega la invitacion");

    for (const id of ["contactoNombre", "contactoNegocio", "contactoGiro", "contactoCiudad", "contactoTelefono", "contactoCorreo", "contactoSistema", "contactoProblema", "contactoMensaje", "contactoEmpresaWeb"]) {
        assert.match(inicio, new RegExp(`id="${id}"`), `falta el campo ${id}`);
    }

    const maxlength = id => Number(inicio.match(new RegExp(`id="${id}"[^>]*maxlength="(\\d+)"`))[1]);
    const peorCaso =
        "Giro: Refaccionaria | ".length +
        "Ciudad: ".length + maxlength("contactoCiudad") + 3 +
        "Sistema actual: ".length + maxlength("contactoSistema") + 3 +
        "Problema: ".length + maxlength("contactoProblema") + 3 +
        "Mensaje: ".length + maxlength("contactoMensaje");

    assert.ok(peorCaso <= 500, `el mensaje armado podria medir ${peorCaso} caracteres (limite 500)`);
});

test("el formulario solo confirma el envio cuando el servidor respondio que si", () => {
    const bloque = inicio.slice(inicio.indexOf('fetch("/api/contacto-landing"'));
    const iExito = bloque.indexOf("Recibimos tu solicitud");
    const iValidacion = bloque.indexOf("if (!response.ok || data.ok === false)");

    assert.ok(iValidacion > 0 && iExito > iValidacion, "el mensaje de exito va DESPUES de validar la respuesta");
});

test("ya no hay registro abierto en la pagina publica: solo se pide participar", () => {
    assert.doesNotMatch(inicio, /registroClienteForm|clientes\/registro|panelCuenta|Ya tengo mi invitaci/);
    assert.doesNotMatch(inicio, /type="password"/, "la pagina publica no pide contrasenas");
    assert.equal((inicio.match(/<form /g) || []).length, 1, "un solo formulario");
    assert.match(inicio, /id="contactoLeadForm"/);

    // El registro en si NO se elimino del servidor: lo usaran las invitaciones.
    const servidor = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8");
    assert.match(servidor, /app\.post\("\/api\/clientes\/registro"/);
});

test("metadatos para buscadores y vista previa al compartir", () => {
    assert.match(inicio, /<title>Nexo POS — Tu negocio\. Todo conectado\.<\/title>/);
    assert.match(inicio, /name="description" content="[^"]*desarrollo activo/);
    assert.match(inicio, /property="og:title"/);
    assert.match(inicio, /property="og:description"/);
    assert.match(inicio, /property="og:image" content="https:\/\/nexoposoficial\.com\/nexo-pos-logo\.jpg"/);
    assert.match(inicio, /rel="canonical" href="https:\/\/nexoposoficial\.com\/"/);
    assert.doesNotMatch(inicio, /l[ií]der del mercado|cientos de clientes|resultados garantizados/i);
});

test("las imagenes y hojas que usa la pagina existen", () => {
    const publico = path.join(__dirname, "..", "public");
    const recursos = new Set([...inicio.matchAll(/(?:src|href)="(\/[^"#?]+\.(?:jpg|png|css|js|svg))"/g)].map(m => m[1]));

    for (const recurso of recursos) {
        assert.ok(fs.existsSync(path.join(publico, recurso)), `no existe ${recurso}`);
    }
});

function pedirConHost(ruta, host) {
    const destino = new URL(BASE_URL);

    return new Promise((resolver, rechazar) => {
        const peticion = http.request({ host: destino.hostname, port: destino.port, path: ruta, method: "GET", headers: { Host: host } }, respuesta => {
            let cuerpo = "";
            respuesta.on("data", trozo => { cuerpo += trozo; });
            respuesta.on("end", () => resolver({ status: respuesta.statusCode, cuerpo }));
        });
        peticion.on("error", rechazar);
        peticion.end();
    });
}

test("el servidor entrega la pagina nueva en el dominio comercial y en /site", async () => {
    const raiz = await pedirConHost("/", "nexoposoficial.com");
    assert.equal(raiz.status, 200);
    assert.match(raiz.cuerpo, /Tu negocio\. Todo conectado\./);
    assert.doesNotMatch(raiz.cuerpo, /Precio fundador/);

    const sitio = await pedirConHost("/site/", "nexoposoficial.com");
    assert.equal(sitio.status, 200);
    assert.match(sitio.cuerpo, /id="participa"/);

    const estilos = await pedirConHost("/site/styles.css", "nexoposoficial.com");
    assert.equal(estilos.status, 200);
    assert.match(estilos.cuerpo, /\.estado-disponible/);
});

test("la pagina de Nexo IA se sirve y muestra su estado", async () => {
    const respuesta = await pedirConHost("/nexo-ia", "nexoposoficial.com");
    assert.equal(respuesta.status, 200);
    assert.match(respuesta.cuerpo, /estado-beta/);
    assert.match(respuesta.cuerpo, /Participa en las pruebas/);
});

test("la pagina explica la prueba: dias, cuota, para que es el dinero y un ejemplo (mismo texto que el correo)", () => {
    const { DIAS_PRUEBA_PILOTO, CUOTA_MENSUAL_PILOTO, QUE_CUBRE_CUOTA, ejemploCondiciones } = require("../piloto-condiciones");
    const ej = ejemploCondiciones();
    const seccion = inicio.match(/<section id="prueba"[\s\S]*?<\/section>/);

    assert.ok(seccion, "falta la seccion #prueba");
    assert.ok(seccion[0].includes(`${DIAS_PRUEBA_PILOTO} días sin costo`), "dias de prueba");
    assert.ok(seccion[0].includes(`$${CUOTA_MENSUAL_PILOTO} al mes`), "cuota mensual");
    assert.ok(seccion[0].includes(QUE_CUBRE_CUOTA), "para que es el dinero");
    assert.ok(seccion[0].includes(ej.inicio) && seccion[0].includes(ej.fin), "ejemplo con fechas");
    assert.match(seccion[0], /no pagas nada/i, "si no quiere seguir, no paga");
    assert.match(seccion[0], /Te avisamos antes de que termine/);
});

test("el correo de invitacion y el de confirmacion traen las mismas condiciones y ya no hablan de planes ni PDF", () => {
    const correo = fs.readFileSync(path.join(__dirname, "..", "email.js"), "utf8");
    const bloque = correo.match(/function condicionesPilotoHtml\([^)]*\)[\s\S]*?\n}\r?\n/);
    assert.ok(bloque, "falta condicionesPilotoHtml");
    assert.match(bloque[0], /DIAS_PRUEBA_PILOTO/);
    assert.ok(bloque[0].includes("$${CUOTA_MENSUAL_PILOTO} al mes"), "cuota mensual");
    assert.match(bloque[0], /Ejemplo:/);

    const invitacion = correo.match(/function enviarCorreoInvitacionPiloto\([\s\S]*?\n}\r?\n/)[0];
    assert.match(invitacion, /condicionesPilotoHtml\(correo\)/);

    const confirmacion = correo.match(/async function enviarCorreoConfirmacionLead\([\s\S]*?\n}\r?\n/)[0];
    assert.match(confirmacion, /condicionesPilotoHtml\(correo\)/);
    assert.doesNotMatch(confirmacion, /cajaPreciosFundadorHtml|generarFichaInformativaPdf|planes y precios/);
});

test("Pagina publica: seccion de computadora, tablet y celular con capturas reales de la app", () => {
    const fs = require("node:fs");
    const path = require("node:path");
    const html = fs.readFileSync(path.join(__dirname, "..", "public", "site", "index.html"), "utf8");
    const seccion = html.slice(html.indexOf('<section id="movil"'), html.indexOf('<section id="nexo-ia"'));

    assert.match(seccion, /computadora, tablet y celular/i);
    assert.match(seccion, /escáner/i, "anuncia el celular como escaner");
    assert.match(seccion, /datos de ejemplo/i, "las capturas se declaran con datos de ejemplo");
    assert.match(html, /href="#movil"/, "acceso desde el menu");

    const imagenes = [...seccion.matchAll(/src="(\/site\/img\/[^"]+)"/g)].map(m => m[1]);
    assert.ok(imagenes.length >= 5, "capturas de celular y tablet");

    for (const ruta of imagenes) {
        assert.ok(fs.existsSync(path.join(__dirname, "..", "public", ruta)), `existe ${ruta}`);
    }

    for (const img of seccion.match(/<img [^>]+>/g)) {
        assert.match(img, /alt="[^"]{10,}"/, "cada imagen con texto alternativo");
        assert.match(img, /width="\d+" height="\d+"/, "con tamaño para que no salte la pagina");
    }
});
