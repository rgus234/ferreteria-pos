/* Placeholders que no caben en la casilla.

   Muchos campos del sistema ponen una pista larga adentro ("piezas cerradas (0 si solo tienes sueltas)")
   y en una casilla angosta se corta a media palabra. En vez de revisar campo por campo, esto lo
   resuelve en todo el sistema:
     1. si la pista no cabe, le baja el tamano de letra hasta que quepa (minimo 11 px);
     2. si aun asi no cabe, la termina con "..." y deja la pista completa como globito (title)
        para verla con el cursor encima.
   Funciona con campos que aparecen despues y con pistas que cambian por codigo. */

(function () {
    const TAMANO_MINIMO = 11;
    const TIPOS_SIN_PISTA = new Set(["checkbox", "radio", "file", "hidden", "range", "color"]);
    const lienzo = document.createElement("canvas").getContext("2d");
    let pendiente = false;
    const porRevisar = new Set();

    function anchoUtil(campo) {
        const estilo = getComputedStyle(campo);
        const relleno = (parseFloat(estilo.paddingLeft) || 0) + (parseFloat(estilo.paddingRight) || 0);
        // Los campos numericos reservan sitio para las flechitas.
        const flechas = campo.type === "number" ? 22 : 0;
        return campo.clientWidth - relleno - flechas - 2;
    }

    function ajustar(campo) {
        const texto = campo.getAttribute("placeholder");
        if (!texto || campo.disabled === undefined || TIPOS_SIN_PISTA.has(campo.type)) return;

        const disponible = anchoUtil(campo);
        if (disponible <= 0) return; // oculto: se revisa cuando aparezca (ResizeObserver)

        const estilo = getComputedStyle(campo);
        const base = parseFloat(estilo.fontSize) || 14;
        const medir = tamano => {
            lienzo.font = `${estilo.fontStyle} ${estilo.fontWeight} ${tamano}px ${estilo.fontFamily}`;
            return lienzo.measureText(texto).width;
        };

        let tamano = base;
        while (medir(tamano) > disponible && tamano > TAMANO_MINIMO) tamano -= 0.5;

        if (tamano < base) campo.style.setProperty("--placeholder-tamano", `${tamano}px`);
        else campo.style.removeProperty("--placeholder-tamano");

        const cabe = medir(tamano) <= disponible;
        campo.classList.toggle("placeholder-largo", !cabe);

        // La pista completa siempre queda a la mano con el cursor encima.
        // Solo se toca el globito que puso este mismo ayudante: uno puesto a proposito por el codigo se respeta.
        const puestoAqui = campo.dataset.placeholderTitulo !== undefined && campo.title === campo.dataset.placeholderTitulo;

        if (tamano < base || !cabe) {
            if (!campo.title || puestoAqui) {
                campo.title = texto;
                campo.dataset.placeholderTitulo = texto;
            }
        } else if (puestoAqui) {
            campo.removeAttribute("title");
            delete campo.dataset.placeholderTitulo;
        }
    }

    function programar(campo) {
        porRevisar.add(campo);
        if (pendiente) return;
        pendiente = true;

        requestAnimationFrame(() => {
            pendiente = false;
            porRevisar.forEach(ajustar);
            porRevisar.clear();
        });
    }

    const tamanos = typeof ResizeObserver === "function" ? new ResizeObserver(entradas => entradas.forEach(e => programar(e.target))) : null;

    function vigilar(campo) {
        if (campo.dataset.placeholderVigilado) return;
        campo.dataset.placeholderVigilado = "1";
        if (tamanos) tamanos.observe(campo);
        programar(campo);
    }

    function revisarArbol(raiz) {
        if (raiz.nodeType !== 1) return;
        if (raiz.matches?.("input[placeholder], textarea[placeholder]")) vigilar(raiz);
        raiz.querySelectorAll?.("input[placeholder], textarea[placeholder]").forEach(vigilar);
    }

    function iniciar() {
        const estilo = document.createElement("style");
        estilo.textContent = `
            input::placeholder, textarea::placeholder { font-size: var(--placeholder-tamano, inherit); }
            input.placeholder-largo, textarea.placeholder-largo { text-overflow: ellipsis; }
            input.placeholder-largo::placeholder { text-overflow: ellipsis; }`;
        document.head.appendChild(estilo);

        revisarArbol(document.body);

        new MutationObserver(cambios => {
            for (const cambio of cambios) {
                if (cambio.type === "attributes") programar(cambio.target);
                else cambio.addedNodes.forEach(revisarArbol);
            }
        }).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["placeholder"] });
    }

    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", iniciar);
    else iniciar();
})();
