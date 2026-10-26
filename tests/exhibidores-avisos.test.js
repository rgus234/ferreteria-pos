// Aviso diario de exhibidores por surtir. Requiere la migracion 20261102_avisos_exhibidores.sql.
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { pool, crearNegocioPrueba, crearProductoPrueba, borrarNegocioPrueba } = require("./helpers/negocio-prueba");
const { exhibidoresPorSurtir, avisarExhibidores, textoAviso, horaLocal } = require("../exhibidores-avisos");

let negocio;
let exhibidorBrocas;

async function exhibidor(nombre, espacios) {
    const x = await pool.query(`INSERT INTO public.exhibidores (negocio_id, nombre) VALUES ($1, $2) RETURNING id`, [negocio.negocioId, nombre]);

    for (const [i, [producto, capacidad]] of espacios.entries()) {
        await pool.query(`INSERT INTO public.exhibidor_espacios (negocio_id, exhibidor_id, producto_id, capacidad, orden) VALUES ($1, $2, $3, $4, $5)`, [negocio.negocioId, x.rows[0].id, producto.id, capacidad, i]);
    }

    return x.rows[0].id;
}

before(async () => {
    negocio = await crearNegocioPrueba("exhibidores-avisos");

    const llena = await crearProductoPrueba(negocio.negocioId, { nombre: "Broca llena", precio: 10, stock: 10 });
    const baja = await crearProductoPrueba(negocio.negocioId, { nombre: "Broca baja", precio: 10, stock: 2 });
    const agotada = await crearProductoPrueba(negocio.negocioId, { nombre: "Broca agotada", precio: 10, stock: 0 });
    const sinCapacidad = await crearProductoPrueba(negocio.negocioId, { nombre: "Sin capacidad", precio: 10, stock: 0 });

    exhibidorBrocas = await exhibidor("Despachador de brocas", [[llena, 10], [baja, 10], [agotada, 10], [sinCapacidad, 0]]);
});

after(async () => {
    if (negocio) await borrarNegocioPrueba(negocio.negocioId);
    await pool.end();
});

test("cuenta como por surtir lo que tiene el 25 % de su capacidad o menos; sin capacidad no se avisa", async () => {
    const lista = await exhibidoresPorSurtir(pool, negocio.negocioId);

    assert.equal(lista.length, 1);
    assert.deepEqual([lista[0].id, lista[0].nombre, lista[0].bajos, lista[0].agotados], [exhibidorBrocas, "Despachador de brocas", 2, 1]);
});

test("el texto del aviso habla de uno o de varios exhibidores", () => {
    assert.deepEqual(textoAviso([{ nombre: "Brocas", bajos: 6, agotados: 2 }]), { titulo: "Hay que surtir un exhibidor", cuerpo: "Brocas: 6 productos por surtir (2 agotados)." });
    assert.equal(textoAviso([{ nombre: "Brocas", bajos: 1, agotados: 0 }]).cuerpo, "Brocas: 1 producto por surtir.");
    assert.equal(textoAviso([{ nombre: "A", bajos: 3, agotados: 0 }, { nombre: "B", bajos: 2, agotados: 0 }, { nombre: "C", bajos: 1, agotados: 0 }, { nombre: "D", bajos: 1, agotados: 0 }]).cuerpo, "4 exhibidores por surtir: A (3), B (2), C (1) y mas.");
});

test("se avisa una sola vez al dia, despues de las 9 am (hora de Mexico), solo al dueño de este negocio", async () => {
    const enviados = [];
    const enviar = async (_pool, negocioId, aviso) => { if (negocioId === negocio.negocioId) enviados.push(aviso); };
    const manana7 = new Date("2026-11-03T13:00:00Z"); // 7:00 en Mexico
    const manana10 = new Date("2026-11-03T16:00:00Z"); // 10:00 en Mexico

    assert.equal(horaLocal(manana7), 7);
    assert.equal(horaLocal(manana10), 10);

    await avisarExhibidores(pool, { ahora: manana7, enviar, soloNegocios: [negocio.negocioId] });
    assert.equal(enviados.length, 0, "antes de las 9 no se avisa");

    await avisarExhibidores(pool, { ahora: manana10, enviar, soloNegocios: [negocio.negocioId] });
    assert.equal(enviados.length, 1);
    assert.match(enviados[0].cuerpo, /Despachador de brocas: 2 productos por surtir \(1 agotado\)/);

    await avisarExhibidores(pool, { ahora: new Date("2026-11-03T20:00:00Z"), enviar, soloNegocios: [negocio.negocioId] });
    assert.equal(enviados.length, 1, "el mismo dia no se repite");

    await avisarExhibidores(pool, { ahora: new Date("2026-11-04T16:00:00Z"), enviar, soloNegocios: [negocio.negocioId] });
    assert.equal(enviados.length, 2, "al dia siguiente vuelve a avisar si sigue sin surtir");
});

test("si el exhibidor ya esta surtido no se avisa", async () => {
    await pool.query(`UPDATE public.productos SET stock = 10 WHERE negocio_id = $1`, [negocio.negocioId]);
    assert.deepEqual(await exhibidoresPorSurtir(pool, negocio.negocioId), []);
});
