/* Armar productos (Inventario -> Armar productos): convierte granel en bolsitas o porciones.

   Ejemplo: 0.1 kg de churros a granel = 1 bolsita. Al armar 20 bolsitas, el granel baja 2 kg y las bolsitas suben 20, de una sola vez
   y con registro de quien lo hizo; se puede deshacer en las siguientes 24 horas. Solo con la funcion nueva "armado" encendida. */

(function () {
    let armados = [];
    let historial = [];
    let productos = null;
    let formulario = null; // { origen, destino, cantidad, merma, extra } mientras se crea o edita
    let armando = null; // id del armado con el panel "Armar" abierto
    let extrasMapa = {}; // { productoId: [{ id, nombre, precio }] }
    let extrasBases = {}; // { productoId: nombre }
    let formExtras = null; // { base, nuevos: [] } mientras se agregan extras

    const esc = valor => String(valor ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
    const dinero = valor => `$${Number(valor || 0).toFixed(2)}`;
    const cantidad = valor => String(Math.round(Number(valor || 0) * 1000) / 1000);
    const unidadDe = producto => String(producto?.unidad_venta || producto?.origenUnidad || "pieza").toLowerCase().replace("kilo", "kg");

    async function llamar(ruta, opciones = {}) {
        const respuesta = await fetch(ruta, { ...opciones, headers: { "Content-Type": "application/json", ...(opciones.headers || {}) } });
        const datos = await respuesta.json().catch(() => ({}));
        return { ok: respuesta.ok && datos.ok, datos };
    }

    const pantalla = () => document.getElementById("pantallaArmado");

    async function cargar() {
        const [lista, hist, ext] = await Promise.all([llamar("/armados"), llamar("/armados/historial"), llamar("/extras")]);
        armados = lista.ok ? lista.datos.armados : [];
        historial = hist.ok ? hist.datos.historial : [];
        extrasMapa = ext.ok ? ext.datos.extras : {};
        extrasBases = ext.ok ? ext.datos.bases || {} : {};
        if (typeof window.recargarExtrasPOS === "function") window.recargarExtrasPOS();
    }

    async function cargarProductos() {
        if (productos) return productos;

        try {
            const respuesta = await fetch("/productos");
            const datos = await respuesta.json();
            productos = Array.isArray(datos) ? datos : [];
        } catch (error) {
            productos = [];
        }

        return productos;
    }

    window.mostrarArmado = async function () {
        if (typeof ocultarPantallasPrincipales === "function") ocultarPantallasPrincipales();

        const raiz = pantalla();
        if (!raiz) return;

        raiz.style.display = "block";
        if (typeof actualizarTopbarContexto === "function") actualizarTopbarContexto("Armar productos", "Convierte granel en bolsitas o porciones", "armado");

        raiz.innerHTML = `<div class="arm-shell"><p class="arm-vacio">Cargando…</p></div>`;
        formulario = null;
        armando = null;
        formExtras = null;
        productos = null;
        await cargar();
        pintar();
    };

    function tarjeta(a) {
        const abierto = armando === a.id;
        const unidad = unidadDe({ unidad_venta: a.origenUnidad });

        return `<article class="arm-tarjeta" data-id="${a.id}">
            <div class="arm-cab">
                <div>
                    <h3>${esc(a.destinoNombre)}</h3>
                    <p class="arm-receta">Cada una lleva ${cantidad(a.cantidadOrigen)} ${esc(unidad)} de ${esc(a.origenNombre)}${a.mermaPct ? ` (+${cantidad(a.mermaPct)} % de merma)` : ""}</p>
                </div>
                <div class="arm-cifras">
                    <span><b>${cantidad(a.destinoExistencia)}</b> armadas</span>
                    <span><b>${cantidad(a.origenExistencia)} ${esc(unidad)}</b> de granel</span>
                    <span>Alcanza para <b>${a.puedeArmar}</b></span>
                    ${a.costoUnidad > 0 ? `<span>Costo ${dinero(a.costoUnidad)} c/u</span>` : ""}
                </div>
            </div>
            ${abierto ? `<div class="arm-panel">
                <label>¿Cuántas armaste?<input type="number" min="1" step="1" id="armUnidades" inputmode="numeric" placeholder="20"></label>
                <div class="arm-atajos">${[10, 20, 50].map(n => `<button type="button" data-unidades="${n}">${n}</button>`).join("")}</div>
                <label>Caduca (opcional)<input type="date" id="armCaducidad"></label>
                <p class="arm-gasto" id="armGasto"></p>
                <p class="arm-error" id="armError" role="alert"></p>
                <div class="arm-acciones"><button type="button" data-accion="cancelar-armar">Cancelar</button><button type="button" class="arm-principal" data-accion="confirmar-armar" data-id="${a.id}">Armar</button></div>
            </div>` : `<div class="arm-acciones">
                <button type="button" class="arm-principal" data-accion="armar" data-id="${a.id}">Armar</button>
                <button type="button" data-accion="editar" data-id="${a.id}">Cambiar</button>
                <button type="button" data-accion="quitar" data-id="${a.id}">Quitar</button>
            </div>`}
        </article>`;
    }

    function selector(rol, etiqueta, seleccionado) {
        return `<div class="arm-campo" data-rol="${rol}">
            <label>${etiqueta}</label>
            ${seleccionado ? `<div class="arm-elegido"><span>${esc(seleccionado.nombre)} <small>${esc(unidadDe(seleccionado))}</small></span><button type="button" data-accion="cambiar" data-rol="${rol}">Cambiar</button></div>`
                : `<input type="search" data-buscar="${rol}" placeholder="Escribe para buscar" autocomplete="off"><div class="arm-resultados" id="armRes-${rol}"></div>`}
        </div>`;
    }

    function formularioHtml() {
        const f = formulario;
        const unidad = f.origen ? unidadDe(f.origen) : "";

        return `<section class="arm-form">
            <h3>${f.id ? "Cambiar armado" : "Nuevo armado"}</h3>
            ${selector("origen", "Producto a granel", f.origen)}
            ${selector("destino", "Producto que armas (bolsita, porción)", f.destino)}
            <div class="arm-fila">
                <label>Cada unidad lleva (${esc(unidad || "kg")})<input type="number" step="0.001" min="0.001" id="armCantidad" value="${esc(f.cantidad)}" placeholder="0.1" inputmode="decimal"></label>
                <label>Merma % (opcional)<input type="number" step="0.1" min="0" max="99" id="armMerma" value="${esc(f.merma)}" placeholder="0" inputmode="decimal"></label>
                <label>Empaque $ (opcional)<input type="number" step="0.01" min="0" id="armExtra" value="${esc(f.extra)}" placeholder="0.50" inputmode="decimal"></label>
            </div>
            <p class="arm-ayuda">La merma es lo que se pierde al preparar. El empaque es lo que cuesta la bolsa, por unidad.</p>
            <p class="arm-error" id="armErrorForm" role="alert"></p>
            <div class="arm-acciones"><button type="button" data-accion="cancelar-form">Cancelar</button><button type="button" class="arm-principal" data-accion="guardar-form">Guardar</button></div>
        </section>`;
    }

    function pintar() {
        const raiz = pantalla();
        if (!raiz) return;

        raiz.innerHTML = `<div class="arm-shell">
            <header class="arm-encabezado">
                <div><h2>Armar productos</h2><p>Tienes granel (churros, azúcar, jamón) y lo vendes en bolsitas o porciones. Al armar, el granel baja y lo armado sube, sin cuentas a mano.</p></div>
                ${formulario ? "" : `<button type="button" class="arm-principal" data-accion="nuevo">+ Nuevo armado</button>`}
            </header>
            ${formulario ? formularioHtml() : ""}
            <div class="arm-lista">${armados.length ? armados.map(tarjeta).join("") : (formulario ? "" : `<p class="arm-vacio">Todavía no tienes armados. Crea uno: elige el producto a granel, la bolsita y cuánto granel lleva cada una.</p>`)}</div>
            ${extrasHtml()}
            ${historial.length ? `<section class="arm-historial"><h3>Últimos armados</h3>${historial.slice(0, 6).map(h => `<div class="arm-fila-hist"><span><b>${cantidad(h.unidades)}</b> ${esc(h.destino_nombre || "")} · usó ${cantidad(h.origen_usado)} de ${esc(h.origen_nombre || "granel")}${h.usuario_nombre ? ` · ${esc(h.usuario_nombre)}` : ""}${h.deshecho_at ? " · <i>deshecho</i>" : ""}</span>${h.se_puede_deshacer ? `<button type="button" data-accion="deshacer" data-id="${h.id}">Deshacer</button>` : ""}</div>`).join("")}</section>` : ""}
        </div>`;

        enlazar(raiz);
    }

    function pintarResultados(rol, texto) {
        const caja = document.getElementById(`armRes-${rol}`);
        if (!caja) return;

        const buscado = texto.trim().toLowerCase();
        const otro = rol === "origen" ? formulario.destino : formulario.origen;
        const lista = buscado.length < 2 ? [] : (productos || []).filter(p => p.id !== otro?.id && `${p.nombre} ${p.codigo || ""}`.toLowerCase().includes(buscado)).slice(0, 8);

        caja.innerHTML = lista.map(p => `<button type="button" data-elegir="${rol}" data-pid="${p.id}">${esc(p.nombre)} <small>${esc(unidadDe(p))}</small></button>`).join("")
            || (buscado.length >= 2 ? `<p class="arm-ayuda">No hay productos con ese nombre.</p>` : "");

        caja.querySelectorAll("[data-elegir]").forEach(boton => {
            boton.onclick = () => {
                leerCampos();
                formulario[rol] = (productos || []).find(p => String(p.id) === boton.dataset.pid) || null;
                pintar();
            };
        });
    }

    function leerCampos() {
        if (!formulario) return;
        const valor = id => document.getElementById(id)?.value ?? "";
        if (document.getElementById("armCantidad")) { formulario.cantidad = valor("armCantidad"); formulario.merma = valor("armMerma"); formulario.extra = valor("armExtra"); }
    }

    function actualizarGasto() {
        const a = armados.find(x => x.id === armando);
        const caja = document.getElementById("armGasto");
        const n = Number(document.getElementById("armUnidades")?.value);

        if (!a || !caja) return;

        if (!(n > 0)) { caja.textContent = ""; return; }

        const necesario = Math.round(n * a.cantidadOrigen * (1 + a.mermaPct / 100) * 1000) / 1000;
        caja.textContent = `Gastará ${cantidad(necesario)} ${unidadDe({ unidad_venta: a.origenUnidad })} de ${a.origenNombre}${necesario > a.origenExistencia ? " — no alcanza" : ""}.`;
        caja.classList.toggle("arm-mal", necesario > a.origenExistencia);
    }

    async function confirmarArmar(id) {
        const error = document.getElementById("armError");
        const unidades = Number(document.getElementById("armUnidades")?.value);

        if (!(unidades > 0)) { if (error) error.textContent = "Escribe cuántas armaste."; return; }

        const { ok, datos } = await llamar(`/armados/${id}/armar`, {
            method: "POST",
            body: JSON.stringify({ unidades, caducidad: document.getElementById("armCaducidad")?.value || "", usuarioNombre: (typeof usuarioActual !== "undefined" && usuarioActual?.nombre) || "" })
        });

        if (!ok) { if (error) error.textContent = datos.error || "No se pudo armar."; return; }

        armando = null;
        await cargar();
        pintar();
    }

    async function guardarFormulario() {
        leerCampos();
        const error = document.getElementById("armErrorForm");
        const f = formulario;

        if (!f.origen || !f.destino) { error.textContent = "Elige el producto a granel y el que armas."; return; }

        const { ok, datos } = await llamar("/armados", {
            method: "PUT",
            body: JSON.stringify({ origenId: f.origen.id, destinoId: f.destino.id, cantidadOrigen: f.cantidad, mermaPct: f.merma, costoExtra: f.extra })
        });

        if (!ok) { error.textContent = datos.error || "No se pudo guardar."; return; }

        formulario = null;
        await cargar();
        pintar();
    }


    // ------------------------------------------------------------ extras rapidos

    function extrasHtml() {
        const ids = Object.keys(extrasMapa);
        const filas = ids.map(id => `<div class="arm-extra-fila"><b>${esc(extrasBases[id] || "Producto")}</b>${extrasMapa[id].map(e => `<span class="arm-chip">${esc(e.nombre)} ${dinero(e.precio)}<button type="button" data-accion="extra-quitar" data-base="${id}" data-extra="${e.id}" aria-label="Quitar ${esc(e.nombre)}">×</button></span>`).join("")}</div>`).join("");

        const formularioExtras = formExtras ? `<div class="arm-form">
            <h3>Agregar extras</h3>
            <div class="arm-campo" data-rol="xbase"><label>Producto</label>${formExtras.base ? `<div class="arm-elegido"><span>${esc(formExtras.base.nombre)}</span><button type="button" data-accion="extra-cambiar-base">Cambiar</button></div>` : `<input type="search" data-buscar-extra="xbase" placeholder="Producto al que se le ofrecen (churros bolsita)" autocomplete="off"><div class="arm-resultados" id="armRes-xbase"></div>`}</div>
            <div class="arm-campo" data-rol="xextra"><label>Extras que se le ofrecen</label>${formExtras.nuevos.length ? `<div>${formExtras.nuevos.map(e => `<span class="arm-chip">${esc(e.nombre)}<button type="button" data-accion="extra-sacar" data-extra="${e.id}" aria-label="Quitar ${esc(e.nombre)}">×</button></span>`).join(" ")}</div>` : ""}<input type="search" data-buscar-extra="xextra" placeholder="Salsa, limón, bolsa…" autocomplete="off"><div class="arm-resultados" id="armRes-xextra"></div></div>
            <p class="arm-ayuda">Cada extra es un producto normal de tu inventario, con su precio. Si todavía no existe (por ejemplo "Salsa"), agrégalo primero en Agregar producto.</p>
            <p class="arm-error" id="armErrorExtras" role="alert"></p>
            <div class="arm-acciones"><button type="button" data-accion="extra-cancelar">Cancelar</button><button type="button" class="arm-principal" data-accion="extra-guardar">Guardar</button></div>
        </div>` : "";

        return `<section class="arm-extras"><h3>Extras rápidos</h3>
            <p class="arm-ayuda">Lo que casi siempre se agrega a un producto. Al venderlo salen fichas (“+ Salsa $2”) y un toque las suma.</p>
            ${filas || (formExtras ? "" : `<p class="arm-vacio">Todavía no hay extras.</p>`)}
            ${formularioExtras}
            ${formExtras ? "" : `<div class="arm-acciones"><button type="button" data-accion="extra-nuevo">+ Agregar extras a un producto</button></div>`}
        </section>`;
    }

    function pintarResultadosExtras(rol, texto) {
        const caja = document.getElementById(`armRes-${rol}`);
        if (!caja) return;

        const buscado = texto.trim().toLowerCase();
        const ya = new Set([formExtras.base?.id, ...formExtras.nuevos.map(e => e.id)]);
        const lista = buscado.length < 2 ? [] : (productos || []).filter(p => !ya.has(p.id) && `${p.nombre} ${p.codigo || ""}`.toLowerCase().includes(buscado)).slice(0, 8);

        caja.innerHTML = lista.map(p => `<button type="button" data-elegir-extra="${rol}" data-pid="${p.id}">${esc(p.nombre)} <small>${dinero(p.precio)}</small></button>`).join("")
            || (buscado.length >= 2 ? `<p class="arm-ayuda">No hay productos con ese nombre.</p>` : "");

        caja.querySelectorAll("[data-elegir-extra]").forEach(boton => {
            boton.onclick = () => {
                const elegido = (productos || []).find(p => String(p.id) === boton.dataset.pid);
                if (!elegido) return;
                if (rol === "xbase") formExtras.base = elegido; else formExtras.nuevos.push(elegido);
                pintar();
            };
        });
    }

    async function guardarExtras(baseId, ids) {
        return llamar(`/extras/${baseId}`, { method: "PUT", body: JSON.stringify({ extraIds: ids }) });
    }

    // Devuelve true si la accion era de extras (y ya la atendio).
    async function accionExtras(accion, boton) {
        if (accion === "extra-nuevo") { await cargarProductos(); formExtras = { base: null, nuevos: [] }; pintar(); return true; }
        if (accion === "extra-cancelar") { formExtras = null; pintar(); return true; }
        if (accion === "extra-cambiar-base") { formExtras.base = null; pintar(); return true; }
        if (accion === "extra-sacar") { formExtras.nuevos = formExtras.nuevos.filter(e => String(e.id) !== boton.dataset.extra); pintar(); return true; }

        if (accion === "extra-guardar") {
            const error = document.getElementById("armErrorExtras");

            if (!formExtras.base || !formExtras.nuevos.length) { error.textContent = "Elige el producto y al menos un extra."; return true; }

            const actuales = (extrasMapa[formExtras.base.id] || []).map(e => e.id);
            const { ok, datos } = await guardarExtras(formExtras.base.id, [...new Set([...actuales, ...formExtras.nuevos.map(e => e.id)])]);

            if (!ok) { error.textContent = datos.error || "No se pudo guardar."; return true; }

            formExtras = null;
            await cargar();
            pintar();
            return true;
        }

        if (accion === "extra-quitar") {
            const restantes = (extrasMapa[boton.dataset.base] || []).map(e => e.id).filter(id => String(id) !== boton.dataset.extra);
            await guardarExtras(boton.dataset.base, restantes);
            await cargar();
            pintar();
            return true;
        }

        return false;
    }

    function enlazar(raiz) {
        raiz.querySelectorAll("[data-accion]").forEach(boton => {
            boton.onclick = async () => {
                const accion = boton.dataset.accion;
                const id = Number(boton.dataset.id);

                if (await accionExtras(accion, boton)) return;

                if (accion === "nuevo") { await cargarProductos(); formulario = { origen: null, destino: null, cantidad: "", merma: "", extra: "" }; pintar(); }
                else if (accion === "cancelar-form") { formulario = null; pintar(); }
                else if (accion === "guardar-form") await guardarFormulario();
                else if (accion === "cambiar") { leerCampos(); formulario[boton.dataset.rol] = null; pintar(); }
                else if (accion === "armar") { armando = id; pintar(); document.getElementById("armUnidades")?.focus(); }
                else if (accion === "cancelar-armar") { armando = null; pintar(); }
                else if (accion === "confirmar-armar") await confirmarArmar(id);
                else if (accion === "editar") {
                    await cargarProductos();
                    const a = armados.find(x => x.id === id);
                    formulario = { id, origen: (productos || []).find(p => p.id === a.origenId) || { id: a.origenId, nombre: a.origenNombre, unidad_venta: a.origenUnidad }, destino: (productos || []).find(p => p.id === a.destinoId) || { id: a.destinoId, nombre: a.destinoNombre }, cantidad: a.cantidadOrigen, merma: a.mermaPct || "", extra: a.costoExtra || "" };
                    pintar();
                } else if (accion === "quitar") {
                    const a = armados.find(x => x.id === id);
                    const confirmado = typeof confirmarPOS === "function" ? await confirmarPOS(`¿Quitar el armado de ${a?.destinoNombre}? Los productos no se borran.`) : window.confirm("¿Quitar este armado?");
                    if (confirmado) { await llamar(`/armados/${id}`, { method: "DELETE" }); await cargar(); pintar(); }
                } else if (accion === "deshacer") {
                    const { ok, datos } = await llamar(`/armados/historial/${id}/deshacer`, { method: "POST" });
                    if (!ok && typeof mostrarToastPOS === "function") mostrarToastPOS(datos.error || "No se pudo deshacer.");
                    else if (!ok) window.alert(datos.error || "No se pudo deshacer.");
                    await cargar();
                    pintar();
                }
            };
        });

        raiz.querySelectorAll("[data-buscar]").forEach(campo => {
            campo.oninput = () => pintarResultados(campo.dataset.buscar, campo.value);
        });

        raiz.querySelectorAll("[data-buscar-extra]").forEach(campo => {
            campo.oninput = () => pintarResultadosExtras(campo.dataset.buscarExtra, campo.value);
        });

        raiz.querySelectorAll("[data-unidades]").forEach(boton => {
            boton.onclick = () => { const campo = document.getElementById("armUnidades"); campo.value = boton.dataset.unidades; actualizarGasto(); campo.focus(); };
        });

        const unidades = document.getElementById("armUnidades");
        if (unidades) unidades.oninput = actualizarGasto;
    }
})();
