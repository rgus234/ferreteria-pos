// Galeria completa (no solo la foto principal) de un producto por su
// codigo, usando el Banco de Nexo curado y, si no hay, las fotos que
// el propio fabricante (Truper) ya publica -- ver banco-fotos-fabricante.js.
//
// Mismo criterio que resolverFotoPrincipal (explorar-nexo-server.js):
// esto es solo MOSTRAR fotos que ya existen (no la funcion de curar el
// banco), asi que a proposito NO tiene el candado de plan Pro que si
// aplica /banco-imagenes/:codigo/galeria (esa es para elegir/administrar
// el banco, un uso distinto). Lo usan las pantallas internas del POS
// que necesitan mas de una foto: Ver detalles, Recepcion Inteligente y
// Pantalla del cliente.
async function galeriaBancoOFabricante(pool, codigoCrudo) {
    const { normalizarCodigoFoto, firmarTokenBancoImagen } = require("./banco-imagenes-server");
    const { fotosDeProducto } = require("./banco-fotos-fabricante");

    const codigo = normalizarCodigoFoto(codigoCrudo);
    if (!codigo) return [];

    try {
        const banco = await pool.query(
            `SELECT id, actualizado_at FROM public.banco_imagenes_producto WHERE codigo = $1`,
            [codigo]
        );
        const filaBanco = banco.rows[0];

        if (!filaBanco) {
            const delFabricante = await fotosDeProducto(pool, codigo);
            return delFabricante.fotos.map(foto => foto.url);
        }

        const version = new Date(filaBanco.actualizado_at).getTime();
        const principal = `/banco-imagenes/${encodeURIComponent(codigo)}/principal?v=${version}&token=${firmarTokenBancoImagen(codigo)}`;

        const galeria = await pool.query(
            `SELECT id FROM public.banco_imagenes_producto_galeria WHERE banco_imagen_id = $1 ORDER BY orden ASC`,
            [filaBanco.id]
        );

        let extras = galeria.rows.map(fila =>
            `/banco-imagenes-galeria/${fila.id}?token=${firmarTokenBancoImagen(String(fila.id))}`
        );

        // Sin galeria guardada en el banco: se completa con las fotos
        // adicionales del fabricante (la primera de esas es la misma
        // que la principal ya resuelta arriba -- se descarta para no
        // repetirla).
        if (extras.length === 0) {
            const delFabricante = await fotosDeProducto(pool, codigo);
            extras = delFabricante.fotos.slice(1).map(foto => foto.url);
        }

        return [principal, ...extras];
    } catch (error) {
        // Una galeria que no se pudo resolver nunca debe tumbar la
        // pantalla que la pidio -- se queda sin fotos extra, no es un error.
        return [];
    }
}

module.exports = { galeriaBancoOFabricante };
