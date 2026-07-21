const DUENO_TOKEN_KEY = "nexoCuentaSesionToken";

let duenoCarrito = [];
let duenoUltimosResultados = [];
let duenoProductoDetalleActual = null;
let duenoInventarioCategoria = "";

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

function escaparDueno(texto) {
    return String(texto || "").replace(/[&<>"']/g, caracter => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;"
    }[caracter]));
}

function tokenGuardado() {
    return localStorage.getItem(DUENO_TOKEN_KEY);
}

function mostrarLoginDueno() {
    document.getElementById("duenoApp").style.display = "none";
    document.getElementById("duenoVentas").style.display = "none";
    document.getElementById("duenoTabs").style.display = "none";
    document.getElementById("duenoLogin").style.display = "flex";
}

function mostrarAppDueno() {
    document.getElementById("duenoLogin").style.display = "none";
    document.getElementById("duenoApp").style.display = "block";
    document.getElementById("duenoTabs").style.display = "flex";
}

async function fetchAutenticado(url, opciones = {}) {
    const token = tokenGuardado();

    const respuesta =
    await fetch(url, {
        ...opciones,
        headers: {
            ...(opciones.headers || {}),
            Authorization: `Bearer ${token}`
        }
    });

    if (respuesta.status === 401) {
        localStorage.removeItem(DUENO_TOKEN_KEY);
        mostrarLoginDueno();
        throw new Error("Sesion expirada");
    }

    const datos =
    await respuesta.json().catch(() => null);

    if (!respuesta.ok) {
        throw new Error(datos?.error || `No se pudo completar la solicitud a ${url}`);
    }

    return datos;
}

async function iniciarSesionDueno() {
    const correo =
    document.getElementById("duenoLoginCorreo")?.value.trim();

    const password =
    document.getElementById("duenoLoginPassword")?.value || "";

    const cajaError =
    document.getElementById("duenoLoginError");

    const boton =
    document.getElementById("btnDuenoLogin");

    cajaError.style.display = "none";

    if (!correo || !password) {
        cajaError.textContent = "Escribe tu correo y tu contraseña.";
        cajaError.style.display = "block";
        return;
    }

    boton.disabled = true;
    boton.textContent = "Entrando...";

    try {
        const respuesta =
        await fetch("/cuenta/login", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ correo, password })
        });

        const datos =
        await respuesta.json();

        if (!datos.ok) {
            cajaError.textContent = datos.error || "No se pudo iniciar sesion.";
            cajaError.style.display = "block";
            return;
        }

        localStorage.setItem(DUENO_TOKEN_KEY, datos.token);

        document.getElementById("duenoNegocio").textContent =
        datos.negocio?.nombre || "Tu negocio";

        mostrarAppDueno();
        cargarPanelDueno();
    } catch (error) {
        cajaError.textContent = "No se pudo conectar. Revisa tu internet e intenta de nuevo.";
        cajaError.style.display = "block";
    } finally {
        boton.disabled = false;
        boton.textContent = "Entrar";
    }
}

function mostrarToastDueno(mensaje) {
    const toast =
    document.getElementById("duenoToast");

    toast.textContent = mensaje;
    toast.style.display = "block";

    clearTimeout(window.__duenoToastTimer);

    window.__duenoToastTimer =
    setTimeout(() => { toast.style.display = "none"; }, 2400);
}

function proximamenteDueno() {
    mostrarToastDueno("Esta seccion llega en una proxima actualizacion.");
}

function saludoHora() {
    const hora =
    new Date().getHours();

    if (hora < 12) return "Buenos días";
    if (hora < 19) return "Buenas tardes";

    return "Buenas noches";
}

function ventasDeFecha(historial, fecha) {
    const clave =
    fecha.toDateString();

    return historial.filter(venta =>
        new Date(venta.fecha).toDateString() === clave
    );
}

function productosVendidosHoy(ventasHoyArr) {
    return ventasHoyArr.reduce((total, venta) => {
        const productos =
        Array.isArray(venta.productos) ? venta.productos : [];

        return total + productos.reduce((sub, item) => sub + Number(item.cantidad || 0), 0);
    }, 0);
}

// Dibuja un sparkline SVG chico a partir de cualquier arreglo de
// valores numericos (sin depender de Chart.js -- decision ya tomada
// para mantener esta pagina ligera en telefono). Reusada tanto por
// el sparkline horario de Inicio (12 cortes fijos) como por la
// grafica "Ventas por dia" de Reportes (hasta 30 puntos).
function dibujarSparklineSVG(svgId, valores) {
    const svg =
    document.getElementById(svgId);

    if (!svg) return;

    if (valores.length < 2) {
        svg.innerHTML = "";
        return;
    }

    const max =
    Math.max(...valores, 1);

    const puntos =
    valores.map((valor, indice) => {
        const x = (indice / (valores.length - 1)) * 100;
        const y = 26 - (valor / max) * 24;
        return `${x.toFixed(1)},${y.toFixed(1)}`;
    }).join(" ");

    svg.innerHTML =
    `<polyline points="${puntos}" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>`;
}

// Mismos 12 cortes horarios (8:00-19:00) que ya usa el dashboard de
// escritorio (renderGraficaDashboardVentas en sales-history-documents.js).
function renderSparklineSVG(ventasHoyArr) {
    const porHora =
    new Array(12).fill(0);

    ventasHoyArr.forEach(venta => {
        const indice =
        new Date(venta.fecha).getHours() - 8;

        if (indice >= 0 && indice < porHora.length) {
            porHora[indice] += Number(venta.total || 0);
        }
    });

    dibujarSparklineSVG("duenoSparkline", porHora);
}

function renderBajos(productos) {
    const bajos =
        productos
            .filter(producto => Number(producto.stock || 0) <= Number(producto.stock_minimo || 3))
            .sort((a, b) => Number(a.stock || 0) - Number(b.stock || 0));

    document.getElementById("duenoInventarioBajo").textContent =
        `${bajos.length} producto${bajos.length === 1 ? "" : "s"} con stock crítico`;

    document.getElementById("duenoListaBajos").innerHTML =
        bajos.length
            ? bajos.slice(0, 5).map(producto => `
                <div class="fila-dueno">
                    <div>
                        <strong>${escaparDueno(producto.nombre)}</strong>
                        <span>${escaparDueno(producto.codigo || "Sin codigo")} · Stock ${producto.stock}</span>
                    </div>
                    <b>${dinero(producto.precio)}</b>
                </div>
            `).join("")
            : `<div class="vacio">Sin alertas por ahora.</div>`;
}

function renderCreditos(datos) {
    const clientes =
        (datos.clientes || []).filter(cliente => Number(cliente.saldo || 0) > 0);

    document.getElementById("duenoCreditosTotal").textContent =
        dinero(datos.total || 0);

    document.getElementById("duenoClientesCredito").textContent =
        `${datos.clientesConAdeudo || 0} clientes`;

    document.getElementById("duenoListaCreditos").innerHTML =
        clientes.length
            ? clientes
                .slice(0, 5)
                .map(cliente => `
                    <div class="fila-dueno">
                        <div>
                            <strong>${escaparDueno(cliente.nombre)}</strong>
                            <span>${escaparDueno(cliente.telefono || "Sin telefono")}</span>
                        </div>
                        <b>${dinero(cliente.saldo)}</b>
                    </div>
                `).join("")
            : `<div class="vacio">No hay creditos pendientes.</div>`;
}

function renderVentas(historial) {
    const hoy =
    ventasDeFecha(historial, new Date());

    const ayer =
    ventasDeFecha(historial, new Date(Date.now() - 86400000));

    const totalHoy =
    hoy.reduce((suma, venta) => suma + Number(venta.total || 0), 0);

    const totalAyer =
    ayer.reduce((suma, venta) => suma + Number(venta.total || 0), 0);

    const promedio =
    hoy.length ? totalHoy / hoy.length : 0;

    // Misma formula que sales-history-documents.js (dashboard de escritorio)
    const diferencia =
    totalAyer > 0
        ? ((totalHoy - totalAyer) / totalAyer) * 100
        : totalHoy > 0 ? 100 : 0;

    document.getElementById("duenoVentasHoy").textContent =
        dinero(totalHoy);

    document.getElementById("duenoTicketPromedio").textContent =
        dinero(promedio);

    document.getElementById("duenoProductosVendidos").textContent =
        productosVendidosHoy(hoy);

    document.getElementById("duenoTransacciones").textContent =
        hoy.length;

    const estado =
    document.getElementById("duenoVentasEstado");

    estado.textContent =
        hoy.length || ayer.length
            ? `${diferencia >= 0 ? "+" : ""}${diferencia.toFixed(0)}% vs ayer`
            : "Aun sin ventas hoy";

    estado.className =
        diferencia >= 0 ? "dueno-estado-positivo" : "dueno-estado-negativo";

    renderSparklineSVG(hoy);

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
    const estado =
    document.getElementById("duenoEstado");

    if (estado) estado.textContent = "Actualizando...";

    try {
        const [productos, historial, creditos] =
        await Promise.all([
            fetchAutenticado("/productos"),
            fetchAutenticado("/historial"),
            fetchAutenticado("/creditos")
        ]);

        renderVentas(historial);
        renderBajos(productos);
        renderCreditos(creditos);
        guardarCatalogoLocal(productos);

        if (estado) estado.textContent = "Datos en tiempo real del POS";

        document.getElementById("duenoActualizado").textContent =
            new Date().toLocaleTimeString("es-MX", {
                hour: "2-digit",
                minute: "2-digit"
            });
    } catch (error) {
        if (tokenGuardado() && estado) {
            estado.textContent = "No se pudo conectar con el POS";
        }
    }
}

// ---------------- pestañas ----------------

function cambiarTabDueno(tab) {
    document.querySelectorAll(".dueno-tabs button").forEach(boton => {
        boton.classList.toggle("activo", boton.dataset.tab === tab);
    });

    document.getElementById("duenoApp").style.display = tab === "inicio" ? "block" : "none";
    document.getElementById("duenoReportes").style.display = tab === "reportes" ? "block" : "none";
    document.getElementById("duenoVentas").style.display = tab === "ventas" ? "block" : "none";
    document.getElementById("duenoInventario").style.display = tab === "inventario" ? "block" : "none";
    document.getElementById("duenoMas").style.display = tab === "mas" ? "block" : "none";

    if (tab !== "mas") cerrarSubpantallaMasDueno();

    if (tab === "reportes") cargarPanelReportesDueno();
    if (tab === "ventas") cargarPanelVentasDueno();
    if (tab === "inventario") cargarPanelInventarioDueno();
    if (tab === "mas") cargarPanelMasDueno();
}

function cambiarSubtabVentasDueno(subtab) {
    document.querySelectorAll(".dueno-ventas-subtabs button").forEach(boton => {
        boton.classList.toggle("activo", boton.dataset.subtab === subtab);
    });

    document.getElementById("duenoVentasNuevo").classList.toggle("activo", subtab === "nuevo");
    document.getElementById("duenoVentasPendientes").classList.toggle("activo", subtab === "pendientes");
}

// ---------------- pestaña Ventas: nuevo pedido ----------------

async function buscarProductoVentaDueno(texto) {
    const contenedor =
    document.getElementById("duenoResultadosBusqueda");

    duenoUltimosResultados =
    await buscarEnCatalogoLocal(texto);

    contenedor.innerHTML =
        duenoUltimosResultados.length
            ? duenoUltimosResultados.map(producto => `
                <div class="fila-dueno fila-dueno-producto">
                    <div class="dueno-miniatura" onclick="verDetalleProductoDueno(${producto.id})">
                        ${producto.imagenUrl
                            ? `<img src="${producto.imagenUrl}" alt="" loading="lazy">`
                            : `<span class="dueno-miniatura-vacia">Sin foto</span>`}
                    </div>
                    <div onclick="verDetalleProductoDueno(${producto.id})">
                        <strong>${escaparDueno(producto.nombre)}</strong>
                        <span>${escaparDueno(producto.codigo || "Sin codigo")} · Stock ${producto.stock} · ${dinero(producto.precio)}</span>
                    </div>
                    <button type="button" class="dueno-boton-agregar" onclick="agregarAlCarritoDueno(${producto.id})">+</button>
                </div>
            `).join("")
            : (texto.trim() ? `<div class="vacio">Sin resultados en tu catalogo guardado.</div>` : "");
}

function verDetalleProductoDueno(id) {
    const producto =
    duenoUltimosResultados.find(item => item.id === id);

    if (!producto) return;

    duenoProductoDetalleActual = producto;

    document.getElementById("duenoDetalleImagen").innerHTML =
        producto.imagenUrl
            ? `<img src="${producto.imagenUrl}" alt="">`
            : `<div class="dueno-detalle-sin-foto">Sin foto todavia</div>`;

    document.getElementById("duenoDetalleNombre").textContent = producto.nombre;
    document.getElementById("duenoDetalleCodigo").textContent = producto.codigo || "Sin codigo";
    document.getElementById("duenoDetallePrecio").textContent = dinero(producto.precio);

    const specs = [["Stock disponible", String(producto.stock)]];

    if (producto.marca) specs.unshift(["Marca", producto.marca]);
    if (producto.categoria) specs.push(["Categoria", producto.categoria]);
    if (producto.unidadVenta) specs.push(["Unidad de venta", producto.unidadVenta]);
    if (producto.descripcion) specs.push(["Descripcion", producto.descripcion]);

    document.getElementById("duenoDetalleSpecs").innerHTML =
        specs.map(([etiqueta, valor]) => `
            <div class="dueno-detalle-spec">
                <span>${escaparDueno(etiqueta)}</span>
                <strong>${escaparDueno(valor)}</strong>
            </div>
        `).join("");

    document.getElementById("duenoDetalleOverlay").style.display = "flex";
}

function cerrarDetalleProductoDueno() {
    document.getElementById("duenoDetalleOverlay").style.display = "none";
}

function agregarDesdeDetalleDueno() {
    if (!duenoProductoDetalleActual) return;

    agregarAlCarritoDueno(duenoProductoDetalleActual.id);
    cerrarDetalleProductoDueno();
    mostrarToastDueno("Agregado al pedido.");
}

function agregarAlCarritoDueno(id) {
    const producto =
    duenoUltimosResultados.find(item => item.id === id);

    if (!producto) return;

    const existente =
    duenoCarrito.find(item => item.productoId === id);

    if (existente) {
        existente.cantidad += 1;
    } else {
        duenoCarrito.push({
            productoId: producto.id,
            codigo: producto.codigo,
            nombre: producto.nombre,
            precioUnitario: producto.precio,
            cantidad: 1
        });
    }

    renderCarritoDueno();
}

function cambiarCantidadCarritoDueno(id, delta) {
    const item =
    duenoCarrito.find(actual => actual.productoId === id);

    if (!item) return;

    item.cantidad = Math.max(0, item.cantidad + delta);

    if (item.cantidad === 0) {
        duenoCarrito = duenoCarrito.filter(actual => actual.productoId !== id);
    }

    renderCarritoDueno();
}

function renderCarritoDueno() {
    const card =
    document.getElementById("duenoCarritoCard");

    const lista =
    document.getElementById("duenoCarritoLista");

    const totalEl =
    document.getElementById("duenoCarritoTotal");

    if (duenoCarrito.length === 0) {
        card.style.display = "none";
        return;
    }

    card.style.display = "block";

    const total =
    duenoCarrito.reduce((suma, item) => suma + item.precioUnitario * item.cantidad, 0);

    totalEl.textContent = dinero(total);

    lista.innerHTML =
        duenoCarrito.map(item => `
            <div class="fila-dueno">
                <div>
                    <strong>${escaparDueno(item.nombre)}</strong>
                    <span>${dinero(item.precioUnitario)} c/u</span>
                </div>
                <div class="dueno-cantidad-control">
                    <button type="button" onclick="cambiarCantidadCarritoDueno(${item.productoId}, -1)">&minus;</button>
                    <span>${item.cantidad}</span>
                    <button type="button" onclick="cambiarCantidadCarritoDueno(${item.productoId}, 1)">+</button>
                </div>
            </div>
        `).join("");
}

function crearEventIdDueno() {
    if (window.crypto?.randomUUID) return crypto.randomUUID();

    return `dueno-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function limpiarFormularioPedidoDueno() {
    duenoCarrito = [];
    renderCarritoDueno();

    document.getElementById("duenoClienteNombre").value = "";
    document.getElementById("duenoClienteTelefono").value = "";
    document.getElementById("duenoClienteNotas").value = "";
    document.getElementById("duenoBuscarProducto").value = "";
    document.getElementById("duenoResultadosBusqueda").innerHTML = "";
}

async function guardarPedidoDueno() {
    const clienteNombre =
    document.getElementById("duenoClienteNombre")?.value.trim();

    const clienteTelefono =
    document.getElementById("duenoClienteTelefono")?.value.trim() || "";

    const notas =
    document.getElementById("duenoClienteNotas")?.value.trim() || "";

    if (!clienteNombre) {
        mostrarToastDueno("Escribe el nombre del cliente.");
        return;
    }

    if (duenoCarrito.length === 0) {
        mostrarToastDueno("Agrega al menos un producto.");
        return;
    }

    const cotizacion = {
        eventId: crearEventIdDueno(),
        clienteNombre,
        clienteTelefono,
        notas,
        items: duenoCarrito.map(item => ({
            productoId: item.productoId,
            codigo: item.codigo,
            nombre: item.nombre,
            precioUnitario: item.precioUnitario,
            cantidad: item.cantidad
        })),
        creadoEn: new Date().toISOString()
    };

    let sincronizada = false;

    if (navigator.onLine) {
        try {
            const datos =
            await fetchAutenticado("/dueno/cotizaciones", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(cotizacion)
            });

            sincronizada = Boolean(datos?.ok);
        } catch (error) {
            sincronizada = false;
        }
    }

    if (!sincronizada) {
        await guardarCotizacionLocal({ ...cotizacion, estadoSync: "pendiente" });
    }

    limpiarFormularioPedidoDueno();
    mostrarToastDueno(sincronizada ? "Pedido guardado y enviado." : "Guardado en este telefono -- se sube solo cuando haya señal.");
    cambiarSubtabVentasDueno("pendientes");
    await cargarCotizacionesPendientesDueno();
}

// ---------------- pestaña Ventas: pendientes ----------------

async function cargarCotizacionesPendientesDueno() {
    const contenedor =
    document.getElementById("duenoListaPendientes");

    const locales =
    await listarCotizacionesLocales();

    let remotas = [];

    if (navigator.onLine) {
        try {
            const datos =
            await fetchAutenticado("/dueno/cotizaciones?estado=pendiente");

            remotas = datos?.cotizaciones || [];
        } catch (error) {
            remotas = [];
        }
    }

    const filasLocales =
    locales.map(cotizacion => {
        const total =
        cotizacion.items.reduce((suma, item) => suma + item.precioUnitario * item.cantidad, 0);

        return `
            <div class="fila-dueno">
                <div>
                    <strong>${escaparDueno(cotizacion.clienteNombre)}</strong>
                    <span>${cotizacion.items.length} producto(s) · Sin sincronizar</span>
                </div>
                <b>${dinero(total)}</b>
            </div>
        `;
    }).join("");

    const filasRemotas =
    remotas.map(cotizacion => `
        <div class="fila-dueno fila-dueno-columna">
            <div>
                <strong>${escaparDueno(cotizacion.clienteNombre)}</strong>
                <span>${cotizacion.items.length} producto(s) · Pendiente de revisar</span>
            </div>
            <div class="dueno-fila-acciones">
                <b>${dinero(cotizacion.totalEstimado)}</b>
                <button type="button" class="dueno-link" onclick="confirmarCotizacionDueno(${cotizacion.id})">Confirmar</button>
                <button type="button" class="dueno-link dueno-link-peligro" onclick="descartarCotizacionDueno(${cotizacion.id})">Descartar</button>
            </div>
        </div>
    `).join("");

    contenedor.innerHTML =
        (filasLocales + filasRemotas) || `<div class="vacio">No hay cotizaciones pendientes.</div>`;

    actualizarBadgeVentasDueno(locales.length);
}

async function actualizarEstadoCotizacionDueno(id, estado) {
    try {
        await fetchAutenticado(`/dueno/cotizaciones/${id}/estado`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ estado })
        });

        await cargarCotizacionesPendientesDueno();
    } catch (error) {
        mostrarToastDueno("No se pudo actualizar. Revisa tu conexion.");
    }
}

function confirmarCotizacionDueno(id) {
    actualizarEstadoCotizacionDueno(id, "confirmada");
}

function descartarCotizacionDueno(id) {
    actualizarEstadoCotizacionDueno(id, "descartada");
}

function actualizarBadgeVentasDueno(pendientesLocales) {
    const badge =
    document.getElementById("duenoVentasBadge");

    if (!badge) return;

    if (pendientesLocales > 0) {
        badge.textContent = pendientesLocales;
        badge.style.display = "flex";
    } else {
        badge.style.display = "none";
    }
}

function actualizarChipConexionDueno() {
    const chip =
    document.getElementById("duenoConexionEstado");

    if (!chip) return;

    chip.textContent =
        navigator.onLine
            ? "Conectado"
            : "Sin conexion -- tus pedidos se guardan en este telefono";
}

async function sincronizarYRecargarDueno() {
    if (!navigator.onLine) {
        mostrarToastDueno("Sigues sin conexion.");
        return;
    }

    const sincronizadas =
    await sincronizarCotizacionesPendientes();

    if (sincronizadas > 0) {
        mostrarToastDueno(`${sincronizadas} pedido(s) sincronizado(s).`);
    }

    await cargarCotizacionesPendientesDueno();
}

function cargarPanelVentasDueno() {
    actualizarChipConexionDueno();
    cargarCotizacionesPendientesDueno();
}

window.addEventListener("online", () => {
    actualizarChipConexionDueno();
    sincronizarYRecargarDueno();
});

window.addEventListener("offline", actualizarChipConexionDueno);

// ---------------- pestaña Reportes ----------------

let duenoReportePeriodo = "mes";

function calcularTendenciaDueno(actual, anterior) {
    if (anterior > 0) return ((actual - anterior) / anterior) * 100;
    return actual > 0 ? 100 : 0;
}

async function cargarPanelReportesDueno(periodo) {
    if (periodo) duenoReportePeriodo = periodo;

    document.querySelectorAll(".dueno-chip-periodo").forEach(boton => {
        boton.classList.toggle("activo", boton.dataset.periodo === duenoReportePeriodo);
    });

    const estado =
    document.getElementById("duenoReportesEstado");

    if (estado) estado.textContent = "Actualizando...";

    try {
        const datos =
        await fetchAutenticado(`/reportes/ventas?periodo=${duenoReportePeriodo}`);

        renderReportesDueno(datos);

        if (estado) estado.textContent = "Datos en tiempo real del POS";
    } catch (error) {
        if (estado) estado.textContent = "No se pudo cargar el reporte.";
    }
}

function renderReportesDueno(datos) {
    const resumen = datos.resumen || {};
    const anterior = datos.resumenAnterior || {};

    const tendenciaTotal = calcularTendenciaDueno(Number(resumen.total || 0), Number(anterior.total || 0));
    const tendenciaTransacciones = calcularTendenciaDueno(Number(resumen.transacciones || 0), Number(anterior.transacciones || 0));
    const tendenciaTicket = calcularTendenciaDueno(Number(resumen.ticket_promedio || 0), Number(anterior.ticket_promedio || 0));
    const tendenciaProductos = calcularTendenciaDueno(Number(resumen.productos_vendidos || 0), Number(anterior.productos_vendidos || 0));

    document.getElementById("duenoReporteTotal").textContent = dinero(resumen.total || 0);
    document.getElementById("duenoReporteTransacciones").textContent = resumen.transacciones || 0;
    document.getElementById("duenoReporteTicket").textContent = dinero(resumen.ticket_promedio || 0);
    document.getElementById("duenoReporteProductos").textContent = resumen.productos_vendidos || 0;

    pintarTendenciaDueno("duenoReporteTotalTendencia", tendenciaTotal);
    pintarTendenciaDueno("duenoReporteTransaccionesTendencia", tendenciaTransacciones);
    pintarTendenciaDueno("duenoReporteTicketTendencia", tendenciaTicket);
    pintarTendenciaDueno("duenoReporteProductosTendencia", tendenciaProductos);

    const porDia = datos.porDia || [];
    dibujarSparklineSVG("duenoReporteSparkline", porDia.map(fila => Number(fila.total || 0)));

    renderMetodosPagoDueno(datos.metodosPago || []);
    renderProductosVendidosDueno(datos.productosVendidos || []);
    renderUltimasVentasReporteDueno(datos.ultimas || []);
}

function pintarTendenciaDueno(id, valor) {
    const elemento =
    document.getElementById(id);

    if (!elemento) return;

    elemento.textContent = `${valor >= 0 ? "+" : ""}${valor.toFixed(0)}% vs periodo anterior`;
    elemento.className = valor >= 0 ? "dueno-estado-positivo" : "dueno-estado-negativo";
}

function renderMetodosPagoDueno(metodos) {
    const contenedor =
    document.getElementById("duenoReporteMetodos");

    if (!metodos.length) {
        contenedor.innerHTML = `<div class="vacio">Sin ventas en este periodo.</div>`;
        return;
    }

    const max =
    Math.max(...metodos.map(metodo => Number(metodo.total || 0)), 1);

    const nombresMetodo = { efectivo: "Efectivo", tarjeta: "Tarjeta", transferencia: "Transferencia" };

    contenedor.innerHTML =
        metodos.map(metodo => `
            <div class="dueno-barra-item">
                <div class="dueno-barra-item-cabeza">
                    <span>${escaparDueno(nombresMetodo[metodo.metodo_pago] || metodo.metodo_pago || "Otro")}</span>
                    <b>${dinero(metodo.total)}</b>
                </div>
                <div class="dueno-barra-uso"><div class="dueno-barra-uso-relleno" style="width:${(Number(metodo.total || 0) / max * 100).toFixed(0)}%;"></div></div>
            </div>
        `).join("");
}

function renderProductosVendidosDueno(productos) {
    const contenedor =
    document.getElementById("duenoReporteProductosLista");

    contenedor.innerHTML =
        productos.length
            ? productos.slice(0, 6).map(producto => `
                <div class="fila-dueno">
                    <div>
                        <strong>${escaparDueno(producto.nombre || "Producto")}</strong>
                        <span>${Number(producto.cantidad || 0)} vendidos</span>
                    </div>
                    <b>${dinero(producto.total)}</b>
                </div>
            `).join("")
            : `<div class="vacio">Sin productos vendidos en este periodo.</div>`;
}

function renderUltimasVentasReporteDueno(ventas) {
    const contenedor =
    document.getElementById("duenoReporteUltimas");

    contenedor.innerHTML =
        ventas.length
            ? ventas.map(venta => `
                <div class="fila-dueno fila-dueno-columna">
                    <div>
                        <strong>${escaparDueno(venta.folio || `V-${String(venta.id || 0).padStart(6, "0")}`)}</strong>
                        <span>${fechaCorta(venta.fecha)} · ${escaparDueno(venta.cliente_nombre || "Publico general")}</span>
                    </div>
                    <div class="dueno-fila-acciones">
                        <b>${dinero(venta.total)}</b>
                        <button type="button" class="dueno-link" onclick="reimprimirVentaReporteDueno(${venta.id})">Reimprimir</button>
                    </div>
                </div>
            `).join("")
            : `<div class="vacio">Sin ventas registradas en este periodo.</div>`;
}

async function reimprimirVentaReporteDueno(id) {
    try {
        const datos =
        await fetchAutenticado(`/ventas/${Number(id)}`);

        if (!datos?.venta) {
            mostrarToastDueno("No se pudo cargar la venta.");
            return;
        }

        abrirTicketImpresionDueno(datos.venta);
    } catch (error) {
        mostrarToastDueno("No se pudo conectar. Revisa tu internet.");
    }
}

function abrirTicketImpresionDueno(venta) {
    const productos =
    Array.isArray(venta.productos) ? venta.productos : [];

    const folio =
    venta.folio || `V-${String(venta.id || 0).padStart(6, "0")}`;

    const filas =
    productos.map(item => `
        <div style="display:flex;justify-content:space-between;gap:8px;">
            <span>${Number(item.cantidad || 1)}x ${escaparDueno(item.nombre || "Producto")}</span>
            <span>${dinero(item.importe || Number(item.precio || 0) * Number(item.cantidad || 1))}</span>
        </div>
    `).join("");

    const html = `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<title>${escaparDueno(folio)}</title>
<style>
body{font-family:monospace;font-size:13px;padding:16px;max-width:320px;margin:0 auto;color:#000;}
hr{border:none;border-top:1px dashed #000;margin:10px 0;}
h2{margin:0 0 4px;font-size:16px;text-align:center;}
p{margin:2px 0;}
</style>
</head>
<body>
<h2>${escaparDueno(folio)}</h2>
<p>${new Date(venta.fecha).toLocaleString("es-MX")}</p>
<p>Cliente: ${escaparDueno(venta.cliente_nombre || "Publico general")}</p>
<hr>
${filas}
<hr>
<div style="display:flex;justify-content:space-between;font-weight:bold;"><span>TOTAL</span><span>${dinero(venta.total || 0)}</span></div>
<p>Metodo: ${escaparDueno(venta.metodo_pago || "efectivo")}</p>
</body>
</html>`;

    const ventana =
    window.open("", "_blank");

    if (!ventana) {
        mostrarToastDueno("Permite ventanas emergentes para reimprimir.");
        return;
    }

    ventana.document.write(html);
    ventana.document.close();
    ventana.focus();
    ventana.print();
}

// ---------------- pestaña Inventario ----------------

async function cargarPanelInventarioDueno() {
    const contenedorChips =
    document.getElementById("duenoInventarioCategorias");

    const categorias =
    await listarCategoriasCatalogoLocal();

    contenedorChips.innerHTML =
        `<button type="button" class="dueno-chip-categoria activo" data-categoria="">Todas</button>` +
        categorias.map(categoria => `
            <button type="button" class="dueno-chip-categoria" data-categoria="${escaparDueno(categoria)}">${escaparDueno(categoria)}</button>
        `).join("");

    contenedorChips.querySelectorAll("button").forEach(boton => {
        boton.addEventListener("click", () => {
            contenedorChips.querySelectorAll("button").forEach(otro => otro.classList.remove("activo"));
            boton.classList.add("activo");
            duenoInventarioCategoria = boton.dataset.categoria || "";
            filtrarInventarioDueno();
        });
    });

    duenoInventarioCategoria = "";

    await filtrarInventarioDueno();
}

async function filtrarInventarioDueno() {
    const contenedor =
    document.getElementById("duenoInventarioLista");

    const texto =
    document.getElementById("duenoInventarioBuscar")?.value || "";

    const resultados =
    await listarCatalogoLocal({ texto, categoria: duenoInventarioCategoria });

    duenoUltimosResultados = resultados;

    contenedor.innerHTML =
        resultados.length
            ? resultados.map(producto => `
                <div class="fila-dueno fila-dueno-producto">
                    <div class="dueno-miniatura" onclick="verDetalleProductoDueno(${producto.id})">
                        ${producto.imagenUrl
                            ? `<img src="${producto.imagenUrl}" alt="" loading="lazy">`
                            : `<span class="dueno-miniatura-vacia">Sin foto</span>`}
                    </div>
                    <div onclick="verDetalleProductoDueno(${producto.id})">
                        <strong>${escaparDueno(producto.nombre)}</strong>
                        <span>${escaparDueno(producto.codigo || "Sin codigo")} · Stock ${producto.stock} · ${dinero(producto.precio)}</span>
                    </div>
                </div>
            `).join("")
            : `<div class="vacio">Sin productos en tu catalogo guardado${texto.trim() || duenoInventarioCategoria ? " que coincidan" : ""}.</div>`;
}

// ---------------- pestaña Más: navegacion tipo Ajustes ----------------

function estadoLicenciaDuenoPOS(modo) {
    const mapa = {
        normal: ["Al corriente", "dueno-pill-normal"],
        gracia: ["Periodo de gracia", "dueno-pill-gracia"],
        limitado: ["Suscripcion vencida", "dueno-pill-limitado"],
        bloqueado: ["Cuenta bloqueada", "dueno-pill-limitado"]
    };

    return mapa[modo] || mapa.normal;
}

// Datos de las 3 llamadas de red + el resumen de Nexo IA, cargados una
// sola vez al entrar a la pestaña y reusados por cada sub-pantalla sin
// volver a pedirlos -- se refresca solo al llamar cargarPanelMasDueno()
// de nuevo (ej. tras guardar un cambio).
let duenoMasContexto = {};
let duenoMasCategoriaActiva = null;

async function cargarPanelMasDueno() {
    try {
        const [licenciaDatos, sesionesDatos, dispositivosDatos, iaDatos] =
        await Promise.all([
            fetchAutenticado("/licencia/estado"),
            fetchAutenticado("/cuenta/sesiones"),
            fetchAutenticado("/cuenta/dispositivos"),
            fetchAutenticado("/ia/resumen-rapido")
        ]);

        duenoMasContexto = {
            negocio: licenciaDatos?.negocio || {},
            licencia: licenciaDatos?.licencia || {},
            sesiones: sesionesDatos?.sesiones || [],
            dispositivos: (dispositivosDatos?.ok ? dispositivosDatos.dispositivos : []) || [],
            ia: iaDatos?.acceso || { disponible: false },
            stockBajoCount: iaDatos?.stockBajo?.productos?.length || 0
        };

        renderStatusCardMasDueno();
        renderCategoriasMasDueno();

        // Si hay una sub-pantalla abierta (ej. se acaba de guardar un
        // cambio ahi mismo), se repinta con los datos frescos sin
        // cerrarla.
        if (duenoMasCategoriaActiva && RENDER_SUBPANTALLA_MAS_DUENO[duenoMasCategoriaActiva]) {
            RENDER_SUBPANTALLA_MAS_DUENO[duenoMasCategoriaActiva]();
        }
    } catch (error) {
        mostrarToastDueno("No se pudo cargar la configuracion.");
    }
}

function renderStatusCardMasDueno() {
    const { negocio, licencia, sesiones, dispositivos, ia, stockBajoCount } = duenoMasContexto;

    const [textoEstado, claseEstado] =
    estadoLicenciaDuenoPOS(licencia.modo);

    const nombresPlan = { basico: "Basico", plus: "Plus", pro: "Pro", demo: "Demo" };

    const totalDispositivos =
    (sesiones?.length || 0) + (dispositivos?.length || 0);

    document.getElementById("duenoMasStatusCard").innerHTML = `
        <div class="dueno-status-head">
            <div>
                <span>Estado del negocio</span>
                <h2>${escaparDueno(negocio.nombre || "Tu negocio")}</h2>
            </div>
            <span class="dueno-pill ${claseEstado}">${textoEstado}</span>
        </div>
        <div class="dueno-status-lineas">
            <div class="dueno-status-linea"><span>Plan actual</span><strong>${escaparDueno(nombresPlan[licencia.plan] || licencia.plan || "-")}</strong></div>
            <div class="dueno-status-linea"><span>Nexo IA</span><strong>${ia?.disponible ? "Activa" : "No incluida"}</strong></div>
            <div class="dueno-status-linea"><span>Dispositivos conectados</span><strong>${totalDispositivos}</strong></div>
            <div class="dueno-status-linea"><span>Alertas de stock</span><strong>${stockBajoCount}</strong></div>
        </div>
    `;
}

function iconoCategoriaMasDueno(nombre) {
    const iconos = {
        usuario: '<path d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8z"/><path d="M4 20c1.5-4 5-6 8-6s6.5 2 8 6"/>',
        tarjeta: '<rect x="3" y="6" width="18" height="13" rx="2"/><path d="M3 10h18"/><path d="M7 15h4"/>',
        chispa: '<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3z"/>',
        candado: '<rect x="4" y="11" width="16" height="9" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
        dispositivo: '<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8"/><path d="M12 16v4"/>',
        ayuda: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9.2a2.5 2.5 0 1 1 3.5 2.3c-.8.4-1.3 1-1.3 2"/><path d="M12 17.2h.01"/>',
        campana: '<path d="M6 8a6 6 0 0 1 12 0c0 5 2 6 2 6H4s2-1 2-6z"/><path d="M10 21a2 2 0 0 0 4 0"/>',
        nube: '<path d="M7 18a4 4 0 0 1-1-7.9 5 5 0 0 1 9.6-1.8A4.5 4.5 0 0 1 17 18H7z"/>',
        pincel: '<path d="M15 4l5 5-9.5 9.5a2 2 0 0 1-1.2.6l-3.6.4.4-3.6a2 2 0 0 1 .6-1.2L15 4z"/>',
        flecha: '<path d="M9 6l6 6-6 6"/>'
    };

    return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${iconos[nombre] || iconos.usuario}</svg>`;
}

// Categorias reales (con sub-pantalla funcional) primero; las que el
// negocio todavia no tiene construidas quedan visibles pero marcadas
// "proximamente" -- mismo patron ya usado en la pestaña Reportes, para
// no fingir una funcion que no existe todavia.
const CATEGORIAS_MAS_DUENO = [
    { id: "cuenta", titulo: "Cuenta", desc: "Datos del negocio y correo", icono: "usuario", color: "" },
    { id: "plan", titulo: "Plan y suscripcion", desc: "Tu plan, pagos y facturas", icono: "tarjeta", color: "verde" },
    { id: "nexo-ia", titulo: "Nexo IA", desc: "Consumo y disponibilidad", icono: "chispa", color: "morado" },
    { id: "seguridad", titulo: "Seguridad", desc: "Contraseña y sesiones", icono: "candado", color: "rojo" },
    { id: "dispositivos", titulo: "Dispositivos", desc: "Cajas vinculadas a tu negocio", icono: "dispositivo", color: "" },
    { id: "ayuda", titulo: "Ayuda", desc: "Contacto y version de la app", icono: "ayuda", color: "gris" },
    { id: "notificaciones", titulo: "Notificaciones", desc: "Proximamente", icono: "campana", color: "gris", proximamente: true },
    { id: "respaldos", titulo: "Respaldos", desc: "Proximamente", icono: "nube", color: "gris", proximamente: true },
    { id: "apariencia", titulo: "Apariencia", desc: "Proximamente", icono: "pincel", color: "gris", proximamente: true }
];

function renderCategoriasMasDueno() {
    document.getElementById("duenoMasCategorias").innerHTML =
        CATEGORIAS_MAS_DUENO.map(categoria => `
            <button type="button" class="dueno-categoria-row${categoria.proximamente ? " proximamente" : ""}"
                onclick="${categoria.proximamente ? "proximamenteDueno()" : `abrirSubpantallaMasDueno('${categoria.id}')`}">
                <span class="dueno-categoria-icono${categoria.color ? ` dueno-categoria-icono-${categoria.color}` : ""}">${iconoCategoriaMasDueno(categoria.icono)}</span>
                <span class="dueno-categoria-texto">
                    <strong>${escaparDueno(categoria.titulo)}</strong>
                    <span>${escaparDueno(categoria.desc)}</span>
                </span>
                <span class="dueno-categoria-flecha">${iconoCategoriaMasDueno("flecha")}</span>
            </button>
        `).join("");
}

const RENDER_SUBPANTALLA_MAS_DUENO = {
    cuenta: renderSubpantallaCuenta,
    plan: renderSubpantallaPlan,
    "nexo-ia": renderSubpantallaNexoIA,
    seguridad: renderSubpantallaSeguridad,
    dispositivos: renderSubpantallaDispositivos,
    ayuda: renderSubpantallaAyuda
};

function abrirSubpantallaMasDueno(categoriaId) {
    const categoria =
    CATEGORIAS_MAS_DUENO.find(item => item.id === categoriaId);

    const render =
    RENDER_SUBPANTALLA_MAS_DUENO[categoriaId];

    if (!categoria || !render) return;

    duenoMasCategoriaActiva = categoriaId;
    document.getElementById("duenoMasSubpantallaTitulo").textContent = categoria.titulo;
    render();
    document.getElementById("duenoMasSubpantalla").classList.add("abierta");
}

function cerrarSubpantallaMasDueno() {
    duenoMasCategoriaActiva = null;
    document.getElementById("duenoMasSubpantalla")?.classList.remove("abierta");
}

function htmlSesionesMasDueno(sesiones) {
    return sesiones.length
        ? sesiones.map(sesion => `
            <div class="fila-dueno">
                <div>
                    <strong>${escaparDueno(sesion.dispositivo || "Dispositivo desconocido")}${sesion.actual ? " · Este telefono" : ""}</strong>
                    <span>${escaparDueno(sesion.ip || "")} · ${fechaCorta(sesion.ultimoUsoAt)}</span>
                </div>
                ${sesion.actual
                    ? ""
                    : `<button type="button" class="dueno-link" onclick="cerrarSesionRemotaDesdeMasDueno(${sesion.id})">Cerrar</button>`}
            </div>
        `).join("")
        : `<div class="vacio">No hay sesiones activas.</div>`;
}

function htmlDispositivosMasDueno(dispositivos) {
    return dispositivos.length
        ? dispositivos.map(dispositivo => `
            <div class="fila-dueno">
                <div>
                    <strong>${escaparDueno(dispositivo.nombre || "Equipo sin nombre")}</strong>
                    <span>Ultima vez ${fechaCorta(dispositivo.ultimoUsoAt)}</span>
                </div>
                <button type="button" class="dueno-link dueno-link-peligro" onclick="desvincularDispositivoDesdeMasDueno(${dispositivo.id})">Desvincular</button>
            </div>
        `).join("")
        : `<div class="vacio">No hay equipos vinculados.</div>`;
}

function renderSubpantallaCuenta() {
    const { negocio } = duenoMasContexto;

    document.getElementById("duenoMasSubpantallaContenido").innerHTML = `
        <article class="dueno-card">
            <div class="card-head">
                <div>
                    <span>Tu cuenta</span>
                    <h2>${escaparDueno(negocio.nombre || "Tu negocio")}</h2>
                </div>
            </div>
            <div class="dueno-datos-grid">
                <div><span>Negocio</span><strong>${escaparDueno(negocio.nombre || "")}</strong></div>
                <div><span>Codigo</span><strong>${escaparDueno(negocio.slug || "")}</strong></div>
            </div>
            <label class="dueno-campo">Correo
                <span class="dueno-badge ${negocio.correoVerificado ? "dueno-badge-ok" : "dueno-badge-pendiente"}">${negocio.correoVerificado ? "Verificado" : "No verificado"}</span>
                <input type="email" id="duenoMasCorreoInput" placeholder="correo@negocio.com" value="${escaparDueno(negocio.correo || "")}">
            </label>
            <button type="button" class="dueno-boton-primario" onclick="guardarCorreoDueno()">Guardar correo</button>
        </article>
    `;
}

function renderSubpantallaPlan() {
    const { licencia } = duenoMasContexto;

    const [textoEstado, claseEstado] =
    estadoLicenciaDuenoPOS(licencia.modo);

    const nombresPlan = { basico: "Basico", plus: "Plus", pro: "Pro", demo: "Demo" };

    const vencimiento =
    licencia.fechaVencimiento ? new Date(licencia.fechaVencimiento) : null;

    const fechaTexto =
        vencimiento && !Number.isNaN(vencimiento.getTime())
            ? vencimiento.toLocaleDateString("es-MX", { day: "numeric", month: "long", year: "numeric" })
            : "Sin definir";

    document.getElementById("duenoMasSubpantallaContenido").innerHTML = `
        <article class="dueno-card">
            <div class="card-head">
                <div>
                    <span>Tu plan</span>
                    <h2>${escaparDueno(nombresPlan[licencia.plan] || licencia.plan || "-")}</h2>
                </div>
                <span class="dueno-pill ${claseEstado}">${textoEstado}</span>
            </div>
            <div class="dueno-datos-grid">
                <div><span>Vence</span><strong>${fechaTexto}</strong></div>
                <div><span>Dias de gracia</span><strong>${licencia.graciaDias ?? 0}</strong></div>
            </div>
            <label class="dueno-campo">Cambiar a
                <select id="duenoMasPlanSelect">
                    <option value="basico" ${licencia.plan === "basico" ? "selected" : ""}>Basico</option>
                    <option value="plus" ${licencia.plan === "plus" ? "selected" : ""}>Plus</option>
                    <option value="pro" ${licencia.plan === "pro" ? "selected" : ""}>Pro</option>
                </select>
            </label>
            <button type="button" class="dueno-boton-primario" onclick="cambiarPlanDesdeMasDueno()">${licencia.tieneStripe ? "Cambiar de plan" : "Suscribirme"}</button>
            ${licencia.tieneStripe ? `
                <button type="button" class="dueno-link" onclick="abrirPortalPagoDesdeMasDueno()" style="margin-top:10px;">Gestionar metodo de pago</button>
                <br>
                <button type="button" class="dueno-link" onclick="abrirPortalPagoDesdeMasDueno()" style="margin-top:6px;">Historial de pagos y facturas</button>
            ` : ""}
        </article>
    `;
}

function renderSubpantallaNexoIA() {
    const { ia } = duenoMasContexto;
    const contenedor = document.getElementById("duenoMasSubpantallaContenido");

    if (!ia?.disponible) {
        contenedor.innerHTML = `
            <article class="dueno-card">
                <div class="card-head">
                    <div>
                        <span>Nexo IA</span>
                        <h2>No incluida en tu plan</h2>
                    </div>
                </div>
                <p class="dueno-estado">Nexo IA esta disponible desde el plan Plus. Mejora tu plan desde "Plan y suscripcion" para empezar a usarla.</p>
            </article>
        `;
        return;
    }

    const porcentaje =
    ia.limite > 0 ? Math.min(100, Math.round((ia.usosVigentes / ia.limite) * 100)) : 0;

    const textoLimite =
        ia.plan === "plus"
            ? `${ia.usosVigentes} de ${ia.limite} preguntas de analisis profundo usadas este mes.`
            : `${ia.usosVigentes} preguntas de analisis profundo este mes -- tu plan no tiene un limite practico.`;

    contenedor.innerHTML = `
        <article class="dueno-card">
            <div class="card-head">
                <div>
                    <span>Nexo IA</span>
                    <h2>Disponible en tu plan</h2>
                </div>
            </div>
            <p class="dueno-estado">${escaparDueno(textoLimite)}</p>
            <div class="dueno-barra-uso"><div class="dueno-barra-uso-relleno" style="width:${porcentaje}%;"></div></div>
        </article>
    `;
}

function renderSubpantallaSeguridad() {
    document.getElementById("duenoMasSubpantallaContenido").innerHTML = `
        <article class="dueno-card">
            <div class="card-head">
                <div>
                    <span>Seguridad</span>
                    <h2>Contraseña y sesiones</h2>
                </div>
            </div>
            <label class="dueno-campo">Contraseña actual
                <input type="password" id="duenoMasPasswordActual" autocomplete="current-password">
            </label>
            <label class="dueno-campo">Contraseña nueva
                <input type="password" id="duenoMasPasswordNueva" autocomplete="new-password">
            </label>
            <label class="dueno-campo">Confirmar contraseña nueva
                <input type="password" id="duenoMasPasswordConfirmar" autocomplete="new-password">
            </label>
            <button type="button" class="dueno-boton-primario" onclick="cambiarPasswordDesdeMasDueno()">Cambiar contraseña</button>

            <h4 class="dueno-subseccion">Sesiones con acceso</h4>
            <div id="duenoMasSesiones" class="lista-compacta">${htmlSesionesMasDueno(duenoMasContexto.sesiones || [])}</div>
            <button type="button" class="dueno-link dueno-link-peligro" onclick="cerrarTodasSesionesDesdeMasDueno()">Cerrar sesion en todos los dispositivos</button>
        </article>

        <button type="button" class="dueno-boton-cerrar-sesion" onclick="cerrarSesionDuenoApp()">Cerrar sesion en este telefono</button>
    `;
}

function renderSubpantallaDispositivos() {
    document.getElementById("duenoMasSubpantallaContenido").innerHTML = `
        <article class="dueno-card">
            <div class="card-head">
                <div>
                    <span>Dispositivos</span>
                    <h2>Cajas vinculadas</h2>
                </div>
            </div>
            <div id="duenoMasDispositivos" class="lista-compacta">${htmlDispositivosMasDueno(duenoMasContexto.dispositivos || [])}</div>
        </article>
    `;
}

function renderSubpantallaAyuda() {
    document.getElementById("duenoMasSubpantallaContenido").innerHTML = `
        <article class="dueno-card">
            <div class="card-head">
                <div>
                    <span>Ayuda</span>
                    <h2>Contacto y version</h2>
                </div>
            </div>
            <a class="dueno-boton-primario" style="display:block;text-align:center;text-decoration:none;" href="https://wa.me/524981234567?text=Hola,%20necesito%20ayuda%20con%20Nexo%20POS" target="_blank" rel="noopener">Escribir por WhatsApp</a>
            <div class="dueno-datos-grid" style="margin-top:12px;">
                <div><span>App</span><strong>Nexo POS -- App del dueño</strong></div>
            </div>
        </article>
    `;
}

async function guardarCorreoDueno() {
    const correo =
    document.getElementById("duenoMasCorreoInput")?.value.trim();

    if (correo && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(correo)) {
        mostrarToastDueno("Escribe un correo valido.");
        return;
    }

    try {
        const datos =
        await fetchAutenticado("/cuenta/correo", {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ correo })
        });

        mostrarToastDueno(datos?.ok ? "Correo guardado." : (datos?.error || "No se pudo guardar el correo."));

        if (datos?.ok) await cargarPanelMasDueno();
    } catch (error) {
        mostrarToastDueno("No se pudo conectar. Revisa tu internet.");
    }
}

async function cambiarPlanDesdeMasDueno() {
    const plan =
    document.getElementById("duenoMasPlanSelect")?.value || "basico";

    try {
        const datos =
        await fetchAutenticado("/suscripcion/checkout", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ plan, retorno: "/dueno" })
        });

        if (datos?.ok && datos.url) {
            window.location.href = datos.url;
        } else {
            mostrarToastDueno(datos?.error || "No se pudo iniciar el pago.");
        }
    } catch (error) {
        mostrarToastDueno("No se pudo conectar. Revisa tu internet.");
    }
}

async function abrirPortalPagoDesdeMasDueno() {
    try {
        const datos =
        await fetchAutenticado("/suscripcion/portal", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ retorno: "/dueno" })
        });

        if (datos?.ok && datos.url) {
            window.location.href = datos.url;
        } else {
            mostrarToastDueno(datos?.error || "No se pudo abrir el portal de pago.");
        }
    } catch (error) {
        mostrarToastDueno("No se pudo conectar. Revisa tu internet.");
    }
}

async function cambiarPasswordDesdeMasDueno() {
    const passwordActual =
    document.getElementById("duenoMasPasswordActual")?.value || "";

    const passwordNueva =
    document.getElementById("duenoMasPasswordNueva")?.value || "";

    const passwordConfirmar =
    document.getElementById("duenoMasPasswordConfirmar")?.value || "";

    if (!passwordActual || !passwordNueva) {
        mostrarToastDueno("Completa tu contraseña actual y la nueva.");
        return;
    }

    if (passwordNueva !== passwordConfirmar) {
        mostrarToastDueno("Las contraseñas nuevas no coinciden.");
        return;
    }

    try {
        const datos =
        await fetchAutenticado("/cuenta/password", {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ passwordActual, passwordNueva, confirmarPasswordNueva: passwordConfirmar })
        });

        if (datos?.ok) {
            mostrarToastDueno("Contraseña actualizada.");
            document.getElementById("duenoMasPasswordActual").value = "";
            document.getElementById("duenoMasPasswordNueva").value = "";
            document.getElementById("duenoMasPasswordConfirmar").value = "";
        } else {
            mostrarToastDueno(datos?.error || "No se pudo cambiar la contraseña.");
        }
    } catch (error) {
        mostrarToastDueno("No se pudo conectar. Revisa tu internet.");
    }
}

async function cerrarSesionRemotaDesdeMasDueno(id) {
    if (!confirm("Se va a cerrar la sesion en ese dispositivo.")) return;

    try {
        await fetchAutenticado(`/cuenta/sesiones/${id}/cerrar`, { method: "POST" });
        await cargarPanelMasDueno();
    } catch (error) {
        mostrarToastDueno("No se pudo conectar. Revisa tu internet.");
    }
}

async function cerrarTodasSesionesDesdeMasDueno() {
    if (!confirm("Se va a cerrar la sesion en todos tus dispositivos, incluido este telefono.")) return;

    try {
        await fetchAutenticado("/cuenta/logout-todos", { method: "POST" });
    } catch (error) {
        // Aunque falle la llamada, la sesion local ya no sirve de nada
        // -- se limpia igual.
    }

    localStorage.removeItem(DUENO_TOKEN_KEY);
    mostrarLoginDueno();
}

async function desvincularDispositivoDesdeMasDueno(id) {
    if (!confirm("Esa caja va a dejar de tener acceso -- va a pedir correo y contraseña de nuevo.")) return;

    try {
        await fetchAutenticado(`/cuenta/dispositivos/${id}/revocar`, { method: "POST" });
        await cargarPanelMasDueno();
    } catch (error) {
        mostrarToastDueno("No se pudo conectar. Revisa tu internet.");
    }
}

function cerrarSesionDuenoApp() {
    if (!confirm("Vas a cerrar sesion en este telefono. Tendras que volver a entrar con tu correo y contraseña.")) return;

    fetch("/cuenta/logout", {
        method: "POST",
        headers: { Authorization: `Bearer ${tokenGuardado()}` }
    }).catch(() => {});

    localStorage.removeItem(DUENO_TOKEN_KEY);
    mostrarLoginDueno();
}

// ---------------- arranque ----------------

if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("/dueno-sw.js").catch(() => {
        // Sin Service Worker el resto de la pagina sigue funcionando
        // igual mientras haya conexion -- solo se pierde el arranque
        // 100% offline con el navegador recien abierto.
    });
}

window.addEventListener("load", () => {
    document.getElementById("duenoSaludo").textContent = saludoHora();

    [
        document.getElementById("duenoLoginCorreo"),
        document.getElementById("duenoLoginPassword")
    ].forEach(campo => {
        campo?.addEventListener("keydown", evento => {
            if (evento.key === "Enter") iniciarSesionDueno();
        });
    });

    if (tokenGuardado()) {
        mostrarAppDueno();
        cargarPanelDueno();
        setInterval(cargarPanelDueno, 60000);
    } else {
        mostrarLoginDueno();
    }
});
