/* Recargas y pago de servicios (abarrotes), registro manual.

   El tendero cobra la recarga o el pago de servicio en su ticket como cualquier cosa. Aqui se arma esa linea:
   a quien (Telcel, CFE...), cuanto cobra y cuanto le queda de comision. La comision se guarda como ganancia:
   la linea lleva "costo" = lo que le paga al proveedor, y el sistema ya calcula la ganancia real con ese costo.
   No se conecta con ningun proveedor: es solo el registro (no manda la recarga). */

const SERVICIOS_PROVEEDORES = {
    recarga: ["Telcel", "AT&T", "Movistar", "Bait", "Unefon", "Otro"],
    servicio: ["CFE", "Telmex", "Agua", "Gas", "Internet", "Otro"]
};
const SERVICIOS_MONTOS_RAPIDOS = [10, 20, 30, 50, 100, 150, 200, 300, 500];
const SERVICIOS_PORCENTAJE_KEY = "nexoServiciosPorcentaje";

let servicioActual = { tipo: "recarga", proveedor: "", monto: "", comision: "", referencia: "", comisionEditada: false };

function svcEscapar(valor) {
    return String(valor ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function svcDinero(valor) {
    return "$" + Number(valor || 0).toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function svcNumero(valor) {
    const n = Number(String(valor).replace(",", "."));
    return Number.isFinite(n) && n > 0 ? n : 0;
}

function svcTieneAbarrotes() {
    return typeof perfilTieneAbarrotes === "function" && perfilTieneAbarrotes();
}

// Porcentaje de comision que el tendero dijo la ultima vez para cada proveedor (solo en este equipo).
function svcLeerPorcentajes() {
    try { return JSON.parse(localStorage.getItem(SERVICIOS_PORCENTAJE_KEY) || "{}") || {}; } catch (error) { return {}; }
}

function svcGuardarPorcentaje(proveedor, monto, comision) {
    if (!proveedor || !(monto > 0)) return;

    try {
        const todos = svcLeerPorcentajes();
        todos[proveedor] = Number(((comision / monto) * 100).toFixed(2));
        localStorage.setItem(SERVICIOS_PORCENTAJE_KEY, JSON.stringify(todos));
    } catch (error) { /* sin almacenamiento */ }
}

function svcComisionSugerida() {
    const porcentaje = svcLeerPorcentajes()[servicioActual.proveedor];
    const monto = svcNumero(servicioActual.monto);

    return porcentaje > 0 && monto > 0 ? Number(((monto * porcentaje) / 100).toFixed(2)) : "";
}

// ---------------------------------------------------------------------
// Boton en el Punto de venta
// ---------------------------------------------------------------------

function svcInstalarBoton() {
    const acciones = document.querySelector(".pos-cart-hero-acciones");
    let boton = document.getElementById("botonServiciosPOS");

    if (!svcTieneAbarrotes()) {
        boton?.remove();
        return;
    }

    if (!acciones || boton) return;

    boton = document.createElement("button");
    boton.type = "button";
    boton.id = "botonServiciosPOS";
    boton.className = "btn-agregar-lista-pos btn-exhibidor-pos svc-boton";
    boton.textContent = "Recargas y servicios";
    boton.addEventListener("click", () => abrirServiciosPOS());
    acciones.prepend(boton);
}

// ---------------------------------------------------------------------
// Ventana
// ---------------------------------------------------------------------

function svcModal() {
    let modal = document.getElementById("modalServiciosPOS");

    if (!modal) {
        modal = document.createElement("div");
        modal.id = "modalServiciosPOS";
        modal.className = "svc-modal";
        modal.addEventListener("click", evento => { if (evento.target === modal) cerrarServiciosPOS(); });
        document.body.appendChild(modal);
    }

    modal.style.display = "flex";
    return modal;
}

function abrirServiciosPOS(tipo = "recarga") {
    servicioActual = { tipo, proveedor: "", monto: "", comision: "", referencia: "", comisionEditada: false };
    svcModal();
    renderServiciosPOS();
}

function cerrarServiciosPOS() {
    const modal = document.getElementById("modalServiciosPOS");
    if (modal) modal.style.display = "none";
}

function svcResumen() {
    const monto = svcNumero(servicioActual.monto);
    const comision = Math.min(svcNumero(servicioActual.comision), monto);

    if (!monto) return "Elige el proveedor y escribe cuánto cobras.";

    return `Cobras <b>${svcDinero(monto)}</b> · te quedan <b class="svc-verde">${svcDinero(comision)}</b> · le pagas al proveedor <b>${svcDinero(monto - comision)}</b>`;
}

function svcActualizarResumen() {
    const resumen = document.getElementById("svcResumen");
    const agregar = document.getElementById("svcAgregar");

    if (resumen) resumen.innerHTML = svcResumen();
    if (agregar) agregar.disabled = !(servicioActual.proveedor && svcNumero(servicioActual.monto) > 0);
}

function renderServiciosPOS() {
    const modal = document.getElementById("modalServiciosPOS");
    if (!modal) return;

    const s = servicioActual;

    modal.innerHTML = `
    <div class="svc-card" role="dialog" aria-modal="true" aria-labelledby="svcTitulo">
        <header class="svc-cabecera">
            <div><span>Se agrega al ticket</span><h3 id="svcTitulo">Recargas y servicios</h3></div>
            <button type="button" class="svc-cerrar" onclick="cerrarServiciosPOS()" aria-label="Cerrar">&times;</button>
        </header>

        <div class="svc-tipos" role="tablist">
            <button type="button" class="${s.tipo === "recarga" ? "activo" : ""}" onclick="svcCambiarTipo('recarga')">📱 Recarga</button>
            <button type="button" class="${s.tipo === "servicio" ? "activo" : ""}" onclick="svcCambiarTipo('servicio')">🧾 Pago de servicio</button>
        </div>

        <div class="svc-bloque">
            <label>${s.tipo === "recarga" ? "Compañía" : "Servicio"}</label>
            <div class="svc-chips">
                ${SERVICIOS_PROVEEDORES[s.tipo].map(p => `<button type="button" class="${s.proveedor === p ? "activo" : ""}" onclick="svcElegirProveedor('${p.replace(/'/g, "\\'")}')">${svcEscapar(p)}</button>`).join("")}
            </div>
        </div>

        <div class="svc-bloque">
            <label for="svcMonto">${s.tipo === "recarga" ? "Monto de la recarga" : "Cuánto cobras en total"}</label>
            ${s.tipo === "recarga" ? `<div class="svc-chips svc-montos">${SERVICIOS_MONTOS_RAPIDOS.map(m => `<button type="button" class="${svcNumero(s.monto) === m ? "activo" : ""}" onclick="svcElegirMonto(${m})">$${m}</button>`).join("")}</div>` : ""}
            <input id="svcMonto" type="number" min="0" step="0.01" inputmode="decimal" placeholder="Ej. 50" value="${svcEscapar(s.monto)}" oninput="svcEscribirMonto(this.value)">
        </div>

        <div class="svc-fila">
            <div class="svc-bloque">
                <label for="svcComision">Te queda de comisión</label>
                <input id="svcComision" type="number" min="0" step="0.01" inputmode="decimal" placeholder="Ej. 2" value="${svcEscapar(s.comision)}" title="Lo que ganas tú: ${s.tipo === "recarga" ? "la diferencia entre lo que cobras y lo que le pagas a la compañía" : "lo que cobras de más por hacer el pago"}" oninput="svcEscribirComision(this.value)">
            </div>
            <div class="svc-bloque">
                <label for="svcReferencia">${s.tipo === "recarga" ? "Teléfono" : "Contrato o referencia"} <small>(opcional)</small></label>
                <input id="svcReferencia" type="text" maxlength="40" placeholder="${s.tipo === "recarga" ? "10 dígitos" : "Ej. número de servicio"}" value="${svcEscapar(s.referencia)}" oninput="servicioActual.referencia = this.value">
            </div>
        </div>

        <p class="svc-resumen" id="svcResumen">${svcResumen()}</p>
        <p class="svc-nota">Nexo solo lo registra: la recarga o el pago lo haces tú con tu proveedor. La comisión se cuenta como ganancia.</p>

        <footer class="svc-pie">
            <button type="button" class="svc-btn" onclick="cerrarServiciosPOS()">Cancelar</button>
            <button type="button" class="svc-btn svc-btn-primario" id="svcAgregar" onclick="svcAgregarAlCarrito()" ${s.proveedor && svcNumero(s.monto) > 0 ? "" : "disabled"}>Agregar al ticket</button>
        </footer>
    </div>`;
}

function svcCambiarTipo(tipo) {
    servicioActual = { tipo, proveedor: "", monto: "", comision: "", referencia: "", comisionEditada: false };
    renderServiciosPOS();
}

function svcElegirProveedor(proveedor) {
    servicioActual.proveedor = proveedor;
    if (!servicioActual.comisionEditada) servicioActual.comision = svcComisionSugerida();
    renderServiciosPOS();
    document.getElementById("svcMonto")?.focus();
}

function svcElegirMonto(monto) {
    servicioActual.monto = String(monto);
    if (!servicioActual.comisionEditada) servicioActual.comision = svcComisionSugerida();
    renderServiciosPOS();
}

function svcEscribirMonto(valor) {
    servicioActual.monto = valor;

    if (!servicioActual.comisionEditada) {
        servicioActual.comision = svcComisionSugerida();
        const campo = document.getElementById("svcComision");
        if (campo) campo.value = servicioActual.comision;
    }

    svcActualizarResumen();
}

function svcEscribirComision(valor) {
    servicioActual.comision = valor;
    servicioActual.comisionEditada = true;
    svcActualizarResumen();
}

// Arma la linea del ticket: precio = lo que cobra; costo = lo que le paga al proveedor, asi la comision sale como ganancia.
function svcAgregarAlCarrito() {
    const s = servicioActual;
    const monto = svcNumero(s.monto);
    if (!s.proveedor || !(monto > 0) || typeof agregarArticuloRapido !== "function") return;

    const comision = Math.min(svcNumero(s.comision), monto);
    const etiqueta = s.tipo === "recarga" ? `Recarga ${s.proveedor}` : `Pago ${s.proveedor}`;
    const referencia = String(s.referencia || "").trim();

    agregarArticuloRapido(`${etiqueta}${referencia ? ` · ${referencia}` : ""}`, monto, 1);

    const linea = carrito[carrito.length - 1];
    linea.categoria = "Recargas y servicios";
    linea.costo = Number((monto - comision).toFixed(2));
    linea.costoConocido = true;
    linea.servicio = { tipo: s.tipo, proveedor: s.proveedor, referencia, comision: Number(comision.toFixed(2)) };

    if (comision > 0) svcGuardarPorcentaje(s.proveedor, monto, comision);

    cerrarServiciosPOS();
    if (typeof actualizarCarrito === "function") actualizarCarrito();
}

document.addEventListener("keydown", evento => {
    if (evento.key === "Escape" && document.getElementById("modalServiciosPOS")?.style.display === "flex") cerrarServiciosPOS();
});

// El boton aparece cuando el perfil ya esta aplicado y se retira si el negocio no tiene abarrotes.
setInterval(svcInstalarBoton, 2500);
document.addEventListener("DOMContentLoaded", () => setTimeout(svcInstalarBoton, 1500));
