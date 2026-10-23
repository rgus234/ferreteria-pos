// Agrega las basculas electronicas (de mostrador y plataforma) al catalogo de equipamiento de la pagina.
// Datos: catalogo del fabricante cargado en Nexo (clave, precios) + nombre del maestro + foto original del Banco.
// Las caracteristicas salen SOLO del nombre y la clave; lo demas se marca "por confirmar" (no se inventa).
const fs = require("fs");
const path = require("path");
const { Pool } = require("pg");

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const archivo = path.join(__dirname, "..", "public", "site", "equipamiento.json");

function describir(nombre, clave) {
    const t = nombre.toLowerCase();
    const cap = /(\d+)\s*kg/.exec(t) ? `${/(\d+)\s*kg/.exec(t)[1]} kg` : (/(\d+)\s*g\b/.exec(t) ? `${/(\d+)\s*g\b/.exec(t)[1]} g` : null);
    const tipo = /bolsillo/.test(t) ? "De bolsillo" : /plataforma/.test(t) ? (/plegable/.test(t) ? "De plataforma plegable" : "De plataforma") : /precisi/.test(t) ? "De precisión" : "Multifunciones";
    const especs = [["Tipo", tipo]];

    if (cap) especs.push(["Capacidad", cap]);
    if (/inoxidable/.test(t)) especs.push(["Material", "Acero inoxidable"]);
    if (/recargable/.test(t)) especs.push(["Alimentación", "Recargable"]);
    else if (/pilas/.test(t)) especs.push(["Alimentación", "Pilas"]);
    if (/torreta/.test(t)) especs.push(["Incluye", "Torreta"]);
    if (/usb/.test(t) || /-?40u$/i.test(clave)) especs.push(["Conexión", "USB"]);
    especs.push(["Características técnicas completas", "Por confirmar con el fabricante"]);

    return { tipo, cap, especs, usb: especs.some(e => e[0] === "Conexión") };
}

(async () => {
    const datos = JSON.parse(fs.readFileSync(archivo, "utf8"));
    const filas = (await pool.query(
        `SELECT m.codigo, m.marca, m.nombre, f.clave, f.precio_mayoreo mayoreo, f.precio_medio_mayoreo medio, f.precio_publico publico,
                (SELECT imagen_principal FROM public.banco_imagenes_producto b WHERE b.codigo = m.codigo LIMIT 1) AS foto
         FROM public.catalogo_maestro_productos m JOIN public.catalogo_fabricante_productos f ON f.codigo = m.codigo
         WHERE m.nombre ~* 'b.scula electr' AND m.nombre !~* '(colgante|equipaje|charola|eliminador|pata )'
         ORDER BY m.marca, f.precio_publico`
    )).rows;

    if (!datos.categorias.some(c => c.id === "basculas")) datos.categorias.push({ id: "basculas", nombre: "Básculas electrónicas" });
    datos.productos = datos.productos.filter(p => p.categoria !== "basculas");

    for (const f of filas) {
        const d = describir(f.nombre, f.clave);
        const nombreLimpio = f.nombre.replace(/,?\s*(truper|pretul)\.?\s*$/i, "").replace(/\.$/, "");

        if (f.foto) fs.writeFileSync(path.join(__dirname, "..", "public", "site", "equipos", `${f.codigo}.jpg`), f.foto);

        datos.productos.push({
            id: f.codigo, codigo: f.codigo, clave: f.clave, marca: f.marca, fabricante: "Truper", categoria: "basculas",
            nombre: nombreLimpio, conexiones: d.usb ? ["USB"] : [],
            foto: `/site/equipos/${f.codigo}.jpg`,
            precios: { mayoreo: Number(f.mayoreo), medioMayoreo: Number(f.medio), publico: Number(f.publico) },
            resumen: [d.cap ? `Capacidad ${d.cap}` : d.tipo, d.tipo].concat(d.especs.filter(e => e[0] === "Alimentación").map(e => e[1])).slice(0, 3),
            especificaciones: d.especs,
            incluye: [],
            compatibilidad: { sistemas: [] },
            garantia: ""
        });
    }

    fs.writeFileSync(archivo, JSON.stringify(datos, null, 2) + "\n");
    console.log("basculas agregadas:", filas.length, "total productos:", datos.productos.length);
    await pool.end();
})();
