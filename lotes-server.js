// Lotes de caducidad y merma (perfil abarrotes).
//
// Cada ENTRADA de mercancia es un lote con su fecha de caducidad (tortilla de
// hoy, pan de ayer...). El stock real sigue siendo productos.stock; lo vigente
// de cada lote se calcula en lotes-calculo.js. Aqui van las rutas, la merma
// (lo que se tira, con su costo) y el aviso diario "revisa estos hoy".

const { responderError } = require("./error-utils");
const { PERMISOS, requerirPermiso } = require("./rbac");
const { enviarPushADuenoDelNegocio } = require("./push-server");
const { calcularLotesVigentes, estadoDeCaducidad, caducidadDeEntrada, aFecha } = require("./lotes-calculo");

const ZONA = "America/Mexico_City";
const HORA_AVISO = 8;
const INTERVALO_REVISION_MS = 60 * 60 * 1000;
const MOTIVOS_MERMA = ["caducado", "danado", "otro"];

function fechaLocal(ahora = new Date()) {
    // en-CA da AAAA-MM-DD
    return new Intl.DateTimeFormat("en-CA", { timeZone: ZONA, year: "numeric", month: "2-digit", day: "2-digit" }).format(ahora);
}

function horaLocal(ahora = new Date()) {
    return Number(new Intl.DateTimeFormat("en-GB", { timeZone: ZONA, hour: "2-digit", hour12: false }).format(ahora)) % 24;
}

function dinero(valor) {
    return Number((Number(valor) || 0).toFixed(2));
}

// Lo que se pierde si se tira: a costo (precio distribuidor) y a precio de venta.
function costoYPrecio(producto) {
    const costo = Number(producto.precio_distribuidor) || Number(producto.costo) || 0;
    const precio = Number(producto.precio_publico) || Number(producto.precio) || 0;
    return { costo, precio };
}

// Lotes vigentes de los productos que lo necesitan, con su estado de caducidad.
async function lotesPorRevisar(pool, negocioId, { dias = 7, hoy = fechaLocal() } = {}) {
    const productos = await pool.query(
        `SELECT id, nombre, codigo, stock, unidad_venta, fecha_caducidad, vida_util_dias,
                precio, precio_publico, precio_distribuidor, costo
         FROM public.productos
         WHERE negocio_id = $1 AND stock > 0
         AND (vida_util_dias IS NOT NULL OR fecha_caducidad IS NOT NULL
              OR EXISTS (SELECT 1 FROM public.producto_lotes l WHERE l.producto_id = productos.id))`,
        [negocioId]
    );

    if (!productos.rows.length) return [];

    const lotes = await pool.query(
        `SELECT id, producto_id, cantidad, fecha_entrada, fecha_caducidad, origen
         FROM public.producto_lotes
         WHERE negocio_id = $1 AND producto_id = ANY($2::int[])`,
        [negocioId, productos.rows.map(p => p.id)]
    );

    const lotesPorProducto = new Map();
    for (const lote of lotes.rows) {
        if (!lotesPorProducto.has(lote.producto_id)) lotesPorProducto.set(lote.producto_id, []);
        lotesPorProducto.get(lote.producto_id).push(lote);
    }

    const filas = [];

    for (const producto of productos.rows) {
        const vigentes = calcularLotesVigentes({
            stock: producto.stock,
            lotes: lotesPorProducto.get(producto.id) || [],
            fechaProducto: producto.fecha_caducidad
        });
        const { costo, precio } = costoYPrecio(producto);

        for (const lote of vigentes) {
            const { estado, dias: diasRestantes } = estadoDeCaducidad(lote.fechaCaducidad, hoy);
            if (estado === "sin_fecha" || estado === "ok") continue;
            if (estado !== "vencido" && diasRestantes > dias) continue;

            filas.push({
                productoId: producto.id,
                nombre: producto.nombre,
                codigo: producto.codigo || "",
                unidad: producto.unidad_venta || "pieza",
                loteId: lote.id,
                cantidad: lote.cantidad,
                fechaEntrada: lote.fechaEntrada,
                fechaCaducidad: lote.fechaCaducidad,
                estado,
                dias: diasRestantes,
                valorCosto: dinero(lote.cantidad * costo),
                valorVenta: dinero(lote.cantidad * precio)
            });
        }
    }

    return filas.sort((a, b) => a.dias - b.dias || a.nombre.localeCompare(b.nombre));
}

function resumirLotes(filas) {
    const resumen = { vencidos: 0, hoy: 0, manana: 0, proximos: 0, valorCosto: 0, valorVenta: 0 };

    for (const fila of filas) {
        if (fila.estado === "vencido") resumen.vencidos++;
        else if (fila.estado === "hoy") resumen.hoy++;
        else if (fila.estado === "manana") resumen.manana++;
        else resumen.proximos++;
        resumen.valorCosto += fila.valorCosto;
        resumen.valorVenta += fila.valorVenta;
    }

    resumen.valorCosto = dinero(resumen.valorCosto);
    resumen.valorVenta = dinero(resumen.valorVenta);
    return resumen;
}

// Alta de producto: guarda su vida util y, si ya hay existencias con caducidad, el primer lote.
async function registrarAltaConLote(pool, { negocioId, productoId, stock, vidaUtilDias, fechaCaducidad }) {
    const vida = Number(vidaUtilDias);
    const vidaValida = Number.isInteger(vida) && vida >= 1 && vida <= 3650 ? vida : null;

    if (vidaValida) {
        await pool.query(`UPDATE public.productos SET vida_util_dias = $1 WHERE id = $2 AND negocio_id = $3`, [vidaValida, productoId, negocioId]);
    }

    if (!(stock > 0)) return null;

    const caducidad = caducidadDeEntrada({ fechaCaducidad, vidaUtilDias: vidaValida, hoy: fechaLocal() });
    if (!caducidad) return null;

    const lote = await pool.query(
        `INSERT INTO public.producto_lotes (negocio_id, producto_id, cantidad, fecha_entrada, fecha_caducidad, origen)
         VALUES ($1, $2, $3, $4, $5, 'alta') RETURNING id`,
        [negocioId, productoId, stock, fechaLocal(), caducidad]
    );

    return lote.rows[0].id;
}

// Una vez al dia (despues de las 8 am, hora de Mexico): "tienes N cosas por revisar".
async function avisarCaducidades(pool, ahora = new Date()) {
    if (horaLocal(ahora) < HORA_AVISO) return 0;

    const hoy = fechaLocal(ahora);
    const negocios = await pool.query(`SELECT id FROM public.negocios WHERE giro = 'abarrotes'`);
    let avisados = 0;

    for (const negocio of negocios.rows) {
        try {
            const filas = await lotesPorRevisar(pool, negocio.id, { dias: 1, hoy });
            if (!filas.length) continue;

            const reservado = await pool.query(
                `INSERT INTO public.avisos_caducidad (negocio_id, fecha, cuantos) VALUES ($1, $2, $3)
                 ON CONFLICT (negocio_id, fecha) DO NOTHING RETURNING negocio_id`,
                [negocio.id, hoy, filas.length]
            );
            if (!reservado.rows.length) continue;

            const resumen = resumirLotes(filas);
            const partes = [];
            if (resumen.vencidos) partes.push(`${resumen.vencidos} ya vencido${resumen.vencidos === 1 ? "" : "s"}`);
            if (resumen.hoy) partes.push(`${resumen.hoy} vence${resumen.hoy === 1 ? "" : "n"} hoy`);
            if (resumen.manana) partes.push(`${resumen.manana} vence${resumen.manana === 1 ? "" : "n"} mañana`);

            await enviarPushADuenoDelNegocio(pool, negocio.id, {
                titulo: "Revisa tus productos",
                cuerpo: `${partes.join(", ")}. Si los rematas hoy recuperas hasta $${resumen.valorCosto.toFixed(2)}.`,
                url: "/dueno"
            });
            avisados++;
        } catch (error) {
            console.warn("[lotes] No se pudo avisar al negocio", negocio.id, error.message);
        }
    }

    return avisados;
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

    function cantidadValida(valor) {
        const cantidad = Number(valor);
        return Number.isFinite(cantidad) && cantidad > 0 && cantidad <= 1000000 ? Number(cantidad.toFixed(3)) : null;
    }

    function idValido(valor) {
        const id = Number(valor);
        return Number.isInteger(id) && id > 0 ? id : null;
    }

    app.get("/lotes/por-revisar", requerirAccesoNegocio, async (req, res) => {
        try {
            const dias = Math.min(Math.max(Number(req.query.dias) || 7, 1), 60);
            const filas = await lotesPorRevisar(pool, negocioId(req), { dias });
            res.json({ lotes: filas, resumen: resumirLotes(filas), hoy: fechaLocal() });
        } catch (error) {
            responderError(res, error);
        }
    });

    // Llego mercancia: suma al stock y abre un lote con su caducidad.
    app.post("/productos/:id/entrada", requerirAccesoNegocio, requerirPermiso(PERMISOS.MODIFICAR_INVENTARIO), async (req, res) => {
        const productoId = idValido(req.params.id);
        const cantidad = cantidadValida(req.body?.cantidad);

        if (!productoId || !cantidad) {
            res.status(400).json({ error: "Escribe cuanta mercancia llego" });
            return;
        }

        const fechaPedida = req.body?.fechaCaducidad ? aFecha(req.body.fechaCaducidad) : null;

        if (req.body?.fechaCaducidad && !fechaPedida) {
            res.status(400).json({ error: "La fecha de caducidad no es valida" });
            return;
        }

        const client = await pool.connect();

        try {
            const id = negocioId(req);
            await client.query("BEGIN");

            const producto = await client.query(
                `SELECT id, nombre, codigo, stock, vida_util_dias FROM public.productos
                 WHERE id = $1 AND negocio_id = $2 FOR UPDATE`,
                [productoId, id]
            );

            if (!producto.rows.length) {
                await client.query("ROLLBACK");
                res.status(404).json({ error: "Producto no encontrado" });
                return;
            }

            const fila = producto.rows[0];
            const hoy = fechaLocal();
            const caducidad = caducidadDeEntrada({ fechaCaducidad: fechaPedida, vidaUtilDias: fila.vida_util_dias, hoy });
            const anterior = Number(fila.stock) || 0;
            const nuevo = Number((anterior + cantidad).toFixed(3));

            await client.query(`UPDATE public.productos SET stock = $1 WHERE id = $2 AND negocio_id = $3`, [nuevo, productoId, id]);

            await client.query(
                `INSERT INTO public.ajustes_inventario
                    (negocio_id, producto_id, producto_nombre, codigo, tipo, cantidad, stock_anterior, stock_nuevo, motivo, referencia, usuario_nombre, fecha_ajuste)
                 VALUES ($1,$2,$3,$4,'entrada',$5,$6,$7,'Entrada de mercancia','',$8,$9)`,
                [id, productoId, fila.nombre, fila.codigo || "", cantidad, anterior, nuevo, String(req.body?.usuarioNombre || "").slice(0, 120), hoy]
            );

            let loteId = null;

            if (caducidad) {
                const lote = await client.query(
                    `INSERT INTO public.producto_lotes (negocio_id, producto_id, cantidad, fecha_entrada, fecha_caducidad, origen)
                     VALUES ($1, $2, $3, $4, $5, 'entrada') RETURNING id`,
                    [id, productoId, cantidad, hoy, caducidad]
                );
                loteId = lote.rows[0].id;
            }

            await client.query("COMMIT");
            res.json({ ok: true, stock: nuevo, loteId, fechaCaducidad: caducidad });
        } catch (error) {
            await client.query("ROLLBACK").catch(() => {});
            responderError(res, error);
        } finally {
            client.release();
        }
    });

    // Se tiro: baja el stock y deja anotado cuanto dinero fue.
    app.post("/productos/:id/merma", requerirAccesoNegocio, requerirPermiso(PERMISOS.MODIFICAR_INVENTARIO), async (req, res) => {
        const productoId = idValido(req.params.id);
        const cantidad = cantidadValida(req.body?.cantidad);
        const motivo = MOTIVOS_MERMA.includes(req.body?.motivo) ? req.body.motivo : "caducado";

        if (!productoId || !cantidad) {
            res.status(400).json({ error: "Escribe cuanto se tiro" });
            return;
        }

        const client = await pool.connect();

        try {
            const id = negocioId(req);
            await client.query("BEGIN");

            const producto = await client.query(
                `SELECT id, nombre, codigo, stock, precio, precio_publico, precio_distribuidor, costo
                 FROM public.productos WHERE id = $1 AND negocio_id = $2 FOR UPDATE`,
                [productoId, id]
            );

            if (!producto.rows.length) {
                await client.query("ROLLBACK");
                res.status(404).json({ error: "Producto no encontrado" });
                return;
            }

            const fila = producto.rows[0];
            const anterior = Number(fila.stock) || 0;

            if (cantidad > anterior + 0.0001) {
                await client.query("ROLLBACK");
                res.status(400).json({ error: `Solo tienes ${anterior} en inventario` });
                return;
            }

            const nuevo = Number(Math.max(0, anterior - cantidad).toFixed(3));
            const { costo, precio } = costoYPrecio(fila);
            const usuario = String(req.body?.usuarioNombre || "").slice(0, 120);

            await client.query(`UPDATE public.productos SET stock = $1 WHERE id = $2 AND negocio_id = $3`, [nuevo, productoId, id]);

            await client.query(
                `INSERT INTO public.ajustes_inventario
                    (negocio_id, producto_id, producto_nombre, codigo, tipo, cantidad, stock_anterior, stock_nuevo, motivo, referencia, usuario_nombre, fecha_ajuste)
                 VALUES ($1,$2,$3,$4,'salida',$5,$6,$7,$8,'',$9,$10)`,
                [id, productoId, fila.nombre, fila.codigo || "", cantidad, anterior, nuevo, `Merma: ${motivo}`, usuario, fechaLocal()]
            );

            const merma = await client.query(
                `INSERT INTO public.mermas_producto
                    (negocio_id, producto_id, producto_nombre, cantidad, motivo, costo_unitario, precio_unitario, usuario_nombre)
                 VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
                [id, productoId, fila.nombre, cantidad, motivo, costo, precio, usuario]
            );

            await client.query("COMMIT");
            res.json({ ok: true, stock: nuevo, mermaId: merma.rows[0].id, perdidoCosto: dinero(cantidad * costo), perdidoVenta: dinero(cantidad * precio) });
        } catch (error) {
            await client.query("ROLLBACK").catch(() => {});
            responderError(res, error);
        } finally {
            client.release();
        }
    });

    app.get("/lotes/mermas", requerirAccesoNegocio, async (req, res) => {
        try {
            const id = negocioId(req);
            const dias = Math.min(Math.max(Number(req.query.dias) || 30, 1), 365);

            const filas = await pool.query(
                `SELECT id, producto_id, producto_nombre, cantidad, motivo, costo_unitario, precio_unitario, usuario_nombre, created_at
                 FROM public.mermas_producto
                 WHERE negocio_id = $1 AND created_at >= NOW() - ($2 || ' days')::interval
                 ORDER BY created_at DESC LIMIT 200`,
                [id, String(dias)]
            );

            const mermas = filas.rows.map(m => ({
                id: m.id,
                productoId: m.producto_id,
                nombre: m.producto_nombre,
                cantidad: Number(m.cantidad),
                motivo: m.motivo,
                perdidoCosto: dinero(Number(m.cantidad) * Number(m.costo_unitario)),
                perdidoVenta: dinero(Number(m.cantidad) * Number(m.precio_unitario)),
                usuario: m.usuario_nombre,
                fecha: m.created_at
            }));

            res.json({
                dias,
                mermas,
                totalCosto: dinero(mermas.reduce((suma, m) => suma + m.perdidoCosto, 0)),
                totalVenta: dinero(mermas.reduce((suma, m) => suma + m.perdidoVenta, 0))
            });
        } catch (error) {
            responderError(res, error);
        }
    });

    async function revisarYCorrer() {
        try {
            await avisarCaducidades(pool);
        } catch (error) {
            console.log("[lotes] Error en el aviso diario:", error.message);
        }
    }

    setTimeout(revisarYCorrer, 30000);
    setInterval(revisarYCorrer, INTERVALO_REVISION_MS);
}

module.exports = instalar;
module.exports.lotesPorRevisar = lotesPorRevisar;
module.exports.resumirLotes = resumirLotes;
module.exports.registrarAltaConLote = registrarAltaConLote;
module.exports.avisarCaducidades = avisarCaducidades;
module.exports.fechaLocal = fechaLocal;
