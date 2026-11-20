// "Mandar por WhatsApp" centralizado (public/js/nexo-whatsapp.js): una sola funcion para escritorio, celular, app de Windows y administracion.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const RAIZ = path.join(__dirname, "..");
const leer = ruta => fs.readFileSync(path.join(RAIZ, ruta), "utf8");

// Corre el archivo en un navegador de mentira: se ve que abre en cada caso sin tocar WhatsApp.
function cargar({ ua = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/130.0 Safari/537.36", escritorio = undefined, modo = null, abre = () => ({}) } = {}) {
    const llamadas = [];
    const almacen = { nexoWaModo: modo };
    const window = {
        localStorage: { getItem: k => (almacen[k] == null ? null : almacen[k]), setItem: (k, v) => { almacen[k] = v; } },
        open: (...args) => { llamadas.push(args); return abre(); },
        location: { href: "https://app.nexoposoficial.com/" },
        addEventListener() {}, removeEventListener() {},
        nexoDesktop: escritorio
    };
    const documento = { addEventListener() {}, removeEventListener() {} };
    const contexto = vm.createContext({ window, document: documento, navigator: { userAgent: ua, maxTouchPoints: 0 }, URL, encodeURIComponent, setTimeout, Promise, Number, String });
    vm.runInContext(leer("public/js/nexo-whatsapp.js"), contexto);
    return { nexoWA: window.nexoWA, llamadas, almacen };
}

test("normalizar: telefonos de Mexico en cualquier formato salen como 52 + 10 digitos", () => {
    const { nexoWA } = cargar();
    assert.equal(nexoWA.normalizar("4421234567"), "524421234567");
    assert.equal(nexoWA.normalizar("(442) 123-4567"), "524421234567");
    assert.equal(nexoWA.normalizar("+52 442 123 4567"), "524421234567");
    assert.equal(nexoWA.normalizar("5214421234567"), "524421234567", "el 1 viejo de los celulares se quita");
    assert.equal(nexoWA.normalizar("524421234567"), "524421234567");
    assert.equal(nexoWA.normalizar("14155550123"), "14155550123", "numeros de otros paises se respetan");
    assert.equal(nexoWA.normalizar("12345"), "", "muy corto no sirve");
    assert.equal(nexoWA.normalizar(null), "");
    assert.equal(nexoWA.normalizar(undefined), "");
});

test("navegador con modo web: abre WhatsApp Web con el numero y el mensaje ya escritos, sin preguntar nada", async () => {
    const { nexoWA, llamadas } = cargar({ modo: "web" });
    const estado = await nexoWA.enviar({ telefono: "(442) 123-4567", texto: "Hola ñ, tu saldo es $50" });
    assert.equal(estado, "abierto");
    assert.equal(llamadas.length, 1);
    assert.equal(llamadas[0][0], "https://wa.me/524421234567?text=Hola%20%C3%B1%2C%20tu%20saldo%20es%20%2450");
});

test("si el navegador bloquea la ventana, se avisa como 'bloqueado'", async () => {
    const { nexoWA } = cargar({ modo: "web", abre: () => null });
    assert.equal(await nexoWA.enviar({ telefono: "4421234567", texto: "x" }), "bloqueado");
});

test("celular: usa el enlace de siempre (ya abre la app de WhatsApp)", async () => {
    const { nexoWA, llamadas } = cargar({ ua: "Mozilla/5.0 (Linux; Android 14; Pixel 8) Chrome/130.0 Mobile Safari/537.36" });
    assert.equal(await nexoWA.enviar({ telefono: "4421234567", texto: "hola" }), "abierto");
    assert.match(llamadas[0][0], /^https:\/\/wa\.me\/524421234567\?text=hola$/);
});

test("app de escritorio de Nexo: se le pide a ella abrir WhatsApp (ella sabe si la app esta instalada), con numero y texto, nunca una URL", async () => {
    const pedidos = [];
    const { nexoWA, llamadas } = cargar({ ua: "Mozilla/5.0 Electron/42.5.0 Chrome/140", escritorio: { abrirWhatsApp: async datos => { pedidos.push(datos); return { ok: true, via: "app" }; } } });
    assert.equal(await nexoWA.enviar({ telefono: "4421234567", texto: "Gracias por tu compra" }), "abierto");
    assert.equal(JSON.stringify(pedidos), JSON.stringify([{ numero: "524421234567", texto: "Gracias por tu compra" }]));
    assert.equal(llamadas.length, 0, "no se abre ninguna pestaña del navegador");
});

test("app de escritorio: si falla la conexion con ella, se usa WhatsApp Web como siempre", async () => {
    const { nexoWA, llamadas } = cargar({ ua: "Mozilla/5.0 Electron/42.5.0", escritorio: { abrirWhatsApp: async () => { throw new Error("no"); } } });
    assert.equal(await nexoWA.enviar({ telefono: "4421234567", texto: "x" }), "abierto");
    assert.equal(llamadas.length, 1);
});

test("version vieja de la app de escritorio (sin la conexion nueva): igual que antes y nunca navega a whatsapp://", async () => {
    const { nexoWA, llamadas } = cargar({ ua: "Mozilla/5.0 Electron/38.0.0", abre: () => null }); // Electron regresa null a proposito
    assert.equal(await nexoWA.enviar({ telefono: "4421234567", texto: "x" }), "abierto", "null no significa bloqueado en Electron");
    assert.equal(llamadas.length, 1);
    assert.match(llamadas[0][0], /^https:\/\/wa\.me\//);
});

test("sin telefono y sin pedirlo: se abre WhatsApp para elegir el contacto", async () => {
    const { nexoWA, llamadas } = cargar({ modo: "web" });
    assert.equal(await nexoWA.enviar({ telefono: "", texto: "Pedido para el proveedor", pedirNumeroSiFalta: false }), "abierto");
    assert.equal(llamadas[0][0], "https://wa.me/?text=Pedido%20para%20el%20proveedor");
});

test("modo: se puede forzar web o app, y volver a detectar solo", () => {
    const { nexoWA, almacen } = cargar();
    assert.equal(nexoWA.modo(), "auto");
    assert.equal(nexoWA.modo("web"), "web");
    assert.equal(almacen.nexoWaModo, "web");
    assert.equal(nexoWA.modo("auto"), "auto");
});

test("todo el programa usa la funcion central: no queda ningun window.open a wa.me (salvo el sitio publico)", () => {
    const encontrados = [];
    const revisar = dir => {
        for (const nombre of fs.readdirSync(dir, { withFileTypes: true })) {
            const ruta = path.join(dir, nombre.name);
            if (nombre.isDirectory()) { if (!["site", "node_modules", "fonts", "img"].includes(nombre.name)) revisar(ruta); continue; }
            if (!nombre.name.endsWith(".js") || nombre.name === "nexo-whatsapp.js") continue;
            if (/window\.open\([^)]*wa\.me/.test(fs.readFileSync(ruta, "utf8"))) encontrados.push(path.relative(RAIZ, ruta));
        }
    };
    revisar(path.join(RAIZ, "public"));
    assert.deepEqual(encontrados, []);
});

test("las tres pantallas (escritorio, celular, administracion) cargan la funcion ANTES de los archivos que la usan", () => {
    const orden = (html, usado) => { const a = html.indexOf("nexo-whatsapp.js"); const b = html.indexOf(usado); assert.ok(a > 0 && b > 0 && a < b, `nexo-whatsapp.js debe ir antes de ${usado}`); };
    orden(leer("public/index.html"), "js/credit-customers.js");
    orden(leer("public/dueno.html"), 'dueno.js?v=');
    orden(leer("public/admin/index.html"), "./app.js");
});

test("celular: el service worker guarda la funcion y la version del cache se renovo", () => {
    const sw = leer("public/dueno-sw.js");
    const html = leer("public/dueno.html");
    const version = /nexo-whatsapp\.js\?v=([\w-]+)/.exec(html)[1];
    assert.ok(sw.includes(`/js/nexo-whatsapp.js?v=${version}`), "mismo archivo y misma version que en el html");
    assert.ok(Number(/nexo-dueno-shell-v(\d+)/.exec(sw)[1]) >= 155, "el cache del celular se subio de version");
});

test("app de escritorio: ofrece abrirWhatsApp, valida el numero y no acepta URLs del renderer", () => {
    const main = leer("apps/desktop/main.js");
    const preload = leer("apps/desktop/preload.js");
    assert.ok(preload.includes('abrirWhatsApp: payload => ipcRenderer.invoke("nexo:abrir-whatsapp"'));
    const bloque = main.slice(main.indexOf('ipcMain.handle("nexo:abrir-whatsapp"'), main.indexOf('app.whenReady().then(async () => {'));
    assert.ok(bloque.includes("getApplicationInfoForProtocol"), "detecta si la app de WhatsApp esta instalada");
    assert.ok(bloque.includes("\\d{10,15}"), "solo numeros de 10 a 15 digitos");
    assert.ok(!/payload\.(url|href)/.test(bloque), "no usa una URL que mande la pagina");
});
