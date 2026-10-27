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

      // Real sells for each closed paper trade (always sell even if paused — need to exit open positions)
      if (paperResult?.closedTrades?.length && process.env.TRADING_WALLET_PRIVKEY) {
        const { sellToken } = getTrader();
        for (const trade of paperResult.closedTrades) {
          if (!trade.realTrade || trade.realTrade.status !== "open") continue;
          try {
            const result = await sellToken(trade.mint, trade.realTrade.tokensReceived);
            trade.realTrade.status       = "closed";
            trade.realTrade.exitTxSig    = result.txSig;
            trade.realTrade.usdcReceived = result.usdcReceived;
            trade.realTrade.actualExit   = result.actualPrice;
            trade.realTrade.closedAt     = Date.now();
            // Phone alert via Discord (private channel)
            if (liveTradeWebhook) {
              const sym   = trade.symbol || trade.name || trade.mint.slice(0, 8);
              const pnl   = result.usdcReceived - (trade.realTrade.usdcSpent || 0);
              const pnlPct = trade.realTrade.usdcSpent
                ? ((pnl / trade.realTrade.usdcSpent) * 100).toFixed(1)
                : "?";
              const isWin  = pnl >= 0;
              const reason = trade.closeReason === "tp" ? "TP hit" : trade.closeReason === "sl" ? "SL hit" : "Expired";
              fetch(liveTradeWebhook, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ embeds: [{
                  title: `${isWin ? "✅" : "❌"} LIVE SELL — ${sym} (${reason})`,
                  url: trade.pair_url || undefined,
                  color: isWin ? 0x22c55e : 0xef4444,
                  fields: [
                    { name: "Mint CA",      value: `\`${trade.mint}\``, inline: false },
                    { name: "USDC In",      value: `$${(trade.realTrade.usdcSpent || 0).toFixed(2)}`, inline: true },
                    { name: "USDC Out",     value: `$${result.usdcReceived.toFixed(2)}`, inline: true },
                    { name: "Real P&L",     value: `${isWin ? "+" : ""}$${pnl.toFixed(2)} (${isWin ? "+" : ""}${pnlPct}%)`, inline: true },
                    { name: "Tx",           value: `[View on Solscan](https://solscan.io/tx/${result.txSig})`, inline: false },
                  ],
                  footer: { text: "Soloris · Live Trade Closed" },
                  timestamp: new Date().toISOString(),
                }]}),
              }).catch(() => {});
            }
          } catch (err) {
            trade.realTrade.status    = "sell_failed";
            trade.realTrade.sellError = err.message;
          }
        }
        if (hasDatabase()) await upsertRuntimeState("meme-autoscan", memeState);
      }
    }

    // ── 2. Signal detection (every 2 min via scan lock) ──────────────────
    let scanSummary = null;
    const scanClaimed = await tryClaimScanLock("meme-autoscan-lock", now, 110 * 1000);
    if (scanClaimed) {
      scanSummary = await runMemeAutoScan(memeState, { webhook });
      // Save immediately — persists cooldowns + new paper trades before any slow RPC
      if (hasDatabase()) await upsertRuntimeState("meme-autoscan", memeState);
    }

    // ── 3. Real buys — runs every tick, independent of scan lock ─────────
    // Picks up: (a) newly opened paper trades with no realTrade, and
    //           (b) trades stuck in pending_buy from a previous timeout.
    // Running outside scanClaimed means a timed-out buy is always retried
    // on the next tick even if the scan lock isn't re-claimable.
    const liveTrading = msRow?.state?.settings?.liveTrading;
    const liveEnabled = !!(process.env.TRADING_WALLET_PRIVKEY) && !liveTrading?.paused;
    const buyResults  = [];
    if (liveEnabled) {
      const pendingBuys = (memeState.paperTrades.trades || []).filter(pt =>
        pt.status === "open" && (!pt.realTrade || pt.realTrade.status === "pending_buy")
      );

      if (pendingBuys.length) {
        // Mark all as pending_buy and save BEFORE any RPC call.
        // If the function times out during buyToken, pending_buy is already in DB
        // and will be retried next tick.
        for (const pt of pendingBuys) {
          if (!pt.realTrade) pt.realTrade = { status: "pending_buy", queuedAt: Date.now() };
        }
        if (hasDatabase()) await upsertRuntimeState("meme-autoscan", memeState);

        const { buyToken, REAL_TRADE_USDC } = getTrader();
        for (const pt of pendingBuys) {
          try {
            const result = await buyToken(pt.mint, REAL_TRADE_USDC, pt._liquidity || 0);
            pt.realTrade = {
              status:         "open",
              txSig:          result.txSig,
              usdcSpent:      result.usdcSpent,
              tokensReceived: result.tokensReceived,
              actualEntry:    result.actualPrice,
              openedAt:       Date.now(),
            };
            buyResults.push({ mint: pt.mint, symbol: pt.symbol, status: "ok", txSig: result.txSig });
            if (liveTradeWebhook) {
              const sym   = pt.symbol || pt.name || pt.mint.slice(0, 8);
              const price = result.actualPrice ? `$${parseFloat(result.actualPrice).toExponential(3)}` : "—";
              fetch(liveTradeWebhook, {
                method: "POST", headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ embeds: [{
                  title: `💸 LIVE BUY — ${sym}`,
                  url: pt.pair_url || undefined,
                  color: 0x3b82f6,
                  fields: [
                    { name: "Mint CA",     value: `\`${pt.mint}\``, inline: false },
                    { name: "Entry Price", value: price, inline: true },
                    { name: "USDC Spent",  value: `$${result.usdcSpent}`, inline: true },
                    { name: "Tx",          value: `[View on Solscan](https://solscan.io/tx/${result.txSig})`, inline: false },
                  ],
                  footer: { text: "Soloris · Live Trade Opened" },
                  timestamp: new Date().toISOString(),
                }]}),
              }).catch(() => {});
            }
          } catch (err) {
            pt.realTrade = { status: "buy_failed", error: err.message };
            buyResults.push({ mint: pt.mint, symbol: pt.symbol, status: "buy_failed", error: err.message });
          }
          // Save after each individual buy so a mid-loop timeout doesn't lose results
          if (hasDatabase()) await upsertRuntimeState("meme-autoscan", memeState);
        }
      }
    }

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
