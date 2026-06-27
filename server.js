const express = require("express");
const path = require("path");
const crypto = require("crypto");
const { config, validarConfigProduccion } = require("./config");
const pool = require("./db");
const {
    DEFAULT_NEGOCIO_SLUG,
    DEFAULT_NEGOCIO_NOMBRE,
    asegurarNegocioActual
} = require("./tenant");

validarConfigProduccion();

const app = express();

const PORT = config.port;

app.use(express.json());
app.use((req, res, next) => {
    res.set("Cache-Control", "no-store");
    next();
});
app.use(express.static(path.join(__dirname, "public")));

app.get("/health", async (req, res) => {
    try {
        await pool.query("SELECT 1");

        res.json({
            ok: true,
            app: config.appName,
            env: config.appEnv,
            version: config.appVersion,
            database: "connected",
            timestamp: new Date().toISOString(),
        });
    } catch (error) {
        res.status(503).json({
            ok: false,
            app: config.appName,
            env: config.appEnv,
            version: config.appVersion,
            database: "error",
            error: error.message,
            timestamp: new Date().toISOString(),
        });
    }
});

app.get("/version", (req, res) => {
    res.json({
        app: config.appName,
        env: config.appEnv,
        version: config.appVersion,
    });
});

app.get("/negocio-actual", async (req, res) => {
    try {
        const negocio = await negocioActual(req);

        res.json({
            ok: true,
            negocio
        });
    } catch (error) {
        res.status(500).json({
            ok: false,
            error: error.message
        });
    }
});

app.get("/licencia/estado", async (req, res) => {
    try {
        const negocio = await negocioActual(req);
        const licencia = await licenciaActual(negocio);

        res.json({
            ok: true,
            negocio: {
                id: negocio.id,
                slug: negocio.slug,
                nombre: negocio.nombre,
                estado: negocio.estado,
                plan: negocio.plan
            },
            licencia: {
                estado: licencia.estado,
                plan: licencia.plan,
                modo: licencia.modo,
                fechaInicio: licencia.fecha_inicio,
                fechaVencimiento: licencia.fecha_vencimiento,
                graciaDias: licencia.gracia_dias,
                ultimoPagoAt: licencia.ultimo_pago_at
            }
        });
    } catch (error) {
        res.status(500).json({
            ok: false,
            error: error.message
        });
    }
});

function validarAdminKey(req, res, next) {
    if (!config.adminKey) {
        return res.status(503).json({
            ok: false,
            error: "ADMIN_KEY no configurado en el servidor"
        });
    }

    const headerKey =
        req.get("x-admin-key") || "";

    if (headerKey !== config.adminKey) {
        return res.status(401).json({
            ok: false,
            error: "Clave de administrador invalida"
        });
    }

    next();
}

app.use("/admin/api", validarAdminKey);

app.get("/admin/api/resumen", async (_req, res) => {
    try {
        const negocios = await pool.query(`
            SELECT
                COUNT(*)::int AS total,
                COUNT(*) FILTER (WHERE estado = 'activo')::int AS activos,
                COUNT(*) FILTER (WHERE estado = 'prueba')::int AS prueba,
                COUNT(*) FILTER (WHERE estado IN ('suspendido', 'cancelado'))::int AS suspendidos
            FROM public.negocios
        `);

        const licencias = await pool.query(`
            SELECT
                COALESCE(SUM(monto_mensual) FILTER (WHERE estado = 'activa'), 0)::numeric AS mrr,
                COUNT(*) FILTER (WHERE estado = 'vencida')::int AS vencidas,
                COUNT(*) FILTER (WHERE estado = 'suspendida')::int AS suspendidas
            FROM public.licencias
        `);

        const dispositivos = await pool.query(`
            SELECT
                COUNT(*)::int AS total,
                COUNT(*) FILTER (WHERE ultimo_checkin_at > NOW() - INTERVAL '5 minutes')::int AS en_linea,
                COALESCE(SUM(sync_pendientes), 0)::int AS sync_pendientes,
                COALESCE(SUM(sync_errores), 0)::int AS sync_errores
            FROM public.dispositivos
        `);

        res.json({
            ok: true,
            negocios: negocios.rows[0],
            licencias: licencias.rows[0],
            dispositivos: dispositivos.rows[0]
        });
    } catch (error) {
        res.status(500).json({
            ok: false,
            error: error.message
        });
    }
});

app.get("/admin/api/negocios", async (_req, res) => {
    try {
        const resultado = await pool.query(`
            SELECT
                n.id,
                n.slug,
                n.nombre,
                n.giro,
                n.estado AS negocio_estado,
                n.plan AS negocio_plan,
                n.created_at,
                l.estado AS licencia_estado,
                l.plan AS licencia_plan,
                l.fecha_inicio,
                l.fecha_vencimiento,
                l.gracia_dias,
                l.ultimo_pago_at,
                l.monto_mensual,
                l.notas,
                COUNT(d.id)::int AS dispositivos,
                COUNT(d.id) FILTER (WHERE d.ultimo_checkin_at > NOW() - INTERVAL '5 minutes')::int AS dispositivos_en_linea,
                MAX(d.ultimo_checkin_at) AS ultimo_uso,
                COALESCE(SUM(d.sync_pendientes), 0)::int AS sync_pendientes,
                COALESCE(SUM(d.sync_errores), 0)::int AS sync_errores
            FROM public.negocios n
            LEFT JOIN public.licencias l ON l.negocio_id = n.id
            LEFT JOIN public.dispositivos d ON d.negocio_id = n.id
            GROUP BY n.id, l.id
            ORDER BY n.created_at DESC
        `);

        res.json({
            ok: true,
            negocios: resultado.rows.map(row => ({
                ...row,
                licencia_modo: calcularModoLicencia({
                    estado: row.licencia_estado,
                    fecha_vencimiento: row.fecha_vencimiento,
                    gracia_dias: row.gracia_dias
                })
            }))
        });
    } catch (error) {
        res.status(500).json({
            ok: false,
            error: error.message
        });
    }
});

app.get("/admin/api/negocios/:id/dispositivos", async (req, res) => {
    try {
        const negocioId = Number(req.params.id);
        const resultado = await pool.query(
            `
            SELECT
                device_id,
                nombre_equipo,
                plataforma,
                app_version,
                estado,
                sync_pendientes,
                sync_errores,
                sync_ultimo_error,
                local_stats,
                ultimo_checkin_at,
                CASE
                    WHEN ultimo_checkin_at > NOW() - INTERVAL '5 minutes' THEN true
                    ELSE false
                END AS en_linea
            FROM public.dispositivos
            WHERE negocio_id = $1
            ORDER BY ultimo_checkin_at DESC NULLS LAST
            `,
            [negocioId]
        );

        res.json({
            ok: true,
            dispositivos: resultado.rows
        });
    } catch (error) {
        res.status(500).json({
            ok: false,
            error: error.message
        });
    }
});

app.put("/admin/api/negocios/:id/licencia", async (req, res) => {
    const client = await pool.connect();

    try {
        const negocioId = Number(req.params.id);
        const {
            negocioEstado,
            plan,
            licenciaEstado,
            fechaVencimiento,
            graciaDias,
            ultimoPagoAt,
            montoMensual,
            notas
        } = req.body || {};

        await client.query("BEGIN");

        const negocioActualizado = await client.query(
            `
            UPDATE public.negocios
            SET estado = COALESCE($2, estado),
                plan = COALESCE($3, plan)
            WHERE id = $1
            RETURNING *
            `,
            [
                negocioId,
                negocioEstado || null,
                plan || null
            ]
        );

        if (negocioActualizado.rows.length === 0) {
            throw new Error("Negocio no encontrado");
        }

        const licencia = await client.query(
            `
            INSERT INTO public.licencias
                (negocio_id, estado, plan, fecha_vencimiento, gracia_dias, ultimo_pago_at, monto_mensual, notas, updated_at)
            VALUES
                ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
            ON CONFLICT (negocio_id)
            DO UPDATE SET
                estado = EXCLUDED.estado,
                plan = EXCLUDED.plan,
                fecha_vencimiento = EXCLUDED.fecha_vencimiento,
                gracia_dias = EXCLUDED.gracia_dias,
                ultimo_pago_at = EXCLUDED.ultimo_pago_at,
                monto_mensual = EXCLUDED.monto_mensual,
                notas = EXCLUDED.notas,
                updated_at = NOW()
            RETURNING *
            `,
            [
                negocioId,
                licenciaEstado || "activa",
                plan || negocioActualizado.rows[0].plan || "demo",
                fechaVencimiento || null,
                Number.isFinite(Number(graciaDias)) ? Number(graciaDias) : 15,
                ultimoPagoAt || null,
                Number.isFinite(Number(montoMensual)) ? Number(montoMensual) : 0,
                notas || null
            ]
        );

        await client.query("COMMIT");

        res.json({
            ok: true,
            negocio: negocioActualizado.rows[0],
            licencia: {
                ...licencia.rows[0],
                modo: calcularModoLicencia(licencia.rows[0])
            }
        });
    } catch (error) {
        await client.query("ROLLBACK");

        res.status(500).json({
            ok: false,
            error: error.message
        });
    } finally {
        client.release();
    }
});

app.post("/dispositivos/activar", async (req, res) => {
    try {
        const negocio = await negocioActual(req);
        const deviceId =
            obtenerDeviceId(req) || crypto.randomUUID();
        const nombreEquipo =
            req.body?.nombreEquipo || req.body?.hostname || "Equipo Windows";
        const plataforma =
            req.body?.plataforma || "windows";
        const appVersion =
            req.body?.appVersion || config.appVersion;

        const resultado =
        await pool.query(
            `
            INSERT INTO public.dispositivos
                (negocio_id, device_id, nombre_equipo, plataforma, app_version, ultimo_checkin_at)
            VALUES
                ($1, $2, $3, $4, $5, NOW())
            ON CONFLICT (negocio_id, device_id)
            DO UPDATE SET
                nombre_equipo = EXCLUDED.nombre_equipo,
                plataforma = EXCLUDED.plataforma,
                app_version = EXCLUDED.app_version,
                estado = 'activo',
                ultimo_checkin_at = NOW(),
                updated_at = NOW()
            RETURNING *
            `,
            [negocio.id, deviceId, nombreEquipo, plataforma, appVersion]
        );

        res.json({
            ok: true,
            negocio,
            dispositivo: resultado.rows[0],
            licencia: await licenciaActual(negocio)
        });
    } catch (error) {
        res.status(500).json({
            ok: false,
            error: error.message
        });
    }
});

app.post("/dispositivos/checkin", async (req, res) => {
    try {
        const negocio = await negocioActual(req);
        const deviceId = obtenerDeviceId(req);

        if (!deviceId) {
            return res.status(400).json({
                ok: false,
                error: "deviceId requerido"
            });
        }

        const resultado =
        await pool.query(
            `
            UPDATE public.dispositivos
            SET
                app_version = COALESCE($3, app_version),
                sync_pendientes = COALESCE($4, sync_pendientes),
                sync_errores = COALESCE($5, sync_errores),
                sync_ultimo_error = COALESCE($6, sync_ultimo_error),
                local_stats = COALESCE($7::jsonb, local_stats),
                ultimo_checkin_at = NOW(),
                updated_at = NOW()
            WHERE negocio_id = $1
            AND device_id = $2
            RETURNING *
            `,
            [
                negocio.id,
                deviceId,
                req.body?.appVersion || null,
                Number.isFinite(Number(req.body?.sync?.pendiente)) ? Number(req.body.sync.pendiente) : null,
                Number.isFinite(Number(req.body?.sync?.error)) ? Number(req.body.sync.error) : null,
                req.body?.sync?.ultimoError || null,
                req.body?.localStats ? JSON.stringify(req.body.localStats) : null
            ]
        );

        if (resultado.rows.length === 0) {
            return res.status(404).json({
                ok: false,
                error: "Dispositivo no registrado"
            });
        }

        res.json({
            ok: true,
            dispositivo: resultado.rows[0],
            licencia: await licenciaActual(negocio)
        });
    } catch (error) {
        res.status(500).json({
            ok: false,
            error: error.message
        });
    }
});

app.get("/dispositivos", async (req, res) => {
    try {
        const negocio = await negocioActual(req);
        const resultado = await pool.query(
            `
            SELECT
                device_id,
                nombre_equipo,
                plataforma,
                app_version,
                estado,
                sync_pendientes,
                sync_errores,
                sync_ultimo_error,
                local_stats,
                ultimo_checkin_at,
                created_at,
                updated_at,
                CASE
                    WHEN ultimo_checkin_at IS NULL THEN false
                    WHEN ultimo_checkin_at > NOW() - INTERVAL '5 minutes' THEN true
                    ELSE false
                END AS en_linea
            FROM public.dispositivos
            WHERE negocio_id = $1
            ORDER BY ultimo_checkin_at DESC NULLS LAST, created_at DESC
            `,
            [negocio.id]
        );

        res.json({
            ok: true,
            negocio,
            dispositivos: resultado.rows
        });
    } catch (error) {
        res.status(500).json({
            ok: false,
            error: error.message
        });
    }
});

app.post("/sync/push", async (req, res) => {
    try {
        const negocio = await negocioActual(req);
        const deviceId = obtenerDeviceId(req);
        const eventos = Array.isArray(req.body?.eventos)
            ? req.body.eventos
            : [];

        if (!deviceId) {
            return res.status(400).json({
                ok: false,
                error: "deviceId requerido"
            });
        }

        if (eventos.length === 0) {
            return res.json({
                ok: true,
                aceptados: [],
                duplicados: [],
                errores: []
            });
        }

        const aceptados = [];
        const duplicados = [];
        const errores = [];
        const aplicados = [];
        const idMappings = {
            producto: new Map(),
            cliente_credito: new Map()
        };

        for (const evento of eventos) {
            const eventId =
                String(evento.eventId || evento.event_id || "").trim();
            const tipo =
                String(evento.tipo || "").trim();

            if (!eventId || !tipo) {
                errores.push({
                    eventId,
                    error: "eventId y tipo son requeridos"
                });
                continue;
            }

            const client = await pool.connect();

            try {
                await client.query("BEGIN");

                const insertado =
                await client.query(
                    `
                    INSERT INTO public.sync_eventos
                        (negocio_id, device_id, event_id, tipo, entidad, entidad_id, payload)
                    VALUES
                        ($1, $2, $3, $4, $5, $6, $7::jsonb)
                    ON CONFLICT (negocio_id, event_id) DO NOTHING
                    RETURNING id
                    `,
                    [
                        negocio.id,
                        deviceId,
                        eventId,
                        tipo,
                        evento.entidad || null,
                        evento.entidadId || evento.entidad_id || null,
                        JSON.stringify(evento.payload || {})
                    ]
                );

                if (insertado.rows.length === 0) {
                    await client.query("COMMIT");
                    duplicados.push(eventId);
                    continue;
                }

                const payloadEvento =
                    evento.payload || {};

                if (
                    payloadEvento.productoId &&
                    idMappings.producto.has(String(payloadEvento.productoId))
                ) {
                    payloadEvento.productoId =
                        idMappings.producto.get(String(payloadEvento.productoId));
                }

                if (
                    payloadEvento.clienteId &&
                    idMappings.cliente_credito.has(String(payloadEvento.clienteId))
                ) {
                    payloadEvento.clienteId =
                        idMappings.cliente_credito.get(String(payloadEvento.clienteId));
                }

                const resultadoAplicacion =
                    await aplicarEventoSync(client, negocio, {
                        ...evento,
                        eventId,
                        tipo,
                        payload: payloadEvento
                    });

                await client.query(
                    `
                    UPDATE public.sync_eventos
                    SET estado = 'aplicado',
                        aplicado_at = NOW(),
                        error = NULL
                    WHERE id = $1
                    `,
                    [insertado.rows[0].id]
                );

                await client.query("COMMIT");

                aceptados.push(eventId);

                if (payloadEvento.localId && resultadoAplicacion?.productoId) {
                    idMappings.producto.set(
                        String(payloadEvento.localId),
                        resultadoAplicacion.productoId
                    );
                }

                if (payloadEvento.localId && resultadoAplicacion?.clienteId) {
                    idMappings.cliente_credito.set(
                        String(payloadEvento.localId),
                        resultadoAplicacion.clienteId
                    );
                }

                aplicados.push({
                    eventId,
                    localId: payloadEvento.localId || null,
                    ...resultadoAplicacion
                });
            } catch (error) {
                await client.query("ROLLBACK");

                await pool.query(
                    `
                    UPDATE public.sync_eventos
                    SET estado = 'error',
                        error = $3,
                        aplicado_at = NULL
                    WHERE negocio_id = $1
                    AND event_id = $2
                    `,
                    [negocio.id, eventId, error.message]
                );

                errores.push({
                    eventId,
                    error: error.message
                });
            } finally {
                client.release();
            }
        }

        await pool.query(
            `
            UPDATE public.dispositivos
            SET ultimo_checkin_at = NOW(), updated_at = NOW()
            WHERE negocio_id = $1
            AND device_id = $2
            `,
            [negocio.id, deviceId]
        );

        res.json({
            ok: true,
            aceptados,
            duplicados,
            aplicados,
            errores
        });
    } catch (error) {
        res.status(500).json({
            ok: false,
            error: error.message
        });
    }
});

app.get("/sync/pull", async (req, res) => {
    try {
        const negocio = await negocioActual(req);
        const deviceId = obtenerDeviceId(req);
        const fechaDesde =
            req.query.desde ? new Date(req.query.desde) : new Date(0);
        const desde =
            Number.isNaN(fechaDesde.getTime()) ? new Date(0) : fechaDesde;
        const limiteSolicitado =
            Number(req.query.limite || 100);
        const limite =
            Number.isFinite(limiteSolicitado)
                ? Math.min(Math.max(limiteSolicitado, 1), 500)
                : 100;

        const resultado =
        await pool.query(
            `
            SELECT
                event_id AS "eventId",
                tipo,
                entidad,
                entidad_id AS "entidadId",
                payload,
                estado,
                recibido_at AS "recibidoAt"
            FROM public.sync_eventos
            WHERE negocio_id = $1
            AND recibido_at > $2
            AND ($3::text = '' OR device_id <> $3)
            ORDER BY recibido_at ASC
            LIMIT $4
            `,
            [negocio.id, desde, deviceId || "", limite]
        );

        res.json({
            ok: true,
            eventos: resultado.rows
        });
    } catch (error) {
        res.status(500).json({
            ok: false,
            error: error.message
        });
    }
});

app.get("/updates/latest", async (req, res) => {
    try {
        const canal =
            String(req.query.canal || "stable");
        const plataforma =
            String(req.query.plataforma || "windows");

        const resultado =
        await pool.query(
            `
            SELECT *
            FROM public.app_versiones
            WHERE canal = $1
            AND plataforma = $2
            AND publicada = true
            ORDER BY created_at DESC, id DESC
            LIMIT 1
            `,
            [canal, plataforma]
        );

        const version =
            resultado.rows[0] || null;
        const updateAvailable =
            Boolean(version && version.version !== config.appVersion);

        res.json({
            ok: true,
            updateAvailable,
            currentServerVersion: config.appVersion,
            latest: version
        });
    } catch (error) {
        res.status(500).json({
            ok: false,
            error: error.message
        });
    }
});

function normalizarCodigo(codigo) {
    return String(codigo || "")
        .replace(/[^a-zA-Z0-9]/g, "")
        .trim();
}

async function negocioActual(req) {
    return asegurarNegocioActual(pool, req);
}

function obtenerDeviceId(req) {
    return String(
        req.headers["x-device-id"] ||
        req.body?.deviceId ||
        req.query.deviceId ||
        ""
    ).trim();
}

function calcularModoLicencia(licencia) {
    if (!licencia) return "bloqueado";
    if (licencia.estado === "suspendida" || licencia.estado === "cancelada") {
        return "bloqueado";
    }

    if (!licencia.fecha_vencimiento) {
        return licencia.estado === "vencida" ? "limitado" : "normal";
    }

    const vence =
        new Date(licencia.fecha_vencimiento).getTime();
    const ahora =
        Date.now();

    if (ahora <= vence) return "normal";

    const graciaMs =
        Number(licencia.gracia_dias || 0) * 24 * 60 * 60 * 1000;

    if (ahora <= vence + graciaMs) return "gracia";

    return "limitado";
}

async function licenciaActual(negocio) {
    const resultado =
    await pool.query(
        `
        INSERT INTO public.licencias
            (negocio_id, estado, plan, fecha_vencimiento, gracia_dias)
        VALUES
            ($1, 'activa', $2, NOW() + INTERVAL '30 days', 15)
        ON CONFLICT (negocio_id)
        DO UPDATE SET updated_at = NOW()
        RETURNING *
        `,
        [negocio.id, negocio.plan || "demo"]
    );

    const licencia =
        resultado.rows[0];

    return {
        ...licencia,
        modo: calcularModoLicencia(licencia)
    };
}

async function asegurarColumnasHistorialVentas(client = pool) {
    await client.query(`
        ALTER TABLE public.historial_ventas
        ADD COLUMN IF NOT EXISTS metodo_pago TEXT NOT NULL DEFAULT 'efectivo'
    `);
    await client.query(`
        ALTER TABLE public.historial_ventas
        ADD COLUMN IF NOT EXISTS pago_efectivo NUMERIC(12,2) NOT NULL DEFAULT 0
    `);
    await client.query(`
        ALTER TABLE public.historial_ventas
        ADD COLUMN IF NOT EXISTS pago_tarjeta NUMERIC(12,2) NOT NULL DEFAULT 0
    `);
    await client.query(`
        ALTER TABLE public.historial_ventas
        ADD COLUMN IF NOT EXISTS pago_transferencia NUMERIC(12,2) NOT NULL DEFAULT 0
    `);
    await client.query(`
        ALTER TABLE public.historial_ventas
        ADD COLUMN IF NOT EXISTS pago_credito NUMERIC(12,2) NOT NULL DEFAULT 0
    `);
    await client.query(`
        ALTER TABLE public.historial_ventas
        ADD COLUMN IF NOT EXISTS pago_recibido NUMERIC(12,2) NOT NULL DEFAULT 0
    `);
    await client.query(`
        ALTER TABLE public.historial_ventas
        ADD COLUMN IF NOT EXISTS cambio NUMERIC(12,2) NOT NULL DEFAULT 0
    `);
    await client.query(`
        ALTER TABLE public.historial_ventas
        ADD COLUMN IF NOT EXISTS pagos_json JSONB NOT NULL DEFAULT '{}'::jsonb
    `);
}

function productosEvento(payload) {
    return Array.isArray(payload?.productos)
        ? payload.productos
        : [];
}

function numeroSync(valor, fallback = 0) {
    const numero =
        Number(valor ?? fallback);

    return Number.isFinite(numero)
        ? numero
        : fallback;
}

function datosProductoSync(payload = {}) {
    return {
        nombre: String(payload.nombre || "").trim(),
        precio: numeroSync(payload.precio ?? payload.precioPublico, 0),
        stock: numeroSync(payload.stock, 0),
        codigo: normalizarCodigo(payload.codigo) || payload.codigo || "",
        proveedor: payload.proveedor || "",
        ubicacion: payload.ubicacion || "",
        categoria: payload.categoria || "",
        subcategoria: payload.subcategoria || "",
        marca: payload.marca || "",
        descripcion: payload.descripcion || "",
        unidadVenta: payload.unidadVenta || payload.unidad_venta || "pieza",
        precioDistribuidor: payload.precioDistribuidor ?? payload.precio_distribuidor ?? null,
        precioMayoreo: payload.precioMayoreo ?? payload.precio_mayoreo ?? null,
        precioPublico: payload.precioPublico ?? payload.precio_publico ?? payload.precio ?? null,
        stockMinimo: payload.stockMinimo ?? payload.stock_minimo ?? 3,
        altaRotacion: payload.altaRotacion ?? payload.alta_rotacion ?? "",
        tipoProducto: payload.tipoProducto ?? payload.tipo_producto ?? "catalogo",
        presentacionCompra: payload.presentacionCompra ?? payload.presentacion_compra ?? "",
        factorConversion: payload.factorConversion ?? payload.factor_conversion ?? null,
        basculaDigital: payload.basculaDigital ?? payload.bascula_digital ?? "no",
        codigosRelacionados: payload.codigosRelacionados || payload.codigos_relacionados || []
    };
}

async function descontarInventarioPorProductos(client, negocioId, productos = []) {
    for (const producto of productos) {
        const productoId =
            Number(producto.id || producto.productoId || 0);
        const cantidad =
            Number(producto.cantidad || 1);

        if (!productoId || !Number.isFinite(cantidad) || cantidad <= 0) {
            continue;
        }

        await client.query(
            `
            UPDATE public.productos
            SET stock = stock - $1
            WHERE id = $2
            AND negocio_id = $3
            `,
            [cantidad, productoId, negocioId]
        );
    }
}

async function guardarCodigosProductoClient(client, productoId, datos, negocioId) {
    const codigos =
        new Map();

    const agregarCodigo = (codigo, tipo = "barra", proveedor = "") => {
        const limpio =
            normalizarCodigo(codigo);

        if (!limpio) return;

        const llave =
            `${limpio}-${tipo}-${proveedor || ""}`.toLowerCase();

        codigos.set(llave, {
            codigo: limpio,
            tipo,
            proveedor: proveedor || ""
        });
    };

    agregarCodigo(datos.codigo, "barra", datos.proveedor);

    if (Array.isArray(datos.codigosRelacionados)) {
        for (const item of datos.codigosRelacionados) {
            if (typeof item === "string") {
                agregarCodigo(item, "alterno", datos.proveedor);
            } else {
                agregarCodigo(
                    item.codigo,
                    item.tipo || "alterno",
                    item.proveedor || datos.proveedor
                );
            }
        }
    } else if (typeof datos.codigosRelacionados === "string") {
        datos.codigosRelacionados
            .split(/[\n,; ]+/)
            .forEach(codigo =>
                agregarCodigo(codigo, "alterno", datos.proveedor)
            );
    }

    await client.query(
        `
        DELETE FROM public.producto_codigos
        WHERE producto_id = $1
        AND negocio_id = $2
        `,
        [productoId, negocioId]
    );

    for (const item of codigos.values()) {
        await client.query(
            `
            INSERT INTO public.producto_codigos
                (negocio_id, producto_id, codigo, tipo, proveedor)
            VALUES ($1, $2, $3, $4, $5)
            ON CONFLICT DO NOTHING
            `,
            [
                negocioId,
                productoId,
                item.codigo,
                item.tipo,
                item.proveedor
            ]
        );
    }
}

async function aplicarProductoSync(client, negocio, tipo, payload = {}) {
    const productoId =
        Number(payload.productoId || payload.id || 0);

    if (tipo === "producto_eliminado") {
        if (!productoId) {
            throw new Error("Producto offline sin productoId para eliminar");
        }

        await client.query(
            `
            DELETE FROM public.productos
            WHERE id = $1
            AND negocio_id = $2
            `,
            [productoId, negocio.id]
        );

        return {
            accion: "producto_eliminado",
            productoId
        };
    }

    const datos =
        datosProductoSync(payload);

    if (!datos.nombre) {
        throw new Error("Producto offline sin nombre");
    }

    if (tipo === "producto_actualizado" && productoId) {
        const resultado = await client.query(
            `
            UPDATE public.productos
            SET
                nombre = $1,
                precio = $2,
                stock = $3,
                codigo = $4,
                proveedor = $5,
                ubicacion = $6,
                categoria = $7,
                subcategoria = $8,
                marca = $9,
                descripcion = $10,
                unidad_venta = $11,
                precio_distribuidor = $12,
                precio_mayoreo = $13,
                precio_publico = $14,
                stock_minimo = $15,
                alta_rotacion = $16,
                tipo_producto = $17,
                presentacion_compra = $18,
                factor_conversion = $19,
                bascula_digital = $20
            WHERE id = $21
            AND negocio_id = $22
            RETURNING id
            `,
            [
                datos.nombre,
                datos.precio,
                datos.stock,
                datos.codigo,
                datos.proveedor,
                datos.ubicacion,
                datos.categoria,
                datos.subcategoria,
                datos.marca,
                datos.descripcion,
                datos.unidadVenta,
                datos.precioDistribuidor,
                datos.precioMayoreo,
                datos.precioPublico,
                datos.stockMinimo,
                datos.altaRotacion,
                datos.tipoProducto,
                datos.presentacionCompra,
                datos.factorConversion,
                datos.basculaDigital,
                productoId,
                negocio.id
            ]
        );

        if (resultado.rows.length === 0) {
            throw new Error("Producto no encontrado para actualizar");
        }

        await guardarCodigosProductoClient(client, productoId, datos, negocio.id);

        return {
            accion: "producto_actualizado",
            productoId
        };
    }

    const resultado = await client.query(
        `
        INSERT INTO public.productos
        (
            negocio_id,
            nombre,
            precio,
            stock,
            codigo,
            proveedor,
            ubicacion,
            categoria,
            subcategoria,
            marca,
            descripcion,
            unidad_venta,
            precio_distribuidor,
            precio_mayoreo,
            precio_publico,
            stock_minimo,
            alta_rotacion,
            tipo_producto,
            presentacion_compra,
            factor_conversion,
            bascula_digital
        )
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)
        RETURNING id
        `,
        [
            negocio.id,
            datos.nombre,
            datos.precio,
            datos.stock,
            datos.codigo,
            datos.proveedor,
            datos.ubicacion,
            datos.categoria,
            datos.subcategoria,
            datos.marca,
            datos.descripcion,
            datos.unidadVenta,
            datos.precioDistribuidor,
            datos.precioMayoreo,
            datos.precioPublico,
            datos.stockMinimo,
            datos.altaRotacion,
            datos.tipoProducto,
            datos.presentacionCompra,
            datos.factorConversion,
            datos.basculaDigital
        ]
    );

    const creadoId =
        resultado.rows[0]?.id || null;

    await guardarCodigosProductoClient(client, creadoId, datos, negocio.id);

    return {
        accion: "producto_creado",
        productoId: creadoId
    };
}

async function aplicarClienteCreditoSync(client, negocio, tipo, payload = {}) {
    const clienteId =
        Number(payload.clienteId || payload.id || 0);

    if (tipo === "cliente_credito_eliminado") {
        if (!clienteId) {
            throw new Error("Cliente offline sin clienteId para baja");
        }

        await client.query(
            `
            UPDATE public.clientes_credito
            SET activo = false
            WHERE id = $1
            AND negocio_id = $2
            `,
            [clienteId, negocio.id]
        );

        return {
            accion: "cliente_credito_eliminado",
            clienteId
        };
    }

    const nombre =
        String(payload.nombre || "").trim();

    if (!nombre) {
        throw new Error("Cliente offline sin nombre");
    }

    if (tipo === "cliente_credito_actualizado" && clienteId) {
        const resultado = await client.query(
            `
            UPDATE public.clientes_credito
            SET nombre = $1,
                telefono = $2,
                limite_credito = $3
            WHERE id = $4
            AND negocio_id = $5
            RETURNING id
            `,
            [
                nombre,
                payload.telefono || "",
                numeroSync(payload.limiteCredito ?? payload.limite_credito, 0),
                clienteId,
                negocio.id
            ]
        );

        if (resultado.rows.length === 0) {
            throw new Error("Cliente no encontrado para actualizar");
        }

        return {
            accion: "cliente_credito_actualizado",
            clienteId
        };
    }

    const resultado = await client.query(
        `
        INSERT INTO public.clientes_credito
            (negocio_id, nombre, telefono, limite_credito)
        VALUES ($1, $2, $3, $4)
        RETURNING id
        `,
        [
            negocio.id,
            nombre,
            payload.telefono || null,
            numeroSync(payload.limiteCredito ?? payload.limite_credito, 0)
        ]
    );

    return {
        accion: "cliente_credito_creado",
        clienteId: resultado.rows[0]?.id || null
    };
}

async function aplicarVentaSync(client, negocio, payload) {
    if (payload?.ventaId || payload?.historialId) {
        return {
            accion: "venta_ya_confirmada",
            ventaId: payload.ventaId || null,
            historialId: payload.historialId || null
        };
    }

    const total =
        Number(payload?.total || 0);

    if (!Number.isFinite(total) || total <= 0) {
        throw new Error("Venta offline sin total valido");
    }

    await asegurarColumnasHistorialVentas(client);

    const pagosVenta =
        payload?.pagos || {};
    const metodoPago =
        payload?.metodoPago || "efectivo";
    const recibido =
        Number(payload?.recibido || pagosVenta.efectivo || total);
    const cambio =
        Number(payload?.cambio || 0);

    const ventaCreada = await client.query(
        `
        INSERT INTO public.ventas(negocio_id, total)
        VALUES($1, $2)
        RETURNING id, fecha
        `,
        [negocio.id, total]
    );

    const historialCreado = await client.query(
        `
        INSERT INTO public.historial_ventas
            (negocio_id, total, metodo_pago, pago_efectivo, pago_tarjeta, pago_transferencia, pago_credito, pago_recibido, cambio, pagos_json)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb)
        RETURNING id, fecha
        `,
        [
            negocio.id,
            total,
            metodoPago,
            Number(pagosVenta.efectivo || (metodoPago === "efectivo" ? recibido : 0)),
            Number(pagosVenta.tarjeta || 0),
            Number(pagosVenta.transferencia || 0),
            Number(pagosVenta.credito || 0),
            recibido,
            cambio,
            JSON.stringify(pagosVenta)
        ]
    );

    await descontarInventarioPorProductos(
        client,
        negocio.id,
        productosEvento(payload)
    );

    return {
        accion: "venta_aplicada",
        ventaId: ventaCreada.rows[0]?.id || null,
        historialId: historialCreado.rows[0]?.id || null,
        fecha: historialCreado.rows[0]?.fecha || ventaCreada.rows[0]?.fecha || null
    };
}

async function aplicarCreditoCargoSync(client, negocio, payload) {
    if (payload?.movimientoId) {
        return {
            accion: "credito_ya_confirmado",
            movimientoId: payload.movimientoId
        };
    }

    const clienteId =
        Number(payload?.clienteId || 0);
    const total =
        Number(payload?.total || payload?.monto || 0);

    if (!clienteId) {
        throw new Error("Credito offline sin clienteId");
    }

    if (!Number.isFinite(total) || total <= 0) {
        throw new Error("Credito offline sin total valido");
    }

    const resultado = await client.query(
        `
        INSERT INTO public.movimientos_credito
        (
            negocio_id,
            cliente_id,
            tipo,
            referencia,
            concepto,
            monto,
            productos
        )
        SELECT $1, c.id, 'venta', $2, $3, $4, $5::jsonb
        FROM public.clientes_credito c
        WHERE c.id = $6
        AND c.negocio_id = $1
        RETURNING *
        `,
        [
            negocio.id,
            payload?.referencia || `CR-SYNC-${Date.now()}`,
            payload?.concepto || "Venta a credito",
            total,
            JSON.stringify(productosEvento(payload)),
            clienteId
        ]
    );

    if (resultado.rows.length === 0) {
        throw new Error("Cliente de credito no encontrado para este negocio");
    }

    await descontarInventarioPorProductos(
        client,
        negocio.id,
        productosEvento(payload)
    );

    return {
        accion: "credito_aplicado",
        movimientoId: resultado.rows[0]?.id || null,
        referencia: resultado.rows[0]?.referencia || null,
        fecha: resultado.rows[0]?.fecha || null
    };
}

async function aplicarEventoSync(client, negocio, evento) {
    const tipo =
        String(evento.tipo || "").trim();
    const payload =
        evento.payload || {};

    if (tipo === "venta_creada") {
        return aplicarVentaSync(client, negocio, payload);
    }

    if (tipo === "credito_cargo_creado") {
        return aplicarCreditoCargoSync(client, negocio, payload);
    }

    if (
        tipo === "producto_creado" ||
        tipo === "producto_actualizado" ||
        tipo === "producto_eliminado"
    ) {
        return aplicarProductoSync(client, negocio, tipo, payload);
    }

    if (
        tipo === "cliente_credito_creado" ||
        tipo === "cliente_credito_actualizado" ||
        tipo === "cliente_credito_eliminado"
    ) {
        return aplicarClienteCreditoSync(client, negocio, tipo, payload);
    }

    return {
        accion: "evento_guardado_sin_aplicar"
    };
}

app.get("/", (req, res) => {
    res.sendFile(
        path.join(__dirname, "public", "index.html")
    );
});

app.get("/dueno", (req, res) => {
    res.sendFile(
        path.join(__dirname, "public", "dueno.html")
    );
});

app.get("/productos", async (req, res) => {
    try {
        const negocio = await negocioActual(req);
        const resultado =
        await pool.query(
            `
            SELECT
                p.*,
                COALESCE(
                    json_agg(
                        json_build_object(
                            'codigo', pc.codigo,
                            'tipo', pc.tipo,
                            'proveedor', pc.proveedor
                        )
                    ) FILTER (WHERE pc.id IS NOT NULL),
                    '[]'::json
                ) AS codigos_relacionados
            FROM public.productos p
            LEFT JOIN public.producto_codigos pc
                ON pc.producto_id = p.id
                AND pc.negocio_id = p.negocio_id
            WHERE p.negocio_id = $1
            GROUP BY p.id
            ORDER BY p.nombre ASC
            `,
            [negocio.id]
        );

        res.json(resultado.rows);

    } catch (error) {
        console.log(error);

        res.status(500).json({
            error: error.message,
            detail: error.detail || null,
            code: error.code || null
        });
    }
});

app.get("/producto-codigo/:codigo", async (req, res) => {

    const codigo = normalizarCodigo(req.params.codigo);

    try {
        const negocio = await negocioActual(req);

        const resultado =
        await pool.query(
            `
            SELECT DISTINCT ON (p.id)
                p.*
            FROM public.productos p
            LEFT JOIN public.producto_codigos pc
                ON pc.producto_id = p.id
                AND pc.negocio_id = p.negocio_id
            WHERE
                p.negocio_id = $2
                AND (
                    LOWER(regexp_replace(COALESCE(p.codigo, ''), '[^a-zA-Z0-9]', '', 'g')) = LOWER($1)
                    OR LOWER(regexp_replace(COALESCE(pc.codigo, ''), '[^a-zA-Z0-9]', '', 'g')) = LOWER($1)
                )
            ORDER BY p.id
            LIMIT 1
            `,
            [codigo, negocio.id]
        );

        res.json(
            resultado.rows[0] || null
        );

    } catch (error) {

        console.log(error);

        res.status(500).json({
            error: "Error código"
        });
    }
});

app.post("/agregar-producto", async (req, res) => {

   const {
    nombre,
    precio,
    stock,
    codigo,
    proveedor,
    ubicacion,
    categoria,
    subcategoria,
    marca,
    descripcion,
    unidadVenta,
    precioDistribuidor,
    precioMayoreo,
    precioPublico,
    stockMinimo,
    altaRotacion,
    tipoProducto,
    presentacionCompra,
    factorConversion,
    basculaDigital,
    codigosRelacionados
} = req.body;
    try {
        const negocio = await negocioActual(req);

        const resultado = await pool.query(
`
INSERT INTO public.productos
(
  negocio_id,
  nombre,
  precio,
  stock,
  codigo,
  proveedor,
  ubicacion,
  categoria,
  subcategoria,
  marca,
  descripcion,
  unidad_venta,
  precio_distribuidor,
  precio_mayoreo,
  precio_publico,
  stock_minimo,
  alta_rotacion,
  tipo_producto,
  presentacion_compra,
  factor_conversion,
  bascula_digital
)
VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)
RETURNING id
`,
[
  negocio.id,
  nombre,
  precio,
  stock,
  normalizarCodigo(codigo) || codigo || "",
  proveedor || "",
  ubicacion || "",
  categoria || "",
  subcategoria || "",
  marca || "",
  descripcion || "",
  unidadVenta || "pieza",
  precioDistribuidor || null,
  precioMayoreo || null,
  precioPublico || precio || null,
  stockMinimo || 3,
  altaRotacion || "",
  tipoProducto || "catalogo",
  presentacionCompra || "",
  factorConversion || null,
  basculaDigital || "no"
]
);

        const productoId = resultado.rows[0].id;
        await guardarCodigosProducto(productoId, {
            codigo,
            proveedor,
            codigosRelacionados
        }, negocio.id);

        res.json({
            success: true,
            productoId,
            producto: {
                id: productoId,
                negocio_id: negocio.id,
                nombre,
                precio,
                stock,
                codigo: normalizarCodigo(codigo) || codigo || "",
                proveedor: proveedor || "",
                ubicacion: ubicacion || "",
                categoria: categoria || "",
                subcategoria: subcategoria || "",
                marca: marca || "",
                descripcion: descripcion || "",
                unidad_venta: unidadVenta || "pieza",
                precio_distribuidor: precioDistribuidor || null,
                precio_mayoreo: precioMayoreo || null,
                precio_publico: precioPublico || precio || null,
                stock_minimo: stockMinimo || 3,
                alta_rotacion: altaRotacion || "",
                tipo_producto: tipoProducto || "catalogo",
                presentacion_compra: presentacionCompra || "",
                factor_conversion: factorConversion || null,
                bascula_digital: basculaDigital || "no",
                codigos_relacionados: codigosRelacionados || []
            }
        });

    } catch (error) {

        console.log(error);

        res.status(500).json({
            error: "Error agregar"
        });
    }
});

app.put("/editar-producto/:id", async (req, res) => {

    const { id } = req.params;

    const {
        nombre,
        precio,
        stock,
        codigo,
        proveedor,
        ubicacion,
        categoria,
        subcategoria,
        marca,
        descripcion,
        unidadVenta,
        precioDistribuidor,
        precioMayoreo,
        precioPublico,
        stockMinimo,
        altaRotacion,
        tipoProducto,
        presentacionCompra,
        factorConversion,
        basculaDigital,
        codigosRelacionados
    } = req.body;

    try {
        const negocio = await negocioActual(req);

        const resultado = await pool.query(
            `
            UPDATE public.productos
            SET
                nombre = $1,
                precio = $2,
                stock = $3,
                codigo = $4,
                proveedor = $5,
                ubicacion = $6,
                categoria = $7,
                subcategoria = $8,
                marca = $9,
                descripcion = $10,
                unidad_venta = $11,
                precio_distribuidor = $12,
                precio_mayoreo = $13,
                precio_publico = $14,
                stock_minimo = $15,
                alta_rotacion = $16,
                tipo_producto = $17,
                presentacion_compra = $18,
                factor_conversion = $19,
                bascula_digital = $20
            WHERE id = $21
            AND negocio_id = $22
            RETURNING id
            `,
            [
                nombre,
                precio,
                stock,
                normalizarCodigo(codigo) || codigo || "",
                proveedor || "",
                ubicacion || "",
                categoria || "",
                subcategoria || "",
                marca || "",
                descripcion || "",
                unidadVenta || "pieza",
                precioDistribuidor || null,
                precioMayoreo || null,
                precioPublico || precio || null,
                stockMinimo || 3,
                altaRotacion || "",
                tipoProducto || "catalogo",
                presentacionCompra || "",
                factorConversion || null,
                basculaDigital || "no",
                id,
                negocio.id
            ]
        );

        if (resultado.rows.length === 0) {
            res.status(404).json({
                error: "Producto no encontrado"
            });
            return;
        }

        await guardarCodigosProducto(id, {
            codigo,
            proveedor,
            codigosRelacionados
        }, negocio.id);

        res.json({
            success: true,
            productoId: Number(id),
            producto: {
                id: Number(id),
                negocio_id: negocio.id,
                nombre,
                precio,
                stock,
                codigo: normalizarCodigo(codigo) || codigo || "",
                proveedor: proveedor || "",
                ubicacion: ubicacion || "",
                categoria: categoria || "",
                subcategoria: subcategoria || "",
                marca: marca || "",
                descripcion: descripcion || "",
                unidad_venta: unidadVenta || "pieza",
                precio_distribuidor: precioDistribuidor || null,
                precio_mayoreo: precioMayoreo || null,
                precio_publico: precioPublico || precio || null,
                stock_minimo: stockMinimo || 3,
                alta_rotacion: altaRotacion || "",
                tipo_producto: tipoProducto || "catalogo",
                presentacion_compra: presentacionCompra || "",
                factor_conversion: factorConversion || null,
                bascula_digital: basculaDigital || "no",
                codigos_relacionados: codigosRelacionados || []
            }
        });

    } catch (error) {

        res.status(500).json({
            error: "Error editar"
        });
    }
});

app.delete("/eliminar-producto/:id", async (req, res) => {

    const { id } = req.params;

    try {
        const negocio = await negocioActual(req);

        await pool.query(
            `
            DELETE FROM public.productos
            WHERE id = $1
            AND negocio_id = $2
            `,
            [id, negocio.id]
        );

        res.json({
            success: true
        });

    } catch (error) {

        res.status(500).json({
            error: "Error eliminar"
        });
    }
});

async function guardarCodigosProducto(productoId, datos, negocioId) {
    const codigos =
        new Map();

    const agregarCodigo = (codigo, tipo = "barra", proveedor = "") => {
        const limpio =
            normalizarCodigo(codigo);

        if (!limpio) return;

        const llave =
            `${limpio}-${tipo}-${proveedor || ""}`.toLowerCase();

        codigos.set(llave, {
            codigo: limpio,
            tipo,
            proveedor: proveedor || ""
        });
    };

    agregarCodigo(datos.codigo, "barra", datos.proveedor);

    if (Array.isArray(datos.codigosRelacionados)) {
        for (const item of datos.codigosRelacionados) {
            if (typeof item === "string") {
                agregarCodigo(item, "alterno", datos.proveedor);
            } else {
                agregarCodigo(
                    item.codigo,
                    item.tipo || "alterno",
                    item.proveedor || datos.proveedor
                );
            }
        }
    } else if (typeof datos.codigosRelacionados === "string") {
        datos.codigosRelacionados
            .split(/[\n,; ]+/)
            .forEach(codigo =>
                agregarCodigo(codigo, "alterno", datos.proveedor)
            );
    }

    await pool.query(
        `
        DELETE FROM public.producto_codigos
        WHERE producto_id = $1
        AND negocio_id = $2
        `,
        [productoId, negocioId]
    );

    for (const item of codigos.values()) {
        await pool.query(
            `
            INSERT INTO public.producto_codigos
            (
                negocio_id,
                producto_id,
                codigo,
                tipo,
                proveedor
            )
            VALUES ($1, $2, $3, $4, $5)
            ON CONFLICT DO NOTHING
            `,
            [
                negocioId,
                productoId,
                item.codigo,
                item.tipo,
                item.proveedor
            ]
        );
    }
}

app.post("/login", async (req, res) => {

    const {
        usuario,
        password
    } = req.body;

    try {
        const negocio = await negocioActual(req);

        const resultado =
        await pool.query(
            `
            SELECT *
            FROM public.usuarios
            WHERE usuario = $1
            AND password = $2
            AND negocio_id = $3
            `,
            [usuario, password, negocio.id]
        );

        res.json({
            success:
            resultado.rows.length > 0
        });

    } catch (error) {

        res.status(500).json({
            error: "Error login"
        });
    }
});

app.post("/ventas", async (req, res) => {

    const {
        total,
        productos,
        metodoPago,
        pagos,
        recibido,
        cambio
    } = req.body;
    const pagosVenta = pagos || {};
    const pagoEfectivo = Number(pagosVenta.efectivo || 0);
    const pagoTarjeta = Number(pagosVenta.tarjeta || 0);
    const pagoTransferencia = Number(pagosVenta.transferencia || 0);
    const pagoCredito = Number(pagosVenta.credito || 0);

    try {
        const negocio = await negocioActual(req);

        await asegurarColumnasHistorialVentas();
        const ventaCreada = await pool.query(
            `
            INSERT INTO public.ventas(negocio_id, total)
            VALUES($1, $2)
            RETURNING id, fecha
            `,
            [negocio.id, total]
        );

        const historialCreado = await pool.query(
            `
            INSERT INTO public.historial_ventas
                (negocio_id, total, metodo_pago, pago_efectivo, pago_tarjeta, pago_transferencia, pago_credito, pago_recibido, cambio, pagos_json)
            VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb)
            RETURNING id, fecha
            `,
            [negocio.id, total, metodoPago || "efectivo", pagoEfectivo, pagoTarjeta, pagoTransferencia, pagoCredito, Number(recibido || 0), Number(cambio || 0), JSON.stringify(pagosVenta)]
        );

        for (const producto of productos) {
            const cantidad =
                Number(producto.cantidad || 1);

            await pool.query(
                `
                UPDATE public.productos
                SET stock = stock - $1
                WHERE id = $2
                AND negocio_id = $3
                `,
                [cantidad, producto.id, negocio.id]
            );
        }

        res.json({
            success: true,
            ventaId: ventaCreada.rows[0]?.id || null,
            historialId: historialCreado.rows[0]?.id || null,
            fecha: historialCreado.rows[0]?.fecha || ventaCreada.rows[0]?.fecha || null
        });

    } catch (error) {

        console.log("ERROR EN /ventas:", error);

        res.status(500).json({
            error: error.message,
            detail: error.detail || null,
            code: error.code || null
        });
    }
});

app.get("/creditos", async (req, res) => {
    try {
        const negocio = await negocioActual(req);
        const clientes = await pool.query(`
            SELECT
                c.id,
                c.nombre,
                c.telefono,
                c.limite_credito,
                c.created_at,
                COALESCE(
                    SUM(
                        CASE
                            WHEN m.tipo = 'venta' THEN m.monto
                            WHEN m.tipo = 'abono' THEN -m.monto
                            ELSE 0
                        END
                    ),
                    0
                ) AS saldo
            FROM public.clientes_credito c
            LEFT JOIN public.movimientos_credito m
                ON m.cliente_id = c.id
                AND m.negocio_id = c.negocio_id
            WHERE c.activo = true
            AND c.negocio_id = $1
            GROUP BY c.id
            ORDER BY saldo DESC, c.nombre ASC
        `, [negocio.id]);

        const total = clientes.rows.reduce(
            (suma, cliente) =>
                suma + Number(cliente.saldo),
            0
        );

        res.json({
            clientes: clientes.rows,
            total,
            clientesConAdeudo:
                clientes.rows.filter(
                    cliente => Number(cliente.saldo) > 0
                ).length
        });
    } catch (error) {
        console.log("ERROR EN /creditos:", error);

        res.status(500).json({
            error: error.message,
            detail: error.detail || null,
            code: error.code || null
        });
    }
});

app.get("/creditos/clientes/:id", async (req, res) => {
    const { id } = req.params;

    try {
        const negocio = await negocioActual(req);
        const cliente = await pool.query(`
            SELECT
                c.*,
                COALESCE(
                    SUM(
                        CASE
                            WHEN m.tipo = 'venta' THEN m.monto
                            WHEN m.tipo = 'abono' THEN -m.monto
                            ELSE 0
                        END
                    ),
                    0
                ) AS saldo
            FROM public.clientes_credito c
            LEFT JOIN public.movimientos_credito m
                ON m.cliente_id = c.id
                AND m.negocio_id = c.negocio_id
            WHERE c.id = $1
            AND c.negocio_id = $2
            GROUP BY c.id
        `, [id, negocio.id]);

        if (cliente.rows.length === 0) {
            res.status(404).json({
                error: "Cliente no encontrado"
            });
            return;
        }

        const movimientos = await pool.query(`
            SELECT *
            FROM public.movimientos_credito
            WHERE cliente_id = $1
            AND negocio_id = $2
            ORDER BY fecha ASC, id ASC
        `, [id, negocio.id]);

        res.json({
            cliente: cliente.rows[0],
            movimientos: movimientos.rows
        });
    } catch (error) {
        res.status(500).json({
            error: error.message
        });
    }
});

app.post("/creditos/clientes", async (req, res) => {
    const {
        nombre,
        telefono,
        limiteCredito
    } = req.body;

    if (!nombre) {
        res.status(400).json({
            error: "Nombre requerido"
        });
        return;
    }

    try {
        const negocio = await negocioActual(req);
        const resultado = await pool.query(`
            INSERT INTO public.clientes_credito
            (
                negocio_id,
                nombre,
                telefono,
                limite_credito
            )
            VALUES ($1, $2, $3, $4)
            RETURNING *
        `, [
            negocio.id,
            nombre,
            telefono || null,
            limiteCredito || 0
        ]);

        res.json({
            success: true,
            cliente: resultado.rows[0]
        });
    } catch (error) {
        res.status(500).json({
            error: error.message
        });
    }
});

app.put("/creditos/clientes/:id", async (req, res) => {
    const { id } = req.params;

    const {
        nombre,
        telefono,
        limiteCredito
    } = req.body;

    if (!nombre) {
        res.status(400).json({
            error: "El nombre es obligatorio"
        });
        return;
    }

    try {
        const negocio = await negocioActual(req);
        const resultado = await pool.query(`
            UPDATE public.clientes_credito
            SET
                nombre = $1,
                telefono = $2,
                limite_credito = $3
            WHERE id = $4
            AND negocio_id = $5
            RETURNING *
        `, [
            nombre,
            telefono || "",
            Number(limiteCredito || 0),
            id,
            negocio.id
        ]);

        if (resultado.rows.length === 0) {
            res.status(404).json({
                error: "Cliente no encontrado"
            });
            return;
        }

        res.json({
            cliente: resultado.rows[0]
        });
    } catch (error) {
        res.status(500).json({
            error: error.message
        });
    }
});

app.delete("/creditos/clientes/:id", async (req, res) => {
    const { id } = req.params;

    try {
        const negocio = await negocioActual(req);
        const resultado = await pool.query(`
            UPDATE public.clientes_credito
            SET activo = false
            WHERE id = $1
            AND negocio_id = $2
            RETURNING id
        `, [id, negocio.id]);

        if (resultado.rows.length === 0) {
            res.status(404).json({
                error: "Cliente no encontrado"
            });
            return;
        }

        res.json({
            success: true
        });
    } catch (error) {
        res.status(500).json({
            error: error.message
        });
    }
});

app.get("/proveedores", async (req, res) => {
    try {
        const negocio = await negocioActual(req);
        const resultado = await pool.query(`
            SELECT
                pr.*,
                COUNT(p.id) AS productos
            FROM public.proveedores pr
            LEFT JOIN public.productos p
                ON LOWER(COALESCE(p.proveedor, '')) = LOWER(pr.nombre)
                AND p.negocio_id = pr.negocio_id
            WHERE pr.activo = true
            AND pr.negocio_id = $1
            GROUP BY pr.id
            ORDER BY pr.nombre ASC
        `, [negocio.id]);

        res.json({
            proveedores: resultado.rows
        });
    } catch (error) {
        res.status(500).json({
            error: error.message
        });
    }
});

app.post("/proveedores", async (req, res) => {
    const {
        nombre,
        contacto,
        telefono,
        correo,
        notas
    } = req.body;

    if (!nombre) {
        res.status(400).json({
            error: "El nombre es obligatorio"
        });
        return;
    }

    try {
        const negocio = await negocioActual(req);
        const resultado = await pool.query(`
            INSERT INTO public.proveedores
            (
                negocio_id,
                nombre,
                contacto,
                telefono,
                correo,
                notas
            )
            VALUES ($1, $2, $3, $4, $5, $6)
            RETURNING *
        `, [
            negocio.id,
            nombre,
            contacto || "",
            telefono || "",
            correo || "",
            notas || ""
        ]);

        res.json({
            proveedor: resultado.rows[0]
        });
    } catch (error) {
        res.status(500).json({
            error: error.message
        });
    }
});

app.put("/proveedores/:id", async (req, res) => {
    const { id } = req.params;

    const {
        nombre,
        contacto,
        telefono,
        correo,
        notas
    } = req.body;

    if (!nombre) {
        res.status(400).json({
            error: "El nombre es obligatorio"
        });
        return;
    }

    try {
        const negocio = await negocioActual(req);
        const resultado = await pool.query(`
            UPDATE public.proveedores
            SET
                nombre = $1,
                contacto = $2,
                telefono = $3,
                correo = $4,
                notas = $5
            WHERE id = $6
            AND negocio_id = $7
            RETURNING *
        `, [
            nombre,
            contacto || "",
            telefono || "",
            correo || "",
            notas || "",
            id,
            negocio.id
        ]);

        if (resultado.rows.length === 0) {
            res.status(404).json({
                error: "Proveedor no encontrado"
            });
            return;
        }

        res.json({
            proveedor: resultado.rows[0]
        });
    } catch (error) {
        res.status(500).json({
            error: error.message
        });
    }
});

app.delete("/proveedores/:id", async (req, res) => {
    const { id } = req.params;

    try {
        const negocio = await negocioActual(req);
        const resultado = await pool.query(`
            UPDATE public.proveedores
            SET activo = false
            WHERE id = $1
            AND negocio_id = $2
            RETURNING id
        `, [id, negocio.id]);

        if (resultado.rows.length === 0) {
            res.status(404).json({
                error: "Proveedor no encontrado"
            });
            return;
        }

        res.json({
            success: true
        });
    } catch (error) {
        res.status(500).json({
            error: error.message
        });
    }
});

app.post("/creditos/clientes/:id/abonos", async (req, res) => {
    const { id } = req.params;

    const {
        monto,
        concepto
    } = req.body;

    if (!monto || Number(monto) <= 0) {
        res.status(400).json({
            error: "Monto invalido"
        });
        return;
    }

    try {
        const negocio = await negocioActual(req);
        const resultado = await pool.query(`
            INSERT INTO public.movimientos_credito
            (
                negocio_id,
                cliente_id,
                tipo,
                referencia,
                concepto,
                monto
            )
            SELECT $1, c.id, 'abono', $2, $3, $4
            FROM public.clientes_credito c
            WHERE c.id = $5
            AND c.negocio_id = $1
            RETURNING *
        `, [
            negocio.id,
            `AB-${Date.now()}`,
            concepto || "Abono",
            monto,
            id
        ]);

        res.json({
            success: true,
            movimiento: resultado.rows[0]
        });
    } catch (error) {
        res.status(500).json({
            error: error.message
        });
    }
});

app.post("/creditos/clientes/:id/cargos", async (req, res) => {
    const { id } = req.params;

    const {
        monto,
        concepto,
        productos
    } = req.body;

    if (!monto || Number(monto) <= 0) {
        res.status(400).json({
            error: "Monto invalido"
        });
        return;
    }

    try {
        const negocio = await negocioActual(req);
        const resultado = await pool.query(`
            INSERT INTO public.movimientos_credito
            (
                negocio_id,
                cliente_id,
                tipo,
                referencia,
                concepto,
                monto,
                productos
            )
            SELECT $1, c.id, 'venta', $2, $3, $4, $5::jsonb
            FROM public.clientes_credito c
            WHERE c.id = $6
            AND c.negocio_id = $1
            RETURNING *
        `, [
            negocio.id,
            `CR-${Date.now()}`,
            concepto || "Venta a credito",
            monto,
            JSON.stringify(productos || []),
            id
        ]);

        if (Array.isArray(productos)) {
            for (const producto of productos) {
                const cantidad =
                    Number(producto.cantidad || 1);

                await pool.query(
                    `
                    UPDATE public.productos
                    SET stock = stock - $1
                    WHERE id = $2
                    AND negocio_id = $3
                    `,
                    [
                        cantidad,
                        producto.id,
                        negocio.id
                    ]
                );
            }
        }

        res.json({
            success: true,
            movimiento: resultado.rows[0]
        });
    } catch (error) {
        res.status(500).json({
            error: error.message
        });
    }
});

app.get("/dashboard", async (req, res) => {

    try {
        const negocio = await negocioActual(req);

        const totalVentas =
        await pool.query(`
            SELECT
            COALESCE(SUM(total),0)
            AS total
            FROM public.historial_ventas
            WHERE negocio_id = $1
        `, [negocio.id]);

        const cantidadVentas =
        await pool.query(`
            SELECT COUNT(*)
            AS cantidad
            FROM public.historial_ventas
            WHERE negocio_id = $1
        `, [negocio.id]);

        const productos =
        await pool.query(`
            SELECT COUNT(*)
            AS productos
            FROM public.productos
            WHERE negocio_id = $1
        `, [negocio.id]);

        res.json({
            totalVentas:
            totalVentas.rows[0].total,

            cantidadVentas:
            cantidadVentas.rows[0].cantidad,

            productos:
            productos.rows[0].productos
        });

    } catch (error) {

        res.status(500).json({
            error: "Error dashboard"
        });
    }
});

app.get("/historial", async (req, res) => {
    const negocio = await negocioActual(req);

    const historial =
    await pool.query(`
        SELECT *
        FROM public.historial_ventas
        WHERE negocio_id = $1
        ORDER BY fecha DESC
    `, [negocio.id]);

    res.json(historial.rows);
});

app.get("/grafica-ventas", async (req, res) => {
    const negocio = await negocioActual(req);

    const resultado =
    await pool.query(`
        SELECT
        TO_CHAR(fecha,'DD/MM') AS dia,
        total
        FROM public.historial_ventas
        WHERE negocio_id = $1
        ORDER BY fecha ASC
    `, [negocio.id]);

    res.json(resultado.rows);
});

app.get("/reportes/ventas", async (req, res) => {
    try {
        const negocio = await negocioActual(req);
        const resumen = await pool.query(`
            SELECT
                COALESCE(SUM(total), 0) AS total,
                COUNT(*) AS transacciones,
                COALESCE(AVG(total), 0) AS ticket_promedio,
                COALESCE(MAX(total), 0) AS venta_mayor
            FROM public.historial_ventas
            WHERE negocio_id = $1
        `, [negocio.id]);

        const porDia = await pool.query(`
            SELECT
                TO_CHAR(fecha, 'DD/MM') AS dia,
                COALESCE(SUM(total), 0) AS total,
                COUNT(*) AS transacciones
            FROM public.historial_ventas
            WHERE negocio_id = $1
            GROUP BY TO_CHAR(fecha, 'DD/MM'), DATE(fecha)
            ORDER BY DATE(fecha) ASC
            LIMIT 30
        `, [negocio.id]);

        const ultimas = await pool.query(`
            SELECT *
            FROM public.historial_ventas
            WHERE negocio_id = $1
            ORDER BY fecha DESC
            LIMIT 12
        `, [negocio.id]);

        res.json({
            resumen: resumen.rows[0],
            porDia: porDia.rows,
            ultimas: ultimas.rows
        });
    } catch (error) {
        res.status(500).json({
            error: error.message
        });
    }
});

async function inicializarCreditos() {
    await pool.query(`
        CREATE TABLE IF NOT EXISTS public.negocios (
            id SERIAL PRIMARY KEY,
            slug TEXT NOT NULL UNIQUE,
            nombre TEXT NOT NULL,
            giro TEXT NOT NULL DEFAULT 'ferreteria',
            estado TEXT NOT NULL DEFAULT 'activo',
            plan TEXT NOT NULL DEFAULT 'demo',
            telefono TEXT,
            correo TEXT,
            direccion TEXT,
            app_version TEXT,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
    `);

    await pool.query(
        `
        INSERT INTO public.negocios (slug, nombre, giro, estado, plan)
        VALUES ($1, $2, 'ferreteria', 'activo', 'demo')
        ON CONFLICT (slug) DO NOTHING
        `,
        [DEFAULT_NEGOCIO_SLUG, DEFAULT_NEGOCIO_NOMBRE]
    );

    await pool.query(`
        CREATE TABLE IF NOT EXISTS public.licencias (
            id SERIAL PRIMARY KEY,
            negocio_id INTEGER NOT NULL REFERENCES public.negocios(id) ON DELETE CASCADE,
            estado TEXT NOT NULL DEFAULT 'activa',
            plan TEXT NOT NULL DEFAULT 'demo',
            fecha_inicio TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            fecha_vencimiento TIMESTAMPTZ,
            gracia_dias INTEGER NOT NULL DEFAULT 15,
            ultimo_pago_at TIMESTAMPTZ,
            notas TEXT,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            UNIQUE (negocio_id)
        )
    `);

    await pool.query(`
        ALTER TABLE public.licencias
        ADD COLUMN IF NOT EXISTS monto_mensual NUMERIC(12,2) NOT NULL DEFAULT 0
    `);

    await pool.query(`
        CREATE TABLE IF NOT EXISTS public.dispositivos (
            id SERIAL PRIMARY KEY,
            negocio_id INTEGER NOT NULL REFERENCES public.negocios(id) ON DELETE CASCADE,
            device_id TEXT NOT NULL,
            nombre_equipo TEXT,
            plataforma TEXT NOT NULL DEFAULT 'windows',
            app_version TEXT,
            estado TEXT NOT NULL DEFAULT 'activo',
            ultimo_checkin_at TIMESTAMPTZ,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            UNIQUE (negocio_id, device_id)
        )
    `);

    await pool.query(`
        ALTER TABLE public.dispositivos
        ADD COLUMN IF NOT EXISTS sync_pendientes INTEGER NOT NULL DEFAULT 0
    `);

    await pool.query(`
        ALTER TABLE public.dispositivos
        ADD COLUMN IF NOT EXISTS sync_errores INTEGER NOT NULL DEFAULT 0
    `);

    await pool.query(`
        ALTER TABLE public.dispositivos
        ADD COLUMN IF NOT EXISTS sync_ultimo_error TEXT
    `);

    await pool.query(`
        ALTER TABLE public.dispositivos
        ADD COLUMN IF NOT EXISTS local_stats JSONB NOT NULL DEFAULT '{}'::jsonb
    `);

    await pool.query(`
        CREATE TABLE IF NOT EXISTS public.sync_eventos (
            id BIGSERIAL PRIMARY KEY,
            negocio_id INTEGER NOT NULL REFERENCES public.negocios(id) ON DELETE CASCADE,
            device_id TEXT NOT NULL,
            event_id TEXT NOT NULL,
            tipo TEXT NOT NULL,
            entidad TEXT,
            entidad_id TEXT,
            payload JSONB NOT NULL DEFAULT '{}'::jsonb,
            estado TEXT NOT NULL DEFAULT 'recibido',
            recibido_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            aplicado_at TIMESTAMPTZ,
            error TEXT,
            UNIQUE (negocio_id, event_id)
        )
    `);

    await pool.query(`
        CREATE INDEX IF NOT EXISTS idx_sync_eventos_negocio_recibido
        ON public.sync_eventos (negocio_id, recibido_at DESC)
    `);

    await pool.query(`
        CREATE INDEX IF NOT EXISTS idx_sync_eventos_negocio_device
        ON public.sync_eventos (negocio_id, device_id)
    `);

    await pool.query(`
        CREATE TABLE IF NOT EXISTS public.app_versiones (
            id SERIAL PRIMARY KEY,
            version TEXT NOT NULL,
            canal TEXT NOT NULL DEFAULT 'stable',
            plataforma TEXT NOT NULL DEFAULT 'windows',
            url_descarga TEXT,
            notas TEXT,
            obligatoria BOOLEAN NOT NULL DEFAULT false,
            publicada BOOLEAN NOT NULL DEFAULT false,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            UNIQUE (version, canal, plataforma)
        )
    `);

    await pool.query(`
        CREATE TABLE IF NOT EXISTS public.productos (
            id SERIAL PRIMARY KEY,
            nombre TEXT NOT NULL,
            precio NUMERIC(12,2) NOT NULL DEFAULT 0,
            stock NUMERIC(12,3) NOT NULL DEFAULT 0,
            codigo TEXT NOT NULL DEFAULT '',
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
    `);

    await pool.query(`
        ALTER TABLE public.productos
        ADD COLUMN IF NOT EXISTS negocio_id INTEGER REFERENCES public.negocios(id)
    `);

    await pool.query(
        `
        UPDATE public.productos
        SET negocio_id = (SELECT id FROM public.negocios WHERE slug = $1)
        WHERE negocio_id IS NULL
        `,
        [DEFAULT_NEGOCIO_SLUG]
    );

    await pool.query(`
        CREATE TABLE IF NOT EXISTS public.ventas (
            id SERIAL PRIMARY KEY,
            total NUMERIC(12,2) NOT NULL DEFAULT 0,
            fecha TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
    `);

    await pool.query(`
        ALTER TABLE public.ventas
        ADD COLUMN IF NOT EXISTS negocio_id INTEGER REFERENCES public.negocios(id)
    `);

    await pool.query(
        `
        UPDATE public.ventas
        SET negocio_id = (SELECT id FROM public.negocios WHERE slug = $1)
        WHERE negocio_id IS NULL
        `,
        [DEFAULT_NEGOCIO_SLUG]
    );

    await pool.query(`
        CREATE TABLE IF NOT EXISTS public.historial_ventas (
            id SERIAL PRIMARY KEY,
            total NUMERIC(12,2) NOT NULL DEFAULT 0,
            fecha TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
    `);

    await pool.query(`
        ALTER TABLE public.historial_ventas
        ADD COLUMN IF NOT EXISTS negocio_id INTEGER REFERENCES public.negocios(id)
    `);

    await pool.query(
        `
        UPDATE public.historial_ventas
        SET negocio_id = (SELECT id FROM public.negocios WHERE slug = $1)
        WHERE negocio_id IS NULL
        `,
        [DEFAULT_NEGOCIO_SLUG]
    );

    await pool.query(`
        CREATE TABLE IF NOT EXISTS public.usuarios (
            id SERIAL PRIMARY KEY,
            usuario TEXT NOT NULL,
            password TEXT NOT NULL,
            rol TEXT NOT NULL DEFAULT 'Administrador',
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
    `);

    await pool.query(`
        ALTER TABLE public.usuarios
        ADD COLUMN IF NOT EXISTS negocio_id INTEGER REFERENCES public.negocios(id)
    `);

    await pool.query(
        `
        INSERT INTO public.usuarios (negocio_id, usuario, password, rol)
        SELECT id, 'admin', '1234', 'Administrador'
        FROM public.negocios
        WHERE slug = $1
        AND NOT EXISTS (
            SELECT 1
            FROM public.usuarios
            WHERE negocio_id = public.negocios.id
            AND usuario = 'admin'
        )
        `,
        [DEFAULT_NEGOCIO_SLUG]
    );

    await pool.query(
        `
        UPDATE public.usuarios
        SET negocio_id = (SELECT id FROM public.negocios WHERE slug = $1)
        WHERE negocio_id IS NULL
        `,
        [DEFAULT_NEGOCIO_SLUG]
    );

    await pool.query(`
        DO $$
        DECLARE
            constraint_name TEXT;
        BEGIN
            FOR constraint_name IN
                SELECT con.conname
                FROM pg_constraint con
                JOIN pg_class rel ON rel.oid = con.conrelid
                JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
                WHERE nsp.nspname = 'public'
                AND rel.relname = 'usuarios'
                AND con.contype = 'u'
                AND (
                    SELECT array_agg(att.attname ORDER BY att.attnum)
                    FROM unnest(con.conkey) key(attnum)
                    JOIN pg_attribute att
                    ON att.attrelid = rel.oid
                    AND att.attnum = key.attnum
                ) = ARRAY['usuario']
            LOOP
                EXECUTE format(
                    'ALTER TABLE public.usuarios DROP CONSTRAINT IF EXISTS %I',
                    constraint_name
                );
            END LOOP;
        END $$;
    `);

    await pool.query(`
        CREATE UNIQUE INDEX IF NOT EXISTS idx_usuarios_negocio_usuario_unique
        ON public.usuarios (negocio_id, usuario)
    `);

    await pool.query(`
        ALTER TABLE public.productos
        ADD COLUMN IF NOT EXISTS proveedor TEXT
    `);

    await pool.query(`
        ALTER TABLE public.productos
        ADD COLUMN IF NOT EXISTS ubicacion TEXT
    `);

    await pool.query(`
        ALTER TABLE public.productos
        ADD COLUMN IF NOT EXISTS categoria TEXT
    `);

    await pool.query(`
        ALTER TABLE public.productos
        ADD COLUMN IF NOT EXISTS subcategoria TEXT
    `);

    await pool.query(`
        ALTER TABLE public.productos
        ADD COLUMN IF NOT EXISTS marca TEXT
    `);

    await pool.query(`
        ALTER TABLE public.productos
        ADD COLUMN IF NOT EXISTS descripcion TEXT
    `);

    await pool.query(`
        ALTER TABLE public.productos
        ADD COLUMN IF NOT EXISTS unidad_venta TEXT NOT NULL DEFAULT 'pieza'
    `);

    await pool.query(`
        ALTER TABLE public.productos
        ADD COLUMN IF NOT EXISTS precio_distribuidor NUMERIC(12,2)
    `);

    await pool.query(`
        ALTER TABLE public.productos
        ADD COLUMN IF NOT EXISTS precio_mayoreo NUMERIC(12,2)
    `);

    await pool.query(`
        ALTER TABLE public.productos
        ADD COLUMN IF NOT EXISTS precio_publico NUMERIC(12,2)
    `);

    await pool.query(`
        ALTER TABLE public.productos
        ADD COLUMN IF NOT EXISTS stock_minimo NUMERIC(12,2) NOT NULL DEFAULT 3
    `);

    await pool.query(`
        ALTER TABLE public.productos
        ADD COLUMN IF NOT EXISTS alta_rotacion TEXT
    `);

    await pool.query(`
        ALTER TABLE public.productos
        ADD COLUMN IF NOT EXISTS tipo_producto TEXT NOT NULL DEFAULT 'catalogo'
    `);

    await pool.query(`
        ALTER TABLE public.productos
        ADD COLUMN IF NOT EXISTS presentacion_compra TEXT
    `);

    await pool.query(`
        ALTER TABLE public.productos
        ADD COLUMN IF NOT EXISTS factor_conversion NUMERIC(12,3)
    `);

    await pool.query(`
        ALTER TABLE public.productos
        ADD COLUMN IF NOT EXISTS bascula_digital TEXT NOT NULL DEFAULT 'no'
    `);

    await pool.query(`
        CREATE TABLE IF NOT EXISTS public.producto_codigos (
            id SERIAL PRIMARY KEY,
            negocio_id INTEGER REFERENCES public.negocios(id),
            producto_id INTEGER NOT NULL
                REFERENCES public.productos(id)
                ON DELETE CASCADE,
            codigo TEXT NOT NULL,
            tipo TEXT NOT NULL DEFAULT 'alterno',
            proveedor TEXT,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            UNIQUE(producto_id, codigo, tipo)
        )
    `);

    await pool.query(`
        ALTER TABLE public.producto_codigos
        ADD COLUMN IF NOT EXISTS negocio_id INTEGER REFERENCES public.negocios(id)
    `);

    await pool.query(`
        UPDATE public.producto_codigos pc
        SET negocio_id = p.negocio_id
        FROM public.productos p
        WHERE pc.producto_id = p.id
        AND pc.negocio_id IS NULL
    `);

    await pool.query(`
        INSERT INTO public.producto_codigos
        (
            negocio_id,
            producto_id,
            codigo,
            tipo,
            proveedor
        )
        SELECT
            negocio_id,
            id,
            regexp_replace(COALESCE(codigo, ''), '[^a-zA-Z0-9]', '', 'g'),
            'barra',
            proveedor
        FROM public.productos
        WHERE regexp_replace(COALESCE(codigo, ''), '[^a-zA-Z0-9]', '', 'g') <> ''
        ON CONFLICT DO NOTHING
    `);

    await pool.query(`
        CREATE TABLE IF NOT EXISTS public.clientes_credito (
            id SERIAL PRIMARY KEY,
            negocio_id INTEGER REFERENCES public.negocios(id),
            nombre TEXT NOT NULL,
            telefono TEXT,
            limite_credito NUMERIC(12,2) NOT NULL DEFAULT 0,
            activo BOOLEAN NOT NULL DEFAULT true,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
    `);

    await pool.query(`
        ALTER TABLE public.clientes_credito
        ADD COLUMN IF NOT EXISTS negocio_id INTEGER REFERENCES public.negocios(id)
    `);

    await pool.query(
        `
        UPDATE public.clientes_credito
        SET negocio_id = (SELECT id FROM public.negocios WHERE slug = $1)
        WHERE negocio_id IS NULL
        `,
        [DEFAULT_NEGOCIO_SLUG]
    );

    await pool.query(`
        CREATE TABLE IF NOT EXISTS public.movimientos_credito (
            id SERIAL PRIMARY KEY,
            negocio_id INTEGER REFERENCES public.negocios(id),
            cliente_id INTEGER NOT NULL
                REFERENCES public.clientes_credito(id)
                ON DELETE CASCADE,
            tipo TEXT NOT NULL
                CHECK (tipo IN ('venta', 'abono')),
            referencia TEXT,
            concepto TEXT NOT NULL DEFAULT '',
            monto NUMERIC(12,2) NOT NULL
                CHECK (monto > 0),
            fecha TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
    `);

    await pool.query(`
        ALTER TABLE public.movimientos_credito
        ADD COLUMN IF NOT EXISTS negocio_id INTEGER REFERENCES public.negocios(id)
    `);

    await pool.query(`
        UPDATE public.movimientos_credito m
        SET negocio_id = c.negocio_id
        FROM public.clientes_credito c
        WHERE m.cliente_id = c.id
        AND m.negocio_id IS NULL
    `);

    await pool.query(`
        ALTER TABLE public.movimientos_credito
        ADD COLUMN IF NOT EXISTS productos JSONB NOT NULL DEFAULT '[]'::jsonb
    `);

    await pool.query(`
        CREATE TABLE IF NOT EXISTS public.proveedores (
            id SERIAL PRIMARY KEY,
            negocio_id INTEGER REFERENCES public.negocios(id),
            nombre TEXT NOT NULL,
            contacto TEXT,
            telefono TEXT,
            correo TEXT,
            notas TEXT,
            activo BOOLEAN NOT NULL DEFAULT true,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
    `);

    await pool.query(`
        ALTER TABLE public.proveedores
        ADD COLUMN IF NOT EXISTS negocio_id INTEGER REFERENCES public.negocios(id)
    `);

    await pool.query(
        `
        UPDATE public.proveedores
        SET negocio_id = (SELECT id FROM public.negocios WHERE slug = $1)
        WHERE negocio_id IS NULL
        `,
        [DEFAULT_NEGOCIO_SLUG]
    );
}
function cargarModuloPOS(nombre, instalar) {
    try {
        instalar();
        console.log(`Modulo POS cargado: ${nombre}`);
    } catch (error) {
        console.log(`Error cargando modulo POS ${nombre}:`, error);
    }
}

cargarModuloPOS("fase4 compras/ajustes", () => {
    require("./fase4-server")(app, pool, normalizarCodigo);
});
cargarModuloPOS("fase5 finanzas", () => {
    require("./fase5-server")(app, pool);
});
cargarModuloPOS("fase6 caja", () => {
    require("./fase6-server")(app, pool);
});
cargarModuloPOS("fase7 caja por metodo", () => {
    require("./fase7-caja-server")(app, pool);
});


inicializarCreditos()
    .then(() => {
        app.listen(PORT, () => {
            console.log(
                `Servidor corriendo en puerto ${PORT}`
            );
        });
    })
    .catch(error => {
        console.log(
            "Error inicializando creditos:",
            error
        );
        process.exit(1);
    });
