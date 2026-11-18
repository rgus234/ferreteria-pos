/* Alta completa dentro de Recibir (funcion "Llegada sin factura"): llega algo que no esta en el catalogo (una escoba de la camioneta,
   un producto nuevo de Gafi) y se da de alta ahi mismo, sin salir de Recibir: nombre, como se vende, costo, los 3 precios, proveedor y
   cuantas llegaron. Se crea con existencia 0 y las piezas se suman UNA sola vez al confirmar la recepcion, asi no se cuenta doble.
   Si no trae codigo de barras se le da un codigo interno (el mismo que usa Agregar producto), listo para imprimir su etiqueta.
   El producto se crea por la ruta de siempre (POST /agregar-producto): mismas validaciones. */
(function () {
    const UNIDADES = [["pieza", "Pieza"], ["kg", "Kilo"], ["metro", "Metro"], ["litro", "Litro"], ["caja", "Caja"], ["bolsa", "Bolsa"], ["paquete", "Paquete"]];
    let alta = null;

    const esc = valor => String(valor ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
    const aviso = (mensaje, tipo) => { if (typeof mostrarToastPOS === "function") mostrarToastPOS(mensaje, tipo ? { tipo } : undefined); };
    const num = valor => { const n = Number(String(valor ?? "").replace(",", ".")); return Number.isFinite(n) ? n : 0; };
    const normal = codigo => String(codigo || "").toLowerCase().replace(/[^a-z0-9]/g, "");
    const campo = id => document.getElementById("rma_" + id);

    function existentePorCodigo(codigo) {
        const c = normal(codigo);
        if (!c || !Array.isArray(window.todosProductos)) return null;
        return window.todosProductos.find(p => normal(p.codigo) === c) || null;
    }

    window.rmAltaCerrar = function () {
        if (alta && alta.enviando) return;
        document.getElementById("rmAltaModal")?.remove();
        alta = null;
    };

    window.rmAltaAbrir = function (inicial = {}) {
        window.rmAltaCerrar();
        const proveedor = inicial.proveedor || document.getElementById("rmProveedor")?.value || "";
        const proveedores = Array.isArray(inicial.proveedores) ? inicial.proveedores : [];
        alta = { enviando: false };

        const modal = document.createElement("div");
        modal.id = "rmAltaModal";
        modal.className = "rma-fondo";
        modal.innerHTML = `<div class="rma-caja" role="dialog" aria-modal="true" aria-labelledby="rmaTitulo">
            <header class="rma-cab"><div><h3 id="rmaTitulo">Dar de alta y recibir</h3><p>El producto se crea completo y lo que llegó se suma al inventario al confirmar la recepción.</p></div><button type="button" class="rma-x" onclick="rmAltaCerrar()" aria-label="Cerrar">✕</button></header>
            <form class="rma-form" onsubmit="event.preventDefault();rmAltaGuardar()">
                <section><h4>Qué es</h4>
                    <label>Nombre del producto *<input id="rma_nombre" type="text" autocomplete="off" placeholder="Ej. Escoba de plástico" value="${esc(inicial.nombre || "")}"></label>
                    <label>Código de barras <small>(si no trae, se le pone un código interno)</small><input id="rma_codigo" type="text" autocomplete="off" inputmode="numeric" placeholder="Escanéalo o déjalo vacío" value="${esc(inicial.codigo || "")}"></label>
                </section>
                <section><h4>Cómo se vende</h4>
                    <label>Unidad<select id="rma_unidad">${UNIDADES.map(([v, t]) => `<option value="${v}">${t}</option>`).join("")}</select></label>
                    <label>Cuántas llegaron *<input id="rma_cantidad" type="number" min="0" step="any" inputmode="decimal" placeholder="0" value="${esc(inicial.cantidad || "")}"></label>
                </section>
                <section><h4>Cuánto cuesta y a cuánto se vende</h4>
                    <label>Costo (lo que pagaste por pieza)<input id="rma_costo" type="number" min="0" step="any" inputmode="decimal" placeholder="0.00"></label>
                    <label>Precio al público *<input id="rma_precio" type="number" min="0" step="any" inputmode="decimal" placeholder="0.00" oninput="rmAltaMargen()"></label>
                    <p id="rma_margen" class="rma-margen" aria-live="polite"></p>
                    <div class="rma-dos">
                        <label>Medio mayoreo<input id="rma_mayoreo" type="number" min="0" step="any" inputmode="decimal" placeholder="Igual al público"></label>
                        <label>Distribuidor<input id="rma_distribuidor" type="number" min="0" step="any" inputmode="decimal" placeholder="Igual al público"></label>
                    </div>
                </section>
                <section><h4>De dónde viene</h4>
                    <label>Proveedor${proveedores.length ? `<select id="rma_proveedor"><option value="">Sin proveedor</option>${proveedores.map(p => `<option value="${esc(p)}" ${p === proveedor ? "selected" : ""}>${esc(p)}</option>`).join("")}</select>` : `<input id="rma_proveedor" type="text" autocomplete="off" placeholder="Opcional" value="${esc(proveedor === "Varios" ? "" : proveedor)}">`}</label>
                    <details><summary>Más datos (opcional)</summary>
                        <label>Marca<input id="rma_marca" type="text" autocomplete="off"></label>
                        <label>Categoría<input id="rma_categoria" type="text" autocomplete="off"></label>
                        <label>Mínimo en existencia<input id="rma_minimo" type="number" min="0" step="any" inputmode="decimal" placeholder="Para avisarte cuando baje"></label>
                    </details>
                </section>
                <footer class="rma-pie"><button type="button" class="rm-btn" onclick="rmAltaCerrar()">Cancelar</button><button type="submit" class="rm-btn principal" id="rmaGuardar">Dar de alta y sumar</button></footer>
            </form></div>`;
        document.body.appendChild(modal);
        (inicial.nombre ? campo("costo") : campo("nombre"))?.focus();
    };

    window.rmAltaMargen = function () {
        const costo = num(campo("costo")?.value);
        const precio = num(campo("precio")?.value);
        const nota = document.getElementById("rma_margen");
        if (!nota) return;
        nota.textContent = costo > 0 && precio > 0
            ? (precio >= costo ? `Ganas $${(precio - costo).toFixed(2)} por pieza (${Math.round((precio - costo) / precio * 100)}% del precio).` : "Ojo: el precio está por debajo del costo.")
            : "";
    };

    window.rmAltaGuardar = async function () {
        if (!alta || alta.enviando) return;
        const nombre = (campo("nombre")?.value || "").trim();
        const precio = num(campo("precio")?.value);
        const cantidad = num(campo("cantidad")?.value);
        const costo = num(campo("costo")?.value);
        let codigo = (campo("codigo")?.value || "").trim();

        if (!nombre) { aviso("Escribe el nombre del producto.", "error"); campo("nombre")?.focus(); return; }
        if (!(precio > 0)) { aviso("Falta el precio al público.", "error"); campo("precio")?.focus(); return; }
        if (!(cantidad > 0)) { aviso("Escribe cuántas llegaron.", "error"); campo("cantidad")?.focus(); return; }

        const repetido = codigo ? existentePorCodigo(codigo) : null;
        if (repetido) { aviso(`Ese código ya es de “${repetido.nombre}”. Búscalo en la lista y súmale las piezas.`, "error"); return; }

        const categoria = (campo("categoria")?.value || "").trim();
        const interno = !codigo;
        if (interno) codigo = typeof generarCodigoInternoProducto === "function" ? generarCodigoInternoProducto("manual", categoria) : "GEN-" + String(Date.now()).slice(-6);

        const unidad = campo("unidad")?.value || "pieza";
        const mayoreo = num(campo("mayoreo")?.value) > 0 ? num(campo("mayoreo").value) : precio;
        const distribuidor = num(campo("distribuidor")?.value) > 0 ? num(campo("distribuidor").value) : precio;
        const proveedor = (campo("proveedor")?.value || "").trim();
        const minimo = num(campo("minimo")?.value);

        alta.enviando = true;
        const boton = document.getElementById("rmaGuardar");
        if (boton) { boton.disabled = true; boton.textContent = "Guardando…"; }

        try {
            const r = await fetch("/agregar-producto", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    nombre, codigo, precio, precioPublico: precio, precioMayoreo: mayoreo, precioDistribuidor: distribuidor,
                    // Existencia 0: las piezas se suman al confirmar la recepcion, una sola vez.
                    stock: 0, ...(minimo > 0 ? { stockMinimo: minimo } : {}),
                    proveedor, marca: (campo("marca")?.value || "").trim(), categoria, subcategoria: "",
                    unidadVenta: unidad, tipoProducto: unidad === "pieza" ? "manual" : "granel", basculaDigital: false, permiteVentaPieza: false, visiblePos: true
                })
            });
            const datos = await r.json().catch(() => ({}));
            if (!r.ok || datos.success === false || datos.ok === false) throw new Error(datos.error || "No se pudo guardar el producto.");

            const id = Number(datos.productoId || (datos.producto && datos.producto.id));
            if (!(id > 0)) throw new Error("El producto se guardó pero no se pudo abrir. Búscalo en la lista.");

            const tarjeta = { ...(datos.producto || {}), id, nombre, codigo, costo, precio, stock: 0, unidad_venta: unidad, proveedor, marca: (campo("marca")?.value || "").trim(), categoria };
            if (Array.isArray(window.todosProductos)) window.todosProductos.push(tarjeta);
            window.rmProductoNuevo?.(tarjeta, cantidad, costo, interno);
            aviso(interno ? `Listo. Le pusimos el código interno ${codigo}; al confirmar la recepción te ofrezco imprimir su etiqueta.` : "Listo: producto dado de alta y anotado en lo que llegó.");
            alta.enviando = false;
            window.rmAltaCerrar();
        } catch (error) {
            alta.enviando = false;
            if (boton) { boton.disabled = false; boton.textContent = "Dar de alta y sumar"; }
            aviso(error.message || "No se pudo guardar el producto.", "error");
        }
    };
})();
