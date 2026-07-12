const express = require("express");
const path = require("path");
const crypto = require("crypto");
const os = require("os");
const fs = require("fs");
const multer = require("multer");
const AdmZip = require("adm-zip");
const sharp = require("sharp");
const { config, validarConfigProduccion } = require("./config");
const pool = require("./db");
const {
    DEFAULT_NEGOCIO_SLUG,
    DEFAULT_NEGOCIO_NOMBRE,
    asegurarNegocioActual,
    normalizarSlug
} = require("./tenant");
const { cargarModulosPOS } = require("./server-modules");
const { hashPassword, verificarPassword } = require("./password-utils");

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

function compararVersiones(versionA, versionB) {
    const partesA = String(versionA || "0.0.0").split(/[.-]/);
    const partesB = String(versionB || "0.0.0").split(/[.-]/);
    const largo = Math.max(partesA.length, partesB.length, 3);

    for (let index = 0; index < largo; index += 1) {
        const valorA = Number.parseInt(partesA[index] || "0", 10) || 0;
        const valorB = Number.parseInt(partesB[index] || "0", 10) || 0;

        if (valorA > valorB) return 1;
        if (valorA < valorB) return -1;
    }

    return 0;
}

function versionEsMayor(versionNueva, versionActual) {
    return compararVersiones(versionNueva, versionActual) > 0;
}

function limpiarTexto(valor, max = 160) {
    return String(valor || "")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, max);
}

function normalizarLicencia(valor) {
    return String(valor || "")
        .toUpperCase()
        .replace(/[^A-Z0-9-]/g, "")
        .replace(/-+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 80);
}

function compactarLicencia(valor) {
    return String(valor || "")
        .toUpperCase()
        .replace(/[^A-Z0-9]/g, "");
}

function generarLicenciaKey() {
    return [
        "NXP",
        crypto.randomBytes(3).toString("hex"),
        crypto.randomBytes(3).toString("hex"),
        crypto.randomBytes(3).toString("hex")
    ].join("-").toUpperCase();
}

async function generarLicenciaUnica(client) {
    for (let intento = 0; intento < 8; intento += 1) {
        const licenciaKey = generarLicenciaKey();
        const existe = await client.query(
            "SELECT 1 FROM public.licencias WHERE license_key = $1 LIMIT 1",
            [licenciaKey]
        );

        if (existe.rows.length === 0) {
            return licenciaKey;
        }
    }

    throw new Error("No se pudo generar una licencia unica");
}

async function buscarNegocioPorLicencia(client, licenseKey) {
    const limpia = compactarLicencia(licenseKey);

    if (!limpia) return null;

    const resultado = await client.query(
        `
        SELECT
            n.*,
            l.id AS licencia_id,
            l.estado AS licencia_estado,
            l.plan AS licencia_plan,
            l.fecha_inicio,
            l.fecha_vencimiento,
            l.gracia_dias,
            l.ultimo_pago_at,
            l.monto_mensual,
            l.notas,
            l.license_key
        FROM public.licencias l
        JOIN public.negocios n ON n.id = l.negocio_id
        WHERE regexp_replace(upper(l.license_key), '[^A-Z0-9]', '', 'g') = $1
        LIMIT 1
        `,
        [limpia]
    );

    return resultado.rows[0] || null;
}

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

app.get("/negocios/buscar", async (req, res) => {
    const texto = String(req.query.q || "").trim();

    if (texto.length < 3) {
        res.json({ ok: true, negocios: [] });
        return;
    }

    try {
        const resultado = await pool.query(
            `
            SELECT slug, nombre
            FROM public.negocios
            WHERE nombre ILIKE $1
            OR telefono ILIKE $1
            ORDER BY nombre ASC
            LIMIT 8
            `,
            [`%${texto}%`]
        );

        res.json({
            ok: true,
            negocios: resultado.rows
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

        const correoActual = await pool.query(
            `SELECT correo FROM public.negocios WHERE id = $1`,
            [negocio.id]
        );

        res.json({
            ok: true,
            negocio: {
                id: negocio.id,
                slug: negocio.slug,
                nombre: negocio.nombre,
                estado: negocio.estado,
                plan: negocio.plan,
                correo: correoActual.rows[0]?.correo || null
            },
            licencia: {
                licenseKey: licencia.license_key,
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

app.put("/negocio-actual/correo", async (req, res) => {
    try {
        const negocio = await negocioActual(req);
        const correo = String(req.body?.correo || "").trim();

        if (correo && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(correo)) {
            res.status(400).json({
                ok: false,
                error: "Correo invalido"
            });
            return;
        }

        await pool.query(
            `UPDATE public.negocios SET correo = $1, updated_at = NOW() WHERE id = $2`,
            [correo || null, negocio.id]
        );

        res.json({
            ok: true,
            correo: correo || null
        });
    } catch (error) {
        res.status(500).json({
            ok: false,
            error: error.message
        });
    }
});

app.post("/api/clientes/registro", async (req, res) => {
    if (limpiarTexto(req.body?.empresaWeb, 200)) {
        return res.status(400).json({
            ok: false,
            error: "Solicitud invalida"
        });
    }

    if (limitadorRegistroPublico.bloqueado(req.ip)) {
        return res.status(429).json({
            ok: false,
            error: "Demasiadas solicitudes. Intenta de nuevo mas tarde."
        });
    }

    // Cuenta cada intento (exito o error) contra el limite de 5/hora -- no se llama
    // registrarExito() para este limitador, el tope aplica sin importar el resultado.
    limitadorRegistroPublico.registrarFallo(req.ip);

    const client = await pool.connect();

    try {
        const nombreNegocio = limpiarTexto(req.body?.nombreNegocio || req.body?.negocio, 140);
        const telefono = limpiarTexto(req.body?.telefono, 40);
        const correo = limpiarTexto(req.body?.correo, 140).toLowerCase();
        const ciudad = limpiarTexto(req.body?.ciudad || req.body?.direccion, 180);
        const nombreContacto = limpiarTexto(req.body?.nombreContacto || req.body?.nombre, 120);
        const giro = limpiarTexto(req.body?.giro, 80) || "ferreteria";
        const plan = limpiarTexto(req.body?.plan, 80) || "demo";

        if (!nombreNegocio || !telefono) {
            return res.status(400).json({
                ok: false,
                error: "Nombre del negocio y telefono son requeridos"
            });
        }

        const slugBase = normalizarSlug(nombreNegocio);

        await client.query("BEGIN");

        let slug = slugBase;
        let slugDisponible = false;
        for (let intento = 2; intento <= 50; intento += 1) {
            const existe = await client.query(
                "SELECT 1 FROM public.negocios WHERE slug = $1 LIMIT 1",
                [slug]
            );

            if (existe.rows.length === 0) {
                slugDisponible = true;
                break;
            }

            slug = `${slugBase}-${intento}`;
        }

        if (!slugDisponible) {
            throw new Error("No se pudo generar un codigo unico para el negocio");
        }

        const negocio = await client.query(
            `
            INSERT INTO public.negocios
                (slug, nombre, giro, estado, plan, telefono, correo, direccion, updated_at)
            VALUES
                ($1, $2, $3, 'prueba', $4, $5, $6, $7, NOW())
            RETURNING *
            `,
            [slug, nombreNegocio, giro, plan, telefono, correo || null, ciudad || null]
        );

        const licenciaKey = await generarLicenciaUnica(client);
        const venceEnDias = Number.isFinite(Number(req.body?.diasPrueba))
            ? Math.max(1, Math.min(Number(req.body.diasPrueba), 90))
            : 30;

        const licencia = await client.query(
            `
            INSERT INTO public.licencias
                (negocio_id, license_key, estado, plan, fecha_vencimiento, gracia_dias, monto_mensual, notas, updated_at)
            VALUES
                ($1, $2, 'activa', $3, NOW() + ($4::int * INTERVAL '1 day'), 15, 0, $5, NOW())
            RETURNING *
            `,
            [
                negocio.rows[0].id,
                licenciaKey,
                plan,
                venceEnDias,
                nombreContacto
                    ? `Alta publica. Contacto: ${nombreContacto}`
                    : "Alta publica"
            ]
        );

        await client.query(
            `
            INSERT INTO public.usuarios (negocio_id, usuario, password_hash, rol)
            VALUES ($1, 'admin', $2, 'Administrador')
            ON CONFLICT DO NOTHING
            `,
            [negocio.rows[0].id, hashPassword("1234")]
        );

        const version = await client.query(
            `
            SELECT version, url_descarga, archivo
            FROM public.app_versiones
            WHERE canal = 'stable'
            AND plataforma = 'windows'
            AND publicada = true
            ORDER BY created_at DESC, id DESC
            LIMIT 1
            `
        );

        await client.query("COMMIT");

        const latest = version.rows[0] || null;

        res.status(201).json({
            ok: true,
            negocio: {
                id: negocio.rows[0].id,
                slug: negocio.rows[0].slug,
                nombre: negocio.rows[0].nombre,
                estado: negocio.rows[0].estado,
                plan: negocio.rows[0].plan
            },
            licencia: {
                licenseKey: licencia.rows[0].license_key,
                estado: licencia.rows[0].estado,
                plan: licencia.rows[0].plan,
                modo: calcularModoLicencia(licencia.rows[0]),
                fechaVencimiento: licencia.rows[0].fecha_vencimiento,
                graciaDias: licencia.rows[0].gracia_dias
            },
            instalador: {
                version: latest?.version || config.appVersion,
                url: latest?.url_descarga || "/downloads/NexoPOS_Setup_1.0.0.exe",
                archivo: latest?.archivo || "NexoPOS_Setup_1.0.0.exe"
            },
            accesoInicial: {
                usuario: "admin",
                password: "1234"
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

function crearLimitadorPorIp(maxIntentos, ventanaMs) {
    const registro = new Map();

    return {
        bloqueado(ip) {
            const entrada = registro.get(ip);
            return Boolean(entrada?.bloqueadoHasta && entrada.bloqueadoHasta > Date.now());
        },
        registrarFallo(ip) {
            const entrada = registro.get(ip) || { fallos: 0, bloqueadoHasta: 0 };
            entrada.fallos += 1;

            if (entrada.fallos >= maxIntentos) {
                entrada.bloqueadoHasta = Date.now() + ventanaMs;
            }

            registro.set(ip, entrada);
        },
        registrarExito(ip) {
            registro.delete(ip);
        }
    };
}

const limitadorAdminKey = crearLimitadorPorIp(8, 15 * 60 * 1000);
const limitadorRegistroPublico = crearLimitadorPorIp(5, 60 * 60 * 1000);

function validarAdminKey(req, res, next) {
    if (!config.adminKey) {
        return res.status(503).json({
            ok: false,
            error: "ADMIN_KEY no configurado en el servidor"
        });
    }

    const ip = req.ip;

    if (limitadorAdminKey.bloqueado(ip)) {
        return res.status(429).json({
            ok: false,
            error: "Demasiados intentos fallidos. Intenta de nuevo mas tarde."
        });
    }

    const headerKey =
        req.get("x-admin-key") || "";

    if (headerKey !== config.adminKey) {
        limitadorAdminKey.registrarFallo(ip);

        return res.status(401).json({
            ok: false,
            error: "Clave de administrador invalida"
        });
    }

    limitadorAdminKey.registrarExito(ip);
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
                COUNT(*) FILTER (WHERE estado IN ('suspendido', 'cancelado'))::int AS suspendidos,
                COUNT(*) FILTER (
                    WHERE telefono IS NULL AND correo IS NULL AND direccion IS NULL
                    AND NOT EXISTS (SELECT 1 FROM public.productos p WHERE p.negocio_id = negocios.id)
                    AND NOT EXISTS (SELECT 1 FROM public.ventas v WHERE v.negocio_id = negocios.id)
                )::int AS fantasmas
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
                n.telefono,
                n.correo,
                n.direccion,
                n.created_at,
                l.estado AS licencia_estado,
                l.plan AS licencia_plan,
                l.fecha_inicio,
                l.fecha_vencimiento,
                l.gracia_dias,
                l.ultimo_pago_at,
                l.monto_mensual,
                l.license_key,
                l.notas,
                COUNT(d.id)::int AS dispositivos,
                COUNT(d.id) FILTER (WHERE d.ultimo_checkin_at > NOW() - INTERVAL '5 minutes')::int AS dispositivos_en_linea,
                MAX(d.ultimo_checkin_at) AS ultimo_uso,
                MAX(d.last_sync_at) AS ultima_sync,
                MAX(d.created_at) AS instalado_at,
                MAX(d.app_version) AS app_version,
                MAX(d.update_latest_version) AS latest_version,
                BOOL_OR(COALESCE(d.update_available, false)) AS update_available,
                MAX(d.plataforma) AS plataforma,
                MAX(d.os_version) AS os_version,
                MAX(d.arch) AS arch,
                COALESCE(SUM(d.sync_pendientes), 0)::int AS sync_pendientes,
                COALESCE(SUM(d.sync_errores), 0)::int AS sync_errores,
                (SELECT COUNT(*)::int FROM public.productos p WHERE p.negocio_id = n.id) AS productos_count,
                (SELECT COUNT(*)::int FROM public.ventas v WHERE v.negocio_id = n.id) AS ventas_count,
                (
                    SELECT COUNT(*)::int
                    FROM public.negocios n2
                    WHERE n2.id <> n.id
                    AND n.telefono IS NOT NULL AND n.telefono <> ''
                    AND n2.telefono = n.telefono
                ) AS duplicados_telefono,
                EXISTS (
                    SELECT 1 FROM public.tenant_auto_provision_log t
                    WHERE t.negocio_id = n.id
                ) AS tuvo_auto_provision
            FROM public.negocios n
            LEFT JOIN public.licencias l ON l.negocio_id = n.id
            LEFT JOIN public.dispositivos d ON d.negocio_id = n.id
            GROUP BY n.id, l.id
            ORDER BY n.created_at DESC
        `);

        res.json({
            ok: true,
            negocios: resultado.rows.map(row => {
                const sinDatosContacto =
                    !row.telefono && !row.correo && !row.direccion;

                const sinActividad =
                    Number(row.productos_count) === 0 && Number(row.ventas_count) === 0;

                return {
                    ...row,
                    licencia_modo: calcularModoLicencia({
                        estado: row.licencia_estado,
                        fecha_vencimiento: row.fecha_vencimiento,
                        gracia_dias: row.gracia_dias
                    }),
                    anomalia_auto_provisionado: sinDatosContacto,
                    anomalia_sin_actividad: sinActividad,
                    anomalia_fantasma: sinDatosContacto && sinActividad,
                    anomalia_posible_duplicado: Number(row.duplicados_telefono) > 0,
                    dias_desde_creacion: row.created_at
                        ? Math.max(0, Math.floor((Date.now() - new Date(row.created_at).getTime()) / 86400000))
                        : null
                };
            })
        });
    } catch (error) {
        res.status(500).json({
            ok: false,
            error: error.message
        });
    }
});

app.post("/admin/api/negocios", async (req, res) => {
    const client = await pool.connect();

    try {
        const nombre = limpiarTexto(req.body?.nombre, 140);
        const slugSolicitado = normalizarSlug(req.body?.slug || nombre);
        const giro = limpiarTexto(req.body?.giro, 80) || "ferreteria";
        const plan = limpiarTexto(req.body?.plan, 80) || "ferreteria-base";
        const estado = limpiarTexto(req.body?.estado, 40) || "activo";
        const licenciaEstado = limpiarTexto(req.body?.licenciaEstado, 40) || "activa";
        const telefono = limpiarTexto(req.body?.telefono, 40);
        const correo = limpiarTexto(req.body?.correo, 140).toLowerCase();
        const direccion = limpiarTexto(req.body?.direccion, 180);
        const montoMensual = Number.isFinite(Number(req.body?.montoMensual))
            ? Number(req.body.montoMensual)
            : 0;
        const graciaDias = Number.isFinite(Number(req.body?.graciaDias))
            ? Math.max(0, Number(req.body.graciaDias))
            : 15;
        const fechaVencimiento = req.body?.fechaVencimiento || null;
        const notas = limpiarTexto(req.body?.notas, 500);

        if (!nombre) {
            return res.status(400).json({
                ok: false,
                error: "El nombre del cliente es requerido"
            });
        }

        if (!slugSolicitado) {
            return res.status(400).json({
                ok: false,
                error: "No se pudo generar el codigo del cliente"
            });
        }

        await client.query("BEGIN");

        const existe = await client.query(
            "SELECT 1 FROM public.negocios WHERE slug = $1 LIMIT 1",
            [slugSolicitado]
        );

        if (existe.rows.length > 0) {
            throw new Error("Ya existe un cliente con ese codigo");
        }

        const negocio = await client.query(
            `
            INSERT INTO public.negocios
                (slug, nombre, giro, estado, plan, telefono, correo, direccion, updated_at)
            VALUES
                ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
            RETURNING *
            `,
            [
                slugSolicitado,
                nombre,
                giro,
                estado,
                plan,
                telefono || null,
                correo || null,
                direccion || null
            ]
        );

        const licenciaKey = await generarLicenciaUnica(client);
        const licencia = await client.query(
            `
            INSERT INTO public.licencias
                (negocio_id, license_key, estado, plan, fecha_vencimiento, gracia_dias, monto_mensual, notas, updated_at)
            VALUES
                ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
            RETURNING *
            `,
            [
                negocio.rows[0].id,
                licenciaKey,
                licenciaEstado,
                plan,
                fechaVencimiento,
                graciaDias,
                montoMensual,
                notas || "Alta desde panel admin"
            ]
        );

        await client.query(
            `
            INSERT INTO public.usuarios (negocio_id, usuario, password_hash, rol)
            VALUES ($1, 'admin', $2, 'Administrador')
            ON CONFLICT DO NOTHING
            `,
            [negocio.rows[0].id, hashPassword("1234")]
        );

        await client.query("COMMIT");

        res.status(201).json({
            ok: true,
            negocio: negocio.rows[0],
            licencia: {
                ...licencia.rows[0],
                modo: calcularModoLicencia(licencia.rows[0])
            },
            accesoInicial: {
                usuario: "admin",
                password: "1234"
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
                os_version,
                arch,
                installed_at,
                last_sync_at,
                update_latest_version,
                update_available,
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

async function eliminarDatosNegocioAdmin(client, negocioId) {
    const tablas = [
        "pagos_proveedor",
        "cuentas_pagar",
        "gastos_operativos",
        "movimientos_caja",
        "turnos_caja",
        "recepciones_mercancia_items",
        "recepciones_mercancia",
        "pedidos_proveedor_items",
        "pedidos_proveedor",
        "ajustes_inventario",
        "movimientos_credito",
        "clientes_credito",
        "producto_codigos",
        "productos",
        "historial_ventas",
        "ventas",
        "proveedores",
        "usuarios",
        "sync_eventos",
        "dispositivos",
        "licencias"
    ];

    for (const tabla of tablas) {
        await client.query(
            `
            DO $$
            BEGIN
                IF to_regclass('public.${tabla}') IS NOT NULL THEN
                    DELETE FROM public.${tabla}
                    WHERE negocio_id = ${Number(negocioId)};
                END IF;
            END $$
            `
        );
    }
}

app.delete("/admin/api/negocios/:id", async (req, res) => {
    const client = await pool.connect();

    try {
        const negocioId = Number(req.params.id);
        const confirmarSlug = normalizarSlug(req.body?.confirmarSlug || "");

        if (!Number.isFinite(negocioId) || negocioId <= 0) {
            return res.status(400).json({
                ok: false,
                error: "Cliente invalido"
            });
        }

        await client.query("BEGIN");

        const negocio = await client.query(
            "SELECT id, slug, nombre FROM public.negocios WHERE id = $1 FOR UPDATE",
            [negocioId]
        );

        if (negocio.rows.length === 0) {
            throw new Error("Cliente no encontrado");
        }

        if (confirmarSlug !== negocio.rows[0].slug) {
            throw new Error("Para eliminar escribe exactamente el codigo del cliente");
        }

        await eliminarDatosNegocioAdmin(client, negocioId);
        await client.query("DELETE FROM public.negocios WHERE id = $1", [negocioId]);
        await client.query("COMMIT");

        res.json({
            ok: true,
            eliminado: negocio.rows[0]
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

app.get("/admin/api/versiones", async (_req, res) => {
    try {
        const resultado = await pool.query(`
            SELECT
                id,
                version,
                canal,
                plataforma,
                url_descarga,
                notas,
                obligatoria,
                publicada,
                archivo,
                sha512,
                tamano_bytes,
                created_at
            FROM public.app_versiones
            ORDER BY created_at DESC, id DESC
            LIMIT 20
        `);

        res.json({
            ok: true,
            currentServerVersion: config.appVersion,
            versiones: resultado.rows
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

app.post("/admin/api/negocios/:id/licencia/regenerar-clave", async (req, res) => {
    const client = await pool.connect();

    try {
        const negocioId = Number(req.params.id);

        if (!Number.isFinite(negocioId) || negocioId <= 0) {
            return res.status(400).json({
                ok: false,
                error: "Cliente invalido"
            });
        }

        await client.query("BEGIN");

        const nuevaClave = await generarLicenciaUnica(client);

        const resultado = await client.query(
            `
            UPDATE public.licencias
            SET license_key = $2, updated_at = NOW()
            WHERE negocio_id = $1
            RETURNING license_key
            `,
            [negocioId, nuevaClave]
        );

        if (resultado.rows.length === 0) {
            throw new Error("El cliente no tiene una licencia registrada");
        }

        await client.query("COMMIT");

        res.json({
            ok: true,
            licenseKey: resultado.rows[0].license_key
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
        const licenseKey =
            normalizarLicencia(req.body?.licenseKey || req.body?.licencia || "");
        let negocioActivacion = null;

        if (licenseKey) {
            const porLicencia =
                await buscarNegocioPorLicencia(pool, licenseKey);

            if (!porLicencia) {
                return res.status(404).json({
                    ok: false,
                    error: "Licencia no encontrada"
                });
            }

            negocioActivacion = {
                id: porLicencia.id,
                slug: porLicencia.slug,
                nombre: porLicencia.nombre,
                giro: porLicencia.giro,
                estado: porLicencia.estado,
                plan: porLicencia.plan
            };
        } else if (config.isProduction) {
            return res.status(400).json({
                ok: false,
                error: "Licencia requerida para activar Nexo POS"
            });
        } else {
            negocioActivacion = await negocioActual(req);
        }

        const licenciaActualizada = await licenciaActual(negocioActivacion);

        if (["bloqueado"].includes(licenciaActualizada.modo)) {
            return res.status(403).json({
                ok: false,
                error: "Licencia bloqueada. Contacta a soporte Nexo POS."
            });
        }

        const deviceId =
            obtenerDeviceId(req) || crypto.randomUUID();
        const nombreEquipo =
            req.body?.nombreEquipo || req.body?.hostname || "Equipo Windows";
        const plataforma =
            req.body?.plataforma || "windows";
        const appVersion =
            req.body?.appVersion || config.appVersion;
        const osVersion =
            req.body?.osVersion || null;
        const arch =
            req.body?.arch || null;
        const updateLatestVersion =
            req.body?.update?.latestVersion || null;
        const updateAvailable =
            Boolean(req.body?.update?.updateAvailable);

        const resultado =
        await pool.query(
            `
            INSERT INTO public.dispositivos
                (negocio_id, device_id, nombre_equipo, plataforma, app_version, os_version, arch, installed_at, update_latest_version, update_available, ultimo_checkin_at)
            VALUES
                ($1, $2, $3, $4, $5, $6, $7, COALESCE((SELECT installed_at FROM public.dispositivos WHERE negocio_id = $1 AND device_id = $2), NOW()), $8, $9, NOW())
            ON CONFLICT (negocio_id, device_id)
            DO UPDATE SET
                nombre_equipo = EXCLUDED.nombre_equipo,
                plataforma = EXCLUDED.plataforma,
                app_version = EXCLUDED.app_version,
                os_version = COALESCE(EXCLUDED.os_version, public.dispositivos.os_version),
                arch = COALESCE(EXCLUDED.arch, public.dispositivos.arch),
                update_latest_version = COALESCE(EXCLUDED.update_latest_version, public.dispositivos.update_latest_version),
                update_available = EXCLUDED.update_available,
                estado = 'activo',
                ultimo_checkin_at = NOW(),
                updated_at = NOW()
            RETURNING *
            `,
            [negocioActivacion.id, deviceId, nombreEquipo, plataforma, appVersion, osVersion, arch, updateLatestVersion, updateAvailable]
        );

        await pool.query(
            `
            UPDATE public.licencias
            SET activated_at = COALESCE(activated_at, NOW()),
                updated_at = NOW()
            WHERE negocio_id = $1
            `,
            [negocioActivacion.id]
        );

        res.json({
            ok: true,
            negocio: negocioActivacion,
            dispositivo: resultado.rows[0],
            licencia: await licenciaActual(negocioActivacion)
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
                os_version = COALESCE($8, os_version),
                arch = COALESCE($9, arch),
                update_latest_version = COALESCE($10, update_latest_version),
                update_available = COALESCE($11, update_available),
                last_sync_at = CASE
                    WHEN COALESCE($4, sync_pendientes) = 0
                     AND COALESCE($5, sync_errores) = 0
                    THEN NOW()
                    ELSE last_sync_at
                END,
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
                req.body?.localStats ? JSON.stringify(req.body.localStats) : null,
                req.body?.osVersion || null,
                req.body?.arch || null,
                req.body?.update?.latestVersion || null,
                req.body?.update?.updateAvailable === undefined ? null : Boolean(req.body.update.updateAvailable)
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
                os_version,
                arch,
                installed_at,
                last_sync_at,
                update_latest_version,
                update_available,
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

        const licenciaSync = await licenciaActual(negocio);
        const licenciaBloqueada = ["limitado", "bloqueado"].includes(licenciaSync.modo);
        const TIPOS_RESTRINGIDOS_LICENCIA = new Set([
            "venta_creada",
            "credito_cargo_creado",
            "producto_creado",
            "producto_actualizado"
        ]);

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

            if (licenciaBloqueada && TIPOS_RESTRINGIDOS_LICENCIA.has(tipo)) {
                errores.push({
                    eventId,
                    error: `Licencia en modo ${licenciaSync.modo}: operacion no permitida.`
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
        const currentVersion =
            String(req.query.currentVersion || req.get("x-app-version") || config.appVersion);

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
            Boolean(version && versionEsMayor(version.version, currentVersion));

        res.json({
            ok: true,
            updateAvailable,
            currentVersion,
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

function normalizarCodigoFoto(codigo) {
    return String(codigo || "")
        .toUpperCase()
        .replace(/[^A-Z0-9]/g, "");
}

async function comprimirImagen(buffer, anchoMax = 320) {
    return sharp(buffer)
        .resize({ width: anchoMax, withoutEnlargement: true })
        .jpeg({ quality: 72 })
        .toBuffer();
}

const uploadZipsFotosProducto = multer({
    dest: os.tmpdir(),
    limits: { fileSize: 60 * 1024 * 1024, files: 30 }
});

// Envuelve multer a mano (en vez de pasarlo directo como middleware) para
// que cualquier error de subida (archivo muy pesado, multipart mal formado,
// etc.) siempre regrese JSON -- si no, Express cae a su pagina de error en
// HTML y el navegador truena con "Unexpected token '<'" al parsearla como
// JSON.
function manejarSubidaFotosProducto(req, res, next) {
    uploadZipsFotosProducto.array("zips", 30)(req, res, error => {
        if (error) {
            res.status(400).json({
                ok: false,
                error: error.message || "No se pudo procesar el archivo subido"
            });
            return;
        }
        next();
    });
}

async function procesarZipFotosProducto(rutaZip, negocioId) {
    const resumen = { fotosGuardadas: 0, errores: [] };

    let zip;
    try {
        zip = new AdmZip(rutaZip);
    } catch (error) {
        resumen.errores.push(`Zip invalido: ${error.message}`);
        return resumen;
    }

    const carpetas = new Map();

    for (const entry of zip.getEntries()) {
        if (entry.isDirectory) continue;

        const partes = entry.entryName.split("/").filter(Boolean);
        if (partes.length < 2) continue;

        const carpeta = partes[0];
        const nombreArchivo = partes[partes.length - 1];

        if (!/\.(jpg|jpeg|png|webp)$/i.test(nombreArchivo)) continue;

        if (!carpetas.has(carpeta)) carpetas.set(carpeta, []);
        carpetas.get(carpeta).push({ nombreArchivo, entry });
    }

    for (const [carpeta, archivos] of carpetas) {
        try {
            const principal = archivos[0];
            const resto = archivos.slice(1);

            const codigoArchivo = principal.nombreArchivo
                .replace(/\.(jpg|jpeg|png|webp)$/i, "")
                .split("+")[0];

            // El nombre de carpeta del zip suele ser el ID interno numerico de
            // Truper para ese producto (ej. "14928"), distinto de la clave
            // impresa en el empaque (ej. "ACES-4T-14") -- Diprofer a veces usa
            // ese mismo numero como codigo real del producto, asi que se
            // guarda la foto bajo los dos para que cualquiera de los dos
            // haga match.
            const codigos = [...new Set([
                normalizarCodigoFoto(codigoArchivo),
                normalizarCodigoFoto(carpeta)
            ])].filter(Boolean);

            if (codigos.length === 0) continue;

            const bufferPrincipal = await comprimirImagen(principal.entry.getData(), 320);
            const buffersGaleria = [];

            for (const item of resto) {
                buffersGaleria.push(await comprimirImagen(item.entry.getData(), 480));
            }

            for (const codigo of codigos) {
                const upsert = await pool.query(
                    `
                    INSERT INTO public.fotos_producto (negocio_id, codigo, imagen_principal, imagen_principal_tipo, actualizado_at)
                    VALUES ($1, $2, $3, 'image/jpeg', NOW())
                    ON CONFLICT (negocio_id, codigo)
                    DO UPDATE SET imagen_principal = $3, imagen_principal_tipo = 'image/jpeg', actualizado_at = NOW()
                    RETURNING id
                    `,
                    [negocioId, codigo, bufferPrincipal]
                );

                const fotoProductoId = upsert.rows[0].id;

                await pool.query(
                    `DELETE FROM public.fotos_producto_galeria WHERE foto_producto_id = $1`,
                    [fotoProductoId]
                );

                let orden = 0;
                for (const bufferGaleria of buffersGaleria) {
                    await pool.query(
                        `
                        INSERT INTO public.fotos_producto_galeria (foto_producto_id, orden, imagen, tipo)
                        VALUES ($1, $2, $3, 'image/jpeg')
                        `,
                        [fotoProductoId, orden, bufferGaleria]
                    );

                    orden += 1;
                }
            }

            resumen.fotosGuardadas += 1;
        } catch (error) {
            resumen.errores.push(error.message);
        }
    }

    return resumen;
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
        licenseKey: licencia.license_key,
        modo: calcularModoLicencia(licencia)
    };
}

async function exigirLicenciaActiva(res, negocio, operacion) {
    const licencia = await licenciaActual(negocio);

    if (["limitado", "bloqueado"].includes(licencia.modo)) {
        res.status(402).json({
            ok: false,
            error: `No se puede continuar con ${operacion} porque la licencia esta en modo ${licencia.modo}.`,
            licenciaModo: licencia.modo
        });

        return null;
    }

    return licencia;
}

async function asegurarColumnasHistorialVentas(client = pool) {
    await client.query(`
        CREATE TABLE IF NOT EXISTS public.folio_contadores (
            negocio_id INTEGER NOT NULL REFERENCES public.negocios(id) ON DELETE CASCADE,
            tipo TEXT NOT NULL,
            ultimo_numero INTEGER NOT NULL DEFAULT 0,
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            PRIMARY KEY (negocio_id, tipo)
        )
    `);
    await client.query(`
        ALTER TABLE public.historial_ventas
        ADD COLUMN IF NOT EXISTS subtotal NUMERIC(12,2) NOT NULL DEFAULT 0
    `);
    await client.query(`
        ALTER TABLE public.historial_ventas
        ADD COLUMN IF NOT EXISTS descuento NUMERIC(12,2) NOT NULL DEFAULT 0
    `);
    await client.query(`
        ALTER TABLE public.historial_ventas
        ADD COLUMN IF NOT EXISTS descuento_tipo TEXT NOT NULL DEFAULT 'ninguno'
    `);
    await client.query(`
        ALTER TABLE public.historial_ventas
        ADD COLUMN IF NOT EXISTS descuento_valor NUMERIC(12,2) NOT NULL DEFAULT 0
    `);
    await client.query(`
        ALTER TABLE public.historial_ventas
        ADD COLUMN IF NOT EXISTS cliente_id INTEGER
    `);
    await client.query(`
        ALTER TABLE public.historial_ventas
        ADD COLUMN IF NOT EXISTS productos JSONB NOT NULL DEFAULT '[]'::jsonb
    `);
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
    await client.query(`
        ALTER TABLE public.historial_ventas
        ADD COLUMN IF NOT EXISTS venta_id INTEGER
    `);
    await client.query(`
        ALTER TABLE public.historial_ventas
        ADD COLUMN IF NOT EXISTS folio TEXT
    `);
    await client.query(`
        ALTER TABLE public.historial_ventas
        ADD COLUMN IF NOT EXISTS folio_numero INTEGER
    `);
    await client.query(`
        ALTER TABLE public.historial_ventas
        ADD COLUMN IF NOT EXISTS turno_id INTEGER
    `);
    await client.query(`
        ALTER TABLE public.historial_ventas
        ADD COLUMN IF NOT EXISTS cajero_usuario TEXT
    `);
    await client.query(`
        ALTER TABLE public.historial_ventas
        ADD COLUMN IF NOT EXISTS cajero_nombre TEXT
    `);
    await client.query(`
        ALTER TABLE public.historial_ventas
        ADD COLUMN IF NOT EXISTS cliente_nombre TEXT
    `);
    await client.query(`
        ALTER TABLE public.historial_ventas
        ADD COLUMN IF NOT EXISTS estado TEXT NOT NULL DEFAULT 'completada'
    `);
    await client.query(`
        ALTER TABLE public.ventas
        ADD COLUMN IF NOT EXISTS folio TEXT
    `);
    await client.query(`
        ALTER TABLE public.ventas
        ADD COLUMN IF NOT EXISTS folio_numero INTEGER
    `);
    await client.query(`
        ALTER TABLE public.ventas
        ADD COLUMN IF NOT EXISTS turno_id INTEGER
    `);
    await client.query(`
        ALTER TABLE public.ventas
        ADD COLUMN IF NOT EXISTS estado TEXT NOT NULL DEFAULT 'completada'
    `);
    await client.query(`
        WITH maximos AS (
            SELECT negocio_id, COALESCE(MAX(folio_numero), 0) AS base
            FROM public.historial_ventas
            WHERE folio_numero IS NOT NULL
            GROUP BY negocio_id
        ),
        numeradas AS (
            SELECT
                h.id,
                COALESCE(m.base, 0) +
                ROW_NUMBER() OVER (PARTITION BY h.negocio_id ORDER BY h.fecha ASC, h.id ASC) AS numero
            FROM public.historial_ventas h
            LEFT JOIN maximos m ON m.negocio_id = h.negocio_id
            WHERE h.folio IS NULL
        )
        UPDATE public.historial_ventas h
        SET
            folio_numero = numeradas.numero,
            folio = 'V-' || LPAD(numeradas.numero::text, 6, '0')
        FROM numeradas
        WHERE h.id = numeradas.id
    `);
    await client.query(`
        UPDATE public.ventas v
        SET
            folio = h.folio,
            folio_numero = h.folio_numero
        FROM public.historial_ventas h
        WHERE h.venta_id = v.id
        AND v.negocio_id = h.negocio_id
        AND v.folio IS NULL
    `);
    await client.query(`
        INSERT INTO public.folio_contadores (negocio_id, tipo, ultimo_numero, updated_at)
        SELECT negocio_id, 'venta', COALESCE(MAX(folio_numero), 0), NOW()
        FROM public.historial_ventas
        GROUP BY negocio_id
        ON CONFLICT (negocio_id, tipo)
        DO UPDATE SET
            ultimo_numero = GREATEST(public.folio_contadores.ultimo_numero, EXCLUDED.ultimo_numero),
            updated_at = NOW()
    `);
    await client.query(`
        CREATE UNIQUE INDEX IF NOT EXISTS idx_historial_ventas_negocio_folio
        ON public.historial_ventas (negocio_id, folio)
        WHERE folio IS NOT NULL
    `);
    await client.query(`
        CREATE TABLE IF NOT EXISTS public.comprobantes_venta (
            id SERIAL PRIMARY KEY,
            negocio_id INTEGER NOT NULL REFERENCES public.negocios(id) ON DELETE CASCADE,
            venta_id INTEGER,
            historial_id INTEGER NOT NULL REFERENCES public.historial_ventas(id) ON DELETE CASCADE,
            folio TEXT NOT NULL,
            tipo TEXT NOT NULL DEFAULT 'nota',
            cliente_nombre TEXT,
            obra TEXT,
            observaciones TEXT,
            subtotal_original NUMERIC(12,2) NOT NULL DEFAULT 0,
            total_original NUMERIC(12,2) NOT NULL DEFAULT 0,
            total_mostrado NUMERIC(12,2) NOT NULL DEFAULT 0,
            motivo_ajuste TEXT,
            autorizado_por TEXT,
            creado_por TEXT,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
    `);
    await client.query(`
        CREATE TABLE IF NOT EXISTS public.bitacora_comprobantes (
            id SERIAL PRIMARY KEY,
            negocio_id INTEGER NOT NULL REFERENCES public.negocios(id) ON DELETE CASCADE,
            comprobante_id INTEGER REFERENCES public.comprobantes_venta(id) ON DELETE SET NULL,
            historial_id INTEGER NOT NULL REFERENCES public.historial_ventas(id) ON DELETE CASCADE,
            folio TEXT NOT NULL,
            usuario_autorizo TEXT NOT NULL,
            total_original NUMERIC(12,2) NOT NULL DEFAULT 0,
            total_mostrado NUMERIC(12,2) NOT NULL DEFAULT 0,
            motivo TEXT NOT NULL DEFAULT '',
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
    `);
}

async function siguienteFolioVenta(client, negocioId) {
    const resultado = await client.query(
        `
        INSERT INTO public.folio_contadores (negocio_id, tipo, ultimo_numero, updated_at)
        VALUES ($1, 'venta', 1, NOW())
        ON CONFLICT (negocio_id, tipo)
        DO UPDATE SET
            ultimo_numero = public.folio_contadores.ultimo_numero + 1,
            updated_at = NOW()
        RETURNING ultimo_numero
        `,
        [negocioId]
    );

    const numero = Number(resultado.rows[0]?.ultimo_numero || 1);
    return {
        numero,
        folio: `V-${String(numero).padStart(6, "0")}`
    };
}

async function turnoActivoVenta(client, negocioId) {
    const resultado = await client.query(
        `
        SELECT id, usuario
        FROM public.turnos_caja
        WHERE negocio_id = $1
        AND estado = 'abierto'
        ORDER BY abierto_at DESC
        LIMIT 1
        `,
        [negocioId]
    );

    return resultado.rows[0] || null;
}

async function validarPinAdministrador(client, negocioId, pin) {
    const limpio = String(pin || "").trim();
    if (!limpio) return null;

    const resultado = await client.query(
        `
        SELECT usuario, rol
        FROM public.usuarios
        WHERE negocio_id = $1
        AND password = $2
        AND rol = 'Administrador'
        LIMIT 1
        `,
        [negocioId, limpio]
    );

    return resultado.rows[0] || null;
}

async function asegurarColumnasMovimientosCredito(client = pool) {
    await client.query(`
        ALTER TABLE public.movimientos_credito
        ADD COLUMN IF NOT EXISTS subtotal NUMERIC(12,2) NOT NULL DEFAULT 0
    `);
    await client.query(`
        ALTER TABLE public.movimientos_credito
        ADD COLUMN IF NOT EXISTS descuento NUMERIC(12,2) NOT NULL DEFAULT 0
    `);
    await client.query(`
        ALTER TABLE public.movimientos_credito
        ADD COLUMN IF NOT EXISTS descuento_tipo TEXT NOT NULL DEFAULT 'ninguno'
    `);
    await client.query(`
        ALTER TABLE public.movimientos_credito
        ADD COLUMN IF NOT EXISTS descuento_valor NUMERIC(12,2) NOT NULL DEFAULT 0
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

async function descontarStockVentaProducto(client, negocioId, productoVenta = {}) {
    const productoId =
        Number(productoVenta.id || productoVenta.productoId || 0);
    const cantidad =
        Number(productoVenta.cantidad || 1);

    if (!productoId || !Number.isFinite(cantidad) || cantidad <= 0) {
        return;
    }

    const modoVenta =
        productoVenta.modoVenta === "pieza" ? "pieza" : "bolsa";

    if (modoVenta !== "pieza") {
        await client.query(
            `
            UPDATE public.productos
            SET stock = stock - $1
            WHERE id = $2
            AND negocio_id = $3
            `,
            [cantidad, productoId, negocioId]
        );
        return;
    }

    // Venta por pieza suelta: si no alcanzan las piezas sueltas en existencia,
    // se abren bolsas cerradas automaticamente (sin interrumpir al cajero) para
    // completar la venta, hasta donde alcancen las bolsas disponibles.
    const actual = await client.query(
        `
        SELECT stock, piezas_sueltas_stock, piezas_por_bolsa
        FROM public.productos
        WHERE id = $1
        AND negocio_id = $2
        `,
        [productoId, negocioId]
    );

    const fila = actual.rows[0];

    if (!fila) return;

    const piezasActuales =
        Number(fila.piezas_sueltas_stock || 0);
    const bolsasActuales =
        Number(fila.stock || 0);
    const piezasPorBolsa =
        Number(fila.piezas_por_bolsa || 0);

    let nuevasBolsas = bolsasActuales;
    let nuevasPiezas = piezasActuales - cantidad;

    if (piezasActuales < cantidad && piezasPorBolsa > 0) {
        const faltante = cantidad - piezasActuales;
        const bolsasNecesarias = Math.ceil(faltante / piezasPorBolsa);
        const bolsasAAbrir = Math.min(bolsasNecesarias, Math.max(0, bolsasActuales));

        nuevasBolsas = bolsasActuales - bolsasAAbrir;
        nuevasPiezas = piezasActuales + (bolsasAAbrir * piezasPorBolsa) - cantidad;
    }

    await client.query(
        `
        UPDATE public.productos
        SET stock = $1,
            piezas_sueltas_stock = $2
        WHERE id = $3
        AND negocio_id = $4
        `,
        [nuevasBolsas, nuevasPiezas, productoId, negocioId]
    );
}

async function descontarInventarioPorProductos(client, negocioId, productos = []) {
    for (const producto of productos) {
        await descontarStockVentaProducto(client, negocioId, producto);
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
    const folioVenta = await siguienteFolioVenta(client, negocio.id);
    const turno = await turnoActivoVenta(client, negocio.id);

    const ventaCreada = await client.query(
        `
        INSERT INTO public.ventas(negocio_id, total, folio, folio_numero, turno_id, estado)
        VALUES($1, $2, $3, $4, $5, 'completada')
        RETURNING id, fecha, folio
        `,
        [negocio.id, total, folioVenta.folio, folioVenta.numero, turno?.id || null]
    );

    const historialCreado = await client.query(
        `
        INSERT INTO public.historial_ventas
            (negocio_id, venta_id, folio, folio_numero, turno_id, total, subtotal, descuento, descuento_tipo, descuento_valor, cliente_id, cliente_nombre, cajero_usuario, cajero_nombre, productos, metodo_pago, pago_efectivo, pago_tarjeta, pago_transferencia, pago_credito, pago_recibido, cambio, pagos_json, estado)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15::jsonb,$16,$17,$18,$19,$20,$21,$22,$23::jsonb,'completada')
        RETURNING id, fecha, folio
        `,
        [
            negocio.id,
            ventaCreada.rows[0]?.id || null,
            folioVenta.folio,
            folioVenta.numero,
            turno?.id || null,
            total,
            numeroSync(payload?.subtotal, total),
            numeroSync(payload?.descuento, 0),
            payload?.descuentoTipo || "ninguno",
            numeroSync(payload?.descuentoValor, 0),
            payload?.clienteId ? Number(payload.clienteId) : null,
            payload?.clienteNombre || null,
            payload?.cajeroUsuario || null,
            payload?.cajeroNombre || turno?.usuario || null,
            JSON.stringify(productosEvento(payload)),
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
        folio: folioVenta.folio,
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

        const fotos = await pool.query(
            `SELECT codigo, actualizado_at FROM public.fotos_producto WHERE negocio_id = $1`,
            [negocio.id]
        );

        const mapaFotos = new Map(
            fotos.rows.map(fila => [fila.codigo, fila.actualizado_at])
        );

        const productosConFoto = resultado.rows.map(producto => {
            const candidatos = [
                normalizarCodigoFoto(producto.codigo),
                ...(Array.isArray(producto.codigos_relacionados)
                    ? producto.codigos_relacionados.map(item => normalizarCodigoFoto(item.codigo))
                    : [])
            ];

            const codigoConFoto = candidatos.find(candidato => candidato && mapaFotos.has(candidato));

            if (!codigoConFoto) {
                return { ...producto, imagenUrl: null, fotoCodigo: null };
            }

            const version = new Date(mapaFotos.get(codigoConFoto)).getTime();

            return {
                ...producto,
                imagenUrl: `/fotos-producto/${codigoConFoto}/principal?negocio=${negocio.slug}&v=${version}`,
                fotoCodigo: codigoConFoto
            };
        });

        res.json(productosConFoto);

    } catch (error) {
        console.log(error);

        res.status(500).json({
            error: error.message,
            detail: error.detail || null,
            code: error.code || null
        });
    }
});

app.post("/fotos-producto/importar-lote", manejarSubidaFotosProducto, async (req, res) => {
    const archivos = req.files || [];

    try {
        const negocio = await negocioActual(req);

        if (archivos.length === 0) {
            res.status(400).json({ ok: false, error: "No se recibio ningun archivo .zip" });
            return;
        }

        const resumen = { zipsProcesados: 0, fotosGuardadas: 0, errores: [] };

        for (const archivo of archivos) {
            const resultadoZip = await procesarZipFotosProducto(archivo.path, negocio.id);
            resumen.zipsProcesados += 1;
            resumen.fotosGuardadas += resultadoZip.fotosGuardadas;
            if (resultadoZip.errores.length) {
                resumen.errores.push(`${archivo.originalname}: ${resultadoZip.errores.join("; ")}`);
            }
        }

        res.json({ ok: true, ...resumen });
    } catch (error) {
        res.status(500).json({ ok: false, error: error.message });
    } finally {
        for (const archivo of archivos) {
            fs.unlink(archivo.path, () => {});
        }
    }
});

app.post("/fotos-producto/:codigo/principal", async (req, res) => {
    try {
        const negocio = await negocioActual(req);
        const codigo = normalizarCodigoFoto(req.params.codigo);
        const imagenBase64 = String(req.body?.imagenBase64 || "");

        if (!codigo || !imagenBase64) {
            res.status(400).json({ ok: false, error: "Falta codigo o imagen" });
            return;
        }

        const base64Limpio = imagenBase64.replace(/^data:image\/\w+;base64,/, "");
        const bufferOriginal = Buffer.from(base64Limpio, "base64");
        const bufferComprimido = await comprimirImagen(bufferOriginal, 320);

        await pool.query(
            `
            INSERT INTO public.fotos_producto (negocio_id, codigo, imagen_principal, imagen_principal_tipo, actualizado_at)
            VALUES ($1, $2, $3, 'image/jpeg', NOW())
            ON CONFLICT (negocio_id, codigo)
            DO UPDATE SET imagen_principal = $3, imagen_principal_tipo = 'image/jpeg', actualizado_at = NOW()
            `,
            [negocio.id, codigo, bufferComprimido]
        );

        res.json({ ok: true, codigo });
    } catch (error) {
        res.status(500).json({ ok: false, error: error.message });
    }
});

app.get("/fotos-producto/:codigo/principal", async (req, res) => {
    try {
        const negocio = await negocioActual(req);
        const codigo = normalizarCodigoFoto(req.params.codigo);

        const resultado = await pool.query(
            `SELECT imagen_principal, imagen_principal_tipo FROM public.fotos_producto WHERE negocio_id = $1 AND codigo = $2`,
            [negocio.id, codigo]
        );

        const fila = resultado.rows[0];

        if (!fila) {
            res.status(404).end();
            return;
        }

        res.set("Content-Type", fila.imagen_principal_tipo || "image/jpeg");
        res.set("Cache-Control", "public, max-age=2592000, immutable");
        res.send(fila.imagen_principal);
    } catch (error) {
        res.status(500).json({ ok: false, error: error.message });
    }
});

app.get("/fotos-producto/:codigo/galeria", async (req, res) => {
    try {
        const negocio = await negocioActual(req);
        const codigo = normalizarCodigoFoto(req.params.codigo);

        const resultado = await pool.query(
            `
            SELECT fg.id, fg.orden
            FROM public.fotos_producto_galeria fg
            JOIN public.fotos_producto fp ON fp.id = fg.foto_producto_id
            WHERE fp.negocio_id = $1 AND fp.codigo = $2
            ORDER BY fg.orden ASC
            `,
            [negocio.id, codigo]
        );

        res.json({
            ok: true,
            imagenes: resultado.rows.map(fila => ({
                id: fila.id,
                url: `/fotos-producto-galeria/${fila.id}?negocio=${negocio.slug}`
            }))
        });
    } catch (error) {
        res.status(500).json({ ok: false, error: error.message });
    }
});

app.get("/fotos-producto-galeria/:id", async (req, res) => {
    try {
        const negocio = await negocioActual(req);
        const id = Number(req.params.id);

        const resultado = await pool.query(
            `
            SELECT fg.imagen, fg.tipo
            FROM public.fotos_producto_galeria fg
            JOIN public.fotos_producto fp ON fp.id = fg.foto_producto_id
            WHERE fg.id = $1 AND fp.negocio_id = $2
            `,
            [id, negocio.id]
        );

        const fila = resultado.rows[0];

        if (!fila) {
            res.status(404).end();
            return;
        }

        res.set("Content-Type", fila.tipo || "image/jpeg");
        res.set("Cache-Control", "public, max-age=2592000, immutable");
        res.send(fila.imagen);
    } catch (error) {
        res.status(500).json({ ok: false, error: error.message });
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
    codigosRelacionados,
    permiteVentaPieza,
    piezasPorBolsa,
    precioPieza
} = req.body;
    try {
        const negocio = await negocioActual(req);

        if (!(await exigirLicenciaActiva(res, negocio, "agregar un producto"))) return;

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
  bascula_digital,
  permite_venta_pieza,
  piezas_por_bolsa,
  precio_pieza
)
VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24)
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
  basculaDigital || "no",
  permiteVentaPieza === true || permiteVentaPieza === "true",
  piezasPorBolsa || null,
  precioPieza || null
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
                codigos_relacionados: codigosRelacionados || [],
                permite_venta_pieza: permiteVentaPieza === true || permiteVentaPieza === "true",
                piezas_por_bolsa: piezasPorBolsa || null,
                precio_pieza: precioPieza || null
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
        codigosRelacionados,
        permiteVentaPieza,
        piezasPorBolsa,
        precioPieza
    } = req.body;

    try {
        const negocio = await negocioActual(req);

        if (!(await exigirLicenciaActiva(res, negocio, "guardar productos"))) return;

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
                bascula_digital = $20,
                permite_venta_pieza = $21,
                piezas_por_bolsa = $22,
                precio_pieza = $23
            WHERE id = $24
            AND negocio_id = $25
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
                permiteVentaPieza === true || permiteVentaPieza === "true",
                piezasPorBolsa || null,
                precioPieza || null,
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
                codigos_relacionados: codigosRelacionados || [],
                permite_venta_pieza: permiteVentaPieza === true || permiteVentaPieza === "true",
                piezas_por_bolsa: piezasPorBolsa || null,
                precio_pieza: precioPieza || null
            }
        });

    } catch (error) {

        res.status(500).json({
            error: "Error editar"
        });
    }
});

app.get("/reglas-precios", async (req, res) => {
    try {
        const negocio = await negocioActual(req);

        const resultado = await pool.query(
            `
            SELECT
                proveedor,
                margen_general,
                redondeo,
                margenes_categoria,
                margenes_producto,
                actualizado_at
            FROM public.reglas_precios_proveedor
            WHERE negocio_id = $1
            ORDER BY proveedor ASC
            `,
            [negocio.id]
        );

        res.json({ reglas: resultado.rows });
    } catch (error) {
        console.log(error);

        res.status(500).json({
            error: "Error al leer reglas de precio"
        });
    }
});

app.get("/reglas-precios/:proveedor", async (req, res) => {
    try {
        const negocio = await negocioActual(req);

        const resultado = await pool.query(
            `
            SELECT
                proveedor,
                margen_general,
                redondeo,
                margenes_categoria,
                margenes_producto,
                actualizado_at
            FROM public.reglas_precios_proveedor
            WHERE negocio_id = $1
            AND proveedor = $2
            `,
            [negocio.id, req.params.proveedor]
        );

        res.json({ regla: resultado.rows[0] || null });
    } catch (error) {
        console.log(error);

        res.status(500).json({
            error: "Error al leer reglas de precio"
        });
    }
});

app.post("/reglas-precios", async (req, res) => {
    const {
        proveedor,
        margenGeneral,
        redondeo,
        margenesCategoria,
        margenesProducto
    } = req.body;

    if (!proveedor) {
        res.status(400).json({ error: "Falta el proveedor" });
        return;
    }

    try {
        const negocio = await negocioActual(req);

        const resultado = await pool.query(
            `
            INSERT INTO public.reglas_precios_proveedor
                (negocio_id, proveedor, margen_general, redondeo, margenes_categoria, margenes_producto, actualizado_at)
            VALUES ($1, $2, $3, $4, $5, $6, NOW())
            ON CONFLICT (negocio_id, proveedor)
            DO UPDATE SET
                margen_general = EXCLUDED.margen_general,
                redondeo = EXCLUDED.redondeo,
                margenes_categoria = EXCLUDED.margenes_categoria,
                margenes_producto = EXCLUDED.margenes_producto,
                actualizado_at = NOW()
            RETURNING proveedor, margen_general, redondeo, margenes_categoria, margenes_producto, actualizado_at
            `,
            [
                negocio.id,
                proveedor,
                margenGeneral === "" || margenGeneral === undefined ? null : margenGeneral,
                redondeo || "ninguno",
                JSON.stringify(margenesCategoria || {}),
                JSON.stringify(margenesProducto || {})
            ]
        );

        res.json({ success: true, regla: resultado.rows[0] });
    } catch (error) {
        console.log(error);

        res.status(500).json({
            error: "Error al guardar reglas de precio"
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
            AND negocio_id = $2
            `,
            [usuario, negocio.id]
        );

        const fila =
        resultado.rows[0];

        let exito = false;

        if (fila) {
            if (fila.password_hash) {
                exito = verificarPassword(password, fila.password_hash);
            } else if (fila.password && String(password) === fila.password) {
                exito = true;

                await pool.query(
                    `
                    UPDATE public.usuarios
                    SET password_hash = $1
                    WHERE id = $2
                    `,
                    [hashPassword(password), fila.id]
                );
            }
        }

        res.json({
            success: exito
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
        subtotal,
        descuento,
        descuentoTipo,
        descuentoValor,
        clienteId,
        productos,
        metodoPago,
        pagos,
        recibido,
        cambio,
        cajeroUsuario,
        cajeroNombre,
        clienteNombre
    } = req.body;
    const pagosVenta = pagos || {};
    const pagoEfectivo = Number(pagosVenta.efectivo || 0);
    const pagoTarjeta = Number(pagosVenta.tarjeta || 0);
    const pagoTransferencia = Number(pagosVenta.transferencia || 0);
    const pagoCredito = Number(pagosVenta.credito || 0);

    let negocioVenta;

    try {
        negocioVenta = await negocioActual(req);
    } catch (error) {
        res.status(500).json({ ok: false, error: error.message });
        return;
    }

    if (!(await exigirLicenciaActiva(res, negocioVenta, "una venta"))) return;

    const client = await pool.connect();

    try {
        const negocio = negocioVenta;

        await asegurarColumnasHistorialVentas(client);
        await client.query("BEGIN");

        const folioVenta = await siguienteFolioVenta(client, negocio.id);
        const turno = await turnoActivoVenta(client, negocio.id);
        const ventaCreada = await client.query(
            `
            INSERT INTO public.ventas(negocio_id, total, folio, folio_numero, turno_id, estado)
            VALUES($1, $2, $3, $4, $5, 'completada')
            RETURNING id, fecha, folio
            `,
            [negocio.id, total, folioVenta.folio, folioVenta.numero, turno?.id || null]
        );

        const historialCreado = await client.query(
            `
            INSERT INTO public.historial_ventas
                (negocio_id, venta_id, folio, folio_numero, turno_id, total, subtotal, descuento, descuento_tipo, descuento_valor, cliente_id, cliente_nombre, cajero_usuario, cajero_nombre, productos, metodo_pago, pago_efectivo, pago_tarjeta, pago_transferencia, pago_credito, pago_recibido, cambio, pagos_json, estado)
            VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15::jsonb,$16,$17,$18,$19,$20,$21,$22,$23::jsonb,'completada')
            RETURNING id, fecha, folio
            `,
            [
                negocio.id,
                ventaCreada.rows[0]?.id || null,
                folioVenta.folio,
                folioVenta.numero,
                turno?.id || null,
                Number(total || 0),
                Number(subtotal ?? total ?? 0),
                Number(descuento || 0),
                descuentoTipo || "ninguno",
                Number(descuentoValor || 0),
                clienteId ? Number(clienteId) : null,
                clienteNombre || null,
                cajeroUsuario || null,
                cajeroNombre || turno?.usuario || null,
                JSON.stringify(productos || []),
                metodoPago || "efectivo",
                pagoEfectivo,
                pagoTarjeta,
                pagoTransferencia,
                pagoCredito,
                Number(recibido || 0),
                Number(cambio || 0),
                JSON.stringify(pagosVenta)
            ]
        );

        for (const producto of productos || []) {
            await descontarStockVentaProducto(client, negocio.id, producto);
        }

        await client.query("COMMIT");

        res.json({
            success: true,
            folio: folioVenta.folio,
            folioNumero: folioVenta.numero,
            ventaId: ventaCreada.rows[0]?.id || null,
            historialId: historialCreado.rows[0]?.id || null,
            fecha: historialCreado.rows[0]?.fecha || ventaCreada.rows[0]?.fecha || null
        });

    } catch (error) {
        await client.query("ROLLBACK").catch(() => {});

        console.log("ERROR EN /ventas:", error);

        res.status(500).json({
            error: error.message,
            detail: error.detail || null,
            code: error.code || null
        });
    } finally {
        client.release();
    }
});

async function obtenerDetalleVenta(client, negocioId, filtro, valor) {
    await asegurarColumnasHistorialVentas(client);

    const columna = filtro === "folio" ? "h.folio" : "h.id";
    const resultado = await client.query(
        `
        SELECT
            h.*,
            COALESCE(h.cliente_nombre, c.nombre, 'Publico general') AS cliente_nombre_resuelto,
            c.telefono AS cliente_telefono,
            t.usuario AS turno_usuario,
            v.id AS venta_id_resuelto
        FROM public.historial_ventas h
        LEFT JOIN public.clientes_credito c
            ON c.id = h.cliente_id
            AND c.negocio_id = h.negocio_id
        LEFT JOIN public.turnos_caja t
            ON t.id = h.turno_id
            AND t.negocio_id = h.negocio_id
        LEFT JOIN public.ventas v
            ON v.id = h.venta_id
            AND v.negocio_id = h.negocio_id
        WHERE h.negocio_id = $1
        AND ${columna} = $2
        LIMIT 1
        `,
        [negocioId, valor]
    );

    if (!resultado.rows.length) return null;

    const venta = resultado.rows[0];
    const comprobantes = await client.query(
        `
        SELECT *
        FROM public.comprobantes_venta
        WHERE negocio_id = $1
        AND historial_id = $2
        ORDER BY created_at DESC
        `,
        [negocioId, venta.id]
    );

    const bitacora = await client.query(
        `
        SELECT *
        FROM public.bitacora_comprobantes
        WHERE negocio_id = $1
        AND historial_id = $2
        ORDER BY created_at DESC
        `,
        [negocioId, venta.id]
    );

    return {
        ...venta,
        cliente_nombre: venta.cliente_nombre_resuelto || venta.cliente_nombre || "Publico general",
        venta_id: venta.venta_id || venta.venta_id_resuelto,
        comprobantes: comprobantes.rows,
        bitacora: bitacora.rows
    };
}

app.get("/ventas/:id", async (req, res) => {
    try {
        const negocio = await negocioActual(req);
        const venta = await obtenerDetalleVenta(pool, negocio.id, "id", Number(req.params.id));

        if (!venta) {
            res.status(404).json({ ok: false, error: "Venta no encontrada" });
            return;
        }

        res.json({ ok: true, venta });
    } catch (error) {
        res.status(500).json({ ok: false, error: error.message });
    }
});

app.get("/ventas/folio/:folio", async (req, res) => {
    try {
        const negocio = await negocioActual(req);
        const venta = await obtenerDetalleVenta(pool, negocio.id, "folio", String(req.params.folio || ""));

        if (!venta) {
            res.status(404).json({ ok: false, error: "Venta no encontrada" });
            return;
        }

        res.json({ ok: true, venta });
    } catch (error) {
        res.status(500).json({ ok: false, error: error.message });
    }
});

app.post("/ventas/:id/comprobantes", async (req, res) => {
    const client = await pool.connect();

    try {
        const negocio = await negocioActual(req);
        const historialId = Number(req.params.id);
        const {
            tipo,
            clienteNombre,
            obra,
            observaciones,
            totalMostrado,
            motivoAjuste,
            adminPin,
            usuarioAutoriza,
            creadoPor,
            autorizacionLocal
        } = req.body || {};

        await asegurarColumnasHistorialVentas(client);
        await client.query("BEGIN");

        const venta = await obtenerDetalleVenta(client, negocio.id, "id", historialId);
        if (!venta) {
            throw new Error("Venta no encontrada");
        }

        const original = Number(venta.total || 0);
        const mostrado = Number.isFinite(Number(totalMostrado))
            ? Number(totalMostrado)
            : original;
        const requiereAutorizacion = Math.abs(mostrado - original) >= 0.01;
        let admin = null;

        if (requiereAutorizacion) {
            admin = await validarPinAdministrador(client, negocio.id, adminPin);
            if (!admin && autorizacionLocal !== true) {
                throw new Error("PIN de administrador invalido para ajustar la nota");
            }
            if (!String(motivoAjuste || "").trim()) {
                throw new Error("Captura el motivo del ajuste");
            }
        }

        const comprobante = await client.query(
            `
            INSERT INTO public.comprobantes_venta
                (negocio_id, venta_id, historial_id, folio, tipo, cliente_nombre, obra, observaciones, subtotal_original, total_original, total_mostrado, motivo_ajuste, autorizado_por, creado_por)
            VALUES
                ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
            RETURNING *
            `,
            [
                negocio.id,
                venta.venta_id || null,
                venta.id,
                venta.folio || `V-${String(venta.id).padStart(6, "0")}`,
                tipo || "nota",
                limpiarTexto(clienteNombre || venta.cliente_nombre || "Publico general", 180),
                limpiarTexto(obra, 180) || null,
                limpiarTexto(observaciones, 500) || null,
                Number(venta.subtotal || venta.total || 0),
                original,
                mostrado,
                requiereAutorizacion ? limpiarTexto(motivoAjuste, 500) : null,
                admin?.usuario || limpiarTexto(usuarioAutoriza, 120) || null,
                limpiarTexto(creadoPor, 120) || null
            ]
        );

        let bitacora = null;
        if (requiereAutorizacion) {
            const bit = await client.query(
                `
                INSERT INTO public.bitacora_comprobantes
                    (negocio_id, comprobante_id, historial_id, folio, usuario_autorizo, total_original, total_mostrado, motivo)
                VALUES
                    ($1,$2,$3,$4,$5,$6,$7,$8)
                RETURNING *
                `,
                [
                    negocio.id,
                    comprobante.rows[0].id,
                    venta.id,
                    venta.folio || comprobante.rows[0].folio,
                    admin?.usuario || limpiarTexto(usuarioAutoriza, 120) || "Administrador",
                    original,
                    mostrado,
                    limpiarTexto(motivoAjuste, 500)
                ]
            );
            bitacora = bit.rows[0];
        }

        await client.query("COMMIT");

        res.status(201).json({
            ok: true,
            comprobante: comprobante.rows[0],
            bitacora
        });
    } catch (error) {
        await client.query("ROLLBACK").catch(() => {});
        res.status(500).json({ ok: false, error: error.message });
    } finally {
        client.release();
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
                c.fecha_vencimiento,
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
                ) AS saldo,
                MAX(m.fecha) AS ultimo_movimiento
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

        const hoy = new Date().toISOString().slice(0, 10);

        const fechaVencimientoISO = valor =>
            valor instanceof Date
                ? valor.toISOString().slice(0, 10)
                : String(valor).slice(0, 10);

        const vencidos = clientes.rows.filter(cliente =>
            Number(cliente.saldo) > 0 &&
            cliente.fecha_vencimiento &&
            fechaVencimientoISO(cliente.fecha_vencimiento) < hoy
        );

        const pagosMes = await pool.query(`
            SELECT COALESCE(SUM(m.monto), 0) AS total
            FROM public.movimientos_credito m
            WHERE m.negocio_id = $1
            AND m.tipo = 'abono'
            AND date_trunc('month', m.fecha) = date_trunc('month', CURRENT_DATE)
        `, [negocio.id]);

        res.json({
            clientes: clientes.rows,
            total,
            clientesConAdeudo:
                clientes.rows.filter(
                    cliente => Number(cliente.saldo) > 0
                ).length,
            clientesVencidos: vencidos.length,
            totalVencido: vencidos.reduce((suma, cliente) => suma + Number(cliente.saldo), 0),
            pagosEsteMes: Number(pagosMes.rows[0].total)
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
        limiteCredito,
        fechaVencimiento
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
                limite_credito,
                fecha_vencimiento
            )
            VALUES ($1, $2, $3, $4, $5)
            RETURNING *
        `, [
            negocio.id,
            nombre,
            telefono || null,
            limiteCredito || 0,
            fechaVencimiento || null
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
        limiteCredito,
        fechaVencimiento
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
                limite_credito = $3,
                fecha_vencimiento = $4
            WHERE id = $5
            AND negocio_id = $6
            RETURNING *
        `, [
            nombre,
            telefono || "",
            Number(limiteCredito || 0),
            fechaVencimiento || null,
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
        const activo = String(req.query.estado || "activo") !== "baja";
        const resultado = await pool.query(`
            SELECT
                pr.*,
                COUNT(p.id) AS productos
            FROM public.proveedores pr
            LEFT JOIN public.productos p
                ON LOWER(COALESCE(p.proveedor, '')) = LOWER(pr.nombre)
                AND p.negocio_id = pr.negocio_id
            WHERE pr.activo = $2
            AND pr.negocio_id = $1
            GROUP BY pr.id
            ORDER BY pr.nombre ASC
        `, [negocio.id, activo]);

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

app.put("/proveedores/:id/activar", async (req, res) => {
    const { id } = req.params;

    try {
        const negocio = await negocioActual(req);
        const resultado = await pool.query(`
            UPDATE public.proveedores
            SET activo = true
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
        subtotal,
        descuento,
        descuentoTipo,
        descuentoValor,
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

        if (!(await exigirLicenciaActiva(res, negocio, "un cargo a credito"))) return;

        await asegurarColumnasMovimientosCredito();
        const resultado = await pool.query(`
            INSERT INTO public.movimientos_credito
            (
                negocio_id,
                cliente_id,
                tipo,
                referencia,
                concepto,
                monto,
                subtotal,
                descuento,
                descuento_tipo,
                descuento_valor,
                productos
            )
            SELECT $1, c.id, 'venta', $2, $3, $4, $5, $6, $7, $8, $9::jsonb
            FROM public.clientes_credito c
            WHERE c.id = $10
            AND c.negocio_id = $1
            RETURNING *
        `, [
            negocio.id,
            `CR-${Date.now()}`,
            concepto || "Venta a credito",
            monto,
            Number(subtotal ?? monto ?? 0),
            Number(descuento || 0),
            descuentoTipo || "ninguno",
            Number(descuentoValor || 0),
            JSON.stringify(productos || []),
            id
        ]);

        if (Array.isArray(productos)) {
            for (const producto of productos) {
                await descontarStockVentaProducto(pool, negocio.id, producto);
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
    await asegurarColumnasHistorialVentas();

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
        await asegurarColumnasHistorialVentas();
        const periodo =
            String(req.query.periodo || "mes");
        const desde =
            req.query.desde ? new Date(String(req.query.desde)) : null;
        const hasta =
            req.query.hasta ? new Date(String(req.query.hasta)) : null;
        const usarRango =
            desde && !Number.isNaN(desde.getTime()) &&
            hasta && !Number.isNaN(hasta.getTime());

        const filtroFecha =
            usarRango
                ? "AND fecha::date BETWEEN $2::date AND $3::date"
                : periodo === "dia"
                    ? "AND fecha >= CURRENT_DATE"
                    : periodo === "semana"
                        ? "AND fecha >= date_trunc('week', NOW())"
                        : periodo === "anio"
                            ? "AND fecha >= date_trunc('year', NOW())"
                            : "AND fecha >= date_trunc('month', NOW())";

        const params =
            usarRango
                ? [negocio.id, desde.toISOString().slice(0, 10), hasta.toISOString().slice(0, 10)]
                : [negocio.id];

        let filtroFechaAnterior;
        let paramsAnterior;

        if (usarRango) {
            const duracionDias = Math.max(1, Math.round((hasta.getTime() - desde.getTime()) / 86400000) + 1);
            const anteriorHasta = new Date(desde.getTime() - 86400000);
            const anteriorDesde = new Date(anteriorHasta.getTime() - (duracionDias - 1) * 86400000);
            filtroFechaAnterior = "AND fecha::date BETWEEN $2::date AND $3::date";
            paramsAnterior = [negocio.id, anteriorDesde.toISOString().slice(0, 10), anteriorHasta.toISOString().slice(0, 10)];
        } else if (periodo === "dia") {
            filtroFechaAnterior = "AND fecha >= CURRENT_DATE - INTERVAL '1 day' AND fecha < CURRENT_DATE";
            paramsAnterior = [negocio.id];
        } else if (periodo === "semana") {
            filtroFechaAnterior = "AND fecha >= date_trunc('week', NOW()) - INTERVAL '7 days' AND fecha < date_trunc('week', NOW())";
            paramsAnterior = [negocio.id];
        } else if (periodo === "anio") {
            filtroFechaAnterior = "AND fecha >= date_trunc('year', NOW()) - INTERVAL '1 year' AND fecha < date_trunc('year', NOW())";
            paramsAnterior = [negocio.id];
        } else {
            filtroFechaAnterior = "AND fecha >= date_trunc('month', NOW()) - INTERVAL '1 month' AND fecha < date_trunc('month', NOW())";
            paramsAnterior = [negocio.id];
        }

        const resumen = await pool.query(`
            SELECT
                COALESCE(SUM(total), 0) AS total,
                COUNT(*) AS transacciones,
                COALESCE(AVG(total), 0) AS ticket_promedio,
                COALESCE(MAX(total), 0) AS venta_mayor,
                COALESCE(SUM(descuento), 0) AS descuento_total
            FROM public.historial_ventas
            WHERE negocio_id = $1
            ${filtroFecha}
        `, params);

        const porDia = await pool.query(`
            SELECT
                TO_CHAR(fecha, 'DD/MM') AS dia,
                COALESCE(SUM(total), 0) AS total,
                COUNT(*) AS transacciones
            FROM public.historial_ventas
            WHERE negocio_id = $1
            ${filtroFecha}
            GROUP BY TO_CHAR(fecha, 'DD/MM'), DATE(fecha)
            ORDER BY DATE(fecha) ASC
            LIMIT 30
        `, params);

        const metodosPago = await pool.query(`
            SELECT metodo_pago, COALESCE(SUM(total), 0) AS total, COUNT(*) AS transacciones
            FROM public.historial_ventas
            WHERE negocio_id = $1
            ${filtroFecha}
            GROUP BY metodo_pago
            ORDER BY total DESC
        `, params);

        const porHora = await pool.query(`
            SELECT TO_CHAR(date_trunc('hour', fecha), 'HH24:00') AS hora,
                   COALESCE(SUM(total), 0) AS total,
                   COUNT(*) AS transacciones
            FROM public.historial_ventas
            WHERE negocio_id = $1
            ${filtroFecha}
            GROUP BY date_trunc('hour', fecha)
            ORDER BY date_trunc('hour', fecha)
        `, params);

        const productosVendidos = await pool.query(`
            SELECT
                item->>'nombre' AS nombre,
                COALESCE(SUM((item->>'cantidad')::numeric), 0) AS cantidad,
                COALESCE(SUM((item->>'importe')::numeric), 0) AS total
            FROM public.historial_ventas,
                 LATERAL jsonb_array_elements(productos) AS item
            WHERE negocio_id = $1
            ${filtroFecha}
            GROUP BY item->>'nombre'
            ORDER BY total DESC
            LIMIT 10
        `, params);

        const ultimas = await pool.query(`
            SELECT *
            FROM public.historial_ventas
            WHERE negocio_id = $1
            ${filtroFecha}
            ORDER BY fecha DESC
            LIMIT 12
        `, params);

        const productosVendidosTotal = await pool.query(`
            SELECT COALESCE(SUM((item->>'cantidad')::numeric), 0) AS cantidad
            FROM public.historial_ventas,
                 LATERAL jsonb_array_elements(productos) AS item
            WHERE negocio_id = $1
            ${filtroFecha}
        `, params);

        const ventasPorCategoria = await pool.query(`
            SELECT
                COALESCE(NULLIF(p.categoria, ''), 'Sin categoria') AS categoria,
                COALESCE(SUM((item->>'importe')::numeric), 0) AS total
            FROM public.historial_ventas
            CROSS JOIN LATERAL jsonb_array_elements(productos) AS item
            LEFT JOIN public.productos p
                ON p.id = NULLIF(item->>'id', '')::integer
                AND p.negocio_id = historial_ventas.negocio_id
            WHERE historial_ventas.negocio_id = $1
            ${filtroFecha}
            GROUP BY 1
            ORDER BY total DESC
            LIMIT 8
        `, params);

        const resumenAnterior = await pool.query(`
            SELECT
                COALESCE(SUM(total), 0) AS total,
                COUNT(*) AS transacciones,
                COALESCE(AVG(total), 0) AS ticket_promedio
            FROM public.historial_ventas
            WHERE negocio_id = $1
            ${filtroFechaAnterior}
        `, paramsAnterior);

        const productosVendidosTotalAnterior = await pool.query(`
            SELECT COALESCE(SUM((item->>'cantidad')::numeric), 0) AS cantidad
            FROM public.historial_ventas,
                 LATERAL jsonb_array_elements(productos) AS item
            WHERE negocio_id = $1
            ${filtroFechaAnterior}
        `, paramsAnterior);

        res.json({
            resumen: {
                ...resumen.rows[0],
                productos_vendidos: productosVendidosTotal.rows[0]?.cantidad || 0
            },
            resumenAnterior: {
                ...resumenAnterior.rows[0],
                productos_vendidos: productosVendidosTotalAnterior.rows[0]?.cantidad || 0
            },
            porDia: porDia.rows,
            metodosPago: metodosPago.rows,
            porHora: porHora.rows,
            productosVendidos: productosVendidos.rows,
            ventasPorCategoria: ventasPorCategoria.rows,
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
        ALTER TABLE public.licencias
        ADD COLUMN IF NOT EXISTS license_key TEXT
    `);

    await pool.query(`
        ALTER TABLE public.licencias
        ADD COLUMN IF NOT EXISTS activated_at TIMESTAMPTZ
    `);

    await pool.query(`
        CREATE UNIQUE INDEX IF NOT EXISTS idx_licencias_license_key_unique
        ON public.licencias (license_key)
        WHERE license_key IS NOT NULL
    `);

    await pool.query(`
        UPDATE public.licencias
        SET license_key = 'NXP-' || upper(substr(md5(negocio_id::text || '-' || id::text || '-' || created_at::text), 1, 6)) || '-' ||
                          upper(substr(md5(id::text || '-' || negocio_id::text), 1, 6)) || '-' ||
                          upper(substr(md5(created_at::text || '-' || id::text), 1, 6))
        WHERE license_key IS NULL
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
        ALTER TABLE public.dispositivos
        ADD COLUMN IF NOT EXISTS os_version TEXT
    `);

    await pool.query(`
        ALTER TABLE public.dispositivos
        ADD COLUMN IF NOT EXISTS arch TEXT
    `);

    await pool.query(`
        ALTER TABLE public.dispositivos
        ADD COLUMN IF NOT EXISTS installed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    `);

    await pool.query(`
        ALTER TABLE public.dispositivos
        ADD COLUMN IF NOT EXISTS last_sync_at TIMESTAMPTZ
    `);

    await pool.query(`
        ALTER TABLE public.dispositivos
        ADD COLUMN IF NOT EXISTS update_latest_version TEXT
    `);

    await pool.query(`
        ALTER TABLE public.dispositivos
        ADD COLUMN IF NOT EXISTS update_available BOOLEAN NOT NULL DEFAULT false
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
        ALTER TABLE public.app_versiones
        ADD COLUMN IF NOT EXISTS archivo TEXT
    `);

    await pool.query(`
        ALTER TABLE public.app_versiones
        ADD COLUMN IF NOT EXISTS sha512 TEXT
    `);

    await pool.query(`
        ALTER TABLE public.app_versiones
        ADD COLUMN IF NOT EXISTS tamano_bytes BIGINT
    `);

    await pool.query(
        `
        INSERT INTO public.app_versiones
            (version, canal, plataforma, url_descarga, archivo, notas, obligatoria, publicada)
        VALUES
            ($1, 'stable', 'windows', 'https://github.com/rgus234/ferreteria-pos/releases/download/v' || $1 || '/NexoPOS_Setup_' || $1 || '.exe', 'NexoPOS_Setup_' || $1 || '.exe', 'Version base estable para primer cliente', false, true)
        ON CONFLICT (version, canal, plataforma)
        DO UPDATE SET
            url_descarga = COALESCE(public.app_versiones.url_descarga, EXCLUDED.url_descarga),
            archivo = COALESCE(public.app_versiones.archivo, EXCLUDED.archivo),
            publicada = true
        `,
        [config.appVersion]
    );

    // Version anterior a esta sesion apuntaba a /downloads/ (servido desde public/,
    // que nunca llega a produccion porque el instalador supera el limite de Git).
    // Se corrige para que apunte al release real en GitHub.
    await pool.query(
        `
        UPDATE public.app_versiones
        SET url_descarga = 'https://github.com/rgus234/ferreteria-pos/releases/download/v' || version || '/' || archivo
        WHERE url_descarga LIKE '/downloads/%'
        AND archivo IS NOT NULL
        `
    );

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
        INSERT INTO public.usuarios (negocio_id, usuario, password_hash, rol)
        SELECT id, 'admin', $2, 'Administrador'
        FROM public.negocios
        WHERE slug = $1
        AND NOT EXISTS (
            SELECT 1
            FROM public.usuarios
            WHERE negocio_id = public.negocios.id
            AND usuario = 'admin'
        )
        `,
        [DEFAULT_NEGOCIO_SLUG, hashPassword("1234")]
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
                )::text[] = ARRAY['usuario']::text[]
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
        CREATE TABLE IF NOT EXISTS public.reglas_precios_proveedor (
            id SERIAL PRIMARY KEY,
            negocio_id INTEGER NOT NULL REFERENCES public.negocios(id),
            proveedor TEXT NOT NULL,
            margen_general NUMERIC(6,2),
            redondeo TEXT NOT NULL DEFAULT 'ninguno',
            margenes_categoria JSONB NOT NULL DEFAULT '{}'::jsonb,
            margenes_producto JSONB NOT NULL DEFAULT '{}'::jsonb,
            actualizado_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            UNIQUE(negocio_id, proveedor)
        )
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
        ALTER TABLE public.clientes_credito
        ADD COLUMN IF NOT EXISTS fecha_vencimiento DATE
    `);

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

    await asegurarColumnasMovimientosCredito();

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
cargarModulosPOS({
    app,
    pool,
    normalizarCodigo,
});

async function migrarPasswordsUsuariosPlano() {
    const pendientes = await pool.query(
        `
        SELECT id, password
        FROM public.usuarios
        WHERE password_hash IS NULL
        AND password IS NOT NULL
        `
    );

    for (const fila of pendientes.rows) {
        await pool.query(
            `
            UPDATE public.usuarios
            SET password_hash = $1
            WHERE id = $2
            `,
            [hashPassword(fila.password), fila.id]
        );
    }

    if (pendientes.rows.length > 0) {
        console.log(`Migradas ${pendientes.rows.length} contrasenas a hash`);
    }
}

inicializarCreditos()
    .then(() => migrarPasswordsUsuariosPlano())
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
