// Pantalla del cliente: una segunda pantalla (tablet viejo, celular,
// monitor extra -- cualquier equipo ya vinculado a este negocio) que
// se pone viendo hacia el cliente. Mientras alguien busca en Explorar
// Nexo, Punto de venta o Inventario, esta pantalla muestra en grande
// la foto de lo que se esta viendo, para que el cliente confirme "si,
// es ese" antes de que se lo cobren -- idea real del dueno, de un
// video donde asi trabajaba una ferreteria.
//
// Sin websockets a proposito: polling corto (cada 1.2s) contra
// GET /pantalla-cliente/actual. Nada de esto requiere tiempo real
// perfecto -- 1 segundo de rezago es imperceptible para este uso, y
// evita meter infraestructura nueva (socket.io, SSE) solo para esto.
let pantallaClienteIntervalo = null;
let pantallaClienteUltimaFirma = null;
let pantallaClienteVentanaProyeccion = null;

// Boton "Proyectar" sobre la foto (Explorar Nexo, Punto de venta,
// Inventario): abre esta misma pantalla en una ventana aparte, sin
// menu ni barra superior (modo-proyeccion, ver
// pantalla-cliente-view.css) -- lista para arrastrarla a un monitor
// conectado por cable, o mandarla de forma inalambrica con "Proyectar
// a esta PC" de Windows o el boton Cast de Chrome. Nada de eso lo
// construye Nexo: ya viene en Windows/Chrome, esta ventana solo les
// da algo limpio que proyectar.
function pantallaClienteAbrirProyeccion() {
	if (pantallaClienteVentanaProyeccion && !pantallaClienteVentanaProyeccion.closed) {
		pantallaClienteVentanaProyeccion.focus();
		return;
	}
	pantallaClienteVentanaProyeccion = window.open(
		`${location.origin}/?vista=pantalla-cliente`,
		"nexoPantallaCliente",
		"width=1000,height=700"
	);
}

// Llamado desde Explorar Nexo / Punto de venta / Inventario cada vez
// que alguien ve o selecciona un producto -- fire-and-forget: si falla
// (sin internet, pantalla del cliente nunca configurada, etc.) nunca
// debe interrumpir la pantalla que de verdad esta usando el empleado.
function pantallaClienteMostrar({ nombre, foto, fotos, precio, marca, origen }) {
	if (!nombre) return;

	fetch("/pantalla-cliente/mostrar", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			nombre,
			foto: foto || null,
			fotos: Array.isArray(fotos) ? fotos : [],
			precio: precio ?? null,
			marca: marca || null,
			origen: origen || ""
		})
	}).catch(() => {});
}

async function mostrarPantallaCliente() {
	if (typeof ocultarPantallasPrincipales === "function") ocultarPantallasPrincipales();

	const pantalla = document.getElementById("pantallaClienteDisplay");
	if (!pantalla) return;

	pantalla.style.display = "block";

	if (typeof actualizarTopbarContexto === "function") {
		actualizarTopbarContexto("Pantalla del cliente", "Pon esta pantalla viendo hacia el cliente -- se actualiza sola.", "pantalla-cliente");
	}

	pantallaClienteUltimaFirma = null;

	pantalla.innerHTML = `
		<div class="pcli-shell" id="pcliShell">
			<div class="pcli-config">
				<p>Deja esta pantalla abierta de este lado del mostrador, viendo hacia el cliente. En cuanto busques algo en Explorar Nexo, Punto de venta o Inventario, aparece solo aqui.</p>
			</div>
			<div class="pcli-vacio" id="pcliContenido">
				<span class="pcli-vacio-icono">🛒</span>
				<p>Esperando…</p>
			</div>
		</div>
	`;

	// Un solo listener delegado (el shell no se vuelve a pintar en cada
	// poll, solo #pcliContenido) para las miniaturas de la galeria --
	// evita meter la url en un onclick inline armado con template
	// strings (mismo problema de comillas ya resuelto en Explorar Nexo).
	document.getElementById("pcliShell")?.addEventListener("click", event => {
		const miniatura = event.target.closest("[data-pcli-foto]");
		if (miniatura) pantallaClienteCambiarFoto(miniatura.dataset.pcliFoto);
	});

	await pantallaClienteActualizar();
	if (pantallaClienteIntervalo) clearInterval(pantallaClienteIntervalo);
	pantallaClienteIntervalo = setInterval(pantallaClienteActualizar, 1200);
}

async function pantallaClienteActualizar() {
	const contenido = document.getElementById("pcliContenido");
	if (!contenido) {
		// La pantalla ya no esta visible (el empleado navego a otro
		// modulo en este mismo equipo) -- deja de hacer polling.
		if (pantallaClienteIntervalo) { clearInterval(pantallaClienteIntervalo); pantallaClienteIntervalo = null; }
		return;
	}

	try {
		const respuesta = await fetch("/pantalla-cliente/actual");
		const datos = await respuesta.json();
		if (!datos.ok) return;

		const producto = datos.producto;
		const firma = producto ? `${producto.nombre}|${(producto.fotos || []).join(",")}|${producto.precio}|${producto.actualizadoEn}` : null;
		if (firma === pantallaClienteUltimaFirma) return;
		pantallaClienteUltimaFirma = firma;

		if (!producto) {
			contenido.className = "pcli-vacio";
			contenido.innerHTML = `<span class="pcli-vacio-icono">🛒</span><p>Esperando…</p>`;
			return;
		}

		// fotos trae la galeria completa (Banco de Nexo / fabricante);
		// producto.foto es solo la primera, por si algo todavia manda
		// nada mas eso -- nunca se pierde la foto principal.
		const fotos = Array.isArray(producto.fotos) && producto.fotos.length
			? producto.fotos
			: (producto.foto ? [producto.foto] : []);
		const extras = fotos.slice(1);

		contenido.className = "pcli-producto";
		contenido.innerHTML = `
			<div class="pcli-foto" id="pcliFotoPrincipal">${fotos[0] ? `<img src="${fotos[0]}" alt="">` : `<span>📦</span>`}</div>
			${extras.length ? `
				<div class="pcli-galeria">
					${extras.map(url => `<button type="button" class="pcli-galeria-item" data-pcli-foto="${escaparPOS(url)}"><img src="${url}" alt=""></button>`).join("")}
				</div>
			` : ""}
			<div class="pcli-info">
				${producto.marca ? `<span class="pcli-marca">${escaparPOS(producto.marca)}</span>` : ""}
				<h1>${escaparPOS(producto.nombre)}</h1>
				${producto.precio != null ? `<strong class="pcli-precio">${dinero(producto.precio)}</strong>` : ""}
			</div>
		`;
	} catch (error) {
		// Sin internet momentaneo: se queda con lo ultimo que ya mostro,
		// no lo borra ni muestra un error que asuste al cliente.
	}
}

// Tocar una miniatura de la galeria la pone de foto principal -- por si
// la pantalla del cliente es una tablet touch y quiere ver otro angulo
// el mismo cliente, sin depender de que el empleado vuelva a buscar.
function pantallaClienteCambiarFoto(url) {
	const contenedor = document.getElementById("pcliFotoPrincipal");
	if (!contenedor || !url) return;
	contenedor.innerHTML = `<img src="${url}" alt="">`;
}
