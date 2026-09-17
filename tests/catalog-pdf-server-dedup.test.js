// Bug real encontrado corriendo el catalogo PDF real de GAFI (636
// paginas): un mismo codigo repetido en 2 paginas distintas tronaba el
// INSERT ... ON CONFLICT con "ON CONFLICT DO UPDATE command cannot
// affect row a second time" -- Postgres no permite que el mismo
// (catalogo_id, codigo_proveedor) aparezca 2 veces dentro del MISMO
// INSERT. filasUnicasPorCodigo() se queda con la ultima aparicion de
// cada codigo antes de armar el INSERT, funcion pura, sin base de datos.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { filasUnicasPorCodigo } = require("../catalog-pdf-server");

test("codigo repetido en 2 paginas: se queda con la ultima aparicion, nunca duplica la fila", () => {
    const productos = [
        { codigo: "GAFI-100", descripcion: "Tornillo viejo precio", precio: 10, paginaPdf: 5 },
        { codigo: "GAFI-100", descripcion: "Tornillo reimpreso mas adelante", precio: 12, paginaPdf: 300 }
    ];

    const filas = filasUnicasPorCodigo(productos);

    assert.equal(filas.length, 1);
    assert.equal(filas[0].descripcion, "Tornillo reimpreso mas adelante");
    assert.equal(filas[0].precioPublico, 12);
    assert.equal(filas[0].paginaPdf, 300);
});

test("codigos distintos nunca se fusionan", () => {
    const productos = [
        { codigo: "GAFI-1", descripcion: "Producto 1", precio: 10, paginaPdf: 1 },
        { codigo: "GAFI-2", descripcion: "Producto 2", precio: 20, paginaPdf: 2 }
    ];

    const filas = filasUnicasPorCodigo(productos);

    assert.equal(filas.length, 2);
});

test("productos sin codigo detectado nunca colisionan entre si (usan pagina+indice como respaldo)", () => {
    const productos = [
        { codigo: null, descripcion: "Sin codigo pagina 1", precio: 5, paginaPdf: 1 },
        { codigo: null, descripcion: "Sin codigo pagina 2", precio: 6, paginaPdf: 2 },
        { codigo: "", descripcion: "Codigo vacio misma pagina que el anterior no aplica", precio: 7, paginaPdf: 1 }
    ];

    const filas = filasUnicasPorCodigo(productos);

    assert.equal(filas.length, 3, "cada uno debe conservar su propia fila -- ninguno comparte codigo real");
});

test("con 3 apariciones del mismo codigo entre otros distintos, solo sobrevive una fila con el valor mas reciente", () => {
    const productos = [
        { codigo: "A", descripcion: "A1", precio: 1, paginaPdf: 1 },
        { codigo: "B", descripcion: "B1", precio: 2, paginaPdf: 2 },
        { codigo: "A", descripcion: "A2", precio: 3, paginaPdf: 3 },
        { codigo: "A", descripcion: "A3 (gana)", precio: 4, paginaPdf: 4 }
    ];

    const filas = filasUnicasPorCodigo(productos);
    const filaA = filas.find(f => f.codigoProveedor === "A");
    const filaB = filas.find(f => f.codigoProveedor === "B");

    assert.equal(filas.length, 2);
    assert.equal(filaA.descripcion, "A3 (gana)");
    assert.equal(filaA.precioPublico, 4);
    assert.equal(filaB.descripcion, "B1");
});
