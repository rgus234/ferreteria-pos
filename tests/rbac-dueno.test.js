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

test("Fase 3.2: el dueño ve el estado real de vinculacion Nexo del empleado en GET /cuenta/empleados y puede editar sus permisos granulares desde PUT /cuenta/empleados/:id/permisos-nexo (con allowlist real, sin colar claves ajenas)", async () => {
    // El empleado ya quedo vinculado en el primer test de este archivo
    // (misma persona/empleadoId) y con ver_pedidos:true concedido ahi.
    const lista = await fetch(`${BASE_URL}/cuenta/empleados`, {
        headers: { Authorization: `Bearer ${cuentaTokenDueno}` }
    });
    assert.equal(lista.status, 200);
    const datosLista = await lista.json();
    const filaEmpleado = datosLista.empleados.find(item => item.id === empleadoId);
    assert.ok(filaEmpleado, "el empleado debe aparecer en la lista del dueño");
    assert.equal(filaEmpleado.vinculadoNexo, true);
    assert.equal(filaEmpleado.permisosNexo.ver_pedidos, true);

    // El dueño concede hacer_ventas y manda una clave que NO existe en
    // PERMISOS -- debe guardarse solo la real, la ajena se descarta.
    const editar = await fetch(`${BASE_URL}/cuenta/empleados/${empleadoId}/permisos-nexo`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${cuentaTokenDueno}` },
        body: JSON.stringify({ permisos: { hacer_ventas: true, clave_inventada: true } })
    });
    assert.equal(editar.status, 200);
    const datosEditar = await editar.json();
    assert.equal(datosEditar.permisos.hacer_ventas, true);
    assert.equal(datosEditar.permisos.clave_inventada, undefined);
    // Reemplaza el objeto completo (no hace merge) -- ver_pedidos del
    // test anterior se pierde a proposito, es el contrato de la ruta.
    assert.equal(datosEditar.permisos.ver_pedidos, undefined);

    const listaActualizada = await fetch(`${BASE_URL}/cuenta/empleados`, {
        headers: { Authorization: `Bearer ${cuentaTokenDueno}` }
    });
    const datosListaActualizada = await listaActualizada.json();
    const filaActualizada = datosListaActualizada.empleados.find(item => item.id === empleadoId);
    assert.equal(filaActualizada.permisosNexo.hacer_ventas, true);

    // Deja el estado limpio como antes de este test -- las pruebas de
    // Fase 2/Fase 3 que corren despues en este mismo archivo asumen que
    // el empleado empieza sin hacer_ventas concedido.
    await pool.query(
        `UPDATE public.negocio_miembros SET permisos = '{}'::jsonb WHERE persona_id = $1 AND negocio_id = $2`,
        [persona.id, negocio.negocioId]
    );
});

test("Fase 3.2: PUT /cuenta/empleados/:id/permisos-nexo responde 400 para un empleado que todavia no vincula su cuenta Nexo", async () => {
    const empleadoSinVincular = await pool.query(
        `INSERT INTO public.empleados (negocio_id, nombre, rol, pin_hash, permisos)
         VALUES ($1, 'Empleado Sin Vincular', 'Cajero', $2, '{}'::jsonb)
         RETURNING id`,
        [negocio.negocioId, hashPassword("5678")]
    );

    const respuesta = await fetch(`${BASE_URL}/cuenta/empleados/${empleadoSinVincular.rows[0].id}/permisos-nexo`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${cuentaTokenDueno}` },
        body: JSON.stringify({ permisos: { hacer_ventas: true } })
    });
    assert.equal(respuesta.status, 400);
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

test("Fase 3.1: un empleado sin permiso administrar_usuarios recibe 403 real en /cuenta/empleados (incluye intento de auto-escalar su propio rol); con el permiso concedido, funciona; la sesion del dueño sigue sin restriccion", async () => {
    const entrada = await fetch(`${BASE_URL}/personas/entrar-como-empleado`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-persona-token": personaToken },
        body: JSON.stringify({})
    });
    assert.equal(entrada.status, 200);
    const { token: tokenEmpleadoDueno } = await entrada.json();

    // Sin administrar_usuarios (permisos de tests anteriores no lo
    // incluyen) -- listar empleados debe rechazar con 403 real.
    const listaSinPermiso = await fetch(`${BASE_URL}/cuenta/empleados`, {
        headers: { Authorization: `Bearer ${tokenEmpleadoDueno}` }
    });
    assert.equal(listaSinPermiso.status, 403);
    const datosListaSinPermiso = await listaSinPermiso.json();
    assert.equal(datosListaSinPermiso.requierePermiso, "administrar_usuarios");

    // Intento de auto-escalar su propio rol a Administrador via PUT --
    // debe rechazar con 403 real, no solo la falta de UI.
    const autoEscalar = await fetch(`${BASE_URL}/cuenta/empleados/${empleadoId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${tokenEmpleadoDueno}` },
        body: JSON.stringify({ rol: "Administrador" })
    });
    assert.equal(autoEscalar.status, 403);

    // La sesion clasica del dueño (sin persona_id/rol, permisos: null)
    // sigue sin ninguna restriccion -- confirma que gatear estas rutas
    // no rompe el flujo real de administracion de empleados.
    const listaDueno = await fetch(`${BASE_URL}/cuenta/empleados`, {
        headers: { Authorization: `Bearer ${cuentaTokenDueno}` }
    });
    assert.equal(listaDueno.status, 200);
    const datosListaDueno = await listaDueno.json();
    assert.equal(datosListaDueno.ok, true);
    assert.ok(Array.isArray(datosListaDueno.empleados));

    // Con el permiso concedido, el empleado autorizado puede administrar
    // empleados de verdad.
    await pool.query(
        `UPDATE public.negocio_miembros SET permisos = permisos || '{"administrar_usuarios": true}'::jsonb WHERE persona_id = $1 AND negocio_id = $2`,
        [persona.id, negocio.negocioId]
    );

    const listaConPermiso = await fetch(`${BASE_URL}/cuenta/empleados`, {
        headers: { Authorization: `Bearer ${tokenEmpleadoDueno}` }
    });
    assert.equal(listaConPermiso.status, 200);
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
