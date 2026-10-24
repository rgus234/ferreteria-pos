// Prueba de 45 dias de los negocios piloto: pantalla "Tu prueba" (dias que
// quedan, encuesta de opinion, decision de seguir), cobro de la cuota con
// Stripe y aviso por correo unos dias antes de que termine.
//
// Reglas (mismas que se le explican a la persona, ver piloto-condiciones.js):
//  - 45 dias sin costo y sin tarjeta; la cuenta nace con fecha de vencimiento.
//  - Si decide seguir, pone su tarjeta en Stripe Checkout con la prueba aun
//    corriendo: NO se cobra nada hasta el dia en que termina la prueba.
//  - Si no decide, ya existe el mecanismo de licencias: gracia y luego solo
//    consulta. Nada se borra y nada se cobra solo.
//
// El precio de $200/mes se crea (una sola vez, en el modo de Stripe en que
// corra el servidor) y se reconoce por su lookup_key, asi no depende de una
// variable de entorno que alguien tenga que acordarse de copiar.

const { responderError } = require("./error-utils");
const { obtenerStripe } = require("./stripe-server");
const {
    DIAS_PRUEBA_PILOTO,
    cuotaDeNegocio,
    DIAS_AVISO_FIN_PRUEBA,
    LLAVE_PRECIO_PILOTO,
    fechaLarga
} = require("./piloto-condiciones");
// Se llama por el modulo (no desestructurado) para poder sustituir los correos en pruebas.
const correos = require("./email");

const INTERVALO_REVISION_MS = 60 * 60 * 1000;
const MS_DIA = 24 * 60 * 60 * 1000;
// Stripe exige que trial_end quede al menos 48 horas en el futuro.
const MARGEN_TRIAL_STRIPE_MS = 49 * 60 * 60 * 1000;

const preciosPiloto = {};

function limpiar(valor, max) {
    return String(valor ?? "").replace(/\s+/g, " ").trim().slice(0, max);
}

function negocioIdDe(req) {
    return req.negocioDispositivo?.negocio_id ?? req.negocioAutenticado?.negocio_id ?? null;
}

// Busca el precio por su lookup_key; si no existe en este modo de Stripe, lo
// crea (producto + precio mensual de $200 MXN). Idempotente.
// Correos con los que se conoce a un negocio (el suyo y el de su invitacion) para respetar una cuota acordada.
async function cuotaDelNegocio(pool, negocioId) {
    const filas = await pool.query(
        `SELECT correo FROM public.negocios WHERE id = $1
         UNION SELECT correo FROM public.invitaciones_piloto WHERE negocio_id = $1`,
        [negocioId]
    );

    return cuotaDeNegocio(negocioId, filas.rows.map(f => f.correo));
}

async function asegurarPrecioPiloto(stripe, pool = null, negocioId = null) {
    const { cuota, llave } = pool && negocioId ? await cuotaDelNegocio(pool, negocioId) : cuotaDeNegocio(negocioId);
    if (preciosPiloto[llave]) return preciosPiloto[llave];

    const existentes = await stripe.prices.list({ lookup_keys: [llave], active: true, limit: 1 });

    if (existentes.data[0]) {
        preciosPiloto[llave] = existentes.data[0].id;
        return preciosPiloto[llave];
    }

    const producto = await stripe.products.create({
        name: "Nexo POS - Piloto",
        description: "Cuota mensual de los negocios piloto de Nexo: servidor y base de datos, Nexo IA y almacenamiento de fotos.",
        metadata: { tipo: "piloto" }
    });

    const precio = await stripe.prices.create({
        product: producto.id,
        currency: "mxn",
        unit_amount: cuota * 100,
        recurring: { interval: "month" },
        lookup_key: llave,
        nickname: "Piloto mensual"
    });

    preciosPiloto[llave] = precio.id;
    return preciosPiloto[llave];
}

function calcularEstado(fila, ahora = Date.now()) {
    const vence = fila.fecha_vencimiento ? new Date(fila.fecha_vencimiento).getTime() : null;
    const diasRestantes = vence === null ? null : Math.ceil((vence - ahora) / MS_DIA);
    const suscrito = Boolean(fila.stripe_subscription_id) && fila.estado === "activa";

    let fase = "prueba";

    if (suscrito) {
        fase = "suscrito";
    } else if (vence !== null && ahora > vence) {
        const graciaMs = Number(fila.gracia_dias || 0) * MS_DIA;
        fase = ahora <= vence + graciaMs ? "gracia" : "vencida";
    }

    const progreso = diasRestantes === null
        ? 0
        : Math.min(100, Math.max(0, Math.round(((DIAS_PRUEBA_PILOTO - diasRestantes) / DIAS_PRUEBA_PILOTO) * 100)));

    return {
        fase,
        diasRestantes,
        diasTotales: DIAS_PRUEBA_PILOTO,
        progreso,
        fechaFin: vence === null ? null : new Date(vence).toISOString(),
        fechaFinTexto: vence === null ? null : fechaLarga(vence)
    };
}

async function leerEstado(pool, negocioId) {
    const resultado = await pool.query(
        `SELECT l.estado, l.plan, l.fecha_vencimiento, l.gracia_dias, l.piloto, l.decision_piloto,
                l.stripe_subscription_id,
                (SELECT COUNT(*) FROM public.encuestas_piloto e WHERE e.negocio_id = l.negocio_id)::int AS encuestas
         FROM public.licencias l
         WHERE l.negocio_id = $1
         LIMIT 1`,
        [negocioId]
    );

    const fila = resultado.rows[0];

    if (!fila || !fila.piloto) return { esPiloto: false };

    return {
        esPiloto: true,
        ...calcularEstado(fila),
        cuota: (await cuotaDelNegocio(pool, negocioId)).cuota,
        decision: fila.decision_piloto || null,
        encuestaRespondida: fila.encuestas > 0
    };
}

// ----- Aviso unos dias antes de que termine la prueba

async function revisarFinesDePrueba(pool) {
    const resultado = await pool.query(
        `SELECT l.negocio_id, l.fecha_vencimiento, n.correo, n.nombre
         FROM public.licencias l
         JOIN public.negocios n ON n.id = l.negocio_id
         WHERE l.piloto = true
           AND l.estado = 'activa'
           AND l.stripe_subscription_id IS NULL
           AND l.aviso_fin_prueba_at IS NULL
           AND l.fecha_vencimiento IS NOT NULL
           AND l.fecha_vencimiento > NOW()
           AND l.fecha_vencimiento <= NOW() + make_interval(days => $1::int)
           AND COALESCE(n.correo, '') <> ''`,
        [DIAS_AVISO_FIN_PRUEBA]
    );

    for (const fila of resultado.rows) {
        try {
            const diasRestantes = Math.max(1, Math.ceil((new Date(fila.fecha_vencimiento) - Date.now()) / MS_DIA));
            const enviado = await correos.enviarCorreoFinPrueba({
                correo: fila.correo,
                nombre: fila.nombre,
                negocio: fila.nombre,
                fechaFinTexto: fechaLarga(fila.fecha_vencimiento),
                diasRestantes,
                enlace: "https://app.nexoposoficial.com"
            });

            // Solo se marca como avisado si el correo de verdad salio; si no,
            // la siguiente revision lo intenta otra vez.
            if (enviado && enviado.ok) {
                await pool.query(`UPDATE public.licencias SET aviso_fin_prueba_at = NOW() WHERE negocio_id = $1`, [fila.negocio_id]);
            }
        } catch (error) {
            console.warn("[prueba-piloto] No se pudo avisar el fin de prueba", fila.negocio_id, error.message);
        }
    }

    return resultado.rows.length;
}

function iniciarProgramador(pool) {
    async function correr() {
        try {
            await revisarFinesDePrueba(pool);
        } catch (error) {
            console.log("[prueba-piloto] Error revisando fines de prueba:", error.message);
        }
    }

    setTimeout(correr, 60 * 1000);
    setInterval(correr, INTERVALO_REVISION_MS);
}

module.exports = (app, pool, requerirSesionCuenta, requerirAccesoNegocio) => {
    app.get("/prueba-piloto/estado", requerirAccesoNegocio, async (req, res) => {
        try {
            const negocioId = negocioIdDe(req);
            res.json({ ok: true, ...(negocioId ? await leerEstado(pool, negocioId) : { esPiloto: false }) });
        } catch (error) {
            responderError(res, error);
        }
    });

    app.post("/prueba-piloto/encuesta", requerirAccesoNegocio, async (req, res) => {
        try {
            const negocioId = negocioIdDe(req);
            const estado = negocioId ? await leerEstado(pool, negocioId) : { esPiloto: false };

            if (!estado.esPiloto) {
                res.status(400).json({ ok: false, error: "Este negocio no esta en la prueba." });
                return;
            }

            const calificacion = Number(req.body?.calificacion);

            if (!Number.isInteger(calificacion) || calificacion < 1 || calificacion > 5) {
                res.status(400).json({ ok: false, error: "Elige una calificacion de 1 a 5." });
                return;
            }

            const loMejor = limpiar(req.body?.loMejor, 1000);
            const loQueFalta = limpiar(req.body?.loQueFalta, 1000);
            const seguiria = typeof req.body?.seguiria === "boolean" ? req.body.seguiria : null;

            const reciente = await pool.query(
                `SELECT COUNT(*)::int AS n FROM public.encuestas_piloto WHERE negocio_id = $1 AND created_at > NOW() - INTERVAL '1 day'`,
                [negocioId]
            );

            if (reciente.rows[0].n >= 5) {
                res.status(429).json({ ok: false, error: "Ya enviaste varias respuestas hoy. Gracias." });
                return;
            }

            await pool.query(
                `INSERT INTO public.encuestas_piloto (negocio_id, calificacion, lo_mejor, lo_que_falta, seguiria)
                 VALUES ($1, $2, $3, $4, $5)`,
                [negocioId, calificacion, loMejor, loQueFalta, seguiria]
            );

            const negocio = (await pool.query(`SELECT nombre, correo FROM public.negocios WHERE id = $1`, [negocioId])).rows[0];

            correos.enviarCorreoAvisoPiloto({
                asunto: `Encuesta de piloto: ${negocio?.nombre || negocioId} (${calificacion}/5)`,
                titulo: "Un piloto respondio la encuesta",
                lineas: [
                    ["Negocio", negocio?.nombre],
                    ["Correo", negocio?.correo],
                    ["Calificacion", `${calificacion} de 5`],
                    ["Lo mejor", loMejor],
                    ["Lo que le falta", loQueFalta],
                    ["Seguiria", seguiria === null ? "no contesto" : seguiria ? "si" : "no"]
                ]
            }).catch(() => {});

            res.json({ ok: true });
        } catch (error) {
            responderError(res, error);
        }
    });

    // Decision: seguir (abre Stripe Checkout) o no por ahora. Solo el dueno
    // con su sesion de cuenta, igual que /suscripcion/checkout.
    app.post("/prueba-piloto/decision", requerirSesionCuenta, async (req, res) => {
        try {
            const negocioId = req.negocioAutenticado.negocio_id;
            const decision = String(req.body?.decision || "");

            if (!["seguir", "no_por_ahora"].includes(decision)) {
                res.status(400).json({ ok: false, error: "Decision invalida." });
                return;
            }

            const estado = await leerEstado(pool, negocioId);

            if (!estado.esPiloto) {
                res.status(400).json({ ok: false, error: "Este negocio no esta en la prueba." });
                return;
            }

            if (estado.fase === "suscrito") {
                res.status(409).json({ ok: false, error: "Tu suscripcion ya esta activa." });
                return;
            }

            const negocio = req.negocioAutenticado;

            if (decision === "no_por_ahora") {
                await pool.query(
                    `UPDATE public.licencias SET decision_piloto = 'no_por_ahora', decision_piloto_at = NOW(), updated_at = NOW() WHERE negocio_id = $1`,
                    [negocioId]
                );

                correos.enviarCorreoAvisoPiloto({
                    asunto: `Piloto decidio no seguir por ahora: ${negocio.nombre || negocioId}`,
                    titulo: "Un piloto decidio no seguir por ahora",
                    lineas: [["Negocio", negocio.nombre], ["Correo", negocio.correo], ["Termina su prueba", estado.fechaFinTexto]]
                }).catch(() => {});

                res.json({ ok: true });
                return;
            }

            const stripe = obtenerStripe();

            if (!stripe) {
                res.status(503).json({ ok: false, error: "El pago todavia no esta disponible. Escribenos y lo resolvemos." });
                return;
            }

            const precioId = await asegurarPrecioPiloto(stripe, pool, negocioId);

            const filaLicencia = await pool.query(`SELECT stripe_customer_id, fecha_vencimiento FROM public.licencias WHERE negocio_id = $1`, [negocioId]);
            let clienteId = filaLicencia.rows[0]?.stripe_customer_id || null;

            if (clienteId) {
                // Un id guardado bajo otra llave (test vs live) no sirve en este modo.
                try {
                    await stripe.customers.retrieve(clienteId);
                } catch {
                    clienteId = null;
                }
            }

            if (!clienteId) {
                const cliente = await stripe.customers.create({
                    email: negocio.correo || undefined,
                    name: negocio.nombre || undefined,
                    metadata: { negocio_id: String(negocioId), negocio_slug: negocio.slug || "" }
                });
                clienteId = cliente.id;
                await pool.query(`UPDATE public.licencias SET stripe_customer_id = $1, updated_at = NOW() WHERE negocio_id = $2`, [clienteId, negocioId]);
            }

            const base = process.env.APP_BASE_URL || `${req.protocol}://${req.get("host")}`;
            const destino = req.body?.retorno === "/dueno" ? "/dueno" : "/";

            const vence = filaLicencia.rows[0]?.fecha_vencimiento ? new Date(filaLicencia.rows[0].fecha_vencimiento).getTime() : 0;
            // Con prueba aun corriendo, el primer cobro es el dia que termina;
            // si ya paso (o falta muy poco) se cobra desde hoy.
            const conPrueba = vence > Date.now() + MARGEN_TRIAL_STRIPE_MS;

            const sesion = await stripe.checkout.sessions.create({
                mode: "subscription",
                customer: clienteId,
                line_items: [{ price: precioId, quantity: 1 }],
                success_url: `${base}${destino}?suscripcion=exito`,
                cancel_url: `${base}${destino}?suscripcion=cancelado`,
                metadata: { negocio_id: String(negocioId), plan: "piloto" },
                subscription_data: {
                    metadata: { negocio_id: String(negocioId), plan: "piloto" },
                    ...(conPrueba ? { trial_end: Math.floor(vence / 1000) } : {})
                }
            });

            await pool.query(
                `UPDATE public.licencias SET decision_piloto = 'seguir', decision_piloto_at = NOW(), updated_at = NOW() WHERE negocio_id = $1`,
                [negocioId]
            );

            res.json({
                ok: true,
                url: sesion.url,
                primerCobroTexto: conPrueba ? fechaLarga(vence) : "hoy"
            });
        } catch (error) {
            responderError(res, error);
        }
    });

    // ----- Administrador: ver pilotos en prueba y extender plazos

    app.get("/admin/api/pilotos", async (_req, res) => {
        try {
            const resultado = await pool.query(
                `SELECT n.id AS negocio_id, n.nombre, n.correo, n.created_at,
                        l.estado, l.fecha_vencimiento, l.gracia_dias, l.decision_piloto, l.decision_piloto_at,
                        l.stripe_subscription_id, l.aviso_fin_prueba_at,
                        (SELECT COUNT(*)::int FROM public.encuestas_piloto e WHERE e.negocio_id = n.id) AS encuestas,
                        (SELECT ROUND(AVG(e.calificacion), 1) FROM public.encuestas_piloto e WHERE e.negocio_id = n.id) AS promedio
                 FROM public.licencias l
                 JOIN public.negocios n ON n.id = l.negocio_id
                 WHERE l.piloto = true
                 ORDER BY l.fecha_vencimiento ASC NULLS LAST`
            );

            res.json({
                ok: true,
                pilotos: resultado.rows.map(fila => ({
                    negocioId: fila.negocio_id,
                    nombre: fila.nombre,
                    correo: fila.correo,
                    creadoAt: fila.created_at,
                    decision: fila.decision_piloto,
                    decisionAt: fila.decision_piloto_at,
                    avisadoAt: fila.aviso_fin_prueba_at,
                    encuestas: fila.encuestas,
                    promedio: fila.promedio === null ? null : Number(fila.promedio),
                    ...calcularEstado(fila)
                }))
            });
        } catch (error) {
            responderError(res, error);
        }
    });

    app.get("/admin/api/pilotos/:negocioId/encuestas", async (req, res) => {
        try {
            const negocioId = Number(req.params.negocioId);

            if (!Number.isInteger(negocioId)) {
                res.status(400).json({ ok: false, error: "Negocio invalido" });
                return;
            }

            const resultado = await pool.query(
                `SELECT calificacion, lo_mejor, lo_que_falta, seguiria, created_at
                 FROM public.encuestas_piloto WHERE negocio_id = $1 ORDER BY created_at DESC LIMIT 20`,
                [negocioId]
            );

            res.json({ ok: true, encuestas: resultado.rows });
        } catch (error) {
            responderError(res, error);
        }
    });

    app.post("/admin/api/pilotos/:negocioId/extender", async (req, res) => {
        try {
            const negocioId = Number(req.params.negocioId);
            const dias = Number(req.body?.dias);

            if (!Number.isInteger(negocioId) || !Number.isInteger(dias) || dias < 1 || dias > 120) {
                res.status(400).json({ ok: false, error: "Indica cuantos dias extender (1 a 120)." });
                return;
            }

            // Se extiende desde la fecha de fin actual si aun no vence; si ya
            // vencio, desde hoy. Se reinicia el aviso para que vuelva a llegar.
            const resultado = await pool.query(
                `UPDATE public.licencias
                 SET fecha_vencimiento = GREATEST(COALESCE(fecha_vencimiento, NOW()), NOW()) + make_interval(days => $2::int),
                     estado = CASE WHEN estado = 'vencida' THEN 'activa' ELSE estado END,
                     aviso_fin_prueba_at = NULL,
                     updated_at = NOW()
                 WHERE negocio_id = $1 AND piloto = true
                 RETURNING fecha_vencimiento`,
                [negocioId, dias]
            );

            if (resultado.rows.length === 0) {
                res.status(404).json({ ok: false, error: "No es un negocio piloto." });
                return;
            }

            res.json({ ok: true, fechaVencimiento: resultado.rows[0].fecha_vencimiento });
        } catch (error) {
            responderError(res, error);
        }
    });

    iniciarProgramador(pool);
};

module.exports.asegurarPrecioPiloto = asegurarPrecioPiloto;
module.exports.calcularEstado = calcularEstado;
module.exports.revisarFinesDePrueba = revisarFinesDePrueba;
module.exports.LLAVE_PRECIO_PILOTO = LLAVE_PRECIO_PILOTO;
