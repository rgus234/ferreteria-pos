// Al dar de alta un producto se guarda de DONDE salieron sus datos.
//
// EL PROBLEMA QUE ESTA PRUEBA EVITA
//
// Cuando una tienda escanea un codigo, el Catalogo Maestro le da el
// nombre, la marca y los cuatro precios. Se ven bien en la pantalla. Pero
// al guardar, el programa se quedaba con los datos y tiraba la conexion:
// el producto quedaba correcto y sin memoria de donde venia.
//
// Nexo Market necesita esa memoria para encontrar las fotos del
// fabricante, porque el banco se indexa por el codigo de CATALOGO (46813)
// y la tienda da de alta con el de BARRAS (7506240634553). Sin el
// puente, la ficha muestra una sola foto aunque el fabricante publique
// ocho.
//
// Lo reporto el dueno: "sigen sin salir todas las fotos por producto".
// En Ferreteria Olimpico hubo que recuperarlo despues comparando nombres
// uno por uno, y 284 productos de 537 se quedaron fuera por no poder
// confirmarlos. Guardarlo al momento es gratis y es exacto.
//
// El segundo caso es el que mas importa: un producto capturado A MANO no
// debe heredar el vinculo del anterior. Si se quedara pegado, el segundo
// producto saldria en Market con la foto del primero -- exactamente el
// error que puso 50 fotos equivocadas en productos reales.

const { test, after, before } = require("node:test");
const assert = require("node:assert/strict");

const { pool, crearNegocioPrueba, borrarNegocioPrueba } =
    require("./helpers/negocio-prueba");
const { iniciarServidorPrueba, detenerServidorPrueba, BASE_URL } =
    require("./helpers/servidor-prueba");

let negocio = null;
let maestroId = null;

before(async () => {
    await iniciarServidorPrueba();
    negocio = await crearNegocioPrueba("vinculo-maestro");

    const m = await pool.query(
        `INSERT INTO public.catalogo_maestro_productos
             (codigo, nombre, marca, fabricante, codigo_fabricante)
         VALUES ($1, 'Producto de prueba vinculo', 'PruebaMarca', 'TRUPER', $1)
         RETURNING id`,
        [`TEST-VINC-${Date.now()}`]
    );
    maestroId = m.rows[0].id;
});

after(async () => {
    // Orden importa: el primer test deja un producto real enlazado a
    // maestroId (productos.catalogo_maestro_id, sin ON DELETE CASCADE).
    // Borrar el Maestro antes que el negocio viola esa llave foranea --
    // hay que borrar el negocio (y sus productos) primero.
    if (negocio) await borrarNegocioPrueba(negocio.negocioId);
    if (maestroId) {
        await pool.query(
            "DELETE FROM public.catalogo_maestro_productos WHERE id = $1", [maestroId]);
    }
    await detenerServidorPrueba();
    await pool.end();
});

function headers() {
    return {
        "Content-Type": "application/json",
        "x-dispositivo-token": negocio.token
    };
}

async function alta(cuerpo) {
    const respuesta = await fetch(`${BASE_URL}/agregar-producto`, {
        method: "POST",
        headers: headers(),
        body: JSON.stringify(cuerpo)
    });
    return { estado: respuesta.status, datos: await respuesta.json().catch(() => null) };
}

test("un producto que vino del catalogo guarda su vinculo al Maestro", async () => {
    const codigo = `TESTVINC${Date.now()}`;

    const r = await alta({
        nombre: "Producto desde catalogo",
        precio: 100,
        stock: 5,
        codigo,
        catalogoMaestroId: maestroId
    });

    assert.equal(r.estado, 200, JSON.stringify(r.datos));

    const { rows } = await pool.query(
        `SELECT catalogo_maestro_id FROM public.productos
          WHERE negocio_id = $1 AND codigo = $2`,
        [negocio.negocioId, codigo]
    );

    assert.equal(rows.length, 1, "el producto se dio de alta");
    assert.equal(
        rows[0].catalogo_maestro_id,
        maestroId,
        "sin este vinculo, Market no encuentra las fotos del fabricante"
    );
});

test("un producto capturado a mano NO hereda ningun vinculo", async () => {
    const codigo = `TESTMANO${Date.now()}`;

    const r = await alta({
        nombre: "Producto capturado a mano",
        precio: 50,
        stock: 2,
        codigo
    });

    assert.equal(r.estado, 200, JSON.stringify(r.datos));

    const { rows } = await pool.query(
        `SELECT catalogo_maestro_id FROM public.productos
          WHERE negocio_id = $1 AND codigo = $2`,
        [negocio.negocioId, codigo]
    );

    assert.equal(rows[0].catalogo_maestro_id, null,
        "adivinar de que producto se trata es como se ponen fotos equivocadas");
});

test("un vinculo inventado no se guarda ni tumba el alta", async () => {
    // Lo manda el navegador. Un texto o un numero absurdo no debe llegar
    // tal cual a una llave foranea.
    for (const basura of ["; DROP TABLE productos", -5, 0, "abc"]) {
        const codigo = `TESTBAS${Date.now()}${Math.random().toString(36).slice(2, 6)}`;

        const r = await alta({
            nombre: "Producto con vinculo invalido",
            precio: 10,
            stock: 1,
            codigo,
            catalogoMaestroId: basura
        });

        assert.equal(r.estado, 200, `basura ${JSON.stringify(basura)}: ${JSON.stringify(r.datos)}`);

        const { rows } = await pool.query(
            `SELECT catalogo_maestro_id FROM public.productos
              WHERE negocio_id = $1 AND codigo = $2`,
            [negocio.negocioId, codigo]
        );
        assert.equal(rows[0].catalogo_maestro_id, null);
    }
});
