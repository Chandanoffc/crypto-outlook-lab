"use strict";
/**
 * cron-scan.js — triggered by Vercel Cron (vercel.json) or an external cron
 * service (e.g. cron-job.org). Runs a full scan on all engines sequentially.
 *
 * Runs SEQUENTIALLY (not concurrently) so only one scan executes at a time —
 * the previous auto-scan approach fired concurrently on every GET request and
 * caused duplicate Discord alerts when multiple frontend polls overlapped.
 */
const { hasDatabase, getRuntimeState, upsertRuntimeState, tryClaimScanLock } = require("../lib/neon-db");
const { defaultRuntimeState: epDefault, sanitizeRuntimeState: epSanitize, runEmaPerps_Scan } = require("../lib/emaperps-runtime");
// NOTE: meme autoscan + paper trade checks moved to /api/meme-mark (runs every 2 min)
// cron-scan no longer touches meme state.
const { runPonsAutoScan, defaultState: ponsDefault } = require("../lib/pons-autoscan");
const { runTAPerps_Scan, defaultState: taDefault, defaultPaper: taPaperDefault, markTAPaperPositions } = require("../lib/taperps-scanner");

function buildJsonResponse(res, statusCode, payload) {
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(payload));
}

function inferBaseUrl(req) {
  const proto = req.headers["x-forwarded-proto"] || "https";
  const host  = req.headers["x-forwarded-host"] || req.headers.host || "";
  return host ? `${proto}://${host}` : "";
}

async function loadState(key, defaultFn, sanitizeFn) {
  if (!hasDatabase()) return { available: false, state: defaultFn() };
  try {
    const row = await getRuntimeState(key);
    return { available: true, state: row ? sanitizeFn(row.state) : defaultFn() };
  } catch (_) {
    return { available: false, state: defaultFn() };
  }
}

module.exports = async function handler(req, res) {
  if (req.method !== "GET" && req.method !== "POST") {
    return buildJsonResponse(res, 405, { error: "Method not allowed." });
  }

  const baseUrl = inferBaseUrl(req);
  const results = {};
  const now = Date.now();

  // EMAPerps scan — sequential, same lock pattern
  try {
    const claimed = await tryClaimScanLock("emaperps", now, 60_000);
    if (!claimed) {
      results.emaperps = { ok: true, skipped: true };
    } else {
      const { available, state } = await loadState("emaperps", epDefault, epSanitize);
      if (available) {
        const result = await runEmaPerps_Scan(state, { manual: false, baseUrl });
        if (hasDatabase()) await upsertRuntimeState("emaperps", result.state);
        results.emaperps = { ok: true, summary: result.summary };
      } else {
        results.emaperps = { ok: false, reason: "no-db" };
      }
    }
  } catch (err) {
    results.emaperps = { ok: false, error: String(err.message) };
  }

  // NOTE: meme autoscan moved to /api/meme-mark — runs every 2 min via cron-job.org

  // Pons / Robinhood Chain — scan for recently graduated tokens
  try {
    const claimed = await tryClaimScanLock("pons-autoscan", now, 60_000);
    if (!claimed) {
      results.pons_autoscan = { ok: true, skipped: true };
    } else {
      let ponsState = ponsDefault();
      if (hasDatabase()) {
        const row = await getRuntimeState("pons-autoscan");
        if (row?.state) ponsState = { ...ponsDefault(), ...row.state };
      }
      const msRow   = hasDatabase() ? await getRuntimeState("memescreener") : null;
      const webhook = msRow?.state?.settings?.discordWebhook || "";
      const summary = await runPonsAutoScan(ponsState, { webhook });
      if (hasDatabase()) await upsertRuntimeState("pons-autoscan", ponsState);
      results.pons_autoscan = { ok: true, summary };
    }
  } catch (err) {
    results.pons_autoscan = { ok: false, error: String(err.message) };
  }

  // TA Perps scan — hourly, 55-min cooldown
  try {
    const claimed = await tryClaimScanLock("taperps-lock", now, 55 * 60_000);
    if (!claimed) {
      results.taperps = { ok: true, skipped: true };
    } else {
      let taState = taDefault();
      if (hasDatabase()) {
        const row = await getRuntimeState("taperps");
        if (row?.state) taState = { ...taDefault(), ...row.state };
      }
      if (!taState.settings) taState.settings = { discordWebhook: "" };
      if (!taState.paper) taState.paper = taPaperDefault();
      const webhook = taState.settings.discordWebhook || "";
      const summary = await runTAPerps_Scan(taState, { webhook });
      if (hasDatabase()) await upsertRuntimeState("taperps", taState);
      results.taperps = { ok: true, summary };
    }
  } catch (err) {
    results.taperps = { ok: false, error: String(err.message) };
  }

  return buildJsonResponse(res, 200, { ok: true, scannedAt: Date.now(), results });
};
