"use strict";

const STARTING_BALANCE  = 200;
const POSITION_SIZE_PCT = 0.10;  // 10% of balance per trade
const TP_PCT            = 0.60;  // +60% from entry
const SL_PCT            = -0.30; // -30% from entry — widened to reduce noise-triggered SL hits
const EXPIRY_MS          = 24 * 60 * 60 * 1000; // 24h
const NO_PRICE_EXPIRY_MS = 30 * 60 * 1000;       // 30min with no price = dead/rugged token
const MIN_HOLD_BEFORE_SL = 20 * 60 * 1000;       // SL cannot fire in first 20 min — survives initial shakeout
const DEAD_LIQ_USD       = 2_000;                 // raised from $500 — exit earlier before rug completes
// Trailing stop: once highWatermark >= entry * TRAIL_ACTIVATE_MULT,
// close if price drops below the watermark by a tier-dependent amount.
// Tier widens the trail at lower gains so normal memecoin wicks don't stop us out.
const TRAIL_ACTIVATE_MULT = 1.50; // activates at +50% profit (paper trades)
// Tiered trail for real trades — wider early on, tightens as gains compound:
//   +30%–+100%:  40% pullback allowed  (memecoins wick hard during the initial pump)
//   +100%–+200%: 30% pullback allowed  (more established move, less noise)
//   +200%+:      20% pullback allowed  (protect big gains tightly)
function realTrailPct(gainPct) {
  if (gainPct >= 200) return 0.20;
  if (gainPct >= 100) return 0.30;
  return 0.40;
}
const TRAIL_PCT = 0.20; // paper trades only

// Partial exit levels for real trades (house-money strategy):
//   +110%: sell 50% — recover full initial + profit, rest runs on house money
//   +200%: sell 25% more — lock additional profits
const PARTIAL_EXIT_1_MULT = 2.10; // +110%
const PARTIAL_EXIT_2_MULT = 3.00; // +200%

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
  const partialExits = []; // real trades needing a partial on-chain sell this tick

  for (const trade of paperState.trades) {
    if (trade.status !== "open") continue;

    const ageMs        = now - (trade.openedAt || now);
    const priceData    = priceMap[trade.mint];
    const currentPrice = priceData?.price ?? null;
    const high5m       = priceData?.high5m ?? currentPrice;

    // Track highest price seen across all mark ticks — TP is checked against this
    if (high5m != null) trade.highWatermark = Math.max(trade.highWatermark ?? 0, high5m);
    if (currentPrice != null) trade.currentPrice = currentPrice;

    const liq = priceData?.liq ?? null;
    const hwm = trade.highWatermark ?? 0;

    // ── Partial exits for real trades (house-money strategy) ─────────────────
    // Check before close logic so we flag even if not closing this tick.
    if (trade.realTrade?.status === "open") {
      const hwmGainPct = trade.entryPrice > 0 ? ((hwm / trade.entryPrice) - 1) * 100 : 0;
      if (hwmGainPct >= 110 && !trade.partialExit1Done) {
        trade.partialExit1Done = true;
        partialExits.push({ trade, level: 1, fraction: 0.50, gainPct: hwmGainPct });
      } else if (hwmGainPct >= 200 && !trade.partialExit2Done) {
        trade.partialExit2Done = true;
        partialExits.push({ trade, level: 2, fraction: 0.25, gainPct: hwmGainPct });
      }
    }

    let closeReason = null;
    let closePrice  = null;

    if (ageMs >= EXPIRY_MS) {
      closeReason = "expired";
      closePrice  = currentPrice ?? trade.entryPrice;
    } else if (currentPrice == null && ageMs >= NO_PRICE_EXPIRY_MS) {
      // Token vanished from DexScreener — delisted or dead pool. Close as SL.
      closeReason = "sl";
      closePrice  = trade.sl;
    } else if (currentPrice != null) {
      // Fixed TP: paper-only trades close at +60%. Real trades skip fixed TP —
      // tiered trailing stop rides the move instead.
      if (hwm >= trade.tp && !trade.realTrade) {
        closeReason = "tp";
        closePrice  = trade.tp;
      } else {
        // Tiered trailing stop for real trades: wider early, tightens at 2x+ gains.
        // Paper trades use fixed 20%.
        const activateMult = trade.realTrade ? 1.30 : TRAIL_ACTIVATE_MULT;
        const trailActive  = hwm >= trade.entryPrice * activateMult;
        const hwmGainPct   = trade.entryPrice > 0 ? ((hwm / trade.entryPrice) - 1) * 100 : 0;
        const trailPct     = trade.realTrade ? realTrailPct(hwmGainPct) : TRAIL_PCT;
        const trailStop    = hwm * (1 - trailPct);
        // After initials recovered (+110%), floor SL at breakeven — remainder is house money
        const effectiveSl  = (trade.realTrade && trade.partialExit1Done)
          ? Math.max(trade.sl, trade.entryPrice)
          : trade.sl;
        // Hard SL is delayed for first 20 min — gives token time to shake out weak hands.
        // Trail, TP, and dead-liquidity exits still fire immediately.
        const slGrace = ageMs < MIN_HOLD_BEFORE_SL;
        if (trailActive && currentPrice <= trailStop) {
          closeReason = "trail";
          closePrice  = currentPrice;
        } else if (liq !== null && liq < DEAD_LIQ_USD && currentPrice < trade.entryPrice) {
          // Liquidity drained — rug/dump — fire immediately regardless of grace
          closeReason = "sl";
          closePrice  = Math.min(currentPrice, effectiveSl);
        } else if (!slGrace && currentPrice <= effectiveSl) {
          closeReason = "sl";
          closePrice  = effectiveSl;
        }
      }
    }

    if (!closeReason) continue;

    const pnlPct = ((closePrice - trade.entryPrice) / trade.entryPrice) * 100;
    const pnl    = trade.size * (pnlPct / 100);

    trade.status      = (closeReason === "tp" || closeReason === "trail") ? "win" : (closeReason === "sl" ? "loss" : "expired");
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

  return { checked: openTrades.length, closed, closedTrades, partialExits };
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
