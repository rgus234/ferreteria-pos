// Recibir mercancia (abarrotes): caducidad por producto al recibir y pago al repartidor (cuanto, como y quien).
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { pool, crearNegocioPrueba, borrarNegocioPrueba, crearProductoPrueba } = require("./helpers/negocio-prueba");
const { iniciarServidorPrueba, detenerServidorPrueba, BASE_URL } = require("./helpers/servidor-prueba");
const { limpiarPago, limpiarFecha, METODOS_PAGO } = require("../pago-recepcion");

let negocio;
let yogurt;
let galletas;
const headers = () => ({ "Content-Type": "application/json", "x-dispositivo-token": negocio.token });
const recibir = cuerpo => fetch(`${BASE_URL}/recepciones-mercancia/rapida`, { method: "POST", headers: headers(), body: JSON.stringify(cuerpo) });

before(async () => {
    await iniciarServidorPrueba();
    negocio = await crearNegocioPrueba("pago-recepcion");
    yogurt = await crearProductoPrueba(negocio.negocioId, { nombre: "Yogurt de prueba", precio: 18, stock: 2 });
    galletas = await crearProductoPrueba(negocio.negocioId, { nombre: "Galletas de prueba", precio: 12, stock: 5 });
});

after(async () => {
    if (negocio) await borrarNegocioPrueba(negocio.negocioId);
    await detenerServidorPrueba();
    await pool.end();
});

test("el pago se limpia: metodo conocido, monto valido, textos cortos; 'se quedo a deber' puede ir sin monto", () => {
    assert.deepEqual(limpiarPago({ monto: "350,50", metodo: "efectivo_caja", por: "  Gustavo   Diaz ", nota: "Bimbo" }), { monto: 350.5, metodo: "efectivo_caja", por: "Gustavo Diaz", nota: "Bimbo", vencimiento: null });
    assert.equal(limpiarPago({ monto: 100, metodo: "bitcoin" }), null, "metodo desconocido");
    assert.equal(limpiarPago({ monto: 0, metodo: "transferencia" }), null, "sin monto");
    assert.equal(limpiarPago({ monto: -5, metodo: "transferencia" }), null);
    assert.equal(limpiarPago(null), null);
    assert.equal(limpiarPago({ metodo: "a_deber" }).monto, 0, "a deber sin monto exacto");
    assert.ok(METODOS_PAGO.efectivo_caja && METODOS_PAGO.efectivo_propio && METODOS_PAGO.transferencia && METODOS_PAGO.a_deber);
});

test("la fecha de caducidad solo acepta fechas reales", () => {
    assert.equal(limpiarFecha("2027-01-15"), "2027-01-15");
    assert.equal(limpiarFecha("2027-02-31"), null, "31 de febrero no existe");
    assert.equal(limpiarFecha("15/01/2027"), null);
    assert.equal(limpiarFecha(""), null);
});

test("recibir a mano: abre el lote con la caducidad escrita y anota el pago al repartidor", async () => {
    const r = await (await recibir({
        proveedor: "Lala Distribuidor", sinFactura: true, referencia: "Recibir mercancia", usuarioNombre: "Gustavo",
        items: [{ productoId: yogurt.id, cantidad: 12, costo: 0, caducidad: "2027-01-15" }, { productoId: galletas.id, cantidad: 6, costo: 0 }],
        pago: { monto: 480, metodo: "efectivo_caja", por: "Gustavo", nota: "Pago de contado" }
    })).json();

    assert.equal(r.ok, true, JSON.stringify(r));
    assert.equal(r.pagoGuardado, true);

    const guardada = (await pool.query(`SELECT pago_monto, pago_metodo, pago_por, pago_nota FROM public.recepciones_mercancia WHERE id = $1 AND negocio_id = $2`, [r.recepcion.id, negocio.negocioId])).rows[0];
    assert.equal(Number(guardada.pago_monto), 480);
    assert.equal(guardada.pago_metodo, "efectivo_caja");
    assert.equal(guardada.pago_por, "Gustavo");

    const lote = (await pool.query(`SELECT cantidad, to_char(fecha_caducidad, 'YYYY-MM-DD') AS fecha FROM public.producto_lotes WHERE negocio_id = $1 AND producto_id = $2`, [negocio.negocioId, yogurt.id])).rows;
    assert.equal(lote.length, 1, "el yogurt abre su lote con la fecha que se escribio");
    assert.equal(lote[0].fecha, "2027-01-15");
    assert.equal(Number(lote[0].cantidad), 12);

    const sinLote = (await pool.query(`SELECT 1 FROM public.producto_lotes WHERE negocio_id = $1 AND producto_id = $2`, [negocio.negocioId, galletas.id])).rows;
    assert.equal(sinLote.length, 0, "lo que no tiene fecha ni vida util no abre lote");

    const stock = (await pool.query(`SELECT stock FROM public.productos WHERE id = $1`, [yogurt.id])).rows[0].stock;
    assert.equal(Number(stock), 14, "2 + 12");

    const lista = (await (await fetch(`${BASE_URL}/recepciones-mercancia`, { headers: headers() })).json());
    const fila = (lista.recepciones || lista).find(x => x.id === r.recepcion.id);
    assert.equal(Number(fila.pago_monto), 480, "el historial trae el pago");
});

test("un pago invalido no tumba la recepcion: se recibe igual y se avisa que no quedo anotado", async () => {
    const antes = Number((await pool.query(`SELECT stock FROM public.productos WHERE id = $1`, [galletas.id])).rows[0].stock);
    const r = await (await recibir({ proveedor: "Bimbo", items: [{ productoId: galletas.id, cantidad: 4 }], pago: { monto: 100, metodo: "bitcoin" } })).json();

    assert.equal(r.ok, true);
    assert.equal(r.pagoGuardado, false, "el pago no valido no se anota");
    assert.equal(Number((await pool.query(`SELECT stock FROM public.productos WHERE id = $1`, [galletas.id])).rows[0].stock), antes + 4, "la mercancia si entro");
});

test("recibir sin pago ni caducidad funciona exactamente igual que antes", async () => {
    const r = await (await recibir({ proveedor: "Varios", items: [{ productoId: galletas.id, cantidad: 1 }] })).json();
    assert.equal(r.ok, true);
    assert.equal(r.pagoGuardado, null);
});

test("pantallas: Recibir mercancia y el conteo de la factura hablan de abarrotes, con caducidad, pago al repartidor y un solo precio", () => {
    const fs = require("node:fs");
    const path = require("node:path");
    const leer = ruta => fs.readFileSync(path.join(__dirname, "..", "public", ruta), "utf8");
    const rm = leer("js/recibir-marca-view.js");
    const ri = leer("js/recepcion-inteligente-view.js");

    // Recibir mercancia (a mano y con factura)
    assert.match(rm, /rmCaducidad = function/);
    assert.match(rm, /\.\.\.\(rm\.caducidades\.get\(l\.id\) \? \{ caducidad: rm\.caducidades\.get\(l\.id\) \} : \{\}\)/, "la caducidad viaja por producto");
    assert.match(rm, /rmPagoActivar = function/);
    assert.match(rm, /\/caja\/movimientos/, "el efectivo de la caja tambien sale en Caja");
    assert.match(rm, /tipo: "salida"/);
    assert.match(rm, /Escribe cuánto le pagaste al repartidor/, "pide el monto");
    assert.match(rm, /c\.itemIds\.forEach\(id => \{ caducidades\[id\] = fecha; \}\)/, "con factura, la fecha va a cada renglon");

    // Conteo de la factura
    assert.match(ri, /Contar lo que llegó/);
    assert.match(ri, /riEsAbarrotes\(\) \? "✍️ Contar lo que llegó" : "📷 Escanear lo que llegó"/, "ferreteria conserva Escanear");
    assert.match(ri, /riEscCaducidad\(/);
    assert.match(ri, /riPagoRepartidorHtml\(\)/);
    assert.match(ri, /\.\.\.\(riExtraConfirmacion && riExtraConfirmacion\.pago \? \{ pago: riExtraConfirmacion\.pago \} : \{\}\)/, "el pago viaja al confirmar");

    // Un solo precio de venta en abarrotes
    assert.match(ri, /<label>Precio de venta<input type="number"[^>]*id="riAsisPublico"/, "el asistente pregunta un solo precio");
    assert.doesNotMatch(ri, /riAsisMayoreo/, "ya no hay campo de medio mayoreo en el asistente");
    assert.match(ri, /d\.precioMedioMayoreo = publico\.value/, "el medio mayoreo se guarda igual que el de venta");
    assert.match(ri, /precios\.medioMayoreo != null && !riEsAbarrotes\(\)/, "no se muestran niveles de mayoreo");
    assert.match(ri, /riEsAbarrotes\(\) \? "" : `<label>Medio mayoreo/, "el formulario clasico tampoco en abarrotes");
});

test("el historial de recepciones muestra quien pago al repartidor, cuanto y como", () => {
    const fs = require("node:fs");
    const path = require("node:path");
    const flujo = fs.readFileSync(path.join(__dirname, "..", "public", "js", "ferretero-flow.js"), "utf8");

    assert.match(flujo, /function textoPagoRecepcion\(r\)/);
    assert.match(flujo, /Pagado \$\{dinero\(monto\)\} · \$\{metodos\[r\.pago_metodo\]/);
    assert.match(flujo, /function hrPago\(r\)/, "en la lista (etiqueta de pago de cada recepcion)");
    assert.match(flujo, /A deber\$\{monto > 0/, "a deber sale como etiqueta roja");
    assert.match(flujo, /Pago al repartidor:<\/strong>/, "en el detalle");
});
