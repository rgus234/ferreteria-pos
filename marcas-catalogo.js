// Catalogo central de MARCAS de abarrotes. Vive en Nexo (no por negocio): cada marca trae su logo (public/marcas/<id>.jpg), su color y las
// palabras con las que se reconoce un producto. Sirve para que un abarrotes nuevo ya tenga sus exhibidores por marca (Sabritas, Coca-Cola,
// Gamesa...) sin armarlos a mano: cada producto que se da de alta cae solo en el exhibidor de su marca.
// Los exhibidores se crean al hacer falta (cuando llega el primer producto de esa marca) y nunca se duplican.
const fs = require("fs");
const path = require("path");

const MARCAS = [
    { id: "sabritas", nombre: "Sabritas", color: "rojo", palabras: ["sabritas", "doritos", "cheetos", "ruffles", "tostitos", "fritos", "rancheritos", "pake taxo", "pake tako", "paketaxo", "churrumais", "kacang", "crujitos", "riffles"] },
    { id: "coca-cola", nombre: "Coca-Cola", color: "rojo", palabras: ["coca", "fanta", "sprite", "ciel", "fresca", "powerade", "power ade", "del valle", "topo chico", "topo-chico", "fuze", "sidral", "mundet", "kermato"] },
    { id: "pepsi", nombre: "Pepsi", color: "azul", palabras: ["pepsi", "7up", "7 up", "mirinda", "manzanita", "e-pura", "epura", "gatorade", "lipton", "squirt"] },
    { id: "gamesa", nombre: "Gamesa", color: "naranja", palabras: ["gamesa", "marias", "emperador", "saladitas", "chokis", "cremax", "mamut", "arcoiris", "crackets", "ricanelas", "maravillas", "fruts", "florentinas", "flor de naranjo", "chocolatines", "barras de coco", "multigrano", "paketon", "giro"] },
    { id: "bimbo", nombre: "Bimbo", color: "azul", palabras: ["bimbo", "bimbollos", "medias noches", "rebanadas", "conchas", "nito", "oroweat", "mantecadas", "panque", "hotkis", "donitas", "little bites", "pan tostado", "empanizador", "mini pan", "crossantines", "mante-chox", "mante chox", "branfrut", "bran frut"] },
    { id: "marinela", nombre: "Marinela", color: "morado", palabras: ["marinela", "gansito", "pinguinos", "canelitas", "napolitano", "submarinos", "chocoroles", "choco roles", "barritas"] },
    { id: "nestle", nombre: "Nestlé", color: "verde", palabras: ["nescafe", "carnation", "lechera", "nesquik", "choco-milk", "chocomilk", "nestle"] },
    { id: "arizona", nombre: "Arizona", color: "verde", palabras: ["arizona"] },
    { id: "bonafont", nombre: "Bonafont", color: "naranja", palabras: ["bonafont"] },
    { id: "dr-pepper", nombre: "Dr Pepper", color: "rojo", palabras: ["dr pepper", "dr. pepper"] },
    { id: "jarritos", nombre: "Jarritos", color: "verde", palabras: ["jarrito", "jarritos"] },
    { id: "monster", nombre: "Monster", color: "negro", palabras: ["monster"] },
    { id: "penafiel", nombre: "Peñafiel", color: "rojo", palabras: ["penafiel"] },
    { id: "volt", nombre: "Volt", color: "azul", palabras: ["volt"] },
    { id: "v8", nombre: "V8", color: "rojo", palabras: ["v8"] }
];

const plano = texto => String(texto || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

// Palabra COMPLETA dentro del nombre ("nito" no coincide dentro de "Juanito"; "jarrito" si en "Jarrito Piña").
function coincidePalabra(nombrePlano, palabra) {
    const escapada = palabra.replace(/[.*+?^${}()|[]\]/g, "\// Marca de un producto por su nombre.");
    return new RegExp(`(^|[^a-z0-9])${escapada}([^a-z0-9]|$)`).test(nombrePlano);
}

// Marca de un producto por su nombre. "Peñafiel Twist" -> Peñafiel; "Power Ade" -> Coca-Cola. Las marcas con nombre propio (Arizona,
// Bonafont...) mandan sobre las de familia (Coca-Cola, Pepsi) si ambas coinciden.
function marcaDeProducto(nombre) {
    const n = plano(nombre);
    const propias = MARCAS.filter(m => m.palabras.length <= 2);
    const familias = MARCAS.filter(m => m.palabras.length > 2);

    for (const m of [...propias, ...familias]) {
        if (m.palabras.some(p => coincidePalabra(n, p))) return m;
    }

    return null;
}

function logoDeMarca(marca) {
    try {
        const ruta = path.join(__dirname, "public", "marcas", `${marca.id}.jpg`);
        return `data:image/jpeg;base64,${fs.readFileSync(ruta).toString("base64")}`;
    } catch (error) {
        return null;
    }
}

// Que el exhibidor de la marca exista en el negocio (se crea con su logo y color si falta). Devuelve su id.
async function asegurarExhibidorDeMarca(db, negocioId, marca) {
    const hallado = await db.query(`SELECT id FROM public.exhibidores WHERE negocio_id = $1 AND lower(nombre) = lower($2) LIMIT 1`, [negocioId, marca.nombre]);

    if (hallado.rows[0]) return hallado.rows[0].id;

    const creado = await db.query(
        `INSERT INTO public.exhibidores (negocio_id, nombre, descripcion, color, foto) VALUES ($1,$2,$3,$4,$5) RETURNING id`,
        [negocioId, marca.nombre, `Productos ${marca.nombre}`, marca.color, logoDeMarca(marca)]
    );

    return creado.rows[0].id;
}

// Pone un producto en el exhibidor de su marca (si es de una marca del catalogo y aun no esta en ese exhibidor).
// Un producto que el dueño ya acomodo en otro exhibidor no se mueve ni se duplica. Nunca lanza: es un extra del alta.
async function colocarProductoEnMarca(db, negocioId, productoId, nombre) {
    try {
        const marca = marcaDeProducto(nombre);

        if (!marca) return null;

        const yaEnAlguno = await db.query(`SELECT 1 FROM public.exhibidor_espacios WHERE negocio_id = $1 AND producto_id = $2 LIMIT 1`, [negocioId, productoId]);

        if (yaEnAlguno.rows.length) return null;

        const exhibidorId = await asegurarExhibidorDeMarca(db, negocioId, marca);
        const orden = (await db.query(`SELECT COALESCE(MAX(orden), -1) + 1 AS o FROM public.exhibidor_espacios WHERE exhibidor_id = $1`, [exhibidorId])).rows[0].o;

        await db.query(
            `INSERT INTO public.exhibidor_espacios (negocio_id, exhibidor_id, producto_id, etiqueta, capacidad, orden) VALUES ($1,$2,$3,'',24,$4)`,
            [negocioId, exhibidorId, productoId, orden]
        );

        return marca.nombre;
    } catch (error) {
        console.error("No se pudo colocar el producto en su marca", error.message);
        return null;
    }
}

// Para un negocio que YA tiene productos: crea los exhibidores de las marcas que encuentre y acomoda los productos que no esten en ninguno.
async function armarExhibidoresDeMarcas(db, negocioId) {
    const productos = (await db.query(
        `SELECT p.id, p.nombre FROM public.productos p
         WHERE p.negocio_id = $1 AND NOT EXISTS (SELECT 1 FROM public.exhibidor_espacios e WHERE e.negocio_id = $1 AND e.producto_id = p.id)
         ORDER BY p.nombre`, [negocioId]
    )).rows;

    const porMarca = {};
    let colocados = 0;

    for (const p of productos) {
        const marca = await colocarProductoEnMarca(db, negocioId, p.id, p.nombre);

        if (marca) { porMarca[marca] = (porMarca[marca] || 0) + 1; colocados++; }
    }

    return { revisados: productos.length, colocados, porMarca };
}

// Solo los negocios con giro de abarrotes reciben exhibidores por marca (una ferreteria no).
async function esNegocioDeAbarrotes(db, negocioId) {
    const r = await db.query(
        `SELECT (lower(coalesce(n.giro,'')) LIKE '%abarrote%'
                 OR EXISTS (SELECT 1 FROM public.negocio_giros g WHERE g.negocio_id = n.id AND g.activo = true AND lower(g.giro) LIKE '%abarrote%')) AS si
         FROM public.negocios n WHERE n.id = $1`, [negocioId]
    );

    return Boolean(r.rows[0]?.si);
}

module.exports = { MARCAS, marcaDeProducto, logoDeMarca, asegurarExhibidorDeMarca, colocarProductoEnMarca, armarExhibidoresDeMarcas, esNegocioDeAbarrotes };
