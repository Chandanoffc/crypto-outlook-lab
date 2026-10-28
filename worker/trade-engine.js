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
const { buyToken, sellToken, getTokenBalance, topUpSolIfNeeded, closeEmptyTokenAccounts, REAL_TRADE_USDC } = require("../lib/solana-trader");

const TICK_MS       = parseInt(process.env.TICK_MS || "30000");
const SCAN_EVERY_MS = 120_000; // run full signal scan every 2 min (same cadence as before)

// ── State held in memory between ticks ───────────────────────────────────────
let memeState        = memeDefault();
let lastScanAt       = 0;
let consecutiveFails = 0;
let closedTradeCount = 0;
let lastCleanupAt    = 0;
let stateDirty       = false; // only save to DB when state actually changed
let cachedSettings   = {};
let settingsCachedAt = 0;
const SETTINGS_TTL   = 5 * 60 * 1000; // re-read settings every 5 min
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
    // Restore lastScanAt so restarts don't immediately re-scan and fire duplicate buys
    if (row.state._lastScanAt) lastScanAt = row.state._lastScanAt;
    log("State loaded — %d open trades", (memeState.paperTrades?.trades || []).filter(t => t.status === "open").length);
  }
}

// ── Settings from memescreener row (cached 5 min) ────────────────────────────
async function getSettings() {
  if (!hasDatabase()) return {};
  if (Date.now() - settingsCachedAt < SETTINGS_TTL) return cachedSettings;
  const row = await getRuntimeState("memescreener");
  cachedSettings   = row?.state?.settings || {};
  settingsCachedAt = Date.now();
  return cachedSettings;
}

// ── Save state only when dirty ────────────────────────────────────────────────
async function saveIfDirty(force = false) {
  if (!hasDatabase()) return;
  if (!stateDirty && !force) return;
  await upsertRuntimeState("meme-autoscan", memeState);
  stateDirty = false;
}

// ── Main tick ─────────────────────────────────────────────────────────────────
async function tick() {
  const now      = Date.now();
  const settings = await getSettings();
  const webhook          = settings.discordWebhook   || process.env.DISCORD_WEBHOOK || "";
  const liveTradeWebhook = settings.liveTradeWebhook || process.env.LIVE_TRADE_WEBHOOK || webhook;
  const liveEnabled      = !!(process.env.TRADING_WALLET_PRIVKEY) && !settings.liveTrading?.paused;

  // ── 1. Price checks + paper trade TP/SL ────────────────────────────────────
  const [paperResult, msRaw] = await Promise.all([
    checkPaperTrades(memeState.paperTrades),
    checkMemeMilestones(memeState, { webhook }),
  ]);

  if (paperResult?.closedTrades?.length) stateDirty = true;
  if (msRaw?.pending?.length) stateDirty = true;

  // Save BEFORE firing Discord — milestone dedup record must hit DB first
  await saveIfDirty();

  const milestonesFired = await fireMilestonePending(msRaw?.pending);
  if (milestonesFired) log("Milestones fired: %d", milestonesFired);

  // ── 2. Real sells for closed paper trades ──────────────────────────────────
  // Also retry any trade that was paper-closed in a previous tick but whose
  // on-chain sell never ran (e.g. engine restarted after DB save, before sell).
  const MAX_SELL_RETRIES = 3;
  const stuckSells = (memeState.paperTrades.trades || []).filter(t =>
    t.status !== "open" &&
    (t.realTrade?.status === "open" ||
      (t.realTrade?.status === "sell_failed" && (t.realTrade?.sellRetryCount || 0) < MAX_SELL_RETRIES))
  );
  const tradesToSell = [
    ...(paperResult?.closedTrades || []).filter(t => t.realTrade?.status === "open"),
    ...stuckSells.filter(s => !(paperResult?.closedTrades || []).some(c => c.mint === s.mint)),
  ];

  if (tradesToSell.length && process.env.TRADING_WALLET_PRIVKEY) {
    for (const trade of tradesToSell) {
      if (!trade.realTrade || (trade.realTrade.status !== "open" && trade.realTrade.status !== "sell_failed")) continue;
      const isRetry = !paperResult?.closedTrades?.some(c => c.mint === trade.mint);
      log("%sSelling %s (%s)…", isRetry ? "[retry] " : "", trade.symbol, trade.closeReason || "closed");
      try {
        // Check on-chain balance first — if 0, token was manually sold; mark closed and skip
        const onChainBalance = await getTokenBalance(trade.mint);
        if (onChainBalance <= 0) {
          log("No on-chain balance for %s — marking as manually closed", trade.symbol);
          trade.realTrade.status      = "closed";
          trade.realTrade.closedAt    = now;
          trade.realTrade.manualClose = true;
        } else {
          const result = await sellToken(trade.mint, onChainBalance);
          trade.realTrade.status       = "closed";
          trade.realTrade.exitTxSig    = result.txSig;
          trade.realTrade.usdcReceived = result.usdcReceived;
          trade.realTrade.actualExit   = result.actualPrice;
          trade.realTrade.closedAt     = now;
          log("Sold %s → $%s USDC (tx %s)", trade.symbol, result.usdcReceived.toFixed(2), result.txSig);
          sendDiscordSell(liveTradeWebhook, trade, result);
        }
      } catch (e) {
        const sellRetryCount = (trade.realTrade.sellRetryCount || 0) + 1;
        trade.realTrade.status         = "sell_failed";
        trade.realTrade.sellError      = e.message;
        trade.realTrade.sellRetryCount = sellRetryCount;
        if (sellRetryCount >= MAX_SELL_RETRIES) {
          err("Sell abandoned for %s after %d attempts: %s", trade.symbol, sellRetryCount, e.message);
        } else {
          err("Sell failed for %s (attempt %d/%d): %s", trade.symbol, sellRetryCount, MAX_SELL_RETRIES, e.message);
        }
      }
      // Always force-save after a real trade operation
      await saveIfDirty(true);
    }
  }

  // ── 3. SOL top-up (after every sell) + token account cleanup (daily) ────────
  const justSold = tradesToSell.filter(t => t.realTrade?.status === "closed" && !t.realTrade?.manualClose).length;
  if (justSold > 0 && process.env.TRADING_WALLET_PRIVKEY) {
    closedTradeCount += justSold;
    try {
      const topUp = await topUpSolIfNeeded();
      if (topUp) log("SOL topped up: swapped $%d USDC → SOL (was %s SOL, tx %s)", topUp.usdcSpent, topUp.solBefore.toFixed(4), topUp.txSig);
    } catch (e) {
      err("SOL top-up failed: %s", e.message);
    }
  }

  const CLEANUP_EVERY_MS = 24 * 60 * 60 * 1000;
  if (now - lastCleanupAt >= CLEANUP_EVERY_MS && process.env.TRADING_WALLET_PRIVKEY) {
    lastCleanupAt = now;
    log("Running daily token account cleanup…");
    try {
      const closed = await closeEmptyTokenAccounts();
      log("Closed %d empty token accounts (reclaimed ~%s SOL)", closed, (closed * 0.002).toFixed(3));
    } catch (e) {
      err("Token account cleanup failed: %s", e.message);
    }
  }

  // ── 5. Signal scan (every 2 min) ───────────────────────────────────────────
  if (now - lastScanAt >= SCAN_EVERY_MS) {
    lastScanAt = now;
    memeState._lastScanAt = now;
    const scanResult = await runMemeAutoScan(memeState, { webhook });
    if (scanResult?.newTrades?.length) {
      log("New signals: %d", scanResult.newTrades.length);
      stateDirty = true;
    }
    // Always save after scan to persist cooldowns + _lastScanAt
    await saveIfDirty(true);
  }

  // ── 6. Real buys ────────────────────────────────────────────────────────────
  const MAX_BUY_RETRIES = 3;
  if (liveEnabled) {
    const toBuy = (memeState.paperTrades.trades || []).filter(pt =>
      pt.status === "open" &&
      (!pt.realTrade ||
        pt.realTrade.status === "pending_buy" ||
        (pt.realTrade.status === "buy_failed" && (pt.realTrade.retryCount || 0) < MAX_BUY_RETRIES))
    );

    if (toBuy.length) {
      // Process one per tick — a full buy cycle takes ~50s; no time limit here
      // but we still do one at a time to keep logs clean and avoid parallel RPC spam
      const pt = toBuy[0];
      log("Buying %s (liquidity $%s)…", pt.symbol, pt._liquidity || "unknown");

      // Check on-chain balance first — prevents double-buy after a crash mid-save
      try {
        const existingBalance = await getTokenBalance(pt.mint);
        if (existingBalance > 0) {
          log("Already hold %s on-chain (%s tokens) — recovering trade state", pt.symbol, existingBalance);
          pt.realTrade = { status: "open", tokensReceived: existingBalance, openedAt: now, recoveredFromChain: true };
          if (hasDatabase()) await upsertRuntimeState("meme-autoscan", memeState);
          return;
        }
      } catch (e) {
        log("Balance check failed for %s: %s — proceeding with buy", pt.symbol, e.message);
      }

      // Mark pending_buy first — force-save before any RPC call
      pt.realTrade = { status: "pending_buy", queuedAt: now };
      await saveIfDirty(true);

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
        const retryCount = (pt.realTrade?.retryCount || 0) + 1;
        pt.realTrade = { status: "buy_failed", error: e.message, failedAt: now, retryCount };
        if (retryCount >= MAX_BUY_RETRIES) {
          err("Buy abandoned for %s after %d attempts: %s", pt.symbol, retryCount, e.message);
        } else {
          err("Buy failed for %s (attempt %d/%d): %s", pt.symbol, retryCount, MAX_BUY_RETRIES, e.message);
        }
      }
      await saveIfDirty(true);
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
  const reason = trade.closeReason === "tp" ? "TP hit" : trade.closeReason === "sl" ? "SL hit" : trade.closeReason === "trail" ? "Trail stop" : "Expired";
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
  try {
    await loadState();
  } catch (e) {
    err("Failed to load state from DB (will start fresh): %s", e.message);
  }
  log("First tick starting…");
  loop();
})();
