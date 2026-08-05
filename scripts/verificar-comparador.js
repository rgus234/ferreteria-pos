// Prueba manual end-to-end de "Comparador de productos" (Fase 12,
// sitio web por negocio). No es parte de la suite automatizada --
// script de un solo uso, corrido a mano contra negocios sinteticos
// (nunca negocio_id = 1), y borrado despues.
// Uso: node --env-file=.env scripts/verificar-comparador.js
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

    const { negocioId, slug } = await crearNegocioPrueba("comparador");
    const host = `${slug}.nexoposoficial.com`;

    try {
        await pool.query(
            `INSERT INTO public.sitio_web_config (negocio_id, activo, mostrar_precios, mostrar_existencias) VALUES ($1, true, true, true)`,
            [negocioId]
        );

        const p1 = await crearProductoPrueba(negocioId, { nombre: "Taladro de prueba", precio: 1500, stock: 4 });
        const p2 = await crearProductoPrueba(negocioId, { nombre: "Sierra de prueba", precio: 800, stock: 0 });

        await pool.query(
            `UPDATE public.productos SET categoria = 'Herramienta electrica', marca = 'MarcaPrueba', unidad_venta = 'pieza', tiene_garantia = true, garantia_detalle = '6 meses de fabrica' WHERE id = $1`,
            [p1.id]
        );
        await pool.query(
            `UPDATE public.productos SET categoria = 'Herramienta manual', marca = 'OtraMarca', unidad_venta = 'pieza', tiene_garantia = false WHERE id = $1`,
            [p2.id]
        );

        const p1Row = await pool.query(`SELECT codigo FROM public.productos WHERE id = $1`, [p1.id]);
        const p2Row = await pool.query(`SELECT codigo FROM public.productos WHERE id = $1`, [p2.id]);
        const codigo1 = p1Row.rows[0].codigo;
        const codigo2 = p2Row.rows[0].codigo;

        // --- 1. comparador-json con precios/existencias activados, 2 productos con atributos distintos ---
        {
            const r = await llamar("GET", host, `/catalogo/comparador-json?codigos=${codigo1},${codigo2}`);
            const productos = r.datos?.productos || [];
            log("Responde ok con 2 productos", r.status === 200 && r.datos?.ok === true && productos.length === 2, r.datos);

            const prod1 = productos.find(p => p.codigo === codigo1);
            log("Producto 1 trae precio/stock reales y atributos de comparacion", prod1 && Number(prod1.precio) === 1500 && Number(prod1.stock) === 4 && prod1.categoria === "Herramienta electrica" && prod1.marca === "MarcaPrueba" && prod1.unidadVenta === "pieza" && prod1.tieneGarantia === true && prod1.garantiaDetalle === "6 meses de fabrica", prod1);

            const prod2 = productos.find(p => p.codigo === codigo2);
            log("Producto 2 sin garantia se expone correctamente (tieneGarantia:false)", prod2 && prod2.tieneGarantia === false && prod2.categoria === "Herramienta manual", prod2);
        }

        // --- 2. comparador-json con precios/existencias apagados -- precio/stock null, atributos de comparacion siguen presentes ---
        {
            await pool.query(`UPDATE public.sitio_web_config SET mostrar_precios = false, mostrar_existencias = false WHERE negocio_id = $1`, [negocioId]);
            const r = await llamar("GET", host, `/catalogo/comparador-json?codigos=${codigo1}`);
            const prod1 = (r.datos?.productos || [])[0];
            log("Con los toggles apagados, precio/stock no se exponen pero categoria/marca si", prod1 && prod1.precio === null && prod1.stock === null && prod1.categoria === "Herramienta electrica" && prod1.marca === "MarcaPrueba", prod1);
            await pool.query(`UPDATE public.sitio_web_config SET mostrar_precios = true, mostrar_existencias = true WHERE negocio_id = $1`, [negocioId]);
        }

        // --- 3. Codigo borrado/inexistente -- se omite, no truena ---
        {
            const r = await llamar("GET", host, `/catalogo/comparador-json?codigos=${codigo1},CODIGO-QUE-NO-EXISTE-XYZ`);
            const productos = r.datos?.productos || [];
            log("Codigo inexistente se omite sin tronar, el real si regresa", r.status === 200 && r.datos?.ok === true && productos.length === 1 && productos[0].codigo === codigo1, productos);
        }

        // --- 4. codigos vacio -> productos: [] ---
        {
            const r = await llamar("GET", host, `/catalogo/comparador-json?codigos=`);
            log("Sin codigos, responde productos vacio", r.status === 200 && r.datos?.ok === true && Array.isArray(r.datos.productos) && r.datos.productos.length === 0, r.datos);
        }

        // --- 5. Pagina /comparar sirve HTML con el contenedor y los 3 scripts ---
        {
            const r = await llamar("GET", host, "/comparar");
            log("GET /comparar responde 200 con el esqueleto de la pagina", r.status === 200 && r.texto.includes('id="comparadorTabla"') && r.texto.includes("COMPARADOR_CLAVE"));
            log("El header incluye el link de Comparar con contador", r.texto.includes('id="comparadorContador"'));
        }

        // --- 6. Regresion -- catalogo sigue sirviendo tarjetas con ambos botones (favorito y comparar) ---
        {
            const r = await llamar("GET", host, "/catalogo");
            log("Catalogo sigue sirviendo, con boton de favorito Y de comparar en cada tarjeta", r.status === 200 && r.texto.includes('class="tenant-btn-favorito" data-codigo=') && r.texto.includes('class="tenant-btn-comparar" data-codigo='));
        }

        // --- 7. Ficha de detalle sigue sirviendo el boton de comparar en linea ---
        {
            const r = await llamar("GET", host, `/catalogo/${codigo1}`);
            log("Ficha de detalle incluye el boton de comparar en linea", r.status === 200 && r.texto.includes("tenant-btn-comparar-linea"));
        }

        // --- 8. Plan Basico -- comparador-json y /comparar responden 404, igual que el resto del sitio ---
        {
            await pool.query(
                `INSERT INTO public.licencias (negocio_id, estado, plan, fecha_vencimiento, gracia_dias) VALUES ($1, 'activa', 'basico', NOW() + INTERVAL '30 days', 15)
                 ON CONFLICT (negocio_id) DO UPDATE SET plan = 'basico'`,
                [negocioId]
            );

            const rJson = await llamar("GET", host, `/catalogo/comparador-json?codigos=${codigo1}`);
            log("Plan Basico: comparador-json responde 404", rJson.status === 404, rJson.datos);

            const rPagina = await llamar("GET", host, "/comparar");
            log("Plan Basico: /comparar responde 404", rPagina.status === 404);
        }

        // --- 9. negocio_id = 1 no se toco ---
        {
            const real = await pool.query(`SELECT id FROM public.productos WHERE negocio_id = 1 AND (nombre = $1 OR nombre = $2)`, ["Taladro de prueba", "Sierra de prueba"]);
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
