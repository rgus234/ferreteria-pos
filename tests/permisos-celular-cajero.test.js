// Fase 1 del plan "celular como plan B": antes de darle al cajero mas
// funciones en el celular, los permisos que ya existian (ver_reportes,
// modificar_inventario) tienen que aplicarse de verdad en el servidor --
// hasta ahora solo se ocultaba la pantalla, y cualquiera con el token del
// equipo podia llamar a la ruta directo. Tambien: /negocio-actual ahora
// devuelve los permisos reales para que /dueno muestre solo las pestañas
// que el empleado puede usar.

const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { hashPassword } = require("../password-utils");
const { pool, crearNegocioPrueba, crearProductoPrueba, borrarNegocioPrueba } = require("./helpers/negocio-prueba");
const { iniciarServidorPrueba, detenerServidorPrueba, BASE_URL } = require("./helpers/servidor-prueba");

let negocio;
let empleadoId;
let producto;

function headersEmpleado() {
    return {
        "Content-Type": "application/json",
        "x-dispositivo-token": negocio.token,
        "x-empleado-id": String(empleadoId)
    };
}

function headersEquipoSinEmpleado() {
    return { "Content-Type": "application/json", "x-dispositivo-token": negocio.token };
}

async function fijarPermisos(permisos, rol = "Cajero") {
    await pool.query(
        `UPDATE public.empleados SET permisos = $1::jsonb, rol = $2 WHERE id = $3`,
        [JSON.stringify(permisos), rol, empleadoId]
    );
}

before(async () => {
    await iniciarServidorPrueba();
    negocio = await crearNegocioPrueba("permisos-celular");
    producto = await crearProductoPrueba(negocio.negocioId, { nombre: "Producto de permisos", stock: 20 });

    const empleado = await pool.query(
        `INSERT INTO public.empleados (negocio_id, nombre, rol, pin_hash, permisos)
         VALUES ($1, 'Cajero de prueba', 'Cajero', $2, '{}'::jsonb) RETURNING id`,
        [negocio.negocioId, hashPassword("1234")]
    );
    empleadoId = empleado.rows[0].id;
});

after(async () => {
    if (negocio) await borrarNegocioPrueba(negocio.negocioId);
    await detenerServidorPrueba();
    await pool.end();
});

test("/negocio-actual devuelve los permisos reales del empleado, y null para el equipo sin empleado (dueño)", async () => {
    await fijarPermisos({ hacer_ventas: true, ver_credito: true });

    const comoEmpleado = await (await fetch(`${BASE_URL}/negocio-actual`, { headers: headersEmpleado() })).json();
    assert.equal(comoEmpleado.rol, "employee");
    assert.equal(comoEmpleado.permisos.hacer_ventas, true);
    assert.equal(comoEmpleado.permisos.ver_credito, true);
    assert.notEqual(comoEmpleado.permisos.hacer_corte, true, "lo que no se concedio no aparece como permitido");

    const comoDueno = await (await fetch(`${BASE_URL}/negocio-actual`, { headers: headersEquipoSinEmpleado() })).json();
    assert.equal(comoDueno.rol, "owner");
    assert.equal(comoDueno.permisos, null, "null = sin restriccion");
});

test("un empleado sin modificar_inventario recibe 403 al agregar, editar, eliminar o ajustar inventario", async () => {
    await fijarPermisos({ hacer_ventas: true });

    const agregar = await fetch(`${BASE_URL}/agregar-producto`, {
        method: "POST", headers: headersEmpleado(),
        body: JSON.stringify({ nombre: "No deberia crearse", precio: 10, stock: 1, codigo: "NO-DEBE-EXISTIR" })
    });
    assert.equal(agregar.status, 403);

    const editar = await fetch(`${BASE_URL}/editar-producto/${producto.id}`, {
        method: "PUT", headers: headersEmpleado(),
        body: JSON.stringify({ nombre: "Renombrado sin permiso", precio: 1 })
    });
    assert.equal(editar.status, 403);

    const eliminar = await fetch(`${BASE_URL}/eliminar-producto/${producto.id}`, {
        method: "DELETE", headers: headersEmpleado()
    });
    assert.equal(eliminar.status, 403);

    const ajustar = await fetch(`${BASE_URL}/ajustes-inventario`, {
        method: "POST", headers: headersEmpleado(),
        body: JSON.stringify({ productoId: producto.id, cantidad: 5, tipo: "entrada", motivo: "sin permiso" })
    });
    assert.equal(ajustar.status, 403);

    const intacto = await pool.query(`SELECT nombre, stock FROM public.productos WHERE id = $1`, [producto.id]);
    assert.equal(intacto.rows[0].nombre, "Producto de permisos", "el producto no se toco");
    assert.equal(Number(intacto.rows[0].stock), 20, "el stock no se toco");

    const noCreado = await pool.query(`SELECT 1 FROM public.productos WHERE negocio_id = $1 AND codigo = 'NO-DEBE-EXISTIR'`, [negocio.negocioId]);
    assert.equal(noCreado.rows.length, 0);
});

test("con modificar_inventario concedido (directo, o por tener el modulo Inventario) ya no se bloquea", async () => {
    await fijarPermisos({ modificar_inventario: true });

    const directo = await fetch(`${BASE_URL}/editar-producto/${producto.id}`, {
        method: "PUT", headers: headersEmpleado(),
        body: JSON.stringify({ nombre: "Renombrado con permiso", precio: 120, stock: 20, codigo: "TEST-PERMISO", precioPublico: 120 })
    });
    assert.notEqual(directo.status, 403, "con el permiso concedido ya no se bloquea");

    // Puente de compatibilidad (rbac.js): un empleado con el modulo de
    // escritorio "inventario" prendido hereda los permisos de accion.
    await fijarPermisos({ inventario: true });
    const porModulo = await fetch(`${BASE_URL}/editar-producto/${producto.id}`, {
        method: "PUT", headers: headersEmpleado(),
        body: JSON.stringify({ nombre: "Renombrado por modulo", precio: 120, stock: 20, codigo: "TEST-PERMISO", precioPublico: 120 })
    });
    assert.notEqual(porModulo.status, 403, "el modulo Inventario del escritorio tambien lo habilita");
});

test("ver_reportes se aplica de verdad: sin el permiso 403, con el modulo Reportes o el permiso 200", async () => {
    await fijarPermisos({ hacer_ventas: true });
    const sin = await fetch(`${BASE_URL}/reportes/ventas?periodo=hoy`, { headers: headersEmpleado() });
    assert.equal(sin.status, 403);

    await fijarPermisos({ ver_reportes: true });
    const con = await fetch(`${BASE_URL}/reportes/ventas?periodo=hoy`, { headers: headersEmpleado() });
    assert.equal(con.status, 200);

    await fijarPermisos({ reportes: true });
    const porModulo = await fetch(`${BASE_URL}/reportes/ventas?periodo=hoy`, { headers: headersEmpleado() });
    assert.equal(porModulo.status, 200, "el modulo Reportes del escritorio tambien lo habilita");
});

test("un administrador, y el equipo sin empleado (dueño), nunca se bloquean", async () => {
    await fijarPermisos({}, "Administrador");
    const admin = await fetch(`${BASE_URL}/reportes/ventas?periodo=hoy`, { headers: headersEmpleado() });
    assert.equal(admin.status, 200);

    const dueno = await fetch(`${BASE_URL}/reportes/ventas?periodo=hoy`, { headers: headersEquipoSinEmpleado() });
    assert.equal(dueno.status, 200);
});

test("el catalogo de productos sigue abierto para cualquier empleado: lo necesita para vender", async () => {
    await fijarPermisos({ hacer_ventas: true });
    const lista = await fetch(`${BASE_URL}/productos`, { headers: headersEmpleado() });
    assert.equal(lista.status, 200, "un cajero sin ver_inventario aun tiene que poder buscar productos para cobrar");
});
