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

    CREATE TABLE IF NOT EXISTS productos_cache (
      negocio_slug TEXT NOT NULL,
      producto_id TEXT NOT NULL,
      codigo TEXT,
      nombre TEXT NOT NULL,
      categoria TEXT,
      subcategoria TEXT,
      marca TEXT,
      proveedor TEXT,
      unidad_venta TEXT,
      precio_publico REAL NOT NULL DEFAULT 0,
      precio_mayoreo REAL NOT NULL DEFAULT 0,
      costo REAL NOT NULL DEFAULT 0,
      stock REAL NOT NULL DEFAULT 0,
      stock_minimo REAL NOT NULL DEFAULT 0,
      payload TEXT NOT NULL DEFAULT '{}',
      synced_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (negocio_slug, producto_id)
    );

    CREATE TABLE IF NOT EXISTS clientes_credito_cache (
      negocio_slug TEXT NOT NULL,
      cliente_id TEXT NOT NULL,
      nombre TEXT NOT NULL,
      telefono TEXT,
      limite_credito REAL NOT NULL DEFAULT 0,
      saldo REAL NOT NULL DEFAULT 0,
      payload TEXT NOT NULL DEFAULT '{}',
      synced_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (negocio_slug, cliente_id)
    );

    CREATE TABLE IF NOT EXISTS id_mappings (
      negocio_slug TEXT NOT NULL,
      entidad TEXT NOT NULL,
      local_id TEXT NOT NULL,
      cloud_id TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (negocio_slug, entidad, local_id)
    );

    CREATE INDEX IF NOT EXISTS idx_sync_outbox_estado
    ON sync_outbox (estado, created_at);

    CREATE INDEX IF NOT EXISTS idx_sync_inbox_recibido
    ON sync_inbox (recibido_at);

    CREATE INDEX IF NOT EXISTS idx_resource_cache_endpoint
    ON resource_cache (negocio_slug, endpoint);

    CREATE INDEX IF NOT EXISTS idx_productos_cache_busqueda
    ON productos_cache (negocio_slug, nombre, codigo);

    CREATE INDEX IF NOT EXISTS idx_clientes_credito_cache_nombre
    ON clientes_credito_cache (negocio_slug, nombre);

    CREATE INDEX IF NOT EXISTS idx_id_mappings_cloud
    ON id_mappings (negocio_slug, entidad, cloud_id);
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

function resolveMappedId(negocioSlug, entidad, id) {
  if (!negocioSlug || id === null || id === undefined || id === "") return id;

  const row = ensureDb()
    .prepare(`
      SELECT cloud_id AS cloudId
      FROM id_mappings
      WHERE negocio_slug = ?
      AND entidad = ?
      AND local_id = ?
    `)
    .get(negocioSlug, entidad, String(id));

  return row?.cloudId || id;
}

function resolveEventMappings(event, negocioSlug) {
  if (!negocioSlug || !event?.payload) return event;

  const payload = {
    ...event.payload
  };

  if (payload.productoId) {
    payload.productoId = resolveMappedId(negocioSlug, "producto", payload.productoId);
  }

  if (payload.clienteId) {
    payload.clienteId = resolveMappedId(negocioSlug, "cliente_credito", payload.clienteId);
  }

  return {
    ...event,
    entidadId:
      event.entidad === "producto"
      ? String(resolveMappedId(negocioSlug, "producto", event.entidadId))
      : event.entidad === "cliente_credito"
      ? String(resolveMappedId(negocioSlug, "cliente_credito", event.entidadId))
      : event.entidadId,
    payload
  };
}

function pendingEvents(limit = 100, negocioSlug = null) {
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
    }))
    .map(event => resolveEventMappings(event, negocioSlug));
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

function parsePayload(payload, fallback = {}) {
  try {
    return JSON.parse(payload || "{}");
  } catch (error) {
    return fallback;
  }
}

function numberValue(value) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function saveProductosCache(negocioSlug, productos = []) {
  if (!Array.isArray(productos)) return;

  const stmt = ensureDb().prepare(`
    INSERT INTO productos_cache
      (
        negocio_slug,
        producto_id,
        codigo,
        nombre,
        categoria,
        subcategoria,
        marca,
        proveedor,
        unidad_venta,
        precio_publico,
        precio_mayoreo,
        costo,
        stock,
        stock_minimo,
        payload,
        synced_at
      )
    VALUES
      (
        @negocioSlug,
        @productoId,
        @codigo,
        @nombre,
        @categoria,
        @subcategoria,
        @marca,
        @proveedor,
        @unidadVenta,
        @precioPublico,
        @precioMayoreo,
        @costo,
        @stock,
        @stockMinimo,
        @payload,
        CURRENT_TIMESTAMP
      )
    ON CONFLICT(negocio_slug, producto_id)
    DO UPDATE SET
      codigo = excluded.codigo,
      nombre = excluded.nombre,
      categoria = excluded.categoria,
      subcategoria = excluded.subcategoria,
      marca = excluded.marca,
      proveedor = excluded.proveedor,
      unidad_venta = excluded.unidad_venta,
      precio_publico = excluded.precio_publico,
      precio_mayoreo = excluded.precio_mayoreo,
      costo = excluded.costo,
      stock = excluded.stock,
      stock_minimo = excluded.stock_minimo,
      payload = excluded.payload,
      synced_at = CURRENT_TIMESTAMP
  `);

  const trx = ensureDb().transaction(items => {
    items.forEach(producto => {
      stmt.run({
        negocioSlug,
        productoId: String(producto.id || producto.producto_id || producto.codigo || ""),
        codigo: producto.codigo || "",
        nombre: producto.nombre || "Producto sin nombre",
        categoria: producto.categoria || "",
        subcategoria: producto.subcategoria || "",
        marca: producto.marca || "",
        proveedor: producto.proveedor || "",
        unidadVenta: producto.unidad_venta || producto.unidadVenta || "pieza",
        precioPublico: numberValue(producto.precio_publico ?? producto.precioPublico ?? producto.precio ?? producto.publico),
        precioMayoreo: numberValue(producto.precio_mayoreo ?? producto.precioMayoreo ?? producto.medio_mayoreo ?? producto.medioMayoreo),
        costo: numberValue(producto.costo ?? producto.precio_proveedor ?? producto.distribuidor),
        stock: numberValue(producto.stock),
        stockMinimo: numberValue(producto.stock_minimo ?? producto.stockMinimo),
        payload: JSON.stringify(producto)
      });
    });
  });

  trx(productos.filter(producto => producto?.id || producto?.codigo));
}

function saveClientesCreditoCache(negocioSlug, clientes = []) {
  if (!Array.isArray(clientes)) return;

  const stmt = ensureDb().prepare(`
    INSERT INTO clientes_credito_cache
      (
        negocio_slug,
        cliente_id,
        nombre,
        telefono,
        limite_credito,
        saldo,
        payload,
        synced_at
      )
    VALUES
      (
        @negocioSlug,
        @clienteId,
        @nombre,
        @telefono,
        @limiteCredito,
        @saldo,
        @payload,
        CURRENT_TIMESTAMP
      )
    ON CONFLICT(negocio_slug, cliente_id)
    DO UPDATE SET
      nombre = excluded.nombre,
      telefono = excluded.telefono,
      limite_credito = excluded.limite_credito,
      saldo = excluded.saldo,
      payload = excluded.payload,
      synced_at = CURRENT_TIMESTAMP
  `);

  const trx = ensureDb().transaction(items => {
    items.forEach(cliente => {
      stmt.run({
        negocioSlug,
        clienteId: String(cliente.id || cliente.cliente_id || cliente.nombre || ""),
        nombre: cliente.nombre || "Cliente sin nombre",
        telefono: cliente.telefono || "",
        limiteCredito: numberValue(cliente.limite_credito ?? cliente.limiteCredito),
        saldo: numberValue(cliente.saldo),
        payload: JSON.stringify(cliente)
      });
    });
  });

  trx(clientes.filter(cliente => cliente?.id || cliente?.nombre));
}

function hydrateStructuredCache(negocioSlug, endpoint, payload) {
  if (endpoint === "/productos") {
    saveProductosCache(negocioSlug, payload);
  }

  if (endpoint === "/creditos") {
    saveClientesCreditoCache(negocioSlug, payload?.clientes || []);
  }
}

function saveIdMapping(negocioSlug, entidad, localId, cloudId) {
  if (!negocioSlug || !entidad || !localId || !cloudId) return;

  ensureDb()
    .prepare(`
      INSERT INTO id_mappings
        (negocio_slug, entidad, local_id, cloud_id, created_at)
      VALUES
        (@negocioSlug, @entidad, @localId, @cloudId, CURRENT_TIMESTAMP)
      ON CONFLICT(negocio_slug, entidad, local_id)
      DO UPDATE SET
        cloud_id = excluded.cloud_id
    `)
    .run({
      negocioSlug,
      entidad,
      localId: String(localId),
      cloudId: String(cloudId)
    });
}

function replaceCacheId(table, idColumn, negocioSlug, localId, cloudId) {
  const row = ensureDb()
    .prepare(`
      SELECT payload
      FROM ${table}
      WHERE negocio_slug = ?
      AND ${idColumn} = ?
    `)
    .get(negocioSlug, String(localId));

  if (!row) return;

  const payload = {
    ...parsePayload(row.payload, {}),
    id: Number(cloudId)
  };

  if (String(localId) !== String(cloudId)) {
    ensureDb()
      .prepare(`
        DELETE FROM ${table}
        WHERE negocio_slug = ?
        AND ${idColumn} = ?
      `)
      .run(negocioSlug, String(cloudId));
  }

  ensureDb()
    .prepare(`
      UPDATE ${table}
      SET ${idColumn} = ?,
          payload = ?,
          synced_at = CURRENT_TIMESTAMP
      WHERE negocio_slug = ?
      AND ${idColumn} = ?
    `)
    .run(String(cloudId), JSON.stringify(payload), negocioSlug, String(localId));
}

function applySyncMappings(negocioSlug, aplicados = []) {
  if (!Array.isArray(aplicados) || aplicados.length === 0) return;

  const trx = ensureDb().transaction(items => {
    items.forEach(item => {
      if (item.localId && item.productoId) {
        saveIdMapping(negocioSlug, "producto", item.localId, item.productoId);
        replaceCacheId("productos_cache", "producto_id", negocioSlug, item.localId, item.productoId);
      }

      if (item.localId && item.clienteId) {
        saveIdMapping(negocioSlug, "cliente_credito", item.localId, item.clienteId);
        replaceCacheId("clientes_credito_cache", "cliente_id", negocioSlug, item.localId, item.clienteId);
      }
    });
  });

  trx(aplicados);
}

function localDataStats(negocioSlug) {
  const productos = ensureDb()
    .prepare("SELECT COUNT(*) AS total FROM productos_cache WHERE negocio_slug = ?")
    .get(negocioSlug);

  const clientes = ensureDb()
    .prepare("SELECT COUNT(*) AS total FROM clientes_credito_cache WHERE negocio_slug = ?")
    .get(negocioSlug);

  const cache = ensureDb()
    .prepare("SELECT COUNT(*) AS total FROM resource_cache WHERE negocio_slug = ?")
    .get(negocioSlug);

  const mappings = ensureDb()
    .prepare("SELECT COUNT(*) AS total FROM id_mappings WHERE negocio_slug = ?")
    .get(negocioSlug);

  return {
    productos: Number(productos?.total || 0),
    clientesCredito: Number(clientes?.total || 0),
    recursosCache: Number(cache?.total || 0),
    mapeosId: Number(mappings?.total || 0),
    eventos: syncStats()
  };
}

function getProductosCache(negocioSlug, limit = 5000) {
  return ensureDb()
    .prepare(`
      SELECT
        producto_id AS productoId,
        payload
      FROM productos_cache
      WHERE negocio_slug = ?
      ORDER BY nombre ASC
      LIMIT ?
    `)
    .all(negocioSlug, limit)
    .map(row => {
      const producto = parsePayload(row.payload, {});

      return {
        ...producto,
        id: producto.id ?? row.productoId
      };
    });
}

function getClientesCreditoCache(negocioSlug, limit = 5000) {
  const clientes = ensureDb()
    .prepare(`
      SELECT
        cliente_id AS clienteId,
        saldo,
        payload
      FROM clientes_credito_cache
      WHERE negocio_slug = ?
      ORDER BY saldo DESC, nombre ASC
      LIMIT ?
    `)
    .all(negocioSlug, limit)
    .map(row => {
      const cliente = parsePayload(row.payload, {});

      return {
        ...cliente,
        id: cliente.id ?? row.clienteId,
        saldo: cliente.saldo ?? row.saldo
      };
    });

  const total = clientes.reduce(
    (suma, cliente) => suma + Number(cliente.saldo || 0),
    0
  );

  return {
    clientes,
    total,
    clientesConAdeudo: clientes.filter(cliente => Number(cliente.saldo || 0) > 0).length
  };
}

function getStructuredResource(negocioSlug, endpoint) {
  if (endpoint === "/productos") {
    const productos = getProductosCache(negocioSlug);
    return productos.length > 0 ? productos : null;
  }

  if (endpoint === "/creditos") {
    const creditos = getClientesCreditoCache(negocioSlug);
    return creditos.clientes.length > 0 ? creditos : null;
  }

  return null;
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
  resolveMappedId,
  markEventsSynced,
  markEventsFailed,
  saveInboundEvents,
  syncStats,
  saveResourceCache,
  getResourceCache,
  saveProductosCache,
  saveClientesCreditoCache,
  hydrateStructuredCache,
  localDataStats,
  getProductosCache,
  getClientesCreditoCache,
  getStructuredResource,
  applySyncMappings
};
