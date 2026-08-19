const DUENO_TOKEN_KEY = "nexoCuentaSesionToken";
const DUENO_ONBOARDING_KEY = "nexoDuenoOnboardingVisto";
const DUENO_ONBOARDING_TOTAL_SLIDES = 5;
const DUENO_TEMA_KEY = "nexoDuenoTema";

let duenoCarrito = [];
let duenoUltimosResultados = [];
let duenoProductoDetalleActual = null;
let duenoInventarioCategoria = "";
let duenoNexoHistorial = [];
let duenoNexoConversacionId = null;
let duenoNexoEnviando = false;
let duenoOnboardingSlideActual = 0;

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

// Punto de entrada por defecto cuando no hay sesion -- la mayoria de
// quien descarga la app es un comprador normal, no el dueno de un
// negocio, asi que la primera pantalla invita a Nexo Market. El acceso
// de administrador/empleado (login de siempre) queda detras de un
// link chico, en vez de ser lo primero que se ve.
function mostrarBienvenidaDueno() {
    document.getElementById("duenoOnboarding").style.display = "none";
    document.getElementById("duenoApp").style.display = "none";
    document.getElementById("duenoVentas").style.display = "none";
    document.getElementById("duenoTabs").style.display = "none";
    document.getElementById("duenoLogin").style.display = "none";
    document.getElementById("duenoMarketPrompt").style.display = "none";
    document.getElementById("duenoNexoBurbuja").style.display = "none";
    document.getElementById("duenoBienvenida").style.display = "flex";
}

function mostrarPromptMarketDueno() {
    document.getElementById("duenoBienvenida").style.display = "none";
    document.getElementById("duenoMarketPrompt").style.display = "flex";
}

function mostrarAccesoNegocioDueno() {
    document.getElementById("duenoBienvenida").style.display = "none";

    if (!localStorage.getItem(DUENO_ONBOARDING_KEY)) {
        mostrarOnboardingDueno();
    } else {
        mostrarLoginDueno();
    }
}

function mostrarLoginDueno() {
    document.getElementById("duenoOnboarding").style.display = "none";
    document.getElementById("duenoBienvenida").style.display = "none";
    document.getElementById("duenoMarketPrompt").style.display = "none";
    // Oculta las 8 pantallas de pestaña por su clase compartida (no una
    // lista parcial de ids) -- si el cierre de sesion pasaba solo por
    // duenoApp/duenoVentas, cerrar sesion estando en cualquier otra
    // pestaña (Mas, Reportes, Inventario, Pedidos, Vender, Caja) la
    // dejaba visible detras del login. Bug real reportado por el
    // usuario, ver captura de "Mas" quedando debajo del login.
    document.querySelectorAll(".dueno-app").forEach(pantalla => { pantalla.style.display = "none"; });
    document.getElementById("duenoTabs").style.display = "none";
    document.getElementById("duenoLogin").style.display = "flex";
    document.getElementById("duenoNexoBurbuja").style.display = "none";

    duenoNexoHistorial = [];
    duenoNexoConversacionId = null;
    const mensajesNexo = document.getElementById("duenoNexoMensajes");
    if (mensajesNexo) mensajesNexo.innerHTML = "";
    cerrarNexoChatDueno();
}

function mostrarAppDueno() {
    document.getElementById("duenoLogin").style.display = "none";
    document.getElementById("duenoApp").style.display = "block";
    document.getElementById("duenoTabs").style.display = "flex";
    document.getElementById("duenoNexoBurbuja").style.display = "flex";
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

        duenoRolSesion = "owner";
        aplicarRolShellDueno();
        mostrarAppDueno();
        cargarPanelDueno();
        actualizarNexoBurbujaDueno();
    } catch (error) {
        cajaError.textContent = "No se pudo conectar. Revisa tu internet e intenta de nuevo.";
        cajaError.style.display = "block";
    } finally {
        boton.disabled = false;
        boton.textContent = "Entrar";
    }
}

let duenoPersonaTokenTemporal = null;
let duenoEmpleadoNombrePersona = null;
let duenoEmpleadoCorreoPersona = null;

function mostrarLoginEmpleadoDueno() {
    document.getElementById("duenoLoginCajaDueno").style.display = "none";
    document.getElementById("duenoLoginCajaEmpleado").style.display = "block";
}

function mostrarLoginDuenoNormal() {
    document.getElementById("duenoLoginCajaEmpleado").style.display = "none";
    document.getElementById("duenoLoginCajaDueno").style.display = "block";
}

function entrarComoEmpleadoDueno(negocioId) {
    return fetch("/personas/entrar-como-empleado", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-persona-token": duenoPersonaTokenTemporal },
        body: JSON.stringify(negocioId ? { negocioId } : {})
    }).then(respuesta => respuesta.json());
}

function completarLoginEmpleadoDueno(datos) {
    duenoPersonaTokenTemporal = null;
    localStorage.setItem(DUENO_TOKEN_KEY, datos.token);

    document.getElementById("duenoNegocio").textContent =
    datos.negocio?.nombre || "Tu negocio";

    duenoRolSesion = datos.rol === "employee" ? "employee" : "owner";
    mostrarAppDueno();
    aplicarRolShellDueno();

    // aplicarRolShellDueno() ya cambia a Pedidos (y lo carga) para un
    // empleado -- el dashboard de Inicio es solo para dueño.
    if (duenoRolSesion !== "employee") cargarPanelDueno();

    actualizarNexoBurbujaDueno();
}

function mostrarSelectorNegocioEmpleadoDueno(negocios) {
    const boton =
    document.getElementById("btnDuenoLoginEmpleado");

    boton.style.display = "none";

    const selector =
    document.getElementById("duenoLoginEmpleadoSelector");

    selector.innerHTML =
    `<p style="margin:0 0 8px;font-size:12.5px;font-weight:700;color:var(--muted);">¿A qué negocio quieres entrar?</p>` +
    `<div class="dueno-login-selector">${negocios.map(negocio =>
        `<button type="button" data-negocio-id="${negocio.id}">${escaparDueno(negocio.nombre)}</button>`
    ).join("")}</div>`;

    selector.style.display = "block";

    selector.querySelectorAll("button[data-negocio-id]").forEach(botonNegocio => {
        botonNegocio.addEventListener("click", async () => {
            const cajaError = document.getElementById("duenoLoginEmpleadoError");
            cajaError.style.display = "none";

            try {
                const datos = await entrarComoEmpleadoDueno(Number(botonNegocio.dataset.negocioId));

                if (!datos.ok) {
                    cajaError.textContent = datos.error || "No se pudo iniciar sesion.";
                    cajaError.style.display = "block";
                    return;
                }

                completarLoginEmpleadoDueno(datos);
            } catch (error) {
                cajaError.textContent = "No se pudo conectar. Revisa tu internet e intenta de nuevo.";
                cajaError.style.display = "block";
            }
        });
    });
}

async function iniciarSesionEmpleadoDueno() {
    const identificador =
    document.getElementById("duenoLoginEmpleadoId")?.value.trim();

    const password =
    document.getElementById("duenoLoginEmpleadoPassword")?.value || "";

    const cajaError =
    document.getElementById("duenoLoginEmpleadoError");

    const boton =
    document.getElementById("btnDuenoLoginEmpleado");

    const selector =
    document.getElementById("duenoLoginEmpleadoSelector");

    cajaError.style.display = "none";
    selector.style.display = "none";
    boton.style.display = "block";

    if (!identificador || !password) {
        cajaError.textContent = "Escribe tu correo/telefono y tu contraseña.";
        cajaError.style.display = "block";
        return;
    }

    boton.disabled = true;
    boton.textContent = "Entrando...";

    try {
        const respuestaPersona =
        await fetch("/personas/login", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ identificador, password })
        });

        const datosPersona =
        await respuestaPersona.json();

        if (!datosPersona.ok) {
            cajaError.textContent = datosPersona.error || "No se pudo iniciar sesion.";
            cajaError.style.display = "block";
            return;
        }

        duenoPersonaTokenTemporal = datosPersona.token;
        duenoEmpleadoNombrePersona = datosPersona.persona?.nombre || null;
        duenoEmpleadoCorreoPersona = datosPersona.persona?.correo || datosPersona.persona?.telefono || null;

        const datos = await entrarComoEmpleadoDueno(null);

        if (!datos.ok) {
            cajaError.textContent = datos.error || "No se pudo iniciar sesion.";
            cajaError.style.display = "block";
            return;
        }

        if (datos.requiereSeleccion) {
            mostrarSelectorNegocioEmpleadoDueno(datos.negocios);
            return;
        }

        completarLoginEmpleadoDueno(datos);
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
    document.getElementById("duenoPedidos").style.display = tab === "pedidos" ? "block" : "none";
    document.getElementById("duenoVender").style.display = tab === "vender" ? "block" : "none";
    document.getElementById("duenoCaja").style.display = tab === "caja" ? "block" : "none";
    document.getElementById("duenoMas").style.display = tab === "mas" ? "block" : "none";

    const burbujaNexo =
    document.getElementById("duenoNexoBurbuja");

    if (burbujaNexo) burbujaNexo.style.display = (tab === "reportes" || tab === "pedidos" || tab === "vender" || tab === "caja") ? "none" : "flex";

    if (tab !== "mas") cerrarSubpantallaMasDueno();

    if (tab === "reportes") cargarPanelReportesDueno();
    if (tab === "ventas") cargarPanelVentasDueno();
    if (tab === "inventario") cargarPanelInventarioDueno();
    if (tab === "pedidos") cargarPanelPedidosDueno();
    if (tab === "vender") cargarPanelVenderDueno();
    if (tab === "caja") cargarPanelCajaDueno();
    if (tab === "mas") cargarPanelMasDueno();
}

// Fase 1 del ecosistema Nexo: pestañas que solo tienen sentido para el
// dueño (dashboards, cotizaciones, catalogo completo, configuracion) --
// "Pedidos" queda fuera de este set porque la ve tanto el dueño como el
// empleado desde el dia uno. Mismo espiritu que CATEGORIAS_MAS_DUENO:
// un dato central en vez de checks de rol repartidos por el codigo.
const DUENO_TABS_SOLO_DUENO = new Set(["inicio", "reportes", "ventas", "inventario", "mas"]);
let duenoRolSesion = "owner";

function aplicarRolShellDueno() {
    const esEmpleado = duenoRolSesion === "employee";

    document.querySelectorAll(".dueno-tabs button[data-tab]").forEach(boton => {
        boton.style.display = (esEmpleado && DUENO_TABS_SOLO_DUENO.has(boton.dataset.tab)) ? "none" : "";
    });

    if (esEmpleado) cambiarTabDueno("pedidos");
}

async function sincronizarRolSesionDueno() {
    try {
        const datos = await fetchAutenticado("/negocio-actual");
        duenoRolSesion = datos.rol || "owner";
        if (datos.personaNombre) duenoEmpleadoNombrePersona = datos.personaNombre;
    } catch (error) {
        duenoRolSesion = "owner";
    }

    aplicarRolShellDueno();

    // aplicarRolShellDueno() ya cambia a la pestaña Pedidos (y la carga)
    // cuando es empleado -- el dashboard de Inicio es solo para dueño.
    if (duenoRolSesion !== "employee") cargarPanelDueno();
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

// ---------------- pestaña Pedidos (Nexo Market) ----------------
//
// Primera pantalla real que un empleado puede usar dentro de la app de
// Play Store -- mismo backend que ya usa la pantalla "Pedidos" del POS
// de escritorio (market-pedidos-server.js), sin cambios de servidor.
// El escaneo reusa el mismo bundle vendored (~400KB, @zxing/browser)
// que pedidos-market-view.js ya carga bajo demanda -- no se reinventa.

let duenoPedidosCache = [];
let duenoPedidosGrupoActual = "nuevos";
let duenoPedidoDetalleId = null;

const DUENO_PED_ACCIONES_POR_ESTADO = {
    pendiente: [{ accion: "aceptar", texto: "Aceptar", clase: "dueno-boton-primario-chico" }, { accion: "rechazar", texto: "Rechazar", clase: "dueno-boton-secundario-chico" }],
    confirmado: [{ accion: "marcar_listo", texto: "Marcar listo", clase: "dueno-boton-primario-chico" }],
    preparando: [{ accion: "marcar_listo", texto: "Marcar listo", clase: "dueno-boton-primario-chico" }],
    listo: [{ accion: "entregar", texto: "Confirmar entrega", clase: "dueno-boton-primario-chico" }]
};

function duenoPedEtiquetaEstado(estado) {
    const mapa = {
        pendiente: "Nuevo", confirmado: "Preparando", preparando: "Preparando",
        listo: "Listo para recoger", entregado: "Entregado", cancelado: "Cancelado"
    };
    return mapa[estado] || estado;
}

function cambiarEstadoPedidosDueno(grupo) {
    duenoPedidosGrupoActual = grupo;

    document.querySelectorAll("#duenoPedidosSubtabs button").forEach(boton => {
        boton.classList.toggle("activo", boton.dataset.estado === grupo);
    });

    cargarPanelPedidosDueno();
}

async function cargarPanelPedidosDueno() {
    const estadoTexto =
    document.getElementById("duenoPedidosEstado");

    if (estadoTexto) estadoTexto.textContent = "Actualizando...";

    try {
        duenoPedidosCache =
        (await fetchAutenticado(`/negocio-actual/pedidos-market?estado=${encodeURIComponent(duenoPedidosGrupoActual)}`)).pedidos || [];

        if (estadoTexto) {
            estadoTexto.textContent = duenoPedidosCache.length
                ? `${duenoPedidosCache.length} pedido${duenoPedidosCache.length === 1 ? "" : "s"}`
                : "Sin pedidos en este grupo";
        }

        document.getElementById("duenoPedidosLista").innerHTML =
            duenoPedidosCache.length
                ? duenoPedidosCache.map(duenoPedFilaHtml).join("")
                : `<div class="vacio">No hay pedidos aqui por ahora.</div>`;
    } catch (error) {
        if (estadoTexto) estadoTexto.textContent = "No se pudo conectar con el POS";
    }
}

function duenoPedFilaHtml(pedido) {
    const acciones = DUENO_PED_ACCIONES_POR_ESTADO[pedido.estado] || [];

    return `
    <div class="fila-dueno fila-dueno-pedido">
        <div onclick="abrirDetallePedidoDueno(${pedido.id})">
            <strong>${escaparDueno(pedido.clienteNombre || "Cliente")}</strong>
            <span>${escaparDueno(pedido.codigoRecogida)} · ${duenoPedEtiquetaEstado(pedido.estado)} · ${dinero(pedido.total)}</span>
        </div>
        <div class="dueno-ped-acciones">
            ${acciones.map(a => `<button type="button" class="${a.clase}" onclick="accionPedidoDueno(${pedido.id}, '${a.accion}')">${a.texto}</button>`).join("")}
            <button type="button" class="dueno-link" onclick="abrirDetallePedidoDueno(${pedido.id})">Ver detalle</button>
        </div>
    </div>
    `;
}

async function accionPedidoDueno(id, accion) {
    if ((accion === "rechazar" || accion === "cancelar") && !confirm("¿Seguro que quieres cancelar este pedido?")) return;

    try {
        const respuesta = await fetchAutenticado(`/negocio-actual/pedidos-market/${id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ accion })
        });

        if (!respuesta.ok) {
            mostrarToastDueno(respuesta.error || "No se pudo actualizar el pedido.");
            return;
        }

        mostrarToastDueno("Pedido actualizado.");
        cargarPanelPedidosDueno();
    } catch (error) {
        mostrarToastDueno("No se pudo conectar con el POS.");
    }
}

function duenoPedContarVerificados(pedido) {
    const items = pedido.items || [];
    return { verificados: items.filter(i => i.verificado).length, total: items.length };
}

function duenoPedVerifItemFilaHtml(item) {
    const verificado = Boolean(item.verificado);
    return `
    <div class="fila-dueno dueno-ped-verif-item ${verificado ? "dueno-ped-verif-item-ok" : ""}">
        <div>
            <strong>${escaparDueno(item.nombre)}</strong>
            <span>${escaparDueno(item.codigo || "")} · Cantidad: ${item.cantidad}</span>
        </div>
        ${verificado
            ? `<span class="dueno-ped-verif-badge">✓ Verificado</span>`
            : `<button type="button" class="dueno-boton-secundario-chico" onclick="verificarItemManualDueno(${item.id})">Verificar manual</button>`}
    </div>
    `;
}

function duenoPedActualizarDetalle(pedido) {
    const { verificados, total } = duenoPedContarVerificados(pedido);
    const progreso = document.getElementById("duenoPedVerifProgreso");
    if (progreso) progreso.textContent = total > 0 ? `${verificados} de ${total} productos verificados` : "Este pedido no tiene productos con codigo para verificar.";

    const barra = document.getElementById("duenoPedVerifBarra");
    if (barra) barra.style.width = total > 0 ? `${Math.round((verificados / total) * 100)}%` : "0%";

    const cuerpo = document.getElementById("duenoPedVerifCuerpo");
    if (cuerpo) cuerpo.innerHTML = (pedido.items || []).map(duenoPedVerifItemFilaHtml).join("");
}

async function duenoPedGuardarVerificacion(pedidoId, itemId, metodo, codigo) {
    const respuesta = await fetch(`/negocio-actual/pedidos-market/${pedidoId}/items/${itemId}/verificar`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${tokenGuardado()}` },
        body: JSON.stringify({ metodo, codigo })
    });
    return respuesta.json();
}

async function verificarItemManualDueno(itemId) {
    const pedido = duenoPedidosCache.find(p => p.id === duenoPedidoDetalleId);
    const item = pedido?.items?.find(i => i.id === itemId);
    if (!pedido || !item) return;

    if (!confirm(`Verifica con cuidado que este producto sea "${item.nombre}" antes de confirmar -- no se esta comprobando por codigo.`)) return;

    try {
        const datos = await duenoPedGuardarVerificacion(pedido.id, itemId, "manual", null);
        if (!datos.ok) {
            mostrarToastDueno(datos.error || "No se pudo verificar el producto.");
            return;
        }

        pedido.items = datos.items;
        duenoPedActualizarDetalle(pedido);
    } catch (error) {
        mostrarToastDueno("No se pudo verificar el producto. Intenta de nuevo.");
    }
}

async function duenoPedIntentarVerificarPorCodigo(codigoCrudo) {
    const codigo = String(codigoCrudo || "").trim();
    if (!codigo) return;

    const pedido = duenoPedidosCache.find(p => p.id === duenoPedidoDetalleId);
    if (!pedido) return;

    const estado = document.getElementById("duenoPedVerifEscaneoEstado");
    const itemCoincidente = (pedido.items || []).find(item =>
        !item.verificado && String(item.codigo || "").toLowerCase() === codigo.toLowerCase()
    );

    if (!itemCoincidente) {
        if (estado) estado.textContent = "Ese codigo no corresponde a ningun producto pendiente de este pedido.";
        return;
    }

    try {
        const datos = await duenoPedGuardarVerificacion(pedido.id, itemCoincidente.id, "escaneo", codigo);
        if (!datos.ok) {
            if (estado) estado.textContent = datos.error || "No se pudo verificar el producto.";
            return;
        }

        pedido.items = datos.items;
        duenoPedActualizarDetalle(pedido);
        if (estado) estado.textContent = `"${itemCoincidente.nombre}" verificado.`;
    } catch (error) {
        if (estado) estado.textContent = "No se pudo verificar el producto. Intenta de nuevo.";
    }
}

let duenoPedZxingCargando = null;
let duenoPedControlesEscaneo = null;

function duenoPedCargarZxing() {
    if (window.ZXingBrowser) return Promise.resolve();
    if (duenoPedZxingCargando) return duenoPedZxingCargando;

    duenoPedZxingCargando = new Promise((resolve, reject) => {
        const script = document.createElement("script");
        script.src = "js/vendor/zxing-browser.min.js";
        script.onload = () => resolve();
        script.onerror = () => reject(new Error("No se pudo cargar el lector de codigos"));
        document.body.appendChild(script);
    });

    return duenoPedZxingCargando;
}

function duenoPedDetenerEscaneo() {
    if (duenoPedControlesEscaneo) {
        try { duenoPedControlesEscaneo.stop(); } catch (error) { /* nada que hacer */ }
        duenoPedControlesEscaneo = null;
    }
}

async function duenoPedIniciarEscaneo() {
    const video = document.getElementById("duenoPedVerifVideo");
    const estado = document.getElementById("duenoPedVerifEscaneoEstado");
    if (!video || !estado) return;

    estado.textContent = "Cargando lector...";

    try {
        await duenoPedCargarZxing();
    } catch (error) {
        estado.textContent = "No se pudo cargar el lector de codigos.";
        return;
    }

    if (!duenoPedidoDetalleId) return;

    estado.textContent = "Abriendo camara...";

    try {
        const lector = new window.ZXingBrowser.BrowserMultiFormatReader();

        duenoPedControlesEscaneo = await lector.decodeFromVideoDevice(undefined, video, (resultado) => {
            if (!resultado || !duenoPedidoDetalleId) return;
            duenoPedIntentarVerificarPorCodigo(resultado.getText());
        });

        estado.textContent = "Apunta la camara a cada codigo de barras.";
    } catch (error) {
        estado.textContent = "No se pudo abrir la camara. Revisa los permisos del navegador.";
    }
}

function abrirDetallePedidoDueno(id) {
    const pedido = duenoPedidosCache.find(p => p.id === id);
    if (!pedido) return;

    duenoPedidoDetalleId = id;

    document.getElementById("duenoPedidoDetalleTitulo").textContent = `Pedido ${pedido.codigoRecogida}`;
    document.getElementById("duenoPedidoDetalleContenido").innerHTML = `
        <p class="dueno-estado">${escaparDueno(pedido.clienteNombre || "Cliente")} · ${dinero(pedido.total)}</p>

        <div class="dueno-ped-verif-progreso">
            <div class="dueno-ped-verif-progreso-fondo"><div id="duenoPedVerifBarra" class="dueno-ped-verif-progreso-barra"></div></div>
            <span id="duenoPedVerifProgreso"></span>
        </div>

        <div class="dueno-ped-verif-escaneo">
            <video id="duenoPedVerifVideo" class="dueno-ped-verif-video" autoplay muted playsinline></video>
            <div id="duenoPedVerifEscaneoEstado" class="dueno-estado">Iniciando...</div>
            <form id="duenoPedVerifManualForm" class="dueno-ped-verif-manual-form">
                <input type="text" id="duenoPedVerifManualInput" placeholder="O escribe el codigo aqui" autocomplete="off">
                <button type="submit" class="dueno-boton-secundario-chico">Verificar codigo</button>
            </form>
        </div>

        <div id="duenoPedVerifCuerpo" class="lista-compacta"></div>
    `;

    document.getElementById("duenoPedVerifManualForm").onsubmit = evento => {
        evento.preventDefault();
        const input = document.getElementById("duenoPedVerifManualInput");
        const codigo = input.value.trim();
        if (!codigo) return;
        duenoPedIntentarVerificarPorCodigo(codigo);
        input.value = "";
        input.focus();
    };

    document.getElementById("duenoPedidoDetalleOverlay").classList.add("abierta");
    duenoPedActualizarDetalle(pedido);
    duenoPedIniciarEscaneo();
}

function cerrarDetallePedidoDueno() {
    duenoPedDetenerEscaneo();
    duenoPedidoDetalleId = null;
    document.getElementById("duenoPedidoDetalleOverlay").classList.remove("abierta");
    cargarPanelPedidosDueno();
}

// ---------------- pestaña Vender (venta real) ----------------
//
// Fase 2 del ecosistema Nexo: carrito independiente del de Cotizaciones
// (duenoCarrito, pestaña "Ventas") porque el contrato de POST /ventas
// usa nombres de campo distintos (id/precio/importe/unidadVenta/
// modoVenta) -- se arma directo en esa forma para no traducir despues.
// Alcance v1: solo unidades completas (bolsa/pieza entera, sin
// fraccion suelta), sin credito ni pago mixto (son flujos aparte) y
// sin cola offline -- una venta real mueve stock y dinero, no se
// encola para reconciliar despues.

let duenoVentaCarrito = [];
let duenoVentaUltimosResultados = [];
let duenoVentaMetodoPago = null;
let duenoVentaCobrando = false;

async function cargarPanelVenderDueno() {
    renderCarritoVenderDueno();

    // A diferencia del dueño (que ya siembra el cache local al cargar
    // Inicio), un empleado puede entrar directo a Vender sin haber
    // pasado nunca por ahi -- sin esto el buscador queda vacio.
    try {
        const productos = await fetchAutenticado("/productos");
        await guardarCatalogoLocal(productos);
    } catch (error) {
        // Sin conexion se sigue usando lo que ya haya en el cache local.
    }
}

function filaProductoVenderDuenoHtml(producto) {
    return `
        <div class="fila-dueno fila-dueno-producto">
            <div class="dueno-miniatura">
                ${producto.imagenUrl
                    ? `<img src="${producto.imagenUrl}" alt="" loading="lazy">`
                    : `<span class="dueno-miniatura-vacia">Sin foto</span>`}
            </div>
            <div>
                <strong>${escaparDueno(producto.nombre)}</strong>
                <span>${escaparDueno(producto.codigo || "Sin codigo")} · Stock ${producto.stock} · ${dinero(producto.precio)}</span>
            </div>
            <button type="button" class="dueno-boton-agregar" onclick="agregarAlCarritoVenderDueno(${producto.id})">+</button>
        </div>
    `;
}

async function buscarProductoVenderDueno(texto) {
    const contenedor =
    document.getElementById("duenoVenderResultados");

    duenoVentaUltimosResultados =
    await buscarEnCatalogoLocal(texto);

    contenedor.innerHTML =
        duenoVentaUltimosResultados.length
            ? duenoVentaUltimosResultados.map(filaProductoVenderDuenoHtml).join("")
            : (texto.trim() ? `<div class="vacio">Sin resultados en tu catalogo guardado.</div>` : "");
}

// Redimensiona la foto a dataURL en el propio navegador antes de
// mandarla -- mismo patron ya usado en product-inventory.js
// (redimensionarImagenCanvas), copiado aqui porque ese archivo no se
// carga en /dueno. anchoMax mas grande que el de las miniaturas de
// catalogo (320px): aqui si importa poder leer una medida grabada.
function redimensionarImagenCanvasDueno(archivo, anchoMax = 1024) {
    return new Promise((resolve, reject) => {
        const lector = new FileReader();
        lector.onerror = () => reject(new Error("No se pudo leer la foto"));
        lector.onload = () => {
            const img = new Image();
            img.onerror = () => reject(new Error("Foto invalida"));
            img.onload = () => {
                const escala = Math.min(1, anchoMax / img.width);
                const canvas = document.createElement("canvas");
                canvas.width = Math.round(img.width * escala);
                canvas.height = Math.round(img.height * escala);
                canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
                resolve(canvas.toDataURL("image/jpeg", 0.85));
            };
            img.src = lector.result;
        };
        lector.readAsDataURL(archivo);
    });
}

// "Identificar producto por foto" -- el empleado o dueno toma una
// foto desde el buscador de Vender, Nexo IA la describe y sugiere
// productos reales del inventario. Reusa duenoVentaUltimosResultados
// + agregarAlCarritoVenderDueno (mismos que ya usa la busqueda por
// texto) para no duplicar la logica de "agregar al carrito".
async function identificarProductoPorFotoDueno(archivo) {
    if (!archivo) return;

    const contenedor = document.getElementById("duenoVenderResultados");
    const inputFoto = document.getElementById("duenoVenderFotoInput");
    contenedor.innerHTML = `<div class="vacio">Nexo esta mirando la foto...</div>`;

    try {
        const imagenBase64 = await redimensionarImagenCanvasDueno(archivo);
        const respuesta = await fetchAutenticado("/negocio-actual/identificar-producto-foto", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ imagenBase64 })
        });

        if (!respuesta.disponible) {
            contenedor.innerHTML = `<div class="vacio">Identificar por foto es una funcion de Nexo IA -- mejora tu plan desde Cuenta para usarla.</div>`;
            return;
        }

        if (!respuesta.candidatos.length) {
            contenedor.innerHTML = `<div class="vacio">No encontre nada parecido en tu inventario. Prueba escribiendo el nombre.</div>`;
            return;
        }

        duenoVentaUltimosResultados = respuesta.candidatos;

        const tipo = respuesta.descripcion?.tipo;
        const encabezado = tipo
            ? `<div class="dueno-foto-descripcion">Nexo cree que es: ${escaparDueno(tipo)}${respuesta.descripcion.marca ? ` · ${escaparDueno(respuesta.descripcion.marca)}` : ""}${respuesta.descripcion.medidaVisible ? ` · ${escaparDueno(respuesta.descripcion.medidaVisible)}` : ""}</div>`
            : "";

        contenedor.innerHTML = encabezado + respuesta.candidatos.map(filaProductoVenderDuenoHtml).join("");
    } catch (error) {
        contenedor.innerHTML = `<div class="vacio">${escaparDueno(error.message || "No se pudo identificar la foto")}</div>`;
    } finally {
        if (inputFoto) inputFoto.value = "";
    }
}

function agregarAlCarritoVenderDueno(id) {
    const producto =
    duenoVentaUltimosResultados.find(p => p.id === id);

    if (!producto) return;

    const existente =
    duenoVentaCarrito.find(item => item.id === id);

    if (existente) {
        existente.cantidad += 1;
    } else {
        duenoVentaCarrito.push({
            id: producto.id,
            codigo: producto.codigo,
            nombre: producto.nombre,
            precio: Number(producto.precio || 0),
            cantidad: 1,
            unidadVenta: producto.unidadVenta || "pieza",
            modoVenta: "bolsa"
        });
    }

    renderCarritoVenderDueno();
}

function cambiarCantidadCarritoVenderDueno(id, delta) {
    const item =
    duenoVentaCarrito.find(i => i.id === id);

    if (!item) return;

    item.cantidad += delta;

    if (item.cantidad <= 0) {
        duenoVentaCarrito = duenoVentaCarrito.filter(i => i.id !== id);
    }

    renderCarritoVenderDueno();
}

function totalCarritoVenderDueno() {
    return duenoVentaCarrito.reduce((acumulado, item) => acumulado + item.precio * item.cantidad, 0);
}

function renderCarritoVenderDueno() {
    const card =
    document.getElementById("duenoVenderCarritoCard");

    if (!duenoVentaCarrito.length) {
        card.style.display = "none";
        return;
    }

    card.style.display = "block";

    document.getElementById("duenoVenderTotal").textContent =
    dinero(totalCarritoVenderDueno());

    document.getElementById("duenoVenderCarritoLista").innerHTML =
        duenoVentaCarrito.map(item => `
            <div class="fila-dueno">
                <div>
                    <strong>${escaparDueno(item.nombre)}</strong>
                    <span>${escaparDueno(item.codigo || "")} · ${dinero(item.precio)} c/u</span>
                </div>
                <div class="dueno-cantidad-control">
                    <button type="button" onclick="cambiarCantidadCarritoVenderDueno(${item.id}, -1)">-</button>
                    <span>${item.cantidad}</span>
                    <button type="button" onclick="cambiarCantidadCarritoVenderDueno(${item.id}, 1)">+</button>
                </div>
            </div>
        `).join("");
}

async function iniciarCobroVenderDueno() {
    if (!duenoVentaCarrito.length) return;

    duenoVentaMetodoPago = null;

    const overlay =
    document.getElementById("duenoVenderCobroOverlay");

    const contenido =
    document.getElementById("duenoVenderCobroContenido");

    document.getElementById("duenoVenderCobroTitulo").textContent = "Verificando stock...";
    contenido.innerHTML = `<p class="dueno-estado">Verificando existencias antes de cobrar...</p>`;
    overlay.classList.add("abierta");

    let productosFrescos;
    try {
        productosFrescos = await fetchAutenticado("/productos");
    } catch (error) {
        contenido.innerHTML = `<div class="vacio">No se pudo verificar el stock. Revisa tu conexion e intenta de nuevo.</div>`;
        return;
    }

    const stockPorId =
    new Map(productosFrescos.map(p => [p.id, Number(p.stock || 0)]));

    const faltantes =
    duenoVentaCarrito.filter(item => (stockPorId.get(item.id) ?? 0) < item.cantidad);

    if (faltantes.length) {
        document.getElementById("duenoVenderCobroTitulo").textContent = "Stock insuficiente";
        contenido.innerHTML = `
            <div class="vacio">
                No hay suficiente stock para: ${faltantes.map(f => `${escaparDueno(f.nombre)} (pides ${f.cantidad}, hay ${stockPorId.get(f.id) ?? 0})`).join(", ")}.
                Ajusta el carrito y vuelve a intentar.
            </div>
        `;
        return;
    }

    document.getElementById("duenoVenderCobroTitulo").textContent = "Cobrar";
    renderMetodoPagoVenderDueno();
}

function renderMetodoPagoVenderDueno() {
    const contenido =
    document.getElementById("duenoVenderCobroContenido");

    contenido.innerHTML = `
        <p class="dueno-estado">Total a cobrar: <strong>${dinero(totalCarritoVenderDueno())}</strong></p>
        <div class="dueno-metodo-pago-grid">
            <button type="button" class="dueno-metodo-pago-boton" onclick="elegirMetodoPagoVenderDueno('efectivo')">Efectivo</button>
            <button type="button" class="dueno-metodo-pago-boton" onclick="elegirMetodoPagoVenderDueno('tarjeta')">Tarjeta</button>
            <button type="button" class="dueno-metodo-pago-boton" onclick="elegirMetodoPagoVenderDueno('transferencia')">Transferencia</button>
        </div>
    `;
}

function elegirMetodoPagoVenderDueno(metodo) {
    duenoVentaMetodoPago = metodo;

    const contenido =
    document.getElementById("duenoVenderCobroContenido");

    const total = totalCarritoVenderDueno();

    if (metodo !== "efectivo") {
        const etiqueta = metodo === "tarjeta" ? "Tarjeta" : "Transferencia";

        contenido.innerHTML = `
            <p class="dueno-estado">Total a cobrar: <strong>${dinero(total)}</strong></p>
            <p class="dueno-estado">Metodo: ${etiqueta}</p>
            <button type="button" class="dueno-boton-primario" onclick="confirmarCobroVenderDueno()">Confirmar cobro</button>
            <button type="button" class="dueno-link" onclick="renderMetodoPagoVenderDueno()">Cambiar metodo</button>
        `;
        return;
    }

    contenido.innerHTML = `
        <p class="dueno-estado">Total a cobrar: <strong>${dinero(total)}</strong></p>
        <label class="dueno-campo">Recibido
            <input type="number" id="duenoVenderRecibido" inputmode="decimal" min="0" step="0.01" placeholder="0.00" oninput="actualizarCambioVenderDueno()">
        </label>
        <p class="dueno-estado" id="duenoVenderCambio">Cambio: ${dinero(0)}</p>
        <button type="button" class="dueno-boton-primario" id="duenoVenderBotonConfirmarEfectivo" onclick="confirmarCobroVenderDueno()" disabled>Confirmar cobro</button>
        <button type="button" class="dueno-link" onclick="renderMetodoPagoVenderDueno()">Cambiar metodo</button>
    `;
}

function actualizarCambioVenderDueno() {
    const total = totalCarritoVenderDueno();

    const recibido =
    Number(document.getElementById("duenoVenderRecibido")?.value || 0);

    document.getElementById("duenoVenderCambio").textContent =
    `Cambio: ${dinero(Math.max(recibido - total, 0))}`;

    document.getElementById("duenoVenderBotonConfirmarEfectivo").disabled = recibido < total;
}

async function confirmarCobroVenderDueno() {
    if (duenoVentaCobrando) return;
    duenoVentaCobrando = true;

    const total = totalCarritoVenderDueno();

    const clienteNombre =
    document.getElementById("duenoVenderClienteNombre")?.value.trim() || "Publico general";

    let recibido = total;
    let cambio = 0;

    if (duenoVentaMetodoPago === "efectivo") {
        recibido = Number(document.getElementById("duenoVenderRecibido")?.value || 0);
        cambio = Math.max(recibido - total, 0);
    }

    const pagos = { efectivo: 0, tarjeta: 0, transferencia: 0, credito: 0 };
    pagos[duenoVentaMetodoPago] = total;

    const cuerpo = {
        total,
        subtotal: total,
        descuento: 0,
        descuentoTipo: "ninguno",
        descuentoValor: 0,
        clienteId: null,
        clienteNombre,
        cajeroUsuario: duenoEmpleadoCorreoPersona || "dueno",
        cajeroNombre: duenoEmpleadoNombrePersona || document.getElementById("duenoNegocio")?.textContent || "Dueño",
        productos: duenoVentaCarrito.map(item => ({
            id: item.id,
            codigo: item.codigo,
            nombre: item.nombre,
            precio: item.precio,
            cantidad: item.cantidad,
            unidadVenta: item.unidadVenta,
            modoVenta: item.modoVenta,
            importe: item.precio * item.cantidad
        })),
        metodoPago: duenoVentaMetodoPago,
        pagos,
        recibido,
        cambio
    };

    const contenido =
    document.getElementById("duenoVenderCobroContenido");

    contenido.innerHTML = `<p class="dueno-estado">Cobrando...</p>`;

    try {
        const respuesta = await fetchAutenticado("/ventas", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(cuerpo)
        });

        document.getElementById("duenoVenderCobroTitulo").textContent = "Venta cobrada";
        contenido.innerHTML = `
            <div class="dueno-status-card">
                <p class="dueno-estado">Folio</p>
                <h2>${escaparDueno(respuesta.folio)}</h2>
                <p class="dueno-estado">Total ${dinero(total)}</p>
            </div>
            <button type="button" class="dueno-boton-primario" onclick="finalizarVentaVenderDueno()">Nueva venta</button>
        `;

        duenoVentaCarrito = [];
    } catch (error) {
        contenido.innerHTML = `
            <div class="vacio">${escaparDueno(error.message || "No se pudo cobrar la venta. Intenta de nuevo.")}</div>
            <button type="button" class="dueno-link" onclick="renderMetodoPagoVenderDueno()">Volver a intentar</button>
        `;
    } finally {
        duenoVentaCobrando = false;
    }
}

function finalizarVentaVenderDueno() {
    document.getElementById("duenoVenderCobroOverlay").classList.remove("abierta");

    const campoCliente =
    document.getElementById("duenoVenderClienteNombre");

    if (campoCliente) campoCliente.value = "";

    renderCarritoVenderDueno();
}

function cerrarCobroVenderDueno() {
    document.getElementById("duenoVenderCobroOverlay").classList.remove("abierta");
}

// ---------------- pestaña Caja: turno y corte ----------------

let duenoCajaTurnoActual = null;
let duenoCajaResumenActual = null;

async function cargarPanelCajaDueno() {
    const estado = document.getElementById("duenoCajaEstado");
    estado.textContent = "Cargando...";

    try {
        const datos = await fetchAutenticado("/caja/turno-activo");
        duenoCajaTurnoActual = datos.turno;
        duenoCajaResumenActual = datos.resumen;
        renderEstadoCajaDueno();
    } catch (error) {
        estado.textContent = "No se pudo cargar el estado de caja";
    }
}

function renderEstadoCajaDueno() {
    const turno = duenoCajaTurnoActual;
    const resumen = duenoCajaResumenActual;
    const estado = document.getElementById("duenoCajaEstado");
    const statusCard = document.getElementById("duenoCajaStatusCard");
    const resumenCard = document.getElementById("duenoCajaResumenCard");
    const botonAbrir = document.getElementById("duenoCajaBotonAbrir");
    const botonCerrar = document.getElementById("duenoCajaBotonCerrar");

    if (!turno) {
        estado.textContent = "Sin turno abierto";
        statusCard.innerHTML = `
            <div class="dueno-status-head">
                <div>
                    <span>Estado de caja</span>
                    <h2>Sin turno abierto</h2>
                </div>
                <span class="dueno-pill dueno-pill-limitado">Cerrado</span>
            </div>
        `;
        resumenCard.style.display = "none";
        botonAbrir.style.display = "block";
        botonCerrar.style.display = "none";
        return;
    }

    estado.textContent = `Abierto desde ${new Date(turno.abierto_at).toLocaleString("es-MX")}`;
    statusCard.innerHTML = `
        <div class="dueno-status-head">
            <div>
                <span>Estado de caja</span>
                <h2>Turno abierto</h2>
            </div>
            <span class="dueno-pill dueno-pill-normal">Abierto</span>
        </div>
        <div class="dueno-status-lineas">
            <div class="dueno-status-linea"><span>Fondo inicial</span><strong>$${Number(turno.fondo_inicial || 0).toFixed(2)}</strong></div>
            <div class="dueno-status-linea"><span>Efectivo esperado</span><strong>$${Number(resumen?.esperado_efectivo || 0).toFixed(2)}</strong></div>
        </div>
    `;

    document.getElementById("duenoCajaResumenLista").innerHTML = `
        <div class="fila-dueno"><span>Ventas</span><strong>$${Number(resumen?.ventas || 0).toFixed(2)}</strong></div>
        <div class="fila-dueno"><span>Efectivo</span><strong>$${Number(resumen?.efectivo || 0).toFixed(2)}</strong></div>
        <div class="fila-dueno"><span>Tarjeta</span><strong>$${Number(resumen?.tarjeta || 0).toFixed(2)}</strong></div>
        <div class="fila-dueno"><span>Transferencia</span><strong>$${Number(resumen?.transferencia || 0).toFixed(2)}</strong></div>
        <div class="fila-dueno"><span>Credito</span><strong>$${Number(resumen?.credito || 0).toFixed(2)}</strong></div>
        <div class="fila-dueno"><span>Entradas</span><strong>$${Number(resumen?.entradas || 0).toFixed(2)}</strong></div>
        <div class="fila-dueno"><span>Salidas</span><strong>$${Number(resumen?.salidas || 0).toFixed(2)}</strong></div>
    `;

    resumenCard.style.display = "block";
    botonAbrir.style.display = "none";
    botonCerrar.style.display = "block";
}

function mostrarAbrirTurnoDueno() {
    document.getElementById("duenoCajaAccionTitulo").textContent = "Abrir turno";
    document.getElementById("duenoCajaAccionContenido").innerHTML = `
        <label class="dueno-campo">Fondo inicial
            <input type="number" id="duenoCajaFondoInicial" inputmode="decimal" min="0" step="0.01" placeholder="0.00">
        </label>
        <label class="dueno-campo">Notas (opcional)
            <textarea id="duenoCajaAbrirNotas" rows="2" placeholder="Ej. turno de la mañana"></textarea>
        </label>
        <p class="dueno-estado" id="duenoCajaAbrirError" style="display:none;"></p>
        <button type="button" class="dueno-boton-primario" onclick="confirmarAbrirTurnoDueno()">Abrir turno</button>
    `;
    document.getElementById("duenoCajaAccionOverlay").classList.add("abierta");
}

async function confirmarAbrirTurnoDueno() {
    const fondoInicial = Number(document.getElementById("duenoCajaFondoInicial").value || 0);
    const notas = document.getElementById("duenoCajaAbrirNotas").value.trim();
    const errorEl = document.getElementById("duenoCajaAbrirError");

    try {
        await fetchAutenticado("/caja/abrir", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ fondoInicial, notas })
        });
        cerrarAccionCajaDueno();
        await cargarPanelCajaDueno();
    } catch (error) {
        errorEl.textContent = error.message || "No se pudo abrir el turno";
        errorEl.style.display = "block";
    }
}

function mostrarCerrarTurnoDueno() {
    const resumen = duenoCajaResumenActual;

    document.getElementById("duenoCajaAccionTitulo").textContent = "Cerrar turno (corte)";
    document.getElementById("duenoCajaAccionContenido").innerHTML = `
        <p class="dueno-estado">Cuenta el dinero real en caja por cada metodo.</p>
        <label class="dueno-campo">Efectivo contado (ventas: $${Number(resumen?.efectivo || 0).toFixed(2)})
            <input type="number" id="duenoCajaEfectivoContado" inputmode="decimal" min="0" step="0.01" placeholder="0.00">
        </label>
        <label class="dueno-campo">Tarjeta contado (ventas: $${Number(resumen?.tarjeta || 0).toFixed(2)})
            <input type="number" id="duenoCajaTarjetaContado" inputmode="decimal" min="0" step="0.01" placeholder="0.00">
        </label>
        <label class="dueno-campo">Transferencia contado (ventas: $${Number(resumen?.transferencia || 0).toFixed(2)})
            <input type="number" id="duenoCajaTransferenciaContado" inputmode="decimal" min="0" step="0.01" placeholder="0.00">
        </label>
        <label class="dueno-campo">Credito contado (ventas: $${Number(resumen?.credito || 0).toFixed(2)})
            <input type="number" id="duenoCajaCreditoContado" inputmode="decimal" min="0" step="0.01" placeholder="0.00">
        </label>
        <label class="dueno-campo">Notas (opcional)
            <textarea id="duenoCajaCerrarNotas" rows="2" placeholder="Ej. faltante por cambio mal dado"></textarea>
        </label>
        <p class="dueno-estado" id="duenoCajaCerrarError" style="display:none;"></p>
        <button type="button" class="dueno-boton-primario" onclick="confirmarCerrarTurnoDueno()">Confirmar corte</button>
    `;
    document.getElementById("duenoCajaAccionOverlay").classList.add("abierta");
}

async function confirmarCerrarTurnoDueno() {
    const errorEl = document.getElementById("duenoCajaCerrarError");
    const cuerpo = {
        efectivoContado: Number(document.getElementById("duenoCajaEfectivoContado").value || 0),
        tarjetaContado: Number(document.getElementById("duenoCajaTarjetaContado").value || 0),
        transferenciaContado: Number(document.getElementById("duenoCajaTransferenciaContado").value || 0),
        creditoContado: Number(document.getElementById("duenoCajaCreditoContado").value || 0),
        notas: document.getElementById("duenoCajaCerrarNotas").value.trim()
    };

    try {
        const datos = await fetchAutenticado("/caja/cerrar", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(cuerpo)
        });
        renderResultadoCorteDueno(datos.turno);
    } catch (error) {
        errorEl.textContent = error.message || "No se pudo cerrar el turno";
        errorEl.style.display = "block";
    }
}

function renderResultadoCorteDueno(turno) {
    const diferencia = Number(turno.diferencia || 0);
    const claseColor = diferencia === 0 ? "dueno-pill-normal" : "dueno-pill-limitado";
    const textoDiferencia = diferencia === 0
        ? "Cuadró exacto"
        : diferencia > 0
            ? `Sobrante de $${diferencia.toFixed(2)}`
            : `Faltante de $${Math.abs(diferencia).toFixed(2)}`;

    document.getElementById("duenoCajaAccionTitulo").textContent = "Corte realizado";
    document.getElementById("duenoCajaAccionContenido").innerHTML = `
        <div class="dueno-status-card">
            <div class="dueno-status-head">
                <div>
                    <span>Efectivo esperado</span>
                    <h2>$${Number(turno.esperado_efectivo || 0).toFixed(2)}</h2>
                </div>
                <span class="dueno-pill ${claseColor}">${textoDiferencia}</span>
            </div>
        </div>
        <button type="button" class="dueno-boton-primario" onclick="finalizarCorteCajaDueno()">Listo</button>
    `;
}

function finalizarCorteCajaDueno() {
    cerrarAccionCajaDueno();
    cargarPanelCajaDueno();
}

function cerrarAccionCajaDueno() {
    document.getElementById("duenoCajaAccionOverlay").classList.remove("abierta");
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
        carrito: '<circle cx="9" cy="20" r="1.4"/><circle cx="18" cy="20" r="1.4"/><path d="M2 3h2l2.4 12.2a1.6 1.6 0 0 0 1.6 1.3h9a1.6 1.6 0 0 0 1.6-1.3L21 7H6"/>',
        flecha: '<path d="M9 6l6 6-6 6"/>'
    };

    return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${iconos[nombre] || iconos.usuario}</svg>`;
}

// Categorias reales (con sub-pantalla funcional) primero; las que el
// negocio todavia no tiene construidas quedan visibles pero marcadas
// "proximamente" -- mismo patron ya usado en la pestaña Reportes, para
// no fingir una funcion que no existe todavia.
const CATEGORIAS_MAS_DUENO = [
    { id: "market", titulo: "Comprar en Nexo Market", desc: "Explora productos de otras ferreterias", icono: "carrito", color: "verde", href: "https://app.nexoposoficial.com/market" },
    { id: "cuenta", titulo: "Cuenta", desc: "Datos del negocio y correo", icono: "usuario", color: "" },
    { id: "plan", titulo: "Plan y suscripcion", desc: "Tu plan, pagos y facturas", icono: "tarjeta", color: "verde" },
    { id: "nexo-ia", titulo: "Nexo IA", desc: "Consumo y disponibilidad", icono: "chispa", color: "morado" },
    { id: "seguridad", titulo: "Seguridad", desc: "Contraseña y sesiones", icono: "candado", color: "rojo" },
    { id: "dispositivos", titulo: "Dispositivos", desc: "Cajas vinculadas a tu negocio", icono: "dispositivo", color: "" },
    { id: "ayuda", titulo: "Ayuda", desc: "Contacto y version de la app", icono: "ayuda", color: "gris" },
    { id: "apariencia", titulo: "Apariencia", desc: "Tema claro u oscuro", icono: "pincel", color: "" },
    { id: "notificaciones", titulo: "Notificaciones", desc: "Proximamente", icono: "campana", color: "gris", proximamente: true },
    { id: "respaldos", titulo: "Respaldos", desc: "Proximamente", icono: "nube", color: "gris", proximamente: true }
];

function renderCategoriasMasDueno() {
    document.getElementById("duenoMasCategorias").innerHTML =
        CATEGORIAS_MAS_DUENO.map(categoria => `
            <button type="button" class="dueno-categoria-row${categoria.proximamente ? " proximamente" : ""}"
                onclick="${categoria.href ? `location.href='${categoria.href}'` : (categoria.proximamente ? "proximamenteDueno()" : `abrirSubpantallaMasDueno('${categoria.id}')`)}">
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
    ayuda: renderSubpantallaAyuda,
    apariencia: renderSubpantallaApariencia
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
        ia.plan === "pro" || ia.plan === "demo"
            ? `${ia.usosVigentes} preguntas de analisis profundo este mes -- tu plan no tiene un limite practico.`
            : `${ia.usosVigentes} de ${ia.limite} preguntas de analisis profundo usadas este mes.`;

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

        <article class="dueno-card">
            <div class="dueno-toggle-fila" onclick="proximamenteDueno()">
                <div>
                    <strong>Desbloqueo con huella / Face ID</strong>
                    <span>Entra a la app sin escribir tu contraseña</span>
                </div>
                <span class="dueno-toggle-switch dueno-toggle-deshabilitado"></span>
            </div>
            <span class="dueno-badge dueno-badge-pendiente">Proximamente</span>
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
                <div><span>App</span><strong>Nexo -- App del dueño</strong></div>
            </div>
        </article>
    `;
}

function aplicarTemaDueno() {
    const oscuro =
    localStorage.getItem(DUENO_TEMA_KEY) === "oscuro";

    document.documentElement.classList.toggle("oscuro", oscuro);
}

function cambiarTemaDueno() {
    const activo =
    !document.documentElement.classList.contains("oscuro");

    document.documentElement.classList.toggle("oscuro", activo);
    localStorage.setItem(DUENO_TEMA_KEY, activo ? "oscuro" : "claro");

    const meta =
    document.querySelector('meta[name="theme-color"]');

    if (meta) meta.setAttribute("content", activo ? "#0b1220" : "#f6f7fb");

    renderSubpantallaApariencia();
}

function renderSubpantallaApariencia() {
    const activo =
    document.documentElement.classList.contains("oscuro");

    document.getElementById("duenoMasSubpantallaContenido").innerHTML = `
        <article class="dueno-card">
            <div class="card-head">
                <div>
                    <span>Apariencia</span>
                    <h2>Tema de la app</h2>
                </div>
            </div>
            <div class="dueno-toggle-fila" onclick="cambiarTemaDueno()">
                <div>
                    <strong>Modo oscuro</strong>
                    <span>${activo ? "Activado" : "Usa el tema claro por defecto"}</span>
                </div>
                <span class="dueno-toggle-switch${activo ? " activo" : ""}"></span>
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
    duenoEmpleadoNombrePersona = null;
    duenoEmpleadoCorreoPersona = null;
    mostrarLoginDueno();
}

// ---------------- Onboarding (primera vez) ----------------

function mostrarOnboardingDueno() {
    document.getElementById("duenoLogin").style.display = "none";
    document.getElementById("duenoOnboarding").style.display = "flex";

    duenoOnboardingSlideActual = 0;
    renderDotsOnboardingDueno();
    actualizarSlideOnboardingDueno();
}

function renderDotsOnboardingDueno() {
    document.getElementById("duenoOnboardingDots").innerHTML =
        Array.from({ length: DUENO_ONBOARDING_TOTAL_SLIDES }, (valor, indice) =>
            `<span class="dueno-onboarding-dot${indice === duenoOnboardingSlideActual ? " activo" : ""}"></span>`
        ).join("");
}

function actualizarSlideOnboardingDueno() {
    document.getElementById("duenoOnboardingSlides").style.transform =
        `translateX(-${duenoOnboardingSlideActual * 100}%)`;

    document.querySelectorAll(".dueno-onboarding-dot").forEach((punto, indice) => {
        punto.classList.toggle("activo", indice === duenoOnboardingSlideActual);
    });

    document.getElementById("duenoOnboardingBoton").textContent =
        duenoOnboardingSlideActual === DUENO_ONBOARDING_TOTAL_SLIDES - 1 ? "Comenzar" : "Siguiente";
}

function siguienteDiapositivaOnboardingDueno() {
    if (duenoOnboardingSlideActual < DUENO_ONBOARDING_TOTAL_SLIDES - 1) {
        duenoOnboardingSlideActual += 1;
        actualizarSlideOnboardingDueno();
        return;
    }

    completarOnboardingDueno();
}

function completarOnboardingDueno() {
    localStorage.setItem(DUENO_ONBOARDING_KEY, "1");
    document.getElementById("duenoOnboarding").style.display = "none";
    mostrarLoginDueno();
}

// ---------------- Nexo IA: burbuja flotante + chat ----------------

async function actualizarNexoBurbujaDueno() {
    const burbuja =
    document.getElementById("duenoNexoBurbuja");

    if (!burbuja) return;

    try {
        const datos =
        await fetchAutenticado("/ia/resumen-rapido");

        const hayAlerta =
            Boolean(datos?.stockBajo?.productos?.length) ||
            Boolean(datos?.creditos?.clientesVencidos);

        burbuja.classList.toggle("con-alerta", hayAlerta);
    } catch (error) {
        // Decorativo -- si falla, la burbuja se queda sin el punto de
        // alerta, nunca bloquea ni muestra error.
    }
}

function abrirNexoChatDueno() {
    const overlay = document.getElementById("duenoNexoChatOverlay");

    // Si ya esta abierto (doble tap en la burbuja, comun en celular),
    // no hacer nada -- sin este guard, el saludo se agregaba dos veces
    // porque duenoNexoHistorial seguia vacio en ambas llamadas.
    if (overlay.style.display === "flex") return;

    overlay.style.display = "flex";

    if (duenoNexoHistorial.length === 0) {
        agregarMensajeNexoDueno("Hola, soy Nexo. Preguntame como van tus ventas, tu inventario o tus creditos.", "asistente");
    }

    document.getElementById("duenoNexoInput")?.focus();
}

function cerrarNexoChatDueno() {
    document.getElementById("duenoNexoChatOverlay").style.display = "none";
}

function agregarMensajeNexoDueno(texto, clase) {
    const lista =
    document.getElementById("duenoNexoMensajes");

    if (!lista) return null;

    const burbuja =
    document.createElement("div");

    burbuja.className = `dueno-nexo-mensaje ${clase}`;
    burbuja.textContent = texto;
    lista.appendChild(burbuja);
    lista.scrollTop = lista.scrollHeight;

    return burbuja;
}

async function enviarMensajeNexoDueno() {
    if (duenoNexoEnviando) return;

    const input =
    document.getElementById("duenoNexoInput");

    const mensaje =
    (input?.value || "").trim();

    if (!mensaje) return;

    input.value = "";
    agregarMensajeNexoDueno(mensaje, "usuario");

    const indicador =
    agregarMensajeNexoDueno("Nexo esta pensando...", "pensando");

    duenoNexoEnviando = true;

    const boton =
    document.getElementById("duenoNexoEnviar");

    if (boton) boton.disabled = true;

    try {
        const datos =
        await fetchAutenticado("/ia/chat", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ mensaje, conversacionId: duenoNexoConversacionId })
        });

        indicador?.remove();

        if (!datos?.ok) {
            agregarMensajeNexoDueno(datos?.error || "Nexo no pudo responder. Intenta de nuevo.", "error");
            return;
        }

        agregarMensajeNexoDueno(datos.respuesta, "asistente");
        duenoNexoHistorial.push({ rol: "user", contenido: mensaje });
        duenoNexoHistorial.push({ rol: "assistant", contenido: datos.respuesta });
        if (datos.conversacionId) duenoNexoConversacionId = datos.conversacionId;
    } catch (error) {
        indicador?.remove();

        // fetchAutenticado lanza errores con mensaje util (sesion
        // expirada, error real del servidor) -- solo un TypeError real
        // de fetch() (sin conexion, DNS, etc.) amerita el mensaje
        // generico. Mostrar siempre el mismo texto ocultaba la causa
        // real (ej. un 500 del servidor se veia identico a "sin senal").
        const esFalloDeRed = error instanceof TypeError;
        agregarMensajeNexoDueno(
            esFalloDeRed ? "No se pudo conectar con Nexo. Revisa tu conexion." : (error.message || "Nexo no pudo responder. Intenta de nuevo."),
            "error"
        );
    } finally {
        duenoNexoEnviando = false;

        const botonFinal =
        document.getElementById("duenoNexoEnviar");

        if (botonFinal) botonFinal.disabled = false;
    }
}

// ---------------- arranque ----------------

if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("/dueno-sw.js").catch(() => {
        // Sin Service Worker el resto de la pagina sigue funcionando
        // igual mientras haya conexion -- solo se pierde el arranque
        // 100% offline con el navegador recien abierto.
    });
}

// Recibe el token cuando se llega desde Nexo Market ("Entrar a X" o el
// auto-redirect de cuentas puramente administradoras) -- localStorage no
// se comparte entre nexoposoficial.com y app.nexoposoficial.com (origenes
// distintos), asi que el token viaja una sola vez por query string y se
// guarda aqui, del lado de /dueno, antes de limpiar la URL.
function recibirTokenDesdeMarket() {
    const parametros = new URLSearchParams(window.location.search);
    const token = parametros.get("entrar");
    if (!token) return;

    localStorage.setItem(DUENO_TOKEN_KEY, token);
    parametros.delete("entrar");
    const query = parametros.toString();
    window.history.replaceState({}, "", window.location.pathname + (query ? `?${query}` : ""));
}

window.addEventListener("load", () => {
    recibirTokenDesdeMarket();
    aplicarTemaDueno();

    document.getElementById("duenoSaludo").textContent = saludoHora();

    [
        document.getElementById("duenoLoginCorreo"),
        document.getElementById("duenoLoginPassword")
    ].forEach(campo => {
        campo?.addEventListener("keydown", evento => {
            if (evento.key === "Enter") iniciarSesionDueno();
        });
    });

    [
        document.getElementById("duenoLoginEmpleadoId"),
        document.getElementById("duenoLoginEmpleadoPassword")
    ].forEach(campo => {
        campo?.addEventListener("keydown", evento => {
            if (evento.key === "Enter") iniciarSesionEmpleadoDueno();
        });
    });

    if (tokenGuardado()) {
        localStorage.setItem(DUENO_ONBOARDING_KEY, "1");
        mostrarAppDueno();
        sincronizarRolSesionDueno();
        actualizarNexoBurbujaDueno();
        setInterval(() => { if (duenoRolSesion !== "employee") cargarPanelDueno(); }, 60000);
        setInterval(actualizarNexoBurbujaDueno, 60000);
    } else {
        mostrarBienvenidaDueno();
    }
});
