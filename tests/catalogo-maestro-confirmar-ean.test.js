// Fase 3 de identidad multi-proveedor: "aprender EAN por escaneo". Un
// producto GAFI (o de cualquier proveedor sin EAN propio) puede quedar
// identificado por su codigo de distribuidor o de fabricante (Fase 1),
// pero el paquete FISICO casi siempre trae ademas un codigo de barras
// real que GAFI nunca reporto. Estas pruebas verifican que:
//   - un EAN valido se puede confirmar y queda buscable por si mismo;
//   - nunca se acepta un numero que no pasa el digito verificador;
//   - nunca se reasigna un EAN que ya pertenece a OTRO producto (se
//     avisa como conflicto, no se marca en silencio ni se fusiona);
//   - dar de alta un producto ya identificado en el Maestro, escribiendo
//     un EAN real en el campo de codigo, lo confirma automaticamente
//     (sin pantalla nueva -- reusa el alta que ya existe).
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const pool = require("../db");
const { contribuirOEnlazarCatalogoMaestro, confirmarEanCatalogoMaestro } = require("../catalogo-maestro-resolver");
const { identidadPorCodigo } = require("../catalogo-maestro-reconciliacion");
const { iniciarServidorPrueba, detenerServidorPrueba, BASE_URL } = require("./helpers/servidor-prueba");
const { crearNegocioPrueba, borrarNegocioPrueba } = require("./helpers/negocio-prueba");

let negocio;
const codigosDePrueba = [];
const productosCreados = [];

before(async () => {
    await iniciarServidorPrueba();
    negocio = await crearNegocioPrueba("confirmar-ean");
});

after(async () => {
    if (productosCreados.length) {
        await pool.query(`DELETE FROM public.productos WHERE id = ANY($1::int[])`, [productosCreados]);
    }
    if (codigosDePrueba.length) {
        await pool.query(`DELETE FROM public.catalogo_maestro_productos WHERE codigo = ANY($1::text[])`, [codigosDePrueba]);
    }
    if (negocio) await borrarNegocioPrueba(negocio.negocioId);
    await detenerServidorPrueba();
    await pool.end();
});

function codigoUnico(sufijo) {
    const codigo = `ZZEAN-${sufijo}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    codigosDePrueba.push(codigo);
    return codigo;
}

// EAN-13 real (pasa el digito verificador) -- se le cambian los ultimos
// digitos de la mitad para tener varios validos y distintos por prueba.
function eanValidoDePrueba(semilla) {
    const base = "750160055" + String(semilla).padStart(3, "0").slice(0, 3);
    const digitos = base.split("").map(Number);
    let suma = 0;
    digitos.slice().reverse().forEach((n, i) => { suma += n * (i % 2 === 0 ? 3 : 1); });
    const verificador = (10 - (suma % 10)) % 10;
    return base + verificador;
}

async function crearProductoMaestroDePrueba(sufijo) {
    const codigo = codigoUnico(sufijo);
    const id = await contribuirOEnlazarCatalogoMaestro(pool, negocio.negocioId, {
        codigo, marca: "Devcon", nombre: "Plastiacero jeringa 5 minutos", fuente: "GAFI"
    });
    return { id, codigo };
}

function headers() {
    return { "Content-Type": "application/json", "x-dispositivo-token": negocio.token };
}

test("confirmar un EAN valido lo deja buscable hacia el producto correcto", async () => {
    const { id } = await crearProductoMaestroDePrueba("A");
    const ean = eanValidoDePrueba(1);

    const resultado = await confirmarEanCatalogoMaestro(pool, id, ean, "prueba");
    assert.equal(resultado.ok, true);

    const identidad = await identidadPorCodigo(pool, ean);
    assert.ok(identidad, "el EAN confirmado debe resolver");
    assert.equal(identidad.id, id);
});

test("un numero que no pasa el digito verificador nunca se confirma", async () => {
    const { id } = await crearProductoMaestroDePrueba("B");

    const resultado = await confirmarEanCatalogoMaestro(pool, id, "1234567890", "prueba");
    assert.equal(resultado.ok, false);
    assert.equal(resultado.motivo, "ean_invalido");

    const identidad = await identidadPorCodigo(pool, "1234567890");
    assert.equal(identidad, null);
});

test("confirmar el mismo EAN dos veces para el mismo producto es idempotente", async () => {
    const { id } = await crearProductoMaestroDePrueba("C");
    const ean = eanValidoDePrueba(2);

    const r1 = await confirmarEanCatalogoMaestro(pool, id, ean, "prueba");
    const r2 = await confirmarEanCatalogoMaestro(pool, id, ean, "prueba");
    assert.equal(r1.ok, true);
    assert.equal(r2.ok, true);
});

test("CONFLICTO: un EAN ya confirmado para OTRO producto se rechaza, nunca se reasigna", async () => {
    const productoA = await crearProductoMaestroDePrueba("D1");
    const productoB = await crearProductoMaestroDePrueba("D2");
    const ean = eanValidoDePrueba(3);

    const rA = await confirmarEanCatalogoMaestro(pool, productoA.id, ean, "prueba");
    assert.equal(rA.ok, true);

    const rB = await confirmarEanCatalogoMaestro(pool, productoB.id, ean, "prueba");
    assert.equal(rB.ok, false);
    assert.equal(rB.motivo, "conflicto");
    assert.equal(rB.otroProductoMaestroId, productoA.id);

    // Ninguno de los dos productos queda marcado para revision -- a
    // diferencia del flujo de importacion masiva, aqui simplemente se
    // avisa del conflicto; nadie decidio nada en automatico.
    const filas = await pool.query(
        `SELECT id, necesita_revision FROM public.catalogo_maestro_productos WHERE id = ANY($1::int[])`,
        [[productoA.id, productoB.id]]
    );
    filas.rows.forEach(f => assert.equal(f.necesita_revision, false));

    const identidad = await identidadPorCodigo(pool, ean);
    assert.equal(identidad.id, productoA.id, "el EAN se queda con el primero que lo confirmo");
});

test("endpoint POST /catalogo-maestro/:id/confirmar-ean -- caso exitoso", async () => {
    const { id } = await crearProductoMaestroDePrueba("E");
    const ean = eanValidoDePrueba(4);

    const respuesta = await fetch(`${BASE_URL}/catalogo-maestro/${id}/confirmar-ean`, {
        method: "POST", headers: headers(), body: JSON.stringify({ ean })
    });
    const datos = await respuesta.json();

    assert.equal(respuesta.status, 200);
    assert.equal(datos.ok, true);

    const identidad = await identidadPorCodigo(pool, ean);
    assert.equal(identidad.id, id);
});

test("endpoint responde 400 con un codigo que no es un EAN real", async () => {
    const { id } = await crearProductoMaestroDePrueba("F");

    const respuesta = await fetch(`${BASE_URL}/catalogo-maestro/${id}/confirmar-ean`, {
        method: "POST", headers: headers(), body: JSON.stringify({ ean: "42" })
    });
    assert.equal(respuesta.status, 400);
});

test("endpoint responde 404 con un producto maestro que no existe", async () => {
    const respuesta = await fetch(`${BASE_URL}/catalogo-maestro/999999999/confirmar-ean`, {
        method: "POST", headers: headers(), body: JSON.stringify({ ean: eanValidoDePrueba(5) })
    });
    assert.equal(respuesta.status, 404);
});

test("endpoint responde 409 y avisa el nombre del otro producto en conflicto", async () => {
    const productoA = await crearProductoMaestroDePrueba("G1");
    const productoB = await crearProductoMaestroDePrueba("G2");
    const ean = eanValidoDePrueba(6);

    await confirmarEanCatalogoMaestro(pool, productoA.id, ean, "prueba");

    const respuesta = await fetch(`${BASE_URL}/catalogo-maestro/${productoB.id}/confirmar-ean`, {
        method: "POST", headers: headers(), body: JSON.stringify({ ean })
    });
    const datos = await respuesta.json();

    assert.equal(respuesta.status, 409);
    assert.equal(datos.ok, false);
    assert.match(datos.error, /Devcon/);
});

test("dar de alta un producto ya identificado en el Maestro, con un EAN real en el codigo, lo confirma solo", async () => {
    const { id: catalogoMaestroId } = await crearProductoMaestroDePrueba("H");
    const ean = eanValidoDePrueba(7);

    const respuesta = await fetch(`${BASE_URL}/agregar-producto`, {
        method: "POST",
        headers: headers(),
        body: JSON.stringify({
            nombre: "Plastiacero jeringa 5 minutos",
            precio: 85,
            stock: 3,
            codigo: ean,
            catalogoMaestroId
        })
    });
    const datos = await respuesta.json();
    assert.equal(datos.success, true);
    productosCreados.push(datos.productoId);

    const identidad = await identidadPorCodigo(pool, ean);
    assert.ok(identidad, "el alta del producto debe haber confirmado el EAN solo, sin pantalla aparte");
    assert.equal(identidad.id, catalogoMaestroId);
});

test("editar un producto que YA esta identificado en el Maestro, corrigiendo el codigo a su EAN real, tambien lo confirma solo", async () => {
    const { id: catalogoMaestroId } = await crearProductoMaestroDePrueba("I");
    const ean = eanValidoDePrueba(8);

    // Se da de alta SIN catalogoMaestroId todavia (como si se hubiera
    // capturado a mano), pero ya con catalogo_maestro_id puesto a mano
    // en la base -- simula un producto que ya se habia enlazado antes.
    const alta = await pool.query(
        `INSERT INTO public.productos (negocio_id, nombre, precio, stock, codigo, catalogo_maestro_id)
         VALUES ($1, 'Plastiacero jeringa 5 minutos', 85, 3, $2, $3) RETURNING id`,
        [negocio.negocioId, codigoUnico("prod-existente"), catalogoMaestroId]
    );
    const productoId = alta.rows[0].id;
    productosCreados.push(productoId);

    const respuesta = await fetch(`${BASE_URL}/editar-producto/${productoId}`, {
        method: "PUT",
        headers: headers(),
        body: JSON.stringify({
            nombre: "Plastiacero jeringa 5 minutos",
            precio: 85,
            stock: 3,
            codigo: ean
        })
    });
    const datos = await respuesta.json();
    assert.equal(datos.success, true);

    const identidad = await identidadPorCodigo(pool, ean);
    assert.ok(identidad, "editar el producto con su EAN real en el codigo debe confirmarlo solo");
    assert.equal(identidad.id, catalogoMaestroId);
});
