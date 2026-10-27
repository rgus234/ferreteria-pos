/* Venta movil completa (parte 2): vender por PESO a mano y cobrar en UN toque.
   - Productos por kilo, metro, litro o gramo: al agregarlos pregunta cuanto lleva (con atajos ¼ ½ 1 kg y "dame X pesos de..."), y la cantidad
     de la linea se puede volver a editar tocandola. Los botones - y + mueven de a ¼ (o 100 g) en vez de 1.
   - Cobro en 1 toque: arriba de la pantalla de cobro, "Efectivo justo" y "Tarjeta" cobran y terminan sin pasar por mas pantallas.
   Todo se apoya en las funciones de dueno.js (agregarAlCarritoVenderDueno, renderCobroVenderDueno...); la venta se manda por el mismo camino. */

(function () {
    const UNIDADES = {
        kg: { texto: "kilos", ab: "kg", paso: 0.25, atajos: [0.25, 0.5, 0.75, 1, 1.5, 2] },
        kilo: { texto: "kilos", ab: "kg", paso: 0.25, atajos: [0.25, 0.5, 0.75, 1, 1.5, 2] },
        gramo: { texto: "gramos", ab: "g", paso: 100, atajos: [100, 250, 500, 750, 1000] },
        metro: { texto: "metros", ab: "m", paso: 0.5, atajos: [0.5, 1, 2, 3, 5] },
        litro: { texto: "litros", ab: "L", paso: 0.25, atajos: [0.25, 0.5, 1, 1.5, 2] }
    };

    const unidadDe = producto => String(producto?.unidadVenta || producto?.unidad_venta || "pieza").toLowerCase();
    const esDecimal = producto => Boolean(UNIDADES[unidadDe(producto)]);
    const redondear = valor => Math.round(Number(valor) * 1000) / 1000;
    const esc = valor => (typeof escaparDueno === "function" ? escaparDueno(valor) : String(valor ?? ""));
    const dinero2 = valor => (typeof dinero === "function" ? dinero(valor) : "$" + Number(valor || 0).toFixed(2));
    const mostrarCantidad = (cantidad, producto) => `${redondear(cantidad)} ${UNIDADES[unidadDe(producto)]?.ab || ""}`.trim();

    // Cuanto se lleva por X pesos a ese precio (3 decimales), por ejemplo $20 de jitomate a $28/kg.
    function cantidadPorPesos(pesos, precio) {
        const p = Number(precio);
        const d = Number(pesos);

        return p > 0 && d > 0 ? redondear(d / p) : 0;
    }

    window.dvcCantidadPorPesos = cantidadPorPesos;
    window.dvcEsDecimal = esDecimal;

    // ---- Hoja: ¿cuanto lleva? ----
    function pedirCantidad(producto, actual = 0) {
        const unidad = UNIDADES[unidadDe(producto)];
        const precio = Number(producto.precio || 0);

        return new Promise(resolve => {
            const fondo = document.createElement("div");
            fondo.className = "dm-dialogo-fondo";
            fondo.innerHTML = `<div class="dm-dialogo dvc-hoja" role="dialog">
                <h3>${esc(producto.nombre)}</h3>
                <p>${dinero2(precio)} por ${unidad.ab}${actual ? ` · lleva ${redondear(actual)} ${unidad.ab}` : ""}</p>
                <label class="dm-campo">Cantidad en ${unidad.texto}
                    <input class="dm-input dvc-cantidad" id="dvcCantidad" type="number" inputmode="decimal" min="0" step="any" value="${actual || ""}" placeholder="0">
                </label>
                <div class="dvc-atajos">${unidad.atajos.map(a => `<button type="button" data-a="${a}">${({ 0.25: "¼", 0.5: "½", 0.75: "¾", 1.5: "1½" }[a] || a)} ${unidad.ab}</button>`).join("")}</div>
                <label class="dm-campo">O dime cuántos pesos quiere
                    <input class="dm-input" id="dvcPesos" type="number" inputmode="decimal" min="0" step="any" placeholder="Ej. 20">
                </label>
                <div class="dvc-total" id="dvcTotal">${dinero2(0)}</div>
                <p class="dm-error" id="dvcError"></p>
                <div class="dm-dialogo-botones"><button type="button" data-r="no">Cancelar</button><button type="button" class="principal" data-r="si">Agregar</button></div>
            </div>`;
            document.body.appendChild(fondo);

            const cantidad = fondo.querySelector("#dvcCantidad");
            const pesos = fondo.querySelector("#dvcPesos");
            const total = fondo.querySelector("#dvcTotal");
            const pintarTotal = () => { total.textContent = `${redondear(Number(cantidad.value) || 0)} ${unidad.ab} = ${dinero2((Number(cantidad.value) || 0) * precio)}`; };
            const cerrar = valor => { fondo.remove(); resolve(valor); };

            cantidad.addEventListener("input", () => { pesos.value = ""; pintarTotal(); });
            pesos.addEventListener("input", () => { const c = cantidadPorPesos(pesos.value, precio); cantidad.value = c || ""; pintarTotal(); });

            fondo.addEventListener("click", ev => {
                const atajo = ev.target.dataset?.a;

                if (atajo) { cantidad.value = atajo; pesos.value = ""; pintarTotal(); return; }

                if (ev.target.dataset?.r === "no" || ev.target === fondo) { cerrar(null); return; }

                if (ev.target.dataset?.r === "si") {
                    const c = redondear(Number(cantidad.value));

                    if (!(c > 0)) { fondo.querySelector("#dvcError").textContent = "Pon cuánto lleva."; return; }

                    cerrar(c);
                }
            });

            pintarTotal();
            setTimeout(() => cantidad.focus(), 80);
        });
    }

    function buscarProducto(id) {
        return (typeof duenoVentaUltimosResultados !== "undefined" ? duenoVentaUltimosResultados : []).find(p => p.id === id);
    }

    // Agregar un producto por peso: pregunta cuanto lleva (y si ya estaba en la venta, deja corregir el total).
    const agregarOriginal = window.agregarAlCarritoVenderDueno;

    if (typeof agregarOriginal === "function") {
        window.agregarAlCarritoVenderDueno = function (id) {
            const producto = buscarProducto(id);

            if (!producto || !esDecimal(producto)) return agregarOriginal.apply(this, arguments);

            const existente = duenoVentaCarrito.find(item => item.id === id);

            pedirCantidad(producto, existente ? existente.cantidad : 0).then(cantidad => {
                if (!cantidad) return;

                if (!existente) agregarOriginal.call(null, id);

                const linea = duenoVentaCarrito.find(item => item.id === id);

                if (linea) { linea.cantidad = cantidad; linea.unidadVenta = unidadDe(producto); renderCarritoVenderDueno(); }
            });
        };
    }

    // Los botones - y + de una linea por peso mueven de a ¼ kg (o 100 g, 0.5 m...).
    const cambiarOriginal = window.cambiarCantidadCarritoVenderDueno;

    if (typeof cambiarOriginal === "function") {
        window.cambiarCantidadCarritoVenderDueno = function (id, delta) {
            const linea = duenoVentaCarrito.find(item => item.id === id);
            const unidad = linea ? UNIDADES[String(linea.unidadVenta || "").toLowerCase()] : null;

            if (unidad) {
                const nueva = redondear(linea.cantidad + delta * unidad.paso);
                linea.cantidad = nueva > 0 ? nueva : 0;
                return cambiarOriginal.call(this, id, 0); // con 0 quita la linea si quedo en cero y vuelve a pintar
            }

            return cambiarOriginal.apply(this, arguments);
        };
    }

    // La cantidad de una linea por peso se toca para escribir el valor exacto.
    const filaOriginal = window.filaCarritoVenderDuenoHtml;

    if (typeof filaOriginal === "function") {
        window.filaCarritoVenderDuenoHtml = function (item) {
            const html = filaOriginal.apply(this, arguments);
            const unidad = UNIDADES[String(item.unidadVenta || "").toLowerCase()];

            return unidad ? html.replace(`<span>${item.cantidad}</span>`, `<button type="button" class="dvc-cant" onclick="dvcEditarCantidad(${item.id})">${redondear(item.cantidad)} ${unidad.ab}</button>`) : html;
        };
    }

    window.dvcEditarCantidad = function (id) {
        const linea = duenoVentaCarrito.find(item => item.id === id);

        if (!linea) return;

        const producto = { id, nombre: linea.nombre, precio: linea.precio, unidadVenta: linea.unidadVenta };

        pedirCantidad(producto, linea.cantidad).then(cantidad => {
            if (!cantidad) return;

            linea.cantidad = cantidad;
            renderCarritoVenderDueno();
        });
    };

    // ---- Cobro en 1 toque ----
    window.dvcCobroRapido = function (metodo) {
        const total = resumenCarritoVenderDueno().total;

        elegirMetodoPagoVenderDueno(metodo);

        if (metodo === "efectivo") aplicarMontoRapidoVenderDueno(total);

        confirmarCobroVenderDueno();
    };

    function inyectarCobroRapido() {
        const contenido = document.getElementById("duenoVenderCobroContenido");

        if (!contenido || contenido.querySelector(".dvc-rapido") || typeof duenoVentaMetodoPago === "undefined" || duenoVentaMetodoPago) return;
        if (!contenido.querySelector(".dueno-metodo-pago-grid")) return;

        const total = resumenCarritoVenderDueno().total;
        const caja = document.createElement("div");

        caja.className = "dvc-rapido";
        caja.innerHTML = `<p class="dueno-estado">Cobro en 1 toque</p>
            <div class="dvc-rapido-botones">
                <button type="button" class="dvc-efectivo" onclick="dvcCobroRapido('efectivo')"><b>Efectivo justo</b><span>${dinero2(total)}</span></button>
                <button type="button" class="dvc-tarjeta" onclick="dvcCobroRapido('tarjeta')"><b>Tarjeta</b><span>${dinero2(total)}</span></button>
            </div>`;

        const resumen = contenido.querySelector(".dueno-card");
        if (resumen) resumen.insertAdjacentElement("afterend", caja); else contenido.prepend(caja);
    }

    const cobroOriginal = window.renderCobroVenderDueno;

    if (typeof cobroOriginal === "function") {
        window.renderCobroVenderDueno = function () {
            const resultado = cobroOriginal.apply(this, arguments);
            inyectarCobroRapido();
            return resultado;
        };
    }
})();
