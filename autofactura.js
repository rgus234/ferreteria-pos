// Autofactura: el cliente pide su propia factura con el codigo de su ticket y el total (sin que el negocio haga nada).
// Aqui vive la logica (consultar, emitir, PDF); las rutas publicas estan en autofactura-server.js.
//
// Reglas:
//   - Solo si el negocio la encendio a proposito (funciones_beta.autofactura = true) y ya tiene facturacion CFDI activa.
//   - Una venta se factura una sola vez; ventas canceladas, con descuento o a credito no se facturan (mismos limites que la factura manual).
//   - Plazo: PLAZO_DIAS desde la venta (confirmar con el contador del negocio; se cambia aqui).
//   - El cliente debe poner el total exacto del ticket: eso prueba que tiene el ticket en la mano.
const PDFDocument = require("pdfkit");
const QRCode = require("qrcode");
const { armarConceptosFactura, formaPagoSat, urlVerificacionSat } = require("./facturacion-server");
const { funcionDelPlan } = require("./plan-enforcement");
const timbres = require("./timbres");

const PLAZO_DIAS = 30;
const RFC_GENERICOS = ["XAXX010101000", "XEXX010101000"];
const PATRON_RFC = /^[A-ZÑ&]{3,4}\d{6}[A-Z0-9]{3}$/;
const PATRON_CORREO = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

// Catalogos del SAT que el cliente elige (solo los de uso comun). fisica / moral = para que tipo de RFC aplican.
const REGIMENES = [
    { clave: "601", nombre: "General de Ley Personas Morales", moral: true },
    { clave: "603", nombre: "Personas Morales con Fines no Lucrativos", moral: true },
    { clave: "605", nombre: "Sueldos y Salarios e Ingresos Asimilados a Salarios", fisica: true },
    { clave: "606", nombre: "Arrendamiento", fisica: true, moral: true },
    { clave: "607", nombre: "Régimen de Enajenación o Adquisición de Bienes", fisica: true },
    { clave: "608", nombre: "Demás ingresos", fisica: true },
    { clave: "610", nombre: "Residentes en el Extranjero sin Establecimiento Permanente en México", fisica: true, moral: true },
    { clave: "611", nombre: "Ingresos por Dividendos (socios y accionistas)", fisica: true },
    { clave: "612", nombre: "Personas Físicas con Actividades Empresariales y Profesionales", fisica: true },
    { clave: "614", nombre: "Ingresos por intereses", fisica: true },
    { clave: "615", nombre: "Régimen de los ingresos por obtención de premios", fisica: true },
    { clave: "616", nombre: "Sin obligaciones fiscales", fisica: true },
    { clave: "620", nombre: "Sociedades Cooperativas de Producción", moral: true },
    { clave: "621", nombre: "Incorporación Fiscal", fisica: true },
    { clave: "622", nombre: "Actividades Agrícolas, Ganaderas, Silvícolas y Pesqueras", moral: true },
    { clave: "623", nombre: "Opcional para Grupos de Sociedades", moral: true },
    { clave: "624", nombre: "Coordinados", moral: true },
    { clave: "625", nombre: "Actividades Empresariales con ingresos a través de Plataformas Tecnológicas", fisica: true },
    { clave: "626", nombre: "Régimen Simplificado de Confianza (RESICO)", fisica: true, moral: true }
];

const USOS_CFDI = [
    { clave: "G01", nombre: "Adquisición de mercancías" },
    { clave: "G03", nombre: "Gastos en general" },
    { clave: "I01", nombre: "Construcciones" },
    { clave: "I04", nombre: "Equipo de cómputo y accesorios" },
    { clave: "I08", nombre: "Otra maquinaria y equipo" },
    { clave: "D01", nombre: "Honorarios médicos, dentales y gastos hospitalarios" },
    { clave: "S01", nombre: "Sin efectos fiscales" },
    { clave: "CP01", nombre: "Pagos" }
];

const redondear = valor => Math.round((Number(valor) || 0) * 100) / 100;
const limpiar = (valor, max = 160) => String(valor || "").replace(/\s+/g, " ").trim().slice(0, max);
const normalizarCodigo = valor => String(valor || "").toUpperCase().replace(/[^A-Z0-9]/g, "");

function productosDe(venta) {
    try {
        const lista = typeof venta.productos === "string" ? JSON.parse(venta.productos) : venta.productos;
        return Array.isArray(lista) ? lista : [];
    } catch (error) {
        return [];
    }
}

function totalCoincide(totalCapturado, totalVenta) {
    const capturado = Number(String(totalCapturado ?? "").replace(/[$,\s]/g, ""));
    return Number.isFinite(capturado) && Math.abs(capturado - Number(totalVenta)) < 0.005;
}

async function ventaConNegocio(pool, codigo) {
    if (!codigo) return null;
    const resultado = await pool.query(
        `SELECT h.id, h.negocio_id, h.cliente_id, h.total, h.subtotal, h.descuento, h.metodo_pago, h.folio, h.folio_numero, h.productos, h.estado, h.fecha, h.codigo_publico,
                n.nombre AS negocio_nombre, n.logo AS negocio_logo, n.color AS negocio_color, n.telefono AS negocio_telefono,
                n.rfc, n.razon_social, n.regimen_fiscal, n.codigo_postal_fiscal, n.facturacion_activa,
                n.facturacion_clave_prod_serv_default, n.facturacion_clave_unidad_default, n.funciones_beta
         FROM public.historial_ventas h JOIN public.negocios n ON n.id = h.negocio_id
         WHERE h.codigo_publico = $1`,
        [codigo]
    );
    return resultado.rows[0] || null;
}

function marcaDe(venta) {
    return {
        nombre: venta.negocio_nombre || "Tu negocio",
        logo: venta.negocio_logo || null,
        color: /^#[0-9a-fA-F]{6}$/.test(venta.negocio_color || "") ? venta.negocio_color : "#1067e8"
    };
}

// Solo la marca del negocio (para pintar la pagina antes de que el cliente escriba el total).
async function marcaPorCodigo(pool, codigoCrudo) {
    const venta = await ventaConNegocio(pool, normalizarCodigo(codigoCrudo));
    return venta ? marcaDe(venta) : null;
}

async function motivoNoDisponible(pool, venta) {
    const flag = venta.funciones_beta && venta.funciones_beta.autofactura === true;
    if (!flag || !venta.facturacion_activa) return "Este negocio todavía no ofrece facturación en línea. Pídela directo en caja.";
    try {
        if (!(await timbres.puedeFacturar(pool, venta.negocio_id, funcionDelPlan))) return "Este negocio todavía no ofrece facturación en línea. Pídela directo en caja.";
        if (!(await timbres.hayTimbres(pool, venta.negocio_id))) return "Este negocio no puede facturar en línea por ahora. Pídela directo en caja.";
    } catch (error) {
        return "No pudimos revisar la facturación de este negocio. Intenta en un rato.";
    }
    if (venta.estado === "cancelada") return "Esta venta fue cancelada, no se puede facturar.";
    if (String(venta.metodo_pago).toLowerCase() === "credito") return "Las compras a crédito se facturan cuando se liquidan. Pídela directo en caja.";
    if (!productosDe(venta).length) return "Esta compra no tiene productos que facturar.";
    const dias = (Date.now() - new Date(venta.fecha).getTime()) / 86400000;
    if (dias > PLAZO_DIAS) return `El plazo para facturar en línea (${PLAZO_DIAS} días) ya pasó. Pídela directo en caja.`;
    return null;
}

function resumenVenta(venta) {
    return {
        folio: venta.folio || String(venta.folio_numero || venta.id),
        fecha: venta.fecha,
        total: Number(venta.total),
        productos: productosDe(venta).map(p => ({ nombre: String(p.nombre || "Producto"), cantidad: Number(p.cantidad || 1), importe: Number(p.importe ?? (Number(p.precio || 0) * Number(p.cantidad || 1))) }))
    };
}

// Paso 1 del cliente: codigo + total. Responde la marca, el resumen de la compra y si se puede facturar.
async function consultar(pool, { codigo, total }) {
    const venta = await ventaConNegocio(pool, normalizarCodigo(codigo));
    if (!venta || !totalCoincide(total, venta.total)) return { ok: false, noEncontrada: true, error: "No encontramos esa compra. Revisa el código y el total del ticket." };

    const marca = marcaDe(venta);
    const resumen = resumenVenta(venta);
    const timbrada = (await pool.query(`SELECT id, serie, folio, uuid, receptor_rfc, receptor_correo FROM public.facturas_cfdi WHERE historial_venta_id = $1 AND estado = 'timbrada' LIMIT 1`, [venta.id])).rows[0];

    if (timbrada) {
        return { ok: true, estado: "facturada", marca, venta: resumen, factura: { folio: `${timbrada.serie || ""}${timbrada.folio || timbrada.id}`, uuid: timbrada.uuid, rfc: timbrada.receptor_rfc, correo: enmascararCorreo(timbrada.receptor_correo) } };
    }

    const motivo = await motivoNoDisponible(pool, venta);
    if (motivo) return { ok: true, estado: "no_disponible", motivo, marca, venta: resumen };
    return { ok: true, estado: "disponible", marca, venta: resumen };
}

function enmascararCorreo(correo) {
    const texto = String(correo || "");
    const [usuario, dominio] = texto.split("@");
    if (!usuario || !dominio) return "";
    return `${usuario.slice(0, 2)}${"•".repeat(Math.max(1, usuario.length - 2))}@${dominio}`;
}

function validarReceptor(receptor) {
    const rfc = limpiar(receptor?.rfc, 13).toUpperCase();
    const datos = {
        rfc,
        nombre: limpiar(receptor?.nombre, 250).toUpperCase(),
        regimenFiscal: limpiar(receptor?.regimenFiscal, 4),
        codigoPostal: limpiar(receptor?.codigoPostal, 5),
        usoCfdi: limpiar(receptor?.usoCfdi, 4).toUpperCase() || "G03",
        correo: limpiar(receptor?.correo, 200).toLowerCase()
    };
    if (RFC_GENERICOS.includes(rfc)) return { error: "Escribe tu RFC con homoclave, no el genérico." };
    if (!PATRON_RFC.test(rfc)) return { error: "Revisa tu RFC: debe tener 12 (empresa) o 13 (persona) caracteres." };
    if (datos.nombre.length < 3) return { error: "Escribe tu nombre o razón social tal como aparece en tu Constancia de Situación Fiscal." };
    if (!REGIMENES.some(r => r.clave === datos.regimenFiscal)) return { error: "Elige tu régimen fiscal." };
    if (!/^\d{5}$/.test(datos.codigoPostal)) return { error: "El código postal fiscal debe tener 5 dígitos." };
    if (!USOS_CFDI.some(u => u.clave === datos.usoCfdi)) return { error: "Elige el uso de la factura." };
    if (!PATRON_CORREO.test(datos.correo)) return { error: "Escribe un correo válido: ahí te mandamos tu factura." };
    return { receptor: datos };
}

// Paso 2: emite la factura. deps = { crearCfdi, descargarXmlCfdi, enviarCorreoFacturaCfdi } (se inyectan para poder probarlo sin Facturama).
async function emitir(pool, deps, { codigo, total, receptor: receptorCrudo }) {
    const verificado = validarReceptor(receptorCrudo);
    if (verificado.error) return { ok: false, status: 400, error: verificado.error };
    const receptor = verificado.receptor;

    const venta = await ventaConNegocio(pool, normalizarCodigo(codigo));
    if (!venta || !totalCoincide(total, venta.total)) return { ok: false, status: 404, error: "No encontramos esa compra. Revisa el código y el total del ticket." };

    const motivo = await motivoNoDisponible(pool, venta);
    if (motivo) return { ok: false, status: 400, error: motivo };

    const items = armarConceptosFactura(productosDe(venta), venta.facturacion_clave_prod_serv_default || "01010101", venta.facturacion_clave_unidad_default || "H87", Number(venta.descuento) || 0);
    if (!items) return { ok: false, status: 400, error: "Esta compra no tiene productos que facturar." };
    if (Number(venta.descuento) > 0 && Math.abs(items.reduce((x, i) => x + i.Total, 0) - Number(venta.total)) > 0.011) {
        return { ok: false, status: 400, error: "Los importes de esta compra no cuadran con su total. Pide tu factura directo en caja." };
    }

    const cliente = await pool.connect();
    try {
        // Un candado por venta: dos clics (o dos celulares) al mismo tiempo no timbran dos veces.
        await cliente.query(`SELECT pg_advisory_lock(7001, $1)`, [venta.id]);
        try {
            const ya = (await cliente.query(`SELECT id FROM public.facturas_cfdi WHERE historial_venta_id = $1 AND estado = 'timbrada' LIMIT 1`, [venta.id])).rows[0];
            if (ya) return { ok: false, status: 409, error: "Esta compra ya tiene su factura. Búscala con el mismo código y total." };

            const comprobante = {
                CfdiType: "I",
                PaymentForm: formaPagoSat(venta.metodo_pago),
                PaymentMethod: "PUE",
                ExpeditionPlace: venta.codigo_postal_fiscal,
                Folio: String(venta.folio_numero || venta.id),
                Issuer: { FiscalRegime: venta.regimen_fiscal, Rfc: venta.rfc, Name: venta.razon_social },
                Receiver: { Rfc: receptor.rfc, CfdiUse: receptor.usoCfdi, Name: receptor.nombre, FiscalRegime: receptor.regimenFiscal, TaxZipCode: receptor.codigoPostal },
                Items: items
            };
            const total_ = redondear(items.reduce((a, i) => a + i.Total, 0));
            const subtotal = redondear(items.reduce((a, i) => a + i.Subtotal, 0));

            // Cobro de timbres (si esta encendido): se aparta 1 y vuelve si el PAC rechaza.
            const reserva = await timbres.reservar(pool, venta.negocio_id, `venta:${venta.id}`);
            if (!reserva.ok) return { ok: false, status: 400, error: "Este negocio no puede facturar en línea por ahora. Pídela directo en caja." };

            let resultado;
            try { resultado = await deps.crearCfdi(comprobante); } catch (errorPac) { await timbres.devolver(pool, venta.negocio_id); throw errorPac; }

            if (!resultado.ok) {
                await timbres.devolver(pool, venta.negocio_id);
                await cliente.query(
                    `INSERT INTO public.facturas_cfdi (negocio_id, historial_venta_id, cliente_id, receptor_rfc, receptor_nombre, receptor_uso_cfdi, receptor_regimen_fiscal, receptor_codigo_postal, receptor_correo, estado, error_mensaje, subtotal, total, creado_por)
                     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'error',$10,$11,$12,'Autofactura (cliente)')`,
                    [venta.negocio_id, venta.id, venta.cliente_id, receptor.rfc, receptor.nombre, receptor.usoCfdi, receptor.regimenFiscal, receptor.codigoPostal, receptor.correo, resultado.error, subtotal, total_]
                );
                return { ok: false, status: 400, error: mensajeAmable(resultado.error) };
            }

            const factura = resultado.factura;
            let xml = factura.xml || null;
            if (!xml && factura.facturamaId) {
                const descarga = await deps.descargarXmlCfdi(factura.facturamaId);
                if (descarga.ok) xml = descarga.xml;
            }

            const fila = (await cliente.query(
                `INSERT INTO public.facturas_cfdi (negocio_id, historial_venta_id, cliente_id, receptor_rfc, receptor_nombre, receptor_uso_cfdi, receptor_regimen_fiscal, receptor_codigo_postal, receptor_correo, serie, folio, uuid, estado, subtotal, total, xml_cfdi, facturama_id, creado_por, timbrada_at)
                 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'timbrada',$13,$14,$15,$16,'Autofactura (cliente)',NOW())
                 RETURNING id, serie, folio, uuid, total`,
                [venta.negocio_id, venta.id, venta.cliente_id, receptor.rfc, receptor.nombre, receptor.usoCfdi, receptor.regimenFiscal, receptor.codigoPostal, receptor.correo, factura.serie, factura.folio, factura.uuid, subtotal, total_, xml, factura.facturamaId ? String(factura.facturamaId) : null]
            )).rows[0];
            await cliente.query(`UPDATE public.historial_ventas SET requiere_factura = false WHERE id = $1`, [venta.id]);

            const correoEnviado = await enviarPorCorreo(pool, deps, fila.id, receptor.correo);
            return { ok: true, factura: { folio: `${fila.serie || ""}${fila.folio || fila.id}`, uuid: fila.uuid, total: Number(fila.total) }, correoEnviado, correo: enmascararCorreo(receptor.correo) };
        } finally {
            await cliente.query(`SELECT pg_advisory_unlock(7001, $1)`, [venta.id]);
        }
    } finally {
        cliente.release();
    }
}

// El PAC (Facturama) contesta en tecnico; el cliente necesita saber que corregir.
function mensajeAmable(texto) {
    const t = String(texto || "");
    if (/rfc|receptor|receiver/i.test(t)) return "No pudimos timbrar: revisa que tu RFC, nombre, régimen y código postal sean exactamente los de tu Constancia de Situación Fiscal. (" + t.slice(0, 160) + ")";
    return "No pudimos generar tu factura en este momento. " + t.slice(0, 200);
}

async function enviarPorCorreo(pool, deps, facturaId, correo) {
    try {
        const datos = await datosFactura(pool, facturaId);
        if (!datos) return false;
        const pdf = await generarPdf(datos);
        const resultado = await deps.enviarCorreoFacturaCfdi(correo, datos.emisor.razon_social || datos.marca.nombre, {
            folioTexto: `${datos.factura.serie || ""}${datos.factura.folio || facturaId}`,
            uuid: datos.factura.uuid || "--",
            totalTexto: `$${Number(datos.factura.total || 0).toFixed(2)}`,
            xmlContent: datos.factura.xml_cfdi || null,
            pdfContent: pdf
        });
        return Boolean(resultado && resultado.ok);
    } catch (error) {
        console.warn("[autofactura] No se pudo mandar el correo:", error.message);
        return false;
    }
}

async function reenviar(pool, deps, { codigo, total, correo }) {
    const venta = await ventaConNegocio(pool, normalizarCodigo(codigo));
    if (!venta || !totalCoincide(total, venta.total)) return { ok: false, status: 404, error: "No encontramos esa compra." };
    const destino = limpiar(correo, 200).toLowerCase();
    if (!PATRON_CORREO.test(destino)) return { ok: false, status: 400, error: "Escribe un correo válido." };
    const factura = (await pool.query(`SELECT id FROM public.facturas_cfdi WHERE historial_venta_id = $1 AND estado = 'timbrada' LIMIT 1`, [venta.id])).rows[0];
    if (!factura) return { ok: false, status: 404, error: "Esta compra todavía no tiene factura." };
    const enviado = await enviarPorCorreo(pool, deps, factura.id, destino);
    return enviado ? { ok: true } : { ok: false, status: 502, error: "No pudimos mandar el correo. Descarga tus archivos aquí mismo." };
}

// Datos completos de una factura timbrada, para el PDF.
async function datosFactura(pool, facturaId) {
    const factura = (await pool.query(
        `SELECT f.*, h.productos, h.descuento AS venta_descuento, h.metodo_pago, h.fecha AS fecha_venta FROM public.facturas_cfdi f JOIN public.historial_ventas h ON h.id = f.historial_venta_id WHERE f.id = $1 AND f.estado = 'timbrada'`,
        [facturaId]
    )).rows[0];
    if (!factura) return null;
    const emisor = (await pool.query(`SELECT nombre, rfc, razon_social, regimen_fiscal, codigo_postal_fiscal, color, logo FROM public.negocios WHERE id = $1`, [factura.negocio_id])).rows[0];
    const conceptos = armarConceptosFactura(productosDe(factura), "", "", Number(factura.venta_descuento) || 0) || [];
    let qr = null;
    if (factura.uuid) {
        try { qr = await QRCode.toBuffer(urlVerificacionSat({ uuid: factura.uuid, rfcEmisor: emisor.rfc, rfcReceptor: factura.receptor_rfc, total: factura.total }), { width: 220, margin: 1 }); } catch (error) { qr = null; }
    }
    return { factura, emisor, conceptos, qr, marca: { nombre: emisor.nombre, color: /^#[0-9a-fA-F]{6}$/.test(emisor.color || "") ? emisor.color : "#1067e8" } };
}

async function facturaPorCodigo(pool, { codigo, total }) {
    const venta = await ventaConNegocio(pool, normalizarCodigo(codigo));
    if (!venta || !totalCoincide(total, venta.total)) return null;
    const fila = (await pool.query(`SELECT id, serie, folio, xml_cfdi FROM public.facturas_cfdi WHERE historial_venta_id = $1 AND estado = 'timbrada' LIMIT 1`, [venta.id])).rows[0];
    return fila || null;
}

const dinero = v => "$" + Number(v || 0).toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const nombreRegimen = clave => { const r = REGIMENES.find(x => x.clave === clave); return r ? `${clave} - ${r.nombre}` : clave; };
const nombreUso = clave => { const u = USOS_CFDI.find(x => x.clave === clave); return u ? `${clave} - ${u.nombre}` : clave; };
const NOMBRE_PAGO = { "01": "01 - Efectivo", "03": "03 - Transferencia electrónica", "04": "04 - Tarjeta de crédito", "99": "99 - Por definir" };

// PDF de la factura (representacion impresa de un CFDI), tamaño carta, con el color del negocio.
function generarPdf({ factura, emisor, conceptos, qr, marca }) {
    return new Promise((resolve, reject) => {
        const doc = new PDFDocument({ size: "LETTER", margin: 40 });
        const trozos = [];
        doc.on("data", t => trozos.push(t));
        doc.on("end", () => resolve(Buffer.concat(trozos)));
        doc.on("error", reject);

        const color = marca.color;
        const ancho = doc.page.width - 80;

        doc.rect(0, 0, doc.page.width, 92).fill(color);
        doc.fillColor("#ffffff").font("Helvetica-Bold").fontSize(20).text(emisor.razon_social || emisor.nombre || "", 40, 26, { width: ancho - 150 });
        doc.font("Helvetica").fontSize(10).text(`RFC ${emisor.rfc || ""}`, 40, 56);
        doc.font("Helvetica-Bold").fontSize(11).text("FACTURA", 40, 30, { width: ancho, align: "right" });
        doc.font("Helvetica").fontSize(10).text(`Folio ${factura.serie || ""}${factura.folio || factura.id}`, 40, 46, { width: ancho, align: "right" });
        doc.text(new Date(factura.timbrada_at || factura.created_at).toLocaleString("es-MX"), 40, 60, { width: ancho, align: "right" });

        doc.fillColor("#111827");
        // Cada linea mide su propio alto (un regimen largo ocupa dos renglones sin encimarse con la siguiente).
        const caja = (titulo, lineas, x, y, w) => {
            doc.font("Helvetica-Bold").fontSize(9).fillColor(color).text(titulo.toUpperCase(), x, y, { width: w });
            doc.font("Helvetica").fontSize(10).fillColor("#111827");
            let yy = y + 14;
            lineas.forEach(l => { doc.text(l, x, yy, { width: w }); yy += doc.heightOfString(l, { width: w }) + 3; });
            return yy;
        };
        const fin1 = caja("Emisor", [emisor.razon_social || "", `RFC: ${emisor.rfc || ""}`, `Régimen: ${nombreRegimen(emisor.regimen_fiscal)}`, `C.P. de expedición: ${emisor.codigo_postal_fiscal || ""}`], 40, 112, ancho / 2 - 10);
        const fin2 = caja("Receptor", [factura.receptor_nombre, `RFC: ${factura.receptor_rfc}`, `Régimen: ${nombreRegimen(factura.receptor_regimen_fiscal)}`, `C.P.: ${factura.receptor_codigo_postal}`, `Uso del CFDI: ${nombreUso(factura.receptor_uso_cfdi)}`], 40 + ancho / 2 + 10, 112, ancho / 2 - 10);

        let y = Math.max(fin1, fin2) + 16;
        const hayDescuento = conceptos.some(c => Number(c.Discount) > 0);
        const columnas = [40, 90, 290, 365, 440, 505];
        doc.rect(40, y, ancho, 20).fill(color);
        doc.fillColor("#ffffff").font("Helvetica-Bold").fontSize(9);
        doc.text("Cant.", columnas[0] + 6, y + 6); doc.text("Descripción", columnas[1], y + 6);
        doc.text("P. unitario", columnas[2], y + 6, { width: 70, align: "right" }); doc.text(hayDescuento ? "Descuento" : "", columnas[3], y + 6, { width: 70, align: "right" }); doc.text("IVA", columnas[4], y + 6, { width: 60, align: "right" }); doc.text("Importe", columnas[5], y + 6, { width: 67, align: "right" });
        y += 26;
        doc.fillColor("#111827").font("Helvetica").fontSize(9);
        conceptos.forEach(c => {
            if (y > 640) { doc.addPage(); y = 50; }
            const alto = doc.heightOfString(c.Description, { width: 190 });
            doc.text(String(c.Quantity), columnas[0] + 6, y);
            doc.text(c.Description, columnas[1], y, { width: 190 });
            doc.text(dinero(c.UnitPrice), columnas[2], y, { width: 70, align: "right" });
            doc.text(hayDescuento ? dinero(c.Discount || 0) : "", columnas[3], y, { width: 70, align: "right" });
            doc.text(dinero(c.Taxes[0].Total), columnas[4], y, { width: 60, align: "right" });
            doc.text(dinero(c.Total), columnas[5], y, { width: 67, align: "right" });
            y += Math.max(alto, 12) + 7;
            doc.moveTo(40, y - 3).lineTo(40 + ancho, y - 3).strokeColor("#e5e7eb").lineWidth(0.5).stroke();
        });

        const iva = conceptos.reduce((x, c) => x + Number(c.Taxes[0].Total), 0);
        const descuentoTotal = conceptos.reduce((x, c) => x + Number(c.Discount || 0), 0);
        y += 8;
        doc.font("Helvetica").fontSize(10).fillColor("#111827");
        doc.text("Subtotal", 380, y, { width: 90, align: "right" }); doc.text(dinero(factura.subtotal), 472, y, { width: 100, align: "right" }); y += 15;
        if (descuentoTotal > 0) { doc.text("Descuento", 380, y, { width: 90, align: "right" }); doc.text("-" + dinero(descuentoTotal), 472, y, { width: 100, align: "right" }); y += 15; }
        doc.text("IVA 16%", 380, y, { width: 90, align: "right" }); doc.text(dinero(iva), 472, y, { width: 100, align: "right" }); y += 15;
        doc.font("Helvetica-Bold").fontSize(13).fillColor(color).text("Total", 380, y, { width: 90, align: "right" }); doc.text(dinero(factura.total), 472, y, { width: 100, align: "right" }); y += 34;

        const yPie = Math.max(y, 600);
        if (qr) doc.image(qr, 40, yPie, { width: 96 });
        doc.fillColor("#111827").font("Helvetica-Bold").fontSize(9).text("Folio fiscal (UUID)", 150, yPie);
        doc.font("Helvetica").fontSize(9).text(factura.uuid || "", 150, yPie + 12);
        doc.font("Helvetica-Bold").text("Forma de pago", 150, yPie + 32); doc.font("Helvetica").text(NOMBRE_PAGO[formaPagoSat(factura.metodo_pago)] || "99 - Por definir", 150, yPie + 44);
        doc.font("Helvetica-Bold").text("Método de pago", 330, yPie + 32); doc.font("Helvetica").text("PUE - Pago en una sola exhibición", 330, yPie + 44);
        doc.fillColor("#6b7280").fontSize(8).text("Este documento es una representación impresa de un CFDI. Escanea el QR para verificarlo en el SAT. Factura generada con Nexo.", 150, yPie + 70, { width: 420 });
        doc.end();
    });
}

module.exports = { PLAZO_DIAS, REGIMENES, USOS_CFDI, normalizarCodigo, marcaPorCodigo, consultar, emitir, reenviar, facturaPorCodigo, datosFactura, generarPdf, validarReceptor, totalCoincide };
