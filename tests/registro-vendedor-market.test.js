// "Quiero vender en Market" (Fase 1, incremento B): el registro publico crea una cuenta vendedora, sin punto de venta y oculta en Market.
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { pool, borrarNegocioPrueba } = require("./helpers/negocio-prueba");
const { iniciarServidorPrueba, detenerServidorPrueba, BASE_URL } = require("./helpers/servidor-prueba");

const sufijo = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
const correoVendedor = `test-auto-vendedor-${sufijo}@example.com`;
const correoNormal = `test-auto-posnormal-${sufijo}@example.com`;
const registrar = async (cuerpo) => {
    const r = await fetch(`${BASE_URL}/api/clientes/registro`, { method: "POST", headers: { "Content-Type": "application/json", "x-forwarded-for": `10.9.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}` }, body: JSON.stringify({ giro: "abarrotes", telefono: "4425550100", password: "Prueba-Nexo-1234-x", confirmarPassword: "Prueba-Nexo-1234-x", ciudad: "Rio Grande, Zac.", nombreContacto: "Prueba", ...cuerpo }) });
    return { estado: r.status, datos: await r.json().catch(() => ({})) };
};

before(async () => { await iniciarServidorPrueba(); });
after(async () => {
    const creados = await pool.query("SELECT id FROM public.negocios WHERE LOWER(correo) = ANY($1)", [[correoVendedor, correoNormal]]);
    for (const { id } of creados.rows) await borrarNegocioPrueba(id);
    await detenerServidorPrueba();
    await pool.end();
});

test("quien elige 'solo vender en Market' queda con la funcion, en borrador y con licencia que no vence", async () => {
    const r = await registrar({ negocio: `Test Auto Vendedor ${sufijo}`, correo: correoVendedor, quieroVenderMarket: true });
    assert.equal(r.estado, 201, JSON.stringify(r.datos));
    assert.equal(r.datos.modo, "vendedor_market");
    assert.equal(r.datos.appUrl, "https://app.nexoposoficial.com");

    const f = (await pool.query(
        `SELECT n.funciones_beta, n.market_estado, l.fecha_vencimiento
           FROM public.negocios n JOIN public.licencias l ON l.negocio_id = n.id WHERE LOWER(n.correo) = $1`, [correoVendedor])).rows[0];
    assert.equal(f.funciones_beta.vendedor_market, true);
    assert.equal(f.market_estado, "borrador");
    assert.ok(new Date(f.fecha_vencimiento).getTime() > Date.now() + 365 * 24 * 3600 * 1000, "la licencia dura años: publicar es gratis");
});

test("quien elige el punto de venta completo queda como siempre: sin funcion, sin estado y con prueba de 30 dias", async () => {
    const r = await registrar({ negocio: `Test Auto Pos Normal ${sufijo}`, correo: correoNormal, quieroVenderMarket: false });
    assert.equal(r.estado, 201, JSON.stringify(r.datos));
    assert.equal(r.datos.modo, "punto_de_venta");

    const f = (await pool.query(
        `SELECT n.funciones_beta, n.market_estado, l.fecha_vencimiento
           FROM public.negocios n JOIN public.licencias l ON l.negocio_id = n.id WHERE LOWER(n.correo) = $1`, [correoNormal])).rows[0];
    assert.ok(!f.funciones_beta || !f.funciones_beta.vendedor_market);
    assert.equal(f.market_estado, null);
    assert.ok(new Date(f.fecha_vencimiento).getTime() < Date.now() + 40 * 24 * 3600 * 1000);
});

test("la pagina Vende en Nexo ofrece las dos opciones, manda el modo elegido, y los terminos dicen la comision real (6 %)", () => {
    const pagina = fs.readFileSync(path.join(__dirname, "..", "market-paginas-server.js"), "utf8");
    assert.match(pagina, /name="registroModo" value="market" checked/);
    assert.match(pagina, /name="registroModo" value="pos"/);
    assert.match(pagina, /quieroVenderMarket: \(document\.querySelector\("input\[name=registroModo\]:checked"\)/);
    assert.match(pagina, /comision del 6% a la tienda/);
    assert.ok(!/comision del 3%/.test(pagina), "ya no promete el 3 %");

    const stripe = fs.readFileSync(path.join(__dirname, "..", "stripe-connect-server.js"), "utf8");
    assert.match(stripe, /const COMISION_NEXO_MARKETPLACE = 0\.06;/, "los terminos y el cobro coinciden");
});
