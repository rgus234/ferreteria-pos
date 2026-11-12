// Proveedor por marca (abarrotes): al agregar un producto se le pone el proveedor de su marca (Doritos -> Sabritas), creandolo si falta,
// y el negocio aprende quien le vende cada marca. En una ferreteria no se aplica.
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { pool, crearNegocioPrueba, borrarNegocioPrueba } = require("./helpers/negocio-prueba");
const { iniciarServidorPrueba, detenerServidorPrueba, BASE_URL } = require("./helpers/servidor-prueba");

let abarrotes;
let ferreteria;
const headers = n => ({ "Content-Type": "application/json", "x-dispositivo-token": n.token });
const api = async (n, ruta, cuerpo) => { const r = await fetch(`${BASE_URL}${ruta}`, { method: cuerpo ? "POST" : "GET", headers: headers(n), ...(cuerpo ? { body: JSON.stringify(cuerpo) } : {}) }); return { estado: r.status, datos: await r.json().catch(() => ({})) }; };
const alta = (n, nombre, extra = {}) => api(n, "/agregar-producto", { nombre, precio: 20, stock: 3, ...extra });
const producto = async (n, nombre) => (await pool.query(`SELECT id, proveedor_id, proveedor FROM public.productos WHERE negocio_id = $1 AND nombre = $2`, [n.negocioId, nombre])).rows[0];
const proveedores = async n => (await pool.query(`SELECT id, nombre, creado_automatico FROM public.proveedores WHERE negocio_id = $1 ORDER BY id`, [n.negocioId])).rows;

before(async () => {
    await iniciarServidorPrueba();
    abarrotes = await crearNegocioPrueba("prov-marca-abarrotes");
    ferreteria = await crearNegocioPrueba("prov-marca-ferreteria");
    await pool.query(`UPDATE public.negocio_giros SET activo = false WHERE negocio_id = $1`, [abarrotes.negocioId]);
    await pool.query(`INSERT INTO public.negocio_giros (negocio_id, giro, activo) VALUES ($1, 'abarrotes', true) ON CONFLICT (negocio_id, giro) DO UPDATE SET activo = true`, [abarrotes.negocioId]);
});

after(async () => {
    for (const n of [abarrotes, ferreteria]) if (n) { await pool.query(`DELETE FROM public.proveedor_marcas WHERE negocio_id = $1`, [n.negocioId]).catch(() => {}); await borrarNegocioPrueba(n.negocioId); }
    await detenerServidorPrueba();
    await pool.end();
});

test("la sugerencia dice que proveedor le toca a un producto por su marca, sin crear nada", async () => {
    const r = await api(abarrotes, "/proveedores/sugerido?nombre=" + encodeURIComponent("Doritos Nacho 58 g"));

    assert.equal(r.estado, 200, JSON.stringify(r.datos));
    assert.deepEqual([r.datos.sugerido.marca, r.datos.sugerido.proveedor, r.datos.sugerido.existe], ["Sabritas", "Sabritas", false]);
    assert.equal((await proveedores(abarrotes)).length, 0, "sugerir no crea");

    assert.equal((await api(abarrotes, "/proveedores/sugerido?nombre=" + encodeURIComponent("Producto raro xyz"))).datos.sugerido, null);
});

test("al agregar un producto sin proveedor se le pone el de su marca, se crea si falta y se reutiliza despues; tambien cae en su exhibidor", async () => {
    assert.equal((await alta(abarrotes, "Doritos Nacho 58 g")).estado, 200);

    const d = await producto(abarrotes, "Doritos Nacho 58 g");
    assert.equal(d.proveedor, "Sabritas");
    assert.ok(d.proveedor_id);

    const lista = await proveedores(abarrotes);
    assert.equal(lista.length, 1);
    assert.equal(lista[0].creado_automatico, true);

    await alta(abarrotes, "Cheetos Bolitas 43 g");
    assert.equal((await proveedores(abarrotes)).length, 1, "el segundo producto de la marca reutiliza al proveedor");
    assert.equal((await producto(abarrotes, "Cheetos Bolitas 43 g")).proveedor_id, d.proveedor_id);

    const exh = (await pool.query(`SELECT count(*)::int AS n FROM public.exhibidores WHERE negocio_id = $1 AND lower(nombre) = 'sabritas'`, [abarrotes.negocioId])).rows[0].n;
    assert.equal(exh, 1, "el exhibidor de la marca se creo una sola vez");
});

test("usa el proveedor que ya tiene el negocio cuando su nombre contiene la marca, y no pisa el que el producto ya trae", async () => {
    const femsa = (await pool.query(`INSERT INTO public.proveedores (negocio_id, nombre) VALUES ($1, 'COCA-COLA FEMSA DISTRIBUIDOR SA DE CV') RETURNING id`, [abarrotes.negocioId])).rows[0].id;
    const antes = (await proveedores(abarrotes)).length;

    await alta(abarrotes, "Fanta Naranja 600 ml");
    assert.equal(Number((await producto(abarrotes, "Fanta Naranja 600 ml")).proveedor_id), femsa);
    assert.equal((await proveedores(abarrotes)).length, antes, "no creo otro Coca-Cola");

    await alta(abarrotes, "Sprite Lima-Limon 600 ml", { proveedor: "Mi mayorista" });
    assert.equal((await producto(abarrotes, "Sprite Lima-Limon 600 ml")).proveedor, "Mi mayorista");
});

test("cuando el dueño asigna un proveedor a un producto, los siguientes de esa marca van con el mismo", async () => {
    const mayorista = (await pool.query(`INSERT INTO public.proveedores (negocio_id, nombre) VALUES ($1, 'Mayorista Don Juan') RETURNING id`, [abarrotes.negocioId])).rows[0].id;
    const p = await producto(abarrotes, "Doritos Nacho 58 g");

    const r = await api(abarrotes, "/productos/asignar-proveedor", { productoIds: [p.id], proveedorId: mayorista });
    assert.equal(r.datos.marcasAprendidas, 1);

    await alta(abarrotes, "Ruffles Queso 88 g");
    assert.equal(Number((await producto(abarrotes, "Ruffles Queso 88 g")).proveedor_id), mayorista, "Ruffles tambien es Sabritas: ahora va con el mayorista");
});

test("acomodar por marca llena a los que no tienen proveedor y deja los de marca desconocida", async () => {
    await pool.query(`INSERT INTO public.productos (negocio_id, nombre, codigo, precio, stock) VALUES ($1, 'Bimbo Blanco Chico 300 g', 'ZZPM-1', 30, 2), ($1, 'Cosa sin marca conocida', 'ZZPM-2', 5, 1)`, [abarrotes.negocioId]);

    const r = await api(abarrotes, "/productos/proveedores-por-marca", {});

    assert.equal(r.estado, 200, JSON.stringify(r.datos));
    assert.ok(r.datos.asignados >= 1);
    assert.ok(r.datos.creados.includes("Bimbo"));
    assert.equal((await producto(abarrotes, "Bimbo Blanco Chico 300 g")).proveedor, "Bimbo");
    assert.equal((await producto(abarrotes, "Cosa sin marca conocida")).proveedor_id, null);
});

test("una ferreteria no recibe proveedor por marca", async () => {
    assert.equal((await alta(ferreteria, "Doritos Nacho 58 g")).estado, 200);
    assert.equal((await producto(ferreteria, "Doritos Nacho 58 g")).proveedor_id, null);
    assert.equal((await proveedores(ferreteria)).length, 0);
    assert.equal((await api(ferreteria, "/productos/proveedores-por-marca", {})).estado, 400);
});
