// Limpieza real (negocio_id=1, Ferreteria Olimpico): fusiona duplicados
// inequivocos de categoria/marca (mismo valor con distinta mayus/minus
// o espacios sobrantes, o errores de captura obvios) encontrados en la
// auditoria de Nexo Market. Confirmado explicitamente con el usuario
// (mapeo exacto revisado antes de aplicar) -- ver
// project_nexo_market_auditoria.md.
//
// Deliberadamente NO se tocan marcas de una sola aparicion sin
// duplicado para comparar (ej. "cnx", "esma", "DEKLORA" vs
// "DEKLORAL") -- no hay forma de confirmar la grafia oficial de la
// marca real sin adivinar, y el riesgo de dejarla mal escrita pesa
// mas que el desorden cosmetico de una sola fila.
const pool = require("../db");

const CAMBIOS_CATEGORIA = [
    { anteriores: ["Plomeria "], nuevo: "Plomeria" },
    { anteriores: ["BOILERS DE GAS Y ELECTRICOS"], nuevo: "Boilers de gas y electricos" },
    { anteriores: ["gas"], nuevo: "Gas" },
    { anteriores: ["HULE"], nuevo: "Hule" },
    { anteriores: ["LIJAS DISCOS Y ABRASIVOS"], nuevo: "Lijas discos y abrasivos" },
    { anteriores: ["PEGAMENTOS Y ADHESIVOS"], nuevo: "Pegamentos y adhesivos" }
];

const CAMBIOS_MARCA = [
    { anteriores: ["Devcon", "DEVCON"], nuevo: "DEVCON" },
    { anteriores: ["Dica", "DICA"], nuevo: "DICA" },
    { anteriores: ["iusa", "IUSA"], nuevo: "IUSA" },
    { anteriores: ["igoto", "IGOTO"], nuevo: "IGOTO" },
    { anteriores: ["fleximatic", " Fleximatic", "Fleximatic", "Fleximatic "], nuevo: "Fleximatic" },
    { anteriores: ["Fandely", "FANDELI"], nuevo: "FANDELI" },
    { anteriores: ["Pennsilbania", "Pensilvania"], nuevo: "Pensilvania" },
    { anteriores: ["resistol", "RESISTOL"], nuevo: "RESISTOL" },
    { anteriores: ["3EN 1", "3 en 1"], nuevo: "3 en 1" },
    { anteriores: ["S/M", "SIN MARCA"], nuevo: "SIN MARCA" }
];

async function aplicar(columna, cambios) {
    let total = 0;
    for (const cambio of cambios) {
        const anterioresSinNuevo = cambio.anteriores.filter((valor) => valor !== cambio.nuevo);
        if (anterioresSinNuevo.length === 0) continue;
        const resultado = await pool.query(
            `UPDATE public.productos SET ${columna} = $1 WHERE negocio_id = 1 AND ${columna} = ANY($2::text[]) RETURNING id`,
            [cambio.nuevo, anterioresSinNuevo]
        );
        console.log(`  ${columna}: ${JSON.stringify(anterioresSinNuevo)} -> "${cambio.nuevo}" (${resultado.rows.length} productos)`);
        total += resultado.rows.length;
    }
    return total;
}

(async () => {
    console.log("Categorias:");
    const totalCategoria = await aplicar("categoria", CAMBIOS_CATEGORIA);
    console.log("Marcas:");
    const totalMarca = await aplicar("marca", CAMBIOS_MARCA);
    console.log(`\nTotal productos actualizados: categoria=${totalCategoria}, marca=${totalMarca}`);
    await pool.end();
})().catch((error) => {
    console.error("FALLO:", error);
    process.exit(1);
});
