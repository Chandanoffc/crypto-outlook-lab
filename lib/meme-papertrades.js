"use strict";

const STARTING_BALANCE  = 200;
const POSITION_SIZE_PCT = 0.10;  // 10% of balance per trade
const TP_PCT            = 0.60;  // +60% from entry
const SL_PCT            = -0.20; // -20% from entry → 3:1 R:R, break-even at 25% win rate
const EXPIRY_MS          = 24 * 60 * 60 * 1000; // 24h
const NO_PRICE_EXPIRY_MS = 30 * 60 * 1000;       // 30min with no price = dead/rugged token
const DEAD_LIQ_USD       = 500;                   // liquidity below this = token dead, close as SL
// Trailing stop: once highWatermark >= entry * TRAIL_ACTIVATE_MULT,
// close if price drops TRAIL_PCT below the watermark.
// Catches pump-and-dumps that the fixed TP misses between 2-min cron ticks.
const TRAIL_ACTIVATE_MULT = 1.30; // activates at +30% profit
const TRAIL_PCT           = 0.15; // close if price falls 15% from watermark

function defaultPaperState() {
  return { balance: STARTING_BALANCE, trades: [], dailyLog: [], _dayKey: null, _dayStartBalance: STARTING_BALANCE };
}

// Returns "YYYY-MM-DD" in UTC
function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

// Called at the start of each mark tick. If the day has rolled over, snapshot
// yesterday's stats into dailyLog and reset the day-start balance.
function maybeRollDay(paperState) {
  const key = todayKey();
  if (paperState._dayKey === key) return; // same day, nothing to do

  if (paperState._dayKey) {
    // Snapshot the completed day
    const closed    = (paperState.trades || []).filter(t => t.status !== "open" && t.closedAt);
    const todayClosed = closed.filter(t => {
      const d = new Date(t.closedAt).toISOString().slice(0, 10);
      return d === paperState._dayKey;
    });
    const wins    = todayClosed.filter(t => t.status === "win");
    const losses  = todayClosed.filter(t => t.status !== "win");
    const dayPnl  = todayClosed.reduce((s, t) => s + (t.pnl || 0), 0);
    paperState.dailyLog = paperState.dailyLog || [];
    paperState.dailyLog.unshift({
      date:           paperState._dayKey,
      openingBalance: Math.round((paperState._dayStartBalance || STARTING_BALANCE) * 100) / 100,
      closingBalance: Math.round(paperState.balance * 100) / 100,
      trades:         todayClosed.length,
      wins:           wins.length,
      losses:         losses.length,
      winRate:        todayClosed.length ? Math.round(wins.length / todayClosed.length * 1000) / 10 : null,
      pnl:            Math.round(dayPnl * 100) / 100,
      pnlPct:         paperState._dayStartBalance > 0
                        ? Math.round((dayPnl / paperState._dayStartBalance) * 10000) / 100
                        : null,
      topWin:         wins.length   ? Math.max(...wins.map(t => t.pnl   || 0)) : null,
      topLoss:        losses.length ? Math.min(...losses.map(t => t.pnl  || 0)) : null,
      avgHoldWinMs:   wins.length   ? wins.reduce((s, t) => s + (t.holdMs || 0), 0) / wins.length   : null,
      avgHoldLossMs:  losses.length ? losses.reduce((s, t) => s + (t.holdMs || 0), 0) / losses.length : null,
      bySource: (() => {
        const src = {};
        for (const t of todayClosed) {
          const s = t.source || "unknown";
          if (!src[s]) src[s] = { trades: 0, wins: 0, pnl: 0 };
          src[s].trades++; if (t.status === "win") src[s].wins++; src[s].pnl += t.pnl || 0;
        }
        return src;
      })(),
      byMcTier: (() => {
        const tier = (mc) => !mc ? "unknown" : mc < 100_000 ? "<$100K" : mc < 500_000 ? "$100K-500K" : "$500K-3M";
        const tiers = {};
        for (const t of todayClosed) {
          const k = tier(t.detected_mc);
          if (!tiers[k]) tiers[k] = { trades: 0, wins: 0, pnl: 0 };
          tiers[k].trades++; if (t.status === "win") tiers[k].wins++; tiers[k].pnl += t.pnl || 0;
        }
        return tiers;
      })(),
      trades: todayClosed.map(t => ({
        symbol:     t.symbol || t.name || t.mint?.slice(0, 8),
        status:     t.status,
        pnl:        t.pnl,
        pnlPct:     t.pnlPct,
        holdMs:     t.holdMs || null,
        source:     t.source || null,
        detected_mc: t.detected_mc || null,
        pair_url:   t.pair_url || null,
      })),
    });
    paperState.dailyLog = paperState.dailyLog.slice(0, 60); // keep 60 days
  }

  paperState._dayKey          = key;
  paperState._dayStartBalance = paperState.balance;
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
    source:       token._source     || null,
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
          const price  = parseFloat(pair.priceUsd);
          // Use multiple time windows to get the best high estimate.
          // If price is DOWN from X minutes/hours ago, the period-start price was higher.
          // Taking the max across windows catches more pump-and-dump scenarios.
          const pct5m  = pair.priceChange?.m5  ?? 0;
          const pct1h  = pair.priceChange?.h1  ?? 0;
          const pct6h  = pair.priceChange?.h6  ?? 0;
          const high5m = pct5m < 0 ? price / (1 + pct5m / 100) : price;
          const high1h = pct1h < 0 ? price / (1 + pct1h / 100) : price;
          const high6h = pct6h < 0 ? price / (1 + pct6h / 100) : price;
          const bestHigh = Math.max(high5m, high1h, high6h);
          map[mint] = { price, high5m: bestHigh, liq: pair.liquidity?.usd || 0 };
        }
      }
    } catch { /* continue */ }
  }
  return map;
}

async function checkPaperTrades(paperState) {
  maybeRollDay(paperState);
  const now        = Date.now();
  const openTrades = (paperState.trades || []).filter(t => t.status === "open");
  if (!openTrades.length) return { checked: 0, closed: 0, closedTrades: [] };

  const priceMap = await fetchDexPrices(openTrades.map(t => t.mint));

  let closed = 0;
  const closedTrades = [];
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

    const liq = priceData?.liq ?? null;

    if (ageMs >= EXPIRY_MS) {
      closeReason = "expired";
      closePrice  = currentPrice ?? trade.entryPrice;
    } else if (currentPrice == null && ageMs >= NO_PRICE_EXPIRY_MS) {
      // Token vanished from DexScreener — delisted or dead pool. Close as SL.
      closeReason = "sl";
      closePrice  = trade.sl;
    } else if (currentPrice != null) {
      const hwm = trade.highWatermark ?? 0;
      // Fixed TP: checked always — even in grace, a confirmed pump at TP registers a win
      if (hwm >= trade.tp) {
        closeReason = "tp";
        closePrice  = trade.tp;
      } else if (!inGrace) {
        // Trailing stop: activates once watermark reaches +30%, closes on 15% pullback from peak.
        // Catches pump-and-dumps the fixed TP missed between 2-min cron ticks.
        const trailActive = hwm >= trade.entryPrice * TRAIL_ACTIVATE_MULT;
        const trailStop   = hwm * (1 - TRAIL_PCT);
        if (trailActive && currentPrice <= trailStop) {
          closeReason = "tp"; // still a profitable exit
          closePrice  = currentPrice;
        } else if (liq !== null && liq < DEAD_LIQ_USD && currentPrice < trade.entryPrice) {
          // Liquidity drained — rug/dump
          closeReason = "sl";
          closePrice  = Math.min(currentPrice, trade.sl);
        } else if (currentPrice <= trade.sl) {
          closeReason = "sl";
          closePrice  = trade.sl;
        }
      }
    }

    if (!closeReason) continue;

    const pnlPct = ((closePrice - trade.entryPrice) / trade.entryPrice) * 100;
    const pnl    = trade.size * (pnlPct / 100);

    trade.status      = closeReason === "tp" ? "win" : (closeReason === "sl" ? "loss" : "expired");
    trade.closedAt    = now;
    trade.holdMs      = now - (trade.openedAt || now);
    trade.closePrice  = closePrice;
    trade.closeReason = closeReason;
    trade.currentPrice = closePrice;
    trade.pnl         = Math.round(pnl * 100) / 100;
    trade.pnlPct      = Math.round(pnlPct * 100) / 100;

    paperState.balance = Math.round(((paperState.balance ?? STARTING_BALANCE) + pnl) * 100) / 100;
    closedTrades.push(trade);
    closed++;
  }

  return { checked: openTrades.length, closed, closedTrades };
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

module.exports = { defaultPaperState, openTrade, checkPaperTrades, calcStats, fetchDexPrices, maybeRollDay, STARTING_BALANCE };
