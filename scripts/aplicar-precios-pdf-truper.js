// Actualiza Mayoreo, 1/2 Mayoreo y Publico del Catalogo Nexo TRUPER con los precios leidos del PDF nacional de Truper (tmp/pdf-truper-precios.json,
// que genera tmp/leer-pdf-truper.mjs). NO toca el Distribuidor ni los productos verificados por una persona, no agrega productos nuevos,
// guarda el precio anterior en cada fila (precio_*_anterior), anota cada cambio en catalogo_fabricante_cambios y deja un respaldo para deshacer.
//   node --env-file=.env scripts/aplicar-precios-pdf-truper.js                      (solo muestra)
//   node --env-file=.env scripts/aplicar-precios-pdf-truper.js --aplicar
//   node --env-file=.env scripts/aplicar-precios-pdf-truper.js --deshacer=tmp/respaldo-precios-pdf-truper-XXXX.json
const fs = require("fs");
const pool = require("../db");

const CAMPOS = [["precio_mayoreo", "mayoreo"], ["precio_medio_mayoreo", "medio"], ["precio_publico", "publico"]];
const arg = nombre => (process.argv.find(a => a.startsWith(`--${nombre}=`)) || "").split("=").slice(1).join("=");
const fmt = v => (v === null || v === undefined ? "" : `$${Number(v).toFixed(2)}`);

(async () => {
    const deshacer = arg("deshacer");

    if (deshacer) {
        const filas = JSON.parse(fs.readFileSync(deshacer, "utf8")).filas;
        let regresados = 0;
        for (const f of filas) {
            // Solo regresa lo que sigue con el valor que puso el PDF (si una persona o una sincronizacion lo cambio despues, se respeta).
            for (const [campo] of CAMPOS) {
                if (!(campo in f.cambios)) continue;
                const r = await pool.query(
                    `UPDATE public.catalogo_fabricante_productos SET ${campo} = $2, ${campo}_anterior = $3,
                            precios_sin_publicar = $5, actualizado_en = NOW()
                      WHERE id = $1 AND ${campo} = $4`,
                    [f.id, f.cambios[campo].antes, f.cambios[campo].antesAnterior, f.cambios[campo].despues, f.sinPublicarAntes]);
                regresados += r.rowCount;
            }
        }
        console.log(`Campos regresados: ${regresados}`);
        return;
    }

    const aplicar = process.argv.includes("--aplicar");
    const pdf = JSON.parse(fs.readFileSync("tmp/pdf-truper-precios.json", "utf8"));
    const db = new Map((await pool.query(
        `SELECT id, codigo, precio_mayoreo, precio_medio_mayoreo, precio_publico, precio_mayoreo_anterior, precio_medio_mayoreo_anterior, precio_publico_anterior,
                COALESCE(precios_sin_publicar, '') AS precios_sin_publicar, verificado_por_persona
           FROM public.catalogo_fabricante_productos WHERE fabricante = 'TRUPER'`)).rows.map(r => [String(r.codigo), r]));

    const plan = [];
    let nuevos = 0, verificados = 0, sinCambio = 0;
    const stats = { llena: 0, modifica: 0 };

    for (const x of pdf.productos) {
        const r = db.get(String(x.codigo));
        if (!r) { nuevos += 1; continue; }
        if (r.verificado_por_persona) { verificados += 1; continue; }

        const cambios = {};
        for (const [campo, clave] of CAMPOS) {
            const nuevo = x[clave];
            const antes = r[campo] === null ? null : Number(r[campo]);
            if (antes === nuevo) continue;
            cambios[campo] = { antes, antesAnterior: r[`${campo}_anterior`] === null ? null : Number(r[`${campo}_anterior`]), despues: nuevo };
            if (antes === null) stats.llena += 1; else stats.modifica += 1;
        }
        if (!Object.keys(cambios).length) { sinCambio += 1; continue; }
        plan.push({ id: r.id, codigo: String(x.codigo), cambios, sinPublicarAntes: r.precios_sin_publicar });
    }

    console.log(`PDF: ${pdf.productos.length} | con cambios: ${plan.length} (campos que se llenan: ${stats.llena}, que se modifican: ${stats.modifica}) | sin cambio: ${sinCambio} | nuevos (no se agregan): ${nuevos} | verificados por persona (no se tocan): ${verificados}`);
    console.log("Ejemplos:", plan.slice(0, 5).map(p => `${p.codigo} ${Object.entries(p.cambios).map(([c, v]) => `${c.replace("precio_", "")} ${fmt(v.antes)}->${fmt(v.despues)}`).join(", ")}`));
    if (!aplicar) return console.log("\n(solo muestra; agrega --aplicar para guardar)");

    const archivo = `tmp/respaldo-precios-pdf-truper-${Date.now()}.json`;
    fs.writeFileSync(archivo, JSON.stringify({ aplicado: new Date().toISOString(), origen: "catalogo_nacional_2026.pdf", filas: plan }, null, 1));

    const cliente = await pool.connect();
    try {
        await cliente.query("BEGIN");
        const sync = (await cliente.query(
            `INSERT INTO public.catalogo_fabricante_sincronizaciones (fabricante, estado, detalle, productos_modificados, iniciada_en, terminada_en)
             VALUES ('TRUPER', 'completada', 'Precios del PDF nacional 2026 (texto, sin visión)', $1, NOW(), NOW()) RETURNING id`, [plan.length])).rows[0].id;

        for (const p of plan) {
            const sets = [];
            const valores = [p.id];
            let n = 2;
            const quitar = [];
            for (const [campo, c] of Object.entries(p.cambios)) {
                sets.push(`${campo} = $${n++}`, `${campo}_anterior = $${n++}`);
                valores.push(c.despues, c.antes);
                quitar.push(campo);
                await cliente.query(
                    `INSERT INTO public.catalogo_fabricante_cambios (sincronizacion_id, fabricante, codigo, tipo, campo, valor_anterior, valor_nuevo, detalle)
                     VALUES ($1, 'TRUPER', $2, 'modificado', $3, $4, $5, 'PDF nacional 2026')`, [sync, p.codigo, campo, fmt(c.antes), fmt(c.despues)]);
            }
            // El precio ya viene leido del texto del PDF: deja de estar "sin publicar" por dudoso.
            const resto = p.sinPublicarAntes.split(",").map(s => s.trim()).filter(s => s && !quitar.includes(s)).join(",");
            sets.push(`precios_sin_publicar = $${n++}`, `actualizado_en = NOW()`);
            valores.push(resto);
            await cliente.query(`UPDATE public.catalogo_fabricante_productos SET ${sets.join(", ")} WHERE id = $1 AND NOT COALESCE(verificado_por_persona, false)`, valores);
        }
        await cliente.query("COMMIT");
        console.log(`Aplicado a ${plan.length} productos (sincronizacion ${sync}). Respaldo para deshacer: ${archivo}`);
    } catch (error) {
        await cliente.query("ROLLBACK").catch(() => {});
        throw error;
    } finally {
        cliente.release();
    }
})().catch(e => { console.error(e.message); process.exitCode = 1; }).finally(() => pool.end());
