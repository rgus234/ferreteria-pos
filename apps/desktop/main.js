const { app, BrowserWindow, ipcMain, shell } = require("electron");
const { autoUpdater } = require("electron-updater");
const fs = require("fs/promises");
const path = require("path");
const crypto = require("crypto");
const os = require("os");
const localDb = require("./local-db");

const DEFAULT_API_URL = "https://ferreteria-pos.onrender.com";
const CONFIG_FILE = "desktop-config.json";

let mainWindow;
let configCache;
let checkinTimer;
let updateTimer;
let updateState = {
  status: "idle",
  updateAvailable: false,
  currentVersion: app.getVersion(),
  latestVersion: null
};

function configPath() {
  return path.join(app.getPath("userData"), CONFIG_FILE);
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

function normalizeUrl(value) {
  const raw = String(value || DEFAULT_API_URL).trim();
  const withProtocol = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  return withProtocol.replace(/\/+$/, "");
}

async function readConfig() {
  if (configCache) return configCache;

  try {
    const content = await fs.readFile(configPath(), "utf8");
    configCache = JSON.parse(content);
  } catch (error) {
    configCache = {};
  }

  if (!configCache.deviceId) {
    configCache.deviceId = crypto.randomUUID();
  }

  configCache.apiBaseUrl = normalizeUrl(configCache.apiBaseUrl);
  configCache.negocioSlug = normalizeSlug(configCache.negocioSlug);
  configCache.deviceName = configCache.deviceName || os.hostname();

  await writeConfig(configCache);
  return configCache;
}

async function writeConfig(nextConfig) {
  const currentConfig = configCache || {};
  const apiBaseUrl =
    nextConfig.apiBaseUrl !== undefined
      ? nextConfig.apiBaseUrl
      : currentConfig.apiBaseUrl;
  const negocioSlug =
    nextConfig.negocioSlug !== undefined
      ? nextConfig.negocioSlug
      : currentConfig.negocioSlug;

  configCache = {
    ...currentConfig,
    ...nextConfig,
    deviceId: nextConfig.deviceId || currentConfig.deviceId || crypto.randomUUID(),
    apiBaseUrl: normalizeUrl(apiBaseUrl),
    negocioSlug: normalizeSlug(negocioSlug),
    deviceName: nextConfig.deviceName || currentConfig.deviceName || os.hostname()
  };

  await fs.mkdir(app.getPath("userData"), { recursive: true });
  await fs.writeFile(configPath(), JSON.stringify(configCache, null, 2));
  localDb.saveSetting("desktopConfig", configCache);
  return configCache;
}

async function apiRequest(endpoint, options = {}) {
  const config = await readConfig();
  const url = `${config.apiBaseUrl}${endpoint}`;
  const headers = {
    "content-type": "application/json",
    "x-negocio-slug": config.negocioSlug,
    "x-device-id": config.deviceId,
    ...(options.headers || {})
  };

  const response = await fetch(url, {
    ...options,
    headers
  });

  const body = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(body.error || `Error HTTP ${response.status}`);
  }

  return body;
}

function emitUpdateStatus(partial) {
  updateState = {
    ...updateState,
    ...partial,
    currentVersion: app.getVersion(),
    updatedAt: new Date().toISOString()
  };

  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("nexo:update-status-changed", updateState);
  }

  return updateState;
}

function configureAutoUpdater() {
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.allowPrerelease = false;

  autoUpdater.on("checking-for-update", () => {
    emitUpdateStatus({
      status: "checking",
      message: "Buscando actualizaciones"
    });
  });

  autoUpdater.on("update-available", info => {
    emitUpdateStatus({
      status: "available",
      updateAvailable: true,
      latestVersion: info?.version || null,
      message: "Actualizacion disponible, descargando"
    });
  });

  autoUpdater.on("update-not-available", info => {
    emitUpdateStatus({
      status: "current",
      updateAvailable: false,
      latestVersion: info?.version || app.getVersion(),
      message: "Nexo POS esta actualizado"
    });
  });

  autoUpdater.on("download-progress", progress => {
    emitUpdateStatus({
      status: "downloading",
      updateAvailable: true,
      downloadPercent: Math.round(progress?.percent || 0),
      message: "Descargando actualizacion"
    });
  });

  autoUpdater.on("update-downloaded", info => {
    emitUpdateStatus({
      status: "downloaded",
      updateAvailable: true,
      latestVersion: info?.version || null,
      message: "Actualizacion descargada, reiniciando"
    });

    setTimeout(() => {
      autoUpdater.quitAndInstall(false, true);
    }, 5000);
  });

  autoUpdater.on("error", error => {
    emitUpdateStatus({
      status: "error",
      updateAvailable: false,
      error: error.message,
      message: "No se pudo actualizar automaticamente"
    });
  });
}

async function checkForUpdateMetadata() {
  const config = await readConfig();
  const plataforma = "windows";
  const currentVersion = app.getVersion();
  const query = new URLSearchParams({
    canal: "stable",
    plataforma,
    currentVersion
  });

  try {
    const response = await apiRequest(`/updates/latest?${query.toString()}`, {
      method: "GET",
      headers: {
        "x-app-version": currentVersion
      }
    });

    const updateInfo = {
      checkedAt: new Date().toISOString(),
      updateAvailable: Boolean(response.updateAvailable),
      currentVersion,
      latestVersion: response.latest?.version || null,
      latest: response.latest || null
    };

    await writeConfig({
      lastUpdateCheck: updateInfo
    });

    return updateInfo;
  } catch (error) {
    const updateInfo = {
      checkedAt: new Date().toISOString(),
      updateAvailable: false,
      currentVersion,
      latestVersion: config.lastUpdateCheck?.latestVersion || null,
      error: error.message
    };

    await writeConfig({
      lastUpdateCheck: updateInfo
    });

    return updateInfo;
  }
}

async function runAutoUpdateCheck(options = {}) {
  const manual = Boolean(options.manual);
  const metadata = await checkForUpdateMetadata();

  emitUpdateStatus({
    status: app.isPackaged ? "metadata" : "development",
    updateAvailable: Boolean(metadata.updateAvailable),
    latestVersion: metadata.latestVersion,
    latest: metadata.latest,
    message: app.isPackaged
      ? "Metadata de version consultada"
      : "Auto-update real solo corre en la app instalada"
  });

  if (!app.isPackaged) {
    return {
      ok: true,
      packaged: false,
      metadata,
      state: updateState
    };
  }

  try {
    emitUpdateStatus({
      status: "checking",
      message: manual ? "Buscando actualizacion manual" : "Buscando actualizacion"
    });

    const result = await autoUpdater.checkForUpdates();

    return {
      ok: true,
      packaged: true,
      metadata,
      updateInfo: result?.updateInfo || null,
      state: updateState
    };
  } catch (error) {
    emitUpdateStatus({
      status: "error",
      error: error.message,
      message: "No se pudo consultar la actualizacion"
    });

    return {
      ok: false,
      packaged: true,
      metadata,
      error: error.message,
      state: updateState
    };
  }
}

async function activateDevice() {
  const config = await readConfig();
  const updateInfo = await checkForUpdateMetadata();

  return apiRequest("/dispositivos/activar", {
    method: "POST",
    body: JSON.stringify({
      deviceId: config.deviceId,
      licenseKey: config.licenseKey || "",
      nombreEquipo: config.deviceName,
      plataforma: "windows",
      appVersion: app.getVersion(),
      osVersion: os.release(),
      arch: os.arch(),
      update: updateInfo
    })
  });
}

async function checkInDevice() {
  const config = await readConfig();
  const syncStats = localDb.syncStats();
  const localStats = localDb.localDataStats(config.negocioSlug);
  const updateInfo = await checkForUpdateMetadata();

  try {
    const response = await apiRequest("/dispositivos/checkin", {
      method: "POST",
      body: JSON.stringify({
        appVersion: app.getVersion(),
        osVersion: os.release(),
        arch: os.arch(),
        update: updateInfo,
        sync: syncStats,
        localStats
      })
    });

    if (response?.licencia) {
      localDb.saveLicense(config.negocioSlug, response.licencia);
      await writeConfig({
        lastLicense: response.licencia,
        lastLicenseCheckAt: new Date().toISOString(),
        lastCheckinAt: new Date().toISOString()
      });
    } else {
      await writeConfig({
        lastCheckinAt: new Date().toISOString()
      });
    }

    return {
      ok: true,
      ...response
    };
  } catch (error) {
    await writeConfig({
      lastCheckinError: error.message,
      lastCheckinErrorAt: new Date().toISOString()
    });

    return {
      ok: false,
      offline: true,
      error: error.message,
      stats: syncStats
    };
  }
}

function saveActivationLocally(config, activation) {
  localDb.saveDeviceState({
    deviceId: config.deviceId,
    negocioSlug: config.negocioSlug,
    deviceName: config.deviceName,
    apiBaseUrl: config.apiBaseUrl,
    activatedAt: config.activatedAt || new Date().toISOString(),
    appVersion: app.getVersion()
  });

  if (activation?.licencia) {
    localDb.saveLicense(config.negocioSlug, activation.licencia);
  }
}

async function syncPendingEvents() {
  const config = await readConfig();
  const eventos = localDb.pendingEvents(100, config.negocioSlug);

  if (eventos.length === 0) {
    return {
      ok: true,
      enviados: 0,
      aceptados: [],
      duplicados: [],
      errores: [],
      stats: localDb.syncStats()
    };
  }

  try {
    const response = await apiRequest("/sync/push", {
      method: "POST",
      body: JSON.stringify({
        deviceId: config.deviceId,
        eventos
      })
    });

    const synced = [
      ...(response.aceptados || []),
      ...(response.duplicados || [])
    ];

    localDb.markEventsSynced(synced);
    localDb.applySyncMappings(config.negocioSlug, response.aplicados || []);

    const failed = eventos
      .map(event => event.eventId)
      .filter(eventId => !synced.includes(eventId));

    if (failed.length > 0) {
      localDb.markEventsFailed(failed, "La nube no confirmo el evento");
    }

    return {
      ...response,
      enviados: eventos.length,
      stats: localDb.syncStats()
    };
  } catch (error) {
    localDb.markEventsFailed(
      eventos.map(event => event.eventId),
      error.message
    );

    return {
      ok: false,
      enviados: 0,
      error: error.message,
      stats: localDb.syncStats()
    };
  }
}

async function retryFailedAndSync() {
  const reactivados = localDb.retryFailedEvents();
  const resultado = await syncPendingEvents();

  return {
    ...resultado,
    reactivados,
    stats: localDb.syncStats()
  };
}

async function pullCloudEvents() {
  const response = await apiRequest("/sync/pull", {
    method: "GET"
  });

  localDb.saveInboundEvents(response.eventos || []);

  return {
    ...response,
    recibidos: (response.eventos || []).length
  };
}

async function loadPosWindow() {
  const config = await readConfig();
  const url =
    `${config.apiBaseUrl}/?desktop=1&negocio=${encodeURIComponent(config.negocioSlug)}`;

  await mainWindow.loadURL(url);
}

async function loadActivationWindow() {
  await mainWindow.loadFile(path.join(__dirname, "renderer", "activation.html"));
}

async function createWindow() {
  localDb.initLocalDatabase(app.getPath("userData"));

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 1024,
    minHeight: 700,
    title: "Nexo POS",
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  mainWindow.once("ready-to-show", () => {
    mainWindow.show();
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });

  const config = await readConfig();

  if (config.activatedAt) {
    await loadPosWindow();
    checkInDevice();
    setTimeout(() => {
      runAutoUpdateCheck().catch(() => {});
    }, 15000);
  } else {
    await loadActivationWindow();
  }
}

function startBackgroundJobs() {
  if (checkinTimer) return;

  checkinTimer = setInterval(async () => {
    const config = await readConfig();
    if (config.activatedAt) {
      await checkInDevice();
    }
  }, 60 * 1000);

  updateTimer = setInterval(async () => {
    const config = await readConfig();
    if (config.activatedAt) {
      await runAutoUpdateCheck();
    }
  }, 30 * 60 * 1000);
}

ipcMain.handle("nexo:get-config", async () => readConfig());

ipcMain.handle("nexo:activate", async (_event, payload) => {
  const config = await writeConfig({
    apiBaseUrl: payload.apiBaseUrl,
    negocioSlug: payload.negocioSlug,
    deviceName: payload.deviceName,
    licenseKey: payload.licenseKey
  });

  const activation = await activateDevice();
  const activatedSlug =
    activation?.negocio?.slug || config.negocioSlug;
  const activatedLicense =
    activation?.licencia?.license_key ||
    activation?.licencia?.licenseKey ||
    config.licenseKey ||
    payload.licenseKey ||
    "";

  await writeConfig({
    ...config,
    negocioSlug: activatedSlug,
    licenseKey: activatedLicense,
    activatedAt: new Date().toISOString(),
    lastLicense: activation.licencia || null
  });

  saveActivationLocally(await readConfig(), activation);

  await loadPosWindow();

  return {
    ok: true,
    config: await readConfig(),
    activation
  };
});

ipcMain.handle("nexo:license-status", async () => {
  const config = await readConfig();

  try {
    const status = await apiRequest("/licencia/estado");

    localDb.saveLicense(config.negocioSlug, status.licencia);

    await writeConfig({
      lastLicense: status.licencia,
      lastLicenseCheckAt: new Date().toISOString()
    });

    return {
      ...status,
      offline: false
    };
  } catch (error) {
    return {
      ok: false,
      offline: true,
      error: error.message,
      cached: localDb.lastLicense(config.negocioSlug)
    };
  }
});

ipcMain.handle("nexo:checkin", async () => checkInDevice());

ipcMain.handle("nexo:update-status", async () => ({
  ok: true,
  state: updateState,
  metadata: await checkForUpdateMetadata()
}));

ipcMain.handle("nexo:update-check", async () => runAutoUpdateCheck({ manual: true }));

ipcMain.handle("nexo:update-install", async () => {
  if (!app.isPackaged) {
    return {
      ok: false,
      error: "La instalacion de updates solo funciona en la app empaquetada"
    };
  }

  autoUpdater.quitAndInstall(false, true);
  return { ok: true };
});

ipcMain.handle("nexo:queue-event", async (_event, payload) => {
  if (!payload?.tipo) {
    throw new Error("tipo de evento requerido");
  }

  const eventId =
    payload?.eventId || crypto.randomUUID();

  localDb.enqueueEvent({
    eventId,
    tipo: payload?.tipo,
    entidad: payload?.entidad,
    entidadId: payload?.entidadId,
    payload: payload?.payload || {}
  });

  return {
    ok: true,
    eventId,
    stats: localDb.syncStats()
  };
});

ipcMain.handle("nexo:sync-push", async () => syncPendingEvents());

ipcMain.handle("nexo:sync-retry", async () => retryFailedAndSync());

ipcMain.handle("nexo:sync-pull", async () => pullCloudEvents());

ipcMain.handle("nexo:sync-stats", async () => ({
  ok: true,
  stats: localDb.syncStats()
}));

ipcMain.handle("nexo:local-data-stats", async () => {
  const config = await readConfig();

  return {
    ok: true,
    stats: localDb.localDataStats(config.negocioSlug)
  };
});

ipcMain.handle("nexo:cache-save", async (_event, payload) => {
  const config = await readConfig();

  if (!payload?.cacheKey || !payload?.endpoint) {
    throw new Error("cacheKey y endpoint son requeridos");
  }

  localDb.saveResourceCache({
    negocioSlug: config.negocioSlug,
    cacheKey: payload.cacheKey,
    endpoint: payload.endpoint,
    payload: payload.payload
  });

  localDb.hydrateStructuredCache(
    config.negocioSlug,
    payload.endpoint,
    payload.payload
  );

  return {
    ok: true,
    cacheKey: payload.cacheKey
  };
});

ipcMain.handle("nexo:cache-get", async (_event, payload) => {
  const config = await readConfig();

  if (!payload?.cacheKey) {
    throw new Error("cacheKey requerido");
  }

  const cached =
    localDb.getResourceCache(config.negocioSlug, payload.cacheKey);

  return {
    ok: Boolean(cached),
    cacheKey: payload.cacheKey,
    cached
  };
});

ipcMain.handle("nexo:structured-cache-get", async (_event, payload) => {
  const config = await readConfig();

  if (!payload?.endpoint) {
    throw new Error("endpoint requerido");
  }

  const data =
    localDb.getStructuredResource(config.negocioSlug, payload.endpoint);

  return {
    ok: Boolean(data),
    endpoint: payload.endpoint,
    data
  };
});

ipcMain.handle("nexo:reset-activation", async () => {
  const config = await readConfig();

  await writeConfig({
    ...config,
    activatedAt: null
  });

  await loadActivationWindow();

  return { ok: true };
});

app.whenReady().then(async () => {
  configureAutoUpdater();
  await createWindow();
  startBackgroundJobs();
});

app.on("window-all-closed", () => {
  if (checkinTimer) clearInterval(checkinTimer);
  if (updateTimer) clearInterval(updateTimer);
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
