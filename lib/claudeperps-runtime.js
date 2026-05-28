/**
 * claudeperps-runtime.js — "Multi-Timeframe Momentum Confluence" strategy
 *
 * Strategy design: Only fire when 4 independent signals align simultaneously:
 *  1. 4H structural trend (EMA20 vs EMA50 direction)
 *  2. 1H momentum (RSI in mid-zone, room to run)
 *  3. 1H MACD catalyst (fresh crossover or confirmed histogram flip)
 *  4. Price structure (pullback to dynamic EMA level with wick rejection)
 *
 * Plus volume and funding filters to eliminate crowded/low-conviction entries.
 * Minimum quality 65/100 to generate any alert. 80+ = high conviction.
 *
 * TPs: 1.5× and 2.5× risk from entry. SL: 1× ATR below/above entry.
 */

"use strict";

const {
  sanitizeNumber, nullableTimestamp, average, pctChange,
  priceDigits, formatPrice, formatPercent,
  fetchJson, setRuntimeStatus, updateAlertDeliveryResult, safeInsertSignalEvent,
  perpUniverseSymbols, scoreSymbolCandidate, mapKlineEntry,
} = require("./engine-core");
const { hasDatabase, getRuntimeState, upsertRuntimeState } = require("./neon-db");
const { isDiscordWebhook, resolveBaseUrl, sendDiscordNotify } = require("./notify-client");

// ─── Constants ──────────────────────────────────────────────────────────────

const STRATEGY_ID = "claudeperps";
const INTERVAL = "1h";
const HTF_INTERVAL = "4h";
const MIN_QUALITY = 65;
const SIGNAL_EXPIRE_MS = 6 * 60 * 60 * 1000;       // expire signals after 6h
const SCAN_COOLDOWN_MS = 4 * 60 * 1000;             // 4-min between background scans
const ANALYSIS_CONCURRENCY = 5;

// Paper trading constants
const PAPER_START    = 100;
const PAPER_MAX_POS  = 5;
const PAPER_SIZE_PCT = 0.20;   // 20% of balance per trade
const PAPER_EXPIRY   = 24 * 60 * 60 * 1000;
const PRIORITY_SCAN_COUNT = 24;
const ROTATION_SCAN_COUNT = 48;
const QUOTE_ASSET = "USDT";
const BINANCE_FAPI = "https://fapi.binance.com/fapi/v1";
const DEFAULT_START_VERSION = 1;

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

function macdFull(values, fast = 12, slow = 26, signal = 9) {
  const emaFast = ema(values, fast);
  const emaSlow = ema(values, slow);
  const macdLine = values.map((_, i) =>
    emaFast[i] != null && emaSlow[i] != null ? emaFast[i] - emaSlow[i] : null
  );
  const macdValues = macdLine.filter(v => v != null);
  const signalLine = ema(macdValues, signal);
  let sigIdx = 0;
  return macdLine.map(v => {
    if (v == null) return { macd: null, signal: null, hist: null };
    const s = signalLine[sigIdx++] ?? null;
    return { macd: v, signal: s, hist: s != null ? v - s : null };
  });
}

function atrValue(candles, period = 14) {
  if (candles.length < 2) return 0;
  const trs = candles.slice(1).map((c, i) => {
    const prev = candles[i];
    return Math.max(c.high - c.low, Math.abs(c.high - prev.close), Math.abs(c.low - prev.close));
  });
  if (trs.length < period) return average(trs);
  let val = average(trs.slice(0, period));
  for (let i = period; i < trs.length; i++) val = (val * (period - 1) + trs[i]) / period;
  return val;
}

// ─── State management ────────────────────────────────────────────────────────

function defaultPaper() {
  return {
    balance: PAPER_START,
    startingBalance: PAPER_START,
    openPositions: [],
    closedTrades: [],
    lastMarkAt: 0,
  };
}

function sanitizePaperTrade(t = {}) {
  return {
    id:            String(t.id || ""),
    symbol:        String(t.symbol || ""),
    side:          t.side === "Short" ? "Short" : "Long",
    entryPrice:    sanitizeNumber(t.entryPrice, 0),
    tp1:           sanitizeNumber(t.tp1, 0),
    tp2:           sanitizeNumber(t.tp2, 0),
    sl:            sanitizeNumber(t.sl, 0),
    size:          sanitizeNumber(t.size, 0),
    openedAt:      sanitizeNumber(t.openedAt, 0),
    closedAt:      sanitizeNumber(t.closedAt, 0),
    closedPrice:   t.closedPrice != null ? sanitizeNumber(t.closedPrice, 0) : null,
    closeReason:   t.closeReason || null,
    pnl:           t.pnl != null ? sanitizeNumber(t.pnl, 0) : null,
    pnlPct:        t.pnlPct != null ? sanitizeNumber(t.pnlPct, 0) : null,
    quality:       sanitizeNumber(t.quality, 0),
    signalId:      String(t.signalId || ""),
    pricePrecision: sanitizeNumber(t.pricePrecision, 2),
    tp1Reached:    Boolean(t.tp1Reached),
  };
}

function sanitizePaper(raw = {}) {
  return {
    balance:        sanitizeNumber(raw.balance, PAPER_START),
    startingBalance: sanitizeNumber(raw.startingBalance, PAPER_START),
    openPositions:  Array.isArray(raw.openPositions) ? raw.openPositions.map(sanitizePaperTrade) : [],
    closedTrades:   Array.isArray(raw.closedTrades)  ? raw.closedTrades.map(sanitizePaperTrade).slice(0, 300) : [],
    lastMarkAt:     sanitizeNumber(raw.lastMarkAt, 0),
  };
}

function defaultRuntimeState() {
  return {
    signals: [],
    lastScanAt: 0,
    scanCursor: 0,
    version: DEFAULT_START_VERSION,
    alertDelivery: {
      discordWebhook: "",
      notifyOnNew: true,
      lastResultAt: 0,
      lastResultMessage: "Discord delivery not configured.",
      lastResultTone: "neutral",
    },
    lastStatusMessage: "Claudeperps is standing by.",
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
    interval: String(s.interval || INTERVAL),
    detectedAt: sanitizeNumber(s.detectedAt, 0),
    alertedAt: sanitizeNumber(s.alertedAt, 0),
    entryPrice: sanitizeNumber(s.entryPrice, 0),
    sl: sanitizeNumber(s.sl, 0),
    tp1: sanitizeNumber(s.tp1, 0),
    tp2: sanitizeNumber(s.tp2, 0),
    rr1: sanitizeNumber(s.rr1, 0),
    rr2: sanitizeNumber(s.rr2, 0),
    atr: sanitizeNumber(s.atr, 0),
    currentPrice: sanitizeNumber(s.currentPrice, 0),
    fundingRate: sanitizeNumber(s.fundingRate, 0),
    status: ["active","tp1_hit","tp2_hit","sl_hit","expired"].includes(s.status) ? s.status : "active",
    factors: s.factors && typeof s.factors === "object" ? s.factors : {},
    reasonLabels: Array.isArray(s.reasonLabels) ? s.reasonLabels.slice(0, 10) : [],
    pricePrecision: sanitizeNumber(s.pricePrecision, 2),
    candleTime: sanitizeNumber(s.candleTime, 0),
  };
}

function sanitizeRuntimeState(raw = {}) {
  const base = defaultRuntimeState();
  return {
    signals: Array.isArray(raw.signals) ? raw.signals.map(sanitizeSignal).slice(0, 200) : [],
    lastScanAt: sanitizeNumber(raw.lastScanAt, 0),
    scanCursor: Math.max(0, sanitizeNumber(raw.scanCursor, 0)),
    version: sanitizeNumber(raw.version, DEFAULT_START_VERSION),
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

async function markPaperPositions(state, now) {
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
    if (now - pos.openedAt > PAPER_EXPIRY) { closePaperPos(state, pos, price, "EXPIRED", now); continue; }
    const isLong = pos.side === "Long";
    if (isLong  ? price <= pos.sl : price >= pos.sl) { closePaperPos(state, pos, pos.sl, "SL", now); }
    else if (isLong ? price >= pos.tp2 : price <= pos.tp2) { closePaperPos(state, pos, pos.tp2, "TP2", now); }
    else if ((isLong ? price >= pos.tp1 : price <= pos.tp1) && !pos.tp1Reached) {
      pos.tp1Reached = true; pos.sl = pos.entryPrice; stillOpen.push(pos); // move SL to breakeven
    } else { stillOpen.push(pos); }
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
    symbol: s.symbol,
    baseAsset: s.baseAsset,
    pricePrecision: s.pricePrecision ?? 2,
  }));
}

function selectBatch(universe, state) {
  const sorted = [...universe].sort((a, b) => a.symbol.localeCompare(b.symbol));
  const priority = sorted.slice(0, PRIORITY_SCAN_COUNT);
  const rotation = sorted.slice(PRIORITY_SCAN_COUNT);
  const cursor = state.scanCursor % Math.max(1, Math.ceil(rotation.length / (ROTATION_SCAN_COUNT - PRIORITY_SCAN_COUNT)));
  const start = cursor * (ROTATION_SCAN_COUNT - PRIORITY_SCAN_COUNT);
  const rotationBatch = rotation.slice(start, start + (ROTATION_SCAN_COUNT - PRIORITY_SCAN_COUNT));
  state.scanCursor = cursor + 1;
  return [...priority, ...rotationBatch];
}

async function mapWithConcurrency(items, concurrency, fn) {
  const results = [];
  let idx = 0;
  async function worker() {
    while (idx < items.length) {
      const i = idx++;
      results[i] = await fn(items[i]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  return results;
}

// ─── Signal detection ────────────────────────────────────────────────────────

async function fetchSymbolData(symbol, baseUrl) {
  const [klines1hResult, klines4hResult, tickerResult, premiumResult] = await Promise.allSettled([
    fetchJson(`${BINANCE_FAPI}/klines?symbol=${symbol}&interval=${INTERVAL}&limit=200`, "1H klines"),
    fetchJson(`${BINANCE_FAPI}/klines?symbol=${symbol}&interval=${HTF_INTERVAL}&limit=100`, "4H klines"),
    fetchJson(`${BINANCE_FAPI}/ticker/24hr?symbol=${symbol}`, "Ticker"),
    fetchJson(`${BINANCE_FAPI}/premiumIndex?symbol=${symbol}`, "Premium"),
  ]);
  if (klines1hResult.status !== "fulfilled" || tickerResult.status !== "fulfilled") return null;
  return {
    symbol,
    candles1h: klines1hResult.value.map(mapKlineEntry),
    candles4h: klines4hResult.status === "fulfilled" ? klines4hResult.value.map(mapKlineEntry) : [],
    ticker: tickerResult.value,
    premium: premiumResult.status === "fulfilled" ? premiumResult.value : null,
  };
}

function detectSignal(data, pricePrecision = 2) {
  const { symbol, candles1h, candles4h, ticker, premium } = data;
  if (!candles1h || candles1h.length < 60) return null;

  const closes1h = candles1h.map(c => c.close);
  const closes4h = candles4h.length >= 55 ? candles4h.map(c => c.close) : null;

  // 1H indicators
  const ema20 = ema(closes1h, 20);
  const ema50 = ema(closes1h, 50);
  const rsi14 = rsi(closes1h, 14);
  const macd = macdFull(closes1h);
  const atr = atrValue(candles1h, 14);
  const vol20avg = average(candles1h.slice(-22, -2).map(c => c.volume));

  // 4H indicators
  let trend4h = null;
  if (closes4h) {
    const ema20_4h = ema(closes4h, 20);
    const ema50_4h = ema(closes4h, 50);
    const last4h = closes4h.length - 1;
    if (ema20_4h[last4h] != null && ema50_4h[last4h] != null) {
      trend4h = ema20_4h[last4h] > ema50_4h[last4h] ? "up" : "down";
    }
  }

  const last = candles1h.length - 1;
  const prev = last - 1;

  const ema20Last = ema20[last];
  const ema50Last = ema50[last];
  const rsiLast = rsi14[last];
  const macdLast = macd[last];
  const macdPrev = macd[prev];

  if (!ema20Last || !ema50Last || !rsiLast || !macdLast) return null;

  const candle = candles1h[last];
  const currentPrice = Number(ticker?.lastPrice) || candle.close;
  const volume = candle.volume;
  const body = Math.abs(candle.close - candle.open);
  const range = candle.high - candle.low;
  const upperWick = candle.high - Math.max(candle.open, candle.close);
  const lowerWick = Math.min(candle.open, candle.close) - candle.low;
  const fundingRate = (Number(premium?.lastFundingRate) || 0) * 100;
  const quoteVolume = Number(ticker?.quoteVolume) || 0;

  const ema1hTrend = ema20Last > ema50Last ? "up" : "down";
  const structuralTrend = trend4h || ema1hTrend;

  // Determine side and evaluate conditions
  const isLong = structuralTrend === "up";
  const side = isLong ? "Long" : "Short";

  // Factor evaluation
  const factors = {};

  // 1. 4H trend confirmed
  factors.trendAligned = trend4h != null && trend4h === ema1hTrend;
  factors.trendExists = structuralTrend === (isLong ? "up" : "down");

  // 2. RSI zone check
  const rsiOptimal = isLong ? (rsiLast >= 45 && rsiLast <= 60) : (rsiLast >= 40 && rsiLast <= 55);
  const rsiAcceptable = isLong ? (rsiLast >= 38 && rsiLast <= 68) : (rsiLast >= 32 && rsiLast <= 62);
  factors.rsiOptimal = rsiOptimal;
  factors.rsiAcceptable = rsiAcceptable;
  factors.rsiValue = rsiLast;

  if (!rsiAcceptable) return null; // Hard filter — RSI must be in reasonable zone

  // 3. MACD confirmation
  const histLast = macdLast.hist;
  const histPrev = macdPrev?.hist;
  const macdCrossed = histPrev != null && histLast != null && (
    isLong ? (histPrev <= 0 && histLast > 0) : (histPrev >= 0 && histLast < 0)
  );
  const macdConfirming = histLast != null && (
    isLong ? (histLast > 0 && histLast > (histPrev || 0)) : (histLast < 0 && histLast < (histPrev || 0))
  );
  factors.macdCrossed = macdCrossed;
  factors.macdConfirming = macdConfirming;

  if (!macdCrossed && !macdConfirming) return null; // Need MACD confirmation

  // 4. Price position relative to EMA20 (pullback/rally to dynamic level)
  const distFromEma20 = Math.abs(currentPrice - ema20Last);
  const atEma20 = distFromEma20 <= atr * 0.8;
  const closeToEma20 = distFromEma20 <= atr * 1.5;
  factors.atEma20 = atEma20;
  factors.closeToEma20 = closeToEma20;

  if (!closeToEma20) return null; // Must be near EMA20

  // 5. Candle quality
  const wickRejection = isLong
    ? (lowerWick > body * 0.8 && lowerWick > atr * 0.15) // long lower wick = demand
    : (upperWick > body * 0.8 && upperWick > atr * 0.15); // long upper wick = supply
  factors.wickRejection = wickRejection;

  // 6. Volume
  const volumeSpike = vol20avg > 0 && volume > vol20avg * 1.2;
  const volumeStrong = vol20avg > 0 && volume > vol20avg * 1.5;
  factors.volumeSpike = volumeSpike;
  factors.volumeStrong = volumeStrong;

  // 7. Funding rate
  const fundingFavorable = isLong ? fundingRate < 0.04 : fundingRate > -0.04;
  const fundingNeutral = isLong ? fundingRate < 0.08 : fundingRate > -0.08;
  factors.fundingFavorable = fundingFavorable;

  if (!fundingNeutral) return null; // Block extremely crowded trades

  // ── Quality score ─────────────────────────────────────────────────────────
  let quality = 0;
  quality += factors.trendAligned ? 20 : (factors.trendExists ? 10 : 0);
  quality += rsiOptimal ? 15 : 8;
  quality += macdCrossed ? 15 : (macdConfirming ? 10 : 0);
  quality += atEma20 ? 15 : (closeToEma20 ? 8 : 0);
  quality += wickRejection ? 12 : 0;
  quality += volumeStrong ? 10 : (volumeSpike ? 6 : 0);
  quality += fundingFavorable ? 8 : 4;
  quality += quoteVolume > 500_000_000 ? 5 : (quoteVolume > 100_000_000 ? 3 : 0);

  if (quality < MIN_QUALITY) return null;

  // ── Trade levels ──────────────────────────────────────────────────────────
  const riskAtr = atr;
  const entry = currentPrice;
  const sl = isLong ? entry - riskAtr : entry + riskAtr;
  const tp1 = isLong ? entry + riskAtr * 1.5 : entry - riskAtr * 1.5;
  const tp2 = isLong ? entry + riskAtr * 2.5 : entry - riskAtr * 2.5;
  const rr1 = 1.5;
  const rr2 = 2.5;

  // Build reason labels
  const reasonLabels = [];
  if (factors.trendAligned) reasonLabels.push("4H + 1H trend aligned");
  else if (factors.trendExists) reasonLabels.push("1H trend confirmed");
  if (macdCrossed) reasonLabels.push("MACD fresh cross");
  else if (macdConfirming) reasonLabels.push("MACD momentum");
  if (atEma20) reasonLabels.push("At EMA20");
  else if (closeToEma20) reasonLabels.push("Near EMA20");
  if (wickRejection) reasonLabels.push(isLong ? "Wick demand" : "Wick supply");
  if (volumeStrong) reasonLabels.push("Strong volume");
  else if (volumeSpike) reasonLabels.push("Volume spike");
  if (rsiOptimal) reasonLabels.push(`RSI ${Math.round(rsiLast)}`);
  if (fundingFavorable) reasonLabels.push("Funding clean");

  const id = `${symbol}-${INTERVAL}-${side}-${candle.time}`;

  return {
    id,
    symbol,
    side,
    quality,
    interval: INTERVAL,
    detectedAt: Date.now(),
    alertedAt: 0,
    entryPrice: entry,
    sl: Number(sl.toFixed(pricePrecision)),
    tp1: Number(tp1.toFixed(pricePrecision)),
    tp2: Number(tp2.toFixed(pricePrecision)),
    rr1,
    rr2,
    atr: Number(atr.toFixed(pricePrecision)),
    ema20: Number(ema20Last.toFixed(pricePrecision)),
    ema50: Number(ema50Last.toFixed(pricePrecision)),
    currentPrice: entry,
    fundingRate,
    status: "active",
    factors,
    reasonLabels,
    pricePrecision,
    candleTime: candle.time,
  };
}

// ─── Alert formatting ────────────────────────────────────────────────────────

function formatAlertMessage(signal) {
  const dir = signal.side === "Long" ? "🟢 LONG" : "🔴 SHORT";
  const star = signal.quality >= 80 ? "⭐ HIGH CONVICTION — " : "";
  const fp = v => formatPrice(v, signal.pricePrecision);
  return [
    `${dir} ${signal.symbol}  ·  Q${signal.quality}`,
    `${star}Claudeperps Momentum Confluence`,
    ``,
    `Entry:  ${fp(signal.entryPrice)}`,
    `TP1:    ${fp(signal.tp1)}  (R/R 1.5:1)`,
    `TP2:    ${fp(signal.tp2)}  (R/R 2.5:1)`,
    `SL:     ${fp(signal.sl)}`,
    ``,
    `ATR: ${fp(signal.atr)} · Funding: ${formatPercent(signal.fundingRate)}`,
    `Factors: ${signal.reasonLabels.slice(0, 5).join(" · ")}`,
    `Time: ${new Date(signal.detectedAt).toUTCString()}`,
  ].join("\n");
}

async function maybeSendAlert(state, signal, baseUrl) {
  if (!state.alertDelivery?.notifyOnNew) return;
  if (!isDiscordWebhook(state.alertDelivery?.discordWebhook)) return;
  try {
    await sendDiscordNotify(
      baseUrl,
      state.alertDelivery.discordWebhook,
      `${signal.side === "Long" ? "🟢" : "🔴"} ${signal.symbol} Q${signal.quality} — Claudeperps`,
      formatAlertMessage(signal),
      { quality: signal.quality, symbol: signal.symbol, side: signal.side }
    );
    signal.alertedAt = Date.now();
    updateAlertDeliveryResult(state.alertDelivery, "up", `Alert sent for ${signal.symbol} (Q${signal.quality})`);
    await safeInsertSignalEvent({
      strategy: STRATEGY_ID,
      symbol: signal.symbol,
      signal_type: signal.side === "Long" ? "long_entry" : "short_entry",
      quality_score: signal.quality,
      details: JSON.stringify({ entry: signal.entryPrice, tp1: signal.tp1, tp2: signal.tp2, sl: signal.sl }),
    });
  } catch (err) {
    updateAlertDeliveryResult(state.alertDelivery, "down", `Alert failed: ${err.message}`);
  }
}

// ─── Analysis for token search ───────────────────────────────────────────────

async function analyzeToken(rawToken, baseUrl) {
  const cleaned = String(rawToken || "").toUpperCase().trim().replace(/[^A-Z0-9]/g, "");
  const universe = await getPerpUniverse();
  let symbolInfo = universe.find(s => s.symbol === cleaned || s.symbol === `${cleaned}USDT`);
  if (!symbolInfo) {
    const scored = universe.map(s => ({ ...s, score: scoreSymbolCandidate(s, cleaned) }))
      .filter(s => s.score > 0).sort((a, b) => b.score - a.score);
    symbolInfo = scored[0];
  }
  if (!symbolInfo) return { ok: false, error: `No USDT perp found for "${rawToken}"` };

  const data = await fetchSymbolData(symbolInfo.symbol, baseUrl);
  if (!data) return { ok: false, error: `Failed to fetch data for ${symbolInfo.symbol}` };

  const { candles1h, candles4h, ticker, premium } = data;
  if (!candles1h || candles1h.length < 60) return { ok: false, error: "Not enough candle data" };

  const closes1h = candles1h.map(c => c.close);
  const closes4h = candles4h.length >= 55 ? candles4h.map(c => c.close) : null;
  const ema20 = ema(closes1h, 20);
  const ema50 = ema(closes1h, 50);
  const rsi14 = rsi(closes1h, 14);
  const macd = macdFull(closes1h);
  const atr = atrValue(candles1h, 14);

  let trend4h = null, ema20_4h_last = null, ema50_4h_last = null;
  if (closes4h) {
    const e20 = ema(closes4h, 20);
    const e50 = ema(closes4h, 50);
    const last4 = closes4h.length - 1;
    ema20_4h_last = e20[last4];
    ema50_4h_last = e50[last4];
    if (ema20_4h_last != null && ema50_4h_last != null)
      trend4h = ema20_4h_last > ema50_4h_last ? "up" : "down";
  }

  const last = candles1h.length - 1;
  const currentPrice = Number(ticker?.lastPrice) || candles1h[last].close;
  const fundingRate = (Number(premium?.lastFundingRate) || 0) * 100;
  const pricePrecision = symbolInfo.pricePrecision || 2;

  const signal = detectSignal(data, pricePrecision);

  // Comprehensive bias
  const ema1hTrend = ema20[last] > ema50[last] ? "up" : "down";
  const structureBias = trend4h || ema1hTrend;
  const rsiLast = rsi14[last];
  const change24h = Number(ticker?.priceChangePercent) || 0;
  const volume24h = Number(ticker?.quoteVolume) || 0;

  // Compute overall quality for display
  let analysisQuality = signal?.quality ?? 0;
  if (!signal) {
    // Partial scoring for display even if no signal
    let partialQ = 0;
    if (structureBias === "up") partialQ += 20;
    if (rsiLast != null && rsiLast > 40 && rsiLast < 70) partialQ += 15;
    const mLast = macd[last];
    if (mLast?.hist != null && ((structureBias === "up" && mLast.hist > 0) || (structureBias === "down" && mLast.hist < 0))) partialQ += 15;
    if (volume24h > 500_000_000) partialQ += 10;
    analysisQuality = partialQ;
  }

  return {
    ok: true,
    symbol: symbolInfo.symbol,
    currentPrice,
    pricePrecision,
    change24h,
    volume24h,
    fundingRate,
    atr,
    ema20: ema20[last],
    ema50: ema50[last],
    ema20_4h: ema20_4h_last,
    ema50_4h: ema50_4h_last,
    trend1h: ema1hTrend,
    trend4h,
    structureBias,
    rsi: rsiLast,
    macd: macd[last],
    analysisQuality,
    signal,
    candles: candles1h.slice(-100).map(c => ({
      time: Math.floor(c.time),
      open: c.open, high: c.high, low: c.low, close: c.close, volume: c.volume,
    })),
    ema20Series: ema20.slice(-100).map((v, i) => ({
      time: Math.floor(candles1h[candles1h.length - 100 + i]?.time || 0),
      value: v,
    })).filter(p => p.value != null && p.time > 0),
    ema50Series: ema50.slice(-100).map((v, i) => ({
      time: Math.floor(candles1h[candles1h.length - 100 + i]?.time || 0),
      value: v,
    })).filter(p => p.value != null && p.time > 0),
  };
}

// ─── Main scan ───────────────────────────────────────────────────────────────

async function runClaudePerps_Scan(stateInput = {}, options = {}) {
  const state = sanitizeRuntimeState(stateInput);
  const baseUrl = resolveBaseUrl(options.baseUrl);
  const now = Date.now();

  // Mark open paper positions against live prices first
  await markPaperPositions(state, now);

  // Expire old signals
  state.signals = state.signals.filter(s => s.status === "active" && (now - s.detectedAt) < SIGNAL_EXPIRE_MS);

  try {
    const universe = await getPerpUniverse();
    const batch = selectBatch(universe, state);
    let newSignals = 0;

    // scanResults holds ALL detected signals (not just new ones) for the Scanner tab
    const scanResults = [];

    const results = await mapWithConcurrency(batch, ANALYSIS_CONCURRENCY, async (symbolInfo) => {
      try {
        const data = await fetchSymbolData(symbolInfo.symbol, baseUrl);
        if (!data) return null;
        return detectSignal(data, symbolInfo.pricePrecision);
      } catch (_) { return null; }
    });

    const existingIds = new Set(state.signals.map(s => s.id));

    for (const signal of results.filter(Boolean)) {
      scanResults.push(signal);
      if (existingIds.has(signal.id)) continue; // dedup for signal feed
      state.signals.unshift(signal);
      newSignals++;
      openPaperTrade(state, signal, now);
      await maybeSendAlert(state, signal, baseUrl);
    }

    // Store scanner results (capped at 200) and update last scan time
    state.lastScanResults = scanResults.slice(0, 200);

    // Keep most recent 200 signals
    state.signals = state.signals.slice(0, 200);
    state.lastScanAt = now;

    const activeCount = state.signals.filter(s => s.status === "active").length;
    const msg = newSignals > 0
      ? `Found ${newSignals} new signal${newSignals > 1 ? "s" : ""}. ${activeCount} active.`
      : `Scan complete. ${activeCount} active signals. No new entries.`;
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
  runClaudePerps_Scan,
  analyzeToken,
};
