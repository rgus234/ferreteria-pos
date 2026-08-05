// Prueba manual end-to-end de "Favoritos" (Fase 11, sitio web por
// negocio). No es parte de la suite automatizada -- script de un
// solo uso, corrido a mano contra negocios sinteticos (nunca
// negocio_id = 1), y borrado despues.
// Uso: node --env-file=.env scripts/verificar-favoritos.js
const http = require("http");
const { pool, crearNegocioPrueba, crearProductoPrueba, borrarNegocioPrueba } = require("../tests/helpers/negocio-prueba");
const { iniciarServidorPrueba, detenerServidorPrueba } = require("../tests/helpers/servidor-prueba");

const PUERTO_PRUEBA = 3099;

let fallos = 0;
function log(etiqueta, ok, extra = "") {
    console.log(`${ok ? "OK  " : "FAIL"} ${etiqueta}${extra ? " -- " + JSON.stringify(extra) : ""}`);
    if (!ok) fallos++;
}

function llamar(metodo, host, ruta) {
    return new Promise((resolve, reject) => {
        const req = http.request(
            {
                hostname: "localhost",
                port: PUERTO_PRUEBA,
                path: ruta,
                method: metodo,
                headers: { "Host": host }
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
        req.end();
    });
}

(async () => {
    await iniciarServidorPrueba();

    const { negocioId, slug } = await crearNegocioPrueba("favoritos");
    const host = `${slug}.nexoposoficial.com`;

    try {
        await pool.query(
            `INSERT INTO public.sitio_web_config (negocio_id, activo, mostrar_precios, mostrar_existencias) VALUES ($1, true, true, true)`,
            [negocioId]
        );

        const p1 = await crearProductoPrueba(negocioId, { nombre: "Martillo de una prueba", precio: 250, stock: 8 });
        const p2 = await crearProductoPrueba(negocioId, { nombre: "Cinta metrica de prueba", precio: 90, stock: 0 });

        const p1Row = await pool.query(`SELECT codigo FROM public.productos WHERE id = $1`, [p1.id]);
        const p2Row = await pool.query(`SELECT codigo FROM public.productos WHERE id = $1`, [p2.id]);
        const codigo1 = p1Row.rows[0].codigo;
        const codigo2 = p2Row.rows[0].codigo;

        // --- 1. favoritos-json con precios/existencias activados ---
        {
            const r = await llamar("GET", host, `/catalogo/favoritos-json?codigos=${codigo1},${codigo2}`);
            const productos = r.datos?.productos || [];
            log("Responde ok con 2 productos", r.status === 200 && r.datos?.ok === true && productos.length === 2, r.datos);
            const prod1 = productos.find(p => p.codigo === codigo1);
            log("Producto con stock trae precio y existencia reales", prod1 && Number(prod1.precio) === 250 && Number(prod1.stock) === 8, prod1);
            const prod2 = productos.find(p => p.codigo === codigo2);
            log("Producto con stock 0 se expone tal cual (no se oculta)", prod2 && Number(prod2.stock) === 0, prod2);
        }

        // --- 2. favoritos-json con precios/existencias apagados -> nunca se filtran esos datos ---
        {
            await pool.query(`UPDATE public.sitio_web_config SET mostrar_precios = false, mostrar_existencias = false WHERE negocio_id = $1`, [negocioId]);
            const r = await llamar("GET", host, `/catalogo/favoritos-json?codigos=${codigo1}`);
            const prod1 = (r.datos?.productos || [])[0];
            log("Con los toggles apagados, precio/stock no se exponen", prod1 && prod1.precio === null && prod1.stock === null, prod1);
            await pool.query(`UPDATE public.sitio_web_config SET mostrar_precios = true, mostrar_existencias = true WHERE negocio_id = $1`, [negocioId]);
        }

        // --- 3. Codigo borrado/inexistente -- se omite, no truena ---
        {
            const r = await llamar("GET", host, `/catalogo/favoritos-json?codigos=${codigo1},CODIGO-QUE-NO-EXISTE-XYZ`);
            const productos = r.datos?.productos || [];
            log("Codigo inexistente se omite sin tronar, el real si regresa", r.status === 200 && r.datos?.ok === true && productos.length === 1 && productos[0].codigo === codigo1, productos);
        }

        // --- 4. codigos vacio -> productos: [] ---
        {
            const r = await llamar("GET", host, `/catalogo/favoritos-json?codigos=`);
            log("Sin codigos, responde productos vacio", r.status === 200 && r.datos?.ok === true && Array.isArray(r.datos.productos) && r.datos.productos.length === 0, r.datos);
        }

        // --- 5. Pagina /favoritos sirve HTML con el contenedor y el script de favoritos ---
        {
            const r = await llamar("GET", host, "/favoritos");
            log("GET /favoritos responde 200 con el esqueleto de la pagina", r.status === 200 && r.texto.includes('id="favoritosLista"') && r.texto.includes("FAVORITOS_CLAVE"));
            log("El header incluye el link de Favoritos con contador", r.texto.includes('id="favoritosContador"'));
        }

        // --- 6. Regresion -- catalogo y carrito siguen sirviendo tarjetas con el boton de favorito ---
        {
            const r = await llamar("GET", host, "/catalogo");
            log("Catalogo sigue sirviendo, con boton de favorito en cada tarjeta", r.status === 200 && r.texto.includes('class="tenant-btn-favorito" data-codigo='));
        }

        // --- 7. Plan Basico -- favoritos-json y /favoritos responden 404, igual que el resto del sitio ---
        {
            await pool.query(
                `INSERT INTO public.licencias (negocio_id, estado, plan, fecha_vencimiento, gracia_dias) VALUES ($1, 'activa', 'basico', NOW() + INTERVAL '30 days', 15)
                 ON CONFLICT (negocio_id) DO UPDATE SET plan = 'basico'`,
                [negocioId]
            );

            const rJson = await llamar("GET", host, `/catalogo/favoritos-json?codigos=${codigo1}`);
            log("Plan Basico: favoritos-json responde 404", rJson.status === 404, rJson.datos);

            const rPagina = await llamar("GET", host, "/favoritos");
            log("Plan Basico: /favoritos responde 404", rPagina.status === 404);
        }

        // --- 8. negocio_id = 1 no se toco ---
        {
            const real = await pool.query(`SELECT id FROM public.productos WHERE negocio_id = 1 AND (nombre = $1 OR nombre = $2)`, ["Martillo de una prueba", "Cinta metrica de prueba"]);
            log("negocio_id=1 sin contaminacion cruzada", real.rows.length === 0);
        }

    } catch (error) {
        console.error("Error inesperado durante la prueba:", error);
        fallos++;
    } finally {
        await pool.query(`DELETE FROM public.licencias WHERE negocio_id = $1`, [negocioId]).catch(() => {});
        await pool.query(`DELETE FROM public.sitio_web_config WHERE negocio_id = $1`, [negocioId]).catch(() => {});
        await borrarNegocioPrueba(negocioId);
        await detenerServidorPrueba();
        await pool.end();

        console.log(`\n${fallos === 0 ? "TODAS LAS PRUEBAS PASARON" : `${fallos} PRUEBA(S) FALLARON`}`);
        process.exit(fallos === 0 ? 0 : 1);
    }
})();
