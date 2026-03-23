const crypto = require("crypto");
const { Pool, neonConfig } = require("@neondatabase/serverless");

neonConfig.fetchConnectionCache = true;

let pool = null;
let schemaReady = null;

function hasDatabase() {
  return Boolean(String(process.env.DATABASE_URL || "").trim());
}

function getPool() {
  if (!hasDatabase()) return null;
  if (!pool) {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
    });
  }
  return pool;
}

function buildSkipped(reason) {
  return {
    ok: true,
    skipped: true,
    reason,
  };
}

function asDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function asNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function asInteger(value) {
  const number = Number(value);
  return Number.isInteger(number) ? number : null;
}

function asText(value, maxLength = 255) {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  if (!text) return null;
  return text.slice(0, maxLength);
}

function asJson(value) {
  return JSON.stringify(value ?? {});
}

async function ensureSchema() {
  if (!hasDatabase()) return buildSkipped("DATABASE_URL not configured.");
  if (!schemaReady) {
    schemaReady = (async () => {
      const client = await getPool().connect();
      try {
        await client.query(`
          CREATE TABLE IF NOT EXISTS signal_events (
            id BIGSERIAL PRIMARY KEY,
            event_id TEXT NOT NULL UNIQUE,
            source TEXT NOT NULL,
            strategy TEXT NOT NULL,
            strategy_version INTEGER,
            signal_type TEXT,
            symbol TEXT NOT NULL,
            token TEXT,
            side TEXT,
            interval TEXT,
            touch TEXT,
            strength TEXT,
            quality_score DOUBLE PRECISION,
            bias_score DOUBLE PRECISION,
            detected_at TIMESTAMPTZ,
            alerted_at TIMESTAMPTZ,
            opened_at TIMESTAMPTZ,
            event_time TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            entry_low DOUBLE PRECISION,
            entry_high DOUBLE PRECISION,
            entry_price DOUBLE PRECISION,
            tp1 DOUBLE PRECISION,
            tp2 DOUBLE PRECISION,
            stop_loss DOUBLE PRECISION,
            leverage INTEGER,
            price_precision INTEGER,
            metadata JSONB NOT NULL DEFAULT '{}'::JSONB
          )
        `);
        await client.query(`
          CREATE TABLE IF NOT EXISTS trade_events (
            id BIGSERIAL PRIMARY KEY,
            event_id TEXT NOT NULL UNIQUE,
            trade_id TEXT NOT NULL,
            source TEXT NOT NULL,
            strategy TEXT NOT NULL,
            strategy_version INTEGER,
            event_type TEXT NOT NULL,
            symbol TEXT NOT NULL,
            side TEXT,
            event_time TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            detected_at TIMESTAMPTZ,
            opened_at TIMESTAMPTZ,
            closed_at TIMESTAMPTZ,
            entry_price DOUBLE PRECISION,
            exit_price DOUBLE PRECISION,
            tp1 DOUBLE PRECISION,
            tp2 DOUBLE PRECISION,
            stop_loss DOUBLE PRECISION,
            leverage INTEGER,
            quantity DOUBLE PRECISION,
            margin_used DOUBLE PRECISION,
            quality_score DOUBLE PRECISION,
            return_pct DOUBLE PRECISION,
            pnl_usd DOUBLE PRECISION,
            balance_after DOUBLE PRECISION,
            metadata JSONB NOT NULL DEFAULT '{}'::JSONB
          )
        `);
        await client.query(`
          CREATE TABLE IF NOT EXISTS alert_deliveries (
            id BIGSERIAL PRIMARY KEY,
            delivery_id TEXT NOT NULL UNIQUE,
            source TEXT NOT NULL,
            strategy TEXT,
            event_type TEXT,
            symbol TEXT,
            title TEXT,
            destination TEXT NOT NULL,
            status TEXT NOT NULL,
            error TEXT,
            sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            payload JSONB NOT NULL DEFAULT '{}'::JSONB
          )
        `);
        await client.query(`
          CREATE TABLE IF NOT EXISTS runtime_states (
            engine TEXT PRIMARY KEY,
            state JSONB NOT NULL DEFAULT '{}'::JSONB,
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
          )
        `);
      } finally {
        client.release();
      }
      return {
        ok: true,
      };
    })().catch((error) => {
      schemaReady = null;
      throw error;
    });
  }
  return schemaReady;
}

async function insertSignalEvent(event = {}) {
  if (!hasDatabase()) return buildSkipped("DATABASE_URL not configured.");
  await ensureSchema();
  const client = await getPool().connect();
  try {
    const eventId = asText(event.eventId, 120) || crypto.randomUUID();
    await client.query(
      `
        INSERT INTO signal_events (
          event_id, source, strategy, strategy_version, signal_type, symbol, token, side, interval, touch,
          strength, quality_score, bias_score, detected_at, alerted_at, opened_at, event_time, entry_low,
          entry_high, entry_price, tp1, tp2, stop_loss, leverage, price_precision, metadata
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
          $11, $12, $13, $14, $15, $16, $17, $18,
          $19, $20, $21, $22, $23, $24, $25, $26::jsonb
        )
        ON CONFLICT (event_id) DO NOTHING
      `,
      [
        eventId,
        asText(event.source, 80) || "client",
        asText(event.strategy, 80) || "unknown",
        asInteger(event.strategyVersion),
        asText(event.signalType, 80),
        asText(event.symbol, 40) || "UNKNOWN",
        asText(event.token, 40),
        asText(event.side, 20),
        asText(event.interval, 20),
        asText(event.touch, 80),
        asText(event.strength, 80),
        asNumber(event.qualityScore),
        asNumber(event.biasScore),
        asDate(event.detectedAt),
        asDate(event.alertedAt),
        asDate(event.openedAt),
        asDate(event.eventTime) || new Date(),
        asNumber(event.entryLow),
        asNumber(event.entryHigh),
        asNumber(event.entryPrice),
        asNumber(event.tp1),
        asNumber(event.tp2),
        asNumber(event.stopLoss),
        asInteger(event.leverage),
        asInteger(event.pricePrecision),
        asJson(event.metadata),
      ]
    );
    return {
      ok: true,
      eventId,
    };
  } finally {
    client.release();
  }
}

async function insertTradeEvent(event = {}) {
  if (!hasDatabase()) return buildSkipped("DATABASE_URL not configured.");
  await ensureSchema();
  const client = await getPool().connect();
  try {
    const eventId = asText(event.eventId, 120) || crypto.randomUUID();
    await client.query(
      `
        INSERT INTO trade_events (
          event_id, trade_id, source, strategy, strategy_version, event_type, symbol, side, event_time,
          detected_at, opened_at, closed_at, entry_price, exit_price, tp1, tp2, stop_loss, leverage,
          quantity, margin_used, quality_score, return_pct, pnl_usd, balance_after, metadata
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9,
          $10, $11, $12, $13, $14, $15, $16, $17, $18,
          $19, $20, $21, $22, $23, $24, $25::jsonb
        )
        ON CONFLICT (event_id) DO NOTHING
      `,
      [
        eventId,
        asText(event.tradeId, 120) || "unknown",
        asText(event.source, 80) || "client",
        asText(event.strategy, 80) || "unknown",
        asInteger(event.strategyVersion),
        asText(event.eventType, 80) || "unknown",
        asText(event.symbol, 40) || "UNKNOWN",
        asText(event.side, 20),
        asDate(event.eventTime) || new Date(),
        asDate(event.detectedAt),
        asDate(event.openedAt),
        asDate(event.closedAt),
        asNumber(event.entryPrice),
        asNumber(event.exitPrice),
        asNumber(event.tp1),
        asNumber(event.tp2),
        asNumber(event.stopLoss),
        asInteger(event.leverage),
        asNumber(event.quantity),
        asNumber(event.marginUsed),
        asNumber(event.qualityScore),
        asNumber(event.returnPct),
        asNumber(event.pnlUsd),
        asNumber(event.balanceAfter),
        asJson(event.metadata),
      ]
    );
    return {
      ok: true,
      eventId,
    };
  } finally {
    client.release();
  }
}

async function insertAlertDelivery(event = {}) {
  if (!hasDatabase()) return buildSkipped("DATABASE_URL not configured.");
  await ensureSchema();
  const client = await getPool().connect();
  try {
    const deliveryId = asText(event.deliveryId, 120) || crypto.randomUUID();
    await client.query(
      `
        INSERT INTO alert_deliveries (
          delivery_id, source, strategy, event_type, symbol, title, destination, status, error, sent_at, payload
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb
        )
        ON CONFLICT (delivery_id) DO NOTHING
      `,
      [
        deliveryId,
        asText(event.source, 80) || "server",
        asText(event.strategy, 80),
        asText(event.eventType, 80),
        asText(event.symbol, 40),
        asText(event.title, 255),
        asText(event.destination, 80) || "unknown",
        asText(event.status, 80) || "unknown",
        asText(event.error, 2000),
        asDate(event.sentAt) || new Date(),
        asJson(event.payload),
      ]
    );
    return {
      ok: true,
      deliveryId,
    };
  } finally {
    client.release();
  }
}

async function getRuntimeState(engine) {
  if (!hasDatabase()) return buildSkipped("DATABASE_URL not configured.");
  await ensureSchema();
  const client = await getPool().connect();
  try {
    const result = await client.query(
      `
        SELECT engine, state, updated_at
        FROM runtime_states
        WHERE engine = $1
        LIMIT 1
      `,
      [asText(engine, 80) || "default"]
    );
    const row = result.rows[0];
    return {
      ok: true,
      found: Boolean(row),
      engine: row?.engine || asText(engine, 80) || "default",
      state: row?.state || null,
      updatedAt: row?.updated_at || null,
    };
  } finally {
    client.release();
  }
}

async function upsertRuntimeState(engine, state) {
  if (!hasDatabase()) return buildSkipped("DATABASE_URL not configured.");
  await ensureSchema();
  const client = await getPool().connect();
  try {
    const runtimeEngine = asText(engine, 80) || "default";
    const result = await client.query(
      `
        INSERT INTO runtime_states (engine, state, updated_at)
        VALUES ($1, $2::jsonb, NOW())
        ON CONFLICT (engine)
        DO UPDATE SET state = EXCLUDED.state, updated_at = NOW()
        RETURNING engine, state, updated_at
      `,
      [runtimeEngine, asJson(state)]
    );
    return {
      ok: true,
      engine: result.rows[0]?.engine || runtimeEngine,
      state: result.rows[0]?.state || state || {},
      updatedAt: result.rows[0]?.updated_at || new Date(),
    };
  } finally {
    client.release();
  }
}

module.exports = {
  hasDatabase,
  ensureSchema,
  insertSignalEvent,
  insertTradeEvent,
  insertAlertDelivery,
  getRuntimeState,
  upsertRuntimeState,
};
