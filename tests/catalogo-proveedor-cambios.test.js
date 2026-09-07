// Reporte de cambios al importar un catalogo de proveedor.
//
// El catalogo de un proveedor se actualiza una o dos veces al año. Lo que
// el dueno necesita saber es que subio, que bajo, que hay de nuevo y que
// dejaron de vender. Antes la importacion contaba dos cosas (nuevos y
// cambios de precio publico) y las mostraba en una linea que se iba al
// recargar la pagina.

const { test } = require("node:test");
const assert = require("node:assert/strict");

const { compararCatalogo, mismoPrecio } = require("../catalogo-proveedor-cambios");

// Como llega una fila del archivo ya normalizada por catalog-server.
function delArchivo(codigo, nombre, dis, medio, pub) {
    return {
        codigoProveedor: codigo, nombre,
        distribuidor: dis, medioMayoreo: medio, precioPublico: pub
    };
}

// Como sale una fila de catalogo_productos: Postgres devuelve los
// numericos como STRING.
function deLaBase(codigo, nombre, dis, medio, pub) {
    return {
        codigo_proveedor: codigo, nombre_proveedor: nombre,
        precio_distribuidor: dis == null ? null : String(dis.toFixed(2)),
        precio_medio_mayoreo: medio == null ? null : String(medio.toFixed(2)),
        precio_publico: pub == null ? null : String(pub.toFixed(2))
    };
}

test("un catalogo identico no reporta ni un cambio", () => {
    // Es la prueba que evita el reporte que grita en cada importacion: los
    // precios llegan de Postgres como "335.00" y del archivo como 335.
    const filas = [delArchivo("103013", "Pinzas multiuso 8'", 255, 365, 400)];
    const existentes = [deLaBase("103013", "Pinzas multiuso 8'", 255, 365, 400)];

    const { cambios, resumen } = compararCatalogo(filas, existentes);

    assert.deepEqual(cambios, []);
    assert.equal(resumen.sinCambio, 1);
    assert.equal(resumen.modificados, 0);
});

test("detecta los TRES precios, no solo el publico", () => {
    // El hueco viejo: solo se miraba precio_publico. Si el proveedor subia
    // el mayoreo o el distribuidor, no quedaba rastro.
    const filas = [delArchivo("103013", "Pinzas", 280, 390, 400)];
    const existentes = [deLaBase("103013", "Pinzas", 255, 365, 400)];

    const { cambios, resumen } = compararCatalogo(filas, existentes);

    assert.equal(resumen.modificados, 1, "es UN producto modificado");
    assert.equal(cambios.length, 2, "con dos precios cambiados");
    assert.deepEqual(cambios.map(c => c.campo).sort(), ["Distribuidor", "Medio mayoreo"]);

    const dis = cambios.find(c => c.campo === "Distribuidor");
    assert.equal(dis.valorAnterior, "$255.00");
    assert.equal(dis.valorNuevo, "$280.00");
});

test("un producto nuevo se reporta con el precio con el que entra", () => {
    const filas = [
        delArchivo("103013", "Pinzas", 255, 365, 400),
        delArchivo("999999", "Taladro nuevo", 900, 1000, 1100)
    ];
    const existentes = [deLaBase("103013", "Pinzas", 255, 365, 400)];

    const { cambios, resumen } = compararCatalogo(filas, existentes);

    assert.equal(resumen.nuevos, 1);
    const nuevo = cambios.find(c => c.tipo === "nuevo");
    assert.equal(nuevo.codigo, "999999");
    assert.equal(nuevo.valorNuevo, "$1100.00", "saber que existe no basta: interesa a cuanto");
});

test("lo que el proveedor dejo de listar se reporta, NO se borra", () => {
    // Un archivo incompleto no es lo mismo que un producto descontinuado,
    // y solo el dueno sabe cual de las dos fue. Se informa y el decide.
    const filas = [delArchivo("103013", "Pinzas", 255, 365, 400)];
    const existentes = [
        deLaBase("103013", "Pinzas", 255, 365, 400),
        deLaBase("103012", "Pinzas que ya no venden", 355, 390, 430)
    ];

    const { cambios, resumen } = compararCatalogo(filas, existentes);

    assert.equal(resumen.descontinuados, 1);
    const ido = cambios.find(c => c.tipo === "descontinuado");
    assert.equal(ido.codigo, "103012");
    assert.equal(ido.nombre, "Pinzas que ya no venden", "el nombre se guarda para que el reporte se lea despues");
    assert.equal(ido.valorAnterior, "$430.00");
});

test("un producto renombrado se marca: suele ser otro producto", () => {
    const filas = [delArchivo("103013", "Pinzas multiuso 10' mango largo", 255, 365, 400)];
    const existentes = [deLaBase("103013", "Pinzas multiuso 8'", 255, 365, 400)];

    const { cambios } = compararCatalogo(filas, existentes);

    assert.equal(cambios.length, 1);
    assert.equal(cambios[0].campo, "Nombre");
    assert.equal(cambios[0].valorAnterior, "Pinzas multiuso 8'");
});

test("un precio que pasa a vacio se reporta, no se ignora", () => {
    // Que el proveedor deje de publicar un precio es informacion: el
    // producto sigue existiendo pero ya no se sabe a cuanto.
    const filas = [delArchivo("103013", "Pinzas", 255, null, 400)];
    const existentes = [deLaBase("103013", "Pinzas", 255, 365, 400)];

    const { cambios } = compararCatalogo(filas, existentes);

    assert.equal(cambios.length, 1);
    assert.equal(cambios[0].campo, "Medio mayoreo");
    assert.equal(cambios[0].valorAnterior, "$365.00");
    assert.equal(cambios[0].valorNuevo, "", "queda claro que ahora esta vacio");
});

test("mismoPrecio no se deja engañar por el formato", () => {
    assert.equal(mismoPrecio("335.00", 335), true);
    assert.equal(mismoPrecio(null, null), true);
    assert.equal(mismoPrecio(null, 0), false, "vacio no es cero");
    assert.equal(mismoPrecio("335.00", 335.01), false);
});

test("una fila sin codigo no crea un producto fantasma", () => {
    // Los archivos de proveedor traen renglones de total y notas al pie.
    const filas = [delArchivo("", "TOTAL", null, null, 9999), delArchivo("103013", "Pinzas", 255, 365, 400)];
    const { cambios, resumen } = compararCatalogo(filas, []);

    assert.equal(resumen.nuevos, 1);
    assert.deepEqual(cambios.map(c => c.codigo), ["103013"]);
});
