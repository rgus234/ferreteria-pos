// Respaldo automatico diario de la base de datos completa. El esquema
// ya vive versionado en migrations/*.sql -- lo unico que hace falta
// respaldar es la data. Cada tabla se dumpea completa a JSON, se
// comprime con gzip (sin pg_dump -- no esta disponible en el runtime
// de Render) y se manda por correo (via Resend, ya configurado) al
// operador de la plataforma. Nunca falla en silencio: exito, aviso de
// tamano y error quedan siempre registrados en respaldos_automaticos.

const zlib = require("zlib");
const { config } = require("./config");
const { enviarCorreoRespaldo } = require("./email");
const { responderError } = require("./error-utils");

// Mismo orden que information_schema.tables al momento de escribir
// este modulo. Lista fija a proposito (sin introspeccion dinamica) --
// si se agrega una tabla nueva al esquema, hay que sumarla aqui.
//
// "fotos_producto" y "fotos_producto_galeria" se excluyen a proposito:
// guardan las imagenes de producto como bytea directo en la columna
// (no una URL a almacenamiento externo) y juntas pesan ~160MB de los
// ~189MB totales de la base -- no caben en un correo sin importar la
// compresion, y JSON.stringify de un Buffer de Node los infla ademas
// ~4-5x (los serializa como arreglo de numeros, no base64). Este
// mecanismo cubre la data transaccional real (ventas, creditos,
// clientes, productos, etc.); las fotos quedan fuera de alcance hasta
// que se resuelva un respaldo aparte con almacenamiento externo (ver
// "Fuera de alcance" del plan).
const TABLAS_A_RESPALDAR = [
    "ajustes_inventario", "app_versiones", "bitacora_comprobantes",
    "catalogo_funciones", "catalogo_productos", "catalogos_proveedor",
    "categorias_funcion", "clientes_credito", "comprobantes_venta",
    "cotizaciones_pendientes", "cotizaciones_pendientes_items",
    "cuentas_pagar", "dispositivos", "dispositivos_vinculados",
    "empleados", "folio_contadores",
    "gastos_operativos", "historial_ventas",
    "intentos_login", "licencias", "movimientos_caja",
    "movimientos_credito", "negocios", "pagos_proveedor",
    "pedidos_proveedor", "pedidos_proveedor_items", "plan_funciones",
    "planes", "plantillas_catalogo", "producto_codigos", "productos",
    "proveedores", "recepciones_mercancia", "recepciones_mercancia_items",
    "reglas_precios_proveedor", "restablecimientos_password",
    "sesiones_cuenta", "stripe_webhook_events", "sync_eventos",
    "tenant_auto_provision_log", "turnos_caja", "usuarios", "ventas",
    "verificaciones_correo"
];

const LIMITE_ADJUNTO_BYTES = 35 * 1024 * 1024; // margen bajo el limite de 40MB de Resend
const INTERVALO_REVISION_MS = 60 * 60 * 1000; // revisa cada hora si ya corrio hoy

// Convierte cualquier columna bytea (Buffer en node-pg) a base64 antes
// de JSON.stringify -- sin esto, Buffer se serializa como arreglo de
// numeros (~4-5x mas grande que el binario original).
function serializadorBytea(_clave, valor) {
    if (valor && valor.type === "Buffer" && Array.isArray(valor.data)) {
        return { $bytea: Buffer.from(valor.data).toString("base64") };
    }
    return valor;
}

async function generarRespaldo(pool) {
    const dump = {};

    for (const tabla of TABLAS_A_RESPALDAR) {
        const resultado = await pool.query(`SELECT * FROM public.${tabla}`);
        dump[tabla] = resultado.rows;
    }

    const json = JSON.stringify(dump, serializadorBytea);
    const comprimido = zlib.gzipSync(json);

    return {
        buffer: comprimido,
        tablas: TABLAS_A_RESPALDAR.length,
        bytes: comprimido.length
    };
}

async function registrarBitacora(pool, { exito, tamanoBytes, tablasRespaldadas, mensajeError, duracionMs }) {
    await pool.query(
        `INSERT INTO public.respaldos_automaticos
            (fecha, exito, tamano_bytes, tablas_respaldadas, mensaje_error, duracion_ms)
         VALUES (CURRENT_DATE, $1, $2, $3, $4, $5)`,
        [exito, tamanoBytes ?? null, tablasRespaldadas ?? null, mensajeError ?? null, duracionMs ?? null]
    );
}

async function yaCorrioHoy(pool) {
    const resultado = await pool.query(
        `SELECT 1 FROM public.respaldos_automaticos
         WHERE fecha = CURRENT_DATE AND exito = true
         LIMIT 1`
    );

    return resultado.rows.length > 0;
}

async function ejecutarRespaldoDiario(pool) {
    const inicio = Date.now();

    try {
        const { buffer, tablas, bytes } = await generarRespaldo(pool);
        const duracionMs = Date.now() - inicio;
        const fecha = new Date().toISOString().slice(0, 10);

        if (bytes > LIMITE_ADJUNTO_BYTES) {
            await registrarBitacora(pool, {
                exito: false,
                tamanoBytes: bytes,
                tablasRespaldadas: tablas,
                mensajeError: `Respaldo generado (${(bytes / 1024 / 1024).toFixed(1)}MB) supera el limite de correo -- no se pudo enviar.`,
                duracionMs
            });

            if (config.respaldoEmailDestino) {
                await enviarCorreoRespaldo(config.respaldoEmailDestino, {
                    asunto: `Respaldo de Nexo POS del ${fecha} crecio demasiado para enviarse por correo`,
                    mensajeHtml: `<p style="margin:0;color:#344054;font-size:15px;line-height:1.6;">El respaldo de hoy ocupa ${(bytes / 1024 / 1024).toFixed(1)}MB comprimido, por encima de lo que se puede mandar por correo. Hace falta mover el mecanismo de respaldo a almacenamiento externo (S3/Backblaze). El respaldo NO se genero como archivo esta vez.</p>`
                });
            }

            return { ok: false, motivo: "excede_limite_correo", bytes };
        }

        await registrarBitacora(pool, {
            exito: true,
            tamanoBytes: bytes,
            tablasRespaldadas: tablas,
            duracionMs
        });

        if (config.respaldoEmailDestino) {
            await enviarCorreoRespaldo(config.respaldoEmailDestino, {
                asunto: `Respaldo automatico de Nexo POS -- ${fecha}`,
                mensajeHtml: `
                    <p style="margin:0;color:#344054;font-size:15px;line-height:1.6;">Respaldo diario de la base de datos completa (${tablas} tablas, ${(bytes / 1024 / 1024).toFixed(2)}MB comprimido).</p>
                    <p style="margin:12px 0 0;color:#344054;font-size:15px;line-height:1.6;">Guarda este correo o descarga el adjunto a un lugar seguro. Para restaurarlo, usa <code>scripts/restaurar-backup.js</code>.</p>
                `,
                attachments: [{
                    filename: `respaldo-nexopos-${fecha}.json.gz`,
                    content: buffer.toString("base64")
                }]
            });
        }

        return { ok: true, bytes, tablas };
    } catch (error) {
        const duracionMs = Date.now() - inicio;

        await registrarBitacora(pool, {
            exito: false,
            mensajeError: error.message,
            duracionMs
        }).catch(() => {}); // si ni siquiera se pudo escribir la bitacora, no tumbar el proceso

        if (config.respaldoEmailDestino) {
            await enviarCorreoRespaldo(config.respaldoEmailDestino, {
                asunto: "El respaldo automatico de Nexo POS de hoy fallo",
                mensajeHtml: `<p style="margin:0;color:#344054;font-size:15px;line-height:1.6;">El respaldo automatico de hoy no se pudo completar. Error: <code>${error.message}</code></p>`
            }).catch(() => {});
        }

        return { ok: false, motivo: "error", error: error.message };
    }
}

function iniciarProgramadorRespaldos(pool) {
    async function revisarYCorrer() {
        try {
            const corrioHoy = await yaCorrioHoy(pool);
            if (!corrioHoy) {
                await ejecutarRespaldoDiario(pool);
            }
        } catch (error) {
            console.log("[respaldos] Error revisando/corriendo respaldo automatico:", error.message);
        }
    }

    revisarYCorrer();
    setInterval(revisarYCorrer, INTERVALO_REVISION_MS);
}

function instalar(app, pool) {
    iniciarProgramadorRespaldos(pool);

    app.post("/admin/api/respaldos/ejecutar", async (_req, res) => {
        try {
            const resultado = await ejecutarRespaldoDiario(pool);
            res.json(resultado);
        } catch (error) {
            responderError(res, error);
        }
    });

    app.get("/admin/api/respaldos/historial", async (_req, res) => {
        try {
            const resultado = await pool.query(
                `SELECT id, fecha, exito, tamano_bytes, tablas_respaldadas, mensaje_error, duracion_ms, created_at
                 FROM public.respaldos_automaticos
                 ORDER BY created_at DESC
                 LIMIT 30`
            );

            res.json({ ok: true, respaldos: resultado.rows });
        } catch (error) {
            responderError(res, error);
        }
    });
}

module.exports = instalar;
module.exports.ejecutarRespaldoDiario = ejecutarRespaldoDiario;
