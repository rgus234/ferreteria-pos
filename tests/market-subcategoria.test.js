// Nexo Market: filtro por subcategoria de Nexo dentro de una categoria (la misma lista controlada del catalogo).
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { pool, crearNegocioPrueba, crearProductoPrueba, borrarNegocioPrueba } = require("./helpers/negocio-prueba");
const { iniciarServidorPrueba, detenerServidorPrueba, BASE_URL } = require("./helpers/servidor-prueba");

let negocio;
let depto;
let subA;
let subB;

const buscar = async (extra = "") => (await fetch(`${BASE_URL}/market/buscar-json?categoria=${encodeURIComponent(depto)}&giro=ferreteria&buscar=MSC-${extra}`)).json();

before(async () => {
    await iniciarServidorPrueba();
    negocio = await crearNegocioPrueba("market-subcategoria");
    await pool.query(`INSERT INTO public.sitio_web_config (negocio_id, activo, mostrar_precios, mostrar_existencias) VALUES ($1, true, true, true)`, [negocio.negocioId]);

    const filas = (await pool.query(`SELECT id, departamento, nombre FROM public.categorias_nexo WHERE giro = 'ferreteria_v2' AND departamento = (SELECT departamento FROM public.categorias_nexo WHERE giro = 'ferreteria_v2' GROUP BY departamento HAVING COUNT(*) >= 2 ORDER BY departamento LIMIT 1) ORDER BY id LIMIT 2`)).rows;
    depto = filas[0].departamento;
    subA = filas[0];
    subB = filas[1];

    for (const [nombre, codigo, sub] of [["Producto uno de sub A", "MSC-A1", subA], ["Producto dos de sub A", "MSC-A2", subA], ["Producto de sub B", "MSC-B1", subB]]) {
        await crearProductoPrueba(negocio.negocioId, { nombre, codigo });
        await pool.query(`UPDATE public.productos SET categoria_nexo_id = $1, categoria = $2, visible_market = true WHERE negocio_id = $3 AND codigo = $4`, [sub.id, depto, negocio.negocioId, codigo]);
    }
});

after(async () => {
    if (negocio) await borrarNegocioPrueba(negocio.negocioId);
    await detenerServidorPrueba();
    await pool.end();
});

test("al elegir una categoria, las facetas ofrecen sus subcategorias con cuantos productos tiene cada una", async () => {
    const r = await buscar();
    assert.equal(r.ok, true);
    const a = r.facetas.subcategorias.find(s => s.nombre === subA.nombre);
    const b = r.facetas.subcategorias.find(s => s.nombre === subB.nombre);
    assert.equal(a.total, 2);
    assert.equal(b.total, 1);
});

test("elegir una subcategoria deja solo sus productos, y las hermanas se siguen ofreciendo", async () => {
    const r = await buscar(`&subcategoria=${encodeURIComponent(subA.nombre)}`);
    const codigos = r.productos.map(p => p.codigo).filter(c => c.startsWith("MSC-")).sort();
    assert.deepEqual(codigos, ["MSC-A1", "MSC-A2"]);
    assert.ok(r.facetas.subcategorias.some(s => s.nombre === subB.nombre), "la otra subcategoria sigue disponible para cambiar");
});

test("una subcategoria sin categoria se ignora, y una que no existe no deja nada", async () => {
    const sinCategoria = await (await fetch(`${BASE_URL}/market/buscar-json?giro=ferreteria&buscar=MSC-&subcategoria=${encodeURIComponent(subA.nombre)}`)).json();
    assert.equal(sinCategoria.ok, true);
    assert.ok(sinCategoria.productos.some(p => p.codigo === "MSC-B1"), "sin categoria el filtro no aplica");

    const inexistente = await buscar("&subcategoria=No%20existe");
    assert.equal(inexistente.productos.filter(p => String(p.codigo).startsWith("MSC-")).length, 0);
});
