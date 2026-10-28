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

    let giro = { listo: false, abarrotesSolo: false, ferreteriaSolo: false };
    let cargando = false;
    let temporizador = null;

    window.duenoGiro = giro;

    function aplicar() {
        if (!giro.abarrotesSolo) return;

        Object.entries(PLACEHOLDERS_ABARROTES).forEach(([id, texto]) => {
            const campo = document.getElementById(id);
            if (campo && campo.placeholder !== texto) campo.placeholder = texto;
        });
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
