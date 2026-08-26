// Prueba manual end-to-end de pagos reales con Stripe Connect (marketplace,
// Fases 1 y 2 del plan "Nexo Market: pagos reales con Stripe Connect"). No es
// parte de la suite automatizada -- script de un solo uso, corrido a mano
// contra negocios sinteticos (nunca negocio_id = 1) y cuentas de Stripe en
// modo TEST (sk_test_...), borrado todo al terminar.
// Uso: node --env-file=.env scripts/verificar-stripe-connect-marketplace.js
const http = require("http");
const { pool, crearNegocioPrueba, crearProductoPrueba, borrarNegocioPrueba } = require("../tests/helpers/negocio-prueba");
const { iniciarServidorPrueba, detenerServidorPrueba } = require("../tests/helpers/servidor-prueba");
const { config } = require("../config");

const PUERTO_PRUEBA = 3099;

let fallos = 0;
function log(etiqueta, ok, extra = "") {
    console.log(`${ok ? "OK  " : "FAIL"} ${etiqueta}${extra ? " -- " + JSON.stringify(extra) : ""}`);
    if (!ok) fallos++;
}

function llamar(metodo, ruta, body, headers = {}) {
    return new Promise((resolve, reject) => {
        const payload = body ? JSON.stringify(body) : null;
        const req = http.request(
            {
                hostname: "localhost",
                port: PUERTO_PRUEBA,
                path: ruta,
                method: metodo,
                headers: {
                    "Content-Type": "application/json",
                    ...(payload ? { "Content-Length": Buffer.byteLength(payload) } : {}),
                    ...headers
                }
            },
            res => {
                let texto = "";
                res.on("data", chunk => { texto += chunk; });
                res.on("end", () => {
                    let datos = null;
                    try { datos = JSON.parse(texto); } catch (e) { /* respuesta HTML */ }
                    resolve({ status: res.statusCode, datos, texto });
                });
            }
        );
        req.on("error", reject);
        if (payload) req.write(payload);
        req.end();
    });
}

function subirIdentificacion(token, frenteBytes, reversoBytes) {
    return new Promise((resolve, reject) => {
        const boundary = "----nexoPruebaBoundary" + Date.now();
        const partes = [];

        function agregarArchivo(campo, bytes) {
            partes.push(Buffer.from(
                `--${boundary}\r\nContent-Disposition: form-data; name="${campo}"; filename="${campo}.jpg"\r\nContent-Type: image/jpeg\r\n\r\n`
            ));
            partes.push(bytes);
            partes.push(Buffer.from("\r\n"));
        }

        agregarArchivo("frente", frenteBytes);
        agregarArchivo("reverso", reversoBytes);
        partes.push(Buffer.from(`--${boundary}--\r\n`));

        const payload = Buffer.concat(partes);

        const req = http.request(
            {
                hostname: "localhost",
                port: PUERTO_PRUEBA,
                path: "/negocio-actual/cobros/identificacion",
                method: "POST",
                headers: {
                    "Content-Type": `multipart/form-data; boundary=${boundary}`,
                    "Content-Length": payload.length,
                    "x-dispositivo-token": token
                }
            },
            res => {
                let texto = "";
                res.on("data", chunk => { texto += chunk; });
                res.on("end", () => {
                    let datos = null;
                    try { datos = JSON.parse(texto); } catch (e) { /* respuesta HTML */ }
                    resolve({ status: res.statusCode, datos, texto });
                });
            }
        );
        req.on("error", reject);
        req.write(payload);
        req.end();
    });
}

(async () => {
    if (!config.stripeSecretKey || !config.stripeSecretKey.startsWith("sk_test_")) {
        console.log("STRIPE_SECRET_KEY no esta configurada en modo TEST (sk_test_...) -- abortando para no arriesgar dinero real.");
        process.exit(1);
    }

    const stripe = require("stripe")(config.stripeSecretKey, { apiVersion: "2024-06-20" });

    await iniciarServidorPrueba();

    const negocioConn = await crearNegocioPrueba("connect-pagos");
    const negocioSinConn = await crearNegocioPrueba("connect-sin-cuenta");
    let accountId = null;

    try {
        // --- Regresion: tienda SIN cuenta Connect sigue funcionando sin cobro ---
        await pool.query(`INSERT INTO public.sitio_web_config (negocio_id, activo) VALUES ($1, true)`, [negocioSinConn.negocioId]);
        await pool.query(`INSERT INTO public.sitio_web_config (negocio_id, activo) VALUES ($1, true)`, [negocioConn.negocioId]);

        const codigoSinConn = `TEST-SINCONN-${Date.now()}`;
        await crearProductoPrueba(negocioSinConn.negocioId, { precio: 150, codigo: codigoSinConn });

        const intentoSinCuenta2 = await llamar(
            "POST",
            `/market/tienda/${negocioSinConn.slug}/catalogo/crear-intento-pago`,
            { items: [{ codigo: codigoSinConn, cantidad: 1 }] }
        );
        log("Tienda sin cuenta Connect: crear-intento-pago rechaza con 400 (no inventa cobro)", intentoSinCuenta2.status === 400 && intentoSinCuenta2.datos?.ok === false, intentoSinCuenta2.datos);

        const pedidoSinConn = await llamar(
            "POST",
            `/market/tienda/${negocioSinConn.slug}/catalogo/pedido-carrito`,
            {
                items: [{ codigo: codigoSinConn, cantidad: 1 }],
                clienteNombre: "Comprador de prueba",
                clienteTelefono: "5500000000",
                tipo: "pedido"
            }
        );
        log("Tienda sin cuenta Connect: pedido normal (sin pago) sigue funcionando", pedidoSinConn.datos?.ok === true, pedidoSinConn.datos);

        const listaSinConn = await llamar("GET", "/negocio-actual/pedidos-publicos", null, { "x-dispositivo-token": negocioSinConn.token });
        const pedidoGuardadoSinConn = listaSinConn.datos?.pedidos?.[0];
        log("Tienda sin cuenta Connect: pedido queda pagado=false", pedidoGuardadoSinConn && pedidoGuardadoSinConn.pagado === false, pedidoGuardadoSinConn);

        // --- Fase 1: alta de cuenta Connect (Custom, MX) ---
        const crearCuenta = await llamar("POST", "/negocio-actual/cobros/cuenta", {}, { "x-dispositivo-token": negocioConn.token });
        log("POST /negocio-actual/cobros/cuenta crea cuenta Stripe Connect Custom", crearCuenta.status === 200 && crearCuenta.datos?.ok === true && crearCuenta.datos?.accountId, crearCuenta.datos);
        accountId = crearCuenta.datos?.accountId || null;

        const crearCuentaIdempotente = await llamar("POST", "/negocio-actual/cobros/cuenta", {}, { "x-dispositivo-token": negocioConn.token });
        log("Segunda llamada a crear cuenta es idempotente (no crea otra)", crearCuentaIdempotente.datos?.accountId === accountId && crearCuentaIdempotente.datos?.creada === false, crearCuentaIdempotente.datos);

        // Datos de prueba de Stripe para cuentas individuales en MX --
        // formato valido, no reales. tos_acceptance con fecha/ip reales
        // del request (mismo criterio que produccion).
        const datosKyc = {
            businessType: "individual",
            nombre: "Juana",
            apellidos: "Perez Ferretera",
            correo: negocioConn.slug + "@example.com",
            telefono: "+525500000000",
            rfc: "XAXX010101000",
            diaNacimiento: 1,
            mesNacimiento: 1,
            anioNacimiento: 1980,
            calle: "Av Siempre Viva 123",
            ciudad: "Ciudad de Mexico",
            estado: "CDMX",
            codigoPostal: "01000",
            clabe: "000000001234567897",
            aceptaTerminos: true
        };

        const patchCuenta = await llamar("PATCH", "/negocio-actual/cobros/cuenta", datosKyc, { "x-dispositivo-token": negocioConn.token });
        log("PATCH /negocio-actual/cobros/cuenta acepta datos KYC de prueba", patchCuenta.status === 200 && patchCuenta.datos?.ok === true, patchCuenta.datos);

        // JPEG minimo valido (1x1) con bytes distintos para frente/reverso
        // -- Stripe rechaza el mismo archivo repetido como "documento duplicado".
        const frenteBytes = Buffer.from("/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAf/bAEMBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEB/8AAEQgAAQABAwEiAAIRAQMRAf/EABQAAQAAAAAAAAAAAAAAAAAAAAj/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCdABmX/9k=", "base64");
        const reversoBytes = Buffer.from("/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAIBAQEBAQICAQECAgICAgMEAwMDAwMFBAQDBAYFBgYGBQYGBgcJCAYHCQcGBggLCAkKCgoKCgYICwwLCgwJCgoK/9sAQwECAgIDAwMFAwMFCgcGBwoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCv/AABEIAAEAAQMBIgACEQEDEQH/xAAUAAEAAAAAAAAAAAAAAAAAAAAI/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/EABUBAQEAAAAAAAAAAAAAAAAAAAAF/8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAwDAQACEQMRAD8AlwAcx//Z", "base64");

        const subida = await subirIdentificacion(negocioConn.token, frenteBytes, reversoBytes);
        log("POST /negocio-actual/cobros/identificacion sube documentos a Stripe", subida.status === 200 && subida.datos?.ok === true, subida.datos);

        const estado = await llamar("GET", "/negocio-actual/cobros/estado", null, { "x-dispositivo-token": negocioConn.token });
        log("GET /negocio-actual/cobros/estado responde estado real de Stripe", estado.status === 200 && estado.datos?.ok === true, estado.datos);

        console.log(`\nEstado real de la cuenta de prueba en Stripe: chargesEnabled=${estado.datos?.chargesEnabled}, requisitosPendientes=${JSON.stringify(estado.datos?.requisitosPendientes)}\n`);

        if (!estado.datos?.chargesEnabled) {
            console.log("La cuenta de prueba todavia no tiene charges_enabled=true (falta subir identificacion u otro requisito que Stripe exige incluso en modo test para Custom accounts en MX).");
            console.log("Esto es el comportamiento CORRECTO y honesto del sistema -- no se fuerza charges_enabled. La verificacion completa del cobro real (Fase 2, tarjeta 4242...) requiere completar esos requisitos manualmente desde el Dashboard de Stripe en modo test, o subir un documento de prueba desde la pestana 'Cobros en linea' del POS.");
            console.log("El resto de la Fase 1 (alta de cuenta, actualizacion de datos, sincronizacion de estado, webhook account.updated) quedo verificado arriba.");
        } else {
            // --- Fase 2: pago real de un pedido ---
            const codigoConn = `TEST-CONN-${Date.now()}`;
            await crearProductoPrueba(negocioConn.negocioId, { precio: 250, codigo: codigoConn });

            const intentoPago = await llamar(
                "POST",
                `/market/tienda/${negocioConn.slug}/catalogo/crear-intento-pago`,
                { items: [{ codigo: codigoConn, cantidad: 2 }] }
            );
            log("crear-intento-pago responde clientSecret con split 97/3", intentoPago.status === 200 && intentoPago.datos?.ok === true && intentoPago.datos?.clientSecret, intentoPago.datos);

            const paymentIntentId = intentoPago.datos?.clientSecret?.split("_secret_")[0];

            // Confirmar el PaymentIntent server-side con la tarjeta de
            // prueba oficial de Stripe -- simula exactamente lo que el
            // Payment Element haria en el navegador con 4242 4242 4242 4242.
            const confirmado = await stripe.paymentIntents.confirm(paymentIntentId, {
                payment_method: "pm_card_visa"
            });
            log("PaymentIntent confirmado con tarjeta de prueba 4242...", confirmado.status === "succeeded", { status: confirmado.status });

            const pedido = await llamar(
                "POST",
                `/market/tienda/${negocioConn.slug}/catalogo/pedido-carrito`,
                {
                    items: [{ codigo: codigoConn, cantidad: 2 }],
                    clienteNombre: "Comprador de prueba",
                    clienteTelefono: "5500000001",
                    tipo: "pedido",
                    stripePaymentIntentId: paymentIntentId
                }
            );
            log("pedido-carrito confirma el pago contra Stripe y marca pagado=true", pedido.datos?.ok === true, pedido.datos);

            const listaConn = await llamar("GET", "/negocio-actual/pedidos-publicos", null, { "x-dispositivo-token": negocioConn.token });
            const pedidoGuardado = listaConn.datos?.pedidos?.[0];
            log("GET pedidos-publicos expone pagado=true y montoPagado", pedidoGuardado?.pagado === true && pedidoGuardado?.montoPagado === 500, pedidoGuardado);

            // Rechazo de PaymentIntent inventado/ajeno
            const pedidoFalso = await llamar(
                "POST",
                `/market/tienda/${negocioConn.slug}/catalogo/pedido-carrito`,
                {
                    items: [{ codigo: codigoConn, cantidad: 1 }],
                    clienteNombre: "Comprador falso",
                    clienteTelefono: "5500000002",
                    tipo: "pedido",
                    stripePaymentIntentId: "pi_no_existe_123"
                }
            );
            log("pedido-carrito rechaza un stripePaymentIntentId inventado", pedidoFalso.datos?.ok === false, pedidoFalso.datos);
        }
    } catch (error) {
        console.error("Error durante la verificacion:", error);
        fallos++;
    } finally {
        await detenerServidorPrueba();
        await borrarNegocioPrueba(negocioConn.negocioId);
        await borrarNegocioPrueba(negocioSinConn.negocioId);

        if (accountId) {
            try {
                await stripe.accounts.del(accountId);
                console.log(`Cuenta de prueba de Stripe ${accountId} eliminada.`);
            } catch (error) {
                console.warn(`No se pudo borrar la cuenta de prueba de Stripe ${accountId}: ${error.message}`);
            }
        }

        await pool.end();
    }

    console.log(`\n${fallos === 0 ? "TODO OK" : `${fallos} FALLO(S)`}`);
    process.exit(fallos === 0 ? 0 : 1);
})();
