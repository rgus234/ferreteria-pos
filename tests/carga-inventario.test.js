// Cargar inventario (carga rapida + pegar o subir mi lista) y perfil de equipo.
//
// Lo que se protege:
//  - una lista pegada de Excel o un CSV se entiende solo: separador, comillas,
//    encabezados en espanol, precios con $ y comas;
//  - lo que no sirve (sin nombre, precio raro) se separa y se explica, y lo que
//    ya existe nunca se vuelve a crear ni se pisa;
//  - cada alta pasa por la ruta de siempre (/agregar-producto), sin rutas nuevas;
//  - el perfil de equipo (lector, impresora, cajon) llega al punto de venta.

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
    ciNormalizar, ciDetectarDelimitador, ciParsearTabla, ciNumero, ciAdivinarColumnas,
    ciTieneEncabezado, ciPrepararFilas, ciProductoDesdeCatalogo, ciPrecioSugerido
} = require("../public/js/carga-inventario.js");

const publico = path.join(__dirname, "..", "public");
const leer = ruta => fs.readFileSync(path.join(publico, ruta), "utf8");

test("los precios se entienden con signo, comas de miles y decimales", () => {
    assert.equal(ciNumero("$1,250.50"), 1250.5);
    assert.equal(ciNumero("1.250,50"), 1250.5);
    assert.equal(ciNumero("12,5"), 12.5);
    assert.equal(ciNumero("1,250"), 1250);
    assert.equal(ciNumero("  35 "), 35);
    assert.equal(ciNumero("89.9"), 89.9);
    assert.equal(ciNumero("abc"), null);
    assert.equal(ciNumero(""), null);
    assert.equal(ciNumero(null), null);
});

test("el separador se detecta: tabuladores de Excel, punto y coma o comas", () => {
    assert.equal(ciDetectarDelimitador("a\tb\tc"), "\t");
    assert.equal(ciDetectarDelimitador("a;b;c"), ";");
    assert.equal(ciDetectarDelimitador("a,b,c"), ",");
    assert.equal(ciDetectarDelimitador("solo una columna"), ",");
});

test("la tabla se lee con comillas, saltos de linea de Windows y filas vacias", () => {
    const tabla = ciParsearTabla('Producto,Precio\r\n"Tornillo, 1/4",2.5\r\n\r\n"Cinta ""azul""",35\r\n');
    assert.deepEqual(tabla, [["Producto", "Precio"], ["Tornillo, 1/4", "2.5"], ['Cinta "azul"', "35"]]);

    assert.deepEqual(ciParsearTabla("Nombre\tPrecio\nMartillo\t$120"), [["Nombre", "Precio"], ["Martillo", "$120"]]);
    assert.deepEqual(ciParsearTabla(""), []);
});

test("las columnas se adivinan por su encabezado, sin repetir una columna para dos campos", () => {
    const m = ciAdivinarColumnas(["Descripción", "Precio de venta", "Existencia", "Código de barras", "Marca", "Departamento"]);
    assert.deepEqual(m, { nombre: 0, precio: 1, stock: 2, codigo: 3, marca: 4, categoria: 5 });

    const sinAcentos = ciAdivinarColumnas(["PRODUCTO", "PRECIO", "CANTIDAD"]);
    assert.equal(sinAcentos.nombre, 0);
    assert.equal(sinAcentos.precio, 1);
    assert.equal(sinAcentos.stock, 2);
    assert.equal(sinAcentos.codigo, -1, "lo que no hay queda en -1");

    // "Precio publico" no se confunde con "Codigo publico" ni se usa dos veces.
    const doble = ciAdivinarColumnas(["Nombre", "Precio", "Precio publico"]);
    assert.notEqual(doble.precio, -1);
});

test("la primera fila se reconoce como encabezado, o no", () => {
    assert.equal(ciTieneEncabezado(["Producto", "Precio", "Cantidad"]), true);
    assert.equal(ciTieneEncabezado(["Martillo", "120", "5"]), false, "una fila de datos no es encabezado");
    assert.equal(ciTieneEncabezado([]), false);
});

test("las filas se clasifican: listas, ya existen y con problemas (y nunca se repite lo de la misma lista)", () => {
    const existentes = { codigos: new Set(["7501111111111"]), nombres: new Set([ciNormalizar("Martillo Truper")]) };
    const mapeo = { nombre: 0, precio: 1, stock: 2, codigo: 3, marca: -1, categoria: -1 };

    const r = ciPrepararFilas([
        ["Tornillo 1/4", "$2.50", "500", ""],
        ["Broca 3/8", "1,250.00", "4", "7501111111111"],      // el codigo ya existe
        ["MARTILLO truper", "120", "3", ""],                   // el nombre ya existe (sin acentos ni mayusculas)
        ["", "10", "1", ""],                                   // sin nombre
        ["Llave", "abc", "1", ""],                             // precio raro
        ["Cinta", "35", "-4", ""],                             // cantidad negativa
        ["Tornillo 1/4", "3", "10", ""],                       // repetido en la misma lista
        ["Pinza", "89.9", "", "7502222222222"]                 // sin cantidad: 0
    ], mapeo, existentes);

    assert.deepEqual(r.listas.map(f => f.nombre), ["Tornillo 1/4", "Pinza"]);
    assert.equal(r.listas[0].precio, 2.5);
    assert.equal(r.listas[0].stock, 500);
    assert.equal(r.listas[1].stock, 0);
    assert.equal(r.duplicadas.length, 3, "codigo existente, nombre existente y repetido en la lista");
    assert.deepEqual(r.conProblemas.map(p => p.fila), [4, 5, 6]);
    assert.match(r.conProblemas[0].motivo, /nombre/i);
});

test("un resultado del catalogo se convierte en el cuerpo de /agregar-producto", () => {
    const delMaestro = {
        fuente: "catalogo_maestro", catalogoMaestroId: 2917, codigo: "12646", ean: "7501206668825",
        nombre: "Cinta métrica larga 30m", marca: "Truper", fabricante: "Truper", precioListaPublico: 340
    };

    assert.deepEqual(ciProductoDesdeCatalogo(delMaestro, { stock: 6, precio: 340 }), {
        nombre: "Cinta métrica larga 30m", precio: 340, precioPublico: 340, stock: 6,
        codigo: "7501206668825", marca: "Truper", proveedor: "Truper", catalogoMaestroId: 2917
    });

    const delProveedor = { fuente: "proveedor", codigo: "1234", nombre: "Pinza", marca: "Pretul", proveedor: "Diprofer", precioPublico: 99 };
    const cuerpo = ciProductoDesdeCatalogo(delProveedor, { stock: 2, precio: 99 });
    assert.equal(cuerpo.codigo, "1234", "sin EAN se usa el codigo del proveedor");
    assert.equal(cuerpo.proveedor, "Diprofer");
    assert.equal(cuerpo.catalogoMaestroId, undefined);

    assert.equal(ciPrecioSugerido(delMaestro), 340);
    assert.equal(ciPrecioSugerido(delProveedor), 99);
    assert.equal(ciPrecioSugerido({ fuente: "fabricante", precioListaPublico: 0 }), null, "un precio en cero no se sugiere");
});

test("las altas usan la ruta de siempre y la pantalla queda conectada al menu", () => {
    const js = leer("js/carga-inventario.js");
    const rutas = [...js.matchAll(/ciLlamar\(\s*["`]([^"`$?]+)/g)].map(m => m[1]);
    assert.ok(rutas.includes("/agregar-producto"));
    assert.ok(rutas.every(r => ["/agregar-producto", "/explorar-nexo/buscar"].includes(r)), `rutas usadas: ${rutas}`);

    const indice = leer("index.html");
    assert.match(indice, /id="pantallaCargaInventario"/);
    assert.match(indice, /data-shell-module="carga-inventario" onclick="mostrarCargaInventario\(\)"/);
    assert.match(indice, /js\/carga-inventario\.js\?v=/);
    assert.match(indice, /css\/components\/carga-inventario\.css\?v=/);
    assert.match(leer("js/config-auth.js"), /"pantallaCargaInventario"/, "la pantalla se oculta al cambiar de modulo");
    assert.match(leer("js/shell-topbar.js"), /"carga-inventario"/);
});

test("el asistente cierra llevando a Cargar inventario", () => {
    const asistente = leer("js/asistente-inicio.js");
    assert.match(asistente, /primerPaso === "agregar_productos" && typeof mostrarCargaInventario === "function"/);
    assert.match(asistente, /Cargar mi inventario/);
});

test("el perfil de equipo es un paso del asistente y llega al punto de venta", () => {
    const asistente = leer("js/asistente-inicio.js");
    assert.match(asistente, /const ASISTENTE_PASOS = \[[^\]]*"vende", "equipo", "listo"\]/);
    assert.match(asistente, /function asistentePintarEquipo\(\)/);

    for (const pregunta of ['"lector"', '"impresora"', '"cajon"']) {
        assert.ok(asistente.includes(`asistentePregunta(${pregunta}`), `falta la pregunta ${pregunta}`);
    }

    // Lo que se contesta se aplica a ESTA computadora.
    assert.match(asistente, /cambios\.usaLector = false/);
    assert.match(asistente, /cambios\.imprimirAutomatico = false/);
    assert.match(asistente, /cambios\.abrirCajonDespuesTicket = true/);

    // Sin lector, el carrito vacio pide buscar por nombre.
    assert.match(leer("js/pos-sales.js"), /usaLector === false[\s\S]{0,200}Busca un producto para empezar/);

    // Reconectar la computadora no borra el equipo elegido.
    const config = leer("js/config-auth.js");
    assert.match(config, /for \(const clave of \["usaLector", "imprimirAutomatico", "abrirCajonDespuesTicket"\]\)/);
    assert.match(config, /id="configUsaLector"/, "se puede cambiar despues en Configuracion");
});
