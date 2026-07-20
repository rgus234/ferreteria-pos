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

// Mismos 12 cortes horarios (8:00-19:00) que ya usa el dashboard de
// escritorio (renderGraficaDashboardVentas en sales-history-documents.js)
// -- aqui se dibuja como un sparkline SVG chico en vez de un chart
// completo de Chart.js, para mantener esta pagina ligera en telefono.
function renderSparklineSVG(ventasHoyArr) {
    const svg =
    document.getElementById("duenoSparkline");

    if (!svg) return;

    const porHora =
    new Array(12).fill(0);

    ventasHoyArr.forEach(venta => {
        const indice =
        new Date(venta.fecha).getHours() - 8;

        if (indice >= 0 && indice < porHora.length) {
            porHora[indice] += Number(venta.total || 0);
        }
    });

    const max =
    Math.max(...porHora, 1);

    const puntos =
    porHora.map((valor, indice) => {
        const x = (indice / (porHora.length - 1)) * 100;
        const y = 26 - (valor / max) * 24;
        return `${x.toFixed(1)},${y.toFixed(1)}`;
    }).join(" ");

    svg.innerHTML =
    `<polyline points="${puntos}" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>`;
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
    document.getElementById("duenoVentas").style.display = tab === "ventas" ? "block" : "none";
    document.getElementById("duenoInventario").style.display = tab === "inventario" ? "block" : "none";

    if (tab === "ventas") cargarPanelVentasDueno();
    if (tab === "inventario") cargarPanelInventarioDueno();
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
