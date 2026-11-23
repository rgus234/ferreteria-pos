// "Solo lo necesario" (solo_mostrador) + Mi mercancia: un negocio chico (p. ej. La Rinconada) con menu reducido y una forma sencilla de meter productos.
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const { pool, crearNegocioPrueba, borrarNegocioPrueba } = require("./helpers/negocio-prueba");
const { iniciarServidorPrueba, detenerServidorPrueba, BASE_URL } = require("./helpers/servidor-prueba");

const leer = ruta => fs.readFileSync(path.join(__dirname, "..", ruta), "utf8");
let negocio;
let maestroId;
const codigoMaestro = `750${String(Date.now()).slice(-10)}`;

const headers = () => ({ "Content-Type": "application/json", "x-dispositivo-token": negocio.token });
const api = async (ruta, opciones = {}) => {
    const r = await fetch(`${BASE_URL}${ruta}`, { headers: headers(), ...opciones });
    return { estado: r.status, datos: await r.json().catch(() => null) };
};

before(async () => {
    await iniciarServidorPrueba();
    negocio = await crearNegocioPrueba("solo-mostrador");
    const m = await pool.query(
        `INSERT INTO public.catalogo_maestro_productos (codigo, ean, nombre, marca, giro) VALUES ($1, $1, 'Galletas de prueba solo mostrador 100 g', 'MarcaPrueba', 'abarrotes') RETURNING id`,
        [codigoMaestro]
    );
    maestroId = m.rows[0].id;
    // La busqueda por codigo (identidadPorCodigo) lee de esta tabla; se borra sola al borrar el producto maestro.
    await pool.query(`INSERT INTO public.catalogo_maestro_identificadores (producto_maestro_id, tipo, valor, fuente) VALUES ($1, 'ean', $2, 'prueba')`, [maestroId, codigoMaestro]);
});

after(async () => {
    if (negocio) await borrarNegocioPrueba(negocio.negocioId);
    if (maestroId) await pool.query("DELETE FROM public.catalogo_maestro_productos WHERE id = $1", [maestroId]).catch(() => {});
    await detenerServidorPrueba();
    await pool.end();
});

test("la funcion nace apagada y NUNCA se enciende sola con _todas (recortaria el menu de un negocio normal)", async () => {
    let r = await api("/funciones-beta");
    assert.equal(r.datos.funciones.solo_mostrador, false);
    assert.ok(r.datos.nombres.solo_mostrador, "tiene nombre para mostrarla en Funciones nuevas");

    await pool.query(`UPDATE public.negocios SET funciones_beta = '{"_todas": true}'::jsonb WHERE id = $1`, [negocio.negocioId]);
    r = await api("/funciones-beta");
    assert.equal(r.datos.funciones.mostrador, true, "_todas si enciende el mostrador de precios");
    assert.equal(r.datos.funciones.solo_mostrador, false, "pero solo_mostrador hay que prenderlo a proposito");

    await pool.query(`UPDATE public.negocios SET funciones_beta = '{"solo_mostrador": true, "mostrador": true}'::jsonb WHERE id = $1`, [negocio.negocioId]);
    r = await api("/funciones-beta");
    assert.equal(r.datos.funciones.solo_mostrador, true, "prendida a proposito, funciona");
});

test("el menu: dos entradas nuevas y solo quedan los modulos necesarios", () => {
    const menu = leer("public/js/menu-simple.js");
    assert.match(menu, /directo: "mostrador-precios"/);
    assert.match(menu, /directo: "mi-mercancia"/);

    const lista = /const SOLO_MODULOS = new Set\(\[([^\]]*)\]\)/.exec(menu)[1];
    ["inicio", "mostrador-precios", "mi-mercancia", "recargas", "proveedores", "inventario-bajo"].forEach(m => assert.ok(lista.includes(`"${m}"`), `${m} se queda en el menu`));
    ["venta", "creditos", "facturacion", "reportes", "caja", "agregar-producto"].forEach(m => assert.ok(!lista.includes(`"${m}"`), `${m} se oculta`));
    assert.match(menu, /cuerpo\.contains\("solo-mostrador"\) && !SOLO_MODULOS\.has\(boton\.dataset\.shellModule\)/, "el filtro solo actua con la clase del modo");
});

test("las pantallas estan conectadas: botones ocultos por defecto, secciones, scripts en orden y limpieza al cambiar de pantalla", () => {
    const html = leer("public/index.html");
    assert.match(html, /data-shell-module="mostrador-precios" data-beta="solo_mostrador" hidden onclick="nexoMostrador\.abrir\(\)"/);
    assert.match(html, /data-shell-module="mi-mercancia" data-beta="solo_mostrador" hidden onclick="mostrarMiMercancia\(\)"/);
    assert.ok(html.includes('id="pantallaMiMercancia"') && html.includes('id="pantallaSoloInicio"'));

    const a = html.indexOf("js/mostrador.js"), b = html.indexOf("js/mi-mercancia.js"), c = html.indexOf("js/solo-mostrador.js");
    assert.ok(a > 0 && a < b && b < c, "mostrador.js (expone nexoMostrador) antes de las pantallas nuevas");

    const auth = leer("public/js/config-auth.js");
    assert.ok(auth.includes('"pantallaMiMercancia"') && auth.includes('"pantallaSoloInicio"'), "se esconden al ir a otra pantalla");
    assert.match(leer("public/js/mostrador.js"), /window\.nexoMostrador = \{ abrir/);
});

test("el Inicio sencillo solo reemplaza al de siempre si la funcion esta encendida, y avisa del primer paso si no hay productos", () => {
    const js = leer("public/js/solo-mostrador.js");
    assert.match(js, /if \(activo\(\)\) return window\.mostrarSoloInicio\(\)/);
    assert.match(js, /classList\.toggle\("solo-mostrador", activo\(\)\)/);
    assert.match(js, /sinProductos/);
    assert.match(js, /Se está acabando/);
});

test("meter mercancia: lo que Nexo ya conoce se reconoce por su codigo y se da de alta con su vinculo al catalogo", async () => {
    const buscar = await api(`/explorar-nexo/buscar?q=${codigoMaestro}`);
    assert.equal(buscar.estado, 200);
    assert.ok(buscar.datos.coincidenciaPorCodigo, "el catalogo reconoce el codigo escaneado");
    assert.equal(buscar.datos.coincidenciaPorCodigo.catalogoMaestroId, maestroId);
    assert.match(buscar.datos.coincidenciaPorCodigo.nombre, /Galletas de prueba/);

    // Lo mismo que manda js/mi-mercancia.js al guardar
    const alta = await api("/agregar-producto", { method: "POST", body: JSON.stringify({ nombre: "Galletas de prueba solo mostrador 100 g", precio: 12, precioPublico: 12, stock: 6, stockMinimo: 3, codigo: codigoMaestro, unidadVenta: "pieza", marca: "MarcaPrueba", catalogoMaestroId: maestroId }) });
    assert.equal(alta.estado, 200, JSON.stringify(alta.datos));
    assert.ok(alta.datos.productoId);

    const lista = await api("/productos");
    const p = lista.datos.find(x => x.codigo === codigoMaestro);
    assert.equal(Number(p.precio_publico), 12);
    assert.equal(Number(p.stock), 6);
    assert.equal(p.catalogo_maestro_id, maestroId);
});

test("corregir lo que ya tienes: el precio por edicion rapida y las existencias por conteo", async () => {
    const lista = await api("/productos");
    const p = lista.datos.find(x => x.codigo === codigoMaestro);

    const precio = await api(`/productos/${p.id}/edicion-rapida`, { method: "PATCH", body: JSON.stringify({ precioPublico: 14.5 }) });
    assert.equal(precio.estado, 200, JSON.stringify(precio.datos));

    const conteo = await api("/ajustes-inventario", { method: "POST", body: JSON.stringify({ productoId: p.id, tipo: "conteo", cantidad: 30, motivo: "Conteo desde Mi mercancía" }) });
    assert.equal(conteo.estado, 200, JSON.stringify(conteo.datos));

    const despues = (await api("/productos")).datos.find(x => x.id === p.id);
    assert.equal(Number(despues.precio_publico), 14.5);
    assert.equal(Number(despues.stock), 30);
});

test("un producto sin codigo de barras se da de alta y despues se le genera uno interno para poder escanearlo", async () => {
    const alta = await api("/agregar-producto", { method: "POST", body: JSON.stringify({ nombre: "Veladora de prueba", precio: 35, precioPublico: 35, stock: 0, stockMinimo: 3, codigo: "", unidadVenta: "pieza" }) });
    assert.equal(alta.estado, 200, JSON.stringify(alta.datos));

    const generado = await api(`/productos/${alta.datos.productoId}/generar-codigo`, { method: "POST" });
    assert.equal(generado.estado, 200, JSON.stringify(generado.datos));
    assert.ok(generado.datos.codigo, "ya tiene codigo propio");
});

test("la pantalla de Mi mercancia usa solo rutas que ya existen y no manda nada raro", () => {
    const js = leer("public/js/mi-mercancia.js");
    ["/productos", "/explorar-nexo/buscar", "/explorar-nexo/foto/", "/agregar-producto", "/edicion-rapida", "/ajustes-inventario", "/generar-codigo"].forEach(ruta => assert.ok(js.includes(ruta), `usa ${ruta}`));
    assert.match(js, /catalogoMaestroId/);
    assert.match(js, /Enter guarda/);
    assert.ok(!/localStorage\.setItem\("nexo[A-Za-z]*Token/.test(js), "no toca tokens");
});

test("el mostrador de Rinconada: lo que no conoce se da de alta ahi mismo, y el cambio de aspecto no depende de emojis", () => {
    const mos = leer("public/js/mostrador.js");
    assert.match(mos, /id="mosAgregar"/);
    assert.match(mos, /nexoMiMercancia\.abrirConCodigo\(codigo\)/);
    assert.match(mos, /solo\(\) && window\.nexoMiMercancia/, "el boton solo sale en modo solo-mostrador; los demas negocios siguen igual");
    assert.ok(!mos.includes("🛒") && !mos.includes("▮"), "ni emoji de carrito ni cuadros de texto");
    assert.match(leer("public/js/mi-mercancia.js"), /abrirConCodigo/);
});

test("el celular (/dueno): la version sencilla solo se enciende con la funcion, usa las rutas de siempre y esta en el cache de la app", () => {
    const js = leer("public/dueno-solo.js");
    assert.match(js, /funciones\.solo_mostrador === true/, "solo con la funcion encendida");
    ["/productos", "/explorar-nexo/buscar", "/explorar-nexo/foto/", "/agregar-producto", "/edicion-rapida", "/ajustes-inventario", "/generar-codigo"].forEach(ruta => assert.ok(js.includes(ruta), `usa ${ruta}`));
    assert.match(js, /iniciarLectorCodigosDueno/, "usa la camara de siempre");
    assert.match(js, /abrirRecargasDueno/, "las recargas son el modulo de siempre");

    const css = leer("public/dueno-solo.css");
    assert.match(css, /html\.dueno-solo #duenoTabs \{ display: none/, "la barra de siempre solo se oculta con la clase del modo");

    const html = leer("public/dueno.html");
    const sw = leer("public/dueno-sw.js");
    assert.ok(html.includes("dueno-solo.js") && html.includes("dueno-solo.css"));
    assert.ok(sw.includes("/dueno-solo.js") && sw.includes("/dueno-solo.css"), "esta en el cache del service worker");
    assert.ok(html.indexOf("dueno-recargas.js") < html.indexOf("dueno-solo.js"), "despues de recargas");
});

test("el asistente de inicio de un negocio con Solo lo necesario es corto (negocio y listo) y termina en Mi mercancia", () => {
    const js = leer("public/js/asistente-inicio.js");
    assert.match(js, /ASISTENTE_PASOS_SOLO = \["negocio", "listo"\]/);
    assert.match(js, /funciones\.solo_mostrador === true/, "solo si la funcion esta encendida");
    assert.match(js, /asistentePintarListoSolo/);
    assert.match(js, /asistenteSoloModo && typeof window\.mostrarMiMercancia === "function"/, "el primer paso lleva a Mi mercancia");
    assert.match(js, /!asistenteSoloModo && window\.practicaNexo/, "no se ofrece la practica de venta");
});
