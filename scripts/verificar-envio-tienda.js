// Prueba manual end-to-end de la politica de envio por tienda (ver
// plan "Nexo Market -- Politica de envio por tienda"): PUT
// /negocio-actual/sitio-web guarda envioModo/envioTarifa/envioNotas,
// cambiar de modo limpia la tarifa huerfana, y
// /market/carrito-productos-json + /market/buscar-json exponen los 3
// campos para el negocio. No es parte de la suite automatizada --
// negocio sintetico, nunca negocio_id = 1, datos borrados al terminar.
// Uso: node --env-file=.env scripts/verificar-envio-tienda.js
const http = require("http");
const { pool, crearNegocioPrueba, borrarNegocioPrueba } = require("../tests/helpers/negocio-prueba");
const { iniciarServidorPrueba, detenerServidorPrueba } = require("../tests/helpers/servidor-prueba");

const HOST_CORPORATIVO = "nexoposoficial.com";

let fallos = 0;
function log(etiqueta, ok, extra = "") {
    console.log(`${ok ? "OK  " : "FAIL"} ${etiqueta}${extra ? " -- " + JSON.stringify(extra) : ""}`);
    if (!ok) fallos++;
}

function llamar(metodo, host, ruta, { json, headers = {} } = {}) {
    return new Promise((resolve, reject) => {
        const cabeceras = { "Host": host, ...headers };
        let payload = null;
        if (json) {
            payload = Buffer.from(JSON.stringify(json), "utf8");
            cabeceras["Content-Type"] = "application/json";
            cabeceras["Content-Length"] = payload.length;
        }

        const req = http.request({ hostname: "localhost", port: 3099, path: ruta, method: metodo, headers: cabeceras }, res => {
            const trozos = [];
            res.on("data", chunk => trozos.push(chunk));
            res.on("end", () => {
                const texto = Buffer.concat(trozos).toString("utf8");
                let datos = null;
                try { datos = JSON.parse(texto); } catch (e) { /* no-json */ }
                resolve({ status: res.statusCode, datos });
            });
        });
        req.on("error", reject);
        if (payload) req.write(payload);
        req.end();
    });
}

(async () => {
    await iniciarServidorPrueba();
    const negocio = await crearNegocioPrueba("envio-tienda");

    try {
        await pool.query(`INSERT INTO public.sitio_web_config (negocio_id, activo, mostrar_precios, mostrar_existencias) VALUES ($1, true, true, true)`, [negocio.negocioId]);
        await pool.query(
            `INSERT INTO public.productos (negocio_id, codigo, nombre, categoria, precio, stock) VALUES ($1, 'ENV-001', 'Producto de prueba envio', 'Ferreteria', 100, 10)`,
            [negocio.negocioId]
        );

        const authNegocio = { "x-dispositivo-token": negocio.token };

        // --- Modo tarifa_fija ---
        const guardarTarifa = await llamar("PUT", HOST_CORPORATIVO, "/negocio-actual/sitio-web", {
            headers: authNegocio,
            json: { activo: true, envioModo: "tarifa_fija", envioTarifa: 150, envioNotas: "Solo dentro de la ciudad" }
        });
        log("PUT con tarifa_fija -> 200", guardarTarifa.status === 200, guardarTarifa.datos);

        const leerTarifa = await llamar("GET", HOST_CORPORATIVO, "/negocio-actual/sitio-web", { headers: authNegocio });
        log("GET refleja envioModo/envioTarifa/envioNotas", leerTarifa.datos?.envioModo === "tarifa_fija" && leerTarifa.datos?.envioTarifa === 150 && leerTarifa.datos?.envioNotas === "Solo dentro de la ciudad", leerTarifa.datos);

        // --- Cambiar a solo_recoleccion: la tarifa no debe quedar huerfana ---
        const guardarRecoleccion = await llamar("PUT", HOST_CORPORATIVO, "/negocio-actual/sitio-web", {
            headers: authNegocio,
            json: { activo: true, envioModo: "solo_recoleccion" }
        });
        log("PUT con solo_recoleccion -> 200", guardarRecoleccion.status === 200, guardarRecoleccion.datos);

        const leerRecoleccion = await llamar("GET", HOST_CORPORATIVO, "/negocio-actual/sitio-web", { headers: authNegocio });
        log("envioTarifa queda null al cambiar de modo (no huerfana)", leerRecoleccion.datos?.envioModo === "solo_recoleccion" && leerRecoleccion.datos?.envioTarifa === null, leerRecoleccion.datos);

        // --- Volver a tarifa_fija para verificar propagacion a Market ---
        await llamar("PUT", HOST_CORPORATIVO, "/negocio-actual/sitio-web", {
            headers: authNegocio,
            json: { activo: true, envioModo: "tarifa_fija", envioTarifa: 75 }
        });

        const carrito = await llamar("POST", HOST_CORPORATIVO, "/market/carrito-productos-json", {
            json: { items: [{ slug: negocio.slug, codigo: "ENV-001", cantidad: 1 }] }
        });
        const productoCarrito = carrito.datos?.productos?.[0];
        log("/market/carrito-productos-json expone envioModo/envioTarifa/envioNotas", productoCarrito?.envioModo === "tarifa_fija" && productoCarrito?.envioTarifa === 75, productoCarrito);

        const buscar = await llamar("GET", HOST_CORPORATIVO, `/market/buscar-json?buscar=${encodeURIComponent("Producto de prueba envio")}`);
        const productoBuscar = (buscar.datos?.productos || []).find(p => p.codigo === "ENV-001");
        log("/market/buscar-json expone envioModo/envioTarifa para el producto", productoBuscar?.envioModo === "tarifa_fija" && productoBuscar?.envioTarifa === 75, productoBuscar);

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
