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
        require("./ia-server")(app, pool, requerirAccesoNegocio);
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

    cargarModuloPOS("respaldos automaticos", () => {
        require("./backup-server")(app, pool);
    });

    cargarModuloPOS("banco de imagenes global", () => {
        require("./banco-imagenes-server")(app, pool, requerirAccesoNegocio);
    });

    cargarModuloPOS("encargos de clientes", () => {
        require("./encargos-server")(app, pool, requerirAccesoNegocio);
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
}

module.exports = {
    cargarModulosPOS,
};
