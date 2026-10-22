/* Cargar inventario: la forma facil y rapida de llenar un negocio nuevo.

   Un solo lugar con los caminos que ya existen y dos nuevos:
     - Carga rapida: buscar por nombre o codigo en el catalogo de Nexo, poner
       cuantos hay y listo. Enter y sigue el siguiente.
     - Pegar o subir mi lista (Excel / CSV): se entiende solo que columna es cual,
       se ve una vista previa y se importa con una barra de avance.
     - Los de siempre: catalogo del proveedor, factura (XML), uno por uno.

   No inventa ningun alta nueva en el servidor: cada producto se crea con la
   misma ruta de siempre (POST /agregar-producto), asi que categoria, proveedor,
   codigos y Catalogo Maestro se resuelven igual que en "Agregar producto".
   Todo con prefijo ci- para no chocar con nada. */

// ---------------------------------------------------------------------
// Funciones puras (se prueban en Node: ver tests/carga-inventario.test.js)
// ---------------------------------------------------------------------

function ciNormalizar(texto) {
    return String(texto ?? "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim();
}

function ciDetectarDelimitador(texto) {
    const primera = String(texto || "").split(/\r?\n/).find(linea => linea.trim()) || "";
    const cuenta = caracter => primera.split(caracter).length - 1;
    const opciones = [["\t", cuenta("\t")], [";", cuenta(";")], [",", cuenta(",")]];
    opciones.sort((a, b) => b[1] - a[1]);
    return opciones[0][1] > 0 ? opciones[0][0] : ",";
}

// Tabla a partir de texto pegado de Excel (tabuladores) o de un CSV, con comillas.
function ciParsearTabla(texto) {
    const limpio = String(texto || "").replace(/^﻿/, "");
    const delimitador = ciDetectarDelimitador(limpio);
    const filas = [];
    let fila = [];
    let celda = "";
    let entreComillas = false;

    const cerrarCelda = () => { fila.push(celda); celda = ""; };
    const cerrarFila = () => {
        cerrarCelda();
        if (fila.some(valor => valor.trim() !== "")) filas.push(fila.map(valor => valor.trim()));
        fila = [];
    };

    for (let i = 0; i < limpio.length; i++) {
        const c = limpio[i];

        if (entreComillas) {
            if (c === '"' && limpio[i + 1] === '"') { celda += '"'; i++; }
            else if (c === '"') entreComillas = false;
            else celda += c;
            continue;
        }

        if (c === '"' && celda === "") entreComillas = true;
        else if (c === delimitador) cerrarCelda();
        else if (c === "\n") cerrarFila();
        else if (c === "\r") { /* se ignora */ }
        else celda += c;
    }

    if (celda !== "" || fila.length) cerrarFila();

    return filas;
}

// "$1,250.50", "1.250,50", "12,5", "  35 " -> numero; lo que no sea numero -> null.
function ciNumero(valor) {
    let texto = String(valor ?? "").replace(/[^\d.,-]/g, "");
    if (!texto || !/\d/.test(texto)) return null;

    const ultimaComa = texto.lastIndexOf(",");
    const ultimoPunto = texto.lastIndexOf(".");

    if (ultimaComa >= 0 && ultimoPunto >= 0) {
        // El ultimo separador es el decimal; el otro es de miles.
        texto = ultimaComa > ultimoPunto
            ? texto.replace(/\./g, "").replace(",", ".")
            : texto.replace(/,/g, "");
    } else if (ultimaComa >= 0) {
        const decimales = texto.length - ultimaComa - 1;
        texto = decimales > 0 && decimales <= 2 && texto.split(",").length === 2
            ? texto.replace(",", ".")
            : texto.replace(/,/g, "");
    }

    const numero = Number(texto);
    return Number.isFinite(numero) ? numero : null;
}

const CI_SINONIMOS = {
    nombre: ["nombre", "producto", "descripcion", "articulo", "item", "nombre del producto", "concepto"],
    precio: ["precio", "precio venta", "precio de venta", "precio publico", "pvp", "venta", "precio al publico", "price"],
    stock: ["stock", "existencia", "existencias", "cantidad", "inventario", "piezas", "qty", "cant"],
    codigo: ["codigo", "codigo de barras", "barras", "sku", "clave", "ean", "upc", "cod", "codigo barras", "codigo interno"],
    costo: ["costo", "costo unitario", "precio distribuidor", "precio proveedor", "precio de compra", "compra", "distribuidor", "precio costo"],
    marca: ["marca", "brand", "fabricante"],
    categoria: ["categoria", "departamento", "familia", "linea", "rubro"]
};

const CI_CAMPOS = [
    { id: "nombre", etiqueta: "Nombre del producto", obligatorio: true },
    { id: "precio", etiqueta: "Precio de venta", obligatorio: true },
    { id: "costo", etiqueta: "Lo que te cuesta (precio distribuidor)", obligatorio: false },
    { id: "stock", etiqueta: "Cantidad que tienes", obligatorio: false },
    { id: "codigo", etiqueta: "Código o código de barras", obligatorio: false },
    { id: "marca", etiqueta: "Marca", obligatorio: false },
    { id: "categoria", etiqueta: "Categoría", obligatorio: false }
];

// Una columna por campo, la primera que coincida; -1 = no se encontro.
function ciAdivinarColumnas(encabezados) {
    const normalizados = (encabezados || []).map(ciNormalizar);
    const usadas = new Set();
    const mapeo = {};

    const orden = ["nombre", "costo", "precio", "stock", "codigo", "marca", "categoria"];

    for (const campo of orden.map(id => CI_CAMPOS.find(c => c.id === id))) {
        let indice = -1;

        // Primero coincidencia exacta con un sinonimo, despues "contiene".
        for (const modo of ["exacta", "contiene"]) {
            if (indice >= 0) break;

            normalizados.forEach((texto, i) => {
                if (indice >= 0 || usadas.has(i)) return;
                const coincide = CI_SINONIMOS[campo.id].some(s => modo === "exacta" ? texto === s : texto.includes(s));
                if (coincide) indice = i;
            });
        }

        mapeo[campo.id] = indice;
        if (indice >= 0) usadas.add(indice);
    }

    return mapeo;
}

// ¿La primera fila son encabezados? Si alguna celda parece un encabezado conocido,
// o ninguna celda es un numero, se toma como encabezado.
function ciTieneEncabezado(fila) {
    if (!fila || !fila.length) return false;

    const conocidos = Object.values(CI_SINONIMOS).flat();
    if (fila.some(celda => conocidos.includes(ciNormalizar(celda)))) return true;

    return fila.every(celda => ciNumero(celda) === null);
}

// Clasifica las filas ya mapeadas: listas para importar, que ya existen y con problemas.
function ciPrepararFilas(filas, mapeo, existentes = { codigos: new Set(), nombres: new Set() }) {
    const listas = [];
    const duplicadas = [];
    const conProblemas = [];
    const vistosCodigos = new Set();
    const vistosNombres = new Set();

    const valor = (fila, campo) => (mapeo[campo] >= 0 ? String(fila[mapeo[campo]] ?? "").trim() : "");

    filas.forEach((fila, indice) => {
        const numeroFila = indice + 1;
        const nombre = valor(fila, "nombre");
        const precio = ciNumero(valor(fila, "precio"));
        const stockTexto = valor(fila, "stock");
        const stock = stockTexto === "" ? 0 : ciNumero(stockTexto);
        const codigo = valor(fila, "codigo");
        const costo = ciNumero(valor(fila, "costo"));

        if (!nombre) return conProblemas.push({ fila: numeroFila, motivo: "No tiene nombre" });
        if (precio === null || precio < 0) return conProblemas.push({ fila: numeroFila, nombre, motivo: "El precio no es un número" });
        if (stock === null || stock < 0) return conProblemas.push({ fila: numeroFila, nombre, motivo: "La cantidad no es un número" });

        const claveCodigo = codigo ? ciNormalizar(codigo) : "";
        const claveNombre = ciNormalizar(nombre);

        if ((claveCodigo && (existentes.codigos.has(claveCodigo) || vistosCodigos.has(claveCodigo))) ||
            existentes.nombres.has(claveNombre) || vistosNombres.has(claveNombre)) {
            return duplicadas.push({ fila: numeroFila, nombre, motivo: "Ya lo tienes" });
        }

        if (claveCodigo) vistosCodigos.add(claveCodigo);
        vistosNombres.add(claveNombre);

        listas.push({
            fila: numeroFila,
            nombre,
            precio,
            stock,
            codigo,
            costo: costo !== null && costo >= 0 ? costo : null,
            marca: valor(fila, "marca"),
            categoria: valor(fila, "categoria")
        });
    });

    return { listas, duplicadas, conProblemas };
}

// Producto para POST /agregar-producto a partir de un resultado del catalogo de Nexo.
function ciProductoDesdeCatalogo(item, { stock, precio }) {
    const codigoBarras = item.ean && /^\d{8,14}$/.test(String(item.ean)) ? String(item.ean) : "";

    return {
        nombre: item.nombre,
        precio,
        precioPublico: precio,
        stock,
        codigo: codigoBarras || item.codigo || "",
        marca: item.marca || "",
        proveedor: item.fuente === "proveedor" ? (item.proveedor || "") : (item.fabricante || item.marca || ""),
        ...(item.catalogoMaestroId ? { catalogoMaestroId: item.catalogoMaestroId } : {})
    };
}

// Precio publico sugerido segun la fuente del resultado.
function ciPrecioSugerido(item) {
    const valor = item.fuente === "proveedor" ? item.precioPublico : item.precioListaPublico;
    return Number.isFinite(Number(valor)) && Number(valor) > 0 ? Number(valor) : null;
}

if (typeof module !== "undefined" && module.exports) {
    module.exports = {
        ciNormalizar, ciDetectarDelimitador, ciParsearTabla, ciNumero, ciAdivinarColumnas,
        ciTieneEncabezado, ciPrepararFilas, ciProductoDesdeCatalogo, ciPrecioSugerido, CI_CAMPOS
    };
}

// ---------------------------------------------------------------------
// Pantalla
// ---------------------------------------------------------------------

const ciEstado = {
    vista: "inicio",
    resultados: [],
    buscando: false,
    termino: "",
    temporizador: null,
    seleccionado: null,
    agregados: [],
    ocupado: false,
    importacion: null
};

function ciEscapar(valor) {
    return typeof escaparPOS === "function"
        ? escaparPOS(valor)
        : String(valor ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function ciDinero(valor) {
    return "$" + Number(valor || 0).toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function ciContenedor() {
    return document.getElementById("pantallaCargaInventario");
}

async function ciLlamar(ruta, opciones = {}) {
    const respuesta = await fetch(ruta, {
        ...opciones,
        headers: { "Content-Type": "application/json", ...(opciones.headers || {}) }
    });
    const datos = await respuesta.json().catch(() => ({}));
    return { ok: respuesta.ok && (datos.ok !== false), status: respuesta.status, datos };
}

function ciExistentes() {
    const productos = typeof todosProductos !== "undefined" && Array.isArray(todosProductos) ? todosProductos : [];
    const codigos = new Set();
    const nombres = new Set();

    for (const p of productos) {
        if (p.codigo) codigos.add(ciNormalizar(p.codigo));
        if (p.nombre) nombres.add(ciNormalizar(p.nombre));
    }

    for (const a of ciEstado.agregados) {
        if (a.codigo) codigos.add(ciNormalizar(a.codigo));
        nombres.add(ciNormalizar(a.nombre));
    }

    return { codigos, nombres };
}

async function mostrarCargaInventario(vista = "inicio") {
    if (typeof ocultarPantallasPrincipales === "function") ocultarPantallasPrincipales();

    const pantalla = ciContenedor();
    if (!pantalla) return;

    pantalla.style.display = "block";

    if (typeof actualizarTopbarContexto === "function") {
        actualizarTopbarContexto("Cargar inventario", "Llena tu negocio rápido, como más te acomode", "carga-inventario");
    }

    ciEstado.vista = vista;
    ciRender();
}

function ciIr(vista) {
    ciEstado.vista = vista;
    ciEstado.seleccionado = null;
    ciRender();
}

function ciRender() {
    const pantalla = ciContenedor();
    if (!pantalla) return;

    const vistas = { inicio: ciPintarInicio, rapida: ciPintarRapida, lista: ciPintarLista };
    pantalla.innerHTML = `<div class="ci-shell">${(vistas[ciEstado.vista] || ciPintarInicio)()}</div>`;

    if (ciEstado.vista === "rapida") {
        document.getElementById("ciBuscador")?.focus();
        ciPintarResultados();
    }
}

function ciCabecera(titulo, texto, { atras = false } = {}) {
    return `
    <div class="ci-cabecera">
        <img class="ci-mascota" src="img/nexo-ia/feliz-transparente.png" alt="Nexo">
        <div>
            ${atras ? `<button type="button" class="ci-atras" onclick="ciIr('inicio')">&larr; Otras formas de cargar</button>` : ""}
            <h2>${titulo}</h2>
            <p>${texto}</p>
        </div>
    </div>`;
}

function ciPintarInicio() {
    const tarjeta = (icono, titulo, texto, accion, recomendada = false) => `
        <button type="button" class="ci-tarjeta${recomendada ? " ci-recomendada" : ""}" onclick="${accion}">
            ${recomendada ? `<span class="ci-etiqueta">Recomendado para empezar</span>` : ""}
            <span class="ci-icono">${icono}</span>
            <strong>${titulo}</strong>
            <span>${texto}</span>
        </button>`;

    const cuantos = typeof todosProductos !== "undefined" && Array.isArray(todosProductos) ? todosProductos.length : 0;

    return `
    ${ciCabecera("Carga tu inventario", cuantos ? `Ya tienes ${cuantos} producto${cuantos === 1 ? "" : "s"}. Elige cómo quieres agregar más.` : "Elige la forma que más te acomode. Puedes combinarlas y volver cuando quieras.")}
    <div class="ci-tarjetas">
        ${tarjeta("⚡", "Carga rápida", "Escribe el nombre o escanea el código, di cuántos tienes y sigue con el siguiente. Nexo ya trae miles de productos con su precio.", "ciIr('rapida')", true)}
        ${tarjeta("📋", "Pegar o subir mi lista", "¿Ya tienes tus productos en Excel? Cópialos y pégalos, o sube tu archivo CSV. Nexo entiende solo qué columna es cuál.", "ciIr('lista')")}
        ${tarjeta("🏷️", "Del catálogo de mi proveedor", "Sube la lista de precios de tu proveedor (Truper, Diprofer…) y crea tus productos desde ahí.", "mostrarCatalogo()")}
        ${tarjeta("🧾", "Con la factura de mi proveedor", "Sube el XML o la foto de la factura y Nexo suma la mercancía a tu inventario.", "mostrarRecepcionInteligente()")}
        ${tarjeta("✍️", "Uno por uno", "El formulario completo, para productos con todos sus detalles.", "abrirFormularioAgregarProductoNuevo()")}
    </div>`;
}

// ----- Carga rapida

function ciPintarRapida() {
    const n = ciEstado.agregados.length;

    return `
    ${ciCabecera("Carga rápida", "Escribe el nombre o escanea el código de barras. Elige el producto, pon cuántos tienes y presiona Enter.", { atras: true })}
    <div class="ci-rapida">
        <div class="ci-buscador">
            <input id="ciBuscador" type="search" autocomplete="off" placeholder="Ej. martillo, cinta métrica, 7501206604571…" value="${ciEscapar(ciEstado.termino)}" oninput="ciAlEscribir(this.value)" onkeydown="ciAlTeclearBuscador(event)">
        </div>
        <div id="ciResultados" class="ci-resultados"></div>
        ${n ? `
        <div class="ci-agregados">
            <div class="ci-agregados-titulo"><strong>${n} producto${n === 1 ? "" : "s"} cargado${n === 1 ? "" : "s"}</strong><button type="button" class="ci-enlace" onclick="ciTerminarRapida()">Terminé</button></div>
            ${ciEstado.agregados.slice(-6).reverse().map(a => `<div class="ci-agregado"><span>✓ ${ciEscapar(a.nombre)}</span><small>${a.stock} pza · ${ciDinero(a.precio)}</small></div>`).join("")}
        </div>` : ""}
    </div>`;
}

function ciAlEscribir(texto) {
    ciEstado.termino = texto;
    clearTimeout(ciEstado.temporizador);

    if (!texto.trim()) {
        ciEstado.resultados = [];
        ciEstado.seleccionado = null;
        ciPintarResultados();
        return;
    }

    ciEstado.temporizador = setTimeout(() => ciBuscar(texto), 260);
}

function ciAlTeclearBuscador(evento) {
    if (evento.key !== "Enter") return;
    evento.preventDefault();

    clearTimeout(ciEstado.temporizador);
    const texto = evento.target.value;
    ciBuscar(texto, { alTerminar: () => {
        // Escaneo: un codigo completo con una sola coincidencia se abre solo.
        const solo = /^\d{8,14}$/.test(texto.trim()) ? ciEstado.resultados.filter(r => !r.yaLoTienes) : [];
        if (solo.length === 1) ciSeleccionar(0);
    } });
}

async function ciBuscar(texto, { alTerminar } = {}) {
    const termino = texto.trim();
    if (!termino) return;

    ciEstado.buscando = true;
    ciPintarResultados();

    const { ok, datos } = await ciLlamar(`/explorar-nexo/buscar?q=${encodeURIComponent(termino)}`);

    // Si ya escribio otra cosa mientras llegaba la respuesta, esta se descarta.
    if (ciEstado.termino.trim() !== termino) return;

    ciEstado.buscando = false;

    if (!ok) {
        ciEstado.resultados = [];
        ciPintarResultados("No se pudo buscar. Revisa tu conexión e intenta de nuevo.");
        return;
    }

    const existentes = ciExistentes();
    const vistos = new Set();
    const lista = [];

    // Primero lo que ya ofrece su proveedor (con sus precios), luego Nexo.
    for (const item of [...(datos.proveedor || []), ...(datos.catalogoMaestro || []), ...(datos.fabricante || [])]) {
        const clave = ciNormalizar(item.nombre);
        if (!item.nombre || vistos.has(clave)) continue;
        vistos.add(clave);

        const codigo = item.ean || item.codigo || "";
        lista.push({
            ...item,
            yaLoTienes: existentes.nombres.has(clave) || (codigo && existentes.codigos.has(ciNormalizar(codigo)))
        });
    }

    ciEstado.resultados = lista.slice(0, 8);
    ciEstado.seleccionado = null;
    ciPintarResultados();
    if (alTerminar) alTerminar();
}

function ciPintarResultados(mensaje = "") {
    const caja = document.getElementById("ciResultados");
    if (!caja) return;

    const termino = ciEstado.termino.trim();

    if (!termino) {
        caja.innerHTML = `<p class="ci-pista">Empieza a escribir y te muestro los productos de Nexo. Si no aparece, lo agregas a mano en un momento.</p>`;
        return;
    }

    if (mensaje) {
        caja.innerHTML = `<p class="ci-pista ci-error">${ciEscapar(mensaje)}</p>`;
        return;
    }

    if (ciEstado.buscando && !ciEstado.resultados.length) {
        caja.innerHTML = `<p class="ci-pista">Buscando…</p>`;
        return;
    }

    const filas = ciEstado.resultados.map((item, i) => {
        const precio = ciPrecioSugerido(item);
        const abierto = ciEstado.seleccionado === i;

        return `
        <div class="ci-resultado${abierto ? " ci-abierto" : ""}${item.yaLoTienes ? " ci-ya" : ""}">
            <div class="ci-resultado-fila">
                <div class="ci-resultado-texto">
                    <strong>${ciEscapar(item.nombre)}</strong>
                    <small>${[item.marca, item.codigo ? `Código ${item.codigo}` : "", precio ? `Precio sugerido ${ciDinero(precio)}` : "Sin precio sugerido"].filter(Boolean).map(ciEscapar).join(" · ")}</small>
                </div>
                ${item.yaLoTienes
                    ? `<span class="ci-ya-etiqueta">Ya lo tienes</span>`
                    : `<button type="button" class="ci-boton" onclick="ciSeleccionar(${i})">Agregar</button>`}
            </div>
            ${abierto ? ciFormularioItem(item, precio) : ""}
        </div>`;
    }).join("");

    caja.innerHTML = `
        ${filas || `<p class="ci-pista">No encontré «${ciEscapar(termino)}» en el catálogo.</p>`}
        <div class="ci-resultado ci-manual${ciEstado.seleccionado === "manual" ? " ci-abierto" : ""}">
            <div class="ci-resultado-fila">
                <div class="ci-resultado-texto"><strong>➕ Agregar «${ciEscapar(termino)}» a mano</strong><small>Solo necesitas el precio y cuántos tienes.</small></div>
                <button type="button" class="ci-boton ci-secundario" onclick="ciSeleccionar('manual')">Agregar a mano</button>
            </div>
            ${ciEstado.seleccionado === "manual" ? ciFormularioItem({ nombre: termino, fuente: "manual" }, null) : ""}
        </div>`;

    if (ciEstado.seleccionado !== null) {
        setTimeout(() => document.getElementById("ciStock")?.focus(), 30);
    }
}

function ciFormularioItem(item, precio) {
    return `
    <form class="ci-formulario" onsubmit="ciGuardarItem(event)">
        <label>Cuántos tienes
            <input id="ciStock" type="number" min="0" step="any" inputmode="decimal" placeholder="0" required>
        </label>
        <label>Precio de venta
            <input id="ciPrecio" type="number" min="0" step="0.01" inputmode="decimal" placeholder="0.00" value="${precio ? precio : ""}" required>
        </label>
        ${typeof perfilEsSimple === "function" && perfilEsSimple() ? `<label>Te cuesta (precio distribuidor)
            <input id="ciCosto" type="number" min="0" step="0.01" inputmode="decimal" placeholder="Opcional">
        </label>` : ""}
        <button type="submit" class="ci-boton" ${ciEstado.ocupado ? "disabled" : ""}>Guardar y seguir</button>
        <p class="ci-error" id="ciErrorItem"></p>
    </form>`;
}

function ciSeleccionar(indice) {
    ciEstado.seleccionado = indice;
    ciPintarResultados();
}

async function ciGuardarItem(evento) {
    evento.preventDefault();
    if (ciEstado.ocupado) return;

    const indice = ciEstado.seleccionado;
    const item = indice === "manual" ? { nombre: ciEstado.termino.trim(), fuente: "manual" } : ciEstado.resultados[indice];
    if (!item) return;

    const stock = Number(document.getElementById("ciStock").value);
    const precio = Number(document.getElementById("ciPrecio").value);
    const error = document.getElementById("ciErrorItem");

    if (!Number.isFinite(precio) || precio < 0) { error.textContent = "Escribe el precio de venta."; return; }
    if (!Number.isFinite(stock) || stock < 0) { error.textContent = "Escribe cuántos tienes."; return; }

    const costoTexto = document.getElementById("ciCosto")?.value;
    const costo = costoTexto === undefined || costoTexto === "" ? null : Number(costoTexto);

    if (costo !== null && (!Number.isFinite(costo) || costo < 0)) { error.textContent = "El costo no es un numero."; return; }

    ciEstado.ocupado = true;

    const producto = item.fuente === "manual"
        ? { nombre: item.nombre, precio, precioPublico: precio, stock }
        : ciProductoDesdeCatalogo(item, { stock, precio });

    if (costo !== null) producto.precioDistribuidor = costo;

    const { ok, datos } = await ciLlamar("/agregar-producto", { method: "POST", body: JSON.stringify(producto) });
    ciEstado.ocupado = false;

    if (!ok) {
        error.textContent = datos.error || "No se pudo guardar. Intenta de nuevo.";
        return;
    }

    ciEstado.agregados.push({ nombre: producto.nombre, codigo: producto.codigo || "", precio, stock });
    ciEstado.termino = "";
    ciEstado.resultados = [];
    ciEstado.seleccionado = null;
    ciRender();
}

async function ciTerminarRapida() {
    if (typeof cargarProductos === "function") await cargarProductos().catch(() => {});
    ciIr("inicio");
}

// ----- Pegar o subir mi lista

function ciPintarLista() {
    const imp = ciEstado.importacion;

    if (imp && imp.fase === "resultado") return ciPintarResultadoImportacion(imp);
    if (imp && imp.fase === "importando") return ciPintarProgreso(imp);
    if (imp && imp.fase === "vista-previa") return ciPintarVistaPrevia(imp);

    return `
    ${ciCabecera("Pegar o subir mi lista", "Copia tus productos desde Excel y pégalos aquí, o sube un archivo CSV. Nexo entiende solo qué columna es cuál.", { atras: true })}
    <div class="ci-lista">
        <textarea id="ciPegado" rows="9" placeholder="Pega aquí tus celdas de Excel (con los encabezados: nombre, precio, cantidad…)" spellcheck="false"></textarea>
        <div class="ci-lista-acciones">
            <button type="button" class="ci-boton" onclick="ciLeerPegado()">Revisar mi lista</button>
            <label class="ci-subir">o sube un archivo CSV
                <input type="file" accept=".csv,.txt,.tsv,text/csv,text/plain" onchange="ciLeerArchivo(event)">
            </label>
        </div>
        <p class="ci-pista">Tip: en Excel selecciona las celdas, copia (Ctrl+C) y pega aquí (Ctrl+V). Si tu lista es un .xlsx, guárdala como «CSV» o simplemente copia y pega.</p>
        <p class="ci-error" id="ciErrorLista"></p>
    </div>`;
}

function ciLeerArchivo(evento) {
    const archivo = evento.target.files?.[0];
    if (!archivo) return;

    if (archivo.size > 5 * 1024 * 1024) {
        document.getElementById("ciErrorLista").textContent = "El archivo es muy grande (máximo 5 MB).";
        return;
    }

    const lector = new FileReader();
    lector.onload = () => ciRevisarTexto(String(lector.result || ""));
    lector.onerror = () => { document.getElementById("ciErrorLista").textContent = "No se pudo leer el archivo."; };
    lector.readAsText(archivo, "utf-8");
}

function ciLeerPegado() {
    ciRevisarTexto(document.getElementById("ciPegado")?.value || "");
}

function ciRevisarTexto(texto) {
    const error = document.getElementById("ciErrorLista");
    const tabla = ciParsearTabla(texto);

    if (tabla.length < 1 || tabla.length === 1 && !ciTieneEncabezado(tabla[0]) && tabla[0].length < 2) {
        if (error) error.textContent = "No encontré productos. Pega al menos el nombre y el precio de cada uno.";
        return;
    }

    if (tabla.length > 1001) {
        if (error) error.textContent = "La lista es muy grande: importa hasta 1,000 productos a la vez.";
        return;
    }

    const encabezado = ciTieneEncabezado(tabla[0]);
    const encabezados = encabezado ? tabla[0] : tabla[0].map((_, i) => `Columna ${i + 1}`);
    const filas = encabezado ? tabla.slice(1) : tabla;
    const mapeo = ciAdivinarColumnas(encabezado ? encabezados : []);

    // Sin encabezados: se supone nombre, precio, cantidad, codigo.
    if (!encabezado) {
        ["nombre", "precio", "stock", "codigo"].forEach((campo, i) => { mapeo[campo] = i < encabezados.length ? i : -1; });
        mapeo.marca = -1;
        mapeo.categoria = -1;
        mapeo.costo = -1;
    }

    if (!filas.length) {
        if (error) error.textContent = "La lista solo tiene encabezados. Agrega al menos un producto.";
        return;
    }

    ciEstado.importacion = { fase: "vista-previa", encabezados, filas, mapeo, resultado: null };
    ciRender();
}

function ciPintarVistaPrevia(imp) {
    const preparadas = ciPrepararFilas(imp.filas, imp.mapeo, ciExistentes());
    imp.preparadas = preparadas;

    const opciones = indiceElegido => `
        <option value="-1"${indiceElegido === -1 ? " selected" : ""}>— no la tengo —</option>
        ${imp.encabezados.map((h, i) => `<option value="${i}"${indiceElegido === i ? " selected" : ""}>${ciEscapar(h || `Columna ${i + 1}`)}</option>`).join("")}`;

    const muestra = preparadas.listas.slice(0, 6);
    const faltanObligatorias = CI_CAMPOS.filter(c => c.obligatorio && imp.mapeo[c.id] < 0);

    return `
    ${ciCabecera("Revisa tu lista", "Confirma qué columna es cada dato. Si algo está mal, cámbialo y la vista previa se actualiza sola.", { atras: true })}
    <div class="ci-lista">
        <div class="ci-mapeo">
            ${CI_CAMPOS.map(c => `
            <label>${c.etiqueta}${c.obligatorio ? " *" : ""}
                <select onchange="ciCambiarColumna('${c.id}', this.value)">${opciones(imp.mapeo[c.id])}</select>
            </label>`).join("")}
        </div>

        <div class="ci-resumen">
            <div class="ci-cifra ci-ok"><strong>${preparadas.listas.length}</strong><span>listos para importar</span></div>
            <div class="ci-cifra"><strong>${preparadas.duplicadas.length}</strong><span>ya los tienes (se omiten)</span></div>
            <div class="ci-cifra ${preparadas.conProblemas.length ? "ci-alerta" : ""}"><strong>${preparadas.conProblemas.length}</strong><span>con problemas</span></div>
        </div>

        ${faltanObligatorias.length ? `<p class="ci-error">Falta indicar: ${faltanObligatorias.map(c => c.etiqueta).join(" y ")}.</p>` : ""}

        ${muestra.length ? `
        <table class="ci-tabla">
            <thead><tr><th>Producto</th><th>Precio</th><th>Cantidad</th><th>Código</th></tr></thead>
            <tbody>${muestra.map(f => `<tr><td>${ciEscapar(f.nombre)}</td><td>${ciDinero(f.precio)}</td><td>${f.stock}</td><td>${ciEscapar(f.codigo || "—")}</td></tr>`).join("")}</tbody>
        </table>
        ${preparadas.listas.length > muestra.length ? `<p class="ci-pista">Y ${preparadas.listas.length - muestra.length} más.</p>` : ""}` : ""}

        ${preparadas.conProblemas.length ? `
        <details class="ci-problemas"><summary>Ver los ${preparadas.conProblemas.length} con problemas</summary>
            ${preparadas.conProblemas.slice(0, 30).map(p => `<div>Fila ${p.fila}${p.nombre ? ` (${ciEscapar(p.nombre)})` : ""}: ${ciEscapar(p.motivo)}</div>`).join("")}
        </details>` : ""}

        <div class="ci-lista-acciones">
            <button type="button" class="ci-boton" ${preparadas.listas.length && !faltanObligatorias.length ? "" : "disabled"} onclick="ciImportar()">Importar ${preparadas.listas.length} producto${preparadas.listas.length === 1 ? "" : "s"}</button>
            <button type="button" class="ci-boton ci-secundario" onclick="ciEstado.importacion = null; ciRender();">Cambiar lista</button>
        </div>
    </div>`;
}

function ciCambiarColumna(campo, valor) {
    ciEstado.importacion.mapeo[campo] = Number(valor);
    ciRender();
}

async function ciImportar() {
    const imp = ciEstado.importacion;
    if (!imp || !imp.preparadas || imp.fase !== "vista-previa") return;

    const pendientes = imp.preparadas.listas.slice();
    const total = pendientes.length;

    imp.fase = "importando";
    imp.progreso = { hechos: 0, total, creados: 0, errores: [] };
    ciRender();

    // Pocos a la vez: el servidor resuelve categoria, proveedor y codigos en cada alta.
    const trabajadores = Array.from({ length: 3 }, async () => {
        while (pendientes.length) {
            const fila = pendientes.shift();

            try {
                const { ok, datos } = await ciLlamar("/agregar-producto", {
                    method: "POST",
                    body: JSON.stringify({
                        nombre: fila.nombre,
                        precio: fila.precio,
                        precioPublico: fila.precio,
                        stock: fila.stock,
                        codigo: fila.codigo,
                        marca: fila.marca,
                        categoria: fila.categoria,
                        ...(fila.costo !== null && fila.costo !== undefined ? { precioDistribuidor: fila.costo } : {})
                    })
                });

                if (ok) {
                    imp.progreso.creados++;
                    ciEstado.agregados.push({ nombre: fila.nombre, codigo: fila.codigo, precio: fila.precio, stock: fila.stock });
                } else {
                    imp.progreso.errores.push({ fila: fila.fila, nombre: fila.nombre, motivo: datos.error || "No se pudo guardar" });
                }
            } catch (error) {
                imp.progreso.errores.push({ fila: fila.fila, nombre: fila.nombre, motivo: "Sin conexión" });
            }

            imp.progreso.hechos++;
            ciActualizarProgreso(imp.progreso);
        }
    });

    await Promise.all(trabajadores);

    if (typeof cargarProductos === "function") await cargarProductos().catch(() => {});

    imp.fase = "resultado";
    imp.resultado = { creados: imp.progreso.creados, omitidos: imp.preparadas.duplicadas.length, errores: imp.progreso.errores.concat(imp.preparadas.conProblemas) };
    ciRender();
}

function ciPintarProgreso(imp) {
    const p = imp.progreso;
    const porcentaje = p.total ? Math.round((p.hechos / p.total) * 100) : 0;

    return `
    ${ciCabecera("Importando tu lista…", "No cierres esta pantalla. Esto toma unos segundos.")}
    <div class="ci-lista">
        <div class="ci-barra"><span id="ciBarraAvance" style="width:${porcentaje}%"></span></div>
        <p class="ci-pista" id="ciTextoAvance">${p.hechos} de ${p.total}</p>
    </div>`;
}

function ciActualizarProgreso(p) {
    const barra = document.getElementById("ciBarraAvance");
    const texto = document.getElementById("ciTextoAvance");
    if (barra) barra.style.width = `${Math.round((p.hechos / p.total) * 100)}%`;
    if (texto) texto.textContent = `${p.hechos} de ${p.total}`;
}

function ciPintarResultadoImportacion(imp) {
    const r = imp.resultado;

    return `
    ${ciCabecera(r.creados ? "¡Listo, tu lista quedó cargada!" : "No se importó ningún producto", r.creados ? "Ya puedes venderlos desde el Punto de venta." : "Revisa los problemas y vuelve a intentarlo.")}
    <div class="ci-lista">
        <div class="ci-resumen">
            <div class="ci-cifra ci-ok"><strong>${r.creados}</strong><span>productos creados</span></div>
            <div class="ci-cifra"><strong>${r.omitidos}</strong><span>ya los tenías</span></div>
            <div class="ci-cifra ${r.errores.length ? "ci-alerta" : ""}"><strong>${r.errores.length}</strong><span>con problemas</span></div>
        </div>
        ${r.errores.length ? `<details class="ci-problemas"><summary>Ver los problemas</summary>${r.errores.slice(0, 50).map(p => `<div>Fila ${p.fila}${p.nombre ? ` (${ciEscapar(p.nombre)})` : ""}: ${ciEscapar(p.motivo)}</div>`).join("")}</details>` : ""}
        <div class="ci-lista-acciones">
            <button type="button" class="ci-boton" onclick="ciEstado.importacion = null; mostrarInventario();">Ver mi inventario</button>
            <button type="button" class="ci-boton ci-secundario" onclick="ciEstado.importacion = null; ciIr('inicio');">Cargar más</button>
        </div>
    </div>`;
}
