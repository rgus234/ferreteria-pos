// Fuente unica de verdad de la taxonomia de "oficio/interes" de una
// persona, ahora por giro (ferreteria/abarrotes/papeleria) -- reusada
// por personas-server.js (registro/login/PATCH), market-server.js
// (personalizacion de Nexo Market) y public-site-server.js
// (ICONOS_CATEGORIA_TENANT, que solo consume la lista de ferreteria via
// OFICIOS_PERSONA, sin cambios). Los patrones de abarrotes/papeleria se
// basan en los departamentos reales de CATEGORIAS_NEXO_ABARROTES /
// CATEGORIAS_NEXO_PAPELERIA (categorias-nexo.js) para que el match por
// texto contra productos.categoria de verdad encuentre productos.

const OFICIOS_FERRETERIA = [
    { clave: "herramientas", etiqueta: "Herramientas", patron: /herramient/i },
    { clave: "construccion", etiqueta: "Construccion", patron: /construc|albañ|cemento|block|acero|ladrillo|varilla/i },
    { clave: "electrico", etiqueta: "Electrico", patron: /electric|foco|lampara|cable/i },
    { clave: "plomeria", etiqueta: "Plomeria", patron: /plomer|tuber|agua|valvula|grifo/i },
    { clave: "pintura", etiqueta: "Pintura", patron: /pintura|barniz|brocha/i },
    { clave: "seguridad", etiqueta: "Seguridad", patron: /segur|proteccion|casco|guante/i },
    { clave: "jardin", etiqueta: "Jardin", patron: /jardin|planta|riego|pasto/i },
    { clave: "limpieza", etiqueta: "Limpieza", patron: /limpieza|escoba|detergente/i },
    { clave: "otro", etiqueta: "Otro / prefiero no decir", patron: null }
];

const OFICIOS_ABARROTES = [
    { clave: "despensa", etiqueta: "Despensa y abarrotes secos", patron: /abarrotes secos|granos|semilla|pasta|sopa|aceite|vinagre|condiment|especia|enlatado|harina|azucar/i },
    { clave: "bebidas", etiqueta: "Bebidas", patron: /bebida|refresco|\bagua\b|jugo|nectar|\bcafe\b|\bte\b|cerveza|vino|licor|energetica/i },
    { clave: "lacteos_panaderia", etiqueta: "Lacteos y panaderia", patron: /lacteo|\bleche\b|yogurt|queso|mantequilla|margarina|\bcrema\b|panaderia|pan de caja|pan dulce|tortilla/i },
    { clave: "frescos", etiqueta: "Frutas y verduras", patron: /frutas y verduras|verdura|\bfruta|\bchile|hierba|aromatica|tuberculo|\braiz\b|raices/i },
    { clave: "botanas_dulces", etiqueta: "Botanas y dulces", patron: /botana|fritura|papas y frit|galleta|\bdulce|chocolate|chicle/i },
    { clave: "limpieza_hogar", etiqueta: "Limpieza del hogar", patron: /limpieza del hogar|detergente|jabon para trastes|desinfectante|papel higienico|servilleta|bolsas de basura/i },
    { clave: "higiene_personal", etiqueta: "Higiene y cuidado personal", patron: /higiene y cuidado personal|shampoo|pasta dental|cuidado femenino|rasurado|jabon de bano/i },
    { clave: "congelados", etiqueta: "Congelados y refrigerados", patron: /congelad|refrigerad|helado|embutido/i },
    { clave: "otro", etiqueta: "Otro / prefiero no decir", patron: null }
];

const OFICIOS_PAPELERIA = [
    { clave: "escolar", etiqueta: "Utiles escolares", patron: /utiles escolares|cuaderno|\blapiz\b|lapices|\bpluma\b|colores y crayon|crayon|mochila|lonchera|\bregla\b|geometria|corrector|borrador/i },
    { clave: "oficina", etiqueta: "Oficina", patron: /\boficina\b|carpeta|archivo|grapa|\bclip\b|cinta adhesiva|calculadora|post-?it|nota adhesiva/i },
    { clave: "arte_manualidades", etiqueta: "Arte y manualidades", patron: /manualidad|acuarela|pincel|pegamento|silicon/i },
    { clave: "impresion_copiado", etiqueta: "Impresion y copiado", patron: /impresion|copiado|toner|\btinta\b|fotocopia|impresora/i },
    { clave: "empastado", etiqueta: "Empastado y acabados", patron: /empastad|engargolado|plastificado|encuadernad/i },
    { clave: "tecnologia", etiqueta: "Tecnologia y computo", patron: /tecnologia|computo|\busb\b|memoria|audifono/i },
    { clave: "otro", etiqueta: "Otro / prefiero no decir", patron: null }
];

const OFICIOS_POR_GIRO = {
    ferreteria: OFICIOS_FERRETERIA,
    abarrotes: OFICIOS_ABARROTES,
    papeleria: OFICIOS_PAPELERIA
};

// Compatibilidad: public-site-server.js solo conoce ferreteria hoy.
const OFICIOS_PERSONA = OFICIOS_FERRETERIA;

module.exports = { OFICIOS_PERSONA, OFICIOS_POR_GIRO };
