// Fase 2 del plan "celular como plan B": edicion rapida de producto y
// recepcion rapida de mercancia. Lo delicado de las dos:
//  - PUT /editar-producto reemplaza ~40 campos; la edicion rapida NO puede
//    borrar nada que no se haya tocado (categoria, marca, proveedor...).
//  - precio (precio del carrito) y precio_publico son cosas distintas en
//    el inventario real; cambiar uno no puede pisar al otro.
//  - Reintentar una recepcion (mala señal) no puede sumar el stock dos veces.

const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { hashPassword } = require("../password-utils");
const { pool, crearNegocioPrueba, crearProductoPrueba, borrarNegocioPrueba } = require("./helpers/negocio-prueba");
const { iniciarServidorPrueba, detenerServidorPrueba, BASE_URL } = require("./helpers/servidor-prueba");

let negocio;
let otroNegocio;
let empleadoId;

function headers(extra = {}) {
    return { "Content-Type": "application/json", "x-dispositivo-token": negocio.token, ...extra };
}

async function parchar(id, cuerpo, extraHeaders) {
    const respuesta = await fetch(`${BASE_URL}/productos/${id}/edicion-rapida`, {
        method: "PATCH", headers: headers(extraHeaders), body: JSON.stringify(cuerpo)
    });
    return { status: respuesta.status, cuerpo: await respuesta.json() };
}

async function filaProducto(id) {
    return (await pool.query(`SELECT * FROM public.productos WHERE id = $1`, [id])).rows[0];
}

before(async () => {
    await iniciarServidorPrueba();
    negocio = await crearNegocioPrueba("inventario-celular");
    otroNegocio = await crearNegocioPrueba("inventario-celular-otro");

    const empleado = await pool.query(
        `INSERT INTO public.empleados (negocio_id, nombre, rol, pin_hash, permisos)
         VALUES ($1, 'Cajero sin inventario', 'Cajero', $2, '{"hacer_ventas": true}'::jsonb) RETURNING id`,
        [negocio.negocioId, hashPassword("1234")]
    );
    empleadoId = empleado.rows[0].id;
});

after(async () => {
    if (negocio) await borrarNegocioPrueba(negocio.negocioId);
    if (otroNegocio) await borrarNegocioPrueba(otroNegocio.negocioId);
    await detenerServidorPrueba();
    await pool.end();
});

async function crearProductoCompleto(overrides = {}) {
    const base = await crearProductoPrueba(negocio.negocioId, { nombre: "Taladro completo", stock: 10, precio: 90 });
    await pool.query(
        `UPDATE public.productos SET
            categoria = 'Herramienta electrica', subcategoria = 'Taladros', marca = 'TRUPER',
            descripcion = 'Taladro de 1/2 pulgada', proveedor = 'Diprofer', ubicacion = 'Pasillo 3',
            precio_publico = 120, precio_mayoreo = 100, precio_distribuidor = 80, costo = 70,
            stock_minimo = 2, tiene_garantia = true, garantia_detalle = '1 año'
         WHERE id = $1`,
        [base.id]
    );
    if (overrides.precio !== undefined) {
        await pool.query(`UPDATE public.productos SET precio = $1 WHERE id = $2`, [overrides.precio, base.id]);
    }
    return base.id;
}

test("edicion rapida cambia lo que se manda y NO borra el resto del producto", async () => {
    const id = await crearProductoCompleto();

    const { status, cuerpo } = await parchar(id, { nombre: "Taladro renombrado", precioPublico: 135 });
    assert.equal(status, 200);
    assert.equal(cuerpo.ok, true);

    const fila = await filaProducto(id);
    assert.equal(fila.nombre, "Taladro renombrado");
    assert.equal(Number(fila.precio_publico), 135);

    // lo que NO se toco sigue exactamente igual
    assert.equal(fila.categoria, "Herramienta electrica");
    assert.equal(fila.subcategoria, "Taladros");
    assert.equal(fila.marca, "TRUPER");
    assert.equal(fila.descripcion, "Taladro de 1/2 pulgada");
    assert.equal(fila.proveedor, "Diprofer");
    assert.equal(fila.ubicacion, "Pasillo 3");
    assert.equal(Number(fila.precio_mayoreo), 100);
    assert.equal(Number(fila.precio_distribuidor), 80);
    assert.equal(Number(fila.costo), 70);
    assert.equal(Number(fila.stock_minimo), 2);
    assert.equal(fila.tiene_garantia, true);
    assert.equal(fila.garantia_detalle, "1 año");
});

test("precio del carrito: solo sigue al precio publico cuando ya eran iguales", async () => {
    // precio 90 distinto de publico 120 -> el carrito NO se mueve
    const distinto = await crearProductoCompleto();
    await parchar(distinto, { precioPublico: 150 });
    const filaDistinto = await filaProducto(distinto);
    assert.equal(Number(filaDistinto.precio_publico), 150);
    assert.equal(Number(filaDistinto.precio), 90, "un precio de carrito distinto no se pisa");

    // precio 120 igual al publico 120 -> se mueven juntos
    const igual = await crearProductoCompleto({ precio: 120 });
    await parchar(igual, { precioPublico: 140 });
    const filaIgual = await filaProducto(igual);
    assert.equal(Number(filaIgual.precio_publico), 140);
    assert.equal(Number(filaIgual.precio), 140, "si eran iguales, siguen iguales");
});

test("se pueden editar mayoreo, distribuidor, costo, minimo, ubicacion y caducidad; y limpiar un precio con vacio", async () => {
    const id = await crearProductoCompleto();

    const { status } = await parchar(id, {
        precioMayoreo: 95, precioDistribuidor: "", costo: 65.5, stockMinimo: 5, ubicacion: "Bodega", fechaCaducidad: "2027-03-01"
    });
    assert.equal(status, 200);

    const fila = await filaProducto(id);
    assert.equal(Number(fila.precio_mayoreo), 95);
    assert.equal(fila.precio_distribuidor, null, "vacio limpia el precio");
    assert.equal(Number(fila.costo), 65.5);
    assert.equal(Number(fila.stock_minimo), 5);
    assert.equal(fila.ubicacion, "Bodega");
    assert.equal(new Date(fila.fecha_caducidad).toISOString().slice(0, 10), "2027-03-01");
});

test("cambiar el codigo: rechaza uno que ya tiene otro producto, y al cambiarlo respeta los codigos alternos", async () => {
    const a = await crearProductoCompleto();
    const b = await crearProductoCompleto();
    await pool.query(`UPDATE public.productos SET codigo = 'AAA111' WHERE id = $1`, [a]);
    await pool.query(`UPDATE public.productos SET codigo = 'BBB222' WHERE id = $1`, [b]);
    await pool.query(
        `INSERT INTO public.producto_codigos (negocio_id, producto_id, codigo, tipo, proveedor) VALUES
            ($1, $2, 'AAA111', 'barra', ''), ($1, $2, 'ALTERNO-A', 'alterno', '')`,
        [negocio.negocioId, a]
    );

    const duplicado = await parchar(a, { codigo: "bbb-222" });
    assert.equal(duplicado.status, 409);
    assert.match(duplicado.cuerpo.error, /ya lo tiene/);
    assert.equal((await filaProducto(a)).codigo, "AAA111", "no cambio nada");

    const bueno = await parchar(a, { codigo: "CCC333" });
    assert.equal(bueno.status, 200);
    assert.equal((await filaProducto(a)).codigo, "CCC333");

    const codigos = await pool.query(`SELECT codigo, tipo FROM public.producto_codigos WHERE producto_id = $1 ORDER BY codigo`, [a]);
    assert.deepEqual(codigos.rows.map(c => `${c.tipo}:${c.codigo}`), ["alterno:ALTERNO-A", "barra:CCC333"], "el principal cambia, el alterno sigue");
});

test("edicion rapida valida lo que recibe: nombre vacio, precio negativo o cuerpo vacio dan 400", async () => {
    const id = await crearProductoCompleto();

    assert.equal((await parchar(id, { nombre: "   " })).status, 400);
    assert.equal((await parchar(id, { precioPublico: -5 })).status, 400);
    assert.equal((await parchar(id, { precioPublico: "abc" })).status, 400);
    assert.equal((await parchar(id, {})).status, 400);

    const fila = await filaProducto(id);
    assert.equal(fila.nombre, "Taladro completo", "ninguna peticion invalida modifico el producto");
});

test("edicion rapida respeta modificar_inventario y el aislamiento entre negocios", async () => {
    const id = await crearProductoCompleto();

    const sinPermiso = await parchar(id, { nombre: "No deberia" }, { "x-empleado-id": String(empleadoId) });
    assert.equal(sinPermiso.status, 403);

    const ajeno = await crearProductoPrueba(otroNegocio.negocioId, { nombre: "De otro negocio" });
    const cruzado = await parchar(ajeno.id, { nombre: "Robado" });
    assert.equal(cruzado.status, 404);
    assert.equal((await filaProducto(ajeno.id)).nombre, "De otro negocio");
});

// ---------------- recepcion rapida ----------------

async function recibir(cuerpo, extraHeaders) {
    const respuesta = await fetch(`${BASE_URL}/recepciones-mercancia/rapida`, {
        method: "POST", headers: headers(extraHeaders), body: JSON.stringify(cuerpo)
    });
    return { status: respuesta.status, cuerpo: await respuesta.json() };
}

test("recepcion rapida suma stock, guarda el costo, registra el ajuste y el historial", async () => {
    const id = await crearProductoCompleto();

    const { status, cuerpo } = await recibir({
        proveedor: "Diprofer", referencia: "REM-001", usuarioNombre: "Cajero",
        items: [{ productoId: id, cantidad: 6, costo: 72 }]
    });
    assert.equal(status, 201);
    assert.equal(cuerpo.productos[0].stockNuevo, 16);

    const fila = await filaProducto(id);
    assert.equal(Number(fila.stock), 16);
    assert.equal(Number(fila.costo), 72, "el costo nuevo reemplaza al anterior");

    const ajuste = await pool.query(`SELECT * FROM public.ajustes_inventario WHERE producto_id = $1`, [id]);
    assert.equal(ajuste.rows.length, 1);
    assert.equal(ajuste.rows[0].tipo, "entrada");
    assert.equal(Number(ajuste.rows[0].stock_anterior), 10);
    assert.equal(Number(ajuste.rows[0].stock_nuevo), 16);

    const items = await pool.query(`SELECT * FROM public.recepciones_mercancia_items WHERE recepcion_id = $1`, [cuerpo.recepcion.id]);
    assert.equal(items.rows.length, 1);
    assert.equal(Number(cuerpo.recepcion.total), 6 * 72);
});

test("recibir sin costo no borra el costo que ya se tenia", async () => {
    const id = await crearProductoCompleto();
    await recibir({ items: [{ productoId: id, cantidad: 2 }] });
    assert.equal(Number((await filaProducto(id)).costo), 70);
});

test("reintentar con la misma llave NO duplica el stock (mala señal en el celular)", async () => {
    const id = await crearProductoCompleto();
    const llave = `llave-prueba-${Date.now()}`;

    const primera = await recibir({ idempotencyKey: llave, items: [{ productoId: id, cantidad: 4 }] });
    assert.equal(primera.status, 201);

    const reintento = await recibir({ idempotencyKey: llave, items: [{ productoId: id, cantidad: 4 }] });
    assert.equal(reintento.status, 200);
    assert.equal(reintento.cuerpo.repetida, true);
    assert.equal(reintento.cuerpo.recepcion.id, primera.cuerpo.recepcion.id);

    assert.equal(Number((await filaProducto(id)).stock), 14, "10 + 4, no 10 + 4 + 4");
    const ajustes = await pool.query(`SELECT 1 FROM public.ajustes_inventario WHERE producto_id = $1`, [id]);
    assert.equal(ajustes.rows.length, 1);
});

test("el mismo producto escaneado varias veces se suma en una sola linea", async () => {
    const id = await crearProductoCompleto();
    const { status } = await recibir({ items: [{ productoId: id, cantidad: 1 }, { productoId: id, cantidad: 2 }, { productoId: id, cantidad: 3 }] });
    assert.equal(status, 201);
    assert.equal(Number((await filaProducto(id)).stock), 16);
});

test("si una linea es de otro negocio o invalida, no se aplica NINGUNA", async () => {
    const bueno = await crearProductoCompleto();
    const ajeno = await crearProductoPrueba(otroNegocio.negocioId, { nombre: "Ajeno", stock: 5 });

    const conAjeno = await recibir({ items: [{ productoId: bueno, cantidad: 3 }, { productoId: ajeno.id, cantidad: 3 }] });
    assert.equal(conAjeno.status, 404);
    assert.equal(Number((await filaProducto(bueno)).stock), 10, "el producto bueno tampoco se sumo");
    assert.equal(Number((await filaProducto(ajeno.id)).stock), 5);

    assert.equal((await recibir({ items: [{ productoId: bueno, cantidad: 0 }] })).status, 400);
    assert.equal((await recibir({ items: [{ productoId: bueno, cantidad: -2 }] })).status, 400);
    assert.equal((await recibir({ items: [] })).status, 400);
    assert.equal(Number((await filaProducto(bueno)).stock), 10);
});

test("recepcion rapida exige modificar_inventario", async () => {
    const id = await crearProductoCompleto();
    const { status } = await recibir({ items: [{ productoId: id, cantidad: 1 }] }, { "x-empleado-id": String(empleadoId) });
    assert.equal(status, 403);
    assert.equal(Number((await filaProducto(id)).stock), 10);
});
