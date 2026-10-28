/* Recibir mercancia POR MARCA en el celular (abarrotes). Los tickets de ruta (Sabritas, Coca-Cola, Bimbo, Gamesa...) vienen abreviados:
   en vez de leerlos, se abre la marca, se ven las tarjetas con foto y "Hay N", y en cada una se pone cuantas llegaron. Al confirmar se suma
   al inventario por el mismo camino de "Recibir mercancia" (POST /recepciones-mercancia/rapida, con llave de idempotencia).
   Las marcas se arman solas con los nombres de tus productos (palabras clave conocidas; si no, la primera palabra del nombre). */

(function () {
    const MARCAS = [
        ["Sabritas", "#e11d2e", ["sabritas", "doritos", "cheetos", "ruffles", "tostitos", "fritos", "rancheritos", "pake taxo", "paketaxo", "churrumais", "kacang", "crujitos"]],
        ["Coca-Cola", "#dc2626", ["coca", "fanta", "sprite", "ciel", "fresca", "powerade", "power ade", "del valle", "topo chico", "topo-chico", "fuze", "sidral", "mundet", "kermato"]],
        ["Pepsi", "#1d4ed8", ["pepsi", "7up", "7 up", "mirinda", "manzanita", "e-pura", "epura", "gatorade", "lipton", "squirt"]],
        ["Gamesa", "#c2410c", ["gamesa", "marias", "emperador", "saladitas", "chokis", "cremax", "mamut", "arcoiris", "crackets", "ricanelas", "maravillas", "fruts", "florentinas", "flor de naranjo", "chocolatines", "barras de coco", "multigrano", "paketon"]],
        ["Bimbo", "#1e40af", ["bimbo", "bimbollos", "medias noches", "rebanadas", "conchas", "nito", "oroweat", "mantecadas", "panque", "hotkis", "donitas", "little bites", "pan tostado", "empanizador", "mini pan", "crossantines", "mante-chox", "mante chox", "branfrut", "bran frut"]],
        ["Marinela", "#9333ea", ["marinela", "gansito", "pinguinos", "canelitas", "napolitano", "submarinos", "chocoroles", "choco roles", "barritas"]],
        ["Nestlé", "#0f766e", ["nescafe", "carnation", "lechera", "nesquik", "choco-milk", "chocomilk", "nestle"]],
        ["Barcel", "#b45309", ["barcel", "takis", "hot nuts", "chips fuego", "runners"]]
    ];

    const COLORES_RESPALDO = ["#0369a1", "#15803d", "#a21caf", "#b91c1c", "#4d7c0f", "#0e7490", "#7c2d12", "#4338ca"];
    const esc = valor => (typeof escaparDueno === "function" ? escaparDueno(valor) : String(valor ?? ""));
    const plano = t => String(t || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

    let estado = null; // { productos, grupos, marca, cantidades: Map(id -> n), enviando, llave }

    function marcaDe(nombre) {
        const n = plano(nombre);

        for (const [marca, color, palabras] of MARCAS) {
            if (palabras.some(p => n.includes(p))) return { marca, color };
        }

        // Marca desconocida: la primera palabra del nombre tal como se escribio (con acentos).
        const original = (String(nombre || "").trim().split(/\s+/)[0] || "otros").replace(/[^\p{L}\p{N}-]/gu, "") || "otros";
        const bonita = original.charAt(0).toUpperCase() + original.slice(1).toLowerCase();
        let suma = 0;
        for (const c of plano(original)) suma += c.charCodeAt(0);
        return { marca: bonita, color: COLORES_RESPALDO[suma % COLORES_RESPALDO.length] };
    }

    // Agrupa los productos por marca; las marcas conocidas primero y las demas (una palabra) al final bajo "Otros" si traen un solo producto.
    function agrupar(productos) {
        const mapa = new Map();

        productos.forEach(p => {
            const { marca, color } = marcaDe(p.nombre);
            if (!mapa.has(marca)) mapa.set(marca, { marca, color, productos: [] });
            mapa.get(marca).productos.push(p);
        });

        const conocidas = new Set(MARCAS.map(m => m[0]));
        const lista = [...mapa.values()];
        const sueltos = lista.filter(g => !conocidas.has(g.marca) && g.productos.length < 2);
        const grupos = lista.filter(g => !sueltos.includes(g));

        if (sueltos.length) grupos.push({ marca: "Otros", color: "#475569", productos: sueltos.flatMap(g => g.productos) });

        grupos.forEach(g => g.productos.sort((a, b) => String(a.nombre).localeCompare(String(b.nombre), "es")));
        return grupos.sort((a, b) => (conocidas.has(b.marca) - conocidas.has(a.marca)) || (b.productos.length - a.productos.length));
    }

    function totales() {
        let productos = 0, piezas = 0;
        estado.cantidades.forEach(n => { if (n > 0) { productos++; piezas += n; } });
        return { productos, piezas };
    }

    function capa() {
        let c = document.getElementById("drmCapa");
        if (!c) { c = document.createElement("div"); c.id = "drmCapa"; c.className = "drm-capa"; document.body.appendChild(c); }
        return c;
    }

    function pintar() {
        const c = capa();
        const grupo = estado.grupos.find(g => g.marca === estado.marca) || estado.grupos[0];
        const t = totales();

        c.innerHTML = `
            <div class="drm-tope">
            <header class="drm-cabeza">
                <button type="button" class="drm-atras" onclick="cerrarRecibirMarcaDueno()">‹ Atrás</button>
                <h2>Recibir por marca</h2>
            </header>
            <nav class="drm-marcas" aria-label="Marcas">${estado.grupos.map(g => {
                const llevo = g.productos.reduce((s, p) => s + (estado.cantidades.get(p.id) > 0 ? 1 : 0), 0);
                return `<button type="button" class="drm-marca${g === grupo ? " activa" : ""}" style="--marca:${g.color}" onclick="elegirMarcaRecibirDueno(${JSON.stringify(g.marca).replace(/"/g, "&quot;")})">
                    <b>${esc(g.marca)}</b><small>${g.productos.length} producto${g.productos.length === 1 ? "" : "s"}${llevo ? ` · ${llevo} con entrada` : ""}</small></button>`;
            }).join("")}</nav>
            </div>
            <div class="drm-grid">${grupo ? grupo.productos.map(p => {
                const n = estado.cantidades.get(p.id) || 0;
                const hay = Number(p.stock) || 0;
                const poco = hay <= Math.max(3, Number(p.stock_minimo) || 0);
                return `<article class="drm-tarjeta${n > 0 ? " con-entrada" : ""}" data-id="${Number(p.id)}">
                    <span class="drm-foto">${p.imagenUrl ? `<img src="${esc(p.imagenUrl)}" alt="" loading="lazy">` : (typeof miniaturaVaciaDuenoHtml === "function" ? miniaturaVaciaDuenoHtml() : "")}</span>
                    <b class="drm-nombre">${esc(p.nombre)}</b>
                    <span class="drm-hay${poco ? " poco" : ""}">Hay ${esc(String(hay))}</span>
                    <div class="drm-cantidad">
                        <button type="button" aria-label="Quitar uno" onclick="ajustarRecibirDueno(${Number(p.id)}, -1)">−</button>
                        <input type="text" inputmode="numeric" value="${n || ""}" placeholder="0" aria-label="Llegaron" oninput="escribirRecibirDueno(${Number(p.id)}, this.value)">
                        <button type="button" aria-label="Agregar uno" onclick="ajustarRecibirDueno(${Number(p.id)}, 1)">+</button>
                    </div>
                    <div class="drm-atajos">${[6, 12, 24].map(a => `<button type="button" onclick="ajustarRecibirDueno(${Number(p.id)}, ${a})">+${a}</button>`).join("")}</div>
                </article>`;
            }).join("") : ""}</div>
            <footer class="drm-pie">
                <div><strong>${t.productos}</strong> producto${t.productos === 1 ? "" : "s"} · <strong>${t.piezas}</strong> pieza${t.piezas === 1 ? "" : "s"}</div>
                <button type="button" class="drm-confirmar" id="drmConfirmar" onclick="confirmarRecibirMarcaDueno()" ${t.productos && !estado.enviando ? "" : "disabled"}>${estado.enviando ? "Guardando…" : "Confirmar recepción"}</button>
            </footer>`;
    }

    // Repinta solo la tarjeta y el pie al teclear (para no perder el cursor del campo).
    function actualizarTarjeta(id) {
        const tarjeta = document.querySelector(`#drmCapa .drm-tarjeta[data-id="${id}"]`);
        const n = estado.cantidades.get(id) || 0;
        if (tarjeta) {
            tarjeta.classList.toggle("con-entrada", n > 0);
            const campo = tarjeta.querySelector("input");
            if (campo && document.activeElement !== campo) campo.value = n || "";
        }

        const t = totales();
        const pie = document.querySelector("#drmCapa .drm-pie div");
        if (pie) pie.innerHTML = `<strong>${t.productos}</strong> producto${t.productos === 1 ? "" : "s"} · <strong>${t.piezas}</strong> pieza${t.piezas === 1 ? "" : "s"}`;
        const boton = document.getElementById("drmConfirmar");
        if (boton) boton.disabled = !t.productos || estado.enviando;
    }

    window.ajustarRecibirDueno = function (id, delta) {
        const nuevo = Math.max(0, Math.round(((estado.cantidades.get(id) || 0) + delta) * 1000) / 1000);
        estado.cantidades.set(id, nuevo);
        actualizarTarjeta(id);
    };

    window.escribirRecibirDueno = function (id, texto) {
        const n = Number(String(texto).replace(/[^0-9.]/g, ""));
        estado.cantidades.set(id, Number.isFinite(n) && n > 0 ? n : 0);
        actualizarTarjeta(id);
    };

    window.elegirMarcaRecibirDueno = function (marca) { estado.marca = marca; pintar(); document.querySelector("#drmCapa .drm-grid")?.scrollIntoView({ block: "start" }); };

    window.cerrarRecibirMarcaDueno = function () {
        if (estado && totales().productos && !window.confirm("Tienes cantidades sin guardar. ¿Salir sin confirmar?")) return;
        document.getElementById("drmCapa")?.classList.remove("abierta");
        document.body.classList.remove("drm-abierta");
        estado = null;
    };

    window.abrirRecibirMarcaDueno = async function () {
        let catalogo = [];
        try { catalogo = typeof listarCatalogoLocalCompletoDueno === "function" ? await listarCatalogoLocalCompletoDueno() : []; } catch (error) { catalogo = []; }

        const productos = catalogo.filter(p => Number(p.id) > 0);

        if (!productos.length) { if (typeof mostrarToastDueno === "function") mostrarToastDueno("Todavía no hay productos en tu catálogo."); return; }

        const grupos = agrupar(productos);
        estado = { grupos, marca: grupos[0].marca, cantidades: new Map(), enviando: false, llave: (typeof crypto !== "undefined" && crypto.randomUUID) ? crypto.randomUUID() : `rm-${Date.now()}-${Math.random().toString(16).slice(2)}` };
        pintar();
        capa().classList.add("abierta");
        document.body.classList.add("drm-abierta");
    };

    window.confirmarRecibirMarcaDueno = async function () {
        if (!estado || estado.enviando) return;

        const items = [];
        estado.cantidades.forEach((n, id) => { if (n > 0) items.push({ productoId: id, cantidad: n, costo: 0 }); });
        if (!items.length) return;

        const marcasConEntrada = estado.grupos.filter(g => g.productos.some(p => estado.cantidades.get(p.id) > 0)).map(g => g.marca);

        estado.enviando = true;
        pintar();

        try {
            const respuesta = await fetchAutenticado("/recepciones-mercancia/rapida", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ proveedor: marcasConEntrada.length === 1 ? marcasConEntrada[0] : "Varios", referencia: "Recibir por marca", usuarioNombre: (typeof duenoEmpleadoNombrePersona !== "undefined" && duenoEmpleadoNombrePersona) || "", idempotencyKey: estado.llave, items })
            });

            const cuantos = items.length;
            estado = null;
            document.getElementById("drmCapa")?.classList.remove("abierta");
            document.body.classList.remove("drm-abierta");
            if (typeof mostrarToastDueno === "function") mostrarToastDueno(respuesta.repetida ? "Esa recepción ya estaba guardada." : `Recepción guardada: ${cuantos} producto${cuantos === 1 ? "" : "s"} sumado${cuantos === 1 ? "" : "s"} al inventario.`);
            if (typeof refrescarCatalogoLocalDueno === "function") await refrescarCatalogoLocalDueno();
            if (typeof filtrarInventarioDueno === "function") filtrarInventarioDueno();
        } catch (error) {
            // La misma llave se conserva: si la peticion SI llego pero la respuesta se perdio, reintentar no suma dos veces.
            estado.enviando = false;
            pintar();
            if (typeof mostrarToastDueno === "function") mostrarToastDueno(error.message || "No se pudo guardar. Revisa tu internet y vuelve a intentar.");
        }
    };

    window.agruparMarcasRecibirDueno = agrupar;
    window.marcaDeRecibirDueno = marcaDe;

    // Boton junto a "Recibir mercancia" en Inventario.
    function ponerBoton() {
        const original = document.querySelector('#duenoInventario button[onclick="abrirRecepcionDueno()"]');
        if (!original || document.getElementById("drmBoton")) return;

        const boton = document.createElement("button");
        boton.id = "drmBoton";
        boton.type = "button";
        boton.className = original.className;
        boton.textContent = "Recibir por marca";
        boton.addEventListener("click", () => window.abrirRecibirMarcaDueno());
        original.insertAdjacentElement("afterend", boton);
    }

    ponerBoton();
})();
