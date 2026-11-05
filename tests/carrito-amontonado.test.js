// El carrito no debe "amontonarse": con Diseño nuevo los encabezados de tabla eran transparentes y, al hacer scroll,
// el contenido se veia debajo de "Producto / Cantidad / Precio / Total". Tambien: codigo en una linea y etiquetas largas con puntos suspensivos.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const leer = ruta => fs.readFileSync(path.join(__dirname, "..", "public", ruta), "utf8");

test("Diseño nuevo no vuelve transparentes los encabezados fijos (carrito y demas tablas con scroll)", () => {
    const css = leer("css/components/diseno-nuevo.css");
    assert.match(css, /html\.diseno-nuevo \.contenido table th \{ background: transparent !important/, "la regla general sigue");
    const solido = css.match(/html\.diseno-nuevo \.contenido \.pos-cart-table thead th,[\s\S]*?\{ background: var\(--dn-tarjeta\) !important; \}/);
    assert.ok(solido, "el carrito tiene fondo solido");
    for (const clase of ["inicio-ab-tabla", "pedido-tabla", "aplicar-precios-tabla"]) assert.match(solido[0], new RegExp(clase));
});

test("carrito: codigo en una linea, etiquetas que no se salen de su celda y menos columnas cuando es angosto", () => {
    const css = leer("css/components/pos-sale-redesign.css");
    assert.match(css, /\.pos-cart-code \{[^}]*white-space: nowrap/);
    assert.match(css, /\.pos-cart-code \{[^}]*text-overflow: ellipsis/);
    assert.match(css, /\.pos-cart-meta span \{[^}]*max-width: 100%;[^}]*text-overflow: ellipsis/);
    assert.match(css, /\.carrito-items \{ container-type: inline-size; \}/);
    assert.match(css, /@container \(max-width: 740px\)[\s\S]*?pos-cart-code \{ display: none; \}/, "sin la columna de codigo en angosto");
    assert.match(css, /@container \(max-width: 460px\)/, "muy angosto: sin numero de fila ni precio unitario");
    assert.doesNotMatch(css, /pos-cart-code \{ width: clamp/, "el clamp con porcentaje descuadraba las columnas");
    assert.match(leer("js/pos-sales.js"), /class="pos-cart-code" title="\$\{escaparPOS\(codigo\)\}"/, "el codigo completo se ve al pasar el mouse");
});
