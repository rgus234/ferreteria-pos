/* Mapa de la tienda en el celular: pasillos/estantes de la tienda y secciones de la bodega, cada uno con su QR para imprimir.
   Un producto puede estar exhibido en un estante Y guardado en la bodega. Usa /ubicaciones (ubicaciones-server.js). */

(function () {
    const TIPOS_TIENDA = [["pasillo", "Pasillo"], ["estante", "Estante"], ["nivel", "Nivel"]];
    const TIPOS_BODEGA = [["seccion", "Sección"], ["rack", "Rack"], ["nivel", "Nivel"]];

    let lugares = [];
    let capa = null;
    let abierto = null; // lugar con su detalle abierto
    let formulario = null; // { zona, tipo, padreId }
    let vista = null; // "resurtir" | "conteo"
    let conteo = null; // { lugar, productos, valores, resultado, noEscaneados }
    let resurtir = [];
    let resumen = null;
    let busqueda = { texto: "", productos: [] };

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
        boton.innerHTML = `<span aria-hidden="true">🗺️</span><b>Inventario de tienda</b><small>Escanear, contar, resurtir y saber dónde está cada producto</small>`;
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
        if (vista) { vista = null; conteo = null; pintar(); } else if (abierto || formulario) { abierto = null; formulario = null; pintar(); } else capa?.classList.remove("abierta");
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

        const s = await llamar("/ubicaciones/resumen");

        if (s.ok) { resumen = s.datos; if (!vista && !abierto && !formulario) pintar(); }
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

        if (vista === "resurtir") return pintarResurtir(c);
        if (vista === "buscar") return pintarBusqueda(c);
        if (vista === "conteo") return pintarConteo(c);
        if (formulario) return pintarFormulario(c);
        if (abierto) return pintarDetalle(c);

        const bloque = (zona, titulo, vacio) => {
            const lista = arbol(zona);
            return `<section class="dm-zona dm-${zona}"><div class="dm-zona-cab"><h3>${titulo}</h3><button type="button" onclick="dmNuevo('${zona}')">+ Agregar</button></div>
            ${lista.map(l => `<button type="button" class="dm-lugar" style="margin-left:${Math.min(l.nivel, 3) * 16}px" onclick="dmAbrir(${l.id})"><span><b>${esc(l.nombre)}</b><small>${esc(l.tipo)}</small></span><em>${l.productos || 0}</em></button>`).join("") || `<p class="dm-nota">${vacio}</p>`}</section>`;
        };

        const cifra = (valor, texto, clase = "") => `<div class="dm-dato ${clase}"><strong>${valor ?? "—"}</strong><span>${texto}</span></div>`;

        c.innerHTML = cabecera("Inventario de tienda") + `<main class="dm-cuerpo">
            <div class="dm-datos">
                ${cifra(resumen?.productosConLugar, "productos con lugar")}
                ${cifra(resumen?.ubicaciones ?? lugares.length, "lugares creados")}
                ${cifra(resumen?.productosSinLugar, "sin lugar", resumen?.productosSinLugar ? "aviso" : "")}
                ${cifra(resumen?.porResurtir, "por resurtir", resumen?.agotados ? "alerta" : "")}
            </div>
            <button type="button" class="dm-escanear" onclick="dmEscanear()"><span>📷</span>ESCANEAR UBICACIÓN</button>
            <div class="dm-cuadricula">
                <button type="button" onclick="dmContarEscaneando()"><span>🔢</span>Contar inventario</button>
                <button type="button" onclick="dmBuscarVista()"><span>🔎</span>¿Dónde está?</button>
                <button type="button" onclick="dmResurtir()"><span>🔁</span>Resurtir${resumen?.porResurtir ? ` (${resumen.porResurtir})` : ""}</button>
                <button type="button" onclick="dmImprimir()" ${lugares.length ? "" : "disabled"}><span>🖨️</span>Etiquetas QR</button>
            </div>
            <h3 class="dm-titulo">Organizar tienda</h3>
            ${bloque("tienda", "Tienda", "Aún no tienes pasillos ni estantes.")}
            ${bloque("bodega", "Bodega", "Aún no tienes secciones de bodega.")}
        </main>`;
    }

    // ---- ¿Donde esta? ----

    window.dmBuscarVista = function () { vista = "buscar"; busqueda = { texto: "", productos: [] }; pintar(); setTimeout(() => document.getElementById("dmQ")?.focus(), 50); };

    function pintarBusqueda(c) {
        c.innerHTML = cabecera("¿Dónde está?") + `<main class="dm-cuerpo">
            <input id="dmQ" class="dm-buscar" type="search" placeholder="Nombre o código del producto" oninput="dmBuscarDonde(this.value)" autocomplete="off" value="${esc(busqueda.texto)}">
            <button type="button" class="dm-acciones-uno" onclick="dmBuscarEscaneando()">📷 Buscar escaneando</button>
            <div id="dmDonde" class="dm-lista">${listaDonde()}</div>
        </main>`;
    }

    function listaDonde() {
        return busqueda.productos.map(p => `<article class="dm-tarjeta ${p.total <= 0 ? "agotado" : ""}">
            <b>${esc(p.nombre)}</b>
            <div class="dm-lugar-grande">📍 ${esc(p.ubicacion || "Sin lugar asignado")}</div>
            <div class="dm-cifras"><span>En estante <strong>${p.exhibicion}</strong></span><span>En bodega <strong>${p.bodega}</strong></span><span>Total <strong>${p.total}</strong></span></div>
        </article>`).join("") || (busqueda.texto.length >= 2 ? `<p class="dm-nota">No encontré ese producto.</p>` : `<p class="dm-nota">Escribe el nombre o escanea el código para saber dónde está y cuánto hay.</p>`);
    }

    let temporizadorBusqueda = null;

    window.dmBuscarDonde = function (texto) {
        busqueda.texto = texto.trim();
        clearTimeout(temporizadorBusqueda);
        temporizadorBusqueda = setTimeout(async () => {
            const r = busqueda.texto.length >= 2 ? await llamar(`/ubicaciones/buscar?q=${encodeURIComponent(busqueda.texto)}`) : { ok: true, datos: { productos: [] } };
            busqueda.productos = r.ok ? r.datos.productos || [] : [];
            const caja = document.getElementById("dmDonde");
            if (caja) caja.innerHTML = listaDonde();
        }, 300);
    };

    window.dmBuscarEscaneando = function () {
        if (typeof abrirEscanerCodigoDueno !== "function") return;

        abrirEscanerCodigoDueno({ titulo: "Escanea el producto", alCodigo: codigo => { busqueda.texto = String(codigo).trim(); pintar(); window.dmBuscarDonde(busqueda.texto); } });
    };

    // Escanear la etiqueta de un estante y entrar directo a contar lo que hay en el.
    window.dmContarEscaneando = function () {
        if (typeof abrirEscanerCodigoDueno !== "function") return;

        abrirEscanerCodigoDueno({
            titulo: "Escanea el estante que vas a contar",
            alCodigo: async codigo => {
                const r = await llamar(`/ubicaciones/codigo/${encodeURIComponent(String(codigo).trim())}`);

                if (!r.ok) { alert("Ese código no es de ningún estante de tu tienda."); return; }

                await window.dmAbrir(r.datos.ubicacion.id);
                window.dmContar();
            }
        });
    };

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
            <div class="dm-acciones"><button type="button" onclick="dmContar()">🔢 Contar este lugar</button><button type="button" onclick="dmRenombrar()">✏️ Cambiar nombre</button><button type="button" class="dm-peligro" onclick="dmBorrar()">Borrar</button></div>
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

        if (abierto.zona === "bodega") {
            const texto = prompt("¿Cuántas piezas hay en esta sección de bodega?", "0");
            const cantidad = Number(texto);

            if (texto !== null && cantidad >= 0) {
                const g = await llamar(`/ubicaciones/${abierto.id}/bodega`, { method: "POST", body: { productoId, cantidad } });
                if (!g.ok) alert(g.datos.error || "No se pudo anotar la cantidad.");
            }
        }

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
    // ---- Resurtir: de la bodega a la exhibicion ----

    window.dmResurtir = async function () {
        vista = "resurtir";
        obtenerCapa().innerHTML = cabecera("Resurtir de bodega") + `<main class="dm-cuerpo"><p class="dm-nota">Cargando...</p></main>`;

        const r = await llamar("/resurtir");
        resurtir = r.ok ? r.datos.productos || [] : [];
        pintar();
    };

    function pintarResurtir(c) {
        c.innerHTML = cabecera("Resurtir de bodega") + `<main class="dm-cuerpo">
            <p class="dm-nota">Productos que se acabaron (o van a acabarse) en el estante y todavía tienes en bodega.</p>
            ${resurtir.map(p => `<article class="dm-tarjeta ${p.estado}">
                <b>${esc(p.nombre)}</b>
                <div class="dm-cifras"><span>Estante <strong>${p.exhibicion}</strong></span><span>Bodega <strong>${p.bodega}</strong></span></div>
                <small>${p.estado === "agotado" ? "Se acabó en el estante" : "Queda poco en el estante"}${p.estante ? " · va en " + esc(p.estante) : ""}</small>
                ${p.lugaresBodega.map(l => `<div class="dm-pasar"><span>${esc(l.ruta)}: ${l.cantidad}</span><input type="number" inputmode="decimal" min="0" max="${l.cantidad}" value="${l.cantidad}" id="dmP${p.productoId}_${l.ubicacionId}"><button type="button" onclick="dmPasar(${p.productoId}, ${l.ubicacionId})">Pasar</button></div>`).join("")}
            </article>`).join("") || `<p class="dm-nota">Nada por resurtir. Todo lo que tienes en bodega todavía se ve en el estante. ✅</p>`}
        </main>`;
    }

    window.dmPasar = async function (productoId, desdeId) {
        const cantidad = Number(document.getElementById(`dmP${productoId}_${desdeId}`)?.value);

        if (!(cantidad > 0)) { alert("Escribe cuántas piezas pasas al estante."); return; }

        const r = await llamar("/resurtir", { method: "POST", body: { productoId, desdeId, cantidad } });

        if (!r.ok) { alert(r.datos.error || "No se pudo pasar."); return; }

        window.dmResurtir();
    };

    // ---- Conteo de un estante o seccion ----

    window.dmContar = function () {
        conteo = { lugar: abierto, productos: abierto.productos, valores: {}, resultado: null, noEscaneados: false };
        vista = "conteo";
        pintar();
    };

    function pintarConteo(c) {
        const k = conteo;

        if (k.resultado) {
            const r = k.resultado;
            c.innerHTML = cabecera("Resultado del conteo") + `<main class="dm-cuerpo">
                <div class="dm-resumen"><div class="dm-falta"><strong>${r.faltan}</strong><span>faltan</span></div><div class="dm-sobra"><strong>${r.sobran}</strong><span>sobran</span></div></div>
                <div class="dm-lista">${r.lineas.map(l => `<div class="dm-producto"><span><b>${esc(l.nombre)}</b><small>${l.noEscaneado && !k.noEscaneados ? "No lo contaste (no cambia)" : `Esperado ${l.esperado} · contaste ${l.contado}`}</small></span><em class="dm-dif ${l.diferencia < 0 ? "neg" : l.diferencia > 0 ? "pos" : ""}">${l.diferencia > 0 ? "+" : ""}${l.diferencia}</em></div>`).join("")}</div>
                <label class="dm-check"><input type="checkbox" ${k.noEscaneados ? "checked" : ""} onchange="dmConteoNoEscaneados(this.checked)"> Lo que no conté es que ya no hay (contarlo como 0)</label>
                <button type="button" class="dm-grande" onclick="dmConteoAplicar()">Aplicar ajuste</button>
                <button type="button" class="dm-secundario" onclick="dmConteoSeguir()">Seguir contando</button>
            </main>`;
            return;
        }

        c.innerHTML = cabecera("Contar: " + k.lugar.nombre) + `<main class="dm-cuerpo">
            <p class="dm-nota">Cuenta lo que ves en ${esc(k.lugar.nombre)} y escríbelo. Lo que dejes vacío no se cuenta.</p>
            <div class="dm-acciones"><button type="button" onclick="dmConteoEscanear()">📷 Contar escaneando</button></div>
            <div class="dm-lista">${k.productos.map(p => `<label class="dm-producto"><span><b>${esc(p.nombre)}</b><small>${esc(p.codigo || "")}</small></span><input class="dm-cant" type="number" inputmode="decimal" min="0" data-id="${p.id}" value="${k.valores[p.id] ?? ""}" oninput="dmConteoValor(${p.id}, this.value)" placeholder="—"></label>`).join("") || `<p class="dm-nota">Este lugar no tiene productos. Agrégalos desde su pantalla.</p>`}</div>
            <button type="button" class="dm-grande" onclick="dmConteoVer()">Ver diferencias</button>
        </main>`;
    }

    window.dmConteoValor = function (id, valor) { if (valor === "") delete conteo.valores[id]; else conteo.valores[id] = Number(valor); };

    // Cada escaneo suma una pieza al producto del lugar con ese codigo.
    window.dmConteoEscanear = function () {
        if (typeof abrirEscanerCodigoDueno !== "function") return;

        abrirEscanerCodigoDueno({
            titulo: "Escanea cada pieza",
            continuo: true,
            alCodigo: codigo => {
                const p = conteo.productos.find(x => String(x.codigo) === String(codigo).trim());

                if (!p) return;

                conteo.valores[p.id] = (conteo.valores[p.id] || 0) + 1;
                const campo = document.querySelector(`.dm-cant[data-id="${p.id}"]`);
                if (campo) campo.value = conteo.valores[p.id];
            }
        });
    };

    async function consultarConteo(aplicar) {
        const conteos = Object.entries(conteo.valores).map(([productoId, cantidad]) => ({ productoId: Number(productoId), cantidad }));
        return llamar(`/ubicaciones/${conteo.lugar.id}/conteo`, { method: "POST", body: { conteos, aplicar, incluirNoEscaneados: conteo.noEscaneados } });
    }

    window.dmConteoVer = async function () {
        if (!Object.keys(conteo.valores).length && !confirm("No contaste nada. ¿Ver el resultado de todos modos?")) return;

        const r = await consultarConteo(false);

        if (!r.ok) { alert(r.datos.error || "No se pudo calcular."); return; }

        conteo.resultado = r.datos;
        pintar();
    };

    window.dmConteoNoEscaneados = async function (valor) { conteo.noEscaneados = valor; await window.dmConteoVer(); };
    window.dmConteoSeguir = function () { conteo.resultado = null; pintar(); };

    window.dmConteoAplicar = async function () {
        if (!confirm("Esto cambia las existencias de estos productos y queda registrado. ¿Aplicar?")) return;

        const r = await consultarConteo(true);

        if (!r.ok) { alert(r.datos.error || "No se pudo aplicar."); return; }

        if (typeof refrescarCatalogoLocalDueno === "function") refrescarCatalogoLocalDueno().catch(() => {});
        alert(`Listo: se ajustaron ${r.datos.ajustados} producto(s).`);
        vista = null;
        conteo = null;
        await recargar();
    };
})();
