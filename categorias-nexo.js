// Catalogo canonico de categorias de Nexo (giro ferreteria/tlapaleria).
// Fuente unica de verdad -- mismo criterio que oficios-persona.js. No
// depende de lo que cada tienda escriba en productos.categoria; se usa
// para ofrecer un selector controlado + deteccion con IA al agregar un
// producto (ver ia-server.js, /ia/sugerir-categoria-nexo).
const CATEGORIAS_NEXO = [
    { departamento: "Herramienta manual", nombre: "Desarmadores" },
    { departamento: "Herramienta manual", nombre: "Llaves y matracas" },
    { departamento: "Herramienta manual", nombre: "Martillos y mazos" },
    { departamento: "Herramienta manual", nombre: "Pinzas" },
    { departamento: "Herramienta manual", nombre: "Cinceles y formones" },
    { departamento: "Herramienta manual", nombre: "Cintas y flexometros" },
    { departamento: "Herramienta manual", nombre: "Niveles y escuadras" },
    { departamento: "Herramienta manual", nombre: "Cajas y organizadores de herramienta" },

    { departamento: "Herramienta electrica", nombre: "Taladros y rotomartillos" },
    { departamento: "Herramienta electrica", nombre: "Esmeriladoras" },
    { departamento: "Herramienta electrica", nombre: "Sierras electricas" },
    { departamento: "Herramienta electrica", nombre: "Lijadoras" },
    { departamento: "Herramienta electrica", nombre: "Compresores" },
    { departamento: "Herramienta electrica", nombre: "Soldadoras" },
    { departamento: "Herramienta electrica", nombre: "Accesorios y brocas/discos para herramienta electrica" },
    { departamento: "Herramienta electrica", nombre: "Bateria y carga" },

    { departamento: "Electrico", nombre: "Cable y alambre" },
    { departamento: "Electrico", nombre: "Contactos y apagadores" },
    { departamento: "Electrico", nombre: "Placas" },
    { departamento: "Electrico", nombre: "Focos y luminarias" },
    { departamento: "Electrico", nombre: "Extensiones y multicontactos" },
    { departamento: "Electrico", nombre: "Interruptores y centros de carga" },
    { departamento: "Electrico", nombre: "Ductos y canaletas" },
    { departamento: "Electrico", nombre: "Timbres y accesorios" },

    { departamento: "Plomeria", nombre: "Tuberia PVC" },
    { departamento: "Plomeria", nombre: "Tuberia de cobre" },
    { departamento: "Plomeria", nombre: "Conexiones y coples" },
    { departamento: "Plomeria", nombre: "Llaves y valvulas" },
    { departamento: "Plomeria", nombre: "Regaderas y accesorios de bano" },
    { departamento: "Plomeria", nombre: "Bombas de agua" },
    { departamento: "Plomeria", nombre: "Calentadores y boilers" },
    { departamento: "Plomeria", nombre: "Tinacos y accesorios" },
    { departamento: "Plomeria", nombre: "Sanitarios y muebles de bano" },

    { departamento: "Construccion", nombre: "Cemento y mortero" },
    { departamento: "Construccion", nombre: "Varilla y malla" },
    { departamento: "Construccion", nombre: "Block y tabique" },
    { departamento: "Construccion", nombre: "Yeso y tablaroca" },
    { departamento: "Construccion", nombre: "Impermeabilizantes" },
    { departamento: "Construccion", nombre: "Arena y grava" },
    { departamento: "Construccion", nombre: "Andamios y escaleras" },
    { departamento: "Construccion", nombre: "Carretillas" },

    { departamento: "Pintura y acabados", nombre: "Pintura vinilica" },
    { departamento: "Pintura y acabados", nombre: "Esmaltes" },
    { departamento: "Pintura y acabados", nombre: "Solventes y thinner" },
    { departamento: "Pintura y acabados", nombre: "Brochas y rodillos" },
    { departamento: "Pintura y acabados", nombre: "Recubrimientos y selladores de muro" },
    { departamento: "Pintura y acabados", nombre: "Masking tape y proteccion" },

    { departamento: "Adhesivos y selladores", nombre: "Pegamentos de contacto" },
    { departamento: "Adhesivos y selladores", nombre: "Silicones" },
    { departamento: "Adhesivos y selladores", nombre: "Resistol y adhesivos blancos" },
    { departamento: "Adhesivos y selladores", nombre: "Cinta adhesiva y aislante" },
    { departamento: "Adhesivos y selladores", nombre: "Espumas de poliuretano" },

    { departamento: "Tornilleria y fijacion", nombre: "Tornillos" },
    { departamento: "Tornilleria y fijacion", nombre: "Tuercas y rondanas" },
    { departamento: "Tornilleria y fijacion", nombre: "Taquetes y anclas" },
    { departamento: "Tornilleria y fijacion", nombre: "Clavos" },
    { departamento: "Tornilleria y fijacion", nombre: "Remaches" },
    { departamento: "Tornilleria y fijacion", nombre: "Pijas" },

    { departamento: "Cerrajeria y seguridad del hogar", nombre: "Candados" },
    { departamento: "Cerrajeria y seguridad del hogar", nombre: "Chapas y cerraduras" },
    { departamento: "Cerrajeria y seguridad del hogar", nombre: "Bisagras" },
    { departamento: "Cerrajeria y seguridad del hogar", nombre: "Cerrojos" },
    { departamento: "Cerrajeria y seguridad del hogar", nombre: "Copias de llaves" },

    { departamento: "Seguridad industrial (EPP)", nombre: "Guantes" },
    { departamento: "Seguridad industrial (EPP)", nombre: "Lentes y caretas" },
    { departamento: "Seguridad industrial (EPP)", nombre: "Cascos" },
    { departamento: "Seguridad industrial (EPP)", nombre: "Botas de trabajo" },
    { departamento: "Seguridad industrial (EPP)", nombre: "Arneses y proteccion contra caidas" },
    { departamento: "Seguridad industrial (EPP)", nombre: "Cubrebocas y proteccion respiratoria" },
    { departamento: "Seguridad industrial (EPP)", nombre: "Proteccion auditiva" },

    { departamento: "Jardineria y exteriores", nombre: "Herramienta de jardin" },
    { departamento: "Jardineria y exteriores", nombre: "Mangueras y riego" },
    { departamento: "Jardineria y exteriores", nombre: "Fertilizantes y tierra" },
    { departamento: "Jardineria y exteriores", nombre: "Macetas" },
    { departamento: "Jardineria y exteriores", nombre: "Podadoras y desbrozadoras" },

    { departamento: "Abrasivos y corte", nombre: "Discos de corte y desbaste" },
    { departamento: "Abrasivos y corte", nombre: "Lijas" },
    { departamento: "Abrasivos y corte", nombre: "Brocas" },
    { departamento: "Abrasivos y corte", nombre: "Segueta y hojas de sierra" },
    { departamento: "Abrasivos y corte", nombre: "Piedras de afilar" },

    { departamento: "Automotriz y lubricantes", nombre: "Aceites y lubricantes" },
    { departamento: "Automotriz y lubricantes", nombre: "Baterias" },
    { departamento: "Automotriz y lubricantes", nombre: "Accesorios automotrices" },
    { departamento: "Automotriz y lubricantes", nombre: "Herramienta automotriz" },
    { departamento: "Automotriz y lubricantes", nombre: "Refrigerantes" },

    { departamento: "Gas y calefaccion", nombre: "Estufas" },
    { departamento: "Gas y calefaccion", nombre: "Boilers de gas y electricos" },
    { departamento: "Gas y calefaccion", nombre: "Mangueras y reguladores de gas" },
    { departamento: "Gas y calefaccion", nombre: "Parrillas" },

    { departamento: "Ferreteria general", nombre: "Cinta metrica y medicion" },
    { departamento: "Ferreteria general", nombre: "Candados y cadenas" },
    { departamento: "Ferreteria general", nombre: "Carretillas y diablitos" },
    { departamento: "Ferreteria general", nombre: "Otros / sin categoria clara" }
];

// Fase 2 del plan "Catalogo Maestro Nexo": arboles nuevos para
// negocios de abarrotes y papeleria. Todavia NO los usa la IA de
// clasificacion (SYSTEM_PROMPT_CATEGORIA_NEXO en ia-server.js sigue
// leyendo solo CATEGORIAS_NEXO -- generalizar el prompt es Fase 9) ni
// el selector estructurado del formulario de producto (sigue
// mostrando solo ferreteria hasta que haya ayuda de IA y payoff real
// en Nexo Market para estos giros) -- por ahora solo pueblan
// categorias_nexo para que la migracion/filtrado por giro se pueda
// probar con datos reales de mas de un giro.
const CATEGORIAS_NEXO_ABARROTES = [
    { departamento: "Bebidas", nombre: "Refrescos" },
    { departamento: "Bebidas", nombre: "Aguas" },
    { departamento: "Bebidas", nombre: "Jugos y nectares" },
    { departamento: "Bebidas", nombre: "Cafe y te" },
    { departamento: "Bebidas", nombre: "Bebidas alcoholicas" },
    { departamento: "Bebidas", nombre: "Bebidas energeticas" },

    { departamento: "Lacteos", nombre: "Leche" },
    { departamento: "Lacteos", nombre: "Yogurt" },
    { departamento: "Lacteos", nombre: "Quesos" },
    { departamento: "Lacteos", nombre: "Mantequilla y margarina" },
    { departamento: "Lacteos", nombre: "Crema" },

    { departamento: "Botanas y dulces", nombre: "Papas y frituras" },
    { departamento: "Botanas y dulces", nombre: "Galletas" },
    { departamento: "Botanas y dulces", nombre: "Dulces y chocolates" },
    { departamento: "Botanas y dulces", nombre: "Chicles" },

    { departamento: "Abarrotes secos", nombre: "Granos y semillas" },
    { departamento: "Abarrotes secos", nombre: "Pastas y sopas" },
    { departamento: "Abarrotes secos", nombre: "Aceites y vinagres" },
    { departamento: "Abarrotes secos", nombre: "Condimentos y especias" },
    { departamento: "Abarrotes secos", nombre: "Enlatados" },
    { departamento: "Abarrotes secos", nombre: "Harinas y azucar" },

    { departamento: "Panaderia", nombre: "Pan de caja" },
    { departamento: "Panaderia", nombre: "Pan dulce" },
    { departamento: "Panaderia", nombre: "Tortillas" },

    { departamento: "Limpieza del hogar", nombre: "Detergentes" },
    { departamento: "Limpieza del hogar", nombre: "Jabon para trastes" },
    { departamento: "Limpieza del hogar", nombre: "Desinfectantes" },
    { departamento: "Limpieza del hogar", nombre: "Papel higienico y servilletas" },
    { departamento: "Limpieza del hogar", nombre: "Bolsas de basura" },

    { departamento: "Higiene y cuidado personal", nombre: "Jabon de bano" },
    { departamento: "Higiene y cuidado personal", nombre: "Shampoo" },
    { departamento: "Higiene y cuidado personal", nombre: "Pasta dental" },
    { departamento: "Higiene y cuidado personal", nombre: "Cuidado femenino" },
    { departamento: "Higiene y cuidado personal", nombre: "Rasurado" },

    { departamento: "Congelados y refrigerados", nombre: "Helados" },
    { departamento: "Congelados y refrigerados", nombre: "Embutidos" },
    { departamento: "Congelados y refrigerados", nombre: "Comida congelada" },

    { departamento: "Cigarros y accesorios", nombre: "Cigarros y accesorios" },

    { departamento: "Abarrotes general", nombre: "Otros / sin categoria clara" }
];

const CATEGORIAS_NEXO_PAPELERIA = [
    { departamento: "Utiles escolares", nombre: "Cuadernos" },
    { departamento: "Utiles escolares", nombre: "Lapices y plumas" },
    { departamento: "Utiles escolares", nombre: "Colores y crayones" },
    { departamento: "Utiles escolares", nombre: "Mochilas y loncheras" },
    { departamento: "Utiles escolares", nombre: "Reglas y geometria" },
    { departamento: "Utiles escolares", nombre: "Correctores y borradores" },

    { departamento: "Oficina", nombre: "Carpetas y archivo" },
    { departamento: "Oficina", nombre: "Grapas y clips" },
    { departamento: "Oficina", nombre: "Cinta adhesiva" },
    { departamento: "Oficina", nombre: "Calculadoras" },
    { departamento: "Oficina", nombre: "Post-its y notas" },

    { departamento: "Arte y manualidades", nombre: "Pinturas y acuarelas" },
    { departamento: "Arte y manualidades", nombre: "Pinceles" },
    { departamento: "Arte y manualidades", nombre: "Papel para manualidades" },
    { departamento: "Arte y manualidades", nombre: "Pegamento y silicon" },

    { departamento: "Impresion y copiado", nombre: "Papel para impresora" },
    { departamento: "Impresion y copiado", nombre: "Toner y tinta" },
    { departamento: "Impresion y copiado", nombre: "Servicio de copias" },
    { departamento: "Impresion y copiado", nombre: "Servicio de impresion" },

    { departamento: "Empastado y acabados", nombre: "Engargolado" },
    { departamento: "Empastado y acabados", nombre: "Plastificado" },
    { departamento: "Empastado y acabados", nombre: "Encuadernado" },

    { departamento: "Tecnologia y computo", nombre: "USB y memorias" },
    { departamento: "Tecnologia y computo", nombre: "Audifonos" },
    { departamento: "Tecnologia y computo", nombre: "Accesorios de computo" },

    { departamento: "Papeleria general", nombre: "Otros / sin categoria clara" }
];

const CATEGORIAS_POR_GIRO = {
    ferreteria: CATEGORIAS_NEXO,
    abarrotes: CATEGORIAS_NEXO_ABARROTES,
    papeleria: CATEGORIAS_NEXO_PAPELERIA
};

module.exports = { CATEGORIAS_NEXO, CATEGORIAS_NEXO_ABARROTES, CATEGORIAS_NEXO_PAPELERIA, CATEGORIAS_POR_GIRO };
