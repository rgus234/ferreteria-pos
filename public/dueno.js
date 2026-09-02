const DUENO_TOKEN_KEY = "nexoCuentaSesionToken";
const DUENO_ONBOARDING_KEY = "nexoDuenoOnboardingVisto";
const DUENO_ONBOARDING_TOTAL_SLIDES = 5;
const DUENO_TEMA_KEY = "nexoDuenoTema";

let duenoCarrito = [];
let duenoUltimosResultados = [];
let duenoProductoDetalleActual = null;
let duenoVentaDetalleActual = null;
let duenoVentaDetalleVista = "resumen";
let duenoVentaDetalleTab = "informacion";
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

// Placeholder de miniatura cuando el producto no tiene foto -- antes
// era solo la palabra "Sin foto" en texto chico; un catalogo real
// siempre va a tener productos sin foto todavia, asi que vale la pena
// que se vea a proposito y no como que falta cargar algo.
function miniaturaVaciaDuenoHtml() {
    return `<span class="dueno-miniatura-vacia"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg></span>`;
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
    resuscribirPushDuenoSiYaHabiaPermiso();
    actualizarBadgePedidosDueno();
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

// "Crear cuenta" es una señal explicita de querer una cuenta NUEVA --
// pero /market/mi-cuenta detecta cualquier sesion de persona que ya
// siga viva (cookie de dominio) y, si esa persona administra un
// negocio, aterriza derecho en SU panel de administrador, ignorando
// por completo la intencion de registrar una cuenta distinta. Bug real
// reportado por el dueño probando en su telefono: le dio "Crear
// cuenta" y lo mando al panel de Ferreteria Olimpico porque esa sesion
// vieja seguia viva. Se cierra cualquier sesion de persona ANTES de
// navegar (y se espera a que termine) para que el servidor si
// muestre el formulario de registro.
async function irACrearCuentaMarket() {
    try {
        await fetch("/personas/logout", { method: "POST" });
    } catch (error) {
        // Sin sesion previa o sin conexion -- no bloquea la navegacion,
        // el registro funciona igual sin sesion de persona.
    }
    window.location.href = "/market/mi-cuenta?tab=registro";
}

function mostrarLoginEmpleadoDueno() {
    document.getElementById("duenoLoginCajaDueno").style.display = "none";
    document.getElementById("duenoLoginCajaEmpleado").style.display = "block";
    document.getElementById("duenoVincularEmpleadoCaja").style.display = "none";
    document.getElementById("duenoLoginEmpleadoSelector").style.display = "none";
    document.getElementById("btnDuenoLoginEmpleado").style.display = "block";
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
    }).then(async respuesta => {
        const datos = await respuesta.json();
        datos.status = respuesta.status;
        return datos;
    });
}

// Se muestra cuando la cuenta Nexo de la persona ya existe (login
// correcto) pero todavia no esta vinculada a ningun negocio -- antes
// esto se quedaba como un error generico sin salida ("No eres
// empleado de ningun negocio en Nexo"), aunque el dueño ya le hubiera
// generado un codigo de vinculacion desde el panel de escritorio
// (config-auth.js, "Acceso a Nexo") -- no habia ninguna pantalla en
// /dueno donde meter ese codigo.
function mostrarVincularEmpleadoDueno() {
    document.getElementById("btnDuenoLoginEmpleado").style.display = "none";
    document.getElementById("duenoLoginEmpleadoSelector").style.display = "none";
    document.getElementById("duenoVincularEmpleadoCaja").style.display = "block";
}

async function vincularCodigoEmpleadoDueno() {
    const codigo = document.getElementById("duenoVincularEmpleadoCodigo")?.value.trim();
    const cajaError = document.getElementById("duenoVincularEmpleadoError");
    const boton = document.getElementById("btnDuenoVincularEmpleado");

    cajaError.style.display = "none";

    if (!codigo) {
        cajaError.textContent = "Escribe el codigo que te dio tu jefe.";
        cajaError.style.display = "block";
        return;
    }

    boton.disabled = true;
    boton.textContent = "Vinculando...";

    try {
        const respuesta = await fetch("/personas/vincular-empleado", {
            method: "POST",
            headers: { "Content-Type": "application/json", "x-persona-token": duenoPersonaTokenTemporal },
            body: JSON.stringify({ codigo })
        });
        const datos = await respuesta.json();

        if (!datos.ok) {
            cajaError.textContent = datos.error || "No se pudo vincular tu cuenta.";
            cajaError.style.display = "block";
            return;
        }

        // El canje ya asocio la persona al negocio (negocio_miembros),
        // pero /personas/vincular-empleado no entrega una sesion de
        // /dueno -- hay que pedirla aparte, mismo endpoint que el login
        // normal de empleado, ahora si con exito porque ya hay membresia.
        const datosSesion = await entrarComoEmpleadoDueno(null);

        if (!datosSesion.ok) {
            cajaError.textContent = datosSesion.error || "Tu cuenta se vinculo, pero no se pudo iniciar sesion. Intenta entrar de nuevo.";
            cajaError.style.display = "block";
            return;
        }

        document.getElementById("duenoVincularEmpleadoCaja").style.display = "none";

        if (datosSesion.requiereSeleccion) {
            mostrarSelectorNegocioEmpleadoDueno(datosSesion.negocios);
            return;
        }

        completarLoginEmpleadoDueno(datosSesion);
    } catch (error) {
        cajaError.textContent = "No se pudo conectar. Revisa tu internet e intenta de nuevo.";
        cajaError.style.display = "block";
    } finally {
        boton.disabled = false;
        boton.textContent = "Vincular";
    }
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
            if (datos.status === 404) {
                mostrarVincularEmpleadoDueno();
                return;
            }
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

    // "0% vs ayer" se pintaba verde (el corte era ">= 0") tanto sin
    // ventas de ningun lado como con un dia identico al anterior --
    // ninguno de los dos es en realidad buena noticia.
    const hayDatosQueComparar =
        hoy.length || ayer.length;

    estado.textContent =
        hayDatosQueComparar
            ? `${diferencia >= 0 ? "+" : ""}${diferencia.toFixed(0)}% vs ayer`
            : "Aun sin ventas hoy";

    estado.className =
        diferencia > 0 ? "dueno-estado-positivo" : diferencia < 0 ? "dueno-estado-negativo" : "";

    renderSparklineSVG(hoy);

    document.getElementById("duenoUltimasVentas").innerHTML =
        historial.length
            ? historial.slice(0, 8).map(venta => `
                <div class="fila-dueno" onclick="abrirDetalleVentaDueno(${Number(venta.id) || 0})">
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

    // El boton de menu (tres rayas) lleva a la pestaña "mas", que ya
    // esta marcada solo-dueño en DUENO_TABS_SOLO_DUENO -- un empleado
    // no tiene nada util ahi (ni cuenta, ni plan, ni reportes), asi
    // que el boton mismo se oculta en vez de llevarlo a una pantalla
    // vacia para su rol.
    document.querySelectorAll(".dueno-menu-boton").forEach(boton => {
        boton.style.display = esEmpleado ? "none" : "";
    });

    if (esEmpleado) cambiarTabDueno("pedidos");
}

async function sincronizarRolSesionDueno() {
    try {
        const datos = await fetchAutenticado("/negocio-actual");
        duenoRolSesion = datos.rol || "owner";
        if (datos.personaNombre) duenoEmpleadoNombrePersona = datos.personaNombre;

        // El login ya pone el nombre real del negocio en el saludo,
        // pero una sesion guardada (que es como se abre la app la
        // gran mayoria de las veces, al reabrir el icono instalado)
        // nunca pasaba por ahi -- se quedaba con el "Tu negocio"
        // generico del HTML para siempre. Aqui es donde debe
        // refrescarse tambien.
        if (datos.negocio?.nombre) {
            const elementoNegocio = document.getElementById("duenoNegocio");
            if (elementoNegocio) elementoNegocio.textContent = datos.negocio.nombre;
        }
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
                            : miniaturaVaciaDuenoHtml()}
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

    renderDetalleProductoDueno(producto, "agregar");
}

// Version "en vivo" para cuando se entra desde una venta (Detalle de
// venta -> tocar un producto): no puede usar duenoUltimosResultados
// (cache de la ultima busqueda de inventario, puede no tener nada
// cargado aun) ni el catalogo offline (recortado, sin stock_minimo/
// ubicacion/costo) -- pide el producto fresco al servidor para
// mostrar el stock real de HOY, no uno guardado.
async function abrirDetalleProductoVentaDueno(id) {
    try {
        const datos =
        await fetchAutenticado(`/productos/${Number(id)}`);

        if (!datos?.producto) {
            mostrarToastDueno("No se pudo cargar el producto.");
            return;
        }

        renderDetalleProductoDueno(
            {
                id: datos.producto.id,
                nombre: datos.producto.nombre,
                codigo: datos.producto.codigo,
                precio: datos.producto.precio_publico ?? datos.producto.precio,
                stock: datos.producto.stock,
                imagenUrl: datos.producto.imagenUrl,
                categoria: datos.producto.categoria,
                marca: datos.producto.marca,
                descripcion: datos.producto.descripcion,
                unidadVenta: datos.producto.unidad_venta,
                stockMinimo: datos.producto.stock_minimo,
                ubicacion: datos.producto.ubicacion,
                precioDistribuidor: datos.producto.precio_distribuidor
            },
            "inventario"
        );
    } catch (error) {
        mostrarToastDueno("No se pudo conectar. Revisa tu internet.");
    }
}

// Los onclick de los botones aqui son siempre literales fijos (nunca
// texto interpolado de un producto) a proposito: escaparDueno() sola
// no alcanza para proteger un valor embebido dentro de un onclick con
// comillas simples -- el navegador decodifica entidades HTML ANTES de
// que el JS se ejecute, asi que un nombre/codigo con una comilla
// simple sobreviviria el decode y podria escapar el string. Cualquier
// dato que el boton necesite se lee de duenoProductoDetalleActual en
// vez de pasarse como argumento.
const ACCIONES_DETALLE_PRODUCTO_DUENO = {
    agregar: { texto: "Agregar al pedido", onclick: "agregarDesdeDetalleDueno()" },
    inventario: { texto: "Ver en inventario", onclick: "verEnInventarioDesdeVentaDueno()" }
};

function renderDetalleProductoDueno(producto, accion) {
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
    if (producto.stockMinimo != null) specs.push(["Stock minimo", String(Number(producto.stockMinimo))]);
    if (producto.ubicacion) specs.push(["Ubicacion", producto.ubicacion]);
    if (producto.precioDistribuidor) specs.push(["Costo", dinero(producto.precioDistribuidor)]);
    if (producto.descripcion) specs.push(["Descripcion", producto.descripcion]);

    document.getElementById("duenoDetalleSpecs").innerHTML =
        specs.map(([etiqueta, valor]) => `
            <div class="dueno-detalle-spec">
                <span>${escaparDueno(etiqueta)}</span>
                <strong>${escaparDueno(valor)}</strong>
            </div>
        `).join("");

    const boton =
    ACCIONES_DETALLE_PRODUCTO_DUENO[accion] || ACCIONES_DETALLE_PRODUCTO_DUENO.agregar;

    document.getElementById("duenoDetalleAccion").innerHTML =
        `<button type="button" class="dueno-boton-primario" onclick="${boton.onclick}">${escaparDueno(boton.texto)}</button>`;

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

// Desde el detalle de un producto abierto vía una venta: manda al
// inventario ya filtrado por su codigo, en vez de intentar abrir un
// modal de edicion con datos que a esta altura ya podrian no ser los
// mas recientes (el dueño pudo haber cerrado el detalle hace rato).
function verEnInventarioDesdeVentaDueno() {
    const codigo =
    duenoProductoDetalleActual?.codigo || "";

    cerrarDetalleProductoDueno();
    cerrarDetalleVentaDueno();
    cambiarTabDueno("inventario");

    // cambiarTabDueno dispara cargarPanelInventarioDueno() sin
    // esperarlo (recarga categorias + re-filtra con la busqueda
    // vacia) -- se espera un poco a que asiente antes de escribir la
    // busqueda, si no la sobreescribe el propio filtrado inicial.
    setTimeout(() => {
        const campo =
        document.getElementById("duenoInventarioBuscar");

        if (campo) campo.value = codigo;

        filtrarInventarioDueno();
    }, 120);
}

// Detalle de venta -- se abre al tocar la notificacion push de "Venta
// registrada" (dueno-sw.js manda ?ir=venta&ventaId=<id>, ver
// aplicarDeepLinkDueno) o al tocar una venta en "Ultimas ventas"
// (inicio y reportes). Resumen primero (para el vistazo rapido al
// llegar desde la notificacion), con boton a un detalle completo con
// tabs -- mismo overlay para los dos, solo cambia el contenido segun
// duenoVentaDetalleVista/duenoVentaDetalleTab.
async function abrirDetalleVentaDueno(id) {
    if (!id) return;

    try {
        const datos =
        await fetchAutenticado(`/ventas/${Number(id)}`);

        if (!datos?.venta) {
            mostrarToastDueno("No se pudo cargar la venta.");
            return;
        }

        duenoVentaDetalleActual = datos.venta;
        duenoVentaDetalleVista = "resumen";
        duenoVentaDetalleTab = "informacion";

        renderDetalleVentaDueno();
        document.getElementById("duenoVentaDetalleOverlay").style.display = "flex";
    } catch (error) {
        mostrarToastDueno("No se pudo conectar. Revisa tu internet.");
    }
}

function cerrarDetalleVentaDueno() {
    const overlay =
    document.getElementById("duenoVentaDetalleOverlay");

    if (overlay) overlay.style.display = "none";

    duenoVentaDetalleActual = null;
}

function mostrarDetalleVentaCompletoDueno() {
    duenoVentaDetalleVista = "completo";
    duenoVentaDetalleTab = "informacion";
    renderDetalleVentaDueno();
}

function cambiarTabDetalleVentaDueno(tab) {
    duenoVentaDetalleTab = tab;
    renderDetalleVentaDueno();
}

// stock_minimo por defecto en 3 -- mismo criterio ya usado en
// renderBajos() (dashboard), no el limite fijo de 5 que usa el POS de
// escritorio, para que el mismo producto no aparezca "bajo" en una
// pantalla y "en stock" en la otra dentro de la MISMA app.
function estadoStockItemVentaDueno(item) {
    if (item.stockActual == null) return null;

    const stock = Number(item.stockActual || 0);
    if (stock <= 0) return "sin";

    const minimo = Number(item.stockMinimo || 3);
    if (stock <= minimo) return "bajo";

    return "ok";
}

const ETIQUETA_STOCK_ITEM_VENTA_DUENO = { ok: "En stock", bajo: "Stock bajo", sin: "Sin stock" };
const ETIQUETAS_METODO_PAGO_DUENO = { efectivo: "Efectivo", tarjeta: "Tarjeta", transferencia: "Transferencia", credito: "Credito", mixto: "Pago mixto" };

function etiquetaMetodoPagoDueno(metodo) {
    return ETIQUETAS_METODO_PAGO_DUENO[metodo] || metodo || "Efectivo";
}

function renderDetalleVentaDueno() {
    const venta =
    duenoVentaDetalleActual;

    const contenedor =
    document.getElementById("duenoVentaDetalleContenido");

    if (!venta || !contenedor) return;

    contenedor.innerHTML =
        duenoVentaDetalleVista === "resumen"
            ? htmlResumenVentaDueno(venta)
            : htmlDetalleCompletoVentaDueno(venta);
}

function htmlItemVentaCompactoDueno(item) {
    const estado =
    estadoStockItemVentaDueno(item);

    const importe =
    item.importe ?? (Number(item.precio || 0) * Number(item.cantidad || 0));

    return `
        <div class="dueno-venta-item-compacto">
            <div class="dueno-venta-item-info">
                <strong>${escaparDueno(item.nombre || "Producto")}</strong>
                <span>${item.cantidad || 0} x ${dinero(item.precio)}</span>
            </div>
            <div class="dueno-venta-item-precio">
                ${estado ? `<span class="dueno-stock-dot dueno-stock-dot-${estado}"></span>` : ""}
                <b>${dinero(importe)}</b>
            </div>
        </div>
    `;
}

function htmlResumenVentaDueno(venta) {
    const productos =
    Array.isArray(venta.productos) ? venta.productos : [];

    const totalUnidades =
    productos.reduce((suma, item) => suma + Number(item.cantidad || 0), 0);

    const alertas =
    productos.filter(item => {
        const estado = estadoStockItemVentaDueno(item);
        return estado === "bajo" || estado === "sin";
    });

    const folio =
    venta.folio || `V-${String(venta.id || 0).padStart(6, "0")}`;

    const estadoTexto =
    String(venta.estado || "completada");

    return `
        <div class="dueno-venta-cabecera">
            <div>
                <span class="dueno-venta-eyebrow">Folio</span>
                <h2 class="dueno-venta-folio">${escaparDueno(folio)}</h2>
            </div>
            <span class="dueno-badge dueno-badge-ok">${escaparDueno(estadoTexto.charAt(0).toUpperCase() + estadoTexto.slice(1))}</span>
        </div>
        <p class="dueno-venta-subtexto">${escaparDueno(fechaCorta(venta.fecha))} &middot; ${escaparDueno(venta.cliente_nombre || "Publico general")}</p>

        <div class="dueno-datos-grid">
            <div><span>Total</span><strong>${dinero(venta.total)}</strong></div>
            <div><span>Productos</span><strong>${totalUnidades} unidad${totalUnidades === 1 ? "" : "es"}</strong></div>
            <div><span>Pago</span><strong>${escaparDueno(etiquetaMetodoPagoDueno(venta.metodo_pago))}</strong></div>
        </div>

        ${alertas.length ? `
            <div class="dueno-venta-alerta">
                <strong>${alertas.length} producto${alertas.length === 1 ? "" : "s"} requiere${alertas.length === 1 ? "" : "n"} atencion</strong>
                <span>Revisa el stock para evitar faltantes.</span>
            </div>
        ` : ""}

        <div class="dueno-venta-lista-compacta">
            ${productos.map(htmlItemVentaCompactoDueno).join("")}
        </div>

        <button type="button" class="dueno-boton-primario" onclick="mostrarDetalleVentaCompletoDueno()">Ver detalle completo</button>
    `;
}

function htmlTabInformacionVentaDueno(venta) {
    return `
        <div class="dueno-datos-grid">
            <div><span>Cliente</span><strong>${escaparDueno(venta.cliente_nombre || "Publico general")}</strong></div>
            <div><span>Vendedor</span><strong>${escaparDueno(venta.cajero_nombre || venta.cajero_usuario || venta.turno_usuario || "-")}</strong></div>
            <div><span>Fecha</span><strong>${escaparDueno(fechaCorta(venta.fecha))}</strong></div>
            <div><span>Metodo de pago</span><strong>${escaparDueno(etiquetaMetodoPagoDueno(venta.metodo_pago))}</strong></div>
            <div><span>Subtotal</span><strong>${dinero(venta.subtotal)}</strong></div>
            ${Number(venta.descuento || 0) > 0 ? `<div><span>Descuento</span><strong>-${dinero(venta.descuento)}</strong></div>` : ""}
            <div><span>Total</span><strong>${dinero(venta.total)}</strong></div>
        </div>
    `;
}

function htmlTabProductosVentaDueno(venta) {
    const productos =
    Array.isArray(venta.productos) ? venta.productos : [];

    return `
        <div class="dueno-venta-lista-productos">
            ${productos.map(item => {
                const estado = estadoStockItemVentaDueno(item);
                const idProducto = Number(item.id) || 0;
                const importe = item.importe ?? (Number(item.precio || 0) * Number(item.cantidad || 0));

                return `
                    <div class="fila-dueno fila-dueno-columna"${idProducto > 0 ? ` onclick="abrirDetalleProductoVentaDueno(${idProducto})"` : ""}>
                        <div>
                            <strong>${escaparDueno(item.nombre || "Producto")}</strong>
                            <span>${item.cantidad || 0} x ${dinero(item.precio)}</span>
                        </div>
                        <div class="dueno-fila-acciones">
                            <b>${dinero(importe)}</b>
                            ${estado ? `<span class="dueno-pill dueno-pill-stock-${estado}">${ETIQUETA_STOCK_ITEM_VENTA_DUENO[estado]}</span>` : ""}
                        </div>
                    </div>
                `;
            }).join("")}
        </div>
        <p class="dueno-venta-total-productos"><span>Total</span><strong>${dinero(venta.total)}</strong></p>
    `;
}

function htmlTabPagosVentaDueno(venta) {
    const desglose =
    [
        ["Efectivo", venta.pago_efectivo],
        ["Tarjeta", venta.pago_tarjeta],
        ["Transferencia", venta.pago_transferencia],
        ["Credito", venta.pago_credito]
    ].filter(([, monto]) => Number(monto || 0) > 0);

    return `
        <div class="dueno-datos-grid">
            <div><span>Metodo</span><strong>${escaparDueno(etiquetaMetodoPagoDueno(venta.metodo_pago))}</strong></div>
            <div><span>Total</span><strong>${dinero(venta.total)}</strong></div>
            ${Number(venta.pago_recibido || 0) > 0 ? `<div><span>Recibido</span><strong>${dinero(venta.pago_recibido)}</strong></div>` : ""}
            ${Number(venta.cambio || 0) > 0 ? `<div><span>Cambio</span><strong>${dinero(venta.cambio)}</strong></div>` : ""}
        </div>
        ${desglose.length > 1 ? `
            <div class="dueno-subseccion">Desglose</div>
            <div class="dueno-venta-lista-compacta">
                ${desglose.map(([etiqueta, monto]) => `
                    <div class="dueno-venta-item-compacto">
                        <div class="dueno-venta-item-info"><strong>${escaparDueno(etiqueta)}</strong></div>
                        <b>${dinero(monto)}</b>
                    </div>
                `).join("")}
            </div>
        ` : ""}
    `;
}

function htmlDetalleCompletoVentaDueno(venta) {
    const tabs =
    [["informacion", "Informacion"], ["productos", "Productos"], ["pagos", "Pagos"]];

    const folio =
    venta.folio || `V-${String(venta.id || 0).padStart(6, "0")}`;

    let panel = "";
    if (duenoVentaDetalleTab === "productos") panel = htmlTabProductosVentaDueno(venta);
    else if (duenoVentaDetalleTab === "pagos") panel = htmlTabPagosVentaDueno(venta);
    else panel = htmlTabInformacionVentaDueno(venta);

    return `
        <div class="dueno-venta-cabecera">
            <div>
                <span class="dueno-venta-eyebrow">Detalle de venta</span>
                <h2 class="dueno-venta-folio">${escaparDueno(folio)}</h2>
            </div>
        </div>

        <div class="dueno-ventas-subtabs">
            ${tabs.map(([id, etiqueta]) => `
                <button type="button" class="${duenoVentaDetalleTab === id ? "activo" : ""}" onclick="cambiarTabDetalleVentaDueno('${id}')">${etiqueta}</button>
            `).join("")}
        </div>

        <div class="dueno-subtab-panel activo">${panel}</div>
    `;
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

// El badge de Pedidos existia en el HTML pero ningun JS lo tocaba --
// se quedaba oculto para siempre sin importar cuantos pedidos nuevos
// hubiera. Mismo patron que actualizarBadgeVentasDueno: se refresca al
// abrir la app, al entrar a la pestana Pedidos y al recuperar
// conexion. "nuevos" (estado=pendiente) es el grupo que de verdad
// necesita accion del dueno -- aceptar o rechazar.
async function actualizarBadgePedidosDueno() {
    const badge =
    document.getElementById("duenoPedidosBadge");

    if (!badge) return;

    try {
        const datos = await fetchAutenticado("/negocio-actual/pedidos-market?estado=nuevos");
        const cantidad = (datos.pedidos || []).length;

        if (cantidad > 0) {
            badge.textContent = cantidad;
            badge.style.display = "flex";
        } else {
            badge.style.display = "none";
        }
    } catch (error) {
        // Sin conexion, sin permiso de ver pedidos, o Market no activo
        // para este negocio -- se deja el badge como estaba, no es un
        // error que deba interrumpir nada mas de la app.
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
    actualizarBadgePedidosDueno();
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

    // valor > 0 es la unica mejora real -- 0% (sin cambio, o sin nada
    // que comparar en ninguno de los dos periodos) no es ni buena ni
    // mala noticia, y antes se pintaba verde de todos modos porque el
    // corte estaba en ">= 0".
    elemento.textContent = `${valor >= 0 ? "+" : ""}${valor.toFixed(0)}% vs periodo anterior`;
    elemento.className = valor > 0 ? "dueno-estado-positivo" : valor < 0 ? "dueno-estado-negativo" : "";
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
                <div class="fila-dueno fila-dueno-columna" onclick="abrirDetalleVentaDueno(${Number(venta.id) || 0})">
                    <div>
                        <strong>${escaparDueno(venta.folio || `V-${String(venta.id || 0).padStart(6, "0")}`)}</strong>
                        <span>${fechaCorta(venta.fecha)} · ${escaparDueno(venta.cliente_nombre || "Publico general")}</span>
                    </div>
                    <div class="dueno-fila-acciones">
                        <b>${dinero(venta.total)}</b>
                        <button type="button" class="dueno-link" onclick="event.stopPropagation(); reimprimirVentaReporteDueno(${venta.id})">Reimprimir</button>
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
            ? resultados.map(producto => {
                // El catalogo offline no trae stock_minimo (ver
                // abrirDetalleProductoVentaDueno arriba), asi que aqui
                // se usa el mismo default de 3 que ya es el fallback
                // en estadoStockItemVentaDueno -- mismo criterio,
                // nunca un producto "critico" en Inicio y "normal" en
                // esta lista.
                const stock = Number(producto.stock || 0);
                const estadoStock = stock <= 0 ? "sin" : stock <= 3 ? "bajo" : "ok";
                const claseStock = estadoStock === "sin" ? " stock-texto-sin" : estadoStock === "bajo" ? " stock-texto-bajo" : "";

                return `
                <div class="fila-dueno fila-dueno-producto">
                    <div class="dueno-miniatura" onclick="verDetalleProductoDueno(${producto.id})">
                        ${producto.imagenUrl
                            ? `<img src="${producto.imagenUrl}" alt="" loading="lazy">`
                            : miniaturaVaciaDuenoHtml()}
                    </div>
                    <div onclick="verDetalleProductoDueno(${producto.id})">
                        <strong>${escaparDueno(producto.nombre)}</strong>
                        <span>${escaparDueno(producto.codigo || "Sin codigo")} · <span class="stock-texto${claseStock}">Stock ${producto.stock}</span> · ${dinero(producto.precio)}</span>
                    </div>
                </div>
            `;
            }).join("")
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

        actualizarBadgePedidosDueno();
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
let duenoVentaDescuento = { tipo: "ninguno", valor: 0 };
let duenoVentaDescuentoPanelAbierto = false;
let duenoVentaClienteSeleccionado = null;
let duenoVentaClientesCredito = [];
let duenoVentaClienteModoCrear = false;
let duenoVentaMixto = { efectivo: 0, tarjeta: 0 };

// Misma llave mientras dure un intento de cobro -- si "Confirmar cobro"
// falla y el dueño le da "Volver a intentar" sobre el mismo carrito, la
// segunda peticion manda la misma llave y el servidor puede detectar un
// cobro repetido en vez de registrarlo dos veces. Se limpia al cobrar
// con exito o al vaciar el carrito.
let duenoVentaIdempotencyKey = null;
let duenoVentaCreditoIdempotencyKey = null;

function generarIdempotencyKeyDueno() {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
        return crypto.randomUUID();
    }
    return `dueno-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

// Mismo umbral que server.js (UMBRAL_DESCUENTO_REQUIERE_PIN) -- la
// seguridad real la da el servidor, esto solo evita mandar la peticion
// y esperar el rechazo en el caso comun.
const UMBRAL_DESCUENTO_REQUIERE_PIN_DUENO = 0.20;

function descuentoRequierePinAdminDueno(resumen) {
    if (!resumen.subtotal || resumen.subtotal <= 0) return false;
    return (resumen.descuento / resumen.subtotal) >= UMBRAL_DESCUENTO_REQUIERE_PIN_DUENO;
}

// prompt() nativo a proposito -- /dueno ya usa confirm() nativo en
// varias otras acciones (vaciar carrito, cerrar hoja, etc.), mismo
// criterio de esta app para una interaccion rapida y poco frecuente.
// null si cancela -- el cobro completo se cancela con el.
function pedirPinAdministradorParaDescuentoDueno(porcentaje) {
    const pin = prompt(`Este descuento (${porcentaje}%) necesita el PIN de un administrador.`);
    return pin && pin.trim() ? pin.trim() : null;
}

// limite_credito = 0 en el cliente significa "sin limite configurado" --
// mismo criterio que el servidor. saldo/limite_credito vienen de /creditos,
// que ya se carga al abrir el selector de cliente.
function limiteCreditoSeExcederiaDueno(cliente, montoCargo) {
    const limite = Number(cliente?.limite_credito || 0);
    if (limite <= 0) return false;
    return (Number(cliente?.saldo || 0) + montoCargo) > limite;
}

function pedirPinAdministradorParaLimiteCreditoDueno(cliente, montoCargo) {
    const nuevoSaldo = Number(cliente?.saldo || 0) + montoCargo;
    const pin = prompt(`Este cargo deja a ${cliente?.nombre || "el cliente"} en $${nuevoSaldo.toFixed(2)}, por encima de su limite de $${Number(cliente?.limite_credito || 0).toFixed(2)}. Necesita el PIN de un administrador.`);
    return pin && pin.trim() ? pin.trim() : null;
}

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
                    : miniaturaVaciaDuenoHtml()}
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
            : texto.trim()
                ? `<div class="vacio">Sin resultados en tu catalogo guardado.</div>`
                : `<div class="vacio">Escribe el nombre o código, o usa el escáner, la cámara o "artículo rápido" de arriba.</div>`;
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
            modoVenta: "bolsa",
            imagenUrl: producto.imagenUrl || null
        });
    }

    renderCarritoVenderDueno();
}

// ---- Escanear codigo de barras con la camara (Vender) ----
// Reusa el mismo lector vendorizado localmente (ZXing) y el mismo
// patron de video en vivo que ya usa la verificacion de pedidos
// (duenoPedIniciarEscaneo/duenoPedCargarZxing, mas arriba) -- no se
// reinventa nada, solo se apunta a otro <video> y a otro callback.
// duenoPedCargarZxing() es generica (solo carga window.ZXingBrowser),
// se reusa tal cual.

let duenoVenderControlesEscaneo = null;

function duenoVenderDetenerEscaneo() {
    if (duenoVenderControlesEscaneo) {
        try { duenoVenderControlesEscaneo.stop(); } catch (error) { /* nada que hacer */ }
        duenoVenderControlesEscaneo = null;
    }
}

async function abrirEscanerVenderDueno() {
    document.getElementById("duenoVenderEscanerOverlay").classList.add("abierta");
    document.getElementById("duenoVenderEscaneoCarrito").innerHTML = "";

    const ambiguoPrevio = document.getElementById("duenoVenderEscaneoAmbiguo");
    if (ambiguoPrevio) {
        ambiguoPrevio.style.display = "none";
        ambiguoPrevio.innerHTML = "";
    }

    document.getElementById("duenoVenderEscaneoManualForm").onsubmit = evento => {
        evento.preventDefault();
        const input = document.getElementById("duenoVenderEscaneoManualInput");
        const codigo = input.value.trim();
        if (!codigo) return;
        duenoVenderIntentarAgregarPorCodigo(codigo);
        input.value = "";
        input.focus();
    };

    const estado = document.getElementById("duenoVenderEscaneoEstado");
    estado.textContent = "Cargando lector...";

    try {
        await duenoPedCargarZxing();
    } catch (error) {
        estado.textContent = "No se pudo cargar el lector de codigos. Escribe el codigo a mano.";
        return;
    }

    estado.textContent = "Abriendo camara...";

    try {
        const video = document.getElementById("duenoVenderEscaneoVideo");
        const lector = new window.ZXingBrowser.BrowserMultiFormatReader();

        duenoVenderControlesEscaneo = await lector.decodeFromVideoDevice(undefined, video, (resultado) => {
            if (!resultado) return;
            duenoVenderIntentarAgregarPorCodigo(resultado.getText());
        });

        estado.textContent = "Apunta la camara al codigo de barras.";
    } catch (error) {
        estado.textContent = "No se pudo abrir la camara. Revisa los permisos del navegador, o escribe el codigo a mano.";
    }
}

function cerrarEscanerVenderDueno() {
    duenoVenderDetenerEscaneo();
    document.getElementById("duenoVenderEscanerOverlay").classList.remove("abierta");
}

// Cada escaneo dispara varios frames seguidos con el mismo resultado
// mientras la camara sigue apuntando al mismo codigo -- sin este
// enfriamiento, un solo producto fisico se agregaria decenas de veces
// al carrito antes de que el usuario alcance a retirar la camara.
let duenoVenderUltimoCodigoEscaneado = null;
let duenoVenderUltimoTiempoEscaneado = 0;

async function duenoVenderIntentarAgregarPorCodigo(codigo) {
    const codigoLimpio = String(codigo || "").trim();
    if (!codigoLimpio) return;

    const ahora = Date.now();
    if (codigoLimpio === duenoVenderUltimoCodigoEscaneado && ahora - duenoVenderUltimoTiempoEscaneado < 2500) return;
    duenoVenderUltimoCodigoEscaneado = codigoLimpio;
    duenoVenderUltimoTiempoEscaneado = ahora;

    const estado =
    document.getElementById("duenoVenderEscaneoEstado");

    const resultados =
    await buscarEnCatalogoLocal(codigoLimpio);

    const coincidencias =
    resultados.filter(p => p.codigo === codigoLimpio);

    if (coincidencias.length === 0) {
        if (estado) estado.textContent = `Sin coincidencia para "${codigoLimpio}". Sigue apuntando o escribe el nombre en Vender.`;
        return;
    }

    // Mismo codigo en varios productos: se muestran para elegir en vez de
    // agregar el primero. En el inventario real hay codigos compartidos
    // con precios muy distintos, y meter uno al azar es cobrar mal en
    // silencio -- el cajero ni se entera de que habia otro.
    const ambiguo =
    document.getElementById("duenoVenderEscaneoAmbiguo");

    if (coincidencias.length > 1) {
        duenoVentaUltimosResultados = coincidencias;
        if (ambiguo) {
            ambiguo.style.display = "";
            ambiguo.innerHTML = coincidencias.map(filaProductoVenderDuenoHtml).join("");
        }
        if (estado) {
            estado.textContent =
            `${coincidencias.length} productos tienen el codigo ${codigoLimpio}. Toca el que estas vendiendo.`;
        }
        // El anti-rebote guarda el ultimo codigo leido, asi que la camara
        // no vuelve a disparar sobre el mismo mientras se elige.
        return;
    }

    if (ambiguo) {
        ambiguo.style.display = "none";
        ambiguo.innerHTML = "";
    }

    const producto = coincidencias[0];

    duenoVentaUltimosResultados = resultados;
    agregarAlCarritoVenderDueno(producto.id);

    if (estado) estado.textContent = `"${producto.nombre}" agregado. Sigue escaneando o cierra para cobrar.`;

    document.getElementById("duenoVenderEscaneoCarrito").innerHTML =
    duenoVentaCarrito.map(item => `
        <div class="fila-dueno">
            <div>
                <strong>${escaparDueno(item.nombre)}</strong>
                <span>${escaparDueno(item.codigo || "")} · ${dinero(item.precio)} c/u</span>
            </div>
            <div class="dueno-cantidad-control">
                <span>x${item.cantidad}</span>
            </div>
        </div>
    `).join("");
}

// "Articulo rapido": para algo que no tiene ni codigo interno ni de
// barras y no vale la pena dar de alta como producto solo para
// venderlo una vez -- mismo patron ya probado en el POS de escritorio
// (agregarArticuloRapido, pos-sales.js / pedirArticuloRapidoPOS,
// pos-quick-item-modal.js), portado aqui porque en /dueno no existia
// ninguna forma de cobrar algo sin codigo. Se abre con un boton
// siempre visible junto al buscador (no hace falta buscar nada
// primero, a diferencia del boton "sin resultados" de escritorio) --
// el dueño pidio explicitamente que se pudiera abrir directo.
let contadorArticuloRapidoDueno = 0;

function abrirArticuloRapidoDueno() {
    document.getElementById("duenoArticuloRapidoNombre").value = "";
    document.getElementById("duenoArticuloRapidoPrecio").value = "";
    document.getElementById("duenoArticuloRapidoCantidad").value = "1";
    document.getElementById("duenoArticuloRapidoError").style.display = "none";
    document.getElementById("duenoArticuloRapidoOverlay").style.display = "flex";
    setTimeout(() => document.getElementById("duenoArticuloRapidoNombre")?.focus(), 80);
}

function cerrarArticuloRapidoDueno() {
    document.getElementById("duenoArticuloRapidoOverlay").style.display = "none";
}

function confirmarArticuloRapidoDueno() {
    const nombre = document.getElementById("duenoArticuloRapidoNombre")?.value.trim() || "";
    const precio = Number(document.getElementById("duenoArticuloRapidoPrecio")?.value || 0);
    const cantidad = Number(document.getElementById("duenoArticuloRapidoCantidad")?.value || 0);
    const cajaError = document.getElementById("duenoArticuloRapidoError");

    cajaError.style.display = "none";

    if (!nombre) {
        cajaError.textContent = "Escribe que es lo que estas vendiendo.";
        cajaError.style.display = "block";
        document.getElementById("duenoArticuloRapidoNombre")?.focus();
        return;
    }

    if (!Number.isFinite(precio) || precio <= 0) {
        cajaError.textContent = "Escribe un precio valido.";
        cajaError.style.display = "block";
        document.getElementById("duenoArticuloRapidoPrecio")?.focus();
        return;
    }

    if (!Number.isFinite(cantidad) || cantidad <= 0) {
        cajaError.textContent = "Escribe una cantidad valida.";
        cajaError.style.display = "block";
        document.getElementById("duenoArticuloRapidoCantidad")?.focus();
        return;
    }

    // Id sintetico NEGATIVO -- nunca choca con un id real de producto.
    // descontarStockVentaProducto (server.js) hace UPDATE ... WHERE
    // id = $id, que simplemente no encuentra fila con un id negativo y
    // no descuenta nada -- mismo truco que ya usa el POS de escritorio.
    duenoVentaCarrito.push({
        id: -(++contadorArticuloRapidoDueno),
        codigo: "Sin codigo",
        nombre,
        precio,
        cantidad,
        unidadVenta: "pieza",
        modoVenta: "bolsa"
    });

    renderCarritoVenderDueno();
    cerrarArticuloRapidoDueno();
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

// Misma formula que resumenCarritoPOS (public/js/pos-sales.js) --
// subtotal, descuento (por porcentaje o monto fijo, tope al 100%/al
// subtotal respectivamente) y total, todo redondeado a centavos.
function resumenCarritoVenderDueno() {
    const subtotal =
    duenoVentaCarrito.reduce((acumulado, item) => acumulado + item.precio * item.cantidad, 0);

    const valorDescuento =
    Math.max(0, Number(duenoVentaDescuento.valor || 0));

    const descuentoBruto =
    duenoVentaDescuento.tipo === "porcentaje"
        ? subtotal * Math.min(valorDescuento, 100) / 100
        : duenoVentaDescuento.tipo === "monto"
        ? Math.min(valorDescuento, subtotal)
        : 0;

    const redondear =
    valor => Math.round((Number(valor) + Number.EPSILON) * 100) / 100;

    const subtotalRedondeado = redondear(subtotal);
    const descuento = redondear(descuentoBruto);
    const total = redondear(Math.max(0, subtotalRedondeado - descuento));

    return {
        subtotal: subtotalRedondeado,
        descuento,
        total,
        descuentoTipo: duenoVentaDescuento.tipo,
        descuentoValor: valorDescuento
    };
}

function actualizarDescuentoCarritoVenderDueno(tipo, valor) {
    duenoVentaDescuento = { tipo: tipo || "ninguno", valor: Number(valor || 0) };
    renderCarritoVenderDueno();
}

function quitarDescuentoCarritoVenderDueno() {
    duenoVentaDescuento = { tipo: "ninguno", valor: 0 };
    renderCarritoVenderDueno();
}

function alternarDescuentoCarritoVenderDueno() {
    duenoVentaDescuentoPanelAbierto = !duenoVentaDescuentoPanelAbierto;
    renderCarritoVenderDueno();
}

async function vaciarCarritoVenderDueno() {
    if (!duenoVentaCarrito.length) return;
    if (!confirm("¿Vaciar todos los productos del carrito?")) return;

    duenoVentaCarrito = [];
    duenoVentaDescuento = { tipo: "ninguno", valor: 0 };
    duenoVentaDescuentoPanelAbierto = false;
    duenoVentaClienteSeleccionado = null;
    duenoVentaIdempotencyKey = null;
    duenoVentaCreditoIdempotencyKey = null;

    renderCarritoVenderDueno();
}

function filaCarritoVenderDuenoHtml(item) {
    return `
        <div class="fila-dueno fila-dueno-carrito">
            <div class="fila-dueno-carrito-info">
                <div class="dueno-miniatura">
                    ${item.imagenUrl
                        ? `<img src="${item.imagenUrl}" alt="" loading="lazy">`
                        : miniaturaVaciaDuenoHtml()}
                </div>
                <div class="fila-dueno-carrito-texto">
                    <strong>${escaparDueno(item.nombre)}</strong>
                    <span>Código: ${escaparDueno(item.codigo || "Sin código")} · ${dinero(item.precio)} c/u</span>
                </div>
            </div>
            <div class="fila-dueno-carrito-pie">
                <div class="dueno-cantidad-control">
                    <button type="button" onclick="cambiarCantidadCarritoVenderDueno(${item.id}, -1)">-</button>
                    <span>${item.cantidad}</span>
                    <button type="button" onclick="cambiarCantidadCarritoVenderDueno(${item.id}, 1)">+</button>
                </div>
                <span class="dueno-cantidad-total">${dinero(item.precio * item.cantidad)}</span>
            </div>
        </div>
    `;
}

function renderResumenVenderDueno() {
    const contenedor =
    document.getElementById("duenoVenderResumen");

    if (!contenedor) return;

    // El input de monto pierde el foco en cada rerender (se reconstruye
    // desde cero via innerHTML) -- se captura y restaura el cursor igual
    // que en el descuento de escritorio (pos-sales.js, commit b4b1192).
    // type="text" a proposito: type="number" no expone
    // selectionStart/setSelectionRange en Chrome, ese fue justo el bug.
    const inputEnfocado =
    document.activeElement?.id === "duenoVenderDescuentoValor";

    const cursor =
    inputEnfocado ? document.activeElement.selectionStart : null;

    const resumen =
    resumenCarritoVenderDueno();

    contenedor.innerHTML = `
        <div class="dueno-resumen-linea">
            <span>Subtotal</span>
            <strong>${dinero(resumen.subtotal)}</strong>
        </div>
        <div class="dueno-resumen-linea">
            <span>Descuento</span>
            ${duenoVentaDescuentoPanelAbierto || resumen.descuento > 0
                ? `<strong>-${dinero(resumen.descuento)}</strong>`
                : `<button type="button" class="dueno-resumen-descuento-link" onclick="alternarDescuentoCarritoVenderDueno()">+ Agregar</button>`}
        </div>
        ${duenoVentaDescuentoPanelAbierto ? `
            <div class="dueno-resumen-descuento-panel">
                <label class="dueno-campo">Tipo
                    <select onchange="actualizarDescuentoCarritoVenderDueno(this.value, document.getElementById('duenoVenderDescuentoValor')?.value || 0)">
                        <option value="ninguno" ${resumen.descuentoTipo === "ninguno" ? "selected" : ""}>Sin descuento</option>
                        <option value="porcentaje" ${resumen.descuentoTipo === "porcentaje" ? "selected" : ""}>Porcentaje</option>
                        <option value="monto" ${resumen.descuentoTipo === "monto" ? "selected" : ""}>Monto</option>
                    </select>
                </label>
                <label class="dueno-campo">Cantidad
                    <input
                        id="duenoVenderDescuentoValor"
                        type="text"
                        inputmode="decimal"
                        value="${resumen.descuentoValor || ""}"
                        placeholder="0"
                        oninput="if(/[^0-9.]/.test(this.value)){const p=this.selectionStart;this.value=this.value.replace(/[^0-9.]/g,'');this.setSelectionRange(p-1,p-1);} actualizarDescuentoCarritoVenderDueno(document.querySelector('.dueno-resumen-descuento-panel select')?.value || 'ninguno', this.value)"
                    >
                </label>
            </div>
        ` : ""}
        <div class="dueno-resumen-linea dueno-resumen-linea-total">
            <span>Total</span>
            <strong>${dinero(resumen.total)}</strong>
        </div>
    `;

    if (inputEnfocado) {
        const nuevoInput =
        document.getElementById("duenoVenderDescuentoValor");

        if (nuevoInput) {
            nuevoInput.focus();
            if (cursor !== null) nuevoInput.setSelectionRange(cursor, cursor);
        }
    }
}

function renderCarritoVenderDueno() {
    const card =
    document.getElementById("duenoVenderCarritoCard");

    if (!duenoVentaCarrito.length) {
        card.style.display = "none";
        return;
    }

    card.style.display = "block";

    const resumen =
    resumenCarritoVenderDueno();

    document.getElementById("duenoVenderTotal").textContent =
    dinero(resumen.total);

    document.getElementById("duenoVenderCantidadEtiqueta").textContent =
    `Venta actual · ${duenoVentaCarrito.length} producto${duenoVentaCarrito.length === 1 ? "" : "s"}`;

    document.getElementById("duenoVenderClienteEtiqueta").textContent =
    duenoVentaClienteSeleccionado?.nombre || "Público general";

    document.getElementById("duenoVenderCarritoLista").innerHTML =
    duenoVentaCarrito.map(filaCarritoVenderDuenoHtml).join("");

    renderResumenVenderDueno();
}

// ---- Selector de cliente de credito (para vender a credito o solo
// para dejar registrada la venta a nombre de alguien) -- mismo
// endpoint que ya usa Creditos en escritorio (GET /creditos, POST
// /creditos/clientes), adaptado a la subpantalla de /dueno en vez del
// modal de escritorio (abrirSelectorClientePOS, pos-sales.js).

async function abrirSelectorClienteVenderDueno() {
    duenoVentaClienteModoCrear = false;

    document.getElementById("duenoVenderClienteOverlay").classList.add("abierta");
    document.getElementById("duenoVenderClienteContenido").innerHTML =
    `<p class="dueno-estado">Cargando clientes...</p>`;

    try {
        const datos = await fetchAutenticado("/creditos");
        duenoVentaClientesCredito = datos.clientes || [];
    } catch (error) {
        // Se sigue con lo que ya hubiera en cache de una apertura previa.
    }

    renderSelectorClienteVenderDueno("");
}

function cerrarSelectorClienteVenderDueno() {
    document.getElementById("duenoVenderClienteOverlay").classList.remove("abierta");
}

function filaClienteVenderDuenoHtml(cliente) {
    const disponible =
    Number(cliente.limite_credito || 0) - Number(cliente.saldo || 0);

    return `
        <button type="button" class="fila-dueno" style="width:100%;text-align:left;" onclick="seleccionarClienteVenderDueno(${cliente.id})">
            <div>
                <strong>${escaparDueno(cliente.nombre)}</strong>
                <span>Saldo ${dinero(cliente.saldo)} · Disponible ${dinero(disponible)}</span>
            </div>
        </button>
    `;
}

function renderSelectorClienteVenderDueno(filtro) {
    const contenedor =
    document.getElementById("duenoVenderClienteContenido");

    if (!contenedor) return;

    if (duenoVentaClienteModoCrear) {
        contenedor.innerHTML = `
            <label class="dueno-campo">Nombre
                <input type="text" id="duenoVenderClienteNuevoNombre" placeholder="Nombre del cliente">
            </label>
            <label class="dueno-campo">Teléfono (opcional)
                <input type="tel" id="duenoVenderClienteNuevoTelefono" placeholder="10 dígitos">
            </label>
            <div id="duenoVenderClienteNuevoError" class="vacio" style="display:none;"></div>
            <button type="button" class="dueno-boton-primario" onclick="crearClienteDesdeVenderDueno()">Crear y elegir</button>
            <button type="button" class="dueno-link" onclick="duenoVentaClienteModoCrear = false; renderSelectorClienteVenderDueno('')">Cancelar</button>
        `;
        return;
    }

    const filtroNormalizado =
    (filtro || "").trim().toLowerCase();

    const clientesFiltrados =
    filtroNormalizado
        ? duenoVentaClientesCredito.filter(c => String(c.nombre || "").toLowerCase().includes(filtroNormalizado))
        : duenoVentaClientesCredito;

    contenedor.innerHTML = `
        <input type="search" class="dueno-buscar-fila" style="display:block;width:100%;padding:11px 13px;border:1px solid var(--line);border-radius:12px;background:var(--surface-soft);color:var(--text);margin-bottom:10px;" placeholder="Buscar cliente..." value="${escaparDueno(filtro || "")}" oninput="renderSelectorClienteVenderDueno(this.value)">
        <button type="button" class="fila-dueno" style="width:100%;text-align:left;margin-bottom:8px;" onclick="seleccionarClienteVenderDueno(null)">
            <div><strong>Público general</strong><span>Sin cliente asociado</span></div>
        </button>
        <button type="button" class="dueno-link" style="display:block;margin-bottom:10px;" onclick="duenoVentaClienteModoCrear = true; renderSelectorClienteVenderDueno('')">+ Crear cliente nuevo</button>
        <div class="lista-compacta">
            ${clientesFiltrados.length
                ? clientesFiltrados.map(filaClienteVenderDuenoHtml).join("")
                : `<div class="vacio">${duenoVentaClientesCredito.length ? "Sin resultados." : "Todavía no tienes clientes de crédito."}</div>`}
        </div>
    `;
}

function seleccionarClienteVenderDueno(id) {
    duenoVentaClienteSeleccionado =
    id ? duenoVentaClientesCredito.find(c => Number(c.id) === Number(id)) || null : null;

    cerrarSelectorClienteVenderDueno();
    renderCarritoVenderDueno();

    if (duenoVentaMetodoPago === "credito") {
        elegirMetodoPagoVenderDueno("credito");
    }
}

async function crearClienteDesdeVenderDueno() {
    const nombre =
    document.getElementById("duenoVenderClienteNuevoNombre")?.value.trim() || "";

    const telefono =
    document.getElementById("duenoVenderClienteNuevoTelefono")?.value.trim() || "";

    const error =
    document.getElementById("duenoVenderClienteNuevoError");

    if (!nombre) {
        error.textContent = "Escribe el nombre del cliente.";
        error.style.display = "block";
        return;
    }

    error.style.display = "none";

    try {
        const respuesta = await fetchAutenticado("/creditos/clientes", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ nombre, telefono: telefono || null })
        });

        duenoVentaClientesCredito.push(respuesta.cliente);
        duenoVentaClienteModoCrear = false;
        seleccionarClienteVenderDueno(respuesta.cliente.id);
    } catch (err) {
        error.textContent = err.message || "No se pudo crear el cliente.";
        error.style.display = "block";
    }
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

// 5 metodos -- sin Codigo/QR (no hay backend real de cobro por QR
// todavia) ni Cargo extra (funcion de negocio nueva, fuera de
// alcance). Iconos estilo Feather, mismo trazo que el resto de /dueno.
const METODOS_PAGO_VENDER_DUENO = [
    {
        id: "efectivo",
        etiqueta: "Efectivo",
        icono: `<line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>`
    },
    {
        id: "tarjeta",
        etiqueta: "Tarjeta",
        icono: `<rect x="1" y="4" width="22" height="16" rx="2" ry="2"/><line x1="1" y1="10" x2="23" y2="10"/>`
    },
    {
        id: "transferencia",
        etiqueta: "Transferencia",
        icono: `<polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/>`
    },
    {
        id: "mixto",
        etiqueta: "Mixto",
        sub: "Efectivo + tarjeta",
        icono: `<polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/>`
    },
    {
        id: "credito",
        etiqueta: "Crédito",
        sub: "Ticket a crédito",
        icono: `<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/>`
    }
];

function metodoPagoBotonVenderDuenoHtml(metodo) {
    const seleccionado =
    metodo.id === duenoVentaMetodoPago;

    return `
        <button type="button" class="dueno-metodo-pago-boton ${seleccionado ? "seleccionado" : ""}" onclick="elegirMetodoPagoVenderDueno('${metodo.id}')">
            ${seleccionado ? `<span class="dueno-metodo-pago-check">✓</span>` : ""}
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${metodo.icono}</svg>
            <span>${metodo.etiqueta}</span>
            ${metodo.sub ? `<span class="sub">${metodo.sub}</span>` : ""}
        </button>
    `;
}

function renderMetodoPagoVenderDueno() {
    duenoVentaMetodoPago = null;
    renderCobroVenderDueno();
}

function elegirMetodoPagoVenderDueno(metodo) {
    duenoVentaMetodoPago = metodo;

    if (metodo === "mixto") {
        duenoVentaMixto = { efectivo: 0, tarjeta: 0 };
    }

    renderCobroVenderDueno();
}

function renderCobroVenderDueno() {
    const contenido =
    document.getElementById("duenoVenderCobroContenido");

    const resumen =
    resumenCarritoVenderDueno();

    contenido.innerHTML = `
        <div class="dueno-card">
            <div class="dueno-resumen-linea">
                <span>Subtotal (${duenoVentaCarrito.length} producto${duenoVentaCarrito.length === 1 ? "" : "s"})</span>
                <strong>${dinero(resumen.subtotal)}</strong>
            </div>
            <div class="dueno-resumen-linea">
                <span>Descuento</span>
                <strong>-${dinero(resumen.descuento)}</strong>
            </div>
            <div class="dueno-resumen-linea dueno-resumen-linea-total">
                <span>Total a cobrar</span>
                <strong>${dinero(resumen.total)}</strong>
            </div>
        </div>
        <p class="dueno-estado" style="margin-top:14px;">Método de pago</p>
        <div class="dueno-metodo-pago-grid">
            ${METODOS_PAGO_VENDER_DUENO.map(metodoPagoBotonVenderDuenoHtml).join("")}
        </div>
        <div id="duenoVenderMetodoSubpanel"></div>
    `;

    renderSubpanelMetodoPagoVenderDueno();
}

function renderSubpanelMetodoPagoVenderDueno() {
    const subpanel =
    document.getElementById("duenoVenderMetodoSubpanel");

    if (!subpanel || !duenoVentaMetodoPago) return;

    const total =
    resumenCarritoVenderDueno().total;

    if (duenoVentaMetodoPago === "efectivo") {
        const [montoExacto, ...montosArriba] =
        montosRapidosSugeridosVenderDueno(total);

        const botonesMontoRapido = [
            `<button type="button" class="dueno-monto-rapido-boton" onclick="aplicarMontoRapidoVenderDueno(${montoExacto})">${dinero(montoExacto)} exacto</button>`,
            ...montosArriba.map(monto => `<button type="button" class="dueno-monto-rapido-boton" onclick="aplicarMontoRapidoVenderDueno(${monto})">${dinero(monto)}</button>`),
            `<button type="button" class="dueno-monto-rapido-boton" onclick="document.getElementById('duenoVenderRecibido')?.focus()">Personalizado</button>`
        ].join("");

        subpanel.innerHTML = `
            <p class="dueno-estado" style="font-weight:800;">Pago en efectivo</p>
            <label class="dueno-campo">Recibido -- por cobrar ${dinero(total)}
                <input type="text" inputmode="decimal" id="duenoVenderRecibido" placeholder="0.00" oninput="this.value=this.value.replace(/[^0-9.]/g,''); actualizarCambioVenderDueno()">
            </label>
            <div class="dueno-monto-rapido-fila">
                ${botonesMontoRapido}
            </div>
            <p class="dueno-estado" id="duenoVenderCambio">Cambio: ${dinero(0)}</p>
            <div class="dueno-foto-descripcion">El cambio se calculará automáticamente al ingresar el monto recibido.</div>
            <button type="button" class="dueno-boton-primario" id="duenoVenderBotonConfirmarEfectivo" onclick="confirmarCobroVenderDueno()" disabled>Confirmar cobro</button>
        `;
        return;
    }

    if (duenoVentaMetodoPago === "tarjeta" || duenoVentaMetodoPago === "transferencia") {
        subpanel.innerHTML = `
            <button type="button" class="dueno-boton-primario" onclick="confirmarCobroVenderDueno()">Confirmar cobro</button>
        `;
        return;
    }

    if (duenoVentaMetodoPago === "mixto") {
        subpanel.innerHTML = `
            <p class="dueno-estado" style="font-weight:800;">Dividir el pago -- total ${dinero(total)}</p>
            <label class="dueno-campo">Efectivo
                <input type="text" inputmode="decimal" id="duenoVenderMixtoEfectivo" placeholder="0.00" value="${duenoVentaMixto.efectivo || ""}" oninput="this.value=this.value.replace(/[^0-9.]/g,''); actualizarMixtoVenderDueno()">
            </label>
            <label class="dueno-campo">Tarjeta
                <input type="text" inputmode="decimal" id="duenoVenderMixtoTarjeta" placeholder="0.00" value="${duenoVentaMixto.tarjeta || ""}" oninput="this.value=this.value.replace(/[^0-9.]/g,''); actualizarMixtoVenderDueno()">
            </label>
            <p class="dueno-estado" id="duenoVenderMixtoRestante"></p>
            <button type="button" class="dueno-boton-primario" id="duenoVenderBotonConfirmarMixto" onclick="confirmarCobroVenderDueno()" disabled>Confirmar cobro</button>
        `;
        actualizarMixtoVenderDueno();
        return;
    }

    if (duenoVentaMetodoPago === "credito") {
        if (!duenoVentaClienteSeleccionado) {
            subpanel.innerHTML = `
                <div class="vacio">Elige un cliente con crédito para cobrar así.</div>
                <button type="button" class="dueno-boton-primario" onclick="abrirSelectorClienteVenderDueno()">Elegir cliente</button>
            `;
            return;
        }

        const disponible =
        Number(duenoVentaClienteSeleccionado.limite_credito || 0) - Number(duenoVentaClienteSeleccionado.saldo || 0);

        subpanel.innerHTML = `
            <p class="dueno-estado"><strong>${escaparDueno(duenoVentaClienteSeleccionado.nombre)}</strong> -- disponible ${dinero(disponible)}</p>
            <button type="button" class="dueno-boton-primario" onclick="confirmarCobroCreditoVenderDueno()">Confirmar cobro</button>
        `;
        return;
    }
}

// Antes eran botones fijos ($50/$100/$200) sin importar el total --
// inutiles para cualquier venta de mas de $200 (comun en una
// ferreteria: una herramienta sola facil pasa de $1,000). Ahora se
// calculan sobre el total real: el monto exacto, mas los 1-2 billetes
// "redondos" mas cercanos arriba de ese total, usando denominaciones
// distintas segun que tan grande es la venta.
function montosRapidosSugeridosVenderDueno(total) {
    const exacto =
    Math.max(1, Math.ceil(total));

    const denominaciones =
    exacto <= 100 ? [10, 20, 50]
    : exacto <= 500 ? [50, 100, 200]
    : exacto <= 2000 ? [100, 500, 1000]
    : [500, 1000, 2000];

    const montosArriba =
    [...new Set(
        denominaciones
        .map(billete => Math.ceil(exacto / billete) * billete)
        .filter(monto => monto > exacto)
    )]
    .sort((a, b) => a - b)
    .slice(0, 2);

    return [exacto, ...montosArriba];
}

function aplicarMontoRapidoVenderDueno(monto) {
    const input =
    document.getElementById("duenoVenderRecibido");

    if (!input) return;

    input.value = monto;
    actualizarCambioVenderDueno();
}

function actualizarCambioVenderDueno() {
    const total =
    resumenCarritoVenderDueno().total;

    const recibido =
    Number(document.getElementById("duenoVenderRecibido")?.value || 0);

    document.getElementById("duenoVenderCambio").textContent =
    `Cambio: ${dinero(Math.max(recibido - total, 0))}`;

    document.getElementById("duenoVenderBotonConfirmarEfectivo").disabled = recibido < total;
}

function actualizarMixtoVenderDueno() {
    const total =
    resumenCarritoVenderDueno().total;

    duenoVentaMixto = {
        efectivo: Number(document.getElementById("duenoVenderMixtoEfectivo")?.value || 0),
        tarjeta: Number(document.getElementById("duenoVenderMixtoTarjeta")?.value || 0)
    };

    const suma =
    duenoVentaMixto.efectivo + duenoVentaMixto.tarjeta;

    const restante =
    document.getElementById("duenoVenderMixtoRestante");

    if (restante) {
        restante.textContent =
        suma >= total
            ? `Cambio: ${dinero(suma - total)}`
            : `Falta: ${dinero(total - suma)}`;
    }

    const boton =
    document.getElementById("duenoVenderBotonConfirmarMixto");

    if (boton) boton.disabled = suma < total;
}

async function confirmarCobroVenderDueno() {
    if (duenoVentaCobrando) return;
    duenoVentaCobrando = true;

    const resumen =
    resumenCarritoVenderDueno();

    const total = resumen.total;

    let recibido = total;
    let cambio = 0;

    if (duenoVentaMetodoPago === "efectivo") {
        recibido = Number(document.getElementById("duenoVenderRecibido")?.value || 0);
        cambio = Math.max(recibido - total, 0);
    }

    const pagos = { efectivo: 0, tarjeta: 0, transferencia: 0, credito: 0 };

    if (duenoVentaMetodoPago === "mixto") {
        pagos.efectivo = duenoVentaMixto.efectivo;
        pagos.tarjeta = duenoVentaMixto.tarjeta;
        recibido = duenoVentaMixto.efectivo + duenoVentaMixto.tarjeta;
        cambio = Math.max(recibido - total, 0);
    } else {
        pagos[duenoVentaMetodoPago] = total;
    }

    const cuerpo = {
        total,
        subtotal: resumen.subtotal,
        descuento: resumen.descuento,
        descuentoTipo: resumen.descuentoTipo,
        descuentoValor: resumen.descuentoValor,
        clienteId: duenoVentaClienteSeleccionado?.id || null,
        clienteNombre: duenoVentaClienteSeleccionado?.nombre || "Publico general",
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

    if (!duenoVentaIdempotencyKey) {
        duenoVentaIdempotencyKey = generarIdempotencyKeyDueno();
    }

    cuerpo.idempotencyKey = duenoVentaIdempotencyKey;

    if (descuentoRequierePinAdminDueno(resumen)) {
        const porcentaje = Math.round(resumen.descuento / resumen.subtotal * 100);
        const adminPin = pedirPinAdministradorParaDescuentoDueno(porcentaje);

        if (!adminPin) {
            duenoVentaCobrando = false;
            return;
        }

        cuerpo.adminPin = adminPin;
    }

    const contenido =
    document.getElementById("duenoVenderCobroContenido");

    contenido.innerHTML = `<p class="dueno-estado">Cobrando...</p>`;

    try {
        const respuesta = await fetchAutenticado("/ventas", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(cuerpo)
        });

        duenoVentaIdempotencyKey = null;
        mostrarVentaCobradaVenderDueno(respuesta.folio, total);
    } catch (error) {
        contenido.innerHTML = `
            <div class="vacio">${escaparDueno(error.message || "No se pudo cobrar la venta. Intenta de nuevo.")}</div>
            <button type="button" class="dueno-link" onclick="renderCobroVenderDueno()">Volver a intentar</button>
        `;
    } finally {
        duenoVentaCobrando = false;
    }
}

// Metodo Credito no pasa por /ventas -- POST /creditos/clientes/:id/cargos
// (server.js) es el que ya usa Creditos en escritorio: crea el folio en
// historial_ventas Y el movimiento en movimientos_credito en una sola
// transaccion, y tambien descuenta stock. Guardia extra por si acaso,
// aunque el sub-panel ya no deja llegar aqui sin cliente elegido.
async function confirmarCobroCreditoVenderDueno() {
    if (duenoVentaCobrando) return;
    if (!duenoVentaClienteSeleccionado) return;

    duenoVentaCobrando = true;

    const resumen =
    resumenCarritoVenderDueno();

    const cuerpo = {
        monto: resumen.total,
        subtotal: resumen.subtotal,
        descuento: resumen.descuento,
        descuentoTipo: resumen.descuentoTipo,
        descuentoValor: resumen.descuentoValor,
        concepto: "Venta de mostrador",
        productos: duenoVentaCarrito.map(item => ({
            id: item.id,
            codigo: item.codigo,
            nombre: item.nombre,
            precio: item.precio,
            cantidad: item.cantidad,
            unidadVenta: item.unidadVenta,
            modoVenta: item.modoVenta,
            importe: item.precio * item.cantidad
        }))
    };

    if (!duenoVentaCreditoIdempotencyKey) {
        duenoVentaCreditoIdempotencyKey = generarIdempotencyKeyDueno();
    }

    cuerpo.idempotencyKey = duenoVentaCreditoIdempotencyKey;

    let adminPinCredito = null;

    if (descuentoRequierePinAdminDueno(resumen)) {
        const porcentaje = Math.round(resumen.descuento / resumen.subtotal * 100);
        adminPinCredito = pedirPinAdministradorParaDescuentoDueno(porcentaje);

        if (!adminPinCredito) {
            duenoVentaCobrando = false;
            return;
        }
    }

    if (!adminPinCredito && limiteCreditoSeExcederiaDueno(duenoVentaClienteSeleccionado, resumen.total)) {
        adminPinCredito = pedirPinAdministradorParaLimiteCreditoDueno(duenoVentaClienteSeleccionado, resumen.total);

        if (!adminPinCredito) {
            duenoVentaCobrando = false;
            return;
        }
    }

    if (adminPinCredito) cuerpo.adminPin = adminPinCredito;

    const contenido =
    document.getElementById("duenoVenderCobroContenido");

    contenido.innerHTML = `<p class="dueno-estado">Cobrando...</p>`;

    try {
        const respuesta = await fetchAutenticado(`/creditos/clientes/${duenoVentaClienteSeleccionado.id}/cargos`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(cuerpo)
        });

        duenoVentaCreditoIdempotencyKey = null;
        mostrarVentaCobradaVenderDueno(respuesta.folio, resumen.total);
    } catch (error) {
        contenido.innerHTML = `
            <div class="vacio">${escaparDueno(error.message || "No se pudo registrar la venta a credito. Intenta de nuevo.")}</div>
            <button type="button" class="dueno-link" onclick="renderCobroVenderDueno()">Volver a intentar</button>
        `;
    } finally {
        duenoVentaCobrando = false;
    }
}

function mostrarVentaCobradaVenderDueno(folio, total) {
    document.getElementById("duenoVenderCobroTitulo").textContent = "Venta cobrada";
    document.getElementById("duenoVenderCobroContenido").innerHTML = `
        <div class="dueno-status-card">
            <p class="dueno-estado">Folio</p>
            <h2>${escaparDueno(folio)}</h2>
            <p class="dueno-estado">Total ${dinero(total)}</p>
        </div>
        <button type="button" class="dueno-boton-primario" onclick="finalizarVentaVenderDueno()">Nueva venta</button>
    `;

    duenoVentaCarrito = [];
}

function finalizarVentaVenderDueno() {
    document.getElementById("duenoVenderCobroOverlay").classList.remove("abierta");

    duenoVentaDescuento = { tipo: "ninguno", valor: 0 };
    duenoVentaDescuentoPanelAbierto = false;
    duenoVentaClienteSeleccionado = null;
    duenoVentaMixto = { efectivo: 0, tarjeta: 0 };

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
        grafica: '<path d="M3 3v18h18"/><path d="M7 15l4-5 3 3 5-7"/>',
        caja: '<path d="M21 8l-9-5-9 5 9 5 9-5z"/><path d="M3 8v8l9 5 9-5V8"/><path d="M12 13v8"/>',
        flecha: '<path d="M9 6l6 6-6 6"/>'
    };

    return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${iconos[nombre] || iconos.usuario}</svg>`;
}

// Reportes, Cotizar e Inventario vivian como iconos propios en la
// barra inferior -- con Inicio/Vender/Pedidos/Caja ya eran 7 iconos
// mas "Más", demasiados para acertarle bien con el dedo. Se movieron
// aqui, al menu que abre el boton de tres rayas del encabezado (mismo
// patron que usa Amazon: pocos accesos directos abajo, todo lo demas
// detras de un menu). "Ventas" se renombra a "Cotizar" de paso porque
// "Ventas" chocaba de nombre con la pestaña real "Vender" (cobro de
// verdad) -- dos palabras casi identicas para funciones opuestas.
const CATEGORIAS_MAS_DUENO = [
    { id: "reportes-tab", titulo: "Reportes", desc: "Tu negocio en numeros", icono: "grafica", color: "azul", tab: "reportes" },
    { id: "ventas-tab", titulo: "Cotizar", desc: "Arma una cotizacion sin cobrar", icono: "carrito", color: "azul", tab: "ventas" },
    { id: "inventario-tab", titulo: "Inventario", desc: "Consulta tu catalogo completo", icono: "caja", color: "azul", tab: "inventario" },
    { id: "market", titulo: "Comprar en Nexo Market", desc: "Explora productos de otros negocios Nexo", icono: "carrito", color: "verde", href: "https://app.nexoposoficial.com/market" },
    { id: "cuenta", titulo: "Cuenta", desc: "Datos del negocio y correo", icono: "usuario", color: "" },
    { id: "plan", titulo: "Plan y suscripcion", desc: "Tu plan, pagos y facturas", icono: "tarjeta", color: "verde" },
    { id: "nexo-ia", titulo: "Nexo IA", desc: "Consumo y disponibilidad", icono: "chispa", color: "morado" },
    { id: "seguridad", titulo: "Seguridad", desc: "Contraseña y sesiones", icono: "candado", color: "rojo" },
    { id: "dispositivos", titulo: "Dispositivos", desc: "Cajas vinculadas a tu negocio", icono: "dispositivo", color: "" },
    { id: "ayuda", titulo: "Ayuda", desc: "Contacto y version de la app", icono: "ayuda", color: "gris" },
    { id: "apariencia", titulo: "Apariencia", desc: "Tema claro u oscuro", icono: "pincel", color: "" },
    { id: "notificaciones", titulo: "Notificaciones", desc: "Avisos de ventas, pedidos y credito", icono: "campana", color: "" },
    { id: "respaldos", titulo: "Respaldos", desc: "Proximamente", icono: "nube", color: "gris", proximamente: true }
];

function renderCategoriasMasDueno() {
    document.getElementById("duenoMasCategorias").innerHTML =
        CATEGORIAS_MAS_DUENO.map(categoria => `
            <button type="button" class="dueno-categoria-row${categoria.proximamente ? " proximamente" : ""}"
                onclick="${categoria.tab ? `cambiarTabDueno('${categoria.tab}')` : categoria.href ? `location.href='${categoria.href}'` : (categoria.proximamente ? "proximamenteDueno()" : `abrirSubpantallaMasDueno('${categoria.id}')`)}">
                <span class="dueno-categoria-icono${categoria.color ? ` dueno-categoria-icono-${categoria.color}` : ""}">${iconoCategoriaMasDueno(categoria.icono)}</span>
                <span class="dueno-categoria-texto">
                    <strong>${escaparDueno(categoria.titulo)}</strong>
                    <span>${escaparDueno(categoria.desc)}</span>
                </span>
                ${categoria.id === "ventas-tab" ? `<span id="duenoVentasBadge" class="dueno-tab-badge" style="display:none;"></span>` : ""}
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
    apariencia: renderSubpantallaApariencia,
    notificaciones: renderSubpantallaNotificaciones
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

// Notificaciones push -- mismo patron ya probado en el POS de
// escritorio (pmkActivarNotificacionesPush, pedidos-market-view.js),
// portado aqui porque la pantalla "Notificaciones" de Mas era un
// "Proximamente" inerte y dueno-sw.js no tenia como mostrarlas de
// todas formas (ver el push/notificationclick agregado ahi). A
// diferencia de escritorio (boton de un solo sentido), aqui si se
// puede desactivar -- ya existe /negocio-actual/push/desuscribir.
function duenoBase64UrlAUint8Array(base64Url) {
    const relleno = "=".repeat((4 - base64Url.length % 4) % 4);
    const base64 = (base64Url + relleno).replace(/-/g, "+").replace(/_/g, "/");
    const bruto = atob(base64);
    const salida = new Uint8Array(bruto.length);
    for (let i = 0; i < bruto.length; i++) salida[i] = bruto.charCodeAt(i);
    return salida;
}

function notificacionesPushDuenoActivas() {
    return typeof Notification !== "undefined" &&
        Notification.permission === "granted" &&
        localStorage.getItem("nexoDuenoPushActivado") === "1";
}

async function activarNotificacionesPushDueno() {
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
        alert("Este navegador no soporta notificaciones push. En iPhone, agrega esta app a tu pantalla de inicio desde Safari primero.");
        return;
    }

    try {
        const permiso = await Notification.requestPermission();
        if (permiso !== "granted") {
            alert("No se activaron las notificaciones -- el permiso fue denegado.");
            return;
        }

        const respuestaClave = await fetch("/push/vapid-public-key").then(r => r.json());
        if (!respuestaClave.ok) {
            alert("Las notificaciones push no estan configuradas en el servidor todavia.");
            return;
        }

        const registro = await navigator.serviceWorker.register("/dueno-sw.js", { scope: "/dueno" });
        const suscripcion = await registro.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: duenoBase64UrlAUint8Array(respuestaClave.publicKey)
        });

        await fetchAutenticado("/negocio-actual/push/suscribir", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(suscripcion.toJSON())
        });

        localStorage.setItem("nexoDuenoPushActivado", "1");
        mostrarToastDueno("Notificaciones activadas");
    } catch (error) {
        console.warn("No se pudo activar notificaciones push:", error);
        alert("No se pudieron activar las notificaciones push en este telefono.");
    } finally {
        if (duenoMasCategoriaActiva === "notificaciones") renderSubpantallaNotificaciones();
    }
}

async function desactivarNotificacionesPushDueno() {
    try {
        const registro = await navigator.serviceWorker.getRegistration("/dueno");
        const suscripcion = await registro?.pushManager.getSubscription();

        if (suscripcion) {
            await fetchAutenticado("/negocio-actual/push/desuscribir", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ endpoint: suscripcion.endpoint })
            });
            await suscripcion.unsubscribe();
        }
    } catch (error) {
        console.warn("No se pudo desactivar notificaciones push:", error);
    } finally {
        localStorage.removeItem("nexoDuenoPushActivado");
        mostrarToastDueno("Notificaciones desactivadas");
        if (duenoMasCategoriaActiva === "notificaciones") renderSubpantallaNotificaciones();
    }
}

// Si ya se habia dado permiso antes (misma sesion del navegador, otro
// dia), vuelve a registrar la suscripcion en silencio al entrar a la
// app -- sin pedir el permiso otra vez. Mismo criterio que
// pmkResuscribirPushSiYaHabiaPermiso en el POS de escritorio.
async function resuscribirPushDuenoSiYaHabiaPermiso() {
    if (typeof Notification === "undefined" || Notification.permission !== "granted") return;
    if (localStorage.getItem("nexoDuenoPushActivado") !== "1") return;
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) return;

    try {
        const registro = await navigator.serviceWorker.register("/dueno-sw.js", { scope: "/dueno" });
        const suscripcionExistente = await registro.pushManager.getSubscription();
        if (suscripcionExistente) {
            await fetchAutenticado("/negocio-actual/push/suscribir", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(suscripcionExistente.toJSON())
            });
        }
    } catch (error) {
        // Silencioso -- no interrumpir el arranque de la app por esto.
    }
}

// Lo que dispara cada tipo de aviso -- mismo orden en el que
// server.js/public-site-server.js los manda, para que esta lista nunca
// prometa algo que el backend no cubre todavia.
const NOTIF_DUENO_TIPOS = [
    { icono: "carrito", color: "", titulo: "Cada venta", desc: "Folio y monto al cerrar el cobro" },
    { icono: "tarjeta", color: "verde", titulo: "Movimientos de credito", desc: "Cargos y abonos de tus clientes" },
    { icono: "caja", color: "morado", titulo: "Pedidos de Nexo Market", desc: "Cuando alguien compra en tu tienda" }
];

function renderSubpantallaNotificaciones() {
    const activo = notificacionesPushDuenoActivas();
    const soportado = "serviceWorker" in navigator && "PushManager" in window;

    document.getElementById("duenoMasSubpantallaContenido").innerHTML = `
        <div class="dueno-notif-header">
            <span class="dueno-notif-header-icono">${iconoCategoriaMasDueno("campana")}</span>
            <div>
                <h2>Avisos en este telefono</h2>
                <p>Al tocar un aviso te llevamos directo a la pantalla con la informacion.</p>
            </div>
        </div>
        <article class="dueno-card">
            ${soportado
                ? `<div class="dueno-toggle-fila" onclick="${activo ? "desactivarNotificacionesPushDueno" : "activarNotificacionesPushDueno"}()">
                    <div>
                        <strong>Notificaciones push</strong>
                        <span>${activo ? "Activadas en este telefono" : "Toca para activarlas"}</span>
                    </div>
                    <span class="dueno-toggle-switch${activo ? " activo" : ""}"></span>
                </div>`
                : `<p class="dueno-login-error">Este navegador no soporta notificaciones push. En iPhone, primero agrega esta app a tu pantalla de inicio desde Safari (compartir → "Agregar a inicio").</p>`
            }
        </article>
        <article class="dueno-card dueno-card-notif-lista">
            <div class="card-head">
                <div>
                    <span>Te avisamos cuando</span>
                    <h2>Pasa esto</h2>
                </div>
            </div>
            <div class="dueno-lista-info">
                ${NOTIF_DUENO_TIPOS.map(tipo => `
                    <div class="dueno-info-fila">
                        <span class="dueno-categoria-icono${tipo.color ? ` dueno-categoria-icono-${tipo.color}` : ""}">${iconoCategoriaMasDueno(tipo.icono)}</span>
                        <span class="dueno-info-fila-texto">
                            <strong>${tipo.titulo}</strong>
                            <span>${tipo.desc}</span>
                        </span>
                    </div>
                `).join("")}
            </div>
        </article>
    `;
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

    // La sesion de negocio (dueño/empleado, arriba) y la sesion de
    // persona Nexo (cookie de dominio, usada por Nexo Market) son dos
    // cosas separadas -- cerrar solo la primera dejaba la cuenta de
    // persona viva, asi que "Ya tengo cuenta" en Market volvia a entrar
    // solo, sin pedir nada, aunque ya se hubiera cerrado sesion aqui.
    // Se manda tambien por si esta cookie sigue viva; si no hay sesion
    // de persona el 401 se ignora, no bloquea el cierre de sesion normal.
    fetch("/personas/logout", { method: "POST" }).catch(() => {});

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
        renderSugerenciasNexoDueno();
    }

    document.getElementById("duenoNexoInput")?.focus();
}

// Mismas 3 preguntas que ya usa el chat de escritorio
// (PREGUNTAS_RAPIDAS_NEXO_IA en nexo-ia.js) -- un usuario nuevo que
// abre el chat por primera vez no tiene ninguna pista de que preguntar;
// solo se muestran antes del primer mensaje real de la conversacion.
const DUENO_NEXO_PREGUNTAS_SUGERIDAS = [
    "Como van mis ventas?",
    "Que productos se estan agotando?",
    "Tengo creditos vencidos?"
];

function renderSugerenciasNexoDueno() {
    const lista =
    document.getElementById("duenoNexoMensajes");

    if (!lista) return;

    const contenedor =
    document.createElement("div");

    contenedor.className = "dueno-nexo-sugerencias";
    contenedor.innerHTML = DUENO_NEXO_PREGUNTAS_SUGERIDAS.map(
        (pregunta, indice) => `<button type="button" data-sugerencia="${indice}">${pregunta}</button>`
    ).join("");

    contenedor.querySelectorAll("[data-sugerencia]").forEach(boton => {
        boton.addEventListener("click", () => {
            const input = document.getElementById("duenoNexoInput");
            if (input) input.value = DUENO_NEXO_PREGUNTAS_SUGERIDAS[Number(boton.dataset.sugerencia)];
            enviarMensajeNexoDueno();
        });
    });

    lista.appendChild(contenedor);
    lista.scrollTop = lista.scrollHeight;
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
    document.querySelector(".dueno-nexo-sugerencias")?.remove();
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
    // scope explicito a /dueno -- sin esto el registro por defecto toma
    // como scope la raiz del origen (el script vive en /dueno-sw.js),
    // lo que le da control sobre el POS de escritorio (/) tambien: un
    // dueno que abre /dueno una sola vez en el mismo navegador donde
    // usa el POS de escritorio terminaba con datos viejos cacheados
    // sirviendose ahi. Bug real encontrado al preparar capturas para
    // el manual.
    navigator.serviceWorker.register("/dueno-sw.js", { scope: "/dueno" }).catch(() => {
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

// Al tocar una notificacion push, dueno-sw.js abre (o reusa, ver su
// "navigate") esta pagina con ?ir=<tab> -- aqui es donde se traduce
// eso en cambiar a la pestaña real. Mismo motivo por el que
// recibirTokenDesdeMarket limpia el query string despues de leerlo:
// que un refresh manual no lo vuelva a disparar.
const TABS_VALIDAS_DEEP_LINK_DUENO = new Set(["inicio", "reportes", "ventas", "inventario", "pedidos", "vender", "caja", "mas"]);

function aplicarDeepLinkDueno() {
    const parametros = new URLSearchParams(window.location.search);
    const ir = parametros.get("ir");
    if (!ir) return;

    const ventaId = parametros.get("ventaId");

    parametros.delete("ir");
    parametros.delete("ventaId");
    const query = parametros.toString();
    window.history.replaceState({}, "", window.location.pathname + (query ? `?${query}` : ""));

    if (ir === "venta" && ventaId) {
        cambiarTabDueno("inicio");
        abrirDetalleVentaDueno(ventaId);
        return;
    }

    if (TABS_VALIDAS_DEEP_LINK_DUENO.has(ir)) cambiarTabDueno(ir);
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
        aplicarDeepLinkDueno();
        setInterval(() => { if (duenoRolSesion !== "employee") cargarPanelDueno(); }, 60000);
        setInterval(actualizarNexoBurbujaDueno, 60000);
    } else {
        mostrarBienvenidaDueno();
    }
});
