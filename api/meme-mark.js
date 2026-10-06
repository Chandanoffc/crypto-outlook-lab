"use strict";
/**
 * meme-mark.js — runs every 2 minutes via cron-job.org.
 *
 * Each tick does three things in sequence:
 *   1. runMemeAutoScan  — detect new graduates/boosted tokens (was hourly, now every 2 min)
 *   2. checkPaperTrades — update prices, fire TP/SL/expiry on open trades
 *   3. checkMemeMilestones — fire 2x/3x/5x Discord alerts
 *
 * Detection and price checks are intentionally separated: scan runs first and opens
 * new trades, then the price check runs in the NEXT tick (via the mark lock cooldown)
 * so freshly opened trades always get at least one full 2-min window before SL can fire.
 */
const { hasDatabase, getRuntimeState, upsertRuntimeState, tryClaimMarkLock, tryClaimScanLock } = require("../lib/neon-db");
const { defaultState: memeDefault, runMemeAutoScan, checkMemeMilestones } = require("../lib/meme-autoscan");
const { checkPaperTrades } = require("../lib/meme-papertrades");

function buildJsonResponse(res, statusCode, payload) {
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(payload));
}

module.exports = async function handler(req, res) {
  if (req.method !== "GET") return buildJsonResponse(res, 405, { error: "GET only" });

  try {
    const now = Date.now();

    // Load state once — shared across scan + mark
    let memeState = memeDefault();
    const msRow   = hasDatabase() ? await getRuntimeState("memescreener") : null;
    const webhook = msRow?.state?.settings?.discordWebhook || "";
    if (hasDatabase()) {
      const row = await getRuntimeState("meme-autoscan");
      if (row?.state) memeState = { ...memeDefault(), ...row.state };
    }
    if (!memeState.paperTrades) memeState.paperTrades = { balance: 100, trades: [] };

    // ── 1. Signal detection (every 2 min via scan lock) ──────────────────
    // Uses tryClaimScanLock with a 90s cooldown so it runs on every other tick at most.
    // If this tick loses the scan lock, detection is skipped but price checks still run.
    let scanSummary = null;
    const scanClaimed = await tryClaimScanLock("meme-autoscan", now, 90 * 1000);
    if (scanClaimed) {
      scanSummary = await runMemeAutoScan(memeState, { webhook });
    }

    // ── 2 & 3. Price checks + milestone alerts (every 2 min via mark lock) ─
    const markClaimed = await tryClaimMarkLock("meme-papertrades", now, 90 * 1000);
    let msResult = null;
    if (markClaimed) {
      const [, ms] = await Promise.all([
        checkPaperTrades(memeState.paperTrades),
        checkMemeMilestones(memeState, { webhook }),
      ]);
      msResult = ms;
    }

    // Always save state after any work
    if (hasDatabase()) await upsertRuntimeState("meme-autoscan", memeState);

    return buildJsonResponse(res, 200, {
      ok:         true,
      scan:       scanSummary  ?? { skipped: true },
      milestones: msResult?.milestones ?? 0,
    });
  } catch (err) {
    return buildJsonResponse(res, 500, { ok: false, error: err.message });
  }
};
