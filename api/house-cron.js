const { hasDatabase, getRuntimeState, upsertRuntimeState } = require("../lib/neon-db");
const { defaultRuntimeState, runHouseScan, sanitizeRuntimeState } = require("../lib/house-runtime");

function buildJsonResponse(res, statusCode, payload) {
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(payload));
}

function readAuthToken(req) {
  const header = String(req.headers?.authorization || "");
  if (header.toLowerCase().startsWith("bearer ")) {
    return header.slice(7).trim();
  }
  return "";
}

function requireAuthorized(req) {
  const expected =
    String(process.env.HOUSE_CRON_SECRET || "").trim() ||
    String(process.env.UPBIT_CRON_SECRET || "").trim();
  if (!expected) {
    throw new Error("Missing HOUSE_CRON_SECRET");
  }
  const actual = readAuthToken(req);
  if (!actual || actual !== expected) {
    const error = new Error("Unauthorized");
    error.statusCode = 401;
    throw error;
  }
}

async function loadPersistedState() {
  const stored = await getRuntimeState("house_auto_trade");
  if (stored.found && stored.state) {
    return sanitizeRuntimeState(stored.state);
  }
  return defaultRuntimeState();
}

module.exports = async function handler(req, res) {
  if (req.method !== "GET" && req.method !== "POST") {
    buildJsonResponse(res, 405, {
      error: "Method not allowed.",
    });
    return;
  }

  try {
    requireAuthorized(req);

    if (!hasDatabase()) {
      buildJsonResponse(res, 503, {
        error: "DATABASE_URL is required for background House scanning.",
      });
      return;
    }

    const currentState = await loadPersistedState();
    const result = await runHouseScan(currentState, { manual: false });
    const saved = await upsertRuntimeState("house_auto_trade", result.state);

    buildJsonResponse(res, 200, {
      ok: true,
      checkedAt: Date.now(),
      state: sanitizeRuntimeState(saved.state || result.state),
      updatedAt: saved.updatedAt,
      summary: result.summary,
    });
  } catch (error) {
    buildJsonResponse(res, error.statusCode || 500, {
      error: error.message || "Unable to process House cron job.",
    });
  }
};
