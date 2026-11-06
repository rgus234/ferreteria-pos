// Gafi: codigos y fotos. Busca un producto de la lista de Gafi, guarda su codigo de barras (validado) y su foto.
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const pool = require("../db");
const { iniciarServidorPrueba, detenerServidorPrueba, BASE_URL } = require("./helpers/servidor-prueba");
const { crearNegocioPrueba, borrarNegocioPrueba } = require("./helpers/negocio-prueba");

let negocio;
let gafi = {};
const EAN_A = "4006381333931";
const EAN_B = "5901234123457";
const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

const api = (ruta, metodo = "GET", cuerpo) => fetch(`${BASE_URL}${ruta}`, {
    method: metodo,
    headers: { "Content-Type": "application/json", "x-dispositivo-token": negocio.token },
    ...(cuerpo ? { body: JSON.stringify(cuerpo) } : {})
});

async function fila(catalogoId, codigo, clave, nombre, marca) {
    return (await pool.query(
        `INSERT INTO public.catalogo_productos (negocio_id, catalogo_id, codigo_proveedor, clave_proveedor, nombre_proveedor, marca, precio_publico)
         VALUES ($1, $2, $3, $4, $5, $6, 100) RETURNING id`,
        [negocio.negocioId, catalogoId, codigo, clave, nombre, marca]
    )).rows[0].id;
}

before(async () => {
    await iniciarServidorPrueba();
    negocio = await crearNegocioPrueba("gafi-captura");

    const lista = (await pool.query(`INSERT INTO public.catalogos_proveedor (negocio_id, proveedor, total_productos) VALUES ($1, '004BE Durango   Lista de precio    01 Diciembre 2025', 2) RETURNING id`, [negocio.negocioId])).rows[0].id;
    const otra = (await pool.query(`INSERT INTO public.catalogos_proveedor (negocio_id, proveedor, total_productos) VALUES ($1, 'Diprofer', 1) RETURNING id`, [negocio.negocioId])).rows[0].id;

    gafi.engrapadora = await fila(lista, "G-280965", "HSG1406 / 17964", "Engrapadora t/pistola 6-14mm Ingco", "INGCO");
    gafi.martillo = await fila(lista, "G-284411", "BMAR-LDI09", "Martillo una curva 16oz Cadena", "CADENA");
    gafi.diprofer = await fila(otra, "D-1", "DIP-1", "Producto de Diprofer", "TRUPER");
});

after(async () => {
    if (negocio) {
        await pool.query(`DELETE FROM public.catalogo_productos WHERE negocio_id = $1`, [negocio.negocioId]);
        await pool.query(`DELETE FROM public.catalogos_proveedor WHERE negocio_id = $1`, [negocio.negocioId]);
        await borrarNegocioPrueba(negocio.negocioId);
    }
    await detenerServidorPrueba();
    await pool.end();
});

test("busca por clave del fabricante, por nombre y solo en la lista de Gafi", async () => {
    const porClave = await (await api("/gafi-captura/buscar?q=HSG1406")).json();
    assert.equal(porClave.productos.length, 1);
    assert.equal(porClave.productos[0].nombre, "Engrapadora t/pistola 6-14mm Ingco");

    const porNombre = await (await api("/gafi-captura/buscar?q=martillo%2016oz")).json();
    assert.equal(porNombre.productos[0].clave, "BMAR-LDI09");

    const deOtro = await (await api("/gafi-captura/buscar?q=Diprofer")).json();
    assert.equal(deOtro.productos.length, 0, "lo de otro proveedor no sale aqui");

    assert.equal((await (await api("/gafi-captura/buscar?q=a")).json()).productos.length, 0, "menos de 2 letras no busca");
});

test("guarda el codigo de barras solo si es real y no es de otro producto", async () => {
    const malo = await api(`/gafi-captura/${gafi.engrapadora}/codigo-barras`, "POST", { codigoBarras: "1234567890123" });
    assert.equal(malo.status, 400, "no pasa el digito verificador");

    const bueno = await (await api(`/gafi-captura/${gafi.engrapadora}/codigo-barras`, "POST", { codigoBarras: ` ${EAN_A} ` })).json();
    assert.equal(bueno.ok, true, JSON.stringify(bueno));
    assert.equal(bueno.producto.codigoBarras, EAN_A);

    const repetido = await api(`/gafi-captura/${gafi.martillo}/codigo-barras`, "POST", { codigoBarras: EAN_A });
    assert.equal(repetido.status, 409);
    assert.match((await repetido.json()).error, /Engrapadora/);

    assert.equal((await api(`/gafi-captura/${gafi.diprofer}/codigo-barras`, "POST", { codigoBarras: EAN_B })).status, 404, "un producto de Diprofer no se captura aqui");

    const cambio = await (await api(`/gafi-captura/${gafi.engrapadora}/codigo-barras`, "POST", { codigoBarras: EAN_B })).json();
    assert.equal(cambio.producto.codigoBarras, EAN_B, "se puede corregir");
    await api(`/gafi-captura/${gafi.engrapadora}/codigo-barras`, "POST", { codigoBarras: EAN_A });
});

test("con el codigo guardado, escanear ese empaque en Agregar producto lo reconoce", async () => {
    const r = await (await api(`/catalogo-proveedor/buscar-codigo?codigo=${EAN_A}&proveedor=gafi`)).json();
    assert.ok(r.producto, "lo encuentra por su codigo de barras");
    assert.equal(r.producto.nombre, "Engrapadora t/pistola 6-14mm Ingco");
});

test("guarda la foto, la devuelve y rechaza lo que no es imagen", async () => {
    const ok = await (await api(`/gafi-captura/${gafi.engrapadora}/foto`, "POST", { imagen: PNG })).json();
    assert.equal(ok.ok, true, JSON.stringify(ok));
    assert.equal(ok.producto.tieneFoto, true);

    const foto = await api(`/gafi-captura/${gafi.engrapadora}/foto`);
    assert.equal(foto.status, 200);
    assert.equal(foto.headers.get("content-type"), "image/png");
    assert.ok((await foto.arrayBuffer()).byteLength > 20);

    assert.equal((await api(`/gafi-captura/${gafi.martillo}/foto`)).status, 404, "sin foto no hay nada que servir");
    assert.equal((await api(`/gafi-captura/${gafi.martillo}/foto`, "POST", { imagen: "data:text/html;base64,PGI+" })).status, 400);
    assert.equal((await api(`/gafi-captura/${gafi.martillo}/foto`, "POST", { imagen: "no es una foto" })).status, 400);
    assert.equal((await api(`/gafi-captura/${gafi.diprofer}/foto`, "POST", { imagen: PNG })).status, 404);
});

test("el resumen cuenta lo avanzado", async () => {
    const r = await (await api("/gafi-captura/resumen")).json();
    assert.equal(r.total, 2);
    assert.equal(r.con_barras, 1);
    assert.equal(r.con_foto, 1);
});

test("solo el administrador entra y la pantalla esta cableada detras de su funcion", () => {
    const leer = ruta => fs.readFileSync(path.join(__dirname, "..", ruta), "utf8");
    const servidor = leer("gafi-captura-server.js");
    assert.match(servidor, /requerirPermiso\(PERMISOS\.ADMINISTRAR_USUARIOS\)/);
    assert.equal((servidor.match(/soloAdministrador,/g) || []).length, 5, "las 5 rutas son solo del administrador");

    const html = leer("public/index.html");
    assert.match(html, /data-beta="gafi_captura" hidden onclick="mostrarGafiCaptura\(\)"/);
    assert.match(html, /id="pantallaGafiCaptura"/);
    assert.match(leer("public/js/config-auth.js"), /"pantallaGafiCaptura"/);
    assert.match(leer("server-modules.js"), /gafi-captura-server/);
});
