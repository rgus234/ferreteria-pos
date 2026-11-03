/* Por revisar (abarrotes) / Por vencer (ferreteria) como tarjetas, con el menu simplificado.
   Que se ve de un vistazo: cuanto hay vencido, lo que vence hoy o mañana, lo de esta semana; cada producto con su foto, cuanto hay,
   cuando caduca (en palabras) y cuanto se perderia. Acciones directas: Editar, Tirar y Llego mas (abarrotes) o Ver (ferreteria).
   Los datos y las acciones son los de siempre (lotes-ui.js y expiring-products.js); aqui solo se dibujan. */
(function () {
    const CUBETAS = [
        { id: "vencido", titulo: "Ya vencidos", ayuda: "Sácalos hoy", clase: "rojo" },
        { id: "urgente", titulo: "Vencen hoy o mañana", ayuda: "Revísalos primero", clase: "naranja" },
        { id: "semana", titulo: "Esta semana", ayuda: "Véndelos pronto o ponles oferta", clase: "ambar" },
        { id: "luego", titulo: "Más adelante", ayuda: "Todavía hay tiempo", clase: "azul" }
    ];

    const estado = { filtro: "todos", texto: "", datos: null };

    const esc = valor => (typeof escaparPOS === "function" ? escaparPOS(valor) : String(valor ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])));
    const dineroTxt = valor => (typeof dinero === "function" ? dinero(valor) : "$" + Number(valor || 0).toFixed(2));
    const plano = texto => String(texto || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
    const activo = () => document.body.classList.contains("menu-simple");

    function cubetaDe(dias) {
        if (dias < 0) return "vencido";
        if (dias <= 1) return "urgente";
        if (dias <= 7) return "semana";
        return "luego";
    }

    function textoDias(dias) {
        if (dias < 0) return `Venció hace ${Math.abs(dias)} día${Math.abs(dias) === 1 ? "" : "s"}`;
        if (dias === 0) return "Vence hoy";
        if (dias === 1) return "Vence mañana";
        return `Vence en ${dias} días`;
    }

    function fechaLarga(iso) {
        return iso ? new Date(`${String(iso).slice(0, 10)}T00:00:00`).toLocaleDateString("es-MX", { weekday: "short", day: "numeric", month: "short" }) : "";
    }

    function foto(productoId, nombre) {
        const producto = typeof todosProductos !== "undefined" && Array.isArray(todosProductos) ? todosProductos.find(p => Number(p.id) === Number(productoId)) : null;
        if (producto && producto.imagenUrl && typeof miniaturaProducto === "function") return `<span class="pv-foto">${miniaturaProducto(producto, "pv-foto-img")}</span>`;
        const inicial = String(nombre || "?").trim().slice(0, 1).toUpperCase();
        return `<span class="pv-foto pv-foto-vacia" aria-hidden="true">${esc(inicial)}</span>`;
    }

    function cuenta(filas) {
        const c = { todos: filas.length, vencido: 0, urgente: 0, semana: 0, luego: 0 };
        filas.forEach(f => { c[cubetaDe(f.dias)]++; });
        return c;
    }

    function tarjeta(f, modo) {
        const cubeta = cubetaDe(f.dias);
        const clase = CUBETAS.find(c => c.id === cubeta).clase;
        const nombreAttr = esc(f.nombre).replace(/'/g, "&#39;");
        const riesgo = f.valorRiesgo > 0 ? `<span class="pv-riesgo">Perderías <b>${dineroTxt(f.valorRiesgo)}</b></span>` : "";

        const acciones = modo === "lotes"
            ? `<button type="button" onclick="editarProducto(${Number(f.productoId)})">Editar</button>
               <button type="button" class="accion-peligro" onclick="lotesTirar(${Number(f.productoId)}, ${Number(f.cantidad)}, '${nombreAttr}')">Tirar</button>
               <button type="button" onclick="lotesEntrada(${Number(f.productoId)}, '${nombreAttr}')">Llegó más</button>`
            : `<button type="button" onclick="editarProducto(${Number(f.productoId)})">Editar</button>
               <button type="button" onclick="pvVerEnInventario('${nombreAttr}')">Ver</button>`;

        return `<article class="pv-tarjeta pv-${clase}">
            ${foto(f.productoId, f.nombre)}
            <div class="pv-info">
                <strong>${esc(f.nombre)}</strong>
                <span class="pv-cantidad">${esc(f.cantidad)} ${esc(f.unidad || "")}${f.entrada ? ` · entró ${esc(fechaLarga(f.entrada))}` : ""}</span>
                <span class="pv-fecha">Caduca ${esc(fechaLarga(f.fechaCaducidad))}</span>
                ${riesgo}
            </div>
            <span class="pv-pildora">${esc(textoDias(f.dias))}</span>
            <div class="pv-acciones">${acciones}</div>
        </article>`;
    }

    function pintar() {
        const caja = document.getElementById("porVencerTarjetas");
        if (!caja || !estado.datos) return;

        const { filas, modo } = estado.datos;
        const c = cuenta(filas);
        const q = plano(estado.texto).trim();

        const visibles = filas.filter(f => (estado.filtro === "todos" || cubetaDe(f.dias) === estado.filtro) && (!q || plano(f.nombre).includes(q)));

        const fichas = [["todos", "Todo", c.todos, "gris"], ...CUBETAS.filter(b => b.id !== "luego" || c.luego > 0).map(b => [b.id, b.titulo, c[b.id], b.clase])];

        const chips = fichas.map(([id, nombre, n, clase]) => `<button type="button" class="pv-ficha pv-ficha-${clase}${estado.filtro === id ? " activa" : ""}" onclick="pvFiltro('${id}')">${esc(nombre)} <b>${n}</b></button>`).join("");

        let cuerpo = "";

        if (!filas.length) {
            cuerpo = `<div class="pv-vacio"><span aria-hidden="true">✅</span><b>Todo en orden</b><p>No hay nada vencido ni por vencer en los próximos días.</p></div>`;
        } else if (!visibles.length) {
            cuerpo = `<div class="pv-vacio"><b>Nada con ese filtro</b><p>Prueba con otra ficha o borra la búsqueda.</p></div>`;
        } else {
            cuerpo = CUBETAS.map(b => {
                const grupo = visibles.filter(f => cubetaDe(f.dias) === b.id);
                if (!grupo.length) return "";
                return `<section class="pv-grupo pv-${b.clase}"><h3><span class="pv-punto"></span>${esc(b.titulo)} <b>${grupo.length}</b><small>${esc(b.ayuda)}</small></h3>
                    <div class="pv-rejilla">${grupo.map(f => tarjeta(f, modo)).join("")}</div></section>`;
            }).join("");
        }

        const buscando = document.activeElement && document.activeElement.id === "pvBuscar";
        caja.innerHTML = `<div class="pv-barra"><div class="pv-fichas">${chips}</div>
            <input id="pvBuscar" class="pv-buscar" type="search" placeholder="Buscar un producto" value="${esc(estado.texto)}" oninput="pvBuscar(this.value)" autocomplete="off"></div>${cuerpo}`;

        if (buscando) { const campo = document.getElementById("pvBuscar"); campo.focus(); campo.setSelectionRange(campo.value.length, campo.value.length); }
    }

    window.pvFiltro = id => { estado.filtro = id; pintar(); };
    window.pvBuscar = texto => { estado.texto = texto; pintar(); };
    window.pvVerEnInventario = nombre => {
        if (typeof mostrarInventario === "function") mostrarInventario();
        const campo = document.getElementById("buscarInventario");
        if (campo) campo.value = nombre || "";
        if (typeof buscarInventario === "function") buscarInventario();
    };

    // Lo llaman lotes-ui.js (abarrotes) y expiring-products.js (ferreteria). Devuelve true si dibujo las tarjetas.
    window.renderPorVencerTarjetas = function (datos) {
        if (!activo()) return false;

        const pantalla = document.getElementById("pantallaPorVencer");
        const tabla = pantalla?.querySelector(".tabla-bajo");
        if (!pantalla || !tabla) return false;

        let caja = document.getElementById("porVencerTarjetas");
        if (!caja) {
            caja = document.createElement("div");
            caja.id = "porVencerTarjetas";
            caja.className = "pv";
            tabla.insertAdjacentElement("beforebegin", caja);
        }

        // otro modo (abarrotes <-> ferreteria) o primera vez: se empieza sin filtros
        if (!estado.datos || estado.datos.modo !== datos.modo) { estado.filtro = "todos"; estado.texto = ""; }
        estado.datos = datos;
        pintar();
        return true;
    };

    window.quitarPorVencerTarjetas = function () { document.getElementById("porVencerTarjetas")?.remove(); };
})();
