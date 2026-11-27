// Prueba que la copia sirve: arranca el servidor contra ella, entra con un negocio de ejemplo, cobra una venta y apaga el servidor.
//   node --env-file=.env.copia scripts/copia-aislada/probar.js
if (!/127\.0\.0\.1|localhost/.test(process.env.DATABASE_URL || "") || !process.env.NEXO_COPIA_AISLADA) {
    console.error("Esto solo corre en la copia aislada: usa --env-file=.env.copia");
    process.exit(1);
}

const path = require("path");
const crypto = require("crypto");
const { spawn } = require("child_process");
const pool = require("../../db");

const PUERTO = 3201;
const BASE = `http://localhost:${PUERTO}`;
const errores = [];

(async () => {
    const hijo = spawn(process.execPath, ["server.js"], { cwd: path.join(__dirname, "..", ".."), env: { ...process.env, PORT: String(PUERTO) }, stdio: ["ignore", "pipe", "pipe"] });
    for (const flujo of [hijo.stdout, hijo.stderr]) flujo.on("data", d => String(d).split("\n").filter(l => /error|fallo|no se pudo|does not exist|no existe/i.test(l)).forEach(l => errores.push(l.slice(0, 200))));

    try {
        let vivo = false;
        for (let i = 0; i < 90 && !vivo; i++) {
            await new Promise(r => setTimeout(r, 1000));
            vivo = await fetch(`${BASE}/`).then(r => r.ok).catch(() => false);
        }
        if (!vivo) throw new Error("El servidor no arranco");
        console.log("OK  el servidor arranca contra la copia");

        const negocio = (await pool.query("SELECT id FROM public.negocios WHERE slug = 'copia-con-productos'")).rows[0];
        if (!negocio) throw new Error("Falta correr negocios-ejemplo.js");

        const token = crypto.randomBytes(24).toString("hex");
        await pool.query("INSERT INTO public.dispositivos_vinculados (negocio_id, token_hash, nombre_dispositivo) VALUES ($1, $2, 'prueba de la copia')", [negocio.id, crypto.createHash("sha256").update(token).digest("hex")]);
        const pedir = async (ruta, cuerpo) => {
            const r = await fetch(`${BASE}${ruta}`, { method: cuerpo ? "POST" : "GET", headers: { "Content-Type": "application/json", "x-dispositivo-token": token }, body: cuerpo ? JSON.stringify(cuerpo) : undefined });
            const datos = await r.json().catch(() => null);
            if (!r.ok) throw new Error(`${ruta} -> ${r.status} ${JSON.stringify(datos).slice(0, 160)}`);
            return datos;
        };

        const productos = await pedir("/productos");
        console.log(`OK  lista de productos (${productos.length})`);
        await pedir("/caja/abrir", { usuario: "copia", fondoInicial: 100 }).catch(error => { if (!/Ya hay un turno/.test(error.message)) throw error; });
        console.log("OK  caja abierta");
        const venta = await pedir("/ventas", { productos: [{ id: productos[0].id, precio: Number(productos[0].precio), cantidad: 1 }], metodoPago: "efectivo", pagos: { efectivo: Number(productos[0].precio) } });
        console.log(`OK  venta cobrada (${venta.folio})`);
        await pedir("/reportes/ventas?periodo=dia");
        console.log("OK  reporte del dia");
        await pool.query("DELETE FROM public.dispositivos_vinculados WHERE nombre_dispositivo = 'prueba de la copia'");
    } catch (error) {
        console.error("FALLO ", error.message);
        process.exitCode = 1;
    } finally {
        hijo.kill();
        await pool.end();
        if (errores.length) console.log(`Avisos del servidor (${errores.length}):\n  ${[...new Set(errores)].slice(0, 8).join("\n  ")}`);
    }
})();
