// Pone categoria Nexo y marca a los productos de abarrotes del catalogo maestro que todavia no las tienen.
// Reglas por palabras (revisadas a mano contra los 361 nombres reales); lo que no encaja queda sin tocar y se lista para revisarlo.
// Nunca pisa una categoria o marca que ya existe. Sin banderas solo muestra lo que haria; con --aplicar escribe y deja un respaldo.
//   node --env-file=.env scripts/categorizar-maestro-abarrotes.js              (simulacion)
//   node --env-file=.env scripts/categorizar-maestro-abarrotes.js --aplicar
//   node --env-file=.env scripts/categorizar-maestro-abarrotes.js --deshacer tmp/respaldo-categorias-XXXX.json
const fs = require("fs");
const path = require("path");
const pool = require("../db");
const { marcaDeProducto } = require("../marcas-catalogo");
const { clasificarAbarrotes } = require("../clasificar-abarrotes");

const categoriaDe = nombre => clasificarAbarrotes(nombre);

async function deshacer(archivo) {
    const respaldo = JSON.parse(fs.readFileSync(archivo, "utf8"));
    const client = await pool.connect();
    try {
        await client.query("BEGIN");
        for (const f of respaldo.cambios) await client.query(`UPDATE public.catalogo_maestro_productos SET categoria_nexo_id = $2, marca = $3, updated_at = NOW() WHERE id = $1`, [f.id, f.categoria_antes, f.marca_antes]);
        await client.query("COMMIT");
        console.log(`Deshecho: ${respaldo.cambios.length} productos regresados.`);
    } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
}

async function correr(aplicar) {
    const filas = (await pool.query(`SELECT id, codigo, nombre, marca, categoria_nexo_id FROM public.catalogo_maestro_productos WHERE giro = 'abarrotes' ORDER BY id`)).rows;
    const nombres = new Map((await pool.query(`SELECT id, nombre FROM public.categorias_nexo WHERE giro = 'abarrotes'`)).rows.map(c => [c.id, c.nombre]));
    const cambios = [];
    const sinCategoria = [];
    const sinMarca = [];

    for (const f of filas) {
        const categoria = f.categoria_nexo_id || categoriaDe(f.nombre);
        const m = !String(f.marca || "").trim() ? marcaDeProducto(f.nombre) : null;
        const marca = m ? m.nombre : String(f.marca || "").trim();

        if (!categoria) sinCategoria.push(f);
        if (!marca) sinMarca.push(f);

        const poneCategoria = !f.categoria_nexo_id && categoria;
        const poneMarca = !String(f.marca || "").trim() && marca;

        if (poneCategoria || poneMarca) cambios.push({ id: f.id, nombre: f.nombre, categoria: categoria || null, categoria_antes: f.categoria_nexo_id, marca: marca || "", marca_antes: f.marca || "" });
    }

    const porCategoria = {};
    cambios.filter(c => c.categoria && !c.categoria_antes).forEach(c => { (porCategoria[nombres.get(c.categoria)] = porCategoria[nombres.get(c.categoria)] || []).push(c.nombre); });
    for (const [cat, lista] of Object.entries(porCategoria)) console.log(`\n[${cat}] (${lista.length})\n  ${lista.join(" | ")}`);
    console.log(`\nSin categoria despues de las reglas (${sinCategoria.length}): ${sinCategoria.map(f => f.nombre).join(" | ")}`);
    console.log(`\nSin marca (${sinMarca.length}): ${sinMarca.map(f => f.nombre).join(" | ")}`);
    console.log(`\nProductos a actualizar: ${cambios.length} de ${filas.length}`);

    if (!aplicar) { console.log("Simulacion: no se escribio nada. Usa --aplicar."); return; }

    const archivo = path.join(__dirname, "..", "tmp", `respaldo-categorias-${Date.now()}.json`);
    fs.writeFileSync(archivo, JSON.stringify({ fecha: new Date().toISOString(), cambios }, null, 1));
    const client = await pool.connect();
    try {
        await client.query("BEGIN");
        for (const c of cambios) await client.query(`UPDATE public.catalogo_maestro_productos SET categoria_nexo_id = COALESCE(categoria_nexo_id, $2), marca = CASE WHEN COALESCE(marca, '') = '' THEN $3 ELSE marca END, updated_at = NOW() WHERE id = $1`, [c.id, c.categoria, c.marca]);
        await client.query("COMMIT");
        console.log(`Listo. Respaldo para deshacer: ${archivo}`);
    } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
}

(async () => {
    const a = process.argv.slice(2);
    const i = a.indexOf("--deshacer");
    try { if (i >= 0) await deshacer(a[i + 1]); else await correr(a.includes("--aplicar")); } finally { await pool.end(); }
})().catch(error => { console.error(error); process.exit(1); });
