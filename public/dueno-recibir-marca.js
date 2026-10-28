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

    const COLORES_RESPALDO = ["#0369a1", "#15803d", "#a21caf", "#b91c1c", "#4d7c0f", "#0e7490", "#7c2d12", "#4338ca"];
    const esc = valor => (typeof escaparDueno === "function" ? escaparDueno(valor) : String(valor ?? ""));
    const plano = t => String(t || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

    let estado = null; // { productos, grupos, marca, cantidades: Map(id -> n), enviando, llave }

    function marcaDe(nombre) {
        const n = plano(nombre);

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
            const { marca, color } = marcaDe(p.nombre);
            if (!mapa.has(marca)) mapa.set(marca, { marca, color, productos: [] });
            mapa.get(marca).productos.push(p);
        });

        const conocidas = new Set(MARCAS.map(m => m[0]));
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

    function tarjetaHtml(p) {
        const n = estado.cantidades.get(p.id) || 0;
        const hay = Number(p.stock) || 0;
        const poco = hay <= Math.max(3, Number(p.stock_minimo) || 0);
        return `<article class="drm-tarjeta${n > 0 ? " con-entrada" : ""}" data-id="${Number(p.id)}">
            <span class="drm-foto">${p.imagenUrl ? `<img src="${esc(p.imagenUrl)}" alt="" loading="lazy">` : (typeof miniaturaVaciaDuenoHtml === "function" ? miniaturaVaciaDuenoHtml() : "")}</span>
            <b class="drm-nombre">${esc(p.nombre)}</b>
            <span class="drm-hay${poco ? " poco" : ""}">Hay ${esc(String(hay))}</span>
            <div class="drm-cantidad">
                <button type="button" aria-label="Quitar uno" onclick="ajustarRecibirDueno(${Number(p.id)}, -1)">−</button>
                <input type="text" inputmode="numeric" value="${n || ""}" placeholder="0" aria-label="Llegaron" oninput="escribirRecibirDueno(${Number(p.id)}, this.value)">
                <button type="button" aria-label="Agregar uno" onclick="ajustarRecibirDueno(${Number(p.id)}, 1)">+</button>
            </div>
            <div class="drm-atajos">${[6, 12, 24].map(a => `<button type="button" onclick="ajustarRecibirDueno(${Number(p.id)}, ${a})">+${a}</button>`).join("")}</div>
        </article>`;
    }

    // Lo que se ve en la lista: lo que coincide con el buscador (nombre o codigo, en TODAS las marcas) o, sin buscar, la marca elegida.
    function productosVisibles() {
        const q = plano(estado.consulta || "").trim();

        if (q) {
            const palabras = q.split(/\s+/).filter(Boolean);
            const soloCodigo = nc(q);
            return estado.todos.filter(p => {
                const nombre = plano(p.nombre);
                return palabras.every(w => nombre.includes(w)) || (soloCodigo.length >= 3 && nc(p.codigo).includes(soloCodigo));
            }).slice(0, 40);
        }

        const grupo = estado.grupos.find(g => g.marca === estado.marca) || estado.grupos[0];
        return grupo ? grupo.productos : [];
    }

    function marcasHtml(grupo) {
        return estado.grupos.map(g => {
            const llevo = g.productos.reduce((s, p) => s + (estado.cantidades.get(p.id) > 0 ? 1 : 0), 0);
            return `<button type="button" class="drm-marca${g === grupo ? " activa" : ""}" style="--marca:${g.color}" onclick="elegirMarcaRecibirDueno(${JSON.stringify(g.marca).replace(/"/g, "&quot;")})">
                ${g.logo ? `<span class="drm-logo"><img src="${esc(g.logo)}" alt=""></span>` : ""}<b>${esc(g.marca)}</b><small>${g.productos.length} ${pluralProducto(g.productos.length)}${llevo ? ` · ${llevo} con entrada` : ""}</small></button>`;
        }).join("");
    }

    function gridHtml() {
        const lista = productosVisibles();
        if (lista.length) return lista.map(tarjetaHtml).join("");
        return `<p class="drm-vacio">${(estado.consulta || "").trim() ? "No encontré nada con eso. Prueba con otra palabra o escanea el código." : "Esta marca no tiene productos."}</p>`;
    }

    function pintar() {
        const c = capa();
        const grupo = estado.grupos.find(g => g.marca === estado.marca) || estado.grupos[0];
        const t = totales();

        c.innerHTML = `
            <div class="drm-tope">
            <header class="drm-cabeza">
                <button type="button" class="drm-atras" onclick="cerrarRecibirMarcaDueno()">‹ Atrás</button>
                <h2>Recibir por marca</h2>
            </header>
            <div class="drm-buscar">
                <input id="drmBuscar" type="search" inputmode="search" enterkeyhint="search" autocomplete="off" placeholder="Buscar nombre o código" value="${esc(estado.consulta || "")}" oninput="buscarRecibirDueno(this.value)" onkeydown="if(event.key==='Enter'){ event.preventDefault(); codigoRecibirDueno(this.value); }">
                <button type="button" class="drm-escanear" onclick="escanearRecibirDueno()" aria-label="Escanear código de barras">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7V5a2 2 0 0 1 2-2h2"/><path d="M17 3h2a2 2 0 0 1 2 2v2"/><path d="M21 17v2a2 2 0 0 1-2 2h-2"/><path d="M7 21H5a2 2 0 0 1-2-2v-2"/><line x1="7" y1="12" x2="17" y2="12"/></svg><span>Escanear</span>
                </button>
            </div>
            <nav class="drm-marcas" id="drmMarcas" aria-label="Marcas">${marcasHtml(grupo)}</nav>
            </div>
            <div class="drm-grid" id="drmGrid">${gridHtml()}</div>
            <footer class="drm-pie">
                <button type="button" class="drm-resumen-abrir" onclick="abrirResumenRecibirDueno()" ${t.productos ? "" : "disabled"} aria-label="Ver el resumen de lo que llegó">
                    <span class="drm-flecha" aria-hidden="true">▲</span><span class="drm-totales">${textoTotales(t)}</span>
                </button>
                <button type="button" class="drm-confirmar" id="drmConfirmar" onclick="confirmarRecibirMarcaDueno()" ${t.productos && !estado.enviando ? "" : "disabled"}>${estado.enviando ? "Guardando…" : "Confirmar recepción"}</button>
            </footer>
            ${estado.resumen ? resumenHtml() : ""}`;
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
                <span class="drm-res-foto">${p.imagenUrl ? `<img src="${esc(p.imagenUrl)}" alt="" loading="lazy">` : ""}</span>
                <span class="drm-res-texto"><b>${esc(p.nombre)}</b><small>Hay ${esc(String(hay))} → quedan ${esc(String(Math.round((hay + n) * 1000) / 1000))}</small></span>
                <span class="drm-res-cant">
                    <button type="button" aria-label="Quitar uno" onclick="ajustarResumenRecibirDueno(${Number(p.id)}, -1)">−</button>
                    <input type="text" inputmode="numeric" value="${n}" aria-label="Llegaron" onchange="escribirResumenRecibirDueno(${Number(p.id)}, this.value)">
                    <button type="button" aria-label="Agregar uno" onclick="ajustarResumenRecibirDueno(${Number(p.id)}, 1)">+</button>
                </span>
            </li>`;
        };

        return `<section class="drm-resumen" id="drmResumen" aria-label="Resumen de la recepción">
            <header class="drm-res-cabeza">
                <button type="button" class="drm-res-bajar" onclick="cerrarResumenRecibirDueno()"><span aria-hidden="true">▼</span> Seguir recibiendo</button>
                <h2>Resumen</h2>
            </header>
            <div class="drm-res-cuerpo">${porGrupo.map(x => `
                <h3 class="drm-res-marca" style="--marca:${x.g.color}">${esc(x.g.marca)} <small>${x.filas.length} ${pluralProducto(x.filas.length)} · ${x.filas.reduce((s, p) => s + (estado.cantidades.get(p.id) || 0), 0)} ${pluralPieza(x.filas.reduce((s, p) => s + (estado.cantidades.get(p.id) || 0), 0))}</small></h3>
                <ul class="drm-res-lista">${x.filas.map(fila).join("")}</ul>`).join("") || `<p class="drm-vacio">Todavía no has anotado nada.</p>`}</div>
            <footer class="drm-pie drm-res-pie">
                <div class="drm-totales">${textoTotales(t)}</div>
                <button type="button" class="drm-confirmar" onclick="confirmarRecibirMarcaDueno()" ${t.productos && !estado.enviando ? "" : "disabled"}>${estado.enviando ? "Guardando…" : "Confirmar recepción"}</button>
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
        window.ajustarRecibirDueno(id, delta);
        if (!totales().productos) { window.cerrarResumenRecibirDueno(); return; }
        repintarResumen();
    };

    window.escribirResumenRecibirDueno = function (id, texto) {
        window.escribirRecibirDueno(id, texto);
        if (!totales().productos) { window.cerrarResumenRecibirDueno(); return; }
        repintarResumen();
    };

    // ---- Buscador y escaner ----
    window.buscarRecibirDueno = function (texto) {
        estado.consulta = texto;
        const grid = document.getElementById("drmGrid");
        if (grid) grid.innerHTML = gridHtml();
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
            const campo = tarjeta.querySelector("input");
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
        const nuevo = Math.max(0, Math.round(((estado.cantidades.get(id) || 0) + delta) * 1000) / 1000);
        estado.cantidades.set(id, nuevo);
        actualizarTarjeta(id);
    };

    window.escribirRecibirDueno = function (id, texto) {
        const n = Number(String(texto).replace(/[^0-9.]/g, ""));
        estado.cantidades.set(id, Number.isFinite(n) && n > 0 ? n : 0);
        actualizarTarjeta(id);
    };

    window.elegirMarcaRecibirDueno = function (marca) {
        estado.marca = marca;
        estado.consulta = "";
        pintar();
        // Arriba de la lista de esa marca, y la marca elegida a la vista en la fila de marcas.
        const c = document.getElementById("drmCapa");
        if (c) c.scrollTop = 0;
        document.querySelector("#drmCapa .drm-marca.activa")?.scrollIntoView({ inline: "center", block: "nearest" });
    };

    window.cerrarRecibirMarcaDueno = function () {
        if (estado && totales().productos && !window.confirm("Tienes cantidades sin guardar. ¿Salir sin confirmar?")) return;
        document.getElementById("drmCapa")?.classList.remove("abierta");
        document.body.classList.remove("drm-abierta", "drm-con-resumen");
        estado = null;
    };

    const COLORES_EXHIBIDOR = { azul: "#1d4ed8", naranja: "#ea580c", verde: "#15803d", rojo: "#dc2626", morado: "#7e22ce", negro: "#1f2937" };

    // Los exhibidores del negocio mandan (con su logo y su color); lo que no esta en ninguno se agrupa solo por marca.
    async function gruposConExhibidores(productos) {
        try {
            const lista = (await fetchAutenticado("/exhibidores"))?.exhibidores || [];
            const usables = lista.filter(x => x.activo !== false && x.totalEspacios > 0);

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

            const resto = productos.filter(p => !usados.has(Number(p.id)));
            const extra = resto.length ? agrupar(resto) : [];
            return grupos.concat(extra).length ? grupos.concat(extra) : agrupar(productos);
        } catch (error) {
            return agrupar(productos);
        }
    }

    window.abrirRecibirMarcaDueno = async function (marcaInicial) {
        let catalogo = [];
        try { catalogo = typeof listarCatalogoLocalCompletoDueno === "function" ? await listarCatalogoLocalCompletoDueno() : []; } catch (error) { catalogo = []; }

        const productos = catalogo.filter(p => Number(p.id) > 0);

        if (!productos.length) { if (typeof mostrarToastDueno === "function") mostrarToastDueno("Todavía no hay productos en tu catálogo."); return; }

        const grupos = await gruposConExhibidores(productos);
        const todos = grupos.flatMap(g => g.productos).concat(productos).filter((p, i, a) => a.findIndex(q => Number(q.id) === Number(p.id)) === i);
        estado = { grupos, todos, indice: new Map(todos.map(p => [Number(p.id), p])), consulta: "", resumen: false, marca: (grupos.find(g => g.marca === marcaInicial) || grupos[0]).marca, cantidades: new Map(), enviando: false, llave: (typeof crypto !== "undefined" && crypto.randomUUID) ? crypto.randomUUID() : `rm-${Date.now()}-${Math.random().toString(16).slice(2)}` };
        pintar();
        capa().classList.add("abierta");
        document.body.classList.add("drm-abierta");
    };

    window.confirmarRecibirMarcaDueno = async function () {
        if (!estado || estado.enviando) return;

        const items = [];
        estado.cantidades.forEach((n, id) => { if (n > 0) items.push({ productoId: id, cantidad: n, costo: 0 }); });
        if (!items.length) return;

        const marcasConEntrada = estado.grupos.filter(g => g.productos.some(p => estado.cantidades.get(p.id) > 0)).map(g => g.marca);

        estado.enviando = true;
        pintar();

        try {
            const respuesta = await fetchAutenticado("/recepciones-mercancia/rapida", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ proveedor: marcasConEntrada.length === 1 ? marcasConEntrada[0] : "Varios", referencia: "Recibir por marca", usuarioNombre: (typeof duenoEmpleadoNombrePersona !== "undefined" && duenoEmpleadoNombrePersona) || "", idempotencyKey: estado.llave, items })
            });

            const cuantos = items.length;
            estado = null;
            document.getElementById("drmCapa")?.classList.remove("abierta");
            document.body.classList.remove("drm-abierta", "drm-con-resumen");
            if (typeof mostrarToastDueno === "function") mostrarToastDueno(respuesta.repetida ? "Esa recepción ya estaba guardada." : `Recepción guardada: ${cuantos} producto${cuantos === 1 ? "" : "s"} sumado${cuantos === 1 ? "" : "s"} al inventario.`);
            if (typeof refrescarCatalogoLocalDueno === "function") await refrescarCatalogoLocalDueno();
            if (typeof filtrarInventarioDueno === "function") filtrarInventarioDueno();
        } catch (error) {
            // La misma llave se conserva: si la peticion SI llego pero la respuesta se perdio, reintentar no suma dos veces.
            estado.enviando = false;
            pintar();
            if (typeof mostrarToastDueno === "function") mostrarToastDueno(error.message || "No se pudo guardar. Revisa tu internet y vuelve a intentar.");
        }
    };

    window.agruparMarcasRecibirDueno = agrupar;
    window.marcaDeRecibirDueno = marcaDe;

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
    }

    ponerBoton();
})();
