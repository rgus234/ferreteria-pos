// Exhibidores (displays con tarjetas visuales).
//
// Lo que se protege:
//  - un negocio solo ve y toca SUS exhibidores, y nunca puede meter en ellos un
//    producto de otro negocio;
//  - un producto aparece una sola vez por exhibidor (409 al repetirlo);
//  - los espacios resuelven nombre/precio/existencia EN VIVO contra productos y
//    "faltan" = capacidad - existencia (incluyendo la fraccion de stock_resto);
//  - borrar un exhibidor NO toca los productos ni su inventario.

const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { pool, crearNegocioPrueba, crearProductoPrueba, borrarNegocioPrueba } = require("./helpers/negocio-prueba");
const { iniciarServidorPrueba, detenerServidorPrueba, BASE_URL } = require("./helpers/servidor-prueba");

let negocioA;
let negocioB;
let broca;
let lija;
let productoAjeno;

function headers(negocio) {
    return { "Content-Type": "application/json", "x-dispositivo-token": negocio.token };
}

async function llamar(negocio, ruta, opciones = {}) {
    const respuesta = await fetch(`${BASE_URL}${ruta}`, { ...opciones, headers: headers(negocio) });
    return { status: respuesta.status, cuerpo: await respuesta.json() };
}

before(async () => {
    await iniciarServidorPrueba();
    negocioA = await crearNegocioPrueba("exhibidores-a");
    negocioB = await crearNegocioPrueba("exhibidores-b");
    broca = await crearProductoPrueba(negocioA.negocioId, { nombre: "Broca 1/4 de prueba", precio: 35, stock: 4 });
    lija = await crearProductoPrueba(negocioA.negocioId, { nombre: "Lija 120 de prueba", precio: 12, stock: 0 });
    productoAjeno = await crearProductoPrueba(negocioB.negocioId, { nombre: "Producto de otro negocio", precio: 99, stock: 5 });
});

after(async () => {
    if (negocioA) {
        // Crear un producto desde el catalogo aporta su identidad al Catalogo Maestro
        // (contribuido_por_negocio_id): hay que soltarla antes de borrar el negocio.
        await pool.query(`UPDATE public.productos SET catalogo_maestro_id = NULL WHERE negocio_id = $1`, [negocioA.negocioId]);
        await pool.query(`DELETE FROM public.catalogo_maestro_productos WHERE contribuido_por_negocio_id = $1`, [negocioA.negocioId]);
        await borrarNegocioPrueba(negocioA.negocioId);
    }
    if (negocioB) await borrarNegocioPrueba(negocioB.negocioId);
    await detenerServidorPrueba();
    await pool.end();
});

test("crear un exhibidor con espacios y leerlo con datos en vivo", async () => {
    const { status, cuerpo } = await llamar(negocioA, "/exhibidores", {
        method: "POST",
        body: JSON.stringify({
            nombre: "  Despachador de brocas  ",
            color: "naranja",
            espacios: [
                { productoId: broca.id, etiqueta: "Cajon 1", capacidad: 10 },
                { productoId: lija.id, capacidad: 5 }
            ]
        })
    });

    assert.equal(status, 201);
    assert.equal(cuerpo.exhibidor.nombre, "Despachador de brocas");
    assert.equal(cuerpo.exhibidor.color, "naranja");
    assert.equal(cuerpo.exhibidor.espacios.length, 2);

    const [espacioBroca, espacioLija] = cuerpo.exhibidor.espacios;
    assert.equal(espacioBroca.nombre, "Broca 1/4 de prueba");
    assert.equal(espacioBroca.precio, 35);
    assert.equal(espacioBroca.existencia, 4);
    assert.equal(espacioBroca.faltan, 6, "capacidad 10 - existencia 4");
    assert.equal(espacioLija.existencia, 0);
    assert.equal(espacioLija.faltan, 5);

    global.__exhibidorId = cuerpo.exhibidor.id;
});

test("faltan toma en cuenta la fraccion de stock_resto", async () => {
    await pool.query(`UPDATE public.productos SET stock_resto = 0.5 WHERE id = $1`, [broca.id]);

    const { cuerpo } = await llamar(negocioA, `/exhibidores/${global.__exhibidorId}`);
    const espacio = cuerpo.exhibidor.espacios.find(e => e.productoId === broca.id);

    assert.equal(espacio.existencia, 4.5);
    assert.equal(espacio.faltan, 5.5);
});

test("el color invalido cae a azul y el nombre vacio se rechaza", async () => {
    const vacio = await llamar(negocioA, "/exhibidores", { method: "POST", body: JSON.stringify({ nombre: "   " }) });
    assert.equal(vacio.status, 400);

    const raro = await llamar(negocioA, "/exhibidores", { method: "POST", body: JSON.stringify({ nombre: "Color raro", color: "fucsia-neon" }) });
    assert.equal(raro.status, 201);
    assert.equal(raro.cuerpo.exhibidor.color, "azul");
});

test("un producto no se repite en el mismo exhibidor (409)", async () => {
    const { status } = await llamar(negocioA, `/exhibidores/${global.__exhibidorId}/espacios`, {
        method: "POST",
        body: JSON.stringify({ productoId: broca.id })
    });

    assert.equal(status, 409);
});

test("un producto de otro negocio nunca entra a mi exhibidor", async () => {
    const agregar = await llamar(negocioA, `/exhibidores/${global.__exhibidorId}/espacios`, {
        method: "POST",
        body: JSON.stringify({ productoId: productoAjeno.id })
    });
    assert.equal(agregar.status, 404);

    const alCrear = await llamar(negocioA, "/exhibidores", {
        method: "POST",
        body: JSON.stringify({ nombre: "Intento de colar", espacios: [{ productoId: productoAjeno.id }, { productoId: broca.id }] })
    });
    assert.equal(alCrear.status, 201);
    assert.equal(alCrear.cuerpo.exhibidor.espacios.length, 1, "solo entra el producto propio");
    assert.equal(alCrear.cuerpo.exhibidor.espacios[0].productoId, broca.id);
});

test("otro negocio no ve, edita ni borra mis exhibidores", async () => {
    const lista = await llamar(negocioB, "/exhibidores");
    assert.equal(lista.cuerpo.exhibidores.length, 0);

    const leer = await llamar(negocioB, `/exhibidores/${global.__exhibidorId}`);
    assert.equal(leer.status, 404);

    const editar = await llamar(negocioB, `/exhibidores/${global.__exhibidorId}`, { method: "PATCH", body: JSON.stringify({ nombre: "Hackeado" }) });
    assert.equal(editar.status, 404);

    const borrar = await llamar(negocioB, `/exhibidores/${global.__exhibidorId}`, { method: "DELETE" });
    assert.equal(borrar.status, 404);

    const intacto = await llamar(negocioA, `/exhibidores/${global.__exhibidorId}`);
    assert.equal(intacto.cuerpo.exhibidor.nombre, "Despachador de brocas");
});

test("el listado trae conteos, agotados y vista previa", async () => {
    const { cuerpo } = await llamar(negocioA, "/exhibidores");
    const despachador = cuerpo.exhibidores.find(item => item.id === global.__exhibidorId);

    assert.equal(despachador.totalEspacios, 2);
    assert.equal(despachador.agotados, 1, "la lija esta en 0");
    assert.deepEqual(despachador.vistaPrevia, [broca.id, lija.id]);
});

test("editar capacidad y lugar de un espacio, y quitarlo", async () => {
    const lectura = await llamar(negocioA, `/exhibidores/${global.__exhibidorId}`);
    const espacioLija = lectura.cuerpo.exhibidor.espacios.find(e => e.productoId === lija.id);

    const editado = await llamar(negocioA, `/exhibidores/${global.__exhibidorId}/espacios/${espacioLija.id}`, {
        method: "PATCH",
        body: JSON.stringify({ etiqueta: "Cajon 2", capacidad: 20 })
    });
    assert.equal(editado.status, 200);
    const cambiado = editado.cuerpo.exhibidor.espacios.find(e => e.productoId === lija.id);
    assert.equal(cambiado.etiqueta, "Cajon 2");
    assert.equal(cambiado.capacidad, 20);

    const quitado = await llamar(negocioA, `/exhibidores/${global.__exhibidorId}/espacios/${espacioLija.id}`, { method: "DELETE" });
    assert.equal(quitado.status, 200);
    assert.equal(quitado.cuerpo.exhibidor.espacios.length, 1);
});

test("borrar un exhibidor no toca los productos ni su inventario", async () => {
    const borrar = await llamar(negocioA, `/exhibidores/${global.__exhibidorId}`, { method: "DELETE" });
    assert.equal(borrar.status, 200);

    const producto = await pool.query(`SELECT stock FROM public.productos WHERE id = $1`, [broca.id]);
    assert.equal(producto.rows.length, 1, "el producto sigue existiendo");
    assert.equal(Number(producto.rows[0].stock), 4, "el inventario no cambio");

    const espacios = await pool.query(`SELECT 1 FROM public.exhibidor_espacios WHERE exhibidor_id = $1`, [global.__exhibidorId]);
    assert.equal(espacios.rows.length, 0, "sus espacios se borraron en cascada");
});

// ---------------------------------------------------------------------
// Buscar en el catalogo de proveedor para meter al exhibidor un producto
// que aun no esta en el inventario.
// ---------------------------------------------------------------------

let catalogoA;

async function filaCatalogo(negocio, catalogoId, { codigo, nombre, precioMedio = 0, precioPublico = 0, productoId = null }) {
    const r = await pool.query(
        `INSERT INTO public.catalogo_productos (negocio_id, catalogo_id, codigo_proveedor, codigo_interno, nombre_proveedor, marca, precio_medio_mayoreo, precio_publico, producto_id)
         VALUES ($1, $2, $3, $3, $4, 'Truper', $5, $6, $7) RETURNING id`,
        [negocio.negocioId, catalogoId, codigo, nombre, precioMedio, precioPublico, productoId]
    );
    return r.rows[0].id;
}

test("buscar en catalogo: por codigo exacto y por nombre, con el codigo primero", async () => {
    const catalogo = await pool.query(
        `INSERT INTO public.catalogos_proveedor (negocio_id, proveedor, total_productos) VALUES ($1, 'Diprofer de prueba', 3) RETURNING id`,
        [negocioA.negocioId]
    );
    catalogoA = catalogo.rows[0].id;

    await filaCatalogo(negocioA, catalogoA, { codigo: "11110", nombre: "Broca HSS 1/16 Trugold para metal", precioMedio: 18 });
    await filaCatalogo(negocioA, catalogoA, { codigo: "11111", nombre: "Broca HSS 1/8 Trugold para metal", precioMedio: 22 });

    const porCodigo = await llamar(negocioA, "/exhibidores/buscar-catalogo?q=11110");
    assert.equal(porCodigo.status, 200);
    assert.equal(porCodigo.cuerpo.resultados.length, 1);
    assert.equal(porCodigo.cuerpo.resultados[0].codigo, "11110");
    assert.equal(porCodigo.cuerpo.resultados[0].precio, 18);
    assert.equal(porCodigo.cuerpo.resultados[0].productoId, null, "aun no esta en el inventario");
    assert.equal(porCodigo.cuerpo.resultados[0].proveedor, "Diprofer de prueba");

    const porInicio = await llamar(negocioA, "/exhibidores/buscar-catalogo?q=1111");
    assert.equal(porInicio.cuerpo.resultados.length, 2, "al teclear parte del codigo ya aparecen las coincidencias");

    const porNombre = await llamar(negocioA, "/exhibidores/buscar-catalogo?q=broca%20trugold");
    assert.equal(porNombre.cuerpo.resultados.length, 2);

    const corta = await llamar(negocioA, "/exhibidores/buscar-catalogo?q=b");
    assert.deepEqual(corta.cuerpo.resultados, []);
});

test("buscar en catalogo: una fila sin ningun precio no se ofrece", async () => {
    await filaCatalogo(negocioA, catalogoA, { codigo: "99999", nombre: "Broca fantasma sin precio" });

    const { cuerpo } = await llamar(negocioA, "/exhibidores/buscar-catalogo?q=fantasma");
    assert.equal(cuerpo.resultados.length, 0);
});

test("buscar en catalogo: si ya esta en el inventario devuelve su productoId", async () => {
    const yaEnInventario = await crearProductoPrueba(negocioA.negocioId, { nombre: "Broca 3/16 ya en inventario", precio: 26, stock: 3, codigo: "11112" });
    await filaCatalogo(negocioA, catalogoA, { codigo: "11112", nombre: "Broca HSS 3/16 Trugold para metal", precioMedio: 26 });

    const { cuerpo } = await llamar(negocioA, "/exhibidores/buscar-catalogo?q=11112");
    assert.equal(cuerpo.resultados[0].productoId, yaEnInventario.id);
});

test("buscar en catalogo: nunca se ve el catalogo de otro negocio", async () => {
    const catalogoB = await pool.query(
        `INSERT INTO public.catalogos_proveedor (negocio_id, proveedor, total_productos) VALUES ($1, 'Proveedor de B', 1) RETURNING id`,
        [negocioB.negocioId]
    );
    await filaCatalogo(negocioB, catalogoB.rows[0].id, { codigo: "77777", nombre: "Producto secreto de B", precioPublico: 50 });

    const { cuerpo } = await llamar(negocioA, "/exhibidores/buscar-catalogo?q=77777");
    assert.equal(cuerpo.resultados.length, 0);

    const propio = await llamar(negocioB, "/exhibidores/buscar-catalogo?q=77777");
    assert.equal(propio.cuerpo.resultados.length, 1);
});

test("flujo completo: crear el producto desde el catalogo y meterlo al exhibidor", async () => {
    const exhibidor = await llamar(negocioA, "/exhibidores", { method: "POST", body: JSON.stringify({ nombre: "Exhibidor desde catalogo" }) });
    const id = exhibidor.cuerpo.exhibidor.id;

    const busqueda = await llamar(negocioA, "/exhibidores/buscar-catalogo?q=11111");
    const fila = busqueda.cuerpo.resultados[0];
    assert.equal(fila.productoId, null);

    const creado = await llamar(negocioA, `/catalogo-proveedor/${fila.catalogoId}/productos/${fila.catalogoProductoId}/crear-producto`, { method: "POST" });
    assert.equal(creado.status, 200);
    assert.ok(creado.cuerpo.productoId);

    const agregado = await llamar(negocioA, `/exhibidores/${id}/espacios`, { method: "POST", body: JSON.stringify({ productoId: creado.cuerpo.productoId }) });
    assert.equal(agregado.status, 200);
    assert.equal(agregado.cuerpo.exhibidor.espacios[0].nombre, "Broca HSS 1/8 Trugold para metal");
    assert.equal(agregado.cuerpo.exhibidor.espacios[0].existencia, 0, "nace con existencia 0");

    const ahora = await llamar(negocioA, "/exhibidores/buscar-catalogo?q=11111");
    assert.ok(ahora.cuerpo.resultados[0].productoId, "ahora el catalogo lo reconoce como producto del inventario");
});

// ---------------------------------------------------------------------
// Recibir por exhibidor y Surtir: la pantalla manda las lineas a la recepcion
// rapida ya existente (no hay logica de inventario nueva) y lee "faltan".
// ---------------------------------------------------------------------

test("recibir por exhibidor: suma al inventario, deja historial y 'faltan' baja", async () => {
    const p1 = await crearProductoPrueba(negocioA.negocioId, { nombre: "Lija 80 de exhibidor", precio: 10, stock: 2 });
    const p2 = await crearProductoPrueba(negocioA.negocioId, { nombre: "Lija 150 de exhibidor", precio: 12, stock: 0 });

    const exhibidor = await llamar(negocioA, "/exhibidores", {
        method: "POST",
        body: JSON.stringify({ nombre: "Exhibidor de lijas", espacios: [{ productoId: p1.id, capacidad: 10 }, { productoId: p2.id, capacidad: 5 }] })
    });
    const id = exhibidor.cuerpo.exhibidor.id;
    assert.deepEqual(exhibidor.cuerpo.exhibidor.espacios.map(e => e.faltan), [8, 5]);

    const recibido = await llamar(negocioA, "/recepciones-mercancia/rapida", {
        method: "POST",
        body: JSON.stringify({
            referencia: "REM-1",
            notas: 'Recibido desde el exhibidor "Exhibidor de lijas"',
            idempotencyKey: "exh-recibir-1",
            items: [{ productoId: p1.id, cantidad: 8, costo: 6.5 }, { productoId: p2.id, cantidad: 5, costo: 0 }]
        })
    });
    assert.equal(recibido.status, 201, JSON.stringify(recibido.cuerpo));

    const stock = await pool.query(`SELECT id, stock, costo FROM public.productos WHERE id = ANY($1::int[]) ORDER BY id`, [[p1.id, p2.id]]);
    assert.equal(Number(stock.rows[0].stock), 10);
    assert.equal(Number(stock.rows[0].costo), 6.5, "el costo capturado se guarda");
    assert.equal(Number(stock.rows[1].stock), 5);

    const ajustes = await pool.query(`SELECT COUNT(*)::int n FROM public.ajustes_inventario WHERE negocio_id = $1 AND referencia = 'REM-1'`, [negocioA.negocioId]);
    assert.equal(ajustes.rows[0].n, 2, "queda un ajuste de inventario por producto");

    const despues = await llamar(negocioA, `/exhibidores/${id}`);
    assert.deepEqual(despues.cuerpo.exhibidor.espacios.map(e => e.faltan), [0, 0], "el exhibidor quedo lleno");

    // Mandar lo mismo dos veces (doble clic, mala conexion) no suma dos veces.
    const repetido = await llamar(negocioA, "/recepciones-mercancia/rapida", {
        method: "POST",
        body: JSON.stringify({ idempotencyKey: "exh-recibir-1", items: [{ productoId: p1.id, cantidad: 8, costo: 6.5 }] })
    });
    assert.equal(repetido.cuerpo.repetida, true);

    const intacto = await pool.query(`SELECT stock FROM public.productos WHERE id = $1`, [p1.id]);
    assert.equal(Number(intacto.rows[0].stock), 10);
});

test("surtir: el pedido a proveedor se crea en borrador", async () => {
    const p = await crearProductoPrueba(negocioA.negocioId, { nombre: "Lija 220 por surtir", precio: 9, stock: 1 });

    const pedido = await llamar(negocioA, "/pedidos-proveedor", {
        method: "POST",
        body: JSON.stringify({
            proveedor: "Diprofer",
            estado: "borrador",
            notas: 'Para surtir el exhibidor "Exhibidor de lijas"',
            items: [{ productoId: p.id, codigo: "LIJA-220", nombre: "Lija 220 por surtir", proveedor: "Diprofer", cantidad: 4, costo: 5, unidad: "pieza" }]
        })
    });

    assert.equal(pedido.status, 200, JSON.stringify(pedido.cuerpo));
    assert.equal(pedido.cuerpo.pedido.estado, "borrador");
});

test("el exhibidor del punto de venta se maneja con teclado: flechas para moverse, arriba/abajo la cantidad y Enter al carrito", () => {
    const fs = require("node:fs");
    const path = require("node:path");
    const js = fs.readFileSync(path.join(__dirname, "..", "public", "js", "exhibidores.js"), "utf8");
    const css = fs.readFileSync(path.join(__dirname, "..", "public", "css", "components", "exhibidores.css"), "utf8");

    assert.match(js, /case "ArrowRight": exhTileActivo\+\+/);
    assert.match(js, /case "ArrowLeft": exhTileActivo--/);
    assert.match(js, /case "ArrowUp": if \(id\) exhCambiarPendiente\(id, 1\)/);
    assert.match(js, /case "ArrowDown": if \(id\) exhCambiarPendiente\(id, -1\)/);
    assert.match(js, /case "Enter": if \(id\) exhConfirmarTile\(id\)/);
    assert.match(js, /exhPendientes\[productoId\] \|\| 1/, "Enter sin cantidad elegida agrega una pieza");
    assert.match(js, /evento\.target\.id === "exhFiltroPOS"/, "en el buscador las flechas siguen siendo del cursor");

    // El texto de las tarjetas ya no hereda un color oscuro.
    assert.match(css, /\.exh-card \.exh-card-banda span \{[^}]*color: #fff/);
    assert.match(css, /\.exh-tile-activa/);
});

test("vender, recibir y surtir cambian solo lo que cambio (sin volver a dibujar las fotos) y los titulos se leen", () => {
    const fs = require("node:fs");
    const path = require("node:path");
    const js = fs.readFileSync(path.join(__dirname, "..", "public", "js", "exhibidores.js"), "utf8");
    const css = fs.readFileSync(path.join(__dirname, "..", "public", "css", "components", "exhibidores.css"), "utf8");

    // Cada toque actualiza su tarjeta; ya no hay redibujado completo en esos caminos.
    assert.match(js, /function exhActualizarTilePOS/);
    assert.match(js, /function exhRecibirPintar/);
    assert.doesNotMatch(js, /exhibidorPOSAgregados\+\+;\s*\n\s*const filtro/, "agregar ya no vuelve a dibujar toda la ventana");

    const cuerpo = nombre => js.slice(js.indexOf(`function ${nombre}(`), js.indexOf(`function ${nombre}(`) + 600);
    assert.doesNotMatch(cuerpo("exhRecibirCambiar"), /renderRecibirExhibidor\(\)/);
    assert.doesNotMatch(cuerpo("exhRecibirFijar"), /renderRecibirExhibidor\(\)/);
    assert.doesNotMatch(cuerpo("exhSurtirCantidad"), /renderSurtirExhibidor\(\)/);

    // El tema global fuerza los h3 en oscuro con !important: el titulo de la cabecera de color tambien lo lleva.
    assert.match(css, /\.exh-modal-cabecera-color h3,\s*\n\.exh-modal-cabecera-color span \{ color: #fff !important; \}/);
});

test("el editor de exhibidores cambia solo lo que cambio: agregar, editar, quitar, renombrar y color ya no redibujan la pantalla", () => {
    const fs = require("node:fs");
    const path = require("node:path");
    const js = fs.readFileSync(path.join(__dirname, "..", "public", "js", "exhibidores.js"), "utf8");

    assert.match(js, /function exhEditorActualizar\(nuevo\)/);
    assert.match(js, /function exhEspacioHtml\(e\)/);
    assert.match(js, /data-espacio-id="\$\{e\.id\}"/, "cada tarjeta se identifica para actualizarla por separado");

    // Ninguna de las acciones del editor vuelve a llamar al dibujo completo.
    for (const nombre of ["agregarProductoAExhibidor", "guardarEspacioExhibidor", "quitarEspacioExhibidor", "guardarDatosExhibidor", "cambiarColorExhibidor"]) {
        const inicio = js.indexOf(`async function ${nombre}(`);
        const cuerpo = js.slice(inicio, js.indexOf("\n}\n", inicio));

        assert.match(cuerpo, /exhEditorActualizar\(/, `${nombre} debe actualizar por partes`);
        assert.doesNotMatch(cuerpo, /renderEditorExhibidor\(\)/, `${nombre} ya no debe redibujar todo`);
    }

    // Lo que se esta escribiendo no se pisa.
    assert.match(js, /campoNombre !== enfocado/);
    assert.match(js, /lugar !== enfocado/);
});

test("exhibidores: foto del exhibidor, agregar varios de una vez, plantillas de ferreteria y agregar todo al carrito", () => {
    const fs = require("node:fs");
    const path = require("node:path");
    const leer = ruta => fs.readFileSync(path.join(__dirname, "..", ruta), "utf8");
    const js = leer("public/js/exhibidores.js");
    const servidor = leer("exhibidores-server.js");

    assert.match(servidor, /app\.put\("\/exhibidores\/:id\/foto"/);
    assert.match(servidor, /app\.delete\("\/exhibidores\/:id\/foto"/);
    assert.match(servidor, /width: 480, height: 480/, "la foto se reduce en el servidor");
    assert.match(servidor, /WHERE id = \$2 AND negocio_id = \$3/, "solo el negocio dueno cambia la foto");
    assert.match(js, /function exhSubirFoto/);
    assert.match(js, /function agregarTodosAExhibidor/);
    assert.match(js, /EXH_MAXIMO_DE_UNA_VEZ = 60/);
    assert.match(js, /EXHIBIDORES_PLANTILLAS_FERRETERIA/);
    assert.match(js, /\{ nombre: "Despachador de brocas", buscar: "broca" \}/);
    assert.match(js, /function exhAgregarTodoPOS/);
    assert.match(js, /Number\(local\.stock\) > 0/, "solo agrega lo que tiene existencia");
});

test("la foto del exhibidor se reduce, solo la cambia su negocio y se puede quitar (requiere la migracion 20261031_exhibidores_foto.sql)", async () => {
    const sharp = require("sharp");
    const grande = await sharp({ create: { width: 1600, height: 1200, channels: 3, background: { r: 200, g: 40, b: 40 } } }).jpeg().toBuffer();
    const imagenBase64 = `data:image/jpeg;base64,${grande.toString("base64")}`;

    const creado = await llamar(negocioA, "/exhibidores", { method: "POST", body: JSON.stringify({ nombre: "Con foto", color: "azul" }) });
    const id = creado.cuerpo.exhibidor.id;

    const subida = await llamar(negocioA, `/exhibidores/${id}/foto`, { method: "PUT", body: JSON.stringify({ imagenBase64 }) });
    assert.equal(subida.status, 200);
    assert.match(subida.cuerpo.exhibidor.foto, /^data:image\/jpeg;base64,/);

    // Se reduce: la imagen guardada cabe en 480 px y pesa muy poco.
    const guardada = Buffer.from(subida.cuerpo.exhibidor.foto.split(",")[1], "base64");
    const medidas = await sharp(guardada).metadata();
    assert.ok(Math.max(medidas.width, medidas.height) <= 480);
    assert.ok(guardada.length < 60000);

    // Sale en la lista, y otro negocio no puede cambiarla ni quitarla.
    const lista = await llamar(negocioA, "/exhibidores");
    assert.ok(lista.cuerpo.exhibidores.find(x => x.id === id).foto);
    assert.equal((await llamar(negocioB, `/exhibidores/${id}/foto`, { method: "PUT", body: JSON.stringify({ imagenBase64 }) })).status, 404);
    assert.equal((await llamar(negocioB, `/exhibidores/${id}/foto`, { method: "DELETE" })).status, 404);

    // Una foto que no es imagen se rechaza sin tumbar nada.
    assert.equal((await llamar(negocioA, `/exhibidores/${id}/foto`, { method: "PUT", body: JSON.stringify({ imagenBase64: "bm8gZXMgdW5hIGZvdG8=" }) })).status, 400);

    const quitada = await llamar(negocioA, `/exhibidores/${id}/foto`, { method: "DELETE" });
    assert.equal(quitada.cuerpo.exhibidor.foto, null);
});

test("exhibidor en el POS: un solo flujo para mouse y teclado, Enter dos veces cierra y Agregar todo se puede deshacer", () => {
    const fs = require("node:fs");
    const path = require("node:path");
    const js = fs.readFileSync(path.join(__dirname, "..", "public", "js", "exhibidores.js"), "utf8");

    assert.match(js, /function exhTocarTile/);
    assert.match(js, /onclick="exhTocarTile\(/, "tocar una tarjeta usa la misma tarjeta marcada que el teclado");
    assert.match(js, /exhUltimoEnter === productoId && !exhPendientes\[productoId\]/, "segundo Enter sin cantidad nueva cierra");
    assert.match(js, /function exhDeshacerTodoPOS/);
    assert.match(js, /exhTodoAgregado/);
});

test("exhibidor en el POS: la flecha de abajo, sin cantidad nueva, quita del carrito lo ya agregado", () => {
    const fs = require("node:fs");
    const path = require("node:path");
    const js = fs.readFileSync(path.join(__dirname, "..", "public", "js", "exhibidores.js"), "utf8");

    assert.match(js, /function exhQuitarUnoDelCarrito/);
    assert.match(js, /delta < 0 && !exhPendientes\[productoId\] && exhCantidadEnCarrito\(productoId\) > 0/);
});
