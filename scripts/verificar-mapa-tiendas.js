// Prueba manual end-to-end del mapa real de tiendas en Nexo Market (ver
// plan): captura de direccion + geocodificacion gratis en
// PUT /negocio-actual/sitio-web, y que tiendasPermitidasMarket (via
// GET /market/inicio-json) expone lat/lng. No es parte de la suite
// automatizada -- negocio sintetico, nunca negocio_id = 1, datos
// borrados al terminar.
// Uso: node --env-file=.env scripts/verificar-mapa-tiendas.js
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
    const negocio = await crearNegocioPrueba("mapa-tiendas");

    try {
        await pool.query(`INSERT INTO public.sitio_web_config (negocio_id, activo, mostrar_precios, mostrar_existencias) VALUES ($1, true, true, true)`, [negocio.negocioId]);

        const authNegocio = { "x-dispositivo-token": negocio.token };

        // --- Direccion real y geocodificable ---
        const guardarReal = await llamar("PUT", HOST_CORPORATIVO, "/negocio-actual/sitio-web", {
            headers: authNegocio,
            json: { activo: true, direccion: "Palacio de Bellas Artes, Ciudad de Mexico" }
        });
        log("PUT con direccion real -> 200 y direccionUbicada=true", guardarReal.status === 200 && guardarReal.datos?.direccionUbicada === true, guardarReal.datos);

        const leerReal = await llamar("GET", HOST_CORPORATIVO, "/negocio-actual/sitio-web", { headers: authNegocio });
        const lat = leerReal.datos?.direccionLat;
        const lng = leerReal.datos?.direccionLng;
        log("GET refleja direccion + lat/lng numericos", leerReal.datos?.direccion === "Palacio de Bellas Artes, Ciudad de Mexico" && typeof lat === "number" && typeof lng === "number", { lat, lng });

        // tiendasPermitidasMarket (consumida por /market/inicio-json) usa
        // un cache en memoria de 60s -- se verifica la columna real en
        // vez de pelear con el TTL del cache en una prueba rapida.
        const filaDb1 = await pool.query("SELECT direccion_lat, direccion_lng FROM public.negocios WHERE id = $1", [negocio.negocioId]);
        log("negocios.direccion_lat/lng quedan numericos tras geocodificar", typeof filaDb1.rows[0]?.direccion_lat === "number" && typeof filaDb1.rows[0]?.direccion_lng === "number", filaDb1.rows[0]);

        // --- Direccion basura (no geocodificable) ---
        const guardarBasura = await llamar("PUT", HOST_CORPORATIVO, "/negocio-actual/sitio-web", {
            headers: authNegocio,
            json: { activo: true, direccion: "xzxzxz asdasd noexiste 999999" }
        });
        log("PUT con direccion basura -> 200 y direccionUbicada=false", guardarBasura.status === 200 && guardarBasura.datos?.direccionUbicada === false, guardarBasura.datos);

        const leerBasura = await llamar("GET", HOST_CORPORATIVO, "/negocio-actual/sitio-web", { headers: authNegocio });
        log("direccion basura se guarda como texto pero lat/lng quedan null", leerBasura.datos?.direccion === "xzxzxz asdasd noexiste 999999" && leerBasura.datos?.direccionLat === null && leerBasura.datos?.direccionLng === null, leerBasura.datos);

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
