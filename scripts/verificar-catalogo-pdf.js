// Prueba manual end-to-end del importador de catalogos PDF: sube el
// PDF sintetico de control via HTTP real (multipart), espera a que el
// worker en segundo plano lo procese, valida el resumen 🟢🟡🔴, revisa
// las filas en catalogo_productos, y confirma la creacion en lote de
// productos reales (incluida la imagen). Negocio sintetico, nunca
// negocio_id = 1, se borra al terminar.
// Uso: node --env-file=.env scripts/verificar-catalogo-pdf.js
const fs = require("fs");
const path = require("path");
const { pool, crearNegocioPrueba, borrarNegocioPrueba } = require("../tests/helpers/negocio-prueba");
const { iniciarServidorPrueba, detenerServidorPrueba, BASE_URL } = require("../tests/helpers/servidor-prueba");

let fallos = 0;
function log(etiqueta, ok, extra = "") {
    console.log(`${ok ? "OK  " : "FAIL"} ${etiqueta}${extra ? " -- " + JSON.stringify(extra) : ""}`);
    if (!ok) fallos++;
}

async function esperar(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

(async () => {
    await iniciarServidorPrueba();
    const negocio = await crearNegocioPrueba("catalogo-pdf");
    const headers = { "x-dispositivo-token": negocio.token };

    try {
        // 1. Subir el PDF sintetico via multipart real.
        const pdfPath = path.join(__dirname, "..", "tmp", "catalogo-sintetico.pdf");
        if (!fs.existsSync(pdfPath)) {
            throw new Error(`No existe ${pdfPath} -- correr primero tmp/generar-pdf-prueba.js`);
        }
        const buffer = fs.readFileSync(pdfPath);

        const formData = new FormData();
        formData.append("pdf", new Blob([buffer], { type: "application/pdf" }), "catalogo-sintetico.pdf");
        formData.append("proveedorNormalizado", "gafi-prueba");

        const subida = await fetch(`${BASE_URL}/catalogo-proveedor-pdf/GAFI-Prueba/subir`, {
            method: "POST",
            headers,
            body: formData
        });
        const subidaJson = await subida.json();
        log("POST /catalogo-proveedor-pdf/:proveedor/subir -> 200 con trabajoId", subida.status === 200 && subidaJson.ok && Number.isInteger(subidaJson.trabajoId), subidaJson);

        const trabajoId = subidaJson.trabajoId;

        // 2. Sondear el trabajo hasta que quede listo (o falle), con
        //    limite de tiempo generoso (el poller revisa cada 4s).
        let trabajo = null;
        for (let intento = 0; intento < 30; intento++) {
            const resp = await fetch(`${BASE_URL}/catalogo-proveedor-pdf/trabajos/${trabajoId}`, { headers });
            const json = await resp.json();
            trabajo = json.trabajo;
            if (trabajo && (trabajo.estado === "listo" || trabajo.estado === "error")) break;
            await esperar(2000);
        }

        log("El trabajo termino (listo o error, no se quedo colgado)", trabajo && (trabajo.estado === "listo" || trabajo.estado === "error"), trabajo);
        log("El trabajo termino en estado 'listo'", trabajo?.estado === "listo", trabajo);

        if (trabajo?.estado !== "listo") {
            console.log("Mensaje de error del trabajo:", trabajo?.mensaje_error);
            throw new Error("El trabajo no llego a 'listo', se aborta el resto de la prueba");
        }

        // 3. Resumen 🟢🟡🔴.
        const resumenResp = await fetch(`${BASE_URL}/catalogo-proveedor-pdf/trabajos/${trabajoId}/resumen`, { headers });
        const resumenJson = await resumenResp.json();
        console.log("Resumen:", JSON.stringify(resumenJson.resumen));
        log("Resumen tiene 4 productos completos (los 4 reales del PDF sintetico)", resumenJson.listo && resumenJson.resumen.completos === 4, resumenJson.resumen);
        log("Resumen tiene 1 producto no identificado (el titulo de la pagina, sin codigo)", resumenJson.resumen.noIdentificados === 1, resumenJson.resumen);

        const catalogoId = resumenJson.catalogoId;

        // 4. Lista de productos del catalogo -- filtro por estadoExtraccion,
        //    thumbnail con token firmado.
        const listaResp = await fetch(`${BASE_URL}/catalogo-proveedor/${catalogoId}/productos?estadoExtraccion=completo`, { headers });
        const listaJson = await listaResp.json();
        log("GET productos?estadoExtraccion=completo regresa 4 filas", listaJson.ok && listaJson.productos.length === 4, { total: listaJson.productos.length });

        const primerCompleto = listaJson.productos.find(p => p.codigo_proveedor === "GAF-10001");
        log("GAF-10001 tiene imagenPropuestaUrl con token", Boolean(primerCompleto?.imagenPropuestaUrl), primerCompleto);

        // 5. Descargar la imagen propuesta real (confirma que el token
        //    firmado funciona y que el BYTEA se sirve correctamente).
        if (primerCompleto?.imagenPropuestaUrl) {
            const imgResp = await fetch(`${BASE_URL}${primerCompleto.imagenPropuestaUrl}`);
            const imgBuffer = Buffer.from(await imgResp.arrayBuffer());
            log("La imagen propuesta se descarga con Content-Type image/jpeg y bytes reales",
                imgResp.status === 200 && imgResp.headers.get("content-type") === "image/jpeg" && imgBuffer.length > 100,
                { status: imgResp.status, tipo: imgResp.headers.get("content-type"), bytes: imgBuffer.length });
        }

        // 6. Confirmar importacion en lote de los 4 productos completos.
        const idsACrear = listaJson.productos.map(p => p.id);
        const crearResp = await fetch(`${BASE_URL}/catalogo-proveedor/${catalogoId}/crear-productos-lote`, {
            method: "POST",
            headers: { ...headers, "Content-Type": "application/json" },
            body: JSON.stringify({ catalogoProductoIds: idsACrear, proveedorNormalizado: "gafi-prueba" })
        });
        const crearJson = await crearResp.json();
        log("POST crear-productos-lote crea 4 productos", crearResp.status === 200 && crearJson.ok && crearJson.creados === 4, crearJson);

        // 7. Verificar en la base que los productos reales quedaron
        //    creados con precio/nombre correctos y con foto asociada.
        const productosReales = await pool.query(
            `SELECT codigo, nombre, precio, precio_publico FROM public.productos WHERE negocio_id = $1 ORDER BY codigo`,
            [negocio.negocioId]
        );
        log("4 productos reales creados en la base", productosReales.rows.length === 4, productosReales.rows);

        const gaf10001 = productosReales.rows.find(p => p.codigo === "GAF-10001");
        log("GAF-10001 tiene precio 89 y nombre correcto",
            gaf10001 && Number(gaf10001.precio) === 89 && gaf10001.nombre.includes("Llave de paso"),
            gaf10001);

        const fotos = await pool.query(
            `SELECT codigo, length(imagen_principal) AS bytes FROM public.fotos_producto WHERE negocio_id = $1`,
            [negocio.negocioId]
        );
        log("4 fotos de producto reales creadas (imagen del PDF copiada a fotos_producto)", fotos.rows.length === 4, fotos.rows);

        // 8. Aprendizaje de plantilla PDF -- se guardo tras confirmar.
        const plantilla = await pool.query(
            `SELECT mapeo FROM public.plantillas_catalogo WHERE negocio_id = $1 AND proveedor_normalizado = 'gafi-prueba' AND formato = 'pdf'`,
            [negocio.negocioId]
        );
        log("Se guardo una plantilla PDF de aprendizaje con muestrasConfirmadas > 0",
            plantilla.rows.length === 1 && (plantilla.rows[0].mapeo?.muestrasConfirmadas || 0) > 0,
            plantilla.rows[0]?.mapeo);
        console.log("Regex de codigo aprendido:", plantilla.rows[0]?.mapeo?.regexCodigo);

        console.log(`\n${fallos === 0 ? "TODO OK" : fallos + " FALLO(S)"}`);
    } finally {
        await pool.query("DELETE FROM public.catalogo_pdf_trabajos WHERE negocio_id = $1", [negocio.negocioId]).catch(() => {});
        await pool.query("DELETE FROM public.catalogo_productos WHERE negocio_id = $1", [negocio.negocioId]).catch(() => {});
        await pool.query("DELETE FROM public.catalogos_proveedor WHERE negocio_id = $1", [negocio.negocioId]).catch(() => {});
        await pool.query("DELETE FROM public.plantillas_catalogo WHERE negocio_id = $1", [negocio.negocioId]).catch(() => {});
        await borrarNegocioPrueba(negocio.negocioId);
        await detenerServidorPrueba();
        await pool.end();
    }

    process.exit(fallos === 0 ? 0 : 1);
})().catch(error => {
    console.error("FALLO INESPERADO:", error);
    process.exit(1);
});
