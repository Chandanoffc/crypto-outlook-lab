"use strict";
/**
 * cron-scan.js — triggered by Vercel Cron (vercel.json) or an external cron
 * service (e.g. cron-job.org). Runs a full scan on both engines sequentially.
 *
 * Runs SEQUENTIALLY (not concurrently) so only one scan executes at a time —
 * the previous auto-scan approach fired concurrently on every GET request and
 * caused duplicate Discord alerts when multiple frontend polls overlapped.
 */
const { hasDatabase, getRuntimeState, upsertRuntimeState, tryClaimScanLock } = require("../lib/neon-db");
const { defaultRuntimeState: cpDefault, sanitizeRuntimeState: cpSanitize, runClaudePerps_Scan } = require("../lib/claudeperps-runtime");
const { defaultRuntimeState: epDefault, sanitizeRuntimeState: epSanitize, runEmaPerps_Scan } = require("../lib/emaperps-runtime");

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

  // ClaudePerps scan — atomic lock prevents overlap with manual scan button
  try {
    const claimed = await tryClaimScanLock("claudeperps", now, 60_000);
    if (!claimed) {
      results.claudeperps = { ok: true, skipped: true };
    } else {
      const { available, state } = await loadState("claudeperps", cpDefault, cpSanitize);
      if (available) {
        const result = await runClaudePerps_Scan(state, { manual: false, baseUrl });
        if (hasDatabase()) await upsertRuntimeState("claudeperps", result.state);
        results.claudeperps = { ok: true, summary: result.summary };
      } else {
        results.claudeperps = { ok: false, reason: "no-db" };
      }
    }
  } catch (err) {
    results.claudeperps = { ok: false, error: String(err.message) };
  }

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

  return buildJsonResponse(res, 200, { ok: true, scannedAt: Date.now(), results });
};
