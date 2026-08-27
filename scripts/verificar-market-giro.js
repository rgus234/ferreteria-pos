// Prueba manual end-to-end de la pregunta de bienvenida por giro
// (Ferreteria/Abarrotes/Papeleria) + oficio giro-consciente. No es
// parte de la suite automatizada -- script de un solo uso, corrido a
// mano contra negocios/personas sinteticos (nunca negocio_id = 1 ni la
// tabla personas real), y borrado despues.
// Uso: node --env-file=.env scripts/verificar-market-giro.js
const http = require("http");
const { pool, crearNegocioPrueba, crearProductoPrueba, borrarNegocioPrueba } = require("../tests/helpers/negocio-prueba");
const { crearPersonaPrueba, mintearSesionPruebaPersona, borrarPersonaPrueba } = require("../tests/helpers/persona-prueba");
const { iniciarServidorPrueba, detenerServidorPrueba } = require("../tests/helpers/servidor-prueba");

const PUERTO_PRUEBA = 3099;
const HOST_CORPORATIVO = "nexoposoficial.com";

let fallos = 0;
function log(etiqueta, ok, extra = "") {
    console.log(`${ok ? "OK  " : "FAIL"} ${etiqueta}${extra ? " -- " + JSON.stringify(extra) : ""}`);
    if (!ok) fallos++;
}

function llamar(metodo, ruta, { token, body } = {}) {
    return new Promise((resolve, reject) => {
        const datosBody = body ? JSON.stringify(body) : null;
        const headers = { "Host": HOST_CORPORATIVO };
        if (token) headers["x-persona-token"] = token;
        if (datosBody) {
            headers["Content-Type"] = "application/json";
            headers["Content-Length"] = Buffer.byteLength(datosBody);
        }

        const req = http.request(
            { hostname: "localhost", port: PUERTO_PRUEBA, path: ruta, method: metodo, headers },
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
        if (datosBody) req.write(datosBody);
        req.end();
    });
}

(async () => {
    await iniciarServidorPrueba();

    const negocioFerreteria = await crearNegocioPrueba("giro-ferreteria");
    const negocioAbarrotes = await crearNegocioPrueba("giro-abarrotes");
    let personaId = null;

    try {
        await pool.query(`UPDATE public.negocios SET giro = 'abarrotes' WHERE id = $1`, [negocioAbarrotes.negocioId]);

        await pool.query(`INSERT INTO public.sitio_web_config (negocio_id, activo, mostrar_precios, mostrar_existencias) VALUES ($1, true, true, true)`, [negocioFerreteria.negocioId]);
        await pool.query(`INSERT INTO public.sitio_web_config (negocio_id, activo, mostrar_precios, mostrar_existencias) VALUES ($1, true, true, true)`, [negocioAbarrotes.negocioId]);

        // Elegidos a proposito porque comparten la palabra "agua" -- es el
        // caso que de verdad prueba que el filtro por giro (no solo la
        // clave de oficio) evita que un patron de un giro encuentre
        // productos de otro giro por pura coincidencia de vocabulario.
        const bombaAgua = await crearProductoPrueba(negocioFerreteria.negocioId, { nombre: "Bomba de agua de prueba", precio: 850, stock: 4 });
        await pool.query(`UPDATE public.productos SET categoria = 'Plomeria' WHERE id = $1`, [bombaAgua.id]);

        const aguaEmbotellada = await crearProductoPrueba(negocioAbarrotes.negocioId, { nombre: "Agua embotellada de prueba", precio: 15, stock: 50 });
        await pool.query(`UPDATE public.productos SET categoria = 'Bebidas' WHERE id = $1`, [aguaEmbotellada.id]);

        const persona = await crearPersonaPrueba("giro");
        personaId = persona.id;
        const token = await mintearSesionPruebaPersona(persona.id);

        // --- 1. PATCH /personas/giro con clave valida ---
        {
            const r = await llamar("PATCH", "/personas/giro", { token, body: { giro: "abarrotes" } });
            log("PATCH /personas/giro 'abarrotes' responde ok", r.status === 200 && r.datos?.ok === true && r.datos.giro === "abarrotes", r.datos);
        }

        // --- 2. inicio-json refleja el giro guardado ---
        {
            const r = await llamar("GET", "/market/inicio-json", { token });
            log("inicio-json refleja persona.giro='abarrotes'", r.datos?.persona?.giro === "abarrotes", r.datos?.persona);
        }

        // --- 3. Clave invalida se rechaza ---
        {
            const r = await llamar("PATCH", "/personas/giro", { token, body: { giro: "no-existe" } });
            log("PATCH con giro invalido responde 400", r.status === 400, r.datos);
        }

        // --- 4. EL CASO QUE IMPORTA: oficio='bebidas' + giro='abarrotes' ---
        //     -> recomendados trae el agua embotellada, NUNCA la bomba de agua
        {
            const patchOficio = await llamar("PATCH", "/personas/oficio", { token, body: { oficio: "bebidas" } });
            log("PATCH /personas/oficio 'bebidas' (clave de abarrotes) responde ok", patchOficio.status === 200 && patchOficio.datos?.oficio === "bebidas", patchOficio.datos);

            const r = await llamar("GET", "/market/inicio-json", { token });
            const recomendados = r.datos?.recomendados || [];
            log("giro=abarrotes: recomendados incluye Agua embotellada", recomendados.some(p => p.nombre.includes("Agua embotellada")), recomendados.map(p => p.nombre));
            log("giro=abarrotes: recomendados NUNCA incluye Bomba de agua (ferreteria)", !recomendados.some(p => p.nombre.includes("Bomba de agua")), recomendados.map(p => p.nombre));
        }

        // --- 5. Misma persona, oficio='bebidas' (clave de abarrotes) pero giro='ferreteria'
        //     -> recomendados vacio (la clave no existe en la lista de ferreteria,
        //     nunca cae de vuelta a otro giro por accidente) ---
        {
            const patchGiro = await llamar("PATCH", "/personas/giro", { token, body: { giro: "ferreteria" } });
            log("PATCH /personas/giro de vuelta a 'ferreteria' responde ok", patchGiro.status === 200 && patchGiro.datos?.giro === "ferreteria", patchGiro.datos);

            const r = await llamar("GET", "/market/inicio-json", { token });
            const recomendados = r.datos?.recomendados || [];
            log("giro=ferreteria con oficio='bebidas' (invalido en esa lista): recomendados vacio, no contamina", recomendados.length === 0, recomendados.map(p => p.nombre));
        }

        // --- 6. Persona con oficio ferretero valido pero SIN giro guardado (NULL,
        //     simula a cualquiera que ya existia antes de esta migracion) ---
        //     -> giroEfectivo cae a "ferreteria", recomendados sigue funcionando
        //     igual que hoy, sin apagarse de golpe ---
        {
            const patchGiroVacio = await llamar("PATCH", "/personas/giro", { token, body: { giro: "" } });
            log("PATCH /personas/giro a vacio (NULL) responde ok", patchGiroVacio.status === 200 && patchGiroVacio.datos?.giro === null, patchGiroVacio.datos);

            const patchOficioPlomeria = await llamar("PATCH", "/personas/oficio", { token, body: { oficio: "plomeria" } });
            log("PATCH /personas/oficio 'plomeria' responde ok", patchOficioPlomeria.status === 200 && patchOficioPlomeria.datos?.oficio === "plomeria", patchOficioPlomeria.datos);

            const r = await llamar("GET", "/market/inicio-json", { token });
            const recomendados = r.datos?.recomendados || [];
            // No se busca el producto sintetico especifico: idsDelGiro con el
            // fallback "ferreteria" incluye TODAS las tiendas ferreteras
            // reales (negocio_id=1 con cientos de productos reales), y la
            // consulta no tiene ORDER BY -- cual de los +12 matches gana el
            // LIMIT 12 es arbitrario. Lo que si prueba el fallback es que la
            // lista no queda vacia (no se le apagan las recomendaciones a un
            // usuario que ya tenia oficio elegido antes de este cambio).
            log("giro=NULL (usuario preexistente) + oficio ferretero: sigue viendo recomendaciones (fallback no las apaga)", recomendados.length > 0, recomendados.map(p => p.nombre));
        }

        // --- 7. negocio_id = 1 y tabla personas real sin contaminacion ---
        {
            const real = await pool.query(`SELECT id FROM public.productos WHERE negocio_id = 1 AND nombre ILIKE '%de prueba%'`);
            log("negocio_id=1 sin contaminacion cruzada", real.rows.length === 0);
        }

    } catch (error) {
        console.error("Error inesperado durante la prueba:", error);
        fallos++;
    } finally {
        await borrarPersonaPrueba(personaId);
        await pool.query(`DELETE FROM public.sitio_web_config WHERE negocio_id = ANY($1::int[])`, [[negocioFerreteria.negocioId, negocioAbarrotes.negocioId]]).catch(() => {});
        await borrarNegocioPrueba(negocioFerreteria.negocioId);
        await borrarNegocioPrueba(negocioAbarrotes.negocioId);
        await detenerServidorPrueba();
        await pool.end();

        console.log(`\n${fallos === 0 ? "TODAS LAS PRUEBAS PASARON" : `${fallos} PRUEBA(S) FALLARON`}`);
        process.exit(fallos === 0 ? 0 : 1);
    }
})();
