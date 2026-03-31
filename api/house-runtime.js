const { hasDatabase, getRuntimeState, upsertRuntimeState } = require("../lib/neon-db");
const {
  applyRuntimeSettings,
  buildResetRuntimeState,
  defaultRuntimeState,
  recoverRuntimeStateFromTradeEvents,
  runHouseScan,
  sanitizeRuntimeState,
} = require("../lib/house-runtime");

function buildJsonResponse(res, statusCode, payload) {
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(payload));
}

async function readJsonBody(req) {
  let body = "";
  for await (const chunk of req) {
    body += chunk;
  }
  return body ? JSON.parse(body) : {};
}

function shouldRecoverState(state) {
  return (
    (!state.openTrades.length && !state.closedTrades.length) ||
    Number(state.balance) <= 0 ||
    Number(state.strategyBalances?.core) <= 0 ||
    state.openTrades.some(
      (trade) =>
        Number.isFinite(Number(trade.closedAt)) ||
        Number.isFinite(Number(trade.exitPrice))
    )
  );
}

async function loadPersistedState() {
  if (!hasDatabase()) {
    return {
      available: false,
      state: defaultRuntimeState(),
      updatedAt: null,
    };
  }

  const stored = await getRuntimeState("house_auto_trade");
  if (stored.found && stored.state) {
    const sanitized = sanitizeRuntimeState(stored.state);
    if (shouldRecoverState(sanitized)) {
      const recovered = await recoverRuntimeStateFromTradeEvents(sanitized);
      if (recovered.recovered) {
        const saved = await upsertRuntimeState("house_auto_trade", recovered.state);
        return {
          available: true,
          state: sanitizeRuntimeState(saved.state || recovered.state),
          updatedAt: saved.updatedAt || stored.updatedAt || null,
        };
      }
    }
    return {
      available: true,
      state: sanitized,
      updatedAt: stored.updatedAt || null,
    };
  }

  const seeded = defaultRuntimeState();
  const saved = await upsertRuntimeState("house_auto_trade", seeded);
  return {
    available: true,
    state: sanitizeRuntimeState(saved.state || seeded),
    updatedAt: saved.updatedAt || null,
  };
}

module.exports = async function handler(req, res) {
  if (req.method !== "GET" && req.method !== "POST") {
    buildJsonResponse(res, 405, {
      error: "Method not allowed.",
    });
    return;
  }

  try {
    if (!hasDatabase()) {
      buildJsonResponse(res, 200, {
        ok: true,
        backgroundAvailable: false,
        reason: "DATABASE_URL not configured.",
        state: defaultRuntimeState(),
      });
      return;
    }

    if (req.method === "GET") {
      const loaded = await loadPersistedState();
      buildJsonResponse(res, 200, {
        ok: true,
        backgroundAvailable: loaded.available,
        state: loaded.state,
        updatedAt: loaded.updatedAt,
      });
      return;
    }

    const body = await readJsonBody(req);
    const action = String(body?.action || "settings").trim().toLowerCase();
    const loaded = await loadPersistedState();

    if (action === "reset") {
      const resetState = buildResetRuntimeState();
      const saved = await upsertRuntimeState("house_auto_trade", resetState);
      buildJsonResponse(res, 200, {
        ok: true,
        backgroundAvailable: true,
        state: sanitizeRuntimeState(saved.state || resetState),
        updatedAt: saved.updatedAt,
      });
      return;
    }

    if (action === "scan") {
      const settings = body?.settings || {};
      const inputState = Object.keys(settings).length
        ? applyRuntimeSettings(loaded.state, settings)
        : loaded.state;
      const result = await runHouseScan(inputState, { manual: true });
      const saved = await upsertRuntimeState("house_auto_trade", result.state);
      buildJsonResponse(res, 200, {
        ok: true,
        backgroundAvailable: true,
        state: sanitizeRuntimeState(saved.state || result.state),
        updatedAt: saved.updatedAt,
        summary: result.summary,
      });
      return;
    }

    const nextState = applyRuntimeSettings(loaded.state, body?.settings || {});
    const saved = await upsertRuntimeState("house_auto_trade", nextState);
    buildJsonResponse(res, 200, {
      ok: true,
      backgroundAvailable: true,
      state: sanitizeRuntimeState(saved.state || nextState),
      updatedAt: saved.updatedAt,
    });
  } catch (error) {
    buildJsonResponse(res, 500, {
      error: error.message || "Unable to manage House runtime state.",
    });
  }
};
