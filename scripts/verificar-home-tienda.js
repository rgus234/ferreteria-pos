// Prueba manual end-to-end del home tipo tienda en linea (Fase 9,
// sitio web por negocio): destacados, precio de oferta, categorias,
// beneficios, promos y buscador del header. No es parte de la suite
// automatizada -- script de un solo uso, corrido a mano contra
// negocios sinteticos (nunca negocio_id = 1), y borrado despues.
// Uso: node --env-file=.env scripts/verificar-home-tienda.js
const http = require("http");
const { pool, crearNegocioPrueba, crearProductoPrueba, borrarNegocioPrueba } = require("../tests/helpers/negocio-prueba");
const { iniciarServidorPrueba, detenerServidorPrueba } = require("../tests/helpers/servidor-prueba");

const PUERTO_PRUEBA = 3099;

let fallos = 0;
function log(etiqueta, ok, extra = "") {
    console.log(`${ok ? "OK  " : "FAIL"} ${etiqueta}${extra ? " -- " + JSON.stringify(extra) : ""}`);
    if (!ok) fallos++;
}

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
                    try { datos = JSON.parse(texto); } catch (e) { /* respuesta HTML */ }
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

    const { negocioId, slug, token: tokenDispositivo } = await crearNegocioPrueba("home-tienda");
    const host = `${slug}.nexoposoficial.com`;

    try {
        // Config base: sin whatsapp, sin credito, sin promocion -- para
        // verificar primero que nada fabricado aparece.
        await pool.query(
            `INSERT INTO public.sitio_web_config (negocio_id, activo, mostrar_precios, mostrar_existencias) VALUES ($1, true, true, true)`,
            [negocioId]
        );

        const p1 = await crearProductoPrueba(negocioId, { nombre: "Rotomartillo SDS", precio: 3460, stock: 5 });
        const p2 = await crearProductoPrueba(negocioId, { nombre: "Cinta metrica 5m", precio: 80, stock: 20 });
        // Sin destacado ni oferta todavia -- se activan en el paso 2, para
        // poder probar primero el caso "sin nada real que mostrar".
        await pool.query(`UPDATE public.productos SET categoria = 'Herramientas' WHERE id = $1`, [p1.id]);
        await pool.query(`UPDATE public.productos SET categoria = 'Plomeria' WHERE id = $1`, [p2.id]);
        // Producto con oferta invalida (mayor al precio normal) -- nunca debe verse tachado.
        const p3 = await crearProductoPrueba(negocioId, { nombre: "Foco LED 9W", precio: 45, stock: 30 });
        await pool.query(`UPDATE public.productos SET categoria = 'Electricidad', precio_oferta = 60 WHERE id = $1`, [p3.id]);

        // --- 1. Sin destacados marcados, sin ofertas reales, sin whatsapp/promo -> sin bloques de promo ---
        {
            const r = await llamar("GET", host, "/");
            log("Home responde 200", r.status === 200);
            log("Sin destacados marcados -> seccion 'Productos destacados' no aparece", !r.texto.includes("Productos destacados"));
            log("Sin whatsapp/promo/ofertas reales -> sin bloques de promocion", !r.texto.includes('class="tenant-promo-bloque'));
            log("Franja de beneficios solo trae los 2 items siempre-reales (sin credito, sin promo)", r.texto.includes("Atencion personalizada") && r.texto.includes("Pedidos y cotizaciones") && !r.texto.includes("Credito disponible") && !r.texto.includes("Promociones vigentes"));
            log("Grilla de categorias muestra las 3 categorias reales", r.texto.includes(">Herramientas<") && r.texto.includes(">Plomeria<") && r.texto.includes(">Electricidad<"));
            log("Buscador del header presente (form real hacia /catalogo)", r.texto.includes('class="tenant-buscador-header"') && r.texto.includes('action="/catalogo"'));
        }

        // --- 2. Marcar destacado -> aparece en home con precio tachado correcto ---
        {
            await pool.query(`UPDATE public.productos SET destacado = true, precio_oferta = 2890 WHERE id = $1`, [p1.id]);
            const r = await llamar("GET", host, "/");
            log("Con 1 producto destacado, la seccion aparece", r.texto.includes("Productos destacados"));
            log("Precio de oferta valido (2890 < 3460) se ve tachado", r.texto.includes('class="tenant-precio-tachado"') && r.texto.includes("$3460.00") && r.texto.includes("$2890.00"));
        }

        // --- 3. Producto con oferta invalida (mayor al precio) nunca se ve tachado en catalogo ---
        {
            const r = await llamar("GET", host, "/catalogo");
            log("Catalogo responde 200", r.status === 200);
            // Foco LED: precio 45, oferta 60 (invalida) -- debe verse solo $45.00, sin tachado ni badge de oferta cerca de su nombre.
            const idxFoco = r.texto.indexOf("Foco LED");
            const fragmento = idxFoco >= 0 ? r.texto.slice(idxFoco, idxFoco + 400) : "";
            log("Foco LED (oferta invalida) no muestra badge de oferta", idxFoco >= 0 && !fragmento.includes("tenant-badge-oferta"));
        }

        // --- 4. ?ofertas=1 filtra solo productos con oferta real vigente ---
        {
            const r = await llamar("GET", host, "/catalogo?ofertas=1");
            log("/catalogo?ofertas=1 responde 200", r.status === 200);
            log("Incluye el Rotomartillo (oferta real vigente)", r.texto.includes("Rotomartillo"));
            log("No incluye el Foco LED (oferta invalida, no vigente)", !r.texto.includes("Foco LED"));
            log("No incluye la Cinta metrica (sin oferta)", !r.texto.includes("Cinta metrica"));
        }

        // --- 5. Buscador del header filtra de verdad (GET real a /catalogo?buscar=) ---
        {
            const r = await llamar("GET", host, "/catalogo?buscar=Rotomartillo");
            log("Buscar=Rotomartillo encuentra el producto", r.texto.includes("Rotomartillo"));
            log("Buscar=Rotomartillo NO trae la Cinta metrica", !r.texto.includes("Cinta metrica"));
        }

        // --- 6. Activar whatsapp + credito + promocion -> beneficios y promos completos ---
        {
            const put = await llamar("PUT", host, "/negocio-actual/sitio-web", {
                activo: true,
                mostrarPrecios: true,
                mostrarExistencias: true,
                whatsapp: "4424950495",
                aceptarSolicitudesCredito: true,
                promocionActiva: true,
                promocionTitulo: "Oferta de temporada",
                promocionTexto: "Descuentos en herramienta electrica"
            }, { "x-dispositivo-token": tokenDispositivo });
            log("PUT sitio-web con whatsapp/credito/promo responde ok", put.datos?.ok === true, put.datos);

            const r = await llamar("GET", host, "/");
            log("Franja de beneficios ahora incluye Credito disponible y Promociones vigentes", r.texto.includes("Credito disponible") && r.texto.includes("Promociones vigentes"));
            log("Bloque de Ofertas aparece (promo activa)", r.texto.includes('class="tenant-promo-bloque tenant-promo-ofertas"'));
            log("Bloque de Cotizacion por WhatsApp aparece", r.texto.includes('class="tenant-promo-bloque tenant-promo-cotizacion"'));
            log("Bloque de Ayuda por WhatsApp aparece", r.texto.includes('class="tenant-promo-bloque tenant-promo-ayuda"'));
            log("Enlace de cotizacion usa wa.me con el numero normalizado", r.texto.includes("https://wa.me/524424950495"));
        }

        // --- 7. negocio_id = 1 no se toco (todas las queries de arriba usan negocioId sintetico) ---
        {
            const real = await pool.query(`SELECT id FROM public.productos WHERE negocio_id = 1 AND codigo LIKE 'TEST-%'`);
            log("negocio_id=1 sin productos de prueba (sin contaminacion)", real.rows.length === 0);
        }

    } catch (error) {
        console.error("Error inesperado durante la prueba:", error);
        fallos++;
    } finally {
        await pool.query(`DELETE FROM public.sitio_web_config WHERE negocio_id = $1`, [negocioId]).catch(() => {});
        await borrarNegocioPrueba(negocioId);
        await detenerServidorPrueba();
        await pool.end();

        console.log(`\n${fallos === 0 ? "TODAS LAS PRUEBAS PASARON" : `${fallos} PRUEBA(S) FALLARON`}`);
        process.exit(fallos === 0 ? 0 : 1);
    }
})();
