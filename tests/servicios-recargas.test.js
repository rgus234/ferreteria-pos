// Recargas y pago de servicios (abarrotes), registro manual.
//
// Lo que se protege:
//  - la recarga viaja en el ticket como cualquier venta, con sus datos (proveedor, comision) guardados;
//  - su comision cuenta como ganancia (importe menos lo que se le paga al proveedor), sin inventar si no hay costo;
//  - el Inicio y el reporte de ganancia separan las recargas por proveedor;
//  - el boton solo sale a quien tiene abarrotes y el cliente no pierde los datos al armar la venta.

const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { pool, crearNegocioPrueba, borrarNegocioPrueba } = require("./helpers/negocio-prueba");
const { iniciarServidorPrueba, detenerServidorPrueba, BASE_URL } = require("./helpers/servidor-prueba");

let negocio;
let otro;

const headers = (n = negocio) => ({ "Content-Type": "application/json", "x-dispositivo-token": n.token });
const post = (ruta, cuerpo, n = negocio) => fetch(`${BASE_URL}${ruta}`, { method: "POST", headers: headers(n), body: JSON.stringify(cuerpo) });
const get = (ruta, n = negocio) => fetch(`${BASE_URL}${ruta}`, { headers: headers(n) });

async function cobrar(productos, n = negocio) {
    const total = productos.reduce((s, p) => s + p.importe, 0);
    const r = await post("/ventas", {
        total, subtotal: total, productos,
        metodoPago: "efectivo", pagos: { efectivo: total }, recibido: total, cambio: 0
    }, n);
    return r;
}

// Linea de recarga tal como la arma servicios-pos.js: precio = lo que cobra, costo = lo que paga al proveedor.
const recarga = (proveedor, monto, comision, id) => ({
    id, codigo: "Sin codigo", nombre: `Recarga ${proveedor}`, precio: monto, cantidad: 1, unidadVenta: "pieza", modoVenta: "bolsa", importe: monto,
    costo: Number((monto - comision).toFixed(2)),
    servicio: { tipo: "recarga", proveedor, referencia: "4771234567", comision }
});

before(async () => {
    await iniciarServidorPrueba();
    negocio = await crearNegocioPrueba("servicios-a");
    otro = await crearNegocioPrueba("servicios-b");

    await post("/caja/abrir", { usuario: "Cajero", fondoInicial: 100, notas: "" });
    await post("/caja/abrir", { usuario: "Cajero", fondoInicial: 100, notas: "" }, otro);
});

after(async () => {
    if (negocio) await borrarNegocioPrueba(negocio.negocioId);
    if (otro) await borrarNegocioPrueba(otro.negocioId);
    await detenerServidorPrueba();
    await pool.end();
});

test("la recarga se cobra como cualquier venta y guarda sus datos con la linea", async () => {
    const r = await cobrar([recarga("Telcel", 50, 2, -1)]);
    assert.equal(r.status, 200, await r.clone().text());

    const guardada = (await pool.query(`SELECT productos, total FROM public.historial_ventas WHERE negocio_id = $1 ORDER BY id DESC LIMIT 1`, [negocio.negocioId])).rows[0];
    assert.equal(Number(guardada.total), 50);
    assert.equal(guardada.productos[0].servicio.proveedor, "Telcel");
    assert.equal(guardada.productos[0].servicio.comision, 2);
    assert.equal(guardada.productos[0].costo, 48, "el costo es lo que se le paga al proveedor");
});

test("la comision cuenta como ganancia en el Inicio, por proveedor, y sin costo no se inventa", async () => {
    await cobrar([recarga("Telcel", 100, 4, -2)]);
    await cobrar([recarga("CFE", 510, 10, -3)]);

    // Una recarga sin costo conocido: cuenta como vendido, pero su comision no se adivina.
    await cobrar([{ id: -4, codigo: "Sin codigo", nombre: "Recarga Bait", precio: 30, cantidad: 1, unidadVenta: "pieza", modoVenta: "bolsa", importe: 30, servicio: { tipo: "recarga", proveedor: "Bait", referencia: "", comision: 0 } }]);

    const d = await (await get("/abarrotes/inicio")).json();

    assert.equal(d.servicios.operaciones, 4);
    assert.equal(d.servicios.importe, 50 + 100 + 510 + 30);
    assert.equal(d.servicios.comision, 2 + 4 + 10, "solo lo que tiene costo conocido: 2 + 4 + 10");

    const telcel = d.servicios.porProveedor.find(p => p.proveedor === "Telcel");
    assert.deepEqual([telcel.operaciones, telcel.importe, telcel.comision], [2, 150, 6]);

    // Lo que ganaste hoy incluye las comisiones.
    assert.equal(d.hoy.ganancia, 16);
});

test("el reporte de ganancia por producto trae una fila por proveedor de recargas y pagos", async () => {
    const d = await (await get("/abarrotes/ganancia-productos?dias=7")).json();

    const telcel = d.productos.find(p => p.nombre === "Recargas · Telcel");
    const cfe = d.productos.find(p => p.nombre === "Pagos · CFE" || p.nombre === "Recargas · CFE");

    assert.ok(telcel, "Recargas · Telcel");
    assert.deepEqual([telcel.unidades, telcel.vendido, telcel.ganancia], [2, 150, 6]);
    assert.equal(telcel.margen, 4);

    // CFE se registro con tipo "recarga" en esta prueba; lo importante es que aparece con su comision.
    assert.equal(cfe.ganancia, 10);
});

test("un negocio no ve las recargas de otro", async () => {
    const d = await (await get("/abarrotes/inicio", otro)).json();

    assert.equal(d.servicios.operaciones, 0);
    assert.equal(d.servicios.comision, 0);
});

test("el boton solo sale a quien tiene abarrotes y la linea lleva su costo y sus datos hasta la venta", () => {
    const leer = ruta => fs.readFileSync(path.join(__dirname, "..", "public", ruta), "utf8");
    const js = leer("js/servicios-pos.js");
    const ventas = leer("js/pos-sales.js");
    const indice = leer("index.html");

    assert.match(js, /if \(!svcTieneAbarrotes\(\)\) \{\s*\n\s*boton\?\.remove\(\)/, "sin abarrotes el boton no existe");
    assert.match(js, /perfilTieneAbarrotes/);
    assert.match(js, /linea\.costoConocido = true/, "la comision sale como ganancia por el costo conocido");
    assert.match(js, /linea\.costo = Number\(\(monto - comision\)\.toFixed\(2\)\)/);
    assert.match(js, /linea\.servicio = \{ tipo: s\.tipo, proveedor: s\.proveedor/);
    assert.match(js, /try \{ return JSON\.parse\(localStorage\.getItem/, "el almacenamiento puede fallar y no debe romper la ventana");
    assert.match(js, /Nexo solo lo registra/, "se aclara que no manda la recarga");

    // La linea no pierde sus datos al pasar del ticket a la venta.
    assert.match(ventas, /if \(producto\.servicio\) \{\s*\n\s*base\.servicio = producto\.servicio;/);

    assert.ok(indice.indexOf("js/pos-sales.js") < indice.indexOf("js/servicios-pos.js"), "usa agregarArticuloRapido ya definido");
    assert.match(indice, /css\/components\/servicios-pos\.css/);
});
