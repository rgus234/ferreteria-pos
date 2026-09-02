// Reglas de decision del reporte de codigos de barras cruzados.
//
// Estas funciones deciden si el reporte le dice al dueno "estos dos son
// el mismo producto, fusionalos" -- consejo que borra un producto y junta
// su stock, y que no se deshace. Todos los casos de aqui son pares reales
// del inventario de Ferreteria Olimpico, y los tres primeros son errores
// que este reporte cometio de verdad antes de tener estas reglas.

const { test } = require("node:test");
const assert = require("node:assert/strict");

const {
    esElMismoProducto, mejorCoincidencia, sustantivo, medidas
} = require("../scripts/revisar-codigos-cruzados");

test("dos medidas distintas NO son el mismo producto", () => {
    // El primer error: el filtro de "palabras de 4+ letras" tiraba justo
    // los numeros, que es lo unico que separa a estos dos.
    assert.equal(
        esElMismoProducto(
            "Piedra para asentar 100 mm, doble grano 150 y 240, TRUPER",
            "Piedra para asentar 150 mm, doble grano 150 y 240, TRUPER"
        ),
        false
    );

    assert.equal(
        esElMismoProducto(
            "Bolsa con 20 taquetes de plastico 5/16', FIERO",
            "Bolsa con 50 taquetes de plastico 5/16', FIERO"
        ),
        false
    );

    assert.equal(
        esElMismoProducto(
            "Punta pol de laton 3/8' x 12 cm, de espiga, FOSET",
            "Punta pol de laton 3/8' x 6 cm, de espiga, FOSET"
        ),
        false
    );
});

test("una palabra que cambia el producto pesa, aunque el resto sea igual", () => {
    // El segundo error: medir contra el conjunto menor dejaba que la
    // marca y el relleno cargaran el parecido.
    assert.equal(
        esElMismoProducto(
            "Espatula rigida 1' con mango de madera, Truper",
            "Espatula flexible 1' con mango de madera, TRUPER"
        ),
        false
    );

    assert.equal(
        esElMismoProducto(
            "Filtro para agua, lavable, tecnologia de discos, FOSET",
            "Filtro de agua para tinaco, FOSET"
        ),
        false
    );

    assert.equal(
        esElMismoProducto(
            "Manguera para gas, vinilo, 3/8' flare, 100 cm, FOSET",
            "Manguera para gas, aluminio, 3/8' flare, 100 cm, FOSET BASIC"
        ),
        false
    );
});

test("el mismo producto capturado dos veces SI se reconoce", () => {
    // Solo cambia como se escribio la marca.
    assert.equal(
        esElMismoProducto(
            "Cautin 30 W tipo lapiz con accesorios trabajo ligero, PRETUL",
            "Cautin 30 W tipo lapiz con accesorios trabajo ligero, Pretul"
        ),
        true
    );

    assert.equal(
        esElMismoProducto(
            "Boton lateral plastico cromado para WC, FOSET",
            "Boton lateral plastico cromado para WC, FOSET"
        ),
        true
    );
});

test("se elige la MEJOR coincidencia del catalogo, no la primera", () => {
    // El tercer error, y es el mismo que hacia el POS al escanear: tomar
    // el primero que pasara el umbral. Aqui el [197] comparte "manguera"
    // y va primero, pero el catalogo describe al [2013] casi palabra por
    // palabra.
    const productos = [
        { id: 197, nombre: "Reparador 5/8'-3/4' de ABS para manguera, Truper" },
        { id: 2013, nombre: "Juego de 6 piezas para reparar mangueras de 3/8' NPT, TRUPER" }
    ];

    const elegido = mejorCoincidencia(
        productos, "Juego de 6 piezas para reparar mangueras de 3/8' NPT, TRUPER"
    );

    assert.equal(elegido?.id, 2013);
});

test("si el catalogo no describe a ninguno, no se inventa un ganador", () => {
    // Caso real: el codigo es de una tijera y en el inventario esta en una
    // charola y un lente. Los dos lo tienen mal, y decir "es de la
    // charola" -- solo porque comparte "acero inoxidable" -- mandaria al
    // dueno a dejar el codigo justo donde no va.
    const productos = [
        { id: 156, nombre: "Charola de acero inoxidable para BASE-20, TRUPER" },
        { id: 2067, nombre: "Lente sombra 11 para caretas CASO-3 y CASO-300-P, TRUPER" }
    ];

    assert.equal(
        mejorCoincidencia(productos, "Tijera 9-1/2' de acero inoxidable para costura, TRUPER"),
        null
    );
});

test("con dos candidatos igual de parecidos tampoco se desempata", () => {
    // Par real: las dos bisagras. El catalogo nombra la de 110 grados
    // cobertura completa, y los dos productos del inventario le pegan
    // igual de bien -- uno por las palabras, el otro por los grados. Si
    // el catalogo no distingue, decir que si seria inventar certeza.
    const productos = [
        { id: 112, nombre: "Bolsa c/2 bisagras bidimensionales de 95 grados cobertura completa" },
        { id: 2047, nombre: "2 bisagras bidimensionales 110 grados, cobertura completa, HERMEX" }
    ];

    assert.equal(
        mejorCoincidencia(
            productos,
            "Bolsa c/2 bisagras bidimensionales de 110 grados cobertura completa, HERMEX"
        ),
        null
    );
});

test("cuando el catalogo SI nombra a uno exacto, ese gana", () => {
    // El reverso del caso anterior: aqui no hay empate que respetar.
    const productos = [
        { id: 459, nombre: "Valvula de control de laton para gas, 3/8' x 1/2', FOSET" },
        { id: 460, nombre: "Valvula de control laton para gas 3/8'x1/2' tipo barrilito" }
    ];

    assert.equal(
        mejorCoincidencia(productos, "Valvula de control de laton para gas, 3/8' x 1/2', FOSET")?.id,
        459
    );
});

test("el sustantivo inicial es lo que dice QUE ES la cosa", () => {
    assert.equal(sustantivo("Charola de acero inoxidable para BASE-20, TRUPER"), "charola");
    assert.equal(sustantivo("Tijera 9-1/2' de acero inoxidable"), "tijera");
    // Las palabras cortas del principio se saltan.
    assert.equal(sustantivo("Kit de espatulas"), "espatulas");
});

test("las medidas se leen con fracciones y todo", () => {
    assert.deepEqual([...medidas("Broca para concreto de 3/8 x 6', TRUPER")].sort(), ["3/8", "6"]);
    assert.deepEqual([...medidas("Bolsa con 50 taquetes 5/16'")].sort(), ["5/16", "50"]);
});
