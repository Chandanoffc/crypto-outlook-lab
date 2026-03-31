const crypto = require("crypto");
const fallbackExchangeInfo = require("../fallback-perps.js");
const { insertSignalEvent, insertTradeEvent, listTradeEventsByStrategy } = require("./neon-db");

const STRATEGY_SPECS = [
  { id: "core", label: "House Trend", shortLabel: "House", tone: "up", maxOpenTrades: 6 },
];
const STRATEGY_START_BALANCE = 1000;
const START_BALANCE = STRATEGY_START_BALANCE;
const DEFAULT_INTERVAL = "15m";
const DEFAULT_QUALITY_THRESHOLD = 61;
const QUOTE_ASSET = "USDT";
const PRIORITY_SCAN_COUNT = 10;
const ROTATION_SCAN_COUNT = 24;
const ANALYSIS_CONCURRENCY = 5;
const HTF_CONFIRMATION_CONCURRENCY = 4;
const HTF_CONFIRMATION_CACHE_MS = 5 * 60 * 1000;
const MAX_CONCURRENT_TRADES = STRATEGY_SPECS.reduce((sum, item) => sum + item.maxOpenTrades, 0);
const MAX_NEW_TRADES_PER_SCAN = 4;
const DEFAULT_LEVERAGE = 5;
const TARGET_MARGIN_RETURN_PCT = 22;
const STOP_MARGIN_RETURN_PCT = 10;
const TRADE_COOLDOWN_MS = 4 * 60 * 1000;
const STOP_LOSS_COOLDOWN_MS = 2 * 60 * 60 * 1000;
const HIGH_VOLUME_FLOOR = 100_000_000;
const MIN_RR = 1.18;
const MIN_PROJECTED_MOVE_PCT = 0.9;
const STRATEGY_VERSION = 6;
const HOUSE_MIN_ENTRY_SCORE = 11;
const HOUSE_MIN_REFINED_SCORE = 69;
const MIN_NEAREST_TARGET_RR = 1.05;
const MAX_ENTRY_DISTANCE_FROM_EMA20_ATR = 1.9;
const MAX_ENTRY_DISTANCE_FROM_LEVEL_ATR = 1.5;
const MIN_EMA_SPREAD_ATR = 0.22;
const MIN_ATR_PCT_FOR_CONTINUATION = 0.45;
const MIN_RECENT_BODY_RATIO = 0.33;
const MAX_RECENT_WICKY_CANDLES = 2;
const HTF_CONFIRMATION_CONFIG = [
  { key: "1h", label: "1H", interval: "1h" },
  { key: "4h", label: "4H", interval: "4h" },
];

let exchangeInfoCache = null;
let perpUniverseCache = null;
let confirmationCache = new Map();
let universeTickerMap = new Map();

function buildDefaultStrategyBalances() {
  return STRATEGY_SPECS.reduce((accumulator, spec) => {
    accumulator[spec.id] = STRATEGY_START_BALANCE;
    return accumulator;
  }, {});
}

function normalizeStrategyBalances(storedBalances = {}) {
  const fallback = buildDefaultStrategyBalances();
  STRATEGY_SPECS.forEach((spec) => {
    const value = Number(storedBalances?.[spec.id]);
    if (Number.isFinite(value)) fallback[spec.id] = value;
  });
  return fallback;
}

function recomputeTotalBalance(state) {
  state.balance = STRATEGY_SPECS.reduce(
    (sum, spec) => sum + (Number(state.strategyBalances?.[spec.id]) || 0),
    0
  );
}

function strategySpec(strategyId) {
  return STRATEGY_SPECS.find((spec) => spec.id === strategyId) || STRATEGY_SPECS[0];
}

function defaultRuntimeState() {
  return {
    startingBalance: START_BALANCE,
    balance: START_BALANCE,
    strategyBalances: buildDefaultStrategyBalances(),
    autoEnabled: true,
    interval: DEFAULT_INTERVAL,
    qualityThreshold: DEFAULT_QUALITY_THRESHOLD,
    openTrades: [],
    strategyVersion: STRATEGY_VERSION,
    activeTab: "positions",
    closedTrades: [],
    activity: [],
    lastCandidates: [],
    lastScanAt: 0,
    scanCursor: 0,
    lastStatusMessage: "Background House engine is standing by.",
    lastStatusTone: "neutral",
    backgroundManaged: true,
  };
}

function sanitizeNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function nullableNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function nullableTimestamp(value) {
  if (!value) return null;
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : null;
}

function sanitizeTrade(trade = {}) {
  return {
    ...trade,
    strategyId: trade.strategyId || "core",
    strategyLabel: trade.strategyLabel || strategySpec(trade.strategyId || "core").label,
    symbol: String(trade.symbol || "").trim(),
    token: trade.token ? String(trade.token).trim() : "",
    interval: trade.interval || DEFAULT_INTERVAL,
    side: trade.side === "Short" ? "Short" : "Long",
    entryPrice: sanitizeNumber(trade.entryPrice),
    exitPrice: Number.isFinite(Number(trade.exitPrice)) ? Number(trade.exitPrice) : undefined,
    stopLoss: sanitizeNumber(trade.stopLoss),
    takeProfit: sanitizeNumber(trade.takeProfit),
    quantity: sanitizeNumber(trade.quantity),
    leverage: sanitizeNumber(trade.leverage, DEFAULT_LEVERAGE),
    marginUsed: sanitizeNumber(trade.marginUsed),
    qualityScore: sanitizeNumber(trade.qualityScore),
    biasScore: sanitizeNumber(trade.biasScore),
    targetReturnPct: sanitizeNumber(trade.targetReturnPct),
    stopReturnPct: sanitizeNumber(trade.stopReturnPct),
    projectedMovePct: sanitizeNumber(trade.projectedMovePct),
    rr: sanitizeNumber(trade.rr),
    entryScore: sanitizeNumber(trade.entryScore),
    entryReason: trade.entryReason || "",
    keyDetails: trade.keyDetails || "",
    pricePrecision: Number.isInteger(Number(trade.pricePrecision)) ? Number(trade.pricePrecision) : 2,
    breakEvenArmed: Boolean(trade.breakEvenArmed),
    profitLockArmed: Boolean(trade.profitLockArmed),
    openedAt: sanitizeNumber(trade.openedAt, Date.now()),
    detectedAt: sanitizeNumber(trade.detectedAt, Date.now()),
    closedAt: Number.isFinite(Number(trade.closedAt)) ? Number(trade.closedAt) : undefined,
    balanceBefore: sanitizeNumber(trade.balanceBefore),
    balanceAfter: Number.isFinite(Number(trade.balanceAfter)) ? Number(trade.balanceAfter) : undefined,
    strategyBalanceBefore: sanitizeNumber(trade.strategyBalanceBefore, STRATEGY_START_BALANCE),
    strategyBalanceAfter: Number.isFinite(Number(trade.strategyBalanceAfter))
      ? Number(trade.strategyBalanceAfter)
      : undefined,
    lastPrice: Number.isFinite(Number(trade.lastPrice)) ? Number(trade.lastPrice) : sanitizeNumber(trade.entryPrice),
    reason: trade.reason || undefined,
    pnlUsd: Number.isFinite(Number(trade.pnlUsd)) ? Number(trade.pnlUsd) : undefined,
    pnlPct: Number.isFinite(Number(trade.pnlPct)) ? Number(trade.pnlPct) : undefined,
    returnPct: Number.isFinite(Number(trade.returnPct)) ? Number(trade.returnPct) : undefined,
  };
}

function sanitizeActivityEntry(entry = {}) {
  return {
    time: sanitizeNumber(entry.time, Date.now()),
    message: String(entry.message || "").slice(0, 400),
    tone: entry.tone === "up" || entry.tone === "down" ? entry.tone : "neutral",
  };
}

function sanitizeCandidate(candidate = {}) {
  return {
    symbol: String(candidate.symbol || "").trim(),
    token: candidate.token ? String(candidate.token).trim() : "",
    currentPrice: sanitizeNumber(candidate.currentPrice),
    pricePrecision: Number.isInteger(Number(candidate.pricePrecision)) ? Number(candidate.pricePrecision) : 2,
    bias: {
      label: candidate.bias?.label || "Balanced",
      tone:
        candidate.bias?.tone === "up" || candidate.bias?.tone === "down"
          ? candidate.bias.tone
          : "neutral",
      stance: candidate.bias?.stance || "Wait",
    },
    qualityScore: sanitizeNumber(candidate.qualityScore),
    refinedQualityScore: sanitizeNumber(
      candidate.refinedQualityScore,
      Number.isFinite(Number(candidate.qualityScore)) ? Number(candidate.qualityScore) : 0
    ),
    bestStrategyQuality: sanitizeNumber(candidate.bestStrategyQuality, sanitizeNumber(candidate.refinedQualityScore)),
    rr: sanitizeNumber(candidate.rr),
    ema20: sanitizeNumber(candidate.ema20),
    ema50: sanitizeNumber(candidate.ema50),
    ema20Slope: sanitizeNumber(candidate.ema20Slope),
    ema50Slope: sanitizeNumber(candidate.ema50Slope),
    ema20SlopeAligned: Boolean(candidate.ema20SlopeAligned),
    ema50SlopeAligned: Boolean(candidate.ema50SlopeAligned),
    emaSpreadAtr: sanitizeNumber(candidate.emaSpreadAtr),
    atrPct: sanitizeNumber(candidate.atrPct),
    recentBodyRatio: sanitizeNumber(candidate.recentBodyRatio),
    recentWickyCount: sanitizeNumber(candidate.recentWickyCount),
    compressedStructure: Boolean(candidate.compressedStructure),
    lowVolatilityChop: Boolean(candidate.lowVolatilityChop),
    extremeCompressedStructure: Boolean(candidate.extremeCompressedStructure),
    extremeLowVolatilityChop: Boolean(candidate.extremeLowVolatilityChop),
    rsi: sanitizeNumber(candidate.rsi, 50),
    latestAtr: sanitizeNumber(candidate.latestAtr),
    fundingRate: sanitizeNumber(candidate.fundingRate),
    quoteVolume: sanitizeNumber(candidate.quoteVolume),
    oiChange1h: sanitizeNumber(candidate.oiChange1h),
    recentPriceChange: sanitizeNumber(candidate.recentPriceChange),
    crowdedContinuation: Boolean(candidate.crowdedContinuation),
    crowdedHardReject: Boolean(candidate.crowdedHardReject),
    cvdSlope: sanitizeNumber(candidate.cvdSlope),
    depthImbalance: sanitizeNumber(candidate.depthImbalance),
    takerRatio: sanitizeNumber(candidate.takerRatio, 1),
    globalLongShortRatio: sanitizeNumber(candidate.globalLongShortRatio, 1),
    alignedCount: sanitizeNumber(candidate.alignedCount),
    conflictCount: sanitizeNumber(candidate.conflictCount),
    buyerLed: Boolean(candidate.buyerLed),
    sellerLed: Boolean(candidate.sellerLed),
    crowdedSetup: Boolean(candidate.crowdedSetup),
    lowerLiquiditySetup: Boolean(candidate.lowerLiquiditySetup),
    htfAgreementHardRejected: Boolean(candidate.htfAgreementHardRejected),
    requiredQualityGate: sanitizeNumber(candidate.requiredQualityGate),
    requiredEntryScore: sanitizeNumber(candidate.requiredEntryScore),
    entryQualityScore: sanitizeNumber(candidate.entryQualityScore),
    entryScore: sanitizeNumber(candidate.entryScore),
    summary: String(candidate.summary || "").slice(0, 240),
    confirmation: {
      "1h": sanitizeTimeframeSummary(candidate.confirmation?.["1h"]),
      "4h": sanitizeTimeframeSummary(candidate.confirmation?.["4h"]),
    },
    trade: sanitizeTradePlan(candidate.trade),
    analyzedAt: sanitizeNumber(candidate.analyzedAt || candidate.lastScanAt || Date.now()),
  };
}

function sanitizeTradePlan(trade = {}) {
  return {
    stance: trade.stance === "Short" ? "Short" : "Long",
    tone: trade.tone === "down" ? "down" : "up",
    mode: trade.mode || "pullback",
    entry: sanitizeNumber(trade.entry),
    stopLoss: sanitizeNumber(trade.stopLoss),
    takeProfit: sanitizeNumber(trade.takeProfit),
    rr: sanitizeNumber(trade.rr),
    nearestTargetRr: sanitizeNumber(trade.nearestTargetRr),
    referenceLevel: sanitizeNumber(trade.referenceLevel),
    entryLocationQuality: Boolean(trade.entryLocationQuality),
    distanceFromEma20Atr: sanitizeNumber(trade.distanceFromEma20Atr),
    distanceFromLevelAtr: sanitizeNumber(trade.distanceFromLevelAtr),
    leverage: sanitizeNumber(trade.leverage, DEFAULT_LEVERAGE),
    targetReturnPct: sanitizeNumber(trade.targetReturnPct),
    stopReturnPct: sanitizeNumber(trade.stopReturnPct),
    projectedMovePct: sanitizeNumber(trade.projectedMovePct),
  };
}

function sanitizeTimeframeSummary(summary = {}) {
  return {
    label: summary.label || "Unavailable",
    tone:
      summary.tone === "up" || summary.tone === "down"
        ? summary.tone
        : "neutral",
    score: sanitizeNumber(summary.score),
    rsi: sanitizeNumber(summary.rsi, 50),
    changePct: sanitizeNumber(summary.changePct),
  };
}

function sanitizeRuntimeState(rawState = {}) {
  const base = defaultRuntimeState();
  const strategyBalances = normalizeStrategyBalances(rawState.strategyBalances);
  const openTrades = Array.isArray(rawState.openTrades) ? rawState.openTrades.map(sanitizeTrade) : [];
  const closedTrades = Array.isArray(rawState.closedTrades)
    ? rawState.closedTrades.map(sanitizeTrade).slice(0, 90)
    : [];
  const sanitized = {
    startingBalance: sanitizeNumber(rawState.startingBalance, base.startingBalance),
    balance: sanitizeNumber(rawState.balance, base.balance),
    strategyBalances,
    autoEnabled: rawState.autoEnabled !== false,
    interval: rawState.interval || base.interval,
    qualityThreshold: Math.max(50, sanitizeNumber(rawState.qualityThreshold, base.qualityThreshold)),
    openTrades,
    strategyVersion: sanitizeNumber(rawState.strategyVersion, STRATEGY_VERSION),
    activeTab: rawState.activeTab || base.activeTab,
    closedTrades,
    activity: Array.isArray(rawState.activity)
      ? rawState.activity.map(sanitizeActivityEntry).slice(0, 24)
      : [],
    lastCandidates: Array.isArray(rawState.lastCandidates)
      ? rawState.lastCandidates.map(sanitizeCandidate).slice(0, 48)
      : [],
    lastScanAt: sanitizeNumber(rawState.lastScanAt, 0),
    scanCursor: Math.max(0, sanitizeNumber(rawState.scanCursor, 0)),
    lastStatusMessage: String(rawState.lastStatusMessage || base.lastStatusMessage).slice(0, 400),
    lastStatusTone:
      rawState.lastStatusTone === "up" || rawState.lastStatusTone === "down"
        ? rawState.lastStatusTone
        : "neutral",
    backgroundManaged: true,
  };
  recomputeTotalBalance(sanitized);
  return sanitized;
}

function buildResetRuntimeState() {
  return defaultRuntimeState();
}

function applyRuntimeSettings(currentState, patch = {}) {
  const next = sanitizeRuntimeState({
    ...currentState,
    autoEnabled: patch.autoEnabled ?? currentState.autoEnabled,
    interval: patch.interval || currentState.interval,
    qualityThreshold:
      patch.qualityThreshold === undefined
        ? currentState.qualityThreshold
        : patch.qualityThreshold,
    activeTab: patch.activeTab || currentState.activeTab,
  });
  next.lastStatusMessage =
    patch.statusMessage || currentState.lastStatusMessage || "Background House engine updated.";
  next.lastStatusTone = patch.statusTone || currentState.lastStatusTone || "neutral";
  return next;
}

async function recoverRuntimeStateFromTradeEvents(stateInput = {}) {
  const baseState = sanitizeRuntimeState(stateInput);
  const result = await listTradeEventsByStrategy("house_trend", 800);
  const rows = Array.isArray(result?.rows) ? result.rows : [];
  if (!rows.length) {
    return {
      state: baseState,
      recovered: false,
    };
  }

  const tradeMap = new Map();
  for (const row of rows) {
    if (!row?.trade_id) continue;
    const metadata = row.metadata || {};
    const current = tradeMap.get(row.trade_id) || {
      id: row.trade_id,
      strategyId: "core",
      strategyLabel: strategySpec("core").label,
      symbol: row.symbol,
      token: "",
      interval: DEFAULT_INTERVAL,
      side: row.side === "Short" ? "Short" : "Long",
      entryPrice: nullableNumber(row.entry_price) ?? 0,
      stopLoss: nullableNumber(row.stop_loss) ?? 0,
      takeProfit: nullableNumber(row.tp2 ?? row.tp1) ?? 0,
      quantity: nullableNumber(row.quantity) ?? 0,
      leverage: nullableNumber(row.leverage) ?? DEFAULT_LEVERAGE,
      marginUsed: nullableNumber(row.margin_used) ?? 0,
      qualityScore: nullableNumber(row.quality_score) ?? 0,
      biasScore: 0,
      targetReturnPct: 0,
      stopReturnPct: 0,
      projectedMovePct: nullableNumber(metadata.projectedMovePct) ?? 0,
      rr: nullableNumber(metadata.rr) ?? 0,
      entryScore: nullableNumber(metadata.entryScore) ?? 0,
      entryReason: String(metadata.entryReason || ""),
      keyDetails: String(metadata.keyDetails || ""),
      pricePrecision: nullableNumber(metadata.pricePrecision) ?? 2,
      breakEvenArmed: false,
      profitLockArmed: false,
      openedAt: nullableTimestamp(row.opened_at) ?? Date.now(),
      detectedAt: nullableTimestamp(row.detected_at) ?? Date.now(),
      balanceBefore: 0,
      strategyBalanceBefore: STRATEGY_START_BALANCE,
      lastPrice: nullableNumber(row.entry_price) ?? 0,
    };

    current.symbol = row.symbol || current.symbol;
    current.side = row.side === "Short" ? "Short" : "Long";
    current.entryPrice = nullableNumber(row.entry_price) ?? current.entryPrice;
    current.stopLoss = nullableNumber(row.stop_loss) ?? current.stopLoss;
    current.takeProfit = nullableNumber(row.tp2 ?? row.tp1) ?? current.takeProfit;
    current.quantity = nullableNumber(row.quantity) ?? current.quantity;
    current.leverage = nullableNumber(row.leverage) ?? current.leverage;
    current.marginUsed = nullableNumber(row.margin_used) ?? current.marginUsed;
    current.qualityScore = nullableNumber(row.quality_score) ?? current.qualityScore;
    current.projectedMovePct = nullableNumber(metadata.projectedMovePct) ?? current.projectedMovePct;
    current.rr = nullableNumber(metadata.rr) ?? current.rr;
    current.entryScore = nullableNumber(metadata.entryScore) ?? current.entryScore;
    current.entryReason = String(metadata.entryReason || current.entryReason || "");
    current.keyDetails = String(metadata.keyDetails || current.keyDetails || "");
    current.openedAt = nullableTimestamp(row.opened_at) ?? current.openedAt;
    current.detectedAt = nullableTimestamp(row.detected_at) ?? current.detectedAt;
    current.lastEventType = String(row.event_type || current.lastEventType || "");
    current.closedAt = nullableTimestamp(row.closed_at) ?? current.closedAt;
    current.exitPrice = nullableNumber(row.exit_price) ?? current.exitPrice;
    current.returnPct = nullableNumber(row.return_pct) ?? current.returnPct;
    current.pnlUsd = nullableNumber(row.pnl_usd) ?? current.pnlUsd;
    current.balanceAfter = nullableNumber(row.balance_after) ?? current.balanceAfter;
    tradeMap.set(row.trade_id, current);
  }

  const openTrades = [];
  const closedTrades = [];
  let latestBalance = STRATEGY_START_BALANCE;
  let latestScanAt = baseState.lastScanAt || 0;

  for (const trade of tradeMap.values()) {
    const lastEventType = String(trade.lastEventType || "").toLowerCase();
    const isClosed = Boolean(trade.closedAt) || nullableNumber(trade.exitPrice) !== null || lastEventType === "tp" || lastEventType === "sl";
    latestScanAt = Math.max(latestScanAt, Number(trade.closedAt || trade.openedAt || 0));
    if (nullableNumber(trade.balanceAfter) !== null) {
      latestBalance = Math.max(0, trade.balanceAfter);
    }
    if (isClosed) {
      closedTrades.push(
        sanitizeTrade({
          ...trade,
          reason: lastEventType.toUpperCase(),
        })
      );
    } else {
      openTrades.push(sanitizeTrade(trade));
    }
  }

  if (!openTrades.length && !closedTrades.length) {
    return {
      state: baseState,
      recovered: false,
    };
  }

  return {
    recovered: true,
    state: sanitizeRuntimeState({
      ...baseState,
      startingBalance: STRATEGY_START_BALANCE,
      strategyBalances: { core: latestBalance },
      balance: latestBalance,
      openTrades,
      closedTrades: closedTrades.sort((a, b) => (b.closedAt || 0) - (a.closedAt || 0)).slice(0, 90),
      lastScanAt: latestScanAt,
      lastStatusMessage: openTrades.length
        ? `Recovered ${openTrades.length} House trade${openTrades.length > 1 ? "s" : ""} from persisted event history.`
        : baseState.lastStatusMessage,
      lastStatusTone: openTrades.length ? "neutral" : baseState.lastStatusTone,
    }),
  };
}

function logActivity(state, message, tone = "neutral") {
  state.activity.unshift({
    time: Date.now(),
    message,
    tone,
  });
  state.activity = state.activity.slice(0, 24);
}

function setRuntimeStatus(state, message, tone = "neutral") {
  state.lastStatusMessage = String(message || "").slice(0, 400);
  state.lastStatusTone = tone === "up" || tone === "down" ? tone : "neutral";
}

function average(values) {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function pctChange(start, end) {
  if (!Number.isFinite(start) || !Number.isFinite(end) || start === 0) return 0;
  return ((end - start) / Math.abs(start)) * 100;
}

function pctChangeFromLookback(values, lookback) {
  if (values.length <= lookback) return 0;
  return pctChange(values[values.length - 1 - lookback], values[values.length - 1]);
}

function latestDefinedValue(values) {
  for (let index = values.length - 1; index >= 0; index -= 1) {
    if (values[index] != null) return values[index];
  }
  return null;
}

function slopePercentage(values, lookback = 10) {
  const filtered = values.filter((value) => value != null);
  if (filtered.length <= lookback) return 0;
  return pctChange(filtered[filtered.length - 1 - lookback], filtered[filtered.length - 1]);
}

function percentile(values, ratio) {
  if (!values.length) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.floor(sorted.length * ratio));
  return sorted[index];
}

function ema(values, period) {
  if (values.length < period) return [];
  const multiplier = 2 / (period + 1);
  const seed = average(values.slice(0, period));
  const result = new Array(period - 1).fill(null);
  let current = seed;
  result.push(seed);

  for (let index = period; index < values.length; index += 1) {
    current = values[index] * multiplier + current * (1 - multiplier);
    result.push(current);
  }

  return result;
}

function rsi(values, period = 14) {
  if (values.length <= period) return [];
  const result = new Array(period).fill(null);
  let gains = 0;
  let losses = 0;

  for (let index = 1; index <= period; index += 1) {
    const change = values[index] - values[index - 1];
    if (change >= 0) gains += change;
    else losses += Math.abs(change);
  }

  let avgGain = gains / period;
  let avgLoss = losses / period;
  result.push(avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss));

  for (let index = period + 1; index < values.length; index += 1) {
    const change = values[index] - values[index - 1];
    const gain = change > 0 ? change : 0;
    const loss = change < 0 ? Math.abs(change) : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
    result.push(avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss));
  }

  return result;
}

function macd(values, fast = 12, slow = 26, signalPeriod = 9) {
  const fastSeries = ema(values, fast);
  const slowSeries = ema(values, slow);
  const line = values.map((_, index) => {
    const fastValue = fastSeries[index];
    const slowValue = slowSeries[index];
    return fastValue == null || slowValue == null ? null : fastValue - slowValue;
  });
  const cleanLine = line.filter((value) => value != null);
  const signalLine = ema(cleanLine, signalPeriod);
  const signal = line.map(() => null);
  let signalIndex = 0;

  for (let index = 0; index < line.length; index += 1) {
    if (line[index] != null && signalLine[signalIndex] != null) signal[index] = signalLine[signalIndex];
    if (line[index] != null) signalIndex += 1;
  }

  return {
    histogram: line.map((value, index) => {
      if (value == null || signal[index] == null) return null;
      return value - signal[index];
    }),
  };
}

function atr(candles, period = 14) {
  if (candles.length <= period) return [];
  const trueRanges = [];

  for (let index = 1; index < candles.length; index += 1) {
    const current = candles[index];
    const previousClose = candles[index - 1].close;
    trueRanges.push(
      Math.max(
        current.high - current.low,
        Math.abs(current.high - previousClose),
        Math.abs(current.low - previousClose)
      )
    );
  }

  const result = new Array(period).fill(null);
  let currentAtr = average(trueRanges.slice(0, period));
  result.push(currentAtr);

  for (let index = period; index < trueRanges.length; index += 1) {
    currentAtr = (currentAtr * (period - 1) + trueRanges[index]) / period;
    result.push(currentAtr);
  }

  return result;
}

function sma(values, period) {
  if (values.length < period) return [];
  const result = [];
  for (let index = 0; index < values.length; index += 1) {
    if (index < period - 1) {
      result.push(null);
      continue;
    }
    result.push(average(values.slice(index - period + 1, index + 1)));
  }
  return result;
}

function standardDeviation(values) {
  if (!values.length) return 0;
  const mean = average(values);
  const variance = average(values.map((value) => (value - mean) ** 2));
  return Math.sqrt(variance);
}

function bollingerBands(values, period = 20, multiplier = 2) {
  if (values.length < period) return { middle: [], upper: [], lower: [] };
  const middle = sma(values, period);
  const upper = [];
  const lower = [];

  for (let index = 0; index < values.length; index += 1) {
    if (index < period - 1) {
      upper.push(null);
      lower.push(null);
      continue;
    }
    const window = values.slice(index - period + 1, index + 1);
    const deviation = standardDeviation(window) * multiplier;
    upper.push(middle[index] + deviation);
    lower.push(middle[index] - deviation);
  }

  return { middle, upper, lower };
}

function candleBody(candle) {
  return Math.abs(candle.close - candle.open);
}

function candleRange(candle) {
  return Math.max(candle.high - candle.low, 0.0000001);
}

function lowerWickRatio(candle) {
  return (Math.min(candle.open, candle.close) - candle.low) / candleRange(candle);
}

function upperWickRatio(candle) {
  return (candle.high - Math.max(candle.open, candle.close)) / candleRange(candle);
}

function recentCandleQuality(candles, lookback = 4) {
  const recent = (candles || []).slice(-lookback).filter(Boolean);
  if (!recent.length) {
    return { avgBodyRatio: 0, wickyCount: 0, isWickyChop: true };
  }

  const avgBodyRatio = average(recent.map((candle) => candleBody(candle) / candleRange(candle)));
  const wickyCount = recent.filter((candle) => {
    const upper = upperWickRatio(candle);
    const lower = lowerWickRatio(candle);
    const bodyRatio = candleBody(candle) / candleRange(candle);
    return bodyRatio < 0.35 && (upper > 0.34 || lower > 0.34);
  }).length;

  return {
    avgBodyRatio,
    wickyCount,
    isWickyChop: avgBodyRatio < MIN_RECENT_BODY_RATIO || wickyCount > MAX_RECENT_WICKY_CANDLES,
  };
}

function computeSupportResistance(candles, currentPrice, latestAtr) {
  const supports = [];
  const resistances = [];
  const lookback = 3;

  for (let index = lookback; index < candles.length - lookback; index += 1) {
    const candle = candles[index];
    const previous = candles.slice(index - lookback, index);
    const next = candles.slice(index + 1, index + 1 + lookback);

    if (previous.every((item) => candle.low <= item.low) && next.every((item) => candle.low <= item.low)) {
      supports.push(candle.low);
    }
    if (previous.every((item) => candle.high >= item.high) && next.every((item) => candle.high >= item.high)) {
      resistances.push(candle.high);
    }
  }

  const clusterThreshold = Math.max(latestAtr * 0.7, currentPrice * 0.0035);
  const clusterLevels = (levels) =>
    levels
      .sort((left, right) => left - right)
      .reduce((groups, level) => {
        const lastGroup = groups[groups.length - 1];
        if (!lastGroup || Math.abs(lastGroup.center - level) > clusterThreshold) {
          groups.push({ levels: [level], center: level });
          return groups;
        }
        lastGroup.levels.push(level);
        lastGroup.center = average(lastGroup.levels);
        return groups;
      }, [])
      .map((group) => group.center);

  return {
    supportLevels: clusterLevels(supports)
      .filter((level) => level < currentPrice)
      .sort((left, right) => right - left)
      .slice(0, 2),
    resistanceLevels: clusterLevels(resistances)
      .filter((level) => level > currentPrice)
      .sort((left, right) => left - right)
      .slice(0, 2),
    bandWidth: clusterThreshold / 2,
  };
}

function hasGoodTradingVolume(quoteVolume) {
  return Number(quoteVolume) >= HIGH_VOLUME_FLOOR;
}

function normalizeTrade(rawTrade) {
  const price = Number(rawTrade.p || rawTrade.price);
  const quantity = Number(rawTrade.q || rawTrade.quantity);
  return {
    price,
    quantity,
    quoteNotional: price * quantity,
    isSellInitiated: Boolean(rawTrade.m ?? rawTrade.isSellInitiated),
  };
}

function analyzeTradeTape(trades) {
  const normalizedTrades = (trades || []).map(normalizeTrade);
  const notionals = normalizedTrades.map((trade) => trade.quoteNotional);
  const whaleCutoff = percentile(notionals, 0.9);
  let cumulativeDelta = 0;
  const cvdSeries = [];

  const summary = normalizedTrades.reduce(
    (accumulator, trade) => {
      cumulativeDelta += trade.quoteNotional * (trade.isSellInitiated ? -1 : 1);
      cvdSeries.push(cumulativeDelta);
      if (trade.isSellInitiated) accumulator.totalSellNotional += trade.quoteNotional;
      else accumulator.totalBuyNotional += trade.quoteNotional;
      if (trade.quoteNotional >= whaleCutoff) {
        if (trade.isSellInitiated) accumulator.bigSellNotional += trade.quoteNotional;
        else accumulator.bigBuyNotional += trade.quoteNotional;
      }
      return accumulator;
    },
    {
      totalBuyNotional: 0,
      totalSellNotional: 0,
      bigBuyNotional: 0,
      bigSellNotional: 0,
    }
  );

  return {
    cvdValue: cumulativeDelta,
    cvdSlope: slopePercentage(cvdSeries, 40),
    netLargeFlow: summary.bigBuyNotional - summary.bigSellNotional,
    totalBuyNotional: summary.totalBuyNotional,
    totalSellNotional: summary.totalSellNotional,
  };
}

function analyzeOrderbook(rawDepth, referencePrice) {
  const bids = (rawDepth?.bids || []).slice(0, 25).map(([price, quantity]) => ({
    price: Number(price),
    quantity: Number(quantity),
    notional: Number(price) * Number(quantity),
  }));
  const asks = (rawDepth?.asks || []).slice(0, 25).map(([price, quantity]) => ({
    price: Number(price),
    quantity: Number(quantity),
    notional: Number(price) * Number(quantity),
  }));
  const bidSum = bids.reduce((sum, level) => sum + level.notional, 0);
  const askSum = asks.reduce((sum, level) => sum + level.notional, 0);
  return {
    imbalance: bidSum + askSum === 0 ? 0 : (bidSum - askSum) / (bidSum + askSum),
    spreadBps:
      bids[0] && asks[0] && referencePrice
        ? ((asks[0].price - bids[0].price) / referencePrice) * 10000
        : 0,
  };
}

function analyzeTakerLongShort(entries) {
  const parsed = (entries || []).map((entry) => ({
    buySellRatio: Number(entry.buySellRatio),
  }));
  const latest = parsed[parsed.length - 1];
  return {
    latestRatio: latest?.buySellRatio || 1,
  };
}

function buildVenueConsensus(venues) {
  const activeVenues = (venues || []).filter((venue) => Number.isFinite(venue.lastPrice));
  if (!activeVenues.length) return { priceSpreadBps: 0, fundingSpreadPct: 0 };
  const prices = activeVenues.map((venue) => venue.lastPrice);
  const fundings = activeVenues
    .map((venue) => Number(venue.fundingRatePct))
    .filter((value) => Number.isFinite(value));
  return {
    priceSpreadBps:
      prices.length > 1 ? ((Math.max(...prices) - Math.min(...prices)) / average(prices)) * 10000 : 0,
    fundingSpreadPct:
      fundings.length > 1 ? Math.max(...fundings) - Math.min(...fundings) : 0,
  };
}

function buildBiasScore(context) {
  let score = 0;
  score += context.currentPrice > context.ema20 ? 12 : -12;
  score += context.ema20 > context.ema50 ? 14 : -14;
  score += context.recentPriceChange > 0.7 ? 8 : context.recentPriceChange < -0.7 ? -8 : 0;
  score += context.rsi >= 52 && context.rsi <= 66 ? 8 : context.rsi <= 48 && context.rsi >= 34 ? -8 : 0;
  score += context.rsi > 72 ? -6 : context.rsi < 28 ? 6 : 0;
  score += context.macdHistogram > 0 ? 10 : -10;
  score += context.cvdSlope > 0 ? 12 : -12;
  score += context.depthImbalance > 0.04 ? 8 : context.depthImbalance < -0.04 ? -8 : 0;
  if (context.oiChange1h > 0 && context.recentPriceChange > 0) score += 8;
  else if (context.oiChange1h > 0 && context.recentPriceChange < 0) score -= 8;
  else if (context.oiChange1h < 0 && context.recentPriceChange > 0) score += 2;
  else if (context.oiChange1h < 0 && context.recentPriceChange < 0) score -= 2;
  score += context.takerRatio > 1.02 ? 8 : context.takerRatio < 0.98 ? -8 : 0;
  if (context.fundingRate > 0.035) score -= 4;
  else if (context.fundingRate < -0.035) score += 4;
  else if (context.fundingRate > 0 && context.recentPriceChange > 0) score += 1;
  else if (context.fundingRate < 0 && context.recentPriceChange < 0) score -= 1;
  if (context.globalLongShortRatio > 1.15) score -= 2;
  else if (context.globalLongShortRatio < 0.85) score += 2;
  score += context.venueConsensus.priceSpreadBps < 8 ? 4 : -4;
  return Math.max(-100, Math.min(100, Math.round(score)));
}

function biasDescriptor(score) {
  if (score >= 35) return { label: "Bullish", tone: "up", stance: "Long" };
  if (score >= 10) return { label: "Slightly Bullish", tone: "up", stance: "Long" };
  if (score <= -35) return { label: "Bearish", tone: "down", stance: "Short" };
  if (score <= -10) return { label: "Slightly Bearish", tone: "down", stance: "Short" };
  return { label: "Balanced", tone: "neutral", stance: "Wait" };
}

function slopeAlignedForDirection(ema20Slope, ema50Slope, tone) {
  return tone === "up"
    ? ema20Slope > 0.02 && ema50Slope >= -0.01
    : ema20Slope < -0.02 && ema50Slope <= 0.01;
}

function buildPotentialTrade(context) {
  const supportLevels = [...context.supportLevels].filter(Boolean).sort((left, right) => right - left);
  const resistanceLevels = [...context.resistanceLevels].filter(Boolean).sort((left, right) => left - right);
  const tone = context.bias.tone === "neutral" ? (context.cvdSlope >= 0 ? "up" : "down") : context.bias.tone;
  const stance = tone === "down" ? "Short" : "Long";
  const currentPrice = context.currentPrice;
  const leverage = DEFAULT_LEVERAGE;
  const targetReturnPct = TARGET_MARGIN_RETURN_PCT;
  const stopReturnPct = STOP_MARGIN_RETURN_PCT;
  const riskUnit = Math.max(context.latestAtr * 0.9, context.currentPrice * 0.006);
  const bandBuffer = Math.max(context.bandWidth || 0, riskUnit * 0.18);
  const targetMove = Math.max(currentPrice * (targetReturnPct / leverage / 100), riskUnit * 1.4);
  const stopMove = Math.max(currentPrice * (stopReturnPct / leverage / 100), riskUnit * 0.75);
  let stopLoss;
  let takeProfit;
  let entry;
  let referenceLevel;
  let mode;
  let nearestTarget;

  if (tone === "up") {
    const nearestSupport = supportLevels.find((level) => level < currentPrice) ?? context.ema20;
    const nearestResistance = resistanceLevels.find((level) => level > currentPrice) ?? currentPrice + riskUnit * 1.2;
    const breakoutResistance =
      resistanceLevels.find((level) => level >= currentPrice - riskUnit * 0.15) ?? nearestResistance;
    const pullbackReference = Number.isFinite(nearestSupport)
      ? Math.max(nearestSupport, context.ema20 - riskUnit * 0.18)
      : context.ema20;
    const pullbackDistanceAtr = Math.abs(currentPrice - pullbackReference) / Math.max(context.latestAtr, 0.0000001);
    const breakoutDistanceAtr = Math.abs(currentPrice - breakoutResistance) / Math.max(context.latestAtr, 0.0000001);
    const pullbackEligible =
      currentPrice >= pullbackReference - riskUnit * 0.28 &&
      pullbackDistanceAtr <= MAX_ENTRY_DISTANCE_FROM_LEVEL_ATR &&
      Math.abs(pctChange(context.ema20, currentPrice)) <= MAX_ENTRY_DISTANCE_FROM_EMA20_ATR;
    const breakoutEligible =
      currentPrice >= breakoutResistance &&
      breakoutDistanceAtr <= 0.8 &&
      context.recentPriceChange > 0.55;

    mode = pullbackEligible ? "pullback" : breakoutEligible ? "breakout" : "extended";
    entry = currentPrice;
    referenceLevel = pullbackEligible ? pullbackReference : breakoutResistance;
    stopLoss = pullbackEligible
      ? Math.max((nearestSupport ?? pullbackReference) - bandBuffer, entry - stopMove)
      : Math.max((breakoutResistance ?? entry) - bandBuffer, entry - stopMove);
    nearestTarget = pullbackEligible
      ? nearestResistance
      : resistanceLevels.find((level) => level > breakoutResistance + bandBuffer) ?? nearestResistance;
    takeProfit = Math.max(nearestTarget || entry + targetMove, entry + targetMove);
  } else {
    const nearestResistance = resistanceLevels.find((level) => level > currentPrice) ?? context.ema20;
    const nearestSupport = supportLevels.find((level) => level < currentPrice) ?? currentPrice - riskUnit * 1.2;
    const breakoutSupport =
      supportLevels.find((level) => level <= currentPrice + riskUnit * 0.15) ?? nearestSupport;
    const pullbackReference = Number.isFinite(nearestResistance)
      ? Math.min(nearestResistance, context.ema20 + riskUnit * 0.18)
      : context.ema20;
    const pullbackDistanceAtr = Math.abs(currentPrice - pullbackReference) / Math.max(context.latestAtr, 0.0000001);
    const breakoutDistanceAtr = Math.abs(currentPrice - breakoutSupport) / Math.max(context.latestAtr, 0.0000001);
    const pullbackEligible =
      currentPrice <= pullbackReference + riskUnit * 0.28 &&
      pullbackDistanceAtr <= MAX_ENTRY_DISTANCE_FROM_LEVEL_ATR &&
      Math.abs(pctChange(context.ema20, currentPrice)) <= MAX_ENTRY_DISTANCE_FROM_EMA20_ATR;
    const breakoutEligible =
      currentPrice <= breakoutSupport &&
      breakoutDistanceAtr <= 0.8 &&
      context.recentPriceChange < -0.55;

    mode = pullbackEligible ? "pullback" : breakoutEligible ? "breakout" : "extended";
    entry = currentPrice;
    referenceLevel = pullbackEligible ? pullbackReference : breakoutSupport;
    stopLoss = pullbackEligible
      ? Math.min((nearestResistance ?? pullbackReference) + bandBuffer, entry + stopMove)
      : Math.min((breakoutSupport ?? entry) + bandBuffer, entry + stopMove);
    nearestTarget = pullbackEligible
      ? nearestSupport
      : supportLevels.find((level) => level < breakoutSupport - bandBuffer) ?? nearestSupport;
    takeProfit = Math.min(nearestTarget || entry - targetMove, entry - targetMove);
  }

  const rr = Math.abs(takeProfit - entry) / Math.max(Math.abs(entry - stopLoss), 0.0000001);
  const nearestTargetRr =
    Math.abs((nearestTarget ?? takeProfit) - entry) / Math.max(Math.abs(entry - stopLoss), 0.0000001);
  return {
    stance,
    tone,
    mode,
    entry,
    stopLoss,
    takeProfit,
    rr,
    nearestTargetRr,
    referenceLevel,
    entryLocationQuality: mode !== "extended",
    distanceFromEma20Atr: Math.abs(entry - context.ema20) / Math.max(context.latestAtr, 0.0000001),
    distanceFromLevelAtr: Math.abs(entry - (referenceLevel ?? entry)) / Math.max(context.latestAtr, 0.0000001),
    leverage,
    targetReturnPct,
    stopReturnPct,
    projectedMovePct: Math.abs(pctChange(entry, takeProfit)),
  };
}

function summarizeTimeframe(candles) {
  const closes = candles.map((candle) => candle.close);
  const currentPrice = closes[closes.length - 1] || 0;
  const ema20Series = ema(closes, 20);
  const ema50Series = ema(closes, 50);
  const rsiSeries = rsi(closes, 14);
  const ema20Value = latestDefinedValue(ema20Series) ?? currentPrice;
  const ema50Value = latestDefinedValue(ema50Series) ?? currentPrice;
  const rsiValue = latestDefinedValue(rsiSeries) ?? 50;
  const lookback = Math.min(8, Math.max(1, closes.length - 1));
  const changePct = lookback > 0 ? pctChange(closes[closes.length - 1 - lookback], currentPrice) : 0;
  let score = 0;
  score += currentPrice > ema20Value ? 10 : -10;
  score += ema20Value > ema50Value ? 12 : -12;
  score += rsiValue >= 52 && rsiValue <= 66 ? 8 : rsiValue <= 48 && rsiValue >= 34 ? -8 : 0;
  score += changePct > 0.8 ? 6 : changePct < -0.8 ? -6 : 0;

  if (score >= 14) return { label: "Bullish", tone: "up", score, rsi: rsiValue, changePct };
  if (score <= -14) return { label: "Bearish", tone: "down", score, rsi: rsiValue, changePct };
  return { label: "Balanced", tone: "neutral", score, rsi: rsiValue, changePct };
}

function analyzeSnapshot(snapshot) {
  const candles = (snapshot.candles || []).map((candle) => ({ ...candle }));
  const closes = candles.map((candle) => candle.close);
  const currentPrice = Number(snapshot.premiumIndex?.markPrice) || closes[closes.length - 1] || 0;
  const ema20Series = ema(closes, 20);
  const ema50Series = ema(closes, 50);
  const rsiSeries = rsi(closes, 14);
  const macdSeries = macd(closes);
  const atrSeries = atr(candles, 14);
  const bollingerSeries = bollingerBands(closes, 20, 2);
  const latestAtr = latestDefinedValue(atrSeries) ?? currentPrice * 0.01;
  const supportResistance = computeSupportResistance(candles, currentPrice, latestAtr);
  const tradeSummary = analyzeTradeTape(snapshot.trades || []);
  const depthSummary = analyzeOrderbook(snapshot.depth || { bids: [], asks: [] }, currentPrice);
  const takerSummary = analyzeTakerLongShort(snapshot.takerLongShort || []);
  const oiHistory = (snapshot.openInterestHistory || []).map((entry) => Number(entry.sumOpenInterest));
  const oiChange1h = pctChangeFromLookback(oiHistory, 12);
  const recentPriceChange = pctChangeFromLookback(closes, Math.min(4, Math.max(1, closes.length - 1)));
  const fundingRate = (Number(snapshot.premiumIndex?.lastFundingRate) || 0) * 100;
  const quoteVolume = Number(snapshot.ticker?.quoteVolume) || 0;
  const globalLongShortRatio = snapshot.globalLongShort?.length
    ? Number(snapshot.globalLongShort[snapshot.globalLongShort.length - 1].longShortRatio)
    : 1;
  const ema20Value = latestDefinedValue(ema20Series) ?? currentPrice;
  const ema50Value = latestDefinedValue(ema50Series) ?? currentPrice;
  const ema20Slope = slopePercentage(ema20Series, 4);
  const ema50Slope = slopePercentage(ema50Series, 4);
  const emaSpreadAtr = Math.abs(ema20Value - ema50Value) / Math.max(latestAtr, 0.0000001);
  const atrPct = currentPrice ? (latestAtr / Math.abs(currentPrice)) * 100 : 0;
  const recentStructure = recentCandleQuality(candles, 4);
  const compressedStructure = emaSpreadAtr < MIN_EMA_SPREAD_ATR;
  const lowVolatilityChop =
    (atrPct < MIN_ATR_PCT_FOR_CONTINUATION && Math.abs(recentPriceChange) < 0.75) ||
    recentStructure.isWickyChop;
  const venueConsensus = buildVenueConsensus(snapshot.venues || []);
  const biasScore = buildBiasScore({
    currentPrice,
    ema20: ema20Value,
    ema50: ema50Value,
    rsi: latestDefinedValue(rsiSeries) ?? 50,
    macdHistogram: latestDefinedValue(macdSeries.histogram) ?? 0,
    cvdSlope: tradeSummary.cvdSlope,
    depthImbalance: depthSummary.imbalance,
    oiChange1h,
    recentPriceChange,
    takerRatio: takerSummary.latestRatio,
    fundingRate,
    globalLongShortRatio,
    venueConsensus,
  });
  const bias = biasDescriptor(biasScore);
  const ema20SlopeAligned = slopeAlignedForDirection(ema20Slope, ema50Slope, bias.tone);
  const ema50SlopeAligned = bias.tone === "up" ? ema50Slope > -0.01 : ema50Slope < 0.01;
  const crowdedLong = fundingRate > 0.025 && oiChange1h > 0 && globalLongShortRatio > 1.1;
  const crowdedShort = fundingRate < -0.025 && oiChange1h > 0 && globalLongShortRatio < 0.9;
  const crowdedHardRejectLong = fundingRate > 0.045 && oiChange1h > 0 && globalLongShortRatio > 1.16;
  const crowdedHardRejectShort = fundingRate < -0.045 && oiChange1h > 0 && globalLongShortRatio < 0.84;
  const crowdedContinuation = bias.tone === "up" ? crowdedLong : bias.tone === "down" ? crowdedShort : false;
  const crowdedHardReject =
    bias.tone === "up" ? crowdedHardRejectLong : bias.tone === "down" ? crowdedHardRejectShort : false;
  const extremeCompressedStructure = emaSpreadAtr < MIN_EMA_SPREAD_ATR * 0.6;
  const extremeLowVolatilityChop =
    atrPct < MIN_ATR_PCT_FOR_CONTINUATION * 0.7 &&
    Math.abs(recentPriceChange) < 0.55 &&
    (recentStructure.isWickyChop || recentStructure.avgBodyRatio < MIN_RECENT_BODY_RATIO * 0.8);
  const potentialTrade = buildPotentialTrade({
    currentPrice,
    ema20: ema20Value,
    ema50: ema50Value,
    latestAtr,
    bandWidth: supportResistance.bandWidth,
    supportLevels: supportResistance.supportLevels,
    resistanceLevels: supportResistance.resistanceLevels,
    bias,
    cvdSlope: tradeSummary.cvdSlope,
    recentPriceChange,
  });
  const rr = potentialTrade.rr;
  const qualityScore = Math.round(
    Math.abs(biasScore) +
      (rr >= 1.5 ? 10 : rr >= 1.2 ? 4 : -8) +
      (venueConsensus.priceSpreadBps < 8 ? 8 : -6) +
      (tradeSummary.cvdSlope * (bias.tone === "up" ? 1 : -1) > 0 ? 6 : -6) +
      (oiChange1h > 0 ? 4 : -2) +
      (Math.abs(recentPriceChange) > 0.8 ? 4 : 0) +
      (Math.abs(fundingRate) < 0.03 ? 4 : -4)
  );

  return {
    symbol: snapshot.symbol,
    token: snapshot.token,
    currentPrice,
    pricePrecision: snapshot.pricePrecision || 2,
    bias,
    biasScore,
    qualityScore,
    rr,
    ema20: ema20Value,
    ema50: ema50Value,
    ema20Slope,
    ema50Slope,
    ema20SlopeAligned,
    ema50SlopeAligned,
    emaSpreadAtr,
    atrPct,
    recentBodyRatio: recentStructure.avgBodyRatio,
    recentWickyCount: recentStructure.wickyCount,
    compressedStructure,
    lowVolatilityChop,
    extremeCompressedStructure,
    extremeLowVolatilityChop,
    rsi: latestDefinedValue(rsiSeries) ?? 50,
    latestAtr,
    fundingRate,
    quoteVolume,
    oiChange1h,
    recentPriceChange,
    crowdedContinuation,
    crowdedHardReject,
    cvdSlope: tradeSummary.cvdSlope,
    depthImbalance: depthSummary.imbalance,
    takerRatio: takerSummary.latestRatio,
    globalLongShortRatio,
    supportResistance,
    trade: potentialTrade,
    summary: `${bias.label} bias • Q${qualityScore} • RR ${rr.toFixed(2)} • funding ${fundingRate.toFixed(4)}%`,
  };
}

function effectiveHouseQualityGate(threshold = DEFAULT_QUALITY_THRESHOLD) {
  return Number(threshold) + 1;
}

function applyCandidateConfirmation(candidate, ticker, confirmation, threshold) {
  const quoteVolume = ticker?.quoteVolume || 0;
  const direction = candidate.bias.tone;
  const alignedTone = direction === "up" ? "up" : "down";
  const opposingTone = alignedTone === "up" ? "down" : "up";
  const timeframeStates = Object.values(confirmation || {});
  const alignedCount = timeframeStates.filter((entry) => entry.tone === alignedTone).length;
  const conflictCount = timeframeStates.filter((entry) => entry.tone === opposingTone).length;
  const distanceFromEma20Pct = Math.abs(pctChange(candidate.ema20, candidate.currentPrice));
  let entryQualityScore = 0;
  const buyerLed =
    candidate.cvdSlope > 0 && candidate.takerRatio > 1.01 && candidate.depthImbalance > 0.01;
  const sellerLed =
    candidate.cvdSlope < 0 && candidate.takerRatio < 0.99 && candidate.depthImbalance < -0.01;
  const lowerLiquiditySetup = quoteVolume < HIGH_VOLUME_FLOOR * 1.6;
  const crowdedSetup = Boolean(candidate.crowdedContinuation);
  const crowdedHardReject = Boolean(candidate.crowdedHardReject);
  const htfAgreementHardRejected = alignedCount < 1 || conflictCount > 0;
  const locationQuality = Boolean(candidate.trade?.entryLocationQuality);
  const slopesAligned = Boolean(candidate.ema20SlopeAligned) && Boolean(candidate.ema50SlopeAligned);

  if (hasGoodTradingVolume(quoteVolume)) entryQualityScore += 12;
  else entryQualityScore -= 20;

  if (direction === "up") {
    entryQualityScore += candidate.rsi >= 52 && candidate.rsi <= 64 ? 8 : -8;
    entryQualityScore += candidate.cvdSlope > 0 ? 10 : -14;
    entryQualityScore += candidate.takerRatio > 1.01 ? 8 : -10;
    entryQualityScore += candidate.depthImbalance > 0.02 ? 6 : -8;
    entryQualityScore += candidate.oiChange1h > 0 ? 6 : -4;
    if (candidate.fundingRate > 0.03) entryQualityScore -= 10;
  } else {
    entryQualityScore += candidate.rsi <= 48 && candidate.rsi >= 34 ? 8 : -8;
    entryQualityScore += candidate.cvdSlope < 0 ? 10 : -14;
    entryQualityScore += candidate.takerRatio < 0.99 ? 8 : -10;
    entryQualityScore += candidate.depthImbalance < -0.02 ? 6 : -8;
    entryQualityScore += candidate.oiChange1h > 0 ? 6 : -4;
    if (candidate.fundingRate < -0.03) entryQualityScore -= 10;
  }

  entryQualityScore += locationQuality ? 10 : -24;
  entryQualityScore += candidate.trade?.mode === "pullback" ? 6 : candidate.trade?.mode === "breakout" ? 2 : -18;
  entryQualityScore += candidate.trade?.distanceFromEma20Atr <= MAX_ENTRY_DISTANCE_FROM_EMA20_ATR ? 6 : -14;
  entryQualityScore += candidate.trade?.distanceFromLevelAtr <= MAX_ENTRY_DISTANCE_FROM_LEVEL_ATR ? 6 : -12;
  entryQualityScore += slopesAligned ? 12 : -22;
  entryQualityScore += candidate.trade?.nearestTargetRr >= MIN_NEAREST_TARGET_RR ? 8 : -18;
  if (candidate.compressedStructure) entryQualityScore -= 10;
  if (candidate.extremeCompressedStructure) entryQualityScore -= 12;
  if (candidate.lowVolatilityChop) entryQualityScore -= 12;
  if (candidate.extremeLowVolatilityChop) entryQualityScore -= 14;
  if (Number.isFinite(candidate.recentBodyRatio) && candidate.recentBodyRatio < MIN_RECENT_BODY_RATIO) {
    entryQualityScore -= 12;
  }
  if (crowdedSetup) entryQualityScore -= 20;
  if (crowdedHardReject) entryQualityScore -= 24;
  entryQualityScore += alignedCount >= 3 ? 20 : alignedCount === 2 ? 10 : -20;
  if (conflictCount > 0) entryQualityScore -= 40;
  entryQualityScore += distanceFromEma20Pct <= 2.5 ? 4 : -10;
  entryQualityScore += Math.abs(candidate.recentPriceChange) >= 0.8 ? 3 : -3;
  const requiredQualityGate =
    effectiveHouseQualityGate(threshold) +
    (crowdedSetup ? 10 : 0) +
    (crowdedHardReject ? 8 : 0) +
    (lowerLiquiditySetup ? 6 : 0);
  const requiredEntryScore =
    HOUSE_MIN_ENTRY_SCORE +
    (crowdedSetup ? 4 : 0) +
    (crowdedHardReject ? 4 : 0) +
    (lowerLiquiditySetup ? 2 : 0);

  return {
    ...candidate,
    quoteVolume,
    confirmation,
    alignedCount,
    conflictCount,
    buyerLed,
    sellerLed,
    crowdedSetup,
    crowdedHardReject,
    lowerLiquiditySetup,
    htfAgreementHardRejected,
    requiredQualityGate,
    requiredEntryScore,
    entryQualityScore,
    entryScore: entryQualityScore,
    refinedQualityScore: candidate.qualityScore + entryQualityScore,
  };
}

function highQualityCandidates(candidates, threshold) {
  const effectiveThreshold = threshold + 1;
  return candidates
    .filter(
      (candidate) =>
        candidate.bias.tone !== "neutral" &&
        (candidate.refinedQualityScore ?? candidate.qualityScore) >=
          Math.max(effectiveThreshold, candidate.requiredQualityGate || 0) &&
        candidate.entryQualityScore >= (candidate.requiredEntryScore || HOUSE_MIN_ENTRY_SCORE) &&
        candidate.alignedCount >= 1 &&
        candidate.conflictCount === 0 &&
        !candidate.htfAgreementHardRejected &&
        candidate.trade?.entryLocationQuality &&
        candidate.trade?.distanceFromEma20Atr <= MAX_ENTRY_DISTANCE_FROM_EMA20_ATR &&
        candidate.trade?.distanceFromLevelAtr <= MAX_ENTRY_DISTANCE_FROM_LEVEL_ATR &&
        candidate.trade?.nearestTargetRr >= MIN_NEAREST_TARGET_RR &&
        candidate.ema20SlopeAligned &&
        !candidate.crowdedHardReject &&
        !candidate.extremeCompressedStructure &&
        hasGoodTradingVolume(candidate.quoteVolume) &&
        candidate.rr >= MIN_RR &&
        candidate.trade.projectedMovePct >= MIN_PROJECTED_MOVE_PCT
    )
    .sort(
      (left, right) =>
        (right.refinedQualityScore ?? right.qualityScore) -
        (left.refinedQualityScore ?? left.qualityScore)
    );
}

function reservedMargin(state, strategyId = null) {
  return state.openTrades
    .filter((trade) => !strategyId || trade.strategyId === strategyId)
    .reduce((sum, trade) => sum + (Number(trade.marginUsed) || 0), 0);
}

function strategyOpenTrades(state, strategyId) {
  return state.openTrades.filter((trade) => trade.strategyId === strategyId);
}

function strategyHasOpenTrade(state, strategyId, symbol = null) {
  return state.openTrades.some(
    (trade) => trade.strategyId === strategyId && (!symbol || trade.symbol === symbol)
  );
}

function recentlyClosed(state, symbol, strategyId = "core") {
  return state.closedTrades.some(
    (trade) =>
      trade.symbol === symbol &&
      trade.strategyId === strategyId &&
      Date.now() - Number(trade.closedAt || 0) < TRADE_COOLDOWN_MS
  );
}

function recentlyStoppedOut(state, symbol, strategyId = "core") {
  return state.closedTrades.some(
    (trade) =>
      trade.symbol === symbol &&
      trade.strategyId === strategyId &&
      trade.reason === "SL" &&
      Date.now() - Number(trade.closedAt || 0) < STOP_LOSS_COOLDOWN_MS
  );
}

function tradeReturnPct(trade, exitPrice) {
  const direction = trade.side === "Short" ? -1 : 1;
  return pctChange(trade.entryPrice, exitPrice) * direction * (trade.leverage || DEFAULT_LEVERAGE);
}

function formatPercent(value, digits = 2) {
  if (!Number.isFinite(value)) return "-";
  return `${value >= 0 ? "+" : ""}${value.toFixed(digits)}%`;
}

function buildHouseEntryReason(candidate) {
  const trendLabel = candidate.trade?.stance === "Short" ? "bearish continuation" : "bullish continuation";
  const emaLabel = candidate.ema20 >= candidate.ema50 ? "EMA20 above EMA50" : "EMA20 below EMA50";
  const confirmation1h = candidate.confirmation?.["1h"]?.label || "Queue";
  const confirmation4h = candidate.confirmation?.["4h"]?.label || "Queue";
  const modeLabel = candidate.trade?.mode === "breakout" ? "breakout continuation" : "pullback continuation";
  const flowLabel =
    candidate.trade?.stance === "Short"
      ? candidate.cvdSlope < 0
        ? "seller-led flow"
        : "mixed flow"
      : candidate.cvdSlope > 0
        ? "buyer-led flow"
        : "mixed flow";
  return `${trendLabel} setup in ${modeLabel} mode with ${emaLabel}, ${confirmation1h} / ${confirmation4h} confirmation, and ${flowLabel}.`;
}

function buildHouseKeyDetails(candidate) {
  const details = [
    candidate.ema20 >= candidate.ema50 ? "EMA bull" : "EMA bear",
    candidate.trade?.mode ? candidate.trade.mode : null,
    Number.isFinite(candidate.rsi) ? `RSI ${candidate.rsi.toFixed(0)}` : null,
    Number.isFinite(candidate.cvdSlope) ? `CVD ${formatPercent(candidate.cvdSlope)}` : null,
    Number.isFinite(candidate.oiChange1h) ? `OI ${formatPercent(candidate.oiChange1h)}` : null,
    Number.isFinite(candidate.rr) ? `RR ${candidate.rr.toFixed(2)}` : null,
    Number.isFinite(candidate.trade?.targetReturnPct)
      ? `target ${candidate.trade.targetReturnPct}% on margin`
      : null,
    Number.isFinite(candidate.trade?.projectedMovePct)
      ? `move ${formatPercent(candidate.trade.projectedMovePct)}`
      : null,
    candidate.confirmation?.["1h"]?.label ? `1H ${candidate.confirmation["1h"].label}` : null,
    candidate.confirmation?.["4h"]?.label ? `4H ${candidate.confirmation["4h"].label}` : null,
    Number.isFinite(candidate.entryScore) ? `entry score ${candidate.entryScore}` : null,
  ];
  return details.filter(Boolean).join(" • ");
}

async function safeInsertSignalEvent(event) {
  try {
    await insertSignalEvent(event);
  } catch (error) {
    // Non-blocking.
  }
}

async function safeInsertTradeEvent(event) {
  try {
    await insertTradeEvent(event);
  } catch (error) {
    // Non-blocking.
  }
}

async function openTradeFromCandidate(state, candidate) {
  const strategyId = "core";
  const spec = strategySpec(strategyId);
  if (strategyHasOpenTrade(state, strategyId, candidate.symbol)) return false;
  if (strategyOpenTrades(state, strategyId).length >= spec.maxOpenTrades) return false;
  if (state.openTrades.length >= MAX_CONCURRENT_TRADES) return false;

  const strategyBalanceBefore = Number(state.strategyBalances?.[strategyId]) || STRATEGY_START_BALANCE;
  const freeCapital = Math.max(strategyBalanceBefore - reservedMargin(state, strategyId), 0);
  if (freeCapital < 10) return false;

  const leverage = candidate.trade.leverage || DEFAULT_LEVERAGE;
  const slotsRemaining = Math.max(1, (spec.maxOpenTrades || 1) - strategyOpenTrades(state, strategyId).length);
  const marginBudget = Math.min(
    freeCapital,
    Math.max(strategyBalanceBefore * 0.16, freeCapital / slotsRemaining)
  );
  const riskCapital = Math.max(marginBudget * 0.12, 2);
  const stopDistance = Math.abs(candidate.trade.entry - candidate.trade.stopLoss);
  const quantityByRisk = stopDistance > 0 ? riskCapital / stopDistance : 0;
  const quantityByCapital = (marginBudget * leverage) / candidate.trade.entry;
  const quantity = Math.max(0, Math.min(quantityByRisk, quantityByCapital));

  if (!Number.isFinite(quantity) || quantity <= 0) return false;

  const openedTrade = {
    id: `${Date.now()}-${strategyId}-${candidate.symbol}`,
    strategyId,
    strategyLabel: spec.label,
    symbol: candidate.symbol,
    token: candidate.token,
    interval: state.interval,
    side: candidate.trade.stance,
    entryPrice: candidate.trade.entry,
    stopLoss: candidate.trade.stopLoss,
    takeProfit: candidate.trade.takeProfit,
    quantity,
    leverage,
    marginUsed: marginBudget,
    qualityScore: candidate.refinedQualityScore ?? candidate.qualityScore,
    biasScore: candidate.biasScore,
    targetReturnPct: candidate.trade.targetReturnPct,
    stopReturnPct: candidate.trade.stopReturnPct,
    projectedMovePct: candidate.trade.projectedMovePct,
    rr: candidate.rr,
    entryScore: candidate.entryScore,
    entryReason: buildHouseEntryReason(candidate),
    keyDetails: buildHouseKeyDetails(candidate),
    pricePrecision: candidate.pricePrecision,
    breakEvenArmed: false,
    profitLockArmed: false,
    openedAt: Date.now(),
    detectedAt: Date.now(),
    balanceBefore: state.balance,
    strategyBalanceBefore,
    lastPrice: candidate.currentPrice,
  };

  state.openTrades.push(openedTrade);
  logActivity(
    state,
    `Opened ${spec.label} ${candidate.trade.stance} ${candidate.symbol} • quality ${(candidate.refinedQualityScore ?? candidate.qualityScore).toFixed(0)}.`,
    candidate.trade.tone
  );

  const eventId = `${openedTrade.id}:signal`;
  await safeInsertSignalEvent({
    eventId,
    source: "house_cron",
    strategy: "house_trend",
    strategyVersion: STRATEGY_VERSION,
    signalType: "entry_opened",
    symbol: openedTrade.symbol,
    token: openedTrade.token,
    side: openedTrade.side,
    interval: openedTrade.interval,
    qualityScore: openedTrade.qualityScore,
    biasScore: openedTrade.biasScore,
    detectedAt: openedTrade.detectedAt,
    openedAt: openedTrade.openedAt,
    eventTime: openedTrade.openedAt,
    entryPrice: openedTrade.entryPrice,
    tp1: openedTrade.takeProfit,
    tp2: openedTrade.takeProfit,
    stopLoss: openedTrade.stopLoss,
    leverage: openedTrade.leverage,
    pricePrecision: openedTrade.pricePrecision,
    metadata: {
      entryScore: openedTrade.entryScore,
      entryReason: openedTrade.entryReason,
      keyDetails: openedTrade.keyDetails,
      projectedMovePct: openedTrade.projectedMovePct,
      rr: openedTrade.rr,
    },
  });
  await safeInsertTradeEvent({
    eventId: `${openedTrade.id}:opened`,
    tradeId: openedTrade.id,
    source: "house_cron",
    strategy: "house_trend",
    strategyVersion: STRATEGY_VERSION,
    eventType: "opened",
    symbol: openedTrade.symbol,
    side: openedTrade.side,
    eventTime: openedTrade.openedAt,
    detectedAt: openedTrade.detectedAt,
    openedAt: openedTrade.openedAt,
    entryPrice: openedTrade.entryPrice,
    tp1: openedTrade.takeProfit,
    tp2: openedTrade.takeProfit,
    stopLoss: openedTrade.stopLoss,
    leverage: openedTrade.leverage,
    quantity: openedTrade.quantity,
    marginUsed: openedTrade.marginUsed,
    qualityScore: openedTrade.qualityScore,
    metadata: {
      entryScore: openedTrade.entryScore,
      projectedMovePct: openedTrade.projectedMovePct,
      rr: openedTrade.rr,
    },
  });

  return true;
}

async function closeTrade(state, tradeId, reason, exitPrice, precisionHint) {
  const tradeIndex = state.openTrades.findIndex((trade) => trade.id === tradeId);
  if (tradeIndex === -1) return;

  const trade = state.openTrades[tradeIndex];
  const direction = trade.side === "Short" ? -1 : 1;
  const pnlUsd = (exitPrice - trade.entryPrice) * trade.quantity * direction;
  const pnlPct = pctChange(trade.entryPrice, exitPrice) * direction;
  const returnPct = tradeReturnPct(trade, exitPrice);
  const balanceAfter = state.balance + pnlUsd;

  const closedTrade = {
    ...trade,
    exitPrice,
    closedAt: Date.now(),
    reason,
    pnlUsd,
    pnlPct,
    returnPct,
    balanceAfter,
    strategyBalanceAfter: trade.strategyBalanceBefore + pnlUsd,
    pricePrecision: precisionHint || trade.pricePrecision,
  };

  state.closedTrades.unshift(closedTrade);
  state.closedTrades = state.closedTrades.slice(0, 90);
  state.strategyBalances[trade.strategyId] =
    (Number(state.strategyBalances[trade.strategyId]) || STRATEGY_START_BALANCE) + pnlUsd;
  recomputeTotalBalance(state);
  state.openTrades.splice(tradeIndex, 1);

  logActivity(
    state,
    `${reason} closed ${trade.strategyLabel} ${trade.side} ${trade.symbol} • ${formatPercent(returnPct)} on margin.`,
    reason === "TP" ? "up" : "down"
  );

  await safeInsertTradeEvent({
    eventId: `${trade.id}:${reason.toLowerCase()}:${closedTrade.closedAt}`,
    tradeId: trade.id,
    source: "house_cron",
    strategy: "house_trend",
    strategyVersion: STRATEGY_VERSION,
    eventType: reason === "TP" ? "tp" : "sl",
    symbol: trade.symbol,
    side: trade.side,
    eventTime: closedTrade.closedAt,
    detectedAt: trade.detectedAt,
    openedAt: trade.openedAt,
    closedAt: closedTrade.closedAt,
    entryPrice: trade.entryPrice,
    exitPrice: closedTrade.exitPrice,
    tp1: trade.takeProfit,
    tp2: trade.takeProfit,
    stopLoss: trade.stopLoss,
    leverage: trade.leverage,
    quantity: trade.quantity,
    marginUsed: trade.marginUsed,
    qualityScore: trade.qualityScore,
    returnPct: closedTrade.returnPct,
    pnlUsd: closedTrade.pnlUsd,
    balanceAfter: closedTrade.balanceAfter,
    metadata: {
      reason,
    },
  });
}

function tightenTradeProtection(state, trade, candidate) {
  const direction = trade.side === "Short" ? -1 : 1;
  const targetDistance = Math.abs(trade.takeProfit - trade.entryPrice);
  if (!Number.isFinite(targetDistance) || targetDistance <= 0) return;

  const progress = Math.abs(candidate.currentPrice - trade.entryPrice) / targetDistance;
  const breakevenStop = trade.entryPrice;
  const lockedStop = trade.entryPrice + direction * targetDistance * 0.3;

  if (progress >= 0.45 && !trade.breakEvenArmed) {
    trade.stopLoss = breakevenStop;
    trade.breakEvenArmed = true;
    logActivity(
      state,
      `Protected ${trade.symbol} by moving the stop to breakeven after early follow-through.`,
      "neutral"
    );
  }

  if (progress >= 0.75 && !trade.profitLockArmed) {
    trade.stopLoss = lockedStop;
    trade.profitLockArmed = true;
    logActivity(
      state,
      `Locked profit on ${trade.symbol}; stop advanced further after trend continuation.`,
      direction === 1 ? "up" : "down"
    );
  }
}

async function refreshOpenTrades(state, candidates) {
  if (!state.openTrades.length) return;
  const candidateMap = new Map(candidates.map((candidate) => [candidate.symbol, candidate]));
  const trades = [...state.openTrades];

  for (const trade of trades) {
    const candidate = candidateMap.get(trade.symbol);
    if (!candidate) continue;

    trade.lastPrice = candidate.currentPrice;
    trade.pricePrecision = candidate.pricePrecision;
    tightenTradeProtection(state, trade, candidate);
    const hitTarget =
      trade.side === "Long"
        ? candidate.currentPrice >= trade.takeProfit
        : candidate.currentPrice <= trade.takeProfit;
    const hitStop =
      trade.side === "Long"
        ? candidate.currentPrice <= trade.stopLoss
        : candidate.currentPrice >= trade.stopLoss;

    if (hitTarget) {
      await closeTrade(state, trade.id, "TP", trade.takeProfit, candidate.pricePrecision);
    } else if (hitStop) {
      await closeTrade(state, trade.id, "SL", trade.stopLoss, candidate.pricePrecision);
    }
  }
}

async function openQualifiedTrades(state, candidates) {
  const opened = [];
  const spec = STRATEGY_SPECS[0];
  const eligible = highQualityCandidates(candidates, state.qualityThreshold).filter(
    (entry) =>
      !strategyHasOpenTrade(state, spec.id, entry.symbol) &&
      !recentlyClosed(state, entry.symbol, spec.id) &&
      !recentlyStoppedOut(state, entry.symbol, spec.id)
  );

  for (const candidate of eligible) {
    if (opened.length >= MAX_NEW_TRADES_PER_SCAN) break;
    if (strategyOpenTrades(state, spec.id).length >= spec.maxOpenTrades) break;
    if (await openTradeFromCandidate(state, candidate)) {
      opened.push({
        strategyId: spec.id,
        strategyLabel: spec.label,
        symbol: candidate.symbol,
        bias: candidate.bias,
        pricePrecision: candidate.pricePrecision,
        trade: candidate.trade,
        qualityScore: candidate.refinedQualityScore ?? candidate.qualityScore,
      });
    }
  }

  return opened;
}

function normalizeToken(rawToken) {
  const cleaned = String(rawToken || "")
    .toUpperCase()
    .trim()
    .replace(/[^A-Z0-9]/g, "");

  if (!cleaned) return "BTC";
  if (cleaned.endsWith(QUOTE_ASSET)) return cleaned.slice(0, -QUOTE_ASSET.length) || "BTC";
  return cleaned;
}

function perpUniverseSymbols(exchangeInfo) {
  return (exchangeInfo.symbols || []).filter(
    (symbolInfo) =>
      symbolInfo.quoteAsset === QUOTE_ASSET &&
      symbolInfo.contractType === "PERPETUAL" &&
      symbolInfo.status === "TRADING"
  );
}

function scoreSymbolCandidate(symbolInfo, cleanedToken) {
  const inputWithQuote = `${cleanedToken}${QUOTE_ASSET}`;
  let score = 0;
  if (symbolInfo.symbol === cleanedToken) score += 120;
  if (symbolInfo.symbol === inputWithQuote) score += 110;
  if (symbolInfo.baseAsset === cleanedToken) score += 95;
  if (symbolInfo.baseAsset.endsWith(cleanedToken)) score += 65;
  if (symbolInfo.baseAsset.startsWith(cleanedToken)) score += 55;
  if (symbolInfo.symbol.includes(cleanedToken)) score += 25;
  score -= Math.abs(symbolInfo.baseAsset.length - cleanedToken.length);
  return score;
}

function resolvePerpSymbol(rawToken, exchangeInfo) {
  const cleanedToken = normalizeToken(rawToken);
  const symbols = perpUniverseSymbols(exchangeInfo);

  const ranked = symbols
    .map((symbolInfo) => ({
      symbolInfo,
      score: scoreSymbolCandidate(symbolInfo, cleanedToken),
    }))
    .filter((entry) => entry.score > 0)
    .sort((left, right) => {
      if (right.score !== left.score) return right.score - left.score;
      return left.symbolInfo.symbol.length - right.symbolInfo.symbol.length;
    });

  const resolved = ranked[0]?.symbolInfo || null;
  if (!resolved) throw new Error(`No USDT perpetual contract found for ${cleanedToken}.`);

  return {
    cleanedToken,
    symbol: resolved.symbol,
    baseAsset: resolved.baseAsset,
    pricePrecision: resolved.pricePrecision,
  };
}

function mapKlineEntry(entry) {
  return {
    time: Math.floor(Number(entry[0]) / 1000),
    open: Number(entry[1]),
    high: Number(entry[2]),
    low: Number(entry[3]),
    close: Number(entry[4]),
    volume: Number(entry[5]),
  };
}

async function fetchJson(url, label) {
  const response = await fetch(url, {
    headers: {
      accept: "application/json",
    },
  });
  if (!response.ok) throw new Error(`${label} failed (${response.status})`);
  return response.json();
}

async function getExchangeInfo() {
  if (exchangeInfoCache) return exchangeInfoCache;
  try {
    exchangeInfoCache = await fetchJson("https://fapi.binance.com/fapi/v1/exchangeInfo", "Exchange info");
  } catch (error) {
    if (!Array.isArray(fallbackExchangeInfo.symbols) || !fallbackExchangeInfo.symbols.length) {
      throw error;
    }
    exchangeInfoCache = fallbackExchangeInfo;
  }
  return exchangeInfoCache;
}

async function getPerpUniverse() {
  if (perpUniverseCache) return perpUniverseCache;
  const exchangeInfo = await getExchangeInfo();
  perpUniverseCache = perpUniverseSymbols(exchangeInfo).sort((left, right) =>
    left.symbol.localeCompare(right.symbol)
  );
  return perpUniverseCache;
}

function mapUniverseTickers(entries, activeSymbols) {
  return (entries || [])
    .filter((entry) => activeSymbols.has(entry.symbol))
    .map((entry) => ({
      symbol: entry.symbol,
      lastPrice: Number(entry.lastPrice ?? entry.price ?? entry.markPrice) || 0,
      changePct: Number(entry.priceChangePercent ?? entry.changePct) || 0,
      quoteVolume: Number(entry.quoteVolume) || 0,
      volume: Number(entry.volume) || 0,
    }));
}

async function fetchUniverseTickersDirect(activeSymbols) {
  const tickers = await fetchJson("https://fapi.binance.com/fapi/v1/ticker/24hr", "24H tickers");
  return mapUniverseTickers(tickers, activeSymbols);
}

async function fetchUniverseSpotTickersFallback(activeSymbols) {
  const tickers = await fetchJson("https://api.binance.com/api/v3/ticker/24hr", "Spot 24H tickers");
  return mapUniverseTickers(tickers, activeSymbols);
}

async function fetchUniversePricesFallback(activeSymbols) {
  const prices = await fetchJson("https://fapi.binance.com/fapi/v1/ticker/price", "Ticker prices");
  return mapUniverseTickers(prices, activeSymbols);
}

function buildShellTickers(activeSymbols) {
  return Array.from(activeSymbols).map((symbol) => ({
    symbol,
    lastPrice: 0,
    changePct: 0,
    quoteVolume: 0,
    volume: 0,
  }));
}

async function fetchUniverseTickers() {
  const universe = await getPerpUniverse();
  const activeSymbols = new Set(universe.map((item) => item.symbol));
  try {
    return await fetchUniverseTickersDirect(activeSymbols);
  } catch (directError) {
    try {
      const spotTickers = await fetchUniverseSpotTickersFallback(activeSymbols);
      if (spotTickers.length) return spotTickers;
    } catch (spotError) {
      // fall through
    }
    try {
      return await fetchUniversePricesFallback(activeSymbols);
    } catch (priceError) {
      return buildShellTickers(activeSymbols);
    }
  }
}

function buildSpotCoreSymbolCandidates(resolved) {
  const candidates = [resolved.symbol];
  if (!/^\d/.test(resolved.baseAsset || "")) {
    candidates.push(`${resolved.baseAsset}${QUOTE_ASSET}`);
    candidates.push(`${resolved.cleanedToken}${QUOTE_ASSET}`);
  }
  return Array.from(new Set(candidates.filter(Boolean)));
}

async function fetchFirstSuccessful(candidates, loader) {
  for (const candidate of candidates) {
    try {
      const value = await loader(candidate);
      if (value) return value;
    } catch (error) {
      // Try next candidate.
    }
  }
  return null;
}

async function fetchSpotCoreSnapshotDirect(resolved, interval) {
  const candidates = buildSpotCoreSymbolCandidates(resolved);
  return fetchFirstSuccessful(candidates, async (symbol) => {
    const requests = await Promise.allSettled([
      fetchJson(`https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=240`, "Spot klines"),
      fetchJson(`https://api.binance.com/api/v3/ticker/24hr?symbol=${symbol}`, "Spot 24H ticker"),
      fetchJson(`https://api.binance.com/api/v3/depth?symbol=${symbol}&limit=100`, "Spot depth"),
      fetchJson(`https://api.binance.com/api/v3/aggTrades?symbol=${symbol}&limit=400`, "Spot agg trades"),
    ]);

    const [klinesResult, tickerResult, depthResult, tradesResult] = requests;
    if (klinesResult.status !== "fulfilled" || tickerResult.status !== "fulfilled") {
      throw new Error(`Spot core data unavailable for ${symbol}`);
    }

    return {
      candles: klinesResult.value.map(mapKlineEntry),
      ticker: tickerResult.value,
      depth: depthResult.status === "fulfilled" ? depthResult.value : { bids: [], asks: [] },
      trades: tradesResult.status === "fulfilled" ? tradesResult.value : [],
    };
  });
}

async function fetchDirectSnapshot(token, interval) {
  const exchangeInfo = await getExchangeInfo();
  const resolved = resolvePerpSymbol(token, exchangeInfo);

  const requests = await Promise.allSettled([
    fetchJson(`https://fapi.binance.com/fapi/v1/klines?symbol=${resolved.symbol}&interval=${interval}&limit=240`, "Klines"),
    fetchJson(`https://fapi.binance.com/fapi/v1/ticker/24hr?symbol=${resolved.symbol}`, "Ticker"),
    fetchJson(`https://fapi.binance.com/fapi/v1/depth?symbol=${resolved.symbol}&limit=100`, "Depth"),
    fetchJson(`https://fapi.binance.com/fapi/v1/aggTrades?symbol=${resolved.symbol}&limit=400`, "Trades"),
    fetchJson(`https://fapi.binance.com/fapi/v1/premiumIndex?symbol=${resolved.symbol}`, "Premium"),
    fetchJson(`https://fapi.binance.com/futures/data/openInterestHist?symbol=${resolved.symbol}&period=5m&limit=60`, "OI history"),
    fetchJson(`https://fapi.binance.com/futures/data/globalLongShortAccountRatio?symbol=${resolved.symbol}&period=1h&limit=24`, "Global L/S"),
    fetchJson(`https://fapi.binance.com/futures/data/takerlongshortRatio?symbol=${resolved.symbol}&period=5m&limit=24`, "Taker ratio"),
  ]);

  const [
    klinesResult,
    tickerResult,
    depthResult,
    tradesResult,
    premiumResult,
    oiHistoryResult,
    globalResult,
    takerResult,
  ] = requests;

  let candles;
  let ticker;
  let depth;
  let trades;

  if (klinesResult.status === "fulfilled" && tickerResult.status === "fulfilled") {
    candles = klinesResult.value.map(mapKlineEntry);
    ticker = tickerResult.value;
    depth = depthResult.status === "fulfilled" ? depthResult.value : { bids: [], asks: [] };
    trades = tradesResult.status === "fulfilled" ? tradesResult.value : [];
  } else {
    const spotCore = await fetchSpotCoreSnapshotDirect(resolved, interval).catch(() => null);
    if (!spotCore) {
      throw new Error(`Core perpetual market data is unavailable for ${resolved.symbol}.`);
    }
    candles = spotCore.candles;
    ticker = spotCore.ticker;
    depth = spotCore.depth;
    trades = spotCore.trades;
  }

  return {
    token: resolved.cleanedToken,
    symbol: resolved.symbol,
    baseAsset: resolved.baseAsset,
    pricePrecision: resolved.pricePrecision,
    candles,
    ticker,
    depth,
    trades,
    premiumIndex: premiumResult.status === "fulfilled" ? premiumResult.value : null,
    openInterest: null,
    openInterestHistory: oiHistoryResult.status === "fulfilled" ? oiHistoryResult.value : [],
    globalLongShort: globalResult.status === "fulfilled" ? globalResult.value : [],
    takerLongShort: takerResult.status === "fulfilled" ? takerResult.value : [],
    venues: [],
  };
}

async function mapWithConcurrency(items, concurrency, mapper) {
  const results = new Array(items.length);
  let cursor = 0;

  async function worker() {
    while (cursor < items.length) {
      const currentIndex = cursor;
      cursor += 1;
      results[currentIndex] = await mapper(items[currentIndex], currentIndex);
    }
  }

  const runners = Array.from({ length: Math.min(concurrency, items.length) }, () => worker());
  await Promise.all(runners);
  return results;
}

function buildTickerLookup(tickers) {
  return new Map((tickers || []).map((entry) => [entry.symbol, entry]));
}

async function fetchHigherTimeframeEntries(symbol, config) {
  try {
    return await fetchJson(
      `https://fapi.binance.com/fapi/v1/klines?symbol=${symbol}&interval=${config.interval}&limit=180`,
      `${config.label} confirmation`
    );
  } catch (error) {
    const exchangeInfo = await getExchangeInfo().catch(() => null);
    const symbolInfo = (exchangeInfo?.symbols || []).find((entry) => entry.symbol === symbol);
    if (!symbolInfo || /^\d/.test(symbolInfo.baseAsset || "")) {
      throw error;
    }
    return fetchJson(
      `https://api.binance.com/api/v3/klines?symbol=${symbolInfo.baseAsset}${QUOTE_ASSET}&interval=${config.interval}&limit=180`,
      `${config.label} spot confirmation`
    );
  }
}

async function fetchHigherTimeframeConfirmation(symbol) {
  const cached = confirmationCache.get(symbol);
  if (cached && Date.now() - cached.fetchedAt < HTF_CONFIRMATION_CACHE_MS) {
    return cached.summary;
  }

  const results = await Promise.allSettled(
    HTF_CONFIRMATION_CONFIG.map((config) =>
      fetchHigherTimeframeEntries(symbol, config).then((entries) =>
        summarizeTimeframe(entries.map(mapKlineEntry))
      )
    )
  );

  const summary = HTF_CONFIRMATION_CONFIG.reduce((accumulator, config, index) => {
    const result = results[index];
    accumulator[config.key] =
      result.status === "fulfilled"
        ? result.value
        : { label: "Unavailable", tone: "neutral", score: 0, rsi: 50, changePct: 0 };
    return accumulator;
  }, {});

  confirmationCache.set(symbol, {
    fetchedAt: Date.now(),
    summary,
  });
  return summary;
}

function selectUniverseBatch(universe, openTrades, tickerLookup, scanCursor) {
  const ranked = [...universe].sort((left, right) => {
    const rightTicker = tickerLookup.get(right.symbol);
    const leftTicker = tickerLookup.get(left.symbol);
    const volumeDelta = (rightTicker?.quoteVolume || 0) - (leftTicker?.quoteVolume || 0);
    if (volumeDelta !== 0) return volumeDelta;
    const leftScaled = /^\d/.test(left.baseAsset || "") ? 1 : 0;
    const rightScaled = /^\d/.test(right.baseAsset || "") ? 1 : 0;
    if (leftScaled !== rightScaled) return leftScaled - rightScaled;
    if (left.symbol.length !== right.symbol.length) return left.symbol.length - right.symbol.length;
    return left.symbol.localeCompare(right.symbol);
  });

  const priority = ranked.slice(0, PRIORITY_SCAN_COUNT);
  const rotationPool = ranked.slice(PRIORITY_SCAN_COUNT);
  const rotationBatch = [];
  let nextCursor = scanCursor;

  if (rotationPool.length) {
    const start = scanCursor % rotationPool.length;
    for (let index = 0; index < Math.min(ROTATION_SCAN_COUNT, rotationPool.length); index += 1) {
      rotationBatch.push(rotationPool[(start + index) % rotationPool.length]);
    }
    nextCursor = (start + ROTATION_SCAN_COUNT) % rotationPool.length;
  }

  const combined = [...priority, ...rotationBatch];
  openTrades.forEach((trade) => {
    const openTradeInfo = universe.find((item) => item.symbol === trade.symbol);
    if (openTradeInfo) combined.unshift(openTradeInfo);
  });

  return {
    batch: Array.from(new Map(combined.map((item) => [item.symbol, item])).values()),
    nextCursor,
  };
}

function serializeCandidateForRuntime(candidate) {
  return sanitizeCandidate({
    ...candidate,
    analyzedAt: Date.now(),
  });
}

function friendlyErrorMessage(error) {
  const message = error?.message || String(error || "");
  if (/failed to fetch/i.test(message)) {
    return "Network request failed during the background scan. The House engine will retry automatically.";
  }
  return message || "Background House scan failed.";
}

async function runHouseScan(stateInput = {}, options = {}) {
  const state = sanitizeRuntimeState(stateInput);
  const manual = Boolean(options.manual);

  if (!state.autoEnabled && !manual) {
    setRuntimeStatus(state, "Background House engine is paused.", "neutral");
    return {
      state,
      summary: {
        skipped: true,
        reason: "auto_disabled",
      },
    };
  }

  try {
    const universe = await getPerpUniverse();
    const tickers = await fetchUniverseTickers();
    universeTickerMap = buildTickerLookup(tickers);
    const selection = selectUniverseBatch(universe, state.openTrades, universeTickerMap, state.scanCursor);
    state.scanCursor = selection.nextCursor;

    const results = await mapWithConcurrency(selection.batch, ANALYSIS_CONCURRENCY, async (symbolInfo) => {
      try {
        return analyzeSnapshot(await fetchDirectSnapshot(symbolInfo.symbol, state.interval));
      } catch (error) {
        return null;
      }
    });

    const rawCandidates = results
      .filter(Boolean)
      .sort((left, right) => right.qualityScore - left.qualityScore);

    const confirmationSymbols = Array.from(
      new Set([
        ...rawCandidates.slice(0, 16).map((candidate) => candidate.symbol),
        ...state.openTrades.map((trade) => trade.symbol),
      ])
    );

    const confirmationResults = await mapWithConcurrency(
      confirmationSymbols,
      HTF_CONFIRMATION_CONCURRENCY,
      async (symbol) => {
        try {
          return { symbol, summary: await fetchHigherTimeframeConfirmation(symbol) };
        } catch (error) {
          return {
            symbol,
            summary: {
              "1h": { label: "Unavailable", tone: "neutral", score: 0, rsi: 50, changePct: 0 },
              "4h": { label: "Unavailable", tone: "neutral", score: 0, rsi: 50, changePct: 0 },
            },
          };
        }
      }
    );

    const confirmationMap = new Map(confirmationResults.map((entry) => [entry.symbol, entry.summary]));
    const candidates = rawCandidates
      .map((candidate) =>
        applyCandidateConfirmation(
          candidate,
          universeTickerMap.get(candidate.symbol) || null,
          confirmationMap.get(candidate.symbol) || {},
          state.qualityThreshold
        )
      )
      .sort(
        (left, right) =>
          (right.bestStrategyQuality ?? right.refinedQualityScore ?? right.qualityScore) -
          (left.bestStrategyQuality ?? left.refinedQualityScore ?? left.qualityScore)
      );

    state.lastCandidates = candidates.slice(0, 48).map(serializeCandidateForRuntime);
    state.lastScanAt = Date.now();

    await refreshOpenTrades(state, candidates);
    const qualified = highQualityCandidates(candidates, state.qualityThreshold);
    const opened = await openQualifiedTrades(state, candidates);

    if (opened.length) {
      const lead = opened[0];
      setRuntimeStatus(
        state,
        `Opened ${opened.length} new house-strategy trade${opened.length > 1 ? "s" : ""}. ${state.openTrades.length}/${MAX_CONCURRENT_TRADES} positions active, led by ${lead.symbol}.`,
        lead.trade?.tone || lead.bias?.tone || "up"
      );
    } else if (state.openTrades.length) {
      setRuntimeStatus(
        state,
        `Monitoring ${state.openTrades.length} active paper position${state.openTrades.length > 1 ? "s" : ""} while the background universe scan continues.`,
        state.openTrades.some((trade) => trade.side === "Long") ? "up" : "down"
      );
    } else if (qualified.length) {
      setRuntimeStatus(
        state,
        `${qualified.length} setups qualify, but margin or cooldown rules are holding entries for now.`,
        qualified[0].bias.tone
      );
    } else {
      if (manual) {
        logActivity(
          state,
          `Manual background scan found no setup above the effective house bar of Q${effectiveHouseQualityGate(state.qualityThreshold)}.`,
          "neutral"
        );
      }
      setRuntimeStatus(
        state,
        `No trade opened. Waiting for the effective house bar of Q${effectiveHouseQualityGate(state.qualityThreshold)} (base threshold ${state.qualityThreshold} + confirmation buffer).`,
        "neutral"
      );
    }

    return {
      state: sanitizeRuntimeState(state),
      summary: {
        ok: true,
        checkedUniverse: universe.length,
        scannedBatch: selection.batch.length,
        qualified: qualified.length,
        opened: opened.length,
        activeTrades: state.openTrades.length,
        lastScanAt: state.lastScanAt,
      },
    };
  } catch (error) {
    const message = friendlyErrorMessage(error);
    setRuntimeStatus(state, message, "down");
    logActivity(state, message, "down");
    return {
      state: sanitizeRuntimeState(state),
      summary: {
        ok: false,
        error: message,
      },
    };
  }
}

module.exports = {
  STRATEGY_VERSION,
  defaultRuntimeState,
  sanitizeRuntimeState,
  buildResetRuntimeState,
  applyRuntimeSettings,
  effectiveHouseQualityGate,
  getPerpUniverse,
  fetchDirectSnapshot,
  analyzeSnapshot,
  fetchHigherTimeframeConfirmation,
  applyCandidateConfirmation,
  recoverRuntimeStateFromTradeEvents,
  runHouseScan,
};
