// Prueba manual end-to-end del carrito ligero, cuenta automatica y
// promociones (Fase 7, sitio web por negocio). No es parte de la
// suite automatizada -- script de un solo uso, corrido a mano contra
// negocios sinteticos (nunca negocio_id = 1), y borrado despues.
// Uso: node --env-file=.env scripts/verificar-carrito-promo.js
const http = require("http");
const { pool, crearNegocioPrueba, crearProductoPrueba, borrarNegocioPrueba } = require("../tests/helpers/negocio-prueba");
const { iniciarServidorPrueba, detenerServidorPrueba } = require("../tests/helpers/servidor-prueba");

const PUERTO_PRUEBA = 3099;

let fallos = 0;
function log(etiqueta, ok, extra = "") {
    console.log(`${ok ? "OK  " : "FAIL"} ${etiqueta}${extra ? " -- " + JSON.stringify(extra) : ""}`);
    if (!ok) fallos++;
}

// fetch() de Node ignora un header Host personalizado -- se usa http
// nativo, mismo patron ya usado en verificar-portal-cliente.js.
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

    const { negocioId, slug, token: tokenDispositivo } = await crearNegocioPrueba("carrito-promo");
    const host = `${slug}.nexoposoficial.com`;

    try {
        await pool.query(`INSERT INTO public.sitio_web_config (negocio_id, activo) VALUES ($1, true)`, [negocioId]);

        const p1 = await crearProductoPrueba(negocioId, { nombre: "Martillo de bola", precio: 150 });
        const p2 = await crearProductoPrueba(negocioId, { nombre: "Cinta metrica 5m", precio: 80 });

        const p1Row = await pool.query(`SELECT codigo FROM public.productos WHERE id = $1`, [p1.id]);
        const p2Row = await pool.query(`SELECT codigo FROM public.productos WHERE id = $1`, [p2.id]);
        const codigo1 = p1Row.rows[0].codigo;
        const codigo2 = p2Row.rows[0].codigo;

        const telefonoNuevo = "4429990001";

        // --- 1. Catalogo muestra el boton de carrito y el badge ---
        {
            const r = await llamar("GET", host, "/catalogo");
            log("Catalogo incluye boton 'Agregar al carrito'", r.status === 200 && r.texto.includes("tenant-btn-carrito"));
            log("Catalogo incluye badge de carrito en el nav", r.texto.includes("carritoContador"));
        }

        // --- 2. Carrito con 2 productos + telefono nuevo -> cuenta creada ---
        let codigoAcceso;
        {
            const r = await llamar("POST", host, "/catalogo/pedido-carrito", {
                items: [{ codigo: codigo1, cantidad: 2 }, { codigo: codigo2, cantidad: 1 }],
                clienteNombre: "<script>alert(1)</script> Cliente Carrito",
                clienteTelefono: telefonoNuevo,
                mensaje: "Pedido de prueba"
            });
            codigoAcceso = r.datos?.cuenta?.codigo;
            log("Carrito con 2 items responde ok", r.status === 200 && r.datos?.ok === true, r.datos);
            log("Cuenta ligera creada con codigo de 8 caracteres", r.datos?.cuenta?.creada === true && /^[A-Z2-9]{8}$/.test(codigoAcceso || ""), codigoAcceso);
        }

        // --- 3. 2 filas en pedidos_publicos con el mismo grupo_id ---
        {
            const filas = await pool.query(
                `SELECT producto_codigo, cantidad, grupo_id FROM public.pedidos_publicos WHERE negocio_id = $1 AND cliente_telefono = $2 ORDER BY id`,
                [negocioId, telefonoNuevo]
            );
            const grupos = new Set(filas.rows.map(f => f.grupo_id));
            log("2 filas insertadas en pedidos_publicos", filas.rows.length === 2, filas.rows.length);
            log("Ambas filas comparten el mismo grupo_id", grupos.size === 1 && filas.rows[0].grupo_id, [...grupos]);
        }

        // --- 4. clientes_credito: fila nueva con es_visitante_sitio=true, limite 0 ---
        let clienteVisitanteId;
        {
            const fila = await pool.query(
                `SELECT id, limite_credito, es_visitante_sitio, codigo_acceso_hash FROM public.clientes_credito WHERE negocio_id = $1 AND telefono = $2`,
                [negocioId, telefonoNuevo]
            );
            clienteVisitanteId = fila.rows[0]?.id;
            log("clientes_credito tiene 1 fila para el telefono nuevo", fila.rows.length === 1, fila.rows.length);
            log("es_visitante_sitio=true, limite_credito=0", fila.rows[0]?.es_visitante_sitio === true && Number(fila.rows[0]?.limite_credito) === 0);
            log("codigo_acceso_hash quedo guardado", Boolean(fila.rows[0]?.codigo_acceso_hash));
        }

        // --- 5. Login al portal con telefono+codigo, ve pedidos y NO ve tarjeta de credito ---
        {
            const login = await llamar("POST", host, "/portal-cliente/login", { telefono: telefonoNuevo, codigo: codigoAcceso });
            const tokenCliente = login.datos?.token;
            log("Login con la cuenta ligera funciona", login.status === 200 && login.datos?.ok === true);

            const estado = await llamar("GET", host, "/portal-cliente/estado", null, { "x-cliente-token": tokenCliente });
            const sinMovimientos = Array.isArray(estado.datos?.movimientos) && estado.datos.movimientos.length === 0;
            const limiteCero = Number(estado.datos?.cliente?.limite_credito) === 0;
            log("Cuenta ligera: sin movimientos de credito y limite 0 (el portal ocultara la tarjeta de saldo)", sinMovimientos && limiteCero);
            log("Cuenta ligera: 'Tus pedidos' trae los 2 items del carrito", Array.isArray(estado.datos?.pedidos) && estado.datos.pedidos.length === 2, estado.datos?.pedidos?.length);
        }

        // --- 6. Repetir carrito con el MISMO telefono -> no crea cuenta nueva ---
        {
            const r = await llamar("POST", host, "/catalogo/pedido-carrito", {
                items: [{ codigo: codigo1, cantidad: 1 }],
                clienteNombre: "Cliente Carrito Otra Vez",
                clienteTelefono: telefonoNuevo
            });
            log("Segundo carrito con mismo telefono: cuenta.creada=false", r.datos?.ok === true && r.datos?.cuenta?.creada === false, r.datos);

            const filas = await pool.query(`SELECT id FROM public.clientes_credito WHERE negocio_id = $1 AND telefono = $2`, [negocioId, telefonoNuevo]);
            log("Sigue habiendo solo 1 fila en clientes_credito para ese telefono", filas.rows.length === 1, filas.rows.length);
        }

        // --- 7. Telefono de un cliente de credito REAL ya existente -> nunca se le activa portal desde el carrito publico ---
        const telefonoClienteReal = "4429990002";
        let clienteRealId;
        {
            const clienteReal = await pool.query(
                `INSERT INTO public.clientes_credito (negocio_id, nombre, telefono, limite_credito, activo) VALUES ($1, 'Cliente Real', $2, 5000, true) RETURNING id`,
                [negocioId, telefonoClienteReal]
            );
            clienteRealId = clienteReal.rows[0].id;

            const r = await llamar("POST", host, "/catalogo/pedido-carrito", {
                items: [{ codigo: codigo1, cantidad: 1 }],
                clienteNombre: "Alguien usando el telefono de otro",
                clienteTelefono: telefonoClienteReal
            });
            log("Carrito con telefono de cliente real responde ok (el pedido si se guarda)", r.datos?.ok === true);
            log("No se genera codigo para el cliente real (cuenta.creada=false)", r.datos?.cuenta?.creada === false);

            const filaReal = await pool.query(`SELECT codigo_acceso_hash FROM public.clientes_credito WHERE id = $1`, [clienteRealId]);
            log("El cliente real sigue sin codigo_acceso_hash (portal no se activo solo)", filaReal.rows[0]?.codigo_acceso_hash === null);
        }

        // --- 8. GET /creditos excluye las cuentas ligeras del carrito ---
        {
            const r = await llamar("GET", host, "/creditos", null, { "x-dispositivo-token": tokenDispositivo });
            const ids = (r.datos?.clientes || []).map(c => c.id);
            log("GET /creditos NO incluye la cuenta ligera del carrito", !ids.includes(clienteVisitanteId), ids);
            log("GET /creditos SI incluye al cliente real", ids.includes(clienteRealId), ids);
        }

        // --- 9. El formulario de un-solo-producto (Fase 3) sigue funcionando (regresion) ---
        {
            const r = await llamar("POST", host, `/catalogo/${codigo1}/pedido`, {
                cantidad: 1,
                clienteNombre: "Cliente Formulario Simple",
                clienteTelefono: "4429990003"
            });
            log("Pedido de un solo producto sigue respondiendo 303 (redirect)", r.status === 303);
        }

        // --- 10. Promocion: activar, confirmar banner escapado; desactivar, confirmar que desaparece ---
        {
            const activar = await llamar("PUT", host, "/negocio-actual/sitio-web", {
                activo: true,
                promocionActiva: true,
                promocionTitulo: "<b>Oferta</b> especial",
                promocionTexto: "10% de descuento <script>alert(1)</script> esta semana"
            }, { "x-dispositivo-token": tokenDispositivo });
            log("PUT sitio-web con promocion responde ok", activar.datos?.ok === true, activar.datos);

            const inicio = await llamar("GET", host, "/");
            log("Banner de promocion aparece en inicio", inicio.texto.includes('<div class="tenant-promo-banner">'));
            log("Titulo/texto de promocion quedan escapados (sin <script> ni <b> crudos)", !inicio.texto.includes("<script>alert(1)</script>") && !inicio.texto.includes("<b>Oferta</b>"));

            const catalogo = await llamar("GET", host, "/catalogo");
            log("Banner de promocion tambien aparece en catalogo", catalogo.texto.includes('<div class="tenant-promo-banner">'));

            const desactivar = await llamar("PUT", host, "/negocio-actual/sitio-web", {
                activo: true,
                promocionActiva: false,
                promocionTitulo: "<b>Oferta</b> especial",
                promocionTexto: "10% de descuento esta semana"
            }, { "x-dispositivo-token": tokenDispositivo });
            log("Desactivar promocion responde ok", desactivar.datos?.ok === true);

            const inicioSinPromo = await llamar("GET", host, "/");
            log("Banner desaparece al desactivar la promocion", !inicioSinPromo.texto.includes('<div class="tenant-promo-banner">'));
        }

        // --- 11. Carrito rechaza mas de 30 items y un codigo invalido ---
        {
            const itemsDeMas = Array.from({ length: 31 }, () => ({ codigo: codigo1, cantidad: 1 }));
            const r = await llamar("POST", host, "/catalogo/pedido-carrito", {
                items: itemsDeMas,
                clienteNombre: "Carrito enorme",
                clienteTelefono: "4429990004"
            });
            log("Carrito con 31 items se rechaza", r.datos?.ok === false);

            const rInvalido = await llamar("POST", host, "/catalogo/pedido-carrito", {
                items: [{ codigo: "CODIGO-QUE-NO-EXISTE", cantidad: 1 }],
                clienteNombre: "Carrito invalido",
                clienteTelefono: "4429990005"
            });
            log("Carrito con codigo inexistente se rechaza", rInvalido.datos?.ok === false);
        }

        // --- 12. negocio_id = 1 no se toco ---
        {
            const real = await pool.query(`SELECT id FROM public.clientes_credito WHERE negocio_id = 1 AND telefono IN ($1, $2)`, [telefonoNuevo, telefonoClienteReal]);
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
