// Prueba manual end-to-end del modulo "Nexo Market" dentro del POS
// (Fase 2 admin, ver plan): resumen de visibilidad/destacados/pedidos
// de Market, lista de productos destacados/en oferta, y el origen real
// (sitio vs market) guardado en pedidos_publicos. No es parte de la
// suite automatizada -- negocio sintetico, nunca negocio_id = 1, datos
// borrados al terminar.
// Uso: node --env-file=.env scripts/verificar-market-admin.js
const http = require("http");
const { pool, crearNegocioPrueba, crearProductoPrueba, borrarNegocioPrueba } = require("../tests/helpers/negocio-prueba");
const { iniciarServidorPrueba, detenerServidorPrueba } = require("../tests/helpers/servidor-prueba");

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
                    ...(payload ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload) } : {}),
                    ...headers
                }
            },
            res => {
                let texto = "";
                res.on("data", chunk => { texto += chunk; });
                res.on("end", () => {
                    let datos = null;
                    try { datos = JSON.parse(texto); } catch (e) { /* no era JSON */ }
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
    const negocio = await crearNegocioPrueba("market-admin");
    const host = `${negocio.slug}.nexoposoficial.com`;
    const authHeader = { "x-dispositivo-token": negocio.token };

    try {
        // crearNegocioPrueba deja plan='demo', que plan-enforcement.js
        // trata igual que 'pro' a proposito (cuentas de prueba de
        // Google Play) -- para probar el gate real hay que forzar
        // 'basico' primero.
        await pool.query(
            `INSERT INTO public.licencias (negocio_id, estado, plan, fecha_vencimiento, gracia_dias) VALUES ($1, 'activa', 'basico', NOW() + INTERVAL '30 days', 15)
             ON CONFLICT (negocio_id) DO UPDATE SET plan = 'basico'`,
            [negocio.negocioId]
        );
        const resumenSinPlan = await llamar("GET", host, "/negocio-actual/market-resumen", null, authHeader);
        log("market-resumen responde ok (plan Basico)", resumenSinPlan.status === 200 && resumenSinPlan.datos?.ok === true);
        log("incluido = false en Basico", resumenSinPlan.datos?.incluido === false);

        await pool.query(`UPDATE public.licencias SET plan = 'pro' WHERE negocio_id = $1`, [negocio.negocioId]);
        await pool.query(
            `INSERT INTO public.sitio_web_config (negocio_id, activo, mostrar_precios, mostrar_existencias) VALUES ($1, true, true, true)`,
            [negocio.negocioId]
        );

        const resumen = await llamar("GET", host, "/negocio-actual/market-resumen", null, authHeader);
        log("market-resumen responde ok (con Pro)", resumen.status === 200 && resumen.datos?.ok === true);
        log("incluido = true con Pro", resumen.datos?.incluido === true);
        log("visible = true (sitio_web_config.activo)", resumen.datos?.visible === true);
        log("urlMarket usa el slug real", resumen.datos?.urlMarket === `https://nexoposoficial.com/market/ferreteria/${negocio.slug}`);
        log("totalDestacadosOfertas arranca en 0", resumen.datos?.totalDestacadosOfertas === 0);
        log("pedidosMarket30Dias arranca en 0", resumen.datos?.pedidosMarket30Dias === 0);

        // --- Productos destacados/ofertas ---
        const prodDestacado = await crearProductoPrueba(negocio.negocioId, { nombre: "Martillo destacado", codigo: "PRUEBA-DEST", precio: 199, stock: 10 });
        await pool.query(`UPDATE public.productos SET destacado = true WHERE id = $1`, [prodDestacado.id]);

        const prodOferta = await crearProductoPrueba(negocio.negocioId, { nombre: "Taladro en oferta", codigo: "PRUEBA-OFERTA", precio: 999, stock: 5 });
        await pool.query(`UPDATE public.productos SET precio_oferta = 799 WHERE id = $1`, [prodOferta.id]);

        await crearProductoPrueba(negocio.negocioId, { nombre: "Producto normal", codigo: "PRUEBA-NORMAL", precio: 50, stock: 20 });

        const destacados = await llamar("GET", host, "/negocio-actual/productos-destacados", null, authHeader);
        log("productos-destacados responde ok", destacados.status === 200 && destacados.datos?.ok === true);
        log("trae exactamente 2 (destacado + oferta, nunca el normal)", (destacados.datos?.productos || []).length === 2);
        const filaDestacado = (destacados.datos?.productos || []).find(p => p.codigo === "PRUEBA-DEST");
        const filaOferta = (destacados.datos?.productos || []).find(p => p.codigo === "PRUEBA-OFERTA");
        log("el destacado trae destacado=true", filaDestacado?.destacado === true);
        log("el de oferta trae precioOferta correcto", Number(filaOferta?.precioOferta) === 799);

        const resumenConDestacados = await llamar("GET", host, "/negocio-actual/market-resumen", null, authHeader);
        log("market-resumen ahora cuenta los 2 destacados/ofertas", resumenConDestacados.datos?.totalDestacadosOfertas === 2);

        // --- Origen real de los pedidos ---
        const pedidoSitio = await llamar(
            "POST", host, "/catalogo/pedido-carrito",
            { items: [{ codigo: "PRUEBA-NORMAL", cantidad: 1 }], clienteNombre: "Cliente del sitio", clienteTelefono: "4771110001", tipo: "pedido" }
        );
        log("pedido desde el sitio propio -> ok", pedidoSitio.status === 200 && pedidoSitio.datos?.ok === true, pedidoSitio.datos);

        const pedidoMarket = await llamar(
            "POST", "nexoposoficial.com", `/market/ferreteria/${negocio.slug}/catalogo/pedido-carrito`,
            { items: [{ codigo: "PRUEBA-NORMAL", cantidad: 1 }], clienteNombre: "Cliente de Market", clienteTelefono: "4771110002", tipo: "pedido" }
        );
        log("pedido desde Nexo Market -> ok", pedidoMarket.status === 200 && pedidoMarket.datos?.ok === true, pedidoMarket.datos);

        const filasOrigen = await pool.query(`SELECT cliente_nombre, origen FROM public.pedidos_publicos WHERE negocio_id = $1 ORDER BY id`, [negocio.negocioId]);
        const filaSitio = filasOrigen.rows.find(f => f.cliente_nombre === "Cliente del sitio");
        const filaMarket = filasOrigen.rows.find(f => f.cliente_nombre === "Cliente de Market");
        log("fila del sitio propio -> origen = 'sitio'", filaSitio?.origen === "sitio");
        log("fila de Market -> origen = 'market'", filaMarket?.origen === "market");

        const pedidosPublicos = await llamar("GET", host, "/negocio-actual/pedidos-publicos", null, authHeader);
        log("GET pedidos-publicos responde ok", pedidosPublicos.status === 200 && pedidosPublicos.datos?.ok === true);
        const pedidoMarketEnLista = (pedidosPublicos.datos?.pedidos || []).find(p => p.clienteNombre === "Cliente de Market");
        log("la lista ya existente trae el campo origen correcto", pedidoMarketEnLista?.origen === "market");

        const resumenFinal = await llamar("GET", host, "/negocio-actual/market-resumen", null, authHeader);
        log("market-resumen cuenta solo el pedido de Market en los ultimos 30 dias", resumenFinal.datos?.pedidosMarket30Dias === 1);

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
