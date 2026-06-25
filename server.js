const express = require("express");
const path = require("path");
const { config, validarConfigProduccion } = require("./config");
const pool = require("./db");
const {
    DEFAULT_NEGOCIO_SLUG,
    DEFAULT_NEGOCIO_NOMBRE,
    asegurarNegocioActual
} = require("./tenant");

validarConfigProduccion();

const app = express();

const PORT = config.port;

app.use(express.json());
app.use((req, res, next) => {
    res.set("Cache-Control", "no-store");
    next();
});
app.use(express.static(path.join(__dirname, "public")));

app.get("/health", async (req, res) => {
    try {
        await pool.query("SELECT 1");

        res.json({
            ok: true,
            app: config.appName,
            env: config.appEnv,
            version: config.appVersion,
            database: "connected",
            timestamp: new Date().toISOString(),
        });
    } catch (error) {
        res.status(503).json({
            ok: false,
            app: config.appName,
            env: config.appEnv,
            version: config.appVersion,
            database: "error",
            error: error.message,
            timestamp: new Date().toISOString(),
        });
    }
});

app.get("/version", (req, res) => {
    res.json({
        app: config.appName,
        env: config.appEnv,
        version: config.appVersion,
    });
});

function normalizarCodigo(codigo) {
    return String(codigo || "")
        .replace(/[^a-zA-Z0-9]/g, "")
        .trim();
}

async function negocioActual(req) {
    return asegurarNegocioActual(pool, req);
}

app.get("/", (req, res) => {
    res.sendFile(
        path.join(__dirname, "public", "index.html")
    );
});

app.get("/dueno", (req, res) => {
    res.sendFile(
        path.join(__dirname, "public", "dueno.html")
    );
});

app.get("/productos", async (req, res) => {
    try {
        const negocio = await negocioActual(req);
        const resultado =
        await pool.query(
            `
            SELECT
                p.*,
                COALESCE(
                    json_agg(
                        json_build_object(
                            'codigo', pc.codigo,
                            'tipo', pc.tipo,
                            'proveedor', pc.proveedor
                        )
                    ) FILTER (WHERE pc.id IS NOT NULL),
                    '[]'::json
                ) AS codigos_relacionados
            FROM public.productos p
            LEFT JOIN public.producto_codigos pc
                ON pc.producto_id = p.id
                AND pc.negocio_id = p.negocio_id
            WHERE p.negocio_id = $1
            GROUP BY p.id
            ORDER BY p.nombre ASC
            `,
            [negocio.id]
        );

        res.json(resultado.rows);

    } catch (error) {
        console.log(error);

        res.status(500).json({
            error: error.message,
            detail: error.detail || null,
            code: error.code || null
        });
    }
});

app.get("/producto-codigo/:codigo", async (req, res) => {

    const codigo = normalizarCodigo(req.params.codigo);

    try {
        const negocio = await negocioActual(req);

        const resultado =
        await pool.query(
            `
            SELECT DISTINCT ON (p.id)
                p.*
            FROM public.productos p
            LEFT JOIN public.producto_codigos pc
                ON pc.producto_id = p.id
                AND pc.negocio_id = p.negocio_id
            WHERE
                p.negocio_id = $2
                AND (
                    LOWER(regexp_replace(COALESCE(p.codigo, ''), '[^a-zA-Z0-9]', '', 'g')) = LOWER($1)
                    OR LOWER(regexp_replace(COALESCE(pc.codigo, ''), '[^a-zA-Z0-9]', '', 'g')) = LOWER($1)
                )
            ORDER BY p.id
            LIMIT 1
            `,
            [codigo, negocio.id]
        );

        res.json(
            resultado.rows[0] || null
        );

    } catch (error) {

        console.log(error);

        res.status(500).json({
            error: "Error código"
        });
    }
});

app.post("/agregar-producto", async (req, res) => {

   const {
    nombre,
    precio,
    stock,
    codigo,
    proveedor,
    ubicacion,
    categoria,
    subcategoria,
    marca,
    descripcion,
    unidadVenta,
    precioDistribuidor,
    precioMayoreo,
    precioPublico,
    stockMinimo,
    altaRotacion,
    tipoProducto,
    presentacionCompra,
    factorConversion,
    basculaDigital,
    codigosRelacionados
} = req.body;
    try {
        const negocio = await negocioActual(req);

        const resultado = await pool.query(
`
INSERT INTO public.productos
(
  negocio_id,
  nombre,
  precio,
  stock,
  codigo,
  proveedor,
  ubicacion,
  categoria,
  subcategoria,
  marca,
  descripcion,
  unidad_venta,
  precio_distribuidor,
  precio_mayoreo,
  precio_publico,
  stock_minimo,
  alta_rotacion,
  tipo_producto,
  presentacion_compra,
  factor_conversion,
  bascula_digital
)
VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)
RETURNING id
`,
[
  negocio.id,
  nombre,
  precio,
  stock,
  normalizarCodigo(codigo) || codigo || "",
  proveedor || "",
  ubicacion || "",
  categoria || "",
  subcategoria || "",
  marca || "",
  descripcion || "",
  unidadVenta || "pieza",
  precioDistribuidor || null,
  precioMayoreo || null,
  precioPublico || precio || null,
  stockMinimo || 3,
  altaRotacion || "",
  tipoProducto || "catalogo",
  presentacionCompra || "",
  factorConversion || null,
  basculaDigital || "no"
]
);

        const productoId = resultado.rows[0].id;
        await guardarCodigosProducto(productoId, {
            codigo,
            proveedor,
            codigosRelacionados
        }, negocio.id);

        res.json({
            success: true
        });

    } catch (error) {

        console.log(error);

        res.status(500).json({
            error: "Error agregar"
        });
    }
});

app.put("/editar-producto/:id", async (req, res) => {

    const { id } = req.params;

    const {
        nombre,
        precio,
        stock,
        codigo,
        proveedor,
        ubicacion,
        categoria,
        subcategoria,
        marca,
        descripcion,
        unidadVenta,
        precioDistribuidor,
        precioMayoreo,
        precioPublico,
        stockMinimo,
        altaRotacion,
        tipoProducto,
        presentacionCompra,
        factorConversion,
        basculaDigital,
        codigosRelacionados
    } = req.body;

    try {
        const negocio = await negocioActual(req);

        await pool.query(
            `
            UPDATE public.productos
            SET
                nombre = $1,
                precio = $2,
                stock = $3,
                codigo = $4,
                proveedor = $5,
                ubicacion = $6,
                categoria = $7,
                subcategoria = $8,
                marca = $9,
                descripcion = $10,
                unidad_venta = $11,
                precio_distribuidor = $12,
                precio_mayoreo = $13,
                precio_publico = $14,
                stock_minimo = $15,
                alta_rotacion = $16,
                tipo_producto = $17,
                presentacion_compra = $18,
                factor_conversion = $19,
                bascula_digital = $20
            WHERE id = $21
            AND negocio_id = $22
            `,
            [
                nombre,
                precio,
                stock,
                normalizarCodigo(codigo) || codigo || "",
                proveedor || "",
                ubicacion || "",
                categoria || "",
                subcategoria || "",
                marca || "",
                descripcion || "",
                unidadVenta || "pieza",
                precioDistribuidor || null,
                precioMayoreo || null,
                precioPublico || precio || null,
                stockMinimo || 3,
                altaRotacion || "",
                tipoProducto || "catalogo",
                presentacionCompra || "",
                factorConversion || null,
                basculaDigital || "no",
                id,
                negocio.id
            ]
        );

        await guardarCodigosProducto(id, {
            codigo,
            proveedor,
            codigosRelacionados
        }, negocio.id);

        res.json({
            success: true
        });

    } catch (error) {

        res.status(500).json({
            error: "Error editar"
        });
    }
});

app.delete("/eliminar-producto/:id", async (req, res) => {

    const { id } = req.params;

    try {
        const negocio = await negocioActual(req);

        await pool.query(
            `
            DELETE FROM public.productos
            WHERE id = $1
            AND negocio_id = $2
            `,
            [id, negocio.id]
        );

        res.json({
            success: true
        });

    } catch (error) {

        res.status(500).json({
            error: "Error eliminar"
        });
    }
});

async function guardarCodigosProducto(productoId, datos, negocioId) {
    const codigos =
        new Map();

    const agregarCodigo = (codigo, tipo = "barra", proveedor = "") => {
        const limpio =
            normalizarCodigo(codigo);

        if (!limpio) return;

        const llave =
            `${limpio}-${tipo}-${proveedor || ""}`.toLowerCase();

        codigos.set(llave, {
            codigo: limpio,
            tipo,
            proveedor: proveedor || ""
        });
    };

    agregarCodigo(datos.codigo, "barra", datos.proveedor);

    if (Array.isArray(datos.codigosRelacionados)) {
        for (const item of datos.codigosRelacionados) {
            if (typeof item === "string") {
                agregarCodigo(item, "alterno", datos.proveedor);
            } else {
                agregarCodigo(
                    item.codigo,
                    item.tipo || "alterno",
                    item.proveedor || datos.proveedor
                );
            }
        }
    } else if (typeof datos.codigosRelacionados === "string") {
        datos.codigosRelacionados
            .split(/[\n,; ]+/)
            .forEach(codigo =>
                agregarCodigo(codigo, "alterno", datos.proveedor)
            );
    }

    await pool.query(
        `
        DELETE FROM public.producto_codigos
        WHERE producto_id = $1
        AND negocio_id = $2
        `,
        [productoId, negocioId]
    );

    for (const item of codigos.values()) {
        await pool.query(
            `
            INSERT INTO public.producto_codigos
            (
                negocio_id,
                producto_id,
                codigo,
                tipo,
                proveedor
            )
            VALUES ($1, $2, $3, $4, $5)
            ON CONFLICT DO NOTHING
            `,
            [
                negocioId,
                productoId,
                item.codigo,
                item.tipo,
                item.proveedor
            ]
        );
    }
}

app.post("/login", async (req, res) => {

    const {
        usuario,
        password
    } = req.body;

    try {
        const negocio = await negocioActual(req);

        const resultado =
        await pool.query(
            `
            SELECT *
            FROM public.usuarios
            WHERE usuario = $1
            AND password = $2
            AND negocio_id = $3
            `,
            [usuario, password, negocio.id]
        );

        res.json({
            success:
            resultado.rows.length > 0
        });

    } catch (error) {

        res.status(500).json({
            error: "Error login"
        });
    }
});

app.post("/ventas", async (req, res) => {

    const {
        total,
        productos,
        metodoPago,
        pagos,
        recibido,
        cambio
    } = req.body;
    const pagosVenta = pagos || {};
    const pagoEfectivo = Number(pagosVenta.efectivo || 0);
    const pagoTarjeta = Number(pagosVenta.tarjeta || 0);
    const pagoTransferencia = Number(pagosVenta.transferencia || 0);
    const pagoCredito = Number(pagosVenta.credito || 0);

    try {
        const negocio = await negocioActual(req);

        await pool.query(`
            ALTER TABLE public.historial_ventas
            ADD COLUMN IF NOT EXISTS metodo_pago TEXT NOT NULL DEFAULT 'efectivo'
        `);
        await pool.query(`
            ALTER TABLE public.historial_ventas
            ADD COLUMN IF NOT EXISTS pago_efectivo NUMERIC(12,2) NOT NULL DEFAULT 0
        `);
        await pool.query(`
            ALTER TABLE public.historial_ventas
            ADD COLUMN IF NOT EXISTS pago_tarjeta NUMERIC(12,2) NOT NULL DEFAULT 0
        `);
        await pool.query(`
            ALTER TABLE public.historial_ventas
            ADD COLUMN IF NOT EXISTS pago_transferencia NUMERIC(12,2) NOT NULL DEFAULT 0
        `);
        await pool.query(`
            ALTER TABLE public.historial_ventas
            ADD COLUMN IF NOT EXISTS pago_credito NUMERIC(12,2) NOT NULL DEFAULT 0
        `);
        await pool.query(`
            ALTER TABLE public.historial_ventas
            ADD COLUMN IF NOT EXISTS pago_recibido NUMERIC(12,2) NOT NULL DEFAULT 0
        `);
        await pool.query(`
            ALTER TABLE public.historial_ventas
            ADD COLUMN IF NOT EXISTS cambio NUMERIC(12,2) NOT NULL DEFAULT 0
        `);
        await pool.query(`
            ALTER TABLE public.historial_ventas
            ADD COLUMN IF NOT EXISTS pagos_json JSONB NOT NULL DEFAULT '{}'::jsonb
        `);
        await pool.query(
            `
            INSERT INTO public.ventas(negocio_id, total)
            VALUES($1, $2)
            `,
            [negocio.id, total]
        );

        await pool.query(
            `
            INSERT INTO public.historial_ventas
                (negocio_id, total, metodo_pago, pago_efectivo, pago_tarjeta, pago_transferencia, pago_credito, pago_recibido, cambio, pagos_json)
            VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb)
            `,
            [negocio.id, total, metodoPago || "efectivo", pagoEfectivo, pagoTarjeta, pagoTransferencia, pagoCredito, Number(recibido || 0), Number(cambio || 0), JSON.stringify(pagosVenta)]
        );

        for (const producto of productos) {
            const cantidad =
                Number(producto.cantidad || 1);

            await pool.query(
                `
                UPDATE public.productos
                SET stock = stock - $1
                WHERE id = $2
                AND negocio_id = $3
                `,
                [cantidad, producto.id, negocio.id]
            );
        }

        res.json({
            success: true
        });

    } catch (error) {

        console.log("ERROR EN /ventas:", error);

        res.status(500).json({
            error: error.message,
            detail: error.detail || null,
            code: error.code || null
        });
    }
});

app.get("/creditos", async (req, res) => {
    try {
        const negocio = await negocioActual(req);
        const clientes = await pool.query(`
            SELECT
                c.id,
                c.nombre,
                c.telefono,
                c.limite_credito,
                c.created_at,
                COALESCE(
                    SUM(
                        CASE
                            WHEN m.tipo = 'venta' THEN m.monto
                            WHEN m.tipo = 'abono' THEN -m.monto
                            ELSE 0
                        END
                    ),
                    0
                ) AS saldo
            FROM public.clientes_credito c
            LEFT JOIN public.movimientos_credito m
                ON m.cliente_id = c.id
                AND m.negocio_id = c.negocio_id
            WHERE c.activo = true
            AND c.negocio_id = $1
            GROUP BY c.id
            ORDER BY saldo DESC, c.nombre ASC
        `, [negocio.id]);

        const total = clientes.rows.reduce(
            (suma, cliente) =>
                suma + Number(cliente.saldo),
            0
        );

        res.json({
            clientes: clientes.rows,
            total,
            clientesConAdeudo:
                clientes.rows.filter(
                    cliente => Number(cliente.saldo) > 0
                ).length
        });
    } catch (error) {
        console.log("ERROR EN /creditos:", error);

        res.status(500).json({
            error: error.message,
            detail: error.detail || null,
            code: error.code || null
        });
    }
});

app.get("/creditos/clientes/:id", async (req, res) => {
    const { id } = req.params;

    try {
        const negocio = await negocioActual(req);
        const cliente = await pool.query(`
            SELECT
                c.*,
                COALESCE(
                    SUM(
                        CASE
                            WHEN m.tipo = 'venta' THEN m.monto
                            WHEN m.tipo = 'abono' THEN -m.monto
                            ELSE 0
                        END
                    ),
                    0
                ) AS saldo
            FROM public.clientes_credito c
            LEFT JOIN public.movimientos_credito m
                ON m.cliente_id = c.id
                AND m.negocio_id = c.negocio_id
            WHERE c.id = $1
            AND c.negocio_id = $2
            GROUP BY c.id
        `, [id, negocio.id]);

        if (cliente.rows.length === 0) {
            res.status(404).json({
                error: "Cliente no encontrado"
            });
            return;
        }

        const movimientos = await pool.query(`
            SELECT *
            FROM public.movimientos_credito
            WHERE cliente_id = $1
            AND negocio_id = $2
            ORDER BY fecha ASC, id ASC
        `, [id, negocio.id]);

        res.json({
            cliente: cliente.rows[0],
            movimientos: movimientos.rows
        });
    } catch (error) {
        res.status(500).json({
            error: error.message
        });
    }
});

app.post("/creditos/clientes", async (req, res) => {
    const {
        nombre,
        telefono,
        limiteCredito
    } = req.body;

    if (!nombre) {
        res.status(400).json({
            error: "Nombre requerido"
        });
        return;
    }

    try {
        const negocio = await negocioActual(req);
        const resultado = await pool.query(`
            INSERT INTO public.clientes_credito
            (
                negocio_id,
                nombre,
                telefono,
                limite_credito
            )
            VALUES ($1, $2, $3, $4)
            RETURNING *
        `, [
            negocio.id,
            nombre,
            telefono || null,
            limiteCredito || 0
        ]);

        res.json({
            success: true,
            cliente: resultado.rows[0]
        });
    } catch (error) {
        res.status(500).json({
            error: error.message
        });
    }
});

app.put("/creditos/clientes/:id", async (req, res) => {
    const { id } = req.params;

    const {
        nombre,
        telefono,
        limiteCredito
    } = req.body;

    if (!nombre) {
        res.status(400).json({
            error: "El nombre es obligatorio"
        });
        return;
    }

    try {
        const negocio = await negocioActual(req);
        const resultado = await pool.query(`
            UPDATE public.clientes_credito
            SET
                nombre = $1,
                telefono = $2,
                limite_credito = $3
            WHERE id = $4
            AND negocio_id = $5
            RETURNING *
        `, [
            nombre,
            telefono || "",
            Number(limiteCredito || 0),
            id,
            negocio.id
        ]);

        if (resultado.rows.length === 0) {
            res.status(404).json({
                error: "Cliente no encontrado"
            });
            return;
        }

        res.json({
            cliente: resultado.rows[0]
        });
    } catch (error) {
        res.status(500).json({
            error: error.message
        });
    }
});

app.delete("/creditos/clientes/:id", async (req, res) => {
    const { id } = req.params;

    try {
        const negocio = await negocioActual(req);
        const resultado = await pool.query(`
            UPDATE public.clientes_credito
            SET activo = false
            WHERE id = $1
            AND negocio_id = $2
            RETURNING id
        `, [id, negocio.id]);

        if (resultado.rows.length === 0) {
            res.status(404).json({
                error: "Cliente no encontrado"
            });
            return;
        }

        res.json({
            success: true
        });
    } catch (error) {
        res.status(500).json({
            error: error.message
        });
    }
});

app.get("/proveedores", async (req, res) => {
    try {
        const negocio = await negocioActual(req);
        const resultado = await pool.query(`
            SELECT
                pr.*,
                COUNT(p.id) AS productos
            FROM public.proveedores pr
            LEFT JOIN public.productos p
                ON LOWER(COALESCE(p.proveedor, '')) = LOWER(pr.nombre)
                AND p.negocio_id = pr.negocio_id
            WHERE pr.activo = true
            AND pr.negocio_id = $1
            GROUP BY pr.id
            ORDER BY pr.nombre ASC
        `, [negocio.id]);

        res.json({
            proveedores: resultado.rows
        });
    } catch (error) {
        res.status(500).json({
            error: error.message
        });
    }
});

app.post("/proveedores", async (req, res) => {
    const {
        nombre,
        contacto,
        telefono,
        correo,
        notas
    } = req.body;

    if (!nombre) {
        res.status(400).json({
            error: "El nombre es obligatorio"
        });
        return;
    }

    try {
        const negocio = await negocioActual(req);
        const resultado = await pool.query(`
            INSERT INTO public.proveedores
            (
                negocio_id,
                nombre,
                contacto,
                telefono,
                correo,
                notas
            )
            VALUES ($1, $2, $3, $4, $5, $6)
            RETURNING *
        `, [
            negocio.id,
            nombre,
            contacto || "",
            telefono || "",
            correo || "",
            notas || ""
        ]);

        res.json({
            proveedor: resultado.rows[0]
        });
    } catch (error) {
        res.status(500).json({
            error: error.message
        });
    }
});

app.put("/proveedores/:id", async (req, res) => {
    const { id } = req.params;

    const {
        nombre,
        contacto,
        telefono,
        correo,
        notas
    } = req.body;

    if (!nombre) {
        res.status(400).json({
            error: "El nombre es obligatorio"
        });
        return;
    }

    try {
        const negocio = await negocioActual(req);
        const resultado = await pool.query(`
            UPDATE public.proveedores
            SET
                nombre = $1,
                contacto = $2,
                telefono = $3,
                correo = $4,
                notas = $5
            WHERE id = $6
            AND negocio_id = $7
            RETURNING *
        `, [
            nombre,
            contacto || "",
            telefono || "",
            correo || "",
            notas || "",
            id,
            negocio.id
        ]);

        if (resultado.rows.length === 0) {
            res.status(404).json({
                error: "Proveedor no encontrado"
            });
            return;
        }

        res.json({
            proveedor: resultado.rows[0]
        });
    } catch (error) {
        res.status(500).json({
            error: error.message
        });
    }
});

app.delete("/proveedores/:id", async (req, res) => {
    const { id } = req.params;

    try {
        const negocio = await negocioActual(req);
        const resultado = await pool.query(`
            UPDATE public.proveedores
            SET activo = false
            WHERE id = $1
            AND negocio_id = $2
            RETURNING id
        `, [id, negocio.id]);

        if (resultado.rows.length === 0) {
            res.status(404).json({
                error: "Proveedor no encontrado"
            });
            return;
        }

        res.json({
            success: true
        });
    } catch (error) {
        res.status(500).json({
            error: error.message
        });
    }
});

app.post("/creditos/clientes/:id/abonos", async (req, res) => {
    const { id } = req.params;

    const {
        monto,
        concepto
    } = req.body;

    if (!monto || Number(monto) <= 0) {
        res.status(400).json({
            error: "Monto invalido"
        });
        return;
    }

    try {
        const negocio = await negocioActual(req);
        const resultado = await pool.query(`
            INSERT INTO public.movimientos_credito
            (
                negocio_id,
                cliente_id,
                tipo,
                referencia,
                concepto,
                monto
            )
            SELECT $1, c.id, 'abono', $2, $3, $4
            FROM public.clientes_credito c
            WHERE c.id = $5
            AND c.negocio_id = $1
            RETURNING *
        `, [
            negocio.id,
            `AB-${Date.now()}`,
            concepto || "Abono",
            monto,
            id
        ]);

        res.json({
            success: true,
            movimiento: resultado.rows[0]
        });
    } catch (error) {
        res.status(500).json({
            error: error.message
        });
    }
});

app.post("/creditos/clientes/:id/cargos", async (req, res) => {
    const { id } = req.params;

    const {
        monto,
        concepto,
        productos
    } = req.body;

    if (!monto || Number(monto) <= 0) {
        res.status(400).json({
            error: "Monto invalido"
        });
        return;
    }

    try {
        const negocio = await negocioActual(req);
        const resultado = await pool.query(`
            INSERT INTO public.movimientos_credito
            (
                negocio_id,
                cliente_id,
                tipo,
                referencia,
                concepto,
                monto,
                productos
            )
            SELECT $1, c.id, 'venta', $2, $3, $4, $5::jsonb
            FROM public.clientes_credito c
            WHERE c.id = $6
            AND c.negocio_id = $1
            RETURNING *
        `, [
            negocio.id,
            `CR-${Date.now()}`,
            concepto || "Venta a credito",
            monto,
            JSON.stringify(productos || []),
            id
        ]);

        if (Array.isArray(productos)) {
            for (const producto of productos) {
                const cantidad =
                    Number(producto.cantidad || 1);

                await pool.query(
                    `
                    UPDATE public.productos
                    SET stock = stock - $1
                    WHERE id = $2
                    AND negocio_id = $3
                    `,
                    [
                        cantidad,
                        producto.id,
                        negocio.id
                    ]
                );
            }
        }

        res.json({
            success: true,
            movimiento: resultado.rows[0]
        });
    } catch (error) {
        res.status(500).json({
            error: error.message
        });
    }
});

app.get("/dashboard", async (req, res) => {

    try {
        const negocio = await negocioActual(req);

        const totalVentas =
        await pool.query(`
            SELECT
            COALESCE(SUM(total),0)
            AS total
            FROM public.historial_ventas
            WHERE negocio_id = $1
        `, [negocio.id]);

        const cantidadVentas =
        await pool.query(`
            SELECT COUNT(*)
            AS cantidad
            FROM public.historial_ventas
            WHERE negocio_id = $1
        `, [negocio.id]);

        const productos =
        await pool.query(`
            SELECT COUNT(*)
            AS productos
            FROM public.productos
            WHERE negocio_id = $1
        `, [negocio.id]);

        res.json({
            totalVentas:
            totalVentas.rows[0].total,

            cantidadVentas:
            cantidadVentas.rows[0].cantidad,

            productos:
            productos.rows[0].productos
        });

    } catch (error) {

        res.status(500).json({
            error: "Error dashboard"
        });
    }
});

app.get("/historial", async (req, res) => {
    const negocio = await negocioActual(req);

    const historial =
    await pool.query(`
        SELECT *
        FROM public.historial_ventas
        WHERE negocio_id = $1
        ORDER BY fecha DESC
    `, [negocio.id]);

    res.json(historial.rows);
});

app.get("/grafica-ventas", async (req, res) => {
    const negocio = await negocioActual(req);

    const resultado =
    await pool.query(`
        SELECT
        TO_CHAR(fecha,'DD/MM') AS dia,
        total
        FROM public.historial_ventas
        WHERE negocio_id = $1
        ORDER BY fecha ASC
    `, [negocio.id]);

    res.json(resultado.rows);
});

app.get("/reportes/ventas", async (req, res) => {
    try {
        const negocio = await negocioActual(req);
        const resumen = await pool.query(`
            SELECT
                COALESCE(SUM(total), 0) AS total,
                COUNT(*) AS transacciones,
                COALESCE(AVG(total), 0) AS ticket_promedio,
                COALESCE(MAX(total), 0) AS venta_mayor
            FROM public.historial_ventas
            WHERE negocio_id = $1
        `, [negocio.id]);

        const porDia = await pool.query(`
            SELECT
                TO_CHAR(fecha, 'DD/MM') AS dia,
                COALESCE(SUM(total), 0) AS total,
                COUNT(*) AS transacciones
            FROM public.historial_ventas
            WHERE negocio_id = $1
            GROUP BY TO_CHAR(fecha, 'DD/MM'), DATE(fecha)
            ORDER BY DATE(fecha) ASC
            LIMIT 30
        `, [negocio.id]);

        const ultimas = await pool.query(`
            SELECT *
            FROM public.historial_ventas
            WHERE negocio_id = $1
            ORDER BY fecha DESC
            LIMIT 12
        `, [negocio.id]);

        res.json({
            resumen: resumen.rows[0],
            porDia: porDia.rows,
            ultimas: ultimas.rows
        });
    } catch (error) {
        res.status(500).json({
            error: error.message
        });
    }
});

async function inicializarCreditos() {
    await pool.query(`
        CREATE TABLE IF NOT EXISTS public.negocios (
            id SERIAL PRIMARY KEY,
            slug TEXT NOT NULL UNIQUE,
            nombre TEXT NOT NULL,
            giro TEXT NOT NULL DEFAULT 'ferreteria',
            estado TEXT NOT NULL DEFAULT 'activo',
            plan TEXT NOT NULL DEFAULT 'demo',
            telefono TEXT,
            correo TEXT,
            direccion TEXT,
            app_version TEXT,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
    `);

    await pool.query(
        `
        INSERT INTO public.negocios (slug, nombre, giro, estado, plan)
        VALUES ($1, $2, 'ferreteria', 'activo', 'demo')
        ON CONFLICT (slug) DO NOTHING
        `,
        [DEFAULT_NEGOCIO_SLUG, DEFAULT_NEGOCIO_NOMBRE]
    );

    await pool.query(`
        CREATE TABLE IF NOT EXISTS public.productos (
            id SERIAL PRIMARY KEY,
            nombre TEXT NOT NULL,
            precio NUMERIC(12,2) NOT NULL DEFAULT 0,
            stock NUMERIC(12,3) NOT NULL DEFAULT 0,
            codigo TEXT NOT NULL DEFAULT '',
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
    `);

    await pool.query(`
        ALTER TABLE public.productos
        ADD COLUMN IF NOT EXISTS negocio_id INTEGER REFERENCES public.negocios(id)
    `);

    await pool.query(
        `
        UPDATE public.productos
        SET negocio_id = (SELECT id FROM public.negocios WHERE slug = $1)
        WHERE negocio_id IS NULL
        `,
        [DEFAULT_NEGOCIO_SLUG]
    );

    await pool.query(`
        CREATE TABLE IF NOT EXISTS public.ventas (
            id SERIAL PRIMARY KEY,
            total NUMERIC(12,2) NOT NULL DEFAULT 0,
            fecha TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
    `);

    await pool.query(`
        ALTER TABLE public.ventas
        ADD COLUMN IF NOT EXISTS negocio_id INTEGER REFERENCES public.negocios(id)
    `);

    await pool.query(
        `
        UPDATE public.ventas
        SET negocio_id = (SELECT id FROM public.negocios WHERE slug = $1)
        WHERE negocio_id IS NULL
        `,
        [DEFAULT_NEGOCIO_SLUG]
    );

    await pool.query(`
        CREATE TABLE IF NOT EXISTS public.historial_ventas (
            id SERIAL PRIMARY KEY,
            total NUMERIC(12,2) NOT NULL DEFAULT 0,
            fecha TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
    `);

    await pool.query(`
        ALTER TABLE public.historial_ventas
        ADD COLUMN IF NOT EXISTS negocio_id INTEGER REFERENCES public.negocios(id)
    `);

    await pool.query(
        `
        UPDATE public.historial_ventas
        SET negocio_id = (SELECT id FROM public.negocios WHERE slug = $1)
        WHERE negocio_id IS NULL
        `,
        [DEFAULT_NEGOCIO_SLUG]
    );

    await pool.query(`
        CREATE TABLE IF NOT EXISTS public.usuarios (
            id SERIAL PRIMARY KEY,
            usuario TEXT NOT NULL UNIQUE,
            password TEXT NOT NULL,
            rol TEXT NOT NULL DEFAULT 'Administrador',
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
    `);

    await pool.query(`
        ALTER TABLE public.usuarios
        ADD COLUMN IF NOT EXISTS negocio_id INTEGER REFERENCES public.negocios(id)
    `);

    await pool.query(
        `
        INSERT INTO public.usuarios (negocio_id, usuario, password, rol)
        SELECT id, 'admin', '1234', 'Administrador'
        FROM public.negocios
        WHERE slug = $1
        ON CONFLICT (usuario) DO NOTHING
        `,
        [DEFAULT_NEGOCIO_SLUG]
    );

    await pool.query(
        `
        UPDATE public.usuarios
        SET negocio_id = (SELECT id FROM public.negocios WHERE slug = $1)
        WHERE negocio_id IS NULL
        `,
        [DEFAULT_NEGOCIO_SLUG]
    );

    await pool.query(`
        ALTER TABLE public.productos
        ADD COLUMN IF NOT EXISTS proveedor TEXT
    `);

    await pool.query(`
        ALTER TABLE public.productos
        ADD COLUMN IF NOT EXISTS ubicacion TEXT
    `);

    await pool.query(`
        ALTER TABLE public.productos
        ADD COLUMN IF NOT EXISTS categoria TEXT
    `);

    await pool.query(`
        ALTER TABLE public.productos
        ADD COLUMN IF NOT EXISTS subcategoria TEXT
    `);

    await pool.query(`
        ALTER TABLE public.productos
        ADD COLUMN IF NOT EXISTS marca TEXT
    `);

    await pool.query(`
        ALTER TABLE public.productos
        ADD COLUMN IF NOT EXISTS descripcion TEXT
    `);

    await pool.query(`
        ALTER TABLE public.productos
        ADD COLUMN IF NOT EXISTS unidad_venta TEXT NOT NULL DEFAULT 'pieza'
    `);

    await pool.query(`
        ALTER TABLE public.productos
        ADD COLUMN IF NOT EXISTS precio_distribuidor NUMERIC(12,2)
    `);

    await pool.query(`
        ALTER TABLE public.productos
        ADD COLUMN IF NOT EXISTS precio_mayoreo NUMERIC(12,2)
    `);

    await pool.query(`
        ALTER TABLE public.productos
        ADD COLUMN IF NOT EXISTS precio_publico NUMERIC(12,2)
    `);

    await pool.query(`
        ALTER TABLE public.productos
        ADD COLUMN IF NOT EXISTS stock_minimo NUMERIC(12,2) NOT NULL DEFAULT 3
    `);

    await pool.query(`
        ALTER TABLE public.productos
        ADD COLUMN IF NOT EXISTS alta_rotacion TEXT
    `);

    await pool.query(`
        ALTER TABLE public.productos
        ADD COLUMN IF NOT EXISTS tipo_producto TEXT NOT NULL DEFAULT 'catalogo'
    `);

    await pool.query(`
        ALTER TABLE public.productos
        ADD COLUMN IF NOT EXISTS presentacion_compra TEXT
    `);

    await pool.query(`
        ALTER TABLE public.productos
        ADD COLUMN IF NOT EXISTS factor_conversion NUMERIC(12,3)
    `);

    await pool.query(`
        ALTER TABLE public.productos
        ADD COLUMN IF NOT EXISTS bascula_digital TEXT NOT NULL DEFAULT 'no'
    `);

    await pool.query(`
        CREATE TABLE IF NOT EXISTS public.producto_codigos (
            id SERIAL PRIMARY KEY,
            negocio_id INTEGER REFERENCES public.negocios(id),
            producto_id INTEGER NOT NULL
                REFERENCES public.productos(id)
                ON DELETE CASCADE,
            codigo TEXT NOT NULL,
            tipo TEXT NOT NULL DEFAULT 'alterno',
            proveedor TEXT,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            UNIQUE(producto_id, codigo, tipo)
        )
    `);

    await pool.query(`
        ALTER TABLE public.producto_codigos
        ADD COLUMN IF NOT EXISTS negocio_id INTEGER REFERENCES public.negocios(id)
    `);

    await pool.query(`
        UPDATE public.producto_codigos pc
        SET negocio_id = p.negocio_id
        FROM public.productos p
        WHERE pc.producto_id = p.id
        AND pc.negocio_id IS NULL
    `);

    await pool.query(`
        INSERT INTO public.producto_codigos
        (
            negocio_id,
            producto_id,
            codigo,
            tipo,
            proveedor
        )
        SELECT
            negocio_id,
            id,
            regexp_replace(COALESCE(codigo, ''), '[^a-zA-Z0-9]', '', 'g'),
            'barra',
            proveedor
        FROM public.productos
        WHERE regexp_replace(COALESCE(codigo, ''), '[^a-zA-Z0-9]', '', 'g') <> ''
        ON CONFLICT DO NOTHING
    `);

    await pool.query(`
        CREATE TABLE IF NOT EXISTS public.clientes_credito (
            id SERIAL PRIMARY KEY,
            negocio_id INTEGER REFERENCES public.negocios(id),
            nombre TEXT NOT NULL,
            telefono TEXT,
            limite_credito NUMERIC(12,2) NOT NULL DEFAULT 0,
            activo BOOLEAN NOT NULL DEFAULT true,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
    `);

    await pool.query(`
        ALTER TABLE public.clientes_credito
        ADD COLUMN IF NOT EXISTS negocio_id INTEGER REFERENCES public.negocios(id)
    `);

    await pool.query(
        `
        UPDATE public.clientes_credito
        SET negocio_id = (SELECT id FROM public.negocios WHERE slug = $1)
        WHERE negocio_id IS NULL
        `,
        [DEFAULT_NEGOCIO_SLUG]
    );

    await pool.query(`
        CREATE TABLE IF NOT EXISTS public.movimientos_credito (
            id SERIAL PRIMARY KEY,
            negocio_id INTEGER REFERENCES public.negocios(id),
            cliente_id INTEGER NOT NULL
                REFERENCES public.clientes_credito(id)
                ON DELETE CASCADE,
            tipo TEXT NOT NULL
                CHECK (tipo IN ('venta', 'abono')),
            referencia TEXT,
            concepto TEXT NOT NULL DEFAULT '',
            monto NUMERIC(12,2) NOT NULL
                CHECK (monto > 0),
            fecha TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
    `);

    await pool.query(`
        ALTER TABLE public.movimientos_credito
        ADD COLUMN IF NOT EXISTS negocio_id INTEGER REFERENCES public.negocios(id)
    `);

    await pool.query(`
        UPDATE public.movimientos_credito m
        SET negocio_id = c.negocio_id
        FROM public.clientes_credito c
        WHERE m.cliente_id = c.id
        AND m.negocio_id IS NULL
    `);

    await pool.query(`
        ALTER TABLE public.movimientos_credito
        ADD COLUMN IF NOT EXISTS productos JSONB NOT NULL DEFAULT '[]'::jsonb
    `);

    await pool.query(`
        CREATE TABLE IF NOT EXISTS public.proveedores (
            id SERIAL PRIMARY KEY,
            negocio_id INTEGER REFERENCES public.negocios(id),
            nombre TEXT NOT NULL,
            contacto TEXT,
            telefono TEXT,
            correo TEXT,
            notas TEXT,
            activo BOOLEAN NOT NULL DEFAULT true,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
    `);

    await pool.query(`
        ALTER TABLE public.proveedores
        ADD COLUMN IF NOT EXISTS negocio_id INTEGER REFERENCES public.negocios(id)
    `);

    await pool.query(
        `
        UPDATE public.proveedores
        SET negocio_id = (SELECT id FROM public.negocios WHERE slug = $1)
        WHERE negocio_id IS NULL
        `,
        [DEFAULT_NEGOCIO_SLUG]
    );
}
function cargarModuloPOS(nombre, instalar) {
    try {
        instalar();
        console.log(`Modulo POS cargado: ${nombre}`);
    } catch (error) {
        console.log(`Error cargando modulo POS ${nombre}:`, error);
    }
}

cargarModuloPOS("fase4 compras/ajustes", () => {
    require("./fase4-server")(app, pool, normalizarCodigo);
});
cargarModuloPOS("fase5 finanzas", () => {
    require("./fase5-server")(app, pool);
});
cargarModuloPOS("fase6 caja", () => {
    require("./fase6-server")(app, pool);
});
cargarModuloPOS("fase7 caja por metodo", () => {
    require("./fase7-caja-server")(app, pool);
});


inicializarCreditos()
    .then(() => {
        app.listen(PORT, () => {
            console.log(
                `Servidor corriendo en puerto ${PORT}`
            );
        });
    })
    .catch(error => {
        console.log(
            "Error inicializando creditos:",
            error
        );
        process.exit(1);
    });
