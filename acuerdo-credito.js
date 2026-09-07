// Acuerdo de Credito: genera, congela y acepta las condiciones de una
// cuenta de credito. Principio obligatorio (ver el diseno discutido
// con el dueno): un acuerdo aceptado es una fotografia, nunca una
// consulta en vivo -- por eso condiciones_texto guarda el documento ya
// renderizado, no una plantilla que se re-renderiza despues, y
// contenido_hash permite comprobar despues que no fue alterado.
//
// Tri-estado de la cuenta (igual para Market y para alta directa en el
// POS): APROBADA -> PENDIENTE_DE_ACEPTACION -> ACTIVA. Mientras el
// acuerdo mas reciente de un cliente no tenga estado 'aceptado',
// clientes_credito.acuerdo_vigente_id sigue apuntando al ultimo
// aceptado (o NULL si nunca acepto ninguno) -- eso es lo que bloquea
// vender a credito, no un campo de estado aparte.
const crypto = require("crypto");

const PLAZO_CREDITO_DEFECTO_DIAS = 15;

function generarTokenAceptacion() {
    const token = crypto.randomBytes(32).toString("hex");
    const hash = crypto.createHash("sha256").update(token).digest("hex");
    return { token, hash };
}

function hashDeToken(tokenPlano) {
    return crypto.createHash("sha256").update(String(tokenPlano)).digest("hex");
}

function calcularHashTexto(texto) {
    return crypto.createHash("sha256").update(texto, "utf8").digest("hex");
}

function escaparHtmlAcuerdo(valor) {
    return String(valor ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}

// Documento completo, ya resuelto -- nombre del negocio, direccion,
// limite y plazo otorgados, y la politica del negocio tal como estaba
// en el momento de generar esta version. Nunca referencias a "el
// limite actual del cliente" ni a "la politica actual del negocio".
function renderizarCondicionesTexto({ negocio, cliente, limiteCredito, diasCredito, politicaTexto, version, fecha }) {
    const fechaTexto = new Date(fecha).toLocaleDateString("es-MX", { year: "numeric", month: "long", day: "numeric" });
    const limiteTexto = Number(limiteCredito) > 0
        ? `$${Number(limiteCredito).toLocaleString("es-MX", { minimumFractionDigits: 2 })} MXN`
        : "sujeto a lo que el negocio autorice en cada compra";

    return `<article class="acuerdo-credito-doc">
<h1>Acuerdo de credito</h1>
<p class="acuerdo-credito-version">Version ${Number(version)} -- generado el ${escaparHtmlAcuerdo(fechaTexto)}</p>
<h2>Negocio (acreedor)</h2>
<p>${escaparHtmlAcuerdo(negocio.nombre)}${negocio.direccion ? `<br>${escaparHtmlAcuerdo(negocio.direccion)}` : ""}${negocio.telefono ? `<br>Tel. ${escaparHtmlAcuerdo(negocio.telefono)}` : ""}</p>
<h2>Cliente</h2>
<p>${escaparHtmlAcuerdo(cliente.nombre)}${cliente.telefono ? `<br>Tel. ${escaparHtmlAcuerdo(cliente.telefono)}` : ""}</p>
<h2>Condiciones otorgadas</h2>
<p>Limite de credito: <strong>${limiteTexto}</strong><br>Plazo por compra: <strong>${Number(diasCredito)} dias</strong></p>
${politicaTexto ? `<h2>Politica del negocio</h2><p>${escaparHtmlAcuerdo(politicaTexto)}</p>` : ""}
<h2>Aviso</h2>
<p>El credito es otorgado por ${escaparHtmlAcuerdo(negocio.nombre)}. Nexo proporciona la plataforma tecnologica -- Nexo no presta dinero, no es el acreedor, no garantiza el pago y no decide el limite de credito.</p>
</article>`;
}

async function obtenerNegocioParaAcuerdo(clientOPool, negocioId) {
    const fila = await clientOPool.query(
        `SELECT id, slug, nombre, telefono, direccion FROM public.negocios WHERE id = $1`,
        [negocioId]
    );
    if (!fila.rows.length) throw new Error("Negocio no encontrado");
    return fila.rows[0];
}

async function obtenerConfiguracionCredito(clientOPool, negocioId) {
    const fila = await clientOPool.query(
        `SELECT plazos_disponibles, requiere_identificacion, requiere_domicilio, politica_texto
         FROM public.configuracion_credito_negocio WHERE negocio_id = $1`,
        [negocioId]
    );
    if (fila.rows.length) return fila.rows[0];
    return { plazos_disponibles: [15, 30, 60], requiere_identificacion: false, requiere_domicilio: false, politica_texto: "" };
}

async function registrarBitacoraCredito(clientOPool, negocioId, empleadoId, accion, detalle = {}) {
    await clientOPool.query(
        `INSERT INTO public.bitacora_acciones (negocio_id, empleado_id, accion, detalle) VALUES ($1, $2, $3, $4::jsonb)`,
        [negocioId, empleadoId || null, accion, JSON.stringify(detalle)]
    );
}

// Crea una version nueva. `client` debe ser una conexion ya dentro de
// una transaccion (BEGIN ya ejecutado) con el cliente de credito
// bloqueado por FOR UPDATE -- este modulo no abre su propia
// transaccion, para poder componerse dentro de rutas que ya hacen
// otras cosas (crear el cliente, aprobar la solicitud) en el mismo
// commit.
//
// autoAceptar=true es la unica excepcion al flujo de aceptacion:
// bajar el limite o acortar el plazo (el negocio protegiendose a si
// mismo) se aplica de inmediato, se guarda como version nueva para el
// historial, pero sin fila en aceptaciones_credito -- la ausencia de
// esa fila es justamente la senal de que fue unilateral, no aceptado.
async function crearVersionAcuerdo(client, {
    negocioId,
    clienteCreditoId,
    limiteCredito,
    diasCredito,
    origen,
    solicitudId = null,
    generadoPor,
    autoAceptar = false,
    generarToken = false
}) {
    const negocio = await obtenerNegocioParaAcuerdo(client, negocioId);
    const configuracion = await obtenerConfiguracionCredito(client, negocioId);

    const clienteFila = await client.query(
        `SELECT id, nombre, telefono, persona_id FROM public.clientes_credito WHERE id = $1 AND negocio_id = $2`,
        [clienteCreditoId, negocioId]
    );
    if (!clienteFila.rows.length) throw new Error("Cliente de credito no encontrado");
    const cliente = clienteFila.rows[0];

    const versionFila = await client.query(
        `SELECT COALESCE(MAX(version), 0) + 1 AS siguiente FROM public.acuerdos_credito WHERE cliente_credito_id = $1`,
        [clienteCreditoId]
    );
    const version = versionFila.rows[0].siguiente;

    const fecha = new Date();
    const condicionesTexto = renderizarCondicionesTexto({
        negocio,
        cliente,
        limiteCredito,
        diasCredito,
        politicaTexto: configuracion.politica_texto,
        version,
        fecha
    });
    const contenidoHash = calcularHashTexto(condicionesTexto);

    let tokenPlano = null;
    let tokenHash = null;
    let tokenExpira = null;
    if (generarToken && !autoAceptar) {
        const generado = generarTokenAceptacion();
        tokenPlano = generado.token;
        tokenHash = generado.hash;
        tokenExpira = new Date(fecha.getTime() + 4 * 60 * 60 * 1000); // ventana corta: 4 horas
    }

    const insertado = await client.query(
        `INSERT INTO public.acuerdos_credito
            (negocio_id, cliente_credito_id, version, limite_credito, dias_credito, condiciones_texto, contenido_hash,
             origen, solicitud_id, generado_por, estado, token_aceptacion_hash, token_aceptacion_expira_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11, $12, $13)
         RETURNING *`,
        [
            negocioId,
            clienteCreditoId,
            version,
            limiteCredito,
            diasCredito,
            condicionesTexto,
            contenidoHash,
            origen,
            solicitudId,
            JSON.stringify(generadoPor || {}),
            autoAceptar ? "aceptado" : "pendiente_aceptacion",
            tokenHash,
            tokenExpira
        ]
    );
    const acuerdo = insertado.rows[0];

    // La version anterior (si habia una aceptada) pasa a "reemplazado"
    // -- se conserva para siempre, solo deja de ser la vigente.
    await client.query(
        `UPDATE public.acuerdos_credito SET estado = 'reemplazado'
         WHERE cliente_credito_id = $1 AND id <> $2 AND estado = 'aceptado'`,
        [clienteCreditoId, acuerdo.id]
    );

    if (autoAceptar) {
        await client.query(
            `UPDATE public.clientes_credito SET limite_credito = $1, dias_credito = $2, acuerdo_vigente_id = $3 WHERE id = $4`,
            [limiteCredito, diasCredito, acuerdo.id, clienteCreditoId]
        );
    }

    return { acuerdo, tokenPlano };
}

// Confirma la aceptacion de un acuerdo pendiente -- comparte la misma
// logica sin importar el metodo (sesion de persona en Market, enlace
// de un solo uso desde el POS, o aceptado presencialmente en la
// pantalla del negocio). `client` debe estar dentro de una transaccion
// con el acuerdo bloqueado.
async function confirmarAceptacion(client, { acuerdo, personaId = null, ip = null, userAgent = null, metodo }) {
    if (acuerdo.estado !== "pendiente_aceptacion") {
        const error = new Error("Este acuerdo ya no esta pendiente de aceptacion");
        error.httpStatus = 409;
        throw error;
    }

    const hashActual = calcularHashTexto(acuerdo.condiciones_texto);
    if (hashActual !== acuerdo.contenido_hash) {
        // No deberia pasar nunca (el texto es inmutable una vez
        // guardado) -- si pasa, es una senal de corrupcion de datos,
        // no algo que se deba aceptar en silencio.
        const error = new Error("El contenido del acuerdo no coincide con su hash original");
        error.httpStatus = 500;
        throw error;
    }

    await client.query(
        `UPDATE public.acuerdos_credito SET estado = 'aceptado' WHERE id = $1`,
        [acuerdo.id]
    );

    await client.query(
        `UPDATE public.acuerdos_credito SET estado = 'reemplazado'
         WHERE cliente_credito_id = $1 AND id <> $2 AND estado = 'aceptado'`,
        [acuerdo.cliente_credito_id, acuerdo.id]
    );

    await client.query(
        `UPDATE public.clientes_credito SET limite_credito = $1, dias_credito = $2, acuerdo_vigente_id = $3 WHERE id = $4`,
        [acuerdo.limite_credito, acuerdo.dias_credito, acuerdo.id, acuerdo.cliente_credito_id]
    );

    await client.query(
        `INSERT INTO public.aceptaciones_credito (acuerdo_credito_id, persona_id, ip, user_agent, metodo, contenido_hash_verificado)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [acuerdo.id, personaId, ip, userAgent, metodo, hashActual]
    );

    if (acuerdo.token_aceptacion_hash) {
        await client.query(
            `UPDATE public.acuerdos_credito SET token_aceptacion_usado_at = NOW() WHERE id = $1`,
            [acuerdo.id]
        );
    }
}

// Un token vencido o ya usado no debe obligar a generar una version
// nueva -- el acuerdo (texto, hash, version) no cambia, solo se le da
// una puerta de entrada fresca. Nunca aplica a un acuerdo ya aceptado
// o reemplazado.
async function regenerarTokenAcuerdo(client, acuerdoId) {
    const fila = await client.query(
        `SELECT * FROM public.acuerdos_credito WHERE id = $1 AND estado = 'pendiente_aceptacion' FOR UPDATE`,
        [acuerdoId]
    );
    if (!fila.rows.length) {
        const error = new Error("Este acuerdo ya no esta pendiente de aceptacion");
        error.httpStatus = 409;
        throw error;
    }

    const { token, hash } = generarTokenAceptacion();
    const expira = new Date(Date.now() + 4 * 60 * 60 * 1000);

    await client.query(
        `UPDATE public.acuerdos_credito SET token_aceptacion_hash = $1, token_aceptacion_expira_at = $2, token_aceptacion_usado_at = NULL WHERE id = $3`,
        [hash, expira, acuerdoId]
    );

    return { acuerdo: fila.rows[0], tokenPlano: token };
}

async function buscarAcuerdoPorToken(client, tokenPlano) {
    const hash = hashDeToken(tokenPlano);
    const fila = await client.query(
        `SELECT * FROM public.acuerdos_credito
         WHERE token_aceptacion_hash = $1 AND estado = 'pendiente_aceptacion'
         AND token_aceptacion_usado_at IS NULL AND token_aceptacion_expira_at > NOW()
         FOR UPDATE`,
        [hash]
    );
    return fila.rows[0] || null;
}

module.exports = {
    PLAZO_CREDITO_DEFECTO_DIAS,
    generarTokenAceptacion,
    hashDeToken,
    calcularHashTexto,
    renderizarCondicionesTexto,
    crearVersionAcuerdo,
    confirmarAceptacion,
    regenerarTokenAcuerdo,
    buscarAcuerdoPorToken,
    registrarBitacoraCredito,
    obtenerConfiguracionCredito
};
