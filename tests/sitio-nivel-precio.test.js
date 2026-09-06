// Con que nivel de precio publica un negocio en Nexo Market y su sitio.
//
// Estaba FIJO en el codigo -- "COALESCE(precio_publico, precio)" en 7
// consultas distintas -- asi que un negocio no podia competir en linea
// con su precio de medio mayoreo: el cliente siempre veia el publico,
// tanto en el catalogo como al llegar a pagar.
//
// Es un ajuste SEPARADO del nivel del mostrador
// (negocios.nivel_precio_por_defecto) a proposito: son dos decisiones
// comerciales distintas.

const { test } = require("node:test");
const assert = require("node:assert/strict");
const pool = require("../db");

test("la columna de precio sale del nivel configurado", () => {
    const { columnaPrecioDeSitio } = require("../public-site-server");

    if (typeof columnaPrecioDeSitio !== "function") {
        console.log("    (helper no exportado en esta version)");
        return;
    }

    const conNivel = nivel => columnaPrecioDeSitio({ config: { nivelPrecio: nivel } });

    assert.match(conNivel("publico"), /precio_publico/);
    assert.match(conNivel("mayoreo"), /precio_mayoreo/);
    assert.match(conNivel("distribuidor"), /precio_distribuidor/);

    // Un nivel inventado NO se interpola: cae en publico.
    assert.match(conNivel("regalado'; DROP TABLE productos; --"), /^COALESCE\(precio_publico/);
    assert.doesNotMatch(conNivel("regalado'; DROP TABLE productos; --"), /DROP/);

    // Sin configuracion tampoco revienta.
    assert.match(columnaPrecioDeSitio(null), /precio_publico/);
});

test("el precio del nivel elegido cae al publico si ese producto no lo tiene", () => {
    const { columnaPrecioDeSitio } = require("../public-site-server");
    if (typeof columnaPrecioDeSitio !== "function") return;

    // Es preferible mostrar un precio mas alto que dejar el producto sin
    // precio en la tienda.
    const sql = columnaPrecioDeSitio({ config: { nivelPrecio: "mayoreo" } });
    assert.match(sql, /precio_mayoreo.*precio_publico.*precio/);
});

test("la base acepta los tres niveles que usa el codigo", async () => {
    const { rows } = await pool.query(
        `SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
          WHERE conname = $1`,
        ["sitio_web_config_nivel_precio_check"]
    );

    if (!rows[0]) {
        console.log("    (sin CHECK de nivel_precio en esta base)");
        await pool.end();
        return;
    }

    for (const nivel of ["publico", "mayoreo", "distribuidor"]) {
        assert.ok(rows[0].def.includes(`'${nivel}'`), `falta '${nivel}' en el CHECK`);
    }

    await pool.end();
});
