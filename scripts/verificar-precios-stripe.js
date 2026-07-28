const { config } = require("../config");

// Script de solo lectura -- confirma que los price IDs configurados
// en Stripe (STRIPE_PRICE_BASICO/PLUS/PRO) de verdad valen lo que el
// sitio publico anuncia (299/599/799 MXN). No escribe nada en Stripe
// ni en la base de datos. Si algo no coincide, es una
// desconfiguracion real de Stripe -- se reporta, no se ajusta el
// copy del sitio para que coincida con lo que sea que Stripe tenga.

const ESPERADO = {
    basico: { centavos: 29900, priceId: config.stripePriceBasico },
    plus: { centavos: 59900, priceId: config.stripePricePlus },
    pro: { centavos: 79900, priceId: config.stripePricePro }
};

async function main() {
    if (!config.stripeSecretKey) {
        console.log("STRIPE_SECRET_KEY no esta configurada -- no se puede verificar nada.");
        process.exitCode = 1;
        return;
    }

    const stripe = require("stripe")(config.stripeSecretKey, { apiVersion: "2024-06-20" });
    let huboError = false;

    for (const [plan, { centavos, priceId }] of Object.entries(ESPERADO)) {
        if (!priceId) {
            console.log(`[${plan}] Sin price ID configurado (STRIPE_PRICE_${plan.toUpperCase()}) -- omitido.`);
            huboError = true;
            continue;
        }

        try {
            const precio = await stripe.prices.retrieve(priceId);
            const coincideMonto = precio.unit_amount === centavos;
            const coincideMoneda = precio.currency === "mxn";
            const estado = coincideMonto && coincideMoneda ? "OK" : "NO COINCIDE";

            console.log(
                `[${plan}] ${estado} -- id=${priceId} unit_amount=${precio.unit_amount} ` +
                `currency=${precio.currency} (esperado ${centavos} mxn)`
            );

            if (!coincideMonto || !coincideMoneda) huboError = true;
        } catch (error) {
            console.log(`[${plan}] Error al consultar price ID ${priceId}: ${error.message}`);
            huboError = true;
        }
    }

    if (huboError) {
        console.log("\nHay al menos un precio que no coincide o no se pudo verificar -- revisar el dashboard de Stripe antes de publicar el copy de precios.");
        process.exitCode = 1;
    } else {
        console.log("\nLos 3 precios coinciden con lo publicado en el sitio (299/599/799 MXN).");
    }
}

main().catch(error => {
    console.error(error);
    process.exit(1);
});
