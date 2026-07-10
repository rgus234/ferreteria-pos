/* Sistema de dialogos propio del panel de Admin, adaptado del patron
   dialogoPOS()/alertaPOS()/confirmarPOS()/pedirTextoPOS() de public/js/config-auth.js.
   Copia autonoma (el panel de Admin no comparte scripts con el POS principal) para
   reemplazar los alert()/prompt()/confirm() nativos del navegador. */

function dialogoAdmin(opciones = {}) {
  const {
    tipo = "info",
    titulo = "Aviso",
    mensaje = "",
    textoAceptar = "Aceptar",
    textoCancelar = "Cancelar",
    mostrarCancelar = false,
    entrada = false,
    valorInicial = "",
    placeholder = ""
  } = opciones;

  return new Promise(resolve => {
    let modal = document.getElementById("modalDialogoAdmin");

    if (!modal) {
      modal = document.createElement("div");
      modal.id = "modalDialogoAdmin";
      modal.className = "dialogo-admin-overlay";
      document.body.appendChild(modal);
    }

    const limpiar = valor => String(valor ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");

    const iconos = { info: "i", exito: "OK", alerta: "!", peligro: "!" };

    modal.innerHTML = `
      <div class="dialogo-admin-card dialogo-admin-${tipo}">
        <div class="dialogo-admin-icon">${iconos[tipo] || "i"}</div>
        <div class="dialogo-admin-body">
          <h2>${limpiar(titulo)}</h2>
          <p>${limpiar(mensaje)}</p>
          ${entrada ? `<input id="dialogoAdminInput" value="${limpiar(valorInicial)}" placeholder="${limpiar(placeholder)}">` : ""}
        </div>
        <div class="dialogo-admin-actions">
          ${mostrarCancelar ? `<button type="button" class="dialogo-admin-cancelar">${textoCancelar}</button>` : ""}
          <button type="button" class="dialogo-admin-aceptar">${textoAceptar}</button>
        </div>
      </div>
    `;

    modal.style.display = "flex";

    const cerrar = valor => {
      modal.style.display = "none";
      resolve(valor);
    };

    const input = modal.querySelector("#dialogoAdminInput");

    modal.querySelector(".dialogo-admin-aceptar")?.addEventListener("click", () => {
      cerrar(entrada ? input.value : true);
    });

    modal.querySelector(".dialogo-admin-cancelar")?.addEventListener("click", () => {
      cerrar(entrada ? null : false);
    });

    modal.addEventListener("click", event => {
      if (event.target === modal && mostrarCancelar) {
        cerrar(entrada ? null : false);
      }
    }, { once: true });

    modal.addEventListener("keydown", event => {
      if (event.key === "Escape" && mostrarCancelar) {
        cerrar(entrada ? null : false);
      }
      if (event.key === "Enter") {
        cerrar(entrada ? input?.value : true);
      }
    }, { once: true });

    (input || modal.querySelector(".dialogo-admin-aceptar"))?.focus();
    input?.select();
  });
}

function alertaAdmin(mensaje, titulo = "Aviso", tipo = "info") {
  return dialogoAdmin({ tipo, titulo, mensaje, textoAceptar: "Entendido" });
}

function confirmarAdmin(mensaje, titulo = "Confirmar", tipo = "alerta") {
  return dialogoAdmin({
    tipo,
    titulo,
    mensaje,
    mostrarCancelar: true,
    textoAceptar: "Confirmar",
    textoCancelar: "Cancelar"
  });
}

function pedirTextoAdmin(mensaje, valorInicial = "", titulo = "Completar dato") {
  return dialogoAdmin({
    tipo: "info",
    titulo,
    mensaje,
    entrada: true,
    valorInicial,
    mostrarCancelar: true,
    textoAceptar: "Guardar",
    textoCancelar: "Cancelar"
  });
}
