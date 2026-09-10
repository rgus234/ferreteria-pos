// Galeria completa de un producto (todas las fotos, no solo la
// principal) -- Ver detalles, Recepcion Inteligente y Pantalla del
// cliente la usan via GET /explorar-nexo/galeria/:codigo. Mismo
// criterio que resolverFotoPrincipal: sin candado de plan Pro (ver
// producto-galeria.js), porque solo muestra fotos que ya existen.
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { pool, crearNegocioPrueba, borrarNegocioPrueba } = require("./helpers/negocio-prueba");
const { iniciarServidorPrueba, detenerServidorPrueba, BASE_URL } = require("./helpers/servidor-prueba");
const { galeriaBancoOFabricante } = require("../producto-galeria");

let negocio;
const codigosBancoCreados = [];

function headers() {
    return { "x-dispositivo-token": negocio.token };
}

before(async () => {
    await iniciarServidorPrueba();
    negocio = await crearNegocioPrueba("producto-galeria");
});

after(async () => {
    if (negocio) await borrarNegocioPrueba(negocio.negocioId);
    for (const codigo of codigosBancoCreados) {
        await pool.query(`DELETE FROM public.banco_imagenes_producto WHERE codigo = $1`, [codigo]);
    }
    await detenerServidorPrueba();
    await pool.end();
});

test("galeriaBancoOFabricante: sin ninguna foto en ningun lado regresa arreglo vacio, nunca inventa una", async () => {
    const fotos = await galeriaBancoOFabricante(pool, "GALERIA-NO-EXISTE-JAMAS");
    assert.deepEqual(fotos, []);
});

test("galeriaBancoOFabricante: solo con foto principal (sin galeria guardada ni clave de fabricante) regresa nada mas esa", async () => {
    const codigo = "GALERIASOLOPRINCIPAL";
    await pool.query(
        `INSERT INTO public.banco_imagenes_producto (codigo, marca, imagen_principal, imagen_principal_tipo)
         VALUES ($1, 'MARCA-PRUEBA', $2, 'image/jpeg')`,
        [codigo, Buffer.from([0xff, 0xd8, 0xff])]
    );
    codigosBancoCreados.push(codigo);

    const fotos = await galeriaBancoOFabricante(pool, codigo);
    assert.equal(fotos.length, 1);
    assert.ok(fotos[0].startsWith(`/banco-imagenes/${codigo}/principal`));
});

test("galeriaBancoOFabricante: con galeria guardada en el banco, regresa principal + cada foto de la galeria en orden", async () => {
    const codigo = "GALERIACONEXTRAS";
    const banco = await pool.query(
        `INSERT INTO public.banco_imagenes_producto (codigo, marca, imagen_principal, imagen_principal_tipo)
         VALUES ($1, 'MARCA-PRUEBA', $2, 'image/jpeg') RETURNING id`,
        [codigo, Buffer.from([0xff, 0xd8, 0xff])]
    );
    codigosBancoCreados.push(codigo);
    const bancoImagenId = banco.rows[0].id;

    await pool.query(
        `INSERT INTO public.banco_imagenes_producto_galeria (banco_imagen_id, orden, imagen, tipo)
         VALUES ($1, 1, $2, 'image/jpeg'), ($1, 2, $2, 'image/jpeg')`,
        [bancoImagenId, Buffer.from([0xff, 0xd8, 0xff])]
    );

    const fotos = await galeriaBancoOFabricante(pool, codigo);
    assert.equal(fotos.length, 3, "principal + 2 de la galeria guardada");
    assert.ok(fotos[0].startsWith(`/banco-imagenes/${codigo}/principal`));
    assert.ok(fotos[1].startsWith("/banco-imagenes-galeria/"));
    assert.ok(fotos[2].startsWith("/banco-imagenes-galeria/"));
});

test("GET /explorar-nexo/galeria/:codigo exige dispositivo vinculado y responde con el arreglo de fotos", async () => {
    const codigo = "GALERIAHTTP";
    await pool.query(
        `INSERT INTO public.banco_imagenes_producto (codigo, marca, imagen_principal, imagen_principal_tipo)
         VALUES ($1, 'MARCA-PRUEBA', $2, 'image/jpeg')`,
        [codigo, Buffer.from([0xff, 0xd8, 0xff])]
    );
    codigosBancoCreados.push(codigo);

    const sinToken = await fetch(`${BASE_URL}/explorar-nexo/galeria/${codigo}`);
    assert.equal(sinToken.status, 401);

    const conToken = await fetch(`${BASE_URL}/explorar-nexo/galeria/${codigo}`, { headers: headers() });
    assert.equal(conToken.status, 200);
    const datos = await conToken.json();
    assert.equal(datos.ok, true);
    assert.ok(Array.isArray(datos.fotos) && datos.fotos.length === 1);
});
