// Presupuesto de llamadas a vision.
//
// La vision es el respaldo caro: solo entra cuando el OCR no pudo leer un
// modulo, y tiene un tope por corrida para que una carga de 7.900 modulos
// no se convierta en una factura sorpresa.
//
// El bug que motiva estas pruebas se midio en la carga real: 15 productos
// leidos por vision de un tope de 300, con 3.623 modulos en revision
// esperando justo ese respaldo. El adaptador descontaba del tope en CADA
// unidad donde la vision era posible -- no donde se usaba -- asi que las
// primeras 300 unidades, casi todas leidas bien por OCR, agotaban el
// presupuesto y apagaban el respaldo para el resto del catalogo.
//
// El arreglo depende de que el extractor diga si LLAMO a la vision. Eso
// es lo que se prueba aqui.

const { test, after } = require("node:test");
const assert = require("node:assert/strict");
const sharp = require("sharp");

const { extraerTablaDeModulo, liberarWorkerOcr } = require("../catalogo-fabricante-ocr");

// Sin esto el proceso de pruebas no termina nunca: el worker de tesseract
// queda vivo y node espera por el. Las pruebas pasan, pero el archivo se
// queda colgado al final y parece que fallo.
after(async () => { await liberarWorkerOcr(); });

// Una imagen que no es una tabla de precios. El OCR no va a poder leerla,
// que es exactamente el caso en que debe entrar la vision.
async function imagenIlegible() {
    return sharp({
        create: { width: 600, height: 400, channels: 3, background: { r: 210, g: 210, b: 210 } }
    }).jpeg().toBuffer();
}

test("si el OCR no pudo leer, se llama a la vision y se anota", async () => {
    let llamadas = 0;
    const anthropicFalso = {
        messages: {
            create: async () => {
                llamadas++;
                return { content: [{ type: "text", text: "[]" }] };
            }
        }
    };

    const r = await extraerTablaDeModulo(await imagenIlegible(), {
        codigosEsperados: ["103013"],
        columnasForzadas: ["precio_mayoreo", "precio_medio_mayoreo", "precio_publico"],
        anthropic: anthropicFalso
    });

    assert.equal(r.confiable, false, "una imagen sin tabla no puede salir confiable");
    assert.equal(r.intentoVision, true, "se intento la vision");
    assert.ok(llamadas > 0, "y de verdad se llamo al modelo");
});

test("se anota el gasto aunque la vision no sirva de nada", async () => {
    // La cuenta es de dinero y de cuota: una llamada que no resolvio nada
    // cuesta igual que una que si. Contar solo los aciertos haria que el
    // tope no topara nada.
    const anthropicQueFalla = {
        messages: { create: async () => { throw new Error("sin cuota"); } }
    };

    const r = await extraerTablaDeModulo(await imagenIlegible(), {
        codigosEsperados: ["103013"],
        columnasForzadas: ["precio_publico"],
        anthropic: anthropicQueFalla
    });

    assert.equal(r.intentoVision, true, "se gasto el intento aunque haya reventado");
    assert.equal(r.confiable, false);
    assert.ok(r.avisos.some(a => /vision/i.test(a)), "y queda constancia del fallo");
});

test("sin cliente de vision no se intenta nada", async () => {
    const r = await extraerTablaDeModulo(await imagenIlegible(), {
        codigosEsperados: ["103013"],
        columnasForzadas: ["precio_publico"]
    });

    assert.equal(r.intentoVision, false);
    assert.equal(r.confiable, false, "sigue yendo a revision, sin gastar nada");
});
