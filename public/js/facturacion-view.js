// Facturacion electronica -- 3 estados con lenguaje visual distinto a
// proposito (ver plan): inactiva (hero, momento de decision) / wizard
// de activacion (subir CSD) / activa (tarjetas de trabajo). El backend
// (facturacion-server.js) ya valida todo -- esta vista solo pinta el
// estado y llama a los endpoints, sin logica de negocio propia.

let facturacionEstadoActual = null;
let facturacionEtapaWizard = 0;
let facturacionEtapaMaxima = 0;
let facturacionArchivoCer = null;
let facturacionArchivoKey = null;
let facturacionConfirmacion = null;

const FACTURACION_ETAPAS = [
    { titulo: "Datos fiscales" },
    { titulo: "Tu certificado" },
    { titulo: "Confirmación" }
];

// Catalogo real c_RegimenFiscal del SAT (CFDI 4.0) -- solo los regimenes
// mas comunes para un negocio pequeno/mediano, no el catalogo completo.
const FACTURACION_REGIMENES = [
    ["601", "General de Ley Personas Morales"],
    ["603", "Personas Morales con Fines no Lucrativos"],
    ["606", "Arrendamiento"],
    ["612", "Personas Físicas con Actividades Empresariales y Profesionales"],
    ["616", "Sin obligaciones fiscales"],
    ["621", "Incorporación Fiscal"],
    ["625", "Actividades Empresariales con ingresos a través de Plataformas Tecnológicas"],
    ["626", "Régimen Simplificado de Confianza (RESICO)"]
];

// Catalogo real c_UsoCFDI del SAT -- solo los usos que de verdad aplican
// a una venta de mostrador con pago inmediato (PUE): sin inversion, sin
// nomina, sin pagos en parcialidades.
const FACTURACION_USOS_CFDI = [
    ["G01", "Adquisición de mercancías"],
    ["G03", "Gastos en general"],
    ["S01", "Sin efectos fiscales"]
];

async function mostrarFacturacion() {
    if (typeof ocultarPantallasPrincipales === "function") {
        ocultarPantallasPrincipales();
    }

    const pantalla = document.getElementById("pantallaFacturacion");
    if (!pantalla) return;

    pantalla.style.display = "block";

    if (typeof actualizarTopbarContexto === "function") {
        actualizarTopbarContexto("Facturación", "Emite CFDI 4.0 reales para tus ventas", "facturacion");
    }

    pantalla.innerHTML = `<div class="facturacion-shell" id="facturacionContenido"><p class="facturacion-vacio">Cargando...</p></div>`;

    await cargarEstadoFacturacion();
}

async function cargarEstadoFacturacion() {
    const contenedor = document.getElementById("facturacionContenido");

    try {
        const respuesta = await fetch("/facturacion/estado");
        const datos = await respuesta.json();

        if (!datos.ok) {
            if (contenedor) contenedor.innerHTML = `<p class="facturacion-vacio">No se pudo cargar Facturación.</p>`;
            return;
        }

        facturacionEstadoActual = datos;

        if (datos.facturacion_activa) {
            renderFacturacionActiva();
        } else {
            renderFacturacionHero();
        }
    } catch (error) {
        if (contenedor) contenedor.innerHTML = `<p class="facturacion-vacio">No se pudo cargar Facturación. Revisa tu conexión.</p>`;
    }
}

/* ---------- Estado: inactiva (hero) ---------- */

function renderFacturacionHero() {
    const contenedor = document.getElementById("facturacionContenido");
    if (!contenedor) return;

    const disponible = facturacionEstadoActual?.disponibleEnPlan !== false;

    contenedor.innerHTML = `
        <div class="facturacion-hero">
            <img src="img/nexo-ia/feliz.jpg" alt="Nexo" class="facturacion-hero-img">
            <h1>Factura directo desde Nexo</h1>
            <p class="facturacion-hero-sub">Emite CFDI 4.0 reales para tus clientes, timbrados ante el SAT, sin salir del sistema. Necesitas tu RFC y tu Certificado de Sello Digital (CSD) -- el mismo que usarías en cualquier otro sistema de facturación.</p>

            <div class="facturacion-checklist">
                <div class="facturacion-checklist-item">
                    ${iconoUISVG("building")}
                    <div><strong>Tu RFC y régimen fiscal</strong><span>Los datos con los que estás dado de alta ante el SAT.</span></div>
                </div>
                <div class="facturacion-checklist-item">
                    ${iconoUISVG("shield")}
                    <div><strong>Tu Certificado de Sello Digital (CSD)</strong><span>Se descarga gratis en el portal del SAT con tu e.firma, o te lo puede dar tu contador. Son 2 archivos (.cer y .key) más una contraseña.</span></div>
                </div>
            </div>

            <div class="facturacion-privacidad">
                ${iconoUISVG("lock")}
                <span>Tu CSD se manda directo a Facturama, el proveedor autorizado (PAC) que usamos para timbrar ante el SAT. Nexo nunca guarda una copia de tu llave privada.</span>
            </div>

            ${disponible
                ? `<button type="button" class="facturacion-hero-cta" onclick="iniciarWizardFacturacion()">Empezar</button>`
                : `
                    <span class="facturacion-upsell-badge">${iconoUISVG("zap")} Complemento de pago</span>
                    <p class="facturacion-hero-sub" style="font-size:13px;">Esta función no está incluida en tu plan actual. Actívala desde Cuenta.</p>
                    <button type="button" class="facturacion-hero-cta" onclick="mostrarCuenta()">Ir a Cuenta</button>
                  `
            }
        </div>
    `;
}

/* ---------- Wizard de activacion ---------- */

function iniciarWizardFacturacion() {
    facturacionEtapaWizard = 0;
    facturacionEtapaMaxima = 0;
    facturacionArchivoCer = null;
    facturacionArchivoKey = null;
    facturacionConfirmacion = null;
    renderFacturacionWizard();
}

function renderFacturacionWizard() {
    const contenedor = document.getElementById("facturacionContenido");
    if (!contenedor) return;

    contenedor.innerHTML = `
        <div class="facturacion-wizard">
            <div class="facturacion-wizard-header">
                <div>
                    <h2>Activar facturación</h2>
                    <p>3 pasos, toma unos minutos.</p>
                </div>
                <div class="facturacion-dots">
                    ${FACTURACION_ETAPAS.map((etapa, i) => `
                        <div class="facturacion-dot" data-facturacion-dot="${i}">
                            <span class="facturacion-dot-num">${i + 1}</span>
                            <span class="facturacion-dot-label">${escaparPOS(etapa.titulo)}</span>
                        </div>
                    `).join("")}
                </div>
            </div>

            <section data-facturacion-etapa="0" class="facturacion-etapa"></section>
            <section data-facturacion-etapa="1" class="facturacion-etapa" hidden></section>
            <section data-facturacion-etapa="2" class="facturacion-etapa" hidden></section>

            <div class="facturacion-wizard-nav">
                <button type="button" id="facturacionNavAtras" class="facturacion-btn-secundario" style="width:auto;padding:0 18px;" onclick="retrocederEtapaFacturacion()">&larr; Atrás</button>
                <button type="button" id="facturacionNavSiguiente" class="facturacion-hero-cta" style="min-width:150px;" onclick="avanzarEtapaFacturacion()">Continuar</button>
            </div>
        </div>
    `;

    cambiarEtapaFacturacion(0);
}

function cambiarEtapaFacturacion(etapa) {
    const secciones = Array.from(document.querySelectorAll("#facturacionContenido [data-facturacion-etapa]"));
    if (!secciones.length) return;

    facturacionEtapaWizard = Math.max(0, Math.min(etapa, secciones.length - 1));
    facturacionEtapaMaxima = Math.max(facturacionEtapaMaxima, facturacionEtapaWizard);

    secciones.forEach(seccion => {
        seccion.hidden = Number(seccion.dataset.facturacionEtapa) !== facturacionEtapaWizard;
    });

    document.querySelectorAll("#facturacionContenido [data-facturacion-dot]").forEach(dot => {
        const indice = Number(dot.dataset.facturacionDot);
        dot.classList.toggle("activo", indice === facturacionEtapaWizard);
        dot.classList.toggle("completado", indice < facturacionEtapaWizard);
    });

    const botonAtras = document.getElementById("facturacionNavAtras");
    const botonSiguiente = document.getElementById("facturacionNavSiguiente");

    if (botonAtras) botonAtras.style.visibility = facturacionEtapaWizard === 0 ? "hidden" : "visible";

    if (botonSiguiente) {
        const esUltima = facturacionEtapaWizard === secciones.length - 1;
        botonSiguiente.style.display = esUltima ? "none" : "inline-flex";
        botonSiguiente.textContent = facturacionEtapaWizard === 1 ? "Subir y verificar" : "Continuar";
    }

    const nav = document.querySelector(".facturacion-wizard-nav");
    if (nav) nav.style.display = "flex";

    if (facturacionEtapaWizard === 0) renderEtapaDatosFiscalesFacturacion();
    else if (facturacionEtapaWizard === 1) renderEtapaCsdFacturacion();
    else if (facturacionEtapaWizard === 2) renderEtapaConfirmacionFacturacion();
}

async function avanzarEtapaFacturacion() {
    if (facturacionEtapaWizard === 0) {
        if (await guardarDatosFiscalesFacturacion()) cambiarEtapaFacturacion(1);
        return;
    }

    if (facturacionEtapaWizard === 1) {
        await subirCsdFacturacion();
        return;
    }

    cambiarEtapaFacturacion(facturacionEtapaWizard + 1);
}

function retrocederEtapaFacturacion() {
    cambiarEtapaFacturacion(facturacionEtapaWizard - 1);
}

/* --- Etapa 0: datos fiscales --- */

function renderEtapaDatosFiscalesFacturacion() {
    const seccion = document.querySelector('#facturacionContenido [data-facturacion-etapa="0"]');
    if (!seccion) return;

    const datos = facturacionEstadoActual || {};

    seccion.innerHTML = `
        <h3>Datos fiscales de tu negocio</h3>
        <p class="facturacion-etapa-nota">Deben coincidir exacto con tu constancia de situación fiscal del SAT -- si algo no coincide, Facturama rechaza el timbrado.</p>
        <div class="facturacion-campos">
            <label class="col-2"><span>RFC</span><input type="text" id="facturacionRfc" maxlength="13" style="text-transform:uppercase;" value="${escaparPOS(datos.rfc || "")}"></label>
            <label class="col-2"><span>Razón social</span><input type="text" id="facturacionRazonSocial" maxlength="250" value="${escaparPOS(datos.razon_social || "")}"></label>
            <label>
                <span>Régimen fiscal</span>
                <select id="facturacionRegimen">
                    <option value="">Selecciona...</option>
                    ${FACTURACION_REGIMENES.map(([clave, nombre]) => `<option value="${clave}" ${datos.regimen_fiscal === clave ? "selected" : ""}>${clave} -- ${escaparPOS(nombre)}</option>`).join("")}
                </select>
            </label>
            <label><span>Código postal fiscal</span><input type="text" id="facturacionCP" maxlength="5" inputmode="numeric" value="${escaparPOS(datos.codigo_postal_fiscal || "")}"></label>
        </div>
        <div class="facturacion-error-inline" id="facturacionErrorEtapa0"></div>
    `;
}

async function guardarDatosFiscalesFacturacion() {
    const errorBox = document.getElementById("facturacionErrorEtapa0");
    const cuerpo = {
        rfc: document.getElementById("facturacionRfc")?.value.trim().toUpperCase() || "",
        razonSocial: document.getElementById("facturacionRazonSocial")?.value.trim() || "",
        regimenFiscal: document.getElementById("facturacionRegimen")?.value || "",
        codigoPostalFiscal: document.getElementById("facturacionCP")?.value.trim() || ""
    };

    try {
        const respuesta = await fetch("/facturacion/datos-fiscales", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(cuerpo)
        });
        const datos = await respuesta.json();

        if (!datos.ok) {
            if (errorBox) { errorBox.textContent = datos.error || "No se pudieron guardar tus datos fiscales."; errorBox.classList.add("visible"); }
            return false;
        }

        facturacionEstadoActual = {
            ...facturacionEstadoActual,
            rfc: cuerpo.rfc,
            razon_social: cuerpo.razonSocial,
            regimen_fiscal: cuerpo.regimenFiscal,
            codigo_postal_fiscal: cuerpo.codigoPostalFiscal
        };

        if (errorBox) errorBox.classList.remove("visible");
        return true;
    } catch (error) {
        if (errorBox) { errorBox.textContent = "No se pudo conectar. Revisa tu conexión."; errorBox.classList.add("visible"); }
        return false;
    }
}

/* --- Etapa 1: subir CSD --- */

function renderEtapaCsdFacturacion() {
    const seccion = document.querySelector('#facturacionContenido [data-facturacion-etapa="1"]');
    if (!seccion) return;

    seccion.innerHTML = `
        <h3>Sube tu Certificado de Sello Digital</h3>
        <p class="facturacion-etapa-nota">Los mismos archivos que descargaste del portal del SAT (o que te dio tu contador).</p>

        <div class="facturacion-campos">
            <label class="col-2">
                <div class="facturacion-archivo" id="facturacionCajaCer">
                    <strong>Archivo .cer</strong>
                    <input type="file" id="facturacionCer" accept=".cer" onchange="onArchivoCsdFacturacion('cer')">
                </div>
            </label>
            <label class="col-2">
                <div class="facturacion-archivo" id="facturacionCajaKey">
                    <strong>Archivo .key</strong>
                    <input type="file" id="facturacionKey" accept=".key" onchange="onArchivoCsdFacturacion('key')">
                </div>
            </label>
            <label class="col-2"><span>Contraseña de la llave privada</span><input type="password" id="facturacionPassword" maxlength="100"></label>
        </div>

        <div class="facturacion-privacidad" style="max-width:none;margin-top:16px;">
            ${iconoUISVG("lock")}
            <span>Nexo nunca guarda tu llave privada ni tu contraseña -- viajan directo a Facturama y se descartan al terminar esta petición.</span>
        </div>

        <div class="facturacion-error-inline" id="facturacionErrorEtapa1"></div>
    `;
}

function onArchivoCsdFacturacion(tipo) {
    const input = document.getElementById(tipo === "cer" ? "facturacionCer" : "facturacionKey");
    const caja = document.getElementById(tipo === "cer" ? "facturacionCajaCer" : "facturacionCajaKey");
    const archivo = input?.files?.[0] || null;

    if (tipo === "cer") facturacionArchivoCer = archivo;
    else facturacionArchivoKey = archivo;

    if (caja) caja.classList.toggle("con-valor", Boolean(archivo));
}

async function subirCsdFacturacion() {
    const errorBox = document.getElementById("facturacionErrorEtapa1");
    const boton = document.getElementById("facturacionNavSiguiente");
    const password = document.getElementById("facturacionPassword")?.value || "";

    if (!facturacionArchivoCer || !facturacionArchivoKey) {
        if (errorBox) { errorBox.textContent = "Sube tanto el archivo .cer como el .key."; errorBox.classList.add("visible"); }
        return;
    }
    if (!password) {
        if (errorBox) { errorBox.textContent = "Falta la contraseña de la llave privada."; errorBox.classList.add("visible"); }
        return;
    }

    if (errorBox) errorBox.classList.remove("visible");
    if (boton) { boton.disabled = true; boton.textContent = "Verificando..."; }

    try {
        const form = new FormData();
        form.append("cer", facturacionArchivoCer);
        form.append("key", facturacionArchivoKey);
        form.append("password", password);

        const respuesta = await fetch("/facturacion/csd", { method: "POST", body: form });
        const datos = await respuesta.json();

        if (!datos.ok) {
            if (errorBox) { errorBox.textContent = datos.error || "No se pudo verificar tu certificado."; errorBox.classList.add("visible"); }
            return;
        }

        facturacionConfirmacion = datos;
        cambiarEtapaFacturacion(2);
    } catch (error) {
        if (errorBox) { errorBox.textContent = "No se pudo conectar. Revisa tu conexión."; errorBox.classList.add("visible"); }
    } finally {
        if (boton) { boton.disabled = false; boton.textContent = "Subir y verificar"; }
    }
}

/* --- Etapa 2: confirmacion --- */

function renderEtapaConfirmacionFacturacion() {
    const seccion = document.querySelector('#facturacionContenido [data-facturacion-etapa="2"]');
    if (!seccion || !facturacionConfirmacion) return;

    const vigencia = facturacionConfirmacion.vigenciaHasta ? new Date(facturacionConfirmacion.vigenciaHasta) : null;
    const vigenciaTexto = vigencia ? vigencia.toLocaleDateString("es-MX", { year: "numeric", month: "long", day: "numeric" }) : "--";

    seccion.innerHTML = `
        <div class="facturacion-confirmacion">
            <img src="img/nexo-ia/celebrando.jpg" alt="Nexo">
            <h3>¡Tu certificado quedó verificado!</h3>
            <p class="facturacion-etapa-nota">Esto es lo que Nexo pudo leer directo de tu certificado -- confirma que es el correcto.</p>
            <div class="facturacion-resumen-cert">
                <div class="facturacion-resumen-fila"><span>Número de serie</span><span>${escaparPOS(facturacionConfirmacion.numeroSerie || "--")}</span></div>
                <div class="facturacion-resumen-fila"><span>Vigente hasta</span><span>${escaparPOS(vigenciaTexto)}</span></div>
            </div>
            <button type="button" class="facturacion-hero-cta" onclick="finalizarWizardFacturacion()">Ir a Facturación</button>
        </div>
    `;

    const nav = document.querySelector(".facturacion-wizard-nav");
    if (nav) nav.style.display = "none";
}

function finalizarWizardFacturacion() {
    cargarEstadoFacturacion();
}

/* ---------- Estado: activa (tarjetas de trabajo) ---------- */

function renderFacturacionActiva() {
    const contenedor = document.getElementById("facturacionContenido");
    if (!contenedor) return;

    const datos = facturacionEstadoActual || {};
    const vigencia = datos.facturacion_certificado_vigencia_hasta ? new Date(datos.facturacion_certificado_vigencia_hasta) : null;

    let badgeClase = "ok";
    let badgeTexto = "Vigente";

    if (vigencia) {
        const diasRestantes = Math.floor((vigencia - new Date()) / (1000 * 60 * 60 * 24));
        if (diasRestantes < 0) { badgeClase = "vencido"; badgeTexto = "Vencido"; }
        else if (diasRestantes < 30) { badgeClase = "por-vencer"; badgeTexto = `Vence en ${diasRestantes} días`; }
    }

    contenedor.innerHTML = `
        <div class="facturacion-activa-grid">
            <div class="facturacion-tarjeta">
                <h3>Tu certificado</h3>
                <div class="facturacion-cert-fila"><span>RFC</span><span>${escaparPOS(datos.rfc || "--")}</span></div>
                <div class="facturacion-cert-fila"><span>Razón social</span><span>${escaparPOS(datos.razon_social || "--")}</span></div>
                <div class="facturacion-cert-fila"><span>Serie</span><span>${escaparPOS(datos.facturacion_certificado_numero || "--")}</span></div>
                <div class="facturacion-cert-fila"><span>Vigencia</span><span><span class="facturacion-badge-vigencia ${badgeClase}">${escaparPOS(badgeTexto)}</span></span></div>
                <button type="button" class="facturacion-btn-secundario" onclick="iniciarWizardFacturacion()">Actualizar certificado</button>
            </div>

            <div class="facturacion-tarjeta">
                <h3>Facturas emitidas</h3>
                <div class="facturacion-tabla-wrap" id="facturacionListaFacturas">
                    <p class="facturacion-vacio">Cargando...</p>
                </div>
            </div>
        </div>
    `;

    cargarFacturasFacturacion();
}

async function cargarFacturasFacturacion() {
    const contenedor = document.getElementById("facturacionListaFacturas");
    if (!contenedor) return;

    try {
        const respuesta = await fetch("/facturacion/facturas");
        const datos = await respuesta.json();

        if (!datos.ok || !Array.isArray(datos.facturas) || datos.facturas.length === 0) {
            contenedor.innerHTML = `<p class="facturacion-vacio">Aún no has generado ninguna factura.<br>Cuando factures una venta, aparecerá aquí.</p>`;
            return;
        }

        contenedor.innerHTML = `
            <table class="facturacion-tabla">
                <thead><tr><th>Folio</th><th>Receptor</th><th>Fecha</th><th>Total</th><th>Estado</th><th></th></tr></thead>
                <tbody>
                    ${datos.facturas.map(f => `
                        <tr>
                            <td>${escaparPOS((f.serie || "") + (f.folio || "--"))}</td>
                            <td>${escaparPOS(f.receptor_nombre || "--")}</td>
                            <td>${f.created_at ? new Date(f.created_at).toLocaleDateString("es-MX") : "--"}</td>
                            <td>$${Number(f.total || 0).toFixed(2)}</td>
                            <td><span class="facturacion-estado-pill ${escaparPOS(f.estado)}">${escaparPOS(f.estado)}</span></td>
                            <td>${f.estado === "timbrada" ? `<button type="button" class="facturacion-tabla-accion" onclick="verRepresentacionFactura(${f.id})" title="Ver / imprimir">${iconoUISVG("printer")}</button>` : ""}</td>
                        </tr>
                    `).join("")}
                </tbody>
            </table>
        `;
    } catch (error) {
        contenedor.innerHTML = `<p class="facturacion-vacio">No se pudieron cargar tus facturas.</p>`;
    }
}

/* ---------- Modal: generar factura desde el detalle de una venta ---------- */
/* Llamado desde el boton "Factura CFDI" en sales-history-documents.js. */

let facturacionVentaModalId = null;

async function abrirModalFacturarVenta(historialVentaId) {
    facturacionVentaModalId = historialVentaId;

    let modal = document.getElementById("modalFacturarVentaPOS");
    if (!modal) {
        modal = document.createElement("div");
        modal.id = "modalFacturarVentaPOS";
        modal.className = "modal-personalizado modal-facturar-venta-pos";
        document.body.appendChild(modal);
    }

    modal.innerHTML = `
        <div class="modal-card facturar-venta-card-pos">
            <div class="facturar-venta-header-pos">
                <h3>Factura CFDI</h3>
                <button type="button" class="detalle-boton-cerrar-pos" onclick="cerrarModalFacturarVenta()">Cerrar</button>
            </div>
            <div id="facturarVentaContenido"><p class="facturacion-vacio">Cargando...</p></div>
        </div>
    `;
    modal.style.display = "flex";

    try {
        const respuesta = await fetch(`/facturacion/venta/${historialVentaId}`);
        const datos = await respuesta.json();

        if (!datos.ok) {
            renderFacturarVentaError(datos.error || "No se pudo cargar la información de esta venta.");
            return;
        }

        if (datos.factura) {
            renderFacturarVentaExistente(datos.factura);
        } else if (datos.bloqueada) {
            renderFacturarVentaBloqueada(datos.bloqueada);
        } else {
            renderFacturarVentaFormulario(datos.receptorSugerido);
        }
    } catch (error) {
        renderFacturarVentaError("No se pudo conectar. Revisa tu conexión.");
    }
}

function cerrarModalFacturarVenta() {
    const modal = document.getElementById("modalFacturarVentaPOS");
    if (modal) modal.style.display = "none";
    facturacionVentaModalId = null;
}

function renderFacturarVentaError(mensaje) {
    const contenedor = document.getElementById("facturarVentaContenido");
    if (contenedor) contenedor.innerHTML = `<p class="facturacion-vacio">${escaparPOS(mensaje)}</p>`;
}

function renderFacturarVentaBloqueada(motivo) {
    const contenedor = document.getElementById("facturarVentaContenido");
    if (!contenedor) return;

    contenedor.innerHTML = `
        <div class="facturar-venta-bloqueada-pos">
            ${iconoUISVG("alert")}
            <p>${escaparPOS(motivo)}</p>
        </div>
    `;
}

function renderFacturarVentaExistente(factura) {
    const contenedor = document.getElementById("facturarVentaContenido");
    if (!contenedor) return;

    contenedor.innerHTML = `
        <div class="facturar-venta-exito-pos">
            ${iconoUISVG("check")}
            <p>Esta venta ya tiene una factura ${escaparPOS(factura.estado || "")}.</p>
            <div class="facturacion-resumen-cert">
                <div class="facturacion-resumen-fila"><span>Folio</span><span>${escaparPOS((factura.serie || "") + (factura.folio || "--"))}</span></div>
                <div class="facturacion-resumen-fila"><span>UUID</span><span style="font-size:11px;">${escaparPOS(factura.uuid || "--")}</span></div>
            </div>
            ${factura.estado === "timbrada" ? `
                <button type="button" class="facturacion-btn-secundario" onclick="verRepresentacionFactura(${factura.id})">Ver / imprimir</button>
                <a class="facturacion-btn-secundario" style="display:block;text-align:center;text-decoration:none;box-sizing:border-box;" href="/facturacion/${factura.id}/xml" target="_blank" rel="noopener">Descargar XML</a>
                <button type="button" class="facturacion-btn-secundario" onclick="reenviarCorreoFactura(${factura.id}, ${JSON.stringify(factura.receptor_correo || "")})">Reenviar por correo</button>
            ` : ""}
        </div>
    `;
}

function renderFacturarVentaFormulario(receptor) {
    const contenedor = document.getElementById("facturarVentaContenido");
    if (!contenedor) return;

    contenedor.innerHTML = `
        <p class="facturacion-etapa-nota">Verifica los datos del receptor antes de timbrar -- si algo no coincide con el SAT, Facturama rechaza el timbrado.</p>
        <div class="facturacion-campos">
            <label class="col-2"><span>RFC</span><input type="text" id="facturarRfc" maxlength="13" style="text-transform:uppercase;" value="${escaparPOS(receptor.rfc)}"></label>
            <label class="col-2"><span>Nombre / Razón social</span><input type="text" id="facturarNombre" maxlength="250" value="${escaparPOS(receptor.nombre)}"></label>
            <label>
                <span>Uso de CFDI</span>
                <select id="facturarUsoCfdi">
                    ${FACTURACION_USOS_CFDI.map(([clave, nombre]) => `<option value="${clave}" ${receptor.usoCfdi === clave ? "selected" : ""}>${clave} -- ${escaparPOS(nombre)}</option>`).join("")}
                </select>
            </label>
            <label>
                <span>Régimen fiscal</span>
                <select id="facturarRegimen">
                    <option value="">Selecciona...</option>
                    ${FACTURACION_REGIMENES.map(([clave, nombre]) => `<option value="${clave}" ${receptor.regimenFiscal === clave ? "selected" : ""}>${clave} -- ${escaparPOS(nombre)}</option>`).join("")}
                </select>
            </label>
            <label><span>Código postal</span><input type="text" id="facturarCP" maxlength="5" inputmode="numeric" value="${escaparPOS(receptor.codigoPostal)}"></label>
            <label class="col-2"><span>Correo (opcional, para reenviar la factura)</span><input type="email" id="facturarCorreo" maxlength="200" value="${escaparPOS(receptor.correo)}"></label>
        </div>
        <div class="facturacion-error-inline" id="facturarVentaError"></div>
        <button type="button" class="facturacion-hero-cta" id="facturarVentaBoton" style="width:100%;margin-top:16px;" onclick="timbrarVentaDesdeModal()">Timbrar factura</button>
    `;
}

async function timbrarVentaDesdeModal() {
    const boton = document.getElementById("facturarVentaBoton");
    const errorBox = document.getElementById("facturarVentaError");

    const cuerpo = {
        rfc: document.getElementById("facturarRfc")?.value.trim().toUpperCase() || "",
        nombre: document.getElementById("facturarNombre")?.value.trim() || "",
        usoCfdi: document.getElementById("facturarUsoCfdi")?.value || "",
        regimenFiscal: document.getElementById("facturarRegimen")?.value || "",
        codigoPostal: document.getElementById("facturarCP")?.value.trim() || "",
        correo: document.getElementById("facturarCorreo")?.value.trim() || ""
    };

    if (errorBox) errorBox.classList.remove("visible");
    if (boton) { boton.disabled = true; boton.textContent = "Timbrando..."; }

    try {
        const respuesta = await fetch(`/facturacion/generar/${facturacionVentaModalId}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(cuerpo)
        });
        const datos = await respuesta.json();

        if (!datos.ok) {
            if (errorBox) { errorBox.textContent = datos.error || "No se pudo timbrar la factura."; errorBox.classList.add("visible"); }
            return;
        }

        renderFacturarVentaExistente(datos.factura);
    } catch (error) {
        if (errorBox) { errorBox.textContent = "No se pudo conectar. Revisa tu conexión."; errorBox.classList.add("visible"); }
    } finally {
        if (boton) { boton.disabled = false; boton.textContent = "Timbrar factura"; }
    }
}

/* ---------- Representacion impresa + reenvio por correo ---------- */

async function verRepresentacionFactura(facturaId) {
    try {
        const respuesta = await fetch(`/facturacion/${facturaId}`);
        const datos = await respuesta.json();

        if (!datos.ok) {
            alertaPOS(datos.error || "No se pudo cargar la factura.", "Factura CFDI", "peligro");
            return;
        }

        imprimirRepresentacionFacturaPOS(construirRepresentacionFacturaHTML(datos));
    } catch (error) {
        alertaPOS("No se pudo conectar. Revisa tu conexión.", "Factura CFDI", "peligro");
    }
}

function construirRepresentacionFacturaHTML(datos) {
    const { factura, emisor, conceptos, qrDataUrl } = datos;
    const folioTexto = `${factura.serie || ""}${factura.folio || factura.id}`;
    const fechaTimbrado = factura.timbrada_at ? new Date(factura.timbrada_at).toLocaleString("es-MX") : "--";

    const filasConceptos = (conceptos || []).map(c => `
        <tr>
            <td>${escaparPOS(c.Quantity)}</td>
            <td>${escaparPOS(c.Description)}</td>
            <td class="num">$${Number(c.UnitPrice).toFixed(2)}</td>
            <td class="num">$${Number(c.Subtotal).toFixed(2)}</td>
        </tr>
    `).join("");

    return `
        <div class="factura-rep-doc">
            <div class="factura-rep-header">
                <div>
                    <h1>${escaparPOS(emisor.razon_social || "")}</h1>
                    <span>RFC: ${escaparPOS(emisor.rfc || "")} &middot; Régimen fiscal: ${escaparPOS(emisor.regimen_fiscal || "")}</span>
                </div>
                <div class="factura-rep-tipo">
                    <strong>FACTURA</strong>
                    <span>Folio: ${escaparPOS(folioTexto)}</span>
                    <span>Timbrado: ${escaparPOS(fechaTimbrado)}</span>
                </div>
            </div>

            <div class="factura-rep-receptor">
                <strong>Receptor</strong>
                <span>${escaparPOS(factura.receptor_nombre || "")} &middot; RFC: ${escaparPOS(factura.receptor_rfc || "")}</span>
                <span>Uso CFDI: ${escaparPOS(factura.receptor_uso_cfdi || "")} &middot; Régimen: ${escaparPOS(factura.receptor_regimen_fiscal || "")} &middot; CP: ${escaparPOS(factura.receptor_codigo_postal || "")}</span>
            </div>

            <table class="factura-rep-tabla">
                <thead><tr><th>Cant.</th><th>Descripción</th><th class="num">P. Unitario</th><th class="num">Importe</th></tr></thead>
                <tbody>${filasConceptos}</tbody>
            </table>

            <div class="factura-rep-totales">
                <div><span>Subtotal</span><strong>$${Number(factura.subtotal || 0).toFixed(2)}</strong></div>
                <div><span>IVA</span><strong>$${(Number(factura.total || 0) - Number(factura.subtotal || 0)).toFixed(2)}</strong></div>
                <div class="factura-rep-total-final"><span>Total</span><strong>$${Number(factura.total || 0).toFixed(2)}</strong></div>
            </div>

            <div class="factura-rep-timbre">
                <div class="factura-rep-timbre-datos">
                    <strong>Folio fiscal (UUID)</strong>
                    <span>${escaparPOS(factura.uuid || "--")}</span>
                    <p>Este documento es una representación impresa de un Comprobante Fiscal Digital por Internet (CFDI). El archivo XML timbrado es el documento con validez fiscal completa.</p>
                </div>
                ${qrDataUrl ? `<img src="${qrDataUrl}" alt="QR de verificación SAT">` : ""}
            </div>
        </div>
    `;
}

function imprimirRepresentacionFacturaPOS(contenidoHtml) {
    const html = `
        <html>
        <head>
        <title>Factura</title>
        <style>
            @page { size: letter; margin: 14mm; }
            * { box-sizing: border-box; }
            body { font-family: Arial, sans-serif; color: #101828; font-size: 12.5px; }
            .factura-rep-header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #101828; padding-bottom: 10px; margin-bottom: 14px; }
            .factura-rep-header h1 { margin: 0 0 4px; font-size: 18px; }
            .factura-rep-header span { display: block; font-size: 11.5px; color: #475467; }
            .factura-rep-tipo { text-align: right; }
            .factura-rep-tipo strong { display: block; font-size: 16px; letter-spacing: .04em; }
            .factura-rep-tipo span { display: block; font-size: 11.5px; color: #475467; }
            .factura-rep-receptor { margin-bottom: 16px; padding: 10px 12px; background: #f8fafc; border-radius: 8px; }
            .factura-rep-receptor strong { display: block; font-size: 11px; text-transform: uppercase; letter-spacing: .04em; color: #667085; margin-bottom: 4px; }
            .factura-rep-receptor span { display: block; font-size: 12.5px; }
            .factura-rep-tabla { width: 100%; border-collapse: collapse; margin-bottom: 16px; }
            .factura-rep-tabla th { text-align: left; font-size: 10.5px; text-transform: uppercase; color: #667085; border-bottom: 1px solid #d0d5dd; padding: 6px 8px; }
            .factura-rep-tabla td { padding: 7px 8px; border-bottom: 1px solid #eef2f7; font-size: 12px; }
            .factura-rep-tabla .num { text-align: right; }
            .factura-rep-totales { width: 260px; margin-left: auto; margin-bottom: 20px; }
            .factura-rep-totales div { display: flex; justify-content: space-between; padding: 4px 0; font-size: 12.5px; }
            .factura-rep-total-final { border-top: 1px solid #101828; margin-top: 4px; padding-top: 6px !important; font-size: 14px !important; font-weight: 700; }
            .factura-rep-timbre { display: flex; justify-content: space-between; align-items: center; gap: 16px; padding-top: 14px; border-top: 1px dashed #d0d5dd; }
            .factura-rep-timbre-datos strong { display: block; font-size: 11px; text-transform: uppercase; color: #667085; margin-bottom: 2px; }
            .factura-rep-timbre-datos span { display: block; font-size: 11px; font-family: ui-monospace, monospace; margin-bottom: 8px; }
            .factura-rep-timbre-datos p { margin: 0; font-size: 9.5px; color: #667085; line-height: 1.5; max-width: 420px; }
            .factura-rep-timbre img { width: 90px; height: 90px; flex-shrink: 0; }
        </style>
        </head>
        <body>${contenidoHtml}</body>
        </html>
    `;

    const iframe = document.createElement("iframe");
    iframe.title = "Factura";
    iframe.style.position = "fixed";
    iframe.style.right = "0";
    iframe.style.bottom = "0";
    iframe.style.width = "0";
    iframe.style.height = "0";
    iframe.style.border = "0";
    iframe.style.opacity = "0";

    document.body.appendChild(iframe);

    const documento = iframe.contentWindow.document;
    documento.open();
    documento.write(html);
    documento.close();

    setTimeout(() => {
        iframe.contentWindow.focus();
        iframe.contentWindow.print();
        setTimeout(() => iframe.remove(), 1200);
    }, 180);
}

async function reenviarCorreoFactura(facturaId, correoSugerido) {
    const correo = prompt("¿A qué correo se reenvía la factura?", correoSugerido || "");
    if (!correo) return;

    try {
        const respuesta = await fetch(`/facturacion/${facturaId}/reenviar-correo`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ correo })
        });
        const datos = await respuesta.json();

        if (!datos.ok) {
            alertaPOS(datos.error || "No se pudo reenviar la factura.", "Factura CFDI", "peligro");
            return;
        }

        alertaPOS(`Factura enviada a ${correo}.`, "Factura CFDI", "exito");
    } catch (error) {
        alertaPOS("No se pudo conectar. Revisa tu conexión.", "Factura CFDI", "peligro");
    }
}
