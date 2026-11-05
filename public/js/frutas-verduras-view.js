/* Frutas y verduras (abarrotes): una lista con foto para dar de alta de un jalon lo que se vende por kilo.
   Usa el banco de fotos genericas (public/banco-genericas): se eligen las que vendes, se escribe el precio por kilo y se crean
   como productos "por peso" con su foto. En el cobro, el sistema pregunta cuantos kilos lleva y calcula el total.
   Se abre desde Inventario -> Frutas y verduras o desde Agregar producto -> Por peso. */
(function () {
    const GRUPOS = [["todo", "Todo"], ["Frutas", "Frutas"], ["Verduras", "Verduras"], ["Especias", "Especias y chiles"], ["otros", "Hierbas y frutos secos"]];
    let fv = null;

    const esc = valor => String(valor ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
    const plano = texto => String(texto || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9ñ ]+/g, " ").replace(/\s+/g, " ").trim();
    const aviso = (mensaje, tipo) => { if (typeof mostrarToastPOS === "function") mostrarToastPOS(mensaje, tipo ? { tipo } : undefined); };

    // Lo que normalmente se vende por pieza o por manojo (lo demas, por kilo). Siempre se puede cambiar en la lista.
    const SUELE_SER_PIEZA = /lechuga|coliflor|pi[ñn]a|sandia|melon|brocoli|repollo|^col|apio|elote|papaya|cilantro|perejil|epazote|hierbabuena|rabano|betabel|manojo|albahaca|romero|tomillo|menta|manzanilla|flor de calabaza|berro|verdolaga|guanabana/;
    // Especias: en bolsita (pieza), salvo los chiles secos, que se venden por kilo. Lo demas, segun el nombre.
    const unidadSugerida = c => c.categoria === "Especias" ? (/^chile/.test(plano(c.nombre)) ? "kg" : "pieza") : (/bruselas/.test(plano(c.nombre)) ? "kg" : (SUELE_SER_PIEZA.test(plano(c.nombre)) ? "pieza" : "kg"));
    // Dias que suele durar sin refrigerar; con eso el sistema calcula solo la caducidad cada vez que llega mercancia.
    const vidaSugerida = c => c.categoria === "Especias" ? 180 : (c.categoria === "Frutos secos" ? 60 : (/cilantro|perejil|epazote|hierbabuena|albahaca|espinaca|lechuga|romero|tomillo|menta|manzanilla|berro|verdolaga|flor de calabaza/.test(plano(c.nombre)) ? 4 : 7));

    // Codigo propio y legible por producto: FVAGUACATE. Si el negocio ya tiene ese codigo, ese concepto se salta.
    const codigoDe = concepto => "FV" + concepto.slug.replace(/[^a-z0-9]/gi, "").toUpperCase();

    function yaLoTiene(concepto) {
        const lista = typeof todosProductos !== "undefined" && Array.isArray(todosProductos) ? todosProductos : [];
        const nombre = plano(concepto.nombre);
        const codigo = codigoDe(concepto);
        return lista.some(p => String(p.codigo || "").toUpperCase().replace(/[^A-Z0-9]/g, "") === codigo || plano(String(p.nombre || "").replace(/\(\s*kg\s*\)/i, "")) === nombre);
    }

    function visibles() {
        const q = plano(fv.texto);
        return fv.conceptos.filter(c => {
            if (fv.grupo === "Frutas" && c.categoria !== "Frutas") return false;
            if (fv.grupo === "Verduras" && c.categoria !== "Verduras") return false;
            if (fv.grupo === "Especias" && c.categoria !== "Especias") return false;
            if (fv.grupo === "otros" && (c.categoria === "Frutas" || c.categoria === "Verduras" || c.categoria === "Especias")) return false;
            if (!q) return true;
            return plano(c.nombre).includes(q) || (c.alias || []).some(a => plano(a).includes(q));
        });
    }

    function tarjeta(c) {
        const lo = fv.existentes.has(c.slug);
        const elegido = fv.seleccion.has(c.slug);
        return `<button type="button" class="fv-tarjeta${elegido ? " elegida" : ""}${lo ? " ya" : ""}" ${lo ? "disabled" : `onclick="fvElegir('${esc(c.slug)}')"`} aria-pressed="${elegido}">
            <span class="fv-foto"><img src="/banco-genericas/${encodeURIComponent(c.archivo)}" alt="" loading="lazy"></span>
            <b>${esc(c.nombre)}</b>
            ${lo ? `<small>Ya lo tienes</small>` : `<span class="fv-palomita" aria-hidden="true">✓</span>`}
        </button>`;
    }

    function pintarGrid() {
        const caja = document.getElementById("fvGrid");
        if (!caja) return;
        const lista = visibles();
        caja.innerHTML = lista.length ? lista.map(tarjeta).join("") : `<p class="fv-vacio">No hay nada con ese nombre en la lista. Puedes agregarlo como producto "Por peso" desde Agregar producto.</p>`;
        document.querySelectorAll(".fv-grupo").forEach(b => b.classList.toggle("activo", b.dataset.grupo === fv.grupo));
    }

    function pintarLista() {
        const caja = document.getElementById("fvLista");
        const pie = document.getElementById("fvAgregar");
        if (!caja || !pie) return;
        const filas = [...fv.seleccion.values()];

        caja.innerHTML = filas.length ? filas.map(f => `<div class="fv-fila${f.faltaPrecio ? " falta" : ""}" data-slug="${esc(f.slug)}">
                <img src="/banco-genericas/${encodeURIComponent(f.archivo)}" alt="">
                <b>${esc(f.nombre)}</b>
                <button type="button" class="fv-quitar" onclick="fvElegir('${esc(f.slug)}')" aria-label="Quitar">✕</button>
                <div class="fv-controles"><div class="fv-unidad" role="group" aria-label="Se vende por">
                    <button type="button" class="${f.unidad === "kg" ? "activo" : ""}" onclick="fvUnidad('${esc(f.slug)}', 'kg')">Kilo</button>
                    <button type="button" class="${f.unidad === "pieza" ? "activo" : ""}" onclick="fvUnidad('${esc(f.slug)}', 'pieza')">Pieza</button>
                </div>
                <label class="fv-precio">$<input type="number" min="0" step="0.5" inputmode="decimal" value="${f.precio ?? ""}" placeholder="${f.unidad === "kg" ? "por kilo" : "por pieza"}" oninput="fvPrecio('${esc(f.slug)}', this.value)" aria-label="Precio ${f.unidad === "kg" ? "por kilo" : "por pieza"} de ${esc(f.nombre)}"></label>
                <label class="fv-tengo" title="Cuanto tienes ahorita. Si no sabes, déjalo vacío y lo registras cuando recibas.">Tengo <input type="number" min="0" step="0.1" inputmode="decimal" value="${f.cantidad ?? ""}" placeholder="0" oninput="fvCantidad('${esc(f.slug)}', this.value)" aria-label="Cuantos ${f.unidad === "kg" ? "kilos" : "piezas"} tienes de ${esc(f.nombre)}"> ${f.unidad === "kg" ? "kg" : "pzas"}</label>
                <label class="fv-vida" title="Dias que dura. Con esto el sistema avisa antes de que caduque.">Dura <input type="number" min="1" max="365" inputmode="numeric" value="${f.vida ?? ""}" oninput="fvVida('${esc(f.slug)}', this.value)" aria-label="Dias que dura ${esc(f.nombre)}"> dias</label></div>
            </div>`).join("") : `<p class="fv-vacio">Toca las frutas y verduras que vendes. Aquí eliges si van por kilo o pieza y les pones el precio.</p>`;

        pie.disabled = !filas.length || fv.enviando;
        pie.textContent = fv.enviando ? fv.progreso : (filas.length ? `Agregar ${filas.length} a mi inventario` : "Elige al menos una");
        document.getElementById("fvCuenta").textContent = filas.length ? `${filas.length} elegida${filas.length === 1 ? "" : "s"}` : "";
    }

    window.fvElegir = function (slug) {
        if (fv.enviando) return;
        if (fv.seleccion.has(slug)) fv.seleccion.delete(slug);
        else {
            const c = fv.conceptos.find(x => x.slug === slug);
            if (!c) return;
            fv.seleccion.set(slug, { ...c, precio: "", faltaPrecio: false, unidad: unidadSugerida(c), vida: vidaSugerida(c) });
        }
        pintarGrid();
        pintarLista();
        if (fv.seleccion.has(slug)) document.querySelector(`.fv-fila[data-slug="${CSS.escape(slug)}"] input`)?.focus();
    };

    window.fvPrecio = function (slug, valor) {
        const f = fv.seleccion.get(slug);
        if (!f) return;
        f.precio = valor;
        f.faltaPrecio = false;
        document.querySelector(`.fv-fila[data-slug="${CSS.escape(slug)}"]`)?.classList.remove("falta");
    };

    window.fvUnidad = function (slug, unidad) {
        const f = fv.seleccion.get(slug);
        if (!f || fv.enviando) return;
        f.unidad = unidad;
        pintarLista();
        document.querySelector(`.fv-fila[data-slug="${CSS.escape(slug)}"] .fv-precio input`)?.focus();
    };

    window.fvCantidad = function (slug, valor) {
        const f = fv.seleccion.get(slug);
        if (f) f.cantidad = valor;
    };

    window.fvVida = function (slug, valor) {
        const f = fv.seleccion.get(slug);
        if (f) f.vida = valor;
    };

    window.fvGrupo = function (grupo) { fv.grupo = grupo; pintarGrid(); };
    window.fvBuscar = function (texto) { fv.texto = texto; pintarGrid(); };
    window.fvCerrar = function () { if (fv && fv.enviando) return; document.getElementById("fvModal")?.remove(); fv = null; };

    async function fotoComoBase64(concepto) {
        const blob = await (await fetch(`/banco-genericas/${encodeURIComponent(concepto.archivo)}`)).blob();
        if (typeof redimensionarImagenCanvas === "function") return redimensionarImagenCanvas(new File([blob], concepto.archivo, { type: blob.type }), 320);
        return new Promise(resolver => { const lector = new FileReader(); lector.onload = () => resolver(lector.result); lector.readAsDataURL(blob); });
    }

    window.fvAgregar = async function () {
        if (!fv || fv.enviando) return;
        const filas = [...fv.seleccion.values()];
        const sinPrecio = filas.filter(f => !(Number(f.precio) > 0));

        if (sinPrecio.length) {
            sinPrecio.forEach(f => { f.faltaPrecio = true; });
            pintarLista();
            aviso(`Falta el precio de ${sinPrecio.length} producto${sinPrecio.length === 1 ? "" : "s"}.`, "error");
            document.querySelector(".fv-fila.falta input")?.focus();
            return;
        }

        fv.enviando = true;
        let hechos = 0;
        const fallos = [];

        for (const f of filas) {
            fv.progreso = `Agregando ${hechos + 1} de ${filas.length}…`;
            pintarLista();
            const codigo = codigoDe(f);
            const precio = Number(f.precio);

            try {
                const r = await fetch("/agregar-producto", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        nombre: f.nombre, codigo, precio, precioPublico: precio, precioMayoreo: precio, stock: Number(f.cantidad) > 0 ? Number(f.cantidad) : 0, stockMinimo: 0,
                        categoria: "Frutas y verduras", subcategoria: f.categoria === "Frutas" || f.categoria === "Verduras" ? f.categoria : "",
                        unidadVenta: f.unidad === "pieza" ? "pieza" : "kg", tipoProducto: f.unidad === "pieza" ? "manual" : "granel", basculaDigital: false, permiteVentaPieza: false, visiblePos: true,
                        vidaUtilDias: Number(f.vida) >= 1 ? Math.round(Number(f.vida)) : ""
                    })
                });
                const datos = await r.json().catch(() => ({}));
                if (!r.ok || datos.ok === false) throw new Error(datos.error || "No se pudo guardar");

                // la foto es un extra: si falla, el producto ya quedo creado
                try {
                    const imagenBase64 = await fotoComoBase64(f);
                    await fetch(`/fotos-producto/${codigo}/principal`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ imagenBase64 }) });
                } catch (errorFoto) { /* sin foto: se puede poner despues */ }

                hechos++;
            } catch (error) {
                fallos.push(`${f.nombre}: ${error.message}`);
            }
        }

        fv.enviando = false;

        if (typeof cargarProductos === "function") { try { await cargarProductos(); } catch (e) { /* la lista se actualiza sola despues */ } }

        if (fallos.length) {
            fv.progreso = "";
            // lo que si se creo sale de la lista; lo que fallo se queda para reintentar
            filas.forEach(f => { if (!fallos.some(t => t.startsWith(f.nombre + ":"))) { fv.seleccion.delete(f.slug); fv.existentes.add(f.slug); } });
            pintarGrid();
            pintarLista();
            aviso(`Se agregaron ${hechos}. No se pudieron ${fallos.length}: ${fallos[0]}`, "error");
            return;
        }

        aviso(`Listo: se agregaron ${hechos} frutas y verduras con su foto. Ya puedes venderlas.`);
        fv.enviando = false;
        window.fvCerrar();
    };

    window.abrirPaqueteFrutasVerduras = async function () {
        let indice;

        try { indice = typeof bancoGenericasCargarIndice === "function" ? await bancoGenericasCargarIndice() : await (await fetch("/banco-genericas/indice.json")).json(); }
        catch (error) { indice = { conceptos: [] }; }

        const conceptos = (indice.conceptos || []);
        if (!conceptos.length) { aviso("No se pudo cargar la lista de frutas y verduras.", "error"); return; }

        fv = { conceptos, seleccion: new Map(), existentes: new Set(), grupo: "todo", texto: "", enviando: false, progreso: "" };
        conceptos.forEach(c => { if (yaLoTiene(c)) fv.existentes.add(c.slug); });

        document.getElementById("fvModal")?.remove();
        const modal = document.createElement("div");
        modal.id = "fvModal";
        modal.className = "fv-modal";
        modal.setAttribute("role", "dialog");
        modal.setAttribute("aria-modal", "true");
        modal.setAttribute("aria-label", "Frutas y verduras");
        modal.innerHTML = `<div class="fv-caja">
            <header class="fv-cab"><div><h2>Frutas y verduras</h2><p>Toca las que vendes, elige si van por kilo o por pieza y ponles el precio. Se agregan con su foto.</p></div><button type="button" class="fv-cerrar" onclick="fvCerrar()" aria-label="Cerrar">✕</button></header>
            <div class="fv-cuerpo">
                <section class="fv-izq">
                    <input class="fv-buscar" type="search" placeholder="Buscar: jitomate, limón, nopal…" oninput="fvBuscar(this.value)" autocomplete="off">
                    <div class="fv-grupos">${GRUPOS.map(([clave, nombre]) => `<button type="button" class="fv-grupo${clave === "todo" ? " activo" : ""}" data-grupo="${clave}" onclick="fvGrupo('${clave}')">${nombre}</button>`).join("")}</div>
                    <div id="fvGrid" class="fv-grid"></div>
                </section>
                <aside class="fv-der">
                    <h3>Tu lista <small id="fvCuenta"></small></h3>
                    <div id="fvLista" class="fv-lista"></div>
                    <button type="button" id="fvAgregar" class="fv-agregar" onclick="fvAgregar()">Elige al menos una</button>
                    <p class="fv-nota">"Dura" son los días que aguanta: así el sistema calcula solo cuándo caduca cada vez que recibes fruta. Si pones cuánto tienes, se guarda como existencia y ya cuenta su caducidad; si lo dejas vacío empieza en 0.</p>
                </aside>
            </div></div>`;
        document.body.appendChild(modal);
        modal.addEventListener("click", e => { if (e.target === modal) window.fvCerrar(); });
        pintarGrid();
        pintarLista();
        modal.querySelector(".fv-buscar").focus();
    };
})();
