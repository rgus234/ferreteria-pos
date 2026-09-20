// Escaneo conectado al Catalogo Maestro.
//
// La regla que se prueba aqui, y que es la que protege a los negocios que
// ya trabajan: el catalogo de proveedor PROPIO manda siempre. El Maestro
// solo entra cuando el negocio no tiene nada suyo para ese codigo.
//
// Sin eso, un negocio que cargo el catalogo de su proveedor y negocio sus
// precios veria de pronto precios de lista del fabricante al escanear.

const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const pool = require("../db");
const { iniciarServidorPrueba, detenerServidorPrueba, BASE_URL } = require("./helpers/servidor-prueba");
const { crearNegocioPrueba, borrarNegocioPrueba } = require("./helpers/negocio-prueba");

let negocio;
// EAN real que existe en el Catalogo Maestro (se resuelve en before).
let eanDelMaestro = null;
let datosMaestro = null;

before(async () => {
    await iniciarServidorPrueba();
    negocio = await crearNegocioPrueba("escaneo-maestro");

    const r = await pool.query(
        `SELECT i.valor, m.id AS maestro_id, m.nombre, m.marca, m.codigo_fabricante
         FROM public.catalogo_maestro_identificadores i
         JOIN public.catalogo_maestro_productos m ON m.id = i.producto_maestro_id
         WHERE i.tipo = 'ean' AND COALESCE(m.nombre,'') <> '' AND NOT m.necesita_revision
         ORDER BY i.id LIMIT 1`
    );
    if (r.rows[0]) {
        eanDelMaestro = r.rows[0].valor;
        datosMaestro = r.rows[0];
    }
});

after(async () => {
    if (negocio) await borrarNegocioPrueba(negocio.negocioId);
    await detenerServidorPrueba();
    await pool.end();
});

function headers() {
    return { "Content-Type": "application/json", "x-dispositivo-token": negocio.token };
}

async function buscarCodigo(codigo) {
    const respuesta = await fetch(
        `${BASE_URL}/catalogo-proveedor/buscar-codigo?codigo=${encodeURIComponent(codigo)}`,
        { headers: headers() }
    );
    return respuesta.json();
}

test("un negocio sin catalogo propio ahora SI reconoce lo que escanea", async () => {
    if (!eanDelMaestro) {
        console.log("    (Catalogo Maestro vacio: correr scripts/reconciliar-catalogo-maestro.js --aplicar)");
        return;
    }

    const datos = await buscarCodigo(eanDelMaestro);

    assert.equal(datos.ok, true);
    assert.ok(datos.producto, "deberia encontrarlo en el Catalogo Maestro");
    assert.equal(datos.producto.origen, "catalogo_nexo");
    assert.ok(datos.producto.nombre.length > 3, "trae nombre de producto");
    assert.equal(datos.producto.codigoBarras, eanDelMaestro);
});

test("tambien lo encuentra por el codigo del fabricante", async () => {
    if (!datosMaestro?.codigo_fabricante) return;

    const datos = await buscarCodigo(datosMaestro.codigo_fabricante);
    assert.ok(datos.producto, "un producto se encuentra por cualquiera de sus identificadores");
    assert.equal(datos.producto.origen, "catalogo_nexo");
});

test("REGLA: el catalogo propio del negocio MANDA sobre el Maestro", async () => {
    if (!eanDelMaestro) return;

    // Se le carga al negocio un catalogo propio con ESE mismo codigo de
    // barras, pero con su nombre y sus precios negociados.
    const catalogo = await pool.query(
        `INSERT INTO public.catalogos_proveedor (negocio_id, proveedor, total_productos)
         VALUES ($1, 'Proveedor de prueba', 1) RETURNING id`,
        [negocio.negocioId]
    );
    await pool.query(
        `INSERT INTO public.catalogo_productos
            (negocio_id, catalogo_id, codigo_proveedor, nombre_proveedor, marca,
             codigo_barras, precio_distribuidor, precio_medio_mayoreo, precio_publico)
         VALUES ($1, $2, 'PROP-1', 'Nombre que puso el proveedor del negocio', 'MARCA PROPIA',
                 $3, 11.11, 22.22, 33.33)`,
        [negocio.negocioId, catalogo.rows[0].id, eanDelMaestro]
    );

    try {
        const datos = await buscarCodigo(eanDelMaestro);

        assert.ok(datos.producto);
        assert.equal(datos.producto.origen, undefined,
            "al venir del catalogo propio no lleva marca de origen");
        assert.equal(datos.producto.nombre, "Nombre que puso el proveedor del negocio");
        assert.equal(Number(datos.producto.publico), 33.33,
            "manda el precio que el negocio negocio con SU proveedor, no el de lista");
        assert.equal(datos.producto.proveedor, "Proveedor de prueba");
    } finally {
        await pool.query(`DELETE FROM public.catalogo_productos WHERE catalogo_id = $1`, [catalogo.rows[0].id]);
        await pool.query(`DELETE FROM public.catalogos_proveedor WHERE id = $1`, [catalogo.rows[0].id]);
    }
});

// EL HUECO QUE SE VIO EN FERRETERIA OLIMPICO.
//
// El auto-vinculo al Maestro (catalogoMaestroId en la respuesta) solo
// estaba en la rama que cae al Maestro cuando el catalogo propio no tiene
// nada. Olimpico tiene un catalogo Diprofer de 15,762 productos, asi que
// casi todo escaneo se resolvia en la rama del catalogo propio -- que NO
// lo devolvia. Cada producto dado de alta desde el 8 de septiembre quedo
// sin vinculo: una cinta Truper 13515, en el Maestro y con foto en el
// banco, salio sin foto en Market.
//
// La prueba original de arriba ("el catalogo propio MANDA") usaba un
// nombre distinto al del Maestro a proposito, asi que nunca podia
// detectarlo. Estas dos si.
test("con catalogo propio Y el mismo producto, el escaneo SI trae el vinculo al Maestro", async () => {
    if (!eanDelMaestro) return;

    const catalogo = await pool.query(
        `INSERT INTO public.catalogos_proveedor (negocio_id, proveedor, total_productos)
         VALUES ($1, 'Proveedor de prueba', 1) RETURNING id`,
        [negocio.negocioId]
    );
    // Mismo nombre que el Maestro: es el mismo producto, solo que con los
    // precios que este negocio negocio con SU proveedor.
    await pool.query(
        `INSERT INTO public.catalogo_productos
            (negocio_id, catalogo_id, codigo_proveedor, nombre_proveedor, marca,
             codigo_barras, precio_distribuidor, precio_medio_mayoreo, precio_publico)
         VALUES ($1, $2, 'PROP-2', $3, 'MARCA PROPIA', $4, 11.11, 22.22, 33.33)`,
        [negocio.negocioId, catalogo.rows[0].id, datosMaestro.nombre, eanDelMaestro]
    );

    try {
        const datos = await buscarCodigo(eanDelMaestro);
        assert.ok(datos.producto);
        assert.equal(Number(datos.producto.publico), 33.33,
            "sigue mandando el precio propio");
        assert.equal(datos.producto.catalogoMaestroId, datosMaestro.maestro_id,
            "sin esto, Market no encuentra las fotos del fabricante");
    } finally {
        await pool.query(`DELETE FROM public.catalogo_productos WHERE catalogo_id = $1`, [catalogo.rows[0].id]);
        await pool.query(`DELETE FROM public.catalogos_proveedor WHERE id = $1`, [catalogo.rows[0].id]);
    }
});

test("con catalogo propio pero OTRO nombre, el vinculo NO se ofrece", async () => {
    if (!eanDelMaestro) return;

    // El codigo casa, el nombre no. Puede ser un codigo mal capturado en
    // el catalogo del proveedor; ligarlo pondria en Market la foto de otro
    // producto. Ya paso con 50 productos reales.
    const catalogo = await pool.query(
        `INSERT INTO public.catalogos_proveedor (negocio_id, proveedor, total_productos)
         VALUES ($1, 'Proveedor de prueba', 1) RETURNING id`,
        [negocio.negocioId]
    );
    await pool.query(
        `INSERT INTO public.catalogo_productos
            (negocio_id, catalogo_id, codigo_proveedor, nombre_proveedor, marca,
             codigo_barras, precio_distribuidor, precio_medio_mayoreo, precio_publico)
         VALUES ($1, $2, 'PROP-3', 'Zapato de charol talla 27 con agujetas moradas', 'OTRA',
                 $3, 11.11, 22.22, 33.33)`,
        [negocio.negocioId, catalogo.rows[0].id, eanDelMaestro]
    );

    try {
        const datos = await buscarCodigo(eanDelMaestro);
        assert.ok(datos.producto);
        assert.equal(datos.producto.catalogoMaestroId, null,
            "el codigo casa pero el producto no es el mismo: mejor sin vinculo");
    } finally {
        await pool.query(`DELETE FROM public.catalogo_productos WHERE catalogo_id = $1`, [catalogo.rows[0].id]);
        await pool.query(`DELETE FROM public.catalogos_proveedor WHERE id = $1`, [catalogo.rows[0].id]);
    }
});

// CUAL CATALOGO GANA cuando el mismo codigo esta en varios.
//
// Antes ganaba el catalogo subido PRIMERO (catalogo_id ASC), para
// siempre. Una lista de precios nueva recibia un id mas alto y perdia
// contra la vieja. Pero "el mas nuevo gana" a secas tampoco: el catalogo
// GAFI de Ferreteria Olimpico salio de un PDF sin vision con UNA fila con
// precio de 4,098, y sus "codigos" son numeros de pagina que chocan con
// 913 de Diprofer. Con "mas nuevo gana", escanear el casco 10567 daba
// "Diametro de 16". COD CAP EMP SUB D".
//
// Y "el que tenga algun precio" tampoco alcanzo: la lista de diciembre
// 2025 trae 2 niveles (medio mayoreo siempre en cero) y codigos de OTRO
// proveedor que chocan con 323 de Diprofer -- todos productos distintos.
// Por ser mas nueva le ganaba, y el escaneo devolvia otro producto.
//
// Regla: manda cuantos NIVELES de precio trae la fila (3 > 2 > 0), y
// entre iguales gana el catalogo mas nuevo.

async function catalogoConFila(nombreProveedor, codigo, nombre, precios) {
    const cat = await pool.query(
        `INSERT INTO public.catalogos_proveedor (negocio_id, proveedor, total_productos)
         VALUES ($1, $2, 1) RETURNING id`,
        [negocio.negocioId, nombreProveedor]
    );
    await pool.query(
        `INSERT INTO public.catalogo_productos
            (negocio_id, catalogo_id, codigo_proveedor, nombre_proveedor, marca,
             precio_distribuidor, precio_medio_mayoreo, precio_publico)
         VALUES ($1, $2, $3, $4, 'MARCA', $5, $6, $7)`,
        [negocio.negocioId, cat.rows[0].id, codigo, nombre,
         precios?.dist ?? null, precios?.mm ?? null, precios?.pub ?? null]
    );
    return cat.rows[0].id;
}

async function borrarCatalogos(ids) {
    for (const id of ids) {
        await pool.query(`DELETE FROM public.catalogo_productos WHERE catalogo_id = $1`, [id]);
        await pool.query(`DELETE FROM public.catalogos_proveedor WHERE id = $1`, [id]);
    }
}

test("ORDEN: entre dos catalogos con precio, gana el mas NUEVO", async () => {
    const codigo = `ORD-${Date.now()}`;
    const viejo = await catalogoConFila("Lista vieja", codigo, "Producto lista vieja", { dist: 10, mm: 20, pub: 30 });
    const nuevo = await catalogoConFila("Lista nueva", codigo, "Producto lista nueva", { dist: 11, mm: 22, pub: 33 });

    try {
        const datos = await buscarCodigo(codigo);
        assert.ok(datos.producto);
        assert.equal(datos.producto.proveedor, "Lista nueva",
            "el dueno subio una lista nueva: esa es la que espera ver");
        assert.equal(Number(datos.producto.publico), 33);
    } finally {
        await borrarCatalogos([viejo, nuevo]);
    }
});

test("ORDEN: un catalogo nuevo SIN precio no le gana a uno viejo CON precio", async () => {
    // El caso GAFI: importado despues, pero sin precios. Si ganara,
    // escanear devolveria una fila que no sirve para cobrar.
    const codigo = `ORD-${Date.now()}-B`;
    const viejoConPrecio = await catalogoConFila("Diprofer de prueba", codigo, "Casco de seguridad", { dist: 10, mm: 20, pub: 30 });
    const nuevoSinPrecio = await catalogoConFila("PDF sin precios", codigo, "Diametro de 16 COD CAP EMP", null);

    try {
        const datos = await buscarCodigo(codigo);
        assert.ok(datos.producto);
        assert.equal(datos.producto.proveedor, "Diprofer de prueba",
            "una fila sin precio es casi seguro una extraccion fallida");
        assert.equal(datos.producto.nombre, "Casco de seguridad");
    } finally {
        await borrarCatalogos([viejoConPrecio, nuevoSinPrecio]);
    }
});

test("ORDEN: una lista nueva con 2 niveles no le gana a una vieja con los 3", async () => {
    // El caso real de Olimpico: el mismo numero es un gato hidraulico en
    // Diprofer y una llave de manguera en la lista de diciembre. La lista
    // es mas nueva pero trae medio mayoreo en cero. Si ganara, el dueno
    // escanearia un gato y veria una llave.
    const codigo = `ORD-${Date.now()}-C`;
    const viejoCompleto = await catalogoConFila("Diprofer de prueba", codigo, "Gato hidraulico de patin 5t", { dist: 10000, mm: 12000, pub: 14000 });
    const nuevoIncompleto = await catalogoConFila("Lista de otro proveedor", codigo, "Llave manguera 013mm", { dist: 40, mm: 0, pub: 77 });

    try {
        const datos = await buscarCodigo(codigo);
        assert.ok(datos.producto);
        assert.equal(datos.producto.nombre, "Gato hidraulico de patin 5t",
            "una fila con los tres niveles es mas de fiar que una con dos");
    } finally {
        await borrarCatalogos([viejoCompleto, nuevoIncompleto]);
    }
});

test("un codigo que no existe en ningun lado sigue devolviendo null", async () => {
    const datos = await buscarCodigo("0000000000000");
    assert.equal(datos.ok, true);
    assert.equal(datos.producto, null, "no se inventa un producto");
});

test("lo que viene del Maestro no trae proveedor: no viene de ninguno", async () => {
    if (!eanDelMaestro) return;

    const datos = await buscarCodigo(eanDelMaestro);
    assert.ok(datos.producto);
    assert.equal(datos.producto.proveedor, "",
        "el dato es del fabricante; el proveedor lo pone el dueno");
});

test("un producto marcado para revision no se ofrece", async () => {
    if (!datosMaestro?.codigo_fabricante) return;

    await pool.query(
        `UPDATE public.catalogo_maestro_productos
         SET necesita_revision = true, revision_motivo = 'prueba'
         WHERE codigo_fabricante = $1`,
        [datosMaestro.codigo_fabricante]
    );

    try {
        const datos = await buscarCodigo(eanDelMaestro);
        assert.equal(datos.producto, null,
            "con un conflicto sin resolver es mejor no sugerir nada");
    } finally {
        await pool.query(
            `UPDATE public.catalogo_maestro_productos
             SET necesita_revision = false, revision_motivo = ''
             WHERE codigo_fabricante = $1`,
            [datosMaestro.codigo_fabricante]
        );
    }
});

test("al escanear llegan los PRECIOS, no solo la identidad", async () => {
    // Bug real: el join que trae los precios exigia que el fabricante del
    // Maestro coincidiera con el de la ficha. Pero el Maestro guarda la
    // MARCA (Foset, Volteck, Pretul, Hermex, Fiero...) y la ficha guarda
    // el FABRICANTE que las engloba ("TRUPER"). Nunca casaban -- ni
    // siquiera "Truper" contra "TRUPER", por las mayusculas.
    //
    // El efecto: al escanear un producto en Agregar producto, sus cuatro
    // precios llegaban en null aunque estuvieran leidos y guardados, y el
    // campo "Precio que usara el carrito" se quedaba vacio. Todo el
    // catalogo de precios no llegaba a la pantalla donde hace falta.
    const { identidadPorCodigo } = require("../catalogo-maestro-reconciliacion");

    const r = await pool.query(
        `SELECT m.ean
           FROM public.catalogo_maestro_productos m
           JOIN public.catalogo_fabricante_productos f
             ON f.codigo = m.codigo_fabricante AND f.estado = 'activo'
          WHERE f.precio_medio_mayoreo IS NOT NULL
            AND m.ean IS NOT NULL AND m.ean <> ''
            AND NOT m.necesita_revision
          LIMIT 1`
    );

    if (!r.rows[0]) {
        console.log("    (sin productos con precio en esta base)");
        return;
    }

    const identidad = await identidadPorCodigo(pool, r.rows[0].ean);

    assert.ok(identidad, "el codigo deberia resolver");
    assert.ok(
        Number(identidad.precio_medio_mayoreo) > 0,
        "el medio mayoreo tiene que llegar: es el precio que usa el carrito"
    );
});
