const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("nexoDesktop", {
  getConfig: () => ipcRenderer.invoke("nexo:get-config"),
  saveDeviceLink: payload => ipcRenderer.invoke("nexo:save-device-link", payload),
  clearDeviceLink: () => ipcRenderer.invoke("nexo:clear-device-link"),
  updateStatus: () => ipcRenderer.invoke("nexo:update-status"),
  updateCheck: () => ipcRenderer.invoke("nexo:update-check"),
  updateInstall: () => ipcRenderer.invoke("nexo:update-install"),
  retryAfterUpdateLoop: () => ipcRenderer.invoke("nexo:retry-after-update-loop"),
  onUpdateStatus: callback => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on("nexo:update-status-changed", listener);
    return () => ipcRenderer.removeListener("nexo:update-status-changed", listener);
  },
  queueEvent: payload => ipcRenderer.invoke("nexo:queue-event", payload),
  syncPush: () => ipcRenderer.invoke("nexo:sync-push"),
  syncRetry: () => ipcRenderer.invoke("nexo:sync-retry"),
  syncPull: () => ipcRenderer.invoke("nexo:sync-pull"),
  syncStats: () => ipcRenderer.invoke("nexo:sync-stats"),
  localDataStats: () => ipcRenderer.invoke("nexo:local-data-stats"),
  saveCache: payload => ipcRenderer.invoke("nexo:cache-save", payload),
  getCache: payload => ipcRenderer.invoke("nexo:cache-get", payload),
  getStructuredCache: payload => ipcRenderer.invoke("nexo:structured-cache-get", payload),
  listPrinters: () => ipcRenderer.invoke("nexo:list-printers"),
  printTicket: payload => ipcRenderer.invoke("nexo:print-ticket", payload),
  openCashDrawer: payload => ipcRenderer.invoke("nexo:open-cash-drawer", payload)
});
