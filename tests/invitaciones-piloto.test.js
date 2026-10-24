// Invitaciones a negocios piloto: solicitud -> el admin acepta -> enlace
// personal -> el negocio configura su cuenta -> descarga.
//
// Lo que se protege:
//  - solo el admin acepta/descarta solicitudes;
//  - el token no se guarda en claro y el enlace es de un solo uso para configurar;
//  - la cuenta nace con licencia de prueba que vence a los 45 dias, correo ya verificado,
//    y el correo SIEMPRE es el de la invitacion (nunca el que mande el cliente);
//  - despues de configurar, el mismo enlace solo muestra la descarga y nunca
//    vuelve a pedir datos (configurar en el celular, abrir en la PC);
//  - dos envios a la vez no crean dos negocios;
//  - enlaces revocados, vencidos o inventados no sirven;
//  - un correo que no salio nunca se anuncia como enviado.

// Sin llave de correo el servidor de prueba NO manda correos reales (los
// existentes en .env no se sobreescriben porque la variable ya esta definida).
process.env.RESEND_API_KEY = "";

const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { pool, borrarNegocioPrueba } = require("./helpers/negocio-prueba");
const { iniciarServidorPrueba, detenerServidorPrueba, BASE_URL } = require("./helpers/servidor-prueba");
const { verificarPassword } = require("../password-utils");

const ADMIN = { "x-admin-key": process.env.ADMIN_KEY, "Content-Type": "application/json" };
const SUFIJO = String(Date.now());
const contactosCreados = [];
const negociosCreados = [];

async function crearSolicitud({ nombre = "Prueba Piloto", negocio = `Test Auto Invitacion ${SUFIJO}`, correo, telefono = "4420000000", mensaje = "Giro: Ferretería | Ciudad: Rio Grande, Zac. | Sistema actual: Libreta | Problema: Inventario" }) {
    const fila = await pool.query(
        `INSERT INTO public.contactos_landing (nombre, negocio, telefono, correo, mensaje, ip)
         VALUES ($1, $2, $3, $4, $5, '127.0.0.1') RETURNING id`,
        [nombre, negocio, telefono, correo, mensaje]
    );
    contactosCreados.push(fila.rows[0].id);
    return fila.rows[0].id;
}

async function invitar(id, headers = ADMIN) {
    const respuesta = await fetch(`${BASE_URL}/admin/api/solicitudes-participacion/${id}/invitar`, { method: "POST", headers });
    return { status: respuesta.status, cuerpo: await respuesta.json() };
}

function tokenDe(enlace) {
    return enlace.split("/invitacion/")[1];
}

function configurar(token, extra = {}) {
    return fetch(`${BASE_URL}/api/invitaciones/${token}/configurar`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            nombreNegocio: `Test Auto Invitacion ${SUFIJO}`,
            giro: "ferreteria",
            nombreContacto: "Prueba Piloto",
            telefono: "4420000000",
            ciudad: "Rio Grande",
            password: "ContrasenaSegura1",
            confirmarPassword: "ContrasenaSegura1",
            aceptaTerminos: true,
            ...extra
        })
    });
}

before(async () => { await iniciarServidorPrueba(); });

after(async () => {
    const negocios = await pool.query(`SELECT id FROM public.negocios WHERE correo LIKE $1`, [`test-inv-%${SUFIJO}%@example.com`]);
    for (const fila of negocios.rows) await borrarNegocioPrueba(fila.id);
    for (const id of negociosCreados) await borrarNegocioPrueba(id).catch(() => {});

    if (contactosCreados.length) {
        await pool.query(`DELETE FROM public.invitaciones_piloto WHERE contacto_id = ANY($1::int[])`, [contactosCreados]);
        await pool.query(`DELETE FROM public.contactos_landing WHERE id = ANY($1::int[])`, [contactosCreados]);
    }

    await detenerServidorPrueba();
    await pool.end();
});

test("solo el admin puede ver, aceptar o descartar solicitudes", async () => {
    const id = await crearSolicitud({ correo: `test-inv-admin-${SUFIJO}@example.com` });

    const lista = await fetch(`${BASE_URL}/admin/api/solicitudes-participacion`);
    assert.ok([401, 403].includes(lista.status), `sin llave debe rechazar (fue ${lista.status})`);

    const sinLlave = await invitar(id, { "Content-Type": "application/json" });
    assert.ok([401, 403].includes(sinLlave.status));

    const descartar = await fetch(`${BASE_URL}/admin/api/solicitudes-participacion/${id}/descartar`, { method: "POST" });
    assert.ok([401, 403].includes(descartar.status));

    const sigue = await pool.query(`SELECT descartada FROM public.contactos_landing WHERE id = $1`, [id]);
    assert.equal(sigue.rows[0].descartada, false, "sin llave no se descarta nada");
});

test("la lista separa giro, ciudad, sistema y problema del mensaje", async () => {
    const id = await crearSolicitud({ correo: `test-inv-lista-${SUFIJO}@example.com` });
    const respuesta = await fetch(`${BASE_URL}/admin/api/solicitudes-participacion`, { headers: ADMIN });
    const cuerpo = await respuesta.json();
    const solicitud = cuerpo.solicitudes.find(s => s.id === id);

    assert.equal(respuesta.status, 200);
    assert.equal(solicitud.giro, "Ferretería");
    assert.equal(solicitud.ciudad, "Rio Grande, Zac.");
    assert.equal(solicitud.sistemaActual, "Libreta");
    assert.equal(solicitud.problema, "Inventario");
    assert.equal(solicitud.estado, "nueva");
});

test("sin correo no se puede invitar", async () => {
    const id = await crearSolicitud({ correo: "", telefono: "4420001111" });
    const { status, cuerpo } = await invitar(id);

    assert.equal(status, 400);
    assert.match(cuerpo.error, /correo/i);
});

test("aceptar genera un enlace; el token no se guarda en claro y el correo no sale sin llave", async () => {
    const correo = `test-inv-flujo-${SUFIJO}@example.com`;
    const id = await crearSolicitud({ correo });
    const { status, cuerpo } = await invitar(id);

    assert.equal(status, 200);
    assert.match(cuerpo.enlace, /\/invitacion\/[A-Za-z0-9_-]{40,}$/);
    assert.equal(cuerpo.correoEnviado, false, "sin llave de correo nunca se dice que se envio");
    assert.ok(cuerpo.aviso);

    const token = tokenDe(cuerpo.enlace);
    const fila = (await pool.query(`SELECT * FROM public.invitaciones_piloto WHERE contacto_id = $1`, [id])).rows[0];
    assert.notEqual(fila.token_hash, token);
    assert.equal(fila.token_hash, crypto.createHash("sha256").update(token).digest("hex"));
    assert.equal(fila.estado, "pendiente");
    assert.equal(fila.giro, "ferreteria");
    assert.equal(fila.ciudad, "Rio Grande, Zac.");
    assert.equal(fila.enviada_at, null);

    const dias = (new Date(fila.expira_at) - Date.now()) / 86400000;
    assert.ok(dias > 13 && dias <= 14.01, `vence en 14 dias (fueron ${dias.toFixed(2)})`);

    global.__flujo = { id, token, correo };
});

test("la pagina de la invitacion muestra los datos ya cargados y no se indexa", async () => {
    const { token } = global.__flujo;
    const respuesta = await fetch(`${BASE_URL}/invitacion/${token}`);
    const html = await respuesta.text();

    assert.equal(respuesta.status, 200);
    assert.match(respuesta.headers.get("cache-control"), /no-store/);
    assert.match(respuesta.headers.get("x-robots-tag"), /noindex/);
    assert.match(html, /Hola Prueba Piloto/);
    assert.match(html, new RegExp(`value="Test Auto Invitacion ${SUFIJO}"`));
    assert.match(html, /<option value="ferreteria" selected>/);
    assert.match(html, /id="invCorreo"[^>]*readonly/);
    assert.match(html, /id="invForm"/);
    assert.doesNotMatch(html, /Descargar Nexo para Windows/, "antes de configurar no se ofrece la descarga");
    assert.match(html, /Cómo funciona la prueba/);
    assert.match(html, /class="inv-recorrido"/, "la mascota da la bienvenida");
    assert.match(html, /celebrando-transparente\.png/);
    for (const etapa of ["Tu cuenta", "Tu perfil", "Tu negocio", "¡A vender!"]) {
        assert.ok(html.includes(`<span>${etapa}</span>`), `falta la etapa ${etapa}`);
    }
    assert.match(html, /45 días sin costo/);
    assert.ok(html.includes("$200 al mes"), "cuota mensual");
    assert.match(html, /base de datos/);
    assert.match(html, /Ejemplo:/);
});

test("enlaces inventados, mal formados o ajenos no sirven", async () => {
    const inventado = await fetch(`${BASE_URL}/invitacion/${"a".repeat(43)}`);
    assert.equal(inventado.status, 404);

    const malFormado = await fetch(`${BASE_URL}/invitacion/corto`);
    assert.equal(malFormado.status, 404);

    const configurarInventado = await configurar("b".repeat(43));
    assert.equal(configurarInventado.status, 404);
});

test("configurar valida contrasena y terminos", async () => {
    const { token } = global.__flujo;

    const distintas = await configurar(token, { confirmarPassword: "OtraDistinta1" });
    assert.equal(distintas.status, 400);

    const corta = await configurar(token, { password: "corta", confirmarPassword: "corta" });
    assert.equal(corta.status, 400);

    const sinTerminos = await configurar(token, { aceptaTerminos: false });
    assert.equal(sinTerminos.status, 400);

    const nada = await pool.query(`SELECT COUNT(*)::int n FROM public.negocios WHERE LOWER(correo) = $1`, [global.__flujo.correo]);
    assert.equal(nada.rows[0].n, 0, "ninguna validacion fallida crea cuenta");
});

test("configurar crea la cuenta: licencia de prueba a 45 dias, correo verificado y el correo de la invitacion", async () => {
    const { token, id, correo } = global.__flujo;

    // Aunque el cliente intente mandar OTRO correo o un plan, se ignoran.
    const respuesta = await configurar(token, { correo: "otro@example.com", plan: "pro" });
    const cuerpo = await respuesta.json();

    assert.equal(respuesta.status, 201, JSON.stringify(cuerpo));
    negociosCreados.push(cuerpo.negocio.id);

    const negocio = (await pool.query(`SELECT * FROM public.negocios WHERE id = $1`, [cuerpo.negocio.id])).rows[0];
    assert.equal(negocio.correo, correo);
    assert.equal(negocio.plan, "prueba");
    assert.equal(negocio.estado, "prueba");
    assert.equal(negocio.correo_verificado, true);
    assert.equal(negocio.giro, "ferreteria");
    assert.equal(negocio.nivel_precio_por_defecto, "publico");
    assert.equal(negocio.onboarding_completado_at, null, "le sale el asistente de inicio");
    assert.ok(await verificarPassword("ContrasenaSegura1", negocio.password_hash), "la contrasena elegida funciona");

    const licencia = (await pool.query(`SELECT * FROM public.licencias WHERE negocio_id = $1`, [negocio.id])).rows[0];
    assert.equal(licencia.plan, "prueba");
    assert.equal(licencia.estado, "activa");
    const diasDePrueba = (new Date(licencia.fecha_vencimiento) - Date.now()) / 86400000;
    assert.ok(diasDePrueba > 44.9 && diasDePrueba <= 45, `la prueba dura 45 dias (quedan ${diasDePrueba})`);
    assert.equal(licencia.gracia_dias, 15);
    assert.equal(licencia.piloto, true, "queda marcado como piloto para el seguimiento de la prueba");
    assert.match(licencia.license_key, /^NXP-/);

    const giros = await pool.query(`SELECT giro FROM public.negocio_giros WHERE negocio_id = $1 AND activo`, [negocio.id]);
    assert.deepEqual(giros.rows.map(g => g.giro), ["ferreteria"]);

    const inv = (await pool.query(`SELECT estado, negocio_id, configurada_at FROM public.invitaciones_piloto WHERE contacto_id = $1`, [id])).rows[0];
    assert.equal(inv.estado, "configurada");
    assert.equal(inv.negocio_id, negocio.id);
    assert.ok(inv.configurada_at);

    // Sin empleados: el administrador elige su nombre y PIN al primer inicio.
    const empleados = await pool.query(`SELECT COUNT(*)::int n FROM public.empleados WHERE negocio_id = $1`, [negocio.id]);
    assert.equal(empleados.rows[0].n, 0);
});

test("configurar dos veces: 409 y sigue habiendo un solo negocio", async () => {
    const { token, correo } = global.__flujo;
    const otra = await configurar(token);
    const cuerpo = await otra.json();

    assert.equal(otra.status, 409);
    assert.equal(cuerpo.codigo, "ya_configurada");

    const cuentas = await pool.query(`SELECT COUNT(*)::int n FROM public.negocios WHERE LOWER(correo) = $1`, [correo]);
    assert.equal(cuentas.rows[0].n, 1);
});

test("ya configurado, el mismo enlace SOLO muestra la descarga: nunca vuelve a pedir datos", async () => {
    const { token, correo } = global.__flujo;
    const respuesta = await fetch(`${BASE_URL}/invitacion/${token}`);
    const html = await respuesta.text();

    assert.equal(respuesta.status, 200);
    assert.match(html, /Tu negocio ya está configurado/);
    assert.match(html, /Descargar Nexo para Windows/);
    assert.match(html, /\.exe|\/downloads\//);
    assert.ok(html.includes(correo), "recuerda con que correo iniciar sesion");
    assert.doesNotMatch(html, /id="invForm"|type="password"/, "no pide ninguna informacion");
    assert.match(html, /id="bloqueMovil"/, "trae el bloque para quien abre desde el celular");
    assert.match(html, /Tu prueba sin costo termina el/, "muestra SU fecha de fin de prueba");
    assert.ok(html.includes("$200"), "cuota mensual");
    assert.match(html, /class="inv-recorrido"/, "el mismo recorrido con mascota que se ve dentro de Nexo");
    assert.match(html, /desde ahí yo te guío/, "le dice que Nexo lo guia al entrar");
});

test("enviar el enlace por correo: solo se anuncia si el correo salio (aqui no hay llave: 502)", async () => {
    const { token } = global.__flujo;
    const respuesta = await fetch(`${BASE_URL}/api/invitaciones/${token}/enviar-enlace`, { method: "POST" });
    const cuerpo = await respuesta.json();

    assert.equal(respuesta.status, 502);
    assert.equal(cuerpo.ok, false);

    // Antes de configurar no existe ese enlace de descarga.
    const id = await crearSolicitud({ correo: `test-inv-sinconfigurar-${SUFIJO}@example.com` });
    const nuevo = await invitar(id);
    const antes = await fetch(`${BASE_URL}/api/invitaciones/${tokenDe(nuevo.cuerpo.enlace)}/enviar-enlace`, { method: "POST" });
    assert.equal(antes.status, 404);
});

test("invitar de nuevo reemplaza el enlace anterior; uno ya configurado no se puede reinvitar", async () => {
    const id = await crearSolicitud({ correo: `test-inv-reenviar-${SUFIJO}@example.com` });
    const primero = await invitar(id);
    const segundo = await invitar(id);

    assert.notEqual(primero.cuerpo.enlace, segundo.cuerpo.enlace);

    const viejo = await fetch(`${BASE_URL}/invitacion/${tokenDe(primero.cuerpo.enlace)}`);
    assert.equal(viejo.status, 410, "el enlace anterior ya no sirve");

    const nuevo = await fetch(`${BASE_URL}/invitacion/${tokenDe(segundo.cuerpo.enlace)}`);
    assert.equal(nuevo.status, 200);

    const viejoConfigurar = await configurar(tokenDe(primero.cuerpo.enlace));
    assert.equal(viejoConfigurar.status, 410);

    const yaConfigurada = await invitar(global.__flujo.id);
    assert.equal(yaConfigurada.status, 409);
});

test("una invitacion vencida no sirve ni para ver ni para configurar", async () => {
    const id = await crearSolicitud({ correo: `test-inv-vencida-${SUFIJO}@example.com` });
    const { cuerpo } = await invitar(id);
    const token = tokenDe(cuerpo.enlace);

    await pool.query(`UPDATE public.invitaciones_piloto SET expira_at = NOW() - INTERVAL '1 hour' WHERE contacto_id = $1`, [id]);

    const pagina = await fetch(`${BASE_URL}/invitacion/${token}`);
    assert.equal(pagina.status, 410);
    assert.match(await pagina.text(), /venció/);

    const intento = await configurar(token);
    assert.equal(intento.status, 410);

    const lista = await (await fetch(`${BASE_URL}/admin/api/solicitudes-participacion`, { headers: ADMIN })).json();
    assert.equal(lista.solicitudes.find(s => s.id === id).estado, "vencida");
});

test("dos envios a la vez crean un solo negocio", async () => {
    const correo = `test-inv-carrera-${SUFIJO}@example.com`;
    const id = await crearSolicitud({ correo, negocio: `Test Auto Carrera ${SUFIJO}` });
    const { cuerpo } = await invitar(id);
    const token = tokenDe(cuerpo.enlace);

    const [a, b] = await Promise.all([
        configurar(token, { nombreNegocio: `Test Auto Carrera ${SUFIJO}` }),
        configurar(token, { nombreNegocio: `Test Auto Carrera ${SUFIJO}` })
    ]);

    assert.deepEqual([a.status, b.status].sort(), [201, 409]);

    const cuentas = await pool.query(`SELECT COUNT(*)::int n FROM public.negocios WHERE LOWER(correo) = $1`, [correo]);
    assert.equal(cuentas.rows[0].n, 1);
});

test("si ya existe una cuenta con ese correo no se invita", async () => {
    const id = await crearSolicitud({ correo: global.__flujo.correo });
    const { status, cuerpo } = await invitar(id);

    assert.equal(status, 409);
    assert.match(cuerpo.error, /cuenta/i);
});

test("descartar una solicitud revoca su invitacion pendiente", async () => {
    const id = await crearSolicitud({ correo: `test-inv-descartar-${SUFIJO}@example.com` });
    const { cuerpo } = await invitar(id);

    const descartar = await fetch(`${BASE_URL}/admin/api/solicitudes-participacion/${id}/descartar`, { method: "POST", headers: ADMIN });
    assert.equal(descartar.status, 200);

    const pagina = await fetch(`${BASE_URL}/invitacion/${tokenDe(cuerpo.enlace)}`);
    assert.equal(pagina.status, 410);

    const lista = await (await fetch(`${BASE_URL}/admin/api/solicitudes-participacion`, { headers: ADMIN })).json();
    assert.equal(lista.solicitudes.find(s => s.id === id).estado, "descartada");
});

test("si el correo estaba mal se corrige al invitar, y se puede armar solo el enlace para WhatsApp", async () => {
    const malo = `test-inv-malo-${SUFIJO}@example.com`;
    const bueno = `test-inv-bueno-${SUFIJO}@example.com`;
    const id = await crearSolicitud({ correo: malo });
    const ruta = `${BASE_URL}/admin/api/solicitudes-participacion/${id}/invitar`;
    const enviar = cuerpo => fetch(ruta, { method: "POST", headers: ADMIN, body: JSON.stringify(cuerpo) });

    // Un correo invalido nuevo se rechaza y no pisa el que habia.
    assert.equal((await enviar({ correo: "esto-no-es-correo" })).status, 400);
    assert.equal((await pool.query(`SELECT correo FROM public.contactos_landing WHERE id = $1`, [id])).rows[0].correo, malo);

    const corregido = await (await enviar({ correo: bueno })).json();
    assert.match(corregido.enlace, /\/invitacion\//);
    assert.equal((await pool.query(`SELECT correo FROM public.contactos_landing WHERE id = $1`, [id])).rows[0].correo, bueno);
    assert.equal((await pool.query(`SELECT correo FROM public.invitaciones_piloto WHERE contacto_id = $1 AND estado = 'pendiente'`, [id])).rows[0].correo, bueno);

    // Solo enlace: no intenta correo, deja un enlace nuevo valido y revoca el anterior.
    const whatsapp = await (await enviar({ sinCorreo: true })).json();
    assert.equal(whatsapp.ok, true);
    assert.equal(whatsapp.correoEnviado, false);
    assert.equal(whatsapp.aviso, null);
    assert.notEqual(whatsapp.enlace, corregido.enlace);

    const viejo = await fetch(`${BASE_URL}/invitacion/${tokenDe(corregido.enlace)}`);
    const nuevo = await fetch(`${BASE_URL}/invitacion/${tokenDe(whatsapp.enlace)}`);
    assert.equal(nuevo.status, 200);
    assert.notEqual(viejo.status, 200, "el enlace anterior ya no sirve");
});
