/* Frutas y verduras (abarrotes): una lista con foto para dar de alta de un jalon lo que se vende por kilo.
   Usa el banco de fotos genericas (public/banco-genericas): se eligen las que vendes, se escribe el precio por kilo y se crean
   como productos "por peso" con su foto. En el cobro, el sistema pregunta cuantos kilos lleva y calcula el total.
   Se abre desde Inventario -> Frutas y verduras o desde Agregar producto -> Por peso. */
(function () {
    const GRUPOS = [["todo", "Todo"], ["Frutas", "Frutas"], ["Verduras", "Verduras"], ["otros", "Hierbas y otros"]];
    let fv = null;

    const esc = valor => String(valor ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
    const plano = texto => String(texto || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9ñ ]+/g, " ").replace(/\s+/g, " ").trim();
    const aviso = (mensaje, tipo) => { if (typeof mostrarToastPOS === "function") mostrarToastPOS(mensaje, tipo ? { tipo } : undefined); };

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
            if (fv.grupo === "otros" && (c.categoria === "Frutas" || c.categoria === "Verduras")) return false;
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
                <label class="fv-precio">$<input type="number" min="0" step="0.5" inputmode="decimal" value="${f.precio ?? ""}" placeholder="por kg" oninput="fvPrecio('${esc(f.slug)}', this.value)" aria-label="Precio por kilo de ${esc(f.nombre)}"></label>
                <button type="button" class="fv-quitar" onclick="fvElegir('${esc(f.slug)}')" aria-label="Quitar">✕</button>
            </div>`).join("") : `<p class="fv-vacio">Toca las frutas y verduras que vendes. Aquí les pones el precio por kilo.</p>`;

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
            fv.seleccion.set(slug, { ...c, precio: "", faltaPrecio: false });
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
            aviso(`Falta el precio por kilo de ${sinPrecio.length} producto${sinPrecio.length === 1 ? "" : "s"}.`, "error");
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
                        nombre: f.nombre, codigo, precio, precioPublico: precio, precioMayoreo: precio, stock: 0, stockMinimo: 0,
                        categoria: "Frutas y verduras", subcategoria: f.categoria === "Frutas" || f.categoria === "Verduras" ? f.categoria : "",
                        unidadVenta: "kg", tipoProducto: "granel", basculaDigital: false, permiteVentaPieza: false, visiblePos: true
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

        aviso(`Listo: se agregaron ${hechos} frutas y verduras con su foto. Ya puedes venderlas por kilo.`);
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
            <header class="fv-cab"><div><h2>Frutas y verduras</h2><p>Toca las que vendes y ponles el precio por kilo. Se agregan con su foto y se cobran por peso.</p></div><button type="button" class="fv-cerrar" onclick="fvCerrar()" aria-label="Cerrar">✕</button></header>
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
                    <p class="fv-nota">El precio es por kilo. Las existencias empiezan en 0: se suman cuando recibes tu fruta.</p>
                </aside>
            </div></div>`;
        document.body.appendChild(modal);
        modal.addEventListener("click", e => { if (e.target === modal) window.fvCerrar(); });
        pintarGrid();
        pintarLista();
        modal.querySelector(".fv-buscar").focus();
    };
})();
