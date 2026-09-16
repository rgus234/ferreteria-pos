// Fase 9 del plan de identidad multi-proveedor: prioridad de fuentes de
// imagen del Catalogo Maestro. Antes de esta fase, enlazar un producto
// ya existente NUNCA volvia a tocar su imagen -- ni para llenarla si
// estaba vacia, ni para mejorarla si llegaba una de mejor fuente. Estas
// pruebas verifican la regla completa: llenar el hueco siempre se
// permite, mejorar solo si la fuente nueva pesa mas, nunca degradar.
const { test, after } = require("node:test");
const assert = require("node:assert/strict");
const pool = require("../db");
const { contribuirOEnlazarCatalogoMaestro } = require("../catalogo-maestro-resolver");

const codigosDePrueba = [];

function codigoUnico(sufijo) {
    const codigo = `ZZIMG-${sufijo}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    codigosDePrueba.push(codigo);
    return codigo;
}

after(async () => {
    if (codigosDePrueba.length) {
        await pool.query(`DELETE FROM public.catalogo_maestro_productos WHERE codigo = ANY($1::text[])`, [codigosDePrueba]);
    }
    await pool.end();
});

async function filaDe(codigo) {
    const r = await pool.query(
        `SELECT imagen, imagen_tipo, imagen_fuente, imagen_confianza, imagen_actualizada_en
         FROM public.catalogo_maestro_productos WHERE codigo = $1`,
        [codigo]
    );
    return r.rows[0];
}

test("crear un producto con imagen la clasifica como catalogo_proveedor por default", async () => {
    const codigo = codigoUnico("A");
    await contribuirOEnlazarCatalogoMaestro(pool, 1, {
        codigo, marca: "Prueba", nombre: "Producto con imagen de catalogo",
        imagen: Buffer.from("foto-1"), imagenTipo: "image/jpeg"
    });

    const fila = await filaDe(codigo);
    assert.equal(fila.imagen.toString(), "foto-1");
    assert.equal(fila.imagen_fuente, "catalogo_proveedor");
    assert.ok(fila.imagen_actualizada_en);
});

test("crear declarando fuente y confianza explicitas las respeta", async () => {
    const codigo = codigoUnico("B");
    await contribuirOEnlazarCatalogoMaestro(pool, 1, {
        codigo, marca: "Prueba", nombre: "Producto con imagen de fabricante",
        imagen: Buffer.from("foto-2"), imagenTipo: "image/jpeg", imagenFuente: "fabricante_oficial", imagenConfianza: 0.92
    });

    const fila = await filaDe(codigo);
    assert.equal(fila.imagen_fuente, "fabricante_oficial");
    assert.equal(Number(fila.imagen_confianza), 0.92);
});

test("enlazar a un producto SIN imagen todavia llena el hueco (antes de esta fase, nunca pasaba)", async () => {
    const codigo = codigoUnico("C");
    await contribuirOEnlazarCatalogoMaestro(pool, 1, { codigo, marca: "Prueba", nombre: "Producto sin imagen al crear" });

    let fila = await filaDe(codigo);
    assert.equal(fila.imagen, null);

    await contribuirOEnlazarCatalogoMaestro(pool, 2, {
        codigo, marca: "Prueba", nombre: "Producto sin imagen al crear",
        imagen: Buffer.from("foto-3"), imagenTipo: "image/jpeg"
    });

    fila = await filaDe(codigo);
    assert.equal(fila.imagen.toString(), "foto-3");
    assert.equal(fila.imagen_fuente, "catalogo_proveedor");
});

test("una imagen de fuente IGUAL O PEOR nunca reemplaza la que ya existe", async () => {
    const codigo = codigoUnico("D");
    await contribuirOEnlazarCatalogoMaestro(pool, 1, {
        codigo, marca: "Prueba", nombre: "Producto con imagen buena",
        imagen: Buffer.from("foto-original"), imagenTipo: "image/jpeg", imagenFuente: "catalogo_proveedor"
    });

    // Fuente igual (otro negocio confirma el mismo producto desde SU
    // propio catalogo de proveedor).
    await contribuirOEnlazarCatalogoMaestro(pool, 2, {
        codigo, marca: "Prueba", nombre: "Producto con imagen buena",
        imagen: Buffer.from("foto-igual-fuente"), imagenTipo: "image/jpeg", imagenFuente: "catalogo_proveedor"
    });
    assert.equal((await filaDe(codigo)).imagen.toString(), "foto-original", "fuente igual no debe reemplazar");

    // Fuente PEOR (una foto que un negocio subio de su telefono).
    await contribuirOEnlazarCatalogoMaestro(pool, 3, {
        codigo, marca: "Prueba", nombre: "Producto con imagen buena",
        imagen: Buffer.from("foto-negocio"), imagenTipo: "image/jpeg", imagenFuente: "negocio"
    });
    assert.equal((await filaDe(codigo)).imagen.toString(), "foto-original", "fuente peor nunca debe degradar la imagen ya buena");
});

test("una imagen de fuente MEJOR si reemplaza a la de menor prioridad", async () => {
    const codigo = codigoUnico("E");
    await contribuirOEnlazarCatalogoMaestro(pool, 1, {
        codigo, marca: "Prueba", nombre: "Producto que mejora su imagen",
        imagen: Buffer.from("foto-catalogo"), imagenTipo: "image/jpeg", imagenFuente: "catalogo_proveedor"
    });

    await contribuirOEnlazarCatalogoMaestro(pool, 2, {
        codigo, marca: "Prueba", nombre: "Producto que mejora su imagen",
        imagen: Buffer.from("foto-fabricante-oficial"), imagenTipo: "image/jpeg", imagenFuente: "fabricante_oficial", imagenConfianza: 0.99
    });

    const fila = await filaDe(codigo);
    assert.equal(fila.imagen.toString(), "foto-fabricante-oficial");
    assert.equal(fila.imagen_fuente, "fabricante_oficial");
    assert.equal(Number(fila.imagen_confianza), 0.99);
});

test("cobertura de imagenes: los conteos son internamente consistentes", async () => {
    const resumen = await pool.query(
        `SELECT COUNT(*)::int AS total, COUNT(*) FILTER (WHERE imagen IS NOT NULL)::int AS con_imagen,
                COUNT(*) FILTER (WHERE imagen IS NULL)::int AS sin_imagen
         FROM public.catalogo_maestro_productos`
    );
    const { total, con_imagen, sin_imagen } = resumen.rows[0];
    assert.equal(con_imagen + sin_imagen, total, "con_imagen + sin_imagen debe sumar el total, sin huecos");
    assert.ok(total > 0, "debe haber datos reales en el Catalogo Maestro");
});
