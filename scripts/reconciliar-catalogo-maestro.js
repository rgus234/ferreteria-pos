// Fase 1 de la reconciliacion del Catalogo Maestro.
//
//   node --env-file=.env scripts/reconciliar-catalogo-maestro.js            (simula)
//   node --env-file=.env scripts/reconciliar-catalogo-maestro.js --aplicar
//   node --env-file=.env scripts/reconciliar-catalogo-maestro.js --revertir <id>
//
// Por omision SIMULA: lee, decide y reporta sin escribir una sola fila.
// Hay que pedir --aplicar a proposito.
//
// El catalogo del proveedor se usa SOLO como fuente de reconciliacion:
// de el se toma lo que une EAN <-> codigo de fabricante <-> producto, mas
// la identidad de fabrica. Sus precios NO se copian a ningun lado.

const pool = require("../db");
const { reconciliar, revertir } = require("../catalogo-maestro-reconciliacion");

// Solo catalogos que traen codigo de barras Y codigo de fabricante sirven
// como fuente de identidad global. El resto (codigos internos del
// proveedor, sin EAN) no aporta identidad que otro negocio pueda usar.
async function leerFilasDeCatalogos(fuenteId) {
    const filtro = fuenteId ? "AND c.id = $1" : "";
    const valores = fuenteId ? [fuenteId] : [];

    const r = await pool.query(
        `SELECT cp.codigo_barras AS ean,
                cp.codigo_proveedor AS codigo_fabricante,
                cp.nombre_proveedor AS nombre,
                cp.marca,
                c.proveedor AS fuente,
                c.created_at AS fuente_fecha
         FROM public.catalogo_productos cp
         JOIN public.catalogos_proveedor c ON c.id = cp.catalogo_id
         WHERE COALESCE(cp.codigo_barras, '') <> '' ${filtro}
         ORDER BY cp.codigo_barras, cp.id`,
        valores
    );

    return r.rows.map(f => ({
        ean: f.ean,
        codigoFabricante: f.codigo_fabricante,
        nombre: f.nombre,
        marca: f.marca,
        // La clave/SKU no la trae el proveedor: solo el catalogo oficial
        // del fabricante. Se completa despues, no se inventa aqui.
        clave: "",
        unidad: "",
        fabricante: f.marca,
        fuente: f.fuente,
        fuenteFecha: f.fuente_fecha
    }));
}

// Cuantas filas quedaron fuera por no traer codigo de barras: es uno de
// los numeros del reporte que pidio el dueno.
async function contarSinEan(fuenteId) {
    const filtro = fuenteId ? "AND c.id = $1" : "";
    const valores = fuenteId ? [fuenteId] : [];
    const r = await pool.query(
        `SELECT COUNT(*)::int n
         FROM public.catalogo_productos cp
         JOIN public.catalogos_proveedor c ON c.id = cp.catalogo_id
         WHERE COALESCE(cp.codigo_barras, '') = '' ${filtro}`,
        valores
    );
    return r.rows[0].n;
}

// Cuantos de los productos maestros quedaron SIN precio de referencia,
// porque su codigo de fabricante todavia no esta en el catalogo oficial.
async function contarSinPrecioFabricante() {
    const r = await pool.query(
        `SELECT COUNT(*)::int total,
                COUNT(*) FILTER (WHERE f.codigo IS NOT NULL)::int con_precio
         FROM public.catalogo_maestro_productos m
         LEFT JOIN public.catalogo_fabricante_productos f
                ON f.codigo = m.codigo_fabricante AND f.estado = 'activo'
         WHERE m.origen = 'fabricante'`
    );
    return r.rows[0];
}

function imprimirReporte(reporte, extras) {
    const linea = (etiqueta, valor) =>
        console.log("  " + String(etiqueta).padEnd(34) + String(valor).padStart(8));

    console.log("\n===============================================");
    console.log(reporte.modo === "simulacion"
        ? "  SIMULACION -- no se escribio ninguna fila"
        : "  CARGA APLICADA (reversible)");
    console.log("===============================================");
    linea("filas leidas", reporte.filasLeidas);
    console.log("  ---------------------------------------------");
    linea("productos maestros creados", reporte.productosCreados);
    linea("identificadores asociados", reporte.identificadoresCreados);
    linea("EAN asociados", reporte.productosCreados);
    linea("codigos de fabricante asociados", reporte.conCodigoFabricante);
    linea("coincidencias seguras", reporte.coincidenciasSeguras);
    console.log("  ---------------------------------------------");
    linea("conflictos (no fusionados)", reporte.conflictos);
    linea("productos sin EAN", extras.sinEan);
    linea("EAN invalido (digito verificador)", reporte.eanInvalido);
    linea("duplicados evitados", reporte.duplicadosEvitados);
    if (extras.precios) {
        console.log("  ---------------------------------------------");
        linea("con precio de referencia TRUPER", extras.precios.con_precio);
        linea("SIN precio de referencia todavia", extras.precios.total - extras.precios.con_precio);
    }
    if (reporte.reconciliacionId) {
        console.log("\n  id de la corrida: " + reporte.reconciliacionId
            + "   (revertir: --revertir " + reporte.reconciliacionId + ")");
    }

    if (reporte.ejemplosConflicto.length > 0) {
        console.log("\n  Ejemplos de conflicto (marcados para revision, NO fusionados):");
        reporte.ejemplosConflicto.slice(0, 8).forEach(c => console.log("   - " + c.motivo));
    }
    console.log("");
}

async function main() {
    const args = process.argv.slice(2);
    const aplicar = args.includes("--aplicar");
    const indiceRevertir = args.indexOf("--revertir");

    if (indiceRevertir !== -1) {
        const id = Number(args[indiceRevertir + 1]);
        if (!Number.isInteger(id)) throw new Error("uso: --revertir <id de corrida>");
        const r = await revertir(pool, id);
        console.log(`Corrida ${id} revertida: ${r.productosBorrados} productos maestros borrados.`);
        return;
    }

    const filas = await leerFilasDeCatalogos();
    const sinEan = await contarSinEan();

    console.log(`Leidas ${filas.length} filas con codigo de barras de los catalogos de proveedor.`);
    if (!aplicar) {
        console.log("Modo SIMULACION. Para escribir de verdad: --aplicar\n");
    }

    const reporte = await reconciliar(pool, filas, {
        aplicar,
        fuente: "catalogos de proveedor"
    });

    const precios = aplicar ? await contarSinPrecioFabricante() : null;
    imprimirReporte(reporte, { sinEan, precios });
}

main()
    .catch(error => {
        console.error("Fallo la reconciliacion:", error.message);
        process.exitCode = 1;
    })
    .finally(() => pool.end());
