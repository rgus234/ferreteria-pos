// Vender en Market (Fase 1, A2): una tienda vendedora no sale en Market hasta que Nexo la aprueba.
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { pool, crearNegocioPrueba, crearProductoPrueba, borrarNegocioPrueba, establecerPlanPrueba } = require("./helpers/negocio-prueba");
const { iniciarServidorPrueba, detenerServidorPrueba, BASE_URL } = require("./helpers/servidor-prueba");

let vendedor;
let normal;
const headers = n => ({ "Content-Type": "application/json", "x-dispositivo-token": n.token });
const api = async (n, ruta, metodo = "GET") => {
    const r = await fetch(`${BASE_URL}${ruta}`, { method: metodo, headers: headers(n) });
    return { estado: r.status, datos: await r.json().catch(() => ({})) };
};
const permitidasAhora = async () => {
    delete require.cache[require.resolve("../market-server")]; // sin la memoria de 60 segundos
    const { tiendasPermitidasMarket } = require("../market-server");
    return (await tiendasPermitidasMarket(pool)).map(t => Number(t.id));
};

before(async () => {
    await iniciarServidorPrueba();
    vendedor = await crearNegocioPrueba("market-vendedor");
    normal = await crearNegocioPrueba("market-normal");
    await pool.query(`UPDATE public.negocios SET funciones_beta = '{"vendedor_market": true}'::jsonb WHERE id = $1`, [vendedor.negocioId]);
    await pool.query(`UPDATE public.negocios SET estado = 'activo' WHERE id = ANY($1)`, [[vendedor.negocioId, normal.negocioId]]);
    await establecerPlanPrueba(vendedor.negocioId, "pro");
    await establecerPlanPrueba(normal.negocioId, "pro");
});

after(async () => {
    for (const n of [vendedor, normal]) if (n) { await pool.query("DELETE FROM public.sitio_web_config WHERE negocio_id = $1", [n.negocioId]); await borrarNegocioPrueba(n.negocioId); }
    await detenerServidorPrueba();
    await pool.end();
});

test("un negocio de siempre no tiene estado de publicacion; uno con la funcion empieza en borrador", async () => {
    assert.equal((await api(normal, "/negocio-actual/market-publicacion")).datos.aplica, false);

    const r = (await api(vendedor, "/negocio-actual/market-publicacion")).datos;
    assert.equal(r.aplica, true);
    assert.equal(r.estado, "borrador");
    assert.equal(r.puedeSolicitar, false);
    assert.equal(r.requisitos.productos, false);
});

test("no se puede pedir la publicacion sin datos, sin 5 productos con precio y sin la tienda prendida", async () => {
    assert.equal((await api(vendedor, "/negocio-actual/market-publicacion/solicitar", "POST")).estado, 400);

    await pool.query(`UPDATE public.negocios SET nombre = 'Tienda Vendedora', telefono = '4981112233', direccion = 'Calle 1, Rio Grande' WHERE id = $1`, [vendedor.negocioId]);
    const sinProductos = await api(vendedor, "/negocio-actual/market-publicacion/solicitar", "POST");
    assert.equal(sinProductos.estado, 400);
    assert.match(sinProductos.datos.error, /al menos 5 productos/);

    for (let i = 0; i < 5; i++) await crearProductoPrueba(vendedor.negocioId, { stock: 5, precio: 20 + i });
    const sinTienda = await api(vendedor, "/negocio-actual/market-publicacion/solicitar", "POST");
    assert.equal(sinTienda.estado, 400);
    assert.match(sinTienda.datos.error, /tienda en linea/i);
});

test("con todo listo se pide la publicacion, queda en revision y NO sale en Market hasta aprobarla", async () => {
    await pool.query(`INSERT INTO public.sitio_web_config (negocio_id, activo, mostrar_precios, mostrar_existencias) VALUES ($1, true, true, true) ON CONFLICT (negocio_id) DO UPDATE SET activo = true`, [vendedor.negocioId]);
    await pool.query(`INSERT INTO public.sitio_web_config (negocio_id, activo, mostrar_precios, mostrar_existencias) VALUES ($1, true, true, true) ON CONFLICT (negocio_id) DO UPDATE SET activo = true`, [normal.negocioId]);

    const antes = (await api(vendedor, "/negocio-actual/market-publicacion")).datos;
    assert.equal(antes.puedeSolicitar, true);

    const pedido = await api(vendedor, "/negocio-actual/market-publicacion/solicitar", "POST");
    assert.equal(pedido.estado, 200, JSON.stringify(pedido.datos));
    assert.equal(pedido.datos.estado, "en_revision");
    assert.equal((await api(vendedor, "/negocio-actual/market-publicacion/solicitar", "POST")).datos.repetida, true, "pedirla dos veces no duplica nada");

    const visibles = await permitidasAhora();
    assert.ok(!visibles.includes(vendedor.negocioId), "en revision: no sale en Market");
    assert.ok(visibles.includes(normal.negocioId), "el negocio de siempre sigue saliendo como antes");

    await pool.query(`UPDATE public.negocios SET market_estado = 'aprobado' WHERE id = $1`, [vendedor.negocioId]);
    assert.ok((await permitidasAhora()).includes(vendedor.negocioId), "aprobada: ya sale");
});

test("el enlace de revision: firma valida, vence y no sirve para otra accion u otra tienda", () => {
    process.env.ADMIN_KEY = "llave-de-prueba-12345";
    const { firmar, firmaValida } = require("../market-publicacion-server");
    const expira = Date.now() + 60000;
    const f = firmar(7, "aprobar", expira);

    assert.equal(firmaValida(7, "aprobar", expira, f), true);
    assert.equal(firmaValida(7, "rechazar", expira, f), false, "no sirve para rechazar");
    assert.equal(firmaValida(8, "aprobar", expira, f), false, "no sirve para otra tienda");
    assert.equal(firmaValida(7, "aprobar", expira, f.slice(0, -2) + "00"), false, "firma alterada");
    assert.equal(firmaValida(7, "aprobar", Date.now() - 1000, firmar(7, "aprobar", Date.now() - 1000)), false, "vencida");
});

test("el servidor rechaza un enlace de revision sin firma valida", async () => {
    const r = await fetch(`${BASE_URL}/admin/market/revisar?n=${vendedor.negocioId}&e=${Date.now() + 1000}&fa=x&fr=y`);
    assert.equal(r.status, 403);
    const post = await fetch(`${BASE_URL}/admin/market/decidir`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: `n=${vendedor.negocioId}&accion=aprobar&e=${Date.now() + 1000}&f=x` });
    assert.equal(post.status, 403);
    const estado = (await pool.query("SELECT market_estado FROM public.negocios WHERE id = $1", [vendedor.negocioId])).rows[0].market_estado;
    assert.equal(estado, "aprobado", "no cambio nada");
});
