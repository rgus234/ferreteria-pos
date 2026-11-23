// Alta y edicion de proveedores: nombre limpio, sin en blanco y sin repetir.
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { pool, crearNegocioPrueba, borrarNegocioPrueba } = require("./helpers/negocio-prueba");
const { iniciarServidorPrueba, detenerServidorPrueba, BASE_URL } = require("./helpers/servidor-prueba");

let negocio;
const headers = () => ({ "Content-Type": "application/json", "x-dispositivo-token": negocio.token });
const api = async (ruta, metodo, cuerpo) => {
    const r = await fetch(`${BASE_URL}${ruta}`, { method: metodo, headers: headers(), body: cuerpo ? JSON.stringify(cuerpo) : undefined });
    return { estado: r.status, datos: await r.json().catch(() => ({})) };
};

before(async () => { await iniciarServidorPrueba(); negocio = await crearNegocioPrueba("proveedores-crud"); });
after(async () => {
    if (negocio) { await pool.query("DELETE FROM public.proveedores WHERE negocio_id = $1", [negocio.negocioId]); await borrarNegocioPrueba(negocio.negocioId); }
    await detenerServidorPrueba();
    await pool.end();
});

test("un nombre en blanco se rechaza, y los espacios de sobra se limpian", async () => {
    assert.equal((await api("/proveedores", "POST", { nombre: "    " })).estado, 400);

    const creado = await api("/proveedores", "POST", { nombre: "  Distribuidora   del  Norte  " });
    assert.equal(creado.estado, 200, JSON.stringify(creado.datos));
    assert.equal(creado.datos.proveedor.nombre, "Distribuidora del Norte");
});

test("no se crea otro proveedor con el mismo nombre (sin importar mayusculas ni acentos) y avisa cual es", async () => {
    await api("/proveedores", "POST", { nombre: "Abarrotes Martínez" });
    const repetido = await api("/proveedores", "POST", { nombre: "ABARROTES MARTINEZ " });
    assert.equal(repetido.estado, 409);
    assert.match(repetido.datos.error, /Abarrotes Mart/);
    assert.ok(repetido.datos.existente.id);

    const lista = await api("/proveedores", "GET");
    assert.equal(lista.datos.proveedores.filter(p => /abarrotes mart/i.test(p.nombre)).length, 1);
});

test("uno dado de baja si se puede volver a crear, y editar limpia el nombre", async () => {
    const a = (await api("/proveedores", "POST", { nombre: "Proveedor Baja" })).datos.proveedor;
    await api(`/proveedores/${a.id}`, "DELETE");
    const otra = await api("/proveedores", "POST", { nombre: "Proveedor Baja" });
    assert.equal(otra.estado, 200, "el dado de baja no cuenta como repetido");

    const editado = await api(`/proveedores/${otra.datos.proveedor.id}`, "PUT", { nombre: "  Proveedor   Nuevo ", contacto: "Ana" });
    assert.equal(editado.datos.proveedor.nombre, "Proveedor Nuevo");
    assert.equal((await api(`/proveedores/${otra.datos.proveedor.id}`, "PUT", { nombre: "   " })).estado, 400);
});
