/* Gafi: codigos y fotos en el celular (/dueno). Misma pantalla que en la computadora (Inventario -> Gafi: codigos y fotos) y las mismas
   rutas (/gafi-captura/...): buscas un producto de la lista de Gafi, escaneas el empaque con la camara y le tomas su foto.
   Aparece en "Mas" solo si la funcion "gafi_captura" esta encendida para el negocio, y solo la usa el administrador. */

let dgfResumen = null;
let dgfResultados = [];
let dgfElegido = null;
let dgfMensaje = null;
let dgfConsulta = "";
let dgfTemporizador = null;
let dgfUrlFoto = null;

function dgfEscapar(valor) {
    return String(valor ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

async function dgfLlamar(ruta, opciones = {}) {
    try {
        const datos = await fetchAutenticado(ruta, { ...opciones, headers: { "Content-Type": "application/json", ...(opciones.headers || {}) } }) || {};
        return { ok: datos.ok !== false, datos };
    } catch (error) {
        return { ok: false, datos: error.datos || { error: error.message } };
    }
}

// La foto es binaria: fetchAutenticado solo entiende JSON, asi que se piden los mismos encabezados de sesion a mano.
async function dgfCargarFoto(producto) {
    if (dgfUrlFoto) URL.revokeObjectURL(dgfUrlFoto);
    dgfUrlFoto = null;

    if (!producto?.tieneFoto) return;

    try {
        const token = dispositivoTokenGuardado();
        const empleado = empleadoActivoGuardado();
        const encabezados = token && empleado ? { "x-dispositivo-token": token, "x-empleado-id": String(empleado.id) } : { Authorization: `Bearer ${tokenGuardado()}` };
        const respuesta = await fetch(`/gafi-captura/${producto.id}/foto`, { headers: encabezados });
        if (respuesta.ok) dgfUrlFoto = URL.createObjectURL(await respuesta.blob());
    } catch (error) { /* sin vista previa: la foto igual esta guardada */ }
}

// ---------------------------------------------------------------------
// Entrada en "Mas"
// ---------------------------------------------------------------------

async function dgfInsertarEntrada() {
    if (document.getElementById("dgfEntrada")) return;

    const { ok, datos } = await dgfLlamar("/funciones-beta");
    const destino = document.getElementById("duenoMasStatusCard");

    if (!ok || datos?.funciones?.gafi_captura !== true || !destino || document.getElementById("dgfEntrada")) return;

    const boton = document.createElement("button");
    boton.type = "button";
    boton.id = "dgfEntrada";
    boton.className = "dgf-entrada";
    boton.innerHTML = `<span aria-hidden="true">📦</span><b>Gafi: códigos y fotos</b><small>Escanea el empaque y suma al catálogo</small>`;
    boton.addEventListener("click", abrirGafiDueno);
    destino.insertAdjacentElement("afterend", boton);
}

const cargarPanelMasOriginalGafi = window.cargarPanelMasDueno;

if (typeof cargarPanelMasOriginalGafi === "function") {
    window.cargarPanelMasDueno = async function (...argumentos) {
        const resultado = await cargarPanelMasOriginalGafi.apply(this, argumentos);
        dgfInsertarEntrada();
        return resultado;
    };
}

// ---------------------------------------------------------------------
// Pantalla
// ---------------------------------------------------------------------

function dgfCapa() {
    let capa = document.getElementById("dgfCapa");

    if (!capa) {
        capa = document.createElement("div");
        capa.id = "dgfCapa";
        capa.className = "dgf-capa";
        document.body.appendChild(capa);
    }

    capa.classList.add("abierta");
    return capa;
}

function cerrarGafiDueno() {
    document.getElementById("dgfCapa")?.classList.remove("abierta");
    if (dgfUrlFoto) URL.revokeObjectURL(dgfUrlFoto);
    dgfUrlFoto = null;
}

async function abrirGafiDueno() {
    dgfElegido = null;
    dgfMensaje = null;
    dgfResultados = [];
    dgfConsulta = "";
    dgfCapa();
    dgfPintar();

    const r = await dgfLlamar("/gafi-captura/resumen");
    dgfResumen = r.ok ? r.datos : null;

    if (!r.ok) dgfMensaje = { tipo: "error", texto: r.datos.error || "No se pudo abrir. Revisa tu internet." };

    dgfPintar();
}

function dgfFilaResultado(p) {
    return `<button type="button" class="dgf-fila" data-dgf-elegir="${p.id}"><span><b>${dgfEscapar(p.nombre)}</b><small>${dgfEscapar(p.marca)}${p.clave ? ` · ${dgfEscapar(p.clave)}` : ""}</small></span><span class="dgf-marcas"><i class="${p.codigoBarras ? "dgf-listo" : ""}">${p.codigoBarras ? "✓ código" : "sin código"}</i><i class="${p.tieneFoto ? "dgf-listo" : ""}">${p.tieneFoto ? "✓ foto" : "sin foto"}</i></span></button>`;
}

function dgfPintar() {
    const capa = dgfCapa();
    const p = dgfElegido;

    const avance = dgfResumen ? `<p class="dgf-avance"><b>${dgfResumen.con_barras}</b> con código · <b>${dgfResumen.con_foto}</b> con foto · de <b>${dgfResumen.total}</b></p>` : "";
    const mensaje = dgfMensaje ? `<p class="dgf-mensaje dgf-${dgfMensaje.tipo}" role="status">${dgfEscapar(dgfMensaje.texto)}</p>` : "";

    capa.innerHTML = `
    <header class="dgf-cabecera">
        <button type="button" class="dgf-icono" id="dgfAtras" aria-label="Volver">&larr;</button>
        <h2>Gafi: códigos y fotos</h2>
        <span class="dgf-icono dgf-vacio-icono"></span>
    </header>
    <main class="dgf-cuerpo">
        ${avance}
        ${p ? `
        <section class="dgf-captura">
            <h3>${dgfEscapar(p.nombre)}</h3>
            <p class="dgf-detalle">${dgfEscapar(p.marca)}${p.clave ? ` · Clave ${dgfEscapar(p.clave)}` : ""} · Gafi ${dgfEscapar(p.codigo)}${p.precio != null ? ` · $${Number(p.precio).toFixed(2)}` : ""}</p>
            <label class="dgf-etiqueta" for="dgfCodigo">Código de barras del empaque</label>
            <button type="button" class="dgf-principal dgf-grande" id="dgfEscanear">📷 Escanear con la cámara</button>
            <div class="dgf-fila-form"><input id="dgfCodigo" type="text" inputmode="numeric" autocomplete="off" placeholder="o escríbelo" value="${dgfEscapar(p.codigoBarras)}"><button type="button" class="dgf-principal" id="dgfGuardarCodigo">Guardar</button></div>
            ${p.codigoBarras ? `<small class="dgf-nota-ok">Ya tiene código guardado. Si lo cambias, se reemplaza.</small>` : ""}
            <label class="dgf-etiqueta">Foto del producto</label>
            <div class="dgf-fila-form">${dgfUrlFoto ? `<img class="dgf-miniatura" src="${dgfUrlFoto}" alt="">` : `<div class="dgf-miniatura dgf-sin-foto">Sin foto</div>`}<label class="dgf-boton-archivo">${p.tieneFoto ? "Cambiar foto" : "📷 Tomar foto"}<input id="dgfFoto" type="file" accept="image/*" capture="environment" hidden></label></div>
            ${mensaje}
            <button type="button" class="dgf-secundario" id="dgfOtro">Otro producto</button>
        </section>` : `
        <input id="dgfBuscar" class="dgf-buscar" type="search" autocomplete="off" placeholder="Clave, código o nombre (ej. HSG1406)" value="${dgfEscapar(dgfConsulta)}">
        ${mensaje}
        <div id="dgfResultados" class="dgf-resultados">${dgfResultados.map(dgfFilaResultado).join("")}</div>`}
    </main>`;

    dgfEnlazar(capa);
}

function dgfEnlazarResultados(capa) {
    capa.querySelectorAll("[data-dgf-elegir]").forEach(boton => { boton.onclick = () => dgfElegir(boton.dataset.dgfElegir); });
}

function dgfEnlazar(capa) {
    capa.querySelector("#dgfAtras").onclick = () => (dgfElegido ? dgfSiguiente() : cerrarGafiDueno());
    dgfEnlazarResultados(capa);

    const buscar = capa.querySelector("#dgfBuscar");
    if (buscar) {
        buscar.oninput = () => {
            clearTimeout(dgfTemporizador);
            const texto = buscar.value.trim();
            dgfTemporizador = setTimeout(() => dgfBuscar(texto), 250);
        };
    }

    capa.querySelector("#dgfEscanear")?.addEventListener("click", () => {
        abrirEscanerCodigoDueno({
            titulo: "Código de barras del empaque",
            alCodigo: codigo => {
                cerrarEscanerCodigoDueno();
                const campo = document.getElementById("dgfCodigo");
                if (campo) campo.value = codigo;
                dgfGuardarCodigo();
            }
        });
    });

    const campoCodigo = capa.querySelector("#dgfCodigo");
    if (campoCodigo) campoCodigo.onkeydown = evento => { if (evento.key === "Enter") { evento.preventDefault(); dgfGuardarCodigo(); } };

    capa.querySelector("#dgfGuardarCodigo")?.addEventListener("click", dgfGuardarCodigo);
    capa.querySelector("#dgfOtro")?.addEventListener("click", dgfSiguiente);

    const campoFoto = capa.querySelector("#dgfFoto");
    if (campoFoto) campoFoto.onchange = () => dgfGuardarFoto(campoFoto.files[0]);
}

async function dgfBuscar(texto) {
    dgfConsulta = texto;

    if (texto.length < 2) {
        dgfResultados = [];
        const caja = document.getElementById("dgfResultados");
        if (caja) caja.innerHTML = "";
        return;
    }

    const r = await dgfLlamar(`/gafi-captura/buscar?q=${encodeURIComponent(texto)}`);

    if (dgfConsulta !== texto) return; // llego una busqueda mas nueva

    dgfResultados = r.ok ? r.datos.productos || [] : [];
    dgfMensaje = r.ok ? null : { tipo: "error", texto: r.datos.error || "No se pudo buscar." };

    const caja = document.getElementById("dgfResultados");
    if (!caja) return;

    caja.innerHTML = dgfResultados.length ? dgfResultados.map(dgfFilaResultado).join("") : `<p class="dgf-vacio">No hay productos de Gafi con eso.</p>`;
    dgfEnlazarResultados(document.getElementById("dgfCapa"));
}

async function dgfElegir(id) {
    dgfElegido = dgfResultados.find(p => String(p.id) === String(id)) || null;
    dgfMensaje = null;
    await dgfCargarFoto(dgfElegido);
    dgfPintar();
}

function dgfSiguiente() {
    dgfElegido = null;
    dgfMensaje = null;
    dgfResultados = [];
    dgfConsulta = "";
    dgfPintar();
    document.getElementById("dgfBuscar")?.focus();
}

function dgfActualizar(producto) {
    dgfResultados = dgfResultados.map(p => (p.id === producto.id ? producto : p));
    if (dgfElegido && dgfElegido.id === producto.id) dgfElegido = producto;
}

async function dgfRefrescarResumen() {
    const r = await dgfLlamar("/gafi-captura/resumen");
    if (r.ok) dgfResumen = r.datos;
}

async function dgfGuardarCodigo() {
    const valor = (document.getElementById("dgfCodigo")?.value || "").trim();

    if (!valor) { dgfMensaje = { tipo: "error", texto: "Escanea o escribe el código de barras." }; dgfPintar(); return; }

    const r = await dgfLlamar(`/gafi-captura/${dgfElegido.id}/codigo-barras`, { method: "POST", body: JSON.stringify({ codigoBarras: valor }) });

    if (!r.ok) { dgfMensaje = { tipo: "error", texto: r.datos.error || "No se pudo guardar." }; dgfPintar(); return; }

    if (navigator.vibrate) navigator.vibrate(60);
    dgfActualizar(r.datos.producto);
    dgfMensaje = { tipo: "ok", texto: "Código de barras guardado." };
    await dgfRefrescarResumen();
    dgfPintar();
}

function dgfComprimirFoto(archivo) {
    return new Promise((resolver, rechazar) => {
        const lector = new FileReader();
        lector.onerror = () => rechazar(new Error("No se pudo leer la foto."));
        lector.onload = () => {
            const imagen = new Image();
            imagen.onerror = () => rechazar(new Error("Esa foto no se pudo abrir."));
            imagen.onload = () => {
                const escala = Math.min(1, 1000 / Math.max(imagen.width, imagen.height));
                const lienzo = document.createElement("canvas");
                lienzo.width = Math.round(imagen.width * escala);
                lienzo.height = Math.round(imagen.height * escala);
                lienzo.getContext("2d").drawImage(imagen, 0, 0, lienzo.width, lienzo.height);
                resolver(lienzo.toDataURL("image/jpeg", 0.85));
            };
            imagen.src = lector.result;
        };
        lector.readAsDataURL(archivo);
    });
}

async function dgfGuardarFoto(archivo) {
    if (!archivo) return;

    try {
        const imagen = await dgfComprimirFoto(archivo);
        const r = await dgfLlamar(`/gafi-captura/${dgfElegido.id}/foto`, { method: "POST", body: JSON.stringify({ imagen }) });

        if (!r.ok) { dgfMensaje = { tipo: "error", texto: r.datos.error || "No se pudo guardar la foto." }; dgfPintar(); return; }

        dgfActualizar(r.datos.producto);
        await dgfCargarFoto(dgfElegido);
        dgfMensaje = { tipo: "ok", texto: "Foto guardada." };
        await dgfRefrescarResumen();
    } catch (error) {
        dgfMensaje = { tipo: "error", texto: error.message };
    }

    dgfPintar();
}
