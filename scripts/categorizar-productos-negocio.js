// Pone categoria Nexo (ferreteria_v2) a los productos de un negocio que no la tienen, sin tocar los que ya la traen.
// Orden: 1) la categoria del producto ligado al catalogo maestro, 2) las reglas por nombre de categorias-ferreteria.js. Lo que ninguno resuelve queda sin categoria.
// Uso: node --env-file=.env scripts/categorizar-productos-negocio.js --negocio=31117            (solo muestra)
//      node --env-file=.env scripts/categorizar-productos-negocio.js --negocio=31117 --aplicar   (guarda y deja respaldo en tmp/)
//      node --env-file=.env scripts/categorizar-productos-negocio.js --negocio=31117 --deshacer=tmp/respaldo-categorias-31117-XXXX.json
const fs = require("fs");
const pool = require("../db");
const { clasificar, GIRO_ARBOL } = require("../categorias-ferreteria");

const arg = nombre => (process.argv.find(a => a.startsWith(`--${nombre}=`)) || "").split("=").slice(1).join("=");
const negocioId = Number(arg("negocio"));
const aplicar = process.argv.includes("--aplicar");
const deshacer = arg("deshacer");

(async () => {
    if (!negocioId) throw new Error("Falta --negocio=ID");

    if (deshacer) {
        const filas = JSON.parse(fs.readFileSync(deshacer, "utf8"));
        // Solo regresa a NULL el que sigue con la categoria que se le puso (si despues se cambio a mano, se respeta).
        const r = await pool.query(
            `UPDATE public.productos p SET categoria_nexo_id = NULL FROM (SELECT (x->>'id')::int AS id, (x->>'nueva')::int AS nueva FROM jsonb_array_elements($2::jsonb) x) f
              WHERE p.id = f.id AND p.negocio_id = $1 AND p.categoria_nexo_id = f.nueva`, [negocioId, JSON.stringify(filas)]);
        console.log(`Regresados a sin categoria: ${r.rowCount} de ${filas.length}`);
        return;
    }

    const arbol = (await pool.query(`SELECT id, departamento, categoria, nombre FROM public.categorias_nexo WHERE giro = $1`, [GIRO_ARBOL])).rows;
    const idDe = new Map(arbol.map(f => [[f.departamento, f.categoria, f.nombre].join("|"), f.id]));
    const productos = (await pool.query(
        `SELECT p.id, p.nombre, m.categoria_nexo_id AS maestro_cat, cn.giro AS maestro_giro
           FROM public.productos p
           LEFT JOIN public.catalogo_maestro_productos m ON m.id = p.catalogo_maestro_id
           LEFT JOIN public.categorias_nexo cn ON cn.id = m.categoria_nexo_id
          WHERE p.negocio_id = $1 AND p.categoria_nexo_id IS NULL ORDER BY p.id`, [negocioId])).rows;

    const cambios = [];
    const sin = [];
    const porDepto = {};
    const deptoDe = new Map(arbol.map(f => [f.id, f.departamento]));

    for (const p of productos) {
        let id = null, origen = "";
        if (p.maestro_cat && p.maestro_giro === GIRO_ARBOL) { id = p.maestro_cat; origen = "maestro"; }
        else {
            const c = clasificar(p.nombre);
            const hallado = c && idDe.get([c.dep, c.cat, c.sub].join("|"));
            if (hallado) { id = hallado; origen = "reglas"; }
        }
        if (!id) { sin.push(p.nombre); continue; }
        cambios.push({ id: p.id, nombre: p.nombre, nueva: id, origen });
        const d = deptoDe.get(id) || "?";
        porDepto[d] = (porDepto[d] || 0) + 1;
    }

    console.log(`Sin categoria hoy: ${productos.length} | resueltos: ${cambios.length} (maestro ${cambios.filter(c => c.origen === "maestro").length}, reglas ${cambios.filter(c => c.origen === "reglas").length}) | quedan: ${sin.length}`);
    console.log("Por departamento:", porDepto);
    console.log("Ejemplos por reglas:", cambios.filter(c => c.origen === "reglas").filter((_, i) => i % 9 === 0).map(c => `${c.nombre} -> ${deptoDe.get(c.nueva)}`));
    console.log("Ejemplos que quedan sin categoria:", sin.slice(0, 25));

    if (!aplicar) return console.log("\n(solo muestra; agrega --aplicar para guardar)");

    const archivo = `tmp/respaldo-categorias-${negocioId}-${Date.now()}.json`;
    fs.writeFileSync(archivo, JSON.stringify(cambios, null, 1));
    // La condicion "categoria_nexo_id IS NULL" evita pisar lo que alguien categorizo mientras corria.
    const r = await pool.query(
        `UPDATE public.productos p SET categoria_nexo_id = f.nueva FROM (SELECT (x->>'id')::int AS id, (x->>'nueva')::int AS nueva FROM jsonb_array_elements($2::jsonb) x) f
          WHERE p.id = f.id AND p.negocio_id = $1 AND p.categoria_nexo_id IS NULL`, [negocioId, JSON.stringify(cambios)]);
    console.log(`Guardado: ${r.rowCount}. Respaldo para deshacer: ${archivo}`);
})().catch(e => { console.error(e.message); process.exitCode = 1; }).finally(() => pool.end());
