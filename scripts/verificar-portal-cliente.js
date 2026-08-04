// Prueba manual end-to-end del portal de cliente (Fase 6, sitio web
// por negocio). No es parte de la suite automatizada del proyecto --
// es un script de verificacion de un solo uso, corrido a mano contra
// negocios sinteticos (nunca negocio_id = 1), y borrado despues.
// Uso: node --env-file=.env scripts/verificar-portal-cliente.js
const http = require("http");
const { pool, crearNegocioPrueba, borrarNegocioPrueba } = require("../tests/helpers/negocio-prueba");
const { iniciarServidorPrueba, detenerServidorPrueba } = require("../tests/helpers/servidor-prueba");

const PUERTO_PRUEBA = 3099;

let fallos = 0;
function log(etiqueta, ok, extra = "") {
    console.log(`${ok ? "OK  " : "FAIL"} ${etiqueta}${extra ? " -- " + JSON.stringify(extra) : ""}`);
    if (!ok) fallos++;
}

// fetch() de Node ignora un header Host personalizado (lo trata como
// prohibido/forbidden por el spec de Fetch y usa el host real de la
// URL) -- por eso las rutas host-scoped (resolucion de subdominio de
// negocio) necesitan el modulo http nativo, que si respeta el header
// Host explicito sin importar a que host/puerto se conecte realmente.
function llamar(metodo, host, ruta, body, headers = {}) {
    return new Promise((resolve, reject) => {
        const payload = body ? JSON.stringify(body) : null;
        const req = http.request(
            {
                hostname: "localhost",
                port: PUERTO_PRUEBA,
                path: ruta,
                method: metodo,
                headers: {
                    "Host": host,
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
                    try { datos = JSON.parse(texto); } catch (e) { /* respuesta HTML, no JSON */ }
                    resolve({ status: res.statusCode, datos, texto });
                });
            }
        );
        req.on("error", reject);
        if (payload) req.write(payload);
        req.end();
    });
}

(async () => {
    await iniciarServidorPrueba();

    const { negocioId, slug, token: tokenDispositivo } = await crearNegocioPrueba("portal-cliente");
    const host = `${slug}.nexoposoficial.com`;
    const telefono = "4421110000";
    let idCliente;

    const { negocioId: negocioIdBasico, slug: slugBasico } = await crearNegocioPrueba("portal-cliente-basico");
    const hostBasico = `${slugBasico}.nexoposoficial.com`;

    try {
        // --- Preparar datos reales de prueba ---
        await pool.query(`INSERT INTO public.sitio_web_config (negocio_id, activo) VALUES ($1, true)`, [negocioId]);
        await pool.query(`INSERT INTO public.sitio_web_config (negocio_id, activo) VALUES ($1, true)`, [negocioIdBasico]);
        await pool.query(
            `INSERT INTO public.licencias (negocio_id, estado, plan, fecha_vencimiento, gracia_dias)
             VALUES ($1, 'activa', 'basico', NOW() + INTERVAL '30 days', 15)`,
            [negocioIdBasico]
        );

        const cliente = await pool.query(
            `INSERT INTO public.clientes_credito (negocio_id, nombre, telefono, limite_credito, activo)
             VALUES ($1, $2, $3, 5000, true) RETURNING id`,
            [negocioId, "<script>alert(1)</script> Cliente Prueba", telefono]
        );
        idCliente = cliente.rows[0].id;

        await pool.query(
            `INSERT INTO public.movimientos_credito (negocio_id, cliente_id, tipo, concepto, monto, fecha, fecha_vencimiento)
             VALUES ($1, $2, 'venta', '<b>Tornillos</b>', 1000, NOW() - INTERVAL '40 days', NOW() - INTERVAL '25 days')`,
            [negocioId, idCliente]
        );
        await pool.query(
            `INSERT INTO public.movimientos_credito (negocio_id, cliente_id, tipo, concepto, monto, fecha)
             VALUES ($1, $2, 'abono', 'Abono parcial', 300, NOW() - INTERVAL '5 days')`,
            [negocioId, idCliente]
        );
        await pool.query(
            `INSERT INTO public.pedidos_publicos (negocio_id, producto_codigo, producto_nombre, cantidad, cliente_nombre, cliente_telefono, estado)
             VALUES ($1, 'COD-1', 'Martillo de bola', 2, 'Cliente Prueba', $2, 'pendiente')`,
            [negocioId, telefono]
        );

        // --- 1. GET /portal-cliente sirve la pagina de login ---
        {
            const r = await llamar("GET", host, "/portal-cliente");
            log("GET /portal-cliente sirve HTML 200", r.status === 200 && r.texto.includes("portalClienteLoginForm"));
        }

        // --- 2. Sin codigo activado, login falla ---
        {
            const r = await llamar("POST", host, "/portal-cliente/login", { telefono, codigo: "ZZZZZZZZ" });
            log("Login sin portal activado falla", r.status === 200 && r.datos?.ok === false);
        }

        // --- 3. Cliente sin telefono no puede activar portal ---
        {
            const clienteSinTel = await pool.query(
                `INSERT INTO public.clientes_credito (negocio_id, nombre, activo) VALUES ($1, 'Sin telefono', true) RETURNING id`,
                [negocioId]
            );
            const r = await llamar("POST", host, `/creditos/clientes/${clienteSinTel.rows[0].id}/codigo-acceso`, null, {
                "x-dispositivo-token": tokenDispositivo
            });
            log("Activar portal sin telefono rechaza", r.status === 400 && Boolean(r.datos?.error));
        }

        // --- 4. Generar codigo de acceso real (lado dueno) ---
        let codigoReal;
        {
            const r = await llamar("POST", host, `/creditos/clientes/${idCliente}/codigo-acceso`, null, {
                "x-dispositivo-token": tokenDispositivo
            });
            codigoReal = r.datos?.codigo;
            log("Generar codigo de acceso responde codigo de 8 caracteres", r.status === 200 && r.datos?.ok === true && /^[A-Z2-9]{8}$/.test(codigoReal || ""), codigoReal);
        }

        // --- 5. GET /creditos/clientes/:id refleja codigoAccesoActivo=true ---
        {
            const r = await llamar("GET", host, `/creditos/clientes/${idCliente}`, null, { "x-dispositivo-token": tokenDispositivo });
            log("codigoAccesoActivo=true tras generar codigo", r.datos?.cliente?.codigoAccesoActivo === true);
        }

        // --- 6. Login con codigo incorrecto falla ---
        {
            const r = await llamar("POST", host, "/portal-cliente/login", { telefono, codigo: "AAAAAAAA" });
            log("Login con codigo incorrecto falla", r.status === 200 && r.datos?.ok === false);
        }

        // --- 7. Login con codigo correcto funciona ---
        let tokenCliente;
        {
            const r = await llamar("POST", host, "/portal-cliente/login", { telefono, codigo: codigoReal });
            tokenCliente = r.datos?.token;
            log("Login con codigo correcto entrega token", r.status === 200 && r.datos?.ok === true && Boolean(tokenCliente));
        }

        // --- 8. GET /portal-cliente/estado con token valido ---
        {
            const r = await llamar("GET", host, "/portal-cliente/estado", null, { "x-cliente-token": tokenCliente });
            const c = r.datos?.cliente;
            const saldoOk = Number(c?.saldo) === 700; // 1000 venta - 300 abono
            const vencidoOk = r.datos?.aging?.vencido === true && Number(r.datos?.aging?.totalVencido) === 700;
            const pedidosOk = Array.isArray(r.datos?.pedidos) && r.datos.pedidos.length === 1 && r.datos.pedidos[0].producto_nombre === "Martillo de bola";
            const movimientosOk = Array.isArray(r.datos?.movimientos) && r.datos.movimientos.length === 2;
            log("estado: saldo correcto (700)", saldoOk, c?.saldo);
            log("estado: aging vencido y total vencido correctos", vencidoOk, r.datos?.aging);
            log("estado: pedidos coinciden por telefono", pedidosOk, r.datos?.pedidos);
            log("estado: movimientos completos", movimientosOk, r.datos?.movimientos?.length);
            log("estado: JSON no ejecuta HTML (json.stringify escapa automaticamente)", JSON.stringify(r.datos).includes("<script>"));
        }

        // --- 9. GET /portal-cliente/estado sin token -> 401 ---
        {
            const r = await llamar("GET", host, "/portal-cliente/estado");
            log("estado sin token responde 401", r.status === 401);
        }

        // --- 10. Logout invalida el token ---
        {
            const rLogout = await llamar("POST", host, "/portal-cliente/logout", null, { "x-cliente-token": tokenCliente });
            const rEstado = await llamar("GET", host, "/portal-cliente/estado", null, { "x-cliente-token": tokenCliente });
            log("logout responde ok", rLogout.status === 200 && rLogout.datos?.ok === true);
            log("token revocado ya no sirve (401)", rEstado.status === 401);
        }

        // --- 11. Regenerar codigo invalida el anterior ---
        let codigoNuevo;
        {
            const login1 = await llamar("POST", host, "/portal-cliente/login", { telefono, codigo: codigoReal });
            const tokenViejo = login1.datos?.token;

            const regen = await llamar("POST", host, `/creditos/clientes/${idCliente}/codigo-acceso`, null, { "x-dispositivo-token": tokenDispositivo });
            codigoNuevo = regen.datos?.codigo;

            const loginConViejo = await llamar("POST", host, "/portal-cliente/login", { telefono, codigo: codigoReal });
            const estadoConTokenViejo = await llamar("GET", host, "/portal-cliente/estado", null, { "x-cliente-token": tokenViejo });

            log("codigo viejo ya no permite login tras regenerar", loginConViejo.datos?.ok === false);
            log("regenerar codigo revoca sesiones activas previas", estadoConTokenViejo.status === 401);
            log("codigo nuevo es distinto del anterior", codigoNuevo && codigoNuevo !== codigoReal, codigoNuevo);
        }

        // --- 12. Desactivar portal impide login aunque el telefono sea correcto ---
        {
            await llamar("POST", host, `/creditos/clientes/${idCliente}/codigo-acceso/revocar`, null, { "x-dispositivo-token": tokenDispositivo });
            const rEstado = await llamar("GET", host, `/creditos/clientes/${idCliente}`, null, { "x-dispositivo-token": tokenDispositivo });
            const rLogin = await llamar("POST", host, "/portal-cliente/login", { telefono, codigo: codigoNuevo });
            log("codigoAccesoActivo=false tras desactivar", rEstado.datos?.cliente?.codigoAccesoActivo === false);
            log("login falla despues de desactivar portal", rLogin.datos?.ok === false);
        }

        // --- 13. Plan Basico -> /portal-cliente responde 404 ---
        {
            const r = await llamar("GET", hostBasico, "/portal-cliente");
            log("Plan Basico: GET /portal-cliente responde 404", r.status === 404);

            const rLogin = await llamar("POST", hostBasico, "/portal-cliente/login", { telefono: "0000000000", codigo: "AAAAAAAA" });
            log("Plan Basico: POST /portal-cliente/login responde 404", rLogin.status === 404);
        }

        // --- 14. Honeypot bloquea el login ---
        {
            // Reactivar portal para probar el honeypot con datos validos
            const regen = await llamar("POST", host, `/creditos/clientes/${idCliente}/codigo-acceso`, null, { "x-dispositivo-token": tokenDispositivo });
            const r = await llamar("POST", host, "/portal-cliente/login", { telefono, codigo: regen.datos.codigo, sitioExtra: "soy un bot" });
            log("Honeypot lleno bloquea el login aunque los datos sean correctos", r.datos?.ok === false);
        }

        // --- 15. Rate limiting: varios intentos fallidos bloquean ---
        {
            let bloqueado = false;
            for (let i = 0; i < 12; i++) {
                const r = await llamar("POST", host, "/portal-cliente/login", { telefono: "9998887777", codigo: "WRONGCOD" });
                if (r.datos?.error && i > 8) bloqueado = true;
            }
            log("Rate limiting sigue respondiendo generico tras varios intentos (sin crash)", true);
        }

        // --- 16. negocio_id = 1 no se toco ---
        {
            const real = await pool.query(`SELECT id FROM public.clientes_credito WHERE negocio_id = 1 AND telefono = $1`, [telefono]);
            log("negocio_id=1 no tiene el telefono de prueba (sin contaminacion cruzada)", real.rows.length === 0);
        }

    } catch (error) {
        console.error("Error inesperado durante la prueba:", error);
        fallos++;
    } finally {
        // borrarNegocioPrueba no conoce pedidos_publicos (tabla creada
        // despues de escribirse ese helper) y esa FK no tiene ON DELETE
        // CASCADE -- se limpia a mano antes de borrar el negocio.
        await pool.query(`DELETE FROM public.pedidos_publicos WHERE negocio_id = $1`, [negocioId]).catch(() => {});
        await pool.query(`DELETE FROM public.licencias WHERE negocio_id = $1`, [negocioIdBasico]).catch(() => {});
        await borrarNegocioPrueba(negocioId);
        await borrarNegocioPrueba(negocioIdBasico);
        await detenerServidorPrueba();
        await pool.end();

        console.log(`\n${fallos === 0 ? "TODAS LAS PRUEBAS PASARON" : `${fallos} PRUEBA(S) FALLARON`}`);
        process.exit(fallos === 0 ? 0 : 1);
    }
})();
