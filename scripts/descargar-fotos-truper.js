// Llena el Banco de Nexo con la foto principal de los productos que no
// tienen una, tomandola del servidor de TRUPER.
//
//   node --env-file=.env scripts/descargar-fotos-truper.js
//   node --env-file=.env scripts/descargar-fotos-truper.js --limite=200
//   node --env-file=.env scripts/descargar-fotos-truper.js --rehacer
//
// DE DONDE SALEN, y por que de ahi:
//
// TRUPER publica sus fotos en dos sitios distintos, y la diferencia es
// enorme:
//
//   media/import/imagenes/{CLAVE}.jpg   1800x1800   <- esta se usa
//   admin/images/ch/{codigo}.jpg         150x150
//
// La primera va por CLAVE (el SKU: PPC-6R, CAGA-1/8) y la segunda por
// codigo. Se prefiere la grande siempre; la chica queda de respaldo para
// los productos cuya clave no tiene foto publicada.
//
// La barra de la clave se vuelve guion en el nombre del archivo
// (CM-1/2T -> CM-1-2T.jpg). Sin esa regla se pierde el 13% de las fotos
// -- ya estaba documentado en banco-fotos-fabricante.js, que usa el mismo
// servidor para las fotos SECUNDARIAS de la galeria.
//
// No se guardan los 1800x1800 tal cual: se comprimen a 320 de ancho con
// la MISMA medida y calidad que usa el importador de ZIP del banco
// (comprimirImagen: 320px, calidad 72), para que todas las fotos del
// banco pesen y se vean igual sin importar por donde entraron. Guardar
// los originales serian ~1.5 GB para una foto que el POS muestra chica.
//
// Es reanudable: solo mira a quien no tiene foto. Con --rehacer tambien
// reemplaza las que se hayan guardado desde la fuente chica.

const pool = require("../db");
const sharp = require("sharp");

const BASE_GRANDE = "https://www.truper.com/media/import/imagenes";
const BASE_CHICA = "https://www.truper.com/admin/images/ch";
const ANCHO_BANCO = 320;
const CALIDAD_BANCO = 72;

// Se identifica en vez de disfrazarse de navegador, igual que el resto
// del sistema al hablar con TRUPER.
const USER_AGENT = "NexoPOS-Fotos/1.0 (+https://nexoposoficial.com)";

// En paralelo, pero sin caerle encima al servidor de TRUPER.
const EN_PARALELO = 6;
// Menos de esto no es una foto: es un pixel de relleno o una pagina de error.
const BYTES_MINIMOS = 500;

// De donde vino cada foto, para poder reemplazar despues solo las de
// baja calidad sin tocar las buenas.
const ORIGEN_GRANDE = "truper-web-1800";
const ORIGEN_CHICA = "truper-web-150";
// Marca que uso la primera version de este script, cuando solo bajaba
// miniaturas. Cuentan como reemplazables.
const ORIGEN_VIEJO = "truper-web";

function reloj(desde) {
    const s = Math.round((Date.now() - desde) / 1000);
    const m = Math.floor(s / 60);
    return m > 0 ? `${m}m ${s % 60}s` : `${s}s`;
}

function nombreArchivo(clave) {
    return String(clave).split("/").join("-");
}

async function bajar(url) {
    const respuesta = await fetch(url, {
        headers: { "User-Agent": USER_AGENT },
        signal: AbortSignal.timeout(20000)
    }).catch(() => null);

    if (!respuesta || !respuesta.ok) return null;
    const bytes = Buffer.from(await respuesta.arrayBuffer());
    return bytes.length >= BYTES_MINIMOS ? bytes : null;
}

/**
 * La foto principal de un producto, preferida en grande.
 * Devuelve null si TRUPER no publica ninguna.
 */
async function fotoDe(codigo, clave) {
    if (clave) {
        const grande = await bajar(BASE_GRANDE + "/" + encodeURIComponent(nombreArchivo(clave)) + ".jpg");
        if (grande) return { bytes: grande, origen: ORIGEN_GRANDE };
    }

    const chica = await bajar(BASE_CHICA + "/" + encodeURIComponent(codigo) + ".jpg");
    if (chica) return { bytes: chica, origen: ORIGEN_CHICA };

    return null;
}

async function main() {
    const inicio = Date.now();

    const argLimite = process.argv.find(a => a.startsWith("--limite="));
    const limite = argLimite ? Number(argLimite.split("=")[1]) || 0 : 0;
    const rehacer = process.argv.includes("--rehacer");

    // Sin foto en el banco, o con una que vino de la fuente chica cuando
    // se pide --rehacer. Las que vinieron de un ZIP del proveedor NUNCA
    // se tocan: son las de mejor origen que hay.
    const sql =
        "SELECT m.codigo_fabricante AS codigo," +
        "       MAX(m.marca) AS marca," +
        "       MAX(f.clave) AS clave" +
        "  FROM public.catalogo_maestro_productos m" +
        "  LEFT JOIN public.catalogo_fabricante_productos f" +
        "    ON f.codigo = m.codigo_fabricante AND f.estado = 'activo'" +
        " WHERE m.codigo_fabricante IS NOT NULL" +
        "   AND m.codigo_fabricante <> ''" +
        "   AND NOT EXISTS (" +
        "     SELECT 1 FROM public.banco_imagenes_producto b" +
        "      WHERE b.codigo = m.codigo_fabricante" +
        "        AND ($1 = false OR b.origen IS NULL OR b.origen NOT IN ($2, $3)))" +
        " GROUP BY m.codigo_fabricante" +
        " ORDER BY m.codigo_fabricante" +
        (limite ? " LIMIT " + limite : "");

    const pendientes = (await pool.query(sql, [rehacer, ORIGEN_VIEJO, ORIGEN_CHICA])).rows;

    if (pendientes.length === 0) {
        console.log("Todos los productos del Maestro ya tienen foto en el banco.");
        return;
    }

    console.log(pendientes.length + " productos por resolver.");
    console.log("Fuente preferida: " + BASE_GRANDE + " (1800x1800, por clave).");
    console.log("Se guardan comprimidas a " + ANCHO_BANCO + "px, igual que las del importador de ZIP.\n");

    const contadores = { grandes: 0, chicas: 0, sin_foto: 0, error: 0 };
    let hechas = 0;
    let bytesGuardados = 0;

    // Solo pisa una foto si la que hay es de baja calidad (o no hay).
    // Una del ZIP del proveedor jamas se reemplaza.
    const upsert =
        "INSERT INTO public.banco_imagenes_producto" +
        "   (codigo, marca, imagen_principal, imagen_principal_tipo," +
        "    imagen_principal_ancho, imagen_principal_alto, origen, actualizado_at)" +
        " VALUES ($1, $2, $3, 'image/jpeg', $4, $5, $6, NOW())" +
        " ON CONFLICT (codigo) DO UPDATE SET" +
        "    marca = COALESCE(EXCLUDED.marca, public.banco_imagenes_producto.marca)," +
        "    imagen_principal = EXCLUDED.imagen_principal," +
        "    imagen_principal_tipo = 'image/jpeg'," +
        "    imagen_principal_ancho = EXCLUDED.imagen_principal_ancho," +
        "    imagen_principal_alto = EXCLUDED.imagen_principal_alto," +
        "    origen = EXCLUDED.origen," +
        "    actualizado_at = NOW()" +
        " WHERE public.banco_imagenes_producto.origen IN ($7, $8)" +
        "    OR public.banco_imagenes_producto.imagen_principal IS NULL";

    async function trabajar(cola) {
        while (cola.length > 0) {
            const fila = cola.pop();
            try {
                const foto = await fotoDe(fila.codigo, fila.clave);

                if (!foto) {
                    contadores.sin_foto++;
                } else {
                    const salida = await sharp(foto.bytes)
                        .resize({ width: ANCHO_BANCO, withoutEnlargement: true })
                        .jpeg({ quality: CALIDAD_BANCO })
                        .toBuffer({ resolveWithObject: true });

                    await pool.query(upsert, [
                        fila.codigo, fila.marca || null, salida.data,
                        salida.info.width, salida.info.height, foto.origen,
                        ORIGEN_VIEJO, ORIGEN_CHICA
                    ]);

                    bytesGuardados += salida.data.length;
                    if (foto.origen === ORIGEN_GRANDE) contadores.grandes++;
                    else contadores.chicas++;
                }
            } catch (error) {
                contadores.error++;
            }

            hechas++;
            if (hechas % 25 === 0 || hechas === pendientes.length) {
                process.stdout.write(
                    "\r  " + hechas + " / " + pendientes.length +
                    "   grandes " + contadores.grandes +
                    "  chicas " + contadores.chicas +
                    "  sin foto " + contadores.sin_foto +
                    "  errores " + contadores.error +
                    "  (" + reloj(inicio) + ")   "
                );
            }
        }
    }

    const cola = pendientes.slice();
    await Promise.all(Array.from({ length: EN_PARALELO }, () => trabajar(cola)));

    console.log("\n\n===== TERMINADO en " + reloj(inicio) + " =====");
    console.log("  desde 1800x1800    " + String(contadores.grandes).padStart(8));
    console.log("  desde 150x150      " + String(contadores.chicas).padStart(8));
    console.log("  sin foto en TRUPER " + String(contadores.sin_foto).padStart(8));
    console.log("  errores            " + String(contadores.error).padStart(8));
    console.log("  guardado           " + String(Math.round(bytesGuardados / 1024 / 1024) + " MB").padStart(8));

    const cobertura = (await pool.query(
        "SELECT COUNT(*)::int total," +
        "       COUNT(*) FILTER (WHERE EXISTS (" +
        "         SELECT 1 FROM public.banco_imagenes_producto b" +
        "          WHERE b.codigo = m.codigo_fabricante))::int con_foto" +
        "  FROM public.catalogo_maestro_productos m"
    )).rows[0];

    console.log("\n  Maestro con foto: " + cobertura.con_foto + " de " + cobertura.total +
        " (" + Math.round(cobertura.con_foto / cobertura.total * 100) + "%)");
}

main()
    .catch(error => {
        console.error("\nFallo la descarga:", error.message);
        process.exitCode = 1;
    })
    .finally(async () => { await pool.end(); });
