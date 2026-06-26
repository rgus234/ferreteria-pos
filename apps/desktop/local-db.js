const path = require("path");
const Database = require("better-sqlite3");

let db;

function initLocalDatabase(userDataPath) {
  if (db) return db;

  const dbPath = path.join(userDataPath, "nexo-pos-local.sqlite");
  db = new Database(dbPath);

  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  db.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS device_state (
      device_id TEXT PRIMARY KEY,
      negocio_slug TEXT NOT NULL,
      device_name TEXT,
      api_base_url TEXT NOT NULL,
      activated_at TEXT,
      last_checkin_at TEXT,
      app_version TEXT
    );

    CREATE TABLE IF NOT EXISTS license_cache (
      negocio_slug TEXT PRIMARY KEY,
      payload TEXT NOT NULL,
      modo TEXT,
      checked_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS sync_outbox (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_id TEXT NOT NULL UNIQUE,
      tipo TEXT NOT NULL,
      entidad TEXT,
      entidad_id TEXT,
      payload TEXT NOT NULL DEFAULT '{}',
      estado TEXT NOT NULL DEFAULT 'pendiente',
      intentos INTEGER NOT NULL DEFAULT 0,
      ultimo_error TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      synced_at TEXT
    );

    CREATE TABLE IF NOT EXISTS sync_inbox (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_id TEXT NOT NULL UNIQUE,
      tipo TEXT NOT NULL,
      entidad TEXT,
      entidad_id TEXT,
      payload TEXT NOT NULL DEFAULT '{}',
      recibido_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      aplicado_at TEXT
    );

    CREATE TABLE IF NOT EXISTS resource_cache (
      negocio_slug TEXT NOT NULL,
      cache_key TEXT NOT NULL,
      endpoint TEXT NOT NULL,
      payload TEXT NOT NULL DEFAULT '{}',
      saved_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (negocio_slug, cache_key)
    );

    CREATE INDEX IF NOT EXISTS idx_sync_outbox_estado
    ON sync_outbox (estado, created_at);

    CREATE INDEX IF NOT EXISTS idx_sync_inbox_recibido
    ON sync_inbox (recibido_at);

    CREATE INDEX IF NOT EXISTS idx_resource_cache_endpoint
    ON resource_cache (negocio_slug, endpoint);
  `);

  return db;
}

function ensureDb() {
  if (!db) {
    throw new Error("Base local no inicializada");
  }

  return db;
}

function saveSetting(key, value) {
  ensureDb()
    .prepare(`
      INSERT INTO settings (key, value, updated_at)
      VALUES (@key, @value, CURRENT_TIMESTAMP)
      ON CONFLICT(key)
      DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP
    `)
    .run({
      key,
      value: JSON.stringify(value)
    });
}

function getSetting(key, fallback = null) {
  const row = ensureDb()
    .prepare("SELECT value FROM settings WHERE key = ?")
    .get(key);

  if (!row) return fallback;

  try {
    return JSON.parse(row.value);
  } catch (error) {
    return fallback;
  }
}

function saveDeviceState(config) {
  ensureDb()
    .prepare(`
      INSERT INTO device_state
        (device_id, negocio_slug, device_name, api_base_url, activated_at, last_checkin_at, app_version)
      VALUES
        (@deviceId, @negocioSlug, @deviceName, @apiBaseUrl, @activatedAt, CURRENT_TIMESTAMP, @appVersion)
      ON CONFLICT(device_id)
      DO UPDATE SET
        negocio_slug = excluded.negocio_slug,
        device_name = excluded.device_name,
        api_base_url = excluded.api_base_url,
        activated_at = excluded.activated_at,
        last_checkin_at = CURRENT_TIMESTAMP,
        app_version = excluded.app_version
    `)
    .run(config);
}

function saveLicense(negocioSlug, license) {
  ensureDb()
    .prepare(`
      INSERT INTO license_cache (negocio_slug, payload, modo, checked_at)
      VALUES (@negocioSlug, @payload, @modo, CURRENT_TIMESTAMP)
      ON CONFLICT(negocio_slug)
      DO UPDATE SET
        payload = excluded.payload,
        modo = excluded.modo,
        checked_at = CURRENT_TIMESTAMP
    `)
    .run({
      negocioSlug,
      payload: JSON.stringify(license || {}),
      modo: license?.modo || null
    });
}

function lastLicense(negocioSlug) {
  const row = ensureDb()
    .prepare("SELECT payload, modo, checked_at AS checkedAt FROM license_cache WHERE negocio_slug = ?")
    .get(negocioSlug);

  if (!row) return null;

  return {
    ...row,
    payload: JSON.parse(row.payload)
  };
}

function enqueueEvent(event) {
  ensureDb()
    .prepare(`
      INSERT INTO sync_outbox
        (event_id, tipo, entidad, entidad_id, payload, estado, updated_at)
      VALUES
        (@eventId, @tipo, @entidad, @entidadId, @payload, 'pendiente', CURRENT_TIMESTAMP)
      ON CONFLICT(event_id)
      DO UPDATE SET
        tipo = excluded.tipo,
        entidad = excluded.entidad,
        entidad_id = excluded.entidad_id,
        payload = excluded.payload,
        updated_at = CURRENT_TIMESTAMP
    `)
    .run({
      eventId: event.eventId,
      tipo: event.tipo,
      entidad: event.entidad || null,
      entidadId: event.entidadId || null,
      payload: JSON.stringify(event.payload || {})
    });
}

function pendingEvents(limit = 100) {
  return ensureDb()
    .prepare(`
      SELECT
        event_id AS eventId,
        tipo,
        entidad,
        entidad_id AS entidadId,
        payload
      FROM sync_outbox
      WHERE estado IN ('pendiente', 'error')
      ORDER BY created_at ASC
      LIMIT ?
    `)
    .all(limit)
    .map(row => ({
      ...row,
      payload: JSON.parse(row.payload)
    }));
}

function markEventsSynced(eventIds) {
  if (!eventIds.length) return;

  const stmt = ensureDb().prepare(`
    UPDATE sync_outbox
    SET estado = 'sincronizado',
        synced_at = CURRENT_TIMESTAMP,
        updated_at = CURRENT_TIMESTAMP,
        ultimo_error = NULL
    WHERE event_id = ?
  `);

  const trx = ensureDb().transaction(ids => {
    ids.forEach(id => stmt.run(id));
  });

  trx(eventIds);
}

function markEventsFailed(eventIds, error) {
  if (!eventIds.length) return;

  const stmt = ensureDb().prepare(`
    UPDATE sync_outbox
    SET estado = 'error',
        intentos = intentos + 1,
        ultimo_error = ?,
        updated_at = CURRENT_TIMESTAMP
    WHERE event_id = ?
  `);

  const trx = ensureDb().transaction(ids => {
    ids.forEach(id => stmt.run(String(error || "Error de sincronizacion"), id));
  });

  trx(eventIds);
}

function saveInboundEvents(events) {
  if (!events.length) return;

  const stmt = ensureDb().prepare(`
    INSERT INTO sync_inbox
      (event_id, tipo, entidad, entidad_id, payload, recibido_at)
    VALUES
      (@eventId, @tipo, @entidad, @entidadId, @payload, @recibidoAt)
    ON CONFLICT(event_id) DO NOTHING
  `);

  const trx = ensureDb().transaction(items => {
    items.forEach(event => {
      stmt.run({
        eventId: event.eventId,
        tipo: event.tipo,
        entidad: event.entidad || null,
        entidadId: event.entidadId || null,
        payload: JSON.stringify(event.payload || {}),
        recibidoAt: event.recibidoAt || new Date().toISOString()
      });
    });
  });

  trx(events);
}

function syncStats() {
  const rows = ensureDb()
    .prepare(`
      SELECT estado, COUNT(*) AS total
      FROM sync_outbox
      GROUP BY estado
    `)
    .all();

  const stats = {
    pendiente: 0,
    error: 0,
    sincronizado: 0
  };

  rows.forEach(row => {
    stats[row.estado] = Number(row.total);
  });

  return stats;
}

function saveResourceCache({ negocioSlug, cacheKey, endpoint, payload }) {
  ensureDb()
    .prepare(`
      INSERT INTO resource_cache
        (negocio_slug, cache_key, endpoint, payload, saved_at)
      VALUES
        (@negocioSlug, @cacheKey, @endpoint, @payload, CURRENT_TIMESTAMP)
      ON CONFLICT(negocio_slug, cache_key)
      DO UPDATE SET
        endpoint = excluded.endpoint,
        payload = excluded.payload,
        saved_at = CURRENT_TIMESTAMP
    `)
    .run({
      negocioSlug,
      cacheKey,
      endpoint,
      payload: JSON.stringify(payload)
    });
}

function getResourceCache(negocioSlug, cacheKey) {
  const row = ensureDb()
    .prepare(`
      SELECT endpoint, payload, saved_at AS savedAt
      FROM resource_cache
      WHERE negocio_slug = ?
      AND cache_key = ?
    `)
    .get(negocioSlug, cacheKey);

  if (!row) return null;

  try {
    return {
      ...row,
      payload: JSON.parse(row.payload)
    };
  } catch (error) {
    return null;
  }
}

module.exports = {
  initLocalDatabase,
  saveSetting,
  getSetting,
  saveDeviceState,
  saveLicense,
  lastLicense,
  enqueueEvent,
  pendingEvents,
  markEventsSynced,
  markEventsFailed,
  saveInboundEvents,
  syncStats,
  saveResourceCache,
  getResourceCache
};
