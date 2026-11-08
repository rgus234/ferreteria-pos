// Asigna categoria de Nexo (arbol de ferreteria, 3 niveles) a los productos del catalogo maestro que no tienen una:
// familia Truper, Urrea y demas fabricantes. Solo llena categoria_nexo_id cuando esta vacio; nunca pisa una existente
// y no toca productos de ningun negocio. Por defecto es un ensayo (no escribe); con --aplicar guarda.
// Uso: node --env-file=.env scripts/clasificar-maestro-categorias.js [--aplicar]
const pool = require("../db");
const { clasificar, GIRO_ARBOL } = require("../categorias-ferreteria");

(async () => {
    const aplicar = process.argv.includes("--aplicar");

    const arbol = await pool.query(`SELECT id, departamento, categoria, nombre FROM public.categorias_nexo WHERE giro = $1`, [GIRO_ARBOL]);
    if (!arbol.rows.length) throw new Error("El arbol nuevo no esta sembrado: corre primero scripts/sembrar-categorias-nexo.js");
    const idPorClave = new Map(arbol.rows.map(f => [`${f.departamento}|${f.categoria}|${f.nombre}`, f.id]));

    const productos = await pool.query(
        `SELECT id, nombre FROM public.catalogo_maestro_productos
         WHERE categoria_nexo_id IS NULL AND (fabricante <> '' OR LOWER(marca) LIKE '%urrea%')`
    );

    const porId = new Map();
    let sinRegla = 0;
    for (const { id, nombre } of productos.rows) {
        const c = clasificar(nombre);
        const categoriaId = c && idPorClave.get(`${c.dep}|${c.cat}|${c.sub}`);
        if (!categoriaId) { sinRegla++; continue; }
        if (!porId.has(categoriaId)) porId.set(categoriaId, []);
        porId.get(categoriaId).push(id);
    }

    const clasificados = productos.rows.length - sinRegla;
    console.log(`${productos.rows.length} sin categoria: ${clasificados} con regla (${(clasificados * 100 / productos.rows.length).toFixed(1)}%), ${sinRegla} quedan sin categoria.`);

    if (!aplicar) {
        console.log("Ensayo: no se guardo nada. Usa --aplicar para guardar.");
    } else {
        let guardados = 0;
        for (const [categoriaId, ids] of porId) {
            const r = await pool.query(
                `UPDATE public.catalogo_maestro_productos SET categoria_nexo_id = $1 WHERE id = ANY($2::int[]) AND categoria_nexo_id IS NULL`,
                [categoriaId, ids]
            );
            guardados += r.rowCount;
        }
        console.log(`Guardados ${guardados}.`);
    }
    await pool.end();
})().catch(error => { console.error("FALLO:", error); process.exit(1); });
