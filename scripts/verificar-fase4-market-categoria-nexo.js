// Verificacion manual de Fase 4 del plan "Catalogo Maestro Nexo":
// Nexo Market debe unificar productos clasificados con la taxonomia
// estructurada (categoria_nexo_id) y productos con solo texto libre
// bajo el MISMO nombre de categoria, sin duplicar filas ni romper el
// conteo total. Corrido a mano contra negocios sinteticos, nunca
// negocio_id = 1 ni datos reales. Se borra todo al final.
// Uso: node --env-file=.env scripts/verificar-fase4-market-categoria-nexo.js
const http = require("http");
const { pool, crearNegocioPrueba, crearProductoPrueba, borrarNegocioPrueba } = require("../tests/helpers/negocio-prueba");
const { iniciarServidorPrueba, detenerServidorPrueba } = require("../tests/helpers/servidor-prueba");

const PUERTO_PRUEBA = 3099;
const HOST_CORPORATIVO = "nexoposoficial.com";

let fallos = 0;
function log(etiqueta, ok, extra = "") {
    console.log(`${ok ? "OK  " : "FAIL"} ${etiqueta}${extra ? " -- " + JSON.stringify(extra) : ""}`);
    if (!ok) fallos++;
}

function llamar(ruta) {
    return new Promise((resolve, reject) => {
        const req = http.request(
            { hostname: "localhost", port: PUERTO_PRUEBA, path: ruta, method: "GET", headers: { Host: HOST_CORPORATIVO } },
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

    const negocioEstructurado = await crearNegocioPrueba("fase4-estructurado");
    const negocioTexto = await crearNegocioPrueba("fase4-texto");

    try {
        await pool.query(`INSERT INTO public.sitio_web_config (negocio_id, activo, mostrar_precios, mostrar_existencias) VALUES ($1, true, true, true)`, [negocioEstructurado.negocioId]);
        await pool.query(`INSERT INTO public.sitio_web_config (negocio_id, activo, mostrar_precios, mostrar_existencias) VALUES ($1, true, true, true)`, [negocioTexto.negocioId]);

        // Negocio A: producto clasificado con la taxonomia estructurada
        // (categoria_nexo_id -> "Herramienta manual"). El texto espejo
        // ya debe coincidir por construccion (server.js resolverCategoriaNexo).
        const idHerramientaManual = await pool.query(`SELECT id FROM categorias_nexo WHERE giro='ferreteria' AND departamento='Herramienta manual' LIMIT 1`);
        const prodEstructurado = await crearProductoPrueba(negocioEstructurado.negocioId, { nombre: "Desarmador Fase4 estructurado", precio: 45, stock: 10 });
        await pool.query(`UPDATE public.productos SET categoria = 'Herramienta manual', categoria_nexo_id = $1 WHERE id = $2`, [idHerramientaManual.rows[0].id, prodEstructurado.id]);

        // Negocio B: mismo nombre de departamento, pero SOLO texto libre
        // (sin categoria_nexo_id) -- negocio no-ferretero o que nunca uso
        // el selector estructurado.
        const prodTexto = await crearProductoPrueba(negocioTexto.negocioId, { nombre: "Martillo Fase4 texto libre", precio: 60, stock: 5 });
        await pool.query(`UPDATE public.productos SET categoria = 'Herramienta manual' WHERE id = $1`, [prodTexto.id]);

        // --- 1. buscar-json?categoria=Herramienta manual debe traer AMBOS
        // productos, de dos negocios distintos, sin duplicar filas. ---
        const r1 = await llamar("/market/buscar-json?categoria=" + encodeURIComponent("Herramienta manual"));
        const nombres1 = (r1.datos?.productos || []).map(p => p.nombre);
        log("buscar-json?categoria trae el producto ESTRUCTURADO", nombres1.includes("Desarmador Fase4 estructurado"), nombres1);
        log("buscar-json?categoria trae el producto de TEXTO LIBRE", nombres1.includes("Martillo Fase4 texto libre"), nombres1);
        log("total reportado coincide con productos devueltos (sin duplicar por el LEFT JOIN)", r1.datos?.total === (r1.datos?.productos || []).length, { total: r1.datos?.total, devueltos: (r1.datos?.productos || []).length });
        log("cada producto devuelto trae categoria='Herramienta manual' (COALESCE correcto)", (r1.datos?.productos || []).every(p => p.categoria === "Herramienta manual"), r1.datos?.productos?.map(p => p.categoria));

        // --- 2. inicio-json (categoriasMarket) debe agrupar ambos bajo
        // el mismo nombre, sin una entrada duplicada tipo "Herramienta
        // manual" x2. ---
        const r2 = await llamar("/market/inicio-json");
        const entradasHerramienta = (r2.datos?.categorias || []).filter(c => c === "Herramienta manual");
        log("categoriasMarket no duplica la entrada 'Herramienta manual'", entradasHerramienta.length <= 1, r2.datos?.categorias);

        // --- 3. Un producto con categoria_nexo_id apuntando a un
        // departamento DISTINTO del texto (caso ya imposible tras Fase 3,
        // pero confirma que el fallback no revienta si algo raro pasara)
        // no es necesario -- Fase 3 ya lo garantiza a nivel de escritura.

        console.log(fallos === 0 ? "\nTODO OK" : `\n${fallos} fallo(s)`);
    } finally {
        await borrarNegocioPrueba(negocioEstructurado.negocioId);
        await borrarNegocioPrueba(negocioTexto.negocioId);
        await detenerServidorPrueba();
        await pool.end();
    }

    process.exit(fallos === 0 ? 0 : 1);
})().catch(async err => {
    console.error("ERROR:", err);
    await detenerServidorPrueba();
    process.exit(1);
});
