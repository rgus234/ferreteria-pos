const { config } = require("./config");
const { responderError } = require("./error-utils");
const { listarPlanes, funcionesDelPlan } = require("./features");
const { enviarCorreoPagoFallido, enviarCorreoPagoConfirmado } = require("./email");

const NOMBRE_PLAN_LEGIBLE = { basico: "Basico", plus: "Plus", pro: "Pro" };

// Funciones del catalogo (migrations/20260716_catalogo_funciones_planes.sql)
// que se destacan en la rejilla de planes de Cuenta -- curadas a mano,
// solo las que ya estan "activo" (no "planeado"/"en_desarrollo", para
// no anunciar algo que todavia no existe).
const FUNCIONES_DESTACADAS = [
    "multiusuario.empleados_pin",
    "catalogo.importacion_listas",
    "catalogo.reglas_precio",
    "reportes.comparativas",
    "finanzas.utilidad_neta"
];

// Cliente de Stripe inicializado de forma perezosa -- si todavia no
// hay STRIPE_SECRET_KEY (caso normal mientras el usuario crea su
// cuenta de Stripe), las rutas de aqui abajo responden con un error
// claro en vez de tumbar el arranque del servidor.
let stripeClient = null;

function obtenerStripe() {
    if (!config.stripeSecretKey) return null;
    if (!stripeClient) {
        // apiVersion fija a proposito: la cuenta puede traer una
        // version mas nueva por defecto que el SDK instalado
        // (stripe@22) todavia no sigue del todo -- ya paso con
        // promotionCodes.create durante la configuracion inicial.
        // Fijarla evita que un cambio de version de Stripe rompa la
        // integracion sin que nadie haya tocado este codigo.
        stripeClient = require("stripe")(config.stripeSecretKey, {
            apiVersion: "2024-06-20"
        });
    }
    return stripeClient;
}

function urlBase(req) {
    return process.env.APP_BASE_URL || `${req.protocol}://${req.get("host")}`;
}

// Mismo upsert que licenciaActual() en server.js -- se repite aqui
// (en vez de importarla) porque esa funcion vive en el scope de
// server.js y no esta exportada; garantiza que la fila de licencias
// exista antes de guardarle el stripe_customer_id, sin importar si
// el dueno ya visito el panel de Cuenta antes o no.
async function asegurarFilaLicencia(pool, negocioId) {
    await pool.query(
        `
        INSERT INTO public.licencias (negocio_id, estado, plan, fecha_vencimiento, gracia_dias)
        VALUES ($1, 'activa', 'demo', NOW() + INTERVAL '30 days', 15)
        ON CONFLICT (negocio_id) DO NOTHING
        `,
        [negocioId]
    );
}

const PRECIO_POR_PLAN = () => ({
    basico: config.stripePriceBasico,
    plus: config.stripePricePlus,
    pro: config.stripePricePro
});

// Descuento de fundadores: los primeros N negocios que se suscriben
// se quedan con 40% de descuento de por vida (no solo unos meses).
// Se implementa 100% con un Coupon + Promotion Code de Stripe
// (duration:"forever", max_redemptions:N) -- Stripe ya lleva la
// cuenta de cuantas veces se uso contra el cupo, no hace falta
// ninguna columna nueva en la base de datos. Se crea una sola vez
// desde Admin (ver rutas mas abajo); cambiar el cupo despues de
// creado requiere el dashboard de Stripe (la API no permite editar
// max_redemptions de un promotion code ya creado).
const CODIGO_DESCUENTO_FUNDADOR = "FUNDADOR40";

async function cuponFundadorVigente(stripe) {
    // Se busca primero uno activo explicitamente -- si en algun
    // momento existe mas de un promotion code con este mismo texto
    // (ej. uno viejo desactivado al cambiar el cupo), no depende del
    // orden en que Stripe los regrese.
    const activos = await stripe.promotionCodes.list({ code: CODIGO_DESCUENTO_FUNDADOR, active: true, limit: 1 });
    const cualquiera = activos.data.length
        ? activos
        : await stripe.promotionCodes.list({ code: CODIGO_DESCUENTO_FUNDADOR, limit: 1 });
    const promo = cualquiera.data[0];
    if (!promo) return null;

    const restantes = Number.isFinite(promo.max_redemptions)
        ? promo.max_redemptions - promo.times_redeemed
        : null;

    return { ...promo, restantes };
}

// Cupon privado restringido a un cliente especifico (ej. "Cliente
// fundador" con precio simbolico, creado a mano en el dashboard de
// Stripe con "Limit to specific customer"). Si existe, gana sobre el
// cupon publico de fundadores -- de lo contrario el checkout aplicaria
// siempre FUNDADOR40 automatico y nunca dejaria escribir el codigo
// propio (discounts y allow_promotion_codes son mutuamente excluyentes).
async function cuponClienteVigente(stripe, stripeCustomerId) {
    if (!stripeCustomerId) return null;
    const activos = await stripe.promotionCodes.list({ customer: stripeCustomerId, active: true, limit: 1 });
    return activos.data[0] || null;
}

module.exports = (app, pool, requerirSesionCuenta, requerirAccesoNegocio) => {
    // Todas las rutas de aqui abajo usan la sesion de cuenta del
    // dueno (correo+contrasena), no el token de dispositivo -- solo
    // el dueno administra la suscripcion, no cualquier caja vinculada.
    // La excepcion es /suscripcion/planes (ver abajo): es catalogo
    // publico, se ve aunque se entre por una caja vinculada sin sesion
    // de dueno.

    app.get("/suscripcion/planes", requerirAccesoNegocio, async (req, res) => {
        try {
            const stripe = obtenerStripe();
            const precios = PRECIO_POR_PLAN();
            const planes = await listarPlanes();

            const resultado = await Promise.all(planes.map(async plan => {
                const funciones = await funcionesDelPlan(plan.clave);
                const destacadas = funciones.filter(f => FUNCIONES_DESTACADAS.includes(f.clave));

                let precio = null;

                if (stripe && precios[plan.clave]) {
                    try {
                        const precioStripe = await stripe.prices.retrieve(precios[plan.clave]);
                        precio = { montoCentavos: precioStripe.unit_amount, moneda: precioStripe.currency };
                    } catch {
                        // Precio no disponible (price ID invalido o Stripe sin
                        // configurar del todo) -- se omite, nunca se inventa.
                    }
                }

                return {
                    clave: plan.clave,
                    nombre: plan.nombre,
                    descripcion: plan.descripcion,
                    funciones: destacadas,
                    precio
                };
            }));

            res.json({ ok: true, planes: resultado });
        } catch (error) {
            responderError(res, error);
        }
    });

    app.post("/suscripcion/checkout", requerirSesionCuenta, async (req, res) => {
        const stripe = obtenerStripe();

        if (!stripe) {
            res.status(503).json({ ok: false, error: "Stripe todavia no esta configurado en este servidor" });
            return;
        }

        const plan = String(req.body?.plan || "").toLowerCase();
        const priceId = PRECIO_POR_PLAN()[plan];

        if (!priceId) {
            res.status(400).json({ ok: false, error: "Plan invalido. Usa basico, plus o pro." });
            return;
        }

        try {
            const negocioId = req.negocioAutenticado.negocio_id;

            await asegurarFilaLicencia(pool, negocioId);

            const filaLicencia = await pool.query(
                `SELECT stripe_customer_id FROM public.licencias WHERE negocio_id = $1 LIMIT 1`,
                [negocioId]
            );

            let stripeCustomerId = filaLicencia.rows[0]?.stripe_customer_id || null;

            if (!stripeCustomerId) {
                const cliente = await stripe.customers.create({
                    email: req.negocioAutenticado.correo || undefined,
                    name: req.negocioAutenticado.nombre || undefined,
                    metadata: { negocio_id: String(negocioId), negocio_slug: req.negocioAutenticado.slug || "" }
                });

                stripeCustomerId = cliente.id;

                await pool.query(
                    `UPDATE public.licencias SET stripe_customer_id = $1, updated_at = NOW() WHERE negocio_id = $2`,
                    [stripeCustomerId, negocioId]
                );
            }

            const base = urlBase(req);
            // Whitelist estricta -- nunca se interpola el body del cliente
            // directo en la URL de redireccion (evita open redirect).
            const destino = req.body?.retorno === "/dueno" ? "/dueno" : "/";

            // Si este cliente tiene un cupon privado propio (restringido a
            // su stripe_customer_id, ej. un precio simbolico para un caso
            // especial), gana sobre el cupon publico de fundadores. Si no,
            // y el cupon de fundadores existe y todavia tiene cupo, se
            // aplica automaticamente (el cliente no tiene que escribir
            // nada) -- Stripe no permite combinar "discounts" con
            // "allow_promotion_codes" en la misma sesion, asi que solo
            // se ofrece el campo manual cuando ninguno de los dos aplica.
            const cuponCliente = await cuponClienteVigente(stripe, stripeCustomerId).catch(() => null);
            const cuponFundador = cuponCliente ? null : await cuponFundadorVigente(stripe).catch(() => null);
            const hayCupoFundador = cuponFundador?.active && (cuponFundador.restantes === null || cuponFundador.restantes > 0);
            const promoAAplicar = cuponCliente || (hayCupoFundador ? cuponFundador : null);

            const sesion = await stripe.checkout.sessions.create({
                mode: "subscription",
                customer: stripeCustomerId,
                line_items: [{ price: priceId, quantity: 1 }],
                success_url: `${base}${destino}?suscripcion=exito`,
                cancel_url: `${base}${destino}?suscripcion=cancelado`,
                metadata: { negocio_id: String(negocioId), plan },
                ...(promoAAplicar
                    ? { discounts: [{ promotion_code: promoAAplicar.id }] }
                    // Deja que el dueno escriba un codigo (ej. BIENVENIDA40)
                    // en el propio checkout de Stripe -- los codigos se
                    // crean y desactivan desde el dashboard de Stripe, sin
                    // tocar este codigo.
                    : { allow_promotion_codes: true })
            });

            res.json({ ok: true, url: sesion.url });
        } catch (error) {
            responderError(res, error);
        }
    });

    app.post("/suscripcion/portal", requerirSesionCuenta, async (req, res) => {
        const stripe = obtenerStripe();

        if (!stripe) {
            res.status(503).json({ ok: false, error: "Stripe todavia no esta configurado en este servidor" });
            return;
        }

        try {
            const negocioId = req.negocioAutenticado.negocio_id;

            const filaLicencia = await pool.query(
                `SELECT stripe_customer_id FROM public.licencias WHERE negocio_id = $1 LIMIT 1`,
                [negocioId]
            );

            const stripeCustomerId = filaLicencia.rows[0]?.stripe_customer_id;

            if (!stripeCustomerId) {
                res.status(400).json({ ok: false, error: "Todavia no tienes una suscripcion de Stripe. Contrata un plan primero." });
                return;
            }

            const destino = req.body?.retorno === "/dueno" ? "/dueno" : "/";

            const sesion = await stripe.billingPortal.sessions.create({
                customer: stripeCustomerId,
                return_url: `${urlBase(req)}${destino}`
            });

            res.json({ ok: true, url: sesion.url });
        } catch (error) {
            responderError(res, error);
        }
    });

    app.get("/suscripcion/estado", requerirSesionCuenta, async (req, res) => {
        try {
            const fila = await pool.query(
                `
                SELECT estado, plan, fecha_vencimiento, gracia_dias, ultimo_pago_at,
                       stripe_customer_id, stripe_subscription_id
                FROM public.licencias
                WHERE negocio_id = $1
                LIMIT 1
                `,
                [req.negocioAutenticado.negocio_id]
            );

            const licencia = fila.rows[0] || null;

            res.json({
                ok: true,
                suscripcion: licencia && {
                    estado: licencia.estado,
                    plan: licencia.plan,
                    fechaVencimiento: licencia.fecha_vencimiento,
                    graciaDias: licencia.gracia_dias,
                    ultimoPagoAt: licencia.ultimo_pago_at,
                    tieneStripe: Boolean(licencia.stripe_customer_id)
                },
                stripeConfigurado: Boolean(obtenerStripe())
            });
        } catch (error) {
            responderError(res, error);
        }
    });

    // Rutas de Admin para el descuento de fundadores -- viven bajo
    // /admin/api, ya protegido por validarAdminKey en server.js
    // (el middleware se registra antes de que este modulo cargue sus
    // rutas, asi que aplica igual sin importar en que archivo vivan).
    app.get("/admin/api/descuento-fundadores", async (_req, res) => {
        const stripe = obtenerStripe();

        if (!stripe) {
            res.status(503).json({ ok: false, error: "Stripe todavia no esta configurado en este servidor" });
            return;
        }

        try {
            const cupon = await cuponFundadorVigente(stripe);

            if (!cupon) {
                res.json({ ok: true, existe: false });
                return;
            }

            res.json({
                ok: true,
                existe: true,
                codigo: cupon.code,
                porcentaje: cupon.coupon?.percent_off ?? null,
                cupo: cupon.max_redemptions,
                usados: cupon.times_redeemed,
                restantes: cupon.restantes,
                activo: cupon.active
            });
        } catch (error) {
            responderError(res, error);
        }
    });

    app.post("/admin/api/descuento-fundadores", async (req, res) => {
        const stripe = obtenerStripe();

        if (!stripe) {
            res.status(503).json({ ok: false, error: "Stripe todavia no esta configurado en este servidor" });
            return;
        }

        const cupo = Number(req.body?.cupo);

        if (!Number.isInteger(cupo) || cupo < 1 || cupo > 1000) {
            res.status(400).json({ ok: false, error: "El cupo debe ser un numero entero entre 1 y 1000" });
            return;
        }

        try {
            const existente = await cuponFundadorVigente(stripe);

            if (existente) {
                res.status(409).json({
                    ok: false,
                    error: "Ya existe un cupon de fundadores -- desactivalo desde el dashboard de Stripe si quieres crear uno nuevo con otro cupo."
                });
                return;
            }

            const coupon = await stripe.coupons.create({
                percent_off: 40,
                duration: "forever",
                name: "Cliente fundador"
            });

            await stripe.promotionCodes.create({
                coupon: coupon.id,
                code: CODIGO_DESCUENTO_FUNDADOR,
                max_redemptions: cupo
            });

            const creado = await cuponFundadorVigente(stripe);

            res.json({
                ok: true,
                existe: true,
                codigo: creado.code,
                porcentaje: creado.coupon?.percent_off ?? null,
                cupo: creado.max_redemptions,
                usados: creado.times_redeemed,
                restantes: creado.restantes,
                activo: creado.active
            });
        } catch (error) {
            responderError(res, error);
        }
    });

    // Publica, sin autenticacion -- alimenta el banner de "lugares
    // fundador" del sitio de marketing. Expone SOLO el subconjunto
    // seguro (activo/restantes), nunca el codigo real, el cupo total
    // ni el objeto crudo de Stripe -- eso sigue siendo admin-only.
    app.get("/api/fundador-publico", async (_req, res) => {
        const stripe = obtenerStripe();

        if (!stripe) {
            res.json({ ok: true, activo: false, restantes: null });
            return;
        }

        try {
            const cupon = await cuponFundadorVigente(stripe);

            if (!cupon) {
                res.json({ ok: true, activo: false, restantes: null });
                return;
            }

            res.json({ ok: true, activo: cupon.active, restantes: cupon.restantes });
        } catch (error) {
            responderError(res, error);
        }
    });

    // Sin requerirSesionCuenta ni requerirAccesoNegocio -- Stripe no
    // manda ninguno de esos tokens. La unica autenticacion valida
    // aqui es la firma verificada contra STRIPE_WEBHOOK_SECRET.
    app.post("/webhooks/stripe", async (req, res) => {
        const stripe = obtenerStripe();

        if (!stripe || !config.stripeWebhookSecret) {
            res.status(503).send("Stripe todavia no esta configurado en este servidor");
            return;
        }

        let evento;

        try {
            evento = stripe.webhooks.constructEvent(
                req.rawBody,
                req.headers["stripe-signature"],
                config.stripeWebhookSecret
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
                // Reintento de un evento que ya se proceso -- se
                // confirma con 200 sin volver a aplicar nada.
                res.json({ ok: true, repetido: true });
                return;
            }

            await procesarEventoStripe(pool, stripe, evento);

            res.json({ ok: true });
        } catch (error) {
            responderError(res, error);
        }
    });
};

async function procesarEventoStripe(pool, stripe, evento) {
    switch (evento.type) {
        case "checkout.session.completed": {
            const sesion = evento.data.object;

            if (sesion.mode === "subscription" && sesion.subscription) {
                await pool.query(
                    `
                    UPDATE public.licencias
                    SET stripe_subscription_id = $1, updated_at = NOW()
                    WHERE stripe_customer_id = $2
                    `,
                    [sesion.subscription, sesion.customer]
                );
            }

            break;
        }

        case "invoice.paid": {
            const factura = evento.data.object;
            const priceId = factura.lines?.data?.[0]?.price?.id || null;
            const plan = priceId ? planPorPriceId(priceId) : null;

            const licenciaRow = await pool.query(
                `
                UPDATE public.licencias
                SET estado = 'activa',
                    fecha_vencimiento = NOW() + INTERVAL '1 month',
                    ultimo_pago_at = NOW(),
                    stripe_price_id = COALESCE($2, stripe_price_id),
                    plan = COALESCE($3, plan),
                    updated_at = NOW()
                WHERE stripe_customer_id = $1
                RETURNING negocio_id, plan
                `,
                [factura.customer, priceId, plan]
            );

            if (licenciaRow.rows.length > 0) {
                const negocioRow = await pool.query(
                    `SELECT correo, nombre FROM public.negocios WHERE id = $1`,
                    [licenciaRow.rows[0].negocio_id]
                );
                const negocio = negocioRow.rows[0];

                if (negocio?.correo) {
                    const montoTexto = factura.amount_paid != null
                        ? `$${(factura.amount_paid / 100).toFixed(2)} ${(factura.currency || "mxn").toUpperCase()}`
                        : "-";
                    const fechaTexto = new Date().toLocaleDateString("es-MX", { day: "numeric", month: "long", year: "numeric" });
                    const planTexto = NOMBRE_PLAN_LEGIBLE[licenciaRow.rows[0].plan] || licenciaRow.rows[0].plan || "-";

                    await enviarCorreoPagoConfirmado(negocio.correo, negocio.nombre, { planTexto, montoTexto, fechaTexto });
                }
            }

            break;
        }

        case "invoice.payment_failed": {
            const factura = evento.data.object;

            const licenciaRow = await pool.query(
                `SELECT negocio_id, gracia_dias FROM public.licencias WHERE stripe_customer_id = $1`,
                [factura.customer]
            );

            if (licenciaRow.rows.length > 0) {
                const { negocio_id, gracia_dias } = licenciaRow.rows[0];
                const negocioRow = await pool.query(
                    `SELECT correo, nombre FROM public.negocios WHERE id = $1`,
                    [negocio_id]
                );
                const negocio = negocioRow.rows[0];

                if (negocio?.correo) {
                    const montoTexto = factura.amount_due != null
                        ? `$${(factura.amount_due / 100).toFixed(2)} ${(factura.currency || "mxn").toUpperCase()}`
                        : null;
                    const fechaReintento = factura.next_payment_attempt
                        ? new Date(factura.next_payment_attempt * 1000).toLocaleDateString("es-MX", { day: "numeric", month: "long" })
                        : null;

                    await enviarCorreoPagoFallido(negocio.correo, negocio.nombre, {
                        montoTexto,
                        fechaReintento,
                        enlacePago: factura.hosted_invoice_url || null,
                        graciaDias: gracia_dias
                    });
                }
            }

            // No se toca fecha_vencimiento -- el periodo de gracia
            // que ya existia en el sistema de licencias sigue siendo
            // lo unico que controla el acceso; esto solo notifica.
            break;
        }

        case "customer.subscription.deleted": {
            const suscripcion = evento.data.object;

            await pool.query(
                `
                UPDATE public.licencias
                SET estado = 'cancelada', updated_at = NOW()
                WHERE stripe_customer_id = $1
                `,
                [suscripcion.customer]
            );

            break;
        }

        case "customer.subscription.updated": {
            const suscripcion = evento.data.object;
            const priceId = suscripcion.items?.data?.[0]?.price?.id || null;
            const plan = priceId ? planPorPriceId(priceId) : null;

            if (plan) {
                await pool.query(
                    `
                    UPDATE public.licencias
                    SET plan = $2, stripe_price_id = $3, updated_at = NOW()
                    WHERE stripe_customer_id = $1
                    `,
                    [suscripcion.customer, plan, priceId]
                );
            }

            break;
        }

        default:
            break;
    }
}

function planPorPriceId(priceId) {
    const mapa = PRECIO_POR_PLAN();
    const entrada = Object.entries(mapa).find(([, valor]) => valor === priceId);
    return entrada ? entrada[0] : null;
}

module.exports.procesarEventoStripe = procesarEventoStripe;
