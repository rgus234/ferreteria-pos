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

test("celular: la entrada sale en Mas solo con la funcion encendida, usa las mismas rutas y el cache del celular se renueva", () => {
    const leer = ruta => fs.readFileSync(path.join(__dirname, "..", ruta), "utf8");
    const js = leer("public/dueno-gafi.js");

    assert.match(js, /funciones\?\.gafi_captura !== true/, "sin la funcion no hay entrada");
    ["/gafi-captura/resumen", "/gafi-captura/buscar", "/codigo-barras", "/foto"].forEach(ruta => assert.ok(js.includes(ruta), `usa ${ruta}`));
    assert.match(js, /abrirEscanerCodigoDueno/, "escanea con la camara del celular");

    const html = leer("public/dueno.html");
    const sw = leer("public/dueno-sw.js");
    assert.match(html, /dueno-gafi\.js\?v=(gafi-[0-9-]+)/);
    const version = /dueno-gafi\.js\?v=(gafi-[0-9-]+)/.exec(html)[1];
    assert.ok(sw.includes(`/dueno-gafi.js?v=${version}`) && sw.includes(`/dueno-gafi.css?v=${version}`), "el celular guarda los archivos nuevos para abrir sin internet");
});

// ---------------------------------------------------------------- buscador tolerante

test("buscador: entiende lo escrito (codigos con espacios, palabras de relleno, acentos)", () => {
    const { entenderConsulta } = require("../gafi-captura-server");

    assert.deepEqual(entenderConsulta("resistol 500 dice idh 23 74 72 5"), { terminos: ["resistol", "500"], codigos: ["2374725"] });
    assert.deepEqual(entenderConsulta("IDH 2374725").codigos, ["2374725"]);
    assert.deepEqual(entenderConsulta("Pegamento 850 CLÁSICO").terminos, ["pegamento", "850", "clasico"]);
    assert.deepEqual(entenderConsulta("hsg1406").codigos, ["hsg1406"]);
    assert.deepEqual(entenderConsulta("1 2").codigos, [], "dos numeros chicos no forman un codigo");
});

test("buscador: encuentra aunque se escriba mal, con numeros separados o con palabras de mas", async () => {
    const lista = (await pool.query(`SELECT id FROM public.catalogos_proveedor WHERE negocio_id = $1 AND proveedor ~* 'gafi|004be'`, [negocio.negocioId])).rows[0].id;
    await fila(lista, "G-R1", "1857127", "Pegamento 850 clasico 500gr resistol", "RESISTOL");
    await fila(lista, "G-R2", "1513922/2373802", "Pegamento 5000 clasico 1lt resistol", "RESISTOL");
    await fila(lista, "G-R3", "", "Resanador p/madera 875 caoba 500ml Resistol", "RESISTOL");
    await fila(lista, "G-R4", "", "Pegamento 5000 calzado 21ml resistol", "RESISTOL");

    const buscar = async q => (await (await api(`/gafi-captura/buscar?q=${encodeURIComponent(q)}`)).json()).productos;
    const nombres = r => r.map(p => p.nombre);

    // "500" pide 500 (500gr, 500ml), no "5000": las de 500 van primero.
    const r1 = await buscar("resistol 500");
    const posicion = texto => nombres(r1).findIndex(n => n.includes(texto));
    assert.ok(posicion("500gr") >= 0 && posicion("500ml") >= 0, "salen las de 500");
    assert.ok(posicion("500gr") < posicion("5000 calzado"), "500gr va antes que 5000");
    assert.ok(posicion("500ml") < posicion("5000 calzado"));

    assert.ok(nombres(await buscar("resitol 500")).some(n => n.includes("500gr")), "perdona una letra");
    assert.ok(nombres(await buscar("PEGAMENTO 850 CLÁSICO")).some(n => n.includes("850 clasico 500gr")), "ignora acentos y mayusculas");

    // El codigo del empaque, con espacios y con la palabra de relleno: el producto con ese codigo en su clave va primero.
    for (const q of ["idh 23 73 80 2", "IDH 2373802", "2373802"]) {
        const r = await buscar(q);
        assert.equal(r[0].nombre, "Pegamento 5000 clasico 1lt resistol", q);
        assert.equal(r[0].coincidencia, "exacta");
    }

    // Un codigo que no existe no tapa lo demas: se encuentra por marca y medida.
    assert.ok(nombres(await buscar("resistol 500 dice idh 23 74 72 5")).some(n => n.includes("500gr")));
});

test("buscador: sin coincidencia completa muestra las parecidas aparte, y lo que no tiene nada no devuelve nada", async () => {
    const buscar = async q => (await (await api(`/gafi-captura/buscar?q=${encodeURIComponent(q)}`)).json()).productos;

    const parecidas = await buscar("resistol 999");
    assert.ok(parecidas.length > 0, "no se queda en blanco");
    assert.ok(parecidas.every(p => p.coincidencia === "parcial"), "ninguna cumple con 999: todas van como parecidas");

    assert.deepEqual(await buscar("qwxzvk"), []);
    assert.equal((await buscar("diprofer")).length, 0, "lo de otro proveedor sigue sin salir");
});

test("buscador: despues de guardar un codigo de barras se puede buscar por ese codigo", async () => {
    const r = await (await api("/gafi-captura/buscar?q=resistol%20850")).json();
    const producto = r.productos.find(p => p.nombre.includes("850 clasico 500gr"));
    assert.ok(producto);

    const guardado = await (await api(`/gafi-captura/${producto.id}/codigo-barras`, "POST", { codigoBarras: "7501001234560" })).json();
    assert.equal(guardado.ok, true, JSON.stringify(guardado));

    const porCodigo = await (await api("/gafi-captura/buscar?q=7501001234560")).json();
    assert.equal(porCodigo.productos[0].id, producto.id, "la lista en memoria se refresco");
    assert.equal(porCodigo.productos[0].codigoBarras, "7501001234560");
});
