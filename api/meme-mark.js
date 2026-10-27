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
const { defaultState: memeDefault, runMemeAutoScan, checkMemeMilestones } = require("../lib/meme-autoscan");
const { checkPaperTrades } = require("../lib/meme-papertrades");
// Lazy-load solana-trader to avoid ESM uuid crash at module init time
function getTrader() { return require("../lib/solana-trader"); }

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
    if (!memeState.paperTrades) memeState.paperTrades = { balance: 200, trades: [] };

    // ── 1. Signal detection (every 2 min via scan lock) ──────────────────
    let scanSummary = null;
    const scanClaimed = await tryClaimScanLock("meme-autoscan-lock", now, 110 * 1000);
    if (scanClaimed) {
      scanSummary = await runMemeAutoScan(memeState, { webhook });

      // Save state immediately after scan so alert cooldowns + paper trades are
      // persisted before any slow real-trade calls. Prevents duplicate detections
      // if a second cron tick fires while buyToken is in-flight.
      if (hasDatabase()) await upsertRuntimeState("meme-autoscan", memeState);

      // Real buys for each newly opened paper trade (skip if paused)
      const liveTrading = msRow?.state?.settings?.liveTrading;
      const liveEnabled = process.env.TRADING_WALLET_PRIVKEY && !liveTrading?.paused;
      if (scanSummary?.newTrades?.length && liveEnabled) {
        const { buyToken, REAL_TRADE_USDC } = getTrader();
        for (const trade of scanSummary.newTrades) {
          try {
            const result = await buyToken(trade.mint, REAL_TRADE_USDC, trade._liquidity || 0);
            trade.realTrade = {
              status:         "open",
              txSig:          result.txSig,
              usdcSpent:      result.usdcSpent,
              tokensReceived: result.tokensReceived,
              actualEntry:    result.actualPrice,
              openedAt:       Date.now(),
            };
          } catch (err) {
            trade.realTrade = { status: "buy_failed", error: err.message };
          }
          // Persist realTrade onto the paper trade object in state
          const pt = (memeState.paperTrades.trades || []).find(t => t.id === trade.id);
          if (pt) pt.realTrade = trade.realTrade;
        }
        // Save again with realTrade data attached
        if (hasDatabase()) await upsertRuntimeState("meme-autoscan", memeState);
      }
    }

    // ── 2 & 3. Price checks + milestone alerts (every 2 min via mark lock) ─
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

      // Real sells for each closed paper trade (always sell even if paused — need to exit open positions)
      if (paperResult?.closedTrades?.length && process.env.TRADING_WALLET_PRIVKEY) {
        const { sellToken } = getTrader();
        for (const trade of paperResult.closedTrades) {
          if (!trade.realTrade || trade.realTrade.status !== "open") continue;
          try {
            const result = await sellToken(trade.mint, trade.realTrade.tokensReceived);
            trade.realTrade.status      = "closed";
            trade.realTrade.exitTxSig   = result.txSig;
            trade.realTrade.usdcReceived = result.usdcReceived;
            trade.realTrade.actualExit  = result.actualPrice;
            trade.realTrade.closedAt    = Date.now();
          } catch (err) {
            trade.realTrade.status     = "sell_failed";
            trade.realTrade.sellError  = err.message;
          }
        }
      }
    }

    // Always save state after any work
    if (hasDatabase()) await upsertRuntimeState("meme-autoscan", memeState);

    return buildJsonResponse(res, 200, {
      ok:         true,
      scan:       scanSummary  ?? { skipped: true },
      paper:      paperResult  ?? { skipped: true },
      milestones: msResult?.milestones ?? 0,
    });
  } catch (err) {
    return buildJsonResponse(res, 500, { ok: false, error: err.message });
  }
};
