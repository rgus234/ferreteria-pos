// Agenda de pagos a proveedores: lo que debes y cuándo pagarlo, ordenado por fecha límite (vencido, hoy, esta semana, este mes, después).
// Las cuentas salen de lo que recibes "a deber" (recibir-marca-view.js) y de las que registras en Finanzas. Desde aquí se liquidan o se abonan.
// Es una funcion nueva: solo aparece si el dueño la enciende en Nexo -> Funciones nuevas (funcionBeta("agenda_pagos")). Usa las cuentas por pagar de Finanzas avanzadas.
(function () {
    const esc = valor => String(valor ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
    const dinero = n => "$" + Number(n || 0).toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const aviso = (mensaje, tipo) => { if (typeof mostrarToastPOS === "function") mostrarToastPOS(mensaje, tipo ? { tipo } : undefined); };
    const METODOS = [["efectivo_caja", "Efectivo de la caja"], ["efectivo_propio", "Efectivo (de mi bolsa)"], ["transferencia", "Transferencia"], ["tarjeta", "Tarjeta"], ["cheque", "Cheque"]];

    let cuentas = [];
    let error = "";
    let vista = "calendario";   // "calendario" (un mes con sus pagos) o "lista" (agrupado por urgencia)
    let mes = null;             // primer dia del mes que se ve
    let dia = null;             // dia elegido (YYYY-MM-DD)

    const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
    const DIAS_SEMANA = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];

    const aISO = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    const hoyISO = () => aISO(new Date());
    const diasEntre = (desdeISO, hastaISO) => Math.round((new Date(hastaISO + "T12:00:00") - new Date(desdeISO + "T12:00:00")) / 86400000);
    const fechaBonita = iso => new Date(iso + "T12:00:00").toLocaleDateString("es-MX", { weekday: "short", day: "numeric", month: "short" });

    async function llamar(ruta, opciones = {}) {
        const respuesta = await fetch(ruta, { ...opciones, headers: { "Content-Type": "application/json", ...(opciones.headers || {}) } });
        const datos = await respuesta.json().catch(() => ({}));
        return { ok: respuesta.ok, datos };
    }

    const abiertas = () => cuentas.filter(c => (c.estado === "pendiente" || c.estado === "parcial") && Number(c.saldo) > 0);

    // En qué grupo cae cada cuenta, según su fecha límite.
    function grupoDe(c) {
        const venc = c.vencimiento ? String(c.vencimiento).slice(0, 10) : "";
        if (!venc) return "sin-fecha";
        const dias = diasEntre(hoyISO(), venc);
        if (dias < 0) return "vencidas";
        if (dias === 0) return "hoy";
        if (dias <= 7) return "semana";
        if (dias <= 31) return "mes";
        return "despues";
    }

    const GRUPOS = [
        ["vencidas", "Vencidas", "Ya pasó la fecha límite: págalas primero."],
        ["hoy", "Vencen hoy", ""],
        ["semana", "Esta semana", "En los próximos 7 días."],
        ["mes", "Este mes", "En los próximos 30 días."],
        ["despues", "Más adelante", ""],
        ["sin-fecha", "Sin fecha límite", "Ponles una fecha en Finanzas para que salgan en su lugar."]
    ];

    function chipFecha(c) {
        const venc = c.vencimiento ? String(c.vencimiento).slice(0, 10) : "";
        if (!venc) return `<em class="ap-chip">Sin fecha</em>`;
        const dias = diasEntre(hoyISO(), venc);
        const texto = dias < 0 ? `Vencida hace ${-dias} día${dias === -1 ? "" : "s"}` : (dias === 0 ? "Vence hoy" : (dias === 1 ? "Vence mañana" : `En ${dias} días`));
        return `<em class="ap-chip ${dias < 0 ? "ap-rojo" : (dias <= 7 ? "ap-ambar" : "")}">${texto}</em>`;
    }

    function fila(c) {
        const venc = c.vencimiento ? String(c.vencimiento).slice(0, 10) : "";
        return `<div class="ap-fila">
            <div class="ap-datos"><b>${esc(c.proveedor)}</b><small>${esc(c.concepto || "")}${venc ? ` · ${esc(fechaBonita(venc))}` : ""}</small></div>
            ${chipFecha(c)}
            <div class="ap-saldo"><strong>${dinero(c.saldo)}</strong>${Number(c.saldo) < Number(c.monto_total) ? `<small>de ${dinero(c.monto_total)}</small>` : ""}</div>
            <button type="button" class="ap-liquidar" onclick="apLiquidar(${Number(c.id)})">Liquidar</button>
        </div>`;
    }

    const corto = n => (n >= 1000 ? "$" + (n / 1000).toLocaleString("es-MX", { maximumFractionDigits: n >= 10000 ? 0 : 1 }) + " mil" : "$" + Math.round(n).toLocaleString("es-MX"));
    const diaDe = c => (c.vencimiento ? String(c.vencimiento).slice(0, 10) : "");
    const sumaDe = lista => lista.reduce((s, c) => s + Number(c.saldo), 0);

    function botonesVista() {
        return `<div class="ap-vista"><button type="button" class="${vista === "calendario" ? "ap-activo" : ""}" onclick="apVista('calendario')">Calendario</button><button type="button" class="${vista === "lista" ? "ap-activo" : ""}" onclick="apVista('lista')">Lista</button></div>`;
    }

    function metricas(lista) {
        const de = clave => lista.filter(c => grupoDe(c) === clave);
        const suma = clave => sumaDe(de(clave));

        return `<div class="ap-metricas">
            <div><span>Por pagar</span><strong>${dinero(sumaDe(lista))}</strong><small>${lista.length} cuenta${lista.length === 1 ? "" : "s"}</small></div>
            <div class="ap-m-rojo"><span>Vencido</span><strong>${dinero(suma("vencidas"))}</strong><small>${de("vencidas").length} cuenta${de("vencidas").length === 1 ? "" : "s"}</small></div>
            <div class="ap-m-ambar"><span>Hoy y esta semana</span><strong>${dinero(suma("hoy") + suma("semana"))}</strong><small>${de("hoy").length + de("semana").length} cuenta${de("hoy").length + de("semana").length === 1 ? "" : "s"}</small></div>
        </div>`;
    }

    // ---------- Calendario ----------

    function pintarCalendario() {
        const pantalla = document.getElementById("pantallaAgendaPagos");
        const lista = abiertas();
        const hoy = hoyISO();

        if (!mes) { const h = new Date(); mes = new Date(h.getFullYear(), h.getMonth(), 1); }
        if (!dia) dia = hoy;

        const primero = new Date(mes.getFullYear(), mes.getMonth(), 1);
        const diasDelMes = new Date(mes.getFullYear(), mes.getMonth() + 1, 0).getDate();
        const desfase = (primero.getDay() + 6) % 7;   // la semana empieza en lunes
        const semanas = Math.ceil((desfase + diasDelMes) / 7);
        const inicio = new Date(primero);
        inicio.setDate(1 - desfase);

        const celdas = [];

        for (let i = 0; i < semanas * 7; i++) {
            const d = new Date(inicio);
            d.setDate(inicio.getDate() + i);
            const iso = aISO(d);
            const delDia = lista.filter(c => diaDe(c) === iso);
            const total = sumaDe(delDia);
            const urgencia = !delDia.length ? "" : (iso < hoy ? "ap-c-vencido" : (iso === hoy ? "ap-c-hoy" : (diasEntre(hoy, iso) <= 7 ? "ap-c-pronto" : "ap-c-futuro")));

            celdas.push(`<button type="button" class="ap-celda ${d.getMonth() === mes.getMonth() ? "" : "ap-fuera"} ${urgencia} ${iso === hoy ? "ap-es-hoy" : ""} ${iso === dia ? "ap-sel" : ""}" onclick="apDia('${iso}')" aria-label="${d.getDate()} de ${MESES[d.getMonth()]}${delDia.length ? ", " + delDia.length + " pago" + (delDia.length === 1 ? "" : "s") : ""}">
                <span class="ap-num">${d.getDate()}</span>${delDia.length ? `<span class="ap-monto">${corto(total)}</span><span class="ap-cuenta">${delDia.length} pago${delDia.length === 1 ? "" : "s"}</span>` : ""}</button>`);
        }

        const delMes = lista.filter(c => { const v = diaDe(c); return v >= aISO(primero) && v <= aISO(new Date(mes.getFullYear(), mes.getMonth(), diasDelMes)); });
        const vencidas = lista.filter(c => grupoDe(c) === "vencidas").sort((a, b) => diaDe(a).localeCompare(diaDe(b)));
        const sinFecha = lista.filter(c => !diaDe(c));
        const delDiaElegido = lista.filter(c => diaDe(c) === dia);
        const titulo = new Date(dia + "T12:00:00").toLocaleDateString("es-MX", { weekday: "long", day: "numeric", month: "long" });

        pantalla.innerHTML = `<div class="ap-shell">
            <header class="ap-cab ap-cab-fila"><div><h2>Agenda de pagos</h2><p>Lo que debes a tus proveedores y cuándo pagarlo.</p></div>${botonesVista()}</header>
            ${metricas(lista)}
            ${vencidas.length ? `<section class="ap-grupo ap-g-vencidas"><h3>Vencidas <small>${dinero(sumaDe(vencidas))}</small></h3><p>Ya pasó la fecha límite: págalas primero.</p>${vencidas.map(fila).join("")}</section>` : ""}
            <section class="ap-calendario">
                <div class="ap-mes-nav">
                    <button type="button" onclick="apMes(-1)" aria-label="Mes anterior">‹</button>
                    <div><strong>${MESES[mes.getMonth()]} ${mes.getFullYear()}</strong><small>${delMes.length ? `Este mes debes ${dinero(sumaDe(delMes))} en ${delMes.length} pago${delMes.length === 1 ? "" : "s"}` : "Sin pagos este mes"}</small></div>
                    <button type="button" onclick="apMes(1)" aria-label="Mes siguiente">›</button>
                    <button type="button" class="ap-hoy" onclick="apHoy()">Hoy</button>
                </div>
                <div class="ap-semana">${DIAS_SEMANA.map(x => `<span>${x}</span>`).join("")}</div>
                <div class="ap-rejilla">${celdas.join("")}</div>
                <div class="ap-leyenda"><span><i class="ap-c-vencido"></i>Vencido</span><span><i class="ap-c-hoy"></i>Hoy</span><span><i class="ap-c-pronto"></i>Esta semana</span><span><i class="ap-c-futuro"></i>Más adelante</span></div>
            </section>
            <section class="ap-dia">
                <h3>${titulo.charAt(0).toUpperCase() + titulo.slice(1)} <small>${delDiaElegido.length ? dinero(sumaDe(delDiaElegido)) : ""}</small></h3>
                ${delDiaElegido.length ? delDiaElegido.map(fila).join("") : `<p class="ap-vacio ap-vacio-chico">No hay pagos este día.</p>`}
            </section>
            ${sinFecha.length ? `<section class="ap-grupo ap-g-sin-fecha"><h3>Sin fecha límite <small>${dinero(sumaDe(sinFecha))}</small></h3><p>Ponles una fecha en Finanzas para que salgan en el calendario.</p>${sinFecha.map(fila).join("")}</section>` : ""}
        </div>`;
    }

    window.apVista = function (nueva) { vista = nueva === "lista" ? "lista" : "calendario"; pintar(); };
    window.apMes = function (delta) { mes = new Date(mes.getFullYear(), mes.getMonth() + delta, 1); pintar(); };
    window.apHoy = function () { const h = new Date(); mes = new Date(h.getFullYear(), h.getMonth(), 1); dia = hoyISO(); pintar(); };
    window.apDia = function (iso) {
        dia = iso;
        const d = new Date(iso + "T12:00:00");
        if (d.getMonth() !== mes.getMonth() || d.getFullYear() !== mes.getFullYear()) mes = new Date(d.getFullYear(), d.getMonth(), 1);
        pintar();
    };

    function pintar() {
        if (vista === "calendario" && !error) pintarCalendario(); else pintarLista();
    }

    // ---------- Lista (por urgencia) ----------

    function pintarLista() {
        const pantalla = document.getElementById("pantallaAgendaPagos");
        if (!pantalla) return;

        if (error) {
            pantalla.innerHTML = `<div class="ap-shell"><header class="ap-cab"><h2>Agenda de pagos</h2></header><p class="ap-vacio">${esc(error)}</p></div>`;
            return;
        }

        const lista = abiertas();
        const total = lista.reduce((s, c) => s + Number(c.saldo), 0);
        const de = clave => lista.filter(c => grupoDe(c) === clave);
        const suma = clave => de(clave).reduce((s, c) => s + Number(c.saldo), 0);
        const orden = (a, b) => String(a.vencimiento || "9999").localeCompare(String(b.vencimiento || "9999"));

        pantalla.innerHTML = `<div class="ap-shell">
            <header class="ap-cab ap-cab-fila"><div><h2>Agenda de pagos</h2><p>Lo que debes a tus proveedores y cuándo pagarlo.</p></div>${botonesVista()}</header>
            ${metricas(lista)}
            ${lista.length ? GRUPOS.map(([clave, titulo, ayuda]) => {
                const filas = de(clave).sort(orden);
                return filas.length ? `<section class="ap-grupo ap-g-${clave}"><h3>${titulo} <small>${dinero(suma(clave))}</small></h3>${ayuda ? `<p>${ayuda}</p>` : ""}${filas.map(fila).join("")}</section>` : "";
            }).join("") : `<p class="ap-vacio">No debes nada por ahora. Cuando recibas mercancía “a deber” y pongas cuánto quedó, aparecerá aquí con su fecha límite.</p>`}
        </div>`;
    }

    async function cargar() {
        const r = await llamar("/cuentas-pagar");
        error = "";

        if (!r.ok) {
            error = r.datos.error || "No se pudo abrir la agenda de pagos.";
            cuentas = [];
        } else {
            cuentas = Array.isArray(r.datos.cuentas) ? r.datos.cuentas : [];
        }
    }

    window.mostrarAgendaPagos = async function () {
        if (typeof ocultarPantallasPrincipales === "function") ocultarPantallasPrincipales();
        const pantalla = document.getElementById("pantallaAgendaPagos");
        if (!pantalla) return;
        pantalla.style.display = "block";
        if (typeof actualizarTopbarContexto === "function") actualizarTopbarContexto("Agenda de pagos", "Lo que debes y cuándo pagarlo", "agenda-pagos");
        mes = null;
        dia = null;
        pantalla.innerHTML = `<div class="ap-shell"><p class="ap-vacio">Cargando…</p></div>`;
        await cargar();
        pintar();
    };

    // Liquidar (o abonar): cuánto, cómo se pagó y listo. Si fue efectivo de la caja, tambien sale en Caja para que el corte cuadre.
    window.apLiquidar = function (id) {
        const c = cuentas.find(x => Number(x.id) === Number(id));
        if (!c) return;

        const fondo = document.createElement("div");
        fondo.className = "ap-fondo";
        fondo.innerHTML = `<div class="ap-modal" role="dialog" aria-label="Liquidar cuenta">
            <h3>Liquidar a ${esc(c.proveedor)}</h3>
            <p>${esc(c.concepto || "")} · debes ${dinero(c.saldo)}</p>
            <label>¿Cuánto pagaste?<input id="apMonto" type="number" min="0.01" step="0.01" inputmode="decimal" value="${Number(c.saldo)}"></label>
            <label>¿Cómo se pagó?<select id="apMetodo">${METODOS.map(([v, t]) => `<option value="${v}">${t}</option>`).join("")}</select></label>
            <label>Referencia (opcional)<input id="apRef" type="text" maxlength="80" placeholder="Folio de transferencia, cheque…"></label>
            <div class="ap-acciones"><button type="button" class="ap-cancelar">Cancelar</button><button type="button" class="ap-aceptar">Aceptar</button></div>
        </div>`;
        document.body.appendChild(fondo);

        const cerrar = () => fondo.remove();
        fondo.querySelector(".ap-cancelar").addEventListener("click", cerrar);
        fondo.addEventListener("click", e => { if (e.target === fondo) cerrar(); });

        fondo.querySelector(".ap-aceptar").addEventListener("click", async () => {
            const monto = Number(fondo.querySelector("#apMonto").value);
            const metodo = fondo.querySelector("#apMetodo").value;
            const referencia = fondo.querySelector("#apRef").value.trim();

            if (!(monto > 0)) { aviso("Escribe cuánto pagaste.", "error"); return; }
            if (monto > Number(c.saldo) + 0.005) { aviso(`No puedes pagar más de lo que debes (${dinero(c.saldo)}).`, "error"); return; }

            const r = await llamar(`/cuentas-pagar/${Number(id)}/pagos`, { method: "POST", body: JSON.stringify({ monto, metodo, referencia, notas: "Pago desde la Agenda de pagos" }) });

            if (!r.ok) { aviso(r.datos.error || "No se pudo registrar el pago.", "error"); return; }

            if (metodo === "efectivo_caja") {
                const caja = await llamar("/caja/movimientos", { method: "POST", body: JSON.stringify({ tipo: "salida", concepto: `Pago a proveedor: ${c.proveedor}`, monto, metodo: "efectivo", referencia: `Cuenta por pagar #${Number(id)}` }) });
                if (!caja.ok) aviso(`El pago quedó registrado, pero no salió de la caja: ${caja.datos.error || "abre tu turno de caja"}.`, "info");
            }

            cerrar();
            aviso(r.datos.estado === "pagada" ? "Cuenta liquidada." : "Abono registrado.");
            await cargar();
            pintar();
        });
    };
})();
