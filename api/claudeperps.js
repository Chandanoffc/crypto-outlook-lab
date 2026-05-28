"use strict";
const { hasDatabase, getRuntimeState, upsertRuntimeState } = require("../lib/neon-db");
const { defaultRuntimeState, sanitizeRuntimeState, runClaudePerps_Scan, analyzeToken } = require("../lib/claudeperps-runtime");

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
  const stored = await getRuntimeState("claudeperps");
  if (stored.found && stored.state) return { available: true, state: sanitizeRuntimeState(stored.state), updatedAt: stored.updatedAt };
  const seed = defaultRuntimeState();
  const saved = await upsertRuntimeState("claudeperps", seed);
  return { available: true, state: sanitizeRuntimeState(saved.state || seed), updatedAt: saved.updatedAt };
}

module.exports = async function handler(req, res) {
  if (req.method !== "GET" && req.method !== "POST") return buildJsonResponse(res, 405, { error: "Method not allowed." });

  try {
    // GET: return current state
    if (req.method === "GET") {
      const { available, state, updatedAt } = await loadState();
      return buildJsonResponse(res, 200, { ok: true, available, state, updatedAt });
    }

    const body = await readJsonBody(req);
    const action = String(body?.action || "").trim().toLowerCase();

    // Analyze a specific token
    if (action === "analyze") {
      const token = String(body?.token || "").trim();
      if (!token) return buildJsonResponse(res, 400, { ok: false, error: "token is required" });
      const result = await analyzeToken(token, inferBaseUrl(req));
      return buildJsonResponse(res, result.ok ? 200 : 400, result);
    }

    // Manual scan trigger
    if (action === "scan") {
      const { state: loaded } = await loadState();
      const result = await runClaudePerps_Scan(loaded, { manual: true, baseUrl: inferBaseUrl(req) });
      if (hasDatabase()) {
        const saved = await upsertRuntimeState("claudeperps", result.state);
        return buildJsonResponse(res, 200, { ok: true, state: sanitizeRuntimeState(saved.state || result.state), summary: result.summary });
      }
      return buildJsonResponse(res, 200, { ok: true, state: result.state, summary: result.summary });
    }

    // Update settings (Discord webhook, notify flags)
    if (action === "settings") {
      const { state: loaded } = await loadState();
      const settings = body?.settings || {};
      if (settings.discordWebhook !== undefined) loaded.alertDelivery.discordWebhook = String(settings.discordWebhook).trim();
      if (settings.notifyOnNew !== undefined) loaded.alertDelivery.notifyOnNew = Boolean(settings.notifyOnNew);
      const saved = hasDatabase() ? await upsertRuntimeState("claudeperps", loaded) : { state: loaded, updatedAt: null };
      return buildJsonResponse(res, 200, { ok: true, state: sanitizeRuntimeState(saved.state || loaded), updatedAt: saved.updatedAt });
    }

    // Reset signals
    if (action === "reset") {
      const fresh = defaultRuntimeState();
      if (hasDatabase()) {
        const { state: old } = await loadState();
        fresh.alertDelivery = old.alertDelivery; // preserve webhook config
        const saved = await upsertRuntimeState("claudeperps", fresh);
        return buildJsonResponse(res, 200, { ok: true, state: sanitizeRuntimeState(saved.state || fresh) });
      }
      return buildJsonResponse(res, 200, { ok: true, state: fresh });
    }

    return buildJsonResponse(res, 400, { error: "Unknown action." });
  } catch (err) {
    buildJsonResponse(res, 500, { error: err.message || "Internal error." });
  }
};
