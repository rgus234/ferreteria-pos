// Prueba manual end-to-end del rediseno "Mi cuenta" (portal de
// cliente, /portal-cliente) estilo marketplace: menu lateral, tarjeta
// de resumen con datos reales, credito con gauge, pedidos, productos
// destacados reales, y placeholders honestos ("Proximamente") para lo
// que todavia no tiene backend. No es parte de la suite automatizada
// -- script de un solo uso contra un negocio sintetico (nunca
// negocio_id = 1), datos borrados al terminar.
// Uso: node --env-file=.env scripts/verificar-portal-cliente-rediseno.js
const http = require("http");
const crypto = require("crypto");
const { pool, crearNegocioPrueba, crearProductoPrueba, borrarNegocioPrueba } = require("../tests/helpers/negocio-prueba");
const { iniciarServidorPrueba, detenerServidorPrueba } = require("../tests/helpers/servidor-prueba");
const { hashPassword } = require("../password-utils");

let fallos = 0;
function log(etiqueta, ok, extra = "") {
    console.log(`${ok ? "OK  " : "FAIL"} ${etiqueta}${extra ? " -- " + JSON.stringify(extra) : ""}`);
    if (!ok) fallos++;
}

function llamar(metodo, host, ruta, body, headers = {}) {
    return new Promise((resolve, reject) => {
        const payload = body ? (typeof body === "string" ? body : JSON.stringify(body)) : null;
        const req = http.request(
            {
                hostname: "localhost",
                port: 3099,
                path: ruta,
                method: metodo,
                headers: {
                    "Host": host,
                    ...(payload ? { "Content-Length": Buffer.byteLength(payload) } : {}),
                    ...headers
                }
            },
            res => {
                let texto = "";
                res.on("data", chunk => { texto += chunk; });
                res.on("end", () => {
                    let datos = null;
                    try { datos = JSON.parse(texto); } catch (e) { /* HTML */ }
                    resolve({ status: res.statusCode, headers: res.headers, datos, texto });
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
    const negocio = await crearNegocioPrueba("portal-rediseno");
    const host = `${negocio.slug}.nexoposoficial.com`;

    try {
        await pool.query(`UPDATE public.negocios SET color = '#1067e8' WHERE id = $1`, [negocio.negocioId]);
        await pool.query(
            `INSERT INTO public.sitio_web_config (negocio_id, activo, mostrar_precios, mostrar_existencias, whatsapp) VALUES ($1, true, true, true, '4441234567')`,
            [negocio.negocioId]
        );

        // Producto destacado real -- confirma que la seccion nueva
        // "Productos destacados de {negocio}" usa datos reales.
        const codigoProducto = "PRUEBA-MARTILLO";
        const nombreProducto = "Martillo destacado prueba";
        const producto = await crearProductoPrueba(negocio.negocioId, { nombre: nombreProducto, codigo: codigoProducto, precio: 250, stock: 12 });
        await pool.query(`UPDATE public.productos SET destacado = true WHERE id = $1`, [producto.id]);

        // Cliente de credito con codigo de acceso real (mismo flujo que
        // usa el dueno desde Creditos -> activarPortalCliente).
        const codigoAcceso = "PRUEBA123";
        const telefono = "4779998877";
        const cliente = await pool.query(
            `INSERT INTO public.clientes_credito (nombre, telefono, limite_credito, activo, negocio_id, codigo_acceso_hash)
             VALUES ('Cliente de Prueba', $1, 5000, true, $2, $3) RETURNING id`,
            [telefono, negocio.negocioId, hashPassword(codigoAcceso)]
        );
        const clienteId = cliente.rows[0].id;

        // Movimientos: una venta vencida (para el estado "Vencido" y el
        // gauge) y una venta futura (para "Proximo pago").
        await pool.query(
            `INSERT INTO public.movimientos_credito (cliente_id, tipo, concepto, monto, negocio_id, subtotal, fecha_vencimiento)
             VALUES ($1, 'venta', 'Material vencido', 1200, $2, 1200, NOW() - INTERVAL '5 days')`,
            [clienteId, negocio.negocioId]
        );
        await pool.query(
            `INSERT INTO public.movimientos_credito (cliente_id, tipo, concepto, monto, negocio_id, subtotal, fecha_vencimiento)
             VALUES ($1, 'venta', 'Material vigente', 800, $2, 800, NOW() + INTERVAL '10 days')`,
            [clienteId, negocio.negocioId]
        );

        // Un pedido real de este mismo telefono.
        await pool.query(
            `INSERT INTO public.pedidos_publicos (negocio_id, producto_codigo, producto_nombre, cantidad, cliente_nombre, cliente_telefono, estado)
             VALUES ($1, $2, $3, 2, 'Cliente de Prueba', $4, 'pendiente')`,
            [negocio.negocioId, codigoProducto, nombreProducto, telefono]
        );

        // --- 1) Pagina de login carga con el nuevo CSS/estructura ---
        const paginaInicial = await llamar("GET", host, "/portal-cliente", null);
        log("GET /portal-cliente responde 200", paginaInicial.status === 200);
        log("incluye estilos del rediseno (.portal-shell)", paginaInicial.texto.includes(".portal-shell"));
        log("incluye menu lateral con Proximamente", paginaInicial.texto.includes("portal-sidebar-proximamente"));
        log("incluye window.NEXO_PORTAL con el slug real", paginaInicial.texto.includes(`"slug":"${negocio.slug}"`));
        log("incluye whatsapp normalizado en NEXO_PORTAL", paginaInicial.texto.includes('"whatsapp":"52'));
        log("titulo de destacados usa el nombre real del negocio", paginaInicial.texto.includes("Productos destacados de Prueba automatizada portal-rediseno"));
        log("aparece el producto destacado real", paginaInicial.texto.includes("Martillo destacado prueba"));
        log("no promete pago minimo", !paginaInicial.texto.includes("Pago minimo") && !paginaInicial.texto.includes("pago mínimo"));
        log("no promete contrasena tradicional", !paginaInicial.texto.toLowerCase().includes("cambiar contrase"));
        log("incluye 'Acceso y seguridad'", paginaInicial.texto.includes("Acceso y seguridad"));

        // --- 2) Login real con telefono + codigo ---
        const login = await llamar("POST", host, "/portal-cliente/login", JSON.stringify({ telefono, codigo: codigoAcceso, sitioExtra: "" }), { "Content-Type": "application/json" });
        log("login con telefono+codigo funciona", login.status === 200 && login.datos?.ok === true, login.datos);
        const token = login.datos?.token;

        // --- 3) Estado real: credito, aging, pedidos ---
        const estado = await llamar("GET", host, "/portal-cliente/estado", null, { "x-cliente-token": token });
        log("GET /portal-cliente/estado responde ok", estado.status === 200 && estado.datos?.ok === true);
        log("limite_credito real", Number(estado.datos?.cliente?.limite_credito) === 5000);
        log("saldo real (1200+800)", Number(estado.datos?.cliente?.saldo) === 2000);
        log("aging marca vencido", estado.datos?.aging?.vencido === true);
        log("totalVencido real (1200)", Number(estado.datos?.aging?.totalVencido) === 1200);
        log("trae 1 pedido real", Array.isArray(estado.datos?.pedidos) && estado.datos.pedidos.length === 1);
        log("ventasPendientes trae la venta futura para 'proximo pago'", (estado.datos?.aging?.ventasPendientes || []).some(v => v.fechaVencimiento));

        // --- 4) Aislamiento: sin token no hay acceso ---
        const sinToken = await llamar("GET", host, "/portal-cliente/estado", null);
        log("sin token -> 401", sinToken.status === 401);

        // --- 5) Logout revoca la sesion ---
        const logout = await llamar("POST", host, "/portal-cliente/logout", null, { "x-cliente-token": token });
        log("logout responde ok", logout.status === 200 && logout.datos?.ok === true);
        const trasLogout = await llamar("GET", host, "/portal-cliente/estado", null, { "x-cliente-token": token });
        log("token revocado -> 401", trasLogout.status === 401);

        console.log(`\n${fallos === 0 ? "TODO OK" : fallos + " FALLO(S)"}`);
    } finally {
        await borrarNegocioPrueba(negocio.negocioId);
        await detenerServidorPrueba();
        await pool.end();
    }

    process.exit(fallos === 0 ? 0 : 1);
})().catch(error => {
    console.error("FALLO INESPERADO:", error);
    process.exit(1);
});
