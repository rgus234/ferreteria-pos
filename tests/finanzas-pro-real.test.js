// Finanzas avanzadas real (ver plan stateless-doodling-tarjan.md): la
// pantalla de Finanzas (public/fase5.js) existia completa y gratis
// para cualquier plan pese a que la pagina de precios la promete
// exclusiva de Pro -- aqui se prueba el candado nuevo y el calculo de
// margen real (utilidad neta con el costo de producto restado, no solo
// gastos operativos).
//
// La division de costo por pieza suelta (costo de bolsa entre
// piezas_por_bolsa) pasa en el CLIENTE (public/js/pos-sales.js), sin
// arnes de pruebas de navegador en este proyecto -- aqui se prueba que
// el SERVIDOR calcula bien el margen dado cualquier costo por unidad
// que le llegue, que es exactamente lo que el cliente ya deberia haber
// resuelto antes de mandar la venta.

const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const {
    pool, crearNegocioPrueba, crearProductoPrueba, establecerPlanPrueba, borrarNegocioPrueba
} = require("./helpers/negocio-prueba");
const { iniciarServidorPrueba, detenerServidorPrueba, BASE_URL } = require("./helpers/servidor-prueba");

let negocio;

function headers() {
    return { "Content-Type": "application/json", "x-dispositivo-token": negocio.token };
}

before(async () => {
    await iniciarServidorPrueba();
    negocio = await crearNegocioPrueba("finanzas-pro");
    await fetch(`${BASE_URL}/caja/abrir`, {
        method: "POST", headers: headers(),
        body: JSON.stringify({ usuario: "prueba", fondoInicial: 0, notas: "" })
    });
});

after(async () => {
    if (negocio) await borrarNegocioPrueba(negocio.negocioId);
    await detenerServidorPrueba();
    await pool.end();
});

test("plan Basico: /finanzas/estado dice que no esta disponible y /finanzas/resumen se rechaza", async () => {
    await establecerPlanPrueba(negocio.negocioId, "basico");

    const estado = await (await fetch(`${BASE_URL}/finanzas/estado`, { headers: headers() })).json();
    assert.equal(estado.disponibleEnPlan, false);

    const resumen = await fetch(`${BASE_URL}/finanzas/resumen`, { headers: headers() });
    assert.equal(resumen.status, 403);
    const datos = await resumen.json();
    assert.equal(datos.requiereUpgrade, true);
});

test("plan Pro: /finanzas/estado dice que si esta disponible y /finanzas/resumen responde", async () => {
    await establecerPlanPrueba(negocio.negocioId, "pro");

    const estado = await (await fetch(`${BASE_URL}/finanzas/estado`, { headers: headers() })).json();
    assert.equal(estado.disponibleEnPlan, true);

    const resumen = await fetch(`${BASE_URL}/finanzas/resumen`, { headers: headers() });
    assert.equal(resumen.status, 200);
});

test("margen real: solo cuenta el costo de las lineas que de verdad lo traen, nunca como $0", async () => {
    await establecerPlanPrueba(negocio.negocioId, "pro");

    const conCosto = await crearProductoPrueba(negocio.negocioId, { nombre: "Con costo conocido", precio: 100 });
    const sinCosto = await crearProductoPrueba(negocio.negocioId, { nombre: "Sin costo conocido", precio: 50 });

    // Venta A: 2 piezas a $100, costo real $60 c/u (ya serian el costo
    // POR UNIDAD vendida, como lo mandaria el cliente tras dividir entre
    // piezas_por_bolsa si aplicara).
    const ventaA = await fetch(`${BASE_URL}/ventas`, {
        method: "POST", headers: headers(),
        body: JSON.stringify({
            productos: [{ id: conCosto.id, precio: 100, cantidad: 2, costo: 60, modoVenta: "bolsa" }],
            metodoPago: "efectivo", pagos: { efectivo: 200 }, recibido: 200, cambio: 0,
            cajeroUsuario: "prueba", cajeroNombre: "Prueba automatizada"
        })
    });
    assert.equal(ventaA.status, 200);

    // Venta B: 1 pieza a $50, SIN campo costo -- simula un producto que
    // nunca paso por Recepcion Inteligente con factura real.
    const ventaB = await fetch(`${BASE_URL}/ventas`, {
        method: "POST", headers: headers(),
        body: JSON.stringify({
            productos: [{ id: sinCosto.id, precio: 50, cantidad: 1, modoVenta: "bolsa" }],
            metodoPago: "efectivo", pagos: { efectivo: 50 }, recibido: 50, cambio: 0,
            cajeroUsuario: "prueba", cajeroNombre: "Prueba automatizada"
        })
    });
    assert.equal(ventaB.status, 200);

    const resumen = await (await fetch(`${BASE_URL}/finanzas/resumen`, { headers: headers() })).json();

    assert.equal(resumen.ingresos, 250, "200 + 50");
    assert.equal(resumen.costo_productos, 120, "solo la venta A: 60 x 2, la B no tenia costo");
    assert.equal(resumen.margen_bruto, 130, "250 - 120");
    assert.equal(resumen.utilidad_neta_real, 130, "sin gastos operativos registrados");
    assert.equal(resumen.cobertura_costo, 0.5, "1 de 2 lineas trae costo");
});
