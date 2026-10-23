/* Por revisar: lotes de caducidad y merma (perfil abarrotes).

   En un negocio de perfil simple, "Por vencer" se convierte en "Por revisar":
   en vez de un producto con UNA fecha, muestra cada lote (cada entrada de
   mercancia) con su propia fecha, lo que cuesta tirarlo, y dos acciones:
   "Tirar" (merma) y "Llego mas" (entrada). Los demas perfiles siguen con la
   pantalla Por vencer de siempre. Servidor: lotes-server.js. */

const LOTES_ENCABEZADO_ORIGINAL = {};

function lotesPerfilSimple() {
    return typeof perfilTieneAbarrotes === "function" && perfilTieneAbarrotes();
}

function lotesTextoDias(fila) {
    if (fila.estado === "vencido") return `Vencio hace ${Math.abs(fila.dias)} dia${Math.abs(fila.dias) === 1 ? "" : "s"}`;
    if (fila.estado === "hoy") return "Vence hoy";
    if (fila.estado === "manana") return "Vence manana";
    return `En ${fila.dias} dias`;
}

function lotesFechaCorta(fecha) {
    return fecha ? new Date(`${fecha}T00:00:00`).toLocaleDateString("es-MX", { day: "numeric", month: "short" }) : "-";
}

function lotesPrepararPantalla(simple) {
    const pantalla = document.getElementById("pantallaPorVencer");
    if (!pantalla) return;

    const titulo = pantalla.querySelector(".bajo-header h2");
    const detalle = pantalla.querySelector(".bajo-header p");
    const etiquetas = pantalla.querySelectorAll(".bajo-resumen span");
    const encabezado = pantalla.querySelector("thead tr");
    const buscador = document.getElementById("buscarPorVencer");

    if (!LOTES_ENCABEZADO_ORIGINAL.titulo) {
        LOTES_ENCABEZADO_ORIGINAL.titulo = titulo?.textContent;
        LOTES_ENCABEZADO_ORIGINAL.detalle = detalle?.textContent;
        LOTES_ENCABEZADO_ORIGINAL.etiquetas = [...etiquetas].map(e => e.textContent);
        LOTES_ENCABEZADO_ORIGINAL.encabezado = encabezado?.innerHTML;
    }

    pantalla.querySelector("#lotesAcciones")?.remove();

    if (!simple) {
        if (titulo) titulo.textContent = LOTES_ENCABEZADO_ORIGINAL.titulo;
        if (detalle) detalle.textContent = LOTES_ENCABEZADO_ORIGINAL.detalle;
        etiquetas.forEach((e, i) => { e.textContent = LOTES_ENCABEZADO_ORIGINAL.etiquetas[i]; });
        if (encabezado) encabezado.innerHTML = LOTES_ENCABEZADO_ORIGINAL.encabezado;
        if (buscador) buscador.style.display = "";
        return;
    }

    if (titulo) titulo.textContent = "Por revisar";
    if (detalle) detalle.textContent = "Lo que vence en los proximos dias, por entrada de mercancia.";
    ["Por revisar (7 dias)", "Ya vencidos", "Lo que te costaria tirarlo"].forEach((texto, i) => { if (etiquetas[i]) etiquetas[i].textContent = texto; });
    if (encabezado) encabezado.innerHTML = "<th>Producto</th><th>Entro</th><th>Caduca</th><th>Cantidad</th><th>Estado</th><th>Acciones</th>";
    if (buscador) buscador.style.display = "none";

    const barra = document.createElement("div");
    barra.id = "lotesAcciones";
    barra.className = "lotes-acciones";
    barra.innerHTML = `
        <button type="button" onclick="lotesEntradaPorBusqueda()">+ Llego mercancia</button>
        <button type="button" onclick="lotesVerMermas()">Lo que he tirado</button>`;
    pantalla.querySelector(".bajo-resumen")?.insertAdjacentElement("afterend", barra);
}

async function lotesPedir(ruta, opciones) {
    const respuesta = await fetch(ruta, opciones);
    const cuerpo = await respuesta.json().catch(() => ({}));
    if (!respuesta.ok) throw new Error(cuerpo.error || "No se pudo completar");
    return cuerpo;
}

async function renderPorRevisarLotes() {
    const tabla = document.getElementById("tablaPorVencer");
    if (!tabla) return;

    tabla.innerHTML = `<tr><td colspan="6" class="bajo-vacio">Cargando...</td></tr>`;

    let datos;
    try {
        datos = await lotesPedir("/lotes/por-revisar?dias=7");
    } catch (error) {
        tabla.innerHTML = `<tr><td colspan="6" class="bajo-vacio">${escaparPOS(error.message)}</td></tr>`;
        return;
    }

    document.getElementById("vencerTotal").textContent = datos.lotes.length;
    document.getElementById("vencerVencidos").textContent = datos.resumen.vencidos;
    document.getElementById("vencerValorRiesgo").textContent = dinero(datos.resumen.valorCosto);
    document.getElementById("paginacionPorVencer").innerHTML = "";

    if (!datos.lotes.length) {
        tabla.innerHTML = `<tr><td colspan="6" class="bajo-vacio">Todo en orden: nada vence en los proximos 7 dias.</td></tr>`;
        return;
    }

    tabla.innerHTML = datos.lotes.map(fila => {
        const clase = fila.estado === "vencido" ? "sin-stock" : fila.estado === "pronto" || fila.estado === "semana" ? "bajo" : "critico";
        const estado = fila.estado === "vencido" ? "Vencido" : fila.estado === "hoy" || fila.estado === "manana" ? "Revisa ya" : "Vence pronto";

        return `
        <tr>
            <td><strong>${escaparPOS(fila.nombre)}</strong><span>${dinero(fila.valorVenta)} a precio de venta</span></td>
            <td>${lotesFechaCorta(fila.fechaEntrada)}</td>
            <td>${lotesFechaCorta(fila.fechaCaducidad)}</td>
            <td><strong class="stock-bajo-numero">${fila.cantidad} ${escaparPOS(fila.unidad)}</strong></td>
            <td><span class="estado-bajo ${clase}">${estado}</span><div>${lotesTextoDias(fila)}</div></td>
            <td class="acciones-bajo">
                <button type="button" onclick="lotesTirar(${fila.productoId}, ${fila.cantidad}, '${escaparPOS(fila.nombre).replace(/'/g, "&#39;")}')">Tirar</button>
                <button type="button" onclick="lotesEntrada(${fila.productoId}, '${escaparPOS(fila.nombre).replace(/'/g, "&#39;")}')">Llego mas</button>
            </td>
        </tr>`;
    }).join("");
}

async function lotesTirar(productoId, cantidadSugerida, nombre) {
    const texto = await pedirTextoPOS(`Cuanto de "${nombre}" vas a tirar?`, String(cantidadSugerida), "Tirar producto");
    if (texto === null || texto === undefined) return;

    const cantidad = Number(String(texto).replace(",", "."));
    if (!(cantidad > 0)) { alertaPOS("Escribe una cantidad mayor a cero.", "Tirar producto", "alerta"); return; }

    try {
        const r = await lotesPedir(`/productos/${productoId}/merma`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ cantidad, motivo: "caducado" })
        });
        alertaPOS(`Anotado. Perdiste ${dinero(r.perdidoCosto)} a costo (${dinero(r.perdidoVenta)} a precio de venta).`, "Tirar producto", "info");
        await renderPorRevisarLotes();
        if (typeof cargarProductos === "function") cargarProductos().catch(() => {});
    } catch (error) {
        alertaPOS(error.message, "Tirar producto", "alerta");
    }
}

async function lotesEntrada(productoId, nombre) {
    const texto = await pedirTextoPOS(`Cuanto llego de "${nombre}"? (la fecha de caducidad se pone sola con su vida util)`, "", "Llego mercancia");
    if (texto === null || texto === undefined) return;

    const cantidad = Number(String(texto).replace(",", "."));
    if (!(cantidad > 0)) { alertaPOS("Escribe una cantidad mayor a cero.", "Llego mercancia", "alerta"); return; }

    try {
        const r = await lotesPedir(`/productos/${productoId}/entrada`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ cantidad })
        });
        const caduca = r.fechaCaducidad ? ` Caduca el ${lotesFechaCorta(r.fechaCaducidad)}.` : " Sin fecha de caducidad: ponle vida util al producto para que se marque sola.";
        alertaPOS(`Listo, ahora tienes ${r.stock}.${caduca}`, "Llego mercancia", "info");
        await renderPorRevisarLotes();
        if (typeof cargarProductos === "function") cargarProductos().catch(() => {});
    } catch (error) {
        alertaPOS(error.message, "Llego mercancia", "alerta");
    }
}

async function lotesEntradaPorBusqueda() {
    if (!Array.isArray(todosProductos) || !todosProductos.length) {
        try { await cargarProductos(); } catch (error) { /* se avisa abajo */ }
    }

    const texto = await pedirTextoPOS("Que producto llego? Escribe su nombre o su codigo.", "", "Llego mercancia");
    const buscado = String(texto || "").trim().toLowerCase();
    if (!buscado) return;

    const coincidencias = (todosProductos || []).filter(p =>
        String(p.codigo || "").toLowerCase() === buscado || String(p.nombre || "").toLowerCase().includes(buscado)
    );

    if (coincidencias.length !== 1) {
        alertaPOS(coincidencias.length ? `Hay ${coincidencias.length} productos con "${texto}". Escribe mas del nombre.` : `No encontre "${texto}" en tu inventario.`, "Llego mercancia", "alerta");
        return;
    }

    await lotesEntrada(coincidencias[0].id, coincidencias[0].nombre);
}

async function lotesVerMermas() {
    try {
        const datos = await lotesPedir("/lotes/mermas?dias=30");

        if (!datos.mermas.length) {
            alertaPOS("En los ultimos 30 dias no has tirado nada.", "Lo que he tirado", "info");
            return;
        }

        const principales = datos.mermas.slice(0, 5).map(m => `${m.cantidad} ${m.nombre} (${dinero(m.perdidoCosto)})`).join(", ");
        alertaPOS(`En 30 dias tiraste ${dinero(datos.totalCosto)} a costo (${dinero(datos.totalVenta)} a precio de venta). Lo ultimo: ${principales}.`, "Lo que he tirado", "info");
    } catch (error) {
        alertaPOS(error.message, "Lo que he tirado", "alerta");
    }
}

const mostrarPorVencerOriginal = window.mostrarPorVencer;

window.mostrarPorVencer = async function () {
    if (!lotesPerfilSimple()) {
        lotesPrepararPantalla(false);
        return mostrarPorVencerOriginal();
    }

    if (typeof ocultarPantallasPrincipales === "function") ocultarPantallasPrincipales();

    const pantalla = document.getElementById("pantallaPorVencer");
    if (pantalla) pantalla.style.display = "block";

    if (typeof actualizarTopbarContexto === "function") {
        actualizarTopbarContexto("Por revisar", "Lo que vence en los proximos dias", "por-vencer");
    }

    lotesPrepararPantalla(true);
    await renderPorRevisarLotes();
};

