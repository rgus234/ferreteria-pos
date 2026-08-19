// Verificacion de "Identificar producto por foto" (Nexo IA, /dueno).
// No depende de que el modelo real "adivine bien": el emparejamiento
// por trigram (buscarCandidatosPorTerminos) se prueba directo con
// terminos ya conocidos, sin pasar por Claude. Por HTTP solo se
// prueban las partes deterministas del contrato (401 sin sesion, 400
// sin foto, disponible:false en plan Basico) -- todas responden antes
// de llamar al modelo. Negocio sintetico, nunca negocio_id = 1, se
// borra al terminar.
// Uso: node --env-file=.env scripts/verificar-identificar-producto-foto.js
const http = require("http");
const { pool, crearNegocioPrueba, crearProductoPrueba, borrarNegocioPrueba } = require("../tests/helpers/negocio-prueba");
const { iniciarServidorPrueba, detenerServidorPrueba } = require("../tests/helpers/servidor-prueba");
const { buscarCandidatosPorTerminos } = require("../ia-server");

let fallos = 0;
function log(etiqueta, ok, extra = "") {
    console.log(`${ok ? "OK  " : "FAIL"} ${etiqueta}${extra ? " -- " + JSON.stringify(extra) : ""}`);
    if (!ok) fallos++;
}

function llamar(metodo, ruta, { json, headers = {} } = {}) {
    return new Promise((resolve, reject) => {
        const cabeceras = { ...headers };
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

// PNG 1x1 real (no un dataURL inventado) -- suficiente para probar el
// contrato HTTP, el contenido visual no importa para estas pruebas.
const PNG_1X1_BASE64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
const DATA_URL_VALIDO = `data:image/png;base64,${PNG_1X1_BASE64}`;

(async () => {
    await iniciarServidorPrueba();
    const negocio = await crearNegocioPrueba("identificar-foto");

    try {
        const auth = { "x-dispositivo-token": negocio.token };

        // 1. Sin sesion -> 401 (requerirAccesoNegocio de siempre).
        const sinSesion = await llamar("POST", "/negocio-actual/identificar-producto-foto", { json: { imagenBase64: DATA_URL_VALIDO } });
        log("Sin sesion -> 401", sinSesion.status === 401, sinSesion.datos);

        // 2. Sin imagenBase64 / formato invalido -> 400, antes de tocar el modelo.
        const sinFoto = await llamar("POST", "/negocio-actual/identificar-producto-foto", { headers: auth, json: {} });
        log("Sin imagenBase64 -> 400", sinFoto.status === 400 && sinFoto.datos?.ok === false, sinFoto.datos);

        const fotoInvalida = await llamar("POST", "/negocio-actual/identificar-producto-foto", { headers: auth, json: { imagenBase64: "esto-no-es-un-dataurl" } });
        log("imagenBase64 con formato invalido -> 400", fotoInvalida.status === 400, fotoInvalida.datos);

        // 3. Plan Basico (licencias.plan) -> disponible:false, sin llamar a Claude.
        await pool.query(
            `INSERT INTO public.licencias (negocio_id, estado, plan, fecha_vencimiento, gracia_dias)
             VALUES ($1, 'activa', 'basico', NOW() + INTERVAL '30 days', 15)
             ON CONFLICT (negocio_id) DO UPDATE SET plan = 'basico'`,
            [negocio.negocioId]
        );
        const planBasico = await llamar("POST", "/negocio-actual/identificar-producto-foto", { headers: auth, json: { imagenBase64: DATA_URL_VALIDO } });
        log("Plan Basico -> 200 disponible:false", planBasico.status === 200 && planBasico.datos?.ok === true && planBasico.datos?.disponible === false, planBasico.datos);

        // 4. Emparejamiento por trigram directo (sin Claude): productos
        //    reales de ferreteria, terminos con sinonimos regionales.
        await crearProductoPrueba(negocio.negocioId, { nombre: "Llave Stillson 14 Truper", codigo: "TESTFOTO-001", precio: 350 });
        await crearProductoPrueba(negocio.negocioId, { nombre: "Llave Perica Ajustable 10 Pretul", codigo: "TESTFOTO-002", precio: 180 });
        await crearProductoPrueba(negocio.negocioId, { nombre: "Desarmador Plano 6 Pulgadas Truper", codigo: "TESTFOTO-003", precio: 45 });

        const negocioFila = { id: negocio.negocioId, slug: negocio.slug };
        const firmarTokenImagenFalso = () => "token-falso";

        const candidatosStillson = await buscarCandidatosPorTerminos(pool, negocioFila, ["llave stilson", "llave para tubo"], firmarTokenImagenFalso);
        log("Terminos 'llave stilson'/'llave para tubo' encuentran la Stillson real",
            candidatosStillson.some(c => c.codigo === "TESTFOTO-001"),
            candidatosStillson.map(c => c.codigo));

        const candidatosDesarmador = await buscarCandidatosPorTerminos(pool, negocioFila, ["desarmador plano"], firmarTokenImagenFalso);
        log("Termino 'desarmador plano' encuentra el desarmador real",
            candidatosDesarmador.some(c => c.codigo === "TESTFOTO-003"),
            candidatosDesarmador.map(c => c.codigo));

        const candidatosVacios = await buscarCandidatosPorTerminos(pool, negocioFila, [], firmarTokenImagenFalso);
        log("Sin terminos de busqueda -> arreglo vacio, no truena", Array.isArray(candidatosVacios) && candidatosVacios.length === 0, candidatosVacios);

        const candidatosSinCoincidencia = await buscarCandidatosPorTerminos(pool, negocioFila, ["xilofono marciano inexistente"], firmarTokenImagenFalso);
        log("Termino sin ninguna coincidencia real -> arreglo vacio", Array.isArray(candidatosSinCoincidencia) && candidatosSinCoincidencia.length === 0, candidatosSinCoincidencia);

        // Forma de cada candidato -- misma que espera agregarAlCarritoVenderDueno en dueno.js.
        const formaOk = candidatosStillson.every(c =>
            typeof c.id === "number" && typeof c.codigo === "string" && typeof c.nombre === "string" &&
            typeof c.precio === "number" && typeof c.stock === "number" && ("unidadVenta" in c) && ("imagenUrl" in c)
        );
        log("Cada candidato trae id/codigo/nombre/precio/stock/unidadVenta/imagenUrl", formaOk, candidatosStillson);

        console.log(`\n${fallos === 0 ? "TODAS LAS PRUEBAS PASARON" : fallos + " PRUEBA(S) FALLARON"}`);
    } finally {
        await pool.query("DELETE FROM public.productos WHERE negocio_id = $1", [negocio.negocioId]).catch(() => {});
        await borrarNegocioPrueba(negocio.negocioId);
        await detenerServidorPrueba();
        await pool.end();
    }

    process.exit(fallos === 0 ? 0 : 1);
})().catch(error => {
    console.error("FALLO INESPERADO:", error);
    process.exit(1);
});
