// Prueba manual end-to-end del rediseno de Nexo Market + personalizacion
// por oficio. No es parte de la suite automatizada -- script de un solo
// uso, corrido a mano contra negocios/personas sinteticos (nunca
// negocio_id = 1 ni la tabla personas real), y borrado despues.
// Uso: node --env-file=.env scripts/verificar-market-rediseno.js
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

    const negocio1 = await crearNegocioPrueba("market-jardin");
    const negocio2 = await crearNegocioPrueba("market-plomeria");
    let personaId = null;

    try {
        await pool.query(`INSERT INTO public.sitio_web_config (negocio_id, activo, mostrar_precios, mostrar_existencias) VALUES ($1, true, true, true)`, [negocio1.negocioId]);
        await pool.query(`INSERT INTO public.sitio_web_config (negocio_id, activo, mostrar_precios, mostrar_existencias) VALUES ($1, true, true, true)`, [negocio2.negocioId]);

        const prodJardin = await crearProductoPrueba(negocio1.negocioId, { nombre: "Manguera de riego de prueba", precio: 300, stock: 5 });
        await pool.query(`UPDATE public.productos SET categoria = 'Jardin' WHERE id = $1`, [prodJardin.id]);

        const prodElectrico = await crearProductoPrueba(negocio1.negocioId, { nombre: "Cable electrico de prueba", precio: 150, stock: 20 });
        await pool.query(`UPDATE public.productos SET categoria = 'Electrico' WHERE id = $1`, [prodElectrico.id]);

        const prodPlomeria = await crearProductoPrueba(negocio2.negocioId, { nombre: "Valvula de plomeria de prueba", precio: 200, stock: 12 });
        await pool.query(`UPDATE public.productos SET categoria = 'Plomeria' WHERE id = $1`, [prodPlomeria.id]);

        const prodOferta = await crearProductoPrueba(negocio2.negocioId, { nombre: "Codo pvc de prueba en oferta", precio: 80, stock: 15 });
        await pool.query(`UPDATE public.productos SET categoria = 'Plomeria', precio_oferta = 60 WHERE id = $1`, [prodOferta.id]);

        // --- 1. Sin sesion: recomendados siempre vacio; ofertas/categorias con contenido real ---
        {
            const r = await llamar("GET", "/market/inicio-json");
            log("inicio-json responde ok", r.status === 200 && r.datos?.ok === true, r.datos);
            log("Sin sesion: recomendados vacio", Array.isArray(r.datos?.recomendados) && r.datos.recomendados.length === 0);
            log("Ofertas trae el producto en oferta real", (r.datos?.ofertas || []).some(p => p.nombre.includes("Codo pvc de prueba")));
            // categoriasMarket trae el top-12 por conteo cruzando TODAS las
            // tiendas permitidas (incluida Ferreteria Olimpico, real, con
            // 570 productos) -- las categorias sinteticas de 1 producto no
            // necesariamente entran al top 12, eso es correcto, no un bug.
            // Solo se confirma que la lista viene poblada con datos reales.
            log("Categorias viene poblada con datos reales", Array.isArray(r.datos?.categorias) && r.datos.categorias.length > 0, r.datos?.categorias);
            log("Tiendas incluye ambos negocios sinteticos", (r.datos?.tiendas || []).some(t => t.slug === negocio1.slug) && (r.datos?.tiendas || []).some(t => t.slug === negocio2.slug));
        }

        // --- 2. Persona logueada con oficio='jardin' -> recomendados incluye Jardin, excluye Electrico ---
        {
            const persona = await crearPersonaPrueba("market", { oficio: "jardin" });
            personaId = persona.id;
            const token = await mintearSesionPruebaPersona(persona.id);

            const r = await llamar("GET", "/market/inicio-json", { token });
            const recomendados = r.datos?.recomendados || [];
            log("oficio=jardin: recomendados incluye producto Jardin", recomendados.some(p => p.nombre.includes("Manguera de riego")));
            log("oficio=jardin: recomendados excluye producto Electrico", !recomendados.some(p => p.nombre.includes("Cable electrico")));

            // --- 3. Misma persona sin oficio (null) -> recomendados vacio aunque haya sesion ---
            const patch = await llamar("PATCH", "/personas/oficio", { token, body: { oficio: "" } });
            log("PATCH /personas/oficio a vacio responde ok", patch.status === 200 && patch.datos?.ok === true && patch.datos.oficio === null, patch.datos);

            const r2 = await llamar("GET", "/market/inicio-json", { token });
            log("Logueado sin oficio: recomendados vacio (no inventa nada)", Array.isArray(r2.datos?.recomendados) && r2.datos.recomendados.length === 0);

            // --- PATCH de vuelta a un oficio valido + login refleja el cambio ---
            const patch2 = await llamar("PATCH", "/personas/oficio", { token, body: { oficio: "plomeria" } });
            log("PATCH /personas/oficio a 'plomeria' responde ok", patch2.status === 200 && patch2.datos?.oficio === "plomeria", patch2.datos);

            const login = await llamar("POST", "/personas/login", { body: { identificador: persona.correo, password: "password-de-prueba-123" } });
            log("POST /personas/login refleja el oficio actualizado", login.status === 200 && login.datos?.persona?.oficio === "plomeria", login.datos);

            // --- PATCH con clave invalida se rechaza ---
            const patchInvalido = await llamar("PATCH", "/personas/oficio", { token, body: { oficio: "no-existe" } });
            log("PATCH con oficio invalido responde 400", patchInvalido.status === 400, patchInvalido.datos);
        }

        // --- 4. buscar-json?categoria=Jardin sin buscar -> solo esa categoria, paginado ---
        {
            const r = await llamar("GET", "/market/buscar-json?categoria=Jardin");
            const productos = r.datos?.productos || [];
            log("buscar-json?categoria=Jardin responde solo productos de esa categoria", r.status === 200 && productos.length > 0 && productos.every(p => p.categoria === "Jardin"), productos.map(p => p.categoria));
            log("buscar-json trae total/pagina (contrato nuevo)", typeof r.datos?.total === "number" && typeof r.datos?.pagina === "number");
        }

        // --- 5. buscar-json sin buscar ni categoria -- YA NO regresa {tiendas} (contrato roto a proposito) ---
        {
            const r = await llamar("GET", "/market/buscar-json");
            log("buscar-json sin filtros responde {productos,total,pagina}, no {tiendas}", r.status === 200 && r.datos?.ok === true && Array.isArray(r.datos?.productos) && r.datos.tiendas === undefined, r.datos);
        }

        // --- 6. La pagina /market sirve el HTML con los contenedores nuevos, sin depender del contrato viejo ---
        {
            const r = await llamar("GET", "/market");
            log("GET /market responde 200 con #marketInicio y #marketResultadosBusqueda", r.status === 200 && r.texto.includes('id="marketInicio"') && r.texto.includes('id="marketResultadosBusqueda"'));
            // El contrato viejo hacia "if (!texto) { ...datos.tiendas.length...}"
            // dentro de marketBuscar (buscar-json regresaba tiendas sin texto).
            // Ahora marketBuscar hace un early-return a marketMostrarInicio()
            // sin llamar a buscar-json en absoluto cuando no hay texto.
            log("marketBuscar ya no llama buscar-json cuando el texto esta vacio (usa marketMostrarInicio)", r.texto.includes('if (!texto) { marketMostrarInicio(); return; }'));
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
        await pool.query(`DELETE FROM public.sitio_web_config WHERE negocio_id = ANY($1::int[])`, [[negocio1.negocioId, negocio2.negocioId]]).catch(() => {});
        await borrarNegocioPrueba(negocio1.negocioId);
        await borrarNegocioPrueba(negocio2.negocioId);
        await detenerServidorPrueba();
        await pool.end();

        console.log(`\n${fallos === 0 ? "TODAS LAS PRUEBAS PASARON" : `${fallos} PRUEBA(S) FALLARON`}`);
        process.exit(fallos === 0 ? 0 : 1);
    }
})();
