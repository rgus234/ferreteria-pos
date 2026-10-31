/* Celular como escaner de la computadora (lado PC). Se empareja el celular con un codigo/QR y cada codigo que el celular lee llega aqui como
   si fuera de un lector USB: en el punto de venta agrega el producto; si hay un campo enfocado (Agregar producto, recepcion...) lo llena.
   Servidor: escaner-remoto-server.js (/escaner-remoto/*). La sesion se conserva al recargar la pantalla (sessionStorage). */
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
 let totalRecibidos = 0;
 let audio = null;

 const ICONO = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="7" y="2" width="10" height="20" rx="2"/><path d="M11 18h2"/><path d="M3 8V6a2 2 0 0 1 2-2h0M21 8V6a2 2 0 0 0-2-2h0M3 16v2a2 2 0 0 0 2 2h0M21 16v2a2 2 0 0 1-2 2h0" opacity=".55"/></svg>';

 function instalarEstilos() {
  if (document.getElementById("erEstilos")) return;

  const estilo = document.createElement("style");
  estilo.id = "erEstilos";
  estilo.textContent = `
   .er-boton{display:inline-flex;align-items:center;justify-content:center;width:34px;height:34px;margin:0 4px;border:0;border-radius:10px;background:rgba(29,95,209,.12);color:#1d5fd1;cursor:pointer;flex:none}
   .er-boton:hover{background:rgba(29,95,209,.22)}
   .pos-reference-search{grid-template-columns:36px minmax(0,1fr) auto auto auto !important}
   .er-boton.er-activo{background:#18b88f;color:#04223f}
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
   .er-estado i{width:10px;height:10px;border-radius:50%;background:currentColor;flex:none}
   .er-botones{display:flex;gap:10px}
   .er-botones button{flex:1;padding:12px;border:0;border-radius:12px;font-weight:800;font-size:14px;cursor:pointer;background:#e2e8f0;color:#0f2a4a}
   .er-botones .er-principal{background:#1d5fd1;color:#fff}
   .er-pildora{position:fixed;left:16px;bottom:16px;z-index:99990;display:none;align-items:center;gap:8px;padding:9px 14px;border:0;border-radius:999px;background:#0f2a4a;color:#fff;font:700 13px system-ui,sans-serif;box-shadow:0 10px 24px -10px rgba(0,0,0,.6);cursor:pointer}
   .er-pildora.er-visible{display:inline-flex}
   .er-pildora i{width:9px;height:9px;border-radius:50%;background:#fbbf24}
   .er-pildora.er-ok i{background:#34d399}
   .er-ultimo{padding:8px 12px;border-radius:10px;background:#f1f5f9;font:700 13px ui-monospace,Menlo,Consolas,monospace;color:#334155}
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

 // ---- Entrega del codigo, como si fuera un lector USB ----
 function entregar(codigo) {
  ultimoCodigo = codigo;
  totalRecibidos++;
  pitido();
  pintarEstado();

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

  try { sessionStorage.setItem(LLAVE, JSON.stringify({ sesion, ...datosSesion })); } catch (error) { /* sin almacenamiento */ }
 }

 async function bucle() {
  if (activo) return;
  activo = true;

  while (activo && sesion) {
   try {
    const r = await llamar(`/escaner-remoto/esperar?sesion=${encodeURIComponent(sesion)}&desde=${ultimo}&ms=20000`);

    if (r.estado === 404) { await crearSesion(); pintarEstado(); continue; }
    if (!r.ok) { pcConectada = false; await dormir(3000); continue; }

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
  try { sessionStorage.removeItem(LLAVE); } catch (error) { /* sin almacenamiento */ }

  if (actual) llamar("/escaner-remoto/cerrar", "POST", { sesion: actual }).catch(() => {});

  cerrarModal();
  pintarEstado();
 }

 // ---- Pantallas ----
 function pintarEstado() {
  const boton = document.getElementById("erBoton");
  if (boton) boton.classList.toggle("er-activo", Boolean(sesion && celularConectado));

  let pildora = document.getElementById("erPildora");

  if (!sesion) { if (pildora) pildora.classList.remove("er-visible"); }
  else {
   if (!pildora) {
    pildora = document.createElement("button");
    pildora.id = "erPildora";
    pildora.type = "button";
    pildora.className = "er-pildora";
    pildora.addEventListener("click", abrirModal);
    document.body.appendChild(pildora);
   }

   pildora.classList.add("er-visible");
   pildora.classList.toggle("er-ok", celularConectado && pcConectada);
   pildora.innerHTML = `<i></i>${celularConectado ? "Celular conectado" : "Esperando al celular"}${totalRecibidos ? ` · ${totalRecibidos}` : ""}`;
  }

  const estado = document.getElementById("erEstado");

  if (estado) {
   estado.className = "er-estado" + (celularConectado ? " er-ok" : "");
   estado.innerHTML = `<i></i><span>${celularConectado ? "Celular conectado: escanea con él y los códigos llegan aquí." : "Esperando al celular…"}</span>`;
  }

  const ult = document.getElementById("erUltimo");
  if (ult) ult.textContent = ultimoCodigo ? `Último código recibido: ${ultimoCodigo}` : "Aún no llega ningún código.";
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

  instalarEstilos();

  const boton = document.createElement("button");
  boton.id = "erBoton";
  boton.type = "button";
  boton.className = "er-boton";
  boton.title = "Usar el celular como escáner";
  boton.setAttribute("aria-label", "Usar el celular como escáner");
  boton.innerHTML = ICONO;
  boton.addEventListener("click", abrirModal);
  referencia.insertAdjacentElement("beforebegin", boton);
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
   ultimo = r.datos.ultimo || 0;
   celularConectado = Boolean(r.datos.celularConectado);
   pintarEstado();
   bucle();
  } catch (error) { /* sin sesion que retomar */ }
 }

 function iniciar() {
  insertarBoton();
  retomar();
  // El POS se pinta despues en algunos arranques: se reintenta un momento.
  let intentos = 0;
  const reintento = setInterval(() => { insertarBoton(); if (document.getElementById("erBoton") || ++intentos > 20) clearInterval(reintento); }, 1000);
 }

 if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", iniciar); else iniciar();
})();
