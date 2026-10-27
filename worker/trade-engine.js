"use strict";
/**
 * trade-engine.js — persistent VPS worker.
 *
 * Runs a 30-second loop that replaces the Vercel cron (api/meme-mark.js).
 * No time limits, no cold starts, no lock races.
 *
 * Start:  node worker/trade-engine.js
 * Prod:   pm2 start worker/trade-engine.js --name soloris-engine
 *
 * Env vars required (same as Vercel):
 *   DATABASE_URL, HELIUS_API_KEY, TRADING_WALLET_PRIVKEY
 *
 * Env vars optional:
 *   TICK_MS          — loop interval in ms (default 30000)
 *   DISCORD_WEBHOOK  — fallback webhook if DB has none set
 */

require("dotenv").config({ path: require("path").resolve(__dirname, "../.env") });

const { hasDatabase, getRuntimeState, upsertRuntimeState } = require("../lib/neon-db");
const { defaultState: memeDefault, runMemeAutoScan, checkMemeMilestones, fireMilestonePending } = require("../lib/meme-autoscan");
const { checkPaperTrades } = require("../lib/meme-papertrades");
const { buyToken, sellToken, REAL_TRADE_USDC } = require("../lib/solana-trader");

const TICK_MS       = parseInt(process.env.TICK_MS || "30000");
const SCAN_EVERY_MS = 120_000; // run full signal scan every 2 min (same cadence as before)

// ── State held in memory between ticks ───────────────────────────────────────
let memeState       = memeDefault();
let lastScanAt      = 0;
let consecutiveFails = 0;
const MAX_CONSECUTIVE_FAILS = 5;

// ── Logging ───────────────────────────────────────────────────────────────────
function log(msg, ...args) {
  console.log(`[${new Date().toISOString()}] ${msg}`, ...args);
}
function err(msg, ...args) {
  console.error(`[${new Date().toISOString()}] ERROR ${msg}`, ...args);
}

// ── Load state from DB on startup ─────────────────────────────────────────────
async function loadState() {
  if (!hasDatabase()) { log("No DATABASE_URL — running without persistence"); return; }
  const row = await getRuntimeState("meme-autoscan");
  if (row?.state) {
    memeState = { ...memeDefault(), ...row.state };
    log("State loaded — %d open trades", (memeState.paperTrades?.trades || []).filter(t => t.status === "open").length);
  }
}

// ── Settings from memescreener row ───────────────────────────────────────────
async function getSettings() {
  if (!hasDatabase()) return {};
  const row = await getRuntimeState("memescreener");
  return row?.state?.settings || {};
}

// ── Main tick ─────────────────────────────────────────────────────────────────
async function tick() {
  const now      = Date.now();
  const settings = await getSettings();
  const webhook          = settings.discordWebhook   || process.env.DISCORD_WEBHOOK || "";
  const liveTradeWebhook = settings.liveTradeWebhook || webhook;
  const liveEnabled      = !!(process.env.TRADING_WALLET_PRIVKEY) && !settings.liveTrading?.paused;

  // ── 1. Price checks + paper trade TP/SL ────────────────────────────────────
  const [paperResult, msRaw] = await Promise.all([
    checkPaperTrades(memeState.paperTrades),
    checkMemeMilestones(memeState, { webhook }),
  ]);

  // Save BEFORE firing Discord — milestone dedup record must hit DB first
  if (hasDatabase()) await upsertRuntimeState("meme-autoscan", memeState);

  const milestonesFired = await fireMilestonePending(msRaw?.pending);
  if (milestonesFired) log("Milestones fired: %d", milestonesFired);

  // ── 2. Real sells for closed paper trades ──────────────────────────────────
  if (paperResult?.closedTrades?.length && process.env.TRADING_WALLET_PRIVKEY) {
    for (const trade of paperResult.closedTrades) {
      if (!trade.realTrade || trade.realTrade.status !== "open") continue;
      log("Selling %s (%s)…", trade.symbol, trade.closeReason);
      try {
        const result = await sellToken(trade.mint, trade.realTrade.tokensReceived);
        trade.realTrade.status       = "closed";
        trade.realTrade.exitTxSig    = result.txSig;
        trade.realTrade.usdcReceived = result.usdcReceived;
        trade.realTrade.actualExit   = result.actualPrice;
        trade.realTrade.closedAt     = now;
        log("Sold %s → $%s USDC (tx %s)", trade.symbol, result.usdcReceived.toFixed(2), result.txSig);
        sendDiscordSell(liveTradeWebhook, trade, result);
      } catch (e) {
        trade.realTrade.status    = "sell_failed";
        trade.realTrade.sellError = e.message;
        err("Sell failed for %s: %s", trade.symbol, e.message);
      }
      if (hasDatabase()) await upsertRuntimeState("meme-autoscan", memeState);
    }
  }

  // ── 3. Signal scan (every 2 min) ───────────────────────────────────────────
  if (now - lastScanAt >= SCAN_EVERY_MS) {
    lastScanAt = now;
    const scanResult = await runMemeAutoScan(memeState, { webhook });
    if (scanResult?.newTrades?.length) log("New signals: %d", scanResult.newTrades.length);
    if (hasDatabase()) await upsertRuntimeState("meme-autoscan", memeState);
  }

  // ── 4. Real buys ────────────────────────────────────────────────────────────
  if (liveEnabled) {
    const toBuy = (memeState.paperTrades.trades || []).filter(pt =>
      pt.status === "open" &&
      (!pt.realTrade || pt.realTrade.status === "pending_buy" || pt.realTrade.status === "buy_failed")
    );

    if (toBuy.length) {
      // Process one per tick — a full buy cycle takes ~50s; no time limit here
      // but we still do one at a time to keep logs clean and avoid parallel RPC spam
      const pt = toBuy[0];
      log("Buying %s (liquidity $%s)…", pt.symbol, pt._liquidity || "unknown");

      // Mark pending_buy first — survives a crash mid-buy
      pt.realTrade = { status: "pending_buy", queuedAt: now };
      if (hasDatabase()) await upsertRuntimeState("meme-autoscan", memeState);

      try {
        const result = await buyToken(pt.mint, REAL_TRADE_USDC, pt._liquidity || 0);
        pt.realTrade = {
          status:         "open",
          txSig:          result.txSig,
          usdcSpent:      result.usdcSpent,
          tokensReceived: result.tokensReceived,
          actualEntry:    result.actualPrice,
          openedAt:       now,
        };
        log("Bought %s → tx %s", pt.symbol, result.txSig);
        sendDiscordBuy(liveTradeWebhook, pt, result);
      } catch (e) {
        pt.realTrade = { status: "buy_failed", error: e.message, failedAt: now };
        err("Buy failed for %s: %s", pt.symbol, e.message);
      }
      if (hasDatabase()) await upsertRuntimeState("meme-autoscan", memeState);
    }
  }
}

// ── Discord helpers ───────────────────────────────────────────────────────────
function sendDiscordBuy(webhook, pt, result) {
  if (!webhook) return;
  const sym   = pt.symbol || pt.name || pt.mint.slice(0, 8);
  const price = result.actualPrice ? `$${parseFloat(result.actualPrice).toExponential(3)}` : "—";
  fetch(webhook, {
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

function sendDiscordSell(webhook, trade, result) {
  if (!webhook) return;
  const sym    = trade.symbol || trade.name || trade.mint.slice(0, 8);
  const pnl    = result.usdcReceived - (trade.realTrade.usdcSpent || 0);
  const pnlPct = trade.realTrade.usdcSpent
    ? ((pnl / trade.realTrade.usdcSpent) * 100).toFixed(1) : "?";
  const isWin  = pnl >= 0;
  const reason = trade.closeReason === "tp" ? "TP hit" : trade.closeReason === "sl" ? "SL hit" : "Expired";
  fetch(webhook, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ embeds: [{
      title: `${isWin ? "✅" : "❌"} LIVE SELL — ${sym} (${reason})`,
      url: trade.pair_url || undefined,
      color: isWin ? 0x22c55e : 0xef4444,
      fields: [
        { name: "Mint CA",  value: `\`${trade.mint}\``, inline: false },
        { name: "USDC In",  value: `$${(trade.realTrade.usdcSpent || 0).toFixed(2)}`, inline: true },
        { name: "USDC Out", value: `$${result.usdcReceived.toFixed(2)}`, inline: true },
        { name: "Real P&L", value: `${isWin ? "+" : ""}$${pnl.toFixed(2)} (${isWin ? "+" : ""}${pnlPct}%)`, inline: true },
        { name: "Tx",       value: `[View on Solscan](https://solscan.io/tx/${result.txSig})`, inline: false },
      ],
      footer: { text: "Soloris · Live Trade Closed" },
      timestamp: new Date().toISOString(),
    }]}),
  }).catch(() => {});
}

// ── Loop ──────────────────────────────────────────────────────────────────────
async function loop() {
  try {
    await tick();
    consecutiveFails = 0;
  } catch (e) {
    consecutiveFails++;
    err("Tick failed (%d/%d): %s", consecutiveFails, MAX_CONSECUTIVE_FAILS, e.message);
    if (consecutiveFails >= MAX_CONSECUTIVE_FAILS) {
      err("Too many consecutive failures — exiting so pm2 can restart cleanly");
      process.exit(1);
    }
  }
  setTimeout(loop, TICK_MS);
}

// ── Boot ──────────────────────────────────────────────────────────────────────
(async () => {
  log("Soloris trade engine starting (tick=%ds)…", TICK_MS / 1000);
  if (!process.env.TRADING_WALLET_PRIVKEY) log("WARN: TRADING_WALLET_PRIVKEY not set — live trading disabled");
  if (!process.env.HELIUS_API_KEY)         log("WARN: HELIUS_API_KEY not set — using public RPC (rate-limited)");
  await loadState();
  log("First tick starting…");
  loop();
})();
