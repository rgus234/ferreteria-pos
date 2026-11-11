// Directorio de MARCAS de abarrotes de Mexico (lo que el cliente conoce: Sabritas, Coca-Cola, Danone...), con la EMPRESA a la que pertenece cada una.
// El dueño ve la marca (una tarjeta); la empresa queda por dentro para pedidos y proveedores (una marca puede tener varios distribuidores).
// Formato: [nombre, tipo, color, empresa, [palabras con las que se reconoce un producto, sin acentos y en minuscula]].
// La empresa va vacia ("") cuando no estamos seguros: mejor sin dato que un dato falso. Las palabras son COMPLETAS (no se buscan dentro de otra palabra).
// Colores permitidos (los de los exhibidores): rojo, azul, naranja, morado, verde, negro.
// Este directorio es solo de abarrotes; no toca las marcas de ferreteria.

// Tipo y empresa de las 19 marcas que ya existian en marcas-catalogo.js.
const DATOS_BASE = {
    "sabritas": { tipo: "Botanas", empresa: "PepsiCo" },
    "coca-cola": { tipo: "Refrescos", empresa: "Coca-Cola" },
    "pepsi": { tipo: "Refrescos", empresa: "PepsiCo" },
    "gamesa": { tipo: "Galletas y pan", empresa: "PepsiCo" },
    "bimbo": { tipo: "Galletas y pan", empresa: "Grupo Bimbo" },
    "marinela": { tipo: "Galletas y pan", empresa: "Grupo Bimbo" },
    "nestle": { tipo: "Despensa", empresa: "Nestlé" },
    "arizona": { tipo: "Jugos y energía", empresa: "Arizona Beverages" },
    "bonafont": { tipo: "Aguas", empresa: "Danone" },
    "dr-pepper": { tipo: "Refrescos", empresa: "Keurig Dr Pepper" },
    "jarritos": { tipo: "Refrescos", empresa: "Jarritos" },
    "monster": { tipo: "Jugos y energía", empresa: "Monster Beverage" },
    "penafiel": { tipo: "Aguas", empresa: "Keurig Dr Pepper" },
    "volt": { tipo: "Jugos y energía", empresa: "AJE Group" },
    "v8": { tipo: "Jugos y energía", empresa: "Campbell's" },
    "barcel": { tipo: "Botanas", empresa: "Grupo Bimbo" },
    "ricolino": { tipo: "Dulces y chicles", empresa: "Mondelez" },
    "lala": { tipo: "Lácteos", empresa: "Grupo Lala" },
    "jumex": { tipo: "Jugos y energía", empresa: "Grupo Jumex" }
};

// Productos que a veces se escriben distinto: se suman a las palabras de una marca que ya existia.
const PALABRAS_EXTRA = {
    "coca-cola": ["fuzetea", "delaware punch"],
    "nestle": ["carlos v", "nido", "chocapic", "dolca", "coffee mate", "crosse"],
    "lala": ["chocolala"],
    "sabritas": ["rancheritos"],
};

const NUEVAS = [
    // Botanas y cereales
    ["Pringles", "Botanas", "rojo", "Kellanova", ["pringles"]],
    ["ACT II", "Botanas", "naranja", "Conagra", ["act ii", "act 2"]],
    ["Tajín", "Salsas y condimentos", "rojo", "Tajín International", ["tajin"]],
    ["Quaker", "Cereales y avena", "rojo", "PepsiCo", ["quaker"]],
    ["Kellogg's", "Cereales y avena", "rojo", "Kellanova", ["kellogg", "kelloggs", "zucaritas", "choco krispis", "corn flakes", "froot loops", "special k"]],

    // Galletas y pan
    ["Lara", "Galletas y pan", "rojo", "", ["lara"]],
    ["Tía Rosa", "Galletas y pan", "rojo", "Grupo Bimbo", ["tia rosa"]],
    ["Wonder", "Galletas y pan", "azul", "Grupo Bimbo", ["wonder"]],
    ["Oreo", "Galletas y pan", "azul", "Mondelez", ["oreo"]],
    ["Ritz", "Galletas y pan", "rojo", "Mondelez", ["ritz"]],
    ["Chips Ahoy", "Galletas y pan", "azul", "Mondelez", ["chips ahoy"]],

    // Lácteos y embutidos
    ["Danone", "Lácteos", "azul", "Danone", ["danone", "activia", "danonino", "danup", "dany", "danette", "oikos", "danissimo"]],
    ["Yoplait", "Lácteos", "rojo", "Sigma Alimentos (licencia en México)", ["yoplait"]],
    ["Alpura", "Lácteos", "verde", "Alpura", ["alpura"]],
    ["Santa Clara", "Lácteos", "rojo", "Santa Clara", ["santa clara"]],
    ["Philadelphia", "Lácteos", "azul", "Mondelez", ["philadelphia"]],
    ["Yakult", "Lácteos", "rojo", "Yakult", ["yakult"]],
    ["San Rafael", "Embutidos", "azul", "Sigma Alimentos", ["san rafael"]],
    ["Fud", "Embutidos", "rojo", "Sigma Alimentos", ["fud"]],
    ["Chambourcy", "Lácteos", "azul", "Nestlé", ["chambourcy"]],
    ["Holanda", "Helados", "rojo", "Unilever", ["holanda", "cornetto", "magnum", "solero", "cremissimo"]],

    // Bebidas
    ["Electrolit", "Aguas", "azul", "Grupo PiSA", ["electrolit"]],
    ["Red Bull", "Jugos y energía", "azul", "Red Bull", ["red bull"]],
    ["Amper", "Jugos y energía", "rojo", "", ["amper"]],
    ["Boing", "Jugos y energía", "naranja", "Cooperativa Pascual", ["boing"]],
    ["Corona", "Cervezas", "naranja", "Grupo Modelo", ["corona", "coronita"]],
    ["Modelo", "Cervezas", "azul", "Grupo Modelo", ["modelo"]],
    ["Victoria", "Cervezas", "rojo", "Grupo Modelo", ["victoria"]],
    ["Pacífico", "Cervezas", "azul", "Grupo Modelo", ["pacifico"]],
    ["Tecate", "Cervezas", "rojo", "Heineken México", ["tecate"]],
    ["Sol", "Cervezas", "naranja", "Heineken México", ["cerveza sol"]],
    ["Dos Equis", "Cervezas", "verde", "Heineken México", ["dos equis", "xx lager"]],
    ["Indio", "Cervezas", "rojo", "Heineken México", ["indio"]],
    ["Carta Blanca", "Cervezas", "azul", "Heineken México", ["carta blanca"]],
    ["Bohemia", "Cervezas", "naranja", "Heineken México", ["bohemia"]],
    ["Heineken", "Cervezas", "verde", "Heineken", ["heineken"]],

    // Dulces y chocolates
    ["Halls", "Dulces y chicles", "azul", "Mondelez", ["halls"]],
    ["Trident", "Dulces y chicles", "azul", "Mondelez", ["trident"]],
    ["Chiclets", "Dulces y chicles", "rojo", "Mondelez", ["chiclets"]],
    ["Canels", "Dulces y chicles", "rojo", "", ["canels"]],
    ["Bubbaloo", "Dulces y chicles", "rojo", "Mondelez", ["bubbaloo"]],
    ["Orbit", "Dulces y chicles", "azul", "Mars Wrigley", ["orbit"]],
    ["M&M's", "Dulces y chicles", "azul", "Mars", ["m&m's", "m&ms", "mym", "myms"]],
    ["Snickers", "Dulces y chicles", "azul", "Mars", ["snickers"]],
    ["Milky Way", "Dulces y chicles", "azul", "Mars", ["milky way", "milkyway"]],
    ["Skittles", "Dulces y chicles", "rojo", "Mars Wrigley", ["skittles"]],
    ["Twix", "Dulces y chicles", "naranja", "Mars", ["twix"]],
    ["Kinder", "Dulces y chicles", "rojo", "Ferrero", ["kinder"]],
    ["Ferrero Rocher", "Dulces y chicles", "naranja", "Ferrero", ["ferrero"]],
    ["Tic Tac", "Dulces y chicles", "rojo", "Ferrero", ["tic tac"]],
    ["Nutella", "Despensa", "rojo", "Ferrero", ["nutella"]],
    ["Hershey's", "Dulces y chicles", "naranja", "Hershey", ["hershey", "hersheys", "kisses"]],
    ["De la Rosa", "Dulces y chicles", "rojo", "De la Rosa", ["de la rosa", "mazapan", "pulparindo"]],
    ["Vero", "Dulces y chicles", "rojo", "Mondelez", ["vero"]],
    ["Pelón Pelo Rico", "Dulces y chicles", "rojo", "Hershey", ["pelon pelo rico", "pelon"]],
    ["Mentos", "Dulces y chicles", "azul", "Perfetti Van Melle", ["mentos"]],
    ["Chupa Chups", "Dulces y chicles", "rojo", "Perfetti Van Melle", ["chupa chups"]],

    // Despensa, enlatados y salsas
    ["La Costeña", "Enlatados y salsas", "rojo", "Conservas La Costeña", ["la costena", "costena"]],
    ["Herdez", "Enlatados y salsas", "rojo", "Grupo Herdez", ["herdez", "del fuerte"]],
    ["Clemente Jacques", "Enlatados y salsas", "rojo", "Clemente Jacques", ["clemente jacques", "clemente jaques"]],
    ["Del Monte", "Enlatados y salsas", "rojo", "Del Monte", ["del monte"]],
    ["Dolores", "Enlatados y salsas", "azul", "Grupo Pinsa", ["dolores"]],
    ["Tuny", "Enlatados y salsas", "azul", "Grupomar", ["tuny"]],
    ["McCormick", "Salsas y condimentos", "rojo", "McCormick", ["mccormick", "mccormic"]],
    ["Valentina", "Salsas y condimentos", "naranja", "", ["valentina"]],
    ["Cholula", "Salsas y condimentos", "rojo", "McCormick", ["cholula"]],
    ["Heinz", "Salsas y condimentos", "rojo", "Kraft Heinz", ["heinz"]],
    ["Hellmann's", "Salsas y condimentos", "azul", "Unilever", ["hellmanns", "hellmann"]],
    ["Knorr", "Salsas y condimentos", "verde", "Unilever", ["knorr"]],
    ["Maggi", "Salsas y condimentos", "rojo", "Nestlé", ["maggi"]],
    ["Maruchan", "Despensa", "rojo", "Maruchan", ["maruchan"]],
    ["Nissin", "Despensa", "rojo", "Nissin", ["nissin"]],
    ["La Moderna", "Despensa", "rojo", "Grupo La Moderna", ["la moderna"]],
    ["Aceite 1-2-3", "Despensa", "naranja", "", ["1-2-3", "123"]],
    ["Nutrioli", "Despensa", "verde", "Ragasa", ["nutrioli"]],
    ["Capullo", "Despensa", "rojo", "", ["capullo"]],
    ["Zulka", "Despensa", "azul", "Zulka", ["zulka"]],
    ["Maizena", "Despensa", "azul", "Unilever", ["maizena"]],
    ["Abuelita", "Despensa", "rojo", "Nestlé", ["abuelita"]],
    ["Ibarra", "Despensa", "rojo", "", ["ibarra"]],
    ["Verde Valle", "Despensa", "verde", "", ["verde valle"]],
    ["Charras", "Botanas", "naranja", "", ["charras"]],
    ["Julitas", "Dulces y chicles", "rojo", "", ["julitas"]],
    ["Gerber", "Bebé", "verde", "Nestlé", ["gerber"]],

    // Limpieza del hogar
    ["Cloralex", "Limpieza", "azul", "Clorox", ["cloralex"]],
    ["Pinol", "Limpieza", "verde", "Grupo AlEn", ["pinol"]],
    ["Fabuloso", "Limpieza", "verde", "Colgate-Palmolive", ["fabuloso"]],
    ["Ajax", "Limpieza", "azul", "Colgate-Palmolive", ["ajax"]],
    ["Axión", "Limpieza", "verde", "Colgate-Palmolive", ["axion"]],
    ["Suavitel", "Limpieza", "morado", "Colgate-Palmolive", ["suavitel"]],
    ["Salvo", "Limpieza", "verde", "Procter & Gamble", ["salvo"]],
    ["Ariel", "Limpieza", "azul", "Procter & Gamble", ["ariel"]],
    ["Downy", "Limpieza", "azul", "Procter & Gamble", ["downy"]],
    ["Tide", "Limpieza", "naranja", "Procter & Gamble", ["tide"]],
    ["Vel Rosita", "Limpieza", "rojo", "", ["vel rosita"]],
    ["Persil", "Limpieza", "azul", "Henkel", ["persil"]],
    ["Mr. Músculo", "Limpieza", "naranja", "SC Johnson", ["mr musculo", "mr. musculo"]],
    ["Glade", "Limpieza", "azul", "SC Johnson", ["glade"]],
    ["Raid", "Limpieza", "rojo", "SC Johnson", ["raid"]],
    ["Pato", "Limpieza", "azul", "SC Johnson", ["pato purific", "pato"]],
    ["Blumen", "Limpieza", "azul", "", ["blumen"]],
    ["Lysol", "Limpieza", "azul", "Reckitt", ["lysol"]],
    ["Cif", "Limpieza", "naranja", "Unilever", ["cif"]],
    ["Regio", "Papel y pañales", "azul", "Kimberly-Clark", ["regio"]],
    ["Kleenex", "Papel y pañales", "azul", "Kimberly-Clark", ["kleenex"]],
    ["Scott", "Papel y pañales", "rojo", "Kimberly-Clark", ["scott"]],
    ["Huggies", "Papel y pañales", "azul", "Kimberly-Clark", ["huggies"]],
    ["Kotex", "Higiene personal", "morado", "Kimberly-Clark", ["kotex"]],
    ["Pampers", "Papel y pañales", "azul", "Procter & Gamble", ["pampers"]],

    // Higiene personal
    ["Colgate", "Higiene personal", "rojo", "Colgate-Palmolive", ["colgate"]],
    ["Palmolive", "Higiene personal", "verde", "Colgate-Palmolive", ["palmolive"]],
    ["Protex", "Higiene personal", "rojo", "Colgate-Palmolive", ["protex"]],
    ["Dove", "Higiene personal", "azul", "Unilever", ["dove"]],
    ["Rexona", "Higiene personal", "azul", "Unilever", ["rexona"]],
    ["Sedal", "Higiene personal", "morado", "Unilever", ["sedal"]],
    ["Axe", "Higiene personal", "negro", "Unilever", ["axe"]],
    ["Head & Shoulders", "Higiene personal", "azul", "Procter & Gamble", ["head shoulders", "head & shoulders"]],
    ["Pantene", "Higiene personal", "naranja", "Procter & Gamble", ["pantene"]],
    ["Gillette", "Higiene personal", "azul", "Procter & Gamble", ["gillette"]],
    ["Always", "Higiene personal", "morado", "Procter & Gamble", ["always"]],
    ["Old Spice", "Higiene personal", "rojo", "Procter & Gamble", ["old spice"]],
    ["Vicks", "Higiene personal", "azul", "Procter & Gamble", ["vicks"]],

    // Mascotas
    ["Pedigree", "Mascotas", "naranja", "Mars", ["pedigree"]],
    ["Whiskas", "Mascotas", "morado", "Mars", ["whiskas"]],
    ["Purina", "Mascotas", "rojo", "Nestlé", ["purina", "dog chow", "cat chow"]]
];

// Marcas cuya empresa se confirmo en la web (prensa y registros de marca) el 2026-11-10. Las demas vienen de conocimiento general y estan por verificar:
// la lista se va ampliando conforme se confirman. Ojo con los cambios de dueño (Ricolino y Vero pasaron de Bimbo a Mondelez en 2022).
const VERIFICADAS_EN = "2026-11-10";
const VERIFICADAS = new Set(["ricolino", "vero", "pelon-pelo-rico", "nutrioli", "boing", "tuny", "dolores", "volt", "electrolit", "salvo", "hershey-s"]);

const quitarAcentos = t => String(t).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const idDe = nombre => quitarAcentos(nombre).replace(/&/g, "y").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

const MARCAS_NUEVAS = NUEVAS.map(([nombre, tipo, color, empresa, palabras]) => ({ id: idDe(nombre), nombre, tipo, color, empresa, palabras }));

module.exports = { VERIFICADAS, VERIFICADAS_EN, DATOS_BASE, PALABRAS_EXTRA, MARCAS_NUEVAS, idDe };
