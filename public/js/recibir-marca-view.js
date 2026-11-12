// Recibir por marca en la computadora (lo mismo que ya existe en el celular, mismas rutas del servidor):
//  - eliges una marca (filtradas por tipo: botanas, refrescos, aguas...) y anotas cuantas piezas llegaron de cada producto;
//  - si ya tienes la factura del correo, la abres aqui y cada producto trae "Esperado N" para confirmar lo que llego;
//  - al recibir a mano con un proveedor, la recepcion queda "sin factura" y cuando llegue su factura Nexo la compara (nunca suma dos veces).
// Es una funcion nueva: solo aparece si el dueño la enciende en Nexo -> Funciones nuevas (funcionBeta("recibir_por_marca")).
(function () {
    const MAX_TARJETAS = 150;
    const MUCHAS_MARCAS = 12;   // con mas marcas que estas no se abre una por defecto: se escanea o se busca
    const MARCAS_VISIBLES = 8;  // las que se ven como botones; el resto esta en "Ver todas las marcas"
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

    let rm = null;

    // Abarrotes (perfil simple): llegan cajas y paquetes de un repartidor, no se escanea pieza por pieza. Los textos y atajos lo reflejan;
    // la ferreteria queda como estaba.
    const esAbarrotes = () => typeof perfilEsSimple === "function" && perfilEsSimple();

    const esc = valor => String(valor ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
    const plano = texto => String(texto || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
    const numero = valor => Number(valor || 0).toLocaleString("es-MX", { maximumFractionDigits: 3 });
    const dinero = valor => "$" + Number(valor || 0).toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const aviso = (mensaje, tipo) => { if (typeof mostrarToastPOS === "function") mostrarToastPOS(mensaje, tipo ? { tipo } : undefined); };
    // Mismos colores que Recibir por marca del celular: cada marca siempre sale del mismo color en los dos.
    const COLORES_MARCA = ["#0369a1", "#15803d", "#a21caf", "#b91c1c", "#4d7c0f", "#0e7490", "#7c2d12", "#4338ca"];
    const COLORES_EXHIBIDOR = { azul: "#1d4ed8", naranja: "#ea580c", verde: "#15803d", rojo: "#dc2626", morado: "#7e22ce", negro: "#1f2937" };
    const colorDeMarca = texto => { let s = 0; for (const c of plano(texto)) s += c.charCodeAt(0); return COLORES_MARCA[s % COLORES_MARCA.length]; };
    const tipoDeGrupo = g => (g.dir && g.dir.tipo) || TIPO_POR_MARCA[plano(g.marca)] || "Otras";
    let directorio = null;   // marcas de Nexo (tipo, color e imagen de cada tarjeta)

    async function cargarDirectorio() {
        if (directorio) return directorio;
        directorio = new Map();
        try { ((await llamar("/marcas-directorio")).datos.marcas || []).forEach(m => directorio.set(plano(m.nombre), m)); } catch (error) { /* sin directorio: se ve como antes */ }
        return directorio;
    }

    const iniciales = texto => String(texto || "?").trim().split(/\s+/).slice(0, 2).map(w => w.charAt(0).toUpperCase()).join("");

    async function llamar(ruta, opciones = {}) {
        const respuesta = await fetch(ruta, { ...opciones, headers: { "Content-Type": "application/json", ...(opciones.headers || {}) } });
        const datos = await respuesta.json().catch(() => ({}));
        return { ok: respuesta.ok && datos.ok !== false, datos };
    }

    // ---------- marcas ----------

    async function armarGrupos(productos) {
        const porId = new Map(productos.map(p => [Number(p.id), p]));
        const usados = new Set();
        const grupos = [];

        // Si ya armaste exhibidores (por marca o a tu manera), cada exhibidor es una marca; lo demas se agrupa por la marca del producto.
        try {
            const lista = (await llamar("/exhibidores")).datos.exhibidores || [];
            const usables = lista.filter(x => x.activo !== false && x.totalEspacios > 0);
            const detalles = await Promise.all(usables.map(x => llamar("/exhibidores/" + x.id).then(r => r.datos.exhibidor).catch(() => null)));

            detalles.forEach(d => {
                if (!d) return;
                const productosDe = d.espacios.map(e => { usados.add(Number(e.productoId)); return porId.get(Number(e.productoId)); }).filter(Boolean);
                if (productosDe.length) grupos.push({ marca: d.nombre, color: COLORES_EXHIBIDOR[d.color] || colorDeMarca(d.nombre), productos: productosDe });
            });
        } catch (error) { /* sin exhibidores: se agrupa por marca */ }

        // Se junta "FOSET" con "Foset": la llave ignora mayusculas, acentos y espacios de mas; se muestra la forma que mas se escribio.
        const resto = new Map();
        productos.filter(p => !usados.has(Number(p.id))).forEach(p => {
            const marca = String(p.marca || "").trim().replace(/\s+/g, " ") || "Sin marca";
            const llave = plano(marca);
            if (!resto.has(llave)) resto.set(llave, { formas: new Map(), lista: [] });
            const g = resto.get(llave);
            g.formas.set(marca, (g.formas.get(marca) || 0) + 1);
            g.lista.push(p);
        });
        const nombreBonito = formas => [...formas.entries()].sort((a, b) => b[1] - a[1] || (a[0] === a[0].toUpperCase() ? 1 : -1) - (b[0] === b[0].toUpperCase() ? 1 : -1))[0][0];
        [...resto.values()].sort((a, b) => b.lista.length - a.lista.length).forEach(g => { const marca = nombreBonito(g.formas); grupos.push({ marca, color: colorDeMarca(marca), productos: g.lista }); });

        const dir = await cargarDirectorio();
        grupos.forEach(g => { g.dir = dir.get(plano(g.marca)) || null; if (g.dir && !g.color) g.color = COLORES_EXHIBIDOR[g.dir.color]; });

        return grupos;
    }

    function tiposActivos() {
        if (!rm || rm.factura) return [];
        const cuenta = new Map();
        rm.grupos.forEach(g => { const t = tipoDeGrupo(g); cuenta.set(t, (cuenta.get(t) || 0) + 1); });
        const conocidos = ORDEN_TIPOS.filter(x => cuenta.has(x) && x !== "Otras");
        const nuevos = [...cuenta.keys()].filter(x => !ORDEN_TIPOS.includes(x)).sort((a, b) => cuenta.get(b) - cuenta.get(a));
        const lista = [...conocidos, ...nuevos, ...(cuenta.has("Otras") ? ["Otras"] : [])];
        return lista.length > 1 ? lista : [];
    }

    function marcasQueCoinciden() {
        const q = plano(rm.consulta).trim();
        if (!q || rm.factura) return [];
        const palabras = q.split(/\s+/).filter(Boolean);
        const solo = q.replace(/[^a-z0-9]/g, "");
        // Abarrotes en la primera pantalla: tambien salen las marcas que tienen un producto con ese nombre o codigo.
        const porProducto = g => solo.length >= 3 && g.productos.some(p => palabras.every(w => plano(p.nombre).includes(w)) || String(p.codigo || "").toLowerCase().replace(/[^a-z0-9]/g, "").includes(solo));
        // Si alguna marca se llama asi, solo salen esas; si no, las marcas que tienen un producto con ese nombre o codigo.
        const porNombre = rm.grupos.filter(g => palabras.every(w => plano(g.marca).includes(w)));
        return porNombre.length || !soloMarcas() ? porNombre : rm.grupos.filter(porProducto);
    }

    // Abarrotes: hasta que se elige una marca, la pantalla es solo de tarjetas de marcas (tambien al buscar: salen las marcas que coinciden).
    function soloMarcas() { return Boolean(rm) && esAbarrotes() && !rm.factura && !rm.marca; }

    function gruposVisibles() {
        const coinciden = marcasQueCoinciden();
        if (coinciden.length) return coinciden;
        if (!rm.tipo || rm.factura) return rm.grupos;
        const lista = rm.grupos.filter(g => tipoDeGrupo(g) === rm.tipo);
        return lista.length ? lista : rm.grupos;
    }

    // Lineas (categorias) de la marca elegida: solo se ofrecen si hay mas de una.
    function lineasDeMarca() {
        if (!rm || rm.factura || rm.consulta.trim() || !rm.marca) return [];
        const g = rm.grupos.find(x => x.marca === rm.marca);
        if (!g) return [];
        const cuenta = new Map();
        g.productos.forEach(p => { const c = String(p.categoria || "").trim(); if (c) cuenta.set(c, (cuenta.get(c) || 0) + 1); });
        return cuenta.size > 1 ? [...cuenta.entries()].sort((a, b) => b[1] - a[1]) : [];
    }

    function productosVisibles() {
        if (soloMarcas()) return [];
        const q = plano(rm.consulta).trim();

        // Abarrotes con una marca elegida: el buscador solo busca en los productos de esa marca.
        if (esAbarrotes() && rm.marca && !rm.factura) {
            const grupo = rm.grupos.find(g => g.marca === rm.marca);
            if (!grupo) return [];
            if (!q) return rm.linea ? grupo.productos.filter(p => String(p.categoria || "").trim() === rm.linea) : grupo.productos;
            const palabras = q.split(/\s+/).filter(Boolean);
            const solo = q.replace(/[^a-z0-9]/g, "");
            return grupo.productos.filter(p => palabras.every(w => plano(p.nombre).includes(w)) || (solo.length >= 3 && String(p.codigo || "").toLowerCase().replace(/[^a-z0-9]/g, "").includes(solo)));
        }

        if (q) {
            const palabras = q.split(/\s+/).filter(Boolean);
            const solo = q.replace(/[^a-z0-9]/g, "");
            const porNombre = rm.todos.filter(p => palabras.every(w => plano(p.nombre).includes(w)) || (solo.length >= 3 && String(p.codigo || "").toLowerCase().replace(/[^a-z0-9]/g, "").includes(solo)));
            const deMarca = marcasQueCoinciden().flatMap(g => g.productos);
            const vistos = new Set();
            return deMarca.concat(porNombre).filter(p => !vistos.has(Number(p.id)) && vistos.add(Number(p.id)));
        }

        if (!rm.marca) return [];
        const grupo = rm.grupos.find(g => g.marca === rm.marca) || rm.grupos[0];
        if (!grupo) return [];
        return rm.linea ? grupo.productos.filter(p => String(p.categoria || "").trim() === rm.linea) : grupo.productos;
    }

    // ---------- pantalla ----------

    window.mostrarRecibirMarca = async function () {
        const modo = window.__rmModo === "pedido" || window.__rmModo === "sugerir" ? window.__rmModo : "recibir";
        window.__rmModo = null;
        if (typeof ocultarPantallasPrincipales === "function") ocultarPantallasPrincipales();
        const pantalla = document.getElementById("pantallaRecibirMarca");
        if (!pantalla) return;
        pantalla.style.display = "block";
        if (typeof actualizarTopbarContexto === "function") (modo !== "recibir" ? actualizarTopbarContexto(modo === "sugerir" ? "Sugerir pedido" : "Crear pedido", modo === "sugerir" ? "Pon mínimo y máximo y Nexo calcula lo que falta" : "Elige la marca y anota lo que quieres pedir", "pedidos-unico") : actualizarTopbarContexto(esAbarrotes() ? "Recibir mercancía" : "Recibir por marca", esAbarrotes() ? "Elige la marca y anota lo que llegó" : "Anota lo que llegó por marca o con la factura", "recibir-marca"));
        pantalla.innerHTML = `<div class="rm-shell"><p class="rm-nota">Cargando tu catálogo…</p></div>`;

        if (!Array.isArray(todosProductos) || !todosProductos.length) { try { await cargarProductos(); } catch (error) { /* se avisa abajo */ } }
        const productos = (Array.isArray(todosProductos) ? todosProductos : []).filter(p => Number(p.id) > 0);

        if (!productos.length) { pantalla.innerHTML = `<div class="rm-shell"><p class="rm-nota">Todavía no hay productos en tu catálogo.</p></div>`; return; }

        const grupos = await armarGrupos(productos);
        rm = { modo, tocados: new Set(), comp: {}, productos, grupos, todos: productos, indice: new Map(productos.map(p => [Number(p.id), p])), marca: esAbarrotes() || grupos.length > MUCHAS_MARCAS ? "" : (grupos[0]?.marca || ""), linea: "", verTodasMarcas: false, verFacturas: false, busFactura: "", ultimo: null, tipo: "", consulta: "", cantidades: new Map(), caducidades: new Map(), pago: { activo: false, monto: "", metodo: "efectivo_caja", por: "", nota: "", vencimiento: "", vencimientoManual: false }, proveedores: [], facturas: [], factura: null, respaldo: null, enviando: false, llave: (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : "rm-" + Date.now() + "-" + Math.random().toString(16).slice(2) };
        if (modo === "sugerir") await cargarComprometido();
        const pedidoPorRecibir = Number(window.__rmPedidoId) || 0;
        window.__rmPedidoId = null;
        if (pedidoPorRecibir && modo === "recibir") await prepararPedido(pedidoPorRecibir);
        pintar();

        llamar("/proveedores").then(r => { if (rm) { rm.proveedores = (r.datos.proveedores || []).map(x => ({ id: x.id, nombre: x.nombre, diasCredito: x.dias_credito })).filter(x => x.nombre); pintarResumen(); } }).catch(() => {});
        llamar("/recepcion-inteligente/facturas").then(r => { if (rm) { rm.facturas = (r.datos.facturas || []).filter(f => f.estado === "pendiente"); pintarFacturas(); } }).catch(() => {});
    };

    // Recibir contra un pedido: cada producto del pedido trae "Esperado N" (lo que falta por llegar), igual que con una factura.
    async function prepararPedido(id) {
        const r = await llamar("/pedidos-proveedor/" + id);

        if (!r.ok || !r.datos.pedido) { aviso(r.datos.error || "No se pudo abrir el pedido.", "error"); return; }

        const porCard = new Map();

        (r.datos.items || []).forEach(i => {
            const pid = Number(i.producto_id);
            const pendiente = Math.max(0, Number(i.cantidad || 0) - Number(i.recibido || 0));
            if (!(pid > 0) || !(pendiente > 0)) return;
            const base = rm.indice.get(pid) || { id: pid, nombre: i.nombre || "Producto", stock: 0, codigo: i.codigo };
            const c = porCard.get(pid) || { ...base, id: pid, esperado: 0, itemIds: [], esperados: [], nuevoProducto: false };
            c.esperado += pendiente;
            porCard.set(pid, c);
        });

        const cards = [...porCard.values()];

        if (!cards.length) { aviso("Ese pedido ya está completo: no falta nada por recibir.", "info"); return; }

        rm.respaldo = rm.respaldo || { grupos: rm.grupos, todos: rm.todos, indice: rm.indice, marca: rm.marca, tipo: rm.tipo };
        rm.factura = { id: null, esPedido: true, pedidoId: id, proveedor: r.datos.pedido.proveedor || "Proveedor", folio: "", total: Number(r.datos.pedido.total_estimado || 0), cards, porDecidir: 0 };
        rm.grupos = [{ marca: "Pedido", productos: cards }];
        rm.todos = cards;
        rm.indice = new Map(cards.map(c => [Number(c.id), c]));
        rm.marca = "Pedido";
        rm.tipo = "";
        rm.consulta = "";
        rm.cantidades = new Map();
    }

    const esDePedido = () => Boolean(rm && rm.factura && rm.factura.esPedido);

    function pintar() {
        const pantalla = document.getElementById("pantallaRecibirMarca");
        if (!pantalla || !rm) return;

        pantalla.innerHTML = `<div class="rm-shell">
            <header class="rm-cab"><div><h2>${rm.modo === "sugerir" ? "Sugerir pedido" : (rm.modo === "pedido" ? "Crear pedido" : (rm.factura ? (esDePedido() ? "Recibir pedido #" + rm.factura.pedidoId : "Recibir con factura") : "Recibir mercancía"))}</h2><p>${rm.modo === "sugerir" ? "Elige la marca, pon cuánto quieres tener como mínimo y como máximo de cada producto, y Nexo te dice cuánto pedir." : rm.modo === "pedido" ? "Elige la marca y anota cuántas piezas quieres pedir de cada producto." : rm.factura ? (esDePedido() ? "Confirma lo que llegó de cada producto. Lo que pediste aparece como “Esperado”; lo que no llegue queda pendiente en el pedido." : "Confirma lo que llegó de cada producto. Lo que dice la factura aparece como “Esperado”.") : (esAbarrotes() ? "Elige la marca y anota cuántas piezas llegaron de cada producto. Si traes la factura, ábrela arriba y confirma contra lo esperado." : "Escanea cada producto con la pistola, o búscalo por nombre, código o marca. Cada escaneo suma 1.")}</p></div>
                <div id="rmFacturas" class="rm-facturas"></div></header>
            <div class="rm-dos">
                <section class="rm-izq">
                    <div class="rm-escaner-fila" ${rm.factura ? "style=\"display:none\"" : ""}><label class="rm-buscador"><svg class="rm-lupa" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg><span id="rmAlcance" class="rm-alcance-caja"></span><input id="rmBuscar" class="rm-buscar rm-escaner" type="search" autocomplete="off" placeholder="${esAbarrotes() ? "Buscar producto, código o marca" : "Escanea o escribe producto, código o marca"}" oninput="rmBuscar(this.value)" onkeydown="if(event.key==='Enter'){event.preventDefault();rmEscanear(this.value)}" value="${esc(rm.consulta)}"></label>
                    ${rm.factura ? "" : `<button type="button" class="rm-btn rm-celular" onclick="if(window.abrirEscanerRemotoPOS)abrirEscanerRemotoPOS()" title="Usar el celular como escáner"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="7" y="2" width="10" height="20" rx="2"/><path d="M11 18h2"/></svg><span>Usar mi celular</span></button>`}</div>
                    <div id="rmUltimo" class="rm-ultimo" aria-live="polite"></div>
                    <div id="rmTipos" class="rm-chips"></div>
                    <div id="rmLineas" class="rm-chips rm-lineas-chips"></div>
                    <div id="rmMarcas" class="rm-marcas"></div>
                    <div id="rmGrid" class="rm-grid"></div>
                </section>
                <aside class="rm-der" id="rmResumen"></aside>
            </div></div>`;
        pintarFacturas();
        pintarFiltros();
        pintarGrid();
        pintarResumen();
        pintarUltimo();
        const campo = document.getElementById("rmBuscar");
        if (campo && !rm.factura) campo.focus();
        entrar();
    }

    // Abarrotes: mientras no se elija una marca ni se busque ni se anote nada, la pantalla es solo de tarjetas de marcas (sin el resumen de al lado).
    function ajustarVista() {
        const dos = document.querySelector("#pantallaRecibirMarca .rm-dos");
        if (!dos || !rm) return;
        dos.classList.toggle("rm-solo-marcas", soloMarcas() && lineas().length === 0);
    }

    // El buscador dice donde busca: con una marca elegida aparece su nombre dentro del campo y el texto de ayuda cambia.
    function pintarAlcance() {
        const caja = document.getElementById("rmAlcance");
        const campo = document.getElementById("rmBuscar");
        const enMarca = esAbarrotes() && rm.marca && !rm.factura;
        if (caja) {
            const g = rm.grupos.find(x => x.marca === rm.marca);
            caja.innerHTML = enMarca ? `<button type="button" class="rm-alcance" style="--marca:${(g && g.color) || "#1d4ed8"}" onclick="rmCambiarMarca()" title="Buscar en todas las marcas">${esc(rm.marca)}<span aria-hidden="true">✕</span></button>` : "";
        }
        if (campo) campo.placeholder = enMarca ? `Buscar en ${rm.marca}` : (esAbarrotes() ? "Buscar producto, código o marca" : "Escanea o escribe producto, código o marca");
    }

    function pintarFiltros() {
        pintarAlcance();
        ajustarVista();
        const tipos = tiposActivos();
        const chip = (valor, etiqueta, n) => `<button type="button" class="rm-chip${(rm.tipo || "") === valor ? " activo" : ""}" onclick="rmTipo('${esc(valor)}')">${esc(etiqueta)} <small>${n}</small></button>`;
        const t = document.getElementById("rmTipos");
        if (t) t.innerHTML = tipos.length ? chip("", "Todas", rm.grupos.length) + tipos.map(x => chip(x, x, rm.grupos.filter(g => tipoDeGrupo(g) === x).length)).join("") : "";

        const ln = document.getElementById("rmLineas");
        if (ln) {
            const ls = lineasDeMarca();
            const total = (rm.grupos.find(x => x.marca === rm.marca) || { productos: [] }).productos.length;
            ln.innerHTML = ls.length ? `<button type="button" class="rm-chip${!rm.linea ? " activo" : ""}" onclick="rmLinea('')">Todos <small>${total}</small></button>` + ls.map(([c, n]) => `<button type="button" class="rm-chip${rm.linea === c ? " activo" : ""}" onclick="rmLinea(${JSON.stringify(c).replace(/"/g, "&quot;")})">${esc(c)} <small>${n}</small></button>`).join("") : "";
        }

        const m = document.getElementById("rmMarcas");
        if (!m) return;
        const todas = gruposVisibles();
        const buscando = Boolean(rm.consulta.trim());
        // con muchas marcas se ven solo las de mas productos (y la elegida); el resto queda detras de "Ver todas"
        let lista = todas;
        let ocultas = 0;
        if (!rm.factura && !buscando && !rm.verTodasMarcas && todas.length > MARCAS_VISIBLES + 2) {
            lista = todas.slice(0, MARCAS_VISIBLES);
            const activa = todas.find(g => g.marca === rm.marca);
            if (activa && !lista.includes(activa)) lista = lista.concat(activa);
            ocultas = todas.length - lista.length;
        }
        // Abarrotes: elegida una marca, las tarjetas se esconden y solo se ven sus productos (con un boton para volver a las tarjetas).
        if (esAbarrotes() && rm.marca && !rm.factura) {
            const t = document.getElementById("rmTipos");
            if (t) t.innerHTML = "";
            m.innerHTML = `<div class="rm-volver"><button type="button" class="rm-btn" onclick="rmCambiarMarca()">‹ Cambiar marca</button><b>${esc(rm.marca)}</b></div>`;
            return;
        }

        const boton = g => {
            const llevo = g.productos.reduce((s, p) => s + (rm.cantidades.get(Number(p.id)) > 0 ? 1 : 0), 0);
            const imagen = esAbarrotes() ? `<span class="rm-marca-img"><span class="rm-marca-ini">${esc(iniciales(g.marca))}</span>${g.dir ? `<img src="/marcas-directorio/${esc(g.dir.id)}/imagen" alt="" loading="lazy" onerror="this.remove()">` : ""}</span>` : "";
            return `<button type="button" class="rm-marca${g.marca === rm.marca ? " activa" : ""}${imagen ? " con-imagen" : ""}" data-marca="${esc(g.marca)}" style="--marca:${g.color || "#475569"}" onclick="rmMarca(${JSON.stringify(g.marca).replace(/"/g, "&quot;")})">${imagen}<b>${esc(g.marca)}</b><small>${g.productos.length} producto${g.productos.length === 1 ? "" : "s"}${rm.modo === "sugerir" ? textoPorPedir(g) : (llevo ? ` · ${llevo} con entrada` : "")}</small></button>`;
        };
        const mas = ocultas > 0
            ? `<button type="button" class="rm-marca rm-mas" onclick="rmVerMarcas(true)"><b>Ver las ${ocultas} marcas restantes</b><small>o escribe la marca arriba</small></button>`
            : (rm.verTodasMarcas && !rm.factura && !buscando && todas.length > MARCAS_VISIBLES + 2 ? `<button type="button" class="rm-marca rm-mas" onclick="rmVerMarcas(false)"><b>Mostrar menos marcas</b></button>` : "");
        if (soloMarcas() && buscando && !marcasQueCoinciden().length) { m.innerHTML = `<p class="rm-nota rm-completo">No encontré marcas ni productos con eso.</p>`; return; }
        m.innerHTML = rm.factura ? "" : lista.map(boton).join("") + mas;
    }

    function atajosCantidad(p, id) {
        const boton = (cuanto, texto) => `<button type="button" onclick="rmSumar(${id}, ${cuanto})">${texto}</button>`;
        const porCaja = Number(p.factor_conversion);

        if (esAbarrotes() && porCaja > 1 && porCaja <= 500) {
            const nombre = String(p.presentacion_compra || "caja").toLowerCase().slice(0, 12);
            return boton(porCaja, `+1 ${esc(nombre)} (${numero(porCaja)})`) + [6, 12, 18].filter(a => a !== porCaja).map(a => boton(a, `+${a}`)).join("");
        }

        return [6, 12, 18, 24].map(a => boton(a, `+${a}`)).join("");
    }

    function tarjeta(p) {
        const id = Number(p.id);
        const n = rm.cantidades.get(id) || 0;
        const miniatura = typeof miniaturaProducto === "function" ? miniaturaProducto(p) : "";
        const esperado = p.esperado != null;
        const atajos = esperado
            ? `<button type="button" class="rm-llego" onclick="rmLlego(${id})">Llegó todo (${numero(p.esperado)})</button>`
            : atajosCantidad(p, id);

        const poco = Number(p.stock) <= (Number(p.stock_minimo) > 0 ? Number(p.stock_minimo) : 2);
        return `<article class="rm-tarjeta${n > 0 ? " con-entrada" : ""}" data-id="${id}">
            <span class="rm-palomita" aria-hidden="true">✓</span>
            <div class="rm-foto">${miniatura}</div>
            <b class="rm-nombre">${esc(p.nombre)}</b>
            <small class="rm-hay${poco ? " poco" : ""}">Hay ${numero(p.stock)}${esperado ? ` · <span class="rm-esperado">${p.nuevoProducto ? "Nuevo · " : ""}Esperado ${numero(p.esperado)}</span>` : ""}</small>
            <div class="rm-cantidad"><button type="button" onclick="rmSumar(${id}, -1)" aria-label="Quitar uno">−</button><input type="number" min="0" step="any" inputmode="decimal" value="${n || ""}" placeholder="0" oninput="rmEscribir(${id}, this.value)" aria-label="Llegaron"><button type="button" onclick="rmSumar(${id}, 1)" aria-label="Agregar uno">+</button></div>
            ${rm.modo === "sugerir" ? minMaxHtml(p, id) : ""}<div class="rm-atajos">${atajos}</div></article>`;
    }

    function pintarGrid() {
        const g = document.getElementById("rmGrid");
        if (!g) return;
        const lista = productosVisibles();
        if (soloMarcas()) { g.innerHTML = ""; return; }
        g.innerHTML = lista.length
            ? lista.slice(0, MAX_TARJETAS).map(tarjeta).join("") + (lista.length > MAX_TARJETAS ? `<p class="rm-nota rm-completo">Se muestran ${MAX_TARJETAS} de ${lista.length}. Usa el buscador para acotar.</p>` : "")
            : `<p class="rm-nota rm-completo">${rm.consulta.trim() ? (esAbarrotes() && rm.marca && !rm.factura ? `No encontré eso en ${esc(rm.marca)}. Toca la marca dentro del buscador para buscar en todas.` : "No encontré nada con eso.") : (!rm.marca ? (esAbarrotes() ? "Elige una marca, o busca un producto por su nombre o código." : "Escanea un producto con la pistola, escribe su nombre o código, o elige una marca.") : "Esta marca no tiene productos.")}</p>`;
    }

    function pintarUltimo() {
        const caja = document.getElementById("rmUltimo");
        if (!caja || !rm) return;
        const u = rm.ultimo;
        if (!u) { caja.innerHTML = ""; return; }
        const p = rm.indice.get(u.id);
        if (!p) { caja.innerHTML = ""; return; }
        const n = rm.cantidades.get(u.id) || 0;
        const miniatura = typeof miniaturaProducto === "function" ? miniaturaProducto(p) : "";
        caja.innerHTML = `<div class="rm-ultimo-tarjeta">
            <div class="rm-ultimo-foto">${miniatura}</div>
            <div class="rm-ultimo-texto"><small>Último escaneado</small><b>${esc(p.nombre)}</b><span>Hay ${numero(p.stock)} · llevas <strong>${numero(n)}</strong> en esta recepción${p.esperado != null ? ` · esperado ${numero(p.esperado)}` : ""}</span></div>
            <div class="rm-ultimo-mas"><button type="button" onclick="rmSumar(${u.id}, -1)" aria-label="Quitar uno">−</button><button type="button" onclick="rmSumar(${u.id}, 1)" aria-label="Agregar uno">+</button></div>
        </div>`;
    }

    function actualizarTarjeta(id) {
        const t = document.querySelector(`#rmGrid .rm-tarjeta[data-id="${id}"]`);
        if (!t) return;
        const n = rm.cantidades.get(id) || 0;
        t.classList.toggle("con-entrada", n > 0);
        const campo = t.querySelector(".rm-cantidad input");
        if (campo && document.activeElement !== campo) campo.value = n || "";
    }

    function colorDe(p) {
        const g = rm.grupos.find(x => x.productos.some(q => Number(q.id) === Number(p.id)));
        return (g && g.color) || colorDeMarca(p.marca || "");
    }

    function lineas() {
        return [...rm.cantidades.entries()].filter(([, n]) => n > 0).map(([id, n]) => ({ id, n, p: rm.indice.get(id) })).filter(l => l.p);
    }

    // ---------- caducidad y pago al repartidor (abarrotes) ----------

    const METODOS_PAGO_REPARTIDOR = [["efectivo_caja", "Efectivo de la caja"], ["efectivo_propio", "Efectivo (de mi bolsa)"], ["transferencia", "Transferencia"], ["a_deber", "Se quedó a deber"]];
    const nombreQuienRecibe = () => (typeof usuarioActual !== "undefined" && usuarioActual && (usuarioActual.nombre || usuarioActual.usuario)) || "";

    // Fecha de caducidad de lo que llego (opcional). Si el producto tiene vida util, vacia se calcula sola.
    function fechaLineaHtml(l) {
        if (!esAbarrotes()) return "";

        const vida = Number(l.p.vida_util_dias) > 0 ? ` Si la dejas vacía se calcula sola (+${Number(l.p.vida_util_dias)} días).` : "";

        return `<label class="rm-fecha" title="Fecha impresa en el empaque (opcional).${vida}">Caduca <input type="date" value="${esc(rm.caducidades.get(l.id) || "")}" onchange="rmCaducidad(${l.id}, this.value)"></label>`;
    }

    window.rmCaducidad = function (id, fecha) {
        if (!rm) return;
        if (fecha) rm.caducidades.set(Number(id), fecha); else rm.caducidades.delete(Number(id));
    };

    // ¿Pagaste al repartidor? Cuanto, como y quien (queda en la recepcion; si fue efectivo de la caja, tambien sale en Caja).
    // ---------- Agenda de pagos: lo recibido "a deber" queda con su fecha limite ----------

    const agendaPagosActiva = () => typeof funcionBeta === "function" && funcionBeta("agenda_pagos");
    const fechaLocalISO = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

    // Hoy + los dias de credito del proveedor elegido (o de la factura); sin dias de credito, hoy. El dueño la puede cambiar.
    function vencimientoSugerido() {
        const nombre = rm.factura ? rm.factura.proveedor : (document.getElementById("rmProveedor")?.value || "");
        const proveedor = rm.proveedores.find(x => plano(x.nombre) === plano(nombre));
        const dias = proveedor && Number(proveedor.diasCredito) > 0 ? Number(proveedor.diasCredito) : 0;
        const d = new Date();
        d.setDate(d.getDate() + dias);
        return fechaLocalISO(d);
    }

    window.rmVencimientoManual = function () { if (rm) rm.pago.vencimientoManual = true; };

    // Cambiar de proveedor reajusta la fecha sugerida (sin redibujar el resumen, que le quitaria lo escrito).
    window.rmProveedorCambio = function () {
        if (!rm || !agendaPagosActiva() || rm.pago.metodo !== "a_deber" || rm.pago.vencimientoManual) return;
        rm.pago.vencimiento = vencimientoSugerido();
        const campo = document.querySelector(".rm-pago input[type=date]");
        if (campo) campo.value = rm.pago.vencimiento;
    };

    function pagoRepartidorHtml() {
        if (!esAbarrotes()) return "";

        const p = rm.pago;

        return `<div class="rm-pago">
            <label class="rm-pago-toggle"><input type="checkbox" ${p.activo ? "checked" : ""} onchange="rmPagoActivar(this.checked)"> Pagué al repartidor</label>
            ${p.activo ? `<div class="rm-pago-campos">
                <label class="rm-campo">${p.metodo === "a_deber" ? "¿Cuánto quedó a deber?" : "¿Cuánto pagaste?"}<input type="number" min="0" step="0.01" inputmode="decimal" class="rm-buscar" placeholder="0.00" value="${esc(p.monto)}" oninput="rmPagoCampo('monto', this.value)"></label>
                <label class="rm-campo">¿Cómo?<select onchange="rmPagoCampo('metodo', this.value)">${METODOS_PAGO_REPARTIDOR.map(([valor, texto]) => `<option value="${valor}" ${p.metodo === valor ? "selected" : ""}>${texto}</option>`).join("")}</select></label>
                ${p.metodo === "a_deber" && agendaPagosActiva() ? `<label class="rm-campo">Fecha límite de pago<input type="date" class="rm-buscar" value="${esc(p.vencimiento || vencimientoSugerido())}" onchange="rmPagoCampo('vencimiento', this.value); rmVencimientoManual()"></label>` : ""}
                <label class="rm-campo">¿Quién pagó?<input type="text" maxlength="60" class="rm-buscar" value="${esc(p.por)}" oninput="rmPagoCampo('por', this.value)"></label>
                <small class="rm-pago-ayuda">${p.metodo === "efectivo_caja" ? "Sale del efectivo de la caja: se anota en Caja para que el corte cuadre." : (p.metodo === "a_deber" ? (agendaPagosActiva() ? "Queda como cuenta por pagar en tu Agenda de pagos, con su fecha límite (si escribes cuánto quedó a deber)." : "Queda anotado como pendiente con este proveedor.") : "Queda anotado en la recepción.")}</small>
            </div>` : ""}
        </div>`;
    }

    window.rmPagoActivar = function (activo) {
        if (!rm) return;
        rm.pago.activo = Boolean(activo);
        if (activo && !rm.pago.por) rm.pago.por = nombreQuienRecibe();
        if (activo && rm.factura && !rm.pago.monto) rm.pago.monto = String(Number(rm.factura.total) || "");
        pintarResumen();
    };

    // Solo se guarda lo escrito: redibujar el resumen aqui le quitaria el cursor al campo.
    window.rmPagoCampo = function (campo, valor) {
        if (!rm || !(campo in rm.pago)) return;
        rm.pago[campo] = valor;
        if (campo === "metodo") {
            if (valor === "a_deber" && agendaPagosActiva() && !rm.pago.vencimientoManual) rm.pago.vencimiento = vencimientoSugerido();
            pintarResumen();
        }
    };

    // El pago a mandar al servidor (o undefined si no se pago / no aplica). Regresa null si falta el monto.
    function pagoParaEnviar() {
        const p = rm.pago;

        if (!esAbarrotes() || !p.activo) return undefined;
        if (p.metodo !== "a_deber" && !(Number(String(p.monto).replace(",", ".")) > 0)) return null;

        return { monto: Number(String(p.monto).replace(",", ".")) || 0, metodo: p.metodo, por: p.por, nota: "", vencimiento: p.metodo === "a_deber" && agendaPagosActiva() ? (p.vencimiento || vencimientoSugerido()) : undefined };
    }

    // Efectivo de la caja: el pago tambien sale en Caja (un movimiento de salida) para que el corte cuadre. No puede tumbar la recepcion.
    async function anotarSalidaEnCaja(pago, proveedor, recepcionId) {
        if (!pago || pago.metodo !== "efectivo_caja" || !(pago.monto > 0)) return;

        const r = await llamar("/caja/movimientos", { method: "POST", body: JSON.stringify({ tipo: "salida", concepto: `Pago a proveedor${proveedor ? ": " + proveedor : ""}`, monto: pago.monto, metodo: "efectivo", referencia: recepcionId ? `Recepción ${recepcionId}` : "Recibir mercancía" }) });

        if (!r.ok) aviso(`El pago quedó anotado en la recepción, pero no salió de la caja: ${r.datos.error || "abre tu turno de caja"}.`, "info");
    }

    function pintarResumen() {
        const r = document.getElementById("rmResumen");
        if (!r || !rm) return;
        ajustarVista();
        if (esPedido()) { pintarResumenPedido(r); return; }
        const ls = lineas();
        const piezas = ls.reduce((s, l) => s + l.n, 0);
        const sinDecidir = rm.factura ? rm.factura.porDecidir : 0;

        const proveedor = !rm.factura && rm.proveedores.length
            ? `<label class="rm-campo">¿De qué proveedor viene?<select id="rmProveedor" onchange="rmProveedorCambio()"><option value="">Sin proveedor / no espero factura</option>${rm.proveedores.map(p => `<option value="${esc(p.nombre)}">${esc(p.nombre)}</option>`).join("")}</select><small>Si eliges uno y después te llega su factura por correo, Nexo la compara con lo que recibiste y no suma dos veces.</small></label>`
            : "";

        r.innerHTML = `<div class="rm-resumen-cab"><h3>${rm.factura ? esc(rm.factura.proveedor) : "Lo que llegó"}</h3>${rm.factura ? `<small>${esDePedido() ? "Pedido #" + esc(rm.factura.pedidoId) + " · estimado " : (rm.factura.folio ? "Folio " + esc(rm.factura.folio) + " · " : "")}${dinero(rm.factura.total)}</small>` : ""}</div>
            ${rm.factura ? `<div class="rm-acciones"><button type="button" class="rm-btn" onclick="rmTodoFactura()">Llegó todo</button><button type="button" class="rm-btn" onclick="rmSalirFactura()">${esDePedido() ? "Salir del pedido" : "Salir de la factura"}</button></div>` : ""}
            ${rm.factura && !rm.factura.esPedido ? comparacionHtml() : ""}
            ${sinDecidir ? `<p class="rm-alerta">${sinDecidir} concepto${sinDecidir === 1 ? "" : "s"} por decidir (producto nuevo o sin emparejar). Resuélvelos en <button type="button" class="rm-enlace" onclick="rmIrADecidir()">Recepción inteligente</button> antes de confirmar.</p>` : ""}
            <div class="rm-lineas">${ls.map(l => `<div class="rm-linea" style="--marca:${colorDe(l.p)}"><i class="rm-linea-mini">${typeof miniaturaProducto === "function" ? miniaturaProducto(l.p) : ""}</i><div class="rm-linea-datos"><span>${esc(l.p.nombre)}</span>${fechaLineaHtml(l)}</div><b>${numero(l.n)}</b><button type="button" onclick="rmQuitar(${l.id})" aria-label="Quitar">✕</button></div>`).join("") || `<p class="rm-nota">Todavía no anotas nada.</p>`}</div>
            <div class="rm-total"><span>${ls.length} producto${ls.length === 1 ? "" : "s"}</span><b>${numero(piezas)} piezas</b></div>
            ${proveedor}
            ${pagoRepartidorHtml()}
            <button type="button" class="rm-btn principal grande" id="rmConfirmar" onclick="rmConfirmar()" ${ls.length && !rm.enviando ? "" : "disabled"}>${rm.enviando ? "Guardando…" : (rm.factura ? (esDePedido() ? "Confirmar recepción del pedido" : "Confirmar recepción de la factura") : "Confirmar recepción")}</button>`;
    }

    // ---------- Crear pedido (mismo flujo de marcas y productos, pero se guarda como pedido a proveedor) ----------

    // ---------- Sugerir pedido: minimo y maximo por producto ----------

    const esPedido = () => Boolean(rm) && (rm.modo === "pedido" || rm.modo === "sugerir");

    // Igual que en el servidor (pedido-sugerido-calculo.js): lo que va a haber = lo que hay + lo que viene en camino - lo encargado por clientes.
    function sugerenciaDe(p) {
        const c = (rm.comp && rm.comp[p.id]) || {};
        const n = v => { const x = Number(v); return Number.isFinite(x) ? x : 0; };
        const min = n(p.stock_minimo);
        const max = n(p.stock_maximo);
        const proyectado = Math.round((n(p.stock) + n(c.enCamino) - n(c.encargado)) * 1000) / 1000;

        if (!(min > 0) || !(max > 0) || max < min) return { estado: "sin-limites", pedir: 0, proyectado };
        if (proyectado > min) return { estado: "suficiente", pedir: 0, proyectado };
        return { estado: "pedir", pedir: Math.max(0, Math.ceil(max - proyectado)), proyectado };
    }

    async function cargarComprometido() {
        const r = await llamar("/pedido-minmax/comprometido");
        rm.comp = (r.ok && r.datos.productos) || {};
    }

    function textoPorPedir(g) {
        const cuantos = g.productos.filter(p => sugerenciaDe(p).estado === "pedir").length;
        return cuantos ? ` · ${cuantos} por pedir` : "";
    }

    function minMaxHtml(p, id) {
        const s = sugerenciaDe(p);
        const c = (rm.comp && rm.comp[p.id]) || {};
        const piezas = v => numero(Number(v) || 0);
        const detalle = `hay ${piezas(p.stock)}${c.enCamino ? ` + ${piezas(c.enCamino)} en camino` : ""}${c.encargado ? ` - ${piezas(c.encargado)} encargado${Number(c.encargado) === 1 ? "" : "s"}` : ""}`;
        const texto = s.estado === "pedir"
            ? `Pedir ${piezas(s.pedir)}: ${detalle}, mínimo ${piezas(p.stock_minimo)}, máximo ${piezas(p.stock_maximo)}`
            : (s.estado === "suficiente" ? `Tienes suficiente (${detalle})` : "Pon mínimo y máximo para que Nexo calcule");

        return `<div class="rm-minmax rm-${s.estado}">
            <div class="rm-limites"><label>Mín <input type="number" class="rm-min" min="0" step="any" inputmode="decimal" value="${Number(p.stock_minimo) > 0 ? esc(String(p.stock_minimo)) : ""}" onchange="rmLimites(${id})"></label><label>Máx <input type="number" class="rm-max" min="0" step="any" inputmode="decimal" value="${Number(p.stock_maximo) > 0 ? esc(String(p.stock_maximo)) : ""}" onchange="rmLimites(${id})"></label></div>
            <small>${esc(texto)}</small></div>`;
    }

    // Pone las cantidades sugeridas de la marca elegida (lo que ya anotaste a mano no se toca).
    function rellenarSugeridos(marca) {
        const g = rm.grupos.find(x => x.marca === marca);
        if (!g) return;
        g.productos.forEach(p => {
            if (rm.tocados.has(Number(p.id))) return;
            const s = sugerenciaDe(p);
            if (s.pedir > 0) rm.cantidades.set(Number(p.id), s.pedir); else rm.cantidades.delete(Number(p.id));
        });
    }

    // Guarda el minimo y el maximo del producto y recalcula lo que hay que pedir.
    window.rmLimites = async function (id) {
        const tarjetaEl = document.querySelector(`#rmGrid .rm-tarjeta[data-id="${id}"]`);
        const p = rm && rm.indice.get(Number(id));
        if (!tarjetaEl || !p) return;

        const minimo = tarjetaEl.querySelector(".rm-min").value.trim();
        const maximo = tarjetaEl.querySelector(".rm-max").value.trim();
        const r = await llamar(`/productos/${Number(id)}/edicion-rapida`, { method: "PATCH", body: JSON.stringify({ stockMinimo: minimo === "" ? null : Number(minimo), stockMaximo: maximo === "" ? null : Number(maximo) }) });

        if (!r.ok) { aviso(r.datos.error || "No se pudo guardar el mínimo y el máximo.", "error"); return; }

        p.stock_minimo = minimo === "" ? 3 : Number(minimo);
        p.stock_maximo = maximo === "" ? null : Number(maximo);
        rm.tocados.delete(Number(id));
        const s = sugerenciaDe(p);
        if (s.pedir > 0) rm.cantidades.set(Number(id), s.pedir); else rm.cantidades.delete(Number(id));

        tarjetaEl.outerHTML = tarjeta(p);
        pintarResumen();
        pintarFiltros();
    };

    const costoDe = p => { const c = Number(p.costo); return Number.isFinite(c) && c > 0 ? c : 0; };
    const marcaDe = p => { const g = rm.grupos.find(x => x.productos.some(q => Number(q.id) === Number(p.id))); return g ? g.marca : String(p.marca || ""); };

    function pintarResumenPedido(r) {
        const ls = lineas();
        const piezas = ls.reduce((s, l) => s + l.n, 0);
        const total = ls.reduce((s, l) => s + l.n * costoDe(l.p), 0);
        const sinCosto = ls.filter(l => !costoDe(l.p)).length;
        const marcas = [...new Set(ls.map(l => marcaDe(l.p)).filter(Boolean))];
        const proveedor = rm.proveedores.length
            ? `<label class="rm-campo">¿Para qué proveedor? (opcional)<select id="rmProveedor"><option value="">${marcas.length === 1 ? esc(marcas[0]) : "Varias marcas"}</option>${rm.proveedores.map(x => `<option value="${esc(x.nombre)}">${esc(x.nombre)}</option>`).join("")}</select></label>`
            : "";
        const puede = ls.length && !rm.enviando;

        r.innerHTML = `<div class="rm-resumen-cab"><h3>Tu pedido</h3></div>
            <div class="rm-lineas">${ls.map(l => `<div class="rm-linea" style="--marca:${colorDe(l.p)}"><i class="rm-linea-mini">${typeof miniaturaProducto === "function" ? miniaturaProducto(l.p) : ""}</i><div class="rm-linea-datos"><span>${esc(l.p.nombre)}</span></div><b>${numero(l.n)}</b><button type="button" onclick="rmQuitar(${l.id})" aria-label="Quitar">✕</button></div>`).join("") || `<p class="rm-nota">Todavía no anotas nada.</p>`}</div>
            <div class="rm-total"><span>${ls.length} producto${ls.length === 1 ? "" : "s"}</span><b>${numero(piezas)} piezas</b></div>
            ${ls.length ? `<div class="rm-total"><span>Total estimado</span><b>${dinero(total)}</b></div>${sinCosto ? `<p class="rm-nota">${sinCosto} producto${sinCosto === 1 ? "" : "s"} sin costo guardado: no suma${sinCosto === 1 ? "" : "n"} al total.</p>` : ""}` : ""}
            ${proveedor}
            <button type="button" class="rm-btn principal grande" id="rmConfirmar" onclick="rmConfirmar()" ${puede ? "" : "disabled"}>${rm.enviando ? "Guardando…" : "Guardar pedido"}</button>
            <button type="button" class="rm-btn" onclick="rmGuardarPedido(true)" ${puede ? "" : "disabled"}>Guardar y marcar como enviado</button>`;
    }

    async function guardarPedidoRM(enviado) {
        const ls = lineas();
        if (!rm || rm.enviando || !ls.length) return;

        const piezas = ls.reduce((s, l) => s + l.n, 0);
        const elegido = document.getElementById("rmProveedor")?.value || "";
        const marcas = [...new Set(ls.map(l => marcaDe(l.p)).filter(Boolean))];
        const proveedor = elegido || (marcas.length <= 3 ? marcas.join(", ") : marcas.slice(0, 3).join(", ") + "…");

        const ok = await confirmarPOS(`Se guarda el pedido de ${proveedor || "varias marcas"} con ${ls.length} producto${ls.length === 1 ? "" : "s"} y ${numero(piezas)} pieza${piezas === 1 ? "" : "s"}${enviado ? ", marcado como enviado" : ", como borrador (sin enviar)"}.`, "Guardar pedido", "info");
        if (!ok) return;

        rm.enviando = true;
        pintarResumen();

        const r = await llamar("/pedidos-proveedor", {
            method: "POST",
            body: JSON.stringify({
                proveedor,
                estado: enviado ? "enviado" : "borrador",
                notas: rm.modo === "sugerir" ? "Sugerido por Nexo (mínimos y máximos)" : "Creado con Crear pedido",
                items: ls.map(l => ({ productoId: l.id, codigo: l.p.codigo, nombre: l.p.nombre, cantidad: l.n, costo: costoDe(l.p), unidad: "pieza", proveedor }))
            })
        });

        rm.enviando = false;

        if (!r.ok) { pintarResumen(); aviso(r.datos.error || "No se pudo guardar el pedido.", "error"); return; }

        aviso(enviado ? "Pedido guardado y marcado como enviado." : "Pedido guardado como borrador.");
        if (typeof mostrarPedidosHechos === "function") await mostrarPedidosHechos();
        else if (typeof mostrarPedidosProveedor === "function") await mostrarPedidosProveedor();
    }

    window.rmGuardarPedido = guardarPedidoRM;

    function fechaCorta(f) {
        const d = new Date(f.fechaDocumento || f.creadaEn || "");
        return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString("es-MX", { day: "numeric", month: "short" });
    }

    // "Llegó hoy / ayer / hace 3 días / hace 2 semanas": para reconocer una factura de un vistazo.
    function haceCuanto(f) {
        const d = new Date(f.creadaEn || f.fechaDocumento || "");
        if (Number.isNaN(d.getTime())) return "";
        const hoy = new Date(); hoy.setHours(0, 0, 0, 0);
        const dia = new Date(d); dia.setHours(0, 0, 0, 0);
        const dias = Math.round((hoy - dia) / 86400000);
        if (dias <= 0) return "Llegó hoy";
        if (dias === 1) return "Llegó ayer";
        if (dias < 14) return `Llegó hace ${dias} días`;
        if (dias < 60) return `Llegó hace ${Math.floor(dias / 7)} semanas`;
        return `Llegó hace ${Math.floor(dias / 30)} meses`;
    }

    function facturasFiltradas() {
        const q = plano(rm.busFactura).trim();
        const lista = rm.facturas;
        if (!q) return lista;
        return lista.filter(f => q.split(/\s+/).every(w => plano([f.proveedor, f.folio, f.claveCorta, (f.muestra || []).join(" ")].join(" ")).includes(w)));
    }

    // Recibir con factura: lista con buscador (proveedor, folio, producto). Al elegir una se abre Recepcion inteligente,
    // que es donde se revisan los productos nuevos, se escanea lo que llego y se confirma.
    function pintarFacturas() {
        const caja = document.getElementById("rmFacturas");
        if (!caja || !rm) return;
        if (rm.factura || esPedido()) { caja.innerHTML = rm.modo === "sugerir" ? `<div class="rm-esquina"><button type="button" class="rm-btn" onclick="mostrarPedidoSugerido()" title="El cálculo de siempre, con tus ventas y el día de visita de cada proveedor">Ver el cálculo por ventas</button></div>` : ""; return; }

        // Abarrotes: "Recibir con factura" e "Historial" siempre a la mano en la esquina (aunque no haya facturas del correo pendientes).
        const historial = esAbarrotes() ? `<button type="button" class="rm-btn" onclick="rmHistorial()">Historial</button>` : "";

        if (!rm.facturas.length && !esAbarrotes()) { caja.innerHTML = ""; return; }

        const filas = facturasFiltradas().slice(0, 40).map(f => `<button type="button" class="rm-factura-fila" onclick="rmIrAFactura(${Number(f.id)})">
            <span><b>${esc(f.proveedor)}</b><em class="rm-factura-hace">${esc(haceCuanto(f))}</em><small>${f.folio ? "Folio " + esc(f.folio) : (f.claveCorta ? "Factura …" + esc(f.claveCorta) : "Sin folio")} · ${esc(fechaCorta(f))} · ${f.totalItems} producto${f.totalItems === 1 ? "" : "s"}</small>${(f.muestra || []).length ? `<small class="rm-factura-muestra">${esc(f.muestra.map(n => String(n).slice(0, 26)).join(" · "))}</small>` : ""}</span>
            <strong>${dinero(f.total)}</strong></button>`).join("");

        const n = rm.facturas.length;
        // Abarrotes: subir la factura (o la foto de la remision) y ver el estado del correo se hace aqui mismo, sin salir de Recibir mercancia.
        const subir = esAbarrotes() ? `<div class="rm-subir"><input type="file" id="rmArchivoXml" accept=".xml,text/xml" hidden onchange="rmSubirFactura(this)"><input type="file" id="rmArchivoRemision" accept="image/*" hidden onchange="rmSubirRemision(this)">
                <button type="button" class="rm-btn principal" onclick="document.getElementById('rmArchivoXml').click()">Subir factura (XML)</button>
                <button type="button" class="rm-btn" onclick="document.getElementById('rmArchivoRemision').click()">Subir remisión (foto)</button><span class="rm-subiendo" id="rmSubiendo"></span></div>` : "";
        const lista = n ? `<input id="rmBuscarFactura" class="rm-buscar" type="search" placeholder="Buscar por proveedor, folio o producto…" oninput="rmBuscarFactura(this.value)" value="${esc(rm.busFactura)}"><div class="rm-facturas-lista" id="rmFacturasLista">${filas || '<p class="rm-nota">Ninguna factura coincide.</p>'}</div>` : `<p class="rm-nota">No hay facturas por recibir. Súbela aquí, o conecta tu correo para que lleguen solas.</p>`;

        caja.innerHTML = `<div class="rm-esquina"><button type="button" class="rm-btn principal" onclick="rmVerFacturas(${rm.verFacturas ? "false" : "true"})">Recibir con factura${n ? " (" + n + ")" : ""} ${rm.verFacturas ? "▴" : "▾"}</button>${historial}</div>
            ${rm.verFacturas ? `<div class="rm-facturas-panel">${subir}${lista}${esAbarrotes() ? `<div class="rm-correo" id="rmCorreo">${correoHtml()}</div>` : ""}</div>` : ""}`;

        if (rm.verFacturas) { const c = document.getElementById("rmBuscarFactura"); if (c && document.activeElement !== c && !rm.busFactura) c.focus(); }
    }

    const pausa = ms => new Promise(r => setTimeout(r, ms));
    let temporizadorEntra = null;

    // Las tarjetas y el resumen entran con una animacion corta; la clase se quita sola para que escribir en el buscador no la repita.
    function entrar() {
        const ids = ["rmMarcas", "rmGrid", "rmResumen"];
        ids.forEach(id => document.getElementById(id)?.classList.add("rm-entra"));
        clearTimeout(temporizadorEntra);
        temporizadorEntra = setTimeout(() => ids.forEach(id => document.getElementById(id)?.classList.remove("rm-entra")), 1000);
    }

    window.rmCambiarMarca = async function () {
        if (esAbarrotes() && rm.marca && !rm.factura) {
            document.getElementById("rmGrid")?.classList.add("rm-saliendo");
            if (!lineas().length) document.getElementById("rmResumen")?.classList.add("rm-saliendo");
            await pausa(200);
        }
        rm.marca = ""; rm.linea = ""; rm.consulta = ""; const b = document.getElementById("rmBuscar"); if (b) b.value = "";
        document.querySelectorAll("#rmGrid, #rmResumen").forEach(x => x.classList.remove("rm-saliendo"));
        pintarFiltros(); pintarGrid(); entrar();
    };
    window.rmHistorial = function () { cerrarPanelFacturas(); if (typeof abrirHistorialRecepciones === "function") abrirHistorialRecepciones(); };
    window.rmFacturaManual = function () { if (typeof mostrarRecepcionInteligente === "function") mostrarRecepcionInteligente(); };
    window.rmVerFacturas = function (ver) { rm.verFacturas = Boolean(ver); pintarFacturas(); if (ver && esAbarrotes()) cargarCorreo(); };

    // El panel de facturas es un menu desplegable: se cierra al tocar fuera de el, al presionar Escape y al abrir el historial.
    function cerrarPanelFacturas() {
        if (!rm || !rm.verFacturas) return;
        rm.verFacturas = false;
        pintarFacturas();
    }

    document.addEventListener("click", evento => {
        if (!rm || !rm.verFacturas) return;
        // El camino del evento se fija al empezar: sirve aunque el boton tocado ya se haya vuelto a dibujar (y salido del documento).
        if (evento.composedPath && evento.composedPath().some(n => n && n.id === "rmFacturas")) return;
        cerrarPanelFacturas();
    });
    document.addEventListener("keydown", evento => { if (evento.key === "Escape") cerrarPanelFacturas(); });

    // ---------- Subir factura / remision y correo (Recibir con factura, abarrotes) ----------

    const subiendo = texto => { const c = document.getElementById("rmSubiendo"); if (c) c.textContent = texto || ""; };

    function correoHtml() {
        const c = rm && rm.correo;
        if (!c || !c.configurado) return "";
        if (!c.conectado) return `<span>Conecta tu correo y las facturas llegan solas.</span><button type="button" class="rm-enlace" onclick="rmConectarCorreo()">Conectar correo</button>`;
        return `<span>Correo conectado: <b>${esc(c.correo)}</b></span><button type="button" class="rm-enlace" onclick="rmRevisarCorreo(this)">Revisar ahora</button><button type="button" class="rm-enlace" onclick="mostrarCorreoFacturas()">Configurar</button>`;
    }

    async function cargarCorreo() {
        if (typeof estadoCorreoFacturas !== "function") return;
        const estadoCorreo = await estadoCorreoFacturas();
        if (!rm) return;
        rm.correo = estadoCorreo;
        const caja = document.getElementById("rmCorreo");
        if (caja) caja.innerHTML = correoHtml();
    }

    async function refrescarFacturas() {
        const r = await llamar("/recepcion-inteligente/facturas");
        if (rm && r.ok) rm.facturas = (r.datos.facturas || []).filter(f => f.estado === "pendiente");
    }

    // Despues de subir: se actualiza la lista y la factura se abre aqui mismo para confirmar lo que llego.
    async function abrirSubida(datos, texto) {
        aviso(texto);
        await refrescarFacturas();
        if (!rm) return;
        rm.verFacturas = false;
        pintarFacturas();
        if (datos.recepcionId && rm.facturas.some(f => Number(f.id) === Number(datos.recepcionId))) await window.rmAbrirFactura(datos.recepcionId);
    }

    window.rmSubirFactura = async function (input) {
        const archivo = input.files && input.files[0];
        input.value = "";
        if (!archivo) return;
        subiendo("Leyendo la factura…");

        try {
            const xml = await archivo.text();
            const r = await llamar("/recepcion-inteligente/facturas", { method: "POST", body: JSON.stringify({ xml }) });
            if (!r.ok) { aviso(r.datos.error || "No se pudo leer la factura. ¿Es un XML de factura válido?", "error"); return; }
            await abrirSubida(r.datos, r.datos.repetida ? "Esa factura ya se había subido antes." : `Factura leída: ${r.datos.totalConceptos} producto${r.datos.totalConceptos === 1 ? "" : "s"}.`);
        } catch (error) {
            aviso("No se pudo leer el archivo. ¿Es un XML de factura válido?", "error");
        } finally {
            subiendo("");
        }
    };

    window.rmSubirRemision = async function (input) {
        const archivo = input.files && input.files[0];
        input.value = "";
        if (!archivo) return;
        subiendo("Leyendo la remisión…");

        try {
            const imagenBase64 = await redimensionarImagenCanvas(archivo, 1600);
            const r = await llamar("/recepcion-inteligente/remision-foto", { method: "POST", body: JSON.stringify({ imagenBase64 }) });
            if (!r.ok) { aviso(r.datos.error || "No se pudo leer la remisión.", "error"); return; }
            if (!r.datos.disponible) { aviso("Nexo IA no está disponible en tu plan por ahora.", "info"); return; }
            await abrirSubida(r.datos, `Remisión leída${r.datos.proveedorDetectado ? " de " + r.datos.proveedorDetectado : ""}: ${r.datos.totalConceptos} producto${r.datos.totalConceptos === 1 ? "" : "s"}.`);
        } catch (error) {
            aviso("No se pudo leer la foto. ¿Es una imagen válida?", "error");
        } finally {
            subiendo("");
        }
    };

    window.rmConectarCorreo = async function () { if (typeof conectarCorreoFacturas === "function") await conectarCorreoFacturas(); };
    window.rmRevisarCorreo = async function (boton) {
        if (typeof revisarCorreoFacturas !== "function") return;
        if (boton) { boton.disabled = true; boton.textContent = "Buscando…"; }
        await revisarCorreoFacturas();
        await refrescarFacturas();
        if (rm) pintarFacturas();
        cargarCorreo();
    };
    window.rmBuscarFactura = function (texto) { rm.busFactura = texto; const l = document.getElementById("rmFacturasLista"); if (!l) return; const antes = rm.verFacturas; pintarFacturas(); rm.verFacturas = antes; const c = document.getElementById("rmBuscarFactura"); if (c) { c.focus(); c.setSelectionRange(c.value.length, c.value.length); } };
    window.rmIrAFactura = function (id) {
        if (typeof mostrarRecepcionInteligente === "function") mostrarRecepcionInteligente().then(() => { if (typeof riVerDetalle === "function") riVerDetalle(Number(id)); });
    };

    // ---------- interacciones ----------

    window.rmBuscar = function (texto) { rm.consulta = texto; pintarFiltros(); pintarGrid(); };
    // Codigos de un producto: el principal y los alternos que traiga el catalogo.
    function codigosDe(p) {
        const extra = [p.codigos_relacionados, p.codigosRelacionados, p.codigos].find(Array.isArray) || [];
        return [p.codigo, ...extra.map(c => (c && typeof c === "object" ? c.codigo : c))].map(c => String(c || "").toLowerCase().replace(/[^a-z0-9]/g, "")).filter(Boolean);
    }

    function pitido(bien) {
        try {
            const ctx = pitido.ctx || (pitido.ctx = new (window.AudioContext || window.webkitAudioContext)());
            const o = ctx.createOscillator(), g = ctx.createGain();
            o.frequency.value = bien ? 880 : 220; g.gain.value = 0.08;
            o.connect(g); g.connect(ctx.destination); o.start(); o.stop(ctx.currentTime + (bien ? 0.07 : 0.22));
        } catch (error) { /* sin audio: no pasa nada */ }
    }

    // Enter en el buscador: si es el codigo exacto de un producto, suma 1 y sigue; si no, se queda como busqueda.
    window.rmEscanear = function (texto) {
        const codigo = String(texto || "").toLowerCase().replace(/[^a-z0-9]/g, "");
        const campo = document.getElementById("rmBuscar");
        if (!codigo) return;

        const p = rm.todos.find(x => codigosDe(x).includes(codigo));

        if (p) {
            const id = Number(p.id);
            rm.cantidades.set(id, (rm.cantidades.get(id) || 0) + 1);
            rm.ultimo = { id };
            rm.consulta = ""; if (campo) campo.value = "";
            actualizarTarjeta(id); pintarFiltros(); pintarGrid(); pintarResumen(); pintarUltimo();
            pitido(true);
            if (campo) campo.focus();
            return;
        }

        pitido(false);
        aviso(/^\d{6,}$/.test(codigo) ? "Ese código no está en tu catálogo. Si es un producto nuevo, agrégalo en Inventario o recíbelo con la factura." : "No encontré ese producto.", "error");
        if (campo) campo.select();
    };

    window.rmLinea = function (linea) { rm.linea = linea || ""; pintarFiltros(); pintarGrid(); };
    window.rmVerMarcas = function (ver) { rm.verTodasMarcas = Boolean(ver); pintarFiltros(); };

    window.rmTipo = function (tipo) { rm.linea = ""; rm.tipo = tipo || ""; const v = gruposVisibles(); if (!v.some(g => g.marca === rm.marca)) rm.marca = esAbarrotes() ? "" : v[0].marca; rm.consulta = ""; const b = document.getElementById("rmBuscar"); if (b) b.value = ""; pintarFiltros(); pintarGrid(); };
    window.rmMarca = async function (marca) {
        // Abarrotes: la tarjeta elegida resalta y las demas se desvanecen antes de abrir los productos.
        if (soloMarcas()) {
            const m = document.getElementById("rmMarcas");
            if (m) { m.querySelectorAll(".rm-marca").forEach(b => b.classList.toggle("rm-elegida", b.dataset.marca === marca)); m.classList.add("rm-saliendo"); await pausa(240); }
        }
        rm.marca = marca; rm.linea = ""; rm.consulta = ""; if (rm.modo === "sugerir") rellenarSugeridos(marca); const b = document.getElementById("rmBuscar"); if (b) b.value = "";
        document.getElementById("rmMarcas")?.classList.remove("rm-saliendo");
        pintarFiltros(); pintarGrid(); entrar();
    };
    window.rmSumar = function (id, delta) { if (rm.tocados) rm.tocados.add(Number(id)); rm.cantidades.set(id, Math.max(0, (rm.cantidades.get(id) || 0) + delta)); actualizarTarjeta(id); pintarResumen(); pintarFiltros(); pintarUltimo(); };
    window.rmEscribir = function (id, valor) { if (rm.tocados) rm.tocados.add(Number(id)); const n = Number(valor); rm.cantidades.set(id, Number.isFinite(n) && n > 0 ? n : 0); const t = document.querySelector(`#rmGrid .rm-tarjeta[data-id="${id}"]`); if (t) t.classList.toggle("con-entrada", (rm.cantidades.get(id) || 0) > 0); pintarResumen(); };
    window.rmQuitar = function (id) { if (rm.tocados) rm.tocados.add(Number(id)); rm.cantidades.set(id, 0); actualizarTarjeta(id); pintarResumen(); pintarFiltros(); };
    window.rmLlego = function (id) { const p = rm.indice.get(id); if (p && p.esperado != null) { rm.cantidades.set(id, p.esperado); actualizarTarjeta(id); pintarResumen(); } };

    window.rmTodoFactura = function () { if (!rm.factura) return; rm.factura.cards.forEach(c => rm.cantidades.set(Number(c.id), c.esperado)); pintarGrid(); pintarResumen(); };

    window.rmIrADecidir = function () {
        const id = rm.factura && rm.factura.id;
        if (typeof mostrarRecepcionInteligente === "function") mostrarRecepcionInteligente().then(() => { if (id && typeof riVerDetalle === "function") riVerDetalle(id); });
    };

    // ---------- factura del correo ----------

    window.rmAbrirFactura = async function (id) {
        id = Number(id);
        if (!id) return;
        if (lineas().length && !(await confirmarPOS("Lo que ya anotaste en esta pantalla se descarta al abrir la factura. ¿Continuar?", "Abrir factura", "alerta"))) { pintarFacturas(); return; }

        const r = await llamar(`/recepcion-inteligente/facturas/${id}`);
        if (!r.ok) { aviso(r.datos.error || "No se pudo abrir la factura.", "error"); return; }

        const lista = rm.facturas.find(f => Number(f.id) === id) || {};
        const items = (r.datos.items || []).filter(i => i.accion && i.accion !== "omitir");
        const porDecidir = (r.datos.items || []).filter(i => !i.accion).length;
        const porCard = new Map();

        items.forEach(i => {
            const pid = Number(i.productoId) > 0 ? Number(i.productoId) : -Number(i.id);
            const base = rm.indice.get(pid) || { id: pid, nombre: i.descripcion || "Producto", stock: 0, codigo: i.codigo };
            const c = porCard.get(pid) || { ...base, id: pid, esperado: 0, itemIds: [], esperados: [], nuevoProducto: !(Number(i.productoId) > 0) };
            c.esperado += Number(i.cantidad) || 0;
            c.itemIds.push(i.id);
            c.esperados.push(Number(i.cantidad) || 0);
            porCard.set(pid, c);
        });

        const cards = [...porCard.values()];
        rm.respaldo = rm.respaldo || { grupos: rm.grupos, todos: rm.todos, indice: rm.indice, marca: rm.marca, tipo: rm.tipo };
        rm.factura = { id, proveedor: lista.proveedor || r.datos.recepcion?.proveedor || "Proveedor", folio: lista.folio || r.datos.recepcion?.folio || "", total: Number(lista.total || r.datos.recepcion?.total || 0), cards, porDecidir };
        rm.grupos = [{ marca: "Factura", productos: cards }];
        rm.todos = cards;
        rm.indice = new Map(cards.map(c => [Number(c.id), c]));
        rm.marca = "Factura";
        rm.tipo = "";
        rm.consulta = "";
        rm.cantidades = new Map();
        pintar();
        cargarComparacion(id);
    };

    // Factura <-> pedido: lo pedido, lo que llego y lo que cobra la factura. Llega despues y nunca bloquea la pantalla.
    async function cargarComparacion(id, pedidoId) {
        const r = await llamar(`/recepcion-inteligente/facturas/${id}/comparacion${pedidoId ? "?pedidoId=" + Number(pedidoId) : ""}`);

        if (!rm || !rm.factura || rm.factura.id !== id || !r.ok || !r.datos.pedido) return;

        rm.factura.comp = r.datos;
        pintarResumen();
    }

    window.rmCompPedido = function (pedidoId) { if (rm && rm.factura && rm.factura.id) cargarComparacion(rm.factura.id, pedidoId); };

    const ROTULOS_COMP = { igual: "Igual", menos: "Menos que lo pedido", mas: "Más que lo pedido", no_viene: "No viene en la factura", no_pedido: "No lo pediste" };

    function comparacionHtml() {
        const c = rm.factura && rm.factura.comp;

        if (!c || !c.pedido) return "";

        const r = c.resumen;
        const partes = [];
        if (r.faltan) partes.push(`${r.faltan} sin llegar completo`);
        if (r.sobran) partes.push(`${r.sobran} de más`);
        if (r.preciosSuben) partes.push(`${r.preciosSuben} subió de precio`);
        if (r.preciosBajan) partes.push(`${r.preciosBajan} bajó de precio`);

        return `<div class="rm-comp ${partes.length ? "con-dif" : "ok"}">
            <b>Pedido #${Number(c.pedido.id)} · ${esc(c.pedido.proveedor || "")}</b>
            <span>${partes.length ? esc(partes.join(" · ")) : "La factura coincide con lo que pediste."}</span>
            <button type="button" class="rm-enlace" onclick="rmVerComparacion()">Ver pedido contra factura</button>
            ${c.candidatos.length > 1 ? `<label class="rm-comp-otro">¿Es otro pedido? <select onchange="rmCompPedido(this.value)">${c.candidatos.map(p => `<option value="${Number(p.id)}" ${p.id === c.pedido.id ? "selected" : ""}>#${Number(p.id)} · ${esc(p.proveedor || "")}</option>`).join("")}</select></label>` : ""}
        </div>`;
    }

    window.rmVerComparacion = function () {
        const c = rm && rm.factura && rm.factura.comp;
        if (!c) return;
        document.getElementById("rmCompFondo")?.remove();
        const fondo = document.createElement("div");
        fondo.id = "rmCompFondo";
        fondo.className = "rm-comp-fondo";
        fondo.onclick = e => { if (e.target === fondo) fondo.remove(); };
        fondo.innerHTML = `<div class="rm-comp-modal" role="dialog" aria-label="Pedido contra factura">
            <header><h3>Pedido #${Number(c.pedido.id)} contra la factura</h3><button type="button" onclick="document.getElementById('rmCompFondo').remove()" aria-label="Cerrar">✕</button></header>
            <table><thead><tr><th>Producto</th><th>Pediste</th><th>Llegó</th><th>Factura</th><th>Costo</th></tr></thead><tbody>${c.filas.map(f => `<tr class="${f.estado !== "igual" ? "dif" : ""}">
                <td><b>${esc(f.nombre)}</b>${f.estado !== "igual" ? `<small>${ROTULOS_COMP[f.estado]}</small>` : ""}</td>
                <td>${numero(f.pedido)}</td><td>${numero(f.llego)}</td><td>${numero(f.factura)}</td>
                <td>${f.costoFactura !== null ? dinero(f.costoFactura) : "—"}${f.cambioPrecio ? `<small class="${f.cambioPrecio}">${f.cambioPrecio === "sube" ? "▲ antes " : "▼ antes "}${dinero(f.costoAnterior)}</small>` : ""}</td></tr>`).join("")}</tbody></table>
        </div>`;
        document.body.appendChild(fondo);
    };

    window.rmSalirFactura = async function () {
        if (!rm.factura) return;
        if (lineas().length && !(await confirmarPOS(esDePedido() ? "Lo que anotaste de este pedido se descarta. ¿Salir?" : "Lo que anotaste de esta factura se descarta. ¿Salir?", "Salir", "alerta"))) return;
        if (esDePedido() && typeof mostrarPedidosHechos === "function") { await mostrarPedidosHechos(); return; }
        Object.assign(rm, rm.respaldo, { factura: null, respaldo: null, cantidades: new Map(), caducidades: new Map(), consulta: "" });
        pintar();
    };

    // Reparte lo contado de un producto entre los renglones de la factura que lo traen (casi siempre uno).
    function repartir(itemIds, esperados, contado) {
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

    async function confirmarFactura() {
        const f = rm.factura;
        const cantidadesRecibidas = {};
        let sinContar = 0;
        let distintos = 0;

        f.cards.forEach(c => {
            const n = rm.cantidades.get(Number(c.id)) || 0;
            if (!n) sinContar++; else if (n !== c.esperado) distintos++;
            Object.assign(cantidadesRecibidas, repartir(c.itemIds, c.esperados, n));
        });

        const ok = await confirmarPOS(`Se suma al inventario lo que contaste.${distintos ? ` ${distintos} producto(s) llegaron distinto a la factura.` : ""}${sinContar ? ` ${sinContar} producto(s) sin cantidad se reciben en 0.` : ""}`, "¿Confirmar la recepción?", "info");
        if (!ok) return;

        rm.enviando = true;
        pintarResumen();

        // Fechas de caducidad escritas (por producto -> por cada renglon de la factura que lo trae) y pago al repartidor
        const caducidades = {};
        f.cards.forEach(c => { const fecha = rm.caducidades.get(Number(c.id)); if (fecha) c.itemIds.forEach(id => { caducidades[id] = fecha; }); });

        const pago = pagoParaEnviar();
        if (pago === null) { await alertaPOS("Escribe cuánto le pagaste al repartidor, o desmarca “Pagué al repartidor”.", "Falta el monto", "info"); return; }

        const enviar = extra => llamar(`/recepcion-inteligente/facturas/${f.id}/confirmar`, { method: "POST", body: JSON.stringify({ cantidadesRecibidas, caducidades, ...(pago ? { pago } : {}), ignorarConciliacion: false, ...extra }) });
        let r = await enviar({});

        // Ya habias recibido esa mercancia a mano (con este proveedor): se pregunta si es la misma para NO sumarla dos veces.
        if (!r.ok && r.datos.requiereConciliacion) {
            const p = r.datos.remisionPendiente || {};
            const misma = await confirmarPOS(`Ya registraste una recepción de este proveedor${p.referencia ? ` (${p.referencia})` : ""}, con ${(p.items || []).length} producto(s). Si es la misma, la factura solo completa los costos y NO se vuelve a sumar al inventario.\n\nAceptar = es la misma. Cancelar = es otra.`, "¿Es la mercancía que ya recibiste?", "info");

            if (misma) {
                r = await enviar({ conciliarConRecepcionMercanciaId: p.recepcionMercanciaId });
            } else if (await confirmarPOS("Se sumará al inventario lo que verificaste, además de lo que ya habías recibido.", "¿Sumarla como nueva?", "alerta")) {
                r = await enviar({ ignorarConciliacion: true });
            } else {
                rm.enviando = false;
                pintarResumen();
                return;
            }
        }

        rm.enviando = false;

        if (!r.ok) { pintarResumen(); aviso(r.datos.error || "No se pudo confirmar la factura.", "error"); return; }

        aviso(r.datos.conciliada ? "Factura confirmada: completó los costos de lo que ya habías recibido." : "Factura recibida: inventario actualizado.");
        if (pago && !r.datos.pagoGuardado) aviso("La factura se recibió, pero el pago al repartidor no quedó anotado.", "info");
        if (r.datos.cuentaPorPagar) { const c = r.datos.cuentaPorPagar; aviso(c.accion === "creada" ? `Quedó en tu Agenda de pagos: ${dinero(c.monto)} a ${c.proveedor || "tu proveedor"}${c.vencimiento ? ", vence el " + c.vencimiento.split("-").reverse().join("/") : ""}.` : `Se actualizó lo que debes a ${c.proveedor || "tu proveedor"} al total de la factura: ${dinero(c.monto)}.`); }
        if (pago && r.datos.pagoGuardado) await anotarSalidaEnCaja(pago, f.proveedor, r.datos.recepcionMercanciaId);
        if (typeof cargarProductos === "function") await cargarProductos();
        await window.mostrarRecibirMarca();
    }

    // Recibir contra un pedido: lo que llego se suma al inventario y al pedido (parcial o recibido). Pago, caducidad y "sin factura" igual que al recibir a mano.
    async function confirmarPedidoRecibido() {
        const f = rm.factura;
        const ls = lineas();
        const pago = pagoParaEnviar();

        if (pago === null) { await alertaPOS("Escribe cuánto le pagaste al repartidor, o desmarca “Pagué al repartidor”.", "Falta el monto", "info"); return; }

        const faltan = f.cards.filter(c => !((rm.cantidades.get(Number(c.id)) || 0) > 0)).length;
        const distintos = f.cards.filter(c => { const n = rm.cantidades.get(Number(c.id)) || 0; return n > 0 && n !== c.esperado; }).length;
        const piezas = ls.reduce((t, l) => t + l.n, 0);
        const ok = await confirmarPOS(`Se suman ${numero(piezas)} pieza(s) al inventario y al pedido #${f.pedidoId}.${distintos ? ` ${distintos} producto(s) llegaron distinto a lo pedido.` : ""}${faltan ? ` ${faltan} producto(s) no llegaron: quedan pendientes en el pedido.` : ""}`, "¿Confirmar la recepción del pedido?", "info");
        if (!ok) return;

        rm.enviando = true;
        pintarResumen();

        const r = await llamar("/recepciones-mercancia/rapida", {
            method: "POST",
            body: JSON.stringify({
                proveedor: f.proveedor,
                sinFactura: true,   // la factura de lo pedido llega despues: Nexo la compara y no suma dos veces
                pedidoId: f.pedidoId,
                referencia: "Pedido #" + f.pedidoId,
                usuarioNombre: nombreQuienRecibe(),
                idempotencyKey: rm.llave,
                items: ls.map(l => ({ productoId: l.id, cantidad: l.n, costo: 0, ...(rm.caducidades.get(l.id) ? { caducidad: rm.caducidades.get(l.id) } : {}) })),
                ...(pago ? { pago } : {})
            })
        });

        rm.enviando = false;

        if (!r.ok) { pintarResumen(); aviso(r.datos.error || "No se pudo guardar. No se sumó nada al inventario.", "error"); return; }

        if (pago && !r.datos.pagoGuardado && !r.datos.repetida) aviso("La mercancía se recibió, pero el pago al repartidor no quedó anotado.", "info");
        if (pago && r.datos.pagoGuardado) await anotarSalidaEnCaja(pago, f.proveedor, r.datos.recepcion && r.datos.recepcion.id);

        aviso(r.datos.repetida ? "Esa recepción ya estaba guardada." : (r.datos.pedidoEstado === "recibido" ? `Pedido #${f.pedidoId} recibido completo.` : `Recibido. El pedido #${f.pedidoId} sigue con productos pendientes.`));
        if (typeof cargarProductos === "function") await cargarProductos();
        if (typeof mostrarPedidosHechos === "function") await mostrarPedidosHechos(); else await window.mostrarRecibirMarca();
    }

    // ---------- confirmar ----------

    window.rmConfirmar = async function () {
        if (!rm || rm.enviando || !lineas().length) return;
        if (esPedido()) { await guardarPedidoRM(false); return; }

        if (esDePedido()) { await confirmarPedidoRecibido(); return; }

        if (rm.factura) {
            if (rm.factura.porDecidir) { await alertaPOS(`Esta factura trae ${rm.factura.porDecidir} concepto(s) que Nexo no pudo emparejar. Decídelos en Recepción inteligente y luego confirma aquí.`, "Faltan conceptos por decidir", "info"); return; }
            await confirmarFactura();
            return;
        }

        const ls = lineas();
        const piezas = ls.reduce((s, l) => s + l.n, 0);
        const proveedor = document.getElementById("rmProveedor")?.value || "";

        const pago = pagoParaEnviar();
        if (pago === null) { await alertaPOS("Escribe cuánto le pagaste al repartidor, o desmarca “Pagué al repartidor”.", "Falta el monto", "info"); return; }

        const ok = await confirmarPOS(`Se suman ${numero(piezas)} pieza(s) (${ls.length} producto${ls.length === 1 ? "" : "s"}) al inventario.${proveedor ? `\nQuedan como “recibido sin factura” de ${proveedor}: cuando llegue su factura Nexo la compara y no suma dos veces.` : ""}`, "Recibir mercancía", "info");
        if (!ok) return;

        rm.enviando = true;
        pintarResumen();

        const r = await llamar("/recepciones-mercancia/rapida", {
            method: "POST",
            body: JSON.stringify({
                proveedor: proveedor || "Varios",
                sinFactura: Boolean(proveedor),
                referencia: "Recibir por marca",
                usuarioNombre: (typeof usuarioActual !== "undefined" && usuarioActual?.nombre) || "",
                idempotencyKey: rm.llave,
                items: ls.map(l => ({ productoId: l.id, cantidad: l.n, costo: 0, ...(rm.caducidades.get(l.id) ? { caducidad: rm.caducidades.get(l.id) } : {}) })),
                ...(pago ? { pago } : {})
            })
        });

        rm.enviando = false;

        if (!r.ok) { pintarResumen(); aviso(r.datos.error || "No se pudo guardar. No se sumó nada al inventario.", "error"); return; }

        if (pago && !r.datos.pagoGuardado && !r.datos.repetida) aviso("La mercancía se recibió, pero el pago al repartidor no quedó anotado.", "info");
        if (pago && r.datos.pagoGuardado) await anotarSalidaEnCaja(pago, proveedor, r.datos.recepcion && r.datos.recepcion.id);

        aviso(r.datos.repetida ? "Esa recepción ya estaba guardada." : `Recepción guardada: ${ls.length} producto${ls.length === 1 ? "" : "s"} sumado${ls.length === 1 ? "" : "s"} al inventario.`);
        if (typeof cargarProductos === "function") await cargarProductos();
        await window.mostrarRecibirMarca();
    };
})();
