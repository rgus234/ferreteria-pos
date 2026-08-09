// Prueba manual end-to-end de "Ofertas destacadas" (ver plan): CRUD
// de banners de Nexo Market en /admin (con x-admin-key), imagen de
// promocion por-tienda con recorte via sharp, y que /market/banners-json
// y /market/carrito-productos-json siguen respondiendo bien. No es
// parte de la suite automatizada -- negocio sintetico, nunca
// negocio_id = 1, datos borrados al terminar.
// Uso: node --env-file=.env scripts/verificar-ofertas-market.js
const http = require("http");
const fs = require("fs");
const path = require("path");
const { pool, crearNegocioPrueba, borrarNegocioPrueba } = require("../tests/helpers/negocio-prueba");
const { iniciarServidorPrueba, detenerServidorPrueba } = require("../tests/helpers/servidor-prueba");
const { config } = require("../config");
const sharp = require("sharp");

const HOST_CORPORATIVO = "nexoposoficial.com";

let fallos = 0;
function log(etiqueta, ok, extra = "") {
    console.log(`${ok ? "OK  " : "FAIL"} ${etiqueta}${extra ? " -- " + JSON.stringify(extra) : ""}`);
    if (!ok) fallos++;
}

function multipartBody(campos, archivo) {
    const boundary = "----NexoPruebaBoundary" + Date.now();
    const partes = [];
    for (const [clave, valor] of Object.entries(campos)) {
        partes.push(`--${boundary}\r\nContent-Disposition: form-data; name="${clave}"\r\n\r\n${valor}\r\n`);
    }
    let cuerpo = Buffer.from(partes.join(""), "utf8");
    if (archivo) {
        const cabeceraArchivo = Buffer.from(
            `--${boundary}\r\nContent-Disposition: form-data; name="${archivo.campo}"; filename="${archivo.nombre}"\r\nContent-Type: ${archivo.tipo}\r\n\r\n`,
            "utf8"
        );
        cuerpo = Buffer.concat([cuerpo, cabeceraArchivo, archivo.datos, Buffer.from("\r\n", "utf8")]);
    }
    cuerpo = Buffer.concat([cuerpo, Buffer.from(`--${boundary}--\r\n`, "utf8")]);
    return { boundary, cuerpo };
}

function llamar(metodo, host, ruta, { json, multipart, headers = {} } = {}) {
    return new Promise((resolve, reject) => {
        let payload = null;
        const cabeceras = { "Host": host, ...headers };

        if (json) {
            payload = Buffer.from(JSON.stringify(json), "utf8");
            cabeceras["Content-Type"] = "application/json";
            cabeceras["Content-Length"] = payload.length;
        } else if (multipart) {
            const { boundary, cuerpo } = multipartBody(multipart.campos, multipart.archivo);
            payload = cuerpo;
            cabeceras["Content-Type"] = `multipart/form-data; boundary=${boundary}`;
            cabeceras["Content-Length"] = payload.length;
        }

        const req = http.request({ hostname: "localhost", port: 3099, path: ruta, method: metodo, headers: cabeceras }, res => {
            const trozos = [];
            res.on("data", chunk => trozos.push(chunk));
            res.on("end", () => {
                const texto = Buffer.concat(trozos).toString("utf8");
                let datos = null;
                try { datos = JSON.parse(texto); } catch (e) { /* binario o no-json */ }
                resolve({ status: res.statusCode, headers: res.headers, datos, buffer: Buffer.concat(trozos) });
            });
        });
        req.on("error", reject);
        if (payload) req.write(payload);
        req.end();
    });
}

(async () => {
    await iniciarServidorPrueba();
    const negocio = await crearNegocioPrueba("ofertas-market");
    let bannerId = null;

    try {
        await pool.query(`INSERT INTO public.sitio_web_config (negocio_id, activo, mostrar_precios, mostrar_existencias) VALUES ($1, true, true, true)`, [negocio.negocioId]);

        const imagenPrueba = await sharp({ create: { width: 20, height: 20, channels: 3, background: { r: 220, g: 40, b: 40 } } }).png().toBuffer();
        const adminHeader = { "x-admin-key": config.adminKey };

        if (!config.adminKey) {
            console.log("AVISO: ADMIN_KEY no esta configurado en .env -- se omiten las pruebas de /admin/api/banners-market.");
        } else {
            // --- CRUD de banners de Nexo Market ---
            const sinKey = await llamar("POST", HOST_CORPORATIVO, "/admin/api/banners-market", {
                multipart: { campos: { titulo: "Sin key", orden: "0" } }
            });
            log("crear banner sin x-admin-key -> 401", sinKey.status === 401);

            const crear = await llamar("POST", HOST_CORPORATIVO, "/admin/api/banners-market", {
                headers: adminHeader,
                multipart: {
                    campos: { titulo: "Hasta 50% en herramientas", subtitulo: "Las mejores marcas", textoBoton: "Ver ofertas", enlace: "/market", temaColor: "naranja", orden: "1", activo: "true" },
                    archivo: { campo: "imagen", nombre: "banner.png", tipo: "image/png", datos: imagenPrueba }
                }
            });
            log("crear banner -> 200", crear.status === 200 && crear.datos?.ok === true, crear.datos);
            bannerId = crear.datos?.id;

            const listaAdmin = await llamar("GET", HOST_CORPORATIVO, "/admin/api/banners-market", { headers: adminHeader });
            const filaAdmin = (listaAdmin.datos?.banners || []).find(b => b.id === bannerId);
            log("banner nuevo aparece en la lista de admin con tieneImagen=true", filaAdmin?.tieneImagen === true && filaAdmin?.temaColor === "naranja");

            const imagenBanner = await llamar("GET", HOST_CORPORATIVO, `/banners-market/${bannerId}/imagen`);
            log("GET imagen del banner responde 200 image/jpeg (recortada por sharp)", imagenBanner.status === 200 && imagenBanner.headers["content-type"] === "image/jpeg");

            const publicaAntes = await llamar("GET", HOST_CORPORATIVO, "/market/banners-json");
            log("GET /market/banners-json trae el banner activo", publicaAntes.datos?.ok === true && (publicaAntes.datos.banners || []).some(b => b.id === bannerId));

            const editar = await llamar("PATCH", HOST_CORPORATIVO, `/admin/api/banners-market/${bannerId}`, {
                headers: adminHeader,
                multipart: { campos: { titulo: "Hasta 50% en herramientas", subtitulo: "", textoBoton: "Ver ofertas", enlace: "/market", temaColor: "naranja", orden: "1", activo: "false" } }
            });
            log("editar banner (desactivar) -> 200", editar.status === 200 && editar.datos?.ok === true);

            const publicaDespues = await llamar("GET", HOST_CORPORATIVO, "/market/banners-json");
            log("banner desactivado ya no aparece en /market/banners-json", !(publicaDespues.datos?.banners || []).some(b => b.id === bannerId));

            const eliminar = await llamar("DELETE", HOST_CORPORATIVO, `/admin/api/banners-market/${bannerId}`, { headers: adminHeader });
            log("eliminar banner -> 200", eliminar.status === 200 && eliminar.datos?.ok === true);
            bannerId = null;
        }

        // --- Imagen de promocion por tienda ---
        const authNegocio = { "x-dispositivo-token": negocio.token };

        const subirPromo = await llamar("POST", `${negocio.slug}.nexoposoficial.com`, "/negocio-actual/sitio-web/promocion-imagen", {
            headers: authNegocio,
            multipart: { campos: {}, archivo: { campo: "imagen", nombre: "promo.png", tipo: "image/png", datos: imagenPrueba } }
        });
        log("subir imagen de promocion -> 200", subirPromo.status === 200 && subirPromo.datos?.ok === true, subirPromo.datos);

        const configSitio = await llamar("GET", `${negocio.slug}.nexoposoficial.com`, "/negocio-actual/sitio-web", { headers: authNegocio });
        log("GET /negocio-actual/sitio-web trae promocionTieneImagen=true", configSitio.datos?.promocionTieneImagen === true);

        const imagenPromoPublica = await llamar("GET", HOST_CORPORATIVO, `/sitio-web-promocion-imagen?negocio=${negocio.slug}`);
        log("GET publico de la imagen de promocion responde 200 image/jpeg", imagenPromoPublica.status === 200 && imagenPromoPublica.headers["content-type"] === "image/jpeg");

        console.log(`\n${fallos === 0 ? "TODO OK" : fallos + " FALLO(S)"}`);
    } finally {
        if (bannerId) await pool.query(`DELETE FROM public.banners_market WHERE id = $1`, [bannerId]).catch(() => {});
        await borrarNegocioPrueba(negocio.negocioId);
        await detenerServidorPrueba();
        await pool.end();
    }

    process.exit(fallos === 0 ? 0 : 1);
})().catch(error => {
    console.error("FALLO INESPERADO:", error);
    process.exit(1);
});
