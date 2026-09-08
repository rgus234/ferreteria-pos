// Liga los productos de un negocio al Catalogo Maestro, para que su
// ficha en Nexo Market pueda mostrar TODAS las fotos del fabricante.
//
//   node --env-file=.env scripts/ligar-productos-al-maestro.js --negocio=1 --simular
//   node --env-file=.env scripts/ligar-productos-al-maestro.js --negocio=1
//
// EL PROBLEMA QUE RESUELVE
//
// Lo reporto el dueno: en Market "nomas aparece la principal". La galeria
// funciona -- comprobado en produccion, el multicontacto 46813 devuelve
// sus 8 fotos -- pero solo para los productos que tienen
// catalogo_maestro_id. Eran 50 de 813.
//
// La razon: el banco de fotos se indexa por el codigo de CATALOGO del
// fabricante (46813) y la tienda da de alta sus productos con el codigo
// de BARRAS (7506240634553). catalogo_maestro_id es el puente, y sin el
// la ficha se queda con una sola foto.
//
// POR QUE NO ES ESTE EL TRABAJO DE aplicar-fotos-banco-a-negocio.js
//
// Aquel solo mira productos SIN foto: su trabajo es llenar huecos. El de
// aqui son productos que YA tienen su foto principal y aun asi no
// muestran galeria. Correr aquel con --forzar los alcanzaria, pero
// tambien REEMPLAZARIA las fotos que el dueno subio el mismo. Eso rompe
// la regla que el puso: la foto del cliente manda siempre.
//
// Este script no toca ninguna foto. Escribe una sola columna.
//
// LA SEGURIDAD ES LA MISMA, Y NO ES NEGOCIABLE
//
// Por codigo hay 537 candidatos, pero ligarlos a ciegas repetiria el peor
// error de este proyecto: 50 productos reales con la foto de otro. Casos
// que salen en la muestra de HOY, con el codigo casando exacto:
//
//     49892  tienda "Cople de PPR, 2\" (63mm)"  vs  maestro "3/4\" (25mm)"
//     26021  tienda "Manguera de acero inox."   vs  maestro "de aluminio"
//
// Asi que se exige lo mismo que el otro script: el codigo casa Y los
// nombres concuerdan (parecido >= 0.8, con el comparador ya corregido
// que NO tira numeros ni siglas cortas). Se importa de alli en vez de
// copiarlo: dos copias de ese comparador es como nacio el problema.

const pool = require("../db");
const { parecido, PARECIDO_MINIMO } = require("./aplicar-fotos-banco-a-negocio");

// Candidatos: productos sin ligar cuyo codigo casa con un identificador
// del Maestro, y cuyo maestro ademas tiene fotos en el banco. Si no hay
// fotos, ligarlo no le sirve de nada a la ficha.
const SQL_CANDIDATOS = `
    SELECT DISTINCT ON (p.id)
           p.id, p.codigo, p.nombre AS nombre_tienda,
           m.id AS maestro_id, m.nombre AS nombre_maestro, m.codigo_fabricante
      FROM public.productos p
      JOIN public.catalogo_maestro_identificadores i ON i.valor = p.codigo
      JOIN public.catalogo_maestro_productos m ON m.id = i.producto_maestro_id
      JOIN public.banco_imagenes_producto b ON b.codigo = m.codigo_fabricante
     WHERE p.negocio_id = $1
       AND p.catalogo_maestro_id IS NULL
     ORDER BY p.id`;

async function main() {
    const argNegocio = process.argv.find(a => a.startsWith("--negocio="));
    const negocioId = argNegocio ? Number(argNegocio.split("=")[1]) : 0;
    const simular = process.argv.includes("--simular");

    if (!negocioId) {
        console.error("Falta --negocio=N");
        process.exitCode = 1;
        return;
    }

    const negocio = await pool.query(
        "SELECT id, nombre FROM public.negocios WHERE id = $1", [negocioId]);
    if (negocio.rows.length === 0) {
        console.error(`No existe el negocio ${negocioId}`);
        process.exitCode = 1;
        return;
    }
    console.log(`Negocio ${negocioId}: ${negocio.rows[0].nombre}\n`);

    const { rows: candidatos } = await pool.query(SQL_CANDIDATOS, [negocioId]);

    const aLigar = [];
    const descartados = [];
    for (const c of candidatos) {
        const p = parecido(c.nombre_tienda, c.nombre_maestro);
        if (p >= PARECIDO_MINIMO) aLigar.push({ ...c, parecido: p });
        else descartados.push({ ...c, parecido: p });
    }

    console.log(`  candidatos por codigo:      ${candidatos.length}`);
    console.log(`  pasan tambien por nombre:   ${aLigar.length}`);
    console.log(`  descartados por el nombre:  ${descartados.length}`);

    if (descartados.length > 0) {
        console.log("\n  Ejemplos descartados (el codigo casaba, el nombre no):");
        for (const d of descartados.slice(0, 5)) {
            console.log(`    ${d.codigo}  parecido=${d.parecido.toFixed(2)}`);
            console.log(`      tienda:  ${String(d.nombre_tienda).slice(0, 46)}`);
            console.log(`      maestro: ${String(d.nombre_maestro).slice(0, 46)}`);
        }
    }

    if (aLigar.length === 0) {
        console.log("\nNada que ligar.");
        return;
    }

    if (simular) {
        console.log(`\n--simular: se ligarian ${aLigar.length}. No se escribio nada.`);
        return;
    }

    const client = await pool.connect();
    try {
        await client.query("BEGIN");
        for (const l of aLigar) {
            await client.query(
                `UPDATE public.productos SET catalogo_maestro_id = $1
                  WHERE id = $2 AND negocio_id = $3 AND catalogo_maestro_id IS NULL`,
                [l.maestro_id, l.id, negocioId]
            );
        }
        await client.query("COMMIT");
        console.log(`\nLigados ${aLigar.length} productos.`);
    } catch (error) {
        await client.query("ROLLBACK");
        throw error;
    } finally {
        client.release();
    }

    const despues = await pool.query(
        `SELECT count(*) total, count(catalogo_maestro_id) ligados
           FROM public.productos WHERE negocio_id = $1 AND visible_market = true`,
        [negocioId]);
    const d = despues.rows[0];
    console.log(`Market: ${d.ligados} de ${d.total} productos pueden mostrar galeria.`);
}

main()
    .catch(error => {
        console.error("\nFallo:", error.message);
        process.exitCode = 1;
    })
    .finally(async () => { await pool.end(); });
