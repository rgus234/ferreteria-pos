// Foto de perfil opcional por empleado (migrations/20261014_foto_empleado.sql):
// reemplaza el circulo de iniciales en "Quien esta trabajando?" cuando existe.
// La parte delicada no es guardar el BYTEA -- es que /empleados/:id/foto la
// sirve ANTES de cualquier login real, asi que no puede exigir headers
// (un <img src> nunca los manda). Esto prueba las dos formas de verla:
// header normal (sesion de cuenta o token de dispositivo) y el token
// firmado en la URL que usa la pantalla de seleccion de perfil.

const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const sharp = require("sharp");
const {
    pool, crearNegocioPrueba, crearSesionCuentaPrueba, borrarNegocioPrueba
} = require("./helpers/negocio-prueba");
const { iniciarServidorPrueba, detenerServidorPrueba, BASE_URL } = require("./helpers/servidor-prueba");

// 8x8 PNG rojo generado con sharp en vez de un base64 escrito a mano:
// un PNG de 1x1 hecho a mano puede traer el header bien formado (sharp
// lee su metadata sin tronar) pero el bloque de pixeles truncado --
// vips lo rechaza solo al intentar decodificarlo de verdad, que es
// justo lo que hace comprimirImagen().
let PNG_PRUEBA_BASE64;

let negocio;
let sesionToken;
let empleadoId;

function headersCuenta() {
    return { "Content-Type": "application/json", Authorization: `Bearer ${sesionToken}` };
}

before(async () => {
    const png = await sharp({ create: { width: 8, height: 8, channels: 3, background: { r: 200, g: 30, b: 30 } } })
        .png()
        .toBuffer();
    PNG_PRUEBA_BASE64 = `data:image/png;base64,${png.toString("base64")}`;

    await iniciarServidorPrueba();
    negocio = await crearNegocioPrueba("foto-empleado");
    sesionToken = await crearSesionCuentaPrueba(negocio.negocioId);

    const creado = await (await fetch(`${BASE_URL}/cuenta/empleados`, {
        method: "POST",
        headers: headersCuenta(),
        body: JSON.stringify({ nombre: "Empleado de prueba", rol: "Cajero", pin: "1234" })
    })).json();

    assert.equal(creado.ok, true);
    empleadoId = creado.empleado.id;
    assert.equal(creado.empleado.fotoUrl, null, "sin foto al crearse, sigue usando iniciales");
});

after(async () => {
    if (negocio) await borrarNegocioPrueba(negocio.negocioId);
    await detenerServidorPrueba();
    await pool.end();
});

test("subir foto devuelve fotoUrl, y esa URL sirve la imagen sin ningun header", async () => {
    const subida = await (await fetch(`${BASE_URL}/cuenta/empleados/${empleadoId}/foto`, {
        method: "POST",
        headers: headersCuenta(),
        body: JSON.stringify({ imagenBase64: PNG_PRUEBA_BASE64 })
    })).json();

    assert.equal(subida.ok, true);
    assert.ok(subida.empleado.fotoUrl, "la respuesta trae una fotoUrl firmada");

    const imagen = await fetch(`${BASE_URL}${subida.empleado.fotoUrl}`);
    assert.equal(imagen.status, 200);
    assert.equal(imagen.headers.get("content-type"), "image/jpeg");

    const bytes = Buffer.from(await imagen.arrayBuffer());
    assert.ok(bytes.length > 0, "la imagen servida trae contenido real");
});

test("la pantalla de login (token de dispositivo) tambien ve la fotoUrl y puede cargarla", async () => {
    const lista = await (await fetch(`${BASE_URL}/dispositivo/empleados`, {
        headers: { "x-dispositivo-token": negocio.token }
    })).json();

    const empleado = lista.empleados.find(e => e.id === empleadoId);
    assert.ok(empleado.fotoUrl, "el equipo vinculado tambien recibe la fotoUrl");

    // Mismo endpoint, pero esta vez con el header de dispositivo en vez
    // del token firmado de la URL -- confirma la otra rama de
    // requerirAccesoNegocioImagen.
    const imagenPorHeader = await fetch(`${BASE_URL}/empleados/${empleadoId}/foto`, {
        headers: { "x-dispositivo-token": negocio.token }
    });
    assert.equal(imagenPorHeader.status, 200);
});

test("un token de imagen de OTRO negocio no sirve para ver esta foto", async () => {
    const otro = await crearNegocioPrueba("foto-empleado-otro");
    try {
        const comoSiFueraOtro = await fetch(
            `${BASE_URL}/empleados/${empleadoId}/foto?negocio=${otro.slug}&token=invalido`
        );
        assert.equal(comoSiFueraOtro.status, 401);
    } finally {
        await borrarNegocioPrueba(otro.negocioId);
    }
});

test("quitar la foto regresa fotoUrl a null y la URL vieja deja de servir nada", async () => {
    const antes = await (await fetch(`${BASE_URL}/cuenta/empleados`, { headers: headersCuenta() })).json();
    const fotoUrlVieja = antes.empleados.find(e => e.id === empleadoId).fotoUrl;
    assert.ok(fotoUrlVieja);

    const quitada = await (await fetch(`${BASE_URL}/cuenta/empleados/${empleadoId}/foto`, {
        method: "DELETE",
        headers: headersCuenta()
    })).json();
    assert.equal(quitada.ok, true);
    assert.equal(quitada.empleado.fotoUrl, null);

    const despues = await (await fetch(`${BASE_URL}/cuenta/empleados`, { headers: headersCuenta() })).json();
    assert.equal(despues.empleados.find(e => e.id === empleadoId).fotoUrl, null);

    const imagenVieja = await fetch(`${BASE_URL}${fotoUrlVieja}`);
    assert.equal(imagenVieja.status, 404, "la foto ya no existe aunque el token todavia fuera valido");
});
