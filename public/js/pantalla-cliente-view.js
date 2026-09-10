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

// Estado del carrusel local -- el cliente puede deslizarse entre las
// fotos de ESTE producto por su cuenta (tablet touch), sin depender de
// que el empleado busque otra vez. Vive fuera de pantallaClienteActualizar
// porque cambia solo en este equipo, nunca se manda al servidor.
let pantallaClienteFotosActuales = [];
let pantallaClienteIndiceFoto = 0;

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
	// poll, solo #pcliContenido) para los puntos y flechas del carrusel.
	document.getElementById("pcliShell")?.addEventListener("click", event => {
		const punto = event.target.closest("[data-pcli-punto]");
		if (punto) { pantallaClienteIrAFoto(Number(punto.dataset.pcliPunto)); return; }

		if (event.target.closest(".pcli-flecha-izq")) { pantallaClienteFotoAnterior(); return; }
		if (event.target.closest(".pcli-flecha-der")) { pantallaClienteFotoSiguiente(); return; }
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
			pantallaClienteCerrarZoom();
			pantallaClienteFotosActuales = [];
			contenido.className = "pcli-vacio";
			contenido.innerHTML = `<span class="pcli-vacio-icono">🛒</span><p>Esperando…</p>`;
			return;
		}

		// fotos trae la galeria completa (Banco de Nexo / fabricante);
		// producto.foto es solo la primera, por si algo todavia manda
		// nada mas eso -- nunca se pierde la foto principal. Un producto
		// nuevo siempre reinicia el carrusel en la primera foto y cierra
		// el zoom si el cliente se habia quedado viendo el anterior.
		pantallaClienteCerrarZoom();
		pantallaClienteFotosActuales = Array.isArray(producto.fotos) && producto.fotos.length
			? producto.fotos
			: (producto.foto ? [producto.foto] : []);
		pantallaClienteIndiceFoto = 0;

		const variasFotos = pantallaClienteFotosActuales.length > 1;

		contenido.className = "pcli-producto";
		contenido.innerHTML = `
			<div class="pcli-carrusel" id="pcliCarrusel">
				<div class="pcli-foto" id="pcliFotoPrincipal"></div>
				${variasFotos ? `
					<button type="button" class="pcli-flecha pcli-flecha-izq" aria-label="Foto anterior">‹</button>
					<button type="button" class="pcli-flecha pcli-flecha-der" aria-label="Foto siguiente">›</button>
				` : ""}
			</div>
			${variasFotos ? `
				<div class="pcli-puntos" id="pcliPuntos">
					${pantallaClienteFotosActuales.map((_, indice) => `<button type="button" class="pcli-punto" data-pcli-punto="${indice}" aria-label="Foto ${indice + 1}"></button>`).join("")}
				</div>
			` : ""}
			<div class="pcli-info">
				${producto.marca ? `<span class="pcli-marca">${escaparPOS(producto.marca)}</span>` : ""}
				<h1>${escaparPOS(producto.nombre)}</h1>
				${producto.precio != null ? `<strong class="pcli-precio">${dinero(producto.precio)}</strong>` : ""}
			</div>
		`;

		pantallaClienteRenderFotoActual();
		pantallaClienteInstalarGestosCarrusel();
	} catch (error) {
		// Sin internet momentaneo: se queda con lo ultimo que ya mostro,
		// no lo borra ni muestra un error que asuste al cliente.
	}
}

// Pinta la foto en pantallaClienteIndiceFoto y marca el punto activo --
// separado del fetch/render completo de arriba porque esto se llama
// tambien al deslizar o tocar un punto, puramente local, sin red.
function pantallaClienteRenderFotoActual() {
	const contenedor = document.getElementById("pcliFotoPrincipal");
	const url = pantallaClienteFotosActuales[pantallaClienteIndiceFoto];

	if (contenedor) {
		contenedor.innerHTML = url
			? `<img src="${url}" alt="" draggable="false">`
			: `<span>📦</span>`;
	}

	document.querySelectorAll(".pcli-punto").forEach((punto, indice) => {
		punto.classList.toggle("activo", indice === pantallaClienteIndiceFoto);
	});
}

function pantallaClienteIrAFoto(indice) {
	const total = pantallaClienteFotosActuales.length;
	if (!total) return;

	pantallaClienteIndiceFoto = ((indice % total) + total) % total;
	pantallaClienteRenderFotoActual();

	const zoomImg = document.getElementById("pcliZoomImg");
	if (zoomImg) zoomImg.src = pantallaClienteFotosActuales[pantallaClienteIndiceFoto];
}

function pantallaClienteFotoSiguiente() { pantallaClienteIrAFoto(pantallaClienteIndiceFoto + 1); }
function pantallaClienteFotoAnterior() { pantallaClienteIrAFoto(pantallaClienteIndiceFoto - 1); }

// Deslizar sobre la foto cambia de imagen (con mouse o con el dedo --
// Pointer Events cubre ambos); tocarla sin arrastrar abre el zoom
// completo. Se reinstala en cada render porque #pcliFotoPrincipal es
// un nodo nuevo cada vez (nunca se acumulan listeners viejos).
function pantallaClienteInstalarGestosCarrusel() {
	const foto = document.getElementById("pcliFotoPrincipal");
	if (!foto) return;

	let inicio = null;
	let arrastrando = false;

	// setPointerCapture es indispensable aqui: sin el, si el dedo (o el
	// mouse) se sale un poco del cuadro de la foto a medio arrastre --
	// facil que pase en una foto cuadrada dentro de una pantalla mas
	// ancha -- el pointerup ya no llega a este elemento y el deslizar
	// se queda a medias, sin cambiar de foto nunca.
	foto.addEventListener("pointerdown", event => {
		foto.setPointerCapture(event.pointerId);
		inicio = { x: event.clientX, y: event.clientY };
		arrastrando = false;
	});

	foto.addEventListener("pointermove", event => {
		if (!inicio) return;
		if (Math.abs(event.clientX - inicio.x) > 10 || Math.abs(event.clientY - inicio.y) > 10) {
			arrastrando = true;
		}
	});

	const terminar = event => {
		if (!inicio) return;
		const deltaX = event.clientX - inicio.x;
		const deltaY = event.clientY - inicio.y;
		inicio = null;

		if (!arrastrando) {
			pantallaClienteAbrirZoom();
			return;
		}

		if (Math.abs(deltaX) > 40 && Math.abs(deltaX) > Math.abs(deltaY)) {
			if (deltaX < 0) pantallaClienteFotoSiguiente();
			else pantallaClienteFotoAnterior();
		}
	};

	foto.addEventListener("pointerup", terminar);
	foto.addEventListener("pointercancel", () => { inicio = null; });
}

// Zoom completo: pantalla llena, pellizco con dos dedos para acercar,
// arrastrar con un dedo para moverse dentro de la foto ya acercada, y
// deslizar (sin estar acercado) para pasar a la siguiente/anterior --
// mismo gesto que el carrusel de atras, para que se sienta como una
// sola galeria. Doble toque alterna acercado/normal. Todo con Pointer
// Events, sin ninguna libreria -- mismo criterio que pos-image-zoom.js.
let pantallaClienteZoomEscala = 1;
let pantallaClienteZoomX = 0;
let pantallaClienteZoomY = 0;
let pantallaClienteEscapeHandler = null;

function pantallaClienteAplicarTransformZoom() {
	const img = document.getElementById("pcliZoomImg");
	if (img) img.style.transform = `translate(${pantallaClienteZoomX}px, ${pantallaClienteZoomY}px) scale(${pantallaClienteZoomEscala})`;
}

function pantallaClienteAbrirZoom() {
	if (!pantallaClienteFotosActuales.length) return;

	let modal = document.getElementById("pcliModalZoom");
	if (!modal) {
		modal = document.createElement("div");
		modal.id = "pcliModalZoom";
		modal.className = "pcli-modal-zoom";
		document.body.appendChild(modal);
	}

	pantallaClienteZoomEscala = 1;
	pantallaClienteZoomX = 0;
	pantallaClienteZoomY = 0;

	modal.innerHTML = `
		<button type="button" class="pcli-zoom-cerrar" aria-label="Cerrar">✕</button>
		<div class="pcli-zoom-lienzo" id="pcliZoomLienzo">
			<img id="pcliZoomImg" src="${pantallaClienteFotosActuales[pantallaClienteIndiceFoto]}" alt="" draggable="false">
		</div>
	`;

	modal.style.display = "flex";
	modal.querySelector(".pcli-zoom-cerrar").onclick = pantallaClienteCerrarZoom;

	pantallaClienteInstalarGestosZoom();
}

function pantallaClienteCerrarZoom() {
	if (pantallaClienteEscapeHandler) {
		document.removeEventListener("keydown", pantallaClienteEscapeHandler);
		pantallaClienteEscapeHandler = null;
	}

	const modal = document.getElementById("pcliModalZoom");
	if (!modal || modal.style.display === "none") return;
	modal.style.display = "none";
	modal.innerHTML = "";
}

function pantallaClienteInstalarGestosZoom() {
	const lienzo = document.getElementById("pcliZoomLienzo");
	if (!lienzo) return;

	const punteros = new Map();
	let distanciaInicial = 0;
	let escalaInicial = 1;
	let arrastreInicio = null;
	let huboArrastre = false;
	let ultimoToque = 0;

	const distanciaEntre = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

	lienzo.addEventListener("pointerdown", event => {
		lienzo.setPointerCapture(event.pointerId);
		punteros.set(event.pointerId, { x: event.clientX, y: event.clientY });
		huboArrastre = false;

		if (punteros.size === 2) {
			const [a, b] = [...punteros.values()];
			distanciaInicial = distanciaEntre(a, b);
			escalaInicial = pantallaClienteZoomEscala;
		} else if (punteros.size === 1) {
			arrastreInicio = { x: event.clientX, y: event.clientY, x0: pantallaClienteZoomX, y0: pantallaClienteZoomY };
		}
	});

	lienzo.addEventListener("pointermove", event => {
		if (!punteros.has(event.pointerId)) return;
		punteros.set(event.pointerId, { x: event.clientX, y: event.clientY });

		if (punteros.size === 2 && distanciaInicial > 0) {
			const [a, b] = [...punteros.values()];
			const factor = distanciaEntre(a, b) / distanciaInicial;
			pantallaClienteZoomEscala = Math.min(4, Math.max(1, escalaInicial * factor));
			pantallaClienteAplicarTransformZoom();
			huboArrastre = true;
		} else if (punteros.size === 1 && arrastreInicio) {
			const deltaX = event.clientX - arrastreInicio.x;
			const deltaY = event.clientY - arrastreInicio.y;

			if (Math.abs(deltaX) > 10 || Math.abs(deltaY) > 10) huboArrastre = true;

			if (pantallaClienteZoomEscala > 1) {
				pantallaClienteZoomX = arrastreInicio.x0 + deltaX;
				pantallaClienteZoomY = arrastreInicio.y0 + deltaY;
				pantallaClienteAplicarTransformZoom();
			}
		}
	});

	const soltarPuntero = event => {
		const finPuntero = punteros.get(event.pointerId);
		punteros.delete(event.pointerId);
		if (punteros.size < 2) distanciaInicial = 0;

		if (punteros.size === 0) {
			if (!huboArrastre) {
				// toque simple -- doble toque alterna acercado/normal
				const ahora = Date.now();
				if (ahora - ultimoToque < 320) {
					if (pantallaClienteZoomEscala > 1) {
						pantallaClienteZoomEscala = 1;
						pantallaClienteZoomX = 0;
						pantallaClienteZoomY = 0;
					} else {
						pantallaClienteZoomEscala = 2.5;
					}
					pantallaClienteAplicarTransformZoom();
					ultimoToque = 0;
				} else {
					ultimoToque = ahora;
				}
			} else if (pantallaClienteZoomEscala === 1 && arrastreInicio && finPuntero) {
				// sin estar acercado, deslizar cambia de foto -- mismo
				// gesto que el carrusel de atras del modal.
				const deltaX = finPuntero.x - arrastreInicio.x;
				if (Math.abs(deltaX) > 50) {
					if (deltaX < 0) pantallaClienteFotoSiguiente();
					else pantallaClienteFotoAnterior();
				}
			}

			arrastreInicio = null;
			huboArrastre = false;
		}
	};

	lienzo.addEventListener("pointerup", soltarPuntero);
	lienzo.addEventListener("pointercancel", soltarPuntero);

	// Bono para quien usa esta pantalla con mouse en un monitor normal
	// (no touch): la rueda tambien acerca/aleja.
	lienzo.addEventListener("wheel", event => {
		event.preventDefault();
		const factor = event.deltaY < 0 ? 1.15 : 0.87;
		pantallaClienteZoomEscala = Math.min(4, Math.max(1, pantallaClienteZoomEscala * factor));
		if (pantallaClienteZoomEscala === 1) { pantallaClienteZoomX = 0; pantallaClienteZoomY = 0; }
		pantallaClienteAplicarTransformZoom();
	}, { passive: false });

	pantallaClienteEscapeHandler = event => {
		if (event.key === "Escape") pantallaClienteCerrarZoom();
	};
	document.addEventListener("keydown", pantallaClienteEscapeHandler);
}
