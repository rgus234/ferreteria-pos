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
const CONTACTO_DESARROLLADOR_KEY = "contactoDesarrolladorNexoPOS";
const MODO_DESARROLLADOR_NEXO_KEY = "modoDesarrolladorNexoPOS";
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



(()=>{if(!window.__fase4Loader){window.__fase4Loader=true;const s=document.createElement("script");s.src="fase4.js?v=pedidos-redesign-20260705-01";document.body.appendChild(s);}})();
(()=>{if(!window.__fase5Loader){window.__fase5Loader=true;const s=document.createElement("script");s.src="fase5.js?v=finanzas-redesign-20260704-01";document.body.appendChild(s);}})();
(()=>{if(!window.__fixNavDynamicLoader){window.__fixNavDynamicLoader=true;const s=document.createElement("script");s.src="fix-navegacion.js?v=nav-fix-20260704-01";document.body.appendChild(s);}})();
(()=>{if(!window.__fase6Loader){window.__fase6Loader=true;const s=document.createElement("script");s.src="fase6.js?v=caja-redesign-20260704-01";document.body.appendChild(s);}})();
(()=>{if(!window.__fase7CajaUILoader){window.__fase7CajaUILoader=true;const s=document.createElement("script");s.src="fase7-caja-ui.js?v=caja-redesign-20260704-01";document.body.appendChild(s);}})();
