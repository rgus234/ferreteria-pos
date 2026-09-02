// Respaldo a disco de la galeria del Banco de Nexo
// (banco_imagenes_producto_galeria), antes de sustituirla por referencias
// a las imagenes que el fabricante ya publica.
//
//   node --env-file=.env scripts/respaldar-galeria-banco.js
//   node --env-file=.env scripts/respaldar-galeria-banco.js --verificar <carpeta>
//
// Escribe una imagen por archivo mas un indice JSON con los metadatos,
// para poder reinsertarlas si hiciera falta. Va por lotes: la tabla pesa
// ~1.2 GB y no cabe en memoria de una vez.

const fs = require("fs");
const path = require("path");
const pool = require("../db");

const LOTE = 200;

const EXTENSION = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp"
};

function carpetaDestino() {
    const marca = new Date().toISOString().slice(0, 10).replace(/-/g, "");
    return path.join(__dirname, "..", "backups", `banco-galeria-${marca}`);
}

async function respaldar() {
    const destino = carpetaDestino();
    const carpetaImagenes = path.join(destino, "imagenes");
    fs.mkdirSync(carpetaImagenes, { recursive: true });

    const total = await pool.query(
        `SELECT COUNT(*)::int n FROM public.banco_imagenes_producto_galeria`
    );
    console.log(`Respaldando ${total.rows[0].n} imagenes de galeria en:`);
    console.log(`  ${destino}\n`);

    const indice = [];
    let procesadas = 0;
    let bytes = 0;
    let ultimoId = 0;

    // Paginado por id y no por OFFSET: con 75 mil filas de bytea, OFFSET
    // obliga a la base a releer todo lo anterior en cada lote.
    for (;;) {
        const r = await pool.query(
            `SELECT g.id, g.banco_imagen_id, g.orden, g.tipo, g.ancho, g.alto, g.imagen,
                    b.codigo, b.marca
             FROM public.banco_imagenes_producto_galeria g
             JOIN public.banco_imagenes_producto b ON b.id = g.banco_imagen_id
             WHERE g.id > $1
             ORDER BY g.id
             LIMIT $2`,
            [ultimoId, LOTE]
        );

        if (r.rows.length === 0) break;

        for (const fila of r.rows) {
            const ext = EXTENSION[fila.tipo] || "jpg";
            const nombre = `${fila.id}.${ext}`;
            fs.writeFileSync(path.join(carpetaImagenes, nombre), fila.imagen);

            indice.push({
                id: fila.id,
                bancoImagenId: fila.banco_imagen_id,
                codigo: fila.codigo,
                marca: fila.marca,
                orden: fila.orden,
                tipo: fila.tipo,
                ancho: fila.ancho,
                alto: fila.alto,
                archivo: `imagenes/${nombre}`,
                bytes: fila.imagen.length
            });

            bytes += fila.imagen.length;
            ultimoId = fila.id;
        }

        procesadas += r.rows.length;
        process.stdout.write(`\r  ${procesadas} / ${total.rows[0].n}  (${Math.round(bytes / 1024 / 1024)} MB)   `);
    }

    fs.writeFileSync(
        path.join(destino, "indice.json"),
        JSON.stringify({
            tabla: "banco_imagenes_producto_galeria",
            respaldadoEn: new Date().toISOString(),
            imagenes: indice.length,
            bytes,
            filas: indice
        })
    );

    console.log(`\n\nListo: ${indice.length} imagenes, ${Math.round(bytes / 1024 / 1024)} MB`);
    console.log(`Indice: ${path.join(destino, "indice.json")}`);
    console.log(`\nVerificar con:  node --env-file=.env scripts/respaldar-galeria-banco.js --verificar "${destino}"`);
    return destino;
}

// Comprueba que el respaldo esta completo y que los archivos coinciden en
// tamano con lo que hay en la base. Sin esto, "tengo respaldo" es una
// suposicion.
async function verificar(carpeta) {
    const rutaIndice = path.join(carpeta, "indice.json");
    if (!fs.existsSync(rutaIndice)) throw new Error(`no existe ${rutaIndice}`);

    const indice = JSON.parse(fs.readFileSync(rutaIndice, "utf8"));
    const enBase = await pool.query(
        `SELECT COUNT(*)::int n, COALESCE(SUM(LENGTH(imagen)), 0)::bigint bytes
         FROM public.banco_imagenes_producto_galeria`
    );

    console.log("VERIFICACION DEL RESPALDO");
    console.log(`  en la base : ${enBase.rows[0].n} imagenes, ${Math.round(Number(enBase.rows[0].bytes) / 1024 / 1024)} MB`);
    console.log(`  respaldadas: ${indice.imagenes} imagenes, ${Math.round(indice.bytes / 1024 / 1024)} MB`);

    let faltantes = 0;
    let distintos = 0;
    for (const fila of indice.filas) {
        const ruta = path.join(carpeta, fila.archivo);
        if (!fs.existsSync(ruta)) { faltantes++; continue; }
        if (fs.statSync(ruta).size !== fila.bytes) distintos++;
    }

    console.log(`  archivos faltantes      : ${faltantes}`);
    console.log(`  archivos de otro tamano : ${distintos}`);

    const completo = faltantes === 0 && distintos === 0 && indice.imagenes === enBase.rows[0].n;
    console.log(completo
        ? "\n  RESPALDO COMPLETO Y VERIFICADO"
        : "\n  RESPALDO INCOMPLETO -- no borrar nada todavia");
    return completo;
}

async function main() {
    const args = process.argv.slice(2);
    const i = args.indexOf("--verificar");
    if (i !== -1) {
        const carpeta = args[i + 1];
        if (!carpeta) throw new Error("uso: --verificar <carpeta>");
        const ok = await verificar(carpeta);
        if (!ok) process.exitCode = 1;
        return;
    }
    await respaldar();
}

main()
    .catch(error => {
        console.error("\nFallo el respaldo:", error.message);
        process.exitCode = 1;
    })
    .finally(() => pool.end());
