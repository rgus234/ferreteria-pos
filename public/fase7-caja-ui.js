(() => {
 if (window.__fase7CajaUI) return;
 window.__fase7CajaUI = true;

 const num = valor => Number.isFinite(Number(valor)) ? Number(valor) : 0;
 const money = valor => typeof dinero === "function" ? dinero(valor) : "$" + num(valor).toFixed(2);

 async function pintar() {
  const pantalla =
  document.getElementById("pantallaCaja");

  if (!pantalla || pantalla.style.display === "none") return;

  let box =
  document.getElementById("caja7Metodos");

  if (!box) {
   const kpis =
   pantalla.querySelector(".caja6-kpis");

   if (!kpis) return;

   box = document.createElement("div");
   box.id = "caja7Metodos";
   box.className = "caja7-metodos";
   kpis.insertAdjacentElement("afterend", box);
  }

  try {
   const respuesta =
   await fetch("/caja/turno-activo");

   const datos =
   await respuesta.json();

   const resumen =
   datos.resumen || {};

   box.innerHTML = `
   <div><span>Efectivo ventas</span><strong>${money(resumen.efectivo || 0)}</strong></div>
   <div><span>Tarjeta</span><strong>${money(resumen.tarjeta || 0)}</strong></div>
   <div><span>Transferencia</span><strong>${money(resumen.transferencia || 0)}</strong></div>
   <div><span>Credito</span><strong>${money(resumen.credito || 0)}</strong></div>
   `;
  } catch (error) {
   box.innerHTML = "<div><span>Metodos</span><strong>Reinicia servidor</strong></div>";
  }
 }

 const estilos =
 document.createElement("style");

 estilos.textContent = `
 .caja7-metodos{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:14px}
 .caja7-metodos div{border:1px solid var(--pos-line,#dbe3ef);border-radius:8px;background:var(--pos-surface-strong,#fff);padding:16px}
 .caja7-metodos span{display:block;color:var(--pos-muted,#687386);font-size:12px;font-weight:900;text-transform:uppercase}
 .caja7-metodos strong{display:block;margin-top:6px;font-size:21px}
 body.oscuro .caja7-metodos div{background:rgba(15,23,42,.82);border-color:rgba(148,163,184,.22)}
 @media(max-width:900px){.caja7-metodos{grid-template-columns:1fr}}
 `;

 document.head.appendChild(estilos);
 window.refrescarCaja7Metodos = pintar;

 setInterval(pintar, 2000);
 document.addEventListener("click", () => setTimeout(pintar, 300));
 setTimeout(pintar, 1200);
})();
