/* Gafi: codigos y fotos (Inventario -> Gafi: codigos y fotos). Solo para el administrador, con la funcion "gafi_captura" encendida.

   Se busca un producto de la lista de Gafi (por clave, codigo o nombre), se escanea el codigo de barras del empaque y se le toma o sube
   su foto. Con el codigo guardado, escanear ese empaque en Agregar producto ya lo reconoce. */

(function () {
    let resumen = null;
    let resultados = [];
    let elegido = null; // el producto que se esta capturando
    let mensaje = null; // { tipo: "ok" | "error", texto }
    let consulta = "";
    let temporizador = null;
    let urlFoto = null;

    const esc = valor => String(valor ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
    const dinero = valor => (valor == null ? "" : `$${Number(valor).toFixed(2)}`);
    const pantalla = () => document.getElementById("pantallaGafiCaptura");

    async function llamar(ruta, opciones = {}) {
        const respuesta = await fetch(ruta, { ...opciones, headers: { "Content-Type": "application/json", ...(opciones.headers || {}) } });
        const datos = await respuesta.json().catch(() => ({}));
        return { ok: respuesta.ok && datos.ok, datos };
    }

    async function cargarResumen() {
        const r = await llamar("/gafi-captura/resumen");
        resumen = r.ok ? r.datos : null;
    }

    async function cargarFoto(producto) {
        if (urlFoto) URL.revokeObjectURL(urlFoto);
        urlFoto = null;

        if (!producto?.tieneFoto) return;

        try {
            const respuesta = await fetch(`/gafi-captura/${producto.id}/foto`);
            if (respuesta.ok) urlFoto = URL.createObjectURL(await respuesta.blob());
        } catch (error) { /* sin vista previa: la foto igual esta guardada */ }
    }

    window.mostrarGafiCaptura = async function () {
        if (typeof ocultarPantallasPrincipales === "function") ocultarPantallasPrincipales();

        const raiz = pantalla();
        if (!raiz) return;

        raiz.style.display = "block";
        if (typeof actualizarTopbarContexto === "function") actualizarTopbarContexto("Gafi: códigos y fotos", "Escanea el empaque y suma al catálogo", "gafi_captura");

        await cargarResumen();
        pintar();
        raiz.querySelector("#gafBuscar")?.focus();
    };

    async function buscar(texto) {
        consulta = texto;
        const r = await llamar(`/gafi-captura/buscar?q=${encodeURIComponent(texto)}`);

        if (consulta !== texto) return; // llego una busqueda mas nueva

        resultados = r.ok ? r.datos.productos : [];
        mensaje = r.ok ? null : { tipo: "error", texto: r.datos.error || "No se pudo buscar." };
        pintar(true);
    }

    function comprimirFoto(archivo) {
        return new Promise((resolver, rechazar) => {
            const lector = new FileReader();
            lector.onerror = () => rechazar(new Error("No se pudo leer la foto."));
            lector.onload = () => {
                const imagen = new Image();
                imagen.onerror = () => rechazar(new Error("Esa foto no se pudo abrir."));
                imagen.onload = () => {
                    const escala = Math.min(1, 1000 / Math.max(imagen.width, imagen.height));
                    const lienzo = document.createElement("canvas");
                    lienzo.width = Math.round(imagen.width * escala);
                    lienzo.height = Math.round(imagen.height * escala);
                    lienzo.getContext("2d").drawImage(imagen, 0, 0, lienzo.width, lienzo.height);
                    resolver(lienzo.toDataURL("image/jpeg", 0.85));
                };
                imagen.src = lector.result;
            };
            lector.readAsDataURL(archivo);
        });
    }

    function actualizarEnLista(producto) {
        resultados = resultados.map(p => (p.id === producto.id ? producto : p));
        if (elegido && elegido.id === producto.id) elegido = producto;
    }

    async function guardarCodigo() {
        const campo = document.getElementById("gafCodigo");
        const valor = (campo?.value || "").trim();

        if (!valor) { mensaje = { tipo: "error", texto: "Escanea o escribe el código de barras." }; pintar(); return; }

        const r = await llamar(`/gafi-captura/${elegido.id}/codigo-barras`, { method: "POST", body: JSON.stringify({ codigoBarras: valor }) });

        if (!r.ok) { mensaje = { tipo: "error", texto: r.datos.error || "No se pudo guardar." }; pintar(); return; }

        actualizarEnLista(r.datos.producto);
        mensaje = { tipo: "ok", texto: "Código de barras guardado." };
        await cargarResumen();
        pintar();
        document.getElementById("gafFoto")?.focus();
    }

    async function guardarFoto(archivo) {
        if (!archivo) return;

        try {
            const imagen = await comprimirFoto(archivo);
            const r = await llamar(`/gafi-captura/${elegido.id}/foto`, { method: "POST", body: JSON.stringify({ imagen }) });

            if (!r.ok) { mensaje = { tipo: "error", texto: r.datos.error || "No se pudo guardar la foto." }; pintar(); return; }

            actualizarEnLista(r.datos.producto);
            await cargarFoto(elegido);
            mensaje = { tipo: "ok", texto: "Foto guardada." };
            await cargarResumen();
        } catch (error) {
            mensaje = { tipo: "error", texto: error.message };
        }

        pintar();
    }

    async function elegir(id) {
        elegido = resultados.find(p => String(p.id) === String(id)) || null;
        mensaje = null;
        await cargarFoto(elegido);
        pintar();
        document.getElementById("gafCodigo")?.focus();
    }

    function siguiente() {
        elegido = null;
        mensaje = null;
        resultados = [];
        consulta = "";
        pintar();
        document.getElementById("gafBuscar")?.focus();
    }

    function tarjetaCaptura() {
        const p = elegido;

        return `<section class="gaf-captura">
            <div class="gaf-cab"><div><h3>${esc(p.nombre)}</h3><p>${esc(p.marca)}${p.clave ? ` · Clave ${esc(p.clave)}` : ""} · Gafi ${esc(p.codigo)}${p.precio != null ? ` · ${dinero(p.precio)}` : ""}</p></div><button type="button" data-accion="siguiente">Otro producto</button></div>
            <div class="gaf-bloque">
                <label for="gafCodigo">Código de barras del empaque</label>
                <div class="gaf-fila"><input id="gafCodigo" type="text" inputmode="numeric" autocomplete="off" placeholder="Escanea el empaque" value="${esc(p.codigoBarras)}"><button type="button" class="gaf-principal" data-accion="guardar-codigo">Guardar código</button></div>
                ${p.codigoBarras ? `<small class="gaf-ok">Ya tiene código guardado. Si lo cambias, se reemplaza.</small>` : ""}
            </div>
            <div class="gaf-bloque">
                <label for="gafFoto">Foto del producto</label>
                <div class="gaf-fila">${urlFoto ? `<img class="gaf-miniatura" src="${urlFoto}" alt="Foto guardada de ${esc(p.nombre)}">` : `<div class="gaf-miniatura gaf-sin-foto">Sin foto</div>`}<label class="gaf-boton-archivo">${p.tieneFoto ? "Cambiar foto" : "Tomar o subir foto"}<input id="gafFoto" type="file" accept="image/*" capture="environment" hidden></label></div>
            </div>
            ${mensaje ? `<p class="gaf-mensaje gaf-${mensaje.tipo}" role="status">${esc(mensaje.texto)}</p>` : ""}
        </section>`;
    }

    function filaResultado(p) {
        return `<button type="button" class="gaf-fila-resultado" data-elegir="${p.id}"><span><b>${esc(p.nombre)}</b><small>${esc(p.marca)}${p.clave ? ` · ${esc(p.clave)}` : ""}</small></span><span class="gaf-marcas"><i class="${p.codigoBarras ? "gaf-listo" : ""}">${p.codigoBarras ? "✓ código" : "sin código"}</i><i class="${p.tieneFoto ? "gaf-listo" : ""}">${p.tieneFoto ? "✓ foto" : "sin foto"}</i></span></button>`;
    }

    // Las que no coinciden en todo lo escrito salen aparte, con su aviso.
    function listaHtml() {
        let hayParcial = false;

        return resultados.map(p => {
            const aviso = p.coincidencia === "parcial" && !hayParcial ? ((hayParcial = true), `<p class="gaf-parcial">Parecidos: no coinciden en todo lo que escribiste</p>`) : "";
            return aviso + filaResultado(p);
        }).join("");
    }

    function pintar(soloResultados = false) {
        const raiz = pantalla();
        if (!raiz) return;

        if (soloResultados && document.getElementById("gafResultados")) {
            document.getElementById("gafResultados").innerHTML = resultados.length ? listaHtml() : (consulta.length >= 2 ? `<p class="gaf-vacio">No hay productos de Gafi con eso.</p>` : "");
            enlazarResultados(raiz);
            return;
        }

        raiz.innerHTML = `<div class="gaf-shell">
            <header><h2>Gafi: códigos y fotos</h2><p>Busca un producto de la lista de Gafi, escanea el código de barras de su empaque y tómale su foto. Escribe como veas: marca, medida o el código del empaque (si dice “IDH 23 74 72 5”, escríbelo igual). Aunque te equivoques de letra, lo encuentra.</p>
            ${resumen ? `<div class="gaf-avance"><span><b>${resumen.con_barras}</b> con código</span><span><b>${resumen.con_foto}</b> con foto</span><span>de <b>${resumen.total}</b> productos</span></div>` : ""}</header>
            ${elegido ? tarjetaCaptura() : `<div class="gaf-busqueda"><input id="gafBuscar" type="search" autocomplete="off" placeholder="Marca, medida, nombre o código (ej. resistol 500, HSG1406)" value="${esc(consulta)}"></div>
            ${mensaje ? `<p class="gaf-mensaje gaf-${mensaje.tipo}" role="status">${esc(mensaje.texto)}</p>` : ""}
            <div id="gafResultados" class="gaf-resultados">${listaHtml()}</div>`}
        </div>`;

        enlazar(raiz);
    }

    function enlazarResultados(raiz) {
        raiz.querySelectorAll("[data-elegir]").forEach(boton => { boton.onclick = () => elegir(boton.dataset.elegir); });
    }

    function enlazar(raiz) {
        enlazarResultados(raiz);

        const campoBuscar = raiz.querySelector("#gafBuscar");
        if (campoBuscar) {
            campoBuscar.oninput = () => {
                clearTimeout(temporizador);
                const texto = campoBuscar.value.trim();
                temporizador = setTimeout(() => (texto.length >= 2 ? buscar(texto) : (resultados = [], consulta = texto, pintar(true))), 250);
            };
        }

        const campoCodigo = raiz.querySelector("#gafCodigo");
        if (campoCodigo) campoCodigo.onkeydown = evento => { if (evento.key === "Enter") { evento.preventDefault(); guardarCodigo(); } };

        const campoFoto = raiz.querySelector("#gafFoto");
        if (campoFoto) campoFoto.onchange = () => guardarFoto(campoFoto.files[0]);

        raiz.querySelector('[data-accion="guardar-codigo"]')?.addEventListener("click", guardarCodigo);
        raiz.querySelector('[data-accion="siguiente"]')?.addEventListener("click", siguiente);
    }
})();
