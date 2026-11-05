// Envases retornables (abarrotes): cuanto vale el envase de cada producto (cerveza, refresco de vidrio...).
//
// El precio del producto sigue siendo el completo (liquido + envase). Si el cliente trae su envase vacio, el cajero lo marca en
// la venta y se descuenta este importe por pieza. Vive en su propia tabla para no tocar la de productos: si la funcion esta
// apagada (funciones_beta.envases) nada de esto se usa. La tabla se crea sola la primera vez (migrations/20261119_envases.sql
// es la misma sentencia, por si se prefiere correr migraciones).

const { responderError } = require("./error-utils");
const { PERMISOS, requerirPermiso } = require("./rbac");

let tablaLista = false;

async function asegurarTabla(pool) {
    if (tablaLista) return;

    await pool.query(`
        CREATE TABLE IF NOT EXISTS public.producto_envases (
            negocio_id INTEGER NOT NULL REFERENCES public.negocios(id) ON DELETE CASCADE,
            producto_id INTEGER NOT NULL REFERENCES public.productos(id) ON DELETE CASCADE,
            importe NUMERIC(10, 2) NOT NULL CHECK (importe > 0),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            PRIMARY KEY (negocio_id, producto_id)
        )
    `);
    tablaLista = true;
}

function instalar(app, pool, requerirAccesoNegocio) {
    function negocioId(req) {
        const id = req.negocioDispositivo?.negocio_id ?? req.negocioAutenticado?.negocio_id;

        if (!id) {
            const error = new Error("Este equipo no esta vinculado a ningun negocio");
            error.httpStatus = 401;
            throw error;
        }

        return id;
    }

    // Mapa { productoId: importe } de todo el negocio (son pocos: solo lo que lleva envase).
    app.get("/envases", requerirAccesoNegocio, async (req, res) => {
        try {
            await asegurarTabla(pool);
            const filas = await pool.query(`SELECT producto_id, importe FROM public.producto_envases WHERE negocio_id = $1`, [negocioId(req)]);
            const envases = {};
            filas.rows.forEach(f => { envases[f.producto_id] = Number(f.importe); });

            res.json({ ok: true, envases });
        } catch (error) {
            // Sin la tabla (o sin permiso de la base): nadie tiene envases, la venta sigue igual.
            res.json({ ok: true, envases: {} });
        }
    });

    // Importe vacio o 0 = el producto ya no lleva envase.
    app.put("/envases/:productoId", requerirAccesoNegocio, requerirPermiso(PERMISOS.MODIFICAR_INVENTARIO), async (req, res) => {
        try {
            const idNegocio = negocioId(req);
            const productoId = Number(req.params.productoId);
            const crudo = String(req.body?.importe ?? "").replace(",", ".").trim();
            const importe = crudo === "" ? 0 : Number(crudo);

            if (!Number.isInteger(productoId) || productoId <= 0) {
                res.status(400).json({ ok: false, error: "Producto no valido." });
                return;
            }

            if (!Number.isFinite(importe) || importe < 0 || importe > 9999) {
                res.status(400).json({ ok: false, error: "Escribe el importe del envase en pesos, por ejemplo 8." });
                return;
            }

            await asegurarTabla(pool);

            const producto = await pool.query(`SELECT 1 FROM public.productos WHERE id = $1 AND negocio_id = $2`, [productoId, idNegocio]);

            if (!producto.rows.length) {
                res.status(404).json({ ok: false, error: "No se encontro el producto." });
                return;
            }

            if (importe === 0) {
                await pool.query(`DELETE FROM public.producto_envases WHERE negocio_id = $1 AND producto_id = $2`, [idNegocio, productoId]);
                res.json({ ok: true, productoId, importe: 0 });
                return;
            }

            const redondeado = Math.round(importe * 100) / 100;

            await pool.query(
                `INSERT INTO public.producto_envases (negocio_id, producto_id, importe) VALUES ($1, $2, $3)
                 ON CONFLICT (negocio_id, producto_id) DO UPDATE SET importe = EXCLUDED.importe, updated_at = NOW()`,
                [idNegocio, productoId, redondeado]
            );

            res.json({ ok: true, productoId, importe: redondeado });
        } catch (error) {
            responderError(res, error);
        }
    });
}

module.exports = instalar;
