// Inicio de abarrotes: cuanto vendio y cuanto GANO el tendero.
//
// Lo que se protege:
//  - la ganancia es precio de venta menos costo; sin costo no se inventa ganancia (se avisa);
//  - solo cuentan ventas completadas y de hoy/ayer en la hora de Mexico;
//  - los productos que pierden o dejan poco salen aparte;
//  - un negocio no ve los numeros de otro;
//  - el cliente solo reemplaza el Inicio de siempre en el perfil simple.

const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { calcularGanancias, resumenPorProducto } = require("../inicio-abarrotes-server");

const hoyIso = "2026-10-22";

test("la ganancia es importe menos unidades por costo, y sin costo no se inventa", () => {
    const productos = [
        { id: 1, nombre: "Con costo", precio_distribuidor: "10" },
        { id: 2, nombre: "Sin costo", precio_distribuidor: null, costo: null }
    ];
    const ventas = [
        { productoId: 1, dia: hoyIso, unidades: 4, importe: 60 },
        { productoId: 2, dia: hoyIso, unidades: 2, importe: 40 },
        { productoId: 99, dia: hoyIso, unidades: 1, importe: 5 }
    ];

    const { filas, sinCosto } = calcularGanancias(ventas, productos);
    assert.equal(filas[0].ganancia, 20);
    assert.equal(filas[1].ganancia, null);
    assert.equal(filas[2].nombre, "Producto eliminado");
    assert.deepEqual([...sinCosto].sort(), [2, 99]);

    const resumen = resumenPorProducto(filas, hoyIso);
    const conCosto = resumen.find(p => p.productoId === 1);
    assert.deepEqual([conCosto.ganancia, conCosto.margen, conCosto.vendido], [20, 33, 60]);
    assert.equal(resumen.find(p => p.productoId === 2).ganancia, null);

    // Un dia fuera del rango no cuenta.
    assert.equal(resumenPorProducto(filas, "2026-10-23").length, 0);
});

const { pool, crearNegocioPrueba, borrarNegocioPrueba } = require("./helpers/negocio-prueba");
const { iniciarServidorPrueba, detenerServidorPrueba, BASE_URL } = require("./helpers/servidor-prueba");

let negocio;
let otro;

const get = (ruta, n = negocio) => fetch(`${BASE_URL}${ruta}`, { headers: { "x-dispositivo-token": n.token } });

async function venta(total, productos, desfase = "0 days", estado = "completada") {
    await pool.query(
        `INSERT INTO public.historial_ventas (negocio_id, total, fecha, productos, estado, metodo_pago, pago_efectivo)
         VALUES ($1, $2, NOW() - $3::interval, $4::jsonb, $5, 'efectivo', $2)`,
        [negocio.negocioId, total, desfase, JSON.stringify(productos), estado]
    );
}

before(async () => {
    await iniciarServidorPrueba();
    negocio = await crearNegocioPrueba("inicio-ab-a");
    otro = await crearNegocioPrueba("inicio-ab-b");

    const alta = async (nombre, costo, precio, stock = 20) => (await pool.query(
        `INSERT INTO public.productos (negocio_id, nombre, precio, precio_publico, precio_distribuidor, stock, stock_minimo)
         VALUES ($1, $2, $3, $3, $4, $5, 3) RETURNING id`,
        [negocio.negocioId, nombre, precio, costo, stock]
    )).rows[0].id;

    const a = await alta("Producto bueno", 10, 15);
    const b = await alta("Producto sin costo", null, 20);
    const c = await alta("Producto que pierde", 12, 10);
    await alta("Producto agotado", 5, 8, 0);

    await venta(60, [{ id: a, nombre: "Producto bueno", cantidad: 4, importe: 60 }]);
    await venta(40, [{ id: b, nombre: "Producto sin costo", cantidad: 2, importe: 40 }]);
    await venta(30, [{ id: c, nombre: "Producto que pierde", cantidad: 3, importe: 30 }]);
    await venta(30, [{ id: a, nombre: "Producto bueno", cantidad: 2, importe: 30 }], "1 day");
    await venta(999, [{ id: a, nombre: "Producto bueno", cantidad: 50, importe: 999 }], "0 days", "cancelada");
});

after(async () => {
    if (negocio) await borrarNegocioPrueba(negocio.negocioId);
    if (otro) await borrarNegocioPrueba(otro.negocioId);
    await detenerServidorPrueba();
    await pool.end();
});

test("el inicio suma lo vendido y lo ganado de hoy, sin contar canceladas ni productos sin costo", async () => {
    const r = await get("/abarrotes/inicio");
    assert.equal(r.status, 200);

    const d = await r.json();
    assert.equal(d.hoy.ventas, 3);
    assert.equal(d.hoy.total, 130, "60 + 40 + 30; la cancelada de 999 no cuenta");
    assert.equal(d.hoy.ganancia, 14, "20 del bueno, 0 del que no tiene costo, -6 del que pierde");
    assert.equal(d.hoy.ayerTotal, 30);
    assert.equal(d.productosSinCosto, 1, "se avisa cuantos productos no tienen costo");

    assert.equal(d.semana.length, 7);
    assert.equal(d.semana[6].total, 130, "el ultimo dia de la semana es hoy");
    assert.equal(d.semana[5].total, 30);

    assert.deepEqual(d.inventario, { productos: 4, bajos: 0, sinStock: 1 });
    assert.deepEqual(Object.keys(d.fiado).sort(), ["clientes", "clientesVencidos", "total", "vencido"]);
});

test("lo que mas deja y lo que pierde salen en listas aparte", async () => {
    const d = await (await get("/abarrotes/inicio")).json();

    assert.equal(d.masGanancia[0].nombre, "Producto bueno");
    assert.equal(d.masGanancia[0].margen > 0, true);
    assert.ok(!d.masGanancia.some(p => p.nombre === "Producto sin costo"), "sin costo no entra al ranking");

    assert.equal(d.pierden[0].nombre, "Producto que pierde");
    assert.ok(d.pierden[0].ganancia < 0);
});

test("el reporte de ganancia por producto ordena por lo que deja y deja al final lo que no tiene costo", async () => {
    const d = await (await get("/abarrotes/ganancia-productos?dias=7")).json();

    assert.equal(d.dias, 7);
    assert.equal(d.productos[0].nombre, "Producto bueno");
    assert.equal(d.productos[d.productos.length - 1].nombre, "Producto sin costo");
    assert.equal(d.sinCosto, 1);
    assert.equal(d.totalVendido, 160, "ayer + hoy: 30 + 60 + 40 + 30");

    // Un periodo inventado cae en 30 dias.
    assert.equal((await (await get("/abarrotes/ganancia-productos?dias=5")).json()).dias, 30);
});

test("un negocio no ve los numeros de otro", async () => {
    const d = await (await get("/abarrotes/inicio", otro)).json();

    assert.equal(d.hoy.total, 0);
    assert.equal(d.hoy.ventas, 0);
    assert.deepEqual(d.masGanancia, []);
});

test("el cliente reemplaza el Inicio solo en el perfil simple y lo demas sigue igual", () => {
    const leer = ruta => fs.readFileSync(path.join(__dirname, "..", "public", ruta), "utf8");
    const js = leer("js/inicio-abarrotes.js");
    const css = leer("css/components/inicio-abarrotes.css");
    const indice = leer("index.html");

    assert.match(js, /\/abarrotes\/inicio/);
    assert.match(js, /\/abarrotes\/ganancia-productos/);
    assert.match(js, /if \(!inicioAbEsSimple\(\)\)/, "fuera de abarrotes no se pinta nada");
    assert.match(js, /mostrarInicioOriginal\(\)/, "el Inicio de siempre sigue funcionando");
    assert.match(css, /body\.perfil-simple:not\(\.perfil-ver-todo\) #pantallaInicio > \*:not\(\.dashboard-header\):not\(#inicioAbarrotes\)/);
    assert.ok(indice.indexOf("js/sales-history-documents.js") < indice.indexOf("js/inicio-abarrotes.js"), "envuelve mostrarInicio ya definida");
});
