// Lee los precios (Mayoreo, 1/2 Mayoreo, Publico) del PDF nacional de Truper (https://catalogovigente.truper.com/catalogo_nacional_2026.pdf) usando la posicion de cada texto, sin visión. SOLO LEE: escribe tmp/pdf-truper-precios.json.
//   node scripts/leer-pdf-truper.mjs [rutaPdf]   y luego   node --env-file=.env scripts/aplicar-precios-pdf-truper.js [--aplicar]
import fs from "fs";
import * as pdfjs from "../node_modules/pdfjs-dist/legacy/build/pdf.mjs";

const ruta = process.argv[2] || "D:/temp-win/claude/pdftruper/nacional.pdf";
const doc = await pdfjs.getDocument({ data: new Uint8Array(fs.readFileSync(ruta)), useSystemFonts: false, verbosity: 0 }).promise;

const esCodigo = s => /^\d{4,6}$/.test(s);
const numero = s => { const m = String(s).replace(/,/g, "").match(/^\d+(\.\d+)?$/); return m ? Number(s.replace(/,/g, "")) : null; };

// Precios de la pagina: un "$" y su numero (separados o juntos), con su posicion.
function precios(items) {
    const out = [];
    items.forEach((it, i) => {
        let valor = null, x = it.x;
        const junto = it.s.match(/^\$\s*(\d[\d,]*(?:\.\d+)?)$/);
        if (junto) valor = numero(junto[1]);
        else if (it.s === "$") {
            const sig = items.find(o => o !== it && Math.abs(o.y - it.y) <= 1.5 && o.x > it.x && o.x - it.x < 12 && numero(o.s) !== null);
            if (sig) valor = numero(sig.s);
        }
        if (valor !== null) out.push({ x, y: it.y, valor });
    });
    return out;
}

const resultado = new Map(); // codigo -> { codigo, clave, mayoreo, medio, publico, pagina, layout }
const dudosos = [];

function guardar(codigo, clave, tres, pagina, layout) {
    const [mayoreo, medio, publico] = tres;
    if (!(mayoreo > 0 && medio > 0 && publico > 0) || !(mayoreo <= medio && medio <= publico)) { dudosos.push({ codigo, pagina, layout, tres }); return; }
    if (resultado.has(codigo)) { const a = resultado.get(codigo); if (a.mayoreo !== mayoreo || a.medio !== medio || a.publico !== publico) dudosos.push({ codigo, pagina, layout, repetido: true, tres, antes: [a.mayoreo, a.medio, a.publico] }); return; }
    resultado.set(codigo, { codigo, clave: clave || "", mayoreo, medio, publico, pagina, layout });
}

for (let n = 1; n <= doc.numPages; n++) {
    const p = await doc.getPage(n);
    const vista = p.getViewport({ scale: 1 });
    const t = await p.getTextContent();
    const items = t.items.filter(i => i.str.trim()).map(i => ({ s: i.str.trim(), x: Math.round(i.transform[4]), y: Math.round((vista.height - i.transform[5]) * 10) / 10 }));
    const pr = precios(items);
    if (!pr.length) continue;

    const codigos = items.filter(i => esCodigo(i.s));
    const filasCodigo = items.filter(i => /^C.digo:$/.test(i.s));

    // Tarjetas: "Codigo:" con los codigos en la misma fila y los 3 precios debajo, en la misma columna.
    const usados = new Set();
    for (const et of filasCodigo) {
        const fila = codigos.filter(c => Math.abs(c.y - et.y) <= 2 && c.x > et.x).sort((a, b) => a.x - b.x);
        const limite = filasCodigo.filter(o => o.y > et.y + 4).map(o => o.y).sort((a, b) => a - b)[0] || et.y + 130;
        fila.forEach((c, k) => {
            const xIzq = c.x - 12, xDer = (fila[k + 1] ? fila[k + 1].x : c.x + 100) - 12;
            const columna = pr.filter(q => q.x >= xIzq && q.x < xDer && q.y > c.y + 20 && q.y < Math.min(limite, et.y + 130)).sort((a, b) => a.y - b.y);
            const claveItem = items.find(i => Math.abs(i.y - (et.y + 8)) <= 6 && i.x >= xIzq && i.x < xDer && /^[A-Z0-9-]{3,}/.test(i.s) && !esCodigo(i.s));
            if (columna.length >= 3) { guardar(c.s, claveItem && claveItem.s, columna.slice(0, 3).map(q => q.valor), n, "tarjeta"); usados.add(c); }
        });
    }

    // Tablas: el codigo y, en su misma fila, tres precios a la derecha (hasta el siguiente codigo de esa fila).
    for (const c of codigos) {
        if (usados.has(c)) continue;
        const mismaFila = codigos.filter(o => Math.abs(o.y - c.y) <= 1.5 && o.x > c.x).sort((a, b) => a.x - b.x);
        const tope = mismaFila.length ? mismaFila[0].x - 2 : c.x + 330;
        const tres = pr.filter(q => Math.abs(q.y - c.y) <= 1.5 && q.x > c.x && q.x < tope).sort((a, b) => a.x - b.x);
        if (tres.length === 3) {
            const clave = items.find(i => Math.abs(i.y - c.y) <= 1.5 && i.x > c.x && i.x < c.x + 45 && !esCodigo(i.s) && /^[A-Za-z0-9-]/.test(i.s));
            guardar(c.s, clave && clave.s, tres.map(q => q.valor), n, "tabla");
        }
    }
    if (n % 100 === 0) console.log("pagina", n, "productos", resultado.size);
}

fs.writeFileSync("tmp/pdf-truper-precios.json", JSON.stringify({ leido: new Date().toISOString(), productos: [...resultado.values()], dudosos }, null, 1));
console.log("productos leidos:", resultado.size, "| dudosos:", dudosos.length);
