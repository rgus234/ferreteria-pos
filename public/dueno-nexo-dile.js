/* "Dile a Nexo" en el celular: una barra para escribir o dictar ("agrega pijas de 1 pulgada a 85 la bolsa en el estante 2", "pon los refrescos
   en el refri", "¿dónde está el arroz?") que se manda al chat de Nexo IA, y tarjetas de CONFIRMACIÓN para lo que Nexo deja preparado:
   un producto nuevo (con la configuración sugerida y su lugar) o el movimiento de un producto a otro lugar. Nexo nunca guarda nada solo:
   solo se crea o se mueve cuando tocas "Confirmar". Usa /ia/chat (ia-server.js), /agregar-producto y /ubicaciones/:id/asignar. */

(function () {
    const N = () => window.NexoMovil;
    const esc = valor => (typeof escaparDueno === "function" ? escaparDueno(valor) : String(valor ?? ""));
    const dinero2 = valor => (typeof dinero === "function" ? dinero(valor) : "$" + Number(valor || 0).toFixed(2));

    // ---- El chat del celular ahora lee la respuesta en vivo (NDJSON) ----
    // /ia/chat responde en lineas JSON ({tipo:"texto"|"final"|"error"}) salvo las respuestas instantaneas (un JSON normal). El chat de /dueno
    // solo sabia leer el JSON normal, asi que las preguntas que pasaban por el modelo salian como "Nexo no pudo responder". Aqui se leen las dos
    // formas, y de la linea "final" sale la "accion" (borrador de producto o movimiento) para pintar su tarjeta de confirmacion.
    function encabezadosAuth() {
        const dispositivo = typeof dispositivoTokenGuardado === "function" ? dispositivoTokenGuardado() : "";
        const empleado = typeof empleadoActivoGuardado === "function" ? empleadoActivoGuardado() : null;

        return dispositivo && empleado
            ? { "x-dispositivo-token": dispositivo, "x-empleado-id": String(empleado.id) }
            : { Authorization: `Bearer ${typeof tokenGuardado === "function" ? tokenGuardado() : ""}` };
    }

    // Procesa una linea del stream; regresa true si ya llego la linea final o un error.
    function lineaDeStream(linea, estado) {
        let dato = null;

        try { dato = JSON.parse(linea); } catch (error) { return false; }

        if (dato.tipo === "texto" && dato.delta) {
            estado.texto += dato.delta;

            if (!estado.burbuja) { estado.indicador?.remove(); estado.burbuja = agregarMensajeNexoDueno("", "asistente"); }

            estado.burbuja.textContent = estado.texto;
            document.getElementById("duenoNexoMensajes").scrollTop = 1e9;
            return false;
        }

        if (dato.tipo === "final") { estado.accion = dato.accion || null; estado.conversacionId = dato.conversacionId || estado.conversacionId; return true; }
        if (dato.tipo === "error") { estado.error = dato.mensaje || "Nexo no pudo responder."; return true; }

        return false;
    }

    async function leerStream(respuesta, estado) {
        const lector = respuesta.body.getReader();
        const decodificador = new TextDecoder("utf-8");
        let buffer = "";

        for (;;) {
            const { done, value } = await lector.read();

            if (done) break;

            buffer += decodificador.decode(value, { stream: true });

            let corte;
            while ((corte = buffer.indexOf("\n")) >= 0) {
                const linea = buffer.slice(0, corte).trim();
                buffer = buffer.slice(corte + 1);
                if (linea) lineaDeStream(linea, estado);
            }
        }

        if (buffer.trim()) lineaDeStream(buffer.trim(), estado);
    }

    window.enviarMensajeNexoDueno = async function () {
        if (duenoNexoEnviando) return;

        const input = document.getElementById("duenoNexoInput");
        const mensaje = (input?.value || "").trim();

        if (!mensaje) return;

        input.value = "";
        document.querySelector(".dueno-nexo-sugerencias")?.remove();
        agregarMensajeNexoDueno(mensaje, "usuario");

        const estado = { texto: "", burbuja: null, indicador: agregarMensajeNexoDueno("Nexo esta pensando...", "pensando"), accion: null, conversacionId: null, error: "" };
        const boton = document.getElementById("duenoNexoEnviar");

        duenoNexoEnviando = true;
        if (boton) boton.disabled = true;

        try {
            const respuesta = await fetch("/ia/chat", { method: "POST", headers: { "Content-Type": "application/json", ...encabezadosAuth() }, body: JSON.stringify({ mensaje, conversacionId: duenoNexoConversacionId }) });
            const tipo = respuesta.headers.get("content-type") || "";

            if (tipo.includes("ndjson") && respuesta.body) {
                await leerStream(respuesta, estado);
            } else {
                const datos = await respuesta.json().catch(() => null);

                if (!respuesta.ok || !datos?.ok) estado.error = datos?.error || (respuesta.status === 401 ? "Tu sesión venció. Entra de nuevo." : "Nexo no pudo responder. Intenta de nuevo.");
                else { estado.texto = datos.respuesta || ""; estado.conversacionId = datos.conversacionId || null; estado.indicador?.remove(); estado.burbuja = agregarMensajeNexoDueno(estado.texto, "asistente"); }
            }

            estado.indicador?.remove();

            if (estado.error && !estado.texto) { agregarMensajeNexoDueno(estado.error, "error"); return; }
            if (estado.error) agregarMensajeNexoDueno(estado.error, "error");

            duenoNexoHistorial.push({ rol: "user", contenido: mensaje });
            duenoNexoHistorial.push({ rol: "assistant", contenido: estado.texto });
            if (estado.conversacionId) duenoNexoConversacionId = estado.conversacionId;
            if (estado.accion) pintarTarjeta(estado.accion);
        } catch (error) {
            estado.indicador?.remove();
            agregarMensajeNexoDueno(error instanceof TypeError ? "No se pudo conectar con Nexo. Revisa tu conexion." : (error.message || "Nexo no pudo responder. Intenta de nuevo."), "error");
        } finally {
            duenoNexoEnviando = false;

            const botonFinal = document.getElementById("duenoNexoEnviar");
            if (botonFinal) botonFinal.disabled = false;
        }
    };

    function ponerTarjeta(html, clase = "") {
        const lista = document.getElementById("duenoNexoMensajes");

        if (!lista) return null;

        const tarjeta = document.createElement("div");
        tarjeta.className = `dueno-nexo-mensaje asistente dnx-tarjeta ${clase}`;
        tarjeta.innerHTML = html;
        lista.appendChild(tarjeta);
        lista.scrollTop = lista.scrollHeight;

        return tarjeta;
    }

    function pintarTarjeta(accion) {
        if (accion.tipo === "preparar_movimiento") return tarjetaMovimiento(accion.datos);

        if (accion.tipo === "preparar_creacion" && accion.datosCreacion?.tipo === "producto") return tarjetaProducto(accion.datosCreacion.datos);

        if (accion.tipo === "preparar_creacion" && accion.datosCreacion?.tipo === "cliente_credito") return tarjetaCliente(accion.datosCreacion.datos);
    }

    // ---- Mover un producto ----
    function tarjetaMovimiento(d) {
        const t = ponerTarjeta(`<b>Voy a mover este producto</b>
            <div class="dnx-fila"><span>Producto</span><b>${esc(d.producto)}</b></div>
            <div class="dnx-fila"><span>De</span><b>${esc(d.desde)}</b></div>
            <div class="dnx-fila"><span>A</span><b>${esc(d.lugarRuta)}</b></div>
            <div class="dnx-botones"><button type="button" data-a="no">Cancelar</button><button type="button" class="dnx-si" data-a="si">Confirmar</button></div>`);

        t?.addEventListener("click", async ev => {
            const a = ev.target.dataset?.a;

            if (!a) return;

            if (a === "no") { cerrarTarjeta(t, "Listo, no lo muevo."); return; }

            t.querySelectorAll("button").forEach(b => { b.disabled = true; });

            try {
                await fetchAutenticado(`/ubicaciones/${d.lugarId}/asignar`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ productoIds: [d.productoId] }) });

                if (d.zona === "bodega" && N()) {
                    const q = await N().dialogo({ titulo: "¿Cuántas piezas hay aquí?", texto: "Cantidad de este producto en esa sección de bodega.", campo: { tipo: "number", valor: "0" }, aceptar: "Anotar" });
                    if (q.ok && Number(q.valor) > 0) await fetchAutenticado(`/ubicaciones/${d.lugarId}/bodega`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ productoId: d.productoId, cantidad: Number(q.valor) }) });
                }

                if (typeof refrescarCatalogoLocalDueno === "function") refrescarCatalogoLocalDueno().catch(() => {});
                cerrarTarjeta(t, `Listo: ${d.producto} ahora está en ${d.lugarRuta}.`);
            } catch (error) {
                t.querySelectorAll("button").forEach(b => { b.disabled = false; });
                if (typeof mostrarToastDueno === "function") mostrarToastDueno(error.message || "No se pudo mover.");
            }
        });
    }

    function cerrarTarjeta(tarjeta, texto) {
        tarjeta.classList.add("dnx-hecha");
        tarjeta.innerHTML = `<span>${esc(texto)}</span>`;
    }

    // ---- Producto nuevo ----
    function filasConfig(d) {
        const c = d.config;

        if (!c) return `<div class="dnx-fila"><span>Cómo se vende</span><b>Pieza (sin parecidos para sugerir)</b></div>`;

        const compra = c.presentacionCompra ? `se compra por ${String(c.presentacionCompra).toLowerCase()}${c.factorConversion ? " de " + c.factorConversion : ""}` : "se compra por pieza";
        const venta = `se vende por ${c.unidadVenta}${c.permiteVentaPieza ? " y por pieza suelta" : ""}`;

        return `<div class="dnx-fila"><span>${d.origenConfig === "sugerida" ? "Sugerido" : "Configuración"}</span><b>${esc(compra)} · ${esc(venta)}</b></div>${d.resumenConfig ? `<small>${esc(d.resumenConfig)}</small>` : ""}`;
    }

    function tarjetaProducto(d) {
        const puedeCrear = Number(d.precio) > 0;
        const t = ponerTarjeta(`<b>Voy a crear este producto</b>
            <div class="dnx-fila"><span>Nombre</span><b>${esc(d.nombre)}</b></div>
            ${d.codigo ? `<div class="dnx-fila"><span>Código</span><b>${esc(d.codigo)}</b></div>` : ""}
            <div class="dnx-fila"><span>Precio</span><b>${puedeCrear ? dinero2(d.precio) : "Falta el precio"}</b></div>
            ${d.precioMayoreo > 0 ? `<div class="dnx-fila"><span>Medio mayoreo</span><b>${dinero2(d.precioMayoreo)}</b></div>` : ""}
            ${d.stock > 0 ? `<div class="dnx-fila"><span>Existencias</span><b>${esc(d.stock)}</b></div>` : ""}
            ${filasConfig(d)}
            ${d.lugarRuta ? `<div class="dnx-fila"><span>Lugar</span><b>${esc(d.lugarRuta)}</b></div>` : ""}
            ${d.lugarNoEncontrado ? `<small class="dnx-aviso">No encontré el lugar "${esc(d.lugarNoEncontrado)}": se crea sin lugar y lo eliges después.</small>` : ""}
            <div class="dnx-botones"><button type="button" data-a="no">Cancelar</button><button type="button" data-a="revisar">Revisar</button>${puedeCrear ? `<button type="button" class="dnx-si" data-a="si">Crear</button>` : ""}</div>`);

        t?.addEventListener("click", async ev => {
            const a = ev.target.dataset?.a;

            if (!a) return;

            if (a === "no") { cerrarTarjeta(t, "Listo, no lo creo."); return; }
            if (a === "revisar") { abrirFormulario(d); return; }

            t.querySelectorAll("button").forEach(b => { b.disabled = true; });

            try {
                await crearProducto(d);
                cerrarTarjeta(t, `Listo: "${d.nombre}" creado${d.lugarRuta ? " en " + d.lugarRuta : ""}.`);
            } catch (error) {
                t.querySelectorAll("button").forEach(b => { b.disabled = false; });
                if (typeof mostrarToastDueno === "function") mostrarToastDueno(error.message || "No se pudo crear el producto.");
            }
        });
    }

    async function crearProducto(d) {
        const cuerpo = { nombre: d.nombre, precio: d.precio, precioPublico: d.precio, stock: d.stock || 0, stockMinimo: d.stockMinimo ?? 3, codigo: d.codigo || "", unidadVenta: d.config?.unidadVenta || "pieza" };

        if (d.precioMayoreo > 0) cuerpo.precioMayoreo = d.precioMayoreo;

        if (d.config) {
            cuerpo.presentacionCompra = d.config.presentacionCompra || "";
            cuerpo.permiteVentaPieza = Boolean(d.config.permiteVentaPieza);
            if (d.config.factorConversion) { cuerpo.factorConversion = d.config.factorConversion; if (cuerpo.permiteVentaPieza) cuerpo.piezasPorBolsa = d.config.factorConversion; }
        }

        const creado = await fetchAutenticado("/agregar-producto", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(cuerpo) });
        const productoId = creado.productoId;

        if (d.lugarId && productoId) {
            await fetchAutenticado(`/ubicaciones/${d.lugarId}/asignar`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ productoIds: [productoId] }) });

            if (d.zona === "bodega" && d.stock > 0) await fetchAutenticado(`/ubicaciones/${d.lugarId}/bodega`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ productoId, cantidad: d.stock }) });
        }

        if (typeof refrescarCatalogoLocalDueno === "function") refrescarCatalogoLocalDueno().catch(() => {});
    }

    // "Revisar": abre el formulario completo ya con lo que dijo la persona (y su lugar), para ajustar lo que haga falta.
    function abrirFormulario(d) {
        if (typeof cerrarNexoChatDueno === "function") cerrarNexoChatDueno();
        if (typeof abrirFormularioProductoDueno !== "function") return;

        abrirFormularioProductoDueno(null, { codigo: d.codigo || "" });

        setTimeout(() => {
            const poner = (id, valor) => { const campo = document.getElementById(id); if (campo && valor !== null && valor !== undefined && valor !== "" && !(typeof valor === "number" && !(valor > 0))) { campo.value = valor; campo.dispatchEvent(new Event("input", { bubbles: true })); } };

            poner("duenoProdNombre", d.nombre);
            poner("duenoProdPrecioPublico", d.precio);
            poner("duenoProdPrecioMayoreo", d.precioMayoreo);
            poner("duenoProdStock", d.stock);
            poner("duenoProdStockMinimo", d.stockMinimo);

            if (d.lugarId && typeof window.daiPonerLugar === "function") window.daiPonerLugar({ id: d.lugarId, nombre: d.lugar, ruta: d.lugarRuta, zona: d.zona, codigo: "" });
        }, 250);
    }

    // ---- Cliente de credito ----
    function tarjetaCliente(d) {
        const t = ponerTarjeta(`<b>Voy a crear este cliente de crédito</b>
            <div class="dnx-fila"><span>Nombre</span><b>${esc(d.nombre)}</b></div>
            ${d.telefono ? `<div class="dnx-fila"><span>Teléfono</span><b>${esc(d.telefono)}</b></div>` : ""}
            ${d.limiteCredito > 0 ? `<div class="dnx-fila"><span>Límite</span><b>${dinero2(d.limiteCredito)}</b></div>` : ""}
            <div class="dnx-botones"><button type="button" data-a="no">Cancelar</button><button type="button" class="dnx-si" data-a="si">Crear</button></div>`);

        t?.addEventListener("click", async ev => {
            const a = ev.target.dataset?.a;

            if (!a) return;
            if (a === "no") { cerrarTarjeta(t, "Listo, no lo creo."); return; }

            t.querySelectorAll("button").forEach(b => { b.disabled = true; });

            try {
                await fetchAutenticado("/creditos/clientes", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ nombre: d.nombre, telefono: d.telefono || null, limiteCredito: d.limiteCredito || 0 }) });
                cerrarTarjeta(t, `Listo: cliente "${d.nombre}" creado.`);
            } catch (error) {
                t.querySelectorAll("button").forEach(b => { b.disabled = false; });
                if (typeof mostrarToastDueno === "function") mostrarToastDueno(error.message || "No se pudo crear el cliente.");
            }
        });
    }

    // ---- Barra "Dile a Nexo" (escribir o dictar) en Inicio y en el panel de Inventario ----
    const reconocimiento = window.SpeechRecognition || window.webkitSpeechRecognition;
    const EJEMPLOS = ["¿Dónde está el arroz?", "Pon los refrescos en el refrigerador", "Agrega pijas de 1 pulgada a 85 la bolsa"];

    function dile(texto) {
        const mensaje = String(texto || "").trim();

        if (!mensaje) return;

        if (typeof abrirNexoChatDueno === "function") abrirNexoChatDueno();

        const campo = document.getElementById("duenoNexoInput");

        if (campo) { campo.value = mensaje; if (typeof enviarMensajeNexoDueno === "function") enviarMensajeNexoDueno(); }
    }

    window.dnxEnviar = function (id) {
        const campo = document.getElementById(id);
        const texto = campo ? campo.value : "";

        if (campo) campo.value = "";
        dile(texto);
    };

    window.dnxEjemplo = function (i) { dile(EJEMPLOS[i]); };

    // Dictado: donde el navegador lo permite (en iPhone, si no, se usa el microfono del teclado).
    window.dnxDictar = function (id, boton) {
        const campo = document.getElementById(id);

        if (!reconocimiento) { if (typeof mostrarToastDueno === "function") mostrarToastDueno("Toca el micrófono de tu teclado para dictar."); campo?.focus(); return; }

        try {
            const r = new reconocimiento();
            r.lang = "es-MX";
            r.interimResults = false;
            r.onstart = () => boton?.classList.add("escuchando");
            r.onend = () => boton?.classList.remove("escuchando");
            r.onerror = () => { boton?.classList.remove("escuchando"); if (typeof mostrarToastDueno === "function") mostrarToastDueno("No pude escucharte. Toca el micrófono de tu teclado para dictar."); campo?.focus(); };
            r.onresult = ev => { const texto = ev.results[0]?.[0]?.transcript || ""; if (campo) campo.value = texto; window.dnxEnviar(id); };
            r.start();
        } catch (error) {
            campo?.focus();
        }
    };

    function barraHtml(id) {
        return `<div class="dnx-barra">
            <div class="dnx-barra-campo">
                <input id="${id}" type="text" placeholder="Dile a Nexo… (ej. ¿dónde está el arroz?)" autocomplete="off" enterkeyhint="send" onkeydown="if(event.key==='Enter') dnxEnviar('${id}')">
                <button type="button" class="dnx-mic" onclick="dnxDictar('${id}', this)" aria-label="Dictar"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 10v1a7 7 0 0 0 14 0v-1M12 18v4"/></svg></button>
                <button type="button" class="dnx-enviar" onclick="dnxEnviar('${id}')" aria-label="Enviar">→</button>
            </div>
            <div class="dnx-ejemplos">${EJEMPLOS.map((e, i) => `<button type="button" onclick="dnxEjemplo(${i})">${esc(e)}</button>`).join("")}</div>
        </div>`;
    }

    function insertarBarras() {
        const sitios = [["duenoApp", ".dueno-header", "dnxInicio"], ["duenoInventario", ".dueno-header", "dnxInventario"]];

        sitios.forEach(([pantalla, ancla, id]) => {
            const p = document.getElementById(pantalla);

            if (!p || p.querySelector(".dnx-barra")) return;

            const cont = document.createElement("div");
            cont.innerHTML = barraHtml(id);
            (p.querySelector(ancla) || p.firstElementChild)?.insertAdjacentElement("afterend", cont.firstElementChild);
        });
    }

    ["cargarPanelDueno", "cargarPanelInventarioDueno"].forEach(nombre => {
        const original = window[nombre];

        if (typeof original !== "function") return;

        window[nombre] = function (...argumentos) {
            const resultado = original.apply(this, argumentos);
            insertarBarras();
            return resultado;
        };
    });

    document.addEventListener("DOMContentLoaded", insertarBarras);
    insertarBarras();
})();
