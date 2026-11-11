// Encargos de abarrotes: pasan solos a "en proceso de resurtido" cuando se pide, a "listo" cuando llega, y avisan una vez al dia.
// Requiere la migracion 20261126_encargos_resurtiendo.sql.
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { pool, crearNegocioPrueba, crearProductoPrueba, borrarNegocioPrueba } = require("./helpers/negocio-prueba");
const { marcarResurtiendoPorPedido, avanzarPorRecepcion, avisarEncargosDelDia, textoDia, textoLlego } = require("../encargos-abarrotes");

let abarrotes;
let ferreteria;
let gansito;
let agua;
let gansitoFerreteria;

async function encargo(negocioId, cliente, items, fecha = null, estado = "pendiente") {
    const e = await pool.query(
        `INSERT INTO public.encargos_clientes (negocio_id, cliente_nombre, estado, fecha_entrega_esperada) VALUES ($1, $2, $3, $4) RETURNING id`,
        [negocioId, cliente, estado, fecha]
    );

    for (const [productoId, nombre, cantidad] of items) {
        await pool.query(
            `INSERT INTO public.encargos_clientes_items (negocio_id, encargo_id, producto_id, nombre, cantidad) VALUES ($1, $2, $3, $4, $5)`,
            [negocioId, e.rows[0].id, productoId, nombre, cantidad]
        );
    }

    return e.rows[0].id;
}

const estadoDe = async id => (await pool.query(`SELECT estado FROM public.encargos_clientes WHERE id = $1`, [id])).rows[0].estado;

before(async () => {
    abarrotes = await crearNegocioPrueba("encargos-abarrotes");
    ferreteria = await crearNegocioPrueba("encargos-ferreteria");
    await pool.query(`UPDATE public.negocios SET giro = 'abarrotes' WHERE id = $1`, [abarrotes.negocioId]);
    await pool.query(`UPDATE public.negocios SET giro = 'ferreteria' WHERE id = $1`, [ferreteria.negocioId]);

    gansito = (await crearProductoPrueba(abarrotes.negocioId, { nombre: "Gansito", precio: 18, stock: 0 })).id;
    agua = (await crearProductoPrueba(abarrotes.negocioId, { nombre: "Agua 1 L", precio: 15, stock: 50 })).id;
    gansitoFerreteria = (await crearProductoPrueba(ferreteria.negocioId, { nombre: "Tornillo", precio: 1, stock: 0 })).id;
});

after(async () => {
    if (abarrotes) await borrarNegocioPrueba(abarrotes.negocioId);
    if (ferreteria) await borrarNegocioPrueba(ferreteria.negocioId);
    await pool.end();
});

test("un pedido enviado con el producto encargado deja el encargo en proceso de resurtido; los demas no cambian", async () => {
    const conGansito = await encargo(abarrotes.negocioId, "Juan", [[gansito, "Gansito", 10]]);
    const conAgua = await encargo(abarrotes.negocioId, "Ana", [[agua, "Agua 1 L", 5]]);

    assert.equal(await marcarResurtiendoPorPedido(pool, abarrotes.negocioId, [gansito]), 1);
    assert.equal(await estadoDe(conGansito), "resurtiendo");
    assert.equal(await estadoDe(conAgua), "pendiente");
});

test("al llegar mercancia el encargo pasa a listo solo si ya alcanza para todo, y se avisa; uno con producto escrito a mano no avanza", async () => {
    const enviados = [];
    const enviar = async (_pool, negocioId, aviso) => { enviados.push([negocioId, aviso]); };
    const completo = await encargo(abarrotes.negocioId, "Luis", [[gansito, "Gansito", 10]], null, "resurtiendo");
    const aMano = await encargo(abarrotes.negocioId, "Rosa", [[gansito, "Gansito", 1], [null, "Pastel especial", 1]], null, "pendiente");

    // Llegan solo 4: no alcanza para los 10.
    await pool.query(`UPDATE public.productos SET stock = 4 WHERE id = $1`, [gansito]);
    assert.deepEqual(await avanzarPorRecepcion(pool, abarrotes.negocioId, [gansito], { enviar }), []);
    assert.equal(await estadoDe(completo), "resurtiendo");

    // Llegan 12: alcanza. El de producto escrito a mano se queda como estaba.
    await pool.query(`UPDATE public.productos SET stock = 12 WHERE id = $1`, [gansito]);
    const avanzados = await avanzarPorRecepcion(pool, abarrotes.negocioId, [gansito], { enviar });

    assert.ok(avanzados.some(e => e.id === completo));
    assert.equal(await estadoDe(completo), "listo");
    assert.equal(await estadoDe(aMano), "pendiente");
    assert.equal(enviados.length, 1);
    assert.match(enviados[0][1].cuerpo, /Luis/);
});

test("un negocio de ferreteria no se toca", async () => {
    const e = await encargo(ferreteria.negocioId, "Pedro", [[gansitoFerreteria, "Tornillo", 5]]);
    await pool.query(`UPDATE public.productos SET stock = 50 WHERE id = $1`, [gansitoFerreteria]);

    assert.equal(await marcarResurtiendoPorPedido(pool, ferreteria.negocioId, [gansitoFerreteria]), 0);
    assert.deepEqual(await avanzarPorRecepcion(pool, ferreteria.negocioId, [gansitoFerreteria], { enviar: async () => { throw new Error("no debe avisar"); } }), []);
    assert.equal(await estadoDe(e), "pendiente");
});

test("el aviso del dia sale una sola vez, despues de las 8 am, con lo que vence hoy, mañana o esta atrasado", async () => {
    const limpio = await crearNegocioPrueba("encargos-aviso");
    await pool.query(`UPDATE public.negocios SET giro = 'abarrotes' WHERE id = $1`, [limpio.negocioId]);
    const prod = (await crearProductoPrueba(limpio.negocioId, { nombre: "Pan", precio: 5, stock: 0 })).id;
    await encargo(limpio.negocioId, "Juan", [[prod, "10 Gansitos", 10]], "2026-11-03");

    const enviados = [];
    const enviar = async (_pool, negocioId, aviso) => { if (negocioId === limpio.negocioId) enviados.push(aviso); };
    const siete = new Date("2026-11-03T13:00:00Z"); // 7:00 en Mexico
    const nueve = new Date("2026-11-03T15:00:00Z"); // 9:00 en Mexico

    try {
        await avisarEncargosDelDia(pool, { ahora: siete, enviar, soloNegocios: [limpio.negocioId] });
        assert.equal(enviados.length, 0, "antes de las 8 no se avisa");

        await avisarEncargosDelDia(pool, { ahora: nueve, enviar, soloNegocios: [limpio.negocioId] });
        assert.equal(enviados.length, 1);
        assert.equal(enviados[0].cuerpo, "El encargo de Juan (10 Gansitos) vence hoy.");

        await avisarEncargosDelDia(pool, { ahora: nueve, enviar, soloNegocios: [limpio.negocioId] });
        assert.equal(enviados.length, 1, "el mismo dia no se repite");
    } finally {
        await borrarNegocioPrueba(limpio.negocioId);
    }
});

test("los textos hablan de uno o de varios encargos", () => {
    assert.equal(textoDia({ hoy: 1, manana: 0, atrasados: 0, listos: 0, unico: { cliente: "Ana", producto: "Leche", cuando: "manana" } }).cuerpo, "El encargo de Ana (Leche) es para mañana.");
    assert.equal(textoDia({ hoy: 1, manana: 2, atrasados: 1, listos: 3 }).cuerpo, "1 vence hoy, 2 para mañana, 1 atrasado, 3 listos esperando al cliente.");
    assert.match(textoLlego([{ cliente_nombre: "Luis", productos: "Gansito" }]).cuerpo, /Ya llegó lo que encargó Luis \(Gansito\)/);
    assert.match(textoLlego([{ cliente_nombre: "A" }, { cliente_nombre: "B" }]).cuerpo, /2 encargos: A, B/);
});
