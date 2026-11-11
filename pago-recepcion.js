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

const SQL_TABLA_CUENTAS = `
    CREATE TABLE IF NOT EXISTS public.cuentas_pagar (
        id SERIAL PRIMARY KEY,
        negocio_id INTEGER REFERENCES public.negocios(id),
        proveedor TEXT NOT NULL DEFAULT '',
        origen_tipo TEXT NOT NULL DEFAULT 'manual',
        origen_id INTEGER,
        concepto TEXT NOT NULL DEFAULT '',
        monto_total NUMERIC(12,2) NOT NULL DEFAULT 0,
        saldo NUMERIC(12,2) NOT NULL DEFAULT 0,
        vencimiento DATE,
        estado TEXT NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente', 'parcial', 'pagada', 'cancelada')),
        notas TEXT NOT NULL DEFAULT '',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
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
        nota: String(crudo.nota || "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 240),
        vencimiento: limpiarFecha(crudo.vencimiento)
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

// La Agenda de pagos es una funcion nueva por negocio (negocios.funciones_beta.agenda_pagos); un negocio con "_todas" la tiene salvo que la apague.
async function agendaActiva(client, negocioId) {
    const fila = (await client.query(`SELECT funciones_beta FROM public.negocios WHERE id = $1`, [negocioId])).rows[0];
    const valor = fila && fila.funciones_beta;

    if (!valor) return false;

    return valor._todas === true ? valor.agenda_pagos !== false : valor.agenda_pagos === true;
}

// Recibido "a deber" con un monto: queda como cuenta por pagar al proveedor, con su fecha limite. Una por recepcion; nunca tumba la recepcion.
async function crearCuentaPorPagar(client, { negocioId, recepcionId, limpio }) {
    if (limpio.metodo !== "a_deber" || !(limpio.monto > 0)) return false;

    await client.query("SAVEPOINT cuenta_por_pagar");

    try {
        if (!(await agendaActiva(client, negocioId))) { await client.query("RELEASE SAVEPOINT cuenta_por_pagar"); return false; }

        await client.query(SQL_TABLA_CUENTAS);

        const ya = await client.query(`SELECT 1 FROM public.cuentas_pagar WHERE negocio_id = $1 AND origen_tipo = 'recepcion' AND origen_id = $2`, [negocioId, recepcionId]);

        if (!ya.rows.length) {
            const recepcion = (await client.query(`SELECT proveedor FROM public.recepciones_mercancia WHERE id = $1 AND negocio_id = $2`, [recepcionId, negocioId])).rows[0];
            const proveedor = String((recepcion && recepcion.proveedor) || "").trim() || "Proveedor";

            await client.query(
                `INSERT INTO public.cuentas_pagar (negocio_id, proveedor, origen_tipo, origen_id, concepto, monto_total, saldo, vencimiento, notas)
                 VALUES ($1, $2, 'recepcion', $3, $4, $5, $5, $6, $7)`,
                [negocioId, proveedor, recepcionId, `Recepción de mercancía #${recepcionId}`, limpio.monto, limpio.vencimiento, limpio.nota || ""]
            );
        }

        await client.query("RELEASE SAVEPOINT cuenta_por_pagar");
        return true;
    } catch (error) {
        await client.query("ROLLBACK TO SAVEPOINT cuenta_por_pagar");
        console.warn("[pago-recepcion] No se pudo crear la cuenta por pagar:", error.message);
        return false;
    }
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
        await crearCuentaPorPagar(client, { negocioId, recepcionId, limpio });
        return true;
    } catch (error) {
        await client.query("ROLLBACK TO SAVEPOINT pago_recepcion");
        console.warn("[pago-recepcion] No se pudo anotar el pago de la recepcion:", error.message);
        return false;
    }
}

module.exports = { crearCuentaPorPagar, agendaActiva, METODOS_PAGO, limpiarPago, limpiarFecha, asegurarPagoRecepcion, guardarPagoRecepcion };
