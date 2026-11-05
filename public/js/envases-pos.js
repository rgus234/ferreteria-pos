/* Envases retornables (abarrotes) en la computadora.

   El precio del producto es el completo (liquido + envase). En el producto se anota cuanto vale el envase por pieza; en la venta,
   "Trae envase" descuenta ese importe cuando el cliente devuelve el vacio. Si trae menos envases que piezas, la linea se divide
   en dos (con envase y sin envase). Solo funciona con la funcion nueva "envases" encendida; apagada, nada de esto aparece. */

(function () {
    let mapa = {};

    const funcionEncendida = () => typeof window.funcionBeta === "function" && window.funcionBeta("envases");
    const redondear = valor => Math.round((Number(valor) + Number.EPSILON) * 100) / 100;

    window.envaseImporteDe = id => Number(mapa[String(id)]) || 0;

    async function cargar() {
        if (!funcionEncendida()) { mapa = {}; return; }

        try {
            const respuesta = await fetch("/envases");
            const datos = await respuesta.json().catch(() => ({}));
            mapa = datos && datos.envases ? datos.envases : {};
        } catch (error) { /* sin conexion: se queda lo ultimo que se sabia */ }
    }

    // Se llama despues de guardar un producto: guarda (o quita) el importe del envase escrito en el formulario.
    window.guardarEnvaseProductoPOS = async function (productoId) {
        const campo = document.getElementById("nuevoEnvaseImporte");
        const id = Number(productoId);

        if (!campo || !funcionEncendida() || !(id > 0)) return;

        const escrito = String(campo.value || "").trim();
        const actual = window.envaseImporteDe(id);

        if ((escrito === "" || Number(escrito) === 0) && !actual) return;
        if (Number(escrito) === actual) return;

        try {
            const respuesta = await fetch(`/envases/${id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ importe: escrito }) });
            const datos = await respuesta.json().catch(() => ({}));

            if (!respuesta.ok || !datos.ok) throw new Error(datos.error || "No se pudo guardar el envase.");

            if (datos.importe > 0) mapa[String(id)] = datos.importe; else delete mapa[String(id)];
        } catch (error) {
            if (typeof alertaPOS === "function") await alertaPOS(`El producto se guardó, pero el envase no: ${error.message}`, "Envase no guardado", "alerta");
        }
    };

    function lineaIgual(item, devuelto, excepto) {
        return carrito.findIndex((otra, i) => i !== excepto && Number(otra.id) === Number(item.id) && (otra.modoVenta || "bolsa") === (item.modoVenta || "bolsa") && Boolean(otra.envaseDevuelto) === devuelto);
    }

    function marcar(item, devuelto) {
        if (devuelto) {
            item.precioAntesEnvase = item.precio;
            item.precio = Math.max(0, redondear(item.precio - Number(item.envaseImporte)));
        } else if (item.precioAntesEnvase != null) {
            item.precio = item.precioAntesEnvase;
        }

        item.envaseDevuelto = devuelto;
    }

    // El boton "Trae envase" de la linea del carrito.
    window.alternarEnvaseDevueltoPOS = async function (indice) {
        const item = carrito[indice];

        if (!item || !(Number(item.envaseImporte) > 0)) return;

        if (item.envaseDevuelto) {
            marcar(item, false);
            const otra = lineaIgual(item, false, indice);

            if (otra >= 0) {
                carrito[otra].cantidad = Number((Number(carrito[otra].cantidad || 0) + Number(item.cantidad || 0)).toFixed(3));
                carrito.splice(indice, 1);
            }
        } else {
            const cantidad = Number(item.cantidad || 1);
            let trae = cantidad;

            if (cantidad > 1) {
                const respuesta = typeof pedirTextoPOS === "function" ? await pedirTextoPOS(`¿Cuántos envases trae? (de ${cantidad})`, String(cantidad), "Envase devuelto") : String(cantidad);

                if (respuesta === null || respuesta === undefined) return;

                trae = Math.floor(Number(String(respuesta).replace(",", ".")));

                if (!(trae >= 1)) return;
                if (trae > cantidad) trae = cantidad;
            }

            if (trae >= cantidad) {
                marcar(item, true);
                const otra = lineaIgual(item, true, indice);

                if (otra >= 0) {
                    carrito[otra].cantidad = Number((Number(carrito[otra].cantidad || 0) + cantidad).toFixed(3));
                    carrito.splice(indice, 1);
                }
            } else {
                item.cantidad = Number((cantidad - trae).toFixed(3));
                const aparte = { ...item, cantidad: trae };
                marcar(aparte, true);
                const otra = lineaIgual(aparte, true, -1);

                if (otra >= 0) carrito[otra].cantidad = Number((Number(carrito[otra].cantidad || 0) + trae).toFixed(3));
                else carrito.splice(indice + 1, 0, aparte);
            }
        }

        if (typeof actualizarCarrito === "function") actualizarCarrito();
    };

    document.addEventListener("nexo-funciones-beta", cargar);
    if (funcionEncendida()) cargar();
})();
