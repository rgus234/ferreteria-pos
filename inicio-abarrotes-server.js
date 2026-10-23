// Inicio de abarrotes: lo que un tendero necesita ver al abrir el sistema.
//
//   - cuanto vendio hoy y cuanto GANO de verdad (precio de venta menos lo que le cuesta);
//   - los ultimos 7 dias;
//   - que productos le dejan mas (y cuales le dejan poco o pierde);
//   - lo que vence pronto, lo que toca pedirle al proveedor, el fiado por cobrar.
//
// Nada se guarda aqui: todo se calcula de ventas, productos, lotes y proveedores que ya existen.
// La ganancia usa el costo ACTUAL del producto (precio distribuidor). Si un producto vendido no
// tiene costo, su venta cuenta en "vendido" pero no en "ganancia", y se avisa cuantos faltan.

const { responderError } = require("./error-utils");
const { PERMISOS, requerirPermiso } = require("./rbac");
const { calcularAntiguedadCredito } = require("./credit-aging");
const { lotesPorRevisar, resumirLotes, fechaLocal } = require("./lotes-server");
const { sugeridoDeProveedor } = require("./pedido-sugerido-server");
const { proximaVisita, sumarDias } = require("./pedido-sugerido-calculo");

const ZONA = "America/Mexico_City";
const DIAS_HISTORIAL = 30;

function dinero(valor) {
    return Number((Number(valor) || 0).toFixed(2));
}

function costoDe(producto) {
    return Number(producto.precio_distribuidor) || Number(producto.costo) || 0;
}

// Ventas por producto y por dia (hora de Mexico) de los ultimos N dias.
async function ventasPorProductoYDia(pool, negocioId, dias) {
    const filas = await pool.query(
        `SELECT (item->>'id')::int AS producto_id,
                to_char(h.fecha AT TIME ZONE '${ZONA}', 'YYYY-MM-DD') AS dia,
                COALESCE(SUM((item->>'cantidad')::numeric), 0) AS unidades,
                COALESCE(SUM((item->>'importe')::numeric), 0) AS importe
         FROM public.historial_ventas h
         CROSS JOIN LATERAL jsonb_array_elements(h.productos) AS item
         WHERE h.negocio_id = $1 AND h.estado = 'completada'
         AND h.fecha >= NOW() - ($2 || ' days')::interval
         AND item->>'id' ~ '^[0-9]+$'
         GROUP BY 1, 2`,
        [negocioId, String(dias + 1)]
    );

    return filas.rows.map(f => ({ productoId: f.producto_id, dia: f.dia, unidades: Number(f.unidades), importe: Number(f.importe) }));
}

// Recargas y pagos de servicios: lineas de venta con "servicio" adentro. Su ganancia es la comision
// (importe menos lo que costo pagarle al proveedor). Sin costo no se inventa comision.
async function serviciosPorDia(pool, negocioId, dias) {
    const filas = await pool.query(
        `SELECT to_char(h.fecha AT TIME ZONE '${ZONA}', 'YYYY-MM-DD') AS dia,
                COALESCE(NULLIF(item->'servicio'->>'proveedor', ''), 'Otro') AS proveedor,
                COALESCE(NULLIF(item->'servicio'->>'tipo', ''), 'servicio') AS tipo,
                COALESCE(SUM((item->>'cantidad')::numeric), 0) AS operaciones,
                COALESCE(SUM((item->>'importe')::numeric), 0) AS importe,
                COALESCE(SUM(CASE WHEN item ? 'costo' THEN (item->>'importe')::numeric - (item->>'cantidad')::numeric * (item->>'costo')::numeric ELSE 0 END), 0) AS comision
         FROM public.historial_ventas h
         CROSS JOIN LATERAL jsonb_array_elements(h.productos) AS item
         WHERE h.negocio_id = $1 AND h.estado = 'completada'
         AND h.fecha >= NOW() - ($2 || ' days')::interval
         AND item ? 'servicio'
         GROUP BY 1, 2, 3`,
        [negocioId, String(dias + 1)]
    );

    return filas.rows.map(f => ({ dia: f.dia, proveedor: f.proveedor, tipo: f.tipo, operaciones: Number(f.operaciones), importe: Number(f.importe), comision: Number(f.comision) }));
}

async function totalesPorDia(pool, negocioId, dias) {
    const filas = await pool.query(
        `SELECT to_char(h.fecha AT TIME ZONE '${ZONA}', 'YYYY-MM-DD') AS dia, COUNT(*) AS ventas, COALESCE(SUM(h.total), 0) AS total
         FROM public.historial_ventas h
         WHERE h.negocio_id = $1 AND h.estado = 'completada' AND h.fecha >= NOW() - ($2 || ' days')::interval
         GROUP BY 1`,
        [negocioId, String(dias + 1)]
    );

    return new Map(filas.rows.map(f => [f.dia, { ventas: Number(f.ventas), total: Number(f.total) }]));
}

// Ganancia de cada producto vendido: importe - unidades x costo. Sin costo no hay ganancia que calcular.
function calcularGanancias(ventas, productos) {
    const porId = new Map(productos.map(p => [p.id, p]));
    const filas = [];
    const sinCosto = new Set();

    for (const v of ventas) {
        const producto = porId.get(v.productoId);
        const costo = producto ? costoDe(producto) : 0;

        if (!costo) {
            sinCosto.add(v.productoId);
        }

        filas.push({ ...v, nombre: producto?.nombre || "Producto eliminado", costo, ganancia: costo ? v.importe - v.unidades * costo : null });
    }

    return { filas, sinCosto };
}

// Resumen por producto en un rango de dias: unidades, vendido, ganancia y margen.
function resumenPorProducto(filas, desdeDia) {
    const mapa = new Map();

    for (const f of filas) {
        if (f.dia < desdeDia) continue;

        const actual = mapa.get(f.productoId) || { productoId: f.productoId, nombre: f.nombre, unidades: 0, vendido: 0, costoTotal: 0, ganancia: 0, conCosto: false };
        actual.unidades += f.unidades;
        actual.vendido += f.importe;

        if (f.ganancia !== null) {
            actual.ganancia += f.ganancia;
            actual.costoTotal += f.unidades * f.costo;
            actual.conCosto = true;
        }

        mapa.set(f.productoId, actual);
    }

    return [...mapa.values()].map(p => ({
        productoId: p.productoId,
        nombre: p.nombre,
        unidades: Number(p.unidades.toFixed(3)),
        vendido: dinero(p.vendido),
        ganancia: p.conCosto ? dinero(p.ganancia) : null,
        margen: p.conCosto && p.vendido > 0 ? Math.round((p.ganancia / p.vendido) * 100) : null
    }));
}

async function fiadoResumen(pool, negocioId) {
    const clientes = (await pool.query(
        `SELECT c.id,
                COALESCE(SUM(CASE WHEN m.tipo = 'venta' THEN m.monto WHEN m.tipo = 'abono' THEN -m.monto ELSE 0 END), 0) AS saldo
         FROM public.clientes_credito c
         LEFT JOIN public.movimientos_credito m ON m.cliente_id = c.id AND m.negocio_id = c.negocio_id
         WHERE c.activo = true AND c.negocio_id = $1 AND c.es_visitante_sitio = false
         GROUP BY c.id`,
        [negocioId]
    )).rows;

    const movimientos = (await pool.query(
        `SELECT cliente_id, tipo, monto, fecha, fecha_vencimiento FROM public.movimientos_credito
         WHERE negocio_id = $1 ORDER BY cliente_id, fecha ASC, id ASC`,
        [negocioId]
    )).rows;

    const porCliente = new Map();
    for (const m of movimientos) {
        if (!porCliente.has(m.cliente_id)) porCliente.set(m.cliente_id, []);
        porCliente.get(m.cliente_id).push(m);
    }

    let total = 0, clientesConDeuda = 0, vencido = 0, clientesVencidos = 0;

    for (const cliente of clientes) {
        const saldo = Number(cliente.saldo);
        if (saldo <= 0.005) continue;

        total += saldo;
        clientesConDeuda++;

        const aging = calcularAntiguedadCredito(porCliente.get(cliente.id) || []);
        if (aging.vencido) {
            vencido += aging.totalVencido;
            clientesVencidos++;
        }
    }

    return { total: dinero(total), clientes: clientesConDeuda, vencido: dinero(vencido), clientesVencidos };
}

async function porSurtir(pool, negocioId, hoy) {
    const proveedores = (await pool.query(
        `SELECT id, negocio_id, nombre, dia_visita, frecuencia_dias FROM public.proveedores
         WHERE negocio_id = $1 AND activo = true AND dia_visita IS NOT NULL`,
        [negocioId]
    )).rows;

    const resultado = [];

    for (const proveedor of proveedores) {
        const visita = proximaVisita(hoy, proveedor.dia_visita);
        if (!visita || visita.dias > 7) continue;

        const sugerido = await sugeridoDeProveedor(pool, negocioId, proveedor, hoy);
        if (!sugerido.items.length) continue;

        resultado.push({ proveedorId: proveedor.id, proveedor: proveedor.nombre, dias: visita.dias, productos: sugerido.items.length, total: sugerido.total });
    }

    return resultado.sort((a, b) => a.dias - b.dias).slice(0, 3);
}

async function resumenInicio(pool, negocioId, hoy = fechaLocal()) {
    const productos = (await pool.query(
        `SELECT id, nombre, stock, stock_minimo, precio_distribuidor, costo FROM public.productos WHERE negocio_id = $1`,
        [negocioId]
    )).rows;

    const ventas = await ventasPorProductoYDia(pool, negocioId, DIAS_HISTORIAL);
    const totales = await totalesPorDia(pool, negocioId, DIAS_HISTORIAL);
    const { filas, sinCosto } = calcularGanancias(ventas, productos);
    const servicios = await serviciosPorDia(pool, negocioId, DIAS_HISTORIAL);

    const gananciaDelDia = dia =>
        filas.filter(f => f.dia === dia && f.ganancia !== null).reduce((suma, f) => suma + f.ganancia, 0)
        + servicios.filter(f => f.dia === dia).reduce((suma, f) => suma + f.comision, 0);

    const serviciosHoy = servicios.filter(f => f.dia === hoy);

    const semana = [];
    for (let atras = 6; atras >= 0; atras--) {
        const dia = sumarDias(hoy, -atras);
        const t = totales.get(dia) || { ventas: 0, total: 0 };
        semana.push({ dia, ventas: t.ventas, total: dinero(t.total), ganancia: dinero(gananciaDelDia(dia)) });
    }

    const ayer = sumarDias(hoy, -1);
    const hoyTotales = totales.get(hoy) || { ventas: 0, total: 0 };

    const ranking = resumenPorProducto(filas, sumarDias(hoy, -29)).filter(p => p.ganancia !== null);
    const masGanancia = ranking.filter(p => p.ganancia > 0).sort((a, b) => b.ganancia - a.ganancia).slice(0, 5);
    const pierden = ranking.filter(p => p.ganancia <= 0 || (p.margen !== null && p.margen < 5)).sort((a, b) => a.ganancia - b.ganancia).slice(0, 5);

    const filasLotes = await lotesPorRevisar(pool, negocioId, { dias: 3, hoy });
    const inventario = productos.reduce((a, p) => {
        const stock = Number(p.stock) || 0;
        a.productos++;
        if (stock <= 0) a.sinStock++;
        else if (stock <= (Number(p.stock_minimo) || 0)) a.bajos++;
        return a;
    }, { productos: 0, bajos: 0, sinStock: 0 });

    return {
        hoy: {
            fecha: hoy,
            ventas: hoyTotales.ventas,
            total: dinero(hoyTotales.total),
            ganancia: dinero(gananciaDelDia(hoy)),
            ayerTotal: dinero((totales.get(ayer) || { total: 0 }).total)
        },
        semana,
        masGanancia,
        pierden,
        // Recargas y pagos de servicios de hoy: cuantas, cuanto se movio y cuanto te queda de comision.
        servicios: {
            operaciones: serviciosHoy.reduce((s, f) => s + f.operaciones, 0),
            importe: dinero(serviciosHoy.reduce((s, f) => s + f.importe, 0)),
            comision: dinero(serviciosHoy.reduce((s, f) => s + f.comision, 0)),
            porProveedor: serviciosHoy.map(f => ({ proveedor: f.proveedor, tipo: f.tipo, operaciones: f.operaciones, importe: dinero(f.importe), comision: dinero(f.comision) })).sort((a, b) => b.importe - a.importe)
        },
        productosSinCosto: sinCosto.size,
        porRevisar: { resumen: resumirLotes(filasLotes), lotes: filasLotes.slice(0, 4) },
        porSurtir: await porSurtir(pool, negocioId, hoy),
        fiado: await fiadoResumen(pool, negocioId),
        inventario
    };
}

function instalar(app, pool, requerirAccesoNegocio) {
    function negocioId(req) {
        const id = req.negocioDispositivo?.negocio_id ?? req.negocioAutenticado?.negocio_id;

        if (!id) {
            const error = new Error("Este equipo no esta vinculado a ningun negocio");
            error.httpStatus = 401;
            throw error;
        }

        return id;
    }

    app.get("/abarrotes/inicio", requerirAccesoNegocio, requerirPermiso(PERMISOS.VER_REPORTES), async (req, res) => {
        try {
            res.json(await resumenInicio(pool, negocioId(req)));
        } catch (error) {
            responderError(res, error);
        }
    });

    // Reporte completo: cuanto dejo cada producto en 7, 30 o 90 dias.
    app.get("/abarrotes/ganancia-productos", requerirAccesoNegocio, requerirPermiso(PERMISOS.VER_REPORTES), async (req, res) => {
        try {
            const id = negocioId(req);
            const dias = [7, 30, 90].includes(Number(req.query.dias)) ? Number(req.query.dias) : 30;
            const hoy = fechaLocal();

            const productos = (await pool.query(
                `SELECT id, nombre, precio_distribuidor, costo FROM public.productos WHERE negocio_id = $1`, [id]
            )).rows;

            const { filas } = calcularGanancias(await ventasPorProductoYDia(pool, id, dias), productos);
            const lista = resumenPorProducto(filas, sumarDias(hoy, -(dias - 1)));

            // Recargas y servicios: una fila por proveedor ("Recargas · Telcel"), con la comision como ganancia.
            const desde = sumarDias(hoy, -(dias - 1));
            const porProveedor = new Map();

            for (const s of await serviciosPorDia(pool, id, dias)) {
                if (s.dia < desde) continue;

                const nombre = `${s.tipo === "recarga" ? "Recargas" : "Pagos"} · ${s.proveedor}`;
                const actual = porProveedor.get(nombre) || { productoId: null, nombre, unidades: 0, vendido: 0, ganancia: 0 };
                actual.unidades += s.operaciones;
                actual.vendido += s.importe;
                actual.ganancia += s.comision;
                porProveedor.set(nombre, actual);
            }

            for (const s of porProveedor.values()) {
                lista.push({
                    productoId: null,
                    nombre: s.nombre,
                    unidades: s.unidades,
                    vendido: dinero(s.vendido),
                    ganancia: dinero(s.ganancia),
                    margen: s.vendido > 0 ? Math.round((s.ganancia / s.vendido) * 100) : null
                });
            }

            const conGanancia = lista.filter(p => p.ganancia !== null).sort((a, b) => b.ganancia - a.ganancia);
            const sinCosto = lista.filter(p => p.ganancia === null).sort((a, b) => b.vendido - a.vendido);

            res.json({
                dias,
                productos: [...conGanancia, ...sinCosto],
                totalVendido: dinero(lista.reduce((s, p) => s + p.vendido, 0)),
                totalGanancia: dinero(conGanancia.reduce((s, p) => s + p.ganancia, 0)),
                sinCosto: sinCosto.length
            });
        } catch (error) {
            responderError(res, error);
        }
    });
}

module.exports = instalar;
module.exports.resumenInicio = resumenInicio;
module.exports.calcularGanancias = calcularGanancias;
module.exports.resumenPorProducto = resumenPorProducto;
