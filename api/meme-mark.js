"use strict";
/**
 * meme-mark.js — lightweight price mark for MemeScreener paper trades.
 * Runs every 5 minutes via external cron (cron-job.org).
 * Only checks DexScreener prices for open paper trades — no heavy scanning.
 *
 * Separate from /api/cron-scan so the full scan (Helius, RugCheck, Pump.fun)
 * still runs hourly while TP/SL checks happen every 5 minutes.
 */
const { hasDatabase, getRuntimeState, upsertRuntimeState, tryClaimMarkLock } = require("../lib/neon-db");
const { defaultState: memeDefault } = require("../lib/meme-autoscan");
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
    const now     = Date.now();
    // Lock: only one concurrent mark runs at a time, 4-minute cooldown
    const claimed = await tryClaimMarkLock("meme-papertrades", now, 4 * 60 * 1000);
    if (!claimed) return buildJsonResponse(res, 200, { ok: true, skipped: true });

    let memeState = memeDefault();
    if (hasDatabase()) {
      const row = await getRuntimeState("meme-autoscan");
      if (row?.state) memeState = { ...memeDefault(), ...row.state };
    }

    if (!memeState.paperTrades) memeState.paperTrades = { balance: 100, trades: [] };

    const openBefore = memeState.paperTrades.trades.filter(t => t.status === "open").length;
    const result     = await checkPaperTrades(memeState.paperTrades);
    const openAfter  = memeState.paperTrades.trades.filter(t => t.status === "open").length;

    if (hasDatabase() && (result.closed > 0 || openBefore !== openAfter)) {
      await upsertRuntimeState("meme-autoscan", memeState);
    }

    return buildJsonResponse(res, 200, { ok: true, checked: result.checked, closed: result.closed, openNow: openAfter });
  } catch (err) {
    return buildJsonResponse(res, 500, { ok: false, error: err.message });
  }
};
