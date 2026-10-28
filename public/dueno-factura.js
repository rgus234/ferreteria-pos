/* Recibir mercancia con factura en el celular: la factura que ya entro en la computadora (o por correo) se verifica escaneando lo que
   llego, se decide lo que falta (producto nuevo / ya lo tengo / omitir), se confirma con las cantidades REALES y al final se acomoda
   cada producto escaneando su estante. Usa /recepcion-inteligente/facturas (recepcion-inteligente-server.js) y /ubicaciones/*.
   La verificacion en curso se guarda en este celular para no perderla si se cierra la app. */

(function () {
    const N = () => window.NexoMovil;
    const esc = valor => (N() ? N().esc(valor) : String(valor ?? ""));
    const icono = (nombre, tam) => (N() ? N().icono(nombre, tam) : "");
    const numero = valor => Number(valor || 0).toLocaleString("es-MX", { maximumFractionDigits: 3 });
    const dinero = valor => "$" + Number(valor || 0).toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const normalizar = codigo => String(codigo || "").replace(/[^a-zA-Z0-9]/g, "").toLowerCase();

    let capa = null;
    let pila = [];
    let codigosPorProducto = null; // productoId -> [codigos normalizados], del catalogo guardado en el celular

    const actual = () => pila[pila.length - 1];

    async function llamar(ruta, opciones = {}) {
        try {
            const cuerpo = opciones.body ? { body: JSON.stringify(opciones.body), headers: { "Content-Type": "application/json" } } : {};
            return { ok: true, datos: await fetchAutenticado(ruta, { method: opciones.method || "GET", ...cuerpo }) || {} };
        } catch (error) {
            return { ok: false, estado: error.status, datos: error.datos || { error: error.message } };
        }
    }

    // ---- Verificacion guardada en el celular ----
    const llave = id => `nexoFacturaVerif_${id}`;
    const leer = id => { try { return JSON.parse(localStorage.getItem(llave(id)) || "{}"); } catch (error) { return {}; } };
    const guardar = (id, datos) => { try { localStorage.setItem(llave(id), JSON.stringify(datos)); } catch (error) { /* sin almacenamiento */ } };
    const borrar = id => { try { localStorage.removeItem(llave(id)); } catch (error) { /* sin almacenamiento */ } };

    async function cargarCodigos() {
        if (codigosPorProducto) return;

        codigosPorProducto = new Map();

        try {
            const todos = typeof listarCatalogoLocalCompletoDueno === "function" ? await listarCatalogoLocalCompletoDueno() : [];
            todos.forEach(p => codigosPorProducto.set(p.id, [normalizar(p.codigo), ...(p.codigos_relacionados || []).map(c => normalizar(c.codigo))].filter(Boolean)));
        } catch (error) { /* sin catalogo local: se compara solo por el codigo de la factura */ }
    }

    // Que renglon de la factura es este codigo escaneado.
    function renglonDeCodigo(items, codigoEscaneado) {
        const c = normalizar(codigoEscaneado);

        if (!c) return null;

        return items.find(i => {
            const posibles = [i.codigo, i.candidato?.codigo, i.candidato?.codigoBarras, i.candidato?.ean, i.candidato?.clave, i.candidato?.codigoInterno].map(normalizar);
            const delProducto = codigosPorProducto?.get(i.productoId || i.candidato?.productoId) || [];

            return posibles.includes(c) || delProducto.includes(c);
        }) || null;
    }

    // ---- Estructura ----

    function obtenerCapa() {
        if (!capa) {
            capa = document.createElement("div");
            capa.id = "dfCapa";
            capa.className = "dm-capa df-capa";
            document.body.appendChild(capa);
        }

        capa.classList.add("abierta");
        return capa;
    }

    function pantalla({ titulo, subtitulo = "", cuerpo, pie = "" }) {
        return `<div class="dm-marco"><header class="dm-cabecera"><button type="button" class="dm-atras" onclick="dfAtras()" aria-label="Atrás">${icono("atras", 22)}</button>
            <div class="dm-titulo-caja"><h2>${esc(titulo)}</h2>${subtitulo ? `<small>${esc(subtitulo)}</small>` : ""}</div><span class="dm-atras dm-vacio"></span></header>
            <main class="dm-cuerpo">${cuerpo}</main>${pie ? `<footer class="dm-pie">${pie}</footer>` : ""}</div>`;
    }

    function pintar() {
        const p = actual();
        obtenerCapa().innerHTML = ({ lista: pintarLista, verificar: pintarVerificar, acomodo: pintarAcomodo }[p.t])(p);
    }

    function ir(entrada) { pila.push(entrada); pintar(); capa.scrollTop = 0; }
    window.dfAtras = function () { pila.pop(); if (!pila.length) { capa.classList.remove("abierta"); return; } pintar(); };

    // ---- 1) Facturas pendientes ----

    window.dfAbrir = async function () {
        pila = [];
        const entrada = { t: "lista", facturas: null, error: "" };
        ir(entrada);

        const r = await llamar("/recepcion-inteligente/facturas");
        entrada.facturas = r.ok ? (r.datos.facturas || []).filter(f => f.estado === "pendiente") : [];
        entrada.error = r.ok ? "" : (r.datos.requierePermiso ? "Necesitas permiso de modificar inventario para recibir facturas." : (r.datos.error || "No se pudo cargar."));
        if (actual() === entrada) pintar();
    };

    function pintarLista(e) {
        return pantalla({
            titulo: "Recibir factura",
            subtitulo: "Facturas por verificar",
            cuerpo: e.error ? `<p class="dm-nota">${esc(e.error)}</p>` : e.facturas === null ? `<p class="dm-nota">Cargando…</p>` : e.facturas.map(f => {
                const avance = Object.keys(leer(f.id).recibido || {}).length;

                return `<button type="button" class="dm-fila dm-conteo-item" onclick="dfVerificar(${f.id})">
                    <span class="dm-icono-caja dm-tienda">${icono("etiqueta", 22)}</span>
                    <span class="dm-fila-texto"><b>${esc(f.proveedor)}</b><small>${f.folio ? "Folio " + esc(f.folio) + " · " : ""}${f.totalItems} productos · ${dinero(f.total)}</small>${avance ? `<small>Llevas ${avance} verificados</small>` : ""}</span>
                    ${f.porRevisar ? `<span class="dm-etiqueta dm-ambar">${f.porRevisar} por decidir</span>` : `<span class="dm-etiqueta dm-verde">Lista</span>`}
                </button>`;
            }).join("") || `<div class="dm-vacio-grande">${icono("ok", 40)}<b>No hay facturas por recibir</b><span>Cuando llegue una factura a tu correo conectado, o la subas en la computadora, aparece aquí para verificarla con el celular.</span></div>`
        });
    }

    // Confirma una factura desde el celular. Si ya habias recibido esa mercancia a mano (Recibir por marca / Recibir mercancia con proveedor), pregunta si
    // es la misma: en ese caso la factura solo completa los costos y NO se vuelve a sumar al inventario. Lo usan esta pantalla y "Recibir por marca".
    window.confirmarFacturaMovil = async function (id, cantidadesRecibidas, caducidades) {
        const enviar = extra => llamar(`/recepcion-inteligente/facturas/${id}/confirmar`, { method: "POST", body: { cantidadesRecibidas, caducidades: caducidades || {}, ignorarConciliacion: false, ...extra } });
        let r = await enviar({});

        if (!r.ok && r.datos.requiereConciliacion) {
            const p = r.datos.remisionPendiente || {};
            const fecha = p.fechaDocumento ? new Date(p.fechaDocumento).toLocaleDateString("es-MX", { day: "numeric", month: "short" }) : "";
            const misma = await N().dialogo({
                titulo: "¿Es la mercancía que ya recibiste?",
                texto: `Ya registraste una recepción de este proveedor${fecha ? ` el ${fecha}` : ""}${p.referencia ? ` (${p.referencia})` : ""}, con ${(p.items || []).length} producto(s). Si es la misma, la factura solo completa los costos y NO se vuelve a sumar al inventario.`,
                aceptar: "Sí, es la misma",
                cancelar: "No, es otra"
            });

            if (misma.ok) {
                r = await enviar({ conciliarConRecepcionMercanciaId: p.recepcionMercanciaId });
            } else {
                const nueva = await N().dialogo({ titulo: "¿Sumarla como nueva?", texto: "Se sumará al inventario lo que verificaste, además de lo que ya habías recibido.", aceptar: "Sí, sumar", cancelar: "Cancelar" });

                if (!nueva.ok) return { cancelado: true };
                r = await enviar({ ignorarConciliacion: true });
            }
        }

        return r;
    };

    // ---- 2) Verificar escaneando ----

    window.dfVerificar = async function (id) {
        await cargarCodigos();
        const entrada = { t: "verificar", id, datos: null, ...leer(id), recibido: leer(id).recibido || {}, caducidades: leer(id).caducidades || {}, abarrotes: false };
        ir(entrada);

        entrada.abarrotes = await N().esAbarrotes();

        const r = await llamar(`/recepcion-inteligente/facturas/${id}`);
        entrada.datos = r.ok ? r.datos : false;
        entrada.error = r.ok ? "" : (r.datos.error || "No se pudo abrir la factura.");
        if (actual() === entrada) pintar();
    };

    function estadoRenglon(i, e) {
        const recibido = e.recibido[i.id];

        if (!i.accion) return ["Por decidir", "ambar"];
        if (i.accion === "omitir") return ["Omitido", "gris"];
        if (recibido === undefined) return ["Sin verificar", "gris"];
        if (recibido === i.cantidad) return ["Completo", "verde"];

        return recibido < i.cantidad ? ["Faltan " + numero(i.cantidad - recibido), "rojo"] : ["Sobran " + numero(recibido - i.cantidad), "ambar"];
    }

    function pintarVerificar(e) {
        if (e.datos === null) return pantalla({ titulo: "Factura", cuerpo: `<p class="dm-nota">Cargando…</p>` });
        if (!e.datos) return pantalla({ titulo: "Factura", cuerpo: `<p class="dm-nota">${esc(e.error)}</p>` });

        const r = e.datos.recepcion;
        const items = e.datos.items;
        const sinDecidir = items.filter(i => !i.accion).length;
        const verificados = items.filter(i => i.accion !== "omitir" && e.recibido[i.id] !== undefined).length;
        const aVerificar = items.filter(i => i.accion !== "omitir").length;

        return pantalla({
            titulo: r.proveedor || "Factura",
            subtitulo: `${r.folio ? "Folio " + r.folio + " · " : ""}${verificados} de ${aVerificar} verificados`,
            cuerpo: `
            <button type="button" class="dm-escanear dm-chico" onclick="dfEscanear()"><span class="dm-escanear-icono">${icono("escanear", 24)}</span><span><b>Escanear mercancía</b><small>Cada lectura suma una pieza al renglón</small></span></button>
            ${sinDecidir ? `<p class="dm-nota df-aviso">Hay ${sinDecidir} producto(s) por decidir: ya lo tengo, es nuevo u omitir.</p>` : ""}
            <div class="dm-lista">${items.map(i => {
                const [texto, color] = estadoRenglon(i, e);
                const recibido = e.recibido[i.id];

                return `<div class="dm-producto df-renglon ${recibido !== undefined && recibido === i.cantidad ? "listo" : ""}">
                    <span class="dm-fila-texto"><b>${esc(i.nombreNuevoProducto || i.descripcion)}</b><small>Facturado ${numero(i.cantidad)} ${esc(i.unidad || "")} · ${dinero(i.costo)} c/u</small><span class="dm-etiqueta dm-${color}">${texto}</span>${e.abarrotes && i.accion && i.accion !== "omitir" ? `<button type="button" class="df-caduca ${e.caducidades[i.id] ? "puesta" : ""}" onclick="dfCaducidad(${i.id})">${e.caducidades[i.id] ? "Caduca " + esc(fechaCorta(e.caducidades[i.id])) : "+ Fecha de caducidad"}</button>` : ""}</span>
                    ${!i.accion ? `<button type="button" class="dm-boton-chico" onclick="dfDecidir(${i.id})">Decidir</button>` : i.accion === "omitir" ? "" : `<span class="dm-paso"><button type="button" onclick="dfPaso(${i.id}, -1)" aria-label="Menos">${icono("menos", 18)}</button><input class="dm-cant" type="number" inputmode="decimal" min="0" data-id="${i.id}" value="${recibido ?? ""}" oninput="dfValor(${i.id}, this.value)" placeholder="—"><button type="button" onclick="dfPaso(${i.id}, 1)" aria-label="Más">${icono("mas", 18)}</button></span>`}
                </div>`;
            }).join("")}</div>`,
            pie: `<button type="button" class="dm-grande" ${sinDecidir ? "disabled" : ""} onclick="dfConfirmar()">Confirmar recepción</button>`
        });
    }

    function actualizar(e, id) {
        guardar(e.id, { recibido: e.recibido, caducidades: e.caducidades });
        const i = e.datos.items.find(x => x.id === id);
        const campo = document.querySelector(`.dm-cant[data-id="${id}"]`);

        if (campo) { campo.value = e.recibido[id] ?? ""; const fila = campo.closest(".df-renglon"); const [texto, color] = estadoRenglon(i, e); fila.classList.toggle("listo", color === "verde"); const et = fila.querySelector(".dm-etiqueta"); if (et) { et.textContent = texto; et.className = "dm-etiqueta dm-" + color; } }

        const sub = document.querySelector(".dm-titulo-caja small");
        if (sub) sub.textContent = `${e.datos.recepcion.folio ? "Folio " + e.datos.recepcion.folio + " · " : ""}${e.datos.items.filter(x => x.accion !== "omitir" && e.recibido[x.id] !== undefined).length} de ${e.datos.items.filter(x => x.accion !== "omitir").length} verificados`;
    }

    const fechaCorta = f => new Date(f + "T12:00:00").toLocaleDateString("es-MX", { day: "2-digit", month: "short", year: "numeric" });

    // Fecha de caducidad real de lo que llego (abarrotes): se abre su lote con esa fecha al confirmar.
    window.dfCaducidad = async function (itemId) {
        const e = actual();
        const d = await N().dialogo({ titulo: "¿Cuándo caduca?", texto: "Fecha impresa en el empaque. Déjala vacía si no aplica.", campo: { tipo: "date", valor: e.caducidades[itemId] || "" }, aceptar: "Guardar" });

        if (!d.ok) return;

        if (d.valor) e.caducidades[itemId] = d.valor; else delete e.caducidades[itemId];
        guardar(e.id, { recibido: e.recibido, caducidades: e.caducidades });
        pintar();
    };

    window.dfValor = function (id, valor) { const e = actual(); if (valor === "") delete e.recibido[id]; else e.recibido[id] = Number(valor); actualizar(e, id); };
    window.dfPaso = function (id, paso) { const e = actual(); e.recibido[id] = Math.max(0, (e.recibido[id] || 0) + paso); actualizar(e, id); };

    window.dfEscanear = function () {
        const e = actual();

        if (typeof abrirEscanerCodigoDueno !== "function") { N().aviso("El escáner no está disponible en este equipo.", "error"); return; }

        abrirEscanerCodigoDueno({
            titulo: "Escanea lo que llegó",
            continuo: true,
            alCodigo: codigo => {
                const estado = document.getElementById("duenoEscanerCodigoEstado");
                const i = renglonDeCodigo(e.datos.items.filter(x => x.accion !== "omitir"), codigo);

                if (!i) { if (estado) estado.textContent = `✕ ${codigo}: no está en esta factura`; return; }
                if (!i.accion) { if (estado) estado.textContent = `Ese producto está por decidir; decídelo y vuelve a escanear`; return; }

                e.recibido[i.id] = (e.recibido[i.id] || 0) + 1;
                guardar(e.id, { recibido: e.recibido, caducidades: e.caducidades });
                if (estado) estado.textContent = `✓ ${i.nombreNuevoProducto || i.descripcion} · ${numero(e.recibido[i.id])} de ${numero(i.cantidad)}`;
            }
        });

        const cerrar = window.cerrarEscanerCodigoDueno;
        window.cerrarEscanerCodigoDueno = function (...a) { window.cerrarEscanerCodigoDueno = cerrar; const r = cerrar.apply(this, a); if (actual() === e) pintar(); return r; };
    };

    // ---- Decidir un producto que no se reconocio ----

    function hoja(html) {
        const fondo = document.createElement("div");
        fondo.className = "dm-dialogo-fondo";
        fondo.innerHTML = `<div class="dm-dialogo">${html}</div>`;
        document.body.appendChild(fondo);
        fondo.addEventListener("click", ev => { if (ev.target === fondo) fondo.remove(); });
        return fondo;
    }

    window.dfDecidir = function (itemId) {
        const e = actual();
        const i = e.datos.items.find(x => x.id === itemId);
        const sugerido = i.candidato?.nombre ? `Se parece a: ${i.candidato.nombre}` : "";
        const fondo = hoja(`<h3>${esc(i.descripcion)}</h3><p>${esc(sugerido || "No reconozco este producto en tu inventario.")}</p>
            <div class="df-opciones">
                ${i.candidato?.productoId ? `<button type="button" data-a="candidato">Sí, es ese (${esc(i.candidato.nombre || "")})</button>` : ""}
                <button type="button" data-a="buscar">Ya lo tengo: buscarlo</button>
                <button type="button" data-a="nuevo">Es un producto nuevo</button>
                <button type="button" data-a="omitir" class="df-gris">No llegó / omitir</button>
            </div>`);

        fondo.addEventListener("click", async ev => {
            const accion = ev.target.dataset?.a;
            if (!accion) return;
            fondo.remove();

            if (accion === "candidato") await decidir(e, i, { accion: "relacionar", productoId: i.candidato.productoId });
            else if (accion === "omitir") await decidir(e, i, { accion: "omitir" });
            else if (accion === "buscar") buscarExistente(e, i);
            else nuevoProducto(e, i);
        });
    };

    async function decidir(e, i, cuerpo) {
        const r = await llamar(`/recepcion-inteligente/facturas/${e.id}/items/${i.id}`, { method: "POST", body: cuerpo });

        if (!r.ok) { N().aviso(r.datos.error || "No se pudo guardar la decisión.", "error"); return; }

        const d = await llamar(`/recepcion-inteligente/facturas/${e.id}`);
        if (d.ok) e.datos = d.datos;
        pintar();
    }

    function buscarExistente(e, i) {
        const fondo = hoja(`<h3>Buscar en tu inventario</h3><input class="dm-input" type="search" placeholder="Nombre o código" autocomplete="off"><div class="dm-lista df-resultados"></div>`);
        const entrada = fondo.querySelector("input");
        const caja = fondo.querySelector(".df-resultados");
        let t = null;

        entrada.addEventListener("input", () => {
            clearTimeout(t);
            t = setTimeout(async () => {
                const hallados = typeof buscarEnCatalogoLocal === "function" && entrada.value.trim().length >= 2 ? await buscarEnCatalogoLocal(entrada.value) : [];
                caja.innerHTML = hallados.map(p => `<button type="button" class="dm-producto" data-id="${p.id}"><span class="dm-fila-texto"><b>${esc(p.nombre)}</b><small>${esc(p.codigo || "")}</small></span></button>`).join("");
            }, 300);
        });
        caja.addEventListener("click", async ev => { const b = ev.target.closest("[data-id]"); if (!b) return; fondo.remove(); await decidir(e, i, { accion: "relacionar", productoId: Number(b.dataset.id) }); });
        setTimeout(() => entrada.focus(), 80);
    }

    // Nivel de precio con el que cobra este negocio por defecto (Configuracion): publico, medio mayoreo o distribuidor.
    let nivelPrecioCache = null;

    async function nivelDelNegocio() {
        if (nivelPrecioCache) return nivelPrecioCache;

        const r = await llamar("/negocio-actual");
        const texto = String(r.ok ? (r.datos.negocio?.nivelPrecio || r.datos.negocio?.nivel_precio_por_defecto || "") : "").toLowerCase();

        nivelPrecioCache = texto.includes("distrib") ? "distribuidor" : texto.includes("mayoreo") ? "medio" : "publico";
        return nivelPrecioCache;
    }

    // Producto nuevo: lo esencial se decide aqui (nombre, los 3 precios y venta suelta); el resto de la ficha (categoria, piezas por
    // bolsa, bascula, stock minimo...) se completa justo despues de confirmar, en el formulario completo de "Agregar producto".
    // Precios: Publico y Medio mayoreo se capturan; Distribuidor es SIEMPRE el costo de la factura (asi lo maneja la recepcion).
    // El que cobra tu negocio por defecto va marcado: el POS usa ese nivel al vender.
    async function nuevoProducto(e, i) {
        const nivel = await nivelDelNegocio();
        const c = i.candidato || {};
        const dePrecio = (...valores) => { const v = valores.map(Number).find(x => x > 0); return v ? Math.round(v * 100) / 100 : null; };
        const base = dePrecio(i.precioSugerido, c.medioMayoreo, c.precioMedioMayoreo) || Math.round(i.costo * 1.25);
        const medio = dePrecio(c.medioMayoreo, c.precioMedioMayoreo, nivel === "medio" ? i.precioSugerido : null) || base;
        const publico = dePrecio(c.publico, c.precioPublico) || Math.round(medio * 1.18);
        const marca = clave => (nivel === clave ? `<em class="df-nivel">Tu negocio cobra este</em>` : "");

        const fondo = hoja(`<h3>Producto nuevo</h3><p>Costo de la factura: ${dinero(i.costo)}. Se crea al confirmar la recepción.</p>
            <label class="dm-campo">Nombre<input class="dm-input" id="dfNombre" value="${esc(c.nombre || i.descripcion)}" autocomplete="off"></label>
            <div class="df-precios">
                <label class="dm-campo df-precio ${nivel === "publico" ? "df-activo" : ""}"><span>Público ${marca("publico")}</span><input class="dm-input" id="dfPrecio" type="number" inputmode="decimal" value="${publico}"></label>
                <label class="dm-campo df-precio ${nivel === "medio" ? "df-activo" : ""}"><span>Medio mayoreo ${marca("medio")}</span><input class="dm-input" id="dfMayoreo" type="number" inputmode="decimal" value="${medio}"></label>
                <div class="dm-campo df-precio ${nivel === "distribuidor" ? "df-activo" : ""}"><span>Distribuidor ${marca("distribuidor")}</span><div class="dm-input df-fijo">${dinero(i.costo)}</div><small>Es el costo de la factura</small></div>
            </div>
            <p class="dm-nota">Los precios sugeridos salen de tu margen con este proveedor y del catálogo. Tu negocio cobra con ${nivel === "medio" ? "Medio mayoreo" : nivel === "distribuidor" ? "Distribuidor" : "Público"} por defecto (se cambia en Configuración).</p>
            <label class="dm-check"><input type="checkbox" id="dfSuelto"><span>También se vende suelto (por pieza, kilo, metro…)</span></label>
            <div class="df-suelto" id="dfSueltoCampos" style="display:none">
                <label class="dm-campo">Se vende suelto por<select class="dm-input" id="dfUnidad"><option value="pieza">Pieza</option><option value="kg">Kilo</option><option value="metro">Metro</option><option value="litro">Litro</option><option value="gramo">Gramo</option></select></label>
                <label class="dm-campo">Precio suelto<input class="dm-input" id="dfPrecioSuelto" type="number" inputmode="decimal" placeholder="Ej. 5"></label>
            </div>
            <p class="dm-nota">Después de confirmar podrás completar el resto de su ficha: categoría, cómo se compra, báscula, stock mínimo y más.</p>
            <p class="dm-error" id="dfError"></p>
            <div class="dm-dialogo-botones"><button type="button" data-r="no">Cancelar</button><button type="button" class="principal" data-r="si">Crear</button></div>`);

        fondo.querySelector("#dfSuelto").addEventListener("change", ev => { fondo.querySelector("#dfSueltoCampos").style.display = ev.target.checked ? "grid" : "none"; });

        fondo.addEventListener("click", async ev => {
            const r = ev.target.dataset?.r;
            if (r === "no") { fondo.remove(); return; }
            if (r !== "si") return;

            const nombre = fondo.querySelector("#dfNombre").value.trim();
            const precioPublico = Number(fondo.querySelector("#dfPrecio").value);
            const precioMedio = Number(fondo.querySelector("#dfMayoreo").value);
            const suelto = fondo.querySelector("#dfSuelto").checked;
            const precioSuelto = Number(fondo.querySelector("#dfPrecioSuelto").value);
            const error = fondo.querySelector("#dfError");

            if (!nombre || !(precioPublico > 0) || !(precioMedio > 0)) { error.textContent = "Pon el nombre y los precios público y medio mayoreo."; return; }
            if (precioMedio > precioPublico) { error.textContent = "El medio mayoreo no puede ser más caro que el precio al público."; return; }
            if (suelto && !(precioSuelto > 0)) { error.textContent = "Pon el precio de venta suelto."; return; }
            if (precioMedio < i.costo) { error.textContent = `El medio mayoreo (${dinero(precioMedio)}) quedaría por debajo del costo (${dinero(i.costo)}).`; return; }

            const cuerpo = { accion: "crear", nombreNuevoProducto: nombre, precioPublico, precioMedioMayoreo: precioMedio };
            if (suelto) { cuerpo.unidadSuelta = fondo.querySelector("#dfUnidad").value; cuerpo.precioPieza = precioSuelto; }

            fondo.remove();
            await decidir(e, i, cuerpo);
        });
    }

    // ---- 3) Confirmar con lo que de verdad llego ----

    window.dfConfirmar = async function () {
        const e = actual();
        const items = e.datos.items.filter(i => i.accion && i.accion !== "omitir");
        const sinVerificar = items.filter(i => e.recibido[i.id] === undefined);
        const conDiferencia = items.filter(i => e.recibido[i.id] !== undefined && e.recibido[i.id] !== i.cantidad);

        const d = await N().dialogo({
            titulo: "¿Confirmar la recepción?",
            texto: `Se suma al inventario lo que verificaste.${conDiferencia.length ? ` ${conDiferencia.length} producto(s) llegaron distinto a la factura: se recibe lo que contaste.` : ""}${sinVerificar.length ? ` ${sinVerificar.length} producto(s) sin verificar se reciben como dice la factura.` : ""}`,
            aceptar: "Confirmar"
        });

        if (!d.ok) return;

        const cantidadesRecibidas = {};
        Object.entries(e.recibido).forEach(([id, c]) => { cantidadesRecibidas[id] = c; });

        const r = await window.confirmarFacturaMovil(e.id, cantidadesRecibidas, e.caducidades);

        if (r.cancelado) return;

        if (!r.ok) {
            N().aviso(r.datos.error || "No se pudo confirmar.", "error");
            return;
        }

        borrar(e.id);
        if (typeof refrescarCatalogoLocalDueno === "function") refrescarCatalogoLocalDueno().catch(() => {});
        N().aviso("Recepción confirmada: inventario actualizado");
        pila = [];
        ir({ t: "acomodo", productos: (r.datos.productos || []).map(p => ({ ...p, lugar: null, hecho: false })), cargando: true });
        cargarAcomodo(actual());
    };

    // ---- 4) Acomodar: escanear el estante de cada producto ----

    async function cargarAcomodo(e) {
        for (const p of e.productos) {
            const r = await llamar(`/ubicaciones/producto/${p.productoId}`);
            if (r.ok) { p.lugar = r.datos.producto.estante?.ruta || ""; p.imagenUrl = r.datos.producto.imagenUrl; }
        }

        e.cargando = false;
        if (actual() === e) pintar();
    }

    function pintarAcomodo(e) {
        const pendientes = e.productos.filter(p => !p.hecho && !p.lugar).length;
        const porCompletar = e.productos.filter(p => p.creado && !p.completado).length;

        return pantalla({
            titulo: "Acomodar mercancía",
            subtitulo: e.cargando ? "" : pendientes ? `${pendientes} sin lugar` : "Todo acomodado",
            cuerpo: `${porCompletar ? `<p class="dm-nota df-aviso">${porCompletar} producto(s) nuevo(s) se crearon con lo básico. Toca "Completar datos" para llenar su ficha: categoría, cómo se vende, báscula, stock mínimo y más.</p>` : ""}
            <p class="dm-nota">Escanea la etiqueta del estante donde pones cada producto. Si ya tiene lugar, puedes cambiarlo.</p>
            <div class="dm-lista">${e.productos.map(p => `<div class="dm-producto">
                <span class="dm-fila-texto"><b>${esc(p.nombre)}</b><small>Llegaron ${numero(p.cantidad)} · ${p.lugar ? esc(p.lugar) : "Sin lugar asignado"}</small>${p.creado ? `<span class="dm-etiqueta dm-${p.completado ? "verde" : "ambar"}">${p.completado ? "Ficha completa" : "Nuevo"}</span>` : ""}</span>
                ${p.creado && !p.completado ? `<button type="button" class="dm-boton-chico df-completar" onclick="dfCompletar(${p.productoId})">Completar datos</button>` : ""}
                <button type="button" class="dm-boton-chico" onclick="dfAcomodar(${p.productoId})">${p.hecho ? "✓ Cambiar" : p.lugar ? "Cambiar" : "Escanear estante"}</button>
            </div>`).join("")}</div>`,
            pie: `<button type="button" class="dm-grande" onclick="dfTerminar()">Terminar</button>`
        });
    }

    window.dfAcomodar = function (productoId) {
        const e = actual();

        abrirEscanerCodigoDueno({
            titulo: "Escanea el estante",
            alCodigo: async codigo => {
                const u = await llamar(`/ubicaciones/codigo/${encodeURIComponent(String(codigo).trim())}`);

                if (!u.ok) { N().aviso("Ese código no es de ningún lugar de tu tienda.", "error"); return; }

                const lugar = u.datos.ubicacion;
                const previo = e.productos.find(x => x.productoId === productoId);

                // Ya tenia un estante distinto: se confirma el cambio (queda registrado quien lo movio).
                if (previo?.lugar && lugar.zona !== "bodega" && !previo.lugar.includes(lugar.nombre)) {
                    const d = await N().dialogo({ titulo: "Ya tiene otro estante", texto: `${previo.nombre} está registrado en: ${previo.lugar}. ¿Lo mueves a ${lugar.ruta}?`, aceptar: "Moverlo", cancelar: "No" });
                    if (!d.ok) return;
                }

                const r = await llamar(`/ubicaciones/${lugar.id}/asignar`, { method: "POST", body: { productoIds: [productoId] } });

                if (!r.ok) { N().aviso(r.datos.error || "No se pudo acomodar.", "error"); return; }

                const p = e.productos.find(x => x.productoId === productoId);
                p.lugar = lugar.ruta;
                p.hecho = true;

                if (lugar.zona === "bodega") {
                    const d = await N().dialogo({ titulo: "¿Cuántas piezas dejas aquí?", texto: "Cantidad en esta sección de bodega.", campo: { tipo: "number", valor: String(p.cantidad) }, aceptar: "Anotar" });
                    if (d.ok && Number(d.valor) >= 0) await llamar(`/ubicaciones/${lugar.id}/bodega`, { method: "POST", body: { productoId, cantidad: Number(d.valor) } });
                }

                N().aviso(`${p.nombre} → ${lugar.nombre}`);
                if (typeof refrescarCatalogoLocalDueno === "function") refrescarCatalogoLocalDueno().catch(() => {});
                if (actual() === e) pintar();
            }
        });
    };

    // Abre el formulario completo de "Agregar producto" (modo edicion) con el producto recien creado.
    window.dfCompletar = async function (productoId) {
        const e = actual();
        const r = await llamar(`/productos/${productoId}`);

        if (!r.ok || !r.datos.producto) { N().aviso("No se pudo abrir el producto.", "error"); return; }

        const overlay = document.getElementById("duenoProductoFormOverlay");
        abrirFormularioProductoDueno(r.datos.producto, { completarConfig: true, alGuardar: () => { const p = e.productos.find(x => x.productoId === productoId); if (p) p.completado = true; if (actual() === e) pintar(); } });
        if (overlay) overlay.style.zIndex = "9590";
    };

    window.dfTerminar = async function () {
        const e = actual();
        const sin = e.productos.filter(p => !p.hecho && !p.lugar).length;
        const sinFicha = e.productos.filter(p => p.creado && !p.completado).length;

        if (sinFicha && !sin) {
            const d = await N().dialogo({ titulo: "Fichas sin completar", texto: `${sinFicha} producto(s) nuevo(s) tienen solo lo básico. Puedes completarlos después desde Inventario.`, aceptar: "Terminar de todos modos" });
            if (!d.ok) return;
        }

        if (sin) {
            const d = await N().dialogo({ titulo: "Quedan productos sin lugar", texto: `${sin} producto(s) no tienen estante. Puedes acomodarlos después desde Inventario de tienda.`, aceptar: "Terminar de todos modos" });
            if (!d.ok) return;
        }

        capa.classList.remove("abierta");
        pila = [];
    };
})();
