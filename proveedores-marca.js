// Proveedor por marca (abarrotes): al escanear o agregar un producto, Nexo sabe su marca (Doritos -> Sabritas) y le pone el proveedor de esa marca.
//  1. Si el negocio ya dijo quien le vende esa marca (proveedor_marcas), ese.
//  2. Si ya tiene un proveedor cuyo nombre es la marca ("Sabritas", "Coca-Cola Femsa Distribuidor" para Coca-Cola), ese -- solo si es uno.
//  3. Si no, se crea el proveedor con el nombre de la marca (marcado "creado automaticamente" para que despues complete su telefono y su dia de visita).
// Cuando el dueño le asigna un proveedor a un producto, el negocio aprende: los siguientes de esa marca van con el mismo.
// Solo para negocios de abarrotes. Nunca pisa un proveedor que el producto ya tenga.
const { marcaDeProducto, MARCAS, esNegocioDeAbarrotes } = require("./marcas-catalogo");
const { resolverOcrearProveedorId } = require("./proveedor-resolver");

const plano = texto => String(texto || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();

const SQL_TABLA = `
    CREATE TABLE IF NOT EXISTS public.proveedor_marcas (
        negocio_id INTEGER NOT NULL REFERENCES public.negocios(id) ON DELETE CASCADE,
        marca_id TEXT NOT NULL,
        proveedor_id INTEGER NOT NULL REFERENCES public.proveedores(id) ON DELETE CASCADE,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (negocio_id, marca_id)
    )
`;

let tablaLista = null;
function asegurarTabla(db) {
    if (!tablaLista) tablaLista = db.query(SQL_TABLA).catch(error => { tablaLista = null; throw error; });
    return tablaLista;
}

function marcaPorNombre(nombre) {
    return marcaDeProducto(nombre) || null;
}

// Palabra completa: "coca-cola" esta en "coca-cola femsa distribuidor sa de cv"; "bimbo" no esta en "bimbolandia".
function contieneMarca(nombreProveedor, marca) {
    const a = plano(nombreProveedor);
    const b = plano(marca.nombre);
    return a === b || new RegExp(`(^|[^a-z0-9])${b.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^a-z0-9]|$)`).test(a);
}

// { id, nombre, existe } del proveedor que le toca a esa marca. Con crear = false no crea nada (solo sugiere).
async function proveedorParaMarca(db, negocioId, marca, crear) {
    await asegurarTabla(db);

    const mapeado = (await db.query(
        `SELECT p.id, p.nombre FROM public.proveedor_marcas m JOIN public.proveedores p ON p.id = m.proveedor_id AND p.negocio_id = m.negocio_id
         WHERE m.negocio_id = $1 AND m.marca_id = $2 AND p.activo = true`,
        [negocioId, marca.id]
    )).rows[0];

    if (mapeado) return { id: mapeado.id, nombre: mapeado.nombre, existe: true };

    const proveedores = (await db.query(`SELECT id, nombre FROM public.proveedores WHERE negocio_id = $1 AND activo = true`, [negocioId])).rows;
    const iguales = proveedores.filter(p => plano(p.nombre) === plano(marca.nombre));
    const contienen = iguales.length ? iguales : proveedores.filter(p => contieneMarca(p.nombre, marca));

    if (contienen.length === 1) return { id: contienen[0].id, nombre: contienen[0].nombre, existe: true };

    if (!crear) return { id: null, nombre: marca.nombre, existe: false };

    const id = await resolverOcrearProveedorId(db, negocioId, marca.nombre);

    return id ? { id, nombre: marca.nombre, existe: true } : null;
}

// Para un nombre de producto: que proveedor se le pondria (sin crear nada).
async function sugerirProveedor(db, negocioId, nombreProducto) {
    if (!(await esNegocioDeAbarrotes(db, negocioId))) return null;

    const marca = marcaPorNombre(nombreProducto);
    if (!marca) return null;

    const p = await proveedorParaMarca(db, negocioId, marca, false);
    return p ? { marcaId: marca.id, marca: marca.nombre, proveedorId: p.id, proveedor: p.nombre, existe: p.existe } : null;
}

// Al dar de alta un producto sin proveedor. Nunca lanza.
async function asignarProveedorAlAlta(db, negocioId, productoId, nombreProducto) {
    try {
        if (!(await esNegocioDeAbarrotes(db, negocioId))) return null;

        const fila = (await db.query(`SELECT proveedor_id, proveedor FROM public.productos WHERE id = $1 AND negocio_id = $2`, [productoId, negocioId])).rows[0];
        if (!fila || fila.proveedor_id || String(fila.proveedor || "").trim()) return null;

        const marca = marcaPorNombre(nombreProducto);
        if (!marca) return null;

        const p = await proveedorParaMarca(db, negocioId, marca, true);
        if (!p) return null;

        await db.query(`UPDATE public.productos SET proveedor_id = $1, proveedor = $2 WHERE id = $3 AND negocio_id = $4`, [p.id, p.nombre, productoId, negocioId]);
        return p.nombre;
    } catch (error) {
        console.error("No se pudo poner el proveedor por marca", error.message);
        return null;
    }
}

// El dueño asigno este proveedor a estos productos: el negocio aprende quien le vende cada marca. Nunca lanza.
async function aprenderMarcas(db, negocioId, proveedorId, productoIds) {
    try {
        if (!(await esNegocioDeAbarrotes(db, negocioId))) return 0;
        await asegurarTabla(db);

        const productos = (await db.query(`SELECT nombre FROM public.productos WHERE negocio_id = $1 AND id = ANY($2::int[])`, [negocioId, productoIds])).rows;
        const marcas = new Set(productos.map(p => marcaPorNombre(p.nombre)).filter(Boolean).map(m => m.id));

        for (const marcaId of marcas) {
            await db.query(
                `INSERT INTO public.proveedor_marcas (negocio_id, marca_id, proveedor_id) VALUES ($1, $2, $3)
                 ON CONFLICT (negocio_id, marca_id) DO UPDATE SET proveedor_id = EXCLUDED.proveedor_id, updated_at = NOW()`,
                [negocioId, marcaId, proveedorId]
            );
        }

        return marcas.size;
    } catch (error) {
        console.error("No se pudo aprender la marca del proveedor", error.message);
        return 0;
    }
}

// Para los productos que ya estan: les pone proveedor por marca. Solo toca los que no tienen proveedor_id; los de marca desconocida quedan como estaban.
async function acomodarPorMarca(db, negocioId) {
    const productos = (await db.query(`SELECT id, nombre FROM public.productos WHERE negocio_id = $1 AND proveedor_id IS NULL ORDER BY id`, [negocioId])).rows;
    const antes = new Set((await db.query(`SELECT id FROM public.proveedores WHERE negocio_id = $1`, [negocioId])).rows.map(r => r.id));
    const cache = new Map();
    const creados = new Set();
    let asignados = 0;
    let sinMarca = 0;

    for (const p of productos) {
        const marca = marcaPorNombre(p.nombre);

        if (!marca) { sinMarca++; continue; }

        if (!cache.has(marca.id)) cache.set(marca.id, await proveedorParaMarca(db, negocioId, marca, true));

        const prov = cache.get(marca.id);
        if (!prov) { sinMarca++; continue; }

        if (!antes.has(prov.id)) creados.add(prov.nombre);

        await db.query(`UPDATE public.productos SET proveedor_id = $1, proveedor = $2 WHERE id = $3 AND negocio_id = $4`, [prov.id, prov.nombre, p.id, negocioId]);
        asignados++;
    }

    return { revisados: productos.length, asignados, sinMarca, creados: [...creados] };
}

module.exports = { proveedorParaMarca, sugerirProveedor, asignarProveedorAlAlta, aprenderMarcas, acomodarPorMarca, asegurarTabla, plano, MARCAS };
