// Fase 1 de identidad multi-proveedor (auditoria GAFI): un distribuidor
// como GAFI identifica un producto con SU PROPIO codigo interno, pero el
// FABRICANTE del mismo producto lo identifica con un codigo distinto
// ("Alterno" en el catalogo real de GAFI, ej. codigo GAFI 189955 =
// Alterno "R5-45" para el mismo Devcon Plastiacero). Antes de esta fase,
// contribuirOEnlazarCatalogoMaestro() solo guardaba el codigo del
// distribuidor y nunca escribia en catalogo_maestro_identificadores --
// ni siquiera ESE codigo quedaba buscable por identidadPorCodigo(), que
// es la funcion real que usa el escaneo/busqueda de producto.
//
// Estas pruebas verifican, contra la base real (negocio sintetico, datos
// sinteticos con prefijo unico para no chocar con datos reales): que
// ambos identificadores (y el EAN, si pasa el digito verificador) quedan
// buscables hacia el MISMO producto maestro, que un EAN invalido nunca
// se acepta, y que un identificador ya tomado por otro producto se
// marca para revision en vez de reasignarse en silencio.
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const pool = require("../db");
const { contribuirOEnlazarCatalogoMaestro } = require("../catalogo-maestro-resolver");
const { identidadPorCodigo } = require("../catalogo-maestro-reconciliacion");
const { crearNegocioPrueba, borrarNegocioPrueba } = require("./helpers/negocio-prueba");

let negocio;
const codigosDePrueba = [];

before(async () => {
    negocio = await crearNegocioPrueba("catalogo-maestro-ident");
});

after(async () => {
    if (codigosDePrueba.length) {
        await pool.query(`DELETE FROM public.catalogo_maestro_productos WHERE codigo = ANY($1::text[])`, [codigosDePrueba]);
    }
    if (negocio) await borrarNegocioPrueba(negocio.negocioId);
    await pool.end();
});

function codigoUnico(sufijo) {
    const codigo = `ZZPRUEBA-${sufijo}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    codigosDePrueba.push(codigo);
    return codigo;
}

test("un producto GAFI queda buscable por su codigo GAFI Y por el Alterno del fabricante", async () => {
    const codigoGafi = codigoUnico("189955");
    const alterno = codigoUnico("R5-45");

    const id = await contribuirOEnlazarCatalogoMaestro(pool, negocio.negocioId, {
        codigo: codigoGafi,
        codigoFabricante: alterno,
        marca: "Devcon",
        nombre: "Plastiacero jeringa 5 minutos",
        fuente: "GAFI"
    });

    assert.ok(id, "debe crear el producto maestro");

    const porCodigoGafi = await identidadPorCodigo(pool, codigoGafi);
    const porAlterno = await identidadPorCodigo(pool, alterno);

    assert.ok(porCodigoGafi, "debe resolver por el codigo GAFI (antes de esta fase, ni siquiera esto era buscable)");
    assert.ok(porAlterno, "debe resolver por el Alterno del fabricante");
    assert.equal(porCodigoGafi.id, id);
    assert.equal(porAlterno.id, id, "los dos identificadores deben apuntar al MISMO producto maestro");
});

test("un EAN que no pasa el digito verificador nunca se guarda como identidad (nunca inventar EAN)", async () => {
    const codigoGafi = codigoUnico("287236");

    const id = await contribuirOEnlazarCatalogoMaestro(pool, negocio.negocioId, {
        codigo: codigoGafi,
        ean: "1234567890", // no pasa el checksum EAN-13/EAN-8/UPC-12
        marca: "Austromex",
        nombre: "Disco de corte turbo cuarcita",
        fuente: "GAFI"
    });

    assert.ok(id);

    const porEanInventado = await identidadPorCodigo(pool, "1234567890");
    assert.equal(porEanInventado, null, "un numero que no es un EAN real nunca debe resolver como identidad");

    const fila = await pool.query(`SELECT ean FROM public.catalogo_maestro_productos WHERE id = $1`, [id]);
    assert.equal(fila.rows[0].ean, "", "la columna ean tampoco debe quedar con el valor invalido");
});

test("CONFLICTO: el mismo Alterno ya asignado a otro producto se marca para revision, nunca se reasigna solo", async () => {
    const alternoCompartido = codigoUnico("858");
    const codigoA = codigoUnico("A");
    const codigoB = codigoUnico("B");

    const idA = await contribuirOEnlazarCatalogoMaestro(pool, negocio.negocioId, {
        codigo: codigoA, codigoFabricante: alternoCompartido, marca: "Marca A", nombre: "Producto A", fuente: "GAFI"
    });
    const idB = await contribuirOEnlazarCatalogoMaestro(pool, negocio.negocioId, {
        codigo: codigoB, codigoFabricante: alternoCompartido, marca: "Marca B", nombre: "Producto B", fuente: "GAFI"
    });

    assert.ok(idA && idB && idA !== idB, "deben quedar como dos productos maestro distintos, nunca fusionados");

    const resuelto = await identidadPorCodigo(pool, alternoCompartido);
    assert.equal(resuelto.id, idA, "el identificador ya asignado no se reasigna al segundo producto");

    const filaB = await pool.query(
        `SELECT necesita_revision, revision_motivo FROM public.catalogo_maestro_productos WHERE id = $1`,
        [idB]
    );
    assert.equal(filaB.rows[0].necesita_revision, true, "el producto que llego despues y perdio el identificador queda marcado");
    assert.ok(filaB.rows[0].revision_motivo.includes(alternoCompartido));
});

test("confirmar el mismo codigo GAFI dos veces ENLAZA al mismo producto, no lo duplica", async () => {
    const codigoGafi = codigoUnico("dup");
    const alternoTardio = codigoUnico("ABC60");

    const id1 = await contribuirOEnlazarCatalogoMaestro(pool, negocio.negocioId, {
        codigo: codigoGafi, marca: "Coflex", nombre: "Manguera para boiler", fuente: "GAFI"
    });
    // Segunda confirmacion del mismo codigo GAFI (otro negocio, o el
    // mismo catalogo re-subido) trae ahora el Alterno que la primera vez
    // no traia.
    const id2 = await contribuirOEnlazarCatalogoMaestro(pool, negocio.negocioId, {
        codigo: codigoGafi, codigoFabricante: alternoTardio, marca: "Coflex", nombre: "Manguera para boiler", fuente: "GAFI"
    });

    assert.equal(id1, id2, "el mismo codigo GAFI siempre debe enlazar al mismo producto maestro");

    const porAlternoTardio = await identidadPorCodigo(pool, alternoTardio);
    assert.equal(porAlternoTardio.id, id1, "un identificador aportado al ENLAZAR (no solo al crear) tambien debe quedar buscable");
});
