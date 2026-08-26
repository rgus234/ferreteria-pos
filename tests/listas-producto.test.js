// Corre contra la base de datos real (no hay una de pruebas separada
// en este proyecto) -- todo queda aislado en negocios sinteticos
// propios y se borra al terminar. Ver tests/helpers/negocio-prueba.js.

const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { pool, crearNegocioPrueba, crearProductoPrueba, borrarNegocioPrueba } = require("./helpers/negocio-prueba");
const { iniciarServidorPrueba, detenerServidorPrueba, BASE_URL } = require("./helpers/servidor-prueba");

let negocio;
let otroNegocio;

before(async () => {
    await iniciarServidorPrueba();
    negocio = await crearNegocioPrueba("listas-producto");
    otroNegocio = await crearNegocioPrueba("listas-producto-otro");
});

after(async () => {
    if (negocio) await borrarNegocioPrueba(negocio.negocioId);
    if (otroNegocio) await borrarNegocioPrueba(otroNegocio.negocioId);
    await detenerServidorPrueba();
    await pool.end();
});

function headersNegocio(token) {
    return { "Content-Type": "application/json", "x-dispositivo-token": token };
}

test("crea una lista con productos y los items reflejan el precio y stock actuales del producto", async () => {
    const producto = await crearProductoPrueba(negocio.negocioId, { nombre: "Cuaderno profesional", precio: 25, stock: 40 });

    const respuesta = await fetch(`${BASE_URL}/listas-producto`, {
        method: "POST",
        headers: headersNegocio(negocio.token),
        body: JSON.stringify({
            nombre: "Utiles 3er grado",
            descripcion: "Lista de temporada",
            items: [{ productoId: producto.id, cantidad: 3 }]
        })
    });

    const datos = await respuesta.json();

    assert.equal(respuesta.status, 200);
    assert.equal(datos.ok, true);
    assert.equal(datos.lista.nombre, "Utiles 3er grado");
    assert.equal(datos.lista.items.length, 1);
    assert.equal(datos.lista.items[0].productoId, producto.id);
    assert.equal(datos.lista.items[0].cantidad, 3);
    assert.equal(Number(datos.lista.items[0].precio), 25);
    assert.equal(Number(datos.lista.items[0].stock), 40);
});

test("una lista no puede tomar prestado un producto de otro negocio", async () => {
    const productoAjeno = await crearProductoPrueba(otroNegocio.negocioId, { nombre: "Producto de otro negocio" });
    const productoPropio = await crearProductoPrueba(negocio.negocioId, { nombre: "Producto propio" });

    const respuesta = await fetch(`${BASE_URL}/listas-producto`, {
        method: "POST",
        headers: headersNegocio(negocio.token),
        body: JSON.stringify({
            nombre: "Lista con producto ajeno",
            items: [
                { productoId: productoAjeno.id, cantidad: 1 },
                { productoId: productoPropio.id, cantidad: 1 }
            ]
        })
    });

    const datos = await respuesta.json();

    assert.equal(respuesta.status, 200);
    assert.equal(datos.lista.items.length, 1, "el producto de otro negocio debe descartarse silenciosamente");
    assert.equal(datos.lista.items[0].productoId, productoPropio.id);
});

test("agregar el mismo producto dos veces a una lista suma la cantidad en vez de duplicar", async () => {
    const producto = await crearProductoPrueba(negocio.negocioId, { nombre: "Lapiz" });

    const creada = await (await fetch(`${BASE_URL}/listas-producto`, {
        method: "POST",
        headers: headersNegocio(negocio.token),
        body: JSON.stringify({ nombre: "Lista lapices", items: [{ productoId: producto.id, cantidad: 2 }] })
    })).json();

    const respuesta = await fetch(`${BASE_URL}/listas-producto/${creada.lista.id}/items`, {
        method: "POST",
        headers: headersNegocio(negocio.token),
        body: JSON.stringify({ productoId: producto.id, cantidad: 5 })
    });

    const datos = await respuesta.json();

    assert.equal(respuesta.status, 200);
    assert.equal(datos.lista.items.length, 1, "no debe crear un segundo renglon para el mismo producto");
    assert.equal(datos.lista.items[0].cantidad, 7);
});

test("PATCH actualiza nombre, descripcion y activa de una lista", async () => {
    const producto = await crearProductoPrueba(negocio.negocioId);

    const creada = await (await fetch(`${BASE_URL}/listas-producto`, {
        method: "POST",
        headers: headersNegocio(negocio.token),
        body: JSON.stringify({ nombre: "Lista original", items: [{ productoId: producto.id, cantidad: 1 }] })
    })).json();

    const respuesta = await fetch(`${BASE_URL}/listas-producto/${creada.lista.id}`, {
        method: "PATCH",
        headers: headersNegocio(negocio.token),
        body: JSON.stringify({ nombre: "Lista renombrada", descripcion: "Nueva descripcion", activa: false })
    });

    const datos = await respuesta.json();

    assert.equal(respuesta.status, 200);
    assert.equal(datos.lista.nombre, "Lista renombrada");
    assert.equal(datos.lista.descripcion, "Nueva descripcion");
    assert.equal(datos.lista.activa, false);
});

test("PATCH de un item actualiza su cantidad y DELETE lo quita de la lista", async () => {
    const producto = await crearProductoPrueba(negocio.negocioId);

    const creada = await (await fetch(`${BASE_URL}/listas-producto`, {
        method: "POST",
        headers: headersNegocio(negocio.token),
        body: JSON.stringify({ nombre: "Lista items", items: [{ productoId: producto.id, cantidad: 1 }] })
    })).json();

    const itemId = creada.lista.items[0].id;

    const actualizada = await (await fetch(`${BASE_URL}/listas-producto/${creada.lista.id}/items/${itemId}`, {
        method: "PATCH",
        headers: headersNegocio(negocio.token),
        body: JSON.stringify({ cantidad: 9 })
    })).json();

    assert.equal(actualizada.lista.items[0].cantidad, 9);

    const respuestaDelete = await fetch(`${BASE_URL}/listas-producto/${creada.lista.id}/items/${itemId}`, {
        method: "DELETE",
        headers: headersNegocio(negocio.token)
    });

    const borrada = await respuestaDelete.json();

    assert.equal(respuestaDelete.status, 200);
    assert.equal(borrada.lista.items.length, 0);
});

test("DELETE de la lista completa tambien borra sus items", async () => {
    const producto = await crearProductoPrueba(negocio.negocioId);

    const creada = await (await fetch(`${BASE_URL}/listas-producto`, {
        method: "POST",
        headers: headersNegocio(negocio.token),
        body: JSON.stringify({ nombre: "Lista a borrar", items: [{ productoId: producto.id, cantidad: 1 }] })
    })).json();

    const respuesta = await fetch(`${BASE_URL}/listas-producto/${creada.lista.id}`, {
        method: "DELETE",
        headers: headersNegocio(negocio.token)
    });

    assert.equal(respuesta.status, 200);

    const items = await pool.query(
        "SELECT id FROM public.listas_producto_items WHERE lista_id = $1",
        [creada.lista.id]
    );

    assert.equal(items.rows.length, 0, "los items deben desaparecer junto con la lista");
});

test("un negocio no puede ver ni editar la lista de otro negocio", async () => {
    const producto = await crearProductoPrueba(negocio.negocioId);

    const creada = await (await fetch(`${BASE_URL}/listas-producto`, {
        method: "POST",
        headers: headersNegocio(negocio.token),
        body: JSON.stringify({ nombre: "Lista privada", items: [{ productoId: producto.id, cantidad: 1 }] })
    })).json();

    const respuestaGet = await fetch(`${BASE_URL}/listas-producto/${creada.lista.id}`, {
        headers: headersNegocio(otroNegocio.token)
    });

    assert.equal(respuestaGet.status, 404);

    const respuestaDelete = await fetch(`${BASE_URL}/listas-producto/${creada.lista.id}`, {
        method: "DELETE",
        headers: headersNegocio(otroNegocio.token)
    });

    assert.equal(respuestaDelete.status, 404);
});

test("las rutas de listas-producto rechazan peticiones sin token de dispositivo", async () => {
    const respuesta = await fetch(`${BASE_URL}/listas-producto`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nombre: "Sin token", items: [] })
    });

    assert.equal(respuesta.status, 401);
});
