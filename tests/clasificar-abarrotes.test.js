// Categoria Nexo automatica en abarrotes: reglas de nombre (gratis), sugerencia al agregar un producto y alta que nunca deja un producto sin categoria.
// Solo para negocios de abarrotes (sin ferreteria): en una ferreteria no se aplican.
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { pool, crearNegocioPrueba, borrarNegocioPrueba } = require("./helpers/negocio-prueba");
const { iniciarServidorPrueba, detenerServidorPrueba, BASE_URL } = require("./helpers/servidor-prueba");
const { clasificarAbarrotes } = require("../clasificar-abarrotes");

let abarrotes;
let ferreteria;
const headers = n => ({ "Content-Type": "application/json", "x-dispositivo-token": n.token });
const post = async (n, ruta, cuerpo) => { const r = await fetch(`${BASE_URL}${ruta}`, { method: "POST", headers: headers(n), body: JSON.stringify(cuerpo) }); return { estado: r.status, datos: await r.json().catch(() => ({})) }; };
const categoriaDe = async (n, nombre) => (await pool.query(`SELECT categoria, categoria_nexo_id FROM public.productos WHERE negocio_id = $1 AND nombre = $2`, [n.negocioId, nombre])).rows[0];

before(async () => {
    await iniciarServidorPrueba();
    abarrotes = await crearNegocioPrueba("clasif-abarrotes");
    ferreteria = await crearNegocioPrueba("clasif-ferreteria");
    await pool.query(`UPDATE public.negocio_giros SET activo = false WHERE negocio_id = $1`, [abarrotes.negocioId]);
    await pool.query(`INSERT INTO public.negocio_giros (negocio_id, giro, activo) VALUES ($1, 'abarrotes', true) ON CONFLICT (negocio_id, giro) DO UPDATE SET activo = true`, [abarrotes.negocioId]);
});

after(async () => {
    for (const n of [abarrotes, ferreteria]) if (n) await borrarNegocioPrueba(n.negocioId);
    await detenerServidorPrueba();
    await pool.end();
});

test("las reglas ponen la categoria de los productos de abarrotes mas comunes", () => {
    const filas = ejemplos();
    for (const [nombre, id] of filas) assert.equal(clasificarAbarrotes(nombre), id, nombre);
    assert.equal(clasificarAbarrotes("Tornillo hexagonal 1/4"), null, "lo que no es de abarrotes no se clasifica");
    assert.equal(clasificarAbarrotes("Aceite 1-2-3 500 ml"), 204);
});

function ejemplos() {
    return [["Sponch Marinela 120 g", 199], ["Doritos Nacho 58 g", 198], ["Coca-Cola 600 ml", 187], ["Bonafont 1 L", 188], ["Del Valle Naranja 1 L", 189], ["Lala Entera 1 L", 193], ["Danonino Fresa 70 g", 194], ["Corona Extra 355 ml", 191], ["Monster Energy 473 ml", 192], ["Orbit Menta 4.6 g", 201], ["Fabuloso Lavanda 1 L", 213]];
}

test("la sugerencia de categoria usa las reglas en un negocio de abarrotes, sin gastar IA", async () => {
    const r = await post(abarrotes, "/ia/sugerir-categoria-nexo", { nombre: "Sponch Marinela 120 g" });

    assert.equal(r.estado, 200, JSON.stringify(r.datos));
    assert.equal(r.datos.disponible, true);
    assert.equal(r.datos.categoriaNexoId, 199);
    assert.equal(r.datos.origen, "reglas");
});

test("agregar un producto de abarrotes sin categoria se la asigna; si ya trae una, se respeta", async () => {
    const sin = await post(abarrotes, "/agregar-producto", { nombre: "Doritos Nacho 58 g", precio: 20, stock: 3, codigo: "ZZCLAS-001" });
    assert.equal(sin.estado, 200, JSON.stringify(sin.datos));
    const a = await categoriaDe(abarrotes, "Doritos Nacho 58 g");
    assert.equal(a.categoria_nexo_id, 198);
    assert.equal(a.categoria, "Botanas y dulces");

    // Con un texto de categoria que ya venia, se conserva el texto; el id Nexo se asigna igual.
    const conTexto = await post(abarrotes, "/agregar-producto", { nombre: "Lala Entera 1 L", precio: 28, stock: 3, codigo: "ZZCLAS-002", categoria: "Mi categoria" });
    assert.equal(conTexto.estado, 200);
    const b = await categoriaDe(abarrotes, "Lala Entera 1 L");
    assert.equal(b.categoria_nexo_id, 193);
    assert.equal(b.categoria, "Mi categoria");

    // Sin regla que aplique, queda sin categoria Nexo (se elige a mano o la IA la sugiere en pantalla).
    const rara = await post(abarrotes, "/agregar-producto", { nombre: "Producto raro sin marca conocida", precio: 5, stock: 1, codigo: "ZZCLAS-003" });
    assert.equal(rara.estado, 200);
    assert.equal((await categoriaDe(abarrotes, "Producto raro sin marca conocida")).categoria_nexo_id, null);
});

test("un negocio de ferreteria no recibe categorias de abarrotes", async () => {
    const r = await post(ferreteria, "/agregar-producto", { nombre: "Doritos Nacho 58 g", precio: 20, stock: 3, codigo: "ZZCLAS-010" });

    assert.equal(r.estado, 200, JSON.stringify(r.datos));
    assert.equal((await categoriaDe(ferreteria, "Doritos Nacho 58 g")).categoria_nexo_id, null);
});
