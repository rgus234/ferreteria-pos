// Con que nivel de precio arranca una venta cuando nadie configuro nada.
//
// EL DANO QUE ESTA PRUEBA EXISTE PARA EVITAR
//
// El POS siempre habia arrancado en medio mayoreo, escrito a mano en seis
// lugares de pos-sales.js:
//
//     nivelPrecioActual = "mayoreo";
//
// Al hacerlo configurable, la columna nacio con DEFAULT 'publico' y la
// funcion del cliente cayo en "publico" cuando no habia nada guardado.
// Ninguno de los 13 negocios habia abierto ese ajuste todavia, asi que
// TODOS pasaron de cobrar medio mayoreo a cobrar publico el mismo dia del
// despliegue.
//
// Lo encontro el dueno de Ferreteria Olimpico vendiendo, no una prueba:
// un Plasti Acero que el vende en $105 se cobro en $115, y una barra LED
// de $140 salio en $155. Cobro de MAS, a sus clientes, durante un dia.
//
// La leccion, y por eso la prueba mira el DEFAULT y no otra cosa: el
// respaldo de un ajuste nuevo no es "el valor mas razonable", es "lo que
// el programa hacia antes de que el ajuste existiera".

const { test, after } = require("node:test");
const assert = require("node:assert/strict");

const { pool, crearNegocioPrueba, borrarNegocioPrueba } =
    require("./helpers/negocio-prueba");

const creados = [];

after(async () => {
    for (const id of creados) await borrarNegocioPrueba(id);
});

test("un negocio nuevo cobra medio mayoreo, no publico", async () => {
    const { negocioId } = await crearNegocioPrueba("nivel-defecto");
    creados.push(negocioId);

    const { rows } = await pool.query(
        "SELECT nivel_precio_por_defecto FROM public.negocios WHERE id = $1",
        [negocioId]
    );

    assert.equal(
        rows[0].nivel_precio_por_defecto,
        "mayoreo",
        "un negocio que nunca abrio el ajuste debe cobrar lo mismo que "
        + "cobraba antes de que el ajuste existiera"
    );
});

test("los tres niveles siguen siendo valores validos de la columna", async () => {
    // Si alguien agrega un nivel al codigo y no al CHECK, la corrida
    // revienta a mitad de una venta. Ya paso una vez con motivo_revision.
    for (const nivel of ["publico", "mayoreo", "distribuidor"]) {
        const { negocioId } = await crearNegocioPrueba(`nivel-${nivel}`);
        creados.push(negocioId);

        await pool.query(
            "UPDATE public.negocios SET nivel_precio_por_defecto = $1 WHERE id = $2",
            [nivel, negocioId]
        );

        const { rows } = await pool.query(
            "SELECT nivel_precio_por_defecto FROM public.negocios WHERE id = $1",
            [negocioId]
        );
        assert.equal(rows[0].nivel_precio_por_defecto, nivel);
    }
});
