// La sugerencia de precio de una factura nunca queda por debajo de la lista vigente del fabricante (Truper), pero si el catalogo del proveedor
// (Diprofer) ya esta mas alto se respeta. Solo cambia la sugerencia en memoria.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { elevarPreciosConListaFabricante } = require("../recepcion-inteligente-matching");

const poolCon = filas => ({ query: async () => ({ rows: filas }) });
const candidato = (mm, pub, fuente = "catalogo_proveedor_codigo") => ({ fuente, precioMedioMayoreo: mm, precioPublico: pub });

test("el proveedor esta mas bajo que la lista del fabricante: sube a la lista y guarda el precio original", async () => {
    const c = candidato(169, 187);
    await elevarPreciosConListaFabricante(poolCon([{ codigo: "10553", precio_medio_mayoreo: "185.00", precio_publico: "205.00" }]), [{ codigo: "10553", candidato: c }]);

    assert.equal(c.precioMedioMayoreo, 185);
    assert.equal(c.precioPublico, 205);
    assert.equal(c.precioProveedorMedioMayoreo, 169, "se conserva lo que decia el proveedor");
    assert.equal(c.ajustadoConListaFabricante, true);
});

test("el proveedor ya esta mas alto: se respeta y no se marca como ajustado", async () => {
    const c = candidato(200, 230);
    await elevarPreciosConListaFabricante(poolCon([{ codigo: "10553", precio_medio_mayoreo: "185.00", precio_publico: "205.00" }]), [{ codigo: "10553", candidato: c }]);

    assert.equal(c.precioMedioMayoreo, 200);
    assert.equal(c.precioPublico, 230);
    assert.equal(c.ajustadoConListaFabricante, undefined);
});

test("cada nivel se decide por separado (uno sube, el otro se queda)", async () => {
    const c = candidato(169, 230);
    await elevarPreciosConListaFabricante(poolCon([{ codigo: "10553", precio_medio_mayoreo: "185.00", precio_publico: "205.00" }]), [{ codigo: "10553", candidato: c }]);

    assert.equal(c.precioMedioMayoreo, 185);
    assert.equal(c.precioPublico, 230);
});

test("sin lista del fabricante, o si el candidato no viene del catalogo del proveedor, no se toca nada", async () => {
    const sinLista = candidato(169, 187);
    await elevarPreciosConListaFabricante(poolCon([]), [{ codigo: "999", candidato: sinLista }]);
    assert.equal(sinLista.precioMedioMayoreo, 169);

    const delMaestro = candidato(169, 187, "catalogo_maestro_codigo");
    await elevarPreciosConListaFabricante(poolCon([{ codigo: "10553", precio_medio_mayoreo: "185.00", precio_publico: "205.00" }]), [{ codigo: "10553", candidato: delMaestro }]);
    assert.equal(delMaestro.precioMedioMayoreo, 169, "otras fuentes ya traen su propia lista");
});

test("si la consulta de la lista falla, la factura sigue como antes (precio del proveedor)", async () => {
    const c = candidato(169, 187);
    await elevarPreciosConListaFabricante({ query: async () => { throw new Error("sin tabla"); } }, [{ codigo: "10553", candidato: c }]);
    assert.equal(c.precioMedioMayoreo, 169);
});
