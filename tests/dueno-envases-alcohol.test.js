// Envases retornables y venta de alcohol en Vender del celular (/dueno): mismas reglas que la computadora.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const leer = ruta => fs.readFileSync(path.join(__dirname, "..", "public", ruta), "utf8");

// Los arreglos del contexto aislado de vm no son del mismo "mundo" que los de la prueba: se comparan como JSON.
const plano = valor => JSON.parse(JSON.stringify(valor));

function cargarFunciones(carrito) {
    const fuente = leer("dueno.js").replace(/\r\n/g, "\n");
    const inicio = fuente.indexOf("function envasesDevueltosDueno(item)");
    const finMarca = "    return lineas;\n}";
    const fin = fuente.indexOf(finMarca, inicio) + finMarca.length;
    assert.ok(inicio > 0 && fin > inicio, "no se encontraron las funciones de envase");
    const contexto = { duenoVentaCarrito: carrito };
    vm.createContext(contexto);
    vm.runInContext(fuente.slice(inicio, fin).replace(/\r\n/g, "\n"), contexto);
    return contexto;
}

test("envase: el total descuenta el importe por pieza devuelta y la linea se separa en con/sin envase", () => {
    const item = { id: 7, codigo: "X", nombre: "Cerveza", precio: 22, cantidad: 3, unidadVenta: "pieza", modoVenta: "bolsa", envaseImporte: 8, envaseDevueltos: 2 };
    const f = cargarFunciones([item]);

    assert.equal(f.importeLineaVenderDueno(item), 50, "3 x $22 - 2 envases de $8");
    const lineas = f.productosVentaVenderDueno();
    assert.deepEqual(plano(lineas.map(l => [l.cantidad, l.precio, l.importe, Boolean(l.envaseDevuelto)])), [[1, 22, 22, false], [2, 14, 28, true]]);
    assert.equal(lineas[1].envaseImporte, 8);
    assert.equal(lineas.reduce((s, l) => s + l.importe, 0), 50, "lo que se manda suma lo mismo que el carrito");

    item.envaseDevueltos = 3;
    assert.deepEqual(plano(f.productosVentaVenderDueno().map(l => [l.cantidad, l.precio, Boolean(l.envaseDevuelto)])), [[3, 14, true]], "todas con envase: una sola linea");

    item.envaseDevueltos = 9;
    assert.equal(f.importeLineaVenderDueno(item), 42, "nunca mas envases que piezas");

    item.envaseDevueltos = 0;
    assert.deepEqual(plano(f.productosVentaVenderDueno().map(l => [l.cantidad, l.precio, Boolean(l.envaseDevuelto)])), [[3, 22, false]]);
});

test("envase: un producto sin envase (o con la funcion apagada) se cobra exactamente igual que antes", () => {
    const item = { id: 1, codigo: "A", nombre: "Galletas", precio: 15, cantidad: 2, unidadVenta: "pieza", modoVenta: "bolsa", costoConocido: true, costo: 9 };
    const f = cargarFunciones([item]);

    assert.equal(f.importeLineaVenderDueno(item), 30);
    const [linea] = f.productosVentaVenderDueno();
    assert.equal(linea.importe, 30);
    assert.equal(linea.costo, 9, "el costo conocido sigue viajando");
    assert.equal("envaseDevuelto" in linea, false);

    const regalo = { id: 2, nombre: "Barato", precio: 5, cantidad: 1, envaseImporte: 8, envaseDevueltos: 1 };
    assert.equal(cargarFunciones([regalo]).importeLineaVenderDueno(regalo), 0, "el envase nunca deja el precio en negativo");
});

test("celular: el carrito, el cobro de contado y el fiado usan el envase y piden PIN por alcohol fuera de horario", () => {
    const js = leer("dueno.js");
    assert.equal((js.match(/productos: productosVentaVenderDueno\(\)/g) || []).length, 2, "contado y fiado mandan las lineas separadas");
    assert.match(js, /acumulado \+ importeLineaVenderDueno\(item\)/, "el subtotal descuenta el envase");
    assert.match(js, /envaseControlHtmlDueno\(item\)/, "boton de envase en la linea");
    assert.equal((js.match(/pedirPinAdministradorParaAlcoholDueno/g) || []).length, 2, "contado y fiado");
    assert.match(js, /avisoAlcoholCobroDueno\(\)/, "aviso de 18 anos en el cobro");
    assert.match(js, /Sin internet no se puede autorizar con el PIN de administrador/);
});

test("celular: los archivos nuevos estan en la pagina y en el cache, y el cache sube de version", () => {
    const html = leer("dueno.html");
    const sw = leer("dueno-sw.js");

    for (const archivo of ["dueno-envases-alcohol.js", "dueno-envases-alcohol.css"]) {
        assert.ok(html.includes(archivo), `${archivo} en dueno.html`);
        assert.ok(sw.includes(`/${archivo}?v=`), `${archivo} en el cache`);
    }

    assert.match(sw, /nexo-dueno-shell-v13[6-9]|nexo-dueno-shell-v1[4-9]\d/);
    const cliente = leer("dueno-envases-alcohol.js");
    assert.match(cliente, /f\.envases === true/);
    assert.match(cliente, /f\.alcohol === true/);
    assert.match(cliente, /fetchAutenticado/);
});
