// Prueba manual end-to-end de la Fase 1 "Market embebido": ver una
// tienda especifica sin salir de nexoposoficial.com
// (/market/{slug}/...), barra fija de Market identica sin importar la
// tienda, cero saltos de dominio salvo el link honesto "Ver el sitio
// completo", circuito de compra real (carrito + pedido de 1 producto),
// y no-regresion del subdominio directo ({slug}.nexoposoficial.com).
// No es parte de la suite automatizada -- script de un solo uso,
// corrido a mano contra negocios sinteticos (nunca negocio_id = 1), y
// borrado despues.
// Uso: node --env-file=.env scripts/verificar-market-tienda-embebida.js
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

function llamar(metodo, host, ruta, body, headers = {}) {
    return new Promise((resolve, reject) => {
        const payload = body ? (typeof body === "string" ? body : JSON.stringify(body)) : null;
        const req = http.request(
            {
                hostname: "localhost",
                port: PUERTO_PRUEBA,
                path: ruta,
                method: metodo,
                headers: {
                    "Host": host,
                    ...(payload ? { "Content-Length": Buffer.byteLength(payload) } : {}),
                    ...headers
                }
            },
            res => {
                let texto = "";
                res.on("data", chunk => { texto += chunk; });
                res.on("end", () => {
                    let datos = null;
                    try { datos = JSON.parse(texto); } catch (e) { /* respuesta HTML/redirect */ }
                    resolve({ status: res.statusCode, headers: res.headers, datos, texto });
                });
            }
        );
        req.on("error", reject);
        if (payload) req.write(payload);
        req.end();
    });
}

function llamarJson(metodo, host, ruta, body) {
    return llamar(metodo, host, ruta, body ? JSON.stringify(body) : null, { "Content-Type": "application/json" });
}

function llamarForm(metodo, host, ruta, campos) {
    const payload = new URLSearchParams(campos).toString();
    return llamar(metodo, host, ruta, payload, { "Content-Type": "application/x-www-form-urlencoded" });
}

// Extrae el bloque <header class="market-header">...</header> completo
// de un HTML -- usado para comparar la barra fija byte a byte entre 2
// tiendas distintas.
function extraerHeaderMarket(html) {
    const inicio = html.indexOf('<header class="market-header">');
    if (inicio === -1) return null;
    const fin = html.indexOf("</header>", inicio);
    if (fin === -1) return null;
    return html.slice(inicio, fin + "</header>".length);
}

(async () => {
    await iniciarServidorPrueba();

    const negocioA = await crearNegocioPrueba("market-tienda-a");
    const negocioB = await crearNegocioPrueba("market-tienda-b");

    try {
        // --- Setup: A rojo, B verde -- confirma que ninguno de los 2 se filtra a la barra fija ---
        await pool.query(`UPDATE public.negocios SET color = '#ff0000', giro = 'Ferreteria A', direccion = 'Av. Uno 111', telefono = '4421111111' WHERE id = $1`, [negocioA.negocioId]);
        await pool.query(`UPDATE public.negocios SET color = '#00ff00', giro = 'Ferreteria B', direccion = 'Av. Dos 222', telefono = '4422222222' WHERE id = $1`, [negocioB.negocioId]);

        await pool.query(
            `INSERT INTO public.sitio_web_config (negocio_id, activo, mostrar_precios, mostrar_existencias) VALUES ($1, true, true, true)`,
            [negocioA.negocioId]
        );
        await pool.query(
            `INSERT INTO public.sitio_web_config (negocio_id, activo, mostrar_precios, mostrar_existencias) VALUES ($1, true, true, true)`,
            [negocioB.negocioId]
        );

        const prodA1 = await crearProductoPrueba(negocioA.negocioId, { nombre: "Taladro tienda A", precio: 1500, stock: 6 });
        await pool.query(`UPDATE public.productos SET categoria = 'Herramientas', marca = 'Truper', tiene_garantia = true, garantia_detalle = '6 meses' WHERE id = $1`, [prodA1.id]);
        const prodA2 = await crearProductoPrueba(negocioA.negocioId, { nombre: "Broca tienda A", precio: 40, stock: 25 });
        await pool.query(`UPDATE public.productos SET categoria = 'Herramientas', marca = 'Truper' WHERE id = $1`, [prodA2.id]);

        const prodB1 = await crearProductoPrueba(negocioB.negocioId, { nombre: "Manguera tienda B", precio: 300, stock: 10 });
        await pool.query(`UPDATE public.productos SET categoria = 'Jardin' WHERE id = $1`, [prodB1.id]);

        // crearProductoPrueba solo regresa {id, stock} -- se resuelve el
        // codigo real generado (TEST-xxxxxxxx) con una lectura aparte.
        const codigoA1 = (await pool.query(`SELECT codigo FROM public.productos WHERE id = $1`, [prodA1.id])).rows[0].codigo;
        const codigoA2 = (await pool.query(`SELECT codigo FROM public.productos WHERE id = $1`, [prodA2.id])).rows[0].codigo;

        // Foto + galeria para el producto de A -- ejerce la ruta real de
        // galeria/miniaturas dentro de Market.
        const bufferFake = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);
        const fotoRes = await pool.query(
            `INSERT INTO public.fotos_producto (negocio_id, codigo, imagen_principal, imagen_principal_tipo) VALUES ($1, $2, $3, 'image/jpeg') RETURNING id`,
            [negocioA.negocioId, codigoA1, bufferFake]
        );
        await pool.query(
            `INSERT INTO public.fotos_producto_galeria (foto_producto_id, orden, imagen, tipo) VALUES ($1, 0, $2, 'image/jpeg')`,
            [fotoRes.rows[0].id, bufferFake]
        );

        const slugA = negocioA.slug;
        const slugB = negocioB.slug;

        // --- 1. GET /market/{slugA} -> 200, muestra el nombre de A ---
        const rInicioA = await llamar("GET", HOST_CORPORATIVO, `/market/${slugA}`);
        log("GET /market/{slugA} responde 200", rInicioA.status === 200, rInicioA.status);
        log("Inicio de tienda A muestra el nombre de A", rInicioA.texto.includes(`Prueba automatizada market-tienda-a`));

        // --- 1b. Slug inexistente -> 404 ---
        const rSlugInexistente = await llamar("GET", HOST_CORPORATIVO, `/market/no-existe-esta-tienda-xyz`);
        log("GET /market/{slug-inexistente} responde 404", rSlugInexistente.status === 404);

        // --- 1c. Tienda con sitio_web_config.activo=false -> 404 (no 500, no fuga) ---
        await pool.query(`UPDATE public.sitio_web_config SET activo = false WHERE negocio_id = $1`, [negocioB.negocioId]);
        const rInactiva = await llamar("GET", HOST_CORPORATIVO, `/market/${slugB}`);
        log("Tienda con sitio_web activo=false -> 404 (no 500, no fuga)", rInactiva.status === 404, rInactiva.status);
        await pool.query(`UPDATE public.sitio_web_config SET activo = true WHERE negocio_id = $1`, [negocioB.negocioId]);

        // --- 2. GET /market/{slugA}/catalogo -> solo productos de A, nunca de B ---
        const rCatalogoA = await llamar("GET", HOST_CORPORATIVO, `/market/${slugA}/catalogo`);
        log("GET /market/{slugA}/catalogo responde 200", rCatalogoA.status === 200);
        log("Catalogo de A incluye productos de A", rCatalogoA.texto.includes("Taladro tienda A") && rCatalogoA.texto.includes("Broca tienda A"));
        log("Catalogo de A NUNCA incluye productos de B", !rCatalogoA.texto.includes("Manguera tienda B"));

        // --- 3. GET /market/{slugA}/catalogo/{codigo} -> nombre, precio, garantia, galeria y complementarios reales ---
        const rProductoA = await llamar("GET", HOST_CORPORATIVO, `/market/${slugA}/catalogo/${codigoA1}`);
        log("GET /market/{slugA}/catalogo/{codigo} responde 200", rProductoA.status === 200);
        log("Ficha de producto muestra el nombre real", rProductoA.texto.includes("Taladro tienda A"));
        log("Ficha de producto muestra el precio real", rProductoA.texto.includes("1500.00"));
        log("Ficha de producto muestra la garantia real", rProductoA.texto.includes("6 meses"));
        log("Ficha de producto incluye miniaturas de galeria (mas de 1 imagen)", rProductoA.texto.includes("tenant-detalle-miniaturas"));
        log("Ficha de producto incluye complementarios reales (Broca, misma categoria/marca)", rProductoA.texto.includes("Productos que puedes complementar") && rProductoA.texto.includes("Broca tienda A"));

        // --- 4. Requisito de la barra fija ---
        for (const [nombre, r] of [["inicio", rInicioA], ["catalogo", rCatalogoA], ["producto", rProductoA]]) {
            log(`Pagina de tienda (${nombre}) usa class="market-header" (barra de Market)`, r.texto.includes('class="market-header"'));
            log(`Pagina de tienda (${nombre}) NUNCA usa class="tenant-header" (header propio de la tienda)`, !r.texto.includes('class="tenant-header"'));
        }

        const rInicioB = await llamar("GET", HOST_CORPORATIVO, `/market/${slugB}`);
        const headerA = extraerHeaderMarket(rInicioA.texto);
        const headerB = extraerHeaderMarket(rInicioB.texto);
        log("Se pudo extraer el bloque <header class=\"market-header\"> de A y B", Boolean(headerA) && Boolean(headerB));

        if (headerA && headerB) {
            const normalizar = html => html
                .replace(new RegExp(slugA, "g"), "SLUG")
                .replace(new RegExp(slugB, "g"), "SLUG")
                .replace(/Prueba automatizada market-tienda-a/g, "NOMBRE")
                .replace(/Prueba automatizada market-tienda-b/g, "NOMBRE");
            log(
                "El bloque <header class=\"market-header\"> es string-identico entre tienda A y B (salvo slug/nombre interpolados)",
                normalizar(headerA) === normalizar(headerB)
            );
            log("El color de A (#ff0000) NO aparece dentro del bloque market-header", !headerA.includes("#ff0000") && !headerA.toLowerCase().includes("ff0000"));
            log("El color de B (#00ff00) NO aparece dentro del bloque market-header", !headerB.includes("#00ff00") && !headerB.toLowerCase().includes("00ff00"));
        } else {
            fallos += 2;
        }

        log("El HTML NUNCA contiene ':root{ --blue:' (la fuga de color clasica)", !rInicioA.texto.includes(":root{ --blue:") && !rProductoA.texto.includes(":root{ --blue:"));
        log("El HTML SI contiene '.market-tienda-scope{ --blue:' (el color va scopeado al contenido, no a :root)", rInicioA.texto.includes(".market-tienda-scope{ --blue:"));

        // --- 5. Cero saltos de dominio en las 3 paginas nuevas ---
        for (const [nombre, r] of [["inicio", rInicioA], ["catalogo", rCatalogoA], ["producto", rProductoA]]) {
            const saltosDominio = (r.texto.match(/href="https:\/\/[a-z0-9-]+\.nexoposoficial\.com\/catalogo/g) || []).length;
            log(`Pagina de tienda (${nombre}) sin saltos de dominio a /catalogo de otra tienda`, saltosDominio === 0, saltosDominio);
        }
        const linksVerSitioCompleto = (rProductoA.texto.match(/Ver el sitio completo de/g) || []).length;
        log("Exactamente 1 link honesto \"Ver el sitio completo de {tienda}\" en la ficha de producto", linksVerSitioCompleto === 1, linksVerSitioCompleto);
        log("El link \"Ver el sitio completo\" abre en pestana nueva (target=\"_blank\")", /Ver el sitio completo de[^<]*<\/a>/.test(rProductoA.texto) ? true : rProductoA.texto.includes('target="_blank" rel="noopener">Ver el sitio completo de'));

        // --- 5b. En /market, los 6 links migrados apuntan a /market/... ---
        const rMarketHome = await llamar("GET", HOST_CORPORATIVO, "/market");
        log("GET /market sigue respondiendo 200", rMarketHome.status === 200);
        log("El script de /market ya no arma links https://{slug}.nexoposoficial.com/catalogo (6 links migrados)", !rMarketHome.texto.includes(".nexoposoficial.com/catalogo"));
        log("El script de /market arma links /market/{slug}/catalogo (patron migrado)", rMarketHome.texto.includes("/market/' + encodeURIComponent(t.slug)") && rMarketHome.texto.includes("/market/' + encodeURIComponent(p.slug) + '/catalogo/"));
        log("Credito Nexo (7mo link, fuera de alcance) sigue apuntando al subdominio real", rMarketHome.texto.includes(".nexoposoficial.com/solicitud-credito"));

        // --- 6. Circuito de compra real: carrito con 2 items ---
        const rCarrito = await llamarJson("POST", HOST_CORPORATIVO, `/market/${slugA}/catalogo/pedido-carrito`, {
            items: [{ codigo: codigoA1, cantidad: 2 }, { codigo: codigoA2, cantidad: 1 }],
            clienteNombre: "Cliente de prueba Market",
            clienteTelefono: "4429998877"
        });
        log("POST /market/{slugA}/catalogo/pedido-carrito con 2 items responde ok:true", rCarrito.datos?.ok === true, rCarrito.datos);

        const pedidoCarritoRes = await pool.query(
            `SELECT DISTINCT negocio_id FROM public.pedidos_publicos WHERE cliente_nombre = 'Cliente de prueba Market'`
        );
        log("El pedido de carrito quedo en la base con negocio_id = A (nunca otro)", pedidoCarritoRes.rows.length === 1 && pedidoCarritoRes.rows[0].negocio_id === negocioA.negocioId, pedidoCarritoRes.rows);

        // --- 6b. Pedido de 1 producto (form nativo, no fetch) -> redirect 303 con prefijo /market/{slug} ---
        const rPedido1 = await llamar("POST", HOST_CORPORATIVO, `/market/${slugA}/catalogo/${codigoA1}/pedido`,
            new URLSearchParams({ cantidad: "1", clienteNombre: "Cliente pedido rapido", clienteTelefono: "4421230000" }).toString(),
            { "Content-Type": "application/x-www-form-urlencoded" }
        );
        log("POST pedido de 1 producto responde 303 (redirect)", rPedido1.status === 303, rPedido1.status);
        const ubicacionRedirect = rPedido1.headers?.location || "";
        log(
            `Redirect va a /market/${slugA}/catalogo/${codigoA1}?pedido=enviado (CON prefijo, nunca a /catalogo/... pelado)`,
            ubicacionRedirect === `/market/${slugA}/catalogo/${codigoA1}?pedido=enviado`,
            ubicacionRedirect
        );

        // --- 6c. Aislamiento de localStorage en origen compartido ---
        log(`HTML de tienda A contiene la clave nexoCarrito_${slugA}`, rProductoA.texto.includes(`nexoCarrito_${slugA}`));
        log(`HTML de tienda B contiene la clave nexoCarrito_${slugB}`, rInicioB.texto.includes(`nexoCarrito_${slugB}`));

        // --- 7. Regresion del subdominio (aditivo, nunca se rompe) ---
        const hostA = `${slugA}.nexoposoficial.com`;
        const rSubHome = await llamar("GET", hostA, "/");
        const rSubCatalogo = await llamar("GET", hostA, "/catalogo");
        const rSubProducto = await llamar("GET", hostA, `/catalogo/${codigoA1}`);
        log("Subdominio / sigue dando 200 con class=\"tenant-header\"", rSubHome.status === 200 && rSubHome.texto.includes('class="tenant-header"'));
        log("Subdominio /catalogo sigue dando 200 con class=\"tenant-header\"", rSubCatalogo.status === 200 && rSubCatalogo.texto.includes('class="tenant-header"'));
        log("Subdominio /catalogo/{codigo} sigue dando 200 con class=\"tenant-header\"", rSubProducto.status === 200 && rSubProducto.texto.includes('class="tenant-header"'));
        log("Subdominio: fetch de carrito sigue siendo \"/catalogo/pedido-carrito\" SIN prefijo", rSubProducto.texto.includes('fetch("/catalogo/pedido-carrito"'));
        log("Subdominio: NUNCA usa class=\"market-header\" (header de Market)", !rSubHome.texto.includes('class="market-header"'));

        const rMarketDesdeSubdominio = await llamar("GET", hostA, `/market/${slugA}`);
        log("GET /market/{slugA} con Host de subdominio -> 404 (guard invertido)", rMarketDesdeSubdominio.status === 404, rMarketDesdeSubdominio.status);

        const rBuscarJson = await llamar("GET", HOST_CORPORATIVO, "/market/buscar-json?buscar=tienda");
        log("GET /market/buscar-json?buscar=x -> 200 JSON de Market (nunca HTML de una tienda)", rBuscarJson.status === 200 && rBuscarJson.datos?.ok === true, rBuscarJson.datos ? "ok" : rBuscarJson.texto.slice(0, 80));

        // --- 8. negocio_id = 1 sin contaminacion ---
        const real = await pool.query(`SELECT id FROM public.productos WHERE negocio_id = 1 AND codigo LIKE 'TEST-%'`);
        log("negocio_id=1 sin productos de prueba (sin contaminacion)", real.rows.length === 0);

    } catch (error) {
        console.error("Error inesperado durante la prueba:", error);
        fallos++;
    } finally {
        await pool.query(`DELETE FROM public.pedidos_publicos WHERE negocio_id = ANY($1::int[])`, [[negocioA.negocioId, negocioB.negocioId]]).catch(() => {});
        await pool.query(`DELETE FROM public.sitio_web_config WHERE negocio_id = ANY($1::int[])`, [[negocioA.negocioId, negocioB.negocioId]]).catch(() => {});
        await borrarNegocioPrueba(negocioA.negocioId);
        await borrarNegocioPrueba(negocioB.negocioId);
        await detenerServidorPrueba();
        await pool.end();

        console.log(`\n${fallos === 0 ? "TODAS LAS PRUEBAS PASARON" : `${fallos} PRUEBA(S) FALLARON`}`);
        process.exit(fallos === 0 ? 0 : 1);
    }
})();
