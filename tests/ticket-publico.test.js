// Ticket digital (ver plan stateless-doodling-tarjan.md): codigo_publico
// se genera del lado del cliente, pero aqui se simula con un valor fijo
// -- lo que se prueba es que el servidor lo persiste, lo respeta en la
// ruta publica, y resuelve con gracia una colision. Corre contra la
// base de datos real, aislado en un negocio sintetico propio. Ver
// tests/helpers/negocio-prueba.js.

const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const QRCode = require("qrcode");
const { pool, crearNegocioPrueba, crearProductoPrueba, borrarNegocioPrueba } = require("./helpers/negocio-prueba");
const { iniciarServidorPrueba, detenerServidorPrueba, BASE_URL } = require("./helpers/servidor-prueba");

let negocio;

function headers() {
    return {
        "Content-Type": "application/json",
        "x-dispositivo-token": negocio.token
    };
}

before(async () => {
    await iniciarServidorPrueba();
    negocio = await crearNegocioPrueba("ticket-publico");
});

after(async () => {
    if (negocio) {
        await borrarNegocioPrueba(negocio.negocioId);
    }
    await detenerServidorPrueba();
    await pool.end();
});

test("una venta con codigoPublico lo guarda en historial_ventas", async () => {
    const producto = await crearProductoPrueba(negocio.negocioId, { stock: 10, precio: 150 });
    const codigoPublico = `TICKPUB${Date.now()}`;

    const respuesta = await fetch(`${BASE_URL}/ventas`, {
        method: "POST",
        headers: headers(),
        body: JSON.stringify({
            productos: [{ id: producto.id, precio: 150, cantidad: 1, modoVenta: "bolsa" }],
            metodoPago: "efectivo",
            pagos: { efectivo: 150 },
            recibido: 150,
            cambio: 0,
            cajeroUsuario: "prueba",
            cajeroNombre: "Prueba automatizada",
            codigoPublico
        })
    });

    const datos = await respuesta.json();

    assert.equal(respuesta.status, 200);
    assert.equal(datos.success, true);
    assert.equal(datos.codigoPublico, codigoPublico);

    const fila = await pool.query(
        "SELECT codigo_publico FROM public.historial_ventas WHERE id = $1",
        [datos.historialId]
    );

    assert.equal(fila.rows[0].codigo_publico, codigoPublico);
});

test("una venta a credito con codigoPublico lo guarda en historial_ventas", async () => {
    const creado = await fetch(`${BASE_URL}/creditos/clientes`, {
        method: "POST",
        headers: headers(),
        body: JSON.stringify({ nombre: "Cliente ticket digital", telefono: "5551112233", limiteCredito: 5000 })
    });
    const clienteId = (await creado.json()).cliente.id;
    const codigoPublico = `TICKCRE${Date.now()}`;

    const cargo = await fetch(`${BASE_URL}/creditos/clientes/${clienteId}/cargos`, {
        method: "POST",
        headers: headers(),
        body: JSON.stringify({ monto: 300, concepto: "Compra a credito de prueba", codigoPublico })
    });

    const datos = await cargo.json();

    assert.equal(cargo.status, 200);
    assert.equal(datos.codigoPublico, codigoPublico);

    const fila = await pool.query(
        "SELECT codigo_publico FROM public.historial_ventas WHERE id = $1",
        [datos.historialId]
    );

    assert.equal(fila.rows[0].codigo_publico, codigoPublico);
});

test("un codigoPublico repetido no tumba la venta -- cae a NULL en vez de fallar", async () => {
    const producto = await crearProductoPrueba(negocio.negocioId, { stock: 10, precio: 80 });
    const codigoPublico = `TICKDUP${Date.now()}`;

    const primera = await fetch(`${BASE_URL}/ventas`, {
        method: "POST",
        headers: headers(),
        body: JSON.stringify({
            productos: [{ id: producto.id, precio: 80, cantidad: 1, modoVenta: "bolsa" }],
            metodoPago: "efectivo",
            pagos: { efectivo: 80 },
            recibido: 80,
            cambio: 0,
            cajeroUsuario: "prueba",
            codigoPublico
        })
    });
    assert.equal((await primera.json()).codigoPublico, codigoPublico);

    const segunda = await fetch(`${BASE_URL}/ventas`, {
        method: "POST",
        headers: headers(),
        body: JSON.stringify({
            productos: [{ id: producto.id, precio: 80, cantidad: 1, modoVenta: "bolsa" }],
            metodoPago: "efectivo",
            pagos: { efectivo: 80 },
            recibido: 80,
            cambio: 0,
            cajeroUsuario: "prueba",
            codigoPublico
        })
    });
    const datosSegunda = await segunda.json();

    assert.equal(segunda.status, 200, "la segunda venta debe seguir teniendo exito");
    assert.equal(datosSegunda.success, true);
    assert.ok(datosSegunda.historialId, "debe crear una fila nueva, no reusar la primera");
    assert.equal(datosSegunda.codigoPublico, null, "el codigo colisionado se descarta, no se comparte entre 2 ventas");

    const fila = await pool.query(
        "SELECT codigo_publico FROM public.historial_ventas WHERE id = $1",
        [datosSegunda.historialId]
    );
    assert.equal(fila.rows[0].codigo_publico, null);
});

test("GET /ticket/:codigo sirve el recibo publico sin autenticacion", async () => {
    const producto = await crearProductoPrueba(negocio.negocioId, { stock: 10, precio: 200, nombre: "Producto del recibo" });
    const codigoPublico = `TICKVIEW${Date.now()}`;

    const venta = await fetch(`${BASE_URL}/ventas`, {
        method: "POST",
        headers: headers(),
        body: JSON.stringify({
            productos: [{ id: producto.id, nombre: "Producto del recibo", precio: 200, cantidad: 1, modoVenta: "bolsa" }],
            metodoPago: "efectivo",
            pagos: { efectivo: 200 },
            recibido: 200,
            cambio: 0,
            cajeroUsuario: "prueba",
            codigoPublico
        })
    });
    const datosVenta = await venta.json();

    const pagina = await fetch(`${BASE_URL}/ticket/${codigoPublico}`);
    const html = await pagina.text();

    assert.equal(pagina.status, 200);
    assert.match(pagina.headers.get("content-type") || "", /text\/html/);
    assert.ok(html.includes(escaparHtmlPrueba(datosVenta.folio)), "debe mostrar el folio de la venta");
    assert.ok(html.includes("200.00"), "debe mostrar el total de la venta");

    const noEncontrado = await fetch(`${BASE_URL}/ticket/CODIGO-QUE-NO-EXISTE`);
    assert.equal(noEncontrado.status, 404);

    const detalle = await fetch(`${BASE_URL}/ventas/${datosVenta.historialId}`, { headers: headers() });
    const datosDetalle = await detalle.json();
    assert.equal(datosDetalle.venta.codigo_publico, codigoPublico, "la reimpresion tambien debe traer el codigo");
});

test("GET /ticket/:codigo/qr.png regresa un PNG que codifica la URL esperada", async () => {
    const producto = await crearProductoPrueba(negocio.negocioId, { stock: 10, precio: 50 });
    const codigoPublico = `TICKQR${Date.now()}`;

    await fetch(`${BASE_URL}/ventas`, {
        method: "POST",
        headers: headers(),
        body: JSON.stringify({
            productos: [{ id: producto.id, precio: 50, cantidad: 1, modoVenta: "bolsa" }],
            metodoPago: "efectivo",
            pagos: { efectivo: 50 },
            recibido: 50,
            cambio: 0,
            cajeroUsuario: "prueba",
            codigoPublico
        })
    });

    const respuesta = await fetch(`${BASE_URL}/ticket/${codigoPublico}/qr.png`);
    const buffer = Buffer.from(await respuesta.arrayBuffer());

    assert.equal(respuesta.status, 200);
    assert.equal(respuesta.headers.get("content-type"), "image/png");
    assert.deepEqual(buffer.subarray(0, 8), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), "firma PNG valida");

    const esperado = await QRCode.toBuffer(`https://nexoposoficial.com/ticket/${codigoPublico}`, { width: 320, margin: 1 });
    assert.deepEqual(buffer, esperado, "debe codificar exactamente la misma URL con los mismos parametros");

    const inexistente = await fetch(`${BASE_URL}/ticket/CODIGO-QUE-NO-EXISTE/qr.png`);
    assert.equal(inexistente.status, 404);
});

test("sync offline: /sync/push persiste codigoPublico y resuelve colision sin bloquear el evento", async () => {
    const producto = await crearProductoPrueba(negocio.negocioId, { stock: 10, precio: 60 });
    const codigoPublico = `TICKSYNC${Date.now()}`;

    const primerPush = await fetch(`${BASE_URL}/sync/push`, {
        method: "POST",
        headers: headers(),
        body: JSON.stringify({
            deviceId: "equipo-pruebas-automatizadas",
            eventos: [{
                eventId: `evt-venta-${Date.now()}`,
                tipo: "venta_creada",
                entidad: "venta",
                entidadId: "",
                payload: {
                    total: 60,
                    subtotal: 60,
                    metodoPago: "efectivo",
                    recibido: 60,
                    cambio: 0,
                    cajeroUsuario: "prueba",
                    productos: [{ id: producto.id, precio: 60, cantidad: 1, modoVenta: "bolsa" }],
                    codigoPublico
                }
            }]
        })
    });

    const datosPrimero = await primerPush.json();
    assert.equal(primerPush.status, 200);
    assert.deepEqual(datosPrimero.errores, []);
    assert.equal(datosPrimero.aplicados[0].codigoPublico, codigoPublico);

    const filaPrimero = await pool.query(
        "SELECT codigo_publico FROM public.historial_ventas WHERE id = $1",
        [datosPrimero.aplicados[0].historialId]
    );
    assert.equal(filaPrimero.rows[0].codigo_publico, codigoPublico);

    // Segundo evento offline con el MISMO codigoPublico (2 ventas
    // offline distintas que por azar generaron el mismo codigo) -- debe
    // seguir aplicandose (no quedar en "errores" ni bloquear el evento
    // para siempre), solo con el codigo en NULL.
    const segundoPush = await fetch(`${BASE_URL}/sync/push`, {
        method: "POST",
        headers: headers(),
        body: JSON.stringify({
            deviceId: "equipo-pruebas-automatizadas",
            eventos: [{
                eventId: `evt-venta-${Date.now()}-b`,
                tipo: "venta_creada",
                entidad: "venta",
                entidadId: "",
                payload: {
                    total: 60,
                    subtotal: 60,
                    metodoPago: "efectivo",
                    recibido: 60,
                    cambio: 0,
                    cajeroUsuario: "prueba",
                    productos: [{ id: producto.id, precio: 60, cantidad: 1, modoVenta: "bolsa" }],
                    codigoPublico
                }
            }]
        })
    });

    const datosSegundo = await segundoPush.json();
    assert.equal(segundoPush.status, 200);
    assert.deepEqual(datosSegundo.errores, [], "la colision no debe aparecer como error de sync");
    assert.equal(datosSegundo.aplicados[0].codigoPublico, null);
});

function escaparHtmlPrueba(valor) {
    return String(valor || "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}
