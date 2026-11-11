// Categoria Nexo de un producto de abarrotes a partir de su nombre, por reglas de palabras: gratis, siempre igual y sin gastar un uso de IA.
// Lo usan: la sugerencia de categoria al agregar un producto (antes de pedirle nada a la IA), el alta de productos (para que nunca quede
// uno sin categoria) y el script que ordena el catalogo maestro. Las reglas se revisaron a mano contra los nombres reales del maestro.
// Solo para negocios cuyo giro es abarrotes (sin ferreteria): en un negocio con los dos giros, "aceite" o "mango" podrian ser de otra cosa.

const plano = texto => String(texto || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

// categorias_nexo.id del arbol de abarrotes
const C = { refrescos: 187, aguas: 188, jugos: 189, cafeTe: 190, alcohol: 191, energeticas: 192, leche: 193, yogurt: 194, papas: 198, galletas: 199, dulces: 200, chicles: 201, granos: 202, aceites: 204, condimentos: 205, enlatados: 206, panCaja: 208, panDulce: 209, tortillas: 210, trastes: 212, desinfectantes: 213, helados: 221, otros: 225 };

// El orden importa: la primera regla que coincide gana.
const REGLAS = [
    [/\b(modelo|victoria|corona|cerveza)\b/, C.alcohol],
    [/\b(monster|volt|red bull|amper|electrolit)\b/, C.energeticas],
    [/\b(magnum|cornetto|solero|cremissimo|choco crem|mordisko|helado)\b/, C.helados],
    [/\b(fuze tea|nescafe|coffee mate|choco-?milk)\b/, C.cafeTe],
    [/\b(abuelita|snickers|milkyway|m&m|kinder|carlos v|triki trakes|halls)\b/, C.dulces],
    [/\b(orbit|trident|canels)\b/, C.chicles],
    [/\b(chocoroles|pinguinos|rollo sabor)\b/, C.dulces],
    [/\b(sponch|principe|chokis|cremax|florentinas|barras de coco|multigrano|vuala|lara |gamesa|emperador|giro |marias|saladitas|doradas|fruts|arcoiris|crackets|ricanelas|chocolatines|flor de naranjo)\b/, C.galletas],
    [/\b(mantecadas|panque|little bites|julitas|tia rosa|croissant)\b/, C.panDulce],
    [/\bbimbo blanco\b/, C.panCaja],
    [/\b(charras tostada)\b/, C.tortillas],
    [/\b(sabritas|doritos|cheetos|ruffles|tostitos|takis|crujitos|pake ta[kx]o|runners|kiyakis|big mix|hot nuts|golden nuts|chipotles barcel|tostanachos|chips (jalapeno|sal|fuego))\b/, C.papas],
    [/\b(cloralex|fabuloso|ajax|mr musculo|glade|blumen|salvo multiusos)\b/, C.desinfectantes],
    [/\bsalvo lavatrastes\b/, C.trastes],
    [/\b(aceite)\b/, C.aceites],
    [/\bvinagre\b/, C.aceites],
    [/\b(arroz)\b/, C.granos],
    [/\b(catsup|aderezo|salsa inglesa|salsa picante|tajin|pica-?limon|cons-?mate|mccormick sal|la fina)\b/, C.condimentos],
    [/\b(kermato|ensalada de verduras|elotes|rajas de|jalapenos enteros|chipotle adobados|mermelada)\b/, C.enlatados],
    [/\b(danonino|yoplait|activia|danone|danup|oikos|danette|dany|natilla|yomi|yoghurt|yogurt|licuado|lala (fresa|durazno|pin)|lala fresa|lala yoghurt)\b/, C.yogurt],
    [/\b(lala (entera|deslactosada|fresca|proteina|cocoa)|leche|chocolala|cafe con lala)\b/, C.leche],
    [/\b(penafiel sabores|penafiel (twist|limonada|naranjada|manzanita)|jarrito|orange crush|fanta|pepsi|coca-?cola|sprite|fresca|sidral|dr pepper|topo-?chico (naranja|limonada)|topo chico naranja)\b/, C.refrescos],
    [/\b(bonafont|topo-?chico|penafiel agua)\b/, C.aguas],
    [/\b(del valle|v8|arizona)\b/, C.jugos],
    [/\b(tarasquitos)\b/, C.otros]
];

// id de categorias_nexo (abarrotes) o null si ninguna regla aplica.
function clasificarAbarrotes(nombre) {
    const n = plano(nombre);
    const regla = REGLAS.find(([re]) => re.test(n));
    return regla ? regla[1] : null;
}

// Para un negocio: la fila de categorias_nexo {id, departamento, categoria, nombre} si el negocio es solo de abarrotes y una regla aplica; si no, null.
async function categoriaAbarrotesParaNegocio(pool, negocioId, nombre) {
    const id = clasificarAbarrotes(nombre);

    if (!id) return null;

    const giros = (await pool.query(`SELECT giro FROM public.negocio_giros WHERE negocio_id = $1 AND activo = true`, [negocioId])).rows.map(f => f.giro);

    if (!giros.includes("abarrotes") || giros.includes("ferreteria")) return null;

    const fila = await pool.query(`SELECT id, departamento, nombre, categoria FROM public.categorias_nexo WHERE id = $1 AND giro = 'abarrotes'`, [id]);

    return fila.rows[0] || null;
}

module.exports = { clasificarAbarrotes, categoriaAbarrotesParaNegocio, REGLAS };
