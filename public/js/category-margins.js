/* Margen de ganancia por categoria, independiente de proveedor -- ver
   migrations/20261009_margenes_categoria_negocio.sql. Caso real: un
   producto llega sin factura (el proveedor solo dio el costo de
   palabra) y en "Agregar producto" se quiere sugerir su precio de
   venta con solo costo + categoria, sin depender de una regla
   configurada para un proveedor exacto (eso ya lo cubre "Precios por
   proveedor"). Una sola fila por negocio, mismo patron visual y mismas
   clases CSS que esa pantalla (pricing-rules.css), sin duplicar estilos. */
let estadoMargenesCategoria = { margenesCategoria: {}, redondeo: "ninguno" };

function categoriasDisponiblesParaMargen() {
	const vistos = new Map();

	const agregar = nombre => {
		const limpio = String(nombre || "").trim();
		if (!limpio) return;

		const clave = normalizarTexto(limpio);
		if (!vistos.has(clave)) vistos.set(clave, limpio);
	};

	(categoriasNexoArbol || []).forEach(grupo => agregar(grupo.departamento));

	if (typeof nombresCategoriasProductos === "function") {
		nombresCategoriasProductos().forEach(agregar);
	}

	return [...vistos.values()].sort((a, b) => a.localeCompare(b, "es"));
}

function asegurarPantallaMargenesCategoria() {
	let pantalla = document.getElementById("pantallaMargenesCategoria");
	if (pantalla) return pantalla;

	const main = document.querySelector("main.contenido") || document.getElementById("sistema");

	pantalla = document.createElement("section");
	pantalla.id = "pantallaMargenesCategoria";
	pantalla.style.display = "none";

	pantalla.innerHTML = `
		<div class="reglas-precio-shell">
			<div class="reglas-precio-header">
				<div>
					<h2>Margen por categoria</h2>
					<p>El precio que Nexo sugiere al agregar un producto nuevo con solo el costo, sin importar el proveedor.</p>
				</div>
				<button type="button" onclick="mostrarConfiguracion()">Volver a Configuracion</button>
			</div>

			<div class="reglas-precio-seccion">
				<h3>Redondeo</h3>
				<div class="reglas-precio-redondeo-opciones" id="margenCategoriaRedondeoOpciones"></div>
			</div>

			<div class="reglas-precio-seccion">
				<h3>Margenes por categoria</h3>
				<p class="reglas-precio-ayuda">Vacio = no se sugiere ningun precio para esa categoria al agregar un producto solo con el costo.</p>
				<div class="reglas-precio-categorias-tabla" id="margenCategoriaTabla"></div>
			</div>

			<div class="reglas-precio-acciones">
				<button type="button" class="btn-guardar-reglas-precio" onclick="guardarMargenesCategoria()">Guardar</button>
			</div>
		</div>
	`;

	main.appendChild(pantalla);
	return pantalla;
}

async function mostrarMargenesCategoria() {
	asegurarPantallaMargenesCategoria();

	if (typeof ocultarPantallasPrincipales === "function") ocultarPantallasPrincipales();

	document.getElementById("pantallaMargenesCategoria").style.display = "block";

	if (typeof actualizarTopbarContexto === "function") {
		actualizarTopbarContexto("Margen por categoria", "Sugerencia de precio al agregar un producto nuevo", "configuracion");
	}

	if (typeof cargarCategoriasNexo === "function" && !categoriasNexoArbol) {
		await cargarCategoriasNexo().catch(() => {});
	}

	try {
		const respuesta = await fetch("/margenes-categoria");
		const datos = await respuesta.json();
		estadoMargenesCategoria = {
			margenesCategoria: datos.margenesCategoria || {},
			redondeo: datos.redondeo || "ninguno"
		};
	} catch (error) {
		estadoMargenesCategoria = { margenesCategoria: {}, redondeo: "ninguno" };
	}

	renderMargenesCategoria();
}

function renderMargenesCategoria() {
	const opcionesRedondeo = document.getElementById("margenCategoriaRedondeoOpciones");
	if (opcionesRedondeo) {
		opcionesRedondeo.innerHTML = OPCIONES_REDONDEO_PRECIO.map(opcion => `
			<button type="button" class="${estadoMargenesCategoria.redondeo === opcion.valor ? "activo" : ""}" onclick="seleccionarRedondeoMargenCategoria('${opcion.valor}')">
				${opcion.etiqueta}
			</button>
		`).join("");
	}

	const tabla = document.getElementById("margenCategoriaTabla");
	if (!tabla) return;

	const categorias = categoriasDisponiblesParaMargen();

	tabla.innerHTML = categorias.length
		? categorias.map(nombre => {
			const clave = normalizarTexto(nombre);
			const valor = estadoMargenesCategoria.margenesCategoria[clave];
			return `
				<div class="reglas-precio-categoria-fila">
					<span>${escaparPOS(nombre)}</span>
					<input type="number" step="0.01" min="0" value="${valor ?? ""}" placeholder="Sin margen" onchange="actualizarMargenCategoriaGeneral('${clave}', this.value)">
				</div>
			`;
		}).join("")
		: `<div class="reglas-precio-vacio">Todavia no tienes categorias -- agrega un producto primero.</div>`;
}

function seleccionarRedondeoMargenCategoria(valor) {
	estadoMargenesCategoria.redondeo = valor;
	renderMargenesCategoria();
}

function actualizarMargenCategoriaGeneral(clave, valor) {
	if (valor === "" || valor === null || valor === undefined) {
		delete estadoMargenesCategoria.margenesCategoria[clave];
	} else {
		estadoMargenesCategoria.margenesCategoria[clave] = Number(valor);
	}
}

async function guardarMargenesCategoria() {
	try {
		const respuesta = await fetch("/margenes-categoria", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(estadoMargenesCategoria)
		});

		if (!respuesta.ok) throw new Error();

		obtenerMargenesCategoriaCache.cache = null;
		await alertaPOS("Margenes por categoria guardados.", "Margen por categoria", "exito");
	} catch (error) {
		await alertaPOS("No se pudieron guardar los margenes por categoria.", "Margen por categoria", "peligro");
	}
}

// Sugerencia de precio en "Agregar producto": costo (precioDistribuidor)
// + categoria elegida -> precio publico sugerido, SIN necesitar factura
// ni una regla de proveedor configurada (eso lo cubre por separado
// mostrarSugerenciaPrecioProveedor en product-inventory.js, que solo
// aplica cuando el producto viene de un catalogo con proveedor
// conocido). Nunca se aplica solo -- si no hay margen para esa
// categoria, no sugiere nada y el campo queda como el usuario lo dejo.
async function obtenerMargenesCategoriaCache() {
	if (obtenerMargenesCategoriaCache.cache) return obtenerMargenesCategoriaCache.cache;

	try {
		const respuesta = await fetch("/margenes-categoria");
		const datos = await respuesta.json();
		obtenerMargenesCategoriaCache.cache = { margenesCategoria: datos.margenesCategoria || {}, redondeo: datos.redondeo || "ninguno" };
	} catch (error) {
		obtenerMargenesCategoriaCache.cache = { margenesCategoria: {}, redondeo: "ninguno" };
	}

	return obtenerMargenesCategoriaCache.cache;
}

// Se dispara al escribir costo o categoria en "Agregar producto".
// Reusa el MISMO boton de "Usar precio sugerido" que ya existe para la
// sugerencia por catalogo de proveedor (mostrarSugerenciaPrecioProveedor
// en product-inventory.js) -- nunca lo pisa mientras esa sugerencia (mas
// especifica: ya sabe el proveedor y el precio de lista real) siga
// activa, marcada con dataset.origen="catalogo".
async function actualizarSugerenciaPrecioCategoria() {
	const boton = typeof asegurarBotonSugerenciaPrecio === "function" ? asegurarBotonSugerenciaPrecio() : null;
	if (!boton) return;

	if (boton.dataset.origen === "catalogo" && boton.style.display !== "none") return;

	const costo = document.getElementById("precioDistribuidor")?.value;
	const categoria = document.getElementById("nuevaCategoria")?.value;

	const sugerencia = await sugerirPrecioPorCategoria(costo, categoria);

	if (!sugerencia) {
		boton.style.display = "none";
		boton.onclick = null;
		delete boton.dataset.origen;
		return;
	}

	boton.textContent = `Usar precio sugerido: $${sugerencia.precioSugerido.toFixed(2)} (margen ${sugerencia.margen}% por categoria)`;
	boton.dataset.origen = "categoria";
	boton.style.display = "inline-flex";

	boton.onclick = () => {
		const campoPrecio = document.getElementById("nuevoPrecio");
		if (campoPrecio) campoPrecio.value = sugerencia.precioSugerido;
	};
}

async function sugerirPrecioPorCategoria(costo, categoria) {
	const costoNumero = Number(costo);
	if (!Number.isFinite(costoNumero) || costoNumero <= 0) return null;

	const categoriaLimpia = String(categoria || "").trim();
	if (!categoriaLimpia) return null;

	const { margenesCategoria, redondeo } = await obtenerMargenesCategoriaCache();
	const margen = margenesCategoria[normalizarTexto(categoriaLimpia)];
	if (margen == null) return null;

	const bruto = costoNumero * (1 + Number(margen) / 100);
	return { margen: Number(margen), precioSugerido: aplicarRedondeo(bruto, redondeo) };
}
