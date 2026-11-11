/* Agenda de pagos en el celular: un calendario con lo que debes a tus proveedores. Toca un dia para ver sus pagos y liquidarlos.
   Las cuentas salen de lo que recibes "a deber" (al recibir mercancia) y de las que registras en Finanzas. Es una funcion nueva:
   el renglon "Agenda de pagos" en Mas solo aparece si el dueño la enciende (funciones nuevas -> agenda_pagos). Usa Finanzas avanzadas. */

(function () {
    const esc = valor => (typeof escaparDueno === "function" ? escaparDueno(valor) : String(valor ?? ""));
    const dinero = n => "$" + Number(n || 0).toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const corto = n => (n >= 1000 ? "$" + (n / 1000).toLocaleString("es-MX", { maximumFractionDigits: n >= 10000 ? 0 : 1 }) + "k" : "$" + Math.round(n).toLocaleString("es-MX"));
    const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
    const DIAS = ["L", "M", "M", "J", "V", "S", "D"];
    const METODOS = [["efectivo_caja", "Efectivo de la caja"], ["efectivo_propio", "Efectivo (de mi bolsa)"], ["transferencia", "Transferencia"], ["tarjeta", "Tarjeta"], ["cheque", "Cheque"]];

    let cuentas = [];
    let mes = null;
    let dia = null;
    let error = "";

    const aISO = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    const hoyISO = () => aISO(new Date());
    const diasEntre = (a, b) => Math.round((new Date(b + "T12:00:00") - new Date(a + "T12:00:00")) / 86400000);
    const diaDe = c => (c.vencimiento ? String(c.vencimiento).slice(0, 10) : "");
    const abiertas = () => cuentas.filter(c => (c.estado === "pendiente" || c.estado === "parcial") && Number(c.saldo) > 0);
    const suma = lista => lista.reduce((s, c) => s + Number(c.saldo), 0);

    function chip(c) {
        const v = diaDe(c);
        if (!v) return `<em class="dap-chip">Sin fecha</em>`;
        const d = diasEntre(hoyISO(), v);
        const texto = d < 0 ? `Vencida hace ${-d} día${d === -1 ? "" : "s"}` : (d === 0 ? "Vence hoy" : (d === 1 ? "Vence mañana" : `En ${d} días`));
        return `<em class="dap-chip ${d < 0 ? "dap-rojo" : (d <= 7 ? "dap-ambar" : "")}">${texto}</em>`;
    }

    function fila(c) {
        return `<div class="dap-fila">
            <div class="dap-datos"><b>${esc(c.proveedor)}</b><small>${esc(c.concepto || "")}</small>${chip(c)}</div>
            <div class="dap-saldo"><strong>${dinero(c.saldo)}</strong>${Number(c.saldo) < Number(c.monto_total) ? `<small>de ${dinero(c.monto_total)}</small>` : ""}</div>
            <button type="button" class="dap-liquidar" onclick="liquidarCuentaDueno(${Number(c.id)})">Liquidar</button>
        </div>`;
    }

    function pintar() {
        const cont = typeof contenidoGestion === "function" ? contenidoGestion() : document.getElementById("duenoMasSubpantallaContenido");
        if (!cont) return;

        if (error) { cont.innerHTML = `<div class="vacio">${esc(error)}</div>`; return; }

        const lista = abiertas();
        const hoy = hoyISO();
        if (!mes) { const h = new Date(); mes = new Date(h.getFullYear(), h.getMonth(), 1); }
        if (!dia) dia = hoy;

        const primero = new Date(mes.getFullYear(), mes.getMonth(), 1);
        const diasDelMes = new Date(mes.getFullYear(), mes.getMonth() + 1, 0).getDate();
        const desfase = (primero.getDay() + 6) % 7;
        const semanas = Math.ceil((desfase + diasDelMes) / 7);
        const inicio = new Date(primero);
        inicio.setDate(1 - desfase);

        const celdas = [];

        for (let i = 0; i < semanas * 7; i++) {
            const d = new Date(inicio);
            d.setDate(inicio.getDate() + i);
            const iso = aISO(d);
            const delDia = lista.filter(c => diaDe(c) === iso);
            const urg = !delDia.length ? "" : (iso < hoy ? "dap-c-vencido" : (iso === hoy ? "dap-c-hoy" : (diasEntre(hoy, iso) <= 7 ? "dap-c-pronto" : "dap-c-futuro")));
            celdas.push(`<button type="button" class="dap-celda ${d.getMonth() === mes.getMonth() ? "" : "dap-fuera"} ${urg} ${iso === hoy ? "dap-es-hoy" : ""} ${iso === dia ? "dap-sel" : ""}" onclick="diaAgendaDueno('${iso}')"><span class="dap-num">${d.getDate()}</span>${delDia.length ? `<span class="dap-monto">${corto(suma(delDia))}</span>` : ""}</button>`);
        }

        const finMes = aISO(new Date(mes.getFullYear(), mes.getMonth(), diasDelMes));
        const delMes = lista.filter(c => diaDe(c) >= aISO(primero) && diaDe(c) <= finMes);
        const vencidas = lista.filter(c => diaDe(c) && diaDe(c) < hoy).sort((a, b) => diaDe(a).localeCompare(diaDe(b)));
        const sinFecha = lista.filter(c => !diaDe(c));
        const delElegido = lista.filter(c => diaDe(c) === dia);
        const titulo = new Date(dia + "T12:00:00").toLocaleDateString("es-MX", { weekday: "long", day: "numeric", month: "long" });

        cont.innerHTML = `
            <div class="dap-metricas">
                <div><span>Por pagar</span><strong>${dinero(suma(lista))}</strong></div>
                <div class="dap-m-rojo"><span>Vencido</span><strong>${dinero(suma(vencidas))}</strong></div>
            </div>
            ${vencidas.length ? `<section class="dap-grupo dap-g-vencidas"><h3>Vencidas <small>${dinero(suma(vencidas))}</small></h3>${vencidas.map(fila).join("")}</section>` : ""}
            <section class="dap-calendario">
                <div class="dap-nav">
                    <button type="button" onclick="mesAgendaDueno(-1)" aria-label="Mes anterior">‹</button>
                    <div><strong>${MESES[mes.getMonth()]} ${mes.getFullYear()}</strong><small>${delMes.length ? `Este mes: ${dinero(suma(delMes))}` : "Sin pagos este mes"}</small></div>
                    <button type="button" onclick="mesAgendaDueno(1)" aria-label="Mes siguiente">›</button>
                </div>
                <div class="dap-semana">${DIAS.map(x => `<span>${x}</span>`).join("")}</div>
                <div class="dap-rejilla">${celdas.join("")}</div>
                <div class="dap-leyenda"><span><i class="dap-c-vencido"></i>Vencido</span><span><i class="dap-c-hoy"></i>Hoy</span><span><i class="dap-c-pronto"></i>7 días</span><span><i class="dap-c-futuro"></i>Después</span></div>
                <button type="button" class="dap-hoy" onclick="hoyAgendaDueno()">Ir a hoy</button>
            </section>
            <section class="dap-dia">
                <h3>${esc(titulo.charAt(0).toUpperCase() + titulo.slice(1))} <small>${delElegido.length ? dinero(suma(delElegido)) : ""}</small></h3>
                ${delElegido.length ? delElegido.map(fila).join("") : `<p class="dap-nota">No hay pagos este día.</p>`}
            </section>
            ${sinFecha.length ? `<section class="dap-grupo"><h3>Sin fecha límite <small>${dinero(suma(sinFecha))}</small></h3>${sinFecha.map(fila).join("")}</section>` : ""}
            ${!lista.length ? `<p class="dap-nota">No debes nada por ahora. Cuando recibas mercancía “a deber”, aparecerá aquí con su fecha límite.</p>` : ""}`;
    }

    async function cargar() {
        try {
            const r = await fetchAutenticado("/cuentas-pagar");
            cuentas = Array.isArray(r && r.cuentas) ? r.cuentas : [];
            error = "";
        } catch (e) {
            cuentas = [];
            error = (e && e.message) || "No se pudo abrir la agenda de pagos.";
        }
    }

    window.renderSubpantallaAgendaPagos = async function () {
        mes = null;
        dia = null;
        if (typeof cargandoGestion === "function") cargandoGestion();
        await cargar();
        pintar();
    };

    window.mesAgendaDueno = function (delta) { mes = new Date(mes.getFullYear(), mes.getMonth() + delta, 1); pintar(); };
    window.hoyAgendaDueno = function () { const h = new Date(); mes = new Date(h.getFullYear(), h.getMonth(), 1); dia = hoyISO(); pintar(); };
    window.diaAgendaDueno = function (iso) {
        dia = iso;
        const d = new Date(iso + "T12:00:00");
        if (d.getMonth() !== mes.getMonth() || d.getFullYear() !== mes.getFullYear()) mes = new Date(d.getFullYear(), d.getMonth(), 1);
        pintar();
    };

    function avisar(mensaje) { if (window.NexoMovil && NexoMovil.aviso) NexoMovil.aviso(mensaje); else alert(mensaje); }

    // Liquidar (o abonar): cuanto y como se pago. Si fue efectivo de la caja, tambien sale en Caja para que el corte cuadre.
    window.liquidarCuentaDueno = function (id) {
        const c = cuentas.find(x => Number(x.id) === Number(id));
        if (!c) return;

        const fondo = document.createElement("div");
        fondo.className = "drm-hoja-fondo";
        fondo.innerHTML = `<div class="drm-hoja" role="dialog" aria-label="Liquidar cuenta"><h3>Liquidar a ${esc(c.proveedor)}</h3>
            <p>${esc(c.concepto || "")} · debes ${dinero(c.saldo)}</p>
            <label class="dap-campo">¿Cuánto pagaste?<input id="dapMonto" type="text" inputmode="decimal" value="${Number(c.saldo)}"></label>
            <label class="dap-campo">¿Cómo se pagó?<select id="dapMetodo">${METODOS.map(([v, t]) => `<option value="${v}">${t}</option>`).join("")}</select></label>
            <button type="button" class="drm-hoja-sin" data-acc="ok">Aceptar</button>
            <button type="button" class="drm-hoja-cancelar" data-acc="x">Cancelar</button></div>`;

        fondo.addEventListener("click", async e => {
            const acc = e.target.dataset && e.target.dataset.acc;
            if (acc === undefined && e.target !== fondo) return;
            if (acc !== "ok") { fondo.remove(); return; }

            const monto = Number(String(fondo.querySelector("#dapMonto").value).replace(",", "."));
            const metodo = fondo.querySelector("#dapMetodo").value;

            if (!(monto > 0)) { avisar("Escribe cuánto pagaste."); return; }
            if (monto > Number(c.saldo) + 0.005) { avisar(`No puedes pagar más de lo que debes (${dinero(c.saldo)}).`); return; }

            try {
                const r = await fetchAutenticado(`/cuentas-pagar/${Number(id)}/pagos`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ monto, metodo, notas: "Pago desde la Agenda de pagos (celular)" }) });

                if (metodo === "efectivo_caja") {
                    try { await fetchAutenticado("/caja/movimientos", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ tipo: "salida", concepto: `Pago a proveedor: ${c.proveedor}`, monto, metodo: "efectivo", referencia: `Cuenta por pagar #${Number(id)}` }) }); }
                    catch (errorCaja) { avisar("El pago quedó registrado, pero no salió de la caja: abre tu turno de caja."); }
                }

                fondo.remove();
                avisar(r && r.estado === "pagada" ? "Cuenta liquidada." : "Abono registrado.");
                await cargar();
                pintar();
            } catch (errorPago) {
                avisar((errorPago && errorPago.message) || "No se pudo registrar el pago.");
            }
        });

        document.body.appendChild(fondo);
    };

    // El renglon de Mas solo aparece si la funcion esta encendida.
    async function revisarFuncion() {
        if (typeof fetchAutenticado !== "function" || typeof tokenGuardado !== "function" || !tokenGuardado()) return;

        try {
            const datos = await fetchAutenticado("/funciones-beta");
            const encendida = datos && datos.funciones && datos.funciones.agenda_pagos === true;
            if (encendida !== Boolean(window.duenoAgendaPagos)) { window.duenoAgendaPagos = encendida; document.dispatchEvent(new CustomEvent("nexo-menu-simple-dueno")); }
        } catch (error) { /* sin conexion: se queda como estaba */ }
    }

    // Al recibir mercancia (con o sin factura): ¿quedo a deber? Devuelve null si se cancela, { pago: null } si no aplica (o la funcion esta apagada) y
    // { pago: { monto, metodo: "a_deber", vencimiento } } si quedo a credito. La fecha limite se sugiere con los dias de credito del proveedor.
    let proveedoresCredito = null;

    async function diasCreditoDe(nombre) {
        try {
            if (!proveedoresCredito) proveedoresCredito = ((await fetchAutenticado("/proveedores")) || {}).proveedores || [];
        } catch (error) { proveedoresCredito = []; }

        const clave = String(nombre || "").trim().toLowerCase();
        const prov = proveedoresCredito.find(x => String(x.nombre || "").trim().toLowerCase() === clave);
        return prov && Number(prov.dias_credito) > 0 ? Number(prov.dias_credito) : 0;
    }

    window.pedirPagoCreditoDueno = async function ({ proveedor, montoSugerido }) {
        if (!window.duenoAgendaPagos) return { pago: null };

        const dias = await diasCreditoDe(proveedor);
        const fecha = new Date();
        fecha.setDate(fecha.getDate() + dias);

        return new Promise(resolver => {
            const fondo = document.createElement("div");
            fondo.className = "drm-hoja-fondo";
            fondo.innerHTML = `<div class="drm-hoja" role="dialog" aria-label="Pago"><h3>¿Cómo quedó el pago?</h3>
                <p>${esc(proveedor ? "Proveedor: " + proveedor : "")}</p>
                <div class="dap-opciones">
                    <button type="button" class="drm-hoja-sin" data-acc="contado">Ya lo pagué (o no aplica)</button>
                    <button type="button" class="drm-hoja-sin" data-acc="credito">Me lo dejaron a crédito</button>
                </div>
                <div class="dap-credito" hidden>
                    <label class="dap-campo">¿Cuánto quedó a deber?<input id="dapDeber" type="text" inputmode="decimal" placeholder="0.00" value="${montoSugerido > 0 ? Number(montoSugerido) : ""}"></label>
                    <label class="dap-campo">Fecha límite de pago${dias ? ` (${dias} días de crédito)` : ""}<input id="dapFecha" type="date" value="${aISO(fecha)}"></label>
                    <button type="button" class="drm-hoja-sin" data-acc="guardar">Guardar</button>
                </div>
                <button type="button" class="drm-hoja-cancelar" data-acc="x">Cancelar</button></div>`;

            fondo.addEventListener("click", e => {
                const acc = e.target.dataset && e.target.dataset.acc;
                if (acc === undefined && e.target !== fondo) return;

                if (acc === "credito") {
                    fondo.querySelector(".dap-opciones").hidden = true;
                    fondo.querySelector(".dap-credito").hidden = false;
                    fondo.querySelector("#dapDeber").focus();
                    return;
                }

                if (acc === "guardar") {
                    const monto = Number(String(fondo.querySelector("#dapDeber").value).replace(",", "."));
                    const vencimiento = fondo.querySelector("#dapFecha").value;

                    if (!(monto > 0)) { avisar("Escribe cuánto quedó a deber."); return; }
                    if (!/^\d{4}-\d{2}-\d{2}$/.test(vencimiento)) { avisar("Elige la fecha límite de pago."); return; }

                    fondo.remove();
                    resolver({ pago: { monto, metodo: "a_deber", por: "", nota: "", vencimiento } });
                    return;
                }

                fondo.remove();
                resolver(acc === "contado" ? { pago: null } : null);
            });

            document.body.appendChild(fondo);
        });
    };

    revisarFuncion();
})();
