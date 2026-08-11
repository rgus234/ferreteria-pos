// Verifica el rediseno de "Sitio web" (fusion con Nexo Market + editor
// de Promocion por plantillas) contra el servidor real corriendo en
// localhost:3000, usando un negocio sintetico (nunca negocio_id=1).
const fs = require("fs");
const path = require("path");
const { crearNegocioPrueba, borrarNegocioPrueba } = require("../tests/helpers/negocio-prueba");

const BASE = "http://localhost:3000";
let fallos = 0;

function ok(nombre, condicion, detalle) {
    if (condicion) {
        console.log(`OK   - ${nombre}`);
    } else {
        fallos++;
        console.log(`FAIL - ${nombre}${detalle ? " -- " + detalle : ""}`);
    }
}

async function main() {
    const negocio = await crearNegocioPrueba("sitio-web-rediseno");
    const headers = { "x-dispositivo-token": negocio.token };

    try {
        // 1) GET inicial -- campos nuevos con default sano
        let r = await fetch(`${BASE}/negocio-actual/sitio-web`, { headers });
        let datos = await r.json();
        ok("GET /negocio-actual/sitio-web responde ok", datos.ok === true);
        ok("incluye nombre del negocio", datos.nombre === `Prueba automatizada sitio-web-rediseno`, JSON.stringify(datos.nombre));
        ok("promocionPlantilla default 'clasica'", datos.promocionPlantilla === "clasica", datos.promocionPlantilla);
        ok("promocionColorAcento default null", datos.promocionColorAcento === null, datos.promocionColorAcento);
        ok("promocionTextoBoton default ''", datos.promocionTextoBoton === "", JSON.stringify(datos.promocionTextoBoton));

        // 2) PUT activando sitio + promocion con plantilla "dividida"
        const payload = {
            activo: true,
            mostrarPrecios: true,
            promocionActiva: true,
            promocionTitulo: "Hasta 30% en herramientas",
            promocionTexto: "Solo esta semana en toda la tienda",
            promocionTextoBoton: "Ver ofertas",
            promocionEnlace: "https://ejemplo.com/catalogo",
            promocionPlantilla: "dividida",
            promocionColorAcento: "#e2434d",
            envioModo: "a_coordinar",
            descripcion: "Ferreteria de prueba",
            whatsapp: "4421234567"
        };
        r = await fetch(`${BASE}/negocio-actual/sitio-web`, {
            method: "PUT",
            headers: { ...headers, "Content-Type": "application/json" },
            body: JSON.stringify(payload)
        });
        datos = await r.json();
        ok("PUT /negocio-actual/sitio-web responde ok", datos.ok === true, JSON.stringify(datos));

        // 3) GET de vuelta -- persistio la plantilla/color/boton
        r = await fetch(`${BASE}/negocio-actual/sitio-web`, { headers });
        datos = await r.json();
        ok("promocionPlantilla persistio 'dividida'", datos.promocionPlantilla === "dividida", datos.promocionPlantilla);
        ok("promocionColorAcento persistio", datos.promocionColorAcento === "#e2434d", datos.promocionColorAcento);
        ok("promocionTextoBoton persistio", datos.promocionTextoBoton === "Ver ofertas", datos.promocionTextoBoton);

        // 4) Plantilla invalida cae a 'clasica' (nunca guarda basura)
        r = await fetch(`${BASE}/negocio-actual/sitio-web`, {
            method: "PUT",
            headers: { ...headers, "Content-Type": "application/json" },
            body: JSON.stringify({ ...payload, promocionPlantilla: "no-existe" })
        });
        datos = await r.json();
        r = await fetch(`${BASE}/negocio-actual/sitio-web`, { headers });
        datos = await r.json();
        ok("plantilla invalida cae a 'clasica'", datos.promocionPlantilla === "clasica", datos.promocionPlantilla);

        // Regresa a 'dividida' para el resto de las pruebas
        await fetch(`${BASE}/negocio-actual/sitio-web`, {
            method: "PUT",
            headers: { ...headers, "Content-Type": "application/json" },
            body: JSON.stringify(payload)
        });

        // 5) Vista previa en vivo -- HTML real de la plantilla elegida
        r = await fetch(`${BASE}/negocio-actual/sitio-web/promocion-preview`, {
            method: "POST",
            headers: { ...headers, "Content-Type": "application/json" },
            body: JSON.stringify({
                promocionTitulo: "Borrador de titulo",
                promocionTexto: "Borrador de texto",
                promocionTextoBoton: "Comprar",
                promocionEnlace: "https://ejemplo.com",
                promocionPlantilla: "minimal",
                promocionColorAcento: "#18b88f"
            })
        });
        datos = await r.json();
        ok("preview responde ok", datos.ok === true);
        ok("preview usa la plantilla 'minimal'", (datos.html || "").includes("tenant-promo-banner--minimal"), datos.html);
        ok("preview incluye el titulo en borrador", (datos.html || "").includes("Borrador de titulo"));

        // 6) Preview con campos vacios -> string vacio (nunca inventa)
        r = await fetch(`${BASE}/negocio-actual/sitio-web/promocion-preview`, {
            method: "POST",
            headers: { ...headers, "Content-Type": "application/json" },
            body: JSON.stringify({ promocionTitulo: "", promocionTexto: "", promocionPlantilla: "clasica" })
        });
        datos = await r.json();
        ok("preview vacio devuelve html vacio", datos.html === "", JSON.stringify(datos.html));

        // 7) Subir imagen de promocion con recorte explicito (extract, no cover ciego)
        const pngBuffer = Buffer.from(
            "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
            "base64"
        );
        // Genera una imagen valida mas grande (400x400 solida) usando sharp para poder recortar de verdad
        const sharp = require("sharp");
        const imagenBuffer = await sharp({ create: { width: 400, height: 400, channels: 3, background: { r: 20, g: 100, b: 200 } } }).jpeg().toBuffer();

        const formulario = new FormData();
        formulario.append("imagen", new Blob([imagenBuffer], { type: "image/jpeg" }), "promo.jpg");
        formulario.append("recorte", JSON.stringify({ left: 50, top: 50, width: 200, height: 200 }));

        r = await fetch(`${BASE}/negocio-actual/sitio-web/promocion-imagen`, {
            method: "POST",
            headers,
            body: formulario
        });
        datos = await r.json();
        ok("subida de imagen con recorte responde ok", datos.ok === true, JSON.stringify(datos));

        r = await fetch(`${BASE}/negocio-actual/sitio-web`, { headers });
        datos = await r.json();
        ok("promocionTieneImagen queda true", datos.promocionTieneImagen === true);

        // 8) Sitio publico real -- la plantilla elegida se ve reflejada.
        // node/undici prohiben fijar el header Host via fetch (header
        // prohibido por el spec) -- se usa curl, que si lo permite, para
        // simular el subdominio real sin tener que resolver DNS local.
        const { execSync } = require("child_process");
        const html = execSync(
            `curl -s -H "Host: ${negocio.slug}.nexoposoficial.com" ${BASE}/`,
            { encoding: "utf8" }
        );
        ok("sitio publico usa la plantilla 'dividida'", html.includes("tenant-promo-banner--dividida"));
        ok("sitio publico incluye el titulo de la promocion", html.includes("Hasta 30%"));

        // 9) market-resumen sigue funcionando (fusionado en la pestana Nexo Market)
        r = await fetch(`${BASE}/negocio-actual/market-resumen`, { headers });
        datos = await r.json();
        ok("GET /negocio-actual/market-resumen responde ok", datos.ok === true, JSON.stringify(datos));

    } finally {
        await borrarNegocioPrueba(negocio.negocioId);
    }

    console.log(`\n${fallos === 0 ? "TODO OK" : `${fallos} FALLO(S)`}`);
    process.exit(fallos === 0 ? 0 : 1);
}

main().catch(error => {
    console.error("Error fatal:", error);
    process.exit(1);
});
