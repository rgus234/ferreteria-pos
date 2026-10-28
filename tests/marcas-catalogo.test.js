const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const marcas = require("../marcas-catalogo");

test("catalogo de marcas: 15 marcas, cada una con su logo y un color valido", () => {
    assert.equal(marcas.MARCAS.length, 15);

    for (const m of marcas.MARCAS) {
        assert.ok(["azul", "naranja", "verde", "rojo", "morado", "negro"].includes(m.color), `${m.nombre}: color`);
        assert.ok(fs.existsSync(path.join(__dirname, "..", "public", "marcas", `${m.id}.jpg`)), `${m.nombre}: falta su logo`);
        assert.match(marcas.logoDeMarca(m), /^data:image\/jpeg;base64,/);
    }
});

test("catalogo de marcas: reconoce el producto por palabra completa y no confunde", () => {
    const marca = n => marcas.marcaDeProducto(n)?.nombre ?? null;

    assert.equal(marca("Doritos Nacho Rojos 58 g"), "Sabritas");
    assert.equal(marca("Power Ade Morado 1 L"), "Coca-Cola");
    assert.equal(marca("E-Pura 600 ml"), "Pepsi");
    assert.equal(marca("Leche Nito 236 ml"), "Bimbo");
    assert.equal(marca("Jarritos Piña 600 ml"), "Jarritos");
    assert.equal(marca("Jarrito Piña 600 ml"), "Jarritos");
    assert.equal(marca("Peñafiel Twist 600 ml"), "Peñafiel");
    assert.equal(marca("Volt Yellow 473 ml"), "Volt");
    assert.equal(marca("Juanito Pan"), null, "'nito' dentro de otra palabra no cuenta");
    assert.equal(marca("Queso fresco 250 g"), null);
    assert.equal(marca("Refresco de cola 600 ml"), null);
});

test("catalogo de marcas: colocar un producto crea el exhibidor de su marca una vez y no duplica", async () => {
    const exhibidores = [];
    const espacios = [];
    const db = {
        async query(sql, p) {
            if (/FROM public\.exhibidores WHERE/.test(sql)) return { rows: exhibidores.filter(x => x.negocio === p[0] && x.nombre.toLowerCase() === p[1].toLowerCase()).map(x => ({ id: x.id })) };
            if (/INSERT INTO public\.exhibidores/.test(sql)) { const x = { id: exhibidores.length + 1, negocio: p[0], nombre: p[1], foto: p[4] }; exhibidores.push(x); return { rows: [{ id: x.id }] }; }
            if (/FROM public\.exhibidor_espacios WHERE negocio_id = \$1 AND producto_id/.test(sql)) return { rows: espacios.filter(e => e.producto === p[1]).map(() => ({ 1: 1 })) };
            if (/MAX\(orden\)/.test(sql)) return { rows: [{ o: espacios.filter(e => e.exhibidor === p[0]).length }] };
            if (/INSERT INTO public\.exhibidor_espacios/.test(sql)) { espacios.push({ exhibidor: p[1], producto: p[2] }); return { rows: [] }; }
            throw new Error("consulta inesperada: " + sql.slice(0, 60));
        }
    };

    assert.equal(await marcas.colocarProductoEnMarca(db, 7, 1, "Doritos Nacho 58 g"), "Sabritas");
    assert.equal(await marcas.colocarProductoEnMarca(db, 7, 2, "Cheetos Bolitas 43 g"), "Sabritas");
    assert.equal(exhibidores.length, 1, "un solo exhibidor Sabritas para los dos");
    assert.match(exhibidores[0].foto, /^data:image\/jpeg/, "con su logo");
    assert.equal(await marcas.colocarProductoEnMarca(db, 7, 1, "Doritos Nacho 58 g"), null, "ya estaba en un exhibidor: no se duplica");
    assert.equal(await marcas.colocarProductoEnMarca(db, 7, 3, "Aguacate (kg)"), null, "sin marca: nada");
    assert.equal(espacios.length, 2);
});

test("catalogo de marcas: conectado al alta de producto, al endpoint y al celular", () => {
    const leer = r => fs.readFileSync(path.join(__dirname, "..", r), "utf8");

    assert.match(leer("server.js"), /colocarProductoEnMarca\(pool, negocio\.id, productoId, nombre\)/);
    assert.match(leer("server.js"), /esNegocioDeAbarrotes/, "solo abarrotes");
    assert.match(leer("exhibidores-server.js"), /\/exhibidores\/marcas\/armar/);
    assert.match(leer("public/dueno-recibir-marca.js"), /\/exhibidores\/marcas\/armar/);
});
