// Prueba manual end-to-end de "Cotizaciones desde el carrito" (Fase
// 10, sitio web por negocio). No es parte de la suite automatizada --
// script de un solo uso, corrido a mano contra negocios sinteticos
// (nunca negocio_id = 1), y borrado despues.
// Uso: node --env-file=.env scripts/verificar-cotizaciones.js
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

    const { negocioId, slug, token: tokenDispositivo } = await crearNegocioPrueba("cotizaciones");
    const host = `${slug}.nexoposoficial.com`;

    try {
        await pool.query(`INSERT INTO public.sitio_web_config (negocio_id, activo) VALUES ($1, true)`, [negocioId]);

        const p1 = await crearProductoPrueba(negocioId, { nombre: "Tinaco 450L", precio: 2200 });
        const p2 = await crearProductoPrueba(negocioId, { nombre: "Base para tinaco", precio: 600 });

        const p1Row = await pool.query(`SELECT codigo FROM public.productos WHERE id = $1`, [p1.id]);
        const p2Row = await pool.query(`SELECT codigo FROM public.productos WHERE id = $1`, [p2.id]);
        const codigo1 = p1Row.rows[0].codigo;
        const codigo2 = p2Row.rows[0].codigo;

        // --- 1. Carrito tipo=pedido (default) -> tipo='pedido' en las filas ---
        const telefonoPedido = "4429991001";
        {
            const r = await llamar("POST", host, "/catalogo/pedido-carrito", {
                items: [{ codigo: codigo1, cantidad: 1 }],
                clienteNombre: "Cliente Pedido Normal",
                clienteTelefono: telefonoPedido,
                tipo: "pedido"
            });
            log("Carrito tipo pedido responde ok", r.status === 200 && r.datos?.ok === true, r.datos);

            const fila = await pool.query(`SELECT tipo FROM public.pedidos_publicos WHERE negocio_id = $1 AND cliente_telefono = $2`, [negocioId, telefonoPedido]);
            log("Fila queda con tipo='pedido'", fila.rows.length === 1 && fila.rows[0].tipo === "pedido", fila.rows);
        }

        // --- 2. Carrito tipo=cotizacion, 2 productos -> tipo='cotizacion' en TODAS las filas del grupo ---
        const telefonoCotizacion = "4429991002";
        let grupoIdCotizacion;
        {
            const r = await llamar("POST", host, "/catalogo/pedido-carrito", {
                items: [{ codigo: codigo1, cantidad: 1 }, { codigo: codigo2, cantidad: 2 }],
                clienteNombre: "Cliente Cotizacion",
                clienteTelefono: telefonoCotizacion,
                clienteCorreo: "cliente-cotizacion-prueba@example.com",
                tipo: "cotizacion"
            });
            log("Carrito tipo cotizacion responde ok", r.status === 200 && r.datos?.ok === true, r.datos);

            const filas = await pool.query(`SELECT id, tipo, grupo_id, estado FROM public.pedidos_publicos WHERE negocio_id = $1 AND cliente_telefono = $2`, [negocioId, telefonoCotizacion]);
            grupoIdCotizacion = filas.rows[0]?.grupo_id;
            log("2 filas insertadas, ambas tipo='cotizacion', mismo grupo_id", filas.rows.length === 2 && filas.rows.every(f => f.tipo === "cotizacion") && new Set(filas.rows.map(f => f.grupo_id)).size === 1, filas.rows);
            log("Estado inicial pendiente", filas.rows.every(f => f.estado === "pendiente"));
        }

        // --- 3. GET /negocio-actual/pedidos-publicos expone grupoId/tipo/precioCotizado ---
        let idRepresentativo;
        {
            const r = await llamar("GET", host, "/negocio-actual/pedidos-publicos", null, { "x-dispositivo-token": tokenDispositivo });
            const filasCotizacion = (r.datos?.pedidos || []).filter(p => p.clienteTelefono === telefonoCotizacion);
            idRepresentativo = filasCotizacion[0]?.id;
            log("GET expone grupoId/tipo/precioCotizado en las filas de cotizacion", filasCotizacion.length === 2 && filasCotizacion.every(p => p.grupoId === grupoIdCotizacion && p.tipo === "cotizacion" && p.precioCotizado === null));
        }

        // --- 4. Responder con precio invalido -> rechazado, sin cambiar estado ---
        {
            const rCero = await llamar("PATCH", host, `/negocio-actual/pedidos-publicos/${idRepresentativo}`, { estado: "cotizado", precioCotizado: 0 }, { "x-dispositivo-token": tokenDispositivo });
            log("Precio 0 se rechaza", rCero.status === 400 && rCero.datos?.ok === false);

            const rNegativo = await llamar("PATCH", host, `/negocio-actual/pedidos-publicos/${idRepresentativo}`, { estado: "cotizado", precioCotizado: -50 }, { "x-dispositivo-token": tokenDispositivo });
            log("Precio negativo se rechaza", rNegativo.status === 400 && rNegativo.datos?.ok === false);

            const rTexto = await llamar("PATCH", host, `/negocio-actual/pedidos-publicos/${idRepresentativo}`, { estado: "cotizado", precioCotizado: "abc" }, { "x-dispositivo-token": tokenDispositivo });
            log("Precio no numerico se rechaza", rTexto.status === 400 && rTexto.datos?.ok === false);

            const filas = await pool.query(`SELECT estado FROM public.pedidos_publicos WHERE grupo_id = $1`, [grupoIdCotizacion]);
            log("Estado sigue 'pendiente' tras los rechazos", filas.rows.every(f => f.estado === "pendiente"));
        }

        // --- 5. Intentar cotizar un pedido tipo='pedido' -> rechazado ---
        {
            const filaPedido = await pool.query(`SELECT id FROM public.pedidos_publicos WHERE negocio_id = $1 AND cliente_telefono = $2`, [negocioId, telefonoPedido]);
            const r = await llamar("PATCH", host, `/negocio-actual/pedidos-publicos/${filaPedido.rows[0].id}`, { estado: "cotizado", precioCotizado: 100 }, { "x-dispositivo-token": tokenDispositivo });
            log("Cotizar un pedido tipo='pedido' se rechaza", r.status === 400 && r.datos?.ok === false, r.datos);
        }

        // --- 6. Responder con precio valido -> estado='cotizado' en TODO el grupo ---
        {
            const r = await llamar("PATCH", host, `/negocio-actual/pedidos-publicos/${idRepresentativo}`, { estado: "cotizado", precioCotizado: 3200.5, nota: "Incluye instalacion basica" }, { "x-dispositivo-token": tokenDispositivo });
            log("Responder con precio valido responde ok", r.status === 200 && r.datos?.ok === true, r.datos);
            log("Respuesta incluye clienteTelefono/items/precioCotizado para armar WhatsApp", r.datos?.clienteTelefono === telefonoCotizacion && Array.isArray(r.datos?.items) && r.datos.items.length === 2 && r.datos?.precioCotizado === 3200.5);

            const filas = await pool.query(`SELECT estado, precio_cotizado, nota_negocio, respondido_at FROM public.pedidos_publicos WHERE grupo_id = $1`, [grupoIdCotizacion]);
            log("Ambas filas del grupo quedan estado='cotizado' con el mismo precio/nota", filas.rows.length === 2 && filas.rows.every(f => f.estado === "cotizado" && Number(f.precio_cotizado) === 3200.5 && f.nota_negocio === "Incluye instalacion basica" && f.respondido_at !== null));
        }

        // --- 7. Portal de cliente: la cuenta ligera se creo (mismo mecanismo de Fase 7) y ya trae precio_cotizado/tipo listo para agrupar en el render ---
        {
            const filaCliente = await pool.query(`SELECT codigo_acceso_hash FROM public.clientes_credito WHERE negocio_id = $1 AND telefono = $2`, [negocioId, telefonoCotizacion]);
            log("Cuenta ligera se creo para el telefono de la cotizacion (mismo mecanismo de Fase 7)", filaCliente.rows.length === 1 && Boolean(filaCliente.rows[0]?.codigo_acceso_hash));

            const filasPortal = await pool.query(
                `SELECT producto_nombre, cantidad, estado, grupo_id, tipo, precio_cotizado, nota_negocio FROM public.pedidos_publicos WHERE negocio_id = $1 AND cliente_telefono = $2`,
                [negocioId, telefonoCotizacion]
            );
            log("Las filas que el portal de cliente consultaria ya traen precio_cotizado/tipo/grupo_id listos para agrupar", filasPortal.rows.length === 2 && filasPortal.rows.every(f => f.tipo === "cotizacion" && Number(f.precio_cotizado) === 3200.5 && f.grupo_id === grupoIdCotizacion));
        }

        // --- 8. GET /negocio-actual/pedidos-publicos ya refleja el precio guardado ---
        {
            const r = await llamar("GET", host, "/negocio-actual/pedidos-publicos", null, { "x-dispositivo-token": tokenDispositivo });
            const filasCotizacion = (r.datos?.pedidos || []).filter(p => p.clienteTelefono === telefonoCotizacion);
            log("GET refleja precioCotizado/notaNegocio/estado cotizado tras responder", filasCotizacion.length === 2 && filasCotizacion.every(p => p.estado === "cotizado" && p.precioCotizado === 3200.5 && p.notaNegocio === "Incluye instalacion basica"));
        }

        // --- 9. Regresion: marcar atendido/descartado sigue funcionando para tipo='pedido' ---
        {
            const filaPedido = await pool.query(`SELECT id FROM public.pedidos_publicos WHERE negocio_id = $1 AND cliente_telefono = $2`, [negocioId, telefonoPedido]);
            const r = await llamar("PATCH", host, `/negocio-actual/pedidos-publicos/${filaPedido.rows[0].id}`, { estado: "atendido" }, { "x-dispositivo-token": tokenDispositivo });
            log("Marcar atendido en un pedido normal sigue funcionando (regresion)", r.status === 200 && r.datos?.ok === true);
        }

        // --- 10. negocio_id = 1 no se toco ---
        {
            const real = await pool.query(`SELECT id FROM public.pedidos_publicos WHERE negocio_id = 1 AND cliente_telefono IN ($1, $2)`, [telefonoPedido, telefonoCotizacion]);
            log("negocio_id=1 sin contaminacion cruzada", real.rows.length === 0);
        }

    } catch (error) {
        console.error("Error inesperado durante la prueba:", error);
        fallos++;
    } finally {
        await pool.query(`DELETE FROM public.pedidos_publicos WHERE negocio_id = $1`, [negocioId]).catch(() => {});
        await pool.query(`DELETE FROM public.sitio_web_config WHERE negocio_id = $1`, [negocioId]).catch(() => {});
        await borrarNegocioPrueba(negocioId);
        await detenerServidorPrueba();
        await pool.end();

        console.log(`\n${fallos === 0 ? "TODAS LAS PRUEBAS PASARON" : `${fallos} PRUEBA(S) FALLARON`}`);
        process.exit(fallos === 0 ? 0 : 1);
    }
})();
