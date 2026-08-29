/**
 * emaperps-runtime.js — "EMA Signals" strategy
 *
 * Signal rules (all on 1H timeframe):
 *
 * LONG — requires EMA20 > EMA50 (uptrend):
 *   A. Price touches EMA20 + Support 1 → Good Long (Q70),  TP1: R1, TP2: R2
 *   B. Price touches EMA20 + Support 2 → Strong Long (Q80), TP1: R1, TP2: R2
 *   C. Price touches EMA50 + Support 1 → Good Long (Q75),  TP1: R1, TP2: R2
 *   D. Price touches EMA50 + Support 2 → Strong Long (Q85), TP1: R1, TP2: R2
 *   E. Price touches Support 1 only    → Moderate Long (Q60), TP1: R1, TP2: R2
 *   F. Price touches Support 2 only    → Good Long (Q70),    TP1: R1, TP2: R2
 *
 * SHORT — requires EMA50 > EMA20 (downtrend):
 *   G. Price touches EMA20 + Resistance 1 → Good Short (Q70),  TP1: S1, TP2: S2
 *   H. Price touches EMA20 + Resistance 2 → Strong Short (Q80), TP1: S1, TP2: S2
 *   I. Price touches EMA50 + Resistance 1 → Good Short (Q75),  TP1: S1, TP2: S2
 *   J. Price touches EMA50 + Resistance 2 → Strong Short (Q85), TP1: S1, TP2: S2
 *   K. Price touches Resistance 1 only    → Moderate Short (Q60), TP1: S1, TP2: S2
 *   L. Price touches Resistance 2 only    → Good Short (Q70),    TP1: S1, TP2: S2
 *
 * Additional quality bonuses: +5 volume, +5 RSI neutral, +5 wick confirmation
 * SL: below S1/S2 (Long) or above R1/R2 (Short) plus 0.5 ATR buffer
 * Minimum target filter: R1 must be ≥5% from entry, R2 must be ≥10% from entry
 */

"use strict";

const {
  sanitizeNumber, average, formatPrice, formatPercent,
  fetchJson, setRuntimeStatus, updateAlertDeliveryResult, safeInsertSignalEvent,
  perpUniverseSymbols, scoreSymbolCandidate, mapKlineEntry, QUOTE_ASSET,
} = require("./engine-core");
const { hasDatabase, getRuntimeState, upsertRuntimeState } = require("./neon-db");
const { isDiscordWebhook, resolveBaseUrl, sendDiscordNotify } = require("./notify-client");

// ─── Constants ──────────────────────────────────────────────────────────────

const STRATEGY_ID = "emaperps";
const INTERVAL = "1h";
const SIGNAL_EXPIRE_MS = 8 * 60 * 60 * 1000;
const SCAN_COOLDOWN_MS = 4 * 60 * 1000;
const ANALYSIS_CONCURRENCY = 5;
const PRIORITY_SCAN_COUNT = 24;
const ROTATION_SCAN_COUNT = 48;
const BINANCE_FAPI = "https://fapi.binance.com/fapi/v1";
const MIN_ALERT_QUALITY = 95;                         // raised 83→95: Q90-94 bucket had 10% WR / -$19 net across 10 trades
// Raised 80→83: 90d backtest showed 22% WR at Q80 floor (break-even is ~25% at 3:1 R:R).
// Q83+ cuts the weakest H1/H2 EMA-bounce entries that were dragging the profit factor below 1.
const ALERT_COOLDOWN_MS = 4 * 60 * 60 * 1000;        // 4h cooldown per symbol+side

// Paper trading constants
const PAPER_START    = 100;
const PAPER_MAX_POS  = 5;
const PAPER_LEVERAGE = 5;      // 5× leverage — models realistic perps sizing
const PAPER_EXPIRY   = 48 * 60 * 60 * 1000;  // 48h before force-close (was 24h)
const PAPER_BE_TRIGGER_PCT = 25;             // leveraged % gain → trail SL to entry
const PAPER_SIZE_MIN_PCT = 0.07;             // size at the quality floor (MIN_ALERT_QUALITY)
const PAPER_SIZE_MAX_PCT = 0.14;             // size at/above the high-conviction ceiling
const PAPER_SIZE_QUALITY_CEIL = 92;          // quality at which sizing maxes out
const TP1_PARTIAL_CLOSE_PCT = 0.5;           // fraction of position booked at TP1

// Conviction-weighted sizing — a Q92 setup gets ~2x the allocation of a Q80 one.
// Linearly interpolates between the floor and ceiling quality, clamped at both ends.
function qualityWeightedSizePct(quality) {
  const span = PAPER_SIZE_QUALITY_CEIL - MIN_ALERT_QUALITY;
  const t = span > 0 ? Math.max(0, Math.min(1, (quality - MIN_ALERT_QUALITY) / span)) : 1;
  return PAPER_SIZE_MIN_PCT + t * (PAPER_SIZE_MAX_PCT - PAPER_SIZE_MIN_PCT);
}

// ─── Circuit breaker — pause new entries after a rough patch ─────────────────
// Protects capital from compounding correlated losses (crypto alts move together —
// a string of SL hits in one selloff shouldn't be allowed to snowball unchecked).
const CB_MAX_DRAWDOWN_PCT   = 20;                  // pause if balance falls 20% from its peak
const CB_MAX_CONSEC_LOSSES  = 4;                   // pause after N losing closes in a row
const CB_DRAWDOWN_PAUSE_MS  = 24 * 60 * 60 * 1000; // 24h cool-off on drawdown trip
const CB_STREAK_PAUSE_MS    = 6  * 60 * 60 * 1000; // 6h cool-off on loss-streak trip

// ─── Fill slippage modeling ──────────────────────────────────────────────────
// Paper fills were previously assumed perfect (exact entry/SL/TP price), which
// systematically overstates real-world P&L — especially on the lower-liquidity
// alts this scanner covers, and especially on stop-outs (which trigger as market
// orders during the fast moves that blow through a level). We haircut "market
// style" fills (entries, SL stop-outs, forced/expiry exits) by a flat 0.08% —
// TP1/TP2 are modeled as resting limit orders and filled at-or-better untouched.
const FILL_SLIPPAGE_PCT = 0.0008;
function applyEntrySlippage(price, side) {
  return side === "Long" ? price * (1 + FILL_SLIPPAGE_PCT) : price * (1 - FILL_SLIPPAGE_PCT);
}
function applyExitSlippage(price, side) {
  // Closing a Long = selling into the book (fills lower); closing a Short = buying (fills higher)
  return side === "Long" ? price * (1 - FILL_SLIPPAGE_PCT) : price * (1 + FILL_SLIPPAGE_PCT);
}

// Touch tolerance: how close price must be to a level (as ATR multiple)
const EMA_TOUCH_ATR = 0.5;
const LEVEL_TOUCH_ATR = 0.6;

let exchangeInfoCache = null;
let volumeRankCache = { ids: null, fetchedAt: 0 };
const VOLUME_RANK_TTL_MS = 60 * 60 * 1000; // refresh liquidity ranking hourly

/**
 * Ranks USDT perps by 24h quote volume (most liquid first), via a single bulk
 * /ticker/24hr call. Used to make the "priority" scan set the most-liquid majors
 * (BTC/ETH/SOL/...) instead of whatever sorts first alphabetically — liquid pairs
 * have tighter spreads, more reliable fills, and tend to produce cleaner setups.
 */
async function getVolumeRankedSymbols() {
  const now = Date.now();
  if (volumeRankCache.ids && (now - volumeRankCache.fetchedAt) < VOLUME_RANK_TTL_MS) {
    return volumeRankCache.ids;
  }
  try {
    const tickers = await fetchJson(`${BINANCE_FAPI}/ticker/24hr`, "24hr tickers (bulk)");
    const ranked = (Array.isArray(tickers) ? tickers : [])
      .filter(t => typeof t?.symbol === "string" && t.symbol.endsWith(QUOTE_ASSET))
      .sort((a, b) => (Number(b.quoteVolume) || 0) - (Number(a.quoteVolume) || 0))
      .map(t => t.symbol);
    if (ranked.length) volumeRankCache = { ids: ranked, fetchedAt: now };
    return volumeRankCache.ids || [];
  } catch (_) {
    return volumeRankCache.ids || [];
  }
}

// ─── Math indicators ─────────────────────────────────────────────────────────

function ema(values, period) {
  if (values.length < period) return new Array(values.length).fill(null);
  const m = 2 / (period + 1);
  let prev = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
  const result = new Array(period - 1).fill(null);
  result.push(prev);
  for (let i = period; i < values.length; i++) {
    prev = values[i] * m + prev * (1 - m);
    result.push(prev);
  }
  return result;
}

function rsi(values, period = 14) {
  if (values.length <= period) return new Array(values.length).fill(null);
  const result = new Array(period).fill(null);
  let avgGain = 0, avgLoss = 0;
  for (let i = 1; i <= period; i++) {
    const d = values[i] - values[i - 1];
    if (d >= 0) avgGain += d; else avgLoss -= d;
  }
  avgGain /= period; avgLoss /= period;
  result.push(avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss));
  for (let i = period + 1; i < values.length; i++) {
    const d = values[i] - values[i - 1];
    avgGain = (avgGain * (period - 1) + Math.max(0, d)) / period;
    avgLoss = (avgLoss * (period - 1) + Math.max(0, -d)) / period;
    result.push(avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss));
  }
  return result;
}

function atrValue(candles, period = 14) {
  if (candles.length < 2) return 0;
  const trs = candles.slice(1).map((c, i) => {
    const p = candles[i];
    return Math.max(c.high - c.low, Math.abs(c.high - p.close), Math.abs(c.low - p.close));
  });
  if (trs.length < period) return average(trs);
  let val = average(trs.slice(0, period));
  for (let i = period; i < trs.length; i++) val = (val * (period - 1) + trs[i]) / period;
  return val;
}

// Wilder's ADX — identical implementation to claudeperps-runtime (see comments there)
function adxValue(candles, period = 14) {
  if (candles.length < period * 2 + 1) return 0;
  const plusDMs = [], minusDMs = [], trs = [];
  for (let i = 1; i < candles.length; i++) {
    const c = candles[i], p = candles[i - 1];
    trs.push(Math.max(c.high - c.low, Math.abs(c.high - p.close), Math.abs(c.low - p.close)));
    const up = c.high - p.high, dn = p.low - c.low;
    plusDMs.push(up > 0 && up > dn ? up : 0);
    minusDMs.push(dn > 0 && dn > up ? dn : 0);
  }
  let sTR = trs.slice(0, period).reduce((a, b) => a + b, 0);
  let sPDM = plusDMs.slice(0, period).reduce((a, b) => a + b, 0);
  let sMDM = minusDMs.slice(0, period).reduce((a, b) => a + b, 0);
  const dxArr = [];
  for (let i = period; i < trs.length; i++) {
    sTR = sTR - sTR / period + trs[i];
    sPDM = sPDM - sPDM / period + plusDMs[i];
    sMDM = sMDM - sMDM / period + minusDMs[i];
    const pDI = sTR > 0 ? (sPDM / sTR) * 100 : 0;
    const mDI = sTR > 0 ? (sMDM / sTR) * 100 : 0;
    const s = pDI + mDI;
    dxArr.push(s > 0 ? (Math.abs(pDI - mDI) / s) * 100 : 0);
  }
  if (!dxArr.length) return 0;
  if (dxArr.length < period) return average(dxArr);
  let adx = average(dxArr.slice(0, period));
  for (let i = period; i < dxArr.length; i++) adx = (adx * (period - 1) + dxArr[i]) / period;
  return adx;
}

// ─── BTC macro trend — same alignment filter as claudeperps ─────────────────
let btcTrendCacheEma = { trend: null, fetchedAt: 0 };
const BTC_TREND_TTL_EMA_MS = 2 * 60 * 60 * 1000;
const INTERVAL_4H = "4h";

async function getBtcTrendEma() {
  const now = Date.now();
  if (btcTrendCacheEma.trend && (now - btcTrendCacheEma.fetchedAt) < BTC_TREND_TTL_EMA_MS) return btcTrendCacheEma.trend;
  try {
    const klines = await fetchJson(`${BINANCE_FAPI}/klines?symbol=BTCUSDT&interval=${INTERVAL_4H}&limit=60`, "BTC 4H trend");
    const closes = klines.map(k => parseFloat(k[4]));
    function emaLocal(v, p) {
      const m = 2 / (p + 1); let prev = v.slice(0, p).reduce((a, b) => a + b, 0) / p;
      const r = []; r.push(prev);
      for (let i = p; i < v.length; i++) { prev = v[i] * m + prev * (1 - m); r.push(prev); }
      return r;
    }
    const e20 = emaLocal(closes, 20), e50 = emaLocal(closes, 50);
    const last = e20.length - 1;
    const trend = (e20[last] != null && e50[last] != null) ? (e20[last] > e50[last] ? "up" : "down") : null;
    btcTrendCacheEma = { trend, fetchedAt: now };
    return trend;
  } catch (_) { return btcTrendCacheEma.trend ?? null; }
}

// ─── Support / Resistance levels via swing pivots ───────────────────────────

function findSwingLevels(candles, lookback = 100) {
  const slice = candles.slice(-Math.min(lookback, candles.length));
  const highs = [], lows = [];
  const n = 3; // pivot neighbours
  for (let i = n; i < slice.length - n; i++) {
    const c = slice[i];
    const isHigh = slice.slice(i - n, i).every(p => p.high <= c.high) &&
                   slice.slice(i + 1, i + n + 1).every(p => p.high <= c.high);
    const isLow  = slice.slice(i - n, i).every(p => p.low  >= c.low)  &&
                   slice.slice(i + 1, i + n + 1).every(p => p.low  >= c.low);
    if (isHigh) highs.push({ price: c.high, time: c.time, index: i });
    if (isLow)  lows.push({ price: c.low,  time: c.time, index: i });
  }

  // Cluster nearby pivots within 1% of each other — count how many tests each cluster has.
  // A level tested 3× is qualitatively different from one seen once; test count feeds quality scoring.
  // Sort clusters by test count (most-tested first), then by recency for ties.
  const cluster = (arr, key) => {
    const sorted = arr.sort((a, b) => b.index - a.index);
    const clusters = [];
    for (const p of sorted) {
      const existing = clusters.find(c => Math.abs(c[key] - p[key]) / c[key] < 0.010);
      if (existing) { existing.tests++; }
      else { clusters.push({ ...p, tests: 1 }); }
    }
    return clusters.sort((a, b) => b.tests - a.tests || b.index - a.index);
  };

  const highClusters = cluster(highs, "price");
  const lowClusters  = cluster(lows,  "price");

  return {
    r1: highClusters[0]?.price ?? null, r1Tests: highClusters[0]?.tests ?? 0,
    r2: highClusters[1]?.price ?? null, r2Tests: highClusters[1]?.tests ?? 0,
    s1: lowClusters[0]?.price  ?? null, s1Tests: lowClusters[0]?.tests ?? 0,
    s2: lowClusters[1]?.price  ?? null, s2Tests: lowClusters[1]?.tests ?? 0,
  };
}

// Check if price "touches" a level (within tolerance)
function touches(price, level, tolerance) {
  if (level == null) return false;
  return Math.abs(price - level) <= tolerance;
}

// ─── State management ────────────────────────────────────────────────────────

function defaultPaper() {
  return {
    balance: PAPER_START, startingBalance: PAPER_START, openPositions: [], closedTrades: [], lastMarkAt: 0,
    peakBalance: PAPER_START, consecutiveLosses: 0, pausedUntil: 0, pauseReason: null, symbolCooldowns: {},
  };
}

function sanitizePaperTrade(t = {}) {
  return {
    id:             String(t.id || ""),
    symbol:         String(t.symbol || ""),
    side:           t.side === "Short" ? "Short" : "Long",
    entryPrice:     sanitizeNumber(t.entryPrice, 0),
    tp1:            sanitizeNumber(t.tp1, 0),
    tp2:            sanitizeNumber(t.tp2, 0),
    sl:             sanitizeNumber(t.sl, 0),
    size:           sanitizeNumber(t.size, 0),
    openedAt:       sanitizeNumber(t.openedAt, 0),
    closedAt:       t.closedAt != null ? sanitizeNumber(t.closedAt, 0) : null,
    closedPrice:    t.closedPrice != null ? sanitizeNumber(t.closedPrice, 0) : null,
    closeReason:    t.closeReason ? String(t.closeReason) : null,
    pnl:            t.pnl != null ? sanitizeNumber(t.pnl, 0) : null,
    pnlPct:         t.pnlPct != null ? sanitizeNumber(t.pnlPct, 0) : null,
    quality:        sanitizeNumber(t.quality, 0),
    signalType:     String(t.signalType || ""),   // pattern code (A1/B2/G2/H1/…)
    signalLabel:    String(t.signalLabel || ""),   // human-readable label
    signalId:       String(t.signalId || ""),
    pricePrecision: sanitizeNumber(t.pricePrecision, 2),
    tp1Reached:     Boolean(t.tp1Reached),
    leverage:       sanitizeNumber(t.leverage, 1),
    lastMarkPrice:  t.lastMarkPrice > 0 ? sanitizeNumber(t.lastMarkPrice, 0) : null,
    lastMarkAt:     sanitizeNumber(t.lastMarkAt, 0),
    slMovedToBE:    Boolean(t.slMovedToBE),
    originalSize:   sanitizeNumber(t.originalSize, 0) || sanitizeNumber(t.size, 0),
    realizedPnl:    sanitizeNumber(t.realizedPnl, 0),
  };
}

function sanitizePaper(raw = {}) {
  return {
    balance:       sanitizeNumber(raw.balance, PAPER_START),
    startingBalance: sanitizeNumber(raw.startingBalance, PAPER_START),
    openPositions: Array.isArray(raw.openPositions) ? raw.openPositions.map(sanitizePaperTrade).slice(0, 10) : [],
    closedTrades:  Array.isArray(raw.closedTrades)  ? raw.closedTrades.map(sanitizePaperTrade).slice(0, 300) : [],
    lastMarkAt:    sanitizeNumber(raw.lastMarkAt, 0),
    peakBalance:       Math.max(sanitizeNumber(raw.peakBalance, PAPER_START), sanitizeNumber(raw.balance, PAPER_START), PAPER_START),
    consecutiveLosses: Math.max(0, sanitizeNumber(raw.consecutiveLosses, 0)),
    pausedUntil:       sanitizeNumber(raw.pausedUntil, 0),
    pauseReason:       typeof raw.pauseReason === "string" ? raw.pauseReason.slice(0, 200) : null,
    symbolCooldowns:   raw.symbolCooldowns && typeof raw.symbolCooldowns === "object" ? { ...raw.symbolCooldowns } : {},
  };
}

function defaultRuntimeState() {
  return {
    signals: [],
    lastScanAt: 0,
    lastCronAt: 0,   // timestamp of the last successful upbit-cron ping
    scanCursor: 0,
    alertDelivery: {
      discordWebhook: "",
      notifyOnNew: true,
      lastResultAt: 0,
      lastResultMessage: "Discord delivery not configured.",
      lastResultTone: "neutral",
    },
    lastStatusMessage: "EMA Perps is standing by.",
    lastStatusTone: "neutral",
    freshStart: false,
    paper: defaultPaper(),
    lastScanResults: [],
  };
}

function sanitizeSignal(s = {}) {
  return {
    id: String(s.id || ""),
    symbol: String(s.symbol || ""),
    side: s.side === "Short" ? "Short" : "Long",
    quality: sanitizeNumber(s.quality, 0),
    signalType: String(s.signalType || ""),
    signalLabel: String(s.signalLabel || ""),
    interval: INTERVAL,
    detectedAt: sanitizeNumber(s.detectedAt, 0),
    alertedAt: sanitizeNumber(s.alertedAt, 0),
    outcomeSent: s.outcomeSent === true,
    outcome: typeof s.outcome === "string" ? s.outcome : null,
    entryPrice: sanitizeNumber(s.entryPrice, 0),
    sl: sanitizeNumber(s.sl, 0),
    tp1: sanitizeNumber(s.tp1, 0),
    tp2: sanitizeNumber(s.tp2, 0),
    ema20: sanitizeNumber(s.ema20, 0),
    ema50: sanitizeNumber(s.ema50, 0),
    s1: sanitizeNumber(s.s1, 0),
    s2: sanitizeNumber(s.s2, 0),
    r1: sanitizeNumber(s.r1, 0),
    r2: sanitizeNumber(s.r2, 0),
    atr: sanitizeNumber(s.atr, 0),
    currentPrice: sanitizeNumber(s.currentPrice, 0),
    rsi: sanitizeNumber(s.rsi, 0),
    fundingRate: sanitizeNumber(s.fundingRate, 0),
    status: ["active","tp1_hit","tp2_hit","sl_hit","expired"].includes(s.status) ? s.status : "active",
    pricePrecision: sanitizeNumber(s.pricePrecision, 2),
    candleTime: sanitizeNumber(s.candleTime, 0),
    reasonLabels: Array.isArray(s.reasonLabels) ? s.reasonLabels.slice(0, 12) : [],
    htfTrend:      s.htfTrend === "up" || s.htfTrend === "down" ? s.htfTrend : null,
    htfEmaBonus:   Boolean(s.htfEmaBonus),
    htfLevelBonus: Boolean(s.htfLevelBonus),
  };
}

function sanitizeRuntimeState(raw = {}) {
  const base = defaultRuntimeState();
  return {
    signals: Array.isArray(raw.signals) ? raw.signals.map(sanitizeSignal).slice(0, 200) : [],
    lastScanAt: sanitizeNumber(raw.lastScanAt, 0),
    lastCronAt: sanitizeNumber(raw.lastCronAt, 0),
    scanCursor: Math.max(0, sanitizeNumber(raw.scanCursor, 0)),
    alertDelivery: {
      discordWebhook: String(raw.alertDelivery?.discordWebhook || "").trim(),
      notifyOnNew: raw.alertDelivery?.notifyOnNew !== false,
      lastResultAt: sanitizeNumber(raw.alertDelivery?.lastResultAt, 0),
      lastResultMessage: String(raw.alertDelivery?.lastResultMessage || base.alertDelivery.lastResultMessage).slice(0, 240),
      lastResultTone: ["up","down"].includes(raw.alertDelivery?.lastResultTone) ? raw.alertDelivery.lastResultTone : "neutral",
    },
    lastStatusMessage: String(raw.lastStatusMessage || base.lastStatusMessage).slice(0, 400),
    lastStatusTone: ["up","down"].includes(raw.lastStatusTone) ? raw.lastStatusTone : "neutral",
    freshStart: Boolean(raw.freshStart),
    paper: sanitizePaper(raw.paper || {}),
    lastScanResults: Array.isArray(raw.lastScanResults) ? raw.lastScanResults.slice(0, 300) : [],
  };
}

// ─── Paper trading helpers ────────────────────────────────────────────────────

function closePaperPos(state, pos, closePrice, reason, now) {
  // Idempotency guard: skip if already closed by a concurrent path
  if (state.paper.closedTrades.some(t => t.id === pos.id)) return false;
  const diff = pos.side === "Long" ? closePrice - pos.entryPrice : pos.entryPrice - closePrice;
  const lev  = pos.leverage || 1;
  // pnl on the remaining (open) leg only — any TP1 partial was already booked to
  // balance immediately when it happened (see markPaperPositions). The trade
  // record below reports the *combined* pnl/pnlPct across both legs so stats
  // (win rate, profit factor, etc.) reflect the whole trade's true outcome.
  const legPnl = Math.round((diff / pos.entryPrice) * pos.size * lev * 100) / 100;
  const realizedPnl = Math.round((pos.realizedPnl || 0) * 100) / 100;
  const totalPnl = Math.round((legPnl + realizedPnl) * 100) / 100;
  const originalSize = pos.originalSize || pos.size;
  state.paper.balance = Math.max(0, Math.round((state.paper.balance + legPnl) * 100) / 100);
  state.paper.closedTrades.unshift({
    ...pos, closedAt: now, closedPrice: closePrice, closeReason: reason,
    pnl: totalPnl, pnlPct: Math.round((totalPnl / originalSize) * 10000) / 100,
  });
  state.paper.closedTrades = state.paper.closedTrades.slice(0, 300);

  if ((reason === "SL" || reason === "BE") && totalPnl < 0) {
    if (!state.paper.symbolCooldowns) state.paper.symbolCooldowns = {};
    state.paper.symbolCooldowns[pos.symbol] = now + 6 * 60 * 60 * 1000;
  }

  applyCircuitBreaker(state, totalPnl, now);
  return true; // actually closed — callers may fire Discord alert
}

// ─── Circuit breaker ─────────────────────────────────────────────────────────
// Tracks rolling drawdown-from-peak and consecutive-loss streaks; trips a
// temporary pause on new entries when either threshold is breached. This is the
// safety net against compounding correlated losses (crypto alts crash together —
// a bad selloff shouldn't be allowed to chew through the account unchecked).
function applyCircuitBreaker(state, pnl, now) {
  const paper = state.paper;
  paper.peakBalance = Math.max(paper.peakBalance || PAPER_START, paper.balance);

  if (pnl < 0) paper.consecutiveLosses = (paper.consecutiveLosses || 0) + 1;
  else if (pnl > 0) paper.consecutiveLosses = 0;
  // pnl === 0 (breakeven close) leaves the streak counter unchanged

  if (now < paper.pausedUntil) return; // already paused — don't re-evaluate/extend

  const drawdownPct = paper.peakBalance > 0
    ? ((paper.peakBalance - paper.balance) / paper.peakBalance) * 100
    : 0;

  if (drawdownPct >= CB_MAX_DRAWDOWN_PCT) {
    paper.pausedUntil = now + CB_DRAWDOWN_PAUSE_MS;
    paper.pauseReason = `Drawdown ${drawdownPct.toFixed(1)}% from peak ($${paper.peakBalance.toFixed(2)} → $${paper.balance.toFixed(2)}) — entries paused 24h`;
  } else if ((paper.consecutiveLosses || 0) >= CB_MAX_CONSEC_LOSSES) {
    paper.pausedUntil = now + CB_STREAK_PAUSE_MS;
    paper.pauseReason = `${paper.consecutiveLosses} losing trades in a row — entries paused 6h to avoid compounding a bad patch`;
  }
}

async function markPaperPositions(state, now, baseUrl = null) {
  if (!state.paper.openPositions.length) return;
  const syms = [...new Set(state.paper.openPositions.map(p => p.symbol))];
  const prices = {};
  await Promise.allSettled(syms.map(async s => {
    try {
      const d = await fetchJson(`${BINANCE_FAPI}/ticker/price?symbol=${s}`, `pt-price ${s}`);
      if (d?.price) prices[s] = parseFloat(d.price);
    } catch (_) {}
  }));
  state.paper.lastMarkAt = now;
  const stillOpen = [];
  for (const pos of state.paper.openPositions) {
    const price = prices[pos.symbol];
    if (!price) {
      // Price fetch failed for this symbol — keep it open for now but apply a
      // failsafe: if we haven't had a successful mark in 24 hours, force-close
      // at the last known price (or entry if never marked) rather than letting
      // the position sit in limbo indefinitely. This handles delisted/suspended
      // symbols or persistent API errors without requiring manual intervention.
      const lastGoodMark = pos.lastMarkAt || pos.openedAt;
      const FAILSAFE_NO_MARK_MS = 24 * 60 * 60 * 1000;
      if (now - lastGoodMark > FAILSAFE_NO_MARK_MS) {
        const closeAtPrice = pos.lastMarkPrice || pos.entryPrice;
        closePaperPos(state, pos, applyExitSlippage(closeAtPrice, pos.side), "EXPIRED", now);
        // No alert — we don't have a reliable price to send
      } else {
        stillOpen.push(pos);
      }
      continue;
    }
    const isLong = pos.side === "Long";
    // TP1-reached positions get 2× expiry window (SL is at breakeven so risk is near-zero)
    const effectiveExpiry = pos.tp1Reached ? PAPER_EXPIRY * 2 : PAPER_EXPIRY;
    if (now - pos.openedAt > effectiveExpiry) {
      closePaperPos(state, pos, applyExitSlippage(price, pos.side), "EXPIRED", now);
      // No banner for expired trades
      continue;
    }
    if (isLong ? price <= pos.sl : price >= pos.sl) {
      const slPrice = applyExitSlippage(pos.sl, pos.side);
      const isBE = pos.tp1Reached || pos.slMovedToBE;
      const didClose = closePaperPos(state, pos, slPrice, isBE ? "BE" : "SL", now);
      if (didClose) {
        const closed = state.paper.closedTrades[0];
        await maybeSendPaperCloseAlert(state, pos, slPrice, isBE ? "be_triggered" : "sl_hit", closed?.pnlPct, closed?.pnl, baseUrl);
      }
    } else if (isLong ? price >= pos.tp2 : price <= pos.tp2) {
      const didClose = closePaperPos(state, pos, pos.tp2, "TP2", now);
      if (didClose) {
        const closed = state.paper.closedTrades[0];
        await maybeSendPaperCloseAlert(state, pos, pos.tp2, "tp2_hit", closed?.pnlPct, closed?.pnl, baseUrl);
      }
    } else if ((isLong ? price >= pos.tp1 : price <= pos.tp1) && !pos.tp1Reached) {
      // ── Partial profit-taking at TP1 ───────────────────────────────────────
      // Book TP1_PARTIAL_CLOSE_PCT of the position now (locks in real profit
      // instead of letting 100% ride on a single TP2-or-bust outcome), trail
      // SL on the remainder to breakeven, and let the rest run for TP2.
      const diff = isLong ? pos.tp1 - pos.entryPrice : pos.entryPrice - pos.tp1;
      const lev = pos.leverage || 1;
      const originalSize = pos.originalSize || pos.size;
      const partialSize = Math.round(pos.size * TP1_PARTIAL_CLOSE_PCT * 100) / 100;
      const partialPnl = Math.round((diff / pos.entryPrice) * partialSize * lev * 100) / 100;
      state.paper.balance = Math.max(0, Math.round((state.paper.balance + partialPnl) * 100) / 100);

      pos.originalSize = originalSize;
      pos.realizedPnl = Math.round(((pos.realizedPnl || 0) + partialPnl) * 100) / 100;
      pos.size = Math.round((pos.size - partialSize) * 100) / 100;
      pos.tp1Reached = true; pos.sl = pos.entryPrice; pos.slMovedToBE = true;
      pos.lastMarkPrice = price; pos.lastMarkAt = now;
      stillOpen.push(pos); // remainder rides toward TP2 with SL at breakeven

      const tp1PnlPct = Math.round((diff / pos.entryPrice) * lev * 10000) / 100;
      await maybeSendPaperCloseAlert(state, pos, pos.tp1, "tp1_hit", tp1PnlPct, partialPnl, baseUrl);
    } else {
      // ── Breakeven protection ───────────────────────────────────────────────
      // When leveraged unrealized profit crosses +25%, trail SL to entry price.
      if (!pos.slMovedToBE && !pos.tp1Reached && pos.entryPrice > 0) {
        const favDir = isLong ? price - pos.entryPrice : pos.entryPrice - price;
        const leverPct = (favDir / pos.entryPrice) * (pos.leverage || 1) * 100;
        if (leverPct >= PAPER_BE_TRIGGER_PCT) {
          pos.sl = pos.entryPrice;
          pos.slMovedToBE = true;
          const leverPctRounded = Math.round(leverPct * 10) / 10;
          await maybeSendPaperCloseAlert(state, pos, price, "be_triggered", leverPctRounded, null, baseUrl);
        }
      }
      pos.lastMarkPrice = price; pos.lastMarkAt = now;
      stillOpen.push(pos);
    }
  }
  state.paper.openPositions = stillOpen;
}

// Per-symbol loss-streak soft-block — if the last N recent closes on a specific
// symbol were all losses, skip re-entering that symbol for a while. This prevents
// the engine from repeatedly hammering a symbol that's in an unfavourable regime
// (e.g. INJUSDT choppy range, ADAUSDT structural downtrend ignoring EMA signals).
// "Recent" = last 5 closed trades mentioning this symbol; "streak" = 3 consecutive.
const SYMBOL_LOSS_STREAK_BLOCK = 3;     // N consecutive losses on same symbol → skip
const SYMBOL_LOSS_STREAK_LOOKBACK = 5;  // how many recent closes to inspect per symbol

function symbolHasRecentLossStreak(state, symbol) {
  const recent = (state.paper.closedTrades || [])
    .filter(t => t.symbol === symbol)
    .slice(0, SYMBOL_LOSS_STREAK_LOOKBACK); // closedTrades is newest-first (unshift)
  if (recent.length < SYMBOL_LOSS_STREAK_BLOCK) return false;
  // Check that the most recent N closes are all losses
  return recent.slice(0, SYMBOL_LOSS_STREAK_BLOCK).every(t => (t.pnl || 0) < 0);
}

function openPaperTrade(state, signal, now) {
  if (signal.quality < MIN_ALERT_QUALITY) return;  // only paper-trade signals we'd actually take
  if (now < (state.paper.pausedUntil || 0)) return; // circuit breaker active — no new entries
  if (state.paper.openPositions.length >= PAPER_MAX_POS) return;
  if (state.paper.openPositions.some(p => p.symbol === signal.symbol)) return;
  if (state.paper.balance < 1) return;
  // Per-symbol cooldown: 6-hour pause after an SL loss on this symbol.
  const coolUntil = (state.paper.symbolCooldowns || {})[signal.symbol] || 0;
  if (now < coolUntil) return;
  // Per-symbol soft-block: skip a symbol that has lost N times in a row recently.
  // Avoids hammering coins in a regime the strategy handles poorly (choppy, trend-
  // less, or persistently trending against the signal direction).
  if (symbolHasRecentLossStreak(state, signal.symbol)) return;
  // Conviction-weighted sizing — higher-quality setups get a larger allocation
  const sizePct = qualityWeightedSizePct(signal.quality);
  const size = Math.max(0.50, Math.round(state.paper.balance * sizePct * 100) / 100);
  const filledEntry = applyEntrySlippage(signal.entryPrice, signal.side);
  state.paper.openPositions.push(sanitizePaperTrade({
    id: `pt-${signal.id}`, symbol: signal.symbol, side: signal.side,
    entryPrice: filledEntry, tp1: signal.tp1, tp2: signal.tp2, sl: signal.sl,
    size, originalSize: size, leverage: PAPER_LEVERAGE, openedAt: now, quality: signal.quality,
    signalType: signal.signalType || "", signalLabel: signal.signalLabel || "",
    signalId: signal.id, pricePrecision: signal.pricePrecision || 2,
  }));
}

// ─── Exchange helpers ────────────────────────────────────────────────────────

async function getExchangeInfo() {
  if (exchangeInfoCache) return exchangeInfoCache;
  exchangeInfoCache = await fetchJson(`${BINANCE_FAPI}/exchangeInfo`, "Exchange info");
  return exchangeInfoCache;
}

async function getPerpUniverse() {
  const info = await getExchangeInfo();
  return perpUniverseSymbols(info).map(s => ({
    symbol: s.symbol, baseAsset: s.baseAsset, pricePrecision: s.pricePrecision ?? 2,
  }));
}

async function selectBatch(universe, state) {
  // Rank by 24h liquidity so the guaranteed-every-cycle "priority" set is the
  // most-liquid majors (tighter spreads, more reliable fills, cleaner technicals)
  // rather than whichever symbols happen to sort first alphabetically.
  const rank = await getVolumeRankedSymbols();
  const rankIndex = new Map(rank.map((sym, i) => [sym, i]));
  const sorted = [...universe].sort((a, b) => {
    const ra = rankIndex.has(a.symbol) ? rankIndex.get(a.symbol) : Infinity;
    const rb = rankIndex.has(b.symbol) ? rankIndex.get(b.symbol) : Infinity;
    if (ra !== rb) return ra - rb;
    return a.symbol.localeCompare(b.symbol);
  });
  const priority = sorted.slice(0, PRIORITY_SCAN_COUNT);
  const rotation = sorted.slice(PRIORITY_SCAN_COUNT);
  const cursor = state.scanCursor % Math.max(1, Math.ceil(rotation.length / (ROTATION_SCAN_COUNT - PRIORITY_SCAN_COUNT)));
  const start = cursor * (ROTATION_SCAN_COUNT - PRIORITY_SCAN_COUNT);
  state.scanCursor = cursor + 1;
  return [...priority, ...rotation.slice(start, start + (ROTATION_SCAN_COUNT - PRIORITY_SCAN_COUNT))];
}

async function mapWithConcurrency(items, concurrency, fn) {
  const results = [];
  let idx = 0;
  async function worker() {
    while (idx < items.length) { const i = idx++; results[i] = await fn(items[i]); }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  return results;
}

async function fetchSymbolData(symbol) {
  const [klinesResult, klines4hResult, tickerResult, premiumResult] = await Promise.allSettled([
    fetchJson(`${BINANCE_FAPI}/klines?symbol=${symbol}&interval=${INTERVAL}&limit=200`, "1H klines"),
    fetchJson(`${BINANCE_FAPI}/klines?symbol=${symbol}&interval=4h&limit=100`, "4H klines"),
    fetchJson(`${BINANCE_FAPI}/ticker/24hr?symbol=${symbol}`, "Ticker"),
    fetchJson(`${BINANCE_FAPI}/premiumIndex?symbol=${symbol}`, "Premium"),
  ]);
  if (klinesResult.status !== "fulfilled" || tickerResult.status !== "fulfilled") return null;
  return {
    symbol,
    candles: klinesResult.value.map(mapKlineEntry),
    candles4h: klines4hResult.status === "fulfilled" ? klines4hResult.value.map(mapKlineEntry) : [],
    ticker: tickerResult.value,
    premium: premiumResult.status === "fulfilled" ? premiumResult.value : null,
  };
}

// ─── Signal detection ────────────────────────────────────────────────────────

function detectSignal(data, pricePrecision = 2, context = {}) {
  const { btcTrend } = context;
  const { symbol, candles, ticker, premium } = data;
  if (!candles || candles.length < 60) return null;

  // Volume floor: only signal top-tier liquid perps ($200M+ daily volume)
  const quoteVolume = Number(ticker?.quoteVolume) || 0;
  if (quoteVolume > 0 && quoteVolume < 200_000_000) return null;

  const closes = candles.map(c => c.close);
  const ema20vals = ema(closes, 20);
  const ema50vals = ema(closes, 50);
  const rsi14 = rsi(closes, 14);
  const atr = atrValue(candles, 14);

  const last = candles.length - 1;
  const ema20Last = ema20vals[last];
  const ema50Last = ema50vals[last];
  const rsiLast = rsi14[last];
  if (!ema20Last || !ema50Last) return null;

  // Hard filter: EMAs must be meaningfully separated — near-crossover zones are noisy
  const emaSep = Math.abs(ema20Last - ema50Last) / ema50Last;
  if (emaSep < 0.0015) return null;  // less than 0.15% apart → trend unclear, skip

  const candle = candles[last];
  const currentPrice = Number(ticker?.lastPrice) || candle.close;
  const fundingRate = (Number(premium?.lastFundingRate) || 0) * 100;
  const body = Math.abs(candle.close - candle.open);
  const upperWick = candle.high - Math.max(candle.open, candle.close);
  const lowerWick = Math.min(candle.open, candle.close) - candle.low;

  const levels = findSwingLevels(candles, 100);
  const { s1, s2, r1, r2, s1Tests, r1Tests } = levels;

  // Structural level gap check — S1 and S2 (or R1 and R2) must be meaningfully
  // separated, otherwise the "two targets" are just noise from the same zone.
  // 2× ATR: enough to filter 0.9%-gap noise (like ALLOUSDT) while allowing the
  // typical 3–6% level separation seen on real 1H swing pivots.
  // (3× ATR was too strict — blocked every coin on the scan universe.)
  // Only gates the S/R-based signal types (A–F) below — the EMA-bounce types
  // (G/H) don't use S1/S2/R1/R2 at all, so a tight level gap shouldn't block them.
  const minLevelGap = atr * 2;
  const srLevelsUsable =
    !(s1 != null && s2 != null && Math.abs(s1 - s2) < minLevelGap) &&
    !(r1 != null && r2 != null && Math.abs(r1 - r2) < minLevelGap);

  const emaTol = atr * EMA_TOUCH_ATR;
  const lvlTol = atr * LEVEL_TOUCH_ATR;

  const price = currentPrice;
  const ema20Touch = touches(price, ema20Last, emaTol) || (price >= candle.low - emaTol && price <= candle.high + emaTol && touches(average([candle.open, candle.close]), ema20Last, emaTol));
  const ema50Touch = touches(price, ema50Last, emaTol) || touches(average([candle.open, candle.close]), ema50Last, emaTol);
  const s1Touch = touches(price, s1, lvlTol) || (s1 != null && candle.low <= s1 + lvlTol && candle.close >= s1 - lvlTol);
  const s2Touch = touches(price, s2, lvlTol) || (s2 != null && candle.low <= s2 + lvlTol && candle.close >= s2 - lvlTol);
  const r1Touch = touches(price, r1, lvlTol) || (r1 != null && candle.high >= r1 - lvlTol && candle.close <= r1 + lvlTol);
  const r2Touch = touches(price, r2, lvlTol) || (r2 != null && candle.high >= r2 - lvlTol && candle.close <= r2 + lvlTol);

  const uptrend = ema20Last > ema50Last;
  const downtrend = ema50Last > ema20Last;

  let side = null, baseQuality = 0, signalType = "", signalLabel = "";
  let tp1 = null, tp2 = null, slLevel = null;

  if (uptrend && srLevelsUsable) {
    // Long signal cases
    if (ema20Touch && s2Touch)      { side = "Long"; baseQuality = 80; signalType = "A2"; signalLabel = "EMA20 + Support 2"; tp1 = r1; slLevel = s2; }
    else if (ema20Touch && s1Touch) { side = "Long"; baseQuality = 70; signalType = "A1"; signalLabel = "EMA20 + Support 1"; tp1 = r1; slLevel = s1; }
    else if (ema50Touch && s2Touch) { side = "Long"; baseQuality = 85; signalType = "B2"; signalLabel = "EMA50 + Support 2"; tp1 = r1; slLevel = s2; }
    else if (ema50Touch && s1Touch) { side = "Long"; baseQuality = 75; signalType = "B1"; signalLabel = "EMA50 + Support 1"; tp1 = r1; slLevel = s1; }
    else if (s2Touch)               { side = "Long"; baseQuality = 70; signalType = "C2"; signalLabel = "Support 2 Only";     tp1 = r1; slLevel = s2; }
    else if (s1Touch)               { side = "Long"; baseQuality = 60; signalType = "C1"; signalLabel = "Support 1 Only";     tp1 = r1; slLevel = s1; }
  }

  if (downtrend && side === null && srLevelsUsable) {
    // Short signal cases
    if (ema20Touch && r2Touch)      { side = "Short"; baseQuality = 80; signalType = "D2"; signalLabel = "EMA20 + Resistance 2"; tp1 = s1; slLevel = r2; }
    else if (ema20Touch && r1Touch) { side = "Short"; baseQuality = 70; signalType = "D1"; signalLabel = "EMA20 + Resistance 1"; tp1 = s1; slLevel = r1; }
    else if (ema50Touch && r2Touch) { side = "Short"; baseQuality = 85; signalType = "E2"; signalLabel = "EMA50 + Resistance 2"; tp1 = s1; slLevel = r2; }
    else if (ema50Touch && r1Touch) { side = "Short"; baseQuality = 75; signalType = "E1"; signalLabel = "EMA50 + Resistance 1"; tp1 = s1; slLevel = r1; }
    else if (r2Touch)               { side = "Short"; baseQuality = 70; signalType = "F2"; signalLabel = "Resistance 2 Only";    tp1 = s1; slLevel = r2; }
    else if (r1Touch)               { side = "Short"; baseQuality = 60; signalType = "F1"; signalLabel = "Resistance 1 Only";    tp1 = s1; slLevel = r1; }
  }

  // ─── P/Q EMA-pullback signals (no S/R required) ────────────────────────────
  // Fire when price pulls back to a key EMA in a trending market and the candle
  // shows a structural rejection wick. Unlike A-F signals these don't need a
  // confirmed historical S/R level, so they fire on post-breakout coins where
  // no prior swing data exists — fixing EMA strategy's low trade frequency.
  //
  // SL: structural candle reference (candle.low/high) ± 0.3×ATR buffer.
  // This is far tighter than 1×ATR fallback but respects the candle's own range.
  // TP1: 2.5×ATR (same leverage-adjusted profile as A-F). TP2: 5×ATR.
  // The 1.5×ATR SL floor gate below will skip setups where the candle's wick
  // doesn't provide enough breathing room.
  if (side === null) {
    const hasLowerWick = lowerWick > body * 0.5 && lowerWick > atr * 0.15;
    const hasUpperWick = upperWick > body * 0.5 && upperWick > atr * 0.15;
    if (uptrend && ema50Touch && hasLowerWick) {
      side = "Long"; baseQuality = 82; signalType = "P50"; signalLabel = "EMA50 Pullback Long";
      tp1 = price + atr * 2.5; tp2 = price + atr * 5;
      slLevel = candle.low;
    } else if (uptrend && ema20Touch && hasLowerWick) {
      side = "Long"; baseQuality = 78; signalType = "P20"; signalLabel = "EMA20 Pullback Long";
      tp1 = price + atr * 2.5; tp2 = price + atr * 5;
      slLevel = candle.low;
    } else if (downtrend && ema50Touch && hasUpperWick) {
      side = "Short"; baseQuality = 82; signalType = "Q50"; signalLabel = "EMA50 Retest Short";
      tp1 = price - atr * 2.5; tp2 = price - atr * 5;
      slLevel = candle.high;
    } else if (downtrend && ema20Touch && hasUpperWick) {
      side = "Short"; baseQuality = 78; signalType = "Q20"; signalLabel = "EMA20 Retest Short";
      tp1 = price - atr * 2.5; tp2 = price - atr * 5;
      slLevel = candle.high;
    }
  }

  // ATR-based TP2 for A-F signals (S/R levels cluster too close together, making
  // swing-R2 a poor second target — 5×ATR scales with volatility and provides a
  // meaningful 15–25%+ return at 5× leverage on most liquid alts).
  if (tp2 == null && side !== null) {
    tp2 = side === "Long" ? price + atr * 5 : price - atr * 5;
  }

  if (!side) return null;

  // Validate we have valid TP levels
  if (tp1 == null || tp2 == null) return null;
  // For Long: TP must be above entry. For Short: TP must be below entry.
  if (side === "Long" && (tp1 <= price || tp2 <= price)) return null;
  if (side === "Short" && (tp1 >= price || tp2 >= price)) return null;

  // Minimum target size gate — R2 must be at least 10% from entry.
  // This filters out tight-range signals where there is no structural room
  // to reach a meaningful 15–25% move. (TP1/R1 floor: 5%)
  // Fix TP ordering: findSwingLevels sorts by recency, not price proximity.
  // When the most-recent swing low is lower than the older one (lower-low in a
  // downtrend), tp1=s1 ends up being the *farther* target for a Short. Ensure
  // TP1 is always the closer target (first hit) and TP2 the farther one.
  if (side === "Long"  && tp1 > tp2) [tp1, tp2] = [tp2, tp1];
  if (side === "Short" && tp1 < tp2) [tp1, tp2] = [tp2, tp1];

  const tp2Dist = Math.abs(tp2 - price) / price;
  const tp1Dist = Math.abs(tp1 - price) / price;
  // Lowered from 10%/5% → 5%/2.5%: with 5× leverage a 5% TP2 = +25% return, fully
  // meaningful. The old 10% gate blocked every signal on coins with 1-2% ATR since
  // swing R2 levels are typically 4-8% away on 1H charts — 0 trades in 30d backtest.
  if (tp2Dist < 0.05) return null;  // TP2 too close — less than 5% away, skip
  if (tp1Dist < 0.025) return null; // TP1 too close — less than 2.5% away, skip

  // ─── 4H Trend Confirmation ───────────────────────────────────────────────────
  // 4H trend = hard block if opposite to signal direction.
  // 4H EMA / S&R confluence = quality bonuses (entry must still trigger on 1H).
  let htfTrend = null;
  let htfEmaBonus = false;
  let htfLevelBonus = false;

  const candles4h = data.candles4h;
  if (Array.isArray(candles4h) && candles4h.length >= 55) {
    const closes4h = candles4h.map(c => c.close);
    const ema20_4h = ema(closes4h, 20);
    const ema50_4h = ema(closes4h, 50);
    const last4h = closes4h.length - 1;
    const ema20_4h_last = ema20_4h[last4h];
    const ema50_4h_last = ema50_4h[last4h];

    if (ema20_4h_last != null && ema50_4h_last != null) {
      htfTrend = ema20_4h_last > ema50_4h_last ? "up" : "down";

      // 4H trend opposing signal:
      // — EMA-pullback signals (P/Q): always blocked — pullbacks only work with the trend
      // — S/R bounce signals (A–F): allowed when level is strongly tested (3+ touches) and
      //   RSI shows exhaustion — these are range-trading plays that don't need trend alignment.
      //   Quality is penalised -15 so they only fire if the base setup is genuinely strong.
      const isEMAPullback = signalType.startsWith("P") || signalType.startsWith("Q");
      const anchorTestsCount = side === "Long" ? s1Tests : r1Tests;
      const rsiExhausted = side === "Long" ? (rsiLast != null && rsiLast < 42) : (rsiLast != null && rsiLast > 58);
      const counterTrendSRBounceOk = !isEMAPullback && anchorTestsCount >= 3 && rsiExhausted;

      if ((side === "Long" && htfTrend === "down") || (side === "Short" && htfTrend === "up")) {
        if (!counterTrendSRBounceOk) return null;
        baseQuality -= 15; // counter-trend penalty — must be a strong S/R setup to survive
      }

      const atr4h = atrValue(candles4h, 14);

      // Bonus: 1H entry price is also touching a 4H EMA → +5 quality
      const emaTol4h = atr4h * EMA_TOUCH_ATR;
      if (touches(price, ema20_4h_last, emaTol4h) || touches(price, ema50_4h_last, emaTol4h)) {
        htfEmaBonus = true;
      }

      // Bonus: 1H entry price is also near a 4H swing S/R level → +8 quality
      const levels4h = findSwingLevels(candles4h, 60);
      const lvlTol4h = atr4h * LEVEL_TOUCH_ATR;
      if (side === "Long") {
        htfLevelBonus = (levels4h.s1 != null && touches(price, levels4h.s1, lvlTol4h)) ||
                        (levels4h.s2 != null && touches(price, levels4h.s2, lvlTol4h));
      } else {
        htfLevelBonus = (levels4h.r1 != null && touches(price, levels4h.r1, lvlTol4h)) ||
                        (levels4h.r2 != null && touches(price, levels4h.r2, lvlTol4h));
      }
    }
  }
  // If 4H data wasn't available (API failure), we degrade gracefully — no hard block applied.

  // ─── BTC macro alignment filter ─────────────────────────────────────────────
  // Longs during BTC macro downtrend fail at 28% WR vs 50%+ during uptrend.
  // Block directional mismatches; null btcTrend = API failed → degrade gracefully.
  if (btcTrend !== null) {
    if (side === "Long"  && btcTrend === "down") return null;
    if (side === "Short" && btcTrend === "up")   return null;
  }

  // ─── ADX trend-strength filter ──────────────────────────────────────────────
  // ADX < 18 = ranging market. For EMA-pullback signals (P/Q) this is noise.
  // For S/R bounce signals (A–F) ranging is fine — that IS the regime they're built for.
  // ADX > 25 = strong trend → earn +5 quality bonus in the scoring section below.
  let adx4h = 0;
  const isEMAPullbackSignal = signalType.startsWith("P") || signalType.startsWith("Q");
  if (Array.isArray(candles4h) && candles4h.length >= 30) {
    adx4h = adxValue(candles4h, 14);
    if (adx4h > 0 && adx4h < 18 && isEMAPullbackSignal) return null;
  }

  // Quality bonuses
  let quality = baseQuality;
  // RSI bonus: directionally selective — must be in the "right zone" for the setup.
  //   Long at support: RSI 38–52 (recovering from oversold, hasn't run yet)
  //   Short at resistance: RSI 48–62 (rolling off overbought, hasn't dropped yet)
  // The old range (30–70) fired on ~85% of all candles — it was noise, not signal.
  // RSI gate — widened from (42–50 / 50–58) back to (38–56 / 44–62).
  // The 8-point window was too narrow: combined with S/R + EMA + 4H filters it
  // produced 0 trades in 30d backtests because RSI is almost never in that exact
  // zone at the same time price is touching a structural level. 18-point window
  // is still directionally selective (long must be below mid, short above mid)
  // while actually letting signals fire when confluence is present.
  const rsiOk = side === "Long"
    ? (rsiLast != null && rsiLast >= 38 && rsiLast <= 56)
    : (rsiLast != null && rsiLast >= 44 && rsiLast <= 62);
  const wickBonus = side === "Long"
    ? (lowerWick > body * 0.5 && lowerWick > atr * 0.1)
    : (upperWick > body * 0.5 && upperWick > atr * 0.1);
  // Volume bonus removed: volume spikes at S/R are just as often breakdowns
  // as bounces — they added noise and were strongly correlated with Q90 losses.
  // Multi-tested level bonus: a level hit 3+ times is institutional memory, not noise.
  const anchorTests = side === "Long" ? s1Tests : r1Tests;
  const multiTestedBonus = anchorTests >= 3;
  if (rsiOk)           quality += 5;
  if (wickBonus)       quality += 5;
  if (htfEmaBonus)     quality += 5;
  if (htfLevelBonus)   quality += 8;
  if (multiTestedBonus) quality += 5;
  if (adx4h >= 25)     quality += 5;

  // SL placement — require structural SL distance ≥ 1.5×ATR from entry.
  // A-F signals use slLevel (real S/R), but if the level is too close the
  // formula falls back to price±1×ATR — the same tight stop that destroyed
  // G/H (0% WR). Skip the signal when structural distance is inadequate so
  // we only take setups with genuine breathing room.
  // SL: S/R level with buffer, fallback capped at 0.75×ATR for tighter R:R
  const slBuffer = atr * 0.35;
  const slRaw = side === "Long"
    ? (slLevel != null ? Math.min(slLevel - slBuffer, price - atr * 0.75) : price - atr * 0.75)
    : (slLevel != null ? Math.max(slLevel + slBuffer, price + atr * 0.75) : price + atr * 0.75);
  const slDistance = Math.abs(price - slRaw);
  if (slDistance < atr * 0.5) return null; // SL too tight — skip
  // Ceiling: cap SL distance at 6% of price regardless of source (S/R or ATR
  // fallback) — on hyper-volatile coins even a real structural level can be
  // far enough away to produce outsized losses at 5x leverage (~30% max here).
  if (slDistance > price * 0.060) return null;
  const sl = slRaw;

  const reasonLabels = [signalLabel];
  if (btcTrend === "up" && side === "Long")  reasonLabels.push("BTC macro bullish");
  if (btcTrend === "down" && side === "Short") reasonLabels.push("BTC macro bearish");
  if (uptrend) reasonLabels.push("1H uptrend (EMA20 > EMA50)");
  if (downtrend) reasonLabels.push("1H downtrend (EMA50 > EMA20)");
  if (htfTrend && ((side === "Long" && htfTrend === "up") || (side === "Short" && htfTrend === "down"))) {
    reasonLabels.push(`4H ${htfTrend === "up" ? "uptrend ↑" : "downtrend ↓"} confirmed`);
  } else if (htfTrend) {
    reasonLabels.push(`Counter-trend range fade (4H ${htfTrend})`);
  }
  if (htfLevelBonus) reasonLabels.push("4H S/R confluence");
  if (htfEmaBonus)   reasonLabels.push("4H EMA confluence");
  if (rsiOk) reasonLabels.push(`RSI ${Math.round(rsiLast || 0)} ✓`);
  if (wickBonus) reasonLabels.push(side === "Long" ? "Wick demand" : "Wick supply");
  if (multiTestedBonus) reasonLabels.push(`Level tested ${anchorTests}×`);
  if (adx4h >= 25) reasonLabels.push(`ADX ${Math.round(adx4h)} trending`);
  if (quoteVolume >= 1_000_000_000) reasonLabels.push(`$${(quoteVolume / 1e9).toFixed(1)}B 24H vol`);
  else if (quoteVolume >= 200_000_000) reasonLabels.push(`$${(quoteVolume / 1e6).toFixed(0)}M 24H vol`);

  const id = `${symbol}-${INTERVAL}-${side}-${signalType}-${candle.time}`;

  return {
    id, symbol, side, quality, signalType, signalLabel, interval: INTERVAL,
    detectedAt: Date.now(), alertedAt: 0,
    entryPrice: Number(price.toFixed(pricePrecision)),
    sl: Number(sl.toFixed(pricePrecision)),
    tp1: Number(tp1.toFixed(pricePrecision)),
    tp2: Number(tp2.toFixed(pricePrecision)),
    ema20: Number(ema20Last.toFixed(pricePrecision)),
    ema50: Number(ema50Last.toFixed(pricePrecision)),
    s1: s1 != null ? Number(s1.toFixed(pricePrecision)) : null,
    s2: s2 != null ? Number(s2.toFixed(pricePrecision)) : null,
    r1: r1 != null ? Number(r1.toFixed(pricePrecision)) : null,
    r2: r2 != null ? Number(r2.toFixed(pricePrecision)) : null,
    atr: Number(atr.toFixed(pricePrecision)),
    currentPrice: Number(price.toFixed(pricePrecision)),
    rsi: rsiLast != null ? Number(rsiLast.toFixed(1)) : null,
    fundingRate,
    volume24h: quoteVolume,
    htfTrend,          // "up" | "down" | null
    htfEmaBonus,       // true if 1H entry is also on a 4H EMA
    htfLevelBonus,     // true if 1H entry is also on a 4H S/R level
    status: "active",
    pricePrecision,
    candleTime: candle.time,
    reasonLabels,
  };
}

// ─── Alert formatting ────────────────────────────────────────────────────────

function formatAlertMessage(signal) {
  const dir = signal.side === "Long" ? "🟢 LONG" : "🔴 SHORT";
  const strength = signal.quality >= 93 ? "🔥 Elite Setup" : signal.quality >= 85 ? "⭐ Strong Signal" : "Good Signal";
  const fp = v => v != null ? formatPrice(v, signal.pricePrecision) : "–";

  // 4H confirmation badge
  const htfLine = signal.htfTrend
    ? `4H Trend: ${signal.htfTrend === "up" ? "Bullish ↑" : "Bearish ↓"}` +
      (signal.htfLevelBonus ? "  · S/R confluence" : "") +
      (signal.htfEmaBonus   ? "  · EMA confluence" : "")
    : null;

  return [
    `${dir} ${signal.symbol}  ·  Q${signal.quality}`,
    `${strength} — EMA Perps`,
    `Pattern: ${signal.signalLabel}`,
    htfLine,
    ``,
    `Entry:  ${fp(signal.entryPrice)}`,
    `TP1:    ${fp(signal.tp1)}`,
    `TP2:    ${fp(signal.tp2)}`,
    `SL:     ${fp(signal.sl)}`,
    ``,
    `EMA20: ${fp(signal.ema20)}  EMA50: ${fp(signal.ema50)}`,
    `S1: ${fp(signal.s1)}  S2: ${fp(signal.s2)}  R1: ${fp(signal.r1)}  R2: ${fp(signal.r2)}`,
    `RSI: ${signal.rsi ?? "–"}  Funding: ${formatPercent(signal.fundingRate)}`,
    `Time: ${new Date(signal.detectedAt).toUTCString()}`,
  ].filter(l => l != null).join("\n");
}

async function maybeSendAlert(state, signal, baseUrl) {
  if (!state.alertDelivery?.notifyOnNew) return;
  if (!isDiscordWebhook(state.alertDelivery?.discordWebhook)) return;

  // Quality gate — only send high-conviction signals to Discord
  if (signal.quality < MIN_ALERT_QUALITY) return;

  // Per-symbol+side cooldown — suppress duplicate setups within 4h
  const now = Date.now();
  const recentSameAlert = state.signals.find(s =>
    s.symbol === signal.symbol &&
    s.side === signal.side &&
    s.alertedAt > 0 &&
    now - s.alertedAt < ALERT_COOLDOWN_MS &&
    s.id !== signal.id
  );
  if (recentSameAlert) return;

  const direction = signal.side === "Long" ? "LONG" : "SHORT";
  const emoji = signal.side === "Long" ? "🟢" : "🔴";
  try {
    await sendDiscordNotify(
      baseUrl, state.alertDelivery.discordWebhook,
      `${emoji} ${signal.symbol} Q${signal.quality} — EMA Perps`,
      {
        type: "perps",
        pair: signal.symbol,
        symbol: signal.symbol,
        direction,
        side: signal.side,
        entryPrice: signal.entryPrice,
        stopLoss: signal.sl,
        tp1: signal.tp1,
        tp2: signal.tp2,
        qualityScore: signal.quality,
        qualificationReason: signal.reasonLabels.join(" · ") || signal.signalLabel || "",
        strategy: "EMA PERPS",
        formattedMessage: formatAlertMessage(signal),
      },
      { eventType: "entry_opened" }
    );
    signal.alertedAt = Date.now();
    updateAlertDeliveryResult(state.alertDelivery, "up", `Alert sent for ${signal.symbol} (${signal.signalLabel})`);
    await safeInsertSignalEvent({
      strategy: STRATEGY_ID, symbol: signal.symbol,
      signal_type: signal.side === "Long" ? "long_entry" : "short_entry",
      quality_score: signal.quality,
      details: JSON.stringify({ pattern: signal.signalType, entry: signal.entryPrice, tp1: signal.tp1, tp2: signal.tp2, sl: signal.sl }),
    });
  } catch (err) {
    updateAlertDeliveryResult(state.alertDelivery, "down", `Alert failed: ${err.message}`);
  }
}

async function maybeSendOutcomeAlert(state, signal, closePrice, eventType, pnlPct, baseUrl) {
  if (!isDiscordWebhook(state.alertDelivery?.discordWebhook)) return;
  const emojiMap = { tp1_hit: "✅", tp2_hit: "🏆", sl_hit: "🔴", be_triggered: "🛡️" };
  const labelMap = { tp1_hit: "TP1 Hit", tp2_hit: "TP2 Hit", sl_hit: "SL Hit", be_triggered: "SL → Breakeven" };
  const emoji = emojiMap[eventType] || "📊";
  const label = labelMap[eventType] || eventType;
  try {
    await sendDiscordNotify(
      baseUrl,
      state.alertDelivery.discordWebhook,
      `${emoji} ${signal.symbol} — ${label} — EMA Perps`,
      {
        type: "perps",
        pair: signal.symbol,
        symbol: signal.symbol,
        direction: signal.side === "Long" ? "LONG" : "SHORT",
        side: signal.side,
        entryPrice: signal.entryPrice,
        stopLoss: signal.sl,
        tp1: signal.tp1,
        tp2: signal.tp2,
        closedPrice: closePrice,
        pnlPct: pnlPct ?? null,
        strategy: "EMA PERPS",
      },
      { eventType }
    );
  } catch (err) {
    updateAlertDeliveryResult(state.alertDelivery, "down", `Outcome alert failed for ${signal.symbol}: ${err.message}`);
  }
}

/** Check alerted signals against live prices and fire Discord outcome alerts */
async function checkSignalOutcomes(state, now, baseUrl) {
  const pendingSignals = state.signals.filter(s => s.alertedAt > 0 && !s.outcomeSent && s.entryPrice > 0 && s.tp1 > 0);
  if (!pendingSignals.length) return;

  // Batch-fetch current prices for unique symbols
  const syms = [...new Set(pendingSignals.map(s => s.symbol))];
  const priceMap = {};
  await Promise.allSettled(syms.map(async sym => {
    try {
      const d = await fetchJson(`${BINANCE_FAPI}/ticker/price?symbol=${sym}`, `outcome-price ${sym}`);
      if (d?.price) priceMap[sym] = parseFloat(d.price);
    } catch (_) {}
  }));

  for (const sig of pendingSignals) {
    const price = priceMap[sig.symbol];
    if (!price) continue;
    const isLong = sig.side === "Long";

    // Check TP2 first (full target), then TP1, then SL
    if (isLong ? price >= sig.tp2 : price <= sig.tp2) {
      sig.outcomeSent = true; sig.outcome = "TP2";
      const pct = ((sig.tp2 - sig.entryPrice) / sig.entryPrice) * (isLong ? 100 : -100);
      await maybeSendOutcomeAlert(state, sig, sig.tp2, "tp2_hit", Math.abs(pct), baseUrl);
    } else if (isLong ? price >= sig.tp1 : price <= sig.tp1) {
      sig.outcomeSent = true; sig.outcome = "TP1";
      const pct = ((sig.tp1 - sig.entryPrice) / sig.entryPrice) * (isLong ? 100 : -100);
      await maybeSendOutcomeAlert(state, sig, sig.tp1, "tp1_hit", Math.abs(pct), baseUrl);
    } else if (isLong ? price <= sig.sl : price >= sig.sl) {
      sig.outcomeSent = true; sig.outcome = "SL";
      const pct = ((sig.sl - sig.entryPrice) / sig.entryPrice) * (isLong ? 100 : -100);
      await maybeSendOutcomeAlert(state, sig, sig.sl, "sl_hit", pct, baseUrl);
    }
  }
}

async function maybeSendPaperCloseAlert(state, pos, closePrice, eventType, pnlPct, pnlUsd, baseUrl) {
  if (!state.alertDelivery?.notifyOnNew) return;
  if (!isDiscordWebhook(state.alertDelivery?.discordWebhook)) return;
  const emojiMap = { tp1_hit: "✅", tp2_hit: "🏆", sl_hit: "🔴", be_triggered: "🛡️" };
  const labelMap = { tp1_hit: "TP1 Hit", tp2_hit: "TP2 Hit", sl_hit: "SL Hit", be_triggered: "SL → Breakeven" };
  const emoji = emojiMap[eventType] || "📊";
  const label = labelMap[eventType] || eventType;
  const direction = pos.side === "Long" ? "LONG" : "SHORT";
  try {
    await sendDiscordNotify(
      baseUrl,
      state.alertDelivery.discordWebhook,
      `${emoji} ${pos.symbol} — ${label} — EMA Perps`,
      {
        type: "perps",
        pair: pos.symbol,
        symbol: pos.symbol,
        direction,
        side: pos.side,
        entryPrice: pos.entryPrice,
        stopLoss: pos.sl,
        tp1: pos.tp1,
        tp2: pos.tp2,
        closedPrice: closePrice,
        pnlPct: pnlPct ?? null,
        pnl: pnlUsd ?? null,
        strategy: "EMA PERPS",
      },
      { eventType }
    );
  } catch (err) {
    updateAlertDeliveryResult(state.alertDelivery, "down", `${label} alert failed for ${pos.symbol}: ${err.message}`);
  }
}

// ─── Token analysis (for search) ────────────────────────────────────────────

async function analyzeToken(rawToken) {
  const cleaned = String(rawToken || "").toUpperCase().trim().replace(/[^A-Z0-9]/g, "");
  const universe = await getPerpUniverse();
  let symbolInfo = universe.find(s => s.symbol === cleaned || s.symbol === `${cleaned}USDT`);
  if (!symbolInfo) {
    const scored = universe.map(s => ({ ...s, score: scoreSymbolCandidate(s, cleaned) }))
      .filter(s => s.score > 0).sort((a, b) => b.score - a.score);
    symbolInfo = scored[0];
  }
  if (!symbolInfo) return { ok: false, error: `No USDT perp found for "${rawToken}"` };

  const data = await fetchSymbolData(symbolInfo.symbol);
  if (!data) return { ok: false, error: `Failed to fetch data for ${symbolInfo.symbol}` };

  const { candles, ticker, premium } = data;
  if (!candles || candles.length < 60) return { ok: false, error: "Not enough candle data" };

  const closes = candles.map(c => c.close);
  const ema20vals = ema(closes, 20);
  const ema50vals = ema(closes, 50);
  const rsi14 = rsi(closes, 14);
  const atr = atrValue(candles, 14);
  const levels = findSwingLevels(candles, 100);
  const last = candles.length - 1;
  const currentPrice = Number(ticker?.lastPrice) || candles[last].close;
  const fundingRate = (Number(premium?.lastFundingRate) || 0) * 100;
  const change24h = Number(ticker?.priceChangePercent) || 0;
  const volume24h = Number(ticker?.quoteVolume) || 0;
  const pricePrecision = symbolInfo.pricePrecision || 2;

  const btcTrend = await getBtcTrendEma();
  const signal = detectSignal(data, pricePrecision, { btcTrend });
  const uptrend = ema20vals[last] > ema50vals[last];

  return {
    ok: true,
    symbol: symbolInfo.symbol,
    currentPrice,
    pricePrecision,
    change24h,
    volume24h,
    fundingRate,
    atr,
    ema20: ema20vals[last],
    ema50: ema50vals[last],
    rsi: rsi14[last],
    trend: uptrend ? "up" : "down",
    levels,
    signal,
    candles: candles.slice(-100).map(c => ({
      time: Math.floor(c.time), open: c.open, high: c.high, low: c.low, close: c.close, volume: c.volume,
    })),
    ema20Series: ema20vals.slice(-100).map((v, i) => ({
      time: Math.floor(candles[candles.length - 100 + i]?.time || 0), value: v,
    })).filter(p => p.value != null && p.time > 0),
    ema50Series: ema50vals.slice(-100).map((v, i) => ({
      time: Math.floor(candles[candles.length - 100 + i]?.time || 0), value: v,
    })).filter(p => p.value != null && p.time > 0),
  };
}

// ─── Main scan ───────────────────────────────────────────────────────────────

async function runEmaPerps_Scan(stateInput = {}, options = {}) {
  const state = sanitizeRuntimeState(stateInput);
  const baseUrl = resolveBaseUrl(options.baseUrl);
  const now = Date.now();

  // Mark open paper positions against live prices first
  await markPaperPositions(state, now, baseUrl);

  // Expire old and sub-threshold signals — run before any detection so the state
  // stays lean. Two passes:
  //  1. Hard-expire any signal older than SIGNAL_EXPIRE_MS (catches signals that
  //     accrued while the cron was paused/delayed — they should never be "active").
  //  2. Purge sub-threshold signals (quality < MIN_ALERT_QUALITY) — these can
  //     never trigger an alert or open a paper trade, so storing them just bloats
  //     state, inflates the "active" count on the dashboard, and wastes evaluation
  //     cycles on subsequent scans. (They're still surfaced in lastScanResults for
  //     the scanner tab — they just don't persist in the live signal list.)
  state.signals = state.signals.filter(s =>
    s.status === "active" &&
    (now - s.detectedAt) < SIGNAL_EXPIRE_MS &&
    s.quality >= MIN_ALERT_QUALITY
  );

  // Deduplicate: keep only the freshest signal per symbol+side
  {
    const seen = new Map();
    for (const s of state.signals) {
      const key = `${s.symbol}|${s.side}`;
      if (!seen.has(key) || s.detectedAt > seen.get(key).detectedAt) seen.set(key, s);
    }
    state.signals = Array.from(seen.values());
  }

  // Stamp scan time immediately so it's always persisted regardless of scan outcome
  state.lastScanAt = now;

  try {
    const universe = await getPerpUniverse();
    const batch = await selectBatch(universe, state);
    let newSignals = 0;
    const existingIds = new Set(state.signals.map(s => s.id));

    // scanResults holds ALL detected signals for the Scanner tab
    const scanResults = [];

    const btcTrend = await getBtcTrendEma();

    const results = await mapWithConcurrency(batch, ANALYSIS_CONCURRENCY, async (symbolInfo) => {
      try {
        const data = await fetchSymbolData(symbolInfo.symbol);
        if (!data) return null;
        return detectSignal(data, symbolInfo.pricePrecision, { btcTrend });
      } catch (_) { return null; }
    });

    for (const signal of results.filter(Boolean)) {
      scanResults.push(signal);
      if (existingIds.has(signal.id)) continue;
      // Evict any stale signal for the same symbol+side before inserting the fresh one
      state.signals = state.signals.filter(s => !(s.symbol === signal.symbol && s.side === signal.side));
      state.signals.unshift(signal);
      newSignals++;
      openPaperTrade(state, signal, now);
      await maybeSendAlert(state, signal, baseUrl);
    }

    // Check outcomes for previously alerted signals (fires TP1/TP2/SL Discord follow-ups)
    await checkSignalOutcomes(state, now, baseUrl);

    // Store scanner results and update last scan time
    state.lastScanResults = scanResults.slice(0, 200);

    state.signals = state.signals.slice(0, 200);

    const activeCount = state.signals.filter(s => s.status === "active").length;
    const paused = now < (state.paper.pausedUntil || 0);
    const baseMsg = newSignals > 0
      ? `Found ${newSignals} new EMA signal${newSignals > 1 ? "s" : ""}. ${activeCount} active.`
      : `Scan complete. ${activeCount} active EMA signals.`;
    const msg = paused
      ? `${baseMsg} ⏸ Circuit breaker active — ${state.paper.pauseReason || "new entries paused"} (resumes ${new Date(state.paper.pausedUntil).toUTCString()}).`
      : baseMsg;
    setRuntimeStatus(state, msg, paused ? "down" : (newSignals > 0 ? "up" : "neutral"));

    return { state: sanitizeRuntimeState(state), summary: { ok: true, scanned: batch.length, newSignals, activeCount, lastScanAt: now } };
  } catch (err) {
    setRuntimeStatus(state, `Scan failed: ${err.message}`, "down");
    return { state: sanitizeRuntimeState(state), summary: { ok: false, error: err.message } };
  }
}

module.exports = {
  defaultRuntimeState,
  sanitizeRuntimeState,
  runEmaPerps_Scan,
  markPaperPositions,
  analyzeToken,
  // Exposed for the backtesting framework (lib/backtest-runtime.js) — lets the
  // harness replay the exact same detection/sizing/exit logic used live,
  // instead of drifting out of sync with a duplicated re-implementation.
  detectSignal,
  STRATEGY_ID,
  INTERVAL,
  MIN_ALERT_QUALITY,
  PAPER_LEVERAGE,
  PAPER_BE_TRIGGER_PCT,
  PAPER_EXPIRY,
  TP1_PARTIAL_CLOSE_PCT,
  qualityWeightedSizePct,
  applyEntrySlippage,
  applyExitSlippage,
  BINANCE_FAPI,
};
