// Nueva lista de productos en DOS pasos, igual que Nuevo encargo:
//   Paso 1  Nombre y descripción de la lista.
//   Paso 2  Catálogo grande con fotos (un toque agrega el producto) y, al lado, lo que lleva la lista.
// También: "Agregar productos" a una lista que ya existe. Reemplaza guardarListaProductoNueva (product-lists.js).
(function () {
    const esc = valor => (typeof escaparPOS === "function" ? escaparPOS(valor) : String(valor ?? ""));
    const miniatura = item => (typeof miniaturaDeItemLista === "function" ? miniaturaDeItemLista(item) : "");

    let borrador = null;
    let catalogo = null;
    let catalogoExistente = null;

    const cerrarFondo = id => { const f = document.getElementById(id); if (f) f.style.display = "none"; };

    function pintar() {
        const fondo = lpwModal("modalNuevaLista", borrador.paso === 2);
        if (borrador.paso === 1) pintarPaso1(fondo); else pintarPaso2(fondo);
    }

    function pintarPaso1(fondo) {
        fondo.innerHTML = `<div class="lpw-card" role="dialog" aria-label="Nueva lista">
            <header class="lpw-cab"><div><span class="lpw-paso">Paso 1 de 2</span><h2>Nueva lista de productos</h2><p>Ponle nombre. Luego eliges qué productos lleva.</p></div><button type="button" class="lpw-cerrar" onclick="cerrarNuevaLista()" aria-label="Cerrar">✕</button></header>
            <div class="lpw-cuerpo">
                <div class="lpw-campos">
                    <label class="lpw-ancho">Nombre de la lista
                        <input id="listaProductoNombre" placeholder="Ej. Útiles 3er grado, Despensa básica" value="${esc(borrador.nombre)}" onkeydown="if(event.key==='Enter'){event.preventDefault();listaContinuar()}">
                    </label>
                    <label class="lpw-ancho">Descripción
                        <input id="listaProductoDescripcion" placeholder="Opcional" value="${esc(borrador.descripcion)}">
                    </label>
                </div>
            </div>
            <footer class="lpw-pie"><button type="button" class="lpw-sec" onclick="cerrarNuevaLista()">Cancelar</button><button type="button" class="lpw-pri" onclick="listaContinuar()">Continuar →</button></footer>
        </div>`;

        setTimeout(() => document.getElementById("listaProductoNombre")?.focus(), 60);
    }

    window.listaContinuar = function () {
        if (!borrador) return;

        const nombre = document.getElementById("listaProductoNombre")?.value.trim();

        if (!nombre) {
            alertaPOS("Escribe el nombre de la lista.", "Falta el nombre", "alerta");
            return;
        }

        borrador.nombre = nombre;
        borrador.descripcion = document.getElementById("listaProductoDescripcion")?.value.trim() || "";
        borrador.paso = 2;
        pintar();
    };

    window.listaAtras = function () {
        if (!borrador) return;
        borrador.paso = 1;
        pintar();
    };

    window.abrirNuevaLista = function () {
        itemsListaNueva = [];
        borrador = { paso: 1, nombre: "", descripcion: "" };
        pintar();
    };

    window.cerrarNuevaLista = async function () {
        if (itemsListaNueva.length && !(await confirmarPOS("Lo que agregaste a esta lista se descarta. ¿Cancelar la lista?", "Cancelar lista", "alerta"))) return;
        itemsListaNueva = [];
        borrador = null;
        catalogo = null;
        cerrarFondo("modalNuevaLista");
    };

    function cantidadDe(producto) {
        const item = itemsListaNueva.find(i => Number(i.productoId) === Number(producto.id));
        return item ? item.cantidad : 0;
    }

    function elegir(producto) {
        if (!producto) return;

        const ya = itemsListaNueva.find(i => Number(i.productoId) === Number(producto.id));

        if (ya) ya.cantidad += 1;
        else itemsListaNueva.push({ productoId: producto.id, nombre: producto.nombre, codigo: producto.codigo || "", cantidad: 1 });

        pintarLado();
    }

    function pintarLado() {
        const lado = document.getElementById("listaLado");
        if (!lado) return;

        lado.innerHTML = itemsListaNueva.length
            ? itemsListaNueva.map((item, i) => `<div class="lpw-item">
                <span class="lpc-foto">${miniatura(item)}</span>
                <div>
                    <b>${esc(item.nombre)}</b>
                    <div class="lpw-paso-cant"><button type="button" onclick="listaItemCant(${i}, -1)" aria-label="Menos">−</button><input type="number" min="0.001" step="0.001" value="${item.cantidad}" onchange="listaItemCantEscribir(${i}, this.value)" aria-label="Cantidad"><button type="button" onclick="listaItemCant(${i}, 1)" aria-label="Más">+</button></div>
                </div>
                <button type="button" class="lpw-quitar" onclick="listaItemQuitar(${i})" aria-label="Quitar">✕</button>
            </div>`).join("")
            : `<p class="lpw-lado-vacio">Todavía no hay productos. Toca los que lleva la lista y aparecerán aquí.</p>`;

        const texto = document.getElementById("listaTotalTxt");
        if (texto) texto.textContent = `${itemsListaNueva.length} producto${itemsListaNueva.length === 1 ? "" : "s"}`;
    }

    window.listaItemCant = function (i, delta) {
        const item = itemsListaNueva[i];
        if (!item) return;
        item.cantidad = Math.max(1, Math.round((Number(item.cantidad) + delta) * 1000) / 1000);
        pintarLado();
        if (catalogo) catalogo.refrescar();
    };
    window.listaItemCantEscribir = function (i, valor) {
        const item = itemsListaNueva[i];
        const n = Number(valor);
        if (!item) return;
        item.cantidad = n > 0 ? n : 1;
        pintarLado();
        if (catalogo) catalogo.refrescar();
    };
    window.listaItemQuitar = function (i) {
        itemsListaNueva.splice(i, 1);
        pintarLado();
        if (catalogo) catalogo.refrescar();
    };

    function pintarPaso2(fondo) {
        fondo.innerHTML = `<div class="lpw-card" role="dialog" aria-label="Nueva lista, productos">
            <header class="lpw-cab"><div><span class="lpw-paso">Paso 2 de 2</span><h2>¿Qué lleva “${esc(borrador.nombre)}”?</h2><p>Toca un producto para agregarlo a la lista.</p></div><button type="button" class="lpw-cerrar" onclick="cerrarNuevaLista()" aria-label="Cerrar">✕</button></header>
            <div class="lpw-dos">
                <section class="lpw-izq"><div id="listaCatalogo" style="display:flex;flex-direction:column;min-height:0;flex:1"></div></section>
                <aside class="lpw-der"><h3>Esta lista</h3><div class="lpw-lado" id="listaLado"></div><div class="lpw-total"><span id="listaTotalTxt"></span><span></span></div></aside>
            </div>
            <footer class="lpw-pie"><button type="button" class="lpw-sec" onclick="listaAtras()">← Atrás</button><button type="button" class="lpw-pri" onclick="guardarListaProductoNueva()">Guardar lista</button></footer>
        </div>`;

        pintarLado();
        catalogo = lpvCatalogo(document.getElementById("listaCatalogo"), { placeholder: "Busca por nombre, marca o código…", manual: false, cantidadDe, alElegir: elegir });
    }

    window.guardarListaProductoNueva = async function () {
        if (!borrador) return;

        if (itemsListaNueva.length === 0) {
            alertaPOS("Agrega al menos un producto a la lista.", "Sin productos", "alerta");
            return;
        }

        const payload = { nombre: borrador.nombre, descripcion: borrador.descripcion, items: itemsListaNueva.map(item => ({ productoId: item.productoId, cantidad: item.cantidad })) };

        try {
            const respuesta = await fetch("/listas-producto", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
            const datos = await respuesta.json().catch(() => ({}));

            if (!respuesta.ok || !datos.ok) {
                alertaPOS(datos.error || "No se pudo guardar la lista.", "Error", "peligro");
                return;
            }

            itemsListaNueva = [];
            borrador = null;
            catalogo = null;
            cerrarFondo("modalNuevaLista");
            alertaPOS("Lista guardada.", "Listo", "exito");
            await mostrarListasProducto();
        } catch (error) {
            alertaPOS("No se pudo guardar la lista. Revisa tu conexión.", "Error", "peligro");
        }
    };

    // ---------- Agregar productos a una lista que ya existe ----------

    window.abrirCatalogoListaExistente = function () {
        if (!listaDetalleActual) return;

        const fondo = lpwModal("modalCatalogoLista", true);
        fondo.style.zIndex = "9900";
        fondo.innerHTML = `<div class="lpw-card" role="dialog" aria-label="Agregar productos a la lista">
            <header class="lpw-cab"><div><h2>Agregar productos</h2><p>Lista “${esc(listaDetalleActual.nombre)}”. Toca los productos que quieres agregar.</p></div><button type="button" class="lpw-cerrar" onclick="cerrarCatalogoLista()" aria-label="Cerrar">✕</button></header>
            <div class="lpw-un-paso"><div id="catalogoListaExistente" style="display:flex;flex-direction:column;min-height:0;flex:1"></div></div>
            <footer class="lpw-pie"><span></span><button type="button" class="lpw-pri" onclick="cerrarCatalogoLista()">Listo</button></footer>
        </div>`;

        catalogoExistente = lpvCatalogo(document.getElementById("catalogoListaExistente"), {
            placeholder: "Busca por nombre, marca o código…",
            manual: false,
            cantidadDe: producto => { const item = (listaDetalleActual?.items || []).find(i => Number(i.productoId ?? i.producto_id) === Number(producto.id)); return item ? item.cantidad : 0; },
            alElegir: async producto => {
                if (!producto || !listaDetalleActual) return;

                try {
                    const respuesta = await fetch(`/listas-producto/${listaDetalleActual.id}/items`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ productoId: producto.id, cantidad: 1 }) });
                    const datos = await respuesta.json().catch(() => ({}));

                    if (!respuesta.ok || !datos.ok) { alertaPOS(datos.error || "No se pudo agregar el producto.", "Error", "peligro"); return; }

                    listaDetalleActual = datos.lista;
                    renderModalDetalleListaProducto();
                    if (catalogoExistente) catalogoExistente.refrescar();
                } catch (error) {
                    alertaPOS("No se pudo agregar el producto.", "Error", "peligro");
                }
            }
        });
    };

    window.cerrarCatalogoLista = function () {
        catalogoExistente = null;
        cerrarFondo("modalCatalogoLista");
        if (typeof cargarListasProducto === "function") cargarListasProducto();
    };
})();
