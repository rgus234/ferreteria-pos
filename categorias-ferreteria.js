// Arbol de categorias de Nexo para ferreteria/tlapaleria (3 niveles: departamento > categoria > subcategoria)
// y su clasificador por reglas de nombre. Salio de leer el catalogo Truper (15,745 productos) y se probo con
// Urrea. Gratis y siempre da el mismo resultado: si ninguna regla aplica devuelve null (nunca adivina; ahi
// entra la IA). Las filas viven en categorias_nexo con giro "ferreteria_v2" (el arbol anterior, giro
// "ferreteria", sigue intacto para los productos que ya lo usan).
const H = "Herramienta manual", E = "Herramienta electrica y neumatica", A = "Abrasivos y corte", EL = "Electrico", P = "Plomeria", C = "Cerrajeria y herrajes",
  T = "Tornilleria y fijacion", CO = "Construccion", PI = "Pintura y acabados", AD = "Adhesivos y selladores", J = "Jardin y exteriores", S = "Seguridad industrial (EPP)",
  RO = "Ropa de trabajo", HO = "Hogar y limpieza", AU = "Automotriz y lubricantes", G = "Gas y calefaccion", CU = "Cuerdas, cadenas y sujecion", RE = "Refacciones y repuestos", EX = "Exhibidores y muebles";

// Ajustes de nombres de mostrador (Olimpico): nombres cortos o con otra palabra que las reglas de R confundian. Se prueban primero y sobre el nombre completo.
const AJ = [
  [T, "Tornillos", "Pijas", /\bpijas?\b/],
  [AU, "Lubricantes y fluidos", "Aceites y grasas", /\b(aceite|lubr[iu]cante)\b.*\b(2 tiempos|3 en 1|3en 1|cadenas?)\b|\b3 ?en ?1\b/],
  [AD, "Pegamentos y cintas", "Pegamentos", /\bcemento\b.*\b(pvc|cpvc)\b/],
  [A, "Lijas y abrasivos", "Piedras y cepillos de alambre", /\bcepillo\b.*\balambre\b/],
  [P, "Conexiones y tuberia", "Coladeras, cespoles y sifones", /\b(contra ?canasta|comtra canasta)\b/],
  [H, "Pinzas y cortadores", "Cortadores y tijeras", /\bcortador(a)? de tubo\b/],
  [H, "Pinzas y cortadores", "Pinzas", /\bpinzas?\b/],
  [J, "Herramienta de jardin", "Rastrillos y azadones", /\bcoa\b/],
  [P, "Conexiones y tuberia", "Niples", /\bniple\b/],
  [P, "Conexiones y tuberia", "Adaptadores", /\bmulti conector\b|\bconector(es)?\b.*\b(cobre|laton|flare|pealpe|rapidos?|click)\b/],
  [P, "Tinacos y calentadores", "Tinacos y tanques", /\bfiltro para agua\b/],
  [P, "Sanitarios", "Sanitarios y repuestos", /\b(empaque|tornillo|tornillos)\b.*\b(taza|tazs)\b|\btarja\b/],
  [HO, "Limpieza", "Productos de limpieza", /\bdestapacanos\b/],
  [P, "Valvulas", "Valvulas de paso y compuerta", /\bllave (angular|nariz|de esfera|de paso|paso)/],
  [P, "Grifos y mezcladoras", "Mezcladoras de fregadero", /\bmezcladora\b.*\bfregadero\b/],
  [C, "Bisagras y herrajes", "Ganchos y tensores", /\bresorte\b.*\bpuerta\b/],
  [C, "Bisagras y herrajes", "Mensulas y soportes", /\btubo\b.*\b(closet|cortinero)\b|\bcortinero\b/],
  [P, "Conexiones y tuberia", "Tubos", /\btubo\b.*\bcobre\b/],
  [CU, "Cinchos y flejes", "Mallas y sombra", /\b(mala|malla) (sombra|verde)\b/],
];

const R = [
  // ---- Refacciones y exhibidores (primero: "empaque de repuesto" no es el producto en si)
  [RE, "Refacciones de herramienta", "Empaques y sellos", /\b(empaques?|sellos?|oring|o-ring)\b.*\b(repuesto|para)\b|\bempaque de repuesto\b|\bcaja de empaque\b/],
  [RE, "Refacciones de herramienta", "Carbones", /\bcarbon(es)?\b/],
  [RE, "Refacciones de herramienta", "Interruptores de repuesto", /\binterruptor de repuesto\b|\binterruptor para (taladro|esmeriladora|rotomartillo|sierra|lijadora|cepillo)/],
  [RE, "Refacciones de herramienta", "Mangos, manerales y barras", /\b(mango|maneral|barra|manija)\b.*\brepuesto\b|\brepuesto\b.*\b(mango|maneral|barra)\b|\bmango de reposicion\b/],
  [RE, "Refacciones de herramienta", "Cuchillas, cadenas y bandas", /\b(cuchillas?|cadena|banda|hoja|cubierta|carda)\b.*\b(repuesto|para)\b|\brepuesto (de|para) (cuchilla|cadena|banda)/],
  [RE, "Refacciones de herramienta", "Carretes y cabezales", /\b(carrete|cabezal|retenedor de carrete|nylon para)\b/],
  [RE, "Refacciones de herramienta", "Carburadores y motor", /\b(carburador|bujia|arrancador|filtro de aire|mantenimiento para carburador)\b/],
  [RE, "Refacciones de herramienta", "Para compresor, aspiradora y bomba", /\b(para|de) (compresor|aspiradora|bomba|hidrolavadora|sopladora)\b|\bruedas?\b.*compresor/],
  [RE, "Refacciones de herramienta", "Otras refacciones", /\b(repuesto|repuestos|refaccion|refacciones|reposicion|cartucho de repuesto|vaso (aluminio|plastico))\b/],
  [EX, "Exhibidores", "Respaldos de inventario", /\brespaldo( de)? inventario\b|\brespaldo\b/],
  [EX, "Exhibidores", "Exhibidores con producto", /\b(exhibidor|display|mueble exhibidor)\b/],
  [EX, "Exhibidores", "Racks y gondolas", /\b(rack|gondola|estante|panel ranurado|estructura para exhibir)\b/],

  // ---- Seguridad industrial / ropa
  [S, "Guantes", "Guantes de trabajo", /\bguantes?\b/],
  [S, "Proteccion visual", "Lentes y goggles", /\b(lentes|goggles|gafas)\b/],
  [S, "Proteccion visual", "Caretas", /\b(careta|protector facial|pantalla facial)\b/],
  [S, "Proteccion de cabeza", "Cascos", /\b(casco|gorra de seguridad)\b/],
  [S, "Proteccion respiratoria y auditiva", "Respiradores y cubrebocas", /\b(respirador|cubrebocas|mascarilla|filtro para respirador)\b/],
  [S, "Proteccion respiratoria y auditiva", "Proteccion auditiva", /\b(tapones? auditiv|orejeras|auditiv)/],
  [S, "Proteccion contra caidas", "Arneses y eslingas", /\b(arnes|eslinga|linea de vida|cinturon de seguridad)\b/],
  [S, "Senalizacion y emergencia", "Cintas y senales", /\b(cinta delimitadora|senal|letrero|cono|barrera)\b/],
  [S, "Senalizacion y emergencia", "Extintores y botiquines", /\b(extintor|botiquin|lava ?ojos)\b/],
  [RO, "Ropa de trabajo", "Playeras y camisas", /\b(playera|camisa|camiseta|polo)\b/],
  [RO, "Ropa de trabajo", "Chalecos y chamarras", /\b(chaleco|chamarra|sudadera|abrigo)\b/],
  [RO, "Ropa de trabajo", "Overoles y pantalones", /\b(overol|pantalon|mono de trabajo|bermuda)\b/],
  [RO, "Ropa de trabajo", "Impermeables y capas", /\b(impermeable|capa|poncho)\b/],
  [RO, "Calzado y accesorios", "Botas y zapatos", /\b(bota|botas|zapato|calzado)\b/],
  [RO, "Calzado y accesorios", "Rodilleras, fajas y mandiles", /\b(rodillera|faja|mandil|gorra|cinturon|tirantes)\b/],

  // ---- Herramienta electrica y neumatica
  [E, "Taladros y rotomartillos", "Taladros", /\btaladro\b/],
  [E, "Taladros y rotomartillos", "Rotomartillos y demoledores", /\b(rotomartillo|demoledor|martillo (demoledor|perforador|electrico))\b/],
  [E, "Taladros y rotomartillos", "Atornilladores electricos", /\b(atornillador|llave de impacto electrica|desarmador electrico)\b/],
  [E, "Esmeriladoras y pulidoras", "Esmeriladoras", /\b(esmeriladora|esmeril)\b/],
  [E, "Esmeriladoras y pulidoras", "Pulidoras y lijadoras", /\b(pulidora|lijadora|rebajadora|router|cepillo electrico)\b/],
  [E, "Sierras electricas", "Sierras y caladoras", /\b(sierra (circular|caladora|sable|ingletadora|de banco|cinta)|caladora|ingletadora)\b/],
  [E, "Sierras electricas", "Motosierras", /\bmotosierra\b/],
  [E, "Neumatica y compresores", "Compresores", /\bcompresor\b/],
  [E, "Neumatica y compresores", "Pistolas neumaticas y grapadoras", /\b(pistola de impacto|neumatic|aerografo|grapadora|clavadora|pistola para (aire|inflar))\b/],
  [E, "Limpieza a presion", "Hidrolavadoras", /\bhidrolavadora\b/],
  [E, "Limpieza a presion", "Aspiradoras y sopladoras", /\b(aspiradora|sopladora|aspirasopladora)\b/],
  [E, "Soldadura", "Soldadoras y electrodos", /\b(soldadora|electrodo|soldadura|careta para soldar|soldar)\b/],
  [E, "Soldadura", "Cautines y pistolas de calor", /\b(cautin|pistola de calor|soplete)\b/],
  [E, "Bombas y motores", "Bombas de agua", /\bbomba\b/],
  [E, "Bombas y motores", "Motores y generadores", /\b(motor|generador|motobomba|motocultor)\b/],
  [E, "Maquinas de jardin", "Podadoras y desbrozadoras", /\b(podadora|desbrozadora|cortacesped|cortasetos|orilladora)\b/],
  [E, "Maquinas de jardin", "Cortadoras y fumigadoras", /\b(cortadora|fumigador|aspersora)\b/],

  // ---- Abrasivos y corte
  [A, "Brocas", "Brocas para metal", /\bbrocas? (para|de) (metal|acero|hss)|\bbroca.*(hss|titanio)\b/],
  [A, "Brocas", "Brocas para concreto y SDS", /\bbrocas? .*(concreto|sds|muro|mamposteria)|\bbroca.*(concreto|sds)\b/],
  [A, "Brocas", "Brocas para madera y plano", /\bbrocas? .*(madera|plana|forstner|pala)|\bbroca de pala\b/],
  [A, "Brocas", "Brocasierras y sierras copa", /\b(brocasierra|brocasierras|sierra copa)\b/],
  [A, "Brocas", "Juegos y otras brocas", /\bbrocas?\b/],
  [A, "Discos", "Discos de corte", /\bdisco\b.*\b(corte|cortar|diamante|segmentado)\b|\bdisco de corte\b/],
  [A, "Discos", "Discos de desbaste y copa", /\bdisco\b.*\b(desbaste|copa|flap|lija|pulir)\b|\bdisco\b.*\b(acero|metal)\b/],
  [A, "Discos", "Otros discos", /\bdisco\b/],
  [A, "Lijas y abrasivos", "Lijas", /\b(lija|lijas|pliego de lija)\b/],
  [A, "Lijas y abrasivos", "Piedras y cepillos de alambre", /\b(piedra de afilar|afilador|cepillo de alambre|carda|cepillo circular)\b/],
  [A, "Seguetas y hojas", "Seguetas y hojas de sierra", /\b(segueta|hoja de sierra|hoja para sierra|arco para segueta|hoja para caladora)\b/],

  // ---- Herramienta manual
  [H, "Dados y matracas", "Dados", /\bdados?\b/],
  [H, "Dados y matracas", "Matracas y mangos", /\b(matraca|maneral articulado|extension para dado|adaptador para dado)\b/],
  [H, "Llaves", "Llaves combinadas", /\bllaves? (combinada|mixta|de combinacion)/],
  [H, "Llaves", "Llaves ajustables", /\bllaves? (ajustable|perica|perico)|\bperico\b/],
  [H, "Llaves", "Llaves Allen y Torx", /\bllaves? (allen|hexagonal|torx|l\b)|\bjuego de llaves (allen|torx|hexagonales)/],
  [H, "Llaves", "Llaves stilson y de tubo", /\bllaves? (stillson|stilson|de tubo|para tubo|de cadena|de cinta)\b/],
  [H, "Llaves", "Llaves espanolas y estrias", /\bllaves? (espanola|de estrias|estriada|de golpe|de tuercas)\b/],
  [H, "Desarmadores y puntas", "Desarmadores", /\b(desarmador|destornillador|desarmadores)\b/],
  [H, "Desarmadores y puntas", "Puntas y juegos", /\b(puntas?|bit|bits)\b/],
  [H, "Pinzas y cortadores", "Pinzas", /\b(pinza|pinzas|alicate|tenaza|pelacable|peladora)\b/],
  [H, "Pinzas y cortadores", "Cortadores y tijeras", /\b(cortador|cortafrio|cortapernos|corta ?pernos|tijera|tijeras|cutter|navaja|cuchillo|cuchilla)\b/],
  [H, "Martillos y mazos", "Martillos", /\bmartillo\b/],
  [H, "Martillos y mazos", "Mazos, marros y cunas", /\b(mazo|marro|marra|cuna|maceta)\b/],
  [H, "Martillos y mazos", "Picos, hachas y barretas", /\b(talacho|pico|hacha|zapapico|barreta|hachuela|piqueta)\b/],
  [H, "Limas y cinceles", "Limas y escofinas", /\b(lima|limas|escofina)\b/],
  [H, "Limas y cinceles", "Cinceles, formones y punzones", /\b(cincel|formon|gubia|punzon|cortafrio|cepillo de carpintero)\b/],
  [H, "Medicion y nivelacion", "Flexometros y cintas", /\b(flexometro|cinta metrica|cinta de medicion|odometro)\b/],
  [H, "Medicion y nivelacion", "Niveles y escuadras", /\b(nivel|escuadra|plomada|regla|trazador|gis)\b/],
  [H, "Medicion y nivelacion", "Basculas y medidores", /\b(bascula|vernier|calibrador|medidor|multimetro|detector|termometro|higrometro|dinamometro|probador)\b/],
  [H, "Cajas y organizadores", "Cajas de herramienta", /\b(caja (de|para) herramienta|cofre|maletin|maleta|cajonera|carro de herramienta|gabinete)\b/],
  [H, "Cajas y organizadores", "Organizadores y bolsas", /\b(organizador|bolsa (de|para) herramienta|cinturon porta|porta ?herramienta|estuche)\b/],
  [H, "Sujecion y extraccion", "Prensas y sargentos", /\b(prensa|sargento|tornillo de banco|mordaza)\b/],
  [H, "Sujecion y extraccion", "Extractores, gatos y poleas", /\b(extractor|gato|polea|malacate|diablo|diablito|polipasto|tecle)\b/],
  [H, "Lubricacion y pistolas", "Pistolas y engrasadoras", /\b(pistola|engrasadora|aceitera|bomba de engrase)\b/],
  [H, "Otras herramientas manuales", "Juegos de herramienta", /\b(juego de herramienta|juego de .* piezas|set de herramienta)\b/],

  // ---- Electrico
  [EL, "Cable y alambre", "Cable THW y de uso rudo", /\b(cable|cordon|alambre electrico)\b/],
  [EL, "Contactos y apagadores", "Placas", /\bplaca\b/],
  [EL, "Contactos y apagadores", "Apagadores e interruptores", /\b(apagador|interruptor|dimmer|sensor de movimiento|fotocelda)\b/],
  [EL, "Contactos y apagadores", "Contactos y clavijas", /\b(contacto|clavija|enchufe|portalampara|socket|adaptador (para )?(contacto|corriente))\b/],
  [EL, "Iluminacion", "Luminarios y plafones", /\b(luminario|luminaria|plafon|arbotante|candil|lampara de techo)\b/],
  [EL, "Iluminacion", "Reflectores", /\breflector\b/],
  [EL, "Iluminacion", "Focos y lamparas", /\b(foco|focos|lampara|lamparas|tubo (de )?led|tira led|panel led|pack de lamparas|luz)\b/],
  [EL, "Iluminacion", "Linternas y faroles", /\b(linterna|farol|lampara de mano|frontal)\b/],
  [EL, "Extensiones y multicontactos", "Extensiones", /\bextension\b/],
  [EL, "Extensiones y multicontactos", "Multicontactos y reguladores", /\b(multicontacto|regulador|no break|supresor|barra de contactos)\b/],
  [EL, "Extensiones y multicontactos", "Carretes", /\b(carrete|rollo de cable|enrollador)\b/],
  [EL, "Conexion y canalizacion", "Conectores y terminales", /\b(conector|terminal|empalme|cinta aislante|cinta de aislar|capuchon)\b/],
  [EL, "Conexion y canalizacion", "Canaletas y ductos", /\b(canaleta|ducto|conduit|tubo rigido|tubo flexible|condulet|chalupa|caja de registro|caja electrica)\b/],
  [EL, "Conexion y canalizacion", "Centros de carga y pastillas", /\b(centro de carga|pastilla|termomagnetico|interruptor de seguridad|tablero)\b/],
  [EL, "Timbres, pilas y cargadores", "Pilas y baterias", /\b(pila|pilas|bateria|baterias)\b/],
  [EL, "Timbres, pilas y cargadores", "Timbres y cargadores", /\b(timbre|cargador|adaptador de corriente|eliminador)\b/],
  [EL, "Redes y comunicaciones", "Cables y conectores de red", /\b(utp|rj45|rj11|coaxial|hdmi|cat6|cat5|usb|vga|rca)\b/],
  [EL, "Redes y comunicaciones", "Audio y antenas", /\b(antena|bocina|audifonos|microfono|audio)\b/],

  // ---- Plomeria
  [P, "Grifos y mezcladoras", "Mezcladoras de lavabo", /\bmezcladora\b.*\blavabo\b|\bmezcladora lavabo\b|\bmonomando\b.*\blavabo\b/],
  [P, "Grifos y mezcladoras", "Mezcladoras de fregadero", /\bmezcladora\b.*\b(fregadero|cocina)\b|\bmezcladora fregadero\b/],
  [P, "Grifos y mezcladoras", "Monomandos y mezcladoras de regadera", /\b(monomando|mezcladora)\b/],
  [P, "Grifos y mezcladoras", "Llaves de lavabo y jardin", /\b(llave de (lavabo|jardin|manguera|nariz|chorro)|llave p\/manguera|grifo)\b/],
  [P, "Regaderas y bano", "Regaderas", /\bregadera\b|\bbrazo y chapeton\b/],
  [P, "Regaderas y bano", "Accesorios de bano", /\b(toallero|jabonera|portarrollo|portavaso|portacepillos|accesorios? para bano|dispensador|barra de seguridad|perchero de bano|espejo de bano)\b/],
  [P, "Regaderas y bano", "Manerales y contras", /\b(maneral|manerales|contra para|contra p\/|jaladera y perilla)\b/],
  [P, "Valvulas", "Valvulas de paso y compuerta", /\b(valvula (de )?(paso|compuerta|esfera|globo|check|angular|de retencion)|llave de paso|llave angular)\b/],
  [P, "Valvulas", "Flotadores y valvulas de llenado", /\b(flotador|valvula de llenado|valvula de descarga|valvula para (tanque|wc|inodoro))\b/],
  [P, "Valvulas", "Otras valvulas", /\bvalvula\b/],
  [P, "Conexiones y tuberia", "Niples", /\bniple\b/],
  [P, "Conexiones y tuberia", "Codos", /\bcodo\b/],
  [P, "Conexiones y tuberia", "Tees y cruces", /\b(tee|cruz|yee)\b/],
  [P, "Conexiones y tuberia", "Reducciones y bushings", /\b(reduccion|bushing|buje)\b/],
  [P, "Conexiones y tuberia", "Coples y tuercas union", /\b(cople|coples|tuerca union|union universal|union)\b/],
  [P, "Conexiones y tuberia", "Adaptadores", /\badaptador\b/],
  [P, "Conexiones y tuberia", "Tapones y abrazaderas", /\b(tapon|abrazadera|abrazaderas|omega|soporte para tubo)\b/],
  [P, "Conexiones y tuberia", "Tubos", /\b(tubo|tuberia)\b/],
  [P, "Conexiones y tuberia", "Coladeras, cespoles y sifones", /\b(coladera|cespol|sifon|resumidero|contracanasta|rejilla)\b/],
  [P, "Conexiones y tuberia", "Juntas y sellos", /\b(junta|empaque para|sello para|cinta teflon|teflon)\b/],
  [P, "Mangueras y riego", "Mangueras", /\b(manguera|mangueras)\b/],
  [P, "Mangueras y riego", "Aspersores y conectores", /\b(aspersor|riego|regador|boquilla|lanza|conector para manguera|conector rapido|pistola de riego|toma)\b/],
  [P, "Tinacos y calentadores", "Tinacos y tanques", /\b(tinaco|tanque|cisterna|filtro de agua|tarja)\b/],
  [P, "Tinacos y calentadores", "Boilers y calentadores", /\b(boiler|calentador|calentador solar)\b/],
  [P, "Sanitarios", "Sanitarios y repuestos", /\b(sanitario|inodoro|wc|taza|asiento (para|de)|mingitorio|lavamanos|fluxometro)\b/],

  // ---- Cerrajeria y herrajes
  [C, "Candados", "Candados", /\bcandados?\b/],
  [C, "Chapas y cerraduras", "Cerraduras de puerta", /\b(cerradura|chapa|cerrojo|picaporte|llavin|pasador de seguridad)\b/],
  [C, "Chapas y cerraduras", "Manijas y perillas", /\b(manija|perilla|jaladera|tirador|maneral de puerta)\b/],
  [C, "Chapas y cerraduras", "Cierrapuertas y fijapuertas", /\b(cierrapuertas|fijapuerta|tope|aldaba|pasador|barra antipanico|mirilla)\b/],
  [C, "Bisagras y herrajes", "Bisagras", /\b(bisagra|bisagras)\b/],
  [C, "Bisagras y herrajes", "Mensulas y soportes", /\b(mensula|soporte|escuadra para|riel|correderas?|guia telescopica|ruedas? para (puerta|mueble))\b/],
  [C, "Bisagras y herrajes", "Ganchos y tensores", /\b(gancho|ganchos|tensor|argolla|armella|alcayata|cancamo)\b/],

  // ---- Tornilleria y fijacion
  [T, "Tornillos", "Pijas", /\bpijas?\b/],
  [T, "Tornillos", "Tornillos", /\b(tornillo|tornillos|birlo|espirrago|perno|pernos)\b/],
  [T, "Tuercas y rondanas", "Tuercas", /\b(tuerca|tuercas)\b/],
  [T, "Tuercas y rondanas", "Rondanas y arandelas", /\b(rondana|rondanas|arandela|arandelas)\b/],
  [T, "Fijacion", "Taquetes y anclas", /\b(taquete|taquetes|ancla|anclas|expansor)\b/],
  [T, "Fijacion", "Clavos y grapas", /\b(clavo|clavos|grapa|grapas|alfilerillo)\b/],
  [T, "Fijacion", "Remaches", /\b(remache|remaches)\b/],

  // ---- Construccion
  [CO, "Albanileria", "Cucharas, llanas y espatulas", /\b(cuchara para albanil|cuchara|llana|espatula|paleta|badilejo|flota|plana|cernidor)\b/],
  [CO, "Albanileria", "Palas y picos", /\b(pala|palas|bieldo|azada)\b/],
  [CO, "Albanileria", "Carretillas", /\bcarretilla\b/],
  [CO, "Albanileria", "Cubetas y botes de albanil", /\b(cubeta|bote integral|bote de albanil|artesa|batea)\b/],
  [CO, "Materiales", "Cemento y mezclas", /\b(cemento|mortero|yeso|cal|pegazulejo|boquilla para)\b/],
  [CO, "Materiales", "Varilla, perfiles y malla", /\b(varilla|perfil|malla|alambron|angulo|solera|canal)\b/],
  [CO, "Escaleras y andamios", "Escaleras", /\b(escalera|escaleras)\b/],
  [CO, "Escaleras y andamios", "Andamios y plataformas", /\b(andamio|plataforma|tijera de pintor|banco metalico)\b/],
  [CO, "Lonas y plasticos", "Lonas y toldos", /\b(lona|lonas|toldo|plastico (para|de) (construccion|cubrir)|polietileno)\b/],

  // ---- Pintura
  [PI, "Pintura", "Pintura en aerosol", /\b(pintura en aerosol|aerosol)\b/],
  [PI, "Pintura", "Pintura y esmaltes", /\b(pintura|esmalte|barniz|laca|primario|sellador|tinte)\b/],
  [PI, "Pintura", "Thinner y solventes", /\b(thinner|solvente|aguarras|disolvente)\b/],
  [PI, "Aplicadores", "Brochas", /\b(brocha|brochas)\b/],
  [PI, "Aplicadores", "Rodillos y charolas", /\b(rodillo|rodillos|charola|felpa)\b/],
  [PI, "Aplicadores", "Pistolas y accesorios de pintura", /\b(pistola de pintura|compresor para pintar|cinta masking|masking|plastico protector)\b/],
  [PI, "Aplicadores", "Borlas y cepillos para pintar", /\b(borla|cepillo para pintar|extension para rodillo)\b/],

  // ---- Adhesivos
  [AD, "Silicones y selladores", "Silicones", /\bsilicon(e)?\b/],
  [AD, "Silicones y selladores", "Selladores y espumas", /\b(sellador|espuma|poliuretano|calafateo|cinta selladora)\b/],
  [AD, "Pegamentos y cintas", "Pegamentos", /\b(pegamento|adhesivo|resistol|epoxico|cianoacrilato|cemento de contacto)\b/],
  [AD, "Pegamentos y cintas", "Cintas adhesivas", /\b(cinta adhesiva|cinta doble|cinta canela|cinta de empaque|cinta transparente|cinta de ducto|cinta (americana|gris))\b/],

  // ---- Jardin y exteriores
  [J, "Herramienta de jardin", "Rastrillos y azadones", /\b(rastrillo|azadon|cultivador|trasplantador|desyerbador|hoz)\b/],
  [J, "Herramienta de jardin", "Tijeras y podaderas", /\b(tijera para (pasto|ramas|jardin|podar|setos)|podadera|serrucho de poda|tijera de jardin|cortasetos manual)\b/],
  [J, "Herramienta de jardin", "Machetes y guadanas", /\b(machete|guadana|hacha de jardin)\b/],
  [J, "Plantas y tierra", "Macetas y fertilizantes", /\b(maceta|macetas|fertilizante|tierra|semilla|sustrato|abono)\b/],
  [J, "Fumigacion y plagas", "Fumigadores y trampas", /\b(fumigador|aspersor de mochila|trampa|raticida|insecticida)\b/],

  // ---- Hogar y limpieza
  [HO, "Limpieza", "Escobas y cepillos", /\b(escoba|cepillo|recogedor|cepillo para)\b/],
  [HO, "Limpieza", "Trapeadores y jaladores", /\b(trapeador|mop|jalador|jerga|franela|cubeta de trapear|exprimidor)\b/],
  [HO, "Limpieza", "Productos de limpieza", /\b(cloro|desengrasante|limpiador|esponja|fibra|atomizador|bolsa para basura)\b/],
  [HO, "Organizacion del hogar", "Contenedores y botes", /\b(canasta|contenedor|bote de basura|cesto|hielera|termo|botella)\b/],
  [HO, "Organizacion del hogar", "Percheros y tendederos", /\b(perchero|percha|tendedero|gancho para ropa|tabla de planchar|estante)\b/],
  [HO, "Menaje y cocina", "Utensilios", /\b(olla|sarten|cuchillo de cocina|cuchara de cocina|tabla para picar|vaso|plato|taza de cocina)\b/],

  // ---- Automotriz
  [AU, "Lubricantes y fluidos", "Aceites y grasas", /\b(aceite|lubricante|grasa|wd)\b/],
  [AU, "Lubricantes y fluidos", "Anticongelantes y limpiadores", /\b(anticongelante|refrigerante|limpiador de (frenos|inyectores)|liquido de frenos)\b/],
  [AU, "Accesorios automotrices", "Accesorios y emergencia", /\b(pasa corriente|cables? para bateria|embudo|espejo convexo|llanta|camara|gato hidraulico|triangulo|cubre asiento|ventosa)\b/],

  // ---- Gas
  [G, "Gas", "Reguladores y mangueras de gas", /\b(regulador de gas|manguera para gas|conexion para gas|tanque de gas|cilindro)\b/],
  [G, "Cocina y calefaccion", "Estufas y parrillas", /\b(estufa|parrilla|anafre|quemador|asador)\b/],
  [G, "Cocina y calefaccion", "Campanas y calefactores", /\b(campana|calefactor|filtros? de aluminio para campana|ventilador|extractor de aire)\b/],

  // ---- Cuerdas, cadenas
  [CU, "Cuerdas y cordeles", "Cuerdas y cordeles", /\b(cuerda|cordel|soga|reata|mecate|piola|hilo|rafia|polipropileno)\b/],
  [CU, "Cadenas y cables de acero", "Cadenas", /\b(cadena|eslabon|grillete|destorcedor)\b/],
  [CU, "Cadenas y cables de acero", "Cables de acero", /\b(cable de acero|guaya|perro para cable|sujetacable)\b/],
  [CU, "Cinchos y flejes", "Cinchos y ligas", /\b(cincho|cinchos|liga|ligas|fleje|flejadora|banda elastica|pulpo)\b/],
  [CU, "Cinchos y flejes", "Mallas y sombra", /\b(malla|sombra|red)\b/],
  // ---- Comodines al final (solo si nada mas aplico)
  [H, "Sierras manuales", "Serruchos y sierras", /(serrucho|sierra|arco)/],
  [H, "Llaves", "Otras llaves", /llaves?/],
  [H, "Otras herramientas manuales", "Herramientas varias", /(herramienta|herramientas|raspador|peine|peines|anzuelo|anzuelos)/],
  [E, "Accesorios para herramienta electrica", "Portabrocas y collets", /(broquero|collet|portabrocas|mandril)/],
  [RE, "Refacciones de herramienta", "Mangos y ruedas de repuesto", /(mango|ruedas?|rodaja|piston|tapa)/],
  [EL, "Conexion y canalizacion", "Canaletas y ductos", /(poliducto|ducto)/],
  [CU, "Cuerdas y cordeles", "Alambres", /(alambre|bandola)/],
  [AD, "Pegamentos y cintas", "Cintas adhesivas", /cinta/],
];

const PAQUETE = /^(bolsa|juego|caja|blister|kit|rollo|kilo|metro|pieza|par|set|estuche|paquete|pack|cubeta|exhibidor de)\s+(con|de|c\/\d+|p\/|para)?\s*\d*\s*/;
const norm = s => String(s).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/['"°,;:()]/g, " ").replace(/\s+/g, " ").trim();

function clasificar(nombre) {
  const n = norm(nombre);
  for (const [dep, cat, sub, re] of AJ) if (re.test(n)) return { dep, cat, sub };
  const sin = n.replace(PAQUETE, "");
  const cabeza = sin.split(" ").slice(0, 4).join(" ");
  const singEs = t => t.split(" ").map(w => (w.length > 5 && /es$/.test(w) ? w.slice(0, -2) : w)).join(" ");
  const sing = t => t.split(" ").map(w => (w.length > 4 && /[^s]s$/.test(w) ? w.slice(0, -1) : w)).join(" ");
  for (const c of [cabeza, sing(cabeza), singEs(cabeza)]) for (const [dep, cat, sub, re] of R) if (re.test(c)) return { dep, cat, sub };
  for (const c of [sin, sing(sin), singEs(sin)]) for (const [dep, cat, sub, re] of R) if (re.test(c)) return { dep, cat, sub };
  return null;
}
// Arbol unico (departamento > categoria > subcategoria) en el orden en que aparece en las reglas.
const ARBOL = [];
const vistos = new Set();
for (const [departamento, categoria, nombre] of R) {
    const clave = [departamento, categoria, nombre].join("|");
    if (vistos.has(clave)) continue;
    vistos.add(clave);
    ARBOL.push({ departamento, categoria, nombre });
}

module.exports = { clasificar, ARBOL, GIRO_ARBOL: "ferreteria_v2" };


