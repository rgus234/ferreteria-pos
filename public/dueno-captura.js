/* Capturar códigos (privado y temporal): escanea un producto con la cámara, escribe su nombre, guarda y sigue.
   Solo aparece (en "Más") para la cuenta autorizada; el servidor lo revisa de nuevo (captura-codigos-server.js).
   No toca productos, ventas, existencias ni precios. El código se guarda y se muestra como texto (ceros iniciales). */

let capturaControles = null;
let capturaCodigoActual = null;
let capturaDuplicado = null;
let capturaUltimo = { codigo: null, t: 0 };
let capturaTotal = 0;

function capEscapar(valor) {
    return String(valor ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

async function capLlamar(ruta, opciones = {}) {
    const respuesta = await fetchAutenticado(ruta, { ...opciones, headers: { "Content-Type": "application/json", ...(opciones.headers || {}) } });
    const datos = await respuesta.json().catch(() => ({}));
    return { ok: respuesta.ok, estado: respuesta.status, datos };
}

// ---------------------------------------------------------------------
// Entrada en "Más": solo si el servidor dice que esta cuenta puede usarla
// ---------------------------------------------------------------------

async function capturaInsertarEntrada() {
    if (document.getElementById("capturaEntrada")) return;

    let permitido = false;

    try {
        const { ok, datos } = await capLlamar("/captura-codigos/acceso");
        permitido = ok && datos.permitido === true;
    } catch (error) {
        permitido = false;
    }

    const destino = document.getElementById("duenoMasStatusCard");
    if (!permitido || !destino || document.getElementById("capturaEntrada")) return;

    const boton = document.createElement("button");
    boton.type = "button";
    boton.id = "capturaEntrada";
    boton.className = "captura-entrada";
    boton.innerHTML = `<span aria-hidden="true">▦</span><b>Capturar códigos</b><small>Escanea y nombra productos para el catálogo maestro</small>`;
    boton.addEventListener("click", abrirCapturaCodigos);
    destino.insertAdjacentElement("afterend", boton);
}

const cargarPanelMasOriginalCaptura = window.cargarPanelMasDueno;

if (typeof cargarPanelMasOriginalCaptura === "function") {
    window.cargarPanelMasDueno = async function (...argumentos) {
        const resultado = await cargarPanelMasOriginalCaptura.apply(this, argumentos);
        capturaInsertarEntrada();
        return resultado;
    };
}

// ---------------------------------------------------------------------
// Pantalla
// ---------------------------------------------------------------------

function capturaCapa() {
    let capa = document.getElementById("capturaCapa");

    if (!capa) {
        capa = document.createElement("div");
        capa.id = "capturaCapa";
        capa.className = "captura-capa";
        document.body.appendChild(capa);
    }

    capa.classList.add("abierta");
    return capa;
}

async function abrirCapturaCodigos() {
    const capa = capturaCapa();
    capturaCodigoActual = null;
    capturaDuplicado = null;

    capa.innerHTML = `
    <header class="captura-cabecera">
        <button type="button" class="captura-icono" onclick="cerrarCapturaCodigos()" aria-label="Cerrar">&larr;</button>
        <div><h2>Capturar códigos</h2><small id="capturaContador">Cargando...</small></div>
        <button type="button" class="captura-icono" onclick="capturaVerLista()" aria-label="Ver lo capturado">☰</button>
    </header>

    <div class="captura-camara"><video id="capturaVideo" playsinline muted></video><div class="captura-mira"></div></div>
    <p class="captura-estado" id="capturaEstado">Abriendo cámara...</p>

    <section class="captura-ficha" id="capturaFicha" hidden>
        <span class="captura-etiqueta">Código detectado</span>
        <strong class="captura-codigo" id="capturaCodigoTexto"></strong>
        <p class="captura-aviso" id="capturaAviso" hidden></p>
        <input id="capturaNombre" type="text" maxlength="160" placeholder="Nombre del producto" autocomplete="off" autocapitalize="sentences" enterkeyhint="done">
        <div class="captura-acciones">
            <button type="button" class="captura-btn" onclick="capturaOmitir()">Omitir</button>
            <button type="button" class="captura-btn captura-btn-primario" id="capturaGuardar" onclick="capturaGuardar()">Guardar y siguiente</button>
        </div>
    </section>

    <form class="captura-manual" id="capturaManual">
        <input id="capturaManualCodigo" type="text" inputmode="numeric" placeholder="¿No lee? Escribe el código" autocomplete="off">
        <button type="submit" class="captura-btn">Usar</button>
    </form>`;

    document.getElementById("capturaNombre").addEventListener("keydown", evento => { if (evento.key === "Enter") capturaGuardar(); });
    document.getElementById("capturaManual").addEventListener("submit", evento => {
        evento.preventDefault();
        const campo = document.getElementById("capturaManualCodigo");
        const codigo = campo.value.trim();
        if (codigo) { campo.value = ""; capturaDetectado(codigo); }
    });

    capturaActualizarContador();
    capturaIniciarCamara();
}

function cerrarCapturaCodigos() {
    capturaDetenerCamara();
    document.getElementById("capturaCapa")?.classList.remove("abierta");
}

async function capturaActualizarContador() {
    const { ok, datos } = await capLlamar("/captura-codigos?buscar=");
    const contador = document.getElementById("capturaContador");

    if (ok && contador) {
        capturaTotal = datos.total;
        contador.textContent = `${datos.total} código${datos.total === 1 ? "" : "s"} capturado${datos.total === 1 ? "" : "s"}`;
    } else if (contador) {
        contador.textContent = "Sin conexión con el servidor";
    }
}

// ---------------------------------------------------------------------
// Cámara y captura
// ---------------------------------------------------------------------

function capturaDetenerCamara() {
    if (capturaControles) {
        try { capturaControles.stop(); } catch (error) { /* nada que hacer */ }
        capturaControles = null;
    }
}

async function capturaIniciarCamara() {
    const estado = document.getElementById("capturaEstado");

    try {
        await duenoPedCargarZxing();
    } catch (error) {
        estado.textContent = "No se pudo cargar el lector. Escribe el código a mano.";
        return;
    }

    try {
        const lector = new window.ZXingBrowser.BrowserMultiFormatReader();

        capturaControles = await lector.decodeFromVideoDevice(undefined, document.getElementById("capturaVideo"), resultado => {
            if (resultado) capturaDetectado(resultado.getText());
        });

        estado.textContent = "Apunta la cámara al código de barras.";
    } catch (error) {
        estado.textContent = "No se pudo abrir la cámara. Revisa los permisos o escribe el código a mano.";
    }
}

async function capturaDetectado(texto) {
    const codigo = String(texto || "").trim();
    if (!codigo || capturaCodigoActual) return; // ya hay uno en proceso: se ignora hasta guardar u omitir

    const ahora = Date.now();
    if (codigo === capturaUltimo.codigo && ahora - capturaUltimo.t < 2500) return;
    capturaUltimo = { codigo, t: ahora };

    capturaCodigoActual = codigo;
    capturaDuplicado = null;
    if (navigator.vibrate) navigator.vibrate(60);

    document.getElementById("capturaCodigoTexto").textContent = codigo;
    document.getElementById("capturaFicha").hidden = false;
    document.getElementById("capturaEstado").textContent = "Código detectado.";

    const nombre = document.getElementById("capturaNombre");
    const aviso = document.getElementById("capturaAviso");
    nombre.value = "";
    aviso.hidden = true;

    const { ok, datos } = await capLlamar(`/captura-codigos/existe/${encodeURIComponent(codigo)}`);

    if (ok && datos.existe) {
        capturaDuplicado = datos.registro;
        nombre.value = datos.registro.nombre;
        aviso.hidden = false;
        aviso.innerHTML = `Ya lo capturaste como <b>${capEscapar(datos.registro.nombre)}</b>. Corrige el nombre y guarda, u omite.`;
        document.getElementById("capturaGuardar").textContent = "Guardar corrección";
    } else {
        document.getElementById("capturaGuardar").textContent = "Guardar y siguiente";
    }

    nombre.focus();
}

function capturaLimpiarFicha() {
    capturaCodigoActual = null;
    capturaDuplicado = null;
    document.getElementById("capturaFicha").hidden = true;
    document.getElementById("capturaEstado").textContent = "Apunta la cámara al siguiente código.";
}

function capturaOmitir() {
    capturaLimpiarFicha();
}

async function capturaGuardar() {
    const nombre = document.getElementById("capturaNombre").value.trim();
    const aviso = document.getElementById("capturaAviso");

    if (!capturaCodigoActual) return;

    if (!nombre) {
        aviso.hidden = false;
        aviso.textContent = "Escribe el nombre del producto.";
        document.getElementById("capturaNombre").focus();
        return;
    }

    const boton = document.getElementById("capturaGuardar");
    boton.disabled = true;

    const { ok, datos } = await capLlamar("/captura-codigos", {
        method: "POST",
        body: JSON.stringify({ codigo: capturaCodigoActual, nombre, reemplazar: Boolean(capturaDuplicado) })
    });

    boton.disabled = false;

    if (!ok) {
        aviso.hidden = false;
        aviso.textContent = datos.error || "No se pudo guardar. Intenta de nuevo.";
        return;
    }

    capturaTotal = datos.total;
    document.getElementById("capturaContador").textContent = `${datos.total} código${datos.total === 1 ? "" : "s"} capturado${datos.total === 1 ? "" : "s"}`;
    capturaLimpiarFicha();
    document.getElementById("capturaEstado").textContent = datos.actualizado ? "Corregido. Apunta al siguiente." : "Guardado. Apunta al siguiente.";
}

// ---------------------------------------------------------------------
// Lista, corregir, borrar y exportar
// ---------------------------------------------------------------------

async function capturaVerLista(buscar = "") {
    capturaDetenerCamara();

    const capa = capturaCapa();
    const { ok, datos } = await capLlamar(`/captura-codigos?buscar=${encodeURIComponent(buscar)}`);

    capa.innerHTML = `
    <header class="captura-cabecera">
        <button type="button" class="captura-icono" onclick="abrirCapturaCodigos()" aria-label="Volver a escanear">&larr;</button>
        <div><h2>Lo capturado</h2><small>${ok ? `${datos.total} en total` : "Sin conexión"}</small></div>
        <button type="button" class="captura-icono" onclick="capturaExportar()" aria-label="Exportar CSV" title="Exportar CSV">⭳</button>
    </header>
    <div class="captura-busca"><input id="capturaBuscar" type="search" placeholder="Buscar por código o nombre" value="${capEscapar(buscar)}" oninput="capturaBuscarLista(this.value)"></div>
    <ul class="captura-lista">
        ${ok && datos.registros.length ? datos.registros.map(r => `
        <li>
            <div class="captura-fila"><b class="captura-codigo-chico">${capEscapar(r.codigo)}</b><span>${capEscapar(r.nombre)}</span></div>
            <div class="captura-fila-acciones">
                <button type="button" onclick="capturaCorregir(${r.id}, ${JSON.stringify(r.nombre).replace(/"/g, "&quot;")})">Corregir</button>
                <button type="button" class="captura-borrar" onclick="capturaBorrar(${r.id})">Borrar</button>
            </div>
        </li>`).join("") : `<li class="captura-vacio">${buscar ? "Nada coincide con esa búsqueda." : "Todavía no capturas nada."}</li>`}
    </ul>
    <div class="captura-pie"><button type="button" class="captura-btn captura-btn-primario" onclick="capturaExportar()">Exportar a Excel (CSV)</button></div>`;
}

let capturaBusquedaTimer = null;

function capturaBuscarLista(texto) {
    clearTimeout(capturaBusquedaTimer);
    capturaBusquedaTimer = setTimeout(async () => {
        await capturaVerLista(texto);
        const campo = document.getElementById("capturaBuscar");
        if (campo) { campo.focus(); campo.setSelectionRange(campo.value.length, campo.value.length); }
    }, 300);
}

async function capturaCorregir(id, nombreActual) {
    const nuevo = window.prompt("Nombre del producto:", nombreActual);
    if (nuevo === null || !nuevo.trim()) return;

    const { ok, datos } = await capLlamar(`/captura-codigos/${id}`, { method: "PATCH", body: JSON.stringify({ nombre: nuevo }) });
    if (!ok) { window.alert(datos.error || "No se pudo guardar."); return; }

    capturaVerLista(document.getElementById("capturaBuscar")?.value || "");
}

async function capturaBorrar(id) {
    if (!window.confirm("¿Borrar este código capturado?")) return;

    await capLlamar(`/captura-codigos/${id}`, { method: "DELETE" });
    capturaVerLista(document.getElementById("capturaBuscar")?.value || "");
}

// El CSV pide la sesión, así que se baja con la petición autenticada y se entrega como archivo.
async function capturaExportar() {
    const respuesta = await fetchAutenticado("/captura-codigos/exportar.csv");

    if (!respuesta.ok) { window.alert("No se pudo exportar."); return; }

    const blob = await respuesta.blob();
    const enlace = document.createElement("a");
    enlace.href = URL.createObjectURL(blob);
    enlace.download = `codigos-capturados-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(enlace);
    enlace.click();
    enlace.remove();
    setTimeout(() => URL.revokeObjectURL(enlace.href), 4000);
}
