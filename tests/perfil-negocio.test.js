// Perfil del negocio (tipo de negocio ESTRICTO): negocios.giro define como se ve
// y se comporta Nexo.
//
// Lo que se protege:
//  - el tipo solo se define mientras el asistente de inicio no se ha terminado;
//    despues queda fijo (409) y solo Nexo lo cambia desde el panel de admin;
//  - un empleado sin permiso de administrar no lo toca, y el tipo principal no se
//    puede apagar desde el toggle de giros;
//  - un perfil "simple" (abarrotes) oculta modulos que de verdad existen en el
//    menu, y los demas perfiles (y los negocios que ya existian) ven todo.

const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { hashPassword } = require("../password-utils");
const { pool, crearNegocioPrueba, borrarNegocioPrueba } = require("./helpers/negocio-prueba");
const { iniciarServidorPrueba, detenerServidorPrueba, BASE_URL } = require("./helpers/servidor-prueba");
const { PERFILES_NEGOCIO } = require("../public/js/perfil-negocio.js");

const ADMIN = { "x-admin-key": process.env.ADMIN_KEY, "Content-Type": "application/json" };
const publico = path.join(__dirname, "..", "public");
const leer = ruta => fs.readFileSync(path.join(publico, ruta), "utf8");

let negocio;
let cajeroId;

const headers = (extra = {}) => ({ "Content-Type": "application/json", "x-dispositivo-token": negocio.token, ...extra });

async function perfil(valor, extra) {
    const r = await fetch(`${BASE_URL}/negocio-actual/perfil`, { method: "PUT", headers: headers(extra), body: JSON.stringify({ perfil: valor }) });
    return { status: r.status, cuerpo: await r.json() };
}

async function giroDelNegocio() {
    return (await pool.query(`SELECT giro, onboarding_completado_at FROM public.negocios WHERE id = $1`, [negocio.negocioId])).rows[0];
}

before(async () => {
    await iniciarServidorPrueba();
    negocio = await crearNegocioPrueba("perfil-negocio");
    await pool.query(`UPDATE public.negocios SET onboarding_completado_at = NULL, giro = 'ferreteria' WHERE id = $1`, [negocio.negocioId]);

    const empleado = await pool.query(
        `INSERT INTO public.empleados (negocio_id, nombre, rol, pin_hash, permisos)
         VALUES ($1, 'Cajero sin admin', 'Cajero', $2, '{"hacer_ventas": true}'::jsonb) RETURNING id`,
        [negocio.negocioId, hashPassword("1234")]
    );
    cajeroId = empleado.rows[0].id;
});

after(async () => {
    if (negocio) await borrarNegocioPrueba(negocio.negocioId);
    await detenerServidorPrueba();
    await pool.end();
});

test("el tipo de negocio se define mientras el asistente no termina, y activa su giro", async () => {
    assert.equal((await perfil("quesos")).status, 400, "un tipo inventado se rechaza");
    assert.equal((await perfil("")).status, 400);

    const r = await perfil("Abarrotes");
    assert.equal(r.status, 200);
    assert.equal(r.cuerpo.perfil, "abarrotes");
    assert.equal((await giroDelNegocio()).giro, "abarrotes");

    const giros = await pool.query(`SELECT giro FROM public.negocio_giros WHERE negocio_id = $1 AND activo`, [negocio.negocioId]);
    assert.ok(giros.rows.some(f => f.giro === "abarrotes"), "el tipo principal queda como giro activo");

    // Se puede corregir mientras el asistente siga abierto; el mismo valor no hace nada.
    assert.equal((await perfil("abarrotes")).cuerpo.sinCambios, true);
    assert.equal((await perfil("papeleria")).status, 200);
    assert.equal((await perfil("abarrotes")).status, 200);
});

test("un empleado sin permiso de administrar no puede definirlo", async () => {
    const r = await perfil("vinateria", { "x-empleado-id": String(cajeroId) });
    assert.equal(r.status, 403);
    assert.equal((await giroDelNegocio()).giro, "abarrotes");
});

test("el tipo principal no se apaga desde el toggle de giros, pero un complemento si", async () => {
    const apagar = giro => fetch(`${BASE_URL}/negocio-actual/giro`, { method: "PUT", headers: headers(), body: JSON.stringify({ giro, activo: false }) });
    const prender = giro => fetch(`${BASE_URL}/negocio-actual/giro`, { method: "PUT", headers: headers(), body: JSON.stringify({ giro, activo: true }) });

    const principal = await apagar("abarrotes");
    assert.equal(principal.status, 400);
    assert.match((await principal.json()).error, /tipo principal/i);

    assert.equal((await prender("vinateria")).status, 200);
    assert.equal((await apagar("vinateria")).status, 200, "un complemento se quita sin problema");
});

test("el estado del asistente y /negocio-actual traen el tipo", async () => {
    const estado = await (await fetch(`${BASE_URL}/negocio-actual/onboarding`, { headers: headers() })).json();
    assert.equal(estado.perfil, "abarrotes");

    const actual = await (await fetch(`${BASE_URL}/negocio-actual`, { headers: headers() })).json();
    assert.equal(actual.negocio.giro, "abarrotes");
});

test("al terminar el asistente el tipo queda fijo (409) y solo Nexo lo cambia desde el panel", async () => {
    await pool.query(`UPDATE public.negocios SET onboarding_completado_at = NOW() WHERE id = $1`, [negocio.negocioId]);

    const r = await perfil("ferreteria");
    assert.equal(r.status, 409);
    assert.match(r.cuerpo.error, /escribenos/i);
    assert.equal((await giroDelNegocio()).giro, "abarrotes", "no cambio");

    // Pedir el mismo tipo no es un error.
    assert.equal((await perfil("abarrotes")).status, 200);

    const patch = (cuerpo, id = negocio.negocioId, cabeceras = ADMIN) =>
        fetch(`${BASE_URL}/admin/api/negocios/${id}/perfil`, { method: "PATCH", headers: cabeceras, body: JSON.stringify(cuerpo) });

    assert.equal((await patch({ perfil: "ferreteria" }, negocio.negocioId, { "Content-Type": "application/json" })).status, 401, "sin clave de admin no se puede");
    assert.equal((await patch({ perfil: "quesos" })).status, 400);
    assert.equal((await patch({ perfil: "ferreteria" }, 999999999)).status, 404);

    const ok = await patch({ perfil: "ferreteria" });
    assert.equal(ok.status, 200);
    assert.equal((await giroDelNegocio()).giro, "ferreteria");

    const giros = await pool.query(`SELECT giro FROM public.negocio_giros WHERE negocio_id = $1 AND activo`, [negocio.negocioId]);
    assert.ok(giros.rows.some(f => f.giro === "ferreteria"));
});

test("abarrotes oculta modulos que existen en el menu; los demas perfiles ven todo", () => {
    const indice = leer("index.html");

    assert.equal(PERFILES_NEGOCIO.abarrotes.simple, true);
    assert.ok(PERFILES_NEGOCIO.abarrotes.ocultar.length >= 8);

    for (const modulo of PERFILES_NEGOCIO.abarrotes.ocultar) {
        assert.ok(indice.includes(`data-shell-module="${modulo}"`), `el modulo ${modulo} no existe en el menu`);
    }

    // Lo esencial de un abarrotes nunca se oculta.
    for (const esencial of ["inicio", "venta", "inventario", "carga-inventario", "agregar-producto", "inventario-bajo", "por-vencer", "reportes", "clientes", "cuenta", "configuracion", "nexo-ia"]) {
        assert.ok(!PERFILES_NEGOCIO.abarrotes.ocultar.includes(esencial), `${esencial} no debe ocultarse`);
    }

    for (const otro of ["ferreteria", "papeleria", "vinateria", "general"]) {
        assert.equal(PERFILES_NEGOCIO[otro].simple, false);
        assert.deepEqual(PERFILES_NEGOCIO[otro].ocultar, [], `${otro} ve todo igual que siempre`);
    }
});

test("el cliente aplica el perfil: menu, formulario con ganancia y copia local del tipo", () => {
    const js = leer("js/perfil-negocio.js");
    const css = leer("css/components/perfil-negocio.css");
    const indice = leer("index.html");
    const config = leer("js/config-auth.js");

    // Ganancia real: lo que te cuesta (precio distribuidor) contra lo que cobras.
    assert.match(js, /Precio distribuidor \(lo que te cuesta\)/);
    assert.match(js, /Precio al público \(lo que cobras\)/);
    assert.match(js, /Ganas \$\{dinero\(ganancia\)\} por pieza/);
    assert.match(js, /Estás perdiendo/);

    // Formulario: lo avanzado se oculta con CSS, y se puede mostrar todo.
    assert.match(css, /body\.perfil-simple:not\(\.perfil-campos-todos\) #precioMayoreo/);
    assert.match(css, /\[data-seccion="market"\]/);
    assert.match(js, /Mostrar todos los campos/);
    assert.match(js, /Más herramientas/);

    // Orden de carga y version.
    assert.match(indice, /css\/components\/perfil-negocio\.css\?v=/);
    assert.ok(indice.indexOf("js/perfil-negocio.js") < indice.indexOf("js/config-auth.js"));

    // El tipo viaja del servidor a la copia local en cada conexion y se aplica.
    assert.match(config, /perfilNegocio: String\(negocio\.giro/);
    assert.match(config, /window\.perfilNegocio\.aplicar\(\)/);

    // Configuracion ya no deja apagar el principal: solo complementos.
    assert.match(config, /clave !== tipoPrincipalConfig/);
    assert.match(config, /no se cambia desde aqui/);
});

test("el asistente confirma el tipo de negocio, lo guarda como principal y deja complementos", () => {
    const asistente = leer("js/asistente-inicio.js");

    assert.match(asistente, /function asistenteElegirPerfil\(id\)/);
    assert.match(asistente, /function asistenteAlternarExtra\(id\)/);
    assert.match(asistente, /\/negocio-actual\/perfil/);
    assert.match(asistente, /confirmarPOS\(/);
    assert.match(asistente, /solo lo podemos cambiar nosotros/);
    assert.match(asistente, /perfilNegocio: asistente\.perfil/);
});

test("el panel de admin puede cambiar el tipo de negocio", () => {
    const admin = leer("admin/app.js");
    assert.match(admin, /function cambiarTipoNegocioAdmin\(id\)/);
    assert.match(admin, /\/admin\/api\/negocios\/\$\{id\}\/perfil/);
    assert.match(admin, /onclick="cambiarTipoNegocioAdmin\(/);
});

test("la carga de inventario ofrece el costo a los perfiles simples", () => {
    const carga = leer("js/carga-inventario.js");
    assert.match(carga, /perfilEsSimple\(\)/);
    assert.match(carga, /id="ciCosto"/);
    assert.match(carga, /precioDistribuidor/);
});

test("el punto de venta de un abarrotes cobra a un solo precio, sin cotizar ni listas de ferreteria, y dice Fiado", () => {
    const css = leer("css/components/perfil-negocio.css");
    const ventas = leer("js/pos-sales.js");
    const perfilJs = leer("js/perfil-negocio.js");

    for (const selector of [".resumen-precio-aplicado", ".btn-agregar-lista-pos", ".btn-cotizar-carrito", ".resumen-requiere-factura"]) {
        assert.ok(css.includes(`body.perfil-simple:not(.perfil-ver-todo) ${selector}`), `no se oculta ${selector}`);
    }

    // Siempre el precio del publico.
    assert.match(ventas, /perfilEsSimple\(\)\) return "publico"/);
    assert.match(ventas, /perfilEsSimple\(\) \? "Fiado" : "Credito"/);
    assert.match(perfilJs, /botonCreditos\.textContent = perfilEsSimple\(\) \? "Fiado"/);

    // Agregar producto: sin los catalogos de proveedor ferreteros.
    assert.match(css, /abrirActualizarCatalogo\(\)/);
    assert.match(css, /#proveedorCatalogoSeccion/);
});

test("abarrotes muestra los exhibidores (botanas, dulces, refrescos) con sugerencias propias del giro", () => {
    const js = leer("js/exhibidores.js");
    const css = leer("css/components/perfil-negocio.css");
    const indice = leer("index.html");

    assert.ok(!PERFILES_NEGOCIO.abarrotes.ocultar.includes("exhibidores"), "el menu de exhibidores ya no se oculta");
    assert.match(css, /\.btn-agregar-lista-pos:not\(\.btn-exhibidor-pos\)/, "el boton de exhibidores del punto de venta sigue visible");
    assert.match(indice, /class="btn-agregar-lista-pos btn-exhibidor-pos"/);
    assert.match(js, /EXHIBIDORES_SUGERIDOS_ABARROTES = \["Botanas", "Dulces", "Galletas", "Refrescos"/);
    assert.match(js, /exhEsAbarrotes\(\)/);
    assert.match(js, /nuevoExhibidor\('\$\{nombre\}'\)/);
});

test("quien entra con correo y contrasena recibe su tipo de negocio (sin eso nunca veia el menu de su giro)", async () => {
    const correo = `${negocio.slug}@example.com`;
    await pool.query(`UPDATE public.negocios SET password_hash = $1 WHERE id = $2`, [hashPassword("ContrasenaSegura1"), negocio.negocioId]);

    const r = await fetch(`${BASE_URL}/cuenta/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ correo, password: "ContrasenaSegura1" }) });
    assert.equal(r.status, 200);

    const cuerpo = await r.json();
    assert.equal(cuerpo.negocio.giro, (await giroDelNegocio()).giro);

    // Y el cliente se lo pide al servidor si su equipo no lo tiene (sesion ya abierta antes de este arreglo).
    const js = leer("js/perfil-negocio.js");
    assert.match(js, /async function perfilSincronizarConServidor/);
    assert.match(js, /\/negocio-actual/);
});

test("quien tiene ferreteria y abarrotes (ambos) recibe las herramientas de abarrotes sin perder las de ferreteria", async () => {
    // /negocio-actual dice que giros tiene activos: la app los usa para dar las herramientas extra.
    await pool.query(`UPDATE public.negocios SET giro = 'ferreteria' WHERE id = $1`, [negocio.negocioId]);
    await pool.query(`UPDATE public.negocio_giros SET activo = false WHERE negocio_id = $1 AND giro NOT IN ('ferreteria', 'abarrotes')`, [negocio.negocioId]);
    await pool.query(`INSERT INTO public.negocio_giros (negocio_id, giro, activo) VALUES ($1, 'ferreteria', true), ($1, 'abarrotes', true)
                      ON CONFLICT (negocio_id, giro) DO UPDATE SET activo = true`, [negocio.negocioId]);

    const actual = await (await fetch(`${BASE_URL}/negocio-actual`, { headers: headers() })).json();
    assert.equal(actual.negocio.giro, "ferreteria", "el tipo principal sigue siendo ferreteria: el menu y el formulario completos");
    assert.deepEqual(actual.negocio.girosActivos, ["abarrotes", "ferreteria"]);

    const js = leer("js/perfil-negocio.js");
    assert.match(js, /function perfilTieneAbarrotes\(\)/);
    assert.match(js, /configuracion\.girosActivos\.indexOf\("abarrotes"\)/);
    assert.match(js, /classList\.toggle\("perfil-con-abarrotes", perfilTieneAbarrotes\(\)\)/);

    // Las herramientas de abarrotes preguntan "tiene abarrotes"; lo que quita cosas de ferreteria sigue siendo solo del perfil simple.
    for (const archivo of ["js/lotes-ui.js", "js/favoritos-pos.js", "js/inicio-abarrotes.js"]) {
        assert.match(leer(archivo), /perfilTieneAbarrotes\(\)/, `${archivo} debe usar perfilTieneAbarrotes`);
    }

    assert.match(leer("css/components/pedido-sugerido.css"), /body\.perfil-con-abarrotes \.sidebar \.solo-perfil-simple \{ display: flex; \}/);
    assert.match(leer("css/components/perfil-negocio.css"), /body:not\(\.perfil-con-abarrotes\) \.campo-vida-util/);
    assert.match(leer("css/components/inicio-abarrotes.css"), /body\.perfil-simple:not\(\.perfil-ver-todo\) #pantallaInicio >/, "el tablero de ferreteria solo se esconde en el perfil simple");
    assert.match(leer("css/components/perfil-negocio.css"), /body\.perfil-simple:not\(\.perfil-ver-todo\) \.sidebar \[data-perfil-oculto="1"\]/, "el menu solo se recorta en el perfil simple");
});

test("abarrotes no muestra 'IVA incluido (16%)' en el carrito porque para lo basico no aplica; los demas giros lo siguen viendo", () => {
    const ventas = leer("js/pos-sales.js");
    const css = leer("css/components/perfil-negocio.css");

    // La linea sigue existiendo (ferreteria la ve igual) y solo se esconde en el perfil simple.
    assert.match(ventas, /resumen-linea resumen-iva-informativo/);
    assert.match(ventas, /IVA incluido \(16%\)/);
    assert.match(css, /body\.perfil-simple:not\(\.perfil-ver-todo\) \.resumen-iva-informativo \{\s*\n\s*display: none !important;/);
});
