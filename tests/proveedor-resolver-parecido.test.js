// Facturas y productos nuevos se amarran al proveedor que YA existe aunque venga escrito distinto, en vez de crear uno repetido.
// Nunca se une a un proveedor con otro RFC, ni cuando hay mas de un parecido, ni a uno inactivo (unido).
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { pool, crearNegocioPrueba, borrarNegocioPrueba } = require("./helpers/negocio-prueba");
const { resolverProveedorPorRfc, resolverOcrearProveedorId } = require("../proveedor-resolver");

let negocio;
const nuevo = async (nombre, extra = {}) => (await pool.query(`INSERT INTO public.proveedores (negocio_id, nombre, rfc, activo) VALUES ($1, $2, $3, $4) RETURNING id`, [negocio.negocioId, nombre, extra.rfc || "", extra.activo !== false])).rows[0].id;
const cuantos = async () => (await pool.query(`SELECT count(*)::int AS n FROM public.proveedores WHERE negocio_id = $1`, [negocio.negocioId])).rows[0].n;
const rfcDe = async id => (await pool.query(`SELECT rfc FROM public.proveedores WHERE id = $1`, [id])).rows[0].rfc;

before(async () => { negocio = await crearNegocioPrueba("resolver-parecido"); });
after(async () => { if (negocio) await borrarNegocioPrueba(negocio.negocioId); await pool.end(); });

test("la factura de 'DIPROFER MX' se amarra al Diprofer que ya existe, le guarda el RFC y la siguiente entra por RFC", async () => {
    const diprofer = await nuevo("Diprofer");

    const a = await resolverProveedorPorRfc(pool, negocio.negocioId, "DMX141106GP0", "DIPROFER MX");
    assert.equal(a, diprofer, "no crea otro proveedor");
    assert.equal(await cuantos(), 1);
    assert.equal(await rfcDe(diprofer), "DMX141106GP0");

    const b = await resolverProveedorPorRfc(pool, negocio.negocioId, "DMX141106GP0", "DIPROFER MX SA DE CV COMPLETO");
    assert.equal(b, diprofer, "la siguiente factura entra por RFC aunque el nombre cambie");
});

test("un proveedor que ya tiene OTRO RFC nunca cuenta como el mismo: se crea uno nuevo", async () => {
    const truper = await nuevo("Truper", { rfc: "TRU800101AAA" });
    const r = await resolverProveedorPorRfc(pool, negocio.negocioId, "TRU999999ZZZ", "TRUPER SA DE CV");

    assert.notEqual(r, truper);
    assert.equal(await rfcDe(truper), "TRU800101AAA", "no se le pisa el RFC");
});

test("con mas de un parecido no se elige ninguno", async () => {
    await nuevo("Foset Norte");
    await nuevo("Foset Sur");
    const antes = await cuantos();

    const r = await resolverProveedorPorRfc(pool, negocio.negocioId, "FOS010101XYZ", "FOSET");
    assert.equal(r, null, "ambiguo: se deja sin resolver para revision manual");
    assert.equal(await cuantos(), antes);
});

test("un proveedor unido (inactivo) no se vuelve a usar: la factura va con el que se quedo", async () => {
    const dtc = await nuevo("DTC", { rfc: "DTC010101AAA" });
    await nuevo("DTC AGUASCALIENTES", { rfc: "DTC010101AAA", activo: false });

    const r = await resolverProveedorPorRfc(pool, negocio.negocioId, "DTC010101AAA", "DTC AGUASCALIENTES");
    assert.equal(r, dtc, "con el RFC repetido en un inactivo ya no queda ambiguo");
});

test("al escribir un proveedor a mano se corrige un typo, pero no se confunde un nombre que solo contiene al otro", async () => {
    const gafi = await nuevo("Gafi");
    const dtc = (await pool.query(`SELECT id FROM public.proveedores WHERE negocio_id = $1 AND nombre = 'DTC'`, [negocio.negocioId])).rows[0].id;
    const antes = await cuantos();

    assert.equal(await resolverOcrearProveedorId(pool, negocio.negocioId, "Gagi", { parecido: "typos" }), gafi, "Gagi era Gafi");
    assert.equal(await cuantos(), antes);

    const otro = await resolverOcrearProveedorId(pool, negocio.negocioId, "DTC Leon", { parecido: "typos" });
    assert.notEqual(otro, dtc, "'DTC Leon' puede ser otra sucursal: no se une a DTC solo por contenerlo");
    assert.equal(await cuantos(), antes + 1);

    const exacto = await resolverOcrearProveedorId(pool, negocio.negocioId, "  gafi ");
    assert.equal(exacto, gafi, "sin la opcion todo sigue exacto como siempre");
});
