// La columna "Ref. Precio Unit. May." no es un nivel de precio.
//
// El dueno lo reporto usandolo: "en algunos casos el precio publico salia
// muy grande o diferente al medio mayoreo y mayoreo". No era el publico
// el que estaba mal, era el MAYOREO el que salia demasiado bajo.
//
// Las tablas de paquetes traen una columna extra con el precio por PIEZA,
// siempre entre parentesis, informativa:
//
//     Codigo  Clave         May.   Ref. Precio Unit. May.  1/2 May.  Pub.
//     16167   B40-PUL-4X6   $160          ($53.33)          $175     $195
//
// Contarla como importe hacia dano doble. El recortador parte el 19606
// por el pasillo blanco de esa columna, asi que el trozo derecho se
// quedaba con ($53.33), $175 y $195: tres importes para tres columnas.
// Encajaba perfecto, la fila se daba por COMPLETA, y el mayoreo quedaba
// en $53.33 en vez de $160. Por estar "completa", el respaldo de releer
// sin partir tampoco se activaba.
//
// 42 productos del catalogo salieron asi. Los tres casos de abajo estan
// comprobados contra la imagen del modulo, no deducidos.

const { test } = require("node:test");
const assert = require("node:assert/strict");

const { importesDeLinea } = require("../catalogo-fabricante-ocr");

test("un importe entre parentesis no cuenta como precio", () => {
    // Texto tal cual lo devolvio tesseract sobre el modulo 19606.
    const linea = "16171 B80-PUL-4X6* 80. $160 ($53.33) SI75 $195 4";

    const importes = importesDeLinea(linea);

    assert.ok(!importes.includes(53.33), "el precio de referencia no debe contarse");
    assert.equal(importes[0], 160, "el mayoreo del paquete es $160");
});

test("el blister de 2 pilas conserva el precio del blister, no el de la pila", () => {
    // Modulo 41309: $72 el blister, ($36) la pila suelta.
    const linea = "47205 RE-AAA AAA 1,000 mAh $72 ($36) $79 $87 3";

    const importes = importesDeLinea(linea);

    assert.deepEqual(importes, [72, 79, 87]);
});

test("sin parentesis todo sigue contando igual", () => {
    // La mayoria de los modulos no tienen columna de referencia y no
    // deben verse afectados. Modulo 53208, flotadores.
    const linea = "49540 FPLA-4 #4 128 $12.50 $14 $15.50 4";

    assert.deepEqual(importesDeLinea(linea), [12.50, 14, 15.50]);
});

test("un parentesis sin importe adentro no se lleva nada por delante", () => {
    // "(19 mm)" y "(13 mm)" aparecen en la columna Medida de muchas
    // tablas: son parentesis, pero no traen $ y no deben borrar nada.
    const linea = "49055 PICHA-3/4X 3/4' (19 mm) 6 48 $150 $165 $180 3";

    assert.deepEqual(importesDeLinea(linea), [150, 165, 180]);
});
