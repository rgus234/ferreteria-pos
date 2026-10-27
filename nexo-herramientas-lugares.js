// Herramientas de "Dile a Nexo" para inventario fisico: donde esta un producto, que lugares tiene la tienda, preparar el movimiento de un
// producto a otro lugar y preparar el alta de un producto con la configuracion sugerida y su lugar.
// REGLA: ninguna de estas herramientas escribe nada. Solo consultan o preparan un borrador; el usuario lo confirma en la pantalla.
const { desglose } = require("./existencias-lugar-server");
const { sugerirConfiguracion } = require("./sugerencia-alta-server");

const UNIDADES = ["pieza", "kilo", "metro", "litro", "paquete"];
const num = valor => (Number.isFinite(Number(valor)) ? Number(valor) : 0);

const sinAcentos = texto => String(texto || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim();

async function lugaresDelNegocio(pool, negocioId) {
    const filas = (await pool.query(`SELECT id, zona, tipo, nombre, codigo, padre_id FROM public.ubicaciones WHERE negocio_id = $1 AND activa = true ORDER BY zona, orden, id`, [negocioId])).rows;
    const porId = new Map(filas.map(f => [f.id, f]));
    const ruta = fila => {
        const partes = [];
        for (let a = fila, g = 0; a && g++ < 12; a = a.padre_id ? porId.get(a.padre_id) : null) partes.unshift(a.nombre);
        return partes.join(" › ");
    };

    return filas.map(f => ({ id: f.id, zona: f.zona, tipo: f.tipo, nombre: f.nombre, codigo: f.codigo, ruta: ruta(f) }));
}

// Un lugar por lo que dijo la persona ("bebidas", "el refri", "E-03"): coincidencia exacta de nombre/codigo primero, luego por contenido.
function elegirLugar(lugares, texto) {
    const t = sinAcentos(texto);

    if (!t) return { lugar: null, candidatos: [] };

    const exactos = lugares.filter(l => sinAcentos(l.nombre) === t || sinAcentos(l.codigo) === t);
    if (exactos.length === 1) return { lugar: exactos[0], candidatos: [] };

    const parciales = lugares.filter(l => sinAcentos(l.nombre).includes(t) || sinAcentos(l.ruta).includes(t) || t.includes(sinAcentos(l.nombre)));
    if (parciales.length === 1) return { lugar: parciales[0], candidatos: [] };

    return { lugar: null, candidatos: (exactos.length ? exactos : parciales).slice(0, 6) };
}

async function dondeEstaProducto(pool, negocioId, termino) {
    const texto = String(termino || "").trim();

    if (texto.length < 2) return { productos: [], aviso: "Dime que producto buscas." };

    const patron = "%" + texto.replace(/[\\%_]/g, m => "\\" + m) + "%";
    const filas = (await pool.query(
        `SELECT p.id, p.nombre, p.codigo, p.stock, p.unidad_venta, p.ubicacion,
                (SELECT COALESCE(SUM(pu.cantidad), 0) FROM public.producto_ubicaciones pu JOIN public.ubicaciones ub ON ub.id = pu.ubicacion_id AND ub.zona = 'bodega' WHERE pu.producto_id = p.id) AS bodega_total
         FROM public.productos p WHERE p.negocio_id = $1 AND (p.nombre ILIKE $2 OR p.codigo ILIKE $2) ORDER BY (p.codigo = $3) DESC, p.nombre LIMIT 8`,
        [negocioId, patron, texto]
    )).rows;

    return {
        termino: texto,
        productos: filas.map(p => ({ nombre: p.nombre, codigo: p.codigo, unidad: p.unidad_venta, lugar: p.ubicacion || "Sin lugar asignado", ...(({ total, bodega, exhibicion }) => ({ total, enBodega: bodega, enEstante: exhibicion }))(desglose(p.stock, p.bodega_total)) }))
    };
}

async function lugaresTienda(pool, negocioId) {
    const lugares = await lugaresDelNegocio(pool, negocioId);
    const conteos = new Map((await pool.query(
        `SELECT u AS id, COUNT(*)::int AS n FROM (SELECT ubicacion_id AS u FROM public.productos WHERE negocio_id = $1 AND ubicacion_id IS NOT NULL UNION ALL SELECT ubicacion_bodega_id FROM public.productos WHERE negocio_id = $1 AND ubicacion_bodega_id IS NOT NULL) t GROUP BY u`,
        [negocioId]
    )).rows.map(r => [r.id, r.n]));

    return { lugares: lugares.map(l => ({ nombre: l.nombre, codigo: l.codigo, ruta: l.ruta, zona: l.zona, productos: conteos.get(l.id) || 0 })) };
}

// Prepara "mover X a Y": busca el producto y el lugar y, si hay una sola respuesta clara de cada uno, deja el borrador.
async function prepararMovimiento(pool, negocioId, input) {
    const termino = String(input?.producto || input?.termino || "").trim();
    const lugarTexto = String(input?.lugar || "").trim();

    if (!termino || !lugarTexto) return { ok: false, error: "Hace falta decir que producto y a que lugar." };

    const patron = "%" + termino.replace(/[\\%_]/g, m => "\\" + m) + "%";
    const productos = (await pool.query(
        `SELECT id, nombre, codigo, ubicacion FROM public.productos WHERE negocio_id = $1 AND (nombre ILIKE $2 OR codigo ILIKE $2) ORDER BY (codigo = $3) DESC, nombre LIMIT 6`,
        [negocioId, patron, termino]
    )).rows;

    if (!productos.length) return { ok: false, error: `No encontre ningun producto que se parezca a "${termino}".` };
    if (productos.length > 1 && productos[0].codigo !== termino) return { ok: false, error: "Hay varios productos que coinciden; pregunta cual es.", opciones: productos.map(p => p.nombre) };

    const lugares = await lugaresDelNegocio(pool, negocioId);

    if (!lugares.length) return { ok: false, error: "Todavia no hay lugares creados. Se crean en Inventario → Abrir mapa." };

    const { lugar, candidatos } = elegirLugar(lugares, lugarTexto);

    if (!lugar) {
        return candidatos.length
            ? { ok: false, error: "Hay varios lugares que coinciden; pregunta cual es.", opciones: candidatos.map(l => `${l.nombre} (${l.codigo})`) }
            : { ok: false, error: `No encuentro el lugar "${lugarTexto}".`, opciones: lugares.slice(0, 12).map(l => l.nombre) };
    }

    const p = productos[0];

    return { ok: true, datos: { productoId: p.id, producto: p.nombre, desde: p.ubicacion || "Sin lugar", lugarId: lugar.id, lugar: lugar.nombre, lugarRuta: lugar.ruta, zona: lugar.zona } };
}

// Borrador de producto: lo que dijo la persona + la configuracion que usan sus productos parecidos (si no la dijo) + su lugar.
async function prepararProducto(pool, negocioId, input) {
    const nombre = String(input?.nombre || "").trim();

    if (!nombre) return { ok: false, error: "Hace falta al menos un nombre." };

    const datos = {
        nombre,
        codigo: String(input?.codigo || "").trim(),
        precio: num(input?.precio),
        precioMayoreo: num(input?.precioMayoreo),
        stock: num(input?.stock),
        stockMinimo: input?.stockMinimo === undefined ? null : num(input.stockMinimo),
        telefono: "", correo: "", contacto: "", limiteCredito: 0
    };

    const dicho = {
        unidadVenta: UNIDADES.includes(String(input?.unidadVenta || "").toLowerCase()) ? String(input.unidadVenta).toLowerCase() : null,
        presentacionCompra: input?.presentacionCompra ? String(input.presentacionCompra).trim().toUpperCase().slice(0, 30) : null,
        factorConversion: num(input?.factorConversion) > 0 ? num(input.factorConversion) : null,
        permiteVentaPieza: input?.permiteVentaPieza === true ? true : null
    };

    const algoDicho = Object.values(dicho).some(v => v !== null);

    if (algoDicho) {
        datos.config = { unidadVenta: dicho.unidadVenta || "pieza", presentacionCompra: dicho.presentacionCompra || "", factorConversion: dicho.factorConversion, permiteVentaPieza: Boolean(dicho.permiteVentaPieza) };
        datos.origenConfig = "indicada";
    } else {
        const sugerencia = await sugerirConfiguracion(pool, negocioId, nombre).catch(() => null);

        if (sugerencia?.sugerencia) {
            const c = sugerencia.sugerencia.configuracion;
            datos.config = { unidadVenta: c.unidad_venta || "pieza", presentacionCompra: c.presentacion_compra || "", factorConversion: c.factor_conversion ?? null, permiteVentaPieza: Boolean(c.permite_venta_pieza) };
            datos.origenConfig = "sugerida";
            datos.resumenConfig = `${sugerencia.sugerencia.resumen} (como tus productos parecidos: ${sugerencia.familia})`;
            if (datos.stockMinimo === null && c.stock_minimo !== null && c.stock_minimo !== undefined) datos.stockMinimo = Number(c.stock_minimo);
        }
    }

    if (input?.lugar) {
        const lugares = await lugaresDelNegocio(pool, negocioId);
        const { lugar, candidatos } = elegirLugar(lugares, input.lugar);

        if (lugar) { datos.lugarId = lugar.id; datos.lugar = lugar.nombre; datos.lugarRuta = lugar.ruta; datos.zona = lugar.zona; }
        else datos.lugarNoEncontrado = String(input.lugar) + (candidatos.length ? ` (¿${candidatos.map(l => l.nombre).join(" o ")}?)` : "");
    }

    return { ok: true, tipo: "producto", datos };
}

module.exports = { dondeEstaProducto, lugaresTienda, prepararMovimiento, prepararProducto, elegirLugar };
