/* Recargas de tiempo aire en el celular (/dueno): mismas reglas que la pantalla de la computadora (js/recargas-view.js) y el mismo servidor (/recargas/*).
   - Tarjeta delgada en el Inicio con el saldo y la ganancia de hoy.
   - Pantalla completa: compañia, numero, monto, y una barra fija abajo con el boton de recargar.
   Hoy corre en MODO DEMOSTRACION (no se recarga ni se cobra nada de verdad) hasta que el servidor tenga las claves de Taecel; entonces usa el servidor solo.
   Aparece solo si la funcion "recargas" esta encendida para el negocio. El historial de demostracion se comparte con la pantalla de la computadora. */

(function () {
    const LLAVE = "nexoRecargasDemo";
    const TOPE_MONTO = 500;

    // Colores de marca aproximados (no son logotipos). Montos y comision = catalogo real de Taecel (ejemplo de getProducts).
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
    const CARRIER_IDS = { telcel: "1", movistar: "2", att: "5", unefon: "4", bait: "239", virgin: "11", weex: "93" };

    const esc = valor => String(valor ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
    const dinero = valor => "$" + Number(valor || 0).toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const entero = valor => "$" + Number(valor || 0).toLocaleString("es-MX", { maximumFractionDigits: 0 });
    const redondear = valor => Math.round((Number(valor) + Number.EPSILON) * 100) / 100;
    const pausa = ms => new Promise(resolver => setTimeout(resolver, ms));
    const soloDigitos = texto => String(texto || "").replace(/\D/g, "").slice(0, 10);
    const formatoNumero = d => (d.length <= 3 ? d : d.length <= 6 ? `(${d.slice(0, 3)}) ${d.slice(3)}` : `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6, 10)}`);

    function hace(t) {
        const minutos = Math.floor((Date.now() - t) / 60000);
        if (minutos < 1) return "ahora";
        if (minutos < 60) return `hace ${minutos} min`;
        const horas = Math.floor(minutos / 60);
        return horas < 24 ? `hace ${horas} h` : new Date(t).toLocaleDateString("es-MX", { day: "numeric", month: "short" });
    }

    // ------------------------------------------------------------------
    // Adaptadores: demostracion (solo en este equipo) o real (el servidor habla con Taecel)
    // ------------------------------------------------------------------
    const ADAPTADOR_DEMO = {
        leer() {
            try {
                const datos = JSON.parse(localStorage.getItem(LLAVE) || "null");
                if (datos && typeof datos.saldo === "number" && Array.isArray(datos.historial)) return datos;
            } catch (error) { /* sin datos: se crean de ejemplo */ }

            const ahora = Date.now();
            const base = { saldo: 2480, historial: [
                { id: "d3", operadora: "telcel", numero: "4421234567", monto: 50, comision: 2, estado: "exitosa", t: ahora - 14 * 60000, folio: "DM-100423" },
                { id: "d2", operadora: "att", numero: "4429876543", monto: 100, comision: 4, estado: "exitosa", t: ahora - 52 * 60000, folio: "DM-100422" },
                { id: "d1", operadora: "bait", numero: "4425550199", monto: 30, comision: 1.2, estado: "exitosa", t: ahora - 3 * 3600000, folio: "DM-100421" }
            ] };
            this.guardar(base);
            return base;
        },

        guardar(datos) { try { localStorage.setItem(LLAVE, JSON.stringify(datos)); } catch (error) { /* sin almacenamiento */ } },
        async estado() { await pausa(150); return this.leer(); },

        async recargar({ operadora: id, numero, monto }) {
            await pausa(1700);

            const datos = this.leer();
            const o = OPERADORAS.find(x => x.id === id) || OPERADORAS[0];

            if (monto > datos.saldo) return { ok: false, error: "Saldo insuficiente. Agrega saldo para seguir recargando." };

            const registro = { id: `d${Date.now()}`, operadora: id, numero, monto, comision: redondear(monto * (o.comision / 100)), estado: "exitosa", t: Date.now(), folio: `DM-${100000 + Math.floor(Math.random() * 899999)}` };
            datos.saldo = redondear(datos.saldo - monto + registro.comision);
            datos.historial.unshift(registro);
            datos.historial = datos.historial.slice(0, 60);
            this.guardar(datos);

            return { ok: true, registro };
        },

        async agregarSaldo(monto) { const datos = this.leer(); datos.saldo = redondear(datos.saldo + monto); this.guardar(datos); return { ok: true }; }
    };

    const ADAPTADOR_REAL = {
        cache: { saldo: 0, historial: [] },

        leer() { return this.cache; },

        async llamar(ruta, opciones) {
            try { return { ok: true, cuerpo: (await fetchAutenticado(ruta, opciones)) || {} }; } catch (error) { return { ok: false, cuerpo: error.datos || { error: error.message } }; }
        },

        async estado() {
            const [saldo, historial] = await Promise.all([this.llamar("/recargas/saldo"), this.llamar("/recargas/historial")]);
            this.cache = { saldo: saldo.ok ? Number(saldo.cuerpo.saldoRecargas || 0) : this.cache.saldo, historial: historial.ok ? historial.cuerpo.recargas || [] : this.cache.historial };
            return this.cache;
        },

        async recargar({ operadora: id, numero, monto }) {
            const token = (window.crypto && crypto.randomUUID ? crypto.randomUUID() : `t${Date.now()}${Math.random().toString(36).slice(2)}`).replace(/[^A-Za-z0-9_-]/g, "");
            const r = await this.llamar("/recargas/recargar", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token, operadora: id, numero, monto }) });

            if (r.cuerpo.ok && r.cuerpo.recarga) return { ok: true, registro: r.cuerpo.recarga };
            if (r.cuerpo.pendiente && r.cuerpo.recarga) return { ok: false, pendiente: true, registro: r.cuerpo.recarga, error: r.cuerpo.error };

            return { ok: false, error: r.cuerpo.error || "No se pudo completar la recarga." };
        },

        async consultar(idRecarga) {
            const r = await this.llamar(`/recargas/${idRecarga}`);
            return r.ok ? r.cuerpo.recarga : null;
        }
    };

    // ------------------------------------------------------------------
    // Estado
    // ------------------------------------------------------------------
    let adaptador = ADAPTADOR_DEMO;
    let modo = "demostracion"; // demostracion | pruebas | produccion
    let catalogo = null; // { productos, carriers } de Taecel (solo con conexion real)
    let datos = { saldo: 0, historial: [] };
    let pestana = "recargar";
    let eleg = { operadora: null, numero: "", monto: null };
    let fase = "captura"; // captura | enviando | listo
    let resultado = null;
    let error = "";
    let capa = null;

    const carrierIdDe = id => CARRIER_IDS[id] || (/^c\d+$/.test(id || "") ? String(id).slice(1) : null);
    const productosDe = carrierId => (catalogo ? catalogo.productos.filter(p => p.carrierId === carrierId).sort((a, b) => a.monto - b.monto) : []);
    const esElegida = id => eleg.operadora === id || (id === "otra" && /^c\d+$/.test(eleg.operadora || ""));

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

    const hoyLista = () => datos.historial.filter(r => new Date(r.t).toDateString() === new Date().toDateString() && r.estado === "exitosa");

    function validar() {
        const o = operadora(eleg.operadora);
        const monto = eleg.monto || 0;

        if (!o || (catalogo && o.id === "otra")) return "Elige la compañía";
        if (eleg.numero.length !== 10) return "Escribe el número (10 dígitos)";
        if (!monto) return "Elige el monto";
        if (monto > TOPE_MONTO) return `Máximo ${entero(TOPE_MONTO)}`;
        if (catalogo && !o.montos.includes(monto)) return "Monto no disponible";
        if (monto > datos.saldo) return "Saldo insuficiente";
        return "";
    }

    // ------------------------------------------------------------------
    // Tarjeta del Inicio
    // ------------------------------------------------------------------
    async function funcionEncendida() {
        try { return (await fetchAutenticado("/funciones-beta"))?.funciones?.recargas === true; } catch (error) { return false; }
    }

    async function cargarModo() {
        try {
            const r = await fetchAutenticado("/recargas/modo");
            modo = r && r.ok && ["pruebas", "produccion"].includes(r.modo) ? r.modo : "demostracion";
        } catch (error) { modo = "demostracion"; }

        adaptador = modo === "demostracion" ? ADAPTADOR_DEMO : ADAPTADOR_REAL;
        catalogo = null;

        if (modo !== "demostracion") {
            try {
                const c = await fetchAutenticado("/recargas/productos");
                catalogo = c && c.ok && c.productos?.length ? { productos: c.productos, carriers: c.carriers || [] } : null;
            } catch (error) { catalogo = null; }
        }
    }

    async function refrescarTarjeta() {
        const tarjeta = document.getElementById("drcTarjeta");
        if (!tarjeta) return;

        try { datos = await adaptador.estado(); } catch (error) { /* se queda con lo ultimo */ }

        const hoy = hoyLista();
        const ganancia = redondear(hoy.reduce((s, r) => s + (r.comision || 0), 0));

        tarjeta.innerHTML = `
            <span class="drc-t-icono" aria-hidden="true"><svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="7" y="2" width="10" height="20" rx="2.4"/><path d="M11 18h2"/></svg></span>
            <span class="drc-t-texto"><b>Recargas</b><small>Saldo ${entero(datos.saldo)}${hoy.length ? ` · hoy ${hoy.length} · gana ${dinero(ganancia)}` : " · tiempo aire en segundos"}</small></span>
            <span class="drc-t-boton">Recargar</span>`;
        tarjeta.classList.toggle("drc-bajo", datos.saldo < 500);
    }

    async function instalarTarjeta() {
        if (document.getElementById("drcTarjeta")) return;

        const kpis = document.querySelector("#duenoApp .dueno-kpis");
        if (!kpis || !(await funcionEncendida())) return;

        await cargarModo();

        if (document.getElementById("drcTarjeta")) return;

        const tarjeta = document.createElement("button");
        tarjeta.type = "button";
        tarjeta.id = "drcTarjeta";
        tarjeta.className = "drc-tarjeta";
        tarjeta.setAttribute("aria-label", "Abrir Recargas");
        tarjeta.addEventListener("click", () => window.abrirRecargasDueno());
        kpis.insertAdjacentElement("beforebegin", tarjeta);
        refrescarTarjeta();
    }

    function iniciarTarjeta() {
        let intentos = 0;
        const esperar = setInterval(() => {
            intentos++;

            if (typeof haySesionActivaDueno === "function" && haySesionActivaDueno()) { clearInterval(esperar); instalarTarjeta(); }
            else if (intentos > 40) clearInterval(esperar);
        }, 1000);

        document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") refrescarTarjeta(); });

        const cambiarOriginal = window.cambiarTabDueno;
        if (typeof cambiarOriginal === "function") {
            window.cambiarTabDueno = function (tab, ...resto) {
                const r = cambiarOriginal.call(this, tab, ...resto);
                if (tab === "inicio") { instalarTarjeta(); refrescarTarjeta(); }
                return r;
            };
        }
    }

    // ------------------------------------------------------------------
    // Pantalla
    // ------------------------------------------------------------------
    function obtenerCapa() {
        if (!capa) {
            capa = document.createElement("div");
            capa.id = "drcCapa";
            capa.className = "drc-capa";
            document.body.appendChild(capa);
        }

        capa.classList.add("abierta");
        return capa;
    }

    window.cerrarRecargasDueno = function () { capa?.classList.remove("abierta"); refrescarTarjeta(); };

    window.abrirRecargasDueno = async function () {
        obtenerCapa();
        capa.innerHTML = `<div class="drc-marco"><header class="drc-cabecera"><button type="button" class="drc-atras" onclick="cerrarRecargasDueno()" aria-label="Atrás">&larr;</button><div class="drc-titulo"><h2>Recargas</h2><small>Tiempo aire en segundos</small></div><span class="drc-atras drc-vacio"></span></header><main class="drc-cuerpo"><p class="drc-nota">Cargando…</p></main></div>`;

        await cargarModo();
        datos = await adaptador.estado();
        if (fase === "enviando") fase = "captura";
        pintar();
    };

    function etiquetaModo() {
        if (modo === "produccion") return `<span class="drc-modo drc-vivo">● Conectado a Taecel</span>`;
        if (modo === "pruebas") return `<span class="drc-modo">● Taecel · pruebas</span>`;
        return `<span class="drc-modo">● Modo demostración</span>`;
    }

    function notaModo() {
        if (modo === "produccion") return "";
        if (modo === "pruebas") return "Ambiente de pruebas de Taecel: no se cobra dinero real.";
        return "Modo demostración: no se recarga ni se cobra nada de verdad.";
    }

    function tarjetaSaldo() {
        const hoy = hoyLista();
        const ganancia = redondear(hoy.reduce((s, r) => s + (r.comision || 0), 0));
        const bajo = datos.saldo < 500;
        const porcentaje = Math.max(4, Math.min(100, Math.round((datos.saldo / 3000) * 100)));

        return `<section class="drc-saldo ${bajo ? "drc-bajo" : ""}">
            <div class="drc-brillo" aria-hidden="true"></div>
            <div class="drc-saldo-fila"><span class="drc-etiqueta">Saldo de recargas</span>${etiquetaModo()}</div>
            <strong class="drc-saldo-monto">${dinero(datos.saldo)}</strong>
            <div class="drc-barra-saldo" aria-hidden="true"><i style="width:${porcentaje}%"></i></div>
            <div class="drc-mini">
                <div><span>Vendido hoy</span><b>${entero(hoy.reduce((s, r) => s + r.monto, 0))}</b></div>
                <div class="drc-verde"><span>Ganancia hoy</span><b>${dinero(ganancia)}</b></div>
                <div><span>Recargas</span><b>${hoy.length}</b></div>
            </div>
            ${bajo ? `<small class="drc-aviso">⚠ Saldo bajo: agrega para no quedarte sin recargar.</small>` : ""}
        </section>`;
    }

    function pasoOperadora() {
        const otras = catalogo && (eleg.operadora === "otra" || /^c\d+$/.test(eleg.operadora || ""))
            ? catalogo.carriers.filter(c => !Object.values(CARRIER_IDS).includes(c.id)).sort((a, b) => a.nombre.localeCompare(b.nombre))
            : null;

        return `<section class="drc-paso">
            <h3><span>1</span>Compañía</h3>
            <div class="drc-operadoras">${OPERADORAS.map(o => `<button type="button" class="drc-op ${esElegida(o.id) ? "drc-sel" : ""}" data-drc="operadora" data-id="${o.id}" style="--drc-color:${o.color};--drc-tinta:${o.tinta}" aria-pressed="${esElegida(o.id)}"><i>${esc(o.sigla)}</i><span>${esc(o.nombre)}</span></button>`).join("")}</div>
            ${otras ? `<select id="drcOtra" class="drc-select" aria-label="Elige la compañía"><option value="">Elige la compañía…</option>${otras.map(c => `<option value="c${esc(c.id)}" ${eleg.operadora === "c" + c.id ? "selected" : ""}>${esc(c.nombre)}</option>`).join("")}</select>` : ""}
        </section>`;
    }

    function pasoNumero() {
        const frecuentes = [];
        datos.historial.forEach(r => { if (!frecuentes.find(f => f.numero === r.numero) && frecuentes.length < 4) frecuentes.push(r); });

        return `<section class="drc-paso">
            <h3><span>2</span>Número de celular</h3>
            <div class="drc-numero ${eleg.numero.length === 10 ? "drc-ok" : ""}" id="drcNumeroCaja">
                <span class="drc-lada">+52</span>
                <input id="drcNumero" type="tel" inputmode="numeric" autocomplete="off" placeholder="(442) 123-4567" maxlength="14" value="${esc(formatoNumero(eleg.numero))}" aria-label="Número de celular a 10 dígitos">
                <i class="drc-check" aria-hidden="true">✓</i>
            </div>
            ${frecuentes.length ? `<div class="drc-frecuentes">${frecuentes.map(f => `<button type="button" data-drc="frecuente" data-numero="${esc(f.numero)}" data-op="${esc(f.operadora)}">${esc(formatoNumero(f.numero))}</button>`).join("")}</div>` : ""}
        </section>`;
    }

    function pasoMonto() {
        const o = operadora(eleg.operadora);
        const montos = o ? o.montos : [10, 20, 30, 50, 100, 150, 200, 300, 500];
        const carrierId = carrierIdDe(eleg.operadora);
        const producto = m => (catalogo && carrierId ? productosDe(carrierId).find(p => p.monto === m) : null);

        return `<section class="drc-paso">
            <h3><span>3</span>Monto</h3>
            ${!montos.length ? `<p class="drc-nota">Elige la compañía para ver sus montos.</p>` : ""}
            <div class="drc-montos">${montos.map(m => { const p = producto(m); return `<button type="button" class="drc-monto ${eleg.monto === m ? "drc-sel" : ""}" data-drc="monto" data-monto="${m}">${entero(m)}${p && p.vigencia ? `<small>${esc(p.vigencia.toLowerCase())}</small>` : ""}</button>`; }).join("")}</div>
        </section>`;
    }

    function filaHistorial(r) {
        const o = operadora(r.operadora) || OPERADORAS[0];
        const est = { exitosa: ["drc-ok-est", "Exitosa"], pendiente: ["drc-pend", "Pendiente"], fallida: ["drc-mal", "Fallida"], verificar: ["drc-pend", "Verificar"] }[r.estado] || ["drc-ok-est", "Exitosa"];

        return `<article class="drc-fila">
            <span class="drc-op-mini" style="background:${o.color};color:${o.tinta}">${esc(o.sigla)}</span>
            <div class="drc-fila-info"><b>${esc(formatoNumero(r.numero))}</b><small>${esc(o.nombre)} · ${hace(r.t)}</small></div>
            <div class="drc-fila-der"><strong>${entero(r.monto)}</strong><span class="drc-est ${est[0]}">${est[1]}</span></div>
            <button type="button" class="drc-repetir" data-drc="repetir" data-id="${esc(r.id)}" aria-label="Repetir recarga a ${esc(formatoNumero(r.numero))}">↻</button>
        </article>`;
    }

    function barraInferior() {
        const o = operadora(eleg.operadora);
        const monto = eleg.monto || 0;
        const problema = validar();
        const ganancia = o && monto ? redondear(monto * (o.comision / 100)) : 0;
        const color = o ? o.color : "#1d5fd1";
        const tinta = o ? o.tinta : "#fff";

        return `<footer class="drc-barra" style="--drc-color:${color};--drc-tinta:${tinta}">
            ${error ? `<p class="drc-error" role="alert">${esc(error)}</p>` : ""}
            <div class="drc-resumen"><span>${o ? esc(o.nombre) : "Sin compañía"}${eleg.numero ? ` · ${esc(formatoNumero(eleg.numero))}` : ""}</span><b>${ganancia ? `Ganas +${dinero(ganancia)}` : "&nbsp;"}</b></div>
            <button type="button" class="drc-recargar${problema ? " drc-incompleto" : ""}" data-drc="recargar">${problema ? esc(problema) : `Recargar ${entero(monto)}`}</button>
        </footer>`;
    }

    function hojaResultado() {
        if (fase === "enviando") {
            const o = operadora(eleg.operadora);
            return `<div class="drc-hoja-fondo"><section class="drc-hoja drc-enviando" style="--drc-color:${o?.color || "#1d5fd1"}"><div class="drc-spinner" aria-hidden="true"></div><h3>Enviando recarga…</h3><p>${esc(o?.nombre || "")} · ${esc(formatoNumero(eleg.numero))} · ${entero(eleg.monto)}</p><small>No cierres esta pantalla</small></section></div>`;
        }

        if (fase === "listo" && resultado?.pendiente) {
            return `<div class="drc-hoja-fondo"><section class="drc-hoja drc-pendiente"><div class="drc-reloj" aria-hidden="true">⏳</div><h3>Recarga por confirmar</h3><p>Taecel todavía no confirma esta recarga de ${entero(resultado.registro.monto)} al ${esc(formatoNumero(resultado.registro.numero))}. Puede que ya se haya hecho: <b>no la repitas</b> hasta confirmar.</p><div class="drc-acciones"><button type="button" class="drc-principal" data-drc="consultar" data-id="${esc(resultado.registro.id)}">Consultar de nuevo</button><button type="button" data-drc="nueva">Hacer otra</button></div></section></div>`;
        }

        if (fase === "listo" && resultado?.ok) {
            const r = resultado.registro;
            const o = operadora(r.operadora) || OPERADORAS[0];

            return `<div class="drc-hoja-fondo"><section class="drc-hoja drc-listo" style="--drc-color:${o.color};--drc-tinta:${o.tinta}">
                <svg class="drc-palomita" viewBox="0 0 52 52" aria-hidden="true"><circle cx="26" cy="26" r="24"/><path d="M15 27l8 8 15-17"/></svg>
                <h3>¡Recarga exitosa!</h3>
                <div class="drc-ticket">
                    <div><span>Compañía</span><b>${esc(o.nombre)}</b></div>
                    <div><span>Número</span><b>${esc(formatoNumero(r.numero))}</b></div>
                    <div><span>Monto</span><b>${dinero(r.monto)}</b></div>
                    <div><span>Folio</span><b class="drc-mono">${esc(r.folio || "—")}</b></div>
                    <div class="drc-gana"><span>Tu ganancia</span><b>+${dinero(r.comision)}</b></div>
                </div>
                <div class="drc-acciones"><button type="button" class="drc-principal" data-drc="nueva">Nueva recarga</button><button type="button" data-drc="whatsapp">Avisar por WhatsApp</button></div>
            </section></div>`;
        }

        return "";
    }

    function pintar() {
        obtenerCapa();

        const contenido = pestana === "recargar"
            ? `${tarjetaSaldo()}${pasoOperadora()}${pasoNumero()}${pasoMonto()}${notaModo() ? `<p class="drc-nota">${esc(notaModo())}</p>` : ""}`
            : `<section class="drc-historial"><div class="drc-historial-cab"><h3>Historial</h3><small>${datos.historial.length} movimiento${datos.historial.length === 1 ? "" : "s"}</small></div>${datos.historial.length ? datos.historial.map(filaHistorial).join("") : `<p class="drc-nota">Todavía no hay recargas.</p>`}</section>`;

        capa.innerHTML = `<div class="drc-marco">
            <header class="drc-cabecera"><button type="button" class="drc-atras" onclick="cerrarRecargasDueno()" aria-label="Atrás">&larr;</button><div class="drc-titulo"><h2>Recargas</h2><small>Tiempo aire en segundos</small></div><span class="drc-atras drc-vacio"></span></header>
            <nav class="drc-tabs" role="tablist">
                <button type="button" role="tab" aria-selected="${pestana === "recargar"}" class="${pestana === "recargar" ? "drc-tab-activa" : ""}" data-drc="tab" data-id="recargar">Recargar</button>
                <button type="button" role="tab" aria-selected="${pestana === "historial"}" class="${pestana === "historial" ? "drc-tab-activa" : ""}" data-drc="tab" data-id="historial">Historial</button>
            </nav>
            <main class="drc-cuerpo ${pestana === "recargar" ? "drc-con-barra" : ""}">${contenido}</main>
            ${pestana === "recargar" ? barraInferior() : ""}
            ${hojaResultado()}
        </div>`;

        enlazar();
    }

    // Al escribir el numero solo se actualizan la caja y la barra de abajo (no se redibuja todo: el teclado no se cierra).
    function actualizarBarra() {
        const barra = capa.querySelector(".drc-barra");
        if (barra) barra.outerHTML = barraInferior();
        capa.querySelector(".drc-barra [data-drc=recargar]")?.addEventListener("click", recargar);
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

        const respuesta = await adaptador.recargar({ operadora: eleg.operadora, numero: eleg.numero, monto: eleg.monto });
        resultado = respuesta;
        fase = "listo";

        if (respuesta.ok || respuesta.pendiente) datos = await adaptador.estado();
        if (respuesta.ok && navigator.vibrate) navigator.vibrate([60, 40, 60]);
        if (!respuesta.ok && !respuesta.pendiente) { error = respuesta.error || "No se pudo completar la recarga."; fase = "captura"; resultado = null; }

        pintar();
    }

    function nueva() {
        eleg = { operadora: eleg.operadora, numero: "", monto: null };
        fase = "captura";
        resultado = null;
        error = "";
        pintar();
        capa.querySelector("#drcNumero")?.focus();
    }

    function whatsapp() {
        const r = resultado?.registro;
        if (!r) return;

        const nombre = (operadora(r.operadora) || OPERADORAS[0]).nombre;
        window.open(`https://wa.me/52${r.numero}?text=${encodeURIComponent(`Tu recarga de ${dinero(r.monto)} ${nombre} fue exitosa. Folio ${r.folio || ""}. ¡Gracias!`)}`, "_blank", "noopener");
    }

    async function consultar(id) {
        const registro = await adaptador.consultar?.(id);

        if (registro && registro.estado === "exitosa") { resultado = { ok: true, registro }; datos = await adaptador.estado(); }
        else if (registro && registro.estado === "fallida") { resultado = null; fase = "captura"; error = registro.mensaje || "La recarga no se completó."; datos = await adaptador.estado(); }

        pintar();
    }

    function enlazar() {
        capa.querySelectorAll("[data-drc]").forEach(el => {
            if (el.dataset.drc === "recargar") { el.addEventListener("click", recargar); return; }

            el.addEventListener("click", () => {
                const accion = el.dataset.drc;

                if (accion === "tab") { pestana = el.dataset.id; pintar(); return; }
                if (accion === "operadora") { eleg.operadora = el.dataset.id; error = ""; const nueva = operadora(eleg.operadora); if (nueva && !nueva.montos.includes(eleg.monto)) eleg.monto = null; pintar(); return; }
                if (accion === "monto") { eleg.monto = Number(el.dataset.monto); error = ""; pintar(); return; }
                if (accion === "frecuente") { eleg.numero = el.dataset.numero; eleg.operadora = eleg.operadora || el.dataset.op; error = ""; pintar(); return; }
                if (accion === "nueva") { nueva(); return; }
                if (accion === "whatsapp") { whatsapp(); return; }
                if (accion === "consultar") { consultar(el.dataset.id); return; }

                if (accion === "repetir") {
                    const r = datos.historial.find(x => x.id === el.dataset.id);
                    if (!r) return;
                    eleg = { operadora: r.operadora, numero: r.numero, monto: r.monto };
                    pestana = "recargar";
                    fase = "captura";
                    resultado = null;
                    error = "";
                    pintar();
                }
            });
        });

        const numero = capa.querySelector("#drcNumero");

        if (numero) {
            numero.addEventListener("input", () => {
                eleg.numero = soloDigitos(numero.value);
                numero.value = formatoNumero(eleg.numero);
                error = "";
                capa.querySelector("#drcNumeroCaja")?.classList.toggle("drc-ok", eleg.numero.length === 10);
                actualizarBarra();
            });
        }

        const otra = capa.querySelector("#drcOtra");
        if (otra) otra.addEventListener("change", () => { eleg.operadora = otra.value || "otra"; eleg.monto = null; error = ""; pintar(); });
    }

    window.drcEstado = () => ({ modo, saldo: datos.saldo });

    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", iniciarTarjeta); else iniciarTarjeta();
})();
