// Rutas publicas (sin sesion) de la autofactura: el cliente factura su ticket solo. La logica esta en autofactura.js.
//   GET  /facturar y /facturar/:codigo        la pagina (public/facturar.html)
//   GET  /autofactura/catalogos               regimenes y usos de CFDI
//   GET  /autofactura/negocio/:codigo         marca del negocio (logo, color, nombre) para pintar la pagina
//   POST /autofactura/consultar               { codigo, total }
//   POST /autofactura/emitir                  { codigo, total, receptor }
//   POST /autofactura/reenviar                { codigo, total, correo }
//   GET  /autofactura/archivo?codigo=&total=&tipo=pdf|xml
const path = require("path");
const { responderError } = require("./error-utils");
const autofactura = require("./autofactura");
const { crearCfdi, descargarXmlCfdi } = require("./facturama-client");
const { enviarCorreoFacturaCfdi } = require("./email");

// Cuenta solo los intentos que fallan (codigo o total equivocados): consultar tu propia compra nunca bloquea a nadie.
function crearLimitador(maxFallos, ventanaMs) {
    const registro = new Map();
    return {
        bloqueado(ip) { const e = registro.get(ip); return Boolean(e && e.hasta > Date.now()); },
        fallo(ip) { const e = registro.get(ip) || { n: 0, hasta: 0 }; e.n += 1; if (e.n >= maxFallos) { e.hasta = Date.now() + ventanaMs; e.n = 0; } registro.set(ip, e); }
    };
}

module.exports = (app, pool) => {
    const limitador = crearLimitador(15, 15 * 60 * 1000);
    const deps = { crearCfdi, descargarXmlCfdi, enviarCorreoFacturaCfdi };
    const pagina = path.join(__dirname, "public", "facturar.html");
    const servirPagina = (req, res) => { res.set("Cache-Control", "no-cache"); res.sendFile(pagina); };
    const bloqueo = (req, res) => { if (limitador.bloqueado(req.ip)) { res.status(429).json({ ok: false, error: "Demasiados intentos. Espera unos minutos y vuelve a intentar." }); return true; } return false; };

    app.get("/facturar", servirPagina);
    app.get("/facturar/:codigo", servirPagina);

    app.get("/autofactura/catalogos", (req, res) => { res.json({ ok: true, regimenes: autofactura.REGIMENES, usos: autofactura.USOS_CFDI }); });

    app.get("/autofactura/negocio/:codigo", async (req, res) => {
        try {
            if (bloqueo(req, res)) return;
            const marca = await autofactura.marcaPorCodigo(pool, req.params.codigo);
            if (!marca) { limitador.fallo(req.ip); res.status(404).json({ ok: false }); return; }
            res.json({ ok: true, marca });
        } catch (error) { responderError(res, error); }
    });

    app.post("/autofactura/consultar", async (req, res) => {
        try {
            if (bloqueo(req, res)) return;
            const r = await autofactura.consultar(pool, { codigo: req.body?.codigo, total: req.body?.total });
            if (!r.ok) { limitador.fallo(req.ip); res.status(404).json(r); return; }
            res.json(r);
        } catch (error) { responderError(res, error); }
    });

    app.post("/autofactura/emitir", async (req, res) => {
        try {
            if (bloqueo(req, res)) return;
            const r = await autofactura.emitir(pool, deps, { codigo: req.body?.codigo, total: req.body?.total, receptor: req.body?.receptor });
            if (!r.ok) { if (r.status === 404) limitador.fallo(req.ip); res.status(r.status || 400).json({ ok: false, error: r.error }); return; }
            res.json(r);
        } catch (error) { responderError(res, error); }
    });

    app.post("/autofactura/reenviar", async (req, res) => {
        try {
            if (bloqueo(req, res)) return;
            const r = await autofactura.reenviar(pool, deps, { codigo: req.body?.codigo, total: req.body?.total, correo: req.body?.correo });
            if (!r.ok) { if (r.status === 404) limitador.fallo(req.ip); res.status(r.status || 400).json({ ok: false, error: r.error }); return; }
            res.json(r);
        } catch (error) { responderError(res, error); }
    });

    app.get("/autofactura/archivo", async (req, res) => {
        try {
            if (bloqueo(req, res)) return;
            const fila = await autofactura.facturaPorCodigo(pool, { codigo: req.query.codigo, total: req.query.total });
            if (!fila) { limitador.fallo(req.ip); res.status(404).send("No encontrado"); return; }
            const nombre = `factura-${fila.serie || ""}${fila.folio || fila.id}`;
            if (req.query.tipo === "xml") {
                if (!fila.xml_cfdi) { res.status(404).send("Sin XML"); return; }
                res.set({ "Content-Type": "application/xml", "Content-Disposition": `attachment; filename="${nombre}.xml"` }).send(fila.xml_cfdi);
                return;
            }
            const datos = await autofactura.datosFactura(pool, fila.id);
            const pdf = await autofactura.generarPdf(datos);
            res.set({ "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="${nombre}.pdf"` }).send(pdf);
        } catch (error) { responderError(res, error); }
    });
};
