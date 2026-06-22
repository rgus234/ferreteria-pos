function dinero(valor) {
    return Number(valor || 0).toLocaleString("es-MX", {
        style: "currency",
        currency: "MXN"
    });
}

function fechaCorta(valor) {
    if (!valor) return "";

    return new Date(valor).toLocaleString("es-MX", {
        day: "2-digit",
        month: "short",
        hour: "2-digit",
        minute: "2-digit"
    });
}

async function json(url) {
    const respuesta =
        await fetch(url);

    if (!respuesta.ok) {
        throw new Error(`No se pudo cargar ${url}`);
    }

    return respuesta.json();
}

function ventasHoy(historial) {
    const hoy =
        new Date().toDateString();

    return historial.filter(venta =>
        new Date(venta.fecha).toDateString() === hoy
    );
}

function renderBajos(productos) {
    const bajos =
        productos
            .filter(producto => Number(producto.stock || 0) <= Number(producto.stock_minimo || 3))
            .sort((a, b) => Number(a.stock || 0) - Number(b.stock || 0));

    document.getElementById("duenoInventarioBajo").textContent =
        `${bajos.length} productos`;

    document.getElementById("duenoListaBajos").innerHTML =
        bajos.length
            ? bajos.slice(0, 6).map(producto => `
                <div class="fila-dueno">
                    <div>
                        <strong>${producto.nombre}</strong>
                        <span>${producto.codigo || "Sin codigo"} · Stock ${producto.stock}</span>
                    </div>
                    <b>${dinero(producto.precio)}</b>
                </div>
            `).join("")
            : `<div class="vacio">No hay productos bajos.</div>`;
}

function renderCreditos(datos) {
    const clientes =
        datos.clientes || [];

    document.getElementById("duenoCreditosTotal").textContent =
        dinero(datos.total || 0);

    document.getElementById("duenoClientesCredito").textContent =
        `${datos.clientesConAdeudo || 0} clientes`;

    document.getElementById("duenoListaCreditos").innerHTML =
        clientes.filter(cliente => Number(cliente.saldo || 0) > 0).length
            ? clientes
                .filter(cliente => Number(cliente.saldo || 0) > 0)
                .slice(0, 5)
                .map(cliente => `
                    <div class="fila-dueno">
                        <div>
                            <strong>${cliente.nombre}</strong>
                            <span>${cliente.telefono || "Sin telefono"}</span>
                        </div>
                        <b>${dinero(cliente.saldo)}</b>
                    </div>
                `).join("")
            : `<div class="vacio">No hay creditos pendientes.</div>`;
}

function renderVentas(historial) {
    const hoy =
        ventasHoy(historial);

    const total =
        hoy.reduce((suma, venta) => suma + Number(venta.total || 0), 0);

    const promedio =
        hoy.length ? total / hoy.length : 0;

    document.getElementById("duenoVentasHoy").textContent =
        dinero(total);

    document.getElementById("duenoTransacciones").textContent =
        hoy.length;

    document.getElementById("duenoTicketPromedio").textContent =
        dinero(promedio);

    document.getElementById("duenoVentasEstado").textContent =
        hoy.length ? "Ventas en movimiento" : "Aun sin ventas hoy";

    document.getElementById("duenoUltimasVentas").innerHTML =
        historial.length
            ? historial.slice(0, 8).map(venta => `
                <div class="fila-dueno">
                    <div>
                        <strong>Venta registrada</strong>
                        <span>${fechaCorta(venta.fecha)}</span>
                    </div>
                    <b>${dinero(venta.total)}</b>
                </div>
            `).join("")
            : `<div class="vacio">Todavia no hay ventas registradas.</div>`;
}

async function cargarPanelDueno() {
    const boton =
        document.getElementById("btnActualizarDueno");

    boton.disabled = true;
    boton.textContent = "Cargando";

    try {
        const [productos, historial, creditos] =
            await Promise.all([
                json("/productos"),
                json("/historial"),
                json("/creditos")
            ]);

        renderVentas(historial);
        renderBajos(productos);
        renderCreditos(creditos);

        document.getElementById("duenoEstado").textContent =
            "Datos en tiempo real del POS";

        document.getElementById("duenoActualizado").textContent =
            new Date().toLocaleTimeString("es-MX", {
                hour: "2-digit",
                minute: "2-digit"
            });
    } catch (error) {
        document.getElementById("duenoEstado").textContent =
            "No se pudo conectar con el POS";
    } finally {
        boton.disabled = false;
        boton.textContent = "Actualizar";
    }
}

window.addEventListener("load", () => {
    cargarPanelDueno();
    setInterval(cargarPanelDueno, 60000);
});
