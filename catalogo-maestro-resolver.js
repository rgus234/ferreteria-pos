const { eanValido } = require("./catalogo-maestro-reconciliacion");

// Registra un identificador adicional (tipo, valor) para un producto
// maestro ya resuelto -- codigo_fabricante/Alterno, EAN, etc. -- sin
// nunca reasignar en silencio uno que ya pertenece a OTRO producto
// (catalogo_maestro_identificadores tiene un UNIQUE(tipo,valor) para
// esto). Idempotente: si el identificador ya apunta a este mismo
// producto, no hace nada. Nunca decide QUE hacer ante un conflicto --
// solo lo detecta y lo regresa ({ok:false, otroProductoMaestroId}) para
// que quien llama decida: la importacion masiva (contribuirOEnlazar
// CatalogoMaestro, mas abajo) marca el producto para revision humana;
// la confirmacion interactiva de un EAN escaneado (confirmarEanCatalogo
// Maestro) prefiere avisar de una vez y no tocar nada, sin marcar el
// producto que el dueño ya tiene abierto en pantalla.
async function registrarIdentificadorMaestro(pool, productoMaestroId, tipo, valor, fuente) {
    const limpio = String(valor || "").trim();
    if (!limpio) return { ok: true };

    const existente = await pool.query(
        `SELECT producto_maestro_id FROM public.catalogo_maestro_identificadores WHERE tipo = $1 AND valor = $2`,
        [tipo, limpio]
    );

    if (existente.rows.length > 0) {
        if (existente.rows[0].producto_maestro_id === productoMaestroId) return { ok: true };
        return { ok: false, otroProductoMaestroId: existente.rows[0].producto_maestro_id };
    }

    await pool.query(
        `
        INSERT INTO public.catalogo_maestro_identificadores (producto_maestro_id, tipo, valor, fuente, fuente_fecha)
        VALUES ($1, $2, $3, $4, NOW())
        ON CONFLICT (tipo, valor) DO NOTHING
        `,
        [productoMaestroId, tipo, limpio, String(fuente || "").trim()]
    );
    return { ok: true };
}

// Marca un producto maestro para revision humana porque un identificador
// que se le queria asignar ya pertenece a OTRO producto (nunca se
// reasigna solo -- "nunca hacer matching por parecido, marcar
// conflicto", Fase 1 de identidad multi-proveedor).
async function marcarConflictoIdentificador(pool, productoMaestroId, tipo, valor, otroProductoMaestroId) {
    await pool.query(
        `
        UPDATE public.catalogo_maestro_productos
        SET necesita_revision = true, revision_motivo = $2
        WHERE id = $1 AND NOT necesita_revision
        `,
        [
            productoMaestroId,
            `El identificador ${tipo}="${valor}" ya esta asignado al producto maestro ${otroProductoMaestroId}`
        ]
    );
}

// Fase 9 de identidad multi-proveedor: prioridad de fuentes de imagen.
// "fabricante_oficial" (fotos que el propio fabricante publica,
// banco-fotos-fabricante.js) siempre le gana a una imagen recortada de
// un catalogo de distribuidor en PDF; "catalogo_proveedor" (lo unico que
// escribia imagen antes de esta fase) le gana a una simple foto que un
// negocio subio de su telefono ("negocio"), que en calidad/consistencia
// suele ser la mas variable. Nunca al reves -- una imagen nunca se
// reemplaza por una de fuente igual o peor, y nunca se pisa una imagen
// ya buena solo porque llego una nueva.
const PRIORIDAD_FUENTE_IMAGEN = { fabricante_oficial: 3, catalogo_proveedor: 2, negocio: 1 };

function debeReemplazarImagen(fuenteActual, tieneImagenActual, fuenteNueva) {
    if (!tieneImagenActual) return true;
    if (!fuenteNueva) return false;
    const actual = PRIORIDAD_FUENTE_IMAGEN[fuenteActual] ?? 0;
    const nueva = PRIORIDAD_FUENTE_IMAGEN[fuenteNueva] ?? 0;
    return nueva > actual;
}

// Fase 7 del plan "Catalogo Maestro Nexo". Se llama en el momento en
// que un negocio confirma un producto desde su catalogo de proveedor
// (crear-producto / crear-productos-lote) -- ese "confirmar" ya es la
// accion afirmativa del dueño de traer el producto a su inventario;
// la informacion que se comparte aqui es solo identidad de producto
// (marca, nombre, presentacion, imagen, categoria sugerida), nunca
// datos de negocio (precio, costo, stock, proveedor real). Si el
// codigo ya existe en el Catalogo Maestro (otro negocio ya lo trajo
// antes), el producto nuevo simplemente se ENLAZA -- nunca pisa la
// info ya guardada, evita que un dato peor sobreescriba uno bueno.
//
// Fase 1 de identidad multi-proveedor (auditoria GAFI): un distribuidor
// como GAFI usa su PROPIO codigo interno (aqui "codigo", igual que
// siempre) para identificar un producto cuyo fabricante lo identifica
// con OTRO codigo distinto ("Alterno" en el catalogo real de GAFI --
// datos.codigoFabricante). Antes de esta fase ese segundo codigo se
// perdia por completo: ni se guardaba en catalogo_maestro_productos ni
// quedaba buscable. Ahora, ademas de crear/enlazar por "codigo" como
// siempre, se registra cada identificador confiable que venga
// (codigo, codigo de fabricante, EAN valido) en
// catalogo_maestro_identificadores -- la misma tabla que ya usa
// identidadPorCodigo() para resolver un escaneo -- para que cualquiera
// de ellos encuentre el mismo producto. El EAN nunca se acepta sin
// pasar su digito verificador (eanValido): nunca se inventa ni se
// asume que un numero cualquiera es un codigo de barras real.
async function contribuirOEnlazarCatalogoMaestro(pool, negocioId, datos) {
    const codigo = String(datos?.codigo || "").trim();
    if (!codigo) return null;

    const eanConfiable = eanValido(datos?.ean) ? String(datos.ean).trim() : "";
    // Por default toda imagen que llega por este camino viene de un
    // catalogo de proveedor (CSV/PDF) -- es el unico origen que existia
    // antes de la Fase 9. Un llamador puede declarar otra fuente
    // (ej. "fabricante_oficial") si de verdad viene de ahi.
    const imagenFuente = datos?.imagen ? String(datos?.imagenFuente || "catalogo_proveedor").trim() : "";

    const existente = await pool.query(
        `SELECT id, (imagen IS NOT NULL) AS tiene_imagen, imagen_fuente FROM public.catalogo_maestro_productos WHERE codigo = $1`,
        [codigo]
    );

    let productoMaestroId = existente.rows[0]?.id || null;

    if (!productoMaestroId) {
        const nombre = String(datos?.nombre || "").trim();
        if (!nombre) return null;

        const nuevo = await pool.query(
            `
            INSERT INTO public.catalogo_maestro_productos
                (codigo, marca, nombre, presentacion, categoria_nexo_id, descripcion, imagen, imagen_tipo, contribuido_por_negocio_id, codigo_fabricante, ean, imagen_fuente, imagen_confianza, imagen_actualizada_en)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,CASE WHEN $7::bytea IS NOT NULL THEN NOW() ELSE NULL END)
            ON CONFLICT (codigo) DO NOTHING
            RETURNING id
            `,
            [
                codigo,
                String(datos?.marca || "").trim(),
                nombre,
                String(datos?.presentacion || "").trim(),
                datos?.categoriaNexoId || null,
                String(datos?.descripcion || "").trim(),
                datos?.imagen || null,
                datos?.imagenTipo || null,
                negocioId,
                String(datos?.codigoFabricante || "").trim(),
                eanConfiable,
                imagenFuente,
                datos?.imagenConfianza ?? null
            ]
        );

        if (nuevo.rows.length > 0) {
            productoMaestroId = nuevo.rows[0].id;
        } else {
            // Carrera: otro negocio lo inserto entre el SELECT y el
            // INSERT de arriba -- el ON CONFLICT DO NOTHING no regresa
            // fila, se busca otra vez para enlazar al que ya quedo.
            const reintento = await pool.query(
                `SELECT id, (imagen IS NOT NULL) AS tiene_imagen, imagen_fuente FROM public.catalogo_maestro_productos WHERE codigo = $1`,
                [codigo]
            );
            productoMaestroId = reintento.rows[0]?.id || null;
        }
    } else if (datos?.imagen && debeReemplazarImagen(existente.rows[0].imagen_fuente, existente.rows[0].tiene_imagen, imagenFuente)) {
        // Fase 9: antes de esta fase, enlazar a un producto YA existente
        // nunca volvia a tocar su imagen, ni para llenarla si estaba
        // vacia ni para mejorarla si una fuente de mas confianza traia
        // una nueva. Nunca reemplaza una imagen de fuente igual o mejor.
        await pool.query(
            `UPDATE public.catalogo_maestro_productos
             SET imagen = $1, imagen_tipo = $2, imagen_fuente = $3, imagen_confianza = $4, imagen_actualizada_en = NOW()
             WHERE id = $5`,
            [datos.imagen, datos.imagenTipo || null, imagenFuente, datos?.imagenConfianza ?? null, productoMaestroId]
        );
    }

    if (!productoMaestroId) return null;

    // No bloquea la identidad principal (ya resuelta arriba) si algo
    // falla registrando un identificador adicional.
    try {
        // "proveedor": el codigo propio del DISTRIBUIDOR (columna "Corto"
        // en el catalogo real de GAFI) -- catalogo_maestro_identificadores
        // ya reserva este tipo para exactamente esto (junto con "ean",
        // "fabricante" y "clave"; ver el CHECK de esa tabla), solo que
        // nadie lo usaba todavia.
        const rProveedor = await registrarIdentificadorMaestro(pool, productoMaestroId, "proveedor", codigo, datos?.fuente);
        if (!rProveedor.ok) await marcarConflictoIdentificador(pool, productoMaestroId, "proveedor", codigo, rProveedor.otroProductoMaestroId);

        if (datos?.codigoFabricante) {
            const rFabricante = await registrarIdentificadorMaestro(pool, productoMaestroId, "fabricante", datos.codigoFabricante, datos?.fuente);
            if (!rFabricante.ok) await marcarConflictoIdentificador(pool, productoMaestroId, "fabricante", datos.codigoFabricante, rFabricante.otroProductoMaestroId);
        }
        if (eanConfiable) {
            const rEan = await registrarIdentificadorMaestro(pool, productoMaestroId, "ean", eanConfiable, datos?.fuente);
            if (!rEan.ok) await marcarConflictoIdentificador(pool, productoMaestroId, "ean", eanConfiable, rEan.otroProductoMaestroId);
        }
    } catch (errorIdentificador) {
        console.error("No se pudo registrar identificador adicional en el Catalogo Maestro", errorIdentificador);
    }

    return productoMaestroId;
}

// Fase 3 de identidad multi-proveedor: "aprender EAN por escaneo".
//
// Un producto GAFI (o de cualquier proveedor sin EAN propio) ya puede
// quedar identificado por su codigo de distribuidor o el de fabricante
// (Fase 1). Pero el paquete FISICO casi siempre trae ademas un codigo de
// barras real que GAFI nunca reporto. La primera vez que alguien lo
// escanea sobre un producto YA identificado (catalogoMaestroId conocido:
// vino de un match de catalogo, o de un escaneo anterior), se puede
// confirmar y registrar -- desde ese momento cualquier negocio que
// escanee el mismo codigo de barras encuentra el mismo producto.
//
// Nunca se acepta sin pasar el digito verificador (eanValido): un
// numero cualquiera nunca se guarda como si fuera un codigo de barras
// real. Nunca se reasigna un EAN que ya pertenece a OTRO producto --
// eso se regresa como conflicto para que quien llama decida (avisar al
// dueño, nunca marcar en silencio el producto que tiene abierto).
async function confirmarEanCatalogoMaestro(pool, productoMaestroId, ean, fuente) {
    if (!Number.isInteger(Number(productoMaestroId)) || Number(productoMaestroId) <= 0) {
        return { ok: false, motivo: "sin_producto" };
    }
    if (!eanValido(ean)) {
        return { ok: false, motivo: "ean_invalido" };
    }

    const limpio = String(ean).trim();
    const resultado = await registrarIdentificadorMaestro(pool, Number(productoMaestroId), "ean", limpio, fuente);
    if (!resultado.ok) {
        return { ok: false, motivo: "conflicto", otroProductoMaestroId: resultado.otroProductoMaestroId };
    }

    // Deja la columna directa consistente para lecturas que no pasan por
    // la tabla de identificadores -- nunca pisa un EAN ya guardado por
    // otro medio.
    await pool.query(
        `UPDATE public.catalogo_maestro_productos SET ean = $1 WHERE id = $2 AND (ean IS NULL OR ean = '')`,
        [limpio, Number(productoMaestroId)]
    );

    return { ok: true };
}

module.exports = { contribuirOEnlazarCatalogoMaestro, registrarIdentificadorMaestro, confirmarEanCatalogoMaestro };
