// Gafi: codigos de barras y fotos, producto por producto.
//
// La lista de Gafi trae clave y precio pero NUNCA el codigo de barras ni la foto: eso solo lo da el empaque en la mano. Esta pantalla
// (solo para el administrador, detras de la funcion "gafi_captura") busca un producto de la lista, guarda el codigo de barras que se
// escanea y su foto. Con el codigo guardado, escanear ese empaque en Agregar producto ya lo reconoce (buscar-codigo ya mira codigo_barras).
//
// Reglas: un codigo de barras tiene que pasar su digito verificador y no puede ser de OTRO producto de la lista; jamas se pisa una
// foto que el producto ya tenga en inventario.

const { responderError } = require("./error-utils");
const { PERMISOS, requerirPermiso } = require("./rbac");
const { eanValido } = require("./catalogo-maestro-reconciliacion");

const PATRON_GAFI = "gafi|004be"; // igual que en catalog-server.js: la lista de Gafi de Olimpico se llama "004BE Durango..."
const LIMITE_FOTO_BYTES = 4 * 1024 * 1024;
const TIPOS_FOTO = { "image/jpeg": "image/jpeg", "image/png": "image/png", "image/webp": "image/webp" };


// ---------------------------------------------------------------- Buscador tolerante
// La lista de Gafi trae nombres abreviados ("Pegamento 850 clasico 500gr resistol") y claves con varios codigos ("1513922/2373802"). La busqueda no pide
// que todo este escrito exacto: ignora acentos y mayusculas, junta los numeros separados ("23 74 72 5" es el codigo 2374725), perdona errores de dedo
// ("resitol"), ignora palabras de relleno ("idh", "clave") y, si no hay coincidencia completa, muestra las parciales marcadas como tales.

const RELLENO = new Set(["dice", "dicen", "tiene", "trae", "es", "un", "una", "idh", "id", "sku", "cod", "codigo", "clave", "ref", "referencia", "modelo", "num", "numero", "de", "del", "la", "el", "los", "las", "para", "con", "y", "en"]);

const normalizar = texto => String(texto ?? "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");

function distancia(a, b) {
    if (Math.abs(a.length - b.length) > 2) return 3;

    let anterior = Array.from({ length: b.length + 1 }, (_, i) => i);

    for (let i = 1; i <= a.length; i++) {
        const actual = [i];
        for (let j = 1; j <= b.length; j++) actual[j] = Math.min(anterior[j] + 1, actual[j - 1] + 1, anterior[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
        anterior = actual;
    }

    return anterior[b.length];
}

// Que pidio la persona: palabras, numeros sueltos y codigos (numeros pegados: "23 74 72 5" -> 2374725).
function entenderConsulta(texto) {
    const crudas = normalizar(texto).split(/[^a-z0-9]+/).filter(Boolean);
    const codigos = new Set();
    const consumidos = new Set();

    // Tres o mas grupos de digitos seguidos (23 74 72 5) forman un solo codigo.
    let racha = [];
    const cerrar = () => {
        if (racha.length >= 3 && racha.map(r => r.t).join("").length >= 5) {
            codigos.add(racha.map(r => r.t).join(""));
            racha.forEach(r => consumidos.add(r.i));
        }
        racha = [];
    };
    crudas.forEach((t, i) => { if (/^\d{1,4}$/.test(t)) racha.push({ t, i }); else cerrar(); });
    cerrar();

    const terminos = crudas.filter((t, i) => !RELLENO.has(t) && !consumidos.has(i));

    // Un numero largo (5 o mas digitos) o una mezcla de letras y numeros (hsg1406) tambien se prueba como codigo.
    terminos.forEach(t => { if (/^\d{5,}$/.test(t) || (/\d/.test(t) && /[a-z]/.test(t) && t.length >= 4)) codigos.add(t); });

    return { terminos: [...new Set(terminos)], codigos: [...codigos] };
}

function prepararFila(f) {
    const nombre = normalizar(f.nombre_proveedor);

    return {
        fila: f,
        nombre,
        palabras: nombre.split(/[^a-z0-9]+/).filter(Boolean),
        marca: normalizar(f.marca),
        clave: normalizar(f.clave_proveedor).replace(/[^a-z0-9]+/g, ""),
        clavePartes: normalizar(f.clave_proveedor).split(/[^a-z0-9]+/).filter(Boolean),
        codigo: normalizar(f.codigo_proveedor).replace(/[^a-z0-9]+/g, ""),
        barras: String(f.codigo_barras || "")
    };
}

// Cuanto coincide una fila con lo pedido. null = no coincide en nada.
function puntuar(p, { terminos, codigos }) {
    let puntos = 0;
    let porCodigo = false;

    for (const c of codigos) {
        if (p.barras === c || p.codigo === c || p.clavePartes.includes(c)) { puntos += 200; porCodigo = true; }
        else if (p.clave.includes(c) || p.codigo.includes(c)) { puntos += 90; porCodigo = true; }
    }

    let encontrados = 0;

    for (const t of terminos) {
        // Un numero pide ESE numero ("500" es 500, 500gr o 500ml; no "5000"): el que solo empieza igual cuenta mucho menos.
        if (/^\d+$/.test(t)) {
            if (p.palabras.some(w => w === t || (w.startsWith(t) && /^[a-z]{1,3}$/.test(w.slice(t.length))))) { puntos += 14; encontrados++; continue; }
            if (p.palabras.some(w => w.startsWith(t))) { puntos += 3; encontrados++; continue; }
        }

        if (p.palabras.some(w => w === t)) { puntos += 14; encontrados++; continue; }
        if (p.palabras.some(w => w.startsWith(t))) { puntos += 11; encontrados++; continue; }
        if (p.marca.includes(t)) { puntos += 10; encontrados++; continue; }
        if (p.nombre.includes(t) || p.clave.includes(t) || p.codigo.includes(t)) { puntos += 7; encontrados++; continue; }

        if (t.length >= 4 && !/^\d+$/.test(t)) {
            const tolerancia = t.length >= 7 ? 2 : 1;
            if (p.palabras.some(w => w.length >= 3 && distancia(t, w) <= tolerancia) || (p.marca && distancia(t, p.marca) <= tolerancia)) { puntos += 5; encontrados++; }
        }
    }

    if (!porCodigo && encontrados === 0) return null;

    return { puntos, encontrados, completa: porCodigo || encontrados === terminos.length };
}

const MAXIMO_RESULTADOS = 25;
const MINIMO_BUENOS = 6;

function buscarEnLista(lista, texto) {
    const consulta = entenderConsulta(texto);

    if (!consulta.terminos.length && !consulta.codigos.length) return [];

    const buenos = [];
    const parciales = [];

    for (const p of lista) {
        const r = puntuar(p, consulta);
        if (!r) continue;
        (r.completa ? buenos : parciales).push({ p, ...r });
    }

    const orden = (a, b) => b.puntos - a.puntos || a.p.nombre.length - b.p.nombre.length;
    buenos.sort(orden);
    parciales.sort(orden);

    // Con pocas coincidencias completas se agregan las parciales (las que cumplen al menos la mitad), marcadas aparte.
    const minimo = Math.max(1, Math.ceil(consulta.terminos.length / 2));
    const extra = buenos.length >= MINIMO_BUENOS ? [] : parciales.filter(x => x.encontrados >= minimo || x.puntos >= 90);

    return [...buenos.map(x => ({ ...x, tipo: "exacta" })), ...extra.map(x => ({ ...x, tipo: "parcial" }))].slice(0, MAXIMO_RESULTADOS);
}

function instalar(app, pool, requerirAccesoNegocio) {
    function negocioId(req) {
        const id = req.negocioDispositivo?.negocio_id ?? req.negocioAutenticado?.negocio_id;

        if (!id) {
            const error = new Error("Este equipo no esta vinculado a ningun negocio");
            error.httpStatus = 401;
            throw error;
        }

        return id;
    }

    const soloAdministrador = requerirPermiso(PERMISOS.ADMINISTRAR_USUARIOS);

    const filaPublica = f => ({
        id: f.id,
        codigo: f.codigo_proveedor,
        clave: f.clave_proveedor || "",
        nombre: f.nombre_proveedor || "",
        marca: f.marca || "",
        codigoBarras: f.codigo_barras || "",
        tieneFoto: Boolean(f.tiene_foto),
        precio: f.precio_publico != null ? Number(f.precio_publico) : null
    });

    const SELECT = `SELECT cp.id, cp.codigo_proveedor, cp.clave_proveedor, cp.nombre_proveedor, cp.marca, cp.codigo_barras, cp.precio_publico, cp.producto_id,
                           (cp.imagen IS NOT NULL) AS tiene_foto
                    FROM public.catalogo_productos cp
                    JOIN public.catalogos_proveedor cat ON cat.id = cp.catalogo_id`;

    app.get("/gafi-captura/resumen", requerirAccesoNegocio, soloAdministrador, async (req, res) => {
        try {
            const r = await pool.query(
                `SELECT COUNT(*)::int AS total,
                        COUNT(*) FILTER (WHERE NULLIF(cp.codigo_barras, '') IS NOT NULL)::int AS con_barras,
                        COUNT(*) FILTER (WHERE cp.imagen IS NOT NULL)::int AS con_foto
                 FROM public.catalogo_productos cp JOIN public.catalogos_proveedor cat ON cat.id = cp.catalogo_id
                 WHERE cp.negocio_id = $1 AND cat.proveedor ~* $2`,
                [negocioId(req), PATRON_GAFI]
            );
            res.json({ ok: true, ...r.rows[0] });
        } catch (error) {
            responderError(res, error);
        }
    });

    // La lista de Gafi de un negocio son unos miles de filas: se guarda preparada en memoria un minuto (y se borra al guardar un cambio).
    const cache = new Map();

    async function listaDe(idNegocio) {
        const guardada = cache.get(idNegocio);
        if (guardada && Date.now() - guardada.t < 60 * 1000) return guardada.lista;

        const filas = await pool.query(
            `${SELECT} WHERE cp.negocio_id = $1 AND cat.proveedor ~* $2`,
            [idNegocio, PATRON_GAFI]
        );
        const lista = filas.rows.map(prepararFila);
        cache.set(idNegocio, { t: Date.now(), lista });
        return lista;
    }

    // Busca por clave, codigo, codigo de barras, marca o palabras del nombre; tolera errores y numeros separados.
    app.get("/gafi-captura/buscar", requerirAccesoNegocio, soloAdministrador, async (req, res) => {
        try {
            const texto = String(req.query.q || "").trim();

            if (texto.length < 2) {
                res.json({ ok: true, productos: [] });
                return;
            }

            const encontrados = buscarEnLista(await listaDe(negocioId(req)), texto);
            res.json({ ok: true, productos: encontrados.map(x => ({ ...filaPublica(x.p.fila), coincidencia: x.tipo })) });
        } catch (error) {
            responderError(res, error);
        }
    });

    // Guarda el codigo de barras de un producto de la lista.
    app.post("/gafi-captura/:id/codigo-barras", requerirAccesoNegocio, soloAdministrador, async (req, res) => {
        try {
            const idNegocio = negocioId(req);
            const id = Number(req.params.id);
            const ean = String(req.body?.codigoBarras || "").replace(/\s+/g, "");

            if (!Number.isInteger(id) || id <= 0) {
                res.status(400).json({ ok: false, error: "Producto no valido." });
                return;
            }

            if (!eanValido(ean)) {
                res.status(400).json({ ok: false, error: "Ese numero no es un codigo de barras valido (no pasa el digito verificador). Escanealo otra vez." });
                return;
            }

            const producto = await pool.query(
                `${SELECT} WHERE cp.id = $1 AND cp.negocio_id = $2 AND cat.proveedor ~* $3`,
                [id, idNegocio, PATRON_GAFI]
            );

            if (producto.rows.length === 0) {
                res.status(404).json({ ok: false, error: "Ese producto no es de la lista de Gafi." });
                return;
            }

            const otro = await pool.query(
                `SELECT cp.id, cp.nombre_proveedor FROM public.catalogo_productos cp
                 WHERE cp.negocio_id = $1 AND cp.codigo_barras = $2 AND cp.id <> $3 LIMIT 1`,
                [idNegocio, ean, id]
            );

            if (otro.rows.length > 0) {
                res.status(409).json({ ok: false, error: `Ese codigo de barras ya es de otro producto: "${otro.rows[0].nombre_proveedor}".` });
                return;
            }

            await pool.query(`UPDATE public.catalogo_productos SET codigo_barras = $1, updated_at = NOW() WHERE id = $2 AND negocio_id = $3`, [ean, id, idNegocio]);
            cache.delete(idNegocio);

            res.json({ ok: true, producto: filaPublica({ ...producto.rows[0], codigo_barras: ean }) });
        } catch (error) {
            responderError(res, error);
        }
    });

    // Guarda la foto (data URL jpeg/png/webp). No pisa la foto del inventario si el producto ya esta dado de alta y ya tiene una.
    app.post("/gafi-captura/:id/foto", requerirAccesoNegocio, soloAdministrador, async (req, res) => {
        try {
            const idNegocio = negocioId(req);
            const id = Number(req.params.id);
            const coincidencia = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(String(req.body?.imagen || ""));

            if (!Number.isInteger(id) || id <= 0 || !coincidencia) {
                res.status(400).json({ ok: false, error: "La foto no es valida (JPG, PNG o WebP)." });
                return;
            }

            const bytes = Buffer.from(coincidencia[2], "base64");

            if (bytes.length === 0 || bytes.length > LIMITE_FOTO_BYTES) {
                res.status(400).json({ ok: false, error: "La foto es muy grande (maximo 4 MB)." });
                return;
            }

            const producto = await pool.query(
                `${SELECT} WHERE cp.id = $1 AND cp.negocio_id = $2 AND cat.proveedor ~* $3`,
                [id, idNegocio, PATRON_GAFI]
            );

            if (producto.rows.length === 0) {
                res.status(404).json({ ok: false, error: "Ese producto no es de la lista de Gafi." });
                return;
            }

            await pool.query(`UPDATE public.catalogo_productos SET imagen = $1, imagen_tipo = $2, updated_at = NOW() WHERE id = $3 AND negocio_id = $4`, [bytes, TIPOS_FOTO[coincidencia[1]], id, idNegocio]);
            cache.delete(idNegocio);

            // Si ese producto ya esta en inventario y NO tiene foto, se le pone la misma. Nunca se pisa una existente.
            const productoId = producto.rows[0].producto_id;

            if (productoId) {
                await pool.query(
                    `INSERT INTO public.fotos_producto (negocio_id, codigo, imagen_principal, imagen_principal_tipo, actualizado_at)
                     SELECT $1, p.codigo, $3, $4, NOW() FROM public.productos p WHERE p.id = $2 AND p.negocio_id = $1 AND COALESCE(p.codigo, '') <> ''
                     ON CONFLICT (negocio_id, codigo) DO NOTHING`,
                    [idNegocio, productoId, bytes, TIPOS_FOTO[coincidencia[1]]]
                );
            }

            res.json({ ok: true, producto: filaPublica({ ...producto.rows[0], tiene_foto: true }) });
        } catch (error) {
            responderError(res, error);
        }
    });

    app.get("/gafi-captura/:id/foto", requerirAccesoNegocio, soloAdministrador, async (req, res) => {
        try {
            const f = await pool.query(`SELECT imagen, imagen_tipo FROM public.catalogo_productos WHERE id = $1 AND negocio_id = $2 AND imagen IS NOT NULL`, [Number(req.params.id), negocioId(req)]);

            if (f.rows.length === 0) {
                res.status(404).end();
                return;
            }

            res.set("Content-Type", f.rows[0].imagen_tipo || "image/jpeg");
            res.set("Cache-Control", "private, max-age=60");
            res.send(f.rows[0].imagen);
        } catch (error) {
            responderError(res, error);
        }
    });
}

module.exports = instalar;
module.exports.PATRON_GAFI = PATRON_GAFI;
module.exports.entenderConsulta = entenderConsulta;
module.exports.buscarEnLista = buscarEnLista;
module.exports.prepararFila = prepararFila;
