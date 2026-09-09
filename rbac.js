// Fase 0 del ecosistema Nexo: resolucion de identidad/rol/permisos que
// no depende de CUAL de los tres mecanismos de sesion autentico la
// peticion (dispositivo+PIN, cuenta del dueno, o persona con membresia
// en negocio_miembros). Mismo espiritu que plan-enforcement.js, pero
// ese eje es plan-por-negocio y este es rol-por-usuario -- conviven,
// uno no reemplaza al otro.
//
// Compatibilidad con lo que ya existe: las ~70 rutas actuales que usan
// requerirAccesoNegocio siguen funcionando exactamente igual (ninguna
// pasa por requerirPermiso todavia). Una sesion de dispositivo sin el
// encabezado x-empleado-id (o sea, todo el trafico de hoy) se resuelve
// como acceso sin restriccion -- el dia que el frontend empiece a
// mandar ese encabezado por empleado, el enforcement granular se
// activa solo, sin tocar este modulo otra vez.

const pool = require("./db");

const PERMISOS = Object.freeze({
    VER_INVENTARIO: "ver_inventario",
    MODIFICAR_INVENTARIO: "modificar_inventario",
    VER_PEDIDOS: "ver_pedidos",
    GESTIONAR_PEDIDOS: "gestionar_pedidos",
    HACER_VENTAS: "hacer_ventas",
    HACER_CORTE: "hacer_corte",
    VER_REPORTES: "ver_reportes",
    ADMINISTRAR_USUARIOS: "administrar_usuarios",
    VER_CREDITO: "ver_credito",
    GESTIONAR_CREDITO: "gestionar_credito",
    REGISTRAR_ABONOS_CREDITO: "registrar_abonos_credito",
    APROBAR_SOLICITUDES_CREDITO: "aprobar_solicitudes_credito"
});

// Puente de compatibilidad entre dos editores de permisos que existen
// hoy para un empleado del POS de escritorio (empleados.permisos):
//
//   - "Modulos del sistema" (MODULOS_SISTEMA en config-auth.js) usa
//     claves antiguas en camelCase ("clientes", "inventario"...) y
//     SOLO controla que pantalla ve el empleado -- siempre visible.
//   - "Acceso a Nexo (celular)" (PERMISOS_NEXO) usa las claves
//     snake_case que este archivo revisa de verdad (PERMISOS.*) --
//     pero esa seccion NO SE RENDERIZA hasta que el empleado vincula
//     su propio celular a Nexo. Un cajero de mostrador que nunca lo
//     hace no tiene NINGUNA casilla en NINGUN lado para que el dueno
//     le conceda ver_credito/gestionar_credito, aunque ya le haya
//     marcado la pantalla "Clientes".
//
// Bug real reportado por Ferreteria Olimpico (2026-09-09): sus
// cajeros (nunca vinculados a Nexo) veian la pantalla de Creditos
// vacia y no podian dar de alta clientes, aunque el dueno confirmo
// que "Clientes" ya estaba marcado -- porque no existia forma de
// marcar lo otro. Mientras exista un solo editor, si el empleado ya
// tiene la pantalla concedida se le reconoce el permiso de accion
// equivalente. Un valor explicito ya guardado (por haber usado el
// editor de Nexo) siempre gana sobre este valor por defecto.
function conPermisosDerivados(permisos) {
    const derivados = {};

    if (permisos.clientes === true) {
        derivados.ver_credito = true;
        derivados.gestionar_credito = true;
        derivados.registrar_abonos_credito = true;
    }

    return { ...derivados, ...permisos };
}

async function permisosDeEmpleado(empleadoId, negocioId) {
    const fila = await pool.query(
        `SELECT rol, permisos FROM public.empleados WHERE id = $1 AND negocio_id = $2 AND activo = true`,
        [empleadoId, negocioId]
    );

    if (fila.rows.length === 0) return null;

    const empleado = fila.rows[0];

    if (empleado.rol === "Administrador") {
        return { rol: "owner", permisos: null };
    }

    return { rol: "employee", permisos: conPermisosDerivados(empleado.permisos || {}) };
}

async function permisosDeMiembro(personaId, negocioId) {
    const fila = await pool.query(
        `SELECT rol, permisos FROM public.negocio_miembros WHERE persona_id = $1 AND negocio_id = $2 AND activo = true`,
        [personaId, negocioId]
    );

    if (fila.rows.length === 0) return null;

    const miembro = fila.rows[0];
    return { rol: miembro.rol, permisos: miembro.rol === "owner" ? null : (miembro.permisos || {}) };
}

// Devuelve { rol, negocioId, permisos } normalizado sin importar el
// mecanismo que autentico la peticion. permisos === null significa
// "sin restriccion" (dueno, administrador, o dispositivo sin empleado
// identificado -- el status quo de hoy). rol === "customer" cuando hay
// una persona logueada pero sin membresia en el negocio consultado.
async function resolverIdentidadNexo(req, negocioIdExplicito) {
    if (req.negocioAutenticado) {
        const negocioId = req.negocioAutenticado.negocio_id;

        // Fase 1: una sesion de cuenta minteada para un empleado (via
        // /personas/entrar-como-empleado) trae persona_id+rol='employee'
        // -- a diferencia de una sesion clasica de dueño (ambos NULL,
        // sigue siendo owner sin restriccion como siempre).
        if (req.negocioAutenticado.rol === "employee" && req.negocioAutenticado.persona_id) {
            const resuelto = await permisosDeMiembro(req.negocioAutenticado.persona_id, negocioId);
            if (resuelto) return { ...resuelto, negocioId };
        }

        return { rol: "owner", negocioId, permisos: null };
    }

    if (req.negocioDispositivo) {
        const negocioId = req.negocioDispositivo.negocio_id;
        const empleadoId = Number(req.headers["x-empleado-id"]);

        if (empleadoId) {
            const resuelto = await permisosDeEmpleado(empleadoId, negocioId);
            if (resuelto) return { ...resuelto, negocioId };
        }

        // Sin x-empleado-id: mismo comportamiento que todas las rutas
        // ya tienen hoy (el equipo vinculado es el limite de confianza).
        return { rol: "owner", negocioId, permisos: null };
    }

    if (req.persona) {
        const negocioId = Number(negocioIdExplicito || req.params?.negocioId || req.body?.negocioId);

        if (negocioId) {
            const resuelto = await permisosDeMiembro(req.persona.id, negocioId);
            if (resuelto) return { ...resuelto, negocioId };
        }

        return { rol: "customer", negocioId: negocioId || null, permisos: {} };
    }

    return { rol: null, negocioId: null, permisos: {} };
}

function tienePermiso(identidad, clave) {
    if (identidad.rol === "owner") return true;
    if (identidad.permisos === null) return true;
    return identidad.permisos?.[clave] === true;
}

// Middleware Express -- se coloca DESPUES de requerirAccesoNegocio o
// requerirSesionPersona (necesita que ya exista req.negocioDispositivo/
// req.negocioAutenticado/req.persona).
function requerirPermiso(clave) {
    return async function (req, res, next) {
        try {
            const identidad = await resolverIdentidadNexo(req);
            req.identidadNexo = identidad;

            if (!identidad.rol) {
                res.status(401).json({ ok: false, error: "Sesion requerida" });
                return;
            }

            if (!tienePermiso(identidad, clave)) {
                res.status(403).json({
                    ok: false,
                    error: "Tu cuenta no tiene permiso para esto. Pidele al dueño que te lo asigne.",
                    requierePermiso: clave
                });
                return;
            }

            next();
        } catch (error) {
            res.status(500).json({ ok: false, error: "No se pudo verificar tus permisos. Intenta de nuevo." });
        }
    };
}

module.exports = { PERMISOS, resolverIdentidadNexo, tienePermiso, requerirPermiso, conPermisosDerivados };
