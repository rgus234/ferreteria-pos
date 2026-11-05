// Paquete de frutas y verduras: el alta que hace la pantalla deja un producto por kilo, con su codigo propio, y la foto se guarda.
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { pool, crearNegocioPrueba, borrarNegocioPrueba } = require("./helpers/negocio-prueba");
const { iniciarServidorPrueba, detenerServidorPrueba, BASE_URL } = require("./helpers/servidor-prueba");

let negocio;
const indice = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "public", "banco-genericas", "indice.json"), "utf8"));
const llamar = async (ruta, cuerpo) => {
    const r = await fetch(`${BASE_URL}${ruta}`, { method: "POST", headers: { "Content-Type": "application/json", "x-dispositivo-token": negocio.token }, body: JSON.stringify(cuerpo) });
    return { status: r.status, cuerpo: await r.json().catch(() => ({})) };
};

before(async () => { await iniciarServidorPrueba(); negocio = await crearNegocioPrueba("frutas-verduras"); });
after(async () => { if (negocio) await borrarNegocioPrueba(negocio.negocioId); await detenerServidorPrueba(); await pool.end(); });

test("la lista trae frutas y verduras con foto, cada una con su archivo", () => {
    const frutas = indice.conceptos.filter(c => c.categoria === "Frutas").length;
    const verduras = indice.conceptos.filter(c => c.categoria === "Verduras").length;
    assert.ok(frutas >= 30 && verduras >= 30, `frutas ${frutas}, verduras ${verduras}`);
    for (const c of indice.conceptos) assert.ok(fs.existsSync(path.join(__dirname, "..", "public", "banco-genericas", c.archivo)), c.archivo);
});

test("el alta de la pantalla crea un producto por kilo con su codigo, y la foto se guarda con ese codigo", async () => {
    const aguacate = indice.conceptos.find(c => c.slug === "aguacate");
    const codigo = "FV" + aguacate.slug.replace(/[^a-z0-9]/gi, "").toUpperCase();

    const alta = await llamar("/agregar-producto", {
        nombre: aguacate.nombre, codigo, precio: 78, precioPublico: 78, precioMayoreo: 78, stock: 0, stockMinimo: 0,
        categoria: "Frutas y verduras", subcategoria: "Frutas", unidadVenta: "kg", tipoProducto: "granel", basculaDigital: false, permiteVentaPieza: false, visiblePos: true
    });
    assert.ok(alta.status === 200 || alta.status === 201, JSON.stringify(alta.cuerpo));

    const fila = (await pool.query(`SELECT nombre, codigo, unidad_venta, tipo_producto, categoria, precio, stock FROM public.productos WHERE negocio_id = $1 AND codigo = $2`, [negocio.negocioId, codigo])).rows[0];
    assert.ok(fila, "el producto existe");
    assert.equal(fila.unidad_venta, "kg");
    assert.equal(fila.tipo_producto, "granel");
    assert.equal(fila.categoria, "Frutas y verduras");
    assert.equal(Number(fila.precio), 78);
    assert.equal(Number(fila.stock), 0);

    // la foto: igual que la manda la pantalla (imagen en base64)
    const jpg = fs.readFileSync(path.join(__dirname, "..", "public", "banco-genericas", aguacate.archivo));
    const foto = await llamar(`/fotos-producto/${codigo}/principal`, { imagenBase64: "data:image/jpeg;base64," + jpg.toString("base64") });
    assert.equal(foto.status, 200, JSON.stringify(foto.cuerpo));
    assert.equal(Number((await pool.query(`SELECT COUNT(*) AS n FROM public.fotos_producto WHERE negocio_id = $1`, [negocio.negocioId])).rows[0].n), 1);
});

test("frutas y verduras: se elige kilo o pieza, dura N dias (vida util) y hay tarjeta visible en Agregar producto y en el menu", () => {
    const fs2 = require("node:fs");
    const js = fs2.readFileSync(path.join(__dirname, "..", "public", "js", "frutas-verduras-view.js"), "utf8");
    assert.match(js, /unidadVenta: f\.unidad === "pieza" \? "pieza" : "kg"/);
    assert.match(js, /vidaUtilDias: Number\(f\.vida\) >= 1/);
    assert.match(js, /SUELE_SER_PIEZA/);
    const html = fs2.readFileSync(path.join(__dirname, "..", "public", "index.html"), "utf8");
    assert.match(html, /tipo-frutas" onclick="abrirPaqueteFrutasVerduras\(\)"/);
    assert.match(fs2.readFileSync(path.join(__dirname, "..", "public", "js", "menu-simple.js"), "utf8"), /modulo: "frutas-y-verduras"/);
});

test("con cantidad: 20 kg por kilo y 20 piezas se guardan como existencia, y con 'dura N dias' nace un lote con su caducidad", async () => {
    const casos = [
        { slug: "limon", unidad: "kg", tipo: "granel", cantidad: 20 },
        { slug: "lechuga", unidad: "pieza", tipo: "manual", cantidad: 20 }
    ];

    for (const caso of casos) {
        const c = indice.conceptos.find(x => x.slug === caso.slug);
        assert.ok(c, caso.slug);
        const codigo = "FV" + c.slug.replace(/[^a-z0-9]/gi, "").toUpperCase();

        const alta = await llamar("/agregar-producto", {
            nombre: c.nombre, codigo, precio: 30, precioPublico: 30, precioMayoreo: 30, stock: caso.cantidad, stockMinimo: 0,
            categoria: "Frutas y verduras", subcategoria: c.categoria, unidadVenta: caso.unidad, tipoProducto: caso.tipo,
            basculaDigital: false, permiteVentaPieza: false, visiblePos: true, vidaUtilDias: 5
        });
        assert.ok(alta.status === 200 || alta.status === 201, JSON.stringify(alta.cuerpo));

        const fila = (await pool.query(`SELECT id, unidad_venta, stock, vida_util_dias FROM public.productos WHERE negocio_id = $1 AND codigo = $2`, [negocio.negocioId, codigo])).rows[0];
        assert.equal(fila.unidad_venta, caso.unidad);
        assert.equal(Number(fila.stock), caso.cantidad);
        assert.equal(fila.vida_util_dias, 5);

        const lote = (await pool.query(`SELECT cantidad, fecha_entrada, fecha_caducidad FROM public.producto_lotes WHERE negocio_id = $1 AND producto_id = $2`, [negocio.negocioId, fila.id])).rows;
        assert.equal(lote.length, 1, "un lote con la cantidad que llego");
        assert.equal(Number(lote[0].cantidad), caso.cantidad);
        const dias = Math.round((new Date(lote[0].fecha_caducidad) - new Date(lote[0].fecha_entrada)) / 86400000);
        assert.equal(dias, 5, "caduca a los 5 dias de entrar");
    }
});

test("la lista pide 'Tengo' (cuantos kilos o piezas) y lo manda como existencia", () => {
    const js = fs.readFileSync(path.join(__dirname, "..", "public", "js", "frutas-verduras-view.js"), "utf8");
    assert.match(js, /stock: Number\(f\.cantidad\) > 0 \? Number\(f\.cantidad\) : 0/);
    assert.match(js, /class="fv-tengo"/);
});

test("el banco trae frutas, verduras, hierbas, especias y frutos secos, cada una con su foto, y la pantalla tiene su grupo de Especias", () => {
    const fs = require("node:fs");
    const path = require("node:path");
    const raiz = path.join(__dirname, "..", "public", "banco-genericas");
    const indice = JSON.parse(fs.readFileSync(path.join(raiz, "indice.json"), "utf8"));
    const categorias = new Set(indice.conceptos.map(c => c.categoria));

    for (const categoria of ["Frutas", "Verduras", "Hierbas", "Especias", "Frutos secos"]) assert.ok(categorias.has(categoria), `falta la categoria ${categoria}`);
    assert.ok(indice.conceptos.length >= 130, `solo ${indice.conceptos.length} conceptos`);
    assert.equal(new Set(indice.conceptos.map(c => c.slug)).size, indice.conceptos.length, "slugs repetidos");

    for (const c of indice.conceptos) {
        assert.ok(fs.existsSync(path.join(raiz, c.archivo)), `${c.slug}: falta la foto ${c.archivo}`);
        assert.ok(Array.isArray(c.alias) && c.alias.length, `${c.slug}: sin alias para buscarlo`);
    }

    // Lo que no puede faltar en un abarrotes de Mexico
    for (const slug of ["canela", "pimienta-negra", "comino", "chile-guajillo", "chile-ancho", "chile-de-arbol", "chile-chipotle", "oregano", "laurel", "jamaica", "ajonjoli", "pepita", "pasas", "mamey", "tejocote", "jicama", "chile-poblano", "chile-pasilla", "berro", "verdolaga", "menta"]) {
        assert.ok(indice.conceptos.some(c => c.slug === slug), `falta ${slug}`);
    }

    const vista = fs.readFileSync(path.join(__dirname, "..", "public", "js", "frutas-verduras-view.js"), "utf8");
    assert.match(vista, /\["Especias", "Especias y chiles"\]/);
    assert.match(vista, /c\.categoria === "Especias" \? 180/, "las especias duran meses");
});
