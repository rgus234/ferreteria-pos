/* Contenido por giro: UNA sola fuente para el sitio, la invitacion, la pagina de descarga y los correos.

   Lo que el visitante elige al entrar (ferreteria, abarrotes o ambos) define todo lo que se le muestra,
   hasta la descarga. Se carga en el navegador (window.NEXO_GIRO) y tambien desde el servidor (require).

   Honestidad: cada funcion lleva su estado real. "Disponible" = ya la usa un negocio real; "Nuevo" = ya
   funciona pero esta en pruebas (las de abarrotes se acaban de construir). No se promete nada que no exista. */

(function (raiz) {
    var CLAVES = ["ferreteria", "abarrotes", "ambos"];

    var funcionesFerreteria = [
        { titulo: "Catálogos de tus proveedores", texto: "Busca por código o nombre y crea el producto con su precio en segundos (Truper, Diprofer y más).", estado: "Disponible" },
        { titulo: "Precios por tipo de cliente", texto: "Público, medio mayoreo y distribuidor: cada venta usa el precio que toca.", estado: "Disponible" },
        { titulo: "Cotizaciones y crédito", texto: "Cotiza, vende a crédito y sabe quién te debe, con cuántos días y a quién cobrarle primero.", estado: "Disponible" },
        { titulo: "Recepción de mercancía", texto: "Carga la factura (XML), confirma lo que llegó escaneando y actualiza costos y precios.", estado: "Disponible" },
        { titulo: "Exhibidores y displays", texto: "Arma el despachador de brocas o el exhibidor de lijas y véndelo con tarjetas.", estado: "Disponible" }
    ];

    var funcionesAbarrotes = [
        { titulo: "Cuánto ganaste hoy", texto: "Al abrir Nexo ves lo que vendiste y lo que te dejó de verdad, restando lo que te costó cada producto.", estado: "Nuevo" },
        { titulo: "Caducidad y mermas", texto: "Cada entrada de tortilla, pan o lácteos lleva su fecha. Te avisamos qué revisar cada mañana y cuánto dinero es lo que se tira.", estado: "Nuevo" },
        { titulo: "Pedido sugerido por proveedor", texto: "Dile qué día viene la Coca o el pan: Nexo calcula con tus ventas qué pedir y te avisa unos días antes.", estado: "Nuevo" },
        { titulo: "Venta rápida con favoritos", texto: "Tarjetas grandes con foto de lo que más vendes: un toque y se suma al carrito.", estado: "Nuevo" },
        { titulo: "Fiado sin libreta", texto: "Quién te debe, cuánto y desde cuándo, con recordatorios para no olvidar cobrar.", estado: "Disponible" }
    ];

    var CONTENIDO = {
        ferreteria: {
            clave: "ferreteria",
            nombre: "Ferretería",
            icono: "llave",
            detalle: "Herramientas, materiales y construcción",
            eyebrow: "Nexo para ferreterías",
            titular: "Tu ferretería con el inventario, el crédito y los precios bajo control.",
            copia: "Miles de productos, varios proveedores y clientes de crédito: Nexo está pensado para ese ritmo. Ya lo usa una ferretería real.",
            seccionTitulo: "Hecho para ferreterías",
            seccionTexto: "Estas son las herramientas que una ferretería usa todos los días.",
            funciones: funcionesFerreteria,
            sigue: "Después de instalar, Nexo te ayuda a cargar tu inventario desde el catálogo de tus proveedores o desde una lista de Excel.",
            primerosPasos: [
                "Carga tu inventario: busca en el catálogo de tus proveedores o pega tu lista de Excel.",
                "Registra a tus clientes de crédito y sus límites.",
                "Haz tu primera venta y pruébala con tus precios: público, medio mayoreo o distribuidor."
            ],
            correo: "Con tu perfil de ferretería tendrás catálogos de proveedor, precios por tipo de cliente, cotizaciones y crédito.",
            ejemploNegocio: "Ej. Ferretería La Unión"
        },

        abarrotes: {
            clave: "abarrotes",
            nombre: "Abarrotes",
            icono: "carrito",
            detalle: "Tienda de la esquina o minisúper",
            eyebrow: "Nexo para tiendas de abarrotes",
            titular: "Tu tienda sin libretas: sabes qué vendes, qué se vence y cuánto ganas.",
            copia: "Pensado para el día a día de una tienda: venta rápida, fiado, lo que caduca y lo que toca pedirle a cada proveedor. Las herramientas de abarrotes son nuevas y las estamos probando.",
            seccionTitulo: "Hecho para tiendas de abarrotes",
            seccionTexto: "Lo que un tendero necesita ver cada día. Las funciones marcadas como nuevas ya funcionan y las estamos afinando contigo.",
            funciones: funcionesAbarrotes,
            sigue: "Después de instalar, Nexo te lleva a cargar tus productos rápido y a decirle qué día viene cada proveedor.",
            primerosPasos: [
                "Carga tus productos: escanea, pega tu lista o usa lo que Nexo ya reconoce por código de barras.",
                "Ponle su costo a tus productos para saber cuánto ganas, y dile qué día viene cada proveedor.",
                "Arma tus favoritos y haz tu primera venta rápida."
            ],
            correo: "Con tu perfil de abarrotes verás tu día de un vistazo (cuánto vendiste y cuánto ganaste), caducidades, pedido sugerido por proveedor y venta rápida.",
            ejemploNegocio: "Ej. Abarrotes La Palma"
        },

        ambos: {
            clave: "ambos",
            nombre: "Ferretería y abarrotes",
            icono: "tienda",
            detalle: "Tengo los dos negocios",
            eyebrow: "Nexo para quien tiene ferretería y tienda",
            titular: "Una sola cuenta para tu ferretería y tu tienda.",
            copia: "Vende, controla inventario y crédito de los dos negocios en un mismo lugar. Tu cuenta arranca con el programa completo; las herramientas de abarrotes son nuevas y las estamos probando.",
            seccionTitulo: "Hecho para quien tiene los dos negocios",
            seccionTexto: "Tu cuenta incluye lo de ferretería y lo de abarrotes.",
            funciones: funcionesFerreteria.slice(0, 3).concat(funcionesAbarrotes.slice(0, 3)),
            sigue: "Después de instalar, Nexo te ayuda a cargar el inventario de los dos negocios y te deja elegir qué categorías vendes.",
            primerosPasos: [
                "Carga el inventario de tu ferretería y de tu tienda: catálogo, escaneo o lista de Excel.",
                "Registra a tus clientes de crédito y sus límites.",
                "Haz tu primera venta y revisa que cada producto salga con su precio."
            ],
            correo: "Con tu cuenta de ferretería y abarrotes tendrás el programa completo, con las categorías de los dos negocios.",
            ejemploNegocio: "Ej. Ferretería y Abarrotes La Unión"
        }
    };

    // Texto libre ("Ferretería", "abarrotes", "ambos", "Ferretería y abarrotes") -> clave, o null si es otro giro.
    function normalizar(texto) {
        var t = String(texto || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
        var ferre = t.indexOf("ferret") !== -1;
        var abarro = t.indexOf("abarrote") !== -1;

        if (t.indexOf("ambos") !== -1 || (ferre && abarro)) return "ambos";
        if (ferre) return "ferreteria";
        if (abarro) return "abarrotes";
        return null;
    }

    var api = { CLAVES: CLAVES, CONTENIDO: CONTENIDO, normalizar: normalizar };

    if (typeof module !== "undefined" && module.exports) module.exports = api;
    if (raiz) raiz.NEXO_GIRO = api;
})(typeof window !== "undefined" ? window : null);
