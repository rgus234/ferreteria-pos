// Rutas de los timbres prepagados (ver timbres.js).
//   GET  /facturacion/timbres              saldo, paquetes y ultimos movimientos del negocio
//   POST /facturacion/timbres/comprar      { paquete } -> URL de pago de Stripe
//   POST /facturacion/timbres/confirmar    { sessionId } -> acredita la compra al volver de pagar (el webhook hace lo mismo; no se duplica)
//   GET  /admin/api/timbres                saldos de todos los negocios (clave de administrador)
//   POST /admin/api/timbres/regalar        { negocioId, cantidad, nota } (clave de administrador)
const crypto = require("crypto");
const { config } = require("./config");
const { responderError } = require("./error-utils");
const { negocioIdDeRequest } = require("./plan-enforcement");
const timbres = require("./timbres");
const { obtenerStripe } = require("./stripe-server");

function claveAdminValida(req) {
    const esperada = String(config.adminKey || "");
    const recibida = String(req.get("x-admin-key") || "");
    if (!esperada || recibida.length !== esperada.length) return false;
    return crypto.timingSafeEqual(Buffer.from(recibida), Buffer.from(esperada));
}

module.exports = (app, pool, requerirAccesoNegocio) => {
    app.get("/facturacion/timbres", requerirAccesoNegocio, async (req, res) => {
        try {
            const negocioId = negocioIdDeRequest(req);
            if (!negocioId) { res.status(401).json({ ok: false, error: "Este equipo no esta vinculado a ningun negocio" }); return; }
            res.json({ ok: true, ...(await timbres.resumen(pool, negocioId)) });
        } catch (error) { responderError(res, error); }
    });

    app.post("/facturacion/timbres/comprar", requerirAccesoNegocio, async (req, res) => {
        try {
            const negocioId = negocioIdDeRequest(req);
            if (!negocioId) { res.status(401).json({ ok: false, error: "Este equipo no esta vinculado a ningun negocio" }); return; }
            if (!timbres.habilitado()) { res.status(400).json({ ok: false, error: "La compra de timbres todavia no esta disponible." }); return; }
            const paquete = timbres.paquetePorId(String(req.body?.paquete || ""));
            if (!paquete) { res.status(400).json({ ok: false, error: "Elige un paquete de la lista." }); return; }
            const stripe = obtenerStripe();
            if (!stripe) { res.status(503).json({ ok: false, error: "Los pagos todavia no estan configurados en este servidor." }); return; }

            const negocio = (await pool.query(`SELECT correo, nombre FROM public.negocios WHERE id = $1`, [negocioId])).rows[0] || {};
            const licencia = (await pool.query(`SELECT stripe_customer_id FROM public.licencias WHERE negocio_id = $1 LIMIT 1`, [negocioId])).rows[0];
            const base = process.env.APP_BASE_URL || `${req.protocol}://${req.get("host")}`;

            const sesion = await stripe.checkout.sessions.create({
                mode: "payment",
                ...(licencia && licencia.stripe_customer_id ? { customer: licencia.stripe_customer_id } : { customer_email: negocio.correo || undefined }),
                line_items: [{
                    quantity: 1,
                    price_data: {
                        currency: "mxn",
                        unit_amount: paquete.centavos,
                        product_data: { name: `Paquete de ${paquete.timbres} timbres de facturación`, description: "Cada factura timbrada descuenta 1 timbre. Precio con IVA incluido." }
                    }
                }],
                metadata: { tipo: "timbres", paquete: paquete.id, negocio_id: String(negocioId) },
                success_url: `${base}/?timbres=exito&session_id={CHECKOUT_SESSION_ID}`,
                cancel_url: `${base}/?timbres=cancelado`
            });
            res.json({ ok: true, url: sesion.url });
        } catch (error) { responderError(res, error); }
    });

    app.post("/facturacion/timbres/confirmar", requerirAccesoNegocio, async (req, res) => {
        try {
            const negocioId = negocioIdDeRequest(req);
            if (!negocioId) { res.status(401).json({ ok: false, error: "Este equipo no esta vinculado a ningun negocio" }); return; }
            const stripe = obtenerStripe();
            const sessionId = String(req.body?.sessionId || "");
            if (!stripe || !/^cs_[A-Za-z0-9_]+$/.test(sessionId)) { res.status(400).json({ ok: false, error: "Sesion de pago no valida." }); return; }

            const sesion = await stripe.checkout.sessions.retrieve(sessionId);
            if (String(sesion.metadata?.negocio_id) !== String(negocioId)) { res.status(403).json({ ok: false, error: "Ese pago no es de este negocio." }); return; }
            const r = await timbres.acreditarDesdeSesion(pool, sesion);
            res.json({ ok: true, acreditado: Boolean(r.ok && !r.repetido), pendiente: sesion.payment_status !== "paid", ...(await timbres.resumen(pool, negocioId)) });
        } catch (error) { responderError(res, error); }
    });

    app.get("/admin/api/timbres", async (req, res) => {
        try {
            if (!claveAdminValida(req)) { res.status(401).json({ ok: false, error: "No autorizado" }); return; }
            await timbres.asegurarTablas(pool);
            const filas = (await pool.query(
                `SELECT s.negocio_id, n.nombre, s.saldo, s.comprados_total, s.consumidos_total, s.updated_at
                 FROM public.timbres_saldo s JOIN public.negocios n ON n.id = s.negocio_id ORDER BY s.updated_at DESC LIMIT 200`
            )).rows;
            res.json({ ok: true, activo: timbres.habilitado(), negocios: filas });
        } catch (error) { responderError(res, error); }
    });

    app.post("/admin/api/timbres/regalar", async (req, res) => {
        try {
            if (!claveAdminValida(req)) { res.status(401).json({ ok: false, error: "No autorizado" }); return; }
            const negocioId = Number(req.body?.negocioId);
            const cantidad = Number(req.body?.cantidad);
            if (!Number.isInteger(negocioId) || !Number.isInteger(cantidad) || cantidad < 1 || cantidad > 5000) { res.status(400).json({ ok: false, error: "negocioId y cantidad (1 a 5000) deben ser enteros." }); return; }
            const existe = (await pool.query(`SELECT 1 FROM public.negocios WHERE id = $1`, [negocioId])).rows[0];
            if (!existe) { res.status(404).json({ ok: false, error: "Ese negocio no existe." }); return; }
            const r = await timbres.acreditar(pool, { negocioId, cantidad, tipo: "regalo", nota: String(req.body?.nota || "Regalo de Nexo").slice(0, 120) });
            res.json({ ok: true, saldo: r.saldo });
        } catch (error) { responderError(res, error); }
    });
};
