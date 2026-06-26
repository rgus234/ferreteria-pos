const { app, BrowserWindow, ipcMain, shell } = require("electron");
const fs = require("fs/promises");
const path = require("path");
const crypto = require("crypto");
const os = require("os");
const localDb = require("./local-db");

const DEFAULT_API_URL = "https://ferreteria-pos.onrender.com";
const CONFIG_FILE = "desktop-config.json";

let mainWindow;
let configCache;

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
  configCache = {
    ...configCache,
    ...nextConfig,
    deviceId: nextConfig.deviceId || configCache?.deviceId || crypto.randomUUID(),
    apiBaseUrl: normalizeUrl(nextConfig.apiBaseUrl),
    negocioSlug: normalizeSlug(nextConfig.negocioSlug),
    deviceName: nextConfig.deviceName || os.hostname()
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

async function activateDevice() {
  const config = await readConfig();

  return apiRequest("/dispositivos/activar", {
    method: "POST",
    body: JSON.stringify({
      deviceId: config.deviceId,
      nombreEquipo: config.deviceName,
      plataforma: "windows",
      appVersion: app.getVersion()
    })
  });
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
  const eventos = localDb.pendingEvents(100);

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
  } else {
    await loadActivationWindow();
  }
}

ipcMain.handle("nexo:get-config", async () => readConfig());

ipcMain.handle("nexo:activate", async (_event, payload) => {
  const config = await writeConfig({
    apiBaseUrl: payload.apiBaseUrl,
    negocioSlug: payload.negocioSlug,
    deviceName: payload.deviceName
  });

  const activation = await activateDevice();

  await writeConfig({
    ...config,
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

ipcMain.handle("nexo:sync-pull", async () => pullCloudEvents());

ipcMain.handle("nexo:sync-stats", async () => ({
  ok: true,
  stats: localDb.syncStats()
}));

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

ipcMain.handle("nexo:reset-activation", async () => {
  const config = await readConfig();

  await writeConfig({
    ...config,
    activatedAt: null
  });

  await loadActivationWindow();

  return { ok: true };
});

app.whenReady().then(createWindow);

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
