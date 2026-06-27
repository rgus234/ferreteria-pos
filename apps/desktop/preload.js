const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("nexoDesktop", {
  getConfig: () => ipcRenderer.invoke("nexo:get-config"),
  activate: payload => ipcRenderer.invoke("nexo:activate", payload),
  licenseStatus: () => ipcRenderer.invoke("nexo:license-status"),
  checkIn: () => ipcRenderer.invoke("nexo:checkin"),
  updateStatus: () => ipcRenderer.invoke("nexo:update-status"),
  updateCheck: () => ipcRenderer.invoke("nexo:update-check"),
  updateInstall: () => ipcRenderer.invoke("nexo:update-install"),
  onUpdateStatus: callback => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on("nexo:update-status-changed", listener);
    return () => ipcRenderer.removeListener("nexo:update-status-changed", listener);
  },
  resetActivation: () => ipcRenderer.invoke("nexo:reset-activation"),
  queueEvent: payload => ipcRenderer.invoke("nexo:queue-event", payload),
  syncPush: () => ipcRenderer.invoke("nexo:sync-push"),
  syncRetry: () => ipcRenderer.invoke("nexo:sync-retry"),
  syncPull: () => ipcRenderer.invoke("nexo:sync-pull"),
  syncStats: () => ipcRenderer.invoke("nexo:sync-stats"),
  localDataStats: () => ipcRenderer.invoke("nexo:local-data-stats"),
  saveCache: payload => ipcRenderer.invoke("nexo:cache-save", payload),
  getCache: payload => ipcRenderer.invoke("nexo:cache-get", payload),
  getStructuredCache: payload => ipcRenderer.invoke("nexo:structured-cache-get", payload)
});
