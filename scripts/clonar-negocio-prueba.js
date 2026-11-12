// Crea una COPIA DE PRUEBA de un negocio real para ensayar cambios sin tocar el original (por ejemplo, Ferreteria Olimpico).
//   node --env-file=.env scripts/clonar-negocio-prueba.js --origen=1                       crea la copia
//   node --env-file=.env scripts/clonar-negocio-prueba.js --borrar --slug=olimpico-copia-prueba    borra SOLO la copia
// Solo LEE el negocio origen; todo lo que escribe va a un negocio nuevo (slug terminado en "-copia-prueba").
// Se copia: proveedores, productos (con sus codigos y fotos), ventas, facturas de Recepcion Inteligente, recepciones, catalogos de proveedor y reglas de precio.
// NO se copia: clientes y su credito, usuarios y PIN, caja y turnos, pedidos, Stripe ni datos fiscales. La copia nace sin dato personal de clientes.
// La contraseña de la copia se guarda en tmp/copia-<slug>-credenciales.txt (no se imprime).
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const pool = require("../db");
const { hashPassword } = require("../password-utils");

const args = Object.fromEntries(process.argv.slice(2).map(a => { const [k, v] = a.replace(/^--/, "").split("="); return [k, v === undefined ? true : v]; }));
const ORIGEN = Number(args.origen) || 1;
const SLUG = String(args.slug || "olimpico-copia-prueba");
const NOMBRE = String(args.nombre || "Ferretería Olímpico (COPIA DE PRUEBA)");
const CORREO = String(args.correo || "olimpico.copia@nexoposoficial.com");

async function columnas(db, tabla, excluir = []) {
    const r = await db.query(`SELECT column_name, data_type FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1 ORDER BY ordinal_position`, [tabla]);
    return r.rows.filter(c => !excluir.includes(c.column_name));
}

const valorPara = (col, v) => (v !== null && typeof v === "object" && !(v instanceof Date) && !Buffer.isBuffer(v) && /json/.test(col.data_type) ? JSON.stringify(v) : v);

// Copia una fila (con cambios opcionales) y regresa el id nuevo.
async function insertarFila(db, tabla, cols, fila, cambios) {
    const nombres = cols.map(c => c.column_name);
    const valores = cols.map(c => valorPara(c, c.column_name in cambios ? cambios[c.column_name] : fila[c.column_name]));
    const r = await db.query(`INSERT INTO public.${tabla} (${nombres.map(n => `"${n}"`).join(", ")}) VALUES (${nombres.map((_, i) => `$${i + 1}`).join(", ")}) RETURNING id`, valores);
    return r.rows[0].id;
}

async function borrar() {
    if (!/-copia-prueba$/.test(SLUG)) throw new Error("Solo se pueden borrar copias (slug terminado en -copia-prueba).");

    const n = (await pool.query(`SELECT id FROM public.negocios WHERE slug = $1`, [SLUG])).rows[0];
    if (!n) { console.log("No hay copia con ese slug."); return; }

    const tablas = (await pool.query(`SELECT table_name FROM information_schema.columns WHERE table_schema = 'public' AND column_name = 'negocio_id' AND table_name <> 'negocios'`)).rows.map(r => r.table_name);
    const pendientes = new Set(tablas);

    for (let pasada = 0; pasada < 8 && pendientes.size; pasada++) {
        for (const t of [...pendientes]) {
            try { await pool.query(`DELETE FROM public."${t}" WHERE negocio_id = $1`, [n.id]); pendientes.delete(t); } catch (error) { /* depende de otra tabla: se reintenta */ }
        }
    }

    await pool.query(`DELETE FROM public.negocios WHERE id = $1`, [n.id]);
    console.log(`Copia ${SLUG} (negocio ${n.id}) borrada.${pendientes.size ? " Tablas que no se pudieron limpiar: " + [...pendientes].join(", ") : ""}`);
}

async function clonar() {
    const existe = (await pool.query(`SELECT id FROM public.negocios WHERE slug = $1 OR lower(correo) = lower($2)`, [SLUG, CORREO])).rows[0];
    if (existe) throw new Error(`Ya existe un negocio con ese slug o correo (id ${existe.id}). Borra la copia con --borrar o usa otro --slug/--correo.`);

    const origen = (await pool.query(`SELECT * FROM public.negocios WHERE id = $1`, [ORIGEN])).rows[0];
    if (!origen) throw new Error("El negocio origen no existe.");

    const password = "Copia-" + crypto.randomBytes(6).toString("hex");
    const client = await pool.connect();
    const resumen = {};

    try {
        await client.query("BEGIN");

        const nuevo = (await client.query(
            `INSERT INTO public.negocios (slug, nombre, giro, estado, plan, telefono, correo, direccion, password_hash, correo_verificado, hora_cierre, color, nivel_precio_por_defecto, visible_en_market, funciones_beta)
             VALUES ($1, $2, $3, 'activo', 'pro', '', $4, '', $5, true, $6, $7, $8, false, '{"_todas": true}'::jsonb) RETURNING id`,
            [SLUG, NOMBRE, origen.giro, CORREO, hashPassword(password), origen.hora_cierre, origen.color, origen.nivel_precio_por_defecto]
        )).rows[0].id;

        await client.query(`INSERT INTO public.licencias (negocio_id, estado, plan, fecha_vencimiento, gracia_dias, monto_mensual) VALUES ($1, 'activa', 'pro', NOW() + INTERVAL '365 days', 15, 0)`, [nuevo]);

        // Giros activos
        const giros = (await client.query(`SELECT giro, activo FROM public.negocio_giros WHERE negocio_id = $1`, [ORIGEN])).rows;
        await client.query(`DELETE FROM public.negocio_giros WHERE negocio_id = $1`, [nuevo]);
        for (const g of giros) await client.query(`INSERT INTO public.negocio_giros (negocio_id, giro, activo) VALUES ($1, $2, $3)`, [nuevo, g.giro, g.activo]);

        // Proveedores
        const mapaProv = new Map();
        const colsProv = await columnas(client, "proveedores", ["id"]);
        for (const f of (await client.query(`SELECT * FROM public.proveedores WHERE negocio_id = $1 ORDER BY id`, [ORIGEN])).rows) mapaProv.set(f.id, await insertarFila(client, "proveedores", colsProv, f, { negocio_id: nuevo }));
        resumen.proveedores = mapaProv.size;

        // Productos
        const mapaProd = new Map();
        const colsProd = await columnas(client, "productos", ["id"]);
        for (const f of (await client.query(`SELECT * FROM public.productos WHERE negocio_id = $1 ORDER BY id`, [ORIGEN])).rows) {
            mapaProd.set(f.id, await insertarFila(client, "productos", colsProd, f, { negocio_id: nuevo, proveedor_id: f.proveedor_id ? (mapaProv.get(f.proveedor_id) || null) : null, ubicacion_id: null, ubicacion_bodega_id: null }));
        }
        resumen.productos = mapaProd.size;

        await client.query(`CREATE TEMP TABLE m_prod (viejo INTEGER PRIMARY KEY, nuevo INTEGER NOT NULL) ON COMMIT DROP`);
        await client.query(`INSERT INTO m_prod (viejo, nuevo) SELECT * FROM unnest($1::int[], $2::int[])`, [[...mapaProd.keys()], [...mapaProd.values()]]);

        // Codigos de cada producto
        const colsCod = (await columnas(client, "producto_codigos", ["id", "negocio_id", "producto_id"])).map(c => `"${c.column_name}"`).join(", ");
        resumen.codigos = (await client.query(`INSERT INTO public.producto_codigos (negocio_id, producto_id, ${colsCod}) SELECT $1, m.nuevo, ${colsCod.split(", ").map(c => "c." + c).join(", ")} FROM public.producto_codigos c JOIN m_prod m ON m.viejo = c.producto_id WHERE c.negocio_id = $2`, [nuevo, ORIGEN])).rowCount;

        // Fotos
        const colsFoto = (await columnas(client, "fotos_producto", ["id", "negocio_id"])).map(c => `"${c.column_name}"`).join(", ");
        resumen.fotos = (await client.query(`INSERT INTO public.fotos_producto (negocio_id, ${colsFoto}) SELECT $1, ${colsFoto} FROM public.fotos_producto WHERE negocio_id = $2`, [nuevo, ORIGEN])).rowCount;

        // Ventas (sin clientes ni turnos ni codigo publico; los productos de cada venta apuntan a los productos de la copia)
        const colsVenta = await columnas(client, "historial_ventas", ["id"]);
        let ventas = 0;
        for (const f of (await client.query(`SELECT * FROM public.historial_ventas WHERE negocio_id = $1 ORDER BY id`, [ORIGEN])).rows) {
            const productos = Array.isArray(f.productos) ? f.productos.map(p => (p && p.id && mapaProd.has(Number(p.id)) ? { ...p, id: mapaProd.get(Number(p.id)) } : p)) : f.productos;
            await insertarFila(client, "historial_ventas", colsVenta, f, { negocio_id: nuevo, productos, cliente_id: null, cliente_nombre: null, turno_id: null, codigo_publico: null, idempotency_key: null, venta_id: null });
            ventas++;
        }
        resumen.ventas = ventas;

        // Recepciones de mercancia
        const mapaRec = new Map();
        const colsRec = await columnas(client, "recepciones_mercancia", ["id"]);
        for (const f of (await client.query(`SELECT * FROM public.recepciones_mercancia WHERE negocio_id = $1 ORDER BY id`, [ORIGEN])).rows) mapaRec.set(f.id, await insertarFila(client, "recepciones_mercancia", colsRec, f, { negocio_id: nuevo, pedido_id: null, idempotency_key: null }));
        const colsRecItem = await columnas(client, "recepciones_mercancia_items", ["id"]);
        for (const f of (await client.query(`SELECT * FROM public.recepciones_mercancia_items WHERE negocio_id = $1 ORDER BY id`, [ORIGEN])).rows) {
            if (!mapaRec.has(f.recepcion_id)) continue;
            await insertarFila(client, "recepciones_mercancia_items", colsRecItem, f, { negocio_id: nuevo, recepcion_id: mapaRec.get(f.recepcion_id), pedido_item_id: null, producto_id: f.producto_id ? (mapaProd.get(f.producto_id) || null) : null });
        }
        resumen.recepciones = mapaRec.size;

        // Facturas de Recepcion Inteligente (los datos de la factura tal cual; sin vinculo a pedidos ni empleados)
        const mapaFac = new Map();
        const colsFac = await columnas(client, "recepciones_inteligentes", ["id"]);
        for (const f of (await client.query(`SELECT * FROM public.recepciones_inteligentes WHERE negocio_id = $1 ORDER BY id`, [ORIGEN])).rows) {
            mapaFac.set(f.id, await insertarFila(client, "recepciones_inteligentes", colsFac, f, { negocio_id: nuevo, proveedor_id: f.proveedor_id ? (mapaProv.get(f.proveedor_id) || null) : null, pedido_id: null, recepcion_mercancia_id: f.recepcion_mercancia_id ? (mapaRec.get(f.recepcion_mercancia_id) || null) : null, revisado_por_empleado_id: null }));
        }
        const colsFacItem = await columnas(client, "recepciones_inteligentes_items", ["id"]);
        let items = 0;
        for (const f of (await client.query(`SELECT * FROM public.recepciones_inteligentes_items WHERE negocio_id = $1 ORDER BY id`, [ORIGEN])).rows) {
            if (!mapaFac.has(f.recepcion_id)) continue;
            await insertarFila(client, "recepciones_inteligentes_items", colsFacItem, f, { negocio_id: nuevo, recepcion_id: mapaFac.get(f.recepcion_id), producto_id: f.producto_id ? (mapaProd.get(f.producto_id) || null) : null });
            items++;
        }
        resumen.facturas = mapaFac.size;
        resumen.conceptosFacturas = items;

        // Catalogos de proveedor (Diprofer, listas...)
        const colsCat = await columnas(client, "catalogos_proveedor", ["id"]);
        const colsProdCat = (await columnas(client, "catalogo_productos", ["id", "negocio_id", "catalogo_id", "producto_id"])).map(c => `"${c.column_name}"`).join(", ");
        let filasCatalogo = 0;
        for (const f of (await client.query(`SELECT * FROM public.catalogos_proveedor WHERE negocio_id = $1 ORDER BY id`, [ORIGEN])).rows) {
            const idNuevo = await insertarFila(client, "catalogos_proveedor", colsCat, f, { negocio_id: nuevo });
            filasCatalogo += (await client.query(
                `INSERT INTO public.catalogo_productos (negocio_id, catalogo_id, producto_id, ${colsProdCat}) SELECT $1, $2, m.nuevo, ${colsProdCat.split(", ").map(c => "c." + c).join(", ")} FROM public.catalogo_productos c LEFT JOIN m_prod m ON m.viejo = c.producto_id WHERE c.catalogo_id = $3`,
                [nuevo, idNuevo, f.id]
            )).rowCount;
        }
        resumen.catalogos = filasCatalogo;

        // Reglas de precio por proveedor
        const colsRegla = await columnas(client, "reglas_precios_proveedor", ["id"]);
        for (const f of (await client.query(`SELECT * FROM public.reglas_precios_proveedor WHERE negocio_id = $1`, [ORIGEN])).rows) await insertarFila(client, "reglas_precios_proveedor", colsRegla, f, { negocio_id: nuevo });

        await client.query("COMMIT");

        fs.mkdirSync(path.join(__dirname, "..", "tmp"), { recursive: true });
        fs.writeFileSync(path.join(__dirname, "..", "tmp", `copia-${SLUG}-credenciales.txt`), `${NOMBRE}\nnegocio id: ${nuevo}\ncorreo: ${CORREO}\ncontraseña: ${password}\n`);
        console.log(`Copia creada: negocio ${nuevo} (${SLUG}).`, JSON.stringify(resumen));
        console.log(`Credenciales en tmp/copia-${SLUG}-credenciales.txt`);
    } catch (error) {
        await client.query("ROLLBACK").catch(() => {});
        throw error;
    } finally {
        client.release();
    }
}

(async () => {
    try { if (args.borrar) await borrar(); else await clonar(); } finally { await pool.end(); }
})().catch(error => { console.error("ERROR:", error.message); process.exit(1); });
