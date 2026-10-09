// Fase 2 del plan "celular como plan B": alta y edicion rapida de producto,
// ajuste de existencias, foto con la camara y recepcion de mercancia
// escaneando. Con la computadora caida, el inventario no puede quedarse
// congelado: llega mercancia, se cuenta, se rompe, se vende algo que nunca
// se dio de alta.
//
// Se carga despues de dueno.js y usa sus globales (fetchAutenticado,
// duenoTienePermiso, guardarCatalogoLocal, mostrarToastDueno, etc.).
// Todo cambio de datos pasa por rutas del servidor que ya validan permisos
// (modificar_inventario) y dejan rastro; aqui solo esta la pantalla.

async function refrescarCatalogoLocalDueno() {
    try {
        await guardarCatalogoLocal(await fetchAutenticado("/productos"));
    } catch (error) {
        // Sin conexion se queda el catalogo guardado; el siguiente "Vender"
        // o "Inicio" con señal lo vuelve a sembrar.
    }
}

function actualizarAccionesInventarioDueno() {
    const caja = document.getElementById("duenoInventarioAcciones");
    if (caja) caja.style.display = duenoTienePermiso("modificar_inventario") ? "" : "none";
}

// El servidor guarda los codigos sin guiones ni espacios (UI-NUEVO-7 queda
// UINUEVO7), igual que el escritorio -- para comparar hay que quitarlos
// tambien aqui, o el mismo codigo escrito distinto no se reconoce.
function normalizarCodigoDueno(codigo) {
    return String(codigo || "").replace(/[^a-zA-Z0-9]/g, "").toLowerCase();
}

function numeroODefecto(valor, defecto = 0) {
    const numero = Number(valor);
    return Number.isFinite(numero) ? numero : defecto;
}

// ---------------- escaner de codigos (generico) ----------------
// El de Vender (duenoVender...) esta amarrado al carrito; este solo entrega
// el codigo a quien lo abrio. continuo=true lo deja abierto para escanear
// varios seguidos (recepcion de mercancia).

let duenoEscanerCodigoControles = null;
let duenoEscanerCodigoAlCodigo = null;
let duenoEscanerCodigoContinuo = false;
let duenoEscanerCodigoUltimo = { codigo: null, tiempo: 0 };

function detenerEscanerCodigoDueno() {
    if (duenoEscanerCodigoControles) {
        try { duenoEscanerCodigoControles.stop(); } catch (error) { /* nada que hacer */ }
        duenoEscanerCodigoControles = null;
    }
}

async function abrirEscanerCodigoDueno({ titulo = "Escanear", alCodigo, continuo = false }) {
    duenoEscanerCodigoAlCodigo = alCodigo;
    duenoEscanerCodigoContinuo = continuo;
    duenoEscanerCodigoUltimo = { codigo: null, tiempo: 0 };

    document.getElementById("duenoEscanerCodigoTitulo").textContent = titulo;
    document.getElementById("duenoEscanerCodigoOverlay").classList.add("abierta");

    document.getElementById("duenoEscanerCodigoManualForm").onsubmit = evento => {
        evento.preventDefault();
        const input = document.getElementById("duenoEscanerCodigoManualInput");
        const codigo = input.value.trim();
        if (!codigo) return;
        input.value = "";
        procesarCodigoEscaneadoDueno(codigo, true);
    };

    const estado = document.getElementById("duenoEscanerCodigoEstado");
    estado.textContent = "Cargando lector...";

    try {
        await duenoPedCargarZxing();
    } catch (error) {
        estado.textContent = "No se pudo cargar el lector de codigos. Escribe el codigo a mano.";
        return;
    }

    estado.textContent = "Abriendo camara...";

    try {
        const video = document.getElementById("duenoEscanerCodigoVideo");
        const lector = new window.ZXingBrowser.BrowserMultiFormatReader();

        duenoEscanerCodigoControles = await lector.decodeFromVideoDevice(undefined, video, resultado => {
            if (resultado) procesarCodigoEscaneadoDueno(resultado.getText(), false);
        });

        estado.textContent = "Apunta la camara al codigo de barras.";
    } catch (error) {
        estado.textContent = "No se pudo abrir la camara. Revisa los permisos del navegador, o escribe el codigo a mano.";
    }
}

function cerrarEscanerCodigoDueno() {
    detenerEscanerCodigoDueno();
    document.getElementById("duenoEscanerCodigoOverlay").classList.remove("abierta");
}

// La camara dispara varios frames con el mismo codigo mientras sigue
// apuntando al producto: sin este enfriamiento un solo producto contaria
// decenas de veces. Lo escrito a mano nunca se descarta.
function procesarCodigoEscaneadoDueno(codigo, esManual) {
    const limpio = String(codigo || "").trim();
    if (!limpio) return;

    const ahora = Date.now();
    if (!esManual && limpio === duenoEscanerCodigoUltimo.codigo && ahora - duenoEscanerCodigoUltimo.tiempo < 2500) return;
    duenoEscanerCodigoUltimo = { codigo: limpio, tiempo: ahora };

    const alCodigo = duenoEscanerCodigoAlCodigo;
    if (!duenoEscanerCodigoContinuo) cerrarEscanerCodigoDueno();
    if (alCodigo) alCodigo(limpio);
}

// Busca un producto por codigo: primero en el catalogo guardado (rapido, sin
// señal) y, si no esta y hay internet, en el servidor, que tambien conoce los
// codigos alternos y de proveedor.
async function buscarProductoPorCodigoDueno(codigo) {
    const limpio = String(codigo || "").trim();
    if (!limpio) return null;

    // buscarEnCatalogoLocal compara por "contiene", asi que el codigo tal cual
    // lo escribio la persona (con guiones) puede no aparecer aunque exista:
    // se busca con la version limpia y se exige coincidencia exacta.
    const locales = await buscarEnCatalogoLocal(normalizarCodigoDueno(limpio));
    const exacto = locales.find(p => normalizarCodigoDueno(p.codigo) === normalizarCodigoDueno(limpio));
    if (exacto) return exacto;

    if (!navigator.onLine) return null;

    try {
        const remoto = await fetchAutenticado(`/producto-codigo/${encodeURIComponent(limpio)}`);
        if (!remoto || !remoto.id) return null;

        return {
            id: remoto.id,
            nombre: remoto.nombre || "",
            codigo: remoto.codigo || "",
            precio: numeroODefecto(remoto.precio_publico ?? remoto.precio),
            stock: numeroODefecto(remoto.stock)
        };
    } catch (error) {
        return null;
    }
}

// ---------------- detalle de producto con acciones (Inventario) ----------------

async function abrirDetalleProductoInventarioDueno(id) {
    try {
        const datos = await fetchAutenticado(`/productos/${Number(id)}`);

        if (!datos?.producto) {
            mostrarToastDueno("No se pudo cargar el producto.");
            return;
        }

        const p = datos.producto;

        renderDetalleProductoDueno({
            id: p.id,
            nombre: p.nombre,
            codigo: p.codigo,
            precio: p.precio_publico ?? p.precio,
            stock: p.stock,
            imagenUrl: p.imagenUrl,
            categoria: p.categoria,
            marca: p.marca,
            descripcion: p.descripcion,
            unidadVenta: p.unidad_venta,
            stockMinimo: p.stock_minimo,
            ubicacion: p.ubicacion,
            precioMayoreo: p.precio_mayoreo,
            precioDistribuidor: p.precio_distribuidor,
            costo: p.costo,
            fechaCaducidad: p.fecha_caducidad,
            completo: p
        }, "gestion");
    } catch (error) {
        mostrarToastDueno("No se pudo conectar. Revisa tu internet.");
    }
}

function htmlAccionesGestionProductoDueno() {
    const botones = [];

    if (duenoTienePermiso("modificar_inventario")) {
        botones.push(`<button type="button" class="dueno-boton-primario" onclick="abrirEdicionProductoDesdeDetalleDueno()">Editar producto</button>`);
        botones.push(`<button type="button" class="dueno-boton-secundario" onclick="abrirAjusteExistenciasDueno()">Ajustar existencias</button>`);
        botones.push(`<button type="button" class="dueno-boton-secundario" onclick="cambiarFotoProductoDueno()">${duenoProductoDetalleActual?.imagenUrl ? "Cambiar foto" : "Tomar foto"}</button>`);
    }

    // Cotizar es del dueño: un cajero no arma pedidos desde el inventario.
    if (duenoRolSesion !== "employee") {
        botones.push(`<button type="button" class="dueno-link" onclick="agregarDesdeDetalleDueno()">Agregar al pedido</button>`);
    }

    return botones.join("");
}

// ---------------- formulario: producto nuevo / editar ----------------

let duenoProductoForm = null;

function abrirFormularioProductoDueno(producto, opciones = {}) {
    cerrarDetalleProductoDueno();

    duenoProductoForm = {
        modo: producto ? "editar" : "nuevo",
        producto: producto || null,
        fotoBase64: null,
        categoriaNexo: null,
        codigoInicial: opciones.codigo || "",
        alGuardar: opciones.alGuardar || null,
        guardando: false
    };

    renderFormularioProductoDueno();
    document.getElementById("duenoProductoFormOverlay").style.display = "flex";
}

function cerrarFormularioProductoDueno() {
    document.getElementById("duenoProductoFormOverlay").style.display = "none";
    duenoProductoForm = null;
}

function valorCampoForm(valor) {
    return valor === null || valor === undefined ? "" : String(valor);
}

function renderFormularioProductoDueno() {
    const estado = duenoProductoForm;
    if (!estado) return;

    const editar = estado.modo === "editar";
    const p = estado.producto || {};
    const veCosto = duenoRolSesion !== "employee";

    document.getElementById("duenoProductoFormContenido").innerHTML = `
        <h2>${editar ? "Editar producto" : "Producto nuevo"}</h2>
        ${editar ? `<p class="dueno-estado">Solo se cambia lo que modifiques aqui. Para existencias usa "Ajustar existencias".</p>` : `<p class="dueno-estado">Lo basico para empezar a venderlo. Los demas datos los completas despues en la computadora.</p>`}

        <label class="dueno-campo">Codigo de barras${editar ? "" : " (si no tiene, se le crea uno)"}
            <div class="dueno-campo-fila">
                <input type="text" id="duenoProdCodigo" value="${escaparDueno(editar ? valorCampoForm(p.codigo) : estado.codigoInicial)}" autocomplete="off" placeholder="Escanea o escribe">
                <button type="button" class="dueno-boton-secundario-chico" onclick="escanearCodigoProductoDueno()">Escanear</button>
            </div>
        </label>

        <label class="dueno-campo">Nombre
            <input type="text" id="duenoProdNombre" value="${escaparDueno(valorCampoForm(p.nombre))}" autocomplete="off" placeholder="Ej. Martillo de bola 16 oz">
        </label>

        <label class="dueno-campo">Precio publico
            <input type="number" id="duenoProdPrecioPublico" inputmode="decimal" min="0" step="0.01" value="${escaparDueno(valorCampoForm(editar ? (p.precio_publico ?? p.precio) : ""))}" placeholder="0.00">
        </label>

        <label class="dueno-campo">Precio medio mayoreo (opcional)
            <input type="number" id="duenoProdPrecioMayoreo" inputmode="decimal" min="0" step="0.01" value="${escaparDueno(valorCampoForm(p.precio_mayoreo))}" placeholder="0.00">
        </label>

        ${editar ? `
            <label class="dueno-campo">Precio distribuidor (opcional)
                <input type="number" id="duenoProdPrecioDistribuidor" inputmode="decimal" min="0" step="0.01" value="${escaparDueno(valorCampoForm(p.precio_distribuidor))}" placeholder="0.00">
            </label>
            ${veCosto ? `
                <label class="dueno-campo">Costo (opcional)
                    <input type="number" id="duenoProdCosto" inputmode="decimal" min="0" step="0.01" value="${escaparDueno(valorCampoForm(p.costo))}" placeholder="0.00">
                </label>
            ` : ""}
            <label class="dueno-campo">Ubicacion (opcional)
                <input type="text" id="duenoProdUbicacion" value="${escaparDueno(valorCampoForm(p.ubicacion))}" autocomplete="off" placeholder="Ej. Pasillo 3">
            </label>
            <label class="dueno-campo">Caduca (opcional)
                <input type="date" id="duenoProdCaducidad" value="${escaparDueno(valorCampoForm(p.fecha_caducidad).slice(0, 10))}">
            </label>
        ` : `
            <label class="dueno-campo">Existencias iniciales
                <input type="number" id="duenoProdStock" inputmode="decimal" min="0" step="any" value="0">
            </label>
        `}

        <label class="dueno-campo">Avisar cuando queden (stock minimo)
            <input type="number" id="duenoProdStockMinimo" inputmode="decimal" min="0" step="any" value="${escaparDueno(valorCampoForm(editar ? p.stock_minimo : 3))}">
        </label>

        ${editar ? "" : `
            <div class="dueno-campo">Categoria
                <div id="duenoProdCategoria" class="dueno-estado" style="margin:5px 0;">Sin categoria</div>
                <button type="button" class="dueno-boton-secundario-chico" id="btnProdSugerirCategoria" onclick="sugerirCategoriaProductoDueno()">Sugerir con Nexo IA</button>
            </div>

            <div class="dueno-campo">Foto (opcional)
                <div id="duenoProdFotoPreview" class="dueno-estado" style="margin:5px 0;">Sin foto</div>
                <input type="file" id="duenoProdFotoInput" accept="image/*" capture="environment" style="display:none;" onchange="previsualizarFotoNuevoProductoDueno(this.files[0])">
                <button type="button" class="dueno-boton-secundario-chico" onclick="document.getElementById('duenoProdFotoInput').click()">Tomar foto</button>
            </div>
        `}

        <p id="duenoProdError" class="dueno-login-error" style="display:none;"></p>
        <button type="button" class="dueno-boton-primario" id="btnGuardarProducto" onclick="guardarProductoDueno()">${editar ? "Guardar cambios" : "Crear producto"}</button>
    `;
}

function mostrarErrorProductoDueno(mensaje) {
    const error = document.getElementById("duenoProdError");
    if (!error) return;
    error.textContent = mensaje;
    error.style.display = mensaje ? "block" : "none";
}

function escanearCodigoProductoDueno() {
    abrirEscanerCodigoDueno({
        titulo: "Escanear codigo",
        alCodigo: codigo => {
            const campo = document.getElementById("duenoProdCodigo");
            if (campo) campo.value = codigo;
        }
    });
}

async function previsualizarFotoNuevoProductoDueno(archivo) {
    if (!archivo || !duenoProductoForm) return;

    try {
        duenoProductoForm.fotoBase64 = await redimensionarImagenCanvasDueno(archivo, 1024);
        document.getElementById("duenoProdFotoPreview").innerHTML = `<img src="${duenoProductoForm.fotoBase64}" alt="Vista previa" style="max-width:100%;max-height:140px;border-radius:12px;">`;
    } catch (error) {
        mostrarErrorProductoDueno(error.message || "No se pudo leer la foto.");
    }
}

async function sugerirCategoriaProductoDueno() {
    const nombre = document.getElementById("duenoProdNombre")?.value.trim() || "";

    if (!nombre) {
        mostrarErrorProductoDueno("Escribe primero el nombre para sugerir la categoria.");
        return;
    }

    mostrarErrorProductoDueno("");
    const boton = document.getElementById("btnProdSugerirCategoria");
    if (boton) { boton.disabled = true; boton.textContent = "Pensando..."; }

    try {
        const datos = await fetchAutenticado("/ia/sugerir-categoria-nexo", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ nombre })
        });

        if (!datos.disponible) {
            mostrarToastDueno("Nexo IA no esta incluida en tu plan.");
        } else if (!datos.categoriaNexoId) {
            mostrarToastDueno("No encontre una categoria clara. Puedes completarla en la computadora.");
        } else if (duenoProductoForm) {
            duenoProductoForm.categoriaNexo = { id: datos.categoriaNexoId, departamento: datos.departamento, nombre: datos.nombre };
            document.getElementById("duenoProdCategoria").textContent = `${datos.departamento} › ${datos.nombre}`;
        }
    } catch (error) {
        mostrarToastDueno(error.message || "No se pudo consultar a Nexo IA.");
    } finally {
        if (boton) { boton.disabled = false; boton.textContent = "Sugerir con Nexo IA"; }
    }
}

function leerCampoNumeroDueno(id) {
    const crudo = document.getElementById(id)?.value;
    return crudo === undefined ? undefined : crudo.trim();
}

async function guardarProductoDueno() {
    const estado = duenoProductoForm;
    if (!estado || estado.guardando) return;

    const boton = document.getElementById("btnGuardarProducto");
    estado.guardando = true;
    if (boton) boton.disabled = true;

    try {
        if (estado.modo === "editar") {
            await guardarEdicionProductoDueno();
        } else {
            await guardarProductoNuevoDueno();
        }
    } catch (error) {
        mostrarErrorProductoDueno(error.message || "No se pudo guardar.");
    } finally {
        if (duenoProductoForm) duenoProductoForm.guardando = false;
        if (boton) boton.disabled = false;
    }
}

async function guardarProductoNuevoDueno() {
    const estado = duenoProductoForm;

    const nombre = document.getElementById("duenoProdNombre").value.trim();
    const codigo = document.getElementById("duenoProdCodigo").value.trim();
    const precio = numeroODefecto(leerCampoNumeroDueno("duenoProdPrecioPublico"), NaN);
    const mayoreoTexto = leerCampoNumeroDueno("duenoProdPrecioMayoreo");
    const stock = numeroODefecto(leerCampoNumeroDueno("duenoProdStock"), 0);
    const stockMinimo = numeroODefecto(leerCampoNumeroDueno("duenoProdStockMinimo"), 3);

    if (!nombre) throw new Error("Escribe el nombre del producto.");
    if (!(precio > 0)) throw new Error("Escribe el precio publico.");
    if (stock < 0) throw new Error("Las existencias no pueden ser negativas.");

    mostrarErrorProductoDueno("");

    // Evita el duplicado mas comun: escanear algo que ya existe.
    if (codigo) {
        const existente = await buscarProductoPorCodigoDueno(codigo);
        if (existente) {
            throw new Error(`Ya existe "${existente.nombre}" con ese codigo. Buscalo en Inventario para editarlo o ajustar su stock.`);
        }
    }

    const cuerpo = {
        nombre,
        precio,
        precioPublico: precio,
        stock,
        stockMinimo,
        codigo,
        unidadVenta: "pieza"
    };

    if (mayoreoTexto !== "" && mayoreoTexto !== undefined) cuerpo.precioMayoreo = Number(mayoreoTexto);

    if (estado.categoriaNexo) {
        cuerpo.categoriaNexoId = estado.categoriaNexo.id;
        cuerpo.subcategoria = estado.categoriaNexo.nombre;
    }

    const creado = await fetchAutenticado("/agregar-producto", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(cuerpo)
    });

    const productoId = creado.productoId;
    // El codigo que quedo guardado (ya sin guiones), no el que se tecleo.
    let codigoFinal = creado.producto?.codigo || codigo;

    // Sin codigo no se puede escanear, ni tener foto, ni etiqueta: se le crea
    // el interno NX-<id>, igual que el boton "Generar codigo" de la compu.
    if (!codigoFinal) {
        try {
            const generado = await fetchAutenticado(`/productos/${productoId}/generar-codigo`, { method: "POST" });
            codigoFinal = generado.codigo || "";
        } catch (error) {
            mostrarToastDueno("Producto creado, pero no se pudo generar su codigo.");
        }
    }

    if (estado.fotoBase64 && codigoFinal) {
        try {
            await fetchAutenticado(`/fotos-producto/${encodeURIComponent(codigoFinal)}/principal`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ imagenBase64: estado.fotoBase64 })
            });
        } catch (error) {
            mostrarToastDueno("Producto creado, pero no se pudo subir la foto.");
        }
    }

    const alGuardar = estado.alGuardar;
    cerrarFormularioProductoDueno();
    mostrarToastDueno(`"${nombre}" creado${codigoFinal ? ` (codigo ${codigoFinal})` : ""}.`);

    await refrescarCatalogoLocalDueno();
    if (typeof filtrarInventarioDueno === "function") filtrarInventarioDueno();
    if (alGuardar) alGuardar({ id: productoId, nombre, codigo: codigoFinal, precio, stock });
}

async function guardarEdicionProductoDueno() {
    const estado = duenoProductoForm;
    const original = estado.producto;
    const cambios = {};

    const nombre = document.getElementById("duenoProdNombre").value.trim();
    if (!nombre) throw new Error("El nombre no puede quedar vacio.");
    if (nombre !== String(original.nombre || "")) cambios.nombre = nombre;

    const codigo = document.getElementById("duenoProdCodigo").value.trim();
    if (codigo !== String(original.codigo || "")) cambios.codigo = codigo;

    const comparar = (idCampo, clave, valorOriginal, { permitirVacio = true } = {}) => {
        const texto = leerCampoNumeroDueno(idCampo);
        if (texto === undefined) return;

        const valorAnterior = valorOriginal === null || valorOriginal === undefined ? "" : String(Number(valorOriginal));
        const valorNuevo = texto === "" ? "" : String(Number(texto));

        if (valorNuevo === valorAnterior) return;
        if (texto === "" && !permitirVacio) throw new Error("Hay un precio obligatorio vacio.");
        if (texto !== "" && !(Number(texto) >= 0)) throw new Error("Revisa los precios: deben ser numeros.");

        cambios[clave] = texto === "" ? "" : Number(texto);
    };

    comparar("duenoProdPrecioPublico", "precioPublico", original.precio_publico ?? original.precio, { permitirVacio: false });
    comparar("duenoProdPrecioMayoreo", "precioMayoreo", original.precio_mayoreo);
    comparar("duenoProdPrecioDistribuidor", "precioDistribuidor", original.precio_distribuidor);
    comparar("duenoProdCosto", "costo", original.costo);
    comparar("duenoProdStockMinimo", "stockMinimo", original.stock_minimo, { permitirVacio: false });

    const ubicacion = document.getElementById("duenoProdUbicacion")?.value.trim();
    if (ubicacion !== undefined && ubicacion !== String(original.ubicacion || "")) cambios.ubicacion = ubicacion;

    const caducidad = document.getElementById("duenoProdCaducidad")?.value || "";
    if (caducidad !== String(original.fecha_caducidad || "").slice(0, 10)) cambios.fechaCaducidad = caducidad || null;

    if (!Object.keys(cambios).length) {
        mostrarErrorProductoDueno("No cambiaste nada.");
        return;
    }

    mostrarErrorProductoDueno("");

    await fetchAutenticado(`/productos/${Number(original.id)}/edicion-rapida`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(cambios)
    });

    cerrarFormularioProductoDueno();
    mostrarToastDueno("Cambios guardados.");

    await refrescarCatalogoLocalDueno();
    if (typeof filtrarInventarioDueno === "function") filtrarInventarioDueno();
    abrirDetalleProductoInventarioDueno(original.id);
}

function abrirEdicionProductoDesdeDetalleDueno() {
    const completo = duenoProductoDetalleActual?.completo;
    if (!completo) return;
    abrirFormularioProductoDueno(completo);
}

// ---------------- foto con la camara ----------------

function cambiarFotoProductoDueno() {
    const detalle = duenoProductoDetalleActual;
    if (!detalle) return;

    let input = document.getElementById("duenoFotoProductoInput");

    if (!input) {
        input = document.createElement("input");
        input.type = "file";
        input.id = "duenoFotoProductoInput";
        input.accept = "image/*";
        input.setAttribute("capture", "environment");
        input.hidden = true;
        document.body.appendChild(input);
    }

    input.value = "";
    input.onchange = () => {
        const archivo = input.files?.[0];
        if (archivo) subirFotoProductoDueno(archivo);
    };
    input.click();
}

async function subirFotoProductoDueno(archivo) {
    const detalle = duenoProductoDetalleActual;
    if (!detalle) return;

    try {
        mostrarToastDueno("Subiendo foto...");
        const imagenBase64 = await redimensionarImagenCanvasDueno(archivo, 1024);
        let codigo = detalle.codigo;

        if (!codigo) {
            const generado = await fetchAutenticado(`/productos/${Number(detalle.id)}/generar-codigo`, { method: "POST" });
            codigo = generado.codigo;
        }

        await fetchAutenticado(`/fotos-producto/${encodeURIComponent(codigo)}/principal`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ imagenBase64 })
        });

        mostrarToastDueno("Foto guardada.");
        await refrescarCatalogoLocalDueno();
        if (typeof filtrarInventarioDueno === "function") filtrarInventarioDueno();
        abrirDetalleProductoInventarioDueno(detalle.id);
    } catch (error) {
        mostrarToastDueno(error.message || "No se pudo subir la foto.");
    }
}

// ---------------- ajustar existencias ----------------

const MOTIVOS_AJUSTE_DUENO = [
    { valor: "Conteo fisico", tipoSugerido: "conteo" },
    { valor: "Merma o producto danado", tipoSugerido: "salida" },
    { valor: "Mercancia recibida", tipoSugerido: "entrada" },
    { valor: "Devolucion a proveedor", tipoSugerido: "salida" },
    { valor: "Correccion", tipoSugerido: "conteo" },
    { valor: "Otro", tipoSugerido: "salida" }
];

function abrirAjusteExistenciasDueno() {
    const detalle = duenoProductoDetalleActual;
    if (!detalle) return;

    cerrarDetalleProductoDueno();

    duenoProductoForm = { modo: "ajuste", producto: detalle, guardando: false };

    document.getElementById("duenoProductoFormContenido").innerHTML = `
        <h2>Ajustar existencias</h2>
        <p class="dueno-estado"><strong>${escaparDueno(detalle.nombre)}</strong><br>Hoy hay ${Number(detalle.stock || 0)}.</p>

        <label class="dueno-campo">Que paso
            <select id="duenoAjusteMotivo" onchange="sugerirTipoAjusteDueno()">
                ${MOTIVOS_AJUSTE_DUENO.map(m => `<option value="${escaparDueno(m.valor)}">${escaparDueno(m.valor)}</option>`).join("")}
            </select>
        </label>

        <label class="dueno-campo">Tipo de ajuste
            <select id="duenoAjusteTipo" onchange="actualizarVistaAjusteDueno()">
                <option value="conteo">Conte y hay exactamente... (conteo)</option>
                <option value="entrada">Entraron (sumar)</option>
                <option value="salida">Salieron o se perdieron (restar)</option>
            </select>
        </label>

        <label class="dueno-campo">Cantidad
            <input type="number" id="duenoAjusteCantidad" inputmode="decimal" min="0" step="any" oninput="actualizarVistaAjusteDueno()" placeholder="0">
        </label>

        <label class="dueno-campo">Nota (opcional)
            <input type="text" id="duenoAjusteNota" maxlength="120" autocomplete="off" placeholder="Ej. Se cayo de la repisa">
        </label>

        <p id="duenoAjusteVista" class="dueno-estado" style="font-weight:700;"></p>
        <p id="duenoProdError" class="dueno-login-error" style="display:none;"></p>
        <button type="button" class="dueno-boton-primario" id="btnConfirmarAjuste" onclick="confirmarAjusteExistenciasDueno()">Confirmar ajuste</button>
    `;

    sugerirTipoAjusteDueno();
    document.getElementById("duenoProductoFormOverlay").style.display = "flex";
}

function sugerirTipoAjusteDueno() {
    const motivo = document.getElementById("duenoAjusteMotivo")?.value;
    const sugerido = MOTIVOS_AJUSTE_DUENO.find(m => m.valor === motivo)?.tipoSugerido || "conteo";
    const selector = document.getElementById("duenoAjusteTipo");
    if (selector) selector.value = sugerido;
    actualizarVistaAjusteDueno();
}

function stockResultanteAjusteDueno() {
    const actual = Number(duenoProductoForm?.producto?.stock || 0);
    const cantidad = Number(document.getElementById("duenoAjusteCantidad")?.value);
    const tipo = document.getElementById("duenoAjusteTipo")?.value;

    if (!Number.isFinite(cantidad) || cantidad < 0 || document.getElementById("duenoAjusteCantidad")?.value === "") return null;

    return tipo === "entrada" ? actual + cantidad : tipo === "salida" ? actual - cantidad : cantidad;
}

function actualizarVistaAjusteDueno() {
    const vista = document.getElementById("duenoAjusteVista");
    if (!vista) return;

    const resultado = stockResultanteAjusteDueno();

    if (resultado === null) {
        vista.textContent = "";
    } else if (resultado < 0) {
        vista.textContent = `Dejaria ${resultado} en stock: no se puede.`;
    } else {
        vista.textContent = `Va a quedar en ${resultado}.`;
    }
}

async function confirmarAjusteExistenciasDueno() {
    const estado = duenoProductoForm;
    if (!estado || estado.modo !== "ajuste" || estado.guardando) return;

    const cantidad = Number(document.getElementById("duenoAjusteCantidad").value);
    const resultado = stockResultanteAjusteDueno();

    if (resultado === null || !(cantidad >= 0)) {
        mostrarErrorProductoDueno("Escribe la cantidad.");
        return;
    }

    if (resultado < 0) {
        mostrarErrorProductoDueno("El ajuste dejaria el stock en negativo.");
        return;
    }

    const motivo = document.getElementById("duenoAjusteMotivo").value;
    const nota = document.getElementById("duenoAjusteNota").value.trim();

    estado.guardando = true;
    const boton = document.getElementById("btnConfirmarAjuste");
    if (boton) boton.disabled = true;

    try {
        mostrarErrorProductoDueno("");

        await fetchAutenticado("/ajustes-inventario", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                productoId: Number(estado.producto.id),
                tipo: document.getElementById("duenoAjusteTipo").value,
                cantidad,
                motivo: nota ? `${motivo}: ${nota}` : motivo,
                usuarioNombre: duenoEmpleadoNombrePersona || ""
            })
        });

        const productoId = estado.producto.id;
        cerrarFormularioProductoDueno();
        mostrarToastDueno(`Listo, ahora hay ${resultado}.`);

        await refrescarCatalogoLocalDueno();
        if (typeof filtrarInventarioDueno === "function") filtrarInventarioDueno();
        abrirDetalleProductoInventarioDueno(productoId);
    } catch (error) {
        mostrarErrorProductoDueno(error.message || "No se pudo guardar el ajuste.");
        estado.guardando = false;
        if (boton) boton.disabled = false;
    }
}

// ---------------- recibir mercancia escaneando ----------------
// Un solo paso: escanea, ajusta cantidad y costo, confirma. El servidor suma
// el stock, guarda el costo, deja el ajuste y el historial en UNA transaccion,
// y la llave de idempotencia evita sumar dos veces si se reintenta con mala
// señal.

let duenoRecepcion = null;

function nuevaRecepcionDueno() {
    return {
        lineas: [],
        proveedor: "",
        referencia: "",
        idempotencyKey: (typeof crypto !== "undefined" && crypto.randomUUID) ? crypto.randomUUID() : `rec-${Date.now()}-${Math.random().toString(16).slice(2)}`,
        enviando: false
    };
}

function abrirRecepcionDueno() {
    if (!duenoRecepcion) duenoRecepcion = nuevaRecepcionDueno();

    renderRecepcionDueno();
    document.getElementById("duenoRecepcionOverlay").classList.add("abierta");
}

function cerrarRecepcionDueno() {
    // Se conserva lo capturado: cerrar por accidente a media recepcion no
    // debe perder 20 lineas escaneadas.
    document.getElementById("duenoRecepcionOverlay").classList.remove("abierta");
}

function guardarCamposRecepcionDueno() {
    if (!duenoRecepcion) return;

    const proveedor = document.getElementById("duenoRecProveedor");
    const referencia = document.getElementById("duenoRecReferencia");
    if (proveedor) duenoRecepcion.proveedor = proveedor.value;
    if (referencia) duenoRecepcion.referencia = referencia.value;

    document.querySelectorAll("[data-rec-cantidad]").forEach(input => {
        const linea = duenoRecepcion.lineas.find(l => l.id === Number(input.dataset.recCantidad));
        if (linea) linea.cantidad = numeroODefecto(input.value, linea.cantidad);
    });

    document.querySelectorAll("[data-rec-costo]").forEach(input => {
        const linea = duenoRecepcion.lineas.find(l => l.id === Number(input.dataset.recCosto));
        if (linea) linea.costo = input.value === "" ? "" : numeroODefecto(input.value, "");
    });
}

function renderRecepcionDueno() {
    const estado = duenoRecepcion;
    if (!estado) return;

    const totalPiezas = estado.lineas.reduce((suma, l) => suma + numeroODefecto(l.cantidad), 0);
    const totalCosto = estado.lineas.reduce((suma, l) => suma + numeroODefecto(l.cantidad) * numeroODefecto(l.costo), 0);
    const veCosto = duenoRolSesion !== "employee";

    document.getElementById("duenoRecepcionContenido").innerHTML = `
        <article class="dueno-card">
            <button type="button" class="dueno-boton-primario" onclick="escanearParaRecepcionDueno()">Escanear mercancia</button>
            <label class="dueno-campo" style="margin-top:12px;">O busca por nombre o codigo
                <input type="search" id="duenoRecBuscar" placeholder="Ej. martillo" autocomplete="off" oninput="buscarParaRecepcionDueno()">
            </label>
            <div id="duenoRecResultados" class="lista-compacta"></div>
        </article>

        <article class="dueno-card">
            <label class="dueno-campo">Proveedor (opcional)
                <input type="text" id="duenoRecProveedor" value="${escaparDueno(estado.proveedor)}" autocomplete="off" placeholder="Ej. Diprofer" onchange="guardarCamposRecepcionDueno()">
            </label>
            <label class="dueno-campo">Factura o remision (opcional)
                <input type="text" id="duenoRecReferencia" value="${escaparDueno(estado.referencia)}" autocomplete="off" placeholder="Ej. A-1234" onchange="guardarCamposRecepcionDueno()">
            </label>
        </article>

        <article class="dueno-card dueno-card-wide">
            <div class="card-head"><div><span>Llego</span><h2>${estado.lineas.length} producto${estado.lineas.length === 1 ? "" : "s"} · ${totalPiezas} pieza${totalPiezas === 1 ? "" : "s"}</h2></div></div>
            <div class="lista-compacta">
                ${estado.lineas.length ? estado.lineas.map(linea => `
                    <div class="dueno-rec-linea">
                        <div class="dueno-rec-nombre">
                            <strong>${escaparDueno(linea.nombre)}</strong>
                            <span>${escaparDueno(linea.codigo || "Sin codigo")} · hay ${Number(linea.stockActual || 0)}</span>
                        </div>
                        <div class="dueno-rec-campos">
                            <label>Cantidad
                                <input type="number" data-rec-cantidad="${Number(linea.id)}" inputmode="decimal" min="0" step="any" value="${escaparDueno(String(linea.cantidad))}" onchange="guardarCamposRecepcionDueno(); renderRecepcionDueno()">
                            </label>
                            ${veCosto ? `
                                <label>Costo c/u
                                    <input type="number" data-rec-costo="${Number(linea.id)}" inputmode="decimal" min="0" step="0.01" value="${escaparDueno(String(linea.costo ?? ""))}" placeholder="opc." onchange="guardarCamposRecepcionDueno(); renderRecepcionDueno()">
                                </label>
                            ` : ""}
                            <button type="button" class="dueno-link dueno-link-peligro" onclick="quitarLineaRecepcionDueno(${Number(linea.id)})">Quitar</button>
                        </div>
                    </div>
                `).join("") : `<div class="vacio">Escanea o busca lo que llego.</div>`}
            </div>
            ${veCosto && totalCosto > 0 ? `<p class="dueno-estado" style="margin-top:8px;">Costo total: <strong>${dinero(totalCosto)}</strong></p>` : ""}
        </article>

        <p id="duenoRecError" class="dueno-login-error" style="display:none;"></p>
        <button type="button" class="dueno-boton-primario" id="btnConfirmarRecepcion" ${estado.lineas.length ? "" : "disabled"} onclick="confirmarRecepcionDueno()">Confirmar recepcion</button>
        ${estado.lineas.length ? `<button type="button" class="dueno-link dueno-link-peligro" style="display:block;margin:10px auto;" onclick="vaciarRecepcionDueno()">Empezar de nuevo</button>` : ""}
    `;
}

function agregarLineaRecepcionDueno(producto, cantidad = 1) {
    guardarCamposRecepcionDueno();

    const existente = duenoRecepcion.lineas.find(l => l.id === Number(producto.id));

    if (existente) {
        existente.cantidad = numeroODefecto(existente.cantidad) + cantidad;
    } else {
        duenoRecepcion.lineas.unshift({
            id: Number(producto.id),
            nombre: producto.nombre,
            codigo: producto.codigo || "",
            stockActual: numeroODefecto(producto.stock),
            cantidad,
            costo: ""
        });
    }

    renderRecepcionDueno();
}

function quitarLineaRecepcionDueno(id) {
    guardarCamposRecepcionDueno();
    duenoRecepcion.lineas = duenoRecepcion.lineas.filter(l => l.id !== Number(id));
    renderRecepcionDueno();
}

function vaciarRecepcionDueno() {
    if (!confirm("¿Borrar todo lo capturado en esta recepcion?")) return;
    duenoRecepcion = nuevaRecepcionDueno();
    renderRecepcionDueno();
}

function escanearParaRecepcionDueno() {
    guardarCamposRecepcionDueno();

    abrirEscanerCodigoDueno({
        titulo: "Recibir mercancia",
        continuo: true,
        alCodigo: async codigo => {
            const estado = document.getElementById("duenoEscanerCodigoEstado");
            const producto = await buscarProductoPorCodigoDueno(codigo);

            if (producto) {
                agregarLineaRecepcionDueno(producto, 1);
                if (estado) estado.textContent = `+1 ${producto.nombre}. Sigue escaneando o toca Atras para terminar.`;
                return;
            }

            if (estado) estado.textContent = `"${codigo}" no existe en tu inventario.`;

            if (duenoTienePermiso("modificar_inventario") && confirm(`El codigo ${codigo} no existe en tu inventario. ¿Crear el producto ahora?`)) {
                cerrarEscanerCodigoDueno();
                abrirFormularioProductoDueno(null, {
                    codigo,
                    alGuardar: nuevo => agregarLineaRecepcionDueno({ ...nuevo, stock: 0 }, 1)
                });
            }
        }
    });
}

async function buscarParaRecepcionDueno() {
    const texto = document.getElementById("duenoRecBuscar")?.value || "";
    const contenedor = document.getElementById("duenoRecResultados");
    if (!contenedor) return;

    if (texto.trim().length < 2) {
        contenedor.innerHTML = "";
        return;
    }

    const resultados = (await buscarEnCatalogoLocal(texto)).slice(0, 6);
    duenoRecepcionResultados = resultados;

    contenedor.innerHTML = resultados.length
        ? resultados.map(producto => `
            <div class="fila-dueno" onclick="elegirProductoRecepcionDueno(${Number(producto.id)})">
                <div>
                    <strong>${escaparDueno(producto.nombre)}</strong>
                    <span>${escaparDueno(producto.codigo || "Sin codigo")} · hay ${Number(producto.stock || 0)}</span>
                </div>
                <span class="dueno-boton-agregar">+</span>
            </div>
        `).join("")
        : `<p class="dueno-estado">Sin resultados.</p>`;
}

let duenoRecepcionResultados = [];

function elegirProductoRecepcionDueno(id) {
    const producto = duenoRecepcionResultados.find(p => Number(p.id) === Number(id));
    if (!producto) return;

    agregarLineaRecepcionDueno(producto, 1);
}

async function confirmarRecepcionDueno() {
    const estado = duenoRecepcion;
    if (!estado || estado.enviando || !estado.lineas.length) return;

    guardarCamposRecepcionDueno();

    const invalida = estado.lineas.find(l => !(numeroODefecto(l.cantidad) > 0));
    const error = document.getElementById("duenoRecError");

    if (invalida) {
        error.textContent = `Revisa la cantidad de "${invalida.nombre}": debe ser mayor a 0.`;
        error.style.display = "block";
        return;
    }

    error.style.display = "none";
    estado.enviando = true;
    const boton = document.getElementById("btnConfirmarRecepcion");
    if (boton) { boton.disabled = true; boton.textContent = "Guardando..."; }

    try {
        const respuesta = await fetchAutenticado("/recepciones-mercancia/rapida", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                proveedor: estado.proveedor,
                referencia: estado.referencia,
                usuarioNombre: duenoEmpleadoNombrePersona || "",
                idempotencyKey: estado.idempotencyKey,
                items: estado.lineas.map(l => ({
                    productoId: l.id,
                    cantidad: numeroODefecto(l.cantidad),
                    costo: l.costo === "" ? 0 : numeroODefecto(l.costo)
                }))
            })
        });

        const cantidadProductos = estado.lineas.length;
        duenoRecepcion = null;
        cerrarRecepcionDueno();
        mostrarToastDueno(respuesta.repetida ? "Esa recepcion ya estaba guardada." : `Recepcion guardada: ${cantidadProductos} producto${cantidadProductos === 1 ? "" : "s"} sumado${cantidadProductos === 1 ? "" : "s"} al inventario.`);

        await refrescarCatalogoLocalDueno();
        if (typeof filtrarInventarioDueno === "function") filtrarInventarioDueno();
    } catch (err) {
        // La misma llave se conserva: si la peticion SI llego al servidor pero
        // la respuesta se perdio, reintentar no suma el stock otra vez.
        estado.enviando = false;
        error.textContent = err.message || "No se pudo guardar. Revisa tu internet y vuelve a intentar.";
        error.style.display = "block";
        if (boton) { boton.disabled = false; boton.textContent = "Confirmar recepcion"; }
    }
}
