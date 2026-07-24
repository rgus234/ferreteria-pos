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

    cargarModuloPOS("ia nexo", () => {
        require("./ia-server")(app, pool, requerirAccesoNegocio);
    });

    cargarModuloPOS("cotizaciones app del dueno", () => {
        require("./cotizaciones-server")(app, pool, requerirSesionCuenta);
    });

    cargarModuloPOS("catalogo de proveedor", () => {
        require("./catalog-server")(app, pool, requerirAccesoNegocio, firmarTokenImagen);
    });

    cargarModuloPOS("respaldos automaticos", () => {
        require("./backup-server")(app, pool);
    });
}

module.exports = {
    cargarModulosPOS,
};
