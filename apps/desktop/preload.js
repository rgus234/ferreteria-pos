const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("nexoDesktop", {
  getConfig: () => ipcRenderer.invoke("nexo:get-config"),
  activate: payload => ipcRenderer.invoke("nexo:activate", payload),
  licenseStatus: () => ipcRenderer.invoke("nexo:license-status"),
  resetActivation: () => ipcRenderer.invoke("nexo:reset-activation")
});
