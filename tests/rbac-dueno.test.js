// Fase 1 del ecosistema Nexo: cierra el ciclo que Fase 0 dejo probado
// solo con el header x-empleado-id (dispositivo compartido) -- aqui se
// prueba el camino nuevo completo: un empleado entra a /dueno con su
// propia cuenta Nexo (sesion de cuenta real, no dispositivo) y el
// enforcement de permisos sigue funcionando igual de verdad.

const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("crypto");
const { hashPassword } = require("../password-utils");
const { pool, crearNegocioPrueba, crearProductoPrueba, borrarNegocioPrueba } = require("./helpers/negocio-prueba");
const { crearPersonaPrueba, mintearSesionPruebaPersona, borrarPersonaPrueba } = require("./helpers/persona-prueba");
const { iniciarServidorPrueba, detenerServidorPrueba, BASE_URL } = require("./helpers/servidor-prueba");

function hashTokenSeguro(tokenPlano) {
    return crypto.createHash("sha256").update(String(tokenPlano)).digest("hex");
}

let negocio;
let persona;
let personaToken;
let empleadoId;
let cuentaTokenDueno;

before(async () => {
    await iniciarServidorPrueba();

    negocio = await crearNegocioPrueba("rbac-dueno");
    persona = await crearPersonaPrueba("rbac-dueno");
    personaToken = await mintearSesionPruebaPersona(persona.id);

    const empleado = await pool.query(
        `INSERT INTO public.empleados (negocio_id, nombre, rol, pin_hash, permisos)
         VALUES ($1, 'Empleado Dueno RBAC', 'Cajero', $2, '{}'::jsonb)
         RETURNING id`,
        [negocio.negocioId, hashPassword("1234")]
    );
    empleadoId = empleado.rows[0].id;

    // Sesion de cuenta del dueño, minteada directo (mismo atajo que
    // rbac.test.js ya usa) -- solo para generar el codigo de vinculo.
    cuentaTokenDueno = `token-cuenta-dueno-${crypto.randomBytes(16).toString("hex")}`;
    await pool.query(
        `INSERT INTO public.sesiones_cuenta (negocio_id, token_hash, dispositivo) VALUES ($1, $2, 'pruebas-automatizadas')`,
        [negocio.negocioId, hashTokenSeguro(cuentaTokenDueno)]
    );
});

after(async () => {
    // Mismo orden que rbac.test.js: el negocio primero (se lleva el
    // empleado por ON DELETE CASCADE, liberando empleados.persona_id),
    // la persona despues.
    if (negocio) await borrarNegocioPrueba(negocio.negocioId);
    if (persona) await borrarPersonaPrueba(persona.id);
    await detenerServidorPrueba();
    await pool.end();
});

test("un empleado vinculado entra a /dueno con su propia cuenta Nexo y el enforcement de permisos es real", async () => {
    // 1) El dueño genera el codigo de vinculo para su empleado.
    const generado = await fetch(`${BASE_URL}/cuenta/empleados/${empleadoId}/generar-codigo-vinculo`, {
        method: "POST",
        headers: { Authorization: `Bearer ${cuentaTokenDueno}` }
    });
    assert.equal(generado.status, 200);
    const { codigo } = await generado.json();

    // 2) La persona (ya logueada en Nexo) canjea el codigo.
    const canjeado = await fetch(`${BASE_URL}/personas/vincular-empleado`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-persona-token": personaToken },
        body: JSON.stringify({ codigo })
    });
    assert.equal(canjeado.status, 200);

    // 3) La persona pide entrar como empleado -- 1 sola membresia, debe
    // resolver directo sin pedir seleccion de negocio.
    const entrada = await fetch(`${BASE_URL}/personas/entrar-como-empleado`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-persona-token": personaToken },
        body: JSON.stringify({})
    });
    assert.equal(entrada.status, 200);
    const datosEntrada = await entrada.json();
    assert.equal(datosEntrada.ok, true);
    assert.equal(datosEntrada.rol, "employee");
    assert.ok(datosEntrada.token);
    assert.equal(datosEntrada.negocio.slug, negocio.slug);

    const tokenEmpleadoDueno = datosEntrada.token;

    // 4) GET /negocio-actual (el que usa dueno.js para pintar el shell
    // por rol) debe reportar rol employee con esta sesion.
    const quienSoy = await fetch(`${BASE_URL}/negocio-actual`, {
        headers: { Authorization: `Bearer ${tokenEmpleadoDueno}` }
    });
    assert.equal(quienSoy.status, 200);
    const datosQuienSoy = await quienSoy.json();
    assert.equal(datosQuienSoy.rol, "employee");

    // 5) Sin el permiso ver_pedidos (permisos={} por defecto), la
    // pantalla de Pedidos debe rechazar con 403 real -- no solo con
    // header x-empleado-id como en Fase 0, sino con la sesion de
    // cuenta real que /dueno usaria.
    const sinPermiso = await fetch(`${BASE_URL}/negocio-actual/pedidos-market?estado=nuevos`, {
        headers: { Authorization: `Bearer ${tokenEmpleadoDueno}` }
    });
    assert.equal(sinPermiso.status, 403);
    const datosSinPermiso = await sinPermiso.json();
    assert.equal(datosSinPermiso.requierePermiso, "ver_pedidos");

    // 6) Con el permiso concedido, la misma ruta responde 200.
    await pool.query(
        `UPDATE public.negocio_miembros SET permisos = '{"ver_pedidos": true}'::jsonb WHERE persona_id = $1 AND negocio_id = $2`,
        [persona.id, negocio.negocioId]
    );

    const conPermiso = await fetch(`${BASE_URL}/negocio-actual/pedidos-market?estado=nuevos`, {
        headers: { Authorization: `Bearer ${tokenEmpleadoDueno}` }
    });
    assert.equal(conPermiso.status, 200);
});

test("Fase 2: un empleado sin permiso hacer_ventas recibe 403 real en POST /ventas; con el permiso concedido, cobra de verdad y el stock baja", async () => {
    // La persona ya quedo vinculada como empleado en el primer test --
    // vuelve a entrar para tener un token de cuenta fresco.
    const entrada = await fetch(`${BASE_URL}/personas/entrar-como-empleado`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-persona-token": personaToken },
        body: JSON.stringify({})
    });
    assert.equal(entrada.status, 200);
    const { token: tokenEmpleadoDueno } = await entrada.json();

    const producto = await crearProductoPrueba(negocio.negocioId, { precio: 100, stock: 5 });

    const cuerpoVenta = {
        total: 100,
        subtotal: 100,
        descuento: 0,
        descuentoTipo: "ninguno",
        descuentoValor: 0,
        clienteId: null,
        clienteNombre: "Publico general",
        cajeroUsuario: persona.correo,
        cajeroNombre: persona.nombre,
        productos: [{
            id: producto.id, codigo: "TEST", nombre: "Producto de prueba", precio: 100,
            cantidad: 1, unidadVenta: "pieza", modoVenta: "bolsa", importe: 100
        }],
        metodoPago: "efectivo",
        pagos: { efectivo: 100, tarjeta: 0, transferencia: 0, credito: 0 },
        recibido: 100,
        cambio: 0
    };

    // Sin permiso hacer_ventas (negocio_miembros.permisos solo tiene
    // ver_pedidos de un test anterior) -- 403 real, no solo compila.
    const sinPermiso = await fetch(`${BASE_URL}/ventas`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${tokenEmpleadoDueno}` },
        body: JSON.stringify(cuerpoVenta)
    });
    assert.equal(sinPermiso.status, 403);
    const datosSinPermiso = await sinPermiso.json();
    assert.equal(datosSinPermiso.requierePermiso, "hacer_ventas");

    // Con el permiso concedido, la venta se cobra de verdad y el stock
    // baja -- confirma que gatear /ventas no rompio el flujo real.
    await pool.query(
        `UPDATE public.negocio_miembros SET permisos = permisos || '{"hacer_ventas": true}'::jsonb WHERE persona_id = $1 AND negocio_id = $2`,
        [persona.id, negocio.negocioId]
    );

    const conPermiso = await fetch(`${BASE_URL}/ventas`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${tokenEmpleadoDueno}` },
        body: JSON.stringify(cuerpoVenta)
    });
    assert.equal(conPermiso.status, 200);
    const datosVenta = await conPermiso.json();
    assert.equal(datosVenta.success, true);
    assert.ok(datosVenta.folio);

    const stockFinal = await pool.query(`SELECT stock FROM public.productos WHERE id = $1`, [producto.id]);
    assert.equal(Number(stockFinal.rows[0].stock), 4);
});

test("Fase 3: un empleado sin permiso hacer_corte recibe 403 real en POST /caja/abrir; con el permiso concedido, abre y cierra turno de verdad con diferencia 0", async () => {
    const entrada = await fetch(`${BASE_URL}/personas/entrar-como-empleado`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-persona-token": personaToken },
        body: JSON.stringify({})
    });
    assert.equal(entrada.status, 200);
    const { token: tokenEmpleadoDueno } = await entrada.json();

    const sinPermiso = await fetch(`${BASE_URL}/caja/abrir`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${tokenEmpleadoDueno}` },
        body: JSON.stringify({ fondoInicial: 300 })
    });
    assert.equal(sinPermiso.status, 403);
    const datosSinPermiso = await sinPermiso.json();
    assert.equal(datosSinPermiso.requierePermiso, "hacer_corte");

    await pool.query(
        `UPDATE public.negocio_miembros SET permisos = permisos || '{"hacer_corte": true, "hacer_ventas": true}'::jsonb WHERE persona_id = $1 AND negocio_id = $2`,
        [persona.id, negocio.negocioId]
    );

    const apertura = await fetch(`${BASE_URL}/caja/abrir`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${tokenEmpleadoDueno}` },
        body: JSON.stringify({ fondoInicial: 300 })
    });
    assert.equal(apertura.status, 200);
    const datosApertura = await apertura.json();
    assert.equal(datosApertura.turno.estado, "abierto");

    const producto = await crearProductoPrueba(negocio.negocioId, { precio: 150, stock: 5 });
    const venta = await fetch(`${BASE_URL}/ventas`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${tokenEmpleadoDueno}` },
        body: JSON.stringify({
            total: 150, subtotal: 150, descuento: 0, descuentoTipo: "ninguno", descuentoValor: 0,
            clienteId: null, clienteNombre: "Publico general",
            cajeroUsuario: persona.correo, cajeroNombre: persona.nombre,
            productos: [{ id: producto.id, codigo: "TEST", nombre: "Producto de prueba", precio: 150,
                cantidad: 1, unidadVenta: "pieza", modoVenta: "bolsa", importe: 150 }],
            metodoPago: "efectivo", pagos: { efectivo: 150, tarjeta: 0, transferencia: 0, credito: 0 },
            recibido: 150, cambio: 0
        })
    });
    assert.equal(venta.status, 200);

    const cierre = await fetch(`${BASE_URL}/caja/cerrar`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${tokenEmpleadoDueno}` },
        body: JSON.stringify({ efectivoContado: 450, tarjetaContado: 0, transferenciaContado: 0, creditoContado: 0, notas: "" })
    });
    assert.equal(cierre.status, 200);
    const datosCierre = await cierre.json();
    assert.equal(datosCierre.turno.estado, "cerrado");
    assert.equal(Number(datosCierre.turno.diferencia), 0, "fondo inicial (300) + venta en efectivo (150) debe cuadrar exacto con lo contado (450)");
});

test("una segunda persona sin membresia de empleado no puede entrar como empleado a ningun negocio", async () => {
    const personaSuelta = await crearPersonaPrueba("rbac-dueno-suelta");
    const tokenSuelta = await mintearSesionPruebaPersona(personaSuelta.id);

    try {
        const respuesta = await fetch(`${BASE_URL}/personas/entrar-como-empleado`, {
            method: "POST",
            headers: { "Content-Type": "application/json", "x-persona-token": tokenSuelta },
            body: JSON.stringify({})
        });
        assert.equal(respuesta.status, 404);
    } finally {
        await borrarPersonaPrueba(personaSuelta.id);
    }
});
