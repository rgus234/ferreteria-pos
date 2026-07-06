(() => {
 if (window.__fixNavegacionDinamicaPOS) return;
 window.__fixNavegacionDinamicaPOS = true;

 const dyn = ["pantallaRecepcionMercancia", "pantallaPedidosProveedor", "pantallaAjustesInventario", "pantallaFinanzas", "pantallaCaja"];
 const base = ["mostrarInicio", "mostrarPuntoVenta", "mostrarInventario", "mostrarCategoriasInventario", "mostrarInventarioBajo", "mostrarGraficas", "mostrarClientes", "mostrarProveedores", "mostrarCatalogo", "mostrarConfiguracion"];
 const map = {
  mostrarRecepcionMercancia: "pantallaRecepcionMercancia",
  mostrarPedidosProveedor: "pantallaPedidosProveedor",
  mostrarAjustesInventario: "pantallaAjustesInventario",
  mostrarFinanzasPOS: "pantallaFinanzas",
  mostrarCajaPOS: "pantallaCaja"
 };

 // Cada navegacion (a cualquier pantalla, base o dinamica) marca un token nuevo.
 // Las acciones retrasadas (hide/show con setTimeout) solo se aplican si nadie
 // navego a otra pantalla mientras tanto -- evita que una pantalla que tardo en
 // cargar sus datos (ej. Finanzas con varias peticiones) reaparezca sola despues
 // de que el usuario ya se movio a otra pantalla.
 let tokenNavegacion = 0;
 function marcarNavegacion() { return ++tokenNavegacion; }

 function hide(except = "") {
  dyn.forEach(id => {
   const el = document.getElementById(id);
   if (el && id !== except) el.style.display = "none";
  });
 }

 function show(id) {
  hide(id);
  const el = document.getElementById(id);
  if (el) el.style.display = "block";
 }

 function wrapBase(name) {
  const old = window[name];
  if (typeof old !== "function" || old.__fixNavDinamica) return;

  const fn = function (...args) {
   const miToken = marcarNavegacion();
   hide();
   const r = old.apply(this, args);
   Promise.resolve(r).finally(() => setTimeout(() => {
    if (tokenNavegacion !== miToken) return;
    hide();
   }, 40));
   return r;
  };
  fn.__fixNavDinamica = true;
  window[name] = fn;
 }

 function wrapDyn(name, id) {
  const old = window[name];
  if (typeof old !== "function" || old.__fixNavDinamica) return;

  const fn = function (...args) {
   const miToken = marcarNavegacion();
   hide(id);
   const r = old.apply(this, args);
   Promise.resolve(r).finally(() => setTimeout(() => {
    if (tokenNavegacion !== miToken) return;
    show(id);
   }, 80));
   return r;
  };
  fn.__fixNavDinamica = true;
  window[name] = fn;
 }

 function install() {
  base.forEach(wrapBase);
  Object.entries(map).forEach(([nombre, id]) => wrapDyn(nombre, id));
 }

 function cleanHtmlError() {
  ["listaAjustesInventario", "listaCuentasPagarPOS", "listaGastosPOS", "listaPedidosProveedor", "caja6Movimientos", "caja6Cortes"].forEach(id => {
   const el = document.getElementById(id);
   if (!el) return;
   const texto = el.textContent || "";
   if (texto.includes("<!DOCTYPE") || texto.includes("Unexpected token '<'")) {
    el.innerHTML = '<div class="fase4-empty finanzas-empty">El servidor aun no cargo este modulo. Reinicia el POS y vuelve a entrar.</div>';
   }
  });
 }

 const estilos = document.createElement("style");
 estilos.textContent = "#pantallaRecepcionMercancia,#pantallaPedidosProveedor,#pantallaAjustesInventario,#pantallaFinanzas,#pantallaCaja{display:none;}";
 document.head.appendChild(estilos);

 [300, 1200, 2500].forEach(ms => setTimeout(() => { install(); hide(); cleanHtmlError(); }, ms));
 document.addEventListener("click", () => setTimeout(() => { install(); cleanHtmlError(); }, 120));
})();
