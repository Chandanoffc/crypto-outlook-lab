"use strict";
const { hasDatabase, getRuntimeState, upsertRuntimeState, tryClaimScanLock, tryClaimMarkLock } = require("../lib/neon-db");
const { defaultRuntimeState, sanitizeRuntimeState, runEmaPerps_Scan, markPaperPositions, analyzeToken } = require("../lib/emaperps-runtime");

function buildJsonResponse(res, statusCode, payload) {
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(payload));
}

async function readJsonBody(req) {
  let body = "";
  for await (const chunk of req) body += chunk;
  return body ? JSON.parse(body) : {};
}

function inferBaseUrl(req) {
  const proto = (req.headers["x-forwarded-proto"] || "https").split(",")[0].trim();
  const host = req.headers["x-forwarded-host"] || req.headers.host || "soloris-signals.vercel.app";
  return `${proto}://${host}`;
}

async function loadState() {
  if (!hasDatabase()) return { available: false, state: defaultRuntimeState(), updatedAt: null };
  const stored = await getRuntimeState("emaperps");
  if (stored.found && stored.state) return { available: true, state: sanitizeRuntimeState(stored.state), updatedAt: stored.updatedAt };
  const seed = defaultRuntimeState();
  const saved = await upsertRuntimeState("emaperps", seed);
  return { available: true, state: sanitizeRuntimeState(saved.state || seed), updatedAt: saved.updatedAt };
}

module.exports = async function handler(req, res) {
  if (req.method !== "GET" && req.method !== "POST") return buildJsonResponse(res, 405, { error: "Method not allowed." });

  try {
    if (req.method === "GET") {
      const { available, state, updatedAt } = await loadState();
      return buildJsonResponse(res, 200, { ok: true, available, state, updatedAt });
    }

    const body = await readJsonBody(req);
    const action = String(body?.action || "").trim().toLowerCase();

    if (action === "analyze") {
      const token = String(body?.token || "").trim();
      if (!token) return buildJsonResponse(res, 400, { ok: false, error: "token is required" });
      const result = await analyzeToken(token);
      return buildJsonResponse(res, result.ok ? 200 : 400, result);
    }

    if (action === "scan") {
      const now = Date.now();
      // Atomic scan lock: only one concurrent scan runs at a time (60s cooldown).
      // Two concurrent requests both stamp lastScanAt; Postgres serialises the UPDATE
      // so exactly one wins — the other gets rowCount=0 and returns immediately.
      const claimed = await tryClaimScanLock("emaperps", now, 60_000);
      if (!claimed) {
        const { state: cur } = await loadState();
        return buildJsonResponse(res, 200, { ok: true, skipped: true, state: sanitizeRuntimeState(cur) });
      }
      const { state: loaded } = await loadState();
      const result = await runEmaPerps_Scan(loaded, { manual: true, baseUrl: inferBaseUrl(req) });
      if (hasDatabase()) {
        const saved = await upsertRuntimeState("emaperps", result.state);
        return buildJsonResponse(res, 200, { ok: true, state: sanitizeRuntimeState(saved.state || result.state), summary: result.summary });
      }
      return buildJsonResponse(res, 200, { ok: true, state: result.state, summary: result.summary });
    }

    if (action === "settings") {
      const { state: loaded } = await loadState();
      const settings = body?.settings || {};
      if (settings.discordWebhook !== undefined) loaded.alertDelivery.discordWebhook = String(settings.discordWebhook).trim();
      if (settings.notifyOnNew !== undefined) loaded.alertDelivery.notifyOnNew = Boolean(settings.notifyOnNew);
      const saved = hasDatabase() ? await upsertRuntimeState("emaperps", loaded) : { state: loaded, updatedAt: null };
      return buildJsonResponse(res, 200, { ok: true, state: sanitizeRuntimeState(saved.state || loaded), updatedAt: saved.updatedAt });
    }

    if (action === "reset") {
      const fresh = defaultRuntimeState();
      if (hasDatabase()) {
        const { state: old } = await loadState();
        fresh.alertDelivery = old.alertDelivery;
        const saved = await upsertRuntimeState("emaperps", fresh);
        return buildJsonResponse(res, 200, { ok: true, state: sanitizeRuntimeState(saved.state || fresh) });
      }
      return buildJsonResponse(res, 200, { ok: true, state: fresh });
    }

    if (action === "mark") {
      const now = Date.now();
      // Atomic DB-level lock: only one concurrent mark request wins.
      // The conditional UPDATE only succeeds when lastMarkAt is stale (>30s).
      // Two concurrent requests both try; exactly one gets rowCount > 0.
      const claimed = await tryClaimMarkLock("emaperps", now, 30_000);
      if (!claimed) return buildJsonResponse(res, 200, { ok: true, skipped: true });
      // Load state AFTER claiming lock (lastMarkAt already stamped in DB by the lock)
      const { state: loaded } = await loadState();
      await markPaperPositions(loaded, now, inferBaseUrl(req));
      if (hasDatabase()) {
        const saved = await upsertRuntimeState("emaperps", loaded);
        return buildJsonResponse(res, 200, { ok: true, state: sanitizeRuntimeState(saved.state || loaded) });
      }
      return buildJsonResponse(res, 200, { ok: true, state: sanitizeRuntimeState(loaded) });
    }

    if (action === "paper-reset") {
      if (hasDatabase()) {
        const { state: old } = await loadState();
        old.paper = { balance: 100, startingBalance: 100, openPositions: [], closedTrades: [], lastMarkAt: 0 };
        old.lastScanResults = [];
        const saved = await upsertRuntimeState("emaperps", old);
        return buildJsonResponse(res, 200, { ok: true, state: sanitizeRuntimeState(saved.state || old) });
      }
      return buildJsonResponse(res, 200, { ok: true });
    }

    return buildJsonResponse(res, 400, { error: "Unknown action." });
  } catch (err) {
    buildJsonResponse(res, 500, { error: err.message || "Internal error." });
  }
};
