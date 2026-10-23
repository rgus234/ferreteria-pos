// Capturar codigos: herramienta TEMPORAL y PRIVADA para juntar codigos de barras reales con su nombre.
//
// Solo las cuentas de CAPTURA_CODIGOS_CORREOS (coma) pueden usarla, y se revisa aqui en el servidor, no solo en
// la pantalla. Empleados y equipos compartidos quedan fuera. Los registros viven en su propia tabla
// (capturas_codigos), por propietario; nunca tocan productos, ventas, existencias ni precios.

const { responderError } = require("./error-utils");

const CORREOS_POR_OMISION = "gustavodiazruiz4@gmail.com,nexoposoficial@gmail.com";
const LIMITE_LISTA = 500;

function correosAutorizados() {
    return String(process.env.CAPTURA_CODIGOS_CORREOS || CORREOS_POR_OMISION).split(",").map(c => c.trim().toLowerCase()).filter(Boolean);
}

function limpiarCodigo(valor) {
    const codigo = String(valor ?? "").trim();
    return /^[0-9A-Za-z\-._]{3,64}$/.test(codigo) ? codigo : null;
}

function limpiarNombre(valor) {
    return String(valor ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 160);
}

// Para Excel: ="0750..." fuerza texto y conserva los ceros iniciales; las comillas se duplican.
function celdaCsv(valor) {
    return `"${String(valor ?? "").replace(/"/g, '""')}"`;
}

function celdaCodigoCsv(codigo) {
    return `"=""${String(codigo).replace(/"/g, '""')}"""`;
}

function instalar(app, pool, requerirAccesoNegocio) {
    // Devuelve el correo del propietario autorizado o null (y responde 403 si no lo es).
    async function autorizar(req, res) {
        const negocioId = req.negocioAutenticado?.negocio_id ?? null;
        const esEmpleado = req.negocioAutenticado?.rol === "employee" || Boolean(req.headers["x-empleado-id"]);

        if (negocioId && !esEmpleado) {
            const fila = (await pool.query(`SELECT correo FROM public.negocios WHERE id = $1`, [negocioId])).rows[0];
            const correo = String(fila?.correo || "").trim().toLowerCase();

            if (correo && correosAutorizados().includes(correo)) return correo;
        }

        res.status(403).json({ ok: false, error: "Esta herramienta es privada." });
        return null;
    }

    function ruta(metodo, camino, manejador) {
        app[metodo](camino, requerirAccesoNegocio, async (req, res) => {
            try {
                const propietario = await autorizar(req, res);
                if (propietario) await manejador(req, res, propietario);
            } catch (error) {
                responderError(res, error);
            }
        });
    }

    // La pantalla pregunta primero: si no es el propietario, ni siquiera muestra la opcion.
    app.get("/captura-codigos/acceso", requerirAccesoNegocio, async (req, res) => {
        try {
            const negocioId = req.negocioAutenticado?.negocio_id ?? null;
            const esEmpleado = req.negocioAutenticado?.rol === "employee" || Boolean(req.headers["x-empleado-id"]);
            let permitido = false;

            if (negocioId && !esEmpleado) {
                const fila = (await pool.query(`SELECT correo FROM public.negocios WHERE id = $1`, [negocioId])).rows[0];
                permitido = correosAutorizados().includes(String(fila?.correo || "").trim().toLowerCase());
            }

            res.json({ ok: true, permitido });
        } catch (error) {
            responderError(res, error);
        }
    });

    ruta("get", "/captura-codigos", async (req, res, propietario) => {
        const buscar = String(req.query.buscar || "").trim().slice(0, 80);
        const patron = `%${buscar.replace(/[%_\\]/g, "\\$&")}%`;

        const filas = await pool.query(
            `SELECT id, codigo, nombre, created_at, updated_at FROM public.capturas_codigos
             WHERE propietario_correo = $1 AND ($2 = '' OR codigo ILIKE $3 OR nombre ILIKE $3)
             ORDER BY updated_at DESC, id DESC LIMIT ${LIMITE_LISTA}`,
            [propietario, buscar, patron]
        );

        const total = (await pool.query(`SELECT COUNT(*) AS total FROM public.capturas_codigos WHERE propietario_correo = $1`, [propietario])).rows[0].total;
        res.json({ ok: true, total: Number(total), registros: filas.rows });
    });

    ruta("get", "/captura-codigos/existe/:codigo", async (req, res, propietario) => {
        const codigo = limpiarCodigo(req.params.codigo);

        if (!codigo) {
            res.status(400).json({ ok: false, error: "Codigo no valido." });
            return;
        }

        const fila = (await pool.query(`SELECT id, codigo, nombre FROM public.capturas_codigos WHERE propietario_correo = $1 AND codigo = $2`, [propietario, codigo])).rows[0] || null;
        res.json({ ok: true, existe: Boolean(fila), registro: fila });
    });

    // Guarda. Si el codigo ya estaba y no se pidio reemplazar, responde 409 con lo que habia (duplicado).
    ruta("post", "/captura-codigos", async (req, res, propietario) => {
        const codigo = limpiarCodigo(req.body?.codigo);
        const nombre = limpiarNombre(req.body?.nombre);

        if (!codigo) {
            res.status(400).json({ ok: false, error: "El codigo no es valido (3 a 64 caracteres, sin espacios)." });
            return;
        }

        if (!nombre) {
            res.status(400).json({ ok: false, error: "Escribe el nombre del producto." });
            return;
        }

        const existente = (await pool.query(`SELECT id, nombre FROM public.capturas_codigos WHERE propietario_correo = $1 AND codigo = $2`, [propietario, codigo])).rows[0];

        if (existente && req.body?.reemplazar !== true) {
            res.status(409).json({ ok: false, duplicado: { id: existente.id, codigo, nombre: existente.nombre }, error: "Ese codigo ya estaba capturado." });
            return;
        }

        const guardado = existente
            ? (await pool.query(
                `UPDATE public.capturas_codigos SET nombre_anterior = nombre, nombre = $1, updated_at = NOW() WHERE id = $2 RETURNING id, codigo, nombre`,
                [nombre, existente.id]
            )).rows[0]
            : (await pool.query(
                `INSERT INTO public.capturas_codigos (propietario_correo, codigo, nombre) VALUES ($1, $2, $3) RETURNING id, codigo, nombre`,
                [propietario, codigo, nombre]
            )).rows[0];

        const total = (await pool.query(`SELECT COUNT(*) AS total FROM public.capturas_codigos WHERE propietario_correo = $1`, [propietario])).rows[0].total;
        res.status(existente ? 200 : 201).json({ ok: true, registro: guardado, actualizado: Boolean(existente), total: Number(total) });
    });

    ruta("patch", "/captura-codigos/:id", async (req, res, propietario) => {
        const nombre = limpiarNombre(req.body?.nombre);
        const id = Number(req.params.id);

        if (!Number.isInteger(id) || !nombre) {
            res.status(400).json({ ok: false, error: "Escribe el nombre del producto." });
            return;
        }

        const fila = await pool.query(
            `UPDATE public.capturas_codigos SET nombre_anterior = nombre, nombre = $1, updated_at = NOW()
             WHERE id = $2 AND propietario_correo = $3 RETURNING id, codigo, nombre`,
            [nombre, id, propietario]
        );

        if (!fila.rows.length) {
            res.status(404).json({ ok: false, error: "Registro no encontrado." });
            return;
        }

        res.json({ ok: true, registro: fila.rows[0] });
    });

    ruta("delete", "/captura-codigos/:id", async (req, res, propietario) => {
        const id = Number(req.params.id);
        const fila = Number.isInteger(id)
            ? await pool.query(`DELETE FROM public.capturas_codigos WHERE id = $1 AND propietario_correo = $2 RETURNING id`, [id, propietario])
            : { rows: [] };

        if (!fila.rows.length) {
            res.status(404).json({ ok: false, error: "Registro no encontrado." });
            return;
        }

        res.json({ ok: true });
    });

    // CSV para Excel: UTF-8 con BOM, separado por comas, codigo como texto (conserva ceros iniciales).
    ruta("get", "/captura-codigos/exportar.csv", async (req, res, propietario) => {
        const filas = (await pool.query(
            `SELECT codigo, nombre, created_at FROM public.capturas_codigos WHERE propietario_correo = $1 ORDER BY created_at ASC, id ASC`,
            [propietario]
        )).rows;

        const lineas = ["codigo,nombre,capturado"].concat(
            filas.map(f => [celdaCodigoCsv(f.codigo), celdaCsv(f.nombre), celdaCsv(new Date(f.created_at).toISOString().slice(0, 19).replace("T", " "))].join(","))
        );

        res.set({
            "Content-Type": "text/csv; charset=utf-8",
            "Content-Disposition": `attachment; filename="codigos-capturados-${new Date().toISOString().slice(0, 10)}.csv"`,
            "Cache-Control": "no-store"
        });
        res.send("﻿" + lineas.join("\r\n") + "\r\n");
    });
}

module.exports = instalar;
module.exports.celdaCodigoCsv = celdaCodigoCsv;
module.exports.limpiarCodigo = limpiarCodigo;
