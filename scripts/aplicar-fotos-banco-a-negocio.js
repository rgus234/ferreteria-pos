// Le pone foto del Banco de Nexo a los productos de un negocio que no
// tienen ninguna.
//
//   node --env-file=.env scripts/aplicar-fotos-banco-a-negocio.js --negocio=1
//   node --env-file=.env scripts/aplicar-fotos-banco-a-negocio.js --negocio=1 --simular
//
// EL PROBLEMA QUE RESUELVE
//
// El banco se indexa por el codigo de CATALOGO del proveedor (49892), y
// el codigo con el que el negocio da de alta su producto suele ser el de
// BARRAS (7502320641633). Por eso, de los 797 productos de Ferreteria
// Olimpico solo 106 casaban con el banco mirando su codigo directo.
//
// El puente es catalogo_productos: ahi vive, por negocio, la fila del
// catalogo del proveedor con su codigo_proveedor, su codigo_barras y un
// producto_id que apunta al producto del inventario. Siguiendo ese
// puente se alcanzan 512 en vez de 106.
//
// POR DEFECTO SOLO SE USA EL CAMINO 1, Y HAY QUE EXPLICAR POR QUE
//
// Se probaron los tres caminos posibles contra los datos reales de
// Olimpico, comparando el nombre del producto de la tienda con el del
// catalogo del proveedor:
//
//   1. el codigo del producto YA es un codigo de banco
//        106 productos. 10 muy parecidos, 1 dudoso, 0 mal.
//   2. la fila de catalogo enlazada por producto_id
//        de 120 muestras: 33% correctos, 45% dudosos, 22% CLARAMENTE MAL
//   3. la fila de catalogo que coincide por codigo de barras
//        de 120 muestras: 3% correctos, 95% CLARAMENTE MAL
//
// Los caminos 2 y 3 no sirven porque esos enlaces se hicieron por
// PARECIDO DE NOMBRE, no por identidad. Ejemplos reales de lo que
// asignaban:
//
//     "Broquero 1/2 sin llave"        -> foto de "LLAVE para broquero"
//     "Manguera de gas de vinilo"     -> foto de "Manguera de acero inox"
//     "Rodaja esferica de 40 mm"      -> foto de "Rodaja de 50 mm"
//     "Bolsa con 200 cinchos"         -> foto de "Bolsa con 50 cinchos"
//
// Una foto equivocada en un producto es peor que ninguna: nadie la nota
// hasta que alguien en el mostrador cobra o entrega lo que no era. Por
// eso el default es solo el camino 1, que es coincidencia exacta de
// identificador y no de texto.
//
// --incluir-catalogo activa los caminos 2 y 3 a sabiendas. No usarlo
// hasta que los enlaces de catalogo_productos esten revisados.
//
// EL CAMINO 4: EAN + ACUERDO DE NOMBRE (activado por defecto)
//
// El Catalogo Maestro SI tiene EAN para sus 15.758 productos, y 474 de
// los que le faltan a Olimpico casan por ahi. Pero el EAN solo no basta:
// medido, 13% apuntaban a otro producto, porque la tienda le puso a un
// JUEGO el codigo de barras de una PIEZA suelta:
//
//     tienda:  "Juego de 10 dados cuadro 1/4"
//     maestro: "Dado de 10 mm, 6 puntas, cuadro 1/4"
//
// Asi que se exigen DOS senales independientes: que el EAN coincida
// exacto Y que los nombres concuerden. Medido sobre los 474:
//
//     nombres muy parecidos (>=0.8)   243   -> se aplican
//     banda dudosa (0.55 a 0.8)       170   -> NO, se reviso y son otros
//                                              productos ("Carda tipo
//                                              brocha" vs "Carda de copa",
//                                              "hibrida 15m" vs "PVC 10m")
//     claramente distintos             61   -> NO
//
// La banda dudosa se excluye entera a proposito: al mirarla, TODOS los
// ejemplos revisados eran productos distintos.
//
// LO QUE NO HACE, A PROPOSITO
//
// Jamas pisa una foto que el negocio ya tenga. La foto propia del dueno
// siempre gana -- es la regla de toda la funcion de fotos: el banco solo
// llena huecos, nunca reemplaza. Sin --forzar, un producto con foto se
// salta sin siquiera mirarlo.
//
// Copia los bytes (no enlaza) igual que el boton "Usar esta imagen" del
// POS: si manana el banco cambia, la foto del negocio sigue siendo suya.

const pool = require("../db");

// Que tanto se tienen que parecer los nombres para aceptar una foto que
// llego por EAN. Se midio la banda de abajo (0.55 a 0.8) y resulto ser
// toda de productos distintos, asi que el corte va alto.
const PARECIDO_MINIMO = 0.8;

// Conectores que no distinguen nada. Se quitan ESTOS por nombre, no las
// palabras cortas en general.
const CONECTORES = new Set([
    "con", "de", "del", "para", "por", "los", "las", "una", "uno",
    "y", "el", "la", "en", "sin", "a"
]);

// Las palabras que de verdad identifican al producto.
//
// La primera version tiraba TODA palabra de 2 letras o menos, y en
// ferreteria eso es justo lo que distingue un producto de otro:
//
//     "Blister con 4 pilas alcalinas AA, VOLTECK"
//     "Blister con 2 pilas alcalinas C, VOLTECK"
//
// quedaban los dos en "blister pilas alcalinas volteck" -- parecido
// 1.00, identicos. Con ese criterio se le puso a las pilas AA la foto de
// unas pilas C, y otras 49 fotos equivocadas mas (macho/hembra,
// cruz/plano, electrodos 7018/6013, escoba recta/curva). Todas diferian
// SOLO en numeros o siglas cortas.
//
// Una foto equivocada es peor que ninguna: nadie la nota hasta que
// alguien en el mostrador entrega lo que no era.
function palabras(texto) {
    return new Set(
        String(texto || "")
            .toLowerCase()
            .replace(/[^a-z0-9áéíóúñ ]/g, " ")
            .split(/\s+/)
            .filter(p => p && !CONECTORES.has(p))
    );
}

function parecido(a, b) {
    const A = palabras(a);
    const B = palabras(b);
    if (A.size === 0 || B.size === 0) return 0;

    let comunes = 0;
    for (const p of A) if (B.has(p)) comunes++;
    // Sobre el MAYOR de los dos: asi "Juego de 10 dados ..." no se da por
    // igual a "Dado de 10 mm" solo porque el segundo sea mas corto.
    return comunes / Math.max(A.size, B.size);
}

function reloj(desde) {
    const s = Math.round((Date.now() - desde) / 1000);
    const m = Math.floor(s / 60);
    return m > 0 ? `${m}m ${s % 60}s` : `${s}s`;
}

async function main() {
    const inicio = Date.now();

    const argNegocio = process.argv.find(a => a.startsWith("--negocio="));
    const negocioId = argNegocio ? Number(argNegocio.split("=")[1]) : NaN;
    const simular = process.argv.includes("--simular");
    const forzar = process.argv.includes("--forzar");
    const incluirCatalogo = process.argv.includes("--incluir-catalogo");

    if (!Number.isFinite(negocioId)) {
        console.error("Falta --negocio=N (el id del negocio).");
        process.exitCode = 1;
        return;
    }

    const negocio = (await pool.query(
        "SELECT id, nombre FROM public.negocios WHERE id = $1", [negocioId]
    )).rows[0];

    if (!negocio) {
        console.error(`No existe el negocio ${negocioId}.`);
        process.exitCode = 1;
        return;
    }

    // El codigo de banco de cada producto. Por defecto solo el camino
    // seguro (el propio codigo); los de catalogo se agregan a peticion
    // expresa, ver la nota de arriba.
    const caminosRiesgosos =
        "    (SELECT cp.codigo_proveedor FROM public.catalogo_productos cp" +
        "      WHERE cp.negocio_id = p.negocio_id AND cp.producto_id = p.id" +
        "        AND EXISTS (SELECT 1 FROM public.banco_imagenes_producto b2" +
        "                     WHERE b2.codigo = cp.codigo_proveedor)" +
        "      LIMIT 1)," +
        "    (SELECT cp.codigo_proveedor FROM public.catalogo_productos cp" +
        "      WHERE cp.negocio_id = p.negocio_id AND cp.codigo_barras = p.codigo" +
        "        AND EXISTS (SELECT 1 FROM public.banco_imagenes_producto b3" +
        "                     WHERE b3.codigo = cp.codigo_proveedor)" +
        "      LIMIT 1),";

    const sql =
        "SELECT p.id, p.codigo, p.nombre," +
        "  COALESCE(" +
        (incluirCatalogo ? caminosRiesgosos : "") +
        "    (SELECT b.codigo FROM public.banco_imagenes_producto b WHERE b.codigo = p.codigo)" +
        "  ) AS codigo_banco" +
        " FROM public.productos p" +
        " WHERE p.negocio_id = $1" +
        (forzar ? "" :
            "   AND NOT EXISTS (SELECT 1 FROM public.fotos_producto f" +
            "                    WHERE f.negocio_id = p.negocio_id AND f.codigo = p.codigo)") +
        " ORDER BY p.id";

    const candidatos = (await pool.query(sql, [negocioId])).rows;

    // Camino 4: los que no se resolvieron por codigo directo se intentan
    // por EAN, pero solo se aceptan si el nombre tambien concuerda.
    const sinResolver = candidatos.filter(f => !f.codigo_banco);
    let porEan = 0;
    let descartadosPorNombre = 0;

    if (sinResolver.length > 0) {
        const porEanSql =
            "SELECT p.id, cm.id AS maestro_id, cm.codigo_fabricante, cm.nombre AS nombre_oficial" +
            "  FROM public.productos p" +
            "  JOIN public.catalogo_maestro_productos cm ON cm.ean = p.codigo" +
            "  JOIN public.banco_imagenes_producto b ON b.codigo = cm.codigo_fabricante" +
            " WHERE p.negocio_id = $1 AND p.id = ANY($2)";

        const encontrados = (await pool.query(
            porEanSql, [negocioId, sinResolver.map(f => f.id)]
        )).rows;

        const porId = new Map(sinResolver.map(f => [f.id, f]));
        for (const hallazgo of encontrados) {
            const producto = porId.get(hallazgo.id);
            if (!producto || producto.codigo_banco) continue;

            if (parecido(producto.nombre, hallazgo.nombre_oficial) >= PARECIDO_MINIMO) {
                producto.codigo_banco = hallazgo.codigo_fabricante;
                // Se guarda el enlace al Catalogo Maestro, no solo la foto.
                //
                // Esta coincidencia ya paso las dos senales (EAN exacto Y
                // acuerdo de nombre), asi que vale mas que para una foto:
                // con ella, Nexo Market puede mostrar la galeria del
                // fabricante sin volver a adivinar. Sin el enlace, Market
                // busca el banco por el codigo de BARRAS del producto, no
                // lo encuentra, y se salta la galeria entera -- por eso
                // solo se veia la foto principal.
                producto.maestro_id = hallazgo.maestro_id;
                porEan++;
            } else {
                descartadosPorNombre++;
            }
        }
    }

    const conFoto = candidatos.filter(f => f.codigo_banco);

    if (incluirCatalogo) {
        console.log("AVISO: --incluir-catalogo usa enlaces hechos por parecido de NOMBRE.");
        console.log("       Medido en Olimpico: 22% claramente mal por producto_id, 95% por codigo de barras.\n");
    }

    console.log(`Negocio ${negocio.id}: ${negocio.nombre}`);
    console.log(`  productos sin foto:        ${candidatos.length}`);
    console.log(`  resueltos por su codigo:   ${conFoto.length - porEan}`);
    console.log(`  resueltos por EAN:         ${porEan}`);
    console.log(`  descartados: el EAN casaba pero el nombre NO: ${descartadosPorNombre}`);
    console.log(`  sin nada que ofrecerles:   ${candidatos.length - conFoto.length - descartadosPorNombre}\n`);

    if (simular) {
        console.log("--simular: no se escribio nada.");
        conFoto.slice(0, 8).forEach(f =>
            console.log(`    ${f.codigo}  ->  banco ${f.codigo_banco}   ${String(f.nombre).slice(0, 42)}`));
        return;
    }

    if (conFoto.length === 0) return;

    let aplicadas = 0;
    let fallidas = 0;

    for (const fila of conFoto) {
        try {
            // Se copian los BYTES, igual que el boton "Usar esta imagen":
            // la foto pasa a ser del negocio y no depende del banco.
            const r = await pool.query(
                "INSERT INTO public.fotos_producto" +
                "   (negocio_id, codigo, imagen_principal, imagen_principal_tipo, actualizado_at)" +
                " SELECT $1, $2, b.imagen_principal, b.imagen_principal_tipo, NOW()" +
                "   FROM public.banco_imagenes_producto b WHERE b.codigo = $3" +
                " ON CONFLICT (negocio_id, codigo) DO NOTHING",
                [negocioId, fila.codigo, fila.codigo_banco]
            );
            if (r.rowCount > 0) aplicadas++;

            // El enlace al Maestro se guarda aunque la foto ya existiera:
            // sirve para la galeria de Market, no solo para la foto.
            if (fila.maestro_id) {
                await pool.query(
                    "UPDATE public.productos SET catalogo_maestro_id = $1" +
                    " WHERE id = $2 AND negocio_id = $3 AND catalogo_maestro_id IS NULL",
                    [fila.maestro_id, fila.id, negocioId]
                );
            }
        } catch (error) {
            fallidas++;
        }

        if ((aplicadas + fallidas) % 25 === 0) {
            process.stdout.write(`\r  aplicadas ${aplicadas}  fallidas ${fallidas}  (${reloj(inicio)})   `);
        }
    }

    console.log(`\n\n===== TERMINADO en ${reloj(inicio)} =====`);
    console.log(`  fotos aplicadas    ${String(aplicadas).padStart(8)}`);
    console.log(`  fallidas           ${String(fallidas).padStart(8)}`);

    const cobertura = (await pool.query(
        "SELECT COUNT(*)::int total," +
        "       COUNT(*) FILTER (WHERE EXISTS (SELECT 1 FROM public.fotos_producto f" +
        "         WHERE f.negocio_id = p.negocio_id AND f.codigo = p.codigo))::int con_foto" +
        "  FROM public.productos p WHERE p.negocio_id = $1",
        [negocioId]
    )).rows[0];

    console.log(`\n  ${negocio.nombre}: ${cobertura.con_foto} de ${cobertura.total} productos con foto` +
        ` (${Math.round(cobertura.con_foto / cobertura.total * 100)}%)`);
}

// Se ejecuta solo cuando se llama a mano, no al importarlo. Otros
// scripts necesitan parecido() -- la unica copia buena del comparador de
// nombres, la que ya se equivoco una vez y se corrigio -- y sin esta
// guarda importarlo lanzaba la corrida entera.
if (require.main === module) {
    main()
        .catch(error => {
            console.error("\nFallo:", error.message);
            process.exitCode = 1;
        })
        .finally(async () => { await pool.end(); });
}

module.exports = { palabras, parecido, PARECIDO_MINIMO };
