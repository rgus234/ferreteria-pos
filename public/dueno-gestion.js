// Fase 4 del plan "celular como plan B": administrar el negocio desde el
// telefono -- empleados, finanzas (gastos y cuentas por pagar) y encargos.
// Todo usa las MISMAS rutas que ya usa la computadora; aqui no hay logica
// de negocio nueva, solo pantallas. Se pintan dentro de la subpantalla de
// "Mas" (duenoMasSubpantallaContenido) con un "Volver" propio.

const GESTION_MODULOS_SISTEMA = [
    { clave: "inicio", nombre: "Inicio / Dashboard" },
    { clave: "puntoVenta", nombre: "Punto de venta" },
    { clave: "inventario", nombre: "Inventario" },
    { clave: "inventarioBajo", nombre: "Inventario bajo" },
    { clave: "reportes", nombre: "Reportes / Ventas" },
    { clave: "clientes", nombre: "Clientes" },
    { clave: "proveedores", nombre: "Proveedores" },
    { clave: "catalogo", nombre: "Catalogo proveedor" },
    { clave: "recepcion", nombre: "Recepcion" },
    { clave: "caja", nombre: "Caja" },
    { clave: "finanzas", nombre: "Finanzas" },
    { clave: "pedidos", nombre: "Pedidos" },
    { clave: "ajustes", nombre: "Ajustes" },
    { clave: "dueno", nombre: "App dueno" },
    { clave: "configuracion", nombre: "Configuracion" }
];

const GESTION_WIDGETS = ["productos", "inventarioBajo", "ventas", "credito", "alertas", "ultimasVentas"];

// Mismas plantillas por rol que public/js/config-auth.js (plantillaUsuario):
// un empleado nuevo creado desde el celular queda igual que uno creado en
// la computadora.
function plantillaRolGestion(rol) {
    const todos = valor => Object.fromEntries(GESTION_MODULOS_SISTEMA.map(m => [m.clave, valor]));
    const widgets = valor => Object.fromEntries(GESTION_WIDGETS.map(w => [w, valor]));

    if (rol === "Cajero") {
        return {
            permisos: { ...todos(false), inicio: true, puntoVenta: true, inventarioBajo: true, clientes: true },
            widgets: { ...widgets(false), ventas: true, credito: true, ultimasVentas: true }
        };
    }

    if (rol === "Inventario") {
        return {
            permisos: { ...todos(false), inicio: true, inventario: true, inventarioBajo: true, proveedores: true, catalogo: true },
            widgets: { ...widgets(false), productos: true, inventarioBajo: true, alertas: true }
        };
    }

    return { permisos: todos(true), widgets: widgets(true) };
}

// Lo que un empleado con su propia cuenta Nexo puede hacer desde /dueno
// (rbac.js PERMISOS.*, mismas etiquetas que la computadora).
const GESTION_PERMISOS_NEXO = [
    { clave: "hacer_ventas", nombre: "Cobrar ventas" },
    { clave: "hacer_corte", nombre: "Abrir y cerrar caja" },
    { clave: "ver_pedidos", nombre: "Ver pedidos de Nexo Market" },
    { clave: "gestionar_pedidos", nombre: "Gestionar pedidos de Nexo Market" },
    { clave: "ver_inventario", nombre: "Ver inventario" },
    { clave: "modificar_inventario", nombre: "Modificar inventario" },
    { clave: "ver_reportes", nombre: "Ver reportes" },
    { clave: "administrar_usuarios", nombre: "Administrar empleados (otorgalo con cuidado)" },
    { clave: "ver_credito", nombre: "Ver creditos" },
    { clave: "gestionar_credito", nombre: "Gestionar creditos" },
    { clave: "registrar_abonos_credito", nombre: "Registrar abonos de credito" },
    { clave: "aprobar_solicitudes_credito", nombre: "Aprobar solicitudes de credito (ve la identificacion)" }
];

const GESTION_DIAS = [
    { clave: "lunes", nombre: "Lunes" },
    { clave: "martes", nombre: "Martes" },
    { clave: "miercoles", nombre: "Miercoles" },
    { clave: "jueves", nombre: "Jueves" },
    { clave: "viernes", nombre: "Viernes" },
    { clave: "sabado", nombre: "Sabado" },
    { clave: "domingo", nombre: "Domingo" }
];

function contenidoGestion() {
    return document.getElementById("duenoMasSubpantallaContenido");
}

function cargandoGestion(texto = "Cargando...") {
    contenidoGestion().innerHTML = `<p class="dueno-estado">${escaparDueno(texto)}</p>`;
}

function falloGestion(error, reintentar) {
    contenidoGestion().innerHTML = `
        <div class="vacio">${escaparDueno(error?.message || "No se pudo cargar.")}</div>
        ${reintentar ? `<button type="button" class="dueno-link" onclick="${reintentar}">Reintentar</button>` : ""}
    `;
}

function errorFormularioGestion(mensaje) {
    const caja = document.getElementById("duenoGestionError");
    if (!caja) return;
    caja.textContent = mensaje || "";
    caja.style.display = mensaje ? "block" : "none";
}

function botonVolverGestion(alHacerClic, texto = "Volver") {
    return `<button type="button" class="dueno-link" style="margin-bottom:10px;" onclick="${alHacerClic}">&lsaquo; ${escaparDueno(texto)}</button>`;
}

function textoNumeroGestion(id) {
    return Number(document.getElementById(id)?.value || 0);
}

function valorGestion(id) {
    return String(document.getElementById(id)?.value || "").trim();
}

// ======================================================================
// EMPLEADOS
// ======================================================================

let duenoGestionEmpleados = [];

function puedeAdministrarEmpleadosGestion() {
    return duenoTienePermiso("administrar_usuarios");
}

function avatarEmpleadoGestion(empleado, tamano = 44) {
    if (empleado.fotoUrl) {
        return `<img src="${escaparDueno(empleado.fotoUrl)}" alt="" style="width:${tamano}px;height:${tamano}px;border-radius:50%;object-fit:cover;flex:none;">`;
    }

    const iniciales = String(empleado.nombre || "?").split(/\s+/).filter(Boolean).slice(0, 2).map(p => p[0]).join("").toUpperCase();

    return `<span style="width:${tamano}px;height:${tamano}px;border-radius:50%;background:${escaparDueno(empleado.colorAvatar || "#2563ff")};color:#fff;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:${Math.round(tamano / 2.6)}px;flex:none;">${escaparDueno(iniciales)}</span>`;
}

async function renderSubpantallaEmpleadosGestion() {
    cargandoGestion();

    try {
        const datos = await fetchAutenticado("/cuenta/empleados");
        duenoGestionEmpleados = datos.empleados || [];
        pintarListaEmpleadosGestion();
    } catch (error) {
        falloGestion(error, "renderSubpantallaEmpleadosGestion()");
    }
}

function pintarListaEmpleadosGestion() {
    const activos = duenoGestionEmpleados.filter(e => e.activo);
    const inactivos = duenoGestionEmpleados.filter(e => !e.activo);

    const fila = empleado => `
        <button type="button" class="fila-dueno" style="width:100%;text-align:left;gap:12px;align-items:center;" onclick="abrirEmpleadoGestion(${Number(empleado.id)})">
            ${avatarEmpleadoGestion(empleado)}
            <div style="flex:1;min-width:0;">
                <strong>${escaparDueno(empleado.nombre)}</strong>
                <span>${escaparDueno(empleado.rol)}${empleado.vinculadoNexo ? " · Con cuenta Nexo" : ""}</span>
            </div>
            ${empleado.activo ? "" : `<span class="dueno-pill dueno-pill-limitado">Baja</span>`}
        </button>
    `;

    contenidoGestion().innerHTML = `
        <article class="dueno-card">
            <div class="card-head">
                <div>
                    <span>Tu equipo</span>
                    <h2>${activos.length} empleado${activos.length === 1 ? "" : "s"}</h2>
                </div>
            </div>
            <button type="button" class="dueno-boton-primario" onclick="abrirNuevoEmpleadoGestion()">Agregar empleado</button>
            <div class="lista-compacta" style="margin-top:12px;">
                ${activos.length ? activos.map(fila).join("") : `<div class="vacio">Todavia no hay empleados.</div>`}
            </div>
            ${inactivos.length ? `
                <p class="dueno-estado" style="margin-top:14px;">Dados de baja</p>
                <div class="lista-compacta">${inactivos.map(fila).join("")}</div>
            ` : ""}
        </article>
    `;
}

function abrirNuevoEmpleadoGestion() {
    contenidoGestion().innerHTML = `
        ${botonVolverGestion("pintarListaEmpleadosGestion()")}
        <article class="dueno-card">
            <div class="card-head"><div><span>Empleado nuevo</span><h2>Datos basicos</h2></div></div>
            <label class="dueno-campo">Nombre
                <input type="text" id="duenoGestionNombre" autocomplete="off" placeholder="Ej. Luis">
            </label>
            <label class="dueno-campo">Rol
                <select id="duenoGestionRol">
                    <option value="Cajero">Cajero</option>
                    <option value="Inventario">Inventario</option>
                    <option value="Administrador">Administrador</option>
                </select>
            </label>
            <label class="dueno-campo">PIN (4 a 6 numeros)
                <input type="password" id="duenoGestionPin" inputmode="numeric" maxlength="6" autocomplete="new-password" placeholder="••••">
            </label>
            <p class="dueno-estado">El rol decide que pantallas ve. Despues puedes ajustar permisos, horario y foto.</p>
            <p id="duenoGestionError" class="dueno-login-error" style="display:none;"></p>
            <button type="button" class="dueno-boton-primario" id="btnGestionGuardar" onclick="guardarNuevoEmpleadoGestion()">Crear empleado</button>
        </article>
    `;
}

async function guardarNuevoEmpleadoGestion() {
    const nombre = valorGestion("duenoGestionNombre");
    const rol = valorGestion("duenoGestionRol") || "Cajero";
    const pin = valorGestion("duenoGestionPin");

    if (!nombre) return errorFormularioGestion("Escribe el nombre del empleado.");
    if (!/^[0-9]{4,6}$/.test(pin)) return errorFormularioGestion("El PIN debe tener entre 4 y 6 numeros.");

    const boton = document.getElementById("btnGestionGuardar");
    boton.disabled = true;
    errorFormularioGestion("");

    try {
        const plantilla = plantillaRolGestion(rol);
        const respuesta = await fetchAutenticado("/cuenta/empleados", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ nombre, rol, pin, permisos: plantilla.permisos, widgets: plantilla.widgets })
        });

        mostrarToastDueno("Empleado creado.");
        await renderSubpantallaEmpleadosGestion();
        abrirEmpleadoGestion(respuesta.empleado.id);
    } catch (error) {
        boton.disabled = false;
        errorFormularioGestion(error.message || "No se pudo crear el empleado.");
    }
}

function empleadoGestionPorId(id) {
    return duenoGestionEmpleados.find(e => Number(e.id) === Number(id));
}

function abrirEmpleadoGestion(id) {
    const empleado = empleadoGestionPorId(id);
    if (!empleado) return;

    contenidoGestion().innerHTML = `
        ${botonVolverGestion("pintarListaEmpleadosGestion()", "Empleados")}
        <article class="dueno-card">
            <div style="display:flex;align-items:center;gap:14px;">
                ${avatarEmpleadoGestion(empleado, 64)}
                <div>
                    <h2 style="margin:0;">${escaparDueno(empleado.nombre)}</h2>
                    <span class="dueno-estado">${escaparDueno(empleado.rol)}${empleado.activo ? "" : " · Dado de baja"}</span>
                </div>
            </div>
            <div style="display:flex;gap:8px;margin-top:12px;flex-wrap:wrap;">
                <button type="button" class="dueno-boton-secundario-chico" onclick="cambiarFotoEmpleadoGestion(${Number(empleado.id)})">${empleado.fotoUrl ? "Cambiar foto" : "Poner foto"}</button>
                ${empleado.fotoUrl ? `<button type="button" class="dueno-boton-secundario-chico" onclick="quitarFotoEmpleadoGestion(${Number(empleado.id)})">Quitar foto</button>` : ""}
            </div>
        </article>

        <article class="dueno-card">
            <div class="card-head"><div><span>Seguridad</span><h2>Cambiar PIN</h2></div></div>
            <label class="dueno-campo">PIN nuevo (4 a 6 numeros)
                <input type="password" id="duenoGestionPin" inputmode="numeric" maxlength="6" autocomplete="new-password" placeholder="••••">
            </label>
            <p id="duenoGestionError" class="dueno-login-error" style="display:none;"></p>
            <button type="button" class="dueno-boton-secundario" onclick="guardarPinEmpleadoGestion(${Number(empleado.id)})">Guardar PIN</button>
        </article>

        <button type="button" class="dueno-categoria-row" onclick="abrirPermisosEmpleadoGestion(${Number(empleado.id)})">
            <span class="dueno-categoria-texto"><strong>Rol y permisos</strong><span>Que pantallas puede usar en la computadora</span></span>
            <span class="dueno-categoria-flecha">${iconoCategoriaMasDueno("flecha")}</span>
        </button>
        <button type="button" class="dueno-categoria-row" onclick="abrirHorarioEmpleadoGestion(${Number(empleado.id)})">
            <span class="dueno-categoria-texto"><strong>Horario laboral</strong><span>${empleado.horarioLaboral ? "Con horario" : "Sin horario"}</span></span>
            <span class="dueno-categoria-flecha">${iconoCategoriaMasDueno("flecha")}</span>
        </button>
        <button type="button" class="dueno-categoria-row" onclick="abrirAccesoNexoEmpleadoGestion(${Number(empleado.id)})">
            <span class="dueno-categoria-texto"><strong>Acceso desde su celular</strong><span>${empleado.vinculadoNexo ? "Cuenta Nexo vinculada" : "Todavia sin vincular"}</span></span>
            <span class="dueno-categoria-flecha">${iconoCategoriaMasDueno("flecha")}</span>
        </button>

        <article class="dueno-card">
            ${empleado.activo
                ? `<p class="dueno-estado">Si dejas de trabajar con esta persona, dala de baja: ya no podra entrar con su PIN. Sus ventas anteriores se conservan.</p>
                   <button type="button" class="dueno-boton-secundario" style="color:var(--red);" onclick="darDeBajaEmpleadoGestion(${Number(empleado.id)})">Dar de baja</button>`
                : `<button type="button" class="dueno-boton-secundario" onclick="reactivarEmpleadoGestion(${Number(empleado.id)})">Volver a dar de alta</button>`}
        </article>
    `;
}

// Despues de cualquier cambio se vuelve a pedir la lista completa: la
// respuesta de PUT/POST trae solo ese empleado y el vinculo Nexo viene de
// otra tabla, asi la pantalla nunca muestra algo a medias.
async function recargarEmpleadosGestion() {
    const datos = await fetchAutenticado("/cuenta/empleados");
    duenoGestionEmpleados = datos.empleados || [];
}

async function actualizarEmpleadoGestion(id, cuerpo, mensaje) {
    await fetchAutenticado(`/cuenta/empleados/${Number(id)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(cuerpo)
    });

    await recargarEmpleadosGestion();
    if (mensaje) mostrarToastDueno(mensaje);
}

async function guardarPinEmpleadoGestion(id) {
    const pin = valorGestion("duenoGestionPin");

    if (!/^[0-9]{4,6}$/.test(pin)) return errorFormularioGestion("El PIN debe tener entre 4 y 6 numeros.");

    try {
        errorFormularioGestion("");
        await actualizarEmpleadoGestion(id, { pin }, "PIN cambiado.");
        abrirEmpleadoGestion(id);
    } catch (error) {
        errorFormularioGestion(error.message || "No se pudo cambiar el PIN.");
    }
}

async function darDeBajaEmpleadoGestion(id) {
    const empleado = empleadoGestionPorId(id);
    if (!empleado) return;
    if (!confirm(`¿Dar de baja a ${empleado.nombre}? Ya no podra entrar con su PIN.`)) return;

    try {
        await fetchAutenticado(`/cuenta/empleados/${Number(id)}`, { method: "DELETE" });
        await recargarEmpleadosGestion();
        mostrarToastDueno("Empleado dado de baja.");
        pintarListaEmpleadosGestion();
    } catch (error) {
        mostrarToastDueno(error.message || "No se pudo dar de baja.");
    }
}

async function reactivarEmpleadoGestion(id) {
    try {
        await actualizarEmpleadoGestion(id, { activo: true }, "Empleado dado de alta otra vez.");
        abrirEmpleadoGestion(id);
    } catch (error) {
        mostrarToastDueno(error.message || "No se pudo reactivar.");
    }
}

// ---------------- foto ----------------

function cambiarFotoEmpleadoGestion(id) {
    let input = document.getElementById("duenoFotoEmpleadoInput");

    if (!input) {
        input = document.createElement("input");
        input.type = "file";
        input.id = "duenoFotoEmpleadoInput";
        input.accept = "image/*";
        input.hidden = true;
        document.body.appendChild(input);
    }

    input.value = "";
    input.onchange = () => {
        const archivo = input.files?.[0];
        if (archivo) subirFotoEmpleadoGestion(id, archivo);
    };
    input.click();
}

async function subirFotoEmpleadoGestion(id, archivo) {
    try {
        mostrarToastDueno("Subiendo foto...");
        const imagenBase64 = await redimensionarImagenCanvasDueno(archivo, 480);

        await fetchAutenticado(`/cuenta/empleados/${Number(id)}/foto`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ imagenBase64 })
        });

        await recargarEmpleadosGestion();
        mostrarToastDueno("Foto guardada.");
        abrirEmpleadoGestion(id);
    } catch (error) {
        mostrarToastDueno(error.message || "No se pudo subir la foto.");
    }
}

async function quitarFotoEmpleadoGestion(id) {
    try {
        await fetchAutenticado(`/cuenta/empleados/${Number(id)}/foto`, { method: "DELETE" });
        await recargarEmpleadosGestion();
        abrirEmpleadoGestion(id);
    } catch (error) {
        mostrarToastDueno(error.message || "No se pudo quitar la foto.");
    }
}

// ---------------- rol y permisos de pantalla (computadora) ----------------

function abrirPermisosEmpleadoGestion(id) {
    const empleado = empleadoGestionPorId(id);
    if (!empleado) return;

    const esAdmin = empleado.rol === "Administrador";

    contenidoGestion().innerHTML = `
        ${botonVolverGestion(`abrirEmpleadoGestion(${Number(id)})`, empleado.nombre)}
        <article class="dueno-card">
            <div class="card-head"><div><span>${escaparDueno(empleado.nombre)}</span><h2>Rol y pantallas</h2></div></div>
            <label class="dueno-campo">Rol
                <select id="duenoGestionRol" onchange="aplicarPlantillaRolGestion()">
                    ${["Cajero", "Inventario", "Administrador"].map(rol => `<option value="${rol}" ${empleado.rol === rol ? "selected" : ""}>${rol}</option>`).join("")}
                </select>
            </label>
            <p class="dueno-estado">Al cambiar el rol se marcan las pantallas tipicas de ese rol. Puedes ajustarlas antes de guardar.</p>
            <div id="duenoGestionModulos">
                ${GESTION_MODULOS_SISTEMA.map(modulo => `
                    <label class="dueno-campo" style="display:flex;align-items:center;gap:10px;flex-direction:row;">
                        <input type="checkbox" data-modulo="${modulo.clave}" style="width:auto;" ${esAdmin || empleado.permisos?.[modulo.clave] !== false ? "checked" : ""}>
                        <span>${escaparDueno(modulo.nombre)}</span>
                    </label>
                `).join("")}
            </div>
            <p id="duenoGestionError" class="dueno-login-error" style="display:none;"></p>
            <button type="button" class="dueno-boton-primario" onclick="guardarPermisosEmpleadoGestion(${Number(id)})">Guardar</button>
        </article>
    `;

    duenoGestionRolOriginal = empleado.rol;
}

let duenoGestionRolOriginal = "";

function aplicarPlantillaRolGestion() {
    const rol = valorGestion("duenoGestionRol");
    const plantilla = plantillaRolGestion(rol);

    document.querySelectorAll("#duenoGestionModulos input[data-modulo]").forEach(input => {
        input.checked = rol === "Administrador" || plantilla.permisos[input.dataset.modulo] === true;
    });
}

async function guardarPermisosEmpleadoGestion(id) {
    const rol = valorGestion("duenoGestionRol");
    const permisos = {};

    document.querySelectorAll("#duenoGestionModulos input[data-modulo]").forEach(input => {
        permisos[input.dataset.modulo] = input.checked;
    });

    const cuerpo = { rol, permisos };

    // Igual que en la computadora: cambiar de rol tambien reinicia las
    // tarjetas del inicio a las de ese rol.
    if (rol !== duenoGestionRolOriginal) cuerpo.widgets = plantillaRolGestion(rol).widgets;

    try {
        errorFormularioGestion("");
        await actualizarEmpleadoGestion(id, cuerpo, "Permisos guardados.");
        abrirEmpleadoGestion(id);
    } catch (error) {
        errorFormularioGestion(error.message || "No se pudieron guardar los permisos.");
    }
}

// ---------------- horario laboral ----------------

function abrirHorarioEmpleadoGestion(id) {
    const empleado = empleadoGestionPorId(id);
    if (!empleado) return;

    const horario = empleado.horarioLaboral || {};

    contenidoGestion().innerHTML = `
        ${botonVolverGestion(`abrirEmpleadoGestion(${Number(id)})`, empleado.nombre)}
        <article class="dueno-card">
            <div class="card-head"><div><span>${escaparDueno(empleado.nombre)}</span><h2>Horario laboral</h2></div></div>
            <p class="dueno-estado">A la hora de salida, si su caja sigue abierta, no podra cobrar mas hasta cerrarla (o hasta que un administrador lo autorice con su PIN).</p>
            ${GESTION_DIAS.map(dia => {
                const deDia = horario[dia.clave];
                return `
                    <div class="fila-dueno" style="gap:8px;align-items:center;flex-wrap:wrap;">
                        <label style="display:flex;align-items:center;gap:8px;min-width:110px;">
                            <input type="checkbox" data-dia="${dia.clave}" style="width:auto;" ${deDia ? "checked" : ""} onchange="this.closest('.fila-dueno').querySelectorAll('input[type=time]').forEach(t => t.disabled = !this.checked)">
                            <strong>${dia.nombre}</strong>
                        </label>
                        <input type="time" data-dia-inicio="${dia.clave}" value="${escaparDueno(deDia?.inicio || "09:00")}" ${deDia ? "" : "disabled"} style="width:auto;">
                        <span>a</span>
                        <input type="time" data-dia-fin="${dia.clave}" value="${escaparDueno(deDia?.fin || "18:00")}" ${deDia ? "" : "disabled"} style="width:auto;">
                    </div>
                `;
            }).join("")}
            <p id="duenoGestionError" class="dueno-login-error" style="display:none;"></p>
            <button type="button" class="dueno-boton-primario" style="margin-top:10px;" onclick="guardarHorarioEmpleadoGestion(${Number(id)})">Guardar horario</button>
            ${empleado.horarioLaboral ? `<button type="button" class="dueno-link" style="display:block;margin:10px auto 0;" onclick="quitarHorarioEmpleadoGestion(${Number(id)})">Quitar horario</button>` : ""}
        </article>
    `;
}

async function guardarHorarioEmpleadoGestion(id) {
    const horario = {};

    for (const dia of GESTION_DIAS) {
        const trabaja = document.querySelector(`input[data-dia="${dia.clave}"]`)?.checked;
        const inicio = document.querySelector(`input[data-dia-inicio="${dia.clave}"]`)?.value;
        const fin = document.querySelector(`input[data-dia-fin="${dia.clave}"]`)?.value;

        if (trabaja && (!inicio || !fin || inicio >= fin)) {
            return errorFormularioGestion(`${dia.nombre}: la hora de salida debe ser despues de la de entrada.`);
        }

        horario[dia.clave] = trabaja ? { inicio, fin } : null;
    }

    try {
        errorFormularioGestion("");
        await actualizarEmpleadoGestion(id, { horarioLaboral: horario }, "Horario guardado.");
        abrirEmpleadoGestion(id);
    } catch (error) {
        errorFormularioGestion(error.message || "No se pudo guardar el horario.");
    }
}

async function quitarHorarioEmpleadoGestion(id) {
    try {
        await actualizarEmpleadoGestion(id, { horarioLaboral: null }, "Horario quitado.");
        abrirEmpleadoGestion(id);
    } catch (error) {
        mostrarToastDueno(error.message || "No se pudo quitar el horario.");
    }
}

// ---------------- acceso desde su propio celular (cuenta Nexo) ----------------

function abrirAccesoNexoEmpleadoGestion(id, codigoNuevo = "") {
    const empleado = empleadoGestionPorId(id);
    if (!empleado) return;

    const bloqueCodigo = codigoNuevo ? `
        <div class="dueno-status-card" style="margin-bottom:12px;">
            <p class="dueno-estado">Codigo de vinculacion (se muestra una sola vez)</p>
            <h2 style="letter-spacing:3px;">${escaparDueno(codigoNuevo)}</h2>
            <p class="dueno-estado">Dale este codigo a ${escaparDueno(empleado.nombre)}: lo escribe en su Nexo para unir su cuenta a este negocio.</p>
        </div>
    ` : "";

    contenidoGestion().innerHTML = `
        ${botonVolverGestion(`abrirEmpleadoGestion(${Number(id)})`, empleado.nombre)}
        <article class="dueno-card">
            <div class="card-head"><div><span>${escaparDueno(empleado.nombre)}</span><h2>Su propio celular</h2></div></div>
            ${bloqueCodigo}
            ${empleado.vinculadoNexo ? `
                <p class="dueno-estado">Cuenta Nexo vinculada. Elige que puede hacer desde su celular.</p>
                ${GESTION_PERMISOS_NEXO.map(permiso => `
                    <label class="dueno-campo" style="display:flex;align-items:center;gap:10px;flex-direction:row;">
                        <input type="checkbox" data-permiso-nexo="${permiso.clave}" style="width:auto;" ${empleado.permisosNexo?.[permiso.clave] === true ? "checked" : ""}>
                        <span>${escaparDueno(permiso.nombre)}</span>
                    </label>
                `).join("")}
                <p id="duenoGestionError" class="dueno-login-error" style="display:none;"></p>
                <button type="button" class="dueno-boton-primario" onclick="guardarPermisosNexoEmpleadoGestion(${Number(id)})">Guardar accesos</button>
            ` : `
                <p class="dueno-estado">Todavia no vincula su cuenta Nexo. Genera un codigo de un solo uso y dáselo (de palabra, por WhatsApp o impreso). Generar otro anula el anterior.</p>
                <p id="duenoGestionError" class="dueno-login-error" style="display:none;"></p>
                <button type="button" class="dueno-boton-secundario" onclick="generarCodigoVinculoEmpleadoGestion(${Number(id)})">Generar codigo de vinculacion</button>
            `}
        </article>
    `;
}

async function generarCodigoVinculoEmpleadoGestion(id) {
    try {
        const respuesta = await fetchAutenticado(`/cuenta/empleados/${Number(id)}/generar-codigo-vinculo`, { method: "POST" });
        abrirAccesoNexoEmpleadoGestion(id, respuesta.codigo);
    } catch (error) {
        errorFormularioGestion(error.message || "No se pudo generar el codigo.");
    }
}

async function guardarPermisosNexoEmpleadoGestion(id) {
    const permisos = {};

    document.querySelectorAll("input[data-permiso-nexo]").forEach(input => {
        permisos[input.dataset.permisoNexo] = input.checked;
    });

    try {
        errorFormularioGestion("");
        await fetchAutenticado(`/cuenta/empleados/${Number(id)}/permisos-nexo`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ permisos })
        });

        await recargarEmpleadosGestion();
        mostrarToastDueno("Accesos guardados.");
        abrirAccesoNexoEmpleadoGestion(id);
    } catch (error) {
        errorFormularioGestion(error.message || "No se pudieron guardar los accesos.");
    }
}

// ======================================================================
// FINANZAS (plan Pro): resumen, gastos y cuentas por pagar
// ======================================================================

let duenoGestionPeriodo = "mes";

function puedeVerFinanzasGestion() {
    return duenoTienePermiso("ver_reportes");
}

async function renderSubpantallaFinanzasGestion() {
    cargandoGestion();

    try {
        const estado = await fetchAutenticado("/finanzas/estado");

        if (!estado.disponibleEnPlan) {
            contenidoGestion().innerHTML = `
                <article class="dueno-card">
                    <div class="card-head"><div><span>Finanzas</span><h2>Parte del plan Pro</h2></div></div>
                    <p class="dueno-estado">Con el plan Pro ves tu utilidad, registras gastos y llevas las cuentas por pagar a proveedores. Puedes mejorar tu plan desde Mas &rsaquo; Plan y suscripcion.</p>
                </article>
            `;
            return;
        }

        await pintarFinanzasGestion();
    } catch (error) {
        falloGestion(error, "renderSubpantallaFinanzasGestion()");
    }
}

async function cambiarPeriodoFinanzasGestion(periodo) {
    duenoGestionPeriodo = periodo;
    cargandoGestion();

    try {
        await pintarFinanzasGestion();
    } catch (error) {
        falloGestion(error, "renderSubpantallaFinanzasGestion()");
    }
}

let duenoGestionRenderFinanzas = 0;

async function pintarFinanzasGestion() {
    // Si se pide la pantalla otra vez mientras la anterior sigue cargando (o
    // se salio de ella), la respuesta vieja no debe pisar a la nueva.
    const turno = ++duenoGestionRenderFinanzas;

    const [resumen, gastos] = await Promise.all([
        fetchAutenticado(`/finanzas/resumen?periodo=${encodeURIComponent(duenoGestionPeriodo)}`),
        fetchAutenticado("/gastos-operativos")
    ]);

    if (turno !== duenoGestionRenderFinanzas) return;

    const periodos = [["dia", "Hoy"], ["semana", "Semana"], ["mes", "Mes"], ["anio", "Año"]];
    const cobertura = Number(resumen.cobertura_costo || 0);

    contenidoGestion().innerHTML = `
        <div class="dueno-chips-periodo">
            ${periodos.map(([clave, etiqueta]) => `<button type="button" class="dueno-chip-periodo ${duenoGestionPeriodo === clave ? "activo" : ""}" onclick="cambiarPeriodoFinanzasGestion('${clave}')">${etiqueta}</button>`).join("")}
        </div>

        <article class="dueno-card">
            <div class="dueno-datos-grid">
                <div><span>Ventas</span><strong>${dinero(resumen.ingresos)}</strong></div>
                <div><span>Gastos</span><strong>${dinero(resumen.gastos_mes)}</strong></div>
                <div><span>Ventas menos gastos</span><strong>${dinero(resumen.utilidad_neta)}</strong></div>
                <div><span>Te deben (creditos)</span><strong>${dinero(resumen.cuentas_por_cobrar)}</strong></div>
                <div><span>Debes a proveedores</span><strong>${dinero(resumen.por_pagar)}</strong></div>
                ${cobertura > 0 ? `<div><span>Utilidad real</span><strong>${dinero(resumen.utilidad_neta_real)}</strong></div>` : ""}
            </div>
            ${cobertura > 0 && cobertura < 0.95 ? `<p class="dueno-estado" style="margin-top:8px;">La utilidad real solo cuenta las ventas que ya traen costo (${Math.round(cobertura * 100)}% de las lineas del periodo).</p>` : ""}
            ${Number(resumen.vencidas || 0) > 0 ? `<p class="dueno-estado" style="margin-top:8px;color:var(--red);">${Number(resumen.vencidas)} cuenta${Number(resumen.vencidas) === 1 ? "" : "s"} por pagar vencida${Number(resumen.vencidas) === 1 ? "" : "s"}.</p>` : ""}
        </article>

        <div style="display:flex;gap:8px;margin-bottom:12px;">
            <button type="button" class="dueno-boton-primario" onclick="abrirNuevoGastoGestion()">Registrar gasto</button>
            <button type="button" class="dueno-boton-secundario" onclick="abrirCuentasPagarGestion()">Cuentas por pagar</button>
        </div>

        <article class="dueno-card">
            <div class="card-head"><div><span>Ultimos gastos</span><h2>${gastos.gastos.length ? "Recientes" : "Sin gastos"}</h2></div></div>
            <div class="lista-compacta">
                ${gastos.gastos.slice(0, 15).map(gasto => `
                    <div class="fila-dueno">
                        <div>
                            <strong>${escaparDueno(gasto.concepto)}</strong>
                            <span>${escaparDueno(gasto.categoria || "Sin categoria")} · ${fechaCorta(gasto.created_at)}</span>
                        </div>
                        <strong>${dinero(gasto.monto)}</strong>
                    </div>
                `).join("") || `<div class="vacio">Todavia no registras gastos.</div>`}
            </div>
        </article>
    `;
}

function abrirNuevoGastoGestion() {
    contenidoGestion().innerHTML = `
        ${botonVolverGestion("renderSubpantallaFinanzasGestion()", "Finanzas")}
        <article class="dueno-card">
            <div class="card-head"><div><span>Gasto del negocio</span><h2>Registrar gasto</h2></div></div>
            <label class="dueno-campo">Concepto
                <input type="text" id="duenoGestionConcepto" autocomplete="off" placeholder="Ej. Recibo de luz">
            </label>
            <label class="dueno-campo">Monto
                <input type="number" id="duenoGestionMonto" inputmode="decimal" min="0" step="0.01" placeholder="0.00">
            </label>
            <label class="dueno-campo">Categoria (opcional)
                <input type="text" id="duenoGestionCategoria" list="duenoGestionCategorias" autocomplete="off" placeholder="Ej. Luz">
                <datalist id="duenoGestionCategorias">
                    <option value="Renta"><option value="Luz"><option value="Agua"><option value="Sueldos"><option value="Transporte"><option value="Mantenimiento"><option value="Otros">
                </datalist>
            </label>
            <label class="dueno-campo">Como se pago
                <select id="duenoGestionMetodo">
                    <option value="efectivo">Efectivo</option>
                    <option value="tarjeta">Tarjeta</option>
                    <option value="transferencia">Transferencia</option>
                </select>
            </label>
            <label class="dueno-campo">Notas (opcional)
                <input type="text" id="duenoGestionNotas" autocomplete="off">
            </label>
            <p id="duenoGestionError" class="dueno-login-error" style="display:none;"></p>
            <button type="button" class="dueno-boton-primario" id="btnGestionGuardar" onclick="guardarGastoGestion()">Guardar gasto</button>
        </article>
    `;
}

async function guardarGastoGestion() {
    const concepto = valorGestion("duenoGestionConcepto");
    const monto = textoNumeroGestion("duenoGestionMonto");

    if (!concepto) return errorFormularioGestion("Escribe en que se gasto.");
    if (!(monto > 0)) return errorFormularioGestion("Escribe un monto mayor a cero.");

    const boton = document.getElementById("btnGestionGuardar");
    boton.disabled = true;
    errorFormularioGestion("");

    try {
        await fetchAutenticado("/gastos-operativos", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                concepto,
                monto,
                categoria: valorGestion("duenoGestionCategoria"),
                metodo: valorGestion("duenoGestionMetodo"),
                notas: valorGestion("duenoGestionNotas")
            })
        });

        mostrarToastDueno("Gasto registrado.");
        renderSubpantallaFinanzasGestion();
    } catch (error) {
        boton.disabled = false;
        errorFormularioGestion(error.message || "No se pudo registrar el gasto.");
    }
}

// ---------------- cuentas por pagar ----------------

let duenoGestionCuentas = [];

async function abrirCuentasPagarGestion() {
    cargandoGestion();

    try {
        const datos = await fetchAutenticado("/cuentas-pagar");
        duenoGestionCuentas = datos.cuentas || [];
        pintarCuentasPagarGestion();
    } catch (error) {
        falloGestion(error, "abrirCuentasPagarGestion()");
    }
}

function pintarCuentasPagarGestion() {
    const abiertas = duenoGestionCuentas.filter(c => c.estado === "pendiente" || c.estado === "parcial");
    const total = abiertas.reduce((suma, c) => suma + Number(c.saldo || 0), 0);
    const hoy = new Date().toISOString().slice(0, 10);

    contenidoGestion().innerHTML = `
        ${botonVolverGestion("renderSubpantallaFinanzasGestion()", "Finanzas")}
        <article class="dueno-card">
            <div class="card-head"><div><span>Debes a proveedores</span><h2>${dinero(total)}</h2></div></div>
            <button type="button" class="dueno-boton-secundario" onclick="abrirNuevaCuentaPagarGestion()">Agregar cuenta por pagar</button>
            <div class="lista-compacta" style="margin-top:12px;">
                ${duenoGestionCuentas.map(cuenta => {
                    const vencida = (cuenta.estado === "pendiente" || cuenta.estado === "parcial") && cuenta.vencimiento && String(cuenta.vencimiento).slice(0, 10) < hoy;
                    return `
                        <button type="button" class="fila-dueno" style="width:100%;text-align:left;" ${cuenta.estado === "pagada" || cuenta.estado === "cancelada" ? "disabled" : `onclick="abrirPagoCuentaGestion(${Number(cuenta.id)})"`}>
                            <div>
                                <strong>${escaparDueno(cuenta.proveedor)}</strong>
                                <span>${escaparDueno(cuenta.concepto)}${cuenta.vencimiento ? ` · vence ${escaparDueno(String(cuenta.vencimiento).slice(0, 10))}` : ""}</span>
                                ${vencida ? `<span class="stock-texto-sin">Vencida</span>` : ""}
                            </div>
                            <div style="text-align:right;">
                                <strong>${dinero(cuenta.saldo)}</strong>
                                <span>${escaparDueno(cuenta.estado)}</span>
                            </div>
                        </button>
                    `;
                }).join("") || `<div class="vacio">No hay cuentas por pagar.</div>`}
            </div>
        </article>
    `;
}

function abrirNuevaCuentaPagarGestion() {
    contenidoGestion().innerHTML = `
        ${botonVolverGestion("pintarCuentasPagarGestion()", "Cuentas por pagar")}
        <article class="dueno-card">
            <div class="card-head"><div><span>Compra a credito</span><h2>Cuenta por pagar</h2></div></div>
            <label class="dueno-campo">Proveedor
                <input type="text" id="duenoGestionProveedor" autocomplete="off" placeholder="Ej. Diprofer">
            </label>
            <label class="dueno-campo">Concepto
                <input type="text" id="duenoGestionConcepto" autocomplete="off" placeholder="Ej. Factura 4521">
            </label>
            <label class="dueno-campo">Monto total
                <input type="number" id="duenoGestionMonto" inputmode="decimal" min="0" step="0.01" placeholder="0.00">
            </label>
            <label class="dueno-campo">Fecha de vencimiento (opcional)
                <input type="date" id="duenoGestionVencimiento">
            </label>
            <p id="duenoGestionError" class="dueno-login-error" style="display:none;"></p>
            <button type="button" class="dueno-boton-primario" id="btnGestionGuardar" onclick="guardarCuentaPagarGestion()">Guardar</button>
        </article>
    `;
}

async function guardarCuentaPagarGestion() {
    const proveedor = valorGestion("duenoGestionProveedor");
    const concepto = valorGestion("duenoGestionConcepto");
    const montoTotal = textoNumeroGestion("duenoGestionMonto");

    if (!proveedor) return errorFormularioGestion("Escribe el proveedor.");
    if (!concepto) return errorFormularioGestion("Escribe el concepto.");
    if (!(montoTotal > 0)) return errorFormularioGestion("Escribe un monto mayor a cero.");

    const boton = document.getElementById("btnGestionGuardar");
    boton.disabled = true;
    errorFormularioGestion("");

    try {
        await fetchAutenticado("/cuentas-pagar", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ proveedor, concepto, montoTotal, vencimiento: valorGestion("duenoGestionVencimiento") || null })
        });

        mostrarToastDueno("Cuenta guardada.");
        abrirCuentasPagarGestion();
    } catch (error) {
        boton.disabled = false;
        errorFormularioGestion(error.message || "No se pudo guardar la cuenta.");
    }
}

function abrirPagoCuentaGestion(id) {
    const cuenta = duenoGestionCuentas.find(c => Number(c.id) === Number(id));
    if (!cuenta) return;

    contenidoGestion().innerHTML = `
        ${botonVolverGestion("pintarCuentasPagarGestion()", "Cuentas por pagar")}
        <article class="dueno-card">
            <div class="card-head"><div><span>${escaparDueno(cuenta.proveedor)}</span><h2>Registrar pago</h2></div></div>
            <p class="dueno-estado">${escaparDueno(cuenta.concepto)} · Saldo ${dinero(cuenta.saldo)} de ${dinero(cuenta.monto_total)}</p>
            <label class="dueno-campo">Monto que pagas
                <input type="number" id="duenoGestionMonto" inputmode="decimal" min="0" step="0.01" value="${Number(cuenta.saldo || 0).toFixed(2)}">
            </label>
            <label class="dueno-campo">Como pagas
                <select id="duenoGestionMetodo">
                    <option value="efectivo">Efectivo</option>
                    <option value="transferencia">Transferencia</option>
                    <option value="tarjeta">Tarjeta</option>
                </select>
            </label>
            <label class="dueno-campo">Referencia (opcional)
                <input type="text" id="duenoGestionReferencia" autocomplete="off">
            </label>
            <p id="duenoGestionError" class="dueno-login-error" style="display:none;"></p>
            <button type="button" class="dueno-boton-primario" id="btnGestionGuardar" onclick="guardarPagoCuentaGestion(${Number(id)})">Registrar pago</button>
        </article>
    `;
}

async function guardarPagoCuentaGestion(id) {
    const monto = textoNumeroGestion("duenoGestionMonto");

    if (!(monto > 0)) return errorFormularioGestion("Escribe un monto mayor a cero.");

    const boton = document.getElementById("btnGestionGuardar");
    boton.disabled = true;
    errorFormularioGestion("");

    try {
        const respuesta = await fetchAutenticado(`/cuentas-pagar/${Number(id)}/pagos`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ monto, metodo: valorGestion("duenoGestionMetodo"), referencia: valorGestion("duenoGestionReferencia") })
        });

        mostrarToastDueno(respuesta.estado === "pagada" ? "Cuenta pagada por completo." : "Pago registrado.");
        abrirCuentasPagarGestion();
    } catch (error) {
        boton.disabled = false;
        errorFormularioGestion(error.message || "No se pudo registrar el pago.");
    }
}

// ======================================================================
// ENCARGOS de clientes
// ======================================================================

let duenoGestionEncargosFiltro = "pendiente";
let duenoGestionEncargoActual = null;

function puedeVerEncargosGestion() {
    return duenoTienePermiso("hacer_ventas");
}

const ESTADOS_ENCARGO_GESTION = {
    pendiente: "Pendiente",
    listo: "Listo para entregar",
    entregado: "Entregado",
    cancelado: "Cancelado"
};

async function renderSubpantallaEncargosGestion() {
    cargandoGestion();

    try {
        const consulta = duenoGestionEncargosFiltro ? `?estado=${encodeURIComponent(duenoGestionEncargosFiltro)}` : "";
        const datos = await fetchAutenticado(`/encargos-clientes${consulta}`);
        pintarListaEncargosGestion(datos.encargos || []);
    } catch (error) {
        falloGestion(error, "renderSubpantallaEncargosGestion()");
    }
}

function cambiarFiltroEncargosGestion(filtro) {
    duenoGestionEncargosFiltro = filtro;
    renderSubpantallaEncargosGestion();
}

function pintarListaEncargosGestion(encargos) {
    const filtros = [["pendiente", "Pendientes"], ["listo", "Listos"], ["entregado", "Entregados"], ["", "Todos"]];
    const hoy = new Date().toISOString().slice(0, 10);

    contenidoGestion().innerHTML = `
        <div class="dueno-chips-periodo">
            ${filtros.map(([clave, etiqueta]) => `<button type="button" class="dueno-chip-periodo ${duenoGestionEncargosFiltro === clave ? "activo" : ""}" onclick="cambiarFiltroEncargosGestion('${clave}')">${etiqueta}</button>`).join("")}
        </div>
        <button type="button" class="dueno-boton-primario" style="margin-bottom:12px;" onclick="abrirNuevoEncargoGestion()">Nuevo encargo</button>
        <div class="lista-compacta">
            ${encargos.map(encargo => {
                const fecha = encargo.fechaEntregaEsperada ? String(encargo.fechaEntregaEsperada).slice(0, 10) : "";
                const vencido = fecha && fecha < hoy && (encargo.estado === "pendiente" || encargo.estado === "listo");
                return `
                    <button type="button" class="fila-dueno" style="width:100%;text-align:left;" onclick="abrirEncargoGestion(${Number(encargo.id)})">
                        <div>
                            <strong>${escaparDueno(encargo.clienteNombre)}</strong>
                            <span>${Number(encargo.totalItems)} producto${Number(encargo.totalItems) === 1 ? "" : "s"} · ${escaparDueno(ESTADOS_ENCARGO_GESTION[encargo.estado] || encargo.estado)}</span>
                            ${fecha ? `<span ${vencido ? 'class="stock-texto-sin"' : ""}>Entrega ${escaparDueno(fecha)}${vencido ? " (vencido)" : ""}</span>` : ""}
                        </div>
                        <div style="text-align:right;">
                            <strong>${dinero(encargo.totalEstimado)}</strong>
                            ${encargo.anticipo > 0 ? `<span>Anticipo ${dinero(encargo.anticipo)}</span>` : ""}
                        </div>
                    </button>
                `;
            }).join("") || `<div class="vacio">No hay encargos en esta lista.</div>`}
        </div>
    `;
}

function abrirNuevoEncargoGestion() {
    contenidoGestion().innerHTML = `
        ${botonVolverGestion("renderSubpantallaEncargosGestion()", "Encargos")}
        <article class="dueno-card">
            <div class="card-head"><div><span>Pedido de un cliente</span><h2>Nuevo encargo</h2></div></div>
            <label class="dueno-campo">Nombre del cliente
                <input type="text" id="duenoGestionCliente" autocomplete="off">
            </label>
            <label class="dueno-campo">Telefono (opcional)
                <input type="tel" id="duenoGestionTelefono" inputmode="tel" autocomplete="off">
            </label>
            <label class="dueno-campo">Producto que encargo
                <input type="text" id="duenoGestionProducto" autocomplete="off" placeholder="Ej. Llave stillson 14 pulgadas">
            </label>
            <label class="dueno-campo">Cantidad
                <input type="number" id="duenoGestionCantidad" inputmode="decimal" min="1" step="any" value="1">
            </label>
            <label class="dueno-campo">Precio estimado por pieza (opcional)
                <input type="number" id="duenoGestionPrecio" inputmode="decimal" min="0" step="0.01" placeholder="0.00">
            </label>
            <label class="dueno-campo">Anticipo (opcional)
                <input type="number" id="duenoGestionAnticipo" inputmode="decimal" min="0" step="0.01" placeholder="0.00">
            </label>
            <label class="dueno-campo">Fecha de entrega esperada (opcional)
                <input type="date" id="duenoGestionFecha">
            </label>
            <label class="dueno-campo">Notas (opcional)
                <input type="text" id="duenoGestionNotas" autocomplete="off">
            </label>
            <p class="dueno-estado">Si encargo mas de un producto, agrega los demas despues de crearlo.</p>
            <p id="duenoGestionError" class="dueno-login-error" style="display:none;"></p>
            <button type="button" class="dueno-boton-primario" id="btnGestionGuardar" onclick="guardarNuevoEncargoGestion()">Guardar encargo</button>
        </article>
    `;
}

async function guardarNuevoEncargoGestion() {
    const clienteNombre = valorGestion("duenoGestionCliente");
    const nombre = valorGestion("duenoGestionProducto");
    const cantidad = textoNumeroGestion("duenoGestionCantidad");

    if (!clienteNombre) return errorFormularioGestion("Escribe el nombre del cliente.");
    if (!nombre) return errorFormularioGestion("Escribe que producto encargo.");
    if (!(cantidad > 0)) return errorFormularioGestion("La cantidad debe ser mayor a cero.");

    const boton = document.getElementById("btnGestionGuardar");
    boton.disabled = true;
    errorFormularioGestion("");

    try {
        const respuesta = await fetchAutenticado("/encargos-clientes", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                clienteNombre,
                clienteTelefono: valorGestion("duenoGestionTelefono"),
                anticipo: textoNumeroGestion("duenoGestionAnticipo"),
                fechaEntregaEsperada: valorGestion("duenoGestionFecha") || null,
                notas: valorGestion("duenoGestionNotas"),
                items: [{ nombre, cantidad, precioEstimado: textoNumeroGestion("duenoGestionPrecio") }]
            })
        });

        mostrarToastDueno("Encargo guardado.");
        abrirEncargoGestion(respuesta.id);
    } catch (error) {
        boton.disabled = false;
        errorFormularioGestion(error.message || "No se pudo guardar el encargo.");
    }
}

async function abrirEncargoGestion(id) {
    cargandoGestion();

    try {
        const datos = await fetchAutenticado(`/encargos-clientes/${Number(id)}`);
        duenoGestionEncargoActual = datos.encargo;
        pintarEncargoGestion();
    } catch (error) {
        falloGestion(error, `abrirEncargoGestion(${Number(id)})`);
    }
}

function pintarEncargoGestion() {
    const encargo = duenoGestionEncargoActual;
    const total = encargo.items.reduce((suma, item) => suma + item.cantidad * item.precioEstimado, 0);
    const telefonoWa = telefonoParaWhatsAppDueno(encargo.clienteTelefono);
    const abierto = encargo.estado === "pendiente" || encargo.estado === "listo";
    const negocio = document.getElementById("duenoNegocio")?.textContent?.trim() || "tu ferreteria";
    const mensajeListo = `Hola ${encargo.clienteNombre}, tu encargo ya esta listo para recoger en ${negocio}.`;

    contenidoGestion().innerHTML = `
        ${botonVolverGestion("renderSubpantallaEncargosGestion()", "Encargos")}
        <article class="dueno-card">
            <div class="card-head">
                <div><span>${escaparDueno(ESTADOS_ENCARGO_GESTION[encargo.estado] || encargo.estado)}</span><h2>${escaparDueno(encargo.clienteNombre)}</h2></div>
            </div>
            <div class="dueno-datos-grid">
                <div><span>Total estimado</span><strong>${dinero(total)}</strong></div>
                <div><span>Anticipo</span><strong>${dinero(encargo.anticipo)}</strong></div>
                <div><span>Por cobrar</span><strong>${dinero(Math.max(0, total - encargo.anticipo))}</strong></div>
                <div><span>Entrega</span><strong>${encargo.fechaEntregaEsperada ? escaparDueno(String(encargo.fechaEntregaEsperada).slice(0, 10)) : "Sin fecha"}</strong></div>
            </div>
            ${encargo.notas ? `<p class="dueno-estado" style="margin-top:8px;">${escaparDueno(encargo.notas)}</p>` : ""}
            ${encargo.clienteTelefono ? `
                <div style="display:flex;gap:8px;margin-top:10px;flex-wrap:wrap;">
                    <a class="dueno-boton-secundario-chico" href="tel:${escaparDueno(encargo.clienteTelefono)}">Llamar</a>
                    ${telefonoWa ? `<a class="dueno-boton-secundario-chico" target="_blank" rel="noopener" href="https://wa.me/${telefonoWa}?text=${encodeURIComponent(mensajeListo)}">Avisar por WhatsApp</a>` : ""}
                </div>
            ` : ""}
        </article>

        <article class="dueno-card">
            <div class="card-head"><div><span>Productos</span><h2>${encargo.items.length} en el encargo</h2></div></div>
            <div class="lista-compacta">
                ${encargo.items.map(item => `
                    <div class="fila-dueno">
                        <div>
                            <strong>${escaparDueno(item.nombre)}</strong>
                            <span>${item.cantidad} x ${dinero(item.precioEstimado)}</span>
                        </div>
                        ${abierto ? `<button type="button" class="dueno-link dueno-link-peligro" onclick="quitarArticuloEncargoGestion(${Number(item.id)})">Quitar</button>` : ""}
                    </div>
                `).join("") || `<div class="vacio">Sin productos.</div>`}
            </div>
            ${abierto ? `
                <div style="margin-top:12px;">
                    <label class="dueno-campo">Agregar producto
                        <input type="text" id="duenoGestionProducto" autocomplete="off" placeholder="Nombre del producto">
                    </label>
                    <div style="display:flex;gap:8px;">
                        <label class="dueno-campo" style="flex:1;">Cantidad
                            <input type="number" id="duenoGestionCantidad" inputmode="decimal" min="1" step="any" value="1">
                        </label>
                        <label class="dueno-campo" style="flex:1;">Precio estimado
                            <input type="number" id="duenoGestionPrecio" inputmode="decimal" min="0" step="0.01" placeholder="0.00">
                        </label>
                    </div>
                    <p id="duenoGestionError" class="dueno-login-error" style="display:none;"></p>
                    <button type="button" class="dueno-boton-secundario" onclick="agregarArticuloEncargoGestion()">Agregar</button>
                </div>
            ` : ""}
        </article>

        ${abierto ? `
            <article class="dueno-card">
                ${encargo.estado === "pendiente" ? `<button type="button" class="dueno-boton-primario" onclick="cambiarEstadoEncargoGestion('listo')">Marcar como listo</button>` : ""}
                <button type="button" class="dueno-boton-${encargo.estado === "listo" ? "primario" : "secundario"}" style="margin-top:8px;" onclick="cambiarEstadoEncargoGestion('entregado')">Marcar como entregado</button>
                <button type="button" class="dueno-link dueno-link-peligro" style="display:block;margin:12px auto 0;" onclick="cancelarEncargoGestion()">Cancelar encargo</button>
            </article>
        ` : ""}
    `;
}

async function cambiarEstadoEncargoGestion(estado) {
    const encargo = duenoGestionEncargoActual;
    if (!encargo) return;

    try {
        await fetchAutenticado(`/encargos-clientes/${Number(encargo.id)}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ estado })
        });

        mostrarToastDueno(estado === "listo" ? "Marcado como listo." : estado === "entregado" ? "Encargo entregado." : "Encargo actualizado.");
        abrirEncargoGestion(encargo.id);
    } catch (error) {
        mostrarToastDueno(error.message || "No se pudo actualizar el encargo.");
    }
}

function cancelarEncargoGestion() {
    if (!confirm("¿Cancelar este encargo?")) return;
    cambiarEstadoEncargoGestion("cancelado");
}

async function agregarArticuloEncargoGestion() {
    const encargo = duenoGestionEncargoActual;
    const nombre = valorGestion("duenoGestionProducto");
    const cantidad = textoNumeroGestion("duenoGestionCantidad");

    if (!nombre) return errorFormularioGestion("Escribe el producto.");
    if (!(cantidad > 0)) return errorFormularioGestion("La cantidad debe ser mayor a cero.");

    try {
        errorFormularioGestion("");
        const respuesta = await fetchAutenticado(`/encargos-clientes/${Number(encargo.id)}/items`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ nombre, cantidad, precioEstimado: textoNumeroGestion("duenoGestionPrecio") })
        });

        duenoGestionEncargoActual = respuesta.encargo;
        pintarEncargoGestion();
    } catch (error) {
        errorFormularioGestion(error.message || "No se pudo agregar el producto.");
    }
}

async function quitarArticuloEncargoGestion(itemId) {
    const encargo = duenoGestionEncargoActual;
    if (!encargo || !confirm("¿Quitar este producto del encargo?")) return;

    try {
        const respuesta = await fetchAutenticado(`/encargos-clientes/${Number(encargo.id)}/items/${Number(itemId)}`, { method: "DELETE" });
        duenoGestionEncargoActual = respuesta.encargo;
        pintarEncargoGestion();
    } catch (error) {
        mostrarToastDueno(error.message || "No se pudo quitar el producto.");
    }
}
