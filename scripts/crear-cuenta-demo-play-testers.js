// Cuenta demo persistente para compartir con los testers de la prueba
// cerrada de Google Play (requisito de Google: 12 testers inscritos
// durante 14 dias antes de poder pasar a produccion). No es un
// negocio sintetico efimero como los que usan las pruebas
// automatizadas (tests/helpers/negocio-prueba.js) -- este debe
// persistir mientras dure la prueba cerrada, por eso vive en
// scripts/ (no en tmp/) y con datos y credenciales fijos, no
// generados con timestamp.
const pool = require("../db.js");
const { hashPassword } = require("../password-utils.js");

const SLUG = "demo-tornillo-feliz";
const CORREO = "demo@nexoposoficial.com";
const PASSWORD = "NexoDemo2026";

async function main() {
    const negocio = await pool.query(
        `INSERT INTO public.negocios (slug, nombre, giro, estado, plan, telefono, correo, direccion, password_hash, correo_verificado)
         VALUES ($1, $2, 'ferreteria', 'activo', 'pro', $3, $4, $5, $6, true)
         RETURNING id`,
        [SLUG, "Ferreteria El Tornillo Feliz", "477 123 4567", CORREO, "Av. Industrias 245, Leon, Gto.", hashPassword(PASSWORD)]
    );
    const negocioId = negocio.rows[0].id;

    await pool.query(
        `INSERT INTO public.licencias (negocio_id, estado, plan, fecha_vencimiento, gracia_dias, monto_mensual)
         VALUES ($1, 'activa', 'pro', NOW() + INTERVAL '365 days', 15, 899)`,
        [negocioId]
    );

    const productos = [
        ["Martillo de una", "8001", "Herramienta manual", "Truper", 245.00, 210.00, 265.00, 34],
        ["Taladro inalambrico 20V", "8002", "Herramienta electrica", "DeWalt", 1850.00, 1650.00, 2100.00, 12],
        ["Cinta metrica 5m", "8003", "Herramienta manual", "Truper", 85.00, 72.00, 95.00, 60],
        ["Pintura vinilica blanca 4L", "8004", "Pinturas", "Comex", 420.00, 380.00, 465.00, 22],
        ["Foco LED 9W", "8005", "Electrico", "Philips", 45.00, 38.00, 55.00, 150],
        ["Cable THW calibre 12 (rollo 100m)", "8006", "Electrico", "Condumex", 980.00, 890.00, 1080.00, 8],
        ["Cerradura de perilla", "8007", "Herrajes", "Kwikset", 320.00, 280.00, 360.00, 18],
        ["Tubo PVC hidraulico 1/2 (6m)", "8008", "Plomeria", "Rotoplas", 95.00, 82.00, 108.00, 40],
        ["Pegamento PVC 120ml", "8009", "Plomeria", "Truper", 65.00, 55.00, 75.00, 55],
        ["Guantes de carnaza", "8010", "Seguridad industrial", "Truper", 110.00, 95.00, 125.00, 45],
        ["Sierra caladora 650W", "8011", "Herramienta electrica", "Bosch", 1450.00, 1300.00, 1650.00, 6],
        ["Broca para concreto 1/4", "8012", "Herramienta manual", "Truper", 35.00, 28.00, 42.00, 90]
    ];

    const idsProducto = [];
    for (const [nombre, codigo, categoria, marca, distribuidor, publico, carrito, stock] of productos) {
        const r = await pool.query(
            `INSERT INTO public.productos (nombre, precio, stock, categoria, codigo, marca, negocio_id, precio_distribuidor, precio_publico, unidad_venta, stock_minimo)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'pieza', 5)
             RETURNING id, nombre, precio`,
            [nombre, carrito, stock, categoria, codigo, marca, negocioId, distribuidor, publico]
        );
        idsProducto.push(r.rows[0]);
    }

    const clientes = ["Roberto Sanchez", "Maria Fernandez", "Publico general", "Constructora Leon SA", "Publico general"];
    const metodos = ["efectivo", "tarjeta", "efectivo", "transferencia", "efectivo", "tarjeta"];
    const ahora = Date.now();

    for (let i = 0; i < 9; i += 1) {
        const items = [];
        const nItems = 1 + Math.floor(Math.random() * 3);
        let total = 0;
        for (let j = 0; j < nItems; j += 1) {
            const p = idsProducto[Math.floor(Math.random() * idsProducto.length)];
            const cantidad = 1 + Math.floor(Math.random() * 3);
            const importe = Number(p.precio) * cantidad;
            total += importe;
            items.push({ id: p.id, nombre: p.nombre, cantidad, precio: Number(p.precio), importe, unidadVenta: "pieza" });
        }
        total = Number(total.toFixed(2));
        const horasAtras = i * 7 + Math.floor(Math.random() * 4);
        const fecha = new Date(ahora - horasAtras * 3600 * 1000);
        const folioNumero = 100 + i;

        await pool.query(
            `INSERT INTO public.historial_ventas
                (total, fecha, metodo_pago, negocio_id, subtotal, productos, folio, folio_numero, cajero_nombre, cliente_nombre, estado)
             VALUES ($1, $2, $3, $4, $1, $5, $6, $7, 'Gustavo', $8, 'completada')`,
            [total, fecha, metodos[i % metodos.length], negocioId, JSON.stringify(items), `V-${String(folioNumero).padStart(6, "0")}`, folioNumero, clientes[i % clientes.length]]
        );
    }

    // 2 clientes de credito -- uno al corriente, uno vencido -- para
    // que Inicio/Reportes en /dueno no se vean vacios en esa seccion.
    const clienteAlCorriente = await pool.query(
        `INSERT INTO public.clientes_credito (nombre, telefono, limite_credito, activo, negocio_id, fecha_vencimiento)
         VALUES ('Constructora Leon SA', '477 555 0101', 15000, true, $1, CURRENT_DATE + INTERVAL '20 days')
         RETURNING id`,
        [negocioId]
    );
    await pool.query(
        `INSERT INTO public.movimientos_credito (cliente_id, tipo, concepto, monto, negocio_id, subtotal, fecha_vencimiento)
         VALUES ($1, 'venta', 'Material para obra', 3200, $2, 3200, NOW() + INTERVAL '20 days')`,
        [clienteAlCorriente.rows[0].id, negocioId]
    );

    const clienteVencido = await pool.query(
        `INSERT INTO public.clientes_credito (nombre, telefono, limite_credito, activo, negocio_id, fecha_vencimiento)
         VALUES ('Roberto Sanchez', '477 555 0202', 5000, true, $1, CURRENT_DATE - INTERVAL '5 days')
         RETURNING id`,
        [negocioId]
    );
    await pool.query(
        `INSERT INTO public.movimientos_credito (cliente_id, tipo, concepto, monto, negocio_id, subtotal, fecha_vencimiento)
         VALUES ($1, 'venta', 'Herramienta electrica', 1850, $2, 1850, NOW() - INTERVAL '5 days')`,
        [clienteVencido.rows[0].id, negocioId]
    );

    console.log(JSON.stringify({ negocioId, slug: SLUG, correo: CORREO, password: PASSWORD }, null, 2));
    await pool.end();
}

main().catch(error => { console.error(error); process.exit(1); });
