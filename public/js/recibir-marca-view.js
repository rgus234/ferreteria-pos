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

    const esc = valor => String(valor ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
    const plano = texto => String(texto || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
    const numero = valor => Number(valor || 0).toLocaleString("es-MX", { maximumFractionDigits: 3 });
    const dinero = valor => "$" + Number(valor || 0).toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const aviso = (mensaje, tipo) => { if (typeof mostrarToastPOS === "function") mostrarToastPOS(mensaje, tipo ? { tipo } : undefined); };
    const tipoDeGrupo = g => TIPO_POR_MARCA[plano(g.marca)] || "Otras";

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
                if (productosDe.length) grupos.push({ marca: d.nombre, productos: productosDe });
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
        [...resto.values()].sort((a, b) => b.lista.length - a.lista.length).forEach(g => grupos.push({ marca: nombreBonito(g.formas), productos: g.lista }));

        return grupos;
    }

    function tiposActivos() {
        if (!rm || rm.factura) return [];
        const presentes = new Set(rm.grupos.map(tipoDeGrupo));
        const lista = ORDEN_TIPOS.filter(x => presentes.has(x));
        return lista.length > 1 ? lista : [];
    }

    function marcasQueCoinciden() {
        const q = plano(rm.consulta).trim();
        if (!q || rm.factura) return [];
        const palabras = q.split(/\s+/).filter(Boolean);
        return rm.grupos.filter(g => palabras.every(w => plano(g.marca).includes(w)));
    }

    function gruposVisibles() {
        const coinciden = marcasQueCoinciden();
        if (coinciden.length) return coinciden;
        if (!rm.tipo || rm.factura) return rm.grupos;
        const lista = rm.grupos.filter(g => tipoDeGrupo(g) === rm.tipo);
        return lista.length ? lista : rm.grupos;
    }

    function productosVisibles() {
        const q = plano(rm.consulta).trim();

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
        return grupo ? grupo.productos : [];
    }

    // ---------- pantalla ----------

    window.mostrarRecibirMarca = async function () {
        if (typeof ocultarPantallasPrincipales === "function") ocultarPantallasPrincipales();
        const pantalla = document.getElementById("pantallaRecibirMarca");
        if (!pantalla) return;
        pantalla.style.display = "block";
        if (typeof actualizarTopbarContexto === "function") actualizarTopbarContexto("Recibir por marca", "Anota lo que llegó por marca o con la factura", "recibir-marca");
        pantalla.innerHTML = `<div class="rm-shell"><p class="rm-nota">Cargando tu catálogo…</p></div>`;

        if (!Array.isArray(todosProductos) || !todosProductos.length) { try { await cargarProductos(); } catch (error) { /* se avisa abajo */ } }
        const productos = (Array.isArray(todosProductos) ? todosProductos : []).filter(p => Number(p.id) > 0);

        if (!productos.length) { pantalla.innerHTML = `<div class="rm-shell"><p class="rm-nota">Todavía no hay productos en tu catálogo.</p></div>`; return; }

        const grupos = await armarGrupos(productos);
        rm = { productos, grupos, todos: productos, indice: new Map(productos.map(p => [Number(p.id), p])), marca: grupos.length > MUCHAS_MARCAS ? "" : (grupos[0]?.marca || ""), verTodasMarcas: false, verFacturas: false, busFactura: "", ultimo: null, tipo: "", consulta: "", cantidades: new Map(), proveedores: [], facturas: [], factura: null, respaldo: null, enviando: false, llave: (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : "rm-" + Date.now() + "-" + Math.random().toString(16).slice(2) };
        pintar();

        llamar("/proveedores").then(r => { if (rm) { rm.proveedores = (r.datos.proveedores || []).map(x => ({ id: x.id, nombre: x.nombre })).filter(x => x.nombre); pintarResumen(); } }).catch(() => {});
        llamar("/recepcion-inteligente/facturas").then(r => { if (rm) { rm.facturas = (r.datos.facturas || []).filter(f => f.estado === "pendiente"); pintarFacturas(); } }).catch(() => {});
    };

    function pintar() {
        const pantalla = document.getElementById("pantallaRecibirMarca");
        if (!pantalla || !rm) return;

        pantalla.innerHTML = `<div class="rm-shell">
            <header class="rm-cab"><div><h2>${rm.factura ? "Recibir con factura" : "Recibir mercancía"}</h2><p>${rm.factura ? "Confirma lo que llegó de cada producto. Lo que dice la factura aparece como “Esperado”." : "Escanea cada producto con la pistola, o búscalo por nombre, código o marca. Cada escaneo suma 1."}</p></div>
                <div id="rmFacturas" class="rm-facturas"></div></header>
            <div class="rm-dos">
                <section class="rm-izq">
                    <input id="rmBuscar" class="rm-buscar rm-escaner" type="search" autocomplete="off" placeholder="📷 Escanea el código o escribe producto, código o marca…" oninput="rmBuscar(this.value)" onkeydown="if(event.key==='Enter'){event.preventDefault();rmEscanear(this.value)}" value="${esc(rm.consulta)}" ${rm.factura ? "style=\"display:none\"" : ""}>
                    <div id="rmUltimo" class="rm-ultimo" aria-live="polite"></div>
                    <div id="rmTipos" class="rm-chips"></div>
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
    }

    function pintarFiltros() {
        const tipos = tiposActivos();
        const chip = (valor, etiqueta, n) => `<button type="button" class="rm-chip${(rm.tipo || "") === valor ? " activo" : ""}" onclick="rmTipo('${esc(valor)}')">${esc(etiqueta)} <small>${n}</small></button>`;
        const t = document.getElementById("rmTipos");
        if (t) t.innerHTML = tipos.length ? chip("", "Todas", rm.grupos.length) + tipos.map(x => chip(x, x, rm.grupos.filter(g => tipoDeGrupo(g) === x).length)).join("") : "";

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
        const boton = g => {
            const llevo = g.productos.reduce((s, p) => s + (rm.cantidades.get(Number(p.id)) > 0 ? 1 : 0), 0);
            return `<button type="button" class="rm-marca${g.marca === rm.marca ? " activa" : ""}" onclick="rmMarca(${JSON.stringify(g.marca).replace(/"/g, "&quot;")})"><b>${esc(g.marca)}</b><small>${g.productos.length} producto${g.productos.length === 1 ? "" : "s"}${llevo ? ` · ${llevo} con entrada` : ""}</small></button>`;
        };
        const mas = ocultas > 0
            ? `<button type="button" class="rm-marca rm-mas" onclick="rmVerMarcas(true)"><b>Ver las ${ocultas} marcas restantes</b><small>o escribe la marca arriba</small></button>`
            : (rm.verTodasMarcas && !rm.factura && !buscando && todas.length > MARCAS_VISIBLES + 2 ? `<button type="button" class="rm-marca rm-mas" onclick="rmVerMarcas(false)"><b>Mostrar menos marcas</b></button>` : "");
        m.innerHTML = rm.factura ? "" : lista.map(boton).join("") + mas;
    }

    function tarjeta(p) {
        const id = Number(p.id);
        const n = rm.cantidades.get(id) || 0;
        const miniatura = typeof miniaturaProducto === "function" ? miniaturaProducto(p) : "";
        const esperado = p.esperado != null;
        const atajos = esperado
            ? `<button type="button" class="rm-llego" onclick="rmLlego(${id})">Llegó todo (${numero(p.esperado)})</button>`
            : [6, 12, 24].map(a => `<button type="button" onclick="rmSumar(${id}, ${a})">+${a}</button>`).join("");

        return `<article class="rm-tarjeta${n > 0 ? " con-entrada" : ""}" data-id="${id}">
            <div class="rm-foto">${miniatura}</div>
            <b class="rm-nombre">${esc(p.nombre)}</b>
            <small class="rm-hay">Hay ${numero(p.stock)}${esperado ? ` · <span class="rm-esperado">${p.nuevoProducto ? "Nuevo · " : ""}Esperado ${numero(p.esperado)}</span>` : ""}</small>
            <div class="rm-cantidad"><button type="button" onclick="rmSumar(${id}, -1)" aria-label="Quitar uno">−</button><input type="number" min="0" step="any" inputmode="decimal" value="${n || ""}" placeholder="0" oninput="rmEscribir(${id}, this.value)" aria-label="Llegaron"><button type="button" onclick="rmSumar(${id}, 1)" aria-label="Agregar uno">+</button></div>
            <div class="rm-atajos">${atajos}</div></article>`;
    }

    function pintarGrid() {
        const g = document.getElementById("rmGrid");
        if (!g) return;
        const lista = productosVisibles();
        g.innerHTML = lista.length
            ? lista.slice(0, MAX_TARJETAS).map(tarjeta).join("") + (lista.length > MAX_TARJETAS ? `<p class="rm-nota rm-completo">Se muestran ${MAX_TARJETAS} de ${lista.length}. Usa el buscador para acotar.</p>` : "")
            : `<p class="rm-nota rm-completo">${rm.consulta.trim() ? "No encontré nada con eso." : (!rm.marca ? "Escanea un producto con la pistola, escribe su nombre o código, o elige una marca." : "Esta marca no tiene productos.")}</p>`;
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
        const campo = t.querySelector("input");
        if (campo && document.activeElement !== campo) campo.value = n || "";
    }

    function lineas() {
        return [...rm.cantidades.entries()].filter(([, n]) => n > 0).map(([id, n]) => ({ id, n, p: rm.indice.get(id) })).filter(l => l.p);
    }

    function pintarResumen() {
        const r = document.getElementById("rmResumen");
        if (!r || !rm) return;
        const ls = lineas();
        const piezas = ls.reduce((s, l) => s + l.n, 0);
        const sinDecidir = rm.factura ? rm.factura.porDecidir : 0;

        const proveedor = !rm.factura && rm.proveedores.length
            ? `<label class="rm-campo">¿De qué proveedor viene?<select id="rmProveedor"><option value="">Sin proveedor / no espero factura</option>${rm.proveedores.map(p => `<option value="${esc(p.nombre)}">${esc(p.nombre)}</option>`).join("")}</select><small>Si eliges uno y después te llega su factura por correo, Nexo la compara con lo que recibiste y no suma dos veces.</small></label>`
            : "";

        r.innerHTML = `<div class="rm-resumen-cab"><h3>${rm.factura ? esc(rm.factura.proveedor) : "Lo que llegó"}</h3>${rm.factura ? `<small>${rm.factura.folio ? "Folio " + esc(rm.factura.folio) + " · " : ""}${dinero(rm.factura.total)}</small>` : ""}</div>
            ${rm.factura ? `<div class="rm-acciones"><button type="button" class="rm-btn" onclick="rmTodoFactura()">Llegó todo</button><button type="button" class="rm-btn" onclick="rmSalirFactura()">Salir de la factura</button></div>` : ""}
            ${sinDecidir ? `<p class="rm-alerta">${sinDecidir} concepto${sinDecidir === 1 ? "" : "s"} por decidir (producto nuevo o sin emparejar). Resuélvelos en <button type="button" class="rm-enlace" onclick="rmIrADecidir()">Recepción inteligente</button> antes de confirmar.</p>` : ""}
            <div class="rm-lineas">${ls.map(l => `<div class="rm-linea"><span>${esc(l.p.nombre)}</span><b>${numero(l.n)}</b><button type="button" onclick="rmQuitar(${l.id})" aria-label="Quitar">✕</button></div>`).join("") || `<p class="rm-nota">Todavía no anotas nada.</p>`}</div>
            <div class="rm-total"><span>${ls.length} producto${ls.length === 1 ? "" : "s"}</span><b>${numero(piezas)} piezas</b></div>
            ${proveedor}
            <button type="button" class="rm-btn principal grande" id="rmConfirmar" onclick="rmConfirmar()" ${ls.length && !rm.enviando ? "" : "disabled"}>${rm.enviando ? "Guardando…" : (rm.factura ? "Confirmar recepción de la factura" : "Confirmar recepción")}</button>`;
    }

    function fechaCorta(f) {
        const d = new Date(f.fechaDocumento || f.creadaEn || "");
        return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString("es-MX", { day: "numeric", month: "short" });
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
        if (rm.factura || !rm.facturas.length) { caja.innerHTML = ""; return; }

        const filas = facturasFiltradas().slice(0, 40).map(f => `<button type="button" class="rm-factura-fila" onclick="rmIrAFactura(${Number(f.id)})">
            <span><b>${esc(f.proveedor)}</b><small>${f.folio ? "Folio " + esc(f.folio) : (f.claveCorta ? "Factura …" + esc(f.claveCorta) : "Sin folio")} · ${esc(fechaCorta(f))} · ${f.totalItems} producto${f.totalItems === 1 ? "" : "s"}</small>${(f.muestra || []).length ? `<small class="rm-factura-muestra">${esc(f.muestra.map(n => String(n).slice(0, 26)).join(" · "))}</small>` : ""}</span>
            <strong>${dinero(f.total)}</strong></button>`).join("");

        caja.innerHTML = `<button type="button" class="rm-btn principal" onclick="rmVerFacturas(${rm.verFacturas ? "false" : "true"})">Recibir con factura (${rm.facturas.length}) ${rm.verFacturas ? "▴" : "▾"}</button>
            ${rm.verFacturas ? `<div class="rm-facturas-panel"><input id="rmBuscarFactura" class="rm-buscar" type="search" placeholder="Buscar por proveedor, folio o producto…" oninput="rmBuscarFactura(this.value)" value="${esc(rm.busFactura)}"><div class="rm-facturas-lista" id="rmFacturasLista">${filas || '<p class="rm-nota">Ninguna factura coincide.</p>'}</div></div>` : ""}`;

        if (rm.verFacturas) { const c = document.getElementById("rmBuscarFactura"); if (c && document.activeElement !== c && !rm.busFactura) c.focus(); }
    }

    window.rmVerFacturas = function (ver) { rm.verFacturas = Boolean(ver); pintarFacturas(); };
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

    window.rmVerMarcas = function (ver) { rm.verTodasMarcas = Boolean(ver); pintarFiltros(); };

    window.rmTipo = function (tipo) { rm.tipo = tipo || ""; const v = gruposVisibles(); if (!v.some(g => g.marca === rm.marca)) rm.marca = v[0].marca; rm.consulta = ""; const b = document.getElementById("rmBuscar"); if (b) b.value = ""; pintarFiltros(); pintarGrid(); };
    window.rmMarca = function (marca) { rm.marca = marca; rm.consulta = ""; const b = document.getElementById("rmBuscar"); if (b) b.value = ""; pintarFiltros(); pintarGrid(); };
    window.rmSumar = function (id, delta) { rm.cantidades.set(id, Math.max(0, (rm.cantidades.get(id) || 0) + delta)); actualizarTarjeta(id); pintarResumen(); pintarFiltros(); pintarUltimo(); };
    window.rmEscribir = function (id, valor) { const n = Number(valor); rm.cantidades.set(id, Number.isFinite(n) && n > 0 ? n : 0); const t = document.querySelector(`#rmGrid .rm-tarjeta[data-id="${id}"]`); if (t) t.classList.toggle("con-entrada", (rm.cantidades.get(id) || 0) > 0); pintarResumen(); };
    window.rmQuitar = function (id) { rm.cantidades.set(id, 0); actualizarTarjeta(id); pintarResumen(); pintarFiltros(); };
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
    };

    window.rmSalirFactura = async function () {
        if (!rm.factura) return;
        if (lineas().length && !(await confirmarPOS("Lo que anotaste de esta factura se descarta. ¿Salir?", "Salir", "alerta"))) return;
        Object.assign(rm, rm.respaldo, { factura: null, respaldo: null, cantidades: new Map(), consulta: "" });
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

        const enviar = extra => llamar(`/recepcion-inteligente/facturas/${f.id}/confirmar`, { method: "POST", body: JSON.stringify({ cantidadesRecibidas, caducidades: {}, ignorarConciliacion: false, ...extra }) });
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
        if (typeof cargarProductos === "function") await cargarProductos();
        await window.mostrarRecibirMarca();
    }

    // ---------- confirmar ----------

    window.rmConfirmar = async function () {
        if (!rm || rm.enviando || !lineas().length) return;

        if (rm.factura) {
            if (rm.factura.porDecidir) { await alertaPOS(`Esta factura trae ${rm.factura.porDecidir} concepto(s) que Nexo no pudo emparejar. Decídelos en Recepción inteligente y luego confirma aquí.`, "Faltan conceptos por decidir", "info"); return; }
            await confirmarFactura();
            return;
        }

        const ls = lineas();
        const piezas = ls.reduce((s, l) => s + l.n, 0);
        const proveedor = document.getElementById("rmProveedor")?.value || "";
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
                items: ls.map(l => ({ productoId: l.id, cantidad: l.n, costo: 0 }))
            })
        });

        rm.enviando = false;

        if (!r.ok) { pintarResumen(); aviso(r.datos.error || "No se pudo guardar. No se sumó nada al inventario.", "error"); return; }

        aviso(r.datos.repetida ? "Esa recepción ya estaba guardada." : `Recepción guardada: ${ls.length} producto${ls.length === 1 ? "" : "s"} sumado${ls.length === 1 ? "" : "s"} al inventario.`);
        if (typeof cargarProductos === "function") await cargarProductos();
        await window.mostrarRecibirMarca();
    };
})();
