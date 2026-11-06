/* Recargas de tiempo aire (Recargas): el cajero elige compañia, escribe el numero, elige el monto y recarga.

   Hoy corre en MODO DEMOSTRACION: no se recarga ni se cobra nada de verdad; el saldo y el historial viven solo en este equipo, para poder ver y
   probar la pantalla completa. Cuando lleguen las claves del proveedor se cambia solo el "adaptador" (ver ADAPTADOR_DEMO): la pantalla no cambia.
   Solo con la funcion nueva "recargas" encendida. */

(function () {
    const LLAVE = "nexoRecargasDemo";
    const TOPE_MONTO = 500;

    // Colores de marca aproximados: sirven para tintar la pantalla segun la compañia elegida (no son logotipos).
    const OPERADORAS = [
        { id: "telcel", nombre: "Telcel", sigla: "T", color: "#0a6dd8", tinta: "#fff", comision: 4, montos: [10, 20, 30, 50, 80, 100, 150, 200, 300, 500] },
        { id: "att", nombre: "AT&T", sigla: "A", color: "#00a3e0", tinta: "#fff", comision: 4, montos: [10, 20, 30, 50, 70, 100, 120, 150, 200, 300] },
        { id: "movistar", nombre: "Movistar", sigla: "M", color: "#0b9b3a", tinta: "#fff", comision: 4, montos: [10, 20, 30, 50, 60, 80, 100, 120, 150, 200, 300, 500] },
        { id: "unefon", nombre: "Unefon", sigla: "U", color: "#f2c200", tinta: "#1f1700", comision: 4, montos: [10, 20, 30, 50, 70, 100, 120, 150, 200, 300] },
        { id: "bait", nombre: "Bait", sigla: "B", color: "#ffb800", tinta: "#1f1700", comision: 4, montos: [30, 50, 60, 100, 120, 125, 135, 200, 230, 250, 300, 349, 500] },
        { id: "virgin", nombre: "Virgin", sigla: "V", color: "#d4112a", tinta: "#fff", comision: 4, montos: [10, 20, 30, 40, 50, 100, 150, 200, 300, 500] },
        { id: "weex", nombre: "Weex", sigla: "W", color: "#7c3aed", tinta: "#fff", comision: 4, montos: [10, 20, 30, 40, 50, 60, 70, 80, 100, 120, 150, 200, 250, 300, 500] },
        { id: "otra", nombre: "Otra", sigla: "+", color: "#475569", tinta: "#fff", comision: 4, montos: [10, 20, 30, 50, 100, 150, 200, 300, 500] }
    ];

    const esc = valor => String(valor ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
    const dinero = valor => "$" + Number(valor || 0).toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const entero = valor => "$" + Number(valor || 0).toLocaleString("es-MX", { maximumFractionDigits: 0 });
    // Ids de compañia de Taecel (los mismos que en recargas-server.js). Cualquier otra compañia de tiempo aire se maneja como "c<id>".
    const CARRIER_IDS = { telcel: "1", movistar: "2", att: "5", unefon: "4", bait: "239", virgin: "11", weex: "93" };
    let catalogo = null; // { productos, carriers } de Taecel; solo con conexion real (en demostracion es null)

    const carrierIdDe = id => CARRIER_IDS[id] || (/^c\d+$/.test(id || "") ? String(id).slice(1) : null);
    const productosDe = carrierId => (catalogo ? catalogo.productos.filter(p => p.carrierId === carrierId).sort((a, b) => a.monto - b.monto) : []);

    function operadora(id) {
        const base = OPERADORAS.find(o => o.id === id) || null;

        if (!catalogo) return base;

        const carrierId = carrierIdDe(id);
        const carrier = carrierId ? catalogo.carriers.find(c => c.id === carrierId) : null;
        const montos = carrierId ? [...new Set(productosDe(carrierId).map(p => p.monto))] : [];

        if (base && base.id === "otra") return { ...base, montos: [] };
        if (base) return { ...base, comision: carrier ? carrier.comision : base.comision, montos: montos.length ? montos : base.montos };
        if (!carrier) return null;

        return { id, nombre: carrier.nombre, sigla: carrier.nombre.charAt(0).toUpperCase(), color: "#475569", tinta: "#fff", comision: carrier.comision, montos };
    }

    const esElegida = id => eleg.operadora === id || (id === "otra" && /^c\d+$/.test(eleg.operadora));
    const redondear = valor => Math.round((Number(valor) + Number.EPSILON) * 100) / 100;

    const formatoNumero = d => (d.length <= 3 ? d : d.length <= 6 ? `(${d.slice(0, 3)}) ${d.slice(3)}` : `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6, 10)}`);
    const soloDigitos = texto => String(texto || "").replace(/\D/g, "").slice(0, 10);

    function hace(t) {
        const minutos = Math.floor((Date.now() - t) / 60000);
        if (minutos < 1) return "ahora";
        if (minutos < 60) return `hace ${minutos} min`;
        const horas = Math.floor(minutos / 60);
        return horas < 24 ? `hace ${horas} h` : new Date(t).toLocaleDateString("es-MX", { day: "numeric", month: "short" });
    }

    // ------------------------------------------------------------------
    // Adaptador: AQUI es donde se conecta el proveedor real (Taecel). La pantalla solo habla con estas tres funciones.
    // ------------------------------------------------------------------
    const ADAPTADOR_DEMO = {
        modo: "demostracion",

        leer() {
            try {
                const datos = JSON.parse(localStorage.getItem(LLAVE) || "null");
                if (datos && typeof datos.saldo === "number" && Array.isArray(datos.historial)) return datos;
            } catch (error) { /* sin datos: se crean de ejemplo */ }

            const ahora = Date.now();
            const base = {
                saldo: 2480,
                historial: [
                    { id: "d3", operadora: "telcel", numero: "4421234567", monto: 50, comision: 2, estado: "exitosa", t: ahora - 14 * 60000, folio: "DM-100423" },
                    { id: "d2", operadora: "att", numero: "4429876543", monto: 100, comision: 4.5, estado: "exitosa", t: ahora - 52 * 60000, folio: "DM-100422" },
                    { id: "d1", operadora: "bait", numero: "4425550199", monto: 30, comision: 1.5, estado: "exitosa", t: ahora - 3 * 3600000, folio: "DM-100421" }
                ]
            };

            this.guardar(base);
            return base;
        },

        guardar(datos) { try { localStorage.setItem(LLAVE, JSON.stringify(datos)); } catch (error) { /* sin almacenamiento */ } },

        async estado() { await pausa(250); return this.leer(); },

        async recargar({ operadora: id, numero, monto }) {
            await pausa(1700);

            const datos = this.leer();
            const o = operadora(id);

            if (monto > datos.saldo) return { ok: false, error: "Saldo insuficiente. Agrega saldo para seguir recargando." };

            const registro = { id: `d${Date.now()}`, operadora: id, numero, monto, comision: redondear(monto * (o.comision / 100)), estado: "exitosa", t: Date.now(), folio: `DM-${100000 + Math.floor(Math.random() * 899999)}` };

            datos.saldo = redondear(datos.saldo - monto + registro.comision);
            datos.historial.unshift(registro);
            datos.historial = datos.historial.slice(0, 60);
            this.guardar(datos);

            return { ok: true, registro, saldo: datos.saldo };
        },

        async agregarSaldo(monto) {
            await pausa(500);
            const datos = this.leer();
            datos.saldo = redondear(datos.saldo + monto);
            this.guardar(datos);
            return { ok: true, saldo: datos.saldo };
        },

        reiniciar() { try { localStorage.removeItem(LLAVE); } catch (error) { /* nada */ } }
    };

    // El servidor de Nexo habla con Taecel (la pantalla nunca ve el key ni el nip): ver recargas-server.js.
    const ADAPTADOR_REAL = {
        modo: "real",
        cache: { saldo: 0, historial: [] },

        leer() { return this.cache; },

        async llamar(ruta, opciones) {
            const respuesta = await fetch(ruta, opciones);
            const cuerpo = await respuesta.json().catch(() => ({}));
            return { estado: respuesta.status, cuerpo };
        },

        async estado() {
            const [saldo, historial] = await Promise.all([this.llamar("/recargas/saldo"), this.llamar("/recargas/historial")]);

            this.cache = {
                saldo: saldo.cuerpo.ok ? Number(saldo.cuerpo.saldoRecargas || 0) : this.cache.saldo,
                historial: historial.cuerpo.ok ? historial.cuerpo.recargas : this.cache.historial,
                sinSaldo: !saldo.cuerpo.ok
            };

            return this.cache;
        },

        async recargar({ operadora: id, numero, monto }) {
            const token = (window.crypto && crypto.randomUUID ? crypto.randomUUID() : `t${Date.now()}${Math.random().toString(36).slice(2)}`).replace(/[^A-Za-z0-9_-]/g, "");
            const { cuerpo } = await this.llamar("/recargas/recargar", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token, operadora: id, numero, monto }) });

            if (cuerpo.ok && cuerpo.recarga) return { ok: true, registro: cuerpo.recarga };
            if (cuerpo.pendiente && cuerpo.recarga) return { ok: false, pendiente: true, registro: cuerpo.recarga, error: cuerpo.error };

            return { ok: false, error: cuerpo.error || "No se pudo completar la recarga." };
        },

        async consultar(idRecarga) {
            const { cuerpo } = await this.llamar(`/recargas/${idRecarga}`);
            return cuerpo.ok ? cuerpo.recarga : null;
        },

        async agregarSaldo() { return { ok: false, real: true }; },

        reiniciar() { /* nada: el historial vive en el servidor */ }
    };

    function pausa(ms) { return new Promise(resolver => setTimeout(resolver, ms)); }

    let adaptador = ADAPTADOR_DEMO;
    let modoPantalla = "demostracion"; // demostracion | pruebas | produccion

    // ------------------------------------------------------------------
    // Estado de la pantalla
    // ------------------------------------------------------------------
    let datos = { saldo: 0, historial: [] };
    let pestana = "recargas"; // recargas | historial | servicios
    let eleg = { operadora: null, numero: "", monto: null, otro: "" };
    let fase = "captura"; // captura | enviando | listo
    let resultado = null; // { ok, registro } | { ok:false, error }
    let error = "";

    const pantalla = () => document.getElementById("pantallaRecargas");
    const montoElegido = () => (eleg.otro !== "" ? Math.floor(Number(eleg.otro) || 0) : eleg.monto || 0);
    const hoy = () => datos.historial.filter(r => new Date(r.t).toDateString() === new Date().toDateString() && r.estado === "exitosa");

    function validar() {
        const o = operadora(eleg.operadora);
        const monto = montoElegido();

        if (!o || (catalogo && o.id === "otra")) return "Elige la compañía.";
        if (eleg.numero.length !== 10) return "El número lleva 10 dígitos.";
        if (!monto || monto < 10) return "Elige un monto (desde $10).";
        if (monto > TOPE_MONTO) return `El monto máximo es ${entero(TOPE_MONTO)}.`;
        if (catalogo && !o.montos.includes(monto)) return "Ese monto no está disponible para esa compañía.";
        if (monto > datos.saldo) return "Saldo insuficiente.";
        return "";
    }

    window.mostrarRecargas = async function () {
        if (typeof ocultarPantallasPrincipales === "function") ocultarPantallasPrincipales();

        const raiz = pantalla();
        if (!raiz) return;

        raiz.style.display = "block";
        if (typeof actualizarTopbarContexto === "function") actualizarTopbarContexto("Recargas", "Tiempo aire en segundos", "recargas");

        try {
            const r = await fetch("/recargas/modo");
            const cuerpo = await r.json();
            modoPantalla = cuerpo.ok && ["pruebas", "produccion"].includes(cuerpo.modo) ? cuerpo.modo : "demostracion";
        } catch (error) { modoPantalla = "demostracion"; }

        adaptador = modoPantalla === "demostracion" ? ADAPTADOR_DEMO : ADAPTADOR_REAL;

        catalogo = null;

        if (modoPantalla !== "demostracion") {
            try {
                const respuesta = await fetch("/recargas/productos");
                const cuerpo = await respuesta.json();
                catalogo = cuerpo.ok && cuerpo.productos?.length ? { productos: cuerpo.productos, carriers: cuerpo.carriers || [] } : null;
            } catch (error) { catalogo = null; }
        }

        datos = await adaptador.estado();
        if (fase === "enviando") fase = "captura";
        pintar();
        raiz.querySelector("#rcNumero")?.focus();
    };

    // ------------------------------------------------------------------
    // Piezas
    // ------------------------------------------------------------------
    function etiquetaModo() {
        if (modoPantalla === "produccion") return `<span class="rc-demo rc-vivo" title="Conectado a Taecel">● Conectado a Taecel</span>`;
        if (modoPantalla === "pruebas") return `<span class="rc-demo" title="Ambiente de pruebas de Taecel">● Taecel · pruebas</span>`;
        return `<span class="rc-demo" title="No se recarga ni se cobra nada de verdad">● Modo demostración</span>`;
    }

    function notaModo() {
        if (modoPantalla === "produccion") return "";
        if (modoPantalla === "pruebas") return `<small class="rc-nota">Ambiente de pruebas de Taecel: no se cobra dinero real.</small>`;
        return `<small class="rc-nota">Modo demostración: no se recarga ni se cobra nada de verdad.</small>`;
    }
    function tarjetaSaldo() {
        const bajo = datos.saldo < 500;
        const hoyLista = hoy();
        const ganancia = redondear(hoyLista.reduce((s, r) => s + r.comision, 0));
        const vendido = hoyLista.reduce((s, r) => s + r.monto, 0);
        const porcentaje = Math.max(4, Math.min(100, Math.round((datos.saldo / 3000) * 100)));

        return `<section class="rc-saldo ${bajo ? "rc-bajo" : ""}">
            <div class="rc-saldo-brillo" aria-hidden="true"></div>
            <div class="rc-saldo-izq">
                <span class="rc-etiqueta">Saldo de recargas</span>
                <strong class="rc-saldo-monto">${dinero(datos.saldo)}</strong>
                <div class="rc-barra" aria-hidden="true"><i style="width:${porcentaje}%"></i></div>
                <small>${bajo ? "⚠ Tu saldo está bajo: agrega para no quedarte sin recargar." : "Saldo suficiente para varias recargas."}</small>
            </div>
            <div class="rc-saldo-der">
                <div class="rc-mini"><span>Vendido hoy</span><b>${entero(vendido)}</b></div>
                <div class="rc-mini rc-mini-verde"><span>Ganancia hoy</span><b>${dinero(ganancia)}</b></div>
                <div class="rc-mini"><span>Recargas hoy</span><b>${hoyLista.length}</b></div>
            </div>
            <button type="button" class="rc-agregar" data-rc="saldo">+ Agregar saldo</button>
        </section>`;
    }

    function pasoOperadora() {
        return `<section class="rc-paso">
            <h3><span>1</span>Compañía</h3>
            <div class="rc-operadoras" role="radiogroup" aria-label="Compañía">
                ${OPERADORAS.map(o => `<button type="button" role="radio" aria-checked="${esElegida(o.id)}" class="rc-op ${esElegida(o.id) ? "rc-sel" : ""}" data-rc="operadora" data-id="${o.id}" style="--rc-color:${o.color};--rc-tinta:${o.tinta}"><i>${esc(o.sigla)}</i><span>${esc(o.nombre)}</span></button>`).join("")}
            </div>
            ${otrasCompanias()}
        </section>`;
    }

    function otrasCompanias() {
        if (!catalogo || !(eleg.operadora === "otra" || /^c\d+$/.test(eleg.operadora))) return "";

        const principales = Object.values(CARRIER_IDS);
        const otras = catalogo.carriers.filter(c => !principales.includes(c.id)).sort((a, b) => a.nombre.localeCompare(b.nombre));

        return `<select id="rcOtraCarrier" class="rc-select" aria-label="Elige la compañía"><option value="">Elige la compañía…</option>${otras.map(c => `<option value="c${esc(c.id)}" ${eleg.operadora === "c" + c.id ? "selected" : ""}>${esc(c.nombre)}</option>`).join("")}</select>`;
    }

    function pasoNumero() {
        const frecuentes = [];
        datos.historial.forEach(r => { if (!frecuentes.find(f => f.numero === r.numero) && frecuentes.length < 4) frecuentes.push(r); });

        return `<section class="rc-paso">
            <h3><span>2</span>Número de celular</h3>
            <div class="rc-numero ${eleg.numero.length === 10 ? "rc-ok" : ""}">
                <span class="rc-lada">🇲🇽 +52</span>
                <input id="rcNumero" style="background:transparent !important;border:0 !important;box-shadow:none !important;padding:0" type="tel" inputmode="numeric" autocomplete="off" placeholder="(442) 123-4567" maxlength="14" value="${esc(formatoNumero(eleg.numero))}" aria-label="Número de celular a 10 dígitos">
                <i class="rc-check" aria-hidden="true">✓</i>
            </div>
            ${frecuentes.length ? `<div class="rc-frecuentes"><small>Recientes</small>${frecuentes.map(f => `<button type="button" data-rc="frecuente" data-numero="${esc(f.numero)}" data-op="${esc(f.operadora)}"><b style="background:${operadora(f.operadora)?.color || "#475569"}"></b>${esc(formatoNumero(f.numero))}</button>`).join("")}</div>` : ""}
        </section>`;
    }

    function productoElegido() {
        const carrierId = carrierIdDe(eleg.operadora);
        return catalogo && carrierId ? productosDe(carrierId).find(p => p.monto === montoElegido()) || null : null;
    }

    function pasoMonto() {
        const o = operadora(eleg.operadora);
        const montos = o ? o.montos : [10, 20, 30, 50, 100, 150, 200, 300, 500];
        const carrierId = carrierIdDe(eleg.operadora);
        const producto = m => (catalogo && carrierId ? productosDe(carrierId).find(p => p.monto === m) : null);
        const libre = !catalogo; // con Taecel solo existen los montos del catalogo de cada compañía

        return `<section class="rc-paso">
            <h3><span>3</span>Monto</h3>
            ${!montos.length ? `<p class="rc-vacio">Elige la compañía para ver sus montos.</p>` : ""}
            <div class="rc-montos">
                ${montos.map(m => { const p = producto(m); return `<button type="button" class="rc-monto ${eleg.otro === "" && eleg.monto === m ? "rc-sel" : ""}" data-rc="monto" data-monto="${m}"${p && p.descripcion ? ` title="${esc(p.descripcion)}"` : ""}>${entero(m)}${p && p.vigencia ? `<small>${esc(p.vigencia.toLowerCase())}</small>` : ""}</button>`; }).join("")}
                ${libre ? `<label class="rc-otro ${eleg.otro !== "" ? "rc-sel" : ""}"><span>Otro</span><input id="rcOtro" style="background:transparent !important;border:0 !important;box-shadow:none !important;padding:0" type="number" inputmode="numeric" min="10" max="${TOPE_MONTO}" placeholder="$" value="${esc(eleg.otro)}" aria-label="Otro monto"></label>` : ""}
            </div>
        </section>`;
    }

    function resumen() {
        const o = operadora(eleg.operadora);
        const monto = montoElegido();
        const ganancia = o && monto ? redondear(monto * (o.comision / 100)) : 0;
        const problema = validar();
        const color = o ? o.color : "#1d5fd1";
        const tinta = o ? o.tinta : "#fff";

        if (fase === "enviando") {
            return `<section class="rc-resumen rc-enviando" style="--rc-color:${color};--rc-tinta:${tinta}">
                <div class="rc-spinner" aria-hidden="true"></div>
                <h3>Enviando recarga…</h3>
                <p>${esc(o?.nombre || "")} · ${esc(formatoNumero(eleg.numero))} · ${entero(monto)}</p>
                <small>No cierres esta pantalla.</small>
            </section>`;
        }

        if (fase === "listo" && resultado?.pendiente) {
            return `<section class="rc-resumen rc-pendiente" style="--rc-color:#f59e0b;--rc-tinta:#1f1300">
                <div class="rc-reloj" aria-hidden="true">⏳</div>
                <h3>Recarga por confirmar</h3>
                <p>Taecel todavía no confirma esta recarga de ${entero(resultado.registro.monto)} al ${esc(formatoNumero(resultado.registro.numero))}. Puede que ya se haya hecho: <b>no la repitas</b> hasta confirmar.</p>
                <div class="rc-acciones"><button type="button" class="rc-principal" data-rc="consultar" data-id="${esc(resultado.registro.id)}">Consultar de nuevo</button><button type="button" data-rc="nueva">Hacer otra</button></div>
            </section>`;
        }

        if (fase === "listo" && resultado?.ok) {
            const r = resultado.registro;
            const op = operadora(r.operadora);

            return `<section class="rc-resumen rc-listo" style="--rc-color:${op.color};--rc-tinta:${op.tinta}">
                <svg class="rc-palomita" viewBox="0 0 52 52" aria-hidden="true"><circle cx="26" cy="26" r="24"/><path d="M15 27l8 8 15-17"/></svg>
                <h3>¡Recarga exitosa!</h3>
                <div class="rc-ticket">
                    <div><span>Compañía</span><b>${esc(op.nombre)}</b></div>
                    <div><span>Número</span><b>${esc(formatoNumero(r.numero))}</b></div>
                    <div><span>Monto</span><b>${dinero(r.monto)}</b></div>
                    <div><span>Folio</span><b class="rc-mono">${esc(r.folio)}</b></div>
                    <div class="rc-gana"><span>Tu ganancia</span><b>+${dinero(r.comision)}</b></div>
                </div>
                <div class="rc-acciones">
                    <button type="button" class="rc-principal" data-rc="nueva">Nueva recarga</button>
                    <button type="button" data-rc="imprimir">🖨 Imprimir</button>
                    <button type="button" data-rc="whatsapp">WhatsApp</button>
                </div>
            </section>`;
        }

        return `<section class="rc-resumen" style="--rc-color:${color};--rc-tinta:${tinta}">
            <div class="rc-resumen-cab"><span class="rc-etiqueta">Resumen</span>${o ? `<span class="rc-chip-op"><i>${esc(o.sigla)}</i>${esc(o.nombre)}</span>` : ""}</div>
            <div class="rc-grande">${monto ? entero(monto) : "$0"}</div>
            <div class="rc-linea"><span>Número</span><b>${eleg.numero ? esc(formatoNumero(eleg.numero)) : "—"}</b></div>
            <div class="rc-linea"><span>Cobrar al cliente</span><b>${monto ? dinero(monto) : "—"}</b></div>
            <div class="rc-linea rc-gana"><span>Tu ganancia</span><b>${ganancia ? `+${dinero(ganancia)}` : "—"}</b></div>
            ${(() => { const p = productoElegido(); return p && p.descripcion ? `<p class="rc-promo"><b>${esc(p.vigencia || "Paquete")}</b> · ${esc(p.descripcion.length > 150 ? p.descripcion.slice(0, 147) + "…" : p.descripcion)}</p>` : ""; })()}
            ${fase === "listo" && resultado && !resultado.ok ? `<p class="rc-error" role="alert">${esc(resultado.error)}</p>` : ""}
            ${error ? `<p class="rc-error" role="alert">${esc(error)}</p>` : ""}
            <button type="button" class="rc-recargar${problema ? " rc-incompleto" : ""}" data-rc="recargar">${problema ? esc(problema) : `Recargar ${entero(monto)}`}</button>
            ${notaModo()}
        </section>`;
    }

    function recientes() {
        const lista = datos.historial.slice(0, 5);

        return `<section class="rc-recientes">
            <div class="rc-recientes-cab"><h3>Últimas recargas</h3><button type="button" data-rc="ver-historial">Ver todo</button></div>
            ${lista.length ? lista.map(filaHistorial).join("") : `<p class="rc-vacio">Todavía no hay recargas.</p>`}
        </section>`;
    }

    function filaHistorial(r) {
        const o = operadora(r.operadora) || OPERADORAS[0];
        const clases = { exitosa: ["rc-est-ok", "Exitosa"], pendiente: ["rc-est-pend", "Pendiente"], fallida: ["rc-est-mal", "Fallida"] }[r.estado] || ["rc-est-ok", "Exitosa"];

        return `<article class="rc-fila">
            <span class="rc-op-mini" style="background:${o.color};color:${o.tinta}">${esc(o.sigla)}</span>
            <div class="rc-fila-info"><b>${esc(formatoNumero(r.numero))}</b><small>${esc(o.nombre)} · ${hace(r.t)}</small></div>
            <div class="rc-fila-der"><strong>${entero(r.monto)}</strong><span class="rc-estado ${clases[0]}">${clases[1]}</span></div>
            <button type="button" class="rc-repetir" data-rc="repetir" data-id="${esc(r.id)}" title="Repetir esta recarga" aria-label="Repetir recarga a ${esc(formatoNumero(r.numero))}">↻</button>
        </article>`;
    }

    function vistaRecargas() {
        return `${tarjetaSaldo()}
        <div class="rc-grid">
            <div class="rc-captura">${pasoOperadora()}${pasoNumero()}${pasoMonto()}</div>
            <aside class="rc-lado">${resumen()}${recientes()}</aside>
        </div>`;
    }

    function vistaHistorial() {
        const lista = datos.historial;
        const total = lista.filter(r => r.estado === "exitosa").reduce((s, r) => s + r.monto, 0);
        const ganancia = redondear(lista.filter(r => r.estado === "exitosa").reduce((s, r) => s + r.comision, 0));

        return `<section class="rc-historial">
            <div class="rc-historial-cab"><div><h3>Historial de recargas</h3><small>${lista.length} movimiento${lista.length === 1 ? "" : "s"} en este equipo</small></div>
            <div class="rc-historial-tot"><span>Vendido <b>${dinero(total)}</b></span><span class="rc-verde">Ganancia <b>${dinero(ganancia)}</b></span></div></div>
            ${lista.length ? lista.map(filaHistorial).join("") : `<p class="rc-vacio">Todavía no hay recargas.</p>`}
        </section>`;
    }

    function vistaServicios() {
        const servicios = [["⚡", "CFE", "Luz"], ["☎", "Telmex", "Teléfono e internet"], ["💧", "Agua", "Recibo de agua"], ["🔥", "Gas", "Gas natural"], ["📺", "Sky / Izzi", "Televisión"], ["🎮", "Pines", "Videojuegos y streaming"]];

        return `<section class="rc-servicios">
            <div class="rc-proximamente"><span>Próximamente</span><h3>Pago de servicios</h3><p>Cobra luz, teléfono, agua y más desde el mismo lugar. Usa un saldo aparte del de recargas.</p></div>
            <div class="rc-serv-grid">${servicios.map(s => `<div class="rc-serv"><i aria-hidden="true">${s[0]}</i><b>${esc(s[1])}</b><small>${esc(s[2])}</small></div>`).join("")}</div>
        </section>`;
    }

    function pintar() {
        const raiz = pantalla();
        if (!raiz) return;

        const foco = document.activeElement?.id;
        const posicion = document.activeElement?.selectionStart;

        const elegida = operadora(eleg.operadora);

        raiz.innerHTML = `<div class="rc-shell"${elegida ? ` style="--rc-color:${elegida.color};--rc-tinta:${elegida.tinta}"` : ""}>
            <header class="rc-encabezado">
                <div><h2>Recargas</h2><p>Tiempo aire en segundos: elige, escribe el número y listo.</p></div>
                ${etiquetaModo()}
            </header>
            <nav class="rc-tabs" role="tablist">
                ${[["recargas", "Recargas"], ["historial", "Historial"], ["servicios", "Servicios"]].map(([id, nombre]) => `<button type="button" role="tab" aria-selected="${pestana === id}" class="${pestana === id ? "rc-tab-activa" : ""}" data-rc="tab" data-id="${id}">${nombre}${id === "servicios" ? `<em>Pronto</em>` : ""}</button>`).join("")}
            </nav>
            ${pestana === "recargas" ? vistaRecargas() : pestana === "historial" ? vistaHistorial() : vistaServicios()}
        </div>`;

        enlazar(raiz);

        if (foco && (foco === "rcNumero" || foco === "rcOtro")) {
            const campo = raiz.querySelector(`#${foco}`);
            if (campo) { campo.focus(); try { if (typeof posicion === "number") campo.setSelectionRange(campo.value.length, campo.value.length); } catch (e) { /* tipo sin seleccion */ } }
        }
    }

    // ------------------------------------------------------------------
    // Acciones
    // ------------------------------------------------------------------
    async function recargar() {
        const problema = validar();

        if (problema) { error = problema; pintar(); return; }

        error = "";
        fase = "enviando";
        pintar();

        const monto = montoElegido();
        const respuesta = await adaptador.recargar({ operadora: eleg.operadora, numero: eleg.numero, monto });

        resultado = respuesta;
        fase = "listo";

        if (respuesta.ok || respuesta.pendiente) datos = await adaptador.estado();

        if (respuesta.ok) {
            if (typeof window.mostrarToastPOS === "function") window.mostrarToastPOS(`Recarga de ${entero(monto)} enviada`, { titulo: "Recargas", tipo: "exito" });
        }

        pintar();
    }

    function nueva() {
        eleg = { operadora: eleg.operadora, numero: "", monto: null, otro: "" };
        fase = "captura";
        resultado = null;
        error = "";
        pintar();
        pantalla()?.querySelector("#rcNumero")?.focus();
    }

    function textoTicket(r) {
        const o = operadora(r.operadora);
        return `Recarga ${o.nombre}\nNúmero: ${formatoNumero(r.numero)}\nMonto: ${dinero(r.monto)}\nFolio: ${r.folio}\n${new Date(r.t).toLocaleString("es-MX")}\n(Demostración)`;
    }

    function imprimir() {
        const r = resultado?.registro;
        if (!r) return;

        const ventana = window.open("", "_blank", "width=380,height=520");
        if (!ventana) return;

        ventana.document.write(`<pre style="font:14px/1.5 ui-monospace,Menlo,Consolas,monospace;padding:18px">${esc(textoTicket(r))}</pre>`);
        ventana.document.close();
        ventana.focus();
        ventana.print();
    }

    function whatsapp() {
        const r = resultado?.registro;
        if (!r) return;

        window.open(`https://wa.me/52${r.numero}?text=${encodeURIComponent(`Tu recarga de ${dinero(r.monto)} ${operadora(r.operadora).nombre} fue exitosa. Folio ${r.folio}. ¡Gracias!`)}`, "_blank", "noopener");
    }

    async function consultarPendiente(id) {
        const registro = await adaptador.consultar?.(id);

        if (registro && registro.estado === "exitosa") { resultado = { ok: true, registro }; datos = await adaptador.estado(); }
        else if (registro && registro.estado === "fallida") { resultado = { ok: false, error: registro.mensaje || "La recarga no se completó." }; datos = await adaptador.estado(); }

        pintar();
    }

    async function agregarSaldo() {
        if (modoPantalla !== "demostracion") {
            const aviso = "El saldo de recargas se agrega depositando a tu cuenta de Taecel y reportando el pago en su portal (Reportar compra). Aquí se actualiza solo.";
            if (typeof dialogoPOS === "function") await dialogoPOS({ titulo: "Agregar saldo", mensaje: aviso });
            return;
        }

        const texto = typeof dialogoPOS === "function"
            ? await dialogoPOS({ titulo: "Agregar saldo (demostración)", mensaje: "¿Cuánto quieres agregar al saldo de prueba?", entrada: true, tipoEntrada: "number", valorInicial: "1000", mostrarCancelar: true, textoAceptar: "Agregar" })
            : window.prompt("¿Cuánto agregas al saldo de prueba?", "1000");

        const monto = Number(texto);

        if (!monto || monto <= 0 || monto > 20000) return;

        const r = await adaptador.agregarSaldo(monto);
        if (r.ok) { datos = adaptador.leer(); pintar(); }
    }

    function enlazar(raiz) {
        raiz.querySelectorAll("[data-rc]").forEach(el => {
            el.addEventListener("click", () => {
                const accion = el.dataset.rc;

                if (accion === "tab") { pestana = el.dataset.id; pintar(); return; }
                if (accion === "ver-historial") { pestana = "historial"; pintar(); return; }
                if (accion === "operadora") { eleg.operadora = el.dataset.id; error = ""; { const nueva = operadora(eleg.operadora); if (nueva && !nueva.montos.includes(eleg.monto)) eleg.monto = null; } if (fase === "listo") { fase = "captura"; resultado = null; } pintar(); raiz.querySelector("#rcNumero")?.focus(); return; }
                if (accion === "monto") { eleg.monto = Number(el.dataset.monto); eleg.otro = ""; error = ""; if (fase === "listo") { fase = "captura"; resultado = null; } pintar(); return; }
                if (accion === "frecuente") { eleg.numero = el.dataset.numero; eleg.operadora = eleg.operadora || el.dataset.op; error = ""; pintar(); return; }
                if (accion === "recargar") { recargar(); return; }
                if (accion === "nueva") { nueva(); return; }
                if (accion === "imprimir") { imprimir(); return; }
                if (accion === "whatsapp") { whatsapp(); return; }
                if (accion === "saldo") { agregarSaldo(); return; }
                if (accion === "consultar") { consultarPendiente(el.dataset.id); return; }

                if (accion === "repetir") {
                    const r = datos.historial.find(x => x.id === el.dataset.id);
                    if (!r) return;
                    eleg = { operadora: r.operadora, numero: r.numero, monto: r.monto, otro: "" };
                    pestana = "recargas";
                    fase = "captura";
                    resultado = null;
                    error = "";
                    pintar();
                }
            });
        });

        const numero = raiz.querySelector("#rcNumero");

        if (numero) {
            numero.addEventListener("input", () => {
                eleg.numero = soloDigitos(numero.value);
                error = "";
                if (fase === "listo") { fase = "captura"; resultado = null; }
                pintar();
            });
            numero.addEventListener("keydown", evento => { if (evento.key === "Enter" && eleg.numero.length === 10) { evento.preventDefault(); raiz.querySelector(".rc-monto")?.focus(); } });
        }

        const otraCompania = raiz.querySelector("#rcOtraCarrier");

        if (otraCompania) otraCompania.addEventListener("change", () => { eleg.operadora = otraCompania.value || "otra"; eleg.monto = null; eleg.otro = ""; error = ""; pintar(); });

        const otro = raiz.querySelector("#rcOtro");

        if (otro) {
            otro.addEventListener("input", () => { eleg.otro = otro.value.replace(/[^\d]/g, ""); eleg.monto = null; error = ""; if (fase === "listo") { fase = "captura"; resultado = null; } pintar(); });
            otro.addEventListener("keydown", evento => { if (evento.key === "Enter") { evento.preventDefault(); recargar(); } });
        }
    }

    window.nexoRecargas = { operadoras: OPERADORAS, adaptador, formatoNumero };
})();
