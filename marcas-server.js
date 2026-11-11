// Directorio de marcas de abarrotes para las pantallas (Recibir mercancia, pedidos...): la lista de marcas y la imagen de cada tarjeta.
//   GET /marcas-directorio              lista de marcas {id, nombre, tipo, color, empresa}
//   GET /marcas-directorio/:id/imagen   imagen de la tarjeta: el logo de la marca o, si no tiene, la foto de un producto suyo del Banco de Nexo
// La imagen no es privada (es una sola foto representativa por marca) y se guarda un dia en el navegador.
const fs = require("fs");
const path = require("path");
const sharp = require("sharp");
const { MARCAS, fotoDeMarcaDesdeBanco } = require("./marcas-catalogo");

const TAMANO = 280;
const cache = new Map();

async function imagenDeMarca(pool, marca) {
    if (cache.has(marca.id)) return cache.get(marca.id);

    let buffer = null;

    try {
        const logo = path.join(__dirname, "public", "marcas", `${marca.id}.jpg`);

        if (fs.existsSync(logo)) {
            buffer = await sharp(logo).resize(TAMANO, TAMANO, { fit: "contain", background: "#ffffff" }).jpeg({ quality: 85 }).toBuffer();
        } else {
            const datos = await fotoDeMarcaDesdeBanco(pool, marca);

            if (datos) {
                const original = Buffer.from(datos.split(",")[1], "base64");
                buffer = await sharp(original).flatten({ background: "#ffffff" }).resize(TAMANO, TAMANO, { fit: "contain", background: "#ffffff" }).jpeg({ quality: 85 }).toBuffer();
            }
        }
    } catch (error) {
        buffer = null;
    }

    cache.set(marca.id, buffer);
    return buffer;
}

module.exports = (app, pool, requerirAccesoNegocio) => {
    app.get("/marcas-directorio", requerirAccesoNegocio, (req, res) => {
        res.json({ ok: true, marcas: MARCAS.map(m => ({ id: m.id, nombre: m.nombre, tipo: m.tipo, color: m.color, empresa: m.empresa, palabras: m.palabras })) });
    });

    app.get("/marcas-directorio/:id/imagen", async (req, res) => {
        const marca = MARCAS.find(m => m.id === String(req.params.id));

        if (!marca) { res.status(404).end(); return; }

        const buffer = await imagenDeMarca(pool, marca);

        if (!buffer) { res.status(404).end(); return; }

        res.set({ "Content-Type": "image/jpeg", "Cache-Control": "public, max-age=86400" });
        res.send(buffer);
    });
};
