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
const { crearCliente, esperarResultado, interpretarEstado, mensajeDeError, montoDeTexto } = require("./taecel-cliente");

const MONTO_MINIMO = 10;
const MONTO_MAXIMO = 500;
const CACHE_SALDO_MS = 20 * 1000;
const CACHE_PRODUCTOS_MS = 24 * 60 * 60 * 1000;
const ESPERA_ENTRE_CONSULTAS_MS = 5000;

// Ids de compañia de Taecel (los de getProducts, ejemplo de respuesta de Taecel 2026-11-06). Cualquier otra compañia de tiempo aire se manda como "c<id>".
const CARRIER_IDS = { telcel: "1", movistar: "2", att: "5", unefon: "4", bait: "239", virgin: "11", weex: "93" };
const BOLSA_TIEMPO_AIRE = "1";

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
    return { id: f.id, operadora: f.operadora, numero: f.numero, monto: Number(f.monto), comision: f.comision != null ? Number(f.comision) : 0, estado: f.estado, folio: f.folio || "", mensaje: f.mensaje || "", t: new Date(f.created_at).getTime() };
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
    let cacheCatalogo = { t: 0, productos: [], carriers: [] };
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

        if (r.ok) cacheCatalogo = { t: Date.now(), ...normalizarCatalogo(r.data) };

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

            const { productos, carriers } = await catalogo();
            res.json({ ok: true, productos, carriers });
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

            const resultado = await esperar(obtenerCliente(), transID, { desde });
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

    // Una recarga que quedo pendiente: se le vuelve a preguntar a Taecel (no mas de una vez cada 5 s por recarga).
    app.get("/recargas/:id", requerirAccesoNegocio, permiso, async (req, res) => {
        try {
            const real = await exigirReal(req, res);
            if (!real) return;

            await asegurarTabla(pool);
            const fila = (await pool.query(`SELECT * FROM public.recargas_transacciones WHERE id = $1 AND negocio_id = $2`, [Number(req.params.id), real.id])).rows[0];

            if (!fila) { res.status(404).json({ ok: false, error: "No se encontró esa recarga." }); return; }

            const reciente = fila.ultima_consulta && Date.now() - new Date(fila.ultima_consulta).getTime() < ESPERA_ENTRE_CONSULTAS_MS;

            if (fila.estado !== "pendiente" || !fila.trans_id || reciente) { res.json({ ok: true, recarga: filaPublica(fila) }); return; }

            const r = interpretarEstado(await obtenerCliente().statusTXN(fila.trans_id));

            if (r.estado === "exitosa" || r.estado === "fallida") {
                const d = r.datos || {};
                const actualizada = (await pool.query(
                    `UPDATE public.recargas_transacciones SET estado = $2, folio = $3, comision = $4, saldo_final = $5, codigo_error = $6, mensaje = $7, ultima_consulta = NOW(), updated_at = NOW() WHERE id = $1 RETURNING *`,
                    [fila.id, r.estado, d.Folio || null, montoDeTexto(d.Comision ?? d["Comisión"]), montoDeTexto(d["Saldo Final"]), r.error || null, r.mensaje || null]
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
module.exports.codigoDeProducto = codigoDeProducto;
module.exports.MONTO_MINIMO = MONTO_MINIMO;
module.exports.MONTO_MAXIMO = MONTO_MAXIMO;
