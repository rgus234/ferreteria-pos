// Mapa de la tienda: pasillos y estantes (zona "tienda") y secciones de bodega (zona "bodega"), cada lugar con su codigo
// para imprimir y escanear (plan docs/plan-celular-inventario-y-venta.md, secciones H y AB). Un producto tiene un lugar de
// EXHIBICION (productos.ubicacion_id) y/o uno de BODEGA (productos.ubicacion_bodega_id). El total para vender sigue siendo
// productos.stock; productos.ubicacion (texto) se mantiene sincronizado con "Tienda › Pasillo 1 › Estante 2 · Bodega › A".
const crypto = require("crypto");
const { responderError } = require("./error-utils");
const { PERMISOS, requerirPermiso } = require("./rbac");
const { agregarFotos } = require("./fotos-lugar");

const ZONAS = { tienda: "Tienda", bodega: "Bodega" };
const TIPOS = ["pasillo", "seccion", "estante", "rack", "nivel"];
const ROLES = { exhibicion: "ubicacion_id", bodega: "ubicacion_bodega_id" };

// Codigo con prefijo propio para que nunca se confunda con el de un producto ("UB-7K3Q9X").
function nuevoCodigo() {
    const alfabeto = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    const bytes = crypto.randomBytes(6);
    return "UB-" + Array.from(bytes, b => alfabeto[b % alfabeto.length]).join("");
}

// Codigo que se lee: P-01 (pasillo), P-01-E-03 (estante), P-01-E-03-N-02 (nivel); en la bodega B-S-01 (seccion) y B-S-01-R-02 (rack).
// Se hereda el codigo del lugar de arriba y NO cambia si despues se renombra o se mueve: la identidad es el codigo.
const LETRAS = { pasillo: "P", seccion: "S", estante: "E", rack: "R", nivel: "N" };

function codigoLegible(tipo, zona, codigoPadre, numero) {
    const parte = `${LETRAS[tipo] || "X"}-${String(numero).padStart(2, "0")}`;
    return codigoPadre ? `${codigoPadre}-${parte}` : (zona === "bodega" ? `B-${parte}` : parte);
}

// Para renombrar de golpe los codigos viejos (UB-XXXXXX): filas con id, zona, tipo, padre_id, orden. Devuelve Map id -> codigo.
function calcularCodigos(filas) {
    const resultado = new Map();
    const hijosDe = padre => filas.filter(f => (f.padre_id || null) === padre).sort((a, b) => a.orden - b.orden || a.id - b.id);
    const recorrer = padre => {
        const contador = {};
        for (const f of hijosDe(padre)) {
            const clave = `${f.zona}/${f.tipo}`;
            contador[clave] = (contador[clave] || 0) + 1;
            resultado.set(f.id, codigoLegible(f.tipo, f.zona, padre ? resultado.get(padre) : "", contador[clave]));
            recorrer(f.id);
        }
    };
    recorrer(null);
    return resultado;
}

// "Tienda › Pasillo 1 › Estante 2" a partir de la lista plana de ubicaciones.
function rutaDe(ubicacion, porId) {
    const partes = [];
    let actual = ubicacion;
    let guarda = 0;

    while (actual && guarda++ < 12) {
        partes.unshift(actual.nombre);
        actual = actual.padre_id ? porId.get(actual.padre_id) : null;
    }

    return [ZONAS[ubicacion.zona] || ubicacion.zona, ...partes].join(" › ");
}

function textoUbicacion(exhibicion, bodega) {
    return [exhibicion, bodega ? `Bodega: ${bodega.replace(/^Bodega › /, "")}` : ""].filter(Boolean).join(" · ");
}

// Etiqueta de estante: 2 columnas x 4 filas por hoja carta. Franja de color con la zona, QR grande a la izquierda y a la derecha
// el nombre, el CODIGO grande (P-01-E-03) y la ruta completa. Pensada para leerse a un par de metros.
async function generarPdfEtiquetasUbicacion(lugares) {
    const PDFDocument = require("pdfkit");
    const QRCode = require("qrcode");
    const doc = new PDFDocument({ size: "LETTER", margin: 0 });
    const trozos = [];
    doc.on("data", t => trozos.push(t));
    const fin = new Promise(resolve => doc.on("end", () => resolve(Buffer.concat(trozos))));
    const ancho = 270, alto = 172, margenX = 36, margenY = 34, porHoja = 8;
    const sinAcentos = t => String(t || "").replace(/›/g, ">");

    for (let i = 0; i < lugares.length; i++) {
        if (i > 0 && i % porHoja === 0) doc.addPage();

        const l = lugares[i];
        const x = margenX + (i % 2) * ancho;
        const y = margenY + Math.floor((i % porHoja) / 2) * (alto + 8);
        const w = ancho - 8;
        const color = l.zona === "bodega" ? "#b45309" : "#1d5fd1";
        const qr = await QRCode.toBuffer(l.codigo, { margin: 1, width: 360, errorCorrectionLevel: "M" });

        doc.roundedRect(x, y, w, alto, 10).lineWidth(1).stroke("#cbd5e1");
        doc.save().roundedRect(x, y, w, 26, 10).clip().rect(x, y, w, 26).fill(color).restore();
        doc.fillColor("#ffffff").font("Helvetica-Bold").fontSize(11).text(l.zona === "bodega" ? "BODEGA" : "TIENDA", x + 14, y + 8, { width: 120, lineBreak: false });
        doc.font("Helvetica-Bold").fontSize(9).text("NEXO POS", x + w - 84, y + 9, { width: 70, align: "right", lineBreak: false });

        doc.image(qr, x + 14, y + 38, { width: 108 });
        doc.fillColor("#475569").font("Helvetica").fontSize(7.5).text("Escanea con Nexo", x + 14, y + 148, { width: 108, align: "center", lineBreak: false });

        doc.fillColor("#0f172a").font("Helvetica-Bold").fontSize(l.nombre.length > 26 ? 11 : 14).text(l.nombre, x + 134, y + 40, { width: w - 148, height: 36, ellipsis: true });
        doc.fillColor(color).font("Helvetica-Bold").fontSize(l.codigo.length > 12 ? 17 : 22).text(l.codigo, x + 134, y + 84, { width: w - 148, lineBreak: false });
        doc.fillColor("#64748b").font("Helvetica").fontSize(8).text(sinAcentos(l.ruta), x + 134, y + 118, { width: w - 148, height: 34, ellipsis: true });
    }

    doc.end();
    return fin;
}

function instalar(app, pool, requerirAccesoNegocio, firmarTokenImagen) {
    function negocioId(req) {
        const id = req.negocioDispositivo?.negocio_id ?? req.negocioAutenticado?.negocio_id;

        if (!id) {
            const error = new Error("Este equipo no esta vinculado a ningun negocio");
            error.httpStatus = 401;
            throw error;
        }

        return id;
    }

    async function todas(db, id) {
        const filas = (await db.query(`SELECT * FROM public.ubicaciones WHERE negocio_id = $1 AND activa = true ORDER BY zona, orden, id`, [id])).rows;
        return { filas, porId: new Map(filas.map(f => [f.id, f])) };
    }

    const formato = (fila, porId, conteos) => ({
        id: fila.id, zona: fila.zona, tipo: fila.tipo, nombre: fila.nombre, codigo: fila.codigo, padreId: fila.padre_id, orden: fila.orden,
        ruta: rutaDe(fila, porId), productos: conteos ? (conteos.get(fila.id) || 0) : undefined
    });

    app.get("/ubicaciones", requerirAccesoNegocio, async (req, res) => {
        try {
            const id = negocioId(req);
            const { filas, porId } = await todas(pool, id);
            const conteo = (await pool.query(
                `SELECT u AS ubicacion, COUNT(*)::int n FROM (
                    SELECT ubicacion_id AS u FROM public.productos WHERE negocio_id = $1 AND ubicacion_id IS NOT NULL
                    UNION ALL SELECT ubicacion_bodega_id FROM public.productos WHERE negocio_id = $1 AND ubicacion_bodega_id IS NOT NULL) t GROUP BY u`,
                [id]
            )).rows;
            const conteos = new Map(conteo.map(c => [c.ubicacion, c.n]));

            res.json({ ok: true, ubicaciones: filas.map(f => formato(f, porId, conteos)) });
        } catch (error) {
            responderError(res, error);
        }
    });

    // Hoja de etiquetas con QR para pegar en cada estante / seccion de bodega. Regresa el PDF en base64 (el celular lo abre como archivo).
    // Plantillas: crean de un toque los lugares tipicos de un giro (solo los que no existen todavia).
    const PLANTILLAS = {
        ferreteria: [
            ...["Pasillo 1 · Tornillería", "Pasillo 2 · Herramienta manual", "Pasillo 3 · Herramienta eléctrica", "Pasillo 4 · Plomería", "Pasillo 5 · Electricidad", "Pasillo 6 · Pintura y adhesivos"].map(nombre => ({ zona: "tienda", tipo: "pasillo", nombre })),
            { zona: "tienda", tipo: "estante", nombre: "Mostrador" },
            { zona: "bodega", tipo: "seccion", nombre: "Bodega" }
        ],
        abarrotes: [
            ...["Refrigerador", "Botanas y galletas", "Bebidas", "Dulces", "Limpieza y hogar", "Abarrotes secos", "Mostrador"].map(nombre => ({ zona: "tienda", tipo: "estante", nombre })),
            { zona: "bodega", tipo: "seccion", nombre: "Trastienda" }
        ]
    };

    app.post("/ubicaciones/plantilla", requerirAccesoNegocio, requerirPermiso(PERMISOS.MODIFICAR_INVENTARIO), async (req, res) => {
        try {
            const id = negocioId(req);
            const plantilla = PLANTILLAS[req.body?.tipo];

            if (!plantilla) { res.status(400).json({ ok: false, error: "Esa plantilla no existe." }); return; }

            const { filas } = await todas(pool, id);
            let creados = 0;

            for (const lugar of plantilla) {
                if (filas.some(f => f.zona === lugar.zona && !f.padre_id && f.nombre.toLowerCase() === lugar.nombre.toLowerCase())) continue;

                let hecho = false;

                for (let intento = 0; intento < 30 && !hecho; intento++) {
                    try {
                        const orden = (await pool.query(`SELECT COALESCE(MAX(orden), 0) + 1 AS o FROM public.ubicaciones WHERE negocio_id = $1 AND zona = $2 AND padre_id IS NULL`, [id, lugar.zona])).rows[0].o;
                        await pool.query(
                            `INSERT INTO public.ubicaciones (negocio_id, zona, tipo, nombre, codigo, padre_id, orden) VALUES ($1, $2, $3, $4, $5, NULL, $6)`,
                            [id, lugar.zona, lugar.tipo, lugar.nombre, codigoLegible(lugar.tipo, lugar.zona, "", filas.filter(f => f.zona === lugar.zona && !f.padre_id && f.tipo === lugar.tipo).length + 1 + intento), orden]
                        );
                        hecho = true;
                    } catch (error) {
                        if (error.code !== "23505") throw error;
                    }
                }

                if (hecho) { creados++; filas.push({ zona: lugar.zona, tipo: lugar.tipo, padre_id: null, nombre: lugar.nombre }); }
            }

            res.status(201).json({ ok: true, creados });
        } catch (error) {
            responderError(res, error);
        }
    });

    app.post("/ubicaciones/etiquetas", requerirAccesoNegocio, async (req, res) => {
        try {
            const id = negocioId(req);
            const pedidos = new Set((Array.isArray(req.body?.ids) ? req.body.ids : []).map(Number));
            const { filas, porId } = await todas(pool, id);
            const lugares = filas.filter(f => !pedidos.size || pedidos.has(f.id)).slice(0, 120);

            if (!lugares.length) { res.status(400).json({ ok: false, error: "No hay lugares para imprimir." }); return; }

            const pdf = await generarPdfEtiquetasUbicacion(lugares.map(f => ({ nombre: f.nombre, ruta: rutaDe(f, porId), codigo: f.codigo, zona: f.zona })));
            res.json({ ok: true, total: lugares.length, nombre: "etiquetas-estantes.pdf", pdfBase64: pdf.toString("base64") });
        } catch (error) {
            responderError(res, error);
        }
    });

    app.post("/ubicaciones", requerirAccesoNegocio, requerirPermiso(PERMISOS.MODIFICAR_INVENTARIO), async (req, res) => {
        try {
            const id = negocioId(req);
            const nombre = String(req.body?.nombre || "").replace(/\s+/g, " ").trim().slice(0, 80);
            const zona = ZONAS[req.body?.zona] ? req.body.zona : "tienda";
            const tipo = TIPOS.includes(req.body?.tipo) ? req.body.tipo : "estante";
            const padreId = Number(req.body?.padreId) || null;

            if (!nombre) { res.status(400).json({ ok: false, error: "Escribe el nombre (por ejemplo Pasillo 1 o Estante 2)." }); return; }

            let codigoPadre = "";

            if (padreId) {
                const padre = (await pool.query(`SELECT zona, codigo FROM public.ubicaciones WHERE id = $1 AND negocio_id = $2 AND activa = true`, [padreId, id])).rows[0];
                codigoPadre = padre?.codigo || "";

                if (!padre) { res.status(404).json({ ok: false, error: "El lugar de arriba no existe." }); return; }
                if (padre.zona !== zona) { res.status(400).json({ ok: false, error: "Un lugar de la tienda no puede estar dentro de la bodega (ni al revés)." }); return; }
            }

            const hermanos = Number((await pool.query(`SELECT COUNT(*) AS n FROM public.ubicaciones WHERE negocio_id = $1 AND zona = $2 AND tipo = $3 AND padre_id IS NOT DISTINCT FROM $4`, [id, zona, tipo, padreId])).rows[0].n);

            for (let intento = 0; intento < 30; intento++) {
                try {
                    const orden = (await pool.query(`SELECT COALESCE(MAX(orden), 0) + 1 AS o FROM public.ubicaciones WHERE negocio_id = $1 AND zona = $2 AND padre_id IS NOT DISTINCT FROM $3`, [id, zona, padreId])).rows[0].o;
                    const fila = (await pool.query(
                        `INSERT INTO public.ubicaciones (negocio_id, zona, tipo, nombre, codigo, padre_id, orden) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
                        [id, zona, tipo, nombre, intento < 29 ? codigoLegible(tipo, zona, codigoPadre, hermanos + 1 + intento) : nuevoCodigo(), padreId, orden]
                    )).rows[0];
                    const { porId } = await todas(pool, id);

                    res.status(201).json({ ok: true, ubicacion: formato(fila, porId) });
                    return;
                } catch (error) {
                    if (error.code !== "23505") throw error; // codigo repetido: se prueba otro
                }
            }

            res.status(500).json({ ok: false, error: "No se pudo generar un codigo unico." });
        } catch (error) {
            responderError(res, error);
        }
    });

    app.patch("/ubicaciones/:id", requerirAccesoNegocio, requerirPermiso(PERMISOS.MODIFICAR_INVENTARIO), async (req, res) => {
        try {
            const id = negocioId(req);
            const ubicacionId = Number(req.params.id);
            const actual = (await pool.query(`SELECT * FROM public.ubicaciones WHERE id = $1 AND negocio_id = $2`, [ubicacionId, id])).rows[0];

            if (!actual) { res.status(404).json({ ok: false, error: "Ese lugar no existe." }); return; }

            const nombre = req.body?.nombre !== undefined ? String(req.body.nombre).replace(/\s+/g, " ").trim().slice(0, 80) : actual.nombre;
            if (!nombre) { res.status(400).json({ ok: false, error: "El nombre no puede quedar vacio." }); return; }

            let padreId = actual.padre_id;

            if (req.body?.padreId !== undefined) {
                padreId = Number(req.body.padreId) || null;

                if (padreId) {
                    if (padreId === ubicacionId) { res.status(400).json({ ok: false, error: "Un lugar no puede estar dentro de si mismo." }); return; }

                    const { porId } = await todas(pool, id);
                    let subiendo = porId.get(padreId);
                    while (subiendo) { if (subiendo.id === ubicacionId) { res.status(400).json({ ok: false, error: "No se puede mover un lugar dentro de uno de sus propios lugares." }); return; } subiendo = subiendo.padre_id ? porId.get(subiendo.padre_id) : null; }

                    if (!porId.get(padreId) || porId.get(padreId).zona !== actual.zona) { res.status(400).json({ ok: false, error: "El lugar de destino no es valido." }); return; }
                }
            }

            const orden = req.body?.orden !== undefined ? Math.max(0, Number(req.body.orden) || 0) : actual.orden;
            await pool.query(`UPDATE public.ubicaciones SET nombre = $3, padre_id = $4, orden = $5 WHERE id = $1 AND negocio_id = $2`, [ubicacionId, id, nombre, padreId, orden]);

            await sincronizarTextos(pool, id);
            res.json({ ok: true });
        } catch (error) {
            responderError(res, error);
        }
    });

    app.delete("/ubicaciones/:id", requerirAccesoNegocio, requerirPermiso(PERMISOS.MODIFICAR_INVENTARIO), async (req, res) => {
        try {
            const id = negocioId(req);
            const ubicacionId = Number(req.params.id);
            const { filas } = await todas(pool, id);
            const rama = new Set([ubicacionId]);
            let creciendo = true;
            while (creciendo) { creciendo = false; for (const f of filas) if (f.padre_id && rama.has(f.padre_id) && !rama.has(f.id)) { rama.add(f.id); creciendo = true; } }

            if (!filas.some(f => f.id === ubicacionId)) { res.status(404).json({ ok: false, error: "Ese lugar no existe." }); return; }

            const usados = Number((await pool.query(`SELECT COUNT(*)::int n FROM public.productos WHERE negocio_id = $1 AND (ubicacion_id = ANY($2) OR ubicacion_bodega_id = ANY($2))`, [id, [...rama]])).rows[0].n);

            if (usados > 0 && req.query.confirmar !== "1") {
                res.status(409).json({ ok: false, error: `Hay ${usados} producto(s) en este lugar. Si lo borras se quedan sin lugar (no se borran).`, productos: usados, requiereConfirmar: true });
                return;
            }

            await pool.query(`DELETE FROM public.ubicaciones WHERE id = $1 AND negocio_id = $2`, [ubicacionId, id]); // los de adentro se van en cascada; los productos quedan sin lugar
            await sincronizarTextos(pool, id);
            res.json({ ok: true, productosSinLugar: usados });
        } catch (error) {
            responderError(res, error);
        }
    });

    // Lo que devuelve un escaner al leer una etiqueta de estante o de bodega.
    app.get("/ubicaciones/codigo/:codigo", requerirAccesoNegocio, async (req, res) => {
        try {
            const id = negocioId(req);
            const codigo = String(req.params.codigo || "").trim().toUpperCase();
            const { filas, porId } = await todas(pool, id);
            const fila = filas.find(f => f.codigo === codigo);

            if (!fila) { res.status(404).json({ ok: false, error: "Ese codigo no es de ningun estante ni seccion de tu tienda." }); return; }

            res.json({ ok: true, ubicacion: formato(fila, porId) });
        } catch (error) {
            responderError(res, error);
        }
    });

    app.get("/ubicaciones/:id/productos", requerirAccesoNegocio, async (req, res) => {
        try {
            const id = negocioId(req);
            const filas = (await pool.query(
                `SELECT id, nombre, codigo, stock, unidad_venta, (ubicacion_id = $2) AS exhibido, (ubicacion_bodega_id = $2) AS en_bodega
                 FROM public.productos WHERE negocio_id = $1 AND (ubicacion_id = $2 OR ubicacion_bodega_id = $2) ORDER BY nombre LIMIT 500`,
                [id, Number(req.params.id)]
            )).rows;

            const conFoto = await agregarFotos(pool, id, filas, firmarTokenImagen);

            res.json({ ok: true, productos: conFoto.map(p => ({ id: p.id, nombre: p.nombre, codigo: p.codigo, stock: Number(p.stock), unidadVenta: p.unidad_venta, exhibido: p.exhibido, enBodega: p.en_bodega, imagenUrl: p.imagenUrl })) });
        } catch (error) {
            responderError(res, error);
        }
    });

    // Pone varios productos en un lugar como exhibicion o como bodega (acomodo, alta y conteo con "contexto de estante").
    app.post("/ubicaciones/:id/asignar", requerirAccesoNegocio, requerirPermiso(PERMISOS.MODIFICAR_INVENTARIO), async (req, res) => {
        try {
            const id = negocioId(req);
            const ubicacionId = Number(req.params.id);
            const rol = ROLES[req.body?.rol] ? req.body.rol : (/* por zona */ null);
            const ids = [...new Set((Array.isArray(req.body?.productoIds) ? req.body.productoIds : []).map(Number).filter(n => Number.isInteger(n) && n > 0))].slice(0, 300);
            const { porId } = await todas(pool, id);
            const lugar = porId.get(ubicacionId);

            if (!lugar) { res.status(404).json({ ok: false, error: "Ese lugar no existe." }); return; }
            if (!ids.length) { res.status(400).json({ ok: false, error: "Elige al menos un producto." }); return; }

            // En la tienda va como exhibicion y en la bodega como bodega, salvo que se pida otra cosa explicitamente.
            const columna = ROLES[rol] || (lugar.zona === "bodega" ? ROLES.bodega : ROLES.exhibicion);
            // Lo que tenian antes: si ya estaban en OTRO lugar es un movimiento y queda registrado (quien, cuando, de donde a donde).
            const antes = (await pool.query(`SELECT id, nombre, ${columna} AS lugar_anterior FROM public.productos WHERE negocio_id = $1 AND id = ANY($2)`, [id, ids])).rows;
            const r = await pool.query(`UPDATE public.productos SET ${columna} = $3 WHERE negocio_id = $1 AND id = ANY($2) RETURNING id`, [id, ids, ubicacionId]);

            await sincronizarTextos(pool, id, r.rows.map(f => f.id));

            const empleadoId = Number(req.headers["x-empleado-id"]) || null;
            const movidos = [];

            for (const p of antes) {
                if (p.lugar_anterior === ubicacionId) continue;

                const anterior = p.lugar_anterior ? porId.get(p.lugar_anterior) : null;
                const detalle = { productoId: p.id, producto: p.nombre, rol: columna === ROLES.bodega ? "bodega" : "exhibicion", desdeId: p.lugar_anterior || null, desde: anterior ? rutaDe(anterior, porId) : "", haciaId: ubicacionId, hacia: rutaDe(lugar, porId) };

                if (anterior) movidos.push(detalle);

                try {
                    await pool.query(`INSERT INTO public.bitacora_acciones (negocio_id, empleado_id, accion, detalle) VALUES ($1, $2, $3, $4::jsonb)`, [id, empleadoId, anterior ? "producto_movido" : "producto_acomodado", JSON.stringify(detalle)]);
                } catch (error) {
                    // La bitacora nunca debe tumbar la operacion real que registra.
                }
            }

            res.json({ ok: true, asignados: r.rowCount, movidos: movidos.length });
        } catch (error) {
            responderError(res, error);
        }
    });

    // productos.ubicacion (texto) = "Tienda › Pasillo 1 › Estante 2 · Bodega: Seccion A", para lo que ya lee ese campo.
    async function sincronizarTextos(db, id, soloProductos = null) {
        const { porId } = await todas(db, id);

        // Un producto que se quedo sin lugar (se borro su estante) pierde ese texto; lo que alguien escribio a mano no se toca.
        if (!soloProductos) {
            await db.query(`UPDATE public.productos SET ubicacion = '' WHERE negocio_id = $1 AND ubicacion_id IS NULL AND ubicacion_bodega_id IS NULL AND (ubicacion LIKE 'Tienda ›%' OR ubicacion LIKE 'Bodega:%')`, [id]);
        }

        const productos = (await db.query(
            `SELECT id, ubicacion_id, ubicacion_bodega_id FROM public.productos WHERE negocio_id = $1 AND (ubicacion_id IS NOT NULL OR ubicacion_bodega_id IS NOT NULL) AND ($2::int[] IS NULL OR id = ANY($2))`,
            [id, soloProductos]
        )).rows;

        for (const p of productos) {
            const exhibicion = p.ubicacion_id && porId.get(p.ubicacion_id) ? rutaDe(porId.get(p.ubicacion_id), porId) : "";
            const bodega = p.ubicacion_bodega_id && porId.get(p.ubicacion_bodega_id) ? rutaDe(porId.get(p.ubicacion_bodega_id), porId) : "";
            await db.query(`UPDATE public.productos SET ubicacion = $2 WHERE id = $1`, [p.id, textoUbicacion(exhibicion, bodega)]);
        }
    }
}

module.exports = instalar;
module.exports.nuevoCodigo = nuevoCodigo;
module.exports.codigoLegible = codigoLegible;
module.exports.calcularCodigos = calcularCodigos;
module.exports.rutaDe = rutaDe;
module.exports.textoUbicacion = textoUbicacion;
