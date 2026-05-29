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
 */

"use strict";

const {
  sanitizeNumber, average, formatPrice, formatPercent,
  fetchJson, setRuntimeStatus, updateAlertDeliveryResult, safeInsertSignalEvent,
  perpUniverseSymbols, scoreSymbolCandidate, mapKlineEntry,
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

// Paper trading constants
const PAPER_START    = 100;
const PAPER_MAX_POS  = 5;
const PAPER_SIZE_PCT = 0.20;   // 20% of balance per trade
const PAPER_EXPIRY   = 24 * 60 * 60 * 1000;

// Touch tolerance: how close price must be to a level (as ATR multiple)
const EMA_TOUCH_ATR = 0.5;
const LEVEL_TOUCH_ATR = 0.6;

let exchangeInfoCache = null;

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

// ─── Support / Resistance levels via swing pivots ───────────────────────────

function findSwingLevels(candles, lookback = 60) {
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

  // Sort most-recent first, deduplicate levels within 0.5%
  const dedup = (arr, key) => {
    const sorted = arr.sort((a, b) => b.index - a.index);
    const out = [];
    for (const p of sorted) {
      const isDup = out.some(x => Math.abs(x[key] - p[key]) / x[key] < 0.005);
      if (!isDup) out.push(p);
      if (out.length >= 2) break;
    }
    return out;
  };

  const topHighs = dedup(highs, "price");
  const topLows  = dedup(lows,  "price");

  return {
    r1: topHighs[0]?.price ?? null,
    r2: topHighs[1]?.price ?? null,
    s1: topLows[0]?.price  ?? null,
    s2: topLows[1]?.price  ?? null,
  };
}

// Check if price "touches" a level (within tolerance)
function touches(price, level, tolerance) {
  if (level == null) return false;
  return Math.abs(price - level) <= tolerance;
}

// ─── State management ────────────────────────────────────────────────────────

function defaultPaper() {
  return { balance: PAPER_START, startingBalance: PAPER_START, openPositions: [], closedTrades: [], lastMarkAt: 0 };
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
    signalId:       String(t.signalId || ""),
    pricePrecision: sanitizeNumber(t.pricePrecision, 2),
    tp1Reached:     Boolean(t.tp1Reached),
  };
}

function sanitizePaper(raw = {}) {
  return {
    balance:       sanitizeNumber(raw.balance, PAPER_START),
    startingBalance: sanitizeNumber(raw.startingBalance, PAPER_START),
    openPositions: Array.isArray(raw.openPositions) ? raw.openPositions.map(sanitizePaperTrade).slice(0, 10) : [],
    closedTrades:  Array.isArray(raw.closedTrades)  ? raw.closedTrades.map(sanitizePaperTrade).slice(0, 300) : [],
    lastMarkAt:    sanitizeNumber(raw.lastMarkAt, 0),
  };
}

function defaultRuntimeState() {
  return {
    signals: [],
    lastScanAt: 0,
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
    reasonLabels: Array.isArray(s.reasonLabels) ? s.reasonLabels.slice(0, 10) : [],
  };
}

function sanitizeRuntimeState(raw = {}) {
  const base = defaultRuntimeState();
  return {
    signals: Array.isArray(raw.signals) ? raw.signals.map(sanitizeSignal).slice(0, 200) : [],
    lastScanAt: sanitizeNumber(raw.lastScanAt, 0),
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
  const diff = pos.side === "Long" ? closePrice - pos.entryPrice : pos.entryPrice - closePrice;
  const pnl  = Math.round((diff / pos.entryPrice) * pos.size * 100) / 100;
  state.paper.balance = Math.max(0, Math.round((state.paper.balance + pnl) * 100) / 100);
  state.paper.closedTrades.unshift({
    ...pos, closedAt: now, closedPrice: closePrice, closeReason: reason,
    pnl, pnlPct: Math.round((diff / pos.entryPrice) * 10000) / 100,
  });
  state.paper.closedTrades = state.paper.closedTrades.slice(0, 300);
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
    if (!price) { stillOpen.push(pos); continue; }
    const isLong = pos.side === "Long";
    if (now - pos.openedAt > PAPER_EXPIRY) {
      closePaperPos(state, pos, price, "EXPIRED", now);
      // No banner for expired trades
      continue;
    }
    if (isLong ? price <= pos.sl : price >= pos.sl) {
      const slPrice = pos.sl;
      closePaperPos(state, pos, slPrice, "SL", now);
      const closed = state.paper.closedTrades[0];
      await maybeSendPaperCloseAlert(state, pos, slPrice, "sl_hit", closed?.pnlPct, closed?.pnl, baseUrl);
    } else if (isLong ? price >= pos.tp2 : price <= pos.tp2) {
      closePaperPos(state, pos, pos.tp2, "TP2", now);
      const closed = state.paper.closedTrades[0];
      await maybeSendPaperCloseAlert(state, pos, pos.tp2, "tp2_hit", closed?.pnlPct, closed?.pnl, baseUrl);
    } else if ((isLong ? price >= pos.tp1 : price <= pos.tp1) && !pos.tp1Reached) {
      pos.tp1Reached = true; pos.sl = pos.entryPrice;
      pos.lastMarkPrice = price; pos.lastMarkAt = now;
      stillOpen.push(pos); // move SL to breakeven
      // Compute TP1 pnlPct for display (position stays open)
      const diff = isLong ? pos.tp1 - pos.entryPrice : pos.entryPrice - pos.tp1;
      const tp1PnlPct = Math.round((diff / pos.entryPrice) * 10000) / 100;
      await maybeSendPaperCloseAlert(state, pos, pos.tp1, "tp1_hit", tp1PnlPct, null, baseUrl);
    } else {
      pos.lastMarkPrice = price; pos.lastMarkAt = now;
      stillOpen.push(pos);
    }
  }
  state.paper.openPositions = stillOpen;
}

function openPaperTrade(state, signal, now) {
  if (state.paper.openPositions.length >= PAPER_MAX_POS) return;
  if (state.paper.openPositions.some(p => p.symbol === signal.symbol)) return;
  if (state.paper.balance < 1) return;
  const size = Math.max(0.50, Math.round(state.paper.balance * PAPER_SIZE_PCT * 100) / 100);
  state.paper.openPositions.push(sanitizePaperTrade({
    id: `pt-${signal.id}`, symbol: signal.symbol, side: signal.side,
    entryPrice: signal.entryPrice, tp1: signal.tp1, tp2: signal.tp2, sl: signal.sl,
    size, openedAt: now, quality: signal.quality, signalId: signal.id,
    pricePrecision: signal.pricePrecision || 2,
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

function selectBatch(universe, state) {
  const sorted = [...universe].sort((a, b) => a.symbol.localeCompare(b.symbol));
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
  const [klinesResult, tickerResult, premiumResult] = await Promise.allSettled([
    fetchJson(`${BINANCE_FAPI}/klines?symbol=${symbol}&interval=${INTERVAL}&limit=200`, "1H klines"),
    fetchJson(`${BINANCE_FAPI}/ticker/24hr?symbol=${symbol}`, "Ticker"),
    fetchJson(`${BINANCE_FAPI}/premiumIndex?symbol=${symbol}`, "Premium"),
  ]);
  if (klinesResult.status !== "fulfilled" || tickerResult.status !== "fulfilled") return null;
  return {
    symbol,
    candles: klinesResult.value.map(mapKlineEntry),
    ticker: tickerResult.value,
    premium: premiumResult.status === "fulfilled" ? premiumResult.value : null,
  };
}

// ─── Signal detection ────────────────────────────────────────────────────────

function detectSignal(data, pricePrecision = 2) {
  const { symbol, candles, ticker, premium } = data;
  if (!candles || candles.length < 60) return null;

  const closes = candles.map(c => c.close);
  const ema20vals = ema(closes, 20);
  const ema50vals = ema(closes, 50);
  const rsi14 = rsi(closes, 14);
  const atr = atrValue(candles, 14);
  const vol20avg = average(candles.slice(-22, -2).map(c => c.volume));

  const last = candles.length - 1;
  const ema20Last = ema20vals[last];
  const ema50Last = ema50vals[last];
  const rsiLast = rsi14[last];
  if (!ema20Last || !ema50Last) return null;

  const candle = candles[last];
  const currentPrice = Number(ticker?.lastPrice) || candle.close;
  const fundingRate = (Number(premium?.lastFundingRate) || 0) * 100;
  const volume = candle.volume;
  const body = Math.abs(candle.close - candle.open);
  const upperWick = candle.high - Math.max(candle.open, candle.close);
  const lowerWick = Math.min(candle.open, candle.close) - candle.low;

  const levels = findSwingLevels(candles, 60);
  const { s1, s2, r1, r2 } = levels;

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

  if (uptrend) {
    // Long signal cases
    if (ema20Touch && s2Touch)      { side = "Long"; baseQuality = 80; signalType = "A2"; signalLabel = "EMA20 + Support 2"; tp1 = r1; tp2 = r2; slLevel = s2; }
    else if (ema20Touch && s1Touch) { side = "Long"; baseQuality = 70; signalType = "A1"; signalLabel = "EMA20 + Support 1"; tp1 = r1; tp2 = r2; slLevel = s1; }
    else if (ema50Touch && s2Touch) { side = "Long"; baseQuality = 85; signalType = "B2"; signalLabel = "EMA50 + Support 2"; tp1 = r1; tp2 = r2; slLevel = s2; }
    else if (ema50Touch && s1Touch) { side = "Long"; baseQuality = 75; signalType = "B1"; signalLabel = "EMA50 + Support 1"; tp1 = r1; tp2 = r2; slLevel = s1; }
    else if (s2Touch)               { side = "Long"; baseQuality = 70; signalType = "C2"; signalLabel = "Support 2 Only";     tp1 = r1; tp2 = r2; slLevel = s2; }
    else if (s1Touch)               { side = "Long"; baseQuality = 60; signalType = "C1"; signalLabel = "Support 1 Only";     tp1 = r1; tp2 = r2; slLevel = s1; }
  }

  if (downtrend && side === null) {
    // Short signal cases
    if (ema20Touch && r2Touch)      { side = "Short"; baseQuality = 80; signalType = "D2"; signalLabel = "EMA20 + Resistance 2"; tp1 = s1; tp2 = s2; slLevel = r2; }
    else if (ema20Touch && r1Touch) { side = "Short"; baseQuality = 70; signalType = "D1"; signalLabel = "EMA20 + Resistance 1"; tp1 = s1; tp2 = s2; slLevel = r1; }
    else if (ema50Touch && r2Touch) { side = "Short"; baseQuality = 85; signalType = "E2"; signalLabel = "EMA50 + Resistance 2"; tp1 = s1; tp2 = s2; slLevel = r2; }
    else if (ema50Touch && r1Touch) { side = "Short"; baseQuality = 75; signalType = "E1"; signalLabel = "EMA50 + Resistance 1"; tp1 = s1; tp2 = s2; slLevel = r1; }
    else if (r2Touch)               { side = "Short"; baseQuality = 70; signalType = "F2"; signalLabel = "Resistance 2 Only";    tp1 = s1; tp2 = s2; slLevel = r2; }
    else if (r1Touch)               { side = "Short"; baseQuality = 60; signalType = "F1"; signalLabel = "Resistance 1 Only";    tp1 = s1; tp2 = s2; slLevel = r1; }
  }

  if (!side) return null;

  // Validate we have valid TP levels
  if (tp1 == null || tp2 == null) return null;
  // For Long: TP must be above entry. For Short: TP must be below entry.
  if (side === "Long" && (tp1 <= price || tp2 <= price)) return null;
  if (side === "Short" && (tp1 >= price || tp2 >= price)) return null;

  // Quality bonuses
  let quality = baseQuality;
  const volumeBonus = vol20avg > 0 && volume > vol20avg * 1.3;
  const rsiOk = rsiLast != null && rsiLast > 30 && rsiLast < 70;
  const wickBonus = side === "Long"
    ? (lowerWick > body * 0.5 && lowerWick > atr * 0.1)
    : (upperWick > body * 0.5 && upperWick > atr * 0.1);
  if (volumeBonus) quality += 5;
  if (rsiOk) quality += 5;
  if (wickBonus) quality += 5;

  // SL placement
  const slBuffer = atr * 0.5;
  const sl = side === "Long"
    ? (slLevel != null ? Math.min(slLevel - slBuffer, price - atr) : price - atr)
    : (slLevel != null ? Math.max(slLevel + slBuffer, price + atr) : price + atr);

  const reasonLabels = [signalLabel];
  if (uptrend) reasonLabels.push("Uptrend (EMA20 > EMA50)");
  if (downtrend) reasonLabels.push("Downtrend (EMA50 > EMA20)");
  if (volumeBonus) reasonLabels.push("Volume confirmed");
  if (rsiOk) reasonLabels.push(`RSI ${Math.round(rsiLast || 0)}`);
  if (wickBonus) reasonLabels.push(side === "Long" ? "Wick demand" : "Wick supply");

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
    status: "active",
    pricePrecision,
    candleTime: candle.time,
    reasonLabels,
  };
}

// ─── Alert formatting ────────────────────────────────────────────────────────

function formatAlertMessage(signal) {
  const dir = signal.side === "Long" ? "🟢 LONG" : "🔴 SHORT";
  const strength = signal.quality >= 80 ? "⭐ Strong Signal" : signal.quality >= 70 ? "Good Signal" : "Signal";
  const fp = v => v != null ? formatPrice(v, signal.pricePrecision) : "–";
  return [
    `${dir} ${signal.symbol}  ·  Q${signal.quality}`,
    `${strength} — EMA Perps`,
    `Pattern: ${signal.signalLabel}`,
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
  ].join("\n");
}

async function maybeSendAlert(state, signal, baseUrl) {
  if (!state.alertDelivery?.notifyOnNew) return;
  if (!isDiscordWebhook(state.alertDelivery?.discordWebhook)) return;
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
        qualificationReason: signal.signalLabel || "",
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

async function maybeSendPaperCloseAlert(state, pos, closePrice, eventType, pnlPct, pnlUsd, baseUrl) {
  if (!state.alertDelivery?.notifyOnNew) return;
  if (!isDiscordWebhook(state.alertDelivery?.discordWebhook)) return;
  const emojiMap = { tp1_hit: "✅", tp2_hit: "🏆", sl_hit: "🔴" };
  const labelMap = { tp1_hit: "TP1 Hit", tp2_hit: "TP2 Hit", sl_hit: "SL Hit" };
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
  const levels = findSwingLevels(candles, 60);
  const last = candles.length - 1;
  const currentPrice = Number(ticker?.lastPrice) || candles[last].close;
  const fundingRate = (Number(premium?.lastFundingRate) || 0) * 100;
  const change24h = Number(ticker?.priceChangePercent) || 0;
  const volume24h = Number(ticker?.quoteVolume) || 0;
  const pricePrecision = symbolInfo.pricePrecision || 2;

  const signal = detectSignal(data, pricePrecision);
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

  // Expire old signals
  state.signals = state.signals.filter(s => s.status === "active" && (now - s.detectedAt) < SIGNAL_EXPIRE_MS);

  try {
    const universe = await getPerpUniverse();
    const batch = selectBatch(universe, state);
    let newSignals = 0;
    const existingIds = new Set(state.signals.map(s => s.id));

    // scanResults holds ALL detected signals for the Scanner tab
    const scanResults = [];

    const results = await mapWithConcurrency(batch, ANALYSIS_CONCURRENCY, async (symbolInfo) => {
      try {
        const data = await fetchSymbolData(symbolInfo.symbol);
        if (!data) return null;
        return detectSignal(data, symbolInfo.pricePrecision);
      } catch (_) { return null; }
    });

    for (const signal of results.filter(Boolean)) {
      scanResults.push(signal);
      if (existingIds.has(signal.id)) continue;
      state.signals.unshift(signal);
      newSignals++;
      openPaperTrade(state, signal, now);
      await maybeSendAlert(state, signal, baseUrl);
    }

    // Store scanner results and update last scan time
    state.lastScanResults = scanResults.slice(0, 200);

    state.signals = state.signals.slice(0, 200);
    state.lastScanAt = now;

    const activeCount = state.signals.filter(s => s.status === "active").length;
    const msg = newSignals > 0
      ? `Found ${newSignals} new EMA signal${newSignals > 1 ? "s" : ""}. ${activeCount} active.`
      : `Scan complete. ${activeCount} active EMA signals.`;
    setRuntimeStatus(state, msg, newSignals > 0 ? "up" : "neutral");

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
  analyzeToken,
};
