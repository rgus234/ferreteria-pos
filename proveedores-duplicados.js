// Detecta proveedores que probablemente son el mismo escrito distinto ("Diprofer" y "DIPROFER MX", "Gafi" y "Gagi", "ESMA" y "Esam").
// Funcion pura (sin base de datos): solo SUGIERE grupos; quien decide si se unen es el dueño. Nunca se une nada solo.
//   - mismas palabras (sin acentos, mayusculas, "SA de CV", "MX", "ferretero", "proveedor"...)  -> mismo proveedor
//   - las palabras de uno estan todas en el otro ("DTC" y "DTC AGUASCALIENTES")                 -> mismo proveedor
//   - un solo nombre de 4+ letras con una letra de diferencia o dos letras cambiadas ("Esma" / "Esam") -> mismo proveedor
const plano = texto => String(texto || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

// Palabras que no distinguen a un proveedor de otro.
const COMUNES = new Set(["sa", "de", "cv", "s", "a", "rl", "mx", "mexico", "y", "la", "el", "los", "las", "del", "probedor", "proveedor", "proveedora", "distribuidor", "distribuidora", "ferretero", "ferreteros", "ferreteria", "ferreterias", "lista", "precio", "precios"]);

// singular = true pasa "mallas" a "malla" para que coincidan; para comparar letra por letra se usan las palabras tal cual.
function palabras(nombre, singular = true) {
    const lista = plano(nombre).replace(/[^a-z0-9]+/g, " ").split(" ").filter(w => w && !COMUNES.has(w));
    return singular ? lista.map(w => (w.length > 4 && w.endsWith("s") ? w.slice(0, -1) : w)) : lista;
}

// Distancia de edicion con intercambio de letras vecinas (Damerau-Levenshtein, version simple).
function distancia(a, b) {
    const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
    for (let j = 1; j <= b.length; j++) d[0][j] = j;

    for (let i = 1; i <= a.length; i++) {
        for (let j = 1; j <= b.length; j++) {
            const costo = a[i - 1] === b[j - 1] ? 0 : 1;
            d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + costo);
            if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
        }
    }

    return d[a.length][b.length];
}

function parecidos(a, b) {
    const ta = palabras(a);
    const tb = palabras(b);

    if (!ta.length || !tb.length) return false;

    const sa = new Set(ta);
    const sb = new Set(tb);
    const chico = sa.size <= sb.size ? sa : sb;
    const grande = chico === sa ? sb : sa;

    if ([...chico].every(w => grande.has(w))) return true;

    if (ta.length === 1 && tb.length === 1 && Math.max(ta[0].length, tb[0].length) >= 4 && Math.min(ta[0].length, tb[0].length) >= 3) return distancia(ta[0], tb[0]) <= 1;

    const ja = palabras(a, false).join("");
    const jb = palabras(b, false).join("");

    return Math.min(ja.length, jb.length) >= 6 && distancia(ja, jb) <= 1;
}

// proveedores: [{ id, nombre, productos, facturas }] -> grupos de 2 o mas que parecen el mismo. El primero de cada grupo es el destino sugerido
// (el que tiene mas productos; si empatan, mas facturas; luego el mas antiguo).
function grupoDeDuplicados(proveedores) {
    const lista = proveedores.slice();
    const padre = lista.map((_, i) => i);
    const raiz = i => { while (padre[i] !== i) { padre[i] = padre[padre[i]]; i = padre[i]; } return i; };

    for (let i = 0; i < lista.length; i++) {
        for (let j = i + 1; j < lista.length; j++) {
            if (parecidos(lista[i].nombre, lista[j].nombre)) padre[raiz(i)] = raiz(j);
        }
    }

    const grupos = new Map();
    lista.forEach((p, i) => { const r = raiz(i); if (!grupos.has(r)) grupos.set(r, []); grupos.get(r).push(p); });

    return [...grupos.values()]
        .filter(g => g.length > 1)
        .map(g => g.sort((a, b) => (b.productos || 0) - (a.productos || 0) || (b.facturas || 0) - (a.facturas || 0) || a.id - b.id))
        .sort((a, b) => b.reduce((s, p) => s + (p.productos || 0), 0) - a.reduce((s, p) => s + (p.productos || 0), 0));
}

module.exports = { grupoDeDuplicados, parecidos, palabras, distancia };
