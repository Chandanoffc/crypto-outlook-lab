"use strict";
/**
 * meme-mark.js — runs every 2 minutes via cron-job.org.
 *
 * Each tick does three things in sequence:
 *   1. runMemeAutoScan  — detect new graduates/boosted tokens (was hourly, now every 2 min)
 *   2. checkPaperTrades — update prices, fire TP/SL/expiry on open trades
 *   3. checkMemeMilestones — fire 2x/3x/5x Discord alerts
 *
 * Real trading: every new paper trade also executes a real Jupiter swap on-chain.
 * Every closed paper trade also sells the real token balance back to USDC.
 */
const { hasDatabase, getRuntimeState, upsertRuntimeState, tryClaimMarkLock, tryClaimScanLock } = require("../lib/neon-db");
const { defaultState: memeDefault, runMemeAutoScan, checkMemeMilestones, fireMilestonePending } = require("../lib/meme-autoscan");
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
    const webhook          = msRow?.state?.settings?.discordWebhook     || "";
    const liveTradeWebhook = msRow?.state?.settings?.liveTradeWebhook   || webhook;
    if (hasDatabase()) {
      const row = await getRuntimeState("meme-autoscan");
      if (row?.state) memeState = { ...memeDefault(), ...row.state };
    }
    if (!memeState.paperTrades) memeState.paperTrades = { balance: 200, trades: [] };

    // ── 1. Price checks + milestone alerts (ALWAYS first — must complete within 10s Vercel limit) ─
    // Running this before scan/real-trades ensures TP/SL closes are never lost to a timeout.
    const markClaimed = await tryClaimMarkLock("meme-papertrades", now, 90 * 1000);
    let msResult = null;
    let paperResult = null;
    if (markClaimed) {
      const [pr, ms] = await Promise.all([
        checkPaperTrades(memeState.paperTrades),
        checkMemeMilestones(memeState, { webhook }),
      ]);
      paperResult = pr;
      msResult = ms;
      // Save BEFORE firing Discord alerts — milestones_hit is already updated in memory.
      // This guarantees the dedup record hits DB before the webhook, so a timeout or
      // webhook failure can never cause the same milestone to fire twice.
      if (hasDatabase()) await upsertRuntimeState("meme-autoscan", memeState);
      // Now safe to fire — if this crashes/times out, milestones_hit is already saved
      const milestonesFired = await fireMilestonePending(ms?.pending);
      msResult = { ...ms, milestones: milestonesFired };

      // Real sells are handled exclusively by the VPS trade engine (worker/trade-engine.js).
      // Keeping sell logic here caused double-sells when both systems ran simultaneously.
    }

    // ── 2. Signal detection (every 2 min via scan lock) ──────────────────
    let scanSummary = null;
    const scanClaimed = await tryClaimScanLock("meme-autoscan-lock", now, 110 * 1000);
    if (scanClaimed) {
      scanSummary = await runMemeAutoScan(memeState, { webhook });
      // Save immediately — persists cooldowns + new paper trades before any slow RPC
      if (hasDatabase()) await upsertRuntimeState("meme-autoscan", memeState);
    }

    // Real buys are handled exclusively by the VPS trade engine (worker/trade-engine.js).
    // Keeping buy logic here caused double-buys when both systems ran simultaneously.
    const liveTrading = msRow?.state?.settings?.liveTrading;
    const liveEnabled = !!(process.env.TRADING_WALLET_PRIVKEY) && !liveTrading?.paused;
    const buyResults  = [];

    // Final save to catch any remaining state changes
    if (hasDatabase()) await upsertRuntimeState("meme-autoscan", memeState);

    return buildJsonResponse(res, 200, {
      ok:         true,
      scan:       scanSummary  ?? { skipped: true },
      paper:      paperResult  ?? { skipped: true },
      milestones: msResult?.milestones ?? 0,
      realTrades: {
        privkeySet:  !!(process.env.TRADING_WALLET_PRIVKEY),
        liveEnabled,
        paused:      !!(msRow?.state?.settings?.liveTrading?.paused),
        buys:        buyResults,
        pending:     (memeState.paperTrades.trades || [])
          .filter(pt => pt.status === "open" && pt.realTrade?.status === "pending_buy")
          .map(pt => ({ symbol: pt.symbol, mint: pt.mint, queuedAt: pt.realTrade.queuedAt })),
      },
    });
  } catch (err) {
    return buildJsonResponse(res, 500, { ok: false, error: err.message });
  }
};
