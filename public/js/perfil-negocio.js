/* Perfil del negocio (tipo de negocio ESTRICTO).

   negocios.giro es el tipo principal y define como se ve y se comporta Nexo.
   Hoy hay dos comportamientos:
     - abarrotes: menu corto, formulario de producto de ~9 campos y la ganancia
       real de cada producto a la vista;
     - todos los demas (ferreteria, papeleria, vinateria, general y los negocios
       que ya existian): el programa completo, igual que siempre.

   Nada se borra: lo que un perfil no usa solo se oculta, y "Mas herramientas"
   (menu) y "Mostrar todos los campos" (formulario) lo vuelven a mostrar.

   El tipo solo se define en el asistente de inicio; despues lo cambia Nexo desde
   su panel de administrador (ver PUT /negocio-actual/perfil). */

const PERFILES_NEGOCIO = {
    abarrotes: {
        nombre: "Abarrotes",
        icono: "🛒",
        detalle: "Tienda de la esquina o minisúper",
        simple: true,
        // Modulos del menu (data-shell-module) que un abarrotes no usa.
        ocultar: [
            "explorar-nexo", "catalogo", "recepcion-inteligente", "exhibidores", "listas-producto",
            "fotos-sugeridas", "codigos-barras", "encargos", "sitio-web", "pedidos-market", "facturacion"
        ]
    },
    ferreteria: { nombre: "Ferretería", icono: "🔧", detalle: "Herramientas y materiales", simple: false, ocultar: [] },
    papeleria: { nombre: "Papelería", icono: "✏️", detalle: "Útiles, copias y regalos", simple: false, ocultar: [] },
    vinateria: { nombre: "Vinatería", icono: "🍷", detalle: "Vinos, licores y cerveza", simple: false, ocultar: [] },
    general: { nombre: "Otro negocio", icono: "🧰", detalle: "Otro tipo de comercio", simple: false, ocultar: [] }
};

const PERFIL_VER_TODO_KEY = "nexoPerfilVerTodo";
const PERFIL_CAMPOS_TODOS_KEY = "nexoPerfilCamposTodos";

function perfilNegocioActual() {
    let configuracion = null;

    try {
        configuracion = typeof configuracionNegocio === "function" ? configuracionNegocio() : null;
    } catch (error) {
        configuracion = null;
    }

    const perfil = String(configuracion?.perfilNegocio || "").trim().toLowerCase();
    return PERFILES_NEGOCIO[perfil] ? perfil : null;
}

function perfilEsSimple() {
    const perfil = perfilNegocioActual();
    return Boolean(perfil && PERFILES_NEGOCIO[perfil].simple);
}

function perfilLeer(clave) {
    try { return localStorage.getItem(clave) === "1"; } catch (error) { return false; }
}

function perfilGuardar(clave, valor) {
    try { localStorage.setItem(clave, valor ? "1" : "0"); } catch (error) { /* sin almacenamiento */ }
}

// ---------------------------------------------------------------------
// Menu
// ---------------------------------------------------------------------

function perfilAplicarMenu() {
    const perfil = perfilNegocioActual();
    const definicion = perfil ? PERFILES_NEGOCIO[perfil] : null;

    document.querySelectorAll("[data-perfil-oculto]").forEach(elemento => elemento.removeAttribute("data-perfil-oculto"));

    if (!definicion || !definicion.simple) {
        document.getElementById("perfilMasHerramientas")?.remove();
        return;
    }

    definicion.ocultar.forEach(modulo => {
        document.querySelectorAll(`.sidebar [data-shell-module="${modulo}"]`).forEach(boton => boton.setAttribute("data-perfil-oculto", "1"));
    });

    let boton = document.getElementById("perfilMasHerramientas");

    if (!boton) {
        const lateral = document.querySelector("aside.sidebar, .sidebar");
        const referencia = document.querySelector('.sidebar [data-shell-module="cuenta"]');

        if (!lateral) return;

        boton = document.createElement("button");
        boton.id = "perfilMasHerramientas";
        boton.type = "button";
        boton.className = "perfil-mas-herramientas";
        boton.addEventListener("click", () => {
            perfilGuardar(PERFIL_VER_TODO_KEY, !perfilLeer(PERFIL_VER_TODO_KEY));
            perfilAplicar();
        });

        if (referencia && referencia.parentNode === lateral) lateral.insertBefore(boton, referencia);
        else lateral.appendChild(boton);
    }

    boton.textContent = perfilLeer(PERFIL_VER_TODO_KEY) ? "Menos herramientas" : "Más herramientas";
}

// ---------------------------------------------------------------------
// Formulario de producto: ganancia real y campos de abarrotes
// ---------------------------------------------------------------------

function perfilNumero(id) {
    const valor = Number(document.getElementById(id)?.value);
    return Number.isFinite(valor) ? valor : null;
}

function perfilActualizarGanancia() {
    const caja = document.getElementById("perfilGananciaProducto");
    if (!caja) return;

    const costo = perfilNumero("precioDistribuidor");
    const publico = perfilNumero("precioPublico") ?? perfilNumero("nuevoPrecio");

    caja.className = "perfil-ganancia";

    if (!costo || !publico) {
        caja.textContent = "Escribe lo que te cuesta y lo que cobras: aquí verás cuánto ganas por pieza.";
        return;
    }

    const ganancia = publico - costo;
    const porcentaje = Math.round((ganancia / costo) * 100);
    const dinero = valor => "$" + Math.abs(valor).toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

    if (ganancia < 0) {
        caja.classList.add("perfil-ganancia-negativa");
        caja.textContent = `⚠️ Estás perdiendo ${dinero(ganancia)} por pieza: cobras menos de lo que te cuesta.`;
    } else if (ganancia === 0) {
        caja.classList.add("perfil-ganancia-cero");
        caja.textContent = "Cobras lo mismo que te cuesta: no estás ganando nada.";
    } else {
        caja.classList.add("perfil-ganancia-ok");
        caja.textContent = `✅ Ganas ${dinero(ganancia)} por pieza (${porcentaje}% sobre lo que te cuesta).`;
    }
}

// Campos que un abarrotes no necesita (se ocultan; "Mostrar todos los campos" los vuelve a mostrar).
const PERFIL_CAMPOS_AVANZADOS = [
    "nuevoCodigoInterno", "codigosRelacionados", "nuevaDescripcion", "precioMayoreo", "nuevoPrecio", "nuevoStockMaximo",
    "basculaDigital", "altaRotacion", "nuevaUbicacion", "precioPiezaPublico", "precioPiezaMayoreo", "precioPiezaDistribuidor"
];

function perfilMarcarCamposAvanzados() {
    if (typeof asegurarEtiquetasFichaProducto === "function") {
        try { asegurarEtiquetasFichaProducto(); } catch (error) { /* el formulario aun no esta */ }
    }

    PERFIL_CAMPOS_AVANZADOS.forEach(id => {
        const campo = document.getElementById(id);
        if (!campo) return;

        // El precio del carrito va dentro de su propio bloque (con ayuda y sugerencia).
        const bloque = campo.closest(".campo-ficha-precio-carrito, .campo-ficha-ubicacion") || campo.closest(".campo-ficha") || campo;
        bloque.classList.add("perfil-campo-avanzado");
    });
}

function perfilAplicarFormulario() {
    const costo = document.getElementById("precioDistribuidor");
    const publico = document.getElementById("precioPublico");
    if (!costo || !publico) return;

    perfilMarcarCamposAvanzados();

    if (!perfilEsSimple()) {
        document.getElementById("perfilGananciaProducto")?.remove();
        document.getElementById("perfilCamposTodos")?.remove();
        if (costo.dataset.placeholderOriginal) costo.placeholder = costo.dataset.placeholderOriginal;
        if (publico.dataset.placeholderOriginal) publico.placeholder = publico.dataset.placeholderOriginal;
        return;
    }

    if (!costo.dataset.placeholderOriginal) costo.dataset.placeholderOriginal = costo.placeholder;
    if (!publico.dataset.placeholderOriginal) publico.dataset.placeholderOriginal = publico.placeholder;

    costo.placeholder = "Precio distribuidor (lo que te cuesta)";
    publico.placeholder = "Precio al público (lo que cobras)";

    if (!document.getElementById("perfilGananciaProducto")) {
        const caja = document.createElement("p");
        caja.id = "perfilGananciaProducto";
        caja.className = "perfil-ganancia";
        (publico.closest(".campo-ficha") || publico).insertAdjacentElement("afterend", caja);

        ["precioDistribuidor", "precioPublico", "nuevoPrecio"].forEach(id => {
            document.getElementById(id)?.addEventListener("input", perfilActualizarGanancia);
        });
    }

    if (!document.getElementById("perfilCamposTodos")) {
        const formulario = document.querySelector('.producto-form-seccion[data-seccion="identidad"]');

        if (formulario) {
            const boton = document.createElement("button");
            boton.id = "perfilCamposTodos";
            boton.type = "button";
            boton.className = "perfil-campos-todos";
            boton.addEventListener("click", () => {
                perfilGuardar(PERFIL_CAMPOS_TODOS_KEY, !perfilLeer(PERFIL_CAMPOS_TODOS_KEY));
                perfilAplicar();
            });
            formulario.insertAdjacentElement("beforebegin", boton);
        }
    }

    const boton = document.getElementById("perfilCamposTodos");
    if (boton) boton.textContent = perfilLeer(PERFIL_CAMPOS_TODOS_KEY) ? "Mostrar solo lo importante" : "Mostrar todos los campos";

    perfilActualizarGanancia();
}

// ---------------------------------------------------------------------
// Aplicar todo
// ---------------------------------------------------------------------

function perfilAplicar() {
    const perfil = perfilNegocioActual();

    Array.from(document.body.classList).forEach(clase => { if (clase.startsWith("perfil-")) document.body.classList.remove(clase); });

    if (perfil) document.body.classList.add(`perfil-${perfil}`);
    document.body.classList.toggle("perfil-simple", perfilEsSimple());
    document.body.classList.toggle("perfil-ver-todo", perfilEsSimple() && perfilLeer(PERFIL_VER_TODO_KEY));
    document.body.classList.toggle("perfil-campos-todos", perfilEsSimple() && perfilLeer(PERFIL_CAMPOS_TODOS_KEY));

    perfilAplicarMenu();
    perfilAplicarFormulario();
}

if (typeof window !== "undefined") {
    window.perfilNegocio = { aplicar: perfilAplicar, actual: perfilNegocioActual, esSimple: perfilEsSimple, PERFILES: PERFILES_NEGOCIO };
}

if (typeof document !== "undefined") {
    document.addEventListener("DOMContentLoaded", perfilAplicar);
    if (document.readyState !== "loading") perfilAplicar();
}

if (typeof module !== "undefined" && module.exports) {
    module.exports = { PERFILES_NEGOCIO };
}
