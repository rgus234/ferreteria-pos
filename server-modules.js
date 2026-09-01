function cargarModuloPOS(nombre, instalar) {
    try {
        instalar();
        console.log(`Modulo POS cargado: ${nombre}`);
    } catch (error) {
        console.log(`Error cargando modulo POS ${nombre}:`, error);
    }
}

function cargarModulosPOS({ app, pool, normalizarCodigo, requerirAccesoNegocio, requerirSesionCuenta, firmarTokenImagen }) {
    cargarModuloPOS("fase4 compras/ajustes", () => {
        require("./fase4-server")(app, pool, normalizarCodigo, requerirAccesoNegocio);
    });

    cargarModuloPOS("fase5 finanzas", () => {
        require("./fase5-server")(app, pool, requerirAccesoNegocio);
    });

    cargarModuloPOS("fase6 caja", () => {
        require("./fase6-server")(app, pool, requerirAccesoNegocio);
    });

    cargarModuloPOS("fase7 caja por metodo", () => {
        require("./fase7-caja-server")(app, pool);
    });

    cargarModuloPOS("stripe suscripciones", () => {
        require("./stripe-server")(app, pool, requerirSesionCuenta, requerirAccesoNegocio);
    });

    cargarModuloPOS("stripe connect marketplace", () => {
        require("./stripe-connect-server")(app, pool, requerirAccesoNegocio);
    });

    cargarModuloPOS("ia nexo", () => {
        require("./ia-server")(app, pool, requerirAccesoNegocio, firmarTokenImagen);
    });

    cargarModuloPOS("cotizaciones app del dueno", () => {
        require("./cotizaciones-server")(app, pool, requerirSesionCuenta);
    });

    cargarModuloPOS("catalogo de proveedor", () => {
        const { firmarTokenImagenCatalogoPdf } = require("./catalog-pdf-server");
        require("./catalog-server")(app, pool, requerirAccesoNegocio, firmarTokenImagen, firmarTokenImagenCatalogoPdf);
    });

    cargarModuloPOS("catalogo de proveedor -- importacion PDF", () => {
        require("./catalog-pdf-server")(app, pool, requerirAccesoNegocio);
    });

    cargarModuloPOS("catalogo de fabricante (TRUPER)", () => {
        require("./catalogo-fabricante-server")(app, pool, requerirAccesoNegocio);
    });

    cargarModuloPOS("respaldos automaticos", () => {
        require("./backup-server")(app, pool);
    });

    cargarModuloPOS("banco de imagenes global", () => {
        require("./banco-imagenes-server")(app, pool, requerirAccesoNegocio);
    });

    cargarModuloPOS("encargos de clientes", () => {
        require("./encargos-server")(app, pool, requerirAccesoNegocio);
    });

    cargarModuloPOS("listas de productos reutilizables", () => {
        require("./listas-producto-server")(app, pool, requerirAccesoNegocio);
    });

    cargarModuloPOS("editor de codigos de barras / etiquetas", () => {
        require("./barcode-labels-server")(app, pool, requerirAccesoNegocio);
    });

    cargarModuloPOS("sitio web del negocio", () => {
        require("./public-site-server").registrarRutas(app, pool, requerirAccesoNegocio);
    });

    cargarModuloPOS("personas (identidad Nexo unificada)", () => {
        require("./personas-server").registrarRutas(app, pool, requerirAccesoNegocio);
    });

    cargarModuloPOS("pedidos de Nexo Market (maquina de estados)", () => {
        require("./market-pedidos-server")(app, pool, requerirAccesoNegocio, firmarTokenImagen);
    });

    cargarModuloPOS("notificaciones push (VAPID)", () => {
        require("./push-server").registrarRutas(app, pool, requerirAccesoNegocio);
    });

    cargarModuloPOS("recordatorios automaticos de credito vencido", () => {
        require("./credito-recordatorios-server")(app, pool);
    });

    cargarModuloPOS("recordatorio de prueba gratuita por terminar", () => {
        require("./prueba-recordatorios-server")(app, pool);
    });

    cargarModuloPOS("facturacion electronica (CFDI)", () => {
        require("./facturacion-server")(app, pool, requerirAccesoNegocio);
    });
}

module.exports = {
    cargarModulosPOS,
};
