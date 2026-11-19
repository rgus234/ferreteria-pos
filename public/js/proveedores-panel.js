/* Proveedores (diseño nuevo, funcion beta "proveedores_nuevo"): tarjetas con lo util de cada proveedor y una ficha con pestañas.
   Si la funcion esta apagada, la pantalla de siempre no cambia. Solo lee datos (GET /proveedores/panel y /proveedores/:id/ficha);
   editar, dar de baja y reactivar usan las mismas funciones de antes. */
(function () {
    if (typeof renderProveedores !== "function") return;

    const original = { render: window.renderProveedores, cargar: window.cargarProveedores };
    let panel = null;
    let cargandoPanel = false;
    let filtro = "todos";
    let texto = "";

    const esc = v => String(v ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
    const money = v => (typeof dinero === "function" ? dinero(v) : "$" + Number(v || 0).toFixed(2));
    const activa = () => typeof window.funcionBeta === "function" && window.funcionBeta("proveedores_nuevo");
    const llave = p => String(p.nombre || "").trim().toLowerCase();
    const datosDe = p => (panel && panel[llave(p)]) || {};

    function hace(fecha) {
        if (!fecha) return "";
        const dias = Math.floor((Date.now() - new Date(fecha).getTime()) / 86400000);
        if (dias <= 0) return "hoy";
        if (dias === 1) return "ayer";
        if (dias < 30) return dias + " días";
        if (dias < 365) return Math.round(dias / 30) + (Math.round(dias / 30) === 1 ? " mes" : " meses");
        return "+1 año";
    }
    function fechaCorta(f) { return f ? new Date(String(f).slice(0, 10) + "T12:00:00").toLocaleDateString("es-MX", { day: "numeric", month: "short" }) : ""; }
    function diasPara(f) { return f ? Math.round((new Date(String(f).slice(0, 10) + "T12:00:00").getTime() - Date.now()) / 86400000) : null; }
    function telefonoWa(t) { const n = String(t || "").replace(/\D/g, ""); return n.length === 10 ? "52" + n : n; }

    function contenedor() {
        const shell = document.querySelector("#pantallaProveedores .proveedores-shell");
        if (!shell) return null;
        let caja = document.getElementById("provPanel");
        if (!caja) { caja = document.createElement("div"); caja.id = "provPanel"; caja.className = "pp"; shell.appendChild(caja); }
        return caja;
    }

    async function cargarPanel() {
        if (cargandoPanel) return;
        cargandoPanel = true;
        try {
            const r = await fetch("/proveedores/panel");
            const d = await r.json();
            panel = d && d.ok ? d.por : {};
        } catch (e) { panel = {}; }
        cargandoPanel = false;
        pintar();
    }

    function lista() {
        const t = texto.trim().toLowerCase();
        return (window.proveedores || (typeof proveedores !== "undefined" ? proveedores : [])).filter(p => {
            const d = datosDe(p);
            if (filtro === "adeudo" && !(d.debe > 0)) return false;
            if (filtro === "sincontacto" && (p.telefono || p.correo)) return false;
            if (filtro === "nofactura" && !p.no_da_factura) return false;
            if (!t) return true;
            return [p.nombre, p.contacto, p.telefono, p.correo].some(c => String(c || "").toLowerCase().includes(t));
        });
    }

    function tarjeta(p, estadoBaja) {
        const d = datosDe(p);
        const tel = p.telefono, wa = telefonoWa(tel);
        const dias = diasPara(d.vence);
        const venceTxt = d.debe > 0 ? (d.vencidas > 0 ? "Vencido" : dias !== null ? (dias <= 0 ? "Vence hoy" : "Vence " + fechaCorta(d.vence)) : "") : "";
        const chips = [];
        if (p.dias_credito != null && p.dias_credito !== "") chips.push("Crédito " + Number(p.dias_credito) + " días");
        if (p.dia_visita) chips.push("Pasa " + esc(p.dia_visita));
        const productos = Number(p.productos || 0);
        return `<article class="pp-card${estadoBaja ? " pp-baja" : ""}" data-id="${p.id}" tabindex="0">
            <header class="pp-card-cab">
                <span class="pp-avatar">${esc(String(p.nombre || "?").trim().charAt(0).toUpperCase())}</span>
                <div class="pp-card-nombre"><b>${esc(p.nombre)}</b>
                    <span>${p.no_da_factura ? `<i class="pp-etiqueta">No da factura</i>` : ""}${chips.map(c => `<i class="pp-chip">${c}</i>`).join("")}</span></div>
                <button type="button" class="pp-mas" data-mas="${p.id}" aria-label="Más opciones">⋯</button>
            </header>
            <div class="pp-contacto">
                ${p.contacto ? `<span>${esc(p.contacto)}</span>` : ""}
                ${tel ? `<span>${esc(tel)}</span>` : ""}
                ${p.correo ? `<span>${esc(p.correo)}</span>` : ""}
                ${!p.contacto && !tel && !p.correo ? `<button type="button" class="pp-enlace" data-editar="${p.id}">+ Agregar contacto</button>` : ""}
            </div>
            <div class="pp-datos">
                <div><small>Productos</small><b>${productos}</b></div>
                <div><small>Última compra</small><b>${d.ultima_compra ? hace(d.ultima_compra) : "—"}</b></div>
                <div class="${d.debe > 0 ? (d.vencidas > 0 ? "pp-rojo" : "pp-ambar") : ""}"><small>Le debes</small><b>${d.debe > 0 ? money(d.debe) : "$0"}</b>${venceTxt ? `<em>${venceTxt}</em>` : ""}</div>
            </div>
            ${d.pedidos_abiertos ? `<p class="pp-aviso">${d.pedidos_abiertos} pedido${d.pedidos_abiertos > 1 ? "s" : ""} por recibir</p>` : ""}
            <footer class="pp-card-pie">
                ${estadoBaja ? `<button type="button" class="pp-btn pp-principal" data-reactivar="${p.id}">Reactivar</button>` : `<button type="button" class="pp-btn pp-principal" data-pedir="${p.id}">Pedir</button>
                ${wa ? `<a class="pp-btn" href="https://wa.me/${wa}" target="_blank" rel="noopener">WhatsApp</a>` : ""}
                ${tel ? `<a class="pp-btn" href="tel:${esc(tel)}">Llamar</a>` : ""}`}
            </footer>
        </article>`;
    }

    function pintar() {
        const caja = contenedor();
        if (!caja) return;
        const todos = window.proveedores || (typeof proveedores !== "undefined" ? proveedores : []);
        const baja = typeof estadoProveedoresActual !== "undefined" && estadoProveedoresActual === "baja";
        if (panel === null) { caja.innerHTML = `<p class="pp-vacio">Cargando…</p>`; cargarPanel(); return; }

        const debeTotal = todos.reduce((s, p) => s + (datosDe(p).debe || 0), 0);
        const semana = todos.reduce((s, p) => { const d = datosDe(p); const dias = diasPara(d.vence); return s + (d.debe > 0 && (d.vencidas > 0 || (dias !== null && dias <= 7)) ? d.debe : 0); }, 0);
        const sinContacto = todos.filter(p => !p.telefono && !p.correo).length;
        const filtrados = lista();
        const chip = (k, t) => `<button type="button" class="pp-filtro${filtro === k ? " activo" : ""}" data-filtro="${k}">${t}</button>`;

        caja.innerHTML = `
            <div class="pp-resumen">
                <div><small>${baja ? "Proveedores de baja" : "Proveedores"}</small><b>${todos.length}</b></div>
                <div class="${debeTotal > 0 ? "pp-ambar" : ""}"><small>Le debes en total</small><b>${money(debeTotal)}</b></div>
                <div class="${semana > 0 ? "pp-rojo" : ""}"><small>Por pagar esta semana</small><b>${money(semana)}</b></div>
                <div><small>Sin contacto</small><b>${sinContacto}</b></div>
            </div>
            <div class="pp-barra">
                <input id="ppBuscar" type="search" placeholder="Buscar proveedor, contacto o teléfono" value="${esc(texto)}" autocomplete="off">
                <div class="pp-filtros">${chip("todos", "Todos")}${chip("adeudo", "Con adeudo")}${chip("sincontacto", "Sin contacto")}${chip("nofactura", "No da factura")}</div>
                <div class="pp-estado"><button type="button" class="pp-filtro${baja ? "" : " activo"}" data-estado="activo">Activos</button><button type="button" class="pp-filtro${baja ? " activo" : ""}" data-estado="baja">De baja</button></div>
            </div>
            <div class="pp-grid">${filtrados.length ? filtrados.map(p => tarjeta(p, baja)).join("") : `<p class="pp-vacio">No hay proveedores para mostrar.</p>`}</div>`;

        const buscador = caja.querySelector("#ppBuscar");
        if (buscador) buscador.addEventListener("input", () => { texto = buscador.value; const pos = buscador.selectionStart; pintar(); const n = document.getElementById("ppBuscar"); if (n) { n.focus(); n.setSelectionRange(pos, pos); } });
    }

    function cerrarMenus() { document.querySelectorAll(".pp-menu").forEach(m => m.remove()); }

    function menuMas(boton, id) {
        cerrarMenus();
        const p = (window.proveedores || proveedores).find(x => Number(x.id) === Number(id));
        if (!p) return;
        const menu = document.createElement("div");
        menu.className = "pp-menu";
        menu.innerHTML = `<button data-a="ficha">Ver ficha</button><button data-a="editar">Editar</button><button data-a="productos">Ver productos</button><button data-a="precios">Reglas de precios</button><button data-a="baja" class="pp-peligro">Dar de baja</button>`;
        const r = boton.getBoundingClientRect();
        menu.style.top = Math.min(r.bottom + 4, window.innerHeight - 230) + "px";
        menu.style.left = Math.max(8, r.right - 190) + "px";
        document.body.appendChild(menu);
        menu.addEventListener("click", e => {
            const a = e.target.dataset && e.target.dataset.a;
            if (!a) return;
            cerrarMenus();
            if (a === "ficha") abrirFicha(id);
            if (a === "editar") editarProveedor(id);
            if (a === "productos") verProductosProveedor(encodeURIComponent(p.nombre));
            if (a === "precios") mostrarReglasPrecios(encodeURIComponent(p.nombre));
            if (a === "baja") desactivarProveedor(id);
        });
    }

    async function pedir(id) {
        if (typeof mostrarPedidoSugerido === "function" && typeof abrirPedidoSugerido === "function") {
            await mostrarPedidoSugerido();
            abrirPedidoSugerido(id);
        }
    }

    // ---------- Ficha con pestañas ----------
    async function abrirFicha(id, pestana) {
        cerrarFicha();
        const fondo = document.createElement("div");
        fondo.className = "pp-fondo";
        fondo.id = "ppFicha";
        fondo.innerHTML = `<aside class="pp-ficha" role="dialog" aria-modal="true"><p class="pp-vacio">Cargando…</p></aside>`;
        document.body.appendChild(fondo);
        fondo.addEventListener("click", e => { if (e.target === fondo) cerrarFicha(); });

        let d = null;
        try { const r = await fetch("/proveedores/" + id + "/ficha"); d = await r.json(); } catch (e) { d = null; }
        if (!d || !d.ok) { fondo.querySelector(".pp-ficha").innerHTML = `<p class="pp-vacio">No se pudo abrir la ficha.</p><button class="pp-btn" data-cerrar>Cerrar</button>`; return; }
        pintarFicha(d, pestana || "resumen");
    }
    function cerrarFicha() { const f = document.getElementById("ppFicha"); if (f) f.remove(); }

    function pintarFicha(d, pestana) {
        const p = d.proveedor, x = datosDe(p), wa = telefonoWa(p.telefono);
        const tab = (k, t) => `<button type="button" class="pp-tab${pestana === k ? " activo" : ""}" data-tab="${k}">${t}</button>`;
        const fila = (a, b, c) => `<div class="pp-fila"><span>${a}</span><span>${b || ""}</span><b>${c || ""}</b></div>`;
        let cuerpo = "";
        if (pestana === "resumen") {
            cuerpo = `<div class="pp-kv"><div><small>Contacto</small><b>${esc(p.contacto || "—")}</b></div><div><small>Teléfono</small><b>${esc(p.telefono || "—")}</b></div><div><small>Correo</small><b>${esc(p.correo || "—")}</b></div>
                <div><small>Días de crédito</small><b>${p.dias_credito != null ? Number(p.dias_credito) + " días" : "Contado"}</b></div><div><small>Día de visita</small><b>${esc(p.dia_visita || "—")}</b></div><div><small>Factura</small><b>${p.no_da_factura ? "No da factura" : "Sí da factura"}</b></div>
                <div><small>Comprado (90 días)</small><b>${money(x.comprado_90d || 0)}</b></div><div><small>Le debes</small><b>${money(x.debe || 0)}</b></div><div><small>Última compra</small><b>${x.ultima_compra ? hace(x.ultima_compra) : "—"}</b></div></div>
                ${p.notas ? `<p class="pp-notas">${esc(p.notas)}</p>` : ""}`;
        } else if (pestana === "productos") {
            cuerpo = d.productos.length ? d.productos.map(pr => fila(esc(pr.nombre), Number(pr.stock) <= Number(pr.stock_minimo || 0) ? `<i class="pp-etiqueta">Bajo: ${Number(pr.stock)}</i>` : "Stock " + Number(pr.stock), money(pr.precio))).join("") + `<button class="pp-btn" data-ir="productos">Ver todos en Inventario</button>` : `<p class="pp-vacio">Todavía no tiene productos ligados.</p>`;
        } else if (pestana === "precios") {
            cuerpo = `<p class="pp-notas">Aquí defines cuánto ganas sobre el costo de lo que le compras a ${esc(p.nombre)}.</p><button class="pp-btn pp-principal" data-ir="precios">Abrir reglas de precios</button>`;
        } else if (pestana === "compras") {
            cuerpo = d.compras.length ? d.compras.map(c => fila(fechaCorta(c.fecha), esc(c.referencia || "Sin referencia"), money(c.total))).join("") : `<p class="pp-vacio">Aún no hay compras registradas.</p>`;
        } else if (pestana === "pagos") {
            cuerpo = (d.cuentas.length ? `<h4>Por pagar</h4>` + d.cuentas.map(c => fila(c.vencimiento ? "Vence " + fechaCorta(c.vencimiento) : "Sin fecha", esc(c.concepto || ""), money(c.saldo))).join("") : "")
                + (d.pagos.length ? `<h4>Pagos hechos</h4>` + d.pagos.map(c => fila(fechaCorta(c.created_at), esc(c.metodo || ""), money(c.monto))).join("") : "")
                || `<p class="pp-vacio">Sin pagos ni cuentas por pagar.</p>`;
        }
        const ficha = document.querySelector("#ppFicha .pp-ficha");
        if (!ficha) return;
        ficha.innerHTML = `<header class="pp-ficha-cab"><span class="pp-avatar">${esc(String(p.nombre || "?").charAt(0).toUpperCase())}</span><div><h3>${esc(p.nombre)}</h3>${p.no_da_factura ? `<i class="pp-etiqueta">No da factura</i>` : ""}</div><button class="pp-x" data-cerrar aria-label="Cerrar">×</button></header>
            <div class="pp-acciones"><button class="pp-btn pp-principal" data-pedir="${p.id}">Pedir</button>${wa ? `<a class="pp-btn" href="https://wa.me/${wa}" target="_blank" rel="noopener">WhatsApp</a>` : ""}<button class="pp-btn" data-editar="${p.id}">Editar</button></div>
            <nav class="pp-tabs">${tab("resumen", "Resumen")}${tab("productos", "Productos")}${tab("precios", "Precios")}${tab("compras", "Compras")}${tab("pagos", "Pagos")}</nav>
            <div class="pp-cuerpo">${cuerpo}</div>`;
        ficha._datos = d;
    }

    // ---------- Eventos (uno solo, delegado) ----------
    document.addEventListener("click", async e => {
        const t = e.target.closest ? e.target : null;
        if (!t) return;
        if (!t.closest(".pp-menu") && !t.closest("[data-mas]")) cerrarMenus();

        const ficha = t.closest("#ppFicha .pp-ficha");
        if (ficha) {
            if (t.closest("[data-cerrar]")) { cerrarFicha(); return; }
            const tab = t.closest("[data-tab]");
            if (tab) { pintarFicha(ficha._datos, tab.dataset.tab); return; }
            const ir = t.closest("[data-ir]");
            if (ir) { const p = ficha._datos.proveedor; cerrarFicha(); if (ir.dataset.ir === "productos") verProductosProveedor(encodeURIComponent(p.nombre)); else mostrarReglasPrecios(encodeURIComponent(p.nombre)); return; }
            const ped = t.closest("[data-pedir]"); if (ped) { cerrarFicha(); pedir(ped.dataset.pedir); return; }
            const ed = t.closest("[data-editar]"); if (ed) { cerrarFicha(); editarProveedor(Number(ed.dataset.editar)); return; }
            return;
        }

        const caja = t.closest("#provPanel");
        if (!caja) return;
        const mas = t.closest("[data-mas]"); if (mas) { e.stopPropagation(); menuMas(mas, mas.dataset.mas); return; }
        const ped = t.closest("[data-pedir]"); if (ped) { pedir(ped.dataset.pedir); return; }
        const rea = t.closest("[data-reactivar]"); if (rea) { reactivarProveedor(Number(rea.dataset.reactivar)); return; }
        const ed = t.closest("[data-editar]"); if (ed) { editarProveedor(Number(ed.dataset.editar)); return; }
        const fil = t.closest("[data-filtro]"); if (fil) { filtro = fil.dataset.filtro; pintar(); return; }
        const est = t.closest("[data-estado]"); if (est) { panel = panel; await cambiarEstadoProveedores(est.dataset.estado); return; }
        if (t.closest("a")) return;
        const card = t.closest(".pp-card"); if (card) abrirFicha(Number(card.dataset.id));
    });
    document.addEventListener("keydown", e => { if (e.key === "Escape") { cerrarFicha(); cerrarMenus(); } });

    // ---------- Enganche con la pantalla de siempre ----------
    window.renderProveedores = function () {
        const shell = document.querySelector("#pantallaProveedores .proveedores-shell");
        const nueva = activa();
        if (shell) shell.classList.toggle("pp-activo", nueva);
        if (!nueva) { original.render(); return; }
        pintar();
    };
    window.cargarProveedores = async function () {
        panel = null;
        await original.cargar();
    };
    document.addEventListener("nexo-funciones-beta", () => {
        const pantalla = document.getElementById("pantallaProveedores");
        if (pantalla && pantalla.style.display !== "none") window.renderProveedores();
    });
})();
