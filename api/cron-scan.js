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
const { runZenCalls_Scan } = require("../lib/zencalls-scan");
const { runZenStrategy_Scan, defaultState: zcStratDefault } = require("../lib/zencalls-strategy");
const { runMemeAutoScan, checkMemeMilestones, defaultState: memeDefault } = require("../lib/meme-autoscan");

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

  // ZenCalls price monitor — checks TP1/TP2/SL for all open conviction calls
  try {
    const claimed = await tryClaimScanLock("zencalls", now, 60_000);
    if (!claimed) {
      results.zencalls = { ok: true, skipped: true };
    } else {
      const row = hasDatabase() ? await getRuntimeState("zencalls") : null;
      if (row && row.state) {
        const state = row.state;
        const summary = await runZenCalls_Scan(state);
        if (hasDatabase()) await upsertRuntimeState("zencalls", state);
        results.zencalls = { ok: true, summary };
      } else {
        results.zencalls = { ok: true, summary: { hits: 0, reason: "no-calls" } };
      }
    }
  } catch (err) {
    results.zencalls = { ok: false, error: String(err.message) };
  }

  // ZenCalls strategy scanner — auto-scans ALL Binance perp tokens for S/R setups
  try {
    const claimed = await tryClaimScanLock("zencalls-strategy", now, 60_000);
    if (!claimed) {
      results.zencalls_strategy = { ok: true, skipped: true };
    } else {
      let stratState = zcStratDefault();
      if (hasDatabase()) {
        const row = await getRuntimeState("zencalls-strategy");
        if (row && row.state) stratState = { ...zcStratDefault(), ...row.state };
      }
      // Read Discord webhook from ZenCalls settings
      const zcRow = hasDatabase() ? await getRuntimeState("zencalls") : null;
      const webhook = zcRow?.state?.settings?.discordWebhook || "";
      const summary = await runZenStrategy_Scan(stratState, { webhook });
      if (hasDatabase()) await upsertRuntimeState("zencalls-strategy", stratState);
      results.zencalls_strategy = { ok: true, summary };
    }
  } catch (err) {
    results.zencalls_strategy = { ok: false, error: String(err.message) };
  }

  // Meme auto-scan — scans Pump.fun graduates + DexScreener signals
  try {
    const claimed = await tryClaimScanLock("meme-autoscan", now, 60_000);
    if (!claimed) {
      results.meme_autoscan = { ok: true, skipped: true };
    } else {
      let memeState = memeDefault();
      if (hasDatabase()) {
        const row = await getRuntimeState("meme-autoscan");
        if (row?.state) memeState = { ...memeDefault(), ...row.state };
      }
      const msRow = hasDatabase() ? await getRuntimeState("memescreener") : null;
      const webhook = msRow?.state?.settings?.discordWebhook || "";
      const summary = await runMemeAutoScan(memeState, { webhook });
      // Check milestones for all previously detected tokens (2x/3x/4x/5x/10x)
      const milestoneSummary = await checkMemeMilestones(memeState, { webhook });
      if (hasDatabase()) await upsertRuntimeState("meme-autoscan", memeState);
      results.meme_autoscan = { ok: true, summary, milestones: milestoneSummary };
    }
  } catch (err) {
    results.meme_autoscan = { ok: false, error: String(err.message) };
  }

  return buildJsonResponse(res, 200, { ok: true, scannedAt: Date.now(), results });
};
