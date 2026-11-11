/* Recibir mercancia POR MARCA en el celular (abarrotes). Los tickets de ruta (Sabritas, Coca-Cola, Bimbo, Gamesa...) vienen abreviados:
   en vez de leerlos, se abre la marca, se ven las tarjetas con foto y "Hay N", y en cada una se pone cuantas llegaron. Al confirmar se suma
   al inventario por el mismo camino de "Recibir mercancia" (POST /recepciones-mercancia/rapida, con llave de idempotencia).
   Las marcas se arman solas con los nombres de tus productos (palabras clave conocidas; si no, la primera palabra del nombre). */

(function () {
    const MARCAS = [
        ["Sabritas", "#e11d2e", ["sabritas", "doritos", "cheetos", "ruffles", "tostitos", "fritos", "rancheritos", "pake taxo", "paketaxo", "churrumais", "kacang", "crujitos"]],
        ["Coca-Cola", "#dc2626", ["coca", "fanta", "sprite", "ciel", "fresca", "powerade", "power ade", "del valle", "topo chico", "topo-chico", "fuze", "sidral", "mundet", "kermato"]],
        ["Pepsi", "#1d4ed8", ["pepsi", "7up", "7 up", "mirinda", "manzanita", "e-pura", "epura", "gatorade", "lipton", "squirt"]],
        ["Gamesa", "#c2410c", ["gamesa", "marias", "emperador", "saladitas", "chokis", "cremax", "mamut", "arcoiris", "crackets", "ricanelas", "maravillas", "fruts", "florentinas", "flor de naranjo", "chocolatines", "barras de coco", "multigrano", "paketon"]],
        ["Bimbo", "#1e40af", ["bimbo", "bimbollos", "medias noches", "rebanadas", "conchas", "nito", "oroweat", "mantecadas", "panque", "hotkis", "donitas", "little bites", "pan tostado", "empanizador", "mini pan", "crossantines", "mante-chox", "mante chox", "branfrut", "bran frut"]],
        ["Marinela", "#9333ea", ["marinela", "gansito", "pinguinos", "canelitas", "napolitano", "submarinos", "chocoroles", "choco roles", "barritas"]],
        ["Nestlé", "#0f766e", ["nescafe", "carnation", "lechera", "nesquik", "choco-milk", "chocomilk", "nestle"]],
        ["Barcel", "#b45309", ["barcel", "takis", "hot nuts", "chips fuego", "runners"]]
    ];

    // Directorio de marcas de Nexo (144): tipo, color e imagen de cada tarjeta. Si no carga, todo funciona como antes con la lista de arriba.
    const COLORES_DIRECTORIO = { azul: "#1d4ed8", naranja: "#ea580c", verde: "#15803d", rojo: "#dc2626", morado: "#7e22ce", negro: "#1f2937" };
    let directorio = null;
    const urlImagenMarca = m => "/marcas-directorio/" + encodeURIComponent(m.id) + "/imagen";

    async function cargarDirectorioDueno() {
        if (directorio) return directorio;
        directorio = { lista: [], porNombre: new Map() };
        try {
            const r = await fetchAutenticado("/marcas-directorio");
            (r && r.marcas || []).forEach(m => { m.palabras = m.palabras || []; directorio.lista.push(m); directorio.porNombre.set(plano(m.nombre), m); });
        } catch (error) { /* sin directorio */ }
        return directorio;
    }

    function coincidePalabraDirectorio(n, palabra) {
        const e = palabra.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        return new RegExp("(^|[^a-z0-9])" + e + "([^a-z0-9]|$)").test(n);
    }

    // Igual que en el servidor: las marcas con nombre propio (pocas palabras) mandan sobre las de familia.
    function marcaDelDirectorio(nombre) {
        if (!directorio || !directorio.lista.length) return null;
        const n = plano(nombre);
        const propias = directorio.lista.filter(m => m.palabras.length <= 2);
        const familias = directorio.lista.filter(m => m.palabras.length > 2);
        for (const m of [...propias, ...familias]) if (m.palabras.some(pl => coincidePalabraDirectorio(n, pl))) return m;
        return null;
    }

    const COLORES_RESPALDO = ["#0369a1", "#15803d", "#a21caf", "#b91c1c", "#4d7c0f", "#0e7490", "#7c2d12", "#4338ca"];
    const esc = valor => (typeof escaparDueno === "function" ? escaparDueno(valor) : String(valor ?? ""));
    const plano = t => String(t || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

    // Lineas dentro de una marca (Doritos, Cheetos, Bolzaza...; en refrescos: Coca-Cola, Aguas, Fanta...). "Bolzaza" manda sobre la linea
    // porque es un tamaño que se busca aparte. Lo que no esta en la tabla toma la primera palabra del nombre.
    const LINEAS_PRIORITARIAS = [["Bolzaza", ["bolzaza", "bolsaza"]]];
    const LINEAS = [
        ["Aguas", ["ciel", "e-pura", "epura", "bonafont", "agua "]],
        ["Fuze Tea", ["fuze", "fuzetea"]],
        ["Powerade", ["powerade", "power ade"]],
        ["Topo Chico", ["topo chico", "topo-chico", "topochico"]],
        ["Pake Taxo", ["pake taxo", "paketaxo"]],
        ["Coca-Cola", ["coca"]],
        ["Sidral", ["sidral", "mundet"]]
    ];

    function lineaDe(nombre) {
        const n = plano(nombre);

        for (const [linea, palabras] of LINEAS_PRIORITARIAS) if (palabras.some(p => n.includes(p))) return linea;
        for (const [linea, palabras] of LINEAS) if (palabras.some(p => n.includes(p))) return linea;

        const primera = (String(nombre || "").trim().split(" ")[0] || "Otros").replace(/[^A-Za-zÁÉÍÓÚÜÑáéíóúüñ0-9-]/g, "") || "Otros";
        return primera.charAt(0).toUpperCase() + primera.slice(1).toLowerCase();
    }

    // Lineas de una marca con su cuenta; las de un solo producto se juntan en "Otros". Sin lineas utiles (una sola o pocos productos), no se muestran.
    function lineasDe(productos) {
        if (productos.length < 8) return [];
        const cuenta = new Map();
        productos.forEach(p => cuenta.set(lineaDeProducto(p), (cuenta.get(lineaDeProducto(p)) || 0) + 1));
        // Pocas lineas: cada una con su chip (aunque sea de un solo producto, como Rancheritos). Muchas: las de uno se juntan en "Otros".
        const juntar = cuenta.size > 10;
        let sueltas = 0;
        const lista = [];
        cuenta.forEach((n, linea) => { if (!juntar || n >= 2) lista.push({ linea, n }); else sueltas += n; });
        lista.sort((a, b) => b.n - a.n);
        if (sueltas) lista.push({ linea: "Otros", n: sueltas });
        return lista.length >= 2 ? lista : [];
    }

    function perteneceALinea(p, linea, conocidas) {
        const l = lineaDeProducto(p);
        return linea === "Otros" ? !conocidas.has(l) : l === linea;
    }

    // En una FERRETERIA (solo ferreteria) las marcas y lineas salen de los datos del producto (marca: Truper, Urrea, Pretul...; categoria: Tornillería,
    // Plomería...) y no de la lista de marcas de botanas. En abarrotes se sigue reconociendo por nombre.
    const esFerreteria = () => Boolean(window.duenoGiro && window.duenoGiro.ferreteriaSolo);

    function colorDeMarca(texto) {
        let suma = 0;
        for (const c of plano(texto)) suma += c.charCodeAt(0);
        return COLORES_RESPALDO[suma % COLORES_RESPALDO.length];
    }

    function marcaDeProducto(p) {
        const propia = String(p.marca || "").trim();
        if (esFerreteria() && propia) return { marca: propia, color: colorDeMarca(propia) };
        return marcaDe(p.nombre);
    }

    function lineaDeProducto(p) {
        const categoria = String(p.categoria || "").trim();
        if (esFerreteria() && categoria) return categoria;
        return lineaDe(p.nombre);
    }

    let estado = null; // { productos, grupos, marca, cantidades: Map(id -> n), enviando, llave }

    function marcaDe(nombre) {
        const n = plano(nombre);
        const delDirectorio = marcaDelDirectorio(nombre);

        if (delDirectorio) return { marca: delDirectorio.nombre, color: COLORES_DIRECTORIO[delDirectorio.color] || "#475569", dir: delDirectorio };

        for (const [marca, color, palabras] of MARCAS) {
            if (palabras.some(p => n.includes(p))) return { marca, color };
        }

        // Marca desconocida: la primera palabra del nombre tal como se escribio (con acentos).
        const original = (String(nombre || "").trim().split(/\s+/)[0] || "otros").replace(/[^\p{L}\p{N}-]/gu, "") || "otros";
        const bonita = original.charAt(0).toUpperCase() + original.slice(1).toLowerCase();
        let suma = 0;
        for (const c of plano(original)) suma += c.charCodeAt(0);
        return { marca: bonita, color: COLORES_RESPALDO[suma % COLORES_RESPALDO.length] };
    }

    // Agrupa los productos por marca; las marcas conocidas primero y las demas (una palabra) al final bajo "Otros" si traen un solo producto.
    function agrupar(productos) {
        const mapa = new Map();

        productos.forEach(p => {
            const { marca, color, dir } = marcaDeProducto(p);
            if (!mapa.has(marca)) mapa.set(marca, { marca, color, dir: dir || null, logo: dir ? urlImagenMarca(dir) : null, productos: [] });
            mapa.get(marca).productos.push(p);
        });

        const conocidas = new Set([...MARCAS.map(m => m[0]), ...(directorio ? directorio.lista.map(m => m.nombre) : [])]);
        const lista = [...mapa.values()];
        const sueltos = lista.filter(g => !conocidas.has(g.marca) && g.productos.length < 2);
        const grupos = lista.filter(g => !sueltos.includes(g));

        if (sueltos.length) grupos.push({ marca: "Otros", color: "#475569", productos: sueltos.flatMap(g => g.productos) });

        grupos.forEach(g => g.productos.sort((a, b) => String(a.nombre).localeCompare(String(b.nombre), "es")));
        return grupos.sort((a, b) => (conocidas.has(b.marca) - conocidas.has(a.marca)) || (b.productos.length - a.productos.length));
    }

    function totales() {
        let productos = 0, piezas = 0;
        estado.cantidades.forEach(n => { if (n > 0) { productos++; piezas += n; } });
        return { productos, piezas };
    }

    function capa() {
        let c = document.getElementById("drmCapa");
        if (!c) { c = document.createElement("div"); c.id = "drmCapa"; c.className = "drm-capa"; document.body.appendChild(c); }
        return c;
    }

    const nc = codigo => String(codigo || "").replace(/[^a-zA-Z0-9]/g, "").toLowerCase();
    const pluralProducto = n => `producto${n === 1 ? "" : "s"}`;
    const pluralPieza = n => `pieza${n === 1 ? "" : "s"}`;
    const textoTotales = t => `<strong>${t.productos}</strong> ${pluralProducto(t.productos)} · <strong>${t.piezas}</strong> ${pluralPieza(t.piezas)}`;

    // Las fotos del catalogo del telefono son data:URL de ~90 KB cada una. Escribirlas dentro del HTML de la tarjeta obliga a escapar y analizar megas de texto
    // en cada dibujo; la tarjeta lleva la imagen vacia y la foto se asigna despues como propiedad (sin pasar por el analizador de HTML).
    function ponerFotos(raiz) {
        if (!raiz) return;
        raiz.querySelectorAll("img[data-foto]").forEach(img => {
            const p = estado && estado.indice.get(Number(img.dataset.foto));
            img.removeAttribute("data-foto");
            if (p && p.imagenUrl) img.src = fotoMiniDueno(p.imagenUrl);
        });
    }

    function tarjetaHtml(p) {
        const n = estado.cantidades.get(p.id) || 0;
        const hay = Number(p.stock) || 0;
        const poco = hay <= Math.max(3, Number(p.stock_minimo) || 0);
        return `<article class="drm-tarjeta${n > 0 ? " con-entrada" : ""}" data-id="${Number(p.id)}">
            <span class="drm-foto">${p.imagenUrl ? `<img data-foto="${Number(p.id)}" alt="" decoding="async">` : (typeof miniaturaVaciaDuenoHtml === "function" ? miniaturaVaciaDuenoHtml() : "")}</span>
            <b class="drm-nombre">${esc(p.nombre)}</b>
            <span class="drm-hay${poco ? " poco" : ""}">Hay ${esc(String(hay))}</span>
            ${estado.modo === "sugerir" ? minMaxHtmlDueno(p) : ""}
            ${p.esperado != null ? `<span class="drm-esperado${n > 0 && n !== p.esperado ? " dif" : ""}">${p.nuevoProducto ? "Nuevo · " : ""}Esperado ${esc(String(p.esperado))}</span>` : ""}
            <div class="drm-cantidad">
                <button type="button" aria-label="Quitar uno" onclick="ajustarRecibirDueno(${Number(p.id)}, -1)">−</button>
                <input type="text" inputmode="numeric" value="${n || ""}" placeholder="0" aria-label="Llegaron" oninput="escribirRecibirDueno(${Number(p.id)}, this.value)">
                <button type="button" aria-label="Agregar uno" onclick="ajustarRecibirDueno(${Number(p.id)}, 1)">+</button>
            </div>
            ${p.esperado != null ? `<div class="drm-atajos"><button type="button" class="drm-llego" onclick="llegoTodoRecibirDueno(${Number(p.id)})">Llegó todo (${esc(String(p.esperado))})</button></div>` : `<div class="drm-atajos">${[6, 12, 18, 24].map(a => `<button type="button" onclick="ajustarRecibirDueno(${Number(p.id)}, ${a})">+${a}</button>`).join("")}</div>`}
        </article>`;
    }

    // Lo que se ve en la lista: lo que coincide con el buscador (nombre o codigo, en TODAS las marcas) o, sin buscar, la marca elegida.
    // Al escribir en el buscador tambien se filtran las tarjetas de marca: "bim" deja solo Bimbo, "game" deja Gamesa.
    function marcasQueCoinciden() {
        const q = plano(estado.consulta || "").trim();
        if (!q || estado.factura) return [];
        const palabras = q.split(/\s+/).filter(Boolean);
        return estado.grupos.filter(g => { const nombre = plano(g.marca); return palabras.every(w => nombre.includes(w)); });
    }

    function productosVisibles() {
        const q = plano(estado.consulta || "").trim();

        if (q) {
            const palabras = q.split(/\s+/).filter(Boolean);
            const soloCodigo = nc(q);
            const porNombre = estado.todos.filter(p => {
                const nombre = plano(p.nombre);
                return palabras.every(w => nombre.includes(w)) || (soloCodigo.length >= 3 && nc(p.codigo).includes(soloCodigo));
            });
            const deMarca = marcasQueCoinciden().flatMap(g => g.productos);
            const vistos = new Set();
            return deMarca.concat(porNombre).filter(p => !vistos.has(Number(p.id)) && vistos.add(Number(p.id))).slice(0, 60);
        }

        if (!estado.marca && modoTarjetas()) return [];
        const grupo = estado.grupos.find(g => g.marca === estado.marca) || estado.grupos[0];
        if (!grupo) return [];
        if (!estado.linea) return grupo.productos;

        const conocidas = new Set(lineasDe(grupo.productos).filter(x => x.linea !== "Otros").map(x => x.linea));
        return grupo.productos.filter(p => perteneceALinea(p, estado.linea, conocidas));
    }

    function lineasHtml() {
        const grupo = !estado.marca && modoTarjetas() ? null : (estado.grupos.find(g => g.marca === estado.marca) || estado.grupos[0]);
        const lineas = grupo && !estado.factura ? lineasDe(grupo.productos) : [];

        if (!lineas.length) return "";

        const chip = (linea, n, etiqueta) => `<button type="button" class="drm-linea${(estado.linea || "") === linea ? " activa" : ""}" onclick="elegirLineaRecibirDueno(${JSON.stringify(linea).replace(/"/g, "&quot;")})">${esc(etiqueta)} <small>${n}</small></button>`;
        return chip("", grupo.productos.length, "Todos") + lineas.map(x => chip(x.linea, x.n, x.linea)).join("");
    }

    // Marcas agrupadas por tipo de producto (botanas, refrescos, aguas...) para no tener todo revuelto. Solo en abarrotes y con marcas conocidas.
    const TIPO_POR_MARCA = {
        sabritas: "Botanas", barcel: "Botanas",
        "coca-cola": "Refrescos", pepsi: "Refrescos", "dr pepper": "Refrescos", jarritos: "Refrescos",
        bonafont: "Aguas", penafiel: "Aguas",
        monster: "Jugos y energía", volt: "Jugos y energía", arizona: "Jugos y energía", v8: "Jugos y energía", jumex: "Jugos y energía",
        gamesa: "Galletas y pan", bimbo: "Galletas y pan", marinela: "Galletas y pan",
        ricolino: "Dulces",
        lala: "Lácteos", nestle: "Lácteos"
    };
    const ORDEN_TIPOS = ["Botanas", "Refrescos", "Aguas", "Jugos y energía", "Galletas y pan", "Dulces", "Lácteos", "Otras"];
    const tipoDeGrupo = g => {
        const d = g.dir || (directorio && directorio.porNombre.get(plano(g.marca)));
        return (d && d.tipo) || TIPO_POR_MARCA[plano(g.marca)] || "Otras";
    };

    function tiposActivos() {
        if (esFerreteria() || estado.factura) return [];
        const cuenta = new Map();
        estado.grupos.forEach(g => { const t = tipoDeGrupo(g); cuenta.set(t, (cuenta.get(t) || 0) + 1); });
        const conocidos = ORDEN_TIPOS.filter(x => cuenta.has(x) && x !== "Otras");
        const nuevos = [...cuenta.keys()].filter(x => !ORDEN_TIPOS.includes(x)).sort((a, b) => cuenta.get(b) - cuenta.get(a));
        const lista = [...conocidos, ...nuevos, ...(cuenta.has("Otras") ? ["Otras"] : [])];
        return lista.length > 1 ? lista : [];
    }

    function gruposVisibles() {
        if (!estado.tipo || estado.factura) return estado.grupos;
        const lista = estado.grupos.filter(g => tipoDeGrupo(g) === estado.tipo);
        return lista.length ? lista : estado.grupos;
    }

    function tiposHtml() {
        const tipos = tiposActivos();
        if (!tipos.length) return "";
        const chip = (valor, etiqueta, n) => `<button type="button" class="drm-linea${(estado.tipo || "") === valor ? " activa" : ""}" onclick="elegirTipoRecibirDueno(${JSON.stringify(valor).replace(/"/g, "&quot;")})">${esc(etiqueta)} <small>${n}</small></button>`;
        return chip("", "Todas", estado.grupos.length) + tipos.map(x => chip(x, x, estado.grupos.filter(g => tipoDeGrupo(g) === x).length)).join("");
    }

    window.elegirTipoRecibirDueno = function (tipo) {
        estado.tipo = tipo || "";
        const visibles = gruposVisibles();
        if (!visibles.some(g => g.marca === estado.marca)) estado.marca = esFerreteria() ? visibles[0].marca : "";
        estado.linea = "";
        estado.consulta = "";
        pintar();
        const c = document.getElementById("drmCapa");
        if (c) c.scrollTop = 0;
    };

    // Abarrotes: primero las tarjetas de marca; al elegir una, solo se ven sus productos (con un boton para volver a las tarjetas).
    const modoTarjetas = () => !esFerreteria() && !estado.factura && !(estado.consulta || "").trim();

    function marcasHtml(grupo) {
        const coinciden = marcasQueCoinciden();

        if (modoTarjetas() && estado.marca) {
            return `<div class="drm-volver"><button type="button" onclick="cambiarMarcaRecibirDueno()">‹ Cambiar marca</button><b>${esc(estado.marca)}</b></div>`;
        }

        const iniciales = texto => String(texto || "?").trim().split(/\s+/).slice(0, 2).map(w => w.charAt(0).toUpperCase()).join("");
        const lista = (coinciden.length ? coinciden : gruposVisibles());
        const html = lista.map(g => {
            const llevo = g.productos.reduce((s, p) => s + (estado.cantidades.get(p.id) > 0 ? 1 : 0), 0);
            return `<button type="button" class="drm-marca${g === grupo && (estado.marca || !modoTarjetas()) ? " activa" : ""}" style="--marca:${g.color}" onclick="elegirMarcaRecibirDueno(${JSON.stringify(g.marca).replace(/"/g, "&quot;")})">
                ${modoTarjetas() ? `<span class="drm-logo drm-logo-grande"><span class="drm-ini">${esc(iniciales(g.marca))}</span>${g.logo ? `<img src="${esc(g.logo)}" alt="" loading="lazy" onerror="this.remove()">` : ""}</span>` : (g.logo ? `<span class="drm-logo"><img src="${esc(g.logo)}" alt=""></span>` : "")}<b>${esc(g.marca)}</b><small>${g.productos.length} ${pluralProducto(g.productos.length)}${estado.modo === "sugerir" ? textoPorPedirDueno(g) : (llevo ? ` · ${llevo} con entrada` : "")}</small></button>`;
        }).join("");
        return modoTarjetas() ? `<div class="drm-tarjetas">${html}</div>` : html;
    }

    window.cambiarMarcaRecibirDueno = function () {
        estado.marca = "";
        estado.linea = "";
        estado.consulta = "";
        pintar();
        const c = document.getElementById("drmCapa");
        if (c) c.scrollTop = 0;
    };

    // La rejilla se dibuja por tandas (la primera ya viene en el HTML y el resto en los siguientes cuadros): con cientos de fotos juntas la pantalla se trababa.
    const TANDA_TARJETAS = 4;
    const PRESUPUESTO_CUADRO_MS = 8;
    let tokenRejilla = 0;

    function gridHtml(limite = Infinity) {
        const lista = productosVisibles();
        if (lista.length) return lista.slice(0, limite).map(tarjetaHtml).join("");
        return `<p class="drm-vacio">${(estado.consulta || "").trim() ? "No encontré nada con eso. Prueba con otra palabra o escanea el código." : (!estado.marca && modoTarjetas() ? "Elige una marca para ver sus productos." : "Esta marca no tiene productos.")}</p>`;
    }

    function completarGrid() {
        const token = ++tokenRejilla;
        const lista = productosVisibles();
        let desde = TANDA_TARJETAS;
        if (lista.length <= desde) return;

        const paso = () => {
            const grid = document.getElementById("drmGrid");
            if (token !== tokenRejilla || !estado || !grid) return;
            // Se agregan tarjetas mientras quepan en ~8 ms: nunca se bloquea un cuadro (y la animacion) por dibujar muchas fotos juntas.
            const limite = performance.now() + PRESUPUESTO_CUADRO_MS;
            // Una tarjeta a la vez, con su foto: asignar la foto es lo que mas cuesta, asi que entra en el presupuesto del cuadro.
            do {
                grid.insertAdjacentHTML("beforeend", tarjetaHtml(lista[desde++]));
                ponerFotos(grid.lastElementChild);
            } while (desde < lista.length && performance.now() < limite);
            if (desde < lista.length) requestAnimationFrame(paso);
        };

        requestAnimationFrame(paso);
    }

    function pintar() {
        const c = capa();
        const grupo = estado.grupos.find(g => g.marca === estado.marca) || estado.grupos[0];
        const t = totales();

        c.classList.toggle("drm-modo-factura", Boolean(estado.factura));
        c.innerHTML = `
            <div class="drm-tope">
            <header class="drm-cabeza">
                <button type="button" class="drm-atras" onclick="cerrarRecibirMarcaDueno()">‹ Atrás</button>
                <h2>${estado.modo === "sugerir" ? "Sugerir pedido" : esPedidoDueno() ? "Crear pedido" : (estado.factura ? "Recibir con factura" : (esFerreteria() ? "Recibir por marca" : "Recibir mercancía"))}</h2>
                <span id="drmFactBtn" class="drm-fact-lugar">${botonFacturasHtml()}</span>
            </header>
            <div class="drm-buscar">
                <input id="drmBuscar" type="search" inputmode="search" enterkeyhint="search" autocomplete="off" placeholder="Buscar nombre o código" value="${esc(estado.consulta || "")}" oninput="buscarRecibirDueno(this.value)" onkeydown="if(event.key==='Enter'){ event.preventDefault(); codigoRecibirDueno(this.value); }">
                <button type="button" class="drm-escanear" onclick="escanearRecibirDueno()" aria-label="Escanear código de barras">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7V5a2 2 0 0 1 2-2h2"/><path d="M17 3h2a2 2 0 0 1 2 2v2"/><path d="M21 17v2a2 2 0 0 1-2 2h-2"/><path d="M7 21H5a2 2 0 0 1-2-2v-2"/><line x1="7" y1="12" x2="17" y2="12"/></svg><span>Escanear</span>
                </button>
            </div>
            <div class="drm-facturas" id="drmFacturas">${facturasHtml()}</div>
            <nav class="drm-lineas drm-tipos" id="drmTipos" aria-label="Tipo de producto">${tiposHtml()}</nav>
            <nav class="drm-marcas" id="drmMarcas" aria-label="Marcas">${marcasHtml(grupo)}</nav>
            <nav class="drm-lineas" id="drmLineas" aria-label="Líneas de la marca">${lineasHtml()}</nav>
            </div>
            <div class="drm-grid" id="drmGrid">${gridHtml(TANDA_TARJETAS)}</div>
            <footer class="drm-pie">
                <button type="button" class="drm-resumen-abrir" onclick="abrirResumenRecibirDueno()" ${t.productos ? "" : "disabled"} aria-label="Ver el resumen de lo que llegó">
                    <span class="drm-flecha" aria-hidden="true">▲</span><span class="drm-totales">${textoTotales(t)}</span>
                </button>
                <button type="button" class="drm-confirmar" id="drmConfirmar" onclick="confirmarRecibirMarcaDueno()" ${t.productos && !estado.enviando ? "" : "disabled"}>${estado.enviando ? "Guardando…" : (esPedidoDueno() ? "Guardar pedido" : "Confirmar recepción")}</button>
            </footer>
            ${estado.resumen ? resumenHtml() : ""}`;
        ponerFotos(c);
        completarGrid();
    }

    // ---- Resumen a pantalla completa: todo lo que llevas, por marca, editable; se baja para seguir recibiendo ----
    function resumenHtml() {
        const t = totales();
        const porGrupo = estado.grupos.map(g => ({ g, filas: g.productos.filter(p => estado.cantidades.get(p.id) > 0) })).filter(x => x.filas.length);
        const enGrupos = new Set(porGrupo.flatMap(x => x.filas.map(p => p.id)));
        const sueltas = [...estado.cantidades.entries()].filter(([id, n]) => n > 0 && !enGrupos.has(id)).map(([id]) => estado.indice.get(id)).filter(Boolean);
        if (sueltas.length) porGrupo.push({ g: { marca: "Otros", color: "#475569" }, filas: sueltas });

        const fila = p => {
            const n = estado.cantidades.get(p.id) || 0;
            const hay = Number(p.stock) || 0;
            return `<li class="drm-res-fila">
                <span class="drm-res-foto">${p.imagenUrl ? `<img src="${esc(fotoMiniDueno(p.imagenUrl))}" alt="" loading="lazy">` : ""}</span>
                <span class="drm-res-texto"><b>${esc(p.nombre)}</b><small>${esPedidoDueno() ? `Hay ${esc(String(hay))}` : `Hay ${esc(String(hay))} → quedan ${esc(String(Math.round((hay + n) * 1000) / 1000))}`}</small></span>
                <span class="drm-res-cant">
                    <button type="button" aria-label="Quitar uno" onclick="ajustarResumenRecibirDueno(${Number(p.id)}, -1)">−</button>
                    <input type="text" inputmode="numeric" value="${n}" aria-label="Llegaron" onchange="escribirResumenRecibirDueno(${Number(p.id)}, this.value)">
                    <button type="button" aria-label="Agregar uno" onclick="ajustarResumenRecibirDueno(${Number(p.id)}, 1)">+</button>
                </span>
            </li>`;
        };

        return `<section class="drm-resumen" id="drmResumen" aria-label="Resumen de la recepción">
            <header class="drm-res-cabeza">
                <button type="button" class="drm-res-bajar" onclick="cerrarResumenRecibirDueno()"><span aria-hidden="true">▼</span> ${esPedidoDueno() ? "Seguir pidiendo" : "Seguir recibiendo"}</button>
                <h2>Resumen</h2>
            </header>
            <div class="drm-res-cuerpo">${porGrupo.map(x => `
                <h3 class="drm-res-marca" style="--marca:${x.g.color}">${esc(x.g.marca)} <small>${x.filas.length} ${pluralProducto(x.filas.length)} · ${x.filas.reduce((s, p) => s + (estado.cantidades.get(p.id) || 0), 0)} ${pluralPieza(x.filas.reduce((s, p) => s + (estado.cantidades.get(p.id) || 0), 0))}</small></h3>
                <ul class="drm-res-lista">${x.filas.map(fila).join("")}</ul>`).join("") || `<p class="drm-vacio">Todavía no has anotado nada.</p>`}</div>
            <footer class="drm-pie drm-res-pie">
                <div class="drm-totales">${textoTotales(t)}</div>
                <button type="button" class="drm-confirmar" onclick="confirmarRecibirMarcaDueno()" ${t.productos && !estado.enviando ? "" : "disabled"}>${estado.enviando ? "Guardando…" : (esPedidoDueno() ? "Guardar pedido" : "Confirmar recepción")}</button>
            </footer>
        </section>`;
    }

    function repintarResumen() {
        const actual = document.getElementById("drmResumen");
        if (!actual || !estado) return;
        const tope = actual.querySelector(".drm-res-cuerpo")?.scrollTop || 0;
        actual.outerHTML = resumenHtml();
        const nuevo = document.querySelector("#drmResumen .drm-res-cuerpo");
        if (nuevo) nuevo.scrollTop = tope;
    }

    window.abrirResumenRecibirDueno = function () {
        if (!estado || !totales().productos) return;
        estado.resumen = true;
        capa().insertAdjacentHTML("beforeend", resumenHtml());
        document.body.classList.add("drm-con-resumen");
    };

    window.cerrarResumenRecibirDueno = function () {
        if (!estado) return;
        estado.resumen = false;
        document.getElementById("drmResumen")?.remove();
        document.body.classList.remove("drm-con-resumen");
    };

    window.ajustarResumenRecibirDueno = function (id, delta) {
        if (estado.tocados) estado.tocados.add(Number(id));
        window.ajustarRecibirDueno(id, delta);
        if (!totales().productos) { window.cerrarResumenRecibirDueno(); return; }
        repintarResumen();
    };

    window.escribirResumenRecibirDueno = function (id, texto) {
        if (estado.tocados) estado.tocados.add(Number(id));
        window.escribirRecibirDueno(id, texto);
        if (!totales().productos) { window.cerrarResumenRecibirDueno(); return; }
        repintarResumen();
    };

    // ---- Buscador y escaner ----
    window.buscarRecibirDueno = function (texto) {
        estado.consulta = texto;
        const grid = document.getElementById("drmGrid");
        if (grid) { grid.innerHTML = gridHtml(TANDA_TARJETAS); ponerFotos(grid); completarGrid(); }
        const marcas = document.getElementById("drmMarcas");
        if (marcas) marcas.innerHTML = marcasHtml(estado.grupos.find(g => g.marca === estado.marca) || estado.grupos[0]);
        document.getElementById("drmCapa")?.classList.toggle("drm-buscando", Boolean((texto || "").trim()));
    };

    function productoPorCodigo(codigo) {
        const limpio = nc(codigo);
        if (limpio.length < 3) return null;
        return estado.todos.find(p => nc(p.codigo) === limpio) || null;
    }

    let temporizadorTarjeta = null;

    // Tarjetita corta al escanear: foto, nombre y cuantas llevas de ese producto.
    function mostrarTarjetaEscaneo(p, texto, error = false) {
        let el = document.getElementById("drmAviso");
        if (!el) { el = document.createElement("div"); el.id = "drmAviso"; el.className = "drm-aviso"; document.body.appendChild(el); }

        el.className = "drm-aviso visible" + (error ? " error" : "");
        el.innerHTML = p
            ? `<span class="drm-aviso-foto">${p.imagenUrl ? `<img src="${esc(p.imagenUrl)}" alt="">` : ""}</span><span class="drm-aviso-texto"><b>${esc(p.nombre)}</b><small>${esc(texto)}</small></span><span class="drm-aviso-n">+1</span>`
            : `<span class="drm-aviso-texto"><b>${esc(texto)}</b></span>`;
        clearTimeout(temporizadorTarjeta);
        temporizadorTarjeta = setTimeout(() => el.classList.remove("visible"), 2400);
    }

    function agregarPorCodigo(codigo) {
        if (!estado) return false;

        const p = productoPorCodigo(codigo);

        if (!p) { mostrarTarjetaEscaneo(null, `No encontré el código ${String(codigo).trim()}`, true); return false; }

        window.ajustarRecibirDueno(p.id, 1);
        if (estado.resumen) repintarResumen();
        mostrarTarjetaEscaneo(p, `Llevas ${estado.cantidades.get(p.id)}`);
        const marcas = document.getElementById("drmMarcas");
        if (marcas) marcas.innerHTML = marcasHtml(estado.grupos.find(g => g.marca === estado.marca) || estado.grupos[0]);
        return true;
    }

    // Enter en el buscador: si lo escrito es un codigo exacto (lo que manda un lector de codigos), suma uno y deja el campo listo.
    window.codigoRecibirDueno = function (texto) {
        const limpio = String(texto || "").trim();
        if (!limpio) return;

        if (productoPorCodigo(limpio)) {
            agregarPorCodigo(limpio);
            const campo = document.getElementById("drmBuscar");
            if (campo) { campo.value = ""; campo.focus(); }
            window.buscarRecibirDueno("");
        }
    };

    window.escanearRecibirDueno = function () {
        if (typeof abrirEscanerCodigoDueno !== "function") return;
        abrirEscanerCodigoDueno({ titulo: "Escanear mercancía", continuo: true, alCodigo: codigo => { agregarPorCodigo(codigo); } });
    };

    // Repinta solo la tarjeta y el pie al teclear (para no perder el cursor del campo).
    function actualizarTarjeta(id) {
        const tarjeta = document.querySelector(`#drmCapa .drm-tarjeta[data-id="${id}"]`);
        const n = estado.cantidades.get(id) || 0;
        if (tarjeta) {
            tarjeta.classList.toggle("con-entrada", n > 0);
            const esperado = estado.indice.get(id)?.esperado;
            tarjeta.querySelector(".drm-esperado")?.classList.toggle("dif", esperado != null && n > 0 && n !== esperado);
            const campo = tarjeta.querySelector(".drm-cantidad input");
            if (campo && document.activeElement !== campo) campo.value = n || "";
        }

        const t = totales();
        document.querySelectorAll("#drmCapa .drm-pie:not(.drm-res-pie) .drm-totales").forEach(e => { e.innerHTML = textoTotales(t); });
        const boton = document.getElementById("drmConfirmar");
        if (boton) boton.disabled = !t.productos || estado.enviando;
        const abrir = document.querySelector("#drmCapa .drm-resumen-abrir");
        if (abrir) abrir.disabled = !t.productos;
    }

    window.ajustarRecibirDueno = function (id, delta) {
        if (estado.tocados) estado.tocados.add(Number(id));
        const nuevo = Math.max(0, Math.round(((estado.cantidades.get(id) || 0) + delta) * 1000) / 1000);
        estado.cantidades.set(id, nuevo);
        actualizarTarjeta(id);
    };

    window.elegirLineaRecibirDueno = function (linea) {
        estado.linea = linea || "";
        estado.consulta = "";
        const campo = document.getElementById("drmBuscar");
        if (campo) campo.value = "";
        document.getElementById("drmCapa")?.classList.remove("drm-buscando");
        const grid = document.getElementById("drmGrid");
        if (grid) { grid.innerHTML = gridHtml(TANDA_TARJETAS); ponerFotos(grid); completarGrid(); }
        const barra = document.getElementById("drmLineas");
        if (barra) barra.innerHTML = lineasHtml();
        const c = document.getElementById("drmCapa");
        if (c) c.scrollTop = 0;
        barra?.querySelector(".drm-linea.activa")?.scrollIntoView({ inline: "center", block: "nearest" });
    };

    window.escribirRecibirDueno = function (id, texto) {
        if (estado.tocados) estado.tocados.add(Number(id));
        const n = Number(String(texto).replace(/[^0-9.]/g, ""));
        estado.cantidades.set(id, Number.isFinite(n) && n > 0 ? n : 0);
        actualizarTarjeta(id);
    };

    window.elegirMarcaRecibirDueno = function (marca) {
        if (estado.modo === "sugerir") rellenarSugeridosDueno(marca);
        estado.marca = marca;
        estado.linea = "";
        estado.consulta = "";
        pintar();
        // Arriba de la lista de esa marca, y la marca elegida a la vista en la fila de marcas.
        const c = document.getElementById("drmCapa");
        if (c) c.scrollTop = 0;
        document.querySelector("#drmCapa .drm-marca.activa")?.scrollIntoView({ inline: "center", block: "nearest" });
    };

    window.cerrarRecibirMarcaDueno = function () {
        if (!estado) { sesionAbrir++; document.getElementById("drmCapa")?.classList.remove("abierta"); document.body.classList.remove("drm-abierta", "drm-con-resumen"); return; }

        if (estado && totales().productos && !window.confirm("Tienes cantidades sin guardar. ¿Salir sin confirmar?")) return;
        document.getElementById("drmCapa")?.classList.remove("abierta");
        document.body.classList.remove("drm-abierta", "drm-con-resumen");
        estado = null;
    };

    const COLORES_EXHIBIDOR = { azul: "#1d4ed8", naranja: "#ea580c", verde: "#15803d", rojo: "#dc2626", morado: "#7e22ce", negro: "#1f2937" };

    // Los exhibidores del negocio mandan (con su logo y su color); lo que no esta en ninguno se agrupa solo por marca.
    async function gruposConExhibidores(productos) {
        try {
            let lista = (await fetchAutenticado("/exhibidores"))?.exhibidores || [];
            let usables = lista.filter(x => x.activo !== false && x.totalEspacios > 0);

            // Primera vez en un abarrotes: se arman solos los exhibidores por marca (catalogo de marcas de Nexo) y se vuelve a leer.
            if (!usables.length) {
                try {
                    const armado = await fetchAutenticado("/exhibidores/marcas/armar", { method: "POST" });
                    if (armado?.colocados) {
                        lista = (await fetchAutenticado("/exhibidores"))?.exhibidores || [];
                        usables = lista.filter(x => x.activo !== false && x.totalEspacios > 0);
                    }
                } catch (errorArmar) { /* sin red o sin permiso: se agrupa por marca como antes */ }
            }

            if (!usables.length) return agrupar(productos);

            const porId = new Map(productos.map(p => [Number(p.id), p]));
            const detalles = await Promise.all(usables.map(x => fetchAutenticado("/exhibidores/" + x.id).then(d => d?.exhibidor).catch(() => null)));
            const usados = new Set();
            const grupos = [];

            detalles.forEach((d, i) => {
                if (!d) return;
                const lista = d.espacios.map(e => {
                    const base = porId.get(Number(e.productoId)) || { id: e.productoId, nombre: e.nombre, imagenUrl: null };
                    usados.add(Number(e.productoId));
                    return { ...base, stock: Number(e.existencia ?? base.stock) || 0 };
                });
                if (lista.length) grupos.push({ marca: d.nombre, color: COLORES_EXHIBIDOR[d.color] || "#1d4ed8", logo: usables[i].foto || d.foto || null, productos: lista });
            });

            grupos.forEach(g => { const d = directorio && directorio.porNombre.get(plano(g.marca)); if (d) { g.dir = d; if (!g.logo) g.logo = urlImagenMarca(d); } });
            const resto = productos.filter(p => !usados.has(Number(p.id)));
            const extra = resto.length ? agrupar(resto) : [];
            return grupos.concat(extra).length ? grupos.concat(extra) : agrupar(productos);
        } catch (error) {
            return agrupar(productos);
        }
    }

    // ---- Facturas por recibir (Recepcion inteligente) dentro de esta misma pantalla, y proveedor al recibir a mano ----
    function avisar(mensaje) {
        if (window.NexoMovil && window.NexoMovil.aviso) window.NexoMovil.aviso(mensaje);
        else if (typeof mostrarToastDueno === "function") mostrarToastDueno(mensaje);
    }

    const dinero0 = v => "$" + Number(v || 0).toLocaleString("es-MX", { maximumFractionDigits: 2 });

    // Reparte lo que se conto de un producto entre los renglones de la factura que lo traen (casi siempre uno): cada renglon recibe hasta lo que
    // esperaba y lo que sobre va al ultimo. Lo no contado es 0.
    function repartirRecibido(itemIds, esperados, contado) {
        let resto = Number(contado) || 0;
        const salida = {};

        itemIds.forEach((id, i) => {
            const ultimo = i === itemIds.length - 1;
            const parte = ultimo ? resto : Math.min(Number(esperados[i]) || 0, resto);
            salida[id] = Math.max(0, Math.round(parte * 1000) / 1000);
            resto -= parte;
        });

        return salida;
    }

    function facturasHtml() {
        if (estado.factura) {
            const f = estado.factura;
            return `<div class="drm-factura-banner">
                <div><b>📄 ${esc(f.proveedor)}</b><small>${f.folio ? "Folio " + esc(f.folio) + " · " : ""}${f.cards.length} concepto${f.cards.length === 1 ? "" : "s"} · ${dinero0(f.total)}</small></div>
                <button type="button" class="drm-factura-todo" onclick="marcarTodoFacturaRecibirDueno()">Llegó todo</button>
                <button type="button" class="drm-factura-salir" onclick="salirFacturaRecibirDueno()">Salir</button>
                ${f.porDecidir ? `<p class="drm-factura-aviso">${f.porDecidir} concepto${f.porDecidir === 1 ? "" : "s"} por decidir (producto nuevo o sin emparejar). Resuélvelos en <button type="button" onclick="cerrarRecibirMarcaDueno(); dfAbrir()">Recibir factura</button> antes de confirmar.</p>` : ""}
            </div>`;
        }

        return "";
    }

    function botonFacturasHtml() {
        if (!estado || estado.factura || esPedidoDueno() || !estado.facturas.length) return "";
        return `<button type="button" class="drm-fact-btn" onclick="abrirListaFacturasRecibirDueno()" aria-label="Facturas por recibir"><span aria-hidden="true">📄</span><b>${estado.facturas.length}</b></button>`;
    }

    window.abrirListaFacturasRecibirDueno = function () {
        if (!estado || !estado.facturas.length) return;
        const fondo = document.createElement("div");
        fondo.className = "drm-hoja-fondo";
        fondo.innerHTML = `<div class="drm-hoja" role="dialog" aria-label="Facturas por recibir"><h3>Facturas por recibir</h3>
            <p>Llegaron a tu correo o las subiste en la computadora. Elige una para recibirla con las tarjetas.</p>
            <div class="drm-hoja-lista">${estado.facturas.map(x => `<button type="button" data-i="${Number(x.id)}">${esc(x.proveedor)}<small>${x.folio ? "Folio " + esc(x.folio) + " · " : ""}${x.totalItems} producto${x.totalItems === 1 ? "" : "s"} · ${dinero0(x.total)}${x.porRevisar ? " · " + x.porRevisar + " por decidir" : ""}</small></button>`).join("")}</div>
            <button type="button" class="drm-hoja-cancelar" data-i="x">Cerrar</button></div>`;
        fondo.addEventListener("click", e => {
            const i = e.target.dataset?.i;
            if (i === undefined && e.target !== fondo) return;
            fondo.remove();
            if (i && i !== "x") window.abrirFacturaRecibirDueno(Number(i));
        });
        document.body.appendChild(fondo);
    };

    function repintarFacturas() {
        const caja = document.getElementById("drmFacturas");
        if (caja && estado) caja.innerHTML = facturasHtml();
        const boton = document.getElementById("drmFactBtn");
        if (boton && estado) boton.innerHTML = botonFacturasHtml();
    }

    // Lo que no bloquea abrir la pantalla: la lista de proveedores y las facturas pendientes llegan despues.
    async function cargarExtras(mio) {
        try {
            const p = await fetchAutenticado("/proveedores");
            if (estado === mio) mio.proveedores = (p?.proveedores || []).map(x => ({ id: x.id, nombre: x.nombre, diasCredito: x.dias_credito })).filter(x => x.nombre);
        } catch (error) { /* sin proveedores: se recibe como antes */ }

        try {
            const r = await fetchAutenticado("/recepcion-inteligente/facturas");
            if (estado === mio) { mio.facturas = (r?.facturas || []).filter(f => f.estado === "pendiente"); repintarFacturas(); }
        } catch (error) { /* sin permiso o sin Recepcion inteligente: no se ofrece */ }
    }

    window.abrirFacturaRecibirDueno = async function (id) {
        if (!estado || estado.enviando) return;
        if (totales().productos && !window.confirm("Lo que ya anotaste en esta pantalla se descarta al abrir la factura. ¿Continuar?")) return;

        let datos;
        try { datos = await fetchAutenticado(`/recepcion-inteligente/facturas/${id}`); } catch (error) { avisar("No se pudo abrir la factura."); return; }

        const lista = estado.facturas.find(f => Number(f.id) === Number(id)) || {};
        const items = (datos?.items || []).filter(i => i.accion && i.accion !== "omitir");
        const porDecidir = (datos?.items || []).filter(i => !i.accion).length;
        const porCard = new Map();

        items.forEach(i => {
            const pid = Number(i.productoId) > 0 ? Number(i.productoId) : -Number(i.id);
            const base = estado.indice.get(pid) || { id: pid, nombre: i.descripcion || "Producto", imagenUrl: null, stock: 0, codigo: i.codigo };
            const card = porCard.get(pid) || { ...base, id: pid, esperado: 0, itemIds: [], esperados: [], nuevoProducto: !(Number(i.productoId) > 0) };
            card.esperado += Number(i.cantidad) || 0;
            card.itemIds.push(i.id);
            card.esperados.push(Number(i.cantidad) || 0);
            porCard.set(pid, card);
        });

        const cards = [...porCard.values()];
        estado.respaldo = estado.respaldo || { grupos: estado.grupos, todos: estado.todos, indice: estado.indice, marca: estado.marca };
        estado.factura = { id, proveedor: lista.proveedor || datos?.recepcion?.proveedor || "Proveedor", folio: lista.folio || datos?.recepcion?.folio || "", total: Number(lista.total || datos?.recepcion?.total || 0), cards, porDecidir };
        estado.grupos = [{ marca: "Factura", color: "#0f766e", productos: cards }];
        estado.marca = "Factura";
        estado.todos = cards;
        estado.indice = new Map(cards.map(c => [c.id, c]));
        estado.cantidades = new Map();
        estado.consulta = "";
        estado.linea = "";
        pintar();
        const c = document.getElementById("drmCapa");
        if (c) c.scrollTop = 0;
    };

    window.salirFacturaRecibirDueno = function () {
        if (!estado || !estado.factura) return;
        if (totales().productos && !window.confirm("Lo que anotaste de esta factura se descarta. ¿Salir?")) return;

        Object.assign(estado, estado.respaldo, { factura: null, respaldo: null, cantidades: new Map(), consulta: "", linea: "" });
        pintar();
    };

    window.marcarTodoFacturaRecibirDueno = function () {
        if (!estado?.factura) return;

        estado.factura.cards.forEach(c => estado.cantidades.set(c.id, c.esperado));
        pintar();
    };

    window.llegoTodoRecibirDueno = function (id) {
        const c = estado.indice.get(id);
        if (!c || c.esperado == null) return;

        estado.cantidades.set(id, c.esperado);
        actualizarTarjeta(id);
        if (estado.resumen) repintarResumen();
    };

    async function confirmarFactura() {
        const f = estado.factura;

        if (f.porDecidir) {
            const d = await window.NexoMovil.dialogo({
                titulo: "Faltan conceptos por decidir",
                texto: `Esta factura trae ${f.porDecidir} concepto${f.porDecidir === 1 ? "" : "s"} que Nexo no pudo emparejar (productos nuevos o sin reconocer). Decídelos en Recibir factura y luego confirma.`,
                aceptar: "Ir a decidirlos",
                cancelar: "Ahora no"
            });

            if (d.ok) {
                const id = f.id;
                estado = null;
                document.getElementById("drmCapa")?.classList.remove("abierta");
                document.body.classList.remove("drm-abierta", "drm-con-resumen");
                if (typeof window.dfVerificar === "function") window.dfVerificar(id);
            }
            return;
        }

        const cantidadesRecibidas = {};
        let sinContar = 0, distintos = 0;

        f.cards.forEach(c => {
            const n = estado.cantidades.get(c.id) || 0;
            if (!n) sinContar++; else if (n !== c.esperado) distintos++;
            Object.assign(cantidadesRecibidas, repartirRecibido(c.itemIds, c.esperados, n));
        });

        const d = await window.NexoMovil.dialogo({
            titulo: "¿Confirmar la recepción?",
            texto: `Se suma al inventario lo que contaste.${distintos ? ` ${distintos} producto(s) llegaron distinto a la factura.` : ""}${sinContar ? ` ${sinContar} producto(s) sin cantidad se reciben en 0.` : ""}`,
            aceptar: "Confirmar"
        });

        if (!d.ok) return;

        let pago = null;
        if (typeof window.pedirPagoCreditoDueno === "function") {
            const credito = await window.pedirPagoCreditoDueno({ proveedor: f.proveedor, montoSugerido: Number(f.total) || 0 });
            if (credito === null) return;
            pago = credito.pago || null;
        }

        estado.enviando = true;
        pintar();

        const r = typeof window.confirmarFacturaMovil === "function" ? await window.confirmarFacturaMovil(f.id, cantidadesRecibidas, {}, pago) : { ok: false, datos: { error: "No se pudo confirmar." } };

        if (r.cancelado || !r.ok) {
            estado.enviando = false;
            pintar();
            if (!r.cancelado) avisar(r.datos?.error || "No se pudo confirmar la factura.");
            return;
        }

        estado = null;
        document.getElementById("drmCapa")?.classList.remove("abierta");
        document.body.classList.remove("drm-abierta", "drm-con-resumen");
        avisar(r.datos?.conciliada ? "Factura confirmada: completó los costos de lo que ya habías recibido." : "Factura recibida: inventario actualizado.");
        if (typeof refrescarCatalogoLocalDueno === "function") await refrescarCatalogoLocalDueno();
        if (typeof filtrarInventarioDueno === "function") filtrarInventarioDueno();
    }

    // Hoja "¿De que proveedor viene?" al recibir a mano: con proveedor, la recepcion queda "sin factura" y cuando llegue su factura Nexo la compara.
    function elegirProveedor() {
        return new Promise(resolver => {
            const fondo = document.createElement("div");
            fondo.className = "drm-hoja-fondo";
            fondo.innerHTML = `<div class="drm-hoja" role="dialog" aria-label="Proveedor"><h3>¿De qué proveedor viene?</h3>
                <p>Si eliges uno y después te llega su factura por correo, Nexo la compara con lo que recibiste y no suma dos veces.</p>
                <div class="drm-hoja-lista">${estado.proveedores.slice(0, 40).map((p, i) => `<button type="button" data-i="${i}">${esc(p.nombre)}</button>`).join("")}</div>
                <button type="button" class="drm-hoja-sin" data-i="-1">Sin proveedor / no espero factura</button>
                <button type="button" class="drm-hoja-cancelar" data-i="x">Cancelar</button></div>`;
            fondo.addEventListener("click", e => {
                const i = e.target.dataset?.i;
                if (i === undefined && e.target !== fondo) return;
                fondo.remove();
                if (i === undefined || i === "x") resolver({ cancelado: true });
                else resolver({ proveedor: i === "-1" ? null : estado.proveedores[Number(i)] });
            });
            document.body.appendChild(fondo);
        });
    }

    // ---- Sugerir pedido: minimo y maximo por producto (igual que en el servidor, pedido-sugerido-calculo.js) ----
    const esPedidoDueno = () => Boolean(estado) && (estado.modo === "pedido" || estado.modo === "sugerir");

    function sugerenciaDueno(prod) {
        const c = (estado.comp && estado.comp[prod.id]) || {};
        const n = v => { const x = Number(v); return Number.isFinite(x) ? x : 0; };
        const min = n(prod.stock_minimo);
        const max = n(prod.stock_maximo);
        const proyectado = Math.round((n(prod.stock) + n(c.enCamino) - n(c.encargado)) * 1000) / 1000;

        if (!(min > 0) || !(max > 0) || max < min) return { estado: "sin-limites", pedir: 0, proyectado };
        if (proyectado > min) return { estado: "suficiente", pedir: 0, proyectado };
        return { estado: "pedir", pedir: Math.max(0, Math.ceil(max - proyectado)), proyectado };
    }

    function textoPorPedirDueno(g) {
        const cuantos = g.productos.filter(prod => sugerenciaDueno(prod).estado === "pedir").length;
        return cuantos ? ` · ${cuantos} por pedir` : "";
    }

    function minMaxHtmlDueno(prod) {
        const s = sugerenciaDueno(prod);
        const c = (estado.comp && estado.comp[prod.id]) || {};
        const piezas = v => String(Math.round((Number(v) || 0) * 1000) / 1000);
        const detalle = `hay ${piezas(prod.stock)}${c.enCamino ? ` + ${piezas(c.enCamino)} en camino` : ""}${c.encargado ? ` - ${piezas(c.encargado)} encargado${Number(c.encargado) === 1 ? "" : "s"}` : ""}`;
        const texto = s.estado === "pedir"
            ? `Pedir ${piezas(s.pedir)}: ${detalle}, mínimo ${piezas(prod.stock_minimo)}, máximo ${piezas(prod.stock_maximo)}`
            : (s.estado === "suficiente" ? `Tienes suficiente (${detalle})` : "Pon mínimo y máximo para que Nexo calcule");

        return `<div class="drm-minmax drm-${s.estado}">
            <div class="drm-limites"><label>Mín <input type="text" class="drm-min" inputmode="decimal" value="${Number(prod.stock_minimo) > 0 ? esc(String(prod.stock_minimo)) : ""}" onchange="limitesRecibirDueno(${Number(prod.id)})"></label><label>Máx <input type="text" class="drm-max" inputmode="decimal" value="${Number(prod.stock_maximo) > 0 ? esc(String(prod.stock_maximo)) : ""}" onchange="limitesRecibirDueno(${Number(prod.id)})"></label></div>
            <small>${esc(texto)}</small></div>`;
    }

    // Al elegir una marca se llenan las cantidades sugeridas (lo que anotaste a mano no se toca).
    function rellenarSugeridosDueno(marca) {
        const g = estado.grupos.find(x => x.marca === marca);
        if (!g) return;
        g.productos.forEach(prod => {
            if (estado.tocados.has(Number(prod.id))) return;
            const s = sugerenciaDueno(prod);
            if (s.pedir > 0) estado.cantidades.set(prod.id, s.pedir); else estado.cantidades.delete(prod.id);
        });
    }

    // Guarda el minimo y el maximo del producto y recalcula lo que hay que pedir.
    window.limitesRecibirDueno = async function (id) {
        const el = document.querySelector(`#drmCapa .drm-tarjeta[data-id="${id}"]`);
        const prod = estado && estado.indice.get(Number(id));
        if (!el || !prod) return;

        const minimo = el.querySelector(".drm-min").value.trim().replace(",", ".");
        const maximo = el.querySelector(".drm-max").value.trim().replace(",", ".");
        if ((minimo !== "" && !(Number(minimo) >= 0)) || (maximo !== "" && !(Number(maximo) >= 0))) { avisar("El mínimo y el máximo deben ser números."); return; }

        try {
            await fetchAutenticado(`/productos/${Number(id)}/edicion-rapida`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ stockMinimo: minimo === "" ? null : Number(minimo), stockMaximo: maximo === "" ? null : Number(maximo) })
            });
        } catch (error) { avisar(error.message || "No se pudo guardar el mínimo y el máximo."); return; }

        prod.stock_minimo = minimo === "" ? 3 : Number(minimo);
        prod.stock_maximo = maximo === "" ? null : Number(maximo);
        estado.tocados.delete(Number(id));
        const s = sugerenciaDueno(prod);
        if (s.pedir > 0) estado.cantidades.set(Number(id), s.pedir); else estado.cantidades.delete(Number(id));

        el.outerHTML = tarjetaHtml(prod);
        ponerFotos(document.querySelector(`#drmCapa .drm-tarjeta[data-id="${id}"]`));
        actualizarTarjeta(Number(id));
    };

    // ---- Crear pedido: lo anotado se guarda como pedido a proveedor (borrador o ya enviado), no como recepcion ----
    function elegirEstadoPedido(resumen) {
        return new Promise(resolver => {
            const fondo = document.createElement("div");
            fondo.className = "drm-hoja-fondo";
            fondo.innerHTML = `<div class="drm-hoja" role="dialog" aria-label="Guardar pedido"><h3>Guardar pedido</h3>
                <p>${esc(resumen)}</p>
                <button type="button" class="drm-hoja-sin" data-i="borrador">Guardar (sin enviar todavía)</button>
                <button type="button" class="drm-hoja-sin" data-i="enviado">Guardar y marcar como enviado</button>
                <button type="button" class="drm-hoja-cancelar" data-i="x">Cancelar</button></div>`;
            fondo.addEventListener("click", e => {
                const i = e.target.dataset?.i;
                if (i === undefined && e.target !== fondo) return;
                fondo.remove();
                resolver(i === "borrador" || i === "enviado" ? i : null);
            });
            document.body.appendChild(fondo);
        });
    }

    async function guardarPedidoDueno() {
        const items = [];
        estado.cantidades.forEach((n, id) => {
            const prod = estado.indice.get(id);
            if (n > 0 && prod) items.push({ productoId: id, codigo: prod.codigo, nombre: prod.nombre, cantidad: n, costo: Number(prod.costo) > 0 ? Number(prod.costo) : 0, unidad: "pieza" });
        });
        if (!items.length) return;

        const marcas = estado.grupos.filter(g => g.productos.some(prod => estado.cantidades.get(prod.id) > 0)).map(g => g.marca);
        const proveedor = marcas.length <= 3 ? marcas.join(", ") : marcas.slice(0, 3).join(", ") + "…";
        const piezas = items.reduce((s, i) => s + i.cantidad, 0);
        const elegido = await elegirEstadoPedido(`Pedido de ${proveedor || "varias marcas"}: ${items.length} ${pluralProducto(items.length)} y ${piezas} ${pluralPieza(piezas)}.`);
        if (!elegido) return;

        estado.enviando = true;
        pintar();

        try {
            await fetchAutenticado("/pedidos-proveedor", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ proveedor, estado: elegido, notas: estado.modo === "sugerir" ? "Sugerido por Nexo (mínimos y máximos, celular)" : "Creado con Crear pedido (celular)", items: items.map(i => ({ ...i, proveedor })) })
            });

            estado = null;
            document.getElementById("drmCapa")?.classList.remove("abierta");
            document.body.classList.remove("drm-abierta", "drm-con-resumen");
            avisar(elegido === "enviado" ? "Pedido guardado y marcado como enviado." : "Pedido guardado como borrador.");
            if (typeof abrirPedidosHechosDueno === "function") abrirPedidosHechosDueno();
        } catch (error) {
            estado.enviando = false;
            pintar();
            avisar(error.message || "No se pudo guardar el pedido. Revisa tu internet y vuelve a intentar.");
        }
    }

    let sesionAbrir = 0;

    // Leer el catalogo completo del telefono (con todas sus fotos) es lo mas pesado al abrir: se guarda un minuto en memoria y se descarta
    // en cuanto el inventario se actualiza (despues de recibir, de editar un producto, etc.).
    let catalogoEnMemoria = null;
    const VIGENCIA_CATALOGO_MS = 180000;

    async function catalogoParaRecibir() {
        if (catalogoEnMemoria && Date.now() - catalogoEnMemoria.t < VIGENCIA_CATALOGO_MS) return catalogoEnMemoria.datos;
        const datos = typeof listarCatalogoLocalCompletoDueno === "function" ? await listarCatalogoLocalCompletoDueno() : [];
        // Un catalogo vacio nunca se guarda: puede ser que todavia se este sincronizando.
        if (datos && datos.length) catalogoEnMemoria = { t: Date.now(), datos };
        return datos;
    }

    ["refrescarCatalogoLocalDueno", "guardarCatalogoLocal"].forEach(nombre => {
        const original = window[nombre];
        if (typeof original !== "function") return;
        window[nombre] = function (...argumentos) { catalogoEnMemoria = null; return original.apply(this, argumentos); };
    });

    function esqueletoHtml() {
        return `<div class="drm-tope"><header class="drm-cabeza"><button type="button" class="drm-atras" onclick="cerrarRecibirMarcaDueno()">‹ Atrás</button><h2>Recibir por marca</h2></header>
            <div class="drm-esq-fila"><span class="drm-esq-bloque"></span></div></div>
            <div class="drm-grid">${"<div class=\"drm-tarjeta drm-esq\"><span class=\"drm-esq-foto\"></span><span class=\"drm-esq-linea\"></span><span class=\"drm-esq-linea corta\"></span></div>".repeat(6)}</div>`;
    }

    window.abrirRecibirMarcaDueno = async function (marcaInicial) {
        const sesion = ++sesionAbrir;
        const modo = window.__drmModo === "pedido" || window.__drmModo === "sugerir" ? window.__drmModo : "recibir";
        window.__drmModo = null;
        const inicio = performance.now();

        // La pantalla se abre YA (con un esqueleto) y la animacion corre ligera; el catalogo y los exhibidores se cargan despues.
        const c = capa();
        c.classList.remove("drm-modo-factura", "drm-buscando");
        c.innerHTML = esqueletoHtml();
        c.scrollTop = 0;
        c.classList.add("abierta");
        document.body.classList.add("drm-abierta");

        const cerrarEsqueleto = () => { if (sesion === sesionAbrir) { c.classList.remove("abierta"); document.body.classList.remove("drm-abierta", "drm-con-resumen"); } };

        let catalogo = [];
        try { await cargarDirectorioDueno(); } catch (error) { /* sin directorio */ }
        try { catalogo = await catalogoParaRecibir(); } catch (error) { catalogo = []; }

        if (sesion !== sesionAbrir) return;
        const productos = catalogo.filter(p => Number(p.id) > 0);

        if (!productos.length) { cerrarEsqueleto(); avisar("Todavía no hay productos en tu catálogo."); return; }

        const grupos = await gruposConExhibidores(productos);
        if (sesion !== sesionAbrir) return;

        const todos = grupos.flatMap(g => g.productos).concat(productos).filter((p, i, a) => a.findIndex(q => Number(q.id) === Number(p.id)) === i);
        estado = { modo, tocados: new Set(), comp: {}, grupos, todos, indice: new Map(todos.map(p => [Number(p.id), p])), consulta: "", linea: "", tipo: "", resumen: false, proveedores: [], facturas: [], factura: null, respaldo: null, marca: (grupos.find(g => g.marca === marcaInicial) || (esFerreteria() ? grupos[0] : { marca: "" })).marca, cantidades: new Map(), enviando: false, llave: (typeof crypto !== "undefined" && crypto.randomUUID) ? crypto.randomUUID() : `rm-${Date.now()}-${Math.random().toString(16).slice(2)}` };

        // El trabajo pesado (dibujar las tarjetas con sus fotos) espera a que termine la animacion de entrada.
        const falta = 320 - (performance.now() - inicio);
        if (falta > 0) await new Promise(r => setTimeout(r, falta));
        if (sesion !== sesionAbrir) return;

        if (modo === "sugerir") {
            try { const r = await fetchAutenticado("/pedido-minmax/comprometido"); estado.comp = (r && r.productos) || {}; } catch (error) { estado.comp = {}; }
            if (sesion !== sesionAbrir) return;
        }

        pintar();
        cargarExtras(estado);
    };

    window.confirmarRecibirMarcaDueno = async function () {
        if (!estado || estado.enviando) return;
        if (estado.factura) { await confirmarFactura(); return; }
        if (esPedidoDueno()) { await guardarPedidoDueno(); return; }

        const items = [];
        estado.cantidades.forEach((n, id) => { if (n > 0) items.push({ productoId: id, cantidad: n, costo: 0 }); });
        if (!items.length) return;

        const marcasConEntrada = estado.grupos.filter(g => g.productos.some(p => estado.cantidades.get(p.id) > 0)).map(g => g.marca);

        // Con proveedores guardados se pregunta de quien viene (opcional): asi la recepcion queda "sin factura" y se concilia con su factura.
        let proveedorElegido = null;
        if (estado.proveedores.length) {
            const e = await elegirProveedor();
            if (e.cancelado) return;
            proveedorElegido = e.proveedor;
        }

        // Agenda de pagos (si esta encendida): ¿quedo a deber? Si queda a credito con monto, se crea la cuenta por pagar con su fecha limite.
        let pago = null;
        if (typeof window.pedirPagoCreditoDueno === "function") {
            const credito = await window.pedirPagoCreditoDueno({ proveedor: proveedorElegido ? proveedorElegido.nombre : (marcasConEntrada.length === 1 ? marcasConEntrada[0] : ""), montoSugerido: 0 });
            if (credito === null) return;
            pago = credito.pago || null;
        }

        estado.enviando = true;
        pintar();

        try {
            const respuesta = await fetchAutenticado("/recepciones-mercancia/rapida", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ proveedor: proveedorElegido ? proveedorElegido.nombre : (marcasConEntrada.length === 1 ? marcasConEntrada[0] : "Varios"), sinFactura: Boolean(proveedorElegido), referencia: "Recibir por marca", usuarioNombre: (typeof duenoEmpleadoNombrePersona !== "undefined" && duenoEmpleadoNombrePersona) || "", idempotencyKey: estado.llave, items, ...(pago ? { pago } : {}) })
            });

            const cuantos = items.length;
            estado = null;
            document.getElementById("drmCapa")?.classList.remove("abierta");
            document.body.classList.remove("drm-abierta", "drm-con-resumen");
            avisar(respuesta.repetida ? "Esa recepción ya estaba guardada." : `Recepción guardada: ${cuantos} producto${cuantos === 1 ? "" : "s"} sumado${cuantos === 1 ? "" : "s"} al inventario.`);
            if (typeof refrescarCatalogoLocalDueno === "function") await refrescarCatalogoLocalDueno();
            if (typeof filtrarInventarioDueno === "function") filtrarInventarioDueno();
        } catch (error) {
            // La misma llave se conserva: si la peticion SI llego pero la respuesta se perdio, reintentar no suma dos veces.
            estado.enviando = false;
            pintar();
            avisar(error.message || "No se pudo guardar. Revisa tu internet y vuelve a intentar.");
        }
    };

    window.repartirRecibidoRecibirDueno = repartirRecibido;
    window.agruparMarcasRecibirDueno = agrupar;
    window.marcaDeRecibirDueno = marcaDe;
    window.lineaDeRecibirDueno = lineaDe;
    window.lineasDeRecibirDueno = lineasDe;

    // Boton junto a "Recibir mercancia" en Inventario.
    function ponerBoton() {
        const original = document.querySelector('#duenoInventario button[onclick="abrirRecepcionDueno()"]');
        if (!original || document.getElementById("drmBoton")) return;

        const boton = document.createElement("button");
        boton.id = "drmBoton";
        boton.type = "button";
        boton.className = original.className;
        boton.textContent = "Recibir por marca";
        boton.addEventListener("click", () => window.abrirRecibirMarcaDueno());
        original.insertAdjacentElement("afterend", boton);

        // Con el boton a la vista se va leyendo el catalogo en un momento libre, para que al tocarlo la pantalla abra sin esperar.
        const calentar = () => { if (!catalogoEnMemoria) catalogoParaRecibir().catch(() => {}); };
        if (typeof requestIdleCallback === "function") requestIdleCallback(calentar, { timeout: 4000 }); else setTimeout(calentar, 1500);
    }

    ponerBoton();
})();
