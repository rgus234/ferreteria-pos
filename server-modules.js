function cargarModuloPOS(nombre, instalar) {
    try {
        instalar();
        console.log(`Modulo POS cargado: ${nombre}`);
    } catch (error) {
        console.log(`Error cargando modulo POS ${nombre}:`, error);
    }
}

function cargarModulosPOS({ app, pool, normalizarCodigo }) {
    cargarModuloPOS("fase4 compras/ajustes", () => {
        require("./fase4-server")(app, pool, normalizarCodigo);
    });

    cargarModuloPOS("fase5 finanzas", () => {
        require("./fase5-server")(app, pool);
    });

    cargarModuloPOS("fase6 caja", () => {
        require("./fase6-server")(app, pool);
    });

    cargarModuloPOS("fase7 caja por metodo", () => {
        require("./fase7-caja-server")(app, pool);
    });
}

module.exports = {
    cargarModulosPOS,
};
