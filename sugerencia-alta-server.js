// Sugerencia de configuracion al dar de alta un producto (plan docs/plan-celular-inventario-y-venta.md, secciones 2 y J).
// El inventario del propio negocio es el "entrenamiento": se buscan los productos mas parecidos (misma familia de nombre:
// "Pija punta broca 1" ~ "Pija punta broca 3/4") y se propone copiar la configuracion que MAS de ellos comparten.
//   GET /sugerencia-alta?nombre=Pija punta broca 3/4&k=10
// Solo SUGIERE: nunca escribe nada. Nunca devuelve nombre, codigo, precios, costos ni existencias: solo como se compra y se vende.
const { responderError } = require("./error-utils");

const PALABRAS_VACIAS = new Set(["de", "del", "la", "el", "los", "las", "para", "con", "sin", "en", "y", "a", "x", "por", "tipo", "marca", "std", "pza", "pzas", "pieza", "piezas", "kg", "mm", "cm", "mts", "m", "lt", "ml", "g", "gr", "oz"]);

// Campos de "como se compra y se vende" que se copian; el orden es el de la firma para votar.
const CAMPOS = ["unidad_venta", "presentacion_compra", "factor_conversion", "permite_venta_pieza", "piezas_por_bolsa", "unidad_suelta", "bascula_digital", "stock_minimo", "categoria", "subcategoria", "categoria_nexo_id", "proveedor_id"];

function normalizar(texto) {
    return String(texto || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9ñ/ ]+/g, " ").replace(/\s+/g, " ").trim();
}

// Palabras que identifican la FAMILIA (sin medidas, numeros ni relleno): "Pija punta broca 3/4" -> ["pija", "punta", "broca"].
function palabrasFamilia(nombre) {
    return normalizar(nombre).split(" ").filter(p => p.length >= 3 && !/\d/.test(p) && !PALABRAS_VACIAS.has(p)).slice(0, 4);
}

function firma(producto) {
    return JSON.stringify(CAMPOS.map(c => producto[c] ?? null));
}

// parecidos: filas de productos con los CAMPOS y su nombre. Regresa la configuracion mas repetida, con evidencia.
function proponerConfiguracion(parecidos) {
    if (!parecidos.length) return null;

    const grupos = new Map();
    parecidos.forEach(p => { const f = firma(p); (grupos.get(f) || grupos.set(f, []).get(f)).push(p); });
    const [, ganador] = [...grupos.entries()].sort((a, b) => b[1].length - a[1].length || b[1][0].id - a[1][0].id)[0];
    const base = ganador[0];
    const configuracion = {};

    CAMPOS.forEach(c => { configuracion[c] = base[c] ?? null; });

    // Postgres entrega los numeric como texto ("100.000"): se pasan a numero para que el navegador los use directo.
    ["factor_conversion", "piezas_por_bolsa", "stock_minimo"].forEach(c => { if (configuracion[c] !== null) configuracion[c] = Number(configuracion[c]); });

    return {
        configuracion,
        votos: ganador.length,
        total: parecidos.length,
        confianza: Number((ganador.length / parecidos.length).toFixed(2)),
        evidencia: parecidos.slice(0, 5).map(p => ({ id: p.id, nombre: p.nombre, coincide: firma(p) === firma(base) })),
        resumen: resumen(configuracion)
    };
}

// Frase corta para mostrar: "Se compra por bolsa (factor 100) · se vende por kilo y por pieza".
function resumen(c) {
    const compra = c.presentacion_compra ? `Se compra por ${String(c.presentacion_compra).toLowerCase()}${Number(c.factor_conversion) > 0 ? ` (${Number(c.factor_conversion)} piezas)` : ""}` : "";
    const venta = c.unidad_venta ? `se vende por ${String(c.unidad_venta).toLowerCase()}${c.permite_venta_pieza ? " y por pieza suelta" : ""}${c.bascula_digital === "si" ? " (se pesa)" : ""}` : "";
    return [compra, venta].filter(Boolean).join(" · ") || "Sin configuración especial";
}

function instalar(app, pool, requerirAccesoNegocio) {
    app.get("/sugerencia-alta", requerirAccesoNegocio, async (req, res) => {
        try {
            const id = req.negocioDispositivo?.negocio_id ?? req.negocioAutenticado?.negocio_id;
            const palabras = palabrasFamilia(req.query.nombre);
            const k = Math.min(Math.max(Number(req.query.k) || 10, 3), 25);

            if (!id || palabras.length === 0) { res.json({ ok: true, sugerencia: null }); return; }

            // Mas parecido = mas palabras de la familia en el nombre (se exige al menos la primera: "pija").
            const filas = (await pool.query(
                `SELECT id, nombre, ${CAMPOS.join(", ")},
                        (${palabras.map((_, i) => `(lower(nombre) LIKE $${i + 2})::int`).join(" + ")}) AS coincidencias
                 FROM public.productos
                 WHERE negocio_id = $1 AND lower(nombre) LIKE $2
                 ORDER BY coincidencias DESC, id DESC
                 LIMIT ${k}`,
                [id, ...palabras.map(p => `%${p}%`)]
            )).rows;

            res.json({ ok: true, familia: palabras.join(" "), sugerencia: proponerConfiguracion(filas) });
        } catch (error) {
            responderError(res, error);
        }
    });
}

module.exports = instalar;
module.exports.palabrasFamilia = palabrasFamilia;
module.exports.proponerConfiguracion = proponerConfiguracion;
module.exports.resumen = resumen;
