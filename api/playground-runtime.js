const { hasDatabase, getRuntimeState, upsertRuntimeState } = require("../lib/neon-db");
const {
  applyRuntimeSettings,
  buildResetRuntimeState,
  defaultRuntimeState,
  runPlaygroundScan,
  sanitizeRuntimeState,
  sendTestAlert,
} = require("../lib/playground-runtime");

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

async function loadPersistedState() {
  if (!hasDatabase()) {
    return {
      available: false,
      state: defaultRuntimeState(),
      updatedAt: null,
    };
  }

  const stored = await getRuntimeState("playground_ops");
  if (stored.found && stored.state) {
    return {
      available: true,
      state: sanitizeRuntimeState(stored.state),
      updatedAt: stored.updatedAt || null,
    };
  }

  const seeded = defaultRuntimeState();
  const saved = await upsertRuntimeState("playground_ops", seeded);
  return {
    available: true,
    state: sanitizeRuntimeState(saved.state || seeded),
    updatedAt: saved.updatedAt || null,
  };
}

function inferBaseUrl(req) {
  const forwardedProto = req.headers["x-forwarded-proto"];
  const forwardedHost = req.headers["x-forwarded-host"];
  const proto = forwardedProto ? String(forwardedProto).split(",")[0].trim() : "https";
  const host = forwardedHost || req.headers.host || "soloris-signals.vercel.app";
  return `${proto}://${host}`;
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
    const baseUrl = inferBaseUrl(req);

    if (action === "reset") {
      const resetState = buildResetRuntimeState();
      const saved = await upsertRuntimeState("playground_ops", resetState);
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
      const result = await runPlaygroundScan(inputState, {
        manual: true,
        modules: Array.isArray(body?.modules) ? body.modules : undefined,
        baseUrl,
      });
      const saved = await upsertRuntimeState("playground_ops", result.state);
      buildJsonResponse(res, 200, {
        ok: true,
        backgroundAvailable: true,
        state: sanitizeRuntimeState(saved.state || result.state),
        updatedAt: saved.updatedAt,
        summary: result.summary,
      });
      return;
    }

    if (action === "test") {
      const moduleKey = String(body?.module || "").trim().toLowerCase() === "dlmm" ? "dlmm" : "perps";
      const nextState = await sendTestAlert(loaded.state, moduleKey, { baseUrl });
      const saved = await upsertRuntimeState("playground_ops", nextState);
      buildJsonResponse(res, 200, {
        ok: true,
        backgroundAvailable: true,
        state: sanitizeRuntimeState(saved.state || nextState),
        updatedAt: saved.updatedAt,
      });
      return;
    }

    const nextState = applyRuntimeSettings(loaded.state, body?.settings || {});
    const saved = await upsertRuntimeState("playground_ops", nextState);
    buildJsonResponse(res, 200, {
      ok: true,
      backgroundAvailable: true,
      state: sanitizeRuntimeState(saved.state || nextState),
      updatedAt: saved.updatedAt,
    });
  } catch (error) {
    buildJsonResponse(res, 500, {
      error: error.message || "Unable to manage Playground runtime state.",
    });
  }
};
