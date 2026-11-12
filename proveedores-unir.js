// Unir proveedores: junta proveedores repetidos en uno. Los productos y las facturas de los demas pasan al elegido; los demas quedan
// INACTIVOS (no se borran) y todo se anota para poder deshacerlo. El historial escrito en texto (pedidos, cuentas por pagar, pagos) no se reescribe.
const crypto = require("crypto");
const { grupoDeDuplicados } = require("./proveedores-duplicados");

const SQL_TABLA = `
    CREATE TABLE IF NOT EXISTS public.proveedores_unidos (
        id SERIAL PRIMARY KEY,
        lote_id TEXT NOT NULL,
        negocio_id INTEGER NOT NULL REFERENCES public.negocios(id) ON DELETE CASCADE,
        destino_id INTEGER NOT NULL,
        destino_nombre TEXT NOT NULL DEFAULT '',
        origen_id INTEGER NOT NULL,
        origen_nombre TEXT NOT NULL DEFAULT '',
        detalle JSONB NOT NULL DEFAULT '{}'::jsonb,
        usuario TEXT NOT NULL DEFAULT '',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        deshecho_at TIMESTAMPTZ
    )
`;

let tablaLista = null;
function asegurarTabla(db) {
    if (!tablaLista) tablaLista = db.query(SQL_TABLA).catch(error => { tablaLista = null; throw error; });
    return tablaLista;
}

async function listar(db, negocioId) {
    return (await db.query(
        `SELECT p.id, p.nombre, p.telefono, p.rfc, COALESCE(p.creado_automatico, false) AS creado_automatico,
                (SELECT COUNT(*)::int FROM public.productos x WHERE x.proveedor_id = p.id AND x.negocio_id = p.negocio_id) AS productos,
                (SELECT COUNT(*)::int FROM public.recepciones_inteligentes r WHERE r.proveedor_id = p.id AND r.negocio_id = p.negocio_id) AS facturas
         FROM public.proveedores p WHERE p.negocio_id = $1 AND p.activo = true ORDER BY p.nombre`,
        [negocioId]
    )).rows;
}

async function duplicados(db, negocioId) {
    const proveedores = await listar(db, negocioId);
    return { proveedores, grupos: grupoDeDuplicados(proveedores) };
}

class ErrorUnir extends Error { constructor(mensaje, estado = 400) { super(mensaje); this.httpStatus = estado; } }

// destinoId se queda; origenIds se unen a el. Todo en una transaccion.
async function unir(pool, negocioId, destinoId, origenIds, usuario) {
    await asegurarTabla(pool);

    const destino = Number(destinoId);
    const origenes = [...new Set((origenIds || []).map(Number).filter(id => Number.isInteger(id) && id > 0 && id !== destino))];

    if (!Number.isInteger(destino) || destino <= 0 || !origenes.length || origenes.length > 50) throw new ErrorUnir("Elige el proveedor que se queda y al menos otro para unir.");

    const client = await pool.connect();

    try {
        await client.query("BEGIN");

        const filas = (await client.query(`SELECT * FROM public.proveedores WHERE negocio_id = $1 AND activo = true AND id = ANY($2::int[]) FOR UPDATE`, [negocioId, [destino, ...origenes]])).rows;
        const principal = filas.find(f => f.id === destino);

        if (!principal || filas.length !== origenes.length + 1) throw new ErrorUnir("Alguno de esos proveedores ya no existe o ya fue unido.", 404);

        const lote = crypto.randomUUID();
        const resumen = { productos: 0, facturas: 0, proveedores: [] };

        for (const origen of filas.filter(f => f.id !== destino)) {
            const productos = (await client.query(`SELECT id FROM public.productos WHERE negocio_id = $1 AND proveedor_id = $2`, [negocioId, origen.id])).rows.map(r => r.id);
            const facturas = (await client.query(`SELECT id FROM public.recepciones_inteligentes WHERE negocio_id = $1 AND proveedor_id = $2`, [negocioId, origen.id])).rows.map(r => r.id);
            const marcas = (await client.query(`SELECT marca_id FROM public.proveedor_marcas WHERE negocio_id = $1 AND proveedor_id = $2`, [negocioId, origen.id]).catch(() => ({ rows: [] }))).rows.map(r => r.marca_id);
            const codigos = (await client.query(`SELECT id FROM public.producto_codigos WHERE negocio_id = $1 AND lower(btrim(proveedor)) = lower(btrim($2))`, [negocioId, origen.nombre]).catch(() => ({ rows: [] }))).rows.map(r => r.id);

            if (productos.length) await client.query(`UPDATE public.productos SET proveedor_id = $1, proveedor = $2 WHERE negocio_id = $3 AND id = ANY($4::int[])`, [destino, principal.nombre, negocioId, productos]);
            if (facturas.length) await client.query(`UPDATE public.recepciones_inteligentes SET proveedor_id = $1 WHERE negocio_id = $2 AND id = ANY($3::int[])`, [destino, negocioId, facturas]);
            if (marcas.length) await client.query(`UPDATE public.proveedor_marcas SET proveedor_id = $1 WHERE negocio_id = $2 AND proveedor_id = $3`, [destino, negocioId, origen.id]);
            if (codigos.length) await client.query(`UPDATE public.producto_codigos SET proveedor = $1 WHERE negocio_id = $2 AND id = ANY($3::int[])`, [principal.nombre, negocioId, codigos]);

            // Los datos de contacto que le falten al que se queda se completan con los del que se une.
            await client.query(
                `UPDATE public.proveedores SET telefono = COALESCE(NULLIF(telefono, ''), $2), correo = COALESCE(NULLIF(correo, ''), $3), contacto = COALESCE(NULLIF(contacto, ''), $4), rfc = COALESCE(NULLIF(rfc, ''), $5) WHERE id = $1`,
                [destino, origen.telefono || "", origen.correo || "", origen.contacto || "", origen.rfc || ""]
            );

            await client.query(`UPDATE public.proveedores SET activo = false, notas = COALESCE(notas, '') || $2 WHERE id = $1`, [origen.id, `${origen.notas ? " " : ""}[Unido con ${principal.nombre} el ${new Date().toISOString().slice(0, 10)}]`]);

            await client.query(
                `INSERT INTO public.proveedores_unidos (lote_id, negocio_id, destino_id, destino_nombre, origen_id, origen_nombre, detalle, usuario) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
                [lote, negocioId, destino, principal.nombre, origen.id, origen.nombre, JSON.stringify({ productos, facturas, marcas, codigos }), String(usuario || "").slice(0, 80)]
            );

            resumen.productos += productos.length;
            resumen.facturas += facturas.length;
            resumen.proveedores.push(origen.nombre);
        }

        await client.query("COMMIT");
        return { loteId: lote, destino: principal.nombre, ...resumen };
    } catch (error) {
        await client.query("ROLLBACK").catch(() => {});
        throw error;
    } finally {
        client.release();
    }
}

async function uniones(db, negocioId) {
    await asegurarTabla(db);

    const filas = (await db.query(`SELECT * FROM public.proveedores_unidos WHERE negocio_id = $1 ORDER BY created_at DESC, id DESC LIMIT 200`, [negocioId])).rows;
    const lotes = new Map();

    filas.forEach(f => {
        if (!lotes.has(f.lote_id)) lotes.set(f.lote_id, { id: f.lote_id, fecha: f.created_at, destino: f.destino_nombre, usuario: f.usuario, productos: 0, facturas: 0, origenes: [], deshecho: Boolean(f.deshecho_at) });
        const l = lotes.get(f.lote_id);
        const d = f.detalle || {};
        l.productos += (d.productos || []).length;
        l.facturas += (d.facturas || []).length;
        l.origenes.push(f.origen_nombre);
    });

    return [...lotes.values()].slice(0, 30);
}

// Regresa una union: cada proveedor vuelve a estar activo y recupera SUS productos, facturas y marcas (solo los que siguen con el proveedor al que se unieron).
async function deshacer(pool, negocioId, loteId) {
    await asegurarTabla(pool);

    const filas = (await pool.query(`SELECT * FROM public.proveedores_unidos WHERE negocio_id = $1 AND lote_id = $2 ORDER BY id`, [negocioId, String(loteId)])).rows;

    if (!filas.length) throw new ErrorUnir("Esa union no existe.", 404);
    if (filas.some(f => f.deshecho_at)) throw new ErrorUnir("Esa union ya se deshizo.");

    const client = await pool.connect();
    const resumen = { productos: 0, facturas: 0, proveedores: [] };

    try {
        await client.query("BEGIN");

        for (const f of filas) {
            const d = f.detalle || {};
            const p = (d.productos || []).length ? await client.query(`UPDATE public.productos SET proveedor_id = $1, proveedor = $2 WHERE negocio_id = $3 AND id = ANY($4::int[]) AND proveedor_id = $5`, [f.origen_id, f.origen_nombre, negocioId, d.productos, f.destino_id]) : { rowCount: 0 };
            const r = (d.facturas || []).length ? await client.query(`UPDATE public.recepciones_inteligentes SET proveedor_id = $1 WHERE negocio_id = $2 AND id = ANY($3::int[]) AND proveedor_id = $4`, [f.origen_id, negocioId, d.facturas, f.destino_id]) : { rowCount: 0 };
            if ((d.marcas || []).length) await client.query(`UPDATE public.proveedor_marcas SET proveedor_id = $1 WHERE negocio_id = $2 AND marca_id = ANY($3::text[]) AND proveedor_id = $4`, [f.origen_id, negocioId, d.marcas, f.destino_id]).catch(() => {});
            if ((d.codigos || []).length) await client.query(`UPDATE public.producto_codigos SET proveedor = $1 WHERE negocio_id = $2 AND id = ANY($3::int[]) AND lower(btrim(proveedor)) = lower(btrim($4))`, [f.origen_nombre, negocioId, d.codigos, f.destino_nombre]).catch(() => {});

            await client.query(`UPDATE public.proveedores SET activo = true WHERE id = $1 AND negocio_id = $2`, [f.origen_id, negocioId]);
            await client.query(`UPDATE public.proveedores_unidos SET deshecho_at = NOW() WHERE id = $1`, [f.id]);

            resumen.productos += p.rowCount;
            resumen.facturas += r.rowCount;
            resumen.proveedores.push(f.origen_nombre);
        }

        await client.query("COMMIT");
        return resumen;
    } catch (error) {
        await client.query("ROLLBACK").catch(() => {});
        throw error;
    } finally {
        client.release();
    }
}

module.exports = { asegurarTabla, listar, duplicados, unir, uniones, deshacer, ErrorUnir };
