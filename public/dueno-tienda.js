/* Mi tienda (celular, abarrotes): tu día, lo que hay que revisar y el pedido sugerido por proveedor.
   Aparece en "Más" solo si el negocio tiene abarrotes (giro o giro extra). Usa los mismos datos que la
   computadora: /abarrotes/inicio, /lotes/por-revisar, /productos/:id/merma|entrada, /pedido-sugerido. */

let tiendaVista = "dia";
let tiendaPedido = null;

function tiEscapar(valor) {
    return String(valor ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function tiDinero(valor) {
    return "$" + Number(valor || 0).toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// fetchAutenticado devuelve los datos y lanza error con status/datos si el servidor rechaza.
async function tiLlamar(ruta, opciones = {}) {
    try {
        const datos = await fetchAutenticado(ruta, { ...opciones, headers: { "Content-Type": "application/json", ...(opciones.headers || {}) } });
        return { ok: true, datos: datos || {} };
    } catch (error) {
        return { ok: false, datos: error.datos || { error: error.message } };
    }
}

// ---------------------------------------------------------------------
// Entrada en "Más"
// ---------------------------------------------------------------------

async function tiendaInsertarEntrada() {
    if (document.getElementById("tiendaEntrada")) return;

    const { ok, datos } = await tiLlamar("/negocio-actual");
    const negocio = datos.negocio || {};
    const conAbarrotes = ok && (negocio.giro === "abarrotes" || (negocio.girosActivos || []).includes("abarrotes"));
    const destino = document.getElementById("duenoMasStatusCard");

    if (!conAbarrotes || !destino || document.getElementById("tiendaEntrada")) return;

    const boton = document.createElement("button");
    boton.type = "button";
    boton.id = "tiendaEntrada";
    boton.className = "tienda-entrada";
    boton.innerHTML = `<span aria-hidden="true">🛒</span><b>Mi tienda</b><small>Tu día, lo que revisar y el pedido a proveedores</small>`;
    boton.addEventListener("click", () => abrirTienda("dia"));
    destino.insertAdjacentElement("afterend", boton);
}

const cargarPanelMasOriginalTienda = window.cargarPanelMasDueno;

if (typeof cargarPanelMasOriginalTienda === "function") {
    window.cargarPanelMasDueno = async function (...argumentos) {
        const resultado = await cargarPanelMasOriginalTienda.apply(this, argumentos);
        tiendaInsertarEntrada();
        return resultado;
    };
}

// ---------------------------------------------------------------------
// Ayudas: avisos y cuadros propios (nada de alert/prompt del navegador: en la app instalada se traban), tipos de producto y fotos
// ---------------------------------------------------------------------

function tiAviso(mensaje, tipo) {
    if (window.NexoMovil && window.NexoMovil.aviso) window.NexoMovil.aviso(mensaje, tipo);
    else window.alert(mensaje);
}

async function tiPedirNumero(titulo, texto, valor) {
    if (window.NexoMovil && window.NexoMovil.dialogo) {
        const r = await window.NexoMovil.dialogo({ titulo, texto, campo: { tipo: "number", valor, ayuda: "Cantidad" }, aceptar: "Guardar" });
        return r.ok ? r.valor : null;
    }

    return window.prompt(`${titulo}\n${texto}`, valor);
}

// Tipo de producto para los filtros (botanas, refrescos, frutas y verduras...), a partir del nombre.
const TIENDA_TIPOS = [
    ["Frutas y verduras", /aguacate|jitomate|tomate|cebolla|lim[oó]n|pl[aá]tano|manzana|naranja|zanahoria|chile|lechuga|fruta|verdura|calabaza|pepino|uva|mango|sand[ií]a|mel[oó]n|fresa|pi[ñn]a|cilantro|nopal|papa\b/i],
    ["Botanas", /sabritas|doritos|cheetos|ruffles|takis|barcel|churrumais|fritos|cacahuate|papas fritas|chicharr|tostitos|rancheritos|runners/i],
    ["Refrescos y bebidas", /coca|pepsi|fanta|sprite|refresco|jarritos|sidral|manzanita|gatorade|powerade|jugo|jumex|del valle|t[eé] helado|agua|ciel|bonafont|epura|energ[eé]tic|monster|volt|cerveza/i],
    ["Lácteos y huevo", /leche|yoghurt|yogurt|queso|crema|mantequilla|lala|huevo|nestl[eé]|danone|alpura/i],
    ["Pan y galletas", /\bpan\b|bimbo|concha|marinela|gansito|gamesa|galleta|marias|donas|tortilla|mantecada|pastel/i],
    ["Carnes y frías", /jam[oó]n|salchicha|chorizo|pollo|carne|tocino|mortadela|at[uú]n|sardina/i],
    ["Dulces", /dulce|chocolate|chicle|paleta|gomita|ricolino|mazap[aá]n|caramelo|bubulubu|panditas/i],
    ["Limpieza", /jab[oó]n|detergente|cloro|suavizante|fabuloso|limpiador|papel hig|servilleta|escoba|trapeador|shampoo|pasta dental/i],
    ["Abarrotes secos", /arroz|frijol|az[uú]car|aceite|\bsal\b|harina|pasta|sopa|lenteja|avena|cereal|caf[eé]|salsa|mayonesa|catsup|consom|enlatado|elote/i]
];

function tiTipo(nombre, categoria) {
    if (String(categoria || "").toLowerCase().includes("fruta")) return "Frutas y verduras";
    const hallado = TIENDA_TIPOS.find(([, patron]) => patron.test(String(nombre || "")));
    return hallado ? hallado[0] : "Otros";
}

// "DISTRIBUIDORA DE BOTANAS DEL BAJIO SA DE CV" -> "Distribuidora de Botanas del Bajio, S.A. de C.V."
function tiNombreProveedor(texto) {
    const minusculas = new Set(["de", "del", "la", "las", "los", "y", "el", "en", "para"]);
    const limpio = String(texto || "").replace(/\s+S\.?A\.?\s+DE\s+C\.?V\.?\s*$/i, "").trim();
    const bonito = limpio.toLowerCase().split(/\s+/).map((p, i) => (i > 0 && minusculas.has(p)) ? p : p.charAt(0).toUpperCase() + p.slice(1)).join(" ");
    return bonito + (limpio !== String(texto || "").trim() ? ", S.A. de C.V." : "");
}

// Fotos del catalogo guardado en el celular (se leen una sola vez y se asignan como propiedad, sin pasar por el HTML).
let tiCatalogoPromesa = null;

function tiCatalogo() {
    if (!tiCatalogoPromesa) {
        tiCatalogoPromesa = (async () => {
            const mapa = new Map();
            try {
                const lista = typeof listarCatalogoLocalCompletoDueno === "function" ? await listarCatalogoLocalCompletoDueno() : [];
                lista.forEach(p => { mapa.set(Number(p.id), p); mapa.set(String(p.nombre || "").trim().toLowerCase(), p); });
            } catch (error) { /* sin catalogo local: se ven las letras */ }
            // Un catalogo vacio no se recuerda: puede ser que todavia se este sincronizando al abrir la app.
            if (!mapa.size) tiCatalogoPromesa = null;
            return mapa;
        })();
    }

    return tiCatalogoPromesa;
}

function tiMiniatura(id, nombre) {
    return `<span class="ti-mini" data-pid="${Number(id) || 0}" data-nombre="${tiEscapar(String(nombre || "").trim().toLowerCase())}">${tiEscapar(String(nombre || "?").charAt(0).toUpperCase())}</span>`;
}

async function tiPonerFotos(raiz) {
    const catalogo = await tiCatalogo();

    raiz.querySelectorAll(".ti-mini[data-nombre]").forEach(span => {
        const p = catalogo.get(Number(span.dataset.pid)) || catalogo.get(span.dataset.nombre);
        span.removeAttribute("data-nombre");
        if (!p || !p.imagenUrl) return;
        const img = new Image();
        img.decoding = "async";
        img.alt = "";
        img.src = p.imagenUrl;
        span.textContent = "";
        span.appendChild(img);
    });
}

// ---------------------------------------------------------------------
// Pantalla
// ---------------------------------------------------------------------

function tiendaCapa() {
    let capa = document.getElementById("tiendaCapa");

    if (!capa) {
        capa = document.createElement("div");
        capa.id = "tiendaCapa";
        capa.className = "tienda-capa";
        document.body.appendChild(capa);
    }

    capa.classList.add("abierta");
    document.body.classList.add("tienda-abierta");
    return capa;
}

function cerrarTienda() {
    document.getElementById("tiendaCapa")?.classList.remove("abierta");
    document.body.classList.remove("tienda-abierta");
}

async function abrirTienda(vista = "dia") {
    tiendaVista = vista;
    tiendaPedido = null;

    const capa = tiendaCapa();
    const pestana = (clave, texto) => `<button type="button" data-vista="${clave}" class="${vista === clave ? "activo" : ""}" onclick="abrirTienda('${clave}')">${texto}</button>`;

    capa.innerHTML = `
    <header class="tienda-cabecera">
        <button type="button" class="tienda-icono" onclick="cerrarTienda()" aria-label="Cerrar"><svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg></button>
        <h2>Mi tienda</h2>
        <button type="button" class="tienda-icono" onclick="abrirTienda(tiendaVista)" aria-label="Actualizar"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-3-6.7"/><path d="M21 4v5h-5"/></svg></button>
    </header>
    <nav class="tienda-seg" aria-label="Secciones">${pestana("dia", "Mi día")}${pestana("revisar", "Por revisar")}${pestana("pedido", "Pedido")}</nav>
    <main id="tiendaCuerpo" class="tienda-cuerpo"><p class="tienda-vacio">Cargando…</p></main>`;

    const cuerpo = document.getElementById("tiendaCuerpo");

    if (vista === "dia") await tiendaPintarDia(cuerpo);
    else if (vista === "revisar") await tiendaPintarRevisar(cuerpo);
    else await tiendaPintarPedidos(cuerpo);

    capa.scrollTop = 0;
    tiPonerFotos(cuerpo);
}

// ---------------------------------------------------------------------
// Mi día
// ---------------------------------------------------------------------

function tiFilaRanking(p, maximo, negativo) {
    const ancho = Math.max(4, Math.round((Math.abs(p.ganancia) / maximo) * 100));
    const margen = p.margen === null || p.margen === undefined ? "" : ` · margen ${Math.round(p.margen)}%`;
    const unidades = p.unidades ? `${Number(p.unidades.toFixed ? p.unidades.toFixed(1) : p.unidades)} vendidos` : "";
    return `<li>${tiMiniatura(p.id ?? p.productoId, p.nombre)}
        <div class="ti-fila-texto"><b>${tiEscapar(p.nombre)}</b><small>${unidades}${margen}</small><i class="ti-barra ${negativo ? "mala" : ""}" style="width:${ancho}%"></i></div>
        <strong class="${negativo ? "rojo" : "verde"}">${negativo && p.ganancia < 0 ? "-" : ""}${tiDinero(Math.abs(p.ganancia))}</strong></li>`;
}

async function tiendaPintarDia(cuerpo) {
    const { ok, datos: d } = await tiLlamar("/abarrotes/inicio");

    if (!ok) {
        cuerpo.innerHTML = `<p class="tienda-vacio">${tiEscapar(d.error || "No se pudo cargar tu día.")}</p>`;
        return;
    }

    const maximo = Math.max(1, ...d.semana.map(x => x.total));
    const dias = ["dom", "lun", "mar", "mié", "jue", "vie", "sáb"];
    const hayAyer = Boolean(d.hoy.ayerTotal);
    const delta = hayAyer ? Math.round(((d.hoy.total - d.hoy.ayerTotal) / d.hoy.ayerTotal) * 100) : null;
    const chip = delta === null ? "" : `<span class="ti-delta ${delta >= 0 ? "sube" : "baja"}">${delta >= 0 ? "▲" : "▼"} ${Math.abs(delta)}% vs ayer</span>`;
    const maxGana = Math.max(1, ...d.masGanancia.map(p => Math.abs(p.ganancia)));
    const maxPierde = Math.max(1, ...d.pierden.map(p => Math.abs(p.ganancia)));

    cuerpo.innerHTML = `
    <section class="ti-hero">
        <span class="ti-etiqueta">Vendiste hoy</span>
        <div class="ti-hero-numero"><strong>${tiDinero(d.hoy.total)}</strong>${chip}</div>
        <div class="ti-hero-fila">
            <div><small>Ganaste hoy</small><b class="verde">${tiDinero(d.hoy.ganancia)}</b></div>
            <div><small>Ventas</small><b>${d.hoy.ventas}</b></div>
            <div><small>Fiado por cobrar</small><b class="ambar">${tiDinero(d.fiado.total)}</b></div>
        </div>
    </section>
    ${d.productosSinCosto > 0 ? `<p class="tienda-aviso">A ${d.productosSinCosto} producto(s) que vendiste les falta el costo: sin él no se calcula cuánto ganas con ellos.</p>` : ""}

    <section class="tienda-tarjeta"><h3>Últimos 7 días</h3>
        <div class="tienda-barras">${d.semana.map((s, i) => `<div class="${i === d.semana.length - 1 ? "hoy" : ""}"><em>${s.total ? "$" + Math.round(s.total).toLocaleString("es-MX") : ""}</em><i style="height:${Math.max(4, Math.round((s.total / maximo) * 100))}%"></i><span>${dias[new Date(`${s.dia}T12:00:00`).getDay()]}</span></div>`).join("")}</div>
    </section>

    <section class="tienda-tarjeta"><div class="ti-titulo"><h3>Lo que más te deja</h3><small>últimos 30 días</small></div>
        ${d.masGanancia.length ? `<ol class="ti-ranking">${d.masGanancia.map(p => tiFilaRanking(p, maxGana, false)).join("")}</ol>` : `<p class="tienda-vacio">Cuando vendas con costo capturado, aquí verás lo que más te deja.</p>`}
    </section>

    <section class="tienda-tarjeta"><div class="ti-titulo"><h3>Dejan poco o pierdes</h3><small>revisa su precio</small></div>
        ${d.pierden.length ? `<ol class="ti-ranking">${d.pierden.map(p => tiFilaRanking(p, maxPierde, true)).join("")}</ol>` : `<p class="tienda-vacio">Ningún producto te está dejando poco. ¡Bien!</p>`}
    </section>

    <section class="tienda-tarjeta"><h3>Recargas y servicios hoy</h3>
        ${d.servicios.operaciones ? `<p><b>${tiDinero(d.servicios.importe)}</b> en ${d.servicios.operaciones} operación(es) · te quedaron <b class="verde">${tiDinero(d.servicios.comision)}</b></p>` : `<p class="tienda-vacio">Hoy no has registrado recargas ni pagos de servicios.</p>`}
    </section>
    <p class="tienda-nota">${d.inventario.productos} productos · ${d.inventario.bajos} por agotarse · ${d.inventario.sinStock} sin existencia</p>`;
}

// ---------------------------------------------------------------------
// Por revisar (caducidad): tirar y registrar mercancia que llego
// ---------------------------------------------------------------------

let tiendaLotes = [];
let tiendaFiltro = { estado: "todos", tipo: "todos" };

function tiTextoDias(l) {
    if (l.estado === "vencido") return `Venció hace ${Math.abs(l.dias)} día${Math.abs(l.dias) === 1 ? "" : "s"}`;
    if (l.estado === "hoy") return "Vence hoy";
    if (l.estado === "manana") return "Vence mañana";
    return `Vence en ${l.dias} días`;
}

async function tiendaPintarRevisar(cuerpo) {
    const { ok, datos } = await tiLlamar("/lotes/por-revisar?dias=7");

    if (!ok) {
        cuerpo.innerHTML = `<p class="tienda-vacio">${tiEscapar(datos.error || "No se pudo cargar.")}</p>`;
        return;
    }

    const catalogo = await tiCatalogo();
    tiendaLotes = datos.lotes.map(l => ({ ...l, tipo: tiTipo(l.nombre, catalogo.get(Number(l.productoId))?.categoria) }));
    tiendaFiltro = { estado: "todos", tipo: "todos" };
    tiendaResumenRevisar = datos.resumen;
    tiendaRevisarPintar(cuerpo);
}

let tiendaResumenRevisar = null;

function tiendaRevisarPintar(cuerpo = document.getElementById("tiendaCuerpo")) {
    if (!tiendaLotes.length) {
        cuerpo.innerHTML = `<section class="ti-vacio-grande"><span>✅</span><b>Todo en orden</b><small>Nada vence en los próximos 7 días.</small></section>`;
        return;
    }

    const cuenta = f => tiendaLotes.filter(f).length;
    const estados = [["todos", "Todos", tiendaLotes.length], ["vencido", "Vencidos", cuenta(l => l.estado === "vencido")], ["pronto", "Hoy y mañana", cuenta(l => l.estado === "hoy" || l.estado === "manana")], ["semana", "Esta semana", cuenta(l => l.estado !== "vencido" && l.estado !== "hoy" && l.estado !== "manana")]];
    const tipos = [...new Set(tiendaLotes.map(l => l.tipo))].sort((a, b) => a.localeCompare(b, "es"));
    const chip = (grupo, valor, texto, n) => `<button type="button" class="ti-chip${tiendaFiltro[grupo] === valor ? " activo" : ""}" onclick="tiendaFiltrar('${grupo}', '${tiEscapar(valor)}')">${tiEscapar(texto)}${n !== undefined ? ` <small>${n}</small>` : ""}</button>`;

    cuerpo.innerHTML = `
    <section class="ti-hero ti-hero-revisar">
        <span class="ti-etiqueta">Por revisar · próximos 7 días</span>
        <div class="ti-hero-numero"><strong>${tiendaLotes.length}</strong><span class="ti-delta baja">Tirarlo costaría ${tiDinero(tiendaResumenRevisar?.valorCosto)}</span></div>
    </section>
    <div class="ti-chips">${estados.map(([v, t, n]) => chip("estado", v, t, n)).join("")}</div>
    ${tipos.length > 1 ? `<div class="ti-chips">${chip("tipo", "todos", "Todos los tipos")}${tipos.map(t => chip("tipo", t, t, tiendaLotes.filter(l => l.tipo === t).length)).join("")}</div>` : ""}
    <ul class="ti-lotes" id="tiLotes"></ul>`;

    tiendaRevisarLista();
}

function tiendaRevisarLista() {
    const caja = document.getElementById("tiLotes");
    if (!caja) return;

    const pasa = l => {
        const e = tiendaFiltro.estado;
        const porEstado = e === "todos" || (e === "vencido" && l.estado === "vencido") || (e === "pronto" && (l.estado === "hoy" || l.estado === "manana")) || (e === "semana" && !["vencido", "hoy", "manana"].includes(l.estado));
        return porEstado && (tiendaFiltro.tipo === "todos" || l.tipo === tiendaFiltro.tipo);
    };

    const lista = tiendaLotes.filter(pasa);

    caja.innerHTML = lista.length ? lista.map(l => `
        <li class="${l.estado === "vencido" ? "mal" : l.estado === "hoy" || l.estado === "manana" ? "pronto" : ""}">
            ${tiMiniatura(l.productoId, l.nombre)}
            <div class="ti-lote-texto"><b>${tiEscapar(l.nombre)}</b><span class="ti-estado">${tiTextoDias(l)}</span><small>${l.cantidad} ${tiEscapar(l.unidad)} · ${tiEscapar(l.tipo)}</small></div>
            <div class="ti-lote-acciones">
                <button type="button" class="tirar" onclick="tiendaTirar(${l.productoId}, ${l.cantidad}, ${JSON.stringify(l.nombre).replace(/"/g, "&quot;")})">Tirar</button>
                <button type="button" onclick="tiendaLlego(${l.productoId}, ${JSON.stringify(l.nombre).replace(/"/g, "&quot;")})">Llegó más</button>
            </div>
        </li>`).join("") : `<li class="ti-sin-resultados">No hay productos con ese filtro.</li>`;

    tiPonerFotos(caja);
}

function tiendaFiltrar(grupo, valor) {
    tiendaFiltro[grupo] = valor;
    // Los chips se repintan para marcar el activo; la lista no vuelve a pedirse al servidor.
    tiendaRevisarPintar();
}

async function tiendaMover(ruta, titulo, texto, valorInicial, mensajeOk) {
    const texto2 = await tiPedirNumero(titulo, texto, valorInicial);
    if (texto2 === null) return;

    const cantidad = Number(String(texto2).replace(",", "."));
    if (!(cantidad > 0)) { tiAviso("Escribe una cantidad mayor a cero.", "error"); return; }

    const { ok, datos } = await tiLlamar(ruta, { method: "POST", body: JSON.stringify({ cantidad, motivo: "caducado" }) });
    if (!ok) { tiAviso(datos.error || "No se pudo guardar.", "error"); return; }

    tiAviso(mensajeOk(datos));
    abrirTienda("revisar");
}

function tiendaTirar(id, cantidad, nombre) {
    tiendaMover(`/productos/${id}/merma`, "¿Cuánto vas a tirar?", nombre, String(cantidad), d => `Anotado. Perdiste ${tiDinero(d.perdidoCosto)} a costo.`);
}

function tiendaLlego(id, nombre) {
    tiendaMover(`/productos/${id}/entrada`, "¿Cuánto llegó?", nombre, "", d => `Listo, ahora tienes ${d.stock}.${d.fechaCaducidad ? ` Caduca el ${d.fechaCaducidad}.` : ""}`);
}

// ---------------------------------------------------------------------
// Pedido sugerido
// ---------------------------------------------------------------------

const TIENDA_DIAS = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];

function tiendaCuando(p) {
    if (p.diasHastaVisita === null) return "Sin día de visita";
    if (p.diasHastaVisita === 0) return "Viene hoy";
    if (p.diasHastaVisita === 1) return "Viene mañana";
    return `Viene el ${TIENDA_DIAS[p.diaVisita].toLowerCase()} · en ${p.diasHastaVisita} días`;
}

async function tiendaPintarPedidos(cuerpo) {
    const { ok, datos } = await tiLlamar("/pedido-sugerido");

    if (!ok) {
        cuerpo.innerHTML = `<p class="tienda-vacio">${tiEscapar(datos.error || "No se pudo cargar.")}</p>`;
        return;
    }

    if (!datos.proveedores.length) {
        cuerpo.innerHTML = `<section class="ti-vacio-grande"><span>🚚</span><b>Aún no tienes proveedores</b><small>Agrégalos en la computadora y aquí te diré cuánto pedir y cuánto apartar.</small></section>`;
        return;
    }

    const aApartar = datos.proveedores.reduce((s, p) => s + (p.productosSugeridos ? Number(p.total) : 0), 0);
    const conPedido = datos.proveedores.filter(p => p.productosSugeridos).length;

    cuerpo.innerHTML = `
    <section class="ti-hero">
        <span class="ti-etiqueta">Pedido de la semana</span>
        <div class="ti-hero-numero"><strong>${tiDinero(aApartar)}</strong></div>
        <p class="ti-hero-nota">${conPedido ? `Es lo que conviene apartar para ${conPedido} proveedor${conPedido === 1 ? "" : "es"}, según lo que vendes y lo que te queda.` : "Por ahora no hace falta pedir nada."}</p>
    </section>
    ${datos.proveedores.map(p => {
        const urgente = p.diasHastaVisita !== null && p.diasHastaVisita <= 1;
        const pronto = p.diasHastaVisita !== null && p.diasHastaVisita <= 2;
        return `<article class="ti-proveedor${pronto ? " urgente" : ""}">
            <div class="ti-prov-cab"><span class="ti-prov-icono">🚚</span><div><b>${tiEscapar(tiNombreProveedor(p.proveedor))}</b><span class="ti-cuando ${urgente ? "ya" : pronto ? "pronto" : ""}">${tiEscapar(tiendaCuando(p))}</span></div></div>
            ${p.productosSugeridos
                ? `<div class="ti-prov-monto"><small>Aparta</small><strong>${tiDinero(p.total)}</strong><span>${p.productosSugeridos} producto${p.productosSugeridos === 1 ? "" : "s"} por pedir</span></div>`
                : `<p class="ti-prov-vacio">${p.diaVisita === null ? "Dime qué día viene para calcular tu pedido." : "No hace falta pedir nada por ahora."}</p>`}
            <div class="ti-prov-acciones">
                <label class="ti-dia"><span>Día que viene</span><select onchange="tiendaGuardarDia(${p.proveedorId}, this.value)" aria-label="Día que viene">
                    <option value="">Sin día</option>${TIENDA_DIAS.map((n, i) => `<option value="${i}" ${p.diaVisita === i ? "selected" : ""}>${n}</option>`).join("")}</select></label>
                <button type="button" class="ti-boton-principal" ${p.productosSugeridos ? "" : "disabled"} onclick="tiendaAbrirPedido(${p.proveedorId})">Ver pedido</button>
            </div></article>`;
    }).join("")}`;
}

async function tiendaGuardarDia(id, dia) {
    await tiLlamar(`/pedido-sugerido/${id}/visita`, { method: "PATCH", body: JSON.stringify({ diaVisita: dia === "" ? null : Number(dia) }) });
    abrirTienda("pedido");
}

async function tiendaAbrirPedido(id) {
    const { ok, datos } = await tiLlamar(`/pedido-sugerido/${id}`);
    if (!ok) { tiAviso(datos.error || "No se pudo calcular.", "error"); return; }

    tiendaPedido = { ...datos, cantidades: Object.fromEntries(datos.items.map(i => [i.productoId, i.cantidad])) };
    tiendaPintarPedido();
    document.getElementById("tiendaCapa").scrollTop = 0;
}

function tiendaPintarPedido() {
    const p = tiendaPedido;
    const cuerpo = document.getElementById("tiendaCuerpo");

    cuerpo.innerHTML = `
    <button type="button" class="tienda-volver" onclick="abrirTienda('pedido')">‹ Todos los proveedores</button>
    <section class="ti-hero">
        <span class="ti-etiqueta">${tiEscapar(tiNombreProveedor(p.proveedor))}</span>
        <div class="ti-hero-numero"><strong id="tiendaTotal">${tiDinero(tiendaTotal())}</strong></div>
        <p class="ti-hero-nota">${tiEscapar(tiendaCuando(p))} · según tus ventas de los últimos ${p.diasDeVentas} días</p>
    </section>
    <ul class="ti-pedido">${p.items.map(i => `
        <li>${tiMiniatura(i.productoId, i.nombre)}
            <div class="ti-fila-texto"><b>${tiEscapar(i.nombre)}</b><small>Tienes ${Number(i.existencia.toFixed(3))}${i.porDia ? ` · vendes ${i.porDia}/día` : ""}</small></div>
            <div class="ti-paso"><button type="button" onclick="tiendaPaso(${i.productoId}, -1)" aria-label="Quitar uno">−</button><input type="number" min="0" step="1" inputmode="numeric" id="tiCant${i.productoId}" value="${p.cantidades[i.productoId]}" oninput="tiendaCantidad(${i.productoId}, this.value)"><button type="button" onclick="tiendaPaso(${i.productoId}, 1)" aria-label="Agregar uno">+</button></div></li>`).join("")}</ul>
    <div class="ti-barra-acciones">
        <button type="button" class="whatsapp" onclick="tiendaCompartir()">WhatsApp</button>
        <button type="button" onclick="tiendaCopiar()">Copiar</button>
        <button type="button" class="ti-boton-principal" onclick="tiendaGuardarPedido()">Guardar pedido</button>
    </div>`;

    tiPonerFotos(cuerpo);
}

function tiendaTotal() {
    return tiendaPedido.items.reduce((s, i) => s + (Number(tiendaPedido.cantidades[i.productoId]) || 0) * i.costo, 0);
}

function tiendaCantidad(id, valor) {
    tiendaPedido.cantidades[id] = Math.max(0, Math.round(Number(valor) || 0));
    document.getElementById("tiendaTotal").textContent = tiDinero(tiendaTotal());
}

function tiendaPaso(id, delta) {
    tiendaCantidad(id, (Number(tiendaPedido.cantidades[id]) || 0) + delta);
    const campo = document.getElementById("tiCant" + id);
    if (campo) campo.value = tiendaPedido.cantidades[id];
}

function tiendaLineas() {
    return tiendaPedido.items.map(i => ({ ...i, pedir: Number(tiendaPedido.cantidades[i.productoId]) || 0 })).filter(i => i.pedir > 0);
}

function tiendaTexto() {
    return [`Pedido para ${tiNombreProveedor(tiendaPedido.proveedor)}:`, ...tiendaLineas().map(i => `- ${i.pedir} x ${i.nombre}`)].join("\n");
}

// wa.me sin numero abre WhatsApp para elegir el contacto del proveedor con el texto ya escrito.
function tiendaCompartir() {
    if (!tiendaLineas().length) { tiAviso("No hay nada que pedir.", "error"); return; }
    const digitos = String(tiendaPedido.telefono || "").replace(/\D/g, "");
    const numero = digitos.length === 10 ? "52" + digitos : digitos.length >= 11 ? digitos : "";
    window.open(`https://wa.me/${numero}?text=${encodeURIComponent(tiendaTexto())}`, "_blank", "noopener");
}

async function tiendaCopiar() {
    if (!tiendaLineas().length) { tiAviso("No hay nada que pedir.", "error"); return; }

    try {
        await navigator.clipboard.writeText(tiendaTexto());
        tiAviso("Lista copiada.");
    } catch (error) {
        window.prompt("Copia la lista:", tiendaTexto());
    }
}

async function tiendaGuardarPedido() {
    const lineas = tiendaLineas();
    if (!lineas.length) { tiAviso("No hay nada que pedir.", "error"); return; }

    const { ok, datos } = await tiLlamar("/pedidos-proveedor", {
        method: "POST",
        body: JSON.stringify({
            proveedor: tiendaPedido.proveedor, estado: "borrador", notas: "Pedido sugerido por Nexo",
            items: lineas.map(i => ({ productoId: i.productoId, codigo: i.codigo, nombre: i.nombre, cantidad: i.pedir, costo: i.costo, unidad: i.unidad }))
        })
    });

    if (ok) tiAviso(`Pedido guardado como borrador: ${lineas.length} producto(s), ${tiDinero(tiendaTotal())}.`);
    else tiAviso(datos.error || "No se pudo guardar el pedido.", "error");
}

// ---------------------------------------------------------------------
// En el Inicio del celular (abarrotes): lo que mas te deja y lo que pierdes, al principio, como en la computadora
// ---------------------------------------------------------------------

async function tiendaPintarInicio() {
    const giro = window.duenoGiro || {};
    const inicio = document.getElementById("duenoApp");
    if (!inicio || !giro.conAbarrotes) return;

    const { ok, datos: d } = await tiLlamar("/abarrotes/inicio");
    let caja = document.getElementById("tiendaInicio");
    if (!ok || !d.hoy) { caja?.remove(); return; }

    if (!caja) {
        caja = document.createElement("section");
        caja.id = "tiendaInicio";
        caja.className = "tienda-inicio";
        const ancla = inicio.querySelector(".dueno-alertas") || inicio.querySelector(".dueno-kpis");
        if (!ancla) return;
        ancla.insertAdjacentElement("afterend", caja);
    }

    const lista = (titulo, items, negativo, maximo) => `<article><div class="ti-titulo"><h3>${titulo}</h3></div>
        ${items.length ? `<ol class="ti-ranking compacto">${items.slice(0, 3).map(p => tiFilaRanking(p, maximo, negativo)).join("")}</ol>` : `<p class="tienda-vacio">${negativo ? "Nada te deja poco." : "Aún sin datos."}</p>`}</article>`;

    caja.innerHTML = `${lista("Lo que más te deja", d.masGanancia, false, Math.max(1, ...d.masGanancia.map(p => Math.abs(p.ganancia))))}
        ${lista("Dejan poco o pierdes", d.pierden, true, Math.max(1, ...d.pierden.map(p => Math.abs(p.ganancia))))}
        <button type="button" class="ti-ver-todo" onclick="abrirTienda('dia')">Ver todo en Mi tienda ›</button>`;
    tiPonerFotos(caja);
}

document.addEventListener("nexo-giro-listo", () => setTimeout(tiendaPintarInicio, 400));

const cargarPanelOriginalTienda = window.cargarPanelDueno;

if (typeof cargarPanelOriginalTienda === "function") {
    window.cargarPanelDueno = function (...argumentos) {
        const resultado = cargarPanelOriginalTienda.apply(this, argumentos);
        setTimeout(tiendaPintarInicio, 600);
        return resultado;
    };
}
