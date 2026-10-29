// Pendientes en el Inicio de la computadora: stock critico, fiado/creditos y facturas por recibir como tarjetas que llevan DIRECTO a resolverlos
// (lo mismo que ya hay en el celular). En un negocio solo de abarrotes, "Credito" se llama "Fiado" en el menu, el Inicio y la pantalla de creditos.
// Funcion nueva: solo aparece si el dueño la enciende en Nexo -> Funciones nuevas (funcionBeta("inicio_pendientes")).
(function () {
    const REFRESCO_MS = 60000;
    let datos = { bajos: null, credito: null, facturas: null };
    let temporizador = null;
    let reintentos = 0;

    const esc = valor => String(valor ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
    const dinero = valor => "$" + Number(valor || 0).toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const activa = () => typeof window.funcionBeta === "function" && window.funcionBeta("inicio_pendientes");
    const esAbarrotes = () => typeof perfilEsSimple === "function" && perfilEsSimple();
    const pantalla = () => document.getElementById("pantallaInicio");
    const visible = () => { const p = pantalla(); return Boolean(p) && getComputedStyle(p).display !== "none"; };

    // ---------- "Fiado" en vez de "Credito" (solo abarrotes) ----------

    const CONTENEDORES = [".sidebar", "#pantallaInicio", "#pantallaCreditos"];
    const CAMBIOS = [[/Cr[eé]ditos pendientes/g, "Fiado pendiente"], [/Cr[eé]dito pendiente/g, "Fiado pendiente"], [/Cr[eé]ditos/g, "Fiado"], [/\bcr[eé]ditos\b/g, "fiado"], [/\bCr[eé]dito\b/g, "Fiado"], [/\bcr[eé]dito\b/g, "fiado"]];

    function aplicarFiado() {
        if (!activa() || !esAbarrotes()) return;

        CONTENEDORES.forEach(selector => document.querySelectorAll(selector).forEach(raiz => {
            const recorrido = document.createTreeWalker(raiz, NodeFilter.SHOW_TEXT);
            let nodo;

            while ((nodo = recorrido.nextNode())) {
                if (nodo.parentElement && nodo.parentElement.closest("script, style, textarea, input")) continue;
                let texto = nodo.nodeValue;
                CAMBIOS.forEach(([patron, nuevo]) => { texto = texto.replace(patron, nuevo); });
                if (texto !== nodo.nodeValue) nodo.nodeValue = texto;
            }
        }));
    }

    // ---------- datos ----------

    async function cargar() {
        if (!activa()) return;

        // Stock critico: lo mismo que cuenta "Inventario bajo" (existencia de 5 o menos).
        const productos = typeof todosProductos !== "undefined" && Array.isArray(todosProductos) ? todosProductos : [];

        if (productos.length) {
            datos.bajos = productos.filter(p => Number(p.stock) <= 5).sort((a, b) => Number(a.stock) - Number(b.stock));
        } else if (reintentos++ < 6) {
            setTimeout(cargar, 1500);
        }

        try {
            const r = await fetch("/creditos");
            const d = await r.json();
            if (r.ok) datos.credito = (d.clientes || []).filter(c => Number(c.saldo || 0) > 0).sort((a, b) => Number(b.saldo) - Number(a.saldo));
        } catch (error) { /* se queda sin el dato */ }

        try {
            const r = await fetch("/recepcion-inteligente/facturas");
            const d = await r.json();
            datos.facturas = r.ok && d.ok ? (d.facturas || []).filter(f => f.estado === "pendiente") : null;
        } catch (error) { datos.facturas = null; }

        pintar();
    }

    // ---------- pintado ----------

    function nombres(lista, campo) {
        if (!lista.length) return "";
        const dos = lista.slice(0, 2).map(x => x[campo]).filter(Boolean).join(" · ");
        return dos + (lista.length > 2 ? ` y ${lista.length - 2} más` : "");
    }

    function tarjeta(clase, icono, etiqueta, titulo, detalle, accion, ok) {
        return `<button type="button" class="ip-tarjeta ${clase}${ok ? " ok" : ""}" onclick="${accion}"><span class="ip-icono">${icono}</span><span class="ip-texto"><small>${esc(etiqueta)}</small><strong>${esc(titulo)}</strong><em>${esc(detalle)}</em></span><span class="ip-flecha" aria-hidden="true">›</span></button>`;
    }

    function pintar() {
        const p = pantalla();
        let caja = document.getElementById("inicioPendientes");

        if (!activa()) { if (caja) caja.remove(); return; }
        if (!p) return;

        if (!caja) {
            caja = document.createElement("section");
            caja.id = "inicioPendientes";
            caja.className = "ip-fila";
            const cabecera = p.querySelector(".dashboard-header");
            if (cabecera) cabecera.insertAdjacentElement("afterend", caja); else p.prepend(caja);
        }

        // Siempre justo debajo del titulo (el Inicio de abarrotes se inserta en el mismo lugar y no debe quedar encima).
        const encabezado = p.querySelector(".dashboard-header");
        if (encabezado && encabezado.nextElementSibling !== caja) encabezado.insertAdjacentElement("afterend", caja);

        const partes = [];

        if (datos.bajos) {
            const n = datos.bajos.length;
            partes.push(tarjeta("ip-stock", "⚠️", "Stock crítico", `${n} producto${n === 1 ? "" : "s"}`, n ? nombres(datos.bajos, "nombre") : "Todo en orden por ahora.", "mostrarInventarioBajo()", !n));
        }

        if (datos.credito) {
            const n = datos.credito.length;
            const total = datos.credito.reduce((s, c) => s + Number(c.saldo || 0), 0);
            partes.push(tarjeta("ip-credito", "💳", `${esAbarrotes() ? "Fiado pendiente" : "Créditos pendientes"} · ${n} cliente${n === 1 ? "" : "s"}`, dinero(total), n ? nombres(datos.credito, "nombre") : `No hay ${esAbarrotes() ? "fiado" : "créditos"} pendiente${esAbarrotes() ? "" : "s"}.`, "abrirCreditos()", !n));
        }

        if (datos.facturas && datos.facturas.length) {
            const n = datos.facturas.length;
            const destino = window.funcionBeta("recibir_por_marca") ? "mostrarRecibirMarca()" : "mostrarRecepcionInteligente()";
            partes.push(tarjeta("ip-factura", "🧾", "Facturas por recibir", `${n} factura${n === 1 ? "" : "s"}`, nombres(datos.facturas, "proveedor"), destino, false));
        }

        caja.innerHTML = partes.join("");
        aplicarFiado();
    }

    function iniciar() {
        clearInterval(temporizador);
        pintar();
        if (!activa()) return;
        reintentos = 0;
        cargar();
        temporizador = setInterval(() => { if (visible()) cargar(); }, REFRESCO_MS);
    }

    // Se enciende o apaga desde Funciones nuevas, o cuando se vuelve a abrir el Inicio.
    document.addEventListener("nexo-funciones-beta", iniciar);

    const original = window.mostrarInicio;
    if (typeof original === "function") {
        window.mostrarInicio = function (...argumentos) {
            const resultado = original.apply(this, argumentos);
            if (activa()) cargar();
            return resultado;
        };
    }

    // Lo que se dibuja despues (lista de creditos, menu) tambien se corrige.
    let pendiente = null;
    new MutationObserver(() => { clearTimeout(pendiente); pendiente = setTimeout(aplicarFiado, 150); }).observe(document.body, { childList: true, subtree: true });
})();
