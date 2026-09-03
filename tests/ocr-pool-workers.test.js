// Pool de workers de OCR.
//
// Existe porque leer los ~7.900 modulos de TRUPER con un solo worker son
// ~28 horas con quince nucleos parados. Y se prueba porque su primera
// version colgo la carga a las 3h30m: reciclar los workers vaciaba la
// lista de espera, asi que las tareas formadas se quedaban con una
// promesa que nadie iba a resolver. El proceso seguia vivo, sin avanzar,
// hasta que el vigilante de 15 minutos lo mato.
//
// Con un solo worker ese bug no podia existir (no habia fila). El pool lo
// volvio posible, asi que la fila es justo lo que hay que cubrir.

const { test } = require("node:test");
const assert = require("node:assert/strict");

const { tomarWorker, devolverWorker, reciclarWorkersOcr, liberarWorkerOcr } =
    require("../catalogo-fabricante-ocr");

// tesseract tarda segundos en arrancar de verdad; aqui solo interesa la
// mecanica del pool, asi que se sustituye por un doble.
const Tesseract = require("tesseract.js");
const crearOriginal = Tesseract.createWorker;

function usarWorkersDeMentira() {
    let n = 0;
    const creados = [];
    Tesseract.createWorker = async () => {
        const worker = {
            id: ++n,
            terminado: false,
            async recognize() { return { data: { text: "", confidence: 0 } }; },
            async terminate() { worker.terminado = true; }
        };
        creados.push(worker);
        return worker;
    };
    return creados;
}

test("reciclar mientras hay tareas formadas NO las deja colgadas", async () => {
    // Este es el caso que tumbo la carga real.
    const creados = usarWorkersDeMentira();
    try {
        // Se ocupan todos (4 por defecto) para que el quinto haga fila.
        const tomados = [];
        for (let i = 0; i < 4; i++) tomados.push(await tomarWorker());

        let elQuintoLoConsiguio = false;
        const quinto = tomarWorker().then(worker => {
            elQuintoLoConsiguio = true;
            return worker;
        });

        // Reciclado en medio, que es lo que hace el script cada 150 modulos.
        reciclarWorkersOcr();

        // Devolver uno tiene que desatorar al que espera.
        devolverWorker(tomados.pop());

        const worker = await Promise.race([
            quinto,
            new Promise((_, rechazar) => setTimeout(() => rechazar(new Error("se quedo colgado")), 3000))
        ]);

        assert.equal(elQuintoLoConsiguio, true);
        assert.ok(worker, "recibio un worker utilizable");

        tomados.forEach(devolverWorker);
        devolverWorker(worker);
    } finally {
        await liberarWorkerOcr();
        Tesseract.createWorker = crearOriginal;
        creados.length = 0;
    }
});

test("reciclar no mata al worker que esta leyendo en ese momento", async () => {
    // Terminar un worker a media lectura tira el trabajo de ese modulo.
    // Los ocupados se marcan y mueren al devolverlos, no antes.
    const creados = usarWorkersDeMentira();
    try {
        const trabajando = await tomarWorker();

        reciclarWorkersOcr();

        assert.equal(trabajando.terminado, false,
            "el que estaba ocupado sigue vivo hasta que lo suelten");

        devolverWorker(trabajando);
        assert.equal(trabajando.terminado, true, "y muere al devolverlo");
    } finally {
        await liberarWorkerOcr();
        Tesseract.createWorker = crearOriginal;
        creados.length = 0;
    }
});

test("no se crean mas workers de los permitidos aunque pidan todos a la vez", async () => {
    // Reservar el cupo DESPUES del await dejaba pasar a varias tareas por
    // la misma comprobacion, y se creaban de mas -- que es como se acaba
    // la memoria a las tres horas.
    const creados = usarWorkersDeMentira();
    try {
        const tomados = await Promise.all(Array.from({ length: 4 }, () => tomarWorker()));

        assert.equal(creados.length, 4, `se crearon ${creados.length}, debian ser 4`);
        assert.equal(new Set(tomados).size, 4, "y ninguno se entrego dos veces");

        tomados.forEach(devolverWorker);
    } finally {
        await liberarWorkerOcr();
        Tesseract.createWorker = crearOriginal;
        creados.length = 0;
    }
});

test("un worker se reutiliza en vez de crear uno nuevo cada vez", async () => {
    // Crear un worker por imagen dominaria el tiempo de una corrida de
    // miles de modulos: es la razon de que exista el pool.
    const creados = usarWorkersDeMentira();
    try {
        const primero = await tomarWorker();
        devolverWorker(primero);
        const segundo = await tomarWorker();

        assert.equal(segundo, primero, "el mismo worker vuelve a usarse");
        assert.equal(creados.length, 1);

        devolverWorker(segundo);
    } finally {
        await liberarWorkerOcr();
        Tesseract.createWorker = crearOriginal;
        creados.length = 0;
    }
});
