// Checkout de Nexo Market: las guardas se quedan ANTES de crear el cobro en Stripe. No se llama a Stripe en esta prueba
// (el servidor de pruebas usa las llaves del .env), por eso se revisa el orden en el codigo.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const fuente = fs.readFileSync(path.join(__dirname, "..", "stripe-connect-server.js"), "utf8");
const inicio = fuente.indexOf("crear-intento-pago");
const cuerpo = fuente.slice(inicio, fuente.indexOf("/webhooks/stripe-connect", inicio));

test("el precio sale de la base de datos, nunca del carrito del cliente", () => {
    assert.match(cuerpo, /precioPorCodigo\.get\(codigo\)/);
    assert.ok(!/item\??\.precio\b/.test(cuerpo), "el precio que manda el cliente no se usa");
});

test("el pedido minimo y los productos agotados se rechazan antes de crear el cobro", () => {
    const cobro = cuerpo.indexOf("paymentIntents.create");
    const minimo = cuerpo.indexOf("MONTO_MINIMO_PAGO_MXN");
    const agotados = cuerpo.indexOf("agotados.length");

    assert.ok(cobro > 0 && minimo > 0 && agotados > 0);
    assert.ok(minimo < cobro, "el minimo se revisa antes de llamar a Stripe");
    assert.ok(agotados < cobro, "lo agotado se revisa antes de llamar a Stripe");
    assert.match(fuente, /const MONTO_MINIMO_PAGO_MXN = 10;/);
});

test("las tarjetas de producto de Market: '1 disponible' en singular y lo agotado no se puede agregar al carrito", () => {
    for (const archivo of ["market-server.js", "market-carrito-server.js", "public-site-server.js"]) {
        const f = fs.readFileSync(path.join(__dirname, "..", archivo), "utf8");
        assert.ok(!/p\.stock \+ ' disponibles'/.test(f), `${archivo}: el singular se cuida`);
    }

    const sitio = fs.readFileSync(path.join(__dirname, "..", "public-site-server.js"), "utf8");
    assert.match(sitio, /class="tenant-btn-carrito" disabled aria-disabled="true">Agotado<\/button>/);
    assert.match(sitio, /\.tenant-btn-carrito:disabled/);
});

test("la pagina del producto tiene una barra fija de compra solo en celular, con precio y boton, y un agotado no se puede agregar", () => {
    const sitio = fs.readFileSync(path.join(__dirname, "..", "public-site-server.js"), "utf8");
    assert.match(sitio, /class="tenant-barra-compra" role="region"/);
    assert.match(sitio, /\.tenant-barra-compra\{ display:none; \}/, "en computadora no se ve");
    assert.match(sitio, /@media \(max-width:720px\)\{\s*\.tenant-barra-compra\{ display:flex; align-items:center; gap:14px; position:fixed/);
    assert.ok((sitio.match(/disabled aria-disabled="true">Agotado<\/button>/g) || []).length >= 3, "tarjetas, caja de compra y barra deshabilitan lo agotado");
});
