// Fuente unica de verdad de la taxonomia de "oficio/interes" de una
// persona -- reusada por personas-server.js (registro/login/PATCH),
// market-server.js (personalizacion de Nexo Market) y
// public-site-server.js (ICONOS_CATEGORIA_TENANT, que consume estos
// mismos patrones para no duplicar regex). Los mismos 8 patrones que
// ya existian en ICONOS_CATEGORIA_TENANT antes de este archivo, mas
// "otro" (sin icono, sin patron -- catch-all explicito).

const OFICIOS_PERSONA = [
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

module.exports = { OFICIOS_PERSONA };
