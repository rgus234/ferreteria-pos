/* Inicio de abarrotes.

   En un negocio de perfil simple, el Inicio deja de ser el tablero de ferreteria y muestra lo que un
   tendero necesita al abrir: cuanto vendio y cuanto GANO hoy, los ultimos 7 dias, lo que mas le deja,
   lo que vence, lo que toca pedirle al proveedor y el fiado por cobrar. Servidor: inicio-abarrotes-server.js.
   Los demas perfiles siguen con su Inicio de siempre. */

let inicioAbarrotesDatos = null;

function inicioAbEscapar(valor) {
    return String(valor ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function inicioAbDinero(valor) {
    return "$" + Number(valor || 0).toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function inicioAbEntero(valor) {
    return "$" + Math.round(Number(valor || 0)).toLocaleString("es-MX");
}

function inicioAbEsSimple() {
    return typeof perfilTieneAbarrotes === "function" && perfilTieneAbarrotes();
}

function inicioAbContenedor() {
    const pantalla = document.getElementById("pantallaInicio");
    if (!pantalla) return null;

    let contenedor = document.getElementById("inicioAbarrotes");

    if (!contenedor) {
        contenedor = document.createElement("section");
        contenedor.id = "inicioAbarrotes";
        contenedor.className = "inicio-ab";

        const encabezado = pantalla.querySelector(".dashboard-header");
        if (encabezado) encabezado.insertAdjacentElement("afterend", contenedor);
        else pantalla.prepend(contenedor);
    }

    return contenedor;
}

async function cargarInicioAbarrotes() {
    const contenedor = inicioAbContenedor();
    if (!contenedor) return;

    if (!inicioAbEsSimple()) {
        contenedor.innerHTML = "";
        return;
    }

    if (!inicioAbarrotesDatos) contenedor.innerHTML = `<div class="inicio-ab-cargando">Calculando tu día...</div>`;

    try {
        const respuesta = await fetch("/abarrotes/inicio");
        const datos = await respuesta.json().catch(() => ({}));

        if (respuesta.status === 403) {
            contenedor.innerHTML = `<div class="inicio-ab-cargando">Tu usuario no tiene permiso para ver los reportes del negocio.</div>`;
            return;
        }

        if (!respuesta.ok) throw new Error(datos.error || "No se pudo cargar");

        inicioAbarrotesDatos = datos;
        renderInicioAbarrotes();
    } catch (error) {
        if (!inicioAbarrotesDatos) contenedor.innerHTML = `<div class="inicio-ab-cargando">No se pudo calcular tu día. <button type="button" class="inicio-ab-link" onclick="cargarInicioAbarrotes()">Reintentar</button></div>`;
    }
}

function inicioAbComparacion(hoy, ayer) {
    if (!ayer) return hoy > 0 ? "Ayer no hubo ventas" : "Todavía sin ventas hoy";

    const dif = Math.round(((hoy - ayer) / ayer) * 100);
    if (dif === 0) return "Igual que ayer";

    return `${dif > 0 ? "▲" : "▼"} ${Math.abs(dif)}% que ayer (${inicioAbEntero(ayer)})`;
}

function inicioAbBarras(semana) {
    const maximo = Math.max(1, ...semana.map(d => d.total));
    const dias = ["dom", "lun", "mar", "mié", "jue", "vie", "sáb"];

    return `<div class="inicio-ab-barras">${semana.map(d => {
        const alto = Math.max(3, Math.round((d.total / maximo) * 100));
        const gana = d.total > 0 ? Math.round((d.ganancia / d.total) * alto) : 0;
        const nombre = dias[new Date(`${d.dia}T12:00:00`).getDay()];

        return `
        <div class="inicio-ab-barra" title="${inicioAbEscapar(nombre)}: vendiste ${inicioAbDinero(d.total)}, ganaste ${inicioAbDinero(d.ganancia)}">
            <span class="inicio-ab-barra-monto">${d.total > 0 ? inicioAbEntero(d.total) : ""}</span>
            <div class="inicio-ab-barra-columna" style="height:${alto}%"><i style="height:${Math.min(100, alto ? (gana / alto) * 100 : 0)}%"></i></div>
            <span class="inicio-ab-barra-dia">${nombre}</span>
        </div>`;
    }).join("")}</div>`;
}

function inicioAbTextoDias(dias) {
    return dias === 0 ? "hoy" : dias === 1 ? "mañana" : `en ${dias} días`;
}

function renderInicioAbarrotes() {
    const contenedor = inicioAbContenedor();
    const d = inicioAbarrotesDatos;
    if (!contenedor || !d) return;

    const r = d.porRevisar.resumen;
    const revisar = d.porRevisar.lotes.length
        ? `<ul class="inicio-ab-lista">${d.porRevisar.lotes.map(l => `
            <li><span>${inicioAbEscapar(l.nombre)}</span><b class="inicio-ab-etiqueta ${l.estado === "vencido" ? "mal" : "ojo"}">${l.estado === "vencido" ? "Vencido" : l.estado === "hoy" ? "Vence hoy" : l.estado === "manana" ? "Mañana" : `${l.dias} días`} · ${l.cantidad}</b></li>`).join("")}</ul>`
        : `<p class="inicio-ab-vacio">Nada vence en los próximos 3 días.</p>`;

    const surtir = d.porSurtir.length
        ? `<ul class="inicio-ab-lista">${d.porSurtir.map(p => `
            <li><span>${inicioAbEscapar(p.proveedor)} <small>viene ${inicioAbTextoDias(p.dias)}</small></span><b>${inicioAbEntero(p.total)} · ${p.productos} prod.</b></li>`).join("")}</ul>`
        : `<p class="inicio-ab-vacio">No hay pedidos por hacer esta semana. Dile a Nexo qué día viene cada proveedor.</p>`;

    const sv = d.servicios || { operaciones: 0, importe: 0, comision: 0, porProveedor: [] };
    const servicios = sv.operaciones > 0
        ? `<p class="inicio-ab-servicios-total"><strong>${inicioAbDinero(sv.importe)}</strong> en ${sv.operaciones} operación${sv.operaciones === 1 ? "" : "es"} · te quedaron <b class="inicio-ab-verde">${inicioAbDinero(sv.comision)}</b></p>
           <ul class="inicio-ab-lista">${sv.porProveedor.map(p => `<li><span>${inicioAbEscapar(p.proveedor)} <small>${p.tipo === "recarga" ? "recargas" : "pagos"} · ${p.operaciones}</small></span><b>${inicioAbDinero(p.importe)}</b></li>`).join("")}</ul>`
        : `<p class="inicio-ab-vacio">Hoy no has registrado recargas ni pagos de servicios.</p>`;

    const top = d.masGanancia.length
        ? `<ol class="inicio-ab-ranking">${d.masGanancia.map(p => `
            <li><span>${inicioAbEscapar(p.nombre)} <small>${Number(p.unidades.toFixed(1))} vendidos</small></span><b>${inicioAbDinero(p.ganancia)} <em>${p.margen ?? "-"}%</em></b></li>`).join("")}</ol>`
        : `<p class="inicio-ab-vacio">Cuando vendas productos con su costo, aquí verás cuáles te dejan más.</p>`;

    const pierden = d.pierden.length
        ? `<ul class="inicio-ab-lista">${d.pierden.map(p => `
            <li><span>${inicioAbEscapar(p.nombre)}</span><b class="inicio-ab-etiqueta mal">${p.ganancia <= 0 ? `Pierdes ${inicioAbDinero(Math.abs(p.ganancia))}` : `Solo ${p.margen}%`}</b></li>`).join("")}</ul>`
        : `<p class="inicio-ab-vacio">Ningún producto te está dejando poco.</p>`;

    contenedor.innerHTML = `
    <div class="inicio-ab-kpis">
        <article class="inicio-ab-kpi">
            <span>Vendiste hoy</span>
            <strong>${inicioAbDinero(d.hoy.total)}</strong>
            <small>${d.hoy.ventas} venta${d.hoy.ventas === 1 ? "" : "s"} · ${inicioAbComparacion(d.hoy.total, d.hoy.ayerTotal)}</small>
        </article>
        <article class="inicio-ab-kpi inicio-ab-kpi-gana">
            <span>Ganaste hoy</span>
            <strong>${inicioAbDinero(d.hoy.ganancia)}</strong>
            <small>Lo que vendiste menos lo que te costó</small>
        </article>
        <article class="inicio-ab-kpi inicio-ab-kpi-fiado" onclick="abrirCreditos()" role="button" tabindex="0">
            <span>Fiado por cobrar</span>
            <strong>${inicioAbDinero(d.fiado.total)}</strong>
            <small>${d.fiado.clientes} cliente${d.fiado.clientes === 1 ? "" : "s"}${d.fiado.vencido > 0 ? ` · <b class="inicio-ab-rojo">${inicioAbDinero(d.fiado.vencido)} vencido</b>` : ""}</small>
        </article>
    </div>

    ${d.productosSinCosto > 0 ? `<p class="inicio-ab-aviso">A ${d.productosSinCosto} producto${d.productosSinCosto === 1 ? "" : "s"} que vendiste les falta el costo (precio distribuidor): sin él no puedo calcular cuánto ganas con ${d.productosSinCosto === 1 ? "ese" : "esos"}.</p>` : ""}

    <div class="inicio-ab-rejilla">
        <article class="inicio-ab-tarjeta inicio-ab-ancha">
            <header><h3>Últimos 7 días</h3><small><i class="inicio-ab-leyenda-venta"></i> Vendido <i class="inicio-ab-leyenda-gana"></i> Ganado</small></header>
            ${inicioAbBarras(d.semana)}
        </article>

        <article class="inicio-ab-tarjeta">
            <header><h3>Por revisar</h3>${r.vencidos + r.hoy + r.manana + r.proximos > 0 ? `<button type="button" class="inicio-ab-link" onclick="mostrarPorVencer()">Ver todo</button>` : ""}</header>
            ${revisar}
        </article>

        <article class="inicio-ab-tarjeta">
            <header><h3>Toca pedir</h3><button type="button" class="inicio-ab-link" onclick="mostrarPedidoSugerido()">Ver pedidos</button></header>
            ${surtir}
        </article>

        <article class="inicio-ab-tarjeta inicio-ab-servicios">
            <header><h3>Recargas y servicios</h3><button type="button" class="inicio-ab-link" onclick="abrirServiciosPOS()">Registrar</button></header>
            ${servicios}
            <p class="inicio-ab-nota">Su comisión ya cuenta en lo que ganaste hoy.</p>
        </article>

        <article class="inicio-ab-tarjeta">
            <header><h3>Lo que más te deja</h3><button type="button" class="inicio-ab-link" onclick="abrirGananciaProductos()">Ver todos</button></header>
            ${top}
        </article>

        <article class="inicio-ab-tarjeta">
            <header><h3>Dejan poco o pierdes</h3></header>
            ${pierden}
        </article>

        <article class="inicio-ab-tarjeta inicio-ab-ancha inicio-ab-inventario">
            <span><strong>${d.inventario.productos}</strong> productos</span>
            <button type="button" class="inicio-ab-link" onclick="mostrarInventarioBajo()"><strong>${d.inventario.bajos}</strong> por agotarse</button>
            <span><strong>${d.inventario.sinStock}</strong> sin existencia</span>
            <button type="button" class="inicio-ab-link" onclick="cargarInicioAbarrotes()">Actualizar</button>
        </article>
    </div>`;
}

// ---------------------------------------------------------------------
// Reporte: ganancia por producto
// ---------------------------------------------------------------------

async function abrirGananciaProductos(dias = 30) {
    let modal = document.getElementById("modalGananciaProductos");

    if (!modal) {
        modal = document.createElement("div");
        modal.id = "modalGananciaProductos";
        modal.className = "inicio-ab-modal";
        document.body.appendChild(modal);
    }

    modal.style.display = "flex";
    modal.innerHTML = `<div class="inicio-ab-modal-card"><div class="inicio-ab-cargando">Calculando...</div></div>`;

    let datos;

    try {
        const respuesta = await fetch(`/abarrotes/ganancia-productos?dias=${dias}`);
        datos = await respuesta.json();
        if (!respuesta.ok) throw new Error(datos.error || "No se pudo calcular");
    } catch (error) {
        modal.innerHTML = `<div class="inicio-ab-modal-card"><div class="inicio-ab-cargando">${inicioAbEscapar(error.message)} <button type="button" class="inicio-ab-link" onclick="cerrarGananciaProductos()">Cerrar</button></div></div>`;
        return;
    }

    const filas = datos.productos.map(p => `
        <tr>
            <td>${inicioAbEscapar(p.nombre)}</td>
            <td>${Number(p.unidades.toFixed(1))}</td>
            <td>${inicioAbDinero(p.vendido)}</td>
            <td class="${p.ganancia === null ? "inicio-ab-nd" : p.ganancia <= 0 ? "inicio-ab-rojo" : "inicio-ab-verde"}">${p.ganancia === null ? "Falta costo" : inicioAbDinero(p.ganancia)}</td>
            <td>${p.margen === null ? "-" : `${p.margen}%`}</td>
        </tr>`).join("");

    modal.innerHTML = `
    <div class="inicio-ab-modal-card">
        <header class="inicio-ab-modal-cabecera">
            <div><h3>Ganancia por producto</h3><small>${inicioAbDinero(datos.totalVendido)} vendido · <b class="inicio-ab-verde">${inicioAbDinero(datos.totalGanancia)} ganado</b> en ${datos.dias} días</small></div>
            <div class="inicio-ab-periodos">
                ${[7, 30, 90].map(n => `<button type="button" class="${n === datos.dias ? "activo" : ""}" onclick="abrirGananciaProductos(${n})">${n} días</button>`).join("")}
                <button type="button" onclick="cerrarGananciaProductos()">Cerrar</button>
            </div>
        </header>
        <div class="inicio-ab-tabla-caja">
            <table class="inicio-ab-tabla">
                <thead><tr><th>Producto</th><th>Vendidos</th><th>Vendido</th><th>Ganancia</th><th>Margen</th></tr></thead>
                <tbody>${filas || `<tr><td colspan="5" class="inicio-ab-vacio">Todavía no hay ventas en este periodo.</td></tr>`}</tbody>
            </table>
        </div>
        ${datos.sinCosto > 0 ? `<p class="inicio-ab-aviso">${datos.sinCosto} producto${datos.sinCosto === 1 ? "" : "s"} sin costo: ponles su precio distribuidor para saber cuánto ganas.</p>` : ""}
    </div>`;
}

function cerrarGananciaProductos() {
    const modal = document.getElementById("modalGananciaProductos");
    if (modal) modal.style.display = "none";
}

// ---------------------------------------------------------------------
// Enganche con el Inicio de siempre
// ---------------------------------------------------------------------

const mostrarInicioOriginal = window.mostrarInicio;

window.mostrarInicio = function () {
    if (typeof mostrarInicioOriginal === "function") mostrarInicioOriginal();
    if (inicioAbEsSimple()) cargarInicioAbarrotes();
};

document.addEventListener("keydown", evento => {
    if (evento.key === "Escape") cerrarGananciaProductos();
});

// El Inicio tambien se muestra solo al entrar: se refresca cuando el perfil ya esta aplicado y esa pantalla esta a la vista.
function inicioAbRevisarVisible() {
    const pantalla = document.getElementById("pantallaInicio");

    if (inicioAbEsSimple() && pantalla && pantalla.style.display !== "none" && pantalla.offsetParent !== null && !inicioAbarrotesDatos) {
        cargarInicioAbarrotes();
    }
}

setInterval(inicioAbRevisarVisible, 2500);
