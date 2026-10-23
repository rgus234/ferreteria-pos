// Capturar codigos: herramienta privada y temporal para juntar codigos reales con su nombre.
// Requiere la migracion 20261030_capturas_codigos.sql.
//
// Se protege: solo cuentas autorizadas (tambien en el backend), codigos como texto con ceros iniciales,
// duplicados con correccion, CSV para Excel, y que NUNCA toca productos, ventas ni existencias.

const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { hashPassword } = require("../password-utils");
const { pool, crearNegocioPrueba, borrarNegocioPrueba } = require("./helpers/negocio-prueba");
const { iniciarServidorPrueba, detenerServidorPrueba, BASE_URL } = require("./helpers/servidor-prueba");

let dueno, otroAutorizado, ajeno;
let tokenDueno, tokenOtro, tokenAjeno;

async function entrar(negocio) {
    const correo = `${negocio.slug}@example.com`;
    await pool.query(`UPDATE public.negocios SET password_hash = $1 WHERE id = $2`, [hashPassword("ContrasenaSegura1"), negocio.negocioId]);
    const r = await fetch(`${BASE_URL}/cuenta/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ correo, password: "ContrasenaSegura1" }) });
    return (await r.json()).token;
}

const llamar = (token, ruta, opciones = {}) => fetch(`${BASE_URL}${ruta}`, { ...opciones, headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, ...(opciones.headers || {}) } });
const guardar = (token, cuerpo) => llamar(token, "/captura-codigos", { method: "POST", body: JSON.stringify(cuerpo) });

before(async () => {
    dueno = await crearNegocioPrueba("captura-a");
    otroAutorizado = await crearNegocioPrueba("captura-b");
    ajeno = await crearNegocioPrueba("captura-c");

    // Las dos primeras cuentas estan autorizadas; la tercera no.
    process.env.CAPTURA_CODIGOS_CORREOS = `${dueno.slug}@example.com, ${otroAutorizado.slug}@example.com`;
    await iniciarServidorPrueba();

    tokenDueno = await entrar(dueno);
    tokenOtro = await entrar(otroAutorizado);
    tokenAjeno = await entrar(ajeno);
});

after(async () => {
    await pool.query(`DELETE FROM public.capturas_codigos WHERE propietario_correo LIKE 'test-auto-captura-%'`);
    for (const n of [dueno, otroAutorizado, ajeno]) if (n) await borrarNegocioPrueba(n.negocioId);
    await detenerServidorPrueba();
    await pool.end();
});

test("solo la cuenta autorizada puede usarla, tambien en el backend", async () => {
    assert.equal((await (await llamar(tokenDueno, "/captura-codigos/acceso")).json()).permitido, true);
    assert.equal((await (await llamar(tokenAjeno, "/captura-codigos/acceso")).json()).permitido, false);

    // Aunque alguien llame a la API directo, el servidor la rechaza.
    assert.equal((await llamar(tokenAjeno, "/captura-codigos")).status, 403);
    assert.equal((await guardar(tokenAjeno, { codigo: "7501000000017", nombre: "Intento" })).status, 403);
    assert.equal((await llamar(tokenAjeno, "/captura-codigos/exportar.csv")).status, 403);

    // Un equipo compartido (token de dispositivo, sin sesion de cuenta) tampoco entra.
    const porEquipo = await fetch(`${BASE_URL}/captura-codigos`, { headers: { "x-dispositivo-token": dueno.token } });
    assert.equal(porEquipo.status, 403);

    // Sin sesion, nada.
    assert.ok([401, 403].includes((await fetch(`${BASE_URL}/captura-codigos`)).status));
});

test("guarda el codigo como texto (ceros iniciales), con validaciones", async () => {
    const r = await guardar(tokenDueno, { codigo: "0750100012345", nombre: "  Coca-Cola   600 ml  " });
    assert.equal(r.status, 201);

    const cuerpo = await r.json();
    assert.equal(cuerpo.registro.codigo, "0750100012345", "el cero inicial se conserva");
    assert.equal(cuerpo.registro.nombre, "Coca-Cola 600 ml", "espacios de mas se limpian");
    assert.equal(cuerpo.total, 1);

    assert.equal((await guardar(tokenDueno, { codigo: "75", nombre: "Corto" })).status, 400, "codigo demasiado corto");
    assert.equal((await guardar(tokenDueno, { codigo: "7501 0001", nombre: "Con espacio" })).status, 400);
    assert.equal((await guardar(tokenDueno, { codigo: "7501000000024", nombre: "   " })).status, 400, "falta el nombre");

    const existe = await (await llamar(tokenDueno, "/captura-codigos/existe/0750100012345")).json();
    assert.equal(existe.existe, true);
});

test("un codigo repetido avisa (409) y se puede corregir el nombre", async () => {
    const duplicado = await guardar(tokenDueno, { codigo: "0750100012345", nombre: "Otro nombre" });
    assert.equal(duplicado.status, 409);
    assert.equal((await duplicado.json()).duplicado.nombre, "Coca-Cola 600 ml", "dice como estaba");

    const corregido = await guardar(tokenDueno, { codigo: "0750100012345", nombre: "Coca-Cola Original 600 ml", reemplazar: true });
    assert.equal(corregido.status, 200);
    const cuerpo = await corregido.json();
    assert.equal(cuerpo.actualizado, true);
    assert.equal(cuerpo.total, 1, "no se duplica el registro");

    const anterior = (await pool.query(`SELECT nombre_anterior FROM public.capturas_codigos WHERE codigo = '0750100012345' AND propietario_correo = $1`, [`${dueno.slug}@example.com`])).rows[0];
    assert.equal(anterior.nombre_anterior, "Coca-Cola 600 ml", "se conserva el nombre anterior");
});

test("lista, busca, corrige y borra; cada propietario ve solo lo suyo", async () => {
    await guardar(tokenDueno, { codigo: "7501055300075", nombre: "Sabritas Original" });
    await guardar(tokenOtro, { codigo: "7501055300075", nombre: "Registro del otro propietario" });

    const todos = await (await llamar(tokenDueno, "/captura-codigos")).json();
    assert.equal(todos.total, 2);
    assert.ok(todos.registros.every(r => r.nombre !== "Registro del otro propietario"), "no ve lo del otro");

    const buscados = await (await llamar(tokenDueno, "/captura-codigos?buscar=sabritas")).json();
    assert.equal(buscados.registros.length, 1);

    const id = buscados.registros[0].id;
    assert.equal((await llamar(tokenOtro, `/captura-codigos/${id}`, { method: "PATCH", body: JSON.stringify({ nombre: "Intento" }) })).status, 404, "el otro no puede tocarlo");

    const editado = await llamar(tokenDueno, `/captura-codigos/${id}`, { method: "PATCH", body: JSON.stringify({ nombre: "Sabritas Original 45 g" }) });
    assert.equal((await editado.json()).registro.nombre, "Sabritas Original 45 g");

    assert.equal((await llamar(tokenDueno, `/captura-codigos/${id}`, { method: "DELETE" })).status, 200);
    assert.equal((await (await llamar(tokenDueno, "/captura-codigos")).json()).total, 1);
});

test("el CSV abre bien en Excel: UTF-8 con BOM y el codigo como texto con su cero inicial", async () => {
    await guardar(tokenDueno, { codigo: "0012345678905", nombre: 'Jabón "Zote", 400 g' });

    const r = await llamar(tokenDueno, "/captura-codigos/exportar.csv");
    assert.equal(r.status, 200);
    assert.match(r.headers.get("content-type"), /text\/csv; charset=utf-8/);
    assert.match(r.headers.get("content-disposition"), /attachment; filename="codigos-capturados-\d{4}-\d{2}-\d{2}\.csv"/);

    // response.text() descarta el BOM al decodificar: se revisan los bytes crudos.
    const bytes = Buffer.from(await r.clone().arrayBuffer());
    assert.deepEqual([...bytes.subarray(0, 3)], [0xEF, 0xBB, 0xBF], "empieza con BOM UTF-8 (Excel lo abre con acentos)");

    const texto = await r.text();
    assert.ok(texto.startsWith("codigo,nombre,capturado"), "encabezado");
    assert.match(texto, /"=""0750100012345""","Coca-Cola Original 600 ml"/);
    assert.match(texto, /"=""0012345678905""","Jabón ""Zote"", 400 g"/, "comillas y comas dentro del nombre se escapan");
});

test("no crea productos ni toca ventas, existencias o precios", async () => {
    const antes = (await pool.query(`SELECT (SELECT COUNT(*) FROM public.productos WHERE negocio_id = $1) AS productos, (SELECT COUNT(*) FROM public.historial_ventas WHERE negocio_id = $1) AS ventas`, [dueno.negocioId])).rows[0];

    await guardar(tokenDueno, { codigo: "7500000000999", nombre: "Producto de prueba" });

    const despues = (await pool.query(`SELECT (SELECT COUNT(*) FROM public.productos WHERE negocio_id = $1) AS productos, (SELECT COUNT(*) FROM public.historial_ventas WHERE negocio_id = $1) AS ventas`, [dueno.negocioId])).rows[0];
    assert.deepEqual(despues, antes);
});

test("el celular solo muestra la opcion si el servidor la autoriza y reutiliza el lector existente", () => {
    const leer = ruta => fs.readFileSync(path.join(__dirname, "..", "public", ruta), "utf8");
    const js = leer("dueno-captura.js");
    const html = leer("dueno.html");
    const sw = leer("dueno-sw.js");

    assert.match(js, /\/captura-codigos\/acceso/);
    assert.match(js, /permitido = ok && datos\.permitido === true/);
    assert.match(js, /duenoPedCargarZxing\(\)/, "reutiliza el lector de codigos de la app");
    assert.match(js, /if \(!codigo \|\| capturaCodigoActual\) return/, "no se sobrescribe el codigo mientras se nombra otro");
    assert.match(js, /Guardar y siguiente/);
    assert.match(js, /fetchAutenticado\("\/captura-codigos\/exportar\.csv"\)/);

    assert.ok(html.indexOf("dueno.js") < html.indexOf("dueno-captura.js"), "envuelve cargarPanelMasDueno ya definida");
    assert.match(sw, /dueno-captura\.js/);
    assert.match(sw, /nexo-dueno-shell-v51/);
});
