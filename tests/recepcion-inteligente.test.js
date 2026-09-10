// Recepcion Inteligente, Fase 1 (sin Gmail todavia): parser CFDI en
// servidor, resolucion de proveedor por RFC, motor de "candidato
// ganador", y el pipeline HTTP completo -- subir factura, revisar,
// confirmar. El principio que se prueba en cada punto es el mismo:
// ningun endpoint toca productos.stock antes de /confirmar, y
// /confirmar nunca aplica un concepto que no tenga una decision.
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { pool, crearNegocioPrueba, crearProductoPrueba, borrarNegocioPrueba } = require("./helpers/negocio-prueba");
const { iniciarServidorPrueba, detenerServidorPrueba, BASE_URL } = require("./helpers/servidor-prueba");
const { parsearCfdi } = require("../cfdi-parser");
const { resolverProveedorPorRfc } = require("../proveedor-resolver");
const { resolverConceptoFactura } = require("../recepcion-inteligente-matching");

let negocio;
const maestroIdsCreados = [];

function headers() {
    return { "Content-Type": "application/json", "x-dispositivo-token": negocio.token };
}

function cfdiXml({ uuid, emisorRfc = "GAF850101AB1", emisorNombre = "GAFI SA DE CV", conceptos }) {
    const conceptosXml = conceptos.map(c => `
        <cfdi:Concepto NoIdentificacion="${c.codigo || ""}" ClaveProdServ="27112700" Descripcion="${c.descripcion}"
            Cantidad="${c.cantidad ?? 1}" ValorUnitario="${c.costo ?? 10}" Importe="${(c.cantidad ?? 1) * (c.costo ?? 10)}" Unidad="Pieza">
            <cfdi:Impuestos><cfdi:Traslados><cfdi:Traslado Base="10" Impuesto="002" TipoFactor="Tasa" TasaOCuota="0.16" Importe="999"/></cfdi:Traslados></cfdi:Impuestos>
        </cfdi:Concepto>`).join("");

    return `<?xml version="1.0" encoding="UTF-8"?>
<cfdi:Comprobante xmlns:cfdi="http://www.sat.gob.mx/cfd/4" xmlns:tfd="http://www.sat.gob.mx/TimbreFiscalDigital"
  Version="4.0" Folio="1" Fecha="2026-09-08T10:00:00" SubTotal="100.00" Total="116.00">
  <cfdi:Emisor Rfc="${emisorRfc}" Nombre="${emisorNombre}"/>
  <cfdi:Receptor Rfc="OLI900101XX1" Nombre="RECEPTOR DE PRUEBA"/>
  <cfdi:Conceptos>${conceptosXml}</cfdi:Conceptos>
  <cfdi:Impuestos TotalImpuestosTrasladados="16.00"><cfdi:Traslados><cfdi:Traslado Base="100" Impuesto="002" TipoFactor="Tasa" TasaOCuota="0.16" Importe="16.00"/></cfdi:Traslados></cfdi:Impuestos>
  ${uuid ? `<cfdi:Complemento><tfd:TimbreFiscalDigital UUID="${uuid}" Version="1.1"/></cfdi:Complemento>` : ""}
</cfdi:Comprobante>`;
}

async function crearMaestroPrueba({ codigo, nombre }) {
    const fila = await pool.query(
        `INSERT INTO public.catalogo_maestro_productos (codigo, marca, nombre, fabricante, codigo_fabricante)
         VALUES ($1, 'MARCA-PRUEBA-RI', $2, 'FABRICANTE-PRUEBA-RI', $1) RETURNING id`,
        [codigo, nombre]
    );
    maestroIdsCreados.push(fila.rows[0].id);
    return fila.rows[0].id;
}

before(async () => {
    await iniciarServidorPrueba();
    negocio = await crearNegocioPrueba("recepcion-inteligente");
});

after(async () => {
    if (negocio) await borrarNegocioPrueba(negocio.negocioId);
    for (const id of maestroIdsCreados) {
        await pool.query(`DELETE FROM public.catalogo_maestro_identificadores WHERE producto_maestro_id = $1`, [id]);
        await pool.query(`DELETE FROM public.catalogo_maestro_productos WHERE id = $1`, [id]);
    }
    await detenerServidorPrueba();
    await pool.end();
});

// --- cfdi-parser.js -----------------------------------------------

test("parsearCfdi lee UUID, RFC receptor y separa codigo de ClaveProdServ", () => {
    const xml = cfdiXml({ uuid: "UUID-PRUEBA-0001", conceptos: [{ codigo: "17366", descripcion: "Pinza de prueba" }] });
    const factura = parsearCfdi(xml);

    assert.equal(factura.uuid, "UUID-PRUEBA-0001");
    assert.equal(factura.receptorRfc, "OLI900101XX1");
    assert.equal(factura.emisorRfc, "GAF850101AB1");
    assert.equal(factura.conceptos[0].codigo, "17366");
    assert.equal(factura.conceptos[0].claveProdServ, "27112700");
});

test("parsearCfdi toma el IVA de la factura completa, no el de un concepto anidado", () => {
    // El XML de prueba trae un Impuestos.Traslado con Importe=999 DENTRO
    // del concepto -- si el parser agarrara ese en vez del de
    // Comprobante.Impuestos (16.00), este assert lo atraparia. Mismo
    // bug real que ya se corrigio del lado del navegador.
    const xml = cfdiXml({ conceptos: [{ descripcion: "Producto con impuesto anidado" }] });
    const factura = parsearCfdi(xml);
    assert.equal(factura.iva, 16);
});

test("parsearCfdi sin timbre fiscal deja uuid en null, sin tronar", () => {
    const factura = parsearCfdi(cfdiXml({ conceptos: [{ descripcion: "Sin timbre" }] }));
    assert.equal(factura.uuid, null);
});

test("parsearCfdi rechaza un XML que no es un CFDI", () => {
    assert.throws(() => parsearCfdi("<algo>no es una factura</algo>"), /no es un CFDI/);
});

test("parsearCfdi rechaza texto que ni siquiera es XML", () => {
    assert.throws(() => parsearCfdi("esto no es xml < > <"), /XML invalido/);
});

// --- proveedor-resolver.js: resolverProveedorPorRfc ----------------

test("resolverProveedorPorRfc crea un proveedor nuevo con el RFC guardado", async () => {
    const rfc = `RFCNVO${Date.now()}`;
    const id = await resolverProveedorPorRfc(pool, negocio.negocioId, rfc, "Proveedor Nuevo De Prueba");
    assert.ok(id);

    const fila = await pool.query(`SELECT rfc, creado_automatico FROM public.proveedores WHERE id = $1`, [id]);
    assert.equal(fila.rows[0].rfc, rfc.toUpperCase());
    assert.equal(fila.rows[0].creado_automatico, true);
});

test("resolverProveedorPorRfc encuentra el mismo proveedor la segunda vez, sin duplicar", async () => {
    const rfc = `RFCDUP${Date.now()}`;
    const primero = await resolverProveedorPorRfc(pool, negocio.negocioId, rfc, "Proveedor Duplicable");
    const segundo = await resolverProveedorPorRfc(pool, negocio.negocioId, rfc, "Proveedor Duplicable");
    assert.equal(primero, segundo);
});

test("resolverProveedorPorRfc completa el RFC de un proveedor que ya existia solo por nombre", async () => {
    const nombre = `Proveedor Viejo Sin Rfc ${Date.now()}`;
    const existente = await pool.query(
        `INSERT INTO public.proveedores (negocio_id, nombre, activo) VALUES ($1, $2, true) RETURNING id`,
        [negocio.negocioId, nombre]
    );

    const rfc = `RFCBACK${Date.now()}`;
    const resuelto = await resolverProveedorPorRfc(pool, negocio.negocioId, rfc, nombre);

    assert.equal(resuelto, existente.rows[0].id);
    const fila = await pool.query(`SELECT rfc FROM public.proveedores WHERE id = $1`, [resuelto]);
    assert.equal(fila.rows[0].rfc, rfc.toUpperCase());
});

// --- recepcion-inteligente-matching.js -----------------------------

test("resolverConceptoFactura encuentra por codigo exacto en catalogo_productos del proveedor", async () => {
    const producto = await crearProductoPrueba(negocio.negocioId, { nombre: "Producto ya en inventario RI", codigo: "RI-INV-1" });
    const catalogo = await pool.query(
        `INSERT INTO public.catalogos_proveedor (negocio_id, proveedor) VALUES ($1, 'Proveedor Catalogo RI') RETURNING id`,
        [negocio.negocioId]
    );
    await pool.query(
        `INSERT INTO public.catalogo_productos (negocio_id, catalogo_id, codigo_proveedor, nombre_proveedor, producto_id)
         VALUES ($1, $2, 'COD-RI-1', 'Producto ya en inventario RI', $3)`,
        [negocio.negocioId, catalogo.rows[0].id, producto.id]
    );

    const candidato = await resolverConceptoFactura(pool, negocio.negocioId, { codigo: "COD-RI-1", descripcion: "no deberia usarse" });
    assert.equal(candidato.nivel, "fuerte");
    assert.equal(candidato.productoId, producto.id);
});

test("resolverConceptoFactura nunca usa ClaveProdServ como codigo -- solo NoIdentificacion", async () => {
    // concepto.codigo simula que NoIdentificacion vino vacio: el
    // llamador (recepcion-inteligente-server.js) nunca debe pasar
    // ClaveProdServ aqui. Sin codigo util, cae a busqueda por
    // descripcion -- que tampoco debe encontrar nada para un texto sin
    // ningun parecido real.
    const candidato = await resolverConceptoFactura(pool, negocio.negocioId, { codigo: "", descripcion: "xyzzy inventado sin parecido zzqq" });
    assert.equal(candidato, null);
});

test("resolverConceptoFactura por descripcion respeta el umbral -- bajo probable, ningun candidato", async () => {
    await crearMaestroPrueba({ codigo: `RI-DESC-${Date.now()}`, nombre: "Segueta manual para metal de alta resistencia" });
    const candidato = await resolverConceptoFactura(pool, negocio.negocioId, { codigo: "", descripcion: "cosa totalmente distinta sin relacion" });
    assert.equal(candidato, null);
});

test("resolverConceptoFactura por descripcion encuentra el Catalogo Maestro cuando el texto se parece", async () => {
    const nombre = `Carretilla de obra reforzada RI ${Date.now()}`;
    await crearMaestroPrueba({ codigo: `RI-CARRE-${Date.now()}`, nombre });
    const candidato = await resolverConceptoFactura(pool, negocio.negocioId, { codigo: "", descripcion: nombre });
    assert.ok(candidato, "debio encontrar un candidato por descripcion identica");
    assert.equal(candidato.fuente, "catalogo_maestro");
});

// --- Pipeline HTTP completo -----------------------------------------

test("subir una factura sin token de dispositivo se rechaza", async () => {
    const respuesta = await fetch(`${BASE_URL}/recepcion-inteligente/facturas`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ xml: cfdiXml({ conceptos: [{ descripcion: "x" }] }) })
    });
    assert.equal(respuesta.status, 401);
});

test("subir una factura nunca toca el stock -- queda pendiente de revision", async () => {
    const producto = await crearProductoPrueba(negocio.negocioId, { nombre: "Stock intacto RI", codigo: "RI-STOCK-1", stock: 5 });
    const catalogo = await pool.query(
        `INSERT INTO public.catalogos_proveedor (negocio_id, proveedor) VALUES ($1, 'Proveedor Stock RI') RETURNING id`,
        [negocio.negocioId]
    );
    await pool.query(
        `INSERT INTO public.catalogo_productos (negocio_id, catalogo_id, codigo_proveedor, nombre_proveedor, producto_id)
         VALUES ($1, $2, 'COD-STOCK-RI', 'Stock intacto RI', $3)`,
        [negocio.negocioId, catalogo.rows[0].id, producto.id]
    );

    const uuid = `UUID-STOCK-${Date.now()}`;
    const xml = cfdiXml({ uuid, conceptos: [{ codigo: "COD-STOCK-RI", descripcion: "Stock intacto RI", cantidad: 7, costo: 50 }] });

    const respuesta = await fetch(`${BASE_URL}/recepcion-inteligente/facturas`, { method: "POST", headers: headers(), body: JSON.stringify({ xml }) });
    const datos = await respuesta.json();

    assert.equal(respuesta.status, 200);
    assert.equal(datos.identificados, 1, "el codigo exacto debe auto-identificarse como fuerte");
    assert.equal(datos.porRevisar, 0);

    const stockDespues = await pool.query(`SELECT stock FROM public.productos WHERE id = $1`, [producto.id]);
    assert.equal(Number(stockDespues.rows[0].stock), 5, "el stock no debe cambiar antes de /confirmar");
});

test("subir la misma factura (mismo UUID) dos veces no crea una segunda recepcion", async () => {
    const uuid = `UUID-REPETIDA-${Date.now()}`;
    const xml = cfdiXml({ uuid, conceptos: [{ descripcion: "Concepto repetido de prueba" }] });

    const primera = await fetch(`${BASE_URL}/recepcion-inteligente/facturas`, { method: "POST", headers: headers(), body: JSON.stringify({ xml }) });
    const datosPrimera = await primera.json();
    assert.equal(datosPrimera.repetida, false);

    const segunda = await fetch(`${BASE_URL}/recepcion-inteligente/facturas`, { method: "POST", headers: headers(), body: JSON.stringify({ xml }) });
    const datosSegunda = await segunda.json();
    assert.equal(datosSegunda.repetida, true);
    assert.equal(datosSegunda.recepcionId, datosPrimera.recepcionId);

    const conteo = await pool.query(`SELECT COUNT(*)::int AS n FROM public.recepciones_inteligentes WHERE uuid_cfdi = $1`, [uuid]);
    assert.equal(conteo.rows[0].n, 1);
});

test("un XML invalido se rechaza con 400 y no crea ninguna recepcion", async () => {
    const antes = await pool.query(`SELECT COUNT(*)::int AS n FROM public.recepciones_inteligentes WHERE negocio_id = $1`, [negocio.negocioId]);

    const respuesta = await fetch(`${BASE_URL}/recepcion-inteligente/facturas`, { method: "POST", headers: headers(), body: JSON.stringify({ xml: "<no-es-cfdi/>" }) });
    assert.equal(respuesta.status, 400);

    const despues = await pool.query(`SELECT COUNT(*)::int AS n FROM public.recepciones_inteligentes WHERE negocio_id = $1`, [negocio.negocioId]);
    assert.equal(despues.rows[0].n, antes.rows[0].n);
});

test("flujo completo: relacionar, crear y omitir, luego confirmar aplica solo lo decidido", async () => {
    const productoExistente = await crearProductoPrueba(negocio.negocioId, { nombre: "Ya en inventario para relacionar", codigo: "RI-FLUJO-EXISTE", stock: 3 });

    const uuid = `UUID-FLUJO-${Date.now()}`;
    const xml = cfdiXml({
        uuid,
        conceptos: [
            { codigo: "", descripcion: "Producto para relacionar a mano", cantidad: 2, costo: 40 },
            { codigo: "", descripcion: "Producto totalmente nuevo de fabrica", cantidad: 3, costo: 60 },
            { codigo: "", descripcion: "Producto que se va a omitir", cantidad: 1, costo: 999 }
        ]
    });

    const subida = await fetch(`${BASE_URL}/recepcion-inteligente/facturas`, { method: "POST", headers: headers(), body: JSON.stringify({ xml }) });
    const datosSubida = await subida.json();
    const recepcionId = datosSubida.recepcionId;
    assert.equal(datosSubida.porRevisar, 3, "ningun concepto trae codigo -- los 3 deben quedar por revisar");

    const detalle = await fetch(`${BASE_URL}/recepcion-inteligente/facturas/${recepcionId}`, { headers: headers() });
    const { items } = await detalle.json();
    const [itemRelacionar, itemCrear, itemOmitir] = items;

    // Confirmar antes de decidir todo debe rechazarse.
    const confirmarTemprano = await fetch(`${BASE_URL}/recepcion-inteligente/facturas/${recepcionId}/confirmar`, { method: "POST", headers: headers() });
    assert.equal(confirmarTemprano.status, 400);

    const r1 = await fetch(`${BASE_URL}/recepcion-inteligente/facturas/${recepcionId}/items/${itemRelacionar.id}`, {
        method: "POST", headers: headers(), body: JSON.stringify({ accion: "relacionar", productoId: productoExistente.id })
    });
    assert.equal(r1.status, 200, JSON.stringify(await r1.clone().json().catch(() => null)));

    // El boton "Cambiar" de la pantalla resetea una decision ya tomada
    // (accion="") para volver a elegir -- debe quedar de nuevo sin
    // decidir, sin romper nada.
    await fetch(`${BASE_URL}/recepcion-inteligente/facturas/${recepcionId}/items/${itemRelacionar.id}`, {
        method: "POST", headers: headers(), body: JSON.stringify({ accion: "" })
    });
    const detalleTrasReset = await (await fetch(`${BASE_URL}/recepcion-inteligente/facturas/${recepcionId}`, { headers: headers() })).json();
    assert.equal(detalleTrasReset.items.find(it => it.id === itemRelacionar.id).accion, "");

    const r1otraVez = await fetch(`${BASE_URL}/recepcion-inteligente/facturas/${recepcionId}/items/${itemRelacionar.id}`, {
        method: "POST", headers: headers(), body: JSON.stringify({ accion: "relacionar", productoId: productoExistente.id })
    });
    assert.equal(r1otraVez.status, 200);

    const r2 = await fetch(`${BASE_URL}/recepcion-inteligente/facturas/${recepcionId}/items/${itemCrear.id}`, {
        method: "POST", headers: headers(), body: JSON.stringify({ accion: "crear", nombreNuevoProducto: "Producto totalmente nuevo de fabrica", precioVenta: 65 })
    });
    assert.equal(r2.status, 200, JSON.stringify(await r2.clone().json().catch(() => null)));

    const r3 = await fetch(`${BASE_URL}/recepcion-inteligente/facturas/${recepcionId}/items/${itemOmitir.id}`, {
        method: "POST", headers: headers(), body: JSON.stringify({ accion: "omitir" })
    });
    assert.equal(r3.status, 200, JSON.stringify(await r3.clone().json().catch(() => null)));

    const confirmar = await fetch(`${BASE_URL}/recepcion-inteligente/facturas/${recepcionId}/confirmar`, { method: "POST", headers: headers() });
    const datosConfirmar = await confirmar.json();
    assert.equal(confirmar.status, 200, JSON.stringify(datosConfirmar));

    const stockRelacionado = await pool.query(`SELECT stock FROM public.productos WHERE id = $1`, [productoExistente.id]);
    assert.equal(Number(stockRelacionado.rows[0].stock), 5, "3 (inicial) + 2 (recibido) = 5");

    const nuevoProducto = await pool.query(
        `SELECT id, stock, precio, precio_publico, precio_mayoreo, precio_distribuidor
           FROM public.productos WHERE negocio_id = $1 AND nombre = 'Producto totalmente nuevo de fabrica'`,
        [negocio.negocioId]
    );
    assert.equal(nuevoProducto.rows.length, 1, "el producto omitido NUNCA debe darse de alta");
    assert.equal(Number(nuevoProducto.rows[0].stock), 3);
    // El precio de venta elegido al revisar (65) es distinto del costo de
    // la factura (60) -- confirma que /confirmar ya no copia el costo tal
    // cual para el precio de venta. precio_distribuidor sigue siendo el
    // costo: ese campo funciona como "ultimo costo", no como tier de venta,
    // mismo comportamiento de antes de este cambio.
    assert.equal(Number(nuevoProducto.rows[0].precio), 65);
    assert.equal(Number(nuevoProducto.rows[0].precio_publico), 65);
    assert.equal(Number(nuevoProducto.rows[0].precio_mayoreo), 65);
    assert.equal(Number(nuevoProducto.rows[0].precio_distribuidor), 60);

    const omitido = await pool.query(`SELECT COUNT(*)::int AS n FROM public.productos WHERE negocio_id = $1 AND nombre = 'Producto que se va a omitir'`, [negocio.negocioId]);
    assert.equal(omitido.rows[0].n, 0);

    // La recepcion confirmada debe aparecer en el Historial de
    // recepcion de mercancia que ya existia -- sin construir una
    // pantalla de historial aparte.
    const mercancia = await pool.query(
        `SELECT total FROM public.recepciones_mercancia WHERE id = $1`,
        [datosConfirmar.recepcionMercanciaId]
    );
    assert.equal(mercancia.rows.length, 1);
    assert.equal(Number(mercancia.rows[0].total), 2 * 40 + 3 * 60);

    const itemsMercancia = await pool.query(
        `SELECT COUNT(*)::int AS n FROM public.recepciones_mercancia_items WHERE recepcion_id = $1`,
        [datosConfirmar.recepcionMercanciaId]
    );
    assert.equal(itemsMercancia.rows[0].n, 2, "solo los 2 items aplicados, el omitido no se copia al historial");

    // Ya confirmada: ni confirmar ni rechazar de nuevo, ni editar items.
    const reconfirmar = await fetch(`${BASE_URL}/recepcion-inteligente/facturas/${recepcionId}/confirmar`, { method: "POST", headers: headers() });
    assert.equal(reconfirmar.status, 400);

    const rechazarConfirmada = await fetch(`${BASE_URL}/recepcion-inteligente/facturas/${recepcionId}/rechazar`, { method: "POST", headers: headers() });
    assert.equal(rechazarConfirmada.status, 400);
});

test("crear producto sin precioVenta se rechaza con 400", async () => {
    const uuid = `UUID-SINPRECIO-${Date.now()}`;
    const xml = cfdiXml({ uuid, conceptos: [{ descripcion: "Concepto sin precio de venta elegido", costo: 30 }] });

    const subida = await fetch(`${BASE_URL}/recepcion-inteligente/facturas`, { method: "POST", headers: headers(), body: JSON.stringify({ xml }) });
    const { recepcionId, } = await subida.json();
    const detalle = await (await fetch(`${BASE_URL}/recepcion-inteligente/facturas/${recepcionId}`, { headers: headers() })).json();

    const respuesta = await fetch(`${BASE_URL}/recepcion-inteligente/facturas/${recepcionId}/items/${detalle.items[0].id}`, {
        method: "POST", headers: headers(), body: JSON.stringify({ accion: "crear", nombreNuevoProducto: "Producto sin precio" })
    });
    assert.equal(respuesta.status, 400);
});

test("crear producto usa el precio de referencia elegido (no el costo) cuando el candidato trae varios precios", async () => {
    // Regla de negocio real (Ferreteria Olimpico): el precio de venta
    // sugerido es el medio mayoreo del proveedor, distinto del costo de
    // la factura -- ver memoria "Catalogo proveedor: precio medio
    // mayoreo". Aqui se prueba que ese precio de referencia (no el
    // costo) es el que de verdad puede terminar en el producto nuevo.
    const catalogo = await pool.query(
        `INSERT INTO public.catalogos_proveedor (negocio_id, proveedor) VALUES ($1, 'Proveedor Precios RI') RETURNING id`,
        [negocio.negocioId]
    );
    await pool.query(
        `INSERT INTO public.catalogo_productos
            (negocio_id, catalogo_id, codigo_proveedor, nombre_proveedor, precio_distribuidor, precio_medio_mayoreo, precio_publico)
         VALUES ($1, $2, 'COD-PRECIOS-RI', 'Producto con 3 precios de referencia', 40, 55, 70)`,
        [negocio.negocioId, catalogo.rows[0].id]
    );

    const candidato = await resolverConceptoFactura(pool, negocio.negocioId, { codigo: "COD-PRECIOS-RI", descripcion: "no deberia usarse" });
    assert.equal(candidato.precioMedioMayoreo, 55);

    const uuid = `UUID-PRECIOELEGIDO-${Date.now()}`;
    const xml = cfdiXml({ uuid, conceptos: [{ codigo: "COD-PRECIOS-RI", descripcion: "Producto con 3 precios de referencia", costo: 30 }] });
    const subida = await fetch(`${BASE_URL}/recepcion-inteligente/facturas`, { method: "POST", headers: headers(), body: JSON.stringify({ xml }) });
    const { recepcionId } = await subida.json();
    const detalle = await (await fetch(`${BASE_URL}/recepcion-inteligente/facturas/${recepcionId}`, { headers: headers() })).json();
    const item = detalle.items[0];
    assert.equal(item.candidato.precioMedioMayoreo, 55, "el candidato guardado en el item debe traer los 3 precios de referencia");

    await fetch(`${BASE_URL}/recepcion-inteligente/facturas/${recepcionId}/items/${item.id}`, {
        method: "POST", headers: headers(), body: JSON.stringify({ accion: "crear", nombreNuevoProducto: "Producto con 3 precios de referencia", precioVenta: 55 })
    });

    const confirmar = await fetch(`${BASE_URL}/recepcion-inteligente/facturas/${recepcionId}/confirmar`, { method: "POST", headers: headers() });
    assert.equal(confirmar.status, 200);

    const producto = await pool.query(
        `SELECT precio, precio_publico, precio_mayoreo, precio_distribuidor FROM public.productos
          WHERE negocio_id = $1 AND nombre = 'Producto con 3 precios de referencia'`,
        [negocio.negocioId]
    );
    assert.equal(Number(producto.rows[0].precio), 55, "debe usar el medio mayoreo elegido, no el costo (30) ni el publico (70)");
    assert.equal(Number(producto.rows[0].precio_distribuidor), 30, "precio_distribuidor sigue siendo el costo de la factura");
});

test("rechazar una factura pendiente no toca inventario y bloquea confirmarla despues", async () => {
    const uuid = `UUID-RECHAZO-${Date.now()}`;
    const xml = cfdiXml({ uuid, conceptos: [{ descripcion: "Concepto de una factura rechazada" }] });

    const subida = await fetch(`${BASE_URL}/recepcion-inteligente/facturas`, { method: "POST", headers: headers(), body: JSON.stringify({ xml }) });
    const { recepcionId } = await subida.json();

    const rechazar = await fetch(`${BASE_URL}/recepcion-inteligente/facturas/${recepcionId}/rechazar`, { method: "POST", headers: headers() });
    assert.equal(rechazar.status, 200);

    const confirmar = await fetch(`${BASE_URL}/recepcion-inteligente/facturas/${recepcionId}/confirmar`, { method: "POST", headers: headers() });
    assert.equal(confirmar.status, 400);

    const fila = await pool.query(`SELECT estado FROM public.recepciones_inteligentes WHERE id = $1`, [recepcionId]);
    assert.equal(fila.rows[0].estado, "rechazada");
});
