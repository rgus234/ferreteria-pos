// Recepcion Inteligente, Fase 1: pantalla de revision. Sin Gmail
// todavia -- "Subir factura" es el stand-in manual de lo que en la
// Fase 2 hara la conexion de correo sola. El resto del flujo (motor de
// candidatos, tabla de revision, confirmar) es identico al que tendra
// esa fase, para no reescribir nada cuando el correo entre solo.
//
// Principio del diseno aprobado: ningun boton de esta pantalla toca
// inventario excepto "Confirmar recepcion", y solo despues de que
// cada concepto amarillo ya tiene una decision humana.
let recepcionInteligenteActualId = null;

const RI_NIVEL_ETIQUETA = { fuerte: "🟢 Identificado", probable: "🟡 Revisar" };

function riBadgeEstado(recepcion) {
	if (recepcion.porRevisar === 0) return `<span class="ri-badge ri-badge-ok">🟢 Todo identificado</span>`;
	return `<span class="ri-badge ri-badge-revisar">🟡 ${recepcion.porRevisar} por revisar</span>`;
}

function riBadgeGeneral(estado) {
	if (estado === "confirmada") return `<span class="ri-badge ri-badge-ok">Confirmada</span>`;
	if (estado === "rechazada") return `<span class="ri-badge ri-badge-rechazada">Rechazada</span>`;
	return `<span class="ri-badge ri-badge-pendiente">Pendiente de revisión</span>`;
}

async function mostrarRecepcionInteligente() {
	if (typeof ocultarPantallasPrincipales === "function") ocultarPantallasPrincipales();

	const pantalla = document.getElementById("pantallaRecepcionInteligente");
	if (!pantalla) return;

	pantalla.style.display = "block";

	if (typeof actualizarTopbarContexto === "function") {
		actualizarTopbarContexto("Recepción Inteligente", "Facturas de proveedor convertidas en recepción pendiente de revisión.", "recepcion-inteligente");
	}

	recepcionInteligenteActualId = null;

	pantalla.innerHTML = `
		<div class="encargos-shell">
			<div class="encargos-header">
				<h2>Recepción Inteligente</h2>
				<p>Sube el XML de una factura de proveedor. Nexo identifica los productos y arma una recepción pendiente de revisión -- nunca toca tu inventario hasta que la confirmes.</p>
			</div>

			<div class="ri-subir-fila">
				<input type="file" id="riArchivoXml" accept=".xml,text/xml" style="display:none" onchange="riSubirFacturaSeleccionada(event)">
				<button type="button" class="btn-agregar" onclick="document.getElementById('riArchivoXml').click()">📎 Subir factura (XML)</button>
				<span id="riSubiendoAviso" style="display:none">Leyendo factura…</span>
			</div>

			<div class="explorar-nexo-grid">
				<div class="explorar-nexo-resultados" id="riListaFacturas">
					<p class="explorar-nexo-vacio">Cargando…</p>
				</div>
				<div class="encargos-panel explorar-nexo-ficha" id="riDetalleFactura">
					<p class="explorar-nexo-ficha-vacio">Selecciona una factura para revisarla.</p>
				</div>
			</div>
		</div>
	`;

	await riCargarLista();
}

async function riSubirFacturaSeleccionada(event) {
	const archivo = event.target.files?.[0];
	event.target.value = "";
	if (!archivo) return;

	const aviso = document.getElementById("riSubiendoAviso");
	if (aviso) aviso.style.display = "inline";

	try {
		const xml = await archivo.text();
		const respuesta = await fetch("/recepcion-inteligente/facturas", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ xml })
		});
		const datos = await respuesta.json().catch(() => ({}));

		if (!respuesta.ok || !datos.ok) {
			await alertaPOS(datos.error || "No se pudo leer la factura.", "Recepción Inteligente", "peligro");
			return;
		}

		if (datos.repetida) {
			await alertaPOS("Esta factura ya se había subido antes (mismo UUID). No se creó una recepción duplicada.", "Factura repetida", "info");
		} else {
			await alertaPOS(`Factura leída: ${datos.totalConceptos} producto(s), ${datos.identificados} identificados automáticamente, ${datos.porRevisar} por revisar.`, "Factura detectada", "exito");
		}

		await riCargarLista();
		if (datos.recepcionId) await riVerDetalle(datos.recepcionId);
	} catch (error) {
		await alertaPOS("No se pudo leer el archivo. ¿Es un XML de factura válido?", "Recepción Inteligente", "peligro");
	} finally {
		if (aviso) aviso.style.display = "none";
	}
}

async function riCargarLista() {
	const contenedor = document.getElementById("riListaFacturas");
	if (!contenedor) return;

	try {
		const respuesta = await fetch("/recepcion-inteligente/facturas");
		const datos = await respuesta.json();

		if (!datos.facturas?.length) {
			contenedor.innerHTML = `<p class="explorar-nexo-vacio">Todavía no has subido ninguna factura.</p>`;
			return;
		}

		contenedor.innerHTML = datos.facturas.map(f => `
			<div class="ri-fila-factura ${recepcionInteligenteActualId === f.id ? "activa" : ""}" onclick="riVerDetalle(${f.id})">
				<div class="ri-fila-factura-principal">
					<strong>${escaparPOS(f.proveedor)}</strong>
					<span>Folio ${escaparPOS(f.folio || "-")} &middot; $${f.total.toFixed(2)}</span>
				</div>
				<div class="ri-fila-factura-estado">
					${riBadgeGeneral(f.estado)}
					${f.estado === "pendiente" ? riBadgeEstado(f) : ""}
				</div>
			</div>
		`).join("");
	} catch (error) {
		contenedor.innerHTML = `<p class="explorar-nexo-vacio">No se pudo cargar la lista.</p>`;
	}
}

async function riVerDetalle(id) {
	recepcionInteligenteActualId = id;
	await riCargarLista();

	const panel = document.getElementById("riDetalleFactura");
	if (!panel) return;
	panel.innerHTML = `<p class="explorar-nexo-ficha-vacio">Cargando…</p>`;

	const respuesta = await fetch(`/recepcion-inteligente/facturas/${id}`);
	const datos = await respuesta.json();

	if (!datos.ok) {
		panel.innerHTML = `<p class="explorar-nexo-ficha-vacio">No se pudo cargar esta factura.</p>`;
		return;
	}

	const { recepcion, items } = datos;
	const sinDecidir = items.filter(it => !it.accion).length;

	panel.innerHTML = `
		<h3>${escaparPOS(recepcion.proveedor)}</h3>
		<p class="explorar-nexo-ficha-fuente">Folio ${escaparPOS(recepcion.folio || "-")} &middot; ${recepcion.fechaDocumento || ""} &middot; ${riBadgeGeneral(recepcion.estado)}</p>

		<div class="ri-tabla-wrap">
			<table class="ri-tabla-items">
				<thead><tr><th>Producto</th><th>Código</th><th>Cant.</th><th>Costo</th><th>Estado</th><th></th></tr></thead>
				<tbody>
					${items.map(it => riFilaItem(it, recepcion.estado)).join("")}
				</tbody>
			</table>
		</div>

		<dl class="explorar-nexo-ficha-datos">
			<dt>Subtotal</dt><dd>$${recepcion.subtotal.toFixed(2)}</dd>
			<dt>IVA</dt><dd>$${recepcion.iva.toFixed(2)}</dd>
			<dt>Total</dt><dd>$${recepcion.total.toFixed(2)}</dd>
		</dl>

		${recepcion.estado === "pendiente" ? `
			<div class="ri-acciones-footer">
				<button type="button" class="btn-secundario" onclick="riRechazar(${recepcion.id})">Rechazar factura</button>
				<button type="button" class="btn-agregar" onclick="riConfirmar(${recepcion.id})">
					Confirmar recepción${sinDecidir ? ` (${sinDecidir} sin revisar)` : ""}
				</button>
			</div>
		` : ""}
	`;
}

function riFilaItem(item, estadoRecepcion) {
	const nivel = item.nivel ? RI_NIVEL_ETIQUETA[item.nivel] : "🟡 Sin identificar";
	const yaDecidido = item.accion === "relacionar" ? "Relacionado"
		: item.accion === "crear" ? "Producto nuevo"
		: item.accion === "omitir" ? "Omitido"
		: nivel;

	const puedeEditar = estadoRecepcion === "pendiente";

	return `
		<tr>
			<td>${escaparPOS(item.descripcion)}${item.candidato?.nombre ? `<br><small>${escaparPOS(item.candidato.nombre)}</small>` : ""}</td>
			<td>${escaparPOS(item.codigo || "-")}</td>
			<td>${item.cantidad}</td>
			<td>$${item.costo.toFixed(2)}</td>
			<td>${yaDecidido}</td>
			<td>${puedeEditar && !item.accion ? `
				<button type="button" class="btn-mini" onclick="riRelacionarProducto(${item.id}, '${escaparPOS(item.descripcion).replace(/'/g, "\\'")}')">Relacionar</button>
				<button type="button" class="btn-mini" onclick="riCrearProducto(${item.id}, '${escaparPOS(item.candidato?.nombre || item.descripcion).replace(/'/g, "\\'")}')">Crear</button>
				<button type="button" class="btn-mini" onclick="riOmitirItem(${item.id})">Omitir</button>
			` : (puedeEditar ? `<button type="button" class="btn-mini" onclick="riCambiarDecisionItem(${item.id})">Cambiar</button>` : "")}</td>
		</tr>
	`;
}

async function riRelacionarProducto(itemId, descripcion) {
	const respuesta = await fetch(`/explorar-nexo/buscar?q=${encodeURIComponent(descripcion)}`);
	const resultado = await respuesta.json().catch(() => null);
	const candidatos = resultado?.inventario || [];

	if (!candidatos.length) {
		await alertaPOS("No encontramos ningún producto parecido en tu inventario. Puedes crear uno nuevo en su lugar.", "Relacionar producto", "info");
		return;
	}

	const datos = await abrirFormularioCredito({
		titulo: "Relacionar producto",
		subtitulo: descripcion,
		campos: [{
			nombre: "productoId",
			etiqueta: "Producto en tu inventario",
			tipo: "select",
			requerido: true,
			opciones: candidatos.map(c => ({ valor: c.productoId, etiqueta: `${c.nombre} (${c.codigo || "sin código"})` }))
		}]
	});
	if (!datos) return;

	await riGuardarDecisionItem(itemId, { accion: "relacionar", productoId: Number(datos.productoId) });
}

async function riCrearProducto(itemId, nombreSugerido) {
	const datos = await abrirFormularioCredito({
		titulo: "Crear producto",
		subtitulo: "Se dará de alta con el costo de esta factura",
		campos: [{ nombre: "nombre", etiqueta: "Nombre del producto", valor: nombreSugerido, requerido: true }]
	});
	if (!datos) return;

	await riGuardarDecisionItem(itemId, { accion: "crear", nombreNuevoProducto: datos.nombre });
}

async function riCambiarDecisionItem(itemId) {
	await riGuardarDecisionItem(itemId, { accion: "" });
}

async function riOmitirItem(itemId) {
	const confirmado = await confirmarPOS("Este producto no se agregará al inventario ni se contará en la recepción. ¿Continuar?", "Omitir");
	if (!confirmado) return;

	await riGuardarDecisionItem(itemId, { accion: "omitir" });
}

async function riGuardarDecisionItem(itemId, body) {
	if (!recepcionInteligenteActualId) return;

	const respuesta = await fetch(`/recepcion-inteligente/facturas/${recepcionInteligenteActualId}/items/${itemId}`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(body)
	});
	const datos = await respuesta.json().catch(() => ({}));

	if (!respuesta.ok || !datos.ok) {
		await alertaPOS(datos.error || "No se pudo guardar.", "Recepción Inteligente", "peligro");
		return;
	}

	await riVerDetalle(recepcionInteligenteActualId);
}

async function riRechazar(id) {
	const confirmado = await confirmarPOS("Esta factura se marcará como rechazada. No se creará ninguna recepción.", "Rechazar factura");
	if (!confirmado) return;

	const respuesta = await fetch(`/recepcion-inteligente/facturas/${id}/rechazar`, { method: "POST" });
	const datos = await respuesta.json().catch(() => ({}));

	if (!respuesta.ok || !datos.ok) {
		await alertaPOS(datos.error || "No se pudo rechazar.", "Recepción Inteligente", "peligro");
		return;
	}

	await riCargarLista();
	await riVerDetalle(id);
}

async function riConfirmar(id) {
	const confirmado = await confirmarPOS("Esto aplicará el stock y el costo de todos los productos ya revisados. ¿Confirmar la recepción?", "Confirmar recepción");
	if (!confirmado) return;

	const respuesta = await fetch(`/recepcion-inteligente/facturas/${id}/confirmar`, { method: "POST" });
	const datos = await respuesta.json().catch(() => ({}));

	if (!respuesta.ok || !datos.ok) {
		await alertaPOS(datos.error || "No se pudo confirmar. Revisa que todos los productos tengan una decisión.", "Recepción Inteligente", "peligro");
		return;
	}

	await alertaPOS(`Recepción confirmada. Se aplicó un total de $${datos.totalAplicado.toFixed(2)} a tu inventario.`, "Recepción confirmada", "exito");

	if (typeof cargarProductos === "function") cargarProductos();
	await riCargarLista();
	await riVerDetalle(id);
}
