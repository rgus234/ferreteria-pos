// Fase 7 del plan de identidad multi-proveedor: tramo de descuento por
// monto de factura -- regla comercial de GAFI ($5,000-7,999 -> 10%,
// $8,000-11,999 -> 12%, $12,000+ -> 20%), nunca de TRUPER ni de ningun
// otro proveedor por default. Funcion pura (sin acceso a base de datos
// ni red) para poder probarla sola -- quien la llama decide si este
// proveedor tiene tramos configurados y con que monto evaluarlos.
//
// Se aplica SIEMPRE sobre el monto REAL de una factura (nunca sobre una
// remision, que trae costos estimados por IA y todavia no es un
// documento fiscal) para llegar al "costo neto": lo que el negocio de
// verdad pago por esa mercancia, antes de que las reglas de
// precio/categoria/redondeo (public/js/pricing-rules.js) calculen el
// precio de venta -- dos capas separadas, nunca mezcladas.

// tramos: [{desde, hasta (null/undefined/"" = sin limite), porcentaje}, ...]
// El formulario que los crea no deberia dejar tramos superpuestos, pero
// si dos aplicaran al mismo monto, gana el de mayor porcentaje -- nunca
// el primero de la lista, que dependeria del orden en que se guardaron.
function resolverDescuentoPorMonto(tramos, monto) {
    if (!Array.isArray(tramos) || !tramos.length) return null;

    const montoNumero = Number(monto) || 0;

    const aplicables = tramos.filter(tramo => {
        const desde = Number(tramo?.desde) || 0;
        const hastaCrudo = tramo?.hasta;
        const hasta = hastaCrudo === null || hastaCrudo === undefined || hastaCrudo === ""
            ? Infinity
            : Number(hastaCrudo);
        return montoNumero >= desde && montoNumero <= hasta;
    });

    if (!aplicables.length) return null;

    return aplicables.reduce((mejor, actual) =>
        Number(actual.porcentaje) > Number(mejor.porcentaje) ? actual : mejor
    );
}

// Costo neto = costo de lista menos el descuento del tramo. Nunca
// negativo, nunca inventa un descuento si no hay tramo aplicable (en
// ese caso regresa el costo tal cual, sin tocarlo).
function costoNetoConDescuento(costoLista, tramos, montoFactura) {
    const tramo = resolverDescuentoPorMonto(tramos, montoFactura);
    const costo = Number(costoLista) || 0;
    if (!tramo) return { costoNeto: costo, tramoAplicado: null };

    const porcentaje = Number(tramo.porcentaje) || 0;
    const costoNeto = Math.max(0, costo * (1 - porcentaje / 100));
    return { costoNeto, tramoAplicado: { desde: tramo.desde, hasta: tramo.hasta ?? null, porcentaje } };
}

module.exports = { resolverDescuentoPorMonto, costoNetoConDescuento };
