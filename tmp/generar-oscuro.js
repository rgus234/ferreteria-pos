// Genera public/dueno-oscuro-auto.css: para cada regla CLARA de los modulos del celular sin modo oscuro, su version oscura.
const fs = require("fs");
const ARCHIVOS = ["dueno-exhibidores.css", "dueno-mapa.css", "dueno-tienda.css", "dueno-usuarios.css", "dueno-captura.css"];
const EXCLUIR = /foto|img|logo|mini|imagen|qr|svg|escaner|camara|video|canvas/i;

function rgb(hex) {
    let h = hex.replace("#", "");
    if (h.length === 3) h = h.split("").map(c => c + c).join("");
    if (h.length !== 6) return null;
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}
const lum = ([r, g, b]) => (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
const sat = ([r, g, b]) => { const mx = Math.max(r, g, b), mn = Math.min(r, g, b); return mx === 0 ? 0 : (mx - mn) / mx; };
const primerHex = texto => { const m = String(texto).match(/#[0-9a-f]{3,8}\b/i); return m ? m[0] : null; };

let salida = `/* Modo oscuro de los modulos del celular que se pintaban con colores claros fijos (exhibidores, mapa de la tienda, tienda, usuarios y captura).
   GENERADO a partir de sus propias reglas (tmp/generar-oscuro.js): solo cambia colores de fondo, texto y bordes claros; las fotos y los colores de marca no se tocan. */\n`;
let total = 0;

for (const a of ARCHIVOS) {
    const t = fs.readFileSync("public/" + a, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
    const re = /([^{}]+)\{([^{}]*)\}/g;
    let m; const reglas = [];

    while ((m = re.exec(t))) {
        const sel = m[1].trim().replace(/\s+/g, " ");
        if (!sel || sel.startsWith("@") || /oscuro|keyframes|^\d|^from|^to/.test(sel)) continue;
        const props = m[2];
        const sal = [];

        const bg = props.match(/(?:^|;)\s*background(?:-color)?:\s*([^;]+)/i);
        if (bg && !/gradient|var\(|url\(/.test(bg[1])) {
            const h = primerHex(bg[1]); const c = h && rgb(h);
            if (c && sat(c) < 0.25) { const l = lum(c); if (l > 0.82) sal.push("background: " + (/(capa|marco|pantalla)(s|$|,|:)/.test(sel) ? "#0e1624" : "#182233") + " !important"); else if (l > 0.62) sal.push("background: #243148 !important"); }
        }

        const col = props.match(/(?:^|;)\s*color:\s*([^;]+)/i);
        if (col && !/var\(|gradient/.test(col[1])) {
            const h = primerHex(col[1]); const c = h && rgb(h);
            if (c && sat(c) < 0.4) { const l = lum(c); if (l < 0.3) sal.push("color: #f1f5f9 !important"); else if (l < 0.62) sal.push("color: #aab7ca !important"); }
        }

        const bor = props.match(/(?:^|;)\s*border(?:-top|-bottom|-left|-right)?(?:-color)?:\s*([^;]+)/i);
        if (bor && !/var\(/.test(bor[1])) {
            const h = primerHex(bor[1]); const c = h && rgb(h);
            if (c && sat(c) < 0.25 && lum(c) > 0.7) sal.push("border-color: rgba(148, 163, 184, .28) !important");
        }

        if (!sal.length) continue;
        const selectores = sel.split(",").map(s => s.trim()).filter(s => s && !EXCLUIR.test(s));
        if (!selectores.length) continue;
        reglas.push(`${selectores.map(s => ":root.oscuro " + s).join(",\n")} { ${sal.join("; ")}; }`);
    }

    total += reglas.length;
    salida += `\n/* ${a} */\n` + reglas.join("\n") + "\n";
}

salida += `
/* texto de Exhibidores: titulos y nombres claros (los heredaban oscuros del boton) */
:root.oscuro .dx-capa, :root.oscuro .dx-capa h2, :root.oscuro .dx-capa h3, :root.oscuro .dx-capa p,
:root.oscuro .dx-cabecera, :root.oscuro .dx-cabecera h2, :root.oscuro .dx-cabecera button,
:root.oscuro .dx-tarjeta, :root.oscuro .dx-tarjeta b, :root.oscuro .dx-tarjeta strong, :root.oscuro .dx-tarjeta h3,
:root.oscuro .dx-tile, :root.oscuro .dx-tile b, :root.oscuro .dx-tile strong, :root.oscuro .dx-lugar, :root.oscuro .dx-barra, :root.oscuro .dx-barra button { color: #f1f5f9 !important; }
:root.oscuro .dx-tarjeta small, :root.oscuro .dx-tile small, :root.oscuro .dx-nota { color: #aab7ca !important; }
`;

fs.writeFileSync("public/dueno-oscuro-auto.css", salida);
console.log("reglas generadas:", total);
