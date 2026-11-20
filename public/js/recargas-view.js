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

    // ------------------------------------------------------------------
    // Pago de servicios y tarjetas de regalo. Con Taecel real el catalogo sale de getProducts (bolsa "Pago de Servicios", otro saldo);
    // en demostracion se usa este catalogo de muestra.
    // ------------------------------------------------------------------
    const SERVICIOS_DEMO = [
        { id: "7", nombre: "CFE", logo: "", categoria: "Servicios", libre: true, cargo: 5, campo: { nombre: "Número de servicio (12 dígitos)", min: 12, max: 12, alfanumerico: false }, productos: [{ codigo: "CFEON", monto: 0, nombre: "" }] },
        { id: "6", nombre: "Telmex", logo: "", categoria: "Servicios", libre: true, cargo: 5, campo: { nombre: "Número de teléfono Telmex", min: 10, max: 10, alfanumerico: false }, productos: [{ codigo: "TMX001", monto: 0, nombre: "" }] },
        { id: "10", nombre: "SKY", logo: "", categoria: "Servicios", libre: true, cargo: 5, campo: { nombre: "Número de cuenta", min: 12, max: 12, alfanumerico: false }, productos: [{ codigo: "SKY000", monto: 0, nombre: "" }] },
        { id: "43", nombre: "Izzi", logo: "", categoria: "Servicios", libre: true, cargo: 5, campo: { nombre: "Número de cuenta (8 dígitos)", min: 8, max: 8, alfanumerico: false }, productos: [{ codigo: "IZZ000", monto: 0, nombre: "" }] },
        { id: "18", nombre: "Megacable", logo: "", categoria: "Servicios", libre: true, cargo: 5, campo: { nombre: "Número de suscriptor", min: 10, max: 10, alfanumerico: false }, productos: [{ codigo: "MEG000", monto: 0, nombre: "" }] },
        { id: "64", nombre: "Gas Natural", logo: "", categoria: "Servicios", libre: true, cargo: 5, campo: { nombre: "Referencia", min: 14, max: 28, alfanumerico: false }, productos: [{ codigo: "GAS000", monto: 0, nombre: "" }] },
        { id: "211", nombre: "Google Play", logo: "", categoria: "GiftCards", libre: false, cargo: 0, campo: { nombre: "Celular de quien recibe", min: 10, max: 10, alfanumerico: false }, productos: [{ codigo: "GPLAY50", monto: 50, nombre: "" }, { codigo: "GOO01", monto: 100, nombre: "" }, { codigo: "GOO03", monto: 200, nombre: "" }, { codigo: "GOO500", monto: 500, nombre: "" }] },
        { id: "87", nombre: "Netflix", logo: "", categoria: "GiftCards", libre: false, cargo: 0, campo: { nombre: "Celular de quien recibe", min: 10, max: 10, alfanumerico: false }, productos: [{ codigo: "NET300", monto: 300, nombre: "" }, { codigo: "NET500", monto: 500, nombre: "" }] },
        { id: "166", nombre: "Amazon Gift Card", logo: "", categoria: "GiftCards", libre: false, cargo: 0, campo: { nombre: "Celular de quien recibe", min: 10, max: 10, alfanumerico: false }, productos: [{ codigo: "AGC100", monto: 100, nombre: "" }, { codigo: "AGC200", monto: 200, nombre: "" }, { codigo: "AGC500", monto: 500, nombre: "" }] },
        { id: "294", nombre: "Roblox", logo: "", categoria: "GiftCards", libre: false, cargo: 0, campo: { nombre: "Celular de quien recibe", min: 10, max: 10, alfanumerico: false }, productos: [{ codigo: "Roblox200", monto: 200, nombre: "" }, { codigo: "Roblox300", monto: 300, nombre: "" }] }
    ];

    // Lo que mas se paga va primero.
    const POPULARES = {
        Servicios: ["CFE", "Telmex", "TELCEL POSPAGO", "SKY", "IZZI", "TotalPlay", "Megacable", "Dish", "Gas Natural", "Infonavit", "Agua de"],
        GiftCards: ["Google Play", "Netflix", "Amazon Gift Card", "Xbox Gift Card", "Roblox", "Nintendo", "Uber", "Free Fire", "Minecraft", "Cinepolis"]
    };
    const MONTO_MAXIMO_SERVICIO = 50000;

    const plano = texto => String(texto || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
    const listaSvc = () => (catalogo && catalogo.servicios && catalogo.servicios.length ? catalogo.servicios : modoPantalla === "demostracion" ? SERVICIOS_DEMO : []);
    const servicioPorId = id => listaSvc().find(s => s.id === String(id)) || SERVICIOS_DEMO.find(s => s.id === String(id)) || null;
    const enServicios = () => pestana === "servicios";
    const grupos = texto => String(texto || "").replace(/(.{4})/g, "$1 ").trim();
    const esTarjeta = r => r && r.tipo === "giftcard";
    const esPago = r => r && r.tipo && r.tipo !== "recarga";


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

        async estado() {
            await pausa(250);

            const datos = this.leer();

            if (typeof datos.saldoServicios !== "number") { datos.saldoServicios = 1500; this.guardar(datos); } // datos guardados antes de que existieran los servicios

            return datos;
        },

        // Pago de un servicio o compra de una tarjeta de regalo (saldo de servicios, aparte del de recargas).
        async pagar({ carrierId, referencia, monto }) {
            await pausa(1700);

            const datos = this.leer();
            const s = servicioPorId(carrierId);
            const cargo = s ? s.cargo : 0;
            const tarjeta = Boolean(s) && s.categoria === "GiftCards";

            if (typeof datos.saldoServicios !== "number") datos.saldoServicios = 1500;
            if (monto + cargo > datos.saldoServicios) return { ok: false, error: "Saldo de servicios insuficiente. Agrega saldo para seguir pagando." };

            const trozo = () => Math.random().toString(36).slice(2, 7).toUpperCase();
            const registro = { id: `d${Date.now()}`, operadora: `c${carrierId}`, numero: referencia, monto, cargo, comision: 0, estado: "exitosa", t: Date.now(), folio: `DM-${100000 + Math.floor(Math.random() * 899999)}`, tipo: tarjeta ? "giftcard" : "servicio", pin: tarjeta ? `DEMO-${trozo()}-${trozo()}-${trozo()}` : "" };

            datos.saldoServicios = redondear(datos.saldoServicios - monto - cargo);
            datos.historial.unshift(registro);
            datos.historial = datos.historial.slice(0, 60);
            this.guardar(datos);

            return { ok: true, registro, saldo: datos.saldoServicios };
        },

        async agregarSaldoServicios(monto) {
            await pausa(500);
            const datos = this.leer();
            datos.saldoServicios = redondear((typeof datos.saldoServicios === "number" ? datos.saldoServicios : 1500) + monto);
            this.guardar(datos);
            return { ok: true, saldo: datos.saldoServicios };
        },

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
                saldoServicios: saldo.cuerpo.ok ? Number(saldo.cuerpo.saldoServicios || 0) : this.cache.saldoServicios || 0,
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

        async pagar({ carrierId, producto, referencia, monto }) {
            const token = (window.crypto && crypto.randomUUID ? crypto.randomUUID() : `t${Date.now()}${Math.random().toString(36).slice(2)}`).replace(/[^A-Za-z0-9_-]/g, "");
            const { cuerpo } = await this.llamar("/recargas/pagar", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token, carrierId, producto, referencia, monto }) });

            if (cuerpo.ok && cuerpo.recarga) return { ok: true, registro: cuerpo.recarga };
            if (cuerpo.pendiente && cuerpo.recarga) return { ok: false, pendiente: true, registro: cuerpo.recarga, error: cuerpo.error };

            return { ok: false, error: cuerpo.error || "No se pudo completar el pago." };
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
    let paso = 1; // 1 compañía · 2 número · 3 monto · 4 confirmar
    let animar = ""; // "adelante" | "atras": solo se anima la escena cuando se cambia de apartado
    let confirmaNumero = false; // tarjeta "¿Es este el número?"
    let numeroOk = false; // el número ya se confirmó
    // Servicios y tarjetas: mismos apartados que las recargas (servicio → referencia → monto → confirmar).
    let svc = { categoria: "Servicios", busca: "", todos: false, id: null, referencia: "", monto: "", codigo: null, paso: 1, animar: "", refOk: false };
    const svcServicio = () => servicioPorId(svc.id);
    const svcProducto = () => { const s = svcServicio(); return s ? (s.libre ? s.productos[0] : s.productos.find(p => p.codigo === svc.codigo) || null) : null; };
    const svcMonto = () => { const s = svcServicio(); if (!s) return 0; if (!s.libre) return svcProducto()?.monto || 0; return redondear(Number(svc.monto) || 0); };
    const svcCargo = () => svcServicio()?.cargo || 0;
    const svcTotal = () => redondear(svcMonto() + svcCargo());
    const svcRefValida = () => { const s = svcServicio(); return Boolean(s) && svc.referencia.length >= s.campo.min && svc.referencia.length <= s.campo.max; };
    const svcMontoValido = () => { const m = svcMonto(); return m >= 1 && m <= MONTO_MAXIMO_SERVICIO; };


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
                catalogo = cuerpo.ok && cuerpo.productos?.length ? { productos: cuerpo.productos, carriers: cuerpo.carriers || [], servicios: cuerpo.servicios || [] } : null;
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
    // Recargas y servicios tienen cada uno su saldo en Taecel: la tarjeta muestra el de la pestaña en la que estás.
    function tarjetaSaldo() {
        const deServicios = enServicios();
        const saldo = deServicios ? datos.saldoServicios || 0 : datos.saldo;
        const bajo = saldo < (deServicios ? 300 : 500);
        const hoyLista = hoy().filter(r => (deServicios ? esPago(r) : !esPago(r)));
        const ganancia = redondear(hoyLista.reduce((s, r) => s + (r.comision || 0), 0));
        const vendido = hoyLista.reduce((s, r) => s + r.monto, 0);
        const porcentaje = Math.max(4, Math.min(100, Math.round((saldo / (deServicios ? 2000 : 3000)) * 100)));
        const minis = deServicios
            ? `<div class="rc-mini"><span>Pagado hoy</span><b>${entero(vendido)}</b></div>
                <div class="rc-mini"><span>Pagos hoy</span><b>${hoyLista.filter(r => !esTarjeta(r)).length}</b></div>
                <div class="rc-mini"><span>Tarjetas hoy</span><b>${hoyLista.filter(esTarjeta).length}</b></div>`
            : `<div class="rc-mini"><span>Vendido hoy</span><b>${entero(vendido)}</b></div>
                <div class="rc-mini rc-mini-verde"><span>Ganancia hoy</span><b>${dinero(ganancia)}</b></div>
                <div class="rc-mini"><span>Recargas hoy</span><b>${hoyLista.length}</b></div>`;

        return `<section class="rc-saldo ${bajo ? "rc-bajo" : ""}">
            <div class="rc-saldo-brillo" aria-hidden="true"></div>
            <div class="rc-saldo-izq">
                <span class="rc-etiqueta">${deServicios ? "Saldo de servicios" : "Saldo de recargas"}</span>
                <strong class="rc-saldo-monto">${dinero(saldo)}</strong>
                <div class="rc-barra" aria-hidden="true"><i style="width:${porcentaje}%"></i></div>
                <small>${bajo ? `⚠ Tu saldo está bajo: agrega para no quedarte sin ${deServicios ? "pagar" : "recargar"}.` : `Saldo suficiente para varios ${deServicios ? "pagos" : "recargas"}.`}</small>
            </div>
            <div class="rc-saldo-der">${minis}</div>
            <button type="button" class="rc-agregar" data-rc="saldo">+ Agregar saldo</button>
        </section>`;
    }

    // ------------------------------------------------------------------
    // La recarga va por apartados: compañía → número (se confirma) → monto → confirmar (se mantiene presionado)
    // ------------------------------------------------------------------
    const PASOS = [["1", "Compañía"], ["2", "Número"], ["3", "Monto"], ["4", "Confirmar"]];

    const companiaLista = () => { const o = operadora(eleg.operadora); return Boolean(o && !(catalogo && o.id === "otra")); };

    function pasoMaximo() {
        if (!companiaLista()) return 1;
        if (!(numeroOk && eleg.numero.length === 10)) return 2;
        if (montoElegido() < 10) return 3;
        return 4;
    }

    function barraPasos() {
        const max = pasoMaximo();

        return `<ol class="rc-pasos" aria-label="Pasos de la recarga">${PASOS.map(([n, nombre]) => {
            const i = Number(n);
            const hecho = i < paso;

            return `<li class="rc-pn ${hecho ? "rc-hecho" : ""} ${i === paso ? "rc-actual" : ""}"><button type="button" data-rc="ir" data-paso="${i}" ${i > max || i === paso ? "disabled" : ""} ${i === paso ? 'aria-current="step"' : ""}><i>${hecho ? "✓" : n}</i><span>${nombre}</span></button></li>`;
        }).join("")}</ol>`;
    }

    // Lo que ya se eligió, como fichitas que se pueden tocar para regresar.
    function chipsEleccion() {
        const o = operadora(eleg.operadora);
        const chips = [];

        if (paso > 1 && companiaLista()) chips.push(`<button type="button" class="rc-eleccion" data-rc="ir" data-paso="1"><i style="background:${o.color};color:${o.tinta}">${esc(o.sigla)}</i>${esc(o.nombre)}</button>`);
        if (paso > 2 && numeroOk) chips.push(`<button type="button" class="rc-eleccion" data-rc="ir" data-paso="2"><i class="rc-eleccion-tel" aria-hidden="true">☎</i>${esc(formatoNumero(eleg.numero))}</button>`);
        if (paso > 3 && montoElegido() >= 10) chips.push(`<button type="button" class="rc-eleccion" data-rc="ir" data-paso="3"><i class="rc-eleccion-tel" aria-hidden="true">$</i>${entero(montoElegido())}</button>`);

        return chips.length ? `<div class="rc-elecciones">${chips.join("")}</div>` : "";
    }

    function paso1() {
        return `<section class="rc-paso rc-p">
            <h3>¿De qué compañía es el chip?</h3>
            <p class="rc-sub">Toca la compañía y seguimos.</p>
            <div class="rc-operadoras" role="radiogroup" aria-label="Compañía">
                ${OPERADORAS.map((o, i) => `<button type="button" role="radio" aria-checked="${esElegida(o.id)}" class="rc-op ${esElegida(o.id) ? "rc-sel" : ""}" data-rc="operadora" data-id="${o.id}" style="--rc-color:${o.color};--rc-tinta:${o.tinta};--i:${i}"><i>${esc(o.sigla)}</i><span>${esc(o.nombre)}</span></button>`).join("")}
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

    function paso2() {
        const frecuentes = [];
        datos.historial.forEach(r => { if (!frecuentes.find(f => f.numero === r.numero) && frecuentes.length < 4) frecuentes.push(r); });

        return `<section class="rc-paso rc-p rc-p2">
            <h3>¿A qué número?</h3>
            <p class="rc-sub">Escríbelo con calma: te lo vamos a pedir confirmar.</p>
            <div class="rc-numero ${eleg.numero.length === 10 ? "rc-ok" : ""}">
                <span class="rc-lada">🇲🇽 +52</span>
                <input id="rcNumero" style="background:transparent !important;border:0 !important;box-shadow:none !important;padding:0" type="tel" inputmode="numeric" autocomplete="off" placeholder="(442) 123-4567" maxlength="14" value="${esc(formatoNumero(eleg.numero))}" aria-label="Número de celular a 10 dígitos">
                <i class="rc-check" aria-hidden="true">✓</i>
            </div>
            ${frecuentes.length ? `<div class="rc-frecuentes"><small>Recientes</small>${frecuentes.map(f => `<button type="button" data-rc="frecuente" data-numero="${esc(f.numero)}" data-op="${esc(f.operadora)}"><b style="background:${operadora(f.operadora)?.color || "#475569"}"></b>${esc(formatoNumero(f.numero))}</button>`).join("")}</div>` : ""}
            <button type="button" class="rc-sigue" data-rc="seguir-numero" ${eleg.numero.length === 10 ? "" : "disabled"}>Continuar</button>
        </section>`;
    }

    function productoElegido() {
        const carrierId = carrierIdDe(eleg.operadora);
        return catalogo && carrierId ? productosDe(carrierId).find(p => p.monto === montoElegido()) || null : null;
    }

    function paso3() {
        const o = operadora(eleg.operadora);
        const montos = o ? o.montos : [10, 20, 30, 50, 100, 150, 200, 300, 500];
        const carrierId = carrierIdDe(eleg.operadora);
        const producto = m => (catalogo && carrierId ? productosDe(carrierId).find(p => p.monto === m) : null);
        const libre = !catalogo; // con Taecel solo existen los montos del catalogo de cada compañía

        return `<section class="rc-paso rc-p">
            <h3>¿De cuánto?</h3>
            <p class="rc-sub">Toca el monto y vemos el resumen.</p>
            ${!montos.length ? `<p class="rc-vacio">Elige la compañía para ver sus montos.</p>` : ""}
            <div class="rc-montos">
                ${montos.map((m, i) => { const p = producto(m); return `<button type="button" class="rc-monto ${eleg.otro === "" && eleg.monto === m ? "rc-sel" : ""}" data-rc="monto" data-monto="${m}" style="--i:${i}"${p && p.descripcion ? ` title="${esc(p.descripcion)}"` : ""}>${entero(m)}${p && p.vigencia ? `<small>${esc(p.vigencia.toLowerCase())}</small>` : ""}</button>`; }).join("")}
                ${libre ? `<label class="rc-otro ${eleg.otro !== "" ? "rc-sel" : ""}"><span>Otro</span><input id="rcOtro" style="background:transparent !important;border:0 !important;box-shadow:none !important;padding:0" type="number" inputmode="numeric" min="10" max="${TOPE_MONTO}" placeholder="$" value="${esc(eleg.otro)}" aria-label="Otro monto"></label>` : ""}
            </div>
            ${libre && eleg.otro !== "" ? `<button type="button" class="rc-sigue" data-rc="seguir-otro" ${montoElegido() >= 10 ? "" : "disabled"}>Continuar con ${entero(montoElegido())}</button>` : ""}
        </section>`;
    }

    function paso4() {
        const o = operadora(eleg.operadora);
        const monto = montoElegido();
        const ganancia = o && monto ? redondear(monto * (o.comision / 100)) : 0;
        const problema = validar();
        const p = productoElegido();

        return `<section class="rc-paso rc-p rc-p4" style="--rc-color:${o.color};--rc-tinta:${o.tinta}">
            <h3>Revisa y confirma</h3>
            <div class="rc-ficha">
                <span class="rc-chip-op"><i>${esc(o.sigla)}</i>${esc(o.nombre)}</span>
                <div class="rc-grande">${entero(monto)}</div>
                <div class="rc-linea"><span>Número</span><b>${esc(formatoNumero(eleg.numero))}</b></div>
                <div class="rc-linea"><span>Cobrar al cliente</span><b>${dinero(monto)}</b></div>
                <div class="rc-linea rc-gana"><span>Tu ganancia</span><b>+${dinero(ganancia)}</b></div>
                ${p && p.descripcion ? `<p class="rc-promo"><b>${esc(p.vigencia || "Paquete")}</b> · ${esc(p.descripcion.length > 150 ? p.descripcion.slice(0, 147) + "…" : p.descripcion)}</p>` : ""}
            </div>
            ${error ? `<p class="rc-error" role="alert">${esc(error)}</p>` : ""}
            ${problema
                ? `<button type="button" class="rc-recargar rc-incompleto" disabled>${esc(problema)}</button>`
                : `<button type="button" class="rc-mantener" data-rc="mantener" aria-label="Mantén presionado para recargar ${entero(monto)}"><span class="rc-mantener-relleno" aria-hidden="true"></span><span class="rc-mantener-txt">Mantén presionado para recargar ${entero(monto)}</span></button><small class="rc-nota">Así evitamos recargas por error.</small>`}
            ${notaModo()}
        </section>`;
    }

    function recientes() {
        const deServicios = enServicios();
        const lista = datos.historial.filter(r => (deServicios ? esPago(r) : !esPago(r))).slice(0, 5);

        return `<section class="rc-recientes">
            <div class="rc-recientes-cab"><h3>${deServicios ? "Últimos pagos" : "Últimas recargas"}</h3><button type="button" data-rc="ver-historial">Ver todo</button></div>
            ${lista.length ? lista.map(filaHistorial).join("") : `<p class="rc-vacio">Todavía no hay ${deServicios ? "pagos" : "recargas"}.</p>`}
        </section>`;
    }

    function filaHistorial(r) {
        const clases = { exitosa: ["rc-est-ok", "Exitosa"], pendiente: ["rc-est-pend", "Pendiente"], fallida: ["rc-est-mal", "Fallida"] }[r.estado] || ["rc-est-ok", "Exitosa"];

        if (esPago(r)) {
            const sv = servicioPorId(String(r.operadora || "").replace(/^c/, ""));
            const nombre = sv ? sv.nombre : "Servicio";

            return `<article class="rc-fila">
                <span class="rc-op-mini" style="background:#0f766e;color:#fff">${esc(nombre.charAt(0).toUpperCase())}</span>
                <div class="rc-fila-info"><b>${esc(nombre)}</b><small>${esc(esTarjeta(r) ? formatoNumero(r.numero) : grupos(r.numero))} · ${hace(r.t)}</small></div>
                <div class="rc-fila-der"><strong>${dinero(r.monto).replace(/\.00$/, "")}</strong><span class="rc-estado ${clases[0]}">${clases[1]}</span></div>
                ${esTarjeta(r) && r.pin ? `<button type="button" class="rc-repetir" data-rc="ver-pin" data-id="${esc(r.id)}" title="Copiar el código de la tarjeta" aria-label="Copiar el código de la tarjeta">🔑</button>` : `<span class="rc-repetir rc-repetir-vacio" aria-hidden="true"></span>`}
            </article>`;
        }

        const o = operadora(r.operadora) || OPERADORAS[0];

        return `<article class="rc-fila">
            <span class="rc-op-mini" style="background:${o.color};color:${o.tinta}">${esc(o.sigla)}</span>
            <div class="rc-fila-info"><b>${esc(formatoNumero(r.numero))}</b><small>${esc(o.nombre)} · ${hace(r.t)}</small></div>
            <div class="rc-fila-der"><strong>${entero(r.monto)}</strong><span class="rc-estado ${clases[0]}">${clases[1]}</span></div>
            <button type="button" class="rc-repetir" data-rc="repetir" data-id="${esc(r.id)}" title="Repetir esta recarga" aria-label="Repetir recarga a ${esc(formatoNumero(r.numero))}">↻</button>
        </article>`;
    }

    function vistaRecargas() {
        const cuerpo = paso === 1 ? paso1() : paso === 2 ? paso2() : paso === 3 ? paso3() : paso4();

        return `${tarjetaSaldo()}
        <div class="rc-grid">
            <div class="rc-captura">
                ${barraPasos()}
                ${chipsEleccion()}
                <div class="rc-escena${animar ? ` rc-entra-${animar}` : ""}">${cuerpo}</div>
            </div>
            <aside class="rc-lado">${recientes()}</aside>
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

    // ------------------------------------------------------------------
    // Pantalla de servicios y tarjetas de regalo
    // ------------------------------------------------------------------
    function validarSvc() {
        const s = svcServicio();
        const monto = svcMonto();

        if (!s) return "Elige el servicio.";
        if (!svcRefValida()) return `${s.campo.nombre} no está completo.`;
        if (!svcProducto() || monto < 1) return "Falta el monto.";
        if (monto > MONTO_MAXIMO_SERVICIO) return `El monto máximo es ${entero(MONTO_MAXIMO_SERVICIO)}.`;
        if (svcTotal() > (datos.saldoServicios || 0)) return "Saldo de servicios insuficiente.";
        return "";
    }

    function svcPasoMaximo() {
        if (!svcServicio()) return 1;
        if (!(svc.refOk && svcRefValida())) return 2;
        if (!svcMontoValido()) return 3;
        return 4;
    }

    function barraPasosSvc() {
        const max = svcPasoMaximo();
        const nombres = ["Servicio", "Referencia", "Monto", "Confirmar"];

        return `<ol class="rc-pasos" aria-label="Pasos del pago">${nombres.map((nombre, k) => {
            const i = k + 1;
            const hecho = i < svc.paso;

            return `<li class="rc-pn ${hecho ? "rc-hecho" : ""} ${i === svc.paso ? "rc-actual" : ""}"><button type="button" data-rc="svc-ir" data-paso="${i}" ${i > max || i === svc.paso ? "disabled" : ""} ${i === svc.paso ? 'aria-current="step"' : ""}><i>${hecho ? "✓" : i}</i><span>${nombre}</span></button></li>`;
        }).join("")}</ol>`;
    }

    function chipsSvc() {
        const s = svcServicio();
        const chips = [];

        if (svc.paso > 1 && s) chips.push(`<button type="button" class="rc-eleccion" data-rc="svc-ir" data-paso="1"><i class="rc-eleccion-tel" aria-hidden="true">${esc(s.nombre.charAt(0).toUpperCase())}</i>${esc(s.nombre)}</button>`);
        if (svc.paso > 2 && svc.refOk) chips.push(`<button type="button" class="rc-eleccion" data-rc="svc-ir" data-paso="2"><i class="rc-eleccion-tel" aria-hidden="true">#</i>${esc(s.categoria === "GiftCards" ? formatoNumero(svc.referencia) : grupos(svc.referencia))}</button>`);
        if (svc.paso > 3 && svcMontoValido()) chips.push(`<button type="button" class="rc-eleccion" data-rc="svc-ir" data-paso="3"><i class="rc-eleccion-tel" aria-hidden="true">$</i>${dinero(svcMonto())}</button>`);

        return chips.length ? `<div class="rc-elecciones">${chips.join("")}</div>` : "";
    }

    function logoSvc(s) {
        const inicial = esc(s.nombre.charAt(0).toUpperCase());

        return s.logo && /^https:\/\//.test(s.logo)
            ? `<span class="rc-svc-logo"><img src="${esc(s.logo)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.parentNode.classList.add('rc-sin-logo');this.remove()"><b>${inicial}</b></span>`
            : `<span class="rc-svc-logo rc-sin-logo"><b>${inicial}</b></span>`;
    }

    function listaMostrada() {
        const todos = listaSvc().filter(s => s.categoria === svc.categoria);
        const q = plano(svc.busca);

        if (q) return { lista: todos.filter(s => plano(s.nombre).includes(q)), total: todos.length, recortado: false };

        const pop = POPULARES[svc.categoria] || [];
        const orden = s => { const i = pop.findIndex(n => plano(s.nombre).startsWith(plano(n))); return i < 0 ? 999 : i; };
        const ordenados = [...todos].sort((a, b) => orden(a) - orden(b) || a.nombre.localeCompare(b.nombre));
        const popularesN = ordenados.filter(s => orden(s) < 999).length;

        return svc.todos || todos.length <= 18
            ? { lista: ordenados, total: todos.length, recortado: false }
            : { lista: ordenados.slice(0, Math.max(12, Math.min(popularesN, 18))), total: todos.length, recortado: true };
    }

    function htmlGridSvc() {
        const { lista, total, recortado } = listaMostrada();

        if (!lista.length) return `<p class="rc-vacio">No encontramos “${esc(svc.busca)}”. Prueba con otra palabra.</p>`;

        return `<div class="rc-svcs">${lista.map((s, i) => `<button type="button" class="rc-svc" data-rc="svc-pick" data-id="${esc(s.id)}" style="--i:${Math.min(i, 14)}">${logoSvc(s)}<span>${esc(s.nombre)}</span></button>`).join("")}</div>
            ${recortado ? `<button type="button" class="rc-ver-todos" data-rc="svc-todos">Ver los ${total}</button>` : ""}`;
    }

    function svcPaso1() {
        const cuantos = cat => listaSvc().filter(s => s.categoria === cat).length;

        if (!listaSvc().length) return `<section class="rc-paso rc-p"><h3>No se pudo cargar el catálogo</h3><p class="rc-sub">Revisa tu conexión e intenta de nuevo en un momento.</p></section>`;

        return `<section class="rc-paso rc-p">
            <h3>¿Qué vas a pagar?</h3>
            <p class="rc-sub">Servicios del hogar o una tarjeta de regalo.</p>
            <div class="rc-seg" role="tablist" aria-label="Tipo de pago">
                ${[["Servicios", "Servicios"], ["GiftCards", "Tarjetas de regalo"]].map(([id, nombre]) => `<button type="button" role="tab" aria-selected="${svc.categoria === id}" class="${svc.categoria === id ? "rc-seg-activo" : ""}" data-rc="svc-cat" data-id="${id}">${nombre}<small>${cuantos(id)}</small></button>`).join("")}
            </div>
            <label class="rc-busca"><span aria-hidden="true">🔎</span><input id="rcSvcBusca" type="search" autocomplete="off" placeholder="Buscar: CFE, agua, Netflix…" value="${esc(svc.busca)}" aria-label="Buscar servicio o tarjeta"></label>
            <div id="rcSvcGrid">${htmlGridSvc()}</div>
        </section>`;
    }

    function svcPaso2() {
        const s = svcServicio();
        const tarjeta = s.categoria === "GiftCards";
        const largo = s.campo.min === s.campo.max ? `${s.campo.min}` : `${s.campo.min} a ${s.campo.max}`;
        const valida = svcRefValida();

        return `<section class="rc-paso rc-p rc-p2">
            <h3>${esc(s.campo.nombre)}</h3>
            <p class="rc-sub">${tarjeta ? "Taecel pide el celular del cliente para esta compra. El código aparece en pantalla al terminar." : "Cópialo tal como viene en el recibo."} Lleva ${largo} ${s.campo.alfanumerico ? "caracteres" : "dígitos"}.</p>
            <div class="rc-numero rc-svc-ref ${valida ? "rc-ok" : ""}">
                <input id="rcSvcRef" style="background:transparent !important;border:0 !important;box-shadow:none !important;padding:0" type="text" inputmode="${s.campo.alfanumerico ? "text" : "numeric"}" autocomplete="off" maxlength="${s.campo.max}" placeholder="${"0".repeat(Math.min(s.campo.max, 12))}" value="${esc(svc.referencia)}" aria-label="${esc(s.campo.nombre)}">
                <i class="rc-check" aria-hidden="true">✓</i>
            </div>
            <small id="rcSvcCuenta" class="rc-cuenta">${svc.referencia.length} / ${s.campo.max}</small>
            <button type="button" class="rc-sigue" data-rc="svc-seguir-ref" ${valida ? "" : "disabled"}>Continuar</button>
        </section>`;
    }

    function svcPaso3() {
        const s = svcServicio();

        if (!s.libre) {
            return `<section class="rc-paso rc-p">
                <h3>¿De cuánto es la tarjeta?</h3>
                <p class="rc-sub">Toca el monto y vemos el resumen.</p>
                <div class="rc-montos">${s.productos.map((p, i) => `<button type="button" class="rc-monto ${svc.codigo === p.codigo ? "rc-sel" : ""}" data-rc="svc-monto" data-codigo="${esc(p.codigo)}" style="--i:${i}">${dinero(p.monto).replace(".00", "")}${p.nombre ? `<small>${esc(p.nombre.replace(/\$\d+/, "").trim())}</small>` : ""}</button>`).join("")}</div>
            </section>`;
        }

        return `<section class="rc-paso rc-p">
            <h3>¿Cuánto vas a pagar?</h3>
            <p class="rc-sub">Escribe el total que dice el recibo.${s.cargo ? ` Este servicio cobra ${dinero(s.cargo)} de comisión por pago.` : ""}</p>
            <div class="rc-monto-libre ${svcMontoValido() ? "rc-ok" : ""}">
                <span aria-hidden="true">$</span>
                <input id="rcSvcMonto" style="background:transparent !important;border:0 !important;box-shadow:none !important;padding:0" type="text" inputmode="decimal" autocomplete="off" placeholder="0.00" value="${esc(svc.monto)}" aria-label="Monto a pagar">
            </div>
            <button type="button" class="rc-sigue" data-rc="svc-seguir-monto" ${svcMontoValido() ? "" : "disabled"}>Continuar</button>
        </section>`;
    }

    function svcPaso4() {
        const s = svcServicio();
        const monto = svcMonto();
        const problema = validarSvc();
        const tarjeta = s.categoria === "GiftCards";

        return `<section class="rc-paso rc-p rc-p4" style="--rc-color:#0f766e;--rc-tinta:#fff">
            <h3>Revisa y confirma</h3>
            <div class="rc-ficha">
                <span class="rc-chip-op"><i>${esc(s.nombre.charAt(0).toUpperCase())}</i>${esc(s.nombre)}</span>
                <div class="rc-grande">${dinero(monto).replace(/\.00$/, "")}</div>
                <div class="rc-linea"><span>${esc(s.campo.nombre)}</span><b class="rc-mono">${esc(tarjeta ? formatoNumero(svc.referencia) : grupos(svc.referencia))}</b></div>
                <div class="rc-linea"><span>Monto</span><b>${dinero(monto)}</b></div>
                ${svcCargo() ? `<div class="rc-linea"><span>Comisión por servicio</span><b>${dinero(svcCargo())}</b></div>` : ""}
                <div class="rc-linea rc-total"><span>Cobrar al cliente</span><b>${dinero(svcTotal())}</b></div>
            </div>
            ${error ? `<p class="rc-error" role="alert">${esc(error)}</p>` : ""}
            ${problema
                ? `<button type="button" class="rc-recargar rc-incompleto" disabled>${esc(problema)}</button>`
                : `<button type="button" class="rc-mantener" data-rc="mantener" aria-label="Mantén presionado para pagar ${dinero(monto)}"><span class="rc-mantener-relleno" aria-hidden="true"></span><span class="rc-mantener-txt">Mantén presionado para ${tarjeta ? "comprar" : "pagar"} ${dinero(monto)}</span></button><small class="rc-nota">Así evitamos pagos por error.</small>`}
            ${notaModo()}
        </section>`;
    }

    function vistaServicios() {
        const cuerpo = svc.paso === 1 ? svcPaso1() : svc.paso === 2 ? svcPaso2() : svc.paso === 3 ? svcPaso3() : svcPaso4();

        return `${tarjetaSaldo()}
        <div class="rc-grid">
            <div class="rc-captura">
                ${barraPasosSvc()}
                ${chipsSvc()}
                <div class="rc-escena${svc.animar ? ` rc-entra-${svc.animar}` : ""}">${cuerpo}</div>
            </div>
            <aside class="rc-lado">${recientes()}</aside>
        </div>`;
    }

    function svcIr(n) {
        svc.animar = n > svc.paso ? "adelante" : "atras";
        svc.paso = n;
        pintar();
        if (n === 2) pantalla()?.querySelector("#rcSvcRef")?.focus();
        if (n === 3) pantalla()?.querySelector("#rcSvcMonto")?.focus();
    }

    function svcNueva() {
        svc = { categoria: svc.categoria, busca: "", todos: false, id: null, referencia: "", monto: "", codigo: null, paso: 1, animar: "atras", refOk: false };
        fase = "captura";
        resultado = null;
        error = "";
        confirmaNumero = false;
        pintar();
    }

    async function pagarSvc() {
        const problema = validarSvc();

        if (problema) { error = problema; pintar(); return; }

        error = "";
        fase = "enviando";
        pintar();

        const s = svcServicio();
        const monto = svcMonto();
        const respuesta = await adaptador.pagar({ carrierId: s.id, producto: svcProducto().codigo, referencia: svc.referencia, monto });

        resultado = respuesta;
        fase = "listo";

        if (respuesta.ok || respuesta.pendiente) datos = await adaptador.estado();

        if (respuesta.ok) {
            if (typeof navigator.vibrate === "function") navigator.vibrate([70, 40, 70]);
            if (typeof window.mostrarToastPOS === "function") window.mostrarToastPOS(`${s.categoria === "GiftCards" ? "Tarjeta" : "Pago"} de ${dinero(monto)} listo`, { titulo: "Servicios", tipo: "exito" });
        }

        pintar();
    }

    function textoTicketSvc(r) {
        const s = servicioPorId(String(r.operadora || "").replace(/^c/, ""));
        const nombre = s ? s.nombre : "Servicio";
        const lineas = [`${esTarjeta(r) ? "Tarjeta" : "Pago de servicio"} ${nombre}`, `${s ? s.campo.nombre : "Referencia"}: ${esTarjeta(r) ? formatoNumero(r.numero) : r.numero}`, `Monto: ${dinero(r.monto)}`];

        if (r.cargo) lineas.push(`Comisión por servicio: ${dinero(r.cargo)}`, `Total: ${dinero(Number(r.monto) + Number(r.cargo))}`);
        if (r.pin) lineas.push(`CÓDIGO: ${r.pin}`);

        lineas.push(`Folio: ${r.folio}`, new Date(r.t).toLocaleString("es-MX"));
        if (modoPantalla !== "produccion") lineas.push("(Prueba)");

        return lineas.join("\n");
    }

    function imprimirSvc(r) {
        const ventana = window.open("", "_blank", "width=380,height=560");
        if (!ventana) return;

        ventana.document.write(`<pre style="font:14px/1.5 ui-monospace,Menlo,Consolas,monospace;padding:18px;white-space:pre-wrap">${esc(textoTicketSvc(r))}</pre>`);
        ventana.document.close();
        ventana.focus();
        ventana.print();
    }

    function whatsappSvc(r) {
        const s = servicioPorId(String(r.operadora || "").replace(/^c/, ""));
        const texto = esTarjeta(r)
            ? `Tu tarjeta ${s ? s.nombre : ""} de ${dinero(r.monto)} está lista. Código: ${r.pin || "(en proceso)"}. Folio ${r.folio}. ¡Gracias!`
            : `Tu pago de ${dinero(r.monto)} a ${s ? s.nombre : "tu servicio"} fue exitoso. Folio ${r.folio}. ¡Gracias!`;

        window.open(`https://wa.me/${esTarjeta(r) ? "52" + r.numero : ""}?text=${encodeURIComponent(texto)}`, "_blank", "noopener");
    }

    async function copiarTexto(texto, aviso) {
        try {
            await navigator.clipboard.writeText(texto);
            if (typeof window.mostrarToastPOS === "function") window.mostrarToastPOS(aviso, { titulo: "Copiado", tipo: "exito" });
        } catch (error) { /* sin permiso para copiar */ }
    }

    // Pantallas completas de servicios (mismas clases que las de recargas).
    function htmlCapaSvc(firma) {
        const s = svcServicio();
        const nombre = s ? s.nombre : "el servicio";
        const tarjeta = s ? s.categoria === "GiftCards" : false;

        if (firma === "confirma") {
            return { clase: "rc-capa-confirma", html: `<div class="rc-tarjeta-confirma" role="dialog" aria-modal="true" aria-labelledby="rcConfTit">
                <span class="rc-chip-op" style="--rc-color:#0f766e"><i style="background:#0f766e;color:#fff">${esc(nombre.charAt(0).toUpperCase())}</i>${esc(nombre)}</span>
                <h3 id="rcConfTit">¿${tarjeta ? "Es este el número" : "Es correcta la referencia"}?</h3>
                <div class="rc-digitos rc-digitos-largo" aria-label="${esc(svc.referencia)}">${(tarjeta ? formatoNumero(svc.referencia) : grupos(svc.referencia)).split("").map((c, i) => `<span style="--i:${i}">${c === " " ? "&nbsp;" : esc(c)}</span>`).join("")}</div>
                <p>${tarjeta ? "Taecel pide este celular para la compra. Revísalo con el cliente." : "Compárala con el recibo del cliente: un pago a una referencia equivocada no se puede regresar."}</p>
                <div class="rc-conf-botones"><button type="button" data-rc="corregir">Corregir</button><button type="button" class="rc-principal" data-rc="confirmar-numero">Sí, es correcta</button></div>
            </div>` };
        }

        if (firma === "enviando") {
            return { clase: "rc-capa-envia", html: `<div class="rc-cap-cont" style="--rc-color:#0f766e;--rc-tinta:#fff">
                <div class="rc-ondas" aria-hidden="true"><i></i><i></i><i></i><b>${tarjeta ? "🎁" : "🧾"}</b></div>
                <h2>${tarjeta ? "Comprando la tarjeta…" : "Enviando el pago…"}</h2>
                <p class="rc-cap-detalle"><strong>${dinero(svcMonto())}</strong> · ${esc(nombre)}</p>
                <div class="rc-carga" aria-hidden="true"><i></i></div>
                <small id="rcFrase">Hablando con ${esc(nombre)}…</small>
                <small>No cierres esta pantalla · <span id="rcSeg">0</span> s</small>
            </div>` };
        }

        if (firma.startsWith("pend:")) {
            const r = resultado.registro;

            return { clase: "rc-capa-pend", html: `<div class="rc-cap-cont">
                <div class="rc-gran-reloj" aria-hidden="true">⏳</div>
                <h2>Pago por confirmar</h2>
                <p class="rc-cap-detalle">Taecel todavía no confirma el ${tarjeta ? "pago de la tarjeta" : "pago"} de ${dinero(r.monto)} a ${esc(nombre)}. Puede que ya se haya hecho: <b>no lo repitas</b> hasta confirmar.</p>
                <div class="rc-acciones"><button type="button" class="rc-principal" data-rc="consultar" data-id="${esc(r.id)}">Consultar de nuevo</button><button type="button" data-rc="nueva">Hacer otro</button></div>
            </div>` };
        }

        if (firma.startsWith("ok:")) {
            const r = resultado.registro;
            const sr = servicioPorId(String(r.operadora || "").replace(/^c/, "")) || s;
            const total = Number(r.monto) + Number(r.cargo || 0);

            return { clase: "rc-capa-exito", html: `<div class="rc-confeti" aria-hidden="true">${confeti()}</div>
            <div class="rc-cap-cont" role="alertdialog" aria-live="assertive" aria-label="${esTarjeta(r) ? "Tarjeta lista" : "Pago exitoso"}">
                <div class="rc-gran-check" aria-hidden="true"><svg viewBox="0 0 52 52"><circle cx="26" cy="26" r="24"/><path d="M15 27l8 8 15-17"/></svg></div>
                <h2>${esTarjeta(r) ? "¡Tarjeta lista!" : "¡Pago exitoso!"}</h2>
                <p class="rc-exito-monto"><span id="rcCuenta" data-hasta="${Number(r.monto)}">${dinero(r.monto)}</span> a ${esc(sr ? sr.nombre : "tu servicio")}</p>
                ${esTarjeta(r) ? (r.pin
                    ? `<div class="rc-pin"><span>Código de la tarjeta</span><b id="rcPin">${esc(r.pin)}</b><button type="button" data-rc="copiar-pin">Copiar código</button></div>`
                    : `<div class="rc-pin rc-pin-falta"><span>El código aún no llega</span><button type="button" data-rc="consultar" data-id="${esc(r.id)}">Consultar el código</button></div>`) : ""}
                <div class="rc-ticket">
                    <div><span>${esTarjeta(r) ? "Celular del cliente" : esc(sr ? sr.campo.nombre : "Referencia")}</span><b class="rc-mono">${esc(esTarjeta(r) ? formatoNumero(r.numero) : grupos(r.numero))}</b></div>
                    ${r.cargo ? `<div><span>Comisión por servicio</span><b>${dinero(r.cargo)}</b></div><div><span>Cobrado al cliente</span><b>${dinero(total)}</b></div>` : ""}
                    <div><span>Folio</span><b class="rc-mono">${esc(r.folio)}</b></div>
                </div>
                <div class="rc-acciones">
                    <button type="button" class="rc-principal" data-rc="nueva">${esTarjeta(r) ? "Otra tarjeta o pago" : "Otro pago"}</button>
                    <button type="button" data-rc="imprimir">🖨 Imprimir</button>
                    ${esTarjeta(r) ? `<button type="button" data-rc="whatsapp">WhatsApp</button>` : `<button type="button" data-rc="nueva">Cerrar</button>`}
                </div>
            </div>` };
        }

        return { clase: "rc-capa-fallo", html: `<div class="rc-cap-cont">
            <div class="rc-gran-x" aria-hidden="true"><svg viewBox="0 0 52 52"><circle cx="26" cy="26" r="24"/><path d="M17 17l18 18M35 17L17 35"/></svg></div>
            <h2>No se pudo completar</h2>
            <p class="rc-cap-detalle">${esc(resultado?.error || "No se pudo completar el pago.")}</p>
            <div class="rc-acciones"><button type="button" class="rc-principal" data-rc="entendido">Entendido</button></div>
        </div>` };
    }

    function pintarGridSvc() {
        const g = document.getElementById("rcSvcGrid");
        if (g) { g.innerHTML = htmlGridSvc(); enlazarAcciones(g); }
    }

    function pintar() {
        const raiz = pantalla();
        if (!raiz) return;

        const elegida = operadora(eleg.operadora);

        // Servicios y tarjetas llevan su propio color (verde azulado); las recargas toman el de la compañía elegida.
        const colorShell = enServicios() ? ` style="--rc-color:#0f766e;--rc-tinta:#fff"` : elegida ? ` style="--rc-color:${elegida.color};--rc-tinta:${elegida.tinta}"` : "";

        raiz.innerHTML = `<div class="rc-shell"${colorShell}>
            <header class="rc-encabezado">
                <div><h2>Recargas</h2><p>Tiempo aire en segundos: elige, escribe el número y listo.</p></div>
                ${etiquetaModo()}
            </header>
            <nav class="rc-tabs" role="tablist">
                ${[["recargas", "Recargas"], ["servicios", "Servicios y tarjetas"], ["historial", "Historial"]].map(([id, nombre]) => `<button type="button" role="tab" aria-selected="${pestana === id}" class="${pestana === id ? "rc-tab-activa" : ""}" data-rc="tab" data-id="${id}">${nombre}</button>`).join("")}
            </nav>
            ${pestana === "recargas" ? vistaRecargas() : pestana === "historial" ? vistaHistorial() : vistaServicios()}
        </div>`;

        animar = "";
        svc.animar = "";
        enlazar(raiz);
        pintarCapa();
    }

    function irAPaso(n) {
        animar = n > paso ? "adelante" : "atras";
        paso = n;
        pintar();
        if (n === 2 && !confirmaNumero) pantalla()?.querySelector("#rcNumero")?.focus();
    }

    // ------------------------------------------------------------------
    // Capas a pantalla completa: confirmar el número, enviando, exitosa, fallida y por confirmar.
    // Se dibujan una sola vez por cambio de estado (así la animación no se repite al repintar la pantalla de atrás).
    // ------------------------------------------------------------------
    let capaFirma = "";
    let capaReloj = null;

    function firmaCapa() {
        if (confirmaNumero) return "confirma";
        if (fase === "enviando") return "enviando";
        if (fase === "listo" && resultado) return resultado.pendiente ? `pend:${resultado.registro?.id}` : resultado.ok ? `ok:${resultado.registro?.id}` : "mal";
        return "";
    }

    function quitarCapa() {
        clearInterval(capaReloj);
        capaReloj = null;
        capaFirma = "";
        document.getElementById("rcCapa")?.remove();
    }

    function confeti() {
        const colores = ["#fde047", "#ffffff", "#a7f3d0", "#34d399", "#fb7185", "#60a5fa"];

        return Array.from({ length: 36 }, (_, i) => `<i style="left:${(Math.random() * 100).toFixed(1)}%;--d:${(Math.random() * 0.9).toFixed(2)}s;--t:${(2.4 + Math.random() * 1.8).toFixed(2)}s;--r:${Math.floor(Math.random() * 720 - 360)}deg;--c:${colores[i % colores.length]};--w:${6 + Math.floor(Math.random() * 7)}px"></i>`).join("");
    }

    function htmlCapa(firma) {
        if (enServicios()) return htmlCapaSvc(firma);

        const o = operadora(eleg.operadora) || OPERADORAS[0];
        const monto = montoElegido();

        if (firma === "confirma") {
            return { clase: "rc-capa-confirma", html: `<div class="rc-tarjeta-confirma" role="dialog" aria-modal="true" aria-labelledby="rcConfTit">
                <span class="rc-chip-op" style="--rc-color:${o.color}"><i style="background:${o.color};color:${o.tinta}">${esc(o.sigla)}</i>${esc(o.nombre)}</span>
                <h3 id="rcConfTit">¿Es este el número?</h3>
                <div class="rc-digitos" aria-label="${esc(formatoNumero(eleg.numero))}">${formatoNumero(eleg.numero).split("").map((c, i) => `<span style="--i:${i}">${c === " " ? "&nbsp;" : esc(c)}</span>`).join("")}</div>
                <p>Revísalo bien con el cliente: una recarga al número equivocado no se puede regresar.</p>
                <div class="rc-conf-botones"><button type="button" data-rc="corregir">Corregir</button><button type="button" class="rc-principal" data-rc="confirmar-numero">Sí, es correcto</button></div>
            </div>` };
        }

        if (firma === "enviando") {
            return { clase: "rc-capa-envia", html: `<div class="rc-cap-cont" style="--rc-color:${o.color};--rc-tinta:${o.tinta}">
                <div class="rc-ondas" aria-hidden="true"><i></i><i></i><i></i><b>📲</b></div>
                <h2>Enviando recarga…</h2>
                <p class="rc-cap-detalle"><strong>${entero(monto)}</strong> · ${esc(o.nombre)} · ${esc(formatoNumero(eleg.numero))}</p>
                <div class="rc-carga" aria-hidden="true"><i></i></div>
                <small id="rcFrase">Hablando con ${esc(o.nombre)}…</small>
                <small>No cierres esta pantalla · <span id="rcSeg">0</span> s</small>
            </div>` };
        }

        if (firma.startsWith("pend:")) {
            const r = resultado.registro;

            return { clase: "rc-capa-pend", html: `<div class="rc-cap-cont">
                <div class="rc-gran-reloj" aria-hidden="true">⏳</div>
                <h2>Recarga por confirmar</h2>
                <p class="rc-cap-detalle">Taecel todavía no confirma la recarga de ${entero(r.monto)} al ${esc(formatoNumero(r.numero))}. Puede que ya se haya hecho: <b>no la repitas</b> hasta confirmar.</p>
                <div class="rc-acciones"><button type="button" class="rc-principal" data-rc="consultar" data-id="${esc(r.id)}">Consultar de nuevo</button><button type="button" data-rc="nueva">Hacer otra</button></div>
            </div>` };
        }

        if (firma.startsWith("ok:")) {
            const r = resultado.registro;
            const op = operadora(r.operadora) || o;

            return { clase: "rc-capa-exito", html: `<div class="rc-confeti" aria-hidden="true">${confeti()}</div>
            <div class="rc-cap-cont" role="alertdialog" aria-live="assertive" aria-label="Recarga exitosa">
                <div class="rc-gran-check" aria-hidden="true"><svg viewBox="0 0 52 52"><circle cx="26" cy="26" r="24"/><path d="M15 27l8 8 15-17"/></svg></div>
                <h2>¡Recarga exitosa!</h2>
                <p class="rc-exito-monto"><span id="rcCuenta" data-hasta="${Number(r.monto)}">${entero(r.monto)}</span> para ${esc(formatoNumero(r.numero))}</p>
                <div class="rc-ticket">
                    <div><span>Compañía</span><b>${esc(op.nombre)}</b></div>
                    <div><span>Folio</span><b class="rc-mono">${esc(r.folio)}</b></div>
                    <div class="rc-gana"><span>Tu ganancia</span><b>+${dinero(r.comision)}</b></div>
                </div>
                <div class="rc-acciones">
                    <button type="button" class="rc-principal" data-rc="nueva">Nueva recarga</button>
                    <button type="button" data-rc="imprimir">🖨 Imprimir</button>
                    <button type="button" data-rc="whatsapp">WhatsApp</button>
                </div>
            </div>` };
        }

        return { clase: "rc-capa-fallo", html: `<div class="rc-cap-cont">
            <div class="rc-gran-x" aria-hidden="true"><svg viewBox="0 0 52 52"><circle cx="26" cy="26" r="24"/><path d="M17 17l18 18M35 17L17 35"/></svg></div>
            <h2>No se pudo recargar</h2>
            <p class="rc-cap-detalle">${esc(resultado?.error || "No se pudo completar la recarga.")}</p>
            <div class="rc-acciones"><button type="button" class="rc-principal" data-rc="entendido">Entendido</button></div>
        </div>` };
    }

    function pintarCapa() {
        const firma = firmaCapa();

        if (firma === capaFirma) return;

        quitarCapa();

        if (!firma) return;

        capaFirma = firma;

        const { clase, html } = htmlCapa(firma);
        const capa = document.createElement("div");
        capa.id = "rcCapa";
        capa.className = `rc-capa ${clase}`;
        capa.innerHTML = html;
        document.body.appendChild(capa);
        enlazarAcciones(capa);

        if (firma === "confirma") {
            capa.querySelector(".rc-principal")?.focus();
            capa.addEventListener("keydown", evento => { if (evento.key === "Escape") { confirmaNumero = false; pintar(); pantalla()?.querySelector("#rcNumero")?.focus(); } });
        }

        if (firma === "enviando") {
            const t0 = Date.now();
            const frases = [`Hablando con ${enServicios() ? (svcServicio() || {}).nombre || "el servicio" : (operadora(eleg.operadora) || {}).nombre || "la compañía"}…`, "Esperando la confirmación…", "Casi listo…", "Seguimos esperando, no la repitas…"];

            capaReloj = setInterval(() => {
                const seg = Math.floor((Date.now() - t0) / 1000);
                const s = document.getElementById("rcSeg"), f = document.getElementById("rcFrase");
                if (s) s.textContent = seg;
                if (f) f.textContent = frases[Math.min(frases.length - 1, Math.floor(seg / 5))];
            }, 500);
        }

        if (firma.startsWith("ok:")) {
            const cuenta = capa.querySelector("#rcCuenta");
            const hasta = Number(cuenta?.dataset.hasta) || 0;

            if (cuenta && hasta && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
                const t0 = performance.now();
                const formato = Number.isInteger(hasta) ? entero : dinero; // con centavos (servicios) se muestran los centavos
                const cuadro = ahora => { const k = Math.min(1, (ahora - t0) / 900); cuenta.textContent = formato(hasta * (1 - Math.pow(1 - k, 3))); if (k < 1 && cuenta.isConnected) requestAnimationFrame(cuadro); else cuenta.textContent = formato(hasta); };
                requestAnimationFrame(cuadro);
            }

            capa.querySelector(".rc-principal")?.focus();
        }

        if (firma === "mal" || firma.startsWith("pend:")) capa.querySelector(".rc-principal")?.focus();
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
            if (typeof navigator.vibrate === "function") navigator.vibrate([70, 40, 70]);
            if (typeof window.mostrarToastPOS === "function") window.mostrarToastPOS(`Recarga de ${entero(monto)} enviada`, { titulo: "Recargas", tipo: "exito" });
        }

        pintar();
    }

    // Empezar de cero: otra recarga.
    function nueva() {
        if (enServicios()) { svcNueva(); return; }

        eleg = { operadora: null, numero: "", monto: null, otro: "" };
        fase = "captura";
        resultado = null;
        error = "";
        numeroOk = false;
        confirmaNumero = false;
        animar = "atras";
        paso = 1;
        pintar();
    }

    function abrirConfirmacion() {
        if (enServicios()) {
            if (!svcRefValida()) return;
            confirmaNumero = true;
            pintarCapa();
            return;
        }

        if (eleg.numero.length !== 10 || !companiaLista()) return;
        confirmaNumero = true;
        pintarCapa();
    }


    function textoTicket(r) {
        const o = operadora(r.operadora);
        return `Recarga ${o.nombre}\nNúmero: ${formatoNumero(r.numero)}\nMonto: ${dinero(r.monto)}\nFolio: ${r.folio}\n${new Date(r.t).toLocaleString("es-MX")}\n(Demostración)`;
    }

    function imprimir() {
        const r = resultado?.registro;
        if (!r) return;
        if (esPago(r)) { imprimirSvc(r); return; }

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
        if (esPago(r)) { whatsappSvc(r); return; }

        window.open(`https://wa.me/52${r.numero}?text=${encodeURIComponent(`Tu recarga de ${dinero(r.monto)} ${operadora(r.operadora).nombre} fue exitosa. Folio ${r.folio}. ¡Gracias!`)}`, "_blank", "noopener");
    }

    async function consultarPendiente(id) {
        const registro = await adaptador.consultar?.(id);

        if (registro && registro.estado === "exitosa") { resultado = { ok: true, registro }; datos = await adaptador.estado(); }
        else if (registro && registro.estado === "fallida") { resultado = { ok: false, error: registro.mensaje || "La recarga no se completó." }; datos = await adaptador.estado(); }
        else if (typeof window.mostrarToastPOS === "function") window.mostrarToastPOS("Sigue en proceso. Vuelve a consultar en unos segundos.", { titulo: "Recargas", tipo: "info" });

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

        const r = enServicios() ? await adaptador.agregarSaldoServicios(monto) : await adaptador.agregarSaldo(monto);
        if (r.ok) { datos = adaptador.leer(); pintar(); }
    }

    function enlazarAcciones(contenedor) {
        contenedor.querySelectorAll("[data-rc]").forEach(el => {
            const accion = el.dataset.rc;

            if (accion === "mantener") return; // se maneja con pointer/teclado (ver enlazar)

            el.addEventListener("click", () => {
                if (accion === "tab") { pestana = el.dataset.id; pintar(); return; }
                if (accion === "ver-historial") { pestana = "historial"; pintar(); return; }

                if (accion === "operadora") {
                    eleg.operadora = el.dataset.id;
                    error = "";
                    { const nueva = operadora(eleg.operadora); if (nueva && !nueva.montos.includes(eleg.monto)) eleg.monto = null; }

                    if (catalogo && eleg.operadora === "otra") { pintar(); return; } // falta elegir cuál en la lista

                    contenedor.querySelectorAll(".rc-op").forEach(b => { b.classList.toggle("rc-sel", b === el); b.setAttribute("aria-checked", String(b === el)); });
                    setTimeout(() => irAPaso(2), 260);
                    return;
                }

                if (accion === "ir") { const n = Number(el.dataset.paso); if (n <= pasoMaximo()) irAPaso(n); return; }
                if (accion === "seguir-numero") { abrirConfirmacion(); return; }
                if (accion === "corregir") { confirmaNumero = false; pintar(); pantalla()?.querySelector(enServicios() ? "#rcSvcRef" : "#rcNumero")?.focus(); return; }
                if (accion === "confirmar-numero") {
                    confirmaNumero = false;

                    if (enServicios()) { svc.refOk = true; svcIr(3); return; }

                    numeroOk = true;
                    irAPaso(companiaLista() ? 3 : 1);
                    return;
                }

                // ----- servicios y tarjetas de regalo -----
                if (accion === "svc-cat") { svc.categoria = el.dataset.id; svc.busca = ""; svc.todos = false; pintar(); return; }
                if (accion === "svc-todos") { svc.todos = true; pintarGridSvc(); return; }

                if (accion === "svc-pick") {
                    if (svc.id !== el.dataset.id) { svc.id = el.dataset.id; svc.referencia = ""; svc.refOk = false; svc.monto = ""; svc.codigo = null; }
                    contenedor.querySelectorAll(".rc-svc").forEach(b => b.classList.toggle("rc-sel", b === el));
                    setTimeout(() => svcIr(2), 240);
                    return;
                }

                if (accion === "svc-ir") { const n = Number(el.dataset.paso); if (n <= svcPasoMaximo()) svcIr(n); return; }
                if (accion === "svc-seguir-ref") { abrirConfirmacion(); return; }

                if (accion === "svc-monto") {
                    svc.codigo = el.dataset.codigo; error = "";
                    contenedor.querySelectorAll(".rc-monto").forEach(b => b.classList.toggle("rc-sel", b === el));
                    setTimeout(() => svcIr(4), 260);
                    return;
                }

                if (accion === "svc-seguir-monto") { if (svcMontoValido()) svcIr(4); return; }
                if (accion === "copiar-pin") { copiarTexto(resultado?.registro?.pin || "", "Código copiado"); return; }

                if (accion === "ver-pin") {
                    const r = datos.historial.find(x => String(x.id) === el.dataset.id);
                    if (r && r.pin) copiarTexto(r.pin, `Código copiado: ${r.pin}`);
                    return;
                }

                if (accion === "monto") {
                    eleg.monto = Number(el.dataset.monto); eleg.otro = ""; error = "";
                    contenedor.querySelectorAll(".rc-monto, .rc-otro").forEach(b => b.classList.toggle("rc-sel", b === el));
                    setTimeout(() => irAPaso(4), 260);
                    return;
                }

                if (accion === "seguir-otro") { if (montoElegido() >= 10) irAPaso(4); return; }

                if (accion === "frecuente") {
                    eleg.numero = el.dataset.numero;
                    eleg.operadora = companiaLista() ? eleg.operadora : el.dataset.op;
                    numeroOk = false;
                    error = "";
                    abrirConfirmacion();
                    return;
                }

                if (accion === "nueva") { nueva(); return; }
                if (accion === "imprimir") { imprimir(); return; }
                if (accion === "whatsapp") { whatsapp(); return; }
                if (accion === "saldo") { agregarSaldo(); return; }
                if (accion === "consultar") { consultarPendiente(el.dataset.id); return; }
                if (accion === "entendido") {
                    error = resultado?.error || "";
                    fase = "captura";
                    resultado = null;

                    if (enServicios()) { svc.animar = "atras"; svc.paso = 4; } else { animar = "atras"; paso = 4; }

                    pintar();
                    return;
                }

                if (accion === "repetir") {
                    const r = datos.historial.find(x => x.id === el.dataset.id);
                    if (!r) return;
                    eleg = { operadora: r.operadora, numero: r.numero, monto: r.monto, otro: "" };
                    numeroOk = true; // ese número ya se había usado y confirmado
                    pestana = "recargas";
                    fase = "captura";
                    resultado = null;
                    error = "";
                    animar = "adelante";
                    paso = 4;
                    pintar();
                }
            });
        });
    }

    function enlazar(raiz) {
        enlazarAcciones(raiz);

        // Botón de recargar: hay que MANTENERLO presionado (~1 s). Así no se manda una recarga por un clic de más.
        const mantener = raiz.querySelector('[data-rc="mantener"]');

        if (mantener) {
            let espera = null;
            const empezar = () => { if (espera) return; mantener.classList.add("rc-presionando"); espera = setTimeout(() => { espera = null; mantener.classList.remove("rc-presionando"); if (enServicios()) pagarSvc(); else recargar(); }, 950); };
            const soltar = () => { clearTimeout(espera); espera = null; mantener.classList.remove("rc-presionando"); };

            mantener.addEventListener("pointerdown", evento => { evento.preventDefault(); empezar(); });
            ["pointerup", "pointerleave", "pointercancel", "blur", "keyup"].forEach(nombre => mantener.addEventListener(nombre, soltar));
            mantener.addEventListener("keydown", evento => { if ((evento.key === "Enter" || evento.key === " ") && !evento.repeat) { evento.preventDefault(); empezar(); } });
        }

        // El número se escribe sin repintar toda la pantalla (así no se pierde el cursor ni se repiten las animaciones).
        const numero = raiz.querySelector("#rcNumero");

        if (numero) {
            numero.addEventListener("input", () => {
                eleg.numero = soloDigitos(numero.value);
                numeroOk = false;
                error = "";
                numero.value = formatoNumero(eleg.numero);
                raiz.querySelector(".rc-numero")?.classList.toggle("rc-ok", eleg.numero.length === 10);
                const seguir = raiz.querySelector('[data-rc="seguir-numero"]');
                if (seguir) seguir.disabled = eleg.numero.length !== 10;
            });
            numero.addEventListener("keydown", evento => { if (evento.key === "Enter" && eleg.numero.length === 10) { evento.preventDefault(); abrirConfirmacion(); } });
        }

        // ----- servicios y tarjetas: buscador, referencia y monto (se escriben sin repintar toda la pantalla) -----
        const busca = raiz.querySelector("#rcSvcBusca");

        if (busca) busca.addEventListener("input", () => { svc.busca = busca.value; svc.todos = false; pintarGridSvc(); });

        const refSvc = raiz.querySelector("#rcSvcRef");

        if (refSvc) {
            refSvc.addEventListener("input", () => {
                const s = svcServicio();
                const limpio = s && s.campo.alfanumerico ? refSvc.value.replace(/[^A-Za-z0-9]/g, "").toUpperCase() : refSvc.value.replace(/\D/g, "");

                svc.referencia = limpio.slice(0, s ? s.campo.max : 30);
                svc.refOk = false;
                error = "";
                refSvc.value = svc.referencia;
                raiz.querySelector(".rc-svc-ref")?.classList.toggle("rc-ok", svcRefValida());

                const cuenta = raiz.querySelector("#rcSvcCuenta");
                if (cuenta && s) cuenta.textContent = `${svc.referencia.length} / ${s.campo.max}`;

                const seguir = raiz.querySelector('[data-rc="svc-seguir-ref"]');
                if (seguir) seguir.disabled = !svcRefValida();
            });
            refSvc.addEventListener("keydown", evento => { if (evento.key === "Enter" && svcRefValida()) { evento.preventDefault(); abrirConfirmacion(); } });
        }

        const montoSvc = raiz.querySelector("#rcSvcMonto");

        if (montoSvc) {
            montoSvc.addEventListener("input", () => {
                let texto = montoSvc.value.replace(/[^\d.]/g, "");
                const punto = texto.indexOf(".");

                if (punto >= 0) texto = texto.slice(0, punto + 1) + texto.slice(punto + 1).replace(/\./g, "").slice(0, 2);

                svc.monto = texto;
                montoSvc.value = texto;
                error = "";
                raiz.querySelector(".rc-monto-libre")?.classList.toggle("rc-ok", svcMontoValido());

                const seguir = raiz.querySelector('[data-rc="svc-seguir-monto"]');
                if (seguir) seguir.disabled = !svcMontoValido();
            });
            montoSvc.addEventListener("keydown", evento => { if (evento.key === "Enter" && svcMontoValido()) { evento.preventDefault(); svcIr(4); } });
        }

        const otraCompania = raiz.querySelector("#rcOtraCarrier");

        if (otraCompania) otraCompania.addEventListener("change", () => { eleg.operadora = otraCompania.value || "otra"; eleg.monto = null; eleg.otro = ""; error = ""; if (otraCompania.value) irAPaso(2); else pintar(); });

        const otro = raiz.querySelector("#rcOtro");

        if (otro) {
            otro.addEventListener("input", () => {
                eleg.otro = otro.value.replace(/[^\d]/g, ""); eleg.monto = null; error = "";
                const seguir = raiz.querySelector('[data-rc="seguir-otro"]');
                if (!seguir) { pintar(); raiz.querySelector("#rcOtro")?.focus(); return; }
                seguir.disabled = montoElegido() < 10;
                seguir.textContent = `Continuar con ${entero(montoElegido())}`;
            });
            otro.addEventListener("keydown", evento => { if (evento.key === "Enter" && montoElegido() >= 10) { evento.preventDefault(); irAPaso(4); } });
        }
    }

    window.nexoRecargas = { operadoras: OPERADORAS, adaptador, formatoNumero };
})();
