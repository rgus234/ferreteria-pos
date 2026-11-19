// Catalogo de productos en PDF: opciones por categoria de Nexo, conteo, el PDF y sus filtros.
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const sharp = require("sharp");
const { pool, crearNegocioPrueba, borrarNegocioPrueba } = require("./helpers/negocio-prueba");
const { iniciarServidorPrueba, detenerServidorPrueba, BASE_URL } = require("./helpers/servidor-prueba");

let negocio;
let subA;
let subB;
const headers = () => ({ "Content-Type": "application/json", "x-dispositivo-token": negocio.token });
const post = (ruta, cuerpo) => fetch(`${BASE_URL}${ruta}`, { method: "POST", headers: headers(), body: JSON.stringify(cuerpo) });
const producto = (nombre, codigo, subId, extra = {}) => pool.query(
    `INSERT INTO public.productos (negocio_id, nombre, codigo, precio, precio_publico, precio_mayoreo, stock, categoria_nexo_id, marca, descripcion, visible_pos)
     VALUES ($1,$2,$3,100,100,80,$4,$5,$6,$7,$8) RETURNING id`,
    [negocio.negocioId, nombre, codigo, extra.stock ?? 5, subId, extra.marca ?? "Truper", extra.descripcion ?? "Descripcion de prueba", extra.visible ?? true]);

before(async () => {
    await iniciarServidorPrueba();
    negocio = await crearNegocioPrueba("catalogo-productos");
    const subs = (await pool.query(`SELECT id FROM public.categorias_nexo ORDER BY id LIMIT 2`)).rows;
    subA = subs[0].id;
    subB = subs[1].id;
    const foto = await sharp({ create: { width: 60, height: 40, channels: 3, background: "#cc3333" } }).jpeg().toBuffer();
    await producto("Martillo de prueba catalogo", "7501234500001", subA);
    await producto("Pinza de prueba catalogo", "ZZCAT-0002", subA, { marca: "Urrea", stock: 0 });
    await producto("Producto de otra categoria", "ZZCAT-0003", subB);
    await producto("Producto oculto", "ZZCAT-0004", subA, { visible: false });
    await pool.query(`INSERT INTO public.fotos_producto (negocio_id, codigo, imagen_principal, imagen_principal_tipo) VALUES ($1,'7501234500001',$2,'image/jpeg')`, [negocio.negocioId, foto]);
});

after(async () => {
    if (negocio) await borrarNegocioPrueba(negocio.negocioId);
    await detenerServidorPrueba();
    await pool.end();
});

test("las opciones agrupan por categoria de Nexo, cuentan fotos y no cuentan lo oculto", async () => {
    const r = await (await fetch(`${BASE_URL}/catalogo-productos/opciones`, { headers: headers() })).json();
    assert.equal(r.ok, true);
    const subs = r.departamentos.flatMap(d => d.subcategorias);
    const a = subs.find(s => s.id === subA);
    assert.equal(a.total, 2, "dos visibles (el oculto no cuenta)");
    assert.equal(a.conFoto, 1);
    assert.equal(subs.find(s => s.id === subB).total, 1);
    assert.ok(r.marcas.some(m => m.marca === "Urrea"));
});

test("contar respeta los filtros (foto, existencia, marca)", async () => {
    const base = { subcategoriaIds: [subA] };
    assert.equal((await (await post("/catalogo-productos/contar", base)).json()).total, 2);
    assert.equal((await (await post("/catalogo-productos/contar", { ...base, soloConFoto: true })).json()).total, 1);
    assert.equal((await (await post("/catalogo-productos/contar", { ...base, soloConExistencia: true })).json()).total, 1);
    assert.equal((await (await post("/catalogo-productos/contar", { ...base, marcas: ["urrea"] })).json()).total, 1);
    assert.equal((await (await post("/catalogo-productos/contar", { subcategoriaIds: [subA, subB] })).json()).total, 3);
    assert.equal((await (await post("/catalogo-productos/contar", {})).json()).total, 0, "sin elegir nada, nada");
});

test("el PDF sale con la cantidad correcta de productos y es un PDF de verdad", async () => {
    const r = await post("/catalogo-productos/pdf", { subcategoriaIds: [subA, subB], nivelPrecio: "mayoreo", titulo: "Catalogo de prueba" });
    assert.equal(r.status, 200);
    assert.match(r.headers.get("content-type"), /application\/pdf/);
    assert.equal(r.headers.get("x-productos"), "3");
    const buffer = Buffer.from(await r.arrayBuffer());
    assert.equal(buffer.slice(0, 5).toString(), "%PDF-");
    assert.ok(buffer.length > 2000);
});

test("sin elegir categoria, o con filtros que no dejan nada, avisa con claridad", async () => {
    const a = await post("/catalogo-productos/pdf", {});
    assert.equal(a.status, 400);
    assert.match((await a.json()).error, /categoria/i);

    const b = await post("/catalogo-productos/pdf", { subcategoriaIds: [subB], marcas: ["no-existe"] });
    assert.equal(b.status, 400);
    assert.match((await b.json()).error, /no hay productos/i);
});

const paginas = buffer => (buffer.toString("latin1").match(/\/Type\s*\/Page[^s]/g) || []).length;

test("el estilo cambia el PDF: portada agrega una hoja, y un estilo invalido no lo rompe", async () => {
    const base = { subcategoriaIds: [subA, subB] };
    const normal = Buffer.from(await (await post("/catalogo-productos/pdf", base)).arrayBuffer());

    for (const diseno of ["tarjetas", "compacto", "lista"]) {
        const r = await post("/catalogo-productos/pdf", { ...base, estilo: { color: "#dc2626", tipografia: "clasica", diseno, encabezado: "linea", esquinas: "rectas", nombreNegocio: "Mi Ferreteria", contacto: "Tel. 492 000 0000" } });
        assert.equal(r.status, 200, `diseno ${diseno}`);
        assert.equal(Buffer.from(await r.arrayBuffer()).slice(0, 5).toString(), "%PDF-");
    }

    const conPortada = Buffer.from(await (await post("/catalogo-productos/pdf", { ...base, estilo: { portada: true } })).arrayBuffer());
    assert.equal(paginas(conPortada), paginas(normal) + 1, "la portada es una hoja mas");

    const raro = await post("/catalogo-productos/pdf", { ...base, estilo: { color: "rojo", tipografia: "no-existe", diseno: "raro", logo: "data:image/png;base64,@@@" } });
    assert.equal(raro.status, 200, "valores invalidos se reemplazan por los de siempre");
});

test("las opciones traen los datos del negocio y las tipografias", async () => {
    const r = await (await fetch(`${BASE_URL}/catalogo-productos/opciones`, { headers: headers() })).json();
    assert.ok(r.negocio && "nombre" in r.negocio && "logo" in r.negocio && "contacto" in r.negocio);
    assert.ok(["moderna", "clasica", "maquina"].every(id => r.fuentes.some(f => f.id === id)));
});
