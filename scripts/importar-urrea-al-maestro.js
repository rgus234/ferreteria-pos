// Pasa lo leido de urrea.com (scripts/rastrear-urrea.js -> tmp/urrea/productos.jsonl) al Catalogo Maestro de Nexo.
// Mismas reglas que el resto de catalogos de fabricante (ver catalogo-maestro-fabricante.js):
//   1. NUNCA precio ni foto: solo identidad (codigo, nombre, marca, descripcion).
//   2. NUNCA se pisa lo que ya hay: si el codigo ya existe y es de Urrea/Surtek/Foy no se toca.
//   3. `codigo` es UNICO en todo el Maestro: si el codigo de Urrea ya lo tiene OTRO fabricante (un "6000" de Truper, por
//      ejemplo), el producto entra como "URREA-<codigo>" para no mezclar dos productos distintos.
// Sin banderas solo simula. Con --aplicar escribe y guarda el respaldo en tmp/urrea/respaldo-importacion.json.
//   node --env-file=.env scripts/importar-urrea-al-maestro.js [--aplicar] [--archivo ruta.jsonl]
//   node --env-file=.env scripts/importar-urrea-al-maestro.js --deshacer tmp/urrea/respaldo-importacion.json
const fs = require("fs");
const path = require("path");
const pool = require("../db");

const FUENTE = "urrea.com";
const MARCAS = { urrea: "Urrea", surtek: "Surtek", foy: "Foy" };

// Marca segun las categorias del producto (el sitio pone la marca como una categoria mas: "urrea", "surtek", "surtek/lock").
function marcaDe(producto) {
    for (const c of producto.categorias || []) {
        const raiz = String(c.ruta || "").split("/")[0].toLowerCase();
        if (MARCAS[raiz]) return MARCAS[raiz];
    }

    return "";
}

function categoriaDe(producto) {
    const c = (producto.categorias || []).filter(x => String(x.ruta || "").startsWith("productos/")).sort((a, b) => b.ruta.length - a.ruta.length)[0];
    return c ? c.nombre.replace(/\s+/g, " ").trim() : "";
}

function limpiarNombre(nombre) {
    return String(nombre || "").replace(/\s+/g, " ").trim().slice(0, 240);
}

function descripcionCorta(texto) {
    return String(texto || "").replace(/\s+/g, " ").replace(/- /g, "• ").trim().slice(0, 600);
}

async function deshacer(archivo) {
    const respaldo = JSON.parse(fs.readFileSync(archivo, "utf8"));
    const r = await pool.query("DELETE FROM public.catalogo_maestro_productos WHERE codigo = ANY($1) AND fuente_identidad = $2 AND contribuido_por_negocio_id IS NULL", [respaldo.insertados, FUENTE]);
    console.log(`Quitados ${r.rowCount} de ${respaldo.insertados.length}.`);
}

async function importar({ aplicar, archivo }) {
    const productos = fs.readFileSync(archivo, "utf8").split("\n").filter(Boolean).map(l => JSON.parse(l));
    const codigos = productos.map(p => p.sku);

    const existentes = new Map((await pool.query("SELECT codigo, fabricante, marca FROM public.catalogo_maestro_productos WHERE codigo = ANY($1) OR codigo = ANY($2)", [codigos, codigos.map(c => `URREA-${c}`)])).rows.map(f => [f.codigo, f]));
    const nuevos = [], yaEstaban = [], conPrefijo = [], sinNombre = [];

    for (const p of productos) {
        const nombre = limpiarNombre(p.nombre);
        if (nombre.length < 3 || !p.sku) { sinNombre.push(p.sku); continue; }

        const marca = marcaDe(p) || "Urrea";
        const propio = existentes.get(p.sku);
        const conPrefijoExistente = existentes.get(`URREA-${p.sku}`);

        if (propio && MARCAS[String(propio.fabricante || propio.marca).toLowerCase()]) { yaEstaban.push(p.sku); continue; }
        if (conPrefijoExistente) { yaEstaban.push(p.sku); continue; }

        const codigo = propio ? `URREA-${p.sku}` : p.sku; // el codigo ya es de otro fabricante: se separa con prefijo
        if (propio) conPrefijo.push(p.sku);

        nuevos.push({ codigo, sku: p.sku, nombre, marca, descripcion: descripcionCorta(p.descripcion), categoria: categoriaDe(p) });
    }

    const porMarca = {};
    nuevos.forEach(n => { porMarca[n.marca] = (porMarca[n.marca] || 0) + 1; });
    console.log(`Leidos: ${productos.length} | nuevos: ${nuevos.length} | ya estaban: ${yaEstaban.length} | con prefijo URREA-: ${conPrefijo.length} | sin nombre: ${sinNombre.length}`);
    console.log("Por marca:", porMarca);
    console.log("Ejemplos:", nuevos.slice(0, 4).map(n => `${n.codigo} | ${n.marca} | ${n.nombre} | ${n.categoria}`));

    if (!aplicar) { console.log("Simulacion: no se escribio nada. Usa --aplicar."); return; }

    const salida = path.join(path.dirname(archivo), "respaldo-importacion.json");
    const client = await pool.connect();
    const insertados = [];

    try {
        await client.query("BEGIN");

        for (const n of nuevos) {
            const r = await client.query(
                `INSERT INTO public.catalogo_maestro_productos (codigo, marca, nombre, descripcion, fabricante, codigo_fabricante, clave, origen, fuente_identidad, fuente_fecha)
                 VALUES ($1, $2, $3, $4, $5, $6, $6, 'fabricante', $7, NOW())
                 ON CONFLICT (codigo) DO NOTHING RETURNING codigo`,
                [n.codigo, n.marca, n.nombre, n.descripcion, n.marca, n.sku, FUENTE]
            );
            if (r.rows.length) insertados.push(r.rows[0].codigo);
        }

        await client.query("COMMIT");
        fs.writeFileSync(salida, JSON.stringify({ fecha: new Date().toISOString(), insertados }, null, 1));
        console.log(`Listo: ${insertados.length} productos al Catalogo Maestro. Respaldo para deshacer: ${salida}`);
    } catch (error) {
        await client.query("ROLLBACK").catch(() => {});
        throw error;
    } finally {
        client.release();
    }
}

if (require.main === module) {
    const args = process.argv.slice(2);
    const i = args.indexOf("--deshacer");
    const j = args.indexOf("--archivo");
    const archivo = path.resolve(j >= 0 ? args[j + 1] : path.join(__dirname, "..", "tmp", "urrea", "productos.jsonl"));

    (i >= 0 ? deshacer(args[i + 1]) : importar({ aplicar: args.includes("--aplicar"), archivo }))
        .catch(e => { console.error(e); process.exitCode = 1; })
        .finally(() => pool.end());
}

module.exports = { marcaDe, categoriaDe, limpiarNombre, descripcionCorta };
