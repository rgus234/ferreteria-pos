// Codigos de barras que apuntan a mas de un producto, y codigos que el
// catalogo del proveedor atribuye a otro producto distinto.
//
//   node --env-file=.env scripts/revisar-codigos-cruzados.js [negocioId]
//
// SOLO LEE. No corrige nada a proposito: decidir cual producto se queda
// con cual codigo es del dueno, que es quien tiene la caja enfrente y
// sabe cual de los dos vende. Lo que hace este script es dejarle la
// decision tomada casi por completo -- cuando el catalogo del proveedor
// puede desempatar, lo dice.
//
// Por que importa: hasta el arreglo de hoy, escanear un codigo compartido
// agregaba al ticket el PRIMER producto que coincidiera, sin avisar. En
// Ferreteria Olimpico eso incluia un codigo con alambre de $79 y una
// empaquetadura de $15.50.

const pool = require("../db");

const NEGOCIO = Number(process.argv[2] || 1);

function normalizar(texto) {
    return String(texto || "")
        .toLowerCase()
        .normalize("NFD").replace(/[̀-ͯ]/g, "")
        .replace(/[^a-z0-9/. ]/g, " ");
}

// Palabras de 4+ letras, sin acentos. Las cortas ("de", "con") no
// distinguen nada entre productos de ferreteria.
function palabras(texto) {
    return new Set(normalizar(texto).split(/\s+/).filter(palabra => palabra.length > 3));
}

// Las MEDIDAS son lo que de verdad separa un producto de otro en una
// ferreteria: 100 mm contra 150 mm, bolsa de 20 contra bolsa de 50,
// espiga de 6 cm contra 12 cm. Y son justo lo que un filtro de "palabras
// largas" tira a la basura, porque casi todas tienen 1 o 2 caracteres.
//
// Sin esto el reporte mandaba a fusionar productos DISTINTOS -- consejo
// destructivo, porque fusionar junta stock y borra uno de los dos.
function medidas(texto) {
    return new Set(
        normalizar(texto)
            .split(/\s+/)
            .filter(token => /[0-9]/.test(token))
            .map(token => token.replace(/\.$/, ""))
    );
}

function mismasMedidas(a, b) {
    const A = medidas(a);
    const B = medidas(b);
    if (A.size !== B.size) return false;
    for (const token of A) if (!B.has(token)) return false;
    return true;
}

// Marcas y relleno. Dos productos completamente distintos del mismo
// fabricante comparten estas palabras, y eso inflaba el parecido lo
// suficiente para colar "Filtro de discos" con "Filtro de tinaco".
const RUIDO = new Set([
    "truper", "pretul", "foset", "fiero", "volteck", "hermex", "expert",
    "basic", "para", "tipo", "marca", "color", "bolsa"
]);

// Para decidir "es el mismo producto" se mide contra la UNION, no contra
// el menor: asi una palabra de mas -- "rigida" frente a "flexible" -- si
// pesa. El criterio de aqui manda a la gente a FUSIONAR, o sea a borrar
// un producto y juntar su stock; equivocarse en este lado no se deshace,
// asi que ante la duda el par se va al grupo de "decide tu".
function esElMismoProducto(a, b) {
    if (!mismasMedidas(a, b)) return false;

    const A = new Set([...palabras(a)].filter(p => !RUIDO.has(p)));
    const B = new Set([...palabras(b)].filter(p => !RUIDO.has(p)));
    if (A.size === 0 || B.size === 0) return false;

    let comunes = 0;
    A.forEach(palabra => { if (B.has(palabra)) comunes++; });
    return comunes / (A.size + B.size - comunes) >= 0.8;
}

// Que tanto se parecen dos nombres. Se compara contra el MENOR de los dos
// conjuntos: un nombre corto que esta contenido en uno largo es la misma
// cosa descrita con mas detalle, no un producto distinto.
function similitud(a, b) {
    const A = palabras(a);
    const B = palabras(b);
    if (A.size === 0 || B.size === 0) return 1;

    let comunes = 0;
    A.forEach(palabra => { if (B.has(palabra)) comunes++; });
    return comunes / Math.min(A.size, B.size);
}

// Por debajo de esto, dos nombres describen cosas distintas. Calibrado a
// mano contra el inventario real: deja pasar "focos LED 10W" contra
// "lamparas LED 10 W" (el mismo producto con otras palabras) y separa
// "Lente sombra 11" de "Tijera 9-1/2'".
const UMBRAL_PARECIDO = 0.35;

// Cual de los productos describe el catalogo, si es que describe alguno.
//
// Tiene que ser el MEJOR, no el primero que pase el umbral. Con "el
// primero" este reporte llegaba a decir que el codigo del "Juego de 6
// piezas para reparar mangueras" era del "Reparador de ABS para
// manguera" -- solo porque comparte la palabra "manguera" y venia antes
// en la lista -- teniendo al lado el producto que el catalogo nombra casi
// palabra por palabra. Es el mismo error que hacia el POS al escanear.
//
// Y se exige VENTAJA sobre el segundo: si dos productos se parecen igual
// al nombre del catalogo, el catalogo no esta desempatando nada y decirlo
// seria inventar una certeza que no hay.
const VENTAJA_MINIMA = 0.15;

// En un nombre de ferreteria la primera palabra con peso es QUE ES la
// cosa: "Charola...", "Tijera...", "Espatula...", "Filtro...". Todo lo
// demas -- acero, inoxidable, para, TRUPER -- lo comparten productos que
// no tienen nada que ver. Sin exigir que esta coincida, el reporte
// llegaba a decir que el codigo de una "Tijera 9-1/2' de acero
// inoxidable" era el de una "Charola de acero inoxidable".
function sustantivo(texto) {
    return normalizar(texto).split(/\s+/).find(palabra => palabra.length > 3) || "";
}

// Las medidas no se pueden CONTRADECIR. Un nombre puede traer mas
// detalle que el otro -- "Bolsa c/2 bisagras" contra "2 bisagras" -- pero
// si uno dice 95 grados y el otro 110, no son el mismo producto por mucho
// que compartan todas las palabras. Sin esto el reporte llegaba a decir
// que el codigo de las bisagras de 110 era el de las de 95.
function medidasCompatibles(a, b) {
    const A = medidas(a);
    const B = medidas(b);
    if (A.size === 0 || B.size === 0) return true;

    const [menor, mayor] = A.size <= B.size ? [A, B] : [B, A];
    for (const token of menor) if (!mayor.has(token)) return false;
    return true;
}

function mejorCoincidencia(productos, nombreCatalogo) {
    const cabeza = sustantivo(nombreCatalogo);

    const puntuados = productos
        // El sustantivo dice QUE ES; las medidas, CUAL de ellos. Se
        // exigen los dos, y el sustantivo se da por bueno tambien cuando
        // uno de los nombres omite el empaque ("Bolsa c/2 bisagras" y
        // "2 bisagras" son la misma cosa nombrada distinto).
        .filter(p =>
            (sustantivo(p.nombre) === cabeza || palabras(p.nombre).has(cabeza) || palabras(nombreCatalogo).has(sustantivo(p.nombre)))
            && medidasCompatibles(p.nombre, nombreCatalogo))
        .map(p => ({ producto: p, puntaje: similitud(p.nombre, nombreCatalogo) }))
        .sort((a, b) => b.puntaje - a.puntaje);

    const mejor = puntuados[0];
    if (!mejor || mejor.puntaje < UMBRAL_PARECIDO) return null;

    const segundo = puntuados[1];
    if (segundo && mejor.puntaje - segundo.puntaje < VENTAJA_MINIMA) return null;

    return mejor.producto;
}

function dinero(valor) {
    return "$" + Number(valor || 0).toFixed(2);
}

async function codigosCompartidos() {
    const { rows } = await pool.query(
        `SELECT codigo,
                JSON_AGG(JSON_BUILD_OBJECT(
                    'id', id, 'nombre', nombre, 'stock', stock,
                    'precio', COALESCE(precio_publico, precio, 0)
                ) ORDER BY id) AS productos
           FROM public.productos
          WHERE negocio_id = $1 AND COALESCE(codigo, '') <> ''
          GROUP BY codigo
         HAVING COUNT(*) > 1`,
        [NEGOCIO]
    );

    // El desempate: que dice el catalogo del proveedor sobre ese codigo.
    const duenos = new Map();
    if (rows.length > 0) {
        const { rows: catalogo } = await pool.query(
            `SELECT DISTINCT ON (codigo_barras) codigo_barras, nombre_proveedor, codigo_proveedor
               FROM public.catalogo_productos
              WHERE negocio_id = $1 AND codigo_barras = ANY($2::text[])
              ORDER BY codigo_barras, id DESC`,
            [NEGOCIO, rows.map(f => f.codigo)]
        );
        catalogo.forEach(f => duenos.set(f.codigo_barras, f));
    }

    return rows.map(fila => {
        const productos = fila.productos;
        const precios = productos.map(p => Number(p.precio));
        const dueno = duenos.get(fila.codigo) || null;

        // Un solo producto capturado dos veces se fusiona sin pensarlo;
        // dos productos distintos hay que decidirlos. Se exigen LAS DOS
        // cosas -- nombres muy parecidos Y las mismas medidas -- porque
        // "Piedra para asentar 100 mm" y "...150 mm" comparten casi todas
        // las palabras y no son el mismo producto ni de lejos.
        const nombres = productos.map(p => p.nombre);
        const esElMismo = nombres.every(n => esElMismoProducto(n, nombres[0]));

        return {
            codigo: fila.codigo,
            productos,
            brecha: Math.max(...precios) - Math.min(...precios),
            esElMismo,
            // A quien del inventario le corresponde el codigo segun el
            // catalogo. Puede ser NINGUNO: pasa cuando el codigo se copio
            // de una fila corrida y su dueno real ni siquiera esta dado
            // de alta.
            segunCatalogo: dueno,
            coincideCon: dueno ? mejorCoincidencia(productos, dueno.nombre_proveedor) : null
        };
    }).sort((a, b) => b.brecha - a.brecha);
}

// Productos cuyo codigo NO esta repetido pero que el catalogo atribuye a
// otra cosa. Estos son invisibles para cualquier chequeo de duplicados y
// aun asi cobran mal.
async function codigosAjenos() {
    const { rows } = await pool.query(
        `SELECT p.id, p.nombre, p.codigo, cp.nombre_proveedor, cp.codigo_proveedor
           FROM public.productos p
           JOIN public.catalogo_productos cp
             ON cp.negocio_id = p.negocio_id AND cp.codigo_barras = p.codigo
          WHERE p.negocio_id = $1 AND COALESCE(p.codigo, '') <> ''`,
        [NEGOCIO]
    );

    return rows
        .filter(f => similitud(f.nombre, f.nombre_proveedor) < UMBRAL_PARECIDO)
        .sort((a, b) => a.nombre.localeCompare(b.nombre));
}

async function main() {
    const compartidos = await codigosCompartidos();
    const ajenos = await codigosAjenos();

    const mismos = compartidos.filter(c => c.esElMismo);
    const distintos = compartidos.filter(c => !c.esElMismo);

    console.log(`\n=== CODIGOS DE BARRAS CRUZADOS -- negocio ${NEGOCIO} ===\n`);

    if (compartidos.length === 0 && ajenos.length === 0) {
        console.log("Ningun codigo apunta a mas de un producto. Nada que revisar.\n");
        return;
    }

    if (mismos.length > 0) {
        console.log(`A) EL MISMO PRODUCTO CAPTURADO DOS VECES -- ${mismos.length}`);
        console.log("   Se pueden fusionar: junta el stock y quedate con uno.\n");
        for (const c of mismos) {
            console.log(`   ${c.codigo}`);
            c.productos.forEach(p =>
                console.log(`      [${p.id}] ${p.nombre}  ${dinero(p.precio)}  stock ${p.stock}`));
            console.log("");
        }
    }

    if (distintos.length > 0) {
        console.log(`B) PRODUCTOS DISTINTOS CON EL MISMO CODIGO -- ${distintos.length}`);
        console.log("   Uno de los dos tiene el codigo equivocado. Ordenados por");
        console.log("   diferencia de precio: arriba lo que mas cuesta equivocarse.\n");

        for (const c of distintos) {
            console.log(`   ${c.codigo}   diferencia ${dinero(c.brecha)}`);
            c.productos.forEach(p =>
                console.log(`      [${p.id}] ${p.nombre}  ${dinero(p.precio)}  stock ${p.stock}`));

            if (c.coincideCon) {
                console.log(`      -> Tu catalogo dice que este codigo es de "${c.segunCatalogo.nombre_proveedor}"`);
                console.log(`         (clave ${c.segunCatalogo.codigo_proveedor}), o sea del [${c.coincideCon.id}].`);
                console.log("         Al otro hay que ponerle su codigo real.");
            } else if (c.segunCatalogo) {
                console.log(`      -> Tu catalogo dice que este codigo es de "${c.segunCatalogo.nombre_proveedor}"`);
                console.log(`         (clave ${c.segunCatalogo.codigo_proveedor}), que no se parece claramente a`);
                console.log("         ninguno de los de arriba. Revisa el producto fisico.");
            } else {
                console.log("      -> Tu catalogo de proveedor no tiene este codigo: hay que verlo en el producto fisico.");
            }
            console.log("");
        }
    }

    if (ajenos.length > 0) {
        console.log(`C) CODIGO QUE PERTENECE A OTRO PRODUCTO -- ${ajenos.length}`);
        console.log("   No estan repetidos, asi que ningun chequeo de duplicados los ve,");
        console.log("   y aun asi al escanearlos sale lo que no es. Revisa el producto");
        console.log("   fisico: puede que solo sea el mismo articulo escrito distinto.\n");
        for (const f of ajenos) {
            console.log(`   [${f.id}] ${f.nombre}`);
            console.log(`      tiene el codigo ${f.codigo}, que tu catalogo asigna a:`);
            console.log(`      "${f.nombre_proveedor}" (clave ${f.codigo_proveedor})\n`);
        }
    }

    console.log("--------------------------------------------------------------");
    console.log(`  ${compartidos.length} codigos compartidos  |  ${ajenos.length} con codigo de otro producto`);
    console.log("  Mientras no se corrijan, al escanearlos el POS ya no cobra a");
    console.log("  ciegas: avisa y te deja elegir cual de los dos es.");
    console.log("--------------------------------------------------------------\n");
}

if (require.main === module) main()
    .catch(error => {
        console.error("Fallo la revision:", error.message);
        process.exitCode = 1;
    })
    .finally(() => pool.end());

// Se exportan las funciones de decision para poder probarlas: son las que
// deciden si el reporte le dice al dueno "fusiona estos dos", y ese
// consejo borra un producto. Ya se equivocaron dos veces mientras se
// escribia esto.
module.exports = { esElMismoProducto, mejorCoincidencia, sustantivo, medidas, similitud };
