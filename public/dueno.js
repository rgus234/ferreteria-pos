const DUENO_TOKEN_KEY = "nexoCuentaSesionToken";

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

function tokenGuardado() {
    return localStorage.getItem(DUENO_TOKEN_KEY);
}

function mostrarLoginDueno() {
    document.getElementById("duenoApp").style.display = "none";
    document.getElementById("duenoTabs").style.display = "none";
    document.getElementById("duenoLogin").style.display = "flex";
}

function mostrarAppDueno() {
    document.getElementById("duenoLogin").style.display = "none";
    document.getElementById("duenoApp").style.display = "block";
    document.getElementById("duenoTabs").style.display = "flex";
}

async function fetchAutenticado(url) {
    const token = tokenGuardado();

    const respuesta =
    await fetch(url, {
        headers: { Authorization: `Bearer ${token}` }
    });

    if (respuesta.status === 401) {
        localStorage.removeItem(DUENO_TOKEN_KEY);
        mostrarLoginDueno();
        throw new Error("Sesion expirada");
    }

    if (!respuesta.ok) {
        throw new Error(`No se pudo cargar ${url}`);
    }

    return respuesta.json();
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

function proximamenteDueno() {
    const toast =
    document.getElementById("duenoToast");

    toast.textContent = "Esta seccion llega en una proxima actualizacion.";
    toast.style.display = "block";

    clearTimeout(window.__duenoToastTimer);

    window.__duenoToastTimer =
    setTimeout(() => { toast.style.display = "none"; }, 2200);
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
                        <strong>${producto.nombre}</strong>
                        <span>${producto.codigo || "Sin codigo"} · Stock ${producto.stock}</span>
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
