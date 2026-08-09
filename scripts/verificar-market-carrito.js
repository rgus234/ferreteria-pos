// Prueba manual end-to-end del rediseno tipo Amazon de /market/carrito
// (ver plan): POST /market/carrito-productos-json resuelve items de
// localStorage {slug,codigo,cantidad} contra datos reales de 2 tiendas
// distintas (precio/oferta/existencia/foto) y regresa relacionados por
// categoria. No es parte de la suite automatizada -- negocios
// sinteticos, nunca negocio_id = 1, datos borrados al terminar.
// Uso: node --env-file=.env scripts/verificar-market-carrito.js
const http = require("http");
const { pool, crearNegocioPrueba, crearProductoPrueba, borrarNegocioPrueba } = require("../tests/helpers/negocio-prueba");
const { iniciarServidorPrueba, detenerServidorPrueba } = require("../tests/helpers/servidor-prueba");

const HOST_CORPORATIVO = "nexoposoficial.com";

let fallos = 0;
function log(etiqueta, ok, extra = "") {
    console.log(`${ok ? "OK  " : "FAIL"} ${etiqueta}${extra ? " -- " + JSON.stringify(extra) : ""}`);
    if (!ok) fallos++;
}

function llamar(metodo, host, ruta, body) {
    return new Promise((resolve, reject) => {
        const payload = body ? JSON.stringify(body) : null;
        const req = http.request(
            {
                hostname: "localhost",
                port: 3099,
                path: ruta,
                method: metodo,
                headers: {
                    "Host": host,
                    ...(payload ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload) } : {})
                }
            },
            res => {
                let texto = "";
                res.on("data", chunk => { texto += chunk; });
                res.on("end", () => {
                    let datos = null;
                    try { datos = JSON.parse(texto); } catch (e) { /* no era JSON */ }
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
    const negocio1 = await crearNegocioPrueba("carrito-a");
    const negocio2 = await crearNegocioPrueba("carrito-b");

    try {
        await pool.query(`INSERT INTO public.sitio_web_config (negocio_id, activo, mostrar_precios, mostrar_existencias) VALUES ($1, true, true, true)`, [negocio1.negocioId]);
        await pool.query(`INSERT INTO public.sitio_web_config (negocio_id, activo, mostrar_precios, mostrar_existencias) VALUES ($1, true, true, true)`, [negocio2.negocioId]);

        const prodOferta = await crearProductoPrueba(negocio1.negocioId, { nombre: "Taladro en oferta", codigo: "CARR-OFERTA", precio: 1000, stock: 5 });
        await pool.query(`UPDATE public.productos SET precio_oferta = 750, categoria = 'herramientas' WHERE id = $1`, [prodOferta.id]);

        await crearProductoPrueba(negocio1.negocioId, { nombre: "Martillo relacionado", codigo: "CARR-RELACIONADO", precio: 199, stock: 8 });
        await pool.query(`UPDATE public.productos SET categoria = 'herramientas' WHERE negocio_id = $1 AND codigo = $2`, [negocio1.negocioId, "CARR-RELACIONADO"]);

        const prodAgotado = await crearProductoPrueba(negocio2.negocioId, { nombre: "Cemento agotado", codigo: "CARR-AGOTADO", precio: 250, stock: 0 });
        await pool.query(`UPDATE public.productos SET categoria = 'construccion' WHERE id = $1`, [prodAgotado.id]);

        const items = [
            { slug: negocio1.slug, codigo: "CARR-OFERTA", cantidad: 2 },
            { slug: negocio2.slug, codigo: "CARR-AGOTADO", cantidad: 1 },
            { slug: "tienda-que-no-existe", codigo: "X", cantidad: 1 }
        ];

        const respuesta = await llamar("POST", HOST_CORPORATIVO, "/market/carrito-productos-json", { items });
        log("responde 200", respuesta.status === 200 && respuesta.datos?.ok === true, respuesta.texto);

        const productos = respuesta.datos?.productos || [];
        log("regresa exactamente 2 productos (el slug invalido se ignora)", productos.length === 2);

        const filaOferta = productos.find(p => p.codigo === "CARR-OFERTA");
        log("producto con oferta trae precio/precioOferta reales", filaOferta?.precio === 1000 && filaOferta?.precioOferta === 750);
        log("cantidad del cliente se ecoa de vuelta", filaOferta?.cantidad === 2);
        log("tienda/slug correctos", filaOferta?.slug === negocio1.slug && filaOferta?.tienda === "Prueba automatizada carrito-a");

        const filaAgotado = productos.find(p => p.codigo === "CARR-AGOTADO");
        log("producto sin stock trae stock = 0", filaAgotado?.stock === 0);
        log("cantidad default a 1 si no viene valida", filaAgotado?.cantidad === 1);

        const relacionados = respuesta.datos?.relacionados || [];
        log("trae al menos 1 relacionado real (misma categoria, codigo distinto)", relacionados.some(p => p.codigo === "CARR-RELACIONADO"));
        log("relacionados nunca repite un codigo ya en el carrito", !relacionados.some(p => p.codigo === "CARR-OFERTA" || p.codigo === "CARR-AGOTADO"));

        const vacio = await llamar("POST", HOST_CORPORATIVO, "/market/carrito-productos-json", { items: [] });
        log("items vacio -> productos y relacionados vacios", vacio.datos?.ok === true && vacio.datos.productos.length === 0 && vacio.datos.relacionados.length === 0);

        const paginaCarrito = await llamar("GET", HOST_CORPORATIVO, "/market/carrito");
        log("GET /market/carrito responde 200 con el shell nuevo", paginaCarrito.status === 200 && paginaCarrito.texto.includes("marketCarritoTitulo") && paginaCarrito.texto.includes("carrito-productos-json"));

        console.log(`\n${fallos === 0 ? "TODO OK" : fallos + " FALLO(S)"}`);
    } finally {
        await borrarNegocioPrueba(negocio1.negocioId);
        await borrarNegocioPrueba(negocio2.negocioId);
        await detenerServidorPrueba();
        await pool.end();
    }

    process.exit(fallos === 0 ? 0 : 1);
})().catch(error => {
    console.error("FALLO INESPERADO:", error);
    process.exit(1);
});
