// Dos fallas reales de Nexo IA que ninguna prueba cubria:
//  1. El envoltorio de salud de la API (ia-salud) devolvia una funcion async
//     nueva y le quitaba a messages.create() el metodo .withResponse() que
//     messages.stream() necesita: el chat en streaming fallaba SIEMPRE
//     ("Nexo se interrumpio mientras respondia").
//  2. La herramienta resumen_creditos leia la fecha de vencimiento del cliente
//     completo y no la de cada venta, asi que decia "0 vencidos" mientras la
//     pantalla Creditos mostraba clientes vencidos.

const { test, after } = require("node:test");
const assert = require("node:assert/strict");
const { pool, crearNegocioPrueba, crearClienteCreditoActivo, borrarNegocioPrueba } = require("./helpers/negocio-prueba");

let negocio;

after(async () => {
    if (negocio) await borrarNegocioPrueba(negocio.negocioId);
    await pool.end();
});

test("messages.create sigue exponiendo .withResponse() (necesario para streaming)", async () => {
    const { config } = require("../config");
    const llaveOriginal = config.anthropicApiKey;
    const fetchOriginal = globalThis.fetch;

    config.anthropicApiKey = "sk-ant-llave-de-prueba";
    globalThis.fetch = async () => new Response(
        JSON.stringify({ id: "msg_1", type: "message", role: "assistant", content: [], model: "x", stop_reason: "end_turn", usage: { input_tokens: 1, output_tokens: 1 } }),
        { status: 200, headers: { "content-type": "application/json" } }
    );

    try {
        const ia = require("../ia-server");
        const anthropic = ia.obtenerAnthropic();
        const llamada = anthropic.messages.create({ model: "x", max_tokens: 1, messages: [{ role: "user", content: "hola" }] });

        assert.equal(typeof llamada.withResponse, "function", "debe devolver la promesa original del SDK");
        await llamada;
    } finally {
        config.anthropicApiKey = llaveOriginal;
        globalThis.fetch = fetchOriginal;
    }
});

test("resumen_creditos cuenta como vencido lo mismo que la pantalla Creditos (por venta)", async () => {
    negocio = await crearNegocioPrueba("ia-vencidos");
    const { negocioId } = negocio;

    const vencido = await crearClienteCreditoActivo(negocioId, { nombre: "Cliente Vencido" });
    const alDia = await crearClienteCreditoActivo(negocioId, { nombre: "Cliente Al Dia" });

    await pool.query(
        `INSERT INTO public.movimientos_credito (negocio_id, cliente_id, tipo, referencia, concepto, monto, fecha, fecha_vencimiento)
         VALUES ($1, $2, 'venta', 'CR-IA-1', 'Venta vieja', 300, NOW() - INTERVAL '30 days', NOW() - INTERVAL '15 days'),
                ($1, $3, 'venta', 'CR-IA-2', 'Venta reciente', 120, NOW() - INTERVAL '2 days', NOW() + INTERVAL '13 days')`,
        [negocioId, vencido.id, alDia.id]
    );

    const { ejecutarHerramientaNexo } = require("../ia-server");
    const datos = await ejecutarHerramientaNexo(pool, negocioId, "resumen_creditos", {});

    assert.equal(datos.clientesConAdeudo, 2);
    assert.equal(datos.clientesVencidos, 1);
    assert.equal(datos.totalVencido, 300);
});
