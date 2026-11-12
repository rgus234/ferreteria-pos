// Sugerir pedido con "Autollenar" (abarrotes): un toque arma el pedido de todo lo que esta por debajo del minimo, con foto, agrupado por proveedor,
// con el costo total y listo para guardar, mandar por WhatsApp, copiar o imprimir como documento para el proveedor.
//  - Autollenar: "hasta el minimo" (solo lo que esta por debajo) o "hasta el maximo" (lo que llego al minimo o menos, hasta su maximo; sin maximo, el doble del minimo).
//  - Lo que ya viene en camino (pedidos enviados) y lo encargado por clientes se toma en cuenta, para no pedir dos veces.
//  - Lo que no tiene proveedor sale aparte, con un boton para asignarle uno a todos de golpe: a nadie se le manda lo de otro.
// Es parte de "Pedidos" (funcion pedidos_unico). Reemplaza al "Sugerir pedido" de lista sin fotos.
(function () {
    const esc = valor => String(valor ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
    const plano = texto => String(texto || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
    const dinero = valor => "$" + Number(valor || 0).toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const numero = valor => Number(valor || 0).toLocaleString("es-MX", { maximumFractionDigits: 3 });
    const aviso = (mensaje, tipo) => { if (typeof mostrarToastPOS === "function") mostrarToastPOS(mensaje, tipo ? { tipo } : undefined); };
    const DIAS = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
    const n = valor => { const x = Number(valor); return Number.isFinite(x) ? x : 0; };
    // Ferreteria (perfil completo): el costo casi nunca esta capturado, asi que en pantalla se estima con el precio de distribuidor (se marca con ≈).
    // Lo que se guarda en el pedido y se imprime para el proveedor usa SOLO el costo real.
    const esFerreteria = () => !(typeof perfilEsSimple === "function" && perfilEsSimple());
    const costoReal = p => { const c = n(p.costo); return c > 0 ? c : 0; };
    // El estimado viene del servidor (distribuidor del Catalogo TRUPER o del catalogo del proveedor); NO el precio de distribuidor que el negocio le pone a sus clientes.
    const costoEstimado = p => { if (costoReal(p) || !esFerreteria()) return 0; const d = n(al && al.estimados && al.estimados[p.id]); return d > 0 ? d : 0; };
    const costoDe = p => costoReal(p) || costoEstimado(p);
    const textoCosto = (p, pedir) => { const r = costoReal(p), e = costoEstimado(p); return r ? `${dinero(r)} c/u · ${dinero(pedir * r)}` : (e ? `≈ ${dinero(e)} c/u (estimado) · ≈ ${dinero(pedir * e)}` : "Sin costo"); };
    // El minimo con el que nace todo producto (3, sin maximo): en ferreteria no significa que lo pidas, y marcaria casi todo el inventario.
    const esMinimoDeFabrica = p => n(p.stock_minimo) === 3 && !(n(p.stock_maximo) > 0);

    let al = null;

    async function llamar(ruta, opciones = {}) {
        const r = await fetch(ruta, { ...opciones, headers: { "Content-Type": "application/json", ...(opciones.headers || {}) } });
        const datos = await r.json().catch(() => ({}));
        return { ok: r.ok && datos.ok !== false, datos };
    }

    window.mostrarAutollenarPedido = async function () {
        if (typeof ocultarPantallasPrincipales === "function") ocultarPantallasPrincipales();
        const pantalla = document.getElementById("pantallaPedidosUnico");
        if (!pantalla) return;
        pantalla.style.display = "block";
        if (typeof actualizarTopbarContexto === "function") actualizarTopbarContexto("Sugerir pedido", "Nexo arma el pedido con lo que se está acabando", "pedidos-unico");
        pantalla.innerHTML = `<div class="pa-shell"><p class="pa-vacio">Revisando tu inventario…</p></div>`;

        if (!Array.isArray(todosProductos) || !todosProductos.length) { try { await cargarProductos(); } catch (error) { /* se avisa abajo */ } }

        const [prov, comp, marcas, est] = await Promise.all([llamar("/proveedores"), llamar("/pedido-minmax/comprometido"), llamar("/marcas-directorio"), esFerreteria() ? llamar("/pedido-minmax/costos-estimados") : Promise.resolve({ ok: false, datos: {} })]);

        al = {
            productos: (Array.isArray(todosProductos) ? todosProductos : []).filter(p => Number(p.id) > 0),
            proveedores: (prov.ok && prov.datos.proveedores) || [],
            comp: (comp.ok && comp.datos.productos) || {},
            estimados: (est.ok && est.datos.costos) || {},
            hasta: "minimo",
            items: null,
            guardados: new Map(),
            elegido: {},
            marcas: (marcas.ok && marcas.datos.marcas) || []
        };
        pintar();
    };

    // ---------- calculo ----------

    function proveedorDe(p) {
        const porId = al.proveedores.find(x => Number(x.id) === Number(p.proveedor_id));
        if (porId) return { clave: "p" + porId.id, nombre: porId.nombre, registro: porId };
        const texto = String(p.proveedor || "").trim();
        if (texto) {
            const porNombre = al.proveedores.find(x => plano(x.nombre) === plano(texto));
            if (porNombre) return { clave: "p" + porNombre.id, nombre: porNombre.nombre, registro: porNombre };
            return { clave: "t_" + (plano(texto).replace(/[^a-z0-9]+/g, "_") || "x"), nombre: texto, registro: null };
        }
        return { clave: "sin", nombre: "Sin proveedor", registro: null };
    }

    function calcular(previas) {
        const items = [];
        al.omitidos = 0;

        al.productos.forEach(p => {
            const minimo = n(p.stock_minimo);
            if (!(minimo > 0)) return;
            const omitir = esFerreteria() && !al.incluirFabrica && esMinimoDeFabrica(p);

            const c = al.comp[p.id] || {};
            const proyectado = Math.round((n(p.stock) + n(c.enCamino) - n(c.encargado)) * 1000) / 1000;
            const maxReal = n(p.stock_maximo);
            const maximo = maxReal > 0 && maxReal >= minimo ? maxReal : minimo * 2;
            let pedir = 0;

            if (al.hasta === "minimo") { if (proyectado < minimo) pedir = Math.ceil(minimo - proyectado); }
            else if (proyectado <= minimo) pedir = Math.ceil(maximo - proyectado);

            if (omitir) { if (pedir > 0) al.omitidos += 1; return; }

            if (pedir > 0) items.push({ p, pedir: previas && previas.has(p.id) ? previas.get(p.id) : pedir, proveedor: proveedorDe(p), sinMaximo: !(maxReal > 0) && al.hasta === "maximo", enCamino: n(c.enCamino) });
        });

        return items;
    }

    function grupos() {
        const mapa = new Map();
        al.items.forEach(i => { if (!mapa.has(i.proveedor.clave)) mapa.set(i.proveedor.clave, { clave: i.proveedor.clave, nombre: i.proveedor.nombre, registro: i.proveedor.registro, items: [] }); mapa.get(i.proveedor.clave).items.push(i); });
        // Primero los que vienen antes; "Sin proveedor" al final.
        return [...mapa.values()].sort((a, b) => (a.clave === "sin") - (b.clave === "sin") || a.nombre.localeCompare(b.nombre));
    }

    const lineas = g => g.items.filter(i => i.pedir > 0);
    const totalDe = g => lineas(g).reduce((s, i) => s + i.pedir * costoDe(i.p), 0);

    // ---------- pantalla ----------

    function pintar() {
        const pantalla = document.getElementById("pantallaPedidosUnico");
        if (!pantalla || !al) return;

        pantalla.innerHTML = `<div class="pa-shell">
            <button type="button" class="pa-atras" onclick="mostrarPedidosUnico()">← Pedidos</button>
            <header class="pa-cab"><h2>Sugerir pedido</h2><p>Nexo arma el pedido de todo lo que está por debajo de tu mínimo, con foto y costo, y lo separa por proveedor.</p></header>
            <section class="pa-controles">
                <div><span>¿Hasta cuánto completar?</span>
                    <div class="pa-opciones">
                        <button type="button" class="${al.hasta === "minimo" ? "activo" : ""}" onclick="paHasta('minimo')"><b>Hasta el mínimo</b><small>Solo lo que ya está por debajo</small></button>
                        <button type="button" class="${al.hasta === "maximo" ? "activo" : ""}" onclick="paHasta('maximo')"><b>Hasta el máximo</b><small>Lo que llegó al mínimo o menos, hasta su máximo (sin máximo: el doble del mínimo)</small></button>
                    </div></div>
                <button type="button" class="pa-autollenar" onclick="paAutollenar()">${al.items ? "Volver a calcular" : "Autollenar"}</button>
            </section>
            <p class="pa-enlace"><button type="button" onclick="mostrarSugerirPedidoPorMarca()">Ajustar mínimos y máximos por marca</button></p>
            <div id="paResultado">${al.items ? cuerpoResultado() : `<p class="pa-vacio">Toca <b>Autollenar</b> y aquí aparece el pedido.</p>`}</div>
        </div>`;
    }

    window.paHasta = function (valor) { al.hasta = valor; if (al.items) al.items = calcular(null); pintar(); };

    window.paAutollenar = function () {
        al.items = calcular(null);
        al.guardados = new Map();
        pintar();
    };

    window.paFabrica = function () { al.incluirFabrica = !al.incluirFabrica; al.items = calcular(null); al.guardados = new Map(); pintar(); };

    function notaOmitidos() {
        if (!esFerreteria()) return "";
        if (al.incluirFabrica) return `<p class="pa-nota">Incluí también los productos que tienen el mínimo de fábrica (3). <button type="button" class="pa-enlace-btn" onclick="paFabrica()">Quitarlos</button></p>`;
        if (!al.omitidos) return "";
        const calc = typeof funcionBeta === "function" && funcionBeta("minimos_ventas") && typeof mostrarMinimosVentas === "function";
        return `<div class="pa-auto"><span><b>${al.omitidos} producto${al.omitidos === 1 ? "" : "s"}</b> ${al.omitidos === 1 ? "está" : "están"} bajo el mínimo solo porque tienen el mínimo de fábrica (3), no uno que tú pusiste, así que no los incluí.${calc ? " Con “Mínimos con tus ventas” Nexo pone el mínimo real de lo que sí vendes." : ""}</span><button type="button" class="pa-principal" onclick="paFabrica()">Incluirlos</button>${calc ? `<button type="button" class="pa-principal" onclick="mostrarMinimosVentas()">Calcular mis mínimos</button>` : ""}</div>`;
    }

    function cuerpoResultado() {
        const gs = grupos();
        if (!gs.length) return notaOmitidos() + `<div class="pa-ok"><b>No hace falta pedir nada.</b><p>Todo lo que tiene mínimo está por encima de él${al.hasta === "maximo" ? " (o ya viene en camino)" : ""}. Si algo debería salir, revisa su mínimo en Inventario.</p></div>`;
        return notaOmitidos() + cuerpoGrupos(gs);
    }

    function cuerpoGrupos(gs) {

        const total = gs.reduce((s, g) => s + totalDe(g), 0);
        const productos = gs.reduce((s, g) => s + lineas(g).length, 0);

        const sinCosto = gs.reduce((c, g) => c + lineas(g).filter(i => !costoDe(i.p)).length, 0);
        const sinResolver = gs.filter(g => g.clave === "sin" || !g.registro).length;

        return `<div class="pa-resumen"><span><b>${productos}</b> producto${productos === 1 ? "" : "s"} · <b>${gs.length}</b> proveedor${gs.length === 1 ? "" : "es"}</span><strong>${gs.some(g => lineas(g).some(i => costoEstimado(i.p))) ? "≈ " : ""}${dinero(total)} <small>a costo</small></strong></div>
            ${sinResolver ? `<div class="pa-auto"><span><b>${sinResolver} grupo${sinResolver === 1 ? "" : "s"}</b> no tiene${sinResolver === 1 ? "" : "n"} un proveedor creado. Nexo puede acomodarlos por la marca de cada producto (Doritos → Sabritas) y crear los proveedores que falten.</span><button type="button" class="pa-principal" onclick="paAcomodarPorMarca()">Acomodar por marca</button></div>` : ""}
            ${sinCosto ? `<p class="pa-nota">${sinCosto} producto${sinCosto === 1 ? "" : "s"} no tiene${sinCosto === 1 ? "" : "n"} costo capturado, así que el total es parcial. El costo se completa al recibir la factura de ese proveedor.</p>` : ""}
            ${gs.map(htmlGrupo).join("")}`;
    }

    function visita(registro) {
        if (!registro || registro.dia_visita === null || registro.dia_visita === undefined || registro.dia_visita === "") return "";
        const hoy = new Date().getDay();
        const dias = (Number(registro.dia_visita) - hoy + 7) % 7;
        return dias === 0 ? " · viene hoy" : (dias === 1 ? " · viene mañana" : ` · viene el ${DIAS[Number(registro.dia_visita)]}`);
    }

    // La marca del directorio que coincide con el nombre del proveedor (palabra completa): su imagen se ve en el encabezado.
    function logoDe(nombre) {
        const n = " " + plano(nombre).replace(/[^a-z0-9]+/g, " ") + " ";
        const m = al.marcas.find(x => n.includes(" " + plano(x.nombre).replace(/[^a-z0-9]+/g, " ") + " "));
        return m ? `<img class="pa-logo" src="/marcas-directorio/${esc(m.id)}/imagen" alt="" loading="lazy" onerror="this.remove()">` : "";
    }

    function htmlGrupo(g) {
        const guardado = al.guardados.get(g.clave);
        const ls = lineas(g);
        const sinCosto = ls.filter(i => !costoDe(i.p)).length;
        const aSinProveedor = g.clave === "sin";
        const sinCrear = !aSinProveedor && !g.registro;
        const clave = esc(g.clave);

        // Sin proveedor, o con uno que solo esta escrito como texto en el producto (no existe en Proveedores): se asigna uno o se crea.
        const asignar = (aSinProveedor || sinCrear) ? `<div class="pa-asignar">
            <p>${aSinProveedor ? "Estos productos no tienen proveedor, así que no se le pueden pedir a nadie." : `<b>${esc(g.nombre)}</b> está escrito en los productos, pero no existe en tu lista de Proveedores.`} Crea o elige uno y se lo asigno a los ${g.items.length}:</p>
            <div>
                ${sinCrear ? `<button type="button" class="pa-principal" onclick="paCrearAsignar('${clave}')">Crear «${esc(g.nombre)}» y asignar</button><span class="pa-o">o</span>` : `<input type="text" id="paNuevo-${clave}" placeholder="Nombre del proveedor nuevo" maxlength="120"><button type="button" class="pa-principal" onclick="paCrearAsignar('${clave}')">Crear y asignar</button><span class="pa-o">o</span>`}
                <select onchange="paElegirProveedor('${clave}', this.value)"><option value="">Elegir uno que ya tengas…</option>${al.proveedores.map(x => `<option value="${Number(x.id)}" ${String(al.elegido[g.clave] || "") === String(x.id) ? "selected" : ""}>${esc(x.nombre)}</option>`).join("")}</select>
                <button type="button" class="pa-sec" id="paAsignar-${clave}" onclick="paAsignar('${clave}')" ${al.elegido[g.clave] ? "" : "disabled"}>Asignar</button>
            </div></div>` : "";

        const acciones = (aSinProveedor || sinCrear) ? "" : (guardado
            ? `<span class="pa-guardado">✓ ${guardado === "enviado" ? "Pedido guardado como enviado" : "Pedido guardado como borrador"}</span>`
            : `<div class="pa-acciones">
                <button type="button" onclick="paGuardar('${esc(g.clave)}', 'borrador')">Guardar borrador</button>
                <button type="button" class="pa-principal" onclick="paEnviar('${esc(g.clave)}')">Enviar por WhatsApp</button>
                <button type="button" onclick="paCopiar('${esc(g.clave)}')">Copiar lista</button>
                <button type="button" onclick="paImprimir('${esc(g.clave)}')">Imprimir</button></div>`);

        return `<section class="pa-grupo ${aSinProveedor || sinCrear ? "pa-sin" : ""}" id="paG-${esc(g.clave)}">
            <header><div class="pa-titulo">${logoDe(g.nombre)}<div><h3>${esc(g.nombre)}</h3><small>${ls.length} producto${ls.length === 1 ? "" : "s"}${esc(visita(g.registro))}${!aSinProveedor && !g.registro ? " · proveedor sin crear" : ""}${sinCosto ? ` · ${sinCosto} sin costo` : ""}${g.registro && g.registro.creado_automatico ? " · creado automáticamente" : ""}</small></div></div>
                <strong class="pa-total" id="paT-${esc(g.clave)}">${dinero(totalDe(g))}</strong></header>
            ${asignar}${acciones}
            <div class="pa-tarjetas">${g.items.map(i => tarjeta(i)).join("")}</div>
        </section>`;
    }

    function tarjeta(i) {
        const p = i.p;
        const foto = typeof miniaturaProducto === "function" ? miniaturaProducto(p) : "";
        const costo = costoDe(p);

        return `<article class="pa-tarjeta ${i.pedir > 0 ? "" : "quitada"}" id="paP-${Number(p.id)}">
            <div class="pa-foto">${foto}</div>
            <b class="pa-nombre">${esc(p.nombre)}</b>
            <small class="pa-hay">Hay ${numero(p.stock)} · mín ${numero(p.stock_minimo)}${i.enCamino ? ` · en camino ${numero(i.enCamino)}` : ""}</small>
            <div class="pa-cant"><button type="button" onclick="paSumar(${Number(p.id)}, -1)" aria-label="Menos">−</button><input type="number" min="0" step="1" value="${i.pedir}" onchange="paEscribir(${Number(p.id)}, this.value)" aria-label="Pedir"><button type="button" onclick="paSumar(${Number(p.id)}, 1)" aria-label="Más">+</button></div>
            <small class="pa-sub" id="paS-${Number(p.id)}">${textoCosto(p, i.pedir)}</small>
            <button type="button" class="pa-mover" onclick="paMover(${Number(p.id)})">Cambiar proveedor</button>
            <button type="button" class="pa-quitar" onclick="paEscribir(${Number(p.id)}, 0)" aria-label="Quitar">✕</button></article>`;
    }

    function itemPorId(id) { return al.items.find(i => Number(i.p.id) === Number(id)); }

    function refrescarItem(id) {
        const i = itemPorId(id);
        if (!i) return;
        const t = document.getElementById(`paP-${id}`);
        if (t) {
            t.classList.toggle("quitada", !(i.pedir > 0));
            const campo = t.querySelector(".pa-cant input");
            if (campo && document.activeElement !== campo) campo.value = i.pedir;
        }
        const s = document.getElementById(`paS-${id}`);
        if (s) s.textContent = textoCosto(i.p, i.pedir);
        const g = grupos().find(x => x.clave === i.proveedor.clave);
        const total = document.getElementById(`paT-${i.proveedor.clave}`);
        if (g && total) total.textContent = dinero(totalDe(g));
        const resumen = document.querySelector(".pa-resumen");
        if (resumen) { const gs = grupos(); resumen.innerHTML = `<span><b>${gs.reduce((s, x) => s + lineas(x).length, 0)}</b> producto${gs.reduce((s, x) => s + lineas(x).length, 0) === 1 ? "" : "s"} · <b>${gs.length}</b> proveedor${gs.length === 1 ? "" : "es"}</span><strong>${dinero(gs.reduce((s, x) => s + totalDe(x), 0))} <small>a costo</small></strong>`; }
    }

    window.paSumar = function (id, delta) { const i = itemPorId(id); if (!i) return; i.pedir = Math.max(0, Math.round(i.pedir + delta)); refrescarItem(id); };
    window.paEscribir = function (id, valor) { const i = itemPorId(id); if (!i) return; i.pedir = Math.max(0, Math.round(Number(valor) || 0)); refrescarItem(id); };

    // ---------- proveedor ----------

    window.paElegirProveedor = function (clave, valor) {
        al.elegido[clave] = valor;
        const b = document.getElementById("paAsignar-" + clave);
        if (b) b.disabled = !valor;
    };

    // Asigna el proveedor a todos los productos del grupo y vuelve a armar el pedido (conservando las cantidades que ya ajustaste).
    async function asignarGrupo(g, proveedorId) {
        const r = await llamar("/productos/asignar-proveedor", { method: "POST", body: JSON.stringify({ productoIds: g.items.map(i => i.p.id), proveedorId: Number(proveedorId) }) });

        if (!r.ok) { aviso(r.datos.error || "No se pudo asignar el proveedor.", "error"); return; }

        aviso(`Listo: ${r.datos.actualizados} producto${r.datos.actualizados === 1 ? "" : "s"} ahora son de ${r.datos.proveedor}.`);

        const previas = new Map(al.items.map(i => [i.p.id, i.pedir]));
        try { await cargarProductos(); } catch (error) { /* se queda con lo anterior */ }
        al.productos = (Array.isArray(todosProductos) ? todosProductos : []).filter(p => Number(p.id) > 0);
        al.elegido = {};
        al.items = calcular(previas);
        pintar();
    }

    window.paAsignar = async function (clave) {
        const g = grupoPorClave(clave);
        if (!g || !al.elegido[clave]) return;
        await asignarGrupo(g, al.elegido[clave]);
    };

    // Crea el proveedor (con el nombre escrito en los productos, o el que se teclee) y se lo asigna a todo el grupo.
    window.paCrearAsignar = async function (clave) {
        const g = grupoPorClave(clave);
        if (!g) return;
        const campo = document.getElementById("paNuevo-" + clave);
        const nombre = String(campo ? campo.value : g.nombre).replace(/\s+/g, " ").trim();

        if (!nombre) { aviso("Escribe el nombre del proveedor.", "info"); return; }

        const existente = al.proveedores.find(x => plano(x.nombre) === plano(nombre));
        let id = existente && existente.id;

        if (!id) {
            const r = await llamar("/proveedores", { method: "POST", body: JSON.stringify({ nombre }) });
            if (!r.ok || !r.datos.proveedor) { aviso(r.datos.error || "No se pudo crear el proveedor.", "error"); return; }
            al.proveedores.push(r.datos.proveedor);
            id = r.datos.proveedor.id;
        }

        await asignarGrupo(g, id);
    };

    // Un producto con el proveedor equivocado (el texto viejo del producto no siempre acierta): se le asigna otro, existente o nuevo.
    window.paMover = function (id) {
        const i = itemPorId(id);
        if (!i) return;
        document.getElementById("paFondo")?.remove();
        const fondo = document.createElement("div");
        fondo.id = "paFondo";
        fondo.className = "pa-fondo";
        fondo.onclick = e => { if (e.target === fondo) fondo.remove(); };
        const actual = i.proveedor.registro ? Number(i.proveedor.registro.id) : 0;
        fondo.innerHTML = `<div class="pa-modal" role="dialog" aria-label="Cambiar proveedor">
            <header><div><h3>¿De qué proveedor es?</h3><p>${esc(i.p.nombre)}</p></div><button type="button" onclick="document.getElementById('paFondo').remove()" aria-label="Cerrar">✕</button></header>
            <div class="pa-modal-lista">${al.proveedores.slice().sort((a, b) => String(a.nombre).localeCompare(String(b.nombre))).map(x => `<button type="button" class="${Number(x.id) === actual ? "actual" : ""}" onclick="paMoverA(${Number(id)}, ${Number(x.id)})">${esc(x.nombre)}${Number(x.id) === actual ? " <small>(actual)</small>" : ""}</button>`).join("") || `<p class="pa-vacio">Todavía no tienes proveedores creados.</p>`}</div>
            <div class="pa-modal-nuevo"><input type="text" id="paMoverNuevo" placeholder="O escribe un proveedor nuevo" maxlength="120" onkeydown="if(event.key==='Enter'){paMoverNuevo(${Number(id)})}"><button type="button" class="pa-principal" onclick="paMoverNuevo(${Number(id)})">Crear y asignar</button></div></div>`;
        document.body.appendChild(fondo);
        setTimeout(() => document.getElementById("paMoverNuevo")?.focus(), 50);
    };

    // Asigna el proveedor solo a este producto y vuelve a armar el pedido (conservando las cantidades ajustadas).
    window.paMoverA = async function (id, proveedorId) {
        document.getElementById("paFondo")?.remove();
        const r = await llamar("/productos/asignar-proveedor", { method: "POST", body: JSON.stringify({ productoIds: [id], proveedorId: Number(proveedorId) }) });

        if (!r.ok) { aviso(r.datos.error || "No se pudo cambiar el proveedor.", "error"); return; }

        const previas = new Map(al.items.map(x => [x.p.id, x.pedir]));
        try { await cargarProductos(); } catch (error) { /* se queda con lo anterior */ }
        al.productos = (Array.isArray(todosProductos) ? todosProductos : []).filter(p => Number(p.id) > 0);
        al.items = calcular(previas);
        pintar();
        aviso(`Listo: ahora es de ${r.datos.proveedor}.`);
    };

    window.paMoverNuevo = async function (id) {
        const nombre = String(document.getElementById("paMoverNuevo")?.value || "").replace(/\s+/g, " ").trim();
        if (!nombre) { aviso("Escribe el nombre del proveedor.", "info"); return; }

        let existente = al.proveedores.find(x => plano(x.nombre) === plano(nombre));

        if (!existente) {
            const r = await llamar("/proveedores", { method: "POST", body: JSON.stringify({ nombre }) });
            if (!r.ok || !r.datos.proveedor) { aviso(r.datos.error || "No se pudo crear el proveedor.", "error"); return; }
            existente = r.datos.proveedor;
            al.proveedores.push(existente);
        }

        await window.paMoverA(id, existente.id);
    };

    window.paAcomodarPorMarca = async function () {
        const r = await llamar("/productos/proveedores-por-marca", { method: "POST", body: "{}" });

        if (!r.ok) { aviso(r.datos.error || "No se pudo acomodar por marca.", "error"); return; }

        const d = r.datos;
        aviso(`Listo: ${d.asignados} producto${d.asignados === 1 ? "" : "s"} con su proveedor.${d.creados.length ? " Proveedores creados: " + d.creados.join(", ") + "." : ""}${d.sinMarca ? " " + d.sinMarca + " sin marca conocida quedan aparte." : ""}`);

        const previas = new Map(al.items.map(x => [x.p.id, x.pedir]));
        const prov = await llamar("/proveedores");
        if (prov.ok) al.proveedores = prov.datos.proveedores || [];
        try { await cargarProductos(); } catch (error) { /* se queda con lo anterior */ }
        al.productos = (Array.isArray(todosProductos) ? todosProductos : []).filter(p => Number(p.id) > 0);
        al.items = calcular(previas);
        pintar();
    };

    // ---------- guardar / enviar / copiar / imprimir ----------

    const grupoPorClave = clave => grupos().find(g => g.clave === clave);

    function textoLista(g) {
        return [`Pedido para ${g.nombre}:`, ...lineas(g).map(i => `- ${i.pedir} x ${i.p.nombre}`)].join("\n");
    }

    async function guardar(g, estado) {
        const ls = lineas(g);
        if (!ls.length) { aviso("No hay nada que pedir de este proveedor.", "info"); return false; }

        const r = await llamar("/pedidos-proveedor", { method: "POST", body: JSON.stringify({
            proveedor: g.nombre,
            estado,
            notas: "Sugerido con Autollenar",
            items: ls.map(i => ({ productoId: i.p.id, codigo: i.p.codigo, nombre: i.p.nombre, cantidad: i.pedir, costo: costoReal(i.p), unidad: "pieza", proveedor: g.nombre }))
        }) });

        if (!r.ok) { aviso(r.datos.error || "No se pudo guardar el pedido.", "error"); return false; }

        al.guardados.set(g.clave, estado);
        return true;
    }

    window.paGuardar = async function (clave, estado) {
        const g = grupoPorClave(clave);
        if (!g || !(await guardar(g, estado))) return;
        aviso(`Pedido de ${g.nombre} guardado como ${estado === "enviado" ? "enviado" : "borrador"}: ${lineas(g).length} producto${lineas(g).length === 1 ? "" : "s"}, ${dinero(lineas(g).reduce((s, i) => s + i.pedir * costoReal(i.p), 0))}.`);
        pintar();
    };

    // Abre el chat del proveedor con el pedido escrito y deja el pedido guardado como enviado.
    window.paEnviar = async function (clave) {
        const g = grupoPorClave(clave);
        if (!g) return;
        const texto = textoLista(g);
        const digitos = String((g.registro && g.registro.telefono) || "").replace(/\D/g, "");
        const telefono = digitos.length === 10 ? "52" + digitos : (digitos.length >= 11 ? digitos : "");
        const ventana = window.open("https://wa.me/" + telefono + "?text=" + encodeURIComponent(texto), "_blank", "noopener");
        if (!ventana) aviso("Tu navegador bloqueó la ventana de WhatsApp. Usa Copiar lista.", "info");
        if (await guardar(g, "enviado")) { aviso(`Pedido de ${g.nombre} guardado como enviado.`); pintar(); }
    };

    window.paCopiar = async function (clave) {
        const g = grupoPorClave(clave);
        if (!g) return;
        try { await navigator.clipboard.writeText(textoLista(g)); aviso("Lista copiada. Pégala en WhatsApp o donde quieras."); }
        catch (error) { if (typeof pedirTextoPOS === "function") await pedirTextoPOS("Copia la lista:", textoLista(g), "Pedido sugerido"); }
    };

    // Documento para mandarle al proveedor: negocio, fecha, productos con cantidad y costo, y el total.
    window.paImprimir = function (clave) {
        const g = grupoPorClave(clave);
        if (!g) return;
        const negocio = (typeof configuracionNegocio === "function" && configuracionNegocio()) || {};
        const filas = lineas(g).map(i => `<tr><td>${esc(i.p.codigo || "")}</td><td>${esc(i.p.nombre)}</td><td class="d">${i.pedir}</td><td class="d">${costoReal(i.p) ? dinero(costoReal(i.p)) : "—"}</td><td class="d">${costoReal(i.p) ? dinero(i.pedir * costoReal(i.p)) : "—"}</td></tr>`).join("");
        const v = window.open("", "_blank", "width=900,height=720");
        if (!v) { aviso("Tu navegador bloqueó la ventana de impresión.", "info"); return; }
        v.document.write(`<html><head><title>Pedido para ${esc(g.nombre)}</title><style>body{font-family:Arial,sans-serif;color:#111827;padding:28px}h1{font-size:22px;margin:0 0 2px}p{margin:0 0 18px;color:#475467}table{width:100%;border-collapse:collapse}th,td{border-bottom:1px solid #d0d5dd;padding:8px;text-align:left;font-size:13px}.d{text-align:right}tfoot td{font-weight:700;font-size:15px;border-bottom:0}</style></head><body><h1>Pedido para ${esc(g.nombre)}</h1><p>${esc(negocio.nombre || "")} · ${new Date().toLocaleDateString("es-MX", { day: "numeric", month: "long", year: "numeric" })}</p><table><thead><tr><th>Código</th><th>Producto</th><th class="d">Cantidad</th><th class="d">Costo</th><th class="d">Importe</th></tr></thead><tbody>${filas}</tbody><tfoot><tr><td colspan="4">Total estimado</td><td class="d">${dinero(lineas(g).reduce((s, i) => s + i.pedir * costoReal(i.p), 0))}</td></tr></tfoot></table><script>window.print();<\/script></body></html>`);
        v.document.close();
    };
})();
