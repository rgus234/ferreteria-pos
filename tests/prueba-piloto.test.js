// Prueba de 45 dias de los negocios piloto: estado, encuesta, decision de
// seguir (Stripe), aviso antes del fin, cobro de la cuota y panel de admin.
//
// Lo que se protege:
//  - solo los negocios marcados como piloto ven "Tu prueba";
//  - la encuesta se valida y no se puede inundar;
//  - "seguir" abre un Checkout de Stripe (modo de prueba) y "no por ahora" no cobra nada;
//  - la factura de $0 de la prueba NO cuenta como pago ni mueve mal el vencimiento,
//    y cada cobro mensual lo deja en el fin del periodo que marca Stripe;
//  - el aviso de fin de prueba sale una sola vez, solo a quien toca, y solo se
//    marca como enviado si el correo de verdad salio.

// Sin llave de correo el servidor de prueba NO manda correos reales.
process.env.RESEND_API_KEY = "";

const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { pool, crearNegocioPrueba, crearSesionCuentaPrueba, borrarNegocioPrueba } = require("./helpers/negocio-prueba");
const { iniciarServidorPrueba, detenerServidorPrueba, BASE_URL } = require("./helpers/servidor-prueba");
const { calcularEstado, revisarFinesDePrueba } = require("../prueba-piloto-server");
const { procesarEventoStripe, obtenerStripe } = require("../stripe-server");
const { LLAVE_PRECIO_PILOTO } = require("../piloto-condiciones");
const correos = require("../email");

const ADMIN = { "x-admin-key": process.env.ADMIN_KEY, "Content-Type": "application/json" };
const MS_DIA = 86400000;

let negocio;
let sesion;
let otro;
const clientesStripe = [];

function headers(extra = {}) {
    return { "Content-Type": "application/json", "x-dispositivo-token": negocio.token, ...extra };
}

async function ponerLicencia(negocioId, { dias, piloto = true, suscripcion = null, estado = "activa", cliente = null }) {
    await pool.query(
        `UPDATE public.licencias
         SET piloto = $2, plan = 'prueba', estado = $5, gracia_dias = 15,
             fecha_vencimiento = NOW() + make_interval(secs => $3::float8),
             stripe_subscription_id = $4, stripe_customer_id = COALESCE($6, stripe_customer_id),
             aviso_fin_prueba_at = NULL, decision_piloto = NULL, decision_piloto_at = NULL, ultimo_pago_at = NULL
         WHERE negocio_id = $1`,
        [negocioId, piloto, dias * 86400, suscripcion, estado, cliente]
    );
}

async function licencia(negocioId) {
    return (await pool.query(`SELECT * FROM public.licencias WHERE negocio_id = $1`, [negocioId])).rows[0];
}

before(async () => {
    await iniciarServidorPrueba();
    negocio = await crearNegocioPrueba("prueba-piloto");
    otro = await crearNegocioPrueba("prueba-piloto-otro");
    sesion = await crearSesionCuentaPrueba(negocio.negocioId);

    for (const id of [negocio.negocioId, otro.negocioId]) {
        await pool.query(
            `INSERT INTO public.licencias (negocio_id, estado, plan, fecha_vencimiento, gracia_dias)
             VALUES ($1, 'activa', 'prueba', NOW() + INTERVAL '30 days', 15)
             ON CONFLICT (negocio_id) DO NOTHING`,
            [id]
        );
    }
});

after(async () => {
    const stripe = obtenerStripe();

    for (const id of clientesStripe) {
        try { await stripe.customers.del(id); } catch { /* ya no existe */ }
    }

    await pool.query(`DELETE FROM public.stripe_webhook_events WHERE id LIKE 'evt_test_piloto_%'`).catch(() => {});

    for (const n of [negocio, otro]) {
        if (n) await borrarNegocioPrueba(n.negocioId);
    }

    await detenerServidorPrueba();
    await pool.end();
});

test("calcularEstado: prueba, gracia, vencida y suscrito", () => {
    const base = { estado: "activa", gracia_dias: 15, stripe_subscription_id: null };
    const en = dias => new Date(Date.now() + dias * MS_DIA).toISOString();

    const prueba = calcularEstado({ ...base, fecha_vencimiento: en(38) });
    assert.equal(prueba.fase, "prueba");
    assert.equal(prueba.diasRestantes, 38);
    assert.equal(prueba.diasTotales, 45);
    assert.ok(prueba.progreso >= 15 && prueba.progreso <= 17, `progreso ${prueba.progreso}`);

    assert.equal(calcularEstado({ ...base, fecha_vencimiento: en(-3) }).fase, "gracia");
    assert.equal(calcularEstado({ ...base, fecha_vencimiento: en(-20) }).fase, "vencida");
    assert.equal(calcularEstado({ ...base, fecha_vencimiento: en(10), stripe_subscription_id: "sub_1" }).fase, "suscrito");
    assert.equal(calcularEstado({ ...base, fecha_vencimiento: en(100) }).progreso, 0, "nunca negativo");
    assert.equal(calcularEstado({ ...base, fecha_vencimiento: en(-1) }).progreso, 100);
});

test("solo un negocio piloto ve su prueba", async () => {
    await ponerLicencia(negocio.negocioId, { dias: 38, piloto: false });

    let datos = await (await fetch(`${BASE_URL}/prueba-piloto/estado`, { headers: headers() })).json();
    assert.equal(datos.ok, true);
    assert.equal(datos.esPiloto, false);

    await ponerLicencia(negocio.negocioId, { dias: 38 });

    datos = await (await fetch(`${BASE_URL}/prueba-piloto/estado`, { headers: headers() })).json();
    assert.equal(datos.esPiloto, true);
    assert.equal(datos.fase, "prueba");
    // El reloj de la base de datos puede ir unos segundos adelantado del de esta computadora.
    assert.ok([38, 39].includes(datos.diasRestantes), `dias restantes ${datos.diasRestantes}`);
    assert.equal(datos.cuota, 200);
    assert.equal(datos.encuestaRespondida, false);
    assert.match(datos.fechaFinTexto, /\d+ de \w+/);

    const sinDispositivo = await fetch(`${BASE_URL}/prueba-piloto/estado`);
    assert.ok([401, 403].includes(sinDispositivo.status), "sin dispositivo no hay acceso");
});

test("la encuesta valida la calificacion, se guarda y limita el abuso", async () => {
    await ponerLicencia(negocio.negocioId, { dias: 30 });
    const enviar = cuerpo => fetch(`${BASE_URL}/prueba-piloto/encuesta`, { method: "POST", headers: headers(), body: JSON.stringify(cuerpo) });

    assert.equal((await enviar({ calificacion: 0 })).status, 400);
    assert.equal((await enviar({ calificacion: 6 })).status, 400);
    assert.equal((await enviar({ calificacion: "abc" })).status, 400);
    assert.equal((await enviar({})).status, 400);

    const ok = await enviar({ calificacion: 4, loMejor: "Cobrar rapido", loQueFalta: "Mas reportes", seguiria: true });
    assert.equal(ok.status, 200);

    const guardada = (await pool.query(`SELECT * FROM public.encuestas_piloto WHERE negocio_id = $1`, [negocio.negocioId])).rows[0];
    assert.equal(guardada.calificacion, 4);
    assert.equal(guardada.lo_mejor, "Cobrar rapido");
    assert.equal(guardada.seguiria, true);

    const estado = await (await fetch(`${BASE_URL}/prueba-piloto/estado`, { headers: headers() })).json();
    assert.equal(estado.encuestaRespondida, true);

    for (let i = 0; i < 4; i++) await enviar({ calificacion: 5 });
    assert.equal((await enviar({ calificacion: 5 })).status, 429, "no se puede inundar");

    // Un negocio que no es piloto no responde la encuesta.
    await ponerLicencia(negocio.negocioId, { dias: 30, piloto: false });
    assert.equal((await enviar({ calificacion: 5 })).status, 400);
    await ponerLicencia(negocio.negocioId, { dias: 30 });
});

test("decision: exige sesion de cuenta, rechaza valores raros y 'no por ahora' no cobra nada", async () => {
    await ponerLicencia(negocio.negocioId, { dias: 20 });
    const decidir = (decision, token = sesion) => fetch(`${BASE_URL}/prueba-piloto/decision`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ decision })
    });

    assert.equal((await decidir("seguir", null)).status, 401, "sin sesion no se decide");
    assert.equal((await decidir("quiero-gratis")).status, 400);

    const respuesta = await decidir("no_por_ahora");
    assert.equal(respuesta.status, 200);

    const fila = await licencia(negocio.negocioId);
    assert.equal(fila.decision_piloto, "no_por_ahora");
    assert.equal(fila.stripe_subscription_id, null, "no se creo ninguna suscripcion");
});

test("seguir abre un Checkout de Stripe con la cuota de $200 al mes", { skip: !process.env.STRIPE_SECRET_KEY }, async () => {
    await ponerLicencia(negocio.negocioId, { dias: 30 });

    const respuesta = await fetch(`${BASE_URL}/prueba-piloto/decision`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${sesion}` },
        body: JSON.stringify({ decision: "seguir" })
    });
    const datos = await respuesta.json();

    assert.equal(respuesta.status, 200, JSON.stringify(datos));
    assert.match(datos.url, /^https:\/\/checkout\.stripe\.com\//);
    assert.match(datos.primerCobroTexto, /\d+ de \w+/, "dice cuando seria el primer cobro");

    const fila = await licencia(negocio.negocioId);
    assert.equal(fila.decision_piloto, "seguir");
    assert.ok(fila.stripe_customer_id, "quedo ligado a un cliente de Stripe");
    clientesStripe.push(fila.stripe_customer_id);

    // El precio de la cuota existe, es de $200 MXN mensuales y es unico.
    const stripe = obtenerStripe();
    const precios = await stripe.prices.list({ lookup_keys: [LLAVE_PRECIO_PILOTO], active: true });
    assert.equal(precios.data.length, 1);
    assert.equal(precios.data[0].unit_amount, 20000);
    assert.equal(precios.data[0].currency, "mxn");
    assert.equal(precios.data[0].recurring.interval, "month");
});

test("la factura de $0 de la prueba no cuenta como pago; cada cobro mensual deja el fin del periodo de Stripe", async () => {
    const cliente = `cus_test_piloto_${Date.now()}`;
    await ponerLicencia(otro.negocioId, { dias: 20, cliente });

    const finPrueba = Math.floor((Date.now() + 20 * MS_DIA) / 1000);
    const factura = (monto, finPeriodo) => ({
        id: `evt_test_piloto_${Math.random().toString(36).slice(2)}`,
        type: "invoice.paid",
        data: { object: {
            customer: cliente,
            amount_paid: monto,
            currency: "mxn",
            lines: { data: [{ price: { id: "price_x", lookup_key: LLAVE_PRECIO_PILOTO }, period: { end: finPeriodo } }] }
        } }
    });

    // Factura de $0 al poner la tarjeta en plena prueba.
    await procesarEventoStripe(pool, null, factura(0, finPrueba));
    let fila = await licencia(otro.negocioId);
    assert.equal(fila.plan, "prueba", "el plan no cambia");
    assert.equal(fila.ultimo_pago_at, null, "$0 no es un pago");
    assert.ok(Math.abs(new Date(fila.fecha_vencimiento) / 1000 - finPrueba) < 2, "el vencimiento sigue siendo el fin de la prueba");

    // Primer cobro real el dia que termina la prueba: el siguiente periodo.
    const finMes = finPrueba + 30 * 86400;
    await procesarEventoStripe(pool, null, factura(20000, finMes));
    fila = await licencia(otro.negocioId);
    assert.ok(fila.ultimo_pago_at, "el cobro real si queda registrado");
    assert.ok(Math.abs(new Date(fila.fecha_vencimiento) / 1000 - finMes) < 2);
    assert.equal(fila.estado, "activa");
    assert.equal(fila.plan, "prueba");
});

test("al poner la tarjeta se registra la decision de seguir y se avisa", async () => {
    const cliente = `cus_test_piloto_ck_${Date.now()}`;
    await ponerLicencia(otro.negocioId, { dias: 20, cliente });

    await procesarEventoStripe(pool, null, {
        id: `evt_test_piloto_ck_${Date.now()}`,
        type: "checkout.session.completed",
        data: { object: { mode: "subscription", subscription: "sub_test_piloto", customer: cliente, metadata: { plan: "piloto" } } }
    });

    const fila = await licencia(otro.negocioId);
    assert.equal(fila.stripe_subscription_id, "sub_test_piloto");
    assert.equal(fila.decision_piloto, "seguir");
});

test("el aviso de fin de prueba sale una vez, solo a quien toca, y solo se marca si el correo salio", async () => {
    const llamadas = [];
    const original = correos.enviarCorreoFinPrueba;

    try {
        correos.enviarCorreoFinPrueba = async datos => { llamadas.push(datos.correo); return { ok: true }; };
        const mios = () => llamadas.filter(c => c.startsWith("test-auto-prueba-piloto"));

        // Faltan 5 dias: toca avisar.
        await ponerLicencia(negocio.negocioId, { dias: 5 });
        // Faltan 30: todavia no.
        await ponerLicencia(otro.negocioId, { dias: 30 });

        await revisarFinesDePrueba(pool);
        assert.equal(mios().length, 1, "solo el que esta a 5 dias");
        assert.ok(mios()[0].startsWith(negocio.slug), "es el correcto");
        assert.ok((await licencia(negocio.negocioId)).aviso_fin_prueba_at, "quedo marcado");
        assert.equal((await licencia(otro.negocioId)).aviso_fin_prueba_at, null);

        await revisarFinesDePrueba(pool);
        assert.equal(mios().length, 1, "no se repite");

        // Ya suscrito: no se le avisa que su prueba termina.
        await ponerLicencia(negocio.negocioId, { dias: 3, suscripcion: "sub_ya" });
        await revisarFinesDePrueba(pool);
        assert.equal(mios().length, 1, "un suscrito no recibe el aviso");

        // Un correo que no salio no se marca como avisado: se reintenta despues.
        correos.enviarCorreoFinPrueba = async () => ({ ok: false, error: "sin llave" });
        await ponerLicencia(negocio.negocioId, { dias: 3 });
        await revisarFinesDePrueba(pool);
        assert.equal((await licencia(negocio.negocioId)).aviso_fin_prueba_at, null, "no se marca si no salio");

        // Un negocio que no es piloto nunca recibe este aviso.
        correos.enviarCorreoFinPrueba = async datos => { llamadas.push(datos.correo); return { ok: true }; };
        const antes = mios().length;
        await ponerLicencia(negocio.negocioId, { dias: 3, piloto: false });
        await revisarFinesDePrueba(pool);
        assert.equal(mios().length, antes);
    } finally {
        correos.enviarCorreoFinPrueba = original;
    }
});

test("admin: lista los pilotos con su seguimiento y puede extender la prueba", async () => {
    await ponerLicencia(negocio.negocioId, { dias: 10 });

    const lista = await (await fetch(`${BASE_URL}/admin/api/pilotos`, { headers: ADMIN })).json();
    assert.equal(lista.ok, true);
    const mio = lista.pilotos.find(p => p.negocioId === negocio.negocioId);
    assert.ok(mio, "aparece en la lista");
    assert.equal(mio.fase, "prueba");
    assert.ok([10, 11].includes(mio.diasRestantes), `dias restantes ${mio.diasRestantes}`);
    assert.equal(mio.encuestas, 5);
    assert.ok(mio.promedio >= 4);

    const sinClave = await fetch(`${BASE_URL}/admin/api/pilotos`);
    assert.equal(sinClave.status, 401, "sin clave de admin no se ve");

    const encuestas = await (await fetch(`${BASE_URL}/admin/api/pilotos/${negocio.negocioId}/encuestas`, { headers: ADMIN })).json();
    assert.equal(encuestas.encuestas.length, 5);

    const extender = dias => fetch(`${BASE_URL}/admin/api/pilotos/${negocio.negocioId}/extender`, { method: "POST", headers: ADMIN, body: JSON.stringify({ dias }) });
    assert.equal((await extender(0)).status, 400);
    assert.equal((await extender(500)).status, 400);

    const respuesta = await extender(15);
    assert.equal(respuesta.status, 200);
    const fila = await licencia(negocio.negocioId);
    const dias = (new Date(fila.fecha_vencimiento) - Date.now()) / MS_DIA;
    assert.ok(dias > 24.9 && dias < 25.1, `10 + 15 dias (${dias})`);
    assert.equal(fila.aviso_fin_prueba_at, null, "el aviso se reinicia");

    await ponerLicencia(negocio.negocioId, { dias: 10, piloto: false });
    assert.equal((await extender(15)).status, 404, "solo pilotos");
});

test("a Ferreteria Olimpico se le respeta la cuota de $100; los demas pilotos pagan $200", () => {
    const { cuotaDeNegocio, LLAVES_PRECIO_PILOTO_RECONOCIDAS } = require("../piloto-condiciones");

    assert.deepEqual(cuotaDeNegocio(1), { cuota: 100, llave: "nexo_piloto_mensual" });
    assert.equal(cuotaDeNegocio(2).cuota, 200);
    assert.equal(cuotaDeNegocio(null).cuota, 200);
    assert.ok(LLAVES_PRECIO_PILOTO_RECONOCIDAS.includes(cuotaDeNegocio(1).llave) && LLAVES_PRECIO_PILOTO_RECONOCIDAS.includes(cuotaDeNegocio(2).llave));
});
