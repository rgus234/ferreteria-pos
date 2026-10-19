// Exhibidores (displays con tarjetas visuales).
//
// Lo que se protege:
//  - un negocio solo ve y toca SUS exhibidores, y nunca puede meter en ellos un
//    producto de otro negocio;
//  - un producto aparece una sola vez por exhibidor (409 al repetirlo);
//  - los espacios resuelven nombre/precio/existencia EN VIVO contra productos y
//    "faltan" = capacidad - existencia (incluyendo la fraccion de stock_resto);
//  - borrar un exhibidor NO toca los productos ni su inventario.

const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { pool, crearNegocioPrueba, crearProductoPrueba, borrarNegocioPrueba } = require("./helpers/negocio-prueba");
const { iniciarServidorPrueba, detenerServidorPrueba, BASE_URL } = require("./helpers/servidor-prueba");

let negocioA;
let negocioB;
let broca;
let lija;
let productoAjeno;

function headers(negocio) {
    return { "Content-Type": "application/json", "x-dispositivo-token": negocio.token };
}

async function llamar(negocio, ruta, opciones = {}) {
    const respuesta = await fetch(`${BASE_URL}${ruta}`, { ...opciones, headers: headers(negocio) });
    return { status: respuesta.status, cuerpo: await respuesta.json() };
}

before(async () => {
    await iniciarServidorPrueba();
    negocioA = await crearNegocioPrueba("exhibidores-a");
    negocioB = await crearNegocioPrueba("exhibidores-b");
    broca = await crearProductoPrueba(negocioA.negocioId, { nombre: "Broca 1/4 de prueba", precio: 35, stock: 4 });
    lija = await crearProductoPrueba(negocioA.negocioId, { nombre: "Lija 120 de prueba", precio: 12, stock: 0 });
    productoAjeno = await crearProductoPrueba(negocioB.negocioId, { nombre: "Producto de otro negocio", precio: 99, stock: 5 });
});

after(async () => {
    if (negocioA) await borrarNegocioPrueba(negocioA.negocioId);
    if (negocioB) await borrarNegocioPrueba(negocioB.negocioId);
    await detenerServidorPrueba();
    await pool.end();
});

test("crear un exhibidor con espacios y leerlo con datos en vivo", async () => {
    const { status, cuerpo } = await llamar(negocioA, "/exhibidores", {
        method: "POST",
        body: JSON.stringify({
            nombre: "  Despachador de brocas  ",
            color: "naranja",
            espacios: [
                { productoId: broca.id, etiqueta: "Cajon 1", capacidad: 10 },
                { productoId: lija.id, capacidad: 5 }
            ]
        })
    });

    assert.equal(status, 201);
    assert.equal(cuerpo.exhibidor.nombre, "Despachador de brocas");
    assert.equal(cuerpo.exhibidor.color, "naranja");
    assert.equal(cuerpo.exhibidor.espacios.length, 2);

    const [espacioBroca, espacioLija] = cuerpo.exhibidor.espacios;
    assert.equal(espacioBroca.nombre, "Broca 1/4 de prueba");
    assert.equal(espacioBroca.precio, 35);
    assert.equal(espacioBroca.existencia, 4);
    assert.equal(espacioBroca.faltan, 6, "capacidad 10 - existencia 4");
    assert.equal(espacioLija.existencia, 0);
    assert.equal(espacioLija.faltan, 5);

    global.__exhibidorId = cuerpo.exhibidor.id;
});

test("faltan toma en cuenta la fraccion de stock_resto", async () => {
    await pool.query(`UPDATE public.productos SET stock_resto = 0.5 WHERE id = $1`, [broca.id]);

    const { cuerpo } = await llamar(negocioA, `/exhibidores/${global.__exhibidorId}`);
    const espacio = cuerpo.exhibidor.espacios.find(e => e.productoId === broca.id);

    assert.equal(espacio.existencia, 4.5);
    assert.equal(espacio.faltan, 5.5);
});

test("el color invalido cae a azul y el nombre vacio se rechaza", async () => {
    const vacio = await llamar(negocioA, "/exhibidores", { method: "POST", body: JSON.stringify({ nombre: "   " }) });
    assert.equal(vacio.status, 400);

    const raro = await llamar(negocioA, "/exhibidores", { method: "POST", body: JSON.stringify({ nombre: "Color raro", color: "fucsia-neon" }) });
    assert.equal(raro.status, 201);
    assert.equal(raro.cuerpo.exhibidor.color, "azul");
});

test("un producto no se repite en el mismo exhibidor (409)", async () => {
    const { status } = await llamar(negocioA, `/exhibidores/${global.__exhibidorId}/espacios`, {
        method: "POST",
        body: JSON.stringify({ productoId: broca.id })
    });

    assert.equal(status, 409);
});

test("un producto de otro negocio nunca entra a mi exhibidor", async () => {
    const agregar = await llamar(negocioA, `/exhibidores/${global.__exhibidorId}/espacios`, {
        method: "POST",
        body: JSON.stringify({ productoId: productoAjeno.id })
    });
    assert.equal(agregar.status, 404);

    const alCrear = await llamar(negocioA, "/exhibidores", {
        method: "POST",
        body: JSON.stringify({ nombre: "Intento de colar", espacios: [{ productoId: productoAjeno.id }, { productoId: broca.id }] })
    });
    assert.equal(alCrear.status, 201);
    assert.equal(alCrear.cuerpo.exhibidor.espacios.length, 1, "solo entra el producto propio");
    assert.equal(alCrear.cuerpo.exhibidor.espacios[0].productoId, broca.id);
});

test("otro negocio no ve, edita ni borra mis exhibidores", async () => {
    const lista = await llamar(negocioB, "/exhibidores");
    assert.equal(lista.cuerpo.exhibidores.length, 0);

    const leer = await llamar(negocioB, `/exhibidores/${global.__exhibidorId}`);
    assert.equal(leer.status, 404);

    const editar = await llamar(negocioB, `/exhibidores/${global.__exhibidorId}`, { method: "PATCH", body: JSON.stringify({ nombre: "Hackeado" }) });
    assert.equal(editar.status, 404);

    const borrar = await llamar(negocioB, `/exhibidores/${global.__exhibidorId}`, { method: "DELETE" });
    assert.equal(borrar.status, 404);

    const intacto = await llamar(negocioA, `/exhibidores/${global.__exhibidorId}`);
    assert.equal(intacto.cuerpo.exhibidor.nombre, "Despachador de brocas");
});

test("el listado trae conteos, agotados y vista previa", async () => {
    const { cuerpo } = await llamar(negocioA, "/exhibidores");
    const despachador = cuerpo.exhibidores.find(item => item.id === global.__exhibidorId);

    assert.equal(despachador.totalEspacios, 2);
    assert.equal(despachador.agotados, 1, "la lija esta en 0");
    assert.deepEqual(despachador.vistaPrevia, [broca.id, lija.id]);
});

test("editar capacidad y lugar de un espacio, y quitarlo", async () => {
    const lectura = await llamar(negocioA, `/exhibidores/${global.__exhibidorId}`);
    const espacioLija = lectura.cuerpo.exhibidor.espacios.find(e => e.productoId === lija.id);

    const editado = await llamar(negocioA, `/exhibidores/${global.__exhibidorId}/espacios/${espacioLija.id}`, {
        method: "PATCH",
        body: JSON.stringify({ etiqueta: "Cajon 2", capacidad: 20 })
    });
    assert.equal(editado.status, 200);
    const cambiado = editado.cuerpo.exhibidor.espacios.find(e => e.productoId === lija.id);
    assert.equal(cambiado.etiqueta, "Cajon 2");
    assert.equal(cambiado.capacidad, 20);

    const quitado = await llamar(negocioA, `/exhibidores/${global.__exhibidorId}/espacios/${espacioLija.id}`, { method: "DELETE" });
    assert.equal(quitado.status, 200);
    assert.equal(quitado.cuerpo.exhibidor.espacios.length, 1);
});

test("borrar un exhibidor no toca los productos ni su inventario", async () => {
    const borrar = await llamar(negocioA, `/exhibidores/${global.__exhibidorId}`, { method: "DELETE" });
    assert.equal(borrar.status, 200);

    const producto = await pool.query(`SELECT stock FROM public.productos WHERE id = $1`, [broca.id]);
    assert.equal(producto.rows.length, 1, "el producto sigue existiendo");
    assert.equal(Number(producto.rows[0].stock), 4, "el inventario no cambio");

    const espacios = await pool.query(`SELECT 1 FROM public.exhibidor_espacios WHERE exhibidor_id = $1`, [global.__exhibidorId]);
    assert.equal(espacios.rows.length, 0, "sus espacios se borraron en cascada");
});
