// Vender en Market de punta a punta: un vendedor nuevo se registra, sube productos, prende su tienda, Nexo lo aprueba,
// un comprador le hace un pedido y el vendedor lo entrega. Solo corre en la copia aislada (el aprobado usa la llave de
// administrador y en la base real mandaria correos).
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { pool, borrarNegocioPrueba } = require("./helpers/negocio-prueba");
const { iniciarServidorPrueba, detenerServidorPrueba, BASE_URL } = require("./helpers/servidor-prueba");

const OPCIONES = { skip: process.env.NEXO_COPIA_AISLADA ? false : "solo en la copia aislada (npm test)" };
const sufijo = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
const correo = `test-auto-punta-${sufijo}@example.com`;
let negocioId;
let slug;
let token;

const json = async (ruta, { metodo = "GET", cuerpo, conToken = false } = {}) => {
    const r = await fetch(`${BASE_URL}${ruta}`, {
        method: metodo,
        headers: { "Content-Type": "application/json", ...(conToken ? { "x-dispositivo-token": token } : {}) },
        body: cuerpo ? JSON.stringify(cuerpo) : undefined
    });
    return { estado: r.status, datos: await r.json().catch(() => ({})) };
};
const pedirComoComprador = () => json(`/market/tienda/${slug}/catalogo/pedido-carrito`, {
    metodo: "POST",
    cuerpo: { items: [{ codigo: `PUNTA${sufijo}X0`, cantidad: 2 }], clienteNombre: "Compradora de prueba", clienteTelefono: "4980001122", tipo: "pedido", entrega: "recoleccion" }
});
const sale = async () => {
    delete require.cache[require.resolve("../market-server")];
    return (await require("../market-server").tiendasPermitidasMarket(pool)).some(t => Number(t.id) === negocioId);
};

before(async () => { if (!OPCIONES.skip) await iniciarServidorPrueba(); });
after(async () => {
    if (negocioId) {
        for (const tabla of ["market_reportes", "pedidos_market_items", "pedidos_market", "pedidos_publicos", "sitio_web_config"]) {
            await pool.query(`DELETE FROM public.${tabla} WHERE negocio_id = $1`, [negocioId]).catch(() => {});
        }
        await borrarNegocioPrueba(negocioId);
    }
    if (!OPCIONES.skip) await detenerServidorPrueba();
    await pool.end();
});

test("1. se registra como vendedor y arma su tienda; antes de aprobarla no sale en Market ni recibe pedidos", OPCIONES, async () => {
    const alta = await json("/api/clientes/registro", { metodo: "POST", cuerpo: { negocio: `Test Auto Punta ${sufijo}`, giro: "abarrotes", telefono: "4980003344", correo, password: "Prueba-Nexo-1234-x", confirmarPassword: "Prueba-Nexo-1234-x", ciudad: "Rio Grande, Zac.", nombreContacto: "Prueba", quieroVenderMarket: true } });
    assert.equal(alta.estado, 201, JSON.stringify(alta.datos));
    negocioId = Number(alta.datos.negocio.id);
    slug = alta.datos.negocio.slug;

    token = crypto.randomBytes(24).toString("hex");
    await pool.query("INSERT INTO public.dispositivos_vinculados (negocio_id, token_hash, nombre_dispositivo) VALUES ($1, $2, 'prueba')", [negocioId, crypto.createHash("sha256").update(token).digest("hex")]);

    for (let i = 0; i < 5; i++) {
        const p = await json("/agregar-producto", { metodo: "POST", conToken: true, cuerpo: { nombre: `Producto punta ${i}`, precio: 20 + i, precioPublico: 20 + i, stock: 10, stockMinimo: 1, codigo: `PUNTA${sufijo}X${i}`, unidadVenta: "pieza" } });
        assert.equal(p.estado, 200, JSON.stringify(p.datos));
    }
    const tienda = await json("/negocio-actual/market-publicacion/tienda", { metodo: "PUT", conToken: true, cuerpo: { activo: true, envioModo: "solo_recoleccion" } });
    assert.equal(tienda.estado, 200, JSON.stringify(tienda.datos));

    const solicitud = await json("/negocio-actual/market-publicacion/solicitar", { metodo: "POST", conToken: true });
    assert.equal(solicitud.estado, 200, JSON.stringify(solicitud.datos));

    assert.equal(await sale(), false, "en revision no sale en Market");
    const pagina = await fetch(`${BASE_URL}/market/tienda/${slug}`);
    assert.equal(pagina.status, 200, "la pagina se puede ver, para revisarla");

    const pedido = await pedirComoComprador();
    assert.equal(pedido.estado, 403, `sin aprobar no recibe pedidos: ${JSON.stringify(pedido.datos)}`);
});

test("2. Nexo aprueba con el enlace firmado y la tienda sale en Market", OPCIONES, async () => {
    const { firmar } = require("../market-publicacion-server");
    const expira = Date.now() + 60000;
    const r = await fetch(`${BASE_URL}/admin/market/decidir`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ n: negocioId, accion: "aprobar", e: expira, f: firmar(negocioId, "aprobar", expira) }).toString() });
    assert.equal(r.status, 200, await r.text());

    assert.equal(await sale(), true, "aprobada: sale en Market");
    const estado = (await json("/negocio-actual/market-publicacion", { conToken: true })).datos;
    assert.equal(estado.estado, "aprobado");
});

test("3. un comprador hace un pedido y el vendedor lo prepara y lo entrega", OPCIONES, async () => {
    const pedido = await pedirComoComprador();
    assert.equal(pedido.estado, 200, JSON.stringify(pedido.datos));
    assert.notEqual(pedido.datos.ok, false, JSON.stringify(pedido.datos));

    const nuevos = await json("/negocio-actual/pedidos-market?estado=nuevos", { conToken: true });
    assert.equal(nuevos.estado, 200, JSON.stringify(nuevos.datos));
    assert.equal(nuevos.datos.pedidos.length, 1, "al vendedor le llega el pedido");
    const id = nuevos.datos.pedidos[0].id;

    for (const accion of ["aceptar", "marcar_listo", "entregar"]) {
        const paso = await json(`/negocio-actual/pedidos-market/${id}`, { metodo: "PATCH", conToken: true, cuerpo: { accion } });
        assert.equal(paso.estado, 200, `${accion}: ${JSON.stringify(paso.datos)}`);
    }
    const fila = (await pool.query("SELECT estado, total FROM public.pedidos_market WHERE id = $1", [id])).rows[0];
    assert.equal(fila.estado, "entregado");
    assert.equal(Number(fila.total), 40);
});

test("4. al entregar bajan las existencias del vendedor, una sola vez", OPCIONES, async () => {
    const existencia = async () => Number((await json("/productos", { conToken: true })).datos.find(p => p.codigo === `PUNTA${sufijo}X0`).stock);
    assert.equal(await existencia(), 8, "10 menos las 2 entregadas");

    const id = (await pool.query("SELECT id FROM public.pedidos_market WHERE negocio_id = $1", [negocioId])).rows[0].id;
    const repetido = await json(`/negocio-actual/pedidos-market/${id}`, { metodo: "PATCH", conToken: true, cuerpo: { accion: "entregar" } });
    assert.equal(repetido.estado, 400, "entregarlo otra vez no se puede");
    assert.equal(await existencia(), 8, "no se descuenta dos veces");
});

test("5. el comprador reporta un problema desde la pagina de su pedido, una sola vez", OPCIONES, async () => {
    const { codigo_recogida: codigo, id } = (await pool.query("SELECT id, codigo_recogida FROM public.pedidos_market WHERE negocio_id = $1", [negocioId])).rows[0];
    const pagina = async () => (await fetch(`${BASE_URL}/market/pedido/${codigo}`)).text();
    assert.match(await pagina(), /Reportar un problema/);

    const reportar = cuerpo => json(`/market/pedido/${codigo}/reportar`, { metodo: "POST", cuerpo });
    assert.equal((await reportar({ motivo: "inventado", detalle: "algo que paso aqui" })).estado, 400);
    assert.equal((await reportar({ motivo: "incompleto", detalle: "corto" })).estado, 400);
    assert.equal((await reportar({ motivo: "incompleto", detalle: "Me falto una de las dos piezas" })).estado, 200);
    assert.equal((await reportar({ motivo: "otro", detalle: "Lo mando otra vez por si acaso" })).datos.repetido, true);

    const filas = (await pool.query("SELECT motivo FROM public.market_reportes WHERE pedido_market_id = $1", [id])).rows;
    assert.deepEqual(filas.map(f => f.motivo), ["incompleto"]);
    assert.match(await pagina(), /Ya recibimos tu reporte/);

    await pool.query("UPDATE public.negocios SET funciones_beta = '{}'::jsonb WHERE id = $1", [negocioId]);
    assert.doesNotMatch(await pagina(), /Reportar un problema|Ya recibimos tu reporte/, "las tiendas con punto de venta no cambian");
    assert.equal((await reportar({ motivo: "otro", detalle: "Esto no deberia entrar aqui" })).estado, 404);
});

test("6. un negocio con punto de venta no cambia: entregar un pedido no le mueve las existencias", OPCIONES, async () => {
    await pool.query("UPDATE public.negocios SET funciones_beta = '{}'::jsonb WHERE id = $1", [negocioId]);
    const pedido = await pedirComoComprador();
    assert.equal(pedido.estado, 200, JSON.stringify(pedido.datos));

    const id = (await pool.query("SELECT id FROM public.pedidos_market WHERE negocio_id = $1 AND estado = 'pendiente'", [negocioId])).rows[0].id;
    for (const accion of ["aceptar", "marcar_listo", "entregar"]) {
        assert.equal((await json(`/negocio-actual/pedidos-market/${id}`, { metodo: "PATCH", conToken: true, cuerpo: { accion } })).estado, 200);
    }
    const fila = (await pool.query("SELECT stock FROM public.productos WHERE negocio_id = $1 AND codigo = $2", [negocioId, `PUNTA${sufijo}X0`])).rows[0];
    assert.equal(Number(fila.stock), 8, "sigue igual");
});
