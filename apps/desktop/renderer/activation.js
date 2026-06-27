const form = document.getElementById("activationForm");
const button = document.getElementById("activateButton");
const statusMessage = document.getElementById("statusMessage");
const apiBaseUrl = document.getElementById("apiBaseUrl");
const licenseKey = document.getElementById("licenseKey");
const negocioSlug = document.getElementById("negocioSlug");
const deviceName = document.getElementById("deviceName");

function setStatus(message, isError = false) {
  statusMessage.textContent = message || "";
  statusMessage.classList.toggle("error", Boolean(isError));
}

function normalizeSlug(value) {
  return String(value || "ferreteria-olimpico")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "ferreteria-olimpico";
}

async function loadDefaults() {
  const config = await window.nexoDesktop.getConfig();

  apiBaseUrl.value = config.apiBaseUrl || "https://ferreteria-pos.onrender.com";
  licenseKey.value = config.licenseKey || "";
  negocioSlug.value = config.negocioSlug || "ferreteria-olimpico";
  deviceName.value = config.deviceName || "";
}

licenseKey.addEventListener("input", () => {
  licenseKey.value = licenseKey.value.toUpperCase().replace(/[^A-Z0-9-]/g, "");
});

negocioSlug.addEventListener("input", () => {
  negocioSlug.value = normalizeSlug(negocioSlug.value);
});

form.addEventListener("submit", async event => {
  event.preventDefault();

  button.disabled = true;
  setStatus("Activando equipo...");

  try {
    await window.nexoDesktop.activate({
      apiBaseUrl: apiBaseUrl.value,
      licenseKey: licenseKey.value,
      negocioSlug: negocioSlug.value,
      deviceName: deviceName.value
    });

    setStatus("Equipo activado. Abriendo Nexo POS...");
  } catch (error) {
    setStatus(error.message || "No se pudo activar este equipo.", true);
    button.disabled = false;
  }
});

loadDefaults().catch(error => {
  setStatus(error.message || "No se pudo cargar la configuracion.", true);
});
