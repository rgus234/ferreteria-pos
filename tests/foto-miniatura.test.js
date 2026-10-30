// Foto principal: sin parametro sale completa; con ?w= sale una miniatura mas ligera.
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const sharp = require("sharp");
const { pool, crearNegocioPrueba, borrarNegocioPrueba } = require("./helpers/negocio-prueba");
const { iniciarServidorPrueba, detenerServidorPrueba, BASE_URL } = require("./helpers/servidor-prueba");

let negocio;

before(async () => {
    await iniciarServidorPrueba();
    negocio = await crearNegocioPrueba("foto-mini");
    const grande = await sharp({ create: { width: 900, height: 900, channels: 3, background: { r: 200, g: 90, b: 30 } } })
        .composite([{ input: Buffer.alloc(900 * 900 * 3, 7), raw: { width: 900, height: 900, channels: 3 }, blend: "xor" }])
        .jpeg({ quality: 90 }).toBuffer();
    await pool.query(
        `INSERT INTO public.fotos_producto (negocio_id, codigo, imagen_principal, imagen_principal_tipo, actualizado_at) VALUES ($1, 'MINI1', $2, 'image/jpeg', NOW())`,
        [negocio.negocioId, grande]
    );
});

after(async () => {
    if (negocio) await borrarNegocioPrueba(negocio.negocioId);
    await detenerServidorPrueba();
    await pool.end();
});

const pedir = ruta => fetch(`${BASE_URL}${ruta}`, { headers: { "x-dispositivo-token": negocio.token } });

test("?w= devuelve una miniatura mas chica y sin el parametro llega la foto completa", async () => {
    const completa = Buffer.from(await (await pedir("/fotos-producto/MINI1/principal")).arrayBuffer());
    const mini = await pedir("/fotos-producto/MINI1/principal?w=160");
    assert.equal(mini.status, 200);
    const bufferMini = Buffer.from(await mini.arrayBuffer());

    assert.equal((await sharp(completa).metadata()).width, 900);
    assert.equal((await sharp(bufferMini).metadata()).width, 160);
    assert.ok(bufferMini.length < completa.length, "la miniatura pesa menos");

    const absurdo = Buffer.from(await (await pedir("/fotos-producto/MINI1/principal?w=5")).arrayBuffer());
    assert.equal((await sharp(absurdo).metadata()).width, 900, "un ancho fuera de rango se ignora");
});
