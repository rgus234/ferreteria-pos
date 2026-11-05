// Pago al repartidor al recibir mercancia (abarrotes): cuanto se pago, como, y quien lo pago.
//
// Se guarda en la propia recepcion (recepciones_mercancia.pago_*), tanto en "Recibir mercancia" como en la factura de Recepcion Inteligente.
// Es solo un registro: no mueve la caja (si se pago con efectivo de la caja, la pantalla anota ademas el movimiento en Caja) y nunca puede
// tumbar la recepcion: se guarda con SAVEPOINT y, si algo falla, la recepcion sigue (se avisa que el pago no quedo anotado).
// Las columnas se crean solas (migrations/20261121_pago_recepcion.sql es lo mismo).

const METODOS_PAGO = {
    efectivo_caja: "Efectivo de la caja",
    efectivo_propio: "Efectivo (de mi bolsa)",
    transferencia: "Transferencia",
    a_deber: "Se quedó a deber"
};

const SQL_COLUMNAS = `
    ALTER TABLE public.recepciones_mercancia
        ADD COLUMN IF NOT EXISTS pago_monto NUMERIC(12, 2),
        ADD COLUMN IF NOT EXISTS pago_metodo TEXT,
        ADD COLUMN IF NOT EXISTS pago_por TEXT,
        ADD COLUMN IF NOT EXISTS pago_nota TEXT,
        ADD COLUMN IF NOT EXISTS pago_at TIMESTAMPTZ
`;

// Devuelve { monto, metodo, por, nota } limpio, o null si no mandaron un pago valido.
function limpiarPago(crudo) {
    if (!crudo || typeof crudo !== "object") return null;

    const metodo = String(crudo.metodo || "");
    const monto = Number(String(crudo.monto ?? "").replace(",", "."));

    if (!METODOS_PAGO[metodo]) return null;
    // "Se quedo a deber" puede ir sin monto exacto (se anota 0); los demas necesitan cuanto se pago.
    if (metodo !== "a_deber" && !(monto > 0)) return null;
    if (!Number.isFinite(monto) || monto < 0 || monto > 100000000) return null;

    return {
        monto: Math.round(monto * 100) / 100,
        metodo,
        por: String(crudo.por || "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 120),
        nota: String(crudo.nota || "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 240)
    };
}

// Fecha de caducidad "YYYY-MM-DD" valida, o null.
function limpiarFecha(valor) {
    const texto = String(valor || "").trim().slice(0, 10);

    if (!/^\d{4}-\d{2}-\d{2}$/.test(texto)) return null;

    const fecha = new Date(`${texto}T00:00:00Z`);

    return Number.isNaN(fecha.getTime()) || fecha.toISOString().slice(0, 10) !== texto ? null : texto;
}

async function asegurarPagoRecepcion(pool) {
    await pool.query(SQL_COLUMNAS);
}

// Dentro de la transaccion de la recepcion. Regresa true si quedo anotado.
async function guardarPagoRecepcion(client, { negocioId, recepcionId, pago }) {
    const limpio = limpiarPago(pago);

    if (!limpio || !recepcionId) return false;

    const actualizar = () => client.query(
        `UPDATE public.recepciones_mercancia
         SET pago_monto = $1, pago_metodo = $2, pago_por = $3, pago_nota = $4, pago_at = NOW()
         WHERE id = $5 AND negocio_id = $6`,
        [limpio.monto, limpio.metodo, limpio.por, limpio.nota, recepcionId, negocioId]
    );

    await client.query("SAVEPOINT pago_recepcion");

    try {
        try {
            await actualizar();
        } catch (error) {
            if (error.code !== "42703") throw error;   // columna inexistente: se crean y se reintenta
            await client.query("ROLLBACK TO SAVEPOINT pago_recepcion");
            await client.query(SQL_COLUMNAS);
            await actualizar();
        }

        await client.query("RELEASE SAVEPOINT pago_recepcion");
        return true;
    } catch (error) {
        await client.query("ROLLBACK TO SAVEPOINT pago_recepcion");
        console.warn("[pago-recepcion] No se pudo anotar el pago de la recepcion:", error.message);
        return false;
    }
}

module.exports = { METODOS_PAGO, limpiarPago, limpiarFecha, asegurarPagoRecepcion, guardarPagoRecepcion };
