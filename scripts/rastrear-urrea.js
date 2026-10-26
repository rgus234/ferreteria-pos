// Lee el catalogo publico de Urrea (urrea.com) para armar el catalogo maestro de Nexo.
// Usa el mismo API publico que usa su tienda en linea (GraphQL), por categorias y de 100 en 100, con pausa entre peticiones
// (no se leen paginas una por una). Solo guarda HECHOS del producto: codigo, nombre, marca, categorias y descripcion.
// NO guarda precios ni fotos. Se puede interrumpir y volver a correr: continua donde se quedo.
//   node scripts/rastrear-urrea.js [carpeta-salida]        (por defecto tmp/urrea)
const fs = require("fs");
const path = require("path");

const SALIDA = path.resolve(process.argv[2] || path.join(__dirname, "..", "tmp", "urrea"));
const ARCHIVO = path.join(SALIDA, "productos.jsonl");
const ESTADO = path.join(SALIDA, "estado.json");
const URL_API = "https://urrea.com/graphql";
const PAUSA_MS = 1200;
const UA = "NexoPOS-catalogo/1.0 (nexoposoficial@gmail.com)";

const dormir = ms => new Promise(r => setTimeout(r, ms));

async function gql(consulta, intentos = 5) {
    for (let i = 1; i <= intentos; i++) {
        try {
            const r = await fetch(URL_API, { method: "POST", headers: { "Content-Type": "application/json", "User-Agent": UA }, body: JSON.stringify({ query: consulta }), signal: AbortSignal.timeout(60000) });
            if (r.ok) { const d = await r.json(); if (!d.errors) return d.data; throw new Error(JSON.stringify(d.errors).slice(0, 200)); }
            throw new Error("HTTP " + r.status);
        } catch (error) {
            if (i === intentos) throw error;
            await dormir(3000 * i);
        }
    }
}

const limpiar = html => String(html || "").replace(/<li[^>]*>/gi, "\n- ").replace(/<[^>]+>/g, " ").replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/&nbsp;/g, " ").replace(/&#039;|&apos;/g, "'").replace(/[ \t]+/g, " ").replace(/\n\s*\n/g, "\n").trim();

(async () => {
    fs.mkdirSync(SALIDA, { recursive: true });
    const estado = fs.existsSync(ESTADO) ? JSON.parse(fs.readFileSync(ESTADO, "utf8")) : { terminadas: [] };
    const vistos = new Set();

    if (fs.existsSync(ARCHIVO)) for (const linea of fs.readFileSync(ARCHIVO, "utf8").split("\n").filter(Boolean)) vistos.add(JSON.parse(linea).sku);

    // "Productos" trae todo el catalogo (unos 14 mil), pero el API solo entrega hasta 10 mil resultados por consulta:
    // se recorre por sus categorias, y si alguna todavia pasa de 10 mil se baja a sus subcategorias.
    const raiz = await gql(`{ categoryList { children { uid name url_path product_count } } }`);
    const productos = raiz.categoryList[0].children.find(c => c.url_path === "productos");
    if (!productos) throw new Error("No encontre la categoria Productos");

    async function hijas(uid) {
        const d = await gql(`{ categoryList(filters:{category_uid:{eq:"${uid}"}}) { children { uid name url_path product_count } } }`);
        await dormir(PAUSA_MS);
        return d.categoryList[0].children;
    }

    async function leer(cat) {
        if (estado.terminadas.includes(cat.uid) || cat.product_count === 0) return;

        if (cat.product_count > 9500) {
            for (const hija of await hijas(cat.uid)) await leer(hija);
            return;
        }

        let pagina = 1, total = 1, nuevos = 0;

        do {
            const d = await gql(`{ products(filter:{category_uid:{eq:"${cat.uid}"}}, pageSize:100, currentPage:${pagina}) {
                page_info { total_pages } items { sku name url_key categories { name url_path } description { html } short_description { html } } } }`);
            total = d.products.page_info.total_pages;

            for (const p of d.products.items) {
                if (vistos.has(p.sku)) continue;
                vistos.add(p.sku);
                nuevos++;
                fs.appendFileSync(ARCHIVO, JSON.stringify({
                    sku: p.sku, nombre: limpiar(p.name), urlKey: p.url_key,
                    categorias: (p.categories || []).map(c => ({ nombre: c.name, ruta: c.url_path })),
                    descripcion: limpiar(p.description?.html) || limpiar(p.short_description?.html)
                }) + "\n");
            }

            pagina++;
            await dormir(PAUSA_MS);
        } while (pagina <= total);

        estado.terminadas.push(cat.uid);
        fs.writeFileSync(ESTADO, JSON.stringify(estado));
        console.log(`${cat.name}: ${nuevos} nuevos (total ${vistos.size})`);
    }

    console.log(`Productos en el sitio: ${productos.product_count}; ya guardados: ${vistos.size}`);
    for (const cat of await hijas(productos.uid)) await leer(cat);

    console.log("Listo. Productos:", vistos.size);
})().catch(e => { console.error("Error:", e.message); process.exit(1); });
