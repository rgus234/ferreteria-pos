/* Celular como escaner de la computadora (lado PC). Se empareja el celular con un codigo/QR y cada codigo que el celular lee llega aqui como
   si fuera de un lector USB: en el punto de venta agrega el producto; si hay un campo enfocado (Agregar producto, recepcion...) lo llena.
   Servidor: escaner-remoto-server.js (/escaner-remoto/*). La sesion se conserva al recargar la pantalla (sessionStorage).

   Estado a la vista: un indicador fijo en la barra de arriba (siempre en el mismo lugar) y el mismo color en todos los botones del celular
   (junto al buscador, Mapa de la tienda, Recibir por marca):
     gris = sin celular, naranja = esperando al celular, verde = conectado (con cuanto lleva), rojo = la computadora perdio la conexion. */
(function instalarEscanerRemotoPOS() {
 if (window.__escanerRemotoPOS) return;
 window.__escanerRemotoPOS = true;

 const LLAVE = "nexoEscanerRemotoSesion";
 let sesion = null;
 let datosSesion = null; // { urlCelular, qr }
 let ultimo = 0;
 let activo = false;
 let celularConectado = false;
 let pcConectada = true;
 let ultimoCodigo = "";
 let ultimoCodigoEn = 0;
 let totalRecibidos = 0;
 let sesionDesde = 0;
 let conectadoDesde = 0; // desde cuando el celular esta conectado seguido (se reinicia si se desconecta)
 let audio = null;

 const ICONO = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="7" y="2" width="10" height="20" rx="2"/><path d="M11 18h2"/><path d="M3 8V6a2 2 0 0 1 2-2h0M21 8V6a2 2 0 0 0-2-2h0M3 16v2a2 2 0 0 0 2 2h0M21 16v2a2 2 0 0 1-2 2h0" opacity=".55"/></svg>';

 const BOTONES_CELULAR = ".er-boton, .mt-celular, .rm-celular";

 function instalarEstilos() {
  if (document.getElementById("erEstilos")) return;

  const estilo = document.createElement("style");
  estilo.id = "erEstilos";
  estilo.textContent = `
   .er-boton{position:relative;display:inline-flex;align-items:center;justify-content:center;width:34px;height:34px;margin:0 4px;border:0;border-radius:10px;background:rgba(29,95,209,.12);color:#1d5fd1;cursor:pointer;flex:none}
   .er-boton:hover{background:rgba(29,95,209,.22)}
   .pos-reference-search{grid-template-columns:36px minmax(0,1fr) auto auto auto !important}
   .er-fondo{position:fixed;inset:0;z-index:100000;display:grid;place-items:center;padding:20px;background:rgba(15,23,42,.55)}
   .er-panel{width:min(460px,100%);max-height:92vh;overflow-y:auto;display:grid;gap:14px;padding:22px;border-radius:20px;background:#fff;color:#0f172a;box-shadow:0 30px 60px -20px rgba(0,0,0,.5);font-family:inherit}
   .er-panel h3{margin:0;font-size:20px}
   .er-panel p{margin:0;color:#475569;font-size:14px;line-height:1.45}
   .er-central{display:grid;justify-items:center;gap:10px}
   .er-central img{width:200px;height:200px;border-radius:14px;border:1px solid #e2e8f0}
   .er-codigo{padding:8px 18px;border-radius:12px;background:#eef2ff;color:#312e81;font:800 30px ui-monospace,Menlo,Consolas,monospace;letter-spacing:.25em}
   .er-pasos{display:grid;gap:6px;margin:0;padding-left:20px;color:#334155;font-size:14px}
   .er-estado{display:flex;align-items:center;gap:8px;padding:10px 12px;border-radius:12px;background:#fff7e0;color:#92400e;font-weight:700;font-size:14px}
   .er-estado.er-ok{background:#e8f7f2;color:#047857}
   .er-estado.er-error{background:#fee2e2;color:#991b1b}
   .er-estado i{width:10px;height:10px;border-radius:50%;background:currentColor;flex:none}
   .er-detalle{display:grid;gap:4px;margin:0;padding:0;list-style:none;color:#475569;font-size:13px}
   .er-botones{display:flex;gap:10px}
   .er-botones button{flex:1;padding:12px;border:0;border-radius:12px;font-weight:800;font-size:14px;cursor:pointer;background:#e2e8f0;color:#0f2a4a}
   .er-botones .er-principal{background:#1d5fd1;color:#fff}
   .er-ultimo{padding:8px 12px;border-radius:10px;background:#f1f5f9;font:700 13px ui-monospace,Menlo,Consolas,monospace;color:#334155}

   /* Indicador fijo en la barra de arriba */
   .er-chip{display:inline-flex;align-items:center;gap:8px;height:42px;padding:0 14px;border:1px solid var(--pos-line,#e2e8f0);border-radius:14px;background:var(--pos-bg,#f3f4f6) !important;color:var(--pos-text,#101828) !important;font:800 13px system-ui,sans-serif;cursor:pointer;white-space:nowrap}
   .er-chip svg{width:18px;height:18px;flex:none}
   .er-chip i{width:10px;height:10px;border-radius:50%;background:#94a3b8;flex:none}
   .er-chip[data-er="espera"]{border-color:#f59e0b}
   .er-chip[data-er="espera"] i{background:#f59e0b;animation:erPulso 1.4s ease-in-out infinite}
   .er-chip[data-er="ok"]{border-color:#18b88f;background:rgba(24,184,143,.14) !important}
   .er-chip[data-er="ok"] i{background:#18b88f}
   .er-chip[data-er="error"]{border-color:#ef4444}
   .er-chip[data-er="error"] i{background:#ef4444}
   @keyframes erPulso{0%,100%{opacity:1;transform:scale(1)}50%{opacity:.35;transform:scale(.8)}}

   /* El mismo estado en los botones del celular (junto al buscador, Mapa de la tienda, Recibir por marca) */
   .er-boton[data-er]::after{content:"";position:absolute;top:2px;right:2px;width:9px;height:9px;border-radius:50%;border:2px solid #fff;background:#94a3b8}
   .er-boton[data-er="espera"]{background:rgba(245,158,11,.2);color:#b45309}
   .er-boton[data-er="espera"]::after{background:#f59e0b;animation:erPulso 1.4s ease-in-out infinite}
   .er-boton[data-er="ok"]{background:#18b88f;color:#04223f}
   .er-boton[data-er="ok"]::after{background:#047857}
   .er-boton[data-er="error"]::after{background:#ef4444}
   .mt-celular[data-er], .rm-celular[data-er]{outline:2px solid transparent;outline-offset:-2px}
   .mt-celular[data-er="espera"], .rm-celular[data-er="espera"]{outline-color:#f59e0b}
   .mt-celular[data-er="ok"], .rm-celular[data-er="ok"]{outline-color:#18b88f}
   .mt-celular[data-er="error"], .rm-celular[data-er="error"]{outline-color:#ef4444}
   .mt-celular[data-er="ok"]::before, .rm-celular[data-er="ok"]::before{content:"● ";color:#18b88f}
   .mt-celular[data-er="espera"]::before, .rm-celular[data-er="espera"]::before{content:"● ";color:#f59e0b}

   @media (prefers-color-scheme: dark){
    :root:not([data-theme="light"]) .er-panel{background:#1e293b;color:#e2e8f0}
    :root:not([data-theme="light"]) .er-panel p, :root:not([data-theme="light"]) .er-pasos, :root:not([data-theme="light"]) .er-detalle{color:#cbd5e1}
    :root:not([data-theme="light"]) .er-codigo{background:#312e81;color:#e0e7ff}
    :root:not([data-theme="light"]) .er-ultimo{background:#334155;color:#e2e8f0}
    :root:not([data-theme="light"]) .er-botones button{background:#334155;color:#e2e8f0}
    :root:not([data-theme="light"]) .er-botones .er-principal{background:#2563eb;color:#fff}
    :root:not([data-theme="light"]) .er-estado{background:rgba(245,158,11,.18);color:#fcd34d}
    :root:not([data-theme="light"]) .er-estado.er-ok{background:rgba(24,184,143,.2);color:#6ee7b7}
    :root:not([data-theme="light"]) .er-estado.er-error{background:rgba(239,68,68,.22);color:#fecaca}
   }
  `;
  document.head.appendChild(estilo);
 }

 function pitido() {
  try {
   audio = audio || new (window.AudioContext || window.webkitAudioContext)();
   const o = audio.createOscillator();
   const g = audio.createGain();
   o.type = "sine";
   o.frequency.value = 1040;
   g.gain.setValueAtTime(0.12, audio.currentTime);
   g.gain.exponentialRampToValueAtTime(0.001, audio.currentTime + 0.1);
   o.connect(g);
   g.connect(audio.destination);
   o.start();
   o.stop(audio.currentTime + 0.11);
  } catch (error) { /* sin audio */ }
 }

 const dormir = ms => new Promise(r => setTimeout(r, ms));

 async function llamar(ruta, metodo = "GET", cuerpo = null) {
  const r = await fetch(ruta, { method: metodo, headers: { "Content-Type": "application/json" }, body: cuerpo ? JSON.stringify(cuerpo) : undefined });
  const datos = await r.json().catch(() => ({}));
  return { ok: r.ok, estado: r.status, datos };
 }

 // "menos de 1 min", "12 min", "1 h 05 min"
 function hace(desde) {
  if (!desde) return "";

  const minutos = Math.floor((Date.now() - desde) / 60000);

  if (minutos < 1) return "menos de 1 min";
  if (minutos < 60) return `${minutos} min`;

  return `${Math.floor(minutos / 60)} h ${String(minutos % 60).padStart(2, "0")} min`;
 }

 // off = sin sesion | espera = sesion abierta, el celular no esta | ok = conectado | error = la computadora perdio la conexion
 function estadoActual() {
  if (!sesion) return "off";
  if (!pcConectada) return "error";
  return celularConectado ? "ok" : "espera";
 }

 // ---- Entrega del codigo, como si fuera un lector USB ----
 function entregar(codigo) {
  ultimoCodigo = codigo;
  ultimoCodigoEn = Date.now();
  totalRecibidos++;
  pitido();
  pintarEstado();

  const mapa = document.getElementById("pantallaMapaTienda");
  if (mapa && mapa.style.display !== "none" && typeof window.mtRecibirCodigo === "function" && window.mtRecibirCodigo(codigo)) return;

  const recibir = document.getElementById("pantallaRecibirMarca");
  if (recibir && recibir.style.display !== "none" && typeof window.rmEscanear === "function" && !document.querySelector('.modal-overlay[style*="flex"], .modal-personalizado[style*="flex"], .modal-form-credito[style*="flex"]')) {
   window.rmEscanear(codigo);
   return;
  }

  const foco = document.activeElement;
  const esCampo = foco && ["INPUT", "TEXTAREA"].includes(foco.tagName) && foco.id !== "busqueda" && !foco.closest("#erFondo") && !["checkbox", "radio", "file", "button"].includes(foco.type);

  if (esCampo) {
   foco.value = codigo;
   foco.dispatchEvent(new Event("input", { bubbles: true }));
   foco.dispatchEvent(new Event("change", { bubbles: true }));
   return;
  }

  const pantalla = document.getElementById("pantallaPuntoVenta");
  const puntoVenta = pantalla && pantalla.style.display !== "none";
  const modalAbierto = document.querySelector('.modal-overlay[style*="flex"], .modal-personalizado[style*="flex"], .modal-form-credito[style*="flex"]');

  if (puntoVenta && !modalAbierto && typeof procesarCodigoBarrasPos === "function") {
   procesarCodigoBarrasPos(typeof normalizarCodigo === "function" ? normalizarCodigo(codigo) : codigo);
   return;
  }

  const busqueda = document.getElementById("busqueda");

  if (busqueda) {
   busqueda.value = codigo;
   busqueda.dispatchEvent(new Event("input", { bubbles: true }));
  }
 }

 // ---- Sesion y espera de codigos ----
 async function crearSesion() {
  const r = await llamar("/escaner-remoto/sesion", "POST", {});

  if (!r.ok) throw new Error(r.datos.error || "No se pudo crear la sesion del celular.");

  sesion = r.datos.sesion;
  datosSesion = { urlCelular: r.datos.urlCelular, qr: r.datos.qr };
  ultimo = 0;
  celularConectado = false;
  conectadoDesde = 0;
  sesionDesde = Date.now();

  try { sessionStorage.setItem(LLAVE, JSON.stringify({ sesion, ...datosSesion, desde: sesionDesde })); } catch (error) { /* sin almacenamiento */ }
 }

 async function bucle() {
  if (activo) return;
  activo = true;

  while (activo && sesion) {
   try {
    const r = await llamar(`/escaner-remoto/esperar?sesion=${encodeURIComponent(sesion)}&desde=${ultimo}&ms=20000`);

    if (r.estado === 404) { await crearSesion(); pintarEstado(); continue; }
    if (!r.ok) { pcConectada = false; pintarEstado(); await dormir(3000); continue; }

    pcConectada = true;
    celularConectado = Boolean(r.datos.celularConectado);

    for (const c of r.datos.codigos || []) {
     ultimo = Math.max(ultimo, c.n);
     entregar(c.codigo);
    }

    pintarEstado();
   } catch (error) {
    pcConectada = false;
    pintarEstado();
    await dormir(3000);
   }
  }

  activo = false;
 }

 async function desconectar() {
  const actual = sesion;

  activo = false;
  sesion = null;
  datosSesion = null;
  celularConectado = false;
  conectadoDesde = 0;
  sesionDesde = 0;
  totalRecibidos = 0;
  ultimoCodigo = "";
  try { sessionStorage.removeItem(LLAVE); } catch (error) { /* sin almacenamiento */ }

  if (actual) llamar("/escaner-remoto/cerrar", "POST", { sesion: actual }).catch(() => {});

  cerrarModal();
  pintarEstado();
 }

 // ---- Indicador fijo en la barra de arriba ----
 function textoChip(estado) {
  if (estado === "ok") return `Celular conectado · ${hace(conectadoDesde)}`;
  if (estado === "espera") return "Esperando al celular";
  if (estado === "error") return "Sin conexión";
  return "Celular";
 }

 function descripcion(estado) {
  if (estado === "ok") return `Celular conectado desde hace ${hace(conectadoDesde)}. Lo que escanees llega aquí.`;
  if (estado === "espera") return "Esperando al celular. Toca para ver el código o el QR.";
  if (estado === "error") return "La computadora perdió la conexión con el servidor.";
  return "Usar el celular como escáner. Toca para conectarlo.";
 }

 function asegurarChip() {
  const acciones = document.querySelector("#topbarPOS .topbar-actions");

  if (!acciones) return null;

  let chip = document.getElementById("erChip");

  if (!chip) {
   chip = document.createElement("button");
   chip.id = "erChip";
   chip.type = "button";
   chip.className = "er-chip";
   chip.addEventListener("click", abrirModal);
  }

  // La barra se vuelve a pintar entera al cambiar de pantalla: el indicador se vuelve a poner en el mismo lugar.
  if (chip.parentElement !== acciones) acciones.insertBefore(chip, acciones.firstChild);

  return chip;
 }

 // ---- Pantallas ----
 function pintarEstado() {
  const estado = estadoActual();

  if (celularConectado && sesion) { if (!conectadoDesde) conectadoDesde = Date.now(); } else conectadoDesde = 0;

  document.querySelectorAll(BOTONES_CELULAR).forEach(boton => {
   if (estado === "off") boton.removeAttribute("data-er"); else boton.dataset.er = estado;
   if (boton.id === "erBoton") boton.title = descripcion(estado);
  });

  const chip = asegurarChip();

  if (chip) {
   chip.dataset.er = estado;
   chip.title = descripcion(estado);
   chip.innerHTML = `<i></i>${ICONO}<span>${textoChip(estado)}${totalRecibidos && estado !== "off" ? ` · ${totalRecibidos} leído${totalRecibidos === 1 ? "" : "s"}` : ""}</span>`;
  }

  const caja = document.getElementById("erEstado");

  if (caja) {
   caja.className = "er-estado" + (estado === "ok" ? " er-ok" : estado === "error" ? " er-error" : "");
   caja.innerHTML = `<i></i><span>${estado === "ok" ? "Celular conectado: escanea con él y los códigos llegan aquí." : estado === "error" ? "La computadora perdió la conexión." : "Esperando al celular…"}</span>`;
  }

  const detalle = document.getElementById("erDetalle");

  if (detalle) {
   detalle.innerHTML = [
    estado === "ok" ? `<li>Conectado desde hace <b>${hace(conectadoDesde)}</b>.</li>` : "",
    sesionDesde ? `<li>Sesión abierta hace <b>${hace(sesionDesde)}</b>. Sigue abierta mientras esta ventana esté abierta; se cierra sola si pasa 4 horas sin usarse.</li>` : "",
    "<li>Si sales de la app del celular y vuelves a abrirla, se reconecta sola.</li>"
   ].join("");
  }

  const ult = document.getElementById("erUltimo");
  if (ult) ult.textContent = ultimoCodigo ? `Último código: ${ultimoCodigo} · hace ${hace(ultimoCodigoEn)}` : "Aún no llega ningún código.";
 }

 function cerrarModal() {
  document.getElementById("erFondo")?.remove();
 }

 async function abrirModal() {
  instalarEstilos();

  try {
   if (!sesion) { await crearSesion(); bucle(); }
  } catch (error) {
   alert(error.message);
   return;
  }

  cerrarModal();

  const fondo = document.createElement("div");
  fondo.id = "erFondo";
  fondo.className = "er-fondo";
  fondo.innerHTML = `<div class="er-panel" role="dialog" aria-label="Celular como escáner">
    <h3>Usar el celular como escáner</h3>
    <div class="er-central">
     <img src="${datosSesion.qr}" alt="Código QR para el celular">
     <div class="er-codigo">${sesion}</div>
    </div>
    <ol class="er-pasos">
     <li>En el celular abre Nexo y entra a <b>Inventario → Escáner de la compu</b>.</li>
     <li>Escribe el código de arriba, o escanea este QR.</li>
     <li>Escanea los productos con la cámara: aquí se agregan solos.</li>
    </ol>
    <div id="erEstado" class="er-estado"><i></i><span>Esperando al celular…</span></div>
    <ul id="erDetalle" class="er-detalle"></ul>
    <div id="erUltimo" class="er-ultimo"></div>
    <div class="er-botones"><button type="button" id="erDesconectar">Desconectar</button><button type="button" class="er-principal" id="erCerrar">Listo</button></div>
   </div>`;
  document.body.appendChild(fondo);

  fondo.addEventListener("click", ev => { if (ev.target === fondo) cerrarModal(); });
  fondo.querySelector("#erCerrar").addEventListener("click", cerrarModal);
  fondo.querySelector("#erDesconectar").addEventListener("click", desconectar);
  pintarEstado();
 }

 function insertarBoton() {
  if (document.getElementById("erBoton")) return;

  const referencia = document.getElementById("posBusquedaIaToggle") || document.querySelector(".pos-reference-search button");

  if (!referencia) return;

  const boton = document.createElement("button");
  boton.id = "erBoton";
  boton.type = "button";
  boton.className = "er-boton";
  boton.title = "Usar el celular como escáner";
  boton.setAttribute("aria-label", "Usar el celular como escáner");
  boton.innerHTML = ICONO;
  boton.addEventListener("click", abrirModal);
  referencia.insertAdjacentElement("beforebegin", boton);
  pintarEstado();
 }

 window.abrirEscanerRemotoPOS = abrirModal;

 // Si la pantalla se recarga con una sesion viva, se retoma sola.
 async function retomar() {
  try {
   const guardada = JSON.parse(sessionStorage.getItem(LLAVE) || "null");
   if (!guardada?.sesion) return;

   const r = await llamar(`/escaner-remoto/esperar?sesion=${encodeURIComponent(guardada.sesion)}&desde=0&ms=0`);
   if (!r.ok) { sessionStorage.removeItem(LLAVE); return; }

   sesion = guardada.sesion;
   datosSesion = { urlCelular: guardada.urlCelular, qr: guardada.qr };
   sesionDesde = guardada.desde || Date.now();
   ultimo = r.datos.ultimo || 0;
   celularConectado = Boolean(r.datos.celularConectado);
   pintarEstado();
   bucle();
  } catch (error) { /* sin sesion que retomar */ }
 }

 // La barra de arriba se vuelve a dibujar cada vez que cambia el titulo: el indicador se acomoda de nuevo.
 function enganchar() {
  if (typeof window.renderTopbarPOS !== "function" || window.renderTopbarPOS.__conEscaner) return;

  const original = window.renderTopbarPOS;
  const conEscaner = function () {
   const resultado = original.apply(this, arguments);
   try { pintarEstado(); } catch (error) { /* el indicador nunca debe estorbar a la barra */ }
   return resultado;
  };

  conEscaner.__conEscaner = true;
  window.renderTopbarPOS = conEscaner;
 }

 function iniciar() {
  instalarEstilos();
  enganchar();
  pintarEstado();
  insertarBoton();
  retomar();
  // El POS se pinta despues en algunos arranques: se reintenta un momento.
  let intentos = 0;
  const reintento = setInterval(() => { insertarBoton(); asegurarChip(); pintarEstado(); if ((document.getElementById("erBoton") && document.getElementById("erChip")) || ++intentos > 20) clearInterval(reintento); }, 1000);
  // El "hace X min" se refresca solo.
  setInterval(() => { if (sesion) pintarEstado(); }, 30000);
 }

 if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", iniciar); else iniciar();
})();
