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

    function pintar() {
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
            <header class="ap-cab"><h2>Agenda de pagos</h2><p>Lo que debes a tus proveedores y cuándo pagarlo.</p></header>
            <div class="ap-metricas">
                <div><span>Por pagar</span><strong>${dinero(total)}</strong><small>${lista.length} cuenta${lista.length === 1 ? "" : "s"}</small></div>
                <div class="ap-m-rojo"><span>Vencido</span><strong>${dinero(suma("vencidas"))}</strong><small>${de("vencidas").length} cuenta${de("vencidas").length === 1 ? "" : "s"}</small></div>
                <div class="ap-m-ambar"><span>Hoy y esta semana</span><strong>${dinero(suma("hoy") + suma("semana"))}</strong><small>${de("hoy").length + de("semana").length} cuenta${de("hoy").length + de("semana").length === 1 ? "" : "s"}</small></div>
            </div>
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
