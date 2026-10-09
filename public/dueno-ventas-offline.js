// Fase 3 del plan "celular como plan B": cobrar sin internet.
//
// Mismo criterio que el escritorio (public/js/pos-sales.js), aprendido a
// golpes y NO inventado de nuevo aqui:
//  1. Siempre se intenta primero en linea (POST /ventas).
//  2. Solo se guarda para despues si se cayo la red o el servidor fallo
//     (5xx). Un rechazo del servidor (PIN invalido, sin permiso, turno
//     vencido, stock insuficiente) NUNCA se encola: la cola entra por
//     /sync/push, que no vuelve a revisar nada, asi que encolarlo seria
//     dejar pasar la venta sin autorizacion.
//  3. La venta guarda la MISMA llave de idempotencia y el mismo codigo de
//     ticket del intento en linea: si el cobro SI llego al servidor y solo
//     se perdio la respuesta, al sincronizar el servidor la reconoce y no la
//     duplica.
//
// Lo que NO funciona sin internet, a proposito:
//  - Crédito: necesita validar limite y saldo del cliente en el servidor.
//  - Descuentos que piden PIN de administrador: el PIN solo se valida alla.
//  - Cerrar la caja: el corte cuenta solo lo que ya esta en el servidor.

const DUENO_DEVICE_ID_KEY = "nexoDuenoDeviceId";
const DUENO_VENTAS_TAMANO_LOTE = 10;
// Una venta que falla esta cantidad de veces seguidas deja de reintentarse
// sola y espera a que alguien la revise (puede ser un dato malo, no la red).
const DUENO_VENTAS_MAX_REINTENTOS_AUTOMATICOS = 5;

function deviceIdDueno() {
    try {
        let id = localStorage.getItem(DUENO_DEVICE_ID_KEY);

        if (!id) {
            const azar = typeof crypto !== "undefined" && crypto.randomUUID
                ? crypto.randomUUID()
                : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
            id = `dueno-${azar}`;
            localStorage.setItem(DUENO_DEVICE_ID_KEY, id);
        }

        return id;
    } catch (error) {
        return "dueno-sin-almacenamiento";
    }
}

// "No hubo respuesta" (red caida) o el servidor fallo (5xx): lo unico que se
// puede reintentar despues. Un TypeError cualquiera NO cuenta -- un error de
// programacion no debe terminar guardando una venta como si fuera falta de
// internet.
function esFalloDeConexionDueno(error) {
    if (!error) return false;
    if (error.message === "Sesion expirada") return false;

    if (error.status !== undefined) return error.status >= 500;

    if (typeof navigator !== "undefined" && navigator.onLine === false) return true;

    return error instanceof TypeError && /fetch|network|load failed|conexion|connection/i.test(error.message || "");
}

// ---------------- cola local (IndexedDB) ----------------

async function guardarVentaPendienteDueno(evento) {
    const db = await abrirDuenoDB();
    const transaccion = db.transaction("ventasPendientes", "readwrite");
    transaccion.objectStore("ventasPendientes").put(evento);
    await promesaTransaccion(transaccion);
}

async function listarVentasPendientesDueno() {
    try {
        const db = await abrirDuenoDB();
        const transaccion = db.transaction("ventasPendientes", "readonly");
        const todas = await promesaSolicitud(transaccion.objectStore("ventasPendientes").getAll());
        return todas.sort((a, b) => String(a.creadoAt).localeCompare(String(b.creadoAt)));
    } catch (error) {
        return [];
    }
}

async function quitarVentaPendienteDueno(eventId) {
    const db = await abrirDuenoDB();
    const transaccion = db.transaction("ventasPendientes", "readwrite");
    transaccion.objectStore("ventasPendientes").delete(eventId);
    await promesaTransaccion(transaccion);
}

// Todo el catalogo guardado (listarCatalogoLocal recorta a 60 para las
// listas de pantalla; aqui se necesita el stock de cualquier producto).
async function listarCatalogoLocalCompletoDueno() {
    try {
        const db = await abrirDuenoDB();
        const transaccion = db.transaction("catalogo", "readonly");
        return await promesaSolicitud(transaccion.objectStore("catalogo").getAll());
    } catch (error) {
        return [];
    }
}

// Pide que el navegador no borre esta base si el telefono se queda sin
// espacio: son ventas cobradas que todavia no estan en ningun otro lado.
function pedirAlmacenamientoPersistenteDueno() {
    try {
        if (navigator.storage && navigator.storage.persist) navigator.storage.persist();
    } catch (error) {
        // no es critico
    }
}

// Descuenta del catalogo guardado lo que se vendio sin conexion, para que la
// siguiente venta (y la busqueda) no vean existencias que ya no hay.
async function descontarStockLocalDueno(productos) {
    try {
        const db = await abrirDuenoDB();
        const transaccion = db.transaction("catalogo", "readwrite");
        const tienda = transaccion.objectStore("catalogo");

        for (const item of productos || []) {
            const id = Number(item.id);
            // Articulo rapido (id negativo) y venta por pieza suelta no
            // descuentan existencias de bolsa.
            if (!(id > 0) || item.modoVenta === "pieza") continue;

            const existente = await promesaSolicitud(tienda.get(id));
            if (!existente) continue;

            existente.stock = Math.max(0, Number(existente.stock || 0) - Number(item.cantidad || 0));
            tienda.put(existente);
        }

        await promesaTransaccion(transaccion);
    } catch (error) {
        console.warn("No se pudo ajustar el stock local", error);
    }
}

async function encolarVentaOfflineDueno(cuerpo) {
    // El PIN de administrador nunca se guarda en el telefono: si la venta
    // lo necesitaba, ni siquiera se llega a encolar (ver confirmarCobro).
    const payload = { ...cuerpo };
    delete payload.adminPin;

    const evento = {
        // Derivado de la llave de idempotencia: encolar dos veces la misma
        // venta (doble toque, reintento) escribe sobre el mismo registro.
        eventId: `venta-${cuerpo.idempotencyKey}`,
        tipo: "venta_creada",
        entidad: "venta",
        entidadId: cuerpo.idempotencyKey,
        payload,
        creadoAt: new Date().toISOString(),
        estado: "pendiente",
        intentos: 0,
        error: null
    };

    await guardarVentaPendienteDueno(evento);
    await descontarStockLocalDueno(cuerpo.productos);
    pedirAlmacenamientoPersistenteDueno();
    actualizarBannerVentasPendientesDueno();

    return evento;
}

// ---------------- pantalla despues de cobrar sin conexion ----------------

function mostrarVentaGuardadaSinConexionDueno(evento) {
    const total = Number(evento.payload?.total || 0);

    document.getElementById("duenoVenderCobroTitulo").textContent = "Venta guardada";
    document.getElementById("duenoVenderCobroContenido").innerHTML = `
        <div class="dueno-status-card">
            <p class="dueno-estado">Sin conexion</p>
            <h2>${dinero(total)}</h2>
            <p class="dueno-estado">La venta ya quedo guardada en este telefono y se sube sola cuando vuelva la señal. Cobra tranquilo.</p>
        </div>
        <p class="dueno-estado">El ticket digital estara listo cuando se sincronice: entonces la veras en "Buscar venta".</p>
        <button type="button" class="dueno-boton-primario" onclick="finalizarVentaVenderDueno()" style="margin-top:8px;">Nueva venta</button>
    `;

    duenoVentaCarrito = [];
}

// ---------------- sincronizacion ----------------

let duenoSincronizandoVentas = false;

async function sincronizarVentasPendientesDueno({ manual = false } = {}) {
    if (duenoSincronizandoVentas) return { sincronizadas: 0 };

    if (!navigator.onLine) {
        if (manual) mostrarToastDueno("Sigues sin conexion.");
        return { sincronizadas: 0 };
    }

    if (!haySesionActivaDueno()) return { sincronizadas: 0 };

    duenoSincronizandoVentas = true;
    let sincronizadas = 0;
    let conProblema = 0;

    try {
        const pendientes = (await listarVentasPendientesDueno())
            .filter(evento => manual || evento.intentos < DUENO_VENTAS_MAX_REINTENTOS_AUTOMATICOS);

        for (let i = 0; i < pendientes.length; i += DUENO_VENTAS_TAMANO_LOTE) {
            const lote = pendientes.slice(i, i + DUENO_VENTAS_TAMANO_LOTE);
            let respuesta;

            try {
                respuesta = await fetchAutenticado("/sync/push", {
                    method: "POST",
                    headers: { "Content-Type": "application/json", "x-device-id": deviceIdDueno() },
                    body: JSON.stringify({
                        deviceId: deviceIdDueno(),
                        eventos: lote.map(({ eventId, tipo, entidad, entidadId, payload }) => ({ eventId, tipo, entidad, entidadId, payload }))
                    })
                });
            } catch (error) {
                // Sin red, servidor caido o sesion vencida: todo se queda
                // guardado y se vuelve a intentar despues.
                if (manual) mostrarToastDueno(error.message === "Sesion expirada" ? "Inicia sesion otra vez para sincronizar." : "No se pudo sincronizar. Intenta en un momento.");
                break;
            }

            const confirmadas = new Set([...(respuesta.aceptados || []), ...(respuesta.duplicados || [])]);

            for (const evento of lote) {
                if (confirmadas.has(evento.eventId)) {
                    await quitarVentaPendienteDueno(evento.eventId);
                    sincronizadas += 1;
                }
            }

            for (const falla of respuesta.errores || []) {
                const evento = lote.find(item => item.eventId === falla.eventId);
                if (!evento) continue;

                evento.estado = "error";
                evento.error = falla.error || "No se pudo registrar";
                evento.intentos = Number(evento.intentos || 0) + 1;
                await guardarVentaPendienteDueno(evento);
                conProblema += 1;
            }
        }
    } finally {
        duenoSincronizandoVentas = false;
    }

    actualizarBannerVentasPendientesDueno();

    if (sincronizadas > 0) {
        mostrarToastDueno(`${sincronizadas} venta${sincronizadas === 1 ? "" : "s"} sincronizada${sincronizadas === 1 ? "" : "s"}.`);
        if (typeof refrescarCatalogoLocalDueno === "function") refrescarCatalogoLocalDueno();
    }

    if (conProblema > 0) {
        mostrarToastDueno(`${conProblema} venta${conProblema === 1 ? "" : "s"} no se pudo${conProblema === 1 ? "" : "ron"} registrar. Revisa "Ventas sin sincronizar".`);
    }

    return { sincronizadas, conProblema };
}

// El corte de caja cuenta lo que ya esta en el servidor: cerrar con ventas
// guardadas en el telefono dejaria el corte corto y esas ventas fuera de el.
async function asegurarVentasSincronizadasDueno() {
    let pendientes = await listarVentasPendientesDueno();
    if (!pendientes.length) return true;

    await sincronizarVentasPendientesDueno({ manual: true });
    pendientes = await listarVentasPendientesDueno();

    if (!pendientes.length) return true;

    mostrarToastDueno(`Tienes ${pendientes.length} venta${pendientes.length === 1 ? "" : "s"} sin sincronizar. Conectate y sincroniza antes de cerrar la caja.`);
    return false;
}

// ---------------- aviso en pantalla ----------------

async function actualizarBannerVentasPendientesDueno() {
    const pendientes = await listarVentasPendientesDueno();
    const total = pendientes.length;
    const conError = pendientes.filter(evento => evento.estado === "error").length;

    document.querySelectorAll(".dueno-ventas-pendientes-banner").forEach(banner => {
        if (!total) {
            banner.style.display = "none";
            banner.innerHTML = "";
            return;
        }

        banner.style.display = "flex";
        banner.classList.toggle("con-problema", conError > 0);
        banner.innerHTML = `
            <span>${total} venta${total === 1 ? "" : "s"} sin sincronizar${conError ? ` &middot; ${conError} con problema` : ""}</span>
            <button type="button" class="dueno-link" onclick="abrirVentasPendientesDueno()">Ver</button>
        `;
    });
}

function abrirVentasPendientesDueno() {
    cambiarTabDueno("mas");
    setTimeout(() => abrirSubpantallaMasDueno("ventas-pendientes"), 150);
}

// ---------------- pantalla "Ventas sin sincronizar" ----------------

async function renderSubpantallaVentasPendientes() {
    const contenedor = document.getElementById("duenoMasSubpantallaContenido");
    const pendientes = await listarVentasPendientesDueno();

    contenedor.innerHTML = `
        <article class="dueno-card">
            <div class="card-head">
                <div>
                    <span>Cobradas sin internet</span>
                    <h2>${pendientes.length ? `${pendientes.length} por subir` : "Todo sincronizado"}</h2>
                </div>
            </div>
            ${pendientes.length ? `
                <p class="dueno-estado">Estas ventas ya se cobraron y estan guardadas en este telefono. Se suben solas cuando hay señal.</p>
                <button type="button" class="dueno-boton-primario" onclick="sincronizarDesdePantallaPendientesDueno()">Sincronizar ahora</button>
                <div class="lista-compacta" style="margin-top:12px;">
                    ${pendientes.map(htmlVentaPendienteDueno).join("")}
                </div>
            ` : `<p class="dueno-estado">No hay ventas esperando. Las que cobres sin internet apareceran aqui.</p>`}
        </article>
    `;
}

function htmlVentaPendienteDueno(evento) {
    const payload = evento.payload || {};
    const productos = Array.isArray(payload.productos) ? payload.productos : [];
    const resumen = productos.slice(0, 3).map(p => `${Number(p.cantidad || 0)}x ${p.nombre || "Producto"}`).join(", ");
    const hora = new Date(evento.creadoAt).toLocaleString("es-MX", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });

    return `
        <div class="fila-dueno fila-dueno-columna">
            <div>
                <strong>${dinero(payload.total || 0)} &middot; ${escaparDueno(etiquetaMetodoPagoDueno(payload.metodoPago))}</strong>
                <span>${escaparDueno(hora)} &middot; ${escaparDueno(payload.clienteNombre || "Publico general")}</span>
                <span>${escaparDueno(resumen)}${productos.length > 3 ? ` y ${productos.length - 3} mas` : ""}</span>
                ${evento.estado === "error" ? `<span class="stock-texto-sin">No se pudo registrar: ${escaparDueno(evento.error || "error")}</span>` : ""}
            </div>
            ${evento.estado === "error" ? `
                <div class="dueno-fila-acciones">
                    <button type="button" class="dueno-link" data-evento="${escaparDueno(evento.eventId)}" onclick="reintentarVentaPendienteDueno(this.dataset.evento)">Reintentar</button>
                    <button type="button" class="dueno-link dueno-link-peligro" data-evento="${escaparDueno(evento.eventId)}" onclick="descartarVentaPendienteDueno(this.dataset.evento)">Descartar</button>
                </div>
            ` : ""}
        </div>
    `;
}

async function sincronizarDesdePantallaPendientesDueno() {
    await sincronizarVentasPendientesDueno({ manual: true });
    renderSubpantallaVentasPendientes();
}

async function reintentarVentaPendienteDueno(eventId) {
    const pendientes = await listarVentasPendientesDueno();
    const evento = pendientes.find(item => item.eventId === eventId);
    if (!evento) return;

    evento.intentos = 0;
    evento.estado = "pendiente";
    await guardarVentaPendienteDueno(evento);

    await sincronizarVentasPendientesDueno({ manual: true });
    renderSubpantallaVentasPendientes();
}

async function descartarVentaPendienteDueno(eventId) {
    if (!confirm("Esta venta NO se va a registrar en el sistema y su dinero no aparecera en el corte. ¿Descartarla de verdad?")) return;

    await quitarVentaPendienteDueno(eventId);
    actualizarBannerVentasPendientesDueno();
    renderSubpantallaVentasPendientes();

    // El stock local ya se habia descontado al cobrar: se vuelve a leer del
    // servidor para no mostrar existencias que nunca se vendieron.
    if (typeof refrescarCatalogoLocalDueno === "function") refrescarCatalogoLocalDueno();
}

// ---------------- arranque ----------------

function iniciarVentasOfflineDueno() {
    actualizarBannerVentasPendientesDueno();
    sincronizarVentasPendientesDueno();

    window.addEventListener("online", () => {
        sincronizarVentasPendientesDueno();
    });

    // Por si el evento "online" nunca llega (algunos telefonos lo reportan
    // mal): cada minuto se revisa si hay algo guardado y hay conexion.
    setInterval(async () => {
        if (navigator.onLine && (await listarVentasPendientesDueno()).length) sincronizarVentasPendientesDueno();
        else actualizarBannerVentasPendientesDueno();
    }, 60000);
}

window.addEventListener("load", () => setTimeout(iniciarVentasOfflineDueno, 2500));
