// Envases retornables (abarrotes): el importe del envase vive aparte del producto, un negocio no ve el de otro, y la venta
// con "Trae envase" cobra el precio sin el envase y deja constancia en la linea.
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { pool, crearNegocioPrueba, borrarNegocioPrueba, crearProductoPrueba } = require("./helpers/negocio-prueba");
const { iniciarServidorPrueba, detenerServidorPrueba, BASE_URL } = require("./helpers/servidor-prueba");

const leer = ruta => fs.readFileSync(path.join(__dirname, "..", ruta), "utf8");
const headers = n => ({ "Content-Type": "application/json", "x-dispositivo-token": n.token });

let a;
let b;
let cerveza;

before(async () => {
    await iniciarServidorPrueba();
    a = await crearNegocioPrueba("envases-a");
    b = await crearNegocioPrueba("envases-b");
    cerveza = await crearProductoPrueba(a.negocioId, { nombre: "Cerveza Victoria 355 ml", precio: 22 });
});

after(async () => {
    if (a) await borrarNegocioPrueba(a.negocioId);
    if (b) await borrarNegocioPrueba(b.negocioId);
    await detenerServidorPrueba();
    await pool.end();
});

const poner = (negocio, productoId, importe) => fetch(`${BASE_URL}/envases/${productoId}`, { method: "PUT", headers: headers(negocio), body: JSON.stringify({ importe }) });
const mapa = async negocio => (await (await fetch(`${BASE_URL}/envases`, { headers: headers(negocio) })).json()).envases;

test("un negocio nuevo no tiene envases", async () => {
    assert.deepEqual(await mapa(a), {});
});

test("se guarda el importe del envase por producto y se puede cambiar", async () => {
    const r = await (await poner(a, cerveza.id, 8)).json();
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.equal((await mapa(a))[cerveza.id], 8);

    await poner(a, cerveza.id, "9,50");
    assert.equal((await mapa(a))[cerveza.id], 9.5, "acepta coma decimal");
});

test("importe vacio o cero quita el envase del producto", async () => {
    await poner(a, cerveza.id, 8);
    await poner(a, cerveza.id, "");
    assert.equal((await mapa(a))[cerveza.id], undefined);
});

test("un importe que no es numero se rechaza", async () => {
    const r = await poner(a, cerveza.id, "mucho");
    assert.equal(r.status, 400);
    const negativo = await poner(a, cerveza.id, -3);
    assert.equal(negativo.status, 400);
});

test("un negocio no puede poner envase al producto de otro, ni verlo", async () => {
    const ajeno = await poner(b, cerveza.id, 5);
    assert.equal(ajeno.status, 404);

    await poner(a, cerveza.id, 8);
    assert.deepEqual(await mapa(b), {}, "el otro negocio no ve el envase");
});

test("la funcion nace apagada y se llama 'envases'", async () => {
    const r = await (await fetch(`${BASE_URL}/funciones-beta`, { headers: headers(a) })).json();
    assert.equal(r.funciones.envases, false);
    assert.equal(r.nombres.envases, "Envases retornables");
});

test("la venta con envase devuelto cobra sin el envase y lo deja anotado", async () => {
    // El carrito manda el precio ya sin el envase ($22 - $8 = $14) y la marca; el servidor solo suma y guarda.
    await fetch(`${BASE_URL}/caja/abrir`, { method: "POST", headers: headers(a), body: JSON.stringify({ usuario: "prueba", fondoInicial: 100, notas: "" }) });

    const productos = [{ id: cerveza.id, codigo: "X", nombre: "Cerveza Victoria 355 ml", precio: 14, cantidad: 2, unidadVenta: "pieza", modoVenta: "bolsa", importe: 28, envaseDevuelto: true, envaseImporte: 8 }];
    const venta = await (await fetch(`${BASE_URL}/ventas`, { method: "POST", headers: headers(a), body: JSON.stringify({ productos, metodoPago: "efectivo", pagos: { efectivo: 28 }, recibido: 28, cambio: 0 }) })).json();

    assert.equal(venta.success, true, JSON.stringify(venta));
    const guardada = (await pool.query(`SELECT total, productos FROM public.historial_ventas WHERE negocio_id = $1 AND id = $2`, [a.negocioId, venta.historialId])).rows[0];
    assert.equal(Number(guardada.total), 28);
    assert.equal(guardada.productos[0].envaseDevuelto, true);
    assert.equal(guardada.productos[0].envaseImporte, 8);
});

test("el carrito: solo suma a la linea sin envase, descuenta por pieza y respeta el nivel de precio", () => {
    const ventas = leer("public/js/pos-sales.js");
    assert.match(ventas, /!item\.envaseDevuelto\s*\)?;/, "agregar suma solo a la linea sin envase devuelto");
    assert.match(ventas, /envaseImporte: modoVenta === "bolsa" && typeof envaseImporteDe === "function"/, "la linea nueva sabe el importe");
    assert.match(ventas, /alternarEnvaseDevueltoPOS\(\$\{index\}\)/, "boton en la linea");
    assert.match(ventas, /item\.precio - Number\(item\.envaseImporte\)/, "el nivel de precio sigue descontando el envase");
    assert.match(ventas, /base\.envaseDevuelto = true/, "la venta deja constancia");
    assert.match(ventas, /quitarUnoConPulso\(\$\{p\.id\}, \$\{index\}\)/, "el - actua sobre la linea tocada");
});

test("el boton solo existe con la funcion encendida y el formulario la oculta", () => {
    const html = leer("public/index.html");
    assert.match(html, /data-beta="envases" hidden>[\s\S]*?id="nuevoEnvaseImporte"/);
    assert.match(html, /js\/envases-pos\.js/);
    const cliente = leer("public/js/envases-pos.js");
    assert.match(cliente, /funcionBeta\("envases"\)/);
    assert.match(cliente, /pedirTextoPOS\(`¿Cuántos envases trae/, "pregunta cuantos si son varios");
    assert.match(leer("public/js/ticket-template.js"), /Envase devuelto \(-/, "el ticket lo muestra");
    assert.match(leer("public/js/product-inventory.js"), /guardarEnvaseProductoPOS/, "el formulario lo guarda");
});
