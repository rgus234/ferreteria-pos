/* Mapa de la tienda en el celular: pasillos/estantes de la tienda y secciones de la bodega, cada uno con su QR para imprimir.
   Un producto puede estar exhibido en un estante Y guardado en la bodega. Usa /ubicaciones (ubicaciones-server.js). */

(function () {
    const TIPOS_TIENDA = [["pasillo", "Pasillo"], ["estante", "Estante"], ["nivel", "Nivel"]];
    const TIPOS_BODEGA = [["seccion", "Sección"], ["rack", "Rack"], ["nivel", "Nivel"]];

    let lugares = [];
    let capa = null;
    let abierto = null; // lugar con su detalle abierto
    let formulario = null; // { zona, tipo, padreId }

    const esc = valor => (typeof escaparDueno === "function" ? escaparDueno(valor) : String(valor ?? ""));

    async function llamar(ruta, opciones = {}) {
        try {
            const cuerpo = opciones.body ? { body: JSON.stringify(opciones.body), headers: { "Content-Type": "application/json" } } : {};
            return { ok: true, datos: await fetchAutenticado(ruta, { method: opciones.method || "GET", ...cuerpo }) || {} };
        } catch (error) {
            return { ok: false, estado: error.status, datos: error.datos || { error: error.message } };
        }
    }

    function insertarEntrada() {
        const destino = document.getElementById("duenoMasStatusCard");
        if (!destino || document.getElementById("dmEntrada") || !(typeof haySesionActivaDueno === "function" && haySesionActivaDueno())) return;

        const boton = document.createElement("button");
        boton.type = "button";
        boton.id = "dmEntrada";
        boton.className = "dm-entrada";
        boton.innerHTML = `<span aria-hidden="true">🗺️</span><b>Mapa de la tienda</b><small>Pasillos, estantes y bodega con su código QR</small>`;
        boton.addEventListener("click", abrir);
        destino.insertAdjacentElement("afterend", boton);
    }

    const original = window.cargarPanelMasDueno;

    if (typeof original === "function") {
        window.cargarPanelMasDueno = async function (...argumentos) {
            const resultado = await original.apply(this, argumentos);
            insertarEntrada();
            return resultado;
        };
    }

    function obtenerCapa() {
        if (!capa) {
            capa = document.createElement("div");
            capa.id = "dmCapa";
            capa.className = "dm-capa";
            document.body.appendChild(capa);
        }

        capa.classList.add("abierta");
        return capa;
    }

    window.dmCerrar = function () {
        if (abierto || formulario) { abierto = null; formulario = null; pintar(); } else capa?.classList.remove("abierta");
    };

    async function abrir() {
        abierto = null;
        formulario = null;
        obtenerCapa().innerHTML = cabecera("Mapa de la tienda") + `<main class="dm-cuerpo"><p class="dm-nota">Cargando...</p></main>`;
        await recargar();
    }

    async function recargar() {
        const r = await llamar("/ubicaciones");

        if (!r.ok) { capa.querySelector(".dm-cuerpo").innerHTML = `<p class="dm-nota">${esc(r.datos.error || "No se pudo cargar. Revisa tu internet.")}</p>`; return; }

        lugares = r.datos.ubicaciones || [];
        pintar();
    }

    function cabecera(titulo) {
        return `<header class="dm-cabecera"><button type="button" class="dm-icono" onclick="dmCerrar()" aria-label="Atrás">&larr;</button><h2>${esc(titulo)}</h2><span class="dm-icono dm-vacio"></span></header>`;
    }

    // Lista plana en orden de arbol: cada lugar debajo de su padre.
    function arbol(zona) {
        const hijos = padre => lugares.filter(l => l.zona === zona && (l.padreId || null) === padre);
        const salida = [];
        const recorrer = (padre, nivel) => hijos(padre).forEach(l => { salida.push({ ...l, nivel }); recorrer(l.id, nivel + 1); });
        recorrer(null, 0);
        return salida;
    }

    function pintar() {
        const c = obtenerCapa();

        if (formulario) return pintarFormulario(c);
        if (abierto) return pintarDetalle(c);

        const bloque = (zona, titulo, vacio) => {
            const lista = arbol(zona);
            return `<section class="dm-zona dm-${zona}"><div class="dm-zona-cab"><h3>${titulo}</h3><button type="button" onclick="dmNuevo('${zona}')">+ Agregar</button></div>
            ${lista.map(l => `<button type="button" class="dm-lugar" style="margin-left:${Math.min(l.nivel, 3) * 16}px" onclick="dmAbrir(${l.id})"><span><b>${esc(l.nombre)}</b><small>${esc(l.tipo)}</small></span><em>${l.productos || 0}</em></button>`).join("") || `<p class="dm-nota">${vacio}</p>`}</section>`;
        };

        c.innerHTML = cabecera("Mapa de la tienda") + `<main class="dm-cuerpo">
            <p class="dm-nota">Crea tus pasillos y estantes, imprime su etiqueta, pégala y escanéala para acomodar o buscar productos.</p>
            <div class="dm-acciones"><button type="button" onclick="dmEscanear()">📷 Escanear un estante</button>${lugares.length ? `<button type="button" onclick="dmImprimir()">🖨️ Imprimir todas</button>` : ""}</div>
            ${bloque("tienda", "Tienda", "Aún no tienes pasillos ni estantes.")}
            ${bloque("bodega", "Bodega", "Aún no tienes secciones de bodega.")}
        </main>`;
    }

    // ---- Alta de un lugar ----

    window.dmNuevo = function (zona, padreId = null) {
        formulario = { zona, tipo: zona === "bodega" ? "seccion" : "pasillo", padreId };
        pintar();
    };

    function pintarFormulario(c) {
        const tipos = formulario.zona === "bodega" ? TIPOS_BODEGA : TIPOS_TIENDA;
        const posibles = lugares.filter(l => l.zona === formulario.zona);

        c.innerHTML = cabecera(formulario.zona === "bodega" ? "Nuevo lugar de bodega" : "Nuevo lugar de la tienda") + `<main class="dm-cuerpo">
            <label class="dm-campo">Qué es<select id="dmTipo" onchange="dmTipoElegido(this.value)">${tipos.map(([v, t]) => `<option value="${v}" ${formulario.tipo === v ? "selected" : ""}>${t}</option>`).join("")}</select></label>
            <label class="dm-campo">Nombre<input id="dmNombre" type="text" maxlength="60" placeholder="Ej. Estante 3 o Pasillo tornillos" autocomplete="off"></label>
            <label class="dm-campo">Dentro de<select id="dmPadre"><option value="">(nada, va solo)</option>${posibles.map(l => `<option value="${l.id}" ${formulario.padreId === l.id ? "selected" : ""}>${esc(l.ruta)}</option>`).join("")}</select></label>
            <p id="dmError" class="dm-error"></p>
            <button type="button" class="dm-grande" onclick="dmGuardarNuevo()">Guardar</button>
        </main>`;
    }

    window.dmTipoElegido = function (tipo) { formulario.tipo = tipo; };

    window.dmGuardarNuevo = async function () {
        const nombre = document.getElementById("dmNombre").value.trim();
        const error = document.getElementById("dmError");

        if (!nombre) { error.textContent = "Escribe un nombre."; return; }

        const padre = document.getElementById("dmPadre").value;
        const r = await llamar("/ubicaciones", { method: "POST", body: { nombre, zona: formulario.zona, tipo: formulario.tipo, padreId: padre ? Number(padre) : null } });

        if (!r.ok) { error.textContent = r.datos.error || "No se pudo guardar."; return; }

        formulario = null;
        await recargar();
    };

    // ---- Detalle de un lugar ----

    window.dmAbrir = async function (id) {
        const lugar = lugares.find(l => l.id === id);
        if (!lugar) return;

        abierto = { ...lugar, productos: [], cargando: true };
        pintar();

        const r = await llamar(`/ubicaciones/${id}/productos`);

        if (abierto?.id === id) { abierto.productos = r.ok ? r.datos.productos || [] : []; abierto.cargando = false; pintar(); }
    };

    function pintarDetalle(c) {
        const l = abierto;

        c.innerHTML = cabecera(l.nombre) + `<main class="dm-cuerpo">
            <div class="dm-ficha dm-${l.zona}"><small>${esc(l.ruta)}</small><b class="dm-codigo">${esc(l.codigo)}</b></div>
            <div class="dm-acciones"><button type="button" onclick="dmImprimir(${l.id})">🖨️ Imprimir etiqueta</button><button type="button" onclick="dmNuevo('${l.zona}', ${l.id})">+ Dentro de este</button></div>
            <div class="dm-acciones"><button type="button" onclick="dmRenombrar()">✏️ Cambiar nombre</button><button type="button" class="dm-peligro" onclick="dmBorrar()">Borrar</button></div>
            <h3 class="dm-titulo">Productos aquí (${l.productos.length})</h3>
            <input id="dmBuscar" class="dm-buscar" type="search" placeholder="Buscar producto para ponerlo aquí" oninput="dmBuscarProducto(this.value)" autocomplete="off">
            <div id="dmResultados" class="dm-lista"></div>
            <div class="dm-lista">${l.cargando ? `<p class="dm-nota">Cargando...</p>` : l.productos.map(p => `<div class="dm-producto"><span><b>${esc(p.nombre)}</b><small>${p.exhibido ? "Exhibido" : "Bodega"} · ${p.stock} ${esc(p.unidadVenta || "pza")}</small></span></div>`).join("") || `<p class="dm-nota">Todavía no hay productos en este lugar.</p>`}</div>
        </main>`;
    }

    window.dmBuscarProducto = async function (texto) {
        const caja = document.getElementById("dmResultados");
        const hallados = typeof buscarEnCatalogoLocal === "function" && String(texto).trim().length >= 2 ? await buscarEnCatalogoLocal(texto) : [];

        caja.innerHTML = hallados.map(p => `<button type="button" class="dm-producto dm-poner" onclick="dmPoner(${p.id})"><span><b>${esc(p.nombre)}</b><small>${esc(p.ubicacion || "sin lugar")}</small></span><em>Poner aquí</em></button>`).join("");
    };

    window.dmPoner = async function (productoId) {
        const r = await llamar(`/ubicaciones/${abierto.id}/asignar`, { method: "POST", body: { productoIds: [productoId] } });

        if (!r.ok) { alert(r.datos.error || "No se pudo poner el producto."); return; }

        if (typeof refrescarCatalogoLocalDueno === "function") refrescarCatalogoLocalDueno().catch(() => {});

        const id = abierto.id;
        await recargar();
        window.dmAbrir(id);
    };

    window.dmRenombrar = async function () {
        const nombre = (prompt("Nuevo nombre", abierto.nombre) || "").trim();

        if (!nombre || nombre === abierto.nombre) return;

        const r = await llamar(`/ubicaciones/${abierto.id}`, { method: "PATCH", body: { nombre } });

        if (!r.ok) { alert(r.datos.error || "No se pudo cambiar."); return; }

        const id = abierto.id;
        await recargar();
        window.dmAbrir(id);
    };

    window.dmBorrar = async function () {
        let r = await llamar(`/ubicaciones/${abierto.id}`, { method: "DELETE" });

        if (!r.ok && r.estado === 409) {
            if (!confirm(`${r.datos.error || "Este lugar tiene productos."}\nLos productos NO se borran, solo se quedan sin este lugar. ¿Borrar?`)) return;
            r = await llamar(`/ubicaciones/${abierto.id}?confirmar=1`, { method: "DELETE" });
        }

        if (!r.ok) { alert(r.datos.error || "No se pudo borrar."); return; }

        abierto = null;
        await recargar();
    };

    // ---- Escanear un estante: abre su detalle ----

    window.dmEscanear = function () {
        if (typeof abrirEscanerCodigoDueno !== "function") return;

        abrirEscanerCodigoDueno({
            titulo: "Escanea la etiqueta del estante",
            alCodigo: async codigo => {
                const r = await llamar(`/ubicaciones/codigo/${encodeURIComponent(String(codigo).trim())}`);

                if (!r.ok) { alert("Ese código no es de ningún estante de tu tienda."); return; }

                window.dmAbrir(r.datos.ubicacion.id);
            }
        });
    };

    // ---- Etiquetas con QR (PDF) ----

    window.dmImprimir = async function (id = null) {
        const r = await llamar("/ubicaciones/etiquetas", { method: "POST", body: id ? { ids: [id] } : {} });

        if (!r.ok) { alert(r.datos.error || "No se pudo preparar la hoja."); return; }

        const bytes = Uint8Array.from(atob(r.datos.pdfBase64), ch => ch.charCodeAt(0));
        const url = URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));

        window.open(url, "_blank") || (location.href = url);
        setTimeout(() => URL.revokeObjectURL(url), 120000);
    };
})();
