// Crea banners de ejemplo reales en banners_market usando fotos reales del
// Banco de Nexo (banco_imagenes_producto), uno por categoria real, para que
// el usuario vea la funcion "Ofertas destacadas" ya implementada en /market.
// No es parte de la suite automatizada. Uso: node --env-file=.env scripts/crear-banners-ejemplo.js
const sharp = require("sharp");
const pool = require("../db");

async function procesarImagenBanner(buffer) {
    const { data } = await sharp(buffer)
        .resize({ width: 1200, height: 500, fit: "cover" })
        .jpeg({ quality: 78 })
        .toBuffer({ resolveWithObject: true });
    return data;
}

const BANNERS = [
    { codigo: "101098", titulo: "Todo para instalaciones electricas", subtitulo: "Cable, conectores y mas", textoBoton: "Ver electrico", enlace: "/market/buscar?categoria=Electrico", temaColor: "naranja", orden: 1 },
    { codigo: "100435", titulo: "Herramientas para cada proyecto", subtitulo: "Encuentra lo que necesitas", textoBoton: "Ver herramientas", enlace: "/market/buscar?categoria=Herramientas", temaColor: "rojo", orden: 2 },
    { codigo: "100388", titulo: "Soluciones de plomeria", subtitulo: "Bombas, tuberia y accesorios", textoBoton: "Ver plomeria", enlace: "/market/buscar?categoria=Plomeria", temaColor: "morado", orden: 3 },
    { codigo: "100850", titulo: "Equipo de seguridad", subtitulo: "Protege tu trabajo", textoBoton: "Ver seguridad", enlace: "/market/buscar?categoria=Seguridad", temaColor: "negro", orden: 4 },
    { codigo: "10037", titulo: "Organiza tu taller", subtitulo: "Charolas, cajas y mas", textoBoton: "Ver organizacion", enlace: "/market/buscar?categoria=Organizacion", temaColor: "verde", orden: 5 },
    { codigo: "101102", titulo: "Equipo para construccion", subtitulo: "Bombas y maquinaria", textoBoton: "Ver construccion", enlace: "/market/buscar?categoria=Construccion", temaColor: "azul", orden: 6 },
];

(async () => {
    try {
        for (const banner of BANNERS) {
            const foto = await pool.query(
                `SELECT imagen_principal FROM public.banco_imagenes_producto WHERE codigo = $1`,
                [banner.codigo]
            );
            if (!foto.rows[0]?.imagen_principal) {
                console.log(`SIN IMAGEN: ${banner.codigo} -- se omite`);
                continue;
            }
            const imagenProcesada = await procesarImagenBanner(foto.rows[0].imagen_principal);
            const resultado = await pool.query(
                `INSERT INTO public.banners_market (titulo, subtitulo, texto_boton, enlace, tema_color, imagen, activo, orden, actualizado_at)
                 VALUES ($1, $2, $3, $4, $5, $6, true, $7, NOW()) RETURNING id`,
                [banner.titulo, banner.subtitulo, banner.textoBoton, banner.enlace, banner.temaColor, imagenProcesada, banner.orden]
            );
            console.log(`OK id=${resultado.rows[0].id} -- ${banner.titulo} (${banner.temaColor}, foto ${banner.codigo})`);
        }
        console.log("Listo.");
    } finally {
        await pool.end();
    }
})().catch(error => {
    console.error("FALLO:", error);
    process.exit(1);
});
