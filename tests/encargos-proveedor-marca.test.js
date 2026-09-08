// Explorar Nexo, paso 7: encargos_clientes_items gana proveedor/marca
// para poder cargar un hallazgo de Catalogo Nexo o de un catalogo de
// proveedor -- verifica que ambos endpoints de creacion (el de un
// encargo nuevo y el de agregar item a uno existente) los guardan y
// los regresan, y que un encargo creado a la manera de siempre (sin
// esos campos) sigue funcionando igual que antes.
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { crearNegocioPrueba, borrarNegocioPrueba } = require("./helpers/negocio-prueba");
const { iniciarServidorPrueba, detenerServidorPrueba, BASE_URL } = require("./helpers/servidor-prueba");

let negocio;

function headers() {
    return {
        "Content-Type": "application/json",
        "x-dispositivo-token": negocio.token
    };
}

before(async () => {
    await iniciarServidorPrueba();
    negocio = await crearNegocioPrueba("encargos-proveedor-marca");
});

after(async () => {
    if (negocio) await borrarNegocioPrueba(negocio.negocioId);
    await detenerServidorPrueba();
});

test("crear un encargo con proveedor/marca en el item los guarda y los regresa", async () => {
    const creado = await fetch(`${BASE_URL}/encargos-clientes`, {
        method: "POST",
        headers: headers(),
        body: JSON.stringify({
            clienteNombre: "Cliente de prueba Explorar Nexo",
            items: [{
                nombre: "Pinza cortacables de alta palanca, prueba automatizada",
                codigo: "17366",
                proveedor: "Diprofer",
                marca: "TRUPER",
                cantidad: 2,
                precioEstimado: 525
            }]
        })
    });
    assert.equal(creado.status, 200);
    const { id } = await creado.json();

    const detalle = await fetch(`${BASE_URL}/encargos-clientes/${id}`, { headers: headers() });
    assert.equal(detalle.status, 200);
    const datos = await detalle.json();

    assert.equal(datos.encargo.items.length, 1);
    assert.equal(datos.encargo.items[0].proveedor, "Diprofer");
    assert.equal(datos.encargo.items[0].marca, "TRUPER");
    assert.equal(datos.encargo.items[0].nombre, "Pinza cortacables de alta palanca, prueba automatizada");
});

test("agregar un item con proveedor/marca a un encargo ya existente", async () => {
    const creado = await fetch(`${BASE_URL}/encargos-clientes`, {
        method: "POST",
        headers: headers(),
        body: JSON.stringify({
            clienteNombre: "Cliente de prueba 2",
            items: [{ nombre: "Item inicial" }]
        })
    });
    const { id } = await creado.json();

    const agregado = await fetch(`${BASE_URL}/encargos-clientes/${id}/items`, {
        method: "POST",
        headers: headers(),
        body: JSON.stringify({
            nombre: "Cortador de cable y alambre, Truper",
            codigo: "14109",
            proveedor: "",
            marca: "TRUPER",
            cantidad: 1,
            precioEstimado: 240
        })
    });
    assert.equal(agregado.status, 200);
    const datos = await agregado.json();

    const nuevo = datos.encargo.items.find(item => item.nombre === "Cortador de cable y alambre, Truper");
    assert.ok(nuevo, "el item nuevo debe aparecer en la lista");
    assert.equal(nuevo.marca, "TRUPER");
    assert.equal(nuevo.proveedor, "", "proveedor vacio debe guardarse como cadena vacia, nunca romper el insert");
});

test("un encargo creado sin proveedor/marca (como siempre) sigue funcionando igual", async () => {
    const creado = await fetch(`${BASE_URL}/encargos-clientes`, {
        method: "POST",
        headers: headers(),
        body: JSON.stringify({
            clienteNombre: "Cliente de prueba clasico",
            items: [{ nombre: "Producto sin proveedor ni marca", cantidad: 1, precioEstimado: 50 }]
        })
    });
    assert.equal(creado.status, 200);
    const { id } = await creado.json();

    const detalle = await fetch(`${BASE_URL}/encargos-clientes/${id}`, { headers: headers() });
    const datos = await detalle.json();

    assert.equal(datos.encargo.items[0].proveedor, "");
    assert.equal(datos.encargo.items[0].marca, "");
});
