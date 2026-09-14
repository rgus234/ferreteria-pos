// Nexo Market: con que nivel de precio publica cada tienda. El dueno ya
// podia elegir esto para SU sitio ({slug}.nexoposoficial.com,
// migrations/20260927_nivel_precio_market.sql) pero Market -- donde SI
// compiten tiendas distintas por el mismo producto buscado -- lo tenia
// fijo en precio_publico siempre, sin leer esa eleccion. Esta prueba
// confirma que buscar-json (catalogo, orden por precio, rango de
// precio) y el checkout de Stripe Connect ahora si respetan
// sitio_web_config.nivel_precio, usando el mismo helper
// (columnaPrecioMultiTienda, en public-site-server.js) en los dos lados.
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { pool, crearNegocioPrueba, crearProductoPrueba, borrarNegocioPrueba } = require("./helpers/negocio-prueba");
const { iniciarServidorPrueba, detenerServidorPrueba, BASE_URL } = require("./helpers/servidor-prueba");
const { columnaPrecioMultiTienda } = require("../public-site-server");

let negocio;
let producto;

async function activarEnMarket(negocioId, nivelPrecio = "publico") {
    await pool.query(
        `INSERT INTO public.sitio_web_config (negocio_id, activo, mostrar_precios, mostrar_existencias, nivel_precio)
         VALUES ($1, true, true, true, $2)`,
        [negocioId, nivelPrecio]
    );
}

async function ponerNivelPrecio(negocioId, nivelPrecio) {
    await pool.query(`UPDATE public.sitio_web_config SET nivel_precio = $2 WHERE negocio_id = $1`, [negocioId, nivelPrecio]);
}

async function buscarProducto(codigo) {
    const respuesta = await fetch(`${BASE_URL}/market/buscar-json?buscar=${encodeURIComponent(codigo)}&giro=ferreteria`);
    const datos = await respuesta.json();
    return datos.productos.find(p => p.codigo === codigo);
}

before(async () => {
    await iniciarServidorPrueba();
    negocio = await crearNegocioPrueba("market-nivel-precio");
    await activarEnMarket(negocio.negocioId, "publico");

    producto = await crearProductoPrueba(negocio.negocioId, { nombre: "Martillo nivel precio prueba", codigo: "NP-MARTILLO-1", precio: 100 });
    // precio (el de referencia/mostrador) queda en 100; publico/mayoreo/
    // distribuidor se fijan aparte para poder distinguir cual de los 3
    // esta usando Market en cada prueba.
    await pool.query(
        `UPDATE public.productos SET precio_publico = 130, precio_mayoreo = 110, precio_distribuidor = 95 WHERE negocio_id = $1 AND codigo = $2`,
        [negocio.negocioId, "NP-MARTILLO-1"]
    );
});

after(async () => {
    if (negocio) await borrarNegocioPrueba(negocio.negocioId);
    await detenerServidorPrueba();
    await pool.end();
});

test("nivel_precio 'publico' (por defecto): Market muestra el precio publico", async () => {
    const fila = await buscarProducto("NP-MARTILLO-1");
    assert.ok(fila, "debe encontrar el producto");
    assert.equal(fila.precio, 130);
});

test("nivel_precio 'mayoreo': Market muestra el precio de mayoreo, no el publico", async () => {
    await ponerNivelPrecio(negocio.negocioId, "mayoreo");
    const fila = await buscarProducto("NP-MARTILLO-1");
    assert.equal(fila.precio, 110);
});

test("nivel_precio 'distribuidor': Market muestra el precio de distribuidor", async () => {
    await ponerNivelPrecio(negocio.negocioId, "distribuidor");
    const fila = await buscarProducto("NP-MARTILLO-1");
    assert.equal(fila.precio, 95);
});

test("si al nivel elegido le falta ese precio, cae a publico y no deja el producto sin precio", async () => {
    await crearProductoPrueba(negocio.negocioId, { nombre: "Martillo sin precio mayoreo prueba", codigo: "NP-MARTILLO-2", precio: 100 });
    await pool.query(
        `UPDATE public.productos SET precio_publico = 200, precio_mayoreo = NULL WHERE negocio_id = $1 AND codigo = $2`,
        [negocio.negocioId, "NP-MARTILLO-2"]
    );
    await ponerNivelPrecio(negocio.negocioId, "mayoreo");

    const fila = await buscarProducto("NP-MARTILLO-2");
    assert.equal(fila.precio, 200, "sin precio de mayoreo, debe caer al publico en vez de quedar sin precio");
});

test("el orden 'Precio: menor a mayor' ordena por el precio que Market realmente muestra (mayoreo), no por el publico", async () => {
    await ponerNivelPrecio(negocio.negocioId, "mayoreo");
    // NP-MARTILLO-1: mayoreo 110. NP-MARTILLO-2: sin mayoreo, cae a publico 200.
    const respuesta = await fetch(`${BASE_URL}/market/buscar-json?buscar=${encodeURIComponent("martillo nivel precio")}&giro=ferreteria&orden=precio_asc`);
    const datos = await respuesta.json();
    const codigos = datos.productos.map(p => p.codigo);
    const i1 = codigos.indexOf("NP-MARTILLO-1");
    const i2 = codigos.indexOf("NP-MARTILLO-2");
    assert.ok(i1 !== -1 && i2 !== -1, "deben aparecer los 2 productos de la prueba");
    assert.ok(i1 < i2, "NP-MARTILLO-1 (110) debe salir antes que NP-MARTILLO-2 (200 por caer a publico)");
});

test("columnaPrecioMultiTienda (la misma funcion que usa Stripe Connect para cobrar) da el mismo precio que Market muestra", async () => {
    // Sin Stripe Connect activo para este negocio sintetico, la ruta real
    // de cobro rechaza antes de calcular el monto (no hay forma de armar
    // credenciales de Stripe de prueba aqui) -- en su lugar se prueba
    // directo la funcion compartida (columnaPrecioMultiTienda) que
    // stripe-connect-server.js usa tal cual para calcular el monto a
    // cobrar, para que un cambio futuro en esa funcion se detecte aqui
    // sin depender de armar todo el checkout de Stripe.
    await ponerNivelPrecio(negocio.negocioId, "mayoreo");

    const columna = columnaPrecioMultiTienda("p.", "c.");
    const fila = await pool.query(
        `SELECT p.codigo, ${columna} AS precio
         FROM public.productos p
         JOIN public.sitio_web_config c ON c.negocio_id = p.negocio_id
         WHERE p.negocio_id = $1 AND p.codigo = $2`,
        [negocio.negocioId, "NP-MARTILLO-1"]
    );
    assert.equal(Number(fila.rows[0].precio), 110, "el monto a cobrar debe ser el de mayoreo, igual que lo que Market ya muestra");
});
