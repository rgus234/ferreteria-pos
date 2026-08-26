const multer = require("multer");
const crypto = require("crypto");
const { config } = require("./config");
const { responderError } = require("./error-utils");
const { hashPassword } = require("./password-utils");
const { formatearCodigoRecogida } = require("./pedido-codigos");
const { enviarCorreoPedidoCarritoPublico, enviarCorreoPedidoRecibido } = require("./email");
const { enviarPushANegocio } = require("./push-server");

// Pagos reales de Nexo Market: cada ferreteria tiene su propia cuenta
// conectada de Stripe (Connect, API "Accounts v2" -- 100% embebida, el
// dueno nunca ve la interfaz de Stripe) para recibir el dinero de sus
// pedidos directo, con Nexo cobrando una comision automatica en cada
// transaccion. Modulo separado de stripe-server.js a proposito: ese es
// 100% la suscripcion SaaS del dueno (cobrar el plan basico/plus/pro),
// este es 100% el dinero que fluye entre comprador y ferreteria -- son
// dos dominios de negocio distintos aunque compartan la misma cuenta de
// Stripe de Nexo por debajo.
//
// Nota importante (encontrada probando en vivo contra Stripe test mode,
// no en la documentacion): la cuenta de Stripe de Nexo NO tiene
// habilitada la API vieja "Accounts v1" (Stripe la desactivo para
// integraciones nuevas y no ofrece la opcion de reactivarla para esta
// cuenta -- se verifico en el Dashboard, "Funcionalidades y versiones
// preliminares"). Por eso este modulo usa "Accounts v2"
// (stripe.v2.core.accounts), que tiene una forma de datos bastante
// distinta a v1 (identity/configuration/defaults en vez de individual/
// company/capabilities sueltos). El equivalente de una cuenta "Custom"
// v1 (100% embebida, la plataforma es responsable de KYC/ToS) en v2 es
// pedir defaults.responsibilities.fees_collector = "application" y
// losses_collector = "application" -- requirements_collector se infiere
// solo de esos dos (mandarlo explicito da "Unknown field").
const MCC_FERRETERIA = "5251"; // Merchant Category Code de "Hardware Stores"

// Comision de Nexo sobre cada pago procesado -- constante clara y
// documentada (no una tabla de configuracion todavia; se puede mover
// despues si el dueno quiere ajustarla sin tocar codigo).
const COMISION_NEXO_MARKETPLACE = 0.03;

// Mismo patron lazy-init que stripe-server.js:26-40 (misma
// STRIPE_SECRET_KEY -- Connect vive en la misma cuenta de Stripe de
// Nexo). Se duplica en vez de importarse: cada modulo -server.js de este
// proyecto es autosuficiente (mismo criterio ya usado en todo el repo).
// apiVersion mas reciente que stripe-server.js a proposito: es la que
// expone el namespace v2.core.accounts que este modulo necesita.
let stripeClient = null;

function obtenerStripe() {
    if (!config.stripeSecretKey) return null;
    if (!stripeClient) {
        stripeClient = require("stripe")(config.stripeSecretKey, {
            apiVersion: "2026-07-29.dahlia"
        });
    }
    return stripeClient;
}

async function negocioConCobros(pool, req) {
    const negocioId = req.negocioDispositivo?.negocio_id ?? req.negocioAutenticado?.negocio_id;

    if (!negocioId) {
        const error = new Error("Este equipo no esta vinculado a ningun negocio");
        error.httpStatus = 401;
        throw error;
    }

    const resultado = await pool.query(
        `
        SELECT id, slug, nombre, correo,
               stripe_connect_account_id, stripe_connect_charges_enabled,
               stripe_connect_payouts_enabled, stripe_connect_requisitos_pendientes
        FROM public.negocios
        WHERE id = $1
        LIMIT 1
        `,
        [negocioId]
    );

    if (resultado.rows.length === 0) {
        const error = new Error("Negocio no encontrado");
        error.httpStatus = 404;
        throw error;
    }

    return resultado.rows[0];
}

// Mismo helper que paramTexto en public-site-server.js, copiado local.
function paramTextoConnect(valor, maximo) {
    return String(valor || "").trim().slice(0, maximo);
}

// Mismo alfabeto que ya usa public-site-server.js para el codigo de
// acceso de una "cuenta ligera" de visitante -- copiado local a este
// archivo, mismo criterio de helpers chicos duplicados por archivo ya
// seguido en todo el proyecto.
const ALFABETO_CODIGO_ACCESO_CLIENTE = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
function generarCodigoAccesoClienteConnect() {
    let codigo = "";
    for (let i = 0; i < 8; i++) {
        codigo += ALFABETO_CODIGO_ACCESO_CLIENTE[crypto.randomInt(ALFABETO_CODIGO_ACCESO_CLIENTE.length)];
    }
    return codigo;
}

// Respaldo de atomicidad: crea el pedido a partir de la foto guardada
// en market_checkout_pendiente cuando el POST normal del navegador
// (pedido-carrito, en public-site-server.js/recibirPedidoCarritoPublico)
// nunca llego pero el pago SI se completo -- el navegador cerro la
// pestana, perdio la conexion, etc. justo despues de que Stripe
// confirmara el cargo.
//
// A proposito NO reusa recibirPedidoCarritoPublico: esa funcion tambien
// maneja cotizaciones, pedidos del sitio propio sin pago, limite de
// intentos por IP, honeypot y sesion de persona -- aqui el UNICO caso
// posible es un pedido de Market ya pagado de verdad (Stripe ya lo
// confirmo), asi que duplicar esta logica mas chica y simple es mas
// seguro que tocar la funcion grande que ya funciona en produccion.
//
// Diferencia deliberada con el flujo normal: si un producto del
// carrito ya no existe, aqui NO se aborta la transaccion (el pago ya
// se hizo -- perder el registro completo del pedido seria peor que
// guardarlo con el nombre/precio que traiga la foto guardada).
async function crearPedidoMarketDesdeSnapshot(pool, snapshotRow, intentoStripe) {
    const datos = snapshotRow.datos || {};
    const negocioId = snapshotRow.negocio_id;
    const slug = snapshotRow.slug;

    const negocioRes = await pool.query(
        `
        SELECT n.id, n.nombre, n.correo, n.pedido_prep_min, n.pedido_prep_max, c.envio_modo
        FROM public.negocios n
        LEFT JOIN public.sitio_web_config c ON c.negocio_id = n.id
        WHERE n.id = $1
        LIMIT 1
        `,
        [negocioId]
    );
    const negocio = negocioRes.rows[0];

    if (!negocio) return { ok: false, error: "Negocio no encontrado" };

    const itemsBody = Array.isArray(datos.items) ? datos.items : [];
    const codigos = itemsBody.map(it => String(it?.codigo || "").trim()).filter(Boolean);

    const client = await pool.connect();

    try {
        await client.query("BEGIN");

        const productosRes = await client.query(
            `SELECT codigo, nombre, COALESCE(precio_oferta, precio_publico, precio) AS precio_final FROM public.productos WHERE negocio_id = $1 AND codigo = ANY($2)`,
            [negocioId, codigos]
        );
        const nombresPorCodigo = new Map(productosRes.rows.map(p => [p.codigo, p.nombre]));
        const preciosPorCodigo = new Map(productosRes.rows.map(p => [p.codigo, Number(p.precio_final) || 0]));

        const itemsNormalizados = itemsBody.map(item => {
            const codigo = String(item?.codigo || "").trim();
            const cantidad = Math.min(9999, Math.max(1, parseInt(item?.cantidad, 10) || 1));
            return {
                codigo,
                cantidad,
                nombre: nombresPorCodigo.get(codigo) || String(item?.nombre || codigo),
                precio: preciosPorCodigo.has(codigo) ? preciosPorCodigo.get(codigo) : Number(item?.precio) || 0
            };
        });

        const grupoId = crypto.randomUUID();
        const total = itemsNormalizados.reduce((suma, i) => suma + i.precio * i.cantidad, 0);
        const prepMin = negocio.pedido_prep_min ?? 30;
        const prepMax = negocio.pedido_prep_max ?? 45;
        const ahora = Date.now();
        const recogidaDesde = new Date(ahora + prepMin * 60000);
        const recogidaHasta = new Date(ahora + prepMax * 60000);

        let entregaModo = datos.entrega === "domicilio" || datos.entrega === "recoleccion" ? datos.entrega : null;
        if (negocio.envio_modo === "solo_recoleccion") entregaModo = "recoleccion";

        const clienteNombre = String(datos.clienteNombre || "");
        const clienteTelefono = String(datos.clienteTelefono || "");
        const clienteCorreo = String(datos.clienteCorreo || "");
        const mensaje = String(datos.mensaje || "");

        let pedidoMarketId;

        try {
            const insertCabecera = await client.query(
                `
                INSERT INTO public.pedidos_market
                    (negocio_id, persona_id, grupo_id, cliente_nombre, cliente_telefono, cliente_correo, estado, codigo_recogida, total, pagado, tiempo_prep_min, tiempo_prep_max, recogida_estimada_desde, recogida_estimada_hasta, stripe_payment_intent_id)
                VALUES ($1, $2, $3, $4, $5, $6, 'pendiente', $7, $8, true, $9, $10, $11, $12, $13)
                RETURNING id
                `,
                [negocioId, null, grupoId, clienteNombre, clienteTelefono, clienteCorreo, `TEMP-${grupoId}`, total, prepMin, prepMax, recogidaDesde, recogidaHasta, intentoStripe.id]
            );
            pedidoMarketId = insertCabecera.rows[0].id;
        } catch (error) {
            if (error.code === "23505") {
                // Otro proceso (el POST normal del navegador, o un reintento
                // de este mismo webhook) ya creo el pedido para este pago --
                // no es un error, es la carrera que este indice existe para
                // resolver.
                await client.query("ROLLBACK");
                return { ok: true, repetido: true };
            }
            throw error;
        }

        const codigoRecogida = formatearCodigoRecogida(pedidoMarketId);

        await client.query(`UPDATE public.pedidos_market SET codigo_recogida = $1 WHERE id = $2`, [codigoRecogida, pedidoMarketId]);

        const itemsParaCorreo = [];

        for (const item of itemsNormalizados) {
            await client.query(
                `
                INSERT INTO public.pedidos_publicos
                    (negocio_id, producto_codigo, producto_nombre, cantidad, cliente_nombre, cliente_telefono, cliente_correo, mensaje, ip, grupo_id, tipo, persona_id, origen, entrega_modo, pagado, stripe_payment_intent_id, monto_pagado, comision_nexo, pedido_market_id)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'pedido', $11, 'market', $12, true, $13, $14, $15, $16)
                `,
                [negocioId, item.codigo, item.nombre, item.cantidad, clienteNombre, clienteTelefono, clienteCorreo, mensaje, null, grupoId, null, entregaModo, intentoStripe.id, intentoStripe.amount / 100, (intentoStripe.application_fee_amount || 0) / 100, pedidoMarketId]
            );
            itemsParaCorreo.push({ nombre: item.nombre, cantidad: item.cantidad });
        }

        const digitosTelefono = clienteTelefono.replace(/\D/g, "");
        let cuentaCreada = false;
        let codigoAcceso = null;

        if (digitosTelefono.length >= 10) {
            const existente = await client.query(
                `SELECT id FROM public.clientes_credito WHERE negocio_id = $1 AND telefono = $2`,
                [negocioId, clienteTelefono]
            );

            if (existente.rows.length === 0) {
                codigoAcceso = generarCodigoAccesoClienteConnect();
                await client.query(
                    `
                    INSERT INTO public.clientes_credito
                        (negocio_id, nombre, telefono, limite_credito, es_visitante_sitio, codigo_acceso_hash, codigo_acceso_generado_at)
                    VALUES ($1, $2, $3, 0, true, $4, NOW())
                    `,
                    [negocioId, clienteNombre, clienteTelefono, hashPassword(codigoAcceso)]
                );
                cuentaCreada = true;
            }
        }

        await client.query(`UPDATE public.market_checkout_pendiente SET procesado = true WHERE payment_intent_id = $1`, [intentoStripe.id]);

        await client.query("COMMIT");

        if (negocio.correo) {
            enviarCorreoPedidoCarritoPublico(negocio.correo, negocio.nombre, {
                items: itemsParaCorreo,
                clienteNombre,
                clienteTelefono,
                clienteCorreo,
                mensaje,
                urlCatalogo: `https://${slug}.nexoposoficial.com/catalogo`
            }).catch(error => console.warn("No se pudo enviar el aviso de pedido de carrito (respaldo webhook):", error.message));
        }

        if (clienteCorreo) {
            enviarCorreoPedidoRecibido(clienteCorreo, negocio.nombre, {
                items: itemsParaCorreo,
                codigoRecogida,
                recogidaDesde,
                recogidaHasta,
                urlSeguimiento: `https://nexoposoficial.com/market/pedido/${encodeURIComponent(codigoRecogida)}`
            }).catch(error => console.warn("No se pudo enviar el correo de pedido recibido (respaldo webhook):", error.message));
        }

        enviarPushANegocio(pool, negocioId, {
            titulo: "Nuevo pedido de Nexo Market",
            cuerpo: `${clienteNombre} -- ${itemsParaCorreo.map(i => i.nombre).join(", ")}`.slice(0, 180),
            url: "/",
            pantalla: "pedidos"
        }).catch(error => console.warn("No se pudo enviar el push de pedido nuevo (respaldo webhook):", error.message));

        return { ok: true, codigoRecogida, pedidoMarketId, cuentaCreada, codigoAcceso };
    } catch (error) {
        await client.query("ROLLBACK");
        throw error;
    } finally {
        client.release();
    }
}

// Solo la foto de identificacion (frente/reverso) -- en memoria, se manda
// a Stripe directo sin guardar nada en disco.
const uploadIdentificacion = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024, files: 2 }
});

function manejarSubidaIdentificacion(req, res, next) {
    uploadIdentificacion.fields([{ name: "frente", maxCount: 1 }, { name: "reverso", maxCount: 1 }])(req, res, error => {
        if (error) {
            res.status(400).json({ ok: false, error: error.message || "No se pudo procesar el archivo subido" });
            return;
        }
        next();
    });
}

// Sincroniza el estado real de Stripe a la fila de negocios -- nunca se
// inventa que una cuenta "ya esta lista" si Stripe todavia pide algo.
// chargesEnabled requiere DOS capabilities activas en v2: card_payments
// (el cargo se cobra en la cuenta de Nexo, pero Stripe la exige igual
// como requisito de la cuenta conectada) y stripe_balance.stripe_transfers
// (la cuenta conectada puede RECIBIR la transferencia automatica del
// destination charge -- sin esto el pago fallaria). payoutsEnabled es
// aparte y normalmente queda pendiente mas tiempo (requiere la
// identificacion oficial) -- una tienda puede quedar "lista para cobrar"
// antes de poder retirar el dinero a su banco, eso es normal y honesto.
async function sincronizarEstadoCuenta(pool, stripe, negocioId, accountId) {
    const cuenta = await stripe.v2.core.accounts.retrieve(accountId, {
        include: ["requirements", "configuration.merchant", "configuration.recipient"]
    });

    const cardPaymentsActivo = cuenta.configuration?.merchant?.capabilities?.card_payments?.status === "active";
    const transferenciasActivo = cuenta.configuration?.recipient?.capabilities?.stripe_balance?.stripe_transfers?.status === "active";
    const payoutsActivo = Boolean(
        cuenta.configuration?.recipient?.capabilities?.stripe_balance?.payouts?.status === "active" ||
        cuenta.configuration?.merchant?.capabilities?.stripe_balance?.payouts?.status === "active"
    );
    const requisitos = (cuenta.requirements?.entries || []).map(e => e.description).filter(Boolean);
    const chargesEnabled = Boolean(cardPaymentsActivo && transferenciasActivo);

    await pool.query(
        `
        UPDATE public.negocios
        SET stripe_connect_charges_enabled = $1,
            stripe_connect_payouts_enabled = $2,
            stripe_connect_requisitos_pendientes = $3
        WHERE id = $4
        `,
        [chargesEnabled, payoutsActivo, JSON.stringify(requisitos), negocioId]
    );

    return { chargesEnabled, payoutsEnabled: payoutsActivo, requisitosPendientes: requisitos };
}

module.exports = (app, pool, requerirAccesoNegocio) => {
    app.post("/negocio-actual/cobros/cuenta", requerirAccesoNegocio, async (req, res) => {
        const stripe = obtenerStripe();

        if (!stripe) {
            res.status(503).json({ ok: false, error: "Stripe todavia no esta configurado en este servidor" });
            return;
        }

        try {
            const negocio = await negocioConCobros(pool, req);

            if (negocio.stripe_connect_account_id) {
                res.json({ ok: true, accountId: negocio.stripe_connect_account_id, creada: false });
                return;
            }

            // entity_type se fija aqui como "individual" -- en la UI el
            // dueno todavia no eligio persona fisica/empresa en este
            // punto (ese selector aparece hasta despues de crear la
            // cuenta). Si despues elige "empresa" en PATCH, se intenta
            // cambiar identity.entity_type ahi; Stripe podria rechazarlo
            // como campo inmutable segun el estado de la cuenta -- si
            // pasa, el error se muestra tal cual, nunca se finge exito.
            const cuenta = await stripe.v2.core.accounts.create({
                contact_email: negocio.correo || undefined,
                display_name: negocio.nombre || undefined,
                identity: { country: "mx", entity_type: "individual" },
                configuration: {
                    merchant: { capabilities: { card_payments: { requested: true } } },
                    recipient: { capabilities: { stripe_balance: { stripe_transfers: { requested: true } } } }
                },
                defaults: {
                    currency: "mxn",
                    responsibilities: { fees_collector: "application", losses_collector: "application" }
                },
                dashboard: "none"
            });

            await pool.query(
                `UPDATE public.negocios SET stripe_connect_account_id = $1 WHERE id = $2`,
                [cuenta.id, negocio.id]
            );

            res.json({ ok: true, accountId: cuenta.id, creada: true });
        } catch (error) {
            responderError(res, error);
        }
    });

    app.patch("/negocio-actual/cobros/cuenta", requerirAccesoNegocio, async (req, res) => {
        const stripe = obtenerStripe();

        if (!stripe) {
            res.status(503).json({ ok: false, error: "Stripe todavia no esta configurado en este servidor" });
            return;
        }

        try {
            const negocio = await negocioConCobros(pool, req);

            if (!negocio.stripe_connect_account_id) {
                res.status(400).json({ ok: false, error: "Primero crea la cuenta de cobros (POST /negocio-actual/cobros/cuenta)." });
                return;
            }

            const body = req.body || {};
            const businessType = body.businessType === "company" ? "company" : "individual";

            const direccion = body.calle
                ? {
                    country: "MX",
                    line1: body.calle,
                    city: body.ciudad || undefined,
                    state: body.estado || undefined,
                    postal_code: body.codigoPostal || undefined,
                    town: body.ciudad || undefined
                }
                : undefined;

            const identity = { entity_type: businessType };

            if (businessType === "individual") {
                identity.individual = {
                    given_name: body.nombre || undefined,
                    surname: body.apellidos || undefined,
                    email: body.correo || negocio.correo || undefined,
                    phone: body.telefono || undefined,
                    id_numbers: body.rfc ? [{ type: "mx_rfc", value: body.rfc }] : undefined,
                    date_of_birth: (body.diaNacimiento && body.mesNacimiento && body.anioNacimiento)
                        ? { day: Number(body.diaNacimiento), month: Number(body.mesNacimiento), year: Number(body.anioNacimiento) }
                        : undefined,
                    address: direccion
                };
            } else {
                identity.business_details = {
                    registered_name: body.razonSocial || undefined,
                    id_numbers: body.rfc ? [{ type: "mx_rfc", value: body.rfc }] : undefined,
                    address: direccion
                };
            }

            // El dueno acepta los terminos de servicio de Stripe dentro
            // del formulario propio de Nexo (checkbox) -- se manda como
            // attestations.terms_of_service con la fecha/ip reales de
            // este request, nunca se inventa la aceptacion.
            if (body.aceptaTerminos) {
                identity.attestations = {
                    terms_of_service: {
                        account: { date: new Date().toISOString(), ip: req.ip }
                    }
                };
            }

            await stripe.v2.core.accounts.update(negocio.stripe_connect_account_id, {
                identity,
                configuration: {
                    merchant: {
                        mcc: MCC_FERRETERIA,
                        support: { phone: body.telefono || undefined }
                    }
                },
                defaults: {
                    profile: {
                        business_url: `https://nexoposoficial.com/market/tienda/${encodeURIComponent(negocio.slug)}`,
                        product_description: "Venta de productos de ferreteria"
                    }
                }
            });

            // La cuenta bancaria (CLABE) no se puede mandar dentro del
            // update de v2 (Stripe la rechaza como "Unknown field") --
            // se manda por la ruta v1 de external accounts, que si
            // funciona sobre un ID de cuenta v2 (interoperabilidad
            // documentada por Stripe entre ambas versiones de la API).
            if (body.clabe) {
                const nombreTitular = businessType === "individual"
                    ? `${body.nombre || ""} ${body.apellidos || ""}`.trim()
                    : (body.razonSocial || undefined);

                await stripe.accounts.createExternalAccount(negocio.stripe_connect_account_id, {
                    external_account: {
                        object: "bank_account",
                        country: "MX",
                        currency: "mxn",
                        account_holder_name: nombreTitular || undefined,
                        account_holder_type: businessType,
                        account_number: body.clabe
                    }
                });
            }

            if (businessType === "company" && body.representanteNombre && body.representanteApellidos) {
                // Cuenta tipo "empresa": el representante se registra
                // como "person" via la ruta v1 (misma logica de
                // interoperabilidad que external_account arriba). Esta
                // rama se probo menos a fondo que el resto del modulo --
                // si Stripe la rechaza, el error se muestra tal cual al
                // dueno, nunca se finge exito.
                const personas = await stripe.accounts.listPersons(negocio.stripe_connect_account_id, { limit: 10 });
                const representanteExistente = personas.data.find(p => p.relationship?.representative);

                const datosPersona = {
                    first_name: body.representanteNombre,
                    last_name: body.representanteApellidos,
                    email: body.correo || negocio.correo || undefined,
                    phone: body.telefono || undefined,
                    relationship: { representative: true, title: body.representanteCargo || undefined }
                };

                if (representanteExistente) {
                    await stripe.accounts.updatePerson(negocio.stripe_connect_account_id, representanteExistente.id, datosPersona);
                } else {
                    await stripe.accounts.createPerson(negocio.stripe_connect_account_id, datosPersona);
                }
            }

            const estado = await sincronizarEstadoCuenta(pool, stripe, negocio.id, negocio.stripe_connect_account_id);

            res.json({ ok: true, ...estado });
        } catch (error) {
            responderError(res, error);
        }
    });

    app.post("/negocio-actual/cobros/identificacion", requerirAccesoNegocio, manejarSubidaIdentificacion, async (req, res) => {
        const stripe = obtenerStripe();

        if (!stripe) {
            res.status(503).json({ ok: false, error: "Stripe todavia no esta configurado en este servidor" });
            return;
        }

        try {
            const negocio = await negocioConCobros(pool, req);

            if (!negocio.stripe_connect_account_id) {
                res.status(400).json({ ok: false, error: "Primero crea la cuenta de cobros." });
                return;
            }

            const frenteArchivo = req.files?.frente?.[0];
            const reversoArchivo = req.files?.reverso?.[0];

            if (!frenteArchivo) {
                res.status(400).json({ ok: false, error: "Falta la foto del frente de la identificacion." });
                return;
            }

            const frente = await stripe.files.create(
                { purpose: "identity_document", file: { data: frenteArchivo.buffer, name: frenteArchivo.originalname, type: "application/octet-stream" } },
                { stripeAccount: negocio.stripe_connect_account_id }
            );

            // Stripe rechaza el mismo archivo repetido como frente y
            // reverso ("Duplicate document detected") -- si no mandaron
            // reverso, se manda solo el frente en ambos lados solo si son
            // realmente el mismo archivo del usuario (no se duplica el
            // mismo file.id dos veces cuando si hay reverso real).
            const reverso = reversoArchivo
                ? await stripe.files.create(
                    { purpose: "identity_document", file: { data: reversoArchivo.buffer, name: reversoArchivo.originalname, type: "application/octet-stream" } },
                    { stripeAccount: negocio.stripe_connect_account_id }
                )
                : null;

            const cuentaActual = await stripe.v2.core.accounts.retrieve(negocio.stripe_connect_account_id, { include: ["identity"] });
            const documento = { type: "front_back", front_back: { front: frente.id, back: (reverso || frente).id } };

            if (cuentaActual.identity?.entity_type === "company") {
                const personas = await stripe.accounts.listPersons(negocio.stripe_connect_account_id, { limit: 10 });
                const representante = personas.data.find(p => p.relationship?.representative);

                if (!representante) {
                    res.status(400).json({ ok: false, error: "Primero completa los datos del representante." });
                    return;
                }

                await stripe.accounts.updatePerson(negocio.stripe_connect_account_id, representante.id, {
                    verification: { document: { front: frente.id, back: (reverso || frente).id } }
                });
            } else {
                await stripe.v2.core.accounts.update(negocio.stripe_connect_account_id, {
                    identity: { individual: { documents: { primary_verification: documento } } }
                });
            }

            const estado = await sincronizarEstadoCuenta(pool, stripe, negocio.id, negocio.stripe_connect_account_id);

            res.json({ ok: true, ...estado });
        } catch (error) {
            responderError(res, error);
        }
    });

    app.get("/negocio-actual/cobros/estado", requerirAccesoNegocio, async (req, res) => {
        const stripe = obtenerStripe();

        try {
            const negocio = await negocioConCobros(pool, req);

            if (!negocio.stripe_connect_account_id) {
                res.json({ ok: true, tieneCuenta: false, chargesEnabled: false, payoutsEnabled: false, requisitosPendientes: [] });
                return;
            }

            if (!stripe) {
                res.json({
                    ok: true,
                    tieneCuenta: true,
                    chargesEnabled: negocio.stripe_connect_charges_enabled,
                    payoutsEnabled: negocio.stripe_connect_payouts_enabled,
                    requisitosPendientes: negocio.stripe_connect_requisitos_pendientes || []
                });
                return;
            }

            const estado = await sincronizarEstadoCuenta(pool, stripe, negocio.id, negocio.stripe_connect_account_id);
            res.json({ ok: true, tieneCuenta: true, ...estado });
        } catch (error) {
            responderError(res, error);
        }
    });

    // Ruta publica (sin requerirAccesoNegocio -- la usa el comprador desde
    // el checkout de Market, no el dueno). El total se recalcula aqui con
    // los precios reales de la base de datos -- nunca se confia en un
    // monto mandado por el cliente. "Destination charge": el cargo se
    // hace en la cuenta de Nexo y Stripe transfiere automatico el resto a
    // la cuenta conectada de la tienda, descontando application_fee_amount
    // (la comision de Nexo) en el mismo movimiento. PaymentIntent sigue
    // siendo un recurso v1 de Stripe (no cambia con la migracion a
    // Accounts v2) -- este bloque no se toco.
    // Registrada en los dos prefijos: "/market/tienda/..." (canonico) y
    // "/market/ferreteria/..." (compatibilidad -- POST no se puede
    // redirigir sin romper clientes viejos, ver server.js).
    app.post(["/market/tienda/:slug/catalogo/crear-intento-pago", "/market/ferreteria/:slug/catalogo/crear-intento-pago"], async (req, res) => {
        const stripe = obtenerStripe();

        if (!stripe) {
            res.status(503).json({ ok: false, error: "Stripe todavia no esta configurado en este servidor" });
            return;
        }

        try {
            const slug = String(req.params?.slug || "").trim().toLowerCase();

            const negocioRow = await pool.query(
                `SELECT id, stripe_connect_account_id, stripe_connect_charges_enabled FROM public.negocios WHERE slug = $1 LIMIT 1`,
                [slug]
            );
            const negocio = negocioRow.rows[0];

            if (!negocio) {
                res.status(404).json({ ok: false, error: "Tienda no encontrada." });
                return;
            }

            if (!negocio.stripe_connect_charges_enabled || !negocio.stripe_connect_account_id) {
                res.status(400).json({ ok: false, error: "Esta tienda no tiene pagos en linea activos todavia." });
                return;
            }

            const itemsBody = Array.isArray(req.body?.items) ? req.body.items : [];

            if (itemsBody.length === 0) {
                res.status(400).json({ ok: false, error: "El carrito esta vacio." });
                return;
            }

            const codigos = itemsBody.map(it => String(it?.codigo || "").trim()).filter(Boolean);

            const productosRes = await pool.query(
                `SELECT codigo, COALESCE(precio_publico, precio) AS precio FROM public.productos WHERE negocio_id = $1 AND codigo = ANY($2)`,
                [negocio.id, codigos]
            );
            const precioPorCodigo = new Map(productosRes.rows.map(p => [p.codigo, Number(p.precio)]));

            let total = 0;

            for (const item of itemsBody) {
                const codigo = String(item?.codigo || "").trim();
                const cantidad = Math.min(9999, Math.max(1, parseInt(item?.cantidad, 10) || 1));
                const precio = precioPorCodigo.get(codigo);

                if (precio === undefined || !Number.isFinite(precio)) {
                    res.status(400).json({ ok: false, error: "Uno de los productos ya no esta disponible o no tiene precio publicado." });
                    return;
                }

                total += precio * cantidad;
            }

            if (total <= 0) {
                res.status(400).json({ ok: false, error: "El total del pedido debe ser mayor a cero." });
                return;
            }

            const totalCentavos = Math.round(total * 100);
            const comisionCentavos = Math.round(totalCentavos * COMISION_NEXO_MARKETPLACE);

            const intento = await stripe.paymentIntents.create({
                amount: totalCentavos,
                currency: "mxn",
                application_fee_amount: comisionCentavos,
                transfer_data: { destination: negocio.stripe_connect_account_id },
                metadata: { negocio_slug: slug }
            });

            // Foto del checkout para el respaldo de atomicidad (ver
            // crearPedidoMarketDesdeSnapshot mas arriba): si el POST normal
            // de pedido-carrito nunca llega despues de que Stripe confirme
            // el pago, el webhook payment_intent.succeeded usa esto para no
            // perder el pedido. Best-effort a proposito -- si esta escritura
            // falla, el pago debe poder seguir de todos modos (el flujo
            // normal, el caso comun, no depende de esta tabla para nada).
            try {
                await pool.query(
                    `
                    INSERT INTO public.market_checkout_pendiente (payment_intent_id, negocio_id, slug, datos)
                    VALUES ($1, $2, $3, $4::jsonb)
                    ON CONFLICT (payment_intent_id) DO NOTHING
                    `,
                    [
                        intento.id,
                        negocio.id,
                        slug,
                        JSON.stringify({
                            items: itemsBody.map(it => ({ codigo: String(it?.codigo || "").trim(), cantidad: it?.cantidad })),
                            clienteNombre: paramTextoConnect(req.body?.clienteNombre, 140),
                            clienteTelefono: paramTextoConnect(req.body?.clienteTelefono, 40),
                            clienteCorreo: paramTextoConnect(req.body?.clienteCorreo, 140),
                            mensaje: paramTextoConnect(req.body?.mensaje, 500),
                            entrega: req.body?.entrega === "domicilio" || req.body?.entrega === "recoleccion" ? req.body.entrega : null
                        })
                    ]
                );
            } catch (error) {
                console.warn("No se pudo guardar la foto de checkout para respaldo de atomicidad:", error.message);
            }

            res.json({ ok: true, clientSecret: intento.client_secret, total, comision: comisionCentavos / 100 });
        } catch (error) {
            responderError(res, error);
        }
    });

    // Sin requerirAccesoNegocio -- Stripe no manda esos tokens, la unica
    // autenticacion valida es la firma verificada contra
    // STRIPE_WEBHOOK_SECRET_CONNECT (secreto distinto al webhook de
    // suscripciones -- Stripe exige uno por endpoint). Reusa la tabla
    // stripe_webhook_events (migrations/20260717_stripe.sql) para
    // idempotencia, mismo patron que stripe-server.js:436-476.
    // payment_intent.succeeded sigue siendo un evento v1 normal (el
    // PaymentIntent es un recurso v1). account.updated tambien deberia
    // seguir llegando en formato v1 para cuentas creadas con Accounts v2
    // (Stripe documenta interoperabilidad entre ambas), pero esto no se
    // pudo verificar en vivo dentro de esta sesion -- la fuente de verdad
    // real y ya verificada es GET /negocio-actual/cobros/estado, que la
    // pantalla de Sitio web vuelve a consultar cada vez que se abre la
    // pestana "Cobros en linea", asi que aunque el webhook de
    // account.updated no llegue, el dueno igual ve el estado real la
    // proxima vez que entra.
    app.post("/webhooks/stripe-connect", async (req, res) => {
        const stripe = obtenerStripe();

        if (!stripe || !config.stripeWebhookSecretConnect) {
            res.status(503).send("Stripe Connect todavia no esta configurado en este servidor");
            return;
        }

        let evento;

        try {
            evento = stripe.webhooks.constructEvent(
                req.rawBody,
                req.headers["stripe-signature"],
                config.stripeWebhookSecretConnect
            );
        } catch (error) {
            res.status(400).send(`Firma de webhook invalida: ${error.message}`);
            return;
        }

        try {
            const yaProcesado = await pool.query(
                `INSERT INTO public.stripe_webhook_events (id, tipo) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING RETURNING id`,
                [evento.id, evento.type]
            );

            if (yaProcesado.rows.length === 0) {
                res.json({ ok: true, repetido: true });
                return;
            }

            await procesarEventoStripeConnect(pool, stripe, evento);

            res.json({ ok: true });
        } catch (error) {
            responderError(res, error);
        }
    });
};

async function procesarEventoStripeConnect(pool, stripe, evento) {
    switch (evento.type) {
        case "account.updated": {
            const cuenta = evento.data.object;

            if (cuenta.charges_enabled === undefined) {
                // Forma v2 (o algun otro cambio de formato que no trae
                // los campos v1 planos) -- se re-sincroniza pidiendo el
                // estado fresco por API en vez de confiar en la forma
                // del payload del webhook.
                if (cuenta.id) {
                    const negocioRow = await pool.query(
                        `SELECT id FROM public.negocios WHERE stripe_connect_account_id = $1 LIMIT 1`,
                        [cuenta.id]
                    );
                    if (negocioRow.rows[0]) {
                        await sincronizarEstadoCuenta(pool, stripe, negocioRow.rows[0].id, cuenta.id);
                    }
                }
                break;
            }

            const requisitos = cuenta.requirements?.currently_due || [];

            await pool.query(
                `
                UPDATE public.negocios
                SET stripe_connect_charges_enabled = $1,
                    stripe_connect_payouts_enabled = $2,
                    stripe_connect_requisitos_pendientes = $3
                WHERE stripe_connect_account_id = $4
                `,
                [Boolean(cuenta.charges_enabled), Boolean(cuenta.payouts_enabled), JSON.stringify(requisitos), cuenta.id]
            );

            break;
        }

        // Respaldo de atomicidad (ver crearPedidoMarketDesdeSnapshot mas
        // arriba): el flujo normal (public-site-server.js,
        // recibirPedidoCarritoPublico) ya crea el pedido al recibir
        // stripePaymentIntentId del navegador y verificarlo contra Stripe
        // -- ese es el camino comun y el mas rapido para el comprador. Si
        // este evento llega y NINGUN pedido referencia todavia ese
        // payment_intent (el comprador pago pero cerro la pestana o perdio
        // la conexion antes de que el POST final llegara), se usa la foto
        // guardada en market_checkout_pendiente para crear el pedido de
        // todos modos -- el pago ya es real, no hay motivo para perderlo.
        case "payment_intent.succeeded": {
            const intento = evento.data.object;

            const existente = await pool.query(
                `SELECT id FROM public.pedidos_publicos WHERE stripe_payment_intent_id = $1 LIMIT 1`,
                [intento.id]
            );

            if (existente.rows.length === 0) {
                const snapshot = await pool.query(
                    `SELECT * FROM public.market_checkout_pendiente WHERE payment_intent_id = $1 AND procesado = false LIMIT 1`,
                    [intento.id]
                );

                if (snapshot.rows.length > 0) {
                    try {
                        await crearPedidoMarketDesdeSnapshot(pool, snapshot.rows[0], intento);
                    } catch (error) {
                        console.warn(
                            `No se pudo crear el pedido de respaldo para payment_intent ${intento.id}:`,
                            error.message
                        );
                    }
                } else {
                    console.warn(
                        `Pago de Stripe Connect confirmado sin pedido asociado ni foto de checkout -- payment_intent ${intento.id}, tienda ${intento.metadata?.negocio_slug || "desconocida"}. Revisar manualmente.`
                    );
                }
            }

            break;
        }

        default:
            break;
    }
}

module.exports.COMISION_NEXO_MARKETPLACE = COMISION_NEXO_MARKETPLACE;
module.exports.obtenerStripe = obtenerStripe;
module.exports.procesarEventoStripeConnect = procesarEventoStripeConnect;
