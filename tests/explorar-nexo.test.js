// Explorar Nexo (Fase 1): busqueda estructurada por trigrama sobre
// las 4 fuentes de catalogo. Dos de ellas viven aisladas por negocio
// sintetico (inventario, catalogo de proveedor); las otras dos
// (Catalogo Maestro, catalogo de fabricante) son globales -- se
// insertan filas sinteticas con codigos imposibles de confundir con
// datos reales y se borran por id al terminar, nunca por negocio_id.
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { pool, crearNegocioPrueba, borrarNegocioPrueba, crearProductoPrueba } = require("./helpers/negocio-prueba");
const { iniciarServidorPrueba, detenerServidorPrueba, BASE_URL } = require("./helpers/servidor-prueba");
const { normalizarBusqueda, nivelDeCoincidencia, buscarExplorarNexo, resolverFotoPrincipal } = require("../explorar-nexo-server");

let negocio;
const maestroIdsCreados = [];
const fabricanteIdsCreados = [];
const codigosBancoImagenesCreados = [];

function headers() {
    return {
        "Content-Type": "application/json",
        "x-dispositivo-token": negocio.token
    };
}

async function crearMaestroPrueba({ codigo, nombre, descripcion = "" }) {
    const fila = await pool.query(
        `INSERT INTO public.catalogo_maestro_productos (codigo, marca, nombre, descripcion, fabricante, codigo_fabricante)
         VALUES ($1, 'MARCA-PRUEBA', $2, $3, 'FABRICANTE-PRUEBA', $1) RETURNING id`,
        [codigo, nombre, descripcion]
    );
    maestroIdsCreados.push(fila.rows[0].id);
    return fila.rows[0].id;
}

async function crearFabricantePrueba({ codigo, descripcion, precioPublico = 100 }) {
    const fila = await pool.query(
        `INSERT INTO public.catalogo_fabricante_productos (fabricante, codigo, descripcion, marca, precio_publico)
         VALUES ('FABRICANTE-PRUEBA', $1, $2, 'MARCA-PRUEBA', $3) RETURNING id`,
        [codigo, descripcion, precioPublico]
    );
    fabricanteIdsCreados.push(fila.rows[0].id);
    return fila.rows[0].id;
}

before(async () => {
    await iniciarServidorPrueba();
    negocio = await crearNegocioPrueba("explorar-nexo");
});

after(async () => {
    if (negocio) {
        await borrarNegocioPrueba(negocio.negocioId);
    }
    for (const id of fabricanteIdsCreados) {
        await pool.query(`DELETE FROM public.catalogo_fabricante_productos WHERE id = $1`, [id]);
    }
    for (const id of maestroIdsCreados) {
        await pool.query(`DELETE FROM public.catalogo_maestro_identificadores WHERE producto_maestro_id = $1`, [id]);
        await pool.query(`DELETE FROM public.catalogo_maestro_productos WHERE id = $1`, [id]);
    }
    for (const codigo of codigosBancoImagenesCreados) {
        await pool.query(`DELETE FROM public.banco_imagenes_producto WHERE codigo = $1`, [codigo]);
    }
    await detenerServidorPrueba();
    await pool.end();
});

test("normalizarBusqueda quita acentos, minusculas y espacios sobrantes", () => {
    assert.equal(normalizarBusqueda("  SUMÉRGIBLE Pinza  "), "sumergible pinza");
    assert.equal(normalizarBusqueda("Pinza Cortacables"), "pinza cortacables");
    assert.equal(normalizarBusqueda(""), "");
    assert.equal(normalizarBusqueda(null), "");
});

test("nivelDeCoincidencia nunca llama 'exacta' a un numero de similitud -- son 3 niveles honestos", () => {
    assert.equal(nivelDeCoincidencia(0.9), "fuerte");
    assert.equal(nivelDeCoincidencia(0.55), "fuerte");
    assert.equal(nivelDeCoincidencia(0.54), "probable");
    assert.equal(nivelDeCoincidencia(0.30), "probable");
    assert.equal(nivelDeCoincidencia(0.29), "relacionado");
    assert.equal(nivelDeCoincidencia(0), "relacionado");
});

test("fuente inventario: encuentra un producto propio por intencion, aislado por negocio", async () => {
    await crearProductoPrueba(negocio.negocioId, { nombre: "Pinza cortacables de alta palanca 24 pulgadas", codigo: "EXP-INV-1", precio: 385 });

    const resultado = await buscarExplorarNexo(pool, negocio.negocioId, "pinza cortacables alta palanca");

    assert.ok(resultado.inventario.length >= 1, "debe encontrar el producto propio");
    const hallazgo = resultado.inventario.find(p => p.codigo === "EXP-INV-1");
    assert.ok(hallazgo, "el producto sembrado debe aparecer entre los resultados de inventario");
    assert.equal(hallazgo.fuente, "inventario");
    assert.ok(hallazgo.similitud > 0);
    assert.ok(["fuerte", "probable", "relacionado"].includes(hallazgo.nivel));
});

// Hallazgo real con el ejemplo central del mensaje original del
// dueno: similarity() PURO no basta para cerrar la brecha entre una
// frase coloquial y el nombre tecnico del producto -- similarity real
// medida: 0.2586, por debajo del piso de 0.30 que impone el operador
// "%". Root-cause real: similarity() compara la cadena COMPLETA, y
// una frase de cliente ("pinza para cortar cable grueso") trae
// palabras (para, cortar, grueso) que no estan en el nombre tecnico
// ("Pinza cortacables de alta palanca 24 pulgadas"), diluyendo el
// puntaje aunque "pinza"/"cable" si coincidan. word_similarity() SI
// esta disenado para esto (palabra o frase corta dentro de un nombre
// mas largo) -- agregado en explorar-nexo-server.js via
// GREATEST(similarity(...), word_similarity(...)), confirmado real:
// 0.4516, nivel "probable". Sigue sin ser magia (no es sinonimos, es
// solapamiento de palabras) -- la siguiente prueba confirma que una
// reformulacion sin ninguna palabra en comun SIGUE sin encontrar
// nada, que es exactamente el hueco real que le toca a la Fase 2/IA
// (o a un diccionario de sinonimos coloquiales, ver conversacion con
// el dueno 2026-09-10).
test("word_similarity ya rescata una frase coloquial que comparte palabras con el nombre tecnico", async () => {
    await crearProductoPrueba(negocio.negocioId, { nombre: "Pinza cortacables de alta palanca 24 pulgadas", codigo: "EXP-INV-COLOQUIAL", precio: 385 });

    const similitudReal = await pool.query(
        `SELECT similarity('Pinza cortacables de alta palanca 24 pulgadas', 'pinza para cortar cable grueso') AS sim`
    );
    assert.ok(Number(similitudReal.rows[0].sim) < 0.30, "similarity() puro por si solo sigue cayendo por debajo del piso de pg_trgm -- confirma por que hacia falta el respaldo");

    const resultado = await buscarExplorarNexo(pool, negocio.negocioId, "pinza para cortar cable grueso");
    const hallazgo = resultado.inventario.find(p => p.codigo === "EXP-INV-COLOQUIAL");
    assert.ok(hallazgo, "word_similarity debe rescatar esta frase coloquial (comparte 'pinza'/'cable' con el nombre tecnico)");
    assert.equal(hallazgo.nivel, "probable", "honesto: coincidencia probable, nunca se presenta como exacta");
});

// El hueco real que queda: una reformulacion SIN ninguna palabra en
// comun con el nombre tecnico (sinonimo puro, no solapamiento de
// texto) sigue sin encontrar nada -- ninguna variante de trigrama
// resuelve esto, hace falta un diccionario de sinonimos o IA (Fase 2).
test("una reformulacion sin ninguna palabra en comun sigue sin encontrar el producto -- el hueco real de la Fase 2", async () => {
    await crearProductoPrueba(negocio.negocioId, { nombre: "Pinza cortacables de alta palanca 24 pulgadas", codigo: "EXP-INV-SINONIMO", precio: 385 });

    const resultado = await buscarExplorarNexo(pool, negocio.negocioId, "aparato para apretar tuercas chico");
    assert.equal(
        resultado.inventario.find(p => p.codigo === "EXP-INV-SINONIMO"),
        undefined,
        "sin sinonimos ni IA, una reformulacion sin palabras compartidas no debe encontrar el producto -- confirma el alcance real de hoy"
    );
});

test("fuente inventario: no cruza datos de otro negocio", async () => {
    const otro = await crearNegocioPrueba("explorar-nexo-otro");
    try {
        await crearProductoPrueba(otro.negocioId, { nombre: "Pinza cortacables exclusiva del otro negocio", codigo: "EXP-OTRO-1" });
        const resultado = await buscarExplorarNexo(pool, negocio.negocioId, "pinza cortacables exclusiva del otro negocio");
        assert.equal(resultado.inventario.find(p => p.codigo === "EXP-OTRO-1"), undefined, "un negocio nunca debe ver el inventario de otro");
    } finally {
        await borrarNegocioPrueba(otro.negocioId);
    }
});

test("fuente proveedor: encuentra un producto de un catalogo de proveedor ya subido", async () => {
    const catalogo = await pool.query(
        `INSERT INTO public.catalogos_proveedor (negocio_id, proveedor) VALUES ($1, 'Proveedor de prueba') RETURNING id`,
        [negocio.negocioId]
    );
    await pool.query(
        `INSERT INTO public.catalogo_productos (negocio_id, catalogo_id, codigo_proveedor, nombre_proveedor, marca, precio_publico)
         VALUES ($1, $2, 'EXP-PROV-1', 'Pinza cortadora de cable industrial', 'MarcaProveedor', 450)`,
        [negocio.negocioId, catalogo.rows[0].id]
    );

    const resultado = await buscarExplorarNexo(pool, negocio.negocioId, "pinza cortadora de cable");

    const hallazgo = resultado.proveedor.find(p => p.codigo === "EXP-PROV-1");
    assert.ok(hallazgo, "debe encontrar el producto del catalogo de proveedor");
    assert.equal(hallazgo.proveedor, "Proveedor de prueba");
    assert.equal(hallazgo.precioPublico, 450);
});

test("fuente Catalogo Maestro: encuentra por nombre (antes solo se podia por codigo exacto)", async () => {
    await crearMaestroPrueba({ codigo: "EXP-MAESTRO-1", nombre: "Pinza cortacables profesional de alta palanca, prueba automatizada" });

    const resultado = await buscarExplorarNexo(pool, negocio.negocioId, "pinza cortacables alta palanca");

    const hallazgo = resultado.catalogoMaestro.find(p => p.codigo === "EXP-MAESTRO-1");
    assert.ok(hallazgo, "debe encontrar el producto del Catalogo Maestro por nombre, sin conocer el codigo");
    assert.equal(hallazgo.fuente, "catalogo_maestro");
});

test("fuente Catalogo Maestro: un producto necesita_revision nunca se ofrece", async () => {
    const id = await crearMaestroPrueba({ codigo: "EXP-MAESTRO-REVISION", nombre: "Pinza cortacables en revision, prueba automatizada" });
    await pool.query(`UPDATE public.catalogo_maestro_productos SET necesita_revision = true WHERE id = $1`, [id]);

    const resultado = await buscarExplorarNexo(pool, negocio.negocioId, "pinza cortacables en revision");

    assert.equal(resultado.catalogoMaestro.find(p => p.codigo === "EXP-MAESTRO-REVISION"), undefined, "un producto con conflicto sin resolver no se debe ofrecer");
});

test("fuente Catalogo Maestro: trae el precio de lista del fabricante via join, nunca inventa uno", async () => {
    await crearMaestroPrueba({ codigo: "EXP-MAESTRO-CONPRECIO", nombre: "Pinza cortacables con precio de fabricante, prueba automatizada" });
    await crearFabricantePrueba({ codigo: "EXP-MAESTRO-CONPRECIO", descripcion: "no importa para esta prueba", precioPublico: 777.5 });

    const resultado = await buscarExplorarNexo(pool, negocio.negocioId, "pinza cortacables con precio de fabricante");

    const hallazgo = resultado.catalogoMaestro.find(p => p.codigo === "EXP-MAESTRO-CONPRECIO");
    assert.ok(hallazgo);
    assert.equal(hallazgo.precioListaPublico, 777.5);

    // Un producto del Maestro SIN codigo de fabricante enlazado a
    // ningun catalogo_fabricante_productos nunca debe traer un precio
    // inventado -- debe quedar null.
    await crearMaestroPrueba({ codigo: "EXP-MAESTRO-SINPRECIO", nombre: "Pinza cortacables sin precio de fabricante, prueba automatizada" });
    const resultado2 = await buscarExplorarNexo(pool, negocio.negocioId, "pinza cortacables sin precio de fabricante");
    const sinPrecio = resultado2.catalogoMaestro.find(p => p.codigo === "EXP-MAESTRO-SINPRECIO");
    assert.ok(sinPrecio);
    assert.equal(sinPrecio.precioListaPublico, null);
});

test("fuente fabricante: encuentra por descripcion", async () => {
    await crearFabricantePrueba({ codigo: "EXP-FAB-1", descripcion: "Pinza cortacables de alta resistencia, prueba automatizada", precioPublico: 512 });

    const resultado = await buscarExplorarNexo(pool, negocio.negocioId, "pinza cortacables alta resistencia");

    const hallazgo = resultado.fabricante.find(p => p.codigo === "EXP-FAB-1");
    assert.ok(hallazgo, "debe encontrar el producto del catalogo de fabricante por descripcion");
    assert.equal(hallazgo.precioListaPublico, 512);
});

test("coincidencia por codigo exacto: escanear un EAN/codigo completo usa identidadPorCodigo, no el trigrama", async () => {
    const maestroId = await crearMaestroPrueba({ codigo: "7501234500019", nombre: "Producto identificable por EAN, prueba automatizada" });
    await pool.query(
        `INSERT INTO public.catalogo_maestro_identificadores (producto_maestro_id, tipo, valor) VALUES ($1, 'ean', '7501234500019')`,
        [maestroId]
    );

    const resultado = await buscarExplorarNexo(pool, negocio.negocioId, "7501234500019");

    assert.ok(resultado.coincidenciaPorCodigo, "un codigo/EAN exacto debe resolverse por identidad, no solo por trigrama");
    assert.equal(resultado.coincidenciaPorCodigo.codigo, "7501234500019");
});

test("una frase normal nunca activa por accidente la coincidencia por codigo", async () => {
    const resultado = await buscarExplorarNexo(pool, negocio.negocioId, "pinza para cortar cable grueso");
    assert.equal(resultado.coincidenciaPorCodigo, null);
});

test("texto vacio regresa estructura vacia sin tocar ninguna fuente", async () => {
    const resultado = await buscarExplorarNexo(pool, negocio.negocioId, "   ");
    assert.deepEqual(resultado, { termino: "", inventario: [], proveedor: [], catalogoMaestro: [], fabricante: [], coincidenciaPorCodigo: null });
});

test("GET /explorar-nexo/buscar exige dispositivo vinculado y responde con las 4 fuentes", async () => {
    const sinToken = await fetch(`${BASE_URL}/explorar-nexo/buscar?q=pinza`);
    assert.equal(sinToken.status, 401);

    await crearProductoPrueba(negocio.negocioId, { nombre: "Pinza cortacables HTTP de prueba", codigo: "EXP-HTTP-1" });

    const conToken = await fetch(`${BASE_URL}/explorar-nexo/buscar?q=${encodeURIComponent("pinza cortacables")}`, { headers: headers() });
    assert.equal(conToken.status, 200);
    const datos = await conToken.json();
    assert.equal(datos.ok, true);
    assert.ok(Array.isArray(datos.inventario) && Array.isArray(datos.proveedor) && Array.isArray(datos.catalogoMaestro) && Array.isArray(datos.fabricante));
    assert.ok(datos.inventario.some(p => p.codigo === "EXP-HTTP-1"));
});

// La foto (misma fuente que ya usan el POS y la ficha publica de
// Nexo Market -- Banco de Nexo primero, catalogo de fabricante como
// respaldo) nunca debe tumbar la busqueda ni inventar una imagen.
test("resolverFotoPrincipal: usa la foto curada del Banco de Nexo cuando existe", async () => {
    // banco_imagenes_producto siempre guarda el codigo ya normalizado
    // (normalizarCodigoFoto: mayusculas, solo A-Z0-9) -- sin guion,
    // para que coincida con como lo inserta el proceso real de
    // importacion de ZIPs, nunca el codigo tal cual se escribio.
    const codigo = "EXPFOTOBANCO";
    await pool.query(
        `INSERT INTO public.banco_imagenes_producto (codigo, marca, imagen_principal, imagen_principal_tipo)
         VALUES ($1, 'MARCA-PRUEBA', $2, 'image/jpeg')`,
        [codigo, Buffer.from([0xff, 0xd8, 0xff])]
    );
    codigosBancoImagenesCreados.push(codigo);

    const url = await resolverFotoPrincipal(pool, codigo);
    assert.ok(url, "debe regresar una URL cuando el banco ya tiene la foto");
    assert.ok(url.startsWith(`/banco-imagenes/${codigo}/principal`), "debe ser la ruta firmada del Banco de Nexo, no una copia nueva");
});

test("resolverFotoPrincipal: un codigo sin foto en ningun lado regresa null, nunca inventa una", async () => {
    const url = await resolverFotoPrincipal(pool, "EXP-FOTO-NO-EXISTE-JAMAS");
    assert.equal(url, null);
});

test("GET /explorar-nexo/foto/:codigo exige dispositivo vinculado y responde con la url resuelta", async () => {
    const codigo = "EXPFOTOHTTP";
    await pool.query(
        `INSERT INTO public.banco_imagenes_producto (codigo, marca, imagen_principal, imagen_principal_tipo)
         VALUES ($1, 'MARCA-PRUEBA', $2, 'image/jpeg')`,
        [codigo, Buffer.from([0xff, 0xd8, 0xff])]
    );
    codigosBancoImagenesCreados.push(codigo);

    const sinToken = await fetch(`${BASE_URL}/explorar-nexo/foto/${codigo}`);
    assert.equal(sinToken.status, 401);

    const conToken = await fetch(`${BASE_URL}/explorar-nexo/foto/${codigo}`, { headers: headers() });
    assert.equal(conToken.status, 200);
    const datos = await conToken.json();
    assert.equal(datos.ok, true);
    assert.ok(datos.url && datos.url.includes(codigo));
});
