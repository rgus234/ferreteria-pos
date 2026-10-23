// Solicitud de informacion o cotizacion de un equipo (impresora, lector) desde la pagina oficial.
// No crea cuentas ni invitaciones: se guarda aparte (solicitudes_equipo) y le llega un correo al propietario.

const fs = require("fs");
const path = require("path");
const { responderError } = require("./error-utils");
const email = require("./email");

const REGEX_CORREO = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_POR_HORA = 6;
const intentos = new Map(); // ip -> marcas de tiempo

function equipos() {
    try {
        return JSON.parse(fs.readFileSync(path.join(__dirname, "public", "site", "equipamiento.json"), "utf8")).productos;
    } catch (error) {
        return [];
    }
}

function limpiar(valor, max) {
    return String(valor ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
}

function demasiadas(ip) {
    const ahora = Date.now();
    const recientes = (intentos.get(ip) || []).filter(t => ahora - t < 3600000);
    recientes.push(ahora);
    intentos.set(ip, recientes);
    return recientes.length > MAX_POR_HORA;
}

function instalar(app, pool) {
    app.post("/api/solicitud-equipo", async (req, res) => {
        try {
            // Campo trampa: un robot lo llena, una persona no lo ve.
            if (req.body?.empresaWeb) {
                res.status(201).json({ ok: true });
                return;
            }

            if (demasiadas(req.ip)) {
                res.status(429).json({ ok: false, error: "Demasiadas solicitudes. Intenta de nuevo en un rato o escríbenos por WhatsApp." });
                return;
            }

            const equipo = equipos().find(e => e.id === String(req.body?.equipoId || ""));
            const nombre = limpiar(req.body?.nombre, 140);
            const telefono = limpiar(req.body?.telefono, 40);
            const correo = limpiar(req.body?.correo, 140).toLowerCase();
            const ciudad = limpiar(req.body?.ciudad, 80);
            const mensaje = limpiar(req.body?.mensaje, 300);
            const cantidad = Math.min(999, Math.max(1, parseInt(req.body?.cantidad, 10) || 1));

            if (!equipo) {
                res.status(400).json({ ok: false, error: "Elige un equipo del catálogo." });
                return;
            }

            if (!nombre) {
                res.status(400).json({ ok: false, error: "Escribe tu nombre." });
                return;
            }

            if (!telefono && !correo) {
                res.status(400).json({ ok: false, error: "Déjanos un teléfono o un correo para responderte." });
                return;
            }

            if (correo && !REGEX_CORREO.test(correo)) {
                res.status(400).json({ ok: false, error: "Escribe un correo válido." });
                return;
            }

            await pool.query(
                `INSERT INTO public.solicitudes_equipo (equipo_id, equipo_clave, equipo_nombre, cantidad, nombre, telefono, correo, ciudad, mensaje, ip)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
                [equipo.id, equipo.clave, equipo.nombre, cantidad, nombre, telefono, correo, ciudad, mensaje, req.ip || ""]
            );

            // El aviso reutiliza el correo de contactos del sitio: llega a quien atiende los leads, con el equipo en el mensaje.
            email.enviarCorreoLeadLanding({
                nombre,
                negocio: `Cotización de equipo: ${equipo.marca} ${equipo.clave}`,
                telefono,
                correo,
                mensaje: `${cantidad} pieza(s) de ${equipo.marca} ${equipo.clave} (${equipo.nombre}, código ${equipo.codigo}). Mayoreo de referencia $${equipo.precios.mayoreo}.${ciudad ? ` Ciudad: ${ciudad}.` : ""}${mensaje ? ` Comentario: ${mensaje}` : ""}`
            }).catch(error => console.warn("No se pudo avisar de la solicitud de equipo", error.message));

            res.status(201).json({ ok: true });
        } catch (error) {
            responderError(res, error);
        }
    });
}

module.exports = instalar;
