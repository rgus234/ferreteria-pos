/* Productos sueltos (cualquier giro): una lista de lo que se vende sin codigo de barras (por kilo, metro, litro o pieza) para darlo de alta de un jalon.
   Misma idea que "Frutas y verduras" de abarrotes, pero la lista sale del paquete del giro del negocio (paquetes-granel-datos.js) y se pueden agregar conceptos propios.
   Los productos se crean con un codigo propio y legible (SU + nombre), sin foto: se les puede poner despues.
   Es una funcion nueva: solo aparece si el dueño la enciende en Nexo -> Funciones nuevas (funcionBeta("paquetes_granel")). */
(function () {
    const UNIDADES = [["pieza", "Pieza", "por pieza"], ["kg", "Kilo", "por kilo"], ["metro", "Metro", "por metro"], ["litro", "Litro", "por litro"]];
    let pg = null;

    const esc = valor => String(valor ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
    const plano = texto => String(texto || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9ñ ]+/g, " ").replace(/\s+/g, " ").trim();
    const aviso = (mensaje, tipo) => { if (typeof mostrarToastPOS === "function") mostrarToastPOS(mensaje, tipo ? { tipo } : undefined); };
    const etiquetaUnidad = u => (UNIDADES.find(x => x[0] === u) || UNIDADES[0])[2];
    const codigoDe = concepto => (concepto.prefijo || pg.paquete.prefijo) + concepto.slug.replace(/[^a-z0-9]/gi, "").toUpperCase();
    const inicial = nombre => esc(String(nombre || "?").trim().charAt(0).toUpperCase());

    // Paquetes que le tocan al negocio: su tipo principal y los giros que tenga activos (abarrotes usa su propia lista de Frutas y verduras).
    function paquetesDelNegocio() {
        let cfg = null;
        try { cfg = typeof configuracionNegocio === "function" ? configuracionNegocio() : null; } catch (error) { cfg = null; }
        const claves = [String(cfg?.perfilNegocio || "").toLowerCase(), ...(Array.isArray(cfg?.girosActivos) ? cfg.girosActivos.map(g => String(g).toLowerCase()) : [])];
        const datos = window.PAQUETES_GRANEL || {};
        const unicas = claves.filter((k, i) => datos[k] && claves.indexOf(k) === i);
        return unicas.length ? unicas : (datos.ferreteria ? ["ferreteria"] : []);
    }

    function yaLoTiene(concepto) {
        const lista = typeof todosProductos !== "undefined" && Array.isArray(todosProductos) ? todosProductos : [];
        const nombre = plano(concepto.nombre);
        const codigo = codigoDe(concepto);
        return lista.some(p => String(p.codigo || "").toUpperCase().replace(/[^A-Z0-9]/g, "") === codigo || plano(p.nombre) === nombre);
    }

    function visibles() {
        const q = plano(pg.texto);
        return pg.conceptos.filter(c => {
            if (pg.grupo !== "todo" && c.grupo !== pg.grupo) return false;
            if (!q) return true;
            return plano(c.nombre).includes(q) || (c.alias || []).some(a => plano(a).includes(q));
        });
    }

    function tarjeta(c) {
        const lo = pg.existentes.has(c.slug);
        const elegido = pg.seleccion.has(c.slug);
        return `<button type="button" class="fv-tarjeta${elegido ? " elegida" : ""}${lo ? " ya" : ""}" ${lo ? "disabled" : `onclick="pgElegir('${esc(c.slug)}')"`} aria-pressed="${elegido}">
            <span class="fv-foto"><span class="pg-ini">${inicial(c.nombre)}</span></span>
            <b>${esc(c.nombre)}</b>
            ${lo ? `<small>Ya lo tienes</small>` : `<small class="pg-unidad">${esc(etiquetaUnidad(c.unidad))}</small><span class="fv-palomita" aria-hidden="true">✓</span>`}
        </button>`;
    }

    function pintarGrid() {
        const caja = document.getElementById("pgGrid");
        if (!caja) return;
        const lista = visibles();
        const q = pg.texto.trim();
        const propio = q && !pg.conceptos.some(c => plano(c.nombre) === plano(q))
            ? `<button type="button" class="fv-tarjeta pg-propio" onclick="pgAgregarPropio()"><span class="fv-foto"><span class="pg-ini">+</span></span><b>Agregar “${esc(q)}”</b><small>Como producto suelto propio</small></button>` : "";
        caja.innerHTML = (lista.length ? lista.map(tarjeta).join("") : "") + propio || `<p class="fv-vacio">No hay nada en la lista. Escribe el nombre arriba para agregarlo como producto suelto propio.</p>`;
        document.querySelectorAll(".pg-grupo").forEach(b => b.classList.toggle("activo", b.dataset.grupo === pg.grupo));
    }

    function pintarLista() {
        const caja = document.getElementById("pgLista");
        const pie = document.getElementById("pgAgregar");
        if (!caja || !pie) return;
        const filas = [...pg.seleccion.values()];

        caja.innerHTML = filas.length ? filas.map(f => `<div class="fv-fila${f.faltaPrecio ? " falta" : ""}" data-slug="${esc(f.slug)}">
                <span class="pg-ini chico">${inicial(f.nombre)}</span>
                <b>${esc(f.nombre)}</b>
                <button type="button" class="fv-quitar" onclick="pgQuitar('${esc(f.slug)}')" aria-label="Quitar">✕</button>
                <div class="fv-controles"><div class="fv-unidad" role="group" aria-label="Se vende por">
                    ${UNIDADES.map(([u, t]) => `<button type="button" class="${f.unidad === u ? "activo" : ""}" onclick="pgUnidad('${esc(f.slug)}', '${u}')">${t}</button>`).join("")}
                </div>
                <label class="fv-precio">$<input type="number" min="0" step="0.5" inputmode="decimal" value="${f.precio ?? ""}" placeholder="${etiquetaUnidad(f.unidad)}" oninput="pgPrecio('${esc(f.slug)}', this.value)" aria-label="Precio ${etiquetaUnidad(f.unidad)} de ${esc(f.nombre)}"></label>
                <label class="fv-tengo" title="Cuanto tienes ahorita. Si no sabes, déjalo vacío y lo registras cuando recibas.">Tengo <input type="number" min="0" step="0.1" inputmode="decimal" value="${f.cantidad ?? ""}" placeholder="0" oninput="pgCantidad('${esc(f.slug)}', this.value)" aria-label="Cuanto tienes de ${esc(f.nombre)}"></label></div>
            </div>`).join("") : `<p class="fv-vacio">Toca lo que vendes suelto. Aquí eliges si va por kilo, metro, litro o pieza y le pones el precio.</p>`;

        pie.disabled = !filas.length || pg.enviando;
        pie.textContent = pg.enviando ? pg.progreso : (filas.length ? `Agregar ${filas.length} a mi inventario` : "Elige al menos uno");
        document.getElementById("pgCuenta").textContent = filas.length ? `${filas.length} elegido${filas.length === 1 ? "" : "s"}` : "";
    }

    function elegir(c) {
        pg.seleccion.set(c.slug, { ...c, precio: "", faltaPrecio: false, unidad: c.unidad || "pieza" });
        pintarGrid();
        pintarLista();
        document.querySelector(`.fv-fila[data-slug="${CSS.escape(c.slug)}"] .fv-precio input`)?.focus();
    }

    window.pgElegir = function (slug) {
        if (pg.enviando) return;
        if (pg.seleccion.has(slug)) { pg.seleccion.delete(slug); pintarGrid(); pintarLista(); return; }
        const c = pg.conceptos.find(x => x.slug === slug);
        if (c) elegir(c);
    };
    window.pgQuitar = function (slug) { if (pg.enviando) return; pg.seleccion.delete(slug); pintarGrid(); pintarLista(); };

    window.pgAgregarPropio = function () {
        const nombre = pg.texto.trim().replace(/\s+/g, " ");
        if (!nombre || pg.enviando) return;
        const slug = plano(nombre).replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "producto";
        const c = { nombre: nombre.charAt(0).toUpperCase() + nombre.slice(1), grupo: "Propios", unidad: "pieza", alias: [], slug };
        if (!pg.conceptos.some(x => x.slug === slug)) pg.conceptos.push(c);
        const quedo = pg.conceptos.find(x => x.slug === slug);
        if (yaLoTiene(quedo)) { aviso("Ya tienes un producto con ese nombre.", "error"); return; }
        pg.texto = "";
        const buscador = document.querySelector(".pg-buscar");
        if (buscador) buscador.value = "";
        elegir(quedo);
    };

    window.pgPrecio = function (slug, valor) {
        const f = pg.seleccion.get(slug);
        if (!f) return;
        f.precio = valor;
        f.faltaPrecio = false;
        document.querySelector(`.fv-fila[data-slug="${CSS.escape(slug)}"]`)?.classList.remove("falta");
    };
    window.pgUnidad = function (slug, unidad) {
        const f = pg.seleccion.get(slug);
        if (!f || pg.enviando) return;
        f.unidad = unidad;
        pintarLista();
        document.querySelector(`.fv-fila[data-slug="${CSS.escape(slug)}"] .fv-precio input`)?.focus();
    };
    window.pgCantidad = function (slug, valor) { const f = pg.seleccion.get(slug); if (f) f.cantidad = valor; };
    window.pgGrupo = function (grupo) { pg.grupo = grupo; pintarGrid(); };
    window.pgBuscar = function (texto) { pg.texto = texto; pintarGrid(); };
    window.pgCerrar = function () { if (pg && pg.enviando) return; document.getElementById("pgModal")?.remove(); pg = null; };

    window.pgAgregar = async function () {
        if (!pg || pg.enviando) return;
        const filas = [...pg.seleccion.values()];
        const sinPrecio = filas.filter(f => !(Number(f.precio) > 0));

        if (sinPrecio.length) {
            sinPrecio.forEach(f => { f.faltaPrecio = true; });
            pintarLista();
            aviso(`Falta el precio de ${sinPrecio.length} producto${sinPrecio.length === 1 ? "" : "s"}.`, "error");
            document.querySelector(".fv-fila.falta input")?.focus();
            return;
        }

        pg.enviando = true;
        let hechos = 0;
        const fallos = [];

        for (const f of filas) {
            pg.progreso = `Agregando ${hechos + 1} de ${filas.length}…`;
            pintarLista();
            const precio = Number(f.precio);

            try {
                const r = await fetch("/agregar-producto", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        nombre: f.nombre, codigo: codigoDe(f), precio, precioPublico: precio, precioMayoreo: precio, stock: Number(f.cantidad) > 0 ? Number(f.cantidad) : 0, stockMinimo: 0,
                        categoria: f.grupo === "Propios" ? "" : f.grupo, subcategoria: "",
                        unidadVenta: f.unidad, tipoProducto: f.unidad === "pieza" ? "manual" : "granel", basculaDigital: false, permiteVentaPieza: false, visiblePos: true
                    })
                });
                const datos = await r.json().catch(() => ({}));
                if (!r.ok || datos.ok === false) throw new Error(datos.error || "No se pudo guardar");
                hechos++;
            } catch (error) {
                fallos.push(`${f.nombre}: ${error.message}`);
            }
        }

        pg.enviando = false;

        if (typeof cargarProductos === "function") { try { await cargarProductos(); } catch (e) { /* la lista se actualiza sola despues */ } }

        if (fallos.length) {
            pg.progreso = "";
            filas.forEach(f => { if (!fallos.some(t => t.startsWith(f.nombre + ":"))) { pg.seleccion.delete(f.slug); pg.existentes.add(f.slug); } });
            pintarGrid();
            pintarLista();
            aviso(`Se agregaron ${hechos}. No se pudieron ${fallos.length}: ${fallos[0]}`, "error");
            return;
        }

        aviso(`Listo: se agregaron ${hechos} producto${hechos === 1 ? "" : "s"} suelto${hechos === 1 ? "" : "s"}. Ya puedes venderlos.`);
        window.pgCerrar();
    };

    window.abrirPaquetesGranel = function () {
        const claves = paquetesDelNegocio();
        const datos = window.PAQUETES_GRANEL || {};
        if (!claves.length) { aviso("No hay una lista de productos sueltos para este tipo de negocio todavía.", "error"); return; }

        const paquetes = claves.map(k => datos[k]);
        const paquete = { titulo: paquetes[0].titulo, ayuda: paquetes[0].ayuda, prefijo: paquetes[0].prefijo, grupos: [], conceptos: [] };

        // Un negocio con varios giros ve todos sus paquetes juntos; cada concepto lleva el prefijo de codigo de su paquete.
        paquetes.forEach(p => p.conceptos.forEach(c => { paquete.conceptos.push({ ...c, prefijo: p.prefijo }); }));
        paquetes.forEach(p => p.grupos.forEach(g => { if (!paquete.grupos.includes(g)) paquete.grupos.push(g); }));
        if (paquetes.length > 1) paquete.titulo = "Productos sueltos";

        pg = { paquete, conceptos: paquete.conceptos.map(c => ({ ...c })), seleccion: new Map(), existentes: new Set(), grupo: "todo", texto: "", enviando: false, progreso: "" };
        pg.conceptos.forEach(c => { if (yaLoTiene(c)) pg.existentes.add(c.slug); });

        document.getElementById("pgModal")?.remove();
        const modal = document.createElement("div");
        modal.id = "pgModal";
        modal.className = "fv-modal";
        modal.setAttribute("role", "dialog");
        modal.setAttribute("aria-modal", "true");
        modal.setAttribute("aria-label", paquete.titulo);
        modal.innerHTML = `<div class="fv-caja">
            <header class="fv-cab"><div><h2>${esc(paquete.titulo)}</h2><p>${esc(paquete.ayuda)}</p></div><button type="button" class="fv-cerrar" onclick="pgCerrar()" aria-label="Cerrar">✕</button></header>
            <div class="fv-cuerpo">
                <section class="fv-izq">
                    <input class="fv-buscar pg-buscar" type="search" placeholder="Buscar: pijas, cable, manguera… o escribe uno nuevo" oninput="pgBuscar(this.value)" autocomplete="off">
                    <div class="fv-grupos"><button type="button" class="fv-grupo pg-grupo activo" data-grupo="todo" onclick="pgGrupo('todo')">Todo</button>${paquete.grupos.map(g => `<button type="button" class="fv-grupo pg-grupo" data-grupo="${esc(g)}" onclick="pgGrupo(this.dataset.grupo)">${esc(g)}</button>`).join("")}</div>
                    <div id="pgGrid" class="fv-grid"></div>
                </section>
                <aside class="fv-der">
                    <h3>Tu lista <small id="pgCuenta"></small></h3>
                    <div id="pgLista" class="fv-lista"></div>
                    <button type="button" id="pgAgregar" class="fv-agregar" onclick="pgAgregar()">Elige al menos uno</button>
                    <p class="fv-nota">Se crean con un código propio (por ejemplo SUPIJAPARATABLAROCA) y sin foto. “Tengo” es cuánto hay ahorita; si lo dejas vacío empieza en 0. Al cobrar, Nexo pregunta cuánto lleva y calcula el total.</p>
                </aside>
            </div></div>`;
        document.body.appendChild(modal);
        modal.addEventListener("click", e => { if (e.target === modal) window.pgCerrar(); });
        pintarGrid();
        pintarLista();
        modal.querySelector(".pg-buscar").focus();
    };
})();
