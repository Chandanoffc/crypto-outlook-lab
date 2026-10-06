"use strict";

const STARTING_BALANCE  = 100;
const POSITION_SIZE_PCT = 0.10;  // 10% of balance per trade
const TP_PCT            = 0.60;  // +60% from entry
const SL_PCT            = -0.20; // -20% from entry → 3:1 R:R, break-even at 25% win rate
const EXPIRY_MS         = 24 * 60 * 60 * 1000; // 24h
const NO_PRICE_EXPIRY_MS = 2 * 60 * 60 * 1000;  // 2h with no price = dead token, close as expired

function defaultPaperState() {
  return { balance: STARTING_BALANCE, trades: [] };
}

function openTrade(paperState, token) {
  if (!token.detected_price || token.detected_price <= 0) return null;

  // Don't open a duplicate for the same mint
  if ((paperState.trades || []).some(t => t.mint === token.mint && t.status === "open")) return null;

  const balance    = paperState.balance ?? STARTING_BALANCE;
  const size       = Math.round(balance * POSITION_SIZE_PCT * 100) / 100;
  const entryPrice = token.detected_price;

  const trade = {
    id:           `${token.mint}_${token.detectedAt || Date.now()}`,
    mint:         token.mint,
    name:         token.name   || token.symbol || token.mint.slice(0, 8),
    symbol:       token.symbol || "?",
    pair_url:     token.pair_url || null,
    entryPrice,
    tp:           entryPrice * (1 + TP_PCT),
    sl:           entryPrice * (1 + SL_PCT),
    size,
    status:       "open",
    openedAt:     token.detectedAt || Date.now(),
    closedAt:     null,
    closePrice:   null,
    closeReason:  null,
    currentPrice: null,
    pnl:          null,
    pnlPct:       null,
    detected_mc:  token.detected_mc || null,
  };

  paperState.trades = [...(paperState.trades || []), trade];
  return trade;
}

async function fetchDexPrices(mints) {
  if (!mints.length) return {};
  const chunks = [];
  for (let i = 0; i < mints.length; i += 30) chunks.push(mints.slice(i, i + 30));
  const map = {};
  for (const chunk of chunks) {
    try {
      const r = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${chunk.join(",")}`);
      const d = await r.json();
      for (const pair of (d.pairs || [])) {
        if (pair.chainId !== "solana") continue;
        const mint = pair.baseToken?.address;
        if (!mint || !pair.priceUsd) continue;
        if (!map[mint] || (pair.liquidity?.usd || 0) > (map[mint].liq || 0)) {
          const price    = parseFloat(pair.priceUsd);
          // Reconstruct the 5m high using the 5m price change.
          // If price is currently DOWN from 5m ago, the high was earlier = price / (1 + pct/100).
          // If price is UP, the current price IS roughly the high for the window.
          const pct5m    = pair.priceChange?.m5 ?? 0;
          const high5m   = pct5m < 0 ? price / (1 + pct5m / 100) : price;
          map[mint] = { price, high5m, liq: pair.liquidity?.usd || 0 };
        }
      }
    } catch { /* continue */ }
  }
  return map;
}

async function checkPaperTrades(paperState) {
  const now        = Date.now();
  const openTrades = (paperState.trades || []).filter(t => t.status === "open");
  if (!openTrades.length) return { checked: 0, closed: 0 };

  const priceMap = await fetchDexPrices(openTrades.map(t => t.mint));

  let closed = 0;
  for (const trade of paperState.trades) {
    if (trade.status !== "open") continue;

    const ageMs        = now - (trade.openedAt || now);
    const priceData    = priceMap[trade.mint];
    const currentPrice = priceData?.price ?? null;
    const high5m       = priceData?.high5m ?? currentPrice;

    // Track highest price seen across all mark ticks — TP is checked against this
    if (high5m != null) trade.highWatermark = Math.max(trade.highWatermark ?? 0, high5m);
    if (currentPrice != null) trade.currentPrice = currentPrice;

    let closeReason = null;
    let closePrice  = null;

    // Grace period: SL cannot trigger for the first 5 minutes after detection.
    // Gives highWatermark time to register a TP before the dump hits SL.
    // 5 min is enough now that meme-mark runs every 2 minutes.
    const SL_GRACE_MS = 5 * 60 * 1000;
    const inGrace = ageMs < SL_GRACE_MS;

    if (ageMs >= EXPIRY_MS) {
      closeReason = "expired";
      closePrice  = currentPrice ?? trade.entryPrice;
    } else if (currentPrice == null && ageMs >= NO_PRICE_EXPIRY_MS) {
      // Token vanished from DexScreener — delisted or dead pool. Close as expired.
      closeReason = "expired";
      closePrice  = trade.entryPrice;
    } else if (currentPrice != null) {
      // TP: always checked — even in grace period, a confirmed pump registers a win
      if ((trade.highWatermark ?? 0) >= trade.tp) {
        closeReason = "tp";
        closePrice  = trade.tp;
      } else if (!inGrace && currentPrice <= trade.sl) {
        closeReason = "sl";
        closePrice  = trade.sl;
      }
    }

    if (!closeReason) continue;

    const pnlPct = ((closePrice - trade.entryPrice) / trade.entryPrice) * 100;
    const pnl    = trade.size * (pnlPct / 100);

    trade.status      = closeReason === "tp" ? "win" : closeReason === "sl" ? "loss" : "expired";
    trade.closedAt    = now;
    trade.closePrice  = closePrice;
    trade.closeReason = closeReason;
    trade.currentPrice = closePrice;
    trade.pnl         = Math.round(pnl * 100) / 100;
    trade.pnlPct      = Math.round(pnlPct * 100) / 100;

    paperState.balance = Math.round(((paperState.balance ?? STARTING_BALANCE) + pnl) * 100) / 100;
    closed++;
  }

  return { checked: openTrades.length, closed };
}

function calcStats(trades) {
  const all     = trades || [];
  const open    = all.filter(t => t.status === "open");
  const closed  = all.filter(t => t.status !== "open");
  const wins    = closed.filter(t => t.status === "win");
  const losses  = closed.filter(t => t.status === "loss" || t.status === "expired");

  const totalPnl = closed.reduce((s, t) => s + (t.pnl || 0), 0);
  const avgPnl   = closed.length ? totalPnl / closed.length : 0;
  const winRate  = closed.length ? (wins.length / closed.length) * 100 : null;

  return {
    total:    all.length,
    open:     open.length,
    closed:   closed.length,
    wins:     wins.length,
    losses:   losses.length,
    totalPnl: Math.round(totalPnl * 100) / 100,
    avgPnl:   Math.round(avgPnl * 100) / 100,
    winRate:  winRate != null ? Math.round(winRate * 10) / 10 : null,
  };
}

module.exports = { defaultPaperState, openTrade, checkPaperTrades, calcStats, fetchDexPrices };
