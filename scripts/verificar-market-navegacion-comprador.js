// Prueba manual end-to-end de la Fase 1 "arquitectura de navegacion
// del comprador" de Nexo Market: /market/mi-cuenta (hub directo, sin
// "Elige a donde quieres entrar"), agregacion de pedidos/credito por
// persona entre tiendas, reestructura de URLs /market/tienda/{slug}
// con redirects legacy, y /market/carrito + /market/carrito-tiendas-json.
// No es parte de la suite automatizada -- script de un solo uso contra
// negocios/personas sinteticos (nunca negocio_id = 1), datos borrados
// al terminar.
// Uso: node --env-file=.env scripts/verificar-market-navegacion-comprador.js
const http = require("http");
const { pool, crearNegocioPrueba, crearProductoPrueba, borrarNegocioPrueba } = require("../tests/helpers/negocio-prueba");
const { crearPersonaPrueba, mintearSesionPruebaPersona, borrarPersonaPrueba } = require("../tests/helpers/persona-prueba");
const { iniciarServidorPrueba, detenerServidorPrueba } = require("../tests/helpers/servidor-prueba");

let fallos = 0;
function log(etiqueta, ok, extra = "") {
    console.log(`${ok ? "OK  " : "FAIL"} ${etiqueta}${extra ? " -- " + JSON.stringify(extra) : ""}`);
    if (!ok) fallos++;
}

function llamar(metodo, ruta, body, headers = {}) {
    return new Promise((resolve, reject) => {
        const payload = body ? (typeof body === "string" ? body : JSON.stringify(body)) : null;
        const req = http.request(
            {
                hostname: "localhost",
                port: 3099,
                path: ruta,
                method: metodo,
                headers: {
                    "Host": "nexoposoficial.com",
                    ...(payload ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload) } : {}),
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

    const negocioA = await crearNegocioPrueba("market-nav-a");
    const negocioB = await crearNegocioPrueba("market-nav-b");
    let personaId = null;

    try {
        for (const n of [negocioA, negocioB]) {
            await pool.query(`UPDATE public.negocios SET color = '#1067e8' WHERE id = $1`, [n.negocioId]);
            await pool.query(
                `INSERT INTO public.sitio_web_config (negocio_id, activo, mostrar_precios, mostrar_existencias) VALUES ($1, true, true, true)`,
                [n.negocioId]
            );
        }

        const productoA = await crearProductoPrueba(negocioA.negocioId, { nombre: "Martillo de prueba A", codigo: "PRUEBA-MART-A", precio: 199, stock: 10 });

        const persona = await crearPersonaPrueba("market-nav");
        personaId = persona.id;
        const token = await mintearSesionPruebaPersona(personaId);
        const authHeader = { "x-persona-token": token };

        // --- 1) /market/mi-cuenta -- sin sesion: login, nunca el gate viejo ---
        const sinSesion = await llamar("GET", "/market/mi-cuenta", null);
        log("GET /market/mi-cuenta sin sesion responde 200", sinSesion.status === 200);
        log("muestra el formulario de login", sinSesion.texto.includes("cuentaMarketLoginForm"));
        log("nunca muestra 'Elige a donde quieres entrar'", !sinSesion.texto.includes("Elige a donde quieres entrar"));

        // --- 2) /market/mi-cuenta -- con sesion: hub directo ---
        const conSesion = await llamar("GET", "/market/mi-cuenta", null, authHeader);
        log("GET /market/mi-cuenta con sesion responde 200", conSesion.status === 200);
        log("renderiza el hub (sidebar portal-*)", conSesion.texto.includes("portal-sidebar"));
        log("nunca muestra 'Elige a donde quieres entrar' (logueado)", !conSesion.texto.includes("Elige a donde quieres entrar"));
        log("incluye el punto de insercion del panel de administrador", conSesion.texto.includes("cuentaMarketAdminCard"));

        // --- 3) Vincular persona como cliente de credito en A y B, sembrar movimientos ---
        const clienteA = await pool.query(
            `INSERT INTO public.clientes_credito (nombre, telefono, limite_credito, activo, negocio_id, persona_id) VALUES ('Cliente A', '4771110001', 5000, true, $1, $2) RETURNING id`,
            [negocioA.negocioId, personaId]
        );
        const clienteB = await pool.query(
            `INSERT INTO public.clientes_credito (nombre, telefono, limite_credito, activo, negocio_id, persona_id) VALUES ('Cliente B', '4771110002', 3000, true, $1, $2) RETURNING id`,
            [negocioB.negocioId, personaId]
        );
        await pool.query(
            `INSERT INTO public.movimientos_credito (cliente_id, tipo, concepto, monto, negocio_id, subtotal, fecha_vencimiento) VALUES ($1, 'venta', 'Venta A vencida', 1200, $2, 1200, NOW() - INTERVAL '5 days')`,
            [clienteA.rows[0].id, negocioA.negocioId]
        );
        await pool.query(
            `INSERT INTO public.movimientos_credito (cliente_id, tipo, concepto, monto, negocio_id, subtotal, fecha_vencimiento) VALUES ($1, 'venta', 'Venta B vigente', 500, $2, 500, NOW() + INTERVAL '10 days')`,
            [clienteB.rows[0].id, negocioB.negocioId]
        );

        const miCredito = await llamar("GET", "/personas/mi-credito", null, authHeader);
        log("GET /personas/mi-credito responde ok", miCredito.status === 200 && miCredito.datos?.ok === true);
        log("trae credito de las 2 tiendas vinculadas", (miCredito.datos?.creditos || []).length === 2);
        const creditoA = (miCredito.datos?.creditos || []).find(c => c.negocio.slug === negocioA.slug);
        const creditoB = (miCredito.datos?.creditos || []).find(c => c.negocio.slug === negocioB.slug);
        log("negocio A: saldo y vencido correctos", creditoA && Number(creditoA.saldo) === 1200 && creditoA.vencido === true, creditoA);
        log("negocio B: saldo correcto y NO vencido", creditoB && Number(creditoB.saldo) === 500 && creditoB.vencido === false, creditoB);

        const negociosCliente = await llamar("GET", "/personas/negocios-cliente", null, authHeader);
        log("GET /personas/negocios-cliente trae las 2 tiendas", (negociosCliente.datos?.negocios || []).length === 2);

        // --- 4) Pedido con persona logueada guarda persona_id; anonimo no ---
        const pedidoConSesion = await llamar(
            "POST", `/market/tienda/${negocioA.slug}/catalogo/pedido-carrito`,
            { items: [{ codigo: "PRUEBA-MART-A", cantidad: 1 }], clienteNombre: "Gustavo Prueba", clienteTelefono: "4779998877", tipo: "pedido" },
            authHeader
        );
        log("pedido con sesion de persona -> ok", pedidoConSesion.status === 200 && pedidoConSesion.datos?.ok === true, pedidoConSesion.datos);

        const pedidoAnonimo = await llamar(
            "POST", `/market/tienda/${negocioA.slug}/catalogo/pedido-carrito`,
            { items: [{ codigo: "PRUEBA-MART-A", cantidad: 2 }], clienteNombre: "Anonimo Prueba", clienteTelefono: "4779998866", tipo: "pedido" }
        );
        log("pedido anonimo -> ok", pedidoAnonimo.status === 200 && pedidoAnonimo.datos?.ok === true, pedidoAnonimo.datos);

        const filasPedidos = await pool.query(
            `SELECT persona_id, cliente_nombre FROM public.pedidos_publicos WHERE negocio_id = $1 ORDER BY id`,
            [negocioA.negocioId]
        );
        const filaConSesion = filasPedidos.rows.find(f => f.cliente_nombre === "Gustavo Prueba");
        const filaAnonima = filasPedidos.rows.find(f => f.cliente_nombre === "Anonimo Prueba");
        log("fila con sesion tiene persona_id correcto", filaConSesion && filaConSesion.persona_id === personaId);
        log("fila anonima tiene persona_id NULL", filaAnonima && filaAnonima.persona_id === null);

        const misPedidos = await llamar("GET", "/personas/mis-pedidos", null, authHeader);
        log("GET /personas/mis-pedidos responde ok", misPedidos.status === 200 && misPedidos.datos?.ok === true);
        log("solo trae el pedido con sesion (no el anonimo)",
            (misPedidos.datos?.pedidos || []).length === 1 && misPedidos.datos.pedidos[0].producto_codigo === "PRUEBA-MART-A");

        // --- 5) Reestructura de URLs + redirects legacy (2 capas: primero
        // "/market/ferreteria/{slug}" paso a ser legacy de "/market/tienda/
        // {slug}", y el prefijo aun mas viejo "/market/{slug}" ahora salta
        // directo al canonico actual sin pasar por el intermedio) ---
        const nuevaTienda = await llamar("GET", `/market/tienda/${negocioA.slug}`, null);
        log("GET /market/tienda/{slug} responde 200", nuevaTienda.status === 200);
        log("incluye la franja de marca de la tienda", nuevaTienda.texto.includes("market-tienda-franja"));

        const tiendaFerreteriaLegacy = await llamar("GET", `/market/ferreteria/${negocioA.slug}`, null);
        log("GET /market/ferreteria/{slug} (legacy) -> 301", tiendaFerreteriaLegacy.status === 301);
        log("redirige a /market/tienda/{slug}", tiendaFerreteriaLegacy.headers.location === `/market/tienda/${negocioA.slug}`);

        const viejaTienda = await llamar("GET", `/market/${negocioA.slug}`, null);
        log("GET /market/{slug} (mas viejo) -> 301", viejaTienda.status === 301);
        log("redirige directo a /market/tienda/{slug} (sin pasar por /ferreteria/)", viejaTienda.headers.location === `/market/tienda/${negocioA.slug}`);

        const viejoCatalogoCodigo = await llamar("GET", `/market/${negocioA.slug}/catalogo/PRUEBA-MART-A`, null);
        log("GET /market/{slug}/catalogo/{codigo} (mas viejo) -> 301", viejoCatalogoCodigo.status === 301);
        log("redirige a .../catalogo/{codigo} (no a /producto/)",
            viejoCatalogoCodigo.headers.location === `/market/tienda/${negocioA.slug}/catalogo/PRUEBA-MART-A`);

        const aliasProducto = await llamar("GET", `/market/tienda/${negocioA.slug}/producto/PRUEBA-MART-A`, null);
        log("alias /producto/{codigo} responde 200 (misma pagina)", aliasProducto.status === 200 && aliasProducto.texto.includes("Martillo de prueba A"));

        const postFerreteriaLegacyCompat = await llamar(
            "POST", `/market/ferreteria/${negocioA.slug}/catalogo/pedido-carrito`,
            { items: [{ codigo: "PRUEBA-MART-A", cantidad: 1 }], clienteNombre: "Compat Legacy Ferreteria", clienteTelefono: "4779990001", tipo: "pedido" }
        );
        log("POST legacy (/ferreteria/) sigue funcionando durante la ventana de gracia", postFerreteriaLegacyCompat.status === 200 && postFerreteriaLegacyCompat.datos?.ok === true);

        const postLegacyCompat = await llamar(
            "POST", `/market/${negocioA.slug}/catalogo/pedido-carrito`,
            { items: [{ codigo: "PRUEBA-MART-A", cantidad: 1 }], clienteNombre: "Compat Legacy", clienteTelefono: "4779990000", tipo: "pedido" }
        );
        log("POST legacy (sin prefijo de tienda) sigue funcionando durante la ventana de gracia", postLegacyCompat.status === 200 && postLegacyCompat.datos?.ok === true);

        const viejaMiCuenta = await llamar("GET", "/mi-cuenta?oficio=herramientas&tab=registro", null);
        log("GET /mi-cuenta -> 301", viejaMiCuenta.status === 301);
        log("redirige a /market/mi-cuenta preservando query", viejaMiCuenta.headers.location === "/market/mi-cuenta?oficio=herramientas&tab=registro");

        // --- 6) Orden de rutas: las fijas no deben ser tragadas por /market/:slug ---
        const buscarJson = await llamar("GET", "/market/buscar-json?buscar=martillo", null);
        log("/market/buscar-json no es tragada por /market/:slug", buscarJson.status === 200 && buscarJson.datos?.ok !== undefined);

        const buscarPagina = await llamar("GET", "/market/buscar", null);
        log("/market/buscar responde 200 (pagina real)", buscarPagina.status === 200 && buscarPagina.texto.includes("Nexo Market"));

        const carritoPagina = await llamar("GET", "/market/carrito", null);
        log("/market/carrito responde 200, no 301 de la ruta legacy", carritoPagina.status === 200);

        const checkoutPagina = await llamar("GET", `/market/checkout?tienda=${negocioA.slug}`, null);
        log("/market/checkout responde 200", checkoutPagina.status === 200 && checkoutPagina.texto.includes("Finalizar pedido"));

        const miCuentaOtraVez = await llamar("GET", "/market/mi-cuenta", null, authHeader);
        log("/market/mi-cuenta sigue respondiendo 200 (no 301 legacy)", miCuentaOtraVez.status === 200);

        // --- 7) Carrito cruzado -- POST /market/carrito-tiendas-json ---
        const tiendasCarrito = await llamar("POST", "/market/carrito-tiendas-json", { slugs: [negocioA.slug, negocioB.slug, "no-existe-xyz"] });
        log("carrito-tiendas-json responde ok", tiendasCarrito.status === 200 && tiendasCarrito.datos?.ok === true);
        log("trae exactamente las 2 tiendas reales (filtra la inexistente)",
            (tiendasCarrito.datos?.tiendas || []).length === 2 &&
            (tiendasCarrito.datos.tiendas || []).every(t => [negocioA.slug, negocioB.slug].includes(t.slug)));

        // --- 8) Regresion: el subdominio propio de la tienda sigue igual ---
        const catalogoSubdominio = await new Promise((resolve, reject) => {
            const req = http.request(
                { hostname: "localhost", port: 3099, path: `/catalogo/PRUEBA-MART-A`, method: "GET", headers: { "Host": `${negocioA.slug}.nexoposoficial.com` } },
                res => { let texto = ""; res.on("data", c => texto += c); res.on("end", () => resolve({ status: res.statusCode, texto })); }
            );
            req.on("error", reject);
            req.end();
        });
        log("subdominio propio sigue sirviendo /catalogo/{codigo} igual", catalogoSubdominio.status === 200 && catalogoSubdominio.texto.includes("tenant-header"));

        console.log(`\n${fallos === 0 ? "TODO OK" : fallos + " FALLO(S)"}`);
    } finally {
        // Orden importa: clientes_credito.persona_id referencia a
        // personas -- hay que borrar los negocios (que arrastran sus
        // clientes_credito) ANTES de borrar la persona, o el DELETE de
        // personas truena por la llave foranea.
        await borrarNegocioPrueba(negocioA.negocioId);
        await borrarNegocioPrueba(negocioB.negocioId);
        await borrarPersonaPrueba(personaId);
        await detenerServidorPrueba();
        await pool.end();
    }

    process.exit(fallos === 0 ? 0 : 1);
})().catch(async error => {
    console.error("FALLO INESPERADO:", error);
    process.exit(1);
});
