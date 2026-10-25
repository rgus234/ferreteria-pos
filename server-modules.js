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

    cargarModuloPOS("errores del sistema (seguimiento y alertas)", () => {
        require("./errores-sistema-server").registrarRutasErroresSistema(app);
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

    cargarModuloPOS("prueba de 45 dias de pilotos", () => {
        require("./prueba-piloto-server")(app, pool, requerirSesionCuenta, requerirAccesoNegocio);
    });

    cargarModuloPOS("lotes de caducidad y merma (abarrotes)", () => {
        require("./lotes-server")(app, pool, requerirAccesoNegocio);
    });

    cargarModuloPOS("pedido sugerido por proveedor (abarrotes)", () => {
        require("./pedido-sugerido-server")(app, pool, requerirAccesoNegocio);
    });

    cargarModuloPOS("inicio y ganancia de abarrotes", () => {
        require("./inicio-abarrotes-server")(app, pool, requerirAccesoNegocio);
    });

    cargarModuloPOS("venta rapida con favoritos (abarrotes)", () => {
        require("./favoritos-server")(app, pool, requerirAccesoNegocio);
    });

    cargarModuloPOS("capturar codigos (privado, temporal)", () => {
        require("./captura-codigos-server")(app, pool, requerirAccesoNegocio);
    });

    cargarModuloPOS("solicitud de equipo (pagina oficial)", () => {
        require("./solicitud-equipo-server")(app, pool);
    });

    cargarModuloPOS("invitaciones a negocios piloto", () => {
        require("./invitaciones-server")(app, pool);
    });

    cargarModuloPOS("fotos sugeridas (revisar y confirmar fotos del banco)", () => {
        require("./fotos-sugeridas-server")(app, pool, requerirAccesoNegocio);
    });

    cargarModuloPOS("exhibidores (displays con tarjetas visuales)", () => {
        require("./exhibidores-server")(app, pool, requerirAccesoNegocio);
    });

    cargarModuloPOS("exhibidores -- importar el surtido de Truper desde su ficha", () => {
        require("./exhibidores-truper-server")(app, pool, requerirAccesoNegocio);
    });

    cargarModuloPOS("Explorar Nexo (busqueda por intencion)", () => {
        require("./explorar-nexo-server")(app, pool, requerirAccesoNegocio);
    });

    cargarModuloPOS("Recepcion Inteligente (Fase 1, sin Gmail)", () => {
        require("./recepcion-inteligente-server")(app, pool, requerirAccesoNegocio);
    });

    cargarModuloPOS("Recepcion Inteligente -- Gmail (Fase 2)", () => {
        require("./recepcion-inteligente-gmail")(app, pool, requerirAccesoNegocio);
    });

    cargarModuloPOS("Recepcion Inteligente -- Gmail, revision automatica (Fase 3)", () => {
        require("./recepcion-inteligente-gmail-cron")(app, pool);
    });

    cargarModuloPOS("Pantalla del cliente", () => {
        require("./pantalla-cliente-server")(app, pool, requerirAccesoNegocio);
    });

    cargarModuloPOS("editor de codigos de barras / etiquetas", () => {
        require("./barcode-labels-server")(app, pool, requerirAccesoNegocio);
    });

    cargarModuloPOS("etiquetas en PDF", () => {
        require("./etiquetas-pdf-server")(app, pool, requerirAccesoNegocio);
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
