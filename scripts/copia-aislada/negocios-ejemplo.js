// Negocios de ejemplo DENTRO de la copia aislada (nunca en la base real).
//   node --env-file=.env.copia scripts/copia-aislada/negocios-ejemplo.js
// Contraseña de los tres: Copia-12345   PIN del administrador: 1234
if (!/127\.0\.0\.1|localhost/.test(process.env.DATABASE_URL || "") || !process.env.NEXO_COPIA_AISLADA) {
    console.error("Esto solo corre en la copia aislada: usa --env-file=.env.copia");
    process.exit(1);
}

const pool = require("../../db");
const { hashPassword } = require("../../password-utils");

const EJEMPLOS = [
    { slug: "copia-tienda-nueva", nombre: "Tienda Nueva", giro: "abarrotes", productos: [] },
    { slug: "copia-ferreteria", nombre: "Ferreteria de 20 anos", giro: "ferreteria", productos: [] },
    { slug: "copia-con-productos", nombre: "Tienda con productos", giro: "abarrotes", productos: [["Coca Cola 600 ml", 18, 24], ["Sabritas Original 45 g", 22, 10], ["Galletas Marias 170 g", 15, 8]] }
];

(async () => {
    for (const e of EJEMPLOS) {
        const ya = await pool.query("SELECT id FROM public.negocios WHERE slug = $1", [e.slug]);
        if (ya.rows.length) { console.log(`${e.slug}: ya existe`); continue; }

        const correo = `${e.slug}@copia.test`;
        const { id } = (await pool.query(
            `INSERT INTO public.negocios (slug, nombre, giro, estado, plan, correo, password_hash, nivel_precio_por_defecto, correo_verificado)
             VALUES ($1, $2, $3, 'activo', 'prueba', $4, $5, 'publico', true) RETURNING id`,
            [e.slug, e.nombre, e.giro, correo, hashPassword("Copia-12345")]
        )).rows[0];
        await pool.query("INSERT INTO public.negocio_giros (negocio_id, giro, activo) VALUES ($1, $2, true)", [id, e.giro]);
        await pool.query("INSERT INTO public.licencias (negocio_id, license_key, estado, plan, fecha_vencimiento, gracia_dias, monto_mensual) VALUES ($1, $2, 'activa', 'prueba', NOW() + INTERVAL '365 days', 15, 0)", [id, `NXP-copia-${id}`]);
        await pool.query("INSERT INTO public.empleados (negocio_id, nombre, rol, pin_hash, activo, permisos) VALUES ($1, 'Administrador', 'Administrador', $2, true, '{}'::jsonb)", [id, hashPassword("1234")]);

        for (const [i, [nombre, precio, stock]] of e.productos.entries()) {
            await pool.query("INSERT INTO public.productos (negocio_id, nombre, codigo, precio, precio_publico, stock) VALUES ($1, $2, $3, $4, $4, $5)", [id, nombre, `750000000${i}00`, precio, stock]);
        }
        console.log(`${e.slug}: creado (${correo})`);
    }
    await pool.end();
})().catch(error => { console.error("ERROR:", error.message); process.exit(1); });
