// "¿Qué negocio tienes?": la eleccion (ferreteria, abarrotes o ambos) define lo que se muestra
// desde el sitio hasta la descarga, y "ambos" crea una cuenta con las dos cosas.
//
// Lo que se protege:
//  - una sola fuente de contenido por giro, con estados honestos (lo nuevo no se vende como probado);
//  - el sitio pregunta al entrar y la pagina general sigue intacta sin JavaScript;
//  - "ambos" viaja formulario -> invitacion -> cuenta: programa completo + las dos categorias activas;
//  - la invitacion, la pantalla de "tu negocio esta listo", la descarga y el correo hablan del giro elegido.

const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { CONTENIDO, CLAVES, normalizar } = require("../public/site/giro-contenido.js");
const { pool, borrarNegocioPrueba } = require("./helpers/negocio-prueba");
const { iniciarServidorPrueba, detenerServidorPrueba, BASE_URL } = require("./helpers/servidor-prueba");

const leer = ruta => fs.readFileSync(path.join(__dirname, "..", ruta), "utf8");
const ADMIN = { "x-admin-key": process.env.ADMIN_KEY, "Content-Type": "application/json" };
const SUFIJO = String(Date.now());
const contactos = [];

test("el giro se entiende de texto libre y 'ambos' es ferreteria mas abarrotes", () => {
    assert.equal(normalizar("Ferretería"), "ferreteria");
    assert.equal(normalizar("abarrotes"), "abarrotes");
    assert.equal(normalizar("Ferretería y abarrotes (ambos)"), "ambos");
    assert.equal(normalizar("ambos"), "ambos");
    assert.equal(normalizar("Papelería"), null, "otros giros no cambian la pagina");
    assert.equal(normalizar(""), null);
    assert.deepEqual(CLAVES, ["ferreteria", "abarrotes", "ambos"]);
});

test("cada giro trae su contenido completo y lo nuevo se marca como nuevo, no como probado", () => {
    for (const clave of CLAVES) {
        const c = CONTENIDO[clave];

        for (const campo of ["nombre", "icono", "detalle", "eyebrow", "titular", "copia", "seccionTitulo", "sigue", "correo", "ejemploNegocio"]) {
            assert.ok(c[campo], `${clave} no tiene ${campo}`);
        }

        assert.ok(c.funciones.length >= 3);
        assert.equal(c.primerosPasos.length, 3);
    }

    // Las herramientas de abarrotes se acaban de construir: no se prometen como probadas en uso real.
    const estadosAbarrotes = CONTENIDO.abarrotes.funciones.map(f => f.estado);
    assert.ok(estadosAbarrotes.includes("Nuevo"));
    assert.match(CONTENIDO.abarrotes.copia, /nuevas y las estamos probando/);
    assert.ok(CONTENIDO.ferreteria.funciones.every(f => f.estado === "Disponible"));
    assert.match(CONTENIDO.ambos.copia, /nuevas y las estamos probando/);
});

test("el sitio pregunta al entrar, se adapta y sin JavaScript queda la pagina general de siempre", () => {
    const html = leer("public/site/index.html");
    const js = leer("public/site/site-giro.js");

    assert.match(html, /<body data-giro-elegir>/);
    assert.match(html, /giro-contenido\.js[^>]*defer/);
    assert.match(html, /site-giro\.js[^>]*defer/);

    // La pagina general se conserva (titulo, copia y vista previa) para quien no elige o no tiene JavaScript.
    assert.match(html, /<h1 data-giro-campo="titular">Tu negocio\. Todo conectado\.<\/h1>/);
    assert.match(html, /data-solo="abarrotes" hidden/, "la vista previa de abarrotes solo sale a quien eligio abarrotes");
    assert.match(html, /data-solo="general ferreteria ambos"/);
    assert.match(html, /id="giroSeccion"/);
    assert.match(html, /<option value="Ferretería y abarrotes \(ambos\)">/);

    // Pregunta, recuerda, se puede cambiar y viaja por enlace.
    assert.match(js, /¿Qué negocio tienes\?/);
    assert.match(js, /nexoSitioGiro/);
    assert.match(js, /new URLSearchParams\(location\.search\)\.get\("giro"\)/);
    assert.match(js, /Solo quiero mirar/);
    assert.match(js, /Tu negocio: /);
    assert.match(js, /try \{ return localStorage\.getItem/, "el almacenamiento puede fallar y no debe romper la pagina");
});

test("la pagina de descarga y el correo de invitacion tambien hablan segun el giro", () => {
    const servidor = leer("server.js");
    const correo = leer("email.js");

    assert.match(servidor, /class="descarga-giro" data-solo="ferreteria abarrotes ambos" hidden/);
    assert.match(servidor, /<ol class="registro-pasos" data-giro-pasos><\/ol>/);
    assert.match(servidor, /\/site\/site-giro\.js/);

    assert.match(correo, /enviarCorreoInvitacionPiloto\(\{ correo, nombre, negocio, enlace, vigenciaDias, giro \}\)/);
    assert.match(correo, /CONTENIDO\[giro\]/);
});

// ---------------------------------------------------------------------
// Flujo completo con "ambos" (formulario -> invitacion -> cuenta)
// ---------------------------------------------------------------------

async function solicitud(giroTexto) {
    const fila = await pool.query(
        `INSERT INTO public.contactos_landing (nombre, negocio, telefono, correo, mensaje, ip)
         VALUES ('Prueba Giro', $1, '4420000000', $2, $3, '127.0.0.1') RETURNING id`,
        [`Test Giro ${SUFIJO}`, `test-inv-giro-${giroTexto.length}-${SUFIJO}@example.com`, `Giro: ${giroTexto} | Ciudad: Rio Grande`]
    );
    contactos.push(fila.rows[0].id);
    return fila.rows[0].id;
}

async function invitar(id) {
    const r = await fetch(`${BASE_URL}/admin/api/solicitudes-participacion/${id}/invitar`, { method: "POST", headers: ADMIN, body: JSON.stringify({ sinCorreo: true }) });
    return (await r.json()).enlace;
}

const tokenDe = enlace => enlace.split("/invitacion/")[1];

before(async () => { await iniciarServidorPrueba(); });

after(async () => {
    const negocios = await pool.query(`SELECT id FROM public.negocios WHERE correo LIKE $1`, [`test-inv-giro-%${SUFIJO}%@example.com`]);
    for (const fila of negocios.rows) await borrarNegocioPrueba(fila.id);

    if (contactos.length) {
        await pool.query(`DELETE FROM public.invitaciones_piloto WHERE contacto_id = ANY($1::int[])`, [contactos]);
        await pool.query(`DELETE FROM public.contactos_landing WHERE id = ANY($1::int[])`, [contactos]);
    }

    await detenerServidorPrueba();
    await pool.end();
});

test("quien eligio 'ambos' recibe una invitacion de ambos, y su cuenta nace con ferreteria completa mas abarrotes", async () => {
    const id = await solicitud("Ferretería y abarrotes (ambos)");
    const enlace = await invitar(id);
    const token = tokenDe(enlace);

    const guardado = (await pool.query(`SELECT giro FROM public.invitaciones_piloto WHERE contacto_id = $1 AND estado = 'pendiente'`, [id])).rows[0];
    assert.equal(guardado.giro, "ambos");

    // La invitacion ya habla de su giro y trae el selector con "ambos" elegido.
    const pagina = await (await fetch(`${BASE_URL}/invitacion/${token}`)).text();
    assert.match(pagina, /<body data-giro-forzado="ambos">/);
    assert.match(pagina, /id="invPerfil"/);
    assert.match(pagina, /<option value="ambos" selected>/);
    assert.match(pagina, /\/site\/site-giro\.js/);

    const configurar = await fetch(`${BASE_URL}/api/invitaciones/${token}/configurar`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            nombreNegocio: `Test Giro ${SUFIJO}`, giro: "ambos", nombreContacto: "Prueba Giro", telefono: "4420000000", ciudad: "Rio Grande",
            password: "ContrasenaSegura1", confirmarPassword: "ContrasenaSegura1", aceptaTerminos: true
        })
    });
    assert.equal(configurar.status, 201);

    const negocio = (await pool.query(`SELECT id, giro FROM public.negocios WHERE correo = $1`, [`test-inv-giro-${"Ferretería y abarrotes (ambos)".length}-${SUFIJO}@example.com`])).rows[0];
    assert.equal(negocio.giro, "ferreteria", "el tipo principal es ferreteria: el programa completo");

    const giros = (await pool.query(`SELECT giro FROM public.negocio_giros WHERE negocio_id = $1 AND activo ORDER BY giro`, [negocio.id])).rows.map(f => f.giro);
    assert.deepEqual(giros, ["abarrotes", "ferreteria"], "las dos categorias quedan activas");

    // Ya configurada: la pantalla de "tu negocio esta listo" muestra su primera semana, hasta la descarga.
    const lista = await (await fetch(`${BASE_URL}/invitacion/${token}`)).text();
    assert.match(lista, /<body data-giro-forzado="ambos">/);
    assert.match(lista, /id="invPrimerosPasos"/);
    assert.match(lista, /data-giro-pasos/);
});

test("quien eligio abarrotes recibe todo en abarrotes, y la descarga se adapta", async () => {
    const id = await solicitud("Abarrotes");
    const token = tokenDe(await invitar(id));

    assert.equal((await pool.query(`SELECT giro FROM public.invitaciones_piloto WHERE contacto_id = $1 AND estado = 'pendiente'`, [id])).rows[0].giro, "abarrotes");
    assert.match(await (await fetch(`${BASE_URL}/invitacion/${token}`)).text(), /<body data-giro-forzado="abarrotes">/);

    const descarga = await (await fetch(`${BASE_URL}/descargar?giro=abarrotes`)).text();
    assert.match(descarga, /class="descarga-giro"/);
    assert.match(descarga, /\/site\/giro-contenido\.js/);
    assert.match(descarga, /\/site\/site-giro\.js/);
});

test("el correo de confirmacion de la solicitud habla del giro que eligio, no 'ferreterias' para todos", () => {
    const { descripcionPorGiro } = require("../email.js");
    const servidor = leer("server.js");

    assert.equal(descripcionPorGiro("Ferretería").para, "ferreterias");
    assert.equal(descripcionPorGiro("Abarrotes").para, "tiendas de abarrotes");
    assert.equal(descripcionPorGiro("Ferretería y abarrotes (ambos)").para, "quien tiene ferreteria y tienda");
    assert.equal(descripcionPorGiro("Papelería").para, "negocios como el tuyo", "otros giros: texto general, sin inventar");
    assert.equal(descripcionPorGiro("").para, "negocios como el tuyo");

    // Lo nuevo de abarrotes se dice como nuevo y en pruebas, tambien en el correo.
    assert.match(descripcionPorGiro("Abarrotes").incluye, /nuevas y las estamos probando/);
    assert.match(descripcionPorGiro("Ferretería").incluye, /cotizaciones/);
    assert.ok(descripcionPorGiro("Abarrotes").lineaPerfil);

    // El giro sale de "Giro: X | ..." dentro del mensaje, en cualquier posicion.
    const sacar = mensaje => (/(?:^|\|\s*)Giro:\s*([^|]+)/i.exec(mensaje) || [])[1];
    assert.equal(sacar("Giro: Abarrotes | Ciudad: Rio Grande").trim(), "Abarrotes");
    assert.equal(sacar("Ciudad: X | Giro: Ferretería y abarrotes (ambos) | Mensaje: hola").trim(), "Ferretería y abarrotes (ambos)");
    assert.equal(sacar("Ciudad: X"), undefined);
    assert.match(servidor, /enviarCorreoConfirmacionLead\(correo, nombre, giroElegido\.trim\(\)\)/);
});
