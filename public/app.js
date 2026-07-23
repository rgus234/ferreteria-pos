const catalogo = [
 {
 codigo: "7500001",
 nombre: "Pinza electricista 9",
 distribuidor: 118,
 medioMayoreo: 129,
 publico: 149,
 stockMinimo: 3,
 altaRotacion: "si"
 }
];

let carrito = [];
let clienteVentaActual = null;
let descuentoCarrito = {
 tipo: "ninguno",
 valor: 0
};
let metodoPagoSeleccionado = "efectivo";
let nivelPrecioActual = "mayoreo";
let grafica = null;
let graficaReporteVentas = null;
let graficaMetodosPago = null;
let graficaDashboardVentas = null;
let todosProductos = [];
let clientesCredito = [];
let proveedores = [];
let creditoActual = null;
let resolverFormularioCredito = null;
let productoEditandoId = null;
let temporizadorCodigoBarras = null;
let usuarioActual = null;
let logoConfiguracionTemporal = null;
const ULTIMA_VENTA_POS_KEY = "ultimaVentaPOS";
let paginaInventario = 1;
let paginaInventarioBajo = 1;
let paginaReporteVentas = 1;
let categoriaModalActual = "";
let categoriaSeleccionadaId = null;
let tabCategoriaActual = "productos";
let paginaCategoriaProductos = 1;
let ordenCategoriaProductos = "nombre-asc";
let tamanoPaginaCategoriaProductos = 10;
let estadoSyncDesktopPOS = {
 disponible: false,
 online: typeof navigator === "undefined" ? true : navigator.onLine,
 pendiente: 0,
 error: 0,
 sincronizado: 0,
 ultimaRevision: null,
 sincronizando: false
};
const TAMANO_PAGINA_INVENTARIO = 10;
let tamanoPaginaInventarioActual = TAMANO_PAGINA_INVENTARIO;
const TAMANO_PAGINA_REPORTES = 8;
const TAMANO_PAGINA_PROVEEDORES = 8;
let paginaProveedoresActual = 1;
let estadoProveedoresActual = "activo";
const VERSION_NEXO_POS = "1.0.1";

const CONFIG_NEGOCIO_KEY = "configuracionNegocioPOS";
const TEMA_POS_KEY = "temaPOS";
const SESION_POS_KEY = "sesionUsuarioPOS";
const NEGOCIO_ACTIVO_KEY = "negocioActivoNexoPOS";
const CUENTA_SESION_TOKEN_KEY = "nexoCuentaSesionToken";
const DISPOSITIVO_TOKEN_KEY = "nexoDispositivoToken";
const EMPLEADOS_CACHE_KEY = "empleadosSincronizadosNexoPOS";
const CONTACTO_DESARROLLADOR_KEY = "contactoDesarrolladorNexoPOS";
const MODO_DESARROLLADOR_NEXO_KEY = "modoDesarrolladorNexoPOS";

// Interceptor global de fetch: adjunta el token de este equipo (o, si
// todavia no esta vinculado, el de la sesion de cuenta del dueno) a
// toda peticion relativa que no lo traiga ya explicito. Las rutas
// operativas del POS ya no confian en ningun dato que mande el
// cliente sin un token -- este es el unico lugar que hace falta tocar
// para que las ~50 llamadas fetch() sueltas del resto del frontend
// manden el token automaticamente, sin editarlas una por una.
(function activarInterceptorFetchPOS() {
    const fetchOriginalPOS = window.fetch.bind(window);

    window.fetch = function fetchConAutenticacionPOS(entrada, opcionesOriginales) {
        const esRelativa = typeof entrada === "string" && !/^([a-z][a-z0-9+.-]*:)?\/\//i.test(entrada);

        if (!esRelativa) {
            return fetchOriginalPOS(entrada, opcionesOriginales);
        }

        const opciones = Object.assign({}, opcionesOriginales);
        const headers = new Headers(opciones.headers || {});

        if (!headers.has("x-dispositivo-token") && !headers.has("authorization")) {
            const tokenDispositivo = localStorage.getItem(DISPOSITIVO_TOKEN_KEY);
            const tokenCuenta = localStorage.getItem(CUENTA_SESION_TOKEN_KEY);

            if (tokenDispositivo) {
                headers.set("x-dispositivo-token", tokenDispositivo);
            } else if (tokenCuenta) {
                headers.set("authorization", "Bearer " + tokenCuenta);
            }
        }

        opciones.headers = headers;

        return fetchOriginalPOS(entrada, opciones).then(respuesta => {
            if (respuesta.status === 401) {
                respuesta.clone().json().then(cuerpo => {
                    if (cuerpo && cuerpo.equipoNoVinculado) {
                        if (typeof limpiarVinculacionDispositivo === "function") {
                            limpiarVinculacionDispositivo();
                        }
                        if (typeof mostrarPantallaDeEntradaPOS === "function") {
                            mostrarPantallaDeEntradaPOS();
                        }
                    }
                }).catch(() => {});
            }

            return respuesta;
        });
    };
})();
const CONTACTO_DESARROLLADOR_DEFAULT = {
 nombre: "Soporte Nexo POS",
 telefono: "",
 whatsapp: "",
 correo: ""
};
let estadoLicenciaNexoPOS = {
 modo: "normal",
 estado: "activa",
 plan: "demo"
};

/* Limpieza final de texto visible */



(()=>{if(!window.__fase4Loader){window.__fase4Loader=true;const s=document.createElement("script");s.src="fase4.js?v=pedidos-recepcion-xml-20260723-02";document.body.appendChild(s);}})();
(()=>{if(!window.__fase5Loader){window.__fase5Loader=true;const s=document.createElement("script");s.src="fase5.js?v=finanzas-redesign-20260704-01";document.body.appendChild(s);}})();
(()=>{if(!window.__fixNavDynamicLoader){window.__fixNavDynamicLoader=true;const s=document.createElement("script");s.src="fix-navegacion.js?v=nav-fix-20260704-01";document.body.appendChild(s);}})();
(()=>{if(!window.__fase6Loader){window.__fase6Loader=true;const s=document.createElement("script");s.src="fase6.js?v=caja-redesign-20260704-01";document.body.appendChild(s);}})();
(()=>{if(!window.__fase7CajaUILoader){window.__fase7CajaUILoader=true;const s=document.createElement("script");s.src="fase7-caja-ui.js?v=caja-redesign-20260704-01";document.body.appendChild(s);}})();
