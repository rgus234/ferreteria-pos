/* Alta efectiva en el celular (Fase C del plan docs/plan-celular-inventario-y-venta.md): al crear un producto nuevo aparece
   "Como lo compras y lo vendes" (bolsa/caja/costal, piezas por bolsa, kilo/pieza, pieza suelta, bascula) con una SUGERENCIA que
   sale de los productos parecidos del propio negocio (GET /sugerencia-alta): "Es como tus otras pijas: se compra por bolsa de 100,
   se vende por kilo. ¿Usar esta configuracion?". Es opcional y nunca se aplica sola. Lo elegido viaja en el mismo
   POST /agregar-producto que ya usa el formulario (guardarProductoNuevoDueno llama a configuracionAltaDueno()). */

(function () {
    const PRESENTACIONES = [["", "Pieza suelta"], ["BOLSA", "Bolsa"], ["CAJA", "Caja"], ["COSTAL", "Costal"], ["PAQUETE", "Paquete"], ["ROLLO", "Rollo"], ["JUEGO", "Juego"]];
    const UNIDADES = [["pieza", "Pieza"], ["kilo", "Kilo"], ["metro", "Metro"], ["litro", "Litro"], ["paquete", "Paquete"]];
    const VACIO = { presentacion_compra: "", factor_conversion: null, unidad_venta: "pieza", permite_venta_pieza: false, bascula_digital: "no" };

    let estado = { valores: { ...VACIO }, origen: "defecto", sugerencia: null, abierto: false };
    let temporizador = null;
    let ultimoNombre = "";

    const esc = valor => (typeof escaparDueno === "function" ? escaparDueno(valor) : String(valor ?? ""));

    // Lo que se manda al servidor a partir de lo elegido (funcion pura: se prueba sin pantalla).
    function construirConfiguracionAlta(valores, sugerencia = null) {
        const v = { ...VACIO, ...valores };
        const porPresentacion = Boolean(v.presentacion_compra);
        const factor = porPresentacion && Number(v.factor_conversion) > 0 ? Number(v.factor_conversion) : null;
        const cuerpo = {
            unidadVenta: v.unidad_venta || "pieza",
            presentacionCompra: porPresentacion ? String(v.presentacion_compra).toUpperCase() : "",
            basculaDigital: v.bascula_digital === "si" ? "si" : "no",
            permiteVentaPieza: Boolean(v.permite_venta_pieza)
        };

        if (factor) { cuerpo.factorConversion = factor; if (cuerpo.permiteVentaPieza) cuerpo.piezasPorBolsa = factor; }

        // De la sugerencia tambien viene donde se clasifica y quien lo surte (solo si hay y se uso).
        if (sugerencia) {
            ["categoria", "subcategoria"].forEach(c => { if (sugerencia[c]) cuerpo[c] = sugerencia[c]; });
            if (sugerencia.categoria_nexo_id) cuerpo.categoriaNexoId = sugerencia.categoria_nexo_id;
            if (sugerencia.proveedor_id) cuerpo.proveedorId = sugerencia.proveedor_id;
        }

        return cuerpo;
    }

    window.configuracionAltaDueno = function () {
        const f = typeof duenoProductoForm !== "undefined" ? duenoProductoForm : null;
        if (!f || f.modo !== "nuevo" || !document.getElementById("daiSeccion")) return {};

        const cuerpo = construirConfiguracionAlta(estado.valores, estado.origen === "sugerencia" ? estado.sugerencia?.sugerencia?.configuracion : null);
        // Si ya se eligio categoria Nexo con la IA o el maestro, esa manda sobre la de la sugerencia.
        if (f.categoriaNexo) { delete cuerpo.categoriaNexoId; delete cuerpo.categoria; delete cuerpo.subcategoria; }
        return cuerpo;
    };

    window.construirConfiguracionAlta = construirConfiguracionAlta;

    // Al COMPLETAR un producto recien creado (desde una factura) solo viajan los campos de como se compra y se vende, y solo si se tocaron.
    window.configuracionCompletarDueno = function () {
        const f = typeof duenoProductoForm !== "undefined" ? duenoProductoForm : null;
        if (!f || f.modo !== "editar" || !f.completarConfig || !document.getElementById("daiSeccion") || estado.origen === "defecto") return {};

        const c = construirConfiguracionAlta(estado.valores);
        const cuerpo = { unidadVenta: c.unidadVenta, presentacionCompra: c.presentacionCompra, basculaDigital: c.basculaDigital, permiteVentaPieza: c.permiteVentaPieza };
        cuerpo.factorConversion = c.factorConversion ?? null;
        if (c.piezasPorBolsa) cuerpo.piezasPorBolsa = c.piezasPorBolsa;
        return cuerpo;
    };

    function opciones(lista, actual) {
        return lista.map(([valor, texto]) => `<option value="${esc(valor)}" ${String(actual ?? "") === valor ? "selected" : ""}>${esc(texto)}</option>`).join("");
    }

    function resumenTexto(v) {
        const compra = v.presentacion_compra ? `Se compra por ${v.presentacion_compra.toLowerCase()}${Number(v.factor_conversion) > 0 ? ` de ${Number(v.factor_conversion)}` : ""}` : "Se compra por pieza";
        const venta = `se vende por ${String(v.unidad_venta || "pieza").toLowerCase()}${v.permite_venta_pieza ? " y por pieza suelta" : ""}${v.bascula_digital === "si" ? " (se pesa)" : ""}`;
        return `${compra} · ${venta}`;
    }

    function pintar() {
        const caja = document.getElementById("daiSeccion");
        if (!caja) return;

        const v = estado.valores;
        const s = estado.sugerencia;

        caja.innerHTML = `
            <h3>Cómo lo compras y lo vendes</h3>
            ${s && estado.origen !== "sugerencia" && estado.origen !== "manual" ? `
            <div class="dai-sugerencia">
                <b>Es como tus otros "${esc(s.familia)}"</b>
                <span>${esc(s.sugerencia.resumen)}</span>
                <small>${s.sugerencia.votos} de ${s.sugerencia.total} productos parecidos lo tienen así</small>
                <div class="dai-botones"><button type="button" class="dai-si" onclick="daiUsarSugerencia()">Usar esta configuración</button><button type="button" class="dai-no" onclick="daiDescartarSugerencia()">No, a mano</button></div>
            </div>` : ""}
            <p class="dai-resumen"><span>${esc(resumenTexto(v))}</span>${estado.origen === "sugerencia" ? `<em>sugerida</em>` : ""}<button type="button" onclick="daiAlternar()">${estado.abierto ? "Cerrar" : "Cambiar"}</button></p>
            <div class="dai-campos" style="display:${estado.abierto ? "grid" : "none"}">
                <label>Se compra por<select onchange="daiCampo('presentacion_compra', this.value)">${opciones(PRESENTACIONES, v.presentacion_compra)}</select></label>
                ${v.presentacion_compra ? `<label>Piezas por ${esc(v.presentacion_compra.toLowerCase())}<input type="number" inputmode="decimal" min="0" step="any" value="${v.factor_conversion ?? ""}" oninput="daiCampo('factor_conversion', this.value, false)" placeholder="Ej. 100"></label>` : ""}
                <label>Se vende por<select onchange="daiCampo('unidad_venta', this.value)">${opciones(UNIDADES, v.unidad_venta)}</select></label>
                ${v.presentacion_compra ? `<label class="dai-check"><input type="checkbox" ${v.permite_venta_pieza ? "checked" : ""} onchange="daiCampo('permite_venta_pieza', this.checked)"> También se vende por pieza suelta</label>` : ""}
                <label class="dai-check"><input type="checkbox" ${v.bascula_digital === "si" ? "checked" : ""} onchange="daiCampo('bascula_digital', this.checked ? 'si' : 'no')"> Se pesa en báscula</label>
            </div>`;
    }

    window.daiAlternar = function () { estado.abierto = !estado.abierto; pintar(); };

    // El resumen se actualiza sin redibujar los campos (para no perder el cursor al escribir).
    window.daiCampo = function (campo, valor, redibujar = true) {
        estado.valores[campo] = campo === "factor_conversion" ? (valor === "" ? null : Number(valor)) : valor;
        estado.origen = "manual";
        if (campo === "presentacion_compra" && !valor) { estado.valores.factor_conversion = null; estado.valores.permite_venta_pieza = false; }
        if (redibujar) pintar(); else document.querySelector("#daiSeccion .dai-resumen span").textContent = resumenTexto(estado.valores);
    };

    window.daiUsarSugerencia = function () {
        const c = estado.sugerencia?.sugerencia?.configuracion;
        if (!c) return;

        estado.valores = { presentacion_compra: String(c.presentacion_compra || "").toUpperCase(), factor_conversion: c.factor_conversion, unidad_venta: c.unidad_venta || "pieza", permite_venta_pieza: Boolean(c.permite_venta_pieza), bascula_digital: c.bascula_digital === "si" ? "si" : "no" };
        estado.origen = "sugerencia";

        const minimo = document.getElementById("duenoProdStockMinimo");
        if (minimo && c.stock_minimo !== null && c.stock_minimo !== undefined) minimo.value = c.stock_minimo;

        pintar();
    };

    window.daiDescartarSugerencia = function () { estado.sugerencia = { ...estado.sugerencia, descartada: true }; estado.origen = "manual"; estado.abierto = true; pintar(); };

    async function pedirSugerencia() {
        const nombre = String(document.getElementById("duenoProdNombre")?.value || "").trim();
        if (nombre.length < 3 || nombre === ultimoNombre || estado.origen === "manual" || estado.origen === "sugerencia") return;

        ultimoNombre = nombre;

        try {
            const excluir = typeof duenoProductoForm !== "undefined" && duenoProductoForm?.modo === "editar" ? `&excluir=${Number(duenoProductoForm.producto?.id) || 0}` : "";
            const datos = await fetchAutenticado(`/sugerencia-alta?nombre=${encodeURIComponent(nombre)}${excluir}`);
            estado.sugerencia = datos?.sugerencia ? { familia: datos.familia, sugerencia: datos.sugerencia } : null;
        } catch (error) {
            estado.sugerencia = null;
        }

        pintar();
    }

    function conectarNombre() {
        const campo = document.getElementById("duenoProdNombre");
        if (!campo || campo.dataset.dai) return;

        campo.dataset.dai = "1";
        campo.addEventListener("input", () => { clearTimeout(temporizador); temporizador = setTimeout(pedirSugerencia, 600); });
    }

    // Al ESCRIBIR el codigo (Truper, de proveedor o de barras) tambien se busca solo: antes solo buscaba al terminar de escribir
    // y salir del campo, y en el iPhone eso casi nunca pasaba. Avisa "Buscando..." y "No encontre ese codigo".
    let temporizadorCodigo = null;

    function estadoCodigo(texto, clase = "") {
        let caja = document.getElementById("daiCodigoEstado");
        const campo = document.getElementById("duenoProdCodigo");

        if (!caja && campo) {
            caja = document.createElement("small");
            caja.id = "daiCodigoEstado";
            campo.insertAdjacentElement("afterend", caja);
        }

        if (caja) { caja.textContent = texto; caja.className = "dai-codigo-estado " + clase; caja.style.display = texto ? "" : "none"; }
    }

    async function buscarPorCodigo() {
        const campo = document.getElementById("duenoProdCodigo");
        const codigo = String(campo?.value || "").trim();

        if (codigo.length < 4) { estadoCodigo(""); return; }
        if (typeof autollenarDesdeMaestroDueno !== "function") return;

        estadoCodigo("Buscando en el catálogo…");
        await window.autollenarDesdeMaestroDueno(codigo);

        const reconocido = document.getElementById("duenoProdReconocido");
        const visible = reconocido && reconocido.style.display !== "none" && reconocido.offsetParent !== null;
        estadoCodigo(visible ? "✓ Producto encontrado: se llenaron sus datos." : "No encontré ese código en el catálogo. Llena el producto a mano.", visible ? "ok" : "no");
    }

    function conectarCodigo() {
        const campo = document.getElementById("duenoProdCodigo");
        if (!campo || campo.dataset.dai) return;

        campo.dataset.dai = "1";
        campo.addEventListener("input", () => { clearTimeout(temporizadorCodigo); temporizadorCodigo = setTimeout(buscarPorCodigo, 700); });
    }

    // ---- Buscar en el catalogo de Nexo POR NOMBRE (producto nuevo sin codigo): al escribir "dorit" salen las coincidencias del
    // catalogo con su foto; al tocar una se llena codigo, nombre, categoria y precio igual que al escanear. ----

    let resultadosCatalogo = [];
    let temporizadorCatalogo = null;
    let consultaCatalogo = 0;

    function cajaCatalogo() {
        let caja = document.getElementById("daiCatalogo");
        const nombre = document.getElementById("duenoProdNombre");

        if (!caja && nombre) {
            caja = document.createElement("div");
            caja.id = "daiCatalogo";
            caja.className = "dai-catalogo";
            (nombre.closest("label") || nombre).insertAdjacentElement("afterend", caja);
        }

        return caja;
    }

    function pintarCatalogo(elegido) {
        const caja = cajaCatalogo();
        if (!caja) return;

        if (elegido) {
            caja.innerHTML = `<div class="dai-cat-fila dai-cat-elegido"><span class="dai-cat-foto" id="daiCatFotoElegido"></span><span class="dai-cat-texto"><b>${esc(elegido.nombre)}</b><small>Del catálogo de Nexo · ${esc(elegido.codigo)}</small></span><button type="button" class="dai-no" onclick="daiQuitarCatalogo()">Quitar</button></div>`;
            ponerFotoCatalogo(elegido.codigo, "daiCatFotoElegido");
            return;
        }

        if (!resultadosCatalogo.length) { caja.innerHTML = ""; return; }

        caja.innerHTML = `<p class="dai-cat-titulo">¿Es alguno de estos? Toca el tuyo y se llena solo.</p>` + resultadosCatalogo.map((r, i) => `
            <button type="button" class="dai-cat-fila" onclick="daiElegirCatalogo(${i})"><span class="dai-cat-foto" id="daiCatFoto${i}"></span><span class="dai-cat-texto"><b>${esc(r.nombre)}</b><small>${esc([r.marca, r.codigo].filter(Boolean).join(" · "))}</small></span></button>`).join("");
        resultadosCatalogo.forEach((r, i) => ponerFotoCatalogo(r.codigo, "daiCatFoto" + i));
    }

    async function ponerFotoCatalogo(codigo, idDestino) {
        try {
            const datos = await fetchAutenticado(`/explorar-nexo/foto/${encodeURIComponent(codigo)}`);
            const destino = document.getElementById(idDestino);
            if (destino && datos?.url) destino.innerHTML = `<img src="${esc(datos.url)}" alt="" loading="lazy">`;
        } catch (error) { /* sin foto: queda el cuadro vacio */ }
    }

    async function buscarPorNombreCatalogo() {
        const f = typeof duenoProductoForm !== "undefined" ? duenoProductoForm : null;
        const nombre = String(document.getElementById("duenoProdNombre")?.value || "").trim();
        const codigo = String(document.getElementById("duenoProdCodigo")?.value || "").trim();

        // Solo producto nuevo, con nombre y sin codigo (con codigo ya se busco por codigo), y sin un producto del catalogo ya elegido.
        if (!f || f.modo !== "nuevo" || f.maestroCodigo || codigo || nombre.length < 3 || !navigator.onLine) {
            resultadosCatalogo = [];
            if (!f?.maestroCodigo) pintarCatalogo();
            return;
        }

        const turno = ++consultaCatalogo;

        try {
            const datos = await fetchAutenticado(`/explorar-nexo/buscar?q=${encodeURIComponent(nombre)}`);
            if (turno !== consultaCatalogo) return;

            // Cada giro ve lo suyo: un abarrotes no recibe brocas (los productos de fabricante son de ferreteria) ni una ferreteria las botanas escaneadas.
            const giro = window.duenoGiro || {};
            const delGiro = r => (giro.abarrotesSolo ? r.origen !== "fabricante" : giro.ferreteriaSolo ? r.origen !== "negocio" : true);
            const vistos = new Set();
            resultadosCatalogo = (datos?.catalogoMaestro || []).filter(delGiro).map(r => ({ ...r, codigoUsable: r.ean || r.codigo })).filter(r => {
                if (!r.codigoUsable || vistos.has(r.codigoUsable)) return false;
                vistos.add(r.codigoUsable);
                return true;
            }).slice(0, 6).map(r => ({ nombre: r.nombre, marca: r.marca || "", codigo: r.codigoUsable }));
        } catch (error) {
            resultadosCatalogo = [];
        }

        pintarCatalogo();
    }

    window.daiElegirCatalogo = async function (indice) {
        const elegido = resultadosCatalogo[indice];
        const campoCodigo = document.getElementById("duenoProdCodigo");
        const campoNombre = document.getElementById("duenoProdNombre");
        if (!elegido || !campoCodigo || !campoNombre) return;

        campoCodigo.value = elegido.codigo;
        // Vacio a proposito: el autollenado solo pone el nombre completo (con tamaño) si el campo esta vacio.
        campoNombre.value = "";
        resultadosCatalogo = [];
        await window.autollenarDesdeMaestroDueno(elegido.codigo);

        if (!campoNombre.value.trim()) campoNombre.value = elegido.nombre;
        ultimoNombre = "";
        pintarCatalogo({ nombre: campoNombre.value, codigo: elegido.codigo });
        pedirSugerencia();
    };

    window.daiQuitarCatalogo = function () {
        const f = typeof duenoProductoForm !== "undefined" ? duenoProductoForm : null;

        if (f) { f.maestroCodigo = null; f.catalogoMaestroId = null; }

        const campoCodigo = document.getElementById("duenoProdCodigo");
        if (campoCodigo) campoCodigo.value = "";
        const reconocido = document.getElementById("duenoProdReconocido");
        if (reconocido) reconocido.style.display = "none";

        pintarCatalogo();
    };

    function conectarCatalogoPorNombre() {
        const campo = document.getElementById("duenoProdNombre");
        if (!campo || campo.dataset.daiCat) return;

        campo.dataset.daiCat = "1";
        campo.addEventListener("input", () => { clearTimeout(temporizadorCatalogo); temporizadorCatalogo = setTimeout(buscarPorNombreCatalogo, 450); });
    }

    // ---- Producto nuevo segun el giro: en abarrotes no hay "medio mayoreo" (es lo que te cuesta, el precio de distribuidor), el
    // ejemplo del nombre es de tienda y debajo se ve cuanto ganas (o pierdes) por pieza, igual que en la computadora. ----

    function pintarGananciaNuevo() {
        const caja = document.getElementById("daiGanancia");
        if (!caja) return;

        const costo = Number(document.getElementById("duenoProdCostoNuevo")?.value);
        const precio = Number(document.getElementById("duenoProdPrecioPublico")?.value);
        const dinero = valor => "$" + Math.abs(valor).toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

        caja.className = "dai-ganancia";

        if (!(costo > 0) || !(precio > 0)) { caja.textContent = "Escribe lo que te cuesta y lo que cobras: aquí verás cuánto ganas por pieza."; return; }

        const ganancia = precio - costo;

        if (ganancia < 0) { caja.classList.add("dai-ganancia-mal"); caja.textContent = `⚠️ Estás perdiendo ${dinero(ganancia)} por pieza: cobras menos de lo que te cuesta.`; }
        else if (ganancia === 0) { caja.classList.add("dai-ganancia-cero"); caja.textContent = "Cobras lo mismo que te cuesta: no estás ganando nada."; }
        else { caja.classList.add("dai-ganancia-ok"); caja.textContent = `✅ Ganas ${dinero(ganancia)} por pieza (${Math.round((ganancia / costo) * 100)}% sobre lo que te cuesta).`; }
    }

    async function adaptarFormularioAlGiro(f) {
        const abarrotes = typeof window.NexoMovil?.esAbarrotes === "function" ? await window.NexoMovil.esAbarrotes().catch(() => false) : false;

        if (duenoProductoForm !== f || document.getElementById("daiGanancia")) return;

        const nombre = document.getElementById("duenoProdNombre");
        if (nombre && abarrotes) nombre.placeholder = "Ej. Coca-Cola 600 ml";

        const publico = document.getElementById("duenoProdPrecioPublico");
        const mayoreo = document.getElementById("duenoProdPrecioMayoreo");
        const campoMayoreo = mayoreo?.closest("label");
        const veCosto = typeof duenoRolSesion === "undefined" || duenoRolSesion !== "employee";

        if (abarrotes && mayoreo && campoMayoreo) {
            if (veCosto) {
                // El mismo lugar, pero ahora es lo que le pagas al proveedor (precio de distribuidor).
                campoMayoreo.childNodes[0].nodeValue = "Lo que te cuesta (precio de distribuidor)";
                mayoreo.id = "duenoProdCostoNuevo";
                mayoreo.placeholder = "0.00";
                mayoreo.addEventListener("input", pintarGananciaNuevo);
            } else {
                campoMayoreo.style.display = "none";
            }
        }

        if (abarrotes && veCosto && publico && !document.getElementById("daiGanancia")) {
            const caja = document.createElement("p");
            caja.id = "daiGanancia";
            (campoMayoreo || publico.closest("label")).insertAdjacentElement("afterend", caja);
            publico.addEventListener("input", pintarGananciaNuevo);
            pintarGananciaNuevo();
        }
    }

    // ---- "¿Donde lo vas a poner?": estante o bodega al crear el producto, y "Guardar y siguiente" con un estante fijo ----

    let lugar = null; // { id, nombre, zona, ruta, codigo }
    let fijarLugar = false;

    function pintarLugar() {
        const caja = document.getElementById("daiLugar");
        if (!caja) return;

        caja.innerHTML = `<h3>¿Dónde lo vas a poner?</h3>
            ${fijarLugar && lugar ? `<p class="dai-banner">Guardando en ${esc(lugar.nombre)}: al guardar se abre el siguiente producto.</p>` : ""}
            ${lugar ? `<div class="dai-lugar-elegido"><b>${esc(lugar.ruta)}</b><small>${esc(lugar.codigo)}</small></div>
                ${lugar.zona === "bodega" ? `<label class="dai-campos-lugar">Piezas en esta bodega (vacío = todas las existencias)<input id="daiCantBodega" type="number" inputmode="decimal" min="0" step="any" placeholder="Todas"></label>` : ""}
                <label class="dai-fijar"><input type="checkbox" ${fijarLugar ? "checked" : ""} onchange="daiFijarLugar(this.checked)"><span>Seguir dando de alta aquí (Guardar y siguiente)</span></label>
                <div class="dai-botones"><button type="button" class="dai-no" onclick="daiElegirLugar()">Cambiar</button><button type="button" class="dai-no" onclick="daiQuitarLugar()">Quitar</button></div>`
            : `<p class="dai-resumen"><span>Opcional: así ya queda acomodado en la tienda.</span></p><div class="dai-botones"><button type="button" class="dai-si" onclick="daiElegirLugar()">Elegir o escanear lugar</button></div>`}`;
    }

    window.daiElegirLugar = async function () {
        if (!window.NexoMovil?.elegirLugar) return;

        const elegido = await window.NexoMovil.elegirLugar({ titulo: "¿Dónde lo vas a poner?" });

        if (elegido) { lugar = elegido; pintarLugar(); }
    };

    window.daiQuitarLugar = function () { lugar = null; fijarLugar = false; pintarLugar(); };
    // Lo usa "Dile a Nexo" > Revisar: deja elegido el lugar que dijo la persona.
    window.daiPonerLugar = function (elegido) { if (elegido && elegido.id) { lugar = elegido; pintarLugar(); } };
    window.daiFijarLugar = function (valor) { fijarLugar = Boolean(valor); pintarLugar(); };

    // Se llama desde guardarProductoNuevoDueno con el producto ya creado: lo asigna al lugar elegido.
    window.asignarLugarNuevoDueno = async function (productoId, existencias) {
        if (!lugar || !document.getElementById("daiLugar")) return "";

        const a = await window.NexoMovil.llamar(`/ubicaciones/${lugar.id}/asignar`, { method: "POST", body: { productoIds: [productoId] } });

        if (!a.ok) throw new Error(a.datos.error || "No se pudo asignar el lugar");

        if (lugar.zona === "bodega") {
            const escrito = document.getElementById("daiCantBodega")?.value;
            const cantidad = escrito === "" || escrito === undefined ? Number(existencias) || 0 : Number(escrito);

            if (cantidad > 0) await window.NexoMovil.llamar(`/ubicaciones/${lugar.id}/bodega`, { method: "POST", body: { productoId, cantidad } });
        }

        return lugar.nombre;
    };

    // Con "Guardar y siguiente" el formulario vuelve a abrirse en blanco para el siguiente producto del mismo estante.
    window.siguienteProductoNuevoDueno = function (vinoDeOtroFlujo) {
        if (vinoDeOtroFlujo) return;

        if (!fijarLugar || !lugar) { lugar = null; fijarLugar = false; return; }

        setTimeout(() => { if (typeof abrirFormularioProductoDueno === "function") abrirFormularioProductoDueno(null); }, 350);
    };

    // Enganche con el formulario de dueno-inventario.js (solo producto NUEVO).
    const original = window.renderFormularioProductoDueno;

    if (typeof original === "function") {
        window.renderFormularioProductoDueno = function (...argumentos) {
            const resultado = original.apply(this, argumentos);
            const f = typeof duenoProductoForm !== "undefined" ? duenoProductoForm : null;

            if (f && (f.modo === "nuevo" || (f.modo === "editar" && f.completarConfig))) {
                const p = f.producto || {};
                const inicial = f.modo === "editar"
                    ? { presentacion_compra: String(p.presentacion_compra || "").toUpperCase(), factor_conversion: p.factor_conversion === null || p.factor_conversion === undefined ? null : Number(p.factor_conversion), unidad_venta: p.unidad_venta || "pieza", permite_venta_pieza: Boolean(p.permite_venta_pieza), bascula_digital: p.bascula_digital === "si" ? "si" : "no" }
                    : { ...VACIO };

                estado = { valores: inicial, origen: "defecto", sugerencia: null, abierto: false };
                ultimoNombre = "";

                const error = document.getElementById("duenoProdError");
                if (error && !document.getElementById("daiSeccion")) {
                    const caja = document.createElement("section");
                    caja.id = "daiSeccion";
                    caja.className = "dai-seccion";
                    error.parentNode.insertBefore(caja, error);
                }

                pintar();
                conectarNombre();
                if (f.modo === "nuevo") { conectarCodigo(); conectarCatalogoPorNombre(); resultadosCatalogo = []; adaptarFormularioAlGiro(f); } else pedirSugerencia();

                // Lugar donde se va a poner (solo producto nuevo y si el inventario de tienda esta cargado).
                if (f.modo === "nuevo" && window.NexoMovil?.elegirLugar) {
                    if (!fijarLugar) lugar = null;

                    if (error && !document.getElementById("daiLugar")) {
                        const caja = document.createElement("section");
                        caja.id = "daiLugar";
                        caja.className = "dai-seccion";
                        error.parentNode.insertBefore(caja, document.getElementById("daiSeccion"));
                    }

                    pintarLugar();
                }
            }

            return resultado;
        };
    }

    // Si el nombre se llena solo (escaneo + catalogo maestro), tambien se busca la sugerencia.
    const autollenado = window.autollenarDesdeMaestroDueno;

    if (typeof autollenado === "function") {
        window.autollenarDesdeMaestroDueno = async function (...argumentos) {
            const resultado = await autollenado.apply(this, argumentos);
            pedirSugerencia();
            return resultado;
        };
    }
})();
