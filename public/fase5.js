(() => {
    if (window.__fase5Finanzas) return;
    window.__fase5Finanzas = true;

    const estado = {
        cuentas: [],
        gastos: []
    };

    const esc = valor => String(
        typeof limpiarTextoUI === "function"
            ? limpiarTextoUI(valor ?? "")
            : (valor ?? "")
    )
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");

    const num = valor => Number.isFinite(Number(valor)) ? Number(valor) : 0;
    const money = valor => typeof dinero === "function" ? dinero(valor) : "$" + num(valor).toFixed(2);

    function ocultarPantallasFinanzas() {
        [
            "pantallaInicio",
            "pantallaPuntoVenta",
            "pantallaInventario",
            "pantallaCategoriasInventario",
            "pantallaCatalogo",
            "pantallaClientes",
            "pantallaProveedores",
            "pantallaInventarioBajo",
            "pantallaReportes",
            "pantallaConfiguracion",
            "pantallaRecepcionMercancia",
            "pantallaPedidosProveedor",
            "pantallaAjustesInventario",
            "pantallaFinanzas"
        ].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.style.display = "none";
        });
    }

    function asegurarPantallaFinanzas() {
        const main = document.querySelector("main.contenido") || document.getElementById("sistema");
        if (!main) return;

        if (document.getElementById("pantallaFinanzas")) return;

        const pantalla = document.createElement("section");
        pantalla.id = "pantallaFinanzas";
        pantalla.style.display = "none";
        pantalla.innerHTML = `
            <div class="finanzas-shell">
                <div class="finanzas-header">
                    <div>
                        <span>Administracion</span>
                        <h2>Finanzas</h2>
                        <p>Cuentas por pagar, pagos a proveedor y gastos operativos.</p>
                    </div>
                    <button type="button" onclick="cargarFinanzasPOS()">Actualizar</button>
                </div>

                <div class="finanzas-kpis">
                    <div><span>Por pagar</span><strong id="finPorPagar">$0.00</strong></div>
                    <div><span>Cuentas abiertas</span><strong id="finCuentasAbiertas">0</strong></div>
                    <div><span>Vencidas</span><strong id="finVencidas">0</strong></div>
                    <div><span>Gastos del mes</span><strong id="finGastosMes">$0.00</strong></div>
                </div>

                <div class="finanzas-grid">
                    <section class="finanzas-panel">
                        <div class="finanzas-panel-head">
                            <h3>Nueva cuenta por pagar</h3>
                            <button type="button" onclick="guardarCuentaPagarPOS()">Guardar</button>
                        </div>
                        <div class="finanzas-form">
                            <input id="finCuentaProveedor" placeholder="Proveedor">
                            <input id="finCuentaConcepto" placeholder="Concepto / factura / nota">
                            <input id="finCuentaMonto" type="number" step="0.01" placeholder="Monto">
                            <input id="finCuentaVencimiento" type="date">
                            <input id="finCuentaNotas" placeholder="Notas">
                        </div>
                    </section>

                    <section class="finanzas-panel">
                        <div class="finanzas-panel-head">
                            <h3>Nuevo gasto</h3>
                            <button type="button" onclick="guardarGastoOperativoPOS()">Guardar</button>
                        </div>
                        <div class="finanzas-form">
                            <select id="finGastoCategoria">
                                <option value="General">General</option>
                                <option value="Renta">Renta</option>
                                <option value="Servicios">Servicios</option>
                                <option value="Nomina">Nomina</option>
                                <option value="Flete">Flete</option>
                                <option value="Mantenimiento">Mantenimiento</option>
                            </select>
                            <input id="finGastoConcepto" placeholder="Concepto">
                            <input id="finGastoMonto" type="number" step="0.01" placeholder="Monto">
                            <input id="finGastoMetodo" placeholder="Metodo">
                            <input id="finGastoReferencia" placeholder="Referencia">
                        </div>
                    </section>
                </div>

                <div class="finanzas-grid">
                    <section class="finanzas-panel">
                        <h3>Cuentas por pagar</h3>
                        <div id="listaCuentasPagarPOS" class="finanzas-lista"></div>
                    </section>
                    <section class="finanzas-panel">
                        <h3>Gastos recientes</h3>
                        <div id="listaGastosPOS" class="finanzas-lista"></div>
                    </section>
                </div>
            </div>
        `;
        main.appendChild(pantalla);
    }

    function instalarMenuFinanzas() {
        const sidebar = document.querySelector(".sidebar");
        if (!sidebar || sidebar.querySelector("[data-modulo='finanzas']")) return;

        const boton = document.createElement("button");
        boton.type = "button";
        boton.dataset.modulo = "finanzas";
        boton.onclick = () => mostrarFinanzasPOS();
        boton.innerHTML =
            (typeof iconoUISVG === "function" ? iconoUISVG("wallet") : "") +
            "<span>Finanzas</span>";

        const antes =
            sidebar.querySelector("[data-modulo='ajustes-inventario']") ||
            sidebar.querySelector("[data-modulo='pedidos-proveedor']") ||
            [...sidebar.querySelectorAll("button")].find(btn => /Reportes/i.test(btn.textContent || ""));

        if (antes) antes.insertAdjacentElement("afterend", boton);
        else sidebar.appendChild(boton);
    }

    function limpiarCampos(ids) {
        ids.forEach(id => {
            const el = document.getElementById(id);
            if (el) el.value = "";
        });
    }

    function setTexto(id, valor) {
        const el = document.getElementById(id);
        if (el) el.textContent = valor;
    }

    async function cargarResumenFinanzas() {
        const respuesta = await fetch("/finanzas/resumen");
        const datos = await respuesta.json();
        if (!respuesta.ok) throw new Error(datos.error || "No se pudo cargar resumen");

        setTexto("finPorPagar", money(datos.por_pagar));
        setTexto("finCuentasAbiertas", datos.cuentas_abiertas || 0);
        setTexto("finVencidas", datos.vencidas || 0);
        setTexto("finGastosMes", money(datos.gastos_mes));
    }

    window.mostrarFinanzasPOS = async function() {
        asegurarPantallaFinanzas();
        instalarMenuFinanzas();
        ocultarPantallasFinanzas();
        document.getElementById("pantallaFinanzas").style.display = "block";

        if (typeof actualizarModuloActivoPOS === "function") {
            actualizarModuloActivoPOS("finanzas");
        }

        if (typeof actualizarTopbarContexto === "function") {
            actualizarTopbarContexto(
                "Finanzas",
                "Cuentas por pagar, pagos a proveedor y gastos",
                "finanzas"
            );
        }

        await cargarFinanzasPOS();
    };

    window.cargarFinanzasPOS = async function() {
        try {
            await cargarResumenFinanzas();
            await cargarCuentasPagarPOS();
            await cargarGastosOperativosPOS();
        } catch (error) {
            alertaPOS(error.message, "Finanzas", "peligro");
        }
    };

    window.guardarCuentaPagarPOS = async function() {
        const payload = {
            proveedor: document.getElementById("finCuentaProveedor")?.value || "",
            concepto: document.getElementById("finCuentaConcepto")?.value || "",
            montoTotal: document.getElementById("finCuentaMonto")?.value || "",
            vencimiento: document.getElementById("finCuentaVencimiento")?.value || null,
            notas: document.getElementById("finCuentaNotas")?.value || ""
        };

        try {
            const respuesta = await fetch("/cuentas-pagar", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload)
            });
            const datos = await respuesta.json();
            if (!respuesta.ok) throw new Error(datos.error || "No se pudo guardar cuenta");

            limpiarCampos([
                "finCuentaProveedor",
                "finCuentaConcepto",
                "finCuentaMonto",
                "finCuentaVencimiento",
                "finCuentaNotas"
            ]);
            await cargarFinanzasPOS();
            alertaPOS("Cuenta registrada", "Quedo pendiente para pago.", "exito");
        } catch (error) {
            alertaPOS(error.message, "Cuenta por pagar", "peligro");
        }
    };

    window.cargarCuentasPagarPOS = async function() {
        const contenedor = document.getElementById("listaCuentasPagarPOS");
        if (!contenedor) return;

        try {
            const respuesta = await fetch("/cuentas-pagar");
            const datos = await respuesta.json();
            if (!respuesta.ok) throw new Error(datos.error || "No se pudieron cargar cuentas");

            estado.cuentas = datos.cuentas || [];

            if (!estado.cuentas.length) {
                contenedor.innerHTML = '<div class="finanzas-empty">Sin cuentas por pagar.</div>';
                return;
            }

            contenedor.innerHTML = estado.cuentas.map(cuenta => `
                <article class="finanzas-card estado-${esc(cuenta.estado)}">
                    <div>
                        <strong>${esc(cuenta.proveedor || "Sin proveedor")}</strong>
                        <span>${esc(cuenta.concepto || "")}</span>
                        <small>${cuenta.vencimiento ? "Vence: " + esc(cuenta.vencimiento) : "Sin vencimiento"}</small>
                    </div>
                    <div>
                        <b>${money(cuenta.saldo)}</b>
                        <small>${esc(cuenta.estado)}</small>
                        ${
                            cuenta.estado === "pagada" || cuenta.estado === "cancelada"
                                ? ""
                                : `<button type="button" onclick="registrarPagoProveedorPOS(${cuenta.id})">Pagar</button>`
                        }
                    </div>
                </article>
            `).join("");
        } catch (error) {
            contenedor.innerHTML = `<div class="finanzas-empty">${esc(error.message)}</div>`;
        }
    };

    window.registrarPagoProveedorPOS = async function(id) {
        const cuenta = estado.cuentas.find(item => Number(item.id) === Number(id));
        if (!cuenta) return;

        const monto = await pedirTextoPOS(
            `Saldo pendiente: ${money(cuenta.saldo)}. Monto a pagar:`,
            cuenta.saldo,
            "Pago a proveedor"
        );

        if (monto === null) return;

        const referencia = await pedirTextoPOS(
            "Referencia, metodo o folio del pago:",
            "",
            "Referencia de pago"
        );

        try {
            const respuesta = await fetch(`/cuentas-pagar/${id}/pagos`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    monto,
                    metodo: referencia || "",
                    referencia: referencia || "",
                    notas: "Pago registrado desde POS"
                })
            });
            const datos = await respuesta.json();
            if (!respuesta.ok) throw new Error(datos.error || "No se pudo registrar pago");

            await cargarFinanzasPOS();
            alertaPOS("Pago registrado", `Nuevo saldo: ${money(datos.saldo)}`, "exito");
        } catch (error) {
            alertaPOS(error.message, "Pago a proveedor", "peligro");
        }
    };

    window.guardarGastoOperativoPOS = async function() {
        const payload = {
            categoria: document.getElementById("finGastoCategoria")?.value || "General",
            concepto: document.getElementById("finGastoConcepto")?.value || "",
            monto: document.getElementById("finGastoMonto")?.value || "",
            metodo: document.getElementById("finGastoMetodo")?.value || "",
            referencia: document.getElementById("finGastoReferencia")?.value || ""
        };

        try {
            const respuesta = await fetch("/gastos-operativos", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload)
            });
            const datos = await respuesta.json();
            if (!respuesta.ok) throw new Error(datos.error || "No se pudo guardar gasto");

            limpiarCampos([
                "finGastoConcepto",
                "finGastoMonto",
                "finGastoMetodo",
                "finGastoReferencia"
            ]);
            await cargarFinanzasPOS();
            alertaPOS("Gasto registrado", "Quedo en la bitacora de gastos.", "exito");
        } catch (error) {
            alertaPOS(error.message, "Gasto operativo", "peligro");
        }
    };

    window.cargarGastosOperativosPOS = async function() {
        const contenedor = document.getElementById("listaGastosPOS");
        if (!contenedor) return;

        try {
            const respuesta = await fetch("/gastos-operativos");
            const datos = await respuesta.json();
            if (!respuesta.ok) throw new Error(datos.error || "No se pudieron cargar gastos");

            estado.gastos = datos.gastos || [];

            if (!estado.gastos.length) {
                contenedor.innerHTML = '<div class="finanzas-empty">Sin gastos registrados.</div>';
                return;
            }

            contenedor.innerHTML = estado.gastos.map(gasto => `
                <article class="finanzas-card">
                    <div>
                        <strong>${esc(gasto.concepto)}</strong>
                        <span>${esc(gasto.categoria || "General")}</span>
                        <small>${esc(gasto.metodo || gasto.referencia || "")}</small>
                    </div>
                    <div>
                        <b>${money(gasto.monto)}</b>
                        <small>${new Date(gasto.created_at).toLocaleDateString()}</small>
                    </div>
                </article>
            `).join("");
        } catch (error) {
            contenedor.innerHTML = `<div class="finanzas-empty">${esc(error.message)}</div>`;
        }
    };

    const estilos = document.createElement("style");
    estilos.textContent = `
        .finanzas-shell{
            display:grid;
            gap:18px;
            color:var(--pos-text,#172033);
        }
        .finanzas-header{
            display:flex;
            justify-content:space-between;
            gap:16px;
            align-items:flex-start;
            padding:20px;
            border:1px solid var(--pos-line,#dbe3ef);
            border-radius:8px;
            background:var(--pos-surface-strong,#fff);
        }
        .finanzas-header span{
            color:var(--brand-color,#0d6efd);
            font-size:12px;
            font-weight:900;
            text-transform:uppercase;
        }
        .finanzas-header h2{
            margin:4px 0;
            font-size:26px;
        }
        .finanzas-header p{
            margin:0;
            color:var(--pos-muted,#687386);
        }
        .finanzas-header button,
        .finanzas-panel-head button,
        .finanzas-card button{
            min-height:40px;
            border:0;
            border-radius:8px;
            padding:0 14px;
            background:var(--brand-color,#0d6efd);
            color:#fff;
            font-weight:800;
            cursor:pointer;
        }
        .finanzas-kpis,
        .finanzas-grid{
            display:grid;
            grid-template-columns:repeat(4,minmax(0,1fr));
            gap:14px;
        }
        .finanzas-grid{
            grid-template-columns:repeat(2,minmax(0,1fr));
        }
        .finanzas-kpis div,
        .finanzas-panel{
            border:1px solid var(--pos-line,#dbe3ef);
            border-radius:8px;
            background:var(--pos-surface-strong,#fff);
            padding:16px;
            min-width:0;
        }
        .finanzas-kpis span{
            display:block;
            color:var(--pos-muted,#687386);
            font-size:12px;
            font-weight:900;
            text-transform:uppercase;
        }
        .finanzas-kpis strong{
            display:block;
            margin-top:6px;
            font-size:24px;
        }
        .finanzas-panel-head{
            display:flex;
            justify-content:space-between;
            gap:12px;
            align-items:center;
        }
        .finanzas-form{
            display:grid;
            grid-template-columns:repeat(2,minmax(0,1fr));
            gap:10px;
            margin-top:12px;
        }
        .finanzas-form input,
        .finanzas-form select{
            min-height:42px;
            border:1px solid var(--pos-line,#dbe3ef);
            border-radius:8px;
            padding:0 11px;
            background:var(--pos-surface,#fff);
            color:inherit;
        }
        .finanzas-lista{
            display:grid;
            gap:10px;
            max-height:560px;
            overflow:auto;
        }
        .finanzas-card{
            display:flex;
            justify-content:space-between;
            gap:12px;
            align-items:center;
            border:1px solid var(--pos-line,#dbe3ef);
            border-radius:8px;
            padding:12px;
            background:var(--pos-surface,#fff);
        }
        .finanzas-card span,
        .finanzas-card small{
            display:block;
            color:var(--pos-muted,#687386);
            font-size:12px;
            margin-top:3px;
        }
        .finanzas-card b{
            display:block;
            margin-bottom:6px;
            color:var(--pos-text,#172033);
        }
        .finanzas-empty{
            border:1px dashed var(--pos-line,#dbe3ef);
            border-radius:8px;
            padding:18px;
            color:var(--pos-muted,#687386);
            text-align:center;
            font-weight:800;
        }
        .finanzas-card.estado-vencida,
        .finanzas-card.estado-pendiente{
            border-left:4px solid #f59e0b;
        }
        .finanzas-card.estado-parcial{
            border-left:4px solid #0d6efd;
        }
        .finanzas-card.estado-pagada{
            border-left:4px solid #16a34a;
        }
        body.oscuro .finanzas-header,
        body.oscuro .finanzas-kpis div,
        body.oscuro .finanzas-panel,
        body.oscuro .finanzas-card,
        body.oscuro .finanzas-form input,
        body.oscuro .finanzas-form select{
            background:rgba(15,23,42,.82);
            border-color:rgba(148,163,184,.22);
            color:#f8fafc;
        }
        body.oscuro .finanzas-card b{
            color:#f8fafc;
        }
        @media(max-width:900px){
            .finanzas-kpis,
            .finanzas-grid,
            .finanzas-form{
                grid-template-columns:1fr;
            }
            .finanzas-header,
            .finanzas-card{
                flex-direction:column;
                align-items:stretch;
            }
        }
    `;

    document.head.appendChild(estilos);

    function iniciarFinanzas() {
        asegurarPantallaFinanzas();
        instalarMenuFinanzas();
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", iniciarFinanzas);
    } else {
        iniciarFinanzas();
    }
})();
