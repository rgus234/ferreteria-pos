// Armar productos: granel -> bolsitas. Descuenta el granel (con merma), suma lo armado, se puede deshacer y nunca deja el granel negativo.
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { pool, crearNegocioPrueba, borrarNegocioPrueba, crearProductoPrueba } = require("./helpers/negocio-prueba");
const { iniciarServidorPrueba, detenerServidorPrueba, BASE_URL } = require("./helpers/servidor-prueba");
const { origenNecesario, costoUnidad } = require("../armado-server");

let negocio;
let churros;
let bolsita;
const headers = () => ({ "Content-Type": "application/json", "x-dispositivo-token": negocio.token });
const api = (ruta, metodo = "GET", cuerpo) => fetch(`${BASE_URL}${ruta}`, { method: metodo, headers: headers(), ...(cuerpo ? { body: JSON.stringify(cuerpo) } : {}) });
const existencia = async id => { const f = (await pool.query(`SELECT stock, stock_resto FROM public.productos WHERE id = $1`, [id])).rows[0]; return Number(f.stock) + Number(f.stock_resto); };

before(async () => {
    await iniciarServidorPrueba();
    negocio = await crearNegocioPrueba("armado");
    churros = await crearProductoPrueba(negocio.negocioId, { nombre: "Churros a granel", precio: 120, stock: 5 });
    bolsita = await crearProductoPrueba(negocio.negocioId, { nombre: "Churros bolsita", precio: 15, stock: 0 });
});

after(async () => {
    if (negocio) await borrarNegocioPrueba(negocio.negocioId);
    await detenerServidorPrueba();
    await pool.end();
});

test("las cuentas: granel gastado con merma y costo de cada unidad", () => {
    assert.equal(origenNecesario(20, 0.1, 0), 2);
    assert.equal(origenNecesario(20, 0.1, 10), 2.2);
    assert.equal(origenNecesario(1, 0.25, 0), 0.25);
    assert.equal(costoUnidad(80, 0.1, 0, 0.5), 8.5, "8 de granel + 0.50 de bolsa");
    assert.equal(costoUnidad(80, 0.1, 10, 0.5), 9.3);
});

test("crear el armado valida los datos", async () => {
    const mal = async cuerpo => (await api("/armados", "PUT", cuerpo)).status;

    assert.equal(await mal({ origenId: churros.id, destinoId: churros.id, cantidadOrigen: 0.1 }), 400, "no puede ser el mismo producto");
    assert.equal(await mal({ origenId: churros.id, destinoId: bolsita.id, cantidadOrigen: 0 }), 400, "cantidad en cero");
    assert.equal(await mal({ origenId: churros.id, destinoId: bolsita.id, cantidadOrigen: 0.1, mermaPct: 100 }), 400, "merma de 100 %");
    assert.equal(await mal({ origenId: 999999999, destinoId: bolsita.id, cantidadOrigen: 0.1 }), 404, "producto que no existe");
    assert.equal(await mal({}), 400);
});

test("armar 20 bolsitas baja el granel y sube las bolsitas; se puede deshacer", async () => {
    const creado = await (await api("/armados", "PUT", { origenId: churros.id, destinoId: bolsita.id, cantidadOrigen: 0.1, mermaPct: 0, costoExtra: 0.5 })).json();
    assert.equal(creado.ok, true, JSON.stringify(creado));
    assert.equal(creado.armado.puedeArmar, 50, "5 kg alcanzan para 50 bolsitas de 0.1");

    const armado = creado.armado.id;

    const lista = await (await api("/armados")).json();
    assert.equal(lista.armados.length, 1);
    assert.equal(lista.armados[0].destinoNombre, "Churros bolsita");

    const r = await (await api(`/armados/${armado}/armar`, "POST", { unidades: 20, usuarioNombre: "Gustavo" })).json();
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.equal(r.origenUsado, 2);
    assert.equal(await existencia(churros.id), 3, "5 - 2 kg");
    assert.equal(await existencia(bolsita.id), 20);

    const historial = await (await api("/armados/historial")).json();
    assert.equal(historial.historial.length, 1);
    assert.equal(historial.historial[0].usuario_nombre, "Gustavo");
    assert.equal(historial.historial[0].se_puede_deshacer, true);

    const deshecho = await (await api(`/armados/historial/${r.registroId}/deshacer`, "POST")).json();
    assert.equal(deshecho.ok, true);
    assert.equal(await existencia(churros.id), 5, "el granel regresa");
    assert.equal(await existencia(bolsita.id), 0, "las bolsitas se quitan");

    const otraVez = await api(`/armados/historial/${r.registroId}/deshacer`, "POST");
    assert.equal(otraVez.status, 404, "no se deshace dos veces");
});

test("con merma se gasta mas granel y las fracciones quedan bien", async () => {
    const armado = (await (await api("/armados", "PUT", { origenId: churros.id, destinoId: bolsita.id, cantidadOrigen: 0.15, mermaPct: 10 })).json()).armado.id;
    const r = await (await api(`/armados/${armado}/armar`, "POST", { unidades: 7 })).json();

    assert.equal(r.origenUsado, 1.155, "7 x 0.15 x 1.10");
    assert.equal(Math.round((await existencia(churros.id)) * 1000) / 1000, 3.845, "5 - 1.155");
    assert.equal(await existencia(bolsita.id), 7);
});

test("no deja armar de mas: el granel no queda negativo", async () => {
    const armado = (await pool.query(`SELECT id FROM public.producto_armado WHERE negocio_id = $1`, [negocio.negocioId])).rows[0].id;
    const antes = await existencia(churros.id);

    const r = await api(`/armados/${armado}/armar`, "POST", { unidades: 1000 });
    const datos = await r.json();

    assert.equal(r.status, 409);
    assert.match(datos.error, /No alcanza el granel/);
    assert.equal(await existencia(churros.id), antes, "no se movio nada");

    assert.equal((await api(`/armados/${armado}/armar`, "POST", { unidades: 0 })).status, 400);
    assert.equal((await api(`/armados/${armado}/armar`, "POST", { unidades: "abc" })).status, 400);
});

test("no se deshace un armado si las bolsitas ya se vendieron", async () => {
    const armado = (await pool.query(`SELECT id FROM public.producto_armado WHERE negocio_id = $1`, [negocio.negocioId])).rows[0].id;
    const r = await (await api(`/armados/${armado}/armar`, "POST", { unidades: 10 })).json();
    await pool.query(`UPDATE public.productos SET stock = 2 WHERE id = $1`, [bolsita.id]);

    const intento = await api(`/armados/historial/${r.registroId}/deshacer`, "POST");
    assert.equal(intento.status, 409);
    assert.match((await intento.json()).error, /Ya se vendio parte/);
});

test("armar con caducidad abre el lote de las bolsitas", async () => {
    const armado = (await pool.query(`SELECT id FROM public.producto_armado WHERE negocio_id = $1`, [negocio.negocioId])).rows[0].id;
    const r = await (await api(`/armados/${armado}/armar`, "POST", { unidades: 3, caducidad: "2027-03-01" })).json();

    assert.equal(r.ok, true);
    assert.ok(r.loteId, "se abrio un lote");
    const lote = (await pool.query(`SELECT cantidad, to_char(fecha_caducidad, 'YYYY-MM-DD') AS f FROM public.producto_lotes WHERE id = $1`, [r.loteId])).rows[0];
    assert.equal(lote.f, "2027-03-01");
    assert.equal(Number(lote.cantidad), 3);
});

test("quitar el armado no borra los productos", async () => {
    const armado = (await pool.query(`SELECT id FROM public.producto_armado WHERE negocio_id = $1`, [negocio.negocioId])).rows[0].id;
    assert.equal((await (await api(`/armados/${armado}`, "DELETE")).json()).ok, true);
    assert.equal((await (await api("/armados")).json()).armados.length, 0);
    assert.ok(await existencia(churros.id) >= 0);
});

// ---------------------------------------------------------------- extras rapidos

test("extras: se guardan por producto, se leen con el nombre del producto y se reemplazan", async () => {
    const salsa = await crearProductoPrueba(negocio.negocioId, { nombre: "Salsa de prueba", precio: 2, stock: 50 });
    const limon = await crearProductoPrueba(negocio.negocioId, { nombre: "Limon de prueba", precio: 1, stock: 50 });

    const guardado = await (await api(`/extras/${bolsita.id}`, "PUT", { extraIds: [salsa.id, limon.id, salsa.id] })).json();
    assert.equal(guardado.ok, true, JSON.stringify(guardado));
    assert.deepEqual(guardado.extraIds, [salsa.id, limon.id], "sin repetidos y en orden");

    const lectura = await (await api("/extras")).json();
    assert.deepEqual(lectura.extras[bolsita.id].map(e => e.nombre), ["Salsa de prueba", "Limon de prueba"]);
    assert.equal(lectura.extras[bolsita.id][0].precio, 2);
    assert.equal(lectura.bases[bolsita.id], "Churros bolsita");

    await api(`/extras/${bolsita.id}`, "PUT", { extraIds: [limon.id] });
    assert.deepEqual((await (await api("/extras")).json()).extras[bolsita.id].map(e => e.nombre), ["Limon de prueba"], "reemplaza la lista");

    await api(`/extras/${bolsita.id}`, "PUT", { extraIds: [] });
    assert.equal((await (await api("/extras")).json()).extras[bolsita.id], undefined, "lista vacia = sin extras");
});

test("extras: un producto no es extra de si mismo, los inexistentes se rechazan y hay tope", async () => {
    const otro = await crearProductoPrueba(negocio.negocioId, { nombre: "Otro extra", precio: 3, stock: 5 });

    const propio = await (await api(`/extras/${bolsita.id}`, "PUT", { extraIds: [bolsita.id, otro.id] })).json();
    assert.deepEqual(propio.extraIds, [otro.id], "se ignora a si mismo");

    assert.equal((await api(`/extras/${bolsita.id}`, "PUT", { extraIds: [999999999] })).status, 404);
    assert.equal((await api(`/extras/${bolsita.id}`, "PUT", { extraIds: Array.from({ length: 9 }, (_, i) => i + 1) })).status, 400, "maximo 8");
    assert.equal((await api("/extras/abc", "PUT", { extraIds: [] })).status, 400);

    await api(`/extras/${bolsita.id}`, "PUT", { extraIds: [] });
});

test("pantallas: la venta ofrece los extras sin tocar la logica del carrito, y Armar productos usa sus rutas", () => {
    const fs = require("node:fs");
    const path = require("node:path");
    const leer = ruta => fs.readFileSync(path.join(__dirname, "..", ruta), "utf8");

    const extras = leer("public/js/extras-pos.js");
    assert.match(extras, /window\.funcionBeta\("armado"\)/, "solo con la funcion encendida");
    assert.match(extras, /window\.agregar = conExtras/, "se envuelve agregar(), no se reescribe");
    assert.match(extras, /agregarProductoPorId\(Number\(boton\.dataset\.extra\)\)/, "un extra es un producto normal");
    assert.match(extras, /catch \(error\) \{ \/\* las fichas son un extra/, "un fallo de las fichas nunca estorba a la venta");

    const vista = leer("public/js/armado-view.js");
    ["/armados", "/armados/historial", "/extras", "/armar`", "/deshacer`"].forEach(ruta => assert.ok(vista.includes(ruta), `usa ${ruta}`));
    assert.match(vista, /window\.mostrarArmado = async function/);

    const html = leer("public/index.html");
    assert.match(html, /data-shell-module="armar-productos" data-beta="armado" hidden/, "el boton nace oculto y solo sale con la funcion");
    assert.match(html, /id="pantallaArmado"/);
    assert.ok(html.indexOf("js/pos-sales.js") < html.indexOf("js/extras-pos.js"), "se carga despues de pos-sales.js");

    assert.match(leer("public/js/config-auth.js"), /"pantallaArmado"/, "la pantalla se oculta al cambiar de seccion");
    assert.match(leer("public/js/menu-simple.js"), /modulo: "armar-productos"/);
    assert.match(leer("funciones-beta-server.js"), /armado: "Armar productos y extras"/);
});
