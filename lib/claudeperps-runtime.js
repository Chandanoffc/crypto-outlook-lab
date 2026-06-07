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
 * TPs: 3× and 5× ATR from entry (targets 15–25% on qualifying volatile alts). SL: 1× ATR below/above entry.
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
const MIN_QUALITY = 70;           // minimum to surface in signal feed
const MIN_ALERT_QUALITY = 78;     // minimum quality to fire a Discord alert
const ALERT_COOLDOWN_MS = 4 * 60 * 60 * 1000;  // 4h cooldown per symbol+side
const SIGNAL_EXPIRE_MS = 6 * 60 * 60 * 1000;   // expire signals after 6h
const SCAN_COOLDOWN_MS = 4 * 60 * 1000;         // 4-min between background scans
const ANALYSIS_CONCURRENCY = 5;

// Paper trading constants
const PAPER_START    = 100;
const PAPER_MAX_POS  = 5;
const PAPER_SIZE_PCT = 0.10;   // 10% of balance as margin per trade
const PAPER_LEVERAGE = 5;      // 5× leverage — models realistic perps sizing
const PAPER_EXPIRY   = 48 * 60 * 60 * 1000;  // 48h before force-close (was 24h)
const PAPER_BE_TRIGGER_PCT = 25;             // leveraged % gain → trail SL to entry

// ─── Circuit breaker — pause new entries after a rough patch ─────────────────
// Protects capital from compounding correlated losses (crypto alts move together —
// a string of SL hits in one selloff shouldn't be allowed to snowball unchecked).
const CB_MAX_DRAWDOWN_PCT   = 20;                  // pause if balance falls 20% from its peak
const CB_MAX_CONSEC_LOSSES  = 4;                   // pause after N losing closes in a row
const CB_DRAWDOWN_PAUSE_MS  = 24 * 60 * 60 * 1000; // 24h cool-off on drawdown trip
const CB_STREAK_PAUSE_MS    = 6  * 60 * 60 * 1000; // 6h cool-off on loss-streak trip
const PRIORITY_SCAN_COUNT = 24;
const ROTATION_SCAN_COUNT = 48;
const QUOTE_ASSET = "USDT";
const BINANCE_FAPI = "https://fapi.binance.com/fapi/v1";
const DEFAULT_START_VERSION = 1;

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
    peakBalance: PAPER_START,
    consecutiveLosses: 0,
    pausedUntil: 0,
    pauseReason: null,
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
    leverage:      sanitizeNumber(t.leverage, 1),
    lastMarkPrice: t.lastMarkPrice > 0 ? sanitizeNumber(t.lastMarkPrice, 0) : null,
    lastMarkAt:    sanitizeNumber(t.lastMarkAt, 0),
    slMovedToBE:   Boolean(t.slMovedToBE),
  };
}

function sanitizePaper(raw = {}) {
  return {
    balance:        sanitizeNumber(raw.balance, PAPER_START),
    startingBalance: sanitizeNumber(raw.startingBalance, PAPER_START),
    openPositions:  Array.isArray(raw.openPositions) ? raw.openPositions.map(sanitizePaperTrade) : [],
    closedTrades:   Array.isArray(raw.closedTrades)  ? raw.closedTrades.map(sanitizePaperTrade).slice(0, 300) : [],
    lastMarkAt:     sanitizeNumber(raw.lastMarkAt, 0),
    peakBalance:       Math.max(sanitizeNumber(raw.peakBalance, PAPER_START), sanitizeNumber(raw.balance, PAPER_START), PAPER_START),
    consecutiveLosses: Math.max(0, sanitizeNumber(raw.consecutiveLosses, 0)),
    pausedUntil:       sanitizeNumber(raw.pausedUntil, 0),
    pauseReason:       typeof raw.pauseReason === "string" ? raw.pauseReason.slice(0, 200) : null,
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
    outcomeSent: s.outcomeSent === true,
    outcome: typeof s.outcome === "string" ? s.outcome : null,
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
  // Idempotency guard: if this position was already closed (by a concurrent mark
  // or scan), skip silently — prevents duplicate Discord alerts and double P&L.
  if (state.paper.closedTrades.some(t => t.id === pos.id)) return;
  const diff = pos.side === "Long" ? closePrice - pos.entryPrice : pos.entryPrice - closePrice;
  const lev  = pos.leverage || 1;
  const pnl  = Math.round((diff / pos.entryPrice) * pos.size * lev * 100) / 100;
  state.paper.balance = Math.max(0, Math.round((state.paper.balance + pnl) * 100) / 100);
  state.paper.closedTrades.unshift({
    ...pos, closedAt: now, closedPrice: closePrice, closeReason: reason,
    pnl, pnlPct: Math.round((diff / pos.entryPrice) * lev * 10000) / 100,
  });
  state.paper.closedTrades = state.paper.closedTrades.slice(0, 300);

  applyCircuitBreaker(state, pnl, now);
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
    if (!price) { stillOpen.push(pos); continue; }
    const isLong = pos.side === "Long";
    // TP1-reached positions get 2× expiry window (SL is at breakeven so risk is near-zero)
    const effectiveExpiry = pos.tp1Reached ? PAPER_EXPIRY * 2 : PAPER_EXPIRY;
    if (now - pos.openedAt > effectiveExpiry) {
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
      // ── Breakeven protection ───────────────────────────────────────────────
      // When leveraged unrealized profit crosses +25%, trail SL to entry price.
      // This locks in a risk-free position before the trade reaches TP1.
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

function openPaperTrade(state, signal, now) {
  if (signal.quality < MIN_ALERT_QUALITY) return;  // only paper-trade signals we'd actually take
  if (now < (state.paper.pausedUntil || 0)) return; // circuit breaker active — no new entries
  if (state.paper.openPositions.length >= PAPER_MAX_POS) return;
  if (state.paper.openPositions.some(p => p.symbol === signal.symbol)) return;
  if (state.paper.balance < 1) return;
  const size = Math.max(0.50, Math.round(state.paper.balance * PAPER_SIZE_PCT * 100) / 100);
  state.paper.openPositions.push(sanitizePaperTrade({
    id: `pt-${signal.id}`, symbol: signal.symbol, side: signal.side,
    entryPrice: signal.entryPrice, tp1: signal.tp1, tp2: signal.tp2, sl: signal.sl,
    size, leverage: PAPER_LEVERAGE, openedAt: now, quality: signal.quality, signalId: signal.id,
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

  // 0. Hard block: 4H trend must not oppose 1H trend — trading counter-trend kills win rate
  if (trend4h !== null && trend4h !== ema1hTrend) return null;

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

  // MACD: allow approaching-zero as a softer confirmation (sideway markets rarely
  // produce fresh crosses, but a histogram approaching zero from the right side is
  // still meaningful — loosened from hard cross/confirming to include near-zero).
  const macdApproaching = histLast != null && (
    isLong  ? (histLast > -0.0005 && histLast < 0)   // bearish MACD but nearly neutral
    : (histLast < 0.0005  && histLast > 0)            // bullish MACD but nearly neutral
  );
  factors.macdApproaching = macdApproaching;
  if (!macdCrossed && !macdConfirming && !macdApproaching) return null;

  // 4. Price position relative to EMA20 — expanded to 1.5× ATR (was 1.0×).
  // In sideways/ranging markets price rarely sits exactly on EMA20; the wider
  // tolerance lets setups near the EMA zone qualify without losing precision.
  const distFromEma20 = Math.abs(currentPrice - ema20Last);
  const atEma20 = distFromEma20 <= atr * 0.8;
  const closeToEma20 = distFromEma20 <= atr * 1.5;
  factors.atEma20 = atEma20;
  factors.closeToEma20 = closeToEma20;

  if (!closeToEma20) return null; // Must be within 1.5× ATR of EMA20

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
  quality += macdCrossed ? 15 : (macdConfirming ? 10 : (macdApproaching ? 5 : 0));
  quality += atEma20 ? 15 : (closeToEma20 ? 8 : 0);
  quality += wickRejection ? 12 : 0;
  quality += volumeStrong ? 10 : (volumeSpike ? 6 : 0);
  quality += fundingFavorable ? 8 : 4;
  quality += quoteVolume > 500_000_000 ? 5 : (quoteVolume > 100_000_000 ? 3 : 0);

  if (quality < MIN_QUALITY) return null;

  // ── Trade levels ──────────────────────────────────────────────────────────
  const entry = currentPrice;

  // ── Volatility gate — only trade coins with enough ATR to reach 15%+ targets ──
  // ATR must be at least 2.0% of price. At 3×ATR (TP1) gives ~6% min,
  // at 5×ATR (TP2) gives ~10% min, rising to 25% on 5% ATR coins.
  const atrPct = entry > 0 ? atr / entry : 0;
  if (atrPct < 0.020) return null; // coin too stable for meaningful targets — skip
  // SL: use candle wick as structural reference + 0.25 ATR buffer
  const sl = isLong
    ? Math.min(candle.low - atr * 0.25, entry - atr)
    : Math.max(candle.high + atr * 0.25, entry + atr);
  const riskAtr = atr;
  // TP multipliers raised to target 15–25% on qualifying volatile alts.
  // TP1 = 3×ATR (≥7.5% gain at 2.5% ATR floor), TP2 = 5×ATR (≥12.5%, avg 20%+).
  const tp1 = isLong ? entry + riskAtr * 3.0 : entry - riskAtr * 3.0;
  const tp2 = isLong ? entry + riskAtr * 5.0 : entry - riskAtr * 5.0;
  const rr1 = 3.0;
  const rr2 = 5.0;

  // Build reason labels
  const reasonLabels = [];
  if (factors.trendAligned) reasonLabels.push("4H + 1H trend aligned");
  else if (factors.trendExists) reasonLabels.push("1H trend confirmed");
  if (macdCrossed) reasonLabels.push("MACD fresh cross");
  else if (macdConfirming) reasonLabels.push("MACD momentum");
  else if (macdApproaching) reasonLabels.push("MACD approaching");
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
    `TP1:    ${fp(signal.tp1)}  (R/R ${signal.rr1.toFixed(1)}:1)`,
    `TP2:    ${fp(signal.tp2)}  (R/R ${signal.rr2.toFixed(1)}:1)`,
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
  // Quality gate — only send high-conviction signals to Discord
  if (signal.quality < MIN_ALERT_QUALITY) return;
  // Per-symbol+side cooldown — don't spam the same setup within 4h
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
      baseUrl,
      state.alertDelivery.discordWebhook,
      `${emoji} ${signal.symbol} Q${signal.quality} — Claudeperps`,
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
        qualificationReason: (signal.reasonLabels || []).slice(0, 5).join(" · "),
        strategy: "CLAUDEPERPS",
        formattedMessage: formatAlertMessage(signal),
      },
      { eventType: "entry_opened" }
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

/** Send a Discord follow-up when an alerted signal hits TP1/TP2/SL */
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
      `${emoji} ${signal.symbol} — ${label} — Claudeperps`,
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
        strategy: "CLAUDEPERPS",
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

  // Batch-fetch current prices
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
      `${emoji} ${pos.symbol} — ${label} — Claudeperps`,
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
        strategy: "CLAUDEPERPS",
      },
      { eventType }
    );
  } catch (err) {
    updateAlertDeliveryResult(state.alertDelivery, "down", `${label} alert failed for ${pos.symbol}: ${err.message}`);
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
  await markPaperPositions(state, now, baseUrl);

  // Expire old signals
  state.signals = state.signals.filter(s => s.status === "active" && (now - s.detectedAt) < SIGNAL_EXPIRE_MS);

  // Stamp the scan time immediately — ensures lastScanAt is always saved even if
  // the scan itself throws or is cut short by a Vercel function timeout.
  state.lastScanAt = now;

  try {
    const universe = await getPerpUniverse();
    const batch = await selectBatch(universe, state);
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

    // Check outcomes for previously alerted signals (fires TP1/TP2/SL Discord follow-ups)
    await checkSignalOutcomes(state, now, baseUrl);

    // Keep most recent 200 signals
    state.signals = state.signals.slice(0, 200);

    const activeCount = state.signals.filter(s => s.status === "active").length;
    const paused = now < (state.paper.pausedUntil || 0);
    const baseMsg = newSignals > 0
      ? `Found ${newSignals} new signal${newSignals > 1 ? "s" : ""}. ${activeCount} active.`
      : `Scan complete. ${activeCount} active signals. No new entries.`;
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
  runClaudePerps_Scan,
  markPaperPositions,
  analyzeToken,
};
