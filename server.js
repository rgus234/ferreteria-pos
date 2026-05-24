const express = require("express");
const path = require("path");
const pool = require("./db");

const app = express();

// Render ocupa su puerto automático
const PORT = process.env.PORT || 3000;

app.use(express.json());

// Servir carpeta public
app.use(express.static(path.join(__dirname, "public")));

// Abrir index.html al entrar al dominio
app.get("/", (req, res) => {
    res.sendFile(
        path.join(__dirname, "public", "index.html")
    );
});



app.get("/productos", async (req, res) => {
    try {
        const resultado =
        await pool.query(
            "SELECT * FROM productos ORDER BY id"
        );

        res.json(resultado.rows);

    } catch (error) {
        console.log(error);

        res.status(500).json({
            error: "Error servidor"
        });
    }
});



app.get("/producto-codigo/:codigo", async (req, res) => {

    const codigo = req.params.codigo;

    try {

        const resultado =
        await pool.query(
            `
            SELECT *
            FROM productos
            WHERE codigo = $1
            `,
            [codigo]
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
        codigo
    } = req.body;

    try {

        await pool.query(
            `
            INSERT INTO productos
            (
                nombre,
                precio,
                stock,
                codigo
            )
            VALUES ($1,$2,$3,$4)
            `,
            [
                nombre,
                precio,
                stock,
                codigo
            ]
        );

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
        codigo
    } = req.body;

    try {

        await pool.query(
            `
            UPDATE productos
            SET
                nombre = $1,
                precio = $2,
                stock = $3,
                codigo = $4
            WHERE id = $5
            `,
            [
                nombre,
                precio,
                stock,
                codigo,
                id
            ]
        );

        res.json({
            success: true
        });

    } catch (error) {

        console.log(error);

        res.status(500).json({
            error: "Error editar"
        });
    }
});



app.delete("/eliminar-producto/:id", async (req, res) => {

    const { id } = req.params;

    try {

        await pool.query(
            `
            DELETE FROM productos
            WHERE id = $1
            `,
            [id]
        );

        res.json({
            success: true
        });

    } catch (error) {

        console.log(error);

        res.status(500).json({
            error: "Error eliminar"
        });
    }
});



app.post("/login", async (req, res) => {

    const {
        usuario,
        password
    } = req.body;

    try {

        const resultado =
        await pool.query(
            `
            SELECT *
            FROM usuarios
            WHERE usuario = $1
            AND password = $2
            `,
            [usuario, password]
        );

        res.json({
            success:
            resultado.rows.length > 0
        });

    } catch (error) {

        console.log(error);

        res.status(500).json({
            error: "Error login"
        });
    }
});



app.post("/ventas", async (req, res) => {

    const {
        total,
        productos
    } = req.body;

    try {

        await pool.query(
            `
            INSERT INTO ventas(total)
            VALUES($1)
            `,
            [total]
        );

        await pool.query(
            `
            INSERT INTO historial_ventas(total)
            VALUES($1)
            `,
            [total]
        );

        for (const producto of productos) {

            await pool.query(
                `
                UPDATE productos
                SET stock = stock - 1
                WHERE id = $1
                `,
                [producto.id]
            );
        }

        res.json({
            success: true
        });

    } catch (error) {

        console.log(error);

        res.status(500).json({
            error: "Error venta"
        });
    }
});



app.get("/dashboard", async (req, res) => {

    try {

        const totalVentas =
        await pool.query(`
            SELECT
            COALESCE(SUM(total),0)
            AS total
            FROM historial_ventas
        `);

        const cantidadVentas =
        await pool.query(`
            SELECT COUNT(*)
            AS cantidad
            FROM historial_ventas
        `);

        const productos =
        await pool.query(`
            SELECT COUNT(*)
            AS productos
            FROM productos
        `);

        res.json({
            totalVentas:
            totalVentas.rows[0].total,

            cantidadVentas:
            cantidadVentas.rows[0].cantidad,

            productos:
            productos.rows[0].productos
        });

    } catch (error) {

        console.log(error);

        res.status(500).json({
            error: "Error dashboard"
        });
    }
});



app.get("/historial", async (req, res) => {

    const historial =
    await pool.query(`
        SELECT *
        FROM historial_ventas
        ORDER BY fecha DESC
    `);

    res.json(historial.rows);
});



app.get("/grafica-ventas", async (req, res) => {

    const resultado =
    await pool.query(`
        SELECT
        TO_CHAR(fecha,'DD/MM') AS dia,
        total
        FROM historial_ventas
        ORDER BY fecha ASC
    `);

    res.json(resultado.rows);
});



app.listen(PORT, () => {
    console.log(
        `Servidor corriendo en puerto ${PORT}`
    );
});