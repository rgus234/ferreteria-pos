/* Textos de ejemplo segun el giro del negocio (celular). Los "Ej. martillo", "Ej. Diprofer" y los ejemplos de "Dile a Nexo" eran de ferreteria
   en todos los negocios. Si el negocio es SOLO de abarrotes se cambian por ejemplos de tienda; si tiene ferreteria (o los dos giros) se
   dejan como estaban. Cambia solo los textos de ayuda (placeholder): nada de datos ni de logica. */

(function () {
    const PLACEHOLDERS_ABARROTES = {
        duenoRecBuscar: "Ej. galletas",
        duenoRecProveedor: "Ej. Sabritas",
        duenoGestionProveedor: "Ej. Coca-Cola",
        duenoGestionProducto: "Ej. Refresco de 3 litros",
        duenoArticuloRapidoNombre: "Ej. Pan del día",
        dmNombre: "Ej. Botanas y papas",
        duenoProdUbicacion: "Ej. Refrigerador"
    };

    let giro = { listo: false, abarrotesSolo: false, ferreteriaSolo: false, conAbarrotes: false };
    let cargando = false;
    let temporizador = null;

    window.duenoGiro = giro;

    // En una tienda de abarrotes el credito se llama "fiado". Solo se cambia el texto mostrado en Inicio, el menu Mas y la pantalla de Creditos.
    const CONTENEDORES_FIADO = ["#duenoApp .dalerta-credito", "#duenoCreditos", "#duenoMasCategorias", "#duenoMasStatusCard"];
    const CAMBIOS_FIADO = [[/Cr[eé]ditos pendientes/g, "Fiado pendiente"], [/Clientes de cr[eé]dito/g, "Clientes con fiado"], [/Cr[eé]ditos/g, "Fiado"], [/\bcr[eé]ditos\b/g, "fiado"], [/\bCr[eé]dito\b/g, "Fiado"], [/\bcr[eé]dito\b/g, "fiado"]];

    function aplicarFiado() {
        CONTENEDORES_FIADO.forEach(selector => document.querySelectorAll(selector).forEach(raiz => {
            const recorrido = document.createTreeWalker(raiz, NodeFilter.SHOW_TEXT);
            let nodo;

            while ((nodo = recorrido.nextNode())) {
                let texto = nodo.nodeValue;
                CAMBIOS_FIADO.forEach(([patron, nuevo]) => { texto = texto.replace(patron, nuevo); });
                if (texto !== nodo.nodeValue) nodo.nodeValue = texto;
            }
        }));
        document.querySelectorAll("#duenoCreditosBuscar").forEach(el => { if (el.placeholder) el.placeholder = el.placeholder.replace(/cr[eé]dito/i, "fiado"); });
    }

    function aplicar() {
        if (!giro.abarrotesSolo) return;


        Object.entries(PLACEHOLDERS_ABARROTES).forEach(([id, texto]) => {
            const campo = document.getElementById(id);
            if (campo && campo.placeholder !== texto) campo.placeholder = texto;
        });

        try { aplicarFiado(); } catch (error) { /* solo textos: nunca debe romper la pantalla */ }
    }

    async function cargar() {
        if (giro.listo || cargando || typeof fetchAutenticado !== "function" || typeof tokenGuardado !== "function" || !tokenGuardado()) return;

        cargando = true;

        try {
            const datos = await fetchAutenticado("/negocio-actual");
            const negocio = datos?.negocio || {};
            const giros = [negocio.giro, ...(negocio.girosActivos || [])].map(g => String(g || "").toLowerCase());
            const abarrotes = giros.some(g => g.includes("abarrote"));
            const ferreteria = giros.some(g => g.includes("ferret"));

            giro.abarrotesSolo = abarrotes && !ferreteria;
            giro.conAbarrotes = abarrotes;
            giro.ferreteriaSolo = ferreteria && !abarrotes;
            giro.listo = true;
            aplicar();
            document.dispatchEvent(new CustomEvent("nexo-giro-listo", { detail: giro }));
        } catch (error) { /* sin conexion: se queda con los ejemplos de siempre */ }

        cargando = false;
    }

    // Los formularios se dibujan cuando se abren: se revisan al cambiar el DOM (sin pasarse: una vez por tanda).
    new MutationObserver(() => {
        clearTimeout(temporizador);
        temporizador = setTimeout(() => { if (giro.listo) aplicar(); else cargar(); }, 80);
    }).observe(document.body, { childList: true, subtree: true });

    cargar();
})();
