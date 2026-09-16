// Fase 2 del plan de identidad multi-proveedor GAFI (ver Fase 1 en
// catalogo-maestro-resolver.js). Cuando se escribio esa fase, el catalogo
// GAFI real de Ferreteria Olimpico (catalogo_id 27, "004BE Durango Lista
// de precio 01 Diciembre 2025", negocio_id 1, 8,747 filas) YA estaba
// cargado desde antes del fix -- se subio cuando
// extraerProductoGenericoCatalogo (public/js/catalog-parsers.js)
// todavia descartaba el Alterno del fabricante. Ese dato ya no existe en
// ningun lado de la base (ni siquiera en codigosRelacionados para
// Alternos alfanumericos como "R5-45"): solo sigue existiendo en el
// archivo de precios de GAFI original.
//
// Este script:
//   1. Lee el archivo de precios GAFI real (columnas "Corto"/"Alterno").
//   2. Empareja por el CODIGO GAFI exacto (columna "Corto" ==
//      codigo_interno/codigo_proveedor en catalogo_productos) -- nunca
//      por parecido de nombre/descripcion.
//   3. Rellena clave_proveedor donde hay coincidencia exacta de codigo.
//   4. Solo para las filas que YA estaban vinculadas a un producto real
//      de este negocio (producto_id IS NOT NULL -- el dueño ya hizo la
//      accion afirmativa de traerlo a su inventario), vuelve a llamar
//      contribuirOEnlazarCatalogoMaestro() con el Alterno disponible,
//      para que quede registrado como identificador buscable en el
//      Catalogo Maestro. Nunca toca precio/costo/stock/ventas.
//
// Por omision SIMULA (no escribe nada):
//   node --env-file=.env scripts/backfill-clave-proveedor-gafi.js
//   node --env-file=.env scripts/backfill-clave-proveedor-gafi.js --aplicar
//   node --env-file=.env scripts/backfill-clave-proveedor-gafi.js --aplicar --catalogo-id=27 --archivo="C:/ruta/archivo.xls"
//
// El archivo de precios puede ser una version distinta (mas nueva o mas
// vieja) a la que se subio originalmente a Nexo -- el codigo GAFI es
// estable (auditoria de 9,582 productos reales: 0 codigos duplicados),
// pero el Alterno se revisa periodicamente (2.9% cambio entre dos
// versiones de GAFI separadas por solo 2 dias, misma auditoria). Por
// eso puede no encontrar coincidencia para algunas filas si el catalogo
// ya cargado es de una version que ya no comparte todos los codigos con
// el archivo que se le pasa a este script -- se reporta, nunca se
// inventa un Alterno para rellenar el hueco.

const pool = require("../db");
const { contribuirOEnlazarCatalogoMaestro } = require("../catalogo-maestro-resolver");

function argValor(nombre, porDefecto) {
    const prefijo = `--${nombre}=`;
    const arg = process.argv.find(a => a.startsWith(prefijo));
    return arg ? arg.slice(prefijo.length) : porDefecto;
}

const ARCHIVO_PRECIOS_GAFI = argValor("archivo", "C:/Users/gusta/Documents/gafi nuevo.xls");
const CATALOGO_ID = Number(argValor("catalogo-id", "27"));

function leerAlternosPorCodigo(archivo) {
    const XLSX = require("xlsx");
    const libro = XLSX.readFile(archivo);
    const hoja = libro.Sheets[libro.SheetNames[0]];
    // Misma correccion que la auditoria completa de GAFI: la fila real de
    // encabezados ("Corto,Alterno,Articulo,...") es la TERCERA fila cruda
    // (titulo + aviso + encabezado), los datos reales empiezan despues.
    const filas = XLSX.utils.sheet_to_json(hoja, { header: 1 }).slice(3);

    const mapa = new Map();
    for (const fila of filas) {
        const codigo = String(fila[0] || "").trim();
        const alterno = String(fila[1] || "").trim();
        if (codigo && alterno) mapa.set(codigo, alterno);
    }
    return mapa;
}

function imprimirReporte({ aplicar, totalSinClave, conCoincidencia, sinCoincidencia, actualizadas, identificadoresRegistrados, ejemplosSinCoincidencia }) {
    const linea = (etiqueta, valor) =>
        console.log("  " + String(etiqueta).padEnd(42) + String(valor).padStart(8));

    console.log("\n===============================================");
    console.log(aplicar ? "  APLICADO" : "  SIMULACION -- no se escribio ninguna fila");
    console.log("===============================================");
    linea("filas sin clave_proveedor en el catalogo", totalSinClave);
    linea("con Alterno encontrado en el archivo", conCoincidencia);
    linea("sin coincidencia (codigo no esta en el archivo)", sinCoincidencia);
    if (aplicar) {
        console.log("  ---------------------------------------------");
        linea("clave_proveedor actualizadas", actualizadas);
        linea("identificadores registrados en el Maestro", identificadoresRegistrados);
    }
    if (ejemplosSinCoincidencia.length) {
        console.log(`\n  ejemplos de codigo GAFI sin coincidencia: ${ejemplosSinCoincidencia.join(", ")}`);
    }
    if (!aplicar) {
        console.log("\n  Para escribir de verdad: --aplicar");
    }
    console.log("");
}

async function main() {
    const aplicar = process.argv.includes("--aplicar");

    const catalogoInfo = await pool.query(
        `SELECT negocio_id, proveedor FROM public.catalogos_proveedor WHERE id = $1`,
        [CATALOGO_ID]
    );
    if (catalogoInfo.rows.length === 0) {
        throw new Error(`No existe el catalogo_proveedor id=${CATALOGO_ID}`);
    }
    const { negocio_id: negocioId, proveedor: nombreProveedor } = catalogoInfo.rows[0];
    console.log(`Catalogo ${CATALOGO_ID} ("${nombreProveedor}"), negocio_id ${negocioId}.`);

    const alternosPorCodigo = leerAlternosPorCodigo(ARCHIVO_PRECIOS_GAFI);
    console.log(`Leidos ${alternosPorCodigo.size} codigos con Alterno de "${ARCHIVO_PRECIOS_GAFI}".`);

    const filas = await pool.query(
        `SELECT id, codigo_proveedor, codigo_interno, codigo_barras, nombre_proveedor, marca, producto_id
         FROM public.catalogo_productos
         WHERE catalogo_id = $1 AND clave_proveedor = ''`,
        [CATALOGO_ID]
    );

    let conCoincidencia = 0;
    let sinCoincidencia = 0;
    let actualizadas = 0;
    let identificadoresRegistrados = 0;
    const ejemplosSinCoincidencia = [];

    for (const fila of filas.rows) {
        const codigoGafi = String(fila.codigo_interno || fila.codigo_proveedor || "").trim();
        const alterno = alternosPorCodigo.get(codigoGafi);

        if (!alterno) {
            sinCoincidencia++;
            if (ejemplosSinCoincidencia.length < 8) ejemplosSinCoincidencia.push(codigoGafi);
            continue;
        }

        conCoincidencia++;
        if (!aplicar) continue;

        await pool.query(
            `UPDATE public.catalogo_productos SET clave_proveedor = $1, updated_at = NOW() WHERE id = $2`,
            [alterno, fila.id]
        );
        actualizadas++;

        // Solo si el dueño ya confirmo esta fila como producto real de su
        // inventario -- misma condicion que usan crear-producto y
        // crear-productos-lote. contribuirOEnlazarCatalogoMaestro solo
        // escribe identidad (marca/nombre/identificadores), nunca precio,
        // costo ni stock.
        if (fila.producto_id) {
            const idMaestro = await contribuirOEnlazarCatalogoMaestro(pool, negocioId, {
                codigo: codigoGafi,
                codigoFabricante: alterno,
                ean: fila.codigo_barras,
                marca: fila.marca,
                nombre: fila.nombre_proveedor,
                fuente: nombreProveedor
            });
            if (idMaestro) {
                identificadoresRegistrados++;
                await pool.query(
                    `UPDATE public.productos SET catalogo_maestro_id = $1 WHERE id = $2 AND catalogo_maestro_id IS NULL`,
                    [idMaestro, fila.producto_id]
                );
            }
        }
    }

    imprimirReporte({
        aplicar,
        totalSinClave: filas.rows.length,
        conCoincidencia,
        sinCoincidencia,
        actualizadas,
        identificadoresRegistrados,
        ejemplosSinCoincidencia
    });
}

main()
    .catch(error => {
        console.error("Fallo el backfill:", error.message);
        process.exitCode = 1;
    })
    .finally(() => pool.end());
