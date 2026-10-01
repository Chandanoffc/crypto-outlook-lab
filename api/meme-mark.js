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

  const now     = Date.now();
  const claimed = await tryClaimMarkLock("meme-papertrades", now, 4 * 60 * 1000);
  if (!claimed) return buildJsonResponse(res, 200, { ok: true, skipped: true });

  // Respond immediately so cron-job.org (30s max timeout) always sees a 200.
  // Vercel keeps the async function alive for up to maxDuration (60s) after the
  // response is sent, so the actual price-checking work continues in the background.
  buildJsonResponse(res, 200, { ok: true, async: true });

  try {
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
  } catch (err) {
    console.error("[meme-mark] background error:", err.message);
  }
};
