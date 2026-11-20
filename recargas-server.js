// Recargas de tiempo aire: puente entre la pantalla de Nexo y Taecel (ver taecel-cliente.js y la documentacion del servicio web).
//
// El key y el nip de Taecel viven SOLO aqui, en variables de entorno del servidor (TAECEL_URL, TAECEL_KEY, TAECEL_NIP). Nunca llegan a la pantalla.
// La cuenta de Taecel es de UNA persona: por eso solo los negocios listados en TAECEL_NEGOCIOS (ids, separados por coma) pueden gastar de su saldo.
// Sin configuracion (o para cualquier otro negocio) la pantalla sigue en modo demostracion y no se mueve dinero.
//
//   GET  /recargas/modo        -> "demostracion" | "pruebas" | "produccion"
//   GET  /recargas/saldo       -> saldo de la bolsa de tiempo aire
//   GET  /recargas/productos   -> compañias y montos disponibles (se consulta una vez al dia)
//   POST /recargas/recargar    -> { token, operadora, numero, monto }; espera el resultado final (hasta 60 s)
//   GET  /recargas/historial   -> ultimas recargas del negocio
//   GET  /recargas/:id         -> si quedo pendiente, vuelve a preguntar a Taecel
//
// Una recarga exitosa genera cargo y no se puede reversar: el "token" de cada intento evita que un doble clic o un reintento de red cobre dos veces,
// y requestTXN jamas se reenvia por su cuenta.

const { responderError } = require("./error-utils");
const { PERMISOS, requerirPermiso } = require("./rbac");
const { crearCliente, esperarResultado, consultarVenta, mensajeDeError, montoDeTexto } = require("./taecel-cliente");

const MONTO_MINIMO = 10;
const MONTO_MAXIMO = 500;
const CACHE_SALDO_MS = 20 * 1000;
const CACHE_PRODUCTOS_MS = 24 * 60 * 60 * 1000;
const ESPERA_ENTRE_CONSULTAS_MS = 10000;

// Fecha (YYYY-MM-DD) en la hora de Taecel/Mexico, que es la que usa getSales.
const fechaMexico = fecha => new Date(fecha || Date.now()).toLocaleDateString("en-CA", { timeZone: "America/Mexico_City" });

// Ids de compañia de Taecel (los de getProducts, ejemplo de respuesta de Taecel 2026-11-06). Cualquier otra compañia de tiempo aire se manda como "c<id>".
const CARRIER_IDS = { telcel: "1", movistar: "2", att: "5", unefon: "4", bait: "239", virgin: "11", weex: "93" };
const BOLSA_TIEMPO_AIRE = "1";
const BOLSA_SERVICIOS = "2"; // pago de servicios y tarjetas de regalo (GiftCards): otro saldo, otras reglas
const MONTO_MAXIMO_SERVICIO = 50000;
// Marcas que no dejan que un mismo celular reciba mas de $2,000 al dia (ids de Taecel: Amazon, Netflix, Google Play, Uber).
const TARJETAS_CON_LIMITE = ["166", "87", "211", "147"];
const LIMITE_DIARIO_TARJETA = 2000;

let tablaLista = false;

async function asegurarTabla(pool) {
    if (tablaLista) return;

    await pool.query(`
        CREATE TABLE IF NOT EXISTS public.recargas_transacciones (
            id SERIAL PRIMARY KEY,
            negocio_id INTEGER NOT NULL REFERENCES public.negocios(id) ON DELETE CASCADE,
            token TEXT NOT NULL,
            operadora TEXT NOT NULL,
            numero TEXT NOT NULL,
            monto NUMERIC(10, 2) NOT NULL,
            producto TEXT NOT NULL,
            trans_id TEXT,
            folio TEXT,
            estado TEXT NOT NULL DEFAULT 'enviando',
            comision NUMERIC(10, 2),
            saldo_final NUMERIC(12, 2),
            codigo_error INTEGER,
            mensaje TEXT,
            usuario_nombre TEXT,
            ultima_consulta TIMESTAMPTZ,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            UNIQUE (negocio_id, token)
        )
    `);
    // Pago de servicios y tarjetas de regalo comparten la tabla: tipo, cargo por servicio y el codigo (pin) de las tarjetas.
    await pool.query(`ALTER TABLE public.recargas_transacciones ADD COLUMN IF NOT EXISTS tipo TEXT NOT NULL DEFAULT 'recarga'`);
    await pool.query(`ALTER TABLE public.recargas_transacciones ADD COLUMN IF NOT EXISTS cargo NUMERIC(10, 2)`);
    await pool.query(`ALTER TABLE public.recargas_transacciones ADD COLUMN IF NOT EXISTS pin TEXT`);
    await pool.query(`CREATE INDEX IF NOT EXISTS recargas_transacciones_negocio_idx ON public.recargas_transacciones (negocio_id, created_at DESC)`);
    tablaLista = true;
}

// getProducts regresa { bolsas, comisionTipo, carriersTipo, formatoCampos, carriers, productos, categorias }. De ahi solo se usa lo de TIEMPO AIRE (la bolsa de
// pago de servicios es otra). Cada producto trae Codigo (TEL050), Monto ("50.00"), Carrier, CarrierID, Vigencia y Descripcion; cada carrier trae su comision.
function normalizarCatalogo(data) {
    const raiz = Array.isArray(data) ? Object.assign({}, ...data.filter(x => x && typeof x === "object" && !Array.isArray(x))) : (data || {});
    const listaProductos = Array.isArray(raiz.productos) ? raiz.productos : [];
    const listaCarriers = Array.isArray(raiz.carriers) ? raiz.carriers : [];

    const productos = listaProductos
        .map(p => ({
            codigo: String(p.Codigo ?? p.codigo ?? "").trim(),
            carrierId: String(p.CarrierID ?? p.carrierId ?? ""),
            carrier: String(p.Carrier ?? p.carrier ?? "").trim(),
            bolsaId: String(p.BolsaID ?? p.bolsaId ?? ""),
            monto: montoDeTexto(p.Monto ?? p.monto),
            vigencia: String(p.Vigencia ?? "").trim(),
            descripcion: String(p.Descripcion ?? "").replace(/\s+/g, " ").trim()
        }))
        .filter(p => p.codigo && p.monto != null && p.bolsaId === BOLSA_TIEMPO_AIRE);

    const carriers = listaCarriers
        .filter(c => String(c.BolsaID ?? "") === BOLSA_TIEMPO_AIRE)
        .map(c => ({ id: String(c.ID), nombre: String(c.Nombre || "").trim(), tipo: String(c.Tipo ?? "0"), comision: Number(c.Comision?.ComisionCliente) || 0 }));

    return { productos, carriers };
}

// De la bolsa de PAGO DE SERVICIOS salen dos cosas: servicios (CFE, Telmex, agua... monto libre, referencia de la cuenta) y tarjetas de regalo (GiftCards:
// Google Play, Netflix, Amazon, Xbox... montos fijos; Taecel regresa el codigo de la tarjeta en el campo "pin").
function normalizarServicios(data) {
    const raiz = Array.isArray(data) ? Object.assign({}, ...data.filter(x => x && typeof x === "object" && !Array.isArray(x))) : (data || {});
    const listaProductos = Array.isArray(raiz.productos) ? raiz.productos : [];
    const listaCarriers = Array.isArray(raiz.carriers) ? raiz.carriers : [];

    return listaCarriers
        .filter(c => String(c.BolsaID ?? "") === BOLSA_SERVICIOS)
        .map(c => {
            const campo = (Array.isArray(c.Campos) ? c.Campos : []).find(x => String(x.Campo || "") === "referencia") || {};
            const productos = listaProductos
                .filter(p => String(p.CarrierID ?? "") === String(c.ID) && String(p.BolsaID ?? "") === BOLSA_SERVICIOS && String(p.Codigo || "").trim())
                .map(p => ({ codigo: String(p.Codigo).trim(), monto: montoDeTexto(p.Monto) || 0, nombre: String(p.Nombre || "").trim() }))
                .sort((a, b) => a.monto - b.monto);

            return {
                id: String(c.ID),
                nombre: String(c.Nombre || "").trim(),
                logo: String(c.Logotipo || ""),
                categoria: /gift/i.test(String(c.Categoria || "")) ? "GiftCards" : "Servicios",
                libre: String(c.Tipo ?? "0") === "1",
                cargo: Number(c.Comision?.CargoTrans) || 0,
                campo: { nombre: String(campo.Nombre || "Referencia").trim(), min: Number(campo.Min) || 1, max: Number(campo.Max) || 30, alfanumerico: String(campo.Formato ?? "1") === "2" },
                productos
            };
        })
        .filter(s => s.nombre && s.productos.length);
}

function carrierDe(operadora) {
    return CARRIER_IDS[operadora] || (/^c\d+$/.test(operadora) ? operadora.slice(1) : null);
}

// El codigo sale SIEMPRE del catalogo de Taecel: compañia + monto exactos. Sin catalogo no se manda nada (no se adivinan codigos con dinero de por medio).
function codigoDeProducto(productos, operadora, monto) {
    const carrierId = carrierDe(operadora);
    const coincide = carrierId ? productos.find(p => p.carrierId === carrierId && p.bolsaId === BOLSA_TIEMPO_AIRE && p.monto === monto) : null;
    return coincide ? coincide.codigo : null;
}

function filaPublica(f) {
    return { id: f.id, operadora: f.operadora, numero: f.numero, monto: Number(f.monto), comision: f.comision != null ? Number(f.comision) : 0, estado: f.estado, folio: f.folio || "", mensaje: f.mensaje || "", t: new Date(f.created_at).getTime(), tipo: f.tipo || "recarga", cargo: f.cargo != null ? Number(f.cargo) : 0, pin: f.pin || "" };
}

function instalar(app, pool, requerirAccesoNegocio, opciones = {}) {
    const entorno = opciones.entorno || process.env;
    const negociosPermitidos = new Set(String(entorno.TAECEL_NEGOCIOS || "").split(",").map(x => Number(x.trim())).filter(Boolean));
    const modoReal = String(entorno.TAECEL_MODO || "pruebas").toLowerCase() === "produccion" ? "produccion" : "pruebas";
    const hayCredenciales = Boolean(entorno.TAECEL_URL && entorno.TAECEL_KEY && entorno.TAECEL_NIP);
    const fabricarCliente = opciones.crearCliente || (() => crearCliente({ url: entorno.TAECEL_URL, key: entorno.TAECEL_KEY, nip: entorno.TAECEL_NIP }));
    const esperar = opciones.esperarResultado || esperarResultado;

    let cliente = null;
    const obtenerCliente = () => { if (!cliente) cliente = fabricarCliente(); return cliente; };

    let cacheSaldo = { t: 0, datos: null };
    let cacheCatalogo = { t: 0, productos: [], carriers: [], servicios: [] };
    const enVuelo = new Set(); // negocio:numero: un mismo numero no recibe dos recargas a la vez

    function negocioId(req) {
        const id = req.negocioDispositivo?.negocio_id ?? req.negocioAutenticado?.negocio_id;

        if (!id) {
            const error = new Error("Este equipo no esta vinculado a ningun negocio");
            error.httpStatus = 401;
            throw error;
        }

        return id;
    }

    // Misma regla que las demas funciones por negocio: _todas la enciende salvo que se haya apagado a proposito.
    async function funcionEncendida(idNegocio) {
        const fila = (await pool.query(`SELECT funciones_beta FROM public.negocios WHERE id = $1`, [idNegocio])).rows[0];
        const f = fila?.funciones_beta || {};
        return f.recargas === true || (f._todas === true && f.recargas !== false);
    }

    async function modoDe(idNegocio) {
        if (!hayCredenciales || !negociosPermitidos.has(Number(idNegocio))) return "demostracion";
        return (await funcionEncendida(idNegocio)) ? modoReal : "demostracion";
    }

    async function exigirReal(req, res) {
        const id = negocioId(req);
        const modo = await modoDe(id);

        if (modo === "demostracion") { res.status(409).json({ ok: false, error: "Las recargas reales no estan activas para este negocio.", modo }); return null; }

        return { id, modo };
    }

    async function catalogo() {
        if (Date.now() - cacheCatalogo.t < CACHE_PRODUCTOS_MS && cacheCatalogo.productos.length) return cacheCatalogo;

        const r = await obtenerCliente().getProducts();

        if (r.ok) cacheCatalogo = { t: Date.now(), ...normalizarCatalogo(r.data), servicios: normalizarServicios(r.data) };

        return cacheCatalogo;
    }

    const permiso = requerirPermiso(PERMISOS.HACER_VENTAS);

    app.get("/recargas/modo", requerirAccesoNegocio, async (req, res) => {
        try {
            res.json({ ok: true, modo: await modoDe(negocioId(req)) });
        } catch (error) {
            res.json({ ok: true, modo: "demostracion" });
        }
    });

    app.get("/recargas/saldo", requerirAccesoNegocio, permiso, async (req, res) => {
        try {
            const real = await exigirReal(req, res);
            if (!real) return;

            if (Date.now() - cacheSaldo.t > CACHE_SALDO_MS || !cacheSaldo.datos) {
                const r = await obtenerCliente().getBalance();

                if (!r.ok) { res.status(502).json({ ok: false, error: mensajeDeError(r.error, r.mensaje) }); return; }

                const bolsas = Array.isArray(r.data) ? r.data : [];
                const buscar = nombre => bolsas.find(b => String(b.Bolsa || "").toLowerCase().includes(nombre));
                cacheSaldo = { t: Date.now(), datos: { saldoRecargas: montoDeTexto(buscar("tiempo")?.Saldo), saldoServicios: montoDeTexto(buscar("servicio")?.Saldo) } };
            }

            res.json({ ok: true, modo: real.modo, ...cacheSaldo.datos });
        } catch (error) {
            responderError(res, error);
        }
    });

    app.get("/recargas/productos", requerirAccesoNegocio, permiso, async (req, res) => {
        try {
            const real = await exigirReal(req, res);
            if (!real) return;

            const { productos, carriers, servicios } = await catalogo();
            res.json({ ok: true, productos, carriers, servicios: servicios || [] });
        } catch (error) {
            responderError(res, error);
        }
    });

    app.get("/recargas/historial", requerirAccesoNegocio, permiso, async (req, res) => {
        try {
            await asegurarTabla(pool);
            const filas = await pool.query(`SELECT * FROM public.recargas_transacciones WHERE negocio_id = $1 ORDER BY created_at DESC LIMIT 60`, [negocioId(req)]);
            res.json({ ok: true, recargas: filas.rows.map(filaPublica) });
        } catch (error) {
            responderError(res, error);
        }
    });

    app.post("/recargas/recargar", requerirAccesoNegocio, permiso, async (req, res) => {
        let llave = null;

        try {
            const real = await exigirReal(req, res);
            if (!real) return;

            await asegurarTabla(pool);

            const token = String(req.body?.token || "").trim().slice(0, 64);
            const operadora = String(req.body?.operadora || "").toLowerCase();
            const numero = String(req.body?.numero || "").replace(/\D/g, "");
            const monto = Number(req.body?.monto);

            if (!/^[A-Za-z0-9_-]{8,64}$/.test(token)) { res.status(400).json({ ok: false, error: "Falta el identificador de la recarga." }); return; }
            if (!carrierDe(operadora)) { res.status(400).json({ ok: false, error: "Elige la compañía." }); return; }
            if (numero.length !== 10) { res.status(400).json({ ok: false, error: "El número lleva 10 dígitos." }); return; }
            if (!Number.isInteger(monto) || monto < MONTO_MINIMO || monto > MONTO_MAXIMO) { res.status(400).json({ ok: false, error: `El monto va de $${MONTO_MINIMO} a $${MONTO_MAXIMO}.` }); return; }

            // Un reintento con el mismo token NO vuelve a cobrar: regresa lo que ya paso.
            const previa = (await pool.query(`SELECT * FROM public.recargas_transacciones WHERE negocio_id = $1 AND token = $2`, [real.id, token])).rows[0];
            if (previa) { res.json({ ok: previa.estado === "exitosa", repetida: true, recarga: filaPublica(previa), error: previa.estado === "exitosa" ? undefined : previa.mensaje || "Esa recarga ya se intentó." }); return; }

            llave = `${real.id}:${numero}`;
            if (enVuelo.has(llave)) { llave = null; res.status(409).json({ ok: false, error: "Ya hay una recarga en proceso para ese número." }); return; }
            enVuelo.add(llave);

            const { productos: lista } = await catalogo().catch(() => ({ productos: [] }));
            const producto = codigoDeProducto(lista, operadora, monto);

            if (!producto) { res.status(400).json({ ok: false, error: "Ese monto no está disponible para esa compañía." }); return; }

            const usuario = req.empleadoActual?.nombre || req.negocioAutenticado?.usuario_nombre || null;
            const fila = (await pool.query(
                `INSERT INTO public.recargas_transacciones (negocio_id, token, operadora, numero, monto, producto, usuario_nombre) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
                [real.id, token, operadora, numero, monto, producto, usuario]
            )).rows[0];

            const desde = Date.now();
            const envio = await obtenerCliente().requestTXN({ producto, referencia: numero });

            if (!envio.ok) {
                // Sin respuesta de Taecel NO se sabe si proceso la recarga: no se reenvia y se pide verificar antes de repetir.
                const incierto = Boolean(envio.red);
                const mensaje = incierto ? "No se pudo confirmar con Taecel. Revisa el reporte de ventas antes de repetir esta recarga." : mensajeDeError(envio.error, envio.mensaje);
                const actualizada = (await pool.query(`UPDATE public.recargas_transacciones SET estado = $2, codigo_error = $3, mensaje = $4, updated_at = NOW() WHERE id = $1 RETURNING *`, [fila.id, incierto ? "verificar" : "fallida", envio.error || null, mensaje])).rows[0];
                res.json({ ok: false, error: mensaje, recarga: filaPublica(actualizada) });
                return;
            }

            const transID = String(envio.data?.transID || "");
            await pool.query(`UPDATE public.recargas_transacciones SET trans_id = $2, estado = 'enviada', updated_at = NOW() WHERE id = $1`, [fila.id, transID]);

            const fechaTaecel = /^d{4}-d{2}-d{2}/.test(String(envio.data?.fecha || "")) ? String(envio.data.fecha).slice(0, 10) : fechaMexico();
            const resultado = await esperar(obtenerCliente(), transID, { desde, fecha: fechaTaecel });
            const d = resultado.datos || {};
            const estado = resultado.estado === "exitosa" ? "exitosa" : resultado.estado === "fallida" ? "fallida" : "pendiente";
            const mensaje = estado === "fallida" ? resultado.mensaje : estado === "pendiente" ? "Taecel aún no confirma esta recarga. Se sigue consultando." : "";

            const actualizada = (await pool.query(
                `UPDATE public.recargas_transacciones
                 SET estado = $2, folio = $3, comision = $4, saldo_final = $5, codigo_error = $6, mensaje = $7, ultima_consulta = NOW(), updated_at = NOW()
                 WHERE id = $1 RETURNING *`,
                [fila.id, estado, d.Folio || null, montoDeTexto(d.Comision ?? d["Comisión"]), montoDeTexto(d["Saldo Final"]), resultado.error || null, mensaje || null]
            )).rows[0];

            cacheSaldo = { t: 0, datos: null };
            res.json({ ok: estado === "exitosa", pendiente: estado === "pendiente", error: estado === "exitosa" ? undefined : mensaje, recarga: filaPublica(actualizada) });
        } catch (error) {
            responderError(res, error);
        } finally {
            if (llave) enVuelo.delete(llave);
        }
    });

    // Pago de un servicio (CFE, Telmex, agua...) o compra de una tarjeta de regalo. Mismas reglas de seguridad que las recargas: token anti doble cobro,
    // una sola operacion a la vez por referencia, y el codigo del producto sale SIEMPRE del catalogo de Taecel.
    app.post("/recargas/pagar", requerirAccesoNegocio, permiso, async (req, res) => {
        let llave = null;

        try {
            const real = await exigirReal(req, res);
            if (!real) return;

            await asegurarTabla(pool);

            const token = String(req.body?.token || "").trim().slice(0, 64);
            const carrierId = String(req.body?.carrierId || "").trim();
            const codigoPedido = String(req.body?.producto || "").trim();
            const montoPedido = Number(req.body?.monto);

            if (!/^[A-Za-z0-9_-]{8,64}$/.test(token)) { res.status(400).json({ ok: false, error: "Falta el identificador del pago." }); return; }

            const { servicios: lista } = await catalogo().catch(() => ({ servicios: [] }));
            const servicio = (lista || []).find(s => s.id === carrierId);

            if (!servicio) { res.status(400).json({ ok: false, error: "Ese servicio no está disponible." }); return; }

            const referencia = servicio.campo.alfanumerico ? String(req.body?.referencia || "").replace(/[^A-Za-z0-9]/g, "").toUpperCase() : String(req.body?.referencia || "").replace(/\D/g, "");

            if (referencia.length < servicio.campo.min || referencia.length > servicio.campo.max) {
                const largo = servicio.campo.min === servicio.campo.max ? `${servicio.campo.min}` : `${servicio.campo.min} a ${servicio.campo.max}`;
                res.status(400).json({ ok: false, error: `${servicio.campo.nombre} lleva ${largo} ${servicio.campo.alfanumerico ? "caracteres" : "dígitos"}.` });
                return;
            }

            let producto;
            let monto;

            if (servicio.libre) {
                producto = servicio.productos[0];
                monto = Math.round(montoPedido * 100) / 100;

                if (!Number.isFinite(montoPedido) || Math.abs(montoPedido * 100 - Math.round(montoPedido * 100)) > 1e-6) { res.status(400).json({ ok: false, error: "El monto lleva máximo 2 decimales." }); return; }
                if (monto < 1 || monto > MONTO_MAXIMO_SERVICIO) { res.status(400).json({ ok: false, error: `El monto va de $1 a ${MONTO_MAXIMO_SERVICIO.toLocaleString("es-MX")}.` }); return; }
            } else {
                producto = servicio.productos.find(p => p.codigo === codigoPedido);

                if (!producto) { res.status(400).json({ ok: false, error: "Ese monto no está disponible para esta tarjeta." }); return; }

                monto = producto.monto;
            }

            const previa = (await pool.query(`SELECT * FROM public.recargas_transacciones WHERE negocio_id = $1 AND token = $2`, [real.id, token])).rows[0];
            if (previa) { res.json({ ok: previa.estado === "exitosa", repetida: true, recarga: filaPublica(previa), error: previa.estado === "exitosa" ? undefined : previa.mensaje || "Ese pago ya se intentó." }); return; }

            // Amazon, Netflix, Google Play y Uber: la marca bloquea la venta si un mismo celular recibe mas de $2,000 en un dia (aviso de Taecel, 2026-11-20).
            if (servicio.categoria === "GiftCards" && TARJETAS_CON_LIMITE.includes(servicio.id)) {
                const ya = Number((await pool.query(
                    `SELECT COALESCE(SUM(monto), 0) AS total FROM public.recargas_transacciones
                      WHERE negocio_id = $1 AND tipo = 'giftcard' AND numero = $2 AND operadora = $3 AND estado IN ('exitosa', 'pendiente', 'enviada')
                        AND (created_at AT TIME ZONE 'America/Mexico_City')::date = (NOW() AT TIME ZONE 'America/Mexico_City')::date`,
                    [real.id, referencia, `c${servicio.id}`]
                )).rows[0].total);

                if (ya + monto > LIMITE_DIARIO_TARJETA) {
                    res.status(400).json({ ok: false, error: `Ese celular ya recibió $${ya.toLocaleString("es-MX")} hoy en ${servicio.nombre}. Las marcas no dejan pasar de $${LIMITE_DIARIO_TARJETA.toLocaleString("es-MX")} al día por número: usa el celular del cliente.` });
                    return;
                }
            }

            llave = `${real.id}:${servicio.id}:${referencia}`;
            if (enVuelo.has(llave)) { llave = null; res.status(409).json({ ok: false, error: "Ya hay un pago en proceso para esa referencia." }); return; }
            enVuelo.add(llave);

            const tipo = servicio.categoria === "GiftCards" ? "giftcard" : "servicio";
            const usuario = req.empleadoActual?.nombre || req.negocioAutenticado?.usuario_nombre || null;
            const fila = (await pool.query(
                `INSERT INTO public.recargas_transacciones (negocio_id, token, operadora, numero, monto, producto, usuario_nombre, tipo, cargo) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
                [real.id, token, `c${servicio.id}`, referencia, monto, producto.codigo, usuario, tipo, servicio.cargo || 0]
            )).rows[0];

            const desde = Date.now();
            const envio = await obtenerCliente().requestTXN({ producto: producto.codigo, referencia, ...(servicio.libre ? { monto } : {}) });

            if (!envio.ok) {
                const incierto = Boolean(envio.red);
                const mensaje = incierto ? "No se pudo confirmar con Taecel. Revisa el reporte de ventas antes de repetir este pago." : mensajeDeError(envio.error, envio.mensaje);
                const actualizada = (await pool.query(`UPDATE public.recargas_transacciones SET estado = $2, codigo_error = $3, mensaje = $4, updated_at = NOW() WHERE id = $1 RETURNING *`, [fila.id, incierto ? "verificar" : "fallida", envio.error || null, mensaje])).rows[0];
                res.json({ ok: false, error: mensaje, recarga: filaPublica(actualizada) });
                return;
            }

            const transID = String(envio.data?.transID || "");
            await pool.query(`UPDATE public.recargas_transacciones SET trans_id = $2, estado = 'enviada', updated_at = NOW() WHERE id = $1`, [fila.id, transID]);

            const fechaTaecel = /^\d{4}-\d{2}-\d{2}/.test(String(envio.data?.fecha || "")) ? String(envio.data.fecha).slice(0, 10) : fechaMexico();
            const resultado = await esperar(obtenerCliente(), transID, { desde, fecha: fechaTaecel });
            const d = resultado.datos || {};
            const estado = resultado.estado === "exitosa" ? "exitosa" : resultado.estado === "fallida" ? "fallida" : "pendiente";
            const mensaje = estado === "fallida" ? resultado.mensaje : estado === "pendiente" ? "Taecel aún no confirma este pago. Se sigue consultando." : "";

            const actualizada = (await pool.query(
                `UPDATE public.recargas_transacciones
                 SET estado = $2, folio = $3, comision = $4, saldo_final = $5, codigo_error = $6, mensaje = $7, cargo = COALESCE($8, cargo), pin = $9, ultima_consulta = NOW(), updated_at = NOW()
                 WHERE id = $1 RETURNING *`,
                [fila.id, estado, d.Folio || null, montoDeTexto(d.Comision ?? d["Comisión"]), montoDeTexto(d["Saldo Final"]), resultado.error || null, mensaje || null, montoDeTexto(d.Cargo), String(d.pin || "").trim() || null]
            )).rows[0];

            cacheSaldo = { t: 0, datos: null };
            res.json({ ok: estado === "exitosa", pendiente: estado === "pendiente", error: estado === "exitosa" ? undefined : mensaje, recarga: filaPublica(actualizada) });
        } catch (error) {
            responderError(res, error);
        } finally {
            if (llave) enVuelo.delete(llave);
        }
    });

    // Una recarga que quedo pendiente: se le vuelve a preguntar a Taecel por getSales (nunca por statusTXN: ya se acabo su tiempo), no mas de una vez cada 10 s.
    app.get("/recargas/:id", requerirAccesoNegocio, permiso, async (req, res) => {
        try {
            const real = await exigirReal(req, res);
            if (!real) return;

            await asegurarTabla(pool);
            const fila = (await pool.query(`SELECT * FROM public.recargas_transacciones WHERE id = $1 AND negocio_id = $2`, [Number(req.params.id), real.id])).rows[0];

            if (!fila) { res.status(404).json({ ok: false, error: "No se encontró esa recarga." }); return; }

            const reciente = fila.ultima_consulta && Date.now() - new Date(fila.ultima_consulta).getTime() < ESPERA_ENTRE_CONSULTAS_MS;

            if (fila.estado !== "pendiente" || !fila.trans_id || reciente) { res.json({ ok: true, recarga: filaPublica(fila) }); return; }

            const r = await consultarVenta(obtenerCliente(), fila.trans_id, fechaMexico(fila.created_at)).catch(() => ({ estado: "desconocido", datos: null }));

            if (r.estado === "exitosa" || r.estado === "fallida") {
                const d = r.datos || {};
                const actualizada = (await pool.query(
                    `UPDATE public.recargas_transacciones SET estado = $2, folio = $3, comision = $4, saldo_final = $5, codigo_error = $6, mensaje = $7, pin = COALESCE($8, pin), ultima_consulta = NOW(), updated_at = NOW() WHERE id = $1 RETURNING *`,
                    [fila.id, r.estado, d.Folio || null, montoDeTexto(d.Comision ?? d["Comisión"]), montoDeTexto(d["Saldo Final"]), r.error || null, r.mensaje || null, String(d.pin || "").trim() || null]
                )).rows[0];
                cacheSaldo = { t: 0, datos: null };
                res.json({ ok: true, recarga: filaPublica(actualizada) });
                return;
            }

            await pool.query(`UPDATE public.recargas_transacciones SET ultima_consulta = NOW() WHERE id = $1`, [fila.id]);
            res.json({ ok: true, recarga: filaPublica(fila) });
        } catch (error) {
            responderError(res, error);
        }
    });
}

module.exports = instalar;
module.exports.normalizarCatalogo = normalizarCatalogo;
module.exports.normalizarServicios = normalizarServicios;
module.exports.codigoDeProducto = codigoDeProducto;
module.exports.MONTO_MINIMO = MONTO_MINIMO;
module.exports.MONTO_MAXIMO = MONTO_MAXIMO;
