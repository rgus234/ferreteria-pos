// "Dile a Nexo" para inventario fisico: las herramientas consultan o PREPARAN borradores, nunca escriben.
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { pool, crearNegocioPrueba, crearProductoPrueba, borrarNegocioPrueba } = require("./helpers/negocio-prueba");
const { ejecutarHerramientaNexo } = require("../ia-server");

let N, refri, bebidas, cola, naranja, pija1, pija2;
const herramienta = (nombre, input) => ejecutarHerramientaNexo(pool, N.negocioId, nombre, input);

before(async () => {
    N = await crearNegocioPrueba("nexo-lugares");
    const lugar = async (nombre, zona = "tienda", tipo = "estante") => (await pool.query(`INSERT INTO public.ubicaciones (negocio_id, zona, tipo, nombre, codigo) VALUES ($1,$2,$3,$4,$5) RETURNING id`, [N.negocioId, zona, tipo, nombre, "T-" + Math.random().toString(36).slice(2, 8)])).rows[0].id;

    refri = await lugar("Refrigerador");
    bebidas = await lugar("Bebidas");
    await lugar("Bebidas de bodega", "bodega", "seccion");

    cola = await crearProductoPrueba(N.negocioId, { nombre: "Refresco de cola 600 ml", stock: 30 });
    naranja = await crearProductoPrueba(N.negocioId, { nombre: "Refresco de naranja 600 ml", stock: 12 });
    await pool.query(`UPDATE public.productos SET ubicacion_id = $2, ubicacion = 'Tienda › Bebidas' WHERE id = $1`, [cola.id, bebidas]);

    for (const [nombre, precio] of [["Pija punta broca 1", 85], ["Pija punta broca 2", 90]]) {
        const p = await crearProductoPrueba(N.negocioId, { nombre, precio, stock: 10 });
        await pool.query(`UPDATE public.productos SET unidad_venta = 'kilo', presentacion_compra = 'BOLSA', factor_conversion = 100, permite_venta_pieza = true, stock_minimo = 5 WHERE id = $1`, [p.id]);
        if (nombre.endsWith("1")) pija1 = p; else pija2 = p;
    }
});

after(async () => {
    await pool.query(`UPDATE public.productos SET ubicacion_id = NULL WHERE negocio_id = $1`, [N.negocioId]);
    await borrarNegocioPrueba(N.negocioId);
    await pool.end();
});

test("donde_esta_producto dice el lugar y cuanto hay en estante y en bodega", async () => {
    const r = await herramienta("donde_esta_producto", { termino: "cola" });

    assert.equal(r.productos.length, 1);
    assert.equal(r.productos[0].lugar, "Tienda › Bebidas");
    assert.equal(r.productos[0].total, 30);

    const sinLugar = await herramienta("donde_esta_producto", { termino: "naranja" });
    assert.equal(sinLugar.productos[0].lugar, "Sin lugar asignado");
    assert.deepEqual((await herramienta("donde_esta_producto", { termino: "a" })).productos, [], "con una letra no busca");
});

test("lugares_tienda lista los lugares con su codigo y cuantos productos tiene cada uno", async () => {
    const r = await herramienta("lugares_tienda", {});

    assert.equal(r.lugares.length, 3);
    assert.equal(r.lugares.find(l => l.nombre === "Bebidas").productos, 1);
    assert.equal(r.lugares.find(l => l.nombre === "Refrigerador").productos, 0);
});

test("preparar_movimiento arma el borrador (sin mover nada) y pregunta cuando hay dudas", async () => {
    const ok = await herramienta("preparar_movimiento", { producto: "refresco de naranja", lugar: "refrigerador" });

    assert.equal(ok.ok, true);
    assert.equal(ok.datos.productoId, naranja.id);
    assert.equal(ok.datos.lugarId, refri);
    assert.equal(ok.datos.desde, "Sin lugar");
    assert.equal((await pool.query(`SELECT ubicacion_id FROM public.productos WHERE id = $1`, [naranja.id])).rows[0].ubicacion_id, null, "preparar NO mueve nada");

    const variosProductos = await herramienta("preparar_movimiento", { producto: "refresco", lugar: "refrigerador" });
    assert.equal(variosProductos.ok, false);
    assert.equal(variosProductos.opciones.length, 2);

    const variosLugares = await herramienta("preparar_movimiento", { producto: "refresco de naranja", lugar: "bebidas" });
    assert.equal(variosLugares.ok, true, "el nombre exacto gana aunque otro lugar lo contenga");
    assert.equal(variosLugares.datos.lugarId, bebidas);

    const noHay = await herramienta("preparar_movimiento", { producto: "refresco de naranja", lugar: "azotea" });
    assert.equal(noHay.ok, false);
    assert.ok(noHay.opciones.includes("Refrigerador"), "ofrece los lugares que si existen");
    assert.equal((await herramienta("preparar_movimiento", { producto: "zzz inexistente", lugar: "refri" })).ok, false);
});

test("preparar_creacion de un producto trae la configuracion sugerida por los parecidos y su lugar; si la dijeron, manda lo dicho", async () => {
    const sugerido = await herramienta("preparar_creacion", { tipo: "producto", nombre: "Pija punta broca 3", precio: 95, lugar: "refrigerador" });

    assert.equal(sugerido.ok, true);
    assert.equal(sugerido.datos.origenConfig, "sugerida");
    assert.equal(sugerido.datos.config.presentacionCompra, "BOLSA");
    assert.equal(sugerido.datos.config.factorConversion, 100);
    assert.equal(sugerido.datos.config.unidadVenta, "kilo");
    assert.equal(sugerido.datos.stockMinimo, 5, "tambien el stock minimo de los parecidos");
    assert.match(sugerido.datos.resumenConfig, /pija punta broca/);
    assert.equal(sugerido.datos.lugarId, refri);
    assert.equal(sugerido.datos.precio, 95);

    const dicho = await herramienta("preparar_creacion", { tipo: "producto", nombre: "Pija punta broca 4", precio: 99, presentacionCompra: "caja", factorConversion: 50, unidadVenta: "pieza", stock: 7 });
    assert.equal(dicho.datos.origenConfig, "indicada");
    assert.equal(dicho.datos.config.presentacionCompra, "CAJA");
    assert.equal(dicho.datos.config.factorConversion, 50);
    assert.equal(dicho.datos.stock, 7);

    const sinParecidos = await herramienta("preparar_creacion", { tipo: "producto", nombre: "Martillo de bola", precio: 120 });
    assert.equal(sinParecidos.datos.config, undefined, "sin parecidos no se inventa nada");

    const lugarRaro = await herramienta("preparar_creacion", { tipo: "producto", nombre: "Producto X", precio: 10, lugar: "azotea" });
    assert.match(lugarRaro.datos.lugarNoEncontrado, /azotea/);

    // Los otros tipos siguen como siempre.
    const cliente = await herramienta("preparar_creacion", { tipo: "cliente_credito", nombre: "Doña Mary", limiteCredito: 500 });
    assert.equal(cliente.datos.limiteCredito, 500);
});
