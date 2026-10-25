// Importar un exhibidor lleno de Truper: lee la ficha oficial (truper.com/ficha_merca/ficha-print.php?code=XXXXX), saca
// la lista "INCLUYE" (piezas, codigo, clave y nombre de cada producto) y la cruza con el catalogo y el inventario del
// negocio. SOLO LEE: crear los productos, la foto y el exhibidor lo hace el navegador con las rutas que ya existen
// (catalogo-proveedor/.../crear-producto, fotos-sugeridas/aceptar y POST /exhibidores), para no duplicar logica.
const { responderError } = require("./error-utils");

const URL_FICHA = "https://www.truper.com/ficha_merca/ficha-print.php?code=";
const ENCABEZADO = /D\.R\. © Truper S\.A\. de C\.V\. \d{4} \| Todos los derechos reservados\./g;

// Texto plano de todas las hojas de la ficha (sin el encabezado de derechos que se repite en cada una).
async function textoDeFicha(buffer) {
    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const pdf = await pdfjs.getDocument({ data: new Uint8Array(buffer), useSystemFonts: true }).promise;
    const hojas = [];

    for (let n = 1; n <= Math.min(pdf.numPages, 12); n++) {
        const contenido = await (await pdf.getPage(n)).getTextContent();
        hojas.push(contenido.items.map(item => item.str).join(" "));
    }

    return hojas.join(" ").replace(ENCABEZADO, " ").replace(/\s+/g, " ").trim();
}

// "... CÓDIGO: 55956 CLAVE: DESP-BAV-GR-C CARACTERÍSTICAS ... INCLUYE 10 Piezas: 11110 (BAV-1/16) Broca ..." -> datos.
function parsearFicha(texto) {
    const cabecera = texto.match(/^(.*?)\s*C[ÓO]DIGO:\s*(\d+)\s*CLAVE:\s*(\S+)/i);
    const indice = texto.search(/\bINCLUYE\b/i);
    const productos = [];

    if (indice >= 0) {
        const seccion = texto.slice(indice).replace(/^INCLUYE\s*/i, "");
        const patron = /(\d+)\s+Pieza[s]?:\s*(\d+)\s*\(([^)]*)\)\s*([\s\S]*?)(?=\s\d+\s+Pieza[s]?:|$)/gi;
        let m;

        while ((m = patron.exec(seccion)) !== null) {
            productos.push({ piezas: Number(m[1]), codigo: m[2], clave: m[3].trim(), nombre: m[4].replace(/\s+/g, " ").trim().slice(0, 200) });
        }
    }

    return {
        nombre: cabecera ? cabecera[1].trim().slice(0, 200) : "",
        codigo: cabecera ? cabecera[2] : "",
        clave: cabecera ? cabecera[3] : "",
        productos
    };
}

async function leerFichaTruper(codigo) {
    const respuesta = await fetch(URL_FICHA + encodeURIComponent(codigo), { signal: AbortSignal.timeout(25000), headers: { "User-Agent": "NexoPOS/1.0" } });

    if (!respuesta.ok) {
        const error = new Error("Truper no tiene ficha para ese codigo.");
        error.httpStatus = 404;
        throw error;
    }

    const recibido = Buffer.from(await respuesta.arrayBuffer());
    // La ficha de Truper trae saltos de linea antes de "%PDF": se recorta hasta el encabezado real.
    const inicio = recibido.subarray(0, 256).toString("latin1").indexOf("%PDF");
    const buffer = inicio > 0 ? recibido.subarray(inicio) : recibido;

    if (buffer.length > 8 * 1024 * 1024 || inicio < 0) {
        const error = new Error("La ficha de Truper no se pudo leer.");
        error.httpStatus = 422;
        throw error;
    }

    return parsearFicha(await textoDeFicha(buffer));
}

module.exports = (app, pool, requerirAccesoNegocio) => {
    async function negocioId(req) {
        const id = req.negocioDispositivo?.negocio_id ?? req.negocioAutenticado?.negocio_id;

        if (!id) {
            const error = new Error("Este equipo no esta vinculado a ningun negocio");
            error.httpStatus = 401;
            throw error;
        }

        return id;
    }

    // Cruza cada producto de la ficha con el catalogo de proveedor del negocio y con su inventario.
    async function cruzarConNegocio(id, productos) {
        const codigos = productos.map(p => p.codigo);

        const filas = await pool.query(
            `SELECT DISTINCT ON (codigo) * FROM (
                SELECT COALESCE(NULLIF(cp.codigo_interno, ''), cp.codigo_proveedor) AS codigo, cp.id AS cp_id, cp.catalogo_id, cp.codigo_barras,
                       cp.codigo_interno, cp.codigo_proveedor, cp.producto_id,
                       (CASE WHEN COALESCE(cp.precio_medio_mayoreo, 0) > 0 THEN 1 ELSE 0 END
                        + CASE WHEN COALESCE(cp.precio_publico, 0) > 0 THEN 1 ELSE 0 END
                        + CASE WHEN COALESCE(cp.precio_distribuidor, 0) > 0 THEN 1 ELSE 0 END) AS niveles
                FROM public.catalogo_productos cp
                WHERE cp.negocio_id = $1 AND (cp.codigo_proveedor = ANY($2) OR NULLIF(cp.codigo_interno, '') = ANY($2))
             ) c ORDER BY codigo, niveles DESC, catalogo_id DESC, cp_id ASC`,
            [id, codigos]
        );

        const enCatalogo = new Map(filas.rows.map(f => [f.codigo, f]));

        const inventario = await pool.query(
            `SELECT id, codigo FROM public.productos WHERE negocio_id = $1 AND codigo = ANY($2)`,
            [id, [...new Set([...codigos, ...filas.rows.map(f => f.codigo_barras).filter(Boolean)])]]
        );
        const porCodigo = new Map(inventario.rows.map(f => [f.codigo, f]));

        const banco = await pool.query(`SELECT codigo FROM public.banco_imagenes_producto WHERE codigo = ANY($1)`, [codigos]);
        const conBanco = new Set(banco.rows.map(f => f.codigo));

        const fotos = await pool.query(`SELECT codigo FROM public.fotos_producto WHERE negocio_id = $1 AND codigo = ANY($2)`, [id, [...porCodigo.keys()]]);
        const conFoto = new Set(fotos.rows.map(f => f.codigo));

        return productos.map(p => {
            const cp = enCatalogo.get(p.codigo);
            const propio = cp ? (porCodigo.get(cp.codigo_barras) || porCodigo.get(p.codigo) || null) : (porCodigo.get(p.codigo) || null);
            const productoId = cp?.producto_id || propio?.id || null;

            return {
                ...p,
                catalogoId: cp?.catalogo_id || null,
                catalogoProductoId: cp?.cp_id || null,
                productoId,
                tieneFoto: Boolean(propio && conFoto.has(propio.codigo)),
                fotoEnBanco: conBanco.has(p.codigo),
                estado: productoId ? "en_inventario" : (cp ? "se_crea" : "no_esta")
            };
        });
    }

    app.post("/exhibidores/truper/ficha", requerirAccesoNegocio, async (req, res) => {
        const codigo = String(req.body?.codigo || "").trim();

        if (!/^\d{4,7}$/.test(codigo)) {
            res.status(400).json({ ok: false, error: "Escribe el codigo Truper del exhibidor (solo numeros, por ejemplo 55956)." });
            return;
        }

        try {
            const id = await negocioId(req);
            const ficha = await leerFichaTruper(codigo);

            if (!ficha.productos.length) {
                res.status(422).json({ ok: false, error: "Esa ficha no trae lista de productos (no es un exhibidor surtido)." });
                return;
            }

            res.json({ ok: true, exhibidor: { codigo: ficha.codigo || codigo, clave: ficha.clave, nombre: ficha.nombre }, productos: await cruzarConNegocio(id, ficha.productos) });
        } catch (error) {
            if (error.name === "TimeoutError") {
                res.status(504).json({ ok: false, error: "Truper tardo demasiado en responder. Intenta de nuevo." });
                return;
            }

            responderError(res, error);
        }
    });
};

module.exports.parsearFicha = parsearFicha;
module.exports.textoDeFicha = textoDeFicha;
