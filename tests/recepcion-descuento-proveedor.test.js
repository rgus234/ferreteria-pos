// Fase 7 del plan de identidad multi-proveedor: al confirmar una
// factura real, si el proveedor tiene tramos de descuento configurados
// (Precios por proveedor), el costo que se guarda en
// productos.precio_distribuidor es el NETO (con el descuento del tramo
// ya aplicado), nunca el de lista tal cual viene en el CFDI. Un
// proveedor SIN tramos configurados (TRUPER, Diprofer, cualquiera que
// el dueño no haya tocado) tiene que seguir exactamente igual que
// antes de esta fase -- esa es la prueba de regresion mas importante
// de este archivo.
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { pool, crearNegocioPrueba, borrarNegocioPrueba } = require("./helpers/negocio-prueba");
const { iniciarServidorPrueba, detenerServidorPrueba, BASE_URL } = require("./helpers/servidor-prueba");
const { procesarFacturaXml } = require("../recepcion-inteligente-server");

let negocio;

function headers() {
    return { "Content-Type": "application/json", "x-dispositivo-token": negocio.token };
}

function cfdiXml({ uuid, emisorRfc, emisorNombre, total, conceptos }) {
    const conceptosXml = conceptos.map(c => `
        <cfdi:Concepto NoIdentificacion="${c.codigo || ""}" ClaveProdServ="27112700" Descripcion="${c.descripcion}"
            Cantidad="${c.cantidad ?? 1}" ValorUnitario="${c.costo ?? 10}" Importe="${(c.cantidad ?? 1) * (c.costo ?? 10)}" Unidad="Pieza">
            <cfdi:Impuestos><cfdi:Traslados><cfdi:Traslado Base="10" Impuesto="002" TipoFactor="Tasa" TasaOCuota="0.16" Importe="999"/></cfdi:Traslados></cfdi:Impuestos>
        </cfdi:Concepto>`).join("");

    return `<?xml version="1.0" encoding="UTF-8"?>
<cfdi:Comprobante xmlns:cfdi="http://www.sat.gob.mx/cfd/4" xmlns:tfd="http://www.sat.gob.mx/TimbreFiscalDigital"
  Version="4.0" Folio="1" Fecha="2026-09-08T10:00:00" SubTotal="${total}" Total="${total}">
  <cfdi:Emisor Rfc="${emisorRfc}" Nombre="${emisorNombre}"/>
  <cfdi:Receptor Rfc="OLI900101XX1" Nombre="RECEPTOR DE PRUEBA"/>
  <cfdi:Conceptos>${conceptosXml}</cfdi:Conceptos>
  <cfdi:Impuestos TotalImpuestosTrasladados="0"><cfdi:Traslados><cfdi:Traslado Base="${total}" Impuesto="002" TipoFactor="Tasa" TasaOCuota="0" Importe="0"/></cfdi:Traslados></cfdi:Impuestos>
  ${uuid ? `<cfdi:Complemento><tfd:TimbreFiscalDigital UUID="${uuid}" Version="1.1"/></cfdi:Complemento>` : ""}
</cfdi:Comprobante>`;
}

async function configurarTramos(proveedor, tramosDescuento, extra = {}) {
    const respuesta = await fetch(`${BASE_URL}/reglas-precios`, {
        method: "POST", headers: headers(),
        body: JSON.stringify({ proveedor, redondeo: "ninguno", margenesCategoria: {}, margenesProducto: {}, tramosDescuento, ...extra })
    });
    assert.equal(respuesta.status, 200);
}

async function decidirYconfirmar(recepcionId, itemId, nombreProducto, precioVenta) {
    await fetch(`${BASE_URL}/recepcion-inteligente/facturas/${recepcionId}/items/${itemId}`, {
        method: "POST", headers: headers(),
        body: JSON.stringify({ accion: "crear", nombreNuevoProducto: nombreProducto, precioVenta })
    });
    const respuesta = await fetch(`${BASE_URL}/recepcion-inteligente/facturas/${recepcionId}/confirmar`, {
        method: "POST", headers: headers()
    });
    return respuesta.json();
}

before(async () => {
    await iniciarServidorPrueba();
    negocio = await crearNegocioPrueba("recepcion-descuento");
});

after(async () => {
    if (negocio) await borrarNegocioPrueba(negocio.negocioId);
    await detenerServidorPrueba();
    await pool.end();
});

test("factura de un proveedor CON tramos configurados: el costo guardado es el neto, no el de lista", async () => {
    await configurarTramos("GAFI PRUEBA DESCUENTO SA DE CV", [
        { desde: 5000, hasta: 7999, porcentaje: 10 },
        { desde: 8000, hasta: 11999, porcentaje: 12 },
        { desde: 12000, hasta: null, porcentaje: 20 }
    ]);

    const subida = await (await fetch(`${BASE_URL}/recepcion-inteligente/facturas`, {
        method: "POST", headers: headers(),
        body: JSON.stringify({
            xml: cfdiXml({
                uuid: "UUID-DESCUENTO-0001", emisorRfc: "GDP850101AB1", emisorNombre: "GAFI PRUEBA DESCUENTO SA DE CV",
                total: 15000,
                conceptos: [{ codigo: "ZZDESC-001", descripcion: "Producto con tramo de descuento prueba unica", cantidad: 10, costo: 143 }]
            })
        })
    })).json();

    const item = (await pool.query(`SELECT id FROM public.recepciones_inteligentes_items WHERE recepcion_id = $1`, [subida.recepcionId])).rows[0];
    const confirmado = await decidirYconfirmar(subida.recepcionId, item.id, "Producto con tramo de descuento prueba unica", 200);

    assert.equal(confirmado.ok, true, JSON.stringify(confirmado));
    assert.equal(confirmado.tramoDescuentoAplicado.porcentaje, 20, "monto de 15000 cae en el tramo de 20%");

    const productoId = (await pool.query(`SELECT producto_id FROM public.recepciones_inteligentes_items WHERE id = $1`, [item.id])).rows[0].producto_id;
    const producto = await pool.query(`SELECT precio_distribuidor FROM public.productos WHERE id = $1`, [productoId]);
    assert.equal(Number(producto.rows[0].precio_distribuidor), 143 * 0.8, "el costo guardado debe ser el NETO (143 menos 20%), no el de lista");

    const itemMercancia = await pool.query(
        `SELECT costo FROM public.recepciones_mercancia_items WHERE recepcion_id = $1`, [confirmado.recepcionMercanciaId]
    );
    assert.equal(Number(itemMercancia.rows[0].costo), 143 * 0.8);
});

test("REGRESION: un proveedor SIN tramos configurados (ej. TRUPER) no cambia -- el costo guardado sigue siendo el de lista tal cual", async () => {
    const subida = await (await fetch(`${BASE_URL}/recepcion-inteligente/facturas`, {
        method: "POST", headers: headers(),
        body: JSON.stringify({
            xml: cfdiXml({
                uuid: "UUID-SINDESCUENTO-0001", emisorRfc: "TRU850101AB1", emisorNombre: "TRUPER PRUEBA SIN DESCUENTO SA DE CV",
                total: 15000,
                conceptos: [{ codigo: "ZZDESC-002", descripcion: "Producto sin tramo de descuento prueba unica", cantidad: 10, costo: 143 }]
            })
        })
    })).json();

    const item = (await pool.query(`SELECT id FROM public.recepciones_inteligentes_items WHERE recepcion_id = $1`, [subida.recepcionId])).rows[0];
    const confirmado = await decidirYconfirmar(subida.recepcionId, item.id, "Producto sin tramo de descuento prueba unica", 200);

    assert.equal(confirmado.ok, true, JSON.stringify(confirmado));
    assert.equal(confirmado.tramoDescuentoAplicado, null, "sin tramos configurados para este proveedor, nunca debe aplicarse ningun descuento");

    const productoId = (await pool.query(`SELECT producto_id FROM public.recepciones_inteligentes_items WHERE id = $1`, [item.id])).rows[0].producto_id;
    const producto = await pool.query(`SELECT precio_distribuidor FROM public.productos WHERE id = $1`, [productoId]);
    assert.equal(Number(producto.rows[0].precio_distribuidor), 143, "sin tramos, el costo debe quedar identico al de la factura, sin tocar");
});

test("un monto de factura por debajo del primer tramo tampoco activa el descuento, aunque el proveedor si tenga tramos", async () => {
    await configurarTramos("GAFI PRUEBA DESCUENTO BAJO SA DE CV", [
        { desde: 5000, hasta: 7999, porcentaje: 10 }
    ]);

    const subida = await (await fetch(`${BASE_URL}/recepcion-inteligente/facturas`, {
        method: "POST", headers: headers(),
        body: JSON.stringify({
            xml: cfdiXml({
                uuid: "UUID-DESCUENTO-BAJO-0001", emisorRfc: "GDB850101AB1", emisorNombre: "GAFI PRUEBA DESCUENTO BAJO SA DE CV",
                total: 1000,
                conceptos: [{ codigo: "ZZDESC-003", descripcion: "Producto monto bajo prueba unica", cantidad: 10, costo: 50 }]
            })
        })
    })).json();

    const item = (await pool.query(`SELECT id FROM public.recepciones_inteligentes_items WHERE recepcion_id = $1`, [subida.recepcionId])).rows[0];
    const confirmado = await decidirYconfirmar(subida.recepcionId, item.id, "Producto monto bajo prueba unica", 80);

    assert.equal(confirmado.tramoDescuentoAplicado, null);
    const productoId = (await pool.query(`SELECT producto_id FROM public.recepciones_inteligentes_items WHERE id = $1`, [item.id])).rows[0].producto_id;
    const producto = await pool.query(`SELECT precio_distribuidor FROM public.productos WHERE id = $1`, [productoId]);
    assert.equal(Number(producto.rows[0].precio_distribuidor), 50);
});

// Fase 8: Gmail (recepcion-inteligente-gmail.js) entrega el XML al MISMO
// procesarFacturaXml compartido, solo con origen='gmail' -- el tramo de
// descuento (Fase 7) y la conciliacion con remision (Fase 5) viven en
// /confirmar, que nunca distingue de donde vino la recepcion (solo si
// origen==='remision_foto'). Esta prueba es la evidencia de que Gmail
// hereda ambas fases sin escribir nada nuevo para Gmail.
test("Fase 8: una factura que llega por Gmail (origen='gmail') tambien respeta el tramo de descuento del proveedor", async () => {
    await configurarTramos("GAFI PRUEBA GMAIL SA DE CV", [{ desde: 12000, hasta: null, porcentaje: 20 }]);

    const resultado = await procesarFacturaXml(pool, negocio.negocioId,
        cfdiXml({
            uuid: "UUID-GMAIL-DESCUENTO-0001", emisorRfc: "GPG850101AB1", emisorNombre: "GAFI PRUEBA GMAIL SA DE CV",
            total: 15000,
            conceptos: [{ codigo: "ZZDESC-004", descripcion: "Producto via gmail con descuento prueba unica", cantidad: 10, costo: 143 }]
        }),
        { origen: "gmail" }
    );

    const recepcion = await pool.query(`SELECT origen FROM public.recepciones_inteligentes WHERE id = $1`, [resultado.recepcionId]);
    assert.equal(recepcion.rows[0].origen, "gmail");

    const item = (await pool.query(`SELECT id FROM public.recepciones_inteligentes_items WHERE recepcion_id = $1`, [resultado.recepcionId])).rows[0];
    const confirmado = await decidirYconfirmar(resultado.recepcionId, item.id, "Producto via gmail con descuento prueba unica", 200);

    assert.equal(confirmado.ok, true, JSON.stringify(confirmado));
    assert.equal(confirmado.tramoDescuentoAplicado.porcentaje, 20);

    const productoId = (await pool.query(`SELECT producto_id FROM public.recepciones_inteligentes_items WHERE id = $1`, [item.id])).rows[0].producto_id;
    const producto = await pool.query(`SELECT precio_distribuidor FROM public.productos WHERE id = $1`, [productoId]);
    assert.equal(Number(producto.rows[0].precio_distribuidor), 143 * 0.8);
});

// Precio de venta sugerido al revisar (costo neto con descuento del
// tramo, Fase 7, mas el margen general del proveedor -- lo que el
// dueño describio como "despues del 20% de GAFI, le sumo el 30%"):
// se pide ANTES de decidir, para que el campo "precio de venta" al
// crear el producto ya venga prellenado, no en blanco.
test("GET .../facturas/:id sugiere el precio de venta (costo neto + margen general) para un concepto sin decidir", async () => {
    await configurarTramos("GAFI PRUEBA MARGEN SA DE CV", [{ desde: 12000, hasta: null, porcentaje: 20 }], { margenGeneral: 30 });

    const subida = await (await fetch(`${BASE_URL}/recepcion-inteligente/facturas`, {
        method: "POST", headers: headers(),
        body: JSON.stringify({
            xml: cfdiXml({
                uuid: "UUID-SUGERIDO-0001", emisorRfc: "GPM850101AB1", emisorNombre: "GAFI PRUEBA MARGEN SA DE CV",
                total: 15000,
                conceptos: [{ codigo: "ZZDESC-005", descripcion: "Producto con precio sugerido prueba unica", cantidad: 10, costo: 100 }]
            })
        })
    })).json();

    const detalle = await (await fetch(`${BASE_URL}/recepcion-inteligente/facturas/${subida.recepcionId}`, { headers: headers() })).json();
    const item = detalle.items[0];

    // Costo de lista 100 -- 20% del tramo (monto 15000) = costo neto 80
    // -- +30% de margen general = 104.
    assert.equal(item.precioSugerido, 104, JSON.stringify(item));

    // Una vez decidido (o confirmado), ya no se sugiere nada -- el campo
    // vuelve a ser responsabilidad de lo que el dueño ya eligio.
    await fetch(`${BASE_URL}/recepcion-inteligente/facturas/${subida.recepcionId}/items/${item.id}`, {
        method: "POST", headers: headers(),
        body: JSON.stringify({ accion: "crear", nombreNuevoProducto: "Producto con precio sugerido prueba unica", precioVenta: 104 })
    });
    const detalleTrasDecidir = await (await fetch(`${BASE_URL}/recepcion-inteligente/facturas/${subida.recepcionId}`, { headers: headers() })).json();
    assert.equal(detalleTrasDecidir.items[0].precioSugerido, null);
});

test("sin margen general configurado, precioSugerido es null (nunca inventa un margen)", async () => {
    const subida = await (await fetch(`${BASE_URL}/recepcion-inteligente/facturas`, {
        method: "POST", headers: headers(),
        body: JSON.stringify({
            xml: cfdiXml({
                uuid: "UUID-SINSUGERIDO-0001", emisorRfc: "TSS850101AB1", emisorNombre: "TRUPER PRUEBA SIN MARGEN SA DE CV",
                total: 1000,
                conceptos: [{ codigo: "ZZDESC-006", descripcion: "Producto sin margen configurado prueba unica", cantidad: 1, costo: 50 }]
            })
        })
    })).json();

    const detalle = await (await fetch(`${BASE_URL}/recepcion-inteligente/facturas/${subida.recepcionId}`, { headers: headers() })).json();
    assert.equal(detalle.items[0].precioSugerido, null);
});
