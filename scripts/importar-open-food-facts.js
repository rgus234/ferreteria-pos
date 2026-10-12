// Carga la identidad de productos de abarrotes de Open Food Facts en el
// Catalogo Maestro.
//
//   node --env-file=.env scripts/importar-open-food-facts.js <archivo.jsonl>             (simula)
//   node --env-file=.env scripts/importar-open-food-facts.js <archivo.jsonl> --aplicar
//   node --env-file=.env scripts/importar-open-food-facts.js --revertir <id de corrida>
//
// El archivo es un JSONL con un producto de Open Food Facts por linea, ya
// filtrado a Mexico (ver "Fuente de datos" abajo). Por omision SIMULA: lee,
// decide y reporta sin escribir una sola fila. Hay que pedir --aplicar a
// proposito, y la carga es reversible (--revertir).
//
// Reglas del Maestro (las mismas de ferreteria): solo IDENTIDAD de producto
// (EAN, nombre, marca, presentacion, categoria). Sin precios, sin fotos. Un
// EAN valido es un unico producto; ante conflicto no se fusiona. Lo que el
// Maestro ya conoce por EAN (Truper/Diprofer, aportes de negocios) NO se toca.
//
// Fuente de datos: volcado oficial de Open Food Facts
// (en.openfoodfacts.org.products.csv.gz), filtrado a countries_tags = en:mexico.
// Licencia ODbL -- ver "Atribucion" en el reporte.

const fs = require("fs");
const readline = require("readline");
const pool = require("../db");
const { revertir } = require("../catalogo-maestro-reconciliacion");
const { cargarMasivo } = require("../catalogo-maestro-carga-masiva");
const { normalizarRegistroOff, subcategoriaNexoAbarrotes, unificarMarcas, FUENTE_OFF } = require("../catalogo-maestro-openfoodfacts");

async function leerRegistros(archivo) {
    const registros = [];
    const lector = readline.createInterface({ input: fs.createReadStream(archivo, "utf8"), crlfDelay: Infinity });
    for await (const linea of lector) {
        if (!linea.trim()) continue;
        try { registros.push(JSON.parse(linea)); } catch { /* linea rota: se ignora */ }
    }
    return registros;
}

async function idsSubcategoriasAbarrotes() {
    const r = await pool.query(`SELECT id, nombre FROM public.categorias_nexo WHERE giro = 'abarrotes'`);
    return new Map(r.rows.map(f => [f.nombre.toLowerCase(), f.id]));
}

async function eanExistentes() {
    const r = await pool.query(`SELECT valor FROM public.catalogo_maestro_identificadores WHERE tipo = 'ean'`);
    return new Set(r.rows.map(f => f.valor));
}

function contar(mapa, clave, n = 1) {
    mapa.set(clave, (mapa.get(clave) || 0) + n);
}

function top(mapa, n) {
    return [...mapa.entries()].sort((a, b) => b[1] - a[1]).slice(0, n);
}

async function main() {
    const args = process.argv.slice(2);
    const indiceRevertir = args.indexOf("--revertir");

    if (indiceRevertir !== -1) {
        const id = Number(args[indiceRevertir + 1]);
        if (!Number.isInteger(id)) throw new Error("uso: --revertir <id de corrida>");
        const r = await revertir(pool, id);
        console.log(`Corrida ${id} revertida: ${r.productosBorrados} productos maestros borrados.`);
        return;
    }

    const archivo = args.find(a => !a.startsWith("--"));
    const aplicar = args.includes("--aplicar");
    if (!archivo || !fs.existsSync(archivo)) throw new Error("uso: importar-open-food-facts.js <archivo.jsonl> [--aplicar]");

    const crudos = await leerRegistros(archivo);
    const subcategorias = await idsSubcategoriasAbarrotes();
    const yaConocidos = await eanExistentes();

    const descartes = new Map();
    const marcas = new Map();
    const categoriasSinMapear = new Map();
    const porCategoria = new Map();
    const vistos = new Set();
    let filas = [];
    let existentes = 0, repetidosEnArchivo = 0, conCategoria = 0, conMarca = 0, conPresentacion = 0;
    const ejemplosMapeados = [];
    const ejemplosSinMapear = [];

    for (const crudo of crudos) {
        const r = normalizarRegistroOff(crudo);
        if (!r.ok) { contar(descartes, r.motivo); continue; }

        const fila = r.fila;
        if (vistos.has(fila.ean)) { repetidosEnArchivo++; continue; }
        vistos.add(fila.ean);

        // Lo que el Maestro ya conoce no se vuelve a escribir ni a tocar.
        if (yaConocidos.has(fila.ean)) { existentes++; continue; }

        const nombreSub = subcategoriaNexoAbarrotes(r.categoriasTags, fila.nombre, fila.marca);
        fila._tags = r.categoriasTags;
        fila.categoriaNexoId = nombreSub ? (subcategorias.get(nombreSub.toLowerCase()) || null) : null;

        if (fila.categoriaNexoId) {
            conCategoria++;
            contar(porCategoria, nombreSub);
            if (ejemplosMapeados.length < 12) ejemplosMapeados.push(`${fila.nombre} [${fila.marca}] -> ${nombreSub}`);
        } else {
            for (const tag of r.categoriasTags.slice(-3)) contar(categoriasSinMapear, tag);
            if (ejemplosSinMapear.length < 12) ejemplosSinMapear.push(`${fila.nombre} [${fila.marca}] (${r.categoriasTags.slice(-2).join(" | ")})`);
        }
        if (fila.marca) { conMarca++; contar(marcas, fila.marca); }
        if (fila.presentacion) conPresentacion++;

        filas.push(fila);
    }

    const marcasUnificadas = unificarMarcas(filas);
    marcas.clear();
    for (const f of filas) if (f.marca) contar(marcas, f.marca);

    const linea = (etiqueta, valor) => console.log("  " + String(etiqueta).padEnd(42) + String(valor).padStart(8));
    console.log("\n=================================================================");
    console.log(aplicar ? "  CARGA (se escribira en el Catalogo Maestro)" : "  SIMULACION -- no se escribio ninguna fila");
    console.log("=================================================================");
    linea("registros de Open Food Facts leidos", crudos.length);
    for (const [motivo, n] of top(descartes, 12)) linea(`  descartados: ${motivo}`, n);
    linea("repetidos dentro del archivo", repetidosEnArchivo);
    linea("YA conocidos por el Maestro (no se tocan)", existentes);
    console.log("  -----------------------------------------------------------------");
    linea("productos NUEVOS a cargar", filas.length);
    linea("  con marca", conMarca);
    linea("  marcas unificadas (Nestle/Nestlé...)", marcasUnificadas);
    linea("  con presentacion", conPresentacion);
    linea("  con categoria Nexo", `${conCategoria} (${filas.length ? Math.round(conCategoria / filas.length * 100) : 0}%)`);
    console.log("\n  Por subcategoria:");
    for (const [nombre, n] of top(porCategoria, 50)) console.log("   " + String(n).padStart(6) + "  " + nombre);
    console.log("\n  Marcas con mas productos:");
    console.log("   " + top(marcas, 25).map(([m, n]) => `${m} (${n})`).join(", "));
    console.log("\n  Ejemplos CLASIFICADOS:");
    ejemplosMapeados.forEach(e => console.log("   - " + e));
    console.log("\n  Ejemplos SIN categoria:");
    ejemplosSinMapear.forEach(e => console.log("   - " + e));
    console.log("\n  Etiquetas de OFF mas frecuentes entre los SIN categoria (para afinar reglas):");
    console.log("   " + top(categoriasSinMapear, 25).map(([t, n]) => `${t} (${n})`).join(", "));

    if (!aplicar) {
        console.log("\n  Para escribir de verdad: agrega --aplicar\n");
        return;
    }

    console.log("\n  Escribiendo...");
    // Las filas ya vienen deduplicadas por EAN y filtradas contra lo que el
    // Maestro conoce, asi que se cargan por lotes (el motor fila por fila
    // tardaria ~90 minutos contra la base remota). Una sola transaccion: si algo
    // falla, no queda nada a medias.
    const reporte = await cargarMasivo(pool, filas, {
        fuente: FUENTE_OFF,
        alAvanzar: (hechas, total) => process.stdout.write(`\r  ${hechas} / ${total}`)
    });
    console.log("\n\n  RESULTADO");
    linea("productos maestros creados", reporte.productosCreados);
    linea("identificadores asociados", reporte.identificadoresCreados);
    linea("omitidos (el EAN ya existia)", reporte.duplicadosEvitados);
    console.log("\n  id de la corrida: " + reporte.reconciliacionId + "   (revertir: --revertir " + reporte.reconciliacionId + ")");
    console.log("\n  Atribucion requerida (ODbL): \"Contains information from Open Food Facts, made available under the Open Database License (ODbL).\"\n");
}

main()
    .catch(error => {
        console.error("Fallo la importacion:", error.message);
        process.exitCode = 1;
    })
    .finally(() => pool.end());
