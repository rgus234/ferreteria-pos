// Pantalla "Nexo Market": resumen de solo lectura de la presencia del
// negocio en el marketplace (Fase 2 admin, ver plan). No duplica el
// switch de visibilidad ni el formulario de destacados/ofertas -- esos
// ya viven en "Sitio web" y en Agregar/Editar producto, aqui solo se
// muestran y se enlaza hacia ellos. Mismo esqueleto que
// sitio-web-view.js (mostrarSitioWeb).

async function mostrarMarketAdmin() {
 if (typeof ocultarPantallasPrincipales === "function") {
 ocultarPantallasPrincipales();
 }

 const pantalla =
 document.getElementById("pantallaMarketAdmin");

 if (!pantalla) return;

 pantalla.style.display = "block";

 if (typeof actualizarTopbarContexto === "function") {
 actualizarTopbarContexto("Nexo Market", "Administra tu presencia en el marketplace de Nexo", "market-admin");
 }

 pantalla.innerHTML = `
 <div class="market-admin-shell">
 <p>Cargando...</p>
 </div>
 `;

 try {
 const respuesta = await fetch("/negocio-actual/market-resumen");
 const datos = await respuesta.json();

 if (!datos.ok) {
 pantalla.innerHTML = `<div class="market-admin-shell"><p>No se pudo cargar tu presencia en Nexo Market.</p></div>`;
 return;
 }

 if (!datos.incluido) {
 renderMarketAdminUpsell(pantalla);
 return;
 }

 renderMarketAdminResumen(pantalla, datos);
 cargarProductosDestacadosMarketAdmin();
 } catch (error) {
 pantalla.innerHTML = `<div class="market-admin-shell"><p>No se pudo cargar tu presencia en Nexo Market. Revisa tu conexion.</p></div>`;
 }
}

function renderMarketAdminUpsell(pantalla) {
 pantalla.innerHTML = `
 <div class="market-admin-shell">
 <div class="sitio-web-upsell">
 <h2>Vende tambien en Nexo Market</h2>
 <p>Con el plan Plus o Pro, tu negocio aparece automaticamente en Nexo Market -- el buscador que junta el catalogo de varias ferreterias Nexo -- ademas de tu propia pagina.</p>
 <button type="button" class="btn-encargo-primario" onclick="mostrarCuenta()">Ver planes</button>
 </div>
 </div>
 `;
}

function renderMarketAdminResumen(pantalla, datos) {
 pantalla.innerHTML = `
 <div class="market-admin-shell">

 <div class="market-admin-estado ${datos.visible ? "visible" : "oculto"}">
 <div>
 <strong>${datos.visible ? "Tu tienda esta visible en Nexo Market" : "Tu tienda esta oculta en Nexo Market"}</strong>
 <p>${datos.visible ? "Los compradores pueden encontrar tu catalogo al buscar en Nexo Market." : "Activa tu sitio web para que tu catalogo aparezca en Nexo Market."}</p>
 </div>
 <div class="market-admin-estado-acciones">
 <button type="button" class="btn-encargo-secundario" onclick="window.open('${datos.urlMarket}', '_blank')">Ver mi tienda en Market</button>
 <button type="button" class="btn-encargo-secundario" onclick="mostrarSitioWeb()">Cambiar visibilidad</button>
 </div>
 </div>

 <div class="market-admin-stats">
 <div class="market-admin-stat">
 <span>Destacados y ofertas</span>
 <strong>${datos.totalDestacadosOfertas}</strong>
 </div>
 <div class="market-admin-stat">
 <span>Pedidos de Market (30 dias)</span>
 <strong>${datos.pedidosMarket30Dias}</strong>
 </div>
 </div>

 <div class="sitio-web-panel">
 <h3 class="sitio-web-panel-titulo">Productos destacados y en oferta</h3>
 <p class="market-admin-nota">Se editan desde Inventario -- aqui solo se ven los que ya marcaste.</p>
 <div id="marketAdminDestacadosLista"><p>Cargando...</p></div>
 </div>

 <div class="sitio-web-panel">
 <h3 class="sitio-web-panel-titulo">Pedidos de Nexo Market</h3>
 <p class="market-admin-nota">Se atienden desde el mismo lugar que tus pedidos del sitio -- los de Market llevan la etiqueta "Nexo Market".</p>
 <button type="button" class="btn-encargo-secundario" onclick="mostrarSitioWeb()">Ver todos mis pedidos</button>
 </div>

 <div class="sitio-web-panel">
 <h3 class="sitio-web-panel-titulo">Proximamente</h3>
 <div class="market-admin-proximamente-grid">
 <div class="market-admin-proximamente-tile">Sucursales</div>
 <div class="market-admin-proximamente-tile">Horarios por dia</div>
 </div>
 </div>

 </div>
 `;
}

async function cargarProductosDestacadosMarketAdmin() {
 const contenedor =
 document.getElementById("marketAdminDestacadosLista");

 if (!contenedor) return;

 try {
 const respuesta = await fetch("/negocio-actual/productos-destacados");
 const datos = await respuesta.json();

 if (!datos.ok) {
 contenedor.innerHTML = `<p>No se pudieron cargar tus productos destacados.</p>`;
 return;
 }

 renderListaDestacadosMarketAdmin(datos.productos || []);
 } catch (error) {
 contenedor.innerHTML = `<p>No se pudieron cargar tus productos destacados. Revisa tu conexion.</p>`;
 }
}

function renderListaDestacadosMarketAdmin(productos) {
 const contenedor =
 document.getElementById("marketAdminDestacadosLista");

 if (!contenedor) return;

 if (!productos.length) {
 contenedor.innerHTML = `<p>Todavia no marcas productos como destacados ni les pones precio de oferta. Hazlo desde Inventario &rarr; Editar producto.</p>`;
 return;
 }

 const escapar =
 typeof escaparPOS === "function" ? escaparPOS : texto => String(texto || "");

 contenedor.innerHTML = productos.map(p => `
 <div class="sitio-web-pedido-item">
 <div class="sitio-web-pedido-cabecera">
 <strong>${escapar(p.nombre)}</strong>
 ${p.destacado ? `<span class="sitio-web-pedido-badge atendido">Destacado</span>` : ""}
 ${p.precioOferta !== null ? `<span class="sitio-web-pedido-tipo cotizacion">Oferta</span>` : ""}
 </div>
 <div class="sitio-web-pedido-cliente">
 $${Number(p.precio).toFixed(2)}${p.precioOferta !== null ? ` &rarr; $${Number(p.precioOferta).toFixed(2)}` : ""}
 </div>
 </div>
 `).join("");
}
