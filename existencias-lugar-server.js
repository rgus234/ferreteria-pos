// Existencias por lugar: cuanto hay en BODEGA y cuanto en EXHIBICION, "Resurtir de bodega" y conteo por estante
// (plan docs/plan-celular-inventario-y-venta.md, secciones H y AB).
//
// Idea central: productos.stock sigue siendo el TOTAL (las ventas lo descuentan como siempre, no se tocan).
// Lo que hay en bodega se guarda explicito (producto_ubicaciones.cantidad en lugares de zona "bodega") y
//   exhibicion = stock - bodega
// Asi cada venta baja la exhibicion sola ("primero de exhibicion"), y cuando la exhibicion llega a 0 y todavia hay
// en bodega, el producto aparece en "Resurtir". Resurtir solo mueve cantidad de la bodega a la exhibicion: no cambia el total.
const { responderError } = require("./error-utils");
const { PERMISOS, requerirPermiso } = require("./rbac");
const { agregarFotos } = require("./fotos-lugar");

const num = valor => Number(valor) || 0;
const redondear = valor => Math.round(num(valor) * 1000) / 1000;

// stock total + lo anotado en bodega -> como esta repartido. Si la bodega anotada supera el total (se vendio o
// se ajusto despues), la bodega real se limita al total y se avisa con "descuadre".
function desglose(stock, enBodega) {
    const total = Math.max(0, num(stock));
    const anotado = redondear(enBodega);
    const bodega = Math.min(anotado, total);

    return { total, bodega: redondear(bodega), exhibicion: redondear(total - bodega), descuadre: anotado > total };
}

function estadoResurtir(d, stockMinimo) {
    if (d.bodega <= 0) return null;
    if (d.exhibicion <= 0) return "agotado";
    if (num(stockMinimo) > 0 && d.exhibicion <= num(stockMinimo)) return "poco";
    return null;
}

// Compara lo contado contra lo esperado de cada producto de un lugar. lugar.zona decide que se esta contando.
function compararConteo(lugar, productos, conteos, incluirNoEscaneados) {
    const contados = new Map(conteos.map(c => [Number(c.productoId), num(c.cantidad)]));
    const lineas = [];

    for (const p of productos) {
        const d = desglose(p.stock, p.bodega_total);
        const esperado = lugar.zona === "bodega" ? num(p.cantidad_lugar) : d.exhibicion;
        const escaneado = contados.has(p.id);

        if (!escaneado && !incluirNoEscaneados) {
            lineas.push({ productoId: p.id, nombre: p.nombre, esperado, contado: null, diferencia: 0, noEscaneado: true });
            continue;
        }

        const contado = escaneado ? contados.get(p.id) : 0;
        lineas.push({ productoId: p.id, nombre: p.nombre, esperado, contado, diferencia: redondear(contado - esperado), noEscaneado: !escaneado });
    }

    const faltan = redondear(lineas.filter(l => l.diferencia < 0).reduce((s, l) => s + -l.diferencia, 0));
    const sobran = redondear(lineas.filter(l => l.diferencia > 0).reduce((s, l) => s + l.diferencia, 0));

    return { lineas, faltan, sobran };
}

function instalar(app, pool, requerirAccesoNegocio, firmarTokenImagen) {
    const puedeInventario = requerirPermiso(PERMISOS.MODIFICAR_INVENTARIO);

    function negocioId(req) {
        const id = req.negocioDispositivo?.negocio_id ?? req.negocioAutenticado?.negocio_id;

        if (!id) {
            const error = new Error("Este equipo no esta vinculado a ningun negocio");
            error.httpStatus = 401;
            throw error;
        }

        return id;
    }

    function fallo(res, estado, mensaje) {
        res.status(estado).json({ ok: false, error: mensaje });
    }

    async function quien(db, id, req) {
        const empleadoId = Number(req.headers["x-empleado-id"]) || null;
        const nombre = empleadoId ? (await db.query(`SELECT nombre FROM public.empleados WHERE id = $1 AND negocio_id = $2`, [empleadoId, id])).rows[0]?.nombre : "";
        return { empleadoId, nombre: nombre || "" };
    }

    async function bitacora(db, id, empleadoId, accion, detalle) {
        try {
            await db.query(`INSERT INTO public.bitacora_acciones (negocio_id, empleado_id, accion, detalle) VALUES ($1, $2, $3, $4::jsonb)`, [id, empleadoId, accion, JSON.stringify(detalle)]);
        } catch (error) {
            // La bitacora nunca debe tumbar la operacion real que registra.
        }
    }

    async function rutas(db, id) {
        const filas = (await db.query(`SELECT id, zona, nombre, padre_id FROM public.ubicaciones WHERE negocio_id = $1 AND activa = true`, [id])).rows;
        const porId = new Map(filas.map(f => [f.id, f]));
        const ruta = fila => {
            const partes = [];
            for (let a = fila, g = 0; a && g++ < 12; a = a.padre_id ? porId.get(a.padre_id) : null) partes.unshift(a.nombre);
            return partes.join(" › ");
        };
        return { porId, ruta };
    }

    // ---- Resurtir: que hay que pasar de la bodega a la exhibicion ----

    async function listaResurtir(id) {
        {
            const { porId, ruta } = await rutas(pool, id);
            const filas = (await pool.query(
                `SELECT p.id, p.nombre, p.codigo, p.stock, p.stock_minimo, p.unidad_venta, p.ubicacion_id,
                        json_agg(json_build_object('ubicacionId', pu.ubicacion_id, 'cantidad', pu.cantidad) ORDER BY pu.cantidad DESC) AS lugares,
                        SUM(pu.cantidad) AS bodega_total
                 FROM public.producto_ubicaciones pu
                 JOIN public.ubicaciones u ON u.id = pu.ubicacion_id AND u.zona = 'bodega' AND u.activa = true
                 JOIN public.productos p ON p.id = pu.producto_id AND p.negocio_id = $1
                 WHERE pu.negocio_id = $1 AND pu.cantidad > 0
                 GROUP BY p.id`,
                [id]
            )).rows;

            const lista = filas.map(p => {
                const d = desglose(p.stock, p.bodega_total);
                return {
                    productoId: p.id, nombre: p.nombre, codigo: p.codigo, unidadVenta: p.unidad_venta, ...d,
                    estado: estadoResurtir(d, p.stock_minimo),
                    estante: p.ubicacion_id && porId.get(p.ubicacion_id) ? "Tienda › " + ruta(porId.get(p.ubicacion_id)) : "",
                    lugaresBodega: p.lugares.filter(l => porId.get(l.ubicacionId)).map(l => ({ ubicacionId: l.ubicacionId, ruta: ruta(porId.get(l.ubicacionId)), cantidad: num(l.cantidad) }))
                };
            }).filter(p => p.estado).sort((a, b) => (a.estado === "agotado" ? 0 : 1) - (b.estado === "agotado" ? 0 : 1) || a.nombre.localeCompare(b.nombre));

            return agregarFotos(pool, id, lista, firmarTokenImagen);
        }
    }

    app.get("/resurtir", requerirAccesoNegocio, async (req, res) => {
        try {
            const lista = await listaResurtir(negocioId(req));
            res.json({ ok: true, productos: lista, agotados: lista.filter(p => p.estado === "agotado").length });
        } catch (error) {
            responderError(res, error);
        }
    });

    // Indicadores de la pantalla principal del celular: todo calculado del inventario real del negocio.
    app.get("/ubicaciones/resumen", requerirAccesoNegocio, async (req, res) => {
        try {
            const id = negocioId(req);
            const fila = (await pool.query(
                `SELECT
                    (SELECT COUNT(*)::int FROM public.ubicaciones WHERE negocio_id = $1 AND activa = true) AS ubicaciones,
                    COUNT(*) FILTER (WHERE ubicacion_id IS NOT NULL OR ubicacion_bodega_id IS NOT NULL)::int AS con_lugar,
                    COUNT(*) FILTER (WHERE ubicacion_id IS NULL AND ubicacion_bodega_id IS NULL AND stock > 0)::int AS sin_lugar
                 FROM public.productos WHERE negocio_id = $1`,
                [id]
            )).rows[0];
            const resurtir = await listaResurtir(id);
            // Si todavia no se corrio la migracion de conteos, el indicador simplemente queda en 0.
            const conteosPendientes = await pool.query(`SELECT COUNT(*)::int AS n FROM public.conteos_inventario WHERE negocio_id = $1 AND estado = $2`, [id, "pendiente"]).then(r => r.rows[0].n).catch(() => 0);

            res.json({ ok: true, conteosPendientes, ubicaciones: fila.ubicaciones, productosConLugar: fila.con_lugar, productosSinLugar: fila.sin_lugar, porResurtir: resurtir.length, agotados: resurtir.filter(p => p.estado === "agotado").length });
        } catch (error) {
            responderError(res, error);
        }
    });

    // Ficha del producto: lo que se quiere ver al tocarlo en un estante (sin costos).
    app.get("/ubicaciones/producto/:id", requerirAccesoNegocio, async (req, res) => {
        try {
            const id = negocioId(req);
            const p = (await pool.query(
                `SELECT id, nombre, codigo, marca, categoria, subcategoria, unidad_venta, presentacion_compra, factor_conversion, permite_venta_pieza, bascula_digital,
                        precio, precio_mayoreo, stock, stock_minimo, ubicacion, ubicacion_id, ubicacion_bodega_id
                 FROM public.productos WHERE id = $1 AND negocio_id = $2`,
                [Number(req.params.id), id]
            )).rows[0];

            if (!p) { fallo(res, 404, "Ese producto no existe."); return; }

            const { porId, ruta } = await rutas(pool, id);
            const bodegas = (await pool.query(`SELECT pu.ubicacion_id, pu.cantidad FROM public.producto_ubicaciones pu JOIN public.ubicaciones u ON u.id = pu.ubicacion_id AND u.zona = 'bodega' WHERE pu.producto_id = $1 AND pu.cantidad > 0 ORDER BY pu.cantidad DESC`, [p.id])).rows;
            const d = desglose(p.stock, bodegas.reduce((t, b) => t + num(b.cantidad), 0));
            const [conFoto] = await agregarFotos(pool, id, [{ codigo: p.codigo }], firmarTokenImagen);

            // Ultimos movimientos de lugar (quien lo movio, cuando, de donde a donde).
            const movimientos = (await pool.query(
                `SELECT b.accion, b.detalle, b.created_at, e.nombre AS quien
                 FROM public.bitacora_acciones b LEFT JOIN public.empleados e ON e.id = b.empleado_id
                 WHERE b.negocio_id = $1 AND b.accion IN ('producto_movido', 'producto_acomodado') AND (b.detalle->>'productoId')::int = $2
                 ORDER BY b.created_at DESC LIMIT 5`,
                [id, p.id]
            ).catch(() => ({ rows: [] }))).rows.map(m => ({ accion: m.accion, desde: m.detalle?.desde || "", hacia: m.detalle?.hacia || "", quien: m.quien || "Dueño", cuando: m.created_at }));

            res.json({
                ok: true,
                producto: {
                    movimientos,
                    id: p.id, nombre: p.nombre, codigo: p.codigo, marca: p.marca || "", categoria: p.categoria || "", subcategoria: p.subcategoria || "",
                    unidadVenta: p.unidad_venta, presentacionCompra: p.presentacion_compra || "", factorConversion: p.factor_conversion === null ? null : num(p.factor_conversion),
                    permiteVentaPieza: p.permite_venta_pieza, basculaDigital: p.bascula_digital === "si",
                    precio: num(p.precio), precioMayoreo: p.precio_mayoreo === null ? null : num(p.precio_mayoreo), stockMinimo: num(p.stock_minimo),
                    ...d, imagenUrl: conFoto.imagenUrl,
                    estante: p.ubicacion_id && porId.get(p.ubicacion_id) ? { id: p.ubicacion_id, ruta: ruta(porId.get(p.ubicacion_id)) } : null,
                    bodegas: bodegas.filter(b => porId.get(b.ubicacion_id)).map(b => ({ id: b.ubicacion_id, ruta: ruta(porId.get(b.ubicacion_id)), cantidad: num(b.cantidad) }))
                }
            });
        } catch (error) {
            responderError(res, error);
        }
    });

    // "¿Donde esta?": busca por nombre o codigo y dice en que estante / bodega esta y cuanto hay en cada lado.
    app.get("/ubicaciones/buscar", requerirAccesoNegocio, async (req, res) => {
        try {
            const id = negocioId(req);
            const texto = String(req.query.q || "").trim();

            if (texto.length < 2) { res.json({ ok: true, productos: [] }); return; }

            const patron = "%" + texto.replace(/[\\%_]/g, m => "\\" + m) + "%";
            const filas = (await pool.query(
                `SELECT p.id, p.nombre, p.codigo, p.stock, p.unidad_venta, p.ubicacion,
                        (SELECT COALESCE(SUM(pu.cantidad), 0) FROM public.producto_ubicaciones pu JOIN public.ubicaciones ub ON ub.id = pu.ubicacion_id AND ub.zona = 'bodega' WHERE pu.producto_id = p.id) AS bodega_total
                 FROM public.productos p
                 WHERE p.negocio_id = $1 AND (p.nombre ILIKE $2 OR p.codigo ILIKE $2)
                 ORDER BY (p.codigo = $3) DESC, p.nombre LIMIT 20`,
                [id, patron, texto]
            )).rows;

            const lista = filas.map(p => ({ id: p.id, nombre: p.nombre, codigo: p.codigo, unidadVenta: p.unidad_venta, ubicacion: p.ubicacion || "", ...desglose(p.stock, p.bodega_total) }));

            res.json({ ok: true, productos: await agregarFotos(pool, id, lista, firmarTokenImagen) });
        } catch (error) {
            responderError(res, error);
        }
    });

    // Pasa cantidad de una seccion de bodega a la exhibicion. No cambia el total.
    app.post("/resurtir", requerirAccesoNegocio, puedeInventario, async (req, res) => {
        const cliente = await pool.connect();

        try {
            const id = negocioId(req);
            const productoId = Number(req.body?.productoId);
            const desdeId = Number(req.body?.desdeId);
            const cantidad = redondear(req.body?.cantidad);

            if (!productoId || !desdeId || !(cantidad > 0)) { fallo(res, 400, "Falta el producto, la seccion o la cantidad."); return; }

            await cliente.query("BEGIN");
            const producto = (await cliente.query(`SELECT id, nombre, stock FROM public.productos WHERE id = $1 AND negocio_id = $2 FOR UPDATE`, [productoId, id])).rows[0];
            const fila = (await cliente.query(`SELECT cantidad FROM public.producto_ubicaciones WHERE producto_id = $1 AND ubicacion_id = $2 AND negocio_id = $3 FOR UPDATE`, [productoId, desdeId, id])).rows[0];

            if (!producto || !fila) { await cliente.query("ROLLBACK"); fallo(res, 404, "Ese producto no esta en esa seccion de bodega."); return; }
            if (cantidad > num(fila.cantidad)) { await cliente.query("ROLLBACK"); fallo(res, 400, `En esa seccion solo hay ${num(fila.cantidad)}.`); return; }

            await cliente.query(`UPDATE public.producto_ubicaciones SET cantidad = cantidad - $3, updated_at = NOW() WHERE producto_id = $1 AND ubicacion_id = $2`, [productoId, desdeId, cantidad]);
            const otras = (await cliente.query(`SELECT COALESCE(SUM(cantidad), 0) AS t FROM public.producto_ubicaciones pu JOIN public.ubicaciones u ON u.id = pu.ubicacion_id AND u.zona = 'bodega' WHERE pu.producto_id = $1`, [productoId])).rows[0].t;
            const quienEs = await quien(cliente, id, req);

            await bitacora(cliente, id, quienEs.empleadoId, "resurtido", { productoId, producto: producto.nombre, desdeId, cantidad });
            await cliente.query("COMMIT");

            res.json({ ok: true, ...desglose(producto.stock, otras) });
        } catch (error) {
            await cliente.query("ROLLBACK").catch(() => {});
            responderError(res, error);
        } finally {
            cliente.release();
        }
    });

    // Anota cuanto de un producto hay en una seccion de bodega (alta, acomodo o ajuste manual). No puede pasar del total.
    app.post("/ubicaciones/:id/bodega", requerirAccesoNegocio, puedeInventario, async (req, res) => {
        try {
            const id = negocioId(req);
            const lugarId = Number(req.params.id);
            const productoId = Number(req.body?.productoId);
            const cantidad = redondear(req.body?.cantidad);
            const lugar = (await pool.query(`SELECT zona FROM public.ubicaciones WHERE id = $1 AND negocio_id = $2 AND activa = true`, [lugarId, id])).rows[0];

            if (!lugar) { fallo(res, 404, "Ese lugar no existe."); return; }
            if (lugar.zona !== "bodega") { fallo(res, 400, "Solo las secciones de bodega guardan cantidad aparte; en la tienda se calcula solo."); return; }
            if (!productoId || !(cantidad >= 0)) { fallo(res, 400, "Falta el producto o la cantidad."); return; }

            const producto = (await pool.query(`SELECT stock FROM public.productos WHERE id = $1 AND negocio_id = $2`, [productoId, id])).rows[0];
            if (!producto) { fallo(res, 404, "Ese producto no existe."); return; }

            const otras = num((await pool.query(`SELECT COALESCE(SUM(pu.cantidad), 0) AS t FROM public.producto_ubicaciones pu JOIN public.ubicaciones u ON u.id = pu.ubicacion_id AND u.zona = 'bodega' WHERE pu.producto_id = $1 AND pu.ubicacion_id <> $2`, [productoId, lugarId])).rows[0].t);

            if (otras + cantidad > num(producto.stock)) { fallo(res, 400, `Ese producto solo tiene ${num(producto.stock)} en total; no puede haber ${redondear(otras + cantidad)} en bodega.`); return; }

            await pool.query(
                `INSERT INTO public.producto_ubicaciones (negocio_id, producto_id, ubicacion_id, cantidad) VALUES ($1, $2, $3, $4)
                 ON CONFLICT (producto_id, ubicacion_id) DO UPDATE SET cantidad = EXCLUDED.cantidad, updated_at = NOW()`,
                [id, productoId, lugarId, cantidad]
            );
            await pool.query(`UPDATE public.productos SET ubicacion_bodega_id = $3 WHERE id = $1 AND negocio_id = $2 AND ubicacion_bodega_id IS NULL`, [productoId, id, lugarId]);

            // El texto de ubicacion del producto ("Tienda › ... · Bodega: ...") se mantiene al dia, igual que al asignar.
            const { porId, ruta } = await rutas(pool, id);
            const fila = (await pool.query(`SELECT ubicacion_id, ubicacion_bodega_id FROM public.productos WHERE id = $1`, [productoId])).rows[0];
            const tienda = fila.ubicacion_id && porId.get(fila.ubicacion_id) ? "Tienda › " + ruta(porId.get(fila.ubicacion_id)) : "";
            const bodega = fila.ubicacion_bodega_id && porId.get(fila.ubicacion_bodega_id) ? "Bodega: " + ruta(porId.get(fila.ubicacion_bodega_id)) : "";
            await pool.query(`UPDATE public.productos SET ubicacion = $2 WHERE id = $1`, [productoId, [tienda, bodega].filter(Boolean).join(" · ")]);

            res.json({ ok: true, ...desglose(producto.stock, otras + cantidad) });
        } catch (error) {
            responderError(res, error);
        }
    });

    // ---- Conteo por estante / seccion ----
    // aplicar=false: solo muestra "faltan X, sobran Y". aplicar=true: ajusta el total y deja el registro en ajustes_inventario.
    app.post("/ubicaciones/:id/conteo", requerirAccesoNegocio, puedeInventario, async (req, res) => {
        const cliente = await pool.connect();

        try {
            const id = negocioId(req);
            const lugarId = Number(req.params.id);
            const conteos = (Array.isArray(req.body?.conteos) ? req.body.conteos : []).filter(c => Number(c.productoId) > 0 && num(c.cantidad) >= 0).slice(0, 1000);
            const aplicar = req.body?.aplicar === true;
            const incluirNoEscaneados = req.body?.incluirNoEscaneados === true;
            const { porId, ruta } = await rutas(cliente, id);
            const lugar = porId.get(lugarId);

            if (!lugar) { fallo(res, 404, "Ese lugar no existe."); return; }

            await cliente.query("BEGIN");

            // Productos del lugar + los contados (aunque no estuvieran asignados): se bloquean para que el conteo no choque con una venta.
            const ids = [...new Set(conteos.map(c => Number(c.productoId)))];
            const productos = (await cliente.query(
                `SELECT p.id, p.nombre, p.codigo, p.stock,
                        (SELECT COALESCE(SUM(pu.cantidad), 0) FROM public.producto_ubicaciones pu JOIN public.ubicaciones ub ON ub.id = pu.ubicacion_id AND ub.zona = 'bodega' WHERE pu.producto_id = p.id) AS bodega_total,
                        (SELECT cantidad FROM public.producto_ubicaciones WHERE producto_id = p.id AND ubicacion_id = $2) AS cantidad_lugar
                 FROM public.productos p
                 WHERE p.negocio_id = $1 AND (p.id = ANY($3)
                    OR ($4::text = 'tienda' AND p.ubicacion_id = $2)
                    OR ($4::text = 'bodega' AND EXISTS (SELECT 1 FROM public.producto_ubicaciones x WHERE x.producto_id = p.id AND x.ubicacion_id = $2 AND x.cantidad > 0)))
                 ORDER BY p.nombre FOR UPDATE OF p`,
                [id, lugarId, ids, lugar.zona]
            )).rows;

            const resultado = compararConteo(lugar, productos, conteos, incluirNoEscaneados);

            if (!aplicar) {
                await cliente.query("ROLLBACK");
                res.json({ ok: true, aplicado: false, lugar: ruta(lugar), ...resultado });
                return;
            }

            const quienEs = await quien(cliente, id, req);
            const porProducto = new Map(productos.map(p => [p.id, p]));
            let ajustados = 0;

            for (const linea of resultado.lineas) {
                if (!linea.diferencia) continue;

                const p = porProducto.get(linea.productoId);
                const stockNuevo = Math.max(0, redondear(num(p.stock) + linea.diferencia));

                // Contar en bodega tambien corrige lo anotado de esa seccion; contar en la tienda solo mueve el total.
                if (lugar.zona === "bodega") {
                    await cliente.query(
                        `INSERT INTO public.producto_ubicaciones (negocio_id, producto_id, ubicacion_id, cantidad) VALUES ($1, $2, $3, $4)
                         ON CONFLICT (producto_id, ubicacion_id) DO UPDATE SET cantidad = EXCLUDED.cantidad, updated_at = NOW()`,
                        [id, p.id, lugarId, linea.contado]
                    );
                }

                await cliente.query(`UPDATE public.productos SET stock = $3 WHERE id = $1 AND negocio_id = $2`, [p.id, id, stockNuevo]);
                await cliente.query(
                    `INSERT INTO public.ajustes_inventario (negocio_id, producto_id, producto_nombre, codigo, tipo, cantidad, stock_anterior, stock_nuevo, motivo, referencia, usuario_nombre, fecha_ajuste)
                     VALUES ($1, $2, $3, $4, 'conteo', $5, $6, $7, $8, $9, $10, CURRENT_DATE)`,
                    [id, p.id, p.nombre, p.codigo || "", Math.abs(linea.diferencia), num(p.stock), stockNuevo, `Conteo de ${lugar.zona === "bodega" ? "bodega" : "estante"}`, ruta(lugar), quienEs.nombre]
                );
                ajustados++;
            }

            await bitacora(cliente, id, quienEs.empleadoId, "conteo_estante", { lugarId, lugar: ruta(lugar), ajustados, faltan: resultado.faltan, sobran: resultado.sobran });
            await cliente.query("COMMIT");

            res.json({ ok: true, aplicado: true, lugar: ruta(lugar), ajustados, ...resultado });
        } catch (error) {
            await cliente.query("ROLLBACK").catch(() => {});
            responderError(res, error);
        } finally {
            cliente.release();
        }
    });
}

module.exports = instalar;
module.exports.desglose = desglose;
module.exports.estadoResurtir = estadoResurtir;
module.exports.compararConteo = compararConteo;
