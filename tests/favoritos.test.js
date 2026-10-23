// Venta rapida con favoritos (abarrotes).
//
// Lo que se protege:
//  - la lista es ordenada y se guarda en el negocio (no en la computadora);
//  - solo se pueden marcar productos propios, sin repetir y hasta el maximo;
//  - "lo que mas vendo" sugiere por ventas reales (sin canceladas ni lo que ya es favorito);
//  - un negocio no ve ni cambia los favoritos de otro;
//  - la franja solo aparece en el perfil simple y un toque no redibuja las fotos.
//
// Requiere la migracion 20261029_favoritos_orden.sql.

const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { pool, crearNegocioPrueba, borrarNegocioPrueba } = require("./helpers/negocio-prueba");
const { iniciarServidorPrueba, detenerServidorPrueba, BASE_URL } = require("./helpers/servidor-prueba");

let negocio;
let otro;
let ids = {};

const headers = (n = negocio) => ({ "Content-Type": "application/json", "x-dispositivo-token": n.token });
const get = (n = negocio) => fetch(`${BASE_URL}/venta-rapida/favoritos`, { headers: headers(n) });
const put = (cuerpo, n = negocio) => fetch(`${BASE_URL}/venta-rapida/favoritos`, { method: "PUT", headers: headers(n), body: JSON.stringify(cuerpo) });

async function producto(n, nombre) {
    return (await pool.query(
        `INSERT INTO public.productos (negocio_id, nombre, precio, precio_publico, stock) VALUES ($1, $2, 10, 10, 5) RETURNING id`,
        [n.negocioId, nombre]
    )).rows[0].id;
}

async function venta(productoId, cantidad, estado = "completada") {
    await pool.query(
        `INSERT INTO public.historial_ventas (negocio_id, total, fecha, productos, estado, metodo_pago, pago_efectivo)
         VALUES ($1, 10, NOW(), $2::jsonb, $3, 'efectivo', 10)`,
        [negocio.negocioId, JSON.stringify([{ id: productoId, cantidad, importe: cantidad * 10 }]), estado]
    );
}

before(async () => {
    await iniciarServidorPrueba();
    negocio = await crearNegocioPrueba("fav-a");
    otro = await crearNegocioPrueba("fav-b");

    for (const nombre of ["Coca", "Sabritas", "Pan", "Leche", "Huevo"]) ids[nombre] = await producto(negocio, nombre);
    ids.ajeno = await producto(otro, "Producto de otro negocio");

    await venta(ids.Coca, 10);
    await venta(ids.Sabritas, 6);
    await venta(ids.Pan, 3);
    await venta(ids.Leche, 500, "cancelada"); // no cuenta
});

after(async () => {
    if (negocio) await borrarNegocioPrueba(negocio.negocioId);
    if (otro) await borrarNegocioPrueba(otro.negocioId);
    await detenerServidorPrueba();
    await pool.end();
});

test("sin favoritos sugiere lo que mas se vende, sin canceladas", async () => {
    const d = await (await get()).json();

    assert.deepEqual(d.ids, []);
    assert.deepEqual(d.sugeridos.map(s => s.productoId), [ids.Coca, ids.Sabritas, ids.Pan], "por unidades vendidas; la Leche cancelada no entra");
    assert.equal(d.maximo, 24);
});

test("la lista se guarda en el orden que llega y los sugeridos ya no repiten lo que es favorito", async () => {
    const r = await put({ ids: [ids.Sabritas, ids.Coca, ids.Huevo] });
    assert.equal(r.status, 200);

    const d = await (await get()).json();
    assert.deepEqual(d.ids, [ids.Sabritas, ids.Coca, ids.Huevo], "en el orden elegido");
    assert.deepEqual(d.sugeridos.map(s => s.productoId), [ids.Pan]);

    // Reordenar y quitar: se reemplaza la lista completa.
    await put({ ids: [ids.Huevo] });
    assert.deepEqual((await (await get()).json()).ids, [ids.Huevo]);
});

test("solo productos propios, sin repetir y hasta el maximo", async () => {
    assert.equal((await put({ ids: [ids.ajeno] })).status, 404, "un producto de otro negocio no se puede marcar");
    assert.equal((await put({ ids: [999999999] })).status, 404);
    assert.equal((await put({})).status, 400);
    assert.equal((await put({ ids: Array.from({ length: 25 }, (_, i) => i + 1) })).status, 400);

    // Repetidos y basura se limpian; el rechazo no deja la lista a medias.
    const r = await (await put({ ids: [ids.Pan, ids.Pan, "x", -3, ids.Coca] })).json();
    assert.deepEqual(r.ids, [ids.Pan, ids.Coca]);

    await put({ ids: [ids.ajeno] });
    assert.deepEqual((await (await get()).json()).ids, [ids.Pan, ids.Coca], "el intento fallido no cambio nada");
});

test("quitar todos deja la lista vacia, y un negocio no ve los favoritos de otro", async () => {
    await put({ ids: [ids.Pan] });
    assert.deepEqual((await (await get(otro)).json()).ids, [], "el otro negocio no ve los del primero");

    // El otro negocio no puede vaciar la lista del primero.
    await put({ ids: [] }, otro);
    assert.deepEqual((await (await get()).json()).ids, [ids.Pan]);

    await put({ ids: [] });
    assert.deepEqual((await (await get()).json()).ids, []);
});

test("la franja solo sale en el perfil simple y un toque no vuelve a dibujar las fotos", () => {
    const leer = ruta => fs.readFileSync(path.join(__dirname, "..", "public", ruta), "utf8");
    const js = leer("js/favoritos-pos.js");
    const indice = leer("index.html");

    assert.match(js, /if \(!favEsSimple\(\)\) \{\s*\n\s*franja\.innerHTML = ""/, "fuera de abarrotes no se pinta nada");
    assert.match(js, /\/favoritos/);
    assert.match(js, /method: "PUT"/);

    // Agregar solo actualiza el contador de esa tarjeta.
    const agregar = js.slice(js.indexOf("function favAgregar("), js.indexOf("function favActualizarContadores"));
    assert.match(agregar, /favActualizarContadores\(\)/);
    assert.doesNotMatch(agregar, /renderFavoritosPOS\(\)/);

    assert.match(js, /window\.actualizarCarrito = /, "los contadores siguen al carrito aunque cambie desde otro lado");
    assert.ok(indice.indexOf("js/app-bootstrap.js") < indice.indexOf("js/favoritos-pos.js"), "envuelve cargarProductos ya definido");
    assert.ok(indice.indexOf("js/pos-sales.js") < indice.indexOf("js/favoritos-pos.js"), "envuelve actualizarCarrito ya definido");
    assert.match(indice, /css\/components\/favoritos-pos\.css/);
});

test("la franja de favoritos se oculta y se muestra con animacion, recuerda la eleccion y se abre sola al editar", () => {
    const leer = ruta => fs.readFileSync(path.join(__dirname, "..", "public", ruta), "utf8");
    const js = leer("js/favoritos-pos.js");
    const css = leer("css/components/favoritos-pos.css");

    // Solo se cambia una clase: las tarjetas (y sus fotos) no se vuelven a dibujar.
    const alternar = js.slice(js.indexOf("function favAlternar("), js.indexOf("function favEditar("));
    assert.match(alternar, /classList\.toggle\("fav-oculta"/);
    assert.doesNotMatch(alternar, /renderFavoritosPOS\(\)/);
    assert.match(js, /nexoFavoritosOculta/);
    assert.match(js, /try \{ localStorage\.setItem\(FAVORITOS_OCULTA_KEY/, "el almacenamiento puede fallar y no debe romper la franja");
    assert.match(js, /aria-expanded/);

    // Editar con la franja plegada la abre.
    const editar = js.slice(js.indexOf("function favEditar("), js.indexOf("function favBuscar("));
    assert.match(editar, /favoritosOculta = false/);

    // Animacion de altura (grid 1fr -> 0fr) y respeto a "reducir movimiento".
    assert.match(css, /\.fav-oculta \.fav-plegable \{ grid-template-rows: 0fr/);
    assert.match(css, /transition: grid-template-rows/);
    assert.match(css, /prefers-reduced-motion[\s\S]*\.fav-plegable/);
});

test("el boton de ocultar/mostrar favoritos es visible: con texto, borde de color y flecha que gira", () => {
    const leer = ruta => fs.readFileSync(path.join(__dirname, "..", "public", ruta), "utf8");
    const js = leer("js/favoritos-pos.js");
    const css = leer("css/components/favoritos-pos.css");

    assert.match(js, /class="fav-btn fav-btn-alternar" onclick="favAlternar\(\)"/);
    assert.match(js, /favoritosOculta \? "Mostrar" : "Ocultar"/);
    assert.match(js, /alternar\.querySelector\("\.fav-btn-texto"\)\.textContent/, "el texto del boton cambia al alternar");
    assert.match(css, /\.fav-btn-alternar \{[^}]*border: 2px solid var\(--brand-color/);
    assert.match(css, /\.fav-oculta \.fav-btn-flecha \{ transform: rotate\(180deg\)/);
});
