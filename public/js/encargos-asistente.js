// Nuevo encargo en DOS pasos, con espacio de sobra para buscar:
//   Paso 1  ¿Para quién es?  -> cliente, teléfono, anticipo, fecha estimada y notas.
//   Paso 2  ¿Qué pidió?      -> catálogo grande con fotos (un toque agrega el producto) y, al lado, lo que lleva el encargo.
// También: "Agregar productos" a un encargo que ya existe, con el mismo catálogo. Lo que no está en el inventario se escribe a mano.
// Reemplaza guardarEncargoNuevo (encargos-clientes.js): ese archivo sigue con la lista, el detalle y el aviso de siempre.
(function () {
    const esc = valor => (typeof escaparPOS === "function" ? escaparPOS(valor) : String(valor ?? ""));
    const dinero = n => (typeof dineroEncargo === "function" ? dineroEncargo(n) : "$" + Number(n || 0).toFixed(2));
    const miniatura = item => (typeof miniaturaDeItemEncargo === "function" ? miniaturaDeItemEncargo(item) : "");

    let borrador = null;
    let catalogo = null;

    const cerrarFondo = id => { const f = document.getElementById(id); if (f) f.style.display = "none"; };

    function pintar() {
        const fondo = lpwModal("modalNuevoEncargo", borrador.paso === 2);
        if (borrador.paso === 1) pintarPaso1(fondo); else pintarPaso2(fondo);
    }

    // ---------- Paso 1: ¿Para quién es? ----------

    function pintarPaso1(fondo) {
        const b = borrador;
        const traidos = itemsEncargoNuevo.length;

        fondo.innerHTML = `<div class="lpw-card" role="dialog" aria-label="Nuevo encargo">
            <header class="lpw-cab"><div><span class="lpw-paso">Paso 1 de 2</span><h2>Nuevo encargo</h2><p>¿Para quién es? Luego eliges qué pidió.</p></div><button type="button" class="lpw-cerrar" onclick="cerrarNuevoEncargo()" aria-label="Cerrar">✕</button></header>
            <div class="lpw-cuerpo">
                ${traidos ? `<p class="lpw-nota">Ya traes ${traidos} producto${traidos === 1 ? "" : "s"} para este encargo. Los verás en el siguiente paso.</p>` : ""}
                <div class="lpw-campos">
                    <label>Cliente
                        <input id="encargoClienteNombre" list="encargoClienteLista" placeholder="Nombre del cliente" value="${esc(b.clienteNombre)}" oninput="autocompletarClienteEncargo()" onkeydown="if(event.key==='Enter'){event.preventDefault();encargoContinuar()}">
                        <datalist id="encargoClienteLista"></datalist>
                    </label>
                    <label>Teléfono
                        <input id="encargoClienteTelefono" placeholder="Opcional" value="${esc(b.clienteTelefono)}" inputmode="tel">
                    </label>
                    <label>Anticipo
                        <input id="encargoAnticipo" type="number" step="0.01" min="0" placeholder="0.00" value="${esc(b.anticipo)}">
                    </label>
                    <label>Fecha estimada de entrega
                        <input id="encargoFechaEntrega" type="date" value="${esc(b.fecha)}">
                    </label>
                    <label class="lpw-ancho">Notas
                        <input id="encargoNotas" placeholder="Opcional" value="${esc(b.notas)}">
                    </label>
                </div>
            </div>
            <footer class="lpw-pie"><button type="button" class="lpw-sec" onclick="cerrarNuevoEncargo()">Cancelar</button><button type="button" class="lpw-pri" onclick="encargoContinuar()">Continuar →</button></footer>
        </div>`;

        if (typeof llenarDatalistClientesEncargo === "function") llenarDatalistClientesEncargo();
        setTimeout(() => document.getElementById("encargoClienteNombre")?.focus(), 60);
    }

    window.encargoContinuar = function () {
        if (!borrador) return;

        const nombre = document.getElementById("encargoClienteNombre")?.value.trim();

        if (!nombre) {
            alertaPOS("Escribe el nombre del cliente.", "Falta el cliente", "alerta");
            return;
        }

        borrador.clienteNombre = nombre;
        borrador.clienteId = (typeof clienteEncargoSeleccionado === "function" ? clienteEncargoSeleccionado()?.id : null) || null;
        borrador.clienteTelefono = document.getElementById("encargoClienteTelefono")?.value.trim() || "";
        borrador.anticipo = document.getElementById("encargoAnticipo")?.value || "";
        borrador.fecha = document.getElementById("encargoFechaEntrega")?.value || "";
        borrador.notas = document.getElementById("encargoNotas")?.value.trim() || "";
        borrador.paso = 2;
        pintar();
    };

    window.encargoAtras = function () {
        if (!borrador) return;
        borrador.paso = 1;
        pintar();
    };

    window.abrirNuevoEncargo = function (opciones = {}) {
        if (!opciones.conservar) itemsEncargoNuevo = [];
        borrador = { paso: 1, clienteId: null, clienteNombre: "", clienteTelefono: "", anticipo: "", fecha: "", notas: "" };
        pintar();
    };

    window.cerrarNuevoEncargo = async function () {
        if (itemsEncargoNuevo.length && !(await confirmarPOS("Lo que agregaste a este encargo se descarta. ¿Cancelar el encargo?", "Cancelar encargo", "alerta"))) return;
        itemsEncargoNuevo = [];
        borrador = null;
        catalogo = null;
        cerrarFondo("modalNuevoEncargo");
    };

    // ---------- Paso 2: ¿Qué pidió? ----------

    function cantidadDe(producto) {
        const item = itemsEncargoNuevo.find(i => Number(i.productoId) === Number(producto.id));
        return item ? item.cantidad : 0;
    }

    function elegir(producto, manual) {
        if (producto) {
            const ya = itemsEncargoNuevo.find(i => Number(i.productoId) === Number(producto.id));

            if (ya) ya.cantidad += 1;
            else itemsEncargoNuevo.push({ productoId: producto.id, codigo: producto.codigo || "", nombre: producto.nombre, proveedor: "", marca: producto.marca || "", cantidad: 1, precioEstimado: Number(producto.precio_publico ?? producto.precio ?? 0) || 0 });
        } else if (manual) {
            const ya = itemsEncargoNuevo.find(i => !i.productoId && String(i.nombre).toLowerCase() === manual.toLowerCase());

            if (ya) ya.cantidad += 1;
            else itemsEncargoNuevo.push({ productoId: null, codigo: "", nombre: manual, proveedor: "", marca: "", cantidad: 1, precioEstimado: 0 });
        }

        pintarLado();
    }

    function pintarLado() {
        const lado = document.getElementById("encargoLado");
        if (!lado) return;

        const total = itemsEncargoNuevo.reduce((s, i) => s + Number(i.cantidad) * Number(i.precioEstimado || 0), 0);

        lado.innerHTML = itemsEncargoNuevo.length
            ? itemsEncargoNuevo.map((item, i) => `<div class="lpw-item">
                <span class="lpc-foto">${miniatura(item)}</span>
                <div>
                    <b>${esc(item.nombre)}</b>${item.productoId ? "" : `<small>Escrito a mano</small>`}
                    <div class="lpw-paso-cant"><button type="button" onclick="encargoItemCant(${i}, -1)" aria-label="Menos">−</button><input type="number" min="0.001" step="0.001" value="${item.cantidad}" onchange="encargoItemCantEscribir(${i}, this.value)" aria-label="Cantidad"><button type="button" onclick="encargoItemCant(${i}, 1)" aria-label="Más">+</button></div>
                </div>
                <div class="lpw-precio"><button type="button" class="lpw-quitar" onclick="encargoItemQuitar(${i})" aria-label="Quitar">✕</button>Precio est.<input type="number" min="0" step="0.01" value="${Number(item.precioEstimado || 0)}" onchange="encargoItemPrecio(${i}, this.value)" aria-label="Precio estimado"></div>
            </div>`).join("")
            : `<p class="lpw-lado-vacio">Todavía no hay productos. Toca los que pidió el cliente y aparecerán aquí.</p>`;

        const texto = document.getElementById("encargoTotalTxt");
        const monto = document.getElementById("encargoTotal");
        if (texto) texto.textContent = `${itemsEncargoNuevo.length} producto${itemsEncargoNuevo.length === 1 ? "" : "s"} · total estimado`;
        if (monto) monto.textContent = dinero(total);
    }

    window.encargoItemCant = function (i, delta) {
        const item = itemsEncargoNuevo[i];
        if (!item) return;
        item.cantidad = Math.max(1, Math.round((Number(item.cantidad) + delta) * 1000) / 1000);
        pintarLado();
        if (catalogo) catalogo.refrescar();
    };
    window.encargoItemCantEscribir = function (i, valor) {
        const item = itemsEncargoNuevo[i];
        const n = Number(valor);
        if (!item) return;
        item.cantidad = n > 0 ? n : 1;
        pintarLado();
        if (catalogo) catalogo.refrescar();
    };
    window.encargoItemPrecio = function (i, valor) {
        const item = itemsEncargoNuevo[i];
        const n = Number(valor);
        if (!item) return;
        item.precioEstimado = n >= 0 ? n : 0;
        pintarLado();
    };
    window.encargoItemQuitar = function (i) {
        itemsEncargoNuevo.splice(i, 1);
        pintarLado();
        if (catalogo) catalogo.refrescar();
    };

    function pintarPaso2(fondo) {
        fondo.innerHTML = `<div class="lpw-card" role="dialog" aria-label="Nuevo encargo, productos">
            <header class="lpw-cab"><div><span class="lpw-paso">Paso 2 de 2</span><h2>¿Qué pidió ${esc(borrador.clienteNombre)}?</h2><p>Toca un producto para agregarlo. Si no está en tu inventario, escríbelo y agrégalo a mano.</p></div><button type="button" class="lpw-cerrar" onclick="cerrarNuevoEncargo()" aria-label="Cerrar">✕</button></header>
            <div class="lpw-dos">
                <section class="lpw-izq"><div id="encargoCatalogo" style="display:flex;flex-direction:column;min-height:0;flex:1"></div></section>
                <aside class="lpw-der"><h3>Este encargo</h3><div class="lpw-lado" id="encargoLado"></div><div class="lpw-total"><span id="encargoTotalTxt"></span><strong id="encargoTotal"></strong></div></aside>
            </div>
            <footer class="lpw-pie"><button type="button" class="lpw-sec" onclick="encargoAtras()">← Atrás</button><button type="button" class="lpw-pri" onclick="guardarEncargoNuevo()">Guardar encargo</button></footer>
        </div>`;

        pintarLado();
        catalogo = lpvCatalogo(document.getElementById("encargoCatalogo"), { placeholder: "Busca en tu inventario o escribe lo que pidió…", manual: true, cantidadDe, alElegir: elegir });
    }

    window.guardarEncargoNuevo = async function () {
        if (!borrador) return;

        if (itemsEncargoNuevo.length === 0) {
            alertaPOS("Agrega al menos un producto al encargo.", "Sin productos", "alerta");
            return;
        }

        const payload = {
            clienteId: borrador.clienteId,
            clienteNombre: borrador.clienteNombre,
            clienteTelefono: borrador.clienteTelefono,
            anticipo: Number(borrador.anticipo || 0),
            fechaEntregaEsperada: borrador.fecha || null,
            notas: borrador.notas,
            items: itemsEncargoNuevo
        };

        try {
            const respuesta = await fetch("/encargos-clientes", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
            const datos = await respuesta.json().catch(() => ({}));

            if (!respuesta.ok || !datos.ok) {
                alertaPOS(datos.error || "No se pudo guardar el encargo.", "Error", "peligro");
                return;
            }

            itemsEncargoNuevo = [];
            borrador = null;
            catalogo = null;
            cerrarFondo("modalNuevoEncargo");
            alertaPOS("Encargo guardado.", "Listo", "exito");
            await mostrarEncargos();
        } catch (error) {
            alertaPOS("No se pudo guardar el encargo. Revisa tu conexión.", "Error", "peligro");
        }
    };

    // ---------- Agregar productos a un encargo que ya existe ----------

    let catalogoExistente = null;

    window.abrirCatalogoEncargoExistente = function () {
        if (!encargoDetalleActual) return;

        const fondo = lpwModal("modalCatalogoEncargo", true);
        fondo.style.zIndex = "9900";
        fondo.innerHTML = `<div class="lpw-card" role="dialog" aria-label="Agregar productos al encargo">
            <header class="lpw-cab"><div><h2>Agregar productos</h2><p>Encargo de ${esc(encargoDetalleActual.clienteNombre)}. Toca los productos que pidió; si no está en tu inventario, escríbelo y agrégalo a mano.</p></div><button type="button" class="lpw-cerrar" onclick="cerrarCatalogoEncargo()" aria-label="Cerrar">✕</button></header>
            <div class="lpw-un-paso"><div id="catalogoEncargoExistente" style="display:flex;flex-direction:column;min-height:0;flex:1"></div></div>
            <footer class="lpw-pie"><span></span><button type="button" class="lpw-pri" onclick="cerrarCatalogoEncargo()">Listo</button></footer>
        </div>`;

        catalogoExistente = lpvCatalogo(document.getElementById("catalogoEncargoExistente"), {
            placeholder: "Busca en tu inventario o escribe lo que pidió…",
            manual: true,
            cantidadDe: producto => { const item = (encargoDetalleActual?.items || []).find(i => Number(i.productoId) === Number(producto.id)); return item ? item.cantidad : 0; },
            alElegir: async (producto, manual) => {
                if (!encargoDetalleActual) return;

                const cuerpo = producto
                    ? { productoId: producto.id, codigo: producto.codigo || "", nombre: producto.nombre, marca: producto.marca || "", cantidad: 1, precioEstimado: Number(producto.precio_publico ?? producto.precio ?? 0) || 0, sumar: true }
                    : { productoId: null, codigo: "", nombre: manual, cantidad: 1, precioEstimado: 0 };

                try {
                    const respuesta = await fetch(`/encargos-clientes/${encargoDetalleActual.id}/items`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(cuerpo) });
                    const datos = await respuesta.json().catch(() => ({}));

                    if (!respuesta.ok || !datos.ok) { alertaPOS(datos.error || "No se pudo agregar el producto.", "Error", "peligro"); return; }

                    encargoDetalleActual = datos.encargo;
                    renderModalDetalleEncargo();
                    if (catalogoExistente) catalogoExistente.refrescar();
                } catch (error) {
                    alertaPOS("No se pudo agregar el producto.", "Error", "peligro");
                }
            }
        });
    };

    window.cerrarCatalogoEncargo = function () {
        catalogoExistente = null;
        cerrarFondo("modalCatalogoEncargo");
        if (typeof cargarListaEncargos === "function") cargarListaEncargos();
    };
})();
