"use strict";
/**
 * meme-mark.js — 5-minute price mark for MemeScreener.
 * Runs every 5 minutes via external cron (cron-job.org).
 * Checks paper trade TP/SL AND milestone alerts (2x/3x/etc) every 5 min
 * so fast-moving meme coins don't slip through between hourly scans.
 */
const { hasDatabase, getRuntimeState, upsertRuntimeState, tryClaimMarkLock } = require("../lib/neon-db");
const { defaultState: memeDefault, checkMemeMilestones } = require("../lib/meme-autoscan");
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
    const claimed = await tryClaimMarkLock("meme-papertrades", now, 90 * 1000);
    if (!claimed) return buildJsonResponse(res, 200, { ok: true, skipped: true });

    let memeState = memeDefault();
    const msRow   = hasDatabase() ? await getRuntimeState("memescreener") : null;
    const webhook = msRow?.state?.settings?.discordWebhook || "";

    if (hasDatabase()) {
      const row = await getRuntimeState("meme-autoscan");
      if (row?.state) memeState = { ...memeDefault(), ...row.state };
    }

    if (!memeState.paperTrades) memeState.paperTrades = { balance: 100, trades: [] };

    // Run milestone alerts + paper trade TP/SL checks in parallel
    const [, msResult] = await Promise.all([
      checkPaperTrades(memeState.paperTrades),
      checkMemeMilestones(memeState, { webhook }),
    ]);

    // Always save — currentPrice on open trades changes every tick
    if (hasDatabase()) await upsertRuntimeState("meme-autoscan", memeState);

    return buildJsonResponse(res, 200, { ok: true, milestones: msResult?.milestones ?? 0 });
  } catch (err) {
    return buildJsonResponse(res, 500, { ok: false, error: err.message });
  }
};
